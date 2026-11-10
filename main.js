process.on('uncaughtException', (err) => {
  console.error('[Squirrel] Yakalanmamış ana işlem hatası engellendi:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Squirrel] Yakalanmamış promise reddi engellendi:', reason);
});

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Configure application name & Windows AppUserModelID for taskbar/task manager branding
app.name = 'Squirrel';
if (process.platform === 'win32') {
  app.setAppUserModelId('Squirrel');
}

// Configure Chromium switches to prevent GPU disk cache conflicts/access denied errors
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) {
      mainWindow.center();
      mainWindow.show();
    } else {
      mainWindow.center();
    }
    mainWindow.focus();
  }
});

const chokidar = require('chokidar');
const DriveService = require('./driveService');
const MegaService = require('./megaService');
const DropboxService = require('./dropboxService');
const OneDriveService = require('./onedriveService');
const ICloudService = require('./icloudService');
const UpdaterService = require('./updaterService');
const vaultService = require('./vaultService');
const filterService = require('./filterService');
const diagnosticsService = require('./diagnosticsService');

let mainWindow = null;
let tray = null;
let isQuitting = false;
const originalCwd = process.cwd();

const iconPath = path.join(__dirname, 'icon', 'icon.ico');
const syncIconPath = path.join(__dirname, 'icon', 'icon-sync.png');
let defaultTrayIcon = null;
let syncTrayIcon = null;
let isTraySyncing = false;
function resolveConfigDir() {
  let target;
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    target = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'config');
  } else {
    // Both dev mode (start.bat / npm start) and installed mode share %APPDATA%\Squirrel\config
    // so tokens, connected clouds, and watched folders persist seamlessly.
    try {
      target = path.join(app.getPath('userData'), 'config');
    } catch {
      target = path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), 'Squirrel', 'config');
    }
  }

  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    const templateDir = path.join(__dirname, 'config');
    if (templateDir !== target && fs.existsSync(templateDir)) {
      const files = ['cloud-accounts.json', 'settings.json', 'watched-folders.json', 'filters.json'];
      for (const f of files) {
        const dest = path.join(target, f);
        const src = path.join(templateDir, f);
        if (!fs.existsSync(dest) && fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  } catch (e) {
    console.warn('[Config] Failed to initialize config directory:', e.message);
  }

  return target;
}

const configDir = resolveConfigDir();
filterService.init(configDir);
const watchedFoldersConfigPath = path.join(configDir, 'watched-folders.json');
const quarantineConfigPath = path.join(configDir, 'quarantine.json');
const updaterService = new UpdaterService('2.1.0', 'ArdaGl1/Squirrel');

const statsCacheConfigPath = path.join(configDir, 'stats-cache.json');
const folderStatsCache = new Map();

function loadStatsCache() {
  if (fs.existsSync(statsCacheConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(statsCacheConfigPath, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        folderStatsCache.set(k, v);
      }
    } catch (e) {}
  }
}

function saveStatsCache() {
  try {
    const obj = {};
    for (const [k, v] of folderStatsCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(statsCacheConfigPath, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {}
}

loadStatsCache();

function loadQuarantine() {
  if (fs.existsSync(quarantineConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(quarantineConfigPath, 'utf8'));
      if (Array.isArray(data)) return data;
    } catch (e) {
      console.error('Karantina listesi okunamadi:', e);
    }
  }
  return [];
}

function saveQuarantine(list) {
  try {
    fs.writeFileSync(quarantineConfigPath, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Karantina listesi kaydedilemedi:', e);
  }
}

function setStartupLaunch(enable) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      openAsHidden: true,
      args: ['--hidden'],
    });
    return true;
  } catch (e) {
    console.error('Failed to set login item settings:', e);
    return false;
  }
}

function getStartupLaunch() {
  try {
    const s = app.getLoginItemSettings();
    return !!s.openAtLogin;
  } catch (e) {
    return false;
  }
}

function shouldCloseToTray() {
  try {
    const settingsPath = path.join(configDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (typeof s.closeToTray === 'boolean') return s.closeToTray;
    }
  } catch (e) {}
  return true;
}

function updateTraySyncState() {
  if (!tray) return;
  const isSyncing =
    activeReconciles.size > 0 ||
    (driveService && (driveService.isProcessingQueue || (driveService.queue && driveService.queue.length > 0))) ||
    (megaService && (megaService.isProcessingQueue || (megaService.queue && megaService.queue.length > 0))) ||
    (dropboxService && (dropboxService.isProcessingQueue || (dropboxService.queue && dropboxService.queue.length > 0))) ||
    (onedriveService && (onedriveService.isProcessingQueue || (onedriveService.queue && onedriveService.queue.length > 0))) ||
    (icloudService && (icloudService.isProcessingQueue || (icloudService.queue && icloudService.queue.length > 0)));

  if (isSyncing !== isTraySyncing) {
    isTraySyncing = isSyncing;
    try {
      if (isSyncing) {
        if (syncTrayIcon) tray.setImage(syncTrayIcon);
        tray.setToolTip('Squirrel - Syncing with Cloud...');
      } else {
        if (defaultTrayIcon) tray.setImage(defaultTrayIcon);
        tray.setToolTip('Squirrel - Multi-Cloud Sync');
      }
    } catch (e) {}
  }
}

function createTray() {
  if (tray) return;

  try {
    defaultTrayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16, quality: 'best' });
    syncTrayIcon = fs.existsSync(syncIconPath)
      ? nativeImage.createFromPath(syncIconPath).resize({ width: 16, height: 16, quality: 'best' })
      : defaultTrayIcon;

    tray = new Tray(defaultTrayIcon);
    tray.setToolTip('Squirrel - Multi-Cloud Sync');

    const updateTrayMenu = () => {
      const primaryId = getPrimaryCloudId();
      const service = getActiveCloudService();
      const isConn = service && service.isConnected;

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Open Squirrel',
          click: () => {
            if (mainWindow) {
              mainWindow.center();
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        {
          label: isConn ? 'Sync All Folders' : 'Sync All Folders (Disconnected)',
          enabled: isConn,
          click: async () => {
            if (!service || !service.isConnected) return;
            const watched = Array.from(activeWatchers.entries());
            for (const [folderPath, entry] of watched) {
              try {
                await performStartupReconcile(folderPath, entry.folderName, true);
              } catch (e) {}
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Open Config Directory',
          click: () => {
            if (fs.existsSync(configDir)) shell.openPath(configDir);
          },
        },
        { type: 'separator' },
        {
          label: 'Quit Squirrel',
          click: () => {
            isQuitting = true;
            stopAllWatchers();
            app.quit();
          },
        },
      ]);

      tray.setContextMenu(contextMenu);
    };

    updateTrayMenu();

    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.focus();
        }
      } else {
        mainWindow.center();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    tray.on('double-click', () => {
      if (!mainWindow) return;
      mainWindow.center();
      mainWindow.show();
      mainWindow.focus();
    });
  } catch (err) {
    console.error('Tray creation error:', err);
  }
}
const cloudAccountsConfigPath = path.join(configDir, 'cloud-accounts.json');
const driveService = new DriveService(configDir);
const megaService = new MegaService(configDir);
const dropboxService = new DropboxService(configDir);
const onedriveService = new OneDriveService(configDir);
const icloudService = new ICloudService(configDir);

// Çoklu Bulut Hesapları (Multi-Cloud Accounts) Yöneticisi
function getCloudAccountsData() {
  const defaultAccounts = {
    'google-drive': {
      id: 'google-drive',
      name: 'Google Drive',
      connected: driveService.isConnected,
      email: driveService.userEmail || null,
      folderHint: 'Google Drive / Squirrel',
      typeHint: 'OAuth 2.0 (Resmi Google Drive API)',
    },
    'onedrive': {
      id: 'onedrive',
      name: 'Microsoft OneDrive',
      connected: false,
      email: null,
      folderHint: 'OneDrive / Squirrel',
      typeHint: 'OAuth 2.0 (Microsoft Graph API)',
    },
    'dropbox': {
      id: 'dropbox',
      name: 'Dropbox',
      connected: false,
      email: null,
      folderHint: 'Dropbox / Apps / Squirrel',
      typeHint: 'OAuth 2.0 (Dropbox API v2)',
    },
    'icloud': {
      id: 'icloud',
      name: 'iCloud Drive',
      connected: false,
      email: null,
      folderHint: 'iCloud Drive / Squirrel',
      typeHint: 'Apple ID / iCloud Storage',
    },
    'mega': {
      id: 'mega',
      name: 'Mega (MEGA.nz)',
      connected: false,
      email: null,
      folderHint: 'Mega / Squirrel',
      typeHint: 'Mega End-to-End Encrypted Cloud API',
    },
  };

  try {
    if (fs.existsSync(cloudAccountsConfigPath)) {
      const saved = JSON.parse(fs.readFileSync(cloudAccountsConfigPath, 'utf8'));
      for (const [id, acc] of Object.entries(saved)) {
        if (defaultAccounts[id]) {
          defaultAccounts[id] = { ...defaultAccounts[id], ...acc };
        }
      }
    }
  } catch (e) {}

  // Google Drive durumunu dinamik güncelle
  defaultAccounts['google-drive'].connected = driveService.isConnected;
  defaultAccounts['google-drive'].email = driveService.userEmail || defaultAccounts['google-drive'].email;

  // Mega durumunu dinamik güncelle
  defaultAccounts['mega'].connected = megaService.isConnected;
  defaultAccounts['mega'].email = megaService.userEmail || defaultAccounts['mega'].email;

  // Dropbox durumunu dinamik güncelle
  defaultAccounts['dropbox'].connected = dropboxService.isConnected;
  defaultAccounts['dropbox'].email = dropboxService.userEmail || defaultAccounts['dropbox'].email;

  // Microsoft OneDrive durumunu dinamik güncelle
  defaultAccounts['onedrive'].connected = onedriveService.isConnected;
  defaultAccounts['onedrive'].email = onedriveService.userEmail || defaultAccounts['onedrive'].email;

  // Apple iCloud durumunu dinamik güncelle
  defaultAccounts['icloud'].connected = icloudService.isConnected;
  defaultAccounts['icloud'].email = icloudService.userEmail || defaultAccounts['icloud'].email;

  // Primary Cloud ayarını oku
  let primaryCloud = 'google-drive';
  try {
    const settings = fs.existsSync(driveService.settingsPath)
      ? JSON.parse(fs.readFileSync(driveService.settingsPath, 'utf8'))
      : {};
    if (settings.primaryCloud && defaultAccounts[settings.primaryCloud]) {
      primaryCloud = settings.primaryCloud;
    }
  } catch (e) {}

  return { primaryCloud, accounts: defaultAccounts };
}

function saveCloudAccountsData(accounts) {
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(cloudAccountsConfigPath, JSON.stringify(accounts, null, 2), 'utf8');
  } catch (e) {
    console.error('saveCloudAccountsData hatası:', e);
  }
}

function getPrimaryCloudId() {
  try {
    const settings = fs.existsSync(driveService.settingsPath)
      ? JSON.parse(fs.readFileSync(driveService.settingsPath, 'utf8'))
      : {};
    return settings.primaryCloud || 'google-drive';
  } catch (e) {
    return 'google-drive';
  }
}

function getActiveCloudService() {
  const primary = getPrimaryCloudId();
  if (primary === 'mega') return megaService;
  if (primary === 'dropbox') return dropboxService;
  if (primary === 'onedrive') return onedriveService;
  if (primary === 'icloud') return icloudService;
  return driveService;
}

// folderPath -> { watcher, aggregator, folderName, stats }
const activeWatchers = new Map();

function isInside(childPath, parentPath) {
  const rel = path.relative(parentPath, childPath);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function loadSavedFolderPaths() {
  if (fs.existsSync(watchedFoldersConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(watchedFoldersConfigPath, 'utf8'));
      if (Array.isArray(data)) {
        return data
          .map((p) => {
            if (typeof p === 'object' && p && p.path) {
              if (p.vault && p.password) {
                vaultService.setFolderVault(p.path, true, p.password);
              }
              return p.path;
            }
            return p;
          })
          .filter((p) => typeof p === 'string' && p.trim().length > 0);
      }
    } catch (e) {
      console.error('Kayıtlı klasörler okunamadı:', e);
    }
  }
  return [];
}

function saveSavedFolderPaths(paths) {
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const seen = new Set();
    const list = [];
    for (const p of paths) {
      const pathStr = typeof p === 'string' ? p : p?.path;
      if (!pathStr || typeof pathStr !== 'string') continue;
      const norm = path.normalize(pathStr);
      const key = norm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const isVault = vaultService.isFolderVaultEnabled(norm);
      const password = vaultService.getFolderPassword(norm);
      if (isVault && password) {
        list.push({ path: norm, vault: true, password });
      } else {
        list.push(norm);
      }
    }
    fs.writeFileSync(watchedFoldersConfigPath, JSON.stringify(list, null, 2), 'utf8');

    // Also keep local workspace config mirrored in development mode
    const templateDir = path.join(__dirname, 'config');
    if (templateDir !== configDir && fs.existsSync(templateDir)) {
      try {
        fs.writeFileSync(path.join(templateDir, 'watched-folders.json'), JSON.stringify(list, null, 2), 'utf8');
      } catch (e) {}
    }
  } catch (e) {
    console.error('Klasörler kaydedilemedi:', e);
  }
}

function getPausedFolders() {
  try {
    const settingsPath = path.join(configDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (Array.isArray(s.pausedFolders)) {
        return s.pausedFolders.map((p) => path.normalize(p).toLowerCase());
      }
    }
  } catch (e) {}
  return [];
}

function setFolderPausedState(folderPath, isPaused) {
  try {
    const settingsPath = path.join(configDir, 'settings.json');
    const s = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
    let list = Array.isArray(s.pausedFolders) ? s.pausedFolders : [];
    const norm = path.normalize(folderPath).toLowerCase();
    list = list.filter((p) => path.normalize(p).toLowerCase() !== norm);
    if (isPaused) {
      list.push(path.normalize(folderPath));
    }
    s.pausedFolders = list;
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8');
  } catch (e) {}
}

async function getFolderStats(folderPath, force = false) {
  const normalized = path.normalize(folderPath);
  if (!force && folderStatsCache.has(normalized)) {
    const cached = folderStatsCache.get(normalized);
    setTimeout(() => {
      calculateFolderStats(normalized).then((fresh) => {
        folderStatsCache.set(normalized, fresh);
        saveStatsCache();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('folders:stats-updated', {
            folderPath: normalized,
            stats: fresh,
          });
        }
      }).catch(() => {});
    }, 200);
    return cached;
  }

  const fresh = await calculateFolderStats(normalized);
  folderStatsCache.set(normalized, fresh);
  saveStatsCache();
  return fresh;
}

async function calculateFolderStats(folderPath) {
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;

  async function scan(currentDir, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      const subdirs = [];
      for (const entry of entries) {
        const name = entry.name;
        const full = path.join(currentDir, name);
        const isDir = entry.isDirectory();
        if (filterService.shouldIgnore(full, isDir).ignored) {
          continue;
        }

        if (isDir) {
          dirCount++;
          subdirs.push(full);
        } else if (entry.isFile()) {
          let stSize = 0;
          try {
            const st = await fs.promises.stat(full);
            stSize = st.size;
          } catch (e) {}

          if (filterService.shouldIgnore(full, false, stSize).ignored) {
            continue;
          }

          fileCount++;
          totalBytes += stSize;
        }
      }

      for (const sub of subdirs) {
        await scan(sub, depth + 1);
      }
    } catch (e) {}
  }

  await scan(folderPath);
  return {
    fileCount,
    dirCount,
    totalBytes,
    totalSizeStr: formatBytes(totalBytes),
  };
}

async function getAllLocalFiles(folderPath) {
  const files = [];

  async function scan(currentDir, depth = 0) {
    if (depth > 8) return;
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name;
        const full = path.join(currentDir, name);
        if (filterService.shouldIgnore(full, entry.isDirectory()).ignored) {
          continue;
        }

        if (entry.isDirectory()) {
          await scan(full, depth + 1);
        } else if (entry.isFile()) {
          let stSize = 0;
          try {
            const st = await fs.promises.stat(full);
            stSize = st.size;
          } catch (e) {}

          if (filterService.shouldIgnore(full, false, stSize).ignored) {
            continue;
          }

          files.push({
            fullPath: full,
            relativePath: path.relative(folderPath, full),
            fileName: name,
            size: stSize,
          });
        }
      }
    } catch (e) {}
  }

  await scan(folderPath);
  return files;
}

class EventAggregator {
  constructor(emitCallback, debounceMs = 250, onSilentSyncCallback = null) {
    this.emitCallback = emitCallback;
    this.onSilentSyncCallback = onSilentSyncCallback;
    this.debounceMs = debounceMs;
    this.queue = [];
    this.timer = null;
    this.recentlyAddedDirs = new Map();
    this.recentlyAddedFiles = new Map();
  }

  push(type, fullPath) {
    this.queue.push({ type, fullPath, time: Date.now() });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    const events = this.queue;
    this.queue = [];
    this.timer = null;

    if (events.length === 0) return;

    const now = Date.now();

    for (const [dir, t] of this.recentlyAddedDirs.entries()) {
      if (now - t > 5000) this.recentlyAddedDirs.delete(dir);
    }
    for (const [f, t] of this.recentlyAddedFiles.entries()) {
      if (now - t > 3000) this.recentlyAddedFiles.delete(f);
    }

    const unlinkedDirs = [];
    const addedDirs = [];

    for (const ev of events) {
      if (ev.type === 'unlinkDir') unlinkedDirs.push(ev.fullPath);
      if (ev.type === 'addDir') addedDirs.push(ev.fullPath);
    }

    const rootUnlinkedDirs = unlinkedDirs.filter(
      (d) => !unlinkedDirs.some((other) => isInside(d, other))
    );

    const rootAddedDirs = addedDirs.filter(
      (d) => !addedDirs.some((other) => isInside(d, other))
    );

    for (const d of rootAddedDirs) {
      this.recentlyAddedDirs.set(d, now);
    }

    const filtered = [];
    const seen = new Set();

    for (const ev of events) {
      const insideDeletedDir = rootUnlinkedDirs.some((rootDir) =>
        isInside(ev.fullPath, rootDir)
      );
      if (insideDeletedDir) continue;

      let insideAddedDir = rootAddedDirs.some((rootDir) =>
        isInside(ev.fullPath, rootDir)
      );
      if (!insideAddedDir) {
        for (const [recentDir] of this.recentlyAddedDirs.entries()) {
          if (isInside(ev.fullPath, recentDir)) {
            insideAddedDir = true;
            this.recentlyAddedDirs.set(recentDir, now);
            break;
          }
        }
      }
      if (insideAddedDir) {
        // Eklenen klasörün içindeki dosyalar uploadDirectory tarafından toplu/paralel olarak yükleneceği için
        // burada tek tek kuyruğa ekleyip kilitlenme veya çift yükleme yaratmıyoruz.
        continue;
      }

      filtered.push(ev);
    }

    const uniqueFiltered = [];
    const seenPaths = new Set();
    for (let i = filtered.length - 1; i >= 0; i--) {
      const ev = filtered[i];
      if (!seenPaths.has(ev.fullPath)) {
        seenPaths.add(ev.fullPath);
        uniqueFiltered.unshift(ev);
      }
    }

    for (const ev of uniqueFiltered) {
      this.emitCallback(ev.type, ev.fullPath);
    }
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
    this.recentlyAddedDirs.clear();
    this.recentlyAddedFiles.clear();
  }
}

const activeReconciles = new Set(); // Eşitlemesi devam eden ana klasör yolları

async function performStartupReconcile(folderPath, folderName, isManual = false) {
  if (!isManual) {
    try {
      const settingsPath = path.join(configDir, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (s.autoStartupReconcile === false) {
          console.log(`[Reconcile] Auto-startup reconcile disabled in settings, skipping ${folderName}`);
          return;
        }
      }
    } catch (e) {}
  }

  const primaryId = getPrimaryCloudId();
  const service = getActiveCloudService();
  if (!service || !service.isConnected || !folderPath) return;

  const normalizedPath = path.normalize(folderPath);
  activeReconciles.add(normalizedPath);
  service.clearCancelledFolder(folderName);
  const cloudNames = {
    'google-drive': 'Google Drive',
    'mega': 'Mega',
    'dropbox': 'Dropbox',
    'onedrive': 'OneDrive',
    'icloud': 'iCloud',
  };
  const cloudName = cloudNames[primaryId] || 'Bulut';

  try {
    diagnosticsService.setFolderPhase(folderName, 'comparing', `Comparing with ${cloudName}...`, {
      currentFile: `Analyzing differences with ${cloudName}...`,
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drive:sync-event', {
        action: 'info',
        folderName,
        message: `🔍 [${folderName}] Comparing with ${cloudName}...`,
        timestamp: new Date().toLocaleTimeString(),
      });
    }

    const onProgress = (progressData) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('drive:folder-progress', progressData);
      }
    };

    let res;
    if (primaryId === 'mega') {
      res = await service.reconcileWithMega(folderPath, folderName, onProgress);
    } else if (primaryId === 'dropbox') {
      res = await service.reconcileWithDropbox(folderPath, folderName, onProgress);
    } else if (primaryId === 'onedrive') {
      res = await service.reconcileWithOneDrive(folderPath, folderName, onProgress);
    } else if (primaryId === 'icloud') {
      res = await service.reconcileWithICloud(folderPath, folderName, onProgress);
    } else {
      res = await service.reconcileWithDrive(
        folderPath,
        folderName,
        (eventData) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('drive:sync-event', eventData);
          }
        },
        onProgress
      );
    }

    if (res && (res.cancelled || res.paused)) {
      return;
    }

    if (res && res.success && mainWindow && !mainWindow.isDestroyed()) {
      const diffCount = res.totalDiff !== undefined ? res.totalDiff : (res.uploadedCount || 0);
      if (diffCount > 0) {
        mainWindow.webContents.send('drive:sync-event', {
          action: 'reconciled',
          folderName,
          message: `⚡ [${folderName}] Reconciled: ${diffCount} file(s) synchronized to ${cloudName}`,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        mainWindow.webContents.send('drive:sync-event', {
          action: 'reconciled',
          folderName,
          message: `✅ [${folderName}] and ${cloudName} are completely in sync (No differences)`,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    }
  } catch (err) {
    console.error(`Reconcile error [${folderName}]:`, err.message);
  } finally {
    activeReconciles.delete(normalizedPath);
    diagnosticsService.clearFolderPhase(folderName);
  }
}

const vaultArchiveDebouncers = new Map();

function triggerVaultArchiveDebounced(folderPath, folderName) {
  if (vaultArchiveDebouncers.has(folderName)) {
    clearTimeout(vaultArchiveDebouncers.get(folderName));
  }
  const timer = setTimeout(async () => {
    vaultArchiveDebouncers.delete(folderName);
    const activeService = getActiveCloudService();
    if (!activeService || !activeService.isConnected) return;
    const pwd = vaultService.getFolderPassword(folderPath);
    if (!pwd) return;

    try {
      if (typeof activeService.syncVaultFolderArchive === 'function') {
        await activeService.syncVaultFolderArchive(
          folderPath,
          folderName,
          pwd,
          (ev) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('drive:sync-event', ev);
            }
          },
          (prog) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('drive:folder-progress', prog);
            }
          }
        );
      }
    } catch (e) {
      console.error(`[Vault] Realtime archive sync failed for ${folderName}:`, e.message);
    }
  }, 1500);

  vaultArchiveDebouncers.set(folderName, timer);
}

async function startWatchingFolder(folderPath) {
  const normalizedPath = path.normalize(folderPath);
  if (activeWatchers.has(normalizedPath)) {
    const existing = activeWatchers.get(normalizedPath);
    return { success: true, folderPath: normalizedPath, folderName: existing.folderName, stats: existing.stats };
  }

  const folderName = path.basename(normalizedPath);
  driveService.clearCancelledFolder(folderName);
  megaService.clearCancelledFolder(folderName);
  dropboxService.clearCancelledFolder(folderName);
  onedriveService.clearCancelledFolder(folderName);
  icloudService.clearCancelledFolder(folderName);
  const stats = await getFolderStats(normalizedPath);

  const activeRealtimeBatches = new Map();

  const updateRealtimeBatchProgress = (batchFolderName, curFileName, curFileSize = 0, isDone = false) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const batch = activeRealtimeBatches.get(batchFolderName);
    if (!batch) return;

    if (isDone) {
      batch.completedFiles++;
      batch.uploadedBytes += curFileSize;
    }

    const allDone = batch.completedFiles >= batch.totalFiles;
    const remaining = Math.max(0, batch.totalBytes - batch.uploadedBytes);
    const activeService = getActiveCloudService();
    const speeds = activeService && activeService.speedTracker
      ? activeService.speedTracker.getSpeeds(remaining)
      : { netSpeed: 0, diskSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

    mainWindow.webContents.send('drive:folder-progress', {
      folderName: batchFolderName,
      phase: allDone ? 'idle' : 'uploading',
      phaseText: allDone ? 'All files synced' : `Uploading: ${curFileName}`,
      current: batch.completedFiles,
      total: batch.totalFiles,
      currentFile: curFileName,
      currentBytes: batch.uploadedBytes,
      totalBytes: batch.totalBytes,
      speed: speeds.netSpeed,
      netSpeed: speeds.netSpeed,
      netSpeedMbps: speeds.netSpeedMbps,
      diskSpeed: speeds.diskSpeed,
      etaSec: speeds.etaSec,
      done: allDone,
    });

    if (allDone) {
      activeRealtimeBatches.delete(batchFolderName);
    }
  };

  const sendEvent = (type, targetPath) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!activeWatchers.has(normalizedPath)) return; // Klasör takipten kaldırılmışsa olayları yok say

    const fileName = path.basename(targetPath);
    const relativePath = path.relative(normalizedPath, targetPath);

    // Filtre kontrolü: Dışlanan bir dosya veya klasörse senkronize etme
    const filterCheck = filterService.shouldIgnore(targetPath, type === 'addDir' || type === 'unlinkDir');
    if (filterCheck.ignored) {
      if (type === 'add' || type === 'change') {
        diagnosticsService.reportExcludedFile(folderName, normalizedPath, relativePath, filterCheck.reason, filterCheck.rule);
      }
      return;
    }

    // Silinme koruması: İzlenen kök klasör diskten silinmişse bireysel silme olaylarını çalıştırma, karantinaya al!
    if (!fs.existsSync(normalizedPath)) {
      quarantineWatchedFolder(normalizedPath, folderName, 'deleted_from_disk');
      return;
    }

    let message = '';
    if (type === 'add') {
      message = `[${folderName}] (${fileName}) file added`;
    } else if (type === 'unlink') {
      message = `[${folderName}] (${fileName}) file deleted`;
    } else if (type === 'change') {
      message = `[${folderName}] (${fileName}) file updated`;
    } else if (type === 'addDir') {
      message = `[${folderName}] (${fileName}) folder added`;
    } else if (type === 'unlinkDir') {
      message = `[${folderName}] (${fileName}) folder deleted`;
    }

    mainWindow.webContents.send('watcher:event', {
      type,
      fileName,
      folderName,
      relativePath,
      fullPath: targetPath,
      message,
      timestamp: new Date().toLocaleTimeString(),
    });

    if (vaultService.isFolderVaultEnabled(normalizedPath)) {
      triggerVaultArchiveDebounced(normalizedPath, folderName);
      return;
    }

    const activeService = getActiveCloudService();
    const primaryId = getPrimaryCloudId();
    const cloudDisplayName = primaryId === 'mega' ? 'Mega' : (primaryId === 'onedrive' ? 'OneDrive' : (primaryId === 'dropbox' ? 'Dropbox' : (primaryId === 'icloud' ? 'iCloud' : 'Drive')));

    if (!activeService || !activeService.isConnected) {
      if (type === 'add' || type === 'change') {
        const fullCloudName = primaryId === 'mega' ? 'Mega (MEGA.nz)' : (primaryId === 'onedrive' ? 'Microsoft OneDrive' : (primaryId === 'dropbox' ? 'Dropbox' : (primaryId === 'icloud' ? 'Apple iCloud' : 'Google Drive')));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('drive:sync-event', {
            action: 'warning',
            fileName,
            folderName,
            message: `⚠️ [${folderName}] (${fileName}) not synced: Primary cloud "${fullCloudName}" is not signed in!`,
            timestamp: new Date().toLocaleTimeString(),
          });
        }
      }
    } else {
      if (type === 'add' || type === 'change') {
        let fSize = 0;
        try {
          fSize = fs.statSync(targetPath).size;
        } catch (e) {}

        let batch = activeRealtimeBatches.get(folderName);
        if (!batch) {
          batch = {
            totalFiles: 0,
            completedFiles: 0,
            totalBytes: 0,
            uploadedBytes: 0,
          };
          activeRealtimeBatches.set(folderName, batch);
        }
        batch.totalFiles++;
        batch.totalBytes += fSize;

        updateRealtimeBatchProgress(folderName, fileName, 0, false);

        diagnosticsService.addToQueue({
          folderName,
          folderPath: normalizedPath,
          relativePath,
          fullPath: targetPath,
          size: fSize,
        });

        activeService.enqueueTask(async () => {
          diagnosticsService.setTaskUploading(folderName, relativePath);
          let uploadPath = targetPath;
          let uploadRel = relativePath;
          let tempEncFile = null;

          try {
            if (vaultService.isFolderVaultEnabled(normalizedPath)) {
              const pwd = vaultService.getFolderPassword(normalizedPath);
              if (pwd) {
                const tempDir = path.join(app.getPath('temp'), 'squirrel-vault-temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                tempEncFile = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
                await vaultService.encryptFileToZip(targetPath, tempEncFile, pwd);
                uploadPath = tempEncFile;
                uploadRel = vaultService.getCloudVaultFileName(relativePath);
              }
            }

            const res = await activeService.uploadFile(uploadPath, uploadRel, folderName);
            updateRealtimeBatchProgress(folderName, fileName, fSize, true);
            diagnosticsService.removeFromQueue(folderName, relativePath);

            if (res && res.action !== 'skipped' && !res.failed && res.action !== 'error') {
              diagnosticsService.resolveIssue(folderName, relativePath);
              diagnosticsService.recordSynced(folderName, fileName, res.action, fSize, !!tempEncFile);
              if (mainWindow && !mainWindow.isDestroyed()) {
                const isEnc = !!tempEncFile;
                const actionText = res.action === 'created' ? `uploaded to ${cloudDisplayName}` : `updated on ${cloudDisplayName}`;
                mainWindow.webContents.send('drive:sync-event', {
                  action: res.action,
                  fileName: isEnc ? `${fileName} (🔒 Vault Encrypted)` : fileName,
                  folderName,
                  message: `☁️ [${folderName}] (${fileName})${isEnc ? ' [🔒 AES-256 Vault]' : ''} ${actionText}`,
                  timestamp: new Date().toLocaleTimeString(),
                });
              }
            } else if (res && (res.failed || res.action === 'error')) {
              diagnosticsService.reportSyncError(folderName, normalizedPath, relativePath, new Error(res.error || 'Upload error'));
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('drive:sync-event', {
                  action: 'error',
                  fileName,
                  folderName,
                  message: `⚠️ [${folderName}] (${fileName}) error during sync: ${res.error}`,
                  timestamp: new Date().toLocaleTimeString(),
                });
              }
            }
          } catch (err) {
            diagnosticsService.removeFromQueue(folderName, relativePath);
            diagnosticsService.reportSyncError(folderName, normalizedPath, relativePath, err);
            updateRealtimeBatchProgress(folderName, fileName, fSize, true);
            console.error(`${cloudDisplayName} upload task error:`, err.message);
          } finally {
            if (tempEncFile && fs.existsSync(tempEncFile)) {
              try { fs.unlinkSync(tempEncFile); } catch (e) {}
            }
          }
        }, folderName);
      } else if (type === 'unlink') {
        if (!fs.existsSync(normalizedPath)) {
          quarantineWatchedFolder(normalizedPath, folderName, 'deleted_from_disk');
          return;
        }
        activeService.enqueueTask(async () => {
          try {
            if (!fs.existsSync(normalizedPath)) {
              quarantineWatchedFolder(normalizedPath, folderName, 'deleted_from_disk');
              return;
            }
            let deleteRel = relativePath;
            if (vaultService.isFolderVaultEnabled(normalizedPath)) {
              deleteRel = vaultService.getCloudVaultFileName(relativePath);
            }
            const res = await activeService.deleteItem(deleteRel, folderName);
            if (res && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('drive:sync-event', {
                action: 'deleted',
                fileName,
                folderName,
                message: `🗑️ [${folderName}] (${fileName}) removed from ${cloudDisplayName}`,
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          } catch (err) {
            console.error(`${cloudDisplayName} delete task error:`, err.message);
          }
        }, folderName);
      } else if (type === 'addDir') {
        if (activeReconciles.has(normalizedPath)) {
          return;
        }
        activeService.enqueueTask(async () => {
          try {
            await new Promise((r) => setTimeout(r, 200));
            const res = await activeService.uploadDirectory(
              targetPath,
              relativePath,
              normalizedPath,
              folderName,
              (progressData) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('drive:folder-progress', progressData);
                }
              }
            );
            if (res && mainWindow && !mainWindow.isDestroyed()) {
              const countMsg = res.fileCount > 0 ? ` and ${res.fileCount} file(s)` : '';
              mainWindow.webContents.send('drive:sync-event', {
                action: 'created',
                fileName,
                folderName,
                message: `☁️ [${folderName}] (${fileName}) folder${countMsg} backed up to ${cloudDisplayName}`,
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          } catch (err) {
            console.error(`${cloudDisplayName} upload directory task error:`, err.message);
          }
        }, folderName);
      } else if (type === 'unlinkDir') {
        if (!fs.existsSync(normalizedPath) || !relativePath || relativePath === '.' || relativePath === '') {
          quarantineWatchedFolder(normalizedPath, folderName, 'deleted_from_disk');
          return;
        }
        activeService.enqueueTask(async () => {
          try {
            if (!fs.existsSync(normalizedPath)) {
              quarantineWatchedFolder(normalizedPath, folderName, 'deleted_from_disk');
              return;
            }
            await activeService.deleteItem(relativePath, folderName);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('drive:sync-event', {
                action: 'deleted',
                fileName,
                folderName,
                message: `🗑️ [${folderName}] (${fileName}) folder removed from ${cloudDisplayName}`,
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          } catch (err) {
            console.error(`${cloudDisplayName} delete dir task error:`, err.message);
          }
        }, folderName);
      }
    }
  };

  const aggregator = new EventAggregator(
    (type, targetPath) => {
      sendEvent(type, targetPath);
    },
    250,
    (type, targetPath) => {
      if (vaultService.isFolderVaultEnabled(normalizedPath)) {
      triggerVaultArchiveDebounced(normalizedPath, folderName);
      return;
    }

    const activeService = getActiveCloudService();
      if (activeService && activeService.isConnected) {
        const relPath = path.relative(normalizedPath, targetPath);
        activeService.enqueueTask(async () => {
          let uploadPath = targetPath;
          let uploadRel = relPath;
          let tempEnc = null;
          try {
            if (vaultService.isFolderVaultEnabled(normalizedPath)) {
              const pwd = vaultService.getFolderPassword(normalizedPath);
              if (pwd) {
                const tempDir = path.join(app.getPath('temp'), 'squirrel-vault-temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                tempEnc = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
                await vaultService.encryptFileToZip(targetPath, tempEnc, pwd);
                uploadPath = tempEnc;
                uploadRel = vaultService.getCloudVaultFileName(relPath);
              }
            }
            await activeService.uploadFile(uploadPath, uploadRel, folderName);
          } catch (e) {
            console.error('Silent sync upload error:', e.message);
          } finally {
            if (tempEnc && fs.existsSync(tempEnc)) {
              try { fs.unlinkSync(tempEnc); } catch (e) {}
            }
          }
        }, folderName);
      }
    }
  );

  const watcher = chokidar.watch(normalizedPath, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    ignored: (targetPath, stats) => {
      const isDir = stats ? (typeof stats.isDirectory === 'function' ? stats.isDirectory() : false) : false;
      const size = stats ? stats.size : null;
      return filterService.shouldIgnore(targetPath, isDir, size).ignored;
    },
  });

  watcher
    .on('add', (filePath) => aggregator.push('add', filePath))
    .on('unlink', (filePath) => aggregator.push('unlink', filePath))
    .on('change', (filePath) => aggregator.push('change', filePath))
    .on('addDir', (dirPath) => aggregator.push('addDir', dirPath))
    .on('unlinkDir', (dirPath) => aggregator.push('unlinkDir', dirPath))
    .on('error', (err) => console.error(`Watcher hatası [${folderName}]:`, err));

  activeWatchers.set(normalizedPath, {
    watcher,
    aggregator,
    folderName,
    stats,
    folderPath: normalizedPath,
  });

  // Kayıtlı klasörlere ekle ve koru (diğer klasörleri asla silme)
  const currentSaved = loadSavedFolderPaths();
  const alreadySaved = currentSaved.some(
    (p) => path.normalize(typeof p === 'string' ? p : p.path).toLowerCase() === normalizedPath.toLowerCase()
  );
  if (!alreadySaved) {
    currentSaved.push(normalizedPath);
    saveSavedFolderPaths(currentSaved);
  }

  // Birincil bulut bağlıysa başlangıç karşılaştırmasını yap
  const startupService = getActiveCloudService();
  if (startupService && startupService.isConnected) {
    performStartupReconcile(normalizedPath, folderName);
  }

  return {
    success: true,
    folderPath: normalizedPath,
    folderName,
    stats,
  };
}

async function stopWatchingFolder(folderPath, deleteFromDrive = true) {
  const normalizedPath = path.normalize(folderPath);
  let folderName = path.basename(normalizedPath);

  if (activeWatchers.has(normalizedPath)) {
    const entry = activeWatchers.get(normalizedPath);
    folderName = entry.folderName || folderName;
    if (entry.aggregator) entry.aggregator.clear();
    if (entry.watcher) {
      try {
        await entry.watcher.close();
      } catch (e) {}
    }
    activeWatchers.delete(normalizedPath);
    vaultService.setFolderVault(normalizedPath, false);
  }

  activeReconciles.delete(normalizedPath);
  diagnosticsService.clearFolderIssues(folderName);
  diagnosticsService.clearFolderPhase(folderName);
  driveService.cancelFolderSync(folderName);
  megaService.cancelFolderSync(folderName);
  dropboxService.cancelFolderSync(folderName);
  onedriveService.cancelFolderSync(folderName);
  icloudService.cancelFolderSync(folderName);

  const currentSaved = loadSavedFolderPaths().filter((p) => path.normalize(p) !== normalizedPath);
  saveSavedFolderPaths(currentSaved);

  let driveDeleted = false;
  if (deleteFromDrive) {
    const services = [
      { id: 'google-drive', name: 'Google Drive', s: driveService },
      { id: 'mega', name: 'Mega', s: megaService },
      { id: 'dropbox', name: 'Dropbox', s: dropboxService },
      { id: 'onedrive', name: 'OneDrive', s: onedriveService },
      { id: 'icloud', name: 'iCloud', s: icloudService },
    ];

    for (const item of services) {
      if (item.s && item.s.isConnected) {
        try {
          const res = await item.s.deleteFolderRoot(folderName);
          if (res && res.success) driveDeleted = true;
        } catch (err) {
          console.error(`${item.name} folder removal error [${folderName}]:`, err.message);
        }
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drive:sync-event', {
        action: 'deleted',
        fileName: folderName,
        folderName,
        message: `🗑️ [${folderName}] folder and all backups removed from cloud`,
        timestamp: new Date().toLocaleTimeString(),
      });
    }
  }

  return { success: true, folderName, driveDeleted };
}

async function quarantineWatchedFolder(folderPath, folderName, reason = 'deleted_from_disk') {
  console.log(`[Squirrel Protection] Watched folder disappeared from disk: ${folderPath}. Moving to Quarantine...`);
  
  const wasVault = vaultService.isFolderVaultEnabled(folderPath) || vaultService.isFolderVaultEnabled(folderName);
  const vaultPassword = wasVault ? (vaultService.getFolderPassword(folderPath) || vaultService.getFolderPassword(folderName)) : null;

  // 1. Stop local watcher without deleting from Drive
  await stopWatchingFolder(folderPath, false);

  // 2. Move cloud files to Squirrel/Quarantine on Google Drive
  let driveResult = null;
  if (driveService.isConnected) {
    try {
      driveResult = await driveService.quarantineFolderOnDrive(folderName);
    } catch (err) {
      console.warn(`[Quarantine] Drive quarantine move error:`, err.message);
    }
  }

  // 3. Save to local quarantine registry
  const list = loadQuarantine();
  const norm = path.normalize(folderPath).toLowerCase();
  const existingIndex = list.findIndex(item => path.normalize(item.folderPath).toLowerCase() === norm);
  const qItem = {
    id: `q-${Date.now()}`,
    folderPath: path.normalize(folderPath),
    folderName,
    quarantinedAt: new Date().toISOString(),
    reason: reason === 'deleted_from_disk' ? 'Folder was deleted from local disk' : reason,
    isVault: wasVault,
    vaultPassword: vaultPassword || undefined,
  };

  if (existingIndex >= 0) {
    list[existingIndex] = qItem;
  } else {
    list.unshift(qItem);
  }
  saveQuarantine(list);

  // 4. Send native OS Desktop Notification
  try {
    if (Notification && Notification.isSupported && Notification.isSupported()) {
      new Notification({
        title: '⚠️ Squirrel — Deletion Protection',
        body: `'${folderName}' folder was deleted from your PC! Files were safely moved to Quarantine on Google Drive.`,
        icon: path.join(__dirname, 'icon', 'icon.png'),
      }).show();
    }
  } catch (notifErr) {
    console.warn('[Quarantine] OS notification error:', notifErr.message);
  }

  // 5. Send event to UI & Sync History log
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('quarantine:alert', {
      folderPath,
      folderName,
      quarantinedAt: qItem.quarantinedAt,
      isVault: wasVault,
      totalQuarantined: list.length,
    });

    mainWindow.webContents.send('drive:sync-event', {
      action: 'quarantine',
      fileName: folderName,
      folderName,
      message: `🛡️ [${folderName}] folder was deleted locally. Backups were safely moved to Drive Quarantine.`,
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  return { success: true, item: qItem, driveResult };
}

function stopAllWatchers() {
  for (const [p, entry] of activeWatchers.entries()) {
    if (entry.aggregator) entry.aggregator.clear();
    if (entry.watcher) {
      try {
        entry.watcher.close();
      } catch (e) {}
    }
  }
  activeWatchers.clear();
}

const windowStateConfigPath = path.join(configDir, 'window-state.json');

function loadWindowState() {
  const defaultState = { width: 920, height: 560, center: true };
  try {
    if (fs.existsSync(windowStateConfigPath)) {
      // Clean up any stale window state so size never drifts across sessions
      fs.unlinkSync(windowStateConfigPath);
    }
  } catch (e) {}
  return defaultState;
}

function saveWindowState(win) {
  // Disabled: Squirrel maintains fixed 920x560 compact utility dimensions on startup
}

function createWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    title: 'Squirrel',
    width: windowState.width,
    height: windowState.height,
    center: true,
    minWidth: 780,
    minHeight: 460,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'win32') {
    try {
      mainWindow.setBackgroundMaterial('acrylic');
    } catch (e) {}
  }

  // Fix Electron Windows frameless drag mouse capture bug
  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
    }
  });
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
    }
  });

  if (process.platform === 'win32' && iconPath && fs.existsSync(iconPath)) {
    mainWindow.setIcon(iconPath);
  }

  mainWindow.loadFile('index.html');

  const isHiddenStart = process.argv.includes('--hidden') || process.argv.includes('--minimized');
  if (isHiddenStart) {
    mainWindow.hide();
  } else {
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting && shouldCloseToTray()) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    stopAllWatchers();
    mainWindow = null;
  });

  mainWindow.on('minimize', (event) => {
    if (shouldCloseToTray()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Pencere kontrol butonları (Mac Traffic Lights)
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    if (shouldCloseToTray()) {
      mainWindow.hide();
    } else {
      mainWindow.minimize();
    }
  }
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  } else {
    mainWindow.maximize();
    return true;
  }
});

ipcMain.handle('window:close', () => {
  if (!mainWindow) return;
  if (!isQuitting && shouldCloseToTray()) {
    mainWindow.hide();
  } else {
    mainWindow.close();
  }
});

// Ayarlar / CPU & Hız Önceliği IPC
ipcMain.handle('settings:get-sync-priority', () => driveService.getSyncPriority());
ipcMain.handle('settings:set-sync-priority', (_event, priority) => {
  driveService.setSyncPriority(priority);
  megaService.setSyncPriority(priority);
  dropboxService.setSyncPriority(priority);
  onedriveService.setSyncPriority(priority);
  icloudService.setSyncPriority(priority);
  return { success: true, priority };
});

ipcMain.handle('settings:get-all', () => {
  try {
    const settingsPath = path.join(configDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      data.launchOnStartup = getStartupLaunch();
      return data;
    }
  } catch (e) {}
  return {
    syncPriority: 'smart',
    primaryCloud: 'google-drive',
    autoStartupReconcile: true,
    syncNotifications: true,
    closeToTray: true,
    launchOnStartup: getStartupLaunch(),
  };
});

ipcMain.handle('settings:get-startup-launch', () => getStartupLaunch());
ipcMain.handle('settings:set-startup-launch', (_event, enable) => {
  const ok = setStartupLaunch(enable);
  const settingsPath = path.join(configDir, 'settings.json');
  try {
    const current = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
    current.launchOnStartup = !!enable;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf8');
  } catch (e) {}
  return { success: ok, enabled: !!enable };
});

ipcMain.handle('updater:check', async () => {
  return await updaterService.checkForUpdates();
});

ipcMain.handle('updater:install', async () => {
  return await updaterService.downloadAndInstall((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:download-progress', progress);
    }
  });
});

ipcMain.handle('settings:update', (_event, updates) => {
  try {
    const settingsPath = path.join(configDir, 'settings.json');
    const current = fs.existsSync(settingsPath)
      ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      : {};
    const updated = { ...current, ...updates };
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf8');
    return { success: true, settings: updated };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('shell:open-config', async () => {
  if (fs.existsSync(configDir)) {
    shell.openPath(configDir);
    return true;
  }
  return false;
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (url && typeof url === 'string') {
    shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('app:open-feedback', async () => {
  const englishBody = 'Hi%2C%0A%0AHere%20is%20my%20feedback%20regarding%20Squirrel%3A%0A%0A';
  const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=support@squirrelapp.com.tr&su=Squirrel%20v2.1%20Feedback&body=${englishBody}`;
  const mailtoUrl = `mailto:support@squirrelapp.com.tr?subject=Squirrel%20v2.1%20Feedback&body=${englishBody}`;
  try {
    await shell.openExternal(gmailComposeUrl);
    return { success: true, method: 'gmail' };
  } catch (err) {
    try {
      await shell.openExternal(mailtoUrl);
      return { success: true, method: 'mailto' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
});

// Çoklu Bulut Hesapları (Multi-Cloud Accounts) IPC
ipcMain.handle('cloud:get-accounts', () => {
  return getCloudAccountsData();
});

ipcMain.handle('cloud:set-primary', (_event, cloudId) => {
  try {
    const current = fs.existsSync(driveService.settingsPath)
      ? JSON.parse(fs.readFileSync(driveService.settingsPath, 'utf8'))
      : {};
    current.primaryCloud = cloudId;
    fs.writeFileSync(driveService.settingsPath, JSON.stringify(current, null, 2), 'utf8');
    return { success: true, primaryCloud: cloudId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('cloud:start-web-auth', async (_event, cloudId, customKey, customSecret) => {
  try {
    if (cloudId === 'google-drive') {
      const authUrl = await driveService.startAuthServer();
      shell.openExternal(authUrl);
      return { success: true, authUrl };
    } else if (cloudId === 'dropbox') {
      if (onedriveService && typeof onedriveService.closeAuthServer === 'function') onedriveService.closeAuthServer();
      const authUrl = await dropboxService.startAuthServer(customKey, customSecret);
      shell.openExternal(authUrl);
      return { success: true, authUrl };
    } else if (cloudId === 'onedrive') {
      if (dropboxService && typeof dropboxService.closeAuthServer === 'function') dropboxService.closeAuthServer();
      const authUrl = await onedriveService.startAuthServer(customKey, customSecret);
      shell.openExternal(authUrl);
      return { success: true, authUrl };
    }
    return { success: false, error: 'Web authorization is not supported for this service.' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cloud:save-dropbox-token', async (_event, token, email) => {
  return await dropboxService.saveAccessToken(token, email);
});

ipcMain.handle('cloud:save-onedrive-token', async (_event, token, email) => {
  return await onedriveService.saveAccessToken(token, email);
});

ipcMain.handle('cloud:connect-icloud', async (_event, email, customPath) => {
  return await icloudService.connect(email, customPath);
});

ipcMain.handle('cloud:login-mega', async (_event, email, password) => {
  try {
    const res = await megaService.login(email, password, true);
    if (res && res.success) {
      const currentData = getCloudAccountsData();
      if (currentData.accounts['mega']) {
        currentData.accounts['mega'].connected = true;
        currentData.accounts['mega'].email = res.email;
        currentData.accounts['mega'].lastConnected = new Date().toISOString();
        saveCloudAccountsData(currentData.accounts);
      }
      return { success: true, email: res.email };
    }
    return { success: false, error: (res && res.error) || 'Mega login failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cloud:save-account', (_event, cloudId, accountData) => {
  const currentData = getCloudAccountsData();
  if (currentData.accounts[cloudId]) {
    currentData.accounts[cloudId] = {
      ...currentData.accounts[cloudId],
      ...accountData,
      connected: true,
      lastConnected: new Date().toISOString(),
    };
    saveCloudAccountsData(currentData.accounts);
    return { success: true, account: currentData.accounts[cloudId] };
  }
  return { success: false, error: 'Bilinmeyen servis' };
});

ipcMain.handle('cloud:disconnect-account', async (_event, cloudId) => {
  if (cloudId === 'google-drive') {
    await driveService.disconnect();
  } else if (cloudId === 'mega') {
    await megaService.disconnect();
  } else if (cloudId === 'dropbox') {
    await dropboxService.disconnect();
  } else if (cloudId === 'onedrive') {
    await onedriveService.disconnect();
  } else if (cloudId === 'icloud') {
    await icloudService.disconnect();
  }
  const currentData = getCloudAccountsData();
  if (currentData.accounts[cloudId]) {
    currentData.accounts[cloudId].connected = false;
    currentData.accounts[cloudId].email = null;
    saveCloudAccountsData(currentData.accounts);

    // Eğer Primary Cloud bu ise Google Drive'a geri dön
    if (currentData.primaryCloud === cloudId) {
      try {
        const settings = fs.existsSync(driveService.settingsPath)
          ? JSON.parse(fs.readFileSync(driveService.settingsPath, 'utf8'))
          : {};
        settings.primaryCloud = 'google-drive';
        fs.writeFileSync(driveService.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      } catch (e) {}
    }

    return { success: true, cloudId };
  }
  return { success: false, error: 'Bilinmeyen servis' };
});

// Drive yetkilendirme başarılı olduğunda tüm aktif klasörleri Drive ile senkronize et
driveService.onAuthSuccess(async (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:status-change', status);

    for (const [p, entry] of activeWatchers.entries()) {
      performStartupReconcile(p, entry.folderName);
    }
  }
});

// Klasör seçim diyaloğu
ipcMain.handle('dialog:select-folder', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Folder to Watch',
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
  });

  try {
    process.chdir(originalCwd);
  } catch (e) {}

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('shell:open-folder', async (_event, folderPath) => {
  if (folderPath) {
    await shell.openPath(folderPath);
    return true;
  }
  return false;
});

// Kayıtlı klasörleri ve durumlarını döndür
ipcMain.handle('folders:get-all', async () => {
  const savedPaths = loadSavedFolderPaths();
  const pausedList = getPausedFolders();
  const list = [];

  for (const p of savedPaths) {
    const normalized = path.normalize(p);
    const exists = fs.existsSync(normalized);
    const isWatching = activeWatchers.has(normalized);
    let stats = null;
    let folderName = path.basename(normalized);

    if (isWatching) {
      stats = activeWatchers.get(normalized).stats;
    } else if (exists) {
      stats = await getFolderStats(normalized);
    }

    const isUserPaused = pausedList.includes(normalized.toLowerCase());

    list.push({
      folderPath: normalized,
      folderName,
      stats,
      isWatching: isWatching || exists,
      isPaused: isUserPaused,
      exists,
      vault: vaultService.isFolderVaultEnabled(normalized),
    });
  }

  return {
    folders: list,
    driveStatus: driveService.getStatus(),
  };
});

ipcMain.handle('folders:set-vault', async (_event, folderPath, enabled, password) => {
  try {
    const normalized = path.normalize(folderPath);
    vaultService.setFolderVault(normalized, enabled, password);
    const activePaths = Array.from(activeWatchers.keys());
    const saved = activePaths.length > 0 ? activePaths : loadSavedFolderPaths();
    if (!saved.some((p) => path.normalize(typeof p === 'string' ? p : p.path).toLowerCase() === normalized.toLowerCase())) {
      saved.push(normalized);
    }
    saveSavedFolderPaths(saved);
    return { success: true, vault: enabled };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('folders:get-vault', async (_event, folderPath) => {
  const normalized = path.normalize(folderPath);
  return {
    enabled: vaultService.isFolderVaultEnabled(normalized),
    hasPassword: !!vaultService.getFolderPassword(normalized),
  };
});

ipcMain.handle('vault:export-decryptor-tool', async () => {
  try {
    const src = path.join(__dirname, 'public', 'Squirrel-Vault-Decryptor.html');
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save Squirrel Vault Offline Decryptor Tool',
      defaultPath: 'Squirrel-Vault-Decryptor.html',
      filters: [{ name: 'HTML Web Tool', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    await fs.promises.copyFile(src, filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('folders:decrypt-to-disk', async (_event, folderPath) => {
  try {
    const normalized = path.normalize(folderPath);
    const folderName = path.basename(normalized);
    const pwd = vaultService.getFolderPassword(normalized);

    if (!pwd) {
      return { success: false, error: 'Vault password not found for this folder.' };
    }

    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: `Select Destination Folder to Extract Decrypted "${folderName}"`,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Extract Decrypted Folder Here',
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const targetDir = path.join(filePaths[0], `${folderName}-Decrypted`);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const tempDir = path.join(require('os').tmpdir(), 'squirrel-vault-temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempZip = path.join(tempDir, `${Date.now()}-decrypt.zip`);

    await vaultService.encryptFolderToZip(normalized, tempZip, pwd);
    await vaultService.decryptZipToFolder(tempZip, targetDir, pwd);

    try { fs.unlinkSync(tempZip); } catch (e) {}

    await shell.openPath(targetDir);
    return { success: true, targetDir };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ==========================================
// IPC: SILINME KORUMASI & KARANTINA
// ==========================================

ipcMain.handle('quarantine:get-all', async () => {
  return { success: true, items: loadQuarantine() };
});

ipcMain.handle('quarantine:restore', async (_event, folderPath) => {
  try {
    const list = loadQuarantine();
    const norm = path.normalize(folderPath).toLowerCase();
    const item = list.find((q) => path.normalize(q.folderPath).toLowerCase() === norm);
    if (!item) return { success: false, error: 'Quarantine item not found' };

    // Drive ve disk üzerinden geri yükle
    const res = await driveService.restoreQuarantinedFolder(
      item.folderName,
      item.folderPath,
      item.vaultPassword || vaultService.getFolderPassword(item.folderName)
    );

    if (!res.success) {
      return { success: false, error: res.reason || 'Drive üzerinden geri yüklenemedi' };
    }

    // Karantina listesinden kaldır
    const remaining = list.filter((q) => path.normalize(q.folderPath).toLowerCase() !== norm);
    saveQuarantine(remaining);

    // Vault şifresi varsa geri kaydet
    if (item.isVault && item.vaultPassword) {
      vaultService.setFolderVault(item.folderPath, true, item.vaultPassword);
    }

    // İzlemeyi tekrar başlat
    await startWatchingFolder(item.folderPath);

    return { success: true, folderPath: item.folderPath };
  } catch (err) {
    console.error('[Quarantine Restore Error]:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('quarantine:delete-permanently', async (_event, folderPath) => {
  try {
    const list = loadQuarantine();
    const norm = path.normalize(folderPath).toLowerCase();
    const item = list.find((q) => path.normalize(q.folderPath).toLowerCase() === norm);
    if (!item) return { success: false, error: 'Quarantine item not found' };

    // Google Drive'dan tamamen sil
    await driveService.permanentlyDeleteQuarantinedFolder(item.folderName);

    // Karantina listesinden kaldır
    const remaining = list.filter((q) => path.normalize(q.folderPath).toLowerCase() !== norm);
    saveQuarantine(remaining);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ==========================================
// IPC: DOSYA VERSIYONLAMA (TIME MACHINE)
// ==========================================

ipcMain.handle('versions:get-file-list', async (_event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) return { success: false, error: 'Folder not found on PC' };
    const files = [];
    const crawl = (dir, rel) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (filterService.shouldIgnore(full, entry.isDirectory()).ignored) {
          continue;
        }

        if (entry.isDirectory()) {
          crawl(full, r);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(full);
            files.push({
              relativePath: r.replace(/\\/g, '/'),
              name: entry.name,
              size: stat.size,
              modifiedTime: stat.mtime.toISOString(),
            });
          } catch (e) {}
        }
      }
    };
    crawl(folderPath, '');
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('versions:get-revisions', async (_event, folderPath, relativeFilePath) => {
  try {
    const folderName = path.basename(folderPath);
    return await driveService.getFileRevisions(folderName, relativeFilePath);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('versions:restore-revision', async (_event, folderPath, relativeFilePath, revisionId) => {
  try {
    const folderName = path.basename(folderPath);
    const targetLocalPath = path.join(folderPath, relativeFilePath);
    return await driveService.restoreFileRevision(folderName, relativeFilePath, revisionId, targetLocalPath);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ==========================================
// IPC: EXCLUSIONS & FILE FILTERS
// ==========================================

ipcMain.handle('filters:get', () => {
  return filterService.getState();
});

ipcMain.handle('filters:update', async (_event, updates) => {
  return filterService.updateState(updates);
});

ipcMain.handle('filters:add-rule', async (_event, rule) => {
  return filterService.addCustomRule(rule);
});

ipcMain.handle('filters:remove-rule', async (_event, rule) => {
  return filterService.removeCustomRule(rule);
});

ipcMain.handle('filters:test', (_event, samplePath) => {
  return filterService.testSample(samplePath);
});

// ==========================================
// IPC: SYNC DIAGNOSTICS & ISSUE INSPECTOR
// ==========================================

diagnosticsService.on('update', (diagData) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:diagnostics-update', diagData);
  }
});

// Auto-Resume and Error Cleanup when Internet Connection is Restored
let lastInternetRestoredTime = 0;
diagnosticsService.on('internet-restored', async () => {
  const now = Date.now();
  if (now - lastInternetRestoredTime < 2500) return;
  lastInternetRestoredTime = now;

  console.log('[Squirrel] 🌐 Internet connectivity restored! Cleaning offline errors and resuming sync for active folders...');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:sync-event', {
      action: 'info',
      folderName: 'System',
      message: '🌐 Internet connection restored. Automatically resuming pending cloud sync...',
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  // Iterate over active watched folders sequentially with slight delay to avoid CPU/network spikes
  for (const [folderPath, entry] of activeWatchers.entries()) {
    try {
      const normP = path.normalize(folderPath);
      if (entry && entry.folderName && !entry.isPaused) {
        // Wait up to 2 seconds if a previous reconcile is still unwinding from an abort
        let waitAttempts = 0;
        while (activeReconciles.has(normP) && waitAttempts < 10) {
          await new Promise((r) => setTimeout(r, 200));
          waitAttempts++;
        }
        if (!activeReconciles.has(normP)) {
          console.log(`[Squirrel] Auto-resuming sync for folder: ${entry.folderName}`);
          await performStartupReconcile(folderPath, entry.folderName, true).catch((e) => {
            console.warn(`[Squirrel] Auto-resume reconcile error for ${entry.folderName}:`, e.message);
          });
          await new Promise((r) => setTimeout(r, 600));
        } else {
          console.warn(`[Squirrel] Folder ${entry.folderName} still busy in reconcile, will retry on next check.`);
        }
      }
    } catch (err) {
      console.warn('[Squirrel] Failed to auto-resume folder sync:', err);
    }
  }
});

diagnosticsService.on('retry-requested', async ({ id, folderName, fullPath, relativePath }) => {
  try {
    let watchedEntry = null;
    let watchedPath = null;
    for (const [p, entry] of activeWatchers.entries()) {
      if (entry.folderName === folderName) {
        watchedPath = p;
        watchedEntry = entry;
        break;
      }
    }
    if (!watchedPath || !fs.existsSync(fullPath)) return;
    const activeService = getActiveCloudService();
    if (!activeService || !activeService.isConnected) return;

    let fSize = 0;
    try { fSize = fs.statSync(fullPath).size; } catch (e) {}

    diagnosticsService.addToQueue({
      folderName,
      folderPath: watchedPath,
      relativePath,
      fullPath,
      size: fSize,
    });

    activeService.enqueueTask(async () => {
      diagnosticsService.setTaskUploading(folderName, relativePath);
      try {
        const res = await activeService.uploadFile(fullPath, relativePath, folderName);
        diagnosticsService.removeFromQueue(folderName, relativePath);
        if (res && !res.failed && res.action !== 'error') {
          diagnosticsService.resolveIssue(folderName, relativePath);
          diagnosticsService.recordSynced(folderName, path.basename(fullPath), res.action, fSize);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('drive:sync-event', {
              action: res.action,
              fileName: path.basename(fullPath),
              folderName,
              message: `☁️ [${folderName}] (${path.basename(fullPath)}) re-synced successfully`,
              timestamp: new Date().toLocaleTimeString(),
            });
          }
        } else {
          diagnosticsService.reportSyncError(folderName, watchedPath, relativePath, new Error(res ? res.error : 'Upload error'));
        }
      } catch (e) {
        diagnosticsService.removeFromQueue(folderName, relativePath);
        diagnosticsService.reportSyncError(folderName, watchedPath, relativePath, e);
      }
    }, folderName);
  } catch (err) {
    console.error('[Diagnostics] Retry error:', err.message);
  }
});

ipcMain.handle('diagnostics:get', () => {
  return diagnosticsService.getDiagnostics();
});

ipcMain.handle('network:status-change', async (_event, isOnline) => {
  console.log(`[Squirrel] OS Network status change received from renderer: online = ${isOnline}`);
  const activeService = getActiveCloudService();
  if (!isOnline) {
    if (activeService && typeof activeService.setNetworkOnline === 'function') {
      activeService.setNetworkOnline(false);
    }
    for (const [folderPath, entry] of activeWatchers.entries()) {
      if (entry && !entry.isPaused) {
        diagnosticsService.reportSyncError(entry.folderName, folderPath, '', new Error('No internet connection (offline)'));
      }
    }
    return { success: true, status: 'offline' };
  } else {
    const verified = await diagnosticsService.checkInternetConnectivity(2000);
    if (verified) {
      if (activeService && typeof activeService.setNetworkOnline === 'function') {
        activeService.setNetworkOnline(true);
      }
      diagnosticsService.clearAllOfflineIssues();
      diagnosticsService.emit('internet-restored');
      return { success: true, status: 'online' };
    }
    return { success: false, status: 'unverified' };
  }
});

ipcMain.handle('diagnostics:check-online-resume', async () => {
  const isOnline = await diagnosticsService.checkInternetConnectivity(2000);
  if (isOnline) {
    const activeService = getActiveCloudService();
    if (activeService && typeof activeService.setNetworkOnline === 'function') {
      activeService.setNetworkOnline(true);
    }
    diagnosticsService.clearAllOfflineIssues();
    diagnosticsService.emit('internet-restored');
  }
  return { isOnline };
});

ipcMain.handle('diagnostics:retry-issue', async (_event, issueId) => {
  const issue = diagnosticsService.issues.get(issueId);
  if (!issue) return { success: false, message: 'Issue not found' };

  // If this is an offline folder issue, check connection and resume folder reconcile
  if (issue.category === 'offline') {
    const isOnline = await diagnosticsService.checkInternetConnectivity();
    if (!isOnline) {
      return { success: false, message: 'Still offline. Check your network connection.' };
    }
    diagnosticsService.clearOfflineIssue(issueId);
    let watchedPath = null;
    for (const [p, entry] of activeWatchers.entries()) {
      if (entry.folderName === issue.folderName) {
        watchedPath = p;
        break;
      }
    }
    if (watchedPath) {
      performStartupReconcile(watchedPath, issue.folderName, true).catch(() => {});
      return { success: true, message: 'Resumed sync for folder.' };
    }
    return { success: true };
  }

  if (!fs.existsSync(issue.fullPath)) {
    diagnosticsService.dismissIssue(issueId);
    return { success: false, message: 'File no longer exists on disk.' };
  }
  diagnosticsService.emit('retry-requested', {
    id: issueId,
    folderName: issue.folderName,
    fullPath: issue.fullPath,
    relativePath: issue.relativePath,
  });
  return { success: true };
});

ipcMain.handle('diagnostics:retry-all', async () => {
  const hasOffline = Array.from(diagnosticsService.issues.values()).some((i) => i.category === 'offline');
  if (hasOffline) {
    const isOnline = await diagnosticsService.checkInternetConnectivity();
    if (isOnline) {
      diagnosticsService.clearAllOfflineIssues();
      for (const [p, entry] of activeWatchers.entries()) {
        if (!entry.isPaused) {
          performStartupReconcile(p, entry.folderName, true).catch(() => {});
        }
      }
    }
  }

  const issues = Array.from(diagnosticsService.issues.values()).filter((i) => i.status === 'active' && i.category !== 'offline');
  for (const issue of issues) {
    diagnosticsService.emit('retry-requested', {
      id: issue.id,
      folderName: issue.folderName,
      fullPath: issue.fullPath,
      relativePath: issue.relativePath,
    });
  }
  return { success: true, count: issues.length };
});

ipcMain.handle('diagnostics:ignore-issue', async (_event, issueId) => {
  const issue = diagnosticsService.issues.get(issueId);
  if (!issue) return { success: false, message: 'Issue not found' };
  const ext = path.extname(issue.fileName);
  const rule = ext ? `*${ext}` : issue.fileName;
  filterService.addCustomRule(rule);
  diagnosticsService.dismissIssue(issueId);
  return { success: true, rule };
});

ipcMain.handle('diagnostics:dismiss-issue', (_event, issueId) => {
  return { success: diagnosticsService.dismissIssue(issueId) };
});

ipcMain.handle('diagnostics:clear-resolved', () => {
  return { success: true, count: diagnosticsService.clearAllResolved() };
});

ipcMain.handle('diagnostics:open-file', (_event, fullPath) => {
  if (fullPath && fs.existsSync(fullPath)) {
    shell.showItemInFolder(fullPath);
    return { success: true };
  }
  return { success: false, message: 'File not found on disk' };
});

ipcMain.handle('folders:watch', async (_event, folderPath) => {
  try {
    return await startWatchingFolder(folderPath);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('folders:unwatch', async (_event, folderPath, deleteFromDrive = true) => {
  return await stopWatchingFolder(folderPath, deleteFromDrive);
});

ipcMain.handle('folders:sync-one', async (_event, folderPath) => {
  const service = getActiveCloudService();
  const primaryId = getPrimaryCloudId();
  const cloudName = primaryId === 'mega' ? 'Mega (MEGA.nz)' : 'Google Drive';

  if (!service || !service.isConnected) {
    return { success: false, error: `${cloudName} is not connected.` };
  }
  if (!folderPath) {
    return { success: false, error: 'Invalid folder path.' };
  }

  const normalizedPath = path.normalize(folderPath);
  const folderName = path.basename(normalizedPath);

  if (activeReconciles.has(normalizedPath)) {
    return { success: true, message: 'Sync is already in progress.' };
  }

  performStartupReconcile(normalizedPath, folderName, true).catch((err) => {
    console.error(`folders:sync-one error [${folderName}]:`, err.message);
  });

  return { success: true };
});

ipcMain.handle('folders:pause-sync', async (_event, folderPath) => {
  if (!folderPath) return { success: false };
  const normalizedPath = path.normalize(folderPath);
  let folderName = path.basename(normalizedPath);
  if (!folderName) folderName = folderPath;

  setFolderPausedState(normalizedPath, true);
  driveService.pauseFolderSync(folderName);
  megaService.cancelFolderSync(folderName);
  dropboxService.cancelFolderSync(folderName);
  onedriveService.cancelFolderSync(folderName);
  icloudService.cancelFolderSync(folderName);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:folder-progress', {
      folderName,
      isUserPaused: true,
      done: false,
      speed: 0,
      netSpeed: 0,
      netSpeedMbps: 0,
      diskSpeed: 0,
      etaSec: 0,
      phase: 'paused',
      phaseText: '⏸️ Sync paused by user',
      currentFile: 'Sync paused by user',
    });
    mainWindow.webContents.send('drive:sync-event', {
      action: 'paused',
      folderName,
      message: `⏸️ [${folderName}] Sync paused by user. Progress saved for resume.`,
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  return { success: true };
});

ipcMain.handle('folders:resume-sync', async (_event, folderPath) => {
  if (!folderPath) return { success: false };
  const normalizedPath = path.normalize(folderPath);
  let folderName = path.basename(normalizedPath);
  if (!folderName) folderName = folderPath;

  setFolderPausedState(normalizedPath, false);
  driveService.resumeFolderSync(folderName);

  activeReconciles.delete(normalizedPath);
  performStartupReconcile(normalizedPath, folderName, true).catch((err) => {
    console.error(`folders:resume-sync error [${folderName}]:`, err.message);
  });

  return { success: true };
});

ipcMain.handle('drive:cancel-folder-sync', async (_event, folderPath) => {
  if (!folderPath) return { success: false };
  const normalizedPath = path.normalize(folderPath);
  let folderName = path.basename(normalizedPath);
  if (!folderName) folderName = folderPath;

  activeReconciles.delete(normalizedPath);
  diagnosticsService.clearFolderIssues(folderName);
  diagnosticsService.clearFolderPhase(folderName);
  driveService.cancelFolderSync(folderName);
  megaService.cancelFolderSync(folderName);
  dropboxService.cancelFolderSync(folderName);
  onedriveService.cancelFolderSync(folderName);
  icloudService.cancelFolderSync(folderName);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('drive:folder-progress', {
      folderName,
      current: 0,
      total: 0,
      currentFile: 'Sync stopped',
      fileName: '',
      currentBytes: 0,
      uploadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      netSpeed: 0,
      netSpeedMbps: 0,
      diskSpeed: 0,
      etaSec: 0,
      done: true,
      cancelled: true,
    });
    mainWindow.webContents.send('drive:sync-event', {
      action: 'cancelled',
      folderName,
      message: `🛑 [${folderName}] Active sync stopped by user.`,
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  return { success: true };
});

ipcMain.handle('folders:sync-all', async () => {
  const service = getActiveCloudService();
  const primaryId = getPrimaryCloudId();
  const cloudNames = {
    'google-drive': 'Google Drive',
    'mega': 'Mega',
    'dropbox': 'Dropbox',
    'onedrive': 'OneDrive',
    'icloud': 'iCloud',
  };
  const cloudName = cloudNames[primaryId] || 'Cloud';

  if (!service || !service.isConnected) {
    return { success: false, error: `${cloudName} is not connected.` };
  }

  const watched = Array.from(activeWatchers.entries());
  if (watched.length === 0) {
    return { success: true, total: 0, message: 'No monitored folders found.' };
  }

  (async () => {
    for (const [folderPath, entry] of watched) {
      try {
        await performStartupReconcile(folderPath, entry.folderName, true);
      } catch (err) {
        console.error(`folders:sync-all error [${entry.folderName}]:`, err.message);
      }
    }
  })();

  return { success: true, total: watched.length };
});

// Drive IPC Handlers
ipcMain.handle('drive:get-status', async () => driveService.getStatus());

ipcMain.handle('drive:save-credentials', async (_event, clientId, clientSecret) => {
  try {
    driveService.saveCredentials(clientId, clientSecret);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('drive:load-credentials-file', async () => {
  if (!mainWindow) return { canceled: true };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Google Cloud credentials.json File',
    filters: [{ name: 'JSON File', extensions: ['json'] }],
    properties: ['openFile'],
  });

  if (res.canceled || res.filePaths.length === 0) return { canceled: true };
  try {
    driveService.loadCredentialsFromFile(res.filePaths[0]);
    return { success: true, filePath: res.filePaths[0] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('drive:start-auth', async () => {
  try {
    const authUrl = await driveService.startAuthServer();
    shell.openExternal(authUrl);
    return { success: true, authUrl };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('drive:disconnect', async () => {
  const status = await driveService.disconnect();
  return { success: true, status };
});

app.whenReady().then(() => {
  app.setName('Squirrel');

  // 1. ANINDA PENCEREYİ VE SİSTEM TEPSİSİNİ OLUŞTUR (Kullanıcı tıkladığı an pencere ~200 ms içinde açılır!)
  createWindow();
  createTray();
  setInterval(updateTraySyncState, 600);
  updateTraySyncState();

  // 2. Arka planda paralel olarak servisleri ve izleyicileri başlat (arayüzü asla kitlemez)
  (async () => {
    try {
      // 5 bulut servisini paralel (aynı anda) başlat
      await Promise.allSettled([
        driveService.init(),
        megaService.init(),
        dropboxService.init(),
        onedriveService.init(),
        icloudService.init(),
      ]);

      const cloudData = getCloudAccountsData();
      saveCloudAccountsData(cloudData.accounts);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('drive:status-change', driveService.getStatus());
        mainWindow.webContents.send('cloud:accounts-changed');
      }

      // Kayıtlı klasörleri kontrol et ve geçerli olanları başlat
      const saved = loadSavedFolderPaths();
      const pausedList = getPausedFolders();
      const validSaved = [];
      const externallyDeleted = [];

      for (const p of saved) {
        const normalized = path.normalize(typeof p === 'string' ? p : p.path || '');
        if (!normalized) continue;
        if (!fs.existsSync(normalized)) {
          const folderName = path.basename(normalized);
          externallyDeleted.push({ folderPath: normalized, folderName });
          console.log(`[Squirrel] Deleted folder detected while app was closed: ${normalized}`);
        } else {
          validSaved.push(normalized);
        }
      }

      // Var olan klasörleri izlemeye başla (kullanıcı tarafından duraklatılmamış olanlar otomatik aktif)
      for (const p of validSaved) {
        if (!pausedList.includes(p.toLowerCase())) {
          startWatchingFolder(p).catch((e) => {
            console.error(`Automatic folder start error [${p}]:`, e);
          });
        }
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('folders:updated');
      }

      // Program kapalıyken silinen klasörleri Karantina'ya taşı ve koru
      for (const item of externallyDeleted) {
        quarantineWatchedFolder(item.folderPath, item.folderName, 'deleted_while_closed').catch((e) => {
          console.error(`Karantinaya taşıma hatası [${item.folderName}]:`, e);
        });
      }
    } catch (err) {
      console.error('[Squirrel Startup Background Init Error]:', err);
    }
  })();

  // Canlı kontrol: Uygulama açıkken bir klasör diskten silinirse anında yakala ve Karantina'ya al
  setInterval(async () => {
    for (const [folderPath, entry] of Array.from(activeWatchers.entries())) {
      if (!fs.existsSync(folderPath)) {
        console.log(`[Squirrel Protection] Watched folder disappeared from disk: ${folderPath}`);
        await quarantineWatchedFolder(folderPath, entry.folderName, 'deleted_from_disk');
      }
    }
  }, 3000);

  // Otomatik güncelleme kontrolü: Başlangıçtan 4 saniye sonra GitHub Release kontrolü yap
  setTimeout(async () => {
    try {
      const updateInfo = await updaterService.checkForUpdates();
      if (updateInfo && updateInfo.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:update-available', updateInfo);
      }
    } catch (e) {
      console.warn('[Updater] Startup check error:', e.message);
    }
  }, 4000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.center();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (!shouldCloseToTray() || isQuitting) {
    stopAllWatchers();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

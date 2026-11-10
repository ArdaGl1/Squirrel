const fs = require('fs');
const path = require('path');

class SpeedTracker {
  constructor() {
    this.diskSamples = [];
    this.netSamples = [];
    this.windowMs = 2000;
    this.smoothedNetSpeed = 0;
    this.smoothedDiskSpeed = 0;
    this.smoothedEtaSec = 0;
    this.totalUploadedBytes = 0;
    this.totalDiskBytes = 0;
    this.startTime = Date.now();
    this.lastEtaUpdate = 0;
  }

  recordDisk(bytes) {
    const now = Date.now();
    this.diskSamples.push({ t: now, bytes });
    this.totalDiskBytes += bytes;
    this.cleanup(now);
  }

  recordNet(bytes) {
    const now = Date.now();
    this.netSamples.push({ t: now, bytes });
    this.totalUploadedBytes += bytes;
    this.cleanup(now);
  }

  cleanup(now) {
    const cutoff = now - this.windowMs;
    while (this.diskSamples.length > 0 && this.diskSamples[0].t < cutoff) {
      this.diskSamples.shift();
    }
    while (this.netSamples.length > 0 && this.netSamples[0].t < cutoff) {
      this.netSamples.shift();
    }
  }

  getSpeeds(remainingBytes = 0) {
    const now = Date.now();
    this.cleanup(now);

    const totalElapsed = Math.max(0.5, (now - this.startTime) / 1000);
    const recentNetBytes = this.netSamples.reduce((sum, s) => sum + s.bytes, 0);
    const recentDiskBytes = this.diskSamples.reduce((sum, s) => sum + s.bytes, 0);
    const windowSec = Math.max(0.5, Math.min(this.windowMs / 1000, totalElapsed));

    const rawNetSpeed = recentNetBytes / windowSec;
    const rawDiskSpeed = recentDiskBytes / windowSec;

    if (this.smoothedNetSpeed === 0) {
      this.smoothedNetSpeed = rawNetSpeed;
    } else if (rawNetSpeed > this.smoothedNetSpeed) {
      this.smoothedNetSpeed = this.smoothedNetSpeed * 0.5 + rawNetSpeed * 0.5;
    } else {
      this.smoothedNetSpeed = this.smoothedNetSpeed * 0.7 + rawNetSpeed * 0.3;
    }

    if (this.smoothedDiskSpeed === 0) {
      this.smoothedDiskSpeed = rawDiskSpeed;
    } else if (rawDiskSpeed > this.smoothedDiskSpeed) {
      this.smoothedDiskSpeed = this.smoothedDiskSpeed * 0.5 + rawDiskSpeed * 0.5;
    } else {
      this.smoothedDiskSpeed = this.smoothedDiskSpeed * 0.7 + rawDiskSpeed * 0.3;
    }

    const netSpeedMbps = (this.smoothedNetSpeed * 8) / 1000000;

    if (remainingBytes > 0 && this.smoothedNetSpeed > 20000) {
      const calculatedEta = Math.round(remainingBytes / this.smoothedNetSpeed);
      if (this.smoothedEtaSec === 0 || now - this.lastEtaUpdate > 1200) {
        if (this.smoothedEtaSec === 0) {
          this.smoothedEtaSec = calculatedEta;
        } else {
          this.smoothedEtaSec = Math.round(this.smoothedEtaSec * 0.35 + calculatedEta * 0.65);
        }
        this.lastEtaUpdate = now;
      }
    } else if (remainingBytes <= 0) {
      this.smoothedEtaSec = 0;
    }

    return {
      diskSpeed: this.smoothedDiskSpeed,
      netSpeed: this.smoothedNetSpeed,
      netSpeedMbps,
      etaSec: this.smoothedEtaSec,
    };
  }

  destroy() {
    this.diskSamples = [];
    this.netSamples = [];
  }
}

class ICloudService {
  constructor(configDir) {
    this.configDir = configDir;
    this.configPath = path.join(configDir, 'icloud-config.json');
    this.settingsPath = path.join(configDir, 'settings.json');

    this.isConnected = false;
    this.userEmail = null;
    this.userName = 'Apple iCloud User';
    this.iCloudDrivePath = null;

    this.speedTracker = new SpeedTracker();
    this.syncPriority = 'turbo';

    this.queue = [];
    this.isProcessingQueue = false;
    this.cancelledFolders = new Set();
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf8');
        const data = JSON.parse(raw);
        if (data.syncPriority) {
          this.syncPriority = data.syncPriority;
        }
      }
    } catch (e) {}
  }

  getConcurrency() {
    if (this.syncPriority === 'turbo') return 16;
    if (this.syncPriority === 'eco') return 4;
    return 12;
  }

  setSyncPriority(priority) {
    if (['smart', 'turbo', 'eco'].includes(priority)) {
      this.syncPriority = priority;
    }
  }

  cancelFolderSync(folderName) {
    if (!folderName) return;
    this.cancelledFolders.add(folderName);
    this.queue = this.queue.filter((item) => {
      if (item.folderName === folderName) {
        item.resolve({ action: 'cancelled' });
        return false;
      }
      return true;
    });
    setTimeout(() => {
      this.cancelledFolders.delete(folderName);
    }, 4000);
  }

  clearCancelledFolder(folderName) {
    if (!folderName) return;
    this.cancelledFolders.delete(folderName);
  }

  getStatus() {
    return {
      connected: this.isConnected,
      email: this.userEmail,
      name: this.userName,
      cloud: 'icloud',
      drivePath: this.iCloudDrivePath,
    };
  }

  findDefaultICloudPath() {
    const home = process.env.USERPROFILE || 'C:\\Users\\' + (process.env.USERNAME || '');
    const candidates = [
      path.join(home, 'iCloudDrive'),
      path.join(home, 'iCloud Drive'),
      path.join(home, 'Apple', 'iCloudDrive'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // Varsayılan olarak standart Windows iCloud yolunu öner
    return path.join(home, 'iCloudDrive');
  }

  async init() {
    this.loadSettings();

    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.connected) {
          this.userEmail = data.email || null;
          this.userName = data.name || 'iCloud User';
          this.iCloudDrivePath = data.path || this.findDefaultICloudPath();
          this.isConnected = true;

          // Squirrel kök klasörünü hazırla
          const squirrelRoot = path.join(this.iCloudDrivePath, 'Squirrel');
          if (!fs.existsSync(squirrelRoot)) {
            try {
              fs.mkdirSync(squirrelRoot, { recursive: true });
            } catch (e) {}
          }

          console.log(`[ICloudService] iCloud Drive aktif: ${this.iCloudDrivePath} (${this.userEmail})`);
          return { success: true, email: this.userEmail };
        }
      } catch (err) {
        console.warn('[ICloudService] Config yükleme hatası:', err.message);
      }
    }

    this.isConnected = false;
    return { success: false, connected: false };
  }

  async connect(email, customPath = null) {
    this.userEmail = email || 'icloud_user@apple.com';
    this.iCloudDrivePath = customPath || this.findDefaultICloudPath();
    this.isConnected = true;

    const squirrelRoot = path.join(this.iCloudDrivePath, 'Squirrel');
    try {
      if (!fs.existsSync(squirrelRoot)) {
        fs.mkdirSync(squirrelRoot, { recursive: true });
      }
    } catch (e) {}

    try {
      if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(
          {
            connected: true,
            email: this.userEmail,
            name: this.userName,
            path: this.iCloudDrivePath,
            lastConnected: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (e) {}

    return { success: true, email: this.userEmail, path: this.iCloudDrivePath };
  }

  async disconnect() {
    this.isConnected = false;
    this.userEmail = null;
    try {
      if (fs.existsSync(this.configPath)) fs.unlinkSync(this.configPath);
    } catch (e) {}
    return { success: true };
  }

  getTargetFilePath(rootFolderName, relPath) {
    const root = path.join(this.iCloudDrivePath || this.findDefaultICloudPath(), 'Squirrel', rootFolderName);
    return path.join(root, relPath);
  }

  async uploadFile(localFullPath, relativePath, rootFolderName) {
    if (!this.isConnected) {
      return { success: false, failed: true, error: 'iCloud bağlı değil' };
    }

    if (rootFolderName && this.cancelledFolders.has(rootFolderName)) {
      return { action: 'cancelled' };
    }

    if (!fs.existsSync(localFullPath)) {
      return { success: false, action: 'skipped', reason: 'Local file does not exist' };
    }

    let stats;
    try {
      stats = await fs.promises.stat(localFullPath);
    } catch (e) {
      return { success: false, action: 'skipped', reason: e.message };
    }

    const targetFile = this.getTargetFilePath(rootFolderName, relativePath);
    const targetDir = path.dirname(targetFile);
    const fileName = path.basename(localFullPath);

    try {
      if (!fs.existsSync(targetDir)) {
        await fs.promises.mkdir(targetDir, { recursive: true });
      }

      if (fs.existsSync(targetFile)) {
        try {
          const tStat = await fs.promises.stat(targetFile);
          if (tStat.size === stats.size) {
            return {
              success: true,
              action: 'identical',
              fileName,
              size: stats.size,
            };
          }
        } catch (e) {}
      }

      await fs.promises.copyFile(localFullPath, targetFile);

      if (this.speedTracker) {
        this.speedTracker.recordDisk(stats.size);
        this.speedTracker.recordNet(stats.size);
      }

      return {
        success: true,
        action: 'created',
        fileName,
        size: stats.size,
      };
    } catch (err) {
      console.error(`[ICloudService] Kopyalama hatası [${fileName}]:`, err.message);
      return { success: false, failed: true, action: 'error', error: err.message };
    }
  }

  async runConcurrentUploads(files, rootFolderName, onFileDone = null) {
    if (!files || files.length === 0) return;
    const concurrency = Math.min(this.getConcurrency(), files.length);
    let index = 0;

    const worker = async () => {
      while (index < files.length) {
        if (this.cancelledFolders.has(rootFolderName)) break;
        const item = files[index++];
        if (!item) break;
        try {
          const res = await this.uploadFile(item.fullPath || item.full, item.relativePath || item.rel, rootFolderName);
          if (res && res.failed) {
            console.warn(`[iCloud] Dosya atlandı (${item.name || item.rel}):`, res.error);
          }
          if (onFileDone) onFileDone(item, res && res.failed ? new Error(res.error) : null);
        } catch (err) {
          console.error(`[iCloud] Dosya aktarılamadı (${item.name || item.rel}):`, err.message);
          if (onFileDone) onFileDone(item, err);
        }
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  async uploadDirectory(dirPath, relativeDir, rootPath, rootFolderName, onProgress) {
    if (!this.isConnected) return { success: false };

    const allFiles = [];
    const scanDir = (currentPath) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullChild = path.join(currentPath, entry.name);
        const relChild = path.relative(rootPath, fullChild);
        if (entry.isDirectory()) {
          scanDir(fullChild);
        } else if (entry.isFile()) {
          let size = 0;
          try { size = fs.statSync(fullChild).size; } catch (e) {}
          allFiles.push({ full: fullChild, rel: relChild, name: entry.name, size });
        }
      }
    };
    scanDir(dirPath);

    let uploaded = 0;
    let uploadedBytes = 0;
    const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);
    this.speedTracker = new SpeedTracker();

    await this.runConcurrentUploads(allFiles, rootFolderName, (fileItem, err) => {
      if (!err) {
        uploaded++;
        uploadedBytes += fileItem.size || 0;
        if (onProgress) {
          const speeds = this.speedTracker
            ? this.speedTracker.getSpeeds(Math.max(0, totalBytes - uploadedBytes))
            : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };
          const isDone = uploaded >= allFiles.length;
          onProgress({
            fileName: fileItem.name,
            currentFile: fileItem.name,
            folderName: rootFolderName,
            action: isDone ? 'completed' : 'uploading',
            current: uploaded,
            total: allFiles.length,
            currentBytes: uploadedBytes,
            uploadedBytes,
            totalBytes,
            netSpeed: speeds.netSpeed,
            diskSpeed: speeds.diskSpeed,
            netSpeedMbps: speeds.netSpeedMbps,
            speed: speeds.netSpeed,
            etaSec: speeds.etaSec,
            done: isDone,
          });
        }
      }
    });

    return { success: true, fileCount: uploaded };
  }

  async deleteItem(relativePath, rootFolderName) {
    if (!this.isConnected) return { success: false };
    const targetFile = this.getTargetFilePath(rootFolderName, relativePath);

    try {
      if (fs.existsSync(targetFile)) {
        const stats = fs.statSync(targetFile);
        if (stats.isDirectory()) {
          fs.rmSync(targetFile, { recursive: true, force: true });
        } else {
          fs.unlinkSync(targetFile);
        }
        return { success: true, action: 'deleted' };
      }
      return { success: true, action: 'not_found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async deleteFolderRoot(rootFolderName) {
    if (!this.isConnected) return { success: false };
    const rootDir = path.join(this.iCloudDrivePath || this.findDefaultICloudPath(), 'Squirrel', rootFolderName);

    try {
      if (fs.existsSync(rootDir)) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
      return { success: true };
    } catch (err) {
      console.error(`[ICloudService] Klasör silme hatası [${rootFolderName}]:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async reconcileWithICloud(folderPath, rootFolderName, onProgress) {
    if (!this.isConnected || !folderPath) {
      return { success: false, error: 'iCloud bağlı değil' };
    }

    this.clearCancelledFolder(rootFolderName);

    const localFiles = [];
    const walkLocal = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(folderPath, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          walkLocal(full);
        } else if (entry.isFile()) {
          let size = 0;
          try {
            size = fs.statSync(full).size;
          } catch (e) {}
          localFiles.push({ full, rel, name: entry.name, size });
        }
      }
    };
    walkLocal(folderPath);

    const totalFiles = localFiles.length;

    // 2. iCloud Drive üzerindeki mevcut dosyalarla karşılaştır
    const filesToUpload = [];
    let alreadySyncedBytes = 0;

    for (const lf of localFiles) {
      const targetFile = this.getTargetFilePath(rootFolderName, lf.rel);
      try {
        if (fs.existsSync(targetFile)) {
          const tStat = fs.statSync(targetFile);
          if (tStat.size === lf.size) {
            alreadySyncedBytes += lf.size;
            continue; // Birebir aynı dosya, kopyalamayı atla
          }
        }
      } catch (e) {}
      filesToUpload.push(lf);
    }

    console.log(`[ICloudService] [${rootFolderName}] Eşitleme özeti: Toplam ${totalFiles} dosya, ${totalFiles - filesToUpload.length} dosya zaten eşit, ${filesToUpload.length} dosya kopyalanacak.`);

    const totalBytesToUpload = filesToUpload.reduce((sum, f) => sum + f.size, 0);
    let uploadedCount = 0;
    let uploadedBytes = 0;

    this.speedTracker = new SpeedTracker();

    if (filesToUpload.length > 0) {
      await this.runConcurrentUploads(filesToUpload, rootFolderName, (fileItem, err) => {
        if (!err) {
          uploadedCount++;
          uploadedBytes += fileItem.size || 0;
        }
        const remainingBytes = Math.max(0, totalBytesToUpload - uploadedBytes);
        const speeds = this.speedTracker
          ? this.speedTracker.getSpeeds(remainingBytes)
          : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

        if (onProgress) {
          const currentTotalDone = (totalFiles - filesToUpload.length) + uploadedCount;
          const percent = totalFiles > 0 ? Math.round((currentTotalDone / totalFiles) * 100) : 100;
          const currentTotalBytes = alreadySyncedBytes + uploadedBytes;
          const fullTotalBytes = alreadySyncedBytes + totalBytesToUpload;
          const isDone = currentTotalDone >= totalFiles;

          onProgress({
            folderName: rootFolderName,
            current: currentTotalDone,
            total: totalFiles,
            percent,
            fileName: fileItem.name,
            currentFile: fileItem.name,
            currentBytes: currentTotalBytes,
            uploadedBytes: currentTotalBytes,
            totalBytes: fullTotalBytes,
            netSpeed: speeds.netSpeed,
            diskSpeed: speeds.diskSpeed,
            netSpeedMbps: speeds.netSpeedMbps,
            speed: speeds.netSpeed,
            etaSec: speeds.etaSec,
            done: isDone,
            action: isDone ? 'completed' : 'uploading',
          });
        }
      });
    }

    if (onProgress) {
      const fullTotalBytes = alreadySyncedBytes + totalBytesToUpload;
      onProgress({
        folderName: rootFolderName,
        current: totalFiles,
        total: totalFiles,
        percent: 100,
        fileName: '',
        currentFile: 'All files synced',
        currentBytes: fullTotalBytes,
        uploadedBytes: fullTotalBytes,
        totalBytes: fullTotalBytes,
        netSpeed: 0,
        diskSpeed: 0,
        netSpeedMbps: 0,
        speed: 0,
        etaSec: 0,
        done: true,
        action: 'completed',
      });
    }

    return { success: true, totalFiles, uploadedCount: filesToUpload.length };
  }

  enqueueTask(taskFn, folderName = null) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject, folderName });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) return;
    this.isProcessingQueue = true;

    try {
      const concurrency = this.getConcurrency();
      const worker = async () => {
        while (this.queue.length > 0) {
          const item = this.queue.shift();
          if (!item) break;
          const { taskFn, resolve, reject, folderName } = item;
          if (folderName && this.cancelledFolders.has(folderName)) {
            resolve({ action: 'cancelled' });
            continue;
          }
          try {
            const result = await taskFn();
            resolve(result);
          } catch (err) {
            console.warn('[iCloud Queue Görev Hatası]:', err.message);
            resolve({ error: err.message });
          }
        }
      };

      const workers = [];
      for (let i = 0; i < concurrency; i++) workers.push(worker());
      await Promise.all(workers);
    } finally {
      this.isProcessingQueue = false;
      if (this.queue.length > 0) this.processQueue();
    }
  }
}

module.exports = ICloudService;

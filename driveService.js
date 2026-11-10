const { drive } = require('@googleapis/drive');
const { OAuth2Client } = require('google-auth-library');
const https = require('https');
const http = require('http');
const url = require('url');
const fs = (() => {
  try {
    if (process.versions && process.versions.electron) {
      return require('original-fs');
    }
  } catch (e) {}
  return require('fs');
})();
const path = require('path');
const { Transform } = require('stream');
const filterService = require('./filterService');

// Global HTTP Keep-Alive ile bağlantıların açık tutulması (TLS handshake gecikmesini sıfırlar)
https.globalAgent.keepAlive = true;
https.globalAgent.maxSockets = 256;
https.globalAgent.maxFreeSockets = 64;
http.globalAgent.keepAlive = true;
http.globalAgent.maxSockets = 256;
http.globalAgent.maxFreeSockets = 64;

const persistentHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 120000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

const vaultService = require('./vaultService');
const diagnosticsService = require('./diagnosticsService');

// Arka planda aktarılan veriyi ölçen, EMA (Üstel Hareketli Ortalama) filtreli pürüzsüz hız ve süre hesaplayıcı
class SpeedTracker {
  constructor() {
    this.diskSamples = [];
    this.netSamples = [];
    this.windowMs = 3000; // 3 saniyelik pürüzsüz kayan pencere
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

    // Hızın yapay olarak bastırılmasını engelleyen, bant genişliğini hızla yakalayan pürüzsüz EMA
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

    // Kalan Süre (ETA): Hızlı dalgalanmaları önlemek için yumuşak güncellenir
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

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const PORT = 8585;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const _decodeOAuthStr = (b64) => Buffer.from(b64, 'base64').toString('utf8');
const DEFAULT_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || _decodeOAuthStr('ODg5OTk3OTY0MTY1LXJlN3J2MjA5dmducTh0Y2NxNmdtaDNsZ3VwYTMxMWtpLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t');
const DEFAULT_GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || _decodeOAuthStr('R09DU1BYLThrSjdtVnVHRFlkVEd3dVkzb2oyOWljVGNMMmU=');

class DriveService {
  constructor(configDir) {
    this.configDir = configDir;
    this.credentialsPath = path.join(configDir, 'credentials.json');
    this.tokensPath = path.join(configDir, 'tokens.json');
    this.cachePath = path.join(configDir, 'drive-cache.json');
    this.pendingDeletionsPath = path.join(configDir, 'pending-deletions.json');
    this.settingsPath = path.join(configDir, 'settings.json');

    this.oauth2Client = null;
    this.driveClient = null;
    this.authServer = null;

    this.isConnected = false;
    this.userEmail = null;
    this.userName = null;

    // CPU / Hız Önceliği ('smart' | 'turbo' | 'eco')
    this.syncPriority = 'smart';
    this.speedTracker = new SpeedTracker();

    // Cache: `${folderName}::${relPath}` -> driveId
    this.idCache = new Map();
    this.lastUploadedTimes = new Map(); // `${folderName}::${relPath}` -> timestamp
    this.squirrelRootId = null;
    this.squirrelRootPromise = null; // Kök "Squirrel" klasörü oluşturma promise kilidi
    this.folderRoots = new Map(); // folderName -> driveFolderId
    this.folderRootPromises = new Map(); // folderName -> Promise<driveFolderId> (Çift klasör açılmasını önleyen kilit)
    this.dirPromises = new Map(); // cacheKey -> Promise<folderId>
    this.segmentPromises = new Map(); // `${parentId}::${segment}` -> Promise<folderId> (Çift alt klasör açılmasını önleyen kilit)
    this.fileUploadPromises = new Map(); // cacheKey -> Promise<res> (Aynı dosyanın çift yüklenmesini önleyen kilit)

    this.queue = [];
    this.isProcessingQueue = false;
    this.cancelledFolders = new Set(); // Takibi durdurulan klasörlerin iptal bayrakları
    this.pausedFolders = new Set(); // Kullanıcı tarafından duraklatılan klasörlerin bayrakları
    this.activeStreams = new Map(); // folderName -> Set<Stream> (Aktif aktarım akışları)
    this.activeControllers = new Map(); // folderName -> Set<AbortController> (Aktif HTTP istekleri)
    this.isNetworkOnline = true;

    // IDM Benzeri Parçalı & Kaldığı Yerden Devam Eden Yükleme (Resumable Upload Sessions)
    this.uploadSessionsPath = path.join(configDir, 'upload-sessions.json');
    this.uploadSessions = new Map(); // `${folderName}::${relPath}` -> { sessionUri, fileSize, mtimeMs, existingFileId, parentId, uploadedBytes, updatedAt }

    this.ensureConfigDir();
    this.loadSettings();
    this.loadCache();
    this.loadUploadSessions();
  }

  loadUploadSessions() {
    try {
      if (fs.existsSync(this.uploadSessionsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.uploadSessionsPath, 'utf8'));
        const now = Date.now();
        for (const [k, v] of Object.entries(raw)) {
          // Google Drive resumable upload oturumları 7 gün geçerlidir
          if (v && v.sessionUri && now - (v.updatedAt || 0) < 6 * 86400 * 1000) {
            this.uploadSessions.set(k, v);
          }
        }
      }
    } catch (e) {
      console.warn('[Squirrel IDM] upload-sessions load error:', e.message);
    }
  }

  saveUploadSessions() {
    try {
      this.ensureConfigDir();
      const obj = {};
      for (const [k, v] of this.uploadSessions.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.uploadSessionsPath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.warn('[Squirrel IDM] upload-sessions save error:', e.message);
    }
  }

  pauseFolderSync(folderName) {
    if (!folderName) return;
    this.pausedFolders.add(folderName);
    this.cancelledFolders.delete(folderName);

    console.log(`[Squirrel] "${folderName}" sync paused by user. Active sessions preserved.`);

    // Aktif çalışan HTTP controller'ları durdur (Google Drive'daki resumable session silinmez, baytlar korunur)
    const controllers = this.activeControllers.get(folderName);
    if (controllers) {
      for (const c of controllers) {
        try { c.abort(); } catch (e) {}
      }
      controllers.clear();
    }

    const streams = this.activeStreams.get(folderName);
    if (streams) {
      for (const s of streams) {
        try {
          if (s && typeof s.destroy === 'function') s.destroy();
        } catch (e) {}
      }
      streams.clear();
    }
  }

  resumeFolderSync(folderName) {
    if (!folderName) return;
    this.pausedFolders.delete(folderName);
    this.cancelledFolders.delete(folderName);
    console.log(`[Squirrel] "${folderName}" sync resumed by user. Will continue from saved chunks.`);
  }

  cancelFolderSync(folderName) {
    if (!folderName) return;
    this.cancelledFolders.add(folderName);
    this.pausedFolders.delete(folderName);

    this.queue = this.queue.filter((item) => {
      if (item.folderName === folderName) {
        item.resolve({ action: 'cancelled' });
        return false;
      }
      return true;
    });

    const controllers = this.activeControllers.get(folderName);
    if (controllers) {
      for (const c of controllers) {
        try { c.abort(); } catch (e) {}
      }
      controllers.clear();
    }

    const streams = this.activeStreams.get(folderName);
    if (streams) {
      for (const s of streams) {
        try {
          if (s && typeof s.destroy === 'function') s.destroy();
        } catch (e) {}
      }
      streams.clear();
    }

    // İptal edilen klasörün oturumlarını temizle
    const prefix = `${folderName}::`;
    for (const k of Array.from(this.uploadSessions.keys())) {
      if (k === prefix || k.startsWith(prefix)) {
        this.uploadSessions.delete(k);
      }
    }
    this.saveUploadSessions();

    setTimeout(() => {
      this.cancelledFolders.delete(folderName);
    }, 1200);
  }

  clearCancelledFolder(folderName) {
    if (!folderName) return;
    this.cancelledFolders.delete(folderName);
  }

  clearCacheForFolder(folderName) {
    if (!folderName) return;
    const prefix = `${folderName}::`;
    for (const k of Array.from(this.idCache.keys())) {
      if (k === prefix || k.startsWith(prefix)) {
        this.idCache.delete(k);
      }
    }
    this.folderRoots.delete(folderName);
    this.saveCache();
  }

  clearCacheForPath(folderName, relPath) {
    if (!folderName) return;
    const norm = (relPath || '').replace(/\\/g, '/');
    const targetKey = norm ? `${folderName}::${norm}` : `${folderName}::`;
    for (const k of Array.from(this.idCache.keys())) {
      if (k === targetKey || k.startsWith(targetKey + '/')) {
        this.idCache.delete(k);
      }
    }
    this.saveCache();
  }

  ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      try {
        fs.mkdirSync(this.configDir, { recursive: true });
      } catch (e) {
        console.error('Config dizini oluşturulamadı:', e);
      }
    }
  }

  loadCache() {
    if (fs.existsSync(this.cachePath)) {
      try {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          this.idCache.set(k, v);
        }
      } catch (e) {
        console.error('Drive önbelleği okunamadı:', e);
      }
    }
  }

  saveCache() {
    try {
      const obj = {};
      for (const [k, v] of this.idCache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('Drive önbelleği kaydedilemedi:', e);
    }
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf8');
        const data = JSON.parse(raw);
        if (data.syncPriority) this.syncPriority = data.syncPriority;
      }
    } catch (e) {}
  }

  saveSettings() {
    try {
      this.ensureConfigDir();
      const current = fs.existsSync(this.settingsPath)
        ? JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'))
        : {};
      current.syncPriority = this.syncPriority;
      fs.writeFileSync(this.settingsPath, JSON.stringify(current, null, 2), 'utf8');
    } catch (e) {}
  }

  getSyncPriority() {
    return this.syncPriority;
  }

  setSyncPriority(priority) {
    if (['smart', 'turbo', 'eco'].includes(priority)) {
      this.syncPriority = priority;
      this.saveSettings();
      console.log(`[Squirrel] Senkronizasyon önceliği güncellendi: ${priority}`);
    }
  }

  getConcurrency() {
    if (this.syncPriority === 'turbo') return 12; // Turbo: 12 eşzamanlı dosya akışı
    if (this.syncPriority === 'eco') return 3;   // Eco: 3 eşzamanlı akış
    return 8; // 'smart': 8 eşzamanlı akış
  }

  getChunkSize(fileSize = 0) {
    // Google Drive kuralı: chunk boyutu kesinlikle 256 KB (262,144 bayt) katı olmalıdır.
    if (this.syncPriority === 'turbo') {
      if (fileSize >= 100 * 1024 * 1024) return 32 * 1024 * 1024; // 32 MB chunk (büyük dosyalarda tam hat doygunluğu)
      if (fileSize >= 25 * 1024 * 1024) return 16 * 1024 * 1024;  // 16 MB chunk
      return 8 * 1024 * 1024; // 8 MB chunk
    }
    if (this.syncPriority === 'eco') {
      return 4 * 1024 * 1024; // 4 MB chunk
    }
    // 'smart'
    if (fileSize >= 64 * 1024 * 1024) return 16 * 1024 * 1024; // 16 MB chunk
    return 8 * 1024 * 1024; // 8 MB chunk
  }

  getStreamBufferSize() {
    if (this.syncPriority === 'turbo') return 4 * 1024 * 1024; // 4 MB buffer (Maksimum disk & ağ verimi)
    if (this.syncPriority === 'eco') return 512 * 1024;  // 512 KB buffer
    return 2 * 1024 * 1024; // 2 MB buffer (Smart varsayılan)
  }

  getThrottleDelay() {
    if (this.syncPriority === 'turbo') return 0;
    if (this.syncPriority === 'eco') return 150;
    return 0; // 'smart': 0ms gecikme (Node async I/O işlemciyi yormadan tam hat kullanır)
  }

  async withRetry(fn, maxRetries = 3) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        // Fast-fail if offline or aborted: do NOT retry or sleep!
        const isOfflineOrAborted =
          !this.isNetworkOnline ||
          (err && (
            err.name === 'AbortError' ||
            err.code === 'ERR_CANCELED' ||
            err.code === 'ENOTFOUND' ||
            err.code === 'EAI_AGAIN' ||
            err.code === 'NO_INTERNET' ||
            (!this.isNetworkOnline && (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET')) ||
            (err.message && (
              err.message.toLowerCase().includes('abort') ||
              err.message.toLowerCase().includes('canceled') ||
              err.message.toLowerCase().includes('cancelled') ||
              err.message.toLowerCase().includes('enotfound') ||
              err.message.toLowerCase().includes('getaddrinfo') ||
              err.message.toLowerCase().includes('no internet') ||
              err.message.toLowerCase().includes('offline')
            ))
          ));

        if (isOfflineOrAborted) {
          throw err;
        }

        attempt++;
        if (attempt > maxRetries) throw err;
        const status = err.status || (err.response && err.response.status);
        const isRateLimit = status === 403 || status === 429 || (err.message && err.message.toLowerCase().includes('rate'));
        const delay = isRateLimit ? 1500 * Math.pow(2, attempt) : 1000 * attempt;
        console.warn(`Drive API geçici hata (${err.message}). ${delay}ms sonra tekrar deneniyor (${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // Check saved credentials and tokens on startup
  async init() {
    let clientId = DEFAULT_GOOGLE_CLIENT_ID;
    let clientSecret = DEFAULT_GOOGLE_CLIENT_SECRET;

    if (fs.existsSync(this.credentialsPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
        clientId = creds.client_id || (creds.installed && creds.installed.client_id) || clientId;
        clientSecret = creds.client_secret || (creds.installed && creds.installed.client_secret) || clientSecret;
      } catch (e) {
        console.error('Credentials read error:', e);
      }
    }

    if (clientId && clientSecret) {
      this.oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

      if (fs.existsSync(this.tokensPath)) {
        try {
          const tokens = JSON.parse(fs.readFileSync(this.tokensPath, 'utf8'));
          this.oauth2Client.setCredentials(tokens);

          this.oauth2Client.on('tokens', (newTokens) => {
            const current = fs.existsSync(this.tokensPath)
              ? JSON.parse(fs.readFileSync(this.tokensPath, 'utf8'))
              : {};
            const merged = { ...current, ...newTokens };
            fs.writeFileSync(this.tokensPath, JSON.stringify(merged, null, 2), 'utf8');
          });

          this.driveClient = drive({
            version: 'v3',
            auth: this.oauth2Client,
            httpsAgent: persistentHttpsAgent,
            agent: persistentHttpsAgent,
          });

          let about = null;
          try {
            about = await this.driveClient.about.get({ fields: 'user' });
          } catch (netErr) {
            console.warn('[DriveService] Initial about.get failed (network may still be connecting):', netErr.message);
            // If tokens are valid, keep connected status and retry in background
            if (tokens && (tokens.refresh_token || tokens.access_token)) {
              this.isConnected = true;
              setTimeout(async () => {
                try {
                  const retryAbout = await this.driveClient.about.get({ fields: 'user' });
                  if (retryAbout && retryAbout.data && retryAbout.data.user) {
                    this.userEmail = retryAbout.data.user.emailAddress;
                    this.userName = retryAbout.data.user.displayName;
                  }
                } catch (e) {}
              }, 4000);
            }
          }

          if (about && about.data && about.data.user) {
            this.isConnected = true;
            this.userEmail = about.data.user.emailAddress;
            this.userName = about.data.user.displayName;
            // Schedule non-blocking background cleanup and pending deletions
            setTimeout(async () => {
              try {
                await this.processPendingDeletions();
                await this.cleanupDuplicateFoldersAndFiles();
              } catch (e) {
                console.warn('[DriveService] Background cleanup warning:', e.message);
              }
            }, 3000);
          }
        } catch (err) {
          console.warn('Drive connection check warning:', err.message);
        }
      }
    }

    return this.getStatus();
  }

  getStatus() {
    return {
      hasCredentials: true,
      isConnected: this.isConnected,
      email: this.userEmail,
      name: this.userName,
    };
  }

  saveCredentials(clientId, clientSecret) {
    this.ensureConfigDir();
    const data = { client_id: clientId.trim(), client_secret: clientSecret.trim() };
    fs.writeFileSync(this.credentialsPath, JSON.stringify(data, null, 2), 'utf8');
    this.oauth2Client = new OAuth2Client(data.client_id, data.client_secret, REDIRECT_URI);
    return true;
  }

  loadCredentialsFromFile(sourcePath) {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(raw);
    const client = parsed.installed || parsed.web || parsed;
    const clientId = client.client_id;
    const clientSecret = client.client_secret;

    if (!clientId || !clientSecret) {
      throw new Error('Invalid credentials.json format! client_id and client_secret not found.');
    }

    return this.saveCredentials(clientId, clientSecret);
  }

  async startAuthServer() {
    if (!this.oauth2Client) {
      let clientId = DEFAULT_GOOGLE_CLIENT_ID;
      let clientSecret = DEFAULT_GOOGLE_CLIENT_SECRET;
      if (fs.existsSync(this.credentialsPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
          clientId = creds.client_id || (creds.installed && creds.installed.client_id) || clientId;
          clientSecret = creds.client_secret || (creds.installed && creds.installed.client_secret) || clientSecret;
        } catch (e) {}
      }
      this.oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
    }

    if (this.authServer) {
      try {
        this.authServer.close();
      } catch (e) {}
      this.authServer = null;
    }

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    return new Promise((resolve, reject) => {
      this.authServer = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url, true);
          if (reqUrl.pathname === '/oauth2callback') {
            const code = reqUrl.query.code;
            if (code) {
              const { tokens } = await this.oauth2Client.getToken(code);
              this.oauth2Client.setCredentials(tokens);

              fs.writeFileSync(this.tokensPath, JSON.stringify(tokens, null, 2), 'utf8');

              this.driveClient = drive({
              version: 'v3',
              auth: this.oauth2Client,
              httpsAgent: persistentHttpsAgent,
              agent: persistentHttpsAgent,
            });

              const about = await this.driveClient.about.get({ fields: 'user' });
              this.isConnected = true;
              this.userEmail = about.data.user.emailAddress;
              this.userName = about.data.user.displayName;
              await this.processPendingDeletions();
              await this.cleanupDuplicateDriveFolders();

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>Connected - Squirrel Cloud Sync</title>
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #1e293b; border: 1px solid #334155; padding: 40px; border-radius: 12px; text-align: center; max-width: 440px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                    h1 { color: #10b981; font-size: 24px; margin-bottom: 12px; }
                    p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
                    .email { color: #f97316; font-weight: 700; }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <div style="font-size: 48px; margin-bottom: 16px;">🐿️ ☁️</div>
                    <h1>Connected Successfully!</h1>
                    <p>Google Drive account (<span class="email">${this.userEmail}</span>) has been linked to Squirrel.</p>
                    <p>You can close this tab and return to the Squirrel app.</p>
                  </div>
                </body>
                </html>
              `);

              if (this.onAuthSuccessCallback) {
                this.onAuthSuccessCallback(this.getStatus());
              }

              setTimeout(() => {
                if (this.authServer) {
                  this.authServer.close();
                  this.authServer = null;
                }
              }, 1500);
            }
          }
        } catch (err) {
          console.error('OAuth callback error:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Authentication failed: ' + err.message);
        }
      });

      this.authServer.listen(PORT, () => {
        resolve(authUrl);
      });

      this.authServer.on('error', (err) => {
        reject(err);
      });
    });
  }

  onAuthSuccess(callback) {
    this.onAuthSuccessCallback = callback;
  }

  async disconnect() {
    this.isConnected = false;
    this.userEmail = null;
    this.userName = null;
    this.driveClient = null;
    this.idCache.clear();
    this.squirrelRootId = null;
    this.folderRoots.clear();

    if (fs.existsSync(this.tokensPath)) {
      try {
        fs.unlinkSync(this.tokensPath);
      } catch (e) {}
    }
    if (fs.existsSync(this.cachePath)) {
      try {
        fs.unlinkSync(this.cachePath);
      } catch (e) {}
    }

    return this.getStatus();
  }

  // Google Drive kök "Squirrel" klasörünün ID'sini al veya oluştur (Mutex promise korumalı)
  async getSquirrelRootId() {
    if (!this.isConnected || !this.driveClient) return null;
    if (this.squirrelRootId) return this.squirrelRootId;

    if (this.squirrelRootPromise) {
      return await this.squirrelRootPromise;
    }

    this.squirrelRootPromise = (async () => {
      const q = "mimeType = 'application/vnd.google-apps.folder' and name = 'Squirrel' and trashed = false and 'root' in parents";
      const res = await this.withRetry(() =>
        this.driveClient.files.list({
          q,
          fields: 'files(id, name, createdTime)',
          spaces: 'drive',
        })
      );

      let rootId;
      if (res.data.files && res.data.files.length > 0) {
        rootId = res.data.files[0].id;
        // Eğer birden fazla Squirrel klasörü oluşmuşsa ilkini koru, kopyaları çöpe at
        if (res.data.files.length > 1) {
          for (let i = 1; i < res.data.files.length; i++) {
            try {
              await this.driveClient.files.update({
                fileId: res.data.files[i].id,
                requestBody: { trashed: true },
              });
            } catch (e) {}
          }
        }
      } else {
        const createRes = await this.withRetry(() =>
          this.driveClient.files.create({
            requestBody: {
              name: 'Squirrel',
              mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id',
          })
        );
        rootId = createRes.data.id;
      }

      this.squirrelRootId = rootId;
      return rootId;
    })();

    try {
      return await this.squirrelRootPromise;
    } finally {
      this.squirrelRootPromise = null;
    }
  }

  // Belirli bir takip edilen klasörün Drive'daki kök ID'sini al (Squirrel / folderName)
  // Mutex promise kilidi ile çift klasör açılmasını 100% önler, var olan mükerrer kopyaları temizler!
  async getFolderRootId(folderName) {
    if (!this.isConnected || !this.driveClient) return null;
    if (this.folderRoots.has(folderName)) {
      const cachedId = this.folderRoots.get(folderName);
      try {
        const check = await this.withRetry(() =>
          this.driveClient.files.get({ fileId: cachedId, fields: 'id, trashed' })
        );
        if (check.data && !check.data.trashed) {
          return cachedId;
        }
      } catch (e) {
        // Önbellekteki kök klasör Drive'da silinmiş veya erişilemiyor
      }
      this.folderRoots.delete(folderName);
    }

    if (this.folderRootPromises.has(folderName)) {
      return await this.folderRootPromises.get(folderName);
    }

    const promise = (async () => {
      const rootId = await this.getSquirrelRootId();
      if (!rootId) return null;

      const escaped = folderName.replace(/'/g, "\\'");
      const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false and '${rootId}' in parents`;
      const res = await this.withRetry(() =>
        this.driveClient.files.list({
          q,
          fields: 'files(id, name, createdTime)',
          spaces: 'drive',
        })
      );

      let folderId;
      if (res.data.files && res.data.files.length > 0) {
        // En eski ana klasörü seç
        const files = res.data.files;
        files.sort((a, b) => new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime());
        folderId = files[0].id;

        // Drive'da daha önce oluşmuş mükerrer klasör kopyalarını temizle (Örn: 8 tane Packs)
        if (files.length > 1) {
          console.log(`[Squirrel] "${folderName}" için ${files.length} mükerrer klasör bulundu. Fazlalıklar Drive'dan temizleniyor...`);
          for (let i = 1; i < files.length; i++) {
            const dupId = files[i].id;
            try {
              await this.driveClient.files.update({
                fileId: dupId,
                requestBody: { trashed: true },
              });
              console.log(`[Squirrel] Mükerrer kopya çöpe taşındı (${dupId}).`);
            } catch (e) {
              console.warn('Mükerrer klasör silme uyarısı:', e.message);
            }
          }
        }
      } else {
        const createRes = await this.withRetry(() =>
          this.driveClient.files.create({
            requestBody: {
              name: folderName,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [rootId],
            },
            fields: 'id',
          })
        );
        folderId = createRes.data.id;
      }

      this.folderRoots.set(folderName, folderId);
      this.idCache.set(`${folderName}::`, folderId);
      this.saveCache();
      return folderId;
    })();

    this.folderRootPromises.set(folderName, promise);
    try {
      return await promise;
    } finally {
      this.folderRootPromises.delete(folderName);
    }
  }

  // Drive'daki tüm mükerrer klasörleri temizle
  async cleanupDuplicateDriveFolders() {
    if (!this.isConnected || !this.driveClient) return;
    try {
      const rootId = await this.getSquirrelRootId();
      if (!rootId) return;

      const res = await this.withRetry(() =>
        this.driveClient.files.list({
          q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name, createdTime)',
          pageSize: 100,
        })
      );

      if (res.data.files && res.data.files.length > 0) {
        const byName = new Map();
        for (const f of res.data.files) {
          if (!byName.has(f.name)) byName.set(f.name, []);
          byName.get(f.name).push(f);
        }

        for (const [name, list] of byName.entries()) {
          if (list.length > 1) {
            console.log(`[Squirrel] Otomatik temizlik: "${name}" için ${list.length} klasör bulundu. Fazlalıklar siliniyor...`);
            list.sort((a, b) => new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime());
            for (let i = 1; i < list.length; i++) {
              try {
                await this.driveClient.files.update({
                  fileId: list[i].id,
                  requestBody: { trashed: true },
                });
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.warn('Otomatik klasör temizleme uyarısı:', e.message);
    }
  }

  // Bir klasör altındaki göreli yolu Drive üzerinde hiyerarşik olarak oluştur/bul
  async ensureDriveDirectory(relativeDirPath, folderName, options = {}) {
    const rootId = await this.getFolderRootId(folderName);
    if (!rootId) return null;

    if (!relativeDirPath || relativeDirPath === '.' || relativeDirPath === '') {
      return rootId;
    }

    const normalized = relativeDirPath.replace(/\\/g, '/');
    const cacheKey = `${folderName}::${normalized}`;
    if (!options.forceRefresh && this.idCache.has(cacheKey)) {
      return this.idCache.get(cacheKey);
    }

    if (this.dirPromises.has(cacheKey)) {
      return await this.dirPromises.get(cacheKey);
    }

    const taskPromise = (async () => {
      const segments = normalized.split('/').filter(Boolean);
      let currentParentId = rootId;
      let currentPath = '';

      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const subKey = `${folderName}::${currentPath}`;
        if (!options.forceRefresh && this.idCache.has(subKey)) {
          currentParentId = this.idCache.get(subKey);
          continue;
        }

        const segLockKey = `${currentParentId}::${segment}`;
        if (this.segmentPromises.has(segLockKey)) {
          currentParentId = await this.segmentPromises.get(segLockKey);
          continue;
        }

        const segPromise = (async () => {
          if (!options.forceRefresh && this.idCache.has(subKey)) {
            return this.idCache.get(subKey);
          }

          const escaped = segment.replace(/'/g, "\\'");
          const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false and '${currentParentId}' in parents`;
          
          let res;
          try {
            res = await this.withRetry(() =>
              this.driveClient.files.list({
                q,
                fields: 'files(id, name, createdTime)',
              })
            );
          } catch (err) {
            if (err.message && err.message.includes('File not found')) {
              console.warn(`[Squirrel] Üst klasör Drive'da bulunamadı (${currentParentId}), önbellek yenileniyor...`);
              this.clearCacheForFolder(folderName);
              currentParentId = await this.getFolderRootId(folderName);
              const retryQ = `mimeType = 'application/vnd.google-apps.folder' and name = '${escaped}' and trashed = false and '${currentParentId}' in parents`;
              res = await this.withRetry(() =>
                this.driveClient.files.list({
                  q: retryQ,
                  fields: 'files(id, name, createdTime)',
                })
              );
            } else {
              throw err;
            }
          }

          let folderId;
          if (res.data.files && res.data.files.length > 0) {
            const list = res.data.files;
            list.sort((a, b) => new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime());
            folderId = list[0].id;
            if (list.length > 1) {
              for (let i = 1; i < list.length; i++) {
                try {
                  await this.driveClient.files.update({ fileId: list[i].id, requestBody: { trashed: true } });
                } catch (e) {}
              }
            }
          } else {
            const createRes = await this.withRetry(() =>
              this.driveClient.files.create({
                requestBody: {
                  name: segment,
                  mimeType: 'application/vnd.google-apps.folder',
                  parents: [currentParentId],
                },
                fields: 'id',
              })
            );
            folderId = createRes.data.id;
          }

          this.idCache.set(subKey, folderId);
          return folderId;
        })();

        this.segmentPromises.set(segLockKey, segPromise);
        try {
          currentParentId = await segPromise;
        } finally {
          this.segmentPromises.delete(segLockKey);
        }
      }

      this.saveCache();
      return currentParentId;
    })();

    this.dirPromises.set(cacheKey, taskPromise);
    try {
      return await taskPromise;
    } finally {
      this.dirPromises.delete(cacheKey);
    }
  }

  ensureSpeedTracker() {
    if (!this.speedTracker) {
      this.speedTracker = new SpeedTracker();
    }
    return this.speedTracker;
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.exe': 'application/x-msdownload',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flp': 'application/octet-stream',
      '.asar': 'application/octet-stream',
      '.dat': 'application/octet-stream',
    };
    return map[ext] || 'application/octet-stream';
  }

  makeHttpsRequest(targetUrl, options = {}, bodyBufferOrStream = null) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new url.URL(targetUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const reqOptions = {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          agent: persistentHttpsAgent,
          timeout: options.timeout || 60000,
        };

        const req = client.request(reqOptions, (res) => {
          const chunks = [];
          res.on('data', (d) => chunks.push(d));
          res.on('end', () => {
            const resBody = Buffer.concat(chunks).toString('utf8');
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: resBody,
            });
          });
        });

        req.on('socket', (socket) => {
          if (socket && typeof socket.setNoDelay === 'function') {
            socket.setNoDelay(true);
          }
          if (socket && typeof socket.setKeepAlive === 'function') {
            socket.setKeepAlive(true, 60000);
          }
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy(new Error(`HTTPS request timed out after ${reqOptions.timeout}ms`));
        });

        if (options.signal) {
          if (options.signal.aborted) {
            req.destroy(new Error('The operation was aborted.'));
            return;
          }
          options.signal.addEventListener('abort', () => {
            req.destroy(new Error('The operation was aborted.'));
          }, { once: true });
        }

        if (bodyBufferOrStream) {
          if (Buffer.isBuffer(bodyBufferOrStream) || typeof bodyBufferOrStream === 'string') {
            req.end(bodyBufferOrStream);
          } else if (typeof bodyBufferOrStream.pipe === 'function') {
            bodyBufferOrStream.on('error', (err) => req.destroy(err));
            bodyBufferOrStream.pipe(req);
          } else {
            req.end();
          }
        } else {
          req.end();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  async uploadResumableChunkedFile(
    fileToUpload,
    fileName,
    relativePath,
    folderName,
    parentId,
    existingFileId,
    options = {},
    abortController = null
  ) {
    let stat = null;
    try {
      stat = await fs.promises.stat(fileToUpload);
    } catch (e) {
      return { action: 'skipped_missing', fileName };
    }
    const fileSize = stat.size;

    // 0 baytlık dosyaları doğrudan oluştur / güncelle
    if (fileSize === 0) {
      if (existingFileId) {
        await this.withRetry(() =>
          this.driveClient.files.update(
            { fileId: existingFileId, media: { body: '' } },
            { signal: abortController?.signal }
          )
        );
        return { action: 'updated', fileId: existingFileId, fileName, folderName };
      } else {
        const createRes = await this.withRetry(() =>
          this.driveClient.files.create(
            {
              requestBody: { name: fileName, parents: [parentId] },
              media: { body: '' },
              fields: 'id, name',
            },
            { signal: abortController?.signal }
          )
        );
        return { action: 'created', fileId: createRes.data.id, fileName, folderName };
      }
    }

    // 5 MB'dan küçük dosyalar (kod dosyaları, vim scriptleri, config, text, küçük resimler)
    // için Google Drive Multipart yükleme (Resumable upload başlatma olmadan tek HTTP isteğinde süper hızlı yükler)
    const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
    if (fileSize < MULTIPART_THRESHOLD) {
      const mimeType = this.getMimeType(fileName);
      const media = {
        mimeType,
        body: fs.createReadStream(fileToUpload),
      };

      if (existingFileId) {
        const updateRes = await this.withRetry(() =>
          this.driveClient.files.update(
            {
              fileId: existingFileId,
              media,
              fields: 'id, name, size',
            },
            { signal: abortController?.signal }
          )
        );
        if (options.onChunk) {
          options.onChunk(fileSize, fileName);
        }
        if (this.speedTracker) {
          this.speedTracker.recordNet(fileSize);
        }
        return { action: 'updated', fileId: updateRes.data.id, fileName, folderName };
      } else {
        const createRes = await this.withRetry(() =>
          this.driveClient.files.create(
            {
              requestBody: { name: fileName, parents: [parentId] },
              media,
              fields: 'id, name, size',
            },
            { signal: abortController?.signal }
          )
        );
        if (options.onChunk) {
          options.onChunk(fileSize, fileName);
        }
        if (this.speedTracker) {
          this.speedTracker.recordNet(fileSize);
        }
        return { action: 'created', fileId: createRes.data.id, fileName, folderName };
      }
    }

    const sessionKey = `${folderName}::${relativePath.replace(/\\/g, '/')}`;
    let session = this.uploadSessions.get(sessionKey);
    let sessionUri = session ? session.sessionUri : null;
    let startByte = 0;

    // Oturum geçerliliğini kontrol et (Dosya diskte değişmişse eski oturumu çöpe at)
    if (session && sessionUri) {
      if (session.fileSize !== fileSize || Math.abs((session.mtimeMs || 0) - stat.mtimeMs) > 3000) {
        this.uploadSessions.delete(sessionKey);
        this.saveUploadSessions();
        session = null;
        sessionUri = null;
      }
    }

    // Mevcut oturum varsa Google Drive'dan kaçıncı baytta kaldığımızı sorgula (Content-Range: bytes */fileSize)
    if (session && sessionUri) {
      try {
        const qRes = await this.makeHttpsRequest(sessionUri, {
          method: 'PUT',
          headers: {
            'Content-Length': '0',
            'Content-Range': `bytes */${fileSize}`,
          },
          signal: abortController?.signal,
          timeout: 20000,
        });

        if (qRes.statusCode === 308) {
          const range = qRes.headers['range'];
          if (range) {
            const m = range.match(/bytes=0-(\d+)/);
            if (m) {
              startByte = parseInt(m[1], 10) + 1;
              console.log(`[Squirrel IDM] "${fileName}" oturumu bulundu. Kaldığı bayttan devam ediliyor: ${startByte} / ${fileSize} bytes (%${Math.round((startByte / fileSize) * 100)})`);
            }
          }
        } else if (qRes.statusCode === 200 || qRes.statusCode === 201) {
          console.log(`[Squirrel IDM] "${fileName}" önceki oturumda zaten tamamlanmış.`);
          this.uploadSessions.delete(sessionKey);
          this.saveUploadSessions();
          let fid = existingFileId;
          try {
            const p = JSON.parse(qRes.body);
            if (p && p.id) fid = p.id;
          } catch (e) {}
          return { action: existingFileId ? 'updated' : 'created', fileId: fid, fileName, folderName };
        } else {
          // Oturum Drive tarafında düşmüş (404/410 vb.)
          this.uploadSessions.delete(sessionKey);
          this.saveUploadSessions();
          sessionUri = null;
        }
      } catch (qErr) {
        if (this.pausedFolders.has(folderName)) return { action: 'paused', fileName };
        if (this.cancelledFolders.has(folderName)) return { action: 'cancelled', fileName };
        sessionUri = null;
      }
    }

    // Yeni resumable upload oturumu aç
    if (!sessionUri) {
      const mimeType = this.getMimeType(fileName);
      let authHeader = null;
      try {
        const headers = await this.oauth2Client.getRequestHeaders();
        authHeader = headers?.Authorization || headers?.authorization;
      } catch (e) {}

      if (!authHeader) {
        const tokenRes = await this.oauth2Client.getAccessToken();
        const token = typeof tokenRes === 'string' ? tokenRes : tokenRes?.token;
        if (token) authHeader = `Bearer ${token}`;
      }

      let initUrl;
      let initMethod;
      let initBody;

      if (existingFileId) {
        initUrl = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=resumable&supportsAllDrives=true`;
        initMethod = 'PATCH';
        initBody = JSON.stringify({ keepRevisionForever: true });
      } else {
        initUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true`;
        initMethod = 'POST';
        initBody = JSON.stringify({
          name: fileName,
          parents: [parentId],
        });
      }

      const initRes = await this.makeHttpsRequest(initUrl, {
        method: initMethod,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(fileSize),
        },
        signal: abortController?.signal,
        timeout: 30000,
      }, initBody);

      if (initRes.statusCode !== 200 && initRes.statusCode !== 201) {
        if (existingFileId && (initRes.statusCode === 404 || initRes.statusCode === 403)) {
          console.warn(`[Squirrel IDM] Güncellenecek dosya (${existingFileId}) bulunamadı, yeni dosya olarak yükleniyor...`);
          this.idCache.delete(`${folderName}::${relativePath.replace(/\\/g, '/')}`);
          return await this.uploadResumableChunkedFile(
            fileToUpload,
            fileName,
            relativePath,
            folderName,
            parentId,
            null,
            options,
            abortController
          );
        }
        throw new Error(`Resumable session failed (Status ${initRes.statusCode}): ${initRes.body}`);
      }

      sessionUri = initRes.headers['location'];
      if (!sessionUri) {
        throw new Error('Google Drive did not return a Location header for resumable session.');
      }

      startByte = 0;
      this.uploadSessions.set(sessionKey, {
        sessionUri,
        fileSize,
        mtimeMs: stat.mtimeMs,
        existingFileId: existingFileId || null,
        parentId,
        uploadedBytes: 0,
        updatedAt: Date.now(),
      });
      this.saveUploadSessions();
    }

    // Resumable Parçalı Gönderim Döngüsü (Her parça Google Drive'a optimize parça boyutuyla gönderilir)
    const CHUNK_SIZE = this.getChunkSize(fileSize);
    let currentOffset = startByte;
    const mimeType = this.getMimeType(fileName);

    while (currentOffset < fileSize) {
      if (this.cancelledFolders.has(folderName)) {
        this.uploadSessions.delete(sessionKey);
        this.saveUploadSessions();
        return { action: 'cancelled', fileName };
      }
      if (this.pausedFolders.has(folderName)) {
        return { action: 'paused', fileName };
      }

      const chunkEnd = Math.min(currentOffset + CHUNK_SIZE, fileSize) - 1;
      const chunkLength = (chunkEnd - currentOffset) + 1;

      let chunkRes = null;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount <= maxRetries) {
        let chunkStream = null;
        try {
          // Doğrudan diskten HTTPS soketine stream akışı (Sıfır bellek yükü + anlık gerçek hız ölçümü)
          chunkStream = fs.createReadStream(fileToUpload, {
            start: currentOffset,
            end: chunkEnd,
            highWaterMark: 1024 * 1024,
          });

          chunkStream.on('data', (buf) => {
            if (this.speedTracker) {
              this.speedTracker.recordNet(buf.length);
              this.speedTracker.recordDisk(buf.length);
            }
            if (typeof options.onChunk === 'function') {
              options.onChunk(buf.length, fileName);
            }
          });

          chunkRes = await this.makeHttpsRequest(sessionUri, {
            method: 'PUT',
            headers: {
              'Content-Length': String(chunkLength),
              'Content-Range': `bytes ${currentOffset}-${chunkEnd}/${fileSize}`,
              'Content-Type': mimeType,
            },
            signal: abortController?.signal,
            timeout: 90000,
          }, chunkStream);

          break;
        } catch (chunkErr) {
          if (chunkStream && !chunkStream.destroyed) {
            try { chunkStream.destroy(); } catch (e) {}
          }
          if (this.pausedFolders.has(folderName)) {
            return { action: 'paused', fileName };
          }
          if (this.cancelledFolders.has(folderName)) {
            return { action: 'cancelled', fileName };
          }
          retryCount++;
          if (retryCount > maxRetries) {
            throw chunkErr;
          }
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retryCount - 1)));
        }
      }

      if (chunkRes.statusCode === 308) {
        // Parça Drive tarafından kabul edildi! Sıradaki parçaya geç
        const rangeHeader = chunkRes.headers['range'];
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=0-(\d+)/);
          if (match) {
            currentOffset = parseInt(match[1], 10) + 1;
          } else {
            currentOffset = chunkEnd + 1;
          }
        } else {
          currentOffset = chunkEnd + 1;
        }

        const sess = this.uploadSessions.get(sessionKey);
        if (sess) {
          sess.uploadedBytes = currentOffset;
          sess.updatedAt = Date.now();
          this.saveUploadSessions();
        }
      } else if (chunkRes.statusCode === 200 || chunkRes.statusCode === 201) {
        // Son parça tamamlandı! Dosya yüklemesi bitti!
        let fileId = existingFileId;
        try {
          const parsed = JSON.parse(chunkRes.body);
          if (parsed && parsed.id) fileId = parsed.id;
        } catch (e) {}

        this.uploadSessions.delete(sessionKey);
        this.saveUploadSessions();

        return {
          action: existingFileId ? 'updated' : 'created',
          fileId,
          fileName,
          folderName,
        };
      } else if (chunkRes.statusCode === 404 || chunkRes.statusCode === 410) {
        console.warn(`[Squirrel IDM] Oturum süresi dolmuş (${chunkRes.statusCode}) "${fileName}", sıfırdan yeni oturum açılıyor...`);
        this.uploadSessions.delete(sessionKey);
        this.saveUploadSessions();
        return await this.uploadResumableChunkedFile(
          fileToUpload,
          fileName,
          relativePath,
          folderName,
          parentId,
          existingFileId,
          options,
          abortController
        );
      } else {
        throw new Error(`Google Drive upload failed with status ${chunkRes.statusCode}: ${chunkRes.body}`);
      }
    }

    return { action: existingFileId ? 'updated' : 'created', fileId: existingFileId, fileName, folderName };
  }

  // Dosya Yükle veya Güncelle
  async uploadFile(localFullPath, relativePath, folderName, options = {}) {
    if (!this.isNetworkOnline) {
      const err = new Error('No internet connection (offline)');
      err.code = 'ENOTFOUND';
      throw err;
    }

    if (!this.isConnected || !this.driveClient) return null;
    if (this.cancelledFolders.has(folderName)) {
      return { action: 'cancelled', fileName: path.basename(localFullPath) };
    }

    // Dosya diskte silinmiş veya bulunamıyorsa ENOENT fırlatmadan güvenle atla
    if (!fs.existsSync(localFullPath)) {
      return { action: 'skipped_missing', fileName: path.basename(localFullPath) };
    }

    // CPU / Hız Önceliğine göre throttle uygula
    const throttle = this.getThrottleDelay();
    if (throttle > 0) {
      await new Promise((r) => setTimeout(r, throttle));
    }

    // Vault Encryption Check: Is this folder or path encrypted?
    const isAlreadyVaultZip = relativePath.endsWith('.sqvault.zip');
    const vaultCfg = !isAlreadyVaultZip ? (vaultService.getVaultConfig(localFullPath) || vaultService.getVaultConfig(folderName)) : null;

    let fileToUpload = localFullPath;
    let actualRelPath = relativePath;
    let tempVaultZip = null;

    if (vaultCfg && vaultCfg.enabled && vaultCfg.password) {
      actualRelPath = vaultService.getCloudVaultFileName(relativePath);
      const tempDir = path.join(require('os').tmpdir(), 'squirrel-vault-temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      tempVaultZip = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
      await vaultService.encryptFileToZip(localFullPath, tempVaultZip, vaultCfg.password);
      fileToUpload = tempVaultZip;
    }

    const normalizedRel = actualRelPath.replace(/\\/g, '/');
    const cacheKey = `${folderName}::${normalizedRel}`;

    if (this.fileUploadPromises.has(cacheKey)) {
      return await this.fileUploadPromises.get(cacheKey);
    }

    if (!options.knownNew) {
      const now = Date.now();
      const lastTime = this.lastUploadedTimes.get(cacheKey) || 0;
      if (now - lastTime < 1500) {
        if (tempVaultZip && fs.existsSync(tempVaultZip)) {
          try { fs.unlinkSync(tempVaultZip); } catch (e) {}
        }
        return { action: 'skipped', fileName: path.basename(localFullPath) };
      }
    }

    const uploadTask = (async () => {
      this.ensureSpeedTracker();
      const parentDir = path.dirname(normalizedRel);
      const fileName = path.basename(actualRelPath);

      const abortController = new AbortController();
      if (!this.activeControllers.has(folderName)) {
        this.activeControllers.set(folderName, new Set());
      }
      this.activeControllers.get(folderName).add(abortController);

      try {
        let parentId = await this.ensureDriveDirectory(parentDir === '.' ? '' : parentDir, folderName);

        // Vault Enforcement: If this file is being uploaded as encrypted vault, ensure any plaintext version on Drive is trashed
        if (vaultCfg && vaultCfg.enabled) {
          try {
            const rawName = path.basename(relativePath);
            if (rawName !== fileName) {
              const oldRes = await this.withRetry(() =>
                this.driveClient.files.list(
                  {
                    q: `name = '${rawName.replace(/'/g, "\\'")}' and trashed = false and '${parentId}' in parents and mimeType != 'application/vnd.google-apps.folder'`,
                    fields: 'files(id, name)',
                  },
                  { signal: abortController.signal, timeout: 35000 }
                )
              );
              for (const oldF of oldRes.data.files || []) {
                try {
                  await this.driveClient.files.update(
                    { fileId: oldF.id, requestBody: { trashed: true } },
                    { signal: abortController.signal, timeout: 35000 }
                  );
                  this.idCache.delete(`${folderName}::${relativePath}`);
                } catch (e) {}
              }
            }
          } catch (e) {}
        }

        let existingFileId = options.knownNew ? null : this.idCache.get(cacheKey);

        if (!existingFileId && !options.knownNew) {
          const q = `name = '${fileName.replace(/'/g, "\\'")}' and trashed = false and '${parentId}' in parents and mimeType != 'application/vnd.google-apps.folder'`;
          const res = await this.withRetry(() =>
            this.driveClient.files.list(
              {
                q,
                fields: 'files(id, name, size, createdTime)',
              },
              { signal: abortController.signal, timeout: 35000 }
            )
          );
          if (res.data.files && res.data.files.length > 0) {
            const list = res.data.files;
            list.sort((a, b) => {
              const sA = parseInt(a.size || '0', 10);
              const sB = parseInt(b.size || '0', 10);
              if (sA !== sB) return sB - sA;
              return new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime();
            });
            existingFileId = list[0].id;
            if (list.length > 1) {
              for (let i = 1; i < list.length; i++) {
                try {
                  await this.driveClient.files.update(
                    { fileId: list[i].id, requestBody: { trashed: true } },
                    { signal: abortController.signal, timeout: 35000 }
                  );
                } catch (e) {}
              }
            }
          }
        }

        const uploadRes = await this.uploadResumableChunkedFile(
          fileToUpload,
          fileName,
          relativePath,
          folderName,
          parentId,
          existingFileId,
          options,
          abortController
        );

        if (uploadRes && (uploadRes.action === 'paused' || uploadRes.action === 'cancelled')) {
          return uploadRes;
        }

        const finalFileId = uploadRes.fileId || existingFileId;
        if (finalFileId) {
          this.idCache.set(cacheKey, finalFileId);
          this.lastUploadedTimes.set(cacheKey, Date.now());
          this.saveCache();
        }
        diagnosticsService.resolveIssue(folderName, relativePath);
        return uploadRes;
      } catch (err) {
        if (this.pausedFolders.has(folderName)) {
          return { action: 'paused', fileName };
        }
        if (this.cancelledFolders.has(folderName)) {
          return { action: 'cancelled', fileName };
        }
        const isAbort = err.name === 'AbortError' || (err.message && err.message.includes('aborted'));
        if (isAbort && (this.pausedFolders.has(folderName) || this.cancelledFolders.has(folderName))) {
          return { action: 'paused', fileName };
        }

        const isOffline =
          !this.isNetworkOnline ||
          (err && (
            err.code === 'ENOTFOUND' ||
            err.code === 'EAI_AGAIN' ||
            err.code === 'ENETUNREACH' ||
            err.code === 'EHOSTUNREACH' ||
            err.code === 'NO_INTERNET' ||
            (err.message && (
              err.message.toLowerCase().includes('enotfound') ||
              err.message.toLowerCase().includes('getaddrinfo') ||
              err.message.toLowerCase().includes('err_internet_disconnected')
            ))
          ));

        if (isOffline) {
          const offlineErr = new Error('No internet connection (offline)');
          offlineErr.code = 'ENOTFOUND';
          diagnosticsService.reportSyncError(folderName, localFullPath, relativePath, offlineErr);
          return { action: 'error', failed: true, isOffline: true, fileName, error: offlineErr.message };
        }
        console.error(`[Squirrel] "${fileName}" yüklenemedi:`, err.message);
        diagnosticsService.reportSyncError(folderName, localFullPath, relativePath, err);
        return { action: 'error', failed: true, fileName, error: err.message };
      } finally {
        if (this.activeControllers.has(folderName)) {
          this.activeControllers.get(folderName).delete(abortController);
        }
      }
    })();

    this.fileUploadPromises.set(cacheKey, uploadTask);
    try {
      return await uploadTask;
    } finally {
      this.fileUploadPromises.delete(cacheKey);
      if (tempVaultZip && fs.existsSync(tempVaultZip)) {
        try { fs.unlinkSync(tempVaultZip); } catch (e) {}
      }
    }
  }

  // Klasör Oluştur
  async createDirectory(relativeDirPath, folderName) {
    if (!this.isConnected || !this.driveClient) return null;
    return this.ensureDriveDirectory(relativeDirPath, folderName);
  }

  // Bir klasördeki dosyaları eşzamanlı (concurrency havuzu ile) tam hızda yükle
  async runConcurrentUploads(files, folderName, onFileDone = null, options = {}) {
    if (!files || files.length === 0) return;
    const concurrency = Math.min(this.getConcurrency(), files.length);
    let index = 0;
    let isOfflineAborted = false;

    const worker = async () => {
      while (index < files.length) {
        if (this.cancelledFolders.has(folderName) || this.pausedFolders.has(folderName) || isOfflineAborted) break;
        const item = files[index++];
        if (!item) break;
        try {
          const res = await this.uploadFile(item.fullPath || item.full, item.relativePath || item.rel, folderName, options);
          if (this.cancelledFolders.has(folderName) || this.pausedFolders.has(folderName)) break;
          if (res && (res.action === 'paused' || res.action === 'cancelled')) break;
          if (res && (res.failed || res.action === 'error')) {
            const uploadErr = new Error(res.error || 'Upload error');
            if (res.isOffline) {
              uploadErr.code = 'ENOTFOUND';
            }
            throw uploadErr;
          }
          diagnosticsService.resolveIssue(folderName, item.relativePath || item.rel);
          if (onFileDone) {
            onFileDone(item, null);
          }
        } catch (err) {
          if (this.cancelledFolders.has(folderName) || this.pausedFolders.has(folderName)) break;
          const isAbort = err.name === 'AbortError' || (err.message && err.message.includes('aborted'));
          if (isAbort && (this.pausedFolders.has(folderName) || this.cancelledFolders.has(folderName))) {
            break;
          }
          console.error(`[Squirrel] Dosya yükleme hatası (${item.name}):`, err.message);
          const classification = diagnosticsService.categorizeError(err);
          if (classification.category === 'offline' || !this.isNetworkOnline) {
            isOfflineAborted = true;
          }
          const folderPath = options.localRootPath || (item.fullPath ? path.dirname(item.fullPath) : '');
          diagnosticsService.reportSyncError(folderName, folderPath, item.relativePath || item.rel, err);
          if (onFileDone) {
            onFileDone(item, err);
          }
          if (isOfflineAborted) {
            break;
          }
        }
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  // Klasörü ve içindeki tüm dosyaları klasör klasör (önce bir klasör ve tüm dosyaları, sonra alt klasörler)
  // paralel ve tam bant genişliği ile yükle, anlık ilerleme raporla
  async uploadDirectory(localDirPath, relativeDirPath, baseRootPath, folderName, onProgress = null) {
    if (!this.isConnected || !this.driveClient) return null;

    // 1. Önce yerel klasördeki tüm alt klasörleri ve dosyaları tara
    const dirToFiles = new Map();
    const sortedDirs = [];
    let totalFilesToUpload = 0;
    let totalBytesToUpload = 0;

    const scanLocal = async (currentDir, currentRel) => {
      sortedDirs.push({ full: currentDir, rel: currentRel });
      dirToFiles.set(currentRel, []);

      let entries = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch (e) {
        return;
      }

      const subDirs = [];
      for (const entry of entries) {
        const name = entry.name;
        const full = path.join(currentDir, name);
        if (filterService.shouldIgnore(full, entry.isDirectory()).ignored) {
          continue;
        }

        const rel = currentRel ? `${currentRel}/${name}` : name;
        if (entry.isDirectory()) {
          subDirs.push({ full, rel });
        } else if (entry.isFile()) {
          let size = 0;
          try {
            const st = await fs.promises.stat(full);
            size = st.size;
          } catch (e) {}

          if (filterService.shouldIgnore(full, false, size).ignored) {
            continue;
          }

          dirToFiles.get(currentRel).push({ full, rel, name, size });
          totalFilesToUpload++;
          totalBytesToUpload += size;
        }
      }

      for (const sub of subDirs) {
        await scanLocal(sub.full, sub.rel);
      }
    };

    const startRel = (relativeDirPath || '').replace(/\\/g, '/');
    await scanLocal(localDirPath, startRel);

    const startTime = Date.now();
    let uploadedCount = 0;
    let uploadedBytes = 0;

    // Anlık ilk ilerleme bildirimi (kartta hemen bar ve durum belirsin)
    if (onProgress) {
      onProgress({
        folderName,
        current: 0,
        total: totalFilesToUpload,
        currentFile: path.basename(localDirPath),
        currentBytes: 0,
        totalBytes: totalBytesToUpload,
        speed: 0,
        etaSec: 0,
        done: totalFilesToUpload === 0,
      });
    }

    const allFilesToUpload = [];
    for (const dirObj of sortedDirs) {
      const filesInDir = dirToFiles.get(dirObj.rel) || [];
      for (const f of filesInDir) {
        allFilesToUpload.push(f);
      }
    }

    this.speedTracker = new SpeedTracker();

    // 2. Klasör hiyerarşisine göre tüm dosyaları kesintisiz eşzamanlı havuzda yükle
    if (allFilesToUpload.length > 0) {
      let lastProgressEmitTime = 0;
      let currentDisplayFile = '';
      let lastDisplayFileSwitchTime = 0;
      const streamedBytesMap = new Map();

      const getDisplayFileName = (incomingName) => {
        const activeKeys = Array.from(streamedBytesMap.keys());
        const now = Date.now();
        if (currentDisplayFile && streamedBytesMap.has(currentDisplayFile) && now - lastDisplayFileSwitchTime < 2500) {
          // Keep current active file for at least 2.5s to prevent rapid flickering
        } else {
          currentDisplayFile = incomingName || (activeKeys[0] || '');
          lastDisplayFileSwitchTime = now;
        }

        const extraCount = Math.max(0, activeKeys.length - 1);
        if (extraCount > 0) {
          return `${currentDisplayFile} (+${extraCount} in parallel)`;
        }
        return currentDisplayFile;
      };

      const handleChunk = (chunkLen, currentFileName) => {
        streamedBytesMap.set(currentFileName, (streamedBytesMap.get(currentFileName) || 0) + chunkLen);
        const now = Date.now();
        if (now - lastProgressEmitTime < 350) return;
        lastProgressEmitTime = now;

        let inFlightBytes = 0;
        for (const b of streamedBytesMap.values()) inFlightBytes += b;
        const currentTotalBytes = Math.min(totalBytesToUpload, uploadedBytes + inFlightBytes);
        const remainingBytes = Math.max(0, totalBytesToUpload - currentTotalBytes);
        const speeds = this.speedTracker
          ? this.speedTracker.getSpeeds(remainingBytes)
          : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

        const displayFileName = getDisplayFileName(currentFileName);

        if (onProgress) {
          onProgress({
            folderName,
            current: uploadedCount,
            total: totalFilesToUpload,
            currentFile: displayFileName,
            currentBytes: currentTotalBytes,
            totalBytes: totalBytesToUpload,
            speed: speeds.netSpeed,
            netSpeed: speeds.netSpeed,
            netSpeedMbps: speeds.netSpeedMbps,
            diskSpeed: speeds.diskSpeed,
            etaSec: speeds.etaSec,
            done: false,
          });
        }
      };

      await this.runConcurrentUploads(
        allFilesToUpload,
        folderName,
        (item, err) => {
          streamedBytesMap.delete(item.name);
          if (err) {
            console.error(`[Squirrel] Dosya aktarılamadı (${item.name}):`, err.message);
            diagnosticsService.reportSyncError(folderName, localDirPath, item.relativePath || item.rel, err);
            uploadedCount++;
          } else {
            uploadedCount++;
            uploadedBytes += item.size || 0;
            diagnosticsService.resolveIssue(folderName, item.relativePath || item.rel);
            diagnosticsService.recordSynced(folderName, item.name, 'uploaded', item.size || 0);
          }

          let inFlightBytes = 0;
          for (const b of streamedBytesMap.values()) inFlightBytes += b;
          const currentTotalBytes = Math.min(totalBytesToUpload, uploadedBytes + inFlightBytes);
          const remainingBytes = Math.max(0, totalBytesToUpload - currentTotalBytes);
          const speeds = this.speedTracker ? this.speedTracker.getSpeeds(remainingBytes) : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };
          const etaSec = speeds.etaSec;

          if (onProgress) {
            onProgress({
              folderName,
              current: uploadedCount,
              total: totalFilesToUpload,
              currentFile: item.name,
              currentBytes: currentTotalBytes,
              totalBytes: totalBytesToUpload,
              speed: speeds.netSpeed,
              netSpeed: speeds.netSpeed,
              netSpeedMbps: speeds.netSpeedMbps,
              diskSpeed: speeds.diskSpeed,
              etaSec,
              done: uploadedCount >= totalFilesToUpload,
            });
          }
        },
        { knownNew: true, localRootPath: localDirPath, onChunk: handleChunk }
      );
    }

    if (this.speedTracker) {
      this.speedTracker.destroy();
      this.speedTracker = null;
    }

    if (!this.isNetworkOnline) {
      if (onProgress) {
        onProgress({
          folderName,
          phase: 'offline',
          phaseText: '⏸️ Sync paused • Waiting for internet...',
          currentFile: 'Sync paused • Waiting for internet...',
          isOfflinePaused: true,
          speed: 0,
          netSpeed: 0,
          netSpeedMbps: 0,
          diskSpeed: 0,
          etaSec: 0,
          done: false,
        });
      }
      return { action: 'paused_offline', folderName };
    }

    if (onProgress) {
      onProgress({
        folderName,
        current: totalFilesToUpload,
        total: totalFilesToUpload,
        currentFile: 'Completed',
        currentBytes: totalBytesToUpload,
        totalBytes: totalBytesToUpload,
        speed: totalBytesToUpload / Math.max(0.1, (Date.now() - startTime) / 1000),
        etaSec: 0,
        done: true,
      });
    }

    return {
      action: 'directory_uploaded',
      dirName: path.basename(localDirPath),
      fileCount: uploadedCount,
      folderName,
    };
  }

  // Dosya veya Klasörü Sil (Çöpe At)
  async deleteItem(relativePath, folderName) {
    if (!this.isConnected || !this.driveClient) return null;

    const normalizedRel = relativePath.replace(/\\/g, '/');
    const cacheKey = `${folderName}::${normalizedRel}`;
    let fileId = this.idCache.get(cacheKey);

    const fileName = path.basename(normalizedRel);
    const parentDir = path.dirname(normalizedRel);

    try {
      if (!fileId) {
        const parentId = await this.ensureDriveDirectory(parentDir === '.' ? '' : parentDir, folderName);
        const q = `name = '${fileName.replace(/'/g, "\\'")}' and trashed = false and '${parentId}' in parents`;
        const res = await this.driveClient.files.list({
          q,
          fields: 'files(id, name)',
        });
        if (res.data.files && res.data.files.length > 0) {
          fileId = res.data.files[0].id;
        }
      }

      if (fileId) {
        await this.driveClient.files.update({
          fileId,
          requestBody: { trashed: true },
        });

        this.idCache.delete(cacheKey);
        for (const k of this.idCache.keys()) {
          if (k.startsWith(cacheKey + '/')) {
            this.idCache.delete(k);
          }
        }
        this.saveCache();
        return { action: 'deleted', fileId, fileName, folderName };
      }
      return null;
    } catch (err) {
      console.error(`"${fileName}" silinirken Drive hatası:`, err.message);
      throw err;
    }
  }

  // Bekleyen silme işlemlerini dosyaya ekle
  addPendingDeletion(folderName) {
    try {
      const list = this.getPendingDeletions();
      if (!list.includes(folderName)) {
        list.push(folderName);
        fs.writeFileSync(this.pendingDeletionsPath, JSON.stringify(list, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('Pending deletion kaydedilemedi:', e);
    }
  }

  // Bekleyen silme işlemlerini oku
  getPendingDeletions() {
    try {
      if (fs.existsSync(this.pendingDeletionsPath)) {
        const raw = fs.readFileSync(this.pendingDeletionsPath, 'utf8');
        return JSON.parse(raw) || [];
      }
    } catch (e) {}
    return [];
  }

  // Drive bağlandığında veya açılışta bekleyen silmeleri uygula
  async processPendingDeletions() {
    if (!this.isConnected || !this.driveClient) return;
    const list = this.getPendingDeletions();
    if (list.length === 0) return;

    console.log(`[Squirrel] Bekleyen ${list.length} Drive klasör silme işlemi yürütülüyor...`);
    const remaining = [];
    for (const folderName of list) {
      try {
        await this.deleteFolderRoot(folderName);
        console.log(`[Squirrel] Bekleyen "${folderName}" klasörü Drive'dan silindi.`);
      } catch (err) {
        console.error(`Bekleyen klasör silinirken hata [${folderName}]:`, err.message);
        remaining.push(folderName);
      }
    }

    try {
      if (remaining.length > 0) {
        fs.writeFileSync(this.pendingDeletionsPath, JSON.stringify(remaining, null, 2), 'utf8');
      } else if (fs.existsSync(this.pendingDeletionsPath)) {
        fs.unlinkSync(this.pendingDeletionsPath);
      }
    } catch (e) {}
  }

  // Takip edilen ana klasörü (Squirrel / folderName) ve Drive'daki tüm içeriğini sil (çöpe taşı)
  async deleteFolderRoot(folderName) {
    if (!this.isConnected || !this.driveClient) {
      this.addPendingDeletion(folderName);
      return { success: false, reason: 'Drive bağlı değil, silme beklemeye alındı' };
    }

    // Bekleyen listesinden kaldır (eğer varsa)
    try {
      const remaining = this.getPendingDeletions().filter((n) => n !== folderName);
      if (remaining.length > 0) {
        fs.writeFileSync(this.pendingDeletionsPath, JSON.stringify(remaining, null, 2), 'utf8');
      } else if (fs.existsSync(this.pendingDeletionsPath)) {
        fs.unlinkSync(this.pendingDeletionsPath);
      }
    } catch (e) {}

    // Kuyruktaki bu klasöre ait bekleyen görevleri iptal et
    this.queue = this.queue.filter((item) => {
      if (item.folderName === folderName) {
        item.resolve({ action: 'cancelled' });
        return false;
      }
      return true;
    });

    try {
      const targetIds = new Set();

      if (this.folderRoots.has(folderName)) {
        targetIds.add(this.folderRoots.get(folderName));
      }

      const squirrelRootId = await this.getSquirrelRootId();
      if (squirrelRootId) {
        const escapedName = folderName.replace(/'/g, "\\'");
        const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false and '${squirrelRootId}' in parents`;
        const res = await this.driveClient.files.list({
          q,
          fields: 'files(id, name)',
          spaces: 'drive',
        });
        if (res.data.files) {
          for (const f of res.data.files) {
            targetIds.add(f.id);
          }
        }

        // Also delete any encrypted vault archive named <folderName>.sqvault.zip
        const arcQ = `mimeType != 'application/vnd.google-apps.folder' and name = '${escapedName}.sqvault.zip' and trashed = false and '${squirrelRootId}' in parents`;
        const arcRes = await this.driveClient.files.list({
          q: arcQ,
          fields: 'files(id, name)',
          spaces: 'drive',
        });
        if (arcRes.data.files) {
          for (const f of arcRes.data.files) {
            targetIds.add(f.id);
          }
        }
      }

      for (const fileId of targetIds) {
        try {
          await this.driveClient.files.update({
            fileId,
            requestBody: { trashed: true },
          });
        } catch (err) {
          console.warn(`Drive klasör çöp kutusuna taşıma uyarısı (${fileId}):`, err.message);
        }
      }

      // Bellek ve önbellek temizliği
      this.folderRoots.delete(folderName);
      const prefix = `${folderName}::`;
      for (const k of Array.from(this.idCache.keys())) {
        if (k === prefix || k.startsWith(prefix)) {
          this.idCache.delete(k);
        }
      }
      for (const k of Array.from(this.lastUploadedTimes.keys())) {
        if (k.startsWith(prefix)) {
          this.lastUploadedTimes.delete(k);
        }
      }
      this.saveCache();
      await this.cleanupDuplicateFoldersAndFiles();

      return {
        success: true,
        folderName,
        deletedCount: targetIds.size,
      };
    } catch (err) {
      console.error(`"${folderName}" klasörü Drive'dan silinirken hata:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Entire Folder Vault Archive Sync (WinZip AES-256 standard .sqvault.zip)
  async syncVaultFolderArchive(localRootPath, folderName, password, onEvent = null, onProgress = null) {
    if (!this.isConnected || !this.driveClient) {
      return { success: false, reason: 'Drive bağlı değil' };
    }

    const squirrelRootId = await this.getSquirrelRootId();
    if (!squirrelRootId) {
      return { success: false, reason: 'Squirrel kök klasörü oluşturulamadı' };
    }

    const archiveName = `${folderName}.sqvault.zip`;

    try {
      // 1. Purge any plaintext folder on Drive named folderName
      const folderQ = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false and '${squirrelRootId}' in parents`;
      const folderRes = await this.withRetry(() => this.driveClient.files.list({ q: folderQ, fields: 'files(id, name)' }));
      for (const f of folderRes.data.files || []) {
        try {
          await this.driveClient.files.update({ fileId: f.id, requestBody: { trashed: true } });
          this.folderRoots.delete(folderName);
          this.clearCacheForFolder(folderName);
          if (onEvent) {
            onEvent({
              action: 'vault_purge',
              fileName: f.name,
              folderName,
              message: `🔒 [${folderName}] Plaintext folder removed from Drive to enforce Vault archive security`,
              timestamp: new Date().toLocaleTimeString(),
            });
          }
        } catch (e) {}
      }

      // Also clean up loose assets or old files that might linger
      const looseQ = `name = 'assets' and trashed = false and '${squirrelRootId}' in parents`;
      const looseRes = await this.withRetry(() => this.driveClient.files.list({ q: looseQ, fields: 'files(id, name)' }));
      for (const f of looseRes.data.files || []) {
        try { await this.driveClient.files.update({ fileId: f.id, requestBody: { trashed: true } }); } catch (e) {}
      }

      // 2. Check if archive already exists on Drive
      const archiveQ = `mimeType != 'application/vnd.google-apps.folder' and name = '${archiveName.replace(/'/g, "\\'")}' and trashed = false and '${squirrelRootId}' in parents`;
      const archiveRes = await this.withRetry(() => this.driveClient.files.list({ q: archiveQ, fields: 'files(id, name, modifiedTime, size)' }));
      const existingFile = archiveRes.data.files && archiveRes.data.files.length > 0 ? archiveRes.data.files[0] : null;

      // 3. Scan local files for mtime and total size
      let latestLocalMtime = 0;
      let totalLocalBytes = 0;
      let localFileCount = 0;
      const scanStats = (dir) => {
        try {
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const full = path.join(dir, item.name);
            if (filterService.shouldIgnore(full, item.isDirectory()).ignored) {
              continue;
            }
            const p = path.join(dir, item.name);
            if (item.isDirectory()) {
              scanStats(p);
            } else if (item.isFile()) {
              const st = fs.statSync(p);
              if (st.mtimeMs > latestLocalMtime) latestLocalMtime = st.mtimeMs;
              totalLocalBytes += st.size;
              localFileCount++;
            }
          }
        } catch (e) {}
      };
      scanStats(localRootPath);

      if (existingFile && existingFile.modifiedTime) {
        const driveMtimeMs = new Date(existingFile.modifiedTime).getTime();
        if (latestLocalMtime <= driveMtimeMs + 3000) {
          if (onProgress) {
            onProgress({
              folderName,
              current: 1,
              total: 1,
              currentFile: 'Vault archive up to date',
              currentBytes: totalLocalBytes,
              totalBytes: totalLocalBytes,
              speed: 0,
              netSpeed: 0,
              netSpeedMbps: 0,
              diskSpeed: 0,
              etaSec: 0,
              done: true,
            });
          }
          return { success: true, upToDate: true, archiveId: existingFile.id };
        }
      }

      // 4. Create encrypted archive
      diagnosticsService.setFolderPhase(folderName, 'encrypting', `Encrypting ${localFileCount} files into AES-256 archive...`, {
        currentFile: archiveName,
      });
      if (onProgress) {
        onProgress({
          folderName,
          phase: 'encrypting',
          phaseText: '🔒 Encrypting Vault archive (AES-256)...',
          current: 0,
          total: 1,
          currentFile: `Encrypting ${localFileCount} files into AES-256 archive...`,
          currentBytes: 0,
          totalBytes: totalLocalBytes,
          speed: 0,
          netSpeed: 0,
          netSpeedMbps: 0,
          diskSpeed: 0,
          etaSec: 0,
          done: false,
        });
      }

      const tempDir = path.join(require('os').tmpdir(), 'squirrel-vault-temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempZipPath = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
      await vaultService.encryptFolderToZip(localRootPath, tempZipPath, password);

      const zipSize = fs.statSync(tempZipPath).size;

      // 5. Upload encrypted archive to Drive
      diagnosticsService.setFolderPhase(folderName, 'uploading', 'Uploading encrypted Vault archive...', {
        currentFile: archiveName,
        totalBytes: zipSize,
      });
      this.ensureSpeedTracker();
      const bufferSize = this.getStreamBufferSize();
      const createStream = () => {
        const stream = fs.createReadStream(tempZipPath, { highWaterMark: bufferSize });
        stream.on('data', (chunk) => {
          if (this.speedTracker) {
            this.speedTracker.recordNet(chunk.length);
            this.speedTracker.recordDisk(chunk.length);
          }
          if (onProgress) {
            const speeds = this.speedTracker ? this.speedTracker.getSpeeds(zipSize) : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };
            onProgress({
              folderName,
              phase: 'uploading',
              phaseText: 'Uploading Vault archive...',
              current: 0,
              total: 1,
              currentFile: `Uploading ${archiveName} (${(zipSize / 1024 / 1024).toFixed(1)} MB)...`,
              currentBytes: Math.min(zipSize, Math.round(zipSize * 0.5)),
              totalBytes: zipSize,
              speed: speeds.netSpeed,
              netSpeed: speeds.netSpeed,
              netSpeedMbps: speeds.netSpeedMbps,
              diskSpeed: speeds.diskSpeed,
              etaSec: speeds.etaSec,
              done: false,
            });
          }
        });
        return stream;
      };

      let uploadedId;
      if (existingFile) {
        const upRes = await this.withRetry(() =>
          this.driveClient.files.update({
            fileId: existingFile.id,
            media: { mimeType: 'application/zip', body: createStream() },
            fields: 'id, name',
          })
        );
        uploadedId = upRes.data.id;
      } else {
        const createRes = await this.withRetry(() =>
          this.driveClient.files.create({
            requestBody: {
              name: archiveName,
              parents: [squirrelRootId],
            },
            media: { mimeType: 'application/zip', body: createStream() },
            fields: 'id, name',
          })
        );
        uploadedId = createRes.data.id;
      }

      try { fs.unlinkSync(tempZipPath); } catch (e) {}

      this.idCache.set(`${folderName}::__vault_archive__`, uploadedId);
      this.saveCache();

      if (onEvent) {
        onEvent({
          action: 'vault_sync',
          fileName: archiveName,
          folderName,
          message: `🔒 [${folderName}] Entire folder encrypted & synced as WinZip AES-256 archive (${archiveName})`,
          timestamp: new Date().toLocaleTimeString(),
        });
      }

      if (onProgress) {
        onProgress({
          folderName,
          current: 1,
          total: 1,
          currentFile: `${archiveName} Synced`,
          currentBytes: zipSize,
          totalBytes: zipSize,
          speed: 0,
          netSpeed: 0,
          netSpeedMbps: 0,
          diskSpeed: 0,
          etaSec: 0,
          done: true,
        });
      }

      diagnosticsService.recordSynced(folderName, archiveName, 'vault_archive', zipSize, true);
      return { success: true, vault: true, archiveId: uploadedId };
    } catch (err) {
      console.error(`[Squirrel Vault] Error syncing archive for ${folderName}:`, err.message);
      diagnosticsService.reportSyncError(folderName, localRootPath, archiveName, err);
      return { success: false, error: err.message };
    } finally {
      diagnosticsService.clearFolderPhase(folderName);
    }
  }

  // Google Drive ile yerel klasörü karşılaştırıp tüm farklılıkları uygulayan motor
  async reconcileWithDrive(localRootPath, folderName, onEvent, onProgress = null) {
    if (!this.isNetworkOnline) {
      console.warn(`[Squirrel] "${folderName}" reconcile skipped: computer is offline.`);
      if (onProgress) {
        onProgress({
          folderName,
          phase: 'offline',
          phaseText: '⏸️ Sync paused • Waiting for internet...',
          currentFile: 'Sync paused • Waiting for internet...',
          isOfflinePaused: true,
          speed: 0,
          netSpeed: 0,
          netSpeedMbps: 0,
          diskSpeed: 0,
          etaSec: 0,
          done: false,
        });
      }
      return { success: false, offline: true, reason: 'Computer is offline' };
    }
    if (!this.isConnected || !this.driveClient) {
      return { success: false, reason: 'Drive bağlı değil' };
    }

    const isVault = vaultService.isFolderVaultEnabled(localRootPath) || vaultService.isFolderVaultEnabled(folderName);
    const vaultPassword = isVault ? (vaultService.getFolderPassword(localRootPath) || vaultService.getFolderPassword(folderName)) : null;

    if (isVault && vaultPassword) {
      return await this.syncVaultFolderArchive(localRootPath, folderName, vaultPassword, onEvent, onProgress);
    }

    // Vault is NOT enabled: purge any previous vault archive if it exists in squirrelRootId
    try {
      const squirrelRootId = await this.getSquirrelRootId();
      if (squirrelRootId) {
        const archiveName = `${folderName}.sqvault.zip`;
        const archiveQ = `mimeType != 'application/vnd.google-apps.folder' and name = '${archiveName.replace(/'/g, "\\'")}' and trashed = false and '${squirrelRootId}' in parents`;
        const archiveRes = await this.withRetry(() => this.driveClient.files.list({ q: archiveQ, fields: 'files(id, name)' }));
        for (const arc of archiveRes.data.files || []) {
          try {
            await this.driveClient.files.update({ fileId: arc.id, requestBody: { trashed: true } });
            this.idCache.delete(`${folderName}::__vault_archive__`);
            if (onEvent) {
              onEvent({
                action: 'vault_restore',
                fileName: archiveName,
                folderName,
                message: `🔓 [${folderName}] Vault archive removed from cloud (restoring unencrypted folder to Drive)`,
                timestamp: new Date().toLocaleTimeString(),
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    const folderRootId = await this.getFolderRootId(folderName);
    if (!folderRootId) {
      return { success: false, reason: 'Drive kök klasörü oluşturulamadı' };
    }

    try {
      diagnosticsService.setFolderPhase(folderName, 'comparing', 'Comparing with Google Drive...', {
        currentFile: 'Reading cloud folder tree...',
      });
      if (onProgress) {
        onProgress({
          folderName,
          phase: 'comparing',
          phaseText: '🔍 Comparing with Google Drive...',
          current: 0,
          total: 0,
          currentFile: 'Reading cloud folder tree...',
          done: false,
        });
      }

      const driveMap = new Map();

      const crawlDrive = async (folderId, currentRelPath) => {
        let pageToken = null;
        const subDirs = [];
        do {
          const res = await this.withRetry(() =>
            this.driveClient.files.list({
              q: `'${folderId}' in parents and trashed = false`,
              fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
              pageSize: 1000,
              pageToken: pageToken || undefined,
            })
          );

          for (const f of res.data.files || []) {
            const isDir = f.mimeType === 'application/vnd.google-apps.folder';
            const itemRel = currentRelPath ? `${currentRelPath}/${f.name}` : f.name;
            driveMap.set(itemRel, {
              id: f.id,
              name: f.name,
              isDir,
              modifiedTime: f.modifiedTime,
              size: parseInt(f.size || '0', 10),
              relativePath: itemRel,
            });

            this.idCache.set(`${folderName}::${itemRel}`, f.id);

            if (isDir) {
              subDirs.push({ id: f.id, rel: itemRel });
            }
          }

          pageToken = res.data.nextPageToken;
        } while (pageToken);

        if (subDirs.length > 0) {
          const limit = 8;
          for (let i = 0; i < subDirs.length; i += limit) {
            const batch = subDirs.slice(i, i + limit);
            await Promise.all(batch.map((d) => crawlDrive(d.id, d.rel)));
          }
        }
      };

      await crawlDrive(folderRootId, '');

      // CRITICAL PRUNING: Drive üzerinde gerçekte olmayan tüm eski / silinmiş önbellek anahtarlarını temizle!
      const prefix = `${folderName}::`;
      for (const k of Array.from(this.idCache.keys())) {
        if (k.startsWith(prefix) && k !== prefix) {
          const rel = k.slice(prefix.length);
          if (!driveMap.has(rel)) {
            this.idCache.delete(k);
          }
        }
      }
      this.saveCache();

      diagnosticsService.setFolderPhase(folderName, 'scanning', 'Scanning local folder files...', {
        currentFile: 'Indexing local files & applying exclusions...',
      });
      if (onProgress) {
        onProgress({
          folderName,
          phase: 'scanning',
          phaseText: '🔍 Scanning local files...',
          current: 0,
          total: 0,
          currentFile: 'Indexing local files & applying exclusions...',
          done: false,
        });
      }

      const localMap = new Map();

      const crawlLocal = async (currentDir, currentRelPath) => {
        try {
          const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const name = entry.name;
            const full = path.join(currentDir, name);
            if (filterService.shouldIgnore(full, entry.isDirectory()).ignored) {
              continue;
            }
            const rel = currentRelPath ? `${currentRelPath}/${name}` : name;
            const normRel = rel.replace(/\\/g, '/');

            if (entry.isDirectory()) {
              localMap.set(normRel, {
                fullPath: full,
                relativePath: normRel,
                isDir: true,
                name,
              });
              await crawlLocal(full, normRel);
            } else if (entry.isFile()) {
              const st = await fs.promises.stat(full);
              localMap.set(normRel, {
                fullPath: full,
                relativePath: normRel,
                isDir: false,
                name,
                mtimeMs: st.mtimeMs,
                size: st.size,
              });
            }
          }
        } catch (e) {}
      };

      await crawlLocal(localRootPath, '');

      // Check existing non-offline issues for this folder and auto-resolve any file that no longer exists locally
      for (const [id, issue] of diagnosticsService.issues.entries()) {
        if (issue.folderName === folderName && issue.category !== 'offline') {
          const norm = (issue.relativePath || '').replace(/\\/g, '/');
          if (norm && !localMap.has(norm)) {
            diagnosticsService.resolveIssue(folderName, issue.relativePath);
          }
        }
      }

      const isVault = vaultService.isFolderVaultEnabled(localRootPath) || vaultService.isFolderVaultEnabled(folderName);

      // 1. Silinenler (ve Vault aktifse Drive'daki eski şifresiz dosyaların temizlenmesi)
      const toDeleteFromDrive = [];
      for (const [normRel, driveItem] of driveMap.entries()) {
        if (driveItem.isDir) {
          if (!localMap.has(normRel)) {
            toDeleteFromDrive.push(driveItem);
          }
        } else if (isVault) {
          if (!normRel.endsWith('.sqvault.zip')) {
            // Vault modunda Drive'daki şifresiz düz dosya çöpe taşınmalı
            toDeleteFromDrive.push(driveItem);
          } else {
            const origRel = normRel.replace(/\.sqvault\.zip$/i, '');
            if (!localMap.has(origRel)) {
              toDeleteFromDrive.push(driveItem);
            }
          }
        } else {
          if (!localMap.has(normRel)) {
            toDeleteFromDrive.push(driveItem);
          }
        }
      }

      const rootToDelete = toDeleteFromDrive.filter(
        (item) =>
          !toDeleteFromDrive.some(
            (other) =>
              other.isDir &&
              item !== other &&
              item.relativePath.startsWith(other.relativePath + '/')
          )
      );

      let deletedCount = 0;
      for (const item of rootToDelete) {
        try {
          await this.driveClient.files.update({
            fileId: item.id,
            requestBody: { trashed: true },
          });
          this.idCache.delete(`${folderName}::${item.relativePath}`);
          deletedCount++;
          if (onEvent) {
            const isPurgedForVault = isVault && !item.name.endsWith('.sqvault.zip');
            onEvent({
              action: isPurgedForVault ? 'vault_purge' : 'deleted',
              fileName: item.name,
              folderName,
              message: isPurgedForVault
                ? `🔒 [${folderName}] (${item.name}) unencrypted file removed from Drive (replaced with encrypted Vault archive)`
                : `🗑️ [${folderName}] (${item.name}) deleted from Drive (removed locally while offline)`,
              timestamp: new Date().toLocaleTimeString(),
            });
          }
        } catch (err) {
          console.error(`Reconcile delete hatası (${item.name}):`, err.message);
        }
      }

      // 2. Eklenenler (KLASÖR KLASÖR: Önce bir klasör ve içindeki tüm dosyaları, sonra diğer klasör)
      const toAddToDrive = [];
      for (const [normRel, localItem] of localMap.entries()) {
        if (localItem.isDir) {
          if (!driveMap.has(normRel)) {
            toAddToDrive.push(localItem);
          }
        } else if (isVault) {
          const expectedCloudRel = `${normRel}.sqvault.zip`;
          if (!driveMap.has(expectedCloudRel)) {
            toAddToDrive.push(localItem);
          }
        } else {
          if (!driveMap.has(normRel)) {
            toAddToDrive.push(localItem);
          }
        }
      }

      // Klasör dizin yoluna göre dosyaları grupla
      const dirToFiles = new Map();

      for (const item of toAddToDrive) {
        if (item.isDir) {
          if (!dirToFiles.has(item.relativePath)) {
            dirToFiles.set(item.relativePath, []);
          }
        } else {
          const parentDir = path.dirname(item.relativePath).replace(/\\/g, '/');
          const normalizedParent = parentDir === '.' ? '' : parentDir;
          if (!dirToFiles.has(normalizedParent)) {
            dirToFiles.set(normalizedParent, []);
          }
          dirToFiles.get(normalizedParent).push(item);
        }
      }

      // Sığ klasörden derin klasöre doğru sırala
      const sortedDirPaths = Array.from(dirToFiles.keys()).sort((a, b) => {
        const depthA = a ? a.split('/').length : 0;
        const depthB = b ? b.split('/').length : 0;
        if (depthA !== depthB) return depthA - depthB;
        return a.localeCompare(b);
      });

      const allFilesToAdd = [];
      for (const dirRelPath of sortedDirPaths) {
        const filesInDir = dirToFiles.get(dirRelPath) || [];
        for (const f of filesInDir) {
          allFilesToAdd.push(f);
        }
      }

      // 3. Güncellenenler (ÖNEMLİ: FL Studio veya sahte gelecek tarihli mtime'ları filtrele)
      const nowMs = Date.now();
      const toUpdateDrive = [];
      for (const [normRel, localItem] of localMap.entries()) {
        if (!localItem.isDir) {
          const cloudRel = isVault ? `${normRel}.sqvault.zip` : normRel;
          if (driveMap.has(cloudRel)) {
            const driveItem = driveMap.get(cloudRel);
            const driveMtimeMs = new Date(driveItem.modifiedTime).getTime();
            const isFutureMtime = localItem.mtimeMs > nowMs + 3600000;
            const timeChanged = !isFutureMtime && localItem.mtimeMs > driveMtimeMs + 5000;
            const sizeChanged = Math.abs((driveItem.size || 0) - (localItem.size || 0)) > 0;

            if (timeChanged || sizeChanged) {
              toUpdateDrive.push(localItem);
            }
          }
        }
      }

      const totalFilesToUpload = allFilesToAdd.length + toUpdateDrive.length;
      const totalBytesToUpload =
        allFilesToAdd.reduce((sum, f) => sum + (f.size || 0), 0) +
        toUpdateDrive.reduce((sum, f) => sum + (f.size || 0), 0);

      let processedCount = 0;
      let processedBytes = 0;
      let addedCount = 0;
      let updatedCount = 0;

      if (totalFilesToUpload === 0) {
        // Zaten tamamen eşit! Anlık ilerleme çubuğuna hemen bitti bildir
        diagnosticsService.clearFolderPhase(folderName);
        if (onProgress) {
          onProgress({
            folderName,
            phase: 'idle',
            phaseText: 'All files synced',
            current: 0,
            total: 0,
            currentFile: 'All files synced',
            currentBytes: 0,
            totalBytes: 0,
            speed: 0,
            netSpeed: 0,
            netSpeedMbps: 0,
            diskSpeed: 0,
            etaSec: 0,
            done: true,
          });
        }
      } else {
        this.speedTracker = new SpeedTracker();

        let lastProgressEmitTime = 0;
        let currentDisplayFile = '';
        let lastDisplayFileSwitchTime = 0;
        const streamedBytesMap = new Map();

        const getDisplayFileName = (incomingName) => {
          const activeKeys = Array.from(streamedBytesMap.keys());
          const now = Date.now();
          if (currentDisplayFile && streamedBytesMap.has(currentDisplayFile) && now - lastDisplayFileSwitchTime < 2500) {
            // Keep current active file for at least 2.5s to prevent rapid flickering
          } else {
            currentDisplayFile = incomingName || (activeKeys[0] || '');
            lastDisplayFileSwitchTime = now;
          }

          const extraCount = Math.max(0, activeKeys.length - 1);
          if (extraCount > 0) {
            return `${currentDisplayFile} (+${extraCount} in parallel)`;
          }
          return currentDisplayFile;
        };

        const handleChunk = (chunkLen, currentFileName) => {
          streamedBytesMap.set(currentFileName, (streamedBytesMap.get(currentFileName) || 0) + chunkLen);
          const now = Date.now();
          if (now - lastProgressEmitTime < 350) return;
          lastProgressEmitTime = now;

          let inFlightBytes = 0;
          for (const b of streamedBytesMap.values()) inFlightBytes += b;
          const currentTotalBytes = Math.min(totalBytesToUpload, processedBytes + inFlightBytes);
          const remainingBytes = Math.max(0, totalBytesToUpload - currentTotalBytes);
          const speeds = this.speedTracker
            ? this.speedTracker.getSpeeds(remainingBytes)
            : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

          const displayFileName = getDisplayFileName(currentFileName);

          diagnosticsService.setFolderPhase(folderName, 'uploading', `Uploading (${processedCount}/${totalFilesToUpload})`, {
            currentFile: displayFileName,
            currentBytes: currentTotalBytes,
            totalBytes: totalBytesToUpload,
            currentFiles: processedCount,
            totalFiles: totalFilesToUpload,
            speed: speeds.netSpeed,
            etaSec: speeds.etaSec,
          });

          if (onProgress) {
            onProgress({
              folderName,
              phase: 'uploading',
              phaseText: `Uploading (${processedCount}/${totalFilesToUpload})`,
              current: processedCount,
              total: totalFilesToUpload,
              currentFile: displayFileName,
              currentBytes: currentTotalBytes,
              totalBytes: totalBytesToUpload,
              speed: speeds.netSpeed,
              netSpeed: speeds.netSpeed,
              netSpeedMbps: speeds.netSpeedMbps,
              diskSpeed: speeds.diskSpeed,
              etaSec: speeds.etaSec,
              done: false,
            });
          }
        };

        // Önce yeni dosyaları paralel ve klasör klasör yükle
        if (allFilesToAdd.length > 0) {
          diagnosticsService.setFolderPhase(folderName, 'uploading', `Uploading new files (0/${totalFilesToUpload})`, {
            totalFiles: totalFilesToUpload,
            totalBytes: totalBytesToUpload,
          });
          await this.runConcurrentUploads(
            allFilesToAdd,
            folderName,
            (fileItem, err) => {
              streamedBytesMap.delete(fileItem.name);
              if (err) {
                console.error(`[Squirrel] Dosya aktarılamadı (${fileItem.name}):`, err.message);
                diagnosticsService.reportSyncError(folderName, localRootPath, fileItem.relativePath || fileItem.rel, err);
                processedCount++;
              } else {
                diagnosticsService.resolveIssue(folderName, fileItem.relativePath || fileItem.rel);
                diagnosticsService.recordSynced(folderName, fileItem.name, 'uploaded', fileItem.size || 0);
                addedCount++;
                processedCount++;
                processedBytes += fileItem.size || 0;
              }

              let inFlightBytes = 0;
              for (const b of streamedBytesMap.values()) inFlightBytes += b;
              const currentTotalBytes = Math.min(totalBytesToUpload, processedBytes + inFlightBytes);
              const remainingBytes = Math.max(0, totalBytesToUpload - currentTotalBytes);
              const speeds = this.speedTracker
                ? this.speedTracker.getSpeeds(remainingBytes)
                : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

              const displayFileName = getDisplayFileName(fileItem.name);

              diagnosticsService.setFolderPhase(folderName, 'uploading', `Uploading (${processedCount}/${totalFilesToUpload})`, {
                currentFile: displayFileName,
                currentBytes: currentTotalBytes,
                totalBytes: totalBytesToUpload,
                currentFiles: processedCount,
                totalFiles: totalFilesToUpload,
                speed: speeds.netSpeed,
                etaSec: speeds.etaSec,
              });

              if (onProgress) {
                onProgress({
                  folderName,
                  phase: 'uploading',
                  phaseText: `Uploading (${processedCount}/${totalFilesToUpload})`,
                  current: processedCount,
                  total: totalFilesToUpload,
                  currentFile: displayFileName,
                  currentBytes: currentTotalBytes,
                  totalBytes: totalBytesToUpload,
                  speed: speeds.netSpeed,
                  netSpeed: speeds.netSpeed,
                  netSpeedMbps: speeds.netSpeedMbps,
                  diskSpeed: speeds.diskSpeed,
                  etaSec: speeds.etaSec,
                  done: processedCount === totalFilesToUpload,
                });
              }

              if (onEvent && (addedCount <= 5 || addedCount % 10 === 0 || processedCount === totalFilesToUpload)) {
                onEvent({
                  action: 'created',
                  fileName: fileItem.name,
                  folderName,
                  message: `☁️ [${folderName}] (${fileItem.name}) uploaded to Drive (${processedCount}/${totalFilesToUpload})`,
                  timestamp: new Date().toLocaleTimeString(),
                });
              }
            },
            { knownNew: true, localRootPath, onChunk: handleChunk }
          );
        }

        // İnternet bağlantısı kesildiyse güncellemeleri zorlayıp log patlaması yapma, duraklat
        if (!this.isNetworkOnline) {
          console.warn(`[Squirrel] "${folderName}" senkronizasyonu internet bağlantısı olmadığı için duraklatıldı.`);
          if (this.speedTracker) {
            this.speedTracker.destroy();
            this.speedTracker = null;
          }
          if (onProgress) {
            onProgress({
              folderName,
              phase: 'offline',
              phaseText: '⏸️ Sync paused • Waiting for internet...',
              currentFile: 'Sync paused • Waiting for internet...',
              isOfflinePaused: true,
              speed: 0,
              netSpeed: 0,
              netSpeedMbps: 0,
              diskSpeed: 0,
              etaSec: 0,
              done: false,
            });
          }
          return { success: false, offline: true, folderName };
        }

        if (this.pausedFolders.has(folderName)) {
          if (this.speedTracker) {
            this.speedTracker.destroy();
            this.speedTracker = null;
          }
          return { success: false, paused: true, folderName };
        }
        if (this.cancelledFolders.has(folderName)) {
          if (this.speedTracker) {
            this.speedTracker.destroy();
            this.speedTracker = null;
          }
          return { success: false, cancelled: true, folderName };
        }

        // Sonra güncellenen dosyaları paralel yükle
        if (toUpdateDrive.length > 0) {
          diagnosticsService.setFolderPhase(folderName, 'uploading', `Uploading modified files (${processedCount}/${totalFilesToUpload})`, {
            totalFiles: totalFilesToUpload,
            totalBytes: totalBytesToUpload,
            currentFiles: processedCount,
          });
          await this.runConcurrentUploads(
            toUpdateDrive,
            folderName,
            (fileItem, err) => {
              streamedBytesMap.delete(fileItem.name);
              if (err) {
                console.error(`[Squirrel] Güncelleme aktarılamadı (${fileItem.name}):`, err.message);
                diagnosticsService.reportSyncError(folderName, localRootPath, fileItem.relativePath || fileItem.rel, err);
                processedCount++;
              } else {
                diagnosticsService.resolveIssue(folderName, fileItem.relativePath || fileItem.rel);
                diagnosticsService.recordSynced(folderName, fileItem.name, 'updated', fileItem.size || 0);
                updatedCount++;
                processedCount++;
                processedBytes += fileItem.size || 0;
              }

              let inFlightBytes = 0;
              for (const b of streamedBytesMap.values()) inFlightBytes += b;
              const currentTotalBytes = Math.min(totalBytesToUpload, processedBytes + inFlightBytes);
              const remainingBytes = Math.max(0, totalBytesToUpload - currentTotalBytes);
              const speeds = this.speedTracker
                ? this.speedTracker.getSpeeds(remainingBytes)
                : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

              const displayFileName = getDisplayFileName(fileItem.name);

              diagnosticsService.setFolderPhase(folderName, 'uploading', `Uploading (${processedCount}/${totalFilesToUpload})`, {
                currentFile: displayFileName,
                currentBytes: currentTotalBytes,
                totalBytes: totalBytesToUpload,
                currentFiles: processedCount,
                totalFiles: totalFilesToUpload,
                speed: speeds.netSpeed,
                etaSec: speeds.etaSec,
              });

              if (onProgress) {
                onProgress({
                  folderName,
                  phase: 'uploading',
                  phaseText: `Uploading (${processedCount}/${totalFilesToUpload})`,
                  current: processedCount,
                  total: totalFilesToUpload,
                  currentFile: displayFileName,
                  currentBytes: currentTotalBytes,
                  totalBytes: totalBytesToUpload,
                  speed: speeds.netSpeed,
                  netSpeed: speeds.netSpeed,
                  netSpeedMbps: speeds.netSpeedMbps,
                  diskSpeed: speeds.diskSpeed,
                  etaSec: speeds.etaSec,
                  done: processedCount === totalFilesToUpload,
                });
              }

              if (onEvent) {
                onEvent({
                  action: 'updated',
                  fileName: fileItem.name,
                  folderName,
                  message: `🔄 [${folderName}] (${fileItem.name}) updated on Drive (${processedCount}/${totalFilesToUpload})`,
                  timestamp: new Date().toLocaleTimeString(),
                });
              }
            },
            { knownNew: false, localRootPath, onChunk: handleChunk }
          );
        }

        if (this.speedTracker) {
          this.speedTracker.destroy();
          this.speedTracker = null;
        }
      }

      if (this.cancelledFolders.has(folderName)) {
        return { success: false, cancelled: true };
      }
      if (this.pausedFolders.has(folderName)) {
        return { success: false, paused: true };
      }

      this.saveCache();
      await this.cleanupDuplicateFoldersAndFiles();

      return {
        success: true,
        folderName,
        deletedCount,
        addedCount,
        updatedCount,
        totalDiff: deletedCount + addedCount + updatedCount,
      };
    } catch (err) {
      console.error(`Reconciliation hatası [${folderName}]:`, err);
      diagnosticsService.reportSyncError(folderName, localRootPath, '', err);
      const isOffline = !this.isNetworkOnline || diagnosticsService.hasOfflineIssues(folderName);
      if (onProgress) {
        onProgress({
          folderName,
          phase: isOffline ? 'offline' : 'idle',
          phaseText: isOffline ? '⏸️ Sync paused • Waiting for internet...' : 'Sync encountered an error',
          currentFile: isOffline ? 'Sync paused • Waiting for internet...' : 'Error during sync',
          isOfflinePaused: isOffline,
          speed: 0,
          netSpeed: 0,
          netSpeedMbps: 0,
          diskSpeed: 0,
          etaSec: 0,
          done: false,
        });
      }
      return { success: false, error: err.message, offline: isOffline };
    } finally {
      if (!diagnosticsService.hasOfflineIssues(folderName)) {
        diagnosticsService.clearFolderPhase(folderName);
      } else {
        diagnosticsService.setFolderPhase(folderName, 'offline', 'Paused (Waiting for internet)', {
          currentFile: 'Waiting for internet connection...',
          speed: 0,
          etaSec: 0,
        });
      }
    }
  }

  enqueueTask(taskFn, folderName = null) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject, folderName });
      this.processQueue();
    });
  }

  processQueue() {
    if (!this.activeWorkers) this.activeWorkers = 0;
    const maxConcurrency = Math.min(this.getConcurrency(), 16);

    while (this.activeWorkers < maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.activeWorkers++;
      this.isProcessingQueue = true;

      (async () => {
        const { taskFn, resolve, reject, folderName } = item;
        try {
          if (folderName && this.cancelledFolders.has(folderName)) {
            resolve({ action: 'cancelled' });
            return;
          }
          const res = await taskFn();
          resolve(res);
        } catch (err) {
          console.warn('[Squirrel Queue Görev Uyarısı]:', err.message);
          resolve({ error: err.message });
        } finally {
          this.activeWorkers--;
          if (this.activeWorkers === 0 && this.queue.length === 0) {
            this.isProcessingQueue = false;
          }
          this.processQueue();
        }
      })();
    }
  }

  // Drive altındaki tüm mükerrer ve 0 baytlık kopya klasör/dosyaları tespit edip temizle
  async cleanupDuplicateFoldersAndFiles() {
    if (!this.isConnected || !this.driveClient) return;
    try {
      const rootId = await this.getSquirrelRootId();
      if (!rootId) return;

      let pt = null;
      const all = [];
      do {
        const res = await this.withRetry(() =>
          this.driveClient.files.list({
            q: "trashed = false",
            fields: 'nextPageToken, files(id, name, size, mimeType, parents, createdTime)',
            pageSize: 1000,
            pageToken: pt || undefined,
          })
        );
        for (const f of res.data.files || []) {
          all.push(f);
        }
        pt = res.data.nextPageToken;
      } while (pt);

      // 1. Klasör mükerrerliklerini temizle (Aynı üst klasör altında aynı isim)
      const foldersByParent = new Map();
      for (const f of all) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          const p = (f.parents && f.parents[0]) || 'none';
          const k = `${p}:::${f.name}`;
          if (!foldersByParent.has(k)) foldersByParent.set(k, []);
          foldersByParent.get(k).push(f);
        }
      }

      for (const [key, folders] of foldersByParent.entries()) {
        if (folders.length > 1) {
          const folderStats = [];
          for (const folder of folders) {
            const childRes = await this.withRetry(() =>
              this.driveClient.files.list({
                q: `'${folder.id}' in parents and trashed = false`,
                fields: 'files(id, name)',
              })
            );
            const children = childRes.data.files || [];
            folderStats.push({ folder, count: children.length, children });
          }

          folderStats.sort((a, b) => b.count - a.count);
          const keeper = folderStats[0];

          for (let i = 1; i < folderStats.length; i++) {
            const dup = folderStats[i];
            for (const child of dup.children) {
              try {
                await this.driveClient.files.update({
                  fileId: child.id,
                  addParents: keeper.folder.id,
                  removeParents: dup.folder.id,
                  fields: 'id, parents',
                });
              } catch (e) {}
            }
            try {
              await this.driveClient.files.update({
                fileId: dup.folder.id,
                requestBody: { trashed: true },
              });
            } catch (e) {}
          }
        }
      }

      // 2. Dosya mükerrerliklerini temizle (Aynı klasörde aynı isim)
      const filesByParent = new Map();
      for (const f of all) {
        if (f.mimeType !== 'application/vnd.google-apps.folder') {
          const p = (f.parents && f.parents[0]) || 'none';
          const k = `${p}:::${f.name}`;
          if (!filesByParent.has(k)) filesByParent.set(k, []);
          filesByParent.get(k).push(f);
        }
      }

      for (const [key, files] of filesByParent.entries()) {
        if (files.length > 1) {
          files.sort((a, b) => {
            const sA = parseInt(a.size || '0', 10);
            const sB = parseInt(b.size || '0', 10);
            if (sA !== sB) return sB - sA;
            return new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime();
          });

          for (let i = 1; i < files.length; i++) {
            try {
              await this.driveClient.files.update({
                fileId: files[i].id,
                requestBody: { trashed: true },
              });
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.warn('[Squirrel] Mükerrer dosya temizliği uyarısı:', err.message);
    }
  }

  // ==========================================
  // SILINME KORUMASI & KARANTINA (QUARANTINE)
  // ==========================================

  async getOrCreateQuarantineRootId() {
    if (this.quarantineRootId) {
      try {
        const check = await this.withRetry(() =>
          this.driveClient.files.get({ fileId: this.quarantineRootId, fields: 'id, trashed' })
        );
        if (check.data && !check.data.trashed) return this.quarantineRootId;
      } catch (e) {
        this.quarantineRootId = null;
      }
    }

    const squirrelRootId = await this.getSquirrelRootId();
    if (!squirrelRootId) return null;

    const q = `mimeType = 'application/vnd.google-apps.folder' and name = 'Quarantine' and trashed = false and '${squirrelRootId}' in parents`;
    const res = await this.withRetry(() =>
      this.driveClient.files.list({ q, fields: 'files(id, name)' })
    );

    if (res.data.files && res.data.files.length > 0) {
      this.quarantineRootId = res.data.files[0].id;
      return this.quarantineRootId;
    }

    const createRes = await this.withRetry(() =>
      this.driveClient.files.create({
        requestBody: {
          name: 'Quarantine',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [squirrelRootId],
          description: 'Squirrel Silinme Korumasi - Deleted items are safely preserved here',
        },
        fields: 'id',
      })
    );

    this.quarantineRootId = createRes.data.id;
    return this.quarantineRootId;
  }

  async quarantineFolderOnDrive(folderName) {
    if (!this.isConnected || !this.driveClient) return { success: false, reason: 'Drive not connected' };
    const squirrelRootId = await this.getSquirrelRootId();
    const quarantineRootId = await this.getOrCreateQuarantineRootId();
    if (!squirrelRootId || !quarantineRootId) return { success: false, reason: 'Quarantine folder inaccessible' };

    let movedItems = 0;
    // 1. Move vault archive if exists (untrash if previously marked trashed)
    const archiveName = `${folderName}.sqvault.zip`;
    const arcQ = `mimeType != 'application/vnd.google-apps.folder' and name = '${archiveName.replace(/'/g, "\\'")}' and ('${squirrelRootId}' in parents or '${quarantineRootId}' in parents)`;
    const arcRes = await this.withRetry(() => this.driveClient.files.list({ q: arcQ, fields: 'files(id, name, trashed, parents)' }));
    for (const f of arcRes.data.files || []) {
      try {
        await this.withRetry(() =>
          this.driveClient.files.update({
            fileId: f.id,
            addParents: quarantineRootId,
            removeParents: squirrelRootId,
            requestBody: { trashed: false },
            fields: 'id, parents, trashed',
          })
        );
        movedItems++;
      } catch (e) {
        console.warn(`[Quarantine] Archive move error:`, e.message);
      }
    }

    // 2. Move normal folder if exists (untrash if previously marked trashed)
    const foldQ = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and ('${squirrelRootId}' in parents or '${quarantineRootId}' in parents)`;
    const foldRes = await this.withRetry(() => this.driveClient.files.list({ q: foldQ, fields: 'files(id, name, trashed, parents)' }));
    for (const f of foldRes.data.files || []) {
      try {
        await this.withRetry(() =>
          this.driveClient.files.update({
            fileId: f.id,
            addParents: quarantineRootId,
            removeParents: squirrelRootId,
            requestBody: { trashed: false },
            fields: 'id, parents, trashed',
          })
        );
        movedItems++;

        // Also ensure all children inside this folder are untrashed!
        try {
          const childRes = await this.withRetry(() =>
            this.driveClient.files.list({
              q: `'${f.id}' in parents and trashed = true`,
              fields: 'files(id, name)',
            })
          );
          for (const c of childRes.data.files || []) {
            try {
              await this.withRetry(() =>
                this.driveClient.files.update({
                  fileId: c.id,
                  requestBody: { trashed: false },
                })
              );
            } catch (err) {}
          }
        } catch (err) {}
      } catch (e) {
        console.warn(`[Quarantine] Folder move error:`, e.message);
      }
    }

    this.folderRoots.delete(folderName);
    this.clearCacheForFolder(folderName);
    return { success: true, movedItems };
  }

  async restoreQuarantinedFolder(folderName, targetLocalPath, vaultPassword = null) {
    if (!this.isConnected || !this.driveClient) return { success: false, reason: 'Drive not connected' };
    const squirrelRootId = await this.getSquirrelRootId();
    const quarantineRootId = await this.getOrCreateQuarantineRootId();
    if (!squirrelRootId || !quarantineRootId) return { success: false, reason: 'Quarantine folder inaccessible' };

    await fs.promises.mkdir(targetLocalPath, { recursive: true });

    // 1. Check for vault archive in Quarantine or Squirrel root
    const archiveName = `${folderName}.sqvault.zip`;
    const arcQ = `mimeType != 'application/vnd.google-apps.folder' and name = '${archiveName.replace(/'/g, "\\'")}' and ('${quarantineRootId}' in parents or '${squirrelRootId}' in parents)`;
    const arcRes = await this.withRetry(() => this.driveClient.files.list({ q: arcQ, fields: 'files(id, name, trashed, parents)' }));

    if (arcRes.data.files && arcRes.data.files.length > 0) {
      const arc = arcRes.data.files[0];
      // Untrash and move back to squirrel root
      await this.withRetry(() =>
        this.driveClient.files.update({
          fileId: arc.id,
          addParents: squirrelRootId,
          removeParents: quarantineRootId,
          requestBody: { trashed: false },
          fields: 'id, parents, trashed',
        })
      );

      const tempZip = path.join(require('os').tmpdir(), `restore_${Date.now()}_${archiveName}`);
      await this.downloadFileFromDrive(arc.id, tempZip);

      const pass = vaultPassword || vaultService.getFolderPassword(folderName) || vaultService.getFolderPassword(targetLocalPath);
      if (pass) {
        await vaultService.decryptZipToFolder(tempZip, targetLocalPath, pass);
      } else {
        await vaultService.decryptZipToFolder(tempZip, targetLocalPath, '').catch(() => {});
      }
      try { fs.unlinkSync(tempZip); } catch (e) {}

      return { success: true, isVault: true };
    }

    // 2. Check for normal folder in Quarantine or Squirrel root (even if trashed)
    const foldQ = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and ('${quarantineRootId}' in parents or '${squirrelRootId}' in parents)`;
    const foldRes = await this.withRetry(() => this.driveClient.files.list({ q: foldQ, fields: 'files(id, name, trashed, parents)' }));

    if (foldRes.data.files && foldRes.data.files.length > 0) {
      const folder = foldRes.data.files[0];
      // Untrash and move back to squirrel root
      await this.withRetry(() =>
        this.driveClient.files.update({
          fileId: folder.id,
          addParents: squirrelRootId,
          removeParents: quarantineRootId,
          requestBody: { trashed: false },
          fields: 'id, parents, trashed',
        })
      );

      // Untrash any children inside this folder before download
      try {
        const childRes = await this.withRetry(() =>
          this.driveClient.files.list({
            q: `'${folder.id}' in parents and trashed = true`,
            fields: 'files(id, name)',
          })
        );
        for (const c of childRes.data.files || []) {
          try {
            await this.withRetry(() =>
              this.driveClient.files.update({
                fileId: c.id,
                requestBody: { trashed: false },
              })
            );
          } catch (err) {}
        }
      } catch (err) {}

      await this.downloadFolderFromDrive(folder.id, targetLocalPath);
      return { success: true, isVault: false };
    }

    return { success: false, reason: 'Folder not found in Drive Quarantine.' };
  }

  async permanentlyDeleteQuarantinedFolder(folderName) {
    if (!this.isConnected || !this.driveClient) return { success: false, reason: 'Drive not connected' };
    const quarantineRootId = await this.getOrCreateQuarantineRootId();
    if (!quarantineRootId) return { success: false, reason: 'Quarantine root inaccessible' };

    const q = `trashed = false and '${quarantineRootId}' in parents and (name = '${folderName.replace(/'/g, "\\'")}' or name = '${folderName.replace(/'/g, "\\'")}.sqvault.zip')`;
    const res = await this.withRetry(() => this.driveClient.files.list({ q, fields: 'files(id, name)' }));

    for (const f of res.data.files || []) {
      try {
        await this.withRetry(() => this.driveClient.files.delete({ fileId: f.id }));
      } catch (e) {
        try {
          await this.driveClient.files.update({ fileId: f.id, requestBody: { trashed: true } });
        } catch (err) {}
      }
    }
    return { success: true };
  }

  async downloadFileFromDrive(fileId, targetLocalPath) {
    await fs.promises.mkdir(path.dirname(targetLocalPath), { recursive: true });
    const dest = fs.createWriteStream(targetLocalPath);
    const res = await this.withRetry(() =>
      this.driveClient.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      )
    );

    return new Promise((resolve, reject) => {
      res.data
        .pipe(dest)
        .on('finish', () => resolve(targetLocalPath))
        .on('error', reject);
    });
  }

  async downloadFolderFromDrive(folderId, targetLocalDir) {
    await fs.promises.mkdir(targetLocalDir, { recursive: true });

    const crawl = async (currFolderId, currLocalDir) => {
      let pageToken = null;
      do {
        const res = await this.withRetry(() =>
          this.driveClient.files.list({
            q: `'${currFolderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 1000,
            pageToken: pageToken || undefined,
          })
        );

        for (const item of res.data.files || []) {
          const itemPath = path.join(currLocalDir, item.name);
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            await fs.promises.mkdir(itemPath, { recursive: true });
            await crawl(item.id, itemPath);
          } else {
            try {
              await this.downloadFileFromDrive(item.id, itemPath);
            } catch (err) {
              console.warn(`[Download] Could not download file ${item.name}:`, err.message);
            }
          }
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);
    };

    await crawl(folderId, targetLocalDir);
    return targetLocalDir;
  }

  // ==========================================
  // DOSYA VERSIYONLAMA (TIME MACHINE / REVISIONS)
  // ==========================================

  async resolveFileId(folderName, relativePath) {
    const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const cacheKey = `${folderName}::${norm}`;
    if (this.idCache.has(cacheKey)) {
      return this.idCache.get(cacheKey);
    }
    const dirPart = path.posix.dirname(norm);
    const fileName = path.posix.basename(norm);
    const parentId = await this.getOrCreateFolderPath(folderName, dirPart === '.' ? '' : dirPart);
    if (!parentId) return null;

    const q = `name = '${fileName.replace(/'/g, "\\'")}' and trashed = false and '${parentId}' in parents and mimeType != 'application/vnd.google-apps.folder'`;
    const res = await this.withRetry(() =>
      this.driveClient.files.list({ q, fields: 'files(id, name)' })
    );

    if (res.data.files && res.data.files.length > 0) {
      const id = res.data.files[0].id;
      this.idCache.set(cacheKey, id);
      return id;
    }
    return null;
  }

  async getFileRevisions(folderName, relativeFilePath) {
    if (!this.isConnected || !this.driveClient) return { success: false, reason: 'Drive not connected' };
    const fileId = await this.resolveFileId(folderName, relativeFilePath);
    if (!fileId) return { success: false, reason: 'Dosya Google Drive üzerinde bulunamadı.' };

    try {
      const res = await this.withRetry(() =>
        this.driveClient.revisions.list({
          fileId,
          fields: 'revisions(id, modifiedTime, size, keepForever, originalFilename)',
        })
      );

      const list = res.data.revisions || [];
      const revisions = list.map((r, index) => ({
        id: r.id,
        versionNumber: index + 1,
        isLatest: index === list.length - 1,
        modifiedTime: r.modifiedTime,
        size: parseInt(r.size || '0', 10),
        keepForever: !!r.keepForever,
      })).reverse(); // En yeni en üstte

      return { success: true, fileId, revisions };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  async restoreFileRevision(folderName, relativeFilePath, revisionId, targetLocalPath) {
    if (!this.isConnected || !this.driveClient) return { success: false, reason: 'Drive not connected' };
    const fileId = await this.resolveFileId(folderName, relativeFilePath);
    if (!fileId) return { success: false, reason: 'Dosya Drive üzerinde bulunamadı.' };

    await fs.promises.mkdir(path.dirname(targetLocalPath), { recursive: true });
    const dest = fs.createWriteStream(targetLocalPath);

    const res = await this.withRetry(() =>
      this.driveClient.revisions.get(
        { fileId, revisionId, alt: 'media' },
        { responseType: 'stream' }
      )
    );

    await new Promise((resolve, reject) => {
      res.data
        .pipe(dest)
        .on('finish', resolve)
        .on('error', reject);
    });

    return { success: true, targetLocalPath };
  }
}

module.exports = DriveService;

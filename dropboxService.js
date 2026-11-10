const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');

https.globalAgent.keepAlive = true;
https.globalAgent.maxSockets = 256;
https.globalAgent.maxFreeSockets = 64;
http.globalAgent.keepAlive = true;
http.globalAgent.maxSockets = 256;
http.globalAgent.maxFreeSockets = 64;

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

const DROPBOX_PORT = 53682;
const DROPBOX_REDIRECT_URI = `http://localhost:${DROPBOX_PORT}/`;
const DEFAULT_DROPBOX_CLIENT_ID = '5jcck7diasz0rqy';
const DEFAULT_DROPBOX_CLIENT_SECRET = '1n9m04y2zx7bf26';

class DropboxService {
  constructor(configDir) {
    this.configDir = configDir;
    this.tokensPath = path.join(configDir, 'dropbox-tokens.json');
    this.settingsPath = path.join(configDir, 'settings.json');

    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.clientId = DEFAULT_DROPBOX_CLIENT_ID;
    this.clientSecret = DEFAULT_DROPBOX_CLIENT_SECRET;

    this.isConnected = false;
    this.userEmail = null;
    this.userName = null;
    this.authServer = null;

    this.speedTracker = new SpeedTracker();
    this.syncPriority = 'turbo';

    this.queue = [];
    this.isProcessingQueue = false;
    this.cancelledFolders = new Set();
    this.activeStreams = new Map(); // folderName -> Set<Stream>
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
    // Dropbox API v2: Aynı dizine eşzamanlı yazmalar "too_many_write_operations" (409) hatası üretir.
    // Sıralı tekil aktarım Dropbox için %100 istikrarlı ve en hızlı yöntemdir.
    return 1;
  }

  getStreamBufferSize() {
    if (this.syncPriority === 'turbo') return 4 * 1024 * 1024;
    if (this.syncPriority === 'eco') return 512 * 1024;
    return 2 * 1024 * 1024;
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

  clearCancelledFolder(folderName) {
    if (!folderName) return;
    this.cancelledFolders.delete(folderName);
  }

  getStatus() {
    return {
      connected: this.isConnected,
      email: this.userEmail,
      name: this.userName,
      cloud: 'dropbox',
    };
  }

  async init() {
    this.loadSettings();

    if (fs.existsSync(this.tokensPath)) {
      try {
        const raw = fs.readFileSync(this.tokensPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && (data.accessToken || data.token)) {
          this.accessToken = data.accessToken || data.token;
          this.refreshToken = data.refreshToken || null;
          this.expiresAt = data.expiresAt || 0;
          this.userEmail = data.email || null;
          this.userName = data.name || 'Dropbox User';
          this.clientId = data.clientId || this.clientId;
          this.clientSecret = data.clientSecret || '';

          // Hesabı doğrula
          const verified = await this.verifyAccount();
          if (verified) {
            this.isConnected = true;
            console.log(`[DropboxService] Dropbox hesabı başarıyla doğrulandı (${this.userEmail}).`);
            return { success: true, email: this.userEmail };
          }
        }
      } catch (err) {
        console.warn('[DropboxService] Token yükleme hatası:', err.message);
      }
    }

    this.isConnected = false;
    return { success: false, connected: false };
  }

  async verifyAccount() {
    if (!this.accessToken) return false;
    try {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (res.ok) {
        const user = await res.json();
        this.userEmail = user.email || this.userEmail;
        this.userName = (user.name && user.name.display_name) || this.userName;
        this.isConnected = true;
        return true;
      }

      // Token süresi dolmuşsa refresh dene
      if (res.status === 401 && this.refreshToken && this.clientId) {
        return await this.refreshAccessToken();
      }
    } catch (e) {
      console.warn('[DropboxService] verifyAccount hatası:', e.message);
    }
    return false;
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientId) return false;
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
      });
      if (this.clientSecret) {
        params.append('client_secret', this.clientSecret);
      }

      const res = await fetch('https://api.dropbox.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (res.ok) {
        const data = await res.json();
        this.accessToken = data.access_token;
        this.expiresAt = Date.now() + (data.expires_in || 14400) * 1000;
        this.saveTokens();
        return true;
      }
    } catch (e) {
      console.error('[DropboxService] Token refresh hatası:', e.message);
    }
    return false;
  }

  saveTokens() {
    try {
      if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
      fs.writeFileSync(
        this.tokensPath,
        JSON.stringify(
          {
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiresAt: this.expiresAt,
            email: this.userEmail,
            name: this.userName,
            clientId: this.clientId,
            clientSecret: this.clientSecret,
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (e) {
      console.error('[DropboxService] Token kaydetme hatası:', e);
    }
  }

  async saveAccessToken(token, email = null) {
    this.accessToken = token;
    this.userEmail = email;
    const verified = await this.verifyAccount();
    if (verified) {
      this.saveTokens();
      return { success: true, email: this.userEmail, name: this.userName };
    }
    return { success: false, error: 'Token doğrulanamadı. Lütfen geçerli bir Dropbox token girin.' };
  }

  closeAuthServer() {
    if (this.authServer) {
      try {
        this.authServer.close();
      } catch (e) {}
      this.authServer = null;
    }
  }

  async startAuthServer(customClientId = null, customClientSecret = null) {
    this.clientId = customClientId || DEFAULT_DROPBOX_CLIENT_ID;
    this.clientSecret = customClientSecret || DEFAULT_DROPBOX_CLIENT_SECRET;

    this.closeAuthServer();

    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(
      this.clientId
    )}&response_type=code&token_access_type=offline&redirect_uri=${encodeURIComponent(
      DROPBOX_REDIRECT_URI
    )}`;

    return new Promise((resolve, reject) => {
      this.authServer = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url, true);
          if (reqUrl.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
          }
          const code = reqUrl.query && reqUrl.query.code;
          if (code) {
            const tokenParams = new URLSearchParams({
              code,
              grant_type: 'authorization_code',
              client_id: this.clientId,
              client_secret: this.clientSecret,
              redirect_uri: DROPBOX_REDIRECT_URI,
            });

            const tokenRes = await fetch('https://api.dropbox.com/oauth2/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: tokenParams.toString(),
            });

            if (tokenRes.ok) {
              const tokenData = await tokenRes.json();
              this.accessToken = tokenData.access_token;
              this.refreshToken = tokenData.refresh_token || null;
              this.expiresAt = Date.now() + (tokenData.expires_in || 14400) * 1000;

              await this.verifyAccount();
              this.saveTokens();

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                  <title>Squirrel - Dropbox Bağlantısı Başarılı</title>
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #1e293b; border: 1px solid #334155; padding: 40px; border-radius: 12px; text-align: center; max-width: 440px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                    h1 { color: #0061fe; font-size: 24px; margin-bottom: 12px; }
                    p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
                    .email { color: #38bdf8; font-weight: 700; }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <div style="font-size: 48px; margin-bottom: 16px;">📦 🐿️</div>
                    <h1>Dropbox Bağlantısı Başarılı!</h1>
                    <p>Dropbox hesabı (<span class="email">${this.userEmail || 'Bağlandı'}</span>) Squirrel ile başarıyla eşleştirildi.</p>
                    <p>Bu sekmeyi kapatıp Squirrel uygulamasına dönebilirsiniz.</p>
                  </div>
                </body>
                </html>
              `);

              setTimeout(() => {
                this.closeAuthServer();
              }, 2000);

              return;
            } else {
              const errBody = await tokenRes.text();
              console.error('[DropboxService] Token exchange hatası:', errBody);
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<h3>Dropbox yetkilendirme hatası oluştu: ${errBody}</h3>`);
              return;
            }
          }

          if (reqUrl.query && reqUrl.query.error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h3>Yetkilendirme iptal edildi. Bu sekmeyi kapatabilirsiniz.</h3>');
            setTimeout(() => this.closeAuthServer(), 1500);
            return;
          }
        } catch (serverErr) {
          console.error('[DropboxService] Callback hatası:', serverErr);
        }
      });

      this.authServer.listen(DROPBOX_PORT, () => {
        resolve(authUrl);
      });

      this.authServer.on('error', (err) => {
        console.error('[DropboxService] Auth sunucu hatası:', err.message);
        reject(err);
      });
    });
  }

  async disconnect() {
    this.isConnected = false;
    this.accessToken = null;
    this.refreshToken = null;
    this.userEmail = null;
    try {
      if (fs.existsSync(this.tokensPath)) fs.unlinkSync(this.tokensPath);
    } catch (e) {}
    return { success: true };
  }

  formatDropboxPath(rootFolderName, relPath) {
    const cleanRel = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return `/Squirrel/${rootFolderName}/${cleanRel}`.replace(/\/+/g, '/');
  }

  async acquireDirectoryLock(dirPath, timeoutMs = 60000) {
    if (!this.activeDirectoryLocks) this.activeDirectoryLocks = new Set();
    const start = Date.now();
    while (this.activeDirectoryLocks.has(dirPath)) {
      if (Date.now() - start > timeoutMs) {
        console.warn(`[DropboxService] Dizin kilidi zamanaşımı (${dirPath}), serbest bırakılıyor.`);
        this.activeDirectoryLocks.delete(dirPath);
        break;
      }
      await new Promise((r) => setTimeout(r, 60 + Math.floor(Math.random() * 50)));
    }
    this.activeDirectoryLocks.add(dirPath);
  }

  releaseDirectoryLock(dirPath) {
    if (this.activeDirectoryLocks) {
      this.activeDirectoryLocks.delete(dirPath);
    }
  }

  async fetchDropboxFilesRecursive(rootFolderName) {
    const fileMap = new Map();
    if (!this.isConnected || !this.accessToken) return fileMap;

    const rootPath = `/Squirrel/${rootFolderName}`;
    try {
      let res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: rootPath,
          recursive: true,
          include_media_info: false,
          include_deleted: false,
          limit: 2000,
        }),
      });

      if (!res.ok) {
        // Klasör henüz Dropbox'ta yoksa (409 vb.) boş harita dön
        return fileMap;
      }

      let data = await res.json();
      const processEntries = (entries) => {
        for (const entry of entries || []) {
          if (entry['.tag'] === 'file' && entry.path_display) {
            const normPath = entry.path_display.replace(/\\/g, '/');
            const prefix = `${rootPath}/`.toLowerCase();
            let rel = '';
            if (normPath.toLowerCase().startsWith(prefix)) {
              rel = normPath.slice(prefix.length);
            } else {
              const idx = normPath.toLowerCase().indexOf(`/${rootFolderName.toLowerCase()}/`);
              if (idx !== -1) {
                rel = normPath.slice(idx + rootFolderName.length + 2);
              }
            }
            if (rel) {
              fileMap.set(rel.toLowerCase(), {
                name: entry.name,
                size: entry.size,
                id: entry.id,
                rel,
              });
            }
          }
        }
      };

      processEntries(data.entries);

      while (data.has_more && data.cursor) {
        const contRes = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cursor: data.cursor }),
        });
        if (!contRes.ok) break;
        data = await contRes.json();
        processEntries(data.entries);
      }
    } catch (err) {
      console.warn(`[DropboxService] Klasör listesi alınırken istisna [${rootFolderName}]:`, err.message);
    }
    return fileMap;
  }

  async uploadFile(localFullPath, relativePath, rootFolderName, maxRetries = 15) {
    if (!this.isConnected || !this.accessToken) {
      return { success: false, failed: true, error: 'Dropbox bağlı değil' };
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

    const dbxPath = this.formatDropboxPath(rootFolderName, relativePath);
    const dbxDir = path.posix.dirname(dbxPath);
    const fileName = path.basename(localFullPath);
    const bufferSize = this.getStreamBufferSize();

    // Dizin bazında kilit mekanizması: Aynı dizine aynı anda yalnızca 1 yazma commit'i yapılır
    await this.acquireDirectoryLock(dbxDir);

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (this.cancelledFolders.has(rootFolderName)) {
          return { action: 'cancelled' };
        }

        try {
          const readStream = fs.createReadStream(localFullPath, { highWaterMark: bufferSize });
          if (!this.activeStreams.has(rootFolderName)) {
            this.activeStreams.set(rootFolderName, new Set());
          }
          this.activeStreams.get(rootFolderName).add(readStream);
          const cleanup = () => {
            const sSet = this.activeStreams.get(rootFolderName);
            if (sSet) sSet.delete(readStream);
          };
          readStream.on('close', cleanup);
          readStream.on('error', cleanup);

          readStream.on('data', (chunk) => {
            if (this.speedTracker) {
              this.speedTracker.recordDisk(chunk.length);
              this.speedTracker.recordNet(chunk.length);
            }
          });

          const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Dropbox-API-Arg': JSON.stringify({
                path: dbxPath,
                mode: 'overwrite',
                autorename: false,
                mute: true,
                strict_conflict: false,
              }),
              'Content-Type': 'application/octet-stream',
            },
            body: readStream,
            duplex: 'half',
          });

          cleanup();

          if (res.ok) {
            return {
              success: true,
              action: 'created',
              fileName,
              size: stats.size,
            };
          }

          const errText = await res.text();
          const isRateLimit = res.status === 429 || res.status === 409 || errText.includes('too_many_write_operations') || errText.includes('too_many_requests');
          const isServerError = res.status >= 500 && res.status < 600;

          if ((isRateLimit || isServerError) && attempt < maxRetries) {
            let retrySec = 1;
            try {
              const parsed = JSON.parse(errText);
              if (parsed) {
                if (typeof parsed.retry_after === 'number') retrySec = parsed.retry_after;
                else if (parsed.error && typeof parsed.error.retry_after === 'number') retrySec = parsed.error.retry_after;
                else if (parsed.error && parsed.error.reason && typeof parsed.error.reason.retry_after === 'number') retrySec = parsed.error.reason.retry_after;
              }
            } catch (e) {}
            const headerRetry = parseInt(res.headers.get('retry-after'), 10);
            if (!isNaN(headerRetry) && headerRetry > 0) retrySec = headerRetry;

            const baseWait = Math.max(1500, retrySec * 1000);
            const waitMs = Math.min(15000, Math.round(baseWait * Math.pow(1.3, attempt - 1)) + Math.floor(Math.random() * 800) + 200);
            console.warn(`[DropboxService] Rate limit / lock encountered (${fileName}). Waiting ${waitMs}ms before retry (${attempt}/${maxRetries})...`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }

          console.error(`[DropboxService] Upload error [${fileName}]:`, errText);
          return { success: false, failed: true, action: 'error', error: errText };
        } catch (err) {
          if (attempt < maxRetries) {
            const waitMs = 1000 * attempt + Math.floor(Math.random() * 400);
            console.warn(`[DropboxService] Network exception (${err.message}). Retrying in ${waitMs}ms [${fileName}] (${attempt}/${maxRetries})...`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          console.error(`[DropboxService] Upload exception [${fileName}]:`, err.message);
          return { success: false, failed: true, action: 'error', error: err.message };
        }
      }
    } finally {
      this.releaseDirectoryLock(dbxDir);
    }
  }

  async runConcurrentUploads(files, rootFolderName, onFileDone = null) {
    if (!files || files.length === 0) return;
    const concurrency = Math.min(this.getConcurrency(), files.length);
    let index = 0;

    const worker = async (workerId) => {
      if (workerId > 0) {
        await new Promise((r) => setTimeout(r, workerId * 45));
      }

      while (index < files.length) {
        if (this.cancelledFolders.has(rootFolderName)) break;
        const item = files[index++];
        if (!item) break;
        try {
          const res = await this.uploadFile(item.fullPath || item.full, item.relativePath || item.rel, rootFolderName);
          if (res && res.failed) {
            console.warn(`[Dropbox] File skipped (${item.name || item.rel}):`, res.error);
          }
          if (onFileDone) onFileDone(item, res && res.failed ? new Error(res.error) : null);
        } catch (err) {
          console.error(`[Dropbox] File upload failed (${item.name || item.rel}):`, err.message);
          if (onFileDone) onFileDone(item, err);
        }
        // Dropbox rate limit prevention delay
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker(i));
    }
    await Promise.all(workers);
  }

  async uploadDirectory(dirPath, relativeDir, rootPath, rootFolderName, onProgress) {
    if (!this.isConnected || !this.accessToken) return { success: false };

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
    if (!this.isConnected || !this.accessToken) return { success: false };
    const dbxPath = this.formatDropboxPath(rootFolderName, relativePath);

    try {
      const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dbxPath }),
      });

      return { success: res.ok, action: 'deleted' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async deleteFolderRoot(rootFolderName) {
    if (!this.isConnected || !this.accessToken) return { success: false };
    const dbxPath = `/Squirrel/${rootFolderName}`;

    try {
      const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dbxPath }),
      });

      return { success: true };
    } catch (err) {
      console.error(`[DropboxService] Klasör silme hatası [${rootFolderName}]:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async reconcileWithDropbox(folderPath, rootFolderName, onProgress) {
    if (!this.isConnected || !this.accessToken || !folderPath) {
      return { success: false, error: 'Dropbox bağlı değil' };
    }

    this.clearCancelledFolder(rootFolderName);

    // 1. Yerel dosyaları tara
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

    // 2. Dropbox üzerindeki mevcut dosyaları hızlıca tara (ListFolder)
    console.log(`[DropboxService] [${rootFolderName}] Dropbox üzerindeki mevcut dosyalar taranıyor...`);
    const remoteFilesMap = await this.fetchDropboxFilesRecursive(rootFolderName);
    console.log(`[DropboxService] [${rootFolderName}] Dropbox'ta ${remoteFilesMap.size} dosya bulundu.`);

    // 3. Sadece eksik veya boyutu değişmiş dosyaları filtrele
    const filesToUpload = [];
    let alreadySyncedBytes = 0;

    for (const lf of localFiles) {
      const remote = remoteFilesMap.get(lf.rel.toLowerCase());
      if (remote && remote.size === lf.size) {
        alreadySyncedBytes += lf.size;
        continue; // Birebir aynı, yükleme gereksiz
      }
      filesToUpload.push(lf);
    }

    console.log(`[DropboxService] [${rootFolderName}] Eşitleme özeti: Toplam ${totalFiles} dosya, ${totalFiles - filesToUpload.length} dosya zaten eşit, ${filesToUpload.length} dosya yüklenecek.`);

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

    if (this.cancelledFolders.has(rootFolderName)) {
      return { success: false, cancelled: true };
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
            console.warn('[Dropbox Queue Görev Hatası]:', err.message);
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

module.exports = DropboxService;

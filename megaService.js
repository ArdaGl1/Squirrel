const fs = require('fs');
const path = require('path');
const { Storage, MutableFile } = require('megajs');

// Arka planda aktarılan veriyi ölçen, EMA filtreli pürüzsüz hız ve süre hesaplayıcı
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

class MegaService {
  constructor(configDir) {
    this.configDir = configDir;
    this.sessionPath = path.join(configDir, 'mega-session.json');
    this.credentialsPath = path.join(configDir, 'mega-credentials.json');
    this.settingsPath = path.join(configDir, 'settings.json');

    this.storage = null;
    this.isConnected = false;
    this.userEmail = null;
    this.userName = 'Mega User';

    this.speedTracker = new SpeedTracker();
    this.syncPriority = 'turbo';

    this.queue = [];
    this.isProcessingQueue = false;
    this.cancelledFolders = new Set();
    this.activeStreams = new Map(); // folderName -> Set<{ readStream, uploadStream }>

    // `${folderName}::${relDir}` -> MutableFile
    this.dirNodeCache = new Map();
    this.squirrelRoot = null;
    this.initPromise = null;
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
    if (this.syncPriority === 'turbo') return 6;
    if (this.syncPriority === 'eco') return 2;
    return 4; // 'smart'
  }

  getBufferSize() {
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
      for (const pair of streams) {
        try {
          if (pair.readStream && typeof pair.readStream.destroy === 'function') {
            pair.readStream.destroy();
          }
          if (pair.uploadStream && typeof pair.uploadStream.destroy === 'function') {
            pair.uploadStream.destroy();
          }
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
      cloud: 'mega',
    };
  }

  async init() {
    this.loadSettings();

    // 1. Önce kayıtlı session var mı kontrol et
    if (fs.existsSync(this.sessionPath)) {
      try {
        const sessionRaw = fs.readFileSync(this.sessionPath, 'utf8');
        const sessionData = JSON.parse(sessionRaw);
        if (sessionData && sessionData.email) {
          console.log(`[MegaService] Kayıtlı Mega oturumu yükleniyor (${sessionData.email})...`);
          const storage = Storage.fromJSON(sessionData);
          await storage.ready;
          this.storage = storage;
          this.isConnected = true;
          this.userEmail = sessionData.email;
          this.userName = storage.name || sessionData.email;
          await this.getSquirrelRoot();
          console.log(`[MegaService] Mega oturumu başarıyla açıldı.`);
          return { success: true, email: this.userEmail };
        }
      } catch (err) {
        console.warn('[MegaService] Mega session ile bağlanılamadı:', err.message);
      }
    }

    // 2. Credentials varsa login dene
    if (fs.existsSync(this.credentialsPath)) {
      try {
        const credsRaw = fs.readFileSync(this.credentialsPath, 'utf8');
        const { email, password } = JSON.parse(credsRaw);
        if (email && password) {
          console.log(`[MegaService] Mega kimlik bilgileriyle giriş yapılıyor (${email})...`);
          return await this.login(email, password, false);
        }
      } catch (err) {
        console.warn('[MegaService] Mega credentials ile bağlanılamadı:', err.message);
      }
    }

    this.isConnected = false;
    return { success: false, connected: false };
  }

  async login(email, password, saveCreds = true) {
    return new Promise((resolve) => {
      try {
        console.log(`[MegaService] Mega'ya bağlanılıyor: ${email}...`);
        const storage = new Storage({ email, password, keepalive: true }, async (err) => {
          if (err) {
            console.error('[MegaService] Mega giriş hatası:', err.message);
            this.isConnected = false;
            let friendlyError = err.message;
            if (err.message.includes('ENOENT') || err.message.includes('password') || err.message.includes('-9')) {
              friendlyError = 'E-posta veya parola hatalı.';
            } else if (err.message.includes('EACCESS') || err.message.includes('-11')) {
              friendlyError = 'Erişim engellendi. Hesabınız geçici olarak kilitlenmiş olabilir.';
            }
            return resolve({ success: false, error: friendlyError });
          }

          try {
            await storage.ready;
            this.storage = storage;
            this.isConnected = true;
            this.userEmail = email;
            this.userName = storage.name || email;

            // Session'ı diske kaydet
            try {
              const sessionJson = storage.toJSON();
              sessionJson.email = email;
              fs.writeFileSync(this.sessionPath, JSON.stringify(sessionJson, null, 2), 'utf8');
            } catch (se) {
              console.warn('[MegaService] Session kaydedilemedi:', se.message);
            }

            if (saveCreds) {
              try {
                fs.writeFileSync(this.credentialsPath, JSON.stringify({ email, password }, null, 2), 'utf8');
              } catch (ce) {}
            }

            // Kök Squirrel klasörünü hazırla
            await this.getSquirrelRoot();

            console.log(`[MegaService] Mega hesabı başarıyla bağlandı: ${email}`);
            resolve({ success: true, email: this.userEmail, name: this.userName });
          } catch (readyErr) {
            console.error('[MegaService] Storage ready hatası:', readyErr.message);
            resolve({ success: false, error: readyErr.message });
          }
        });
      } catch (e) {
        console.error('[MegaService] Beklenmeyen login hatası:', e.message);
        resolve({ success: false, error: e.message });
      }
    });
  }

  async disconnect() {
    this.isConnected = false;
    this.userEmail = null;
    this.storage = null;
    this.squirrelRoot = null;
    this.dirNodeCache.clear();

    try {
      if (fs.existsSync(this.sessionPath)) fs.unlinkSync(this.sessionPath);
    } catch (e) {}
    try {
      if (fs.existsSync(this.credentialsPath)) fs.unlinkSync(this.credentialsPath);
    } catch (e) {}

    return { success: true };
  }

  async getSquirrelRoot() {
    if (this.squirrelRoot) return this.squirrelRoot;
    if (!this.storage || !this.storage.root) throw new Error('Mega depolama alanı hazır değil.');

    const children = this.storage.root.children || [];
    let rootFolder = children.find((c) => c.name === 'Squirrel' && c.directory);
    if (!rootFolder) {
      console.log('[MegaService] "Squirrel" ana klasörü Mega üzerinde oluşturuluyor...');
      rootFolder = await this.storage.mkdir('Squirrel');
    }
    this.squirrelRoot = rootFolder;
    return rootFolder;
  }

  async getTargetDirectoryNode(rootFolderName, relDir = '') {
    const squirrel = await this.getSquirrelRoot();
    const normDir = (relDir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const cacheKey = `${rootFolderName}::${normDir}`;

    if (this.dirNodeCache.has(cacheKey)) {
      return this.dirNodeCache.get(cacheKey);
    }

    // 1. rootFolderName klasörünü bul veya oluştur
    let rootChildren = squirrel.children || [];
    let folderNode = rootChildren.find((c) => c.name === rootFolderName && c.directory);
    if (!folderNode) {
      folderNode = await squirrel.mkdir(rootFolderName);
    }

    if (!normDir) {
      this.dirNodeCache.set(cacheKey, folderNode);
      return folderNode;
    }

    // 2. Alt klasörleri sıra ile oluştur veya bul
    const segments = normDir.split('/').filter(Boolean);
    let current = folderNode;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const curChildren = current.children || [];
      let next = curChildren.find((c) => c.name === seg && c.directory);
      if (!next) {
        next = await current.mkdir(seg);
      }
      current = next;
    }

    this.dirNodeCache.set(cacheKey, current);
    return current;
  }

  async uploadFile(localFullPath, relativePath, rootFolderName) {
    if (!this.isConnected || !this.storage) {
      return { success: false, failed: true, error: 'Mega bağlı değil' };
    }

    if (rootFolderName && this.cancelledFolders.has(rootFolderName)) {
      return { action: 'cancelled' };
    }

    if (!fs.existsSync(localFullPath)) {
      return { success: false, action: 'skipped', reason: 'Local file does not exist' };
    }

    let stats;
    try {
      stats = fs.statSync(localFullPath);
    } catch (e) {
      return { success: false, action: 'skipped', reason: e.message };
    }

    const normRel = (relativePath || '').replace(/\\/g, '/');
    const parentDir = path.dirname(normRel) === '.' ? '' : path.dirname(normRel);
    const fileName = path.basename(localFullPath);

    try {
      const targetDir = await this.getTargetDirectoryNode(rootFolderName, parentDir);

      // Mevcut dosya var mı kontrol et ve mükerrer kopyaları temizle
      const existingChildren = targetDir.children || [];
      const matchingFiles = existingChildren.filter((c) => c.name === fileName && !c.directory);

      let action = 'created';
      if (matchingFiles.length > 0) {
        // En son yüklenmiş veya boyutu eşleşen dosyayı kontrol et
        const perfectMatch = matchingFiles.find((c) => c.size === stats.size);
        if (perfectMatch) {
          // Fazlalık mükerrer kopyaları temizle
          for (const extra of matchingFiles) {
            if (extra !== perfectMatch) {
              try { await extra.delete(true); } catch (e) {}
            }
          }
          return {
            success: true,
            action: 'identical',
            fileName,
            size: stats.size,
            fileId: perfectMatch.nodeId,
          };
        }

        // Boyut farklıysa tüm eski kopyaları sil
        action = 'updated';
        for (const oldFile of matchingFiles) {
          try {
            await oldFile.delete(true);
          } catch (delErr) {
            console.warn('[MegaService] Eski dosya silinirken uyarı:', delErr.message);
          }
        }
      }

      if (rootFolderName && this.cancelledFolders.has(rootFolderName)) {
        return { action: 'cancelled' };
      }

      const bufferSize = this.getBufferSize();
      const uploadStream = targetDir.upload({
        name: fileName,
        size: stats.size,
      });

      const readStream = fs.createReadStream(localFullPath, { highWaterMark: bufferSize });
      const streamPair = { readStream, uploadStream };

      if (!this.activeStreams.has(rootFolderName)) {
        this.activeStreams.set(rootFolderName, new Set());
      }
      this.activeStreams.get(rootFolderName).add(streamPair);

      const cleanupStream = () => {
        const sSet = this.activeStreams.get(rootFolderName);
        if (sSet) sSet.delete(streamPair);
      };
      readStream.on('close', cleanupStream);
      readStream.on('error', cleanupStream);

      readStream.on('data', (chunk) => {
        if (this.speedTracker) {
          this.speedTracker.recordDisk(chunk.length);
          this.speedTracker.recordNet(chunk.length);
        }
      });

      readStream.pipe(uploadStream);
      const uploadedFile = await uploadStream.complete;
      cleanupStream();

      // Mega bellek içi dosya ağacına ekle ki aynı oturumdaki diğer kontroller mükerrer yükleme yapmasın
      if (uploadedFile && targetDir.children && !targetDir.children.includes(uploadedFile)) {
        targetDir.children.push(uploadedFile);
      }

      return {
        success: true,
        action,
        fileName,
        size: stats.size,
        fileId: uploadedFile ? uploadedFile.nodeId : null,
      };
    } catch (err) {
      console.error(`[MegaService] Dosya yükleme hatası [${fileName}]:`, err.message);
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
            console.warn(`[Mega] Dosya atlandı (${item.name || item.rel}):`, res.error);
          }
          if (onFileDone) onFileDone(item, res && res.failed ? new Error(res.error) : null);
        } catch (err) {
          console.error(`[Mega] Dosya aktarılamadı (${item.name || item.rel}):`, err.message);
          if (onFileDone) onFileDone(item, err);
        }
        await new Promise((r) => setTimeout(r, 30));
      }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  async uploadDirectory(dirPath, relativeDir, rootPath, rootFolderName, onProgress) {
    if (!this.isConnected || !this.storage) return { success: false };

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
    if (!this.isConnected || !this.storage) return { success: false };

    const normRel = (relativePath || '').replace(/\\/g, '/');
    const parentDir = path.dirname(normRel) === '.' ? '' : path.dirname(normRel);
    const targetName = path.basename(normRel);

    try {
      const targetDir = await this.getTargetDirectoryNode(rootFolderName, parentDir);
      const children = targetDir.children || [];
      const item = children.find((c) => c.name === targetName);
      if (item) {
        await item.delete(true);
        return { success: true, action: 'deleted' };
      }
      return { success: true, action: 'not_found' };
    } catch (err) {
      console.error(`[MegaService] Silme hatası [${targetName}]:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async deleteFolderRoot(rootFolderName) {
    if (!this.isConnected || !this.storage) return { success: false };
    try {
      console.log(`[MegaService] "${rootFolderName}" klasörü Mega üzerinden siliniyor...`);
      const squirrel = await this.getSquirrelRoot();

      let rootItem = (squirrel.children || []).find((c) => c.name === rootFolderName && c.directory);
      if (!rootItem && this.storage.root) {
        rootItem = (this.storage.root.children || []).find((c) => c.name === rootFolderName && c.directory);
      }
      if (!rootItem && typeof this.storage.find === 'function') {
        rootItem = this.storage.find((f) => f.name === rootFolderName && f.directory);
      }

      if (rootItem) {
        try {
          await rootItem.delete(true);
        } catch (delErr) {
          console.warn('[MegaService] delete(true) uyarısı, çöpe taşınıyor:', delErr.message);
          try {
            await rootItem.delete(false);
          } catch (trashErr) {
            console.error('[MegaService] Çöpe taşıma da başarısız:', trashErr.message);
          }
        }

        if (rootItem.parent && Array.isArray(rootItem.parent.children)) {
          rootItem.parent.children = rootItem.parent.children.filter((c) => c !== rootItem);
        }
        if (squirrel.children) {
          squirrel.children = squirrel.children.filter((c) => c !== rootItem);
        }

        // Cache'i temizle
        for (const k of Array.from(this.dirNodeCache.keys())) {
          if (k === `${rootFolderName}::` || k.startsWith(`${rootFolderName}::`)) {
            this.dirNodeCache.delete(k);
          }
        }
        console.log(`[MegaService] "${rootFolderName}" klasörü Mega'dan silindi.`);
        return { success: true };
      }

      console.warn(`[MegaService] "${rootFolderName}" Mega üzerinde bulunamadı.`);
      return { success: true, notFound: true };
    } catch (err) {
      console.error(`[MegaService] Kök klasör silme hatası [${rootFolderName}]:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async reconcileWithMega(folderPath, rootFolderName, onProgress) {
    if (!this.isConnected || !this.storage || !folderPath) {
      return { success: false, error: 'Mega bağlı değil' };
    }

    this.clearCancelledFolder(rootFolderName);
    const targetDir = await this.getTargetDirectoryNode(rootFolderName, '');

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

    // 2. Mega üzerindeki dosyaları tara
    const megaFiles = [];
    const walkMega = (node, prefix = '') => {
      const children = node.children || [];
      for (const child of children) {
        const rel = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.directory) {
          walkMega(child, rel);
        } else {
          megaFiles.push({ node: child, rel, size: child.size, name: child.name });
        }
      }
    };
    walkMega(targetDir);

    const megaMap = new Map();
    for (const mf of megaFiles) {
      megaMap.set(mf.rel, mf);
    }

    // 3. Eksik veya boyutu farklı dosyaları belirle
    const toUpload = [];
    for (const lf of localFiles) {
      const existing = megaMap.get(lf.rel);
      if (!existing || existing.size !== lf.size) {
        toUpload.push(lf);
      }
    }

    const totalToUpload = toUpload.length;
    let uploadedCount = 0;
    let totalBytesToUpload = toUpload.reduce((sum, f) => sum + f.size, 0);
    let uploadedBytes = 0;

    this.speedTracker = new SpeedTracker();

    if (toUpload.length > 0) {
      await this.runConcurrentUploads(toUpload, rootFolderName, (fileItem, err) => {
        if (!err) {
          uploadedCount++;
          uploadedBytes += fileItem.size || 0;
        }
        const remainingBytes = Math.max(0, totalBytesToUpload - uploadedBytes);
        const speeds = this.speedTracker
          ? this.speedTracker.getSpeeds(remainingBytes)
          : { diskSpeed: 0, netSpeed: 0, netSpeedMbps: 0, etaSec: 0 };

        if (onProgress) {
          const percent = totalToUpload > 0 ? Math.round((uploadedCount / totalToUpload) * 100) : 100;
          const isDone = uploadedCount === totalToUpload;
          onProgress({
            folderName: rootFolderName,
            current: uploadedCount,
            total: totalToUpload,
            percent,
            fileName: fileItem.name,
            currentFile: fileItem.name,
            currentBytes: uploadedBytes,
            uploadedBytes,
            totalBytes: totalBytesToUpload,
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
      onProgress({
        folderName: rootFolderName,
        current: totalToUpload,
        total: totalToUpload,
        percent: 100,
        fileName: '',
        currentFile: 'All files synced',
        currentBytes: totalBytesToUpload,
        uploadedBytes: totalBytesToUpload,
        totalBytes: totalBytesToUpload,
        netSpeed: 0,
        diskSpeed: 0,
        netSpeedMbps: 0,
        speed: 0,
        etaSec: 0,
        done: true,
        action: 'completed',
      });
    }

    return {
      success: true,
      totalFiles: localFiles.length,
      uploadedCount,
    };
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
            console.warn('[MegaService Queue Görev Hatası]:', err.message);
            resolve({ error: err.message });
          }
        }
      };

      const workers = [];
      for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
    } finally {
      this.isProcessingQueue = false;
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }
  }
}

module.exports = MegaService;

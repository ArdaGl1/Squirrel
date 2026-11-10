// diagnosticsService.js - Real-time Sync Transparency, Queue & Issues Inspector
// Tracks active operations, queued tasks, and provides plain-English root causes for unsynced files.

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const net = require('net');

class DiagnosticsService extends EventEmitter {
  constructor() {
    super();
    // issues: Map<id, IssueObject>
    this.issues = new Map();
    // activeOperations: Map<folderName, OperationObject>
    this.activeOperations = new Map();
    // queuedTasks: Array<TaskObject>
    this.queuedTasks = [];
    // recentSynced: Array<HistoryObject> (Max 50)
    this.recentSynced = [];
    // retryTimers: Map<id, NodeJS.Timeout>
    this.retryTimers = new Map();
    // Background poller when offline issues exist
    this._internetPoller = null;
  }

  // Generate consistent issue ID
  getIssueId(folderName, relativePath) {
    const norm = (relativePath || '').replace(/\\/g, '/');
    return `${folderName}::${norm}`;
  }

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Clean raw error strings, stripping out ugly internal Google API query URLs
  cleanRawMessage(raw) {
    if (!raw) return 'Unknown error';
    let str = String(raw);
    const reasonMatch = str.match(/failed, reason:\s*(.+)/i);
    if (reasonMatch) {
      str = reasonMatch[1].trim();
    }
    if (str.includes('ENOTFOUND') || str.includes('getaddrinfo')) {
      return 'No internet connection (DNS lookup failed for cloud server)';
    }
    str = str.replace(/https:\/\/www\.googleapis\.com\/[^\s,]+/gi, '[Google Drive API]');
    str = str.replace(/https:\/\/[^\s,]+/gi, '[Cloud Server]');
    return str;
  }

  categorizeError(err, filePath = '') {
    const code = (err && (err.code || err.errno) ? String(err.code || err.errno) : '').toUpperCase();
    const rawMessage = err && err.message ? String(err.message) : String(err || '');
    const message = rawMessage.toLowerCase();

    // 1. No Internet Connection / Offline / DNS resolution failure (Check this FIRST!)
    if (
      code === 'ENOTFOUND' ||
      code === 'ENETUNREACH' ||
      code === 'EHOSTUNREACH' ||
      code === 'EAI_AGAIN' ||
      message.includes('enotfound') ||
      message.includes('getaddrinfo') ||
      message.includes('enetunreach') ||
      message.includes('ehostunreach') ||
      message.includes('err_internet_disconnected') ||
      message.includes('err_name_not_resolved') ||
      message.includes('err_network_changed') ||
      message.includes('no internet') ||
      message.includes('offline')
    ) {
      return {
        category: 'offline',
        code: 'NO_INTERNET',
        title: 'No Internet Connection (Offline)',
        explanation:
          'Your computer is currently disconnected from the internet. Squirrel cannot reach Google Drive servers (DNS resolution failed).',
        solution:
          'Check your Wi-Fi or Ethernet connection. Squirrel will automatically detect when your internet returns and resume syncing.',
        isRetryable: true,
      };
    }

    // 2. Network connection timeout or failure
    if (
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ESOCKETTIMEDOUT' ||
      message.includes('etimedout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('timeout') ||
      message.includes('socket hang up') ||
      message.includes('fetch failed') ||
      message.includes('network error')
    ) {
      return {
        category: 'network',
        code: code || 'ETIMEDOUT',
        title: 'Network Connection Timeout',
        explanation:
          'The connection to the cloud storage provider timed out or dropped while transferring this file.',
        solution:
          'Check your internet connection. Squirrel will automatically attempt to resume when network connectivity is restored.',
        isRetryable: true,
      };
    }

    // 3. File Locked by another application (FL Studio, DAW, Office, etc.)
    if (
      code === 'EBUSY' ||
      message.includes('ebusy') ||
      message.includes('resource busy') ||
      message.includes('locked') ||
      message.includes('used by another process') ||
      (code === 'EPERM' && message.includes('operation not permitted'))
    ) {
      return {
        category: 'locked',
        code: code || 'EBUSY',
        title: 'File Locked by Another Application',
        explanation:
          'This file is currently in use or open in another software (such as FL Studio, an audio editor, DAW, or Office). Windows places an exclusive lock on active files to prevent file corruption.',
        solution:
          'Squirrel will automatically retry when the file is saved and closed in the other application. You can also click "Retry Now" after saving.',
        isRetryable: true,
      };
    }

    // 4. Permission Denied
    if (code === 'EACCES' || code === 'EPERM' || message.includes('permission denied') || message.includes('access denied')) {
      return {
        category: 'permission',
        code: code || 'EACCES',
        title: 'File Permission Denied',
        explanation:
          'Squirrel lacks Windows read permissions for this file or directory, or the file is protected by administrator system policies.',
        solution:
          'Check the file permissions in Windows Explorer, or ensure Squirrel is running with access to this user folder.',
        isRetryable: true,
      };
    }

    // 5. Cloud Quota / Rate limit
    if (
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('user rate limit') ||
      message.includes('429') ||
      message.includes('storage full') ||
      (err && (err.status === 429 || err.status === 403))
    ) {
      return {
        category: 'quota',
        code: 'QUOTA_EXCEEDED',
        title: 'Cloud Storage Quota or Rate Limit',
        explanation:
          'Your cloud storage provider temporarily rate-limited API requests, or your cloud storage account has reached its maximum storage quota.',
        solution:
          'Check your Google Drive / Cloud storage capacity. If rate-limited, Squirrel will back off and retry automatically.',
        isRetryable: true,
      };
    }

    // 6. Missing local file (deleted before sync completed)
    if (code === 'ENOENT' || message.includes('no such file')) {
      return {
        category: 'missing',
        code: 'ENOENT',
        title: 'Local File Removed During Sync',
        explanation:
          'The file was removed, moved, or renamed locally before the cloud upload worker could read it.',
        solution:
          'No action required. Squirrel automatically synchronizes deletions to the cloud.',
        isRetryable: false,
      };
    }

    // Default: General sync error (with sanitized message, no raw URLs)
    const cleanMsg = this.cleanRawMessage(rawMessage);
    return {
      category: 'error',
      code: code || 'SYNC_ERROR',
      title: 'Cloud Upload Error',
      explanation: `An error occurred during synchronization: ${cleanMsg}.`,
      solution:
        'Verify your cloud account connection in Cloud Accounts, or click "Retry Now" to try again.',
      isRetryable: true,
    };
  }

  // True non-blocking TCP socket connectivity check to Google Public DNS (8.8.8.8:53)
  // Unlike dns.lookup with IP literals, this ACTUALLY sends a TCP SYN packet and tests internet routing.
  checkInternetConnectivity(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let done = false;
      let socket = null;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          if (socket) {
            try { socket.destroy(); } catch (e) {}
          }
          resolve(false);
        }
      }, timeoutMs);

      try {
        socket = net.createConnection({ host: '8.8.8.8', port: 53 }, () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch (e) {}
            resolve(true);
          }
        });

        socket.on('error', () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch (e) {}
            resolve(false);
          }
        });

        socket.on('timeout', () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            try { socket.destroy(); } catch (e) {}
            resolve(false);
          }
        });
      } catch (err) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }

  // Check if any active offline issues currently exist (or for a specific folder)
  hasOfflineIssues(folderName = null) {
    for (const issue of this.issues.values()) {
      if (issue.category === 'offline' && issue.status === 'active') {
        if (!folderName || issue.folderName === folderName) {
          return true;
        }
      }
    }
    return false;
  }

  // Gentle poller (every 4s) that checks if internet returned when offline issues exist
  startInternetPoller() {
    if (this._internetPoller) return;
    this._internetPoller = setInterval(async () => {
      if (!this.hasOfflineIssues()) {
        this.stopInternetPoller();
        return;
      }
      try {
        const isOnline = await this.checkInternetConnectivity(2000);
        if (isOnline) {
          console.log('[Diagnostics] 🌐 Verified online via TCP 8.8.8.8!');
          this.stopInternetPoller();
          this.clearAllOfflineIssues();
          this.emit('internet-restored');
        }
      } catch (e) {}
    }, 4000);
  }

  stopInternetPoller() {
    if (this._internetPoller) {
      clearInterval(this._internetPoller);
      this._internetPoller = null;
    }
  }

  // Clear all offline issues when internet is restored
  clearAllOfflineIssues() {
    let cleared = 0;
    for (const [id, issue] of this.issues.entries()) {
      if (issue.category === 'offline') {
        if (this.retryTimers.has(id)) {
          clearTimeout(this.retryTimers.get(id));
          this.retryTimers.delete(id);
        }
        this.issues.delete(id);
        cleared++;
      }
    }
    if (cleared > 0) {
      this.emitUpdate();
    }
    return cleared;
  }

  // Clear a single offline issue
  clearOfflineIssue(issueId) {
    if (this.retryTimers.has(issueId)) {
      clearTimeout(this.retryTimers.get(issueId));
      this.retryTimers.delete(issueId);
    }
    const existed = this.issues.delete(issueId);
    if (existed) {
      this.emitUpdate();
    }
    return existed;
  }

  // Report an issue when a file fails or is locked
  reportSyncError(folderName, folderPath, relativePath, error, meta = {}) {
    const fullPath = meta.fullPath || (folderPath && relativePath ? path.join(folderPath, relativePath) : (folderPath || relativePath || ''));
    const classification = this.categorizeError(error, fullPath);

    // 1. OFFLINE / NO INTERNET: Deduplicate and consolidate into ONLY 1 issue per folder!
    // Never spam 40-50 separate cards for files in the same disconnected folder!
    if (classification.category === 'offline') {
      const offlineId = `${folderName}::offline`;

      // Clean up any legacy per-file offline cards for this folder
      for (const [key, existingIssue] of this.issues.entries()) {
        if (existingIssue.folderName === folderName && existingIssue.category === 'offline' && key !== offlineId) {
          if (this.retryTimers.has(key)) {
            clearTimeout(this.retryTimers.get(key));
            this.retryTimers.delete(key);
          }
          this.issues.delete(key);
        }
      }

      const existing = this.issues.get(offlineId);
      const pendingFilesCount = existing ? (existing.pendingFilesCount || 1) + 1 : 1;
      const retryCount = existing ? existing.retryCount + 1 : 1;

      const issue = {
        id: offlineId,
        folderName,
        folderPath: folderPath || (existing ? existing.folderPath : ''),
        relativePath: '',
        fileName: folderName,
        fullPath: folderPath || '',
        fileSize: 0,
        fileSizeStr: '',
        category: 'offline',
        code: 'NO_INTERNET',
        title: 'No Internet Connection (Offline)',
        explanation: `Internet connection disconnected while synchronizing "${folderName}". Cloud sync is paused and will automatically resume once your connection returns (${pendingFilesCount} file(s) waiting).`,
        solution: 'Check your Wi-Fi or Ethernet connection. Squirrel will automatically detect when your internet returns, clear this message, and resume syncing.',
        isRetryable: true,
        rawError: 'No internet connection (DNS lookup failed for cloud server)',
        retryCount,
        pendingFilesCount,
        timestamp: new Date().toLocaleTimeString(),
        lastAttempt: Date.now(),
        status: 'active',
      };

      this.issues.set(offlineId, issue);
      this.startInternetPoller();
      this.emitUpdate();
      return issue;
    }

    // 2. Standard per-file issue (locked file, permission, quota, etc.)
    const id = this.getIssueId(folderName, relativePath);
    const fileName = path.basename(relativePath || folderPath || 'Unknown');
    let fileSize = meta.fileSize || 0;
    if (!fileSize && fullPath && fs.existsSync(fullPath)) {
      try {
        fileSize = fs.statSync(fullPath).size;
      } catch (e) {}
    }

    const existing = this.issues.get(id);
    const retryCount = existing ? existing.retryCount + 1 : 1;

    const issue = {
      id,
      folderName,
      folderPath,
      relativePath: (relativePath || '').replace(/\\/g, '/'),
      fileName,
      fullPath,
      fileSize,
      fileSizeStr: this.formatBytes(fileSize),
      category: classification.category,
      code: classification.code,
      title: classification.title,
      explanation: classification.explanation,
      solution: classification.solution,
      isRetryable: classification.isRetryable,
      rawError: error && error.message ? error.message : String(error),
      retryCount,
      timestamp: new Date().toLocaleTimeString(),
      lastAttempt: Date.now(),
      status: 'active',
    };

    this.issues.set(id, issue);
    this.emitUpdate();

    // Auto-retry for locked files (after 6s) and network timeouts (after 12s)
    if (classification.category === 'locked') {
      this.scheduleAutoRetry(id, folderName, fullPath, relativePath, 6000);
    } else if (classification.category === 'network') {
      this.scheduleAutoRetry(id, folderName, fullPath, relativePath, 12000);
    }

    return issue;
  }

  // Report an excluded / oversized file for visibility in the panel
  reportExcludedFile(folderName, folderPath, relativePath, reason, rule = '') {
    const id = this.getIssueId(folderName, relativePath);
    const fileName = path.basename(relativePath);
    const fullPath = folderPath ? path.join(folderPath, relativePath) : relativePath;

    let fileSize = 0;
    if (fullPath && fs.existsSync(fullPath)) {
      try {
        fileSize = fs.statSync(fullPath).size;
      } catch (e) {}
    }

    const isOversized = reason === 'oversized';
    const issue = {
      id,
      folderName,
      folderPath,
      relativePath: (relativePath || '').replace(/\\/g, '/'),
      fileName,
      fullPath,
      fileSize,
      fileSizeStr: this.formatBytes(fileSize),
      category: isOversized ? 'oversized' : 'excluded',
      code: isOversized ? 'FILE_TOO_LARGE' : 'FILTER_EXCLUDED',
      title: isOversized ? 'File Exceeds Max Size Limit' : 'Filtered by Exclusion Rule',
      explanation: isOversized
        ? `This file (${this.formatBytes(fileSize)}) exceeds the maximum allowed size configured in Exclusions & File Filters.`
        : `This file was skipped because it matches the filter rule: "${rule || 'default pattern'}".`,
      solution: isOversized
        ? 'You can increase the maximum file size in the "Exclusions & File Filters" tab if you want this file uploaded.'
        : 'You can adjust or remove the filter rule in "Exclusions & File Filters" if you want this file synchronized.',
      isRetryable: false,
      rawError: reason,
      retryCount: 0,
      timestamp: new Date().toLocaleTimeString(),
      lastAttempt: Date.now(),
      status: 'filtered',
    };

    this.issues.set(id, issue);
    this.emitUpdate();
    return issue;
  }

  // Schedule auto-retry for locked or network-waiting files
  scheduleAutoRetry(id, folderName, fullPath, relativePath, delayMs = 6000) {
    if (this.retryTimers.has(id)) {
      clearTimeout(this.retryTimers.get(id));
    }

    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      const issue = this.issues.get(id);
      if (
        issue &&
        (issue.category === 'locked' || issue.category === 'offline' || issue.category === 'network') &&
        issue.status === 'active'
      ) {
        this.emit('retry-requested', { id, folderName, fullPath, relativePath });
      }
    }, delayMs);

    this.retryTimers.set(id, timer);
  }

  // Clear an issue when a file syncs successfully
  resolveIssue(folderName, relativePath) {
    const id = this.getIssueId(folderName, relativePath);
    if (this.retryTimers.has(id)) {
      clearTimeout(this.retryTimers.get(id));
      this.retryTimers.delete(id);
    }
    if (this.issues.has(id)) {
      this.issues.delete(id);
      this.emitUpdate();
      return true;
    }
    return false;
  }

  // Clear all issues and active operations for a specific folder (e.g. when folder is removed or untracked)
  clearFolderIssues(folderName) {
    if (!folderName) return;
    let cleared = 0;
    const target = folderName.trim().toLowerCase();
    for (const [id, issue] of this.issues.entries()) {
      if ((issue.folderName || '').trim().toLowerCase() === target) {
        if (this.retryTimers.has(id)) {
          clearTimeout(this.retryTimers.get(id));
          this.retryTimers.delete(id);
        }
        this.issues.delete(id);
        cleared++;
      }
    }
    this.activeOperations.delete(folderName);
    if (cleared > 0) {
      this.emitUpdate();
    }
  }

  // Dismiss a single issue manually
  dismissIssue(issueId) {
    if (this.retryTimers.has(issueId)) {
      clearTimeout(this.retryTimers.get(issueId));
      this.retryTimers.delete(issueId);
    }
    const existed = this.issues.delete(issueId);
    if (existed) this.emitUpdate();
    return existed;
  }

  // Clear all resolved / dismissed issues
  clearAllResolved() {
    let count = 0;
    for (const [id, issue] of this.issues.entries()) {
      if (issue.status === 'resolved' || issue.category === 'excluded') {
        this.issues.delete(id);
        count++;
      }
    }
    if (count > 0) this.emitUpdate();
    return count;
  }

  // Active Phase Tracking (Transparency for what the app is doing right now)
  setFolderPhase(folderName, phase, phaseText, meta = {}) {
    const current = this.activeOperations.get(folderName) || {};
    this.activeOperations.set(folderName, {
      folderName,
      phase, // 'scanning' | 'comparing' | 'encrypting' | 'uploading' | 'idle'
      phaseText,
      currentFile: meta.currentFile || current.currentFile || '',
      currentBytes: meta.currentBytes !== undefined ? meta.currentBytes : (current.currentBytes || 0),
      totalBytes: meta.totalBytes !== undefined ? meta.totalBytes : (current.totalBytes || 0),
      currentFiles: meta.currentFiles !== undefined ? meta.currentFiles : (current.currentFiles || 0),
      totalFiles: meta.totalFiles !== undefined ? meta.totalFiles : (current.totalFiles || 0),
      speed: meta.speed || current.speed || 0,
      etaSec: meta.etaSec !== undefined ? meta.etaSec : (current.etaSec || 0),
      updatedAt: Date.now(),
    });
    this.emitUpdate();
  }

  clearFolderPhase(folderName) {
    if (this.activeOperations.has(folderName)) {
      this.activeOperations.delete(folderName);
      this.emitUpdate();
    }
  }

  // Real-time Queue Tracking
  addToQueue(taskInfo) {
    const taskId = `${taskInfo.folderName}::${(taskInfo.relativePath || '').replace(/\\/g, '/')}`;
    // Don't duplicate in queue
    const exists = this.queuedTasks.some((t) => t.id === taskId);
    if (!exists) {
      this.queuedTasks.push({
        id: taskId,
        folderName: taskInfo.folderName,
        folderPath: taskInfo.folderPath,
        relativePath: (taskInfo.relativePath || '').replace(/\\/g, '/'),
        fileName: path.basename(taskInfo.relativePath || 'file'),
        fullPath: taskInfo.fullPath,
        size: taskInfo.size || 0,
        sizeStr: this.formatBytes(taskInfo.size || 0),
        status: 'waiting', // 'waiting' | 'uploading'
        addedAt: new Date().toLocaleTimeString(),
      });
      this.emitUpdate();
    }
  }

  setTaskUploading(folderName, relativePath) {
    const taskId = `${folderName}::${(relativePath || '').replace(/\\/g, '/')}`;
    const task = this.queuedTasks.find((t) => t.id === taskId);
    if (task) {
      task.status = 'uploading';
      this.emitUpdate();
    }
  }

  removeFromQueue(folderName, relativePath) {
    const taskId = `${folderName}::${(relativePath || '').replace(/\\/g, '/')}`;
    const initialLen = this.queuedTasks.length;
    this.queuedTasks = this.queuedTasks.filter((t) => t.id !== taskId);
    if (this.queuedTasks.length !== initialLen) {
      this.emitUpdate();
    }
  }

  // Record successful sync to recent history
  recordSynced(folderName, fileName, action = 'uploaded', size = 0, isVault = false) {
    this.recentSynced.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      folderName,
      fileName,
      action,
      size,
      sizeStr: this.formatBytes(size),
      isVault,
      timestamp: new Date().toLocaleTimeString(),
    });
    if (this.recentSynced.length > 50) {
      this.recentSynced.pop();
    }
    this.emitUpdate();
  }

  // Get full state snapshot for IPC / UI
  getDiagnostics() {
    const issuesList = Array.from(this.issues.values());
    const activeOps = {};
    for (const [folder, op] of this.activeOperations.entries()) {
      activeOps[folder] = op;
    }

    const issuesCount = issuesList.filter((i) => i.status === 'active').length;
    const lockedCount = issuesList.filter((i) => i.category === 'locked' && i.status === 'active').length;

    return {
      issues: issuesList,
      activeOperations: activeOps,
      queuedTasks: this.queuedTasks,
      recentSynced: this.recentSynced,
      stats: {
        totalIssues: issuesCount,
        lockedCount,
        queuedCount: this.queuedTasks.length,
        activeOperationsCount: this.activeOperations.size,
      },
    };
  }

  // Throttled emitUpdate to avoid overwhelming IPC
  emitUpdate() {
    if (this._updateTimer) return;
    this._updateTimer = setTimeout(() => {
      this._updateTimer = null;
      this.emit('update', this.getDiagnostics());
    }, 150);
  }
}

const instance = new DiagnosticsService();
module.exports = instance;

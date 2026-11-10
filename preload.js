const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('squirrel', {
  // Klasör seçim ve yönetim
  selectFolderDialog: () => ipcRenderer.invoke('dialog:select-folder'),
  getSavedFolders: () => ipcRenderer.invoke('folders:get-all'),
  watchFolder: (folderPath) => ipcRenderer.invoke('folders:watch', folderPath),
  unwatchFolder: (folderPath, deleteFromDrive = true) =>
    ipcRenderer.invoke('folders:unwatch', folderPath, deleteFromDrive),
  openFolderInExplorer: (folderPath) => ipcRenderer.invoke('shell:open-folder', folderPath),
  syncFolder: (folderPath) => ipcRenderer.invoke('folders:sync-one', folderPath),
  pauseFolderSync: (folderPath) => ipcRenderer.invoke('folders:pause-sync', folderPath),
  resumeFolderSync: (folderPath) => ipcRenderer.invoke('folders:resume-sync', folderPath),
  cancelFolderSync: (folderPath) => ipcRenderer.invoke('drive:cancel-folder-sync', folderPath),
  syncAllFolders: () => ipcRenderer.invoke('folders:sync-all'),

  // Pencere kontrolleri (Mac Traffic Lights)
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Olay dinleyicisi
  onFileEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('watcher:event', handler);
    return () => ipcRenderer.removeListener('watcher:event', handler);
  },
  onFolderRemovedExternally: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('watcher:folder-removed-externally', handler);
    return () => ipcRenderer.removeListener('watcher:folder-removed-externally', handler);
  },

  // Google Drive işlemleri
  getDriveStatus: () => ipcRenderer.invoke('drive:get-status'),
  saveDriveCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke('drive:save-credentials', clientId, clientSecret),
  loadDriveCredentialsFile: () => ipcRenderer.invoke('drive:load-credentials-file'),
  startDriveAuth: () => ipcRenderer.invoke('drive:start-auth'),
  disconnectDrive: () => ipcRenderer.invoke('drive:disconnect'),

  // Drive olay ve durum dinleyicileri
  onDriveStatusChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('drive:status-change', handler);
    return () => ipcRenderer.removeListener('drive:status-change', handler);
  },
  onDriveSyncEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('drive:sync-event', handler);
    return () => ipcRenderer.removeListener('drive:sync-event', handler);
  },
  onDriveSyncProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('drive:sync-progress', handler);
    return () => ipcRenderer.removeListener('drive:sync-progress', handler);
  },
  onFolderProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('drive:folder-progress', handler);
    return () => ipcRenderer.removeListener('drive:folder-progress', handler);
  },

  // Ayarlar / Genel Yapılandırma
  getSyncPriority: () => ipcRenderer.invoke('settings:get-sync-priority'),
  setSyncPriority: (priority) => ipcRenderer.invoke('settings:set-sync-priority', priority),
  getAppSettings: () => ipcRenderer.invoke('settings:get-all'),
  saveAppSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  openConfigFolder: () => ipcRenderer.invoke('shell:open-config'),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:open-external', url),
  openFeedback: () => ipcRenderer.invoke('app:open-feedback'),
  onFolderStatsUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('folders:stats-updated', handler);
    return () => ipcRenderer.removeListener('folders:stats-updated', handler);
  },
  onFoldersUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('folders:updated', handler);
    return () => ipcRenderer.removeListener('folders:updated', handler);
  },
  getStartupLaunch: () => ipcRenderer.invoke('settings:get-startup-launch'),
  setStartupLaunch: (enable) => ipcRenderer.invoke('settings:set-startup-launch', enable),

  // Otomatik Güncelleme (Auto-Updater)
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updater:update-available', handler);
    return () => ipcRenderer.removeListener('updater:update-available', handler);
  },
  onUpdateDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updater:download-progress', handler);
    return () => ipcRenderer.removeListener('updater:download-progress', handler);
  },

  // Çoklu Bulut Hesapları (Multi-Cloud Accounts)
  getCloudAccounts: () => ipcRenderer.invoke('cloud:get-accounts'),
  setPrimaryCloud: (cloudId) => ipcRenderer.invoke('cloud:set-primary', cloudId),
  saveCloudAccount: (cloudId, accountData) => ipcRenderer.invoke('cloud:save-account', cloudId, accountData),
  loginMega: (email, password) => ipcRenderer.invoke('cloud:login-mega', email, password),
  startCloudWebAuth: (cloudId, customKey, customSecret) =>
    ipcRenderer.invoke('cloud:start-web-auth', cloudId, customKey, customSecret),
  connectICloud: (email, customPath) => ipcRenderer.invoke('cloud:connect-icloud', email, customPath),
  saveDropboxToken: (token, email) => ipcRenderer.invoke('cloud:save-dropbox-token', token, email),
  saveOneDriveToken: (token, email) => ipcRenderer.invoke('cloud:save-onedrive-token', token, email),
  disconnectCloudAccount: (cloudId) => ipcRenderer.invoke('cloud:disconnect-account', cloudId),
  onCloudAccountsChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('cloud:accounts-changed', handler);
    return () => ipcRenderer.removeListener('cloud:accounts-changed', handler);
  },

  // Vault Şifreleme (AES-256)
  setFolderVault: (folderPath, enabled, password) =>
    ipcRenderer.invoke('folders:set-vault', folderPath, enabled, password),
  getFolderVault: (folderPath) =>
    ipcRenderer.invoke('folders:get-vault', folderPath),
  exportDecryptorTool: () =>
    ipcRenderer.invoke('vault:export-decryptor-tool'),
  decryptFolderToDisk: (folderPath) =>
    ipcRenderer.invoke('folders:decrypt-to-disk', folderPath),

  // Karantina & Silinme Koruması (Quarantine)
  getQuarantinedFolders: () =>
    ipcRenderer.invoke('quarantine:get-all'),
  restoreQuarantinedFolder: (folderPath) =>
    ipcRenderer.invoke('quarantine:restore', folderPath),
  deletePermanentlyQuarantinedFolder: (folderPath) =>
    ipcRenderer.invoke('quarantine:delete-permanently', folderPath),
  onQuarantineAlert: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('quarantine:alert', handler);
    return () => ipcRenderer.removeListener('quarantine:alert', handler);
  },

  // Dosya Versiyonlama (Time Machine / Revisions)
  getFolderFilesForVersioning: (folderPath) =>
    ipcRenderer.invoke('versions:get-file-list', folderPath),
  getFileRevisions: (folderPath, relativeFilePath) =>
    ipcRenderer.invoke('versions:get-revisions', folderPath, relativeFilePath),
  restoreFileRevision: (folderPath, relativeFilePath, revisionId) =>
    ipcRenderer.invoke('versions:restore-revision', folderPath, relativeFilePath, revisionId),

  // Exclusions & File Filters
  getFilters: () => ipcRenderer.invoke('filters:get'),
  updateFilters: (updates) => ipcRenderer.invoke('filters:update', updates),
  addCustomFilterRule: (rule) => ipcRenderer.invoke('filters:add-rule', rule),
  removeCustomFilterRule: (rule) => ipcRenderer.invoke('filters:remove-rule', rule),
  testFilterPath: (samplePath) => ipcRenderer.invoke('filters:test', samplePath),

  // Sync Diagnostics & Transparency ("Why didn't it sync?")
  getSyncDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  retrySyncIssue: (issueId) => ipcRenderer.invoke('diagnostics:retry-issue', issueId),
  retryAllSyncIssues: () => ipcRenderer.invoke('diagnostics:retry-all'),
  checkOnlineResume: () => ipcRenderer.invoke('diagnostics:check-online-resume'),
  notifyNetworkStatus: (isOnline) => ipcRenderer.invoke('network:status-change', isOnline),
  ignoreSyncIssue: (issueId) => ipcRenderer.invoke('diagnostics:ignore-issue', issueId),
  dismissSyncIssue: (issueId) => ipcRenderer.invoke('diagnostics:dismiss-issue', issueId),
  clearResolvedSyncIssues: () => ipcRenderer.invoke('diagnostics:clear-resolved'),
  revealFileInExplorer: (fullPath) => ipcRenderer.invoke('diagnostics:open-file', fullPath),
  onDiagnosticsUpdate: (handler) =>
    ipcRenderer.on('sync:diagnostics-update', (_e, data) => handler(data)),
});

const { contextBridge, ipcRenderer } = require('electron');

const mockData = {
  savedFolders: {
    success: true,
    folders: [
      {
        folderName: "Creative_Assets",
        folderPath: "C:\\Users\\Developer\\Documents\\Creative_Assets",
        isPaused: false,
        stats: { fileCount: 48, sizeBytes: 1548200, sizeFormatted: "1.5 MB" }
      },
      {
        folderName: "Studio_Audio_Packs",
        folderPath: "C:\\Users\\Developer\\Audio\\Studio_Audio_Packs",
        isPaused: false,
        stats: { fileCount: 2450, sizeBytes: 4831838208, sizeFormatted: "4.5 GB" }
      },
      {
        folderName: "Project_Workspace",
        folderPath: "C:\\Users\\Developer\\Projects\\Project_Workspace",
        isPaused: false,
        stats: { fileCount: 184, sizeBytes: 428971520, sizeFormatted: "409 MB" }
      }
    ]
  },
  driveStatus: {
    authenticated: true,
    isConnected: true,
    email: 'developer@squirrel.com.tr',
    name: 'Developer',
    spaceUsed: '8.4 GB',
    spaceTotal: '15 GB'
  },
  filters: {
    presets: {
      dev: true,
      temp: true,
      system: true
    },
    customRules: ['*.log', '*.bak', '.cache/'],
    maxFileSizeMB: 0,
    effectivePatterns: [
      'node_modules/', '.git/', '.svn/', '.hg/', '.venv/', 'venv/', '__pycache__/', 'target/', 'build/', 'dist/', 'release/', '.next/', '.nuxt/',
      '*.tmp', '*.~*', '~$*', '*.lock', '*.swp', '*.bak', '*.temp', '*~', '*.crswap',
      '$RECYCLE.BIN/', 'Thumbs.db', 'desktop.ini', '.DS_Store', 'ehthumbs.db',
      '*.log', '*.bak', '.cache/'
    ],
    presetDefinitions: {
      dev: {
        id: 'dev',
        title: 'Developer Dependencies & Build Artifacts',
        description: 'Ignores package managers, version control metadata, and build output',
        tags: ['node_modules/', '.git/', '.venv/', '__pycache__/', 'build/', 'dist/', 'release/'],
        patterns: ['node_modules/', '.git/', '.venv/', '__pycache__/', 'build/', 'dist/', 'release/']
      },
      temp: {
        id: 'temp',
        title: 'Temporary, Backup & Lock Files',
        description: 'Ignores editor lock files, office temporary files, swap files, and logs',
        tags: ['*.tmp', '*.~*', '~$*', '*.lock', '*.swp', '*.bak'],
        patterns: ['*.tmp', '*.~*', '~$*', '*.lock', '*.swp', '*.bak']
      },
      system: {
        id: 'system',
        title: 'Operating System Cache & Recycle Bin',
        description: 'Ignores Windows system files, thumbnails, icon caches, and Trash',
        tags: ['$RECYCLE.BIN/', 'Thumbs.db', 'desktop.ini', '.DS_Store'],
        patterns: ['$RECYCLE.BIN/', 'Thumbs.db', 'desktop.ini', '.DS_Store']
      }
    }
  },
  quarantined: {
    success: true,
    items: [
      {
        folderName: "Web_Application_Archive",
        folderPath: "C:\\Users\\Developer\\Projects\\Web_Application_Archive",
        quarantinedAt: Date.now() - 3600000 * 2,
        isVault: false,
        fileCount: 32,
        sizeFormatted: "1.2 MB"
      },
      {
        folderName: "Financial_Records_Vault",
        folderPath: "C:\\Users\\Developer\\Documents\\Financial_Records_Vault",
        quarantinedAt: Date.now() - 3600000 * 24,
        isVault: true,
        fileCount: 16,
        sizeFormatted: "14.8 MB"
      }
    ]
  },
  versions: [
    { id: "rev3", modifiedTime: "Today, 19:15", sizeFormatted: "90.4 KB", isLatest: true, author: "Developer" },
    { id: "rev2", modifiedTime: "Yesterday, 21:40", sizeFormatted: "88.2 KB", isLatest: false, author: "Developer" },
    { id: "rev1", modifiedTime: "05.11.2026, 14:10", sizeFormatted: "76.1 KB", isLatest: false, author: "Developer" }
  ],
  diagnostics: {
    activeOperations: {},
    queuedTasks: [],
    stats: {
      totalIssues: 1,
      lockedCount: 1,
      queuedCount: 0,
      activeOperationsCount: 0
    },
    issues: [
      {
        id: "Studio_Audio_Packs::Session_Master.wav",
        fileName: "Session_Master.wav",
        folderName: "Studio_Audio_Packs",
        relativePath: "Studio_Audio_Packs/Mastering/Session_Master.wav",
        category: "locked",
        isRetryable: true,
        fileSizeStr: "42.8 MB",
        explanation: "This file is currently open and locked by another application (Audio_Engine_64.exe). Squirrel safely paused it to prevent uploading a corrupt or partially written file.",
        solution: "Save your project and close Audio_Engine_64.exe. Squirrel will automatically detect when the file is freed and resume synchronization instantly.",
        failedAt: Date.now() - 60000,
        retryCount: 2,
        nextRetrySeconds: 14
      }
    ],
    recentSynced: [
      { folderName: "Project_Workspace", relativePath: "README.md", time: "19:18", size: "4.2 KB" },
      { folderName: "Creative_Assets", relativePath: "logo_vector.svg", time: "18:45", size: "24.6 KB" }
    ]
  }
};

const squirrelApi = {
  getSavedFolders: async () => mockData.savedFolders,
  getDriveStatus: async () => mockData.driveStatus,
  getSyncPriority: async () => 'turbo',
  setSyncPriority: async () => {},
  getAppSettings: async () => ({ startupLaunch: true }),
  saveAppSettings: async () => {},
  getCloudAccounts: async () => ({
    primary: 'google-drive',
    accounts: {
      'google-drive': {
        connected: true,
        email: 'developer@squirrel.com.tr',
        name: 'Developer'
      }
    }
  }),
  setPrimaryCloud: async () => {},
  
  // Vault
  getFolderVault: async () => ({ enabled: true, password: '••••••••••••' }),
  setFolderVault: async () => {},
  exportDecryptorTool: async () => {},
  decryptFolderToDisk: async () => {},

  // Quarantine
  getQuarantinedFolders: async () => mockData.quarantined,
  restoreQuarantinedFolder: async () => ({ success: true }),
  deletePermanentlyQuarantinedFolder: async () => ({ success: true }),
  onQuarantineAlert: () => () => {},

  // Versions
  getFolderFilesForVersioning: async () => ['package.json', 'main.js', 'renderer.js', 'config.json'],
  getFileRevisions: async () => mockData.versions,
  restoreFileRevision: async () => {},

  // Filters
  getFilters: async () => mockData.filters,
  updateFilters: async (updates) => ({ ...mockData.filters, ...updates }),
  addCustomFilterRule: async (r) => ({ ...mockData.filters, customRules: [...mockData.filters.customRules, r] }),
  removeCustomFilterRule: async (r) => ({ ...mockData.filters, customRules: mockData.filters.customRules.filter(x => x !== r) }),
  testFilterPath: async () => ({ excluded: true, matchingRule: 'node_modules/' }),

  // Diagnostics
  getSyncDiagnostics: async () => mockData.diagnostics,
  retrySyncIssue: async () => {},
  retryAllSyncIssues: async () => {},
  checkOnlineResume: async () => {},
  notifyNetworkStatus: async () => {},
  ignoreSyncIssue: async () => {},
  dismissSyncIssue: async () => {},
  clearResolvedSyncIssues: async () => {},
  revealFileInExplorer: async () => {},
  onDiagnosticsUpdate: () => () => {},

  // Listeners
  onFileEvent: () => () => {},
  onFolderRemovedExternally: () => () => {},
  onDriveStatusChange: () => () => {},
  onDriveSyncEvent: () => () => {},
  onDriveSyncProgress: () => () => {},
  onFolderProgress: () => () => {},
  onFolderStatsUpdated: () => () => {},
  onFoldersUpdated: () => () => {},
  onCloudAccountsChanged: () => () => {},
  onUpdateAvailable: () => () => {},
  onUpdateDownloadProgress: () => () => {},

  // Window
  minimizeWindow: () => {},
  maximizeWindow: () => {},
  closeWindow: () => {},
  openFolderInExplorer: () => {},
  openConfigFolder: () => {},
  openExternalUrl: () => {},
  openFeedback: () => {},
  syncFolder: async () => {},
  pauseFolderSync: async () => {},
  resumeFolderSync: async () => {},
  cancelFolderSync: async () => {},
  syncAllFolders: async () => {}
};

try {
  contextBridge.exposeInMainWorld('squirrel', squirrelApi);
} catch (e) {
  window.squirrel = squirrelApi;
}

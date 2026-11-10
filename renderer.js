// ========================================================
// SQUIRREL - RENDERER CONTROLLER
// ========================================================

// DOM Elemanları - Pencere Kontrolleri
const winCloseBtn = document.getElementById('winCloseBtn');
const winMinimizeBtn = document.getElementById('winMinimizeBtn');
const winMaximizeBtn = document.getElementById('winMaximizeBtn');

// Navigasyon & Sekmeler
const navItems = document.querySelectorAll('.nav-item');
const tabViews = document.querySelectorAll('.tab-view');
const feedbackBtn = document.getElementById('feedbackBtn');
const sidebarSearchInput = document.getElementById('sidebarSearchInput');
const userProfileCard = document.getElementById('userProfileCard');
const userAvatar = document.getElementById('userAvatar');
const userNameLabel = document.getElementById('userNameLabel');
const userEmailLabel = document.getElementById('userEmailLabel');
const sidebarStatusText = document.getElementById('sidebarStatusText');
const sidebarStatusDot = document.getElementById('sidebarStatusDot');
const cloudNavDot = document.getElementById('cloudNavDot');
const logCountNavBadge = document.getElementById('logCountNavBadge');

// Monitored Folders Görünümü
const watchersListContainer = document.getElementById('watchersListContainer');
const addFolderBtn = document.getElementById('addFolderBtn');
const activeWatchersCount = document.getElementById('activeWatchersCount');
const syncAllBtn = document.getElementById('syncAllBtn');

// Configuration & Target
const primaryCloudDropdownBtn = document.getElementById('primaryCloudDropdownBtn');
const primaryCloudIcon = document.getElementById('primaryCloudIcon');
const primaryCloudLabel = document.getElementById('primaryCloudLabel');
const primaryCloudDropdownMenu = document.getElementById('primaryCloudDropdownMenu');
const syncPriorityDropdownBtn = document.getElementById('syncPriorityDropdownBtn');
const syncPriorityLabel = document.getElementById('syncPriorityLabel');
const miniBarChart = document.getElementById('miniBarChart');
const activitySummaryText = document.getElementById('activitySummaryText');

// Manage Floating Dropdown
const manageDropdownMenu = document.getElementById('manageDropdownMenu');
const manageOpenExplorer = document.getElementById('manageOpenExplorer');
const manageSyncNow = document.getElementById('manageSyncNow');
const manageChangeFolder = document.getElementById('manageChangeFolder');
const manageRemoveFolder = document.getElementById('manageRemoveFolder');

// Priority Floating Dropdown
const priorityDropdownMenu = document.getElementById('priorityDropdownMenu');
const checkSmart = document.getElementById('checkSmart');
const checkTurbo = document.getElementById('checkTurbo');
const checkEco = document.getElementById('checkEco');
const priorityItemSmart = document.getElementById('priorityItemSmart');
const priorityItemTurbo = document.getElementById('priorityItemTurbo');
const priorityItemEco = document.getElementById('priorityItemEco');

// İlerleme Çubuğu (Global)
const syncProgressCard = document.getElementById('syncProgressCard');
const syncProgressText = document.getElementById('syncProgressText');
const syncProgressCount = document.getElementById('syncProgressCount');
const syncProgressBarFill = document.getElementById('syncProgressBarFill');

// Dashboard İstatistikleri
const summaryTotalFiles = document.getElementById('summaryTotalFiles');
const summaryActiveFolders = document.getElementById('summaryActiveFolders');
const summaryTotalSize = document.getElementById('summaryTotalSize');
const driveSummaryBadge = document.getElementById('driveSummaryBadge');
const driveSummaryDot = document.getElementById('driveSummaryDot');
const driveSummaryText = document.getElementById('driveSummaryText');
const activeFoldersCountPill = document.getElementById('activeFoldersCountPill');

// Cloud Accounts Görünümü & Modal
const openDriveModalBtn = document.getElementById('openDriveModalBtn');
const driveConnectedPill = document.getElementById('driveConnectedPill');
const drivePillEmail = document.getElementById('drivePillEmail');
const driveAccountEmail = document.getElementById('driveAccountEmail');
const disconnectDriveBtn = document.getElementById('disconnectDriveBtn');
const cloudStatusTag = document.getElementById('cloudStatusTag');

const driveModal = document.getElementById('driveModal');
const closeDriveModalBtn = document.getElementById('closeDriveModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const loadCredentialsFileBtn = document.getElementById('loadCredentialsFileBtn');
const clientIdInput = document.getElementById('clientIdInput');
const clientSecretInput = document.getElementById('clientSecretInput');
const saveManualCredsBtn = document.getElementById('saveManualCredsBtn');
const startAuthBtn = document.getElementById('startAuthBtn');
const openCloudConsoleLink = document.getElementById('openCloudConsoleLink');

// Sync History / Günlük
const logCountBadge = document.getElementById('logCountBadge');
const clearLogBtn = document.getElementById('clearLogBtn');
const emptyState = document.getElementById('emptyState');
const logList = document.getElementById('logList');
const filterChips = document.querySelectorAll('.filter-chip');

// Uygulama Durumu (State)
let isDriveConnected = false;
let driveUserInfo = null;
let eventCount = 0;
let slotCounter = 0;
let currentManageSlot = null;
let activeLogFilter = 'all';

// Başlangıçta 3 takip yuvası
let slots = [
  { id: ++slotCounter, path: null, name: null, stats: null, isPaused: false, lastSync: 'Just now', progress: null },
  { id: ++slotCounter, path: null, name: null, stats: null, isPaused: false, lastSync: 'Just now', progress: null },
  { id: ++slotCounter, path: null, name: null, stats: null, isPaused: false, lastSync: 'Just now', progress: null },
];

// Boyut formatlayıcı
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Süre formatlayıcı (Kalan süre)
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'Hesaplanıyor...';
  if (seconds < 60) return `~${seconds} sn`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} dk`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `~${hours} sa ${mins} dk`;
}

// Güvenli HTML escape
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========================================================
// 1. MAC PENCERE KONTROLLERİ (TRAFFIC LIGHTS)
// ========================================================
if (winCloseBtn) {
  winCloseBtn.addEventListener('click', () => window.squirrel.closeWindow());
}
if (winMinimizeBtn) {
  winMinimizeBtn.addEventListener('click', () => window.squirrel.minimizeWindow());
}
if (winMaximizeBtn) {
  winMaximizeBtn.addEventListener('click', () => window.squirrel.maximizeWindow());
}

// ========================================================
// 2. SEKME VE NAVİGASYON YÖNETİMİ
// ========================================================
function switchTab(tabId) {
  navItems.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  tabViews.forEach((view) => {
    view.classList.toggle('active', view.id === `tab-${tabId}`);
  });

  if (tabId === 'quarantine' && typeof loadQuarantineList === 'function') {
    loadQuarantineList();
  }
  if (tabId === 'exclusions' && typeof loadExclusionsUI === 'function') {
    loadExclusionsUI();
  }
}

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

if (userProfileCard) {
  userProfileCard.addEventListener('click', () => {
    switchTab('cloud-accounts');
  });
}

if (feedbackBtn) {
  feedbackBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText('support@squirrelapp.com.tr');
      }
    } catch (_) {}

    const englishBody = 'Hi%2C%0A%0AHere%20is%20my%20feedback%20regarding%20Squirrel%3A%0A%0A';
    if (window.squirrel && window.squirrel.openFeedback) {
      await window.squirrel.openFeedback();
    } else if (window.squirrel && window.squirrel.openExternalUrl) {
      await window.squirrel.openExternalUrl(`https://mail.google.com/mail/?view=cm&fs=1&to=support@squirrelapp.com.tr&su=Squirrel%20v2.1%20Feedback&body=${englishBody}`);
    }

    addSystemInfoLog('support@squirrelapp.com.tr feedback compose opened (email copied to clipboard).', 'INFO', 'event-info');
  });
}

if (window.squirrel && window.squirrel.onFolderStatsUpdated) {
  window.squirrel.onFolderStatsUpdated((data) => {
    if (!data || !data.folderPath) return;
    const targetSlot = slots.find((s) => s.path && s.path.toLowerCase() === data.folderPath.toLowerCase());
    if (targetSlot && data.stats) {
      targetSlot.stats = data.stats;
      renderWatchersList();
    }
  });
}

// ========================================================
// 3. MULTI-CLOUD PROVIDERS DEFINITION & MANAGEMENT
// ========================================================
const CLOUD_PROVIDERS = {
  'google-drive': {
    id: 'google-drive',
    name: 'Google Drive',
    hint: 'Google Drive / Squirrel',
    iconSvg: `<svg class="cloud-icon-svg" viewBox="0 0 24 24"><path d="M7.71 3.5L1.15 15l3.43 6 6.56-11.5L7.71 3.5z" fill="#0066DA"/><path d="M16.29 3.5H7.71l3.43 6h8.58l-3.43-6z" fill="#00AC47"/><path d="M22.85 15l-3.43-6H10.84l3.43 6h8.58z" fill="#EA4335"/><path d="M14.27 21H5.71l3.43-6h8.56l-3.43 6z" fill="#FFBA00"/></svg>`,
    iconLarge: `<svg class="cloud-icon-large" viewBox="0 0 24 24"><path d="M7.71 3.5L1.15 15l3.43 6 6.56-11.5L7.71 3.5z" fill="#0066DA"/><path d="M16.29 3.5H7.71l3.43 6h8.58l-3.43-6z" fill="#00AC47"/><path d="M22.85 15l-3.43-6H10.84l3.43 6h8.58z" fill="#EA4335"/><path d="M14.27 21H5.71l3.43-6h8.56l-3.43 6z" fill="#FFBA00"/></svg>`,
  },
  'onedrive': {
    id: 'onedrive',
    name: 'Microsoft OneDrive',
    hint: 'OneDrive / Squirrel',
    modalTitle: 'Connect Microsoft OneDrive',
    modalSubtitle: 'Pair Squirrel with your Microsoft OneDrive account',
    modalInfo: 'Sign in to your Microsoft account. Squirrel will synchronize files to the "Squirrel" folder on your OneDrive.',
    emailPlaceholder: 'user@outlook.com or hotmail.com',
    iconSvg: `<svg class="cloud-icon-svg" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="#0078D4"/><path d="M19 14c0-2.21-1.79-4-4-4-.34 0-.67.04-.98.13C13.43 8.33 11.61 7 9.5 7c-2.48 0-4.5 2.02-4.5 4.5 0 .28.03.55.08.82C3.23 12.82 2 14.26 2 16c0 2.21 1.79 4 4 4h13c1.66 0 3-1.34 3-3 0-1.4-.96-2.58-2.26-2.91.17-.34.26-.71.26-1.09z" fill="#28A8EA"/></svg>`,
  },
  'dropbox': {
    id: 'dropbox',
    name: 'Dropbox',
    hint: 'Dropbox / Apps / Squirrel',
    modalTitle: 'Connect Dropbox',
    modalSubtitle: 'Pair Squirrel with your Dropbox account',
    modalInfo: 'Link your Dropbox account. Squirrel synchronizes files directly to your Apps/Squirrel folder.',
    emailPlaceholder: 'user@dropbox.com',
    iconSvg: `<svg class="cloud-icon-svg" viewBox="0 0 24 24"><path d="M6 2l6 3.82L6 9.64 0 5.82 6 2zm12 0l6 3.82-6 3.82-6-3.82L18 2zM0 13.45l6-3.81 6 3.81-6 3.82-6-3.82zm18-3.81l6 3.81-6 3.82-6-3.82 6-3.81zM6 18.73l6-3.82 6 3.82-6 3.82-6-3.82z" fill="#0061FF"/></svg>`,
  },
  'icloud': {
    id: 'icloud',
    name: 'iCloud Drive',
    hint: 'iCloud Drive / Squirrel',
    modalTitle: 'Connect iCloud Drive',
    modalSubtitle: 'Pair Squirrel with your Apple iCloud Drive',
    modalInfo: 'Enter your Apple ID email. Squirrel syncs files to your local iCloud Drive/Squirrel folder.',
    emailPlaceholder: 'user@icloud.com',
    iconSvg: `<svg class="cloud-icon-svg" viewBox="0 0 24 24"><defs><linearGradient id="icloudGradRenderer" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#54C7FC"/><stop offset="100%" stop-color="#007AFF"/></linearGradient></defs><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="url(#icloudGradRenderer)"/></svg>`,
  },
  'mega': {
    id: 'mega',
    name: 'Mega (MEGA.nz)',
    hint: 'Mega / Squirrel',
    modalTitle: 'Connect Mega (MEGA.nz)',
    modalSubtitle: 'Pair Squirrel with your Mega account',
    modalInfo: 'Enter your Mega email and password. Your files will be end-to-end encrypted (Zero-Knowledge) and synced to your Mega/Squirrel folder.',
    emailPlaceholder: 'user@mega.nz',
    iconSvg: `<svg class="cloud-icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#D9272E"/><path d="M7 16V8l5 5 5-5v8h-2v-4.5l-3 3-3-3V16H7z" fill="#FFFFFF"/></svg>`,
  },
};

let cloudAccounts = {};
let primaryCloud = 'google-drive';

function getPrimaryCloudInfo() {
  const meta = CLOUD_PROVIDERS[primaryCloud] || CLOUD_PROVIDERS['google-drive'];
  const acc = cloudAccounts[primaryCloud] || {};
  const isConn = primaryCloud === 'google-drive' ? isDriveConnected : !!acc.connected;
  const email = primaryCloud === 'google-drive' ? ((driveUserInfo && driveUserInfo.email) || '') : (acc.email || '');
  return {
    id: meta.id,
    name: meta.name,
    iconSvg: meta.iconSvg,
    connected: isConn,
    email: email,
    displayLabel: isConn && email ? `${meta.name} (${email.split('@')[0]})` : meta.name,
    subtextTarget: isConn && email ? `${meta.name} (${email})` : (isConn ? meta.name : `${meta.name} (Disconnected)`),
  };
}

// ========================================================
// 3. GOOGLE DRIVE STATUS & USER PROFILE CARD UPDATE
// ========================================================
function updateDriveUI(status) {
  isDriveConnected = status && status.isConnected;
  driveUserInfo = status;

  if (isDriveConnected) {
    const email = status.email || 'Google Drive';
    const name = status.name || email.split('@')[0] || 'User';

    // Sidebar user profile card
    userAvatar.textContent = name.charAt(0).toUpperCase();
    userNameLabel.textContent = name;
    userEmailLabel.textContent = email;

    // Header and pill controls
    if (openDriveModalBtn) openDriveModalBtn.style.display = 'none';
    if (driveConnectedPill) {
      driveConnectedPill.style.display = 'inline-flex';
      if (drivePillEmail) drivePillEmail.textContent = email;
    }
    if (driveAccountEmail) driveAccountEmail.textContent = email;

    if (cloudNavDot) cloudNavDot.style.display = 'inline-block';
    if (cloudStatusTag) cloudStatusTag.textContent = primaryCloud === 'google-drive' ? 'Status: Primary & Active' : 'Status: Connected (Ready)';

    if (driveSummaryBadge) driveSummaryBadge.className = 'drive-status-badge connected';
    if (driveSummaryDot) driveSummaryDot.className = 'drive-dot active';
    if (driveSummaryText) driveSummaryText.textContent = 'Connected & Syncing';

    if (driveModal) driveModal.style.display = 'none';
  } else {
    userAvatar.textContent = 'S';
    userNameLabel.textContent = 'Account';
    userEmailLabel.textContent = 'Not connected';

    if (openDriveModalBtn) openDriveModalBtn.style.display = 'inline-flex';
    if (driveConnectedPill) driveConnectedPill.style.display = 'none';
    if (driveAccountEmail) driveAccountEmail.textContent = 'Not connected';

    if (cloudNavDot) cloudNavDot.style.display = 'none';
    if (cloudStatusTag) cloudStatusTag.textContent = 'Status: Disconnected';

    if (driveSummaryBadge) driveSummaryBadge.className = 'drive-status-badge';
    if (driveSummaryDot) driveSummaryDot.className = 'drive-dot';
    if (driveSummaryText) driveSummaryText.textContent = 'Disconnected';

    if (startAuthBtn) {
      startAuthBtn.disabled = !(status && status.hasCredentials);
    }
  }

  if (cloudAccounts['google-drive']) {
    cloudAccounts['google-drive'].connected = isDriveConnected;
    cloudAccounts['google-drive'].email = driveUserInfo ? driveUserInfo.email : null;
  }

  updatePrimaryCloudUI(primaryCloud);
  renderCloudAccountsList();
  updateSyncAllButton();
}

function updateSyncAllButton() {
  const activeCount = slots.filter((s) => s.path).length;
  if (syncAllBtn) {
    syncAllBtn.disabled = !isDriveConnected || activeCount === 0;
  }
}

// ========================================================
// 4. MİNİ BAR CHART & ÖZET İSTATİSTİKLERİ
// ========================================================
function renderMiniBarChart() {
  if (!miniBarChart) return;
  miniBarChart.innerHTML = '';

  const barHeights = [
    6, 10, 8, 14, 20, 26, 18, 12, 16, 22, 28, 14, 8, 16, 24, 20, 10, 14, 22, 18, 12, 16, 24, 18
  ];

  barHeights.forEach((h, index) => {
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    if (index % 3 === 0) bar.classList.add('cyan');
    if (index % 5 === 0) bar.classList.add('emerald');
    bar.style.height = `${h}px`;
    bar.title = `${index}:00 - ${h * 25} MB aktivite`;
    miniBarChart.appendChild(bar);
  });
}

function updateSummaryStats() {
  let totalFiles = 0;
  let totalBytes = 0;
  let activeCount = 0;

  for (const s of slots) {
    if (s.path && s.stats) {
      activeCount++;
      totalFiles += s.stats.fileCount || 0;
      totalBytes += s.stats.totalBytes || 0;
    }
  }

  if (activeWatchersCount) activeWatchersCount.textContent = activeCount;
  if (summaryTotalFiles) summaryTotalFiles.textContent = totalFiles.toLocaleString('tr-TR');
  if (summaryActiveFolders) summaryActiveFolders.textContent = `${activeCount} / ${slots.length}`;
  if (summaryTotalSize) summaryTotalSize.textContent = formatBytes(totalBytes);
  if (activeFoldersCountPill) activeFoldersCountPill.textContent = `${activeCount} Aktif`;

  const sizeText = totalBytes > 0 ? formatBytes(totalBytes) : '0 B';
  if (activitySummaryText) {
    activitySummaryText.textContent = `${sizeText} synced today`;
  }

  if (activeCount > 0) {
    sidebarStatusText.textContent = 'Status: Monitoring Active';
    sidebarStatusDot.className = 'status-dot-active';
  } else {
    sidebarStatusText.textContent = 'Status: Idle (No Folders)';
    sidebarStatusDot.className = 'status-dot-active';
  }

  updateSyncAllButton();
}

function getFolderIconSvg(folderName) {
  const lower = (folderName || '').toLowerCase();

  if (lower.includes('download') || lower.includes('indir')) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `;
  }

  if (lower.includes('project') || lower.includes('code') || lower.includes('dev') || lower.includes('proje')) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
    `;
  }

  if (lower.includes('photo') || lower.includes('picture') || lower.includes('resim') || lower.includes('camera') || lower.includes('görsel')) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>
  `;
}

function formatPathDisplay(fullPath) {
  if (!fullPath) return '';
  return fullPath.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, '~').replace(/\\/g, '/');
}

function getVaultBadgeHtml(slot) {
  if (!slot || !slot.vault) return '';
  return '<span class="badge-vault"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Vault (AES-256)</span>';
}

// ========================================================
// 5. ACTIVE WATCHERS KARTLARINI ÇİZ
// ========================================================
function renderWatchersList() {
  if (!watchersListContainer) return;
  watchersListContainer.innerHTML = '';

  const searchQuery = (sidebarSearchInput ? sidebarSearchInput.value.trim().toLowerCase() : '');

  slots.forEach((slot, index) => {
    if (searchQuery && slot.path) {
      const matchName = (slot.name || '').toLowerCase().includes(searchQuery);
      const matchPath = (slot.path || '').toLowerCase().includes(searchQuery);
      if (!matchName && !matchPath) return;
    }

    const card = document.createElement('div');
    card.className = `watcher-card ${slot.path ? 'filled' : 'empty-slot'}`;
    card.dataset.slotId = slot.id;

    if (slot.path) {
      const folderName = slot.name || slot.path.split(/[\\/]/).pop() || slot.path;
      const formattedPath = formatPathDisplay(slot.path);
      const fileCount = slot.stats ? slot.stats.fileCount || 0 : 0;
      const sizeStr = slot.stats ? slot.stats.totalSizeStr || '0 B' : '0 B';

      let badgeHtml = '<span class="badge-realtime">Real-time</span>';
      const issueBadge = getFolderIssueBadge(folderName);
      if (slot.progress && !slot.progress.done) {
        if (slot.progress.isOfflinePaused) {
          badgeHtml = '<span class="badge-paused" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">🌐 Offline</span>';
        } else {
          const pct = slot.progress.percent || 0;
          badgeHtml = `<span class="badge-syncing"><span class="sync-dot-pulse"></span> Syncing (%${pct})</span>`;
        }
      } else if (slot.isSyncCancelled) {
        badgeHtml = '<span class="badge-paused" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border-color: rgba(239, 68, 68, 0.3);">Cancelled</span>';
      } else if (issueBadge) {
        badgeHtml = issueBadge;
      } else if (slot.isPaused) {
        badgeHtml = '<span class="badge-paused">Paused</span>';
      } else if (index === 1) {
        badgeHtml = '<span class="badge-active">Active</span>';
      }

      const vaultBadgeHtml = getVaultBadgeHtml(slot);

      const pauseLabel = slot.isPaused
        ? '<svg class="pause-icon-svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.2c0-.9 1-1.4 1.7-.9l11.5 7.3c.7.4.7 1.4 0 1.8L8.7 19.7c-.7.5-1.7-.1-1.7-.9V4.2z"/></svg> <span>Resume</span>'
        : '<svg class="pause-icon-svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.5" height="16" rx="2"></rect><rect x="14" y="4" width="4.5" height="16" rx="2"></rect></svg> <span>Pause</span>';
      const hasProgress = slot.progress && !slot.progress.hidden && !slot.progress.done;

      const cloudInfo = getPrimaryCloudInfo();

      card.innerHTML = `
        <div class="watcher-main-row">
          <div class="watcher-left">
            <div class="watcher-icon-box">
              ${getFolderIconSvg(folderName)}
            </div>
            <div class="watcher-details">
              <div class="watcher-name-row">
                <span class="watcher-name">${escapeHtml(folderName)}</span>
                <span class="watcher-path" title="${escapeHtml(slot.path)}">${escapeHtml(formattedPath)}</span>
                <span class="badge-container" id="badge-${slot.id}">${badgeHtml} ${vaultBadgeHtml}</span>
              </div>
              <div class="watcher-subtext">
                Synced to: ${escapeHtml(cloudInfo.subtextTarget)} • ${fileCount.toLocaleString('en-US')} files, ${sizeStr} • Last sync: ${escapeHtml(slot.lastSync || 'Just now')}
              </div>
            </div>
          </div>

          <div class="watcher-right">
            ${slot.isSyncCancelled ? `
              <button class="btn-sync-folder" data-slot-id="${slot.id}" title="Sync this folder now">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                <span>Sync</span>
              </button>
            ` : ''}
            <button class="btn-manage" data-slot-id="${slot.id}">Manage</button>
            <button class="btn-pause-toggle" data-slot-id="${slot.id}">${pauseLabel}</button>
          </div>
        </div>

        <!-- Minimal macOS Card Progress Strip -->
        <div class="card-progress-strip" id="cardProgress-${slot.id}" style="${hasProgress ? 'display: flex;' : 'display: none;'}">
          <div class="card-progress-track-row">
            <div class="card-progress-track">
              <div class="card-progress-fill" style="width: ${hasProgress ? slot.progress.percent : 0}%; ${slot.isUserPaused ? 'background: #f59e0b;' : ''}"></div>
            </div>
            <div class="card-progress-actions">
              <button class="btn-prog-pause ${slot.isUserPaused ? 'is-paused' : ''}" data-slot-id="${slot.id}" title="${slot.isUserPaused ? 'Resume sync from current byte' : 'Pause sync and keep progress'}">
                ${slot.isUserPaused ? `
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                    <path d="M7 4.2c0-.9 1-1.4 1.7-.9l11.5 7.3c.7.4.7 1.4 0 1.8L8.7 19.7c-.7.5-1.7-.1-1.7-.9V4.2z"/>
                  </svg>
                  <span>Resume</span>
                ` : `
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                    <rect x="5.5" y="4" width="4.5" height="16" rx="2"></rect>
                    <rect x="14" y="4" width="4.5" height="16" rx="2"></rect>
                  </svg>
                  <span>Pause</span>
                `}
              </button>
              <button class="btn-prog-cancel" data-slot-id="${slot.id}" title="Cancel and abort sync">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span>Cancel</span>
              </button>
            </div>
          </div>
          <div class="card-progress-meta">
            <div class="card-progress-left">
              <div class="card-progress-file-row">
                <span class="card-progress-file" id="progFile-${slot.id}">${hasProgress ? escapeHtml(slot.progress.currentFile) : ''}</span>
              </div>
              <div class="card-progress-stats-row" id="progStats-${slot.id}">
                ${hasProgress && slot.progress.statsHtml ? slot.progress.statsHtml : ''}
              </div>
            </div>
            <div class="card-progress-right">
              <div class="card-progress-eta-row">
                <span class="card-progress-eta" id="progEta-${slot.id}">${hasProgress ? escapeHtml(slot.progress.etaText) : ''}</span>
              </div>
              <div class="card-progress-speeds-row">
                <span class="speed-badge speed-net" id="speedNet-${slot.id}" title="Upload / Network Speed">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
                    <path d="M12 12v9"></path>
                    <path d="m16 16-4-4-4 4"></path>
                  </svg>
                  <span class="speed-val">${hasProgress ? escapeHtml(slot.progress.netSpeedText) : '0 Mbps'}</span>
                </span>
                <span class="speed-badge speed-disk" id="speedDisk-${slot.id}" title="Disk Read Speed">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <line x1="6" y1="12" x2="6.01" y2="12"></line>
                    <line x1="10" y1="12" x2="10.01" y2="12"></line>
                    <line x1="14" y1="12" x2="14.01" y2="12"></line>
                    <line x1="18" y1="12" x2="18.01" y2="12"></line>
                  </svg>
                  <span class="speed-val">${hasProgress ? escapeHtml(slot.progress.diskSpeedText) : '0 MB/s'}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      `;

      const manageBtn = card.querySelector('.btn-manage');
      manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openManageDropdown(slot, manageBtn);
      });

      const syncFolderBtn = card.querySelector('.btn-sync-folder');
      if (syncFolderBtn) {
        syncFolderBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (syncFolderBtn.classList.contains('is-syncing')) return;
          syncFolderBtn.classList.add('is-syncing');

          slot.isCancelled = false;
          slot.isUserPaused = false;
          slot.isSyncCancelled = false;
          slot.progress = {
            percent: 5,
            currentFile: 'Starting sync...',
            statsHtml: '<span style="color: #38bdf8; font-weight: 600;">🔄 Scanning & synchronizing...</span>',
            etaText: 'Starting...',
            netSpeedText: '0 Mbps',
            diskSpeedText: '0 MB/s',
            done: false,
            hidden: false,
          };

          renderWatchersList();

          addSystemInfoLog(`"${folderName}" sync started.`, 'SYNC', 'event-add');

          try {
            await window.squirrel.syncFolder(slot.path || slot.name);
          } catch (err) {
            console.error('syncFolder error:', err);
          }
        });
      }

      const pauseSyncBtn = card.querySelector('.btn-prog-pause');
      if (pauseSyncBtn) {
        pauseSyncBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const isCurrentlyPaused = slot.isUserPaused;
          if (isCurrentlyPaused) {
            slot.isUserPaused = false;
            pauseSyncBtn.classList.remove('is-paused');
            pauseSyncBtn.title = 'Pause sync and keep progress';
            pauseSyncBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                <rect x="5.5" y="4" width="4.5" height="16" rx="2"></rect>
                <rect x="14" y="4" width="4.5" height="16" rx="2"></rect>
              </svg>
              <span>Pause</span>
            `;
            const fill = card.querySelector('.card-progress-fill');
            if (fill) fill.style.background = '';
            const statsEl = card.querySelector(`#progStats-${slot.id}`);
            if (statsEl) statsEl.innerHTML = '<span style="color: #38bdf8; font-weight: 600;">▶ Resuming sync from saved progress...</span>';
            addSystemInfoLog(`"${folderName}" sync resumed by user.`, 'RESUMED', 'event-add');
            try {
              await window.squirrel.resumeFolderSync(slot.path || slot.name);
            } catch (err) {
              console.error('resumeFolderSync error:', err);
            }
          } else {
            slot.isUserPaused = true;
            pauseSyncBtn.classList.add('is-paused');
            pauseSyncBtn.title = 'Resume sync from current byte';
            pauseSyncBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                <path d="M7 4.2c0-.9 1-1.4 1.7-.9l11.5 7.3c.7.4.7 1.4 0 1.8L8.7 19.7c-.7.5-1.7-.1-1.7-.9V4.2z"/>
              </svg>
              <span>Resume</span>
            `;
            const fill = card.querySelector('.card-progress-fill');
            if (fill) fill.style.background = '#f59e0b';
            const statsEl = card.querySelector(`#progStats-${slot.id}`);
            if (statsEl) statsEl.innerHTML = '<span style="color: #fbbf24; font-weight: 600;">⏸️ Sync paused • Progress saved</span>';
            const fileEl = card.querySelector(`#progFile-${slot.id}`);
            if (fileEl) fileEl.textContent = 'Sync paused by user';
            const etaEl = card.querySelector(`#progEta-${slot.id}`);
            if (etaEl) etaEl.textContent = 'Paused';
            const netEl = card.querySelector(`#speedNet-${slot.id} .speed-val`);
            if (netEl) netEl.textContent = '0 Mbps';
            const diskEl = card.querySelector(`#speedDisk-${slot.id} .speed-val`);
            if (diskEl) diskEl.textContent = '0 MB/s';
            addSystemInfoLog(`"${folderName}" sync paused by user. Progress saved for resume.`, 'PAUSED', 'event-unlink');
            try {
              await window.squirrel.pauseFolderSync(slot.path || slot.name);
            } catch (err) {
              console.error('pauseFolderSync error:', err);
            }
          }
        });
      }

      const cancelSyncBtn = card.querySelector('.btn-prog-cancel') || card.querySelector('.btn-cancel-sync');
      if (cancelSyncBtn) {
        cancelSyncBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          cancelSyncBtn.disabled = true;
          cancelSyncBtn.innerHTML = `
            <svg class="spin-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
              <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
            </svg>
            <span>Cancelling...</span>
          `;
          try {
            slot.isCancelled = true;
            slot.isUserPaused = false;
            await window.squirrel.cancelFolderSync(slot.path || slot.name);
            addSystemInfoLog(`"${folderName}" sync was cancelled by user.`, 'CANCELLED', 'event-unlink');

            slot._maxPercent = 0;
            slot._maxBytes = 0;
            slot.progress = {
              percent: 0,
              currentFile: 'Sync cancelled',
              statsHtml: '<span style="color: #f87171; font-weight: 600;">🛑 Sync cancelled</span>',
              etaText: 'Cancelled',
              netSpeedText: '0 Mbps',
              diskSpeedText: '0 MB/s',
              done: true,
              hidden: false,
            };

            const badgeContainer = card.querySelector(`#badge-${slot.id}`);
            if (badgeContainer) {
              const vaultBadge = getVaultBadgeHtml(slot);
              badgeContainer.innerHTML = `<span class="badge-paused" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border-color: rgba(239, 68, 68, 0.3);">Cancelled</span> ${vaultBadge}`;
            }
            const fileEl = card.querySelector(`#progFile-${slot.id}`);
            if (fileEl) fileEl.textContent = 'Sync cancelled';
            const statsEl = card.querySelector(`#progStats-${slot.id}`);
            if (statsEl) statsEl.innerHTML = '<span style="color: #f87171; font-weight: 600;">🛑 Sync cancelled</span>';
            const etaEl = card.querySelector(`#progEta-${slot.id}`);
            if (etaEl) etaEl.textContent = 'Cancelled';
            const speedNetEl = card.querySelector(`#speedNet-${slot.id} .speed-val`);
            if (speedNetEl) speedNetEl.textContent = '0 Mbps';
            const speedDiskEl = card.querySelector(`#speedDisk-${slot.id} .speed-val`);
            if (speedDiskEl) speedDiskEl.textContent = '0 MB/s';
            const fill = card.querySelector('.card-progress-fill');
            if (fill) {
              fill.style.width = '0%';
              fill.style.background = '#ef4444';
            }

            cancelSyncBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>Cancelled</span>
            `;

            // Kırmızıyla işaretlenen menüyü 500ms sonra kapat ve sadece bu karta Sync butonunu göster
            clearTimeout(slot._cancelTimer);
            slot._cancelTimer = setTimeout(() => {
              slot.progress = null;
              slot.isCancelled = false;
              slot.isSyncCancelled = true;
              renderWatchersList();
            }, 500);
          } catch (err) {
            console.error('Cancel error:', err);
            cancelSyncBtn.disabled = false;
          }
        });
      }

      const pauseBtn = card.querySelector('.btn-pause-toggle');
      pauseBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        slot.isPaused = !slot.isPaused;
        if (slot.isPaused) {
          await window.squirrel.pauseFolderSync(slot.path);
        } else {
          await window.squirrel.resumeFolderSync(slot.path);
        }
        renderWatchersList();
        addSystemInfoLog(
          `"${folderName}" watching is ${slot.isPaused ? 'paused' : 'resumed'}.`,
          slot.isPaused ? 'PAUSED' : 'INFO',
          slot.isPaused ? 'event-change' : 'event-info'
        );
      });
    } else {
      card.innerHTML = `
        <div class="watcher-main-row">
          <div class="watcher-left">
            <div class="watcher-icon-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
            <div class="watcher-details">
              <div class="watcher-name-row">
                <span class="watcher-name">Slot #${index + 1} (Empty)</span>
                <span class="badge-indexing">Available</span>
              </div>
              <div class="watcher-subtext">Click to choose a local folder to watch and sync</div>
            </div>
          </div>

          <div class="watcher-right">
            <button class="btn-manage select-folder-btn" data-slot-id="${slot.id}">+ Select Folder</button>
          </div>
        </div>
      `;

      card.addEventListener('click', async () => {
        await handleSelectFolderForSlot(slot);
      });
    }

    watchersListContainer.appendChild(card);
  });

  updateSummaryStats();
}

// ========================================================
// 6. MANAGE DROPDOWN MENÜSÜ & AKSİYONLARI
// ========================================================
function positionDropdownSmart(menuElement, anchorButton, width = 310, estimatedHeight = 260) {
  if (!menuElement || !anchorButton) return;
  const rect = anchorButton.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  // Horizontal alignment: Align with right edge, keep inside window margins
  let left = rect.right - width;
  if (left < 12) left = 12;
  if (left + width > window.innerWidth - 12) {
    left = window.innerWidth - width - 12;
  }
  menuElement.style.left = `${Math.round(left)}px`;
  menuElement.style.width = `${width}px`;

  // Measure content height safely
  const prevDisplay = menuElement.style.display;
  const prevVisibility = menuElement.style.visibility;
  const prevMaxHeight = menuElement.style.maxHeight;

  menuElement.style.visibility = 'hidden';
  menuElement.style.display = 'flex';
  menuElement.style.maxHeight = 'none';
  const actualHeight = Math.max(menuElement.scrollHeight || 0, estimatedHeight);
  menuElement.style.visibility = prevVisibility || '';
  menuElement.style.display = prevDisplay || 'none';
  menuElement.style.maxHeight = prevMaxHeight || '';

  const margin = 16;

  // Bottom toolbar buttons (primaryCloudDropdownBtn, syncPriorityDropdownBtn) MUST always open upward
  const isBottomToolbar = (
    anchorButton.id === 'primaryCloudDropdownBtn' ||
    anchorButton.id === 'syncPriorityDropdownBtn' ||
    !!(anchorButton.closest && (anchorButton.closest('.config-target-card') || anchorButton.closest('.config-target-section'))) ||
    spaceBelow < 320
  );

  const openUpward = isBottomToolbar || spaceAbove > spaceBelow;

  if (openUpward) {
    menuElement.style.top = 'auto';
    menuElement.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
    menuElement.style.maxHeight = `${Math.min(360, Math.max(160, Math.floor(spaceAbove - margin)))}px`;
  } else {
    menuElement.style.bottom = 'auto';
    menuElement.style.top = `${Math.round(rect.bottom + 6)}px`;
    menuElement.style.maxHeight = `${Math.min(360, Math.max(160, Math.floor(spaceBelow - margin)))}px`;
  }
  menuElement.style.overflowY = 'auto';
}

function openManageDropdown(slot, buttonElement) {
  currentManageSlot = slot;
  closePriorityDropdown();
  if (typeof closePrimaryCloudDropdown === 'function') closePrimaryCloudDropdown();
  const manageVaultLabel = document.getElementById('manageVaultLabel');
  if (manageVaultLabel) {
    manageVaultLabel.textContent = slot.vault ? 'Vault Settings (Active)...' : 'Vault Encryption (AES-256)...';
  }
  const manageDecryptFolder = document.getElementById('manageDecryptFolder');
  if (manageDecryptFolder) {
    manageDecryptFolder.style.display = slot.vault ? 'flex' : 'none';
  }
  positionDropdownSmart(manageDropdownMenu, buttonElement, 225, 220);
  manageDropdownMenu.style.display = 'flex';
}

function closeManageDropdown() {
  if (manageDropdownMenu) {
    manageDropdownMenu.style.display = 'none';
  }
}

document.addEventListener('click', (e) => {
  if (manageDropdownMenu && !manageDropdownMenu.contains(e.target) && (!e.target.closest || !e.target.closest('.btn-manage'))) {
    closeManageDropdown();
  }
});

if (manageOpenExplorer) {
  manageOpenExplorer.addEventListener('click', () => {
    closeManageDropdown();
    if (currentManageSlot && currentManageSlot.path) {
      window.squirrel.openFolderInExplorer(currentManageSlot.path);
    }
  });
}

if (manageSyncNow) {
  manageSyncNow.addEventListener('click', async () => {
    closeManageDropdown();
    if (!currentManageSlot || !currentManageSlot.path) return;
    const isPrimaryConn = primaryCloud === 'google-drive'
      ? isDriveConnected
      : !!(cloudAccounts[primaryCloud] && cloudAccounts[primaryCloud].connected);

    if (!isPrimaryConn) {
      const pName = (CLOUD_PROVIDERS[primaryCloud] && CLOUD_PROVIDERS[primaryCloud].name) || 'Bulut';
      alert(`Lütfen önce ${pName} hesabınızı bağlayın.`);
      return;
    }

    const slot = currentManageSlot;
    slot.isCancelled = false;
    slot._maxPercent = 0;
    slot._maxBytes = 0;
    slot.progress = {
      percent: 0,
      currentFile: 'Drive ile karşılaştırılıyor...',
      statsHtml: '🔍 Dosyalar taranıyor...',
      etaText: 'Hesaplanıyor...',
      netSpeedText: '0 Mbps',
      diskSpeedText: '0 MB/s',
      done: false,
      hidden: false,
    };

    let card = document.querySelector(`.watcher-card[data-slot-id="${slot.id}"]`);
    if (card) {
      const progressStrip = card.querySelector(`#cardProgress-${slot.id}`);
      if (progressStrip) {
        progressStrip.style.display = 'flex';
        const fill = progressStrip.querySelector('.card-progress-fill');
        const fileEl = progressStrip.querySelector(`#progFile-${slot.id}`);
        const statsEl = progressStrip.querySelector(`#progStats-${slot.id}`);
        const etaEl = progressStrip.querySelector(`#progEta-${slot.id}`);
        const speedNetEl = progressStrip.querySelector(`#speedNet-${slot.id} .speed-val`);
        const speedDiskEl = progressStrip.querySelector(`#speedDisk-${slot.id} .speed-val`);
        if (fill) fill.style.width = '0%';
        if (fileEl) fileEl.textContent = 'Drive ile karşılaştırılıyor...';
        if (statsEl) statsEl.innerHTML = '🔍 Dosyalar taranıyor...';
        if (etaEl) etaEl.textContent = 'Hesaplanıyor...';
        if (speedNetEl) speedNetEl.textContent = '0 Mbps';
        if (speedDiskEl) speedDiskEl.textContent = '0 MB/s';
      }
      const badgeContainer = card.querySelector(`#badge-${slot.id}`);
      if (badgeContainer) {
        const vaultBadge = getVaultBadgeHtml(slot);
        badgeContainer.innerHTML = `<span class="badge-syncing"><span class="sync-dot-pulse"></span> Syncing (%0)</span> ${vaultBadge}`;
      }
    }

    addSystemInfoLog(`Syncing "${slot.name}" with cloud...`, 'SYNC', 'event-drive');
    try {
      await window.squirrel.syncFolder(slot.path);
    } catch (err) {
      console.error('syncFolder error:', err);
    }
  });
}

if (manageChangeFolder) {
  manageChangeFolder.addEventListener('click', async () => {
    closeManageDropdown();
    if (currentManageSlot) {
      await handleSelectFolderForSlot(currentManageSlot);
    }
  });
}

if (manageRemoveFolder) {
  manageRemoveFolder.addEventListener('click', async () => {
    closeManageDropdown();
    if (currentManageSlot) {
      await handleRemoveFolderFromSlot(currentManageSlot);
    }
  });
}

const manageToggleVault = document.getElementById('manageToggleVault');
if (manageToggleVault) {
  manageToggleVault.addEventListener('click', () => {
    closeManageDropdown();
    if (currentManageSlot && currentManageSlot.path) {
      openVaultModal(currentManageSlot);
    }
  });
}

const manageDecryptFolder = document.getElementById('manageDecryptFolder');
if (manageDecryptFolder) {
  manageDecryptFolder.addEventListener('click', async () => {
    closeManageDropdown();
    if (!currentManageSlot || !currentManageSlot.path) return;
    addSystemInfoLog(`Decrypting folder "${currentManageSlot.name}"...`, 'VAULT', 'event-drive');
    const res = await window.squirrel.decryptFolderToDisk(currentManageSlot.path);
    if (res && res.success) {
      addSystemInfoLog(`✓ Decrypted "${currentManageSlot.name}" successfully to: ${res.targetDir}`, 'VAULT', 'event-drive');
    } else if (res && !res.canceled) {
      alert('Decryption error: ' + (res.error || 'Unknown error'));
    }
  });
}

// ========================================================
// 7. CPU & SYNC PRIORITY FLOATING DROPDOWN MENÜSÜ
// ========================================================
function updatePriorityUI(priority) {
  if (checkSmart) checkSmart.textContent = priority === 'smart' ? '✓' : '';
  if (checkTurbo) checkTurbo.textContent = priority === 'turbo' ? '✓' : '';
  if (checkEco) checkEco.textContent = priority === 'eco' ? '✓' : '';

  if (priorityItemSmart) priorityItemSmart.classList.toggle('active', priority === 'smart');
  if (priorityItemTurbo) priorityItemTurbo.classList.toggle('active', priority === 'turbo');
  if (priorityItemEco) priorityItemEco.classList.toggle('active', priority === 'eco');

  let labelText = 'Smart (Low CPU)';
  if (priority === 'turbo') labelText = 'High Speed (Turbo)';
  if (priority === 'eco') labelText = 'Battery Saver (Eco)';

  if (syncPriorityLabel) syncPriorityLabel.textContent = labelText;
}

if (syncPriorityDropdownBtn) {
  syncPriorityDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!priorityDropdownMenu) return;

    if (priorityDropdownMenu.style.display === 'flex') {
      closePriorityDropdown();
      return;
    }

    closeManageDropdown();
    if (typeof closePrimaryCloudDropdown === 'function') closePrimaryCloudDropdown();

    positionDropdownSmart(priorityDropdownMenu, syncPriorityDropdownBtn, 320, 260);
    priorityDropdownMenu.style.display = 'flex';
  });
}

function closePriorityDropdown() {
  if (priorityDropdownMenu) priorityDropdownMenu.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (priorityDropdownMenu && !priorityDropdownMenu.contains(e.target) && (!syncPriorityDropdownBtn || !syncPriorityDropdownBtn.contains(e.target))) {
    closePriorityDropdown();
  }
  if (primaryCloudDropdownMenu && !primaryCloudDropdownMenu.contains(e.target) && (!primaryCloudDropdownBtn || !primaryCloudDropdownBtn.contains(e.target))) {
    if (typeof closePrimaryCloudDropdown === 'function') closePrimaryCloudDropdown();
  }
});

[
  { el: priorityItemSmart, val: 'smart', name: 'Smart (Low CPU)' },
  { el: priorityItemTurbo, val: 'turbo', name: 'High Speed (Turbo)' },
  { el: priorityItemEco, val: 'eco', name: 'Battery Saver (Eco)' },
].forEach(({ el, val, name }) => {
  if (el) {
    el.addEventListener('click', async () => {
      closePriorityDropdown();
      await window.squirrel.setSyncPriority(val);
      updatePriorityUI(val);
      addSystemInfoLog(`Senkronizasyon önceliği "${name}" olarak güncellendi.`, 'AYAR', 'event-info');
    });
  }
});

// ========================================================
// 8. ADD & REMOVE FOLDERS
// ========================================================
async function handleSelectFolderForSlot(slot) {
  try {
    const selectedPath = await window.squirrel.selectFolderDialog();
    if (!selectedPath) return;

    const alreadyWatching = slots.find((s) => s.id !== slot.id && s.path === selectedPath);
    if (alreadyWatching) {
      alert('This folder is already monitored!');
      return;
    }

    if (slot.path && slot.path !== selectedPath) {
      await window.squirrel.unwatchFolder(slot.path, true);
    }

    const res = await window.squirrel.watchFolder(selectedPath);
    if (res.success) {
      slot.path = res.folderPath;
      slot.name = res.folderName;
      slot.stats = res.stats;
      slot.lastSync = 'Just now';
      renderWatchersList();
      addSystemInfoLog(`"${res.folderName}" folder added and monitoring started (${res.stats.fileCount} files).`, 'NEW', 'event-add');
    } else {
      alert('Could not start watching folder: ' + res.error);
    }
  } catch (err) {
    console.error('Folder selection error:', err);
  }
}

async function handleRemoveFolderFromSlot(slot) {
  if (!slot.path) return;

  const folderName = slot.name;
  const pathToRemove = slot.path;
  const primaryInfo = getPrimaryCloudInfo();
  const cloudName = primaryInfo.name || 'Cloud';

  if (confirm(`Are you sure you want to stop watching "${folderName}" and delete its cloud backup from ${cloudName}?`)) {
    try {
      await window.squirrel.unwatchFolder(pathToRemove, true);
      slot.path = null;
      slot.name = null;
      slot.stats = null;
      slot.progress = null;
      renderWatchersList();
      addSystemInfoLog(`"${folderName}" watching stopped and removed from ${cloudName}.`, 'REMOVED', 'event-unlink');
    } catch (err) {
      console.error('Folder removal error:', err);
    }
  }
}

if (addFolderBtn) {
  addFolderBtn.addEventListener('click', async () => {
    let targetSlot = slots.find((s) => !s.path);
    if (!targetSlot) {
      targetSlot = {
        id: ++slotCounter,
        path: null,
        name: null,
        stats: null,
        isPaused: false,
        lastSync: 'Just now',
        progress: null,
      };
      slots.push(targetSlot);
    }
    await handleSelectFolderForSlot(targetSlot);
  });
}

if (sidebarSearchInput) {
  sidebarSearchInput.addEventListener('input', () => {
    renderWatchersList();
    filterLogItems();
  });
}

// ========================================================
// 8.5. ÇOKLU BULUT HESAPLARI & PRIMARY CLOUD YÖNETİMİ
// ========================================================
function getMenuItemId(key) {
  return {
    'google-drive': 'cloudItemGoogleDrive',
    'onedrive': 'cloudItemOneDrive',
    'dropbox': 'cloudItemDropbox',
    'icloud': 'cloudItemICloud',
    'mega': 'cloudItemMega',
  }[key];
}

function getMenuCheckId(key) {
  return {
    'google-drive': 'checkCloudGoogleDrive',
    'onedrive': 'checkCloudOneDrive',
    'dropbox': 'checkCloudDropbox',
    'icloud': 'checkCloudICloud',
    'mega': 'checkCloudMega',
  }[key];
}

function getMenuStatusId(key) {
  return {
    'google-drive': 'cloudMenuStatusGoogleDrive',
    'onedrive': 'cloudMenuStatusOneDrive',
    'dropbox': 'cloudMenuStatusDropbox',
    'icloud': 'cloudMenuStatusICloud',
    'mega': 'cloudMenuStatusMega',
  }[key];
}

function getCardId(key) {
  return {
    'google-drive': 'cardCloudGoogleDrive',
    'onedrive': 'cardCloudOneDrive',
    'dropbox': 'cardCloudDropbox',
    'icloud': 'cardCloudICloud',
    'mega': 'cardCloudMega',
  }[key];
}

function getPrimaryBadgeId(key) {
  return {
    'google-drive': 'primaryBadgeGoogleDrive',
    'onedrive': 'primaryBadgeOneDrive',
    'dropbox': 'primaryBadgeDropbox',
    'icloud': 'primaryBadgeICloud',
    'mega': 'primaryBadgeMega',
  }[key];
}

function getSetPrimaryBtnId(key) {
  return {
    'google-drive': 'setPrimaryGoogleDrive',
    'onedrive': 'setPrimaryOneDrive',
    'dropbox': 'setPrimaryDropbox',
    'icloud': 'setPrimaryICloud',
    'mega': 'setPrimaryMega',
  }[key];
}

function getConnectBtnId(key) {
  return {
    'google-drive': 'openDriveModalBtn',
    'onedrive': 'connectOneDriveBtn',
    'dropbox': 'connectDropboxBtn',
    'icloud': 'connectICloudBtn',
    'mega': 'connectMegaBtn',
  }[key];
}

function getPillId(key) {
  return {
    'google-drive': 'driveConnectedPill',
    'onedrive': 'onedriveConnectedPill',
    'dropbox': 'dropboxConnectedPill',
    'icloud': 'icloudConnectedPill',
    'mega': 'megaConnectedPill',
  }[key];
}

function getPillEmailId(key) {
  return {
    'google-drive': 'drivePillEmail',
    'onedrive': 'onedrivePillEmail',
    'dropbox': 'dropboxPillEmail',
    'icloud': 'icloudPillEmail',
    'mega': 'megaPillEmail',
  }[key];
}

function getStatusTagId(key) {
  return {
    'google-drive': 'cloudStatusTag',
    'onedrive': 'onedriveStatusTag',
    'dropbox': 'dropboxStatusTag',
    'icloud': 'icloudStatusTag',
    'mega': 'megaStatusTag',
  }[key];
}

async function loadCloudAccounts() {
  if (!window.squirrel.getCloudAccounts) return;
  try {
    const data = await window.squirrel.getCloudAccounts();
    if (data) {
      primaryCloud = data.primaryCloud || 'google-drive';
      cloudAccounts = data.accounts || {};

      if (cloudAccounts['google-drive']) {
        if (cloudAccounts['google-drive'].connected) {
          isDriveConnected = true;
          if (cloudAccounts['google-drive'].email && !driveUserInfo) {
            driveUserInfo = { isConnected: true, email: cloudAccounts['google-drive'].email };
          }
        } else {
          cloudAccounts['google-drive'].connected = isDriveConnected;
        }
        cloudAccounts['google-drive'].email = (driveUserInfo && driveUserInfo.email) || cloudAccounts['google-drive'].email;
      }

      renderCloudAccountsList();
      updatePrimaryCloudUI(primaryCloud);
    }
  } catch (err) {
    console.error('Bulut hesapları yüklenemedi:', err);
  }
}

function updatePrimaryCloudUI(cloudId) {
  primaryCloud = cloudId;
  const meta = CLOUD_PROVIDERS[cloudId] || CLOUD_PROVIDERS['google-drive'];
  const acc = cloudAccounts[cloudId] || {};
  const isConn = cloudId === 'google-drive' ? isDriveConnected : !!acc.connected;
  const email = cloudId === 'google-drive' ? ((driveUserInfo && driveUserInfo.email) || '') : (acc.email || '');

  // Update button content
  if (primaryCloudIcon) {
    primaryCloudIcon.innerHTML = meta.iconSvg;
  }
  if (primaryCloudLabel) {
    if (isConn && email) {
      primaryCloudLabel.textContent = `${meta.name} (${email.split('@')[0]})`;
    } else {
      primaryCloudLabel.textContent = meta.name;
    }
  }

  // Floating dropdown menu active items
  const cloudKeys = ['google-drive', 'onedrive', 'dropbox', 'icloud', 'mega'];
  cloudKeys.forEach((key) => {
    const itemEl = document.getElementById(getMenuItemId(key));
    const checkEl = document.getElementById(getMenuCheckId(key));
    const isActive = key === cloudId;
    if (itemEl) itemEl.classList.toggle('active', isActive);
    if (checkEl) checkEl.textContent = isActive ? '✓' : '';
  });

  // Cloud accounts cards
  cloudKeys.forEach((key) => {
    const cardEl = document.getElementById(getCardId(key));
    const badgeEl = document.getElementById(getPrimaryBadgeId(key));
    const setPrimaryBtn = document.getElementById(getSetPrimaryBtnId(key));
    const isThisPrimary = key === cloudId;
    const thisAcc = cloudAccounts[key] || {};
    const thisConn = key === 'google-drive' ? isDriveConnected : !!thisAcc.connected;

    if (cardEl) {
      cardEl.classList.toggle('is-primary', isThisPrimary);
    }
    if (badgeEl) {
      badgeEl.style.display = isThisPrimary ? 'inline-flex' : 'none';
    }
    if (setPrimaryBtn) {
      setPrimaryBtn.style.display = (thisConn && !isThisPrimary) ? 'inline-block' : 'none';
    }
  });

  // Refresh "Synced to: ..." text on monitored cards
  renderWatchersList();
}

function renderCloudAccountsList() {
  const cloudKeys = ['google-drive', 'onedrive', 'dropbox', 'icloud', 'mega'];

  cloudKeys.forEach((key) => {
    const acc = cloudAccounts[key] || {};
    const isConn = key === 'google-drive' ? isDriveConnected : !!acc.connected;
    const email = key === 'google-drive' ? ((driveUserInfo && driveUserInfo.email) || '') : (acc.email || '');

    // Floating dropdown menu status label
    const menuStatusEl = document.getElementById(getMenuStatusId(key));
    if (menuStatusEl) {
      if (isConn && email) {
        menuStatusEl.textContent = `Connected • ${email}`;
        menuStatusEl.className = 'cloud-menu-status connected';
      } else {
        menuStatusEl.textContent = 'Disconnected';
        menuStatusEl.className = 'cloud-menu-status';
      }
    }

    // Account card elements
    const connectBtn = document.getElementById(getConnectBtnId(key));
    const pill = document.getElementById(getPillId(key));
    const pillEmail = document.getElementById(getPillEmailId(key));
    const statusTag = document.getElementById(getStatusTagId(key));
    const setPrimaryBtn = document.getElementById(getSetPrimaryBtnId(key));
    const isThisPrimary = key === primaryCloud;

    if (isConn) {
      if (connectBtn) connectBtn.style.display = 'none';
      if (pill) {
        pill.style.display = 'inline-flex';
        if (pillEmail) pillEmail.textContent = email || 'Account Connected';
      }
      if (statusTag) statusTag.textContent = isThisPrimary ? 'Status: Primary & Active' : 'Status: Connected (Ready)';
      if (setPrimaryBtn) setPrimaryBtn.style.display = isThisPrimary ? 'none' : 'inline-block';
    } else {
      if (connectBtn) connectBtn.style.display = 'inline-flex';
      if (pill) pill.style.display = 'none';
      if (statusTag) statusTag.textContent = 'Status: Disconnected';
      if (setPrimaryBtn) setPrimaryBtn.style.display = 'none';
    }
  });
}

function openCloudModal(cloudId) {
  const meta = CLOUD_PROVIDERS[cloudId];
  if (!meta) return;

  if (cloudId === 'google-drive') {
    if (driveModal) driveModal.style.display = 'flex';
    return;
  }

  const modal = document.getElementById('cloudConnectModal');
  const titleEl = document.getElementById('cloudModalTitle');
  const subtitleEl = document.getElementById('cloudModalSubtitle');
  const infoEl = document.getElementById('cloudModalInfoText');
  const iconWrapper = document.getElementById('cloudModalIconWrapper');
  const hiddenId = document.getElementById('connectCloudId');
  const emailInput = document.getElementById('inputCloudEmail');
  const emailLabel = document.getElementById('labelCloudEmail');
  const groupEmail = document.getElementById('groupCloudEmail');
  const secretInput = document.getElementById('inputCloudSecret');
  const groupSecret = document.getElementById('groupCloudSecret');
  const labelSecret = document.getElementById('labelCloudSecret');
  const errorEl = document.getElementById('cloudModalError');
  const submitBtn = document.getElementById('submitCloudConnectBtn');
  const cloudModalFooter = document.getElementById('cloudModalFooter');
  const btnCloudWebAuth = document.getElementById('btnCloudWebAuth');
  const btnCloudWebAuthText = document.getElementById('btnCloudWebAuthText');
  const cloudWebAuthSection = document.getElementById('cloudWebAuthSection');
  const cloudModalDivider = document.getElementById('cloudModalDivider');
  const cloudAdvancedToggleWrap = document.getElementById('cloudAdvancedToggleWrap');
  const cloudAdvancedSection = document.getElementById('cloudAdvancedSection');
  const toggleCloudAdvanced = document.getElementById('toggleCloudAdvanced');

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  if (titleEl) titleEl.textContent = meta.modalTitle || `Connect ${meta.name}`;
  if (subtitleEl) subtitleEl.textContent = meta.modalSubtitle || `Pair Squirrel with your ${meta.name} account`;
  if (iconWrapper) iconWrapper.innerHTML = meta.iconSvg;
  if (hiddenId) hiddenId.value = cloudId;

  // Reset advanced section
  if (cloudAdvancedSection) cloudAdvancedSection.style.display = 'none';
  if (toggleCloudAdvanced) toggleCloudAdvanced.textContent = '⚙️ Advanced Developer Settings (App Key / Token) ▾';

  if (cloudId === 'dropbox') {
    if (cloudWebAuthSection) cloudWebAuthSection.style.display = 'flex';
    if (btnCloudWebAuth) {
      btnCloudWebAuth.disabled = false;
      btnCloudWebAuth.style.background = '#2563eb';
    }
    if (btnCloudWebAuthText) btnCloudWebAuthText.textContent = '🌐 Sign In via Dropbox Web';
    if (cloudModalDivider) cloudModalDivider.style.display = 'none';
    if (infoEl) infoEl.textContent = 'Connect your Dropbox account using your Access Token below or sign in via browser.';
    if (groupEmail) groupEmail.style.display = 'none';
    if (groupSecret) groupSecret.style.display = 'none';
    if (cloudAdvancedToggleWrap) cloudAdvancedToggleWrap.style.display = 'block';
    if (cloudModalFooter) cloudModalFooter.style.display = 'flex';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔗 Connect with Token';
    }
  } else if (cloudId === 'onedrive') {
    if (cloudWebAuthSection) cloudWebAuthSection.style.display = 'flex';
    if (btnCloudWebAuth) {
      btnCloudWebAuth.disabled = false;
      btnCloudWebAuth.style.background = '#2563eb';
    }
    if (btnCloudWebAuthText) btnCloudWebAuthText.textContent = '🌐 Sign In via Microsoft Web';
    if (cloudModalDivider) cloudModalDivider.style.display = 'none';
    if (infoEl) infoEl.textContent = 'Connect your Microsoft OneDrive account using your Access Token below or sign in via browser.';
    if (groupEmail) groupEmail.style.display = 'none';
    if (groupSecret) groupSecret.style.display = 'none';
    if (cloudAdvancedToggleWrap) cloudAdvancedToggleWrap.style.display = 'block';
    if (cloudModalFooter) cloudModalFooter.style.display = 'flex';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔗 Connect with Token';
    }
  } else if (cloudId === 'mega') {
    if (cloudWebAuthSection) cloudWebAuthSection.style.display = 'none';
    if (cloudModalDivider) cloudModalDivider.style.display = 'none';
    if (cloudAdvancedToggleWrap) cloudAdvancedToggleWrap.style.display = 'none';
    if (infoEl) infoEl.textContent = 'Mega features client-side Zero-Knowledge End-to-End Encryption (E2EE). Files are synchronized directly to your Mega / Squirrel folder. Your password is required for secure authentication.';
    if (groupEmail) groupEmail.style.display = 'block';
    if (emailLabel) emailLabel.textContent = 'Mega Email Address';
    if (emailInput) {
      emailInput.value = '';
      emailInput.placeholder = 'user@mega.nz';
    }
    if (groupSecret) groupSecret.style.display = 'block';
    if (labelSecret) labelSecret.textContent = 'Mega Password';
    if (secretInput) {
      secretInput.value = '';
      secretInput.type = 'password';
      secretInput.placeholder = 'Your Mega account password';
      secretInput.required = true;
    }
    if (cloudModalFooter) cloudModalFooter.style.display = 'flex';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🔐 Sign In to Mega & Connect';
    }
  } else if (cloudId === 'icloud') {
    if (cloudWebAuthSection) cloudWebAuthSection.style.display = 'none';
    if (cloudModalDivider) cloudModalDivider.style.display = 'none';
    if (cloudAdvancedToggleWrap) cloudAdvancedToggleWrap.style.display = 'none';
    if (infoEl) infoEl.textContent = 'Apple iCloud Drive: Squirrel integrates seamlessly with official iCloud for Windows. Files will be synced to your iCloudDrive / Squirrel folder.';
    if (groupEmail) groupEmail.style.display = 'block';
    if (emailLabel) emailLabel.textContent = 'Apple ID / iCloud Email';
    if (emailInput) {
      emailInput.value = '';
      emailInput.placeholder = 'apple_id@icloud.com';
    }
    if (groupSecret) groupSecret.style.display = 'none';
    if (cloudModalFooter) cloudModalFooter.style.display = 'flex';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '☁️ Connect iCloud Drive';
    }
  }

  if (modal) modal.style.display = 'flex';
}

function closeCloudModal() {
  const modal = document.getElementById('cloudConnectModal');
  if (modal) modal.style.display = 'none';
}

const closeCloudConnectModalBtn = document.getElementById('closeCloudConnectModalBtn');
const cancelCloudConnectBtn = document.getElementById('cancelCloudConnectBtn');
const cloudConnectForm = document.getElementById('cloudConnectForm');
const btnCloudWebAuth = document.getElementById('btnCloudWebAuth');
const btnCloudWebAuthText = document.getElementById('btnCloudWebAuthText');
const toggleCloudAdvanced = document.getElementById('toggleCloudAdvanced');
const cloudAdvancedSection = document.getElementById('cloudAdvancedSection');
const cloudModalFooter = document.getElementById('cloudModalFooter');

if (closeCloudConnectModalBtn) closeCloudConnectModalBtn.addEventListener('click', closeCloudModal);
if (cancelCloudConnectBtn) cancelCloudConnectBtn.addEventListener('click', closeCloudModal);

if (toggleCloudAdvanced) {
  toggleCloudAdvanced.addEventListener('click', (e) => {
    e.preventDefault();
    if (!cloudAdvancedSection) return;
    const isHidden = cloudAdvancedSection.style.display === 'none';
    cloudAdvancedSection.style.display = isHidden ? 'block' : 'none';
    toggleCloudAdvanced.textContent = isHidden
      ? '⚙️ Hide Developer Settings ▴'
      : '⚙️ Advanced Developer Settings (App Key / Token) ▾';
  });
}

if (btnCloudWebAuth) {
  btnCloudWebAuth.addEventListener('click', async () => {
    const cloudId = document.getElementById('connectCloudId').value;
    const errorEl = document.getElementById('cloudModalError');
    const customKey = document.getElementById('inputCloudKey') ? document.getElementById('inputCloudKey').value.trim() : null;
    const customSecret = document.getElementById('inputCloudSecret') ? document.getElementById('inputCloudSecret').value.trim() : null;

    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }

    btnCloudWebAuth.disabled = true;
    if (btnCloudWebAuthText) {
      btnCloudWebAuthText.textContent = '⏳ Browser opened, waiting for approval...';
    } else {
      btnCloudWebAuth.textContent = '⏳ Browser opened, waiting for approval...';
    }

    try {
      const res = await window.squirrel.startCloudWebAuth(cloudId, customKey, customSecret);
      if (res && res.success) {
        addSystemInfoLog(`Browser opened for ${CLOUD_PROVIDERS[cloudId].name}. Waiting for authorization...`, 'CLOUD', 'event-drive');
        let attempts = 0;
        const checkTimer = setInterval(async () => {
          attempts++;
          const data = await window.squirrel.getCloudAccounts();
          if (data && data.accounts && data.accounts[cloudId] && data.accounts[cloudId].connected) {
            clearInterval(checkTimer);
            btnCloudWebAuth.style.background = '#10b981';
            if (btnCloudWebAuthText) {
              btnCloudWebAuthText.textContent = '✅ Connected Successfully!';
            } else {
              btnCloudWebAuth.textContent = '✅ Connected Successfully!';
            }
            setTimeout(async () => {
              closeCloudModal();
              await window.squirrel.setPrimaryCloud(cloudId);
              await loadCloudAccounts();
              addSystemInfoLog(`${CLOUD_PROVIDERS[cloudId].name} account connected successfully!`, 'CLOUD', 'event-drive');
            }, 800);
          }
          if (attempts > 120) {
            clearInterval(checkTimer);
            if (btnCloudWebAuth) {
              btnCloudWebAuth.disabled = false;
              btnCloudWebAuth.style.background = '#2563eb';
              const defaultText = cloudId === 'dropbox' ? '🌐 Sign In via Dropbox Web' : '🌐 Sign In via Microsoft Web';
              if (btnCloudWebAuthText) btnCloudWebAuthText.textContent = defaultText;
              else btnCloudWebAuth.textContent = defaultText;
            }
          }
        }, 1200);
      } else {
        if (errorEl) {
          errorEl.textContent = res.error || 'Could not start authorization. Please enter an Access Token below.';
          errorEl.style.display = 'block';
        }
        btnCloudWebAuth.disabled = false;
        btnCloudWebAuth.style.background = '#2563eb';
        const defaultText = cloudId === 'dropbox' ? '🌐 Sign In via Dropbox Web' : '🌐 Sign In via Microsoft Web';
        if (btnCloudWebAuthText) btnCloudWebAuthText.textContent = defaultText;
        else btnCloudWebAuth.textContent = defaultText;
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
      }
      btnCloudWebAuth.disabled = false;
      btnCloudWebAuth.style.background = '#2563eb';
      const defaultText = cloudId === 'dropbox' ? '🌐 Sign In via Dropbox Web' : '🌐 Sign In via Microsoft Web';
      if (btnCloudWebAuthText) btnCloudWebAuthText.textContent = defaultText;
      else btnCloudWebAuth.textContent = defaultText;
    }
  });
}

if (cloudConnectForm) {
  cloudConnectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cloudId = document.getElementById('connectCloudId').value;
    const email = document.getElementById('inputCloudEmail').value.trim();
    const password = document.getElementById('inputCloudSecret') ? document.getElementById('inputCloudSecret').value : '';
    const manualToken = document.getElementById('inputCloudToken') ? document.getElementById('inputCloudToken').value.trim() : '';
    const errorEl = document.getElementById('cloudModalError');
    const submitBtn = document.getElementById('submitCloudConnectBtn');

    if (errorEl) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
    }
    if (!cloudId) return;

    if (cloudId === 'mega') {
      if (!email) {
        if (errorEl) {
          errorEl.textContent = 'Please enter your Mega email address.';
          errorEl.style.display = 'block';
        }
        return;
      }
      if (!password) {
        if (errorEl) {
          errorEl.textContent = 'Please enter your Mega password.';
          errorEl.style.display = 'block';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Connecting to Mega...';
      }

      try {
        const res = await window.squirrel.loginMega(email, password);
        if (res && res.success) {
          closeCloudModal();
          addSystemInfoLog(`Mega (MEGA.nz) account connected (${email}).`, 'CLOUD', 'event-drive');
          await window.squirrel.setPrimaryCloud('mega');
          await loadCloudAccounts();
        } else {
          if (errorEl) {
            errorEl.textContent = res.error || 'Mega login failed. Please verify your email and password.';
            errorEl.style.display = 'block';
          }
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = 'Connection error: ' + err.message;
          errorEl.style.display = 'block';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🔐 Sign In to Mega & Connect';
        }
      }
      return;
    } else if (cloudId === 'icloud') {
      try {
        const res = await window.squirrel.connectICloud(email || 'Apple iCloud', null);
        if (res && res.success) {
          closeCloudModal();
          addSystemInfoLog(`Apple iCloud Drive connected successfully (${email || 'iCloud'}).`, 'CLOUD', 'event-drive');
          await window.squirrel.setPrimaryCloud('icloud');
          await loadCloudAccounts();
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = 'iCloud connection error: ' + err.message;
          errorEl.style.display = 'block';
        }
      }
      return;
    } else if (cloudId === 'dropbox') {
      const token = manualToken || password;
      if (token) {
        try {
          const res = await window.squirrel.saveDropboxToken(token, email || null);
          if (res && res.success) {
            closeCloudModal();
            addSystemInfoLog(`Dropbox account connected (${res.email || email || 'Dropbox User'}).`, 'CLOUD', 'event-drive');
            await window.squirrel.setPrimaryCloud('dropbox');
            await loadCloudAccounts();
            return;
          } else {
            if (errorEl) {
              errorEl.textContent = res.error || 'Dropbox token could not be verified.';
              errorEl.style.display = 'block';
            }
            return;
          }
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = 'Error: ' + err.message;
            errorEl.style.display = 'block';
          }
          return;
        }
      } else {
        if (errorEl) {
          errorEl.textContent = 'Please paste a Dropbox Access Token in Developer Settings below, or click Web Sign In.';
          errorEl.style.display = 'block';
        }
        return;
      }
    } else if (cloudId === 'onedrive') {
      const token = manualToken || password;
      if (token) {
        try {
          const res = await window.squirrel.saveOneDriveToken(token, email || null);
          if (res && res.success) {
            closeCloudModal();
            addSystemInfoLog(`Microsoft OneDrive account connected (${res.email || email || 'OneDrive User'}).`, 'CLOUD', 'event-drive');
            await window.squirrel.setPrimaryCloud('onedrive');
            await loadCloudAccounts();
            return;
          } else {
            if (errorEl) {
              errorEl.textContent = res.error || 'OneDrive token could not be verified.';
              errorEl.style.display = 'block';
            }
            return;
          }
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = 'Error: ' + err.message;
            errorEl.style.display = 'block';
          }
          return;
        }
      } else {
        if (errorEl) {
          errorEl.textContent = 'Please paste a Microsoft Graph Token in Developer Settings below, or click Web Sign In.';
          errorEl.style.display = 'block';
        }
        return;
      }
    }
  });
}


// Connect buttons
[
  { id: 'connectOneDriveBtn', cloud: 'onedrive' },
  { id: 'connectDropboxBtn', cloud: 'dropbox' },
  { id: 'connectICloudBtn', cloud: 'icloud' },
  { id: 'connectMegaBtn', cloud: 'mega' },
].forEach(({ id, cloud }) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', () => openCloudModal(cloud));
  }
});

// Disconnect buttons
[
  { id: 'disconnectOneDriveBtn', cloud: 'onedrive', name: 'Microsoft OneDrive' },
  { id: 'disconnectDropboxBtn', cloud: 'dropbox', name: 'Dropbox' },
  { id: 'disconnectICloudBtn', cloud: 'icloud', name: 'iCloud Drive' },
  { id: 'disconnectMegaBtn', cloud: 'mega', name: 'Mega (MEGA.nz)' },
].forEach(({ id, cloud, name }) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to disconnect "${name}"?`)) {
        await window.squirrel.disconnectCloudAccount(cloud);
        addSystemInfoLog(`"${name}" disconnected.`, 'CLOUD', 'event-unlink');
        await loadCloudAccounts();
      }
    });
  }
});

// Set Primary buttons
[
  { id: 'setPrimaryGoogleDrive', cloud: 'google-drive' },
  { id: 'setPrimaryOneDrive', cloud: 'onedrive' },
  { id: 'setPrimaryDropbox', cloud: 'dropbox' },
  { id: 'setPrimaryICloud', cloud: 'icloud' },
  { id: 'setPrimaryMega', cloud: 'mega' },
].forEach(({ id, cloud }) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', async () => {
      await window.squirrel.setPrimaryCloud(cloud);
      addSystemInfoLog(`Primary cloud set to "${CLOUD_PROVIDERS[cloud].name}".`, 'CLOUD', 'event-drive');
      await loadCloudAccounts();
    });
  }
});

// Primary Cloud Dropdown Menu Toggle
if (primaryCloudDropdownBtn) {
  primaryCloudDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!primaryCloudDropdownMenu) return;

    if (primaryCloudDropdownMenu.style.display === 'flex') {
      closePrimaryCloudDropdown();
      return;
    }

    closeManageDropdown();
    closePriorityDropdown();

    positionDropdownSmart(primaryCloudDropdownMenu, primaryCloudDropdownBtn, 310, 360);
    primaryCloudDropdownMenu.style.display = 'flex';
  });
}

function closePrimaryCloudDropdown() {
  if (primaryCloudDropdownMenu) primaryCloudDropdownMenu.style.display = 'none';
}

window.addEventListener('resize', () => {
  closeManageDropdown();
  closePriorityDropdown();
  closePrimaryCloudDropdown();
});

window.addEventListener('scroll', () => {
  closeManageDropdown();
  closePriorityDropdown();
  closePrimaryCloudDropdown();
}, true);

// Dropdown item click
[
  { id: 'cloudItemGoogleDrive', cloud: 'google-drive' },
  { id: 'cloudItemOneDrive', cloud: 'onedrive' },
  { id: 'cloudItemDropbox', cloud: 'dropbox' },
  { id: 'cloudItemICloud', cloud: 'icloud' },
  { id: 'cloudItemMega', cloud: 'mega' },
].forEach(({ id, cloud }) => {
  const item = document.getElementById(id);
  if (item) {
    item.addEventListener('click', async () => {
      closePrimaryCloudDropdown();
      const acc = cloudAccounts[cloud] || {};
      const isConn = cloud === 'google-drive' ? isDriveConnected : !!acc.connected;

      if (isConn) {
        await window.squirrel.setPrimaryCloud(cloud);
        addSystemInfoLog(`Primary cloud set to "${CLOUD_PROVIDERS[cloud].name}".`, 'CLOUD', 'event-drive');
        await loadCloudAccounts();
      } else {
        openCloudModal(cloud);
      }
    });
  }
});

// ========================================================
// 9. GOOGLE DRIVE MODAL & KİMLİK YÖNETİMİ
// ========================================================
if (openDriveModalBtn) {
  openDriveModalBtn.addEventListener('click', () => {
    driveModal.style.display = 'flex';
  });
}

if (closeDriveModalBtn) {
  closeDriveModalBtn.addEventListener('click', () => {
    driveModal.style.display = 'none';
  });
}

if (cancelModalBtn) {
  cancelModalBtn.addEventListener('click', () => {
    driveModal.style.display = 'none';
  });
}

if (driveModal) {
  driveModal.addEventListener('click', (e) => {
    if (e.target === driveModal) driveModal.style.display = 'none';
  });
}

if (openCloudConsoleLink) {
  openCloudConsoleLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.squirrel.openFolderInExplorer('https://console.cloud.google.com/');
  });
}

if (loadCredentialsFileBtn) {
  loadCredentialsFileBtn.addEventListener('click', async () => {
    try {
      const res = await window.squirrel.loadDriveCredentialsFile();
      if (res.success) {
        alert('credentials.json loaded successfully! You can now sign in.');
        if (startAuthBtn) startAuthBtn.disabled = false;
      } else if (res.error) {
        alert('Error: ' + res.error);
      }
    } catch (err) {
      console.error('Credentials loading error:', err);
    }
  });
}

if (saveManualCredsBtn) {
  saveManualCredsBtn.addEventListener('click', async () => {
    const cId = clientIdInput.value.trim();
    const cSec = clientSecretInput.value.trim();

    if (!cId || !cSec) {
      alert('Please enter both Client ID and Client Secret.');
      return;
    }

    const res = await window.squirrel.saveDriveCredentials(cId, cSec);
    if (res.success) {
      alert('Credentials saved! You can now sign in.');
      if (startAuthBtn) startAuthBtn.disabled = false;
    } else {
      alert('Error: ' + res.error);
    }
  });
}

const btnGoogleOneClick = document.getElementById('btnGoogleOneClick');
const btnGoogleOneClickText = document.getElementById('btnGoogleOneClickText');

async function handleGoogleLogin() {
  const btn = btnGoogleOneClick || startAuthBtn;
  const label = btnGoogleOneClickText || btn;

  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Opening browser...';

  try {
    const res = await window.squirrel.startDriveAuth();
    if (res.success) {
      addSystemInfoLog('Google authorization opened in your web browser. Please allow access.', 'DRIVE', 'event-drive');
      if (label) label.textContent = 'Waiting for Google approval...';
    } else {
      alert('Authorization could not be started: ' + (res.error || 'Unknown error'));
      if (label) label.textContent = 'Sign In with Google';
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    console.error('Google Auth error:', err);
    if (label) label.textContent = 'Sign In with Google';
    if (btn) btn.disabled = false;
  }
}

if (btnGoogleOneClick) {
  btnGoogleOneClick.addEventListener('click', handleGoogleLogin);
}

if (startAuthBtn) {
  startAuthBtn.addEventListener('click', handleGoogleLogin);
}

if (disconnectDriveBtn) {
  disconnectDriveBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disconnect Google Drive?')) {
      const res = await window.squirrel.disconnectDrive();
      if (res.success) {
        updateDriveUI(res.status);
        addSystemInfoLog('Google Drive disconnected.', 'DRIVE', 'event-unlink');
      }
    }
  });
}

// ========================================================
// 10. SYNC ALL
// ========================================================
if (syncAllBtn) {
  syncAllBtn.addEventListener('click', async () => {
    if (!isDriveConnected) return;

    syncAllBtn.disabled = true;
    syncProgressCard.style.display = 'block';
    syncProgressText.textContent = 'Syncing all active folders with cloud...';
    syncProgressBarFill.style.width = '0%';
    syncProgressCount.textContent = 'Preparing...';

    addSystemInfoLog('Started full synchronization across all monitored folders...', 'DRIVE', 'event-drive');

    const res = await window.squirrel.syncAllFolders();
    if (!res.success) {
      alert('Sync could not be started: ' + res.error);
      syncProgressCard.style.display = 'none';
      syncAllBtn.disabled = false;
    }
  });
}

// ========================================================
// 11. GÜNLÜK (SYNC HISTORY) VE FİLTRELEME
// ========================================================
function addSystemInfoLog(message, badge = 'BİLGİ', typeClass = 'event-info') {
  if (emptyState && emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }

  eventCount++;
  if (logCountBadge) logCountBadge.textContent = `${eventCount} olay`;
  if (logCountNavBadge) logCountNavBadge.textContent = eventCount;

  const logItem = document.createElement('div');
  logItem.className = `log-item ${typeClass}`;
  logItem.dataset.type = typeClass;
  logItem.innerHTML = `
    <div class="log-left">
      <span class="log-badge">${badge}</span>
      <span class="log-message">${escapeHtml(message)}</span>
    </div>
    <span class="log-time">${new Date().toLocaleTimeString()}</span>
  `;

  if (logList) logList.insertBefore(logItem, logList.firstChild);
  filterLogItems();
}

function filterLogItems() {
  if (!logList) return;
  const items = logList.querySelectorAll('.log-item');
  const searchQuery = (sidebarSearchInput ? sidebarSearchInput.value.trim().toLowerCase() : '');

  items.forEach((item) => {
    const text = item.textContent.toLowerCase();
    const type = item.dataset.type || '';

    const matchesSearch = !searchQuery || text.includes(searchQuery);
    let matchesFilter = true;

    if (activeLogFilter === 'drive') matchesFilter = type.includes('event-drive');
    else if (activeLogFilter === 'add') matchesFilter = type.includes('event-add');
    else if (activeLogFilter === 'unlink') matchesFilter = type.includes('event-unlink');
    else if (activeLogFilter === 'change') matchesFilter = type.includes('event-change');

    item.style.display = matchesSearch && matchesFilter ? 'flex' : 'none';
  });
}

filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    filterChips.forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activeLogFilter = chip.dataset.filter;
    filterLogItems();
  });
});

if (clearLogBtn) {
  clearLogBtn.addEventListener('click', () => {
    if (logList) logList.innerHTML = '';
    eventCount = 0;
    if (logCountBadge) logCountBadge.textContent = '0 olay';
    if (logCountNavBadge) logCountNavBadge.textContent = '0';
    if (emptyState) emptyState.style.display = 'flex';
  });
}

// ========================================================
// 12. IPC OLAY DİNLEYİCİLERİ & ANLIK KART İLERLEME ÇUBUĞU
// ========================================================

// Dosya izleyici olayları
window.squirrel.onFileEvent((data) => {
  if (emptyState && emptyState.style.display !== 'none') {
    emptyState.style.display = 'none';
  }

  eventCount++;
  if (logCountBadge) logCountBadge.textContent = `${eventCount} olay`;
  if (logCountNavBadge) logCountNavBadge.textContent = eventCount;

  const slot = slots.find((s) => s.path === data.folderPath || s.name === data.folderName);
  if (slot) {
    slot.lastSync = 'Just now';
    renderWatchersList();
  }

  let typeClass = 'event-change';
  let badgeText = 'UPDATED';
  if (data.type === 'add' || data.type === 'addDir') {
    typeClass = 'event-add';
    badgeText = 'ADDED';
  } else if (data.type === 'unlink' || data.type === 'unlinkDir') {
    typeClass = 'event-unlink';
    badgeText = 'DELETED';
  }

  const logItem = document.createElement('div');
  logItem.className = `log-item ${typeClass}`;
  logItem.dataset.type = typeClass;
  logItem.innerHTML = `
    <div class="log-left">
      <span class="log-badge">${badgeText}</span>
      <span class="log-message">${escapeHtml(data.message)}</span>
    </div>
    <span class="log-time">${data.timestamp}</span>
  `;

  if (logList) logList.insertBefore(logItem, logList.firstChild);
  filterLogItems();
});

// Drive status change
window.squirrel.onDriveStatusChange((status) => {
  updateDriveUI(status);
  addSystemInfoLog(`Google Drive connected (${status.email}). "Squirrel" folder ready.`, 'DRIVE', 'event-drive');
});

// Drive sync event notification
window.squirrel.onDriveSyncEvent((data) => {
  addSystemInfoLog(data.message, 'DRIVE', 'event-drive');
});

// Folder progress handler
if (window.squirrel.onFolderProgress) {
  window.squirrel.onFolderProgress((data) => {
    const targetName = (data.folderName || '').trim().toLowerCase();
    const slot = slots.find((s) => {
      if (!s.path && !s.name) return false;
      if (s.name && s.name.trim().toLowerCase() === targetName) return true;
      if (s.path) {
        const base = s.path.replace(/\\/g, '/').split('/').filter(Boolean).pop();
        if (base && base.toLowerCase() === targetName) return true;
      }
      return false;
    });
    if (!slot) return;

    if (data.cancelled || slot.isCancelled) {
      slot._maxPercent = 0;
      slot._maxBytes = 0;

      let card = document.querySelector(`.watcher-card[data-slot-id="${slot.id}"]`);
      if (card) {
        const fileEl = card.querySelector(`#progFile-${slot.id}`);
        if (fileEl) fileEl.textContent = 'Sync cancelled';
        const statsEl = card.querySelector(`#progStats-${slot.id}`);
        if (statsEl) statsEl.innerHTML = '<span style="color: #f87171; font-weight: 600;">🛑 Sync cancelled</span>';
        const etaEl = card.querySelector(`#progEta-${slot.id}`);
        if (etaEl) etaEl.textContent = 'Cancelled';
        const fill = card.querySelector('.card-progress-fill');
        if (fill) {
          fill.style.width = '0%';
          fill.style.background = '#ef4444';
        }

        clearTimeout(slot._cancelTimer);
        slot._cancelTimer = setTimeout(() => {
          slot.progress = null;
          slot.isCancelled = false;
          slot.isSyncCancelled = true;
          renderWatchersList();
        }, 500);
      }
      return;
    }

    if (data.isUserPaused || slot.isUserPaused) {
      slot.isUserPaused = true;
      slot.progress = {
        percent: slot._maxPercent || 0,
        currentFile: 'Sync paused • Progress saved',
        statsHtml: '<span style="color: #fbbf24; font-weight: 600;">⏸️ Sync paused • Progress saved for resume</span>',
        etaText: 'Paused',
        netSpeedText: '0 Mbps',
        diskSpeedText: '0 MB/s',
        done: false,
        hidden: false,
      };

      let card = document.querySelector(`.watcher-card[data-slot-id="${slot.id}"]`);
      if (card) {
        const badgeContainer = card.querySelector(`#badge-${slot.id}`);
        if (badgeContainer) {
          const vaultBadge = getVaultBadgeHtml(slot);
          badgeContainer.innerHTML = `<span class="badge-paused" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">⏸️ Paused</span> ${vaultBadge}`;
        }
        const fileEl = card.querySelector(`#progFile-${slot.id}`);
        if (fileEl) fileEl.textContent = 'Sync paused by user';
        const statsEl = card.querySelector(`#progStats-${slot.id}`);
        if (statsEl) statsEl.innerHTML = '<span style="color: #fbbf24; font-weight: 600;">⏸️ Sync paused • Progress saved for resume</span>';
        const etaEl = card.querySelector(`#progEta-${slot.id}`);
        if (etaEl) etaEl.textContent = 'Paused';
        const netEl = card.querySelector(`#speedNet-${slot.id} .speed-val`);
        if (netEl) netEl.textContent = '0 Mbps';
        const diskEl = card.querySelector(`#speedDisk-${slot.id} .speed-val`);
        if (diskEl) diskEl.textContent = '0 MB/s';
        const fill = card.querySelector('.card-progress-fill');
        if (fill) {
          fill.style.background = '#f59e0b';
        }
        const pauseBtn = card.querySelector('.btn-prog-pause');
        if (pauseBtn) {
          pauseBtn.classList.add('is-paused');
          pauseBtn.title = 'Resume sync from current byte';
          pauseBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
              <path d="M7 4.2c0-.9 1-1.4 1.7-.9l11.5 7.3c.7.4.7 1.4 0 1.8L8.7 19.7c-.7.5-1.7-.1-1.7-.9V4.2z"/>
            </svg>
            <span>Resume</span>
          `;
        }
      }
      return;
    }

    if (data.isOfflinePaused || (!navigator.onLine && !data.done)) {
      slot.progress = {
        percent: slot._maxPercent || 0,
        currentFile: 'Sync paused • Waiting for internet...',
        statsHtml: '<span style="color: #f59e0b; font-weight: 600;">⏸️ Sync paused • Waiting for internet connection...</span>',
        etaText: 'Waiting for internet',
        netSpeedText: '0 Mbps',
        diskSpeedText: '0 MB/s',
        done: false,
        hidden: false,
        isOfflinePaused: true,
      };

      let card = document.querySelector(`.watcher-card[data-slot-id="${slot.id}"]`);
      if (card) {
        const badgeContainer = card.querySelector(`#badge-${slot.id}`);
        if (badgeContainer) {
          const vaultBadge = getVaultBadgeHtml(slot);
          badgeContainer.innerHTML = `<span class="badge-paused" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">🌐 Offline</span> ${vaultBadge}`;
        }
        const fileEl = card.querySelector(`#progFile-${slot.id}`);
        if (fileEl) fileEl.textContent = 'Sync paused • Waiting for internet...';
        const statsEl = card.querySelector(`#progStats-${slot.id}`);
        if (statsEl) statsEl.innerHTML = '<span style="color: #f59e0b; font-weight: 600;">⏸️ Sync paused • Waiting for internet connection...</span>';
        const etaEl = card.querySelector(`#progEta-${slot.id}`);
        if (etaEl) etaEl.textContent = 'Waiting for internet';
        const netEl = card.querySelector(`#progNetSpeed-${slot.id} .speed-val`) || card.querySelector(`#progNetSpeed-${slot.id}`);
        if (netEl) netEl.textContent = '0 Mbps';
        const diskEl = card.querySelector(`#progDiskSpeed-${slot.id} .speed-val`) || card.querySelector(`#progDiskSpeed-${slot.id}`);
        if (diskEl) diskEl.textContent = '0 MB/s';
        const fill = card.querySelector('.card-progress-fill');
        if (fill) {
          fill.style.background = '#f59e0b';
        }
      }
      return;
    }

    const totalBytes = data.totalBytes !== undefined ? data.totalBytes : 0;
    const currentBytes = Math.min(
      totalBytes > 0 ? totalBytes : Infinity,
      data.currentBytes !== undefined
        ? data.currentBytes
        : data.uploadedBytes !== undefined
          ? data.uploadedBytes
          : 0
    );

    let cleanFileName = '';
    if (typeof data.currentFile === 'string' && data.currentFile.trim() && data.currentFile !== 'undefined' && data.currentFile !== 'null') {
      cleanFileName = data.currentFile.trim();
    } else if (typeof data.fileName === 'string' && data.fileName.trim() && data.fileName !== 'undefined' && data.fileName !== 'null') {
      cleanFileName = data.fileName.trim();
    }

    const isDone = data.done || data.action === 'completed' || (data.total > 0 && data.current >= data.total);
    if (!data.cancelled) {
      slot.isSyncCancelled = false;
    }

    // Yüzde: Asla geriye düşmeyen, bayt veya dosya bazlı monoton hesap
    let rawPercent = 0;
    if (data.percent !== undefined && typeof data.percent === 'number' && data.percent > 0) {
      rawPercent = Math.min(100, Math.round(data.percent));
    } else if (data.total > 0 && data.current >= data.total) {
      rawPercent = 100;
    } else if (totalBytes > 0 && currentBytes > 0) {
      rawPercent = Math.min(100, Math.round((currentBytes / totalBytes) * 100));
    } else if (data.total > 0) {
      rawPercent = Math.min(100, Math.round((data.current / data.total) * 100));
    }

    if (slot._maxPercent === undefined || data.current === 0) {
      slot._maxPercent = 0;
      slot._maxBytes = 0;
    }
    slot._maxPercent = Math.max(slot._maxPercent, rawPercent);
    slot._maxBytes = Math.max(slot._maxBytes || 0, currentBytes);

    const percent = isDone ? 100 : slot._maxPercent;
    const etaText = isDone ? 'Completed' : formatDuration(data.etaSec);

    // Internet / Upload Speed
    let netSpeedText = '0 Mbps';
    const netSpeed = data.netSpeed || data.speed || 0;
    const netSpeedMbps = data.netSpeedMbps !== undefined
      ? data.netSpeedMbps
      : (netSpeed > 0 ? (netSpeed * 8) / 1000000 : 0);

    if (netSpeedMbps >= 1) {
      netSpeedText = `${netSpeedMbps.toFixed(1)} Mbps (${formatBytes(netSpeed)}/s)`;
    } else if (netSpeed > 0) {
      netSpeedText = `${((netSpeed * 8) / 1000).toFixed(0)} Kbps (${formatBytes(netSpeed)}/s)`;
    }

    // Disk Read Speed
    let diskSpeedText = '0 MB/s';
    const diskSpeed = data.diskSpeed || (netSpeed > 0 ? netSpeed * 1.05 : 0);
    if (diskSpeed > 0) {
      diskSpeedText = `${formatBytes(diskSpeed)}/s`;
    }

    const currentTotalFiles = data.total || 0;
    const currentDoneFiles = data.current || 0;

    const totalGBStr = formatBytes(totalBytes);
    const uploadedGBStr = formatBytes(slot._maxBytes || currentBytes);
    const remainingGBStr = formatBytes(Math.max(0, totalBytes - (slot._maxBytes || currentBytes)));

    let statsHtml = `
      📁 Total: <span class="stat-highlight">${totalGBStr}</span> •
      ☁️ Uploaded: <span class="stat-highlight">${uploadedGBStr}</span> •
      ⏳ Remaining: <span class="stat-remaining">${remainingGBStr}</span>
      <span style="color: #64748b; font-size: 10px;">(${currentDoneFiles.toLocaleString('en-US')} / ${currentTotalFiles.toLocaleString('en-US')} files • ${percent}%)</span>
    `;

    if (isDone && (currentTotalFiles === 0 || totalBytes === 0 || percent === 100)) {
      statsHtml = `📁 All files are in sync with cloud <span style="color: #10b981; font-size: 11px; font-weight: 600;">• 100%</span>`;
    }

    let currentFileDisplay = isDone ? 'All files synced' : 'Preparing files...';
    if (!isDone) {
      if (data.phase === 'scanning') {
        currentFileDisplay = data.phaseText || '🔍 Scanning local folder files...';
      } else if (data.phase === 'comparing') {
        currentFileDisplay = data.phaseText || '🔍 Comparing with Google Drive...';
      } else if (data.phase === 'encrypting') {
        currentFileDisplay = data.phaseText || '🔒 Encrypting Vault archive (AES-256)...';
      } else if (cleanFileName) {
        currentFileDisplay = `Uploading: ${cleanFileName}`;
      }
    }

    slot.progress = {
      percent,
      currentFile: currentFileDisplay,
      statsHtml,
      etaText: isDone ? '✅ Synced' : `⏳ Remaining: ${etaText}`,
      netSpeedText,
      diskSpeedText,
      done: isDone,
      hidden: false,
    };

    let card = document.querySelector(`.watcher-card[data-slot-id="${slot.id}"]`);
    if (!card) return;

    let progressStrip = card.querySelector(`#cardProgress-${slot.id}`);
    if (!progressStrip) return;

    const badgeContainer = card ? card.querySelector(`#badge-${slot.id}`) : null;

    if (progressStrip) {
      progressStrip.style.display = 'flex';
      const fill = progressStrip.querySelector('.card-progress-fill');
      const fileEl = progressStrip.querySelector(`#progFile-${slot.id}`);
      const statsEl = progressStrip.querySelector(`#progStats-${slot.id}`);
      const etaEl = progressStrip.querySelector(`#progEta-${slot.id}`);
      const speedNetEl = progressStrip.querySelector(`#speedNet-${slot.id} .speed-val`);
      const speedDiskEl = progressStrip.querySelector(`#speedDisk-${slot.id} .speed-val`);

      if (fill) {
        fill.style.width = `${percent}%`;
        fill.style.background = isDone ? '#10b981' : 'linear-gradient(90deg, #3b82f6, #06b6d4)';
      }
      if (fileEl) fileEl.textContent = slot.progress.currentFile;
      if (statsEl) statsEl.innerHTML = statsHtml;
      if (etaEl) etaEl.textContent = slot.progress.etaText;
      if (speedNetEl) speedNetEl.textContent = netSpeedText;
      if (speedDiskEl) speedDiskEl.textContent = diskSpeedText;

      const pauseBtn = progressStrip.querySelector('.btn-prog-pause');
      if (pauseBtn && !slot.isUserPaused) {
        pauseBtn.classList.remove('is-paused');
        pauseBtn.title = 'Pause sync and keep progress';
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
            <rect x="5.5" y="4" width="4.5" height="16" rx="2"></rect>
            <rect x="14" y="4" width="4.5" height="16" rx="2"></rect>
          </svg>
          <span>Pause</span>
        `;
      }
    }

    if (badgeContainer) {
      const vaultBadge = getVaultBadgeHtml(slot);
      if (isDone) {
        slot.isUserPaused = false;
        slot.lastSync = 'Just now';
        const issueBadge = getFolderIssueBadge(slot.name);
        if (issueBadge) {
          badgeContainer.innerHTML = `${issueBadge} ${vaultBadge}`;
        } else {
          badgeContainer.innerHTML = `<span class="badge-realtime">Real-time</span> ${vaultBadge}`;
        }
        updateSummaryStats();

        clearTimeout(slot._doneTimer);
        slot._doneTimer = setTimeout(() => {
          slot.progress = null;
          const liveCard = document.querySelector(`.watcher-card[data-slot-id="${slot.id}"]`);
          if (liveCard) {
            const liveStrip = liveCard.querySelector(`#cardProgress-${slot.id}`);
            if (liveStrip) liveStrip.style.display = 'none';
          }
        }, 1200);
      } else {
        let phaseLabel = `Syncing (%${percent})`;
        if (data.phase === 'scanning') phaseLabel = 'Scanning...';
        else if (data.phase === 'comparing') phaseLabel = 'Comparing...';
        else if (data.phase === 'encrypting') phaseLabel = 'Encrypting...';
        badgeContainer.innerHTML = `<span class="badge-syncing"><span class="sync-dot-pulse"></span> ${phaseLabel}</span> ${vaultBadge}`;
      }
    }
  });
}

// Global Drive sync progress handler
window.squirrel.onDriveSyncProgress((data) => {
  syncProgressCard.style.display = 'block';
  const percent = Math.round((data.current / data.total) * 100);
  syncProgressBarFill.style.width = `${percent}%`;
  syncProgressCount.textContent = `${data.current} / ${data.total} (%${percent})`;
  syncProgressText.textContent = `Uploading: ${data.currentFile || 'files...'}`;

  if (data.done) {
    syncProgressText.textContent = 'All files synced to cloud!';
    addSystemInfoLog(`All files synced to cloud (${data.total} files).`, 'CLOUD', 'event-drive');
    setTimeout(() => {
      syncProgressCard.style.display = 'none';
      updateSyncAllButton();
    }, 3000);
  }
});

// External folder deletion listener
if (window.squirrel.onFolderRemovedExternally) {
  window.squirrel.onFolderRemovedExternally((data) => {
    const slot = slots.find((s) => s.path === data.folderPath || s.name === data.folderName);
    if (slot) {
      slot.path = null;
      slot.name = null;
      slot.stats = null;
      slot.progress = null;
      renderWatchersList();
    }
    addSystemInfoLog(`"${data.folderName}" folder was deleted locally and removed from watch list.`, 'WARNING', 'event-unlink');
  });
}

// ========================================================
// 13. APP INITIALIZATION
// ========================================================
async function initApp() {
  renderMiniBarChart();
  if (typeof loadQuarantineList === 'function') {
    loadQuarantineList();
  }
  if (typeof loadExclusionsUI === 'function') {
    loadExclusionsUI();
  }

  try {
    // 1. Get saved folders and populate slots cleanly
    const res = await window.squirrel.getSavedFolders();

    slots = [];
    slotCounter = 0;
    if (res && res.folders && res.folders.length > 0) {
      res.folders.forEach((f) => {
        slots.push({
          id: ++slotCounter,
          path: f.folderPath,
          name: f.folderName,
          stats: f.stats,
          vault: !!f.vault,
          isPaused: !!f.isPaused,
          lastSync: 'Just now',
          progress: null,
          exists: f.exists !== false,
        });
      });
    }

    // Keep at least 3 slots visible (with empty slots if fewer than 3)
    while (slots.length < 3) {
      slots.push({
        id: ++slotCounter,
        path: null,
        name: null,
        stats: null,
        isPaused: false,
        lastSync: 'Just now',
        progress: null,
        exists: true,
      });
    }

    // 2. Update Drive UI
    if (res && res.driveStatus) {
      updateDriveUI(res.driveStatus);
    }

    // 3. Load cloud accounts
    await loadCloudAccounts();

    if (window.squirrel && window.squirrel.onCloudAccountsChanged) {
      window.squirrel.onCloudAccountsChanged(async () => {
        await loadCloudAccounts();
        renderWatchersList();
      });
    }

    if (window.squirrel && window.squirrel.onDriveStatusChange) {
      window.squirrel.onDriveStatusChange((status) => {
        updateDriveUI(status);
        if (cloudAccounts['google-drive']) {
          cloudAccounts['google-drive'].connected = status && status.isConnected;
          cloudAccounts['google-drive'].email = status && status.email;
        }
        renderCloudAccountsList();
        renderWatchersList();
      });
    }

    if (window.squirrel && window.squirrel.onFoldersUpdated) {
      window.squirrel.onFoldersUpdated(async () => {
        try {
          const fresh = await window.squirrel.getSavedFolders();
          if (fresh && fresh.folders) {
            fresh.folders.forEach((f) => {
              const existing = slots.find((s) => s.path && s.path.toLowerCase() === f.folderPath.toLowerCase());
              if (existing) {
                existing.isPaused = !!f.isPaused;
                if (f.stats) existing.stats = f.stats;
              }
            });
            renderWatchersList();
          }
        } catch (e) {}
      });
    }

    // 4. Load priority setting
    if (window.squirrel.getSyncPriority) {
      const priority = await window.squirrel.getSyncPriority();
      if (priority) updatePriorityUI(priority);
    }

    // 5. Render cards
    renderWatchersList();

    // 6. Load general app settings (macOS Settings Panel)
    if (window.squirrel.getAppSettings) {
      try {
        const appSettings = await window.squirrel.getAppSettings();
        if (appSettings) {
          const autoReconcileToggle = document.getElementById('autoReconcileToggle');
          if (autoReconcileToggle && typeof appSettings.autoStartupReconcile === 'boolean') {
            autoReconcileToggle.checked = appSettings.autoStartupReconcile;
          }
          const syncNotificationsToggle = document.getElementById('syncNotificationsToggle');
          if (syncNotificationsToggle && typeof appSettings.syncNotifications === 'boolean') {
            syncNotificationsToggle.checked = appSettings.syncNotifications;
          }
          const closeToTrayToggle = document.getElementById('closeToTrayToggle');
          if (closeToTrayToggle && typeof appSettings.closeToTray === 'boolean') {
            closeToTrayToggle.checked = appSettings.closeToTray;
          }
          const launchOnStartupToggle = document.getElementById('launchOnStartupToggle');
          if (launchOnStartupToggle && typeof appSettings.launchOnStartup === 'boolean') {
            launchOnStartupToggle.checked = appSettings.launchOnStartup;
          }
        }
      } catch (e) {
        console.warn('Error loading app settings:', e);
      }
    }
  } catch (err) {
    console.error('Initialization error:', err);
    renderWatchersList();
  }
}

// ========================================================
// 12. MACOS SETTINGS PANEL CONTROLS
// ========================================================
const autoReconcileToggle = document.getElementById('autoReconcileToggle');
if (autoReconcileToggle) {
  autoReconcileToggle.addEventListener('change', async () => {
    if (window.squirrel.saveAppSettings) {
      await window.squirrel.saveAppSettings({ autoStartupReconcile: autoReconcileToggle.checked });
      addSystemInfoLog(`Automatic startup reconcile ${autoReconcileToggle.checked ? 'enabled' : 'disabled'}.`, 'SETTINGS', 'event-sync');
    }
  });
}

const syncNotificationsToggle = document.getElementById('syncNotificationsToggle');
if (syncNotificationsToggle) {
  syncNotificationsToggle.addEventListener('change', async () => {
    if (window.squirrel.saveAppSettings) {
      await window.squirrel.saveAppSettings({ syncNotifications: syncNotificationsToggle.checked });
      addSystemInfoLog(`Sync notifications ${syncNotificationsToggle.checked ? 'enabled' : 'disabled'}.`, 'SETTINGS', 'event-sync');
    }
  });
}

const closeToTrayToggle = document.getElementById('closeToTrayToggle');
if (closeToTrayToggle) {
  closeToTrayToggle.addEventListener('change', async () => {
    if (window.squirrel.saveAppSettings) {
      await window.squirrel.saveAppSettings({ closeToTray: closeToTrayToggle.checked });
      addSystemInfoLog(`Minimize to tray ${closeToTrayToggle.checked ? 'enabled' : 'disabled'}.`, 'SETTINGS', 'event-sync');
    }
  });
}

const launchOnStartupToggle = document.getElementById('launchOnStartupToggle');
if (launchOnStartupToggle) {
  launchOnStartupToggle.addEventListener('change', async () => {
    if (window.squirrel.setStartupLaunch) {
      await window.squirrel.setStartupLaunch(launchOnStartupToggle.checked);
      addSystemInfoLog(`Launch on system startup ${launchOnStartupToggle.checked ? 'enabled' : 'disabled'}.`, 'SETTINGS', 'event-sync');
    }
  });
}

const btnOpenConfigDir = document.getElementById('btnOpenConfigDir');
if (btnOpenConfigDir) {
  btnOpenConfigDir.addEventListener('click', async () => {
    if (window.squirrel.openConfigFolder) {
      await window.squirrel.openConfigFolder();
    }
  });
}

const btnOpenGitHub = document.getElementById('btnOpenGitHub');
if (btnOpenGitHub) {
  btnOpenGitHub.addEventListener('click', async () => {
    if (window.squirrel.openExternalUrl) {
      await window.squirrel.openExternalUrl('https://github.com/ArdaGl1/Squirrel');
    }
  });
}

// ========================================================
// 13. AUTO-UPDATER & SIDEBAR UPDATE NOTIFICATION
// ========================================================
const sidebarUpdateCard = document.getElementById('sidebarUpdateCard');
const sidebarUpdateTag = document.getElementById('sidebarUpdateTag');
const sidebarUpdateDesc = document.getElementById('sidebarUpdateDesc');
const btnSidebarUpdateNow = document.getElementById('btnSidebarUpdateNow');
const btnSidebarUpdateText = document.getElementById('btnSidebarUpdateText');
const settingsUpdateStatusText = document.getElementById('settingsUpdateStatusText');
const btnCheckUpdatesManual = document.getElementById('btnCheckUpdatesManual');

let activeUpdateInfo = null;

function renderUpdateAvailable(info) {
  if (!info || !info.updateAvailable) return;
  activeUpdateInfo = info;

  if (sidebarUpdateCard) {
    if (sidebarUpdateTag) sidebarUpdateTag.textContent = info.newVersion || 'New Version';
    if (sidebarUpdateDesc) {
      sidebarUpdateDesc.textContent = info.releaseName
        ? `${info.releaseName} is ready to install.`
        : `A new version of Squirrel (${info.newVersion}) is available.`;
    }
    sidebarUpdateCard.style.display = 'block';
  }

  if (settingsUpdateStatusText) {
    settingsUpdateStatusText.textContent = `Update available: ${info.newVersion || 'New version'}`;
    settingsUpdateStatusText.style.color = '#60a5fa';
  }
}

if (window.squirrel.onUpdateAvailable) {
  window.squirrel.onUpdateAvailable((info) => {
    renderUpdateAvailable(info);
  });
}

if (window.squirrel.onUpdateDownloadProgress) {
  window.squirrel.onUpdateDownloadProgress((progress) => {
    if (btnSidebarUpdateText) {
      btnSidebarUpdateText.textContent = `Downloading (${progress.percent}%)...`;
    }
    if (settingsUpdateStatusText) {
      settingsUpdateStatusText.textContent = `Downloading update: ${progress.percent}%...`;
    }
  });
}

if (btnSidebarUpdateNow) {
  btnSidebarUpdateNow.addEventListener('click', async () => {
    try {
      if (btnSidebarUpdateText) btnSidebarUpdateText.textContent = 'Preparing update...';
      btnSidebarUpdateNow.disabled = true;

      const res = await window.squirrel.installUpdate();
      if (res && res.openedBrowser) {
        if (btnSidebarUpdateText) btnSidebarUpdateText.textContent = 'Opened in Browser';
        setTimeout(() => {
          btnSidebarUpdateNow.disabled = false;
          if (btnSidebarUpdateText) btnSidebarUpdateText.textContent = 'Install Update';
        }, 4000);
      }
    } catch (err) {
      console.error('Update install error:', err);
      if (btnSidebarUpdateText) btnSidebarUpdateText.textContent = 'Update Failed';
      setTimeout(() => {
        btnSidebarUpdateNow.disabled = false;
        if (btnSidebarUpdateText) btnSidebarUpdateText.textContent = 'Retry Update';
      }, 3000);
    }
  });
}

if (btnCheckUpdatesManual) {
  btnCheckUpdatesManual.addEventListener('click', async () => {
    try {
      btnCheckUpdatesManual.disabled = true;
      const originalText = btnCheckUpdatesManual.innerHTML;
      btnCheckUpdatesManual.textContent = 'Checking...';
      if (settingsUpdateStatusText) settingsUpdateStatusText.textContent = 'Checking GitHub Releases...';

      const res = await window.squirrel.checkForUpdates();

      if (res && res.updateAvailable) {
        renderUpdateAvailable(res);
      } else {
        if (settingsUpdateStatusText) {
          settingsUpdateStatusText.textContent = `Up to date • v2.1.0 Beta`;
          settingsUpdateStatusText.style.color = 'var(--text-muted)';
        }
        addSystemInfoLog('Squirrel is already up to date.', 'UPDATER', 'event-sync');
      }

      setTimeout(() => {
        btnCheckUpdatesManual.disabled = false;
        btnCheckUpdatesManual.innerHTML = originalText;
      }, 2000);
    } catch (e) {
      console.error('Manual update check error:', e);
      btnCheckUpdatesManual.disabled = false;
    }
  });
}

// ========================================================
// 14. SQUIRREL VAULT (AES-256 CLIENT-SIDE ENCRYPTION)
// ========================================================
const vaultModal = document.getElementById('vaultModal');
const closeVaultModalBtn = document.getElementById('closeVaultModalBtn');
const cancelVaultModalBtn = document.getElementById('cancelVaultModalBtn');
const saveVaultSettingsBtn = document.getElementById('saveVaultSettingsBtn');
const vaultEnableToggle = document.getElementById('vaultEnableToggle');
const vaultPasswordContainer = document.getElementById('vaultPasswordContainer');
const vaultPasswordInput = document.getElementById('vaultPasswordInput');
const vaultConfirmPasswordInput = document.getElementById('vaultConfirmPasswordInput');
const vaultModalFolderName = document.getElementById('vaultModalFolderName');
const vaultStatusMessage = document.getElementById('vaultStatusMessage');
const btnExportDecryptor = document.getElementById('btnExportDecryptor');

const vaultToggleRow = document.getElementById('vaultToggleRow');

let activeVaultSlot = null;
let activeVaultDetails = null;

async function openVaultModal(slot) {
  if (!slot || !slot.path) return;
  activeVaultSlot = slot;

  if (vaultModalFolderName) {
    vaultModalFolderName.textContent = `Folder: ${slot.name || slot.path}`;
  }

  // Fetch current vault status
  activeVaultDetails = await window.squirrel.getFolderVault(slot.path);
  const isEnabled = !!(activeVaultDetails && activeVaultDetails.enabled);

  if (vaultEnableToggle) vaultEnableToggle.checked = isEnabled;
  if (vaultPasswordContainer) vaultPasswordContainer.style.display = isEnabled ? 'flex' : 'none';
  if (vaultPasswordInput) {
    vaultPasswordInput.value = '';
    vaultPasswordInput.placeholder = isEnabled ? '(Unchanged) Enter new password to update' : 'Enter a secure password for this folder';
  }
  if (vaultConfirmPasswordInput) {
    vaultConfirmPasswordInput.value = '';
    vaultConfirmPasswordInput.placeholder = isEnabled ? '(Unchanged) Repeat new password' : 'Repeat your password';
  }

  if (vaultStatusMessage) {
    if (isEnabled) {
      showVaultMessage('🔒 Vault is currently active. Enter a new password to change it, or toggle off to disable.', false);
    } else {
      vaultStatusMessage.style.display = 'none';
    }
  }

  if (vaultModal) vaultModal.style.display = 'flex';
}

function closeVaultModal() {
  if (vaultModal) vaultModal.style.display = 'none';
  activeVaultSlot = null;
  activeVaultDetails = null;
}

if (closeVaultModalBtn) closeVaultModalBtn.addEventListener('click', closeVaultModal);
if (cancelVaultModalBtn) cancelVaultModalBtn.addEventListener('click', closeVaultModal);

if (vaultToggleRow) {
  vaultToggleRow.addEventListener('click', (e) => {
    if (e.target.closest('.macos-switch')) return;
    if (vaultEnableToggle) {
      vaultEnableToggle.checked = !vaultEnableToggle.checked;
      vaultEnableToggle.dispatchEvent(new Event('change'));
    }
  });
}

if (vaultEnableToggle) {
  vaultEnableToggle.addEventListener('change', () => {
    if (vaultPasswordContainer) {
      vaultPasswordContainer.style.display = vaultEnableToggle.checked ? 'flex' : 'none';
      if (vaultEnableToggle.checked && vaultPasswordInput) {
        vaultPasswordInput.focus();
      }
    }
  });
}

function showVaultMessage(msg, isError = false) {
  if (!vaultStatusMessage) return;
  vaultStatusMessage.textContent = msg;
  vaultStatusMessage.style.display = 'block';
  vaultStatusMessage.style.color = isError ? '#ef4444' : '#34d399';
  vaultStatusMessage.style.background = isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(52, 211, 153, 0.1)';
  vaultStatusMessage.style.border = `1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(52, 211, 153, 0.3)'}`;
}

if (saveVaultSettingsBtn) {
  saveVaultSettingsBtn.addEventListener('click', async () => {
    if (!activeVaultSlot || !activeVaultSlot.path) return;

    const enabled = vaultEnableToggle ? vaultEnableToggle.checked : false;
    const pwd = vaultPasswordInput ? vaultPasswordInput.value.trim() : '';
    const confirmPwd = vaultConfirmPasswordInput ? vaultConfirmPasswordInput.value.trim() : '';

    if (enabled) {
      const alreadyHasPwd = !!(activeVaultDetails && activeVaultDetails.hasPassword);
      if (!pwd && !alreadyHasPwd) {
        showVaultMessage('Please enter a Master Password for this vault.', true);
        return;
      }
      if (pwd) {
        if (pwd.length < 4) {
          showVaultMessage('Password must be at least 4 characters.', true);
          return;
        }
        if (pwd !== confirmPwd) {
          showVaultMessage('Passwords do not match. Please verify.', true);
          return;
        }
      }
    }

    saveVaultSettingsBtn.disabled = true;
    saveVaultSettingsBtn.textContent = 'Saving...';

    try {
      const folderToSync = activeVaultSlot.path;
      const res = await window.squirrel.setFolderVault(activeVaultSlot.path, enabled, pwd);
      if (res && res.success) {
        activeVaultSlot.vault = enabled;
        renderWatchersList();
        addSystemInfoLog(
          enabled
            ? `🔒 Vault Encryption (AES-256) enabled for "${activeVaultSlot.name}". Files will sync encrypted.`
            : `🔓 Vault Encryption disabled for "${activeVaultSlot.name}".`,
          'VAULT',
          'event-sync'
        );
        closeVaultModal();

        // Immediately start sync to reconcile folder on Google Drive
        // (if enabled: uploads encrypted archive; if disabled: restores unencrypted folder!)
        if (folderToSync) {
          window.squirrel.syncFolder(folderToSync).catch((err) => {
            console.error('[Vault] Auto-sync failed:', err);
          });
        }
      } else {
        showVaultMessage('Could not save vault settings: ' + (res?.error || 'Unknown error'), true);
      }
    } catch (e) {
      showVaultMessage('Error saving vault: ' + e.message, true);
    } finally {
      saveVaultSettingsBtn.disabled = false;
      saveVaultSettingsBtn.textContent = 'Save Vault';
    }
  });
}

if (btnExportDecryptor) {
  btnExportDecryptor.addEventListener('click', async () => {
    try {
      const res = await window.squirrel.exportDecryptorTool();
      if (res && res.success) {
        showVaultMessage('✓ Offline Decryptor HTML tool exported successfully!');
      }
    } catch (e) {
      showVaultMessage('Could not export decryptor: ' + e.message, true);
    }
  });
}

// ========================================================
// 14. SILINME KORUMASI & KARANTINA (QUARANTINE)
// ========================================================
const quarantineNavBadge = document.getElementById('quarantineNavBadge');
const quarantineStatusCount = document.getElementById('quarantineStatusCount');
const quarantineListContainer = document.getElementById('quarantineListContainer');
const quarantineAlertToast = document.getElementById('quarantineAlertToast');
const quarantineAlertDesc = document.getElementById('quarantineAlertDesc');
const btnGoToQuarantine = document.getElementById('btnGoToQuarantine');
const btnDismissQuarantineAlert = document.getElementById('btnDismissQuarantineAlert');

async function loadQuarantineList() {
  if (!window.squirrel || !window.squirrel.getQuarantinedFolders) return;
  try {
    const res = await window.squirrel.getQuarantinedFolders();
    const items = (res && res.items) || [];

    // Badge güncelleme
    if (quarantineNavBadge) {
      if (items.length > 0) {
        quarantineNavBadge.style.display = 'inline-block';
        quarantineNavBadge.textContent = items.length;
      } else {
        quarantineNavBadge.style.display = 'none';
      }
    }

    if (quarantineStatusCount) {
      quarantineStatusCount.textContent = `${items.length} Quarantined`;
    }

    if (!quarantineListContainer) return;

    if (items.length === 0) {
      quarantineListContainer.innerHTML = `
        <div class="quarantine-empty">
          <div class="quarantine-empty-icon">🛡️</div>
          <div class="quarantine-empty-title">Quarantine is Clean</div>
          <div class="quarantine-empty-desc">No deleted or missing folders. All monitored folders are active and synced on your local disk.</div>
        </div>
      `;
      return;
    }

    quarantineListContainer.innerHTML = '';
    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'quarantine-card';

      const dateStr = item.quarantinedAt ? new Date(item.quarantinedAt).toLocaleString() : 'Recently';

      card.innerHTML = `
        <div class="quarantine-card-left">
          <div class="quarantine-folder-icon">
            ${item.isVault ? '🔒' : '📁'}
          </div>
          <div>
            <div class="quarantine-folder-name">
              <span>${item.folderName}</span>
              ${item.isVault ? '<span class="status-pill status-active" style="font-size: 10px; background: rgba(168, 85, 247, 0.15); color: #c084fc;">Vault Encrypted</span>' : ''}
              <span class="status-pill" style="font-size: 10px; background: rgba(244, 63, 94, 0.15); color: #fb7185;">Protected in Cloud</span>
            </div>
            <div class="quarantine-folder-path">${item.folderPath}</div>
            <div class="quarantine-folder-meta">🕒 Quarantined: ${dateStr}</div>
          </div>
        </div>
        <div class="quarantine-card-actions">
          <button class="btn-quarantine-restore" data-path="${item.folderPath}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"></polyline>
              <polyline points="23 20 23 14 17 14"></polyline>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
            </svg>
            <span>Restore to PC</span>
          </button>
          <button class="btn-quarantine-delete" data-path="${item.folderPath}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Permanently Delete</span>
          </button>
        </div>
      `;

      // Restore butonu
      const btnRestore = card.querySelector('.btn-quarantine-restore');
      btnRestore.addEventListener('click', async () => {
        btnRestore.disabled = true;
        btnRestore.textContent = 'Restoring...';
        try {
          const res = await window.squirrel.restoreQuarantinedFolder(item.folderPath);
          if (res && res.success) {
            alert(`✓ "${item.folderName}" was successfully restored to your PC and monitoring resumed.`);
            await loadQuarantineList();
            if (typeof loadSavedFolders === 'function') await loadSavedFolders();
          } else {
            alert('Restore failed: ' + (res?.error || 'Unknown error'));
            btnRestore.disabled = false;
            btnRestore.textContent = 'Restore to PC';
          }
        } catch (e) {
          alert('Error: ' + e.message);
          btnRestore.disabled = false;
          btnRestore.textContent = 'Restore to PC';
        }
      });

      // Delete butonu
      const btnDelete = card.querySelector('.btn-quarantine-delete');
      btnDelete.addEventListener('click', async () => {
        const confirmDelete = confirm(`"${item.folderName}" will be permanently deleted from Google Drive Quarantine as well.\n\nThis action cannot be undone. Are you sure?`);
        if (!confirmDelete) return;

        btnDelete.disabled = true;
        btnDelete.textContent = 'Deleting...';
        try {
          const res = await window.squirrel.deletePermanentlyQuarantinedFolder(item.folderPath);
          if (res && res.success) {
            await loadQuarantineList();
          } else {
            alert('Delete failed: ' + (res?.error || 'Unknown error'));
            btnDelete.disabled = false;
            btnDelete.textContent = 'Permanently Delete';
          }
        } catch (e) {
          alert('Error: ' + e.message);
          btnDelete.disabled = false;
          btnDelete.textContent = 'Permanently Delete';
        }
      });

      quarantineListContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load quarantine list:', err);
  }
}

// Canlı Karantina Uyarısı Dinleyicisi
if (window.squirrel && window.squirrel.onQuarantineAlert) {
  window.squirrel.onQuarantineAlert((data) => {
    if (quarantineAlertToast && quarantineAlertDesc) {
      quarantineAlertDesc.textContent = `"${data.folderName}" was deleted from local disk. Backups were safely moved to Drive Quarantine.`;
      quarantineAlertToast.style.display = 'flex';
      setTimeout(() => {
        quarantineAlertToast.style.display = 'none';
      }, 12000);
    }
    loadQuarantineList();
  });
}

if (btnGoToQuarantine) {
  btnGoToQuarantine.addEventListener('click', () => {
    if (quarantineAlertToast) quarantineAlertToast.style.display = 'none';
    switchTab('quarantine');
  });
}

if (btnDismissQuarantineAlert) {
  btnDismissQuarantineAlert.addEventListener('click', () => {
    if (quarantineAlertToast) quarantineAlertToast.style.display = 'none';
  });
}

// ========================================================
// 15. DOSYA VERSIYONLAMA (TIME MACHINE / REVISIONS)
// ========================================================
const manageVersionHistory = document.getElementById('manageVersionHistory');
const versionHistoryModal = document.getElementById('versionHistoryModal');
const versionModalFolderLabel = document.getElementById('versionModalFolderLabel');
const versionFileSelect = document.getElementById('versionFileSelect');
const versionTimelineContainer = document.getElementById('versionTimelineContainer');
const btnCloseVersionModal = document.getElementById('btnCloseVersionModal');
const btnCloseVersionModalFooter = document.getElementById('btnCloseVersionModalFooter');

let currentVersionFolderPath = null;

if (manageVersionHistory) {
  manageVersionHistory.addEventListener('click', async () => {
    const slot = currentManageSlot;
    closeManageDropdown();
    if (!slot || !slot.path) {
      console.warn('[Version History] No slot selected or slot has no path:', slot);
      return;
    }

    currentVersionFolderPath = slot.path;
    const folderDisplayName = slot.name || slot.path.split(/[\\/]/).pop() || slot.path;
    if (versionModalFolderLabel) {
      versionModalFolderLabel.textContent = `Folder: ${folderDisplayName} (${slot.path})`;
    }

    if (versionHistoryModal) {
      versionHistoryModal.style.display = 'flex';
    }

    if (versionFileSelect) {
      versionFileSelect.innerHTML = '<option value="">Scanning files in folder...</option>';
    }
    if (versionTimelineContainer) {
      versionTimelineContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: #94a3b8;">Please select a file from the dropdown above to inspect saved versions.</div>';
    }

    try {
      const res = await window.squirrel.getFolderFilesForVersioning(slot.path);
      if (res && res.success && res.files && res.files.length > 0) {
        versionFileSelect.innerHTML = '<option value="">Select a file to inspect version history...</option>';
        res.files.forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f.relativePath;
          const kb = (f.size / 1024).toFixed(1);
          opt.textContent = `${f.relativePath} (${kb} KB)`;
          versionFileSelect.appendChild(opt);
        });
      } else {
        versionFileSelect.innerHTML = '<option value="">No files found in folder.</option>';
      }
    } catch (e) {
      versionFileSelect.innerHTML = '<option value="">Could not list files: ' + e.message + '</option>';
    }
  });
}

if (versionFileSelect) {
  versionFileSelect.addEventListener('change', async () => {
    const relPath = versionFileSelect.value;
    if (!relPath || !currentVersionFolderPath) {
      versionTimelineContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: #94a3b8;">Please select a file above.</div>';
      return;
    }

    versionTimelineContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: #38bdf8;">Scanning Google Drive version history...</div>';

    try {
      const res = await window.squirrel.getFileRevisions(currentVersionFolderPath, relPath);
      if (res && res.success && res.revisions && res.revisions.length > 0) {
        versionTimelineContainer.innerHTML = '';
        res.revisions.forEach((rev) => {
          const card = document.createElement('div');
          card.className = 'version-item-card';

          const dateStr = rev.modifiedTime ? new Date(rev.modifiedTime).toLocaleString() : 'Unknown';
          const sizeStr = (rev.size / 1024).toFixed(1) + ' KB';

          card.innerHTML = `
            <div class="version-meta-left">
              <div class="version-number-row">
                <span>Version #${rev.versionNumber}</span>
                ${rev.isLatest ? '<span class="version-latest-pill">Current Version</span>' : ''}
              </div>
              <div class="version-date-size">🕒 Saved: ${dateStr} • Size: ${sizeStr}</div>
            </div>
            <button class="btn-restore-version" data-revid="${rev.id}">
              ↩️ Restore This Version
            </button>
          `;

          const btnRestoreRev = card.querySelector('.btn-restore-version');
          btnRestoreRev.addEventListener('click', async () => {
            const confirmed = confirm(`Are you sure you want to restore "${relPath}" to the version from ${dateStr}?\n\nYour local file will be overwritten with this version.`);
            if (!confirmed) return;

            btnRestoreRev.disabled = true;
            btnRestoreRev.textContent = 'Restoring...';

            try {
              const restRes = await window.squirrel.restoreFileRevision(currentVersionFolderPath, relPath, rev.id);
              if (restRes && restRes.success) {
                alert(`✓ "${relPath}" was successfully restored to the version from ${dateStr}!`);
                btnRestoreRev.textContent = '✓ Restored';
              } else {
                alert('Version restore failed: ' + (restRes?.error || 'Unknown error'));
                btnRestoreRev.disabled = false;
                btnRestoreRev.textContent = '↩️ Restore This Version';
              }
            } catch (err) {
              alert('Error: ' + err.message);
              btnRestoreRev.disabled = false;
              btnRestoreRev.textContent = '↩️ Restore This Version';
            }
          });

          versionTimelineContainer.appendChild(card);
        });
      } else {
        versionTimelineContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: #94a3b8;">This file does not have any prior versions on Drive yet. As you edit and save the file, past versions will appear here.</div>';
      }
    } catch (e) {
      versionTimelineContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: #f87171;">Could not retrieve versions: ' + e.message + '</div>';
    }
  });
}

function closeVersionModal() {
  if (versionHistoryModal) {
    versionHistoryModal.style.display = 'none';
  }
}

if (btnCloseVersionModal) btnCloseVersionModal.addEventListener('click', closeVersionModal);
if (btnCloseVersionModalFooter) btnCloseVersionModalFooter.addEventListener('click', closeVersionModal);

// Close version modal when clicking outside (backdrop) or pressing Escape
if (versionHistoryModal) {
  versionHistoryModal.addEventListener('click', (e) => {
    if (e.target === versionHistoryModal) closeVersionModal();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && versionHistoryModal && versionHistoryModal.style.display === 'flex') {
    closeVersionModal();
  }
});

// ========================================================
// 16. EXCLUSIONS & FILE FILTERS UI
// ========================================================
const presetFiltersContainer = document.getElementById('presetFiltersContainer');
const addCustomFilterForm = document.getElementById('addCustomFilterForm');
const customFilterInput = document.getElementById('customFilterInput');
const customRulesList = document.getElementById('customRulesList');
const customRuleCountLabel = document.getElementById('customRuleCountLabel');
const activeFilterCountText = document.getElementById('activeFilterCountText');
const maxFileSizeSelect = document.getElementById('maxFileSizeSelect');
const testFilterInput = document.getElementById('testFilterInput');
const testFilterResult = document.getElementById('testFilterResult');

let currentFilterState = null;

async function loadExclusionsUI() {
  if (!window.squirrel || !window.squirrel.getFilters) return;
  try {
    currentFilterState = await window.squirrel.getFilters();
    if (!currentFilterState) return;

    renderPresetFilters(currentFilterState);
    renderCustomRules(currentFilterState);
    updateFilterBadge(currentFilterState);

    if (maxFileSizeSelect) {
      maxFileSizeSelect.value = String(currentFilterState.maxFileSizeMB || 0);
    }
  } catch (err) {
    console.error('[Exclusions] Failed to load filters:', err);
  }
}

function updateFilterBadge(state) {
  if (!activeFilterCountText) return;
  const count = state && state.effectivePatterns ? state.effectivePatterns.length : 0;
  activeFilterCountText.textContent = `${count} Active Rule${count !== 1 ? 's' : ''}`;
}

function renderPresetFilters(state) {
  if (!presetFiltersContainer || !state || !state.presetDefinitions) return;
  presetFiltersContainer.innerHTML = '';

  const defs = state.presetDefinitions;
  for (const [key, def] of Object.entries(defs)) {
    const isChecked = !!state.presets[key];

    const row = document.createElement('div');
    row.className = 'preset-filter-row';

    const tagsHtml = (def.tags || def.patterns.slice(0, 6))
      .map((t) => `<span class="preset-tag-pill">${t}</span>`)
      .join('');

    row.innerHTML = `
      <div class="preset-filter-info">
        <div class="preset-filter-title">
          <span>${def.title}</span>
        </div>
        <div class="preset-filter-desc">${def.description}</div>
        <div class="preset-filter-tags">${tagsHtml}</div>
      </div>
      <label class="macos-switch">
        <input type="checkbox" data-preset="${key}" ${isChecked ? 'checked' : ''} />
        <span class="macos-switch-slider"></span>
      </label>
    `;

    const toggle = row.querySelector('input[type="checkbox"]');
    toggle.addEventListener('change', async () => {
      const updatedPresets = { ...currentFilterState.presets, [key]: toggle.checked };
      try {
        currentFilterState = await window.squirrel.updateFilters({ presets: updatedPresets });
        updateFilterBadge(currentFilterState);
        addSystemInfoLog(`Exclusion filter "${def.title}" was ${toggle.checked ? 'enabled' : 'disabled'}.`, 'FILTER', 'event-info');
      } catch (e) {
        console.error('Failed to update preset:', e);
      }
    });

    presetFiltersContainer.appendChild(row);
  }
}

function renderCustomRules(state) {
  if (!customRulesList || !state) return;
  customRulesList.innerHTML = '';

  const rules = state.customRules || [];
  if (customRuleCountLabel) {
    customRuleCountLabel.textContent = `${rules.length} rule${rules.length !== 1 ? 's' : ''}`;
  }

  if (rules.length === 0) {
    customRulesList.innerHTML = `
      <div style="font-size: 12.5px; color: #64748b; font-style: italic; padding: 6px 0;">
        No custom rules yet. Add patterns like <code>*.log</code> or <code>cache/</code> above.
      </div>
    `;
    return;
  }

  rules.forEach((rule) => {
    const tag = document.createElement('div');
    tag.className = 'custom-filter-tag';
    tag.innerHTML = `
      <span>${rule}</span>
      <button type="button" class="tag-remove-btn" title="Remove rule">&times;</button>
    `;

    const removeBtn = tag.querySelector('.tag-remove-btn');
    removeBtn.addEventListener('click', async () => {
      try {
        currentFilterState = await window.squirrel.removeCustomFilterRule(rule);
        renderCustomRules(currentFilterState);
        updateFilterBadge(currentFilterState);
        addSystemInfoLog(`Custom rule "${rule}" removed.`, 'FILTER', 'event-unlink');
      } catch (e) {
        console.error('Failed to remove custom rule:', e);
      }
    });

    customRulesList.appendChild(tag);
  });
}

// Custom rule form submission
if (addCustomFilterForm && customFilterInput) {
  addCustomFilterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = customFilterInput.value.trim();
    if (!val) return;

    try {
      currentFilterState = await window.squirrel.addCustomFilterRule(val);
      customFilterInput.value = '';
      renderCustomRules(currentFilterState);
      updateFilterBadge(currentFilterState);
      addSystemInfoLog(`Custom rule "${val}" added to active filters.`, 'FILTER', 'event-add');
    } catch (err) {
      alert('Could not add rule: ' + err.message);
    }
  });
}

// Quick Add Chip buttons
document.querySelectorAll('.quick-chip').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const rule = btn.dataset.rule;
    if (!rule) return;
    try {
      currentFilterState = await window.squirrel.addCustomFilterRule(rule);
      renderCustomRules(currentFilterState);
      updateFilterBadge(currentFilterState);
      addSystemInfoLog(`Quick filter "${rule}" added.`, 'FILTER', 'event-add');
    } catch (err) {
      console.error('Failed to add quick rule:', err);
    }
  });
});

// Max File Size dropdown
if (maxFileSizeSelect) {
  maxFileSizeSelect.addEventListener('change', async () => {
    const mb = parseInt(maxFileSizeSelect.value, 10) || 0;
    try {
      currentFilterState = await window.squirrel.updateFilters({ maxFileSizeMB: mb });
      addSystemInfoLog(
        mb > 0
          ? `File size filter set: Files larger than ${mb} MB will be skipped.`
          : 'File size filter disabled: All file sizes allowed.',
        'FILTER',
        'event-info'
      );
    } catch (err) {
      console.error('Failed to update max file size:', err);
    }
  });
}

// Live Filter Tester
let testDebounceTimer = null;
if (testFilterInput && testFilterResult) {
  testFilterInput.addEventListener('input', () => {
    clearTimeout(testDebounceTimer);
    const sample = testFilterInput.value.trim();
    if (!sample) {
      testFilterResult.style.display = 'none';
      return;
    }

    testDebounceTimer = setTimeout(async () => {
      try {
        const res = await window.squirrel.testFilterPath(sample);
        testFilterResult.style.display = 'inline-block';
        if (res.ignored) {
          testFilterResult.className = 'filter-result-excluded';
          testFilterResult.textContent = `🚫 Excluded (${res.matchedRule || 'Ignored'})`;
        } else {
          testFilterResult.className = 'filter-result-allowed';
          testFilterResult.textContent = '✅ Allowed (Will Sync)';
        }
      } catch (e) {
        testFilterResult.style.display = 'none';
      }
    }, 150);
  });
}

// ========================================================
// 17. SYNC DIAGNOSTICS & ISSUES INSPECTOR ("Why didn't it sync?")
// ========================================================
let cachedDiagnostics = {
  issues: [],
  activeOperations: {},
  queuedTasks: [],
  recentSynced: [],
  stats: { totalIssues: 0, lockedCount: 0, queuedCount: 0, activeOperationsCount: 0 },
};

function countIssuesForFolder(folderName) {
  if (!cachedDiagnostics || !cachedDiagnostics.issues || !folderName) return 0;
  return cachedDiagnostics.issues.filter((i) => i.folderName === folderName && i.status === 'active').length;
}

function getFolderIssueBadge(folderName) {
  if (!cachedDiagnostics || !cachedDiagnostics.issues || !folderName) return null;
  const issues = cachedDiagnostics.issues.filter((i) => i.folderName === folderName && i.status === 'active');
  if (issues.length === 0) return null;
  const offlineIssue = issues.find((i) => i.category === 'offline');
  if (offlineIssue) {
    const countStr = offlineIssue.pendingFilesCount && offlineIssue.pendingFilesCount > 1 ? ` (${offlineIssue.pendingFilesCount} files)` : '';
    return `<span class="badge-folder-issue badge-folder-offline" data-folder="${escapeHtml(folderName)}" title="Computer is offline. Cloud sync will automatically resume when internet is back.">🌐 Offline${countStr}</span>`;
  }
  return `<span class="badge-folder-issue" data-folder="${escapeHtml(folderName)}" title="Click to view why files didn't sync">⚠️ ${issues.length} Issue${issues.length > 1 ? 's' : ''}</span>`;
}

const btnTopDiagnostics = document.getElementById('btnTopDiagnostics');
const topDiagnosticsBadge = document.getElementById('topDiagnosticsBadge');
const syncIssuesAlertBanner = document.getElementById('syncIssuesAlertBanner');
const alertBannerIssueCount = document.getElementById('alertBannerIssueCount');
const btnOpenIssuesFromBanner = document.getElementById('btnOpenIssuesFromBanner');

const syncDiagnosticsModal = document.getElementById('syncDiagnosticsModal');
const btnCloseDiagnosticsModal = document.getElementById('btnCloseDiagnosticsModal');
const btnCloseDiagnosticsModalFooter = document.getElementById('btnCloseDiagnosticsModalFooter');
const manageDiagnostics = document.getElementById('manageDiagnostics');

const tabBtnDiagIssues = document.getElementById('tabBtnDiagIssues');
const tabBtnDiagQueue = document.getElementById('tabBtnDiagQueue');
const tabBtnDiagHistory = document.getElementById('tabBtnDiagHistory');

const paneDiagIssues = document.getElementById('paneDiagIssues');
const paneDiagQueue = document.getElementById('paneDiagQueue');
const paneDiagHistory = document.getElementById('paneDiagHistory');

const diagCountIssues = document.getElementById('diagCountIssues');
const diagCountQueue = document.getElementById('diagCountQueue');
const diagCountActive = document.getElementById('diagCountActive');
const diagTabBadgeIssues = document.getElementById('diagTabBadgeIssues');
const diagTabBadgeQueue = document.getElementById('diagTabBadgeQueue');

const diagIssuesList = document.getElementById('diagIssuesList');
const diagActiveOpsList = document.getElementById('diagActiveOpsList');
const diagQueueList = document.getElementById('diagQueueList');
const diagHistoryList = document.getElementById('diagHistoryList');

const btnDiagRetryAll = document.getElementById('btnDiagRetryAll');
const btnDiagClearResolved = document.getElementById('btnDiagClearResolved');

function switchDiagnosticsTab(tabName) {
  const tabs = [
    { btn: tabBtnDiagIssues, pane: paneDiagIssues, name: 'issues' },
    { btn: tabBtnDiagQueue, pane: paneDiagQueue, name: 'queue' },
    { btn: tabBtnDiagHistory, pane: paneDiagHistory, name: 'history' },
  ];
  tabs.forEach((t) => {
    if (t.name === tabName) {
      if (t.btn) t.btn.classList.add('active');
      if (t.pane) t.pane.style.display = 'block';
    } else {
      if (t.btn) t.btn.classList.remove('active');
      if (t.pane) t.pane.style.display = 'none';
    }
  });
}

function openDiagnosticsModal(initialTab = 'issues') {
  if (!syncDiagnosticsModal) return;
  syncDiagnosticsModal.style.display = 'flex';
  switchDiagnosticsTab(initialTab);
  renderSyncDiagnostics(cachedDiagnostics);
}

function closeDiagnosticsModal() {
  if (syncDiagnosticsModal) syncDiagnosticsModal.style.display = 'none';
}

function renderSyncDiagnostics(data) {
  if (!data) return;
  cachedDiagnostics = data;
  const stats = data.stats || { totalIssues: 0, lockedCount: 0, queuedCount: 0, activeOperationsCount: 0 };
  const issues = data.issues || [];
  const queuedTasks = data.queuedTasks || [];
  const activeOps = data.activeOperations || {};
  const recentSynced = data.recentSynced || [];

  // 1. Top bar indicator badge
  if (topDiagnosticsBadge) {
    if (stats.totalIssues > 0) {
      topDiagnosticsBadge.style.display = 'inline-block';
      topDiagnosticsBadge.textContent = String(stats.totalIssues);
    } else {
      topDiagnosticsBadge.style.display = 'none';
    }
  }

  // 2. Monitored folders alert banner
  if (syncIssuesAlertBanner && alertBannerIssueCount) {
    if (stats.totalIssues > 0) {
      syncIssuesAlertBanner.style.display = 'flex';
      const offlineIssues = issues.filter((i) => i.category === 'offline' && i.status === 'active');
      if (offlineIssues.length > 0) {
        const totalPendingFiles = offlineIssues.reduce((sum, i) => sum + (i.pendingFilesCount || 1), 0);
        alertBannerIssueCount.textContent = String(totalPendingFiles || stats.totalIssues);
      } else {
        alertBannerIssueCount.textContent = String(stats.totalIssues);
      }
      const bannerSub = syncIssuesAlertBanner.querySelector('.alert-banner-sub');
      if (bannerSub) {
        const hasOffline = offlineIssues.length > 0;
        if (hasOffline) {
          bannerSub.textContent = 'Internet connection disconnected. Sync will automatically resume once you reconnect.';
        } else {
          bannerSub.textContent = 'Some files are locked by another app or encountered errors. Click to inspect why.';
        }
      }
    } else {
      syncIssuesAlertBanner.style.display = 'none';
    }
  }

  // 3. Modal metric counters
  if (diagCountIssues) diagCountIssues.textContent = String(stats.totalIssues);
  if (diagCountQueue) diagCountQueue.textContent = String(stats.queuedCount);
  if (diagCountActive) diagCountActive.textContent = String(Object.keys(activeOps).length);

  // Tab badges
  if (diagTabBadgeIssues) {
    if (stats.totalIssues > 0) {
      diagTabBadgeIssues.style.display = 'inline-block';
      diagTabBadgeIssues.textContent = String(stats.totalIssues);
    } else {
      diagTabBadgeIssues.style.display = 'none';
    }
  }
  if (diagTabBadgeQueue) {
    if (stats.queuedCount > 0) {
      diagTabBadgeQueue.style.display = 'inline-block';
      diagTabBadgeQueue.textContent = String(stats.queuedCount);
    } else {
      diagTabBadgeQueue.style.display = 'none';
    }
  }

  // Header buttons in Issues tab
  if (btnDiagRetryAll) {
    btnDiagRetryAll.style.display = stats.totalIssues > 0 ? 'inline-block' : 'none';
  }
  if (btnDiagClearResolved) {
    const hasFiltered = issues.some((i) => i.status === 'filtered');
    btnDiagClearResolved.style.display = hasFiltered ? 'inline-block' : 'none';
  }

  // 4. Render Issues List ("Why didn't it sync?")
  if (diagIssuesList) {
    if (issues.length === 0) {
      diagIssuesList.innerHTML = `
        <div class="diag-empty-state">
          <div class="diag-empty-icon">🎉</div>
          <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px;">All Files are Healthy & Synchronized</div>
          <div style="font-size: 12px; color: #94a3b8; max-width: 440px; margin: 0 auto;">
            Squirrel is actively watching your folders. No files are currently locked by another application, blocked, or failing to sync.
          </div>
        </div>
      `;
    } else {
      diagIssuesList.innerHTML = issues
        .map((issue) => {
          let catClass = 'cat-error';
          let catIcon = '❌';
          let catText = 'Sync Error';

          if (issue.category === 'offline') {
            catClass = 'cat-offline';
            catIcon = '🌐';
            catText = 'No Internet (Offline)';
          } else if (issue.category === 'locked') {
            catClass = 'cat-locked';
            catIcon = '🔒';
            catText = 'Locked by Another App';
          } else if (issue.category === 'network') {
            catClass = 'cat-network';
            catIcon = '📶';
            catText = 'Network Timeout';
          } else if (issue.category === 'quota') {
            catClass = 'cat-quota';
            catIcon = '⚠️';
            catText = 'Cloud Quota / Rate Limit';
          } else if (issue.category === 'oversized') {
            catClass = 'cat-oversized';
            catIcon = '📏';
            catText = 'Exceeds Size Limit';
          } else if (issue.category === 'excluded') {
            catClass = 'cat-excluded';
            catIcon = '🚫';
            catText = 'Filtered by Rule';
          } else if (issue.category === 'permission') {
            catClass = 'cat-error';
            catIcon = '⛔';
            catText = 'Permission Denied';
          }

          const retryBtnHtml = issue.isRetryable
            ? `<button class="btn-diag-action btn-diag-retry" data-action="retry" data-issue-id="${escapeHtml(issue.id)}">🔄 Retry Now</button>`
            : '';

          const isOffline = issue.category === 'offline';
          const headerLeftHtml = isOffline
            ? `
              <div class="diag-issue-filename">
                <span>📁 ${escapeHtml(issue.folderName)}</span>
                <span class="badge-vault" style="font-size: 10px; padding: 1px 6px;">Folder Sync Paused</span>
                <span style="font-size: 11px; color: #fbbf24;">${issue.pendingFilesCount ? `${issue.pendingFilesCount} files waiting` : 'Offline'}</span>
              </div>
              <div class="diag-issue-path">${escapeHtml(issue.folderPath || '')}</div>
            `
            : `
              <div class="diag-issue-filename">
                <span>${escapeHtml(issue.fileName)}</span>
                <span class="badge-vault" style="font-size: 10px; padding: 1px 6px;">${escapeHtml(issue.folderName)}</span>
                <span style="font-size: 11px; color: #64748b;">${escapeHtml(issue.fileSizeStr || '')}</span>
              </div>
              <div class="diag-issue-path">${escapeHtml(issue.relativePath || issue.fullPath)}</div>
            `;

          const actionsHtml = isOffline
            ? `
              ${retryBtnHtml}
              <button class="btn-diag-action btn-diag-outline" data-action="dismiss" data-issue-id="${escapeHtml(issue.id)}">✕ Dismiss</button>
            `
            : `
              ${retryBtnHtml}
              <button class="btn-diag-action btn-diag-outline" data-action="reveal" data-path="${escapeHtml(issue.fullPath)}">📁 Show in Explorer</button>
              <button class="btn-diag-action btn-diag-outline" data-action="ignore" data-issue-id="${escapeHtml(issue.id)}" title="Add file extension/pattern to Exclusions">🚫 Exclude File</button>
              <button class="btn-diag-action btn-diag-outline" data-action="dismiss" data-issue-id="${escapeHtml(issue.id)}">✕ Dismiss</button>
            `;

          return `
            <div class="diag-issue-card">
              <div class="diag-issue-header">
                <div class="diag-issue-left">
                  ${headerLeftHtml}
                </div>
                <div class="diag-issue-badges">
                  <span class="badge-issue-cat ${catClass}">${catIcon} ${catText}</span>
                </div>
              </div>

              <!-- Plain-English Explanation Box -->
              <div class="diag-issue-explanation-box">
                <strong style="color: #fff;">Why this didn't sync:</strong> ${escapeHtml(issue.explanation)}
              </div>

              <!-- Plain-English Solution / Action Box -->
              <div class="diag-issue-solution-box">
                <span>💡</span>
                <div>${escapeHtml(issue.solution)}</div>
              </div>

              <!-- Action Buttons -->
              <div class="diag-issue-actions">
                ${actionsHtml}
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  // 5. Render Active Operations
  if (diagActiveOpsList) {
    const activeKeys = Object.keys(activeOps);
    if (activeKeys.length === 0) {
      diagActiveOpsList.innerHTML = `
        <div style="font-size: 12px; color: #64748b; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px;">
          No active folder operations running. All folders are idle.
        </div>
      `;
    } else {
      diagActiveOpsList.innerHTML = activeKeys
        .map((k) => {
          const op = activeOps[k];
          const pct = op.totalFiles > 0 ? Math.round((op.currentFiles / op.totalFiles) * 100) : 0;
          return `
            <div class="diag-active-op-card">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 600; color: #fff; font-size: 13px;">${escapeHtml(op.folderName)}</span>
                  <span class="badge-syncing" style="font-size: 10px; padding: 1px 6px;">
                    <span class="sync-dot-pulse"></span> ${escapeHtml(op.phaseText || op.phase)}
                  </span>
                </div>
                <span style="font-size: 12px; font-weight: 600; color: #60a5fa;">${pct}%</span>
              </div>
              <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 6px;">${escapeHtml(op.currentFile || 'Processing...')}</div>
              <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #06b6d4);"></div>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  // 6. Render Queue List
  if (diagQueueList) {
    if (queuedTasks.length === 0) {
      diagQueueList.innerHTML = `
        <div style="font-size: 12px; color: #64748b; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px;">
          Queue is empty. Real-time file listener is waiting for file changes.
        </div>
      `;
    } else {
      diagQueueList.innerHTML = queuedTasks
        .map((t) => {
          const isUp = t.status === 'uploading';
          return `
            <div class="diag-queue-item ${isUp ? 'uploading' : ''}">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 14px;">${isUp ? '⬆️' : '⏳'}</span>
                <div>
                  <div style="font-weight: 500; color: #fff;">${escapeHtml(t.fileName)}</div>
                  <div style="font-size: 11px; color: #64748b;">${escapeHtml(t.folderName)} • ${escapeHtml(t.sizeStr || '')}</div>
                </div>
              </div>
              <span style="font-size: 11px; color: ${isUp ? '#60a5fa' : '#94a3b8'}; font-weight: 500;">
                ${isUp ? 'Uploading now...' : 'Waiting in queue'}
              </span>
            </div>
          `;
        })
        .join('');
    }
  }

  // 7. Render Recent History
  if (diagHistoryList) {
    if (recentSynced.length === 0) {
      diagHistoryList.innerHTML = `
        <div style="font-size: 12px; color: #64748b; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px;">
          No recently synced files recorded in this session yet.
        </div>
      `;
    } else {
      diagHistoryList.innerHTML = recentSynced
        .map((h) => {
          const actLabel = h.action === 'created' ? 'Uploaded' : (h.action === 'updated' ? 'Updated' : 'Synced');
          return `
            <div class="diag-history-item">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 14px;">${h.isVault ? '🔒' : '☁️'}</span>
                <div>
                  <div style="font-weight: 500; color: #fff;">
                    ${escapeHtml(h.fileName)}
                    ${h.isVault ? '<span class="badge-vault" style="font-size: 9px; padding: 0 4px; margin-left: 4px;">Vault</span>' : ''}
                  </div>
                  <div style="font-size: 11px; color: #64748b;">${escapeHtml(h.folderName)} • ${escapeHtml(h.sizeStr || '')}</div>
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 11px; color: #10b981; font-weight: 500;">${actLabel}</div>
                <div style="font-size: 10px; color: #64748b;">${escapeHtml(h.timestamp)}</div>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  // Refresh badges on watcher cards if list is visible
  document.querySelectorAll('.watcher-card').forEach((card) => {
    const slotId = parseInt(card.dataset.slotId, 10);
    const slot = slots.find((s) => s.id === slotId);
    if (slot && slot.name) {
      const bContainer = card.querySelector(`#badge-${slot.id}`);
      if (bContainer) {
        const issueBadge = getFolderIssueBadge(slot.name);
        const vaultBadge = getVaultBadgeHtml(slot);
        if (slot.progress && !slot.progress.done) {
          if (slot.progress.isOfflinePaused) {
            bContainer.innerHTML = `<span class="badge-paused" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">🌐 Offline</span> ${vaultBadge}`;
          } else {
            const pct = slot.progress.percent || 0;
            bContainer.innerHTML = `<span class="badge-syncing"><span class="sync-dot-pulse"></span> Syncing (%${pct})</span> ${vaultBadge}`;
          }
        } else if (issueBadge) {
          bContainer.innerHTML = `${issueBadge} ${vaultBadge}`;
        } else if (slot.isPaused) {
          bContainer.innerHTML = `<span class="badge-paused">Paused</span> ${vaultBadge}`;
        } else {
          bContainer.innerHTML = `<span class="badge-realtime">Real-time</span> ${vaultBadge}`;
        }
      }
    }
  });
}

// Diagnostics Event Listeners
if (btnTopDiagnostics) {
  btnTopDiagnostics.addEventListener('click', () => {
    openDiagnosticsModal('issues');
  });
}

if (btnOpenIssuesFromBanner) {
  btnOpenIssuesFromBanner.addEventListener('click', () => {
    openDiagnosticsModal('issues');
  });
}

if (btnCloseDiagnosticsModal) {
  btnCloseDiagnosticsModal.addEventListener('click', () => {
    closeDiagnosticsModal();
  });
}

if (btnCloseDiagnosticsModalFooter) {
  btnCloseDiagnosticsModalFooter.addEventListener('click', () => {
    closeDiagnosticsModal();
  });
}

if (syncDiagnosticsModal) {
  syncDiagnosticsModal.addEventListener('click', (e) => {
    if (e.target === syncDiagnosticsModal) {
      closeDiagnosticsModal();
    }
  });
}

if (tabBtnDiagIssues) tabBtnDiagIssues.addEventListener('click', () => switchDiagnosticsTab('issues'));
if (tabBtnDiagQueue) tabBtnDiagQueue.addEventListener('click', () => switchDiagnosticsTab('queue'));
if (tabBtnDiagHistory) tabBtnDiagHistory.addEventListener('click', () => switchDiagnosticsTab('history'));

if (manageDiagnostics) {
  manageDiagnostics.addEventListener('click', () => {
    closeManageDropdown();
    openDiagnosticsModal('issues');
  });
}

if (btnDiagRetryAll) {
  btnDiagRetryAll.addEventListener('click', async () => {
    btnDiagRetryAll.disabled = true;
    btnDiagRetryAll.textContent = 'Retrying all...';
    try {
      await window.squirrel.retryAllSyncIssues();
      const res = await window.squirrel.getSyncDiagnostics();
      renderSyncDiagnostics(res);
    } catch (e) {
      console.error('Retry all error:', e);
    } finally {
      btnDiagRetryAll.disabled = false;
      btnDiagRetryAll.textContent = '🔄 Retry All Issues';
    }
  });
}

if (btnDiagClearResolved) {
  btnDiagClearResolved.addEventListener('click', async () => {
    await window.squirrel.clearResolvedSyncIssues();
    const res = await window.squirrel.getSyncDiagnostics();
    renderSyncDiagnostics(res);
  });
}

if (diagIssuesList) {
  diagIssuesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const issueId = btn.dataset.issueId;
    const filePath = btn.dataset.path;

    if (action === 'retry' && issueId) {
      btn.disabled = true;
      btn.textContent = 'Retrying...';
      try {
        await window.squirrel.retrySyncIssue(issueId);
      } catch (err) {}
      const res = await window.squirrel.getSyncDiagnostics();
      renderSyncDiagnostics(res);
    } else if (action === 'reveal' && filePath) {
      await window.squirrel.revealFileInExplorer(filePath);
    } else if (action === 'ignore' && issueId) {
      btn.disabled = true;
      btn.textContent = 'Excluding...';
      try {
        await window.squirrel.ignoreSyncIssue(issueId);
      } catch (err) {}
      const res = await window.squirrel.getSyncDiagnostics();
      renderSyncDiagnostics(res);
    } else if (action === 'dismiss' && issueId) {
      try {
        await window.squirrel.dismissSyncIssue(issueId);
      } catch (err) {}
      const res = await window.squirrel.getSyncDiagnostics();
      renderSyncDiagnostics(res);
    }
  });
}

// Folder card issue badge click delegation
if (watchersListContainer) {
  watchersListContainer.addEventListener('click', (e) => {
    const issueBadge = e.target.closest('.badge-folder-issue');
    if (issueBadge) {
      e.stopPropagation();
      openDiagnosticsModal('issues');
    }
  });
}

// Diagnostics IPC listener from main process
if (window.squirrel && window.squirrel.onDiagnosticsUpdate) {
  window.squirrel.onDiagnosticsUpdate((data) => {
    renderSyncDiagnostics(data);
  });
}

// ========================================================
// 18. APP INITIALIZATION
// ========================================================
initApp();

// Initial diagnostics load after DOM is ready
if (window.squirrel && window.squirrel.getSyncDiagnostics) {
  window.squirrel.getSyncDiagnostics().then((diag) => {
    renderSyncDiagnostics(diag);
  }).catch((e) => {
    console.error('Initial diagnostics load error:', e);
  });
}

// Global Online / Offline Event Listeners (Instant OS-level Detection & Auto-Resume)
window.addEventListener('online', async () => {
  addSystemInfoLog('Internet connection restored. Automatically resuming pending cloud sync...', 'NETWORK', 'event-info');
  if (sidebarStatusText) {
    sidebarStatusText.textContent = 'Status: Monitoring Active';
  }
  if (sidebarStatusDot) {
    sidebarStatusDot.style.background = '#10b981';
  }
  if (window.squirrel && window.squirrel.notifyNetworkStatus) {
    try {
      await window.squirrel.notifyNetworkStatus(true);
      const res = await window.squirrel.getSyncDiagnostics();
      renderSyncDiagnostics(res);
    } catch (e) {}
  }
});

window.addEventListener('offline', async () => {
  addSystemInfoLog('Internet connection lost. Cloud sync paused until connection returns.', 'NETWORK', 'event-warning');
  if (sidebarStatusText) {
    sidebarStatusText.textContent = 'Status: Offline (Waiting for Internet)';
  }
  if (sidebarStatusDot) {
    sidebarStatusDot.style.background = '#f59e0b';
  }
  // Pause any active folder progress UI so user sees "Waiting for internet"
  slots.forEach((slot) => {
    if (slot.progress && !slot.progress.done) {
      slot.progress.currentFile = 'Sync paused • Waiting for internet...';
      slot.progress.netSpeedText = '0 Mbps';
      slot.progress.diskSpeedText = '0 MB/s';
    }
  });
  renderWatchersList();

  if (window.squirrel && window.squirrel.notifyNetworkStatus) {
    try {
      await window.squirrel.notifyNetworkStatus(false);
      const res = await window.squirrel.getSyncDiagnostics();
      renderSyncDiagnostics(res);
    } catch (e) {}
  }
});

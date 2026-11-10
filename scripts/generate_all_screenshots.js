const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const outputDir = path.join(__dirname, '..', 'docs', 'screenshots');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1040,
    height: 680,
    center: true,
    show: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'mock_preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      backgroundThrottling: false
    }
  });

  const indexPath = path.join(__dirname, '..', 'index.html');
  await win.loadFile(indexPath);
  await delay(1500);

  // Common cleanup to anonymize user profile UI in sidebar
  const sanitizeSidebarJs = `
    const avatar = document.getElementById('userAvatar');
    if (avatar) avatar.textContent = 'D';
    const nameEl = document.getElementById('userNameLabel');
    if (nameEl) nameEl.textContent = 'Developer';
    const emailEl = document.getElementById('userEmailLabel');
    if (emailEl) emailEl.textContent = 'developer@squirrel.com.tr';
  `;

  // 1. Vault Encryption
  console.log('1. Capturing Vault Encryption...');
  await win.webContents.executeJavaScript(`
    (() => {
      ${sanitizeSidebarJs}
      switchTab('monitored-folders');
      const vModal = document.getElementById('vaultModal');
      if (vModal) {
        vModal.style.display = 'flex';
        document.getElementById('vaultModalFolderName').textContent = 'Folder: Project_Vault (~/Documents/Project_Vault)';
        document.getElementById('vaultEnableToggle').checked = true;
        document.getElementById('vaultPasswordContainer').style.display = 'flex';
        document.getElementById('vaultPasswordInput').value = 'SquirrelVaultKey2026!#';
        document.getElementById('vaultConfirmPasswordInput').value = 'SquirrelVaultKey2026!#';
        const statusMsg = document.getElementById('vaultStatusMessage');
        if (statusMsg) {
          statusMsg.style.display = 'block';
          statusMsg.style.background = 'rgba(16, 185, 129, 0.15)';
          statusMsg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          statusMsg.style.color = '#34d399';
          statusMsg.textContent = '🔒 Zero-Knowledge AES-256 Vault enabled. Files are encrypted client-side before sync.';
        }
      }
    })();
  `);
  await delay(600);
  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'vault-encryption.png'), img.toPNG());

  // 2. Safe Quarantine
  console.log('2. Capturing Safe Quarantine...');
  await win.webContents.executeJavaScript(`
    (() => {
      ${sanitizeSidebarJs}
      const vModal = document.getElementById('vaultModal');
      if (vModal) vModal.style.display = 'none';
      switchTab('quarantine');
      if (typeof loadQuarantineList === 'function') loadQuarantineList();
    })();
  `);
  await delay(600);
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'safe-quarantine.png'), img.toPNG());

  // 3. Exclusions & Filters
  console.log('3. Capturing Exclusions & Filters...');
  await win.webContents.executeJavaScript(`
    (() => {
      ${sanitizeSidebarJs}
      switchTab('exclusions');
      if (typeof loadExclusionsUI === 'function') loadExclusionsUI();
    })();
  `);
  await delay(600);
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'exclusions-filters.png'), img.toPNG());

  // 4. Version History (Time Machine)
  console.log('4. Capturing Version History...');
  await win.webContents.executeJavaScript(`
    (() => {
      ${sanitizeSidebarJs}
      switchTab('monitored-folders');
      const verModal = document.getElementById('versionHistoryModal');
      if (verModal) {
        verModal.style.display = 'flex';
        document.getElementById('versionModalFolderLabel').textContent = 'Folder: Project_Core (~/Projects/Project_Core)';
        const sel = document.getElementById('versionFileSelect');
        if (sel) {
          sel.innerHTML = '<option value="package.json">package.json</option><option value="main.js">main.js</option><option value="config.json">config.json</option>';
          sel.value = 'package.json';
        }
        const container = document.getElementById('versionTimelineContainer');
        if (container) {
          container.innerHTML = \`
            <div class="version-timeline-item" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(16,185,129,0.3); border-radius:10px; margin-bottom:10px;">
              <div>
                <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:8px; font-size:14px;">
                  <span>Revision 3 (Current)</span>
                  <span style="font-size:11px; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); padding:2px 8px; border-radius:10px; font-weight:600;">Active on Cloud</span>
                </div>
                <div style="font-size:12px; color:#94a3b8; margin-top:4px;">Saved: Today at 19:15 • Size: 90.4 KB • Author: Developer</div>
              </div>
              <span style="font-size:12px; font-weight:600; color:#10b981;">● Current Version</span>
            </div>
            <div class="version-timeline-item" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:rgba(255,255,255,0.02); border:1px solid #2d3240; border-radius:10px; margin-bottom:10px;">
              <div>
                <div style="font-weight:600; color:#e2e8f0; font-size:13.5px;">Revision 2</div>
                <div style="font-size:12px; color:#94a3b8; margin-top:4px;">Saved: Yesterday at 21:40 • Size: 88.2 KB • Author: Developer</div>
              </div>
              <button class="btn btn-secondary btn-sm" style="padding:6px 14px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.08); color:#fff; border:1px solid rgba(255,255,255,0.15); cursor:pointer;">↩ Restore this version</button>
            </div>
            <div class="version-timeline-item" style="display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:rgba(255,255,255,0.02); border:1px solid #2d3240; border-radius:10px;">
              <div>
                <div style="font-weight:600; color:#e2e8f0; font-size:13.5px;">Revision 1</div>
                <div style="font-size:12px; color:#94a3b8; margin-top:4px;">Saved: 05.11.2026 at 14:10 • Size: 76.1 KB • Author: Developer</div>
              </div>
              <button class="btn btn-secondary btn-sm" style="padding:6px 14px; font-size:12px; border-radius:6px; background:rgba(255,255,255,0.08); color:#fff; border:1px solid rgba(255,255,255,0.15); cursor:pointer;">↩ Restore this version</button>
            </div>
          \`;
        }
      }
    })();
  `);
  await delay(600);
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'version-history-time-machine.png'), img.toPNG());

  // 5. Diagnostics
  console.log('5. Capturing Sync Diagnostics...');
  await win.webContents.executeJavaScript(`
    (() => {
      ${sanitizeSidebarJs}
      const verModal = document.getElementById('versionHistoryModal');
      if (verModal) verModal.style.display = 'none';
      const diagModal = document.getElementById('syncDiagnosticsModal');
      if (diagModal) {
        diagModal.style.display = 'flex';
        if (typeof switchDiagnosticsTab === 'function') switchDiagnosticsTab('issues');
        if (typeof renderSyncDiagnostics === 'function') {
          renderSyncDiagnostics({
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
          });
        }
      }
    })();
  `);
  await delay(600);
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'sync-diagnostics.png'), img.toPNG());

  console.log('ALL 5 CAPTURED WITH ANONYMOUS GENERIC LABELS!');
  win.close();
  app.quit();
});

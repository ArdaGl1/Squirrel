const { rcedit } = require('rcedit');
const fs = require('fs');
const path = require('path');

async function customizeExe() {
  const rootDir = path.resolve(__dirname, '..');
  const distDir = path.join(rootDir, 'node_modules', 'electron', 'dist');
  const electronExe = path.join(distDir, 'electron.exe');
  const squirrelExe = path.join(distDir, 'Squirrel.exe');
  const iconPath = path.join(rootDir, 'icon', 'icon.ico');
  const pathFile = path.join(rootDir, 'node_modules', 'electron', 'path.txt');

  if (!fs.existsSync(distDir)) {
    console.log('[Setup] Electron dist directory not found, skipping exe customization.');
    return;
  }

  // Copy or refresh Squirrel.exe from electron.exe
  if (fs.existsSync(electronExe)) {
    fs.copyFileSync(electronExe, squirrelExe);
  }

  if (fs.existsSync(squirrelExe) && fs.existsSync(iconPath)) {
    console.log('[Setup] Customizing Squirrel.exe icon & metadata...');
    await rcedit(squirrelExe, {
      'icon': iconPath,
      'version-string': {
        'ProductName': 'Squirrel',
        'FileDescription': 'Squirrel Multi-Cloud Sync',
        'CompanyName': 'Squirrel',
        'LegalCopyright': 'Copyright (c) 2026 Squirrel',
        'OriginalFilename': 'Squirrel.exe',
        'InternalName': 'Squirrel'
      },
      'file-version': '2.1.0',
      'product-version': '2.1.0'
    });
  }

  if (fs.existsSync(pathFile)) {
    fs.writeFileSync(pathFile, 'Squirrel.exe', 'utf8');
  }

  console.log('[Setup] Squirrel.exe configured successfully!');
}

customizeExe().catch((err) => {
  console.warn('[Setup] Note: Executable branding skipped or deferred:', err.message);
});

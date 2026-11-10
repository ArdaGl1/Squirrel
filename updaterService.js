const https = require('https');
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { spawn } = require('child_process');

class UpdaterService {
  constructor(currentVersion, repo = 'ArdaG1/Squirrel') {
    this.currentVersion = currentVersion || '2.0.0';
    this.repo = repo;
    this.latestRelease = null;
    this.isDownloading = false;
  }

  compareSemver(v1, v2) {
    const clean = (v) =>
      String(v)
        .replace(/^v/, '')
        .split('-')[0]
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const p1 = clean(v1);
    const p2 = clean(v2);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  async checkForUpdates() {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repo}/releases/latest`,
        headers: {
          'User-Agent': 'Squirrel-App',
          'Accept': 'application/vnd.github.v3+json',
        },
        timeout: 8000,
      };

      const req = https.get(options, (res) => {
        if (res.statusCode === 404) {
          return resolve({
            updateAvailable: false,
            currentVersion: this.currentVersion,
            message: 'No published releases found yet on GitHub.',
          });
        }

        if (res.statusCode !== 200) {
          return resolve({
            updateAvailable: false,
            currentVersion: this.currentVersion,
            message: `GitHub API response: HTTP ${res.statusCode}`,
          });
        }

        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(rawData);
            const remoteTag = data.tag_name || data.name || '';
            const isNewer = this.compareSemver(remoteTag, this.currentVersion) > 0;

            const assets = Array.isArray(data.assets) ? data.assets : [];
            const exeAsset = assets.find((a) => a.name && a.name.toLowerCase().endsWith('.exe'));

            this.latestRelease = {
              updateAvailable: isNewer,
              currentVersion: this.currentVersion,
              newVersion: remoteTag,
              releaseName: data.name || remoteTag,
              releaseNotes: data.body || '',
              releaseUrl: data.html_url,
              downloadUrl: exeAsset ? exeAsset.browser_download_url : data.html_url,
              isExe: !!exeAsset,
              assetName: exeAsset ? exeAsset.name : 'Squirrel-Setup.exe',
            };

            resolve(this.latestRelease);
          } catch (err) {
            resolve({
              updateAvailable: false,
              currentVersion: this.currentVersion,
              message: 'Failed to parse release data.',
            });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          updateAvailable: false,
          currentVersion: this.currentVersion,
          message: 'Update check timed out.',
        });
      });

      req.on('error', (err) => {
        resolve({
          updateAvailable: false,
          currentVersion: this.currentVersion,
          message: err.message,
        });
      });
    });
  }

  async downloadAndInstall(onProgress) {
    if (!this.latestRelease) {
      throw new Error('No update release information found. Check for updates first.');
    }

    if (!this.latestRelease.isExe || !this.latestRelease.downloadUrl) {
      // If no standalone exe asset is attached, open the GitHub release webpage
      if (this.latestRelease.releaseUrl) {
        shell.openExternal(this.latestRelease.releaseUrl);
      }
      return { success: true, openedBrowser: true };
    }

    if (this.isDownloading) {
      return { success: false, message: 'Download already in progress.' };
    }

    this.isDownloading = true;
    const tempDir = app.getPath('temp');
    const targetFile = path.join(tempDir, this.latestRelease.assetName || 'Squirrel-Update.exe');

    return new Promise((resolve, reject) => {
      const downloadWithRedirect = (targetUrl) => {
        https.get(
          targetUrl,
          {
            headers: {
              'User-Agent': 'Squirrel-App',
            },
          },
          (res) => {
            // Handle HTTP 301/302 Redirects (standard in GitHub release asset downloads)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return downloadWithRedirect(res.headers.location);
            }

            if (res.statusCode !== 200) {
              this.isDownloading = false;
              return reject(new Error(`Download failed with status HTTP ${res.statusCode}`));
            }

            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;
            const fileStream = fs.createWriteStream(targetFile);

            res.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              if (onProgress && totalBytes > 0) {
                const percent = Math.round((downloadedBytes / totalBytes) * 100);
                onProgress({ percent, downloadedBytes, totalBytes });
              }
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => {
              fileStream.close(() => {
                this.isDownloading = false;
                console.log('[Updater] Download complete, executing installer:', targetFile);

                try {
                  // Execute installer detached and close current app
                  spawn(targetFile, [], {
                    detached: true,
                    stdio: 'ignore',
                  }).unref();

                  setTimeout(() => {
                    app.quit();
                  }, 1000);

                  resolve({ success: true, executed: true });
                } catch (e) {
                  reject(e);
                }
              });
            });

            fileStream.on('error', (err) => {
              this.isDownloading = false;
              fs.unlink(targetFile, () => {});
              reject(err);
            });
          }
        ).on('error', (err) => {
          this.isDownloading = false;
          reject(err);
        });
      };

      downloadWithRedirect(this.latestRelease.downloadUrl);
    });
  }
}

module.exports = UpdaterService;

const fs = (() => {
  try {
    if (process.versions && process.versions.electron) {
      return require('original-fs');
    }
  } catch (e) {}
  return require('fs');
})();
const path = require('path');
const {
  ZipWriter,
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} = require('@zip.js/zip.js');

class VaultService {
  constructor() {
    this.vaultConfigs = new Map(); // folderPath -> { enabled: boolean, password: string }
  }

  setFolderVault(folderPath, enabled, password = '') {
    if (!folderPath) return;
    const norm = path.normalize(folderPath).toLowerCase();
    if (!enabled) {
      for (const k of Array.from(this.vaultConfigs.keys())) {
        if (k.toLowerCase() === norm) {
          this.vaultConfigs.delete(k);
        }
      }
    } else {
      let existing = this.vaultConfigs.get(norm);
      if (!existing) {
        for (const [k, v] of this.vaultConfigs.entries()) {
          if (k.toLowerCase() === norm) {
            existing = v;
            break;
          }
        }
      }
      const finalPassword = (password && String(password).trim()) || (existing ? existing.password : '');
      if (finalPassword) {
        this.vaultConfigs.set(norm, {
          enabled: true,
          password: finalPassword,
        });
      } else {
        this.vaultConfigs.delete(norm);
      }
    }
  }

  getVaultConfig(folderPathOrName) {
    if (!folderPathOrName) return null;
    const str = String(folderPathOrName).toLowerCase();
    const norm = path.normalize(folderPathOrName).toLowerCase();
    for (const [p, cfg] of this.vaultConfigs.entries()) {
      const pNorm = path.normalize(p).toLowerCase();
      const baseName = path.basename(pNorm).toLowerCase();
      if (norm === pNorm || str === baseName || norm.startsWith(pNorm + path.sep) || norm.startsWith(pNorm + '/') || norm.startsWith(pNorm + '\\')) {
        return cfg;
      }
    }
    return null;
  }

  isFolderVaultEnabled(folderPathOrName) {
    const cfg = this.getVaultConfig(folderPathOrName);
    return !!(cfg && cfg.enabled && cfg.password);
  }

  getFolderPassword(folderPathOrName) {
    const cfg = this.getVaultConfig(folderPathOrName);
    return cfg ? cfg.password : null;
  }

  /**
   * Encrypts a local file using standard WinZip AES-256.
   * Produces an open standard .zip file readable by 7-Zip, WinRAR, etc.
   * @param {string} localFilePath - Path of the cleartext file on disk.
   * @param {string} targetZipPath - Where to save the encrypted zip.
   * @param {string} password - Master key for encryption.
   * @returns {Promise<string>} targetZipPath
   */
  async encryptFileToZip(localFilePath, targetZipPath, password) {
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Source file does not exist: ${localFilePath}`);
    }

    const fileBuffer = await fs.promises.readFile(localFilePath);
    const innerFileName = path.basename(localFilePath);

    const zipWriter = new ZipWriter(new Uint8ArrayWriter());
    await zipWriter.add(innerFileName, new Uint8ArrayReader(fileBuffer), {
      password: String(password),
      zipCrypto: false, // Standard WinZip AES-256 encryption
    });

    const encryptedData = await zipWriter.close();
    await fs.promises.mkdir(path.dirname(targetZipPath), { recursive: true });
    await fs.promises.writeFile(targetZipPath, Buffer.from(encryptedData));

    return targetZipPath;
  }

  /**
   * Decrypts an AES-256 zip file back to original cleartext.
   * @param {string} zipFilePath - Path to encrypted zip.
   * @param {string} targetClearPath - Where to write the decrypted output.
   * @param {string} password - Master key.
   */
  async decryptZipToFile(zipFilePath, targetClearPath, password) {
    if (!fs.existsSync(zipFilePath)) {
      throw new Error(`Encrypted zip file does not exist: ${zipFilePath}`);
    }

    const zipBuffer = await fs.promises.readFile(zipFilePath);
    const zipReader = new ZipReader(new Uint8ArrayReader(zipBuffer));
    const entries = await zipReader.getEntries();

    if (!entries || entries.length === 0) {
      await zipReader.close();
      throw new Error('Encrypted archive contains no files.');
    }

    // First entry contains our file
    const targetEntry = entries[0];
    const decryptedBytes = await targetEntry.getData(new Uint8ArrayWriter(), {
      password: String(password),
    });

    await zipReader.close();
    await fs.promises.mkdir(path.dirname(targetClearPath), { recursive: true });
    await fs.promises.writeFile(targetClearPath, Buffer.from(decryptedBytes));

    return targetClearPath;
  }

  /**
   * Encrypts an entire local folder into a standard WinZip AES-256 zip archive.
   * Can be extracted by 7-Zip, WinRAR, or Squirrel Decryptor with one master password.
   * @param {string} folderPath - Path to local directory.
   * @param {string} targetZipPath - Where to save the output zip.
   * @param {string} password - Master key for encryption.
   * @returns {Promise<string>} targetZipPath
   */
  async encryptFolderToZip(folderPath, targetZipPath, password) {
    if (!fs.existsSync(folderPath)) {
      throw new Error(`Source folder does not exist: ${folderPath}`);
    }

    const zipWriter = new ZipWriter(new Uint8ArrayWriter());

    const addDirectory = async (currentDir, relPrefix) => {
      let entries = [];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        const name = entry.name;
        if (
          name.startsWith('.') ||
          name === 'node_modules' ||
          name === '$RECYCLE.BIN' ||
          name === 'Thumbs.db' ||
          name === 'desktop.ini' ||
          name.endsWith('.tmp') ||
          name.startsWith('~$')
        ) {
          continue;
        }

        const fullPath = path.join(currentDir, name);
        const relPath = relPrefix ? `${relPrefix}/${name}` : name;

        if (entry.isDirectory()) {
          await addDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          try {
            const fileBuf = await fs.promises.readFile(fullPath);
            await zipWriter.add(relPath.replace(/\\/g, '/'), new Uint8ArrayReader(fileBuf), {
              password: String(password),
              zipCrypto: false, // Standard WinZip AES-256
            });
          } catch (readErr) {
            console.warn(`[Vault] Could not read file ${fullPath}:`, readErr.message);
          }
        }
      }
    };

    await addDirectory(folderPath, '');
    const encryptedData = await zipWriter.close();
    await fs.promises.mkdir(path.dirname(targetZipPath), { recursive: true });
    await fs.promises.writeFile(targetZipPath, Buffer.from(encryptedData));
    return targetZipPath;
  }

  /**
   * Decrypts an entire WinZip AES-256 zip archive into a destination folder.
   * @param {string} zipFilePath - Path to encrypted zip.
   * @param {string} targetFolder - Where to extract all decrypted files and directories.
   * @param {string} password - Master key.
   */
  async decryptZipToFolder(zipFilePath, targetFolder, password) {
    if (!fs.existsSync(zipFilePath)) {
      throw new Error(`Archive does not exist: ${zipFilePath}`);
    }

    const zipBuffer = await fs.promises.readFile(zipFilePath);
    const zipReader = new ZipReader(new Uint8ArrayReader(zipBuffer));
    const entries = await zipReader.getEntries();

    if (!entries || entries.length === 0) {
      await zipReader.close();
      throw new Error('Encrypted archive contains no files.');
    }

    await fs.promises.mkdir(targetFolder, { recursive: true });

    for (const entry of entries) {
      if (entry.directory) continue;
      const entryRelPath = entry.filename.replace(/\//g, path.sep);
      const outFilePath = path.join(targetFolder, entryRelPath);
      await fs.promises.mkdir(path.dirname(outFilePath), { recursive: true });

      const decryptedBytes = await entry.getData(new Uint8ArrayWriter(), {
        password: String(password),
      });

      await fs.promises.writeFile(outFilePath, Buffer.from(decryptedBytes));
    }

    await zipReader.close();
    return targetFolder;
  }

  /**
   * Convert cloud file name to/from vault format.
   * E.g. 'myfile.pdf' -> 'myfile.pdf.sqvault.zip'
   */
  getCloudVaultFileName(originalName) {
    if (originalName.endsWith('.sqvault.zip')) return originalName;
    return `${originalName}.sqvault.zip`;
  }

  isVaultCloudFile(cloudFileName) {
    return cloudFileName.endsWith('.sqvault.zip') || cloudFileName.endsWith('.vault.zip');
  }

  getOriginalFileNameFromVault(cloudFileName) {
    return cloudFileName
      .replace(/\.sqvault\.zip$/i, '')
      .replace(/\.vault\.zip$/i, '');
  }
}

module.exports = new VaultService();

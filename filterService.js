const fs = (() => {
  try {
    if (process.versions && process.versions.electron) {
      return require('original-fs');
    }
  } catch (e) {}
  return require('fs');
})();
const path = require('path');

const PRESET_DEFINITIONS = {
  dev: {
    id: 'dev',
    title: 'Developer Dependencies & Build Artifacts',
    description: 'Ignores package managers, version control metadata, and build output',
    tags: ['node_modules/', '.git/', '.venv/', '__pycache__/', 'build/', 'dist/', 'release/', 'target/', '.next/'],
    patterns: [
      'node_modules/',
      '.git/',
      '.svn/',
      '.hg/',
      '.venv/',
      'venv/',
      '__pycache__/',
      'target/',
      'build/',
      'dist/',
      'release/',
      '.next/',
      '.nuxt/',
    ],
  },
  temp: {
    id: 'temp',
    title: 'Temporary, Backup & Lock Files',
    description: 'Ignores editor lock files, office temporary files, swap files, and logs',
    tags: ['*.tmp', '*.~*', '~$*', '*.lock', '*.swp', '*.bak', '*.temp'],
    patterns: [
      '*.tmp',
      '*.~*',
      '~$*',
      '*.lock',
      '*.swp',
      '*.bak',
      '*.temp',
      '*~',
      '*.crswap',
    ],
  },
  system: {
    id: 'system',
    title: 'Operating System Cache & Recycle Bin',
    description: 'Ignores Windows system files, thumbnails, icon caches, and Trash',
    tags: ['$RECYCLE.BIN/', 'Thumbs.db', 'desktop.ini', '.DS_Store'],
    patterns: [
      '$RECYCLE.BIN/',
      'Thumbs.db',
      'desktop.ini',
      '.DS_Store',
      'ehthumbs.db',
      'ehthumbs_vista.db',
    ],
  },
  media: {
    id: 'media',
    title: 'Large Media & Disk Images (Optional)',
    description: 'Save cloud storage by excluding heavy ISO images and video files',
    tags: ['*.iso', '*.dmg', '*.vmdk', '*.mkv', '*.mp4', '*.avi'],
    patterns: [
      '*.iso',
      '*.dmg',
      '*.vmdk',
      '*.vdi',
      '*.mkv',
      '*.mp4',
      '*.avi',
      '*.mov',
      '*.wmv',
    ],
  },
  archives: {
    id: 'archives',
    title: 'Compressed Archive Files (Optional)',
    description: 'Exclude redundant compressed archives from automatic cloud sync',
    tags: ['*.zip', '*.rar', '*.7z', '*.tar', '*.gz'],
    patterns: [
      '*.zip',
      '*.rar',
      '*.7z',
      '*.tar',
      '*.gz',
      '*.bz2',
      '*.xz',
    ],
  },
};

const DEFAULT_FILTERS = {
  presets: {
    dev: true,
    temp: true,
    system: true,
    media: false,
    archives: false,
  },
  customRules: [
    '*.log',
    'cache/',
  ],
  maxFileSizeMB: 0, // 0 = unlimited
};

class FilterService {
  constructor() {
    this.configDir = null;
    this.filePath = null;
    this.state = JSON.parse(JSON.stringify(DEFAULT_FILTERS));
  }

  init(configDir) {
    this.configDir = configDir;
    this.filePath = path.join(configDir, 'filters.json');
    this.load();
  }

  load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          presets: { ...DEFAULT_FILTERS.presets, ...(parsed.presets || {}) },
          customRules: Array.isArray(parsed.customRules) ? parsed.customRules : [...DEFAULT_FILTERS.customRules],
          maxFileSizeMB: typeof parsed.maxFileSizeMB === 'number' ? parsed.maxFileSizeMB : 0,
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.warn('[FilterService] Failed to load filters.json, using defaults:', err.message);
      this.state = JSON.parse(JSON.stringify(DEFAULT_FILTERS));
    }
  }

  save() {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');

      // Sync to template directory in development mode if applicable
      const templateDir = path.join(__dirname, 'config');
      if (templateDir !== this.configDir && fs.existsSync(templateDir)) {
        try {
          fs.writeFileSync(path.join(templateDir, 'filters.json'), JSON.stringify(this.state, null, 2), 'utf8');
        } catch (e) {}
      }
    } catch (err) {
      console.error('[FilterService] Failed to save filters.json:', err.message);
    }
  }

  getState() {
    return {
      presets: { ...this.state.presets },
      customRules: [...this.state.customRules],
      maxFileSizeMB: this.state.maxFileSizeMB,
      presetDefinitions: PRESET_DEFINITIONS,
      effectivePatterns: this.getActivePatterns(),
    };
  }

  getActivePatterns() {
    const patterns = [];
    for (const [key, enabled] of Object.entries(this.state.presets)) {
      if (enabled && PRESET_DEFINITIONS[key]) {
        patterns.push(...PRESET_DEFINITIONS[key].patterns);
      }
    }
    for (const rule of this.state.customRules) {
      const trimmed = (rule || '').trim();
      if (trimmed && !patterns.includes(trimmed)) {
        patterns.push(trimmed);
      }
    }
    return patterns;
  }

  updateState(updates = {}) {
    if (updates.presets && typeof updates.presets === 'object') {
      this.state.presets = { ...this.state.presets, ...updates.presets };
    }
    if (Array.isArray(updates.customRules)) {
      this.state.customRules = updates.customRules
        .map((r) => (r || '').trim())
        .filter((r) => r.length > 0);
    }
    if (typeof updates.maxFileSizeMB === 'number') {
      this.state.maxFileSizeMB = Math.max(0, updates.maxFileSizeMB);
    }
    this.save();
    return this.getState();
  }

  addCustomRule(rule) {
    if (!rule || typeof rule !== 'string') return this.getState();
    const clean = rule.trim();
    if (!clean) return this.getState();

    const exists = this.state.customRules.some((r) => r.toLowerCase() === clean.toLowerCase());
    if (!exists) {
      this.state.customRules.push(clean);
      this.save();
    }
    return this.getState();
  }

  removeCustomRule(rule) {
    if (!rule) return this.getState();
    const clean = rule.trim().toLowerCase();
    this.state.customRules = this.state.customRules.filter(
      (r) => r.trim().toLowerCase() !== clean
    );
    this.save();
    return this.getState();
  }

  matchesPattern(normalizedPath, fileName, pattern, isDirectory = false) {
    const pat = pattern.trim().toLowerCase();
    const fName = fileName.toLowerCase();
    const nPath = normalizedPath.toLowerCase();

    // 1. Directory pattern ending with /
    if (pat.endsWith('/')) {
      const dirName = pat.slice(0, -1);
      const segments = nPath.split('/').filter(Boolean);
      return segments.includes(dirName) || fName === dirName;
    }

    // 2. Exact match
    if (fName === pat) return true;

    // 3. Extension match (*.ext)
    if (pat.startsWith('*.') && !pat.slice(2).includes('*')) {
      const ext = pat.slice(1);
      return fName.endsWith(ext);
    }

    // 4. Prefix match (prefix*)
    if (pat.endsWith('*') && !pat.startsWith('*')) {
      const prefix = pat.slice(0, -1);
      return fName.startsWith(prefix);
    }

    // 5. General Wildcard
    try {
      const escaped = pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`(^|[/\\\\])${escaped}($|[/\\\\])`, 'i');
      return regex.test(nPath) || regex.test(fName);
    } catch (e) {
      return false;
    }
  }

  shouldIgnore(targetPath, isDirectory = null, fileSize = null) {
    if (!targetPath) return { ignored: false };

    // File size check if enabled
    if (this.state.maxFileSizeMB > 0 && typeof fileSize === 'number' && fileSize > 0) {
      const maxBytes = this.state.maxFileSizeMB * 1024 * 1024;
      if (fileSize > maxBytes) {
        return {
          ignored: true,
          matchedRule: `File size > ${this.state.maxFileSizeMB} MB`,
          reason: `File size (${(fileSize / (1024 * 1024)).toFixed(1)} MB) exceeds the ${this.state.maxFileSizeMB} MB threshold`,
        };
      }
    }

    const norm = targetPath.replace(/\\/g, '/');
    const fileName = norm.split('/').filter(Boolean).pop() || targetPath;

    // Fast check: Always ignore internal Windows Recycler and Thumbs
    if (fileName === '$RECYCLE.BIN' || fileName === 'Thumbs.db' || fileName === 'desktop.ini') {
      return { ignored: true, matchedRule: fileName, reason: 'Operating system cached file' };
    }

    const patterns = this.getActivePatterns();
    for (const pat of patterns) {
      if (this.matchesPattern(norm, fileName, pat, isDirectory)) {
        return {
          ignored: true,
          matchedRule: pat,
          reason: `Matched exclusion rule: ${pat}`,
        };
      }
    }

    return { ignored: false };
  }

  testSample(samplePath) {
    if (!samplePath || !samplePath.trim()) {
      return { ignored: false, reason: 'Empty path provided' };
    }
    const clean = samplePath.trim();
    const isDir = clean.endsWith('/') || clean.endsWith('\\');
    const result = this.shouldIgnore(clean, isDir);
    if (result.ignored) {
      return {
        ignored: true,
        matchedRule: result.matchedRule,
        reason: `Excluded by rule: ${result.matchedRule}`,
      };
    }
    return {
      ignored: false,
      reason: 'Allowed — will be synchronized to cloud',
    };
  }
}

module.exports = new FilterService();

// release-pack-rules.mjs — zip 发布 include/exclude 规则 SSOT 实现
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {ReadonlySet<string>} */
export const RELEASE_BINARY_EXTENSIONS = new Set([
  '.whl',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
  '.zip',
  '.gz',
]);

/** @param {string} relPath relative to repo root, POSIX */
export function isReleaseBinaryRelPath(relPath) {
  const ext = path.posix.extname(toPosixPath(relPath)).toLowerCase();
  return RELEASE_BINARY_EXTENSIONS.has(ext);
}

/** @param {Buffer} buf */
export function isProbablyBinaryBuffer(buf) {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  return sample.includes(0);
}

/** @param {string} text */
export function normalizeReleaseTextEol(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Copy one release file into staging; text files are normalized to LF.
 * @param {string} src
 * @param {string} dest
 * @param {string} relPath relative to repo root, POSIX
 */
export function stageReleaseFile(src, dest, relPath) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isReleaseBinaryRelPath(relPath)) {
    fs.copyFileSync(src, dest);
    return;
  }
  const raw = fs.readFileSync(src);
  if (isProbablyBinaryBuffer(raw)) {
    fs.copyFileSync(src, dest);
    return;
  }
  fs.writeFileSync(dest, normalizeReleaseTextEol(raw.toString('utf8')), 'utf8');
}

/** @param {string} p */
export function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

/** @param {string} glob @param {string} target */
export function matchGlob(glob, target) {
  const g = toPosixPath(glob);
  const t = toPosixPath(target);
  const re = globToRegExp(g);
  return re.test(t);
}

/** @param {string} glob */
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.+/)*';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

/** @returns {import('./release-excludes.types').ReleaseExcludes} */
export function loadReleaseExcludes(manifestPath = path.join(__dirname, 'release-excludes.json')) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/**
 * @param {string} relPath relative to repo root, POSIX
 * @param {ReturnType<typeof loadReleaseExcludes>} rules
 * @returns {{ include: boolean, rule: string | null }}
 */
export function classifyPath(relPath, rules) {
  const p = toPosixPath(relPath);

  if (rules.includeOverrides.includes(p)) {
    return { include: true, rule: 'includeOverride' };
  }

  const firstSegment = p.split('/')[0];
  if (rules.excludeRootDirs.includes(firstSegment)) {
    return { include: false, rule: `excludeRootDirs:${firstSegment}` };
  }

  for (const glob of rules.excludeGlobs) {
    if (matchGlob(glob, p)) {
      return { include: false, rule: `excludeGlobs:${glob}` };
    }
  }

  return { include: true, rule: null };
}

/** @param {object} pkg */
export function sanitizePackageJson(pkg) {
  const out = JSON.parse(JSON.stringify(pkg));
  if (out.scripts && typeof out.scripts === 'object') {
    const scripts = { ...out.scripts };
    for (const key of Object.keys(scripts)) {
      if (key.startsWith('release:')) {
        delete scripts[key];
      }
    }
    out.scripts = scripts;
  }
  delete out.devDependencies;
  return out;
}

/**
 * @param {string} repoRoot
 * @param {ReturnType<typeof loadReleaseExcludes>} rules
 */
export function collectReleaseFiles(repoRoot, rules) {
  /** @type {string[]} */
  const included = [];
  /** @type {string[]} */
  const excluded = [];
  /** @type {Record<string, number>} */
  const excludedCountsByRule = {};

  function bump(rule) {
    excludedCountsByRule[rule] = (excludedCountsByRule[rule] ?? 0) + 1;
  }

  /** @param {string} relDir @param {string} excludeRule */
  function walkExcludedRootSubtree(relDir, excludeRule) {
    const absDir = path.join(repoRoot, relDir);
    if (!fs.existsSync(absDir)) return;

    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const relPath = `${relDir}/${ent.name}`;
      const posix = toPosixPath(relPath);
      if (ent.isDirectory()) {
        walkExcludedRootSubtree(relPath, excludeRule);
        continue;
      }
      excluded.push(posix);
      bump(excludeRule);
    }
  }

  /** @param {string} relDir */
  function walk(relDir) {
    const absDir = relDir ? path.join(repoRoot, relDir) : repoRoot;
    if (!fs.existsSync(absDir)) return;

    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      const posix = toPosixPath(relPath);

      if (ent.isDirectory()) {
        if (!relDir && rules.excludeRootDirs.includes(ent.name)) {
          walkExcludedRootSubtree(posix, `excludeRootDirs:${ent.name}`);
          continue;
        }
        walk(relPath);
        continue;
      }

      const { include, rule } = classifyPath(posix, rules);
      if (include) {
        included.push(posix);
      } else {
        excluded.push(posix);
        if (rule) bump(rule);
      }
    }
  }

  walk('');
  included.sort();
  excluded.sort();

  return { included, excluded, excludedCountsByRule };
}

/** @param {string} repoRoot @param {ReturnType<typeof loadReleaseExcludes>} rules */
export function runSyntheticRuleTests(repoRoot, rules) {
  const errors = [];

  const mustInclude = [
    'harness/scripts/check-init.ts',
    'harness/schemas',
    'README.md',
  ];
  for (const p of mustInclude) {
    const full = path.join(repoRoot, p);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) continue;
    const { include } = classifyPath(p, rules);
    if (!include) errors.push(`expected include: ${p}`);
  }

  const harnessScript = path.join(repoRoot, 'harness/scripts/check-init.ts');
  if (fs.existsSync(harnessScript)) {
    const { include } = classifyPath('harness/scripts/check-init.ts', rules);
    if (!include) errors.push('harness/scripts/check-init.ts must be included');
  }

  const packScript = path.join(repoRoot, 'scripts/pack-release.mjs');
  if (fs.existsSync(packScript)) {
    const { include } = classifyPath('scripts/pack-release.mjs', rules);
    if (include) errors.push('scripts/pack-release.mjs must be excluded');
  }

  for (const devOnly of ['.editorconfig', '.gitattributes']) {
    const { include } = classifyPath(devOnly, rules);
    if (include) errors.push(`${devOnly} must be excluded from release`);
  }

  const { excluded, excludedCountsByRule } = collectReleaseFiles(repoRoot, rules);
  if (fs.existsSync(packScript) && !excluded.includes('scripts/pack-release.mjs')) {
    errors.push('collect: scripts/pack-release.mjs missing from excluded stats');
  }
  if ((excludedCountsByRule['excludeRootDirs:scripts'] ?? 0) < 1) {
    errors.push('collect: excludeRootDirs:scripts count missing');
  }
  if ((excludedCountsByRule['excludeRootDirs:.cursor'] ?? 0) < 1) {
    errors.push('collect: excludeRootDirs:.cursor count missing');
  }

  const winPath = toPosixPath('harness\\scripts\\check-init.ts');
  const { include: winInclude } = classifyPath(winPath, rules);
  if (!winInclude) errors.push('Windows path normalization failed for harness/scripts');

  const pkg = {
    name: 'agent-maison',
    version: '3.0.0',
    scripts: {
      test: 'npm test',
      'release:pack': 'node scripts/pack-release.mjs',
      'release:verify': 'node scripts/verify-release-pack.mjs',
    },
    devDependencies: { archiver: '^7.0.0', 'extract-zip': '^2.0.1' },
  };
  const sanitized = sanitizePackageJson(pkg);
  if (sanitized.scripts['release:pack']) errors.push('sanitize: release:pack still present');
  if (sanitized.devDependencies) errors.push('sanitize: devDependencies still present');
  if (!sanitized.scripts.test) errors.push('sanitize: test script removed');

  const eolCases = [
    ['a\r\nb\r\nc', 'a\nb\nc'],
    ['a\rb', 'a\nb'],
    ['a\nb', 'a\nb'],
  ];
  for (const [input, expected] of eolCases) {
    if (normalizeReleaseTextEol(input) !== expected) {
      errors.push(`normalizeReleaseTextEol failed for ${JSON.stringify(input)}`);
    }
  }
  if (!isReleaseBinaryRelPath('profiles/hmos-app/vendor/hylyre/foo.whl')) {
    errors.push('isReleaseBinaryRelPath must treat .whl as binary');
  }
  if (isReleaseBinaryRelPath('README.md')) {
    errors.push('isReleaseBinaryRelPath must not treat README.md as binary');
  }

  return errors;
}

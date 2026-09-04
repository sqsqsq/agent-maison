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
      if (key === 'openspec' || key === 'openspec:validate') {
        delete scripts[key];
      }
    }
    out.scripts = scripts;
  }
  delete out.devDependencies;
  return out;
}

/** @param {object} pkg */
export function sanitizeHarnessPackageJson(pkg) {
  const out = JSON.parse(JSON.stringify(pkg));
  if (out.scripts && typeof out.scripts === 'object') {
    delete out.scripts['test:unit'];
    delete out.scripts['test:fixtures'];
    out.scripts.test = 'npm run check:global';
  }
  return out;
}

/** @param {object} manifest Hylyre vendor release.manifest.json */
export function sanitizeVendorManifest(manifest) {
  const out = JSON.parse(JSON.stringify(manifest));
  delete out.integration_docs;
  // Maison 的 consumer 发布包对 schema 2 固定为 plain-source：release-excludes.json
  // 会排除 vendor 下全部 .whl。联合 manifest 中的 wheel 字段只服务开发仓双存/legacy
  // 回退；若把它原样带入源码-only 包，会形成“声明了一个包内不存在的必需工件”的
  // 歧义。消费包只保留实际随包交付、可验真的 source 身份。
  if (out.schema === 2 && out.source) {
    delete out.wheel;
  }
  // 移交文档不随 maison 发布包分发，note 内的引用改写为本目录 README。文案按发布
  // 形态分支——Hylyre 0.3.2 真件的 schema 2 note 实测含移交文档引用（评审 4），
  // 不分支会把源码模式 note 改写成 wheel 话术。
  if (typeof out.note === 'string' && out.note.includes('downstream-harness-requests.md')) {
    out.note =
      out.schema === 2
        ? 'Plain-source release. Install with: pip install <src-dir> "hylyre[device,mcp]"; ' +
          'pip will fetch transitive deps (hypium/fastmcp/etc.) from PyPI. ' +
          'Framework harness integration: see README.md in this directory.'
        : 'Pure-Python wheel (py3-none-any). Install with: pip install <wheel-path>; ' +
          'pip will fetch transitive deps (hypium/fastmcp/etc.) from PyPI. ' +
          'Framework harness integration: see README.md in this directory.';
  }
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
  if (fs.existsSync(path.join(repoRoot, 'temp'))) {
    const { include } = classifyPath('temp/.gitkeep', rules);
    if (include) errors.push('temp/ must be excluded from release (dev-only scratch)');
    if ((excludedCountsByRule['excludeRootDirs:temp'] ?? 0) !== excluded.filter(p => p.startsWith('temp/')).length) {
      errors.push('collect: excludeRootDirs:temp count mismatch');
    }
  }

  const winPath = toPosixPath('harness\\scripts\\check-init.ts');
  const { include: winInclude } = classifyPath(winPath, rules);
  if (!winInclude) errors.push('Windows path normalization failed for harness/scripts');

  const pkg = {
    name: 'agent-maison',
    version: '2.0.1',
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
  if (sanitized.scripts.openspec) errors.push('sanitize: openspec script still present');

  const harnessPkg = {
    name: 'harness',
    scripts: {
      test: 'npm run test:unit && npm run test:fixtures',
      'test:unit': 'ts-node tests/run-unit.ts',
      'test:fixtures': 'ts-node tests/run-tests.ts',
      'check:catalog': 'ts-node harness-runner.ts --phase catalog',
      'check:glossary': 'ts-node harness-runner.ts --phase glossary',
      'check:docs': 'ts-node harness-runner.ts --phase docs',
      'check:global': 'npm run check:catalog && npm run check:glossary && npm run check:docs',
    },
  };
  const sanitizedHarness = sanitizeHarnessPackageJson(harnessPkg);
  if (sanitizedHarness.scripts['test:unit']) errors.push('sanitizeHarness: test:unit still present');
  if (sanitizedHarness.scripts['test:fixtures']) errors.push('sanitizeHarness: test:fixtures still present');
  if (sanitizedHarness.scripts.test !== 'npm run check:global') {
    errors.push('sanitizeHarness: test must be npm run check:global');
  }
  if (!sanitizedHarness.scripts['check:global']) {
    errors.push('sanitizeHarness: check:global missing');
  }

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

  // vendor md 语义（plan a7c3e9d1 t3）：泄漏管控只作用于 vendor 包根一层（移交 md
  // 不入发布包），src/** 源码树整树放行——contracts/README.md 是 Hylyre package-data，
  // 被排除会让下游 tree_sha256 对不上（评审 4 真件实证的静默丢包炸点）。
  const vendorHandoverMd = 'profiles/hmos-app/vendor/hylyre/downstream-harness-requests.md';
  const vendorReadme = 'profiles/hmos-app/vendor/hylyre/README.md';
  const { include: handoverIncluded } = classifyPath(vendorHandoverMd, rules);
  if (handoverIncluded) {
    errors.push('vendor handover md must be excluded by excludeGlobs');
  }
  const { include: readmeIncluded } = classifyPath(vendorReadme, rules);
  if (!readmeIncluded) {
    errors.push('vendor hylyre README must be included via includeOverride');
  }
  // plan a6c4e9f2 T6：docs/vendor/** 是开发交接材料（对外部 vendor 提的需求文档），
  // 不参与运行、不进 consumer 包。它必须由 excludeGlobs 显式排除，而不是靠运行时
  // ignore 绕过——2026-08-31 反例：该目录一个文末空行差异让 catalog/testing/设备执行全部 BLOCKER。
  for (const vendorDoc of [
    'docs/vendor/hylyre-0.5.0-requirements.md',
    'docs/vendor/nested/anything.md',
  ]) {
    const { include } = classifyPath(vendorDoc, rules);
    if (include) {
      errors.push(`docs/vendor handover material must be excluded from the consumer release: ${vendorDoc}`);
    }
  }
  // 对照：docs/ 下其余消费者文档照常入包。
  const { include: opsDocIncluded } = classifyPath('docs/operations/release-checklist.md', rules);
  if (!opsDocIncluded) {
    errors.push('consumer-facing docs outside docs/vendor must stay in the release');
  }
  for (const srcMd of [
    'profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/README.md',
    'profiles/hmos-app/vendor/hylyre/src/README.md',
  ]) {
    const { include } = classifyPath(srcMd, rules);
    if (!include) {
      errors.push(`vendor src tree md must be included (package-data / declared source): ${srcMd}`);
    }
  }
  // 评审 5 P1：maison 发布件只携带源码——vendor 下任何 whl（含遗留/未跟踪的）不得入包；
  // 运行时代码的 legacy wheel 兼容能力与此无关。
  for (const strayWheel of [
    'profiles/hmos-app/vendor/hylyre/hylyre-0.3.1-py3-none-any.whl',
    'profiles/hmos-app/vendor/hylyre/src/hylyre-9.9.9-py3-none-any.whl',
  ]) {
    const { include } = classifyPath(strayWheel, rules);
    if (include) {
      errors.push(`vendor wheel must be excluded from release pack: ${strayWheel}`);
    }
  }

  const sampleManifest = {
    schema: 1,
    hylyre_version: '0.3.0',
    integration_docs: [{ filename: 'downstream-harness-requests.md' }],
    note: 'Framework harness integration: see downstream-harness-requests.md in this directory.',
  };
  const sanitizedManifest = sanitizeVendorManifest(sampleManifest);
  if (sanitizedManifest.integration_docs) {
    errors.push('sanitizeVendorManifest must remove integration_docs');
  }
  if (sanitizedManifest.note.includes('downstream-harness-requests')) {
    errors.push('sanitizeVendorManifest must rewrite note to README.md');
  }
  if (!sanitizedManifest.note.includes('pip install <wheel-path>')) {
    errors.push('sanitizeVendorManifest schema 1 note must keep wheel wording');
  }

  const sampleSourceManifest = {
    schema: 2,
    hylyre_version: '0.3.2',
    source: { root: 'src', file_count: 1, total_bytes: 1, tree_sha256: 'x', files: [] },
    wheel: { filename: 'hylyre-0.3.2-py3-none-any.whl', sha256: 'wheel-sha', size_bytes: 1 },
    integration_docs: [{ filename: 'downstream-harness-requests.md' }],
    note: 'Plain-source release. Framework harness integration: see downstream-harness-requests.md in this directory.',
  };
  const sanitizedSourceManifest = sanitizeVendorManifest(sampleSourceManifest);
  if (sanitizedSourceManifest.integration_docs) {
    errors.push('sanitizeVendorManifest(schema2) must remove integration_docs');
  }
  if (sanitizedSourceManifest.wheel) {
    errors.push('sanitizeVendorManifest(schema2) must remove dangling wheel declaration from source-only consumer pack');
  }
  if (sanitizedSourceManifest.note.includes('downstream-harness-requests')) {
    errors.push('sanitizeVendorManifest(schema2) must rewrite note to README.md');
  }
  if (!sanitizedSourceManifest.note.includes('pip install <src-dir>')) {
    errors.push('sanitizeVendorManifest(schema2) note must keep plain-source wording (not wheel)');
  }

  return errors;
}

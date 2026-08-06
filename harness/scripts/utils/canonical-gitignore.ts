// ============================================================================
// canonical-gitignore.ts — init 约定 .gitignore SSOT（与 S3 ensure-gitignore 对齐）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { relFeaturesDir } from '../../config';

const FEATURES_DIR_DEFAULT = 'doc/features';

function normFeaturesDir(featuresDir: string): string {
  return featuresDir.replace(/\\/g, '/').replace(/\/+$/, '');
}

// --------------------------------------------------------------------------
// framework runtime 段派生自 specs/runtime-artifact-policy.json（plan e8f5a2c7
// 第六轮 P1 三方 SSOT——本文件不得另行维护 framework 运行时清单；G1 hook core 与
// framework-integrity 读同一份，三方一致性单测钉死）。
// --------------------------------------------------------------------------

export interface RuntimeArtifactPolicy {
  ignored_runtime_patterns: string[];
  /** e5d8a2c4 T4#1：ignored 目录内的**发布件**精确路径（禁 glob）；旧 policy 缺键回退 [] */
  shipped_files_in_runtime_dirs: string[];
  generated_file_patterns: string[];
  reserved_metadata_files: string[];
}

/** 读 SSOT；本模块随 harness 走，policy 与之同发布件——读取失败即抛（构建期错误，不静默）。 */
export function loadRuntimeArtifactPolicy(): RuntimeArtifactPolicy {
  const abs = path.resolve(__dirname, '..', '..', '..', 'specs', 'runtime-artifact-policy.json');
  const doc = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Partial<RuntimeArtifactPolicy>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    ignored_runtime_patterns: arr(doc.ignored_runtime_patterns),
    // 旧发布件无此键 → []（不炸；届时行为回落为整目录忽略的历史语义）
    shipped_files_in_runtime_dirs: arr(doc.shipped_files_in_runtime_dirs),
    generated_file_patterns: arr(doc.generated_file_patterns),
    reserved_metadata_files: arr(doc.reserved_metadata_files),
  };
}

// glob-lite 匹配（语义与 agents/shared/guard-framework-write-core.mjs 等价——尾 '/' 目录
// 前缀、'**' 任意层段、'*' 段内通配；跨实现一致性单测钉死，改任一侧须同步）。

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segsMatch(patSegs: string[], relSegs: string[]): boolean {
  if (patSegs.length === 0) return relSegs.length === 0;
  const [head, ...rest] = patSegs;
  if (head === '**') {
    for (let skip = 0; skip <= relSegs.length; skip += 1) {
      if (segsMatch(rest, relSegs.slice(skip))) return true;
    }
    return false;
  }
  if (relSegs.length === 0) return false;
  const re = new RegExp('^' + head.split('*').map(escapeRe).join('[^/]*') + '$');
  if (!re.test(relSegs[0])) return false;
  return segsMatch(rest, relSegs.slice(1));
}

/** rel（framework 根相对、POSIX、无首尾斜杠）是否命中 policy pattern。 */
export function matchesPolicyPattern(rel: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  const isDir = p.endsWith('/');
  const patSegs = (isDir ? p.slice(0, -1) : p).split('/').filter(Boolean);
  const relSegs = rel.split('/').filter(Boolean);
  if (isDir) {
    for (let take = patSegs.filter(s => s !== '**').length; take <= relSegs.length; take += 1) {
      if (segsMatch(patSegs, relSegs.slice(0, take))) return true;
    }
    return false;
  }
  return segsMatch(patSegs, relSegs);
}

/** rel 是否属于策略放行的运行时产物（三段任一命中）。 */
export function isPolicyAllowedPath(rel: string, policy: RuntimeArtifactPolicy): boolean {
  const all = [
    ...policy.ignored_runtime_patterns,
    ...policy.generated_file_patterns,
    ...policy.reserved_metadata_files,
  ];
  return all.some(p => matchesPolicyPattern(rel, p));
}

/**
 * SSOT ignored_runtime_patterns → gitignore framework 段（实例根相对，framework/ 前缀）。
 *
 * e5d8a2c4 T4#1（2026-08-05 宿主实锤）：目录内若有**发布件**
 * （`shipped_files_in_runtime_dirs`），必须产出四行形状——
 * ```
 * !framework/<dir>/          ← 先反忽略父目录
 * framework/<dir>/*          ← 再忽略目录内容
 * !framework/<dir>/<file>    ← 逐个放行发布件
 * ```
 * **首行不可省**：`ensureCanonicalGitignore` 只追加不删除，宿主 2026-04-25 由
 * framework-init 写入的 `framework/harness/trace/`（目录式）会一直在；而 git 硬规则是
 * **父目录被排除时 `!` 无法重新纳入其中文件**。只加后两行在空仓能过、在真实宿主仍全忽略
 * ——这正是发布件被宿主 git 静默吞掉、换机 clone 后 integrity 必 BLOCKER 的根因。
 *
 * 此前硬编码的 `GITKEEP_DIRS` 已删除：它是**派生方自己维护的第二份清单**，直接违反
 * 该 SSOT 自述的"禁止任何一方另行维护第二份列表"；两个 `.gitkeep` 并入新字段走同一路径。
 * 代价如实：reports/state 段因此多出一行 `!framework/<dir>/`，与历史 canonical 列表
 * **不再逐字节一致**（既有 equiv/断言测试随之更新）。
 */
export function frameworkRuntimeIgnorePatterns(): string[] {
  const policy = loadRuntimeArtifactPolicy();
  const out: string[] = [];
  for (const p of policy.ignored_runtime_patterns) {
    const base = `framework/${p.replace(/\/$/, '')}`;
    // 该 ignored 条目下的发布件。**只取直接子文件**（codex P2）：`<dir>/*` 会把直接
    // 子目录整体忽略，git 无法用 `!` 穿透被忽略的父目录，故 `<dir>/sub/file` 即使登记
    // 也不会生效——按简单优先收窄契约（对账套件同步断言），不实现递归祖先展开。
    const shipped = p.endsWith('/') && !p.includes('*')
      ? policy.shipped_files_in_runtime_dirs.filter(f => {
          if (!f.startsWith(p)) return false;
          const rest = f.slice(p.length);
          return rest.length > 0 && !rest.includes('/');
        })
      : [];
    if (shipped.length === 0) {
      out.push(`framework/${p}`);
      continue;
    }
    out.push(`!${base}/`, `${base}/*`, ...shipped.map(f => `!framework/${f}`));
  }
  return out;
}

/**
 * canonical .gitignore patterns（路径相对实例工程根，POSIX 斜杠）。
 * round7 skills/文案批（plan a9c4e7f1）：features_dir 派生的三条（reports/goal-runs/
 * _fidelity-cache）按实例 paths.features_dir 生成；`/doc/features/_adhoc/` **保持字面量**——
 * adhoc-canonical-paths.ts 契约固定 _adhoc 落 doc/features/_adhoc、不随 features_dir 迁移，
 * gitignore 须 ignore 文件实际落点（若未来 adhoc 契约迁移，此处随迁）。
 * framework runtime 段派生自 runtime-artifact-policy.json（见上），不在此硬编码。
 */
export function canonicalIgnorePatterns(featuresDir: string = FEATURES_DIR_DEFAULT): string[] {
  const d = normFeaturesDir(featuresDir);
  return [
    ...frameworkRuntimeIgnorePatterns(),
    'doc/catalog-staging/',
    'doc/glossary-staging/',
    '.framework-backup/',
    `${d}/*/*/reports/*`,
    `${d}/*/goal-runs/`,
    '**/.hylyre/',
    '**/tmp_hypium/',
    '/doc/app-snapshot-cache/',
    '/doc/features/_adhoc/',
    `${d}/*/ux-reference/_fidelity-cache/`,
    '/scratch/',
    'framework.local.json',
    '**/.claude/settings.local.json',
    '**/.cac/settings.local.json',
  ];
}

/** 默认布局常量导出（= canonicalIgnorePatterns() 结果；既有消费面/测试兼容） */
export const CANONICAL_IGNORE_PATTERNS: ReadonlyArray<string> = canonicalIgnorePatterns();

/** 等价覆盖映射（宽规则覆盖 canonical pattern）；features_dir 派生键随配置生成 */
export function ignoreEquivPatterns(featuresDir: string = FEATURES_DIR_DEFAULT): Record<string, string[]> {
  const d = normFeaturesDir(featuresDir);
  return {
  'framework/harness/node_modules/': [
    '**/node_modules',
    '**/node_modules/',
    'node_modules/',
    'framework/**/node_modules/',
    'framework/harness/node_modules',
    'framework/harness/node_modules/',
  ],
  'framework/harness/package-lock.json': [
    '**/package-lock.json',
    'package-lock.json',
    'framework/**/package-lock.json',
    'framework/harness/package-lock.json',
  ],
  'framework/harness/dist/': [
    'framework/harness/dist',
    'framework/harness/dist/',
    'framework/**/dist/',
  ],
  // e5d8a2c4 T4#1：含发布件的 ignored 目录改出四行形状——反忽略父目录行也需 equiv 键
  '!framework/harness/reports/': ['!framework/harness/reports/', '!framework/harness/reports'],
  'framework/harness/reports/*': ['framework/harness/reports/*'],
  '!framework/harness/reports/.gitkeep': ['!framework/harness/reports/.gitkeep'],
  '!framework/harness/trace/': ['!framework/harness/trace/', '!framework/harness/trace'],
  'framework/harness/trace/*': ['framework/harness/trace/*'],
  '!framework/harness/trace/trace.schema.json': ['!framework/harness/trace/trace.schema.json'],
  '!framework/harness/trace/gap-notes.template.md': ['!framework/harness/trace/gap-notes.template.md'],
  '!framework/harness/state/': ['!framework/harness/state/', '!framework/harness/state'],
  'framework/harness/state/*': [
    'framework/harness/state/*',
    'framework/harness/state',
    'framework/harness/state/',
  ],
  '!framework/harness/state/.gitkeep': ['!framework/harness/state/.gitkeep'],
  'framework/harness/**/ohosTest/': [
    'framework/harness/**/ohosTest/',
    'framework/harness/**/ohosTest',
  ],
  'framework/harness/**/test/dag/': [
    'framework/harness/**/test/dag/',
    'framework/harness/**/test/dag',
  ],
  'framework/harness/decision.json': ['framework/harness/decision.json'],
  'framework/harness/context.json': ['framework/harness/context.json'],
  'framework/harness/init-decision.json': ['framework/harness/init-decision.json'],
  'framework/harness/init-context.json': ['framework/harness/init-context.json'],
  'doc/catalog-staging/': ['doc/catalog-staging/', 'doc/catalog-staging', '**/catalog-staging/'],
  'doc/glossary-staging/': ['doc/glossary-staging/', 'doc/glossary-staging', '**/glossary-staging/'],
  '.framework-backup/': [
    '.framework-backup',
    '.framework-backup/',
    '**/.framework-backup/',
  ],
  [`${d}/*/*/reports/*`]: [
    `${d}/*/*/reports/*`,
    `${d}/*/*/reports`,
    `${d}/*/*/reports/`,
  ],
  [`${d}/*/goal-runs/`]: [
    `${d}/*/goal-runs/`,
    `${d}/*/goal-runs`,
    `${d}/**/goal-runs/`,
  ],
  '**/.hylyre/': ['.hylyre/', '/.hylyre/', '/**/.hylyre/', '**/.hylyre/'],
  '**/tmp_hypium/': ['tmp_hypium/', '/tmp_hypium/', '/**/tmp_hypium/', '**/tmp_hypium/'],
  '/doc/app-snapshot-cache/': [
    'doc/app-snapshot-cache/',
    'doc/app-snapshot-cache',
    '/**/app-snapshot-cache/',
    '/doc/app-snapshot-cache/',
  ],
  '/doc/features/_adhoc/': ['doc/features/_adhoc/', 'doc/features/_adhoc', '/doc/features/_adhoc/'],
  '/scratch/': ['/scratch/', 'scratch/', 'scratch'],
  'framework.local.json': ['framework.local.json'],
  '**/.claude/settings.local.json': [
    '.claude/settings.local.json',
    '**/.claude/settings.local.json',
    '/.claude/settings.local.json',
  ],
  // codeagent（plan c7a9e2f4）：.cac 结构与 .claude 完全一致，个人 settings 同规则
  '**/.cac/settings.local.json': [
    '.cac/settings.local.json',
    '**/.cac/settings.local.json',
    '/.cac/settings.local.json',
  ],
  };
}

/** 默认布局常量导出（= ignoreEquivPatterns() 结果；既有消费面/测试兼容） */
export const IGNORE_EQUIV_PATTERNS: Record<string, string[]> = ignoreEquivPatterns();

interface CanonicalSection {
  header: string;
  patterns: readonly string[];
}

function canonicalSections(featuresDir: string = FEATURES_DIR_DEFAULT): readonly CanonicalSection[] {
  const d = normFeaturesDir(featuresDir);
  return [
    {
      header: '# Framework runtime artifacts (managed by /framework-init)',
      // 派生自 specs/runtime-artifact-policy.json（三方 SSOT），不在此硬编码
      patterns: frameworkRuntimeIgnorePatterns(),
    },
    {
      header: '# catalog-bootstrap staging: catalog / glossary drafts before merge into SSOT',
      patterns: ['doc/catalog-staging/', 'doc/glossary-staging/'],
    },
    {
      header: '# Framework auto-overwrite backup (managed by check-init / framework-init)',
      patterns: ['.framework-backup/'],
    },
    {
      header: '# Feature-phase harness reports (paths.reports_dir_pattern)',
      patterns: [
        `${d}/*/*/reports/*`,
        `${d}/*/goal-runs/`,
        `${d}/*/ux-reference/_fidelity-cache/`,
      ],
    },
    {
      header: '# device-testing device-testing local artifacts (profile-dependent; dirs may not exist yet)',
      patterns: ['**/.hylyre/', '**/tmp_hypium/', '/doc/app-snapshot-cache/', '/doc/features/_adhoc/'],
    },
    {
      header: '# Agent scratch: temporary diagnostic scripts (G4, plan e8f5a2c7 — never inside framework/)',
      patterns: ['/scratch/'],
    },
    {
      header: '# Personal / local agent settings (per developer, gitignored)',
      patterns: ['framework.local.json', '**/.claude/settings.local.json', '**/.cac/settings.local.json'],
    },
  ];
}

export interface GitignoreEnsureResult {
  path: '.gitignore';
  created: boolean;
  added: string[];
  skipped: boolean;
}

/** 移除注释行 / 空白行；保留模式（含 ! 反向规则）。 */
export function parseGitignoreLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
}

export function patternIsCovered(
  canonical: string,
  lines: string[],
  equivMap: Record<string, string[]> = IGNORE_EQUIV_PATTERNS,
): boolean {
  const equiv = equivMap[canonical] ?? [canonical];
  return equiv.some(p => lines.includes(p));
}

export function listMissingCanonicalPatterns(
  lines: string[],
  featuresDir: string = FEATURES_DIR_DEFAULT,
): string[] {
  const missing: string[] = [];
  const equivMap = ignoreEquivPatterns(featuresDir);
  for (const p of canonicalIgnorePatterns(featuresDir)) {
    if (!patternIsCovered(p, lines, equivMap)) {
      missing.push(p);
    }
  }
  return missing;
}

/** 非 BLOCKER：疑似手抄错误路径（如 `/harness/reports/*` 缺 `framework/` 前缀）。 */
export function collectGitignoreAdvisories(text: string): string[] {
  const advisories: string[] = [];
  const rawLines = text.split(/\r?\n/);
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\/?harness\/reports/i.test(line) && !/framework\/harness\/reports/i.test(line)) {
      advisories.push(
        `疑似错误忽略路径「${line}」：canonical 应为 framework/harness/reports/*（非 /harness/reports/*）`,
      );
    }
    if (line === '/reports/' || line === 'reports/') {
      advisories.push(
        `根目录「${line}」与 framework/harness/reports/* 不同；若仅为 Hylyre 根 cwd 日志可保留，但勿当作 harness 报告目录`,
      );
    }
  }
  return advisories;
}

function buildFullCanonicalBlock(featuresDir: string = FEATURES_DIR_DEFAULT): string {
  const parts: string[] = [];
  for (const section of canonicalSections(featuresDir)) {
    parts.push(section.header);
    for (const p of section.patterns) {
      parts.push(p);
    }
    parts.push('');
  }
  return parts.join('\n').replace(/\n+$/, '\n');
}

function buildAppendBlock(missingSet: Set<string>, featuresDir: string = FEATURES_DIR_DEFAULT): string {
  const parts: string[] = [];
  for (const section of canonicalSections(featuresDir)) {
    const toAdd = section.patterns.filter(p => missingSet.has(p));
    if (toAdd.length === 0) continue;
    parts.push(section.header);
    for (const p of toAdd) {
      parts.push(p);
    }
    parts.push('');
  }
  return parts.join('\n').replace(/\n+$/, '\n');
}

function ensureTrailingNewline(text: string): string {
  if (text.length === 0) return '';
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * 幂等补齐实例工程根 `.gitignore` 的 init canonical 规则。
 * 只追加缺失项；不删除、不重排用户已有内容。
 */
export function ensureCanonicalGitignore(projectRoot: string): GitignoreEnsureResult {
  const rel = '.gitignore' as const;
  const targetAbs = path.join(projectRoot, rel);

  if (process.env.CHECK_INIT_SKIP_GITIGNORE_SYNC === '1') {
    return { path: rel, created: false, added: [], skipped: true };
  }

  // features_dir 派生 pattern 随实例配置（framework.config.json 缺失时 config 回落默认
  // doc/features——CREATE 模式行为不变）；调用方（init-task-executor / check-init）零改动。
  const featuresDir = relFeaturesDir(projectRoot);
  const existing = fs.existsSync(targetAbs) ? fs.readFileSync(targetAbs, 'utf-8') : null;
  const lines = parseGitignoreLines(existing ?? '');
  const missing = listMissingCanonicalPatterns(lines, featuresDir);

  if (missing.length === 0) {
    return { path: rel, created: false, added: [], skipped: false };
  }

  const missingSet = new Set(missing);
  const added = [...missing];

  if (existing === null) {
    fs.writeFileSync(targetAbs, buildFullCanonicalBlock(featuresDir), 'utf-8');
    return { path: rel, created: true, added, skipped: false };
  }

  const prefix = ensureTrailingNewline(existing);
  const append = buildAppendBlock(missingSet, featuresDir);
  const separator = prefix.length > 0 && !prefix.endsWith('\n\n') ? '\n' : '';
  fs.writeFileSync(targetAbs, `${prefix}${separator}${append}`, 'utf-8');
  return { path: rel, created: false, added, skipped: false };
}

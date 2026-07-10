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

/** SSOT 目录条目中须保留 .gitkeep 的目录（gitignore 关心"占位文件要跟踪"，匹配语义不关心）。 */
const GITKEEP_DIRS = new Set(['harness/reports/', 'harness/state/']);

/**
 * SSOT ignored_runtime_patterns → gitignore framework 段（实例根相对，framework/ 前缀）。
 * 目录条目默认 `framework/<dir>`；GITKEEP_DIRS 展开为 `<dir>/*` + `!<dir>/.gitkeep` 对
 * （保持与历史 canonical 列表逐字节一致——既有 equiv/断言测试零改动）。
 */
export function frameworkRuntimeIgnorePatterns(): string[] {
  const out: string[] = [];
  for (const p of loadRuntimeArtifactPolicy().ignored_runtime_patterns) {
    if (GITKEEP_DIRS.has(p)) {
      const base = `framework/${p.replace(/\/$/, '')}`;
      out.push(`${base}/*`, `!${base}/.gitkeep`);
    } else {
      out.push(`framework/${p}`);
    }
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
  'framework/harness/reports/*': ['framework/harness/reports/*'],
  '!framework/harness/reports/.gitkeep': ['!framework/harness/reports/.gitkeep'],
  'framework/harness/trace/': [
    'framework/harness/trace',
    'framework/harness/trace/',
  ],
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
      patterns: ['framework.local.json', '**/.claude/settings.local.json'],
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

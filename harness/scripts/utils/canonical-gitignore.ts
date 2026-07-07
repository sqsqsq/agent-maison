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

/**
 * canonical .gitignore patterns（路径相对实例工程根，POSIX 斜杠）。
 * round7 skills/文案批（plan a9c4e7f1）：features_dir 派生的三条（reports/goal-runs/
 * _fidelity-cache）按实例 paths.features_dir 生成；`/doc/features/_adhoc/` **保持字面量**——
 * adhoc-canonical-paths.ts 契约固定 _adhoc 落 doc/features/_adhoc、不随 features_dir 迁移，
 * gitignore 须 ignore 文件实际落点（若未来 adhoc 契约迁移，此处随迁）。
 */
export function canonicalIgnorePatterns(featuresDir: string = FEATURES_DIR_DEFAULT): string[] {
  const d = normFeaturesDir(featuresDir);
  return [
    'framework/harness/node_modules/',
    'framework/harness/dist/',
    'framework/harness/reports/*',
    '!framework/harness/reports/.gitkeep',
    'framework/harness/trace/',
    'framework/harness/package-lock.json',
    'framework/harness/state/*',
    '!framework/harness/state/.gitkeep',
    'framework/harness/**/ohosTest/',
    'framework/harness/**/test/dag/',
    'framework/harness/decision.json',
    'framework/harness/context.json',
    'framework/harness/init-decision.json',
    'framework/harness/init-context.json',
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
      patterns: [
        'framework/harness/node_modules/',
        'framework/harness/dist/',
        'framework/harness/reports/*',
        '!framework/harness/reports/.gitkeep',
        'framework/harness/trace/',
        'framework/harness/package-lock.json',
        'framework/harness/state/*',
        '!framework/harness/state/.gitkeep',
        'framework/harness/**/ohosTest/',
        'framework/harness/**/test/dag/',
        'framework/harness/decision.json',
        'framework/harness/context.json',
        'framework/harness/init-decision.json',
        'framework/harness/init-context.json',
      ],
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

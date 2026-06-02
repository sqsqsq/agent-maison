// ============================================================================
// canonical-gitignore.ts — init 约定 .gitignore SSOT（与 S3 ensure-gitignore 对齐）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

/** canonical .gitignore patterns（路径相对实例工程根，POSIX 斜杠） */
export const CANONICAL_IGNORE_PATTERNS: ReadonlyArray<string> = [
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
  'doc/catalog-staging/',
  'doc/glossary-staging/',
  '.framework-backup/',
  'doc/features/*/*/reports/*',
  '**/.hylyre/',
  '**/tmp_hypium/',
  '/doc/app-snapshot-cache/',
  '/doc/features/_adhoc/',
  'framework.local.json',
];

/** 等价覆盖映射（宽规则覆盖 canonical pattern） */
export const IGNORE_EQUIV_PATTERNS: Record<string, string[]> = {
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
  'doc/catalog-staging/': ['doc/catalog-staging/', 'doc/catalog-staging', '**/catalog-staging/'],
  'doc/glossary-staging/': ['doc/glossary-staging/', 'doc/glossary-staging', '**/glossary-staging/'],
  '.framework-backup/': [
    '.framework-backup',
    '.framework-backup/',
    '**/.framework-backup/',
  ],
  'doc/features/*/*/reports/*': [
    'doc/features/*/*/reports/*',
    'doc/features/*/*/reports',
    'doc/features/*/*/reports/',
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
};

interface CanonicalSection {
  header: string;
  patterns: readonly string[];
}

const CANONICAL_SECTIONS: readonly CanonicalSection[] = [
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
    ],
  },
  {
    header: '# Skill 0 staging: catalog / glossary drafts before merge into SSOT',
    patterns: ['doc/catalog-staging/', 'doc/glossary-staging/'],
  },
  {
    header: '# Framework auto-overwrite backup (managed by check-init / Skill 00)',
    patterns: ['.framework-backup/'],
  },
  {
    header: '# Feature-phase harness reports (paths.reports_dir_pattern)',
    patterns: ['doc/features/*/*/reports/*'],
  },
  {
    header: '# Skill 6 device-testing local artifacts (profile-dependent; dirs may not exist yet)',
    patterns: ['**/.hylyre/', '**/tmp_hypium/', '/doc/app-snapshot-cache/', '/doc/features/_adhoc/'],
  },
  {
    header: '# Personal framework settings (per developer, gitignored)',
    patterns: ['framework.local.json'],
  },
];

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

export function patternIsCovered(canonical: string, lines: string[]): boolean {
  const equiv = IGNORE_EQUIV_PATTERNS[canonical] ?? [canonical];
  return equiv.some(p => lines.includes(p));
}

export function listMissingCanonicalPatterns(lines: string[]): string[] {
  const missing: string[] = [];
  for (const p of CANONICAL_IGNORE_PATTERNS) {
    if (!patternIsCovered(p, lines)) {
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

function buildFullCanonicalBlock(): string {
  const parts: string[] = [];
  for (const section of CANONICAL_SECTIONS) {
    parts.push(section.header);
    for (const p of section.patterns) {
      parts.push(p);
    }
    parts.push('');
  }
  return parts.join('\n').replace(/\n+$/, '\n');
}

function buildAppendBlock(missingSet: Set<string>): string {
  const parts: string[] = [];
  for (const section of CANONICAL_SECTIONS) {
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

  const existing = fs.existsSync(targetAbs) ? fs.readFileSync(targetAbs, 'utf-8') : null;
  const lines = parseGitignoreLines(existing ?? '');
  const missing = listMissingCanonicalPatterns(lines);

  if (missing.length === 0) {
    return { path: rel, created: false, added: [], skipped: false };
  }

  const missingSet = new Set(missing);
  const added = [...missing];

  if (existing === null) {
    fs.writeFileSync(targetAbs, buildFullCanonicalBlock(), 'utf-8');
    return { path: rel, created: true, added, skipped: false };
  }

  const prefix = ensureTrailingNewline(existing);
  const append = buildAppendBlock(missingSet);
  const separator = prefix.length > 0 && !prefix.endsWith('\n\n') ? '\n' : '';
  fs.writeFileSync(targetAbs, `${prefix}${separator}${append}`, 'utf-8');
  return { path: rel, created: false, added, skipped: false };
}

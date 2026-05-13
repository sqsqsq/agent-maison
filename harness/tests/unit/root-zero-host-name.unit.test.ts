// ============================================================================
// 零宿主专名防回退闸门（plan：rg-zero-host-name-assertion）
// 扫描根 check-coding / check-ut / framework/skills/**/SKILL.md
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HARNESS_SCRIPTS = path.join(REPO_ROOT, 'framework', 'harness', 'scripts');
const SKILLS_ROOT = path.join(REPO_ROOT, 'framework', 'skills');

/** 词边界 / 精确 token，避免 legacy 规则 id（如 ut_hvigor_build）中的子串误伤 */
const BANNED_LINE_REGEXPS: readonly RegExp[] = [
  /\bhmos-app\b/,
  /\bArkUI\b/,
  /\bhvigor\b/,
  /\bDevEco\b/,
  /\bohpm\b/,
  /\bHypium\b/,
  /\$r\(/,
  /\$r\b/,
  /\bNavDestination\b/,
  /@Entry\b/,
  /@Prop\b/,
  /main_pages\.json/,
  /build-profile\.json5/,
  /oh-package\.json5/,
  /\.ets\b/,
];

function listFrameworkSkillMdFiles(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(SKILLS_ROOT)) return out;
  for (const ent of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(SKILLS_ROOT, ent.name, 'SKILL.md');
    if (fs.existsSync(p)) out.push(p);
  }
  return out.sort();
}

function lineIsWhitelisted(fileLabel: string, line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return true;

  if (/LEGACY_(CODING_COMPILE|UT_COMPILE|UT_RUN)_ID/.test(line)) return true;

  if (line.includes('framework/profiles/hmos-app/harness/')) {
    if (fileLabel.endsWith('check-coding.ts') || fileLabel.endsWith('check-ut.ts')) return true;
  }

  return false;
}

function lineHitsBanned(line: string): string[] {
  const hits: string[] = [];
  for (const re of BANNED_LINE_REGEXPS) {
    const r = new RegExp(re.source, re.flags);
    if (r.test(line)) hits.push(re.source);
  }
  return hits;
}

function scanFile(absPath: string, shortLabel: string): string[] {
  const text = fs.readFileSync(absPath, 'utf-8');
  const lines = text.split(/\r?\n/);
  const violations: string[] = [];
  lines.forEach((line, idx) => {
    if (lineIsWhitelisted(shortLabel, line)) return;
    const hits = lineHitsBanned(line);
    if (hits.length > 0) {
      violations.push(`${shortLabel}:${idx + 1}: [${hits.join(',')}] ${line.trim().slice(0, 120)}`);
    }
  });
  return violations;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'check-coding.ts / check-ut.ts / framework/skills/**/SKILL.md 不含 plan 列出的宿主专名（白名单行除外）',
    run: () => {
      const targets: string[] = [
        path.join(HARNESS_SCRIPTS, 'check-coding.ts'),
        path.join(HARNESS_SCRIPTS, 'check-ut.ts'),
        ...listFrameworkSkillMdFiles(),
      ];
      const all: string[] = [];
      for (const fp of targets) {
        const label = path.relative(REPO_ROOT, fp).replace(/\\/g, '/');
        all.push(...scanFile(fp, label));
      }
      assert.strictEqual(
        all.length,
        0,
        `发现 ${all.length} 处疑似宿主专名泄漏，请先中性化或显式扩白名单：\n${all.join('\n')}`,
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}

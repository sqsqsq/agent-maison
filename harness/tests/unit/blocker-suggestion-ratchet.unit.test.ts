// ============================================================================
// blocker-suggestion-ratchet.unit.test.ts — BLOCKER 缺 suggestion 存量 ratchet 元门禁
// （t1a③，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 三层防线中的第三层（存量收紧）：
//   第一层：report-generator.resolveEffectiveSuggestion 运行时兜底（四出口一致）；
//   第二层：check-result-factory 对新增/迁移 checker 强制 suggestion 必填；
//   第三层（本文件）：扫描 harness/scripts/** 与 profiles/*/harness/**（剔 tests/）中
//   **显式** `severity: 'BLOCKER'` + `status: 'FAIL'` 对象字面量缺 suggestion 的旧构造，
//   以基线 allowlist 锁死——**只减不增**：
//     · 不在 allowlist 的文件出现违规 → FAIL（新代码必须走 factory 或自带 suggestion）；
//     · 在 allowlist 的文件违规数超基线 → FAIL；
//     · 低于基线 → PASS（欢迎顺手清债；清零后可从 allowlist 删行）。
// 动态 severity/status、spread、helper 返回值不在扫描射程（heuristic 边界）——
// 它们由第一层运行时兜底覆盖，本门禁只针对可确定性识别的显式旧构造。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// 基线 allowlist（2026-07-16 实施时点，25 文件 / 125 处显式旧构造）——只减不增。
// 清零某文件后请把对应行删除；新增行 = 违规，需改用 check-result-factory 或补 suggestion。
// ---------------------------------------------------------------------------
const BASELINE_ALLOWLIST: Record<string, number> = {
  'harness/scripts/check-catalog.ts': 2,
  'harness/scripts/check-change.ts': 1,
  'harness/scripts/check-docs.ts': 1,
  'harness/scripts/check-exit.ts': 6,
  'harness/scripts/check-extensions.ts': 1,
  'harness/scripts/check-init.ts': 5,
  'harness/scripts/check-module-graph.ts': 2,
  'harness/scripts/check-plan.ts': 13,
  'harness/scripts/check-review.ts': 5,
  'harness/scripts/check-spec.ts': 17,
  'harness/scripts/check-testing.ts': 19,
  'harness/scripts/check-ut.ts': 7,
  'harness/scripts/utils/check-acceptance.ts': 2,
  'harness/scripts/utils/context-exploration.ts': 12,
  'harness/scripts/utils/context-facts.ts': 6,
  'harness/scripts/utils/correction-commands.ts': 6,
  'harness/scripts/utils/fidelity-shared.ts': 3,
  'harness/scripts/utils/p0-semantic-gates.ts': 2,
  'harness/scripts/utils/report-generator.ts': 1,
  'harness/scripts/utils/ui-spec-shared.ts': 2,
  'profiles/hmos-app/harness/asset-crop-validation.ts': 1,
  'profiles/hmos-app/harness/coding-host-rules.ts': 2,
  'profiles/hmos-app/harness/spec-visual-handoff-check.ts': 4,
  'profiles/hmos-app/harness/ut-host-impl.ts': 2,
  'profiles/hmos-app/harness/visual-diff-check.ts': 3,
};

// ---------------------------------------------------------------------------
// 扫描器（确定性 heuristic；与基线生成脚本同一算法）
// ---------------------------------------------------------------------------

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'tests' || ent.name === 'node_modules') continue;
      out.push(...listTsFiles(abs));
    } else if (ent.isFile() && ent.name.endsWith('.ts')) {
      out.push(abs);
    }
  }
  return out;
}

function scanRoots(): string[] {
  const roots = [path.join(FRAMEWORK_ROOT, 'harness', 'scripts')];
  const profilesDir = path.join(FRAMEWORK_ROOT, 'profiles');
  if (fs.existsSync(profilesDir)) {
    for (const ent of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const h = path.join(profilesDir, ent.name, 'harness');
      if (fs.existsSync(h)) roots.push(h);
    }
  }
  return roots;
}

/** 从 severity 出现位置向两侧做括号平衡，取出包围它的对象字面量文本 */
function enclosingLiteral(src: string, idx: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    const ch = src[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

export function countExplicitBlockerFailWithoutSuggestion(src: string): number {
  const sevRe = /severity:\s*'BLOCKER'/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = sevRe.exec(src)) !== null) {
    const lit = enclosingLiteral(src, m.index);
    if (!lit) continue;
    if (!/status:\s*'FAIL'/.test(lit)) continue; // 只锁显式 FAIL 字面量（PASS/SKIP/动态不在射程）
    if (/\bsuggestion\s*[:,}]/.test(lit)) continue; // 冒号=显式；逗号/右括=shorthand
    n++;
  }
  return n;
}

function scanAll(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const root of scanRoots()) {
    for (const abs of listTsFiles(root)) {
      const n = countExplicitBlockerFailWithoutSuggestion(fs.readFileSync(abs, 'utf-8'));
      if (n > 0) {
        counts[path.relative(FRAMEWORK_ROOT, abs).replace(/\\/g, '/')] = n;
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

const cases: Array<{ name: string; run: () => void }> = [
  {
    // 防退化自检：扫描器必须能识别已知反模式、放过合法形态——否则元门禁退化为空门。
    name: '自检：识别缺 suggestion 的显式 BLOCKER+FAIL；放过带 suggestion/shorthand/PASS 形态',
    run: () => {
      const bad = `
        results.push({
          id: 'x', category: 'structure', description: 'd',
          severity: 'BLOCKER', status: 'FAIL',
          details: 'boom',
        });`;
      assert(countExplicitBlockerFailWithoutSuggestion(bad) === 1, '应识别出 1 处违规');

      const goodExplicit = `
        results.push({
          id: 'x', category: 'structure', description: 'd',
          severity: 'BLOCKER', status: 'FAIL',
          details: 'boom',
          suggestion: 'fix it like this',
        });`;
      assert(countExplicitBlockerFailWithoutSuggestion(goodExplicit) === 0, '显式 suggestion 应放过');

      const goodShorthand = `
        return {
          ...rest,
          severity: 'BLOCKER', status: 'FAIL',
          suggestion,
        };`;
      assert(countExplicitBlockerFailWithoutSuggestion(goodShorthand) === 0, 'shorthand suggestion 应放过');

      const passLiteral = `
        results.push({ id: 'x', category: 'structure', description: 'd', severity: 'BLOCKER', status: 'PASS', details: 'ok' });`;
      assert(countExplicitBlockerFailWithoutSuggestion(passLiteral) === 0, 'PASS 字面量不在射程');
    },
  },
  {
    name: '元门禁：显式 BLOCKER+FAIL 缺 suggestion 只减不增（allowlist ratchet）',
    run: () => {
      const current = scanAll();
      const problems: string[] = [];
      for (const [file, count] of Object.entries(current)) {
        const allowed = BASELINE_ALLOWLIST[file];
        if (allowed === undefined) {
          problems.push(
            `${file}: ${count} 处新违规（不在基线 allowlist）——新增/迁移 checker 请用 ` +
              `utils/check-result-factory.ts 的 blockerFail()（suggestion 类型必填）或显式补 suggestion。`,
          );
        } else if (count > allowed) {
          problems.push(`${file}: ${count} 处 > 基线 ${allowed}——存量只许减不许增。`);
        }
      }
      assert(
        problems.length === 0,
        `BLOCKER 缺 suggestion ratchet 违规：\n${problems.join('\n')}`,
      );
    },
  },
  {
    name: '基线卫生：allowlist 中已清零的文件应删行（提示性，不阻断新增）',
    run: () => {
      const current = scanAll();
      const stale = Object.keys(BASELINE_ALLOWLIST).filter(f => !(f in current));
      // 已清零仍留在 allowlist 只是卫生问题；用断言消息提示但不视为失败——
      // 除非文件已不存在（说明基线锚点漂移，必须整理）。
      const gone = stale.filter(f => !fs.existsSync(path.join(FRAMEWORK_ROOT, f)));
      assert(
        gone.length === 0,
        `allowlist 中以下文件已不存在，请整理基线：\n${gone.join('\n')}`,
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}

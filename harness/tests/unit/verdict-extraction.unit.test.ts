// ============================================================================
// verdict-extraction.unit.test.ts
// ============================================================================
// P0-A：extractDeclaredVerdict 声明式裁决提取的行为回归（锚定 + 最长优先 + 诱饵排除）。
// P0-C：元门禁——扫 harness/scripts/** 禁止重新引入"裸子串裁决"反模式
//        （verdicts.find/some(v => x.includes(v))），强制走 extractDeclaredVerdict。
//
// 背景：'通过' 是 '不通过'/'有条件通过' 的子串、'达标' 是 '不达标'/'有条件达标' 的子串，
//       且报告模板会枚举全部裁决词，旧的整段 includes 必误读。详见 plan c3f08a21。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { extractDeclaredVerdict } from '../../scripts/utils/markdown-parser';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

const REVIEW = ['有条件通过', '不通过', '通过'];
const TESTING = ['有条件达标', '不达标', '达标'];

// 完整模板污染场景：结论段同时含三个裁决词（引导语 + 判定规则 + 下一步建议）——
// 与真实 review-report-template.md 结构一致，锁定"只有声明行被采纳"。
function reviewSection(verdict: string): string {
  return [
    '> harness 只解析下方"审查结论"声明行，且须恰好填一个裁决词。可选值（三选一）：通过、有条件通过、不通过 —— 含 BLOCKER 必判不通过；无 BLOCKER 有 MAJOR 判有条件通过；均无判通过。',
    '',
    `**审查结论**: ${verdict}`,
    '',
    '<结论说明>',
    '',
    '**判定依据**:',
    '- BLOCKER 数量: 2',
    '- MAJOR 数量: 1',
    '- 判定规则：存在 BLOCKER → 必须判"不通过"；无 BLOCKER 但有 MAJOR → 判"有条件通过"；均无 → 判"通过"',
    '',
    '**下一步建议**（按上方审查结论执行）:',
    '- 若结论为"不通过"：修复所有 BLOCKER 后重新审查',
    '- 若结论为"有条件通过"：修复 MAJOR 后重新审查',
    '- 若结论为"通过"：可进入下一阶段',
  ].join('\n');
}

function testingSection(verdict: string): string {
  return [
    `**测试结论**: ${verdict}`,
    '',
    '<结论说明>',
    '',
    '**下一步建议**（按上方测试结论执行）:',
    '- 若结论为"不达标"：修复所有 BLOCKER 和 P0 失败用例后重新测试',
    '- 若结论为"有条件达标"：修复 MAJOR 缺陷后回归测试',
    '- 若结论为"达标"：功能模块验收完成，可发布',
  ].join('\n');
}

const cases: Array<{ name: string; run: () => void }> = [
  // ---------------- P0-A：行为回归 ----------------
  {
    name: 'review 声明行=不通过（段内三词污染）→ 不通过',
    run: () => assertEq(extractDeclaredVerdict(reviewSection('不通过'), REVIEW).verdict, '不通过', '不通过'),
  },
  {
    name: 'review 声明行=有条件通过 → 有条件通过（不被最短子串"通过"截胡）',
    run: () => assertEq(extractDeclaredVerdict(reviewSection('有条件通过'), REVIEW).verdict, '有条件通过', '有条件通过'),
  },
  {
    name: 'review 声明行=通过 → 通过',
    run: () => assertEq(extractDeclaredVerdict(reviewSection('通过'), REVIEW).verdict, '通过', '通过'),
  },
  {
    name: 'review 缺可机读声明行（仅散文/裸词）→ null',
    run: () => {
      const section = ['## 结论', '通过', '本次审查无重大问题。'].join('\n');
      assertEq(extractDeclaredVerdict(section, REVIEW).verdict, null, '缺声明行');
    },
  },
  {
    name: 'review 未填充模板声明行（三词全在）→ null（歧义拒绝，不静默取有条件通过）',
    run: () => {
      const section = ['**审查结论**: 通过 / 有条件通过 / 不通过　← 三选一', '<结论说明>'].join('\n');
      assertEq(extractDeclaredVerdict(section, REVIEW).verdict, null, '歧义应判 null');
    },
  },
  {
    name: 'review 占位符未填（无裁决词）→ null',
    run: () => assertEq(
      extractDeclaredVerdict('**审查结论**: <填写单一裁决，删除本占位>', REVIEW).verdict,
      null,
      '占位未填',
    ),
  },
  {
    name: 'testing 未填充声明行（三词全在）→ null（歧义拒绝）',
    run: () => assertEq(
      extractDeclaredVerdict('**测试结论**: 达标 / 有条件达标 / 不达标', TESTING).verdict,
      null,
      'testing 歧义',
    ),
  },
  {
    name: 'review「判定依据:」诱饵行不被误锚（只有诱饵块含token时返回 null）',
    run: () => {
      const section = [
        '<结论说明>',
        '**判定依据**:',
        '- 判定规则：存在 BLOCKER → 必须判"不通过"',
      ].join('\n');
      // 「判定依据」「判定规则」都是诱饵，'通过'/'不通过' 只出现在诱饵块 → 不应误锚
      assertEq(extractDeclaredVerdict(section, REVIEW).verdict, null, '诱饵不误锚');
    },
  },
  {
    name: 'review 兜底 label「判定:」可锚（非诱饵）',
    run: () => assertEq(extractDeclaredVerdict('判定: 不通过', REVIEW).verdict, '不通过', '判定兜底'),
  },
  {
    name: 'testing 声明行=达标（下一步建议含"若结论为不达标"）→ 达标（旧实现会误取不达标）',
    run: () => assertEq(extractDeclaredVerdict(testingSection('达标'), TESTING).verdict, '达标', '达标'),
  },
  {
    name: 'testing 声明行=不达标 → 不达标',
    run: () => assertEq(extractDeclaredVerdict(testingSection('不达标'), TESTING).verdict, '不达标', '不达标'),
  },
  {
    name: 'testing 缺声明行 → null',
    run: () => assertEq(extractDeclaredVerdict('测试无明确结论', TESTING).verdict, null, 'testing 缺声明'),
  },

  // ---------------- P0-C：元门禁源码扫描 ----------------
  {
    name: '元门禁：harness/scripts/** 无裸子串裁决反模式（唯一入口=extractDeclaredVerdict）',
    run: () => {
      const violations = scanForBareVerdictSubstringMatch();
      if (violations.length > 0) {
        throw new Error(
          '发现裸子串裁决反模式（请改用 extractDeclaredVerdict）：\n' +
            violations.map(v => `  - ${v}`).join('\n'),
        );
      }
    },
  },
  {
    name: '元门禁自检：能识别已知反模式、放过合法用法（防 guard 退化为空门）',
    run: () => {
      // 已知反模式（旧 check-review 写法）必须被识别为违规。
      const bad = 'const foundVerdict = verdicts.find(v => section.includes(v));';
      const mBad = bad.match(FIND_SOME_INCLUDES_RE);
      assertTrue(mBad !== null, '应匹配 find/some(param => X.includes(param)) 形态');
      assertTrue(/verdict|conclusion/i.test(mBad![1]), '受体 verdicts 应判为裁决语义');

      // 合法列名匹配：shape 命中但非裁决语义 → 不应被判违规。
      const ok = 'const found = alternatives.some(alt => h.includes(alt));';
      const mOk = ok.match(FIND_SOME_INCLUDES_RE);
      assertTrue(mOk !== null, 'shape 命中');
      assertTrue(
        !/verdict|conclusion/i.test(mOk![1]) && !VERDICT_TOKEN_RE.test(ok),
        '合法列名匹配不应触发裁决语义判定',
      );

      // 方向相反的合法用法（includes 实参是字面量，非回调参数）→ 形态①不该命中。
      const reversed = "mismatches.some(m => m.includes('trace.outcome'))";
      assertTrue(reversed.match(FIND_SOME_INCLUDES_RE) === null, 'includes(非裁决字面量) 不应命中形态①');

      // 形态②：顺序 if 字面量裁决 includes（testing-trace-gates 旧 bug 形态）必须被识别。
      assertTrue(
        LITERAL_VERDICT_INCLUDES_RE.test("if (section.includes('不达标')) return '不达标';"),
        '应识别 includes(裁决字面量) 形态②',
      );
      // 非裁决字面量的 includes 不该命中形态②。
      assertTrue(
        !LITERAL_VERDICT_INCLUDES_RE.test("path.includes('trace.outcome')"),
        'includes(非裁决字面量) 不应命中形态②',
      );
    },
  },
];

// ---------------------------------------------------------------------------
// 元门禁实现：收窄到"裁决语义"，避免误伤 20+ 处合法 includes（列名/路径/heading）
// ---------------------------------------------------------------------------

// 唯一允许出现 `verdicts.find(x => line.includes(x))` 的规范实现。
const ALLOWLIST_REL = [path.join('utils', 'markdown-parser.ts')];

const VERDICT_TOKEN_RE = /(有条件通过|不通过|通过|有条件达标|不达标|达标)/;
// 形态①：RECEIVER.find|some(P => X.includes(P))——includes 的实参恰是回调参数本身，
// 即"X 是否包含候选裁决词 P"。方向相反的合法用法（m => m.includes('字面量')、
// alt => h.includes(alt) 的列名匹配）由此 + 下方"裁决语义"双重收窄排除。
const FIND_SOME_INCLUDES_RE =
  /([A-Za-z_$][\w$]*)\s*\.\s*(find|some)\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*[\w.$]+\s*\.\s*includes\s*\(\s*\3\s*\)/;
// 形态②：顺序 if 直接 `x.includes('裁决字面量')`——testing-trace-gates 修复前的真实 bug 形态。
// 裁决词字面量已是确定性裁决语义，无需再叠加上下文判定。
const LITERAL_VERDICT_INCLUDES_RE =
  /\.\s*includes\s*\(\s*['"](?:有条件通过|不通过|通过|有条件达标|不达标|达标)['"]\s*\)/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(abs));
    else if (ent.isFile() && ent.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

function scanForBareVerdictSubstringMatch(): string[] {
  const scriptsDir = path.resolve(__dirname, '..', '..', 'scripts');
  const violations: string[] = [];
  for (const abs of listTsFiles(scriptsDir)) {
    const rel = path.relative(scriptsDir, abs);
    if (ALLOWLIST_REL.includes(rel)) continue;
    const lines = fs.readFileSync(abs, 'utf-8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // 形态②：字面量裁决 includes（确定性裁决语义，直接判违规）。
      if (LITERAL_VERDICT_INCLUDES_RE.test(lines[i])) {
        violations.push(`${rel.replace(/\\/g, '/')}:${i + 1}  ${lines[i].trim()}`);
        continue;
      }
      // 形态①：find/some(P => X.includes(P)) + 裁决语义双重收窄。
      const m = lines[i].match(FIND_SOME_INCLUDES_RE);
      if (!m) continue;
      const receiver = m[1];
      const windowText = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      const isVerdictSemantic =
        /verdict|conclusion/i.test(receiver) || VERDICT_TOKEN_RE.test(windowText);
      if (isVerdictSemantic) {
        violations.push(`${rel.replace(/\\/g, '/')}:${i + 1}  ${lines[i].trim()}`);
      }
    }
  }
  return violations;
}

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

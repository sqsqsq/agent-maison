/**
 * execution-channel — plan a6c4e9f2 D2/T3 的定向回归。
 *
 * 覆盖：值域解析（含 provider:<id> 与非法值）、顶层表读取、缺列/缺值的一次性迁移语义、
 * manual 的分母义务、通道精确覆盖（explicit skip **不减除**缺口）、
 * 以及"首个 assertion 前必须有同 case setup/navigation action"的 STEP-SETUP 静态门。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  V1_RESULT_PROTOCOL,
  V1_TRACE_SCHEMA_VERSION,
} from '../../scripts/utils/hylyre-result-protocol';
import { MIN_NATIVE_HYLYRE_VERSION } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import {
  EXECUTION_CHANNEL_DOMAIN,
  evaluateExecutionChannelDeclaration,
  extractExecutionChannels,
  parseExecutionChannel,
} from '../../scripts/utils/execution-channel';
import {
  evaluateChannelDerivedCoverage,
  lintHylyrePlanStepRules,
} from '../../scripts/utils/derived-hylyre-plan';
import {
  __testing_checkChannelEvidenceObligation,
  __testing_checkExecutionChannelDeclaration,
  shouldRunDevicePipeline,
} from '../../scripts/check-testing';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function topPlan(rows: string[], withChannelColumn = true): string {
  const header = withChannelColumn
    ? '| 用例编号 | 用例名称 | 优先级 | 关联 AC | 执行通道 |\n| --- | --- | --- | --- | --- |'
    : '| 用例编号 | 用例名称 | 优先级 | 关联 AC |\n| --- | --- | --- | --- |';
  return `# 测试计划\n\n## 三、测试用例清单\n\n${header}\n${rows.join('\n')}\n`;
}

test('值域解析：三个裸值 + provider:<id> 合法；其余一律 null（不猜）', () => {
  assert.strictEqual(parseExecutionChannel('hylyre')?.kind, 'hylyre');
  assert.strictEqual(parseExecutionChannel(' Visual ')?.kind, 'visual');
  assert.strictEqual(parseExecutionChannel('`manual`')?.kind, 'manual');
  const provider = parseExecutionChannel('provider:toast_listener');
  assert.strictEqual(provider?.kind, 'provider');
  assert.strictEqual(provider?.provider_id, 'toast_listener');
  for (const illegal of ['', '  ', 'auto', 'hylyre;visual', 'provider:', 'provider:BAD ID', 'P0', undefined, 42]) {
    assert.strictEqual(parseExecutionChannel(illegal as unknown), null, `不得接受 ${JSON.stringify(illegal)}`);
  }
});

test('legacy 计划（无「执行通道」列）→ 一次性迁移 FAIL，且不按用例文字猜通道', () => {
  const plan = topPlan(['| TC-001 | 打开卡包 | P0 | AC-1 |'], false);
  const table = extractExecutionChannels(plan);
  assert.strictEqual(table.column_declared, false);
  const decl = evaluateExecutionChannelDeclaration(plan);
  assert.strictEqual(decl.ok, false);
  assert.strictEqual(decl.hylyre_tc_ids.length, 0, '缺列时不得推断出任何 hylyre TC');
  assert.ok(decl.detail.includes('一次性迁移'));
  assert.ok(decl.detail.includes(EXECUTION_CHANNEL_DOMAIN));
});

test('声明了列但个别 TC 缺值 / 非法值 → 分别报 missing / illegal', () => {
  const decl = evaluateExecutionChannelDeclaration(topPlan([
    '| TC-001 | a | P0 | AC-1 | hylyre |',
    '| TC-002 | b | P0 | AC-2 |  |',
    '| TC-003 | c | P1 | AC-3 | auto |',
  ]));
  assert.strictEqual(decl.ok, false);
  assert.deepStrictEqual(decl.missing, ['TC-002']);
  assert.deepStrictEqual(decl.illegal.map(x => x.tc_id), ['TC-003']);
  assert.deepStrictEqual(decl.hylyre_tc_ids, ['TC-001']);
});

test('四通道分流正确，且 manual 在场时话术明说 feature testing 无法 PASS', () => {
  const decl = evaluateExecutionChannelDeclaration(topPlan([
    '| TC-001 | a | P0 | AC-1 | hylyre |',
    '| TC-002 | b | P0 | AC-2 | visual |',
    '| TC-003 | c | P1 | AC-3 | provider:toast_listener |',
    '| TC-004 | d | P2 | AC-4 | manual |',
    '| TC-005 | e | P0 | AC-5 | hylyre |',
  ]));
  assert.strictEqual(decl.ok, true);
  assert.deepStrictEqual(decl.hylyre_tc_ids, ['TC-001', 'TC-005']);
  assert.deepStrictEqual(decl.visual_tc_ids, ['TC-002']);
  assert.deepStrictEqual(decl.provider_tc_ids, [{ tc_id: 'TC-003', provider_id: 'toast_listener' }]);
  assert.deepStrictEqual(decl.manual_tc_ids, ['TC-004']);
  assert.ok(/无法 PASS/.test(decl.detail), 'manual 的分母义务必须显式说清楚');
  assert.ok(/冻结设计/.test(decl.detail), '须说明这是冻结设计而非执行器缺陷');
});

// review P1：契约是「每 TC **唯一** channel」。重复行即使取值相同也无法证明唯一；
// 取值不同更会把同一个 TC 同时塞进两个通道集合，让 hylyre 精确对账与分母同时失真。
test('同一 TC 出现多行 → 整体拒绝，且不进任何通道集合', () => {
  const conflicting = evaluateExecutionChannelDeclaration(topPlan([
    '| TC-001 | a | P0 | AC-1 | hylyre |',
    '| TC-001 | a | P0 | AC-1 | visual |',
    '| TC-002 | b | P0 | AC-2 | hylyre |',
  ]));
  assert.strictEqual(conflicting.ok, false);
  assert.deepStrictEqual(conflicting.duplicates.map(d => d.tc_id), ['TC-001']);
  assert.deepStrictEqual(conflicting.hylyre_tc_ids, ['TC-002'], '重复 TC 不得进入任何通道集合');
  assert.deepStrictEqual(conflicting.visual_tc_ids, []);
  assert.ok(/只能声明唯一执行通道/.test(conflicting.detail));

  const sameValueTwice = evaluateExecutionChannelDeclaration(topPlan([
    '| TC-001 | a | P0 | AC-1 | hylyre |',
    '| TC-001 | a | P0 | AC-1 | hylyre |',
  ]));
  assert.strictEqual(sameValueTwice.ok, false, '同值重复同样拒绝——重复本身就证明不了唯一');
  assert.deepStrictEqual(sameValueTwice.hylyre_tc_ids, []);
});

test('通道精确覆盖：explicit skip 不减除缺口，且非 hylyre TC 不得被拉进派生集合', () => {
  const missing = evaluateChannelDerivedCoverage({
    hylyreTcIds: ['TC-001', 'TC-002', 'TC-003'],
    derivedTcIds: ['TC-001'],
    legacyExplicitSkipTcIds: ['TC-002'],
  });
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.missing, ['TC-002', 'TC-003'], 'skip 登记过的 TC-002 仍算缺口');
  assert.deepStrictEqual(missing.laundered_skips, ['TC-002']);

  const extra = evaluateChannelDerivedCoverage({
    hylyreTcIds: ['TC-001'],
    derivedTcIds: ['TC-001', 'TC-009'],
  });
  assert.strictEqual(extra.ok, false);
  assert.deepStrictEqual(extra.extra, ['TC-009']);

  const exact = evaluateChannelDerivedCoverage({
    hylyreTcIds: ['TC-001', 'TC-002'],
    derivedTcIds: ['tc-002', 'TC-001'],
  });
  assert.strictEqual(exact.ok, true);
});

test('STEP-SETUP：首个 assertion 前无同 case action → BLOCKER（wrong-screen 最低防线）', () => {
  const derived = (steps: string) =>
    `# 派生计划\n\n## 测试用例\n\n| 用例编号 | 测试步骤 | 优先级 |\n| --- | --- | --- |\n| TC-015 | ${steps} | P0 |\n`;

  const noSetup = lintHylyrePlanStepRules(derived('{"wait_for":{"by_id":"more_mini_logo_psbc"}}'));
  const setupViolations = noSetup.violations.filter(v => v.rule_id === 'STEP-SETUP');
  assert.strictEqual(setupViolations.length, 1);
  assert.strictEqual(setupViolations[0]!.severity, 'BLOCKER');
  assert.strictEqual(noSetup.ok, false, '整份计划因此不可运行');

  const withSetup = lintHylyrePlanStepRules(
    derived('{"touch":{"by_id":"card_pack_entry"}}; {"wait_for":{"by_id":"more_mini_logo_psbc"}}'),
  );
  assert.strictEqual(withSetup.violations.filter(v => v.rule_id === 'STEP-SETUP').length, 0);

  // 纯 action case（无断言）不适用该规则。
  const actionOnly = lintHylyrePlanStepRules(derived('{"touch":{"by_id":"card_pack_entry"}}'));
  assert.strictEqual(actionOnly.violations.filter(v => v.rule_id === 'STEP-SETUP').length, 0);

  // 断言之前只有另一个断言 → 仍然缺 setup。
  const assertionOnly = lintHylyrePlanStepRules(
    derived('{"wait_gone":{"by_id":"loading"}}; {"wait_for":{"by_id":"title"}}'),
  );
  assert.strictEqual(assertionOnly.violations.filter(v => v.rule_id === 'STEP-SETUP').length, 1);
});

// review P1-2：以下三条直接锁本轮返修的契约，而不是只靠"没打坏旧测试"。

test('设备流水线准入：声明不闭合 → 零设备动作；report-only 无论如何都完整只读重算', () => {
  const broken = { ok: false };
  const closed = { ok: true };
  // 非 report-only：只有声明闭合才允许 build/install/Hylyre/device。
  assert.deepStrictEqual(shouldRunDevicePipeline(broken, false), { device: false, reportOnly: false });
  assert.deepStrictEqual(shouldRunDevicePipeline(closed, false), { device: true, reportOnly: false });
  // report-only 按契约零设备：声明坏了也照常完整重算（迁移 BLOCKER 另行记账，
  // 历史 run 必须保持可诊断）——不得顺手把只读分析也关掉。
  assert.deepStrictEqual(shouldRunDevicePipeline(broken, true), { device: false, reportOnly: true });
  assert.deepStrictEqual(shouldRunDevicePipeline(closed, true), { device: false, reportOnly: true });
});

test('非 Hylyre 通道一律 fail-closed：manual / visual / provider 都触发证据义务门', () => {
  const ctx = { projectRoot: process.cwd(), feature: 'demo', phase: 'testing' } as unknown as Parameters<typeof __testing_checkExecutionChannelDeclaration>[0];
  const withChannels = (rows: string[]): string =>
    `# 测试计划\n\n## 三、测试用例清单\n\n| 用例编号 | 优先级 | 执行通道 |\n| --- | --- | --- |\n${rows.join('\n')}\n`;

  // tasks 6.5b 返修：义务门已从声明门独立，并移到 visual 检查之后——
  // 因为它要消费**本轮** visual 门的实际结论，早于证据产生就只能读到旧产物。
  // 这里不传 visual 结论，等价于"visual 未通过"，三条通道都应保持 FAIL。
  const obligationOf = (rows: string[]) =>
    __testing_checkChannelEvidenceObligation(ctx, withChannels(rows))
      .find(r => r.id === 'testing_channel_evidence_obligation');

  for (const [label, row] of [
    ['manual', '| TC-002 | P1 | manual |'],
    ['visual', '| TC-002 | P1 | visual |'],
    ['provider', '| TC-002 | P1 | provider:toast_listener |'],
  ] as const) {
    const found = obligationOf(['| TC-001 | P0 | hylyre |', row]);
    assert.ok(found, `${label} 通道必须产生证据义务门，不能只统计不裁决`);
    assert.strictEqual(found!.status, 'FAIL', `${label} 未取证不得通过`);
    assert.strictEqual(found!.severity, 'BLOCKER');
    assert.ok((found!.details ?? '').includes('TC-002'));
    assert.ok(
      !/confirmed_by|人工确认|receipt/.test(found!.suggestion ?? '') ||
        /不接受/.test(found!.suggestion ?? ''),
      '不得把人工载体写成可行出路',
    );
  }

  // 全 hylyre 时不产生该义务门（否则会把正常计划一律拖 FAIL）。
  assert.strictEqual(
    obligationOf(['| TC-001 | P0 | hylyre |', '| TC-002 | P1 | hylyre |']),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// 发布指引协议一致性（plan a6c4e9f2 T8 前置）
// ---------------------------------------------------------------------------
// 事故形态：生产门已只接受 0.5.0 / 0.4-p0 / hylyre.step-outcome/1 与 nested outcome，
// 但发布件里的指引仍在教旧口径（「派生表 ∪ explicit_skip_tc_ids」、flat failure_kind、
// 0.4.x / 0.3-p0）。宿主 testing AI 照着写出的产物必被生产门拒绝，白跑一次真机。
// 这里只钉**发布指引文本**与已冻结生产常量的一致性；
// 刻意**不**在全仓禁 `failure_kind` —— 它在 Maison 自身 CheckResult、goal events、
// 视觉熔断与历史 fixture 中另有合法语义（如 runbook 的 no_progress_fuse）。
const REPO_ROOT = path.resolve(__dirname, '../../..');
const readGuide = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');

/** 声明「当前正式协议」的四份发布指引。 */
const PROTOCOL_GUIDES = [
  'skills/reference/device-testing-workflow-detail.md',
  'skills/feature/device-testing/SKILL.md',
  'profiles/hmos-app/skills/device-testing/profile-addendum.md',
  'docs/operations/goal-mode-runbook.md',
] as const;

/** 会教 writer 怎么派生/怎么对账的全部发布件文本（含 prompt / phase rule / 模板）。 */
const WRITER_GUIDES = [
  ...PROTOCOL_GUIDES,
  'harness/prompts/verify-testing.md',
  'docs/concepts/acceptance-layering.md',
  'specs/phase-rules/testing-rules.yaml',
  'profiles/generic/skills/device-testing/templates/test-plan-template.md',
  'profiles/hmos-app/skills/device-testing/templates/test-plan-template.md',
] as const;

/** 只有 Hylyre 语义的 flat 字段面（runbook 不在内：那里的 failure_kind 是 Maison 自己的）。 */
const FLAT_FIELD_GUIDES = [
  'skills/reference/device-testing-workflow-detail.md',
  'skills/feature/device-testing/SKILL.md',
  'profiles/hmos-app/skills/device-testing/profile-addendum.md',
  'harness/prompts/verify-testing.md',
] as const;

/** 禁令或 legacy/只读标注词——命中其一即视为已标注，不算「当前可用」的操作性教程。 */
const BAN_OR_LEGACY = /禁止|不得|不再|不要|退役|legacy|只读|历史|BLOCKER|取代/;

/** 中文长句常软换行，判定窗口取「上一行 + 当前行」，避免把折行的禁令切断误判。 */
function matchingWindows(text: string, needle: string): Array<{ line: number; window: string }> {
  const lines = text.split('\n');
  const hits: Array<{ line: number; window: string }> = [];
  lines.forEach((line, i) => {
    if (line.includes(needle)) hits.push({ line: i + 1, window: `${lines[i - 1] ?? ''}\n${line}` });
  });
  return hits;
}

test('发布指引：正式协议统一为 0.5.0 / 0.4-p0 / hylyre.step-outcome/1，无旧版本残留', () => {
  for (const rel of PROTOCOL_GUIDES) {
    const text = readGuide(rel);
    assert.ok(text.includes(MIN_NATIVE_HYLYRE_VERSION), `${rel} 未声明最低 Hylyre ${MIN_NATIVE_HYLYRE_VERSION}`);
    assert.ok(text.includes(V1_TRACE_SCHEMA_VERSION), `${rel} 未声明 trace schema ${V1_TRACE_SCHEMA_VERSION}`);
    assert.ok(text.includes(V1_RESULT_PROTOCOL), `${rel} 未声明 result_protocol ${V1_RESULT_PROTOCOL}`);
    for (const stale of ['0.3-p0', '0.4.0', '0.4.1']) {
      assert.ok(!text.includes(stale), `${rel} 仍残留已退役协议口径 ${stale}`);
    }
  }
});

test('发布指引：StepResult 口径为 outcome.status + nested failure/cause/reason + selector.request/resolution', () => {
  for (const rel of PROTOCOL_GUIDES) {
    const text = readGuide(rel);
    for (const token of [
      'outcome.status', 'outcome.failure', 'outcome.cause', 'outcome.reason',
      'selector.request', 'selector.resolution',
    ]) {
      assert.ok(text.includes(token), `${rel} 未写明 ${token}`);
    }
  }
});

test('发布指引：explicit_skip_tc_ids 只作禁令/legacy 只读，且没有可复制的写入教程', () => {
  for (const rel of WRITER_GUIDES) {
    const text = readGuide(rel);
    for (const hit of matchingWindows(text, 'explicit_skip')) {
      assert.ok(
        BAN_OR_LEGACY.test(hit.window),
        `${rel}:${hit.line} 提到 explicit_skip 却既非禁令也未标 legacy/只读`,
      );
    }
    // 写入教程的形态：给出可直接抄的 frontmatter / derive-manifest 字面量。
    assert.ok(
      !/explicit_skip_tc_ids\s*:\s*\[/.test(text),
      `${rel} 仍留有 explicit_skip_tc_ids frontmatter 写法示例`,
    );
    assert.ok(
      !/"explicit_skip_tc_ids"\s*:/.test(text),
      `${rel} 仍留有 derive-manifest.json 的 explicit_skip_tc_ids 写法示例`,
    );
  }
});

test('verifier prompt：TC 一致性按 execution_channel 精确相等，不再要求与 explicit skip 做并集', () => {
  const text = readGuide('harness/prompts/verify-testing.md');
  assert.ok(!/派生表\s*∪/.test(text), 'verify-testing.md 仍要求「派生表 ∪ explicit_skip_tc_ids」覆盖顶层 TC');
  assert.ok(text.includes('execution_channel'), 'verify-testing.md 未按 execution_channel 对账');
  assert.ok(text.includes('channel=hylyre'), 'verify-testing.md 未写明派生集合等于 channel=hylyre');
});

test('发布指引：flat failure_kind/failure_code 只出现在禁令语境（不做全仓粗暴禁字符串）', () => {
  for (const rel of FLAT_FIELD_GUIDES) {
    const text = readGuide(rel);
    for (const needle of ['failure_kind', 'failure_code']) {
      for (const hit of matchingWindows(text, needle)) {
        assert.ok(
          BAN_OR_LEGACY.test(hit.window),
          `${rel}:${hit.line} 仍把 flat ${needle} 当作当前可用字段`,
        );
      }
    }
  }
});

export function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return Promise.resolve(results);
}

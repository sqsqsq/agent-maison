import { runUnitCases } from '../utils/unit-cases';
// ============================================================================
// integration-tc-flow.unit.test.ts — S6 集成契约一致性 + TC DAG 回归
// （visual-capability-truth S6 / P1-F·I）
// ============================================================================

import {
  evaluateIntegrationScopeConsistency,
  type IntegrationPoint,
} from '../../scripts/utils/integration-scope';
import {
  parseTestCaseFlowBlock,
  triageCascade,
  validateTestCaseFlow,
  type TestCaseFlow,
} from '../../scripts/utils/test-case-flow';
import { extractDerivedPlanCases, lintDeviceDataReadiness, parsePlannedStepsFromCell } from '../../scripts/utils/derived-hylyre-plan';
import { injectP0IdentityAssertions } from '../../scripts/utils/p0-identity-injection';
import { evaluateExecutionChannelDeclaration } from '../../scripts/utils/execution-channel';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ---------------- P1-F integration scope ----------------

test('20260718 矛盾形态：WalletMain requires_modification=true 且 ∉ in_scope → 拒收', () => {
  const points: IntegrationPoint[] = [
    { consumer_module: 'WalletMain', provider_module: 'FinancialCard', requires_modification: true, entry_symbol: 'CardCategoryList' },
  ];
  const v = evaluateIntegrationScopeConsistency({ points, inScopeModules: ['FinancialCard'], bindingProbe: () => false });
  assert(v.length === 1 && v[0].reason.includes('自矛盾'), JSON.stringify(v));
});

test('requires_modification=true 且 in_scope → 通过（改它是计划内）', () => {
  const points: IntegrationPoint[] = [
    { consumer_module: 'WalletMain', provider_module: 'FinancialCard', requires_modification: true, entry_symbol: 'CardCategoryList' },
  ];
  const v = evaluateIntegrationScopeConsistency({ points, inScopeModules: ['FinancialCard', 'WalletMain'], bindingProbe: () => false });
  assert(v.length === 0, JSON.stringify(v));
  const missing = evaluateIntegrationScopeConsistency({ points: [{ ...points[0], entry_symbol: undefined }], inScopeModules: ['FinancialCard', 'WalletMain'], bindingProbe: () => false });
  assert(missing.length === 1 && missing[0].reason.includes('entry_symbol'), 'planned integration still needs its definition');
});

test('零修改接入点：binding 实存 → 通过；不实存/缺 entry_symbol → 违例', () => {
  const base: IntegrationPoint = { consumer_module: 'Phone', provider_module: 'FinancialCard', requires_modification: false, entry_symbol: 'FinancialCardEntry' };
  const ok = evaluateIntegrationScopeConsistency({ points: [base], inScopeModules: ['FinancialCard'], bindingProbe: () => true });
  assert(ok.length === 0, 'binding 实存应过');
  const miss = evaluateIntegrationScopeConsistency({ points: [base], inScopeModules: ['FinancialCard'], bindingProbe: () => false });
  assert(miss.length === 1 && miss[0].reason.includes('未被证实'), JSON.stringify(miss));
  const noSym = evaluateIntegrationScopeConsistency({
    points: [{ ...base, entry_symbol: undefined }], inScopeModules: ['FinancialCard'], bindingProbe: () => true,
  });
  assert(noSym.length === 1 && noSym[0].reason.includes('entry_symbol'), JSON.stringify(noSym));
});

// ---------------- P1-I test_case_flow ----------------

const FLOW: TestCaseFlow = {
  'TC-001': { precondition: { kind: 'fresh_app', reset: 'restart' } },
  'TC-002': { precondition: { kind: 'after', tc: 'TC-001' } },
  'TC-003': { precondition: { kind: 'after', tc: 'TC-002' } },
  'TC-004': { precondition: { kind: 'after', tc: 'TC-003' } },
  'TC-005': { precondition: { kind: 'after', tc: 'TC-004' } },
  'TC-009': { precondition: { kind: 'fresh_app', reset: 'restart' } },
};

test('parseTestCaseFlowBlock：yaml 块解析 + 非法 kind 拒', () => {
  const md = ['# plan', '', '```yaml', 'test_case_flow:', '  TC-001: { precondition: { kind: fresh_app, reset: restart } }', '```', ''].join('\n');
  const p = parseTestCaseFlowBlock(md);
  assert(p.flow !== null && p.flow['TC-001'].precondition.kind === 'fresh_app', JSON.stringify(p));
  const bad = parseTestCaseFlowBlock(['```yaml', 'test_case_flow:', '  TC-001: { precondition: { kind: whatever } }', '```'].join('\n'));
  assert(bad.flow === null && Boolean(bad.error), 'illegal kind must error');
  assert(parseTestCaseFlowBlock('# no block').flow === null, 'no block → null');
});

test('validateTestCaseFlow：双 SSOT 漂移/缺失引用/环 全检出', () => {
  const drift = validateTestCaseFlow(FLOW, ['TC-001', 'TC-002', 'TC-003', 'TC-004', 'TC-005', 'TC-009', 'TC-010']);
  assert(drift.some(e => e.includes('TC-010')), '表多 flow 缺须检出');
  const missing = validateTestCaseFlow(
    { 'TC-001': { precondition: { kind: 'after', tc: 'TC-999' } } },
    ['TC-001'],
  );
  assert(missing.some(e => e.includes('TC-999')), '缺失引用');
  const cyclic = validateTestCaseFlow(
    {
      'TC-001': { precondition: { kind: 'after', tc: 'TC-002' } },
      'TC-002': { precondition: { kind: 'after', tc: 'TC-001' } },
    },
    ['TC-001', 'TC-002'],
  );
  assert(cyclic.some(e => e.includes('成环')), '环检出');
  assert(validateTestCaseFlow(FLOW, Object.keys(FLOW)).length === 0, '一致集应通过');
});

test('20260718 级联形态：TC-003 根故障 → TC-004/005 BLOCKED_BY（传递）；TC-009 独立', () => {
  const t = triageCascade(FLOW, ['TC-003', 'TC-004', 'TC-005', 'TC-009']);
  assert(t.byCase['TC-004'].class === 'blocked_by' && t.byCase['TC-004'].blocked_by === 'TC-003', JSON.stringify(t.byCase));
  assert(t.byCase['TC-005'].class === 'blocked_by' && t.byCase['TC-005'].blocked_by === 'TC-003', '传递 blocked 指根因');
  assert(t.byCase['TC-009'].class === 'independent_fail', 'TC-009 独立失败');
  assert(t.rootFails.includes('TC-003'), 'TC-003 是根故障');
  // 硬边界：归类不产生任何"通过"语义（全部仍是失败集成员）
  assert(t.blocked.length + t.rootFails.length + t.independentFails.length === 4, '失败分母不变');
});

const DATA_TOP = [
  '```yaml', 'test_case_flow:',
  '  TC-001: { precondition: { kind: fresh_app, reset: fixture_reset, ready_by_id: checked_empty } }',
  '  TC-002: { precondition: { kind: fresh_app, reset: restart } }',
  '  TC-003: { precondition: { kind: after, tc: TC-001, ready_by_id: checked_absent } }',
  '```', '',
].join('\n');
const DATA_ORDER = ['TC-001', 'TC-002', 'TC-003'];
function derivedPlan(order = DATA_ORDER): string {
  const anchors: Record<string, string> = { 'TC-001': 'checked_empty', 'TC-003': 'checked_absent' };
  return [
    '## 测试用例清单', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
    '|---|---|---|---|---|---|---|',
    ...order.map(tc => {
      const start = { bundle: 'qa.bundle', page_name: 'Main', ...(tc === 'TC-001' ? { params: '--ps fixture reset' } : {}) };
      const prefix = anchors[tc] ? [{ stop_app: { bundle: 'qa.bundle' } }, { start_app: start },
        { wait_for: { by_id: anchors[tc], timeout: 10 } }] : [];
      return `| ${tc} | 名称 | 条件 | ${[...prefix, { touch: { by_id: 'existing_action' } }].map(step => JSON.stringify(step)).join('; ')} | 结果 | P0 | AC-01 |`;
    }),
  ].join('\n');
}

test('data readiness validates ordinary native steps without copying the top case graph', () => {
  const plan = derivedPlan();
  assert(lintDeviceDataReadiness(DATA_TOP, plan, DATA_ORDER).length === 0, plan);
  const independentRead = DATA_TOP.replace('kind: after, tc: TC-001, ready_by_id: checked_absent',
    'kind: fresh_app, ready_by_id: checked_absent');
  assert(lintDeviceDataReadiness(independentRead, plan, DATA_ORDER).length === 0,
    'an independently observed data condition needs no cross-case root');
});

test('data readiness rejects missing setup, wrong anchors, early writes, and reordered cases', () => {
  const good = derivedPlan();
  for (const [bad, tc] of [
    [good.replace(',"params":"--ps fixture reset"', ''), 'TC-001'],
    [good.replace('"checked_empty"', '"existing_action"'), 'TC-001'],
    [good.replace('{"wait_for":{"by_id":"checked_empty","timeout":10}}; ', ''), 'TC-001'],
    [good.replace('{"wait_for":{"by_id":"checked_empty","timeout":10}}; {"touch":{"by_id":"existing_action"}}',
      '{"touch":{"by_id":"existing_action"}}; {"wait_for":{"by_id":"checked_empty","timeout":10}}'), 'TC-001'],
    [good.replace('"page_name":"Main"}', '"page_name":"Main","params":"--ps fixture reset"}'), 'TC-003'],
    [derivedPlan(['TC-003', 'TC-001', 'TC-002']), 'TC-003'],
  ]) {
    const failures = lintDeviceDataReadiness(DATA_TOP, bad, DATA_ORDER);
    assert(failures.some(error => error.tc_id === tc && error.rule_id === 'STEP-003'), JSON.stringify(failures));
  }
});

test('data readiness orders Hylyre predecessors and preserves manual predecessors in the top flow', () => {
  const top = DATA_TOP.replace('tc: TC-001, ready_by_id', 'tcs: [TC-001, TC-007], ready_by_id') +
    '\n## 测试用例清单\n\n| 用例编号 | 执行通道 |\n| --- | --- |\n' +
    '| TC-001 | hylyre |\n| TC-002 | hylyre |\n| TC-003 | hylyre |\n| TC-007 | manual:data_injection |\n';
  const channels = evaluateExecutionChannelDeclaration(top);
  assert(channels.channels_resolved && channels.manual_tc_ids.includes('TC-007'), JSON.stringify(channels));
  assert(channels.hylyre_tc_ids.join(',') === DATA_ORDER.join(','), JSON.stringify(channels));
  assert(parseTestCaseFlowBlock(top).flow?.['TC-003'].precondition.tcs?.includes('TC-007') === true, top);
  assert(lintDeviceDataReadiness(top, derivedPlan(), channels.hylyre_tc_ids).length === 0, top);
  assert(lintDeviceDataReadiness(top, derivedPlan(['TC-003', 'TC-001', 'TC-002']), channels.hylyre_tc_ids)
    .some(v => v.tc_id === 'TC-003' && v.rule_id === 'STEP-003'), 'Hylyre dependency must still be enforced');
});

test('a case-level ready_by_id is diagnosed on that case even beside valid declarations', () => {
  const misplaced = DATA_TOP.replace(
    'kind: fresh_app, reset: restart } }', 'kind: fresh_app, reset: restart }, "ready_by_id": checked_late }');
  const failures = lintDeviceDataReadiness(misplaced, derivedPlan(), DATA_ORDER);
  assert(failures.length === 1 && failures[0].tc_id === 'TC-002' && failures[0].rule_id === 'STEP-003',
    JSON.stringify(failures));
  const misplacedOnly = misplaced.replace(/, ready_by_id: \w+/g, '');
  assert(lintDeviceDataReadiness(misplacedOnly, derivedPlan(), DATA_ORDER).some(v => v.tc_id === 'TC-002'), misplacedOnly);
  const indented = DATA_TOP.split('\n').map(line => line.startsWith('```') ? `  ${line} \t` : line).join('\n');
  assert(lintDeviceDataReadiness(indented, derivedPlan(), DATA_ORDER).length === 0, indented);
  assert(lintDeviceDataReadiness(indented.replace(/\n[ \t]*```[ \t]*\n$/, '\n'), derivedPlan(), DATA_ORDER)
    .some(v => v.tc_id === 'TC-001' && v.rule_id === 'STEP-003'), 'unclosed opted-in plan still fails');
});

test('legacy fixture_reset keeps its existing behavior until ready_by_id is declared', () => {
  const legacyFixture = DATA_TOP.replace(/, ready_by_id: \w+/g, '');
  const plan = derivedPlan().replace('{"wait_for":{"by_id":"checked_empty","timeout":10}}; ', '');
  assert(parseTestCaseFlowBlock(legacyFixture).flow?.['TC-001'].precondition.reset === 'fixture_reset', legacyFixture);
  assert(lintDeviceDataReadiness(legacyFixture, plan, DATA_ORDER).length === 0, plan);
  const mention = legacyFixture.replace('reset: fixture_reset } }', 'reset: fixture_reset }, note: "ready_by_id: example" }');
  assert(lintDeviceDataReadiness(mention, plan, DATA_ORDER).length === 0, mention);
  const legacy = '```yaml\ntest_case_flow:\n  TC-002: { precondition: { kind: fresh_app, note: "mentions, ready_by_id: text" # reset: fixture_reset\n```';
  assert(lintDeviceDataReadiness('# 普通文案 fixture_reset 与 ready_by_id\n' + legacy, derivedPlan(), DATA_ORDER).length === 0, legacy);
  const opted = DATA_TOP.replace('ready_by_id: checked_empty', '"ready_by_id": [');
  assert(lintDeviceDataReadiness(opted, derivedPlan(), DATA_ORDER).some(v => v.rule_id === 'STEP-003'), opted);
});

test('production P0 injection preserves stop/start/readiness and adds identity after the business action', () => {
  const plan = derivedPlan();
  const injection = injectP0IdentityAssertions({ derivedMd: plan, topPlanMd: DATA_TOP, canonical: null, acceptance: {
    flows: { main: ['home', 'panel'] }, criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'device', linked_flow: 'main',
      checkpoint: { pre_screen: 'home', action: { type: 'touch', target_element_id: 'existing_action' },
        post_screen: 'panel', required_element_ids: ['panel'], forbidden_element_ids: ['stale_panel'] } }],
  } });
  assert(injection.changed && injection.gaps.length === 0, JSON.stringify(injection));
  const pre = parsePlannedStepsFromCell(extractDerivedPlanCases(plan)[0].steps_raw);
  const post = parsePlannedStepsFromCell(extractDerivedPlanCases(injection.content)[0].steps_raw);
  if (!pre.ok || !post.ok) throw new Error('fixture steps did not parse');
  assert(JSON.stringify(pre.steps.slice(0, 4)) === JSON.stringify(post.steps.slice(0, 4)), injection.content);
  assert(injection.injected.filter(row => row.tc_id === 'TC-001').map(row => row.index).join(',') === '4,5',
    JSON.stringify(injection.injected));
  assert(lintDeviceDataReadiness(DATA_TOP, injection.content, DATA_ORDER).length === 0, injection.content);
});

export function runAll(): UnitCaseResult[] {
  return runUnitCases(cases);
}

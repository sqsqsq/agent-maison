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
    { consumer_module: 'WalletMain', provider_module: 'FinancialCard', requires_modification: true },
  ];
  const v = evaluateIntegrationScopeConsistency({ points, inScopeModules: ['FinancialCard', 'WalletMain'], bindingProbe: () => false });
  assert(v.length === 0, JSON.stringify(v));
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

// mutation-backtrack.unit.test.ts — source drift is never trusted by a human pass key.

import {
  classifySourceDrift,
} from '../../scripts/utils/mutation-authorization';
import { applyInvalidationsToResume, resolveFrozenManifestHash } from '../../scripts/goal-runner';
import { evaluateUpstreamViews } from '../../scripts/utils/upstream-verdict-gate';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

const CTX = {
  runId: 'r1', frozenManifestHash: 'MH', phase: 'ut', expectedInventoryHash: 'INV',
  projectRoot: 'D:/fixture', feature: 'demo',
};

function humanReceipt(over?: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: '1.0', run_id: 'r1', phase: 'ut', allowed_files: ['src/F.ets'],
    allowed_change_kind: 'test_seam', max_files: 1, source_inventory_before: 'INV',
    approved_by: 'alice', authority_kind: 'human', authority_ref: 'receipt.json',
    receipt_hash: 'deadbeefdeadbeef', ...over,
  };
}

test('无 drift → no_drift', () => {
  const r = classifySourceDrift({ added: [], modified: [], deleted: [] }, [], CTX);
  assert(r.kind === 'no_drift', JSON.stringify(r));
});

test('legacy human receipt 即使 fingerprint/范围完全吻合也不能信任源码字节', () => {
  const fp = 'a'.repeat(64);
  const r = classifySourceDrift(
    { added: [], modified: ['src/F.ets'], deleted: [] },
    [humanReceipt({ adjudicated_drift_fingerprint: fp })],
    { ...CTX, currentDriftFingerprint: fp },
  );
  assert(r.kind === 'unauthorized', JSON.stringify(r));
  assert(r.kind === 'unauthorized' && r.violations.some((v) => v.includes('source_mutation_authorization 已退役')), JSON.stringify(r));
});

test('pre_run_manifest legacy 记录不能把 drift 变成 authorized_backtrack', () => {
  const receipt = { phase: 'ut', allowed_files: ['src/F.ets'], max_files: 1, authority_kind: 'pre_run_manifest' };
  const r = classifySourceDrift(
    { added: [], modified: ['src/F.ets'], deleted: [] }, [receipt],
    { ...CTX, manifestIdentityAuthenticated: true },
  );
  assert(r.kind === 'unauthorized', JSON.stringify(r));
});

test('删除源文件同样 unauthorized', () => {
  const r = classifySourceDrift({ added: [], modified: [], deleted: ['src/F.ets'] }, [humanReceipt()], CTX);
  assert(r.kind === 'unauthorized', JSON.stringify(r));
  assert(r.kind === 'unauthorized' && r.violations.some((v) => v.includes('删除源文件')), JSON.stringify(r));
});

test('resolveFrozenManifestHash：首个 run_start 锚定；resume 不换锚', () => {
  const events = [
    { type: 'run_start', manifest_hash: 'H-FIRST' }, { type: 'resume' },
    { type: 'run_start', manifest_hash: 'H-SECOND' },
  ];
  assert(resolveFrozenManifestHash(events, 'H-NOW') === 'H-FIRST', '首锚优先');
  assert(resolveFrozenManifestHash([], 'H-NOW') === 'H-NOW', '无先例用当前');
});

test('applyInvalidationsToResume：失效未重跑 → 剔除 + 起点回退；已重新 PASS → 保留', () => {
  const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as never[];
  const outcomes = [
    { phase: 'coding', verdict: 'PASS' }, { phase: 'review', verdict: 'PASS' },
    { phase: 'ut', verdict: 'PASS' },
  ] as never[];
  const events = [
    { type: 'phase_verdict', phase: 'review', verdict: 'PASS' },
    { type: 'phase_invalidated', phase: 'review' },
    { type: 'phase_invalidated', phase: 'ut' },
    { type: 'phase_verdict', phase: 'ut', verdict: 'PASS' },
  ];
  const r = applyInvalidationsToResume(chain, outcomes, events);
  assert(!r.outcomes.some((o) => (o as { phase: string }).phase === 'review'), 'review 须剔除');
  assert(r.outcomes.some((o) => (o as { phase: string }).phase === 'ut'), 'ut 新 PASS 须保留');
  assert(r.startIndex === 3, `起点应回 review，got ${r.startIndex}`);
});

test('applyInvalidationsToResume：backtrack 后 settled identity 只复用目标 phase', () => {
  const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as never[];
  const outcomes = [{ phase: 'coding', verdict: 'PASS' }, { phase: 'review', verdict: 'PASS' }] as never[];
  const events = [
    { type: 'phase_backtrack_requested' as const, invalidated_phases: ['coding', 'review'] },
    { type: 'agent_process_settled' as const, phase: 'coding', invoke_id: 'coding-i7' },
  ];
  const r = applyInvalidationsToResume(chain, outcomes, events);
  assert(r.postAgentPhases.length === 1 && r.postAgentPhases[0] === 'coding', JSON.stringify(r));
  assert(r.postAgentAttemptIds.coding === 'coding-i7', JSON.stringify(r.postAgentAttemptIds));
});

test('环境层：ut FAIL + device_locked 指引修环境而非改码', () => {
  const violations = evaluateUpstreamViews([{
    phase: 'ut', summaryExists: true, verdictReadable: true, verdict: 'FAIL',
    blockerIds: [], freshness: 'fresh', environmentFailureCode: 'device_locked',
  }]);
  assert(violations.length === 1, 'FAIL 仍须拦截');
  assert(violations[0].reason.includes('请人解锁真机'), violations[0].reason);
  assert(violations[0].reason.includes('不要尝试自行解锁设备'), violations[0].reason);
});

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try { c.run(); return { name: c.name, ok: true }; }
    catch (err) { return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message }; }
  });
}

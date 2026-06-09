// phase-transition-policy.unit.test.ts — batch_authorized heuristics + manual default

import {
  DEFAULT_TRANSITION_POLICY,
  classifyPhaseVerdict,
  dedicatedOkToRegistryId,
  isPhaseWithinBatchRange,
  nextSkillLabelForPhase,
  parseBatchAuthorization,
  parseGoalModeAuthorization,
  resolveGoalRunStatus,
  resolveTransitionPolicy,
} from '../../scripts/utils/phase-transition-policy';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'parseBatchAuthorization: empty → manual',
    run: () => {
      const r = parseBatchAuthorization('');
      assert(r.policy === DEFAULT_TRANSITION_POLICY, `expected manual, got ${r.policy}`);
      assert(r.throughPhase === undefined, 'throughPhase should be undefined');
    },
  },
  {
    name: 'parseBatchAuthorization: coding 并 review → batch through review',
    run: () => {
      const r = parseBatchAuthorization('对 hwp-channel coding 并 review');
      assert(r.policy === 'batch_authorized', `expected batch, got ${r.policy}`);
      assert(r.throughPhase === 'review', `expected review, got ${r.throughPhase}`);
    },
  },
  {
    name: 'parseBatchAuthorization: 全链路 → batch through testing',
    run: () => {
      const r = parseBatchAuthorization('全链路交付 home-page');
      assert(r.policy === 'batch_authorized', `expected batch, got ${r.policy}`);
      assert(r.throughPhase === 'testing', `expected testing, got ${r.throughPhase}`);
    },
  },
  {
    name: 'parseBatchAuthorization: 仅写 PRD → manual',
    run: () => {
      const r = parseBatchAuthorization('帮我写 home-page 的 PRD');
      assert(r.policy === 'manual', `expected manual, got ${r.policy}`);
    },
  },
  {
    name: 'isPhaseWithinBatchRange: coding→review within review cap',
    run: () => {
      assert(
        isPhaseWithinBatchRange('coding', 'review', 'review'),
        'coding→review should be in range when through=review',
      );
      assert(
        !isPhaseWithinBatchRange('coding', 'ut', 'review'),
        'coding→ut should be out of range when through=review',
      );
    },
  },
  {
    name: 'nextSkillLabelForPhase + dedicatedOkToRegistryId',
    run: () => {
      assert(nextSkillLabelForPhase('coding').includes('code-review'), 'coding next label');
      assert(dedicatedOkToRegistryId('coding') === 'coding.ok_to_review', 'coding ok id');
      assert(dedicatedOkToRegistryId('prd') === undefined, 'prd has no dedicated ok_to');
    },
  },
  {
    name: 'parseGoalModeAuthorization: 目标模式 → goal_mode',
    run: () => {
      const r = parseGoalModeAuthorization('进入目标模式 demo-feature');
      assert(r.policy === 'goal_mode', `expected goal_mode, got ${r.policy}`);
    },
  },
  {
    name: 'resolveTransitionPolicy: 全自动做到 testing → goal_mode（优先于 batch）',
    run: () => {
      const p = resolveTransitionPolicy('全自动做到 testing');
      assert(p === 'goal_mode', `expected goal_mode, got ${p}`);
    },
  },
  {
    name: 'resolveTransitionPolicy: 全链路交付 → batch_authorized',
    run: () => {
      const p = resolveTransitionPolicy('全链路交付 home-page');
      assert(p === 'batch_authorized', `expected batch, got ${p}`);
    },
  },
  {
    name: 'classifyPhaseVerdict + resolveGoalRunStatus smoke',
    run: () => {
      assert(classifyPhaseVerdict({ verdict: 'PASS' }) === 'advance', 'advance');
      assert(resolveGoalRunStatus([{ phase: 'ut', deferred: true }], true) === 'DEFERRED', 'DEFERRED');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}

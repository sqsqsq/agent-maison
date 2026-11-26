import { runUnitCases } from '../utils/unit-cases';
// phase-transition-policy.unit.test.ts — batch_authorized heuristics + manual default

import {
  DEFAULT_TRANSITION_POLICY,
  dedicatedOkToRegistryId,
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
    name: 'nextSkillLabelForPhase derives from workflow + dedicatedOkToRegistryId',
    run: () => {
      const workflow = {
        schema_version: '1.1',
        name: 'custom',
        auto_chain: ['coding', 'verify-custom'],
        artifacts: [
          { id: 'coding', scope: 'feature' as const, requires: [], tracks: ['full'] },
          {
            id: 'verify-custom',
            scope: 'feature' as const,
            requires: ['coding'],
            tracks: ['full'],
          },
        ],
      };
      assert(nextSkillLabelForPhase(workflow, 'coding') === 'verify-custom', 'workflow next label');
      assert(dedicatedOkToRegistryId('coding') === 'coding.ok_to_review', 'coding ok id');
      assert(dedicatedOkToRegistryId('spec') === undefined, 'spec has no dedicated ok_to');
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
    name: 'T4 翻案：分类器入参不含 strictness（与档位解耦的结构性保证保留）',
    run: () => {
      const keys = Object.keys({
        verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true,
      });
      assert(!keys.some(k => /strict|hard|pixel/i.test(k)), '判据不得含 strictness 维度');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return runUnitCases(cases);
}

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}

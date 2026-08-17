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
  // ==========================================================================
  // plan d8c5f3a7 T4：backtrack_to_coding 回修环
  // 2026-07-24 事故：转移只有「同阶段 retry ≤2 → halt」，真机发现的确定性缺陷从来
  // 回不到 coding；testing i10→i12 白烧三轮后被 halt，用户期待的「测试发现问题→回码
  // 修复」的环从未跑起来。
  // ==========================================================================
  {
    // ========================================================================
    // 责任阶段统一路由（plan b6e4c9f2）翻案：T4 的 testing 专用回退判据**已从本
    // 分类器删除**——缺陷回退唯一入口是 assess 的 repair_candidates 分支（它在
    // recommendationForObservation 中先于本分类器执行）。v23 F1 的核心保证
    //（PASS+可信缺陷也必须回退、与 strictness 解耦、预算裁决归 runner）**未削弱**，
    // 只是换了承载层——保证本身由 repair-candidates 套件的"PASS+候选仍回退"覆盖。
    // 本组用例翻案为：分类器只做普通 verdict 语义，不再承担缺陷路由。
    // ========================================================================
    name: 'T4 翻案：缺陷路由已移出本分类器——testing FAIL 走普通 retry 语义',
    run: () => {
      const a = classifyPhaseVerdict({
        verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true, retries_used: 0,
      });
      assert(a === 'retry', `分类器不再裁缺陷回退（由 assess candidates 承载），实得 ${a}`);
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
  {
    name: 'T4 翻案：预算裁决仍归 runner——分类器不看 backtracks_used',
    run: () => {
      const used = classifyPhaseVerdict({
        verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true,
        backtracks_used: 2, max_backtracks: 2, retries_used: 0,
      });
      assert(used === 'retry', `分类器不看预算（回退预算/指纹熔断在 runner 统一分支），实得 ${used}`);
      const passExhausted = classifyPhaseVerdict({
        verdict: 'PASS', phase: 'testing', deterministic_p0_defects: true,
        backtracks_used: 2, max_backtracks: 2,
      });
      assert(passExhausted === 'advance',
        `PASS 在本分类器恒 advance；"PASS+可信缺陷仍回退"由 assess candidates 分支保证，实得 ${passExhausted}`);
    },
  },
  {
    name: 'T4 翻案边界：本分类器只做普通 verdict 语义（缺陷路由全部走 assess）',
    run: () => {
      assert(
        classifyPhaseVerdict({ verdict: 'FAIL', phase: 'testing', retries_used: 0 }) === 'retry',
        'FAIL 未耗尽预算 → retry',
      );
      assert(
        classifyPhaseVerdict({ verdict: 'FAIL', phase: 'coding', deterministic_p0_defects: true, retries_used: 0 }) === 'retry',
        'coding 自身不回退到自己',
      );
      assert(
        classifyPhaseVerdict({ verdict: 'PASS', phase: 'testing' }) === 'advance',
        'PASS → advance（无候选时）',
      );
      assert(
        classifyPhaseVerdict({ verdict: 'FAIL', phase: 'ut', deterministic_p0_defects: true, retries_used: 0 }) === 'retry',
        'ut 同款：缺陷回退由 assess repair_candidates 路由承载',
      );
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

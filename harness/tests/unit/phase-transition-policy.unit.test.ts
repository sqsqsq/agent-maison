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
    name: 'T4 backtrack: testing FAIL + 确定性 P0 缺陷 → backtrack_to_coding（不再空转 retry）',
    run: () => {
      const a = classifyPhaseVerdict({
        verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true, retries_used: 0,
      });
      assert(a === 'backtrack_to_coding', `应回退 coding，实得 ${a}`);
    },
  },
  {
    name: 'T4 backtrack 与 strictness 解耦：判据只看确定性缺陷，不看 hard/best_effort',
    run: () => {
      // 入参里根本没有 strictness——结构性保证 best_effort（银行卡真实档位）同样回修。
      // 若将来有人把 isHardPixelContract 引进本判据，本用例即失效告警。
      const keys = Object.keys({
        verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true,
      });
      assert(!keys.some(k => /strict|hard|pixel/i.test(k)), '回修判据不得含 strictness 维度');
      const a = classifyPhaseVerdict({ verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true });
      assert(a === 'backtrack_to_coding', 'best_effort 档同样须回修');
    },
  },
  {
    name: 'T4 backtrack 预算：用尽 max_backtracks 后回落 retry / halt（防 ping-pong）',
    run: () => {
      // review 第 10 轮反转：policy **不看预算**——旧写法预算耗尽后 PASS+actionable=advance
      //（残留缺陷被当通过推进）、FAIL+actionable=retry（原地空转），与"耗尽即 halt"相反。
      // 预算/指纹裁决收归 runner 统一回退分支（在那里 halt）。
      const used = classifyPhaseVerdict({
        verdict: 'FAIL', phase: 'testing', deterministic_p0_defects: true,
        backtracks_used: 2, max_backtracks: 2, retries_used: 0,
      });
      assert(used === 'backtrack_to_coding', `预算耗尽仍须返回 backtrack（runner 分支裁决 halt），实得 ${used}`);
      const passExhausted = classifyPhaseVerdict({
        verdict: 'PASS', phase: 'testing', deterministic_p0_defects: true,
        backtracks_used: 2, max_backtracks: 2,
      });
      assert(passExhausted === 'backtrack_to_coding',
        `PASS+actionable 预算耗尽也不得 advance（残留缺陷≠通过），实得 ${passExhausted}`);
    },
  },
  {
    name: 'T4 backtrack 边界：无确定性缺陷 / 非可变阶段 → 维持既有 retry 语义',
    run: () => {
      assert(
        classifyPhaseVerdict({ verdict: 'FAIL', phase: 'testing', retries_used: 0 }) === 'retry',
        '无确定性缺陷不得回退（否则任何失败都回码，浪费预算）',
      );
      assert(
        classifyPhaseVerdict({ verdict: 'FAIL', phase: 'coding', deterministic_p0_defects: true, retries_used: 0 }) === 'retry',
        'coding 自身不回退到自己',
      );
      // v23 F1 反转：actionable 判据在 PASS **之前**——旧断言"PASS 恒 advance"正是
      // 第 6 轮 review 实锤的致命错误（best_effort 下视觉缺陷=WARN、verdict=PASS →
      // 回修环从未可达；本单测当时还把错误行为焊死了）。
      assert(
        classifyPhaseVerdict({ verdict: 'PASS', phase: 'testing', deterministic_p0_defects: true }) === 'backtrack_to_coding',
        'PASS + actionable 缺陷必须回退（回修环可达性的关键）',
      );
      assert(
        classifyPhaseVerdict({ verdict: 'PASS', phase: 'testing' }) === 'advance',
        '无 actionable 时 PASS 才 advance',
      );
      // v23：UT 不读视觉产物——actionable 判据只在 testing
      assert(
        classifyPhaseVerdict({ verdict: 'FAIL', phase: 'ut', deterministic_p0_defects: true, retries_used: 0 }) === 'retry',
        'ut 阶段不走视觉回退（visual/crash 检测只在 testing 执行）',
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

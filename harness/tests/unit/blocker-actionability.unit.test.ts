// ============================================================================
// blocker-actionability.unit.test.ts — P0-4（plan 7c4f2e9b）
// 注册表三链优先级 / 聚合谓词 / timeout 四步分流 / 签名剔除 / 回喂过滤 / e2e 回放 B
// ============================================================================

import {
  aggregateBlockerActionability,
  buildEffectiveBlockerSignature,
  classifyFailureKind,
  classifyTimedOutWithFreshBlockers,
  filterSignatureBlockers,
  resolveBlockerActionability,
  isSpecCaptureGapBlockerId,
  SIGNATURE_HALT_KINDS,
  type GoalSummaryLike,
} from '../../scripts/utils/goal-failure-classifier';
import { extractPriorFailureContext } from '../../scripts/goal-runner';
import { resolveClosureSyncOutcome, shouldHaltClosureTimeout } from '../../scripts/utils/goal-runner-phase';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const S = (blockers: GoalSummaryLike['blockers']): GoalSummaryLike => ({ verdict: 'FAIL', blockers });

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'registry: 三链优先级——显式 > 映射 > 缺省 agent_fixable',
    run: () => {
      if (resolveBlockerActionability({ id: 'anything', actionability: 'human_only' }) !== 'human_only') throw new Error('显式未优先');
      if (resolveBlockerActionability({ id: 'fidelity_deferrals_human_sign' }) !== 'human_only') throw new Error('人签 id 映射失败');
      if (resolveBlockerActionability({ id: 'x', classification: 'await_human_fidelity_tier' }) !== 'human_only') throw new Error('视觉二期门禁族映射失败');
      if (resolveBlockerActionability({ id: 'x', classification: 'capability_missing_strong_intent' }) !== 'human_only') throw new Error('capability 门禁族映射失败');
      if (resolveBlockerActionability({ id: 'capture_completeness_external_ocr_unavailable' }) !== 'toolchain_blocked') throw new Error('ocr_unavailable 应 toolchain');
      if (resolveBlockerActionability({ id: 'x', blocking_class: 'device_toolchain' }) !== 'toolchain_blocked') throw new Error('device_toolchain 类映射失败');
      if (resolveBlockerActionability({ id: 'capture_completeness_external' }) !== 'agent_fixable') throw new Error('external 应 agent_fixable（生命周期起点）');
      if (resolveBlockerActionability({ id: 'totally_unknown_gate' }) !== 'agent_fixable') throw new Error('未登记缺省应 agent_fixable（行为不变）');
    },
  },
  {
    name: 'aggregate: 求人谓词=非空且全 human_only；∃toolchain 单独轴',
    run: () => {
      const empty = aggregateBlockerActionability(S([]));
      if (empty.allHumanOnly) throw new Error('空集不得判全 human_only');
      const mixed = aggregateBlockerActionability(S([
        { id: 'capture_completeness_external' },
        { id: 'fidelity_deferrals_human_sign' },
      ]));
      if (mixed.allHumanOnly) throw new Error('仍有 agent_fixable 不得判全 human_only');
      const pureHuman = aggregateBlockerActionability(S([{ id: 'fidelity_deferrals_human_sign' }]));
      if (!pureHuman.allHumanOnly) throw new Error('全 human_only 未判出');
    },
  },
  {
    name: '4-step: timeout+仅 toolchain → await_operator_toolchain',
    run: () => {
      const r = classifyTimedOutWithFreshBlockers(S([{ id: 'capture_completeness_external_ocr_unavailable' }]));
      if (r !== 'await_operator_toolchain') throw new Error(String(r));
    },
  },
  {
    name: '4-step: timeout+toolchain+human → toolchain 先（②步）',
    run: () => {
      const r = classifyTimedOutWithFreshBlockers(S([
        { id: 'capture_completeness_external_ocr_unavailable' },
        { id: 'fidelity_deferrals_human_sign' },
      ]));
      if (r !== 'await_operator_toolchain') throw new Error(String(r));
    },
  },
  {
    name: '4-step: timeout+toolchain+agent_fixable → 仍 await_operator_toolchain（环境不修重试无义）',
    run: () => {
      const r = classifyTimedOutWithFreshBlockers(S([
        { id: 'capture_completeness_external_ocr_unavailable' },
        { id: 'capture_completeness_external' },
      ]));
      if (r !== 'await_operator_toolchain') throw new Error(String(r));
    },
  },
  {
    name: '4-step: timeout+仅 human blocker → await_human_gate_deferral（不落 agent_timeout）',
    run: () => {
      const r = classifyTimedOutWithFreshBlockers(S([{ id: 'fidelity_deferrals_human_sign' }]));
      if (r !== 'await_human_gate_deferral') throw new Error(String(r));
    },
  },
  {
    name: '4-step: agent_fixable 在场 → null（走内容重试/agent_timeout 既有语义）',
    run: () => {
      const r = classifyTimedOutWithFreshBlockers(S([
        { id: 'capture_completeness_external' },
        { id: 'fidelity_deferrals_human_sign' },
      ]));
      if (r !== null) throw new Error(String(r));
    },
  },
  {
    name: 'signature: human_only 不入 no-progress 签名',
    run: () => {
      const sig = buildEffectiveBlockerSignature(
        S([{ id: 'capture_completeness_external' }, { id: 'fidelity_deferrals_human_sign' }]),
        'spec_capture_gap',
        'spec',
      );
      if (sig !== 'capture_completeness_external') throw new Error(`sig=${sig}`);
      const onlyHuman = buildEffectiveBlockerSignature(
        S([{ id: 'fidelity_deferrals_human_sign' }]),
        'agent_timeout',
        'spec',
      );
      if (onlyHuman !== 'agent_timeout@spec') throw new Error(`onlyHuman=${onlyHuman}——全 human_only 应回退专用签名`);
      const untouched = filterSignatureBlockers(S([{ id: 'a' }, { id: 'b' }]));
      if ((untouched?.blockers ?? []).length !== 2) throw new Error('无 human_only 时不得改 summary');
    },
  },
  {
    name: 'classify: capture_completeness* → spec_capture_gap（不再 code_regression、不入 SIGNATURE_HALT_KINDS）',
    run: () => {
      const kind = classifyFailureKind(S([
        { id: 'capture_completeness' },
        { id: 'capture_completeness_external' },
      ]));
      if (kind !== 'spec_capture_gap') throw new Error(`kind=${kind}`);
      if (SIGNATURE_HALT_KINDS.has('spec_capture_gap' as never)) throw new Error('不得入 SIGNATURE_HALT_KINDS');
      if (!isSpecCaptureGapBlockerId('capture_completeness_external')) throw new Error('族判定失败');
      // ocr_unavailable 被 toolchain 先行吸收
      const toolKind = classifyFailureKind(S([{ id: 'capture_completeness_external_ocr_unavailable' }]));
      if (toolKind !== 'toolchain') throw new Error(`ocr_unavailable kind=${toolKind}`);
    },
  },
  {
    name: '回喂过滤: 严格 ===agent_fixable——human_only/toolchain 各自 parked，不进正文',
    run: () => {
      const text = extractPriorFailureContext({
        verdict: 'FAIL',
        blockers: [
          { id: 'capture_completeness_external', details_excerpt: 'OCR 未覆盖行……', suggestion: '补建模' },
          { id: 'fidelity_deferrals_human_sign', details_excerpt: '须真人签字', suggestion: '人签' },
          { id: 'capture_completeness_external_ocr_unavailable', details_excerpt: 'OCR 引擎缺失', suggestion: '修环境' },
        ],
      } as never);
      if (!text.includes('capture_completeness_external')) throw new Error('agent_fixable 丢失');
      if (!/parked, human-only/.test(text)) throw new Error('human_only 未标注 parked');
      if (/fidelity_deferrals_human_sign \[/.test(text) || text.includes('须真人签字')) {
        throw new Error('human_only 详情不得进入回喂正文');
      }
      // post-impl review P2#8：toolchain_blocked 同样不得回喂（agent 修不了环境）
      if (!/parked, environment\/toolchain/.test(text)) throw new Error('toolchain 未标注 parked');
      if (text.includes('OCR 引擎缺失') || text.includes('修环境')) {
        throw new Error('toolchain 详情不得进入回喂正文');
      }
    },
  },
  {
    // post-impl round2 P1#3：helper 对 PASS 返回 false **不是**「PASS+超时可以 retry」——
    // PASS+超时走 advance_blocked → closure 分类：probe=passed → deterministic（runner 自己
    // 关环，零 agent attempt）；probe=missing/failed → runner 侧 repair+timedOut 拦截同样
    // halt closure_timeout（goal-runner 分类块），任何 closure 超时都不回内容重试。
    name: 'closure_timeout: closure-only 超时 FAIL→halt；PASS 由分类块处置（deterministic 或 closure_timeout），均不回内容重试',
    run: () => {
      if (!shouldHaltClosureTimeout(true, 'agent_timeout', 'FAIL')) throw new Error('closure 超时应 halt');
      if (shouldHaltClosureTimeout(false, 'agent_timeout', 'FAIL')) throw new Error('内容 attempt 不受影响');
      if (shouldHaltClosureTimeout(true, 'code_regression', 'FAIL')) throw new Error('非超时不拦');
      if (shouldHaltClosureTimeout(true, 'agent_timeout', 'PASS')) {
        throw new Error('PASS 超时由 closure 分类块处置（passed→deterministic / 其余→closure_timeout），helper 不重复拦');
      }
    },
  },
  {
    // round4 P1#3：deterministic sync 分流矩阵（runner 消费同一纯函数——控制流契约锁定；
    // 目标组合=sync 失败 + closureOnly + timed_out → closure_timeout，不回内容重试）
    name: 'resolveClosureSyncOutcome: sync 成功→advance；失败+closureOnly+超时→closure_timeout；失败未超时→repair',
    run: () => {
      if (resolveClosureSyncOutcome(0, true, true) !== 'advance') throw new Error('sync 成功应 advance');
      if (resolveClosureSyncOutcome(0, false, false) !== 'advance') throw new Error('sync 成功恒 advance');
      if (resolveClosureSyncOutcome(1, true, true) !== 'closure_timeout') {
        throw new Error('目标组合（sync 失败+closureOnly+超时）必须 closure_timeout');
      }
      if (resolveClosureSyncOutcome(1, true, false) !== 'repair_retry') throw new Error('未超时回落 repair');
      if (resolveClosureSyncOutcome(1, false, true) !== 'repair_retry') throw new Error('非 closure attempt 不受影响');
    },
  },
  {
    name: 'e2e 回放 B（合成夹具）: external 已清、仅剩 fidelity_deferrals_human_sign → 一次 FAIL 即求人',
    run: () => {
      // 夹具态=「字段已正名、可建模 OCR 行已全部建模清零、agent 已写 defer 但无人签」
      const synthetic = S([{
        id: 'fidelity_deferrals_human_sign',
        classification: undefined,
        details_excerpt: 'pixel_1to1 下 fidelity_deferrals 须真人签字；未签字：result_icon_fail',
      } as never]);
      const agg = aggregateBlockerActionability(synthetic);
      if (!agg.allHumanOnly) throw new Error('夹具态应判全 human_only');
      if (classifyTimedOutWithFreshBlockers(synthetic) !== 'await_human_gate_deferral') {
        throw new Error('应一次 FAIL 即 await_human_gate_deferral（AWAITING_HUMAN_REVIEW 语义）');
      }
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

/**
 * fidelity-intent-init — plan f6b2d9a4 T2：phase-driven 路由初始化 CLI。
 *
 * 责任冻结（v7）：流程所有者=skills/feature/spec Step 1（在生成 spec.md **之前**调用）；
 * 唯一执行实现=本 CLI → initializeFidelityRouting（runner-owned）；cursor/claude/codex
 * 薄入口只透传输入+引导读 Skill（agent-adapters「薄入口不含 skill 逻辑」约束）；
 * harness-runner/check-spec 只加载+复核（fidelity_capability_pregate）。
 * goal 模式不走本 CLI——goal-runner preflight 在 agent invoke 前调用同一 initializer。
 *
 * 产物：<feature>/spec/reports/capability-snapshot.json + fidelity-intent.json（唯一 SSOT：
 * inferred/selected/effective 三段位 + acceptance_strictness + asset_acquisition_mode +
 * decision{source, rationale, decision_id}）。
 *
 * 用法：
 *   node scripts/fidelity-intent-init.ts --feature <f> [--requirement "<需求文本>"]
 * 缺省需求来源：feature 根目录需求文档（*.md/*.txt）+ spec.md（与 check-spec 意图收集同源）。
 */

import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadFrameworkConfig } from '../config';
import { loadResolvedProfile } from '../profile-loader';
import { initializeFidelityRouting } from './utils/goal-preflight';
import { computeRequirementShaFromText, loadFidelityIntentSsotState } from './utils/fidelity-shared';
import { collectIntentTextWithPhaseFallback } from './check-spec';

/** post-impl2 P1-3：SSOT 生命周期四态判据（可测纯函数）——
 * missing → init（goal env 也不再盲跳，修「缺失+goal env 死循环」）；
 * valid ∧ 需求 sha 匹配 → reuse；
 * valid ∧ sha 失配 → init（stale 自动重建——用户改需求单独跑 /spec 不再沿用旧决策）；
 * valid ∧ 无法重算 sha ∧ goal 首产身份 → reuse（保守不覆盖 goal 决策）；
 * corrupt → init（runner-owned 受控重建）。 */
export function phaseInitDecision(
  state:
    | { state: 'missing' }
    | { state: 'corrupt' }
    | { state: 'valid'; doc: { execution_identity: string; requirement_sha256: string } },
  newRequirementSha: string | null,
  opts?: { activeGoalRunId?: string | null },
): 'reuse' | 'init' {
  if (state.state !== 'valid') return 'init';
  // post-impl4 P1-3：只保护**当前活跃 goal**的决策（identity == 活跃 run_id）——历史
  // 已结束 goal 的残留不复用（同需求换 adapter/模型后独立 /spec 必须重新探测能力）；
  // phase-owned 一律幂等重算。
  const activeGoalMatch = Boolean(
    opts?.activeGoalRunId && state.doc.execution_identity === opts.activeGoalRunId,
  );
  if (activeGoalMatch && newRequirementSha && state.doc.requirement_sha256 === newRequirementSha) return 'reuse';
  if (activeGoalMatch && !newRequirementSha) return 'reuse';
  return 'init';
}

function main(): number {
  const argv = minimist(process.argv.slice(2), { string: ['feature', 'requirement'] });
  const feature = typeof argv.feature === 'string' ? argv.feature.trim() : '';
  if (!feature) {
    console.error('[fidelity-intent-init] BLOCKER: --feature 必填');
    return 1;
  }
  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDirRel = (cfg.paths.features_dir ?? 'doc/features').replace(/\\/g, '/');
  const requirementEarly =
    typeof argv.requirement === 'string' && argv.requirement.trim()
      ? argv.requirement
      : collectIntentTextWithPhaseFallback(projectRoot, feature, featuresDirRel);
  const newSha = requirementEarly
    ? computeRequirementShaFromText(projectRoot, feature, requirementEarly, featuresDirRel)
    : null;
  const state = loadFidelityIntentSsotState(projectRoot, feature);
  const activeGoalRunId = process.env.MAISON_GOAL_RUN_ID?.trim() || null;
  if (phaseInitDecision(state, newSha, { activeGoalRunId }) === 'reuse') {
    const doc = (state as { doc: { execution_identity: string } }).doc;
    console.log(
      `[fidelity-intent-init] SSOT 有效且需求未变（identity=${doc.execution_identity}）——复用不覆盖（writer 唯一）。`,
    );
    return 0;
  }
  if (state.state === 'corrupt') {
    console.warn('[fidelity-intent-init] 既存 SSOT 损坏——runner-owned 受控重建。');
  }
  const requirement = requirementEarly;
  const { routing } = initializeFidelityRouting({
    projectRoot,
    frameworkRoot: layout.frameworkRoot,
    feature,
    requirement: requirement || undefined,
    featuresDirRel,
    // 无 goal run_id 的显式 phase execution identity（v4 P1-1：禁 undefined+sha 含混 ID）
    executionIdentity: `phase:${feature}:spec`,
    adapter: cfg.agent_adapter,
    profileDir: loadResolvedProfile(projectRoot, cfg).profileDir,
  });
  console.log(
    `[fidelity-intent-init] ${routing.decision.rationale}（source=${routing.decision.source}，` +
    `decision_id=${routing.decision.decision_id}）`,
  );
  if (routing.defer) {
    console.error(
      '[fidelity-intent-init] 注意：pixel_1to1 + hard + 能力不足=真冲突——spec 门禁将按 ' +
      'DEFERRED_CAPABILITY_MISSING 拦截（换视觉模型 / 降档 receipt / 放宽需求严格度）。',
    );
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

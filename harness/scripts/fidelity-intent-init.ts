/**
 * fidelity-intent-init — plan f6b2d9a4 T2：phase-driven 路由初始化 CLI。
 *
 * 责任冻结（v7）：流程所有者=skills/feature/spec Step 1（在生成 spec.md **之前**调用）；
 * 唯一执行实现=本 CLI → initializeFidelityRouting（runner-owned）；cursor/claude/codex
 * 薄入口只透传输入+引导读 Skill（agent-adapters「薄入口不含 skill 逻辑」约束）；
 * harness-runner/check-spec 只加载+复核（fidelity_capability_pregate）。
 * attended goal 模式由 phase_execute_request 显式透传 --goal-run-id，并在写盘前校验
 * 精确 run / feature / session owner / lease；detached goal 仍由 goal-runner preflight
 * 在 agent invoke 前调用同一 initializer。
 *
 * 产物：<feature>/spec/reports/capability-snapshot.json + fidelity-intent.json（唯一 SSOT：
 * inferred/selected/effective 三段位 + acceptance_strictness + asset_acquisition_mode +
 * decision{source, rationale, decision_id}）。
 *
 * 用法：
 *   node scripts/fidelity-intent-init.ts --feature <f> [--requirement "<需求文本>"]
 *   node scripts/fidelity-intent-init.ts --feature <f> [--requirement-file <path>]
 *   node scripts/fidelity-intent-init.ts --feature <f> --goal-run-id <run_id> --goal-phase spec
 *     --goal-attempt-id <attempt_id> --goal-owner-id <owner_id> --goal-owner-epoch <epoch>
 * `--requirement` 与 `--requirement-file` 互斥（共享 goal-manifest 的 resolveRequirementInput，
 * fail-closed）；显式传了空/纯空白 `--requirement` 也会 fail-fast（不得静默降级成宽泛意图文本）。
 * 缺省需求来源：feature 根目录需求文档（*.md/*.txt）+ spec.md（与 check-spec 意图收集同源）；
 * 该缺省属 `intent_fallback` provenance，**不**解锁 derive.requirement（见 plan c8e5b3f1）。
 */

import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadFrameworkConfig } from '../config';
import { loadResolvedProfile } from '../profile-loader';
import { initializeFidelityRouting } from './utils/goal-preflight';
import { resolveRequirementInput } from './utils/goal-manifest';
import { computeRequirementShaFromText, loadFidelityIntentSsotState } from './utils/fidelity-shared';
import { validateAttendedGoalContext } from './utils/attended-goal-context';
import { loadLocalConfig } from './utils/framework-local-config';
import { resolveUnattendedVisualProviderPin } from './utils/visual-provider-identity';
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
  const argv = minimist(process.argv.slice(2), {
    string: [
      'feature', 'requirement', 'requirement-file', 'goal-run-id', 'goal-phase',
      'goal-attempt-id', 'goal-owner-id', 'goal-owner-epoch',
    ],
  });
  const feature = typeof argv.feature === 'string' ? argv.feature.trim() : '';
  if (!feature) {
    console.error('[fidelity-intent-init] BLOCKER: --feature 必填');
    return 1;
  }
  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDirRel = (cfg.paths.features_dir ?? 'doc/features').replace(/\\/g, '/');
  const attendedGoalRunId =
    typeof argv['goal-run-id'] === 'string' ? argv['goal-run-id'].trim() : '';
  const attendedFlagNames = [
    'goal-run-id', 'goal-phase', 'goal-attempt-id', 'goal-owner-id', 'goal-owner-epoch',
  ] as const;
  const anyAttendedFlag = attendedFlagNames.some((name) => Object.prototype.hasOwnProperty.call(argv, name));
  if (anyAttendedFlag && !attendedGoalRunId) {
    console.error('[fidelity-intent-init] BLOCKER: attended goal 上下文缺有效 --goal-run-id');
    return 1;
  }
  let attendedManifest: ReturnType<typeof validateAttendedGoalContext>['manifest'] | null = null;
  if (attendedGoalRunId) {
    try {
      const goalPhase = String(argv['goal-phase'] ?? '').trim();
      if (goalPhase !== 'spec') {
        throw new Error('fidelity initializer 的 attended --goal-phase 必须为 spec');
      }
      attendedManifest = validateAttendedGoalContext({
        projectRoot,
        feature,
        runId: attendedGoalRunId,
        phase: goalPhase,
        attemptId: String(argv['goal-attempt-id'] ?? '').trim(),
        ownerId: String(argv['goal-owner-id'] ?? '').trim(),
        ownerEpoch: Number(argv['goal-owner-epoch']),
      }).manifest;
    } catch (error) {
      console.error(`[fidelity-intent-init] BLOCKER: ${(error as Error).message}`);
      return 1;
    }
  }
  // plan c8e5b3f1 t1-②：局部预检 + 共享 resolver。顺序固定：
  // ① 先看原始 flag——用户**显式给了** --requirement 但 trim 后为空 → fail-fast（即便同时
  //    给了有效 --requirement-file，也不许 file 分支把这个显式空值盖过去；resolver 在该组合
  //    下会静默采用 file，:459，故必须由本 CLI 预检拦下，共享 resolver 一行不改）。
  const explicitRequirement = typeof argv.requirement === 'string' ? argv.requirement : undefined;
  if (!attendedManifest && explicitRequirement !== undefined && explicitRequirement.trim().length === 0) {
    console.error(
      '[fidelity-intent-init] BLOCKER: --requirement 显式给了空/纯空白值——需求不能为空，' +
        '也不得静默降级读宽泛意图文本解锁。请提供非空需求文本，或用 --requirement-file 指向非空文件。',
    );
    return 1;
  }
  // ② 再交给 resolveRequirementInput 做既有的互斥 / projectRoot 相对路径解析 / 读文件 / 空文件判定。
  // plan c4e8a1f7 T2：返回 text + sources——来源列表随 SSOT 可选字段保留（不建第二份图片清单）。
  let resolvedExplicit: ReturnType<typeof resolveRequirementInput> = { text: undefined, sources: [] };
  if (!attendedManifest) {
    try {
      resolvedExplicit = resolveRequirementInput({
        requirement: explicitRequirement,
        requirementFile: argv['requirement-file'],
        projectRoot,
      });
    } catch (error) {
      console.error(`[fidelity-intent-init] BLOCKER: ${(error as Error).message}`);
      return 1;
    }
  }
  const resolvedText = attendedManifest?.requirement ?? resolvedExplicit.text;
  const explicitNonEmpty = Boolean(!attendedManifest && resolvedText && resolvedText.trim());
  const requirementProvenance = attendedManifest
    ? 'goal_manifest'
    : explicitNonEmpty
      ? 'explicit_cli'
      : 'intent_fallback';
  const requirementEarly = attendedManifest
    ? attendedManifest.requirement?.trim()
    : explicitNonEmpty
      ? resolvedText!
      : collectIntentTextWithPhaseFallback(projectRoot, feature, featuresDirRel);
  if (attendedManifest && !requirementEarly) {
    console.error('[fidelity-intent-init] BLOCKER: goal manifest requirement 缺失或为空');
    return 1;
  }
  const adapter = attendedManifest?.adapter?.trim() || (!attendedManifest ? cfg.agent_adapter : '');
  if (attendedManifest && !adapter) {
    console.error('[fidelity-intent-init] BLOCKER: goal manifest adapter 缺失或为空');
    return 1;
  }
  const requirementSourceFiles = attendedManifest?.requirement_source_files ?? resolvedExplicit.sources;
  const newSha = requirementEarly
    ? computeRequirementShaFromText(projectRoot, feature, requirementEarly, featuresDirRel)
    : null;
  const state = loadFidelityIntentSsotState(projectRoot, feature);
  const activeGoalRunId = attendedGoalRunId || process.env.MAISON_GOAL_RUN_ID?.trim() || null;
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
    // attended goal 绑定显式 run_id；手动 phase 使用稳定的 phase identity。
    executionIdentity: attendedGoalRunId || `phase:${feature}:spec`,
    adapter,
    profileDir: loadResolvedProfile(projectRoot, cfg).profileDir,
    ...(attendedManifest?.fidelity ? { manifestFidelity: attendedManifest.fidelity } : {}),
    ...(attendedManifest?.fidelity_receipt
      ? { fidelityReceiptRel: attendedManifest.fidelity_receipt }
      : {}),
    ...(attendedManifest?.adapter_model_pin
      ? { modelPin: attendedManifest.adapter_model_pin.value }
      : {}),
    // plan ab072691 t2①：视觉委托身份——attended goal 用 manifest 冻结值（不重读 local，
    // 与 model pin 同纪律）；普通交互态（无 attended manifest）读个人级 local。
    // 交互态读到已失效的旧配置只 WARN + 忽略并落 blind：档位初始化不是询问点，
    // 询问/重选在 personal setup 门控里发生（registry setup.visual_provider）。
    ...(() => {
      if (attendedManifest) {
        return attendedManifest.visual_provider_pin
          ? { visualProviderPin: attendedManifest.visual_provider_pin }
          : {};
      }
      const resolved = resolveUnattendedVisualProviderPin(
        loadLocalConfig(projectRoot),
        layout.frameworkRoot,
      );
      if (resolved.warning) console.warn(resolved.warning);
      return resolved.pin ? { visualProviderPin: resolved.pin } : {};
    })(),
    ...(attendedGoalRunId ? { runIdForReceipt: attendedGoalRunId } : {}),
    requirementProvenance,
    ...(requirementSourceFiles.length > 0
      ? { requirementSourceFiles }
      : {}),
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

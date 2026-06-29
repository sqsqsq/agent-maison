/**
 * goal-runner preflight — adapter-aware / provenance-aware (not bare personal-setup gate).
 */

import type { FrameworkPersonalSetupStatus } from '../../config';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';
import type { GoalManifest } from './goal-manifest';
import {
  adapterEntryExists,
  evaluatePersonalSetupGate,
  resolveProjectMaterializedForGate,
} from './personal-setup-gate';
import { loadLocalConfig } from './framework-local-config';
import { evaluateConfigPlacementGate } from './config-placement-gate';
import {
  unionPhasePersonalPrerequisites,
  type PersonalPrerequisiteId,
} from './phase-personal-prerequisites';
import type { FeaturePhase } from './phase-transition-policy';
import {
  loadGoalCapability,
  validateGoalCapabilityForRunner,
} from './goal-adapter-capability';
import { resolveGoalEffectiveImageInput } from './multimodal-probe';
import {
  resolveHeadlessInvokePlan,
  validateHeadlessBinaryForPlan,
  type InvokeTemplateVars,
} from './agent-invoke';

export type AdapterProvenance =
  | 'argv_adapter'
  | 'manifest_adapter'
  | 'config_local'
  | 'config_legacy'
  | 'fallback';

export function resolveAdapterProvenance(
  argv: { adapter?: string; manifest?: string; resume?: string },
  adapterStatus: FrameworkPersonalSetupStatus,
): AdapterProvenance {
  if (argv.adapter?.trim()) return 'argv_adapter';
  if (argv.manifest?.trim() || argv.resume?.trim()) return 'manifest_adapter';
  if (adapterStatus.source === 'local') return 'config_local';
  if (adapterStatus.source === 'project_legacy') return 'config_legacy';
  return 'fallback';
}

/** 运行身份语义来源（写入 manifest.adapter_provenance，供回溯）。 */
export type RunAdapterProvenance =
  | 'user_explicit'
  | 'entry_declared'
  | 'local_config'
  | 'registry'
  | 'override';

export interface RunAdapterDecision {
  effectiveAdapter: string;
  provenance: RunAdapterProvenance;
  /** override 时须把 requested 回写 framework.local.json（goal 流程内唯一写盘例外） */
  writeLocal: boolean;
}

/**
 * 运行身份对账（纯函数·只读）：framework.local.json agent_adapter 为权威 SSOT。
 *   - requested 非法（不在 materialized / 入口缺）→ STOP；
 *   - --override-adapter：唯一写盘例外，须有合法 requested，否则 STOP；
 *   - requested 与合法 local 冲突且无 override → STOP（调用方据此在写 manifest 前阻断）；
 *   - 有合法 local（requested 缺省或相等）→ effective=local（local_config）；
 *   - 首启（无合法 local）且有合法 requested → effective=requested（按 adapterSource 标 provenance）；
 *   - requested 与 local 皆缺 → STOP（永不默认 claude/cursor）。
 * 阶梯（用户显式/跳板/registry）只产 requested；local 不是阶梯一级，而是 effective 权威。
 */
export function reconcileRunAdapter(opts: {
  projectRoot: string;
  /** 原始 argv.adapter 或 manifest.adapter，不先归一 */
  requestedAdapter?: string;
  override: boolean;
  /** agent 阶梯 rung：user_explicit|entry_declared|registry（仅首启 argv 生效时用于标 provenance） */
  adapterSource?: string;
}): RunAdapterDecision {
  const { projectRoot, override } = opts;
  const requested = opts.requestedAdapter?.trim() || undefined;
  const materialized = resolveProjectMaterializedForGate(projectRoot);
  const isValid = (a: string | undefined): a is string =>
    Boolean(a && materialized.includes(a) && adapterEntryExists(projectRoot, a));
  const localRaw = loadLocalConfig(projectRoot)?.agent_adapter?.trim() || undefined;
  const localValid = isValid(localRaw);

  if (requested && !isValid(requested)) {
    throw new Error(
      `[goal-runner] adapter BLOCKER: 请求的 adapter "${requested}" 不在已物化候选 [${materialized.join(', ')}] 或入口未物化；` +
        '改选已物化项或先跑 /framework-init。',
    );
  }

  if (override) {
    if (!requested) {
      throw new Error(
        '[goal-runner] adapter BLOCKER: --override-adapter 须配合 --adapter <已物化 adapter>（无目标可回写）。',
      );
    }
    return { effectiveAdapter: requested, provenance: 'override', writeLocal: true };
  }

  // 损坏/过期 SSOT 不静默忽略：local 有记录却非法（不在 materialized / 入口缺）→ STOP（override 上面已放行）。
  if (localRaw && !localValid) {
    throw new Error(
      `[goal-runner] adapter BLOCKER: framework.local.json 记录的 agent_adapter "${localRaw}" 非法/未物化（不在 [${materialized.join(', ')}] 或入口缺）。` +
        '请修 framework.local.json（或重跑 record-adapter），或显式 --override-adapter 切换；不静默忽略损坏的 SSOT。',
    );
  }

  if (requested && localValid && requested !== localRaw) {
    throw new Error(
      `[goal-runner] adapter BLOCKER: framework.local.json 记录运行身份 "${localRaw}"，本次却请求 "${requested}"。` +
        '请改 framework.local.json（或重选 record-adapter）保持一致，或显式加 --override-adapter 临时切换；不静默用猜测覆盖你记录的身份。',
    );
  }

  if (localValid) {
    return { effectiveAdapter: localRaw!, provenance: 'local_config', writeLocal: false };
  }

  if (requested) {
    const src = opts.adapterSource?.trim();
    const provenance: RunAdapterProvenance =
      src === 'user_explicit' || src === 'registry' ? src : 'entry_declared';
    return { effectiveAdapter: requested, provenance, writeLocal: false };
  }

  throw new Error(
    '[goal-runner] adapter BLOCKER: 未解析到运行身份（无 --adapter，framework.local.json 也无合法 agent_adapter）。' +
      '请由 goal-mode 入口完成 check-personal-setup（或加 --adapter <已物化 adapter>）；永不默认 claude/cursor。',
  );
}

export interface GoalPreflightInput {
  projectRoot: string;
  frameworkRoot: string;
  manifest: GoalManifest;
  provenance: AdapterProvenance;
  dryRun: boolean;
  chain: FeaturePhase[];
  resolvedProfile: HarnessResolvedProfile;
}

export function runGoalPreflight(input: GoalPreflightInput): void {
  const { projectRoot, frameworkRoot, manifest, provenance, dryRun, chain, resolvedProfile } =
    input;
  const adapter = manifest.adapter?.trim();
  if (!adapter) {
    throw new Error('[goal-runner] preflight BLOCKER: manifest.adapter 缺失');
  }
  if (!manifest.feature?.trim()) {
    throw new Error('[goal-runner] preflight BLOCKER: manifest.feature 缺失');
  }

  const placement = evaluateConfigPlacementGate(projectRoot);
  if (!placement.ok) {
    throw new Error(
      `[goal-runner] preflight BLOCKER: ${placement.message}` +
        ' Step1: migrate-config；Step2: check-personal-setup --ensure。',
    );
  }

  const materialized = resolveProjectMaterializedForGate(projectRoot);
  if (materialized.length > 0 && !materialized.includes(adapter)) {
    throw new Error(
      `[goal-runner] preflight BLOCKER: adapter "${adapter}" 不在项目 materialized_adapters` +
        ` [${materialized.join(', ')}]；请改选已物化项或先跑 /framework-init 物化。`,
    );
  }

  if (!adapterEntryExists(projectRoot, adapter)) {
    throw new Error(
      `[goal-runner] preflight BLOCKER: adapter ${adapter} 入口产物未物化；请先跑项目级 /framework-init。`,
    );
  }

  const cap = loadGoalCapability(frameworkRoot, adapter);
  const v = validateGoalCapabilityForRunner(frameworkRoot, adapter, manifest.unattended);
  if (!v.ok) {
    throw new Error(`[goal-runner] preflight BLOCKER:\n${v.issues.map((i) => `  - ${i}`).join('\n')}`);
  }

  if (provenance === 'fallback') {
    throw new Error(
      '[goal-runner] preflight BLOCKER: 未检测到个人 Framework 设置（framework.local.json）。' +
        '请由 goal-mode 入口执行 check-personal-setup.ts --json --ensure 完成个人配置，' +
        '或显式传 --adapter <已物化 adapter>。',
    );
  }

  const prereqs = unionPhasePersonalPrerequisites(chain, resolvedProfile);
  // argv/manifest 已显式声明 adapter；仅 deveco 等 toolchain prerequisite 不可豁免
  if (provenance === 'argv_adapter' || provenance === 'manifest_adapter') {
    prereqs.delete('agent_adapter');
  }
  const gate = evaluatePersonalSetupGate(projectRoot, {
    requiredPrerequisites: prereqs,
  });
  if (!gate.ok) {
    throw new Error(`[goal-runner] preflight BLOCKER: ${gate.message}`);
  }

  // argv_adapter 不豁免 deveco readiness（已在 evaluatePersonalSetupGate 校验）

  const vars: InvokeTemplateVars = {
    PROMPT_FILE: '',
    PROMPT: 'preflight-probe',
    SKILL_PATH: '',
    PROJECT_ROOT: projectRoot,
    FRAMEWORK_ROOT: frameworkRoot,
    FEATURE: manifest.feature,
    PHASE: manifest.start_phase,
  };
  const plan = resolveHeadlessInvokePlan(
    adapter,
    cap.capability!,
    manifest.unattended,
    vars.PROMPT,
    vars,
  );
  const binaryCheck = validateHeadlessBinaryForPlan(adapter, plan);
  if (!binaryCheck.ok) {
    if (dryRun) {
      console.warn(`[goal-runner] preflight WARN: ${binaryCheck.message}`);
      return;
    }
    throw new Error(binaryCheck.message);
  }

  const effectiveMm = resolveGoalEffectiveImageInput(
    projectRoot,
    frameworkRoot,
    adapter,
    manifest.unattended,
  );
  if (
    effectiveMm.imageInput === 'none' &&
    effectiveMm.reason.includes('缺 Read')
  ) {
    console.warn(
      `[goal-runner] preflight WARN: image_input 声明 tool_read 但 goal allowed_tools 缺 Read；` +
        `运行时视觉多模态将诚实降级为 none（${effectiveMm.reason}）`,
    );
  }
}

export function goalRequiredPrerequisites(
  chain: FeaturePhase[],
  resolvedProfile: HarnessResolvedProfile,
): Set<PersonalPrerequisiteId> {
  return unionPhasePersonalPrerequisites(chain, resolvedProfile);
}

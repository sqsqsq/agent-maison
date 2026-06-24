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

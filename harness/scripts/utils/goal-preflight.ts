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
import * as path from 'path';
import { loadLocalConfig, writeLocalConfig, LOCAL_SCHEMA_VERSION } from './framework-local-config';
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
import { resolveGoalEffectiveImageInput, isVisionCanaryFresh } from './multimodal-probe';
import {
  invokeAgentHeadless,
  resolveHeadlessInvokePlan,
  validateHeadlessBinaryForPlan,
  type InvokeTemplateVars,
} from './agent-invoke';
import { resolveUiRelevanceForRun } from './fidelity-shared';
import {
  ensureVisionCanaryAsset,
  buildCanaryPrompt,
  resolveCanaryCacheDecision,
  VISION_CANARY_PROBE_VERSION,
} from './vision-canary';

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

export type VisionCanaryProbeSkipReason =
  | 'dry_run'
  | 'chain_has_no_ui_phase'
  | 'not_ui_relevant'
  | 'local_override_present'
  | 'fresh_cache_present'
  | 'no_capability_declared';

export type VisionCanaryProbeDecision =
  | { action: 'skip'; reason: VisionCanaryProbeSkipReason }
  | { action: 'probe' };

/**
 * E1：是否该触发金丝雀实测的**纯决策**（无 I/O 副作用之外——只读 framework.local.json，
 * 不写、不 spawn agent），与实际执行（runVisionCanaryProbe）分离，便于独立单测。
 * 触发条件：非 dry-run + chain 含 spec/coding + 需求 UI 相关 + 无 local override +
 * （无缓存 或 缓存 adapter≠当前 或 --refresh-vision-probe 强制）。
 */
export function decideVisionCanaryProbe(input: {
  projectRoot: string;
  manifest: GoalManifest;
  chain: FeaturePhase[];
  dryRun: boolean;
  forceRefresh?: boolean;
}): VisionCanaryProbeDecision {
  const { projectRoot, manifest, chain, dryRun, forceRefresh } = input;
  if (dryRun) return { action: 'skip', reason: 'dry_run' };
  if (!chain.includes('spec') && !chain.includes('coding')) {
    return { action: 'skip', reason: 'chain_has_no_ui_phase' };
  }
  // codex review（E6 后）：优先信已存在的 spec.md ui_change 声明（resume/继续 coding 场景
  // requirement 文本常很短，不能只靠文本启发式——否则会漏判 UI 相关性，跳过金丝雀探测。
  if (!resolveUiRelevanceForRun(projectRoot, manifest.feature, manifest.requirement)) {
    return { action: 'skip', reason: 'not_ui_relevant' };
  }
  const adapter = (manifest.adapter ?? 'generic').trim() || 'generic';
  let local: ReturnType<typeof loadLocalConfig>;
  try {
    local = loadLocalConfig(projectRoot);
  } catch {
    local = null; // 格式有误不阻断探测决策——回退当作"无缓存"
  }
  if (local?.vision?.image_input_override) {
    return { action: 'skip', reason: 'local_override_present' };
  }
  // I2：新鲜度单点判据（超龄 interactive 缓存不算新鲜 → 重探；goal 缓存不受 TTL 影响）。
  const canary = local?.vision?.canary;
  if (!forceRefresh && isVisionCanaryFresh(canary, adapter)) {
    return { action: 'skip', reason: 'fresh_cache_present' };
  }
  return { action: 'probe' };
}

export type VisionCanaryProbeOutcome =
  | 'valid_cached'
  | 'invalid_not_cached'
  | 'invoke_failed_not_cached';

/**
 * E1：实际执行金丝雀探测——生成资产、headless 问答、严格判卷、按有效性决定是否写缓存。
 * 【诚实声明】本函数默认会真实 spawn 一次 headless agent 调用（真实成本，同 goal-runner
 * 本身每 phase 的调用性质一致，非额外风险类别）；invokeFn 注入供单测覆盖写盘边界
 * （plan c7d2e9a4 t6——事故真正发生地在"invoke → 写盘"之间，不能只测纯函数）。
 * 写盘守卫（t2/t3）：resolveCanaryCacheDecision 消费完整调用事实——invoke 失败/无效答卷
 * （空输出/额度错误文本/prompt echo/残卷）一律**不落缓存**（消费面按既有语义回退：盘上有
 * fresh last-known-good 则沿用，否则 adapter 声明路径——stale-if-error，日志由 goal-runner
 * 按盘上缓存现查二分）；只有有效作答（严格解析的 canonical answer）才 classify 并连同
 * probe_version 写盘。异常降级：探测异常不抛出、不阻断 goal run，探测失败不是 BLOCKER。
 */
export async function runVisionCanaryProbe(input: {
  projectRoot: string;
  frameworkRoot: string;
  manifest: GoalManifest;
  /** 单测注入（默认真实 invokeAgentHeadless），覆盖"invoke→写盘"边界免真 spawn */
  invokeFn?: typeof invokeAgentHeadless;
}): Promise<{
  ran: boolean;
  outcome?: VisionCanaryProbeOutcome;
  verdict?: 'tool_read' | 'ocr_capable' | 'none';
  error?: string;
}> {
  const { projectRoot, frameworkRoot, manifest } = input;
  const adapter = (manifest.adapter ?? 'generic').trim() || 'generic';
  try {
    const assetsDir = path.join(frameworkRoot, 'harness', 'assets');
    const { imagePath } = await ensureVisionCanaryAsset(assetsDir);
    const prompt = buildCanaryPrompt(imagePath);
    const cap = loadGoalCapability(frameworkRoot, adapter);
    if (!cap.capability) {
      return { ran: false, error: `adapter ${adapter} 无 goal_capability 声明，跳过金丝雀探测` };
    }
    const vars: InvokeTemplateVars = {
      PROMPT_FILE: '',
      PROMPT: prompt,
      SKILL_PATH: '',
      PROJECT_ROOT: projectRoot,
      FRAMEWORK_ROOT: frameworkRoot,
      FEATURE: manifest.feature,
      PHASE: manifest.start_phase,
    };
    const plan = resolveHeadlessInvokePlan(adapter, cap.capability, manifest.unattended, prompt, vars);
    const invoke = await (input.invokeFn ?? invokeAgentHeadless)(plan, projectRoot, { timeoutMs: 120_000 });
    const decision = resolveCanaryCacheDecision({
      stdout: invoke.stdout,
      exitCode: invoke.exitCode,
      timed_out: invoke.timed_out,
      silent_killed: invoke.silent_killed,
      skipped: invoke.skipped,
    });
    if (decision.kind !== 'valid') {
      return {
        ran: true,
        outcome: decision.kind === 'invoke_failed' ? 'invoke_failed_not_cached' : 'invalid_not_cached',
        error: decision.detail,
      };
    }
    const existing = loadLocalConfig(projectRoot) ?? { schema_version: LOCAL_SCHEMA_VERSION };
    writeLocalConfig(projectRoot, {
      ...existing,
      vision: {
        ...(existing.vision ?? {}),
        canary: {
          adapter,
          verdict: decision.classify.verdict,
          probed_at: new Date().toISOString(),
          reason: decision.classify.reason,
          probed_via: 'goal',
          probe_version: VISION_CANARY_PROBE_VERSION,
          // S3（visual-capability-truth）：receipt 增维——adapter 层无法证明实际模型路由
          // （cursor auto 等），诚实记 unknown；scope 判级据此封顶 run_probed 且不跨 run。
          model: 'unknown',
          probe_context: 'goal_preflight',
          run_id: manifest.run_id,
        },
      },
    });
    return { ran: true, outcome: 'valid_cached', verdict: decision.classify.verdict };
  } catch (e) {
    // rev5(codex P2)：spawn/asset/config 异常同样是"探测执行失败"——归入
    // invoke_failed_not_cached,让 runner 走统一的 stale-if-error LKG 二分日志
    // (原 ran:false 会绕过 LKG 检查:强刷异常时旧 fresh 缓存实际仍被消费,日志却不说)。
    // ran:false 仅保留给"没试跑"的合法跳过(无 goal_capability 声明)。
    return { ran: true, outcome: 'invoke_failed_not_cached', error: `探测异常：${(e as Error).message}` };
  }
}

export function goalRequiredPrerequisites(
  chain: FeaturePhase[],
  resolvedProfile: HarnessResolvedProfile,
): Set<PersonalPrerequisiteId> {
  return unionPhasePersonalPrerequisites(chain, resolvedProfile);
}

// ----------------------------------------------------------------------------
// goal-fakepass-hardening t6：保真档位 preflight（spec 前，agent 未被调用，不烧 run）
// ----------------------------------------------------------------------------

import * as cryptoT6 from 'crypto';
import {
  dereferenceRequirementDocs,
  detectFidelityIntent,
  isValidFidelityTarget,
  resolveRequestedFidelity,
  type FidelityTarget,
} from './fidelity-shared';
import { resolveContextAdapterImageInput } from './multimodal-probe';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './confirmation-receipt';
import { featureFilePath } from '../../config';
import * as fsT6 from 'fs';

export type FidelityPreflightAction =
  | { action: 'proceed'; effective?: FidelityTarget; note?: string }
  | { action: 'defer_capability_missing'; detail: string }
  | { action: 'await_human_fidelity_tier'; detail: string };

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|bmp)$/i;

function dirHasImages(absDir: string): boolean {
  try {
    if (!fsT6.existsSync(absDir) || !fsT6.statSync(absDir).isDirectory()) return false;
    return fsT6.readdirSync(absDir).some((f) => IMAGE_EXT_RE.test(f));
  } catch {
    return false;
  }
}

export interface FidelityPreflightInput {
  projectRoot: string;
  frameworkRoot: string;
  manifest: GoalManifest;
  featuresDirRel: string;
  /** 链首非 spec（上游 spec 已闭环）→ 本 preflight 不适用（档位对账由 check-spec 承担） */
  chainStartsAtSpec: boolean;
  now?: () => Date;
}

/**
 * 规则（openspec goal-runner delta）：
 * - 解引用 requirement 引用文档后做三态意图检测（摘要弱措辞+SSOT 强信号=事故原形）；
 * - 强 pixel 意图 + 缺视觉能力 → DEFERRED_CAPABILITY_MISSING（不盲跑全链；
 *   继续的唯一通道=有效 fidelity_downgrade receipt——flag/manifest 不构成授权）；
 * - ambiguous + 参考图存在 + 未预授权（--fidelity 持平或抬升）→ await_human_fidelity_tier；
 * - --fidelity 只升不降（resolveRequestedFidelity；降档尝试无 receipt 即拒绝并告警）。
 */
export function evaluateFidelityTierPreflight(input: FidelityPreflightInput): FidelityPreflightAction {
  const { projectRoot, frameworkRoot, manifest } = input;
  if (!input.chainStartsAtSpec) return { action: 'proceed', note: 'chain 起点非 spec，档位对账由 check-spec 承担' };
  const deref = dereferenceRequirementDocs(projectRoot, manifest.requirement, {
    featuresDirRel: input.featuresDirRel,
  });
  const intent = detectFidelityIntent(deref.combined);
  if (intent === 'none') return { action: 'proceed', note: '无截图一致性意图信号' };

  const detected: FidelityTarget = intent === 'strong_pixel' ? 'pixel_1to1' : 'semantic_layout';

  // 降档凭证（唯一降档通道）
  let downgradeAuthorized = false;
  let receiptNote = '';
  if (manifest.fidelity && manifest.fidelity_receipt) {
    const objectHash = cryptoT6.createHash('sha256').update(deref.combined, 'utf-8').digest('hex');
    const v = validateConfirmationReceiptFile(
      path.join(projectRoot, manifest.fidelity_receipt),
      defaultTrustRegistryPath(projectRoot),
      {
        action: 'fidelity_downgrade',
        feature: manifest.feature,
        object_hash: objectHash,
        run_id: manifest.run_id,
        now: input.now,
      },
    );
    downgradeAuthorized = v.valid;
    if (!v.valid) receiptNote = `降档 receipt 无效：${v.reasons.join('；')}`;
  }
  const resolved = resolveRequestedFidelity(detected, manifest.fidelity, downgradeAuthorized);
  if (resolved.rejectedDowngrade) {
    console.warn(
      `[goal-runner] --fidelity=${manifest.fidelity} 是降档请求，无有效 receipt 不生效（只升不降）。${receiptNote}`,
    );
  }

  if (intent === 'strong_pixel' && resolved.effective === 'pixel_1to1') {
    const probe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, manifest.adapter);
    if (!probe.supported) {
      return {
        action: 'defer_capability_missing',
        detail:
          `需求为强 1:1 还原意图（解引用命中：${deref.resolvedPaths.join('、') || 'requirement 文本'}），` +
          `但 adapter=${manifest.adapter ?? 'unknown'} 无视觉能力。不盲跑全链（bc-openCard 4 轮 run 全废教训）；` +
          `继续的唯一通道：真人经带外体系签发 fidelity_downgrade receipt 后以 --fidelity <tier> --fidelity-receipt <path> 重跑。` +
          (receiptNote ? ` ${receiptNote}` : ''),
      };
    }
    return { action: 'proceed', effective: 'pixel_1to1' };
  }

  // ambiguous：参考图存在 + 未预授权 → 停下问人（在烧掉整条 run 之前）
  const hasImages =
    dirHasImages(featureFilePath(projectRoot, manifest.feature, 'ux-reference')) ||
    deref.resolvedPaths.some((rel) => dirHasImages(path.join(projectRoot, path.dirname(rel))));
  if (intent === 'ambiguous' && hasImages && !manifest.fidelity) {
    return {
      action: 'await_human_fidelity_tier',
      detail:
        '需求提及与截图/设计稿一致但意图不明确（ambiguous），且存在参考图。请确认保真档位后重跑：' +
        '`--fidelity pixel_1to1|semantic_layout`（预授权，不再停）；或修改需求原文写明' +
        '「完全参考/像素级」等强措辞。headless 不代拍此决策。',
    };
  }
  return { action: 'proceed', effective: resolved.effective };
}

// ----------------------------------------------------------------------------
// 十三轮 review P0-1：fidelity transition 独立前置校验——fresh/resume 都执行。
// 事故面：evaluateFidelityTierPreflight 全跳 resume，而 --resume --manifest --fidelity
// 照样 applyManifestCliOverrides 入 manifest → 我方 drift 字段级授权直接放行未经验证的
// 降档/垃圾凭证/垃圾枚举，写进 authenticated checkpoint 成为新 SSOT。
// 契约：只有枚举合法 + （降档 ⟹ fidelity_downgrade receipt 验真通过）才返回精确授权
// 字段集——--fidelity 只授权 fidelity、--fidelity-receipt 验真过才授权 fidelity_receipt，
// 不再互相搭车；违规=blockers（调用方 fresh/resume 一律 BLOCKER 退出，不静默）。
// ----------------------------------------------------------------------------

export interface FidelityTransitionInput {
  projectRoot: string;
  manifest: GoalManifest;
  featuresDirRel: string;
  /** string 过滤后的 CLI 实际应用旗标（与 applyManifestCliOverrides 同一来源对象——
   * 裸旗标 --fidelity（minimist→true）没应用任何值，不得进入本校验的 applied 面） */
  applied: { fidelity: boolean; fidelityReceipt: boolean };
  now?: () => Date;
}

export interface FidelityTransitionVerdict {
  /** 本次 CLI transition 授权覆盖的 manifest 身份字段（⊆ {fidelity, fidelity_receipt}） */
  authorizedFields: Set<string>;
  /** 非空=CLI 用法本身违规（枚举非法/降档无有效凭证/凭证无效）——一律 BLOCKER */
  blockers: string[];
}

export function evaluateFidelityTransitionAuthorization(
  input: FidelityTransitionInput,
): FidelityTransitionVerdict {
  const { manifest } = input;
  const authorizedFields = new Set<string>();
  const blockers: string[] = [];
  if (!input.applied.fidelity && !input.applied.fidelityReceipt) return { authorizedFields, blockers };
  // ① 枚举硬校验（resolveRequestedFidelity 对非法值静默回退 detected——显式传值必须显式拒）
  if (input.applied.fidelity && !isValidFidelityTarget(manifest.fidelity)) {
    blockers.push(
      `--fidelity 值非法（${String(manifest.fidelity)}）——须 pixel_1to1|semantic_layout|reference_only`,
    );
    return { authorizedFields, blockers };
  }
  const deref = dereferenceRequirementDocs(input.projectRoot, manifest.requirement, {
    featuresDirRel: input.featuresDirRel,
  });
  // ② 降档凭证验真（唯一降档通道；绑定语义与 evaluateFidelityTierPreflight 同源：
  //    object_hash=解引用合并需求文本 sha256 + feature + run_id）
  let receiptValid = false;
  let receiptReasons: string[] = [];
  if (manifest.fidelity_receipt) {
    const objectHash = cryptoT6.createHash('sha256').update(deref.combined, 'utf-8').digest('hex');
    const v = validateConfirmationReceiptFile(
      path.join(input.projectRoot, manifest.fidelity_receipt),
      defaultTrustRegistryPath(input.projectRoot),
      {
        action: 'fidelity_downgrade',
        feature: manifest.feature,
        object_hash: objectHash,
        run_id: manifest.run_id,
        now: input.now,
      },
    );
    receiptValid = v.valid;
    receiptReasons = v.reasons;
  }
  if (input.applied.fidelityReceipt && !receiptValid) {
    blockers.push(
      `--fidelity-receipt 校验失败（${receiptReasons.slice(0, 3).join('；') || '文件缺失/不可读'}）——` +
      '无效凭证不入 manifest（fail-closed）',
    );
  }
  // ③ 只升不降（相对 detected intent，与 fresh preflight 同源语义；intent none=无降档概念）
  const intent = detectFidelityIntent(deref.combined);
  if (input.applied.fidelity && intent !== 'none' && manifest.fidelity) {
    const detected: FidelityTarget = intent === 'strong_pixel' ? 'pixel_1to1' : 'semantic_layout';
    const resolved = resolveRequestedFidelity(detected, manifest.fidelity, receiptValid);
    if (resolved.rejectedDowngrade) {
      blockers.push(
        `--fidelity=${manifest.fidelity} 相对需求意图（${detected}）是降档且无有效 ` +
        'fidelity_downgrade receipt——只升不降（fail-closed）',
      );
    }
  }
  if (blockers.length > 0) return { authorizedFields, blockers };
  if (input.applied.fidelity) authorizedFields.add('fidelity');
  if (input.applied.fidelityReceipt) authorizedFields.add('fidelity_receipt');
  return { authorizedFields, blockers };
}

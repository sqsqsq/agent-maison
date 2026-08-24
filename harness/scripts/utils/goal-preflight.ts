/**
 * goal-runner preflight — adapter-aware / provenance-aware (not bare personal-setup gate).
 */

import type { FrameworkPersonalSetupStatus } from '../../config';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';
import type { GoalManifest, RunAdapterProvenance } from './goal-manifest';
import {
  adapterEntryExists,
  evaluatePersonalSetupGate,
  resolveProjectMaterializedForGate,
} from './personal-setup-gate';
import * as fs from 'fs';
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
import { isVisionCanaryFresh, canaryAdmissibleForExecution } from './multimodal-probe';
// plan d8c5f3a7 T1：与三轴 resolver 共用同一采信谓词（禁两把尺子——见函数内注释）
// plan d7f3a9c4 t3：执行身份升级 `{runId, modelPin}` 二元——重探判定与采信判定共用
// canaryAdmissibleForExecution（无 pin 时精确退化为 canaryAdmissibleForRun）。
import { planUsesClaudeStreamJson } from './claude-envelope';
import {
  assertAdapterHeadlessFullPermission,
  invokeAgentHeadless,
  resolveHeadlessInvokePlan,
  resolveSessionBinary,
  validateHeadlessBinaryForPlan,
  type InvokeTemplateVars,
} from './agent-invoke';
import type { ResolvedHeadlessBinary } from './headless-binary-resolve';
import { resolveUiRelevanceForRun } from './fidelity-shared';
import {
  buildCanaryPrompt,
  generateRandomCanaryAnswerKey,
  renderCanaryImage,
  resolveCanaryCacheDecision,
  resolveCanaryHardCliFailure,
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

/**
 * plan c4e8a1f7 T1a：preflight 返回本 execution session 解析出的 resolved binary
 * （probe/canary/formal invoke 三个消费点共用同一绝对路径；resume 新进程重新解析）。
 * dry-run WARN 提前返回 / 无结构化候选时返回 null。
 */
export function runGoalPreflight(input: GoalPreflightInput): SessionBinaryResolution | null {
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

  // plan a8e5c3f9 t5：headless 全权限支持性——不支持的内建 adapter 明确失败，不静默降级
  //（dry-run 与 binary 检查同待遇：降为 WARN，便于无宿主环境演练脚本）。
  const fullPerm = assertAdapterHeadlessFullPermission(adapter);
  if (!fullPerm.ok) {
    if (dryRun) {
      console.warn(`[goal-runner] preflight WARN: ${fullPerm.reason}`);
    } else {
      throw new Error(`[goal-runner] preflight BLOCKER: ${fullPerm.reason}`);
    }
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
  // plan d7f3a9c4 t1：binary-gate 的纯 plan 构造**刻意不带 pin**——本 plan 只用于
  // validateHeadlessBinaryForPlan（只校验 argv[0] 可否 spawn，与后续 flag 无关），
  // 不实际 spawn；chrys/generic 的"不支持 pin"错误在更早的 resolveFinalModelPin()
  // 即 fail-fast 退出，根本走不到此处。
  // plan c4e8a1f7 T1a：session 级 binary 单点解析——plan 构造与返回值都复用同一结果；
  // probe/canary/formal invoke 三个消费点拿到的都是这一个绝对路径。
  const sessionBinary = resolveSessionBinary(adapter);
  const plan = resolveHeadlessInvokePlan(
    adapter,
    cap.capability!,
    manifest.unattended,
    vars.PROMPT,
    vars,
    undefined,
    sessionBinary.binary,
  );
  const binaryCheck = validateHeadlessBinaryForPlan(adapter, plan);
  if (!binaryCheck.ok) {
    if (dryRun) {
      console.warn(`[goal-runner] preflight WARN: ${binaryCheck.message}`);
      return null;
    }
    throw new Error(binaryCheck.message);
  }

  // plan a8e5c3f9 t1：「allowed_tools 缺 Read → 视觉降级」WARN 已随降级链一并退役——
  // headless 全权限下审批清单不存在，也不再参与多模态能力判断。
  return sessionBinary;
}

/** plan c4e8a1f7 T1a：session binary 解析结果（binary=null 时 shadowed 仍携带诊断）。 */
export interface SessionBinaryResolution {
  binary: ResolvedHeadlessBinary | null;
  shadowed: string[];
}

export type VisionCanaryProbeSkipReason =
  | 'dry_run'
  | 'chain_has_no_ui_phase'
  | 'not_ui_relevant'
  | 'local_override_present'
  | 'fresh_cache_present'
  | 'no_capability_declared';

/** probe 触发缘由（plan d8c5f3a7 T1：新增 fresh_but_not_admissible_for_run 供日志/断言区分） */
export type VisionCanaryProbeReason = 'fresh_but_not_admissible_for_run';

export type VisionCanaryProbeDecision =
  | { action: 'skip'; reason: VisionCanaryProbeSkipReason }
  | { action: 'probe'; reason?: VisionCanaryProbeReason };

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
  // I2：新鲜度判据（超龄 interactive 缓存不算新鲜 → 重探）。
  // plan d8c5f3a7 T1：**skip 的前提是消费端将会采信**——新鲜度只答「证据是否过期」，
  // 还须合取 canaryAdmissibleForRun 答「证据是否属于当前执行身份」。否则出现
  // 2026-07-24 事故形态：goal canary 因 TTL 内被判 fresh 而跳过重探，却因 run_id 不匹配
  // 无法供当前执行复用。新鲜度与执行身份必须同时满足，避免把旧 run 结果误当当前能力。
  const canary = local?.vision?.canary;
  // plan d7f3a9c4 t3：**中央重探判定**——始终 `fresh && canaryAdmissibleForExecution(...)`。
  // 无 pin 时 modelPin=undefined，谓词精确退化为 canaryAdmissibleForRun（run 绑定一步不少，
  // 防 v5 公式把本处退化到只剩 fresh 而重新引入 07-24 跨 run 缓存事故）；pin 在场时才追加
  // 模型匹配（resume 改 pin 同 run_id 的旧模型缓存不再被跳过重探）。
  const modelPin = manifest.adapter_model_pin?.value;
  if (!forceRefresh && isVisionCanaryFresh(canary, adapter)) {
    if (canaryAdmissibleForExecution(canary, { runId: manifest.run_id, modelPin })) {
      return { action: 'skip', reason: 'fresh_cache_present' };
    }
    // 新鲜但本 run 不可采信（跨 run 的 goal canary / 旧缓存无 run_id / pin 在场但模型不配）
    // → 当场重探，探测结果会带本 run 的 run_id 与 pin 模型写盘，消费面随即可采信。
    return { action: 'probe', reason: 'fresh_but_not_admissible_for_run' };
  }
  return { action: 'probe' };
}

export type VisionCanaryProbeOutcome =
  | 'valid_cached'
  | 'invalid_not_cached'
  | 'invoke_failed_not_cached'
  | 'hard_cli_failure';

/**
 * E1：实际执行金丝雀探测——生成资产、headless 问答、严格判卷、按有效性决定是否写缓存。
 * 【诚实声明】本函数默认会真实 spawn 一次 headless agent 调用（真实成本，同 goal-runner
 * 本身每 phase 的调用性质一致，非额外风险类别）；invokeFn 注入供单测覆盖写盘边界
 * （plan c7d2e9a4 t6——事故真正发生地在"invoke → 写盘"之间，不能只测纯函数）。
 * 写盘守卫（t2/t3）：resolveCanaryCacheDecision 消费完整调用事实——invoke 失败/无效答卷
 * （空输出/额度错误文本/prompt echo/残卷）一律**不落缓存**（消费面按既有语义回退：盘上有
 * fresh last-known-good 则沿用，否则 adapter 声明路径——stale-if-error，日志由 goal-runner
 * 按盘上缓存现查二分）；只有有效作答（严格解析的 canonical answer）才 classify 并连同
 * probe_version 写盘。异常降级：探测异常不抛出、不阻断 goal run，探测失败不是 BLOCKER
 * （plan d7f3a9c4 t3 沿此；**t4 例外**：child spawn race / CLI·config 参数不兼容由
 * resolveCanaryHardCliFailure 判定为 hard_cli_failure，goal-runner 据此升 run 级 BLOCKER）。
 */
export async function runVisionCanaryProbe(input: {
  projectRoot: string;
  frameworkRoot: string;
  manifest: GoalManifest;
  /** 单测注入（默认真实 invokeAgentHeadless），覆盖"invoke→写盘"边界免真 spawn */
  invokeFn?: typeof invokeAgentHeadless;
  /** 单测注入（默认随机卷）：canned stdout 夹具须知道卷面答案才能构造有效作答（与 invokeFn 同款缝） */
  answerKeyFn?: typeof generateRandomCanaryAnswerKey;
  /** plan c4e8a1f7 T1a：session 级 resolved binary（与正式 invoke 同一绝对路径） */
  resolvedBinary?: ResolvedHeadlessBinary | null;
}): Promise<{
  ran: boolean;
  outcome?: VisionCanaryProbeOutcome;
  verdict?: 'tool_read' | 'ocr_capable' | 'none';
  error?: string;
}> {
  const { projectRoot, frameworkRoot, manifest } = input;
  const adapter = (manifest.adapter ?? 'generic').trim() || 'generic';
  // b7e4d2a9 Todo4（金丝雀临时化）：随机卷写 run 报告目录（workspace 内——tool_read
  // 判卷要求 workspace 沙箱 adapter 能读到；%TEMP% 会假阴性），答案只在内存，finally
  // 三态删除。不再写 framework/harness/assets/ 固定资产与 answer-key（运行时改发布件 +
  // 答案与题图同目录削弱金丝雀 + 固定卷可被记忆，三宗罪一并根治）。
  const imagePath = path.join(projectRoot, manifest.report_dir, 'preflight-canary.png');
  try {
    const answerKey = (input.answerKeyFn ?? generateRandomCanaryAnswerKey)();
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    await renderCanaryImage(imagePath, answerKey);
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
    const plan = resolveHeadlessInvokePlan(
      adapter,
      cap.capability,
      manifest.unattended,
      prompt,
      vars,
      manifest.adapter_model_pin?.value,
      input.resolvedBinary,
    );
    const invoke = await (input.invokeFn ?? invokeAgentHeadless)(plan, projectRoot, { timeoutMs: 120_000 });
    // plan d7f3a9c4 t4：硬失败分类在写盘判卷**之前**——child spawn race 与 CLI/config 参数
    // 不兼容只这两类升 hard_cli_failure（由 goal-runner 在 action==='probe' 真实路径升 BLOCKER）；
    // 其余 invoke 结果（auth/quota/API/无效答卷/超时/静默杀）保持既有非阻断语义。
    // "无有效 stdout" 复用 parseCanaryAnswer（传 answerKey）——CLI banner 等非答卷不压签名。
    const canaryStructuredStdout = planUsesClaudeStreamJson(adapter, cap.capability.tool_event_provenance);
    const hardCli = resolveCanaryHardCliFailure(invoke, { answerKey, structuredStdout: canaryStructuredStdout });
    if (hardCli) {
      return { ran: true, outcome: 'hard_cli_failure', error: hardCli };
    }
    const decision = resolveCanaryCacheDecision({
      stdout: invoke.stdout,
      exitCode: invoke.exitCode,
      timed_out: invoke.timed_out,
      silent_killed: invoke.silent_killed,
      skipped: invoke.skipped,
      // P0-1（plan 7c4f2e9b）：claude+structured_events 的 stdout 是 NDJSON 信封，
      // 判卷前须归一投影——与 claudeArgv 注入条件严格同构。
      structured_stdout: canaryStructuredStdout,
    }, answerKey);
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
          // plan d7f3a9c4 t3：**pin 在场时前提不再成立**——模型是用户显式指定并已回放进
          // argv，receipt 记 pin.value（采信须模型匹配）；无 pin 时继续记 'unknown'（现状）。
          model: manifest.adapter_model_pin?.value ?? 'unknown',
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
  } finally {
    // b7e4d2a9 Todo4：成功/失败/无效答卷三态都删随机卷 PNG；删除失败只警告不 HALT，
    // 不落事件不建清理账本——hard-kill 最坏残留当前 run 下一个固定文件。
    try {
      fs.rmSync(imagePath, { force: true });
    } catch (rmErr) {
      console.warn(`[vision-canary] preflight 随机卷清理失败（不阻断）：${(rmErr as Error).message}`);
    }
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
  clampFidelityByCapability,
  computeRequirementShaFromText,
  dereferenceRequirementDocs,
  detectDesiredFidelity,
  isValidFidelityTarget,
  loadFidelityIntentSsotState,
  resolveFidelityRoutingDecision,
  resolveOcrAvailableForRun,
  resolveRequestedFidelity,
  writeCapabilitySnapshot,
  writeFidelityIntentSsot,
  type FidelityRoutingDecision,
  type FidelityTarget,
  type RequirementProvenance,
} from './fidelity-shared';
import { resolveContextAdapterImageInput } from './multimodal-probe';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './confirmation-receipt';
import { featureFilePath } from '../../config';

export type FidelityPreflightAction =
  | { action: 'proceed'; effective?: FidelityTarget; note?: string; routing?: FidelityRoutingDecision }
  | { action: 'defer_capability_missing'; detail: string; routing?: FidelityRoutingDecision };

export interface FidelityPreflightInput {
  projectRoot: string;
  frameworkRoot: string;
  manifest: GoalManifest;
  featuresDirRel: string;
  /** 链首非 spec（上游 spec 已闭环）→ 本 preflight 不适用（档位对账由 check-spec 承担） */
  chainStartsAtSpec: boolean;
  /** OCR 探测的 profile 目录（缺省仅走 canary 信号兜底） */
  profileDir?: string;
  /** manifest.fidelity 是否来自 CLI 显式旗标（decision.source=explicit_cli） */
  fidelityFromCli?: boolean;
  now?: () => Date;
}

export interface FidelityRoutingInitInput {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  requirement: string | undefined;
  featuresDirRel: string;
  /** goal run_id 或显式 phase execution identity（如 `phase:<feature>:spec`） */
  executionIdentity: string;
  adapter?: string;
  profileDir?: string;
  manifestFidelity?: string;
  fidelityFromCli?: boolean;
  fidelityReceiptRel?: string;
  runIdForReceipt?: string;
  /** plan d7f3a9c4 t3：最终裁决后的 model pin value（goal 态由 manifest 派生；无 pin 不传） */
  modelPin?: string;
  /** plan c8e5b3f1 t1：需求来源（必填——TS 必填参数防漏接，漏传即编译不过）：
   * goal_manifest=goal 模式（preflight / vision policy 收紧重建）；explicit_cli=手动显式非空
   * 需求；intent_fallback=仅靠 collectIntentTextWithPhaseFallback 兜底。不提供默认值、不看
   * 环境变量猜、不叠运行时校验。 */
  requirementProvenance: RequirementProvenance;
  /** plan c4e8a1f7 T2：需求来源列表（项目根相对；goal 态来自 manifest，阶段驱动来自
   * --requirement-file 解析）——SSOT 以可选字段保留同一来源，不建第二份图片清单。 */
  requirementSourceFiles?: string[];
  now?: () => Date;
}

/**
 * plan f6b2d9a4 T2：路由初始化唯一执行实现（runner-owned）——goal 模式由 goal-runner
 * 在 agent invoke 前调用；phase-driven 由 skills/feature/spec Step 1 经
 * fidelity-intent-init CLI 调用（薄入口只透传，agent-adapters 约束）。职责：
 * 解引用需求 → 降档 receipt 验真 → 当前执行 capability 探测（vision probe、
 * OCR）→ 三段式路由 → 落 capability-snapshot.json + fidelity-intent.json（唯一 SSOT）。
 * harness-runner/check-spec 只加载复核，不首产。
 */
export function initializeFidelityRouting(
  input: FidelityRoutingInitInput,
): { routing: FidelityRoutingDecision; receiptNote: string; requirementSha: string } {
  const deref = dereferenceRequirementDocs(input.projectRoot, input.requirement, {
    featuresDirRel: input.featuresDirRel,
    excludePrefixes: [`${input.featuresDirRel.replace(/\\/g, '/')}/${input.feature}/`],
  });
  // 降档 receipt 验真（唯一降档通道；绑定 feature + 合并需求 object_hash + expiry，
  // 不绑定物理 run_id，故同一语义任务的 successor 可复用）。
  let downgradeReceiptValid = false;
  let receiptNote = '';
  if (input.fidelityReceiptRel) {
    const objectHash = cryptoT6.createHash('sha256').update(deref.combined, 'utf-8').digest('hex');
    const v = validateConfirmationReceiptFile(
      path.join(input.projectRoot, input.fidelityReceiptRel),
      defaultTrustRegistryPath(input.projectRoot),
      {
        action: 'fidelity_downgrade',
        feature: input.feature,
        object_hash: objectHash,
        now: input.now,
      },
    );
    downgradeReceiptValid = v.valid;
    if (!v.valid) receiptNote = `降档 receipt 无效：${v.reasons.join('；')}`;
  }
  // capability snapshot：只记录当前执行的真实输入能力。产物验证结果不得反向改写模型能力。
  const probe = resolveContextAdapterImageInput(input.projectRoot, input.frameworkRoot, input.adapter, {
    runId: input.runIdForReceipt,
    ...(input.modelPin ? { modelPin: input.modelPin } : {}),
  });
  const hasVision = probe.supported;
  const ocrAvailable = resolveOcrAvailableForRun(input.projectRoot, input.profileDir ?? '', input.adapter, {
    runId: input.runIdForReceipt,
    ...(input.modelPin ? { modelPin: input.modelPin } : {}),
  });
  const requirementSha =
    computeRequirementShaFromText(
      input.projectRoot, input.feature, input.requirement ?? deref.combined, input.featuresDirRel,
    ) ?? cryptoT6.createHash('sha256').update(deref.combined, 'utf-8').digest('hex');
  const routing = resolveFidelityRoutingDecision({
    requirementText: deref.combined,
    manifestFidelity: input.manifestFidelity,
    manifestFidelitySource: input.fidelityFromCli ? 'explicit_cli' : 'manifest_declared',
    downgradeReceiptValid,
    capability: { hasVision, ocrAvailable },
    executionIdentity: input.executionIdentity,
    requirementSha,
  });
  writeCapabilitySnapshot(input.projectRoot, input.feature, {
    execution_identity: input.executionIdentity,
    decision_id: routing.decision.decision_id,
    vision: {
      verdict: hasVision,
      source: `probe:${probe.imageInput ?? 'none'}`,
    },
    ocr: { verdict: ocrAvailable, source: input.profileDir ? 'profile_probe_or_canary' : 'canary_signal' },
  });
  writeFidelityIntentSsot(input.projectRoot, input.feature, routing, {
    executionIdentity: input.executionIdentity,
    requirementSha,
    // plan c8e5b3f1 t1：writer 必须写调用方显式裁决的需求来源（必填入参，TS 防漏接）。
    requirementProvenance: input.requirementProvenance,
    // plan c4e8a1f7 T2：同一来源列表随 SSOT 可选字段保留。
    ...(input.requirementSourceFiles && input.requirementSourceFiles.length > 0
      ? { requirementSourceFiles: input.requirementSourceFiles }
      : {}),
  });
  return { routing, receiptNote, requirementSha };
}

/**
 * 规则（plan f6b2d9a4：「非关键冲突不阻塞」）：
 * - 三段式路由：inferred（文本推导）→ selected（只升不降；receipt 降档）→ effective（clamp）；
 * - **唯一阻塞形态**=selected=pixel_1to1 ∧ strictness=hard ∧ clamp 降档 →
 *   DEFERRED_CAPABILITY_MISSING（出路=换视觉模型 / fidelity_downgrade receipt / 改需求）；
 * - 其余一律 proceed（含混/自声明自动定档到能力内最优档，透明记录进 fidelity-intent SSOT）；
 *   await_human_fidelity_tier 分支已删除（v2 定稿）。
 */
export function evaluateFidelityTierPreflight(input: FidelityPreflightInput): FidelityPreflightAction {
  const { projectRoot, frameworkRoot, manifest } = input;
  // runner-owned-machine-facts 追补（codex 定点；宿主实锤 run 20260815T112821Z-6cb1da）：
  // fidelity-intent.json / capability-snapshot.json 是 spec-owned、被 spec closure 冻结进
  // evidence manifest 的决策文件。下游起点 run 无条件重写它们（execution_identity 每 run
  // 必变，旧注释所称"幂等重算"并不幂等）= runner 亲手把上游 spec closure 弄 stale →
  // 收尾 assess 推荐 rerun_phase:spec → 本链不含 spec 无路由 → catch-all framework_bug halt。
  // 链首非 spec 改为**读取复用（零写盘）**；需求/显式档位真变了 → 明确要求从 spec 重跑。
  if (!input.chainStartsAtSpec) {
    return evaluateDownstreamStartFidelity(input);
  }
  const { routing, receiptNote } = initializeFidelityRouting({
    projectRoot,
    frameworkRoot,
    feature: manifest.feature,
    requirement: manifest.requirement,
    featuresDirRel: input.featuresDirRel,
    executionIdentity: manifest.run_id,
    adapter: manifest.adapter,
    profileDir: input.profileDir,
    manifestFidelity: manifest.fidelity,
    fidelityFromCli: input.fidelityFromCli,
    fidelityReceiptRel: manifest.fidelity_receipt,
    runIdForReceipt: manifest.run_id,
    // plan c8e5b3f1 t1：goal preflight 需求来源=goal manifest。
    requirementProvenance: 'goal_manifest',
    // plan c4e8a1f7 T2：来源列表随 manifest 冻结值透传（SSOT 可选字段保留同一来源）。
    ...(manifest.requirement_source_files && manifest.requirement_source_files.length > 0
      ? { requirementSourceFiles: manifest.requirement_source_files }
      : {}),
    // plan d7f3a9c4 t3：preflight 能力探测带最终裁决 pin（manifest 派生）。
    ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
    now: input.now,
  });
  if (routing.rejectedDowngrade) {
    console.warn(
      `[goal-runner] --fidelity=${manifest.fidelity} 是降档请求，无有效 receipt 不生效（只升不降）。${receiptNote}`,
    );
  }
  // post-impl4 P0-1：唯一真冲突（selected=pixel∧hard∧clamp）**不受链起点限制**——
  // review/ut/testing 起点 resume 时能力重算为盲同样必须 DEFER，先于截断链说明判定。
  if (routing.defer) {
    return {
      action: 'defer_capability_missing',
      routing,
      detail:
        `需求为 pixel_1to1 目标且严格度=hard（不接受降级），而当前能力不足` +
        `（${routing.clampReason ?? 'capability_clamped'}）。不盲跑全链；出路三选一：` +
        '①换有视觉能力的模型/配置后重跑；②真人签发 fidelity_downgrade receipt 后以 ' +
        '`--fidelity <tier> --fidelity-receipt <path>` 重跑；③修改需求措辞放宽严格度。' +
        (receiptNote ? ` ${receiptNote}` : ''),
    };
  }
  return {
    action: 'proceed',
    effective: routing.effective,
    routing,
    note: routing.decision.rationale,
  };
}

/**
 * 链首非 spec 的下游起点：读取复用 spec 冻结的 fidelity 决策，**零写盘**。
 * - SSOT 损坏 / 需求 sha 失配 / 显式档位与冻结 selected 不一致 → 明确要求从 spec 重跑
 *   （上游审的不是当前需求/决策，续跑无意义；下游重建同样会污染 spec closure 输入集）；
 * - SSOT 缺失 → 非 UI/legacy 流程合法，不新建直接 proceed（UI 缺失由上游 closure 校验拦）；
 * - 唯一真冲突保留（post-impl4 P0-1 语义不因本改动削弱）：能力按当前执行**内存重探**，
 *   pixel ∧ hard ∧ 当前能力钳 → DEFER。
 */
function evaluateDownstreamStartFidelity(input: FidelityPreflightInput): FidelityPreflightAction {
  const { projectRoot, frameworkRoot, manifest } = input;
  const ssotState = loadFidelityIntentSsotState(projectRoot, manifest.feature);
  if (ssotState.state === 'corrupt') {
    return {
      action: 'defer_capability_missing',
      detail:
        'fidelity-intent.json（spec 冻结的档位决策 SSOT）存在但损坏——下游起点不得重建它' +
        '（重写会使上游 spec closure stale）。请从 spec 重跑（--start spec）恢复合法决策链。',
    };
  }
  // 需求内容级 sha 与当前执行能力（内存探测，不写盘）——missing/valid 两分支共用
  const deref = dereferenceRequirementDocs(projectRoot, manifest.requirement, {
    featuresDirRel: input.featuresDirRel,
    excludePrefixes: [`${input.featuresDirRel.replace(/\\/g, '/')}/${manifest.feature}/`],
  });
  const currentSha = computeRequirementShaFromText(
    projectRoot, manifest.feature, manifest.requirement ?? deref.combined, input.featuresDirRel,
  );
  const identity = {
    runId: manifest.run_id,
    ...(manifest.adapter_model_pin ? { modelPin: manifest.adapter_model_pin.value } : {}),
  };
  const probe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, manifest.adapter, identity);
  const ocrAvailable = resolveOcrAvailableForRun(projectRoot, input.profileDir ?? '', manifest.adapter, identity);
  if (ssotState.state === 'missing') {
    // 无既有 SSOT（legacy 现场/非 UI 流程/交互态闭环）：**内存推导**路由做真冲突判定
    //（post-impl4 P0-1 语义不因零写盘削弱——盲 ∧ hard ∧ pixel 不许盲跑全链），
    // resolveFidelityRoutingDecision 是纯函数，不落任何文件。降档 receipt 在下游起点
    // 不验真（downgradeReceiptValid=false，只升不降保守生效）——降档裁决归 spec。
    const routing = resolveFidelityRoutingDecision({
      requirementText: deref.combined,
      manifestFidelity: manifest.fidelity,
      manifestFidelitySource: input.fidelityFromCli ? 'explicit_cli' : 'manifest_declared',
      downgradeReceiptValid: false,
      capability: { hasVision: probe.supported, ocrAvailable },
      executionIdentity: manifest.run_id,
      requirementSha: currentSha,
    });
    if (routing.defer) {
      return {
        action: 'defer_capability_missing',
        routing,
        detail:
          `需求为 pixel_1to1 目标且严格度=hard（不接受降级），而当前能力不足` +
          `（${routing.clampReason ?? 'capability_clamped'}）。不盲跑全链；出路三选一：` +
          '①换有视觉能力的模型/配置后重跑；②真人签发 fidelity_downgrade receipt 后以 ' +
          '`--fidelity <tier> --fidelity-receipt <path>` 重跑；③修改需求措辞放宽严格度。',
      };
    }
    return {
      action: 'proceed',
      effective: routing.effective,
      routing,
      note: 'chain 起点非 spec 且无既有 fidelity SSOT——内存推导路由，不新建文件（避免改写 spec closure 输入集）；档位对账由 check-spec 承担',
    };
  }
  const ssot = ssotState.doc;
  // ① 需求变更侦测——与 SSOT 写入口径同源（内容级 sha，跨 run 稳定）
  if (currentSha !== ssot.requirement_sha256) {
    return {
      action: 'defer_capability_missing',
      detail:
        '需求内容与 spec 冻结的档位决策 SSOT 失配（requirement sha 变更）——上游 spec 审的' +
        '不是当前需求，从下游续跑无意义；请从 spec 重跑（--start spec）。',
    };
  }
  // ② 显式档位变更侦测
  if (
    typeof manifest.fidelity === 'string' &&
    isValidFidelityTarget(manifest.fidelity) &&
    manifest.fidelity !== ssot.selected_fidelity
  ) {
    return {
      action: 'defer_capability_missing',
      detail:
        `--fidelity=${manifest.fidelity} 与 spec 冻结的 selected=${ssot.selected_fidelity} 不一致` +
        '——档位决策变更须回 spec 重新裁决（--start spec），下游起点不得改写冻结决策。',
    };
  }
  // ③ 唯一真冲突：当前执行能力（前置内存重探）钳 spec 冻结的 selected
  const reclamp = clampFidelityByCapability(ssot.selected_fidelity, {
    hasVision: probe.supported,
    ocrAvailable,
  });
  if (ssot.selected_fidelity === 'pixel_1to1' && ssot.acceptance_strictness === 'hard' && reclamp.clamped) {
    return {
      action: 'defer_capability_missing',
      detail:
        `需求为 pixel_1to1 目标且严格度=hard（不接受降级），而当前能力不足（${reclamp.reason ?? 'capability_clamped'}）。` +
        '不盲跑全链；出路三选一：①换有视觉能力的模型/配置后重跑；②真人签发 fidelity_downgrade receipt 后以 ' +
        '`--fidelity <tier> --fidelity-receipt <path>` 重跑；③修改需求措辞放宽严格度。',
    };
  }
  return {
    action: 'proceed',
    effective: ssot.effective_fidelity,
    note:
      'chain 起点非 spec：复用 spec 冻结的 fidelity 决策（零写盘——下游 run 不得改写被 closure ' +
      '冻结的 spec-owned SSOT）；档位对账由 check-spec 承担',
  };
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
    excludePrefixes: [`${input.featuresDirRel.replace(/\\/g, '/')}/${manifest.feature}/`],
  });
  // ② 降档凭证验真（唯一降档通道；绑定语义，与 initializeFidelityRouting 同源：
  //    object_hash=解引用合并需求文本 sha256 + feature + expiry，跨 successor run 复用）
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
  // ③ 只升不降（相对 inferred desired，与 routing 三段式同源——plan f6b2d9a4：
  //    ambiguous 态删除，detectDesiredFidelity 缺省 semantic_layout）
  if (input.applied.fidelity && manifest.fidelity) {
    const detected: FidelityTarget = detectDesiredFidelity(deref.combined).desired;
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

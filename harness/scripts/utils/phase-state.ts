// ============================================================================
// 阶段状态机 + 闭环同步（.current-phase.json / summary.json）
// ============================================================================
// SSOT：harness-runner、check-receipt.ts、--sync-closure 共用，避免双份逻辑。

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  featureDir,
  featurePhaseReportsDir,
  loadFrameworkConfig,
  resolveReceiptFilePath,
  statefilePath,
} from '../../config';
import { readRunControl, type RunOwnerKind } from './goal-run-control';
import {
  isPhaseGlobalInWorkflow,
  resolveWorkflowSpec,
  type WorkflowSpec,
} from '../../workflow-loader';
import {
  buildPolicySnapshot,
  resolveFeatureTrack,
  type EvidencePolicySnapshot,
  type PolicySnapshot,
} from './runtime-policy';
import { loadFeatureTrackDecl } from './feature-track';
import { finalizePhaseClosure } from './phase-closure-finalizer';
import { deleteEnvKeyCaseInsensitive } from './process-integrity';

/** Feature phase id（由 workflow 定义；不再限定 canonical 枚举——C0 runtime-policy-core 收编）。 */
import { assessAndRenderNextStep } from './assess-renderer';
export type FeaturePhase = string;

export interface ReceiptValidation {
  /**
   * `not_applicable`（C2）：lite track 的 receipt 机制架构性不适用——闭环判据是
   * change.md checkbox + exit script-report PASS，不经本文件。绝不映射为 passed。
   */
  status: 'passed' | 'failed' | 'missing' | 'error' | 'not_applicable';
  receipt_path: string;
  exit_code?: number;
  message?: string;
}

export interface CurrentPhaseStatePartial {
  phase: string;
  feature: string;
  status: 'running' | 'harness_finished';
  started_at?: string;
  last_run_at?: string;
  verdict?: 'PASS' | 'FAIL' | string;
  blocker_count?: number;
  receipt?: ReceiptValidation | null;
  /** C2 两层机读契约（check-receipt.ts 计算；仅 PASS 路径写入，非必填）。 */
  evidence_policy_snapshot?: EvidencePolicySnapshot | null;
}

interface CurrentPhaseState extends CurrentPhaseStatePartial {
  schema_version: string;
  updated_at: string;
  session_id?: string | null;
  session_id_recorded_at?: string | null;
  last_seen_session_id?: string | null;
  last_seen_at?: string | null;
  /** C0 policy 快照（Stop hook 消费；缺失/版本不符 → hook fail-safe 按 full+strict）。 */
  policy_snapshot?: PolicySnapshot | null;
}

export interface HarnessRunSummaryPatch {
  closure_status?: 'open' | 'closed';
  receipt_status?: string;
  next_action?: string;
}

function loadWorkflowSpec(projectRoot: string, frameworkRoot?: string): WorkflowSpec {
  const cfg = loadFrameworkConfig(projectRoot);
  return resolveWorkflowSpec(projectRoot, { config: cfg, frameworkRoot });
}

/** goal-runner harness spawn sets this; suppresses global .current-phase.json writes. */
export const MAISON_GOAL_RUNNER_ENV = 'MAISON_GOAL_RUNNER';

/** goal-runner headless agent trees inherit MAISON_GOAL_HEADLESS from agent-invoke. */
export const MAISON_GOAL_HEADLESS_ENV = 'MAISON_GOAL_HEADLESS';

/** Comma-separated goal manifest `unattended.allowed_tools` for harness-runner image_input 降级。 */
// MAISON_GOAL_ALLOWED_TOOLS_ENV 已退役（plan a8e5c3f9 t1）：注入与消费一并删除——
// allowed_tools 是审批清单，headless 全权限下不构成任何执行/能力判断的输入。

/**
 * plan d7f3a9c4 t3：最终裁决后的 model pin value（生产代码与测试共用同一 SSOT）。
 * 注入纪律沿用 `MAISON_GOAL_RUN_ID`：注入前先清大小写变体再写唯一大写键；无 pin 时
 * **删除/不注入**（不得把 undefined/空串/`unknown` 当 pin）。子进程消费方取不到即按无 pin
 * 处理（现状语义，不得臆造）。
 */
export const MAISON_GOAL_MODEL_PIN_ENV = 'MAISON_GOAL_MODEL_PIN';

/**
 * plan d7f3a9c4 t3：model pin env 注入的**唯一执行器**（三条子进程路径共用 + 测试共用）：
 * 先按大小写不敏感清理全部变体（Windows 混写残留会与注入键并存，读取哪个是未定义行为），
 * 再写唯一大写键；无 pin（undefined/空串）时只清理不写入——不得把 undefined/空串/`unknown`
 * 当 pin。调用方在**任何**子进程 spawn 前对本键执行一次，即保证「无 pin 不泄漏陈旧值」。
 */
export function applyGoalModelPinEnv(env: NodeJS.ProcessEnv, modelPinValue: string | undefined): void {
  deleteEnvKeyCaseInsensitive(env, MAISON_GOAL_MODEL_PIN_ENV);
  if (modelPinValue) {
    env[MAISON_GOAL_MODEL_PIN_ENV] = modelPinValue;
  }
}

/**
 * plan ab072691 t5①：本 run 冻结的**只读视觉 provider 身份**注入键（成对）。
 *
 * 为什么要 env：provider 评审发生在 **gate harness 进程**里（capture 之后、严格 dispatch
 * 之前），那个进程没有 manifest。与 model pin 同一条注入纪律：注入前清大小写变体，
 * 无 pin 时**只清不写**（子进程取不到即按未配置处理，不得臆造）。
 * 交互态无此 env——由 gate 侧读个人级 framework.local.json。
 */
export const MAISON_GOAL_VISUAL_PROVIDER_ADAPTER_ENV = 'MAISON_GOAL_VISUAL_PROVIDER_ADAPTER';
export const MAISON_GOAL_VISUAL_PROVIDER_MODEL_ENV = 'MAISON_GOAL_VISUAL_PROVIDER_MODEL';

/** 成对注入的唯一执行器（成对写、成对清——半个身份既冻结不了也回放不了）。 */
export function applyGoalVisualProviderEnv(
  env: NodeJS.ProcessEnv,
  pin: { adapter: string; model: string } | undefined,
): void {
  deleteEnvKeyCaseInsensitive(env, MAISON_GOAL_VISUAL_PROVIDER_ADAPTER_ENV);
  deleteEnvKeyCaseInsensitive(env, MAISON_GOAL_VISUAL_PROVIDER_MODEL_ENV);
  if (pin?.adapter && pin.model) {
    env[MAISON_GOAL_VISUAL_PROVIDER_ADAPTER_ENV] = pin.adapter;
    env[MAISON_GOAL_VISUAL_PROVIDER_MODEL_ENV] = pin.model;
  }
}

/** 从当前进程 env 读回冻结 provider 身份（成对齐全才算数）。 */
export function readGoalVisualProviderEnv(
  env: NodeJS.ProcessEnv = process.env,
): { adapter: string; model: string } | undefined {
  const adapter = env[MAISON_GOAL_VISUAL_PROVIDER_ADAPTER_ENV]?.trim();
  const model = env[MAISON_GOAL_VISUAL_PROVIDER_MODEL_ENV]?.trim();
  return adapter && model ? { adapter, model } : undefined;
}

export function isGoalOrchestrationEnv(): boolean {
  return (
    process.env[MAISON_GOAL_RUNNER_ENV] === '1' || process.env[MAISON_GOAL_HEADLESS_ENV] === '1'
  );
}

/** True when spawned from goal-runner headless agent invoke (not harness-runner). */
export function isGoalHeadlessEnv(): boolean {
  return process.env[MAISON_GOAL_HEADLESS_ENV] === '1';
}

/**
 * goal run 内 agent 侧 harness（agent 自跑）——只计算、不写正式 vision 账本
 * （b7e4d2a9 Todo3 单写者唯一谓词；check-spec attestation 与 harness-runner
 * visual-rounds journal 分流都必须消费本函数，不得各自造判定）。
 * 信号取并集：adapter 工具子进程实测会丢部分 env（2026-07-27 宿主实锤：cursor 丢
 * MAISON_GOAL_HEADLESS 留 MAISON_GOAL_RUN_ID——单一信号判定必翻车）；任一 goal 信号
 * 在场而无 gate authority（MAISON_GOAL_GATE_HARNESS=1，runner 直接 spawn 的 gate
 * harness 独有、agent env 构造时按信任锚剥离）即视为 agent 侧。
 */
export function isAgentSideGoalHarness(): boolean {
  const anyGoalSignal =
    Boolean(process.env.MAISON_GOAL_RUN_ID?.trim()) ||
    Boolean(process.env.MAISON_GOAL_ATTEMPT?.trim()) ||
    // plan b3e8d4c7 t1：新增的 attempt phase 同属 goal 信号——不入并集的话，
    // 子进程只剩 PHASE 时真实 goal 上下文会被当 manual（与本 plan 的 fail-closed 相悖）。
    Boolean(process.env.MAISON_GOAL_ATTEMPT_PHASE?.trim()) ||
    isGoalOrchestrationEnv();
  return anyGoalSignal && process.env.MAISON_GOAL_GATE_HARNESS !== '1';
}

/**
 * plan a5f9c3e2 t1：当前 run 的 owner 种类 —— **`can_prompt_now` 的唯一事实来源**。
 *
 * 绝不再用 `!isGoalOrchestrationEnv()` 反推：旧式写法把 goal「有人在场」（会话内驱动、
 * 真人就在旁边）误判成无人，是本 plan 立项盘点出的唯一算过该谓词却算错的地方。
 * owner 是**动态**的——同一 run 可在 session↔detached 间 mailbox handoff，故按运行时
 * run-control 现值解析，**不冻结进 manifest identity**（冻结会让合法 handoff 变 drift）。
 *
 *  - 无任何 goal 信号 → direct 交互模式，真人在场 → `'session'`；
 *  - 有 goal 信号 → 读 run-control 的 `owner.kind`；
 *  - run-control 缺失/损坏 → fail-safe `'process'`（视为不可问人），与改造前 goal 行为一致。
 */
export function resolveRunOwnerKind(projectRoot: string, feature?: string): RunOwnerKind {
  const runId = process.env.MAISON_GOAL_RUN_ID?.trim();
  const inGoal = isGoalOrchestrationEnv() || Boolean(runId);
  if (!inGoal) return 'session';
  if (!runId || !feature) return 'process';
  try {
    const runDir = path.join(featureDir(projectRoot, feature), 'goal-runs', runId);
    return readRunControl(runDir, runId)?.owner?.kind ?? 'process';
  } catch {
    return 'process';
  }
}

export function mergeAndWritePhaseState(
  projectRoot: string,
  workflowSpec: WorkflowSpec,
  partial: CurrentPhaseStatePartial,
  writeOptions?: { strict?: boolean },
): void {
  // goal 编排链下不写全局 state，避免污染 Stop hook 判定
  if (isGoalOrchestrationEnv()) return;
  if (isPhaseGlobalInWorkflow(workflowSpec, partial.phase)) {
    return;
  }

  try {
    const stateAbs = statefilePath(projectRoot);
    const dir = path.dirname(stateAbs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let prev: Partial<CurrentPhaseState> = {};
    if (fs.existsSync(stateAbs)) {
      try {
        prev = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as Partial<CurrentPhaseState>;
      } catch {
        // corrupt → overwrite
      }
    }

    const sameTask = prev.phase === partial.phase && prev.feature === partial.feature;
    const carrySessionId = sameTask ? prev.session_id ?? null : null;
    const carrySessionRecordedAt = sameTask ? prev.session_id_recorded_at ?? null : null;
    const carryLastSeenSid = sameTask ? prev.last_seen_session_id ?? null : null;
    const carryLastSeenAt = sameTask ? prev.last_seen_at ?? null : null;

    const next: CurrentPhaseState = {
      schema_version: '1.1',
      phase: partial.phase,
      feature: partial.feature,
      status: partial.status,
      started_at:
        partial.status === 'running'
          ? partial.started_at ?? new Date().toISOString()
          : sameTask
            ? prev.started_at ?? partial.started_at
            : partial.started_at,
      last_run_at: partial.last_run_at ?? new Date().toISOString(),
      verdict: partial.verdict,
      blocker_count: partial.blocker_count,
      receipt: partial.receipt ?? null,
      evidence_policy_snapshot:
        partial.evidence_policy_snapshot ?? (sameTask ? prev.evidence_policy_snapshot ?? null : null),
      session_id: carrySessionId,
      session_id_recorded_at: carrySessionRecordedAt,
      last_seen_session_id: carryLastSeenSid,
      last_seen_at: carryLastSeenAt,
      policy_snapshot: buildPolicySnapshot(
        // 快照须含真实 track（OpenSpec runtime-policy）；C2 lite closure 与 hook 对账依赖此事实
        resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, partial.feature)),
      ),
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(stateAbs, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch (err) {
    if (writeOptions?.strict) throw err;
    console.warn(`   ⚠ 写 .current-phase.json 失败: ${(err as Error).message}`);
  }
}

/** check-receipt PASS 或 --sync-closure 成功后回写 state。 */
export function syncPhaseStateOnReceiptPass(
  projectRoot: string,
  feature: string,
  phase: string,
  receiptValidation: ReceiptValidation,
  opts?: {
    blocker_count?: number;
    frameworkRoot?: string;
    evidence_policy_snapshot?: EvidencePolicySnapshot | null;
  },
): void {
  const workflowSpec = loadWorkflowSpec(projectRoot, opts?.frameworkRoot);
  mergeAndWritePhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: 'PASS',
    blocker_count: opts?.blocker_count ?? 0,
    receipt: receiptValidation,
    evidence_policy_snapshot: opts?.evidence_policy_snapshot ?? null,
  });
}

/** Closure-only state path: persistence failure aborts before canonical summary commit. */
export function syncPhaseStateOnReceiptPassStrict(
  projectRoot: string,
  feature: string,
  phase: string,
  receiptValidation: ReceiptValidation,
  opts?: {
    blocker_count?: number;
    frameworkRoot?: string;
    evidence_policy_snapshot?: EvidencePolicySnapshot | null;
  },
): void {
  const workflowSpec = loadWorkflowSpec(projectRoot, opts?.frameworkRoot);
  mergeAndWritePhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: 'PASS',
    blocker_count: opts?.blocker_count ?? 0,
    receipt: receiptValidation,
    evidence_policy_snapshot: opts?.evidence_policy_snapshot ?? null,
  }, { strict: true });
}

export function tryValidateReceipt(
  harnessRoot: string,
  projectRoot: string,
  phase: string,
  feature: string,
  // P0-5（plan 7c4f2e9b）：resume 重探时 subprocess timeout 受 remaining wall-clock/
  // FINALIZE_RESERVE 约束（codex 五轮）；缺省不限（既有行为不变）。
  // plan b3e8d4c7 t1：`goalIdentity` 透传 goal 身份 env——runner 从不给自己设 MAISON_GOAL_*，
  // 此前本函数 spawn 的 check-receipt 因此 goal 门禁**全部静默跳过**（权威路径最松、
  // agent 修复路径最严）。传入后两侧执行同一套门禁。
  // plan d7f3a9c4 t3：`modelPin` 随 goalIdentity 同链透传（子进程 env 注入的唯一 key 按
  // 大小写不敏感清理后写入；无 pin 时不注入并显式清理父环境残留）。
  opts?: {
    timeoutMs?: number;
    goalIdentity?: { runId: string; attemptId: string; attemptPhase: string; modelPin?: string };
  },
): ReceiptValidation {
  const receiptResolved = resolveReceiptFilePath(projectRoot, feature, phase);
  const receiptAbs = receiptResolved.path;
  const receiptRel = path.relative(projectRoot, receiptAbs).replace(/\\/g, '/');

  // C2：lite track 的 receipt 机制架构性不适用——短路避免无谓 subprocess spawn，
  // 且绝不能把「没有 receipt」误判为 status:'missing'（那会被上游当作待补齐的
  // 未闭环凭证反复提示；lite 本就不产生这份凭证）。
  const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
  if (track === 'lite') {
    return {
      status: 'not_applicable',
      receipt_path: receiptRel,
      message:
        'lite track：receipt 机制不适用。闭环判据 = change.md checkbox 全勾 + exit 阶段 script-report verdict=PASS（非 receipt）。',
    };
  }

  if (!fs.existsSync(receiptAbs)) {
    return {
      status: 'missing',
      receipt_path: receiptRel,
      message: '回执文件不存在；本阶段尚未闭环（全局入口 §5.1 第 4 条）。',
    };
  }

  const checker = path.join(harnessRoot, 'scripts', 'check-receipt.ts');
  if (!fs.existsSync(checker)) {
    return {
      status: 'error',
      receipt_path: receiptRel,
      message: `check-receipt.ts 不存在于 ${checker}（框架未升级到位）。`,
    };
  }

  const isWin = process.platform === 'win32';
  // plan d7f3a9c4 t3：goalIdentity 子进程 env 构造——先清大小写变体（Windows 混写残留会与
  // 注入键并存，读取哪个是未定义行为），再写唯一大写键；model pin 无 pin 时显式清理。
  const childEnv: NodeJS.ProcessEnv = opts?.goalIdentity
    ? { ...process.env }
    : process.env;
  if (opts?.goalIdentity) {
    for (const k of ['MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_ATTEMPT_PHASE']) {
      deleteEnvKeyCaseInsensitive(childEnv, k);
    }
    childEnv.MAISON_GOAL_RUN_ID = opts.goalIdentity.runId;
    childEnv.MAISON_GOAL_ATTEMPT = opts.goalIdentity.attemptId;
    childEnv.MAISON_GOAL_ATTEMPT_PHASE = opts.goalIdentity.attemptPhase;
    // plan d7f3a9c4 t3：model pin 走共享注入执行器（先清大小写变体、无 pin 只清理不写入）。
    applyGoalModelPinEnv(childEnv, opts.goalIdentity.modelPin);
  }
  const result = spawnSync(
    isWin ? 'npx.cmd' : 'npx',
    [
      'ts-node',
      checker,
      '--feature',
      feature,
      '--phase',
      phase,
      '--project-root',
      projectRoot,
      '--skip-state-sync',
    ],
    {
      cwd: harnessRoot,
      encoding: 'utf-8',
      shell: isWin,
      ...(opts?.timeoutMs && opts.timeoutMs > 0 ? { timeout: opts.timeoutMs } : {}),
      ...(opts?.goalIdentity ? { env: childEnv } : {}),
    },
  );

  if (result.status === 0) {
    return { status: 'passed', receipt_path: receiptRel, exit_code: 0 };
  }
  if (result.status === 1) {
    return {
      status: 'failed',
      receipt_path: receiptRel,
      exit_code: 1,
      message: (result.stderr ?? '').slice(0, 800),
    };
  }
  return {
    status: 'error',
    receipt_path: receiptRel,
    exit_code: result.status ?? -1,
    message: (result.stderr ?? result.error?.message ?? 'unknown').slice(0, 800),
  };
}

/** 若 summary.json 存在则合并 closure 字段（best-effort）。 */
export function patchSummaryClosureStatus(
  projectRoot: string,
  feature: string,
  phase: string,
  patch: HarnessRunSummaryPatch,
  frameworkRoot?: string,
): boolean {
  const summaryPath = path.join(
    featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot),
    'summary.json',
  );
  if (!fs.existsSync(summaryPath)) {
    return false;
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    if (patch.closure_status !== undefined) {
      summary.closure_status = patch.closure_status;
    }
    if (patch.receipt_status !== undefined) {
      summary.receipt_status = patch.receipt_status;
    }
    if (patch.next_action !== undefined) {
      summary.next_action = patch.next_action;
    }
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function applyClosurePatchFromReceiptValidation(
  projectRoot: string,
  feature: string,
  phase: string,
  receiptValidation: ReceiptValidation | null,
  frameworkRoot?: string,
): void {
  if (receiptValidation?.status === 'passed') {
    throw new Error('passed closure 必须通过 finalizePhaseClosure 原子提交，禁止直接 patch summary');
  }

  patchSummaryClosureStatus(projectRoot, feature, phase, {
    closure_status: 'open',
    receipt_status: receiptValidation?.status,
    next_action: undefined,
  }, frameworkRoot);
}

export interface SyncClosureResult {
  exitCode: number;
  /** Present only when receipt passed but the atomic closure commit failed. */
  finalizationError?: string;
}

export function runSyncClosureDetailed(
  harnessRoot: string,
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
  // 环 C（plan f3a8c6d2 t2）：goal 调用方透传当前 run/attempt/phase 身份——**最终 closure
  // 提交前再执行一次严格 attempt 等值校验**（纵深防御，不接受"调用方已先校验"的弱边界）。
  //
  // 事故（bc-openCard run 20260808T071335Z-4b0136）：receipt 的 claimed_attempt_id=i7
  // 与终局 attempt i8 失配。本函数此前调 tryValidateReceipt **不带 goalIdentity**，
  // 而 check-receipt 的 attempt 等值判据只在 goal 身份在场时生效（phase-state.ts:292-294：
  // "runner 从不给自己设 MAISON_GOAL_*，此前本函数 spawn 的 check-receipt 因此 goal 门禁
  // 全部静默跳过"）——即提交侧是最松的一环。补齐后：i8 已创建而 receipt 仍 claimed i7 时
  // 提交必然失败，不写 phase state、不提交 summary closure、不改绑；只有 agent 把 receipt
  // 重签为 i8 才允许闭环（禁止任何迁移/改绑协议）。
  //
  // 非 goal 调用（harness-runner 的 --sync-closure 等）省略本参数即保持现状。
  opts?: { goalIdentity?: { runId: string; attemptId: string; attemptPhase: string; modelPin?: string } },
): SyncClosureResult {
  const receiptValidation = tryValidateReceipt(harnessRoot, projectRoot, phase, feature, {
    ...(opts?.goalIdentity ? { goalIdentity: opts.goalIdentity } : {}),
  });
  const workflowSpec = loadWorkflowSpec(projectRoot, frameworkRoot);

  if (receiptValidation.status === 'not_applicable') {
    // lite track：receipt 不是本 phase 的闭环判据，不动 state / summary。
    console.log('');
    console.log('ℹ️  sync-closure: receipt 机制对 lite track 不适用（not_applicable）');
    console.log(`   ↳ ${receiptValidation.message}`);
    console.log(`   请改查 harness-runner --phase ${phase} --feature ${feature} 的 script-report.json verdict。`);
    return { exitCode: 0 };
  }

  if (receiptValidation.status === 'passed') {
    let finalized;
    try {
      finalized = finalizePhaseClosure({
        projectRoot,
        frameworkRoot: frameworkRoot ?? path.resolve(harnessRoot, '..'),
        feature,
        phase,
        receipt: { ...receiptValidation, status: 'passed' },
        persistPhaseState: () =>
          syncPhaseStateOnReceiptPassStrict(projectRoot, feature, phase, receiptValidation, {
            frameworkRoot,
          }),
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error(`❌ sync-closure: closure finalization 失败：${message}`);
      return { exitCode: 1, finalizationError: message };
    }
    console.log('');
    console.log('✅ sync-closure: 阶段已闭环（check-receipt PASS）');
    console.log(`   state: ${path.relative(projectRoot, statefilePath(projectRoot)).replace(/\\/g, '/')}`);
    console.log(`   receipt: ${receiptValidation.receipt_path}`);
    console.log(
      `   closure_commit: ${finalized.transitioned ? 'committed' : 'already_committed'} ` +
        `(${finalized.closure_fingerprint.slice(0, 16)})`,
    );
    assessAndRenderNextStep({
      projectRoot,
      frameworkRoot: frameworkRoot ?? path.resolve(harnessRoot, '..'),
      feature,
      phase,
      mode: isGoalHeadlessEnv() ? 'goal_mode' : 'manual',
      status: 'PASS/closed',
    });

    return { exitCode: 0 };
  }

  mergeAndWritePhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: receiptValidation.status === 'missing' ? 'PASS' : 'FAIL',
    blocker_count: 0,
    receipt: receiptValidation,
  });
  applyClosurePatchFromReceiptValidation(projectRoot, feature, phase, receiptValidation, frameworkRoot);

  console.error('');
  console.error(`❌ sync-closure: 未闭环（receipt.status=${receiptValidation.status}）`);
  if (receiptValidation.message) {
    console.error(`   ↳ ${receiptValidation.message.split(/\r?\n/)[0]}`);
  }
  return { exitCode: receiptValidation.status === 'missing' ? 2 : 1 };
}

export function runSyncClosure(
  harnessRoot: string,
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): number {
  return runSyncClosureDetailed(
    harnessRoot,
    projectRoot,
    feature,
    phase,
    frameworkRoot,
  ).exitCode;
}
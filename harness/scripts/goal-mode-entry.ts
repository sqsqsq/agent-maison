import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import * as YAML from 'yaml';
import minimist from 'minimist';
import type {
  InSessionPhaseRequestContext,
  InSessionRoundOptions,
  InSessionRoundResult,
  GoalModeInSessionOptions,
} from './utils/goal-phase-runtime';
import { deriveInSessionFingerprint } from './utils/goal-phase-runtime';
import { GoalPhaseRuntime } from './goal-phase-runtime';
import { AttendedGoalPhaseExecutor } from './utils/goal-phase-executor';
import { collectSupersededAncestorEvents, loadEventsJsonl } from './utils/goal-runner-phase';
import { resolveGoalRunBaseline } from './utils/goal-run-baseline';
import { projectCanonicalLifecycle } from './utils/goal-canonical-lifecycle';
import {
  ensureRunControl,
  releaseRunOwner,
} from './utils/goal-run-control';
import {
  buildGoalManifestFromInput,
  inheritSuccessorManifest,
  deriveSuccessorRequirement,
  loadGoalManifestFromRun,
  resolveRequirementInput,
  RUN_ADAPTER_PROVENANCES,
  type GoalManifest,
  type RunAdapterProvenance,
} from './utils/goal-manifest';
import {
  assertGoalRunAttachable,
  createGoalRun,
  decideRunContinuation,
  inspectGoalRunCreation,
  successorBoundsConflicts,
  successorBoundsRefusal,
  resolveActualGoalPhaseChainAtBirth,
  type RunContinuationDecision,
} from './utils/goal-run-creation';
import { loadLocalConfig } from './utils/framework-local-config';
import {
  resolveUnattendedVisualProviderPin,
} from './utils/visual-provider-identity';
import { resolveWorkflowSpec } from '../workflow-loader';
import { relFeaturesDir } from '../config';
import { executionCompletionPhases, executionScopeFingerprint } from './utils/execution-scope';
import { featurePhasesFromWorkflow, resolveAutoChain } from './utils/phase-transition-policy';
import { loadFeatureTrackDecl, prepareFeatureScopeCandidate, featureScopePhaseHealth } from './utils/feature-track';
import { assembleKnowledge, renderKnowledge } from './utils/knowledge-context';
import { readBoundInput } from './utils/capability-resolution';
import { resolveBirthExecutionScope, registerFeatureScopeTransfer, resolveSuccessorExecutionScope } from './utils/feature-execution-scope';
import { resolveFeatureTrack } from './utils/runtime-policy';
import { validateMinimumAssurance } from './utils/skill-contract';
import { loadGoalCapability, routeGoalCapability } from './utils/goal-adapter-capability';
import { loadInertLegacyFidelityIntentSsot } from './utils/fidelity-shared';
export type { GoalModeInSessionOptions } from './utils/goal-phase-runtime';
export { deriveInSessionFingerprint } from './utils/goal-phase-runtime';

/** Host bridge: lifecycle progression is owned by GoalPhaseRuntime. */
export async function runGoalModeInSession(
  options: GoalModeInSessionOptions,
): Promise<InSessionRoundResult> {
  // Compatibility callers used to pre-acquire the session fence. Release it before entering
  // the canonical runtime, which owns acquisition, progression and terminal release itself.
  try { releaseRunOwner(options.runDir, options.token); } catch { /* already released */ }
  return runGoalModeHostBridge({
    projectRoot: options.projectRoot,
    frameworkRoot: options.frameworkRoot,
    feature: options.manifest.feature,
    runId: options.manifest.run_id,
    adapter: options.adapter,
    runMode: 'attended',
    executePhase: options.executePhase,
    authorization: options.authorization,
    leaseMs: options.leaseMs,
    maxRounds: options.maxRounds,
    onRound: options.onRound,
  });
}
export interface PrepareGoalModeRunOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId?: string;
  adapter: string;
  adapterSource?: RunAdapterProvenance;
  requirement: string;
  /** plan c4e8a1f7 T2：--requirement-file 来源列表（goal-mode-entry 与 goal-runner 同源解析） */
  requirementSourceFiles?: string[];
  startPhase?: string;
  endPhase?: string;
  forceFresh?: boolean;
}

/** harness/scripts → framework root；standalone 与 consumer 的目录层级一致。 */
export function defaultGoalModeFrameworkRoot(scriptDir = __dirname): string {
  return path.resolve(scriptDir, '..', '..');
}

/** Create the persisted manifest/control skeleton for a fresh attended run. */
export function prepareGoalModeRun(options: PrepareGoalModeRunOptions): {
  manifest: GoalManifest;
  manifestPath: string;
  runDir: string;
  /** plan 4e6fb3b6 §7：本次 prepare 走了哪条路（新开 = 新出生；重新接入 = 返回既有 run，宿主照常以它的 run id 附着）。 */
  continuation: RunContinuationDecision;
} {
  const feature = options.feature.trim();
  const adapter = options.adapter.trim();
  const requirement = options.requirement.trim();
  if (!feature || !adapter || !requirement) {
    throw new Error('--prepare-run requires --feature, --adapter, and --requirement');
  }
  // plan 4e6fb3b6 §7.3：接续决策在生成出生范围之前执行（与前台、detach 同一个函数）。
  const continuation: RunContinuationDecision = options.forceFresh
    ? { kind: 'fresh', explicit: true, reason: '显式 --force' }
    : decideRunContinuation({
        projectRoot: options.projectRoot, feature,
        call: {
          requirement,
          ...(options.requirementSourceFiles?.length ? { requirementSourceFiles: options.requirementSourceFiles } : {}),
          attended: true,
        },
      });
  if (continuation.kind === 'hold') throw new Error(`[goal-mode-entry] ${continuation.guidance}`);
  if (continuation.kind === 'rejoin') {
    const existing = loadGoalManifestFromRun(options.projectRoot, continuation.runId, {
      feature, featuresDir: relFeaturesDir(options.projectRoot),
    });
    const existingDir = path.resolve(options.projectRoot, ...existing.report_dir.split('/'));
    return { manifest: existing, manifestPath: path.join(existingDir, 'manifest.json'), runDir: existingDir, continuation };
  }
  const workflow = resolveWorkflowSpec(options.projectRoot, { frameworkRoot: options.frameworkRoot });
  if (continuation.kind === 'successor') {
    // 批三返修 R4：只出生后继（合同继承、需求合并、范围重解析、出生记录），用的全是 runtime 出生段的既有函数；
    // 承接审计、身份核对、预算血缘与范围转交由随后的附着按"附着的后继补完承接"做（R2），在原来的有人在场执行者之下运行。
    const featuresDir = relFeaturesDir(options.projectRoot);
    const source = loadGoalManifestFromRun(options.projectRoot, continuation.source, { feature, featuresDir });
    // 批三二轮返修 R3/R4：与 runtime 同一判据——只容忍原请求重放的起止，不同就在出生之前明确拒绝、不建 run。
    const boundsConflicts = successorBoundsConflicts(source, {
      ...(options.startPhase !== undefined ? { start: options.startPhase } : {}),
      ...(options.endPhase !== undefined ? { end: options.endPhase } : {}),
    });
    if (boundsConflicts.length) throw new Error(successorBoundsRefusal(continuation.reason, boundsConflicts));
    const sourceCreation = inspectGoalRunCreation(options.projectRoot, source);
    if (sourceCreation.state !== 'complete' && sourceCreation.state !== 'legacy') {
      throw new Error(`[goal-mode-entry] 后继的合同来源 ${source.run_id} 出生记录不完整，不能起后继`);
    }
    const baseline = resolveGoalRunBaseline(options.projectRoot, feature, source.run_id);
    if (baseline.available) source.run_base_sha = baseline.baseSha; else delete source.run_base_sha;
    const ancestors = collectSupersededAncestorEvents({ projectRoot: options.projectRoot, featuresDir, feature, seedTargets: continuation.targets });
    const pick = (key: 'round_fingerprint' | 'drift_fingerprint'): string[] => ancestors
      .map(e => (e as Record<string, unknown>)[key]).filter((v): v is string => typeof v === 'string');
    const manifest = inheritSuccessorManifest(buildGoalManifestFromInput({
      feature, run_id: options.runId, requirement, adapter: source.adapter,
      ...(options.requirementSourceFiles?.length ? { requirement_source_files: options.requirementSourceFiles } : {}),
      start_phase: source.start_phase, end_phase: source.end_phase,
      unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 },
    }, { projectRoot: options.projectRoot, featuresDir }), source, { round: pick('round_fingerprint'), drift: pick('drift_fingerprint') });
    // 与 runtime 合并块同一个函数：没有新内容时保留源合同全文，否则源全文 + 新增段（本次文本已是合并格式也不丢新增内容）
    manifest.requirement = deriveSuccessorRequirement(source.requirement, requirement);
    const scope = resolveSuccessorExecutionScope(options.projectRoot, feature, workflow, options.frameworkRoot, manifest.requirement, source.run_id);
    if (scope) {
      if (!scope.phase_chain.length) throw new Error('[goal-mode-entry] empty scope: verify existing results without creating a run');
      Object.assign(manifest, { execution_scope: scope, start_phase: scope.phase_chain[0], end_phase: scope.phase_chain.at(-1)!, chain_override: [...scope.phase_chain] });
    }
    const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, feature));
    const chain = scope?.phase_chain ?? resolveAutoChain(workflow, manifest.start_phase, manifest.end_phase, manifest.chain_override, track);
    createGoalRun({ projectRoot: options.projectRoot, manifest, chain, continuation });
    const successorDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
    ensureRunControl(successorDir, manifest.run_id);
    return { manifest, manifestPath: path.join(successorDir, 'manifest.json'), runDir: successorDir, continuation };
  }
  // D1.3：出生范围 = 转交时 feature 的**有效**范围（有记录时不重算候选）。
  const birth = resolveBirthExecutionScope(options.projectRoot, feature, workflow, options.frameworkRoot, requirement);
  const executionScope = birth.scope;
  if (executionScope && !executionScope.phase_chain.length) throw new Error('[goal-mode-entry] empty scope: verify existing results without creating a run');
  const manifest = buildGoalManifestFromInput(
    {
      feature,
      run_id: options.runId,
      requirement,
      ...(options.requirementSourceFiles && options.requirementSourceFiles.length > 0
        ? { requirement_source_files: options.requirementSourceFiles }
        : {}),
      adapter,
      ...(options.adapterSource ? { adapter_provenance: options.adapterSource } : {}),
      ...(executionScope ? { execution_scope: executionScope, chain_override: [...executionScope.phase_chain] } : {}),
      start_phase: options.startPhase ?? executionScope?.phase_chain[0] ?? 'spec',
      end_phase: options.endPhase ?? executionScope?.phase_chain.at(-1) ?? 'testing',
      // plan a8e5c3f9 t6：headless 即全权限——新 manifest 直接写 effective 值
      //（此前 workspace-write + on-request 让 claude 连 dontAsk 都拿不到，与无人值守自相矛盾）。
      unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 },
      // plan ab072691 t1③(b)：attended goal 在**创建 manifest 前**冻结只读视觉 provider。
      // 询问/重选发生在宿主会话里（registry setup.visual_provider → init-orchestrate
      // record-visual-provider 机器写盘）；这里只读 local 的既成结果并冻结进 manifest。
      // local 缺失或旧配置失去资格时不伪造 provider；严格需求与能力不足的冲突由
      // fidelity/capability 门禁裁决，optional 视觉轴保持 advisory。
      ...(() => {
        let local: ReturnType<typeof loadLocalConfig> = null;
        try {
          local = loadLocalConfig(options.projectRoot);
        } catch (error) {
          console.warn(
            `[visual-provider] WARN: 读取个人级视觉 provider 配置失败，按无 provider 处理：` +
              `${(error as Error).message}。严格视觉需求将由 capability 门禁诚实 defer。`,
          );
        }
        const resolved = resolveUnattendedVisualProviderPin(local, options.frameworkRoot);
        if (resolved.warning) console.warn(resolved.warning);
        return resolved.pin ? { visual_provider_pin: resolved.pin } : {};
      })(),
    },
    { projectRoot: options.projectRoot, featuresDir: relFeaturesDir(options.projectRoot) },
  );
  validateMinimumAssurance(
    options.frameworkRoot,
    manifest.minimum_assurance,
    new Set(workflow.artifacts.filter((item) => item.scope === 'feature').map((item) => item.id)),
  );
  const manifestPath = path.resolve(options.projectRoot, manifest.report_dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-mode-entry] run manifest already exists: ${manifestPath}`);
  }
  const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, feature));
  const chain = executionScope?.phase_chain ?? resolveAutoChain(
    workflow,
    manifest.start_phase,
    manifest.end_phase,
    manifest.chain_override,
    track,
  );
  const actualChain = resolveActualGoalPhaseChainAtBirth({
    requestedChain: chain,
    fullWorkflowChain: executionScope ? executionCompletionPhases(executionScope) : featurePhasesFromWorkflow(workflow, track),
    requiresLegacyFidelityRecovery:
      !executionScope && loadInertLegacyFidelityIntentSsot(options.projectRoot, feature) !== null,
  });
  createGoalRun({ projectRoot: options.projectRoot, manifest, chain: actualChain, forceFresh: options.forceFresh, continuation });
  // D1.3 转交登记：**createGoalRun 成功之后、ensureRunControl 之前**。出生未完成时 feature 侧
  // 绝不能留下指向不存在 run 的指针；反向残留（记录指向不存在的 run）才是 D1.3 第三行的报错。
  if (executionScope) {
    registerFeatureScopeTransfer({
      projectRoot: options.projectRoot, feature, runId: manifest.run_id,
      transferredScopeFingerprint: executionScopeFingerprint(executionScope),
    });
  }
  let runDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
  ensureRunControl(runDir, manifest.run_id);
  return { manifest, manifestPath, runDir, continuation };
}

export interface GoalModeHostBridgeOptions {
  onScopeRevision?: import('./goal-phase-runtime').GoalPhaseRuntimeLaunchOptions['onScopeRevision'];
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId: string;
  adapter: string;
  runMode?: string;
  executePhase: InSessionRoundOptions['executePhase'];
  authorization?: InSessionRoundOptions['authorization'];
  leaseMs?: number;
  maxRounds?: number;
  forceTakeover?: boolean;
  onRound?: (result: InSessionRoundResult) => void;
}

/**
 * `differs` 时逐条列出差异字段（磁盘候选 vs 本次生成）——只做呈现，不改写任何文件。
 * 扁平路径比较，避免让用户对着两段 YAML 自己找。
 */
export function describeCandidateDifference(disk: unknown, generated: unknown): string[] {
  const flatten = (value: unknown, prefix: string, out: Map<string, string>): void => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
      return;
    }
    out.set(prefix || '(root)', JSON.stringify(value));
  };
  const left = new Map<string, string>();
  const right = new Map<string, string>();
  flatten(disk, '', left);
  flatten(generated, '', right);
  const lines: string[] = [];
  for (const [key, value] of right) {
    const had = left.get(key);
    if (had === undefined) lines.push(`${key}: 磁盘候选缺少（本次生成=${value}）`);
    else if (had !== value) lines.push(`${key}: 磁盘=${had} ≠ 本次生成=${value}`);
  }
  for (const key of left.keys()) if (!right.has(key)) lines.push(`${key}: 仅磁盘候选有（本次生成已不含）`);
  return lines.slice(0, 20);
}

export function assertAttendedRunMode(runMode: string | undefined): void {
  if (runMode?.trim() !== 'attended') {
    throw new Error('[goal-mode-entry] attended attach requires --run-mode attended');
  }
}

export function buildPhaseExecuteRequest(
  context: InSessionPhaseRequestContext,
  recommendation: unknown,
): {
  type: 'phase_execute_request'; run_id: string; phase: string; attempt_id: string;
  owner_id: string; owner_epoch: number; recommendation: unknown;
} {
  return {
    type: 'phase_execute_request',
    run_id: context.runId,
    phase: context.phase,
    attempt_id: context.attemptId,
    owner_id: context.ownerId,
    owner_epoch: context.ownerEpoch,
    recommendation,
  };
}

/**
 * Host-facing production bridge: resolves the persisted run, acquires a fenced
 * session epoch, and invokes the canonical in-session loop. Hosts provide only
 * the adapter's isolated phase callback; they never construct tokens or loops.
 */
export async function runGoalModeHostBridge(
  options: GoalModeHostBridgeOptions,
): Promise<InSessionRoundResult> {
  // Caller declaration is only a startup assertion. It is deliberately not persisted as mode state.
  assertAttendedRunMode(options.runMode);
  let manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, {
    feature: options.feature,
    featuresDir: relFeaturesDir(options.projectRoot),
  });
  // 出生契约必须在 owner CAS 前成立；attach 永不补造 run_created。
  assertGoalRunAttachable(options.projectRoot, manifest);
  const callerAdapter = options.adapter.trim();
  if (!callerAdapter || callerAdapter !== manifest.adapter) {
    throw new Error(
      `[goal-mode-entry] attach adapter mismatch: caller=${callerAdapter || '<empty>'}, manifest=${manifest.adapter}`,
    );
  }
  const adapter = manifest.adapter;
  const attendedRoute = routeGoalCapability(
    loadGoalCapability(options.frameworkRoot, adapter),
    'attended',
  );
  if (attendedRoute.kind === 'manual') {
    const result: InSessionRoundResult = {
      status: 'manual_fallback',
      assessment: null,
      waiting_item: attendedRoute.reason,
      status_line:
        `feature=${manifest.feature} | phase=${manifest.start_phase} | ` +
        `运行方式=有人在场 | 等待=${attendedRoute.reason}`,
    };
    options.onRound?.(result);
    return result;
  }
  if (attendedRoute.kind !== 'in_session') {
    throw new Error(`[goal-mode-entry] attended capability route 非法：${attendedRoute.reason}`);
  }
  let runDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
  const hasExecutionStart = loadEventsJsonl(path.join(runDir, 'events.jsonl'))
    .some((event) => event.type === 'run_start');
  const executor = new AttendedGoalPhaseExecutor(async (context) => {
    const outcome = await options.executePhase(
      context.phase,
      { action: 'run_phase', phase: context.phase, instruction: context.instruction ?? '' },
      {
        runId: context.runId,
        phase: context.phase,
        attemptId: context.attemptId,
        ownerId: context.owner.owner_id,
        ownerEpoch: context.owner.epoch,
      },
    );
    return outcome;
  });
  const runtime = new GoalPhaseRuntime({
    onScopeRevision: options.onScopeRevision,
    args: [
      hasExecutionStart ? '--resume' : '--attach-created', manifest.run_id,
      '--feature', manifest.feature,
      '--adapter', adapter,
      '--foreground-ok',
      '--runtime-executor', 'attended',
      '--runtime-owner', 'session',
      '--project-root', options.projectRoot,
      '--framework-root', options.frameworkRoot,
      ...(options.forceTakeover ? ['--force-resume'] : []),
    ],
    ownerKind: 'session',
    executor,
    authorization: options.authorization ?? { mode: 'goal_mode' },
    ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
  });
  const exitCode = await runtime.run();
  if (runtime.lastRunId && runtime.lastRunId !== manifest.run_id) {
    manifest = loadGoalManifestFromRun(options.projectRoot, runtime.lastRunId, { feature: options.feature });
    runDir = path.resolve(options.projectRoot, manifest.report_dir);
  }

  const rawEvents = loadEventsJsonl(path.join(runDir, 'events.jsonl'));
  const canonical = projectCanonicalLifecycle(rawEvents);
  const lastVerdict = [...canonical].reverse().find((event) => event.type === 'phase_verdict');
  const lastHalt = [...canonical].reverse().find((event) => event.type === 'phase_halt');
  const lastEnd = [...canonical].reverse().find((event) => event.type === 'run_end');
  const phase = lastVerdict?.type === 'phase_verdict'
    ? lastVerdict.phase
    : lastHalt?.type === 'phase_halt'
      ? lastHalt.phase
      : manifest.start_phase;
  const outcome = lastVerdict?.type === 'phase_verdict'
    ? {
        status: lastVerdict.verdict === 'PASS' ? 'passed' as const : 'failed' as const,
        phase,
        details: lastVerdict.halt_reason,
      }
    : lastHalt?.type === 'phase_halt'
      ? { status: 'waiting' as const, phase, details: lastHalt.halt_reason }
      : undefined;
  const result: InSessionRoundResult = {
    status: exitCode === 0 && options.authorization?.mode === 'manual'
      ? 'manual_fallback'
      : lastEnd?.type === 'run_end' && lastEnd.status === 'CHAIN_SLICE_COMPLETED'
      ? 'reconciled'
      : lastHalt?.type === 'phase_halt' && lastHalt.halt_reason === 'executor_waiting'
        ? 'waiting'
        : exitCode === 0
          ? 'executed'
          : 'fused',
    assessment: null,
    outcome,
    ...(exitCode !== 0 ? { waiting_item: lastHalt?.type === 'phase_halt'
      ? lastHalt.halt_reason ?? 'runtime halted'
      : 'runtime halted' } : {}),
    status_line: `feature=${manifest.feature} | phase=${phase} | runtime=canonical | exit=${exitCode}`,
  };
  options.onRound?.(result);
  return result;
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: [
      'project-root', 'framework-root', 'feature', 'run-id', 'adapter', 'requirement', 'start', 'end',
      'authorization-mode', 'through-phase', 'run-mode', 'adapter-source',
      // D0.2 候选生成入参（主 Agent 四项职责的机器接口）
      'completion-target', 'requested-results', 'requested-phases',
      'impact-behavior-change', 'impact-reason', 'impact-basis',
      // f9c2e6b4 t4：与 goal-runner 同名同义，共用同一读取函数（相对路径按 projectRoot 解析）
      'requirement-file',
    ],
    boolean: ['force', 'force-takeover', 'prepare-run', 'prepare-scope', 'overwrite', 'help'],
  });
  if (argv.help) {
    console.log(
      'Usage: goal-mode-entry.ts --feature <f> --run-id <id> --adapter <name> ' +
      '--run-mode attended [--project-root <root>] [--framework-root <framework>] [--force-takeover]\n' +
      'Fresh attended run: add --prepare-run --requirement "<text>" (optionally --run-id/--start/--end; --force records an operator override).\n' +
      'Scope candidate (run this BEFORE --prepare-run; the two flags are mutually exclusive):\n' +
      '  --prepare-scope --feature <f> --completion-target <request|feature>\n' +
      '    --requested-results "<text>" (repeatable) --requested-phases spec,plan,coding,review,ut\n' +
      '    [--requirement "<text>" | --requirement-file <path>]  same text you will pass to --prepare-run\n' +
      '    [--impact-behavior-change true|false --impact-reason "<text>" --impact-basis <path>]  all three or none\n' +
      '    [--overwrite]  only when an existing candidate differs from the generated one\n' +
      '  e.g. --prepare-scope --feature ledger-refresh --completion-target feature\n' +
      '       --requested-results "refreshed balance is correct" --requested-phases coding,review,ut\n' +
      '       --impact-behavior-change false --impact-reason "internal value only" --impact-basis src/ledger/Balance.ets\n' +
      'Long / multi-line requirement: use --requirement-file <path> (mutually exclusive with --requirement).\n' +
      'Protocol: stdout emits one JSON phase_execute_request per round; stdin supplies ' +
      'one JSON {status:"passed|failed|waiting",phase,details?} response.',
    );
    return;
  }
  const feature = String(argv.feature ?? '').trim();
  const runId = String(argv['run-id'] ?? '').trim();
  const adapter = String(argv.adapter ?? '').trim();
  const runMode = String(argv['run-mode'] ?? '').trim();
  const prepareRun = Boolean(argv['prepare-run']);
  const prepareScope = Boolean(argv['prepare-scope']);
  // 两件事、两步走：候选生成在出生**前**，创建 run 在出生**时**。同时给出即拒绝——
  // 否则 prepare-run 先执行、prepare-scope 被静默忽略，用户以为只生成了候选却已经建了 run。
  if (prepareRun && prepareScope) throw new Error('[goal-mode-entry] --prepare-scope 与 --prepare-run 互斥：先生成候选、核对投影后再单独创建 run');
  // `--prepare-scope` 只生成出生前的范围候选：既不创建 run，也不 attach 任何执行会话，
  // 因此没有 run mode 可言。attach 与 --prepare-run 的 attended 契约一行不放宽。
  if (!prepareScope) assertAttendedRunMode(runMode || undefined);
  const adapterSourceRaw = String(argv['adapter-source'] ?? '').trim();
  const adapterSources = new Set<string>(RUN_ADAPTER_PROVENANCES);
  if (adapterSourceRaw && !adapterSources.has(adapterSourceRaw)) {
    throw new Error(`--adapter-source 非法：${adapterSourceRaw}`);
  }
  const projectRoot = path.resolve(String(argv['project-root'] ?? process.cwd()));
  const frameworkRoot = path.resolve(String(argv['framework-root'] ?? defaultGoalModeFrameworkRoot()));
  if (prepareRun) {
    const prepared = prepareGoalModeRun({
      projectRoot,
      frameworkRoot,
      feature,
      runId: runId || undefined,
      adapter,
      ...(adapterSourceRaw
        ? { adapterSource: adapterSourceRaw as RunAdapterProvenance }
        : {}),
      // f9c2e6b4 t4：两个启动入口**共用** resolveRequirementInput——互斥判定、相对路径
      // 口径、空文件处置只有一份实现，不写两遍（codex 开工原则②）。
      // plan c4e8a1f7 T2：来源列表一并透传（frozen requirement 的 provenance）。
      ...(() => {
        const resolved = resolveRequirementInput({
          requirement: argv.requirement,
          requirementFile: argv['requirement-file'],
          projectRoot,
        });
        return {
          requirement: resolved.text ?? '',
          ...(resolved.sources.length > 0 ? { requirementSourceFiles: resolved.sources } : {}),
        };
      })(),
      startPhase: typeof argv.start === 'string' ? argv.start : undefined,
      endPhase: typeof argv.end === 'string' ? argv.end : undefined,
      forceFresh: Boolean(argv.force),
    });
    console.log(JSON.stringify({
      type: 'goal_run_prepared',
      run_id: prepared.manifest.run_id,
      manifest: prepared.manifestPath,
      run_dir: prepared.runDir,
      // plan 4e6fb3b6 §7：fresh = 新出生；rejoin = 同一任务的未终局 run，附着它继续（条件是否解除由原检查判断）
      continuation: prepared.continuation.kind,
      next: 'rerun without --prepare-run to attach the attended host bridge',
    }));
    return;
  }
  if (prepareScope) {
    // D0.2：候选由机器生成——主 Agent 只提供四项输入（完成终点、请求结果、明确的请求
    // 动作、影响判断及其来源路径）。绑定、指纹、unit/device/visual 派生、code-review 补齐
    // 全部由既有生产函数完成，CLI 只做入参解析与投影打印，不做任何推断。
    const list = (value: unknown): string[] =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value])
        .map(item => String(item).trim()).filter(Boolean);
    const completionTarget = String(argv['completion-target'] ?? '').trim();
    if (completionTarget !== 'request' && completionTarget !== 'feature') {
      throw new Error('--completion-target 必须是 request 或 feature');
    }
    const requestedPhases = list(argv['requested-phases']).flatMap(value => value.split(',')).map(item => item.trim()).filter(Boolean);
    if (!requestedPhases.length) {
      // 不猜动作：机器只把**既有阶段证据检查**的事实摆出来，判断权留给显式请求。
      console.error(completionTarget === 'request'
        ? 'request 终点必须显式给出 --requested-phases（用户点名跑哪个阶段，猜测即越权）'
        : '请求动作须由 --requested-phases 显式给出（改代码 → 含 coding；只补验证 → 只列验证阶段）');
      console.error(JSON.stringify({ type: 'phase_evidence_health', feature, phases: featureScopePhaseHealth(projectRoot, frameworkRoot, feature) }, null, 2));
      process.exitCode = 1;
      return;
    }
    const impactBasis = list(argv['impact-basis']);
    const impactReason = String(argv['impact-reason'] ?? '').trim();
    // `--impact-behavior-change` 裸传（无值）时 minimist 给空字符串——那是**传了但没给值**，
    // 不是没传。用 hasOwnProperty 区分，传了空值一律拒绝，不当成「未提供」静默放过。
    const impactFlagGiven = Object.prototype.hasOwnProperty.call(argv, 'impact-behavior-change');
    const impactFlag = String(argv['impact-behavior-change'] ?? '').trim().toLowerCase();
    if (impactFlagGiven && impactFlag !== 'true' && impactFlag !== 'false') throw new Error('--impact-behavior-change 必须是 true 或 false');
    // 影响判断是一项完整输入：三件缺一不可。只给来源或只给理由 = 判断没给全，
    // 静默忽略会让候选悄悄退回「无影响判断」（device 义务保持 unknown）而用户以为给过了。
    if (impactFlag && !impactBasis.length) throw new Error('--impact-behavior-change 必须配 --impact-basis（影响判断必须有可核验来源）');
    if (impactFlag && !impactReason) throw new Error('--impact-behavior-change 必须配 --impact-reason（判断要说明依据）');
    if (!impactFlag && (impactBasis.length || impactReason)) {
      throw new Error('--impact-basis / --impact-reason 必须与 --impact-behavior-change 一起给出（不接受半份影响判断）');
    }
    const prepared = prepareFeatureScopeCandidate({
      projectRoot, frameworkRoot, feature,
      completionTarget,
      requestedResults: list(argv['requested-results']),
      requestedPhases,
      // 与 --prepare-run 同一份需求文本（视觉相关性由它判定）；两处不同源会让候选与出生结论分叉。
      ...(() => {
        const resolved = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot });
        return resolved.text ? { requirement: resolved.text, ...(resolved.sources.length ? { requirementSourceFiles: resolved.sources } : {}) } : {};
      })(),
      ...(impactFlag
        ? { impact: { userVisibleBehaviorChange: impactFlag === 'true', reason: impactReason, basisPaths: impactBasis } }
        : {}),
      overwrite: Boolean(argv.overwrite),
    });
    const knowledgeContracts = prepared.scope.obligations.flatMap(obligation => obligation.basis).find(binding => binding.input_id === 'contracts');
    let contracts: import('./utils/types').ContractsSpec | undefined;
    let knowledgeBindingError: string | undefined;
    try {
      if (knowledgeContracts) contracts = readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'plan', track: 'full' }, knowledgeContracts) as import('./utils/types').ContractsSpec;
    } catch (error) {
      knowledgeBindingError = `知识装配的契约绑定读取失败：${(error as Error).message}；候选${prepared.written ? '已写入' : '未改写'}，本次准备未通过。修正来源后重新运行 --prepare-scope；以下仅提供无契约的知识索引。`;
      console.error(knowledgeBindingError);
      process.exitCode = 1;
    }
    const requirement = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot }).text;
    const knowledge = prepared.scope.phase_chain.map(phase => {
      const view = assembleKnowledge({ projectRoot, frameworkRoot, phase, subject: 'feature', role: 'author',
        requirement, contracts });
      if (knowledgeBindingError) view.notices.unshift(knowledgeBindingError);
      return { phase, ...view, instructions: renderKnowledge(view) };
    });
    console.log(JSON.stringify({
      type: 'scope_candidate_prepared',
      knowledge,
      state: prepared.state,
      written: prepared.written,
      candidate: path.relative(projectRoot, prepared.path).replace(/\\/g, '/'),
      phase_chain: prepared.scope.phase_chain,
      obligations: prepared.scope.obligations.map(obligation => ({ id: obligation.id, applicability: obligation.applicability, reason: obligation.reason })),
      unresolved: prepared.scope.unresolved,
      explanation: knowledgeBindingError ? prepared.explanation + '\n' + knowledgeBindingError : prepared.explanation,
    }, null, 2));
    if (prepared.state === 'differs') {
      console.error('候选已存在且与本次生成不一致——不静默覆盖。差异字段：');
      const onDisk = (YAML.parse(fs.readFileSync(prepared.path, 'utf-8')) as { execution_scope?: unknown } | null)?.execution_scope;
      for (const line of describeCandidateDifference(onDisk, prepared.candidate)) console.error(`  · ${line}`);
      console.error('核对上面的投影与差异后用 --overwrite 重跑。');
      process.exitCode = 1;
    }
    return;
  }
  if (!feature || !runId || !adapter) {
    throw new Error('--feature, --run-id, and --adapter are required');
  }
  const mode = String(argv['authorization-mode'] ?? 'goal_mode');
  if (!['manual', 'batch_authorized', 'goal_mode'].includes(mode)) {
    throw new Error(`authorization mode 非法：${mode}`);
  }
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = input[Symbol.asyncIterator]();
  try {
    const result = await runGoalModeHostBridge({
      projectRoot,
      frameworkRoot,
      feature,
      runId,
      adapter,
      runMode,
      forceTakeover: Boolean(argv['force-takeover']),
      authorization: {
        mode: mode as 'manual' | 'batch_authorized' | 'goal_mode',
        ...(argv['through-phase'] ? { through_phase: String(argv['through-phase']) } : {}),
      },
      onRound: (round) => console.error(round.status_line),
      executePhase: async (phase, recommendation, context) => {
        console.log(JSON.stringify(buildPhaseExecuteRequest(context, recommendation)));
        const next = await lines.next();
        if (next.done) throw new Error('phase executor protocol EOF');
        const response = JSON.parse(next.value) as {
          status?: string; phase?: string; details?: string;
        };
        if (!['passed', 'failed', 'waiting'].includes(response.status ?? '')) {
          throw new Error('phase executor response.status 非法');
        }
        if (response.phase && response.phase !== phase) {
          throw new Error(`phase executor response phase mismatch: ${response.phase} != ${phase}`);
        }
        return {
          status: response.status as 'passed' | 'failed' | 'waiting',
          phase,
          details: response.details,
        };
      },
    });
    console.log(JSON.stringify({ type: 'goal_session_result', result }));
  } finally {
    input.close();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(`[goal-mode-entry] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}

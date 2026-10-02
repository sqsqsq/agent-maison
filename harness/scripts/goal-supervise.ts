#!/usr/bin/env node
// ============================================================================
// goal-supervise.ts — supervisor 执行器 CLI（plan a4f7e2b1 t2 生产闭环）
// ----------------------------------------------------------------------------
// 决策核在 utils/goal-supervisor.ts（纯函数）。本文件是它**唯一的生产执行链**：
//
//   读取 run 状态 → 决策 → （resume 时）退避 → 落 supervisor_restart → spawn --resume
//
// 刻意保持最小：**没有 daemon、没有任务平台抽象、没有新状态机**。周期性触发交给
// OS 计划任务（Windows schtasks），本进程每次只做一轮判断，做完就退出。
//
// 用法：
//   goal-supervise --feature <f> [--run-id latest|<id>] [--dry-run]
//   goal-supervise --install-schtasks --feature <f> [--every-minutes 5]
//   goal-supervise --uninstall-schtasks --feature <f>
//
// 退出码：0=已处理（含判定不介入）；1=参数/环境错误。**决策为不重启不算失败**。
// ============================================================================

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadAuthoritativeEvents } from './utils/goal-runner-phase';
import { countSupervisorRestarts, superviseRun, schedulerSupport, restartBackoffMs } from './utils/goal-supervisor';
import { defaultProcessProbe } from './utils/device-session';
import {
  pidExists,
  reconcileGuardianOwnership,
  type PidExistenceProbe,
} from './utils/goal-containment-reconcile';
import { runConditionProbe as runSharedConditionProbe } from './utils/condition-wait';
import { featureDir } from '../config';
import { readRunControl, type RunControlV1 } from './utils/goal-run-control';
import { HANDOFF_REQUEST_NAME, isValidHandoffRequest } from './utils/goal-handoff';
import { inspectGoalRunCreationFiles } from './utils/goal-run-creation';
import { FEATURE_LOCK_NAME, releaseLock, tryAcquireLock } from './utils/goal-run-lock';

interface ResolvedRun {
  runId: string;
  reportDir: string;
  runDir: string;
  eventsPath: string;
}

/** 解析 run：显式 id 或 latest（按目录名字典序——run_id 前缀是 ISO 时间戳，字典序即时间序）。 */
function resolveRun(
  projectRoot: string,
  feature: string,
  wanted: string,
): ResolvedRun | { runId: string; creationIncomplete: string } | null {
  const runsRoot = path.join(featureDir(projectRoot, feature), 'goal-runs');
  if (!fs.existsSync(runsRoot)) return null;
  const ids = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  const runId = wanted && wanted !== 'latest' ? wanted : ids[ids.length - 1];
  if (!runId || !ids.includes(runId)) return null;
  const reportDir = path
    .relative(projectRoot, path.join(runsRoot, runId))
    .replace(/\\/g, '/');
  const runDir = path.join(projectRoot, reportDir);
  const creation = inspectGoalRunCreationFiles(
    path.join(runDir, 'manifest.json'),
    path.join(runDir, 'events.jsonl'),
  );
  if (creation.state !== 'complete' && creation.state !== 'legacy') {
    return {
      runId,
      creationIncomplete:
        creation.state === 'creation_incomplete' ? creation.reason : 'manifest/run_created 出生记录缺失',
    };
  }
  return { runId, reportDir, runDir, eventsPath: path.join(runDir, 'events.jsonl') };
}

type OwnerGate =
  | { action: 'process'; control: RunControlV1 }
  | { action: 'no_op'; reason: string };

/** Supervisor is read-only outside process ownership; malformed mailbox state fails closed. */
function hasIncompleteHandoff(runDir: string, runId: string): boolean {
  const filePath = path.join(runDir, HANDOFF_REQUEST_NAME);
  if (!fs.existsSync(filePath)) return false;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isValidHandoffRequest(value) || value.run_id !== runId) return true;
    return value.status === 'pending' || value.status === 'consumed';
  } catch {
    return true;
  }
}

function gateSupervisorOwner(runDir: string, runId: string): OwnerGate {
  let control: RunControlV1 | null;
  try {
    control = readRunControl(runDir, runId);
  } catch (error) {
    return { action: 'no_op', reason: `run-control 损坏，fail-closed：${(error as Error).message}` };
  }
  if (!control?.owner) {
    return { action: 'no_op', reason: 'run-control owner 缺失，fail-closed' };
  }
  if (control.owner.state === 'quiescing' || hasIncompleteHandoff(runDir, runId)) {
    return { action: 'no_op', reason: 'owner 正在 quiesce 或 handoff 未完成——不抢控制权' };
  }
  if (control.owner.kind === 'session') {
    return {
      action: 'no_op',
      reason: `session owner state=${control.owner.state}——仅 attended bridge/操作者可接管`,
    };
  }
  return { action: 'process', control };
}

/**
 * plan 9c3d7e1a §5.2：起后继不重置重启上限。沿本 run 审计过的 supersede 目标往回，累加同一交付周期内被承接 run 上已记的
 * 重启次数；已完成的 run 属于上一个交付周期，不计也不再往回走。
 */
function inheritedSupervisorRestarts(runDir: string): number {
  const runsDir = path.dirname(runDir);
  const seen = new Set<string>([path.basename(runDir)]);
  let total = 0;
  const visit = (dir: string, self: boolean): void => {
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return;
    const events = loadAuthoritativeEvents(eventsPath) as unknown as Array<Record<string, unknown>>;
    if (!self) {
      const end = [...events].reverse().find((event) => event.type === 'run_end');
      if (end && (end.status === 'CHAIN_SLICE_COMPLETED' || end.status === 'COMPLETED')) return;
      total += countSupervisorRestarts(events);
    }
    for (const event of events) {
      const target = event.type === 'supersede' && typeof event.target_run_id === 'string' ? event.target_run_id : '';
      if (!target || seen.has(target)) continue;
      seen.add(target);
      visit(path.join(runsDir, target), false);
    }
  };
  visit(runDir, true);
  return total;
}

/** 该终局结论是否已记过——同一结论只落一次，防周期任务把事件流刷爆。 */
function hasObservation(events: ReadonlyArray<Record<string, unknown>>, action: string): boolean {
  return events.some((e) => e?.type === 'supervisor_observation' && e.action === action);
}

function appendSupervisorEvent(eventsPath: string, event: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.appendFileSync(eventsPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, 'utf-8');
}

/**
 * 被拉起的 runner 脚本路径注入（测试用；同 goal-runner.ts 那五个 `__testing_set*` 缝）。
 *
 * 为什么必须开这条缝：`goal-runner.ts` 自己也按 `detectRepoLayout(__dirname)` 推
 * projectRoot，所以**无论怎么传 `--project-root`，被 spawn 的真 runner 都会去操作
 * 框架源仓**——非 dry-run 的集成测试因此无处落脚（在单测里真跑一个 goal run 还会往
 * 用户仓库写 run 目录、留 detached 残留进程）。注入后可指向临时工程里的替身。
 *
 * 刻意**不做成 CLI 旗标或环境变量**：supervisor 能被外部指向任意脚本，本身就是一条
 * 注入面（本轮 a5f9c3e2 的主线正是「agent 可写面不得产生权威」）。生产恒为本仓 runner。
 */
let injectedRunnerScript: string | null = null;
export function __testing_setRunnerScript(scriptPath: string | null): void {
  injectedRunnerScript = scriptPath;
}
let injectedConditionProbe: ((probe: string, phase?: string) => { ready: boolean; reason?: string }) | null = null;
export function __testing_setConditionProbe(
  probe: ((probe: string, phase?: string) => { ready: boolean; reason?: string }) | null,
): void {
  injectedConditionProbe = probe;
}
// plan c6a9e4d2 P1-3：接管守卫的进程探针注入（单测无需真起进程；null=生产 defaultProcessProbe）
let injectedProcessProbe: ReturnType<typeof defaultProcessProbe> | null = null;
export function __testing_setProcessProbe(probe: ReturnType<typeof defaultProcessProbe> | null): void {
  injectedProcessProbe = probe;
}
function activeProcessProbe(): ReturnType<typeof defaultProcessProbe> {
  return injectedProcessProbe ?? defaultProcessProbe();
}
// P0（二轮 review）：PID existence 通道注入（单测避开真实进程表；null=生产 pidExists）
let injectedPidExists: PidExistenceProbe | null = null;
export function __testing_setPidExists(probe: PidExistenceProbe | null): void {
  injectedPidExists = probe;
}
function activePidExists(): PidExistenceProbe {
  return injectedPidExists ?? pidExists;
}
// P1-3：spawn 注入（行为面测试：断言拉起参数且零副效应；null=生产 spawn）
let injectedSpawnImpl:
  | ((file: string, args: string[], opts: object) => Pick<ChildProcess, 'pid' | 'unref'>)
  | null = null;
export function __testing_setSpawnImpl(
  fn: ((file: string, args: string[], opts: object) => Pick<ChildProcess, 'pid' | 'unref'>) | null,
): void {
  injectedSpawnImpl = fn;
}
function runnerScriptPath(): string {
  return injectedRunnerScript ?? path.join(__dirname, 'goal-runner.ts');
}

// plan 4e6fb3b6 §5.1：探针实现已提到 utils/condition-wait（runtime 进程内等待与本 CLI 共用）。
function runConditionProbe(
  projectRoot: string,
  reportDir: string,
  probe: string,
  phase?: string,
): { ready: boolean; reason?: string } {
  if (injectedConditionProbe) return injectedConditionProbe(probe, phase);
  return runSharedConditionProbe(projectRoot, reportDir, probe, phase);
}

const TASK_PREFIX = 'MaisonGoalSupervise';

function taskName(feature: string): string {
  return `${TASK_PREFIX}_${feature.replace(/[^\w.-]/g, '_')}`;
}

/** schtasks 薄包装——只负责「每 N 分钟跑一次本 CLI」，不做任何调度抽象。 */
function installSchtasks(args: { feature: string; everyMinutes: number; selfCmd: string }): number {
  const support = schedulerSupport();
  if (!support.supported) {
    console.error(`[goal-supervise] ${support.reason}`);
    return 1;
  }
  const r = spawnSync(
    'schtasks',
    [
      '/Create', '/F',
      '/TN', taskName(args.feature),
      '/SC', 'MINUTE', '/MO', String(args.everyMinutes),
      '/TR', args.selfCmd,
    ],
    { encoding: 'utf-8', windowsHide: true },
  );
  if (r.status !== 0) {
    console.error(`[goal-supervise] schtasks 创建失败：${(r.stderr ?? '').trim() || r.status}`);
    return 1;
  }
  console.log(`[goal-supervise] 已注册计划任务 ${taskName(args.feature)}（每 ${args.everyMinutes} 分钟）`);
  console.log(`  触发命令：${args.selfCmd}`);
  return 0;
}

function uninstallSchtasks(feature: string): number {
  const support = schedulerSupport();
  if (!support.supported) {
    console.error(`[goal-supervise] ${support.reason}`);
    return 1;
  }
  const r = spawnSync('schtasks', ['/Delete', '/F', '/TN', taskName(feature)], {
    encoding: 'utf-8', windowsHide: true,
  });
  // 任务本就不存在时 schtasks 也返回非 0——如实说明，不当作失败
  console.log(
    r.status === 0
      ? `[goal-supervise] 已卸载计划任务 ${taskName(feature)}`
      : `[goal-supervise] 未找到或无法删除计划任务 ${taskName(feature)}（可能本就不存在）`,
  );
  return 0;
}

async function main(): Promise<number> {
  const argv = minimist(process.argv.slice(2), {
    string: ['feature', 'run-id', 'every-minutes', 'project-root'],
    boolean: ['dry-run', 'install-schtasks', 'uninstall-schtasks', 'help'],
  });
  if (argv.help || !argv.feature) {
    console.error(
      'usage: goal-supervise --feature <f> [--run-id latest|<id>] [--dry-run]\n' +
      '       goal-supervise --install-schtasks --feature <f> [--every-minutes 5]\n' +
      '       goal-supervise --uninstall-schtasks --feature <f>',
    );
    return argv.help ? 0 : 1;
  }
  const feature = String(argv.feature).trim();
  // 缺省按**脚本自身位置**推 projectRoot（与 goal-runner 同口径）；
  // `--project-root` 供「从别处触发」的场景显式指定（schtasks 的工作目录不受控，
  // 集成测试也需要指向临时工程）。不是新抽象，就是一个显式入参。
  const projectRoot = typeof argv['project-root'] === 'string' && argv['project-root'].trim()
    ? path.resolve(String(argv['project-root']).trim())
    : detectRepoLayout(__dirname).projectRoot;

  if (argv['uninstall-schtasks']) return uninstallSchtasks(feature);
  if (argv['install-schtasks']) {
    const every = Math.max(1, Number(argv['every-minutes'] ?? 5) || 5);
    const selfCmd =
      `"${process.execPath}" "${path.join(__dirname, '..', 'node_modules', 'ts-node', 'dist', 'bin.js')}" ` +
      `"${__filename}" --feature ${feature}`;
    return installSchtasks({ feature, everyMinutes: every, selfCmd });
  }

  const run = resolveRun(projectRoot, feature, String(argv['run-id'] ?? 'latest'));
  if (!run) {
    console.error(`[goal-supervise] 找不到 feature=${feature} 的 goal run`);
    return 1;
  }
  if ('creationIncomplete' in run) {
    console.log(
      `[goal-supervise] run=${run.runId} → no_op：CREATION_INCOMPLETE（${run.creationIncomplete}）；` +
        '仅供诊断，不自动 resume/接管',
    );
    return 0;
  }
  const ownerGate = gateSupervisorOwner(run.runDir, run.runId);
  if (ownerGate.action === 'no_op') {
    console.log(`[goal-supervise] run=${run.runId} → no_op：${ownerGate.reason}`);
    return 0;
  }
  const decide = () => {
    const events = loadAuthoritativeEvents(run.eventsPath) as unknown as Array<Record<string, unknown>>;
    const decision = superviseRun({
      projectRoot, reportDir: run.reportDir, runId: run.runId, events,
      conditionProbe: (probe, phase) => runConditionProbe(projectRoot, run.reportDir, probe, phase),
      inheritedRestarts: inheritedSupervisorRestarts(run.runDir),
    });
    return { events, decision };
  };

  // 退避（首次为 0）——防重启风暴，退避值与重启序号同源自决策核。在锁外睡：最长 10 分钟，持锁睡会挡住
  // 人工 resume 与同蓝图的设计修复；睡完在锁内重读重判（见下）。
  const preview = decide().decision;
  if (!argv['dry-run'] && preview.action === 'resume' && preview.backoff_ms > 0) {
    console.log(`[goal-supervise] 退避 ${Math.round(preview.backoff_ms / 1000)}s 后重启…`);
    await new Promise((r) => setTimeout(r, preview.backoff_ms));
  }

  // plan 9c3d7e1a t6（codex 第三轮）：写本 run 的事件与决定拉起都在该 feature 的锁内。取不到 = 有人持有
  // （run 在跑，或同蓝图的设计修复正持锁——修复按整文件期望值核对事件文件，锁外追加会被判越界并写回）
  // → 本轮不写、不拉起。拉起在放锁之后（子进程自己取锁）。
  const lockPath = path.join(path.dirname(run.runDir), FEATURE_LOCK_NAME);
  const lock = tryAcquireLock(lockPath, {});
  if (!lock) {
    console.log(`[goal-supervise] run=${run.runId} → no_op：feature 锁被持有（run 在跑或同蓝图的设计修复进行中），本轮不写事件、不拉起`);
    return 0;
  }
  try {
    const { events, decision } = decide();
    console.log(`[goal-supervise] run=${run.runId} → ${decision.action}：${decision.reason}`);
    if (decision.action !== 'resume') {
      // 判定不介入/不重启**不是失败**——supervisor 的职责就是分辨该不该拉。
      // codex 订正：**no_op 不落事件**。feature 级计划任务不随 run 完成而消失，
      // 每 5 分钟落一条 = 已完成/长期 WAITING 的 run 每天多 288 条零信息事件，
      // 而且都出现在 run_end 之后。终局类结论有审计价值，但**只记一次**（去重）。
      if (decision.action !== 'no_op' && !hasObservation(events, decision.action)) {
        appendSupervisorEvent(run.eventsPath, {
          type: 'supervisor_observation', run_id: run.runId,
          action: decision.action, reason: decision.reason,
        });
      }
      return 0;
    }

    if (argv['dry-run']) {
      console.log(`[goal-supervise] dry-run：本会退避 ${decision.backoff_ms}ms 后 --resume（第 ${decision.restart_seq} 次）`);
      return 0;
    }
    // 睡的是锁外那次判定的退避；锁内这次若要求退避而序号对不上（期间另一轮 supervisor 已拉起过），本轮让给下一轮。
    if (decision.backoff_ms > 0 && !(preview.action === 'resume' && preview.restart_seq === decision.restart_seq)) {
      console.log(`[goal-supervise] run=${run.runId} → no_op：退避期间重启序号已变（第 ${decision.restart_seq} 次），下一轮再判`);
      return 0;
    }

    // t3（plan c6a9e4d2）：接管守卫——只允许在确认旧 owner（guardian）死亡后拉起：
    //   · 任一 guardian 严格身份匹配且存活 → 旧 owner 未死 → 维持退避、保留 cooldown，
    //     不拉起（多未闭合逐项检查，不漏更早孤儿）；
    //   · 未闭合 invoke 却无任何 Job 绑定（旧版 run）→ fail-closed，人工清理，
    //     不自动拉起（--force-resume 是人工确认路径，supervisor 不代其确认）；
    //   · guardian 已不存在/身份不匹配/不可核实 → 不阻断（警告），确认旧 owner 死亡
    //     成立后照常拉起；
    //   · P1-3（review）：**所有允许拉起的分支统一追加受控 --force-resume**——旧 owner
    //     确认死亡即视为受控恢复现场；若最后一个 events run_end 是 HALTED，不带 force
    //     会被 terminal guard 拒绝，恢复再次失效。cooldown 语义保留在 runner 端
    //     （force 不 bypass cooldown）。
    const guardianState = reconcileGuardianOwnership(events, activeProcessProbe(), activePidExists());
    if (guardianState.kind === 'legacy_run') {
      console.log(
        `[goal-supervise] 旧版 run 无 Job 绑定事件（${guardianState.reason}）——`
        + 'fail-closed 需人工清理，supervisor 不自动拉起',
      );
      if (!hasObservation(events, 'legacy_needs_manual')) {
        appendSupervisorEvent(run.eventsPath, {
          type: 'supervisor_observation',
          run_id: run.runId,
          action: 'legacy_needs_manual',
          reason: guardianState.reason,
        });
      }
      return 0;
    }
    if (guardianState.kind === 'outcomes') {
      const aliveMatch = guardianState.items.find((i) => i.kind === 'guardian_alive_matching');
      if (aliveMatch && aliveMatch.kind === 'guardian_alive_matching') {
        console.log(
          `[goal-supervise] 接管守卫：guardian(pid=${aliveMatch.bound.pid}) 仍存活且身份严格匹配` +
          '——旧 owner 未死，维持退避不拉起',
        );
        if (!hasObservation(events, 'owner_alive')) {
          appendSupervisorEvent(run.eventsPath, {
            type: 'supervisor_observation',
            run_id: run.runId,
            action: 'owner_alive',
            reason: `guardian(pid=${aliveMatch.bound.pid}) 身份匹配且存活——不拉起`,
          });
        }
        return 0;
      }
      for (const item of guardianState.items) {
        if (item.kind === 'guardian_identity_unverifiable') {
          console.warn(`[goal-supervise] ⚠ 接管守卫：${item.reason}（不杀、不阻断，照常拉起）`);
        }
      }
    }
    // 到达此处 = 旧 owner 死亡已确认（guardian 不存在/不可核实/无未闭合）——统一受控 force。
    const allowedForceResume = true;

    // **先落事件再拉起**：崩在 spawn 之前也已计数，避免「拉起失败但没记账」导致无限重试
    appendSupervisorEvent(run.eventsPath, {
      type: 'supervisor_restart', action: 'resume',
      run_id: run.runId,
      restart_seq: decision.restart_seq,
      backoff_ms: decision.backoff_ms,
      reason: decision.reason,
    });

    // plan 4e6fb3b6 §5.3：原"事件带 successor_required 就改起后继 run"一支已删——生产代码
    // 没有任何产出方（检索证据见该 plan 实施记录）。supervisor 只拉起 `--resume`，不做判断；
    // 原 run 继续还是起后继由 runner 的恢复入口决定（plan 9c3d7e1a §5.3）。
    const runnerArgs = [
      runnerScriptPath(),
      '--feature', feature,
      '--resume', run.runId,
      // t3（plan c6a9e4d2）：受控 force——仅当确认旧 owner（guardian）死亡（guardian
      // 不存在=Job 已关，唯一持柄契约）后才追加 --force-resume；owner 存活时上层
      // 已维持退避。cooldown 语义保留在 runner 端（force 不 bypass cooldown）。
      ...(allowedForceResume ? ['--force-resume'] : []),
      '--detach',
    ];
    // 放锁后再拉起（子进程自己取锁）；拉起之后不再写本 run 的事件——原 supervisor_restart_spawned 已删：
    // 它落在锁外，且子进程 pid 由 runner 自己的 beacon 与事件记录。
    releaseLock(lockPath, lock.ownerId);
    const spawnImpl = injectedSpawnImpl ?? spawn;
    const child = spawnImpl(process.execPath, [require.resolve('ts-node/dist/bin.js'), ...runnerArgs], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    console.log(`[goal-supervise] 已拉起 goal-runner --resume ${run.runId}（detached, pid=${child.pid ?? '?'}）`);
    return 0;
  } finally {
    // 幂等：已放或已被拉起的子进程取走（ownerId 不同）时不动。
    releaseLock(lockPath, lock.ownerId);
  }
}

// CLI 入口守卫：纯函数需可被单测 import（同 goal-monitor 的教训）
if (require.main === module) {
  void main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error((err as Error).message ?? err);
      process.exit(1);
    });
}

export {
  resolveRun as __testing_resolveRun,
  taskName as __testing_taskName,
  runConditionProbe as __testing_runConditionProbe,
  inheritedSupervisorRestarts as __testing_inheritedSupervisorRestarts,
};
// 进程内入口（测试用）：非 dry-run 分支必须真跑一次才算验收，见 supervisor-kill-recovery
export { main as __testing_main };
export { restartBackoffMs };

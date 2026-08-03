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

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadAuthoritativeEvents } from './utils/goal-runner-phase';
import { superviseRun, schedulerSupport, restartBackoffMs } from './utils/goal-supervisor';
import { featureDir } from '../config';

interface ResolvedRun {
  runId: string;
  reportDir: string;
  eventsPath: string;
}

/** 解析 run：显式 id 或 latest（按目录名字典序——run_id 前缀是 ISO 时间戳，字典序即时间序）。 */
function resolveRun(projectRoot: string, feature: string, wanted: string): ResolvedRun | null {
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
  return { runId, reportDir, eventsPath: path.join(projectRoot, reportDir, 'events.jsonl') };
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
function runnerScriptPath(): string {
  return injectedRunnerScript ?? path.join(__dirname, 'goal-runner.ts');
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
  const events = loadAuthoritativeEvents(run.eventsPath) as unknown as Array<Record<string, unknown>>;
  const decision = superviseRun({
    projectRoot, reportDir: run.reportDir, runId: run.runId, events,
  });

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

  // 退避（首次为 0）——防重启风暴，退避值与重启序号同源自决策核
  if (decision.backoff_ms > 0) {
    console.log(`[goal-supervise] 退避 ${Math.round(decision.backoff_ms / 1000)}s 后重启…`);
    await new Promise((r) => setTimeout(r, decision.backoff_ms));
  }

  // **先落事件再拉起**：崩在 spawn 之前也已计数，避免「拉起失败但没记账」导致无限重试
  appendSupervisorEvent(run.eventsPath, {
    type: 'supervisor_restart',
    run_id: run.runId,
    restart_seq: decision.restart_seq,
    backoff_ms: decision.backoff_ms,
    reason: decision.reason,
  });

  const runnerArgs = [
    runnerScriptPath(),
    '--feature', feature,
    '--resume', run.runId,
    '--detach',
  ];
  const child = spawn(process.execPath, [require.resolve('ts-node/dist/bin.js'), ...runnerArgs], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  console.log(`[goal-supervise] 已拉起 goal-runner --resume ${run.runId}（detached, pid=${child.pid ?? '?'}）`);
  appendSupervisorEvent(run.eventsPath, {
    type: 'supervisor_restart_spawned', run_id: run.runId,
    restart_seq: decision.restart_seq, pid: child.pid ?? null,
  });
  return 0;
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

export { resolveRun as __testing_resolveRun, taskName as __testing_taskName };
// 进程内入口（测试用）：非 dry-run 分支必须真跑一次才算验收，见 supervisor-kill-recovery
export { main as __testing_main };
export { restartBackoffMs };

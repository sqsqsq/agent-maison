// ============================================================================
// liveness-beacon.ts — run 级存活信标（plan a4f7e2b1 t1）
// ----------------------------------------------------------------------------
// 目的：让「进程还活着吗」成为**可对账的事实**，而不是靠 heartbeat 文件的 mtime 猜。
//
// 三条设计约束（plan 明写，实施时逐条落）：
//  1. **进程身份判据单一**：直接复用 device-session.ts 已验证的
//     `ManagedProcessIdentity` 四元组与 `ProcessProbe`——`liveness.json`
//     **不得引入第二套进程身份模型**。单靠 pid 会被 PID 重用误判。
//  2. **探针只读、不写**：判定陈旧的一方绝不改 beacon。写 beacon 的只有 run 自己
//     （启动时写一次、心跳时刷新）；读的一方（supervisor / monitor）纯观察。
//     否则「谁说了算」会在崩溃恢复时变成竞态。
//  3. **反 `/F` 强杀**：Windows `taskkill /F` 不给进程执行清理代码的机会——beacon
//     **不可能**由被杀进程自己标记为死。因此陈旧只能由「下次启动/外部探针对账」判定，
//     **绝不能**因为 beacon 文件还在就宣称 run 存活。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  defaultProcessProbe,
  type ManagedProcessIdentity,
  type ProcessProbe,
} from './device-session';

export const LIVENESS_BEACON_FILENAME = 'liveness.json';

export function livenessBeaconPath(projectRoot: string, reportDir: string): string {
  return path.join(projectRoot, reportDir, LIVENESS_BEACON_FILENAME);
}

/**
 * beacon 承载的进程身份 —— 复用 device-session 的四元组语义；
 * `profile` 位在此承载 run_id（同一台机器上区分不同 run 的等价物）。
 */
export interface LivenessBeacon {
  schema_version: '1.0';
  run_id: string;
  proc: ManagedProcessIdentity;
  /** 最近一次自报活跃时间（ISO）——**仅供诊断**，不作为存活判据 */
  refreshed_at: string;
}

export type BeaconVerdict =
  | { state: 'absent'; reason: string }
  | { state: 'invalid'; reason: string }
  /** 四元组与当前进程完全一致 —— 进程确实还活着 */
  | { state: 'alive'; pid: number }
  /** beacon 在，但进程已不在 / PID 被重用 / 可执行文件不同 —— 陈旧 */
  | { state: 'stale'; reason: string };

/**
 * 写 beacon（**只有 run 自己调**）。identity 由调用方从当前进程取：
 * pid=process.pid、executable=process.execPath、startedAtMs 由 probe 反查自身。
 */
export function writeLivenessBeacon(args: {
  projectRoot: string;
  reportDir: string;
  runId: string;
  probe?: ProcessProbe;
  now?: () => Date;
}): LivenessBeacon | null {
  const probe = args.probe ?? defaultProcessProbe();
  const self = probe.identify(process.pid);
  // 探不到自身身份（非 Windows 的保守 null 分支）→ **不写残缺 beacon**：
  // 一个缺 startedAtMs 的 beacon 无法防 PID 重用，比没有更危险（会被误判 alive）。
  if (!self) return null;
  const beacon: LivenessBeacon = {
    schema_version: '1.0',
    run_id: args.runId,
    proc: { pid: self.pid, startedAtMs: self.startedAtMs, executable: self.executable, profile: args.runId },
    refreshed_at: (args.now?.() ?? new Date()).toISOString(),
  };
  const p = livenessBeaconPath(args.projectRoot, args.reportDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(beacon, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, p);
  return beacon;
}

export function readLivenessBeacon(projectRoot: string, reportDir: string): LivenessBeacon | null {
  const p = livenessBeaconPath(projectRoot, reportDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as LivenessBeacon;
  } catch {
    return null;
  }
}

/**
 * **只读**对账：beacon 记的那个进程现在还在不在。
 *
 * 判 alive 的条件是四元组**全等**——任何一项不符即 stale：
 *   · 进程不存在 → 真死；
 *   · pid 在但创建时间不同 → **PID 被重用**（另一个进程占了这个号，绝不能算活）；
 *   · 可执行文件不同 → 同上；
 *   · run_id 不符 → 这个 beacon 属于别的 run。
 *
 * 反 `/F` 强杀：被 `taskkill /F` 的进程没有机会清理 beacon，文件会原样留着——
 * 所以「文件在」永远不构成存活证据，必须走本函数对账。
 */
export function assessLivenessBeacon(args: {
  beacon: LivenessBeacon | null;
  runId: string;
  probe?: ProcessProbe;
}): BeaconVerdict {
  const { beacon, runId } = args;
  if (!beacon) return { state: 'absent', reason: '无 liveness beacon（旧 run 或尚未写入）' };
  if (beacon.schema_version !== '1.0' || !beacon.proc || typeof beacon.proc.pid !== 'number') {
    return { state: 'invalid', reason: 'beacon 形状/版本失配' };
  }
  if (beacon.run_id !== runId) {
    return { state: 'stale', reason: `beacon 属于另一个 run（${beacon.run_id} ≠ ${runId}）` };
  }
  const probe = args.probe ?? defaultProcessProbe();
  const cur = probe.identify(beacon.proc.pid);
  if (!cur) return { state: 'stale', reason: `pid ${beacon.proc.pid} 已不存在——进程已退出或被强杀` };
  if (cur.startedAtMs !== beacon.proc.startedAtMs) {
    return {
      state: 'stale',
      reason:
        `pid ${beacon.proc.pid} 仍在但创建时间不符（${cur.startedAtMs} ≠ ${beacon.proc.startedAtMs}）` +
        '——PID 已被重用，不是原进程',
    };
  }
  if (cur.executable !== beacon.proc.executable) {
    return {
      state: 'stale',
      reason: `pid ${beacon.proc.pid} 的可执行文件不符（${cur.executable} ≠ ${beacon.proc.executable}）——PID 已被重用`,
    };
  }
  return { state: 'alive', pid: beacon.proc.pid };
}

/**
 * supervisor 侧的「beacon 是否陈旧」布尔（喂 run-state-reducer.supervisorAction 的第一轴）。
 *
 * **absent / invalid 一律按 stale 处理**：拿不到可信存活证据时，宁可判「进程可能已死」
 * 也不能宣称还活着——后者会让一个真死的 run 永远没人拉起（本 plan 立项要解决的事）。
 * 误判的代价是多做一次 resume 前置检查（resume 本身对活着的 run 有 owner/epoch 保护）。
 */
export function isBeaconStale(verdict: BeaconVerdict): boolean {
  return verdict.state !== 'alive';
}

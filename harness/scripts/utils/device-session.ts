// ============================================================================
// device-session.ts — 框架托管设备会话的记录 / 所有权 / 有界回收
//                     （openspec device-readiness-and-completion t2）
// ----------------------------------------------------------------------------
// 事故背景（2026-07-28 bc-openCard run 20260728T031459Z-e19c6b）：agent 自行拉起
// `Emulator.exe -start "Pura 90"` 作为**自己的**后台终端，该常驻进程钉住 cursor-agent
// 不退出 → 阶段假死 84 分钟。故长驻进程一律由 runner 托管、detached 独立进程组，
// 绝不成为 agent 进程的子进程。
//
// 三条红线（对应 spec 的 MUST）：
//   1. **只回收本 run 启动的实例**——用户自己开的模拟器可以当 target 用，但绝不关；
//      所有权用四元组（pid + 启动时间 + 可执行文件 + profile）确认，防 PID 重用误杀。
//   2. **崩溃不假装自清**——崩溃的进程无法执行清理代码。正常退出与 SIGINT/SIGTERM
//      清理；崩溃残留由下次启动 / --resume 依本文件对账做**有界**回收。
//   3. **target_kind 只由正面证据判定**——禁"不是已知模拟器故为真机"的反向推断；
//      判不出就记 unknown，并按模拟器同等封顶（见 harness-gates spec）。
// ============================================================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const DEVICE_SESSION_FILENAME = 'device-session.json';

/** 正面证据判定的目标类型；`unknown` 表示"未能正面确认"，**不得**当作真机 */
export type DeviceTargetKind = 'physical' | 'emulator' | 'unknown';

/** 进程所有权四元组——单靠 pid 会被 PID 重用误杀 */
export interface ManagedProcessIdentity {
  pid: number;
  /** 进程创建时间（epoch ms）；PID 重用时该值必然不同 */
  startedAtMs: number;
  /** 启动该进程的可执行文件绝对路径 */
  executable: string;
  /** 模拟器 profile / AVD 名（如 "Pura 90"） */
  profile: string;
}

export interface DeviceSession {
  schema_version: '1.0';
  /** 目标设备序列号（显式传给 hdc -t，不依赖隐式首个目标） */
  serial: string | null;
  target_kind: DeviceTargetKind;
  /** 本 run 是否是该实例的启动方——**唯一**允许回收的条件 */
  started_by_run: string | null;
  /** 仅当 started_by_run 非空时有值 */
  managed?: ManagedProcessIdentity;
  /** 启动/就绪状态机 */
  status: 'starting' | 'ready' | 'failed' | 'released';
  updated_at: string;
  /** 失败/降级原因（人读） */
  note?: string;
}

/** 状态枚举含 `failed`——S10：启动了但没就绪的实例也要留痕，否则无从回收 */

export function deviceSessionPath(projectRoot: string, reportDir: string): string {
  return path.join(projectRoot, reportDir, DEVICE_SESSION_FILENAME);
}

export function writeDeviceSession(
  projectRoot: string,
  reportDir: string,
  session: Omit<DeviceSession, 'schema_version' | 'updated_at'>,
  now: () => Date = () => new Date(),
): DeviceSession {
  const doc: DeviceSession = {
    schema_version: '1.0',
    ...session,
    updated_at: now().toISOString(),
  };
  const p = deviceSessionPath(projectRoot, reportDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return doc;
}

/**
 * 扫描 feature 下**所有 run 目录**里的托管会话（S10）。
 *
 * 启动对账只看当前 run 的 `report_dir` 是没用的：新 run 有自己的新目录，上一个被硬杀
 * 的 run 的 session 躺在**它自己的**目录里，永远不会被发现——于是每次崩溃都留一个
 * 孤儿模拟器。这里从 goal-runs 根扫一遍，把非本 run 启动的托管会话都交给对账。
 */
export function collectForeignManagedSessions(
  projectRoot: string,
  goalRunsDirRel: string,
  currentRunId: string,
): Array<{ session: DeviceSession; reportDirRel: string }> {
  const root = path.join(projectRoot, goalRunsDirRel);
  let entries: string[];
  try {
    entries = fs.readdirSync(root).filter(n => !n.startsWith('.'));
  } catch {
    return [];
  }
  const out: Array<{ session: DeviceSession; reportDirRel: string }> = [];
  for (const runId of entries) {
    if (runId === currentRunId) continue;
    const rel = path.join(goalRunsDirRel, runId);
    const session = readDeviceSession(projectRoot, rel);
    if (!session?.started_by_run || !session.managed) continue;
    if (session.status === 'released') continue;
    out.push({ session, reportDirRel: rel });
  }
  return out;
}

/** 读会话；文件缺失/损坏/schema 不符 → null（对账侧据此按"无可回收"处理，不猜） */
export function readDeviceSession(projectRoot: string, reportDir: string): DeviceSession | null {
  const p = deviceSessionPath(projectRoot, reportDir);
  if (!fs.existsSync(p)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as DeviceSession;
    if (!doc || doc.schema_version !== '1.0') return null;
    return doc;
  } catch {
    return null;
  }
}

/** 探针注入面：单测无需真起进程 */
export interface ProcessProbe {
  /**
   * 返回该 pid 当前的身份；进程不存在 → null。
   * `commandLine` 可选——能取到时用于核对 profile（同机多实例时 exe 相同不足以区分）。
   */
  identify(
    pid: number,
  ): (Omit<ManagedProcessIdentity, 'profile'> & { commandLine?: string }) | null;
  /** 终止进程树；返回是否发出了终止 */
  killTree(pid: number): boolean;
}

export type ReclaimOutcome =
  | { action: 'none'; reason: string }
  | { action: 'reclaimed'; pid: number }
  | { action: 'refused'; reason: string };

/**
 * 有界回收：**仅**当会话声明本 run 启动、且四元组与当前进程完全一致时才终止。
 *
 * 任何一项不符（进程已退出 / PID 被重用 / 可执行文件不同）→ 拒绝回收并说明原因。
 * 这是"绝不关用户已开实例"的执行点。
 */
export function reclaimManagedDevice(
  session: DeviceSession | null,
  probe: ProcessProbe,
): ReclaimOutcome {
  if (!session) return { action: 'none', reason: '无 device-session 记录' };
  if (!session.started_by_run || !session.managed) {
    return { action: 'none', reason: '非本框架启动的实例（用户自有），不回收' };
  }
  if (session.status === 'released') return { action: 'none', reason: '已释放' };

  const want = session.managed;
  const actual = probe.identify(want.pid);
  if (!actual) return { action: 'none', reason: `pid ${want.pid} 已不存在` };
  // R10（三轮 review）：两侧都取自**同一个 OS 时钟源**（spawn 后立刻用同一探针读
  // CIM CreationDate），故此处**严格等值**，不留容差窗口——容差正是 PID 重用能钻
  // 进来的缝。同一进程的两次读取必然一致；不一致就是换了进程。
  if (actual.startedAtMs !== want.startedAtMs) {
    return {
      action: 'refused',
      reason:
        `pid ${want.pid} 的 OS 创建时间与登记值不符` +
        `（${actual.startedAtMs} ≠ ${want.startedAtMs}，PID 重用），拒绝回收`,
    };
  }
  if (normalizeExe(actual.executable) !== normalizeExe(want.executable)) {
    return { action: 'refused', reason: `pid ${want.pid} 可执行文件不符，拒绝回收` };
  }
  // P1（二轮）：exe 相同还不够——同机可能同时跑多个模拟器实例，命令行里必须能看到
  // 本 session 记录的 profile。
  // P1（三轮）：**取不到命令行也必须拒绝**。此前写成"能取到才校验"，于是探针降级时
  // 校验被静默跳过——那正是 fail-open：信息不全时反而放行了 kill。
  if (actual.commandLine === undefined) {
    return {
      action: 'refused',
      reason: `pid ${want.pid} 无法读取命令行，身份无法核实，拒绝回收（宁可留孤儿也不误杀用户实例）`,
    };
  }
  if (!actual.commandLine.includes(want.profile)) {
    return {
      action: 'refused',
      reason: `pid ${want.pid} 命令行不含本 session 的 profile「${want.profile}」，疑为其它实例，拒绝回收`,
    };
  }
  if (!probe.killTree(want.pid)) {
    return { action: 'refused', reason: `pid ${want.pid} 终止失败` };
  }
  // P1（三轮）：**以进程确实消失为准**，不凭 taskkill 的退出码。此前 `!r.error` 把
  // 非零退出也记成 reclaimed，session 被标 released，实际进程还活着 → 永久泄漏。
  if (probe.identify(want.pid)) {
    return { action: 'refused', reason: `pid ${want.pid} 已发终止信号但进程仍存在，未确认回收` };
  }
  return { action: 'reclaimed', pid: want.pid };
}

function normalizeExe(p: string): string {
  return path.resolve(p).toLowerCase();
}

/**
 * 生产用进程探针（Windows：WMIC/PowerShell 取创建时间与可执行路径）。
 *
 * 取不到身份时返回 null（= 视作进程不存在），**宁可不回收也不误杀**——
 * 误杀用户自己的模拟器比留一个孤儿进程严重得多。
 */
export function defaultProcessProbe(): ProcessProbe {
  return {
    identify(pid: number) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawnSync } = require('child_process') as typeof import('child_process');
        if (process.platform !== 'win32') {
          // POSIX：/proc 不可移植地给创建时间，这里保守返回 null（不回收）
          return null;
        }
        const ps = spawnSync(
          'powershell.exe',
          [
            '-NoProfile', '-NonInteractive', '-Command',
            `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; ` +
            'if ($p) { "{0}|{1}|{2}" -f ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds(), ' +
            '$p.ExecutablePath, ($p.CommandLine -replace "\\r|\\n", " ") }',
          ],
          { encoding: 'utf-8', timeout: 10_000, windowsHide: true },
        );
        const line = (ps.stdout ?? '').trim();
        if (!line || !line.includes('|')) return null;
        const [ms, exe, ...rest] = line.split('|');
        const startedAtMs = Number(ms);
        if (!Number.isFinite(startedAtMs) || !exe?.trim()) return null;
        const commandLine = rest.join('|').trim();
        return {
          pid,
          startedAtMs,
          executable: exe.trim(),
          ...(commandLine ? { commandLine } : {}),
        };
      } catch {
        return null;
      }
    },
    killTree(pid: number) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { spawnSync } = require('child_process') as typeof import('child_process');
        const r =
          process.platform === 'win32'
            ? spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 15_000, windowsHide: true })
            : spawnSync('kill', ['-TERM', String(pid)], { timeout: 15_000 });
        // 退出码非零可能是"进程已经不在了"（taskkill 128），也可能是权限不足。
        // 这里只回"有没有把命令发出去"，**是否真的死了由调用方复验**（见 reclaimManagedDevice）。
        return !r.error;
      } catch {
        return false;
      }
    },
  };
}

/**
 * `target_kind` 正面分类。
 *
 * **禁反向推断**：不得因"不在已知模拟器集合里"就判 physical——那会把任何识别失败
 * 都变成"真机通过"，正是假绿的来源。判不出一律 unknown。
 */
export function classifyTargetKind(input: {
  serial: string | null;
  /** 本 run 托管启动的模拟器 serial（若有） */
  managedEmulatorSerial?: string | null;
  /** 可关联到既有 Emulator profile/process 的 serial 集合 */
  knownEmulatorSerials?: readonly string[];
  /** 已验证的真机 HDC 属性组合命中（由 profile 侧探测提供；未探测 → undefined） */
  physicalAttested?: boolean;
}): DeviceTargetKind {
  const { serial } = input;
  if (!serial) return 'unknown';
  if (input.managedEmulatorSerial && serial === input.managedEmulatorSerial) return 'emulator';
  if ((input.knownEmulatorSerials ?? []).includes(serial)) return 'emulator';
  if (input.physicalAttested === true) return 'physical';
  return 'unknown';
}

export interface SpawnManagedResult {
  ok: boolean;
  identity?: ManagedProcessIdentity;
  error?: string;
}

/**
 * 以 **detached 独立进程组 + stdio:'ignore'** 启动长驻设备进程。
 *
 * 两个参数都是事故根因的直接反面（07-28 bc-openCard）：
 *   - `detached`：agent 起的模拟器挂在 agent 进程树上，agent 想退也退不掉；
 *   - `stdio:'ignore'`：**这条最关键**——继承的 stdout pipe 被长驻子进程持有后，
 *     父进程的 `close` 事件永远不来。事故里 cursor-agent 的 turn 早已 success，
 *     进程却因这个 pipe 一直不退出，框架空等 84 分钟。托管进程绝不继承任何管道。
 *
 * `unref()` 让 runner 可以先于模拟器退出（模拟器的生命周期由 session 文件而非父子
 * 关系管理——崩溃残留靠下次启动对账回收，见 reclaimManagedDevice）。
 */
/** 刚 spawn 的进程进入 WMI/CIM 有百毫秒级延迟——有界重试，不引入同步阻塞 */
const IDENTITY_PROBE_RETRIES = 10;
const IDENTITY_PROBE_INTERVAL_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export async function spawnManagedDevice(
  executable: string,
  args: readonly string[],
  profile: string,
  probe: ProcessProbe = defaultProcessProbe(),
): Promise<SpawnManagedResult> {
  if (!fs.existsSync(executable)) {
    return { ok: false, error: `可执行文件不存在：${executable}` };
  }
  try {
    const child = spawn(executable, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (typeof child.pid !== 'number' || child.pid <= 0) {
      return { ok: false, error: 'spawn 未返回有效 pid' };
    }
    child.unref();
    // R10（三轮 review）：**启动时间必须取自 OS，不能用 Node 的 Date.now()**。
    // 此前两侧口径不同（Node 观测时刻 vs Windows CIM CreationDate，后者常为秒级截断），
    // 只能靠 ±2s 容差弥合——而容差正是 PID 重用能钻进来的缝。改为 spawn 后立刻用
    // **同一个探针**读一次 OS 创建时间，回收侧即可严格等值比对，容差归零。
    // 刚 spawn 的进程未必立刻出现在 WMI/CIM 里（实测有百毫秒级延迟），故有界重试。
    let observed = probe.identify(child.pid);
    for (let i = 0; !observed && i < IDENTITY_PROBE_RETRIES; i++) {
      await sleep(IDENTITY_PROBE_INTERVAL_MS);
      observed = probe.identify(child.pid);
    }
    if (!observed) {
      // 重试后仍查不到：可能瞬间退出，也可能探针不可用。两种都不能当作"已托管"——
      // 记不下可核对的身份就等于以后无法安全回收。
      try { probe.killTree(child.pid); } catch { /* best-effort */ }
      return { ok: false, error: `无法读取 pid ${child.pid} 的 OS 进程身份，已终止以免留下不可回收的实例` };
    }
    return {
      ok: true,
      identity: { pid: child.pid, startedAtMs: observed.startedAtMs, executable, profile },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * 注册正常退出与 SIGINT/SIGTERM 的清理。
 *
 * **诚实边界**：只覆盖"进程还能执行代码"的退出路径。runner 被硬杀（SIGKILL / 断电 /
 * 蓝屏）时无法自清——那由下次启动或 --resume 依 session 文件对账回收（红线②）。
 * 返回反注册函数，供正常释放后摘除，避免重复回收。
 */
export function registerManagedDeviceCleanup(cleanup: () => void): () => void {
  let done = false;
  const once = (): void => {
    if (done) return;
    done = true;
    try {
      cleanup();
    } catch {
      /* 退出路径不抛 */
    }
  };
  const onSignal = (): void => {
    once();
  };
  process.once('exit', once);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return () => {
    done = true;
    process.removeListener('exit', once);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
}

/**
 * testing 阶段结论封顶：模拟器/未知目标上跑出来的 testing **不得**冒充真机通过。
 * 由 runner 依可信 device session 派生——**不看 agent summary 自报**（自报即可绕过）。
 * ut 不封顶（模拟器上跑 UT 可 PASS）。
 */
export function capsTestingConclusion(phase: string, kind: DeviceTargetKind): boolean {
  return phase === 'testing' && kind !== 'physical';
}

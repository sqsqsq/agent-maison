// ============================================================================
// goal-containment-reconcile.ts — guardian 绑定事件对账（plan c6a9e4d2 t3）
// ----------------------------------------------------------------------------
// 所有权单位**只**是 guardian（Job owner），不枚举/不登记任何后代：
//   · invoke 时 runner 落 `agent_process_bound`（ManagedProcessIdentity 四元组：
//     pid + started_at_ms（OS 启动时刻，严格等值）+ executable（绝对路径）+
//     token（guardian argv 显式携带的 run_id/invoke_id））；
//   · invoke 收尾落 `agent_process_settled`；回收成功后落 `orphan_reclaimed`
//     （两者都闭合对应 bound）；
//   · 未闭合 bound = 该 invoke 没干净收尾（runner/guardian 硬杀遗留）。
//
// 回收判据（自动回收只在「旧 owner 确死 + 新 epoch 已取得」后发生，本模块只做
// 状态分类，不含任何杀进程副作用）：
//   · guardian 不存在（探针 identify=null）→ 依「guardian 唯一持柄」契约，
//     Job 必然已关闭，无需回收；
//   · 身份严格匹配且存活 → 由调用方在确认锁定后终止 guardian（Job 团灭后代），
//     禁止逐个 killProcessTree；
//   · 身份不匹配/不可核实（PID 重用、命令行缺 token、命令行不可读）→ 不杀不
//     阻断，仅警告；
//   · **逐一对账全部未闭合绑定**——只处理最后一个会漏掉更早期的孤儿（真实事故
//     曾出现过多个并发孤儿，旧 agent 会继续操作设备）；
//   · 旧版 run（从未有过 bound 事件且存在**未闭合** invoke）→ fail-closed 人工
//     清理面：所有 invoke 已闭合的旧 run 无野跑风险，可正常 resume；人工清理后
//     以 `--force-resume` 显式确认（可审计），supervisor 不得代其自动确认。
// ============================================================================

import type { ProcessProbe } from './device-session';

export interface GuardianBoundRecord {
  /** 事件侧身份四元组（第一、三、四槽位）。 */
  pid: number;
  started_at_ms: number;
  executable: string;
  token: string;
  phase: string;
  invoke_id: string;
  run_id: string;
  ts: string;
}

/**
 * 扫描 events，返回未闭合的 guardian 绑定（按事件序升序）。
 * 闭合事件：`agent_process_settled` 与 `orphan_reclaimed`（二者都按 run_id|invoke_id
 * 匹配），另有 bound 事件本身字段不全（pid/started_at_ms 非法）者不进入对账——
 * 绝不把身份残缺的条目引为可杀对象。
 */
export function findUnclosedGuardianBounds(
  events: ReadonlyArray<unknown>,
): GuardianBoundRecord[] {
  const open = new Map<string, GuardianBoundRecord>();
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const type = e.type;
    if (type !== 'agent_process_bound' && type !== 'agent_process_settled'
      && type !== 'orphan_reclaimed') {
      continue;
    }
    const invokeId = typeof e.invoke_id === 'string' ? e.invoke_id : '';
    const runId = typeof e.run_id === 'string' ? e.run_id : '';
    const key = `${runId}|${invokeId}`;
    if (type === 'agent_process_bound') {
      const pid = typeof e.pid === 'number' ? e.pid : 0;
      const started = typeof e.started_at_ms === 'number' ? e.started_at_ms : 0;
      if (pid <= 0 || !started) continue; // 绑定字段不全=坏事件，不进入对账（绝不引为可杀对象）
      open.set(key, {
        pid,
        started_at_ms: started,
        executable: typeof e.executable === 'string' ? e.executable : '',
        token: typeof e.token === 'string' ? e.token : '',
        phase: typeof e.phase === 'string' ? e.phase : '',
        invoke_id: invokeId,
        run_id: runId,
        ts: typeof e.ts === 'string' ? e.ts : '',
      });
    } else {
      open.delete(key);
    }
  }
  return [...open.values()];
}

/**
 * 统计**未闭合**的 agent invoke（start 无 end/recovered），与 goal-runner-phase 的
 * findUnclosedAgentInvokeStart 同一配对语义（invoke_id 精确配对优先，旧日志无
 * invoke_id 时按 phase 分窗），但：① 统计全部而非仅最后一条；② `agent_invoke_recovered`
 * 视为闭合（half-recovery 已收回该 invoke）。用于旧版 run 的野跑风险判定。
 */
export function unclosedAgentInvokeCount(events: ReadonlyArray<unknown>): number {
  const open = new Map<string, { phase: string }>();
  let count = 0;
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as { type?: unknown; phase?: unknown; invoke_id?: unknown };
    const type = e.type;
    if (type !== 'agent_invoke_start' && type !== 'agent_invoke_end'
      && type !== 'agent_invoke_recovered' && type !== 'agent_invoke') {
      continue;
    }
    const phase = typeof e.phase === 'string' ? e.phase : '';
    const invokeId = typeof e.invoke_id === 'string' ? e.invoke_id : '';
    if (type === 'agent_invoke_start') {
      if (!phase) continue;
      // 同 invoke_id/phase 的旧 start 先闭合（重试形态），再开新窗
      open.set(invokeId || phase, { phase });
      continue;
    }
    // end / recovered：invoke_id 精确配对优先，phase fallback
    const key = invokeId || phase;
    if (open.delete(key)) {
      count = Math.max(0, count);
      // 配对成功后继续扫描（不需要计数逻辑——未闭合数=open 剩余）
    }
  }
  return open.size;
}

/** 该 run 是否**从未**出现过任何 Job 绑定事件（旧版 run 的判据面之一）。 */
export function hasAnyGuardianBoundEvent(events: ReadonlyArray<unknown>): boolean {
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const type = (raw as { type?: unknown }).type;
    if (type === 'agent_process_bound' || type === 'agent_process_settled') return true;
  }
  return false;
}

/**
 * 单条未闭合绑定的分类（零副作用；identity 判定与 device-session R10 一致：
 * 严格等值、无容差、命令行取不到 = 不可核实——宁可留孤儿也不误杀）。
 */
export type PerBoundReconcile =
  | {
      kind: 'guardian_gone';
      bound: GuardianBoundRecord;
      /** 依唯一持柄契约：guardian 不存在 ⇒ Job 已关闭 ⇒ 无孤儿需回收。 */
      note: string;
    }
  | {
      kind: 'guardian_alive_matching';
      bound: GuardianBoundRecord;
      note: string;
    }
  | {
      kind: 'guardian_identity_unverifiable';
      bound: GuardianBoundRecord;
      reason: string;
    };

export type GuardianReconcileResult =
  | { kind: 'no_unclosed_bounds' }
  | {
      kind: 'legacy_run';
      reason: string;
      unclosedInvokes: number;
    }
  | {
      kind: 'outcomes';
      items: PerBoundReconcile[];
    };

function normalizeExe(p: string): string {
  try {
    // 与 device-session R10 同口径：绝对化 + 大小写归一（路径可能含 %...% / 相对残留）。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pathMod = require('path') as typeof import('path');
    const resolved = pathMod.resolve(p);
    return resolved.toLowerCase();
  } catch {
    return p.toLowerCase();
  }
}

function classifyBound(
  bound: GuardianBoundRecord,
  probe: ProcessProbe,
  exists: PidExistenceProbe,
): PerBoundReconcile {
  // 二轮 review P0：`identify()===null` **不得**当作死亡证明——CIM 查询可因
  // 暂时不可见/查询失败/解析失败返回 null，而进程仍活着。死亡判定走**独立通道**
  // 的 PID existence probe（Get-Process，与 CIM 不同 API 面）：只在其确定性
  // 报告不存在时才判 guardian 已消失（Job 已关闭）。identify null 但进程存在 →
  // 身份不可核实（不杀、不阻断、仅警告），绝不静默放行。
  if (!exists(bound.pid)) {
    return {
      kind: 'guardian_gone',
      bound,
      note:
        `guardian(pid=${bound.pid}) 已不存在（PID existence probe 确定性否定）——` +
        'guardian 是 Job handle 唯一长期持有者，以其消失判定 Job 已关闭，无需回收',
    };
  }
  const actual = probe.identify(bound.pid);
  if (!actual) {
    return {
      kind: 'guardian_identity_unverifiable',
      bound,
      reason:
        `pid ${bound.pid} 进程存在但身份不可得（CIM 暂不可见/查询失败）——` +
        '不得认定死亡，不杀、不阻断，仅警告（下次 resume 再核）',
    };
  }
  // R10：严格等值，不留容差窗口（同一 CIM 时钟源）。
  if (actual.startedAtMs !== bound.started_at_ms) {
    return {
      kind: 'guardian_identity_unverifiable',
      bound,
      reason:
        `pid ${bound.pid} 的 OS 创建时间与登记值不符（${actual.startedAtMs} ≠ ${bound.started_at_ms}，` +
        'PID 重用）——不杀、不阻断，仅警告',
    };
  }
  if (normalizeExe(actual.executable) !== normalizeExe(bound.executable)) {
    return {
      kind: 'guardian_identity_unverifiable',
      bound,
      reason: `pid ${bound.pid} 可执行文件与登记值不符（${actual.executable}）——不杀、不阻断，仅警告`,
    };
  }
  // 三/四轮条款：取不到命令行必须拒绝回收（身份不完整不得回收）。
  if (actual.commandLine === undefined) {
    return {
      kind: 'guardian_identity_unverifiable',
      bound,
      reason: `pid ${bound.pid} 命令行不可读，身份无法核实——拒绝回收`,
    };
  }
  if (!bound.token || !actual.commandLine.includes(bound.token)) {
    return {
      kind: 'guardian_identity_unverifiable',
      bound,
      reason:
        `pid ${bound.pid} 命令行不含登记 token「${bound.token}」` +
        '——guardian argv 身份契约不成立，不杀、不阻断，仅警告',
    };
  }
  return {
    kind: 'guardian_alive_matching',
    bound,
    note: `guardian(pid=${bound.pid}) 身份四元组严格匹配（token 命中），可在新 epoch 下回收`,
  };
}

/**
 * PID 存在性探针（**独立于 CIM 身份读取的通道**——二轮 review P0）：
 * win32 用 `Get-Process -Id`（.NET 进程句柄枚举面，非 WMI/CIM；不存在=确定性
 * 否定，不存在"暂不可见"语义）；非 win32 用 `process.kill(pid, 0)`。
 * 返回 true=进程存在（或无法确定性否定时保守存疑）；false=确定性不存在。
 */
export type PidExistenceProbe = (pid: number) => boolean;

/** 探针执行器（三轮 review：测试接缝——失败/超时语义不依赖改全局 PATH）。 */
export interface PidProbeExecResult {
  error?: Error;
  status: number | null;
  stdout: string;
}
export type PidProbeExecutor = (args: string[]) => PidProbeExecResult;

let injectedPidProbeExecutor: PidProbeExecutor | null = null;
export function __testing_setPidProbeExecutor(fn: PidProbeExecutor | null): void {
  injectedPidProbeExecutor = fn;
}

function runPidProbe(args: string[]): PidProbeExecResult {
  if (injectedPidProbeExecutor) return injectedPidProbeExecutor(args);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const r = spawnSync('powershell.exe', args, {
    encoding: 'utf-8', shell: false, windowsHide: true, timeout: 8_000,
  }) as { error?: Error; status: number | null; stdout: string | Buffer };
  return { error: r.error, status: r.status, stdout: String(r.stdout ?? '') };
}

export function pidExists(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      // 四轮 review P0：显式 PRESENT/ABSENT 契约——PowerShell 的「PID 不存在」与
      // 「脚本执行失败」在 status=1+空输出下完全同形（策略拦截/cmdlet 异常都 exit 1），
      // 不能凭退出码判不存在。改为脚本显式输出结果：
      //   · `[System.Diagnostics.Process]::GetProcessById(pid)` 成功 → `PRESENT:<pid>`
      //   · 仅捕获 ArgumentException（=确定性不存在）→ `ABSENT`
      //   · 其它异常 → 非零退出（Node 侧保守存疑）
      // Node 侧：**只有** status=0 且 stdout 精确 `ABSENT` 才返回 false；空输出、
      // 畸形输出、PRESENT、任意非零退出一律返回 true（无法确定性否定=保守存疑）。
      const r = runPidProbe(['-NoProfile', '-NonInteractive', '-Command',
        `try { $p = [System.Diagnostics.Process]::GetProcessById(${pid}); ` +
        `Write-Output ("PRESENT:" + $p.Id) } ` +
        `catch [System.ArgumentException] { Write-Output "ABSENT" } ` +
        `catch { exit 2 }`]);
      if (r.error || r.status !== 0) return true;
      return r.stdout.trim() !== 'ABSENT';
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  } catch {
    // 探测通道自身抛异常：保守存疑（不把查询失败误判成死亡）。
    return true;
  }
}

/**
 * 对账分类（纯函数 + 探针注入，**零副作用**——调用方据结果决定是否回收）。
 * **逐一对账全部未闭合绑定**：返回 outcomes 列表，调用方必须逐项处置——
 * 任何 `guardian_alive_matching` 杀不死都须阻止续跑；`guardian_identity_unverifiable`
 * 不杀不阻断仅警告。
 */
export function reconcileGuardianOwnership(
  events: ReadonlyArray<unknown>,
  probe: ProcessProbe,
  existsProbe: PidExistenceProbe = pidExists,
): GuardianReconcileResult {
  const unclosed = findUnclosedGuardianBounds(events);
  if (unclosed.length === 0) {
    // 旧版 run 判定：从未有过任何 Job 绑定事件 **且** 存在未闭合 invoke
    // （invoke 全部闭合的旧 run 无野跑风险，可正常 resume）；有绑定事件但
    // 条目不完整的坏事件不在此列（见 findUnclosedGuardianBounds 注释）。
    if (!hasAnyGuardianBoundEvent(events)) {
      const unclosedInvokes = unclosedAgentInvokeCount(events);
      if (unclosedInvokes > 0) {
        return {
          kind: 'legacy_run',
          unclosedInvokes,
          reason:
            `存在 ${unclosedInvokes} 个未闭合 agent invoke 且 events 中从未出现 ` +
            'agent_process_bound（Job 绑定）——旧版 run 的遗留进程无 guardian 身份契约可依。' +
            '处置：人工核查/清理残留 CLI 进程后以 --force-resume 显式确认（可审计）；' +
            'supervisor 不代其自动确认。',
        };
      }
    }
    return { kind: 'no_unclosed_bounds' };
  }
  const items: PerBoundReconcile[] = [];
  for (const bound of unclosed) {
    // 字段完整性守卫（findUnclosedGuardianBounds 已过滤，此处兜底）
    if (!bound.pid || !bound.started_at_ms || !bound.executable) {
      // 身份残缺的绑定不得引为可杀对象；也不应静默放行——归为不可核实警告。
      items.push({
        kind: 'guardian_identity_unverifiable',
        bound,
        reason: `绑定事件字段不完整（pid=${bound.pid}）——不猜测、不回收`,
      });
      continue;
    }
    items.push(classifyBound(bound, probe, existsProbe));
  }
  return { kind: 'outcomes', items };
}

/**
 * 终止 guardian **单进程**（taskkill 不带 /T）：不逐个 killProcessTree——匹配身份后
 * 终止 guardian 即关闭 Job 唯一句柄，KILL_ON_JOB_CLOSE 团灭全部后代。返回是否发出
 * 了终止指令（成功与否须以探针复核消失为准）。
 */
export function terminateGuardianProcessOnly(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const r = spawnSync('taskkill.exe', ['/PID', String(pid), '/F'], {
      shell: false, windowsHide: true, timeout: 15_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * 杀后确认：进程确实消失（不凭 taskkill 退出码——R10 同款条款；二轮 review P0：
 * 死亡判定只认**独立 PID existence 通道**，CIM identify 的 null 不得当作死亡证明）。
 */
export function awaitGuardianGone(
  pid: number,
  exists: PidExistenceProbe = pidExists,
  attempts = 10,
  delayMs = 300,
): boolean {
  // 同步等待（探测均为同步 spawnSync）：Atomics.wait 是 Node 的同步 sleep 通道。
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < attempts; i++) {
    try {
      if (!exists(pid)) return true;
    } catch {
      /* retry */
    }
    Atomics.wait(sleepBuf, 0, 0, delayMs);
  }
  return false;
}

/** 有界身份探测（CIM 存在可见延迟——首次可能暂不可见；≤ maxAttempts 次轮询）。 */
export function identifyWithRetry(
  pid: number,
  probe: ProcessProbe,
  maxAttempts = 5,
  delayMs = 300,
): ReturnType<ProcessProbe['identify']> {
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const hit = probe.identify(pid);
      if (hit !== null) return hit;
    } catch {
      /* retry */
    }
    if (i + 1 < maxAttempts) Atomics.wait(sleepBuf, 0, 0, delayMs);
  }
  return null;
}
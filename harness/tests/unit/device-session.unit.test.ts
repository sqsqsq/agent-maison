// ============================================================================
// device-session.unit.test.ts — 托管设备会话的所有权/回收/分类契约
//                               （openspec device-readiness-and-completion t2）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  capsTestingConclusion,
  classifyTargetKind,
  defaultProcessProbe,
  readDeviceSession,
  reclaimManagedDevice,
  registerManagedDeviceCleanup,
  spawnManagedDevice,
  writeDeviceSession,
  type DeviceSession,
  type ManagedProcessIdentity,
  type ProcessProbe,
} from '../../scripts/utils/device-session';
import type { UnitCaseResult } from '../run-unit';

const tmpRoots: string[] = [];

async function run(
  results: UnitCaseResult[],
  name: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-session-'));
  tmpRoots.push(root);
  return root;
}

const MANAGED: ManagedProcessIdentity = {
  pid: 4242,
  startedAtMs: 1_700_000_000_000,
  executable: 'D:/Program Files/Huawei/DevEco Studio/tools/emulator/Emulator.exe',
  profile: 'Pura 90',
};

function managedSession(overrides: Partial<DeviceSession> = {}): DeviceSession {
  return {
    schema_version: '1.0',
    serial: '127.0.0.1:5555',
    target_kind: 'emulator',
    started_by_run: '20260728T031459Z-e19c6b',
    managed: MANAGED,
    status: 'ready',
    updated_at: '2026-07-28T04:41:21.000Z',
    ...overrides,
  };
}

/**
 * 可编程进程探针：不起真进程即可覆盖 PID 重用 / 已退出 / 异 exe / 命令行缺失四种分支。
 *
 * `killTree` 成功后**让进程真的从探针里消失**——回收侧要复验"进程确实没了"，
 * 桩若一直返回存活，就测不出这条复验（也就等于没测）。
 */
function probeOf(
  actual: { pid: number; startedAtMs: number; executable: string; commandLine?: string } | null,
  killed: number[] = [],
  killResult = true,
): ProcessProbe {
  // 未显式给命令行时，补一条含 MANAGED.profile 的——回收要求命令行可核实
  let alive =
    actual && actual.commandLine === undefined
      ? { ...actual, commandLine: `"${actual.executable}" -start ${MANAGED.profile}` }
      : actual;
  return {
    identify: (pid: number) => (alive && alive.pid === pid ? alive : null),
    killTree: (pid: number) => {
      killed.push(pid);
      if (killResult) alive = null;
      return killResult;
    },
  };
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  try {

  await run(results, 'session 读写往返：字段保真；损坏/缺失 → null（不猜）', () => {
    const root = tmpRoot();
    const written = writeDeviceSession(root, 'reports', {
      serial: '127.0.0.1:5555',
      target_kind: 'emulator',
      started_by_run: 'run-A',
      managed: MANAGED,
      status: 'ready',
    });
    assertEq(written.schema_version, '1.0', 'schema_version');
    const back = readDeviceSession(root, 'reports');
    assert(back !== null, '应可读回');
    assertEq(back!.serial, '127.0.0.1:5555', 'serial 保真');
    assertEq(back!.managed?.profile, 'Pura 90', 'profile 保真');
    assertEq(back!.started_by_run, 'run-A', 'started_by_run 保真');

    fs.writeFileSync(path.join(root, 'reports', 'device-session.json'), '{ not json', 'utf-8');
    assertEq(readDeviceSession(root, 'reports'), null, '损坏 → null');
    assertEq(readDeviceSession(tmpRoot(), 'reports'), null, '缺失 → null');
  });

  await run(results, '红线①：用户自有实例绝不回收（started_by_run 为空）', () => {
    const killed: number[] = [];
    const out = reclaimManagedDevice(
      managedSession({ started_by_run: null, managed: undefined }),
      probeOf({ pid: MANAGED.pid, startedAtMs: MANAGED.startedAtMs, executable: MANAGED.executable }, killed),
    );
    assertEq(out.action, 'none', JSON.stringify(out));
    assertEq(killed.length, 0, '不得对用户实例发出任何终止');
  });

  await run(results, '红线①：PID 重用不误杀（启动时间不符 → refused）', () => {
    const killed: number[] = [];
    const out = reclaimManagedDevice(
      managedSession(),
      probeOf(
        { pid: MANAGED.pid, startedAtMs: MANAGED.startedAtMs + 999_999, executable: MANAGED.executable },
        killed,
      ),
    );
    assertEq(out.action, 'refused', JSON.stringify(out));
    assert(out.action === 'refused' && out.reason.includes('PID 重用'), JSON.stringify(out));
    assertEq(killed.length, 0, 'PID 重用时不得终止');
  });

  await run(results, '红线①：可执行文件不符 → refused（同 pid 同启动时间也不认）', () => {
    const killed: number[] = [];
    const out = reclaimManagedDevice(
      managedSession(),
      probeOf(
        { pid: MANAGED.pid, startedAtMs: MANAGED.startedAtMs, executable: 'C:/Windows/System32/notepad.exe' },
        killed,
      ),
    );
    assertEq(out.action, 'refused', JSON.stringify(out));
    assertEq(killed.length, 0, 'exe 不符时不得终止');
  });

  await run(results, '本 run 托管且四元组一致 → 回收；进程已退出 → none', () => {
    const killed: number[] = [];
    const ok = reclaimManagedDevice(
      managedSession(),
      probeOf({ pid: MANAGED.pid, startedAtMs: MANAGED.startedAtMs, executable: MANAGED.executable }, killed),
    );
    assertEq(ok.action, 'reclaimed', JSON.stringify(ok));
    assertEq(killed[0], MANAGED.pid, '应终止托管 pid');

    const gone = reclaimManagedDevice(managedSession(), probeOf(null));
    assertEq(gone.action, 'none', JSON.stringify(gone));
  });

  await run(results, '红线②：崩溃残留可由后续 run 依 session 对账回收（跨进程语义）', () => {
    const root = tmpRoot();
    // 前一个 run 崩溃：session 停在 ready，进程仍活着
    writeDeviceSession(root, 'reports', {
      serial: '127.0.0.1:5555',
      target_kind: 'emulator',
      started_by_run: 'crashed-run',
      managed: MANAGED,
      status: 'ready',
    });
    const killed: number[] = [];
    const out = reclaimManagedDevice(
      readDeviceSession(root, 'reports'),
      probeOf({ pid: MANAGED.pid, startedAtMs: MANAGED.startedAtMs, executable: MANAGED.executable }, killed),
    );
    assertEq(out.action, 'reclaimed', '后续 run 应能对账回收崩溃残留');
    assertEq(killed[0], MANAGED.pid, '回收目标须是崩溃 run 记录的 pid');
  });

  await run(results, '红线③：target_kind 正面分类——判不出一律 unknown，禁反向推断', () => {
    // 托管启动的模拟器 → emulator
    assertEq(
      classifyTargetKind({ serial: 'emu-1', managedEmulatorSerial: 'emu-1' }),
      'emulator',
      '本 run 托管 → emulator',
    );
    // 可关联既有 Emulator profile → emulator
    assertEq(
      classifyTargetKind({ serial: '127.0.0.1:5555', knownEmulatorSerials: ['127.0.0.1:5555'] }),
      'emulator',
      '既有模拟器 → emulator',
    );
    // 有正面真机证据 → physical
    assertEq(
      classifyTargetKind({ serial: '3UJ0225321000395', physicalAttested: true }),
      'physical',
      '正面证据 → physical',
    );
    // **关键反向断言**：不是已知模拟器，但也无真机正面证据 → unknown（不得推断为真机）
    assertEq(
      classifyTargetKind({ serial: '3UJ0225321000395', knownEmulatorSerials: [] }),
      'unknown',
      '无正面证据不得推断为真机',
    );
    assertEq(
      classifyTargetKind({ serial: '3UJ0225321000395', physicalAttested: false }),
      'unknown',
      '真机探测失败 → unknown 而非 physical',
    );
    assertEq(classifyTargetKind({ serial: null }), 'unknown', '无 serial → unknown');
  });

  await run(results, 'spawn 契约：detached + stdio ignore（不继承管道=不钉住父进程）；缺文件不臆造', async () => {
    const missing = await spawnManagedDevice(path.join(tmpRoot(), 'no-such.exe'), [], 'X');
    assertEq(missing.ok, false, '不存在的可执行文件须失败');
    assert(!missing.identity, '失败时不得臆造 identity');

    // 真起一个进程验证身份捕获与 unref 语义（node 自身必然可执行）。
    // 存活时间须覆盖 OS 进程身份探测（CIM 有百毫秒级延迟）——测完显式回收。
    const probe = defaultProcessProbe();
    const spawned = await spawnManagedDevice(
      process.execPath,
      ['-e', 'setTimeout(()=>{},30000)'],
      'probe',
      probe,
    );
    try {
      assertEq(spawned.ok, true, `应成功启动：${spawned.error ?? ''}`);
      assert(typeof spawned.identity?.pid === 'number' && spawned.identity!.pid > 0, 'pid 须有效');
      assertEq(spawned.identity?.profile, 'probe', 'profile 保真');
      assertEq(spawned.identity?.executable, process.execPath, 'executable 保真');
      // R10（三轮）：startedAtMs 必须来自 OS，不是 Node 的 Date.now()——
      // 故它必须与探针**再读一次**的值严格相等（这正是回收侧的比对方式）。
      if (spawned.ok && spawned.identity) {
        const reread = probe.identify(spawned.identity.pid);
        assertEq(
          reread?.startedAtMs,
          spawned.identity.startedAtMs,
          '登记的启动时间须与 OS 再次读取严格一致（否则回收侧只能靠容差，PID 重用可乘虚而入）',
        );
      }
    } finally {
      if (spawned.ok && spawned.identity) probe.killTree(spawned.identity.pid);
    }
    // 源码级契约断言：spawn 选项必须是 detached + stdio ignore（这两项是事故根因的反面）
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-session.ts'),
      'utf-8',
    );
    assert(/detached:\s*true/.test(src), 'spawnManagedDevice 必须 detached');
    assert(/stdio:\s*'ignore'/.test(src), "spawnManagedDevice 必须 stdio:'ignore'（继承管道会钉住父进程）");
    assert(/child\.unref\(\)/.test(src), 'spawnManagedDevice 必须 unref');
  });

  await run(results, '信号清理：只清一次；反注册后不再触发（正常释放不重复回收）', () => {
    let calls = 0;
    const off = registerManagedDeviceCleanup(() => { calls += 1; });
    process.emit('SIGINT' as never);
    assertEq(calls, 1, 'SIGINT 应触发一次清理');
    process.emit('SIGINT' as never);
    assertEq(calls, 1, '重复信号不得重复清理');
    off();

    let later = 0;
    const off2 = registerManagedDeviceCleanup(() => { later += 1; });
    off2();
    process.emit('SIGTERM' as never);
    assertEq(later, 0, '反注册后不得再触发');
  });

  await run(results, '二轮 P1：回收须核对命令行 profile（同机多实例时 exe 相同不足以区分）', () => {
    const killed: number[] = [];
    // 同一个 Emulator.exe，但命令行是**另一个 AVD** → 拒绝回收
    const otherInstance = reclaimManagedDevice(
      managedSession(),
      {
        identify: () => ({
          pid: MANAGED.pid,
          startedAtMs: MANAGED.startedAtMs,
          executable: MANAGED.executable,
          commandLine: `"${MANAGED.executable}" -start "Some Other AVD"`,
        }),
        killTree: (pid: number) => { killed.push(pid); return true; },
      },
    );
    assertEq(otherInstance.action, 'refused', JSON.stringify(otherInstance));
    assertEq(killed.length, 0, '不得关掉别的模拟器实例');

    // 命令行含本 session 的 profile → 正常回收
    let live: { pid: number; startedAtMs: number; executable: string; commandLine: string } | null = {
      pid: MANAGED.pid,
      startedAtMs: MANAGED.startedAtMs,
      executable: MANAGED.executable,
      commandLine: `"${MANAGED.executable}" -start "${MANAGED.profile}"`,
    };
    const mine = reclaimManagedDevice(managedSession(), {
      identify: () => live,
      killTree: (pid: number) => { killed.push(pid); live = null; return true; },
    });
    assertEq(mine.action, 'reclaimed', JSON.stringify(mine));
  });

  await run(results, '三轮 P1：**取不到命令行也须拒绝**（此前"能取到才校验"= fail-open）', () => {
    const killed: number[] = [];
    const out = reclaimManagedDevice(managedSession(), {
      // 探针降级：只给得出 pid/时间/exe，命令行读不到
      identify: () => ({
        pid: MANAGED.pid,
        startedAtMs: MANAGED.startedAtMs,
        executable: MANAGED.executable,
      }),
      killTree: (pid: number) => { killed.push(pid); return true; },
    });
    assertEq(out.action, 'refused', '身份不完整必须拒绝回收');
    assert(out.action === 'refused' && /命令行/.test(out.reason), JSON.stringify(out));
    assertEq(killed.length, 0, '**信息不全时绝不发终止**——宁可留孤儿也不误杀用户实例');
  });

  await run(results, '三轮 P1：启动时间**严格等值**（同源 OS 时钟，不留容差窗口）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'device-session.ts'),
      'utf-8',
    );
    const executable = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*)/.test(l))
      .join('\n');
    assert(
      !/Math\.abs\(actual\.startedAtMs/.test(executable),
      '不得再用容差窗口比对启动时间——容差正是 PID 重用能钻的缝',
    );
    assert(
      /actual\.startedAtMs !== want\.startedAtMs/.test(executable),
      '须严格等值比对（两侧同为 OS CreationDate）',
    );
    // 哪怕只差 1ms 也必须拒绝
    const killed: number[] = [];
    const out = reclaimManagedDevice(
      managedSession(),
      probeOf(
        { pid: MANAGED.pid, startedAtMs: MANAGED.startedAtMs + 1, executable: MANAGED.executable },
        killed,
      ),
    );
    assertEq(out.action, 'refused', '1ms 偏差也须拒绝');
    assertEq(killed.length, 0, '不得终止');
  });

  await run(results, '三轮 P1：**以进程确实消失为准**——发了终止但还活着 → 不算回收', () => {
    const killed: number[] = [];
    const out = reclaimManagedDevice(managedSession(), {
      // killTree 返回 true（命令发出去了），但进程顽固存活
      identify: () => ({
        pid: MANAGED.pid,
        startedAtMs: MANAGED.startedAtMs,
        executable: MANAGED.executable,
        commandLine: `"${MANAGED.executable}" -start ${MANAGED.profile}`,
      }),
      killTree: (pid: number) => { killed.push(pid); return true; },
    });
    assertEq(out.action, 'refused', '未确认消失不得记为 reclaimed');
    assert(out.action === 'refused' && /仍存在/.test(out.reason), JSON.stringify(out));
    assertEq(killed[0], MANAGED.pid, '终止仍应被尝试过');
  });

  await run(results, 'testing 结论封顶：emulator/unknown 封顶，physical 放行，ut 不封顶', () => {
    assertEq(capsTestingConclusion('testing', 'emulator'), true, 'testing+emulator 须封顶');
    assertEq(capsTestingConclusion('testing', 'unknown'), true, 'testing+unknown 须封顶（同模拟器待遇）');
    assertEq(capsTestingConclusion('testing', 'physical'), false, 'testing+physical 不封顶');
    assertEq(capsTestingConclusion('ut', 'emulator'), false, 'ut 在模拟器上可 PASS');
    assertEq(capsTestingConclusion('ut', 'unknown'), false, 'ut 不封顶');
  });

  return results;
  } finally {
    for (const r of tmpRoots) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}

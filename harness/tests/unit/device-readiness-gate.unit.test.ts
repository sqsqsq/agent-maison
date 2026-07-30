// ============================================================================
// device-readiness-gate.unit.test.ts — 设备就绪门三态/降级/死锁回归
//                                      （openspec device-readiness-and-completion t3）
// ============================================================================

import {
  deviceEnvFor,
  ensureDeviceReady,
  runDeviceReadinessGate,
  type DeviceReadinessDeps,
  type DeviceReadinessResult,
  type EmulatorFallback,
} from '../../scripts/utils/device-readiness-gate';
import { phaseRequiresDevice, chainRequiresDevice } from '../../scripts/utils/phase-device-requirement';
import type { HarnessResolvedProfile } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

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

/** 可编程设备台：记录所有副作用，用于断言"零密码输入"这类否定命题 */
function bench(overrides: Partial<DeviceReadinessDeps> = {}) {
  const calls = { wake: [] as string[], unlock: [] as string[], launch: 0 };
  const deps: DeviceReadinessDeps = {
    listTargets: () => ['dev-1'],
    isLocked: () => false,
    wake: (s: string) => { calls.wake.push(s); },
    knownEmulatorSerials: () => [],
    ...overrides,
  };
  return { deps, calls };
}

async function ready(
  deps: DeviceReadinessDeps,
  emulatorFallback: EmulatorFallback = 'disabled',
  configuredSerial?: string | null,
  emulatorBootBudgetMs?: number,
): Promise<DeviceReadinessResult> {
  return ensureDeviceReady({ configuredSerial, emulatorFallback, emulatorBootBudgetMs, deps });
}

function profileOf(deviceCaps: string[], skipped: string[] = []): HarnessResolvedProfile {
  return {
    name: 'test-profile',
    profileDir: '/tmp/profile',
    yaml: {
      name: 'test-profile',
      device_capabilities: deviceCaps,
      capabilities: Object.fromEntries(
        skipped.map(k => [k, { severity: 'SKIP' }]),
      ) as HarnessResolvedProfile['capabilities'],
    } as HarnessResolvedProfile['yaml'],
    phasesDisabled: new Set(),
    capabilities: Object.fromEntries(
      skipped.map(k => [k, { severity: 'SKIP' }]),
    ) as HarnessResolvedProfile['capabilities'],
    personalPrerequisites: {},
  };
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];

  await run(results, '执行范围由 requires_device 派生，不硬编码 phase（host-only UT profile 不被要求连设备）', async () => {
    const hmosLike = profileOf(['ut.run', 'device_test.run', 'device_test.install']);
    assertEq(phaseRequiresDevice('ut', hmosLike), true, 'ut.run 需设备 → ut 需设备');
    assertEq(phaseRequiresDevice('testing', hmosLike), true, 'device_test.* → testing 需设备');
    assertEq(phaseRequiresDevice('spec', hmosLike), false, 'spec 不需设备');
    assertEq(phaseRequiresDevice('plan', hmosLike), false, 'plan 不需设备');
    assertEq(phaseRequiresDevice('coding', hmosLike), false, 'coding 不需设备');

    // host-only UT profile：ut 不连设备
    const hostOnly = profileOf(['device_test.run']);
    assertEq(phaseRequiresDevice('ut', hostOnly), false, 'host-only UT 不得被要求连设备');
    assertEq(phaseRequiresDevice('testing', hostOnly), true, 'testing 仍需设备');

    // 未声明 → 全 false（generic profile 行为与本改动前一致）
    const generic = profileOf([]);
    assertEq(phaseRequiresDevice('ut', generic), false, '未声明 → 不需设备');
    assertEq(chainRequiresDevice(['spec', 'ut', 'testing'], generic), false, '链路整体不需设备');
    assertEq(chainRequiresDevice(['spec', 'ut'], hmosLike), true, '链路含需设备 phase');

    // capability 被 skip → 不算需要设备
    const skipped = profileOf(['ut.run'], ['ut.run']);
    assertEq(phaseRequiresDevice('ut', skipped), false, 'skip 的 capability 不产生设备需求');
  });

  await run(results, 'READY：单设备未锁屏 → 放行，且必定先 wake（息屏时 UI tree 不完整）', async () => {
    const { deps, calls } = bench();
    const out = await ready(deps);
    assertEq(out.state, 'READY', JSON.stringify(out));
    assert(out.state === 'READY' && out.target.serial === 'dev-1', JSON.stringify(out));
    assertEq(calls.wake[0], 'dev-1', 'wake 必须被调用');
  });

  await run(results, 'AMBIGUOUS：多设备未配置 target → HALT 求人（绝不赌"第一个"）', async () => {
    const { deps } = bench({ listTargets: () => ['dev-1', 'dev-2'] });
    const out = await ready(deps);
    assertEq(out.state, 'AMBIGUOUS', JSON.stringify(out));
    assert(out.state === 'AMBIGUOUS' && out.reason.includes('多个设备'), out.state === 'AMBIGUOUS' ? out.reason : '');
  });

  await run(results, 'BLOCKED：锁屏且未授权 → 不放行，且**零密码输入**（结构性阻断的核心断言）', async () => {
    const { deps, calls } = bench({ isLocked: () => true });
    const out = await ready(deps, 'disabled');
    assertEq(out.state, 'BLOCKED', JSON.stringify(out));
    assertEq(calls.unlock.length, 0, '未授权时不得有任何解锁/密码输入尝试');
    assert(
      out.state === 'BLOCKED' && out.notes.some(n => n.includes('不尝试任何密码输入')),
      JSON.stringify(out),
    );
  });

  await run(results, '死锁回归：启动即锁屏 + 已授权凭据 → gate 内解锁并复验 → READY', async () => {
    // v4 曾把解锁全放进"运行期 wrapper"，导致：启动即锁屏 → BLOCKED → agent 不启动
    // → wrapper 永无机会执行。gate 必须能调用凭据能力。
    let lockState = true;
    const { deps, calls } = bench({
      isLocked: () => lockState,
      unlockWithCredential: (s: string) => {
        calls.unlock.push(s);
        lockState = false; // 解锁成功
        return { ok: true, note: '已用登记凭据解锁一次' };
      },
    });
    const out = await ready(deps, 'disabled');
    assertEq(out.state, 'READY', `启动即锁屏时应能解锁放行：${JSON.stringify(out)}`);
    assertEq(calls.unlock.length, 1, '只允许尝试一次');
  });

  await run(results, '解锁"成功"但复验仍锁 → 不得凭返回值宣称成功；走降级/BLOCKED', async () => {
    const { deps } = bench({
      isLocked: () => true, // 复验始终锁着
      unlockWithCredential: () => ({ ok: true, note: '命令退出码 0' }),
    });
    const out = await ready(deps, 'disabled');
    assertEq(out.state, 'BLOCKED', `退出码 0 不等于已解锁：${JSON.stringify(out)}`);
  });

  await run(results, '锁屏状态无法判定 → BLOCKED（不猜）', async () => {
    const { deps } = bench({ isLocked: () => undefined });
    const out = await ready(deps, 'managed');
    assertEq(out.state, 'BLOCKED', JSON.stringify(out));
  });

  await run(results, '降级 existing：复用既有模拟器且标记不回收；无可用则 BLOCKED', async () => {
    const { deps } = bench({
      listTargets: () => ['emu-9'],
      isLocked: () => true,
      knownEmulatorSerials: () => ['emu-9'],
    });
    const out = await ready(deps, 'existing');
    assertEq(out.state, 'READY', JSON.stringify(out));
    assert(out.state === 'READY' && out.target.targetKind === 'emulator', JSON.stringify(out));
    assert(
      out.state === 'READY' && out.notes.some(n => n.includes('不回收')),
      '复用既有实例必须标注不回收',
    );

    const none = bench({ listTargets: () => ['dev-1'], isLocked: () => true, knownEmulatorSerials: () => [] });
    assertEq((await ready(none.deps, 'existing')).state, 'BLOCKED', '无既有模拟器 → BLOCKED');
  });

  await run(results, '降级 managed：托管启动 + 有界 boot 超时（gate 自己不得变成新的无限等待）', async () => {
    const { deps, calls } = bench({
      listTargets: () => [],
      launchManagedEmulator: async () => {
        calls.launch += 1;
        return {
          ok: true,
          serial: 'emu-managed',
          identity: { pid: 1, startedAtMs: 2, executable: 'E.exe', profile: 'Pura 90' },
          note: 'started',
        };
      },
      awaitEmulatorReady: async () => true,
    });
    const out = await ready(deps, 'managed', null, 5_000);
    assertEq(out.state, 'READY', JSON.stringify(out));
    assert(out.state === 'READY' && out.managed?.pid === 1, '须回传托管进程身份供回收');
    assertEq(calls.launch, 1, '应托管启动一次');

    // boot 超时 → BLOCKED（有界）
    const slow = bench({
      listTargets: () => [],
      launchManagedEmulator: async () => ({
        ok: true, serial: 'emu-slow',
        identity: { pid: 2, startedAtMs: 3, executable: 'E.exe', profile: 'P' },
        note: 'started',
      }),
      awaitEmulatorReady: async () => false,
    });
    const timedOut = await ready(slow.deps, 'managed', null, 1_000);
    assertEq(timedOut.state, 'BLOCKED', '未就绪须 BLOCKED 而非无限等待');
    assert(
      timedOut.state === 'BLOCKED' && timedOut.reason.includes('1000ms'),
      `原因须含预算：${JSON.stringify(timedOut)}`,
    );
  });

  await run(results, '降级 disabled：无设备直接 BLOCKED，绝不擅自启动模拟器', async () => {
    const { deps, calls } = bench({
      listTargets: () => [],
      launchManagedEmulator: async () => { calls.launch += 1; return { ok: true, serial: 'x', note: 'n' }; },
    });
    const out = await ready(deps, 'disabled');
    assertEq(out.state, 'BLOCKED', JSON.stringify(out));
    assertEq(calls.launch, 0, '未启用降级时不得启动模拟器');
  });

  await run(results, '配置的 target 不在线 → 按策略降级，不静默改用别的设备', async () => {
    const { deps } = bench({ listTargets: () => ['other-dev'] });
    const out = await ready(deps, 'disabled', 'my-phone');
    assertEq(out.state, 'BLOCKED', '配置目标不在线时不得静默改用 other-dev');
    assert(
      out.state === 'BLOCKED' && out.reason.includes('my-phone'),
      JSON.stringify(out),
    );
  });

  await run(results, 'target_kind：无正面证据 → unknown（禁反向推断为真机）', async () => {
    const noAttest = bench({ listTargets: () => ['maybe-phone'] });
    const a = await ready(noAttest.deps);
    assert(a.state === 'READY' && a.target.targetKind === 'unknown', JSON.stringify(a));

    const attested = bench({ listTargets: () => ['real-phone'], attestPhysical: () => true });
    const b = await ready(attested.deps);
    assert(b.state === 'READY' && b.target.targetKind === 'physical', JSON.stringify(b));
  });

  await run(results, 'R16：设备门链路**不得**同步阻塞事件循环（禁 Atomics.wait）', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMod = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pathMod = require('path') as typeof import('path');
    for (const f of ['device-readiness-deps.ts', 'device-readiness-gate.ts']) {
      const src = fsMod.readFileSync(
        pathMod.join(__dirname, '..', '..', 'scripts', 'utils', f),
        'utf-8',
      );
      // 只查**可执行代码**——注释里说明"此前用 Atomics.wait"是有价值的历史记录
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*)/.test(l))
        .join('\n');
      assert(
        !/Atomics\.wait/.test(code),
        `${f} 不得用 Atomics.wait 同步阻塞——模拟器 boot 最长 180s，期间 heartbeat/信号/timer 全停摆`,
      );
    }
    const gateSrc = fsMod.readFileSync(
      pathMod.join(__dirname, '..', '..', 'scripts', 'utils', 'device-readiness-gate.ts'),
      'utf-8',
    );
    assert(/export async function ensureDeviceReady/.test(gateSrc), 'ensureDeviceReady 须为 async');
    assert(/export async function runDeviceReadinessGate/.test(gateSrc), 'gate 须为 async');

    // 行为验证：门在等待期间**不阻塞**其它 timer
    let ticked = false;
    const timer = setTimeout(() => { ticked = true; }, 5);
    const { deps } = bench({
      listTargets: () => [],
      launchManagedEmulator: async () => {
        await new Promise(r => setTimeout(r, 30));
        return { ok: true, serial: 'emu-x', note: 'slow boot' };
      },
      awaitEmulatorReady: async () => true,
    });
    await ready(deps, 'managed', null, 5_000);
    clearTimeout(timer);
    assert(ticked, '门等待期间其它 timer 必须照常触发（未被同步阻塞）');
  });

  await run(results, 'env 注入：返回子进程 env 片段，不触碰全局 process.env', async () => {
    const before = { ...process.env };
    const env = deviceEnvFor({ serial: 'dev-1', targetKind: 'emulator' }, 'sess-1');
    assertEq(env.HARNESS_HDC_TARGET, 'dev-1', 'serial 注入');
    assertEq(env.MAISON_DEVICE_TARGET_KIND, 'emulator', 'kind 注入');
    assertEq(env.MAISON_DEVICE_SESSION_ID, 'sess-1', 'session 注入');
    assertEq(process.env.HARNESS_HDC_TARGET, before.HARNESS_HDC_TARGET, '不得写全局 env');
    assertEq(process.env.MAISON_DEVICE_TARGET_KIND, undefined, '不得写全局 env');
    // P1（三轮）：冻结标记须**无条件**注入——否则 manual 模式的 attempt 在下游
    // 与"根本没跑 gate"无法区分，运行期会回落读实时配置（中途改配置即可提权）
    assertEq(env.MAISON_DEVICE_ATTEMPT_FROZEN, '1', '未授权时也须标记 attempt 已冻结');
    assertEq(env.MAISON_DEVICE_CREDENTIAL_REF, undefined, '未授权时不得凭空造出 ref');
    const authed = deviceEnvFor({ serial: 'dev-1', targetKind: 'physical' }, 'sess-2', 'maison/device/dev-1/v1');
    assertEq(authed.MAISON_DEVICE_ATTEMPT_FROZEN, '1', '已授权同样带冻结标记');
    assertEq(authed.MAISON_DEVICE_CREDENTIAL_REF, 'maison/device/dev-1/v1', 'ref 冻结注入');
  });

  await run(results, 'P1：本 run 已托管的模拟器**跨 phase 复用**，不新建第二个实例', async () => {
    let launches = 0;
    const identity = {
      pid: 4242,
      startedAtMs: 1_700_000_000_000,
      executable: 'C:/DevEco/tools/emulator/Emulator.exe',
      profile: 'Pura 90',
    };
    // 真机一直锁着 → 每个设备 phase 都会走降级
    const deps: DeviceReadinessDeps = {
      listTargets: () => ['phone-1', '127.0.0.1:5555'],
      isLocked: (s: string) => s === 'phone-1',
      wake: () => {},
      knownEmulatorSerials: () => [],
      launchManagedEmulator: async () => {
        launches += 1;
        return { ok: true, serial: '127.0.0.1:5556', identity, note: 'launched' };
      },
      awaitEmulatorReady: async () => true,
    };
    const out = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      existingManaged: { serial: '127.0.0.1:5555', identity },
      deps,
    });
    assertEq(out.state, 'READY', JSON.stringify(out));
    assertEq(launches, 0, '**不得再起一个模拟器**——本 run 已有可用的托管实例');
    if (out.state === 'READY') {
      assertEq(out.target.serial, '127.0.0.1:5555', '应复用既有托管实例');
      assertEq(out.target.targetKind, 'emulator', '分类仍是 emulator');
      assertEq(out.managed?.pid, identity.pid, '**managed 身份须保留**，否则旧进程回收不掉');
    }
  });

  await run(results, 'P1：已托管实例不可用 → **先确认回收再新建**（复用不是无条件黏住）', async () => {
    let launches = 0;
    const reclaimedPids: number[] = [];
    const stale = {
      pid: 1111, startedAtMs: 1, executable: 'C:/DevEco/tools/emulator/Emulator.exe', profile: 'P',
    };
    const fresh = {
      pid: 2222, startedAtMs: 2, executable: 'C:/DevEco/tools/emulator/Emulator.exe', profile: 'P',
    };
    const deps: DeviceReadinessDeps = {
      // 旧的托管 serial 已不在线
      listTargets: () => ['phone-1'],
      isLocked: () => true,
      wake: () => {},
      knownEmulatorSerials: () => [],
      reclaimManaged: identity => { reclaimedPids.push(identity.pid); return 'reclaimed'; },
      launchManagedEmulator: async () => {
        launches += 1;
        return { ok: true, serial: '127.0.0.1:5560', identity: fresh, note: 'launched' };
      },
      awaitEmulatorReady: async () => true,
    };
    const out = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      existingManaged: { serial: '127.0.0.1:5599', identity: stale },
      deps,
    });
    assertEq(reclaimedPids[0], stale.pid, '**必须先回收旧实例**——session 是单文件，覆盖即丢失回收凭证');
    assertEq(launches, 1, '确认回收后才新建');
    if (out.state === 'READY') {
      assertEq(out.managed?.pid, fresh.pid, '新实例的身份须回传');
    }
  });

  await run(results, 'P1：旧实例回收**未确认** → BLOCKED，绝不新建第二个实例', async () => {
    let launches = 0;
    const stale = {
      pid: 1111, startedAtMs: 1, executable: 'C:/DevEco/tools/emulator/Emulator.exe', profile: 'P',
    };
    const base: DeviceReadinessDeps = {
      listTargets: () => ['phone-1'],
      isLocked: () => true,
      wake: () => {},
      knownEmulatorSerials: () => [],
      launchManagedEmulator: async () => {
        launches += 1;
        return { ok: true, serial: '127.0.0.1:5560', identity: { ...stale, pid: 2222 }, note: 'launched' };
      },
      awaitEmulatorReady: async () => true,
    };
    // ① 回收失败
    const failed = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      existingManaged: { serial: '127.0.0.1:5599', identity: stale },
      deps: { ...base, reclaimManaged: () => 'refused' },
    });
    assertEq(failed.state, 'BLOCKED', JSON.stringify(failed));
    assertEq(launches, 0, '回收未确认时**一个新实例都不许起**');
    if (failed.state === 'BLOCKED') {
      // 旧实例的身份必须交出去，否则它连被对账回收的机会都没有
      assertEq(failed.orphanManaged?.pid, stale.pid, '须把旧实例 identity 交给上层');
      assert(/未能确认回收/.test(failed.reason), failed.reason);
    }

    // ② 根本没有回收能力 → 同样 BLOCKED（不得当作"可以直接新建"）
    const noCapability = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      existingManaged: { serial: '127.0.0.1:5599', identity: stale },
      deps: base,
    });
    assertEq(noCapability.state, 'BLOCKED', JSON.stringify(noCapability));
    assertEq(launches, 0, '没有回收能力时也不许起新实例');
  });

  await run(results, 'P1：旧进程**已自然退出**（already_absent）→ 允许新建，不得永久 BLOCKED', async () => {
    // 四轮 review：`reclaimManagedDevice` 对"pid 已不存在"返回 action:'none'。
    // 上一版只认 'reclaimed'，于是这个**最常见**的情况被当成回收失败 → 永久 BLOCKED，
    // 明明已经可以安全新建。
    let launches = 0;
    const stale = {
      pid: 1111, startedAtMs: 1, executable: 'C:/DevEco/tools/emulator/Emulator.exe', profile: 'P',
    };
    const fresh = {
      pid: 2222, startedAtMs: 2, executable: 'C:/DevEco/tools/emulator/Emulator.exe', profile: 'P',
    };
    const out = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      existingManaged: { serial: '127.0.0.1:5599', identity: stale },
      deps: {
        listTargets: () => ['phone-1'],
        isLocked: () => true,
        wake: () => {},
        knownEmulatorSerials: () => [],
        reclaimManaged: () => 'already_absent',
        launchManagedEmulator: async () => {
          launches += 1;
          return { ok: true, serial: '127.0.0.1:5560', identity: fresh, note: 'launched' };
        },
        awaitEmulatorReady: async () => true,
      },
    });
    assertEq(out.state, 'READY', `进程已不在就该允许新建：${JSON.stringify(out)}`);
    assertEq(launches, 1, '应新建一个实例');
    if (out.state === 'READY') assertEq(out.managed?.pid, fresh.pid, '新实例身份须回传');
  });

  await run(results, 'P1：`serial:null` 的旧 session **也要回收**（启动失败时就是这种记录）', async () => {
    // 四轮 review：gate 自己在 BLOCKED 时写的 failed session 允许 serial 为 null 而
    // managed 有值。上一版的复用判据要求 `reusable.serial` 为真，那类 session 会
    // **整段跳过回收**直接起第二个实例 —— 旧的永久泄漏。判据必须是 identity。
    const reclaimedPids: number[] = [];
    let launches = 0;
    const orphan = {
      pid: 3333, startedAtMs: 9, executable: 'C:/DevEco/tools/emulator/Emulator.exe', profile: 'P',
    };
    const deps: DeviceReadinessDeps = {
      listTargets: () => ['phone-1'],
      isLocked: () => true,
      wake: () => {},
      knownEmulatorSerials: () => [],
      reclaimManaged: identity => { reclaimedPids.push(identity.pid); return 'reclaimed'; },
      launchManagedEmulator: async () => {
        launches += 1;
        return {
          ok: true, serial: '127.0.0.1:5570',
          identity: { ...orphan, pid: 4444 }, note: 'launched',
        };
      },
      awaitEmulatorReady: async () => true,
    };
    const out = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      // 启动失败的 session：serial 未知，但 identity 在
      existingManaged: { serial: null, identity: orphan },
      deps,
    });
    assertEq(reclaimedPids[0], orphan.pid, 'serial 为 null 也必须先回收——判据是 identity 不是 serial');
    assertEq(launches, 1, '确认回收后才新建');
    assertEq(out.state, 'READY', JSON.stringify(out));

    // 且这种 session 回收被拒时同样 BLOCKED，并把 identity 交出去
    const refused = await ensureDeviceReady({
      configuredSerial: 'phone-1',
      emulatorFallback: 'managed',
      existingManaged: { serial: null, identity: orphan },
      deps: { ...deps, reclaimManaged: () => 'refused' },
    });
    assertEq(refused.state, 'BLOCKED', JSON.stringify(refused));
    if (refused.state === 'BLOCKED') {
      assertEq(refused.orphanManaged?.pid, orphan.pid, '须把旧实例 identity 交给上层');
    }
  });

  await run(results, '解锁成功的全部事件/返回投影只含固定 note，并产生 succeeded + device_ready', async () => {
    const locks = [true, false];
    const events: Array<Record<string, unknown>> = [];
    const decision = await runDeviceReadinessGate({
      phase: 'testing', retries: 0, sessionId: 'privacy-test',
      input: {
        configuredSerial: 'phone-1', credentialRef: 'opaque-ref', emulatorFallback: 'disabled',
        deps: {
          listTargets: () => ['phone-1'],
          isLocked: () => locks.shift(),
          wake: () => {},
          knownEmulatorSerials: () => [],
          attestPhysical: () => true,
          unlockWithCredential: () => ({ ok: true, note: 'unlock_succeeded:credential_verified' }),
        },
      },
      emitEvent: event => events.push(event),
    });
    assert(decision.outcome === undefined, '成功后应 READY');
    assert(events.some(e => e.type === 'device_unlock_attempt' && e.outcome === 'succeeded'),
      `须有 succeeded 审计事件：${JSON.stringify(events)}`);
    assert(events.some(e => e.type === 'device_ready'), '须有 device_ready');
    const projected = JSON.stringify({ events, notes: decision.notes });
    for (const raw of ['未识别成功', '点击此处重试', 'PRIVATE_NOTICE']) {
      assert(!projected.includes(raw), `所有投影均不得含 UI/通知原文：${projected}`);
    }
  });

  return results;
}

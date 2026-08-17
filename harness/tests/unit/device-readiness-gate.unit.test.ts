// ============================================================================
// device-readiness-gate.unit.test.ts — 设备就绪门三态/降级/死锁回归
//                                      （openspec device-readiness-and-completion t3）
// ============================================================================

import {
  applyFrozenDeviceEnv,
  buildTestingTargetKindCap,
  deviceEnvFor,
  ensureDeviceReady,
  runDeviceReadinessGate,
  runPhaseEntryDeviceGate,
  type DeviceReadinessDeps,
  type DeviceReadinessInput,
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

  await run(results, 'R16：**无界/长时**等待必须异步；同步等待只走唯一有界原语', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsMod = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pathMod = require('path') as typeof import('path');
    const utils = (f: string) => pathMod.join(__dirname, '..', '..', 'scripts', 'utils', f);
    // 只查**可执行代码**——注释里说明"此前用 Atomics.wait"是有价值的历史记录
    const executable = (p: string): string => fsMod.readFileSync(p, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*)/.test(l))
      .join('\n');

    // e5d8a2c4 T3#3：规则被**说准**（不是放宽）。原表述"设备门链路不得同步阻塞事件
    // 循环"与事实不符——同一条链路上本来就通篇是同步 spawnSync：dumpLayout 数百 ms、
    // providers/device-test-run.ts 的 hdc 调用 timeout:120_000、UT 整轮以分钟计，而
    // provider 契约一路同步到 checkDeviceTestRunGate 这个同步 check 门。在这种链路上
    // 禁 400ms 的观察间隔、却放行 120s 的同步 spawnSync，规则就不是在保护活性。
    //
    // 真实规则 = **纯等待必须有硬上限**，长/无界的必须异步。扫描范围因此**扩大**到
    // 解锁与运行期恢复两个文件（原来只扫两个门文件，解锁链根本不在管辖内）。
    const SYNC_WAIT_BANNED = [
      'device-readiness-deps.ts',
      'device-readiness-gate.ts',
      'device-unlock-helper.ts',
      'device-runtime-recovery.ts',
    ];
    for (const f of SYNC_WAIT_BANNED) {
      const code = executable(utils(f));
      assert(
        !/Atomics\.wait/.test(code),
        `${f} 不得**直接**调用 Atomics.wait——同步等待只许经 boundedSyncWait（那里有硬上限把关）`,
      );
    }

    // 唯一豁免模块：必须自带硬上限，且**抛而不 clamp**（静默截断 = 调用方以为等够了）
    const waitSrc = executable(utils('bounded-sync-wait.ts'));
    assert(/export const MAX_SYNC_WAIT_MS/.test(waitSrc), 'bounded-sync-wait 必须导出硬上限常量');
    assert(
      /throw new Error\(/.test(waitSrc) && /ms > MAX_SYNC_WAIT_MS/.test(waitSrc),
      '超上限必须抛——clamp 会把"其实没等够"变成查不出来的行为差异',
    );
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

  await run(results, 'T3#2 真机解锁失败 + 模拟器降级成功 → **不得**记成模拟器上的 succeeded', async () => {
    // 事故形态（codex 三轮 P1 的"伴生错误"）：READY 分支此前用
    // `notes.find(n => n.startsWith('unlock:'))` 反推事件，成败**硬编码** succeeded、
    // serial 取**最终 target**。于是这一幕会产出一条凭空捏造的成功记录，
    // 而真机那次失败被彻底抹掉——证据链上最坏的一类错。
    const events: Array<Record<string, unknown>> = [];
    const decision = await runDeviceReadinessGate({
      phase: 'testing', retries: 0, sessionId: 'fallback-truth',
      input: {
        configuredSerial: 'phone-1', credentialRef: 'opaque-ref', emulatorFallback: 'existing',
        deps: {
          listTargets: () => ['phone-1', 'emu-9'],
          isLocked: (s: string) => s === 'phone-1',       // 真机恒锁，模拟器没锁
          wake: () => {},
          knownEmulatorSerials: () => ['emu-9'],
          unlockWithCredential: () => ({
            ok: false,
            note: 'unlock_blocked:layout_unsupported:pin_container_not_found（零输入）',
            failureKind: 'layout_unsupported',
          }),
        },
      },
      emitEvent: event => events.push(event),
    });
    assert(decision.outcome === undefined, `降级后应放行：${JSON.stringify(decision.outcome)}`);
    const unlockEvents = events.filter(e => e.type === 'device_unlock_attempt');
    assertEq(unlockEvents.length, 1, `解锁只尝试过一次，事件也只该有一条：${JSON.stringify(events)}`);
    assertEq(unlockEvents[0].outcome, 'failed', '真机没解开就是 failed——降级成功不改变这个事实');
    assertEq(unlockEvents[0].serial, 'phone-1', 'serial 须是**被尝试解锁的那台**，不是降级后的目标');
    assertEq(unlockEvents[0].failure_kind, 'layout_unsupported', '结构化归因须原样落到事件上');
    assert(
      events.some(e => e.type === 'device_ready' && e.serial === 'emu-9'),
      `device_ready 仍应是降级后的模拟器：${JSON.stringify(events)}`,
    );
  });

  await run(results, 'T3#2 归因贯通到 phase_halt：BLOCKED 时带 unlock_failure_kind（消费方不解析文案）', async () => {
    const events: Array<Record<string, unknown>> = [];
    const decision = await runDeviceReadinessGate({
      phase: 'testing', retries: 0, sessionId: 'kind-vantage',
      input: {
        configuredSerial: 'phone-1', credentialRef: 'opaque-ref', emulatorFallback: 'disabled',
        deps: {
          listTargets: () => ['phone-1'],
          isLocked: () => true,
          wake: () => {},
          knownEmulatorSerials: () => [],
          unlockWithCredential: () => ({
            ok: false,
            note: '凭据不存在（未登记或已被烧毁）——零输入',
            failureKind: 'credential_unavailable',
          }),
        },
      },
      emitEvent: event => events.push(event),
    });
    assertEq(decision.outcome?.halt_reason, 'device_not_ready', '仍走既有 external_block 通道');
    const halt = events.find(e => e.type === 'phase_halt');
    assertEq(halt?.unlock_failure_kind, 'credential_unavailable', 'halt 须带结构化归因');
    const attemptEvent = events.find(e => e.type === 'device_unlock_attempt');
    assertEq(attemptEvent?.failure_kind, 'credential_unavailable', '事件须带结构化归因');
    assertEq(attemptEvent?.serial, 'phone-1', '失败事件同样须带 serial（此前非 READY 分支根本不写）');
  });

  // ==========================================================================
  // b3f7d9a2 t2：普通模式入口设备前置（目标只解析一次，全链共用）
  //
  // 事故（2026-08-17 宿主）：普通模式 UT 撞锁屏，自动解锁链从未启动——解锁链只认
  // HARNESS_HDC_TARGET 而普通模式没人注入，hdc 却隐式选唯一在线设备。
  // ==========================================================================

  /** 入口门夹具：策略与就绪核心都可注入，用于断言"零调用"这类否定命题 */
  function entryBench(opts: {
    policyCode?: 'ok' | 'device_policy_unset';
    policyThrows?: string;
    result?: DeviceReadinessResult;
    input?: Partial<DeviceReadinessInput>;
  }) {
    const calls = { policy: 0, ensure: 0, inputs: [] as DeviceReadinessInput[] };
    const base: DeviceReadinessInput = {
      configuredSerial: null,
      credentialRef: 'maison/device/dev-1/v1',
      emulatorFallback: 'disabled',
      deps: { listTargets: () => ['dev-1'], isLocked: () => false, wake: () => {} },
      ...opts.input,
    };
    return {
      calls,
      args: {
        projectRoot: '/tmp/does-not-matter',
        phase: 'ut',
        policy: () => {
          calls.policy += 1;
          if (opts.policyThrows) throw new Error(opts.policyThrows);
          return { code: opts.policyCode ?? 'ok', guidance: '四选一：① 手工解锁 …' } as const;
        },
        buildInput: () => base,
        ensureReady: async (input: DeviceReadinessInput) => {
          calls.ensure += 1;
          calls.inputs.push(input);
          return (
            opts.result ?? { state: 'READY' as const, target: { serial: 'dev-1', targetKind: 'physical' as const }, notes: ['ok'] }
          );
        },
      },
    };
  }

  await run(results, 't2 冻结上下文判据是**双字段**：frozen+target → 复用，零重解析零重查策略', async () => {
    const b = entryBench({});
    const d = await runPhaseEntryDeviceGate({
      ...b.args,
      env: { MAISON_DEVICE_ATTEMPT_FROZEN: '1', HARNESS_HDC_TARGET: 'goal-phone' },
    });
    assertEq(d.ok, true, 'goal 已冻结的 attempt 须放行');
    assertEq(d.reusedFrozen, true, '须标记为复用冻结上下文');
    assertEq(d.env, undefined, '复用时不得再产出 env 片段（目标已注入）');
    assertEq(b.calls.policy, 0, '**不得**重查策略（attempt 已冻结）');
    assertEq(b.calls.ensure, 0, '**不得**重解析目标');
    assert(d.notes.join(' ').includes('goal-phone'), 'note 须记录复用的目标');
  });

  await run(results, 't2 **只有 frozen 没有 target → fail-closed**（否则手工设一个 env 就能绕过设备门）', async () => {
    const b = entryBench({});
    const d = await runPhaseEntryDeviceGate({
      ...b.args,
      env: { MAISON_DEVICE_ATTEMPT_FROZEN: '1' },
    });
    assertEq(d.ok, false, '冻结上下文损坏必须阻断');
    assert(/冻结上下文损坏/.test(d.reason ?? ''), `须点名冻结上下文损坏：${d.reason}`);
    assert(/隐式/.test(d.reason ?? ''), '须说明不回落隐式选设备');
    assertEq(b.calls.ensure, 0, 'fail-closed 时不得去解析目标');
    assertEq(b.calls.policy, 0, 'fail-closed 时不得继续查策略');
  });

  await run(results, 't2 策略 unset → fail-fast：原文透传 guidance，且**零就绪调用**（不碰设备）', async () => {
    const b = entryBench({ policyCode: 'device_policy_unset' });
    const d = await runPhaseEntryDeviceGate({ ...b.args, env: {} });
    assertEq(d.ok, false, 'unset 必须阻断');
    assert(/device_policy_unset/.test(d.reason ?? ''), '须带上 code');
    assert(/四选一/.test(d.reason ?? ''), 'guidance 须原文透传（四选一文案 SSOT 在 device-policy）');
    assertEq(b.calls.ensure, 0, '**零就绪调用**：策略没配好就不该唤醒/解锁任何设备');
  });

  await run(results, 't2 策略检查执行失败（凭据库不可读）→ 抛出，由调用方停止（既不 ok 也不 unset）', async () => {
    const b = entryBench({ policyThrows: '[device-policy] 凭据库不可读（vault down）' });
    let thrown: Error | null = null;
    try {
      await runPhaseEntryDeviceGate({ ...b.args, env: {} });
    } catch (e) {
      thrown = e as Error;
    }
    assert(thrown !== null, '执行失败须抛出，不得降级成任何 code');
    assert(/凭据库不可读/.test(thrown!.message), `须原样带上原因：${thrown!.message}`);
    assertEq(b.calls.ensure, 0, '执行失败时不得碰设备');
  });

  await run(results, 't2 显式 env 目标**优先于** config（否则解锁 A、hdc 操作 B）', async () => {
    const b = entryBench({ input: { configuredSerial: 'config-phone' } });
    const d = await runPhaseEntryDeviceGate({ ...b.args, env: { HARNESS_HDC_TARGET: 'env-phone' } });
    assertEq(d.ok, true, '应通过');
    assertEq(b.calls.inputs[0]?.configuredSerial, 'env-phone', 'env 指定的目标须覆盖 config，避免目标分裂');
  });

  await run(results, 't2 未设 env 时用 config/单台在线的解析结果，并产出 deviceEnvFor 完整片段', async () => {
    const b = entryBench({ input: { configuredSerial: 'config-phone' } });
    const d = await runPhaseEntryDeviceGate({ ...b.args, env: {}, sessionId: 'sess-entry' });
    assertEq(b.calls.inputs[0]?.configuredSerial, 'config-phone', '无 env 时按 config 解析');
    assertEq(d.env?.HARNESS_HDC_TARGET, 'dev-1', '解析到的目标须进 env 片段');
    assertEq(d.env?.MAISON_DEVICE_TARGET_KIND, 'physical', 'kind 须一并注入');
    assertEq(d.env?.MAISON_DEVICE_SESSION_ID, 'sess-entry', 'session id 须注入');
    // 复用 deviceEnvFor 的证据：冻结标记与凭据引用都在（手拼片段曾漏字段导致真机恒零等待）
    assertEq(d.env?.MAISON_DEVICE_ATTEMPT_FROZEN, '1', '须带冻结标记（防运行期回落读实时配置提权）');
    assertEq(d.env?.MAISON_DEVICE_CREDENTIAL_REF, 'maison/device/dev-1/v1', '须冻结本次凭据引用');
  });

  await run(results, 't2 BLOCKED / AMBIGUOUS 都 fail-fast，且原因指向"处理环境"而非改代码', async () => {
    const blocked = entryBench({
      result: { state: 'BLOCKED', reason: '设备 dev-1 仍处于锁屏', notes: ['wake(dev-1)'] },
    });
    const b1 = await runPhaseEntryDeviceGate({ ...blocked.args, env: {} });
    assertEq(b1.ok, false, 'BLOCKED 须阻断');
    assert(/仍处于锁屏/.test(b1.reason ?? ''), '须带上核心给出的具体原因');
    assert(/任何设备操作之前/.test(b1.reason ?? ''), '须说明是在设备操作前阻断');
    assert(b1.notes.includes('wake(dev-1)'), '核心 notes 须透传（供事故日志裁决）');

    const ambiguous = entryBench({
      result: {
        state: 'AMBIGUOUS',
        reason: '检测到多个设备（a, b）且未配置 target_serial，无法唯一确定目标',
        notes: [],
      },
    });
    const b2 = await runPhaseEntryDeviceGate({ ...ambiguous.args, env: {} });
    assertEq(b2.ok, false, 'AMBIGUOUS 须阻断');
    assert(/赌一台/.test(b2.reason ?? ''), '多设备须明确"不赌"');
    assert(/target_serial/.test(b2.reason ?? ''), '须指向配置 target_serial');
  });

  await run(results, 't2 config 目标离线：无 fallback → 阻断；已授权 existing → 走降级（绝不隐式换设备）', async () => {
    // 真实核心（不注入 ensureReady），用可编程 deps 造"配置目标不在线"
    const offlineNoFallback = await ensureDeviceReady({
      configuredSerial: 'config-phone',
      emulatorFallback: 'disabled',
      deps: { listTargets: () => ['other-phone'], isLocked: () => false, wake: () => {} },
    });
    assertEq(offlineNoFallback.state, 'BLOCKED', '配置目标离线且无降级 → 阻断');
    const entryBlocked = await runPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'ut',
      env: {},
      policy: () => ({ code: 'ok', guidance: '设备策略已配置' }),
      buildInput: () => ({
        configuredSerial: 'config-phone',
        emulatorFallback: 'disabled',
        deps: { listTargets: () => ['other-phone'], isLocked: () => false, wake: () => {} },
      }),
    });
    assertEq(entryBlocked.ok, false, '**绝不**跳过检查后让 hdc 隐式选中 other-phone');
    assert(
      !JSON.stringify(entryBlocked.env ?? {}).includes('other-phone'),
      '阻断时不得把在线的另一台设备当作目标注入',
    );

    // 已授权 existing：复用用户已开的模拟器
    const withFallback = await runPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'ut',
      env: {},
      policy: () => ({ code: 'ok', guidance: '设备策略已配置' }),
      buildInput: () => ({
        configuredSerial: 'config-phone',
        emulatorFallback: 'existing',
        deps: {
          listTargets: () => ['127.0.0.1:5555'],
          isLocked: () => false,
          wake: () => {},
          knownEmulatorSerials: () => ['127.0.0.1:5555'],
        },
      }),
    });
    assertEq(withFallback.ok, true, '已授权 existing 降级须放行');
    assertEq(withFallback.env?.HARNESS_HDC_TARGET, '127.0.0.1:5555', '降级目标须注入');
    assertEq(withFallback.env?.MAISON_DEVICE_TARGET_KIND, 'emulator', '降级目标分类为 emulator');
  });

  await run(results, 't2 harness-runner 接线：需设备 phase 才起门 / 冻结不二次处理 / env 已设不覆盖', async () => {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const src = fsMod.readFileSync(pathMod.join(__dirname, '..', '..', 'harness-runner.ts'), 'utf-8');
    assert(
      /phaseRequiresDevice\(phase, resolvedProfile\)/.test(src),
      '入口门须由 phaseRequiresDevice 派生（不得硬编码 phase 名）',
    );
    assert(/await runPhaseEntryDeviceGate\(/.test(src), '须调用入口门');
    // 门必须排在 Step 2（脚本 harness=设备操作发生地）之前
    const gateIdx = src.indexOf('runPhaseEntryDeviceGate(');
    const stepTwoIdx = src.indexOf("console.log('\\n🔧 Step 2");
    assert(gateIdx > 0 && stepTwoIdx > 0, '两个锚点都须存在');
    assert(gateIdx < stepTwoIdx, '设备前置必须排在 Step 2 脚本 harness 之前（任何设备操作之前）');
    // env 注入与 testing 封顶都走**生产函数**（行为由下面独立用例验证，此处只钉接线）
    assert(
      /applyFrozenDeviceEnv\(process\.env, gate\.env\)/.test(src),
      'env 注入须走 applyFrozenDeviceEnv（原子整组，不得逐键"不存在才写"）',
    );
    assert(
      !/if \(!process\.env\[k\]\) process\.env\[k\] = v/.test(src),
      '不得逐键"不存在才写"——那会把陈旧的冻结上下文留在 env 里',
    );
    assert(
      /buildTestingTargetKindCap\(phase, gate\.target\)/.test(src),
      'testing 封顶须走 buildTestingTargetKindCap（复用既有 capsTestingConclusion 判据）',
    );
    assert(
      /if \(deviceConclusionCap\) checks\.push\(deviceConclusionCap\)/.test(src),
      '封顶结果须入 checks 账（参与 violations/报告/退出码），否则等于没封',
    );
    // 托管实例必须注册回收，且**早于**任何退出分支
    assert(/registerManagedDeviceCleanup\(/.test(src), '托管模拟器须注册退出回收，否则进程泄漏');
    const cleanupIdx = src.indexOf('registerManagedDeviceCleanup(');
    const exitIdx = src.indexOf("console.error(`   ✗ ${(gate.reason");
    assert(cleanupIdx > 0 && exitIdx > 0, '两个锚点都须存在');
    assert(
      cleanupIdx < exitIdx,
      '回收登记必须排在 !gate.ok 的退出分支之前——托管实例"起来了但没就绪"是普通失败路径，晚登记即泄漏',
    );
    // 编译跳过 flag 不得用来免除设备门：UT 的真机执行只受 HARNESS_SKIP_HVIGOR_TEST 控制，
    // testing 更完全不认这个编译 flag——用它让路等于门形同虚设。
    assert(
      !/HARNESS_SKIP_HVIGOR\b/.test(src),
      'harness-runner 不得用 HARNESS_SKIP_HVIGOR 免除设备门（它只跳过编译，装机/跑机照旧）',
    );
    // 执行失败与 unset 须走不同出口
    assert(
      /设备策略检查执行失败/.test(src),
      '策略检查执行失败须与 device_policy_unset 分开报告（不得引导重新登记）',
    );
  });

  await run(results, 't2-fix P0 冻结上下文整组原子注入：陈旧 CREDENTIAL_REF 必须被删除（manual 策略不得自动输 PIN）', async () => {
    // 事故形态：进程继承了上一次/别处的 MAISON_DEVICE_CREDENTIAL_REF，本次策略是 manual
    //（deviceEnvFor 不返回 ref）。逐键"不存在才写"会把旧 ref 留下，而
    // resolveAttemptCredentialRef 优先取它 → manual 策略下也会自动输入 PIN（越权）。
    const procEnv: NodeJS.ProcessEnv = {
      MAISON_DEVICE_CREDENTIAL_REF: 'maison/device/OLD-PHONE/v9',
      MAISON_DEVICE_SESSION_ID: 'stale-session',
      MAISON_DEVICE_TARGET_KIND: 'physical',
      UNRELATED_VAR: 'keep-me',
    };
    const manualEnv = deviceEnvFor({ serial: 'dev-1', targetKind: 'emulator' }, 'fresh-session');
    assertEq(manualEnv.MAISON_DEVICE_CREDENTIAL_REF, undefined, '前提：manual 策略不产出 ref');
    applyFrozenDeviceEnv(procEnv, manualEnv);
    assertEq(
      procEnv.MAISON_DEVICE_CREDENTIAL_REF, undefined,
      '**陈旧 ref 必须被删除**——留着就是"手工策略却自动输入 PIN"的越权路径',
    );
    assertEq(procEnv.MAISON_DEVICE_SESSION_ID, 'fresh-session', '陈旧 session 须被本次覆盖');
    assertEq(procEnv.MAISON_DEVICE_TARGET_KIND, 'emulator', '陈旧 kind 须被本次覆盖');
    assertEq(procEnv.MAISON_DEVICE_ATTEMPT_FROZEN, '1', '冻结标记须注入');
    assertEq(procEnv.HARNESS_HDC_TARGET, 'dev-1', '目标须注入');
    assertEq(procEnv.UNRELATED_VAR, 'keep-me', '非 MAISON_DEVICE_* 的键不得被动到');

    // 已授权时 ref 如实注入
    const authed: NodeJS.ProcessEnv = {};
    applyFrozenDeviceEnv(
      authed,
      deviceEnvFor({ serial: 'dev-1', targetKind: 'physical' }, 's2', 'maison/device/dev-1/v1'),
    );
    assertEq(authed.HARNESS_HDC_TARGET, 'dev-1', '空白 target 须被写入');
    assertEq(authed.MAISON_DEVICE_CREDENTIAL_REF, 'maison/device/dev-1/v1', '已授权时 ref 须注入');

    // **HARNESS_HDC_TARGET 同样以门返回值为准**：显式目标的优先级在门的**输入阶段**
    // 已兑现，这里保留旧值会造成目标分裂（见下一条用例的端到端复现）。
    const stale: NodeJS.ProcessEnv = { HARNESS_HDC_TARGET: 'phone-offline' };
    applyFrozenDeviceEnv(stale, deviceEnvFor({ serial: 'emu-x', targetKind: 'emulator' }, 's3'));
    assertEq(stale.HARNESS_HDC_TARGET, 'emu-x', '门解析出的目标须覆盖旧值（否则 target 分裂）');
    assertEq(stale.MAISON_DEVICE_TARGET_KIND, 'emulator', 'kind 与 target 必须同源');
  });

  await run(results, 't2-fix P1 显式真机离线 → 已授权降级：最终 env 的 target 必须是模拟器 serial（不得与 kind 分裂）', async () => {
    // 事故形态（codex 三轮 P1，已在真实代码上复现）：显式 HARNESS_HDC_TARGET 指向离线真机，
    // 门按授权降级到模拟器后，若注入时保留旧 target，就得到
    //   HARNESS_HDC_TARGET=phone-offline + MAISON_DEVICE_TARGET_KIND=emulator
    // ——hdc 去操作离线真机，而门与 testing 封顶都以为目标是模拟器。
    const procEnv: NodeJS.ProcessEnv = { HARNESS_HDC_TARGET: 'phone-offline' };
    const d = await runPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'testing',
      env: procEnv,
      policy: () => ({ code: 'ok', guidance: '设备策略已配置' }),
      buildInput: () => ({
        configuredSerial: null,
        emulatorFallback: 'existing',
        deps: {
          listTargets: () => ['127.0.0.1:5555'],
          isLocked: () => false,
          wake: () => {},
          knownEmulatorSerials: () => ['127.0.0.1:5555'],
        },
      }),
    });
    assertEq(d.ok, true, '已授权 existing 降级须放行');
    // 显式目标的优先级在**输入阶段**兑现：门确实拿 phone-offline 去解析，发现离线才降级
    assert(d.notes.join(' ').includes('phone-offline'), '门须记录"显式目标不在线"这一事实');
    assertEq(d.target?.serial, '127.0.0.1:5555', '门的裁决是模拟器');
    applyFrozenDeviceEnv(procEnv, d.env!);
    assertEq(
      procEnv.HARNESS_HDC_TARGET, '127.0.0.1:5555',
      '**最终 env 的 target 必须是降级目标**——否则 hdc 操作离线真机而门以为是模拟器',
    );
    assertEq(procEnv.MAISON_DEVICE_TARGET_KIND, 'emulator', 'kind 与 target 同源');
    // 封顶判据与最终目标一致（testing 在模拟器上不得整体通过）
    const cap = buildTestingTargetKindCap('testing', d.target!);
    assert(!!cap && cap.details.includes('127.0.0.1:5555'), '封顶须指向真正被使用的那个目标');
  });

  await run(results, 't2-fix P1 托管实例启动后未就绪 → orphan 随失败一起交出（可执行清理路径不得泄漏）', async () => {
    const identity = {
      pid: 9911,
      startedAtMs: 1_700_000_000_111,
      executable: 'C:/DevEco/tools/emulator/Emulator.exe',
      profile: 'Pura 90',
    };
    const d = await runPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'ut',
      env: {},
      policy: () => ({ code: 'ok', guidance: '设备策略已配置' }),
      buildInput: () => ({
        configuredSerial: null,
        emulatorFallback: 'managed',
        deps: { listTargets: () => [], isLocked: () => false, wake: () => {} },
      }),
      ensureReady: async () => ({
        state: 'BLOCKED',
        reason: '模拟器 emu-x 启动后未在预算内就绪',
        notes: ['launch(emu-x)'],
        orphanManaged: identity,
        orphanSerial: 'emu-x',
      }),
    });
    assertEq(d.ok, false, '未就绪须阻断');
    assertEq(d.managed?.pid, identity.pid, '**孤儿托管身份必须随失败交出**，否则该进程零回收凭证');
    assertEq(d.orphanSerial, 'emu-x', 'orphan serial 须一并交出');
  });

  await run(results, 't2-fix P1 testing 封顶：emulator/unknown 必须封顶且走 externalBlocked，physical 与 ut 不封顶', async () => {
    const emu = buildTestingTargetKindCap('testing', { serial: '127.0.0.1:5555', targetKind: 'emulator' });
    assert(!!emu, '模拟器上的 testing 必须封顶');
    assertEq(emu!.status, 'FAIL', '封顶须是 FAIL（不得整体通过）');
    assertEq(emu!.severity, 'BLOCKER', '须 BLOCKER');
    assertEq(emu!.blocking_class, 'externalBlocked', '走既有外部阻断通道（环境类可 defer）');
    assertEq(emu!.failure_kind, 'device_blocked', '归因复用既有 device_blocked');
    assert(emu!.details.includes('127.0.0.1:5555'), '须点名具体目标');

    const unknown = buildTestingTargetKindCap('testing', { serial: 'phone-x', targetKind: 'unknown' });
    assert(!!unknown, 'unknown 与模拟器同等封顶（禁反向推断为真机）');
    assert(unknown!.details.includes('禁反向推断'), 'unknown 须说明禁反向推断');
    assert(unknown!.suggestion!.includes('attestation'), 'unknown 须指向真机 attestation 校准');

    assertEq(
      buildTestingTargetKindCap('testing', { serial: 'phone-1', targetKind: 'physical' }), undefined,
      '真机 testing 不封顶',
    );
    assertEq(
      buildTestingTargetKindCap('ut', { serial: '127.0.0.1:5555', targetKind: 'emulator' }), undefined,
      'ut 允许在模拟器上 PASS（既有语义不得被改宽或改严）',
    );
  });

  await run(results, 't2 bridge 收缩：只消费已注入的目标，**不得**自建第三套解析（不读 config）', async () => {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const bridge = pathMod.join(
      __dirname, '..', '..', '..', 'profiles', 'hmos-app', 'harness', 'device-recovery-bridge.ts',
    );
    const src = fsMod.readFileSync(bridge, 'utf-8');
    assert(
      !/resolveConfiguredSerial|loadLocalConfig|target_serial/.test(src),
      'bridge 不得自行从 config 解析目标——目标只在入口解析一次（否则"解锁 A、hdc 操作 B"）',
    );
    assert(
      /HARNESS_HDC_TARGET/.test(src),
      'bridge 仍消费入口注入的 HARNESS_HDC_TARGET',
    );
  });

  return results;
}

// ============================================================================
// device-readiness-gate.unit.test.ts — 设备就绪门三态/降级/死锁回归
//                                      （openspec device-readiness-and-completion t3）
// ============================================================================

import {
  applyFrozenDeviceEnv,
  applyPhaseEntryDeviceGate,
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

  await run(results, 'a4e7c2f9 reveal_failed 原样投影到 device_unlock_attempt 与 phase_halt', async () => {
    const events: Array<Record<string, unknown>> = [];
    const decision = await runDeviceReadinessGate({
      phase: 'ut', retries: 0, sessionId: 'reveal-kind',
      input: {
        configuredSerial: 'phone-1', credentialRef: 'opaque-ref', emulatorFallback: 'disabled',
        deps: {
          listTargets: () => ['phone-1'],
          isLocked: () => true,
          wake: () => {},
          knownEmulatorSerials: () => [],
          unlockWithCredential: () => ({
            ok: false,
            note: 'unlock_blocked:reveal_failed:timeout（零输入；timed_out=true error_code=ETIMEDOUT signal=SIGTERM status=none）',
            failureKind: 'reveal_failed',
            revealFact: { ok: false, timedOut: true, signal: 'SIGTERM', status: null, errorCode: 'ETIMEDOUT' },
          }),
        },
      },
      emitEvent: event => events.push(event),
    });
    assertEq(decision.outcome?.halt_reason, 'device_not_ready', '仍走既有 external_block 通道');
    const attemptEvent = events.find(e => e.type === 'device_unlock_attempt');
    assertEq(attemptEvent?.failure_kind, 'reveal_failed', '第四类归因须原样落事件，不得被压回旧三类');
    // 执行事实须**结构化**落到事件上：消费方据 error_code 区分 ETIMEDOUT / ENOENT，
    // 不必（也不允许）解析 note 文案。
    const revealExec = attemptEvent?.reveal_exec as Record<string, unknown> | undefined;
    assertEq(revealExec?.error_code, 'ETIMEDOUT', '事件须带 reveal_exec.error_code');
    assertEq(revealExec?.timed_out, true, '事件须带 reveal_exec.timed_out');
    assertEq(revealExec?.signal, 'SIGTERM', '事件须带 reveal_exec.signal');
    const halt = events.find(e => e.type === 'phase_halt');
    assertEq(halt?.unlock_failure_kind, 'reveal_failed', 'halt 须带第四类归因');
    assert(
      !JSON.stringify(events).includes('真机校准'),
      'reveal 失败与布局无关——事件链不得出现"须真机校准"这类误导指引',
    );
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
    assert(/await applyPhaseEntryDeviceGate\(/.test(src), '须调用入口门（经共享 helper）');
    // 门必须排在 Step 2（脚本 harness=设备操作发生地）之前
    const gateIdx = src.indexOf('applyPhaseEntryDeviceGate(');
    const stepTwoIdx = src.indexOf("console.log('\\n🔧 Step 2");
    assert(gateIdx > 0 && stepTwoIdx > 0, '两个锚点都须存在');
    assert(gateIdx < stepTwoIdx, '设备前置必须排在 Step 2 脚本 harness 之前（任何设备操作之前）');
    // env 注入与托管回收登记随 helper 一起下沉（c7d2a9e4 D1）：接线钉改钉 helper 源码，
    // 顺序与"无论 ok 与否都先登记"的行为由本文件的 D1 helper 行为用例验证。
    const helperSrc = fsMod.readFileSync(
      pathMod.join(__dirname, '..', '..', 'scripts', 'utils', 'device-readiness-gate.ts'),
      'utf-8',
    );
    assert(
      /applyFrozenDeviceEnv\(env, decision\.env\)/.test(helperSrc),
      'env 注入须走 applyFrozenDeviceEnv（原子整组，不得逐键"不存在才写"）',
    );
    assert(
      !/if \(!(?:proc)?[Ee]nv\[k\]\) (?:proc)?[Ee]nv\[k\] = v/.test(helperSrc),
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
    // 托管实例必须注册回收（登记点在 helper 内，且早于任何返回——见 D1 helper 行为用例）
    assert(
      /registerManagedDeviceCleanup\b/.test(helperSrc) && /reclaimManagedDevice\(/.test(helperSrc),
      '托管模拟器须注册退出回收，否则进程泄漏',
    );
    assert(
      !/registerManagedDeviceCleanup\b/.test(src),
      'harness-runner 不得再自己抄一份回收登记（纪律只留一处）',
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

  // ==========================================================================
  // c7d2a9e4 D1：共享 helper applyPhaseEntryDeviceGate（起门 → notes → 托管回收登记 →
  // 原子注入 env）。即席 CLI 与 device:ready 复用同一条接线，纪律不抄第二遍。
  // ==========================================================================

  await run(results, 'V1 helper：ok+env → 整组原子注入；!ok → env 零改动；冻结放行原样返回', async () => {
    const env: NodeJS.ProcessEnv = {
      MAISON_DEVICE_CREDENTIAL_REF: 'maison/device/OLD-PHONE/v9',
      UNRELATED_VAR: 'keep-me',
    };
    const notesSeen: string[] = [];
    const okDecision = await applyPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'testing',
      startedBy: 'adhoc-1',
      env,
      log: line => notesSeen.push(line),
      registerCleanup: () => { throw new Error('无 managed 不得登记回收'); },
      gate: async () => ({
        ok: true,
        notes: ['设备策略检查通过（code=ok）'],
        env: deviceEnvFor({ serial: 'dev-1', targetKind: 'physical' }, 'sess-1'),
        target: { serial: 'dev-1', targetKind: 'physical' },
      }),
    });
    assertEq(okDecision.ok, true, 'ok 决策原样返回');
    assertEq(env.HARNESS_HDC_TARGET, 'dev-1', '目标须注入到调用方给的 env');
    assertEq(env.MAISON_DEVICE_CREDENTIAL_REF, undefined, '陈旧冻结上下文须被整组删除');
    assertEq(env.UNRELATED_VAR, 'keep-me', '非 MAISON_DEVICE_* 不得被动到');
    assert(notesSeen.includes('设备策略检查通过（code=ok）'), '门的 notes 须逐条透出');
    assert(notesSeen.some(l => l.includes('设备目标已解析并注入')), '注入后须打一行目标');

    const blockedEnv: NodeJS.ProcessEnv = { HARNESS_HDC_TARGET: 'stale-phone' };
    const blocked = await applyPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'testing',
      startedBy: 'adhoc-1',
      env: blockedEnv,
      gate: async () => ({ ok: false, code: 'blocked' as const, notes: [], reason: '设备仍锁屏' }),
    });
    assertEq(blocked.code, 'blocked', 'code 原样透出');
    assertEq(blockedEnv.HARNESS_HDC_TARGET, 'stale-phone', '!ok 时 env 零改动（不得注入任何目标）');

    const frozenEnv: NodeJS.ProcessEnv = { MAISON_DEVICE_ATTEMPT_FROZEN: '1', HARNESS_HDC_TARGET: 'goal-phone' };
    const frozen = await applyPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'testing',
      startedBy: 'adhoc-1',
      env: frozenEnv,
      gate: async () => ({ ok: true, notes: ['复用已冻结的 attempt 目标 goal-phone'], reusedFrozen: true }),
    });
    assertEq(frozen.reusedFrozen, true, '冻结放行须原样返回');
    assertEq(frozenEnv.HARNESS_HDC_TARGET, 'goal-phone', '冻结放行不产 env 片段 → 零改动');
  });

  await run(results, 'V1 helper：managed 无论 ok 与否都在返回前登记回收；门抛出则原样上抛且不登记不注入', async () => {
    const identity = { pid: 4242, startedAtMs: 1_700_000_000_000, executable: 'C:/emu.exe', profile: 'Pura 90' };
    const registered: number[] = [];
    const env: NodeJS.ProcessEnv = {};
    const failed = await applyPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'ut',
      startedBy: 'harness-ut-1',
      env,
      registerCleanup: () => { registered.push(registered.length); },
      gate: async () => ({
        ok: false,
        code: 'blocked' as const,
        notes: [],
        reason: '模拟器未在预算内就绪',
        managed: identity,
        orphanSerial: 'emu-x',
      }),
    });
    assertEq(failed.ok, false, '未就绪须阻断');
    assertEq(registered.length, 1, '**失败路径也必须登记回收**——晚登记即零凭证泄漏');

    await applyPhaseEntryDeviceGate({
      projectRoot: '/tmp/x',
      phase: 'ut',
      startedBy: 'harness-ut-1',
      env,
      registerCleanup: () => { registered.push(registered.length); },
      gate: async () => ({
        ok: true,
        notes: [],
        managed: identity,
        env: deviceEnvFor({ serial: 'emu-x', targetKind: 'emulator' }, 's'),
        target: { serial: 'emu-x', targetKind: 'emulator' },
      }),
    });
    assertEq(registered.length, 2, 'ok 路径同样登记回收');

    const throwEnv: NodeJS.ProcessEnv = {};
    let thrown: Error | null = null;
    try {
      await applyPhaseEntryDeviceGate({
        projectRoot: '/tmp/x',
        phase: 'ut',
        startedBy: 'harness-ut-1',
        env: throwEnv,
        registerCleanup: () => { registered.push(registered.length); },
        gate: async () => { throw new Error('[device-policy] 凭据库不可读（vault down）'); },
      });
    } catch (e) {
      thrown = e as Error;
    }
    assert(thrown !== null && /凭据库不可读/.test(thrown.message), '门抛出须原样上抛（执行失败通道）');
    assertEq(registered.length, 2, '抛出时不得登记回收');
    assertEq(Object.keys(throwEnv).length, 0, '抛出时不得注入任何 env');
  });

  await run(results, 'V1 门的三个 ok:false 返回点各带 code（unset / ambiguous / blocked）', async () => {
    const unset = await runPhaseEntryDeviceGate({ ...entryBench({ policyCode: 'device_policy_unset' }).args, env: {} });
    assertEq(unset.code, 'device_policy_unset', '策略未配置 → device_policy_unset');

    const ambiguous = await runPhaseEntryDeviceGate({
      ...entryBench({ result: { state: 'AMBIGUOUS', reason: '多设备', notes: [] } }).args,
      env: {},
    });
    assertEq(ambiguous.code, 'ambiguous', 'AMBIGUOUS → ambiguous');

    const blocked = await runPhaseEntryDeviceGate({
      ...entryBench({ result: { state: 'BLOCKED', reason: '仍锁屏', notes: [] } }).args,
      env: {},
    });
    assertEq(blocked.code, 'blocked', 'BLOCKED → blocked');

    const corrupt = await runPhaseEntryDeviceGate({
      ...entryBench({}).args,
      env: { MAISON_DEVICE_ATTEMPT_FROZEN: '1' },
    });
    assertEq(corrupt.code, undefined, '冻结上下文损坏不填 code（既非策略问题也非设备问题）');

    const ok = await runPhaseEntryDeviceGate({ ...entryBench({}).args, env: {} });
    assertEq(ok.code, undefined, '通过时不带 code');
  });

  await run(results, 'V2 即席 CLI 接线：三个碰设备分支按块在首个设备操作前起门，derive-only 不起门', async () => {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const src = fsMod.readFileSync(
      pathMod.join(__dirname, '..', '..', 'scripts', 'adhoc-device-test.ts'), 'utf-8',
    );
    /** 从 `anchor` 处的 `{` 起做花括号配对，切出整个块（源码内无跨块字符串花括号） */
    const braceBlock = (text: string, anchor: string): string | null => {
      const s = text.indexOf(anchor);
      if (s < 0) return null;
      let depth = 0;
      for (let i = text.indexOf('{', s); i >= 0 && i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(s, i + 1);
      }
      return null;
    };

    /**
     * 断言体独立成函数，供末尾**负例**（内存中删掉 `!gate.ok` 分支）复用：
     * 只断"某处有 process.exit"抓到的可能是 catch 里的那个，删掉整个失败分支照样绿。
     */
    const assertWiring = (source: string): void => {
      /** 按执行路径切块——不固定全文件顺序，也不数调用次数 */
      const slice = (startAnchor: string, endAnchor: string): string => {
        const s = source.indexOf(startAnchor);
        assert(s > 0, `切片起点缺失：${startAnchor}`);
        const e = source.indexOf(endAnchor, s + startAnchor.length);
        assert(e > s, `切片终点缺失：${endAnchor}`);
        return source.slice(s, e + endAnchor.length);
      };

      // ① dump-ui-only：门在 runAdhocDumpUi 之前，且**判定失败分支自己**退出
      const dumpBlock = slice('if (dumpUiOnly) {', 'process.exit(0);');
      const dumpGate = dumpBlock.indexOf('applyPhaseEntryDeviceGate(');
      const dumpCall = dumpBlock.indexOf('runAdhocDumpUi(');
      assert(dumpGate > 0 && dumpCall > 0, 'dump-ui-only 块内两个锚点都须存在');
      assert(dumpGate < dumpCall, 'dump-ui-only：门必须早于 runAdhocDumpUi（它是该分支第一个设备操作）');
      const dumpFail = braceBlock(dumpBlock, 'if (!gate.ok) {');
      assert(dumpFail !== null, 'dump-ui-only：缺 `if (!gate.ok)` 分支——判定失败会继续 dump');
      assert(dumpFail!.includes('process.exit('), 'dump-ui-only：`!gate.ok` 分支内须 process.exit');
      assert(
        dumpBlock.indexOf(dumpFail!) < dumpCall,
        'dump-ui-only：`!gate.ok` 分支须整体早于 runAdhocDumpUi',
      );

      // ② 执行 / observe 主路径：门在 resolveMainAbilityForBundle（首个 bm dump）之前，
      //    失败分支内先写 device_not_ready placeholder 再退出
      const execBlock = slice("logAdhocPhase('ensure')", "logAdhocPhase('run')");
      const execGate = execBlock.indexOf('applyPhaseEntryDeviceGate(');
      const execAbility = execBlock.indexOf('resolveMainAbilityForBundle(');
      assert(execGate > 0 && execAbility > 0, '主路径两个锚点都须存在');
      assert(execGate < execAbility, '主路径：门必须早于 resolveMainAbilityForBundle');
      const execFail = braceBlock(execBlock, 'if (!gate.ok) {');
      assert(execFail !== null, '主路径：缺 `if (!gate.ok)` 分支——判定失败会继续发设备命令');
      const writeIdx = execFail!.indexOf('writeAdhocTracePlaceholder(');
      const placeholderIdx = execFail!.indexOf("error_kind: 'device_not_ready'");
      const exitIdx = execFail!.indexOf('process.exit(');
      assert(writeIdx > 0, '`!gate.ok` 分支内须调用 writeAdhocTracePlaceholder（只留字面量不写盘＝无证据）');
      assert(placeholderIdx > writeIdx, 'device_not_ready 须是该调用的参数（在调用之后）');
      assert(exitIdx > writeIdx, 'placeholder 写完之后才退出（先落证据再退）');
      assert(
        execBlock.indexOf(execFail!) > execGate && execBlock.indexOf(execFail!) + execFail!.length < execAbility,
        '主路径：`!gate.ok` 分支须整体位于门之后、resolveMainAbilityForBundle 之前',
      );

      // ③ derive-only：不碰设备 → 不起门
      const deriveBlock = slice('if (isDeriveOnly) {', 'process.exit(0);');
      assert(
        !deriveBlock.includes('applyPhaseEntryDeviceGate('),
        'derive-only 不碰设备，MUST NOT 起门（起了就是白解锁一台手机）',
      );

      // ④ 目标只在门之后读：顶层不得再有先于门的 HARNESS_HDC_TARGET 读取
      const firstGate = source.indexOf('await applyPhaseEntryDeviceGate(');
      const firstDeviceSn = source.indexOf('const deviceSn = process.env.HARNESS_HDC_TARGET');
      assert(firstGate > 0 && firstDeviceSn > 0, '两个锚点都须存在');
      assert(firstDeviceSn > firstGate, '顶层不得在起门之前读 HARNESS_HDC_TARGET（那是 env 恒空的老形态）');
      assert(source.includes("logAdhocPhase('device_gate')"), '须打 ADHOC_PHASE=device_gate 锚点');
    };

    assertWiring(src);

    // 负例：内存中删掉两个 `!gate.ok` 分支后本断言体必须失败（否则它没钉住判定失败退出）
    let stripped = src;
    for (;;) {
      const block = braceBlock(stripped, 'if (!gate.ok) {');
      if (block === null) break;
      stripped = stripped.replace(block, '');
    }
    let negative: Error | null = null;
    try { assertWiring(stripped); } catch (e) { negative = e as Error; }
    assert(negative !== null, '负例失守：删掉 `!gate.ok` 分支后断言仍通过 ⇒ 没钉住"判定失败即退出"');

    // 负例二：只把主路径失败分支里的写盘调用换成 `void (`（参数与 exit 全留），
    // 断言体仍须失败——否则"门失败先落 placeholder"没被钉住，只钉了字面量。
    const execFailSrc = braceBlock(src.slice(src.indexOf("logAdhocPhase('ensure')")), 'if (!gate.ok) {');
    assert(execFailSrc !== null, '负例二取块失败：主路径 `!gate.ok` 分支不存在');
    const noWrite = src.replace(
      execFailSrc!,
      execFailSrc!.replace('writeAdhocTracePlaceholder(', 'void ('),
    );
    assert(noWrite !== src, '负例二未生效：主路径失败分支里没有 writeAdhocTracePlaceholder(');
    let negative2: Error | null = null;
    try { assertWiring(noWrite); } catch (e) { negative2 = e as Error; }
    assert(negative2 !== null, '负例二失守：主路径失败分支不写 placeholder 时断言仍通过');
  });

  await run(results, 'F1 就绪门复用既有 HDC 路径解析：配了 HARNESS_HDC_EXE 就不得裸跑 `hdc`', async () => {
    // 事故形态：deps 的唯一 hdc 调用点写死 `spawnSync('hdc', …)`，PATH 无 hdc 但配了绝对
    // 路径的宿主（Cursor / CI 子进程常见）会被门误判"目标离线"。全程注入，零真机。
    const fsMod = await import('fs');
    const osMod = await import('os');
    const pathMod = await import('path');
    /* eslint-disable @typescript-eslint/no-require-imports */
    const cp = require('child_process') as typeof import('child_process');
    const hdcRunner = require('../../../profiles/hmos-app/harness/hdc-runner') as
      typeof import('../../../profiles/hmos-app/harness/hdc-runner');
    const deps = require('../../scripts/utils/device-readiness-deps') as
      typeof import('../../scripts/utils/device-readiness-deps');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const tmpDir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'maison-hdc-exe-'));
    const fakeExe = pathMod.join(tmpDir, 'hdc-fake.exe');
    fsMod.writeFileSync(fakeExe, '');
    const realSpawnSync = cp.spawnSync;
    const prevEnv: Record<string, string | undefined> = {
      HARNESS_HDC_EXE: process.env.HARNESS_HDC_EXE,
      HDC_EXE: process.env.HDC_EXE,
      HARNESS_HDC_TARGET: process.env.HARNESS_HDC_TARGET,
    };
    const spawned: string[] = [];
    try {
      process.env.HARNESS_HDC_EXE = fakeExe;
      delete process.env.HDC_EXE;
      delete process.env.HARNESS_HDC_TARGET;
      hdcRunner.resetHdcExecutableCache();
      // 换掉 child_process 模块对象上的 spawnSync：解析器的 `list targets` 探针与就绪门的
      // 实际调用都经它（commonjs 下两侧都是属性访问），一处拦截即覆盖两者
      (cp as unknown as { spawnSync: unknown }).spawnSync = (file: string) => {
        spawned.push(String(file));
        return { pid: 0, output: [], stdout: '[Empty]', stderr: '', status: 0, signal: null };
      };
      assertEq(deps.listHdcTargets().length, 0, '桩回 [Empty] → 无目标（判据一字未改）');
      deps.wakeDevice('dev-1');
    } finally {
      (cp as unknown as { spawnSync: unknown }).spawnSync = realSpawnSync;
      for (const k of Object.keys(prevEnv)) {
        const v = prevEnv[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      hdcRunner.resetHdcExecutableCache();
      fsMod.rmSync(tmpDir, { recursive: true, force: true });
    }
    assert(spawned.length >= 2, `探针与 wake 都须真的 spawn（实得 ${spawned.length}）`);
    assert(
      spawned.every(f => f === fakeExe),
      `就绪门须用解析出的可执行路径，不得回落裸 hdc：${JSON.stringify(spawned)}`,
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

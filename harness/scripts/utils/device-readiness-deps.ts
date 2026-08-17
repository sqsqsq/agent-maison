// ============================================================================
// device-readiness-deps.ts — 就绪门与真实设备/模拟器的接缝
//                            （openspec device-readiness-and-completion t3）
// ----------------------------------------------------------------------------
// 与 device-readiness-gate.ts 分离的原因：gate 是**纯决策**（可完全单测，不碰进程与
// 设备），本文件是**副作用实现**（hdc 探测、模拟器托管启动）。混在一起会让 gate 的
// 三态语义无法脱离真实设备验证。
//
// profile 相关性：hdc / DevEco Emulator 是 hmos-app 的形态。当前实现按该 profile 直连；
// 其它 profile 未声明 device_capabilities 时 gate 根本不会执行（见 phase-device-requirement），
// 因此这里不做多 profile 分派——等真有第二个需设备的 profile 时再抽 provider。
// ============================================================================

import { spawnSync, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadLocalConfig } from './framework-local-config';
import {
  defaultProcessProbe,
  reclaimManagedDevice,
  spawnManagedDevice,
  type ManagedProcessIdentity,
} from './device-session';
import { boundedSyncWait } from './bounded-sync-wait';
import {
  ensureUnlocked,
  type KeypadKey,
  type LockScreenSnapshot,
  type RevealOutcome,
  type ScreenBounds,
  type UnlockDeps,
} from './device-unlock-helper';
import {
  evaluateDeviceReadinessProbe,
  type DeviceReadinessDeps,
  type DeviceReadinessInput,
  type DeviceReadinessProbeResult,
  type EmulatorFallback,
  type ReadinessProbeName,
} from './device-readiness-gate';
import {
  canAttemptUnlock,
  parseCredentialRef,
  windowsCredentialProvider,
} from './device-credential-store';

/** 设备侧探测/操作的统一超时——任何一条都不得成为新的无限等待 */
const HDC_PROBE_TIMEOUT_MS = 10_000;

/**
 * 设备命令的**结构化执行事实**（脱敏）。
 *
 * a4e7c2f9 t1：此前只回 `{ok,out}`，失败**原因**被整个丢弃。代价见宿主 run
 * 20260817T065727Z-1896c1：reveal 被 5s 超时 SIGTERM 砍断这一事实在证据链上完全
 * 不存在，下游只能拿"reveal 之后仍是时钟页"的快照去分类，必然误判成
 * `layout_unsupported`（"须真机校准"）——而真机布局其实完全正确，一个字都不用改。
 *
 * **刻意不含 `error.message`**：Node 的超时 message 形如
 * `spawnSync D:\Program Files\nodejs\node.exe ETIMEDOUT`，携带本机绝对路径。
 * 只投影枚举化的 `errorCode`；`out` 之外不引入任何新的设备/主机内容。
 */
export interface HdcExecFact {
  /** 判据与本改造前**完全一致**（`!error && status===0`），不放宽 */
  ok: boolean;
  out: string;
  /** 被信号终止时为 null（超时即属此列） */
  status: number | null;
  signal: string | null;
  /** spawnSync 的 timeout 到期：`error.code==='ETIMEDOUT'`，实测伴随 `signal:'SIGTERM'` */
  timedOut: boolean;
  /** 枚举化错误码（ETIMEDOUT / ENOENT …）；无 error 时 null */
  errorCode: string | null;
}

/**
 * 纯投影：spawnSync 结果 → 执行事实。
 *
 * 单独提取是为了让单测**驱动生产判据本身**，而不是另写一份等价逻辑跑绿
 * （同类惯例见 hdc-runner.ts 的 `isHdcListTargetsProbeOk`）。
 */
export function projectHdcExecFact(
  r: Pick<SpawnSyncReturns<string>, 'stdout' | 'stderr' | 'status' | 'signal' | 'error'>,
): HdcExecFact {
  const errorCode = (r.error as NodeJS.ErrnoException | undefined)?.code ?? null;
  return {
    ok: !r.error && r.status === 0,
    out: `${r.stdout ?? ''}\n${r.stderr ?? ''}`,
    status: r.status ?? null,
    signal: r.signal ?? null,
    timedOut: errorCode === 'ETIMEDOUT',
    errorCode,
  };
}

function runHdc(args: string[], timeoutMs = HDC_PROBE_TIMEOUT_MS): HdcExecFact {
  return projectHdcExecFact(
    spawnSync('hdc', args, { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true }),
  );
}

/** `hdc list targets`；`[Empty]` 与空输出都视为无设备 */
export function listHdcTargets(): string[] {
  const { ok, out } = runHdc(['list', 'targets']);
  if (!ok) return [];
  const raw = out.trim();
  if (!raw || /^\[?Empty\]?$/i.test(raw)) return [];
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !/^\[/.test(s));
}

/** 非秘密唤醒——只点亮屏幕，不涉及任何凭据；息屏时 UI tree 不完整，缺它必然判不出锁屏 */
export function wakeDevice(serial: string): void {
  runHdc(['-t', serial, 'shell', 'power-shell', 'wakeup'], 5_000);
}

/** 模拟器 serial 形态（DevEco 模拟器走本地回环端口）——用于既有实例的正面识别 */
export function knownEmulatorSerialsFrom(targets: readonly string[]): string[] {
  return targets.filter(s => /^127\.0\.0\.1:\d+$/.test(s));
}

/**
 * 真机正面证据：`hdc -t <serial> shell param get const.product.model` 等属性组合。
 *
 * **诚实边界**：具体属性组合须随真机 spike 校准（见 plan a7f2e5d1 / design.md）。
 * 在校准完成前，本函数只在**能明确读到非模拟器机型标识**时返回 true，其余一律
 * undefined —— 宁可 target_kind=unknown（testing 封顶 PARTIAL），也绝不反向推断为真机。
 */
export function attestPhysicalDevice(serial: string): boolean | undefined {
  if (/^127\.0\.0\.1:\d+$/.test(serial)) return false;

  const props = readDeviceProps(serial, [
    'const.product.model',
    'const.product.brand',
    'const.build.characteristics',
    'ohos.boot.hardware',
  ]);
  if (!props) return undefined;

  const model = props['const.product.model'] ?? '';
  const brand = props['const.product.brand'] ?? '';
  const characteristics = props['const.build.characteristics'] ?? '';
  const hardware = props['ohos.boot.hardware'] ?? '';

  // ① 明确的模拟器标识 → 确定不是真机
  if (/emulator|simulator|sdk|goldfish|ranchu/i.test(`${model} ${hardware} ${characteristics}`)) {
    return false;
  }

  // ② **正面证据**：真机必须同时具备可读机型 + 可读品牌 + 非模拟器硬件标识。
  //    三者齐备才判 physical——缺任一项一律 undefined（→ target_kind=unknown → testing
  //    封顶 PARTIAL）。宁可漏判也绝不反向推断"不是模拟器所以是真机"。
  const hasModel = model.length > 0 && !/unknown/i.test(model);
  const hasBrand = brand.length > 0 && !/unknown/i.test(brand);
  const hasHardware = hardware.length > 0 && !/unknown/i.test(hardware);
  if (hasModel && hasBrand && hasHardware) return true;

  return undefined;
}

/**
 * 批量读设备属性。任一读取失败 → 返回 null（**不猜**，上游据此判 unknown）。
 *
 * **待真机校准**：属性键集合按 OpenHarmony 通用命名选取，目标机型上的实际可读性
 * 需随宿主回归验证；若某键在目标 HarmonyOS 版本不存在，本函数会因该键为空而
 * 返回 undefined（保守方向，不会误判成真机）。
 */
function readDeviceProps(serial: string, keys: readonly string[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const r = runHdc(['-t', serial, 'shell', 'param', 'get', key], 5_000);
    if (!r.ok) return null;
    out[key] = r.out.trim().split(/\r?\n/)[0]?.trim() ?? '';
  }
  return out;
}

/** DevEco 模拟器可执行文件（由个人配置的 installPath 推导；未配置 → null） */
export function resolveEmulatorExecutable(projectRoot: string): string | null {
  const local = loadLocalConfig(projectRoot);
  const installPath = local?.toolchain?.devEcoStudio?.installPath?.trim();
  if (!installPath) return null;
  const exe = path.join(installPath, 'tools', 'emulator', 'Emulator.exe');
  return fs.existsSync(exe) ? exe : null;
}

/** 托管启动模拟器：detached + stdio ignore（见 device-session.spawnManagedDevice 的红线注释） */
export async function launchManagedEmulator(
  projectRoot: string,
  profileName: string,
  bootBudgetMs?: number,
): Promise<{ ok: boolean; serial?: string; identity?: ManagedProcessIdentity; note: string }> {
  const exe = resolveEmulatorExecutable(projectRoot);
  if (!exe) return { ok: false, note: '未找到 DevEco Emulator.exe（检查 framework.local.json 的 installPath）' };
  const before = new Set(listHdcTargets());
  const spawned = await spawnManagedDevice(exe, ['-start', profileName], profileName);
  if (!spawned.ok || !spawned.identity) {
    return { ok: false, note: `启动失败：${spawned.error ?? 'unknown'}` };
  }
  // R9：**不得在 spawn 返回后立即取 serial**——模拟器要几十秒才在 hdc 里出现，
  // 立即取必然为空，gate 会在进入 awaitEmulatorReady 之前就判 BLOCKED：模拟器已经
  // 起来了却报失败，而且 identity 没进 session，进程再也回收不掉。
  // 正确做法是把 before 集合与 identity 一起交给有界 boot 等待，在预算内发现新增 serial。
  const budget = bootBudgetMs ?? DEFAULT_EMULATOR_BOOT_BUDGET_MS;
  const serial = await awaitNewEmulatorSerial(before, budget, 3_000, spawned.identity.pid);
  if (!serial) {
    return {
      ok: false,
      identity: spawned.identity, // **仍回传 identity**，否则这个已启动的进程无法回收
      note: `已启动 ${profileName}（pid=${spawned.identity.pid}）但 ${budget}ms 内未在 hdc 中出现`,
    };
  }
  return {
    ok: true,
    serial,
    identity: spawned.identity,
    note: `已托管启动 ${profileName}（pid=${spawned.identity.pid}，serial=${serial}）`,
  };
}

const DEFAULT_EMULATOR_BOOT_BUDGET_MS = 180_000;

/**
 * 有界轮询发现本次启动的模拟器 serial。
 *
 * **P0-4**：只判"before 集合之外的新 target"是不够的——启动后的整个 boot 窗口里，
 * 用户随时可能插上真机、或另一个 run 的模拟器刚好起来，那些都会被当成"本 run 的
 * 模拟器"，进而被写进 session、被当作 emulator 分类、甚至在收尾时被回收（关掉别人
 * 的设备）。
 *
 * **P1（三轮 review）**：前两条只证明"它是某个新模拟器"，没证明"它是**我们这次**
 * 启动的那个"。两个 feature/run 并发启动模拟器时，双方都会看到对方的新回环 target。
 * 故补第三条：该端口的监听进程必须在**本次 spawn 的进程树**内。
 *
 * 三条**同时**满足才认领：
 *   ① 是模拟器形态（本地回环 `127.0.0.1:<port>`——真机 serial 绝不长这样）；
 *   ② 通过 `attestPhysicalDevice` 明确判定为"非真机"；
 *   ③ 端口归属可追溯到本次 spawn 的 pid（进程树祖先链）。
 * 任一条不满足就继续等，等不到就失败——宁可不用模拟器，也不动别人的设备。
 */
async function awaitNewEmulatorSerial(
  before: ReadonlySet<string>,
  budgetMs: number,
  sleepMs = 3_000,
  ownerPid?: number,
): Promise<string | null> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const fresh = listHdcTargets().filter(s => !before.has(s));
    for (const candidate of fresh) {
      // ① 形态过滤：真机 serial 不是回环地址
      const m = /^127\.0\.0\.1:(\d+)$/.exec(candidate);
      if (!m) continue;
      // ② 正面确认非真机（attest 返回 false = 确定是模拟器）
      if (attestPhysicalDevice(candidate) !== false) continue;
      // ③ 归属确认：端口的监听进程须在本次 spawn 的进程树内
      if (ownerPid !== undefined && !portBelongsToProcessTree(Number(m[1]), ownerPid)) continue;
      return candidate;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await sleep(Math.min(sleepMs, remaining));
  }
}

/**
 * 该本地端口的监听进程是否在 `rootPid` 的进程树内。
 *
 * 判不出一律返回 false（**保守**）：认领别人的模拟器意味着后续可能把它关掉，
 * 代价远大于"这次降级失败、让人来处理"。
 */
export function portBelongsToProcessTree(port: number, rootPid: number): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const owner = listeningPidForPort(port);
    if (owner === null) return false;
    // 沿父链向上找 rootPid；链长有界，父进程已退出则链断 → false
    const parents = parentProcessMap();
    let cur: number | undefined = owner;
    for (let hops = 0; cur !== undefined && hops < 16; hops++) {
      if (cur === rootPid) return true;
      cur = parents.get(cur);
      if (cur === 0 || cur === undefined) return false;
    }
    return false;
  } catch {
    return false;
  }
}

function listeningPidForPort(port: number): number | null {
  const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], {
    encoding: 'utf-8',
    timeout: 15_000,
    windowsHide: true,
  });
  if (r.error || !r.stdout) return null;
  for (const line of r.stdout.split(/\r?\n/)) {
    // 例：  TCP    127.0.0.1:5555    0.0.0.0:0    LISTENING    12345
    const m = new RegExp(`^\\s*TCP\\s+127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`).exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

function parentProcessMap(): Map<number, number> {
  const out = new Map<number, number>();
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1}" -f $_.ProcessId, $_.ParentProcessId }',
    ],
    { encoding: 'utf-8', timeout: 20_000, windowsHide: true },
  );
  if (r.error || !r.stdout) return out;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(\d+)\s+(\d+)$/.exec(line.trim());
    if (m) out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}

/**
 * 有界等待模拟器就绪：轮询新目标出现且非锁屏。
 * **有界是硬要求**——就绪门自己绝不能变成新的无限等待（那正是本 change 要根治的病）。
 */
export async function awaitEmulatorReady(
  serial: string,
  budgetMs: number,
  sleepMs = 3_000,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (listHdcTargets().includes(serial)) {
      const locked = probeScreenLocked(serial);
      if (locked === false) return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(sleepMs, remaining));
  }
  return false;
}

/**
 * 异步睡眠（R16）。
 *
 * 此前用 `Atomics.wait` 同步阻塞：模拟器 boot 最长 180s 期间，runner 的 heartbeat、
 * 信号处理、其它 timer **全部停摆**——一个号称"异步"的设备门却把整个事件循环冻住。
 * 改为 Promise + setTimeout；调用链（ensureDeviceReady / runDeviceReadinessGate /
 * runner 调用点）一并 Promise 化。
 */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 解锁链的**唯一**生产接线（e5d8a2c4 T3#3）。
 *
 * 为什么必须只有一处：解锁 deps 此前在两个地方各拼一份——门这边（本文件
 * `buildDeviceReadinessInput`）和运行期恢复那边（`profiles/hmos-app/harness/
 * device-recovery-bridge.ts`）。两份都"看起来一样"，但 settle 只在其中一处被讨论过，
 * 另一处连字段都没写；而 `settle` 当时是可选字段，于是缺的那份**静默零等待**。
 * 这就是本纲要反复在治的形态：同一语义两处各写一遍 → 漂移 → 谁也没报错。
 *
 * settle 的机制选型与 R16 的关系见 `bounded-sync-wait.ts` 文件头（那里是权威说明）：
 * 长/无界等待（模拟器 boot、readiness 轮询）仍恒为 async；这里补的是**有硬上限的
 * 短观察间隔**——固定 `SETTLE_INTERVAL_MS`、最多 `MAX_RESAMPLES` 次。
 *（早先这里写"差额多数为 0，dump 耗时已计入间隔"，那套差额计时已随第四批删除。）
 */
export function buildUnlockDeps(): UnlockDeps {
  return {
    snapshot: readLockScreenSnapshot,
    wake: wakeDevice,
    reveal: revealLockKeypad,
    tap: tapAt,
    settle: boundedSyncWait,
  };
}

// 诚实边界：不同 HarmonyOS 版本的锁屏组件树结构不同，下面的节点匹配需随真机校准。
// 识别不足 10 键时上层零输入——宁可不解锁，也绝不乱点。

/** 锁屏根、认证子树和 PIN 容器均使用现场 UI dump 已证实的稳定 id。 */
const LOCK_ROOT_PATTERN = /ScreenLockRootComponent/i;
const AUTH_ROOT_PATTERN = /BouncerView/i;
const PIN_CONTAINER_ID = 'Digital_PSD_Input_Tip';

/**
 * **单次取样**：一次 dumpLayout 同时给出锁屏判定、锁屏子树内的键位、冷却期标识（P0-2）。
 *
 * 此前 `probeScreenLocked` 与 `readLockKeypad` 各 dump 一次，两次之间界面可能已经从
 * 锁屏跳到别处；若那个界面也有 0–9（应用支付密码框等），PIN 就会被逐位敲进该应用。
 * 现在键位只从**被判定为锁屏的那棵树**的锁屏根组件子树里取，非锁屏时恒为空。
 */
export function readLockScreenSnapshot(serial: string): LockScreenSnapshot {
  const unavailable = (): LockScreenSnapshot => ({
    locked: undefined,
    keypad: [],
    cooldown: { state: 'ambiguous', ruleId: 'snapshot_unavailable' },
  });
  const raw = dumpLayoutJson(serial);
  if (raw === null) return unavailable();
  let tree: unknown;
  try {
    tree = JSON.parse(raw);
  } catch {
    return unavailable();
  }
  return parseLockScreenTree(tree);
}

/** UI dump 的纯解析入口，供脱敏 fixture 单测复用。 */
export function parseLockScreenTree(tree: unknown): LockScreenSnapshot {
  const lockRoot = findLockRoot(tree);
  if (!lockRoot) {
    return { locked: false, keypad: [], cooldown: { state: 'not_cooldown', ruleId: 'not_locked' } };
  }
  const lockBounds = boundsOf(lockRoot);
  const kp = collectDigitKeysWithDiag(lockRoot);
  return {
    locked: true,
    keypad: kp.keys,
    keypadDiag: kp.diag,
    cooldown: classifyCooldown(lockRoot),
    ...(lockBounds ? { lockBounds } : {}),
  };
}

/** 兼容既有调用面：只要锁屏判定 */
export function probeScreenLocked(serial: string): boolean | undefined {
  return readLockScreenSnapshot(serial).locked;
}

function dumpLayoutJson(serial: string): string | null {
  const dump = runHdc(['-t', serial, 'shell', 'uitest', 'dumpLayout']);
  if (!dump.ok) return null;
  const m = dump.out.match(/layout_(\d+)\.json/);
  if (!m) return null;
  const cat = runHdc(['-t', serial, 'shell', 'cat', `/data/local/tmp/layout_${m[1]}.json`]);
  if (!cat.ok || !cat.out.trim()) return null;
  return cat.out;
}

function nodeAttrs(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  return (n.attributes ?? n) as Record<string, unknown>;
}

function childrenOf(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const out: unknown[] = [];
  for (const key of ['children', 'childNodes']) {
    const kids = n[key];
    if (Array.isArray(kids)) out.push(...kids);
  }
  return out;
}

/** 找到锁屏根组件节点；不存在 → null（= 当前不是锁屏界面） */
function findLockRoot(node: unknown): unknown | null {
  const attrs = nodeAttrs(node);
  if (attrs) {
    const id = `${String(attrs.type ?? '')} ${String(attrs.id ?? '')} ${String(attrs.key ?? '')}`;
    if (LOCK_ROOT_PATTERN.test(id)) return node;
  }
  for (const kid of childrenOf(node)) {
    const hit = findLockRoot(kid);
    if (hit) return hit;
  }
  return null;
}

/** 按稳定 id 找第一个节点；只用于锁屏根内的认证/PIN 容器。 */
function findNode(node: unknown, predicate: (attrs: Record<string, unknown>) => boolean): unknown | null {
  const attrs = nodeAttrs(node);
  if (attrs && predicate(attrs)) return node;
  for (const kid of childrenOf(node)) {
    const hit = findNode(kid, predicate);
    if (hit) return hit;
  }
  return null;
}

function boundsOf(node: unknown): ScreenBounds | null {
  const attrs = nodeAttrs(node);
  const m = String(attrs?.bounds ?? '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!m) return null;
  const out = { left: Number(m[1]), top: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]) };
  return out.right > out.left && out.bottom > out.top ? out : null;
}

function visibleText(node: unknown): string[] {
  const out: string[] = [];
  const visit = (current: unknown): void => {
    const attrs = nodeAttrs(current);
    if (attrs) {
      const identity = `${attrs.id ?? ''} ${attrs.type ?? ''} ${attrs.key ?? ''}`;
      // 某些版本把通知挂进锁屏认证区域；仍须显式剪掉整棵通知子树。
      if (/notification/i.test(identity)) return;
      const hidden = attrs.visible === false || String(attrs.visible ?? '').toLowerCase() === 'false' ||
        String(attrs.opacity ?? '') === '0';
      if (!hidden) {
        for (const key of ['originalText', 'text']) {
          const value = typeof attrs[key] === 'string' ? String(attrs[key]).trim() : '';
          if (value && !out.includes(value)) out.push(value);
        }
      }
    }
    childrenOf(current).forEach(visit);
  };
  visit(node);
  return out;
}

/** 冷却判定只看 Bouncer 认证子树，返回稳定 rule_id，永不返回命中文案。 */
export function classifyCooldown(lockRoot: unknown): LockScreenSnapshot['cooldown'] {
  const authRoot = findNode(lockRoot, attrs => AUTH_ROOT_PATTERN.test(`${attrs.id ?? ''} ${attrs.type ?? ''} ${attrs.key ?? ''}`));
  if (!authRoot) return { state: 'not_cooldown', ruleId: 'auth_text_absent' };
  const texts = visibleText(authRoot).filter(text =>
    !/^未识别成功[，,].*(?:点击|双击).*(?:重试)/.test(text),
  );
  if (texts.some(text => /(?:\d+\s*(?:秒|分钟|小时)后.*(?:重试|再试)|try again in\s+\d+|temporarily disabled|设备已停用|device\s+(?:is\s+)?disabled)/i.test(text))) {
    return { state: 'cooldown', ruleId: 'auth_cooldown_explicit' };
  }
  if (texts.some(text => /重试|retry|disabled|停用/i.test(text))) {
    return { state: 'ambiguous', ruleId: 'auth_cooldown_ambiguous' };
  }
  return { state: 'not_cooldown', ruleId: 'auth_no_cooldown_signal' };
}

/**
 * e5d8a2c4 T3#1：键位识别失败的**结构化归因**。
 *
 * 此前五种截然不同的原因全部返回空数组，上层塌缩成一句
 * `keypad_incomplete_after_reveal（零输入）`——2026-08-05 宿主实况：agent 只能列
 * 「AOD/表盘/通知遮挡、非数字 PIN 盘、截图时机」猜一遍，maison 侧也无从复查
 * （dump 用完即弃）。两类原因的处置**完全不同**：容器没找到=布局不认识，须真机校准，
 * 重试无意义；容器在但键不全=动画/遮挡，settle 后重取样很可能就好。
 *
 * 只产**非敏感结构化事实**（容器在否 / 识别到几个 / 何种校验不过），
 * **不含任何 UI 原文**。
 *
 * 原始 dump **用完即弃、从不落盘**（本模块无任何写盘路径）。a4e7c2f9 t6：此处早先
 * 写的是"原始 dump 仅在显式校准旗标下另行落盘"——**那个旗标从未实现**，是一句失实
 * 描述，已按实际行为更正。刻意维持不落盘：原始锁屏树含通知与 UI 文本，属隐私面，
 * 且根因诊断不依赖它；将来若确需采集，应另做显式、脱敏、用户触发的校准能力，
 * 而不是在运行期悄悄留存。
 */
export type KeypadDiagReason =
  | 'ok'
  /** 容器 id 未命中——OS 版本或锁屏布局变了，须真机校准 */
  | 'pin_container_not_found'
  /** 容器在但数字不足 10——动画未完成 / 被遮挡 */
  | 'digits_incomplete'
  /** 同一数字重复出现，或数字节点无 bounds——树结构异常 */
  | 'digit_invalid'
  /** 数字齐但 3×3 几何校验不过——非标准 PIN 盘 */
  | 'geometry_insane'
  /** 有节点因 visible=false / opacity=0 被跳过——通常是过渡态 */
  | 'keys_hidden';

export interface KeypadDiag {
  reason: KeypadDiagReason;
  /** 识别到的合法数字个数（0–10） */
  found: number;
  /** 是否发现 PIN 容器 */
  containerFound: boolean;
  /** 是否有节点因 hidden 被跳过（区分「没渲染」与「渲染了但隐藏」） */
  hiddenSkipped: boolean;
}

/** 只在 Digital_PSD_Input_Tip 内收集 0–9；重复、缺失或几何异常一律不返回键位（带归因）。 */
export function collectDigitKeysWithDiag(lockRoot: unknown): {
  keys: Array<{ digit: string; x: number; y: number }>;
  diag: KeypadDiag;
} {
  const container = findNode(lockRoot, attrs => String(attrs.id ?? '') === PIN_CONTAINER_ID);
  if (!container) {
    return { keys: [], diag: { reason: 'pin_container_not_found', found: 0, containerFound: false, hiddenSkipped: false } };
  }
  const found = new Map<string, { digit: string; x: number; y: number }>();
  let invalid = false;
  let hiddenSkipped = false;
  const visit = (node: unknown, inheritedBounds: ScreenBounds | null): void => {
    const attrs = nodeAttrs(node);
    if (attrs) {
      const hidden = attrs.visible === false || String(attrs.visible ?? '').toLowerCase() === 'false' ||
        String(attrs.opacity ?? '') === '0';
      if (hidden) { hiddenSkipped = true; return; }
      const ownBounds = boundsOf(node);
      const effectiveBounds = ownBounds ?? inheritedBounds;
      const original = String(attrs.originalText ?? '').trim();
      const fallback = String(attrs.text ?? '').trim();
      const digit = original || fallback;
      if (/^\d$/.test(digit)) {
        if (!effectiveBounds || found.has(digit)) invalid = true;
        else found.set(digit, {
          digit,
          x: Math.round((effectiveBounds.left + effectiveBounds.right) / 2),
          y: Math.round((effectiveBounds.top + effectiveBounds.bottom) / 2),
        });
      }
      childrenOf(node).forEach(kid => visit(kid, effectiveBounds));
      return;
    }
    childrenOf(node).forEach(kid => visit(kid, inheritedBounds));
  };
  visit(container, boundsOf(container));
  const keys = [...found.values()];
  const base = { found: keys.length, containerFound: true, hiddenSkipped };
  if (invalid) return { keys: [], diag: { reason: 'digit_invalid', ...base } };
  if (keys.length !== 10 || !'0123456789'.split('').every(d => found.has(d))) {
    // hidden 跳过导致的不全单独归类——它更像过渡态而非布局不支持
    return { keys: [], diag: { reason: hiddenSkipped ? 'keys_hidden' : 'digits_incomplete', ...base } };
  }
  if (!keypadGeometryIsSane(found)) return { keys: [], diag: { reason: 'geometry_insane', ...base } };
  return { keys, diag: { reason: 'ok', ...base } };
}

/** 既有调用面兼容（只要键位、不要归因）。 */
export function collectDigitKeys(lockRoot: unknown): Array<{ digit: string; x: number; y: number }> {
  return collectDigitKeysWithDiag(lockRoot).keys;
}

function keypadGeometryIsSane(keys: ReadonlyMap<string, KeypadKey>): boolean {
  const rows = ['123', '456', '789'].map(ds => [...ds].map(d => keys.get(d)!));
  const xValues = rows.flat().map(k => k.x).sort((a, b) => a - b);
  const yValues = rows.flat().map(k => k.y).sort((a, b) => a - b);
  const xSpan = xValues[xValues.length - 1] - xValues[0];
  const ySpan = yValues[yValues.length - 1] - yValues[0];
  const rowTolerance = Math.max(6, ySpan * 0.12);
  const colTolerance = Math.max(6, xSpan * 0.12);
  for (const row of rows) {
    if (!(row[0].x < row[1].x && row[1].x < row[2].x)) return false;
    if (Math.max(...row.map(k => k.y)) - Math.min(...row.map(k => k.y)) > rowTolerance) return false;
  }
  if (!(rows[0][0].y < rows[1][0].y && rows[1][0].y < rows[2][0].y)) return false;
  for (let col = 0; col < 3; col++) {
    const xs = rows.map(row => row[col].x);
    if (Math.max(...xs) - Math.min(...xs) > colTolerance) return false;
  }
  const zero = keys.get('0')!;
  return zero.y > Math.max(...rows[2].map(k => k.y)) && Math.abs(zero.x - rows[0][1].x) <= colTolerance;
}

/** 设备端 `uitest uiInput swipe` 第 5 参数的合法域（见 `uitest uiInput help`，默认 600）。 */
export const UITEST_VELOCITY_RANGE = { min: 200, max: 40_000 } as const;

/** reveal 超时下限——低于此值即便手势本身合法也没有完成余量。 */
export const REVEAL_TIMEOUT_FLOOR_MS = 5_000;

/**
 * reveal 手势的**操作策略**：velocity 与 timeout **必须同处定义**（a4e7c2f9 t2）。
 *
 * 事故原型：二者此前是分散在同一函数里的两个独立字面量（velocity=300、timeout=5_000），
 * 从未被核对是否相容。该机 lockBounds 高 2003px ⇒ 按 0.78→0.32 滑 921px，真机实测
 * 需 5.2s，稳定超过 5s 超时 → spawnSync SIGTERM 砍断 → 页面停在时钟页 → 被误判成
 * `layout_unsupported`。
 *
 * **为什么不按 distance/velocity 精算 timeout**：理论值 921/300≈3.07s，比 5s 超时还"宽裕"
 * ——也就是说任何基于理论时长的相容性校验都会给这个坏组合放行，实测却是 5.2s
 * （差 1.7 倍，真实耗时含进程启动与通信开销）。同类"把偶然耗时当保证"的错误在
 * e5d8a2c4 T3#3「dump 耗时即间隔」上已犯过一次并作废。
 * 故这里取**实测有大余量的固定组合**：1500px/s 实测 1153ms，对 10s 超时余量约 8.7 倍。
 * 参数是否真的相容，由真机验收证明（plan t8），不由单测的算术断言证明。
 */
export const REVEAL_GESTURE_POLICY = {
  velocityPxPerSecond: 1500,
  timeoutMs: 10_000,
} as const;

/**
 * 展示 PIN 键盘的非秘密上滑；全部坐标从当前锁屏 bounds 相对推导。
 *
 * 返回执行事实（a4e7c2f9 t3）：此前返回 `void`，底层 runHdc 的 ok 被整个丢弃，
 * 于是"命令被超时砍断"在证据链上不存在。调用方 `ensureUnlocked` 必须消费它。
 */
export function revealLockKeypad(
  serial: string,
  bounds: ScreenBounds,
  /**
   * 执行器注入点——**缺省即生产实现**，仅供单测观察"这次到底用了什么 velocity /
   * 什么 timeout"，从而对准生产函数验证策略同源，而不是用源码正则去猜
   *（源码正则会把错实现一起锁死，属既有教训）。
   *
   * 与 `settle` 那个反例的区别：那里的可选缺省是 **no-op**（fail-open 静默回到坏行为），
   * 这里的缺省是**正确行为本身**，注入只改变观察方式、不改变语义。
   */
  exec: (args: string[], timeoutMs: number) => HdcExecFact = runHdc,
): RevealOutcome {
  const r = exec(buildRevealSwipeArgs(serial, bounds), REVEAL_GESTURE_POLICY.timeoutMs);
  // errorCode 必须一并带出：漏掉它，ENOENT（hdc 缺失/设备掉线）就会退化成
  // `exec_failed + signal=none status=none`，诊断归零。
  return { ok: r.ok, timedOut: r.timedOut, signal: r.signal, status: r.status, errorCode: r.errorCode };
}

/** reveal 手势的 argv（纯函数，供单测直接驱动；**velocity 只在此处取自策略**）。 */
export function buildRevealSwipeArgs(serial: string, bounds: ScreenBounds): string[] {
  const x = Math.round((bounds.left + bounds.right) / 2);
  const fromY = Math.round(bounds.top + (bounds.bottom - bounds.top) * 0.78);
  const toY = Math.round(bounds.top + (bounds.bottom - bounds.top) * 0.32);
  return [
    '-t', serial, 'shell', 'uitest', 'uiInput', 'swipe',
    String(x), String(fromY), String(x), String(toY),
    String(REVEAL_GESTURE_POLICY.velocityPxPerSecond),
  ];
}
/** 坐标点击——argv 只出现数字坐标，**不出现 PIN 字符** */
export function tapAt(serial: string, x: number, y: number): void {
  runHdc(['-t', serial, 'shell', 'uitest', 'uiInput', 'click', String(x), String(y)], 5_000);
}

/** 从个人配置读模拟器降级策略；未配置 → disabled（默认关闭，不擅自弹 GUI） */
export function resolveEmulatorFallback(projectRoot: string): EmulatorFallback {
  const local = loadLocalConfig(projectRoot) as { device?: { emulator_fallback?: string } } | null;
  const mode = local?.device?.emulator_fallback;
  return mode === 'existing' || mode === 'managed' ? mode : 'disabled';
}

/** 从个人配置读目标 serial（多设备时必须显式指定） */
export function resolveConfiguredSerial(projectRoot: string): string | null {
  const local = loadLocalConfig(projectRoot) as { device?: { target_serial?: string } } | null;
  const s = local?.device?.target_serial?.trim();
  return s ? s : null;
}

/** 托管启动用的模拟器 profile（AVD 名，如 "Pura 90"）；未配置 → null（managed 档不可用） */
export function resolveEmulatorProfile(projectRoot: string): string | null {
  const local = loadLocalConfig(projectRoot) as { device?: { emulator_profile?: string } } | null;
  const p = local?.device?.emulator_profile?.trim();
  return p ? p : null;
}

/** 组装 gate 输入（runner 调用面） */
/** 已登记且启用自动解锁时返回 credential_ref；否则 null（= 未授权，gate 不提供解锁能力） */
export function resolveUnlockCredentialRef(projectRoot: string): string | null {
  const local = loadLocalConfig(projectRoot) as {
    device?: { unlock?: { mode?: string; credential_ref?: string } };
  } | null;
  const unlock = local?.device?.unlock;
  if (unlock?.mode !== 'credential') return null;
  const ref = unlock.credential_ref?.trim();
  return ref ? ref : null;
}

/**
 * 运行期恢复该用哪个 credential_ref（P1，三轮 review）。
 *
 * 此前四处恢复点都写成 `frozenRef || resolveUnlockCredentialRef(projectRoot)`：
 * 一个以 manual 模式启动的 attempt，运行中有人改了配置就能**静默获得自动解锁权**，
 * attempt 冻结约束被绕过。
 *
 * 判据：gate 跑过就一定注入 `MAISON_DEVICE_ATTEMPT_FROZEN=1`。
 *   - 已冻结 + 有 ref  → 用这个 ref（不重读配置）
 *   - 已冻结 + 无 ref  → 本 attempt 明确**未授权**，返回 null，绝不回落
 *   - 未冻结（普通模式，没有 gate）→ 按当前配置解析，与 goal 模式能力保持一致
 */
export function resolveAttemptCredentialRef(projectRoot: string): string | null {
  const frozen = process.env.MAISON_DEVICE_CREDENTIAL_REF?.trim();
  if (frozen) return frozen;
  if (process.env.MAISON_DEVICE_ATTEMPT_FROZEN === '1') return null;
  return resolveUnlockCredentialRef(projectRoot);
}

export function buildDeviceReadinessInput(projectRoot: string): DeviceReadinessInput {
  const emulatorProfile = resolveEmulatorProfile(projectRoot);
  const unlockRef = resolveUnlockCredentialRef(projectRoot);
  const deps: DeviceReadinessDeps = {
    listTargets: listHdcTargets,
    isLocked: probeScreenLocked,
    snapshot: readLockScreenSnapshot,
    wake: wakeDevice,
    knownEmulatorSerials: () => knownEmulatorSerialsFrom(listHdcTargets()),
    attestPhysical: attestPhysicalDevice,
    // 未配置 emulator_profile 时**不提供**托管能力——gate 会明确报"本 profile 未提供
    // 模拟器托管能力"，而不是拿一个猜出来的 AVD 名去启动别的模拟器。
    // boot 总预算分两段：launch 内最多 120s 等 serial 在 hdc 中出现，
    // 随后 gate 的 awaitEmulatorReady 再等它解锁就绪。两段都有界。
    ...(emulatorProfile
      ? { launchManagedEmulator: () => launchManagedEmulator(projectRoot, emulatorProfile, 120_000) }
      : {}),
    awaitEmulatorReady: (serial, budgetMs) => awaitEmulatorReady(serial, budgetMs),
    // P1（三轮 review）：旧托管实例不可用时，gate 会先用它回收再新建；
    // 回收不确认就 BLOCKED（单文件 session 一旦被覆盖，旧 pid 四元组就永久丢失）。
    reclaimManaged: identity => {
      const out = reclaimManagedDevice(
        {
          schema_version: '1.0',
          serial: null,
          target_kind: 'emulator',
          started_by_run: 'reclaim-before-relaunch',
          managed: identity,
          status: 'ready',
          updated_at: new Date().toISOString(),
        },
        defaultProcessProbe(),
      );
      // 三态映射（四轮 review）：`none` = 进程本就不在了（最常见的情况——旧实例
      // 自然退出），那是**没有遗留**，不是回收失败。此前一律当失败，于是明明可以
      // 安全新建却永久 BLOCKED。只有 refused 才是真的"不敢动"。
      if (out.action === 'reclaimed') return 'reclaimed';
      if (out.action === 'none') return 'already_absent';
      return 'refused';
    },
    // t6：凭据解锁能力——**仅当用户已登记凭据时才提供**。未登记 = 未授权，此项为
    // undefined，gate 便绝不尝试任何密码输入（结构上不存在"猜"的路径）。
    //
    // 该能力必须挂在 gate 上（而非只在运行期 wrapper）：否则"启动时已锁屏 → BLOCKED
    // → agent 不启动 → 运行期 wrapper 永无机会执行"就是死锁，而用户的真实场景恰恰
    // 是"锁屏了没注意"。
    ...(unlockRef
      ? {
          unlockWithCredential: (serial: string) => {
            const r = ensureUnlocked({
              serial,
              credentialRef: unlockRef,
              deps: buildUnlockDeps(),
            });
            // e5d8a2c4 T3#2：**结构化类别原样传递**（codex P1）——此前只回 ok/note，
            // 到 readiness result / device_unlock_attempt / phase_halt 就只剩文案，
            // 下游要按类别行动只能解析字符串或**再分类一次**（=第二份分类表）。
            // a4e7c2f9：reveal 执行事实同理随行，否则 errorCode 到事件层又只剩文案。
            return r.ok
              ? { ok: true, note: r.note }
              : {
                  ok: false,
                  note: r.note,
                  failureKind: r.failureKind,
                  ...(r.revealFact ? { revealFact: r.revealFact } : {}),
                };
          },
        }
      : {}),
  };
  return {
    configuredSerial: resolveConfiguredSerial(projectRoot),
    credentialRef: unlockRef,
    emulatorFallback: resolveEmulatorFallback(projectRoot),
    deps,
  };
}

function credentialIsReady(ref: string | null, serial?: string): boolean {
  const id = ref ? parseCredentialRef(ref) : null;
  if (!id || (serial && id.serial !== serial)) return false;
  return canAttemptUnlock(id, windowsCredentialProvider()).ok;
}

/**
 * Read-only condition probe consumed by goal-supervise. It never wakes, unlocks,
 * launches, or writes a device/session record.
 */
export function probeDeviceReadiness(
  projectRoot: string,
  probe: ReadinessProbeName = 'device_readiness',
): DeviceReadinessProbeResult {
  const input = buildDeviceReadinessInput(projectRoot);
  const targets = input.deps.listTargets().map(s => s.trim()).filter(Boolean);
  const configured = input.configuredSerial?.trim();
  const selectedSerial =
    configured && targets.includes(configured)
      ? configured
      : !configured && targets.length === 1
        ? targets[0]
        : undefined;
  const snapshot =
    probe === 'credential_state_ready' || !selectedSerial
      ? undefined
      : (input.deps.snapshot?.(selectedSerial) ?? {
          locked: input.deps.isLocked(selectedSerial),
          keypad: [],
          cooldown: { state: 'ambiguous' as const, ruleId: 'snapshot_unavailable' },
        });
  return evaluateDeviceReadinessProbe(
    {
      configuredSerial: configured,
      targets,
      snapshot,
      credentialReady: credentialIsReady(input.credentialRef ?? null, selectedSerial),
    },
    probe,
  );
}

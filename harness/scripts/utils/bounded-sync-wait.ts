// ============================================================================
// bounded-sync-wait.ts — 设备链路上**唯一**允许的同步等待原语（e5d8a2c4 T3#3）
// ----------------------------------------------------------------------------
// 为什么需要它，以及它与 R16 的关系（必须一起读，否则下一个人只会看到"绕过门禁"）：
//
// R16 的**真实规则**是「**无界 / 长时**的纯等待必须异步」。它写下来的场景是模拟器
// boot：最长 180s，期间**没有任何设备命令在跑**，纯粹在等；同步阻塞会让 runner 的
// heartbeat、信号处理、其它 timer 全部停摆——supervisor 会把一个活着的 run 判成死的。
// 那条规则完全正确，本模块不动它：`ensureDeviceReady` / `runDeviceReadinessGate` /
// `awaitEmulatorReady` 仍恒为 async，boot 等待仍走 Promise+setTimeout。
//
// R16 **写宽了**的地方：它的字面表述是"设备门链路不得同步阻塞事件循环"，而设备链路
// 本来就通篇是同步阻塞的 `spawnSync`——
//   · `readLockScreenSnapshot` 每次 dumpLayout 数百 ms（解锁流程里要跑好几次）；
//   · `providers/device-test-run.ts` 的 hdc 调用 `timeout: 120_000`；
//   · UT / hypium 的整轮执行以分钟计。
// 也就是说，同一条路径上早就有比"400ms settle"大两个数量级的同步阻塞，且是设计使然
// （provider 契约是同步的，一路同步到 `checkDeviceTestRunGate` 这个同步 check 门）。
// 在这种链路上禁止 400ms 的同步等待、却放行 120s 的同步 spawnSync，规则就不是在保护
// 活性，而是在挑机制——这正是本纲要要根治的"框架给自己造问题"。
//
// 于是规则被**说准**（而不是放宽），并且加了字面表述里没有的硬约束：
//   ① 纯等待**必须有硬上限**，且上限由本模块强制（超限直接抛，不是"建议"）；
//   ② 设备链路里**只有本函数**可以同步等待，`Atomics.wait` 的直接调用仍全域禁止
//      （见 device-readiness-gate.unit.test.ts 的 R16 用例）；
//   ③ 长/无界等待（boot、readiness 轮询）仍**必须** async，行为用例照旧钉住
//      "等待期间其它 timer 仍在跑"。
//
// 为什么用 `Atomics.wait` 而不是 `spawnSync('sleep')`：后者同样阻塞事件循环，还要多付
// 一次进程创建（Windows 上尤其贵），并且引入一个跨平台不存在的外部依赖。busy-spin
// （`while (Date.now() < end) {}`）则会把一个核吃满。`Atomics.wait` 是三者里唯一
// 既不烧 CPU、又不依赖外部进程的选择；Node 主线程允许调用（浏览器才禁止）。
// ============================================================================

/**
 * 单次同步等待的硬上限。
 *
 * 定这个数的依据不是"感觉够用"，而是**与它同处一条链路的既有阻塞相比可忽略**：
 * 相邻的一次 `hdc uitest dumpLayout` 就是数百 ms 量级。超过 1s 的纯等待说明调用方
 * 想做的其实是"轮询等待某个外部条件"——那属于 R16 的正牌管辖范围，必须异步。
 */
export const MAX_SYNC_WAIT_MS = 1_000;

/** 复用同一块 SAB：等待不修改它的值，故可安全共享（永远等不到 notify，只靠超时返回）。 */
const WAIT_SLOT = new Int32Array(new SharedArrayBuffer(4));

/**
 * 有界同步等待。
 *
 * @param ms 期望等待的毫秒数。`<= 0` 即刻返回（调用方常传"补足到间隔的剩余量"，
 *           剩余量为负是正常情况，不是错误）。
 * @throws 当 `ms > MAX_SYNC_WAIT_MS` —— **故意不 clamp**：静默截断会让调用方以为
 *         自己拿到了请求的间隔，从而把"其实没等够"变成一个查不出来的行为差异。
 *         宁可当场炸，也不要产出一个看起来对的错结果。
 */
export function boundedSyncWait(ms: number): void {
  // 非有限值（NaN / ±Infinity）**先抛**（codex 四批 P3）：此前它与"负数/0"一起静默
  // 返回，等于给"越界必须抛、绝不静默处理"的契约开了个洞——`Infinity` 是所有可能
  // 输入里最该炸的那个，却恰好走了最安静的分支。
  if (!Number.isFinite(ms)) {
    throw new Error(`[bounded-sync-wait] 同步等待时长必须是有限数值，实得 ${String(ms)}`);
  }
  if (ms <= 0) return;
  if (ms > MAX_SYNC_WAIT_MS) {
    throw new Error(
      `[bounded-sync-wait] 请求同步等待 ${ms}ms，超过硬上限 ${MAX_SYNC_WAIT_MS}ms——` +
      '这么长的纯等待必须改为异步（R16：无界/长时等待不得冻结事件循环）',
    );
  }
  // 第三个参数是"期望值"：与当前值相同才会真的进入等待。槽位恒为 0 且无人 notify，
  // 因此这里必然走到超时返回，等价于一次精确的同步 sleep。
  Atomics.wait(WAIT_SLOT, 0, 0, ms);
}

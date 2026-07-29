# device-readiness-and-completion — 设备就绪门与阶段完成判定

## Why

2026-07-28 宿主 bc-openCard run（`20260728T031459Z-e19c6b`）一次中断暴露五处缺口，实证链见 plan `a7f2e5d1`：

1. **锁屏被当代码问题重试**：`classifyFailure` 对 device_locked 走 `toolchain:false` 默认分支，到 `goal-failure-classifier` 兜底为 `code_regression`（须改码、可重试）。而框架**早有** `externalBlocked`/`device_blocked` → `external_block` 的完整设备阻断契约，只是没接上。
2. **无设备就绪门**：agent 遇锁屏自行处置，对用户真机执行 **10 组常见 PIN 的字典枚举**（自建 `Enter-Pin` + `Is-Locked` 检测循环），致设备锁定。framework 只教检测不教解锁，枚举属 agent 自发行为。
3. **模拟器由 agent 自发拉起且挂在 agent 进程树**：`Emulator.exe -start "Pura 90"` 作为 cursor 后台终端常驻，钉住 cursor-agent 进程不退出——这是 85 分钟假运行的直接死因。
4. **完成证据在盘却空等 84 分钟**：agent 已 `turn_ended status=success`、receipt 四条件齐全，但进程不退出；框架只能等满 90 分钟 hard timeout。超时后 gate harness **13 秒**即判 PASS 并 advance——证明判据一直可用。
5. **声明校验过晚**：`architecture.outer_layers` 声明的 `03-CommonBusiness` 不存在，跑满 2.7 小时才在 testing pre-invoke fail-closed HALT。

责任定性：**cursor/agent 触发异常，framework 未及时阻断、正确分类与完成收口，异常被放大。**

## What Changes

- **t1 设备阻断分类接线**：锁屏产出 `blocking_class='externalBlocked'` + `failure_kind='device_blocked'`，goal 侧复用既有 `external_block`，不进内容 retry；精确原因只留 blocker `details_excerpt`/HDC diagnosis（`summary.schema.json` 为 `additionalProperties:false`，不扩协议面）；混合场景（模块 A 锁屏 / 模块 B 用例真实失败）不得整体 defer。
- **t2 模拟器框架托管**：runner 起停、detached 独立进程组、不进 agent 进程树；`device-session.json` 记四元组+serial+`started_by_run`；`target_kind` 正面分类（`physical` 须有正面证据路径，禁"不是模拟器故为真机"反向推断）；testing + `emulator|unknown` 时结论由 runner 封顶为 PARTIAL/DEFERRED。
- **t3 设备就绪门**：新增异步 `runDeviceReadinessGate`（**不复用** `runInvokeCapabilityGate` 的同步函数与固定 FAIL 语义），排在 capability gate 之后、`agent_invoke_start` 之前，执行范围由 `requires_device` 派生；三态 READY/BLOCKED(`external_block`)/AMBIGUOUS(HALTED)；未 READY 不产生 `agent_invoke_start`。
- **t4 invocation 内完成观测**：observer 挂 agent 等待期（与 settle/timeout/silent race），判据=纯只读 receipt validator + 本 attempt 新鲜度跃迁；分层——通用进程层只管 timer/race/kill，由 goal-runner 注入 `completionProbe` + 绝对 `deadlineMs`；独立原因码 `completion_observed`。
- **t5 outer_layers 条件前移**：仅 chain 含 testing 时早检，时点=run/manifest 创建后、**整个 run 第一个 phase agent invocation 之前**；失败写 `phase_halt` + `run_end=HALTED`。
- **t6 凭据授权与运行期解锁**：授权入口接既有 registry（`setup.device_policy`，主 agent 在起 detached runner 前询问）；Windows Credential Manager 托管，凭据身份**不可变绑定**；机器级失败锁存状态机 `ready|in_flight|disabled` + 跨进程 mutex + durable commit；`disabled` 仅可由新 `credential_version` 解除。

显式非目标：逐用例设备能力矩阵（`emulator_ok`/`physical_required`）；通用命令沙箱；静默/turns 冻结类概率监控；对抗同用户恶意任意代码。

## Capabilities

### Modified Capabilities

- `goal-runner`：设备就绪门、invocation 内完成观测、outer_layers 条件前移、设备阻断分类归入 `external_block`、模拟器会话生命周期。
- `harness-gates`：device_locked 的 `externalBlocked`/`device_blocked` 产出与混合场景语义、testing 模拟器结论封顶。
- `framework-local-config`：`device` 策略 schema（`unlock.mode` / `credential_ref` / `emulator_fallback` / `target_serial`）与迁移。

## Dependencies & Non-overlap

| 既有 change | 关系 |
|-------------|------|
| `capability-gap-preflight` | **复用其 invoke-gate 位置与语义**（"缺口不产生 `agent_invoke_start`、不烧轮次、resume 重检"）。设备就绪门是**相邻的独立门**，排在其后；**不改**其判定面、不新增其能力码，其"四个运行后 failure_kind 永不属于本通道"的边界条款保持不变。 |
| `goal-timeout-hardwall-hardening` | **并存不覆盖**。90 分钟 per-phase hard timeout 保留为兜底；本 change 只在完成证据确定性成立时提前收口，收口记 `completion_observed`，**不改**超时语义、不复用 `timed_out` 标记。 |
| `confirmation-credential-issuance`（未落地） | **凭据托管交叉边界**。本 change 的设备解锁凭据走 OS Credential Manager，与该 change 规划的人工确认签发体系**互不依赖、互不实现**；两者共用 `~/.maison` 之外的 OS 密钥库理念，但 target 命名空间独立，落地后若需统一由后续 change 处理。 |

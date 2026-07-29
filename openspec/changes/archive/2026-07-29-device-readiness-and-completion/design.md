# Design — device-readiness-and-completion

设计取舍的完整论证与实证链见 plan `a7f2e5d1`（`.cursor/plans/设备就绪与阶段完成判定_解锁授权与模拟器托管_a7f2e5d1.plan.md`，v9，经九轮外部 review 收敛）。本文只记与既有 spec 交互相关的关键决策。

## 1. 为什么完成观测必须挂在 agent 等待期

`goal-runner.ts` 的 `const invoke = await invokeAgentHeadless(...)` 是阻塞调用，gate harness 在其**之后**。因此任何"harness 前置探针"在进程卡死时永远执行不到。observer 必须进入等待期，与 settle / hard timeout / silent watchdog 竞争。

分层原因：`agent-invoke.ts` 是通用进程层，若让它直接读 receipt schema，等于把 goal 语义漏进通用层。故由 goal-runner 注入 `completionProbe` 回调与绝对 `deadlineMs`。

## 2. 为什么判据只取确定性信号

`DEFAULT_SILENT_WATCHDOG_MS = 0` 的既有注释写明 "cursor-agent often streams little until phase end"——静默/输出冻结/turns 不涨都是概率信号，会误杀正常长任务。而本次事故中 receipt 四条件早已成立（超时后 gate 13 秒即判 PASS），确定性判据完全够用。故显式不引入概率监控。

新鲜度绑 attempt 的必要性：只看 run_id 会把 retry 遗留的旧证据误判为本次完成。

## 3. 为什么就绪门不能复用 capability gate

`runInvokeCapabilityGate` 是同步函数、只调静态 `runCapabilityPreflight`、缺口固定产出 `verdict='FAIL'` + `await_human_capability_gap`。设备就绪需要异步副作用（模拟器 boot 等待、解锁、复验），且设备不可用应走 `external_block` defer 契约而非静态 capability FAIL。故复用**位置与语义模式**，不复用函数。

## 4. 为什么是结构性阻断而非行为禁令

`skills/reference/agents-entry-detail.md` 明写「AGENTS.md 全文未禁止主 agent 调用 shell/执行命令；空白处一律按"允许"理解」。framework 无法技术性阻止 agent 用绝对路径调 hdc/Emulator.exe，故"禁止猜密码"只能是指导。真正有效的是：未取得 READY 就不产生 `agent_invoke_start`，agent 根本不进入"发现锁屏后自行处置"的场景。

保证边界须逐条说准：

| 层级 | 内容 |
|------|------|
| 强保证 | framework 管理的解锁路径绝不猜密码；密码不入 transcript/argv/env/日志；启动前无授权且锁定则不启动 agent |
| 防御性指导 | 运行期靠 prompt 要求走 framework wrapper |
| 不宣称 | 无 OS 沙箱时硬阻断恶意或偏航 agent 的直接 shell 操作 |

## 5. 为什么锁存必须是机器级

goal 级锁存有两条绕过路径：新建 goal 看不到旧 goal 的 events；并发 wrapper 各自账本都显示"尚未失败"→ 同时输入 PIN。故状态机 `ready|in_flight|disabled` 必须托管在跨进程可见处（OS 凭据库）并配跨进程 mutex。

这是场外状态红线（`AGENTS.md`「新增任何场外状态类型须先证明 in-repo 方案做不到」）的合法例外，论证：该状态须跨 run/feature/项目/并发进程协调，而 repo 内 run 产物按 feature 与 run 分区、结构上互不可见；且与口令同由 OS 凭据库托管，不新增明文秘密面。

goal events/journal 保留为审计投影，**不参与放行判定**——放行只读 CM 状态。

## 6. 为什么 write-ahead 与 durable commit 不可省

既有 `appendEvent` 与 intermediate-rounds journal 都是裸 `appendFileSync`，无 fsync、无互斥，不足以支撑"断电/崩溃安全"的宣称。若只在拿到 outcome 后记账，存在崩溃窗口：输入 PIN → 密码错误 → 写 outcome 前崩溃 → resume 看不到失败 → 再输一次，直接复现锁机风险。

故 `in_flight` 必须在输入第一个数字前 durable commit；无终态记录一律保守判失败并锁存。取舍：成功但终态丢失也会被误锁存——误锁存的代价是人解锁一次，误重试的代价是设备被锁死，不对称，必须偏保守。

## 7. 为什么 `disabled` 不能同版本复位

锁存语义是「这个密码是错的」，所以必须换密码才能继续，而非重置计数器。若允许 `disabled(v1) → ready(v1)`，用户反复运行恢复 CLI 即可反复重试同一错误 PIN，机器级锁存被架空。唯一出路是重新登记生成新 `credential_version`。

## 8. 为什么模拟器 testing 只能 PARTIAL

逐用例设备能力矩阵（NFC/安全芯片/生物识别等）是独立的大工程，本 change 不做。但没有能力判定规则时，runner 无法判断"哪些项真机不可替代"，此时让模拟器结果整体 PASS 即是假绿。故采用 phase 级保守规则：ut 可 PASS，testing 封顶 PARTIAL/DEFERRED。

用户已确认接受该收窄（2026-07-28，原话：默认就应该真机跑，模拟器是无奈的降级之举）。

`target_kind` 必须有 `physical` 正面证据路径，否则真机永远停在 `unknown`、testing 永远 PARTIAL，功能等于不可用。

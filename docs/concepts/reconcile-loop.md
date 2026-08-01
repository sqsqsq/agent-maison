# Goal 调和循环

Goal 模式只有一个编排循环：

```text
assess → driver authorize/guard → execute one phase → reassess
```

interactive session 与 detached runner 共用 `assess@1`、manifest、events、progress、phase artifacts 和 `run_id`。它们是同一 run 的不同 driver，不是两套状态机。

## 职责划分

| 组件 | 负责 | 不负责 |
|---|---|---|
| `assess@1` | 从当前事实找 gap；推荐当前、后续或回退 phase；调和熔断 | 授权、进程管理、写入 |
| driver | 授权、预算、timeout/backoff、设备门、write guard、trust、失效事务 | 自建 next-phase 决策表 |
| phase Skill / harness | 产生 phase artifact、summary 1.2、closure/evidence | 决定跨 phase 去向 |
| monitor | 只读活性与通知预算 | 终止或续跑 run |

headless runner 会把进程结果提取为 `ReconcileObservation@1`，其中包含 phase outcome、blocker actionability、可信确定性缺陷、已用预算、重复指纹、可失效 phase 以及 timeout/interrupt/API 信号。Assess 消费这份版本化观察；runner 再执行已有的授权与安全事务。

## 用户运行模式

用户只看到：

- **有人在场**：自动推进，human-only 项立即询问；
- **无人值守**：自动推进，human-only 项写为等待项并安全停放。

明确意图不重复询问；歧义使用 `confirmation-registry.yaml > goal.run_mode`。`--detach` 恒为无人值守。`in-session`、`headless` 和 capability tier 是内部路由词，不进入用户菜单。

每个 in-session phase 必须在新鲜、phase-scoped 的隔离上下文中执行，只回传结构化 outcome/evidence。adapter 未声明隔离能力时，降级为手动 harness + assess。

## 单写者与 fencing

run 目录中的 `run-control.json` 是 `run-control@1` 权威：

- `current_epoch` 单调递增，owner 释放后也不重置；
- process owner 用 PID/heartbeat，session owner 用 lease；
- 每次 assess、phase invoke、harness/finalizer、event/progress/manifest 写入和终态发布前，都核验 `(run_id, owner_id, epoch)`；
- session lease 过期只标 orphan，不自动授权新 owner；接管必须由协作 handoff 或显式 force takeover 完成。

feature/run lock 是当前 owner 的投影，不拥有 epoch。

## Handoff

非 owner 只能原子写 mailbox request，不能写权威事件。当前 owner 只在完整 phase verdict 边界消费请求：

1. 校验 run、epoch、目标和有效期；
2. owner 写 `handoff_requested`；
3. quiesce 并释放投影；
4. 新 owner 以 `epoch+1` CAS 接管；
5. 新 owner 在任何 phase 前写 `handoff_accepted`。

请求重复、过期、错 run 或错 epoch 都被拒绝。handoff 期间不复制 ledger，也不创建新 run。

## 三种熔断不要混用

- assess fuse：调和层无进展/重复状态，在 phase 边界停止推荐；
- driver guard：timeout、预算、trust、设备和写入安全；
- monitor fuse：结束本轮只读轮询，不杀 active run。

这三个边界互不替代。

## 能力解析与调和

每个 phase 的 checker 之前会生成一份不可变 `CapabilityResolutionReport`。`assess@1` 只读取 summary 1.2 已持久化的 `assurance`、`capability_resolutions` 与 closure/evidence 新鲜度，不会重新解析 artifact 或擅自选择 fallback。这样 session 与 detached driver 对同一磁盘事实得到相同 recommendation。

`minimum_assurance` 是 goal 的可选稀疏约束，仅把低于 `degraded`/`full` 的实际保证等级转换为 `insufficient_assurance`。它不授予 runner 执行权限，也不能覆盖 quality axis、release 或 PASS closure。已授权的 `pruned` 会作为 assess 的 `observed.degradations` 透出；`blocked` 由既有非 PASS/closure 路径处理。仅当 artifact attempt 的上游 producer 同时报告 `pruned`，并使下游 core capability (`on_missing: fail`) 被阻塞时，调和器额外生成 `pruned` gap，建议先回补 producer。
# goal-host-replay-fixes — Design Notes

## 范围纪律（v21 收口裁决，设计前提）

本 change 的威胁模型**冻结**为「防正常框架流程误混写」：dry-run 与真实 run 的物理隔离靠**目录名**（`goal-runs/.dry/` 保留子树），不建 identity ledger/project index/跨文件事务/OS mutex/epoch 退役等安全基建（v9-v20 方案已整体撤销，决策记录见 plan e7c2a4d8）。同用户恶意进程伪造 workspace、PID 复用误判窗口均显式出范围；更强安全边界（HMAC/broker/sandbox、receipt 签发）属独立 change。

## 关键决策

1. **preflight 血缘口径**：抽 `computeRequirementShaFromText`（parts 组装体单一实现），`computeRunRequirementSha` 变薄读盘 wrapper——两口径逐字节同构，closure 记录与 preflight 重算比对语义不变。不移动 `writeGoalManifest` 时序（拒启 run 不留半成品 manifest）。
2. **dry 隔离形态**：`.dry/<run_id>` 子树（run_id 不变）优于 `<run_id>-dry` 后缀派生——canonical `report_dir` 契约只加 dry 分支，无身份换算；`run_id` 校验拒绝 `.` 前缀与分隔符，保留名天然无冲突。feature 串行锁**继续共享**（同 feature 串行是设计目标）；per-run lock/orphan/progress 一律按 `manifest.report_dir` 改址，legacy lock（无 `run_mode`）以 events 会话三态判别（仅 dry→不提示 resume；有 authoritative→保持既有指引；无法判断→busy 人工，不猜）。
3. **trust 零触碰**：dry 跳过整段 vision trust 启动链与 `commitVisionAnchors`（宿主实证：ut2test dry 段曾写 `vision_ledger_anchor`）；manifest drift 比对以 absent 基线走「无基线」分支（不读真实 run checkpoint）；`--override-adapter --dry-run` 不写回 `framework.local.json`。验收=trust 文件逐字节不变。
4. **活跃预算**：`partitionExecutionSessions` 是唯一分段真值（run_start 每进程无条件追加已实证）；崩溃段补收 `min(下一段首, 段尾事件+心跳周期)`——误差方向翻转为多计 ≤1 心跳/段（预算只会更快耗尽，累计漏算为零）；`nextSessionStartMs` 只作最后未闭合历史段上界，当前段由 `elapsed = priorActiveMs + (now − sessionStart)` 承载。sinceMs 消费面用 `firstAuthoritativeStartMs`（真实时间线，绝不喂合成时间）。
5. **裁决闭环**：classifier 冻结保持——preauth 只绑文件/kind/数量不绑内容，放行即重开「业务改码伪装 seam」旁路；唯一自动路径=human receipt 携 `adjudicated_drift_fingerprint`（op+canonical path+sha256 稳定排序+domain separation）与当前 drift 逐项吻合。fingerprint 入 v2 签名范围（签发后改写即失配）；v1 旧签名不留 verifier。回退仅全链（chain 含 coding+review）；截断链裁决有效也转「新起 coding 链」（`chain.indexOf('coding')=-1` 时回退只会到 chain[0]，实测不闭环）。签发路（`MUTATION_RECEIPT_ISSUANCE_ROUTE_AVAILABLE`）本窗口恒 false——guidance 不承诺走不通的路。
6. **双账本对齐**：goal 环境 check-ut 与 runner 共享同一 drift 判定（review-closure attestation 基线 + `classifySourceDrift`）——coding 期合法改动（run-start diff 全量）不在裁决域；attestation 缺失 goal 环境 fail-closed（专用 blocker，恢复=新起 coding 链，两态路由无证据源已撤销）；非 goal 交互模式维持 trace.start_commit + gap-notes 现语义（诚实边界：自报性质）。
7. **残留二分**：无 manifest 目录中，bootstrap-only（仅 detach.log/lock，be1c48 形态）静默排除走既有孤儿流程、不建清理机制；有 events/progress/phases 者=曾启动被破坏 → `corruptRuns`，helper 不 throw（上层枚举消费者吞异常已实证），四类门禁见之 fail-closed。

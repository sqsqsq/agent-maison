# goal-host-replay-fixes

> Supersession note (2026-08-26): `autonomous-recovery-without-human-gates` retains dry-run, active-budget, event-truth, and mutation fingerprint facts while superseding human mutation adjudication with owner invalidation/backtrack. The three unrelated host replay tasks remain pending.

## Why

2026-07-22 宿主实测回灌（SimulatedWalletForHmos，bc-openCard，adapter=cursor，plan 7c4f2e9b 任务 7.2）确认 spec 五连败根治生效，同时暴露四条新事故链：① 截断链 preflight 读盘鸡生蛋（run be1c48：requirement 血缘从 `goal-runs/<run_id>/manifest.json` 读盘，而 `writeGoalManifest` 在 preflight 之后——新起截断链必 fail-closed；宿主被迫 dry-run 同 run_id 预埋 manifest，导致 dry 与真跑混写同一 `events.jsonl`，dry 段渗入超时棘轮/turns/resume 重建等权威消费面）；② wall-clock 预算按日历跨度计（run 4035d4：活跃仅 ~74m，隔夜 resume 距首 run_start ~772m > 480m 上限，循环首步熔断且 outcome 无 halt_reason——resume 必死、死因不可见）；③ 授权出路全断（`pre_authorized_mutations` 被 `buildGoalManifestFromInput` 静默丢弃；classifier 冻结下 receipt 全合规仍 unauthorized；现行 banner「写 receipt 后 --resume」照做仍 HALT，属过度承诺）叠加双账本分裂（check-ut `ut_no_src_mutation` 采信 agent 自签 gap-notes → harness PASS，runner 三源链拒绝 → phase_halt，fresh-context agent 读到「已批准」复写 seam 死循环）；④ 阶段真值缺口（goal-progress/`rebuildOutcomesFromEvents` 只吃 `phase_verdict`，phase_halt 后面板撕裂、report 缺失时 resume 可把 HALT 重建成 PASS；unauthorized 分支不快照 harness 证据，UT 实测 PASS 呈现为「FAIL / Summary —」）。plan e7c2a4d8（codex×16 轮 + Claude 复审 ×2 轮收敛至 v23；v21 范围收口裁决：威胁模型冻结为「防正常框架流程误混写」，不建 identity ledger/OS 锁等安全数据库）。

## What Changes

- **截断链 preflight 内存口径（goal-runner）**：requirement 血缘改由内存 `manifest.requirement` 经共享组装函数计算（与读盘口径逐字节同构）；requirement 空白仍 BLOCKER。曾启动却缺 manifest 的 corrupt run 在场 → preflight fail-closed。
- **dry-run 保留子目录隔离（goal-runner）**：dry report_dir 固定 `goal-runs/.dry/<run_id>/`（同 run_id、run 级文件零共写、feature 串行锁共享）；dry 事件全量携 `dry_run:true`；dry 零外部 trust mutation（vision checkpoint/head/HWM/reseal/ledger 迁移全跳过，`framework.local.json` 写回与 canary cache 禁写）；`--resume` 拒绝 dry；detach parent 与 main 共用 `resolveRawRunInput`（feature 仅在 manifest 合法、CLI↔manifest 冲突 fail-closed）。
- **权威消费面（goal-runner）**：`loadAuthoritativeEvents`（会话段过滤 dry）扫替全部权威 events 消费点；`listAuthoritativeGoalRuns` 枚举结构性跳过 `.dry` 并对无 manifest 目录二分（bootstrap-only 残留静默走既有孤儿流程；有 events/evidence 无 manifest → corruptRuns，四类门禁 fail-closed）；孤儿锁按 lock 的 `run_mode`/`report_dir` 分流（stale dry 不提示 resume；legacy 记录三态判别不猜）；同机活 pid 永不因 heartbeat 超时被抢占（busy + 人工处置）。
- **活跃时间预算（goal-runner）**：`partitionExecutionSessions` 按 run_start 分段累计活跃时长（崩溃段保守补收一个心跳周期——累计不欠计；dry 段剔除；`nextSessionStartMs` 防 resume 双计）；deadline 硬上界语义不变只换基点；budget halt 全链携 reason+guidance（outcome/phase_halt/run_end/banner），文案只列真实出路（新 manifest 新 run / `--override-manifest`）。
- **授权出路真实化（goal-runner + harness-gates）**：`pre_authorized_mutations` 输入保真（fail-closed 校验；定位=意图预登记，classifier 冻结前不放行）；授权范围签名升版本化 v2（七字段含 `source_inventory_before` 与 `adjudicated_drift_fingerprint`，路径规范化 fail-closed，v1 旧签名=INVALID_SCOPE_VERSION）；classifier 冻结前唯一自动裁决路径=human receipt + 当前 drift fingerprint 精确吻合 → `authorized_backtrack`（仅全链可回退；截断链 → `authorized_mutation_requires_full_chain` halt + 新起 coding 链指引）；halt 落 `mutation-adjudication-request.json`；guidance 按能力真值分层（签发路本窗口恒不可用，不承诺走不通的 receipt-resume）；halt_guidance 附着改「有即附着」。
- **阶段真值（goal-runner + harness-gates）**：goal-progress 与 `rebuildOutcomesFromEvents` 消费 `phase_halt`（覆盖 provisional verdict、halted 门 resume、guidance 保留）；unauthorized 处置前快照 harness 证据（outcome verdict=harness 真值 + halted 轴分离）；goal 环境 `ut_no_src_mutation` 改 review-closure 基线共享判定（coding 合法改动不误伤；自签 gap-notes 不放行；attestation 缺失 → `goal_review_closure_baseline_unavailable` fail-closed 不回退 run-start diff）；两个专用 blocker 注册 human_only 零内容重试；prompt 注入 gap-notes 冲突声明。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: 截断链 preflight 内存血缘、dry-run `.dry` 隔离与 trust 零触碰、权威 events/枚举双消费面、活跃时间预算与 budget halt 可解释、授权裁决 fingerprint 闭环与截断链分流、phase_halt 投影/重建真值。
- `harness-gates`: goal 环境 `ut_no_src_mutation` review-closure 基线共享判定、`goal_post_review_source_mutation_unresolved` / `goal_review_closure_baseline_unavailable` 专用 human_only blocker。

## Impact

- 影响 runtime：`harness/scripts/goal-runner.ts`（preflight/dry 隔离/锁/orphan/预算/授权处置/prompt）、`harness/scripts/utils/goal-manifest.ts`（dry 路径/`resolveRawRunInput`/预授权保真）、`goal-run-lock.ts`（run_mode/report_dir/活 pid 不抢占）、`goal-runner-phase.ts`（分段/预算/authoritative 过滤/phase_halt 重建）、`goal-progress.ts`（phase_halt 投影/锁改址）、`fidelity-shared.ts`（内容级血缘/权威枚举）、`verify-feature-completion.ts`（枚举扫替/corrupt 门禁）、`mutation-authorization.ts`（scope v2/fingerprint/裁决）、`await-confirm-guidance.ts`（budget/mutation guidance builder）、`goal-failure-classifier.ts`（human_only 注册）。
- 影响 harness：`harness/scripts/check-ut.ts`（goal 环境基线分支）。
- 威胁模型边界（v21 冻结）：只防正常框架流程误混写；同用户恶意进程伪造/删除 workspace 或 trust 文件不在范围；PID 复用误判窗口接受；receipt 签发能力属后继 change `confirmation-credential-issuance`。

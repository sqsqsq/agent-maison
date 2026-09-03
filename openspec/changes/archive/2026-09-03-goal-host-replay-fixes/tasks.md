# Tasks — goal-host-replay-fixes

映射 plan e7c2a4d8 v23 的 T1-T5（实施记录见 plan 文末）。

## 1. T1 截断链预检 + dry 隔离 + 枚举 + 锁

- [x] 1.1 `computeRequirementShaFromText` 抽出 + preflight 内存口径（requirement 空白仍 BLOCKER；corrupt run 在场 fail-closed）
- [x] 1.2 dry-run `.dry/<run_id>` 保留子目录（canonical dry 分支、run_id 保留字、事件全量打标、resume 拒绝、`resolveRawRunInput` parent/main 共用）
- [x] 1.3 dry 零外部 trust mutation（vision 启动链/commitVisionAnchors/manifest drift 读、`framework.local.json` 写回全部 `!dryRun` 门）
- [x] 1.4 `loadAuthoritativeEvents` 会话过滤 + goal-runner 权威消费面扫替（13 站点；orphan 分类器/心跳遥测显式豁免注释）
- [x] 1.5 `listAuthoritativeGoalRuns`/`classifyGoalRunsDir` 残留二分 + 四枚举点扫替（intent/血缘/freshness/phase 证据）+ completion/preflight corrupt 门禁
- [x] 1.6 锁：`run_mode`/`report_dir` 字段、per-run lock 按 report_dir、orphan 三态分流（dry 不提示 resume）、同机活 pid 永不抢占 + busy 提示、goal-progress 改址

## 2. T2 活跃预算

- [x] 2.1 `partitionExecutionSessions`（分段/崩溃补收/尾段 cap/dry 剔除/turns/首权威起点）+ `resolveResumedBudget(events, {nextSessionStartMs})`
- [x] 2.2 goal-runner 换基点（elapsed/wallDeadline；sinceMs 保真实时间线）
- [x] 2.3 四条 budget halt 路径 reason+guidance+banner+phase_halt 事件；`finalize_skipped` reason；`buildBudgetExhaustedGuidance`（新 run/`--override-manifest` 两路，无裸重启）

## 3. T3 授权出路

- [x] 3.1 `pre_authorized_mutations` 解析保真（fail-closed；意图预登记定位）
- [x] 3.2 scope hash v2（七字段+版本前缀）、`relPathIssues` 路径规范化、v1 旧签名失效说明
- [x] 3.3 `computeDriftFingerprint`/`computeCurrentDriftFingerprint` + classify 唯一自动裁决路径（human+fingerprint 精确吻合）
- [x] 3.4 runner：全链才回退、截断链 `authorized_mutation_requires_full_chain`、快照前置、`mutation-adjudication-request.json`、`buildUnauthorizedMutationGuidance`（能力分层、issuance 常量 false）、halt_guidance 有即附着
- [x] 3.5 attestation 缺失 goal 环境 fail-closed（`baselineUnavailable` 信号 + `goal_review_closure_baseline_unavailable` halt，coding 起点指引）

## 4. T4 阶段真值

- [x] 4.1 goal-progress `phase_halt` 投影（span HALTED、current phase 固定）
- [x] 4.2 `rebuildOutcomesFromEvents` `phase_halt` 覆盖（guidance 保留；后续 verdict 清除旧 halt）
- [x] 4.3 check-ut goal 环境 review-closure 基线共享判定 + 两专用 blocker（human_only 注册）+ 决策梯短路（reconciliation 门放宽）
- [x] 4.4 prompt gap-notes 冲突注入

## 5. T5 验证

- [x] 5.1 新 unit 套件 `host-replay-fixes`（23 例）注册 CORE_SUITES；既有测试随新契约更新（stale-lock fixture 用死 pid、fingerprint 正负例、completion fixture 落真实 manifest）
- [x] 5.2 全量验证：typecheck 0 / unit 2377/2377 / fixtures 44/44 / openspec validate / git diff --check
- [x] 5.3a 截断链直接新起（**已验** 2026-07-29 run 20260729T123155Z-0c5411）：manifest start_phase=review / end_phase=testing，**无 dry-run 预埋、无同目录混写**，review 1 attempt PASS。
- [x] 5.3b 隔夜 resume 不秒停（**未触达**：本轮无跨停机 resume 场景；2026-07-30 盘点从"已完成"撤回——原勾选自相矛盾（勾完成却注明未触达）。留待下次真实跨夜 run 顺带验证，不单独安排）
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
- [x] 5.3c 测缝诉求走还原或新起 coding 链（**未触达**：本轮 agent 未提出测缝诉求）
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
- [x] 5.3d 自签改码由专用 blocker 拦截零空转（**未触达**：本轮无自签改码发生）
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
- [x] 5.4 实施后 review round2 修复：P0 裁决覆盖独立化（禁与 preauth 拼接）/ lock run_mode·report_dir 落盘 / progress 权威视图+活跃预算口径（.dry 视图保 raw）/ --resume↔manifest.run_id 双道 fail-closed / corruptRuns 传播 check-spec `goal_run_identity_intact` + check-receipt closure / dry invoke·post-harness 窗口零账本读（含 anchor 事件）；新增 4+2 单测
- [x] 5.5 dry trust 字节级仓内回归（round2 终审 P2 验收缺口）：e2e 真实拉起 `goal-runner --dry-run --override-adapter`（consumer 布局临时宿主，framework junction+harness 拷贝），断言项目侧预置文件（vision 账本/checkpoint 种子/config/入口）逐字节不变、新文件仅落 `.dry/<run_id>/`、framework.local.json 不写回、events 全 dry 打标零 vision anchor

## Why

宿主真实回归（SimulatedWalletForHmos bc-openCard，run `20260816T125231Z-4a2d28`）：review-i8 逐条复验确认 3 条真实 MAJOR 产品缺陷（精确行号+可执行修复方案），`conditional_pass_closure` 门禁正确拦截——但 goal 链没有自动回退 coding，assess 连续推荐 `rerun_phase:review` 直到重试耗尽 HALT，最终靠人工 supersede+fresh 才完成"回 coding 修复再级联重跑"。

归因（与 codex 双方核实一致）：assess 决策层与 backtrack 执行链都在，但事实供给断链——`deterministic_defects` 唯一采集器写死 `phase==='testing'`，`invalidatablePhases` 限定 ut/testing（且 ut 因 hasActionable 恒空实际不可达），review 的缺陷表被压缩成一个抽象 blocker id 后细节全丢。全链矩阵：逆向回退仅 testing→coding 与 ui_scope_violation→plan 两条特例通；review→coding、ut→coding、plan→spec 全部不通，check-plan 等文案指路"修 spec"但无路由。

## What Changes

一条通用责任阶段规则（"谁的产物谁修"）替代特例堆，全部复用既有机制：

- **单一真源** `summary.repair_candidates[]`（可选字段，harness 派生非 agent 自报，`summary.schema.json` 已声明）：**assess 直读各 phase summary**，事实不复制进 reconcile observation——goal / manual / batch 三链共用同一事实与同一裁决。review 报告经既有 artifact resolver 读取（canonical `<feature>/review/review-report.md` 与 legacy 均可）。信任合取：结构可信 + verifier 对 open BLOCKER/MAJOR **逐条**验证 confirmed（`issue-verification` fenced 块，`evidence` 须**同时**绑定当前涉及文件与当前问题内容片段——只验文件挡不住「同 CR、同文件、问题已变」的旧轮产物）+ 有效 conditional receipt 抑制 + 负面两分支覆盖。归属复用 `CorrectionCategory`，机器 check id 注册表（`scope_consistency_with_spec`→spec、`device_ac_delegation`→spec、`ui_scope_violation`→plan，即使 affected_files 是产品源码）优先于 affected-files 路径域兜底，且 check 归因优先取 `failure_kind` 而非 details 文本；推导不出不产（宁缺毋滥）。两层指纹：`item_fingerprint`（缺陷身份）+ `round_fingerprint`（排序集合 hash，整轮防震荡）。
- **通用 assess**：candidates 经**当前 workflow/track 严格映射**到实际 phase（`mapCategoryToChainPhase`：映射不到=null=既有 `backtrack_target_absent`，删 chain[0] 静默兜底；lite/custom 不出现幽灵 spec/plan）；多类别选最上游，mixed-owner 整组事实由 `phase_backtrack_requested` 事件承载、prompt 注入按目标阶段过滤、crash/resume 由共享实现恢复且非 repair 回退自动清空。
- **三类 driver 只差授权**：goal 复用既有 backtrack 事务/预算池/指纹熔断（**唯一** `backtrack_to_phase` 执行分支）；manual 渲染确认菜单（`REPAIR_CANDIDATES` 块，绝不擅自跨阶段改文件）；batch 授权区间补下界 `[manifest.start_phase, through_phase]`，区间外转 manual。
- **旧缺陷路由物理收编（本 change 完成，不并存）**：testing 证据链验真器（`collectActionableDefects` 保留）产物合并回同一 `repair_candidates` 字段（写失败或 summary 路径不可用 → `repair_candidates_unwritable` fail-closed halt，不落回任何旧路）；goal-runner 的 `backtrack_to_coding` 执行分支、`ui_scope_violation` 专用 replan 调用点、assess 与 driver 的 `deterministic_defects → backtrack_to_coding` 裁决链、phase-transition-policy 的 testing 专用裁决**全部删除**（`deterministic_defects` 仅留作诊断/指纹投影；源码漂移等其它恢复机制使用的 `backtrack_to_coding` 动作与缺陷路由无关，不在删除范围）。补 UT product assertion→coding 生产点（既有产物合取，无新分类器）。
- **testing→spec 本期不接**（用户裁定）：无机器生产点，不为矩阵齐全造分类器；文档可说明人工返回 spec，不伪装 assess 自动路由。

## Impact

- `harness/scripts/utils/repair-candidates.ts`（新增：事实层 SSOT——指纹/归属/信任合取/四类生产点/失效面推导，以及**生产与测试共用的接线实现** `buildSummaryRepairCandidates`、`restoreBacktrackCandidatesFromEvents`）
- `harness/scripts/utils/types.ts` + `quality-axes.ts` + `harness/schemas/summary.schema.json`（summary 可选字段 + 形状校验 + JSON schema 声明）
- `harness/harness-runner.ts`（summary 落盘前经共享实现组装：artifact resolver 读正式 review 路径 / report_validity 闸 / failure_kind 优先归因）
- `harness/prompts/verify-review.md`（逐条全验 + issue-verification 块的 evidence 双绑定契约）
- `harness/scripts/utils/correction-routing.ts`（`mapCategoryToChainPhase` 严格映射；correction 修正意见路由行为保留）
- `harness/scripts/utils/assess.ts`（直读 phase summary 候选；旧 `deterministic_defects` 裁决分支删除）
- `harness/scripts/utils/goal-reconcile-observation.ts`（候选不进 reconcile，无第二份事实）
- `harness/scripts/utils/phase-transition-policy.ts`（`backtrack_to_phase` action；testing 专用裁决删除）
- `harness/scripts/utils/goal-assess-driver.ts`（earlier 分支泛化；旧 `backtrack_to_coding` fallback 删除）
- `harness/scripts/goal-runner.ts`（观测接线 + 唯一 `backtrack_to_phase` 执行分支 + 按阶段过滤注入 + testing 验真器产物合并回 summary + resume 候选恢复；旧 `backtrack_to_coding` 分支与 `ui_scope_violation` 专用调用点删除）
- `harness/scripts/utils/assess-renderer.ts`（manual `REPAIR_CANDIDATES` 菜单，读 assess 观测）
- `harness/scripts/utils/goal-in-session-driver.ts`（batch 区间下界）
- `harness/scripts/utils/adjudication.ts`（`repair_candidates_unwritable` incident 登记）

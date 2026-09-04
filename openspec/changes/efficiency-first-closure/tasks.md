## 0. OpenSpec（plan 07a41ec6 T0）

- [x] 0.1 建立本 change：proposal / design / tasks + 八个 spec delta，`npm run openspec:validate` strict 通过后再动代码

## 1. correction 硬路径删除（T1）

- [x] 1.1 删除 check-phase-completion.mjs 的 correction 拦截（evaluateCorrectionGate / buildCorrectionBlockReason 与调用分支）
- [x] 1.2 删除 `--correction-check`、touched_layers 对账、correction-layer-reconcile.ts；feature correction 不再写 `.current-correction.json`；adhoc 保留 base_commit 状态
- [x] 1.3 同步 AGENTS.md.template §4.0、runtime-policy.ts / feature-track.ts 引用；单测按新语义改写

## 2. 失败前移、通道三态、判词给改法（T2）

- [x] 2.1 执行通道三态与 gap_reason 机器证明；gap 留分母五数输出；completion_status 投影
- [x] 2.2 STEP-P0-IDENTITY / STEP-BYTEXT-ORDER lint；check-spec checkpoint action 静态检查；scroll/swipe post-state 绑定
- [x] 2.3 BLOCKER suggestion 审计：本次命中的七条门禁（p0_coverage_integrity / hylyre_selector_runtime_gate / visual_diff warn / channel obligation / report_trace_reconciliation / upstream stale / derived-plan freshness）判词已改为 TC/step/形状/改法，p0 与三态有 fixture；未命中的 suggestion 保持原样（后续回灌再改）
- [x] 2.4 Hylyre 已知边界表（profile-addendum、hylyre-planned-step-fields）

## 3. P0 身份断言注入（T3）

- [x] 3.1 run 副本装载时注入，幂等、唯一定位、多候选报 invalid_test、UX 断言保留、源文件不改

## 4. 闭环读 summary，回执退出输入（T4）

- [x] 4.1 finalize 时序：harness PASS → request → verifier → 轻量 finalize；advisory 直接 closure
- [x] 4.2 receipt 退出新闭环输入与 Stop 判据；summary closed 后 best-effort 投影；legacy 隔离兼容；`--sync-closure` 走同一 finalize

## 5. 测试报告机器生成（T5）

- [x] 5.1 test-report-writer.ts：全章节生成、按轴结论、stability 可缺省、report-only 刷新、既有解析器往返一致
- [x] 5.2 review 统计自动回写；引用与计数 lint（WARN）

## 6. 执行键与稳定性（T6）

- [x] 6.1 execution_key 写入 run meta；只复用最新真实 attempt；`--force-device`；TC 行行为字段新鲜度（表外散文忽略）
- [x] 6.2 stability 内部生成并调用 writer 刷新

## 7. verifier 一次化、瘦身、核对化（T7）

- [x] 7.1 pre-verifier material view subject；复用判定进 finalize；`completed_with_prior_review` / `current_material_not_reverified`
- [x] 7.2 assembleAIPrompt 瘦身（≤ 原 50%）；verify-*.md 输出短表；删可读性检查项；SKILL/verifier.md 措辞

## 8. revalidate 与漂移分级（T8）

- [x] 8.1 `--revalidate` 检查执行器；结果标注；FAIL 中断
- [x] 8.2 五类漂移对应复核；review_closure_attestation 与 ut_no_src_mutation 改分级 WARN/归类

## 9. phase executor 与上下文减负（T9）

- [x] 9.1 phase-executor 子代理模板 + adapter 登记；goal-condition / agents-entry-detail / goal-mode SKILL 同步；等待纪律；`NEXT:` 行；记忆纪律

## 10. 视觉量测（T10）

- [x] 10.1 `--measure` 事实产出与三轴状态；defects note 自动填充；无 provider 场景 SKIP；不改 ui-spec、不覆盖 verdict

## 11. 收口（T11）

- [x] 11.1 skills/reference、AGENTS.md.template、goal-mode-operations、MIGRATION.md 同步；保留四条总原则改动
- [x] 11.2 `cd harness && npm test`、typecheck、`npm run openspec:validate`、`npm run release:check-plans`、LF；`npm run release:verify` 在发版时执行
- [ ] 11.3 宿主验证由用户执行并回灌（不由实施代理发起）

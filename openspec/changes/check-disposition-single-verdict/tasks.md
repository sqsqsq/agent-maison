# check-disposition-single-verdict tasks

- [x] t1 处置函数与判定谓词：`harness/scripts/utils/check-disposition.ts` 三条规则（非 FAIL 或非 BLOCKER→none；命中表且保护对象为账本/形状→披露；其余→按声明阻断），`isBlockingCheck` 为其布尔投影；静态守卫（新增字面阻断 id、逐文件动态构造计数、谓词模块外字面 FAIL&&BLOCKER、表项族前缀校验）与生成式基线 `harness/tests/utils/check-disposition-baseline.json`。
- [x] t2 消费者收编：report-generator / quality-axes / summary-blockers / repair-candidates / verifier-plan / correction-commands / check-coding / check-testing / check-ut 改读谓词；聚合运行状态检查（`coding_run_status`、`testing_run_status`）在同源失败已列出时不重复计数，`run_statuses` 保留原事实。
- [x] t3 阶段结论共享：`harness-runner.ts` 的 `resolvePhaseVerdict` 一次算出结论，summary、控制台、合并报告、退出码、closure、phase-state 同读；`summary.disclosed_failures` 与 schema 可选字段；lite closure、correction 已关闭阶段、component closure 证据改读 summary 结论。
- [x] t4 首批分类：`ref_elements_excluded`（结果依据，归当前阶段）与六项账本/形状检查（`context_exploration_searches_min`、`context_exploration_subagents_used`、`context_exploration_facts_schema_version`、`ut_mock_plan_typed`、`it_name_has_ac_or_branch_tag`、`schema_version_present`）入表，每项带依据、后果与边界；`authoritative_content_aligned` 只进确定性门归因表，不入处置表。
- [x] t5 归因与恢复出口：结果依据类与仅聚合失败归 `deterministic_gate_or_artifact_missing`；超时判定按去重前事实；当前阶段属主重跑、上游属主产候选；排除登记的引文在授权时按 `checkRequirementQuote` 验证，需求原文不可得视为不可验证；披露失败计入完成缺口，`designScopeRevisionChecks` 不因披露项作废设计范围。
- [ ] t6 场景重跑与文档同步：`reliability-scenarios` 13 场景新读数写入 registry（历史基线保留）；`harness-runbook.md`、`MIGRATION.md` 同步；本变更 `openspec:validate` 通过。

## 归档顺序

本变更与以下在研变更交叠，须排在它们之后归档：

1. `ut-diagnosis-not-applicable-skips`：同样 MODIFIED harness-gates「A diagnosable product failure still issues a verifier request」。本变更的 MODIFIED 以该变更的版本为底（已含 not-applicable SKIP 例外段与其场景），只追加"阶段结论取共享结论"一句，所以不会抹掉它的例外段；风险在反方向——若本变更先归档、它后归档，它的全文替换会抹掉本变更追加的那一句。因此先归档它，再归档本变更。
2. `goal-brief-correctable-judgement`：其 goal-runner / visual-diff 增量引入"排除元素上的 `unexpected_render` 可修、其他缺陷类排除"的方向拆分；本变更 visual-diff ADDED 需求在此基础上收紧"只有可验证引文的排除才算排除"，语义依赖其先入主规范。
3. `task-continuation-recovery-loop`：MODIFIED harness-gates「Gate internal errors are attributed as framework_bug…」并新增 goal-runner「Failure attribution considers every blocker…」，与本变更 goal-runner MODIFIED「Timeout attribution follows the freshness decision table」无标题重叠，但都描述超时/全 framework_bug 分支；建议先归档它，再核对本变更超时段措辞是否仍一致。
4. `ledger-class-failure-containment`：新增 goal-runner「Ledger-class failures are contained…」（testing 分支账本档不产回退候选），与本变更"账本/形状类披露不阻断"无标题重叠、方向一致；归档顺序无硬约束。

本变更 MODIFIED 的主规范需求：harness-gates「check-receipt reads current-run base summary」「A diagnosable product failure still issues a verifier request」、goal-runner「Timeout attribution follows the freshness decision table」、runtime-policy「Completion status projects gaps and non-reverified verification honestly」。

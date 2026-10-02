# check-disposition-single-verdict

## Why

一个失败检查"挡不挡本阶段通过"过去没有唯一出处：约十八处消费者各自写 `status === 'FAIL' && severity === 'BLOCKER'`，
散在十几张按 id 维护的表里。系统里还并存两个阶段结论——进程退出码、控制台、闭环入口读脚本报告的 legacy 结论，
goal 运行时、回执、完成判定读 summary 的有效结论——已有分裂实例：review 的 `statistics_summary` 是 MAJOR 失败、属于报告合法性，
summary 判 FAIL 而脚本报告判 PASS、退出码为 0。结果依据类检查失败时没有责任方，归因落到"代码回归"，重试提示词要求先回退改动。
账本与形状类检查（自报数字、版本标签、命名形状）与产品真值同档阻断，宿主多次因此停机。（plan f7045213，总纲 272acb5f 的 P4）

## What Changes

- **处置函数与判定谓词**（`harness/scripts/utils/check-disposition.ts`）：去向表只登记去向发生变化的检查（精确 id 或受限的动态族）；
  规则三条按序——非失败或非阻断不阻断；命中表按表（账本与形状披露、其余三类阻断）；其余按检查自己的声明。**没有第四条**：
  运行时认不出的 id 一律按声明处置。开发期静态守卫保证新增的阻断检查先声明保护对象（基线由脚本生成）。
- **消费者收编**：结论、计数、质量轴、阻断清单、外部阻塞判定、修复指引兜底、verifier 资格、ut 候选、adhoc 修正报告、
  coding / testing / ut 的聚合状态统一读谓词；违规钩子、报告合法性、request 入口、compat 降级、范围修订提议保留原生语义。
- **共享结论**：harness-runner 用既有质量格与有效结论函数在内存求值一次；控制台、verifier 资格、合并报告、summary 写入器、
  完整闭环入口门、lite 闭环、phase-state、进程退出码用同一份结果。过去"脚本报告判通过、summary 判失败或未完成"时退出码为 0，现在非零。
- **披露清单与完成缺口**：summary 新增 `disclosed_failures`；条数计入完成缺口，完成标签为 `COMPLETE_WITH_GAPS`，不阻塞完成。
- **聚合去重**：`coding_run_status` / `testing_run_status` 在同一失败已由源检查表达时不进阻断清单、计数与签名；只由关键跳过或文档缺失引起时保留，
  并归为确定性门禁 / 产物缺失。超时决策表的"全部 framework_bug"判定仍把被去重的聚合项算作非框架阻断，原决策不变。
- **首批分类**：`ref_elements_excluded` 登记为结果依据（责任在当前阶段，保持阻断）；六条账本与形状检查改为披露：
  `context_exploration_searches_min`、`context_exploration_subagents_used`、`context_exploration_facts_schema_version`、
  `ut_mock_plan_typed`、`it_name_has_ac_or_branch_tag`、`schema_version_present`。`authoritative_content_aligned` 暂缓登记，
  只经既有确定性门禁表修正归因。
- **归因与恢复出口**：结果依据类失败用确定性门禁归因，重试提示词不含回退指引；责任在当前阶段的走当前阶段修复与重试，不产生回退候选；
  责任在上游（spec / plan / coding）的产生回退候选交既有 assess 路由。归因、受影响文件与责任方读同一份有效映射。
- **授权判定处的引文核验**：排除登记只有 `requirement_quote` 逐字出现在当前需求原文里才按"需求排除"处理；核验不了按已登记 / 未登记处理。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`：处置函数与谓词、共享结论、披露清单、聚合去重、首批分类、范围修订提议的放行范围；
  MODIFIED「check-receipt reads current-run base summary」「A diagnosable product failure still issues a verifier request」。
- `reconcile-assessment`：结果依据类失败按登记责任方路由；lite 闭环读共享结论。
- `goal-runner`：MODIFIED「Timeout attribution follows the freshness decision table」；结果依据类与仅聚合项失败的归因；
  设计 owner 失败的 run 内调和或首次即停，以及预授权的无人值守 B1 修复（plan 9c3d7e1a）。
- `change-unit-continuous-progression`：MODIFIED「Reconciliation re-resolves stable targets without a semantic diff engine」——
  两层锁、运行中调和、取锁段与锁内调和可分开调用；MODIFIED「Design preparation accepts an admitted blueprint with zero change units」
  ——readiness 遇竞争报忙、运行时内的指针调和不是设计准备子流程（plan 9c3d7e1a）。
- `app-component-blueprint`：预授权的无人值守 B1 修复作为合法修订来源（plan 9c3d7e1a）。
- `visual-diff`：排除登记在返修授权处核引文。
- `runtime-policy`：MODIFIED「Completion status projects gaps and non-reverified verification honestly」（被披露的失败计入缺口）。

## Impact

- 运行时：`check-disposition.ts`（新）、`report-generator.ts`、`quality-axes.ts`、`summary-blockers.ts`、`repair-candidates.ts`、
  `verifier-plan.ts`、`correction-commands.ts`、`check-{coding,testing,ut}.ts`、`goal-failure-classifier.ts`、`harness-runner.ts`、
  `assess.ts`、`component-closure-evidence.ts`、`blueprint-skill-projection.ts`、`goal-report-generator.ts`、`types.ts`、
  `summary.schema.json`、`profiles/hmos-app/harness/visual-diff-check.ts`。
- 消费者可见：退出码语义、summary 新字段、六个检查的去向、排除登记的引文要求——见 `MIGRATION.md` 3.1.0 同名条目。
- 不改任何检查本身的判定逻辑，不放宽产品真值，不动完成判定的十五项条件与逐义务缺口分类，不新建评分、豁免或签字机制。

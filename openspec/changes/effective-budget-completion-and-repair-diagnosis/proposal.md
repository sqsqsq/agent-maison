## Why

2026-10-06/07 开卡宿主第三轮（基线 98434b6f，首次 `CHAIN_SLICE_COMPLETED`）的只读取证显示：授权过的预算调整不能一次生效（后继整份继承合同来源的旧预算，出现一次零调用的预算耗尽启动）；仅预算变化也被当作身份变化走后继；条件已改的显式 resume 仍被旧冷却守卫拦下 246 秒；功能已完成时 assess 仍推荐验证并列出跨范围旧缺口；测试报告以弱化旗标概括全部断言、读错 provider 回执路径、以原始 verdict 判几何；返修修法只能走完整一圈（约 36 分钟）才拿到设备反馈。本变更沿既有预算折叠、接续决策、完成评估、有效视觉视图与即席设备 CLI 修正这些问题，落实 `docs/overview.md §1.2.1` 的效率优先、简单优先与协作可恢复原则。

## What Changes

- 后继出生时的预算取本交付周期最新的已授权值（事件定授权摘要，数值取现有 manifest 中摘要相等者；本次 `--override-manifest` 授权承接目标上的改动）；新周期取出生输入预算；找不到已授权数值即不出生，指引授权或还原。运行期上限仍读本 run 快照。
- 预算耗尽（`budget_turns` / `budget_wall_clock`）且只有预算变化时接回原 run，不起后继；已完成持有者仅预算变化时保持停止。预算耗尽指引同步。
- 显式 `--resume` 的参数只确定目标，恢复资格取去掉显式旗标后的同一接续决策；决策为起后继时冷却置 0 但仍要 `--force-resume`。
- assess 在完成评估成立时输出已完成投影（`feature_completed`、`requires_driver_authorization=false`、`VALIDATED`、`gaps=[]`），无 run 上下文时按完成记录所属 run 的范围观察；schema、渲染、driver 映射与转移策略随之调整。
- 测试报告消费结构化断言计数、授权过滤后的有效视觉视图与绑定当前输入的规范路径回执；minor 残差为披露；总体结论取 testing gate 视觉检查的阻断结论。visual-diff 受检屏集合按有效处置取。
- coding 返修窗口可经即席设备 CLI 装当前构建、dump / observe、量测，产物默认落 `_adhoc`，不签凭证、不替代正式圈；`--dump-ui-only` 缺省落点改到 `_adhoc`；显式 `--resume` 可附 `--repair-notes` 驱动方假设材料，不改需求与身份。
- 删除无消费的 `IncidentFacts.backtrack_budget_remaining`；补脚本化执行者真实子进程的返修中断回归（只证 spawn / 终止 / 事件解析）。
- 不新增停机原因、状态、登记字段、注册表条目、场外状态或完成凭证协议；同步 `MIGRATION.md`、运维手册与 Skill。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: 后继预算有效值、仅预算变化接回原 run、显式 resume 资格与冷却、返修窗口局部诊断入口与驱动方材料。
- `reconcile-assessment`: 完成评估已成立时的已完成投影与观察范围。
- `harness-gates`: 弱化旗标报告、测试报告同源结论、即席 CLI 返修诊断模式与 dump 缺省落点。
- `visual-diff`: 确定性锚点检查的受检屏按有效处置取。

## Impact

生产代码：`harness/scripts/goal-phase-runtime.ts`、`goal-mode-entry.ts`、`adhoc-device-test.ts`、`check-testing.ts`，`harness/scripts/utils/{goal-run-creation,await-confirm-guidance,assess,assess-renderer,goal-assess-driver,phase-transition-policy,adjudication,adhoc-dump-ui,adhoc-repair-diagnosis,repair-candidates,goal-report-generator}.ts`，`harness/schemas/assess.schema.json`，`profiles/hmos-app/harness/{test-report-writer,visual-diff-check}.ts`；文档：`MIGRATION.md`、`docs/operations/goal-mode-runbook.md`、`skills/reference/{goal-mode-operations,device-testing-workflow-detail,user-confirmation-ux}.md`、`skills/feature/{coding,device-testing}/SKILL.md`、`profiles/hmos-app/skills/device-testing/profile-addendum.md`。

消费者不需要迁移旧 run、旧报告或旧 next.json；`assess@1` 的 `requires_driver_authorization` 由常量 `true` 放宽为布尔，自写解析器须放宽。新周期的 feature 级预算需重新给出。真实 Codex CLI 中断与真机上的返修诊断反馈链仍待宿主证据。提交、推送、打包与宿主运行不属本变更。

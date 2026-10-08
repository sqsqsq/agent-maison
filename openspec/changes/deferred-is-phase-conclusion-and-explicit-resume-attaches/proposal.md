## Why

2026-10-07 开卡宿主第四轮（候选包 5acd53e2，从 09-28 公共起点，run be091c）的只读取证显示：testing 一轮同时含产品缺陷与视觉 provider 不可用时，assess 因 FAIL 摘要里有一个 externalBlocked blocker 就把 testing 判成"延迟"；回退修完 coding→review→ut 全 PASS 后，对尚未到达的 testing 给出 `resolve_deferred`，驱动器无执行语义、兜底 `framework_bug` 停机两次，链无法自动走到 testing 复跑。另有两处准确性问题：显式 `--resume` 指向从未正式开始的 run 被当作真源损坏拒绝、指引人工核查，detach 父进程只见 `alive_timeout`；agent 完成后被宽限 tree-kill 的调用在报告里标 `error` 并打 exit=1 告警。本变更按 `docs/overview.md §1.2.1` 的简单优先与协作可恢复原则，把既有判断收窄到既有真源，不新增停机原因、状态、字段、注册表或门禁。

## What Changes

- assess 的阶段延迟只认 producer 写出的 `verdict=INCOMPLETE` 或 `completion_status=deferred`；FAIL 摘要带外部 blocker 按失败处理，回到该阶段复跑时外部条件随之重评。INCOMPLETE 摘要里外部 blocker 优先于本地 blocked 的既有规则不变。
- 驱动器对 `resolve_deferred` 推荐：`defer_external_*` 透传不变；目标阶段在当前阶段之后时前进（runner 按链序进入该阶段），其余仍停。
- 显式 `--resume` 的目标从未正式开始、且去掉显式旗标后的同一接续决策判为重新接入它时，改为附着同一 run；保留用户给的 `--force-resume`（过期 session owner 只靠显式接管拿回）。detach 父进程透传原始参数，由子进程改写并以 `run_start` 握手；有人在场入口不变。缺 `run_start` 的拒绝文案区分"只有出生事件"与"真源被替换 / 清空"。
- goal-report 四轴时间线的终止轴对 `completion_observed=true` 的非零退出显示 `completed（cleanup，exit=N）`；`buildAgentWarn` 只抑制这一种完成后清理的退出码告警，timeout、真实失败与 `silent_killed` 照报；事件字段与计数口径不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: 阶段延迟的定义、未到达的延迟阶段只前进、显式恢复对未启动 run 改附着、报告终止轴。
- `harness-gates`: blocked capability 投影里"外部 blocker 保持延迟"限定为 INCOMPLETE 摘要。

## Impact

生产代码：`harness/scripts/utils/assess.ts`、`harness/scripts/utils/goal-assess-driver.ts`、`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/goal-report-generator.ts`；文档：`MIGRATION.md`、`docs/operations/goal-mode-runbook.md`；观察记录：`scripts/reliability/observations/b7d2e9f4-host-start0928-5acd53e2.json`。

消费者不需要迁移旧 run 或旧报告。宿主继续 be091c（重新登录视觉 provider 后普通发起 → 接回 → ut 复跑 → 自动进入 testing）待用户批准后实测。提交、推送、打包与宿主运行不属本变更。

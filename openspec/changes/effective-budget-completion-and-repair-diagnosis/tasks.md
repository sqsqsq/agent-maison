## 1. 计划冻结

- [x] 1.1 plan a2f7c9e4 经 codex 三轮评审冻结（§7）；实施分四批，各批记录在 plan §8。

## 2. 预算有效值与接续冷却（批一 t1/t2）

- [x] 2.1 后继出生取本周期最新授权预算（共用周期边界函数、事件定授权摘要、现有数值找同摘要、找不到即在建 run 前失败），两处出生点接线，运行期上限不改。
- [x] 2.2 结构终局仅预算变化接回原 run（预算耗尽 + 身份差集恰为 budget），已完成持有者保持停止；自动接回时 `--manifest` 文件的重复 / 另带改动两种处理；预算耗尽指引同步。
- [x] 2.3 显式 resume 只定目标，资格取去掉显式旗标后的同一决策；successor 决策时冷却置 0 仍要 `--force-resume`。

## 3. 完成输出与报告同源（批二 t3/t5）

- [x] 3.1 assess 已完成投影与按完成记录所属 run 观察；类型、schema、渲染、driver 映射、转移策略同步。
- [x] 3.2 测试报告：结构化断言计数、有效视觉视图、规范回执与当前输入绑定、minor 披露、总体结论取 testing gate 视觉块阻断结论。
- [x] 3.3 visual-diff 受检屏按有效处置取；删除 `runAll(true)` 变异路径；删除无消费的 `backtrack_budget_remaining`。

## 4. 返修局部诊断（批三 t4）

- [x] 4.1 adhoc `--install-current-build` / `--measure-screen` 只编排既有 provider 与纯计算，产物默认落 `_adhoc`，在入口设备门之后；dump 缺省落点改 `_adhoc`。
- [x] 4.2 返修提示词诊断入口（coding + testing 报出的候选）与 `--repair-notes`（只随调用方原始 `--resume`）；coding / device-testing Skill 同步。provider 筛查已裁剪。

## 5. 中断回归、文档与验证（批四 t6/t7）

- [x] 5.1 脚本化执行者真实子进程中断回归（外部 kill、无终态退出、完成后收口 kill + gate 崩溃恢复），只证 spawn / 终止 / 事件解析。
- [x] 5.2 `MIGRATION.md`、运维手册、goal-mode-operations、即席 CLI 参考与 profile 附录、确认 UX 同步；本 change 严格校验。
- [x] 5.3 typecheck 与各批目标套件复跑、plan 扫描、`git diff --check`、LF 复核。
- [ ] 5.4 代码冻结后由调度一次运行 `cd harness && npm test` 与受影响 release-only 链路（real-chain、lifecycle-evolution、reliability-scenarios、design-authority-repair）。

归档随发布流程，须晚于 `task-continuation-recovery-loop`（本 change 对其 goal-runner「Wall-clock budget accumulates active runtime across resume sessions」「Re-issuing the same request continues the same task through one decision」「Human-facing halt guidance states the four recovery facts」三条以其文本为底再出 MODIFIED：仅预算接回、后继有效预算、显式 resume 资格与预算耗尽指引；旧 change 正文不改）。

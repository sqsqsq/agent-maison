## 1. 专项入口

- [x] 1.1 实现请求解析、目标/基线绑定、真实路径与 report-dir 边界，接入 prepare-request。
- [x] 1.2 接通 P1 request 输入、facts 和有判别的 CheckContext。
- [x] 1.3 接入现有 review/UT/testing checker 与独立报告，保留能力缺口和失败语义。

## 2. 验收与交接

- [x] 2.1 说明实际 Skill/adapter 调用顺序，提供 CLI 正反例，验证活跃 Feature 证据零变更。
- [x] 2.2 typecheck、受影响测试、harness 全量、OpenSpec、plan、diff/LF 验收并记录交接范围。

本 change 当前仅覆盖 P6 §3.1–3.2；P6 其他 todo 保持未完成。正式发布前 mandatory `npm run release:verify`（或 release:all）；本批不发布，MIGRATION.md 随 P7 汇总。未调用 openspec update。

## 专项入口段实施记录（2026-09-12）

- 在 harness-runner 的 Feature/Goal 身份绑定之前接入 request-file/report-dir/prepare-request。准备只返回规范化请求、目标哈希、解析基线、报告路径和缺口，不创建控制文件或执行 checker。
- 请求解析复用原 entry-input parser；报告路径经过真实路径及 Feature 链接目标检查。Git refs 解析为 commit，WORKTREE 绑定实际字节，明确测试输出写权限与执行时输入新鲜度分离。
- CheckContext 增加显式 request subject 联合；request 不携带 feature/FeatureSpec。P1 输入、facts、公共 review 检查、profile/provider 选择与报告汇总继续复用现有实现。
- review 复用实际报告内容检查；UT/testing 经既有 capability/profile 边界传入完整请求与报告目录。已支持 request 的 provider 才能执行；HarmonyOS 原生 request 适配属于 P5，未提供导出时如实报缺口，不借用 Feature、不返回伪造的成功。
- 共享 Skill 指向 docs/operations/request-harness.md，明确由 Agent 执行准备、Research、专业产出、同一 CLI 检查及读取实际结果；本请求完成不自动继续阶段链。
- 专项入口 12/12：真实 prepare/run review、实际 Node UT、失败测试、未执行 provider、旧 facts、Git refs、显式设计输入、路径别名、权限/身份混用、active workflow 路由、运行中源码变化；review/UT 对活跃 Feature 树与 current-phase 的零变更有断言。
- 受影响的 P1 capability/facts、文档预算及 blocker suggestion 检查通过。最终 `cd harness && npm test`：typecheck、4451 单测、46 fixtures 全通过；OpenSpec 42/42、plan、diff/LF 检查通过。
- 本 change 专项段任务 5/5；P6 plan 的 p6-project-inputs-and-actions 保持 in_progress，因为该 todo 还含 §3–4 项目级内容。其余 P6 todo 未提前完成，计划正文未改写，未提交代码、未进行真实 HarmonyOS/真机宿主验收。
- 后续按总纲进入 P4，再 P5；P4/P5 在本段真实 CLI/CheckContext 上迁移专业职责和原生 provider，随后完成 P6 其余项，P7 汇总实际宿主验收。

## 专项入口段返修记录（2026-09-12）

- 仅处理本轮冻结的三项意见。复用 Feature 枚举与 receipt/report/run 路径解析，保护尚未生成报告的自定义目录；共享报告根下的独立兄弟目录仍可运行。
- request 的既有参数互斥检查拒绝 `--report-reconcile-only`，在 provider 调用前失败；普通 testing request 仍执行并绑定真实日志。
- 历史 review 的目标、facts 来源可读性和报告引用使用同一份已解析 commit 内容与绑定；当前工作树删除目标不影响审查，WORKTREE、测试执行及 commit 内目标缺失仍失败。未新增 checkout、持久字段或状态协议。
- 现有 request-entry 套件补充三条真实 CLI 用例，15/15 通过；typecheck、OpenSpec 42/42、plan、diff/LF 检查通过。本轮 `cd harness && npm test` 全通过：4454 单测、46 fixtures；日志为 `harness/reports/p6-repair-harness-validation.log`。
- P6 范围与后续交接顺序不变；未修改定稿计划正文，未提交代码。

## 1. 专项入口

- [x] 1.1 实现请求解析、目标/基线绑定、真实路径与 report-dir 边界，接入 prepare-request。
- [x] 1.2 接通 P1 request 输入、facts 和有判别的 CheckContext。
- [x] 1.3 接入现有 review/UT/testing checker 与独立报告，保留能力缺口和失败语义。

## 2. 验收与交接

- [x] 2.1 说明实际 Skill/adapter 调用顺序，提供 CLI 正反例，验证活跃 Feature 证据零变更。
- [x] 2.2 typecheck、受影响测试、harness 全量、OpenSpec、plan、diff/LF 验收并记录交接范围。

专项入口段已完成，以下任务继续覆盖 P6 剩余范围。正式发布前 mandatory `npm run release:verify`（或 release:all）；本批不发布，MIGRATION.md 随 P7 汇总。未调用 openspec update。

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

## 3. P6 项目级与统一入口

- [x] 3.1 按 index/workflow 盘点全部项目职责、原生入口与终点。
- [x] 3.2 局部项目校验、Graph 来源复用与 P2 request 范围接线。
- [x] 3.3 共享用户入口与 adapter 对齐；保留设计停止点、真实授权和旧 run 恢复。
- [x] 3.4 项目/adapter/设计交接定向测试、harness 全量与 OpenSpec/plan/diff 校验。

## P6 剩余范围实施记录（2026-09-12）

- 已通过 P5 整理提交为 8d744daf；本轮 P6 复用此前 request CLI、P4/P5 与同一个 OpenSpec change，未新增执行器、状态台账或调用控制文件。
- 项目入口说明按 skills.index 和 active workflow 核对全部 project Skill / global phase；catalog、glossary、docs 通过原生参数选择实际检查集合，保留涉及选中条目的跨引用/消歧校验。
- Graph 生成、phase 校验和 readiness 复用同一来源解析；可选 catalog 缺失时接受显式源码路径，显式来源损坏仍失败，保留已有策展节点及发布件写保护。全项目扫描复用已解析 catalog，不逐模块重复读取整份文件。
- global phase 用既有 P2 resolver 计算 request 终点，范围记录在既有检查报告结构；继续使用 global 哨兵，无虚假 Feature/Goal。复用 P1 真实路径解析和现有内容 parser，不强制为原生项目 CLI 增加 Feature 输入 DTO。
- 共享入口、七类 adapter 物化、索引/bridge 描述、确认点消费和 init 建议已对齐；新任务不提问 lite/full，旧 run 恢复入口保留。component-design 在设计交接处返回，只有外层对已授权完整实现使用真实 attended Goal 继续。计划正文未改写，P7 默认切换/退役未提前实施。
- 定向验证：project-entry 7/7（含真实 Graph 生成/校验、两个 cwd、Feature 树零变更、可选/坏来源、局部 catalog/glossary/docs）、Graph 11/11、init-next-steps 30/30、framework-init-entry-contract 5/5（七类 adapter 真实物化）、template-renderer 5/5、docs-authoring-lint 18/18；typecheck 通过。
- 仓库门禁首轮 cd harness && npm test：typecheck 通过，4472/4474 单测通过；两项失败是 checked-in bridge 描述同步与新增诊断缺 suggestion。仅修正文案后 resolve-skill-path 4/4、blocker-suggestion-ratchet 3/3 通过，单独补跑 fixtures 46/46；复用首轮其余有效结果，不重复全量。日志：harness/reports/p6-remaining-harness-validation.log 与 p6-remaining-fixtures.log。OpenSpec 44/44、plan、diff/LF 检查通过。
- P6 todo 5/5、本 change 任务 9/9 完成；P6 本轮代码未提交、未发布。后续交 P7：分层完成、在途兼容、默认切换与公开旧入口退役、候选发布件消费及真实宿主验收。本轮原生 Graph 边界使用测试 profile；不宣称真实 HarmonyOS/RDB/真机通过。

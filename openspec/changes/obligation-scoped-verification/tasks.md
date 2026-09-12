## 1. 验证输入与范围

- [x] 1.1 扩展 performance 类型/schema 和共享分层、ID/覆盖解析，接通 P2 义务计算。
- [x] 1.2 迁移 UT/testing contract 与专业消费者，更新 Skill/rules/verifier。
- [x] 1.3 无 testing 义务的 reconcile-only 在报告和设备动作前退出，保留 R8 与原证据复用。

## 2. 原生专项与验收

- [x] 2.1 现有原生 UT/设备 provider 接通 request 目标、报告目录与真实执行，不构造 Feature。
- [x] 2.2 补充真实 CLI/provider/分层负例，运行 typecheck、目标测试、harness 全量、OpenSpec、plan/diff/LF 并更新状态。

正式发布前 mandatory `npm run release:verify`（或 release:all）；本批不发布。P7 汇总 MIGRATION.md 与真实 RDB/页面/性能宿主验收。未调用 openspec update。

## 实施记录（2026-09-12）

- P4 已单独提交为 `9be345d8`；本批实施 P5，未提前切换默认 workflow 或修改定稿 plan 正文。
- performance 复用 ut_layer/ut_focus/device_focus。共享层级判据、NFR ID 解析、UT DAG/coverage-evidence 与设备覆盖集合已接线；缺层级或缺指标/描述等证明内容保持 unknown。现有 scope 解析器消费同一判据，不根据执行失败重判 N/A。
- UT/testing contract 迁为 1.1，P3 验收/契约/用例投影直接消费；旧 workflow 保留窄兼容。testing 的 cases 槽承接原 acceptance 绑定，来源改变仍 blocked。P0 runtime/完成消费者使用已绑定验收，仍只认原机器证据。
- 零 testing 义务的 report-reconcile-only 在执行身份绑定、报告写入与设备门之前只读核验冻结 scope；返回 not_applicable 诊断，不签发测试 PASS。真实 CLI 验证不要求 trace、Feature 树字节不变。
- hmos UT provider 复用 hvigor→HAP→hdc→aa test，显式传 reportDir 和测试类，核对实际数量/失败/跳过；日志与安装诊断不落 Feature。类筛选遵循 [OpenHarmony 官方 Hypium 接口](https://github.com/openharmony/testfwk_arkxtest/blob/master/README_zh.md)，不引入测试执行器。
- hmos 设备 request 复用既有 Hylyre steps-file 入口、设备门、planned-step lint、冻结 v1 StepResult schema 和归约规则。计划有明确预期及原生断言才执行；fake session、缺原生 outcome、执行不完整不能 PASS。强 pixel_1to1 意图缺相应视觉准备/provider 时在动作前报告缺口，不以动作断言替代视觉证据。完整 Feature 的 P0/视觉与 trace 对账路径保持。
- 现代 pure 依赖不强造 mock-plan，未知/真实隔离要求仍由原 gate 检出。只运行指定现有 UT 的 request 不强造整份 acceptance/audit/mock-plan；新增断言必须来自授权预期。
- 定向通过：新增 P5 8/8（含原生边界 mock）、R8 14/14、执行范围 23/23、request CLI 15/15、cases kernel 1/1、契约静态 8/8；typecheck、OpenSpec 44/44、plan/diff/LF 通过。
- 全量 `npm test` 的 typecheck 通过；单测首轮 4466/4467，唯一失败为 device-testing Skill 153 行超过 150 行预算。移除已在 request-harness 文档说明的重复段落并合并收尾标题后，docs-authoring-lint 18/18 复验通过；随后 fixtures 46/46。其余 4466 条结果复用，未因纯文字调整重复全测，也未将首轮写成一次全绿。日志为 `harness/reports/p5-harness-validation.log`、`p5-docs-recheck.log`、`p5-fixtures.log`。P5 五项 todo 与本 change 五项任务已完成。
- 验证边界：Node 测试 CLI 有实际执行；hmos provider 接线使用隔离夹具模拟设备/编译边界，不代表真机或 ohosTest HAP 已在宿主通过。未提供真实 RDB/页面/性能宿主材料，交 P7 在审定提交上构建候选发布件后验证；本批未打包、未发布、未提交 P5。

## 两项局部返修（2026-09-12）

- 设备 request 按用例执行步骤后，立即通过既有 `hylyre ai assert` 验证原始 row.expected，保存原生预期日志并用 checked_vlm 归约。每个预期须有同次返回的 v1 expected_check、真实设备会话和通过结果；不能只以元素出现代替余额等明确预期，也不将缺 VLM/缺预期证据降为 empty。
- mock-plan 的 presence、parseable、typed、contracts_consistent 收编为现有 checker 调用的同一检查组，复用 presence 的适用性结论；只标记实际 SKIP 为 N/A，缺失隔离信息不跳过，已有损坏文件仍 FAIL。修正输入投影的提前 return，让 UT mock-plan 输出裁剪实际可达。
- 现有 P5 用例增加“详情出现但余额未验证”失败与原生预期通过正例；mock-plan 使用真实解析、报告与 summary writer，加上实际 Node 断言执行，验证纯依赖缺文件/合法空文件不会进入 blocking_skips，未知依赖与损坏文件仍不通过；输入桥接同时验证缺失和已有文件的 required_outputs。
- 定向 P5 8/8、UT 契约 15/15、request CLI 15/15、typecheck、OpenSpec 44/44、plan/diff/LF 通过。本轮 `cd harness && npm test` 全通过：4467 单测、46 fixtures，日志为 `harness/reports/p5-repair-harness-validation.log`。两项返修与直接回归已收口；未提交代码，未扩大修复范围。

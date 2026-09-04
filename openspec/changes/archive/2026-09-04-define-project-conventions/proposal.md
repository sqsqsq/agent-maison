## Why

消费者工程缺少承载横切工程实践的稳定知识资产：architecture、module catalog、code graph 与自由扩展文档分别描述依赖边、模块、符号和无协议散文，不能可靠表达“公共能力应怎样使用”。正式需求需要在 P1 蓝图首次消费这类知识，并由 Change Unit 声明一路传到 review 后置核对，避免设计、施工与评审各自猜测。

## What Changes

- 新增 opt-in 的 `paths.conventions` 工程惯例资产及 `/conventions-bootstrap` 人工确认式策展入口；弱结构 Markdown 的条目格式由 Maison 概念文档唯一说明。
- 在 P1 既有 provider/provenance 与 review projection 协议内消费适用惯例；增加一张静态 optional `conventions-knowledge` Seam Card，不新增蓝图字段、registry、phase 或状态。
- 在 CU contracts 中增加可选 `conventions_applied` 声明，并由既有 loader 规范化与校验。
- 在 code review 既有链路内注入惯例全文、输出全量覆盖台账，并以现有 `check-review` 对集合、引用、路径兑现、gate 委托和蓝图贯穿关系做 MAJOR 级确定性检查。
- 惯例文件不存在且 CU 未声明时，spec/plan/review 行为保持不变；蓝图仅输出诚实的 `not_applicable` 可用性卡。显式配置却不可读时输出 `unknown|degraded`。
- Phase 影响：P1/component-design、spec、plan、review；不新增 phase。能力为向后兼容的 opt-in 增量，不要求消费者迁移，`MIGRATION.md` 无需更新。

## Capabilities

### New Capabilities

- `project-conventions`: 定义惯例资产格式、路径与策展纪律，以及从蓝图、CU contracts 到 review 覆盖台账的端到端消费和确定性校验语义。

### Modified Capabilities

- `app-component-blueprint`: P1 在既有 provider-neutral 协议中登记并验证 optional `conventions-knowledge` Seam Card，以既有 facts/provenance/decisions 表达适用惯例，并在同一评审投影中发布引用。
- `feature-artifact-layout`: Feature contracts 增加可选且规范化的 `conventions_applied` 施工声明，作为 review 的既有产物输入。
- `harness-gates`: review phase 增加惯例全量覆盖台账的 MAJOR 级确定性检查，同时保持未启用工程的零行为变化。

## Impact

- 发布内容：`harness/`、`skills/`、`specs/`、`templates/`、`docs/` 与 skills/adapters 接线。
- 开发治理：OpenSpec change、plan todo 状态、维护者 changelog。
- 不修改任何宿主工程，不新增依赖，不创建消费者 `doc/conventions.md`；该文件只由用户显式运行 `/conventions-bootstrap` 后逐条确认写入。

# 工程惯例（Conventions）

> 本文是 AgentMaison 消费者工程惯例资产的**格式与职责唯一 SSOT**。运行时路径由
> `framework.config.json > paths.conventions` 指定，缺失时默认 `doc/conventions.md`；
> 文件存在即启用，文件只能由用户显式运行 `/conventions-bootstrap` 后逐条确认写入。

## 1. 它解决什么问题

工程惯例记录横切多个模块的“怎样使用既有能力”，例如 Repository 字段应由哪一层填充、
RDB 访问应收敛到哪个入口、公共接口应如何复用。它不复制代码、架构边或 checker 判定文本。

| 资产 | 回答的问题 | 一致性方式 |
|---|---|---|
| `framework.config.json > architecture` | 哪些层/模块可以依赖 | harness 依赖门禁 |
| `doc/architecture.md` | 层与模块怎样划分 | 架构影响事件同步 |
| `doc/module-catalog.yaml` | 单个模块负责什么 | catalog 校验与确认 |
| `<module>/code-graph.yaml` | 模块有哪些功能/符号 | 源码 anchor 与 drift |
| `doc/conventions.md` | 横切实践应怎样做 | 蓝图引用 + review 打开范例核对 |
| `doc/extensions/**/knowledge` | 扩展提供的自由知识 | manifest 路径注册 |

Conventions 与 Code Graph 都坚持“指针不复制”：条目引用当前源码范例，消费者必须打开范例。
二者不共享 drift 基础设施；惯例范例失效只触发 review WARN，不存 content hash。

## 2. 文件与主键

- 单个 Markdown 文件，建议不超过 30 条。
- 每个二级标题 `## <id>` 定义一条惯例；标题全文就是 id，必须非空且全文件唯一。
- 一级标题只作文件标题，不参与机器解析；条目内部不得再使用 `##`。
- 方向变更在新条目中用 `supersedes` 指向旧 id，并在正文说明原因；不另建生命周期状态机。

## 3. Review 卡格式

Review 卡由语义评审核对，不包含 `enforcement` 或 `gate_ref` 机器字段：

```markdown
## repository-fields-single-source

- 规则：MUST 复用 Repository 已填充的展示字段，不得在 presentation 层重新映射。
- 适用：读取该 Repository DTO 的 presentation 代码。
- 范例：`src/data/AccountRepository.ts#loadAccount`
- 反例：`viewModel = mapAgain(repositoryResult)`
- 仅新代码：是
- 生效于：2026-09-03
- 探针（可选）：检索 presentation 对 DTO 的二次构造；期望结果为零处。
- supersedes（可选）：旧惯例 id
```

字段说明：

- `规则` 使用 MUST/SHOULD；`适用` 用自然语言限定范围，不建立 glob/applicability schema。
- `范例` 有代码时是项目相对文件路径，可附 `#symbol` 文本锚点，必须指向好例子；无代码可测时写“无（aspirational）”，代码分裂未裁决时写“待裁决”。不得编造路径或把多数写法自动认定为正统。
- `反例` 只写伪代码形状，禁止指向生产文件，避免修复后陈旧或被模仿。
- `仅新代码` 缺失时按“是”；`生效于` 由 bootstrap 按入库日期填写。
- `探针` 只记录检索意图和期望结果，不保存平台相关命令。

## 4. Gate 索引卡格式

已有 harness/checker 承载判定时，只能登记 gate 索引卡，不得复制规则判定文本：

```markdown
## cross-layer-import

分层门禁用于阻止依赖方向倒置；具体判定以 checker 为唯一真源。
enforcement: gate
gate_ref: coding/inter_module_dependency
范例：`src/domain/AccountService.ts`
```

`enforcement: gate` 与 `gate_ref: <phase>/<rule_id>` 必须同时出现。`phase` 和 `rule_id`
组成引用身份，并且必须能在该工程 resolved phase rules 中找到（示例为 hmos-app overlay 的规则）。Review 台账对这种卡固定写
`GATE_DELEGATED`；它只说明裁决已委托，不复制或预言本轮 gate 结果。

## 5. 消费与维护

1. `/component-design` 在文件存在时读全文，只把真正适用的 id 以既有蓝图
   `discovery.facts`/provenance 引用；不增加 conventions 专用蓝图字段。
2. CU plan 在 `contracts.conventions_applied` 声明 id 与预计落位。
3. code review 独立读取全文，对全部 id 输出覆盖台账并打开适用条目的范例。
4. review 遇到重复意见只能建议升格；写入仍回到 `/conventions-bootstrap` 的逐条确认流程。

惯例面向新代码时，生效日前的存量违反只作 legacy advisory；无法取得 blame 历史时记
`NOT_ASSESSED` advisory，不得升级阻断。

## 6. 明确不做

不建立索引/resolver、结构化 applicability、内容 hash/drift、ADR 目录、owner/waiver schema、
自动生成或自动入库。出现真实的“全文读不完或经常漏选”证据后，再另行设计检索机制。

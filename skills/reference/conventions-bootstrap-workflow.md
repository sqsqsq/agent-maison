# conventions-bootstrap 详细流程

> 格式与字段只以 [`docs/concepts/conventions.md`](../../docs/concepts/conventions.md) 为准；本文只定义策展步骤。

## Step 0：解析路径并创建空骨架

读取实例根 `framework.config.json > paths.conventions`，缺失时用 `doc/conventions.md`。路径相对实例根解析。文件不存在时直接复制 `skills/project/conventions-bootstrap/assets/conventions.template.md` 的空骨架；禁止顺手加入示例条目。文件已存在则完整读取，先列出现有 `##` id。

## Step 1：盘点证据源

按优先级形成候选清单：

1. review 历史与事故复盘：同形问题重复至少两次优先；一次高损事故也可候选。
2. 当前代码：只用于测量现状和寻找 Golden Example，代码多数写法不自动等于正确规则。
3. 既有文档：若已经写明权威实践，候选采用摘要 + 精确链接。

每个候选保留来源指针、重复次数/事故依据和可能适用范围。没有证据的“最佳实践”丢弃。

## Step 2：挖坑提取

从问题中提炼一条可执行规则、原因、好例子和伪代码反例。一个候选只回答一个坑；混合多个责任时拆开。id 使用稳定 kebab-case 语义名，不带日期、模块实例名或序号。

## Step 3：符合率实测与三态分类

尽量为候选执行一个确定性探针，记录检索意图、样本范围、符合/总数和期望：

- 100% 且有好例子：`established`。
- 代码出现互斥写法、无法从事实判断正统：`待人裁决`，展示分歧给用户，不擅自选胜。
- 当前无代码可测但规则由权威需求/事故推出：`aspirational`。

这三态只在范例/说明中表达，不新增状态字段：有有效范例、待裁决、无（aspirational）。

具体命令只在本轮执行记录中出现，禁止写进 conventions 文件。

## Step 4：与现有门禁去重

检查 framework + profile + extension 解析后的 phase rules，以及 coding/UT/profile checker。若已有确定性判定：

- 不建立 review 卡，不复制 MUST 文本。
- 只有当“为什么存在该门禁”和 Golden Example 有长期策展价值时，才按格式 SSOT 建 gate 索引卡。
- 从 `gate_ref` 拆出 phase 与 rule id；加载该 phase 的 resolved rules，按二元组精确确认规则存在。未知 phase、错 phase 的同名 id 或未知 id 都不得进入确认步骤。

未被既有门禁承载的候选才使用 review 卡。

## Step 5：逐条确认

每次只展示一张完整候选摘要：id、分类、证据、规则/说明、适用、范例、反例、仅新代码、生效日、探针、可选 supersedes 或 gate ref。然后使用 registry `conventions.staging_card`：

- `1`/`y`：把当前卡追加到资产；生效日填当天；立即重读校验，再处理下一张。
- `2`/`e`：只修改用户点名内容，重新完整展示并再次确认。
- `3`/`s`：本轮跳过，不写临时状态文件。
- `4`/`q`：作废候选。

“好的”“继续”等含糊回应不是 `y`。禁止批量确认或先写后问。

## Step 6：收口

重读资产并检查：所有 `##` id 非空且唯一；review 卡不含机器字段；gate 卡两字段成对且 `(phase, rule_id)` 可解析；范例路径存在，附 symbol 时文本可找到（失效只报告 WARN，不自动改写）。汇报计数与 WARN 后停止，不进入 feature phase，不 commit。

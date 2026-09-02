# Hylyre 0.4.1 结构化 Selector 身份与脱敏契约修复需求

- 提出方：Maison framework（hmos-app profile 以 vendor 方式集成 Hylyre）
- 目标版本：**Hylyre 0.4.1**
- 问题基线：**Hylyre 0.4.0 / trace schema 0.3-p0**
- 关联总需求：`docs/vendor/hylyre-断言与证据完整性需求.md` P1-8、P2-14
- 日期：2026-08-30

## 一、结论与优先级

Hylyre 0.4.0 将 `by_id / by_key / id / key / selected_id` 等**结构化 selector 身份字段**与账号、金额等**用户数据文本**使用同一套关键词脱敏规则。组件 ID 只要包含 `card / amount / account / phone` 等普通业务词，就会在最终 `StepResult.to_dict()` 中变成统一的 `[REDACTED]`。

这不是展示层小问题，而是 **P0 机器证据身份被破坏**：Maison 无法再完成

```text
派生计划 selector
↔ canonical ui-spec node id
↔ StepResult.selector.selected_id
```

的精确对账。JSON Schema 仍会通过，因为 `[REDACTED]` 也是字符串；但 trace 已失去语义可验证性。

**0.4.1 必须修复。Maison 不接受通过忽略 `selected_id`、只信 `candidate_count` 或回退计划推测来绕过。**

## 二、复现证据

### 2.1 根因代码

`src/hylyre/scenario/results.py` 当前将以下字段列为 selector value：

```python
_SELECTOR_VALUE_KEYS = frozenset(
    {"by_id", "by_key", "id", "key", "selected_id"}
)
```

随后对字段值执行包含业务单词的正则：

```python
_SENSITIVE_SCALAR_RE = re.compile(
    r"(?i)(?:account|账号|amount|金额|余额|phone|手机号|card|卡号|token|secret|password)|"
    r"(?<![\w])[0-9][0-9,]{5,}(?![\w])"
)
```

命中后统一返回：

```python
"[REDACTED]"
```

### 2.2 真实序列化复现

调用 vendor 0.4.0 的 `redact_evidence()` 与 `StepResult.to_dict()`：

| 输入 selector ID | 0.4.0 最终值 |
|---|---|
| `hc_bank_card_row` | `[REDACTED]` |
| `amount_input` | `[REDACTED]` |
| `account_selector` | `[REDACTED]` |
| `phone_entry` | `[REDACTED]` |
| `pay_button` | `pay_button` |

最终 trace 的实际形态：

```json
{
  "selector": {
    "engine": "resolver",
    "requested_match": null,
    "effective_match": "contains",
    "candidate_count": 1,
    "selected_id": "[REDACTED]",
    "bounds": "[0,0][1,1]"
  }
}
```

### 2.3 为什么 schema 检不出来

`output-schema.json` 只约束：

```json
"selected_id": { "type": ["string", "null"] }
```

因此 `[REDACTED]` 在结构上合法，却无法证明实际选中了哪个 canonical target。这属于“schema PASS、证据语义失真”。

## 三、机制定性

当前实现混淆了两类性质不同的数据：

| 数据类型 | 示例 | 是否需要脱敏 | 原因 |
|---|---|---:|---|
| 用户数据文本 | 账号、卡号、金额、手机号、输入值、Toast 文案 | 是 | 可能包含真实敏感信息 |
| 自然语言指令/预期 | `instruction/expected/actual/error/notes` | 是 | 可能携带业务数据 |
| 稳定 selector 身份 | `amount_input`、`hc_bank_card_row` | **否** | 是测试契约与 ui-spec 的关联键，不是字段当前承载的金额/卡号值 |
| selector 命中 bounds | `[x1,y1][x2,y2]` | 否 | 是运行时取证坐标，不是用户数据 |
| 候选数量/匹配模式 | `candidate_count/effective_match` | 否 | 是执行契约事实 |

问题不只影响 `selected_id`，还会影响 `_SELECTOR_VALUE_KEYS` 中所有结构化字段，并把不同 target 压成同一个 `[REDACTED]`，造成身份碰撞。

## 四、0.4.1 必须实现的契约

### P0-1 结构化 selector 身份必须保持可比较

以下字段作为机器身份字段时，不得按字段值中的业务单词做文本脱敏：

```text
by_id
by_key
id
key
selected_id
```

验收要求：

- `hc_bank_card_row` 序列化后仍为 `hc_bank_card_row`；
- `amount_input` 序列化后仍为 `amount_input`；
- `account_selector`、`phone_entry` 同理；
- 两个不同 selector ID 序列化后必须保持不同，禁止统一坍缩为 `[REDACTED]`；
- 成功 StepResult、失败异常 selector、候选摘要中的身份语义一致。

### P0-2 文本和值的隐私保护必须保留

本修复不得撤销原 P2-14。以下承载真实文本/值的字段继续脱敏：

```text
text
value
instruction
expected / actual
expected_text / actual_text
event_text
input_value
by_text / by_value
error / notes 中命中的真实敏感片段
```

验收要求：

- 真实卡号、账号、金额、手机号不得进入 trace 明文；
- `by_text` 中的真实业务文本继续按既有策略处理；
- 修复 selector ID 后，现有文本脱敏负例必须保持通过。

### P0-3 身份字段禁止使用无类型的统一占位符

对于参与机器关联的字段，以下行为均不允许：

- 将任意多个 ID 写成相同的 `[REDACTED]`；
- 将原 ID 静默改为空字符串；
- 删除 `selected_id` 但仍宣称 selector evidence 完整；
- 仅保留 `candidate_count=1`，丢失选中目标身份；
- 让 Markdown 保留原 ID、JSON trace 写 `[REDACTED]`，形成双真源。

0.4.1 推荐采用最小兼容方案：**结构化 selector ID 原样保留，仅脱敏真实文本和值。**

如果未来安全策略要求隐藏 selector ID，必须另立并冻结可比较的稳定身份协议，例如带类型的确定性 fingerprint，并同步修改 JSON Schema、Hylyre 文档和 Maison 消费契约。不得在 0.4.1 中静默引入。

### P0-4 StepResult 与异常路径必须使用同一规则

修复必须覆盖所有产出路径，而不是只改 `StepResult.to_dict()` 正常路径：

- action/assertion 成功的 `StepResult.selector.selected_id`；
- selector not found/ambiguous/inline failure 的异常 selector；
- `candidates_summary` 中的 `id/key`；
- `tool_calls` 从 StepResult 派生的投影；
- Markdown 报告中的 selector 身份（如展示）；
- plan、steps-file、CLI、MCP 等入口最终进入同一 ledger 后的序列化。

## 五、实现边界

### 5.1 推荐最小修改

建议在 `redact_evidence()` 中把“机器身份字段”与“文本值字段”分开处理：

- selector identity key：保持原值；
- text/value key：继续脱敏；
- 普通自由文本：继续执行 `_SENSITIVE_TEXT_PATTERNS`；
- 不改变 StepResult/CaseResult 字段集合；
- trace schema 继续使用 `0.3-p0`。

### 5.2 非目标

本需求不要求：

- 修改 exact/contains 语义；
- 修改 candidate uniqueness；
- 修改 rich-text bounds 解析；
- 新增 OCR 或坐标估算；
- 放宽 Maison 的 selector runtime gate；
- 移除文本隐私保护；
- 重建第二套 selector ledger。

## 六、Conformance 回归矩阵

### 6.1 身份字段正例

以下值经 `redact_evidence()`、`StepResult.to_dict()` 后必须逐字保留：

```text
hc_bank_card_row
amount_input
account_selector
phone_entry
bank_card_agreement_span
card_123456_container
```

至少覆盖 key：

```text
by_id
by_key
id
key
selected_id
```

### 6.2 文本脱敏负例

以下内容不得原样进入 trace：

```text
account: 6222021234567890
amount: 1000.00
phone: 13800138000
card: 6222021234567890
by_text: "账户 6222021234567890"
instruction: "向账号 6222021234567890 转账 1000 元"
```

### 6.3 碰撞回归

输入：

```text
selected_id=hc_bank_card_row
selected_id=amount_input
```

验收：两个输出必须不同，且均能与原 ui-spec ID 精确比较。

### 6.4 最终 StepResult 回归

构造一个成功 selector StepResult：

```json
{
  "index": 0,
  "kind": "touch",
  "role": "action",
  "status": "passed",
  "selector": {
    "engine": "resolver",
    "requested_match": "exact",
    "effective_match": "exact",
    "candidate_count": 1,
    "selected_id": "hc_bank_card_row",
    "bounds": "[0,0][100,100]"
  }
}
```

调用 `to_dict()` 后：

```text
selector.selected_id == "hc_bank_card_row"
```

### 6.5 失败与候选摘要回归

- `selector_ambiguous` 的候选摘要保留每个结构化 ID；
- `inline_target_unresolvable` 的 selector identity 保持可比较；
- 错误消息中若含真实账号/金额仍须脱敏；
- failure_kind/failure_code 不受影响。

### 6.6 入口接线回归

至少覆盖：

- plan run 一条；
- steps-file 一条；
- CLI 或 MCP 中至少一条最终 trace；
- `output-schema.json` 校验通过；
- trace/Markdown/tool_calls 均由同一 StepResult ledger 派生。

## 七、版本与发布要求

### 7.1 版本必须递增

建议发布 **0.4.1**，不要以同版本 0.4.0 静默替换：

- Maison 需要把最低可接受 native 版本提升至 0.4.1；
- 避免外部 `HYLYRE_PYTHON` 中仍安装有缺陷的 0.4.0，却因版本相同被误判可用；
- CHANGELOG/README 需要明确“selector identity 不再被文本脱敏”。

### 7.2 发布件

交付时同步：

- `pyproject.toml` / `hylyre.__version__`；
- `release.manifest.json` 的 `hylyre_version`；
- source tree 文件清单、size、SHA 与 `tree_sha256`；
- contracts/output-schema.json（若 schema 字段不变，可保持 0.3-p0）；
- README/CHANGELOG；
- conformance 测试结果。

## 八、Maison 联调验收

Hylyre 0.4.1 同步到 Maison 后，Maison 将：

1. 把 native minimum version 从 0.4.0 提升到 0.4.1；
2. 校验 vendor manifest/tree fingerprint；
3. 运行 Hylyre fake runner 并校验 trace schema 0.3-p0；
4. 验证 `StepResult.selector.selected_id` 对包含 `card/amount/account/phone` 的 ID 仍可精确比较；
5. 由 `ensureHylyreReady` 生成 installed/manifest/doctor 一致的 ready meta；
6. 真机回灌 selector exact/contains、消歧、absence assertion 与 rich-text failure；
7. 运行 testing 与 `--report-reconcile-only`；
8. 不降低 Maison 的 candidate_count、selected_id、plan/trace hash 或 required/forbidden assertion 门禁。

未完成上述联调前，准确状态应为：

```text
Maison native evidence 消费实现已就绪；
Hylyre 0.4.0 selector identity 脱敏缺陷阻塞真实设备闭环。
```

## 九、Hylyre 交付报告要求

请在交付 0.4.1 时提供：

1. 根因与修改文件；
2. selector identity 与文本值的最终脱敏边界；
3. `redact_evidence()` 单测结果；
4. `StepResult.to_dict()` 正反例；
5. ambiguous/inline failure 候选摘要结果；
6. plan/steps-file/CLI/MCP 接线验证；
7. output schema 校验结果；
8. 版本号、manifest、tree fingerprint；
9. 是否存在接口或迁移偏离；
10. 尚未执行的真实设备验证。


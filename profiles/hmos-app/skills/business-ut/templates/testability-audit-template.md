# 可测性预检（testability-audit）模板

有具体上游缺口时，可在既有 fenced YAML records 之外追加 review 同款 `## 问题清单`（ID、严重程度、涉及文件、问题描述/依据、修复建议、状态）；无问题不补表。涉及文件写要修的权威产物，依据用当前 `工程相对路径:行号` 引源码/日志。原 verifier 逐条核实后才交 owner；拒修理由返回 UT，不改断言洗绿。详见 `skills/reference/coding-workflow-detail.md` 的“可选上游问题与拒修返回”。

> **产出路径**：`<features_dir>/<feature>/ut/testability-audit.md`
> **时机**：business-ut · Step 1.5，**早于** DAG / mock-plan / `*.test.ets`。  
> Harness 会静态校验：每条 `acceptance.yaml` 中 `ut_layer ∈ {unit, both}` 的 **AC/BD** 均有一条对应记录；**L3** 必须 `selected` 二选一并完成登记。

## OUTPUT CONTRACT（写文件前必读）

- 扩展名是 **`.md`**，但机器可读内容只能是 **fenced `yaml` 块** 或 **纯 YAML 全文**。
- **禁止** Markdown 表格（`| AC | testability_level | ... |`）—— harness 解析不到 `records[]`。
- 复制下方 **EXACT OUTPUT FORMAT**，只替换 `<placeholder>` 与每条 AC/BD 字段；不要改结构。

### 常见错误 vs 正确

| 错误（会 FAIL） | 正确 |
|-----------------|------|
| Markdown 表格列 AC-1 / L1 / testable | `records:` 数组 + `acceptance_id: AC-1` |
| 只有 prose 段落无 yaml 块 | 至少一个 ` ```yaml ` 块含 `records:` |
| `acceptance_id: AC-1-a`（子编号） | 只用 acceptance.yaml 已有 ID，如 `AC-1`、`BD-1` |
| `name: AnalyticsReporter.getData`（类.方法） | `name: AnalyticsReporter`（纯类名；方法级信息写 `entry_point.symbol` 或 mock-plan `methods[]`） |

## EXACT OUTPUT FORMAT — COPY AND FILL

```yaml
schema_version: "1.0"
feature: "<feature>"
records:
  - acceptance_id: AC-1
    entry_point:
      symbol: TaskEntryInteraction.buildChannelPage
      file: 02-Feature/SampleFeature/src/main/ets/presentation/component/entry/TaskEntryInteraction.ets
    testability_level: L1
    dependencies:
      - name: AnalyticsReporter
        kind: di_injectable
        seam: subclass_override
      - name: ConfigUtil
        kind: di_injectable
        seam: subclass_override
    verdict: testable
  - acceptance_id: AC-2
    entry_point:
      symbol: TaskEntryInteraction.buildChannelPage
      file: 02-Feature/SampleFeature/src/main/ets/presentation/component/entry/TaskEntryInteraction.ets
    testability_level: L1
    dependencies:
      - name: AnalyticsReporter
        kind: di_injectable
        seam: subclass_override
      - name: ConfigUtil
        kind: di_injectable
        seam: subclass_override
    verdict: testable
  - acceptance_id: BD-1
    entry_point:
      symbol: TaskEntryInteraction.buildChannelPage
      file: 02-Feature/SampleFeature/src/main/ets/presentation/component/entry/TaskEntryInteraction.ets
    testability_level: L1
    dependencies:
      - name: AnalyticsReporter
        kind: di_injectable
        seam: subclass_override
    verdict: testable
    note: getData 返回 undefined 时 graceful fallback
```

> 完整 feature 须为 **每条** `ut_layer ∈ {unit, both}` 的 AC/BD 各写一条 `records[]` 元素；上例仅示意结构。

## 可测性等级（L0–L3）

分级与行动复用 [共享 UT 方法](../../../../../skills/reference/business-ut-workflow-detail.md#共享-ut-方法)；本模板只包装正式 audit 的字段。L3 不授权 UT 改产品或降低验收，回既有责任方处理。

## 依赖 `kind` 与可选 `seam`

| kind | 说明 | 常见 seam |
|------|------|-----------|
| `pure` | 无副作用、可重复调用 | `none` |
| `di_injectable` | 可通过构造/参数注入 | `constructor_injection` / `setter` |
| `global_singleton` | 全局单例、静态访问 | `constructor_injection` / `wrapper` / 常无 seam → **L3** |
| `inline_lambda` | 逻辑闭包在匿名函数内 | `extract_named_method` / **L3** |
| `system_api` | 系统能力 | `subclass_override` / Mock 模块 |

`seam` 取值示例：`none` | `constructor_injection` | `setter` | `subclass_override` | `proto_replace` | `wrapper` | `extract_named_method`

## 文件格式（Markdown 内嵌 YAML）

- 可使用 **一个** fenced `yaml` 块，根字段为 `records`（推荐）；
- 或 **多个** `yaml` 块，每块一条记录（会与 `records[]` 合并）。

### 单条记录字段（契约）

| 字段 | 必填 | 说明 |
|------|------|------|
| `acceptance_id` | ✅ | 如 `AC-1` / `BD-2`，须与 acceptance.yaml  id 一致 |
| `entry_point` | 推荐 | `symbol`（类.方法）、`file`（相对仓库根路径） |
| `testability_level` | ✅ | `L0` \| `L1` \| `L2` \| `L3` |
| `dependencies` | 推荐 | `name` / `kind` / `seam`；**`name` 必须为纯类名**（与 mock-plan `target_class` 同口径；方法级信息写 `entry_point.symbol` 或 mock-plan `methods[]`，不写入 `name`） |
| `verdict` | ✅ | `testable` \| `downgrade_device` \| `needs_seam` |
| `recommendation` | L3 推荐 | `option_a` / `option_b` 文字说明 |
| `selected` | **L3 必填** | `option_a` \| `option_b` |

---

## 示例（可复制）

```yaml
schema_version: "1.0"
feature: "<feature>"
records:
  - acceptance_id: AC-1
    entry_point:
      symbol: HomeRepository.getServiceEntries
      file: 02-Feature/TaskDemo/src/main/ets/data/repository/HomeRepository.ets
    testability_level: L1
    dependencies:
      - name: HomeRepository
        kind: pure
        seam: none
    verdict: testable
  - acceptance_id: AC-2
    entry_point:
      symbol: HomeRepository.getPromoList
      file: 02-Feature/TaskDemo/src/main/ets/data/repository/HomeRepository.ets
    testability_level: L1
    dependencies:
      - name: HomeRepository
        kind: pure
        seam: none
    verdict: testable
```

### L3 示例（须用户确认 selected）

```yaml
  - acceptance_id: AC-X
    entry_point:
      symbol: FooOperator.bar
      file: 02-Feature/TaskDemo/src/main/ets/.../FooOperator.ets
    testability_level: L3
    dependencies:
      - name: JumpManager
        kind: global_singleton
        seam: none
    verdict: downgrade_device
    recommendation:
      option_a: "提请 spec 裁定验收分层/device_focus；UT 不改 acceptance，不自批取消 unit 义务"
      option_b: "源码改造：交回 coding owner 完成 JumpManager 构造注入并重走 review→ut"
    selected: option_a   # 记录待裁定的定义问题，不代表获准降低验收
```

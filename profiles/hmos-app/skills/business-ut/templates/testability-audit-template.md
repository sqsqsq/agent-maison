# 可测性预检（testability-audit）模板

> **产出路径**：`doc/features/<feature>/ut/testability-audit.md`  
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

## EXACT OUTPUT FORMAT — COPY AND FILL

```yaml
schema_version: "1.0"
feature: "<feature>"
records:
  - acceptance_id: AC-1
    entry_point:
      symbol: BankCardPetalOpenHwpInteraction.buildChannelPage
      file: 02-Feature/FinancialCard/src/main/ets/BankCard/presentation/component/openCard/openHWP/BankCardPetalOpenHwpInteraction.ets
    testability_level: L1
    dependencies:
      - name: HAFullChainService.getData
        kind: di_injectable
        seam: subclass_override
      - name: BundleUtil.isVersionControl
        kind: di_injectable
        seam: subclass_override
    verdict: testable
  - acceptance_id: AC-2
    entry_point:
      symbol: BankCardPetalOpenHwpInteraction.buildChannelPage
      file: 02-Feature/FinancialCard/src/main/ets/BankCard/presentation/component/openCard/openHWP/BankCardPetalOpenHwpInteraction.ets
    testability_level: L1
    dependencies:
      - name: HAFullChainService.getData
        kind: di_injectable
        seam: subclass_override
      - name: BundleUtil.isVersionControl
        kind: di_injectable
        seam: subclass_override
    verdict: testable
  - acceptance_id: BD-1
    entry_point:
      symbol: BankCardPetalOpenHwpInteraction.buildChannelPage
      file: 02-Feature/FinancialCard/src/main/ets/BankCard/presentation/component/openCard/openHWP/BankCardPetalOpenHwpInteraction.ets
    testability_level: L1
    dependencies:
      - name: HAFullChainService.getData
        kind: di_injectable
        seam: subclass_override
    verdict: testable
    note: getData 返回 undefined 时 graceful fallback
```

> 完整 feature 须为 **每条** `ut_layer ∈ {unit, both}` 的 AC/BD 各写一条 `records[]` 元素；上例仅示意结构。

## 可测性等级（L0–L3）

| 等级 | 含义 | 典型特征 | UT 策略 |
|------|------|----------|---------|
| **L0** | 纯函数 / 无外部 IO | 仅入参→出参，无单例/系统 API | 直接单测 |
| **L1** | 可注入 / 可替换边界 | 构造参数、工厂、可被 Spy 的类 | Spy / 子类化 |
| **L2** | 可子类化或 seams | 非 final 类、`protected` 可覆盖、可命名方法抽出 | 子类 Spy / 包装类 |
| **L3** | 不可测或成本过高 | 全局单例、inline lambda 内嵌、无接缝 | **必须 STOP**：`option_a` 降级 device-only **或** `option_b` 源码改造（走 `ut_no_src_mutation` + gap-notes） |

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
| `dependencies` | 推荐 | `name` / `kind` / `seam` |
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
      option_a: "标记 device-only，在 acceptance.yaml 对应条目填写 device_focus"
      option_b: "源码改造：JumpManager 构造注入（须 gap-notes approved_src_mutations）"
    selected: option_a   # 用户确认后填写 option_a 或 option_b
```

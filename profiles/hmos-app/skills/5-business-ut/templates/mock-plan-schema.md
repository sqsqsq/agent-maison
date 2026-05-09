# Test Double Plan（mock-plan.yaml）Schema

> **产出路径**：`doc/features/<feature>/ut/mock-plan.yaml`  
> **时机**：Skill 5 · Step 1.6，在 DAG / UT 代码之前；**Spy 类必须与本文档 1:1 对齐**，禁止在 Spy 内自由编造字段/方法签名。

## 设计目的

- 将 **ArkTS 强类型** 的返回/异常表达固化在 `ts_expr` 中（含显式类型断言），避免 DAG 或 UT 里散落无类型字面量导致编译失败。
- **`contracts.yaml > interfaces[]`** 为方法名与签名的权威来源；`mock-plan` 为 Spy / preset 的权威来源。
- DAG 节点可通过 `spy_preset` 引用 `presets[].id`（见 [dag-schema.md](dag-schema.md)）。

## 顶层结构

```yaml
schema_version: "1.0"
feature: "<feature>"

# 集中声明 UT/Spy 侧需要的类型 import（供代码生成参考）
imports:
  - { symbol: VerifyResult, from: "02-Feature/.../model/VerifyResult" }

spies:
  - target_class: CardCloudApi           # 必须 ∈ contracts.yaml > interfaces[].class
    target_file: 02-Feature/.../api/CardCloudApi.ets
    base_strategy: subclass              # subclass | prototype_override
    spy_fields:
      - { name: callLog, type: "string[]", default: "[]" }
    methods:
      - name: verifyCard
        params:
          - { name: draft, type_text: "CardDraft" }
        return_type: { text: "Promise<VerifyResult>" }
        presets:
          - id: success
            returns: { ts_expr: "{ ok: true, token: 't' } as VerifyResult" }
          - id: error_sms
            throws: { ts_expr: "new BizError('SMS_ERR')" }

fixtures:
  - { name: draftSample, type: "CardDraft", ts_expr: "..." }
```

## 字段说明

| 路径 | 说明 |
|------|------|
| `spies[].target_class` | 与 `contracts.yaml` 中 `interfaces[].class` 一致 |
| `spies[].methods[].name` | 与同接口的 `methods[].name` 一致 |
| `spies[].methods[].presets[].id` | 全局唯一（建议 `snake_case`）；DAG `spy_preset` 引用 |
| `presets[].returns.ts_expr` | ArkTS 表达式字符串；每个 preset 必须有 `returns.ts_expr` 或 `throws.ts_expr` 至少一个；**必须**含 `as SomeType` 或合法构造 |
| `presets[].throws.ts_expr` | 同上，常见 `new XxxError(...)` |

## ArkTS：错例 vs 正例

| 错例 | 问题 | 正例 |
|------|------|------|
| `{ ok: true }` | 对象字面量无法推断上下文类型 | `{ ok: true } as VerifyResult` |
| `return { token: 't' }` 在 Spy 内无注解 | 缺省类型推断失败 | `({ token: 't' } as VerifyResult)` 或显式 `new VerifyResult(...)`（若有类） |
| `Promise.resolve({})` | `{}` 非具名类型 | `Promise.resolve({} as VerifyResult)` |
| `throw 'err'` | 字符串异常 / 弱类型 | `throw new BizError('SMS_ERR')` |
| 使用 `any` | 项目红线 | 用接口 + `as` 或显式类 |

## Harness 粗校验（`ut_mock_plan_typed`）

脚本对每个 preset 做两层保守扫描：

1. 必须声明 `returns.ts_expr` 或 `throws.ts_expr` 至少一个；
2. `ts_expr` 须匹配 `as <类型>` 或 `new <Name>(`（避免纯字面量漏断言）。

## 与 DAG 的衔接

- 新写法：`port_call_cloud` / `port_call_local` / `async_call` 节点设 `spy_preset: <preset_id>`。
- **过渡期**：`mock_data` 仍可读，但视为 **deprecated**；新 feature 应优先 `spy_preset` + 本文件。

# Test Double Plan（mock-plan.yaml）Schema

> **产出路径**：`doc/features/<feature>/ut/mock-plan.yaml`  
> **时机**：Skill 5 · Step 1.6，在 DAG / UT 代码之前；**Spy 类必须与本文档 1:1 对齐**，禁止在 Spy 内自由编造字段/方法签名。

## OUTPUT CONTRACT（写文件前必读）

- 扩展名是 **`.yaml`**，文件内容必须是 **纯 YAML**（首行即 `schema_version:` 或 `spies:`）。
- **禁止**：Markdown 标题（`# 标题` 独占一行）、` ```yaml ` 围栏、Markdown 表格。
- **允许**：行内 YAML 注释（`# 这是注释`，须在同一行或跟在键值后，不是 markdown 标题块）。
- 复制下方 **EXACT OUTPUT FORMAT**，只替换 `<placeholder>`；每个 preset 的 `ts_expr` 必须含 `as Type` 或 `new Name(`。

### 常见错误 vs 正确

| 错误（会 FAIL） | 正确 |
|-----------------|------|
| `# Test Double Plan` 标题 + prose | 直接 `schema_version: "1.0"` |
| ` ```yaml ` 围栏包裹内容 | 无围栏，纯 YAML |
| `returns: true` 无 ts_expr | `returns: { ts_expr: "true as boolean" }` |

## EXACT OUTPUT FORMAT — COPY AND FILL

```yaml
schema_version: "1.0"
feature: "<feature>"
imports:
  - symbol: HAFullChainService
    from: "@wallet/common-functions/src/main/ets/hiAnalytics/fullchain/HAFullChainService"
  - symbol: BundleUtil
    from: "02-Feature/FinancialCard/src/main/ets/BankCard/shared/utils/BundleUtil"
spies:
  - target_class: HAFullChainService
    target_file: "05-SystemBase/CommonFunctions/src/main/ets/hiAnalytics/fullchain/HAFullChainService.ets"
    base_strategy: subclass
    spy_fields:
      - name: _callLog
        type: "string[]"
        default: "[]"
    methods:
      - name: getData
        params:
          - name: key
            type_text: "string"
        return_type:
          text: "string | undefined"
        presets:
          - id: success_both_channels
            params: []
            returns:
              ts_expr: "((key: string): string | undefined => { this._callLog.push(key); if (key === 'mainChannel') return 'account_card'; if (key === 'subChannel') return 'add_card'; return undefined; })(params[0])"
  - target_class: BundleUtil
    target_file: "02-Feature/FinancialCard/src/main/ets/BankCard/shared/utils/BundleUtil.ets"
    base_strategy: subclass
    spy_fields:
      - name: _callLog
        type: "string[]"
        default: "[]"
    methods:
      - name: isVersionControl
        params:
          - name: bundleName
            type_text: "string"
          - name: key
            type_text: "string"
          - name: version
            type_text: "number"
        return_type:
          text: "boolean"
        presets:
          - id: version_sufficient
            params: ["com.huawei.hms.payment", "petal_support_petal_single_bind_version", "10028300"]
            returns:
              ts_expr: "true as boolean"
          - id: version_insufficient
            params: ["com.huawei.hms.payment", "petal_support_petal_single_bind_version", "10028300"]
            returns:
              ts_expr: "false as boolean"
fixtures:
  - name: defaultChannelPage
    type: "string"
    ts_expr: "'HUAWEI_PAY_208_14'"
```

## 设计目的

- 将 **ArkTS 强类型** 的返回/异常表达固化在 `ts_expr` 中（含显式类型断言），避免 DAG 或 UT 里散落无类型字面量导致编译失败。
- **`contracts.yaml > interfaces[]`** 为方法名与签名的权威来源；`mock-plan` 为 **Test Double**（Spy / MockKit / Fake / prototype_patch）与 preset 的权威来源。
- DAG 节点可通过 `spy_preset` 引用 `presets[].id`（见 [dag-schema.md](dag-schema.md)）。

## Test Double 策略（`strategy`）

每条 `spies[]` 或 `doubles[]` 须声明策略（`schema_version: "1.1"` 起推荐显式 `strategy`；旧 plan 仅 `spies[]` 时 harness 视为 `spy`）：

| strategy | 适用场景 | UT 形态 |
|----------|----------|---------|
| `spy` | 依赖可注入；需要 `callLog` / DAG 追溯 | `SpyXxx` 子类 + `whenXxx.returns` |
| `mockkit` | 单例/工厂/难注入边界；Hypium 官方 mock | `import { MockKit, when } from '@ohos/hypium'`，preset 与 plan 对齐 |
| `fake` | 轻量内存替身（如无网络 Repository） | 手写 Fake 类，签名与 contracts 一致 |
| `prototype_patch` | 少量方法可安全替换 | `base_strategy: prototype_override` 或显式本 strategy |

**MockKit 约束（harness `ut_hypium_mockkit_policy` BLOCKER）**：

- 仅 mock `contracts.yaml` 已登记的 **外部 data 边界**；
- **禁止** mock 被测 Flow / Coordinator / Page handler；
- UT 导入 `MockKit`/`when` 时，mock-plan **必须**至少一条 `strategy: mockkit`（可用 `doubles[]`）；
- **禁止**在消费者工程内改 `framework/.../ts-compile.ts` 过关。

```yaml
doubles:
  - target_class: RemoteTaskGateway
    strategy: mockkit
    methods:
      - name: validateRequest
        presets:
          - id: ok_token
            returns: { ts_expr: "{ ok: true, token: 't' } as GateValidateResult" }
```

## 顶层结构

```yaml
schema_version: "1.0"
feature: "<feature>"

# 集中声明 UT/Spy 侧需要的类型 import（供代码生成参考）
imports:
  - { symbol: VerifyResult, from: "02-Feature/.../model/VerifyResult" }

spies:
  - target_class: RemoteTaskGateway           # 必须 ∈ contracts.yaml > interfaces[].class
    target_file: 02-Feature/.../api/RemoteTaskGateway.ets
    base_strategy: subclass              # subclass | prototype_override
    spy_fields:
      - { name: callLog, type: "string[]", default: "[]" }
    methods:
      - name: submitTask
        params:
          - { name: payload, type_text: "TaskPayload" }
        return_type: { text: "Promise<VerifyResult>" }
        presets:
          - id: success
            returns: { ts_expr: "{ ok: true, token: 't' } as VerifyResult" }
          - id: error_remote
            throws: { ts_expr: "new BizError('REMOTE_ERR')" }

fixtures:
  - { name: draftSample, type: "TaskPayload", ts_expr: "..." }
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

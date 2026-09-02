# Step Outcome Protocol v1 (`hylyre.step-outcome/1`)

- 协议 ID：`hylyre.step-outcome/1`
- 绑定 trace schema：`0.4-p0`
- 规范状态：**Phase 0 冻结候选**（本文件、`output-schema.json`、`builder-decision-table.md`、`golden/**` 为同一份契约包）
- 机器可执行副本：`hylyre/contracts/output-schema.json`
- 判定表：`hylyre/contracts/builder-decision-table.md`
- 样例：`hylyre/contracts/golden/**`

本文件是**规范性**文档。当散文与 `output-schema.json` 冲突时，凡 Schema 能表达的局部结构以 Schema 为准；凡 Schema 不能表达的跨行/派生规则（`prior_step` 引用、CaseResult 复算、投影一致性）以本文件与判定表为准。

---

## 0. 协议版本声明

以下 envelope **必须**声明 `"result_protocol": "hylyre.step-outcome/1"`：

| Envelope | 位置 |
|---|---|
| trace root | `trace.json` 顶层 `result_protocol`，且 `environment.result_protocol` 同值 |
| atomic CLI / MCP 单步响应 | 响应对象顶层 `result_protocol` |
| `run --steps-file` / inline batch 响应 | 响应对象顶层 `result_protocol` |
| session daemon 响应 | 响应对象顶层 `result_protocol` |
| fake / conformance 输出 | 同上 |
| pre-run reject | `pre_run_reject.result_protocol` |

`schema_version=0.4-p0` 与 `result_protocol=hylyre.step-outcome/1` 是**绑定对**：

- `0.4-p0` 缺 `result_protocol`、或 `result_protocol` 非 `hylyre.step-outcome/1` → Schema FAIL；
- `0.3-p0` / `0.2-p4` / `0.1-p0` **携带** `result_protocol` → Schema FAIL（legacy 不得伪造 v1）。

非 trace 的 entry envelope 复用 `#/$defs/stepResultV1` 作为唯一的 step 结构锚点；它们不定义第二套 step 字段。

---

## 1. StepResult v1 envelope

```json
{
  "index": 0,
  "kind": "wait_for",
  "role": "assertion",
  "duration_ms": 10000.0,
  "device_session": true,
  "outcome": {},
  "selector": null,
  "artifacts": [],
  "diagnostic": null,
  "extensions": {}
}
```

全部字段**必需出现**（可为 `null` / 空容器）。顶层 `additionalProperties=false`。

| 字段 | 类型 | 职责 |
|---|---|---|
| `index` | `integer >= 0` | 同一 CaseResult 内唯一的计划步骤序号 |
| `kind` | `string` | 计划步骤形态（`touch` / `wait_for` / `expected_check` …），仅供分组与人读 |
| `role` | `action \| assertion` | 该步骤是否参与 case verification gate |
| `duration_ms` | `number >= 0` | 实际耗时；未尝试步骤为 `0` |
| `device_session` | `boolean` | 产生该行时**是否已建立 device session**；仅用于判定 failure-boundary artifact 义务（§8） |
| `outcome` | `object` | **唯一**执行结果与机器归因（§2） |
| `selector` | `object \| null` | selector 请求与实际解析事实（§6） |
| `artifacts` | `array` | 取证引用（§8） |
| `diagnostic` | `string \| null` | 脱敏后的人读消息；**不参与任何机器路由** |
| `extensions` | `object` | 显式 namespace 扩展（§10） |

### 1.1 `diagnostic` 的硬边界

`diagnostic` 只用于展示。消费者**禁止**：解析 `diagnostic` 决定 domain/type/code；用 `diagnostic` 补齐缺失的 `failure/cause/reason`；用 `diagnostic` 判断是否 defer。缺 code 的结果是协议缺陷，不是消费者的猜测输入。

---

## 2. 四种互斥 outcome

```text
planned step
    ├── 实际尝试 (attempted)
    │     ├── passed
    │     └── failed
    └── 未实际尝试 (not attempted)
          ├── blocked
          └── skipped
```

**attempted 的定义**：该步骤已进入对应 adapter/driver 的真实操作尝试。它**不**等于 UI 最终发生了变化。因此 `observation.performed=false` + `status=failed` 是合法组合；而未 dispatch 的 `blocked` **不得**伪造 `performed=false` 的 action observation。

`status` 只由 attempted 事实决定。`capability` / `infrastructure` 是**原因域**，不自行决定 status：

| 发现时点 | attempted | 结果 |
|---|---:|---|
| 已 dispatch/尝试后才发现不支持 | 是 | `failed` + `failure.domain=capability` |
| 已 dispatch/尝试后发生 I/O 失败 | 是 | `failed` + `failure.domain=infrastructure` |
| dispatch 前由机器 resolution/probe 证明不可用 | 否 | `blocked` + `cause.type=capability` |
| dispatch 前由 device/preflight 证明不可用 | 否 | `blocked` + `cause.type=infrastructure` |

### 2.1 载体不变量

| status | attempted | 必需载体 | 禁止载体 |
|---|---:|---|---|
| `passed` | 是 | `observation` | `failure` / `cause` / `reason` |
| `failed` | 是 | `failure`（可带 `observation`） | `cause` / `reason` |
| `blocked` | 否 | `cause` | `failure` / `reason` / `observation` |
| `skipped` | 否 | `reason` | `failure` / `cause` / `observation` |

### 2.1.1 StepResult 局部一致性（Schema 强制）

载体互斥之外，Schema 还在**单个 StepResult 内**强制以下四条，防止 0.3-p0 的矛盾组合换个形状复活：

| # | 规则 | 被消灭的旧矛盾 |
|---|---|---|
| L-1 | `role=assertion` 时 `observation.kind` 必须是 `assertion`；`role=action` 时必须是 `action` | `role=assertion` 却挂 action observation |
| L-2 | `blocked` / `skipped` 且 `selector` 非 null 时，`resolution.state` 必须是 `not_attempted` | 未尝试的步骤却上报 `unique`/`not_found` 解析结果 |
| L-3 | `failed` 且带 assertion observation `matched=false` 时，`failure.domain` 必须是 `assertion` | `role=assertion + observed_present=false + failure_kind=selector`（需求 §3.1 点名的原始问题） |
| L-4 | `failed` 的 `failure.code` 不得为 `contract.empty_case` | 空 case 被包装成 failed step |

L-3 的推论：如果 selector 失败导致断言**根本没被评估**，该 step 就**不应**携带 assertion observation（`failed` 允许省略 observation）。「有 assertion observation」等于「断言真的跑了」。

> **[D-1] 解释决定（review 已裁决：接受）**：需求 §5.1 表述为「blocked/skipped 禁止 failure 与**成功** observation」。JSON Schema 无法表达「成功与否」这一语义谓词，且需求 P0-7A 明确禁止未 dispatch 的 blocked 伪造 `performed=false` observation；协议中也没有任何 blocked/skipped 需要携带 observation 的场景（其机器事实由 `cause.facts` / `reason.facts` 承载）。因此本规范把该禁令收紧为「blocked/skipped 一律不得携带 `observation`」，使非法组合在 Schema 层不可表达。这是**收紧**，不是改义。
> **裁决（2026-08-31，两个独立 review 一致接受）**：收紧后没有丢失任何合法表达力。未来若出现「决定不尝试时确有观测」的场景，走 namespaced extension，或在下一个协议版本重开该讨论。

### 2.2 `passed` variant

```json
{
  "status": "passed",
  "observation": {
    "kind": "assertion",
    "assertion_type": "presence",
    "matched": true,
    "facts": { "expected_present": true, "observed_present": true }
  }
}
```

`passed` **必须**有与 operation 对应的 observation。**禁止**「assertion 返回 `None` 即默认通过」。Schema 额外强制：`passed` + assertion observation ⇒ `matched=true`；`passed` + action observation ⇒ `performed=true`。

### 2.3 `failed` variant

```json
{
  "status": "failed",
  "failure": { "domain": "assertion", "code": "assertion.mismatch" },
  "observation": {
    "kind": "assertion",
    "assertion_type": "presence",
    "matched": false,
    "facts": { "expected_present": true, "observed_present": false }
  }
}
```

`failure` 只描述**本 step 自己**实际发生的失败。它是唯一可路由的根事件。Schema 强制：`failed` + assertion observation ⇒ `matched=false`。

### 2.4 `blocked` variant

```json
{ "status": "blocked", "cause": { "type": "prior_step", "step_index": 0 } }
```

```json
{
  "status": "blocked",
  "cause": {
    "type": "capability",
    "code": "capability.unsupported",
    "capability_id": "toast_listener",
    "provider_id": "hypium",
    "facts": { "probe_status": "unsupported", "probe_source": "runtime_preflight" }
  }
}
```

```json
{
  "status": "blocked",
  "cause": {
    "type": "infrastructure",
    "code": "infrastructure.device_unavailable",
    "facts": {
      "probe_status": "unavailable",
      "probe_source": "device_preflight",
      "resource_kind": "device"
    }
  }
}
```

`cause.type` v1 核心枚举**冻结**为 `prior_step | capability | infrastructure`；未知 core type **必须 Schema FAIL**。各 variant 的必需/禁止字段：

| type | 必需 | 禁止 |
|---|---|---|
| `prior_step` | `step_index >= 0` | `code` / `capability_id` / `provider_id` / `facts` |
| `capability` | `code=capability.*`、非空 `capability_id`、`facts.probe_status` + `facts.probe_source` | `step_index` |
| `infrastructure` | `code=infrastructure.*`、`facts.probe_status` + `facts.probe_source` | `step_index` |

`prior_step` 的**跨行**不变量（verifier 负责，Schema 无法表达）：

1. 只能引用**同一 CaseResult** 内 `step_index < 本 step.index` 的行；
2. 目标必须是**真实根 outcome**：`failed`，或 `blocked` 且 `cause.type ∈ {capability, infrastructure}`；
3. **禁止** `prior_step → prior_step` 因果链；
4. **禁止跨 case 引用** index。设备在 case 中途死亡时，后续 case 的首个 step 以**新的机器 probe** 形成自己的 root `blocked/infrastructure`。

**多个先前根的选择（冻结）**：同一 case 内存在多个更早的合法根时（例如 batch `on_fail=skip` 下连续两个 `failed`），

> `prior_step` **MAY** reference any earlier eligible real root outcome in the same case; the nearest eligible root is **not** required.

即：builder 可以引用任意一个满足上述 1–4 的根。协议**不引入** root-selection 状态、排序规则或去重机制。消费者只校验引用是否合法，随后对该 `prior_step` 行产生 **0 条** failure route / disposition，**不得**按「最近根」重新推断归属。

`cause.facts` 是 capability/external disposition 的**机器依据**，不是人读 notes。只有 `diagnostic` 散文、没有 `facts` 的 capability/infrastructure 声明**不能**驱动 defer，也不得由下游补猜。

### 2.5 `skipped` variant

```json
{
  "status": "skipped",
  "reason": { "type": "policy", "code": "expected_check.disabled_by_flag" }
}
```

`reason.type` v1 核心枚举**冻结**为 `policy | not_applicable`；未知 core type **必须 Schema FAIL**。

- `policy`：必需 namespaced `code`；涉及能力可用性的 code（`expected_check.unavailable_no_vlm`、`optional_check.on_unsupported_skip`）**必需** `facts.probe_status` + `facts.probe_source`；
- `not_applicable`：只允许已注册的不适用 code。

`reason` 禁止携带 `failure` / `cause`；`facts` 只补充机器事实，不改变「未执行」语义。

`skipped` 表示明确的策略/可选路径，**不等于** capability failure。VLM/Toast 是 **required** 契约时：dispatch 前机器证明能力缺失 → `blocked/capability`；已 dispatch 后才失败 → `failed/capability`。

---

## 3. failure / cause / reason 分工

| 载体 | 回答的问题 | 是否 responsibility event | 下游投影 |
|---|---|---|---|
| `failure` | 本步骤**执行了**并失败了，怎么失败的 | **是**（唯一 failure route） | failure route；`domain=capability` 的 route disposition 为 capability defer 且 0 coding candidate |
| `cause` | 本步骤**没执行**，被什么挡住了 | 否 | `capability` → 1 次 capability defer；`infrastructure` → 1 次 external/toolchain disposition；`prior_step` → 不投影 |
| `reason` | 本步骤**没执行**，依据哪条策略 | 否 | 不投影为缺陷 |

硬规则：

1. 根失败的 `failure.domain/code` **禁止**复制给后缀 blocked 步骤（0.4.1 的放大源）；
2. 根 cause（`capability` / `infrastructure`）**只投影一次**，后续 `prior_step` 不重复；
3. `blocked` / `skipped` **不产生** failure route，也不进入 coding/owner candidate；
4. Case/Markdown notes 优先展示真实 failed step，并汇总「后续 N 步未执行」；**不得**把 N 个 blocked 记成 N 个缺陷。

---

## 4. 四个 code 面注册表与扩展规则

v1 有且只有四个 code 面。它们**互不通用**：不得把 `failure.code` 写进 `cause.code`，反之亦然。

### 4.1 `failure.code`（域前缀命名空间）

`domain` 是**封闭稳定大类**：`contract | selector | assertion | capability | infrastructure | internal`。
`code` 的**第一段必须等于 `domain`**；域与 code 前缀冲突 **Schema FAIL**。

| domain | core code | 语义 |
|---|---|---|
| `contract` | `contract.invalid_step` | 步骤形态非法（运行时才发现的动态违例） |
| `contract` | `contract.invalid_selector` | selector 契约非法 |
| `contract` | `contract.invalid_match` | `match` 非 `exact`/`contains` |
| `selector` | `selector.not_found` | resolver 已完成且确定 0 候选 |
| `selector` | `selector.ambiguous` | >= 2 候选且未消歧 |
| `selector` | `selector.inline_unresolvable` | inline/fragment 目标无法解析 |
| `assertion` | `assertion.mismatch` | 断言已执行并得到负面结果 |
| `capability` | `capability.unsupported` | 已 dispatch 后 adapter 返回不支持 |
| `infrastructure` | `infrastructure.device_unavailable` | 已尝试后设备不可用 |
| `infrastructure` | `infrastructure.transport_failure` | 已尝试后 transport/I-O 失败 |
| `internal` | `internal.unexpected_exception` | 未预期异常（driver crash / internal bug） |

**禁止**：为维持旧枚举把 invalid contract 压成 `selector.not_found`；把普通 `ValueError` 压成 `infrastructure.*`；解析 `diagnostic`/`error` 文本决定分类。

`contract.empty_case` **不在** `failure.code` 注册面内：空 case 没有合法 step 可承载 StepResult，它只能是 §11 的 pre-run reject code。Schema 对 `failed` 携带 `contract.empty_case` 直接 FAIL。

#### 4.1.1 pre-run reject code（独立注册面）

只用于 §11 的 `pre_run_reject.rejection.code`，**不得**出现在任何 StepResult 上：

| pre-run code | 语义 |
|---|---|
| `contract.empty_case` | case 无可执行步骤 |
| `contract.invalid_step` | 静态非法 step（语法 / 根键） |
| `contract.invalid_selector` | 静态非法 selector 契约 |
| `contract.invalid_match` | 静态非法 `match` |

### 4.2 `cause.code`

| type | core code | 必需 facts |
|---|---|---|
| `capability` | `capability.unsupported` | `probe_status`、`probe_source` |
| `capability` | `capability.not_configured` | `probe_status`、`probe_source` |
| `infrastructure` | `infrastructure.device_unavailable` | `probe_status`、`probe_source` |
| `infrastructure` | `infrastructure.transport_unavailable` | `probe_status`、`probe_source` |

`cause.type=prior_step` **没有** code。

### 4.3 `reason.code`

| type | core code | 必需 facts |
|---|---|---|
| `policy` | `expected_check.disabled_by_flag` | 无（flag 是计划输入，不是 probe） |
| `policy` | `expected_check.unavailable_no_vlm` | `probe_status`、`probe_source` |
| `policy` | `optional_check.on_unsupported_skip` | `probe_status`、`probe_source` |
| `not_applicable` | `expected_check.empty` | 无 |

### 4.4 `resolution.reason_code`（仅 `resolution.state=unresolvable`）

| core code | 语义 |
|---|---|
| `selector.dump_unavailable` | dump 不可得（设备/transport） |
| `selector.dump_unreadable` | dump 已取到但不可解析 |
| `selector.request_incomplete` | 计划 selector 契约不完整，未能进入 resolver |
| `selector.resolver_unsupported_form` | resolver/API 不支持该 selector 形态 |
| `selector.inline_fragment_unresolvable` | inline/fragment 目标无法定位到结构化节点 |
| `selector.provider_unavailable` | 解析所需 provider/capability 不可用 |

### 4.5 扩展规则（四面统一）

- core code 由本注册表管理；**新增 core code 必须同批更新** Schema、本文件、判定表与 golden fixtures；
- vendor/adapter 扩展码**必须**带自己的 namespace 段 `x_<vendor>`：
  - `failure.code` → `<domain>.x_<vendor>.<name>`
  - `cause.code` → `capability.x_<vendor>.<name>` / `infrastructure.x_<vendor>.<name>`
  - `reason.code` → `x_<vendor>.<name>`
  - `resolution.reason_code` → `selector.x_<vendor>.<name>`
- **无 namespace 的裸 code 一律 Schema FAIL**；
- 消费者先按 `domain` / `type` 稳定路由；unknown code 仍可按 domain/type **fail-closed**，不要求升级大类逻辑；
- `probe_status` 核心值 `unsupported | unavailable | not_configured | offline`，vendor 扩展用 `x_<vendor>` 前缀 token。

---

## 5. Observation 协议

`observation` 只描述本步骤**实际执行或观测到**的 operation/assertion 事实。`capability` 与 `infrastructure` 是归因域，进入 `failure.domain` / `cause.type` 或其结构化 facts，**不得**作为平行的 `observation.kind` 形成第二套分类真源。

`observation.kind` 只有 `action` 与 `assertion`。

### 5.1 Action observation

```json
{ "kind": "action", "operation": "touch", "performed": true, "facts": {} }
```

`performed` 表示 operation 是否实际产生了效果，与 attempted 无关。`performed=false` + `failed` 合法（例如 selector 0 候选导致 action 未生效）。

### 5.2 Assertion observation

```json
{ "kind": "assertion", "assertion_type": "presence", "matched": true, "facts": {} }
```

核心 facts（Schema 强制必需，且 `matched` 与 facts 一致性由 Schema 强制）：

| `assertion_type` | 必需 facts | `matched` 一致性 |
|---|---|---|
| `presence` | `expected_present`(const `true`)、`observed_present` | `matched == observed_present` |
| `absence` | `expected_present`(const `false`)、`observed_present` | `matched == !observed_present` |
| `toast` | `channel`、`observed`、`trigger_window_covered` | `matched == observed` |
| `expected` | `channel`、`instruction_checked`(const `true`)、`matched` | `matched == facts.matched` |
| `custom` | 无核心必需项 | 由 namespaced extension 描述 |

`facts` 允许附加机器事实（`additionalProperties` 开放），但**不得**新增顶层自由字段，也不得用 facts 覆盖 `matched`/`status`。

`toast` 的 `trigger_window_covered=false` 是**显式的非验证证据**，不是成功触发断言；它不改变 `matched`，但会令 CaseResult `evidence=incomplete`（§9）。

---

## 6. Selector request / resolution 协议

```json
{
  "request": { "kind": "by_id", "value": "bank_row_bocom", "match": null, "constraints": {} },
  "resolution": { "state": "not_found", "candidate_count": 0, "selected": null, "candidates": [] }
}
```

`request` 描述**计划意图**；`resolution` 描述**执行器实际发现**。两者结构隔离，`selected` 永远不得回填请求 ID。

`request.kind ∈ {by_id, by_text, by_key, by_type, coordinates, composite}`；`request.match ∈ {exact, contains, null}`；`constraints` 承载 `all/scope/within/index/below/above/visible/...` 等嵌套约束，其内容必须与实际下发给 resolver 的谓词一致。

### 6.1 resolution 状态机不变量

| `state` | `candidate_count` | `selected` | `candidates` |
|---|---|---|---|
| `not_attempted` | `null` | `null` | `[]` |
| `not_found` | `0` | `null` | `[]` |
| `unique` | `1` | `{id, bounds?}` | 长度 <= 1 |
| `ambiguous` | `>= 2` | `null` | 长度 >= 2 |
| `unresolvable` | `null` 或 `>= 0` | `null` | 任意 |

`selected` 的身份可以由 `id` 或 `bounds` 承载：纯文本匹配到的节点**可能没有结构化 id**（resolver 的 `id` 属性为空），此时 `selected.id=null` 而 `bounds` 非空是**合法**的诚实表达。Schema 只要求 `selected` 至少有一项非空——**禁止**空壳 `selected`，也**禁止**把 request 回填进 `selected` 充当身份。

Schema 直接拒绝：`candidate_count=0` + 非空 `selected.id`；`candidate_count>1` + 非空 `selected`；`not_attempted` + 伪造 `candidate_count`；`selected` 的 `id` 与 `bounds` 同时为空。
verifier 额外复算：`candidates` 非空时 `candidate_count == len(candidates)`（`unresolvable` 且 `candidate_countable=false` 时豁免）。

`not_found` 表示 **resolver 已完成**且确定 0 候选。**不得**用它代替 dump 不可得或 resolver 未完成的 `unresolvable`。

#### native（provider 侧解析）路径的 resolution

当解析由 provider（Hypium）完成而非 Hylyre 自己的 resolver 时，`resolution` 仍然只能描述**执行器实际发现**，按观测事实派生：

| 观测事实 | request kind | `resolution.state` |
|---|---|---|
| 目标在场 | `by_id` / `by_key` | `unique`，`selected.id` 取该结构化身份 |
| 目标在场 | 其它（如 `by_text`） | `not_attempted` —— provider 解析了它，Hylyre 没看到节点身份 |
| 目标不在场 | 任意 | `not_found` |
| provider 无法作答 | 任意 | `not_attempted` |

**禁止**在目标不在场或身份不可见时报 `unique`：那等于把 request 回填进 `selected` 充当身份（§3.3）。步骤成功与否由 observation 承载，`not_attempted` 的 resolution 不会掩盖失败。

### 6.2 `unresolvable` 必需 facts

`unresolvable` 不是空状态。必需 `reason_code`（§4.4）与结构化 `facts`：

| facts | 类型 | 说明 |
|---|---|---|
| `dump_status` | `available \| unavailable \| unreadable` | 设备事实是否可得 |
| `request_complete` | `boolean` | 计划 selector 契约是否完整 |
| `resolver_entered` | `boolean` | 是否成功进入对应 resolver |
| `candidate_countable` | `boolean` | 候选数是否可计算；为 `false` 时 `candidate_count` **必须** `null`，不得伪造 `0` |
| `fragment_anchor` / `fragment_bounds` | `string \| null` | inline/fragment 场景的线索 |
| `provider_probe` | `probeFacts` | resolver/API 不支持该形态时的实际 capability/provider probe 来源 |

除上述通用 facts 外，Schema 按 `reason_code` 强制附加条件，防止「声称 unresolvable 但没给出该分支的关键事实」：

| `reason_code` | 附加强制 |
|---|---|
| `selector.resolver_unsupported_form` | 必需 `facts.provider_probe` |
| `selector.provider_unavailable` | 必需 `facts.provider_probe` |
| `selector.inline_fragment_unresolvable` | 必需**显式出现** `facts.fragment_anchor` 与 `facts.fragment_bounds`（值可为 `null`，但不得缺席） |
| `selector.dump_unavailable` | `facts.dump_status` 必须为 `unavailable` |
| `selector.dump_unreadable` | `facts.dump_status` 必须为 `unreadable` |
| `selector.request_incomplete` | `facts.request_complete` 必须为 `false` |

这些 facts 用于区分「计划契约不完整 / 运行时目标不存在 / resolver 能力不足 / 设备事实不可得」四种边界。Maison **不得**再从 `diagnostic` 猜责任。

### 6.3 隐私边界（继承 0.4.1，不回退）

- `request.value`（当 `kind ∈ {by_id, by_key}`）、`resolution.selected.id`、`candidates[].id` 为**结构化身份**，逐字保留；
- `bounds` 是机器证据，逐字保留；
- `by_text` / 文本值 / `instruction` / `expected` / `actual` / `diagnostic` 继续脱敏；
- serializer 只做隐私处理，**不改变** outcome/resolution 语义；
- trace / Markdown / MCP 对同一 ID 的处理必须一致。

---

## 7. 瞬态 `OperationOutcome`

所有 driver/agent operation 返回同一瞬态 tagged union：

```text
OperationPassed | OperationFailed | OperationBlocked | OperationSkipped
```

它与 `StepResult.outcome` **同构**，但不含 `index/kind/role/duration_ms/device_session`；ledger builder 只负责附加这些 envelope 字段、附加 selector/artifacts/diagnostic 并序列化。

`OperationOutcome` 是**瞬态内存接口**：不持久化、不成为第二真源、不写入 trace。

**预期负面结果必须作为结构化 outcome 返回**（不是异常）：selector 0/多候选、assertion `matched=false`、capability unsupported、infrastructure unavailable、policy skip。

**Python exception 只用于未预期异常**：driver crash、非预期 I/O、internal bug。未预期 exception 统一变为 `failed + internal.unexpected_exception`，或在有机器事实时的明确 `infrastructure.*`。**禁止**根据 exception message 搜索字符串决定 domain/code。

唯一 builder 的接线要求见 `builder-decision-table.md`。

---

## 8. Artifacts 与 failure boundary

```json
{ "kind": "screenshot|ui_dump|visible_elements|log", "path": "relative/artifact/path", "sha256": "<64 hex>" }
```

`path` 必须是相对路径（禁止绝对路径、盘符与 `..`）；`sha256` 为 64 位小写 hex。

#### `path` 的解析基准（冻结）

`artifacts[].path` **一律相对于承载该 StepResult 的 authoritative trace 文件所在目录**解析：

```text
resolved_path = resolve(dirname(trace_path), artifact.path)
```

不变量：

- `path` **必须**保持相对路径；
- 解析并规范化后**不得逃逸** trace 所在目录树；
- **禁止**绝对路径、盘符路径，以及任何使 `..` 逃逸出该目录树的形式；
- artifact 存在时，消费者**用解析后的文件**计算并校验声明的 `sha256`；
- **不存在第二套隐含基准**：没有 run-dir、reports 根目录之类的备用基准，也**不依赖生产者或消费者的当前工作目录**。

生产者义务：写入 trace 的 producer **必须**按该基准记录 `path`（Hylyre 把 failure 目录放在 trace 文件旁，因此记录形如 `failures/<label>.png`），**不得**写绝对路径。

**不产 trace 的入口**（atomic CLI/MCP、inline batch 响应）没有可供相对的 trace，其 `path` 相对于调用方自己传入的 `failure_dir`。这不是第二套隐含基准——该目录由调用方显式提供，且这些响应本就不是 evidence 真源。

### 8.1 failure-boundary screen artifact（必填条件）

当且仅当：`device_session = true` **且** `outcome.status = failed` **且** `failure.domain ∈ {selector, assertion}`，
该 step **必须**满足二者之一：

1. `artifacts` 至少含一项 `kind ∈ {screenshot, ui_dump, visible_elements}`；或
2. 采集本身因设备/transport 不可用而失败时，在 namespaced extension 中记录：

```json
"extensions": { "hylyre.capture": { "screen": "unavailable", "reason_code": "infrastructure.transport_failure" } }
```

并令该 case 的 `evidence = incomplete`（§9）。**禁止伪造 artifact**。

**不适用**该必填条件：执行前 contract failure、`blocked/capability`、`blocked/infrastructure`（device-unavailable）、`skipped`、`passed`、`device_session=false`。

### 8.2 范围限制（防止取证膨胀）

该要求**只**覆盖上述真实根失败的 failure boundary，**每个根失败最多一组关联 artifact**。**禁止**扩张为：每个 step 截图、成功路径强制取证、blocked/skipped 重复截图，或因 artifact 机制新增第二份步骤 ledger。

> **[D-2] 解释决定（review 已裁决：接受）**：需求 §5.2 与 §9 要求 Schema 校验「device session 内实际尝试的 selector/assertion 根失败」的 failure-boundary artifact，但需求 §5.2 列出的 envelope 没有可供**单对象**判定 device session 的字段。本规范因此在 envelope 增加**唯一**一个核心布尔字段 `device_session`，使该义务成为 Schema 可判定的局部组合规则，而不是无人执行的散文。capture-unavailable 逃生口使用需求明确允许的 namespaced extension。降级为 verifier 跨行规则不可行：该事实不随 step 序列化，verifier 也无法从 trace 复算。
> **裁决（2026-08-31，两个独立 review 一致接受）**：一个布尔是使该义务可判定的最小机制。**Phase 1 附带验收点**：builder 必须从真实机器事实填写 `device_session`，禁止硬编码常量。

---

## 9. CaseResult / RunResult 纯派生

```text
CaseResult = reduce(StepResult[])
```

入口**不得**自由填写三轴。

### 9.1 `execution`

| 值 | 条件 |
|---|---|
| `infrastructure_failed` | 存在 `failed/failure.domain=infrastructure`，或存在 root `blocked/cause.type=infrastructure` |
| `aborted` | 否则存在任一 `failed`，或存在 root `blocked/cause.type=capability` |
| `completed` | 否则 |

### 9.2 `verification`

只根据 **required assertion** 的 assertion observation/matched 推导。
required assertion = `role=assertion` 的 step，排除 `kind=expected_check` 且 `expected_check_mode ∈ {disabled_by_flag, unavailable_no_vlm}` 的行。

| 值 | 条件 |
|---|---|
| `failed` | `execution != completed`；或任一 step `failed`；或任一 step `blocked` |
| `inconclusive` | 否则存在 required assertion 为 `skipped`；或无 required assertion；或存在 required assertion `passed` 但 evidence 不完整 |
| `passed` | 否则全部 required assertion 均 `passed`、且 `evidence=complete`、且 `expected_check_mode=checked_vlm` 时恰有一条 `passed` 的 `expected_check` |

`verification=passed` 且 `evidence != complete` ⇒ 降级为 `inconclusive`。

### 9.3 `evidence`

| 值 | 条件 |
|---|---|
| `incomplete` | 任一 `passed` step 缺 observation（Schema 已保证不会发生）；或任一 required assertion `passed` 的 toast observation `trigger_window_covered=false`；或任一 §8.1 适用步骤走了 capture-unavailable 逃生口 |
| `complete` | 否则 |

### 9.4 `expected_check_mode`

策略输入（不是派生结果），决定 expected-check 是否为 required assertion：`checked_vlm | disabled_by_flag | unavailable_no_vlm | empty`。

### 9.5 legacy 中文 `status`

只作兼容投影，**不得**反向生成三轴：

```text
execution=infrastructure_failed              -> 阻塞
verification=passed                          -> 通过
存在 failed step                              -> 失败
存在 blocked step                             -> 阻塞
全部 step 均为 skipped                        -> 跳过
其它（inconclusive）                          -> 跳过
```

### 9.6 RunResult

`outcome ∈ {success, partial, failed, aborted}` 由 CaseResult 推出，输入必须是 v1 语义。按顺序取第一条命中：

| 顺序 | 条件 | outcome |
|---:|---|---|
| 1 | 没有任何 case | `aborted` |
| 2 | 全部 case 均为 `completed` + `passed` + `complete` | `success` |
| 3 | 存在 `execution=infrastructure_failed`，或任一 case 含 `blocked` step | `failed` |
| 4 | 存在 `verification=failed` 且存在完全通过的 case | `partial` |
| 5 | 存在 `verification=failed` | `failed` |
| 6 | 其它（全部 inconclusive / skipped） | `partial` |

`tool_calls`、Markdown、pass-rate **不得**反向覆盖 trace。

### 9.7 expected-check 与 `expected_check_mode` 的一致性（verifier）

`expected_check_mode=checked_vlm` 表示 VLM 可用且策略要求执行 expected 检查。此时 `expected_check` 行**只能**是 `passed` / `failed` / `blocked`，**不得**是 `skipped` —— 尤其不得写成 `skipped/policy/expected_check.unavailable_no_vlm`（判定表 D-28）。前序失败导致未执行时是 `blocked/prior_step`。

---

## 10. 扩展点

顶层 `additionalProperties` 默认关闭。扩展只能放：

```json
"extensions": { "vendor.namespace": {} }
```

namespace 必须匹配 `^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_.-]*$`，值必须是 object。核心字段**不能**被 extension 覆盖或重新解释。

`observation.facts` / `failure.facts` / `cause.facts` / `reason.facts` / `resolution.facts` 允许附加机器事实，但不得改变 status/domain/type/code，也不得覆盖 selector resolution 或 artifact。

---

## 11. Pre-run contract reject（P0-7B）

空 case、静态非法 step/match 等在**设备执行前**被拒绝时，没有合法 StepResult 可承载结果，因此不生成 trace / CaseResult / test-report；但这仍是**协议内**的 plan validation 决策，不是进程 crash。

`hylyre run --plan` 与 `hylyre run --steps-file`（report mode）必须：

1. 在 **stdout 输出且只输出一个 UTF-8 JSON object**；日志/人读说明只能写 stderr；
2. 返回固定 exit code **`2`**；
3. **不连接设备**，不创建或改写 `--trace-out` / `--report-out`；
4. 输出满足 `output-schema.json` 的 `#/$defs/pre_run_reject`：

```json
{
  "result_protocol": "hylyre.step-outcome/1",
  "command_status": "rejected",
  "phase": "pre_run_validation",
  "rejection": {
    "domain": "contract",
    "code": "contract.empty_case",
    "case_id": "TC-001",
    "step_index": null,
    "path": "cases[TC-001].steps",
    "summary": "case contains no executable planned step"
  }
}
```

不变量：

- `rejection.domain` 恒为 `contract`，`code` 必须是已注册的 `contract.*`（`empty_case` / `invalid_step` / `invalid_selector` / `invalid_match`）；
- `case_id` / `step_index` 在适用时提供，否则显式 `null`；`summary` 仅供人读，**不参与分类**；
- validator 按稳定顺序返回**首个**违规；不新增错误聚合状态；Maison **不解析 stderr** 猜错误；
- `contract.empty_case` **不得**被包装成 failed/skipped CaseResult，也不得生成空 CaseResult 或用 skipped 冒充覆盖。

该 envelope **只**服务可预期的 pre-run validation reject，不扩展到 trace 创建前的任意 Python crash；后者继续使用既有 subprocess 兜底。

---

## 12. `tool_calls` 投影

`tool_calls` 是 trace 的**有损投影**，不是 evidence 真源。每条至少固定映射：

```text
case / index / kind / role / outcome.status
failed  -> outcome.failure.domain, outcome.failure.code
blocked -> outcome.cause.type, outcome.cause.code?, outcome.cause.step_index?
skipped -> outcome.reason.type, outcome.reason.code
```

必须保留与 StepResult **相同的嵌套字段名**（`outcome.failure|cause|reason`）；**禁止**发明 flat `failure_kind` 或自由 status 别名。
不要求复制完整 observation、selector candidates、artifacts 或 facts；但**不得**生成 trace 中不存在的 failure/cause/reason，也不得被 Maison 反向用于补齐 trace。

---

## 13. 职责边界（冻结）

| 层 | 负责 | 不负责 |
|---|---|---|
| **JSON Schema** | 单对象结构、variant 互斥、必需/禁止字段、基础格式、局部组合（含 §8.1 failure-boundary） | 跨行引用、CaseResult 复算、投影一致性 |
| **StepResult builder** | 从 operation facts 唯一构造合法 variant | 聚合、校验 |
| **Case/Run reducer** | 跨 step 聚合三轴与 run outcome | 结构校验 |
| **verifier** | `prior_step` 同 case/较小 index/根引用、CaseResult 三轴复算、`candidate_count` 复算、§9.7 expected-check 策略、trace/Markdown/tool_calls 投影一致性 | 在 Python 中重复一套 variant 结构校验 |

契约包内的 [`reference_reducer.py`](reference_reducer.py) 是 reducer + verifier 两层的**规范性可执行 oracle**：它实现 §9 与 §12 的字面规则，对 `golden/trace/valid/**` 必须零违规，对 `golden/trace/invalid-crossrow/**` 必须逐个拒绝。Phase 1 的生产实现与 Maison 的消费端都以它为验收基准；它本身不产生 ledger、不落盘、不构成第二真源。

**必须删除**：`hylyre/harness/runner.py` 中 `status != passed → failure_kind/failure_code 必填` 的旧规则（0.4.1 位于该文件第 151–157 行），以及其它与新 Schema 冲突的旧规则。**不换名复制**。

JSON Schema 无法单独证明 CaseResult 三轴与整组 steps 的归约一致，也无法证明跨行引用与投影一致；这些必须由 reducer/verifier conformance 验收，不能写成「Schema 已保证」后实际无人执行。

---

## 14. Legacy 隔离与 fail-closed dispatch

### 14.1 隔离

- 0.5.0 新运行一律输出 `0.4-p0 + hylyre.step-outcome/1`；
- legacy 路径（`report begin/record/finalize`、0.3-p0/0.2/0.1 历史产物）**不得**生成 `0.4-p0`、**不得**声明 `result_protocol`（Schema 强制）；
- **不**把旧 flat StepResult 自动补字段或转换成 v1 evidence；
- **不**在同一 run 混用 0.3 与 0.4 step；
- 本协议**不**提供 0.3-p0 迁移工具或完整读取兼容；保留的人工诊断读取是非阻断能力。

### 14.2 dispatch 顺序（所有读取入口共用）

```text
(schema_version, result_protocol)
  ├── (0.4-p0, hylyre.step-outcome/1) -> v1 typed parse
  ├── (0.3-p0 | 0.2-p4 | 0.1-p0, 无 result_protocol) -> legacy_unsupported_for_evidence
  └── 其它组合 / 缺协议字段 / 未知未来 schema -> unsupported_schema_or_protocol（显式失败）
```

**禁止** schema 不匹配后返回空 checks、SKIP、改读中文 status、flat fields、`tool_calls`/log 或 legacy telemetry。

### 14.3 无 trace 的非零退出

冻结判定顺序：

1. 先按 §11 解析 stdout 的 `pre_run_reject`；`exit code = 2` 且 envelope 合法 → **plan contract reject**（testing/plan contract，不是 crash）；
2. envelope 缺失/非法/协议错配 → 才进入既有「无 trace subprocess crash」分类；
3. stderr 只用于显示，**不参与** contract/infra/crash 的机器分型。

---

## 15. Golden fixtures

`hylyre/contracts/golden/` 与本文件、Schema、判定表是**同一契约包**，随 source/wheel 发布，安装后可离线读取。目录约定即预期（没有运行时 fixture manifest）：

```text
golden/<target>/valid/*.json         -> 必须通过 <target> 对应的 schema 节点
golden/<target>/invalid/*.json       -> 必须被 <target> 对应的 schema 节点拒绝
golden/trace/invalid-crossrow/*.json -> 必须通过 Schema，但必须被 reducer/verifier 拒绝
```

第三个 bucket 是有意的：跨行规则（`prior_step` 根引用、CaseResult 三轴复算、run outcome、投影一致性、`candidate_count` 复算、§9.7）**Schema 无法表达**，所以这些样例在单对象层面完全合法。它们存在的意义是：任何声称实现了 reducer/verifier 的代码（Hylyre Phase 1 的生产实现，或 Maison 的消费端）都必须拒绝它们；如果全绿，说明跨行校验根本没跑。

`<target>` 到 schema 节点的映射：

| `<target>` | schema 节点 |
|---|---|
| `trace` | schema root |
| `step` | `#/$defs/stepResultV1` |
| `outcome` | `#/$defs/outcomeV1` |
| `cause` | `#/$defs/causeV1` |
| `reason` | `#/$defs/reasonV1` |
| `observation` | `#/$defs/observationV1` |
| `selector` | `#/$defs/selectorV1` |
| `resolution` | `#/$defs/selectorResolutionV1` |
| `artifact` | `#/$defs/artifactRef` |
| `tool-call` | `#/$defs/toolCallV1` |
| `case` | `#/$defs/caseResultV1` |
| `pre-run-reject` | `#/$defs/pre_run_reject` |

Maison **直接消费这一组** Schema/判定表/fixtures，不得另抄一套同义副本，也不得把 0.3-p0 flat reader 当临时生产接口。

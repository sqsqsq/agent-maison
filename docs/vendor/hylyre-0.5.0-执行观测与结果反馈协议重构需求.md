# Hylyre 0.5.0 执行观测与结果反馈协议重构需求

- 提出方：Maison framework（hmos-app profile 以 source vendor 方式集成 Hylyre）
- 目标版本：**Hylyre 0.5.0**
- 目标结果协议：**`hylyre.step-outcome/1`**
- 目标 trace schema：**`0.4-p0`**
- 问题基线：**Hylyre 0.4.1 / trace schema 0.3-p0**
- 交付前提：**不发布、不集成任何中间运行版本；0.5.0 完成后由 Maison 一次集成并进入宿主正式回归**
- 关联历史需求：`docs/vendor/hylyre-断言与证据完整性需求.md`
- 关联历史修复：`docs/vendor/hylyre-0.4.1-结构化Selector身份脱敏修复需求.md`
- 真实回灌：SimulatedWalletForHmos / `bc-openCard-1` / run `20260830T164617Z-771`
- 日期：2026-08-31

## 一、结论与优先级

Hylyre 0.4.1 已完成三项重要修复：

1. `wait_for`/`wait_gone` 开始消费底层返回值，不再空断言假通过；
2. `CaseResult.steps[]` 成为 trace 的运行时 ledger；
3. 结构化 selector identity 不再被文本脱敏规则破坏。

但真实设备联调证明，当前问题不再是某条 `wait_for` 或某个 failure code 写错，而是 **执行发现 → 结果传递 → ledger 记录 → trace 持久化 → 报告反馈** 之间没有一套统一、可判定、可扩展的结果协议。

0.4.1 的 `StepResult` 是一个扁平字段容器，不是带判别类型的 Outcome 协议。它允许并且当前规范主动要求产生互相矛盾的组合，例如：

```text
status=blocked + evidence.executed=false + failure_kind=selector
status=skipped + expected_check_mode=disabled_by_flag + failure_kind=capability
candidate_count=0 + selected_id=<请求 ID>
role=assertion + observed_present=false + failure_kind=selector
```

结果是一次真实根失败在 Maison 中被放大成 56 条 selector failure 与 14 条 capability defer；更普遍地，任何新增 operation 都可能再次因为 `None/bool/dict/exception` 的解释不同而产生新的语义冲突。

**本需求不再以 0.4.2 patch 修补具体组合，而要求 Hylyre 0.5.0 重构为统一的 Step Outcome Protocol v1。** 新协议必须让非法组合在类型/Schema 层不可表达，所有入口共享同一归一化路径，Maison 不再承担猜测或二次分类。

本次不存在“Maison 临时消费 0.4.1 新语义”的过渡期。提速方式不是保留双协议或降低证据门槛，而是先冻结可执行契约，让 Hylyre 实现侧与 Maison 消费侧并行开发；只有 0.5.0 真实实现完成、集成并通过宿主回归后，才能宣称新协议交付。

## 二、当前工作流与每层实际协议

当前主链可以概括为：

```text
test-plan / steps / MCP payload
        ↓
dispatch_planned_step
        ↓
HylyreAgent.run_planned_*
        ↓
UiDriver/Hypium 发现执行结果
        ↓
任意返回值或 Python exception
        ↓
execute_ledger_step / result_from_exception
        ↓
StepResult
        ↓
ScenarioRunner.case_verdict
        ↓
CaseResult
        ↓
trace.json
        ├── Markdown
        ├── tool_calls
        └── Maison consumer
```

### 2.1 执行发现层：`UiDriverBase`

当前 driver 方法返回：

```text
None | Any | bool | component | dict
```

负面结果通过多种异常传递：

```text
SelectorResolutionError
SelectorContractError
AssertionMismatch
CapabilityUnsupported
StepSkipped
ValueError / TimeoutError / OSError / NotImplementedError / 任意 Exception
```

没有统一 `OperationOutcome` 类型。每个 driver/method 自行决定：

- 负面结果是返回 `False/None` 还是抛异常；
- 成功 dict 是否含 `selector/evidence`；
- 何时属于 selector、assertion、capability 或 infrastructure；
- 是否附带 candidates、bounds、artifacts。

### 2.2 Agent→ledger 传递层

成功值由 `_operation_parts()` 启发式解释：

- dict 有 `selector/evidence` → 分开读取；
- 否则整个 dict 被当成 evidence；
- assertion 返回 `None` 时，`execute_ledger_step()` 甚至可构造 `status=passed, evidence=null`。

异常由 `classify_exception()` 解释：

- 优先读 exception 自带 `failure_kind/failure_code`；
- 再看 exception class；
- 再搜索异常类名/消息中的 `device not found` 等文本；
- 无法识别时统一 `infrastructure/driver_failure`。

因此计划 JSON `ValueError`、driver 崩溃、设备 I/O、断言不匹配都可能在这层发生压缩或误归类。

### 2.3 StepResult 记录层

0.3-p0 使用平铺字段：

```text
index/kind/role/status/failure_kind/failure_code/duration_ms/
selector/evidence/error
```

这些字段没有由一个 discriminator 约束组合。Hylyre verifier 还规定：

```text
status != passed → failure_kind/failure_code 必须存在
```

这直接迫使未执行的 blocked、策略 skipped 伪造失败 taxonomy。

### 2.4 CaseResult 聚合层

`case_verdict()` 由 StepResult 推出：

```text
execution
verification
evidence
legacy Chinese status
```

聚合规则能够阻止 false PASS，但不能区分：

- 实际根失败；
- 未执行后缀；
- 策略跳过；
- capability 阻塞；
- assertion 负面观测。

因此它能回答“有没有通过”，不能稳定回答“实际发生了什么”。

### 2.5 持久化与反馈层

- `trace.json`：当前最完整的输出；
- Markdown：从 CaseResult/StepResult 投影，方向正确；
- `tool_calls`：只保留 case/index/kind/role/status/failure 字段，是有损投影；
- batch CLI：正常时带 StepResult，但缺失时可依据 legacy row status 重新猜 capability/infrastructure；
- fake runner：单独手工构造 StepResult，没有完整复用真实归一化；
- legacy `report begin/record/finalize`：可直接记录中文 status 再反推三轴，只能生成旧 schema。

所以“planned step → StepResult → CaseResult → trace”目前是设计目标，但 native、fake、batch fallback、legacy report 尚未真正共享一份协议实现。

## 三、根因定性

### 3.1 缺少规范化的执行 Outcome

系统没有一个明确回答以下问题的中间协议：

```text
该步骤是否实际尝试？
如果尝试，成功还是失败？
如果未尝试，是前置阻塞还是策略跳过？
执行器实际观察到了什么？
selector 请求了什么、解析到了什么？
失败是本步骤自身失败，还是继承前序因果？
哪些字段用于机器路由，哪些只是人读诊断？
```

这些语义目前分散在返回值、异常类型、异常属性、StepResult status、evidence 自由字段、runner 分支与 verifier 规则中。

### 3.2 failure 与 cause 被混为一谈

- `failure` 应表示：本步骤实际执行，并发生了失败；
- `cause` 应表示：本步骤没有执行，是被哪个步骤或外部条件阻塞。

0.4.1 将 root failure kind/code 复制给 blocked step，等于用 failure 字段承载 cause，导致下游无法区分根事件与投影。

### 3.3 request 与 resolution 被混为一谈

`selected_id` 当前有时保存请求的 `by_id`，即使 `candidate_count=0`。请求意图与实际 resolution 没有结构隔离。

### 3.4 Schema 验形但不能验语义

当前 JSON Schema：

- 允许大量 `additionalProperties`；
- evidence 是任意 object；
- failure code 是封闭 7 枚举；
- 没有 `oneOf` 约束 passed/failed/blocked/skipped 各自字段；
- 依靠 Python verifier 补跨字段规则，且补出了错误的“所有 non-passed 必须有 failure”。

### 3.5 failure code 缺乏扩展边界

当前为保持 7 个冻结 code：

- invalid match 被压成 `selector_not_found`；
- 普通 ValueError 可能变成 `driver_failure`；
- 后续新 operation 只能借用语义不准确的旧 code。

这说明枚举不是稳定协议，而是已成为信息压缩瓶颈。

## 四、0.5.0 目标架构

### 4.1 唯一持久化真源不变

仍然坚持：

```text
planned step
→ StepResult
→ CaseResult.steps[]
→ trace.json
→ Markdown/tool_calls projection
```

不新增 step-evidence sidecar、selector ledger、failure event log 或第二套 case 状态。

新增的 `OperationOutcome` 只是 driver/agent→StepResult builder 的**瞬态内存接口**，不持久化、不成为第二真源。

### 4.2 所有入口声明同一协议版本

以下输出 envelope 必须声明：

```json
"result_protocol": "hylyre.step-outcome/1"
```

适用：

- trace root；
- atomic CLI/MCP response；
- run_steps batch response；
- session daemon response；
- fake/conformance 输出。

`trace schema=0.4-p0` 与该协议绑定。协议版本不得仅存在于包外文档。

### 4.3 两阶段交付：先冻结契约，再集成实现

本需求的交付分为两个阶段，但只产生一个正式运行版本：

#### Phase 0：契约冻结包

在 Hylyre 生产实现大面积改造前，先交付并评审冻结：

1. `output-schema.json`：`0.4-p0` trace 终稿及 `pre_run_reject` definition；
2. `step-outcome-v1.md`：四种 outcome、selector request/resolution、failure/cause/reason 与聚合规则；
3. 规范性 builder 判定表：从“是否 dispatch、operation/assertion、adapter 结果、selector/probe 事实”唯一映射到 StepResult；
4. golden fixtures：每个合法 variant、每类非法组合、selector 各状态、VLM/Toast 可选检查、pre-run reject envelope，以及 `1 failed + N blocked + expected skipped` 的完整 case；
5. `bc-openCard-1` 形态 fixture：一个真实根失败、后缀未执行、expected 检查按策略处置，且 CaseResult/投影可复算。

Phase 0 不是 Hylyre 中间版本，不安装到宿主、不生成可收口的运行证据。Maison 必须直接消费这组冻结 Schema/fixture 开始 typed parser、routing、selector gate 与 report-only 迁移；不得另抄一套同义 fixture 或继续把 0.3-p0 flat 字段固化为临时接口。

#### Phase 1：真实实现与集成

Hylyre 按冻结契约完成单一 builder、各关键入口、Schema/verifier、投影与 conformance；Maison 同时完成消费迁移。双方代码集成时只验证真实实现是否符合 Phase 0，不再重新发明字段含义。Phase 0 冻结后若必须改协议，Schema、规范、判定表、golden fixtures 与 Maison 消费测试必须在同一次变更中同步，不能单边漂移。

## 五、Step Outcome Protocol v1

### 5.1 生命周期只有四种互斥结果

```text
planned step
    ├── 实际尝试
    │     ├── passed
    │     └── failed
    └── 未实际尝试
          ├── blocked
          └── skipped
```

语义冻结：

| status | 是否实际尝试 | 必需载体 | 禁止载体 |
|---|---:|---|---|
| passed | 是 | observation | failure/cause/reason |
| failed | 是 | failure，可带 observation | blocked cause / skip reason |
| blocked | 否 | cause | failure / 成功 observation |
| skipped | 否 | reason | failure / 成功 observation |

`capability`/`infrastructure` 是原因域，不自行决定 status；status 仍只由 attempted 事实决定：

- operation 已 dispatch/尝试后才发现不支持或 I/O 失败 → `failed`，分别使用
  `failure.domain=capability|infrastructure`；
- dispatch 前由 capability resolution、provider probe 或设备状态机器事实证明无法执行 →
  `blocked`，分别使用 `cause.type=capability|infrastructure`；
- 消费者可以把两类机器事实投影到同一个 capability defer/external disposition，但
  `blocked` 仍不是 failure route，不能进入 coding/owner candidate。

### 5.2 StepResult v1 基础 envelope

```json
{
  "index": 0,
  "kind": "wait_for",
  "role": "assertion",
  "duration_ms": 10000.0,
  "outcome": {},
  "selector": null,
  "artifacts": [],
  "diagnostic": null,
  "extensions": {}
}
```

字段职责：

- `outcome`：唯一执行结果与机器归因；
- `selector`：请求与实际解析事实；
- `artifacts`：截图/dump/log 等取证引用；
- `diagnostic`：脱敏后的人读消息，不参与机器路由；
- `extensions`：显式 namespace 扩展；禁止顶层自由 additional properties。

`artifacts[]` 的核心引用至少包含：

```json
{
  "kind": "screenshot|ui_dump|visible_elements|log",
  "path": "relative/artifact/path",
  "sha256": "64-lowercase-hex"
}
```

对 device session 已建立后实际尝试的 UI action/assertion 根失败（至少
`failure.domain=selector|assertion`），必须附一项 failure-boundary screen artifact：截图，或
`ui_dump/visible_elements`。这用于证明失败发生时实际停在哪个页面，不允许仅凭 diagnostic 声称
wrong-screen。若采集本身因设备/transport 不可用而失败，不伪造 artifact；应在结构化 observation/
namespaced extension 中记录 capture unavailable，并令 CaseResult `evidence=incomplete`。执行前
contract failure、capability blocked 与 device-unavailable blocked 不适用该 artifact 必填条件。

该要求只覆盖上述真实根失败的 failure boundary：每个根失败最多形成一组关联 artifact。不得扩张为每个 step 截图、成功路径强制取证、blocked/skipped 重复截图，或因 artifact 机制新增第二份步骤 ledger。

### P0-1 passed variant

```json
{
  "status": "passed",
  "observation": {
    "kind": "assertion",
    "assertion_type": "presence",
    "matched": true,
    "facts": {
      "expected_present": true,
      "observed_present": true
    }
  }
}
```

passed 必须有与 operation 对应的 observation。禁止“assertion 返回 None 即默认通过”。

### P0-2 failed variant

```json
{
  "status": "failed",
  "failure": {
    "domain": "assertion",
    "code": "assertion.mismatch"
  },
  "observation": {
    "kind": "assertion",
    "assertion_type": "presence",
    "matched": false,
    "facts": {
      "expected_present": true,
      "observed_present": false
    }
  }
}
```

failure 只描述本 step 自己实际发生的失败。

### P0-3 blocked variant

前序步骤失败：

```json
{
  "status": "blocked",
  "cause": {
    "type": "prior_step",
    "step_index": 0
  }
}
```

外部条件阻塞：

```json
{
  "status": "blocked",
  "cause": {
    "type": "capability",
    "code": "capability.unsupported",
    "capability_id": "toast_listener",
    "provider_id": "hypium",
    "facts": {
      "probe_status": "unsupported",
      "probe_source": "runtime_preflight"
    }
  }
}
```

基础设施条件阻塞：

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

blocked 禁止携带 failure。cause 可解释“为什么没执行”，但不能被下游当成本 step 失败路由。

`cause.type` 的 v1 核心枚举冻结为：

```text
prior_step
capability
infrastructure
```

Schema 必须用 discriminator/`oneOf` 约束各 variant：

- `prior_step`：必需 `step_index>=0`，禁止 `code/capability_id/provider_id/facts`；只能引用同一
  CaseResult 中较小 index 的真实根 outcome，目标必须是 `failed`，或是
  `blocked/cause.type=capability|infrastructure`；禁止 `prior_step → prior_step` 因果链；
- `capability`：必需 namespaced `code=capability.*` 与非空 `capability_id`，`provider_id` 可选，
  禁止 `step_index`，并必需结构化 `facts.probe_status/probe_source`；
- `infrastructure`：必需 namespaced `code=infrastructure.*` 与结构化
  `facts.probe_status/probe_source`，禁止 `step_index`；
- 未知 core type 必须 schema FAIL；未来扩展只能通过协议版本或显式 namespaced extension，
  不能让消费者从 diagnostic 猜 type。

`blocked/cause.type=capability` 是机器证明的能力缺失，可由 Maison 投影为 capability defer；
`blocked/cause.type=infrastructure` 可投影 external/toolchain disposition。两者各自只投影根 cause
一次，后续 `blocked/prior_step` 不重复投影；三者均不得生成 failure route 或 coding candidate。

`cause.facts` 是 capability/external disposition 的机器依据，不是人读 notes。`probe_status` 核心值至少支持 `unsupported|unavailable|not_configured|offline`；`probe_source` 必须指出实际 provider/device/preflight 探测来源。只有 diagnostic 散文、没有 facts 的 capability/infrastructure 声明不能驱动 defer，也不能由下游补猜。

### P0-4 skipped variant

```json
{
  "status": "skipped",
  "reason": {
    "type": "policy",
    "code": "expected_check.disabled_by_flag"
  }
}
```

skipped 表示明确策略/可选路径，不等于 capability failure。

`reason.type` 的 v1 核心枚举冻结为：

```text
policy
not_applicable
```

v1 至少注册以下 namespaced reason code：

```text
expected_check.disabled_by_flag
expected_check.unavailable_no_vlm
expected_check.empty
optional_check.on_unsupported_skip
```

其中：

- flag 明确关闭 expected check → `skipped/policy/expected_check.disabled_by_flag`；
- expected check 是可选项且机器 probe 证明无 VLM →
  `skipped/policy/expected_check.unavailable_no_vlm`，`reason.facts` 必须保留 probe 事实；
- expected 内容为空且契约明确定义为不适用 → `skipped/not_applicable/expected_check.empty`；若该
  case 本身没有任何可执行 step，则属于 `contract.empty_case` 计划错误，不能生成空 CaseResult 或
  skipped 冒充覆盖；
- optional Toast 等能力的计划策略明确为 `on_unsupported=skip` →
  `skipped/policy/optional_check.on_unsupported_skip`，并携带实际能力 probe facts；
- VLM/Toast 是 required 契约时，dispatch 前机器证明能力缺失应为 `blocked/capability`，不是 skipped；
  已 dispatch 后才失败则为 `failed/capability`。

未知 core reason type 必须 Schema FAIL；新增 core code 进入协议注册表，adapter/vendor 扩展使用显式 namespace。自由文本 reason/diagnostic 不能参与 CaseResult 或 Maison 路由。

Schema 必须对 reason 做 discriminator/oneOf：`policy` 必需 namespaced code，涉及能力可用性的 code 必需 `facts.probe_status/probe_source`；`not_applicable` 只允许注册的不适用 code。reason 禁止携带 failure/cause 字段，facts 只能补充机器事实，不能改变 skipped 的未执行语义。

### 5.3 Observation 核心协议

`observation.kind` 至少支持：

```text
action
assertion
```

`observation` 只描述本步骤实际执行或观测到的 operation/assertion 事实。capability 与 infrastructure 是归因域，分别进入 `failure.domain`、`cause.type` 或其结构化 facts，不能再作为平行的 `observation.kind` 形成第二套分类真源。

#### Action observation

```json
{
  "kind": "action",
  "operation": "touch",
  "performed": true,
  "facts": {}
}
```

#### Assertion observation

```json
{
  "kind": "assertion",
  "assertion_type": "presence|absence|toast|expected|custom",
  "matched": true,
  "facts": {}
}
```

核心 assertion facts：

- presence：`expected_present/observed_present`；
- absence：同一字段，expected=false；
- Toast：channel、observed、trigger_window_covered；
- expected：channel、instruction_checked、matched；
- custom：通过 namespaced extensions 扩展，不新增顶层自由字段。

### 5.4 Failure protocol

稳定大类：

```text
contract
selector
assertion
capability
infrastructure
internal
```

细码使用 namespaced string：

```text
contract.invalid_step
contract.empty_case
contract.invalid_selector
contract.invalid_match
selector.not_found
selector.ambiguous
selector.inline_unresolvable
assertion.mismatch
capability.unsupported
infrastructure.device_unavailable
infrastructure.transport_failure
internal.unexpected_exception
```

要求：

- Maison 等消费者先按 `domain` 稳定路由；
- 新增细码不要求消费者升级大类逻辑；
- unknown code 仍可按 domain fail-closed；
- 禁止解析 diagnostic/error 文本归类；
- 禁止为维持旧枚举把 invalid contract 压成 not_found。

`domain` 是封闭稳定大类；core code 由协议注册表管理，vendor/adapter 新码必须带其 namespace。Schema 不需要把未来所有 namespaced code 做成一个不可扩展大枚举，但必须拒绝无 namespace、domain 与 code 前缀冲突、以及用 diagnostic 代替 code 的结果。`failure.facts` 可承载已尝试操作的结构化失败事实；它不能改变 domain/status，也不能覆盖 selector resolution 或 artifact。

`contract.empty_case` 属于运行前 plan validation error：因为没有合法 step 可承载 StepResult，它不能被包装成 failed/skipped CaseResult；CLI/run 必须在创建设备执行前显式拒绝整份计划。

## 六、Selector Request/Resolution Protocol

### 6.1 请求与解析分离

```json
{
  "request": {
    "kind": "by_id",
    "value": "bank_row_bocom",
    "match": null,
    "constraints": {}
  },
  "resolution": {
    "state": "not_found",
    "candidate_count": 0,
    "selected": null,
    "candidates": []
  }
}
```

`request` 描述计划意图；`resolution` 描述执行器实际发现。

### P0-5 resolution 状态机

```text
not_attempted
not_found
unique
ambiguous
unresolvable
```

不变量：

| resolution.state | candidate_count | selected |
|---|---:|---|
| not_attempted | null | null |
| not_found | 0 | null |
| unique | 1 | `{id,bounds?}` |
| ambiguous | >=2 | null |
| unresolvable | null 或 >=0 | null |

禁止：

```text
candidate_count=0 + selected.id 非空
candidate_count>1 + selected 非空（未消歧）
not_attempted + 伪造 candidate_count
```

`unresolvable` 不能只是一个空状态。它必须携带 namespaced `reason_code` 与结构化 `facts`，至少说明：

- `dump_status=available|unavailable|unreadable`；
- selector request 是否完整、是否成功进入对应 resolver；
- candidate count 是否可计算；不可计算时必须为 null，不能伪造 0；
- inline/fragment 场景是否存在 fragment bounds/anchor 线索；
- 若 resolver/API 不支持该形态，记录实际 capability/provider probe 来源。

这些 facts 用于判断“计划契约不完整、运行时目标不存在、resolver 能力不足、设备事实不可得”中的哪一种边界；Maison 不得再从 diagnostic 猜责任。`not_found` 表示 resolver 已完成且确定为 0 候选，不能拿它代替 dump 不可得或 resolver 未完成的 `unresolvable`。

### 6.2 隐私边界

- request 中的 `by_id/by_key` 与 selected/candidates 的结构化 ID 继续逐字保留；
- `by_text/value/instruction/expected/actual/diagnostic` 继续脱敏；
- serializer 只做隐私处理，不改变 outcome/resolution 语义；
- trace/Markdown/MCP 对同一 ID 的处理一致。

## 七、Driver→StepResult 归一化

### P0-6 统一瞬态 OperationOutcome

所有 driver/agent operation 必须返回同一瞬态 tagged union：

```text
OperationPassed
OperationFailed
OperationBlocked
OperationSkipped
```

它与 StepResult.outcome 同构，但不含 plan index/kind/role/duration；ledger builder 只负责附加这些 envelope 字段并序列化。

预期负面结果必须作为结构化 outcome 返回：

- selector 0/多候选；
- assertion matched=false；
- capability unsupported：已 dispatch/尝试则 `OperationFailed/failure.domain=capability`，
  执行前由机器 resolution/probe 证明不可用则 `OperationBlocked/cause.type=capability`；
- infrastructure unavailable：已尝试则 `OperationFailed/failure.domain=infrastructure`，
  执行前已证明不可用则 `OperationBlocked/cause.type=infrastructure`；
- policy skip。

Python exception 只用于未预期异常：

- driver crash；
- 非预期 I/O；
- internal bug。

未预期 exception 统一变为：

```text
failed + internal.unexpected_exception
或明确 infrastructure.*
```

禁止根据 exception message 搜索字符串决定 domain/code。

### P0-7 单一 StepResult builder

native、resolver、plan、steps-file、atomic CLI、MCP、session daemon、fake 都必须调用同一个 builder。禁止：

- fake 手工拼 StepResult；
- batch 缺 step_result 时按 row status 猜 failure；
- assertion `None` 默认 passed；
- legacy status 反推成新协议 StepResult。

fake 必须实现同一 driver outcome 接口；它只能改变观测来源，不能改变协议语义。

### P0-7A 规范性 builder 判定表

Phase 0 必须交付一份规范性判定表，至少冻结下列映射；实现分支、fake 与 Maison fixture 均不得自行改义：

| 发现阶段/事实 | 是否 attempted | StepResult/边界结果 |
|---|---:|---|
| plan/case 为空或 step 非法，尚未创建可运行 case | 否 | 整份 plan 以 `contract.empty_case`/`contract.invalid_step` 拒绝；按 P0-7B 输出结构化 reject，不生成空 CaseResult，不伪造 skipped step |
| dispatch 前 capability probe 证明 required provider 不可用 | 否 | `blocked/cause.type=capability` + 必需 facts |
| dispatch 前 device/preflight 证明基础设施不可用 | 否 | `blocked/cause.type=infrastructure` + 必需 facts |
| 已 dispatch，selector 0/多候选导致 action 未产生效果 | 是 | `failed/failure.domain=selector`；action observation 可为 `performed=false`，但不能改成 blocked |
| assertion 已执行并得到 matched=false | 是 | `failed/failure.domain=assertion` + assertion observation |
| 已 dispatch 后 adapter 返回 unsupported | 是 | `failed/failure.domain=capability` |
| 已 dispatch 后发生 device/transport I/O 失败 | 是 | `failed/failure.domain=infrastructure` |
| 根 step failed | 是 | 当前 step 一个 failed；同 case 后缀全部 `blocked/prior_step` 并直接指向该根 step |
| 根 step 为 blocked capability/infrastructure | 否 | 当前 step 一个 root blocked；同 case 后缀 `blocked/prior_step` 直接指向该 root，禁止链式引用 |
| 设备在 case 中途死亡 | 当前 step 是 | 当前 step `failed/infrastructure.*`；同 case 后缀指向它；后续 case 首 step 以新的机器 probe 形成 root `blocked/infrastructure`，不得跨 case 引用 index |
| optional expected/Toast 且计划策略允许 skip | 否 | `skipped/reason`，使用冻结 code 和 probe facts |
| expected check 已进入 checked_vlm，但前序 action 失败 | 否 | `blocked/prior_step`，不能写 `unavailable_no_vlm` |
| operation/assertion 成功 | 是 | `passed` + 对应 observation；`None` 不是成功证据 |

这里的 attempted 表示步骤已经进入对应 adapter/driver 的真实操作尝试，不等于 UI 最终发生了变化。因此 `performed=false + failed` 可以是合法组合；未 dispatch 的 blocked 不得伪造 `performed=false` action observation。

### P0-7B pre-run contract reject 的机器协议

空 case、静态非法 step/match 等在设备执行前被拒绝时，没有合法 StepResult 可承载结果，因此不生成 trace、CaseResult 或 test-report；但这仍是协议内的 plan validation 决策，不是进程 crash。

正式 `run --plan` 与 `run --steps-file` report mode 必须：

1. 在 stdout 输出且只输出一个 UTF-8 JSON object；日志/人读说明只能写 stderr；
2. 返回固定 exit code `2`；
3. 不连接设备，不创建或改写 `--trace-out/--report-out`；
4. 输出满足 `output-schema.json` 中冻结的 `pre_run_reject` definition：

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

- `rejection` 必需 `domain=contract` 与已注册的 `contract.*` code；
- `case_id/step_index/path` 在适用时提供，`summary` 仅供人读，不参与分类；
- validator 可以按稳定顺序返回首个违规；本需求不要求为此新增错误聚合状态；Maison 不解析 stderr 猜错误；
- Maison 必须先识别该 envelope，再决定是否进入“非零退出且无 trace”的 crash 兜底；合法 reject 归 testing/plan contract，不得分类为 python traceback、device 或 infrastructure；
- stdout 缺失、JSON/schema 非法、协议字段错配且没有 trace，才属于无结构化结果的异常路径。

该 envelope 只服务可预期的 pre-run validation reject，不扩展到 trace 创建前的任意 Python crash；后者继续使用既有 subprocess 兜底。因此它不违反“不给意外 crash 新建持久化 envelope”的非目标，也不新增 sidecar。

## 八、CaseResult 与 RunResult 纯派生

### P0-8 CaseResult 只能由 StepResult reduce

新 schema 的 CaseResult 三轴不得由入口自由填写：

```text
CaseResult = reduce(StepResult[])
```

规则：

- execution：根据实际 attempted/failed/blocked 事实推导；
- verification：只根据 assertion observation/matched 推导；
- evidence：根据所需 observation/selector/artifacts 完整性推导；
- expected_check_mode：策略输入，决定 expected-check 是否为 required assertion；
- legacy Chinese status：只作兼容投影，不能反向生成三轴。

### P0-9 根因与投影分离

- failed outcome 是可路由根事件；
- blocked cause 只表达依赖，不复制 failure；
- skipped reason 只表达策略；
- Case/Markdown notes 优先展示真实 failed step，并汇总“后续 N 步未执行”；
- 不把 N 个 blocked 记录成 N 个缺陷。

### P1-10 Run outcome 纯派生

run outcome 继续由 CaseResult 推出，但必须以 v1 outcome 语义为输入；tool_calls、Markdown、pass-rate 不得反向覆盖 trace。

## 九、Trace Schema 0.4-p0

### P0-11 使用 discriminator/oneOf

Schema 必须使非法组合不可表达：

- `outcome.status=passed` → observation required，failure/cause/reason forbidden；
- `failed` → failure required，cause/reason forbidden；
- `blocked` → cause required，failure/reason forbidden；
- `skipped` → reason required，failure/cause forbidden；
- blocked cause 按 `prior_step|capability|infrastructure` 的 discriminator/oneOf 校验必需与禁止字段；
- selector resolution 各 state 按第六节约束 candidate/selected；
- device session 内实际尝试的 selector/assertion 根失败按 5.2 校验 failure-boundary screen artifact。

职责边界必须冻结：

- JSON Schema 负责单对象结构、variant 互斥、必需/禁止字段、基础格式与局部组合；
- StepResult builder 负责从 operation facts 唯一构造合法 variant；
- Case/Run reducer 负责跨 step 聚合；
- verifier 负责 `prior_step` 同 case/较小 index/根引用、CaseResult 三轴复算、投影一致性与其它跨行派生规则；
- verifier 必须删除当前 `src/hylyre/harness/runner.py:151-157` 的
  `status != passed → failure_kind/failure_code 必填` 及其它与新 Schema 冲突的旧规则，不在 Python 中再复制一套 variant 结构校验。

JSON Schema 无法单独证明 CaseResult 三轴与整组 steps 的归约一致，也无法证明跨行引用与投影一致；这些要求必须由 reducer/verifier conformance 验收，不能写成“Schema 已保证”后实际无人执行。

### P0-12 扩展点显式化

顶层 `additionalProperties` 默认关闭。扩展只能放：

```json
"extensions": {
  "vendor.namespace": {}
}
```

核心字段不能被 extension 覆盖或重新解释。

### P0-13 协议规范必须随 source 包交付

当前 package-data 中 `contracts/README` 引用了 source 发布件不携带的 `docs/deterministic-verification.md`。0.5.0 必须把完整规范置于 package-data，例如：

```text
hylyre/contracts/step-outcome-v1.md
hylyre/contracts/output-schema.json
hylyre/contracts/builder-decision-table.md
hylyre/contracts/report-sections.yaml
hylyre/contracts/golden/*.json
```

source/wheel 安装后均可离线读取，不依赖源仓外部 docs。golden fixtures 与规范、Schema 是同一契约包，不另建 Maison 同义副本或运行时 fixture manifest。

## 十、入口统一与旧协议隔离

### P0-14 发布关键入口

以下入口位于正式发布证据路径，必须做完整 conformance：

- real plan runner（`hylyre run --plan` → trace）；
- native/resolver driver 到单一 builder 的接线；
- fake runner（供 Hylyre/Maison conformance gate 使用）；
- `run --steps-file` / inline batch（供 adhoc/复位链使用）；
- trace、Markdown 与 `tool_calls` 投影。

这些入口必须输出相同 `result_protocol` 与 StepResult v1。`tool_calls` 明确是 trace 的有损投影，不是 evidence 真源；0.4-p0 下每条至少固定映射：

```text
case/index/kind/role/outcome.status
failed  → failure.domain/failure.code
blocked → cause.type/cause.code? / cause.step_index?
skipped → reason.type/reason.code
```

`tool_calls` 必须保留与 StepResult 相同的嵌套 `outcome.failure|cause|reason` 字段名，不再发明 flat `failure_kind` 或自由 status 别名。它不要求复制完整 evidence、selector candidates、artifacts 或 facts，但不得生成 trace 中不存在的 failure/cause/reason，也不得被 Maison 反向用于补齐 trace。

### P1-15 非关键入口 smoke

atomic CLI、MCP atomic/batch 与 session daemon 仍必须调用同一个 StepResult builder，并声明同一 `result_protocol`；但它们不产 Maison 正式回归证据，本版本只要求每入口至少一条端到端 smoke，证明 envelope、variant 与错误传播可用，不要求每入口重复全部场景矩阵。

### P0-16 legacy 仅隔离，不做迁移承诺

`report begin/record/finalize` 与 0.3-p0/0.2 历史产物只保留最小隔离边界：

- 0.5.0 新运行一律输出 `0.4-p0 + hylyre.step-outcome/1`；
- legacy 路径不得生成 0.4-p0、不得伪造 Step Outcome v1，输出必须明确 legacy；
- 不把旧 flat StepResult 自动补字段或转换成 v1 evidence；
- 不在同一 run 混用 0.3 与 0.4 step；
- 本需求不要求 Hylyre 0.5.0 提供 0.3-p0 迁移工具或完整读取兼容；若保留人工诊断读取，只是非阻断能力，不进入 0.5.0 验收；
- Maison 不将 legacy 产物作为新 evidence。

### P0-17 schema/protocol dispatch 必须 fail-closed

所有读取入口先共同判定 `(schema_version, result_protocol)`：

- `0.4-p0 + hylyre.step-outcome/1` → v1 typed parse；
- `0.3-p0/0.2` → 显式 `legacy_unsupported_for_evidence`；上层可选择只读诊断，但不得要求 Hylyre 迁移或满足 v1 evidence；
- 其它组合、缺协议字段或未知未来 schema → `unsupported_schema_or_protocol` 显式失败。

禁止 schema 不匹配后返回空 checks、SKIP、改读中文 status、flat fields、tool_calls/log 或 legacy
telemetry。可选 diagnostic helper 可以在上层已完成 dispatch 后选择不适用，但不得自行吞掉未知 schema。

对“进程非零退出且本 run 未生成 trace”的路径，消费者判定顺序冻结为：

1. 先按 P0-7B 尝试解析 stdout 的 `pre_run_reject`；exit code=2 且 envelope 合法 → plan contract reject；
2. envelope 缺失/非法/协议错配 → 才进入既有无 trace subprocess crash 分类；
3. stderr 只用于显示，不参与 contract/infra/crash 的机器分型。

## 十一、Conformance 回归矩阵

### 11.1 正常执行

1. action unique selector → passed/action observation；
2. presence matched → passed/assertion observation；
3. absence matched → passed/assertion observation；
4. Toast 覆盖触发窗口且 matched → passed；
5. expected VLM matched → passed；
6. no-selector wait/back/start_app → 明确 action observation，不允许 None 默认通过。

### 11.2 负面执行

1. action 0 candidate → failed/selector.not_found；
2. action ambiguous → failed/selector.ambiguous；
3. 静态 invalid match/step/empty case → pre-run contract reject；只有已进入真实 adapter 后才发现的动态契约违例才可 `failed/contract.*`；
4. presence observed=false → failed/assertion.mismatch；
5. absence observed=true → failed/assertion.mismatch；
6. Toast false → failed/assertion.mismatch；
7. required capability unavailable：dispatch 前机器 resolution/probe 已证明不可用 →
   blocked/cause capability；已 dispatch/尝试后才返回 unsupported → failed/failure capability；
8. device unavailable：dispatch 前已证明不可用 → blocked/cause infrastructure；已尝试后发生
   device/transport 失败 → failed/failure infrastructure；
9. unexpected exception → failed/internal.unexpected_exception；
10. device session 内 selector/assertion 根失败 → artifacts 至少含截图或 ui_dump/visible_elements；
    capture unavailable 时不伪造 artifact，CaseResult evidence 必须 incomplete。

### 11.3 未执行语义

1. root failed + N suffix → root 一个 failed，N 个 blocked/prior_step；
2. root blocked capability/infrastructure + N suffix → 一个带 probe facts 的 root blocked，N 个直接指向 root 的 prior_step；
3. expected disabled → `skipped/policy/expected_check.disabled_by_flag`，无 failure；
4. optional expected 无 VLM → `skipped/policy/expected_check.unavailable_no_vlm` + probe facts；required expected 无 VLM → `blocked/capability`；
5. checked_vlm 本应执行但前序 action 已失败 → `blocked/prior_step`，不得误写 unavailable_no_vlm；
6. optional Toast unsupported + on_unsupported=skip → `skipped/policy/optional_check.on_unsupported_skip` + probe facts；
7. 空 case/无可执行 step → plan contract reject，不生成空 CaseResult/skipped；
8. blocked/skipped 不产生 failure route；
9. blocked/capability 根 cause → 0 failure route + 1 capability defer，后续 prior_step 不重复；
10. blocked/infrastructure 根 cause → 0 failure route + 1 external/toolchain disposition；
11. failed/capability → 1 failed root route，且该 route 的 disposition=capability defer、0 coding candidate；
12. 设备中途死亡 → 当前 attempted step 一个 failed/infrastructure，同 case 后缀 prior_step；后续 case 重新形成 root blocked/infrastructure；
13. batch executed 只计实际 dispatched operation。

### 11.4 Selector 状态

1. not_found → 0/null；
2. unique → 1/selected ID；
3. ambiguous → N/null + candidates；
4. inline/dump unresolvable → selected null、namespaced reason_code、dump/resolver/fragment facts；candidate 不可计算时为 null；
5. nested all/scope/within/index 的 request 与 resolution 一致；
6. card/amount/account/phone ID 不脱敏，真实文本和值继续脱敏。

### 11.5 分层 conformance

不做“每个入口 × 全部场景”的笛卡尔积。验证分三层：

1. 单一 builder/Schema/reducer/verifier：对规范性判定表和 golden fixtures 做完整场景矩阵；
2. 发布关键入口：real plan、fake、steps-file/batch 各跑完整的关键正负场景，证明没有旁路 builder；
3. atomic CLI、MCP、session：每入口至少一条端到端 smoke，比较 envelope、outcome、错误传播与协议版本。

各层比较 `outcome.status`、failure/cause/reason、observation、selector request/resolution、artifacts 与 CaseResult 派生；环境、耗时、真实 bounds 等允许差异必须在 conformance 规则中显式列出。

### 11.6 Schema/投影

- 对每个合法 variant 做 Schema 正例；
- 对互相矛盾组合做 Schema 负例；
- 对 `cause.type=prior_step|capability|infrastructure` 分别做 oneOf 正例，并覆盖未知 type、
  code namespace 不匹配、必需字段缺失及 variant 字段串用的负例；
- 对 failure-boundary artifact 的必需、hash/path 形状及 capture-unavailable/evidence-incomplete 做正反例；
- 对 schema/protocol dispatch 覆盖 0.4+v1、0.3/0.2 legacy unsupported-for-evidence、缺 result_protocol、未知 schema
  与错配组合；后四类不得静默返回空结果或回退 legacy；
- trace、Markdown、tool_calls 集合/身份一致；
- Markdown/tool_calls 不得出现 trace 中没有的根因；
- Schema 只验证 variant 内局部结构；verifier 必须复算 CaseResult、检查 prior_step 根引用和投影一致性；
- 删除 runner/verifier 中旧的 `status != passed → failure_kind/failure_code 必填` 规则，不换名复制；
- checked_vlm-blocked、action `performed=false + failed`、设备中途死亡与 optional no-VLM 均须有 golden 正反例。
- pre-run reject 覆盖 empty case、invalid step/match：stdout 只有合法 JSON、exit=2、零设备调用、trace/report 不创建；Maison 识别为 testing/plan contract。另做 envelope 缺失/非法负例，确认只有负例进入无 trace crash 兜底。

## 十二、非目标

本需求不要求：

- 新增第二套持久化 ledger；
- 将 Maison coverage/owner/release verdict 下推 Hylyre；
- 解析 error/diagnostic 决定机器分类；
- 修改 exact/contains、OCR、坐标估算或富文本点击策略；
- 撤销 0.4.1 selector identity 隐私修复；
- 为兼容 0.3-p0 保留错误的 flat-field 组合；
- 为 0.3-p0 建迁移工具或保证完整读取兼容；
- 让 consumer 自行修补/重分类 Hylyre outcome；
- 为 Hylyre 进程在 trace 创建前直接崩溃的协议外场景新增另一套持久化 envelope。Maison 现有
  subprocess stdout/stderr crash 分类器可继续作为无 trace 兜底，清理 flat-field 消费时不得顺手删除；P0-7B 的可预期 plan reject 是协议内决策，不属于本条 crash。

## 十三、版本与发布要求

### 13.1 必须发布 Hylyre 0.5.0

该变更是结果协议、trace schema 与多入口接线的破坏性重构，不能使用 0.4.2 patch，也不能以 0.4.1 同版本替换。

发布时同步：

- `pyproject.toml` / `hylyre.__version__=0.5.0`；
- `result_protocol=hylyre.step-outcome/1`；
- trace schema `0.4-p0`；
- source manifest 文件清单、size、SHA、tree fingerprint；
- package-data 内完整协议文档、Schema 与 builder 判定表；
- source/conformance 资产内保留 Phase 0 golden fixtures，供 Hylyre 与 Maison 对同一组样例验收；
- README/CHANGELOG/migration；
- conformance 测试报告。

### 13.2 source 发布

Maison 继续使用 plain-source vendor。无需 wheel。source tree 必须包含协议与 schema package-data，安装后 doctor/verify 可离线读取并校验版本对应关系。

## 十四、Maison 并行开发与联调验收

Maison 不等待 Hylyre 生产实现全部完成后才开始适配，而按两个阶段推进。

Phase 0 契约冻结后，Maison 立即：

1. 直接消费 Hylyre 交付的 `output-schema.json`、builder 判定表与 golden fixtures，建立独立消费迁移计划；不得复制一套同义协议或把 0.3-p0 flat reader 当临时生产接口；
2. 建立单一 result dispatch/parse boundary：有 trace 时按 `(schema_version,result_protocol)` 进入 v1 typed view；非零退出且无 trace 时先解析 P0-7B pre-run reject，合法 reject 归 testing/plan contract；0.3-p0/0.2 只能得到 legacy unsupported-for-evidence/可选只读诊断，未知组合显式 BLOCKER；
3. 清点并收编全部 `0.3-p0` 字面守卫及隐式分支，至少覆盖 provider/parser、evidence、timing、report-only、case completeness、selector gate、failure routing、P0 semantic、run outcome 与 telemetry comparison；任何 required gate 不得因 schema 不匹配 `return []`/SKIP/no-op；
4. 将 routing 改为读取 `step.outcome.status` 与 `outcome.failure.domain/code`，selector gate 改读 `selector.request/resolution`；不根据 role/error/diagnostic 二次分类；
5. 只把 `outcome.status=failed` 作为 responsibility event；blocked capability/infrastructure 的机器 facts 分别投影一次 defer/external disposition，prior_step 与 skipped reason 不重复投影；
6. 按冻结规则消费 `reason.code`、`cause.facts`、unresolvable facts、tool_calls 映射、CaseResult reducer 与 failure-boundary artifact；
7. 用 Phase 0 fixtures 贯穿 normal 与 `--report-reconcile-only`，证明全部 required gate 实际运行；v1 进入 legacy-only adapter、未知 schema 或错配协议必须显式失败；
8. 保留“Hylyre 进程未产 trace 即崩溃”时现有 subprocess stdout/stderr crash 分类器；它只在 P0-7B envelope 缺失或非法后运行，不读取或伪造 Step Outcome，不属于被清理的 flat-field 假设。

Phase 1 Hylyre 真实实现交付后，Maison 再完成：

9. 校验 source version/tree/doctor、`result_protocol` 与 Phase 0 契约一致，并将最低合规版本提升至 0.5.0、trace minimum 提升至 0.4-p0；
10. 将 fixture driver 替换为真实 source 接线，运行 builder/Schema/reducer/verifier 全量 conformance、real plan/fake/steps-file 关键入口回归，以及 atomic/MCP/session 每入口 smoke；
11. 对真实 selector request/resolution 做 candidate/selected/bounds 对账，并验证 unresolvable 的 reason/facts；
12. 对 device-session 内 selector/assertion 根失败校验 failure-boundary screen artifact；
13. 真机回灌 presence/absence/action/capability/infrastructure/blocked/skipped，以及 disabled/no-VLM/checked_vlm-blocked；
14. 运行 bc-openCard-1 与同一 run 的 `--report-reconcile-only`，确认一根失败不再倍增、trace 字节不变且没有 legacy fallback。

未完成上述联调前，准确状态为：

```text
Hylyre 0.4.1 已修复空断言与 selector identity 脱敏；
flat StepResult 尚不是统一、可扩展的执行结果反馈协议；
Maison 不得基于 0.4.1 完成 failure routing 收口。
```

## 十五、Hylyre 交付报告要求

Phase 0 冻结时先提供：

1. `output-schema.json` 0.4-p0 trace 终稿及 `pre_run_reject` definition；
2. Step Outcome Protocol v1 完整规范；
3. 规范性 builder 判定表，覆盖 attempted、空 case、设备中途死亡、optional VLM/Toast 与 prior_step 根引用；
4. golden fixtures 正反例及 `bc-openCard-1` 代表性 ledger；
5. 四个 code 面的注册表与扩展规则：`failure.code`、`cause.code`、`reason.code`、`resolution.reason_code`，以及各自 type/domain/facts 约束；
6. selector request/resolution，尤其 unresolvable reason/facts；
7. Case/Run reducer、Schema/verifier 职责边界与 tool_calls 映射；
8. pre-run reject envelope schema、exit code=2、stdout/trace/report 约束及 Maison 分型 fixture。

Phase 1 交付 0.5.0 真实实现时再提供：

1. 当前多路径结果协议的根因分析与删改文件；
2. OperationOutcome→StepResult 单一 builder 实现说明，以及旧 `status != passed → failure` 规则删除证据；
3. builder/Schema/reducer/verifier 对 Phase 0 golden fixtures 的 conformance 结果，以及真实 CLI pre-run reject 的 stdout/exit/零设备/零 trace-report 结果；
4. real plan/fake/steps-file 关键入口完整结果，atomic/MCP/session 每入口 smoke 结果；
5. attempted-aware capability/infrastructure、blocked cause、skipped reason、disabled/no-VLM/checked_vlm-blocked 实现结果；
6. selector request/resolution 与 unresolvable facts 回归；
7. failure-boundary screen artifact 与 capture-unavailable/evidence-incomplete 样例；
8. CaseResult/RunResult 纯派生与 prior_step 根引用验证；
9. legacy 隔离结果：不会产 0.4-p0、不做 evidence 迁移；
10. trace/Markdown/tool_calls 投影一致性；
11. 隐私脱敏正反例；
12. output schema、package-data 协议文档、builder 判定表、golden fixtures 与 doctor/verify 结果；
13. 版本号、source manifest 与 tree fingerprint；
14. 是否存在协议偏离、迁移限制或尚未执行的真实设备验证。

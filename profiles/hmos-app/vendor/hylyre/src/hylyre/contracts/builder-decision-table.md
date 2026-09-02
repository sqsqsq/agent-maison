# Builder decision table (`hylyre.step-outcome/1`)

- 状态：**规范性**（Phase 0 冻结候选）
- 配套：[`step-outcome-v1.md`](step-outcome-v1.md)、[`output-schema.json`](output-schema.json)、[`golden/`](golden)

本表冻结「**执行发现事实 → StepResult / 运行前边界结果**」的唯一映射。实现分支、fake、adapter 与 Maison fixture **均不得自行改义**。

约定：

- `attempted` = 步骤是否已进入对应 adapter/driver 的**真实操作尝试**；它**不**等于 UI 最终发生了变化；
- `carrier` 列写出该行**必需**的载体字段；`—` 表示该行不需要 code；
- `fixture` 列是 `hylyre/contracts/golden/` 下的相对路径，机器校验会核对它与本行的 status/carrier/code 一致；
- 表中未列出的组合**不是**未定义行为，而是**非法**：Schema 或 verifier 必须拒绝。

---

## A. 运行前边界（pre-run contract reject，P0-7B）

这些事实在**创建可运行 case、连接设备之前**成立。没有合法 StepResult 可承载结果，因此**不生成** trace / CaseResult / test-report，**不伪造** skipped step，**不生成**空 CaseResult。
输出为 stdout 唯一 JSON object + exit code `2`，见 `step-outcome-v1.md` §11。

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-01 | plan/case 没有任何可执行 planned step | 否 | `pre_run_reject` | `rejection.domain=contract` | `contract.empty_case` | `pre-run-reject/valid/empty-case.json` |
| D-02 | planned JSON step 静态非法（语法错误 / 根键缺失 / 多个根键） | 否 | `pre_run_reject` | `rejection.domain=contract` | `contract.invalid_step` | `pre-run-reject/valid/invalid-step.json` |
| D-03 | `match` 静态非法（非 `exact`/`contains`） | 否 | `pre_run_reject` | `rejection.domain=contract` | `contract.invalid_match` | `pre-run-reject/valid/invalid-match.json` |
| D-04 | selector 契约静态非法（如 touch 目标谓词不唯一） | 否 | `pre_run_reject` | `rejection.domain=contract` | `contract.invalid_selector` | `pre-run-reject/valid/invalid-selector.json` |
| D-05 | `run --steps-file` report mode 的静态非法 step | 否 | `pre_run_reject` | `rejection.domain=contract` | `contract.invalid_step` | `pre-run-reject/valid/steps-file-invalid-step.json` |

**约束**：validator 按稳定顺序返回**首个**违规；零设备调用；不创建或改写 `--trace-out` / `--report-out`；人读说明只能写 stderr。

---

## B. dispatch 前的机器 probe（未尝试 → `blocked`）

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-06 | dispatch 前 capability probe 证明 required provider 不可用 | 否 | `blocked` | `cause.type=capability` + 必需 `facts.probe_status/probe_source` + `capability_id` | `capability.unsupported` | `step/valid/blocked-capability-probe.json` |
| D-07 | dispatch 前 probe 证明 required VLM 未配置（required expected check） | 否 | `blocked` | `cause.type=capability` + probe facts | `capability.not_configured` | `step/valid/blocked-capability-vlm-required.json` |
| D-08 | dispatch 前 device/preflight 证明基础设施不可用 | 否 | `blocked` | `cause.type=infrastructure` + probe facts | `infrastructure.device_unavailable` | `step/valid/blocked-infrastructure-probe.json` |

**约束**：只有 `diagnostic` 散文、没有 `facts` 的 capability/infrastructure 声明**不能**驱动 defer；`blocked` 不是 failure route，不进入 coding/owner candidate。

---

## C. 已 dispatch 的负面结果（已尝试 → `failed`）

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-09 | selector 解析得到 0 候选，action 未产生效果 | 是 | `failed` | `failure.domain=selector`；action observation 可为 `performed=false` | `selector.not_found` | `step/valid/failed-selector-not-found.json` |
| D-10 | selector 解析得到 >= 2 候选且未消歧 | 是 | `failed` | `failure.domain=selector` + `resolution.state=ambiguous` | `selector.ambiguous` | `step/valid/failed-selector-ambiguous.json` |
| D-11 | inline/fragment 目标无法定位到结构化节点 | 是 | `failed` | `failure.domain=selector` + `resolution.state=unresolvable` + `reason_code`/`facts` | `selector.inline_unresolvable` | `step/valid/failed-selector-unresolvable-inline.json` |
| D-12 | 已尝试，但 dump/transport 不可得导致 resolution 无法完成 | 是 | `failed` | `failure.domain=infrastructure` + `resolution.state=unresolvable` (`selector.dump_unavailable`) | `infrastructure.transport_failure` | `step/valid/failed-infrastructure-dump-unavailable.json` |
| D-13 | presence 断言已执行且 `observed_present=false` | 是 | `failed` | `failure.domain=assertion` + assertion observation | `assertion.mismatch` | `step/valid/failed-assertion-mismatch-presence.json` |
| D-14 | absence 断言已执行且 `observed_present=true` | 是 | `failed` | `failure.domain=assertion` + assertion observation | `assertion.mismatch` | `step/valid/failed-assertion-mismatch-absence.json` |
| D-15 | Toast 断言已执行且 `observed=false` | 是 | `failed` | `failure.domain=assertion` + toast observation | `assertion.mismatch` | `step/valid/failed-assertion-toast-mismatch.json` |
| D-16 | 已 dispatch 后 adapter 返回 unsupported | 是 | `failed` | `failure.domain=capability` | `capability.unsupported` | `step/valid/failed-capability-after-dispatch.json` |
| D-17 | 已 dispatch 后发生 device/transport I/O 失败 | 是 | `failed` | `failure.domain=infrastructure` | `infrastructure.transport_failure` | `step/valid/failed-infrastructure-transport.json` |
| D-18 | 已进入真实 adapter 后才发现的**动态**契约违例 | 是 | `failed` | `failure.domain=contract` | `contract.invalid_step` | `step/valid/failed-contract-invalid-step-runtime.json` |
| D-19 | 未预期 Python exception（driver crash / internal bug） | 是 | `failed` | `failure.domain=internal` | `internal.unexpected_exception` | `step/valid/failed-internal-unexpected-exception.json` |

**约束**：

- `performed=false` + `failed` 是**合法**组合（D-09/D-10/D-11）；**不得**因为「UI 没变化」把它改写成 `blocked`；
- **禁止**根据 exception message 搜索字符串决定 domain/code；
- **禁止**为维持旧枚举把 invalid contract 压成 `selector.not_found`。

---

## D. 因果传播（未尝试 → `blocked/prior_step`）

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-20 | 同 case 中根 step `failed`，后缀未执行 | 否 | `blocked` | `cause.type=prior_step`，`step_index` **直接指向根 step** | — | `step/valid/blocked-prior-step.json` |
| D-21 | 同 case 中根 step 为 `blocked/capability\|infrastructure`，后缀未执行 | 否 | `blocked` | `cause.type=prior_step` 直接指向 root，**禁止链式 `prior_step → prior_step`** | — | `trace/valid/root-blocked-capability.json` |
| D-22 | 设备在 case 中途死亡，当前 step 已 attempted | 是 | `failed` | `failure.domain=infrastructure`；同 case 后缀 `prior_step` 指向它 | `infrastructure.device_unavailable` | `trace/valid/device-death-midrun.json` |
| D-23 | 设备死亡后的**下一个 case** 首 step（新的机器 probe） | 否 | `blocked` | `cause.type=infrastructure`，本 case 自己的 root，**禁止跨 case 引用 index** | `infrastructure.device_unavailable` | `trace/valid/device-death-midrun.json` |

**约束**：根失败的 `failure.domain/code` **禁止**复制给后缀 blocked（0.4.1 的放大源）。根 cause 只投影一次，后续 `prior_step` 不重复投影。

---

## E. 策略 / 可选路径（未尝试 → `skipped`）

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-24 | flag 明确关闭 expected check | 否 | `skipped` | `reason.type=policy` | `expected_check.disabled_by_flag` | `step/valid/skipped-expected-disabled.json` |
| D-25 | expected check 为**可选**项，且机器 probe 证明无 VLM | 否 | `skipped` | `reason.type=policy` + 必需 `facts.probe_status/probe_source` | `expected_check.unavailable_no_vlm` | `step/valid/skipped-expected-no-vlm.json` |
| D-26 | expected 内容为空且契约定义为不适用 | 否 | `skipped` | `reason.type=not_applicable` | `expected_check.empty` | `step/valid/skipped-expected-empty.json` |
| D-27 | optional Toast 且计划策略 `on_unsupported=skip` | 否 | `skipped` | `reason.type=policy` + 能力 probe facts | `optional_check.on_unsupported_skip` | `step/valid/skipped-optional-toast-on-unsupported.json` |
| D-28 | expected 本应进入 `checked_vlm`，但**前序 action 已失败** | 否 | `blocked` | `cause.type=prior_step`；**禁止**写 `expected_check.unavailable_no_vlm` | — | `step/valid/blocked-checked-vlm-prior-step.json` |

**约束**：VLM/Toast 是 **required** 契约时，dispatch 前机器证明能力缺失 → `blocked/capability`（D-07）；已 dispatch 后才失败 → `failed/capability`（D-16）。`skipped` 不是 capability failure。

---

## F. 成功路径（已尝试 → `passed`）

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-29 | action operation 成功 | 是 | `passed` | `observation.kind=action`, `performed=true` | — | `step/valid/passed-action-unique-selector.json` |
| D-30 | assertion 成功 | 是 | `passed` | `observation.kind=assertion`, `matched=true` | — | `step/valid/passed-assertion-presence.json` |
| D-31 | 无 selector 的 `wait`/`back`/`start_app` 等成功 | 是 | `passed` | `observation.kind=action`；**`None` 不是成功证据** | — | `step/valid/passed-action-no-selector-wait.json` |
| D-32 | absence 断言成功 | 是 | `passed` | `observation.assertion_type=absence`, `matched=true` | — | `step/valid/passed-assertion-absence.json` |
| D-33 | Toast 覆盖触发窗口且 matched | 是 | `passed` | toast observation, `trigger_window_covered=true` | — | `step/valid/passed-assertion-toast-covered.json` |
| D-34 | expected VLM matched | 是 | `passed` | `observation.assertion_type=expected` | — | `step/valid/passed-assertion-expected-vlm.json` |

---

## G. Failure-boundary artifact

| id | 发现阶段 / 机器事实 | attempted | status | carrier | code | fixture |
|---|---|---|---|---|---|---|
| D-35 | device session 内 selector/assertion 根失败，截图/dump 采集成功 | 是 | `failed` | `artifacts` 至少一项 `screenshot\|ui_dump\|visible_elements` | `selector.not_found` | `step/valid/failed-selector-not-found.json` |
| D-36 | 同上，但采集因设备/transport 不可用而失败 | 是 | `failed` | **不伪造 artifact**；`extensions["hylyre.capture"].screen="unavailable"`，且 CaseResult `evidence=incomplete` | `selector.not_found` | `step/valid/failed-selector-capture-unavailable.json` |
| D-37 | device session 尚未建立时的 selector 失败 | 是 | `failed` | 不适用 failure-boundary artifact 必填条件（`device_session=false`） | `selector.not_found` | `step/valid/failed-selector-no-device-session.json` |

**路径基准**：生成的 `artifacts[].path` **必须**相对于 authoritative trace 文件所在目录（`resolve(dirname(trace_path), path)`），因此 Hylyre 把 failure 目录放在 trace 旁，记录形如 `failures/<label>.png`。**禁止**写绝对路径或依赖当前工作目录；解析后不得逃逸该目录树。详见 `step-outcome-v1.md` §8.1。

**约束**：该义务**只**覆盖 `failure.domain ∈ {selector, assertion}` 的真实根失败，**每个根失败最多一组** artifact。**禁止**扩张为每步截图、成功路径强制取证、blocked/skipped 重复截图，或因 artifact 机制新增第二份步骤 ledger。执行前 contract failure、`blocked/capability`、`blocked/infrastructure` 均不适用。

---

## H. CaseResult / RunResult 派生（reducer，不属于 builder）

`CaseResult = reduce(StepResult[])`；入口不得自由填写三轴。判定规则见 `step-outcome-v1.md` §9。

下表冻结代表性归约结果。**契约包内随包发布了一份 §9/§12 的参考 reducer/verifier**：[`reference_reducer.py`](reference_reducer.py)（`tests/schema/test_step_outcome_contract.py` 只是驱动它）。它从每个 valid trace fixture 的 `steps[]` **实际复算**三轴、legacy status、run outcome 与 `tool_calls` 投影，并对 `trace/invalid-crossrow/` 下的篡改样例逐个给出具名拒绝。该 oracle 离线可得、不是生产实现；Phase 1 的生产 reducer/verifier 必须对同一组 fixture 给出相同结论（layer-1 conformance）。

| id | 场景 | execution | verification | evidence | legacy status | run outcome | fixture |
|---|---|---|---|---|---|---|---|
| R-01 | 1 个根 `failed` + 4 个 `blocked/prior_step` + expected `skipped/unavailable_no_vlm` | `aborted` | `failed` | `complete` | `失败` | `failed` | `trace/valid/bc-opencard-1.json` |
| R-02 | 全部 `passed`，required assertion 有 observation | `completed` | `passed` | `complete` | `通过` | `success` | `trace/valid/all-passed.json` |
| R-03 | root `blocked/capability` + 2 个 `prior_step` | `aborted` | `failed` | `complete` | `阻塞` | `failed` | `trace/valid/root-blocked-capability.json` |
| R-04 | 设备中途死亡（case1 `failed/infrastructure`）+ 后续 case root `blocked/infrastructure` | `infrastructure_failed` | `failed` | `complete` | `阻塞` | `failed` | `trace/valid/device-death-midrun.json` |
| R-05 | expected 被 flag 关闭，其余全 `passed` | `completed` | `inconclusive` | `complete` | `跳过` | `partial` | `trace/valid/expected-disabled.json` |

**约束**：

- `blocked` / `skipped` **不产生** failure route；`blocked/cause.type=capability` 只投影 **1 次** capability defer；`blocked/cause.type=infrastructure` 只投影 **1 次** external/toolchain disposition；后续 `prior_step` 不重复投影；
- `failed/failure.domain=capability` 产生 **1 条** failed root route，且该 route 的 disposition 为 capability defer、**0** coding candidate；
- Case/Markdown notes 优先展示真实 failed step，并汇总「后续 N 步未执行」；**不得**把 N 个 blocked 记成 N 个缺陷；
- `tool_calls`、Markdown、pass-rate 是投影，**不得**反向覆盖 trace。

---

## I. 单一 builder 接线（P0-7）

以下入口**必须**调用同一个 `OperationOutcome → StepResult` builder：

```text
real plan runner (hylyre run --plan)
native / resolver driver
fake runner
run --steps-file / inline batch
atomic CLI (hylyre run <step>)
MCP atomic / batch
session daemon
```

**禁止**：

1. fake 手工拼 `StepResult`；
2. batch 缺 `step_result` 时按 row status 猜 failure；
3. assertion 返回 `None` 默认 `passed`；
4. legacy 中文 status 反推成新协议 `StepResult`；
5. 任何入口绕过 builder 直接构造 `outcome` 字典。

fake 必须实现同一 driver outcome 接口；它只能改变**观测来源**，不能改变协议语义。允许差异仅限：`environment`、`duration_ms`、真实 `bounds` 与 artifact 内容。

---

## J. 分层 conformance（不做笛卡尔积）

| 层 | 范围 | 要求 |
|---|---|---|
| 1 | builder / Schema / reducer / verifier | 对本表与 `golden/**` 做**完整**场景矩阵 |
| 2 | 发布关键入口：real plan、fake、steps-file/batch | 各跑完整关键正负场景，证明没有旁路 builder |
| 3 | atomic CLI、MCP、session | **每入口至少一条**端到端 smoke（envelope、variant、错误传播、协议版本） |

各层比较 `outcome.status`、`failure`/`cause`/`reason`、`observation`、`selector.request`/`resolution`、`artifacts` 与 CaseResult 派生。

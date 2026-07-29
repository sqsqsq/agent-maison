# Delta: Harness Gates — 设备阻断产出与模拟器结论封顶

## MODIFIED Requirements

### Requirement: Screen-locked device produces the existing external-block contract

hmos-app profile 的 UT 失败分类 MUST 对设备锁屏产出 `blocking_class='externalBlocked'` 与 `failure_kind='device_blocked'`，从而落入既有 `DEFAULT_DEPENDENCY_POLICY` 的可 defer 契约。MUST NOT 停留在默认的 `toolchain:false` 分支（该分支会使上层兜底为 `code_regression`）。

精确原因 MUST 只保留在 blocker 的 `details_excerpt` 或既有 HDC diagnosis 中。MUST NOT 新增 summary 顶层字段（`summary.schema.json` 为 `additionalProperties:false`，且该原因仅供人读，不应扩大协议面）。

上游 verdict gate 的环境层指引措辞 MUST 表述为「请人解锁真机」，MUST NOT 使用可被 agent 读作自我指令的「解锁真机」。

#### Scenario: 锁屏归入设备阻断
- **WHEN** `aa test` 因屏幕锁定失败
- **THEN** CheckResult 带 `blocking_class='externalBlocked'` 与 `failure_kind='device_blocked'`

#### Scenario: 混合失败不整体 defer
- **WHEN** 同一 phase 内模块 A 因锁屏失败、模块 B 用例真实失败
- **THEN** MUST NOT 整体判 defer；模块 B 的真实失败仍须 FAIL（设备问题不得掩盖代码问题）

### Requirement: Emulator-backed testing cannot claim a full pass

testing 阶段结论 MUST 由 runner 依可信 device session 派生：当 `target_kind ∈ {emulator, unknown}` 时，**无论 agent summary 声称什么**，最终结论 MUST 封顶为 PARTIAL/DEFERRED，MUST NOT 判定整体 READY/COMPLETED。ut 阶段允许在模拟器上取得 PASS。

该封顶 MUST NOT 依赖 agent 自报（自报即可绕过）。

#### Scenario: 模拟器 testing 不得冒充真机通过
- **WHEN** testing 在托管模拟器上执行且 agent summary 自报 PASS
- **THEN** runner 依 device session 将结论降为 PARTIAL/DEFERRED

#### Scenario: unknown 不被推断为真机
- **WHEN** `target_kind` 无法由正面证据确认
- **THEN** 记 `unknown` 并按模拟器同等封顶处理

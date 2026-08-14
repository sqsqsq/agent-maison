## ADDED Requirements

### Requirement: Trusted device evidence refines testing failure attribution

goal-runner SHALL 在 testing collector 完成既有 run/session/target 绑定校验与 `test_case_flow` 根因裁决后，使用非空可信根失败分类精修本 attempt 的 failure kind。仅当基础分类为 `code_regression` 且全部可信根失败均为 `test_contract` 时，最终分类 MUST 为 `test_contract`；缺失、绑定失败、空集或混合分类 MUST NOT 触发精修。该值 SHALL 用于 blocker signature、`phase_verdict.failure_kind_classified`、goal report 与后续 prompt。

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: 全部可信根失败属于测试契约

- **WHEN** testing 基础分类为 `code_regression`，且 collector 验证后的非空根失败全部分类为 `test_contract`
- **THEN** phase verdict 与 goal report 的 `failure_kind_classified` 为 `test_contract`
- **AND** runner 不注入修改或回滚产品源码的话术

#### Scenario: 证据不可信或分类混合时保持保守归因

- **WHEN** device evidence 绑定失败、根失败集合为空，或可信根失败同时包含 `test_contract` 与其他分类
- **THEN** runner 保持基础 failure kind，不以该 evidence 精修为 `test_contract`

### Requirement: Test-contract attribution survives retry and resume

goal-runner SHALL 把精修后的 `test_contract` 持久化到事件，并在同进程 retry 和 `--resume` 时从最新适用的 `phase_verdict.failure_kind_classified` 恢复。恢复后的 testing prompt MUST 指向 selector、ui-spec、测试锚点或 runner 契约，MUST NOT 指示修改产品源码。该分类 MUST NOT 新增 signature halt、累计 halt 或 backtrack-to-coding 策略。

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: 同进程 retry 保持测试契约归因

- **WHEN** testing attempt 以 `test_contract` 失败并进入同进程下一 attempt
- **THEN** continuation 恢复 `test_contract` 且 prompt 不含产品源码回滚/修改指令

#### Scenario: Resume 保持测试契约归因

- **WHEN** runner 以 `--resume` 恢复一个最新 testing verdict 为 `test_contract` 的 run
- **THEN** 首个恢复 attempt 继续使用 `test_contract` prompt
- **AND** 不因该分类产生 `backtrack_to_coding` 或 `phase_backtrack_started`

### Requirement: Locked HarmonyOS devices use one bounded keypad reveal

设备就绪门的自动解锁 SHALL 固定执行 `wake → snapshot → reveal at most once → fresh snapshot → validate → input → verify`。只有当第一快照确认同一设备处于锁屏、无明确冷却且没有完整可信 PIN 键盘时才执行一次非秘密上滑；reveal 后 MUST 重新读取同源快照，MUST NOT 复用旧快照或以 sleep/多轮盲手势替代状态迁移。

Enforcement: `harness/scripts/utils/device-unlock-helper.ts`, `harness/scripts/utils/device-readiness-deps.ts`, `profiles/hmos-app/harness/device-recovery-bridge.ts`

#### Scenario: 时钟态经一次 reveal 展示 PIN 键盘

- **WHEN** wake 后快照确认锁屏、冷却状态为 `not_cooldown`，但 PIN 键盘不完整
- **THEN** helper 执行一次 reveal 并重新取快照
- **AND** 只有新快照通过全部 PIN 校验后才输入登记凭据

#### Scenario: Reveal 后仍不可信则零输入

- **WHEN** reveal 后快照仍缺键、重复数字、几何异常、锁屏身份不明，或冷却状态为 `cooldown`/`ambiguous`
- **THEN** helper 不输入任何凭据并返回稳定的阻塞 rule id

### Requirement: PIN and cooldown parsing are scoped and privacy-safe

HarmonyOS 锁屏 parser MUST 只在 `Digital_PSD_Input_Tip` 容器内识别 PIN 数字键，单键值 SHALL 优先读取 `originalText` 并在其为空时读取 `text`，且完整键盘 MUST 同时满足 0–9 唯一、bounds 有效和三列四行几何约束。时钟数字与 `numKeyBoard` 字母提示层 MUST NOT 成为 PIN 键。

冷却判定 MUST 只读取认证/Bouncer 子树并返回 `cooldown | not_cooldown | ambiguous`；通知子树和人脸识别失败提示 MUST NOT 造成冷却。任何 unlock outcome 及其在 `device_unlock_attempt`、`device_ready.notes`、`phase_halt.notes` 的投影 MUST NOT 包含 UI 原文、通知内容或凭据。

Enforcement: `harness/scripts/utils/device-readiness-deps.ts`, `harness/scripts/utils/device-unlock-helper.ts`, `harness/scripts/utils/device-readiness-gate.ts`

#### Scenario: 真机键盘 fixture 只产生十个可信键

- **WHEN** parser 读取脱敏真机 stable-keypad fixture
- **THEN** 识别结果恰含唯一 0–9 及其真实坐标
- **AND** `numKeyBoard` 的 ABC/DEF 等提示节点被忽略

#### Scenario: 时钟与人脸提示不触发输入或冷却

- **WHEN** parser 读取仅含锁屏时钟数字或人脸识别失败“重试”提示的 fixture
- **THEN** keypad 为空且 cooldown 为 `not_cooldown`

#### Scenario: 通知可疑词不泄露到任一事件出口

- **WHEN** 通知子树含 retry、disabled 或其他冷却相似词
- **THEN** 该文本不影响冷却判定
- **AND** `device_unlock_attempt`、`device_ready.notes` 与 `phase_halt.notes` 均不包含通知原文

### Requirement: Successful reveal is observable at the readiness gate

设备就绪门 SHALL 在同一次真实锁屏恢复中记录成功的 `device_unlock_attempt`，随后仅在复验设备已解锁时记录 `device_ready` 并允许 agent invocation。reveal 手势参数 MUST 按 HarmonyOS `uitest uiInput swipe` 的 velocity 语义传递合法值。

Enforcement: `harness/scripts/utils/device-readiness-gate.ts`, `harness/scripts/utils/device-readiness-deps.ts`

#### Scenario: 真机自动 reveal 并解锁成功

- **WHEN** 已登记凭据的受支持真机从时钟锁屏态进入设备就绪门，自动 reveal 后识别到可信 PIN 键盘并解锁
- **THEN** 本次 gate 事件包含 `device_unlock_attempt` 且 outcome 为 `succeeded`
- **AND** 后续 `device_ready` 为 PASS，目标 serial 保持不变

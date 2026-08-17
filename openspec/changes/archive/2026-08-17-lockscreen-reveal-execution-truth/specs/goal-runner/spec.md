## MODIFIED Requirements

### Requirement: Successful reveal is observable at the readiness gate

设备就绪门 SHALL 在同一次真实锁屏恢复中记录成功的 `device_unlock_attempt`，随后仅在复验设备已解锁时记录 `device_ready` 并允许 agent invocation。

reveal 手势的 velocity 与其命令超时 MUST 出自**同一处操作策略**，MUST NOT 是分散的独立字面量；velocity MUST 落在 HarmonyOS `uitest uiInput swipe` 的合法域内，超时 MUST 不低于既定下限。二者是否**相容**（手势能在超时内真正完成）MUST 由真机验收证明，MUST NOT 依赖 distance/velocity 的理论时长断言——事故组合（300 px/s + 5s）的理论值 3.07s 小于其超时却在真机上稳定耗时 5.2s，理论断言会放行它。

reveal 命令的执行结果 MUST 进入解锁事实链：设备命令执行事实 MUST 携带 `status`、`signal`、`timedOut` 与枚举化 `errorCode`，MUST NOT 只保留成败布尔。该事实 MUST NOT 携带 `error.message`（含本机绝对路径）、UI 原文、通知内容或凭据。

同一次 unlock attempt MUST 最多执行一次 reveal；reveal 失败 MUST NOT 在同一 attempt 内触发自动重滑。

Enforcement: `harness/scripts/utils/device-readiness-gate.ts`, `harness/scripts/utils/device-readiness-deps.ts`

#### Scenario: 真机自动 reveal 并解锁成功

- **WHEN** 已登记凭据的受支持真机从时钟锁屏态进入设备就绪门，自动 reveal 后识别到可信 PIN 键盘并解锁
- **THEN** 本次 gate 事件包含 `device_unlock_attempt` 且 outcome 为 `succeeded`
- **AND** 后续 `device_ready` 为 PASS，目标 serial 保持不变

#### Scenario: reveal 命令超时被终止

- **WHEN** reveal 手势命令未在其超时内完成并被信号终止
- **THEN** 执行事实记录 `timedOut` 与 `errorCode`，且该事实随解锁结论上浮
- **AND** 本次 attempt 不再发出第二次 reveal

## ADDED Requirements

### Requirement: Layout classification requires evidence that reveal succeeded

`layout_unsupported` MUST 只在 reveal **成功**之后、由其后的 UI 快照产生。reveal 未成功时，解锁链 MUST 立即以零输入退出并归因为 `reveal_failed`，MUST NOT 取用 reveal 之后的任何快照做布局结论，MUST NOT 进入重采样窗口。

`reveal_failed` 的判据 MUST 收窄为「reveal 命令自身执行失败或超时」，MUST NOT 吸纳凭据不可用、UI 未稳定或布局不支持等既有形态。其处置指向排查 hdc/设备连通性，MUST NOT 指向真机布局校准——该类归因及其在 `device_unlock_attempt`、`phase_halt` 的投影 MUST NOT 出现「真机校准」类指引。

`reveal_failed` 路径 MUST 为零输入：MUST NOT 发生任何 PIN 点击，MUST NOT 烧毁凭据版本。

Enforcement: `harness/scripts/utils/device-unlock-helper.ts`, `harness/scripts/utils/device-readiness-deps.ts`

#### Scenario: reveal 失败后快照恰为时钟页形态

- **WHEN** reveal 命令被超时终止，其后的 UI 快照呈现 `pin_container_not_found`（容器缺席、识别到 0 个数字键）
- **THEN** 解锁结论为 `reveal_failed` 而非 `layout_unsupported`
- **AND** note 不含「真机校准」指引，且未发生任何 PIN 点击

#### Scenario: reveal 成功后容器持续缺席

- **WHEN** reveal 成功执行，但跑满有界重采样窗口后 PIN 容器仍未出现
- **THEN** 解锁结论仍为 `layout_unsupported`，既有有界观察行为不变

#### Scenario: 归因原样贯通到消费面

- **WHEN** 解锁链以 `reveal_failed` 结束
- **THEN** `device_unlock_attempt.failure_kind` 与 `phase_halt.unlock_failure_kind` 均为 `reveal_failed`
- **AND** 运行期恢复与 profile 侧恢复桥原样透传该归因，不将其压平为处置枚举

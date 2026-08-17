## ADDED Requirements

### Requirement: Device policy check reports credential truth not merely declared intent

`device-policy --check` 的 `code` MUST 反映**当前是否真有一条可走的设备路径**，MUST NOT 仅凭
「配置里表达过策略意图」判 `ok`。

`code=ok` 当且仅当至少一条成立：`unlock.mode=manual`；`unlock.mode=credential` 且该凭据的
OS 凭据库状态为 `ready` 或 `in_flight`；`emulator_fallback ∈ {existing, managed}`。

- **可用降级档位 MUST 收窄为 `existing|managed`**。`emulator_fallback=disabled` 是「明确不
  降级」的表达，MUST NOT 被当作可用路径，也 MUST NOT 掩盖一条不可用的解锁凭据。
- `credential` 模式下「凭据不可用」MUST 包含：`credential_ref` 缺失、`credential_ref` 非法
  （指不到任何凭据）、凭据状态为 `absent`（无读取错误）/`burned`/`unsupported`。
- `in_flight` MUST 被视为「无需重新选择策略」（并发占用或上次崩在临界区；立即重新登记会
  隐式回退不到旧版本），MUST NOT 被表述为「一定解得开」——运行期解锁失败仍走既有零输入
  分支。其 guidance MUST NOT 停在「稍后重试」：崩在临界区遗留的 claim 是**持久**状态
  （claim 内的口令永远用不上，等价 disabled），MUST 同时说明确认无并发且状态持续存在时，
  唯一出路是登记新版本。
- `device_policy_unset` 的 `guidance` MUST 按不可用形态区分该 `enroll` 还是 `rebind`。

`configured` 字段 MUST 保留「是否表达过策略意图」语义，并 MUST 与 `code` 解耦：坏凭据下
`configured=true` 与 `code=device_policy_unset` MUST 可同时成立。**所有消费方（含人读模式
退出码）MUST 以 `code` 为处置真源**：人读模式 MUST 在 `code=ok` 时退出 0、在
`device_policy_unset` 时退出 3，MUST NOT 依据 `configured` 退出。

#### Scenario: 引用存在但凭据已烧毁
- **WHEN** `unlock.mode=credential` 且 `credential_ref` 指向的凭据在 OS 凭据库中为 `burned`，且无可用降级档位
- **THEN** `code` MUST 为 `device_policy_unset`，`credential_state` MUST 如实透出 `burned`
- **AND** `configured` MUST 仍为 `true`，`guidance` MUST 指向重新登记并说明墓碑不可 rebind

#### Scenario: 引用丢失但凭据本体可能仍在
- **WHEN** `unlock.mode=credential` 而 `credential_ref` 缺失
- **THEN** `code` MUST 为 `device_policy_unset`，`guidance` MUST 优先指引 `rebind`（无需重输 PIN）

#### Scenario: disabled 不构成可用路径
- **WHEN** 配置只有 `emulator_fallback=disabled`，或坏凭据叠加 `disabled`
- **THEN** `code` MUST 为 `device_policy_unset`

#### Scenario: 已授权模拟器降级可覆盖坏凭据
- **WHEN** 凭据不可用但 `emulator_fallback ∈ {existing, managed}`
- **THEN** `code` MUST 为 `ok`，且 `credential_state` MUST 仍如实透出不可用状态

#### Scenario: 人读退出码以 code 为准
- **WHEN** `configured=true` 而 `code=device_policy_unset`
- **THEN** 人读模式 MUST 以非零（3）退出，MUST NOT 因 `configured=true` 而退出 0

> **Enforced by:** `harness/scripts/device-policy.ts`,
> `harness/tests/unit/device-policy-cli.unit.test.ts`

### Requirement: Unreadable credential vault is a check execution failure

凭据库不可读（provider 不可用、凭据服务异常、权限不足）时，`device-policy --check` MUST 走
既有**执行失败**通道：非零退出、stdout MUST NOT 输出合法 JSON、原因 MUST 进 stderr。

MUST NOT 报 `code=ok`（凭据可用性根本没读到，报 ok 即继续制造假阳性）；MUST NOT 报
`code=device_policy_unset`（会把用户导向重新登记一条其实可能好着的凭据）。stderr MUST 明确
声明这**不是**「未配置」。

`--json` 的「退出码 0」承诺 MUST 限定为两个正常态（`ok` 与 `device_policy_unset`）；
参数非法、配置损坏、凭据库不可读 MUST 非零退出且 stdout 无 JSON。

#### Scenario: 凭据库读取失败
- **WHEN** `unlock.mode=credential` 且 provider 的 inspect 返回读取错误
- **THEN** `--check --json` MUST 非零退出、stdout MUST NOT 可 `JSON.parse`
- **AND** stderr MUST 报告 provider 原始错误并声明这不是「未配置」、不要据此重新登记

> **Enforced by:** `harness/scripts/device-policy.ts`,
> `harness/tests/unit/device-policy-cli.unit.test.ts`

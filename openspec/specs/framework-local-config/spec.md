# framework-local-config Specification

## Purpose
TBD - created by archiving change framework-init-orchestration-refactor. Update Purpose after archive.
## Requirements
### Requirement: Personal settings in gitignored local file

The system SHALL store personal settings in `<projectRoot>/framework.local.json`
(gitignored), including `agent_adapter` and `toolchain.devEcoStudio.installPath`.
Project-level `framework.config.json` MUST use `materialized_adapters: string[]`
instead of a single active adapter.

#### Scenario: Local merge at runtime
- **WHEN** both project config and local config exist
- **THEN** `loadFrameworkConfig()` MUST expose merged runtime values with
  `agent_adapter` from local overriding project legacy fields

> **Enforced by:** `harness/config.ts`, `specs/framework.local.schema.json`

### Requirement: Personal setup status with forced callers

The system SHALL expose `getFrameworkPersonalSetupStatus()` returning
`local | project_legacy | fallback` for `agent_adapter`, and MUST be invoked
before phase runs (harness-runner), Skill bootstrap, and adapter slash commands.
When status is `fallback`, the system MUST guide personal setup and MUST NOT
silently continue as generic.

#### Scenario: Feature phase blocked without personal setup
- **WHEN** harness-runner starts a feature phase and
  `getFrameworkPersonalSetupStatus().source` is `fallback`
- **THEN** the runner MUST exit non-zero and direct the user to
  `/framework-setup` before continuing

#### Scenario: check-personal-setup CLI for Skill and adapter entry
- **WHEN** `check-personal-setup.ts --project-root <repo>` runs and personal
  setup status is `fallback`, or active adapter is not in
  `materialized_adapters`, or the adapter entry file is missing
- **THEN** the script MUST exit non-zero with guidance to `/framework-setup`
  or `/framework-init` as appropriate

> **Enforced by:** `harness/config.ts`, `harness/harness-runner.ts`,
> `harness/scripts/check-personal-setup.ts`,
> `harness/scripts/utils/personal-setup-gate.ts`,
> `harness/tests/unit/personal-setup-gate.unit.test.ts`,
> `skills/reference/personal-setup-gate.md`

### Requirement: Migrate legacy personal fields on UPDATE

UPDATE init MUST migrate `agent_adapter` and DevEco installPath from project
config to local file via `extract_personal_to_local` migration rule.

#### Scenario: Legacy agent_adapter moves to local on migrate-config
- **WHEN** S3 executes `migrate-config` on a project config that still contains
  `agent_adapter` and `toolchain.devEcoStudio.installPath`
- **THEN** project config MUST gain `materialized_adapters`, lose personal
  fields, and `framework.local.json` MUST receive the migrated values

> **Enforced by:** `harness/scripts/utils/config-field-merger.ts`

### Requirement: Device policy block in framework.local.json

`framework.local.json` MUST 支持顶层 `device` 键，并 MUST 同步更新顶层键白名单（`LOCAL_CANONICAL_TOP_KEYS`）、loader 校验、schema（含版本与旧配置迁移）、类型与 personal setup 回写路径——loader 拒绝未知字段且 schema 为 `additionalProperties:false`，缺任一环即无法加载。

最小 schema：

- `unlock.mode`：`manual | credential`
- `credential_ref`：opaque 引用，MUST NOT 存放任何明文口令
- `emulator_fallback`：`disabled | existing | managed`
- `target_serial`（可选）

单一布尔开关不可接受——它无法区分「人工解锁」与「允许模拟器降级」两种独立意图。「本次停止」是本次运行结果，MUST NOT 持久化。

round-trip 读写 MUST NOT 丢失字段；旧配置（无 `device` 键）MUST 可正常加载并按 `manual`/`disabled` 语义处理。

#### Scenario: 旧配置无 device 键仍可加载
- **WHEN** 既有 `framework.local.json` 不含 `device`
- **THEN** 加载成功，行为等价于 `unlock.mode=manual` + `emulator_fallback=disabled`

#### Scenario: 明文口令不得入配置
- **WHEN** 登记设备解锁凭据
- **THEN** `framework.local.json` 内只出现 opaque `credential_ref`；口令由 OS 凭据库托管

### Requirement: Immutable credential identity

每次登记 MUST 生成不可变的 `credential_ref` 与 `credential_version`。OS 凭据库 target 名 MUST 至少绑定 framework namespace + 设备 serial + `credential_version`（或使用不可变 UUID target）。轮换 MUST 新建记录并原子切换配置引用，MUST NOT 原地覆盖既有 target。

每个 run/attempt MUST 冻结 `{serial, credential_ref, credential_version}`；运行中 MUST NOT 因配置轮换而静默切换到新 secret。helper 读取凭据后 MUST 校验 serial 与 version 匹配，不匹配即 fail-closed。

#### Scenario: 并发轮换不污染进行中的 run
- **WHEN** Goal A 持有 v1 期间用户轮换至 v2
- **THEN** Goal A 继续按冻结的 v1 身份执行；MUST NOT 以 v1 的锁存状态使用 v2 的 secret

### Requirement: Explicit credential rebind recovery

The system SHALL provide an explicit `device:rebind --serial <s> --version <n>`
command to rebuild a lost `device.unlock.credential_ref` reference without re-entering
the PIN. Rebind MUST only bind a credential whose OS-vault state is `ready`; MUST NOT
enumerate versions, select the highest version, or roll back to an older version; and
MUST report distinct guidance for `burned`, `in_flight`, `unsupported`, and `absent`
(with or without a read error). Rebind MUST NOT touch the PIN itself.

#### Scenario: Rebind only binds a ready credential
- **WHEN** `device:rebind --serial <s> --version <n>` runs and the OS vault reports the
  credential as `ready`
- **THEN** `framework.local.json` MUST gain `device.unlock.mode=credential` and
  `device.unlock.credential_ref=maison/device/<s>/v<n>` (plus `target_serial`), preserving
  all other fields

#### Scenario: Rebind rejects non-ready states without rollback
- **WHEN** the OS vault reports `burned`, `in_flight`, `unsupported`, or `absent`
- **THEN** rebind MUST exit non-zero with state-specific guidance and MUST NOT write any
  config change

> **Enforced by:** `harness/scripts/device-policy.ts`, `harness/package.json`
> (`device:rebind`), `harness/tests/unit/device-policy-cli.unit.test.ts`

### Requirement: Probe object with fixed write-permission semantics

framework.local.json 的 toolchain 段 MUST 增显式建模的 probe 子对象（schema additionalProperties:false）：binary/cli_starts 层、project_compile 三态对象（status ∈ unknown|verified|capability_failed + failure_code/evidence/invocation_fingerprint/observed_at/expires_at）、last_attempt 与 known_quirks 人读段。写入权限 MUST 固定：check-personal-setup --ensure 只能更新 binary/cli_starts；verified 仅由 hvigor wrapper 真实编译成功写入；capability_failed 仅由 wrapper 可信环境分类写入；普通源码编译失败 MUST 保持 unknown。agent 声明 MUST NOT 升级 compile 态；known_quirks MUST NOT 参与任何 gate 判定。

#### Scenario: 新工程首次运行不死锁
- **WHEN** probe.project_compile.status=unknown（首次运行或指纹失效）
- **THEN** phase 前置检查放行本次真实编译（不判缺口不 halt），编译结果经 wrapper 回写状态

#### Scenario: agent 不可自证 verified
- **WHEN** agent 经 --ensure 或直接手编 framework.local.json 声明 compile 可用
- **THEN** project_compile 读取方按 unknown 处理（--ensure 结构上不触碰 compile 态；手编载荷因完整性摘要失配被拒——摘要为防手滑/威慑层级，非密码学；伪造收益面为零：probe 从不放行任何门禁，篡改只能回 unknown=重跑真实编译定谳）

> **Enforced by:** `specs/framework.local.schema.json`, `harness/scripts/utils/personal-setup-gate.ts`, `profiles/hmos-app/harness/hvigor-runner.ts`

### Requirement: Personal setup JSON contract for phase entry

`check-personal-setup.ts --json --ensure` MUST emit stable fields:
`ok`, `code`, `status`, `activeAdapter`, `materializedAdapters`, `ensured`,
`candidates`, `message`. Phase SKILLs and tests MUST parse this JSON only.

#### Scenario: needs_adapter_choice exposes candidates
- **WHEN** multiple materialized adapters exist and personal setup is fallback
- **THEN** JSON includes `code: "needs_adapter_choice"` and `candidates` listing adapter names

> **Enforced by:** `harness/scripts/utils/personal-setup-gate.ts`, `skills/reference/personal-setup-gate.md`

### Requirement: The personal visual provider lives in the local vision block

`framework.local.json` SHALL accept an optional `vision.visual_provider` object with exactly the keys
`{adapter, model}`, both non-empty strings. `model` is mandatory — an endpoint without a frozen model
is not a provider identity. The key SHALL be registered in the local vision key ownership set, and
parsing/validation SHALL live with the other `vision` fields, rejecting unknown keys as the block
already does.

Writes SHALL go exclusively through the lossless local-config update entry point. The framework SHALL
NOT hand-merge a partial local config for this field: two prior incidents erased whole sections that
way, and the provider block sits beside device credentials in the same file.

The agent SHALL NOT hand-write this JSON. The value SHALL be recorded by a deterministic personal
scope task, following the existing personal-setup discipline (machine-written config plus a
confirmation-registry entry for the selection).

The run-scoped blind authorization flag `--allow-blind-visual` and manifest field
`allow_blind_visual` SHALL NOT be accepted or persisted in `framework.local.json`. Personal state may
remember a provider identity, but SHALL NOT silently authorize future blind runs.

Enforcement: `harness/scripts/utils/config-field-ownership.ts`,
`harness/scripts/utils/framework-local-config.ts`, `harness/scripts/init-orchestrate.ts`,
`skills/reference/confirmation-registry.yaml`

#### Scenario: an incomplete provider entry is rejected at load

- **WHEN** `vision.visual_provider` carries an adapter but no model, or carries an unknown key
- **THEN** local config validation SHALL reject it with an explicit message naming the field

#### Scenario: recording a provider preserves neighbouring personal state

- **WHEN** the provider selection is recorded on a local config that already holds device unlock and
  toolchain sections
- **THEN** those sections SHALL be present and unchanged after the write

#### Scenario: blind authorization is never personal state

- **WHEN** a run is started with `--allow-blind-visual`
- **THEN** no `allow_blind_visual` or equivalent authorization key SHALL be written to
  `framework.local.json`

### Requirement: Local product confirmation credential with strict validation

`framework.local.json > toolchain.productSelection.confirmed` MUST 承载本机 product 确认
凭证 `{ value, confirmed_at? }`：`value` 非空字符串、`confirmed_at`（若存在）非空 ISO
字符串；未知键 MUST 被拒绝（与 `LOCAL_PROBE_KEYS` 同等严格）。写入方唯一 =
`record-product-selection` 机器 CLI（用户经 registry `init.product_selection` 显式选择后），
写回 MUST 走 `updateLocalConfig` 无损路径（devEcoStudio / probe / vision / device 等既有
内容逐字保留）。config 与 local 由同一次操作写入并保持一致；任一方写入失败 MUST 回滚先写方
（fail-closed，任何时刻不留下仅单方的不一致状态）。

`explicit_config` 的可信判据 MUST 为：config `toolchain.preferredProduct` **且**
`toolchain.productSelection.confirmed.value` 逐字相等；无 local 记录或值不等均为
`legacy_unverified_config`，MUST NOT 作为可信来源（配置来源治理：推断值不得冒充用户意图）。
来源不明的存量 `preferredProduct` MUST NOT 被静默删除（配置所有权），仅不再被采信。

#### Scenario: 确认后 config 与 local 双写一致且 resolver 采信
- **WHEN** 用户确认 product=X（config 无值或为错误旧值）
- **THEN** config `toolchain.preferredProduct=X` 且 local `confirmed.value=X` 双写一致
- **AND** resolver 得 `explicit_config`，X 生效

#### Scenario: local 无记录时 config 值不采信
- **WHEN** config 有 `preferredProduct` 而 local 无确认记录（含他人 clone、AI 历史推断值）
- **THEN** resolver MUST 按未验证处理（只可能落 `sole_candidate` 或 `unresolved`）

> **Enforced by:** `harness/scripts/utils/framework-local-config.ts`,
> `harness/scripts/record-product-selection.ts`,
> `profiles/hmos-app/harness/product-selection.ts`,
> `harness/tests/unit/product-selection.unit.test.ts`

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


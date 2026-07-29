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


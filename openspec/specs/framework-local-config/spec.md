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


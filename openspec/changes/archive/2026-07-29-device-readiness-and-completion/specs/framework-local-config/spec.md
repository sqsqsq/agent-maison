# Delta: Framework Local Config — device 策略与凭据引用

## ADDED Requirements

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

## ADDED Requirements

### Requirement: Normal-mode device phases resolve one target at entry and share it across the whole chain

普通模式（`harness-runner --phase <p>`）在 `phaseRequiresDevice(p, profile)` 为真时，MUST 在
**任何设备操作之前**（脚本 harness 执行前）完成设备前置：策略检查 → 目标解析 → 就绪。
就绪 MUST 复用与 goal 侧**同一个共享核心** `ensureDeviceReady`；MUST NOT 使用只读探针
（`probeDeviceReadiness`，不 wake/不解锁/不启动降级）替代，MUST NOT 直接调用运行期恢复
（`ensureDeviceReadyAtRuntime`，它要求已有 serial、不负责选目标）。

**目标 MUST 只解析一次**，并 MUST 注入 `HARNESS_HDC_TARGET`，使后续 wake、解锁、`bm dump`、
install、`aa test` 全链共用同一 serial。解析优先级 MUST 为：显式 `HARNESS_HDC_TARGET` >
`device.target_serial` > 唯一在线设备；多台在线且无 `target_serial` MUST 走既有 AMBIGUOUS
停止求人。已显式设定的环境变量 MUST NOT 被覆盖。

配置目标不在线时 MUST 阻断，或走**已授权的**模拟器降级（`existing|managed`）；
**MUST NOT 跳过检查后让 hdc 隐式选择另一台在线设备**。

策略 `code=device_policy_unset` 时 MUST 前脚本 fail-fast：原文透传 `guidance`、非零退出、
MUST NOT 调用任何 checker/provider、MUST NOT 发出任何设备命令。四选一文案 MUST 保持单一
真源在 `device-policy`，MUST NOT 在门内另抄一份。策略检查自身执行失败（凭据库不可读、配置
损坏）MUST 与 `device_policy_unset` 分开报告，MUST NOT 引导用户重新登记凭据。

MUST NOT 为此新增 diagnosis kind、平行的 provider 局部门或第二套目标解析。profile 侧的
运行期恢复桥 MUST 只消费入口注入的目标，MUST NOT 读取 `framework.local.json` 自行解析目标。

**编译跳过类环境开关 MUST NOT 用于免除本门**：它们只跳过编译，UT 的真机执行受独立开关
控制、testing 更不认编译开关，据此让路等于门形同虚设。

托管启动（`managed`）的模拟器 MUST 在本进程退出时按既有所有权四元组回收，且回收登记
MUST 早于任何失败退出分支——「实例已启动但未就绪」（boot 超时/仍锁屏）是普通的可执行清理
失败路径，晚登记即零凭证泄漏。就绪核心给出的孤儿实例身份 MUST 随失败结果一并交出。

冻结上下文 MUST **整组原子**注入：应用后进程内的 `MAISON_DEVICE_*` MUST 恰好等于本次
`deviceEnvFor` 的产出，未返回的键 MUST 被删除。MUST NOT 逐键「不存在才写」——继承而来的
陈旧 `MAISON_DEVICE_CREDENTIAL_REF` 会被运行期优先取用，形成「`manual` 策略下仍自动输入
PIN」的越权路径。

`HARNESS_HDC_TARGET` **同样 MUST 以门的解析结果为准**，MUST NOT 保留注入前的旧值：显式目标
的优先级在门的**输入阶段**已经兑现，未降级时写回的本就是同一值，而发生**已授权降级**时最终
目标是模拟器 serial。保留旧值会产出 `HARNESS_HDC_TARGET`（离线真机）与
`MAISON_DEVICE_TARGET_KIND=emulator` 并存的目标分裂——hdc 操作离线真机，而设备门与 testing
封顶都以为目标是模拟器。

#### Scenario: manual 策略下不得残留陈旧凭据引用
- **WHEN** 进程继承了 `MAISON_DEVICE_CREDENTIAL_REF` 而本次策略为 `manual`（本次不产出 ref）
- **THEN** 注入后该变量 MUST 不存在，运行期 MUST NOT 取到任何凭据引用

#### Scenario: 托管实例启动后未就绪
- **WHEN** 降级启动了托管模拟器但它未在预算内就绪，入口前置判定失败
- **THEN** 该实例的所有权身份 MUST 随失败结果交出，且 MUST 在进程退出前登记回收

#### Scenario: 显式目标离线后走已授权降级
- **WHEN** 显式 `HARNESS_HDC_TARGET` 指向的真机不在线，入口前置按已授权 `existing`/`managed` 降级到模拟器
- **THEN** 注入后的 `HARNESS_HDC_TARGET` MUST 等于该模拟器 serial，MUST NOT 保留离线真机
- **AND** `MAISON_DEVICE_TARGET_KIND` 与 testing 封顶判据 MUST 与该同一目标同源

#### Scenario: 需设备 phase 在策略不可用时零设备操作
- **WHEN** `phaseRequiresDevice` 为真且 `device-policy --check` 返回 `device_policy_unset`
- **THEN** harness-runner MUST 非零退出并透传四选一 guidance
- **AND** MUST NOT 执行任何 checker/provider，MUST NOT 发出 `hdc install` 或 `aa test`

#### Scenario: 配置目标离线且无授权降级
- **WHEN** `device.target_serial` 指向的设备不在线，另有一台其它设备在线，且 `emulator_fallback=disabled`
- **THEN** 入口前置 MUST 阻断，MUST NOT 把那台在线设备当作目标注入

#### Scenario: 解析结果贯通全链
- **WHEN** 入口前置取得 READY
- **THEN** `HARNESS_HDC_TARGET` MUST 被注入为该目标，且解锁链与 hdc 命令 MUST 使用同一 serial

> **Enforced by:** `harness/harness-runner.ts`,
> `harness/scripts/utils/device-readiness-gate.ts`,
> `profiles/hmos-app/harness/device-recovery-bridge.ts`,
> `harness/tests/unit/device-readiness-gate.unit.test.ts`

### Requirement: Frozen attempt context is identified by target and frozen marker together

判定「本 attempt 已冻结」MUST 同时要求 `MAISON_DEVICE_ATTEMPT_FROZEN=1` **与**
`HARNESS_HDC_TARGET` 非空——goal 的设备就绪门取得 READY 时经 `deviceEnvFor` **成组**注入
`{HARNESS_HDC_TARGET, MAISON_DEVICE_SESSION_ID, MAISON_DEVICE_ATTEMPT_FROZEN}`，
故单字段判据 MUST NOT 被当作冻结证据。

`MAISON_DEVICE_ATTEMPT_FROZEN=1` 但 `HARNESS_HDC_TARGET` 缺失 MUST 判为冻结上下文损坏并
**fail-closed**：MUST NOT 回落到「隐式选择唯一在线设备」，否则手工设置单个环境变量即可绕过
设备门。

冻结上下文命中时，普通模式入口前置 MUST 整体让路：MUST NOT 重新解析目标、MUST NOT 重新
查询设备策略、MUST NOT 覆盖已注入的 env。

#### Scenario: 只有冻结标记没有目标
- **WHEN** 环境中 `MAISON_DEVICE_ATTEMPT_FROZEN=1` 而 `HARNESS_HDC_TARGET` 为空
- **THEN** 入口前置 MUST 阻断并说明冻结上下文损坏
- **AND** MUST NOT 解析任何目标、MUST NOT 查询设备策略

#### Scenario: goal 注入的完整上下文不被二次处理
- **WHEN** goal 就绪门已注入 target/session/frozen 后 agent 自跑 harness
- **THEN** 入口前置 MUST 复用该目标且不重查策略

> **Enforced by:** `harness/scripts/utils/device-readiness-gate.ts`,
> `harness/tests/unit/device-readiness-gate.unit.test.ts`

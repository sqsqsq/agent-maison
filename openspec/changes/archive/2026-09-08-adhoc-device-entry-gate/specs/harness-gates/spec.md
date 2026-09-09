# harness-gates Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Normal-mode device phases resolve one target at entry and share it across the whole chain`
- TO: `### Requirement: Normal-mode device phases, the ad-hoc device CLI and the standalone readiness entry resolve one target at entry and share it across the whole chain`

## MODIFIED Requirements

### Requirement: Normal-mode device phases, the ad-hoc device CLI and the standalone readiness entry resolve one target at entry and share it across the whole chain

普通模式（`harness-runner --phase <p>`）在 `phaseRequiresDevice(p, profile)` 为真时，MUST 在
**任何设备操作之前**（脚本 harness 执行前）完成设备前置：策略检查 → 目标解析 → 就绪。
就绪 MUST 复用与 goal 侧**同一个共享核心** `ensureDeviceReady`；MUST NOT 使用只读探针
（`probeDeviceReadiness`，不 wake/不解锁/不启动降级）替代，MUST NOT 直接调用运行期恢复
（`ensureDeviceReadyAtRuntime`，它要求已有 serial、不负责选目标）。

**同一道门 MUST 覆盖进程级的每一个设备入口**：普通模式的 `harness-runner`、即席设备 CLI
（`adhoc-device-test`）的 `--dump-ui-only` / 执行（`--plan` / `--steps-file`）/ `--observe-ui`
三个分支，以及独立就绪入口 `device-policy --ready`。这三类入口 MUST 共用**同一条接线实现**
（起门 → 打 notes → 登记托管回收 → 原子注入 env），MUST NOT 各抄一份——「回收登记必须早于
任何退出分支」这类纪律抄第二遍就会被抄漏。即席 CLI 的门 MUST 在该分支**第一个设备命令之前**
（`runAdhocDumpUi` / `resolveMainAbilityForBundle`）起，且 MUST 在不碰设备的 `ensureHylyreReady`
之后起（避免门刚解锁又在等待 pip 期间息屏）。门未通过时 MUST NOT 再发出任何设备命令；执行与
`--observe-ui` 分支 MUST 落既有 trace placeholder 并归 `error_kind='device_not_ready'`。
仅 derive（只给 `--steps`）与用法错误分支 MUST NOT 起门——它们不碰设备。即席 CLI MUST NOT
自建交互式四选一：`device_policy_unset` 时原文透传 `guidance` 后 fail-fast，与 harness-runner 同款。

**目标 MUST 只解析一次**，并 MUST 注入 `HARNESS_HDC_TARGET`，使后续 wake、解锁、`bm dump`、
install、`aa test` 全链共用同一 serial。解析优先级 MUST 为：显式 `HARNESS_HDC_TARGET` >
`device.target_serial` > 唯一在线设备；多台在线且无 `target_serial` MUST 走既有 AMBIGUOUS
停止求人。已显式设定的环境变量 MUST NOT 被覆盖。即席 CLI MUST 在门之后才读取设备目标，
MUST NOT 在起门之前读 `HARNESS_HDC_TARGET`——那正是「env 恒空 → 恢复桥整体跳过 → 已登记的
凭据永不被使用」的老形态。

配置目标不在线时 MUST 阻断，或走**已授权的**模拟器降级（`existing|managed`）；
**MUST NOT 跳过检查后让 hdc 隐式选择另一台在线设备**。

策略 `code=device_policy_unset` 时 MUST 前脚本 fail-fast：原文透传 `guidance`、非零退出、
MUST NOT 调用任何 checker/provider、MUST NOT 发出任何设备命令。四选一文案 MUST 保持单一
真源在 `device-policy`，MUST NOT 在门内另抄一份。策略检查自身执行失败（凭据库不可读、配置
损坏）MUST 与 `device_policy_unset` 分开报告，MUST NOT 引导用户重新登记凭据。

**独立就绪入口 `device-policy --ready [--serial <sn>] [--json]`**（`npm run device:ready`）：
未处于冻结上下文时 MUST 走同一道入口门（`--serial` 经既有优先级写入 `HARNESS_HDC_TARGET` 后
再起门），MUST NOT 自建第二套目标解析。处于冻结上下文（`MAISON_DEVICE_ATTEMPT_FROZEN=1`）时
MUST NOT 调门——门在该上下文只会放行，回答不了「此刻是否就绪」；MUST 沿用冻结目标与冻结授权
（`resolveAttemptCredentialRef`，冻结且无 ref 即未授权，MUST NOT 回落读配置）并复用运行期恢复
`ensureDeviceReadyAtRuntime`。冻结路径 **MUST 只把 `recovered=true` 判成功**：`unauthorized`
与 `unlock_failed` 归 `ok=false, code='blocked'` 并原文透传 note；探测判不出（`reason='unknown'`）
**同样** MUST 归 `ok=false, code='blocked'`，其 `reason` MUST 如实说明无法确认锁屏状态，
MUST NOT 宣称设备确定锁住，也 MUST NOT 放行——桥对 `unknown` 的放行语义只属于**有后续操作
去验证**的调用方，独立命令没有后续操作。`--serial` 与冻结目标不一致时 MUST 拒绝
（`code='frozen_target_mismatch'`）且 MUST 零设备操作。恢复桥本身 MUST NOT 因此改变判定。

`--ready --json` MUST 沿用 `--check` 的**两段退出码契约**：判定完成（含 `ready`、
`device_policy_unset`、`ambiguous`、`blocked`、`frozen_target_mismatch`）一律退出 0，调用方看
`code`；**只有执行失败**（凭据库不可读、配置损坏、就绪核心抛出）MUST 非零退出且 stdout 无
JSON，stderr MUST 说明这不是「未配置」、不要据此重新登记。结果 MUST 带上实际目标
（`serial` / `target_kind`，未解析出目标为 null）与 `reused_frozen`。`ok=true` MUST 只被理解为
**本次调用**确认了该目标可用：该入口 MUST NOT 持有托管会话、MUST NOT 承诺跨命令继承目标
（后续入口各自起门重解析），这一边界 MUST 写在结果的 notes 里而不是新增字段。

判定分类 MUST 机器可读：门的失败返回 MUST 带一个可选 `code`（`device_policy_unset` /
`ambiguous` / `blocked`），使 JSON 消费方 MUST NOT 靠解析 `reason` 文案或重跑
`collectPolicyStatus` 来区分「策略没配」与「设备阻断」。

MUST NOT 为此新增 diagnosis kind、平行的 provider 局部门或第二套目标解析，MUST NOT 把即席
CLI 变成一个 phase（不新增 `phaseRequiresDevice('adhoc')`），MUST NOT 新增恢复状态机或跨命令
会话保持。profile 侧的运行期恢复桥 MUST 只消费入口注入的目标，MUST NOT 读取
`framework.local.json` 自行解析目标。

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

#### Scenario: 即席执行在策略不可用时零设备命令
- **WHEN** 用户跑 `adhoc-device-test --bundle <id> --steps-file <p>` 而设备策略为 `device_policy_unset`
- **THEN** CLI MUST 在 `resolveMainAbilityForBundle` 之前阻断、原文透传 guidance 并非零退出
- **AND** MUST 落 `error_kind='device_not_ready'` 的 trace placeholder，MUST NOT 发出任何 `bm dump` / `aa` 命令

#### Scenario: 即席 derive 不起门
- **WHEN** 只给了 `--bundle` 与 `--steps`（仅推导步骤，不执行）
- **THEN** MUST NOT 起设备门、MUST NOT 唤醒或解锁任何设备

#### Scenario: 冻结上下文里的独立就绪判不出锁屏状态
- **WHEN** `--ready` 在 `MAISON_DEVICE_ATTEMPT_FROZEN=1` 下运行，运行期恢复返回 `recovered=false, reason='unknown'`
- **THEN** 结果 MUST 是 `ok=false, code='blocked'` 且 `reason` MUST 如实说明无法确认锁屏状态
- **AND** MUST NOT 宣称设备已锁，`--json` MUST 仍退出 0

#### Scenario: 冻结目标不可被 --serial 切换
- **WHEN** `--ready --serial <另一台>` 在冻结上下文中运行
- **THEN** 结果 MUST 是 `ok=false, code='frozen_target_mismatch'`，且 MUST 零设备操作（不 wake、不解锁、不探测）

> **Enforced by:** `harness/harness-runner.ts`,
> `harness/scripts/utils/device-readiness-gate.ts`,
> `harness/scripts/adhoc-device-test.ts`,
> `harness/scripts/device-policy.ts`,
> `profiles/hmos-app/harness/device-recovery-bridge.ts`,
> `harness/tests/unit/device-readiness-gate.unit.test.ts`,
> `harness/tests/unit/device-policy-cli.unit.test.ts`

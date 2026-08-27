## Why

2026-08-17 另一台 Windows 宿主用普通模式跑 UT，手机息屏锁定后 `aa test` 报 10106102，
harness 归因 `device_locked`，但**自动解锁链从未启动**——宿主 AI 转而自行研究 hdc/uinput，
最后错误宣称「HarmonyOS 不允许远程解锁」并要求用户人工解锁。只读调查在当前源码上确认
三个叠加缺陷：

1. **目标分裂**：解锁链的目标解析只认显式 serial 或 `HARNESS_HDC_TARGET`，**不读**
   `device.target_serial`；普通模式没有任何组件注入该 env（只有 goal 的就绪门经
   `deviceEnvFor` 注入），而 hdc 经 `hdcTargetPrefix` 在 env 未设时**隐式选择唯一在线
   设备**。于是 UT 能对设备装机执行，解锁链却「不知道对哪台动手」而整体跳过——即使凭据
   已登记且 `ready` 也不会被使用。
2. **`--check` 假阳性**：`configured = Boolean(unlock.mode || emulator_fallback)`，`code`
   完全不看凭据可用性。`unlock.mode=credential` 但凭据库里那条凭据 `absent`/`burned`/
   `unsupported`（或引用整段丢失）时照报 `code=ok`；`emulator_fallback=disabled` 也被算成
   「已配置」。gate 文档的判定表只分支 `code`，于是 agent 按契约「已配置」就不问用户。
   跨机迁移（整目录拷贝：`framework.local.json` 随目录走，Credential Manager 凭据是本机
   Windows 用户的本地状态、不跟着走）正好落进这个形态。
3. **普通模式无进程级门**：`device-policy --check` + 四选一只有 SKILL/gate 文档约束；
   goal 模式有 `agent_invoke_start` 前的硬门，普通模式结构上畅通。且
   `device-test-install` 的 `bm dump` 与 reuse 早退发生在既有 `ensureReadyBefore` 之前
   ——设备操作先于门。

另需澄清一条被宿主 AI 误传的事实：10106102 只证明 **OS 启动器**在 developer mode 下不做
启动时自动解锁；Maison 的解锁链走 `uitest uiInput click` 逐位点 PIN，2026-07-30 有真机
成功记录在案（`harness/tests/fixtures/device-lockscreen/acceptance/f4b2c8e6-live-gate-*`）。
「不允许远程解锁」是错误泛化，不作为需求输入。

## What Changes

- `device-policy --check` 的 `code` 反映**凭据真值**：`unlock.mode=credential` 且凭据不可用
  （无引用 / `absent` / `burned` / `unsupported`）且无**可用**降级档位时报
  `device_policy_unset`；可用降级档位收窄为 `existing|managed`（`disabled` 是「明确不降级」，
  不得掩盖坏凭据）。`in_flight` 视为「无需重新选择策略」而非「一定解得开」。
- 凭据库不可读（provider 故障/非 Windows）改走既有**执行失败**通道（非零退出 + stdout 无
  JSON），既不 `ok`（假阳性）也不 `unset`（会误导用户重新登记一条其实可能好着的凭据）。
- `configured` 与 `code` 解耦：`configured` 只表示「是否表达过策略意图」，**处置真源一律是
  `code`**；人读模式退出码从看 `configured` 改为看 `code`。
- 普通模式新增**入口级设备前置**（`harness-runner --phase ut|testing`，设备 capability
  dispatch 之前）：策略检查 + 目标解析 + 就绪，与 goal 侧**共用同一就绪核心**
  `ensureDeviceReady`。目标**只解析一次**并注入 `HARNESS_HDC_TARGET`，后续
  wake/解锁/`bm dump`/install/`aa test` 全链共用同一 serial。
- 冻结上下文的判据是**双字段**（goal 门成组注入 target/session/frozen）：frozen + target
  → 复用冻结目标；只有 frozen 没有 target → fail-closed（否则手工设一个环境变量即可绕过
  设备门并重获隐式设备路径）。
- 配置目标离线时**阻断或走已授权降级**，MUST NOT 跳过检查后让 hdc 隐式选择另一台设备。
- profile 侧 `device-recovery-bridge` 职责收缩为「运行中再次锁屏的恢复」，不再自建第三套
  目标解析、不读 config。

## Capabilities

### New Capabilities

无。普通模式入口前置复用既有 `ensureDeviceReady` 核心与既有 `device-policy --check`
契约，不新增 code 枚举值、不新增 diagnosis kind、不新增配置字段或状态机。

### Modified Capabilities

- `framework-local-config`：`device-policy --check` 的 `code` 语义、`configured` 与 `code`
  的解耦、可用降级档位口径、凭据库不可读的执行失败形态。
- `harness-gates`：普通模式需设备 phase 的入口级设备前置与「目标只解析一次、全链共用」
  契约；冻结上下文的双字段判据。

## Impact

- 代码：`harness/scripts/device-policy.ts`、`harness/scripts/utils/device-readiness-gate.ts`
  （新增普通模式入口适配层，与 goal 适配层并列，核心不动）、`harness/harness-runner.ts`、
  `profiles/hmos-app/harness/device-recovery-bridge.ts`。
- 文档：`skills/reference/device-policy-gate.md`（判定表、退出码契约、rebind 适用形态）、
  `skills/feature/business-ut/SKILL.md`、`skills/feature/device-testing/SKILL.md`、
  `skills/project/goal-mode/SKILL.md`、`skills/reference/confirmation-registry.yaml`。
- 行为收紧（属错误分类修复，不是兼容降级）：此前「坏凭据 / 只有 `disabled`」被报 `ok` 而
  静默继续，现在如实报 `device_policy_unset` 并要求四选一；普通模式需设备 phase 在策略
  不可用时于**任何设备操作之前**失败。
- 不改 canonical 路径与 schema，无消费者迁移，`MIGRATION.md` 无需更新。
- 真机复验欠账：`device-readiness-gate.ts` 变更已按既有纪律刷新验收 fixture 的
  `current_sha256` 并保留 `PENDING_REAL_DEVICE_REVERIFICATION`（`verified_sha256` 不改）。
- 弹窗式登记 UX（agent 拉起可见 TTY 窗口、用户在窗内输 PIN）**不做**（2026-08-17 用户
  裁定，不另立 change）：首次登记与烧毁后重登记继续走「用户在自己终端跑 `device:enroll`」
  这一条路，引用丢失类由 `device:rebind` 覆盖（本就不需要用户出场）。

## 1. Policy and credential truth

- [x] 1.1 `collectPolicyStatus` 的 `code` 改由「是否真有可用设备路径」派生：credential 不可用
  （无引用/非法引用/`absent`/`burned`/`unsupported`）且无可用降级 → `device_policy_unset`；
  可用降级收窄为 `existing|managed`；`in_flight` 归 ok 但 guidance 明示勿立即重登记。
- [x] 1.2 凭据库不可读改走既有执行失败通道（抛出 → main 捕获 → stderr + 非零退出 +
  stdout 无 JSON），并声明「不是未配置、不要据此重新登记」。
- [x] 1.3 `configured` 与 `code` 解耦；人读模式退出码改为以 `code` 为准。
- [x] 1.4 单测：各不可用形态 → unset；ready/in_flight → ok；`disabled` 单独/叠加坏凭据 →
  unset；已授权降级覆盖坏凭据 → ok；凭据库不可读 → 抛出；进程级 JSON 与人读退出码一致性。
  用例按「对旧判定 `Boolean(mode||fallback)` 必红」设计。
- [x] 1.5 收窄既有「输出不得含口令」断言口径：结构化字段查 pin/password/passcode 字段名与
  取值，口令内容全局查——旧口径把整个 JSON 一起查，会误伤 unset 态 guidance 里的指引正文。

## 2. Normal-mode entry device gate and target wiring

- [x] 2.1 在 `device-readiness-gate.ts` 增普通模式入口适配层 `runPhaseEntryDeviceGate`
  （与 goal 适配层 `runDeviceReadinessGate` 并列，共用 `ensureDeviceReady` 核心，核心不动）：
  双字段冻结判据 → 策略检查 → `buildDeviceReadinessInput`（env 目标优先于 config）→
  `ensureDeviceReady` → 经 `deviceEnvFor` 产出完整 env 片段。
- [x] 2.2 harness-runner 接线：`phaseRequiresDevice` 派生启用、排在 Step 2 之前、
  fail-fast 出口（guidance + 非零退出，零 checker/provider）、执行失败与 unset 分开报告、
  env 已设不覆盖、托管实例注册退出回收。
- [x] 2.3 `device-recovery-bridge` 收缩为只消费已注入目标（不读 config、不建第三套解析），
  并在头注写明「桥内再解析 = 解锁 A、hdc 操作 B」。
- [x] 2.4 单测：frozen+target 复用（零解析零策略查询）／只有 frozen fail-closed／unset
  fail-fast 且零就绪调用／执行失败抛出／env 优先于 config／完整 env 片段（含冻结标记与
  凭据引用）／BLOCKED 与 AMBIGUOUS 出口／config 离线阻断与 existing 降级／harness-runner
  接线与门位置（在 Step 2 之前）／bridge 不读 config。
- [x] 2.5 刷新真机验收 fixture 的 `current_sha256` 并如实登记本次改动
  （`verified_sha256` 不改，`PENDING_REAL_DEVICE_REVERIFICATION` 保持）。

## 2b. codex 二轮返修（四条阻断 + 一条文案）

- [x] 2b.1 【P0】冻结上下文**整组原子注入**：提出 `applyFrozenDeviceEnv`（生产函数，
  非源码正则），`MAISON_DEVICE_*` 应用后恰好等于 `deviceEnvFor` 产出、未返回的键删除；
  只有 `HARNESS_HDC_TARGET` 保留显式优先。修掉「manual 策略下用继承 ref 自动输 PIN」的
  越权路径，并删除锁死旧实现的源码断言。
- [x] 2b.2 删除 `HARNESS_SKIP_HVIGOR` 免除设备门的条件：UT 真机执行只受
  `HARNESS_SKIP_HVIGOR_TEST` 控制（ut-host-impl 的 device-run 分支），testing 完全不认这个
  编译 flag——用它让路等于门形同虚设。加反回归断言（该 flag 名不得再出现在 harness-runner）。
- [x] 2b.3 【P1】孤儿托管实例投影：入口门在 BLOCKED 时交出 `managed`/`orphanSerial`
  （与 goal 适配层同款），runner 把回收登记移到 `!gate.ok` 退出分支**之前**。
- [x] 2b.4 【P1】普通模式 testing 封顶：提出 `buildTestingTargetKindCap` 复用既有
  `capsTestingConclusion` + 门得出的 target kind，产出 `externalBlocked`/`device_blocked`
  的 BLOCKER FAIL 并入 checks 账；不落 `device-session.json`。
- [x] 2b.5 `in_flight` guidance 文案与凭据 SSOT 对齐：崩溃遗留的 claim 持久存在、不会自行
  恢复，确认无并发且持续时唯一出路是登记新版本（原文案只说「稍后重试」会让用户永久卡住）。
- [x] 2b.6 四条定向行为用例 + fixture `current_sha256` 二次刷新。

## 2c. codex 三轮返修（两条窄问题）

- [x] 2c.1 【P1】`applyFrozenDeviceEnv` 不再保留旧 `HARNESS_HDC_TARGET`：显式目标优先级在门的
  **输入阶段**已兑现，注入阶段一律以门的解析结果为准。原实现在「显式真机离线 → 已授权降级」
  路径上产出 `HARNESS_HDC_TARGET=离线真机` + `TARGET_KIND=emulator` 的**目标分裂**
  （已在真实代码上复现）；旧单测还把该错误行为锁死，已改。补端到端行为用例
  （门 notes 记录"显式目标不在线" → 最终 env = 模拟器 serial → 封顶指向同一目标）+ 空白 target 覆盖。
- [x] 2c.2 【P2】`in_flight` 出路三处文案统一（`collectPolicyStatus` guidance、`--rebind`
  错误出口、`device-policy-gate.md`）：不要立即重登记；确认无并发且状态持续存在时它不会自行
  恢复，须 `device:enroll` 登记新版本。rebind 测试同步加"持续存在 + device:enroll"断言
  （原测试只锁 `稍后重试`，与新 OpenSpec 要求矛盾）。

## 3. Docs, spec and acceptance

- [x] 3.1 `skills/reference/device-policy-gate.md`：退出码契约补凭据库不可读、判定表补
  「code 是唯一处置真源」与 ok 的三种成立方式、`disabled`/`in_flight` 两处易错、rebind 段
  扩展为「引用丢失/写坏/跨机凭据不在本机」三形态。
- [x] 3.2 其余承载处同步（business-ut / device-testing / goal-mode SKILL、
  confirmation-registry.yaml）：普通模式已有进程级门、`code` 为处置真源。
- [x] 3.3 OpenSpec change 与两个 spec delta（framework-local-config / harness-gates）。
- [x] 3.4 验收：`npm run openspec:validate`（38/38）+ `cd harness && npm test`
  （typecheck + unit 3282 + fixtures 44，全 0 failed）。

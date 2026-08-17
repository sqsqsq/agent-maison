---
name: 设备策略真值与解锁接线 — --check 真值 / 普通模式入口级设备前置与全链 target 接线
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0，不自行 bump；当前版本 pending todo 按机制自动进入发布门。
overview: >
  v3（同日 codex 二轮：三处窄契约补正——frozen 改双字段判据、单字段 fail-closed；
  就绪核心唯一化 buildDeviceReadinessInput→ensureDeviceReady，unset 出口改前脚本
  fail-fast 而非 readiness_signals；人读退出码以 code 为处置真源）。
  v2（2026-08-17 codex review 收口：暂不通过意见五条全部核实属实并采纳——
  ① 目标必须一次解析全链共用，不能只修 bridge；② 原 t2+t3 合并为 harness-runner
  入口级设备前置，不在 provider 加平行门、不新增 diagnosis kind；③ D1 凭据库不可读
  走既有"执行失败"通道，既不 ok 也不 unset；fallback 仅 existing|managed 算可用；
  in_flight 只是"无需重新选择策略"；④ B 轨弹窗登记从本 plan 删除另开 change；
  ⑤ 验收用 cd harness && npm test 全门禁，删除手工变异仪式）。
  ——
  源于 2026-08-17 另一台宿主（约 08-15 代码）普通模式 UT 锁屏事故：aa test 报 10106102，
  harness 归因 device_locked 但自动解锁链从未启动，宿主 AI 转而自行 hdc/uinput 研究并
  错误宣称"HarmonyOS 不允许远程解锁"。经只读调查（codex 六点逐项核实），现行 main 上
  三个缺陷叠加：
  C1【接线裂缝】解锁链目标解析只认显式 serial / HARNESS_HDC_TARGET
  （device-recovery-bridge.ts L67），不读 enroll 落盘的 device.target_serial；普通模式
  无人注入该 env（只有 goal 就绪门 deviceEnvFor 注入，device-readiness-gate.ts L639），
  而 hdc 经 hdcTargetPrefix（hdc-runner.ts L811-813）在 env 未设时隐式选唯一在线设备
  ——UT 能对设备执行，解锁链却"不知道对哪台动手"整体跳过，凭据 ready 也不用。
  C2【--check 假阳性】configured=Boolean(mode||fallback)（device-policy.ts L66），code
  不看凭据可用性（L74；ref 缺时连 inspect 都不做，L60）——mode=credential + 凭据库
  absent/burned/unsupported 照报 code=ok，gate 文档判定表只分支 code → "看似配置、
  实际无可用凭据、因此不问"。跨机整目录拷贝（framework.local.json 随目录走、CM 凭据
  不走）正好落此形态。fallback='disabled' 也被 Boolean 算成"已配置"。
  C4【文档级门】普通模式 --check+四选一仅 SKILL/gate 文档约束，无进程级门；且
  device-test-install 的 bm dump（L237）与 reuse 返回（L267）发生在既有前检（L353）
  **之前**——设备操作先于门。goal 模式有 agent_invoke_start 前硬门，普通模式不对齐。
  另：10106102 只证明 OS 启动器在 developer mode 不做启动时自动解锁；Maison 链真机
  成功 fixture 在案（f4b2c8e6-live-gate-2026-07-30 events.jsonl：device_unlock_attempt
  outcome=succeeded）。宿主 AI 的"不允许远程解锁"是错误泛化，不作为需求输入。
  全文行号为 2026-08-17 快照，实施时一律按锚文本重定位。
todos:
  - id: t1-policy-credential-truth
    content: >
      【P0·C2】collectPolicyStatus 凭据真值收口（harness/scripts/device-policy.ts）。
      判定：unset 当且仅当（无 mode 且无**可用** fallback）或（mode=credential 且凭据
      不可用 且无**可用** fallback）；**可用 fallback 仅 existing|managed**，disabled 不算、
      不得掩盖坏凭据。"凭据不可用" = 无 credential_ref，或 inspect ∈ { absent(无 error)、
      burned、unsupported }。ready → ok。in_flight → ok，但语义只是"**无需重新选择策略**"
      （可能是并发瞬态也可能是崩溃残留，不触发重登记，运行时未必能解锁）——guidance
      按 rebind 既有 in_flight 文案精神提示稍后重试、勿立即重登记。
      inspect 带 error（凭据库不可读/provider 故障）→ **策略检查本身执行失败**：非零
      退出 + stderr 报 provider 错误 + stdout 不输出 JSON——正好落在 gate 文档既有
      第 2 段契约（"非零或非法 JSON = 执行失败，必须停止并交回用户"），既不 ok（不再
      制造假阳性）也不 unset（不误导重登记），零新状态。--json 段"退出码一律 0"注释
      改为"0 仅覆盖正常态 ok/unset；provider 读失败属真实执行失败走非零"。
      不新增 code 枚举值、不新增 JSON 字段、不新增状态机；unset 的 guidance 复用现文案
      （已含 rebind/enroll 分支，L84-88），按不可用形态微调首行。
      **configured 与退出码**：configured 保留"是否表达过策略意图"语义不变（坏凭据下可
      configured=true + code=unset）；**处置真源一律是 code**——人读模式退出码由
      `status.configured ? 0 : 3`（L330-333）改为 `code === 'ok' ? 0 : 3`，gate 文档同步
      声明"gate 与人读退出均以 code 为准"。增加坏凭据形态下 JSON 与人读模式一致性
      测试（configured=true 且 code=unset → 人读 exit 3，--json 的 code 同值）。
      文档同步 device-policy-gate.md：判定表（L37-40）、退出码契约段（L29-35 补 provider
      失败示例）、L84-88"引用被抹→报 unset"扩展为对 ref 级/凭据态成立。
      测试（device-policy-cli.unit.test.ts，fixture 用真实 writer 造：updateLocalConfig
      落盘 + fake provider 造 CM 态）：ref 缺→unset；absent/burned/unsupported→unset；
      ready→ok；in_flight→ok 且 guidance 含勿重登记；absent+error→非零退出且 stdout
      无 JSON；mode=manual→ok；仅 fallback=existing|managed→ok；仅
      fallback=disabled→unset；credential 不可用+fallback=existing→ok。用例须设计为
      **对旧判定（Boolean(mode||fallback)）必红**，以此证明命中生产判定行——不设手工
      变异步骤。
    status: completed
  - id: t2-entry-device-gate-and-target-wiring
    content: >
      【P0·C1+C4 合并】普通模式入口级设备前置与全链 target 接线。位置：harness-runner
      --phase ut|testing（check:ut / check:testing 的实际入口），设备 capability dispatch
      之前；仅当 phase ∈ profile device_capabilities（hmos-app：ut/testing）时启用。
      契约（目标只解析一次，wake/解锁/bm dump/install/aa test 全链共用同一 serial）：
      ① 冻结判据是**双字段**（goal 门成功时 target/session/frozen 同时注入，
      deviceEnvFor，device-readiness-gate.ts L632-649）：frozen=1 且 HARNESS_HDC_TARGET
      存在 → 复用冻结目标，不重解析、不重查策略（attempt 冻结语义，device-readiness-deps
      L654-663 同款判据）；frozen=1 但 target 缺失 → 冻结上下文损坏，**fail-closed
      阻断**——绝不回落隐式设备路径，否则手工设一个 env 变量即可绕门。
      ② 策略检查：复用 t1 后的 collectPolicyStatus。unset → harness-runner **前脚本
      fail-fast**：输出 guidance 原文（四选一文案 SSOT 留在 device-policy.ts）、非零
      退出、**不调用任何 checker/provider**——不新增 diagnosis kind、不在 provider 加门、
      也不走 readiness_signals（那是报告生成后的"PASS 但值得单独提醒"通道，
      harness-runner L1811，不是硬阻断，不得用作出口）；provider 读失败（t1 的执行
      失败形态）同样 fail-fast 停止。
      ③ 目标解析+就绪：唯一路径 = **buildDeviceReadinessInput → ensureDeviceReady**
      （共享就绪核心，device-readiness-gate.ts L267-271 码注"gate 与运行期 wrapper
      必须同一实现"；目标解析、解锁、模拟器 fallback 都在其内）——**不用**
      probeDeviceReadiness（纯只读，不 wake 不解锁不启 fallback）、**不直接调**
      ensureDeviceReadyAtRuntime（它要求已有 serial，不负责选目标），不复制逻辑。
      解析语义：显式 env 优先；config target_serial 次之；
      单台在线兜底；多台且无 target_serial → 既有 AMBIGUOUS 语义阻断求人（"等人配
      target_serial，不是等环境自愈"，adjudication.ts L306）；**config 目标离线 → 阻断，
      或走已授权 emulator fallback（existing/managed）——绝不跳过检查后让 hdc 隐式
      选择另一台设备**。
      ④ 注入：解析结果写 process.env.HARNESS_HDC_TARGET（本进程=单 phase 生命周期，
      与 goal 门"不写全局 env"约束不冲突——那条约束防的是长驻 goal-runner 跨
      phase/run 串 target，此处进程即 phase；码注写明论证）。已设 env 时不覆盖。
      hdcTargetPrefix 使后续 bm dump/install/aa test 全链同源（testing-build-conventions
      L25 已成文）。
      ⑤ bridge 职责收缩：只保留"运行过程中再次锁屏"的恢复（recoverAfterLockFailure）；
      **不再自建第三套目标解析、不读 config**。providers 既有 ensureReadyBefore 调用点
      保持原样（入口注入后 env 自然可见，作为操作前兜底），device-test-install 的
      bm dump 先于前检问题由入口门覆盖，不在 provider 内重排。
      测试：frozen+target → 复用冻结目标，零重解析零重查策略；**只有 frozen、没有
      target → 必须 fail-closed 阻断**；env 已设不覆盖；unset → 前脚本 fail-fast（非零
      退出 + 零 checker/provider 调用 + 零设备命令）；provider 失败 → 同样 fail-fast；
      多台 AMBIGUOUS；config 离线 → 阻断（无 fallback）/ 走 fallback（existing）；单台
      兜底注入；注入后 provider 层 hdcTargetPrefix 取到同一 serial（全链一致性断言）；
      goal 链路回归（goal 门注入的完整 env 在 harness-runner 内不被二次处理）。
    status: completed
  - id: t3-docs-openspec-acceptance
    content: >
      文档、OpenSpec、目标测试与完整验收。OpenSpec change：
      device-policy-truth-and-serial-wiring（t1+t2 的 spec delta：--check code 语义与
      执行失败形态、入口级设备前置契约、目标一次解析全链共用）。实施第一步先定位
      --check 契约与设备门的现有 spec 承载处（openspec/specs 下 device/harness-gates
      域；346179a4 曾动 specs/framework-local-config），只写 delta 不开平行 spec 文件。
      同一契约的**全部承载处**枚举并逐一过（多文件必漏改教训）：
      skills/reference/device-policy-gate.md、skills/feature/business-ut/SKILL.md L11、
      skills/feature/device-testing/SKILL.md、skills/reference/confirmation-registry.yaml
      L123-134、skills/project/goal-mode/SKILL.md L40、docs/operations/goal-mode-runbook.md、
      skills/reference/goal-mode-operations.md（以实施时 grep 'device-policy' 全仓清单
      为准，本清单不算数）。
      验收（缺一不可）：目标单测全部落位；`npm run openspec:validate`；
      **`cd harness && npm test`**（typecheck + test:unit + test:fixtures 全绿，
      package.json L25 门禁口径）。偏差清单当场同步：实现偏离本 plan 任何一条须在
      完工汇报里逐条列出。
      宿主证据回灌（附录 A，不阻塞实施）：事故宿主 --check 六字段、UT 日志
      [device-ready/ut-install] note 原文、env 有无 HARNESS_HDC_TARGET、CM 有无
      MaisonDeviceUnlock 条目——回灌后在本 plan 补记"修复是否完整解释事故"终判。
    status: completed
---

# 背景与事故（2026-08-17）

另一台 Windows 宿主（约 08-15 框架代码）普通模式跑 UT，手机息屏锁定，`aa test` 报
10106102（"developer mode 下屏幕无法自动解锁"），harness 归因 `device_locked`。自动解锁
链从未启动；宿主 AI 未见 `--check` 痕迹，转而自行研究 hdc/uinput 三分钟，错误宣称
"HarmonyOS 不允许远程解锁"，并把 AGENTS.md 里明文存放的 PIN 念进对话（宿主侧违规，
框架无法根治，已在对话中向用户指出）。

# 根因分层（只读调查结论，v1 定稿 + v2 补充）

**已确认（代码级，现行 main）**：C1 serial 接线裂缝（最重）、C2 --check 假阳性（含
fallback='disabled' 被算作已配置）、C4 普通模式无进程级门（含 device-test-install 的
bm dump/reuse 先于既有前检）。三者叠加：即使凭据登记且 ready，普通 UT 也不会自动解锁，
且没有任何环节提示用户去配置/修复。

**已证伪（不作为需求）**："HarmonyOS 不允许远程解锁"——框架走 `uitest uiInput click`
逐位点 PIN，2026-07-30 真机成功 fixture 在案；10106102 是 OS 启动器自身的限制。

**尚缺宿主证据（附录 A 回灌）**：本次 `--check` 实际返回什么（假阳性 ok？还是压根没
跑？）、该机 CM 里是否真有凭据。两问不影响 C1/C2/C4 的成立，只影响事故叙事完整度。

# v2 review 裁决记录（codex 五条，全部核实属实并采纳）

- **R1 目标分裂**：只修 bridge 会造成"解锁 A、hdc 操作 B"；"config 离线就跳过继续 UT"
  不能保留 → t2 契约改为一次解析全链共用、离线阻断或走已授权 fallback。
- **R2 平行门**：provider 局部门 + 新 diagnosis kind = 机制膨胀（device-test-install
  L356 现有做法即"复用既有诊断形状"的反证）→ 原 t2+t3 合并为入口级前置，bridge 只留
  运行中恢复。
- **R3 D1**：凭据库不可读 → 既不 ok 也不 unset，走 CLI 既有"执行失败"契约（非零退出/
  非法 JSON = 停止）；fallback 仅 existing|managed；in_flight 措辞收敛。
- **R4 B 轨**：从本 plan 删除（3.0.0 pending todo 会挡发布门）→ 其后 2026-08-17 用户
  裁定**整体不做**，见"已裁定不做：弹窗式登记"。
- **R5 验收**：`cd harness && npm test` 全门禁；删除手工变异仪式，用例设计为"旧行为
  必红"即可证明接线。

# v3 二轮补正记录（三处窄契约，均核实属实并采纳）

- **R6 frozen 双字段判据**：goal 门成功时 target/session/frozen 同时注入
  （deviceEnvFor，device-readiness-gate.ts L632-649）——v2 的"frozen 单字段整体跳过"
  会让手工设 env 重开隐式设备路径；改为 frozen+target 复用冻结目标、只有 frozen 没有
  target 则 fail-closed，并补对应阻断测试。
- **R7 唯一就绪核心与失败出口**：v2 并列的三个函数语义不同（probeDeviceReadiness=
  纯只读 / ensureDeviceReadyAtRuntime=已有 serial 处理锁屏 / ensureDeviceReady=目标
  解析+解锁+fallback 共享核心）——入口只走 buildDeviceReadinessInput→ensureDeviceReady；
  "check/readiness-signal 失败通道"措辞错误（readiness_signals 是报告级提示通道，
  harness-runner L1811，非硬阻断），unset 出口改为前脚本 fail-fast（guidance+非零退出+
  不调 checker/provider）。
- **R8 configured 与退出码**：code 与 configured 解耦后，人读模式 L330-333
  `configured ? 0 : 3` 会在坏凭据下 exit 0——configured 保留"表达过意图"语义，处置
  真源一律 code，人读退出改 `code === 'ok' ? 0 : 3`，补 JSON/人读一致性测试。
- 非阻断：版本注释"是否挂发布门由用户裁定"已删（当前版本 pending todo 按机制自动
  进入发布门）。

# 明确不做

- 不新增平行 CheckResult/状态文件/新状态机/新 diagnosis kind；不动烧毁、互斥、单凭据
  无候选集语义。
- 不改 goal 模式就绪门与 deviceEnvFor 注入（已正确）；入口前置对 frozen attempt 整体
  让路。
- 不做 orphan 凭据自动检测、不枚举版本（rebind 语义原样）。
- 不碰解锁运行时话术八出口（c9f4e7a2 已收口）。
- provider 内部不重排 bm dump 顺序（入口门覆盖后属冗余优化，不做）。

# 已裁定不做：弹窗式登记（原 B 轨）

**2026-08-17 用户裁定：去掉，不需要了。** 不另开 plan/change，也不列为 Deferral——
首次登记与烧毁后重登记继续走既有"用户在自己终端跑 `device:enroll`"这一条路（引用丢失
类由 `rebind` 覆盖，本来就不需要用户出场）。留此行防重新提案。

# 安全红线核对（不放宽）

PIN 不进 chat/argv/env/pipe（enroll TTY 红线原样）；不猜测/枚举口令；不跨 serial 使用
凭据（unlock-helper L146-148 既有绑定校验，t2 复用而非重造）；失败锁存/burn 规则不
回退；agent 对话确认不构成授权（capability-preflight 语义原样）。

# codex 二轮返修记录（四条阻断全部核实属实，已修）

- **P0 冻结环境非原子注入**（属实，越权路径）：原实现逐键「不存在才写」，继承来的陈旧
  `MAISON_DEVICE_CREDENTIAL_REF` 不会被清除，而 `resolveAttemptCredentialRef` 优先取它
  → **manual 策略下也会自动输入 PIN**。且我原先的源码正则断言反把错误实现锁死。
  修法=提出生产函数 `applyFrozenDeviceEnv`（整组原子：未返回的 `MAISON_DEVICE_*` 一律删除，
  仅 `HARNESS_HDC_TARGET` 保留显式优先），断言改为行为用例。
- **P1 `HARNESS_SKIP_HVIGOR` 不能证明不碰设备**（属实）：UT 的真机执行只受
  `HARNESS_SKIP_HVIGOR_TEST` 控制（ut-host-impl device-run 分支 L727），编译跳过后 L804
  的 `dispatchUtRun` 照样装机跑机；testing 更完全不认这个编译 flag。修法=**整条跳过条件
  删除**，并加反回归断言（该 flag 名不得再出现在 harness-runner）。
  ——原偏差 1「新增跳过条件」由此**作废**。
- **P1 托管实例启动失败/超时泄漏**（属实，且不是我承认的 SIGKILL 边界）：入口门在 BLOCKED
  时丢掉核心的 `orphanManaged/orphanSerial`，runner 又在回收登记之前就 `process.exit(1)`。
  修法=按 goal 适配层同款投影交出孤儿身份，回收登记前移到任何退出分支之前。
- **P1 普通模式 testing 可在模拟器上整体 PASS**（属实，违背既有封顶规格）：
  `capsTestingConclusion` 只在 goal-runner 被消费；新门主动走 fallback 后暴露面被放大。
  修法=提出 `buildTestingTargetKindCap` 复用同一判据 + 门得出的 target kind，产出
  `externalBlocked`/`device_blocked` 的 BLOCKER FAIL 并入 checks 账，不落 session 文件。
- 附带文案：`in_flight` guidance 与凭据 SSOT 对齐（崩溃遗留 claim 持久、不会自愈，确认无
  并发且持续时唯一出路是 `device:enroll` 新版本），原文案只说「稍后重试」会让用户永久卡住。

**行为收紧提醒（宿主须知）**：普通模式 testing 现在会在 `target_kind ∈ {emulator, unknown}`
时封顶失败。真机若未完成 physical attestation 校准即为 `unknown`——按 harness-gates 规格与
模拟器同等封顶。这正是规格要防的假绿，但会让此前「未校准也 exit 0」的宿主链路开始失败，
处置=接入真机并校准 attestation（校准仍是 a7f2e5d1 的悬置项，须真机）。

# codex 三轮返修记录（两条窄问题，均核实属实）

- **P1 授权降级后保留旧 `HARNESS_HDC_TARGET` → target 分裂**（属实，我已在真实代码上跑出
  复现：`HARNESS_HDC_TARGET=phone-offline` 与 `MAISON_DEVICE_TARGET_KIND=emulator` 并存）。
  这等于把本 change 要消灭的形态又造了回来：hdc 操作离线真机，而门与 testing 封顶都以为
  目标是模拟器。且我上一版单测把这个错误行为锁死了（断言"显式指定的目标不被覆盖"）。
  修法=`applyFrozenDeviceEnv` 注入阶段**一律以门的解析结果为准**——显式目标的优先级在门的
  **输入阶段**（envTarget → configuredSerial）已经兑现，未降级时写回的本就是同一值。
  补端到端行为用例：门 notes 记录"显式目标不在线" → 最终 env = 模拟器 serial → 封顶指向
  同一目标；另覆盖空白 target。
- **P2 `in_flight` 出路只同步了一半**（属实）：`collectPolicyStatus` 已改，但 `--rebind`
  的错误出口与 `device-policy-gate.md` 仍只写"稍后重试"，且 rebind 测试锁死旧文案——与新
  OpenSpec 要求直接矛盾，会让用户永久等待。三处文案已统一，测试同步加"持续存在 +
  device:enroll"断言。

# 实施偏差清单（2026-08-17 完工，逐条如实登记）

1. ~~`HARNESS_SKIP_HVIGOR=1` 跳过入口门~~ ——**已作废并删除**（codex 二轮 P1 证伪：该 flag
   只跳编译，装机/跑机照旧；testing 更不认它）。
2. **托管模拟器回收在普通模式不落 device-session.json**：身份留内存 + `registerManagedDeviceCleanup`
   退出回收（登记点在任何退出分支之前）。理由=单文件 session + 跨 run 对账是 goal 的模型
   （`collectForeignManagedSessions` 只扫 goal-runs 根），普通模式没有 run 目录也没有对账方，
   写了无人消费。
   **诚实边界**：普通模式下进程被硬杀（SIGKILL/断电）留下的孤儿实例没有兜底对账，需用户
   手动关闭；goal 模式才有下次启动对账那张网。（「启动了但没就绪」这条**可执行清理**路径
   已由 P1 返修覆盖，不属该边界。）
3. **入口门额外注入 `MAISON_DEVICE_ATTEMPT_FROZEN` 与 `MAISON_DEVICE_CREDENTIAL_REF`**
   （经 deviceEnvFor 整片段注入，非手拼子集）。plan 只写了注入 `HARNESS_HDC_TARGET`。
   理由=复用既有 env 形状单一真源（手拼片段曾漏 settle 字段致真机恒零等待，见 bridge 头注），
   且冻结标记顺带阻止运行期回落读实时配置提权。
4. **收窄了一条既有测试断言的口径**（device-policy-cli「输出不得含口令」）：原断言对整个
   JSON 查 `pin|password|passcode`，会误伤 unset 态 guidance 正文里的指引措辞（"绝不要让
   用户把口令发到对话里"/"无需重输 PIN"）。改为结构化字段查字段名与取值 + 口令内容全局查，
   保护意图未减（值检查覆盖面反而更明确）。
5. **真机验收 fixture 刷新**：`device-readiness-gate.ts` 的 `current_sha256` 刷新为
   `58887db5…`，`verified_sha256` 未改，`PENDING_REAL_DEVICE_REVERIFICATION` 保持，
   `by` 字段登记本次改动。t2 未改解锁/降级核心逻辑，只在同文件新增普通模式适配层。

# 验收记录（2026-08-17，含 codex 二轮返修后复跑）

- `npm run openspec:validate`：38 passed / 0 failed（含新 change）。
- `cd harness && npm test`（三轮返修后复跑）：typecheck 通过；unit **3286 passed / 0 failed**；
  fixtures **44 passed / 0 failed**。`git diff --check` 干净。
- 真机验收 fixture 的 `current_sha256` 共刷三次（每轮改动 gate 文件一次），末值
  `60365ea1…`；`verified_sha256` 与 PENDING 标记全程未动。
- 新增/改动测试落点：`device-policy-cli.unit.test.ts`（t1 六条新用例 + in_flight 出路断言 +
  一条口径收窄）、`device-readiness-gate.unit.test.ts`（t2 九条 + 返修三条定向行为用例：
  整组原子注入 / orphan 交出 / testing 封顶四态）。
- 两处原为源码正则的判定已提成**生产函数**并改为行为测试（`applyFrozenDeviceEnv`、
  `buildTestingTargetKindCap`）——源码正则不算接线验证，且上一版正则反把错误实现锁死。
- t1 用例按「对旧判定 `Boolean(mode||fallback)` 必红」设计，无手工变异步骤。

# 附录 A · 宿主证据回灌清单（事故机上执行，只读，不输入/输出 PIN）

1. `cd framework/harness && npx ts-node scripts/device-policy.ts --check --json` →
   记录 code / unlock_mode / credential_state / target_serial / credential_ref 有无 /
   emulator_fallback。
2. 事故 UT 日志中 `[device-ready/ut-install]` 行 note 原文（裁决 C1 vs 凭据态）。
3. 当时 shell 是否设置 HARNESS_HDC_TARGET。
4. Windows 凭据管理器有无 `MaisonDeviceUnlock:<serial>:v<N>`（含 #burned 与否）。
5. 回灌后在本 plan 补记终判；若与 C1/C2 预测不符，先改归因再动刀。

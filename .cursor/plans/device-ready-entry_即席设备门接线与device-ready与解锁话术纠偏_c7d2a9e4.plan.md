---
name: 设备就绪正道 — 即席入口接设备门、独立 device:ready 与解锁话术纠偏
overview: >
  宿主反馈（2026-09-07）：用户要 agent「解锁手机，做一些事情」，agent 反复回答不能做；显式选 /device-testing
  仍拒绝；直到用户在自己终端登记 PIN 并逐步指挥，agent 才动手，且是自写脚本直调 ensureUnlocked。
  经源码核实（Claude 探索 + codex 只读复现）根因三条：① 即席 CLI（adhoc-device-test）从未接入设备入口门，
  HARNESS_HDC_TARGET 无人注入，而恢复桥自 b3f7d9a2 起只消费已注入目标 → 凭据登记了也永不触发自动解锁；
  ② 「解锁设备」没有独立于 feature / bundle 的入口，全仓无任何 device:unlock / --ready 类命令；
  ③ 文档对解锁只写禁令（不碰 PIN、不徒手处置锁屏、四选一/停止），没有一句「用户要求解锁且凭据可用时，
  agent 应主动调框架解锁并继续」，且 SKILL 把 feature/receipt/acceptance 前置摆在模式分流之前。
  修法全部复用 runPhaseEntryDeviceGate / ensureDeviceReady / ensureDeviceReadyAtRuntime：抽一个共享 helper
  接入即席三个碰设备分支；device-policy CLI 增 --ready 子命令（npm run device:ready，JSON 契约与 --check 同款：
  判定完成一律退出 0、看 code；冻结上下文沿用原目标复用运行期恢复）；SKILL 先分流再进流程；把「手写解锁脚本」
  列入禁止清单。不新造解锁逻辑、不动 PIN 只在 TTY 登记的红线、不让恢复桥重新读 config、不新增会话保持。
version: 3.0.0
todos:
  - id: dre-plan-review
    content: 施工图待用户评审。codex 只读 review 两轮（第 1 轮五项返修 + 四项裁剪，第 2 轮一项 P1 收紧）已全部落盘（§8），codex 结论"修正后即可收口进入实施"；实施/审查分工由用户裁定。
    status: completed
  - id: dre-helper
    content: 按 D1 在 device-readiness-gate.ts 抽 applyPhaseEntryDeviceGate（起门 → 打 notes → 托管回收登记 → 原子注入 env），harness-runner 改调它，行为零变化；决策对象补可选 code（unset/ambiguous/blocked）。
    status: completed
  - id: dre-adhoc-wiring
    content: 按 D1 把 adhoc-device-test 的 dump-ui-only / 执行 / observe-ui 三个碰设备分支接入 helper；deviceSn 改为门后读取；失败写 device_not_ready placeholder；derive-only 不起门。
    status: completed
  - id: dre-device-ready-cli
    content: 按 D2 给 device-policy.ts 加 --ready [--serial] [--json]：非冻结走 helper；冻结沿用原目标 + resolveAttemptCredentialRef 复用 ensureDeviceReadyAtRuntime，只有 recovered=true 判成功（unknown 归 blocked、写"无法确认锁屏状态"），异 serial 拒绝且零设备操作；JSON 判定完成退出 0 看 code，执行失败非零无 JSON；结果带 serial/target_kind/reused_frozen。
    status: completed
  - id: dre-docs
    content: 按 D4：SKILL 新增「请求分流」节置顶并把 feature/receipt/acceptance 前置限定到正式模式；device-policy-gate 新增正道节（两段契约 + 三种 code 处置 + 模拟器就绪≠手机解锁 + 只解锁走 --ready、要操作应用直接即席 CLI）；workflow-detail 4.B；registry notes；goal-mode-operations 表；framework-agent-execution §1 禁令 + §2 映射行；三个 command 模板；hylyre-host-preflight env 表。
    status: completed
  - id: dre-spec-migration
    content: 按 D6 新增 openspec change adhoc-device-entry-gate（harness-gates 一条 MODIFIED requirement）+ MIGRATION 3.0.x 一节（即席行为变化、新命令、删除自写解锁脚本提示）。
    status: completed
  - id: dre-local-acceptance
    content: V1–V6 目标测试全绿；收尾一次 `cd harness && npm test`（含 typecheck/unit/fixtures）+ LF 扫描；宿主复验由用户触发（§7）。
    status: completed
---

# 施工图

原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)（效率优先、简单优先）。本 plan 独立于六阶段重构总计划 [9c6e2a41](pipeline_master_9c6e2a41.plan.md)，不占其批次；修的是宿主日常使用的设备入口，不是 goal 流水线。

**血缘**：解锁能力来自 [a7f2e5d1](设备就绪与阶段完成判定_解锁授权与模拟器托管_a7f2e5d1.plan.md)（goal 就绪门 + 凭据托管），普通模式入口门来自 c0df72bc（plan b3f7d9a2）。两者的覆盖面都是 **phase**（goal 与 `harness-runner --phase`）；即席 CLI 从头到尾不在任何一份 plan 的接线清单里（a7f2e5d1 全文无「即席 / adhoc」），这就是缺口的来历，不是回归。

**证据门槛**：每条 D 以「具体代码分支 + 可复现输入」为前提。宿主当时的对话与日志未取得，agent 每次拒绝的直接措辞无法逐句归因；但下述缺口在源码上全部成立，且 codex 已用不接触设备的调用复现 F02 分支与冻结放行分支（§8）。

## 1. 问题边界

| 编号 | 已确认事实 | 证据 |
|---|---|---|
| F01 | 即席 CLI 从未接入设备入口门。设备目标只有一行读 env，没人注入；全文零处引用 unlock / readiness / device-policy | [adhoc-device-test.ts:192](../../harness/scripts/adhoc-device-test.ts:192) `const deviceSn = process.env.HARNESS_HDC_TARGET`；`grep -n -i "unlock\|readiness\|device-policy"` 为空 |
| F02 | 恢复桥自 c0df72bc（plan b3f7d9a2，08-17）起**只消费已注入目标、绝不读 config**。env 未设即返回 `{"ready":true,"authorized":false,"blocked":false,"note":"未显式指定目标，跳过就绪检查（不对未知设备动手）"}`；后置恢复同样「不对未知目标做恢复」 | [device-recovery-bridge.ts:78](../../profiles/hmos-app/harness/device-recovery-bridge.ts:78)、:127；codex 无设备复现 |
| F03 | 注入 `HARNESS_HDC_TARGET` 的只有两处：goal 就绪门 `deviceEnvFor` 与普通模式 `harness-runner --phase ut|testing` 的 `runPhaseEntryDeviceGate`。全仓没有独立的解锁 / 就绪入口 | [harness-runner.ts:881](../../harness/harness-runner.ts:881)；`grep "device:unlock\|--unlock\|ensure-device-ready"` 为空 |
| F04 | 即席执行链的真实行为：凭据登记好 → hylyre run → `aa start` 报 screen is locked → 桥说未指定目标 → 归 `device_locked`。凭据白登记 | [device-test-run.ts:1735-1755](../../profiles/hmos-app/harness/providers/device-test-run.ts:1735)；`--dump-ui-only` 直接 `session start` + `dump-ui`，同样无门 [adhoc-dump-ui.ts:38](../../harness/scripts/utils/adhoc-dump-ui.ts:38) |
| F05 | 文档对解锁只有禁令与事故叙事，唯一正向句是「登记 credential 且 ready 时，**重跑设备阶段**由框架自动解锁」——解锁只是 phase 副作用，不是可点名的动作。07-28 枚举 PIN 事故在五处以上重述 | [device-policy-gate.md](../../skills/reference/device-policy-gate.md)（"不得绕开框架徒手处置锁屏"、"agent 不得代跑"）、[SKILL.md](../../skills/feature/device-testing/SKILL.md) 前置（"绝不进对话"）、[workflow-detail 4.B](../../skills/reference/device-testing-workflow-detail.md)（"勿手工拼 hdc/hylyre"）、[goal-mode-operations.md:185](../../skills/reference/goal-mode-operations.md:185) |
| F06 | 入口形态与顺序：三个 adapter 的 `/device-testing` 模板 `argument-hint: <feature-name>`；SKILL 在模式分流之前就要求 framework-init / personal-setup / Feature 归档定位 / Resume Gate / 输入矩阵（[SKILL.md:11](../../skills/feature/device-testing/SKILL.md:11)），「输入」表又无条件要求 acceptance.yaml（[:55](../../skills/feature/device-testing/SKILL.md:55)）；即席轨要求 `com.xxx.yyy` bundle 且「bundle 必须用户声明」。「解锁手机」既不是 feature 也不带 bundle，两轨都不匹配；显式选命令只是加载同一套禁令与前置 | 模板：[claude](../../agents/claude/templates/commands/device-testing.md) / [cursor](../../agents/cursor/templates/commands/device-testing.md)；[workflow-detail:52](../../skills/reference/device-testing-workflow-detail.md:52) |
| F07 | 用户贴的脚本能工作，是因为它显式给了 serial 与 credentialRef、直调现有 `ensureUnlocked`，绕开了缺失的入口接线。**能确认的**：直调内部 helper、跳过 `collectPolicyStatus` 策略入口、硬编码凭据版本 `v1`；PIN 仍由凭据库处理，没有新解锁算法、没有泄漏。**不能据此断言的**：相对导入 `./scripts/utils/…` 不足以证明它实际落在 `framework/harness/`（若确在其中，则违反 [consumer-framework-boundary](../../skills/reference/consumer-framework-boundary.md)）；显式指定 serial 本身也不等于绕过多设备歧义保护。结论不变：这是宿主 agent 临时补接线，不该成为消费者维护的脚本 | 用户贴文 |
| F08 | 新宿主上 `device-policy --check` 必为 `device_policy_unset` → 四选一 → 选②须用户本人在 TTY 登记。这段设计正确，解释了「直到完成密码登记」之前的停顿；本 plan 保留 | [device-policy.ts](../../harness/scripts/device-policy.ts) `enroll` 非 TTY 拒绝 |
| F09 | `runPhaseEntryDeviceGate` 在冻结上下文（`MAISON_DEVICE_ATTEMPT_FROZEN=1` + `HARNESS_HDC_TARGET`）直接 `ok=true, reusedFrozen=true`，不探测、不解锁、不返回 target。这是 phase 入口的**正确**放行（goal 门已就绪，phase 内不重解析），但不能充当「设备此刻已就绪」的判定 | [device-readiness-gate.ts:731-745](../../harness/scripts/utils/device-readiness-gate.ts:731)；codex 无设备复现 |
| F10 | `--check --json` 对 `ok` 与 `device_policy_unset` **都退出 0**，非零仅表示执行失败（配置损坏 / 凭据库不可读），文档明文要求非零时停止、不得当成未配置引导登记 | [device-policy.ts main](../../harness/scripts/device-policy.ts)、[device-policy-gate.md](../../skills/reference/device-policy-gate.md) 退出码契约 |

## 2. 非目标

- 不改 PIN 登记方式：仍只允许用户在真实 TTY 登记，agent 不代跑、PIN 不进对话（D5-1）。
- 不让恢复桥重新读 config 解析目标（D5-2）。
- 不给即席 CLI 加交互式四选一：CLI 不弹交互，`device_policy_unset` 时 fail-fast 透传 `guidance`，与 harness-runner 同款（D5-3）。
- 不新增 `phaseRequiresDevice('adhoc')` 映射、不把即席变成 phase（D5-4）。
- 不做「无 bundle 跑步骤」与「无 bundle 观察当前屏」（D5-6）。
- 不改 phase 入口的冻结放行行为、不新增恢复状态机、不新增第二套目标解析（D2）。
- 不新增会话保持、跨命令 env 传递或常亮机制（D2）。
- 不改 Stop hook、不改 goal 就绪门、不改 `ensureUnlocked` / `ensureDeviceReady` / `collectPolicyStatus` 任何判定。
- 不把用户的自写脚本收编为发布件。

## 3. 决策纪要

### D0：保留的真源与状态

`ensureDeviceReady`（就绪核心）、`runPhaseEntryDeviceGate`（普通模式入口门，含冻结放行）、`ensureDeviceReadyAtRuntime`（运行期恢复）、`collectPolicyStatus`（策略真源）、`device-recovery-bridge`（只消费已注入目标）、`deviceEnvFor` / `applyFrozenDeviceEnv`（env 形状与原子注入）、`resolveAttemptCredentialRef`（冻结优先的凭据引用）全部不动判定。本 plan 只做**接线**、**一个薄 CLI 子命令**与**话术**。

### D1：抽共享 helper，即席三个碰设备分支接入入口门（唯一的生产逻辑改动）

**helper**：在 [device-readiness-gate.ts](../../harness/scripts/utils/device-readiness-gate.ts) `applyFrozenDeviceEnv` 旁新增

```ts
export async function applyPhaseEntryDeviceGate(opts: {
  projectRoot: string; phase: string; startedBy: string; log?: (line: string) => void;
}): Promise<PhaseEntryDeviceGateDecision>
```

行为逐条对应 harness-runner 现有代码块（[:878-935](../../harness/harness-runner.ts:878)），**搬运不改语义**：① `runPhaseEntryDeviceGate` 抛出原样上抛（调用方按"执行失败"停止）；② 逐条打 `notes`；③ `gate.managed` 存在时**在任何返回之前** `registerManagedDeviceCleanup(reclaimManagedDevice(...))`，`started_by_run` 用 `startedBy`；④ `gate.ok && gate.env` → `applyFrozenDeviceEnv(process.env, gate.env)` 并打"设备目标已解析并注入"；⑤ 返回 decision，调用方自行决定 `process.exit(1)` / 写 placeholder。冻结放行分支（F09）原样保留。harness-runner 改为调 helper，其后的 `buildTestingTargetKindCap` 与 `deviceConclusionCap` 不动。

**决策对象补一个可选字段**：`PhaseEntryDeviceGateDecision.code?: 'device_policy_unset' | 'ambiguous' | 'blocked'`，在门现有的三个 `ok:false` 返回点各填一个（策略 unset 处、`res.state==='AMBIGUOUS'`、其余 BLOCKED；冻结损坏分支不填）。纯附加，harness-runner 不读；D2 的 JSON 靠它区分未配置与设备阻断，避免解析 `reason` 文案或再跑一次 `collectPolicyStatus`。

**即席接线**（[adhoc-device-test.ts](../../harness/scripts/adhoc-device-test.ts)）：

| 分支 | 门的位置 | 理由 |
|---|---|---|
| `--dump-ui-only` | `ensureHylyreReady` 之后、`runAdhocDumpUi` 之前 | ensure 可能 pip 半分钟，不碰设备；先 ensure 再门，避免门刚解锁又息屏 |
| 执行（`--plan` / `--steps-file`）与 `--observe-ui` | 现有 `logAdhocPhase('ensure')` → `ensureHylyreReady` 之后、`resolveMainAbilityForBundle`（首个 `bm dump`）之前 | 同上；`resolveMainAbilityForBundle` 是执行链第一个设备操作 |
| derive-only（仅 `--steps`）、用法错误分支 | **不起门** | 不碰设备 |

细则：`phase` 传 `'testing'`（门内只用于 sessionId 标签与 guidance），`startedBy` 传 `adhoc-<pid>`；顶层 `const deviceSn = process.env.HARNESS_HDC_TARGET` 删除，改为门之后读取；新增 `ADHOC_PHASE=device_gate` 锚点；`!gate.ok` → stderr 原文 `reason`（含 `device_policy_unset` 的四选一 guidance 原文），执行/observe 模式写 placeholder `error_kind: 'device_not_ready'`（[AdhocErrorKind](../../harness/scripts/utils/adhoc-trace-placeholder.ts:8) 新增成员），exit 1；helper 抛出 → stderr「设备策略检查执行失败：…」exit 1，与 harness-runner 文案同款。门失败后**不执行任何设备操作**。

**为什么在 CLI 而不是在桥或 hylyre provider 里接**：桥不解析目标是 b3f7d9a2 的裁决（防"解锁 A、hdc 操作 B"）；provider 被多入口加载，门要求"任何设备操作之前一次解析"，只能在进程入口做。与 harness-gates 既有 requirement「Normal-mode device phases resolve one target at entry」同一原理。

### D2：独立设备就绪入口 `npm run device:ready`

在 [device-policy.ts](../../harness/scripts/device-policy.ts) 加子命令 `--ready [--serial <sn>] [--json] [--project-root <p>]`，npm script `"device:ready": "ts-node scripts/device-policy.ts --ready"`。放这里而不新开文件：它已是"设备 CLI"（check / enroll / set / rebind），四选一文案单一真源也在这里。

**两条路径，按冻结上下文分派，都复用既有函数、不建第三套解析**：

| 上下文 | 判据 | 做什么 |
|---|---|---|
| 非冻结（普通宿主终端、agent 在非 goal 会话里调用） | `MAISON_DEVICE_ATTEMPT_FROZEN` 未设 | `--serial` 有值 → 先写 `process.env.HARNESS_HDC_TARGET`（复用门"env > target_serial > 唯一在线"既有优先级）；调 D1 helper（`phase='device-ready'`，`startedBy='device-ready-<pid>'`）。策略 unset / AMBIGUOUS / BLOCKED 由门原样给出 |
| 冻结（goal 注入的 agent 子进程、phase 内调用；F09） | `MAISON_DEVICE_ATTEMPT_FROZEN=1` | **不调门**（门在此只会放行，不能回答"此刻就绪吗"）。读 `HARNESS_HDC_TARGET` 为原目标，缺失 → 与门同款"冻结上下文损坏"拒绝；`--serial` 给了且 ≠ 原目标 → `ok:false, code:'frozen_target_mismatch'`，**零设备操作**（冻结目标不可切换）；否则 `ensureDeviceReadyAtRuntime({ serial: 原目标, credentialRef: resolveAttemptCredentialRef(projectRoot), deps: buildUnlockDeps() })`——沿用原凭据授权（冻结且无 ref = 未授权，绝不回落读 config）。**只有 `recovered=true` 判成功**；其余一律 `ok:false, code:'blocked'`、`note` 原文透传：`unauthorized` / `unlock_failed` 是确实锁着没解开；`reason==='unknown'`（唤醒后仍判不出锁屏状态）同样 `ok:false, code:'blocked'`，`reason` 写"无法确认锁屏状态"——**不宣称设备确定锁住**，也不放行。桥在 unknown 时"不阻断后续操作、让实际操作去验证"的语义只属于有后续操作的调用方；独立 `--ready` 没有后续操作来验证，不能借用那条放行解释。桥本身不改。`target_kind` 读冻结的 `MAISON_DEVICE_TARGET_KIND` |

**输出与退出码——与 `--check` 同一份两段契约（F10）**：

- `--json`：stdout 只有 JSON `{ ok, code, serial, target_kind, reused_frozen, notes[], reason? }`；`code ∈ 'ready' | 'device_policy_unset' | 'ambiguous' | 'blocked' | 'frozen_target_mismatch'`；`serial`/`target_kind` 取实际目标（非冻结取 `gate.target`，冻结取 env），未解析出目标为 null。**判定完成一律退出 0**（含未配置与设备阻断——它们是正常且可预期的结果，agent 看 `code`）；**只有执行失败**（helper / 恢复抛出：凭据库不可读、配置损坏）退出非零且 stdout 无 JSON，stderr 说明"不是未配置、不要据此重新登记"。
- 人读模式：打 notes + 结论；`ok` → 0，`!ok` → 3，执行失败 → 1（与 `--check` 人读模式同款）。

**结果语义（agent 话术据此而定，D4）**：`ok=true` 只表示**本次调用**确认了 `serial` 这台目标可用。`target_kind='physical'` 才能对用户说"手机已解锁"；`target_kind='emulator'`（真机不可用后走了已授权降级）要说"手机未就绪，已授权的模拟器路径可用"；`target_kind='unknown'` 如实说"目标可用但未完成真机 attestation"。CLI 写 `process.env` 只影响本进程，**不承诺跨命令继承目标**：后续即席 / 正式入口各自起门重解析。托管模拟器随本进程退出回收（helper 已登记），`device:ready` 不持有会话，notes 末尾加一行说明，不加新字段。

### D3：（取消）无 bundle 的 `--dump-ui-only`

原拟让 `--dump-ui-only` 不带 `--bundle` 时落 `_adhoc/testing/reports/`。按 YAGNI 取消：「解锁」由 D2 覆盖；Maison 即席轨的"做一些事情"本就是对某 bundle 跑 UI 步骤，纯设备级观察当前屏不是当前有实证的需求。触发条件见 D5-6。

### D4：话术正道——先分流、再限定、加一条禁令；不用追加例外覆盖旧指令

**D4-a SKILL 结构调整**（[device-testing/SKILL.md](../../skills/feature/device-testing/SKILL.md)）：

1. 新增顶节 **「请求分流（先判后进，BLOCKER）」**，置于现有「前置」之前，把现有「模式分支：标准 vs 即席」表**移动**到这里并扩成三行：

   | 请求形态 | 典型输入 | 走哪条 | 需要什么 |
   |---|---|---|---|
   | **设备就绪** | 「解锁手机」「手机准备好了吗」「唤醒设备」 | `npx ts-node scripts/device-policy.ts --ready --json`，按 [device-policy-gate 正道节](../../skills/reference/device-policy-gate.md) 处置 | 只需 harness 运行时（Tier_1）与个人 setup；**不需要** feature / bundle / acceptance / receipt / 测试报告 |
   | **即席** | bundle + 自然语言步骤，或「解锁后打开某 App 做…」 | Step 4.B；CLI 内置设备门（**不必先跑 `--ready`**） | 个人 setup；不需要 feature / acceptance / receipt / verifier |
   | **正式** | 「对 `<feature>` 做真机测试」、已存在需求目录 | Step 1–7 全流程 | 下文「前置」全部 + 输入矩阵 |

   原「即席识别启发」段跟随迁入；触发条件加「解锁手机 / 唤醒设备 / 设备准备好了吗」。
2. 现有「前置」段首加限定句：「**以下前置只适用于正式模式**；即席与设备就绪按分流表」。「Feature 归档定位协议 / 跨会话 Resume Gate / 输入矩阵」段同此限定。
3. 「输入」表标题改「输入（正式模式）」；「缺 acceptance.yaml：提示先运行 spec 阶段」限定为正式模式。
4. 前置里的设备策略句末补：「即席 CLI 与 `device:ready` 已内置该门，agent 不必手动先跑 `--check`；unset 时 CLI fail-fast 透传四选一文案，agent 再用 registry `setup.device_policy` 问用户」。

**D4-b device-policy-gate 正道节**（[device-policy-gate.md](../../skills/reference/device-policy-gate.md) 文首新增「用户要求解锁 / 操作设备时的正道」）：

- **只要解锁或确认设备** → 跑 `npx ts-node scripts/device-policy.ts --ready --json`（直接调脚本，勿 `npm run`）。**解锁后要操作某个 App** → 直接跑即席 CLI（内置门），**不要**先 `--ready` 再即席（重复检查，managed 档还会起停两次）。
- **两段判定与 `--check` 完全相同**：退出码非零或 stdout 非 JSON = 执行失败，停止并交回用户，不得当成未配置引导登记；退出 0 看 `code`：
  - `ready`：按 `target_kind` 说话——`physical` 才是"手机已解锁"；`emulator` 是"手机未就绪，已授权模拟器可用"；`unknown` 如实说未完成 attestation。结果只对本次调用有效，后续命令各自起门。
  - `device_policy_unset`：才走既有四选一；选②由用户 TTY 登记后 **agent 自跑 `--ready --json` 确认**，不再让用户重跑探测。
  - `ambiguous` / `blocked` / `frozen_target_mismatch`：`reason` 原文交给用户，按其中指引处置；不改代码、不徒手处置锁屏。
- 一句定性：「**不碰 PIN ≠ 不能解锁**——登记由用户完成，**使用已登记凭据解锁由框架自动执行**，agent 的职责是调 `--ready` 或即席 CLI」。
- 「阶段执行中遇到设备不可用」段末补：重跑本阶段前可先 `--ready --json` 确认。

**D4-c 其余文件**：

| 文件 | 改动 |
|---|---|
| [device-testing-workflow-detail.md](../../skills/reference/device-testing-workflow-detail.md) Step 4.B | 第 0 条：执行 / dump-ui-only / observe-ui 启动时 CLI 自起设备门（`ADHOC_PHASE=device_gate`），失败读 stderr `reason` 与 placeholder `error_kind=device_not_ready`；agent 不得为此手写脚本 |
| [confirmation-registry.yaml](../../skills/reference/confirmation-registry.yaml) `setup.device_policy.notes` | 「①③ 写完须重跑探测确认 `code=ok`」改为「①②③ 落盘 / 登记后由 agent 跑 `--ready --json`（退出 0 看 `code=ready`）确认」 |
| [goal-mode-operations.md](../../skills/reference/goal-mode-operations.md) 解锁授权表 | 「允许（正道）」行补：交互态由 agent 调 `device:ready` / 即席 CLI 触发同一解锁链；冻结上下文内 `--ready` 沿用原目标与原授权 |
| [framework-agent-execution.mdc](../../agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc) | §1 禁止清单加：**不得为解锁 / 唤醒设备手写脚本 import harness 内部函数（`ensureUnlocked` / `buildUnlockDeps` / `ensureDeviceReady`）**；§2 映射加一行：用户说「解锁手机 / 手机准备好了吗」→ agent 自跑 `--ready --json`，按 device-policy-gate 正道节处置；§3 话术表加一行：设备锁屏 → 错误「我不能解锁设备」/ 正确「跑 `--ready`，unset 才四选一」 |
| 三个 command 模板（[claude](../../agents/claude/templates/commands/device-testing.md) / [codeagent](../../agents/codeagent/templates/commands/device-testing.md) / [cursor](../../agents/cursor/templates/commands/device-testing.md)） | `argument-hint: [feature-name]`；description 改「真机测试阶段（含即席跑机与设备解锁 / 就绪）」；正文加一行指向 SKILL「请求分流」节 |
| [hylyre-host-preflight.md](../../skills/feature/device-testing/reference/hylyre-host-preflight.md) env 表 | `HARNESS_HDC_TARGET` 行改「由设备门解析注入；手工设置只用于多设备时显式覆盖」 |

### D5：核实后不改（七项）

1. **PIN 只在 TTY 登记**：`enroll` 非 TTY 拒绝、口令不经 Node——正确且是事故止损设计，保留。
2. **桥不读 config**：b3f7d9a2 裁决，接线在入口不在桥。D1 正是把即席 CLI 变成一个合格的"入口"。
3. **即席不加交互四选一**：CLI 不读 stdin；fail-fast 透传 guidance 后由 agent 用 registry `setup.device_policy` 问用户，与 harness-runner 一致。
4. **不加 `phaseRequiresDevice('adhoc')`**：即席不是 phase，且 adhoc CLI 直接 import hmos-app provider，本就只在需设备 profile 可用；无条件起门即可。
5. **不改 Stop hook**：只在存在未闭环 `.current-phase.json` 时拦截，与本事故无关。
6. **不做无 bundle 的 dump / 步骤**：宿主再出现"不给 bundle 也要看屏"的实况再登记；落点会是 `_adhoc/testing/reports/`，五行以内。
7. **不收编用户脚本**：MIGRATION 提示消费者删除自写解锁脚本（若落在 `framework/` 下尤须删除），改用 `device:ready` / 即席 CLI。

### D6：规格与文档同步

- OpenSpec 新 change `openspec/changes/adhoc-device-entry-gate/`：`proposal.md`、`tasks.md`、`specs/harness-gates/spec.md` 一条 **MODIFIED** requirement「Normal-mode device phases resolve one target at entry and share it across the whole chain」→ 标题改为覆盖「normal-mode device phases, the ad-hoc device CLI and the standalone readiness entry」；正文加：即席 CLI 的 dump-ui-only / execute / observe-ui MUST 在首个设备命令前经同一入口门，门失败 MUST NOT 发出任何设备命令；derive-only MUST NOT 起门；`device-policy --ready` MUST 复用同一门，冻结上下文 MUST 沿用冻结目标与授权并复用运行期恢复、MUST NOT 切换目标；`--json` MUST 沿用 `--check` 的两段退出码契约；MUST NOT 自建解析。不新增 requirement，不新增 diagnosis kind。
- [MIGRATION.md](../../MIGRATION.md) 3.0.x 一节「即席跑机内置设备门 + `device:ready`」：行为变化（即席从"隐式选唯一在线设备、不问策略"改为"策略 ok 才跑"，老用户首次撞四选一，manual 档一条 `device:set --manual-unlock` 即可）；新命令与 JSON 契约；删除自写解锁脚本的提示。

## 4. 文件与提交边界

| 提交 | 文件 |
|---|---|
| 1 `feat(device): 即席 CLI 接设备入口门 + device:ready 独立就绪入口（plan c7d2a9e4）` | `harness/scripts/utils/device-readiness-gate.ts`（helper + 决策 `code`）、`harness/harness-runner.ts`（改调 helper）、`harness/scripts/adhoc-device-test.ts`（三处接线 + deviceSn 下移）、`harness/scripts/utils/adhoc-trace-placeholder.ts`（error_kind 成员）、`harness/scripts/device-policy.ts`（`--ready`）、`harness/package.json`（script）、`harness/tests/unit/device-readiness-gate.unit.test.ts`（V1/V2）、`harness/tests/unit/device-policy-cli.unit.test.ts`（V3）、`harness/tests/unit/adhoc-trace-placeholder.unit.test.ts`（V4）、`openspec/changes/adhoc-device-entry-gate/**`、`MIGRATION.md` |
| 2 `docs(skills): 请求分流、解锁正道话术与手写解锁脚本禁令（plan c7d2a9e4）` | D4 全部文件 + `harness/tests/unit/skills-device-policy-gate.unit.test.ts`（V5） |

两个提交都须在 codex review 通过后再打（[先 review 再提交]）；不跑宿主。

## 5. 接受的准确性边界（放弃的准确性）

1. **即席行为收紧**：此前即席在单设备宿主上不问策略直接跑；现在 `device_policy_unset` 即 fail-fast。存量即席用户首次会撞一次四选一。换来的是与正式阶段同一契约、凭据真正被使用。
2. **每次即席执行多一次 wake + 快照**（设备已解锁时约 1–3 s）；托管模拟器档位下门可能起实例。
3. **`device:ready` 不持有托管会话、不跨命令传递目标**：managed 档下它只能证明"能起来并就绪"，随即回收；后续命令重新起门、重新解析。真机 / existing 档无此问题。
4. **冻结上下文里的 `--ready` 只做运行期恢复**：不重查策略、不重解析目标、不能切换目标；探测判不出（`unknown`）报 `ok=false, code='blocked'`（"无法确认锁屏状态"）而不放行——独立命令没有后续操作可验证，宁可让用户看一眼手机，也不给出一个查不到依据的"已解锁"。桥对实际操作的 unknown 放行语义不受影响。
5. **文档只能纠偏，不能强制**：agent 仍可绕框架直调 hdc；分流节与禁令的效果只能由宿主实跑观察（不做 A/B）。
6. **`--ready` 成功不等于此后一直解锁**：锁屏超时后由既有运行期恢复桥再解一次；独立入口不加轮询保活。

## 6. 验收用例

| 编号 | 用例 | 判据 |
|---|---|---|
| V1 | helper 行为（注入 gate 函数） | ok+env → `process.env` 中陈旧 `MAISON_DEVICE_*` 被删、`HARNESS_HDC_TARGET` 等于门返回值；!ok → env 零改动；`managed` 存在时无论 ok 与否清理已登记且早于返回；gate 抛出 → 原样上抛且不登记、不注入；冻结放行 → 原样返回 `reusedFrozen=true`，env 零改动。门三个 `ok:false` 返回点分别带 `code` unset / ambiguous / blocked |
| V2 | 接线钉——**按执行路径分块断言，不固定全文件顺序与调用次数**（改既有 t2 用例 + 新增 adhoc 用例，复用其源码切片法） | harness-runner：调 `applyPhaseEntryDeviceGate(` 且位于 Step 2 之前、其后仍有 `buildTestingTargetKindCap(phase, gate.target)`。adhoc-device-test 按块切片：`if (dumpUiOnly) {` 块内门调用先于 `runAdhocDumpUi(` 且 `!ok` 分支 `process.exit(` 先于它；执行主路径（`logAdhocPhase('ensure')` 之后）门调用先于 `resolveMainAbilityForBundle(` 且 `!ok` 分支先 `writeAdhocTracePlaceholder`（`device_not_ready`）再 `process.exit(`；`if (isDeriveOnly) {` 块内**无**门调用；顶层不再有先于任何门调用的 `const deviceSn = process.env.HARNESS_HDC_TARGET` |
| V3 | `device-policy --ready`（注入 gate / 恢复函数 / env） | 非冻结 ok → 人读 0、`--json` 退出 0 且 stdout 恰为一段 JSON `ok=true, code='ready'`、`serial`/`target_kind` 取 target；非冻结 unset → `--json` **退出 0**、`code='device_policy_unset'`、`reason` 逐字等于门透传的 guidance；非冻结 AMBIGUOUS / BLOCKED → 退出 0、`code` 对应；helper 抛出 → 退出 1、stdout 空、stderr 含"不是未配置"；`--serial X` 非冻结 → 门收到 `HARNESS_HDC_TARGET=X`。冻结：无 `HARNESS_HDC_TARGET` → 拒绝、零设备调用；`--serial ≠ 冻结目标` → `ok=false, code='frozen_target_mismatch'`、恢复函数零调用；同目标重新锁屏且 `recovered=false, reason='unlock_failed'|'unauthorized'` → `ok=false, code='blocked'`（**不得**未经检查返回成功）；`recovered=false, reason='unknown'` → **同样** `ok=false, code='blocked'` 且 `reason` 含"无法确认锁屏状态"、不含"已锁"字样；`recovered=true` → `ok=true, reused_frozen=true, serial=冻结目标, target_kind=MAISON_DEVICE_TARGET_KIND`；credentialRef 由 `resolveAttemptCredentialRef` 给出（冻结无 ref 时为 null，不读 config） |
| V4 | placeholder | `error_kind='device_not_ready'` 往返 |
| V5 | 文档钉（扩 skills-device-policy-gate 用例） | SKILL 含「## 请求分流」且位于「## 前置」之前，「前置」段含"只适用于正式模式"，触发条件含「解锁手机」；device-policy-gate.md 含正道节、`--ready --json`、"不碰 PIN ≠ 不能解锁"、`target_kind` 三态措辞，且**不含**"先 ready 再即席"类表述；framework-agent-execution.mdc §1 含 `ensureUnlocked` 禁令、§2 含「解锁手机」映射；三个 command 模板 `argument-hint` 一致；registry notes 含 `--ready` |
| V6 | openspec | `openspec validate` 全 PASS（与既有 change 同款命令） |

## 7. 命令与完成判据

开发期间按变更跑目标检查（单个 unit 文件 / typecheck），不重复全量：

```bash
cd harness && npm run typecheck
```

收尾**一次**全量（已含 typecheck、unit、fixtures）+ LF 扫描（node 扫，按 07a41ec6 惯例）：

```bash
cd harness && npm test
```

宿主复验（**用户触发**，不在本 plan 完成判据内）：在宿主终端先 `cd framework/harness && npx ts-node scripts/device-policy.ts --ready --json`，观察退出 0、`code=ready`、`target_kind=physical` 且设备被解锁；再 `npm run adhoc-device-test -- --bundle <id> --dump-ui-only`，stderr 应出现 `ADHOC_PHASE=device_gate` 且不再出现「未显式指定目标，跳过就绪检查」。最终判据是宿主里用自然语言说「解锁手机」时 agent 直接跑 `--ready` 而不是拒绝或写脚本；这一条只能由用户实跑观察。

**完成 = V1–V6 全绿 + 一次全量 `npm test` 全绿 + 两个提交经 review 通过并落盘。** 宿主复验结果回灌 §8。

## 8. 修订记录

### 2026-09-07：施工图（未评审、未实施、未提交）

综合 Claude 源码探索（F01–F08）与 codex 只读意见（F02 分支无设备复现、F04 dump-ui-only 无门、F06 入口形态、F07 脚本判定、"最小修复三条"）。codex 的三条最小修复与 D1 / D2 / D4 一一对应；D3 按 YAGNI 取消并登记触发条件于 D5-6。

### 2026-09-07：codex 只读 plan review 第 1 轮（五项返修 + 四项裁剪，全部采纳）

| # | 意见 | 处置 |
|---|---|---|
| 1 P1 | 冻结上下文的入口放行不能作为 `--ready` 已就绪的依据；`--serial` 改 env 再调门会破坏冻结目标不可切换 | 新增 F09；D2 改为按冻结分派：冻结时不调门，沿用原目标 + `resolveAttemptCredentialRef`，复用 `ensureDeviceReadyAtRuntime`；异 serial 拒绝且零设备操作；结果带实际目标。phase 入口放行行为不动。V3 补三条冻结用例 |
| 2 P2 | `--ready --json` 对未配置退出 3 与 `--check --json` 退出 0 的既有契约冲突，D4 会留两套相反指令 | 新增 F10；D2/D4-b/V3 统一为 `--check` 同款两段契约：判定完成一律 0、看 `code`；非零仅执行失败。人读保留 0/3/1。决策对象补 `code` 以免解析文案 |
| 3 P2 | `ok=true` 不能一律解释为手机已解锁；env 改动不传回 agent shell | D2 结果语义按 `serial/target_kind` 三态；不承诺跨命令继承；不持有 managed 会话。D4-b 话术同步 |
| 4 P2 | 设备级请求必须先分流，不能追加例外覆盖 feature/receipt/acceptance 前置 | D4-a 改为结构调整：新增顶节「请求分流」并**移动**模式表，前置 / 归档定位 / Resume Gate / 输入表全部限定到正式模式。V5 钉节序与限定句 |
| 5 P2 | V2 的全文件顺序断言与 dump-ui-only 分支位置冲突 | V2 改为按块切片断言执行路径（dump / execute / observe 各自门在首个设备操作前、失败即退出；derive-only 无门），不固定全文件顺序与次数 |
| 裁 1 | 删掉"先 ready 再即席"重复前置 | D4-a/D4-b 明写：只解锁走 `--ready`，要操作 App 直接即席 CLI；V5 反向钉 |
| 裁 2 | 收窄 F07 | 已改为"能确认 / 不能据此断言"两段 |
| 裁 3 | 合并重复验证 | V7 删除；§7 改为开发期目标检查 + 收尾一次 `npm test` |
| 裁 4 | 保留现有裁剪 | D3 取消、D5 七项、非目标清单不变，并补"不新增恢复状态机 / 会话保持" |

### 2026-09-07：codex 只读 plan review 第 2 轮（一项 P1 收紧，采纳；其余通过）

| # | 意见 | 处置 |
|---|---|---|
| 1 P1 | 冻结路径把 `reason==='unknown'` 当就绪放行，与"`ok=true` = 已确认目标可用 / 可对 physical 说手机已解锁"自相矛盾；桥的 unknown 放行是给有后续操作验证的调用方用的，独立 `--ready` 没有后续操作 | D2 冻结行改为**只有 `recovered=true` 判成功**，unknown 归 `ok=false, code='blocked'`，`reason` 写"无法确认锁屏状态"、不宣称确定锁住；JSON 仍退出 0；桥不改。§5-4 与 V3 同步（V3 明确 unknown 用例，并把原"recovered=false → blocked"拆成 unlock_failed/unauthorized 与 unknown 两条）。不加字段、不加状态机、不加门禁 |

codex 结论：整体已收敛，修正后即可收口进入实施。

### 2026-09-07：宿主复验（用户触发）——通过，登记为中期复验

§7 的宿主复验由用户在真机上触发，两步结果（用户转述）：

| 步 | 命令 | 结果 |
|---|---|---|
| 1 | `npx ts-node scripts/device-policy.ts --ready --json` | `ok=true`、`code=ready`、`serial=3UJ0225321000395`、`target_kind=physical`；notes：`wake → unlock: 已用登记凭据解锁并复验` |
| 2 | 即席 `adhoc-device-test --bundle com.example.simulatedwallet --dump-ui-only`（冷重启后 dump 首页） | dump 成功；trace `doc/features/_adhoc/testing/reports/20260907-170757/hylyre/trace.json`（TC-001 通过，`ADHOC_PHASE=device_gate` 已过）；UI dump `doc/app-snapshot-cache/com.example.simulatedwallet/dump-ui-20260907.json`（均为宿主工程相对路径） |

**最终判据（§7 末句）**：宿主里用自然语言说「解锁手机」，agent 全程直接跑 `--ready`——无拒绝、无自写脚本、无让用户手动跑命令。**通过**。

**证明了什么**：① 生产解锁链在当前 `device-readiness-gate.ts` / `device-readiness-deps.ts` 上于真机完成 wake → 快照 → 输入 → 复验解锁（`已用登记凭据解锁并复验` 这句 note 只在该条生产路径上产生）；② hdc 路径解析（`runHdc` 经 `hdc-runner.resolveHdcExecutableSync`）在宿主生效——即席 dump-ui-only 过了设备门并取到首页 dump。

**为什么不关闭 `PENDING_REAL_DEVICE_REVERIFICATION`**：本次结果不落在活跃验收记录的判据面上（`harness/tests/unit/device-lockscreen-parser.unit.test.ts:120-190`），四项缺失：

1. 未采集 `events.jsonl` 的两条事件（`device_unlock_attempt` outcome=succeeded + `device_ready` target_kind=physical、同 serial）；
2. 无 `start_state_proof`——起始态未被证明为**时钟锁屏页**（`screen_lock_root_present=true` 且 `pin_container_present=false`）；若首帧已停在 PIN 页，`completeKeypad` 直接命中十键、**reveal 根本不执行**，正是本次修复要验的那条路径；
3. 无 `waited_ms`（实测 suspend 后 3s 不锁、45s 才锁，只声明 suspend 不足以保证进入锁屏）；
4. 无 `reveal_executed` 与 `credential_state_after=ready`。

故只登记为**中期复验**：`.../a4e7c2f9-live-gate-2026-08-17T110000Z/verification.json` 的 `superseded_by_source_change` 内新增 `interim_reverification`（含上表原文要点、`source_at_time` 两哈希取自同对象 `changed_files.current_sha256`、`proves` / `does_not_prove` / `closes_pending:false`），`status`、`source_sha256`、`changed_files`、`new_dependencies_*` 一律不动。不伪造 `events.jsonl` 或 `start_state_proof`。

**关闭路径**（按 a4e7c2f9 plan t8 流程，届时执行）：`power-shell suspend` → 等待 ≥45s 至真正锁屏 → `power-shell wakeup` → `uitest dumpLayout` 交**生产 parser** 判定锁屏根在场且 PIN 容器不在场（起始态要证明、不能只声明做过 suspend）→ `runDeviceReadinessGate(buildDeviceReadinessInput(hostRoot))` 采集两条事件 → 落**新记录目录** + 同步更新测试常量（`REQUIRED_ACCEPTANCE_SOURCES`、`ACCEPTANCE_DIR`）与新旧记录 `supersedes` / `closed_by` 互指。`profiles/hmos-app/harness/hdc-runner.ts` 是否纳入新的 `source_sha256`，届时裁定（现记录 `new_dependencies_not_covered` 已挂账）。

## 实施记录

验证日志目录：`<scratch>/dre/`（`before-dev1-c1-<suite>.log` 改动前基线、`dev1-c1-<suite>.log` 改动后、`dev1-c1-typecheck.log`、`dev1-c1-lf-scan.log`）。全量 `cd harness && npm test` 本轮**未跑**（由调度者在 review 通过后跑一次）；宿主复验（§7）**未跑**，由用户触发。本轮全部验证零真机、零 hdc：`--ready` 的进程级 smoke 用未配置策略的临时 host，门在策略检查处即 fail-fast。

### 2026-09-07 · C1/D1 共享 helper + harness-runner 改调（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/utils/device-readiness-gate.ts`:858–920 | 新增 `applyPhaseEntryDeviceGate({ projectRoot, phase, startedBy, log?, env?, gate?, registerCleanup? })`，从 harness-runner :878–934 **逐字搬运**：起门（抛出原样上抛）→ 逐条 `log(note)` → `gate.managed` 时**在任何返回之前**登记 `reclaimManagedDevice`（`started_by_run=startedBy`）→ `ok && env` 时 `applyFrozenDeviceEnv(env, decision.env)` 并打一行目标 → 返回 decision。`process.exit` 与 placeholder 留给调用方 |
| 同上 :691 / :766 / :795 | `PhaseEntryDeviceGateDecision.code?: 'device_policy_unset' \| 'ambiguous' \| 'blocked'`，在门现有三个 `ok:false` 返回点各填一个（策略 unset / `AMBIGUOUS` / 其余 BLOCKED）。冻结损坏分支不填。纯附加，既有字段与判定零改动 |
| `harness/harness-runner.ts`:873–893 + import :131–134 | 原 57 行块换成一次 `applyPhaseEntryDeviceGate(...)` 调用；两处 `process.exit(1)`（抛出 / `!ok`）与其后的 `buildTestingTargetKindCap` / `deviceConclusionCap` 一字未动；`applyFrozenDeviceEnv` / `registerManagedDeviceCleanup` / `reclaimManagedDevice` / `defaultProcessProbe` 四个 import 随之删除（已下沉到 helper） |

**为什么最小**：不新增模块、不新增状态机，helper 就是原块的搬运；三个可选注入点（`env` / `gate` / `registerCleanup`）只为 V1 能断言"零登记 / 零注入"这类否定命题（plan §6 V1 本就要求"注入 gate 函数"）。

**验证**：`npm --prefix harness run test:unit -- --filter device-readiness-gate` 37 → 41 passed / 0 failed（`dev1-c1-device-readiness-gate.log`）；`npm --prefix harness run typecheck` PASS（`dev1-c1-typecheck.log`）。

**放弃的准确性**：与 §5 一致（本节无新增取舍）。一处行为可见的细节：托管回收成功的那行提示与"设备目标已解析并注入"现在都经 `log` 回调输出（harness-runner 里前缀从 `   ✓ ` 变成 `   · [device] `），回收被拒绝仍走 `console.error`（stderr）——纯人读格式，无消费方。

### 2026-09-07 · C1/D1 即席 CLI 三个碰设备分支接线（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/adhoc-device-test.ts`:212 / :606–609 | 顶层脚本没有 `await`（tsconfig `module=commonjs` + `target=ES2020`，无顶层 await），故把「dump-ui-only 起点到文件末尾」整段包进 `void (async (): Promise<void> => { … })().catch(…)`；**除缩进外零改动**（reindent 脚本机械加两空格，该段无跨行模板字面量） |
| 同上 :229–246 | `--dump-ui-only`：`ensureHylyreReady` 成功之后、`runAdhocDumpUi(` 之前 `logAdhocPhase('device_gate')` + 起门；`!ok` 打 `reason` 原文后 `process.exit(1)`；门后才 `const deviceSn = process.env.HARNESS_HDC_TARGET` |
| 同上 :478–506 | 执行 / `--observe-ui` 主路径：`logAdhocPhase('ensure')` → ensure 成功之后、`resolveMainAbilityForBundle(` 之前起门；`!ok` 先写 `error_kind:'device_not_ready'`（`error_message` 取 reason 首行）+ `printAdhocAnchors` 再 `process.exit(1)`；门后才读 `deviceSn` |
| 同上 :191–193 | 删掉顶层 `const deviceSn = process.env.HARNESS_HDC_TARGET`（F01 的那一行），改成两行注释说明为何只在门后读 |
| `harness/scripts/utils/adhoc-trace-placeholder.ts`:13–15 | `AdhocErrorKind` 加 `'device_not_ready'` |

`logAdhocPhase` 的 `phase` 是自由字串（`adhoc-phase-log.ts`:2），无需加枚举成员。derive-only 与用法错误分支未接门。

**为什么最小**：门只在两处物理调用点（dump 分支、执行/observe 共用的主路径），没有为 observe 单开第三条；async IIFE 是唯一能保留原有顺序语义又拿到 `await` 的改法（子进程跑门会变成第二套目标解析，被 §2 禁止）。

**验证**：
- `--filter device-readiness-gate` 新增 V2 切片用例（`device-readiness-gate.unit.test.ts` 末段）：dump 块内门早于 `runAdhocDumpUi(` 且失败退出不晚于它；主路径门早于 `resolveMainAbilityForBundle(`、其间有 `device_not_ready` placeholder 且随即退出；`if (isDeriveOnly) {` 块内无门；顶层 `deviceSn` 读取晚于首个门调用；`ADHOC_PHASE=device_gate` 锚点在场
- `--filter adhoc-trace-placeholder` 3 → 3 passed（`device_not_ready` 进 `ERROR_KINDS` 往返表，用例数不变）
- 进程级 smoke（零设备）：无参数 → 用法 exit 2；`--bundle … --steps "打开首页" --project-root <tmp>` derive-only → exit 0、只落 `derive-adhoc-last.json`、无 `ADHOC_PHASE=device_gate`

**放弃的准确性**：与 §5-1/§5-2 一致（即席收紧 + 每次多一次 wake/快照）。新增一条形态说明：包 async IIFE 后，IIFE 内的**未捕获同步异常**变成 promise rejection，由末尾 `.catch` 打栈并 `exit 1`（与此前未捕获异常的 exit 1 等价，栈仍进 stderr）。

### 2026-09-07 · C1/D2 `device-policy --ready` 独立就绪入口（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/device-policy.ts`:409–530 | 新增导出 `ready(projectRoot, { serial?, json? }, deps?)`（`deps`: `env` / `gate` / `recover` / `buildUnlockDeps` / `resolveAttemptCredentialRef`，对齐 `rebind(projectRoot, serial, version, provider)` 的注入风格）。非冻结：`--serial` 先写 `env.HARNESS_HDC_TARGET` 再调 D1 helper（`phase='device-ready'`，`startedBy='device-ready-<pid>'`），`code` 取 `decision.code`、ok 时 `'ready'`。冻结：**不走解析路径**——缺 `HARNESS_HDC_TARGET` 时调同一 helper 取门的"冻结上下文损坏"原文（该分支零设备操作）归 `blocked`；`--serial` 异于原目标 → `frozen_target_mismatch` 且零设备操作；否则 `ensureDeviceReadyAtRuntime({ serial: 原目标, credentialRef: resolveAttemptCredentialRef(projectRoot), deps: buildUnlockDeps() })`，**只有 `recovered=true` 判成功**，`unauthorized`/`unlock_failed` 用 note 原文、`unknown` 写"无法确认锁屏状态（唤醒后仍判不出）"且不含"已锁/锁着" |
| 同上 :393–406 | `DeviceReadyResult` 与 `READY_SCOPE_NOTE`（notes 末尾一行"托管模拟器随本进程退出回收；结果只对本次调用有效，后续入口各自起门。"）。JSON 字段顺序 `{ ok, code, serial, target_kind, reused_frozen, notes, reason? }` |
| 同上 :536 / :548–550 / :615–619 | `main` 增 `--ready` 分派（只做 argv 解析）、返回类型放宽为 `number \| Promise<number>`、`require.main` 入口按类型分派写 `process.exitCode` |
| `harness/package.json`:40 | `"device:ready": "ts-node scripts/device-policy.ts --ready"` |

**为什么最小**：非冻结路径一行不写解析逻辑，全部借门；冻结路径借运行期恢复 + `resolveAttemptCredentialRef`，零新枚举、零状态机、零会话保持；"冻结上下文损坏"的文案不抄第二份，直接调门取回。

**验证**：`npm --prefix harness run test:unit -- --filter device-policy-cli` 22 → 24 passed / 0 failed（`dev1-c1-device-policy-cli.log`）。两条用例覆盖 V3 全表：非冻结 ok（JSON 恰一段、`serial`/`target_kind` 取 target、人读 0）、unset（**退出 0**、`reason` 逐字等于门透传 guidance、人读 3）、ambiguous/blocked、helper 抛出（exit 1、stdout 空、stderr 命中 `/不是.*未配置|不要据此重新登记/`）、`--serial X` 门收到 `HARNESS_HDC_TARGET=X`；冻结 recovered=true（`reused_frozen`/`serial`/`target_kind` 取冻结值、credentialRef 来自注入的 `resolveAttemptCredentialRef`）、无 ref 时恢复只拿到 `null`、`unauthorized`/`unlock_failed` → `blocked` 且 note 原文、`unknown` → `blocked` + "无法确认锁屏状态" 且**不含**"已锁/锁着"、异 serial → `frozen_target_mismatch` 且恢复函数零调用、冻结损坏 → `blocked` 复用门原文且零调用。全部经注入，**未碰真实凭据库、未碰 hdc、未碰真机**。另有一次进程级 smoke：未配置策略的临时 host 上 `--ready --json` → stdout 恰一段 JSON、`code=device_policy_unset`、exit 0（门在策略检查处即止，零设备操作）。

**放弃的准确性**：与 §5-3/§5-4/§5-6 一致（不持会话、不跨命令继承目标；冻结路径 `unknown` 不放行；成功不等于此后一直解锁）。

### 2026-09-07 · C1/D6 openspec change + MIGRATION（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `openspec/changes/adhoc-device-entry-gate/proposal.md` / `tasks.md` / `specs/harness-gates/spec.md` | 新建。spec delta 只含**一条** MODIFIED requirement（原「Normal-mode device phases resolve one target at entry…」），正文补：三类入口共用同一条接线；即席三分支 MUST 在首个设备命令前起门、失败 MUST NOT 发设备命令并落 `device_not_ready`；derive-only MUST NOT 起门；即席 MUST 在门后才读目标；`--ready` 两条路径与冻结纪律（只有 `recovered=true` 成功、`unknown` 不放行、异 serial 零设备操作）；`--json` 沿用 `--check` 两段退出码契约；决策 `code` 使消费方不必解析文案。新增 **4** 条 Scenario（delta 文件共 10 条，既有 6 条随 MODIFIED 整段逐字复制、一字未动）。不新增 requirement、不新增 diagnosis kind |
| `MIGRATION.md`:263–272 | 3.0.x 新增一节，与既有 3.0.x 小节并列：行为变化（即席从"隐式选唯一在线设备、不问策略"改为"策略 ok 才跑"，老用户首次撞四选一，manual 档一条 `npm run device:set -- --manual-unlock`）、新命令与 JSON 两段契约、结果只对本次调用有效、删除自写解锁脚本（落在 `framework/` 下尤须删除）、未改动清单、放弃的准确性四条 |

**与 plan 的偏离**：D6 要求把 requirement 标题改成覆盖三类入口。openspec 的 delta 按 **requirement 名**匹配，改名必须显式声明，否则归档时会留下旧条目并新增一条。故按 CLI 支持的形态加了 `## RENAMED Requirements`（`FROM:`/`TO:`），MODIFIED 头引用**新名**（`specs-apply.js`:118–122 强制如此）。语义与 plan 一致，只是多了三行声明。

**验证**：`npm run openspec:validate` → `✓ change/adhoc-device-entry-gate`，Totals 37 passed / 0 failed，且 `[openspec-enforcement] PASS`。

### 未做 / 存疑（C1 范围）

- **未跑**：全量 `cd harness && npm test`（含 fixtures）——按分工由调度者在 review 通过后跑一次；宿主复验（§7）由用户触发。
- **未做**：D4 全部文档与 V5（`skills-device-policy-gate.unit.test.ts`）属提交 2，由并行的 C2 负责；本轮未碰 `skills/` 与 `agents/`。
- **未做**：D3（已取消）、D5 七项（核实后不改）——一字未动。
- **存疑（留给 review）**：① 即席脚本包 async IIFE 是本次唯一的结构性改动，缩进由脚本机械完成，建议 review 用 `git diff -w` 确认"除缩进外零改动"；② helper 的三个注入点是为可测性加的，若认为 `registerCleanup` 过度，可改由 V1 只断言"managed 在场时不抛"——但那样"早于返回"这条纪律就没有钉子了；③ `--ready` 冻结分支缺 `HARNESS_HDC_TARGET` 时复用门取文案，等于对同一 helper 多一次调用（该分支零设备操作、零策略查询），换来的是"冻结上下文损坏"文案单一真源。

### 2026-09-07 · C2 D4-a/b/c + V5（完成）

范围＝plan c7d2a9e4 提交 2（D4 全部文档 + V5 文档钉单测）。D5 七项未动；harness 生产代码 / openspec / MIGRATION / 子 plan 由并行 C1 负责，本节零触碰。未 commit、未跑宿主、未碰真机。

#### D4-a device-testing SKILL 结构（`skills/feature/device-testing/SKILL.md`）

- 新增顶节 `## 请求分流（先判后进，BLOCKER）`（:5），排在 `## 前置`（:15）之前；三行表（设备就绪 / 即席 / 正式，:7-:11）列名与行内容按 plan D4-a 表。
- **移动**：原 `### 模式分支：标准 feature vs 即席（ad-hoc）`（旧 :30-:35，含两行表）与其后「两种模式共享 device-test-case-kernel」段、「即席识别启发」段（旧 :37 / :39）整体迁入新顶节；原位置只留触发条件一行，无重复表（`grep -n "模式分支\|即席识别启发"` 仅剩 :13 一处）。
- `## 前置` 段首加限定句「**以下前置只适用于正式模式**；即席与设备就绪按上方分流表」（:17）。
- 归档定位 / Resume Gate / 输入矩阵段首加「**以下三项…同样只适用于正式模式**」（:21）。
- 设备策略句末补「即席 CLI 与 `device:ready` 已内置该门，agent 不必手动先跑 `--check`；unset 时 CLI fail-fast 透传四选一文案，agent 再用 registry `setup.device_policy` 问用户」（:19 行尾）。
- `## 输入` → `## 输入（正式模式）`（:44）；「缺 acceptance.yaml」限定为「（仅正式模式）…即席与设备就绪不需要它」（:54）。
- 触发条件补「解锁手机」「唤醒设备」「设备准备好了吗」（:38）。
- `phase.next_step` / `闭环停等` 字样保留（check-skills-confirmation-ux 要求）。
- **行数预算**：算法 `harness/scripts/utils/skill-body-budget.ts`（整份 SKILL.md 去尾换行计行，`lines > budget` 才违规），预算来源 `specs/phase-rules/docs-rules.yaml:52 skill_body_max_lines`，device-testing 无 override → `default_budget: 150`。**改前 150 行（零余量），改后 149 行**，`check:docs --verbose` 的 `skill_body_max_lines` PASS。
- **为压回预算做的取舍（放弃的准确性）**：迁入的「两种模式共享 device-test-case-kernel」与「即席识别启发」两段**合并为同一段落**（原文逐字保留，只去掉段间空行），否则净增 1 行即 151 > 150。放弃的是两段的视觉分隔，未删改任何字句。另：旧表第三列「是否走 `<features_dir>/<正式 feature>/`」中的「用占位目录名 `_adhoc`」提法随表替换消失，`_adhoc` 落点仍在 SKILL Step 7、阶段闭环判定节与 workflow-detail Step 4.B 中保留。

#### D4-b 解锁正道节（`skills/reference/device-policy-gate.md`）

- 文首（标题段之后、`## 为什么是前置而不是运行期处理` 之前）新增 `## 用户要求解锁 / 操作设备时的正道`（:7-:22）：
  - 只解锁 → `cd framework/harness && npx ts-node scripts/device-policy.ts --ready --json`（直接调脚本）；要操作 App → 直接即席 CLI，**不要**先 `--ready` 再即席（:10-:11，重复起门 + managed 起停两趟）。
  - 两段判定与 `--check` 完全相同（:13）；`code` 五值处置表（:17-:20）：`ready` 按 `target_kind` 三态说话且只对本次调用有效；`device_policy_unset` 才四选一、选②登记后由 agent 自跑 `--ready --json` 确认；`ambiguous` / `blocked` / `frozen_target_mismatch` 原文交用户。
  - 定性句「**不碰 PIN ≠ 不能解锁**……agent 的职责是调 `--ready` 或即席 CLI」（:22）。
- 选②红线段末尾「用户跑完后**重跑上面那条探测命令**…确认 `code=ok`」改为「**由 agent 自跑** `--ready --json`…确认 `code=ready`……不再让用户重跑探测」（:120-:121，行尾续行）。
- 「阶段执行中遇到设备不可用」段末补「重跑前可先跑 `--ready --json` 确认设备此刻确实就绪」（末行）。
- 未动：`--check` 探测节、四选一表、rebind 节（既有 V5 用例仍钉 `--check --json` 与 PIN 红线，全绿）。`--check` 那张 `code` 表里「落盘后重跑确认 `code=ok`」一句按 plan 范围未改（plan D4 只点名 registry notes），登记为存疑项。

#### D4-c 其余文件

| 文件 | 改动（行） |
|---|---|
| `skills/reference/device-testing-workflow-detail.md` | Step 4.B 新增第 0 条「设备门由 CLI 自起」（:35）：三条碰设备路径首个设备命令前自起门、锚点 `ADHOC_PHASE=device_gate`、derive-only 不起门、失败读 stderr `reason` 与 `error_kind=device_not_ready`、禁为此手写解锁脚本 |
| `skills/reference/confirmation-registry.yaml` | `setup.device_policy.notes`：「①③ 写完须重跑探测确认 `code=ok`」→「①②③ 落盘 / 登记后由 agent 跑 `--ready --json`（退出 0 看 `code=ready`）确认，不再让用户重跑探测；探测契约同款：」（:157-:158），其余 notes 文字逐字不动 |
| `skills/reference/goal-mode-operations.md` | 解锁授权表「允许（正道）」行补：交互态由 agent 调 `device:ready` / 即席 CLI 触发同一解锁链、无需 feature/bundle；冻结上下文内 `--ready` 沿用原目标与原授权（:184） |
| `agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc` | §1 新增禁令行「不得为解锁 / 唤醒设备手写脚本 import harness 内部函数（`ensureUnlocked` / `buildUnlockDeps` / `ensureDeviceReady`）」（:23）；§2 新增「解锁手机 / 手机准备好了吗 / 唤醒设备 → agent 自跑 `--ready --json`，按正道节处置，不需要 feature/bundle」（:40）；§3 话术表新增「设备锁屏」行（:51） |
| `agents/{claude,codeagent,cursor}/templates/commands/device-testing.md` | `argument-hint: <feature-name>` → `[feature-name]`；description → 「进入真机测试阶段（含即席跑机与设备解锁 / 就绪）」；正文加一行「只要解锁 / 确认设备、或即席跑机（无 feature 名也可进）：先看 SKILL 的「请求分流」节」（cursor 保持薄入口，只加该行） |
| `skills/feature/device-testing/reference/hylyre-host-preflight.md` | env 表 `HARNESS_HDC_TARGET` 行 → 「由设备门解析注入（正式阶段 / 即席 CLI / `device:ready` 各自起门）；手工设置只用于多设备时显式覆盖序列号」（:42） |

#### V5（`harness/tests/unit/skills-device-policy-gate.unit.test.ts`）

沿用既有 `run(results, name, fn)` 风格，新增 3 条用例（插在最后一条既有用例之前，:194-:250）：

1. `device-testing SKILL 先分流后前置，且设备就绪请求可识别`：`## 请求分流` 存在且 `indexOf` 早于 `## 前置`；「前置」段（切到下一个 `## ` 为止）含「只适用于正式模式」；全文含「解锁手机」与 `--ready --json`。
2. `设备策略门文档有「正道节」…`：正道节标题、`scripts/device-policy.ts --ready --json`、「不碰 PIN ≠ 不能解锁」、`target_kind` 三态（`physical`/`emulator`/`unknown` + 「已授权…模拟器」措辞）；**反断言**逐行扫 `/先\s*`?--ready`?\s*再.{0,6}即席|先 ready 再即席/` 且排除含 `不要|不得|禁止|勿` 的行 → 只拦正向指令，放行「**不要**先 `--ready` 再即席」这条禁令。反断言有效性已用 node 单独验证：正向句 `应当先 --ready 再即席 CLI` 命中且不豁免，禁令句命中但豁免，当前文档命中 1 行且是禁令行。
3. `执行规则与命令模板…`：mdc 含 `ensureUnlocked` 禁令与「解锁手机」+`--ready --json` 映射；三个 command 模板 `argument-hint` 值集合 size=1 且等于 `[feature-name]`，且均含「请求分流」；registry 含 `--ready`。

#### 验证

| suite / 命令 | 前 | 后 | 结果 | 日志 |
|---|---|---|---|---|
| `test:unit --filter skills-device-policy-gate` | 6 passed | **9 passed** | PASS | `dre/before-c2-skills-device-policy-gate.log` / `dre/dev1-c2-skills-device-policy-gate.log` |
| `--filter execution-channel` | 33 | 33 | PASS | `dre/dev1-c2-execution-channel.log` |
| `--filter framework-init-entry-contract` | 5 | 5 | PASS | `dre/dev1-c2-framework-init-entry-contract.log` |
| `--filter codeagent-adapter` | 12 | 12 | PASS | `dre/dev1-c2-codeagent-adapter.log` |
| `--filter generic-bundle` | 19 | 19 | PASS | `dre/dev1-c2-generic-bundle.log` |
| `--filter framework-init-current-turn` | 4 | 4 | PASS | `dre/dev1-c2-framework-init-current-turn.log` |
| `npm --prefix harness run check:docs`（唯一全量入口）+ `--verbose` | Total 14 / FAIL 1(doc_freshness, MAJOR) / Blockers 0 | 同上（`skill_body_max_lines` **PASS**，SKILL 150→149 行 ≤ 预算 150） | 与基线一致 | `dre/before-c2-check-docs.log` / `dre/dev1-c2-check-docs.log` / `dre/dev1-c2-check-docs-verbose.log` |
| `npm --prefix harness run typecheck` | — | exit 0 | PASS | `dre/dev1-c2-typecheck.log` |
| `node scratchpad/lf-scan.js` | — | scanned 16 files; CRLF: 0 | PASS | `dre/dev1-c2-lf-scan.log` |

注：`check:docs` 的 `doc_freshness` FAIL 是**基线既有**（MAJOR，非 BLOCKER；源自本轮之外的 SKILL/plan 改动时间戳），改前改后同样存在，不由 C2 引入。unit / check:docs / typecheck 均在 C1 正在修改的 harness 代码同时在盘的状态下运行。

#### 未做 / 存疑

- **未做**：D5 七项、D1/D2/D6 全部（C1 范围）；MIGRATION、openspec、子 plan 文件未碰；全量 `cd harness && npm test` 按卡要求本轮未跑；宿主复验、真机未跑。
- **存疑 1**：`device-policy-gate.md` 的 `--check` code 表里仍写「落盘后重跑确认 `code=ok`」——plan D4 未点名该行（只点名 registry notes），故未改。若要口径完全统一，应在 review 后一并改为 `--ready --json` / `code=ready`。
- **存疑 2**：SKILL「阶段闭环判定」节仍用「**标准 feature 模式**」措辞，新分流表用「正式」。plan 未要求改，未动；术语二名并存。
- **存疑 3**：D4 文档写的 `npm run device:ready` / `--ready --json` 依赖 C1 的 D2 落地；两个提交须一并进入宿主，否则文档指向的命令不存在。

### 2026-09-07 · codex R1 返修（完成）

对 codex 第 1 轮 review 六条 finding 逐条闭合。**未 commit、未跑宿主、未碰真机**；全量 `npm test` 本轮未跑（按卡要求）。

| # | finding | 闭合 |
|---|---|---|
| F1 [high] | 设备门丢失既有 HDC 路径支持 | `harness/scripts/utils/device-readiness-deps.ts`:95–119 —— `runHdc`（本文件**唯一** hdc 调用点）把裸 `spawnSync('hdc', …)` 换成 hdc-runner `resolveHdcExecutableSync()` 的结果，懒 `require`（同 device-recovery-bridge:55 / capability-preflight:62 的做法与 eslint 注释），解析抛出 / 空值一律回落 `'hdc'`，不新增失败态、不复制第二套解析。`grep spawnSync` 确认 deps 里其余两处是 `netstat` / `powershell.exe`，与 hdc 无关。**这是 c0df72bc 起普通模式 ut/testing 门的既有缺陷，修在共享 `runHdc` 一处，全链（gate / `--ready` / 运行期恢复的 wake、snapshot、reveal、tap）同时受益** |
| F2 [high] | 实施记录多报 Scenario | 本 plan `C1/D6` 节表格：「新增 5 条」→「新增 **4** 条（delta 共 10 条，既有 6 条随 MODIFIED 整段逐字复制）」。核数依据：`grep -c '^#### Scenario:' openspec/changes/adhoc-device-entry-gate/specs/harness-gates/spec.md` = 10。**未**为凑数增加场景 |
| F3 [medium] | V2 未钉住判定失败退出 | `harness/tests/unit/device-readiness-gate.unit.test.ts` V2 用例重写：新增 `braceBlock()` 花括号配对切出 `if (!gate.ok) { … }` 子块；dump 分支断言子块存在、内含 `process.exit(`、整体早于 `runAdhocDumpUi(`；主路径断言子块存在、内部 `error_kind: 'device_not_ready'` 早于 `process.exit(`、子块整体位于门之后且早于 `resolveMainAbilityForBundle(`。断言体提成 `assertWiring(source)`，用例末尾把两个 `!gate.ok` 子块从源码字符串里删掉再跑一次作**负例**，要求必须抛 |
| F4 [medium] | 登记后复核口径冲突 | `skills/reference/device-policy-gate.md`:59 `device_policy_unset` 行：「落盘后重跑确认 `code=ok`」→「落盘 / 登记后由 agent 跑 `--ready --json` 确认 `code=ready`（`--check` 本身只探测策略、不碰设备）」。只改这一格，`--check` 两段契约段其余文字未动 |
| F5 [medium] | 即席入口被写成无需 bundle | `skills/reference/goal-mode-operations.md`:184「允许（正道）」行：拆成「`device:ready` 无需 feature / bundle」与「即席 CLI **仍须 `--bundle`**，无 bundle 直接 exit 2；只是不需要 feature / acceptance」 |
| F6 [low] | MIGRATION 重新加入已收窄的归因 | `MIGRATION.md`:271「绕过 `collectPolicyStatus` 与多设备歧义保护」→「绕过 `collectPolicyStatus` 策略入口」。直调内部函数、硬编码凭据版本、建议删除三项保留（plan §1 F07：显式绑定 serial 不构成绕过歧义保护） |

**F1 / F3 的负例（证明断言真会咬）**

- F1：把 `runHdc` 临时改回 `spawnSync('hdc', …)` 重跑 → `FAIL F1 就绪门复用既有 HDC 路径解析`，41 passed / 1 failed（`dre/fix1-negative-control-f1.log`）；随即原样还原（`grep spawnSync(exe, args,` 命中）。用例本身经 `child_process` 模块对象上替换 `spawnSync` 拦截（TS commonjs 下解析器探针与门调用都是属性访问，一处即覆盖两者）+ `resetHdcExecutableCache()`，`HARNESS_HDC_EXE` 指向临时空文件，**零真机、零真实进程**；env、`spawnSync`、临时目录在 `finally` 内全部还原
- F3：负例内建于同一条用例（删掉两个 `!gate.ok` 子块后 `assertWiring` 必须抛），随 V2 一起绿

**验证**

| 命令 | 前 | 后 | 结果 | 日志 |
|---|---|---|---|---|
| `npm --prefix harness run typecheck` | — | exit 0 | PASS | `dre/fix1-typecheck.log` |
| `test:unit --filter device-readiness-gate` | 41 passed | **42 passed** / 0 failed | PASS | `dre/fix1-device-readiness-gate.log` |
| `test:unit --filter device-policy-cli` | 24 | 24 passed / 0 failed | PASS | `dre/fix1-device-policy-cli.log` |
| `test:unit --filter skills-device-policy-gate` | 9 | 9 passed / 0 failed | PASS | `dre/fix1-skills-device-policy-gate.log` |
| `test:unit --filter unlock-wording` | 6 | 6 passed / 0 failed | PASS | `dre/fix1-unlock-wording.log` |
| `node <scratch>/lf-scan.js` | — | scanned 25 files; CRLF: 0 | PASS | `dre/fix1-lf-scan.log` |
| `npm run openspec:validate`（仓根，harness 无此脚本） | 37/37 | 37 passed / 0 failed + `[openspec-enforcement] PASS` | PASS | `dre/fix1-openspec.log` |

**放弃的准确性（本轮新增）**

- F1 的回落：`resolveHdcExecutableSync()` 抛出或返回空串时静默回落 `'hdc'`，不产生新的诊断态——保持与改造前逐字一致的行为，代价是"解析器本身坏了"这一事实不进证据链（该函数内部已有自己的探测与回落，再加一层报错等于第二套失败语义）。
- F1 的开销：`runHdc` 每次调用都走一次懒 `require` + `resolveHdcExecutableSync()`；后者有模块级缓存，首次之后是一次 map 命中 + 一次 `require` 缓存命中，未再加本文件私有缓存（第二份缓存＝第二处失效点）。
- F3 的 `braceBlock` 是朴素花括号计数，不解析字符串 / 模板字面量里的花括号；当前两个 `!gate.ok` 子块内无此类内容，若日后分支里出现带花括号的模板字面量需改用 AST（届时才值得）。

**未做 / 存疑**

- **未跑**：全量 `cd harness && npm test`（含 fixtures）——按卡要求本轮不跑；宿主复验（§7）由用户触发；真机零接触。
- **未动**：C1/C2 既有改动一行未回退；F4 之外 `device-policy-gate.md` 的 `--check` 探测契约段、四选一表、rebind 节未碰。上一节「存疑 1」（`--check` code 表口径）即由本轮 F4 关闭。

### 2026-09-07 · codex R2 返修（完成）

codex 第 2 轮只读 review 结论：**1 条 medium**，R1 其余五项（F1/F2/F4/F5/F6）确认关闭，无越界改动、无回归，78 项目标测试 + typecheck + openspec 全绿。**未 commit、未跑宿主、未碰真机**。

| # | finding | 闭合 |
|---|---|---|
| R2-1 [medium] | F3 未完全关闭：`harness/tests/unit/device-readiness-gate.unit.test.ts` 执行主路径 `if (!gate.ok) {` 子块只断言了 `device_not_ready` 字面量，未断言 `writeAdhocTracePlaceholder(` 调用本身——codex 在内存中把该调用换成 `void (`（参数与 `process.exit` 全留）后 V2 仍绿，而此时门失败不写 placeholder | `harness/tests/unit/device-readiness-gate.unit.test.ts`:1224–1229 —— `assertWiring` 主路径断言改为三条有序断言：子块内须有 `writeAdhocTracePlaceholder(`（`writeIdx > 0`）、`error_kind: 'device_not_ready'` 须在该调用之后（即落在其参数里，`placeholderIdx > writeIdx`）、`process.exit(` 也须在该调用之后（`exitIdx > writeIdx`，先落证据再退）。同用例 `:1261–1272` 在既有负例旁新增**负例二**：用 `braceBlock` 从 `logAdhocPhase('ensure')` 之后切出主路径失败子块（该锚点之后全文件仅此一个 `!gate.ok`，见 `harness/scripts/adhoc-device-test.ts`:491），在内存副本里只把该子块的 `writeAdhocTracePlaceholder(` 换成 `void (`，`assertWiring` 必须抛 |

**真实负例（改生产源码跑，证明断言真会咬）**

- 把 `harness/scripts/adhoc-device-test.ts`:494 的 `writeAdhocTracePlaceholder(` 临时改成 `void (`（其余不动）重跑该 suite → `FAIL V2 即席 CLI 接线…`，报错正是新断言「`!gate.ok` 分支内须调用 writeAdhocTracePlaceholder」，41 passed / 1 failed（`dre/fix2-negative-control.log`）。
- 随即从改动前的字节副本原样还原，`node` 逐字节比对确认 `cwd == 改动前备份`（`true`，23062 bytes）。注：该文件对 HEAD 本就有 C1/C2 的未提交改动，故 `git diff --stat` 非零属既有基线，不是本轮引入；字节比对才是本轮的还原判据。

**验证**

| 命令 | 前 | 后 | 结果 | 日志 |
|---|---|---|---|---|
| `npm --prefix harness run typecheck` | — | exit 0 | PASS | `dre/fix2-typecheck.log` |
| `test:unit --filter device-readiness-gate` | 42 passed | 42 passed / 0 failed | PASS | `dre/fix2-unit.log` |
| 真实负例（生产源码改 `void (`） | — | 41 passed / **1 failed** | 预期 FAIL | `dre/fix2-negative-control.log` |
| `node <scratch>/lf-scan.js` | — | scanned 25 files; CRLF: 0 | PASS | `dre/fix2-lf.log` |

**放行口径**：调度者按本循环既有口径（仅剩 medium、无 high/P1）不起第三轮 codex review，以 diff 核对 + 目标 suite 放行。

**放弃的准确性（本轮新增）**

- 新断言仍是源码字符串位序比对，不是 AST：它钉住「调用存在且早于 `error_kind` 与 `process.exit`」，钉不住「第一个实参确实是 `traceOutPath`」——换成别的路径变量仍能通过。要钉参数绑定得上 AST，代价大于收益（该实参在同文件另外四处 placeholder 调用里一致，改错会先被别的用例撞上）。
- 本轮只改测试，除该 suite 外的另三个目标 suite 与 openspec 未重跑：R2 对它们无 finding，改动也只落在这一个测试文件内。

**未做 / 存疑**

- **未跑**：全量 `cd harness && npm test`；宿主复验（§7）由用户触发；真机零接触。
- **未动**：生产代码本轮零改动（负例的临时改动已字节级还原）。

### 2026-09-07 · 真机验收夹具登记源码变更 + 全量测试（完成）

**背景**：全量 `npm test` 唯一失败项是 `harness/tests/unit/device-lockscreen-parser.unit.test.ts:235`「真机 gate 验收证据绑定生产源码」。该判据把 2026-08-17 真机验收记录的 `source_sha256` 与当前源码逐文件比对：本 plan 的 D1/R1 改了其中两个文件，哈希失配即触发。判据要求的出路只有一条——**如实登记失效**，不是重写哈希。

**改了什么**（只两个文件，零生产代码改动）

1. `harness/tests/fixtures/device-lockscreen/acceptance/a4e7c2f9-live-gate-2026-08-17T110000Z/verification.json:28`（`source_sha256_note` 之后）新增顶层 `superseded_by_source_change`：
   - `status: PENDING_REAL_DEVICE_REVERIFICATION`；`recorded_at: 2026-09-07`；
   - `changed_files` **恰好两条**（判据 `:240` 要求与实际失配集合精确相等，多登记未失配文件同样红）：
     - `harness/scripts/utils/device-readiness-gate.ts`：`verified fd0e6deb64ec…` → `current 49b735fe81c0…`
     - `harness/scripts/utils/device-readiness-deps.ts`：`verified 4a26d263fec1…` → `current 74b7fd95ef31…`
   - `device-unlock-helper.ts` 与 `bounded-sync-wait.ts` 本 plan 未动，哈希与记录仍一致，故**不**登记。
   - `by` 字段写明改动实体：gate.ts 新增 `applyPhaseEntryDeviceGate`（搬运 harness-runner 入口门接线，供 harness-runner / 即席 CLI / `device-policy --ready` 共用）+ `PhaseEntryDeviceGateDecision` 补可选 `code`；deps.ts 的 `runHdc` 改为复用 `hdc-runner.resolveHdcExecutableSync`（懒 require，解析失败回落 `'hdc'`）。未改 `ensureDeviceReady` 核心解锁/降级逻辑。
2. 本 plan（本节）。

**为什么不改 `source_sha256`**：那串哈希是 2026-08-17 真机验收当时**实际所验**源码的指纹。为迁就今天的改动去重写它，等于宣称新代码在真机上通过过——伪造真机证据。该纪律由夹具自身的 `note` 载明，判据 `:238` 也把它写进了失败文案。所以只登记「变了、待复验」，让欠账可见。

**new_dependencies_not_covered**：`profiles/hmos-app/harness/hdc-runner.ts`。它不在 2026-08-17 的 `source_sha256` 里，而 `runHdc` 现在经它解析 hdc 可执行路径，已是解锁链的实际依赖。**刻意不补进 `source_sha256`**（补了同样等于宣称它被真机验过）；真机复验时须一并纳入新记录。这条沿用 f4b2c8e6 记录对 `bounded-sync-wait.ts` 的同款处理。

**验证**

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm --prefix harness run test:unit -- --filter device-lockscreen-parser` | 9 passed, 0 failed | `dre/fix3-lockscreen-parser.log` |
| `cd harness && npm test` — typecheck | `tsc --noEmit -p tsconfig.typecheck.json` exit 0 | `dre/full-npm-test-2.log:6` |
| `cd harness && npm test` — unit | **3911 passed, 0 failed（共 3911）** | 同上 `:7951` |
| `cd harness && npm test` — fixtures | **46 passed, 0 failed（共 46）** | 同上 `:8012` |
| 全量退出码 | **EXIT=0** | 同上末行 |
| `node <scratch>/lf-scan.js` | scanned 28 files; CRLF: 0 | `dre/fix3-lf.log` |

日志目录：`C:\Users\shengqsq\AppData\Local\Temp\claude\D--1-code-agent-maison-br\9492c95a-9a6a-4993-8ec1-bef8020479a9\scratchpad\dre\`

**放弃的准确性**

- 本节只让证据链**如实反映**「源码已变、真机未复验」，**不**代表新代码在真机上可用。`device-readiness-gate.ts` / `device-readiness-deps.ts` 的当前形态迄今只有单测覆盖。
- `by` 描述的「未改核心解锁逻辑」是人工读 diff 的判断（105 行新增、1 行改动），不是机器证明。

**未做 / 存疑**

- 真机复验待用户在宿主触发（plan §7）；本轮真机零接触、宿主零接触。
- 生产代码本轮零改动。

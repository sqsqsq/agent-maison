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
    status: pending
  - id: dre-helper
    content: 按 D1 在 device-readiness-gate.ts 抽 applyPhaseEntryDeviceGate（起门 → 打 notes → 托管回收登记 → 原子注入 env），harness-runner 改调它，行为零变化；决策对象补可选 code（unset/ambiguous/blocked）。
    status: pending
  - id: dre-adhoc-wiring
    content: 按 D1 把 adhoc-device-test 的 dump-ui-only / 执行 / observe-ui 三个碰设备分支接入 helper；deviceSn 改为门后读取；失败写 device_not_ready placeholder；derive-only 不起门。
    status: pending
  - id: dre-device-ready-cli
    content: 按 D2 给 device-policy.ts 加 --ready [--serial] [--json]：非冻结走 helper；冻结沿用原目标 + resolveAttemptCredentialRef 复用 ensureDeviceReadyAtRuntime，只有 recovered=true 判成功（unknown 归 blocked、写"无法确认锁屏状态"），异 serial 拒绝且零设备操作；JSON 判定完成退出 0 看 code，执行失败非零无 JSON；结果带 serial/target_kind/reused_frozen。
    status: pending
  - id: dre-docs
    content: 按 D4：SKILL 新增「请求分流」节置顶并把 feature/receipt/acceptance 前置限定到正式模式；device-policy-gate 新增正道节（两段契约 + 三种 code 处置 + 模拟器就绪≠手机解锁 + 只解锁走 --ready、要操作应用直接即席 CLI）；workflow-detail 4.B；registry notes；goal-mode-operations 表；framework-agent-execution §1 禁令 + §2 映射行；三个 command 模板；hylyre-host-preflight env 表。
    status: pending
  - id: dre-spec-migration
    content: 按 D6 新增 openspec change adhoc-device-entry-gate（harness-gates 一条 MODIFIED requirement）+ MIGRATION 3.0.x 一节（即席行为变化、新命令、删除自写解锁脚本提示）。
    status: pending
  - id: dre-local-acceptance
    content: V1–V6 目标测试全绿；收尾一次 `cd harness && npm test`（含 typecheck/unit/fixtures）+ LF 扫描；宿主复验由用户触发（§7）。
    status: pending
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

## 实施记录

（待实施）

---
name: Goal 运行模式真值 — 监督边界、attended goal context 与跳板身份中性化
version: 3.0.0
todos:
  - id: t1-supervision-and-recovery-boundary
    content: "P0 · 监督与恢复边界——`goal-supervise.ts` 在进入既有 beacon × `run_disposition` 决策核**之前**先读本 run 的 `run-control.json`，按职责分流：owner 缺失 / run-control 损坏 → **fail-closed 不抢跑**；任一 `state=quiescing` 或存在未完成 handoff → no-op，不抢控制权；`kind=session` 的**任何状态**均不 spawn、**不写任何事件**（沿用 :254 已定的 no_op 零落盘口径）：`active` no-op，`released` 只表示允许 attended bridge 重新 attach、不是 run 终态，`orphaned_session` 只允许操作者显式 takeover；`kind=process` 才进入既有 beacon × `run_disposition` 决策核。是否 `TERMINAL` 只由 `run_disposition` 判断，严禁从 owner state 或「无未闭合 invoke」推导。**非 orphan 状态下**，session→process 的正常转换只能走既有 mailbox handoff；仅 `orphaned_session` 可在用户显式授权后通过既有 `--force-resume` / `forceTakeoverRunOwner` 执行 epoch takeover，supervisor 永不得触发该例外；`skills/project/goal-mode/SKILL.md` 同步为相同口径。同时修 `runDetachLauncher`（goal-runner.ts:3656-3670）：`-r` 预加载由裸 specifier `ts-node/register/transpile-only` 改为 `require.resolve` 绝对路径（与 goal-supervise.ts:369 已有范式一致），使 detach 不再依赖调用方 cwd——宿主工程根按依赖契约不装 framework runtime，这一点不得成为隐式前提。**不新增活性状态、不枚举进程、不改决策核判据轴。**"
    status: completed
  - id: t2-attended-goal-context
    content: "P0 · attended 的 goal context 显式绑定并修到 spec-owned SSOT 的真实写入点——`phase_execute_request` 增补权威 `run_id`（bridge 已持有 manifest，属协议传递，非宿主手抄），spec Skill 将同一 id 同时透传给既有唯一 initializer `fidelity-intent-init --goal-run-id <id>` 与阶段入口 `harness-runner --goal-run-id <id>`，**不在 bridge 新增第二个 initializer**。两入口复用同一 framework helper，按精确 run 定位 manifest/run-control 并校验 `manifest.feature === --feature`、当前 owner 为 `session/active` 且 lease 有效；任一失配均在写 SSOT / 注入 env 前 BLOCKER。initializer 的 goal 分支只从 manifest 读取 `requirement`、`adapter`、`requirement_source_files`，写 `execution_identity=run_id`、`requirement_provenance=goal_manifest`；同 run 的有效 SSOT 只读复用，首次后及 reattach 均不得改变文件 hash / `decision_id`。harness 通过同一校验后由 framework 侧注入既有 `MAISON_GOAL_RUN_ID` / `MAISON_GOAL_RUNNER` env，使 `isGoalOrchestrationEnv()`、`isAgentSideGoalHarness()`、`resolveRunOwnerKind()`、`mergeAndWritePhaseState()`（phase-state.ts:176 的 `.current-phase.json` 抑制）等**既有十余处消费链整体生效**。**严禁**新增「扫描 feature 下 active run 并自动认领」的解析器——手动跑同 feature `check-spec` 会被错绑到后台 run，多 active run 时也无唯一解。fidelity-intent / capability-snapshot 仍仅由既有 initializer 在 spec 起点（或 SSOT 失效）初始化，plan/coding/review/ut/testing 一律零写盘只读复用（goal-preflight.ts:657 已冻结下游重写事故）。**不新增 `manifest.run_mode`、不改 schema、不入 identity hash**；attended manifest 的 `unattended` 块保留。"
    status: completed
  - id: t3-bridge-neutrality-and-provenance
    content: "P1 · 跳板中性化、local-first 与 provenance 真值——`renderBridgeSkillStubMarkdown` 对**所有** skills-bridge 跳板不再注入静态 `RESOLVED_ADAPTER` 行（`.agents` 是 generic 与 chrys 共享根，该行结构上不可能对两个 owner 同时为真；独占根注入也只会与 local SSOT 争夺权威）。**不得**把 slash 模板的 `AskUserQuestion` 与 personal setup 整段 BLOCKER 复制进 bridge——Codex/Chrys/OpenCode 的 interaction renderer 明确是 portable-only、不支持结构化 widget，交互渲染仍由各 adapter 的 renderer 决定；至多在生成器加一条与渲染方式无关的中性提示：「fresh goal run 若运行方式未明确，先走 `goal.run_mode`」。`goal-mode-operations.md` 解析阶梯改为 **local-first**：先无 `--select-adapter` 跑 `check-personal-setup --ensure`——已有合法 local 直接用 `activeAdapter`（不再构造 `requestedAdapter`、不再重复询问 `setup.adapter`）；无 local 且单候选自动选；无 local 且多候选才走 registry。`goal-mode-entry.ts` 新增 `--adapter-source` 并停止硬编码 `adapter_provenance:'entry_declared'`：取自 personal setup 的真实来源（本次正解是既有枚举 `local_config`），**真拿不到时字段省略或 BLOCKER，不新增 `unknown` 枚举**（schema 已声明该字段可缺省）。`goal-mode SKILL.md` 明示「当前存在对话 ≠ 有人在场」，并把「歧义必走 registry `goal.run_mode`」与入口二选一绑定：attended → `goal-mode-entry --prepare-run`，unattended → `goal-runner --detach`；attended 的 prepare/attach 命令均显式传 `--run-mode attended`，且真正取得 owner 的 attach 入口必须独立校验，缺失或传 `unattended` 均在 CAS 前失败。该 flag 只是 caller declaration / 启动期断言，不能证明用户已被问过；用户选择仍由 Skill 的 `goal.run_mode` registry 契约负责。**不新增 `run_mode_declared` 事件**，运行状态只读 `run-control.owner.kind`。顺手修 `personal-setup-gate.md` 指向「goal-mode SKILL §运行身份」的悬空引用（实际在 `goal-mode-operations.md:5`）；删除 `agents/chrys/adapter.yaml` 中「`.agents` 下 generic 与 chrys 字节一致可幂等共存」的失真断言；既有共存单测取样从 `.agents/skills/coding/SKILL.md` 改为 `goal-mode/SKILL.md` 并补 generic↔chrys 双向物化幂等断言。"
    status: completed
  - id: t4-regression-and-host-smoke
    content: "回归、契约与收口——建立一个 OpenSpec change 修改既有 goal-runner / goal-mode-skill / agent-adapters 契约（①监督边界与 owner 全状态分流；②attended goal context 双入口显式绑定与下游 SSOT 零写盘；③跳板中性化、local-first、provenance 真值与 run_mode attach 门禁）。回归须覆盖：session↔process handoff 后 supervisor 判据随 owner 实时切换（不因任何冻结值失效）；`session/active|quiescing|released|orphaned_session` 均不 spawn、零事件，其中 orphan 只能显式 takeover；未完成 handoff no-op；`process/released + WAITING` 且同源 probe ready 仍进入既有核恢复；owner 缺失/损坏 fail-closed；`cwd=projectRoot` 起的 detach 孙进程存活；手动 `check-spec` 不被错绑到后台 active run；initializer 与 harness 对 run/feature/session owner/lease 的同一校验均 fail-closed；attended spec 产出 `execution_identity == run_id`、`requirement_provenance == goal_manifest` 的 SSOT 且 `.current-phase.json` 不被写活；同 run initializer 重入、reattach 与下游阶段均不改变 SSOT hash / `decision_id`（复现 20260815T112821Z-6cb1da 序列须 PASS）；bridge 跳板零身份行且不含 AskUserQuestion 文案；已有 local 时不再询问 `setup.adapter`；attended attach 缺 `--run-mode` 或传 `unattended` 均在 CAS 前失败，且不产生模式镜像事件。目标测试与 typecheck 后只在首次整批收口跑 `cd harness && npm test`、`npm run openspec:validate`、plan/version/diff 检查。**OpenSpec 最后一项保持不勾，直到宿主 smoke 全通过再 archive**——本批缺陷全部是单测未发现、宿主才暴露的：宿主 smoke 须含 attended run、unattended run、supervisor one-shot（active session 下不拉起）、project-root detach 四项。`host-runtime-truth`（c4e8a1f7）的 OpenSpec 6/7 同样保持不勾——本轮宿主 run 不构成其合法收口证据（理由见 §6）。"
    status: completed
overview: >
  2026-08-24 宿主 run `20260824T111324Z-1c659f`（Codex CLI，feature bc-openCard-1）在一次
  「开始吧」之后同时暴露三条互不相同的边界缺口，并已造成可观测损伤。其一，机器上遗留了一个
  2026-08-22 安装、每 5 分钟触发、未绑定 run_id 的 Windows 计划任务；supervisor 不读 run-control
  owner/lease，把一个 owner 持续续期的活 attended run 判成「进程已死」，连发三次 resume 直至
  重启预算耗尽，而三次 detached 子进程又全部因裸 `ts-node` 预加载按调用方 cwd 解析失败而胎死
  腹中——恢复链本身不可运行。其二，attended 路径从不注入 goal env，`isGoalOrchestrationEnv()`
  恒 false，导致既有十余处 goal 消费链整体失效：本次 spec 的 SSOT 落成阶段驱动身份
  `phase:bc-openCard-1:spec`（而 goal 门禁要求等于 run_id），`.current-phase.json` 被并行写活，
  goal 身份门在 attended 下整组是暗的。其三，宿主的技能发现把 `$goal-mode` 解析到
  `.agents\skills\goal-mode\SKILL.md`（generic 与 chrys 共享根，身份戳后写者赢，当前写着
  goal/headless 被明令拒绝的 chrys），`--select-adapter chrys` 真实执行了一次；本次靠
  `framework.local.json=codex` 按 `adapter_conflict` 挡住，首启无 local 时存在被错误初始化的
  风险，而该 run 的 `adapter_provenance` 也因入口硬编码写成了与事实不符的 `entry_declared`。
  用户全程未被询问运行方式，宿主自行判定「当前对话内有人在场」。本 plan 把 supervisor 收回
  unattended 责任域、让 attended 的 goal context 经协议显式绑定、把跳板身份中性化并让入口
  local-first。**明确不做**：不新增 `manifest.run_mode`（owner 动态、冻结即让合法 handoff 变
  drift）、不新增 active-run 扫描器、不在下游阶段重写 spec-owned SSOT、不新增账本或状态机。
isProject: false
---

# Goal 运行模式真值：监督边界、attended goal context 与跳板身份中性化（b7d2f4a1）

状态：**v4（吸收评审意见 3），待复评，未开工**

## 1. 一次 run 暴露的三条边界

三个现象是同一类失败：**框架把只存在于散文里的约定当成了已经生效的门禁，并且在两处把动态事实当成了可冻结的身份。**

```text
遗留计划任务（每 5min，无 run_id 绑定）
  → supervisor 不读 run-control owner/lease，只看 detached beacon
  → attended run 不写 beacon → 判「进程已死」→ 三次 resume → 预算耗尽
  → 三次 detached 子进程全部 Cannot find module 'ts-node/register/transpile-only'
  → events 被污染，恢复链本身不可运行

attended host bridge 请求 phase
  → 当前对话执行 phase（设计如此），但 goal env 从不注入
  → isGoalOrchestrationEnv() 恒 false
  → SSOT 落成 phase:<feature>:spec 身份 + .current-phase.json 被并行写活
  → goal 身份门在 attended 下整组是暗的

Codex UI 选 $goal-mode
  → 解析到 .agents\skills\goal-mode\SKILL.md（generic∪chrys 共享根，后写者赢 → chrys）
  → --select-adapter chrys 真实执行一次；靠 local SSOT=codex 挡住
  → 入口硬编码 adapter_provenance='entry_declared'，与事实（local_config）不符
  → 用户从未被问运行方式，宿主自行判定 attended
```

修复原则沿用 c4e8a1f7：**事实在哪一层形成，就在该层保留其身份和边界；不让 agent 猜、不靠宿主搬运数据、不把动态事实冻结成身份、不用散文替代门禁。**

## 2. 已核实事实

| # | 事实 | 证据 |
|---|---|---|
| 1 | 用户原话仅「…开始吧。」，未表达任何运行方式意图；宿主自行写成「先以当前对话内有人在场的方式推进」 | Codex rollout `~/.codex/sessions/2026/08/24/rollout-2026-08-24T19-10-22-01a03376-…jsonl:7` 与 `:51` |
| 2 | 同一条消息把 `$goal-mode` 指向 `…\.agents\skills\goal-mode\SKILL.md`，而非 `.codex\skills\goal-mode\SKILL.md` | 同 rollout `:7`（消息正文即含该绝对路径） |
| 3 | 宿主同时物化三份同名跳板，身份各异：`.agents`→chrys、`.codex`→codex、`.cursor/skills`→cursor | 宿主三文件第 8 行 |
| 4 | 按去重后的 `CommandExecution` 事件统计：`--select-adapter chrys` **1 次**（rollout:43）、`--select-adapter codex` **2 次**（rollout:56、:1538）。因 local 已有 codex，门禁按 `adapter_conflict` 尊重 local，未被覆盖 | 上述行的 `payload.item.type=CommandExecution`；宿主 `framework.local.json:3` |
| 5 | `.agents/skills` 同时是 generic 与 chrys 的 bundle 根；`renderBridgeSkillStubMarkdown` **只对 goal-mode 一个 skill** 注入 adapter 名 → 两 adapter 写同一文件、后写者赢 | `agents/chrys/adapter.yaml` `skill_bridge.target_dir`、`agents/generic/adapter.yaml`、`harness/scripts/utils/materialize-agent-bundle-skills.ts:42-66`、`harness/scripts/utils/init-task-executor.ts:331-345` |
| 6 | `agents/chrys/adapter.yaml` 自述「`.agents` 根下 bundle 仅 generic 与 chrys 字节一致、可幂等共存」——对 `goal-mode/SKILL.md` 为假 | 同文件 notes 段 |
| 7 | 现有共存单测取样为 `.agents/skills/**coding**/SKILL.md`（不带身份戳），唯一带戳的 goal-mode 零覆盖 | `harness/tests/unit/chrys-opencode-adapter.unit.test.ts:264-299` |
| 8 | chrys 在 goal/headless 被 `assertAdapterHeadlessFullPermission` 明令拒绝（BLOCKER） | `harness/scripts/utils/agent-invoke.ts:408-419`、`harness/scripts/utils/goal-preflight.ts:205-210` |
| 9 | Codex/Chrys/OpenCode 的 interaction renderer 是 **portable-only、不支持结构化 widget**——slash 模板的 `AskUserQuestion` 文案不可复制进其 bridge | `agents/codex/templates/rules/interaction-renderer.md:1,5` |
| 10 | `goal-mode-entry.ts` 参数表无 `run-mode`/`adapter-source`；`--prepare-run` 硬编码 `adapter_provenance:'entry_declared'`；host bridge 硬编码 `mode:'attended'` | `harness/scripts/goal-mode-entry.ts:235,320,336,349` |
| 11 | 结果：本次 manifest 写成 `adapter: codex / adapter_provenance: entry_declared`——但 entry 声明的是 chrys，codex 取自 local SSOT。schema 枚举中本就有对应的真值 `local_config`；该字段**本次为假**，且当前入口结构上无法可靠证明来源（匹配时并非必然为假） | 宿主 `manifest.json`；`workflows/goal-manifest.schema.yaml` `adapter_provenance` enum |
| 12 | attended 路径从不注入 goal env；`MAISON_GOAL_RUN_ID` / `MAISON_GOAL_RUNNER` 仅由 goal-runner 注入 | `harness/scripts/goal-runner.ts:958,6233`；`harness/scripts/utils/phase-state.ts:113-117`；`goal-mode-entry.ts` 全文无注入 |
| 13 | 后果一：本次 spec 的 SSOT 落成阶段驱动身份 `execution_identity:"phase:bc-openCard-1:spec"`、`requirement_provenance:"explicit_cli"`；而 `check-spec` 在 goal 环境下要求 `execution_identity === goalRunId` | 宿主 `spec/reports/fidelity-intent.json`；`harness/scripts/check-spec.ts:226-236`；`harness/scripts/fidelity-intent-init.ts:106,125` |
| 14 | 后果二：`mergeAndWritePhaseState` 的抑制条件是 `isGoalOrchestrationEnv()`，attended 下恒 false → `.current-phase.json` 被并行写活（本次 `spec/running`，11:27:58Z） | `harness/scripts/utils/phase-state.ts:176`；宿主 `framework/harness/state/.current-phase.json` |
| 15 | 「是否在 goal run 内」的既有消费面远不止三处：`isAgentSideGoalHarness()` 已按 `MAISON_GOAL_RUN_ID` / `ATTEMPT` / `ATTEMPT_PHASE` / orchestration 取并集，`harness-runner.ts` 自身有 ≥8 处消费——逐文件补扫描器必然漏 | `harness/scripts/utils/phase-state.ts:134-142`；`harness/harness-runner.ts:184,781,962,1092,1106,1591,1654` |
| 16 | **owner 是动态事实，不得冻结进 manifest**：同一 run 可 session↔detached mailbox handoff，`resolveRunOwnerKind()` 已是 `can_prompt_now` 的唯一 SSOT，注释明写「冻结会让合法 handoff 变 drift」 | `harness/scripts/utils/phase-state.ts:145-172`；`skills/project/goal-mode/SKILL.md:43` |
| 17 | run-control owner 状态全集为 `active \| quiescing \| released \| orphaned_session`，非二值 | `harness/scripts/utils/goal-run-control.ts:9` |
| 18 | `manifest.unattended` 是**必填**字段（`UnattendedContract`，非 optional），且是 handoff 到 detached 后的执行契约——attended run 不得删 | `harness/scripts/utils/goal-manifest.ts:105` |
| 19 | **下游阶段重写 spec-owned SSOT 是已冻结事故**：`fidelity-intent.json` / `capability-snapshot.json` 由 spec closure 冻结进 evidence manifest，链首非 spec 必须零写盘只读复用，否则 spec closure 立即 stale → 收尾 assess 推荐 rerun spec → 本链无路由 → framework_bug halt | `harness/scripts/utils/goal-preflight.ts:653-665`（宿主实锤 run `20260815T112821Z-6cb1da`） |
| 20 | Windows 计划任务 `\MaisonGoalSupervise_bc-openCard-1` 自 2026-08-22T14:05 起每 5 分钟运行，参数 `--feature bc-openCard-1`，**无 `--run-id` 绑定**（恒监督该 feature 的最新 run） | `schtasks /Query /TN … /XML`：`StartBoundary 2026-08-22T14:05:00`、`Interval PT5M` |
| 21 | `goal-supervise.ts` / `goal-supervisor.ts` 全文**不读 run-control**，只看 events + detached beacon + guardian；attended run 不写 beacon | 两文件 `grep readRunControl\|run-control.json` 为空 |
| 22 | 现有 supervisor **刻意对 `no_op` 零落盘**（注释已记：feature 级计划任务不随 run 完成消失，每 5 分钟一条 = 每天 288 条零信息事件，且都在 run_end 之后）；非 owner 禁写该 run events 亦是既有硬边界 | `harness/scripts/goal-supervise.ts:254-262`；`skills/project/goal-mode/SKILL.md:65` |
| 23 | 实际后果：11:15:03 / 11:20:34 / 11:26:04 三次 `supervisor_restart(action=resume, reason="beacon 陈旧（进程已死）")`，11:30:04 `restart_budget_exhausted`；同期 run-control owner 一直是 `session/active` 且 lease 持续续期 | 宿主 `events.jsonl:2-8`、`run-control.json` |
| 24 | 该 run 在被三次判死之后仍持续存活并逐轮推进（spec 两轮 PASS → plan → coding），lease 全程续期——supervisor 的死亡判定与 run 的真实活性直接矛盾，是第 21/23 条的行为级实锤 | 宿主 `events.jsonl:9-`、`run-control.json` |
| 25 | 三次 resume 全部 stillborn：`Cannot find module 'ts-node/register/transpile-only'`（detach.log 66 行，同一 trace 3 次） | 宿主 `detach.log` |
| 26 | 根因：supervisor 以 `cwd: projectRoot` 拉 goal-runner `--detach`，`runDetachLauncher` 再以裸 specifier `-r ts-node/register/transpile-only` + `cwd: process.cwd()` 二次 fork；node 的 `-r` 裸模块按 cwd 解析，宿主工程根按依赖契约不装 framework runtime | `harness/scripts/goal-supervise.ts:369-374`、`harness/scripts/goal-runner.ts:3656-3670` |
| 27 | 本机实测复现：项目根下 `node -r ts-node/register/transpile-only -e 0` 报同一错；`framework/harness` 下同一条 OK。正确范式就在同一调用点隔壁——supervisor 自身用 `require.resolve('ts-node/dist/bin.js')` | 本轮实测；`harness/scripts/goal-supervise.ts:369` |
| 28 | `personal-setup-gate.md` 指向「goal-mode SKILL §运行身份」，该节实际在 `goal-mode-operations.md:5`；`goal-mode/SKILL.md` 全文 67 行无此节（悬空引用） | 两文件 |
| 29 | 本轮**已验证生效**的两项（c4e8a1f7 T1/T2）：实际启动 adapter 为 codex；`requirement_source_files` 正确保留原始需求路径且三张同目录参考图被发现并读取 | 宿主 `manifest.json`、`spec/reports/fidelity-intent.json` |
| 30 | attended spec 的真实写入顺序是 Skill 在生成 spec 前先调用 `fidelity-intent-init`，而 initializer 即使读到 goal env 仍固定写 `execution_identity=phase:<feature>:spec`、`requirement_provenance=explicit_cli`；只给后置 harness 注入 goal env 无法修正已写错的 SSOT | `skills/feature/spec/SKILL.md:39`；`harness/scripts/fidelity-intent-init.ts:106,124-129`；宿主 `fidelity-intent.json` |
| 31 | owner 的 `released` 不是 run 终态：本次宿主 run-control 已是 `session/released`，events 最后仍为 review `INCOMPLETE/halt`，明确等待回 coding 或人工确认；终态只能取 `run_disposition`，不能由 owner state 或未闭合 invoke 数量推导 | 宿主 `run-control.json`、`events.jsonl:19`；`harness/scripts/utils/goal-supervisor.ts` |

## 3. 已定裁决

1. **owner 是动态事实，不进 manifest、不进 identity。** 当前运行模式恒由 `run-control.owner.kind` 派生（既有 `resolveRunOwnerKind` 即 SSOT）。冻结会让合法 handoff 变 drift，也会让 supervisor 永不恢复一个 handoff 后真已无人值守的 run。
2. **运行方式选择与运行状态分责。** 歧义时是否询问用户仍由 Skill 的 `goal.run_mode` registry 契约负责；`--run-mode attended` 只是 caller declaration / 启动期显式断言，不能证明用户真的被问过。attended attach 在 CAS 取得 owner 前强制校验，缺失或传 `unattended` 均失败；不新增复制 owner 状态的 `run_mode_declared` 事件。
3. **goal context 靠协议显式绑定，不靠扫描。** `phase_execute_request` 携带权威 `run_id`，spec Skill 将它同时绑定到真实 SSOT 写入点 `fidelity-intent-init --goal-run-id` 与后置阶段入口 `harness-runner --goal-run-id`；两入口共用同一精确 run / feature / session owner / lease 校验。**明确否决**「扫描 feature 下 active run 自动认领」——手动跑同 feature 的 harness 会被错绑，多 active run 时无唯一解；也否决「让宿主自己 export env」——那是宿主搬运数据。
4. **复用既有 env 链，不逐文件补判定。** 一处注入让 `isGoalOrchestrationEnv` / `isAgentSideGoalHarness` / `resolveRunOwnerKind` / `mergeAndWritePhaseState` 等既有消费面整体生效，包括事实 #14 的 `.current-phase.json` 抑制。
5. **spec-owned SSOT 的写者边界不动。** 仍由既有 initializer 单点写入；attended goal 分支从 manifest 取 requirement / adapter / 来源列表并写 goal 身份，同 run 有效 SSOT、reattach 与下游阶段全部零写盘只读复用。
6. **supervisor 只对 process owner 负责，且 session 分支零落盘。** session 的 active/quiescing/released/orphaned_session 都不自动 spawn、不写事件；released 可供 attended bridge reattach。非 orphan 的 session→process 正常转换只走 mailbox handoff；orphan 仅可由用户显式授权 `--force-resume` 做 epoch takeover，supervisor 永不得触发该例外。process owner 才进入既有 beacon × `run_disposition` 核；quiescing / 未完成 handoff 优先 no-op，owner 缺失/损坏 fail-closed。
7. **skills-bridge 全面中性化。** 不注静态身份（共享根结构上不可能为真，独占根也只会与 local SSOT 争权威），不复制 slash 模板的交互 BLOCKER（各 adapter 的 renderer 能力不同，Codex/Chrys/OpenCode 为 portable-only）。
8. **入口 local-first。** 已有合法 local 直接用 `activeAdapter`，不构造 `requestedAdapter`、不重复询问；无 local 才走单候选自动/多候选 registry。
9. **provenance 说真话或省略。** `adapter_provenance` 取自 personal setup 真实来源（本次正解 `local_config`）；拿不到即省略（schema 已允许缺省）或 BLOCKER，**不新增 `unknown` 枚举**。
10. **detached launcher 复用绝对 runtime。** 不从调用方 cwd 解析裸 `ts-node`。

## 4. 明确裁剪

- 不新增 `manifest.run_mode`、不改 manifest schema、不入 identity hash；不删 attended manifest 的 `unattended` 块。
- 不新增 active-run 扫描器、第二套活性状态、新账本或平行 verifier。
- 不在下游阶段重写 fidelity-intent / capability-snapshot。
- 不给 supervisor 的 `no_op` 分支增加事件写入。
- 不新增 `adapter_provenance` 枚举值。
- 不新增 `run_mode_declared` 或 `decided_by` 自报事件；运行状态继续只读 `run-control.owner.kind`。
- 不由框架自动安装/删除/修改 Windows 计划任务；其生命周期仍属操作者手动范畴（既有 `--install-schtasks` / `--uninstall-schtasks` 口径不变）。
- 不在本 plan 内规定任何宿主侧的 run 恢复、清理或重跑步骤。
- 不改 attended「当前对话执行 phase」的执行模型；phase context 隔离性另开议题。
- **不处理但记录在案**：attended 的 in-session 准入门用 `loadGoalCapability(adapter)` 的 `in_session_reconcile` / `phase_context_isolation` 判定宿主会话能否跑 phase（`goal-in-session-driver.ts:167-171`）。这两个字段本就是为 in-session 语义设计的，判定本身合法；但它描述的是 **adapter**，而 attended 的执行者是**宿主 CLI**——二者在「宿主 Cursor + local adapter=codex」这类合法配置下并不同一。本次 host==adapter==codex 故未暴露。属独立议题，本 plan 不动。
- 不借机改 monitor/熔断口径、OCR、review/UT 耗时。
- 不回退本轮已验证生效的 c4e8a1f7 T1/T2。

## 5. 实施与提交边界

```text
OpenSpec delta
  → T1 P0：监督边界（session 全状态零介入；process 才进 run_disposition 核）
           + detached runtime 绝对路径
  → T2 P0：attended goal context（phase_execute_request 带 run_id
           + initializer / harness 双入口共享校验
           + goal SSOT 真值写入 + 下游零写盘）
  → T3 P1：bridge 中性化 + local-first personal setup + provenance 真值
           + run_mode attach 入口断言（无镜像事件）
  → T4：回归 + 宿主 smoke（attended / unattended / supervisor one-shot / project-root detach）
  → 四项 smoke 全通过后才 OpenSpec archive
```

T1 两处虽在不同文件，但同属「后台恢复链」一条因果链且都是小改，合并提交；T2/T3 按责任边界分别提交。**OpenSpec 最后一项在宿主 smoke 前保持不勾**——本批缺陷全部是单测未发现、宿主 smoke 才暴露的，与 `host-runtime-truth` 同一处置。实施阶段只允许更新本 plan 的 todo 状态与实施记录，不改写上述裁决。

## 6. 对 host-runtime-truth（c4e8a1f7）收口的判定

本轮 run **不能**作为 c4e8a1f7 的宿主回灌收口证据，其 OpenSpec 6/7 保持不勾。理由：

- 运行方式未经用户确认，run 的模式本身不是被选择的结果；
- 入口跳板身份错误，`--select-adapter chrys` 真实执行过一次；
- 不是计划中的干净无人值守 Codex smoke（attended 路径 headless invoke 根本未发生）；
- supervisor 已插入三次虚假 resume，events 被污染、该 run 重启预算清零；
- detached 恢复链本身不可运行。

同时确认 c4e8a1f7 的两项修复在本轮**确已生效**（事实 #29），这部分事实可以保留，不必重测。

## 7. v1 → v2 review 吸收

1. **[P0] 撤回 `manifest.run_mode`**。原设计与 `phase-state.ts:145-172` 的既有裁决（plan a5f9c3e2）正面冲突：owner 动态、可 handoff，冻结即 drift；且新增必填字段而不升 schema 会破坏旧 run resume。改为运行状态恒由 `run-control.owner.kind` 派生，用户授权改由入口侧 `--run-mode` + `run_mode_declared` 事件承接（事件非身份）。attended manifest 的 `unattended` 块由「拟删除」改为**必须保留**（必填字段 + handoff 后执行契约）。
2. **[P0] 撤回 `resolveActiveGoalRunId` 扫描器与「每轮重建 SSOT」**。前者会把手动 harness 调用错绑到后台 run 且多 active run 无唯一解；后者复活 `goal-preflight.ts:653-665` 已冻结的事故（下游重写 → spec closure stale → framework_bug halt）。改为协议显式传 `run_id` + `harness-runner --goal-run-id` 注入既有 env 链，SSOT 仅 spec 起点初始化。同时补上 v1 漏掉的闭环：事实 #14 的 `.current-phase.json` 由同一注入点顺带修复，不再逐文件补判定。
3. **[P1] 撤回 supervisor 的 `no_op` 事件写入**。`goal-supervise.ts:254-262` 已刻意零落盘（288 条/天零信息事件），且非 owner 禁写。判据同时从「active 且 lease 新鲜」扩到 owner 全状态（`active/quiescing/released/orphaned_session` + 缺失/损坏 fail-closed）。
4. **[P1] 撤回 bridge 注入 slash BLOCKER**。Codex/Chrys/OpenCode 的 renderer 是 portable-only，复制 `AskUserQuestion` 文案会制造新冲突。改为全面中性化 + 至多一条与渲染方式无关的中性提示；解析阶梯改 local-first（已有 local 不再询问 `setup.adapter`）。`adapter_provenance` 缺省由「写 `unknown`」改为「省略或 BLOCKER」——schema 枚举无该值且字段本就可缺省，本次正解是既有的 `local_config`。
5. **[P1] 修正事实计数**。`--select-adapter` 按去重后的 `CommandExecution` 事件为 chrys 1 次 / codex 2 次；v1 的 `grep -o` 把 tool_call、执行事件与输出中重复序列化的同一条命令算成了 3/3。`adapter_provenance` 的表述由「结构上恒为谎」改为「本次为假、当前入口无法可靠证明来源」。
6. **[P1] archive 门禁**。实施图由「代码验收后直接 archive」改为「四项宿主 smoke 全通过后才 archive」。
7. **裁剪**。删除 v1 事实 #15（capability 声明实体错配）——判定本身合法，改列入 §4「不处理但记录在案」；删除 v1 事实 #23 的字面 BLOCKER 数量比较（随 bridge 中性化裁决失去用途）；悬空文档引用（事实 #28）降级为 T3 顺手一行修复。任务由五项并为四项。

## 8. v2 → v3 review 吸收

1. **[P0] T2 前移到真实 SSOT 写入点。** v2 只给后置 `harness-runner` 绑定 run_id，漏掉 spec Skill 在产物生成前先调用 initializer 的时序，无法阻止它先写出 phase identity。v3 让 `phase_execute_request.run_id` 同时透传到既有唯一 initializer 与 harness；二者共用同一精确 run / feature / session owner / lease 校验。initializer goal 分支从 manifest 读取 requirement / adapter / 来源列表并写 `execution_identity=run_id`、`requirement_provenance=goal_manifest`；有效同 run SSOT 只读复用，不新增 bridge 侧写者。
2. **[P0] owner state 不再冒充 run 终态。** 宿主 `session/released` + review `INCOMPLETE` 已直接否定 v2 的「released + 无未闭合 invoke = 终局」。v3 明确 session owner 全状态均由 supervisor 零介入，released 允许 attended reattach，orphan 只允许操作者显式 takeover；process owner 才进入既有 beacon × `run_disposition` 核。`TERMINAL` 仍只有一处真源，不从 owner / invoke 派生。
3. **[P1] 删除模式镜像事件。** 保留 `--run-mode attended` 作为 attach 启动期断言，CAS 前 fail-fast；删除 `run_mode_declared.decided_by`。CLI flag 无法证明用户被问过，prepare/attach 又是两个进程，继续补事件来源与去重只会增加平行状态。用户选择由 Skill registry 契约负责，实际运行状态由 `run-control.owner.kind` 负责。
4. **保持其余边界不扩面。** `manifest.run_mode`、active-run 扫描、下游 SSOT 重建、supervisor no_op 事件、bridge 交互模板复制仍全部撤回；OpenSpec archive 与宿主 smoke 门禁不变。

## 9. v3 → v4 review 吸收

1. **[P1] 补全 orphan takeover 例外。** v3 同时写了「orphan 允许显式 takeover」与「session→process 只能走 mailbox」，文字契约互相冲突。v4 将正常转换限定为**非 orphan** 状态只走 mailbox；仅 `orphaned_session` 可在用户显式授权后复用既有 `--force-resume` / `forceTakeoverRunOwner` 做 epoch takeover，且 supervisor 永不得触发。实施同步修正 `goal-mode` Skill 的同一句；既有 T4 已覆盖 orphan 显式接管，不新增机制或测试项。

## 实施记录

- 日期：2026-08-24。
- 实施结果：T1–T4 全部完成；四项消费者布局宿主 smoke（attended、unattended、active-session supervisor one-shot、project-root detach）全部通过。
- 验收：`cd harness && npm test`（3478 unit、44 fixtures）、目标测试、`npm run typecheck`、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`、`git diff --check` 均通过。
- OpenSpec：`goal-mode-attended-runtime-truth` 已同步 4 个 capability（新增 5、修改 5）并归档为 `openspec/changes/archive/2026-08-24-goal-mode-attended-runtime-truth/`。
- 发布门禁：已执行强制 `npm run release:verify`；本次代码、类型与规则检查通过，发布窗口检查仍被两个按既有计划保持未完成的 3.0.0 plan 阻塞（`c7e4a2d9`、`c4e8a1f7`），未越权代为收口。
- 偏离：无实现范围偏离；上述发布窗口阻塞是仓库既有未完成计划，不影响本 change 的 smoke 后归档裁决。

### 2026-08-24 归档后复审返修

- 复审发现 attended 请求只绑定 `run_id`，缺少 attempt/gate authority 与 owner epoch fence，真实 receipt/sync closure 未被宿主 smoke 覆盖；同时发现 attach adapter 可与 manifest 分裂、supervisor 未复用 canonical handoff validator、provenance 枚举重复。
- 已恢复同一个 OpenSpec change，T1–T4 按责任重新打开；保持不新增 manifest 字段、场外状态、平行 runner 或第二套 handoff parser。

### 2026-08-25 复审返修收口

- attended phase request 已显式绑定 `run_id + phase + attempt_id + owner_id/epoch`；initializer、harness 与 sync-closure 共用 fenced owner 校验，并复用既有 receipt scaffold、goal attempt env 与 gate authority。真实 E2E 已闭合 receipt，验证正式视觉/device writer 路由、`.current-phase.json` 抑制、fidelity hash 稳定及旧 epoch 拒绝。
- attach adapter 在 owner CAS 前与 manifest 对账，后续只传播 manifest adapter；supervisor 复用 canonical handoff validator；adapter provenance 直接复用 manifest SSOT 枚举。
- 验收：`cd harness && npm test`（3483 unit、44 fixtures）、`npm run openspec:validate`（42/42）、plan/version/diff 检查，以及消费者布局 attended、unattended、active-session supervisor one-shot、project-root detach 四项 smoke 均通过。
- 发布门禁已执行；首次运行仅额外报告本 plan 尚为 `in_progress`，本记录完成并勾选后复跑确认只剩仓库既有 `c7e4a2d9`、`c4e8a1f7` 两项窗口阻塞。
- OpenSpec：四项 rebased delta 已同步回主规格，同一个 `goal-mode-attended-runtime-truth` change 重新归档至 `openspec/changes/archive/2026-08-24-goal-mode-attended-runtime-truth/`。

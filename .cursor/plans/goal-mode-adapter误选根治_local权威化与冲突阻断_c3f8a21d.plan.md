---
name: goal-mode adapter 误选根治 · framework.local.json 权威化 / 冲突阻断 / 解析阶梯厘清 / cursor 跳板可发现性
version: 2.4.0
overview: >
  现象（用户 2026-06-29）：宿主 SimulatedWalletForHmos 接入最新 framework 后，`framework.local.json` 明写
  `agent_adapter: cursor`、用户也在 Cursor 窗口跑 goal-mode，但 goal-run（20260629T045113Z）manifest 却是
  `adapter: "claude"`。
  先厘清（对第一份外部判断"框架写死 claude"的证伪 + 对 Cursor 自查的采纳）：**框架没有把 cursor 写死成 claude**。
  `.cursor/skills/goal-mode/SKILL.md:8` 正确声明 `RESOLVED_ADAPTER：cursor`；`.claude/commands/goal-mode.md:10`（claude）
  是 Claude 自己的 slash 文件、**本就该是 claude、文件没错**。真正的问题不在该文件，而在 **Cursor runtime 在多 adapter
  同名产物（.cursor/skills · .claude/commands · .codex/skills 同名 goal-mode）并存时选错了 command 来源**（误读
  `.claude/commands/goal-mode.md` 当 `/goal-mode` 注入）—— 此点经 Cursor 自查确认，见 §七 / G6。
  真因＝**三层脱节，每层都该拦却都没拦**（全部对 ground-truth 实测）：
    ① 触发：Cursor agent 把 `RESOLVED_ADAPTER` 硬猜成 claude。[goal-runner.ts:823](../../harness/scripts/goal-runner.ts:823)
       `adapter: argv.adapter ?? cfg.agent_adapter`；local.json 是 cursor，若 agent 未传 `--adapter` 结果应为 cursor →
       manifest=claude 反推 **agent 显式传了 `--adapter claude`**（违反 SKILL 解析阶梯第 3 条"永不硬猜"）。诱因：cursor
       adapter `commands: null`、goal-mode 只物化在 `.cursor/skills/`（无 slash），Cursor 很可能没把跳板里
       `RESOLVED_ADAPTER：cursor` 喂进 agent，agent 读中性 framework SKILL 拿不到身份就按默认偏好猜了 claude。
    ② 该拦没拦：`check-personal-setup` 静默吞冲突。[personal-setup-gate.ts:545-548](../../harness/scripts/utils/personal-setup-gate.ts:545)
       `ensurePersonalSetup` **gate.ok 即 return，`selectAdapter` 只在 fallback（local 未设 agent_adapter）分支才生效**
       （[:449-457](../../harness/scripts/utils/personal-setup-gate.ts:449)）。宿主 local 已是合法 cursor → gate ok →
       `check-personal-setup --select-adapter claude` 返回 `ok / activeAdapter=cursor`，**默默丢掉 claude、且不报 claude≠cursor 冲突**
       （local.json 因此也没被改，仍是 cursor）。agent 没收到"猜错了"的信号。
    ③ 该拦没拦：goal-runner/preflight 信猜测、不信 SSOT。[goal-preflight.ts:106-108](../../harness/scripts/utils/goal-preflight.ts:106)
       一旦 `--adapter`/manifest 带 adapter（provenance=argv_adapter|manifest_adapter）即 `prereqs.delete('agent_adapter')`——
       **显式跳过对 framework.local.json agent_adapter 的校验**；叠加 :823 的 `argv.adapter ?? cfg.agent_adapter`，agent 的猜测
       直接盖过用户记录的 cursor、无任何对账写进 manifest 跑起来。
  一句话：用户没做错（local=cursor、在 Cursor 跑），坏在框架把"agent 的猜测"一路信到底，而 `framework.local.json` 里那条
  cursor 在关键路径上从未被当作权威去对账。
  方向（待 review 后实施）：让 **`framework.local.json agent_adapter` 成为运行身份的权威 SSOT**——猜测/`--adapter` 与其冲突即
  STOP，显式覆盖须留痕；解析阶梯只产 requested、effective 身份以 local 为准（不把 local 塞进阶梯），并堵 cursor 跳板身份信号缺失。
  约束：framework-only；不改宿主业务码；不 bump 版本（2.4.0 未发布窗口）；跨宿主中性，**不得硬编码 claude/cursor**；
  goal 与普通模式能力拉齐；出口用本案坏态（local=cursor + 传/记 claude）做回归夹具——冲突须被拦、一致须放行、首次显式仍可用。
todos:
  - id: G1-goalrunner-local-authoritative
    content: >
      【P1 · 承重】goal-runner/preflight 让 framework.local.json agent_adapter 权威化，`--adapter`/manifest 与其冲突即 BLOCKER STOP。
      病灶：[goal-preflight.ts:106-108](../../harness/scripts/utils/goal-preflight.ts:106) 在 provenance=argv_adapter|manifest_adapter 时
      `prereqs.delete('agent_adapter')` 跳过 local 校验；[goal-runner.ts:823](../../harness/scripts/goal-runner.ts:823)
      `argv.adapter ?? cfg.agent_adapter` 让猜测优先于 local SSOT（cfg 由 [:795 loadFrameworkConfig](../../harness/scripts/goal-runner.ts:795) 合并 local 得来）。
      改造（review#2：保留 raw 冲突事实、冲突前置于 manifest 构造）：
        (1) **保留原始值、先对账后构造 manifest**：在 [buildGoalManifestFromInput](../../harness/scripts/goal-runner.ts:817)（`adapter: argv.adapter ?? cfg.agent_adapter`）**之前**捕获 `requestedAdapter`(原始 argv/manifest，不归一)、`localAdapter`(framework.local.json agent_adapter)、`override`(--override-adapter)。**冲突时不得构造/写 manifest**（断言）——否则先归一成 local 再 preflight，会把「argv=claude / local=cursor」的冲突事实擦掉。
        (2) **effective 判定**：`effectiveAdapter = override ? requestedAdapter : (localAdapter 合法 ? localAdapter : requestedAdapter)`。冲突＝`requestedAdapter && localAdapter 合法(∈materialized+入口在) && requestedAdapter≠localAdapter && !override` → **BLOCKER STOP**，文案点名「local 记录 cursor，本次却用 claude；请改 local 或加 --override-adapter」。localAdapter 缺省（首次）→ requested 即新身份；requested==local → 放行。**requested 与 localAdapter 皆缺（无 argv/manifest/local）→ BLOCKER STOP、不写 manifest、不落回 cfg.agent_adapter 默认**（永不默认；交互态走 registry 选择）。
        (3) preflight 不再无条件 `delete('agent_adapter')`（[goal-preflight.ts:105-108](../../harness/scripts/utils/goal-preflight.ts:105)）：把 requestedAdapter/localAdapter/override 传入 preflight 做上面对账；通过后再让 buildGoalManifestFromInput 用 `effectiveAdapter` 构造 manifest。`--manifest`/`--resume`(manifest_adapter) 同样纳入对账。
        (4) `--override-adapter`：goal 流程内**唯一**允许写 local 的显式例外——经 **writeLocalConfig / record-adapter 同一语义**回写 `agent_adapter=requestedAdapter` 并汇报留痕；普通冲突（无 override）**不碰盘**、只 STOP（与 G2 统一）。**前置条件**：`--override-adapter` 须同时存在非空/合法/已物化入口存在的 requestedAdapter，否则无目标可回写 → **BLOCKER**（禁误用 fallback 兜底）。
        (5) manifest 写 `effectiveAdapter` + `adapter_provenance`（user_explicit|entry_declared|override|local_config|registry，见 G5）。
      边界：只动运行身份对账，不碰 capability 校验其余逻辑。两模式统一。
      触点：goal-preflight.ts、goal-runner.ts、goal-manifest-cli.ts（override 透传）、harness/tests/unit。
    status: completed
  - id: G2-personal-setup-adapter-conflict
    content: >
      【P1 · 承重】check-personal-setup 增加 `adapter_conflict` 码：`--select-adapter X` ≠ 既有合法 `agent_adapter Y` 时显式返回冲突，不再静默 ok=Y。
      病灶：[personal-setup-gate.ts:545-548](../../harness/scripts/utils/personal-setup-gate.ts:545) gate.ok 即 return，
      selectAdapter 仅 fallback 生效（[:449-457](../../harness/scripts/utils/personal-setup-gate.ts:449)）→ 既有 cursor 时传 claude 被默默吞、无冲突信号。
      改造：
        (1) ensurePersonalSetup：gate.ok 分支增加判定——options.selectAdapter 提供、且 ≠ 既有 activeAdapter（local agent_adapter）、且既有为合法记录 →
            返回 ok:false + 新码 `adapter_conflict`（带 activeAdapter=既有、requested=selectAdapter、materializedAdapters、清晰 message）；selectAdapter==既有 → 正常 ok。
        (2) [PersonalSetupEnsureCode](../../harness/scripts/utils/personal-setup-gate.ts:79) 加 `'adapter_conflict'`；gateResultToEnsureJson 映射；
            [check-personal-setup.ts](../../harness/scripts/check-personal-setup.ts) stdout 分流暴露该码。
        (3) 切换路径（与 G1(4) 统一去矛盾）：永久换 → registry `setup.adapter` 重选 + `init-orchestrate --scope personal record-adapter` 改写 local；本次即时换 → `--override-adapter`（经同一 writeLocalConfig 留痕，是 goal 流程内**唯一**写 local 的显式例外）。普通冲突一律不写盘、只报冲突。
      边界：不改 fallback（local 未设时 selectAdapter 仍自动写）；只在"既有合法且冲突"时升冲突。两模式统一。
      触点：personal-setup-gate.ts、check-personal-setup.ts、harness/tests/unit。
    status: completed
  - id: G3-skill-resolution-ladder-harden
    content: >
      【P2】goal-mode SKILL 解析阶梯厘清：阶梯只产 requested、effective 以 local 为准（不把 local 塞进阶梯），传值用 check-personal-setup 的 activeAdapter（权威），禁默认 claude。
      病灶：[goal-mode/SKILL.md:32-38](../../skills/project/goal-mode/SKILL.md:32) 阶梯为 1 用户显式 / 2 跳板声明 / 3 registry 兜底；
      未把"已记录的 framework.local.json agent_adapter"列为高优先权威；且启动命令 `--adapter <RESOLVED_ADAPTER>`（agent 自解析）易被未对账的猜测污染。
      改造：
        (1) §运行身份阶梯厘清（review#2）：阶梯（用户显式 > 跳板声明 > registry 交互，**永不默认 claude/cursor**）只产出 `requestedAdapter`；**不把 local 当阶梯一级**。已有合法 `framework.local.json agent_adapter` 时，effective 身份**仍以 local 为准**，除非 `--override-adapter`——免得文档层诱导 agent 传错 `--adapter`。
        (2) §Agent 必须执行：明确 goal-runner 的 `--adapter` 必须取 check-personal-setup 返回的 `activeAdapter`（权威值），
            **不得**直接用 agent 自己的 RESOLVED_ADAPTER 猜测；收到 `adapter_conflict`（G2）须 STOP 对账后再启动。
        (3) 跨宿主中性复核：正文不得出现硬编码 claude/cursor（保持现状），仅以变量/阶梯描述。
      边界：纯 skill 文档，不碰执行体；与 G1/G2 门禁配对（文案互指）。
      触点：skills/project/goal-mode/SKILL.md、skills/reference/personal-setup-gate.md（如需对齐码表）。
    status: completed
  - id: G4-cursor-bridge-discoverability
    content: >
      【P3 · 触发缓解 · 含调查】堵 cursor 下 RESOLVED_ADAPTER 身份信号缺失（agent 拿不到跳板身份才硬猜）。
      现状：cursor adapter [adapter.yaml](../../agents/cursor/adapter.yaml) `commands: null`、goal-mode 仅物化 `.cursor/skills/goal-mode/SKILL.md`（无 slash）；
      `.cursor/rules/framework.mdc` 为总规则索引、AGENTS.md 为入口。Cursor 是否把跳板的 `> 运行身份（RESOLVED_ADAPTER）：cursor` 行可靠喂进 agent 上下文＝触发关键，但属 Cursor 内部行为、需先调查。
      改造（调查后择一/组合，低置信先 WARN/文档）：
        (1) 调查：实测 Cursor 触发 `.cursor/skills/goal-mode/` 时是否注入跳板正文（含 RESOLVED_ADAPTER 行）；落结论到 docs/operations/goal-mode-runbook。
        (2) 若不可靠：在 `.cursor/rules/framework.mdc`（rules 模板）或 AGENTS.md 注入一条常驻规则——"goal 启动须以 framework.local.json agent_adapter 为运行身份权威，不得臆测"；让身份不依赖跳板是否被注入。
        (3) 兜底已由 G1/G2 提供（即便触发层漏注入，local 权威化也会拦下错 adapter）——本项目标是减少触发，不是唯一防线。
      边界：不改 Cursor 本身；framework 侧只动 rules/AGENTS 模板与文档；以 G1/G2 为硬兜底。
      触点：agents/shared/agent-bundle/templates/rules/、templates/AGENTS.md.template、docs/operations/goal-mode-runbook.md。
    status: completed
  - id: G5-regression-fixtures-and-tests
    content: >
      【出口 · 防复发】用本案坏态做回归夹具/单测。
        (1) personal-setup-gate 单测：既有 local agent_adapter=cursor + selectAdapter=claude → `adapter_conflict`（ok:false）；selectAdapter=cursor → ok；local 未设 + selectAdapter=claude → 自动写 claude(ok)。
        (2) goal-preflight 单测：local=cursor + argv adapter=claude（无 override）→ BLOCKER STOP；+ --override-adapter → 放行；local=cursor + argv=cursor → ok；local 未设 + argv=claude → ok（首次显式）；**local 未设 + 无 argv/manifest/requested → BLOCKER STOP、不写 manifest（永不默认反面测）**；**--override-adapter 但无 requested → BLOCKER（无回写目标）**。
        (3) goal-runner manifest 构建：local=cursor 无 override 时 manifest.adapter=cursor（不被 argv claude 污染）；override 时=claude 且留痕。
        (4) 诚实化（决策·纳入）：manifest 增 `adapter_provenance`（user_explicit|entry_declared|override|local_config|registry）。**须同步改 schema + loader**（review#2）：[workflows/goal-manifest.schema.yaml](../../workflows/goal-manifest.schema.yaml) 字段定义 + [goal-manifest.ts](../../harness/scripts/utils/goal-manifest.ts)（interface GoalManifest:29 / buildGoalManifestFromInput:128,160 读写 + 旧 manifest 无字段兼容），否则只写进 JSON、文档契约没跟上。补单测。
      验证：npm test 全绿（现 1203 unit / 35 fixtures 基线）；新夹具坏态被拦、一致/首次/override 放行。
      边界：framework 侧加夹具与单测；不需宿主回灌（纯配置/解析逻辑，单测可全覆盖）。
      触点：harness/tests/unit/personal-setup-gate*.unit.test.ts、goal-preflight/goal-runner 相关单测、harness/tests/run-unit.ts。
    status: completed
  - id: G6-cursor-command-artifact
    content: >
      【P2 · 触发面根治（Cursor 自查结论新增·待开工）】消除"多 adapter 同名产物碰撞 → Cursor 注入 .claude/commands(claude) 当 /goal-mode"。
      病灶（已核实磁盘事实）：cursor adapter [adapter.yaml](../../agents/cursor/adapter.yaml) `commands: null` → 无 `.cursor/commands/goal-mode.md`；
      宿主同时存在 `.cursor/skills/goal-mode/SKILL.md`(cursor) / `.claude/commands/goal-mode.md`(claude) / `.codex/skills/goal-mode/SKILL.md`(codex) 三个同名产物。
      Cursor 的 `/goal-mode` Command 通道因本 adapter 无 command 产物 → 误读同名的 `.claude/commands/goal-mode.md`（写死 RESOLVED_ADAPTER: claude）注入 agent。
      改造（择一/组合）：
        (1) 给 cursor adapter 生成 **Command 产物**：`.cursor/commands/<slash>.md` 薄跳板（内嵌 `> 运行身份（RESOLVED_ADAPTER）：cursor` + 一条跳转到 framework SKILL，**不复述** Claude 模板正文）。需把 cursor adapter.yaml `commands: null` 改为声明（镜像 claude 的 `commands.target_dir/template_dir`，新增 `.cursor/commands` bridge 模板）。
        (2) 或把 BLOCKER 前导 + `RESOLVED_ADAPTER：cursor` 直接写进 `.cursor/skills/goal-mode/SKILL.md` 跳板，提升其在 Cursor 注入里的显著度。
      边界（诚实）：依赖 Cursor 实际读 `.cursor/commands/` 并优先于 `.claude/commands/`（**Cursor 行为假设**，仓内不可证）；故本项为"减少触发"，**硬保证仍是 G1/G2**（即便 Cursor 仍注入 claude 模板，goal-runner 也会以 local 对账 STOP）。
      设计抉择：cursor 从"只生成 skill bridge"改为"也生成 command 产物"会影响**所有** slash skill 的 cursor 产物面 —— 需 maintainer 评估（是否所有 skill 都要 `.cursor/commands`，抑或只对 goal-mode 这类 slash 入口）。
      触点：agents/cursor/adapter.yaml、agents/cursor/templates/commands（新）或 shared command bridge 模板、[adapter-catalog.ts](../../harness/scripts/utils/adapter-catalog.ts) / materialize、framework-init 物化、harness/tests/unit。
      实现（2026-06-29）：核实 check-init.ts:624 的 `collectDir` 为**通用 per-adapter**物化（读任意 adapter 的 `commands.template_dir/target_dir` → copy 进 templateFiles，`materialize-adapter:<name>` 落盘）。故走**零物化器改动**路径：cursor adapter.yaml `commands: null` → `{target_dir: .cursor/commands, template_dir: templates/commands}`；新增 `agents/cursor/templates/commands/goal-mode.md`（薄入口、`RESOLVED_ADAPTER）**：cursor`、指向 framework SKILL + 显式"勿被同名 .claude/commands 误导"）。只放 goal-mode（唯一携带运行身份的 slash；其余命令路由到 adapter 无关 skill、无误路由风险）。+1 锁定单测。
    status: completed
---

# goal-mode adapter 误选根治 — 详细 plan

> 状态：**已实施完成并全绿**（2026-06-29）。单测 1214 passed / fixtures 35 passed / typecheck 通过。实施记录见 §六。

## 一、一句话根因

框架没把 claude 写死。坏在**三层脱节**：Cursor agent 没拿到跳板身份就**硬猜 claude** → `check-personal-setup` 明知你是 cursor 却**静默吞掉冲突** → `goal-runner/preflight` 又把**猜测置于你记录的 `framework.local.json` SSOT 之上**（`--adapter` 一来就 `delete('agent_adapter')` 跳过校验）。`framework.local.json` 里的 cursor 在关键路径上从未被当权威对账。

## 二、三层防线与本轮修复

| 层 | 现状（漏） | 修复 | 优先级 |
|---|---|---|---|
| 触发：身份解析 | agent 拿不到跳板身份就硬猜 claude | G3 阶梯厘清（只产 requested、effective 以 local 为准、传 activeAdapter） + G4 cursor 跳板可发现性 | P2 / P3 |
| 设置对账 | check-personal-setup 静默吞 select≠既有 | G2 `adapter_conflict` 码 | P1 |
| 运行启动 | preflight 跳过 agent_adapter 校验 + argv 优先 | G1 local 权威化 + 冲突 STOP + --override 逃生口 | P1 |
| 出口 | 无回归覆盖 | G5 夹具/单测 | 出口 |

G1+G2 是硬兜底（即便触发层漏注入身份，local 权威化也拦得住错 adapter）；G3/G4 减少触发；G5 防复发。

## 三、概念模型（review#2 厘清 · 全局口径）

- **requestedAdapter**：解析阶梯产出的「请求身份」——用户显式 / 跳板声明 / registry 交互（**永不默认 claude/cursor**）。只是"请求"，非权威。
- **localAdapter＝SSOT**：`framework.local.json agent_adapter`（个人级、gitignored、用户 setup 的权威）。
- **effectiveAdapter**：`override ? requested : (local 合法 ? local : requested)`——**已有合法 local 时一律以 local 为准**，除非 `--override-adapter`。
- **冲突即 STOP 且不写 manifest**：requested ≠ local(合法) 且无 override → BLOCKER；须**保留原始值对账、不先归一**（否则冲突事实被擦掉）。
- **写 local 仅两条合法路径**：① registry `setup.adapter` + `record-adapter`（永久换）；② `--override-adapter`（本次即时换，经同一 writeLocalConfig 留痕）。**普通冲突不碰盘**。

## 四、最终决策（用户 2026-06-29 拍板）

1. **显式覆盖**：用 `--override-adapter` flag（确定性、可单测）。
2. **override 回写**：带 `--override-adapter` 时回写 local.json agent_adapter + 汇报留痕；普通冲突不碰盘、只 STOP。
3. **G4**：本轮先调查 + 靠 G1/G2 硬兜底；rules/AGENTS 常驻规则注入留观察（视调查结论）。
4. **adapter_provenance**：纳入——manifest 增 `adapter_provenance`（user_explicit|entry_declared|override|local_config|registry）字段 + schema/loader 同步 + 单测。
5. **G6 范围＝只修 goal-mode，不全量生成 `.cursor/commands/*.md`**（codex review·显式决策）：goal-mode 是**唯一携带 `RESOLVED_ADAPTER` 运行身份**的 slash——同名碰撞只在它身上造成**功能性 adapter 误路由**（喂给 goal-runner）。`/spec`·`/plan`·`/coding` 等同名命令即便 Cursor 误读 Claude 版，也只路由到 **adapter 无关**的 framework SKILL（顶多 cosmetic Claude-isms，无误路由）。故只生成 cursor 的 goal-mode command；全量 11 个 `.cursor/commands/*.md` 列为**备选**（若其它命令的 Claude-ism 实测成问题再做，避免 11 模板维护漂移）。

## 五、外部 review#2 已纳入（plan 层加固）

1. **不先归一、冲突前置**（P1）：G1 改为先捕获 `requestedAdapter/localAdapter/override` 原始值，在 buildGoalManifestFromInput 之前对账，**冲突不构造/写 manifest**（断言）——不让归一擦掉「argv=claude / local=cursor」事实。
2. **去 G1/G2 矛盾**（P2）：统一为「普通冲突不写盘；写 local 仅 registry record-adapter 或 `--override-adapter`（同一 writeLocalConfig 留痕）两条路径」。
3. **provenance 触 schema/loader**（P3）：G5 明确同步改 `workflows/goal-manifest.schema.yaml` + `goal-manifest.ts` 读写/兼容，非只塞 JSON。
4. **ladder 只产 requested、local 才是 effective 权威**（P4）：G3 厘清阶梯不把 local 当一级；effective 恒以合法 local 为准（除非 override）。

### review#3 已纳入（边界补全）

5. **双缺硬边界**（永不默认反面）：requested 与 local 皆缺 → BLOCKER STOP、不写 manifest、不落回 `cfg.agent_adapter` 默认（G1(2) + G5(2) 测）。
6. **override 前置条件**：`--override-adapter` 须有非空/合法/已物化入口的 requestedAdapter，否则无回写目标 → BLOCKER（G1(4) + G5(2) 测）。
7. **provenance 补 `entry_declared`**：枚举加跳板/入口声明来源（Cursor/Codex/generic 首启经跳板得 requested，既非 user_explicit 也非 registry），全枚举＝`user_explicit|entry_declared|override|local_config|registry`，免 provenance 再失真。
8. **措辞同步**（P3）：name/overview/§二表 的"阶梯硬化 local 前置"统一改为"阶梯只产 requested、effective 以 local 为准"，避免实现时把 local 塞回解析阶梯。

## 六、实施记录（2026-06-29 · 全部完成）

测试：`npm test` 全绿 —— typecheck 通过 / 单测 **1217 passed**（+14：reconcile 11 + adapter_conflict 2 + G6 cursor command 1）/ fixtures **35 passed**。

实施后 review#4 加固（2 条，已修）：
- **P1 override 回写时序**：原回写在 survival/orphan/lock/preflight 之前——若随后 BLOCKER 退出会"run 没启动却把 local 切走"。改为：reconcile 早算决策（纯计算，set manifest.adapter/provenance），override 回写**延后到所有启动前置 + preflight 通过、`writeGoalManifest` 之前**（goal-runner.ts，`pendingAdapterWriteback`）。
- **P2 损坏 SSOT 不静默**：`reconcileRunAdapter` 加 `localRaw && !localValid && !override → BLOCKER`（local 记录了非物化/入口缺的 adapter 时显式报错、提示修 local/record-adapter 或 --override-adapter），不再当"无 local"静默用 requested。+2 单测。

| 项 | 改动文件 | 关键落地 |
|---|---|---|
| **G1** | [goal-preflight.ts](../../harness/scripts/utils/goal-preflight.ts)、[goal-runner.ts](../../harness/scripts/goal-runner.ts)、[goal-manifest.ts](../../harness/scripts/utils/goal-manifest.ts)、[personal-setup-gate.ts](../../harness/scripts/utils/personal-setup-gate.ts) | 新增纯函数 `reconcileRunAdapter`（保留 raw、effective=override?requested:(local合法?local:requested)、冲突/双缺/override无requested 抛 BLOCKER）；goal-runner 在 manifest 持久化+加锁**前**对账、写 effectiveAdapter+adapter_provenance、override 经 `recordAdapterToLocal` 回写留痕；argv 加 `--override-adapter`/`--adapter-source` |
| **G2** | personal-setup-gate.ts | `ensurePersonalSetup` gate.ok 分支：selectAdapter≠既有合法 agent_adapter → 新码 `adapter_conflict`（ok:false、不改盘）；`PersonalSetupEnsureCode` 加该码；check-personal-setup 透传 |
| **G3** | [goal-mode/SKILL.md](../../skills/project/goal-mode/SKILL.md) | §运行身份厘清：阶梯只产 requested、local 为 effective 权威、永不默认；`--adapter` 传 activeAdapter + `--adapter-source`；表加 `adapter_conflict` 行；首启命令更新 |
| **G4** | [goal-mode-runbook.md](../../docs/operations/goal-mode-runbook.md) | 改旧优先级为 SSOT 权威模型；加"adapter 误选"排障节（根因/Cursor 触发面调查/G1·G2 兜底/恢复）；两级校验补 reconcile 对账行。rules/AGENTS 注入按决策留观察 |
| **G5** | [workflows/goal-manifest.schema.yaml](../../workflows/goal-manifest.schema.yaml)、goal-manifest.ts、[goal-preflight.unit.test.ts](../../harness/tests/unit/goal-preflight.unit.test.ts)、[personal-setup-gate.unit.test.ts](../../harness/tests/unit/personal-setup-gate.unit.test.ts) | schema+loader 加 `adapter_provenance`（旧 manifest 兼容）；reconcile 9 边界用例 + adapter_conflict 2 例 |

诚实说明：detach 启动路径的对账在 detached-child 的 main() 内执行（child 仍会在写 manifest 前 STOP 冲突）；launcher 层未前置对账——实践中 agent 按新 SKILL 传 activeAdapter 不应触发，留作已知边界。

## 七、Cursor 自查结论交叉核对（2026-06-29）

Cursor 给出更上游的触发面分析（Cursor 把 `.claude/commands/goal-mode.md`(claude) 当 `/goal-mode` 注入），经磁盘核实**基本属实**：三同名产物（cursor/claude/codex）并存、`.cursor/commands/` 不存在、claude command 模板写死 claude。判定本 plan 覆盖度：

- **结果层（"会不会真跑成 claude"）＝已覆盖**：G1 reconcile 在 goal-runner 写 manifest 前以 local 对账——即便 Cursor 注入 claude 模板、agent 解析成 claude 传 `--adapter claude`，local=cursor 时**直接 BLOCKER STOP**（不再静默跑 claude）。这正补上 Cursor 分析的"第 4 层：没以 framework.local.json 纠正"。**已实测**（reconcile 冲突用例）。
- **触发层（"Cursor 为何注入 claude 模板"）＝未修，原 G4 仅"调查+文档"**：Cursor 的分析即调查结论 → 新增 **G6** 落地其推荐的上游修（给 cursor 生成 `.cursor/commands/goal-mode.md` 内嵌 `RESOLVED_ADAPTER: cursor`）。属 cursor 物化契约变更 + 依赖 Cursor 行为假设，列 pending 待 maintainer 拍板。
- **结论校正**：Cursor 说"不是 framework.local.json 配错，而是 prompt 层注入了 claude 模板"——与本 plan 设计哲学一致（**prompt 层不可信 → 以 local 为 SSOT、在 runner 强制对账**）。故 G1/G2 是对的根治方向；G6 是把触发面也收掉。
- **G6 已实现（2026-06-29）**：给 cursor 生成 `.cursor/commands/goal-mode.md`（RESOLVED_ADAPTER: cursor），走零物化器改动的通用 commands 物化路径；测试 1217 passed / 35 fixtures。**硬保证仍是 G1/G2**（G6 依赖 Cursor 读 `.cursor/commands` 并优先于 `.claude/commands` 的行为假设，属"减少触发"）。

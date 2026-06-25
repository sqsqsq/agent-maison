---
name: goal-mode 多adapter自愈
overview: 修复 goal 模式在「已物化多个 adapter、但新 clone 缺 framework.local.json」工程下的缺陷。统一 Case A/B 走一条确定性写盘路径（neutral 命名 --select-adapter），补齐「运行身份」可靠 wiring，并在 SKILL 加「门控失败即 STOP 交回用户、严禁绕过 goal-runner / 严禁自由改码」硬约束。目标在研版本 2.4.0，不动版本号。
version: 2.4.0
todos:
  - id: harness-select-adapter
    content: check-personal-setup.ts 增加中性 --select-adapter；写盘逻辑下沉到 attemptEnsureAdapterFromFallback 的 candidates 短路；combineEnsuredActions 改逻辑+枚举（识别 auto_selected_adapter、补 auto_selected_adapter_and_deveco）+ PersonalSetupEnsuredAction + RepairAttempt.ensured + formatEnsuredOkMessage 同步；no_materialized_adapter 消息补 project-root 提示
    status: completed
  - id: identity-wiring
    content: 改生成器注入身份行——renderBridgeSkillStubMarkdown 加 adapterName 入参并 thread（非占位符渲染）；Claude 改静态模板 agents/claude/templates/commands/goal-mode.md 声明 claude（已确认 builtin 走 commands.template_dir 静态拷贝，与 renderClaudeSlashMarkdown 无关）；shared SKILL 显式消费 RESOLVED_ADAPTER，绕过 bridge 时退化到 AskUserQuestion(candidates)
    status: completed
  - id: skill-goalmode
    content: goal-mode SKILL.md：合并 Case A/B 为单条确定性写盘流程（含 Case A 多 adapter 必写 local.json）；Tier_1 依赖就绪提为门控命令前硬前置；自动选 adapter 后须回报「按运行宿主选了 X，要别的请讲」；禁止节新增反绕过/失败即 STOP BLOCKER
    status: completed
  - id: doc-gate-ref
    content: personal-setup-gate.md 同步记录 --select-adapter / auto_selected_adapter、身份解析阶梯与门控失败硬约束
    status: completed
  - id: tests
    content: 扩展 personal-setup-gate.unit.test.ts 覆盖 --select-adapter 各分支（Case A 显式值 / Case B 身份 / ∉candidates / 单 adapter no-op），cd harness && npm test 全 PASS
    status: completed
isProject: false
---

# Goal 模式多 adapter 工程自愈 + 反绕过加固

> version: 2.4.0（当前在研窗口，不 bump）

## 背景：这次到底踩了什么坑

宿主工程被别人 `framework-init` 时**物化了多个 adapter** 并把 `framework.config.json` 提交上库；新 clone 只缺个人级 `framework.local.json`。复盘三个现象：

- `check-personal-setup --ensure` 对**多 adapter** 故意不自动写盘，返回 `needs_adapter_choice`（仅单 adapter 才 `auto_single_adapter` 自写）。这是 run 2 的真实结果。
- agent 未走 `record-adapter` 写 local.json；又把 `--project-root` 误打成 `D:/1/code/...`（应为 `D:/1.code/...`），错误根目录找不到 config → 误得 `no_materialized_adapter`（run 3）。
- 据此**自编逃生通道**绕过 goal-runner、转为自由改码——而 [goal-mode/SKILL.md](skills/project/goal-mode/SKILL.md) 的「禁止」节并无此通道，缺一条「门控失败即 STOP 交回用户、不得绕过/不得自由改码」。

## 关键事实（决定方案落点）

- goal-runner 不持久化 local.json（[goal-runner.ts:710](harness/scripts/goal-runner.ts) 仅 `adapter: argv.adapter ?? cfg.agent_adapter`）。
- 内层裁决子进程 [harness-runner.ts:307](harness/harness-runner.ts) 的 `ensurePersonalSetup` **不豁免** `agent_adapter`；多 adapter 无 local.json → 每个 phase `needs_adapter_choice` → `exit(1)`。
- **Gap 1（Case A 同样翻车）**：显式 `--adapter` 仅在 goal-runner 自身 preflight 被放行（[goal-preflight.ts:107-109](harness/scripts/utils/goal-preflight.ts) `prereqs.delete('agent_adapter')`）；内层 phase 子进程拿不到该 provenance 豁免，多 adapter 新 clone 仍在第一个 phase（非入口）`exit(1)`。故 Case A 在多 adapter 工程下**也必须真正写出 local.json**，不能只当措辞处理。
- **Gap 2（运行身份无 wiring，最大落地风险）**：全仓没有机制告诉运行中的 agent「你是 claude/cursor/codex」。goal-mode 主 SKILL 跨宿主共用同一篇正文，不能指望 agent 硬猜 `claude`。**占位符渲染路径不成立**：非 Claude 的 builtin goal-mode 跳板由 [materialize-agent-bundle-skills.ts:42](harness/scripts/utils/materialize-agent-bundle-skills.ts) `renderBridgeSkillStubMarkdown(skillId, stub, repoRel)` **程序化生成**（9 行写死、不接收 adapter 名、不走 `renderTemplate`/`AGENT_ADAPTER`）。故 wiring 必须**改生成器注入身份行**，不是塞占位符。
- **Claude 入口已钉死（非二义）**：claude adapter.yaml `commands.template_dir: templates/commands`（[agents/claude/adapter.yaml:12-14](agents/claude/adapter.yaml)）把**静态模板** `agents/claude/templates/commands/goal-mode.md` 逐字拷到 `.claude/commands/` → builtin goal-mode 真实入口就是该静态模板，**改它有效**；`renderClaudeSlashMarkdown`（[instance-skill-bridge.ts:310](harness/scripts/utils/instance-skill-bridge.ts)）只服务 doc/extensions 扩展 skill，与 builtin goal-mode 无关。
- **combineEnsuredActions 是逻辑改非纯类型改**：函数体 [personal-setup-gate.ts:218-227](harness/scripts/utils/personal-setup-gate.ts) 硬判 `steps.includes('auto_single_adapter')`；只改类型，传入 `auto_selected_adapter` 会被当「无 adapter step」丢失，且缺 select+deveco 同轮的组合枚举。
- 结论：**自愈必须真正写出 `framework.local.json`**；Case A/B 应合并成**同一条确定性写盘路径**，命名去掉「self」语义改中性。

## 方案

### 1. harness：中性 `--select-adapter`，写盘下沉到 fallback 短路

把 flag 从「写运行身份」泛化为「写解析出的目标 adapter」——Case A 传显式值、Case B 传运行身份，共用一条确定性写盘路径。命名去掉「self」歧义。

- [harness/scripts/check-personal-setup.ts](harness/scripts/check-personal-setup.ts)：`parseArgs` 增加 `--select-adapter <name>`，透传给 `ensurePersonalSetup`（`PersonalSetupGateOptions.selectAdapter`）。
- [harness/scripts/utils/personal-setup-gate.ts](harness/scripts/utils/personal-setup-gate.ts)：
  - 写盘逻辑**下沉到 `attemptEnsureAdapterFromFallback`**（多 candidate 短路处，约 411-440 行）：算出 `candidates` 后，若 `selectAdapter ∈ candidates` → 直接 `writeLocalConfig(mergeLocalPatch({ agent_adapter: selectAdapter }))` + `clearFrameworkConfigCache()` → 返回 `{ repaired: true, ensured: 'auto_selected_adapter' }`；不再在 `ensurePersonalSetup` 事后判 `needs_adapter_choice` 重复判定。
  - `selectAdapter` **不在** candidates（或未传）时：保持构造 `needs_adapter_choice`，`message` 提示「目标 adapter `<name>` 不在已物化候选 [..]，请选已物化项或先 /framework-init」。
  - `attemptPersonalSetupRepair` / `attemptEnsureAdapterFromFallback` 签名透传 `selectAdapter`。
  - **`combineEnsuredActions` 逻辑 + 枚举改（非纯类型）**（[personal-setup-gate.ts:218-227](harness/scripts/utils/personal-setup-gate.ts)）：
    - `PersonalSetupEnsuredAction` 新增 `auto_selected_adapter` 与 `auto_selected_adapter_and_deveco`。
    - `combineEnsuredActions` 入参类型加 `auto_selected_adapter`，**并改函数体**：adapter 维度取 `selected || single`，组合时 selected 优先输出 `auto_selected_adapter[_and_deveco]`、single 维持 `auto_single_adapter[_and_deveco]`（覆盖一轮内 select-adapter → deveco-detect 串行）。
    - `RepairAttempt.ensured` 联合（约 443-444 行）加 `auto_selected_adapter`。
    - `formatEnsuredOkMessage` 补 `auto_selected_adapter` / `auto_selected_adapter_and_deveco` 两条人读文案。
  - 边界：单 adapter 时 `--select-adapter` 为 no-op（已 `auto_single_adapter`）；普通 feature phase 不传该 flag → 多 adapter 仍走交互选择（行为不变）。
- 顺带：`no_materialized_adapter` 的 `message` 追加「确认 `--project-root` 指向含 `framework.config.json` 的工程根」，降低 typo 误判。

### 2. 运行身份来源（Gap 2 wiring，主路径 = 改生成器注入身份行）

定义「解析目标 adapter」的来源阶梯，主 SKILL 只消费 `RESOLVED_ADAPTER`，不硬编码 `claude`：

1. **显式用户指定**（Case A，「用 cursor 跑 goal」）→ 直接用该值。
2. **入口注入的运行身份**（Case B）——**主路径是改生成器/静态模板写一行身份声明，不是塞占位符**：
   - **Claude（静态模板，已确认有效）**：编辑 [agents/claude/templates/commands/goal-mode.md](agents/claude/templates/commands/goal-mode.md)，加一行运行身份声明（如 `> 运行身份（RESOLVED_ADAPTER）：claude`）。builtin slash 走 `commands.template_dir` 静态拷贝，逐字生效。
   - **Codex/Cursor/generic（程序化跳板，改生成器）**：给 [renderBridgeSkillStubMarkdown](harness/scripts/utils/materialize-agent-bundle-skills.ts) 增加 `adapterName` 入参，在 stub 写一行 `> 运行身份（RESOLVED_ADAPTER）：<adapterName>`；并把 `adapterName` thread 进 `MaterializeAgentBundleOptions` → `materializeAgentBundleSkills` 调用处（L206）。范围限 `skillId === 'goal-mode'` 即可（其余 builtin stub 不需身份，减小 blast radius）。
   - **删除**上一版「往跳板塞 `AGENT_ADAPTER` 占位符 + 确认 renderTemplate」路径——该跳板程序化生成、不走 `renderTemplate`，此路不通。
3. **回退（身份不可靠 / 绕过 bridge 直调 shared SKILL）**：主 SKILL **AskUserQuestion** 在 `candidates` 上选择（沿用 registry `setup.adapter`），**永不硬猜**。

> shared full SKILL [skills/project/goal-mode/SKILL.md](skills/project/goal-mode/SKILL.md) 须**显式写**：「使用你入口/跳板声明的 `RESOLVED_ADAPTER`」；身份靠「刚读过 bridge」留在 context 带入，故须在 SKILL 文案点明该来源，并把「未经跳板直调本 SKILL → 无身份 → 阶梯 3 AskUserQuestion」的退化路径写清。
> `--select-adapter` 只负责把阶梯解析出的值确定性写盘；「值从哪来」由上述阶梯决定。
> 落地校验：物化后实测各 adapter 的 goal-mode 真实入口产物确实含正确身份行（Claude 看 `.claude/commands/goal-mode.md`；其余看 bundle skillsDir 下 goal-mode stub）。

### 3. goal-mode SKILL：合并单流程 + 依赖前置 + 回报情报权 + 反绕过

[skills/project/goal-mode/SKILL.md](skills/project/goal-mode/SKILL.md)：

- **合并 Case A/B 为一条流程**（修掉 Gap 1）：
  1. 按 §2 阶梯解析 `RESOLVED_ADAPTER`。
  2. `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --select-adapter <RESOLVED_ADAPTER> --project-root <repo-root>`（**Case A 也走**，确保多 adapter 工程写出 local.json，内层 phase 才不翻车）。
  3. 解析 JSON：`ok` → 继续；`needs_adapter_choice`（解析值 ∉ candidates）→ 回退 AskUserQuestion 或 STOP→`/framework-init`；`no_materialized_adapter`/`not_in_materialized`/`entry_not_materialized` → 复核 `--project-root` 后 STOP→`/framework-init`。
  4. `goal-runner.ts --adapter <RESOLVED_ADAPTER> ...`。
  - **删除**原「A. 显式 adapter 可跳过 `--ensure`」措辞（对多 adapter 工程是潜伏翻车）。
- **Tier_1 依赖前置（提为硬前置）**：在任何 `check-personal-setup` / harness ts-node 调用**之前**，须先 [host-harness-readiness](skills/reference/host-harness-readiness.md) Tier_1（`init-readiness.mjs` → 必要时 `npm install`）。明确排序，避免首跑 `@types/node` 缺失型 `TSError`（本次实测坑）。
- **回报情报权（呼应「要经我同意」）**：Case B 自动按运行宿主选定 adapter 写 local.json 后，须在汇报中明说一句「我按当前运行宿主选了 `<X>`（个人级 `framework.local.json`，gitignored）；要换别的 adapter 请讲」——保留确定性同时把选择权信息交回用户。
- **「禁止」节新增 BLOCKER**：
  - personal-setup / preflight 门控失败、`no_materialized_adapter`、或任何歧义 → **STOP**，把结论与建议（`/framework-init` 或选 adapter）交回用户；**严禁**自行绕过 goal-runner、**严禁**转入自由改码、**严禁**据单次失败探测自下「项目未物化」结论而不复核 `--project-root`。
  - 探测失败先核对 `--project-root`（须指向含 `framework/` 与 `framework.config.json` 的工程根）再下结论。

### 4. personal-setup-gate.md：文档同步

[skills/reference/personal-setup-gate.md](skills/reference/personal-setup-gate.md)：

- 记录 `--select-adapter` 与 `auto_selected_adapter`、§2 身份解析阶梯、goal-mode 确定性写盘路径；`needs_adapter_choice` 行补充「goal-mode 下由 `--select-adapter` 确定性自愈（解析值 ∈ candidates 时）」。
- 「硬约束」表新增：门控失败 → STOP 交回用户，不得绕过 harness / 不得自由改码。

### 5. 验收

- 扩展 [harness/tests/unit/personal-setup-gate.unit.test.ts](harness/tests/unit/personal-setup-gate.unit.test.ts)：
  - 多 adapter + `selectAdapter ∈ candidates`（Case A 显式值 与 Case B 身份各一）→ 写 local.json 且 `ok` / `ensured: auto_selected_adapter`。
  - 多 adapter + `selectAdapter ∉ candidates` → 仍 `needs_adapter_choice`、不写盘。
  - 单 adapter + `selectAdapter` → no-op，仍 `auto_single_adapter`。
  - **一轮内 select-adapter → deveco-detect 串行 → `ensured: auto_selected_adapter_and_deveco`**（覆盖 combineEnsuredActions 逻辑改）。
- 身份注入回归：`renderBridgeSkillStubMarkdown(..., 'codex')` 等产物含身份行；Claude 静态模板含身份行（materialize-agent-bundle / 模板存在性 unit）。
- `cd harness && npm test` 全 PASS（AGENTS.md BLOCKER）。

## 不做

- 不改版本号 / 不动 plan 版本绑定。
- 不改 goal-runner 编排与裁决逻辑（仅文档措辞 + 入口/门控）。
- 不在 goal 流程内写任何项目级产物（`.cursor/**`、`framework.config.json`、物化清单）；只写个人级 `framework.local.json`。

---
name: init 编排缺口修复
overview: 修复宿主工程跑新版编排化 /framework-init 时暴露的 5 处偏差：adapter 物化清单未询问（加 harness 机器门禁根治）、S1 探测前未装依赖、--emit-staging-template 文档/脚本矛盾、decision/context 新 schema 缺示例、preflight 闭包对 satisfied 依赖误判。
version: 2.2.0
todos:
  - id: openspec-delta
    content: 新建 OpenSpec init-orchestration delta（adapter 选择须有机器证据 + context 不含 root + satisfied 闭包豁免）；已完成变更 init-staging-atomic-preflight 不覆盖，勿在其上扩展
    status: completed
  - id: gate-schema
    content: decision.json schema 1.0 增 materialized_adapters；assertDecisionStructure 仅"若存在则须 string[]"（缺失不 throw，留给 preflight）
    status: completed
  - id: gate-preflight
    content: preflight/validateDecisionJson：project 作用域缺/空 materialized_adapters → 写 blocked run-log 原子阻断；personal 作用域不要求；与 context 交叉校验
    status: completed
  - id: gate-exec-ssot
    content: 执行链以 decision.materialized_adapters 为准——传入 prepareInitExecutionPlanWithStaleIds / applyMaterializedAdaptersToProjectPlan，再同步进 executor context；config 回落仅作推荐默认
    status: completed
  - id: gate-template
    content: buildInitStagingTemplate 输出 materialized_adapters:[] 并明示为"待补全模板"（非可执行骨架），由 preflight 阻断直到用户替换
    status: completed
  - id: ctx-root-harden
    content: context schema 不含 projectRoot/harnessRoot/plan——读 context 时剥离这些字段或修正 line 511 spread 顺序，防 context 覆盖 CLI root + 单测
    status: completed
  - id: gate-skill
    content: SKILL S2.2 增 UPDATE 专段：每轮必经 init.materialized_adapters 收本轮清单，禁止现状=已选定
    status: completed
  - id: tier1-skill
    content: SKILL S1.1/S1.2 探测前加 Tier_1 install-first BLOCKER，命令统一 cd harness && npx ts-node
    status: completed
  - id: emit-fix
    content: 修 --emit-staging-template：无 context 文件时按空 context 生成骨架（脚本）+ SKILL 用法改为不带 --context-file
    status: completed
  - id: schema-example
    content: SKILL/templates 补 decision.json 与 context.json 完整可复制骨架示例
    status: completed
  - id: preflight-satisfied
    content: 闭包校验豁免 satisfied 任务被显式 skip 的情形 + 单测
    status: completed
  - id: verify
    content: harness npm test 全绿 + 手验 S1–S4 四个场景
    status: completed
isProject: false
---

# init 编排化流程缺口修复（v2.2.0）

> 窗口版本 `2.2.0`（已写入 frontmatter `version`）。本计划基于对 [skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md)、[harness/scripts/init-orchestrate.ts](harness/scripts/init-orchestrate.ts)、[harness/scripts/utils/init-task-planner.ts](harness/scripts/utils/init-task-planner.ts) 与运行日志 `d:\97.log\最近问题2.txt` 的核对，并已吸收一轮只读 review 意见。

## 背景

宿主工程 WalletForHarmonyOS 跑新版编排化 `/framework-init`（S1–S4），日志暴露 5 处与预期不符。根因分两类：**规范-执行缝隙**（问题 1）与**文档-脚本不一致**（问题 2–5）。问题 1 采用 **harness 机器门禁**根治（用户已确认）。本质是一次**行为契约升级**（schema 与执行 SSOT 向 decision 侧收紧），故须同步 OpenSpec `init-orchestration` delta。

## 问题 0：OpenSpec delta（行为契约升级前置）

既有变更 [init-staging-atomic-preflight](openspec/changes/init-staging-atomic-preflight/specs/init-orchestration/spec.md) 已 `status: complete`（5/5，非活跃），只覆盖"原子 preflight"，**未**覆盖"adapter 选择须有机器证据 / context 不含 root / satisfied 闭包豁免"。须**新建**一个 `init-orchestration` capability 的变更 delta（勿在已完成变更上扩展），登记三条新行为，再实现代码，最后 `npm run openspec:validate`。

## 问题 1（核心）：adapter 物化清单未询问 — harness 机器门禁

**现状**：SKILL S2.2、命令 `framework-init.md` S2、[prompts/adapter-selection.md](skills/00-framework-init/prompts/adapter-selection.md) 都把 `init.materialized_adapters` 列为必问；但日志中 agent 只问了 task_plan + drift，物化清单仅"通知 claude 已物化"就跳过。机器侧 [`collectMaterializedAdapters`](harness/scripts/init-orchestrate.ts) 会从 `context.materializedAdapters` 或 `configWritePayload.materialized_adapters` **静默回落**，使"不问也能跑"。

**改造点**（注意校验分层，避免机制冲突）：
- decision.json schema 1.0 增字段 `materialized_adapters: string[]`。**校验分两层**（review 风险3）：
  - [`assertDecisionStructure`](harness/scripts/init-orchestrate.ts)（preflight 前、throw 即无 run-log）：**仅**校验"若存在则元素须为非空 string"；**缺失不 throw**。
  - [`preflightExecute`](harness/scripts/init-orchestrate.ts) / `validateDecisionJson`（产出 blocked run-log）：对 `scope==='project'` 缺失或空数组时**原子阻断**（写 blocked run-log + exit 1），错误信息提示"S2 须经 init.materialized_adapters 多选收集本轮清单"。**personal 作用域不要求**（避免影响 [00b-framework-setup](skills/00b-framework-setup/SKILL.md)）。
- **执行链改 SSOT**（review 风险4）：S3 先取 `decision.materialized_adapters`，传入 [`prepareInitExecutionPlanWithStaleIds`](harness/scripts/utils/init-task-planner.ts) / [`applyMaterializedAdaptersToProjectPlan`](harness/scripts/utils/init-task-planner.ts)，再将其**同步/覆盖**进 executor context，并与 context/config payload **交叉校验**（不一致 BLOCKER）。`resolveMaterializedAdaptersFromExecutionContext` 的 context/config 回落降级为"UPDATE 推荐默认"，不作最终来源。
- [`buildInitStagingTemplate`](harness/scripts/init-orchestrate.ts) 输出 `materialized_adapters: []` 并在文档/字段语义上明示其为**"待补全模板"**（非"合法可执行骨架"）；空数组由 preflight 阻断，直到 agent 用 AskUserQuestion 答复替换。
- SKILL S2.2 增 **UPDATE 专段**：即使 config 已有 `materialized_adapters`，每轮仍须经 `init.materialized_adapters` 收到本轮答复；禁止把"现状=已选定"。话术对齐既有 [profile-addendum §5.6.3](profiles/hmos-app/skills/00-framework-init/profile-addendum.md) installPath 纪律。
- 单测：decision 缺 `materialized_adapters`（project）→ preflight blocked（**有** run-log，非裸 throw）；personal 缺失 → 通过；带 ≥1 → 通过；与 context 冲突 → blocked。

## 问题 2：进入 S1 前未装依赖（Tier_1 readiness 缺口）

**现状**：日志第一次探测因 `@types/node` 缺失报 TS2591，`npx ts-node` 回落全局缓存。SKILL **S1.2** 探测命令前未引用 [host-harness-readiness.md](skills/reference/host-harness-readiness.md) Tier_1 install-first。

**改造点**（review 风险5：`npm install` 是写盘，不得污染"S1 只读"语义）：作为 **进入 S1 前的 Tier_1 readiness BLOCKER** 单列（前置于 [SKILL.md S1 "只读" 段](skills/00-framework-init/SKILL.md)，而非塞进 S1 探测本体）：先确认 `framework/harness/node_modules/ts-node` 存在，否则先 `cd framework/harness && npm install`（链到 host-harness-readiness Tier_1）。探测命令统一用 `cd framework/harness && npx ts-node scripts/init-orchestrate.ts ...`（本地 ts-node，避免全局 npx 回落）。

## 问题 3：`--emit-staging-template` 文档/脚本矛盾

**现状**：SKILL S2.2 第 4 步让 agent `--emit-staging-template --context-file <temp>/context.json`，但 [init-orchestrate.ts:673-680](harness/scripts/init-orchestrate.ts) 只要传 `--context-file` 就先 `readJsonFile`，不存在即 ENOENT。

**改造点**（脚本 + 文档**都做**，避免只改文档留 CLI 旧坑）：
- 脚本：emit 分支下若 `--context-file` 指向不存在文件，不抛错而是按空 context 生成骨架（仅 execute 分支强制要求文件存在）。
- 文档：SKILL S2.2 第 4 步改为 `--emit-staging-template`（**不带** `--context-file`，输出 stdout 后由 agent 拆分写两文件），并给出拆分说明。

## 问题 4：decision/context 新 schema 缺可复制示例 + context root 泄漏加固

**现状**：agent 先按旧结构 `mode/taskDecisions` 写被拒，再读源码才改对；SKILL 第 77 行只说"禁止旧结构"无正确样例。日志中 agent 还把 `projectRoot`/`harnessRoot` 写进 context.json。

**改造点**：
- SKILL S2.2（或新建 `templates/staging-schema-example.md`）补 decision.json（`schema_version/scope/decision_mode/plan_generated_at/tasks[]` + `materialized_adapters`）与 context.json（**仅** `materializedAdapters/configWritePayload/docWritePayload/confirmAnswers` 等）的**完整可复制骨架**，与问题 1 字段一致。
- **context schema 不含 `projectRoot`/`harnessRoot`/`plan`**（review 风险2）：示例不得出现这三字段；同时加固 [executeInitPlan](harness/scripts/init-orchestrate.ts)——读 context 时**剥离**这三字段，或修正 [init-orchestrate.ts:511](harness/scripts/init-orchestrate.ts) 的 spread 顺序（`...context` 在前、CLI `projectRoot/harnessRoot/plan` 在后），防 context 覆盖 CLI root。补单测：context 带 `projectRoot` 时执行仍用 CLI root。

## 问题 5：preflight 闭包误判 satisfied 依赖被 skip

**现状**：agent 把 satisfied 的 `harness-install` 标显式 `skip`，[validateDecisionJson 依赖闭包](harness/scripts/init-orchestrate.ts)（约 413-423 行）报"依赖闭包违反"。但智能模式隐式 `satisfied→skip`（第 462 行）不进 `skipIds`、不触发——显式/隐式不一致。

**改造点**：闭包校验构造 `skipIds` 时**豁免 `status==='satisfied'` 的任务**（跳过已满足依赖无害），或将"显式 skip 一个 satisfied 任务"规约为隐式 skip。补单测：satisfied 依赖显式 skip + 依赖者 run → 通过；非 satisfied 依赖被 skip + 依赖者 run → 仍阻断。

## 验收

- `npm run openspec:validate` 通过（`init-orchestration` delta 合法）。
- `cd harness && npm test` 全 PASS（含新增 init-orchestrate 单测：adapter 必填/personal 豁免/context-decision 冲突、context root 泄漏、satisfied 闭包豁免）。
- 手验：在干净宿主工程跑一遍 S1–S4，确认（a）进入 S1 前提示装依赖；（b）`--emit-staging-template` 不带 context 可出"待补全模板"；（c）project decision 缺 `materialized_adapters` 被 preflight 阻断且**有 run-log**；（d）context 带 root 不覆盖 CLI；（e）satisfied 依赖显式 skip 不再误阻。
- 不改 plan 正文 scope；如发版前未完成则按版本演进规则顺延。
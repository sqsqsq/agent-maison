---
name: init runlog readiness ux
version: 2.2.0
overview: 收紧 /framework-init "成功但有摩擦"的体验与审计：S0 依赖 readiness 机器门禁、S2 智能模式文案纠偏、run-log skip 原因 + 顶层审计字段（覆盖 preflight/dependency 两个生产者）、staging context 元数据规范、S4 下一步保守化。不改核心 task DAG / preflight 规则 / adapter decision SSOT。
todos:
  - id: openspec-change
    content: 新建 OpenSpec change init-runlog-readiness-ux，写 init-orchestration delta（readiness / run-log reason+metadata / S4 保守 next-step）；proposal 正文注明属 2.2.0 窗口（版本门禁由 plan frontmatter version 承担，OpenSpec 不自带版本字段）
    status: completed
  - id: readiness-script
    content: 点1：新增 harness/scripts/init-readiness.mjs（Node-only 检查 ts-node + @types/node + package.json + cwd，输出 {ok,missing,recommended_command}，不自动安装）
    status: completed
  - id: skill-s0-s4
    content: 点1/点6：SKILL 与物化 command 模板更新——S0 readiness 硬门禁话术（ok=false 前禁裸跑 npx ts-node）、S4 只列可选下一步禁诱导
    status: completed
  - id: registry-wording
    content: 点2：confirmation-registry.yaml 改 init.task_plan smart_run 文案 + SKILL S2.3 按类别复述，保证过 lint
    status: completed
  - id: runlog-reason-metadata
    content: 点3+点4：init-orchestrate.ts 扩展 InitRunLogEntry.reason 与 InitRunLog 顶层字段，覆盖 executeInitPlan(含依赖阻断)与 buildPreflightBlockedLog 两生产者，buildRunSummary 加摘要行
    status: completed
  - id: normalize-context
    content: 点5：新增 normalizeStagingContext(raw)，允许 schema_version/scope、剥 root/plan、保 payload，并更新 staging-schema-example.md
    status: completed
  - id: resolve-action-guard
    content: 跨点防御：resolveTaskAction smart fallback 写死确定规则（drift 优先 overwrite→keep→skip，永不返回非 allowed_actions 内 action，全不允许则 throw），与 resolveTemplateAction 对齐
    status: completed
  - id: tests-gates
    content: 验收：单测(readiness/executeInitPlan/buildPreflightBlockedLog/buildRunSummary/normalizeStagingContext/registry lint) + fixture 断言顶层字段 + cd harness && npm test + openspec:validate
    status: completed
isProject: false
---

## Framework Init 成功后体验与审计优化（修订版）

> 实施载体：新建 OpenSpec change `init-runlog-readiness-ux`。
> 版本绑定（本仓 BLOCKER）：本 plan frontmatter 已写 `version: 2.2.0`（= 根 `package.json.version`，由 `check-plan-version.mjs` 校验）。OpenSpec change **不**自带机器版本字段，仅在 proposal 正文注明"属 2.2.0 窗口"。

本 plan 在你拿到的初版 6 点基础上，结合 `d:\97.log` 三份真实回执做了 3 处修订（点 1 根因、点 3/点 4 生产者覆盖、跨点防御）。其余点确认成立。

### 关键事实校准（来自真实日志）
- 首跑失败根因不是"缺 ts-node"，而是 `framework/harness/node_modules` 整体未装：`npx` 从 cache 临时拉到 ts-node，真正报错是 `@types/node` 缺失（`TS2591 Cannot find name 'fs'/'path'/'process'`、`__dirname`）。
- S2.3 那句"drift = 全部 overwrite"是当时 AI 复述错误，非引擎行为。引擎中 doc 类任务 POPULATED 时 `default_action='skip'`、`allowed_actions=['run','skip']`（见 [harness/scripts/utils/init-task-planner.ts](harness/scripts/utils/init-task-planner.ts) 第 192-201 行），即 doc-drift 默认 skip 是引擎默认值。故点 2 文案纠偏方向正确。

---

### 点 1 — S0 Tier_1 Readiness 机器门禁（P0，根因已修正）
- 新增不依赖 ts-node 的 Node 脚本 `harness/scripts/init-readiness.mjs`，仅用 Node 内置模块检查：
  - `framework/harness/node_modules/ts-node/package.json` 存在
  - `framework/harness/node_modules/@types/node/package.json` 存在（本案真正缺的是它，初版只查 ts-node 会漏）
  - `framework/harness/package.json` 存在
  - 当前 cwd 是否为 `framework/harness`
- 输出 JSON：`{ ok, missing[], recommended_command }`，`recommended_command` 固定为 `cd framework/harness && npm install`。
- 不自动 `npm install`（依赖安装契约 + 禁未授权写盘）。
- 与现状 SSOT 对齐：复用 [skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md) 第 24-30 行「进入 S1 前 Tier_1 readiness」与 `reference/host-harness-readiness.md` Tier_1，不另起判定标准。
- SKILL / command 模板话术：进入 S1 前先跑 readiness；`ok=false` 必须先 `cd framework/harness && npm install` 再跑 S1；`ok=false` 之前禁止裸跑 `npx ts-node`（cache 回落会静默掩盖未安装，正是本案诱因）。

### 点 2 — S2 智能模式文案纠偏（P1，成立）
- 改 [skills/reference/confirmation-registry.yaml](skills/reference/confirmation-registry.yaml) 中 `init.task_plan` 的 `smart_run` label/portable：由"无漂移跳过，有漂移自动覆盖"改为「智能模式 — 按任务默认动作执行；机制项自动同步，doc drift 默认保留，一次性批准」。
- 在 SKILL S2.3 复述改为按类别（短 label 会丢"config/adapter 覆盖"语义，必须在复述里补回）：
  - config / adapter 机制项：overwrite/run
  - doc drift：skip（保留）
  - satisfied：skip
  - required mechanism：run
- 保证仍过 registry lint（[harness](harness) 内 `check-skills-confirmation-ux.ts`）：无禁词、options schema 不破。

### 点 3 — run-log skip 原因细化（P0，补齐第二生产者）
- 扩展 `InitRunLogEntry` 新增可选 `reason?: "satisfied" | "drift_default_keep" | "decision_skip" | "keep" | "preflight_blocked" | "dependency_blocked"`；保持 `schema_version:"1.0"` 与 `message` 不变（非破坏）。
- 在 [harness/scripts/init-orchestrate.ts](harness/scripts/init-orchestrate.ts) 三处生产者都写 reason：
  - `executeInitPlan` skip/keep 分支：按 `task.status`/action 判定 satisfied / drift_default_keep / decision_skip / keep
  - `executeInitPlan` 依赖阻断分支（第 638-646 行 "依赖任务失败或未执行，跳过"）：`dependency_blocked`
  - `buildPreflightBlockedLog`：blocked 条目 `preflight_blocked`（初版测试清单漏了这个生产者）
- `buildRunSummary` 仍以 message 为主，不强制展示 reason；机器侧消费 reason。

### 点 4 — run-log 顶层审计字段（P0，与点 3 合并实现）
- 扩展 `InitRunLog` 新增可选顶层：`mode?: "create"|"update"`、`plan_generated_at?: string`、`project_root?: string`、`materialized_adapters?: string[]`（数据源：mode 来自 plan、adapters 来自 decision、project_root/plan_generated_at 来自 CLI/plan）。
- 成功路径（`executeInitPlan`/CLI execute）与 blocked 路径（`buildPreflightBlockedLog`）都填充——后者当前签名无这些值，需顺带透传（与点 3 同一处改动，合并做）。
- `buildRunSummary` 表格前加简短摘要行：mode / project_root / materialized_adapters。旧 entries 表格保持兼容。

### 点 5 — staging context 元数据规范（P2，清晰化）
- 新增 `normalizeStagingContext(raw)` 统一读 context：保留执行字段（`materializedAdapters`/`configWritePayload`/`docWritePayload`/`confirmAnswers`），允许但不入 executor 的元数据（`schema_version`/`scope`），永远剥离 `projectRoot`/`harnessRoot`/`plan`（现状 `stripContextReservedFields` 只剥后三者，`schema_version/scope` 会透传但无害）。
- 更新 [skills/00-framework-init/templates/staging-schema-example.md](skills/00-framework-init/templates/staging-schema-example.md)：说明 `schema_version/scope` 可选、仅 staging 元数据、执行上下文不消费。
- 保持 `decision.materialized_adapters` 与 context 清单集合一致的 preflight 规则不变。

### 点 6 — S4 下一步保守化（P2，加固既有约束）
- SKILL [skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md) 第 126 行已有"禁止自动开下游 Skill"；S4 话术改为只列"可选下一步"，禁止诱导式 yes/no（日志结尾"是否现在进入 catalog-bootstrap？"即违反）。
- 关键不只是改 SKILL：同步**物化出去的 command 模板**（`.claude/commands/framework-init.md` 等，本次正是被 overwrite 的产物），否则宿主侧行为不变。

---

### 跨点防御（建议顺手做，避免回归）
- 问题：`resolveTaskAction`（[harness/scripts/init-orchestrate.ts](harness/scripts/init-orchestrate.ts) 第 566-582 行）smart 模式 `drift → 'overwrite'` 无条件返回，未校验 `overwrite ∈ allowed_actions`。目前仅因 skeleton 为每个任务写显式 entry 而安全；手写/精简 decision 漏掉 doc-drift 任务时会拿到对该任务非法的 `overwrite`。
- 确定规则（与 `resolveTemplateAction` 现有 drift 分支对齐，不留"取交集"含糊）。smart 模式无显式 entry 时按 `task.status` 解析：
  - `satisfied` 且允许 `skip` → `skip`
  - `drift`：依次 `overwrite`（若允许）→ `keep`（若允许）→ `skip`（若允许）
  - 其它（`needed`/`skippable`）：`default_action === 'skip'` 且允许 `skip` → `skip`；否则 `run`（若允许）→ `overwrite` → `keep` → `skip`
  - 全部不允许 → `throw`，由 preflight 兜底阻断（不静默放行非法 action）
- 即 drift 优先 overwrite，但永不返回不在 `allowed_actions` 内的 action；doc-drift（`allowed_actions=['run','skip']`）因此回落到 `skip`，与点 2 文案/引擎默认一致。

### 验收（门禁）
- OpenSpec：新增 `init-orchestration` delta，覆盖 readiness、run-log reason/metadata（含 preflight/dependency 两生产者）、S4 保守 next-step；`npm run openspec:validate`。
- 单测：readiness 脚本（ts-node/@types/node/package.json 存在缺失、cwd 正误、JSON 稳定）；`executeInitPlan`（satisfied/drift-keep/decision-skip/dependency-blocked 各产对 reason）；`buildPreflightBlockedLog`（preflight_blocked reason + 顶层字段）；`buildRunSummary`（摘要行存在、旧表兼容）；`normalizeStagingContext`（允许 schema_version/scope、剥 root/plan、保 payload）；registry 文案过 lint。
- 集成/fixture：断言 run-log 顶层含 mode/project_root/materialized_adapters；`cd harness && npm test` 全绿。
- 版本门禁：plan frontmatter `version: 2.2.0` 通过 `node scripts/check-plan-version.mjs`；发布前走 `npm run release:check-plans`。
- 跨点防御：`resolveTaskAction` 单测覆盖 doc-drift 无显式 entry 时回落 `skip`（不返回非法 `overwrite`）、全不允许时 throw。

### 不在范围（沿初版 Assumptions）
- 不改 `/framework-init` 核心 task DAG、preflight 规则、adapter decision SSOT。
- readiness 不自动装依赖。
- run-log 新字段全部可选，保持现消费者兼容。
- `context.schema_version/scope` 仅作允许的 staging 元数据，不入 executor context。
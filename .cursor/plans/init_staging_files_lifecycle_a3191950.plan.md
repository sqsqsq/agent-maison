---
name: init staging files lifecycle
overview: 把 decision.json / context.json 正式定义为「S2 由 agent 在 OS 临时目录生成、S3 由 harness 消费、S4 由 agent 销毁」的一次性 staging 契约；并把 S3 缺 payload 的语义从「部分写盘后任务 failed」升级为「无副作用原子 preflight + 可审计 run-log」，经 OpenSpec 提案落地。
todos:
  - id: openspec-propose
    content: 新建 OpenSpec 变更提案，定义「执行前无副作用原子 preflight + 可审计 run-log」新契约，并改写现有 Context payload required scenarios（spec.md 108-138）
    status: completed
  - id: structural-guard
    content: init-orchestrate.ts 增 assertDecisionStructure，覆盖全部存在性+枚举/字面量字段（schema_version==='1.0'、scope、decision_mode、action∈VALID_ACTIONS、tasks 数组、每项 task_id/action），坏 decision 给友好错误而非 TypeError
    status: completed
  - id: atomic-preflight
    content: init-orchestrate.ts 增 preflightExecute（结构守卫+validateDecisionJson+payload 存在性与合法性：ensure-config 写动作调 validateFrameworkConfigWriteCandidate+跑通 sanitizeProjectConfigForInitWrite），失败时写可审计 run-log（全部 skipped/failed、除 harness 审计 run-log 外零项目写盘）并 exit 1；executeInitPlan 内原有 guard 保留为纵深防御
    status: completed
  - id: skill-temp-staging
    content: SKILL/命令模板改 OS 临时目录落点（os.tmpdir()/framework-init-<stamp>/）+ S3 绝对路径 + S4「成功或失败后均清理、仅调试保留并上报路径」；doc 决策措辞统一为 run/skip（无 overwrite）；同步 agents README/MIGRATION
    status: completed
  - id: tests
    content: init-orchestrate 单测加结构守卫各分支（缺 tasks、坏 schema_version/scope/decision_mode）与原子 preflight 用例（缺 docWritePayload→零写盘；缺/非法 configWritePayload(含非法 architecture)→preflight 阻断、零写盘；skip→放行）
    status: completed
  - id: review-bom-readjson
    content: review 跟进：readJsonFile 剥离 UTF-8 BOM（Windows PowerShell）；导出 readJsonFile 并补 decision/context 非法 JSON 文案与 BOM 单测 4 条
    status: completed
  - id: verify
    content: cd harness && npm test 全 PASS（498 unit）、npm run openspec:validate 通过；手验 preflight 原子阻断零写盘；S4 临时目录清理由 agent 遵守 SKILL
    status: completed
isProject: false
---

# Init staging 文件（decision/context）生命周期与健壮性修复

## 背景结论（已确认）
- `decision.json` / `context.json` 是 **S2→S3 的一次性 staging 契约**，不是项目资产。生成者 = 运行 Skill 00 的 AI agent（S2）；消费者 = [`init-orchestrate.ts`](harness/scripts/init-orchestrate.ts) S3；**销毁者当前缺失**。
- 片段 1（TypeError）= 坏 `decision.json`（缺 `tasks` 等）+ 入口缺 early validation，`reconcileInitRunDecisionForPlan`（line 127）先于校验执行。
- 片段 2（failed=4）= 现契约下「缺 `docWritePayload` → 该任务 `failed`、其它任务照常写盘」的设计，属 S2 不完整、init 未成功；但**会留下部分写盘**，体验差。

## 评审采纳与修正（基于图片意见）
- doc/config payload 校验是**行为级契约变更**，必须走 **OpenSpec**：现 `spec.md` 108-138 规定缺 payload→任务 `failed`、其它继续；新契约改为**原子**：preflight 不过则零写盘 + 写可审计 run-log。
- 落点改为 **OS 临时目录**：彻底消除根仓/submodule 首次运行 untracked 窗口，且不依赖 S3 的 `ensure-gitignore`（它本就排在 docs 之后）。**因此放弃 `.framework-init/` + canonical gitignore 改动**。
- 结构守卫须覆盖**枚举/字面量**：现 `validateDecisionJson` 不校验 `schema_version` 与 `decision_mode` 值；cast 类型不防胡。
- doc 任务写动作只有 `run`（[`init-task-planner.ts`](harness/scripts/utils/init-task-planner.ts) line 198 `allowed_actions: ['run','skip']`，无 `overwrite`）；计划措辞统一为 `run/skip`。片段 2 出现的 `overwrite` 说明**宿主 framework 版本与本仓源码已漂移**（旧版校验更松），不影响本仓改动。

## 改动一览

### 1. OpenSpec 提案（先行，BLOCKER）
- 用 `/opsx-propose` 或手建 `openspec/changes/<id>/`，新增/改写 `init-orchestration` 行为：
  - 新 Requirement：**Execute performs a no-side-effect preflight**——执行前依次校验「decision 结构+枚举」「plan 相对决策（`validateDecisionJson`）」「config/doc payload 的**存在性与合法性**（含 `ensure-config` 的 `validateFrameworkConfigWriteCandidate`/architecture DSL）」；任一失败则**除 harness 审计 run-log 外不修改任何项目业务/机制产物**，写一份 run-log（违规任务 `failed`、其余 `skipped`，附原因），`exit 1`。
  - **明确把 run-log 列为允许的审计副作用**：run-log 落在 `framework/harness/reports/_global/init-orchestrate/<stamp>/`（gitignored），不属于「项目产物」；契约措辞用「不修改项目业务/机制产物」而非「不修改任何项目文件」。
  - 改写现 `Requirement: Context payload required for config and doc writes` 的 scenario（`spec.md` 113-135，含 119-123「ensure-config fails on invalid architecture」）：失败由 **preflight 原子阻断**呈现，而非中途部分写盘；executor 内 guard 降级为纵深防御（正常流不可达）。
- `npm run openspec:validate` 必须通过。

### 2. 结构守卫（健壮性）
[`harness/scripts/init-orchestrate.ts`](harness/scripts/init-orchestrate.ts)
- **CLI 读取处统一包 `JSON.parse`（P3-1）**：`decision.json` / `context.json` 读取与解析放进 try/catch，原生 `SyntaxError` 转为友好错误而非裸栈；**两个文件文案分别区分**——decision 用 `[init-orchestrate] 决策 JSON 非法：无法解析 JSON（<file>）：<msg>`，context 用 `[init-orchestrate] 上下文 JSON 非法：无法解析 JSON（<file>）：<msg>`，避免 context 坏却提示「决策 JSON 非法」的误导。
- 新增导出 `assertDecisionStructure(raw): InitRunDecision`，`JSON.parse` 成功后立即调用：
  - 非对象 / `tasks` 缺失或非数组 / 任一 task 缺 `task_id`|`action` → 友好中文错误；
  - **枚举校验**：`schema_version === '1.0'`、`scope ∈ {project, personal}`、`decision_mode ∈ {smart, manual}`、每个 `action ∈ VALID_ACTIONS`。
- 杜绝 line 127 `decision.tasks.filter` 的 `TypeError`，并堵住 `decision_mode` 拼写错误被 `resolveTaskAction` 误判为 manual 的漏洞。

### 3. 原子 preflight（核心）
[`harness/scripts/init-orchestrate.ts`](harness/scripts/init-orchestrate.ts)
- 新增 `preflightExecute(plan, decision, context): { ok: true } | { ok: false; blocked: InitRunLog }`，对所有「写类任务」（`resolveTaskAction ∉ {skip, keep}`）做**存在性 + 合法性**校验：
  - `assertDecisionStructure`（已在 CLI 早调一次）→ `validateDecisionJson(plan, decision)`；
  - **doc 任务** `write-architecture`/`ensure-catalog`/`ensure-glossary`/`ensure-glossary-seed`：`docWritePayload[key]` 非空（存在性）；
  - **`ensure-config`**（P1 修正）：除 `configWritePayload` 存在外，调用 [`config.ts`](harness/config.ts) 的 `validateFrameworkConfigWriteCandidate(configWritePayload)`（内含 `validateArchitectureDsl`）并跑通 `sanitizeProjectConfigForInitWrite(configWritePayload)` 验证可落盘性——非法 architecture/字段即在 preflight 拦截；
  - 任一违规记 `failed`，其余记 `skipped`。
  - **未知 task_id 的 blocked run-log 规则（P3-2）**：`validateDecisionJson` 因 unknown task_id 失败时，该 task 不在 `plan.tasks` 中，无法按 plan 迭代标记——故以**校验错误本身**写一条合成 `failed` entry（`task_id` = 违规 id 或 `'<decision-validation>'`，message = 错误原文），plan 内所有任务记 `skipped`，保证审计日志直观且零项目写盘。
- **为何必须在 preflight 做 config 合法性**：`ensure-gitignore` 的 `deps: []`（planner line 209），非法 config 让 `ensure-config` 在 executor 阶段才 failed 时，无依赖的 `ensure-gitignore`/`harness-install` 仍会写盘，击穿「零写盘」。preflight 提前阻断可保证原子性。
- CLI 顺序：`parse → assertDecisionStructure → prepareInitExecutionPlanWithStaleIds → reconcile → preflightExecute`；
  - preflight 不过：`writeRunLog`（**仅写 harness 审计 run-log，零项目业务/机制产物写盘**）+ `buildRunSummary` 到 stderr + `exit 1`；
  - 通过：照常 `executeInitPlan`（其内 `validateDecisionJson` + `validateFrameworkConfigWriteCandidate` 保留为纵深防御）。
- run-log 复用现有 `'failed' | 'skipped'` 状态，不新增枚举（保持 `buildRunSummary` 与 spec 兼容）。

### 4. SKILL / 模板：OS 临时落点 + 生命周期
[`skills/00-framework-init/SKILL.md`](skills/00-framework-init/SKILL.md)
- S2.2 第 4 步：序列化到 **OS 临时目录**（POSIX `"$TMPDIR/framework-init-<stamp>/"`，Windows `"%TEMP%\framework-init-<stamp>\"`），给跨平台示例；**不再**落在 `framework/harness/` 或仓库内。
- S3 命令块：`--decision-file <abs-temp>/decision.json --context-file <abs-temp>/context.json`（绝对路径；`init-orchestrate.ts` 已 `path.resolve`，无需改 CLI 解析）。
- S4：新增「**成功或失败后均删除该临时目录**；仅需调试时保留并在 S4 上报其绝对路径」步骤（P2 修正——preflight `exit 1` 路径也要清理，避免 decision/context 滞留 OS temp），并说明 run-log 路径（`framework/harness/reports/_global/init-orchestrate/<stamp>/`，已 gitignore）。
- `## 阻塞与上报`：补「写类 doc/config 任务缺对应 payload → 执行前**原子阻断、零写盘**，须注入内容或在 S2 决策 skip」。
- doc 决策措辞统一为 `run/skip`（删除任何 `overwrite` 表述）。

同步主线文档（仅落点/生命周期表述）：
- [`agents/claude/templates/commands/framework-init.md`](agents/claude/templates/commands/framework-init.md) S3 行
- [`agents/README.md`](agents/README.md) 第 55 行 S3 描述
- [`MIGRATION.md`](MIGRATION.md) 第 151 行示例路径（改 OS 临时目录）

### 5. 测试
[`harness/tests/unit/init-orchestrate.unit.test.ts`](harness/tests/unit/init-orchestrate.unit.test.ts)
- CLI/解析层：**非合法 JSON 文件**（语法错误）→ 友好「无法解析 JSON」错误而非裸 `SyntaxError`（P3-1）；并断言 decision 坏 → 提示「决策 JSON」、context 坏 → 提示「上下文 JSON」，文案不混淆。
- `assertDecisionStructure`：缺 `tasks`、`tasks` 非数组、坏 `schema_version`、坏 `scope`、坏 `decision_mode`、task 缺 `task_id` → 各自抛友好错误。
- 未知 task_id（P3-2）：`preflightExecute` 返回 `ok:false`，blocked run-log 含一条合成 `failed`（违规 id）+ plan 内任务全 `skipped`，断言零项目写盘。
- `preflightExecute`：
  - doc 任务 `run` 但 `docWritePayload` 缺 → `ok:false`，blocked run-log 中该任务 `failed`、其余 `skipped`，且断言**未触达 executor / 零项目产物写盘（含 `.gitignore` 未被创建）**；
  - 同任务 `skip` → `ok:true`；
  - `ensure-config` `run` 但缺 `configWritePayload` → 原子阻断；
  - **`ensure-config` `run` 且 `configWritePayload.architecture` 非法**（如 `can_depend_on` 引用不存在层）→ preflight 阻断、`framework.config.json` 与 `.gitignore` 均零写盘（P1 关键回归用例）。
- 注：本次**不**改 [`canonical-gitignore.unit.test.ts`](harness/tests/unit/canonical-gitignore.unit.test.ts)（不动 gitignore，`length===19` 保持）。

## 前置基线 / git 卫生（与在途 hmos-app HSP 工作并存）
- 工作区存在不相关的在途改动（`profiles/hmos-app/**` HSP/HAR 库形态 + `openspec/specs/harness-gates/spec.md` + `harness/scripts/utils/types.ts` 注释）。**与本计划零文件重叠、零逻辑耦合**。
- 实施前先建**绿基线**：`cd harness && npm test`（`run-unit.ts` 会自动发现 `profiles/hmos-app/harness/tests/unit/hsp-library-format.unit.test.ts` 等 profile 单测与新 fixtures）+ `npm run openspec:validate`，以区分在途红灯与本改动。
- 提交时**仅暂存本计划自身文件**（init-orchestrate.ts、SKILL.md、新 openspec change、init-orchestrate.unit.test.ts 等），不得裹挟 HSP 在途改动。

## 验收（AGENTS.md BLOCKER）
- 文本文件保持 **LF**。
- `cd harness && npm test` 全 PASS。
- `npm run openspec:validate`（`--all --strict`）通过。
- 手验：① 缺 `tasks` 的 decision → 友好报错而非 TypeError；② doc 任务 `run` 但无 `docWritePayload` → 执行前原子阻断、`framework.config.json`/`.claude/`/`.gitignore` 等**零变更**、run-log 可审计；③ 非法 architecture 的 `configWritePayload` → preflight 阻断、零写盘；④ preflight 失败后临时目录被清理（或上报保留路径）。

## 范围说明
- `run-global-phases` 与 doc 任务无 DAG 依赖（片段 2 仍 `executed`）的隐患：原子 preflight 落地后，缺 doc payload 会在执行前整轮阻断，该路径自然不再发生；**不**单独再改 DAG 依赖。
- 宿主 WalletForHarmonyOS 的 framework 版本漂移（doc 任务出现 `overwrite`）属消费者升级问题，不在本仓改动内；可在 S4/迁移说明里提示重新同步 framework。

## 实施状态（2026-06-02 闭环）

- 全部 plan todo **completed**；`.framework-init/` + canonical gitignore 方案按评审结论**放弃**（改用 OS 临时目录）。
- review 追加：`readJsonFile` UTF-8 BOM 兼容 + 4 条单测；`npm test` 498 unit PASS，`openspec:validate` 9/9 PASS。
- 未纳入 harness 代码：S4 删除 OS 临时目录（agent 按 SKILL 执行）；OpenSpec change 待 `/opsx-archive` 归档（可选后续）。

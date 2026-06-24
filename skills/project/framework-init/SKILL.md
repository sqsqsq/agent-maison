# Framework 工程初始化 Skill (`framework-init`)

## 前置声明

- **项目级 init**：在实例工程根生成/升级 `framework.config.json`、`materialized_adapters[]` 物化产物、架构与 catalog/glossary 骨架；**不写** personal `framework.local.json`。
- **个人 active adapter** 由各阶段入口 `check-personal-setup.ts --json --ensure` 内联完成（过程见 [personal-setup-gate](../../reference/personal-setup-gate.md)）。
- 执行前 **`<repo-root>/framework/harness/harness-runner.ts` 必须存在**；否则 S1 只读探测后停下，提示 submodule / 拷贝。
- 架构 DSL 契约见 [framework/harness/config.ts](../../../harness/config.ts)（`validateArchitectureDsl`）。

## 概述

在**已有真实代码树**的工程里实例化 `framework/` 资产：**只读探测 → 计划批准 → 确定性执行 → 结构化摘要**。交互须 registry enum/checkbox（[confirmation-registry.yaml](../../reference/confirmation-registry.yaml) · [user-confirmation-ux.md](../../reference/user-confirmation-ux.md)），**禁止** Q1=y / 自由路径字符串。

**产物写在实例工程根**；adapter 模板来自 `framework/agents/<name>/`，不写回 framework 本体。

## 触发条件

- Slash：`/framework-init`
- 自然语言：「接入 framework / 生成 framework.config.json / 升级 framework」
- CREATE（无 config）或 UPDATE（已有 config）

---

## 进入 S1 前：Tier_1 readiness（BLOCKER）

> `npm install` 会写 `framework/harness/node_modules`，**不属于** S1 只读探测；见 [host-harness-readiness.md](../../reference/host-harness-readiness.md) Tier_1。

在 `framework/harness` 下运行机器探测（**不**自动安装）：

```bash
cd framework/harness && node scripts/init-readiness.mjs
```

- 解析 stdout JSON：`ok` / `missing` / `recommended_command` / `recommended_cwd` / `recommended_executable` / `recommended_args` / `harness_root`。
- 须同时满足：`node_modules/ts-node/package.json`、`node_modules/@types/node/package.json`、`package.json` 存在，且 cwd 为 `framework/harness`。
- 若 `ok=false`：优先用 `recommended_cwd` + `recommended_executable` + `recommended_args` 构造安装命令（避免 cwd 已在 `framework/harness` 时再次 `cd framework/harness`）；亦可执行 `recommended_command`（`cd framework/harness && npm install`），成功后再进入 S1。
- **`ok=false` 之前禁止**裸跑 `npx ts-node scripts/init-orchestrate.ts`（`npx` cache 回落会掩盖未安装，导致 TypeScript 编译失败）。
- `ok=true` 后，所有 harness CLI 须在 `framework/harness` 下用 `npx ts-node scripts/...`。

**Shell cwd（BLOCKER）** — 见 [harness-cli-cwd.md](../../reference/harness-cli-cwd.md) §2：

- `npm install` 完成后 shell cwd **已在** `framework/harness` 时，**禁止**再次 `cd framework/harness && ...`（会拼成 `framework/harness/framework/harness/...`）。
- 合法接续：直接 `node scripts/init-readiness.mjs`；或 `cd <repo-root>` 后用根相对路径；或用 stdout 的 `harness_root` 构造绝对路径命令。
- Agent 调用 `npm install` 建议 timeout ≥ 5m；**超时后必须**重跑 `init-readiness.mjs` 验证 `ok`，不可假设失败。

---

## S1. 探测（只读 · BLOCKER）

> Shell 调用 harness 须遵守 [reference/harness-cli-cwd.md](../../reference/harness-cli-cwd.md)。

### S1.1 环境

- 无 `framework/` → **STOP**，提示 `git submodule add … framework`。
- 读 [prompts/scan-project.md](prompts/scan-project.md) 扫描工程（模块清单、目录层命名、已有 doc 资产）；输出**一屏人话摘要**。
- 若 config 磁盘 MISSING 且为 git 仓：可选跑 `show-last-committed-framework-config.mjs` 得 `recovered_framework_config` 快照（仅预填，不写盘）。

### S1.2 Planner（零写盘）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project --project-root <repo-root>
```

解析 stdout **`InitTaskPlan` JSON**（含 `mode: create|update`、`tasks[]`）。**禁止**在 S1 调用 `ensure-gitignore`、adapter 拷贝、config 写入或 `check-init` 非 skip 副作用。

### S1.3 渲染任务表

向用户展示 planner 任务表（id / title / status / deps）。`POPULATED`/`drift` 行附 harness 诊断摘要；**不得**口头编造 MISSING/EMPTY/POPULATED（init-diff Hallucination Ban）。

---

## S2. 计划批准（enum · BLOCKER）

### S2.1 收集项目元数据（写入 `configWritePayload`，供 S3）

在批准计划前完成（registry 见下表）。**S3 落盘**由 harness [`config-builder.ts`](../../../harness/scripts/utils/config-builder.ts) 确定性合成完整 `framework.config.json`（`prepareConfigWriteForTask`）；AI **只提供结构化输入**，**不要**在 `configWritePayload` 里手写框架结构默认字段。

| 主题 | Registry / 参考 | 写入 `configWritePayload` |
|------|-----------------|---------------------------|
| `project_profile` | `init.project_profile`（registry 编号选 preset） | `{ name, sub_variant? }` |
| `project_name` | S1 探测 / 用户确认 | 字符串（**必填**） |
| 架构 DSL | `init.architecture_preset` + `init.intra_layer_deps` + [prompts/architecture-presets.md](prompts/architecture-presets.md) | `architecture` 对象（**必填**） |
| 物化 adapter 清单 | `init.materialized_adapters`（多选 checkbox） | `materialized_adapters[]` |
| paths 覆盖（可选） | 仅当实例目录结构偏离默认 | `paths` 子集 |
| `spec`（可选） | opt-in，见 [spec-harness-options](prompts/spec-harness-options.md) | `spec` 段（Visual Handoff 等；legacy `prd` 段 init UPDATE 会自动迁移） |

**由 builder 自动注入（勿写入 payload）**：`schema_version`、`state_machine.*`、`toolchain.hvigor.*`、`active_workflow`、`lifecycle_hooks_enabled`、默认 `paths.*`（未覆盖项）、profile-owned `tools.*`（仅 hmos-app 等 profile 的 config-defaults）。参考 [framework.config.template.json](../../../templates/framework.config.template.json) 作对照，非手写清单。

非标架构 → **STOP → 手动编辑 config 后重跑**（见 architecture-presets 选项 D）。

**`generic` adapter**（两段式，**禁止**因缺省 bundle 路径而 STOP 或从 `materialized_adapters` 剔除）：
- **默认**：无自定义需求时，将 template 默认 `paths.agent_bundle_root: ".agents"`、`agent_bundle_skill_mode: "bridge"` 写入 `configWritePayload`，并继续物化 `generic`（harness 探测亦回退 `.agents`/bridge）。
- **例外**：仅当用户**显式要求**非标 `agent_bundle_root` 时，**STOP → 手动编辑 `framework.config.json` 后重跑**（禁止对话收路径字符串）。

读 `framework/profiles/<profile>/skills/framework-init/profile-addendum.md`（若存在）；**工具链 installPath 不在本 Skill 写**——走 personal setup。

### S2.2 决策模式与任务批准

1. **`init.task_plan`**（gate）：智能模式 / 手动模式 / 跳过可跳过项。

<!-- adapter-candidates:start -->
2. **`init.materialized_adapters`**（**BLOCKER · 每轮必问**）：至少 1 项。**选项 = S1 `InitTaskPlan.adapter_catalog[]` 原样渲染**（`value` / `label` / `portable`；禁止写死成员名）。**即使** `framework.config.json` 已有 `materialized_adapters`，UPDATE / 跨会话仍须在本轮经 registry **`init.materialized_adapters`** 多选收到本轮清单；**禁止**「当前已物化 X，无需新增」后跳过。
- **Widget**：`adapter_catalog` 每项映射为 checkbox / 多选 option（label 逐字来自 catalog）；仅当 `adapter_catalog.length` ≤ `CURSOR_ASKQUESTION_MULTISELECT_MAX` 时单次 widget 承载全部项。
- **Portable fallback（BLOCKER）**：当 `adapter_catalog.length` > `CURSOR_ASKQUESTION_MULTISELECT_MAX`（SSOT：`harness/scripts/utils/adapter-catalog.ts`；见 user-confirmation-ux §4.1）时，**以编号多选为主**（`1..N` 对应 catalog 顺序，逗号分隔如 `1,3,5`）；同轮仍附完整编号菜单；widget **须分页**（每页 ≤`CURSOR_ASKQUESTION_MULTISELECT_MAX`）或省略 widget。
<!-- adapter-candidates:end -->
   - **同轮合并（推荐）**：当 `init.task_plan` 不改变 `init.materialized_adapters` 的选项列表（无前后依赖）时，可在**一次** registry 交互中同时发出两题；**两 registry 的 answer 仍须各自独立记录**（不得合并语义或只记一项）。
3. **手动模式**：对每个 `drift` 任务用 **`init.task_decision`**（覆盖 / 保留），**禁止** Q1=y 逐项打字。
4. 选择 S3 路径：
   - **智能 UPDATE 快捷路径（推荐）**：当 `plan.mode === "update"`、决策模式为 smart、且无需额外 `docWritePayload` 时，不写 OS staging 文件；S3 直接使用 `--smart-auto --materialized-adapters <S2 多选逗号分隔>`。推荐显式传 `--smart-auto`；CLI 对漏写 `--smart-auto` 的自动推断仅作兼容容错，Agent 不得长期依赖隐式改道。
   - **通用 staging 路径**：CREATE、手动模式、或需要 `docWritePayload` 时，序列化为 **`InitRunDecision` JSON** + **`context.json`**，写入 **OS 临时目录**（一次性 staging，非项目资产）。
   - POSIX：`$TMPDIR/framework-init-<stamp>/decision.json` 与 `context.json`
   - Windows：`%TEMP%\framework-init-<stamp>\decision.json` 与 `context.json`
   - **禁止**落在 `framework/harness/` 或实例工程根内持久路径
   - `--decision-file` / `--context-file` **须为绝对路径**（OS 临时目录）；CLI 会拒绝相对路径与 `framework/harness` 内路径
   - `decision.json` **必须**含非空 `materialized_adapters`（机器门禁；与 context 清单集合一致）
   - `context.json` **禁止**含 `projectRoot` / `harnessRoot` / `plan`；示例见 [templates/staging-schema-example.md](templates/staging-schema-example.md)
   - 生成待补全骨架：`cd framework/harness && npx ts-node scripts/init-orchestrate.ts --emit-staging-template --scope project --project-root <repo-root> --materialized-adapters <S2 多选逗号分隔>`（**不带** `--context-file`）；stdout 拆分写两文件。**UPDATE** 时 stdout `context` 可能已含磁盘预填的最小 `configWritePayload`（仍须 S2 多选写入 `decision.materialized_adapters`）
   - **通用路径预览 SSOT（BLOCKER）**：若本轮走通用 staging 路径，`init.materialized_adapters` 多选**之后**，须运行上述 `--emit-staging-template --materialized-adapters ...`；per-task action 必须来自 stdout `decision.tasks[].action`（harness `resolveTemplateAction`），**禁止** Agent 自行推导。类别级摘要（下表）仅作面向用户的结构化复述。
   - 禁止沿用旧结构 `mode` / `task_decisions` / 根级无 `schema_version` 的 staging

`auto_overwrite` 机制段由 planner 标为 `sync-auto-overwrite:*`，智能模式下自动执行，不进手动逐项菜单。

### S2.3 决策复述

写入或进入 S3 前须结构化复述（user-confirmation-ux §3.6）：mode、materialized_adapters、决策模式，并按**任务类别**说明动作（**禁止**写「drift 全部 overwrite」）：

registry `init.task_plan` / `init.materialized_adapters` / `init.task_decision` 的选择即为 S2 批准记录；复述完成后直接进入 S3，**禁止**再追加「确认后进入 S3？」等二次 yes/no 确认。

| 类别 | 智能模式动作说明 |
|------|------------------|
| config / adapter 机制项（drift） | overwrite 或 run |
| doc drift（POPULATED 且 default skip） | skip（保留磁盘） |
| satisfied | skip |
| required mechanism | run |

---

## S3. 执行（harness 确定性）

### S3 通用方式（CREATE / 手动模式 / 需 docWritePayload）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project \
  --project-root <repo-root> \
  --execute \
  --decision-file <abs-temp-dir>/decision.json \
  --context-file <abs-temp-dir>/context.json
```

### S3 智能模式快捷（UPDATE + 智能模式 + 无额外 docWritePayload）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project \
  --project-root <repo-root> \
  --smart-auto \
  --materialized-adapters <S2 多选结果逗号分隔>
```

内部自动 probe → 临时上下文 → preflight → `executeInitPlan`；**不创建外部 OS staging 目录**，stdout 即 S4 摘要（无需额外 CLI 调用）。

> 通用方式中的 `<abs-temp-dir>` = S2 写入的 OS 临时目录绝对路径（见 S2.2 第 4 步）。须用绝对路径，因 shell cwd 在 `framework/harness`。

- S3 执行器：`executeInitPlan` → `init-task-executor.ts`（gitignore、config merge、adapter 物化、deprecated cleanup、npm install、全局 phase 等）。
- S3 **preflight**：`init-orchestrate.ts` 在写盘前校验 decision 结构与 config/doc payload；违规时**除 harness 审计 run-log 外零项目写盘**，写 blocked run-log 后 `exit 1`。
- **`configWritePayload` / `docWritePayload`**：CREATE 须在 S2 写入 `context.json`；**UPDATE** 可依赖 emit 预填或 S2 显式 payload，execute 阶段 harness 亦会从磁盘派生最小 payload（S2 显式优先）。写类 doc 任务（`run`）缺 payload → preflight 原子阻断。
- preflight 与 executor **共用**同一归一化 `finalContext`（先 cross-check raw adapter，再 sync decision SSOT）。
- doc 骨架（`write-architecture` / catalog / glossary）若 planner 标记为 needed 且 context 未带内容 → 按 [profiles/.../doc-skeletons/](../../../profiles/) 或用户确认稿本写入后再重跑 S3，或在 S2 决策 **skip** 并在 S4 说明。
- **失败任务**：摘要中列出；不静默吞掉 `failed` 条目。

---

## S4. 摘要（harness 生成）

- S3 执行命令的 **stdout** 即为 `buildRunSummary` 摘要（**无需额外 CLI 调用**）；摘要必须包含 `run_log` 与 `summary` 路径，同时 harness 写入 `harness/reports/_global/init-orchestrate/*/run-log.json` 与 `summary.md`。
- **清理 staging**：通用 staging 路径无论 S3 成功或 preflight/执行失败，**均删除** S2 的 OS 临时目录（`<abs-temp-dir>`），并在 S4 汇报“已清理”；顺带 sweep 并删除 `framework/harness/` 根下可能误落的残留 staging（`decision.json` / `context.json` / `init-decision.json` / `init-context.json`），并在摘要汇报；仅调试需要时可汇报“保留用于调试：<abs-temp-dir>”。`--smart-auto` 路径应汇报“未创建外部 staging 目录”。
- 汇报：跳过项、migration/backfill 结果、物化 adapter 列表、全局 phase 结果。
- **UPDATE 遗留跳板清理**：`cleanup-deprecated` 会 `backup_delete` 语义旧跳板（如 `prd-design`、`requirement-design`），保留现行扁平名（`spec`、`plan`、`coding` 等）。若 S3 执行了该任务，摘要须引用 run-log 中 `cleanup_effects.backup_deleted` 计数；有备份时注明 `.framework-backup/<timestamp>/` 路径（S1 probe 仅提示「将清理」，以 S3 run-log 为准）。**跳过** `cleanup-deprecated` 则旧跳板仍留在实例根。
- **S4 已闭环（BLOCKER）**：`buildRunSummary` 汇报完成后 init 编排结束；**禁止**在摘要或下一步之后另附 **编号菜单 (portable)**、`init.task_plan` / `init.materialized_adapters` 等 S2 registry 脚注（`portable_required` 仅适用于**同轮仍在提问**的交互，不适用于已执行完的 S4）。
- **下一步（MUST verbatim）**：harness `buildRunSummary` / `summary.md` 在任务表与合计行之后输出 **「必须处理」** 与/或 **「可选下一步」** 分节（由 `run-log.json` 的 `next_steps` 经 `renderNextStepsMarkdown` 生成）。Agent **MUST** 原样复述这两节，**禁止**自行编造固定 phase 列表。
- **禁止**在 init 摘要末尾询问「是否现在进入 catalog-bootstrap / spec」等默认推进话术；须等待用户明确选择下一阶段。
- UPDATE 且改了 `paths.receipt_dir_pattern` 或 `paths.reports_dir_pattern` 时：advisory 扫描 legacy receipt / report 路径（`reconcile-receipt-paths.ts` dry-run）。

---

## Config 写盘模型（UPDATE 必读）

| 场景 | 写盘路径 | 机制 |
|------|----------|------|
| CREATE | `ensure-config run` | config-builder 合成（BACKFILL 默认 + S2 payload） |
| UPDATE overwrite | `ensure-config overwrite` | config-builder 整文件重写（derive 保留显式 `paths` / `tools` + BACKFILL 补缺） |
| UPDATE keep | 跳过 ensure-config | merge-framework-config 三 pass（backfill / migrate / confirm） |

关键约束：

- overwrite **不经过** merge-framework-config，但 overwrite 后 `backfill-config` / `migrate-config` 仍按 DAG 顺序执行。
- **默认值变更不得覆盖显式配置**：derive payload 保留磁盘 `paths` / `tools`；框架默认值变更仅通过 BACKFILL（补缺）+ MIGRATION（modernize 已知旧默认）推进。


## 核心设计原则

1. **探测 → 批准 → 执行 → 摘要**；Side effects 仅在 S3 批准后。
2. **双 adapter 概念**：`materialized_adapters[]`（项目，提交） vs personal `agent_adapter`（local，setup）。
3. **提交产物隔离**：物化每个 adapter 时 render-env 用**该 adapter**，不用 local active adapter。
4. **`.gitignore`**：由 executor `ensure-gitignore` 维护 canonical patterns（含 `framework.local.json`）。
5. **`profile-skill-asset:`** 占位符按 [Profile skill asset protocol](../../../README.md#profile-skill-asset-protocol) 解析。

---

## UPDATE 模式要点

1. **改 DSL**：S2 重新确认 `init.intra_layer_deps`；提醒 harness 行为变化。
2. **增删 materialized adapter**：S2 **每轮**经 `init.materialized_adapters` 多选确认清单（与 profile-addendum §5.6.3 installPath 同等纪律）；旧 adapter 遗留目录**列给用户**，不自动删除。
3. **config 升级**：planner 自动挂 `backfill-config` / `migrate-config`（含 personal 外迁 migration）。
4. **显式 skip satisfied 依赖**：对已 `status: satisfied` 的依赖任务（如 `harness-install`）可标 `skip`，preflight 不因依赖闭包误阻。

---

## 阻塞与上报（BLOCKER）

- 无法通过 `validateArchitectureDsl` → 不得写入 config（S3 preflight 会原子阻断）。
- 写类 doc/config 任务缺对应 `docWritePayload` / `configWritePayload` → S3 preflight **原子阻断、零项目写盘**；须注入内容或在 S2 决策 skip。
- S1 写盘 / 口头编造体检结果 → 严禁。
- 未经 S2 批准执行 S3 → 严禁。
- 覆盖 POPULATED 的 `doc/module-catalog.yaml` / `doc/glossary.yaml` / `doc/glossary-seed.txt` / 用户迭代的 `doc/architecture.md` → 除非 S2 显式 overwrite。
- CREATE 命中大量 POPULATED 且用户拒绝降级 → 终止 init。
- S3 `harness-install` 的 `npm install` 失败 → 不得宣称 init 完成。
- S3 `run-global-phases` 失败（catalog/glossary/docs 任一 FAIL）→ 不得宣称 init 完成。
- 消费者完成 init 后可 `cd framework/harness && npm test`（= `check:global`）验证元数据完整性。
- **禁止** Q1=y、裸 `y/好/继续` 作为多任务批准。
- **禁止** init/setup 对话收集 architecture DSL / 自定义 paths / 模块名字符串数组；仅 preset、磁盘快照、`init.intra_layer_deps` enum/matrix，或 STOP 后手动编辑 config（见 [templates/custom-architecture-questionnaire.md](templates/custom-architecture-questionnaire.md)）。
- **禁止**把 UPDATE 中保留的既有 `architecture` / `intra_layer_deps` 复述为 profile 默认 preset；应表述为“沿用已有 architecture DSL”。仅当 S2 明确选择预设时，才可使用 preset 说法。
- **禁止**因 harness 已提供默认值的可选字段（如 generic 的 `paths.agent_bundle_root`）缺失，而将用户已在 `init.materialized_adapters` 中选中的 adapter STOP 或剔除；personal active adapter 与项目物化清单无关。

---

## 关联文件

| 类型 | 路径 |
|------|------|
| 编排 CLI | [framework/harness/scripts/init-orchestrate.ts](../../../harness/scripts/init-orchestrate.ts) |
| 任务执行器 | [framework/harness/scripts/utils/init-task-executor.ts](../../../harness/scripts/utils/init-task-executor.ts) |
| Adapter 协议 | [framework/agents/adapter-schema.yaml](../../../agents/adapter-schema.yaml) |
| Config 模板 | [framework/templates/framework.config.template.json](../../../templates/framework.config.template.json) |
| 扫描 / 架构 | [prompts/scan-project.md](prompts/scan-project.md)、[prompts/architecture-presets.md](prompts/architecture-presets.md) |
| Staging 示例 | [templates/staging-schema-example.md](templates/staging-schema-example.md) |
| Personal setup | [personal-setup-gate/SKILL.md](../../reference/personal-setup-gate.md) |

---

## CLI / 自动化备注

Trace 字段见 [framework/harness/trace/trace.schema.json](../../../harness/trace/trace.schema.json)；phase 可记 `framework-init`。

**中文输出。**

# Framework 工程初始化 Skill (`00-framework-init`)

## 前置声明

- **项目级 init**：在实例工程根生成/升级 `framework.config.json`、`materialized_adapters[]` 物化产物、架构与 catalog/glossary 骨架；**不写** personal `framework.local.json`。
- **个人 active adapter** 由各阶段入口 `check-personal-setup.ts --json --ensure` 内联完成（过程见 [00b-framework-setup](../00b-framework-setup/SKILL.md) · [personal-setup-gate](../reference/personal-setup-gate.md)）。
- 执行前 **`<repo-root>/framework/harness/harness-runner.ts` 必须存在**；否则 S1 只读探测后停下，提示 submodule / 拷贝。
- 架构 DSL 契约见 [framework/harness/config.ts](../../harness/config.ts)（`validateArchitectureDsl`）。

## 概述

在**已有真实代码树**的工程里实例化 `framework/` 资产：**只读探测 → 计划批准 → 确定性执行 → 结构化摘要**。交互须 registry enum/checkbox（[confirmation-registry.yaml](../reference/confirmation-registry.yaml) · [user-confirmation-ux.md](../reference/user-confirmation-ux.md)），**禁止** Q1=y / 自由路径字符串。

**产物写在实例工程根**；adapter 模板来自 `framework/agents/<name>/`，不写回 framework 本体。

## 触发条件

- Slash：`/framework-init`
- 自然语言：「接入 framework / 生成 framework.config.json / 升级 framework」
- CREATE（无 config）或 UPDATE（已有 config）

---

## S1. 探测（只读 · BLOCKER）

> Shell 调用 harness 须遵守 [reference/harness-cli-cwd.md](../reference/harness-cli-cwd.md)。

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

在批准计划前完成（registry 见下表）：

| 主题 | Registry / 参考 | 写入 |
|------|-----------------|------|
| `project_profile` | `init.project_profile`（registry 编号选 preset） | `framework.config.json` |
| 项目名 / paths / state_machine | S1 探测快照 + [framework.config.template.json](../../templates/framework.config.template.json) 默认值；非标字段 **STOP → 手动编辑 config 后重跑** | 同上 |
| 架构 DSL | `init.architecture_preset` + `init.intra_layer_deps` + [prompts/architecture-presets.md](prompts/architecture-presets.md) | `architecture` 段 |
| 物化 adapter 清单 | `init.materialized_adapters`（多选 checkbox） | `materialized_adapters[]` |

**`generic` adapter**（两段式，**禁止**因缺省 bundle 路径而 STOP 或从 `materialized_adapters` 剔除）：
- **默认**：无自定义需求时，将 template 默认 `paths.agent_bundle_root: ".agents"`、`agent_bundle_skill_mode: "bridge"` 写入 `configWritePayload`，并继续物化 `generic`（harness 探测亦回退 `.agents`/bridge）。
- **例外**：仅当用户**显式要求**非标 `agent_bundle_root` 时，**STOP → 手动编辑 `framework.config.json` 后重跑**（禁止对话收路径字符串）。

读 `framework/profiles/<profile>/skills/00-framework-init/profile-addendum.md`（若存在）；**工具链 installPath 不在本 Skill 写**——走 personal setup。

### S2.2 决策模式与任务批准

1. **`init.task_plan`**（gate）：智能模式 / 手动模式 / 跳过可跳过项。
2. **`init.materialized_adapters`**：至少 1 项（`claude` / `cursor` / `generic`）。
3. **手动模式**：对每个 `drift` 任务用 **`init.task_decision`**（覆盖 / 保留），**禁止** Q1=y 逐项打字。
4. 序列化为 **`InitRunDecision` JSON** + **`context.json`**（含 `configWritePayload`、`materializedAdapters`、`confirmAnswers` 等），写入 **OS 临时目录**（一次性 staging，非项目资产）：
   - POSIX：`$TMPDIR/framework-init-<stamp>/decision.json` 与 `context.json`（`<stamp>` 建议 ISO 时间戳去冒号，如 `20260602T091500Z`）
   - Windows：`%TEMP%\framework-init-<stamp>\decision.json` 与 `context.json`
   - **禁止**落在 `framework/harness/` 或实例工程根内持久路径
   - 可用 `init-orchestrate.ts --emit-staging-template --context-file <abs-temp-dir>/context.json` 生成合法 `{ decision, context }` 骨架；禁止沿用旧结构 `mode/task_decisions/materialized_adapters`

`auto_overwrite` 机制段由 planner 标为 `sync-auto-overwrite:*`，智能模式下自动执行，不进手动逐项菜单。

### S2.3 决策复述

写入或进入 S3 前须结构化复述（user-confirmation-ux §3.6）：mode、materialized_adapters、决策模式、将被覆盖的 drift 任务列表。

---

## S3. 执行（harness 确定性）

```bash
cd framework/harness && npx ts-node scripts/init-orchestrate.ts \
  --scope project \
  --project-root <repo-root> \
  --execute \
  --decision-file <abs-temp-dir>/decision.json \
  --context-file <abs-temp-dir>/context.json
```

> `<abs-temp-dir>` = S2 写入的 OS 临时目录绝对路径（见 S2.2 第 4 步）。须用绝对路径，因 shell cwd 在 `framework/harness`。

- S3 执行器：`executeInitPlan` → `init-task-executor.ts`（gitignore、config merge、adapter 物化、deprecated cleanup、npm install、全局 phase 等）。
- S3 **preflight**：`init-orchestrate.ts` 在写盘前校验 decision 结构与 config/doc payload；违规时**除 harness 审计 run-log 外零项目写盘**，写 blocked run-log 后 `exit 1`。
- **`configWritePayload` / `docWritePayload`** 须在 S2 收集并写入 `context.json`；写类 doc 任务（`run`）缺 payload → preflight 原子阻断。
- doc 骨架（`write-architecture` / catalog / glossary）若 planner 标记为 needed 且 context 未带内容 → 按 [profiles/.../doc-skeletons/](../../profiles/) 或用户确认稿本写入后再重跑 S3，或在 S2 决策 **skip** 并在 S4 说明。
- **失败任务**：摘要中列出；不静默吞掉 `failed` 条目。

---

## S4. 摘要（harness 生成）

- 使用 CLI 输出的 **`buildRunSummary(run-log)`** + `harness/reports/_global/init-orchestrate/*/summary.md`。
- **清理 staging**：无论 S3 成功或 preflight/执行失败，**均删除** S2 的 OS 临时目录（`<abs-temp-dir>`）；仅调试需要时在 S4 向用户上报其绝对路径后再删。
- 汇报：跳过项、migration/backfill 结果、物化 adapter 列表、全局 phase 结果。
- **下一步（须用户确认，禁止自动开下游 Skill）**：
  1. 提醒团队成员：首次跑 catalog/prd 等阶段时 `--ensure` 会自动写入 personal adapter（多 adapter 时选一次）。
  2. `/catalog-bootstrap`、`/glossary-bootstrap`。
  3. `/prd-design` 及后续 phase。
- UPDATE 且改了 `paths.reports_dir_pattern` 时：advisory 扫描 legacy receipt 路径（`reconcile-receipt-paths.ts` dry-run）。

---

## 核心设计原则

1. **探测 → 批准 → 执行 → 摘要**；Side effects 仅在 S3 批准后。
2. **双 adapter 概念**：`materialized_adapters[]`（项目，提交） vs personal `agent_adapter`（local，setup）。
3. **提交产物隔离**：物化每个 adapter 时 render-env 用**该 adapter**，不用 local active adapter。
4. **`.gitignore`**：由 executor `ensure-gitignore` 维护 canonical patterns（含 `framework.local.json`）。
5. **`profile-skill-asset:`** 占位符按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

---

## UPDATE 模式要点

1. **改 DSL**：S2 重新确认 `init.intra_layer_deps`；提醒 harness 行为变化。
2. **增删 materialized adapter**：S2 多选更新清单；旧 adapter 遗留目录**列给用户**，不自动删除。
3. **config 升级**：planner 自动挂 `backfill-config` / `migrate-config`（含 personal 外迁 migration）。

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
- **禁止**因 harness 已提供默认值的可选字段（如 generic 的 `paths.agent_bundle_root`）缺失，而将用户已在 `init.materialized_adapters` 中选中的 adapter STOP 或剔除；personal active adapter 与项目物化清单无关。

---

## 关联文件

| 类型 | 路径 |
|------|------|
| 编排 CLI | [framework/harness/scripts/init-orchestrate.ts](../../harness/scripts/init-orchestrate.ts) |
| 任务执行器 | [framework/harness/scripts/utils/init-task-executor.ts](../../harness/scripts/utils/init-task-executor.ts) |
| Adapter 协议 | [framework/agents/adapter-schema.yaml](../../agents/adapter-schema.yaml) |
| Config 模板 | [framework/templates/framework.config.template.json](../../templates/framework.config.template.json) |
| 扫描 / 架构 | [prompts/scan-project.md](prompts/scan-project.md)、[prompts/architecture-presets.md](prompts/architecture-presets.md) |
| Personal setup | [00b-framework-setup/SKILL.md](../00b-framework-setup/SKILL.md) |

---

## CLI / 自动化备注

Trace 字段见 [framework/harness/trace/trace.schema.json](../../harness/trace/trace.schema.json)；phase 可记 `framework-init`。

**中文输出。**

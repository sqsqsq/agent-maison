---
name: Framework Init 编排化重构
overview: 把 framework-init 从「固定11项体检+策略矩阵+批量Q」重构为「探测→harness确定性产出任务DAG→用户勾选批准计划+选枚举参数+选决策模式→按流带闸门执行→结构化摘要」的原子化任务编排模型；并把个人化配置（agent_adapter / DevEco 路径）从项目级 config 剥离到 gitignored 本地文件，将 init 拆成「项目级 init」与「个人级 setup」两条独立流程。
todos:
  - id: openspec-propose
    content: "Phase 0: 走 OpenSpec /opsx-propose 创建本重构 change（proposal/design/specs/tasks）"
    status: completed
  - id: config-split
    content: "Phase 1: 配置持久化拆分 — framework.local.json schema/template + materialized_adapters(项目) vs agent_adapter(local) 双概念 + loadFrameworkConfig merge & 缓存失效 + local schema 校验 + gitignore + 个人字段外迁 migration + 测试改向"
    status: completed
  - id: orchestrator
    content: "Phase 2: 编排器 — 抽出 inspector 并强制纯只读探测，副作用(gitignore/cleanup/sync)下沉为DAG任务；init-task-planner.ts 产出任务DAG JSON + init-orchestrate.ts CLI(只认枚举decision JSON) + run-log + 摘要 + 单测"
    status: completed
  - id: decision-registry
    content: "Phase 3: rebase到已落地交互层 — 增量加 init.task_plan/init.task_decision/setup.*/init.materialized_adapters，下线 Q1=y 自由输入，renderer 仅补编排特例"
    status: completed
  - id: project-init-skill
    content: "Phase 4: 项目级 init SKILL 重写为 4 大步(S1探测/S2计划批准/S3执行/S4摘要)，无1.x小数子步 + 多 adapter 物化(materialized_adapters驱动)"
    status: completed
  - id: personal-setup
    content: "Phase 5: 个人级 setup 新 Skill + framework-setup 命令 + 首次使用 bootstrap 检测"
    status: completed
  - id: commands-cleanup
    content: "Phase 6: 命令/产物拆分（init vs setup）三 adapter 同步 + 下游 runner local-merge 验证"
    status: completed
  - id: tests-migration-docs
    content: "Phase 7: harness fixtures + 消费者迁移 smoke + 文档（agents/README、docs、release-checklist）"
    status: completed
isProject: false
---

# Framework Init 编排化重构

## 设计总览

把单一巨型流水线拆成两条原子流程 + 一个确定性编排器：

```mermaid
flowchart TB
  subgraph orch [编排器 harness/TS 确定性]
    probe[探测工程状态] --> plan[产出任务DAG JSON]
  end
  subgraph proj [项目级 init - 集成者1次, 产物提交]
    plan --> pconfirm[渲染计划widget+选决策模式] --> pexec[按流执行+闸门] --> psum[结构化摘要]
  end
  subgraph pers [个人级 setup - 每人首次用时]
    plan --> sconfirm["选adapter+选探测到的DevEco候选"] --> sexec["校验已物化产物/记录路径"] --> ssum[摘要]
  end
  proj -.commit framework.config.json + 多adapter产物.-> repo[(仓库)]
  pers -.写 framework.local.json gitignored.-> local[(本地)]
```



## 已锁定的决策（讨论确认）

- 编排权归 harness：确定性产出候选任务 DAG + 依赖；用户只能「勾选/跳过/强制/在枚举内选参数」，不能凭空加任务、不能自由编辑；AI 仅渲染。
- 配置拆分：`framework.config.json`（项目级，提交）vs 新增 `framework.local.json`（个人级，gitignored）。个人级仅含 `agent_adapter` 与 `toolchain.devEcoStudio.installPath`。
- 运行时对象不变：`loadFrameworkConfig()` 合并两文件，下游消费者代码不改。
- 两条独立入口：项目级 init + 个人级 setup。
- 多 adapter：项目 init 可一次生成 claude/cursor/generic 多个产物全部提交（`.claude/`+`.cursor/`+`CLAUDE.md`+`AGENTS.md` 共存）。
- 决策模式（计划批准时选）：智能模式（无变化不覆盖/有变化直接覆盖）vs 手动模式（每决策点停下）；支持按任务覆写。
- 最终摘要由 harness 从 run-log JSON 确定性生成，AI 不自由发挥。
- 交互全程 widget 优先，遵循《交互层架构大重构》。

## 硬约束层（BLOCKER · 据 review 补充）

这是把"修补"升级为"真正解决"的核心。所有 framework-init / setup 的**编排类**用户决策必须满足：

1. **有限枚举，禁自由输入（P0-1）**：init/setup 的交互 schema 只允许「枚举/多选/勾选」。**禁止** `custom` / `other` / `请输入路径` / `给字符串` / `Q1=y` 这类文本通道。
   - 现存需清除的自由输入：`init.populated_diff` 的 `per_item`（Q1=y 文本协议）见 [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml)、SKILL §0.3.4 的 `Q1=y Q2=n` 格式 [SKILL.md](skills/00-framework-init/SKILL.md)。覆盖/保留一律改为 widget 二选一。
   - **生成性内容也禁止交互内自由文本（据 review 收紧）**：架构 DSL 层名、`project_name`、自定义工具链路径这类无法穷举的内容，**不在 init/setup 交互里收自由文本/路径/名字**。交互内对它们只提供有限枚举：「采用探测值 / 选择 preset / 跳过 / 停止并提示用户自行编辑对应文件后重跑」。真正的自由编辑发生在**交互之外**（用户改 `framework.config.json` / 架构文件后重跑 init），不作为对话输入通道。这样"framework init 所有交互都只能选"无逃生口。
2. **执行器只认枚举决策 JSON（P0-1）**：orchestrate 执行阶段接收的 `decision JSON` 只能引用 planner 产出的 `task.id` / 已声明 `action` / 已声明 `param`；遇到未知 task/action/param **拒绝并停**，不得 AI 自行解释。
3. **探测纯只读（P0-2）**：planner/probe 阶段**零写盘**。现 [check-init.ts](harness/scripts/check-init.ts) 在体检前写 `.gitignore`（`ensureCanonicalGitignore`，line 2135）、PASS 后清旧产物 + 同步 `auto_overwrite`（`applyDeprecatedArtifactsCleanup` line 2238 / `applyInitMechanismSync` line 2243/1883）——这些副作用**必须从探测剥离，全部下沉为 DAG 中的显式可执行任务**（`ensure-gitignore` / `cleanup-deprecated` / `sync-auto-overwrite`），在用户批准计划后才执行。否则"批准前磁盘已被改"，编排模型失真。
4. **generic adapter 验收降级（P2）**：generic renderer 仅 portable 编号菜单（见 [generic interaction-renderer.md](agents/generic/templates/rules/interaction-renderer.md)）。"widget 选择"强验收只适用于 claude/cursor；generic 承诺"有限枚举编号菜单（需键入编号）"，明确**不承诺零键入**，单列验收口径。

## 编排后执行流：大步骤，不要 1.x/2.x/3.x（据用户补充）

重写 SKILL 时**大胆按大步骤分**，不再用 `1.1/1.2/0.3.4` 这种深层小数编号。项目级 init 收敛为 **4 个大步骤**：

- **S1 探测**（纯只读，跑 planner，得到 task-plan JSON）
- **S2 计划批准**（渲染计划 widget + 选决策模式，一次性收齐）
- **S3 执行**（按 DAG 跑，按决策模式决定是否逐任务停闸门）
- **S4 摘要**（harness 生成 run-log → 结构化最终摘要 → 用户确认）

个人级 setup 同样 3 大步：**选 adapter → 校验已物化产物/记录路径 → 摘要**（与 `assert-active-adapter-materialized` 只读语义一致）。每个大步内部由 harness 任务驱动，**不在 SKILL 正文铺小数子步**。

## 关键文件与改动

### 配置拆分（爆炸半径核心）

**双概念模型（解决 P1-1：多 adapter vs 单 active adapter 冲突）**：

- **`materialized_adapters: string[]`**（项目级，提交进 `framework.config.json`）：本仓库要生成/维护哪些 adapter 产物（如 `["claude","cursor"]`）。是"项目物化清单"。
- **`agent_adapter: string`**（个人级，`framework.local.json`，gitignored）：我此刻用哪个工具。**强约束（据 review）**：个人 setup **只能从 `materialized_adapters` 已物化的 adapter 中选**，setup **永不写项目级产物**（不碰 `.claude/`/`.cursor/`/`framework.config.json`）。若用户想用一个未物化的 adapter，setup **停下并引导去跑项目级 init** 更新 `materialized_adapters` + 物化产物——把"新增 adapter（项目级、提交）"与"选我用哪个（个人级）"两个职责彻底隔离。
- inspector / render-env / `resolveAdapterName` / AGENTS 模板 frontmatter 全部从"单 adapter"改为"遍历 materialized_adapters 物化"。
- **提交产物不吃 local active adapter（据 review，关键隔离）**：项目 init 物化**每个** adapter 的提交文件（含 [templates/AGENTS.md.template](templates/AGENTS.md.template) line 18 的"激活 agent adapter"占位）时，render-env 用**"正在物化的那个 adapter / `materialized_adapters` 列表"**渲染，**绝不**把个人 `local.agent_adapter` 写进提交产物。`local.agent_adapter` 只影响**个人运行态**（我此刻调哪个 renderer / 哪个入口文件），不进任何 committed 文件。AGENTS.md.template 该占位须改为按"正在物化的 adapter"逐份渲染（多 adapter 时每份产物各自正确）。

**文件改动**：

- [harness/config.ts](harness/config.ts)：`loadFrameworkConfig` 读 `<root>/framework.local.json` 并 merge（local 的 `agent_adapter` / `toolchain.devEcoStudio` 覆盖/补入 project）；运行时 `FrameworkConfig` 形状不变。新增 `materialized_adapters`、`loadLocalConfig()` / `writeLocalConfig()`。
  - **来源状态（据 review，关键）**：新增 `loadFrameworkConfigWithSources()` / `getFrameworkPersonalSetupStatus()`，明确标注 `agent_adapter` 来源为 `local`（个人已 setup）/ `project_legacy`（老 config 还没外迁）/ `fallback`（都没有，默认值）。
  - **调用方点名（据 review，否则没人调仍静默 fallback）**：状态检查必须由**中心入口强制调用**，不只是提供 API。点名三处：① [harness/harness-runner.ts](harness/harness-runner.ts) 跑任意 phase 前先查，`fallback` 即停并提示跑个人 setup；② 各 Skill bootstrap（command/skill-bridge 入口）首段查；③ adapter slash command 前置。三处任一命中 `fallback` → 引导 setup，**不得静默按 generic 继续**。
  - **缓存修订（P1-2）**：现 `loadFrameworkConfig` 按 `projectRoot` 缓存（line 535）——须让缓存 key 纳入 local 文件 mtime，或 `writeLocalConfig()` 后显式 `clearConfigCache(projectRoot)`。
- [specs/framework.config.schema.json](specs/framework.config.schema.json)：`agent_adapter` 移出 `required`、新增 `materialized_adapters`；新增 [specs/framework.local.schema.json](specs/framework.local.schema.json) 并在 `loadLocalConfig` 中**校验 local schema**（P1-2）。
- [templates/framework.config.template.json](templates/framework.config.template.json)：删除 `agent_adapter` 与 `toolchain.devEcoStudio`、新增 `materialized_adapters`；新增 `templates/framework.local.template.json`。
- [harness/scripts/utils/config-field-merger.ts](harness/scripts/utils/config-field-merger.ts)：新增 MIGRATION_RULES `extract_personal_to_local`——UPDATE 时把老 config 的 `agent_adapter` → local + `materialized_adapters`、`toolchain.devEcoStudio.installPath` → local，并从主 config 删除。**测试改向（P1-2）**：[config-field-merger.unit.test.ts](harness/tests/unit/config-field-merger.unit.test.ts) 现把 `agent_adapter` / `installPath` 当"不自动补"（line 73）——改为"外迁到 local"断言。
- [harness/scripts/utils/canonical-gitignore.ts](harness/scripts/utils/canonical-gitignore.ts)：canonical patterns 追加 `framework.local.json`。

### 编排器（新增 harness 组件）

- 新增 `harness/scripts/utils/init-task-planner.ts`：复用现有 11 项探测逻辑（从 [check-init.ts](harness/scripts/check-init.ts) 抽出 inspector，**抽出后强制纯只读**，见硬约束 P0-2），产出 `InitTaskPlan` JSON。
- 任务模型：`{ id, title, category, deps[], status: satisfied|needed|drift|skippable, default_action, decision_class, params }`。
- 任务清单（项目级）：`ensure-config` / `backfill-config` / `migrate-config` / `confirm-fields` / `write-architecture` / `ensure-catalog` / `ensure-glossary` / `ensure-glossary-seed` / `ensure-features-dir` / `materialize-adapter:<name>`（按 `materialized_adapters` 多个）/ **`ensure-gitignore`** / **`cleanup-deprecated`** / **`sync-auto-overwrite`** / `harness-install` / `run-global-phases`。
  - 加粗三项即 P0-2 从探测剥离、下沉为显式任务的副作用（原 `ensureCanonicalGitignore` / `applyDeprecatedArtifactsCleanup` / `applyInitMechanismSync`）。
- 任务清单（个人级）：`record-adapter` / **`assert-active-adapter-materialized`**（**只读校验** active adapter 的产物是否已物化；缺失即停并引导跑项目级 init，**绝不自己写产物**——据 review 改名锁死语义，避免 `ensure-*` 被误解为会写 `.claude/`/`.cursor/`）/ `detect-deveco` / `record-deveco-path`。
- 新增 `harness/scripts/init-orchestrate.ts`：CLI 入口，`--scope project|personal`，输出 task-plan JSON + stdout 渲染表；执行阶段**只接收枚举 decision JSON**（硬约束 P0-1.2，未知 task/action/param 即拒绝），按决策模式执行并写 `run-log.json`。
- 摘要生成：`buildRunSummary(runLog)` 确定性产出最终摘要文本（对应 S4，不让 AI 拼）。

### 两条入口流程

- `[skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md)`：大幅瘦身重写为「项目级 init」——探测→渲染任务计划 widget→执行→摘要，删除固定策略矩阵叙述（逻辑下沉 harness）。
- 新增 `skills/00b-framework-setup/SKILL.md`（个人级 setup）：**仅从 `materialized_adapters` 中选** active adapter + `assert-active-adapter-materialized`（只读校验）+ 记录 DevEco 路径 → 写 `framework.local.json`（gitignored）。本工具产物若已物化即直接用；**若用户想要的 adapter 未物化 → 停下引导跑项目级 init**，setup 不自行物化、不写任何项目产物。
- 首次使用 bootstrap：下游 Skill 检测到 `agent_adapter` 来源为 fallback（见下「来源状态」）时引导跑个人 setup（轻量），**而非静默按 generic 继续**。
- **profile addendum 同步清禁输入（据 review，否则旧 addendum 把入口又开回来）**：[profiles/hmos-app/skills/00-framework-init/profile-addendum.md](profiles/hmos-app/skills/00-framework-init/profile-addendum.md)（line 80 仍有"自定义路径字符串 / 请提供 installPath"）及 `profiles/*/skills/00-framework-init/profile-addendum.md` 全部同步改为「探测/选择/跳过/停下改文件后重跑」的有限枚举；DevEco 路径走 `detect-deveco` 探测候选 + 选择，不在对话收自由字符串。harness lint 的禁自由输入扫描范围须覆盖 `profiles/**` addendum。

### 交互层（rebase 到已落地的交互层重构，不重做 · P1-2/image2）

> 仓库已是 registry v2 + 三份 renderer + commands 强约束形态（[confirmation-registry.yaml](skills/reference/confirmation-registry.yaml) schema 2.0、[interaction-renderer.md](agents/claude/templates/rules/interaction-renderer.md)）。本 Phase **只增量补 init 编排专属 entry，并清掉自由输入选项**，不再造三份 renderer。

- [skills/reference/confirmation-registry.yaml](skills/reference/confirmation-registry.yaml)：
  - 新增 `init.task_plan`（class=gate：全部执行 / 全部跳过 / 逐项调整 + 决策模式 智能/手动）、`init.task_decision`（手动模式逐任务 覆盖/保留，纯枚举）、`setup.adapter`、`setup.deveco_path`、项目级 `init.materialized_adapters`（多选 checkbox）。
  - **`init.task_plan` 约束（据 review）**：「全部跳过/逐项跳过」仍须受 planner 声明的 `allowed_actions` 与**依赖闭包校验**约束——**不能跳过非 `skippable` 的任务**（如 `ensure-config` 是其它任务前置时不可跳）；执行器对违反依赖闭包的 decision JSON 拒绝。
  - **删除/改造自由输入**：`init.populated_diff` 的 `per_item`（Q1=y）下线，覆盖/保留并入 `init.task_decision` 枚举。
- 三份 `interaction-renderer.*` 仅**补一段** init 编排渲染特例（计划=结构化多选/勾选 widget，决策点=gate/enum），无需重建。

### 命令/产物

- `[agents/claude/templates/commands/framework-init.md](agents/claude/templates/commands/framework-init.md)`：拆为 `framework-init`（项目）+ 新增 `framework-setup`（个人）；cursor/generic 同步。
- 下游受 `agent_adapter` 影响的 runner（hvigor/deveco/hdc/ut-host）无需改逻辑（运行时对象不变），仅验证 local merge 生效。

## 风险与缓解

- BREAKING schema 变更（agent_adapter 移出 required）：靠 `loadFrameworkConfig` merge + 迁移规则向后兼容；消费者 UPDATE 时自动外迁个人字段。
- SKILL.md 巨量重写：分阶段，先 harness 编排器跑通 + 单测，再改 SKILL 叙述。
- 个人产物提交策略：多 adapter 产物共存已验证无文件冲突。
- framework 自身演进须走 OpenSpec（见 `[AGENTS.md](AGENTS.md)`），Phase 0 先提案。

## 验收

- `cd harness && npm test` 全 PASS（含 planner 纯只读断言 / merge+缓存失效 / local schema 校验 / 个人字段外迁迁移单测）。
- **探测纯只读（P0-2）**：planner 跑完磁盘零变更（断言无 `.gitignore` / 产物写入）；副作用仅在批准后由 `ensure-gitignore`/`cleanup-deprecated`/`sync-auto-overwrite` 任务执行。
- **禁自由输入（P0-1）**：init/setup registry entry 无 `custom`/`other`/Q1=y/自由文本路径名字 通道；生成性内容只给「探测值/preset/跳过/停下让用户改文件后重跑」；执行器对未知 task/action/param 及违反依赖闭包的 decision 拒绝（含拒绝用例）。
- **个人 setup 边界**：setup 只能从 `materialized_adapters` 选；选未物化 adapter 时停下引导项目 init；断言 setup（含 `assert-active-adapter-materialized`）全程**只读**、不写 `.claude/`/`.cursor/`/`framework.config.json`。
- **提交产物隔离**：同一仓库 `materialized_adapters=["claude","cursor"]` 时，两份入口产物各自按自身 adapter 渲染；断言任一 committed 产物中**不含** local `agent_adapter` 的痕迹（个人选择不泄漏进提交文件）。
- **来源状态有人调**：`getFrameworkPersonalSetupStatus()` 区分 local/project_legacy/fallback，且 harness-runner / Skill bootstrap / adapter command 三入口在 fallback 时实际触发 setup（断言不静默按 generic 继续）。
- **profile addendum 无自由输入**：`profiles/**/00-framework-init/profile-addendum.md` 经 lint 扫描无"请提供/自定义字符串/输入路径"通道。
- 旧消费者 config 经 UPDATE 后 `agent_adapter` → local + `materialized_adapters`、`installPath` → local，主 config 不再含个人字段。
- 项目 init 可一次生成多 adapter 产物（`materialized_adapters` 驱动）；个人 setup 仅记录 active adapter，不碰项目 config。
- claude/cursor 全流程走 widget；generic 走有限枚举编号菜单（单列口径，不承诺零键入）；最终摘要由 harness 生成。
- 执行流仅 4 大步（S1-S4），SKILL 正文无 1.x/2.x/3.x 小数子步。


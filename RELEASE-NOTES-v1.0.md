# Framework 1.0 发布说明

**发布日期**：2026-05-07  
**发布分支**：`Br_release_1.0`  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

---

## 这份文档是写给谁的？

如果你还不熟悉「Framework」是什么，可以先这样理解：

> **Framework** 是一套挂在业务工程里的 **AI 研发流水线**。它规定：写需求（PRD）→ 做设计 → 写代码 → 审查 → 单元测试 → 真机测试，每一步该产出什么文档、跑什么自动检查、怎样才算「阶段完成」。  
> 业务代码在工程根目录；**Framework 本身在 `framework/` 子目录**（可以是 git submodule），通过 `/framework-init` 初始化后生效。

**Framework 1.0** 是这套体系的 **首个正式发布版本**：从 SimulatedWalletForHmos 壳工程里把流程、门禁、Skill 文档 **抽成可 vendor / submodule 的独立资产**，并在鸿蒙 App 场景下跑通 **PRD → UT** 的全链路（含真实 hvigor 编译与 ohosTest 真机闭环）。Skill 6（真机 UI 测试）在 1.0 提供 **计划与报告框架**，自动化执行引擎在后续 2.0 补齐。

---

## 孵化期 → 1.0：一句话变化

| | 孵化期（壳工程内嵌） | Framework 1.0 |
|---|---------------------|---------------|
| **形态** | 流程散落在对话、局部脚本与实例 `doc/` | **`framework/` 独立目录**，可 submodule / rsync vendor |
| **阶段** | 人工约定下一步 | **Skill 0–6 + harness 脚本**，每阶段有 BLOCKER |
| **术语/Scope** | 靠人记 | **catalog + glossary + PRD 映射表** 三道机械守门 |
| **编译/测试** | Agent 手敲 hvigor，易假 PASS | **coding/UT harness 触发真实 hvigor + hdc 跑 Hypium** |
| **弱模型** | 易跳步、假完成 | **三层闭环**（全局规则 + 完成回执 + Stop hook） |
| **真机 UI 测试** | 无统一规范 | **Skill 6 文档与门禁**（test-plan / test-report），执行以人工/半自动为主 |

---

## 大项改动

### 1. Framework 独立化：从壳工程到可复用资产

**以前的问题**  
AI 研发流程绑在单个钱包工程里：模板、规约、检查脚本和业务代码混在一起，无法「一处维护、多工程复用」，升级也靠手工拷贝。

**1.0 做了什么**

- 抽出 **`framework/`** 子目录：阶段 Skill、`specs/phase-rules/`、`harness/`、agent 适配、`templates/` 与业务解耦。
- **架构 DSL 化**：外层/内层模块依赖、跨模块出口文件名等写入实例根 `framework.config.json`，harness **从配置读取**，不写死层数与层名。
- **Feature 扁平归档**：需求产物统一落在 `doc/features/<feature>/`（PRD、design、contracts、acceptance、各阶段报告同级）。
- **多 Agent 入口**：`framework/agents/` 插件化（Claude / Cursor / generic），同一套 Skill 按 IDE 约定暴露 slash、跳板、全局说明文件。
- **Framework 初始化 Skill（Skill 00）**：交互式生成 `framework.config.json`、`doc/` 骨架与 agent 路由；支持 CREATE / UPDATE 模式。

**对你意味着什么**

- 新工程通过 **submodule 或 vendor 拷贝** 接入同一套 Framework，不必重抄流程文档。
- 改流程或门禁时，优先改 `framework/` 再同步到各业务工程。

---

### 2. 全生命周期 Skill 与 Harness 验证体系

**以前的问题**  
「写完了 PRD」「代码审查过了」缺少统一标准；弱模型常口头宣告完成，没有可复查的 PASS/FAIL。

**1.0 做了什么**

- **Skill 0–6 流水线**：catalog/glossary 自举 → PRD → design → coding → review → 业务 UT → 真机测试（testing）。
- **双层验证**：
  - **脚本 Harness**（`check-*.ts`）：确定性结构、追溯、Scope、编译等 BLOCKER；
  - **语义 Harness**（`verify-*.md`）：由 **独立 verifier 子 Agent** 审查，避免「自己验自己」。
- **统一 runner**：`harness-runner.ts` 跑脚本、生成报告与 AI prompt，模型无关。
- **阶段完成四件套**：`trace.json` + harness PASS + verifier PASS + `phase-completion-receipt.md`（`check-receipt.ts` 校验）。

**对你意味着什么**

- 每个 feature 阶段都有 **可机器判定的完成标准**；未闭环时 Claude adapter 的 **Stop hook** 可物理拦截 agent 结束回合（见下文第 5 节）。
- 进入某阶段前须 **完整读完** 对应 `framework/skills/<n>/SKILL.md`。

---

### 3. 术语、Scope 与架构：三道守门

**以前的问题**  
业务术语字面相似（如「卡管理 / 刷卡 / 我的」）导致 AI 选错模块；PRD 与 design scope 不一致；`architecture.md` 被每个 feature 改动污染成变更日志。

**1.0 做了什么**

- **模块画像 SSOT**：`doc/module-catalog.yaml`（职责、NOT_responsible_for、easily_confused_with）。
- **术语表 SSOT**：`doc/glossary.yaml`；PRD 必须以 **`## 0. 术语映射表`** 起始，**逐条人工 `[x]` 确认**。
- **Scope 守门**：PRD 声明 `in_scope_modules` / `out_of_scope_modules`；design 继承；coding 的 git diff 须在 scope 内。
- **架构文档收窄**：`doc/architecture.md` 只记 **架构级** 变更（`dsl_change` / `module_set_change` / `responsibility_rewrite`）；普通 feature **不写入** architecture.md。
- **design 契约**：`architecture_impact` 声明 + `contracts.yaml` 强约束编码阶段。

**对你意味着什么**

- 新需求 **必须先过 Skill 0**（或已有 catalog/glossary）再写 PRD。
- 术语映射表里的 `[ ]` 改成 `[x]` 是 **BLOCKER**，不能跳过。

---

### 4. 业务 UT 分层与真实执行闭环（v2 → v2.1）

**以前的问题**  
UT 要么缺失，要么为覆盖率堆无意义断言；v2 曾强制抽 UseCase 类 + Port，简单 feature 过度设计；编译通过不等于真跑过测试。

**1.0 做了什么**

- **UT 与编码分工**：Skill 3 写业务代码；Skill 5 **只消费** 既有实现，用 `use-cases.yaml` **纯规约** 描述分支（v2.1 **去代码化**，不再强制 UseCase 类形态）。
- **可测性预检 + Mock 计划**：复杂 feature 先做 testability audit 与 mock-plan，再写 DAG / 测试代码。
- **真实门禁（BLOCKER）**：
  - `ut_tsc_compiles`：测试代码静态编译；
  - `ut_hvigor_build`：ohosTest HAP 编译；
  - `ut_hvigor_test`：hdc 装机 + `aa test` 解析 Hypium 结果；
  - `ut_no_src_mutation`：跑 UT 时 **禁止改业务源码**（须先登记 gap-notes）。
- **`named_handler` 放宽**：允许具名业务处理函数等形态，避免为门禁硬凑抽象。

**对你意味着什么**

- UT 阶段需要 **真机或模拟器在线**（与 coding 编译门禁不同）。
- 简单 feature 不必被 Framework **诱导** 做端口/适配器过度架构。

---

### 5. 弱模型友好：三层防护与 Stop hook

**以前的问题**  
弱模型跳过 harness、混淆阶段（PRD 写完顺手改代码）、吞字反转语义（「不要覆盖」→「要覆盖」）、跨会话遗留任务误拦新对话。

**1.0 做了什么**

- **Layer 1 — 全局规则**：实例根 `AGENTS.md` / `CLAUDE.md` 授权主 agent 自跑 harness、触发 verifier；**反假设条款**（声称「规则禁止执行脚本」须 quote 原文，否则必须执行）。
- **Layer 2 — 完成回执**：`phase-completion-receipt.md` + `check-receipt.ts`；禁止口头「已完成」。
- **Layer 3 — Stop hook**（Claude adapter）：未闭环四件套时 **exit 2 阻断**；**v2.8 跨会话隔离**——上一会话遗留 state 不拦无关新问答；`--clear-state` 清理出口。
- **阶段硬边界**：PRD-only 回合不得写 design/contracts；design-only 不得写实现等。
- **framework-init 体检脚本化（11 项）**：`check-init.ts` 全脚本输出，Skill 00 禁止「看起来一致」类幻觉措辞。
- **弱模型 tool-call 兜底（v2.8.3）**：大文件渲染优先 `render-agents-md.mjs`，避免 Write 工具传超长 content 失败。

**对你意味着什么**

- Cursor adapter **无** Stop hook 物理层，仍依赖 Layer 1 + 回执自律。
- 重启 CLI 后若只见 advisory 提示遗留 state，**不必**自动接管旧任务。

---

### 6. DevEco / hvigor / hdc 工具链与编译加速

**以前的问题**  
DevEco 5.0+ 无工程根 `hvigorw.bat`，agent 手敲 hvigor 易失败；`hvigor test` 在 HAR 模块假 PASS；product 名写死 `default` 导致部分工程编译失败。

**1.0 做了什么**

- **DevEco 路径配置化**：`framework.config.json > toolchain.devEcoStudio.installPath`；Skill 00 Step 5.6 + `detect-deveco.ts` 自动探测。
- **coding 真实编译**：`coding_hvigor_build` 跑 **assembleApp**（项目级，非逐模块 assembleHap）。
- **UT 真机闭环**：`genOnDeviceTestHap` → hdc install → `hdc shell aa test`；失败分阶段诊断（install / run / no_pass 等）。
- **环境变量注入**：从 DevEco 路径派生 `DEVECO_SDK_HOME`、`JAVA_HOME`、JBR 入 PATH。
- **hvigor 加速（v2.7）**：`-p buildMode=debug`、`--daemon`、`--parallel`、`--incremental` 等可配置；**product 自动探测**（`build-profile.json5` → config → default 兜底）。

**对你意味着什么**

- 编码/UT 阶段应 **跑 harness**，而不是让 agent 拼 hvigor 命令。
- 首次接入须在 init 时 **确认 DevEco 安装路径**。

---

### 7. PRD 视觉保真、Visual Handoff 与 Skill 6 框架

**以前的问题**  
含 UI 的 PRD 缺少与设计稿对齐的约束；截图/视觉需求在 PRD 与 design 之间丢失；真机测试无统一 test-plan / test-report 模板。

**1.0 做了什么**

- **PRD Visual Handoff 门禁**：含 UI 变更的需求须声明 visual handoff；支持 **真源可达**（设计稿/截图路径可解析）与 **工程外解耦**（资源不硬编码进错误目录）。
- **PRD 图片精度策略**：视觉相关验收可配置精度档位，避免无损/有损混用无声明。
- **Skill 6（真机测试）**：`test-plan.md` + `test-report.md` 模板；P0/P1 通过率与 device AC 追溯；**尚无 Hylyre 统一 UI 自动化引擎**（打包/装机/逐步点击需人工或半自动配合 harness 文档指引）。

**对你意味着什么**

- UI 类 PRD 要预留 **Visual Handoff** 章节与资源路径。
- 1.0 的 testing 阶段 **重计划与报告归档**；大规模 UI 自动化见 **2.0 Release Notes**。

---

## 中等项改动

### 文档与对外材料

- **`framework/docs/` 文档树** + `DOC_INVENTORY.yaml` + 全局阶段 **`--phase docs`**（文档新鲜度 MAJOR 提醒，不阻塞业务开发）。
- **全景介绍** [`docs/overview.md`](docs/overview.md)：设计目标、三层分离（Spec / Skill / Harness）、演进里程碑。
- **术语守门专文** [`docs/concepts/terminology-guarding.md`](docs/concepts/terminology-guarding.md)。

### Init 与工程 hygiene

- Skill 00 **自动 `npm install` + `npm test` 自检**（Step 5.5），vendor 后不必手跑 harness 依赖安装。
- **`.gitignore` canonical 规则**：init 流程维护 framework 运行时忽略项（reports、node_modules 等）。
- **Adapter 显式选定 BLOCKER**（Step 0.2.5）：禁止凭环境猜测 claude/cursor/generic。
- **产物三档覆盖策略**（CREATE / UPDATE 时 Q1/Q3 矩阵）：避免静默覆盖实例已有入口文件。

### Harness 与契约细节

- **跨模块出口默认 `index.ets`**：`cross_module_exports_file` 与 naming 豁免对齐。
- **git diff 基线**：未设 `HARNESS_DIFF_BASE_REF` 时默认 **working tree**，便于本地迭代。
- **去 Claude 化措辞**：Skill / 模板 / harness 注释改为 **agent 中性** 表述（不绑定单一 IDE 品牌）。
- **Skill 5 外部导读** [`docs/skills/5-business-ut.md`](docs/skills/5-business-ut.md) 与 characterization 路径融合说明。

### 鸿蒙宿主约定（1.0 仍在 framework 根内）

- ArkTS 编码规范、PRD/design 模板示例、hvigor 细节 **仍在 `framework/skills/` 与 harness 根脚本中**（**2.0 才下沉到 `profiles/hmos-app/`**）。
- README 标题仍为 **「HarmonyOS Framework」**，默认受众为鸿蒙 App 工程。

---

## 首版已包含、后续版本增强的能力

以下在 **1.0 已可用**，**2.0 在其上增强**（非 1.0 缺失项）：

- Skill 0–6 阶段顺序与 harness 门禁骨架  
- Stop hook + 跨会话隔离（v2.8）  
- DevEco / hvigor / hdc UT 闭环（v2.3）  
- PRD 术语 / Scope / Visual Handoff  
- framework-init 11 项体检  

**1.0 尚未包含**（见 [`RELEASE-NOTES-v2.0.md`](RELEASE-NOTES-v2.0.md)）：`project_profile` 通用化、Hylyre 真机自动化、实例 `doc/extensions/`、Karpathy 四原则量化门禁、统一 AskUserQuestion UX、compat 升级协议、feature 报告外置到 `doc/features/.../reports/` 等。

---

## 升级指引（首次接入实例工程）

1. 在目标工程根 **vendor 或 submodule** 引入 `framework/`（见 [`README.md`](README.md) 与 [`MIGRATION.md`](MIGRATION.md) Vendor 模式）。  
2. 在 AI Agent 中执行 **`/framework-init`**（或自然语言：完整读 `framework/skills/00-framework-init/SKILL.md` 并跑 Step 0→7）。  
3. **显式选择 `agent_adapter`**（claude / cursor / generic），确认 `framework.config.json` 与 `doc/` 骨架。  
4. 配置 **`toolchain.devEcoStudio.installPath`**（init Step 5.6 可自动探测）。  
5. 跑全局阶段：  
   `cd framework/harness && npx ts-node harness-runner.ts --phase catalog`  
   `cd framework/harness && npx ts-node harness-runner.ts --phase glossary`  
   （完整 init 的 Step 6 会一并触发 `docs` 等校验。）  
6. 验证：`cd framework/harness && npm test`  
7. 首个 feature：从 Skill 1 PRD 开始，每阶段完成后跑对应 `--phase` harness + verifier + 填写回执。

---

## 已知边界与前置条件

- **默认面向 HarmonyOS App**：1.0 未提供 `generic` profile；非鸿蒙工程需等 2.0 或自行 fork。  
- **Skill 6** 在 1.0 **不包含** Hylyre 端到端 UI 自动化；testing 门禁以计划/报告/追溯为主。  
- **UT / coding 编译门禁** 依赖 DevEco、hvigor、hdc 与真机（或模拟器）。  
- **Stop hook 硬拦截** 仅 Claude adapter 完整具备；Cursor 依赖文档约束与回执。  
- **Framework 升级** 若新增 BLOCKER，1.0 **无** feature 级 `compat.yaml` 过渡（2.0 引入）。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`README.md`](README.md) | Framework 目录说明与初始化入口 |
| [`MIGRATION.md`](MIGRATION.md) | Vendor/submodule 与 v2.2–v2.4 迁移说明 |
| [`docs/overview.md`](docs/overview.md) | 框架全景、三层分离、演进里程碑 |
| [`docs/concepts/terminology-guarding.md`](docs/concepts/terminology-guarding.md) | 术语守门设计理念 |
| [`docs/operations/harness-runbook.md`](docs/operations/harness-runbook.md) | harness 命令与报告解读 |
| [`agents/README.md`](agents/README.md) | Claude / Cursor / generic 适配差异 |
| [`RELEASE-NOTES-v2.0.md`](RELEASE-NOTES-v2.0.md) | 下一正式版本的变更说明 |

---

**Framework 1.0** — 首个可独立分发的 AI 研发流水线：**全阶段 Skill + 脚本门禁 + 鸿蒙真实编译/UT 闭环 + 弱模型三层防护**，为 2.0 通用化与真机自动化奠定基线。

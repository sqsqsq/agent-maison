# Framework 2.0 发布说明

**发布日期**：2026-05-22  
**对比基线**：Framework 1.0（`Br_release_1.0`，2026-05-07）  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

---

## 这份文档是写给谁的？

如果你还不熟悉「Framework」是什么，可以先这样理解：

> **Framework** 是一套挂在业务工程里的 **AI 研发流水线**。它规定：写需求（PRD）→ 做设计 → 写代码 → 审查 → 单元测试 → 真机测试，每一步该产出什么文档、跑什么自动检查、怎样才算「阶段完成」。  
> 业务代码在工程根目录；**Framework 本身在 `framework/` 子目录**（可以是 git submodule），通过 `/framework-init` 初始化后生效。

**Framework 2.0** 是在 1.0「全生命周期 Skill + 自动门禁 + 弱模型友好」基础上的 **第二次大版本**。1.0 已经能跑通 PRD 到 UT；2.0 重点补齐了三块：**通用化（不再绑死鸿蒙）**、**可扩展（业务可挂自己的 Skill）**、**真机测试闭环（Hylyre）**，并加强了 Agent 行为约束与用户确认体验。

---

## 1.0 → 2.0：一句话变化

| | Framework 1.0 | Framework 2.0 |
|---|---------------|---------------|
| **定位** | 鸿蒙 App 场景的 AI 全流程 + harness 门禁 | 同上，且 **根 Framework 与宿主平台解耦**，支持多 profile |
| **真机测试** | 有 Skill 6 框架，以手工/半自动为主 | **Hylyre 集成**：打包 → 装机 → UI 自动化，含「即席」外部 App 测试 |
| **扩展** | 改 Framework 源码才能加规则 | 实例侧 `doc/extensions/` 可挂业务 Skill / hooks，不改 submodule |
| **Agent 纪律** | 文档约束 + Stop hook | 增加 **探索量化门禁**、**Karpathy 四原则**、**统一确认 UX** |
| **升级** | 升级 submodule 可能撞新 BLOCKER | 提供 **compat 临时降级 + context 回填脚本** 过渡 |

---

## 大项改动

### 1. Framework 通用化：一套骨架，多种宿主平台

**以前的问题**  
Framework 根目录里混着大量鸿蒙专用模板、示例和编译逻辑。想复用到别的工程类型，或把 Framework 当「通用库」升级，都要改核心代码。

**2.0 做了什么**  
引入 **`project_profile`** 概念（默认 `hmos-app`，另提供 `generic`）：

- **根目录保持中性**：通用流程、规则、脚本留在 `framework/skills`、`framework/harness` 等。
- **宿主细节下沉到 profile**：例如 ArkTS 编码规范、hvigor 编译、hdc 装机、PRD 模板示例，都在 `framework/profiles/hmos-app/`。
- **门禁按 profile 调度**：编码、UT、真机测试等检查不再写死「必须 hvigor」，而是由当前 profile 的 provider 决定跑什么。

**对你意味着什么**

- 维护 Framework 的人可以 **只升级 `framework/` 子模块**，不必把鸿蒙细节再抄进根目录。
- 若将来有非鸿蒙工程，可选用 `generic` profile，而不必 fork 整个 Framework。
- 老工程升级后，在 `/framework-init` UPDATE 时确认 `framework.config.json` 里的 `project_profile.name` 即可。

---

### 2. 可扩展：业务 Skill 与生命周期钩子

**以前的问题**  
业务特有流程（例如「接钱包 SDK 要先做 onboarding」）只能改 Framework 源码或散落在对话里，难以版本化、难校验。

**2.0 做了什么**

- **实例扩展目录** `doc/extensions/`：可放业务 Skill、knowledge、hooks、manifest，**不修改** `framework/` submodule。
- **Workflow 声明式配置**：阶段顺序写在 `framework/workflows/*.yaml`，可按团队 fork 裁剪（默认仍是 PRD → design → coding → review/UT → testing）。
- **全局「extensions」检查**：初始化时会校验扩展包协议是否合法。
- **Lifecycle hooks**：在阶段前后自动触发实例注册的钩子（例如 PRD 前强制读某合规文档）。

**对你意味着什么**

- 业务规则与 Framework 核心 **解耦**：Framework 升级 ≠ 业务扩展被覆盖。
- 本仓库已示例挂载 `wallet-sdk-onboarding` 扩展 Skill。

---

### 3. Skill 6 真机测试：Hylyre 端到端闭环

**以前的问题**  
Skill 6（真机测试）有文档和门禁框架，但缺少统一的 **UI 自动化执行引擎**；打包、装机、跑用例往往靠人工或零散脚本。

**2.0 做了什么（标准 feature 流程）**

1. **自动打包**：testing harness 触发 hvigor 打主应用 HAP（可复用已有包，避免重复编译）。
2. **自动装机**：hdc 安装到真机/模拟器，含版本降级、签名冲突等 **中文诊断**。
3. **Hylyre 执行**：vendor 内置 Python wheel，自动维护 venv；从 `test-plan.md` 派生可执行步骤，跑 UI 自动化并产出 trace / 报告。
4. **产物归档**：报告落在 `doc/features/<feature>/testing/reports/...`，与 PRD、design 同树，便于追溯。

**2.0 做了什么（即席 / 外部 App 测试）**

针对 **不在本仓库 feature 目录里的 App**（或临时验证），提供 `_adhoc` 通道：

- 命令入口：`npm run adhoc-device-test`（含 derive、lint、执行）。
- Agent 根据 derive 提示 **手写** `test-steps.json`，lint 通过后再执行（不再自动把自然语言翻译进步骤，避免不可控）。
- 默认 **冷启动 App**，避免 Nav 栈残留导致「在子页面却当首页点」；需要保留会话时用 `--continue-session`。
- 失败时强制写 trace，stderr 输出固定路径锚点，防止 Agent 误读历史目录「编造」测试结果。

**对你意味着什么**

- 说「对某 feature 做真机测试」时，Agent 应能 **自跑** 打包 → 装机 → Hylyre，而不是把命令丢给用户。
- 真机前仍需：**设备已连接、USB 调试授权、DevEco 路径配置**（Skill 00 可自动探测）。

---

### 4. Agent 行为规约：先研究、再写、写少、要验证

**以前的问题**  
弱模型容易 **没读代码就写 PRD/design**、顺手改 scope 外文件、或口头说「完成了」但没有跑门禁。

**2.0 做了什么**

- **Karpathy 四原则**写入全局规约（Research First / Minimum Viable / Surgical / Verify），各阶段写主产物前必须先做 **Research Sub-Phase**。
- **`context-exploration.md` 升级**：须列出真实读过的源码路径、Code Facts；脚本 **量化检查** 是否够格，不够则 BLOCKER。
- **探索策略升级**：design/coding 默认要求 **subagent 深度探索**（极小改动可豁免）；PRD/review/UT 按复杂度评分决定是否必须 subagent。
- **独立 verifier 子 Agent**：每个阶段完成后，除脚本 harness 外，还有语义级审查（与主 Agent 分离）。

**对你意味着什么**

- 新 feature 会先看到 `context-exploration.md`，再看到 PRD/design——这是 **故意设计**，不是多余步骤。
- 老 feature 升级 Framework 后若撞新门禁，可用 **compat 临时降级** 或 **回填脚本** 过渡（见下文「升级指引」）。

---

### 5. 用户确认体验：全 Skill 统一、Claude 可调问卷

**以前的问题**  
各 Skill 里「请用户确认」写法不一；Claude Code 下 Agent 常只贴 Markdown 表格，不调原生选项组件，用户只能打字回复。

**2.0 做了什么**

- **统一确认规范**：全 Skill 0–6 的确认点登记在一份 SSOT 里，要求 **能弹窗就弹窗 + 同轮给出 1/2/3 编号菜单**（Cursor 用 AskQuestion，Claude Code 用 AskUserQuestion）。
- **静态检查**：改 Skill 时若漏登记确认点，harness 会 FAIL。
- **Claude adapter**：下发 `.claude/rules/` 与 slash 命令里的 widget 指引；init 选 adapter 等关键步骤 **禁止 Agent 自造选项文案**。

**对你意味着什么**

- 在 Claude Code / Cursor 里跑 Skill 时，重要决策应出现 **可点的选项**，而不是「请回复 y/n」。
- 升级 Framework 后需 **重跑 `/framework-init` UPDATE**，以刷新 `.claude/` 或 `.cursor/` 下的规则文件。

---

### 6. Feature 报告与 Framework 文档分家

**以前的问题**  
某 feature 的 harness 报告有时写在 `framework/harness/reports/` 下，Framework  submodule 一升级，报告路径与业务文档分离，容易丢或难找。

**2.0 做了什么**

- Feature 阶段报告默认写到 **`doc/features/<feature>/<phase>/reports/`**，与 PRD、design 放在一起。
- Framework **自带对外文档** 迁入 `framework/docs/`，并增加 `--phase docs` 检查文档是否过期（提醒维护者，不阻塞业务开发）。

**对你意味着什么**

- 查某需求的测试/审查报告，**先到 `doc/features/` 找**，不要只在 `framework/` 里翻。
- 实例 `doc/` 里若还有 1.0 时代从 Framework 拷出来的总览类文档，升级 2.0 后 **可删除**（以 `framework/docs/` 为准）。

---

### 7. Framework 升级更友好：compat 与 config 自动补缺

**以前的问题**  
Framework 升级后新增配置项或新 BLOCKER，老工程要么手工改一堆 JSON，要么某个旧 feature 直接被新规则卡死。

**2.0 做了什么**

- **`merge-framework-config`**：UPDATE init 时可 **只补缺、不覆盖** 已有 `framework.config.json` 字段（如 `tools.hylyre`、`active_workflow` 等）。
- **Feature 级 compat**：单个 feature 可在 `doc/features/<name>/compat.yaml` 临时降低某条 BLOCKER（带过期日），同时 harness 提示 **推荐用回填脚本** 正规化。
- **`.gitignore` 自动同步**：init 体检时幂等追加 Framework 需要的忽略规则（reports、`.hylyre`、即席目录等）。
- **Adapter 机制文件自动对齐**：hooks、settings 等随 Framework 更新时可自动覆盖并备份到 `.framework-backup/`。

---

## 中等项改动

### Agent 入口与 Bundle

- **generic adapter** 可配置 agent 产物根目录（如 `.agents`），支持 skill **跳板** 或 **内联全文** 两种下发方式。
- Claude **slash 命令瘦身**：实例根命令只跳转到 `framework/skills/`，避免双份正文分叉。

### Init 与配置

- **Harness 工作目录契约**统一写进文档：哪些命令在仓库根跑、哪些在 `framework/harness` 跑，减少路径错误。
- **`tools.hylyre` 配置**：CREATE/UPDATE init 时由 profile 默认值 + 补缺合并自动写入，无需手抄 7 个路径点。

### 真机测试辅助

- **构建/装机复用**：源码未变时可跳过 hvigor；耗时写入 `device-test-timing.json` 便于分析。
- **Hylyre 版本对齐**：vendor wheel 变更时 ensure 步骤自动 pip 升级。
- **验收文档收敛**：废弃单独的 testing todo 清单；设备侧关注点收进 `acceptance.yaml` 的 `device_focus` 等字段。
- **Profile 动态资产引用**：Skill 正文用 `profile-skill-asset:...` 引用模板，不再写死 `framework/profiles/hmos-app/...` 路径。

---

## 1.0 已有、2.0 在其上延续的能力

以下在 **1.0 已交付**，2.0 **未推翻**，仅增强或与之配合；新读者可一并了解：

- **Skill 0–6 全生命周期**：catalog/glossary → PRD → design → coding → review / UT → testing  
- **Harness 自动门禁**：每阶段 `check-*.ts` 脚本 + 完成回执 + trace  
- **Stop hook 跨会话隔离**：未闭环阶段不会误拦「新会话里的无关问答」  
- **弱模型友好**：工作流强制门、吞字防护、阶段边界硬约束  
- **UT 分层**：业务 UT 与编码分离；usecase 去代码化；可测性预检  
- **PRD 视觉保真、术语/Scope 守门**（catalog + glossary）  
- **DevEco / hvigor 工具链识别**（`toolchain.devEcoStudio.installPath`）  
- **编码阶段 hvigor 编译加速与复用**

---

## 升级指引（实例工程维护者）

1. 将 `framework/` 更新到 **2.0 对应提交**（vendor 拷贝或 submodule pull）。  
2. 在工程根执行 **`/framework-init` UPDATE**，按提示确认 adapter、config diff、机制文件覆盖。  
3. 可选：  
   `node framework/harness/scripts/merge-framework-config.mjs --apply`  
   自动补缺 `framework.config.json`。  
4. 验证：  
   `cd framework/harness && npm test`  
5. 鸿蒙工程：确认 DevEco 路径、真机可用；任选 feature 跑 `--phase testing` 验证 Hylyre 链。  
6. 若有进行中的老 feature 被新 BLOCKER 卡住：  
   - 优先：`cd framework/harness && npm run backfill:context -- --feature <name> ...`  
   - 短期：在 feature 目录添加 `compat.yaml`（见 `framework/docs/evolution/compat-protocol-v1.md`）

更细的字段说明与搬迁脚本见 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界与前置条件

- **真机测试**依赖物理设备或模拟器、hdc、DevEco；Framework 不能替代这些环境。  
- **Hylyre** 首次使用会创建 Python venv，需本机 Python 与网络（pip 装 wheel）。  
- **Cursor adapter** 与 **Claude adapter** 的物理拦截能力不同：Claude 有 Stop hook 硬拦截；Cursor 主要靠 Layer 1 文档约束 + 完成回执。  
- **compat 是过渡手段**，不是长期豁免；过期后仍会 FAIL。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`README.md`](README.md) | Framework 目录说明与初始化入口 |
| [`MIGRATION.md`](MIGRATION.md) | 版本升级步骤与破坏性变更细节 |
| [`docs/concepts/extensibility.md`](docs/concepts/extensibility.md) | 扩展分层与 manifest 协议 |
| [`docs/operations/harness-runbook.md`](docs/operations/harness-runbook.md) | harness 命令与报告解读 |
| [`agents/README.md`](agents/README.md) | Claude / Cursor / generic 适配差异 |
| [`RELEASE-NOTES-v1.0.md`](RELEASE-NOTES-v1.0.md) | 上一正式版本的变更说明 |

---

**Framework 2.0** — 在 1.0「能跑通全流程」之上，让 Framework **更通用、更可扩展、真机可自动化、Agent 更守规矩、升级更平滑**。

# Framework 2.3.0 发布说明

**发布日期**：2026-06-22  
**对比基线**：Framework 2.2.0（`framework-2.2.0.zip` / submodule 对应 2.2 线）  
**发布件**：`dist/framework-2.3.0.zip`（SHA256: `0ab4a9e8372afb0954b54fcbaad69ff6e2168d1debe8ed7fa7f4cee9a92aadfd`）  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

> 本文档位于 **AgentMaison 开发仓**（dev-only，不进 zip）。更早版本见 [`RELEASE-NOTES-v2.2.0.md`](RELEASE-NOTES-v2.2.0.md)、[`RELEASE-NOTES-v2.1.0.md`](RELEASE-NOTES-v2.1.0.md)、[`RELEASE-NOTES-v2.0.md`](RELEASE-NOTES-v2.0.md)。

---

## 这份文档是写给谁的？

**Framework 2.3.0** 是在 2.2「config builder + init 硬化 + Code Graph 机制」之上的 **一次 minor 演进**。**2.3.0 首创 Goal 模式**：给定一个 feature 需求，可由 harness 确定性外层 **自动串联 spec → plan → coding → review → UT → device-testing**，无需人工逐阶段点「继续」。同版还完成 Skill 目录与阶段命名 BREAKING 重构，并补齐 DevEco 个人配置契约、Hylyre 0.3.0 与 coding 依赖自动安装。

---

## 2.2.0 → 2.3.0：一句话变化

| | Framework 2.2.0 | Framework 2.3.0 |
|---|-----------------|-------------------|
| **Skill 目录** | `skills/3-coding/` 等数字前缀 | **`project/` + `feature/` 分域**，扁平 slug（`coding`、`spec`…） |
| **阶段命名** | `prd` / `design` | **`spec` / `plan`**（dual-read 兼容旧 id 与路径） |
| **Goal 模式** | **不支持**；须 Agent 对话内逐 phase 推进，无确定性外层 | **2.3.0 首创**：`/goal-mode` 或「目标模式 / 全自动」触发，**一条需求自动跑完** spec→testing（默认终点） |
| **DevEco 配置** | P1 fail-closed + local 外迁 | **profile `personal_prerequisites` SSOT** + `hmosDevice` skeleton |
| **Coding 依赖** | 归因文案，用户手动 `ohpm install` | **harness 自动 `ohpm install` 并重编译** |
| **Hylyre** | 0.2.x vendor | **0.3.0** + personal setup 原子性 repair |

---

## 大项改动

### 1. Goal 模式（2.3.0 首创 · 一条需求全自动跑通）

**以前的问题（2.2 及更早）**  
Framework 虽有 spec→plan→coding→…→testing 的 workflow 与 harness 门禁，但**没有「跑完一个需求」的自动化外层**。每个 phase 依赖 Agent 在对话里自觉推进、用户反复说「继续」或授权下一 Skill；跨 phase 状态靠对话记忆，易中断、难审计、无法无人值守。

**2.3.0 做了什么 — 首创 Goal 模式**

Goal 模式 = **确定性 `goal-runner` 外层编排器** + **项目级 Skill `goal-mode` 宿主入口**。用户指定 feature（与可选起止 phase）后，runner 在 **fresh context 循环** 中自动：

1. 按 workflow **`auto_chain: [spec, plan, coding, review, ut, testing]`** 顺序推进（manifest 可覆盖起止点，默认 **spec → testing**）；
2. 每轮 **headless 调 Agent** 完成当前 phase 产物与修复；
3. 跑对应 **harness 门禁**，读取 `summary.json` 的 verdict / `next_action` 做机器裁决（PASS→下一阶段 / FAIL→同 phase 重试至预算上限 / 外部阻塞→DEFERRED 续行或 halt）；
4. 全程留痕至 **`doc/features/<feature>/goal-runs/<run-id>/`**（manifest、events、各 phase prompt/输出/harness summary、最终 report）。

**怎么触发（用户侧）**

| 方式 | 示例 |
|------|------|
| Claude slash | `/goal-mode my-feature 全自动从 spec 做到 testing` |
| 自然语言 | 「对 `my-feature` 进入目标模式，无人值守全自动」 |
| 其他 adapter | 读 skill id `goal-mode` 跳板后进入同一流程 |

主 Agent **须自跑** `goal-runner`（勿把 harness 命令推给用户）；跨 phase 推进由 **runner + harness verdict** 裁决，不是对话内自驱动。

**配套能力**

- **`goal-status` CLI** 与 progress 快照，可查看当前跑到哪一 phase；
- **预算守卫**（最大 turns / token / 超时）与 **并发锁**，防 fork-bomb；
- **DEFERRED 语义**：真机不可用、registry 不可达等外部阻塞标为「未完成·待外部条件」，**绝不**误报整单 completed；
- **稳定性**：close 挂起修复、Stop hook 与 goal 串台隔离、Cursor 无头 CLI、personal setup 门禁。

**对你意味着什么**

- **2.3.0 起**，可以说「把这个需求从 spec 全自动做到 testing」，Framework 会按门禁 **闭环驱动整条 feature 流水线**，而不是只提供分阶段 Skill 等你手动衔接。
- 跑完（或 DEFERRED/PARTIAL 结束）后，打开 `goal-runs/<run-id>/` 即可审计每一 phase 的输入、输出与 harness 结论。
- 第一版 headless 以 **Claude / Codex** 路径最成熟；Cursor 已接入；generic 为 external_runner 接口，质量不承诺与 Claude 同级。

详见 [`skills/project/goal-mode/SKILL.md`](skills/project/goal-mode/SKILL.md)、[`docs/operations/goal-mode-runbook.md`](docs/operations/goal-mode-runbook.md)。

---

### 2. Skill 层 scope 重构（BREAKING）

**以前的问题**  
`skills/00-framework-init/`、`skills/3-coding/` 等编号前缀与扁平物化 id 不一致；`00b-framework-setup` 与阶段 gate 职责重叠；新增项目级 skill 难以无重排扩展。

**2.3.0 做了什么**

- 根 `skills/` 按生命周期分为 **`project/`**（init、catalog、code-graph…）与 **`feature/`**（spec、plan、coding…）；逻辑 id 统一为 **扁平 slug**。
- `skills/skills.index.yaml` + `resolveSkillPath(id)` 为 id→物理路径 **SSOT**；registry、workflow、adapter bridge 同步去编号。
- **`00b-framework-setup` 删除**，内容并入 `skills/reference/personal-setup-gate.md`。
- **UPDATE init 自动清理**残留编号跳板（`.cursor/skills/3-coding/` 等），删除前备份至 `.framework-backup/<timestamp>/`。

**对你意味着什么**

- Vendor / submodule 更新后须跑 **`/framework-init` UPDATE**，物化新扁平跳板名。
- 脚本或文档中硬编码 `skills/3-coding/`、`.agents/skills/1-spec/` 等路径须改为扁平 id。
- profile 镜像路径保持 **`profiles/<profile>/skills/<skill-id>/`**（不得嵌套 `project/` / `feature/`）。

---

### 3. 阶段重命名：prd/design → spec/plan（BREAKING + compat）

**以前的问题**  
`prd` / `design` 语义与「长期规格 / 短生命周期实现计划」不匹配；plan.md 与 `contracts.yaml` 真源关系在 Skill 文案中打架。

**2.3.0 做了什么**

- 阶段 id、产物目录、check id、workflow、goal 链 **机械改名**：`prd`→`spec`，`design`→`plan`。
- **compat 双读**：harness / goal-runner 仍接受 `--phase prd`/`design`、旧路径与 legacy check id（WARN）；`prd.visual_handoff` 规范化为 `spec.visual_handoff`。
- 模板与 SKILL 重写：spec 提炼跨宿主治理维度；plan 保留 scope / 架构影响 / 功能映射三大门禁章节。
- 明确真源：**`contracts.yaml` / `use-cases.yaml` 为机器契约**；plan.md 为契约草案/来源。

**对你意味着什么**

- 新 feature 建议直接用 `doc/features/<f>/spec/`、`plan/` 布局。
- 存量 feature 可 dual-read 续跑；半迁状态下 `context-exploration.md` 等 **不做** legacy 目录回退，按 harness 报错 suggestion 补文件或迁目录。
- 自 2.0.x 直跳者须叠加阅读 [`MIGRATION.md`](MIGRATION.md) § spec/plan 迁移专节。

---

### 4. Code Graph 用户入口

**2.2.0 做了什么（机制层）**  
GraphExtractor provider、UT 证据链、core 节点闭环闸门已在 2.2 落地，但缺少面向使用者的 Skill 入口与独立 harness 阶段。

**2.3.0 做了什么**

- 新增项目级 Skill **`code-graph`**（仿 catalog-bootstrap 分层：公共流程 + hmos-app profile-addendum）。
- 新增全局 phase **`module-graph`**：读 catalog + 模块图谱，执行 drift 分级门禁（无图谱→PASS 并提示建图）。

**对你意味着什么**

- 大型工程可在 init / catalog 之后主动维护模块导航索引；触及 core 模块时 drift 会 BLOCKER。
- Code Graph 仍是**导航索引**，不作 spec/plan/coding 真源。

---

### 5. DevEco 配置 P2（profile 契约）

**2.3.0 做了什么**

- **`personal_prerequisites`** 从 harness 硬编码迁到 **profile 契约 SSOT**（`profile-schema.yaml` + profile-loader）。
- project config 补 **`toolchain.hmosDevice`** 可选 skeleton；schema **禁止** `devEcoStudio` 回流 project 级。
- DevEco 安装路径 **仅** `framework.local.json`；阶段入口 `--ensure` 走 fail-closed 修复链。

**对你意味着什么**

- hmos-app 各 phase 的前置能力声明以 profile 为准，不再隐式写死在 harness。
- 团队每位开发者须完成 **personal setup**；半就绪 local 会在阶段入口被确定性 repair。

---

### 6. Hylyre 0.3.0 + personal setup 原子性

**2.3.0 做了什么**

- vendor 升至 **Hylyre 0.3.0**（`input.by_type`、富选择器、`into` 等；详见 vendor README）。
- 阶段入口改用 **`ensurePersonalSetup` 内联确定性 repair**，修复「local 半写入 → 全 phase 卡门禁」。
- `record-adapter` 复用同一 repair 路径写完整 local（best-effort）。

**对你意味着什么**

- Skill 6 真机步骤可写 richer 选择器；首次跑 testing 前 personal setup 应一次就绪。
- vendor 升级后 harness 会按 manifest 对齐 venv，无需手工删 venv 重装（在 ensure 链内处理）。

---

### 7. Coding 依赖自动安装

**以前的问题**  
hvigor 因 `@aspect/*` 等未安装失败时，harness 只产归因文案，Agent 常把问题上交用户手动 `ohpm install`。

**2.3.0 做了什么**

- 新增能力 **`coding.deps_install`**（hmos-app：`ohpm` provider，BLOCKER）。
- `checkCodingCompile` **三路闸门**：声明缺失→agent 补 `oh-package.json5`；仅未安装→自动 `ohpm install` + no-daemon 重编译；安装失败→携带 registry/鉴权/网络分类回退用户。
- 新增 `next_action`：`declare_dependencies_then_rerun` / `resolve_dependency_install_blocker_then_rerun`。
- 含 **Windows DevEco 含空格路径** spawn 修复与回归单测。

**对你意味着什么**

- HarmonyOS 工程 coding 阶段缺 `oh_modules` 时，harness **同一次 run 内**尝试自动修复；仅 ohpm 本身失败才需人工介入。
- `HARNESS_SKIP_DEPS_INSTALL=1` 可离线/CI 跳过自动安装。
- 独立 BLOCKER（如缺 `context-exploration.md`）不会因自动装依赖而消失，agent 仍须补对应产物。

---

### 8. Generic adapter 收敛

**2.3.0 做了什么**

- **彻底废弃 inline skill 模式**；generic bundle **恒 bridge 薄跳板**，与 claude/cursor 等多 adapter 共存更稳定。

**对你意味着什么**

- 选用 generic adapter 时，Skill 正文仍在 framework 源树，实例根仅物化跳板；勿再依赖 inline 全量拷贝路径。

---

## 中等项改动

- **Init**：staging 禁止 `decision.json` / `context.json` 落入 harness 目录；UPDATE 清理 `prd-design` / `requirement-design` 等语义旧跳板。
- **UT**：hvigor build/run 按 **scoped 模块**选目标，排除非本需求模块；跨轮失败上下文回喂 agent；UT profile yaml 经 harness `createRequire` 解析。
- **文档**：framework 内置 `extensibility.md` / `extension-protocol-v1.md` 与源文档同步，`doc_freshness` 清零 MAJOR。

---

## 2.2.0 已有、2.3.0 延续的能力

以下 **未推翻**，2.3.0 在其上增量演进：

- 确定性 **config builder** 与 init S1–S4 编排（2.2）
- **template-renderer** 统一入口文档物化（2.2）
- UT **coverage 证据链** 与 GraphExtractor 机制（2.2）
- Feature 主产物 `<phase>/` 布局与 dual-read（2.1）
- hmos-app **HSP**、消费者 zip `npm test` = `check:global` 等（2.1 及更早）

---

## 升级指引（2.2.x → 2.3.0）

1. 备份当前 `framework/` 版本。
2. 部署 **`framework-2.3.0.zip`** 或 submodule 更新到对应提交。
3. 工程根 **`/framework-init` UPDATE**（S1→S4）；S2 确认 `materialized_adapters`。
4. 检查物化跳板为 **扁平 id**（无 `3-coding` 等编号目录）；必要时从 `.framework-backup/` 回滚。
5. 每位开发者跑 **`check-personal-setup --json --ensure`**，确认 DevEco 路径在 `framework.local.json`。
6. 新 feature 使用 `spec/`、`plan/` 目录；存量 feature 可 dual-read 续跑。
7. 验证：`cd framework/harness && npm test`；对活跃 feature 抽跑 `--phase` 集成。
8. **Goal 模式**（可选）：物化 adapter 并完成 personal setup 后，用 `/goal-mode <feature> 全自动从 spec 做到 testing` 试跑一条需求；结果见 `doc/features/<feature>/goal-runs/`。

自 **2.1.x 或更早直跳 2.3.0** 者，须叠加阅读 [`RELEASE-NOTES-v2.2.0.md`](RELEASE-NOTES-v2.2.0.md) 与 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界

- **spec/plan compat** 为过渡能力；旧 id / 旧路径长期仍可能 WARN，新 feature 应直接用新命名。
- **Goal 模式** headless 路径第一版以 claude / codex 为主；generic 仅 bridge 接口，不承诺同等质量。
- **coding.deps_install** 本轮仅 hmos-app / ohpm；generic profile 为 SKIP。
- Claude / Cursor adapter 物理拦截能力仍不对等。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`RELEASE-NOTES-v2.2.0.md`](RELEASE-NOTES-v2.2.0.md) | 上一版（2.2）增量说明 |
| [`RELEASE-NOTES-v2.1.0.md`](RELEASE-NOTES-v2.1.0.md) | 2.1 产物目录与 init 变更 |
| [`MIGRATION.md`](MIGRATION.md) | 升级步骤与破坏性变更（含 spec/plan、skill scope） |
| [`docs/operations/goal-mode-runbook.md`](docs/operations/goal-mode-runbook.md) | Goal 模式运行手册 |
| [`README.md`](README.md) | Framework 目录与 init 入口 |

---

**Framework 2.3.0** — **首创 Goal 模式**，让一条 feature 需求可 **全自动跑通 spec→testing**；并完成 Skill/阶段命名重构，补强 DevEco 配置、Hylyre 真机与 coding 依赖安装闭环。

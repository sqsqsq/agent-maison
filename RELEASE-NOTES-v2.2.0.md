# Framework 2.2.0 发布说明

**发布日期**：2026-06-05  
**对比基线**：Framework 2.1.0（`framework-2.1.0.zip` / submodule 对应 2.1 线）  
**发布件**：`dist/framework-2.2.0.zip`  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

> 本文档位于 **AgentMaison 开发仓**（dev-only，不进 zip）。2.0 及更早能力见 [`RELEASE-NOTES-v2.0.md`](RELEASE-NOTES-v2.0.md)；2.1 增量见 [`RELEASE-NOTES-v2.1.0.md`](RELEASE-NOTES-v2.1.0.md)。

---

## 这份文档是写给谁的？

**Framework 2.2.0** 是在 2.1「产物分阶段 + init 文档/staging 对齐」之上的 **一次 minor 演进**：不推翻 Skill 0–6 主流程，重点硬化 **init 执行链与 config 落盘**、统一 **入口文档模板渲染**，并落地 **Code Graph + UT 证据链**。

---

## 2.1.0 → 2.2.0：一句话变化

| | Framework 2.1.0 | Framework 2.2.0 |
|---|-----------------|-------------------|
| **config 写入** | S2 Agent 可拼整段 `configWritePayload` | **确定性 builder**：AI 只交结构化值，harness 按 profile 合成完整文件 |
| **Init 执行** | staging + 原子 preflight 已落地 | **`materialized_adapters` 机器门禁**；两阶段 context 派生；preflight 与 executor 共用同一 context |
| **入口文档** | adapter 物化走 `check-init` 渲染路径 | **共享 `template-renderer`**，消除占位符残留与架构摘要内联错误 |
| **UT / 图谱** | flow DAG 与 characterization 分散演进 | **Code Graph schema** + **coverage 证据优先级** + **core 节点闭环闸门** 贯通 Skill 5 |

---

## 大项改动

### 1. 确定性 config 生成（config builder）

**以前的问题**  
UPDATE/CREATE 时 Agent 手写整份 `framework.config.json` payload，易漏 `schema_version`、误补 `tools.hylyre`（generic 工程）、preflight 与 executor 落盘对象不一致。

**2.2.0 做了什么**

- 新增 `config-builder`：`buildProjectConfigForWrite` + `prepareConfigWriteForTask`，从 **profile 默认 + AI 结构化输入** 合成完整 config。
- `getEffectiveBackfillFields(profileName)` 作为 builder / `check-init` / `merge-framework-config` / executor **共用 SSOT**；`generic` 不再被误补 hylyre。
- preflight 与 `ensure-config` executor **byte-for-byte 一致**；AI 不再写 `state_machine` / `toolchain.hvigor` 等结构字段。

**对你意味着什么**

- `/framework-init` UPDATE 后 config diff 可能多出 builder 补全的结构字段，属预期行为。
- S2 `configWritePayload` 只需 `project_name` / `project_profile` / `architecture` / `materialized_adapters` 等语义值。

---

### 2. Init 执行链硬化

**2.2.0 做了什么**

- **`materialized_adapters[]` 机器门禁**：S2 多选为 SSOT；`decision` 为空则 preflight 阻断；执行链不与磁盘旧 adapter 静默冲突。
- **两阶段 context 派生**：planning（strip → cross-check → sync adapters）与 execution（UPDATE 缺 payload 时从磁盘补最小字段）分离；preflight 与 `executeInitPlan` 共用 `finalContext`。
- **UPDATE emit 预填**：`--emit-staging-template` 输出最小 `configWritePayload`（**不含**磁盘 `materialized_adapters`），减少 Agent 手写 ~90 行 JSON。
- **体验与审计**：S0 `init-readiness` 依赖检查；run-log 记录 skip 原因与顶层审计字段；S4 下一步保守化；S1 **install-first** 硬提示；`--smart-auto` 复用同一管线。
- **本轮 UX 细化**：智能 UPDATE 且无额外 `docWritePayload` 时优先显式走 `--smart-auto --materialized-adapters <list>`，不再强制先写外部 OS staging；S2 registry 回答即批准记录，不再二次询问“确认后进入 S3？”；S4 stdout 摘要明确包含 `run_log` / `summary` 路径，并区分 smart-auto 未创建外部 staging。
- **依赖噪音收敛**：移除 harness 未使用的直接 `glob` 依赖；干净 `npm install` 不再出现由该直接依赖触发的 `glob` deprecated warning。

**对你意味着什么**

- 增删 adapter 必须在 S2 明确写入 `decision.materialized_adapters`，不能依赖磁盘旧值「推荐」。
- 探测前须 `cd framework/harness && npm install`，否则 readiness 阻断。
- UPDATE 保留既有 `architecture` / `intra_layer_deps` 时，Agent 应复述为“沿用已有 architecture DSL”，不要误称为 profile 默认 preset。

---

### 3. 入口文档共享渲染（template-renderer）

**以前的问题**  
`check-init` 与 `render-agents-md` / executor 物化路径不一致，导致 `CLAUDE.md` 残留 `{{EXTENSION_SKILL_SECTION}}`、架构摘要内联 `Index.ets` 等字面值。

**2.2.0 做了什么**

- 抽取 `template-renderer.ts`：`render-agents-md`、init 物化、legacy `check-init` 路径统一渲染与占位符断言。
- `ARCHITECTURE_SUMMARY` 改为 DSL 引用风格；扩展 Skill 段按 **实例根** `doc/extensions` 扫描（executor 传入 `projectRoot`）。

**对你意味着什么**

- UPDATE init 后应检查 `CLAUDE.md` / `AGENTS.md` 无 `{{...}}` 残留；有则重跑 S3 `materialize-adapter:*`。

---

### 4. Code Graph 与 UT 证据链

**2.2.0 做了什么**

- **术语与边界**：Code Graph（模块导航索引，不作 PRD/design 真源）、flow DAG、Repo Map 写入 `docs/concepts`。
- **UT 证据**：`coverage-evidence.json` 统一证据优先级；小需求 flow DAG 可 ephemeral；缺证据 BLOCKER 而非静默 SKIP。
- **模块 seam/mock registry**：feature 级 `mock-plan` 可从 registry 派生。
- **Characterization path-c** + **core 节点闭环闸门**：触及图谱 `core` 时触发更新图谱并同步 UT。
- **hmos-app GraphExtractor provider**：模块内调用边、import 边、drift 分级。

**对你意味着什么**

- Skill 5 新需求可能要求 flow DAG / coverage 证据；触及 core 模块时 UT 闭环更严。
- Code Graph 是**导航索引**，编码仍以源码与 spec 为准。

---

## 中等项改动

- **staging context 规范化**：`normalizeStagingContext` 剥离 `projectRoot` / `plan`；示例见 `staging-schema-example.md`。
- **smart 模式 action 解析**：与 template 对齐，drift 时确定性 fallback，不返回非法 action。
- **registry 文案**：`init.task_plan` smart 模式描述纠偏，减少 Agent 误读「自动执行=无需确认 adapter」。
- **杂项**：virtual registry skill `_cross_phase` allowlist；staging 默认值硬化等小修补。

---

## 2.1.0 已有、2.2.0 延续的能力

以下 **未推翻**，2.2.0 在其上增量演进：

- Feature 主产物 `<phase>/` 布局与 dual-read（2.1）
- Init S1–S4 编排、staging 原子 preflight、旧 Step/§ 文档对齐（2.1）
- hmos-app **HSP** 一等形态（2.1）
- 消费者 zip 内 `npm test` = `check:global`（2.1）
- 2.0 起的 profile 通用化、Hylyre 真机、扩展目录、compat、统一确认 UX 等（见 v2.0 / v2.1 发布说明）

---

## 升级指引（2.1.x → 2.2.0）

1. 备份当前 `framework/` 版本。
2. 部署 **`framework-2.2.0.zip`** 或 submodule 更新到对应提交。
3. 工程根 **`/framework-init` UPDATE**（S1→S4）；S2 确认 `materialized_adapters`；接受 builder 带来的 config 结构补全。
4. 每位开发者确认 **personal setup**（`framework.local.json`）。
5. 验证：`cd framework/harness && npm test`；对活跃 feature 抽跑 `--phase` 集成。
6. 检查物化后的 `CLAUDE.md` / `AGENTS.md` 无模板占位符残留。

自 **2.0.x 直跳 2.2.0** 者，须叠加阅读 [`RELEASE-NOTES-v2.1.0.md`](RELEASE-NOTES-v2.1.0.md) 中的产物目录与 staging 变更。更细字段见 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界

- Code Graph 各 Skill 深度接入与 Repo Map 维护入口 **后置**，本轮仅机制与 UT 闸门落地。
- **dual-read**、compat、真机/DevEco 前置条件与 2.1 相同。
- Claude / Cursor adapter 物理拦截能力不对等。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`RELEASE-NOTES-v2.1.0.md`](RELEASE-NOTES-v2.1.0.md) | 上一版（2.1）增量说明 |
| [`RELEASE-NOTES-v2.0.md`](RELEASE-NOTES-v2.0.md) | 2.0 相对 1.0 的完整说明 |
| [`MIGRATION.md`](MIGRATION.md) | 升级步骤与破坏性变更 |
| [`README.md`](README.md) | Framework 目录与 init 入口 |

---

**Framework 2.2.0** — 在 2.1 目录与 staging 契约之上，让 **config 落盘确定、init 执行可审计、入口文档渲染一致**，并补强 **UT 证据与 Code Graph 导航**。

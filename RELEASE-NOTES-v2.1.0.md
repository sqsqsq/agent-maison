# Framework 2.1.0 发布说明

**发布日期**：2026-06-02  
**对比基线**：Framework 2.0.x（zip `framework-2.0.x` / submodule 对应 2.0 线）  
**发布件**：`dist/framework-2.1.0.zip`（SHA256: `aa14f13127a1aa7b141143be88af25db89be6f00fb71f4ca81cb24cd4ea71cad`）  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

> 本文档位于 **AgentMaison 开发仓**（dev-only，不进 `framework-2.1.0.zip`）。消费者解压后请读 `framework/README.md`、`framework/MIGRATION.md` 与实例内 `doc/` 产物路径说明。

---

## 这份文档是写给谁的？

**Framework 2.1.0** 是在 2.0「通用化 + 可扩展 + Hylyre 真机闭环」之上的 **一次 minor 演进**：不推翻 Skill 0–6 主流程，重点收紧 **feature 产物目录契约**、**init 编排与文档真源**、**hmos-app 对 HSP 形态的支持**，并修正消费者侧的 **npm test** 语义。

---

## 2.0.x → 2.1.0：一句话变化

| | Framework 2.0.x | Framework 2.1.0 |
|---|-----------------|-------------------|
| **Feature 主产物** | 多在 `doc/features/<f>/` 根下扁平文件 | **默认** `doc/features/<f>/<phase>/`（如 `prd/PRD.md`）；读侧 **dual-read** 兼容旧路径 |
| **Init** | 编排化 S1–S4 已落地 | 全仓 **旧 Step/§ 编号** 与 DevEco 归属文档对齐；`decision.json` / `context.json` **staging + 原子 preflight** |
| **hmos-app** | HAR 为主 | **HSP** 提升为一等库模块形态（catalog / design / coding 贯通） |
| **消费者 `npm test`** | 曾含 maison 侧 unit/fixtures 语义泄漏风险 | zip 内 **仅** `npm run check:global`（catalog + glossary + docs） |

---

## 大项改动

### 1. Feature 阶段主产物归档（phase-scoped artifacts）

**以前的问题**  
PRD、design、review-report、test-plan 等与 `context-exploration.md`、`reports/` 混在 feature 根目录，目录语义不清，也不利于按阶段查阅与 harness 解析。

**2.1.0 做了什么**

- 在 `harness/config.ts` 引入 **产物→阶段 SSOT**（`PHASE_SCOPED_ARTIFACTS` / `featureArtifactPath`）。
- **默认新布局**：`doc/features/<feature>/<phase>/` 下放阶段主产物（如 `prd/PRD.md`、`design/design.md`、`testing/test-plan.md`）。
- **跨阶段契约**仍在 feature 根：`acceptance.yaml`、`contracts.yaml`、`use-cases.yaml` 等。
- **读侧 dual-read**：harness 与 check 脚本优先新路径，**回退**旧扁平路径，存量 feature 不必一夜搬迁即可继续跑门禁。

**对你意味着什么**

- 新 feature 建议直接按 `<phase>/` 布局落盘；旧 feature 可继续用，但新 BLOCKER 会以新路径为 canonical。
- 报告仍在 `doc/features/<feature>/<phase>/reports/`（由 `paths.reports_dir_pattern` 控制，与 2.0 一致）。

详见 `framework/docs/operations/harness-runbook.md` §4、§5.4 与 `framework/MIGRATION.md`（若有路径迁移专节以 MIGRATION 为准）。

---

### 2. Init 编排：文档真源 + staging 契约

**2.1.0 做了什么**

- **编号与语义对齐**：`framework-init` 已采用 **S1 探测 → S2 计划批准 → S3 执行 → S4 摘要**；全仓 README、Skill 交叉引用、specs、harness 注释中残留的 `Step 0.x` / `Skill 0.3` / `Q1.C` 等 **init 旧编号** 已改为 S 编号或去掉阶段号。
- **DevEco / installPath**：文档明确归属 **personal setup**（`framework.local.json` / `00b-framework-setup`），不再写「由项目 init 自动写入 `framework.config.json`」。
- **Staging 生命周期**：`decision.json`、`context.json` 定义为 S2 在 OS 临时目录生成、S3 harness 消费、S4 销毁的一次性契约；S3 缺 payload 时升级为 **无副作用原子 preflight** + 可审计 run-log（避免「半写盘」误判）。

**对你意味着什么**

- 升级后请 **重跑 `/framework-init` UPDATE**（或项目 init orchestrate），刷新入口文档与 adapter 规则。
- DevEco 路径仍在 **每位开发者** 的 personal setup 中配置，与 2.0 编排化方向一致，2.1.0 主要是 **文档与提示** 不再误导 Agent。

---

### 3. hmos-app：HSP 库模块形态

**2.1.0 做了什么**

- 在 `profiles/hmos-app` 将 **HSP** 提升为与 HAR 等价的一等库模块形态。
- 贯通 Skill 0 catalog、Skill 2 design、Skill 3 coding、Skill 4 review 与相关 harness 检查，减少「术语表/模块画像缺 HSP」导致的漏检。

**对你意味着什么**

- 鸿蒙工程若含 HSP 模块，升级后 catalog / design / coding 门禁与模板示例与 HAR 同级对待。
- `generic` profile **无** 此项；仅 `project_profile.name = hmos-app` 实例受益。

---

## 中等项改动

### 消费者包内 `npm test` 语义

- 经 `release:pack` **sanitize** 后，zip 内根 `package.json` 的 `test` **仅为** `npm --prefix harness run check:global`。
- **不再** 携带 maison 开发侧的 `test:unit` / `test:fixtures`，避免消费者在 submodule 里误跑开发回归。

### Generic adapter / init 提示

- 文档澄清：**generic** 下 `materialized_adapters` 等默认值由 template 写入，Agent **不应** 因「harness 已有默认」而 STOP 要求用户手改 config（减少误中断 init）。

### Adapter 与 bundle 根

- `agents/generic` 与 init 文档对齐 **orchestrated init** 下的 bundle 根路径说明，避免与 S2/S3 物化流程冲突。

---

## 2.0 已有、2.1.0 延续的能力

以下 **未推翻**，2.1.0 在其上增量演进：

- Skill 0–6 全生命周期与 harness 双轨验证（脚本 + verifier）
- `project_profile`（`hmos-app` / `generic`）与 profile provider 调度编译/UT/真机
- `doc/extensions/` 业务扩展、`compat.yaml` 过渡、`merge-framework-config` 补缺
- Hylyre 真机链、即席 `_adhoc` 通道、interaction-renderer 统一确认 UX
- Feature 报告外置到 `doc/features/.../reports/`（`reports_dir_pattern`）

---

## 升级指引（实例工程维护者）

1. 备份或记录当前 `framework/` 版本（submodule 提交或旧 zip）。
2. 将 **`framework-2.1.0.zip`** 解压到工程根（得到 `<工程根>/framework/`），或 `git submodule` 更新到对应提交。
3. 工程根执行 **`/framework-init` UPDATE**（或 `init-orchestrate --scope project`），确认 adapter、config diff、机制文件。
4. 可选补缺配置：  
   `node framework/harness/scripts/merge-framework-config.mjs --apply`
5. 每位开发者执行 **personal setup**（若尚未有 `framework.local.json`）：  
   `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <实例根>`
6. 验证：  
   `cd framework/harness && npm test`  
   （消费者语义 = `check:global`；完整 phase 集成请在实例上对具体 feature 跑 `harness-runner.ts --phase <phase>`）
7. **新 feature** 建议采用 `doc/features/<name>/<phase>/` 主产物布局；**存量 feature** 可暂保留扁平路径，依赖 dual-read，计划搬迁时再统一调整。
8. 若升级后某进行中 feature 撞新 BLOCKER：优先 `backfill:context` / 补齐 `context-exploration.md`；短期可用 `compat.yaml`（见 `framework/docs/evolution/compat-protocol-v1.md`）。

更细的破坏性说明与字段迁移见 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界与前置条件

- **dual-read 不是永久承诺**：新规则与 lint 以 phase 子目录为 canonical；旧扁平路径仅为读侧兼容，长期仍建议迁移。
- **真机 / Hylyre / DevEco** 前置条件与 2.0 相同；2.1.0 未改变 Hylyre vendor 契约。
- **MAINTAINER-CHANGELOG**、plan 版本标签、`release:check-plans` 等仅为 **AgentMaison 开发仓** 工具，不在本 zip 内。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`README.md`](README.md) | Framework 目录说明与初始化入口 |
| [`MIGRATION.md`](MIGRATION.md) | 升级步骤与破坏性变更 |
| [`docs/operations/harness-runbook.md`](docs/operations/harness-runbook.md) | harness 命令、报告路径、feature 产物解析 |
| [`docs/overview.md`](docs/overview.md) | 架构总览 |
| [`agents/README.md`](agents/README.md) | Claude / Cursor / generic 适配差异 |
| [`RELEASE-NOTES-v2.0.md`](RELEASE-NOTES-v2.0.md) | 上一版发布说明 |

---

**Framework 2.1.0** — 在 2.0 能力之上，让 **feature 目录更清晰、init 文档与执行一致、hmos-app 支持 HSP、消费者包语义更干净**。

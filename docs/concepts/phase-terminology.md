# Phase 与「spec」术语消歧

## Feature 阶段（workflow phase id）

| 旧 id | 新 id | 叙述文档 | 机器可读契约 artifacts |
|-------|-------|----------|------------------------|
| `prd` | `spec` | `doc/features/<f>/spec/spec.md` | `acceptance.yaml` |
| `design` | `plan` | `doc/features/<f>/plan/plan.md` | `contracts.yaml`、`use-cases.yaml` |

- **`plan.md`**：契约草案/来源（ephemeral，feature 闭环后可归档）
- **`contracts.yaml` / `use-cases.yaml`**：机器契约**真源**；coding/review/UT/harness 优先读取

yaml 三件套（`acceptance.yaml`、`contracts.yaml`、`use-cases.yaml`）统称 **「机器可读契约 artifacts」**，不与单文件 `contracts.yaml` 混淆。

## 「spec」一词的多重含义（不过载）

| 语境 | 含义 | 目录/文件 |
|------|------|-----------|
| workflow phase | 需求规格阶段 | phase id `spec` |
| 协议目录 | 框架规约与 phase-rules | `specs/` |
| OpenSpec | 框架自身变更规格 | `openspec/specs/` |
| workflow 名称 | 默认流水线 | `spec-driven.workflow.yaml` |

讨论时尽量带上前缀（phase / 目录 / OpenSpec），避免歧义。

## 宿主扩展（spec 阶段）

core 模板只收通用维度；宿主细则通过：

1. `doc/extensions/knowledge/` 章节模板
2. `hooks/spec/on_context_load.md` 叠加指令
3. `phase_rules_overlays.spec` 结构检查
4. `doc/extensions/manifest.yaml` 的 `provides.skill_assets` — extension 模板/示例覆盖或增补 profile `skill-assets.yaml`（同 `skill-id` + `asset_key` 冲突时 extension 赢）；SKILL 正文仍写 `` `profile-skill-asset:<skill>/<key>` ``，由 harness 合并解析

模板末尾锚点：**「宿主扩展治理项」**（见 `profiles/*/skills/spec/templates/spec-template.md`）。

## Legacy alias

旧 phase id `prd`/`design`、旧路径 `prd/PRD.md`/`design/design.md`、旧 check id（如 `prd_p0_coverage`）在 ≥2 个 minor 窗口内只读兼容并 WARN，见 `MIGRATION.md`。

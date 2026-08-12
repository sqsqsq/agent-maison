# Design: prd→spec / design→plan

## 边界

| 层 | spec 阶段 | plan 阶段 |
|----|-----------|-----------|
| 叙述文档 | `spec/spec.md` 长期归档 | `plan/plan.md` ephemeral（feature 闭环后失效） |
| 机器契约 | `acceptance.yaml` 长期 | `contracts.yaml`/`use-cases.yaml` **真源** |
| core vs profile vs extension | core 模板只收通用维度 | profile addendum 补宿主细则；`doc/extensions` + hooks + overlay 叠加 |

**真源**：`plan.md` 仅作草案/来源；coding/review/UT/harness 一律读 `contracts.yaml`。

## Phase alias

`normalizePhaseId(id)`：`prd`→`spec`、`design`→`plan`，首次命中 WARN。用于 workflow-loader、compat-loader、goal-runner resume、check id alias。

## 路径 legacy

`PHASE_SCOPED_ARTIFACTS`：`spec.md`→`spec`、`plan.md`→`plan`。

读解析优先级：canonical `spec/spec.md` > legacy `prd/PRD.md` > flat `PRD.md`（plan 同理）。

`normalizeArtifactFileName`：`PRD.md`→`spec.md` 别名。

## Check id alias

`prd_p0_coverage`→`spec_p0_coverage` 等；overlay 旧 key 经 alias 解析，避免静默失效。

## Extension skill_assets

`extension manifest.provides.skill_assets` 覆盖/增补 profile `skill-assets.yaml` 条目；与 phase key alias 同窗口交付。

## 不做

- 业务行为活规格库（per-feature 快照归档维持）

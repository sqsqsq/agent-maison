# Proposal: prd→spec / design→plan 阶段重定位与改名

## Why

`prd`/`design` 阶段命名与职责边界模糊：PRD 易被误解为产品文档而非长期需求规格快照；design 与实现计划、机器契约真源关系不清。需一次性完成 phase id、路径、skill、check、模板语义重定位，并保留旧 id/旧路径兼容。

## What Changes

- Phase id：`prd`→`spec`、`design`→`plan`；产物 `spec/spec.md`、`plan/plan.md`
- Skill 目录：`spec`→`spec`、`plan`→`plan`；check/rules/prompt 成对改名
- 语义：spec 提炼通用可验证维度 + 宿主 extension 口子；plan 瘦身但保留三门禁章节
- 真源：`plan.md` = 契约草案/来源；`contracts.yaml`/`use-cases.yaml` = 机器契约真源
- 术语：yaml 三件套统称「机器可读契约 artifacts」（不与 `contracts.yaml` 混淆）
- 兼容：旧 phase id、旧路径、旧 check id、extension manifest 旧 key、in-flight feature/goal 续跑
- Extension：`provides.skill_assets` 纳入 extension 覆盖 skill-assets 入口

## 变更性质 / 兼容承诺（条件式）

发布级别**不预先宣称**向后兼容，由验收决定：

- 兼容面逐项有自动化或 dry-run 证据 + 新旧路径/id 双跑全过 + MIGRATION 无「消费者必须执行」步骤 → **minor 弃用**
- 任一项不达 → **major**
- 旧 alias 保留 ≥ 2 个 minor 窗口；移除时单独 major
- 版本号默认保持 `2.3.0`；bump 仅按维护者指示

## Impact

- Affected specs: feature-artifact-layout, harness-gates
- Affected code: workflows, harness/config, check-*, phase-rules, skills, profiles, agents templates, goal-runner, fixtures, MIGRATION.md

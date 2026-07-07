# Proposal: Skill Slim — 主干化瘦身与规则收敛

## Why

10 个 SKILL.md 共 4,939 行（4 个超 Anthropic 建议的 <500 行；最大 business-ut 843），且每阶段"完整阅读正文+addendum+N 个 reference（BLOCKER）"的强制全读门禁直接违背 progressive disclosure；feature skill 426 行含硬约束词 + 入口模板 278 行 48 处硬约束，系多轮 fake-pass 军备竞赛单调累加——规则只增不减，边际遵守率递减。

## What Changes

- **task1（Phase 0，无行为变更）**：硬约束普查台账——范围为全部 10 个 SKILL.md + `templates/AGENTS.md.template` 48 处；四分类（A 脚本已执行→缩为一句+报错自解释 / B 纯文本纪律→合并 / C 事故补丁→原则化 / D 过时重复→删）+ 逐条旧文→新落点映射；条目以「skill id + 约束语义指纹」锚定而非行号；随台账提交主干预算分级提案（150 基准 / 复杂 skill 是否放宽 ≤250）；**停等用户 review 放行后才允许 task2**
- **task2（Phase 1）**：SKILL.md 重构为 ≤150 行主干（触发/输入/流程骨架/门禁清单表/产物契约）+ reference 条件加载；"完整阅读 X（BLOCKER）"改"当 <场景> 时读 X"；主干开头即 track 路由
- **task3（Phase 1）**：入口模板 278 → ≤120 行（路由表 + 红线清单 + SSOT 链接；细则移 framework 内 reference）
- **task4（Phase 1）**：check-docs 增源仓 lint——`skill_body_max_lines` + "强制全文阅读"句式黑名单（新增须进 allowlist 说明理由）

## Impact

- Affected specs: skill-authoring（新增）
- Affected code: `skills/**/SKILL.md`（10 个）、`skills/reference/`、`templates/AGENTS.md.template`、`harness/scripts/check-docs.ts`、`specs/phase-rules/docs-rules.yaml`、`skills/reference/confirmation-registry.yaml`（确认点移动同步）
- 纪律：确认步骤变更先改 confirmation-registry 并过 `check-skills-confirmation-ux`；BLOCKER 语义不删只重组织，拿不准的条目保留进 reference 而非删除

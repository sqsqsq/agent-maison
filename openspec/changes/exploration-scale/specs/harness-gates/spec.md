# Delta: Harness Gates — small 档降级与红线

## ADDED Requirements

### Requirement: Terminology gate degrades on small scale

`project_scale: small` 下 spec 的术语消歧 MUST 降级为一次性对照 architecture.md 模块清单确认：映射表仍产出，免逐行 `[x]` gate；glossary MUST 允许最小种子。headless 例外规则沿用既有 §9 语义。

#### Scenario: small 档 spec 术语步骤
- **WHEN** small 档实例执行 spec 阶段术语消歧
- **THEN** 产出映射表 + 一次性确认即可通过 check-spec 术语门禁，无逐行 [x] BLOCKER

> **Enforced by:** `harness/scripts/check-spec.ts`, `specs/phase-rules/spec-rules.yaml`

### Requirement: Scope red lines survive small scale

`diff_within_scope` 与 spec 的 Scope 声明章节校验在 small 档 MUST 保持与 standard 一致，MUST NOT 随 scale 降级。

#### Scenario: small 档越界照拦
- **WHEN** small 档 feature 的 coding diff 触及 out_of_scope 模块
- **THEN** `diff_within_scope` BLOCKER FAIL（与 standard 行为一致）

> **Enforced by:** `harness/scripts/check-coding.ts`, `specs/phase-rules/coding-rules.yaml`

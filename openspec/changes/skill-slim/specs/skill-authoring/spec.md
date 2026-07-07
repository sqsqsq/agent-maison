# Delta: Skill Authoring — 主干预算与条件加载

## ADDED Requirements

### Requirement: Skill body budget is lint-enforced

每个 `skills/**/SKILL.md` 主干 MUST 不超过预算行数（基准 150；per-skill 覆写须在 docs-rules 显式声明并附理由）；超限 MUST 由 check-docs 源仓门禁 FAIL。

#### Scenario: 主干超预算被拦
- **WHEN** 某 SKILL.md 改动后超出其声明预算
- **THEN** `check-docs` 的 `skill_body_max_lines` FAIL

> **Enforced by:** `harness/scripts/check-docs.ts`, `specs/phase-rules/docs-rules.yaml`

### Requirement: Conditional loading replaces forced full reads

skill 正文 MUST NOT 新增"完整阅读 <文件>（BLOCKER）"类强制全读指令（allowlist 内条目须附理由）；深层细则 MUST 以"当 <场景> 时读 <文件>"的条件加载形式引用。

#### Scenario: 新增强制全读被拦
- **WHEN** 提交的 SKILL.md 含黑名单句式且不在 allowlist
- **THEN** `check-docs` 的 `forced_full_read_blacklist` FAIL

> **Enforced by:** `harness/scripts/check-docs.ts`

### Requirement: Constraint changes are ledger-traceable

C3 改写范围内每条被缩句/合并/原则化/删除的硬约束 MUST 在台账中留有「语义指纹 + 分类 + 旧文→新落点」映射；A 类（脚本已执行）条目 MUST 标注 enforced_by 检查 id。台账条目 MUST 以语义指纹锚定，MUST NOT 以行号锚定。

#### Scenario: 追溯某条被移动的 BLOCKER
- **WHEN** 评审者质疑某原 BLOCKER 是否被删
- **THEN** 台账可按语义指纹查到其分类、新落点或 enforced_by 检查

> **Enforced by:** C3 台账产物（机器可读 YAML）+ 用户 review 放行流程

### Requirement: Entry template budget

实例根入口模板 MUST 不超过 120 行，且 MUST 含 L0/L1/L2 分流路由表、修正三问与红线清单；行为细则 MUST 由 framework 内 reference 承载。

#### Scenario: 入口模板膨胀被拦
- **WHEN** `templates/AGENTS.md.template` 超过 120 行
- **THEN** check-docs 源仓门禁 FAIL

> **Enforced by:** `harness/scripts/check-docs.ts`, `templates/AGENTS.md.template`

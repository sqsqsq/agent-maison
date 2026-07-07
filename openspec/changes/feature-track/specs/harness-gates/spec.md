# Delta: Harness Gates — lite 链门禁

## ADDED Requirements

### Requirement: change phase gate

`change` phase MUST 由 `check-change-lite.ts` 校验：change.md 章节存在性、scope 模块名对照 architecture/catalog 合法、验收与任务 checkbox 语法合规。

#### Scenario: scope 模块名不合法
- **WHEN** change.md 的 in_scope 模块不存在于 catalog/architecture
- **THEN** change phase BLOCKER FAIL

> **Enforced by:** `harness/scripts/check-change-lite.ts`

### Requirement: exit gate is the single lite checkpoint

`exit` phase MUST 一次性执行：编译 + lint（profile provider）+ `diff_within_scope` + 验收 checkbox 全勾校验 +（acceptance 存在 unit 层条目时）UT。`diff_within_scope` 在 lite 下 MUST NOT 被豁免（不降档红线）。

#### Scenario: checkbox 未全勾
- **WHEN** exit 运行时 change.md 验收清单存在未勾项
- **THEN** exit FAIL，feature 不得判闭环

#### Scenario: acceptance 无 unit 条目
- **WHEN** feature 的验收清单不含 unit 层条目
- **THEN** exit 不强制 UT，其余检查照跑

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/check-change-lite.ts`, 复用 coding 检查子集

### Requirement: Runner filters DAG by track

harness-runner MUST 按 feature 的 track（经 C0 `resolvePhaseChain`）过滤合法 phase 与 requires；对 lite feature 请求 full-only phase（如 plan）MUST 明确报错而非静默跑。

#### Scenario: lite feature 误跑 plan phase
- **WHEN** `--phase plan --feature <lite-feature>` 被执行
- **THEN** runner 报"phase 不在该 feature track 的合法集"并 exit 非零

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/utils/runtime-policy.ts`

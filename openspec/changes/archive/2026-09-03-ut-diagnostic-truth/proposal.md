## Why

UT gate 当前会把 DAG/coverage evidence 的“路径未命中”“文件存在但解析失败”“已加载但未声明对应 AC”压扁成相似的覆盖失败，并且 feature-scoped UT 集合的形成过程没有完整暴露。宿主 agent 因此容易把覆盖失败误归因为“未 `git add`”，既给出无效操作，也掩盖真正需要修复的产物。

## What Changes

- 让 UT 文件发现保持纯文件系统语义，并明确报告 Git/context 各自提供的 feature scope 线索；feature-local 的 AC/BD 标签只作为已入 scope 文件的覆盖证据，不再被误用为跨 feature 所有权标识。非 Git 仓继续使用显式 context 路径或确定性回退全量文件。
- DAG 加载保留候选路径、探测目录和逐文件解析错误；损坏的 DAG 不再被静默跳过。
- coverage-evidence 加载区分 missing、invalid 与 loaded，并在 gate 中报告实际探测的 canonical 路径及解析/结构问题。
- 将 `acceptance_coverage`、`ut_case_per_unit_ac`、`ut_coverage_evidence_*` 的证据来源、已检查文件和修复建议拆清，避免暗示 `acceptance_coverage` 会读取 `it()` 标签。
- 横向收口同类 UT 机器产物（testability-audit、mock-plan）的静默解析失败，使存在但损坏的产物得到可定位的 BLOCKER。
- 增加 ignored/untracked、非 Git、跨 feature 同号 AC/BD、DAG malformed、evidence malformed/错路径及三类覆盖 gate 语义的回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: UT gate 必须以可观察、可区分的方式报告输入发现、scope 与解析事实，并且不得让 Git staging 状态成为识别当前 AC/BD 测试证据的必要条件。

## Impact

- 影响 Phase 5 business-UT 的 `harness/scripts/check-ut.ts`、hmos-app UT host/scope helper、UT 产物解析 helper 与相关单元/fixture 测试。
- 不改变 canonical 产物路径或 schema，不要求消费者迁移，`MIGRATION.md` 无需更新。
- 对存在但损坏的 UT 产物由旧有“缺失/跳过/后续泛化失败”收紧为直接 BLOCKER；这是错误分类修复，不是兼容降级。

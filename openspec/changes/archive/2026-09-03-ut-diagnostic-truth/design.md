## Context

Phase 5 先由 profile host 递归发现模块内全部 `*.test.ets`，再由 `ut-file-scope.ts` 形成 `all/scoped` 双集合。当前 scope 只暴露简短的 Git/context 来源；DAG 与 coverage-evidence loader 又把解析异常吞成空集合或 `null`。因此报告无法回答三个最基本的问题：实际看了哪些文件、在哪些路径找过产物、某个产物是缺失还是损坏。

同时，现有 gate 的证据口径并不相同：`acceptance_coverage` 只消费 DAG linkage，`ut_case_per_unit_ac` 与 `ut_coverage_evidence_resolves` 可消费 UT tag/DAG/ac-coverage，`ut_coverage_evidence_mappings_complete` 还要求 skill-authored mapping 行与其声明的 source 一致。phase-rule 文案和 suggestion 没有把这些差异完整表达出来。

本变更只影响 hmos-app 的 UT profile 与 profile-neutral `check-ut.ts` 编排；generic profile 没有宿主测试解析实现，因此不新增 generic 工具链假设。

## Goals / Non-Goals

**Goals:**

- 让测试文件发现不依赖 Git，并让 feature scope 在 tracked、staged、untracked、ignored 与非 Git 环境下都有明确、可诊断的显式路径或保守回退；不得把 feature-local AC/BD 编号误当作 feature 所有权。
- 把 DAG、testability-audit、mock-plan、coverage-evidence 的 missing / invalid / loaded 状态显式化，并给出 canonical 路径与底层解析错误。
- 让每个覆盖 gate 的详情准确列出它消费的证据源、已检查文件和未解析原因。
- 修复同类证据失真：AC 与 BD 同编号不得交叉冒充，DAG mapping 的 archived/ephemeral 声明必须由对应来源支持。

**Non-Goals:**

- 不移除 Git diff；它继续作为“尚未写追溯标签的 WIP 测试”与 hvigor 模块选择的可选 scope 线索。
- 不改变 canonical feature artifact 路径、coverage-evidence schema 或 DAG schema。
- 不替宿主修复预存 UT、业务源码、真机或工具链问题。
- 不把 coverage-evidence 的人工 mapping 当作独立通过凭证；现有“必须有底层证据”原则保持不变。

## Decisions

### 1. Scope 使用显式路径线索；feature-local 标签不是所有权键

抽取共享 `it()` block parser 供覆盖 gate 使用，但 hmos-app 的 feature scope 只由以下可证明归属的路径线索并集形成：

1. 当前 feature 的 context/facts 中显式声明的测试路径；
2. Git working diff（含未忽略的 untracked）提供的 WIP 测试路径。

`AC-01`、`BD-01` 与 branch id 都是 feature-local 编号；不同 feature 可以合法复用。因此测试名标签只在文件进入 scope 后用于覆盖追溯，不得单独把全仓同号旧文件拉入当前 scope。ignored 测试若需在已有其他 scope 线索时被精确纳入，应写入当前 feature 的 context-exploration 路径清单；若没有任何可解析路径线索，维持 `scoped = all` 的兼容回退并报告原因。非 Git 仓可用 context 精确分区，无 context 时同样保守回退全量。

备选方案“仅在 Git/context 为空时用标签选文件”仍无法区分非 Git 仓中两个 feature 的同号 `AC-01`，故不采用。备选方案“所有 gate 永远扫全量”会让同模块内无关预存测试恒常阻断当前 feature，故仅保留为无线索时的兼容回退。

### 2. Loader 返回带状态的 observation，而非吞错后的空值

DAG loader 一次性返回 parsed files、candidate paths、probed directories 与 issues。coverage-evidence 使用 discriminated result（missing / invalid / loaded），保留绝对路径、相对路径和解析/结构校验问题。testability-audit 与 mock-plan 复用现有 validator，但必须补齐 fenced YAML 部分解析失败与非对象根节点的诊断。

`check-ut.ts` 在一次观察后把同一结果传给所有 consumer，避免多个 gate 各自重读文件并得到不一致结论。存在但 invalid 的产物产生一个直接、可定位的 BLOCKER；依赖 gate 不再把它描述成“缺少文件”。

备选方案“在每个 catch 中 console.warn”不会进入 script-report/summary，且无法让机器分类，故不采用。

### 3. 覆盖 gate 显式声明各自证据口径

- `acceptance_coverage`：只统计已成功解析 DAG 的顶层或 node-level `linked_acceptance`/`linked_boundaries`；失败详情列出 DAG 路径、已见 linkage，并且 suggestion 不再要求修改 `it()`。
- `ut_case_per_unit_ac` / `ut_coverage_evidence_resolves`：列出 scoped UT 文件及每个缺口尝试过的 UT tag、DAG、ac-coverage/mapping 来源。
- `ut_coverage_evidence_present`：只接受 canonical 文件存在且有效；标签或 DAG 不能替代 required file。
- `ut_coverage_evidence_mappings_complete`：逐行报告缺 row、source 不受支持或声明 source 无对应底层证据。

phase-rules overlay 同步改正 `acceptance_coverage` 的 target，避免规则文本继续声称它直接扫描 UT case。

### 4. 证据 ID 与来源精确匹配

UT tag 匹配使用 acceptance 中的完整 ID（大小写可忽略），不得再用 `(AC|BD)-<number>` 的宽松正则让 `[AC-01]` 覆盖 `BD-01`，反之亦然。DAG-backed mapping 保留 DAG 的 archived/ephemeral 来源分类；`evidence_source=dag_archived` 只能由模块 `test/dag` 候选支持，`dag_ephemeral` 同理。若声明了 `evidence_ref`，诊断中显示该引用；本次不把它升级为新的强制字段。

## Risks / Trade-offs

- [ignored 测试不会出现在 Git diff] → 当前 feature 的 context-exploration 显式声明其路径；若所有显式线索都缺失则保守回退全量，不凭局部编号猜归属。
- [更严格的 malformed 检查会让过去被静默跳过的坏文件变红] → 这是 fail-closed 的分类修复；详情附 canonical 路径与解析器原文，不要求迁移有效产物。
- [共享粗解析器不是完整 ArkTS AST] → 继续沿用当前 `extractItBlocks` 能力，不扩语法支持面；以现有回归夹具锁定行为。
- [Git 仍参与 tagless WIP 范围] → Git 仅作可选启发式；semantic evidence 与非 Git fallback 均不依赖它。

## Migration Plan

无需消费者迁移。升级后重跑 UT harness；若新 blocker 指向 existing malformed artifact，按报告路径修复该产物。回滚可恢复旧 loader/scope 行为，不涉及数据重写。

## Open Questions

无。

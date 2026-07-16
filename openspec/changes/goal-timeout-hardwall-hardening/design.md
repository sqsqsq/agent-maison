# 设计注记

## P0-2 agent 可写 YAML 形状 inventory（源 artifact → loader → 字段 → 防崩点）

实现形态：**loader 归一化**（一处防全消费链）+ 主门禁结构化 FAIL（`shape:` 前缀 issue /
`feature_spec_shape` blocker），而非逐消费点替换。asArray/takeArray 契约见
`harness/scripts/utils/shape-guards.ts`。

| 源 artifact（agent 可写） | loader（归一化点） | 字段 | 结构化 FAIL 出口 |
|---|---|---|---|
| `spec/ui-spec.yaml` | `loadUiSpecFileWithShapeIssues`（ui-spec-shared.ts） | `assets` / `screens` / `global_elements`（含 `texts`/`owner_screen_ids`）/ `screens[].must_have_elements` / 组件树 `children` 递归 / `tokens`（须 map） | `ui_spec_structure`（spec-ui-spec-check，`shape:` issue） |
| `plan/visual-parity.yaml` | checkVisualParityCoverage 就地归一（plan-visual-parity-check.ts） | `mappings`（须 map）/ `mappings.assets` / `mappings.tokens` / `mappings.components` | `visual_parity_coverage`（`shape:` issue） |
| `spec/reports/asset-crop-vl.yaml` | `loadCropVlEntries`（asset-crop-validation.ts） | `entries` | 每 crop 资产"无裁决记录" FAIL（既有 fail-closed 路径）+ console warn 留痕 |
| `contracts.yaml` | `SpecLoader.loadFeatureSpec`（spec-loader.ts） | 根节点（须 map）/ `modules` / `components` / `files`（既有）/ `module_dependencies`（既有）/ `prd_to_code_traceability[].key_files`（既有） | `feature_spec_shape`（harness-runner 兜底 BLOCKER） |
| `acceptance.yaml` | 同上 | 根节点 / `criteria` / `boundaries` | 同上 |
| `use-cases.yaml` | 同上 | 根节点 / `use_cases` + 嵌套 `ui_bindings`/`user_actions`/`data_boundaries`/`branches`（**loader 统一归一**，含条目级 map 验证；check-ut/named-handler 消费点另有 takeArray/asArray 双保险） | `feature_spec_shape` + check-ut use-case 结构 issue |

ui-spec 消费链（asset-manifest-check :43/:89/:113、asset-acquisition :96、
asset-crop-validation :254/:331、capture-completeness（~15 处）、fidelity-governance :210、
spec-ui-spec-check）全部经 `loadUiSpecFile` 取 doc——loader 归一化即全链防崩。

batch 2（内部结构：layout tree、graph extractor、DAG 文件等）不在本 change。

## P0-4 hard wall 已知边界（复审三轮后定稿口径）

- **硬上界范围 = agent / harness / backoff 三条路径**（spec 已按此修订）：这三条的等待
  全部 deadline 钳制 + 双层杀（bounded killProcessTree + armForceSettleAfterKill）。
- **收尾（run_end 后 completion receipt 等）= pre-check-gated best-effort，不在硬上界内**：
  同步 fs 工作无法被 timer 中断（同步挂起时进程内 watchdog 同样不会运行——这是 Node
  事件循环的物理事实，非实现取舍）；硬杀进程会写坏 receipt。真正的硬界需要把收尾挪进
  可 kill 的 worker/child——**列为开放项，本 change 不做**。现行为：deadline 已过则
  整体跳过（`finalize_skipped`）；已开始的收尾越界由 `finalize_overrun` 事件如实记录
  （喂 FINALIZE_RESERVE_MS 取值回灌）。
- backoff 严格终局：剩余预算装不下**配置的** backoff 即直接 `budget_wall_clock`，
  不睡截断残量（睡完也没预算跑 attempt）。
- 集成级断言（zero-budget 禁 spawn / backoff 终局 / "agent+harness+backoff 总时长 ≤
  wall + grace"）见 tasks 7.3b，待 goal run 实跑回灌或集成测试床。

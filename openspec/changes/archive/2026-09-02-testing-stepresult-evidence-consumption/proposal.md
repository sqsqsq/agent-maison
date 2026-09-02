## Why

Maison 的 testing 门禁目前仍可把计划形态、旧 case 状态或可选 telemetry 当作执行验证，无法证明 Hylyre 实际执行了哪些步骤、断言了哪些元素，导致空断言和 action-only case 可能穿透 P0 语义门。Hylyre 已冻结 `CaseResult` 三轴与 `cases[].steps[]` ledger 契约，本 change 把它接入 Maison 既有 check → summary → quality axes → repair candidates 链，并为无设备的报告重算提供确定性入口。

## What Changes

- **BREAKING** 将 Hylyre `CaseResult.steps[]` 设为 testing 执行证据唯一真源；Maison 按 `execution`、`verification`、`evidence` 与 checkpoint 要求自算 acceptance coverage，不再由 case 旧状态或报告散文推断通过。
- **BREAKING** 接入冻结的 `outcome.failure.domain`/`code` 路由（v1 四态判别式，非 0.3 的 flat `failure_kind`/`failure_code`），区分已尝试失败、未尝试的 blocked/skipped 与无 StepResult 的 explicit skip；禁止从 `diagnostic`、TC 名称或报告散文猜测责任。
- 强化派生编译：正式 `by_text` selector 显式声明 `match: exact|contains`，复用既有 `index`/`scope`/`within`/`all` 消歧，不在运行时自动放宽。
- 增加 Hylyre 版本、trace schema、StepResult 必需字段三重判据与 legacy evidence 边界；原生 StepResult 优先，旧 telemetry 仅作有限过渡。
- 增加 testing 专属 `--report-reconcile-only`，只读既有 trace/plan/timing/meta，先闭合同一最终 run 的路径/指纹/时间戳/feature/case 集合与报告耗时，再完整重算 report、summary、quality axes，且零设备、provider、hvigor、hdc、Hylyre、视觉采集、可执行 lifecycle hook 调用。
- 修订 `p0-skip-repair-subtraction` 中 explicit skip 自动转 `code_regression`/coding 的既有结论：无 StepResult 的 explicit skip 保持 testing FAIL，只有已有 capability resolution 提供机器事实时才进入 capability defer。

### 首次宿主回灌纠偏（plan a6c4e9f2）

- **BREAKING** selector 静态门恢复**开放世界**语义：feature ui-spec 只建模本 feature 新增页面，selector 缺席只给 provenance WARN，不再是 BLOCKER；BLOCKER 只保留可确定错误（非法 selector/match、缺显式 `match`、ui-spec 已证明的多映射无消歧、富文本聚合父节点、同一 checkpoint 结构化绑定的 `target_element_id` 与计划 `by_id` 明确不等）。不构建 ui-spec ∪ acceptance ∪ contracts 的第二套 canonical registry。
- **BREAKING** 顶层 `test-plan.md` 每条 TC 增编译期 `execution_channel`（`hylyre|visual|manual|provider:<capability-id>`）；派生器只编译 `hylyre` 集合，不得新增/删除/改写通道，也不再产出 `explicit_skip_tc_ids`。任一 `hylyre` case 编译失败（含首个 assertion 前无同 case action）则整份 Hylyre 计划不启动。
- `manual` 通道显式无机器 PASS 载体：任一 manual TC 都使本 feature testing 保持 FAIL/UNVERIFIED，不复活 `confirmed_by`/人工 receipt/manual resume。
- derived/trace/timing 精确集合只与 `channel=hylyre` 对账，报告总分母仍覆盖全部顶层 TC；`--report-reconcile-only` 同口径。
- 冻结**单一 result dispatch/parse boundary** 的纪律（不在本 change 重述外部协议字段形状）：required gate 遇 schema/protocol 不匹配一律显式 BLOCKER，禁止 `[]`/SKIP/no-op 或回退中文 status、flat 字段、`tool_calls`、日志、退役 telemetry；非零退出且无 trace 时先解析 pre-run plan-contract reject envelope，缺失/非法才进既有 subprocess crash 兜底。
- 冻结 failure route **基数不变式**：只有实际尝试且实际失败的 step 产生 responsibility route；未执行的 blocked 后缀与 policy skipped 产生零 route；机器证明的 capability/infrastructure 阻塞产生零 route + 一个既有 defer/external disposition；wrong-screen 首断言（同 case 无较小 index 已通过 action）零 coding candidate。

> 外部依赖边界：Step Outcome v1 的具体字段形状（outcome variants、failure/cause/reason/resolution 四个 code 面、selector request/resolution、artifacts、CaseResult/RunResult reduce）由 Hylyre Phase 0 冻结包决定，本 change **不预先复制**；typed consumer 与 T4 最终 routing 实现在 Phase 0 独立 review PASS 后才落地。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-gates`: testing evidence ledger、acceptance 对账、failure 路由、三重判据/legacy、selector 两层门与 report-only 重算契约。
- `runtime-step-evidence`: 原生 StepResult 优先及旧 telemetry 有限过渡边界；普通 interactive testing 不再因 telemetry capability 缺席而把 runtime evidence 自动 SKIP。

## Impact

- 生产实现：`harness/scripts/check-testing.ts`、testing gates/summary/repair candidate utilities、现有 derive 链、`harness/harness-runner.ts` 及 profile provider 接线。
- 契约与规则：`openspec/specs/harness-gates`、`openspec/specs/runtime-step-evidence`、`specs/phase-rules/testing-rules.yaml`、device-testing Skill、hmos-app addendum 与 runbook。
- 消费者迁移：升级 Hylyre 后需重新产生包含三轴和 StepResult 必需字段的 trace；历史 evidence 不删除，但不再凭旧通过状态单独贡献 `verification=passed`。本 change 不包含宿主真机回灌、Hylyre 本体修复、版本发布或 `MIGRATION.md` 之外的宿主改造。

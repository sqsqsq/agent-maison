---
name: provider 通道 per-TC 机器证据绑定 — 当前 run 身份与证据闭环
version: 3.2.0
deferred_to: 3.2.0
# 版本说明：原在 3.0.0 窗口 → 2026-09-03 用户裁决顺延 3.2.0。理由：capability 注册表当前只有 hylyre / hylyre_visual_diff 两个 testing provider，二者各有自己的 per-TC 绑定；hylyre 之外没有任何真实 provider producer，而本 plan T1 自身要求「无真实 producer 不得先建」。宿主自拟的 perf-probe / gesture-trace id 已由 b3d7e5a1 t2 在计划期拦下。顺延期间 provider 通道 TC 保持 fail-closed（unbound → FAIL/UNVERIFIED）。待性能/手势等 provider 真正立项后再启动。
todos:
  - id: t1-select-first-real-provider-use-case
    content: T1 选择首个真实 provider 与真实 TC 用例：盘点现有 provider producer、其机器输出、调用入口与宿主需求，选定一个能端到端执行的 capability/provider/use case 作为唯一首批靶点；没有真实 producer 前不得先建多 provider 通用 envelope、registry 扩展或笛卡尔积框架。计划经独立 review 后，为该真实靶点新建独立 OpenSpec change 并先冻结契约，再动生产代码。
    status: pending
  - id: t2-freeze-provider-result-ssot-and-identity
    content: T2 冻结 provider per-TC 结果唯一真源与当前 run 身份：优先扩展首个 provider 自己的既有机器结果产物，不由 Maison 另造第二套 case ledger；冻结 tc_id、capability_id、provider_id/version、machine outcome、artifact path+sha256、feature/phase、run_id/attempt_id、top-plan/执行输入身份或 hash，以及 non-pass 时可机器复核的既有 provider failure/cause 字段边界。
    status: pending
  - id: t3-implement-exact-provider-binding
    content: T3 实现 provider 通道精确绑定：`provider:<capability-id>` 必须与证据 capability/provider 精确一致；每个 provider 分组内顶层 provider TC 与结果 case 集全有或全无，重复/额外/缺失、跨 TC、跨 feature/phase/run/attempt、陈旧计划或执行输入、artifact 缺失/逃逸/hash 不符全部 fail-closed，并接入现有 testing_channel_evidence_obligation。
    status: pending
  - id: t4-unify-normal-report-only-and-routing
    content: T4 统一 normal 与 report-only 消费同一 provider 证据：report-only 只读同一 authoritative 结果与 artifact，不重新调用 provider；capability resolution 只证明 provider 能力可用性，绝不提升 TC 为 PASS；provider failed/blocked 只按首个真实 provider 已有的机器分类投影 responsibility/disposition，缺机器分类时留 testing/provider FAIL 且零自动 coding 猜测。
    status: pending
  - id: t5-update-templates-docs-and-migration
    content: T5 更新首个 provider 所需模板、profile 文档、testing 指引与一次性迁移说明：解释 provider channel 声明、结果落点、身份/hash 绑定、fail-closed 诊断与 report-only 复用；不引入人工 receipt、confirmed_by、manual resume 或第二套 case 状态账本。
    status: pending
  - id: t6-provider-binding-regression-and-closeout
    content: T6 完成独立回归与验收：合法当前 run provider TC PASS；resolved 无 TC result、跨 TC、capability/provider 不一致、stale/cross-run/plan hash 不一致、artifact 缺失/hash 错误全部 FAIL；report-only 零 provider 调用且裁决一致；无 provider 通道的 feature 零行为变化。按风险运行定向/typecheck/全量/fixture/OpenSpec/plan/diff/LF，并独立 review 收口。
    status: pending
overview: >
  execution_channel=provider:<capability-id> 已是合法编译期分派，但现有 capability resolution
  只有 feature/capability 维度，没有任何 TC 级执行结果；因此所有 provider TC 当前都由
  testing_channel_evidence_obligation 固定判 FAIL/UNVERIFIED。该 plan 从首个真实 provider/use case
  出发，把 provider 自己的 per-run 机器结果绑定到顶层 TC 与当前 run/attempt/plan 输入，形成可复核
  artifact 闭环；不把“provider 已 resolved”误当“某 TC 已执行通过”，也不预建未知 provider 大框架。
---

# provider 通道 per-TC 机器证据绑定：当前 run 身份与证据闭环（e7cecd22）

状态：**2026-09-03 顺延 3.2.0（用户裁决，理由见 frontmatter 版本说明）；仅建 plan，待独立 review；尚未创建 OpenSpec change，尚未实施。**

上游边界：plan [`testing回灌纠偏_入口可达性与首失败归因收口_a6c4e9f2`](./testing回灌纠偏_入口可达性与首失败归因收口_a6c4e9f2.plan.md)
已经交付 `execution_channel`、visual per-TC binding、manual 永久 fail-closed 与 provider fail-closed
预留通道；从本 plan 起，a6c4e9f2 不再负责 provider per-TC binding 的实现跟踪。

---

## 一、当前事实与问题边界

1. 顶层 `test-plan.md` 已允许 `execution_channel=provider:<capability-id>`，该值是编译期执行责任声明，不是执行结果。
2. 当前 capability resolution 只按 feature/capability 记录 provider 是否 resolved/available，缺少 `tc_id`、本次执行 outcome 与可复核 artifact。
3. 当前 `testing_channel_evidence_obligation` 对所有 provider TC 固定返回 unbound，使其留在总分母并保持 FAIL/UNVERIFIED。
4. “provider 可用”只证明调用前置能力在场，不能证明 A TC 已执行，更不能证明 A 的事实覆盖 B TC。
5. visual 已有独立 per-TC id 链；manual 按设计没有 PASS 载体；Hylyre 使用 Step Outcome v1。三者都不属于本 plan。
6. 当前 a6c4e9f2 plan/change 只继续冻结 provider 无 per-TC evidence 时的 fail-closed 行为，不再承担实现。

## 二、目标模型

### 2.1 先选真实 producer，再冻结最小契约

第一批只选择一个真实 provider、一个真实 capability 与至少一条真实 provider TC。选择必须基于：

- 已存在或本版确定要落地的 provider producer；
- 真实执行入口能返回机器 outcome，而不是能力探测或文案；
- 有可复核 artifact，或能够在该 producer 的现有结果产物中补上 artifact 引用；
- 能在 normal 与 device-free report-only 中复用同一份结果。

在该靶点未确定前，不定义多 provider 通用总线、不扩写 capability registry 为执行 ledger、不为未知
provider 预留大量 optional 字段。plan review 通过后，先为首个靶点新建独立 OpenSpec change，契约 strict
通过后才允许生产实现。

### 2.2 provider per-TC 结果唯一真源

唯一真源必须是**首个真实 provider 自己写出的、属于当前 testing run 的 authoritative 机器结果产物**。
若 provider 已有结果文件，则在其上增加最小 per-TC 结构；若没有，则先在 provider 责任域内定义一个
run-scoped 结果产物。Maison 只解析、校验、绑定并投影 verdict，不从 capability resolution、报告行、
日志或用户回复合成 TC 结果，也不新建第二套全局 case ledger。

每条 TC 的最小机器字段：

| 字段 | 义务 |
|---|---|
| `tc_id` | 与顶层 test-plan provider TC 精确匹配；一条结果只证明这一条 TC |
| `capability_id` | 必须等于 `provider:<capability-id>` 声明中的 id |
| `provider_id` / `provider_version` | 绑定实际执行 producer；禁止 resolved provider 与执行 producer 偷换 |
| machine outcome | 至少能区分 `passed`、实际尝试的 `failed`、执行前/中阻塞的 `blocked`；不得读散文判定 |
| artifact `path` + `sha256` | 指向可复核机器产物；路径基准、containment 与 hash 规则由首个 producer 契约冻结 |
| `feature` / `phase` | 必须等于当前 feature / `testing` |
| `run_id` / `attempt_id` | 必须等于当前 authoritative run/attempt，不接受跨轮复用 |
| top-plan / execution input identity | 至少绑定顶层 plan 与 provider 实际执行输入的路径+hash或等价稳定身份；改 channel/TC/输入即失效 |

non-pass 的 responsibility/disposition 不由通用文本推断。首个 provider 若已有机器 failure/cause 分类则复用；
若没有，契约只允许留在 testing/provider FAIL、零自动 coding candidate，直到 producer 能给出机器事实。

### 2.3 集合与身份闭合

按 `(capability_id, provider_id)` 对顶层 provider TC 分组，每个组必须满足：

```text
top-plan 中声明给该 provider 的 TC 集
== 当前 run provider result 中的 tc_id 集
```

- 每条 TC 恰好一行；重复、额外、缺失都拒绝；
- A TC 的 artifact/outcome 不能证明 B TC；
- capability id 或 provider id/version 与声明/实际解析结果不一致时拒绝；
- feature、phase、run、attempt、plan/input identity 任一不一致时拒绝；
- artifact 不存在、越界、无法 realpath、hash 不符时拒绝；
- 当前 run 无完整结果时整组保持 FAIL/UNVERIFIED，不采用“合法子集通过、其余忽略”。

feature 级 capability resolution 继续只回答“能力是否可调用”：缺 provider 可走既有 capability gap；
resolved 只允许启动/选择 provider，不能贡献任何 TC PASS。

### 2.4 normal 与 report-only 同源

normal 在 provider 执行完成后消费 authoritative provider result；`--report-reconcile-only` 读取同一文件、
同一 artifact 与同一身份绑定，重算 `testing_channel_evidence_obligation`、report、summary 与 quality axes，
禁止再次调用 provider、刷新 outcome 或生成替代证据。两模式对相同字节必须给出相同 TC verdict。

### 2.5 责任与 disposition

- `passed`：仅在集合、身份、artifact 全部闭合时关闭该 TC 义务；
- `failed`：表示 provider 已实际尝试并失败；只消费 provider 的结构化机器分类。无分类时 owner 留 testing/provider，零自动 coding；
- `blocked`：表示未完成执行；机器证明 capability absence 时复用 capability defer，机器证明 infrastructure 时复用 external/toolchain disposition；无机器原因时保持 FAIL/UNVERIFIED；
- 后续/重复行不得放大同一 root cause，具体去重键以首个 provider 的真实结果身份为准，不先造通用 failure ledger。

## 三、实施面

后续独立开发至少涉及：

1. 首个 provider producer 的 per-TC result writer 与 schema/validator；
2. `execution-channel-evidence.ts` 中 provider 分支从固定 unbound 改为解析真实结果；
3. `check-testing` normal 与 report-only 的同源加载、身份对账与 verdict 投影；
4. provider result 路径/产物的 runtime policy、模板、profile 指引与迁移文案；
5. 只覆盖首个真实 provider 的正反例矩阵；其它 provider 在显式接入前继续 fail-closed。

## 四、验收场景

1. **合法当前 run PASS**：provider TC 的 capability/provider/feature/phase/run/attempt/plan-input/artifact 全闭合，machine outcome=passed，义务关闭。
2. **resolved 不是执行证据**：capability resolved 但无 TC result，仍 FAIL/UNVERIFIED。
3. **TC 不可串证**：只有 A TC result 时，B TC 仍 FAIL；把 A 的 artifact 改挂 B 同样拒绝。
4. **provider 身份精确**：channel capability、result capability、resolved/执行 provider 任一不一致均失败。
5. **当前 run 身份**：stale/cross-run/cross-attempt、feature/phase 不同、top-plan 或执行输入 hash 不同均失败。
6. **artifact 可复核**：文件缺失、越界、realpath 逃逸、sha256 错误均失败。
7. **精确 case 集**：缺失、重复、额外 case 均失败；不得只消费合法子集。
8. **report-only 零调用**：report-only 不调用 provider，trace/result/artifact 字节不变，裁决与 normal 一致。
9. **责任分型不靠散文**：failed/blocked 只按机器分类投影；缺分类不猜 coding/capability。
10. **零影响**：没有 provider 通道的 feature 在 checks、summary、quality axes 与 report-only 上行为逐字不变。

## 五、明确非目标

- 不修改 Hylyre Step Outcome、selector 或 failure routing。
- 不修改 visual per-TC binding。
- 不复活 manual PASS、人工 receipt、`confirmed_by` 或 manual resume。
- 不把 provider registry / capability resolution 本身当执行证据。
- 不提前支持多个未知 provider 的入口×场景笛卡尔积。
- 不处理当前 `bc-openCard` T8，不操作宿主或设备。
- 不新增场外 trust DB、全局 provider case ledger 或平行测试状态机。

## 六、交付与验证顺序

```text
独立 plan review
→ 选首个真实 provider/use case
→ 新建独立 OpenSpec change，冻结 provider-owned result 与 identity
→ writer + testing_channel_evidence_obligation 接线
→ normal/report-only 同源消费
→ 模板/迁移/定向回归
→ 一次按风险的全量验收与独立 review 收口
```

本 plan 属 `3.0.0` 当前窗口，不使用 `deferred_to`；它与 a6c4e9f2 的 T8 分开推进。

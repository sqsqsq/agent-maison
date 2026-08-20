## MODIFIED Requirements

### Requirement: Discovery preserves authority and provenance

App 部件发现 MUST 为每个当前态断言、设计输入、冲突和 unknown 记录 `source_kind`、可解析的 `source_ref`、可得的版本或 hash、证据强度、观测时间/轮次、抽取方式和 provenance。代码、schema、接口、配置、测试等当前事实优先于文档宣称；SE 或其它有权 owner 提供的外部契约优先于模型推断。根与 discovery 的 `source_fingerprint` MUST 只从规范化 discovery facts、`discovery.inputs.current_scope_items` 及其 source/provenance/revision/hash 确定性重算并一致，不得接受编写方自报，也不得包含 requirement→blueprint 设计映射。证据不足的内容 MUST 原样保留为 `unknown`，发现器 MUST NOT 用常识补齐或静默选择冲突来源。

既有 discovery/人工权威输入 MUST 在 `discovery.inputs.current_scope_items` 中提供当前范围 `requirement|goal|invariant|high_risk` 的闭集；每项 MUST 包含稳定 `item_id`、kind、project-safe 且可解析到精确来源/fragment 的 `source_ref`，并为项目内文件绑定实际原始字节的 `source_sha256`；`source_revision` MAY 作为额外来源版本，但不能替代内容 hash。`discovery.requirement_traceability` MUST 使用相同 `item_id` 与该输入清单双向一一覆盖，并为每项提供一个或多个指向同一 canonical blueprint 真实稳定地址的 mappings。traceability mappings MUST NOT 进入 `source_fingerprint`；mapping 变化 MUST 通过既有 blueprint `revision`、完整 artifact `artifact_sha256` 以及下游 P3 `input_fingerprint` 捕获，不得新增 `traceability_fingerprint`。重复 ID、来源缺失/越界/无法解析、hash 缺失或不符、任一输入无 traceability、额外 traceability、空 mappings、悬空地址或跨 component 地址 MUST 阻塞 P1 admission。该结构只登记已由现有输入识别的当前范围；非结构化材料若没有机器稳定 ID，既有人工权威输入 MUST 先提供稳定 item/source-fragment identity，不要求 P1/P3 建设通用 PRD 解析器、目录扫描器或来源注册表。

#### Scenario: Code fact conflicts with a document claim

- **WHEN** 文档声称某状态由模块 A 持有，但代码、schema 或测试事实显示模块 B 是实际 owner
- **THEN** 蓝图必须以可追溯代码事实为当前态依据，报告冲突双方和责任 owner，且不得把文档宣称写成已确认设计

#### Scenario: An external contract source is unavailable

- **WHEN** 蓝图需要云侧 operation 的 DTO 语义，但唯一权威来源不可访问
- **THEN** 相关字段保持 `unknown`，并形成带来源、owner 和解除条件的 `open_decision` 或 `blocker`，不得生成已批准的 request/response

#### Scenario: A current requirement source is missing

- **WHEN** current-scope traceability 声明 `requirements/ledger.md`，但该路径不能通过项目安全路径解析或文件不存在
- **THEN** P1 admission MUST block，并保留 requirement ID、source ref、owner 和解除条件；不得把未读取的需求视为已覆盖

#### Scenario: A current requirement has no blueprint mapping

- **WHEN** `discovery.inputs.current_scope_items` 中一个已识别的 requirement/goal/invariant/high-risk 没有对应 traceability，或没有映射到任何真实 blueprint stable address
- **THEN** P1 MUST 拒绝蓝图完整性结论并要求补齐设计映射，P3 不得自行选择映射

#### Scenario: Only a design mapping changes

- **WHEN** current-scope source items and discovery facts remain byte-equivalent but a requirement is remapped to a corrected blueprint stable address
- **THEN** `source_fingerprint` MUST remain unchanged while blueprint `revision` and `artifact_sha256` change, causing the old P3 `input_fingerprint` to become stale

> **Enforced by (P1 implementation):** `skills/project/app-component-blueprint/SKILL.md`, `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/utils/blueprint-provenance.ts`

### Requirement: Substantial evolution candidates receive explicit decisions

App design lens MAY 提出变化轴候选，但只有存在可追溯变化证据且对边界、风险、测试、生命周期或后续成本有实质影响的候选才能进入决策卡。每张卡 MUST 记录变化原因、已知变体、稳定契约、Provider、Consumer、绑定时机、状态/数据 owner、缺失/失败/重复语义、替换或故障验证，并把 `human_decision` 冻结为 `establish_seam|keep_direct`。`establish_seam` 表示建立宿主演进接缝，并 MUST 在 `closure_proofs` 中为 contract compatibility、Provider replacement、absence/failure 和 Consumer no-bypass 各绑定一个互不复用、同时列入 decision tests 的精确证明引用；`keep_direct` 表示保持直接实现并 MUST 给出再提取条件。其它字符串、缺失裁决、复用同一证明、证明未进入 tests，或仅凭 `kind=evolution_candidate` 推断建缝 MUST fail-closed。没有门槛证据的候选 MUST 在进入决策卡前被驳回，不得制造“以后可能会用”的抽象。宿主演进接缝位于宿主代码内部，不得进入 Maison provider 注册面或 `goal_requires/goal_provides`、Change Unit `requires/provides` 命名空间。

#### Scenario: An evidence-backed candidate is kept direct

- **WHEN** 现有多个数据来源证明存在变化轴，但人类裁决 `human_decision=keep_direct`
- **THEN** 蓝图必须保存决策卡、裁决依据和再提取条件；P2/P3 使用普通设计与依赖规则，后续变更满足条件时可重新进入调和

#### Scenario: An evidence-free abstraction is proposed

- **WHEN** AI 仅因“未来可能有第二实现”提出接缝，却没有真实变体、边界、测试或生命周期证据
- **THEN** 候选必须在进入决策卡前被驳回，不生成空接缝、空 Provider 或再提取条件

#### Scenario: An unsupported seam decision is supplied

- **WHEN** evolution candidate 使用 `human_decision=approved` 或其它非冻结枚举值
- **THEN** P1 schema/decision validation MUST fail，而不是让 P2/P3 猜测它是否表示建缝

> **Enforced by (P1 implementation):** `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/check-component-blueprint.ts`, `openspec/specs/complex-capability-meta-model/spec.md`

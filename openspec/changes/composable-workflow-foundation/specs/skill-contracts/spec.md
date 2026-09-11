## MODIFIED Requirements

### Requirement: Feature skills publish versioned machine-readable contracts
The framework SHALL provide versioned `skills/feature/<skill>/contract.yaml` contracts for all active feature skills; the legacy inventory of seven includes change-lite only for old change/exit runs. Each phase contract SHALL declare produced artifacts, verifier/check
providers, and capability declarations. A capability SHALL declare its ID, quality
axis, input IDs, obligation applicability, optional named applicability provider, and
`on_missing` policy. Each input SHALL be an ID plus ordered structured artifact/derive
sources; input-level required/optional policy, alternatives, normalizers, and
`absent_effect` SHALL NOT remain authoritative. Applicable tracks SHALL remain a legacy-contract constraint only; new contracts SHALL bind obligations without duplicating their triggering rules.

Enforcement SHALL be implemented by `specs/skill-contract-schema.yaml` and the
contract loader under `harness/scripts/utils/`. A migrated capability ID SHALL bind to
its check ID and contract axis rather than relying on prefix mapping.

#### Scenario: All feature skills have valid capability contracts
- **WHEN** framework regression loads every feature skill
- **THEN** all active contract files SHALL validate and source/applicability providers SHALL resolve; the legacy seven-contract inventory SHALL retain change/exit sections only for old-run compatibility, not new task routing

### Requirement: Contract dependencies form a valid producer-consumer graph
The framework SHALL derive phase-to-artifact producer edges from contract outputs and
validate that artifact sources have registered producers without requiring those producers to execute in this request.
It SHALL validate input references, obligation bindings, provider identities, registered sources and capability-ID uniqueness in the active scope.
Information dependencies and format dependencies MAY be satisfied by valid existing artifacts or equivalent resolved content;
control dependencies MUST require real, still-valid prior operations or decisions. A historical producer edge MUST NOT automatically become a control dependency.
Legacy contracts SHALL retain `effectiveRequires(track)`, track-subset and active-track uniqueness checks only inside their compatibility boundary.

Enforcement SHALL live in `harness/scripts/check-contract-consistency.ts` and reuse
`harness/scripts/utils/runtime-policy.ts`; runtime report-to-check consumption SHALL
be enforced later by the phase runner because static validation has no check results.

#### Scenario: Registered producer need not execute again
- **WHEN** an active input resolves valid content from a registered artifact producer outside the current execution scope
- **THEN** consistency validation SHALL accept the source without adding the producer phase; an unregistered producer/source SHALL still fail with capability, source and consumer diagnostics

#### Scenario: Capability ID duplicates in active scope
- **WHEN** two capabilities active in the same execution scope declare the same ID
- **THEN** the consistency gate MUST fail before phase execution

## ADDED Requirements

### Requirement: Equivalent inputs retain content provenance and responsibility

输入 SHALL 复用 artifact/derive 与静态 provider；resolved MUST 含可消费内容和真实来源，只有 refs 不算满足。absent 可继续下一来源；invalid 或显式新事实冲突 MUST NOT 被 fallback 掩盖。代码只证明现状或 characterization，MUST NOT 自动成为用户预期或外部授权。确定性投影只能提取已明确内容，语义缺口 MUST 回责任 Skill。当前 required 义务的必要输入缺失 MUST blocked；optional 缺失诚实降级，unknown MUST NOT 视为 not_applicable。

首个实际 Skill 的 Research/上下文收集 MUST 建立或承接真实 facts，不固定要求 spec/change；后续只追加本次 delta。产出要求、SpecLoader、checker、verifier、evidence 与 hook 读取 MUST 使用同一有效输入，省阶段 MUST NOT 省掉 CU 必要机器映射或本阶段实际输出验证。

#### Scenario: References alone do not satisfy acceptance
- **WHEN** 输入只有 verification_refs，无法解析预期行为和验收字段
- **THEN** 消费者 MUST 报缺口，不能用当前代码行为补成目标预期

#### Scenario: Invalid preferred source cannot fall back
- **WHEN** 优先来源存在但非法，后备 derive 可返回内容
- **THEN** 输入 MUST 保持 invalid/blocked，不能静默使用后备来源

#### Scenario: First coding invocation establishes facts
- **WHEN** coding 是首个合法阶段且没有有效 facts
- **THEN** coding 写源码前 MUST 通过自身 Research 建立真实基线，不伪造 established_by=spec

> **Enforced by (planned P1–P6):** `specs/skill-contract-schema.yaml`、
> `harness/scripts/utils/capability-resolution.ts`、`harness/spec-loader.ts`、
> `harness/scripts/utils/phase-evidence-manifest.ts`、`harness/scripts/check-contract-consistency.ts`。

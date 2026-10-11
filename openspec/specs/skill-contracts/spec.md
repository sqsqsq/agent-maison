# skill-contracts Specification

## Purpose
TBD - created by archiving change skill-contracts-assess. Update Purpose after archive.
> 动态工作流 g1 已对齐目标规范；新协议的生产接线与验收由 P1–P7 分别完成。
> 本次规范修改不表示动态运行能力已上线，旧运行仍依出生协议兼容。

## Requirements
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

### Requirement: Skill-authored artifacts use versioned compatibility schemas
The framework SHALL maintain versioned schemas under `specs/artifact-schemas/` for the complete inventory of skill-authored artifacts discovered from `harness/spec-loader.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, and feature-skill output declarations.

#### Scenario: A produced artifact lacks a registered schema
- **WHEN** a feature contract produces an artifact that is absent from the generated inventory
- **THEN** `check-contract-consistency` MUST fail framework regression

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

### Requirement: Design skills consume typed blueprint projections

spec and plan SHALL directly consume existing typed acceptance, construction and use-case content from artifacts or registered blueprint providers, preserving its canonical authority and binding. They SHALL only fill content missing within their responsibility and SHALL NOT manually recreate existing authoritative design. Changes to already declared authority SHALL return to the original design owner. Narrative formatting checks SHALL apply only to narrative outputs requested in required_outputs for composable calls; they SHALL NOT cause empty spec.md or plan.md placeholders. Semantic, source, write-set, visual, runtime and mapping checks MUST remain active when applicable. A design-only request MUST NOT start implementation.

Normal design handoff SHALL NOT materialize Feature files. Spec SHALL write its acceptance output from derived design and real UI supplementation; plan SHALL generate the entire Feature contracts.change_unit with canonical identity and complete ID-only implementation/test mappings. When the current legal CU projection contains use-cases@1, or use-cases.yaml already exists, plan required_outputs SHALL require the real use-cases.yaml file for business UT consumption. The file SHALL start from normalized design use cases and MAY only receive non-conflicting supplementation. Projection absence and file absence alone SHALL not introduce an empty file obligation. Existing source-stamped files SHALL use the same authoritative alignment; identity refresh SHALL preserve supplementary bytes only when design/CU contract content is unchanged, otherwise return to the responsible stage without merging.

Without a real ui-spec basis, design-authored P0 device acceptance SHALL retain its ID, priority, steps, expected results, verification layer and focus, without inventing linked_flow, checkpoints, screen flows or element IDs. Once spec has that real basis it MAY add undeclared UI fields through the existing non-conflicting supplementation path, preserving all declared authoritative fields and passing existing alignment and P0 checks. Supplementation SHALL NOT delete acceptance or weaken those checks.

Enforcement: `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/check-plan.ts`, `skills/feature/spec/contract.yaml`, `skills/feature/plan/contract.yaml`, `docs/concepts/blueprint-design-inputs.md`.

#### Scenario: Typed design exists without narrative documents
- **WHEN** the current invocation has valid typed acceptance and construction inputs and does not request spec.md or plan.md
- **THEN** missing narrative files SHALL NOT block machine-content validation or cause placeholder reports; the stages SHALL consume the existing design

#### Scenario: Plan writes projected use cases for real UT consumption
- **WHEN** normal handoff created no Feature files and the current CU has valid projected use cases
- **THEN** plan required_outputs SHALL include use-cases.yaml before it exists; missing output SHALL fail plan delivery
- **AND** plan-written normalized content SHALL resolve as use_cases for the real business UT input without pruning the use-case capability

#### Scenario: Required content is unknown
- **WHEN** a blueprint reference lacks exact expected results, verification layers or construction fields
- **THEN** resolution SHALL report the missing responsibility rather than inventing content or declaring it not applicable

#### Scenario: Spec supplements P0 UI detail without changing design acceptance
- **WHEN** real ui-spec content becomes available after typed acceptance was projected with no UI association
- **THEN** spec MAY add only missing UI flow and checkpoint fields and SHALL pass the existing authoritative alignment and P0 checks
- **AND** changing a declared expected result SHALL fail alignment; declaring an incomplete flow association in the blueprint SHALL remain invalid

### Requirement: Equivalent inputs retain content provenance and responsibility

输入 SHALL 复用 artifact/derive 与静态 provider；resolved MUST 含可消费内容和真实来源，只有 refs 不算满足。absent 可继续下一来源；invalid 或显式新事实冲突 MUST NOT 被 fallback 掩盖。代码只证明现状或 characterization，MUST NOT 自动成为用户预期或外部授权。确定性投影只能提取已明确内容，语义缺口 MUST 回责任 Skill。当前 required 义务的必要输入缺失 MUST blocked；optional 缺失诚实降级，unknown MUST NOT 视为 not_applicable。

首个实际 Skill 的 Research/上下文收集 MUST 建立或承接真实 facts，不固定要求 spec/change；后续只追加本次 delta。产出要求、SpecLoader、checker、verifier、evidence 与 hook 读取 MUST 使用同一有效输入，省阶段 MUST NOT 省掉 CU 必要机器映射或本阶段实际输出验证。

阶段读取目标 MUST 与写入义务分离：`derive.codebase` 消费本阶段实际需要读取的现存源码/Research 来源，`derive.test-targets` 仅消费 profile 识别的测试目标，写入许可仍只来自冻结 contracts/CU 与阶段产出边界。verification-only review/UT 即使没有 implementation 义务，也 MUST 从冻结设计解析被测源码。首阶段合法 facts 的 `source_code_paths` MUST 在校验 subject、项目边界、可读性和重复路径后进入本次绑定，并由 evidence 传给后继；不得全仓扫描补洞。

源码 evidence MUST 从有效 execution scope、phase contract 的 source producer、已绑定 contracts 写集及 profile 测试根共同派生责任，不得把全部读取目标或写集外 Research 统一归给 coding，也不得另建手写路径表。当前 gate phase 可承接自己获授权路径的待产出字节；闭环后责任阶段的完整 manifest 与同路径当前 output MAY 推进上游 Research 观察，且该判定 MUST 在单阶段和整链重算中一致。已消费 owner 的 review 等阶段 MUST NOT 保留可豁免标记。无责任归属、责任证据缺失/损坏或当前 output 不匹配时 MUST 继续 stale。仅声明 `derive.test-targets` 的阶段可把测试目标作为当前输入，因此 UT 自有测试变化 MUST NOT 反向作废 coding/review，而产品源码变化 MUST 从 coding 责任证据开始失效。需求、contracts 与其它非源码输入不适用此承接规则。

`contracts.files` 可同时声明现存输入与后继阶段将创建的授权产出。负责创建该文件的 plan/coding/UT 阶段 MUST NOT 因文件尚不存在而将同组现存源码整体判 absent；生产者完成后，后继消费者遇到仍缺失的必读文件 MUST blocked。plan 产出非空写集后，既有范围修订 MUST 刷新 implementation 来源，并让后继阶段从同一 contracts 绑定重算读取目标。

无 run 的 spec MUST 以冻结候选的 `requirement_basis` 校验原始需求。文件型需求 MUST 绑定原文件路径与字节且不得复制正文；inline 或旧候选缺少可恢复来源时，阶段入口 MUST 要求调用者用 `--requirement` 或 `--requirement-file` 显式重给原文，并核对既有文本身份。Goal run 的冻结 manifest MUST 保持唯一需求权威，阶段 CLI MUST NOT 覆盖它。

spec owner 对 acceptance 的合法修订 MUST 通过既有 scope revision 路径同步 `acceptance-context` 及派生的 unit/device evidence basis；旧 acceptance generation MUST 被替换而非并存。真实内容校验 FAIL 或把验收减空的变更 MUST 保持 blocked，且不得追加修订。

#### Scenario: Runless file requirement is recovered without a snapshot
- **WHEN** a runless candidate was prepared from a requirement file and spec starts without repeating the CLI input
- **THEN** the harness SHALL read that bound file, reject byte drift, and resolve the requirement without storing a text copy

#### Scenario: Spec owner revises acceptance in place
- **WHEN** acceptance existed at first freeze and spec later produces a valid corrected acceptance
- **THEN** the existing revision path SHALL replace acceptance bases across acceptance-context and derived evidence duties; an invalid or empty correction SHALL remain blocked

#### Scenario: References alone do not satisfy acceptance
- **WHEN** 输入只有 verification_refs，无法解析预期行为和验收字段
- **THEN** 消费者 MUST 报缺口，不能用当前代码行为补成目标预期

#### Scenario: Invalid preferred source cannot fall back
- **WHEN** 优先来源存在但非法，后备 derive 可返回内容
- **THEN** 输入 MUST 保持 invalid/blocked，不能静默使用后备来源

#### Scenario: First coding invocation establishes facts
- **WHEN** coding 是首个合法阶段且没有有效 facts
- **THEN** coding 写源码前 MUST 通过自身 Research 建立真实基线，不伪造 established_by=spec

#### Scenario: Verification-only phase reads existing implementation
- **WHEN** a frozen request contains review or UT but no implementation duty
- **THEN** the phase SHALL resolve existing production sources from the frozen construction contract without gaining write authority

#### Scenario: Planned output is absent before its producer
- **WHEN** contracts declare both an existing source and a file owned by a later producer that does not exist yet
- **THEN** the current producer SHALL bind the existing source and retain the planned path as authorization; a downstream consumer SHALL fail if the path is still missing

> **Enforced by (planned P1–P6):** `specs/skill-contract-schema.yaml`、
> `harness/scripts/utils/capability-resolution.ts`、`harness/spec-loader.ts`、
> `harness/scripts/utils/phase-evidence-manifest.ts`、`harness/scripts/check-contract-consistency.ts`。

## ADDED Requirements

### Requirement: Blueprint construction preparation preserves authority

Blueprint projection SHALL use canonical CU design references and existing revision/hash, provenance, admission and current-slice checks. Design owners SHALL author the existing acceptance/contracts/use_cases structures on referenced targets during design; references, prose and verification_refs alone SHALL NOT become executable content. Acceptance SHALL use the existing semantic checks. Contracts SHALL preserve design facts, models, interfaces, the explicit files authorization set, runtime lifecycle and required use cases. The entire contracts.change_unit SHALL be authored by plan in Feature contracts.yaml, using the current canonical CU identity and real implementation/test mappings; design projection SHALL omit it, including legacy blueprint mappings. Missing future mappings SHALL not block design readiness, while complete mapping checks SHALL remain at plan and later consumers. A design projection alone SHALL not satisfy pending plan work.

Projection and the review document SHALL share one target selection and content merge function. Selecting a target SHALL inherit its whole typed content. Arrays SHALL merge by the existing projection row identity, deduplicating identical content and rejecting conflicting content with authority_content_conflict. Object-valued keys SHALL only accept identical complete declarations and SHALL NOT merge per key. Shared targets SHALL contain only content all referencing units should inherit; exclusive acceptance, files and use cases SHALL belong to targets referenced only by their unit. Stable design nodes SHALL NOT be copied or versioned to carry a revised or replacement CU mapping. Predicates and touches SHALL NOT filter inherited content or expand authorization. Legitimate sequential writes to the same file SHALL NOT introduce a new overlap gate.

Design readiness SHALL reuse canonical-only read-only projection checks for all non-retired constructable units, including completed units, without materializing artifacts. Feature use-cases SHALL NOT reverse-validate canonical authority; existing definition gaps and plan alignment SHALL return unaligned stage content to plan. The removed pure mode SHALL NOT be reintroduced. Each declared content kind SHALL be checked even when another is absent. Absent content SHALL identify the existing spec/plan responsibility without a new missing-field gate; declared invalid canonical structure, authority, design write sets or conflicts SHALL reuse existing reasons and return not-ready. The review document SHALL only show canonical declarations and merge conflicts, with handoff validation explained once in the opening reading note.

设计写作与原 scope 质询 SHALL 沿既有 component-design/reference 深化术语含义（glossary 说明结合需求提炼 value.meaning，sample_usage 仅示例消歧）、表级存储/安全/主键/升级（table_schema、data_domains.security 与既有叙述）、真实失败/用户中断（先核 boundaries/failure_recovery、真缺再补，不给 mock 编外部故障）、约定错误/幂等键与涉及跨会话重复卡时的策略，以及 quality_attributes 的兼容/安全隐私/UX/打点/性能结论。不涉及 SHALL 给理由，不凑阈值；App lens/质询 SHALL 使用项目语言。这些 MUST NOT 增加字段/schema/requiredQuestioningScopes 项/机器阻断或降级既有 typed/来源/授权检查。

人读展示 SHALL 共用取值规则保真 string/number/bool/list，false/0 非空、陌生业务键仅一层键值；源缺项每节一行集中，不产空表/整空列，不把有值或深层未展开声明假报未记录，明确未知/不适用分开。完整验收仅文档第 9 章、完整 files 仅开发视图一次，展示身份为来源目标加编号，CU 链接保留实际继承范围，正文可读标签/中文框架枚举保留锚点/链接目标，机制声明文首集中一次、原地址可留追溯附录。概述总览及跨视图图只 canonical 叙述/relations，运行节点取 state_model.phases、边只 branch.expected_phase_seq 相邻项并标 branch；两图 MUST 使用原 parser 且逐边追来源，不按 phases 排列连 Success→Failure。页面清单、已登记截图（每张一次）及 journey_steps 去向表是本批表达上限，MUST NOT 生成页面导航图或从共享动作/文字推路由。renderer 只输出登记图片引用，外部图像字节不得成为新设计事实/绑定输入；隔离验收保图片相对路径并验证可见，写作真实效果仍待干净需求实读。

Normal handoff SHALL NOT materialize Feature acceptance/contracts/use-cases files; spec and plan SHALL consume derived inputs and write their own outputs. Explicit materialization remains a current projection export, not an unpublished legacy-CU migration path. Source-stamped files SHALL permit non-conflicting stage supplementation under the same authoritative alignment used by handwritten content. Refresh SHALL only update source/reference identity when unchanged design and CU contract content is provable, preserving business and supplementary bytes; real content changes or unavailable equivalence SHALL retain that Feature's old files and return to the responsible stage without merging or overwriting, while legal canonical pointers and sibling units continue. Canonical invalidity and real I/O/CAS failures SHALL retain existing transactional failure behavior. Materialization MUST validate the complete candidate and sources before writing through existing artifact paths and MUST reject conflicts with existing decisions. Equivalent files SHALL not be rewritten; valid handwritten files SHALL not be silently migrated or overwritten. Source stamps, normalized content and canonical CU bindings SHALL remain verifiable through the same existing path.

Enforcement: `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/prepare-blueprint-design.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/contract-reference-closure.ts`.

#### Scenario: Only reference strings exist
- **WHEN** the CU has verification_refs but no approved executable acceptance or precise construction content
- **THEN** preparation SHALL return a concrete design gap rather than generate placeholder contracts; absent content alone SHALL not add a handoff gate

#### Scenario: Revision or authority differs
- **WHEN** the bound blueprint revision/hash changes or an external contract conflicts with its authority
- **THEN** old projection SHALL be rejected and the gap SHALL return to its design owner

#### Scenario: Write target is absent
- **WHEN** a referenced construction file is absent from explicit contracts.files
- **THEN** projection SHALL fail without expanding authorization from CU touches

#### Scenario: Legacy mappings do not redefine replacement construction
- **WHEN** shared or exclusive blueprint targets contain legacy change_unit mappings for another CU
- **THEN** common design extraction SHALL omit those mappings without altering canonical history or hiding inherited acceptance/files
- **AND** plan SHALL generate current Feature mappings; missing/unknown/stale IDs and unauthorized files SHALL still fail the existing construction checks

#### Scenario: Declared bad use cases coexist with absent acceptance
- **WHEN** a selected target omits acceptance but declares malformed use_cases
- **THEN** readiness SHALL report the existing invalid-content reason without materializing files, rather than returning early at absent acceptance

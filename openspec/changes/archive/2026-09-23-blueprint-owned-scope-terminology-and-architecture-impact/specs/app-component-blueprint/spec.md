## ADDED Requirements

### Requirement: Changed development nodes carry an admitted module identity

Every node of an applicable and changed development view MUST declare the existing `module` field; `owner` keeps its responsibility meaning and MUST NOT be reused as the module identity. With a project root, `module` MUST resolve to an admitted module, where the single admitted-module helper `resolveAdmittedModules` returns the current module-catalog modules plus the target modules declared by this blueprint's `architecture_impact` decisions with `change: add_module` or `change: move_module` (whose layer MUST be a current DSL outer layer), plus modules named by `change: retire_module` decisions (a retired module stays admitted after closure placement removes it from the catalog, with no layer, so it never takes part in dependency judgement). The same helper SHALL feed node validation, terminology validation, and `componentDependencyAllowed`, which accepts an optional declared `module → layer` map so a newly declared or moved module acting as consumer is judged by its declared layer under the same DSL rules. For a CU-bound Feature the plan component dependency check SHALL use the same helper result from the canonical blueprint, and a `contracts.modules` layer that differs from the admitted layer SHALL FAIL; non-CU-bound Features keep using contracts layers only for modules outside the catalog. The catalog keeps current-state semantics and MUST NOT be edited during blueprint design. When the catalog is unreadable, module identity is unknown and the current slice MUST be blocked. Nodes of a verified_unchanged development view are not re-judged.

#### Scenario: Node module outside the admitted set
- **WHEN** a changed development node declares a module that is neither in module-catalog nor declared by an add_module, move_module or retire_module decision of the same blueprint
- **THEN** P1 SHALL report `blueprint_node_module_unadmitted` as a BLOCKER

#### Scenario: Newly declared module is admitted everywhere at once
- **WHEN** a blueprint declares `add_module` for a new module with a DSL layer, a changed development node uses that module, a terminology fact maps a new term to it, and the node reuses an existing shared component
- **THEN** P1 SHALL pass node, terminology and component dependency validation using the declared layer
- **AND** closure SHALL require the decided add_module conclusion to be placed through the existing `knowledge_refs` obligation

#### Scenario: Missing module field
- **WHEN** a changed development node omits `module`
- **THEN** P1 SHALL report `blueprint_node_module_missing`

#### Scenario: Retired module placed by closure
- **WHEN** a decided `retire_module` decision names a module used by a changed development node and closure placement then removes that module from module-catalog
- **THEN** P1 and the closure re-validation of the canonical blueprint SHALL still pass, with at most a WARN asking to confirm the module name

#### Scenario: Approved module move in a CU-bound plan
- **WHEN** a blueprint approves `move_module` of a catalog module to a new layer and the CU-bound plan's component reuse is legal only under the new layer
- **THEN** the plan component dependency check SHALL pass
- **AND** without that decision, or when `contracts.modules` declares a layer different from the admitted one, the check SHALL FAIL

> **Enforced by:** `harness/scripts/utils/component-assets.ts`, `harness/scripts/utils/blueprint-views.ts`, `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/utils/component-selection-check.ts`, `harness/schemas/app-component-blueprint.schema.json`, `harness/tests/unit/component-assets.unit.test.ts`

### Requirement: Terminology mapping is a discovery fact confirmed once in the blueprint

A term-to-module mapping SHALL be a `discovery.facts` entry with `subject: term:<original term>`, `value: {canonical_module, confidence: high|medium|low, easily_confused_with: []}` and `provenance.source_kind: glossary|catalog`; the source authority rank SHALL include `glossary` at the same rank as `catalog`. `canonical_module` MUST be an admitted module. Check id `terminology_facts_confirmed` SHALL enforce confirmation: a real user confirmation records `provenance.extraction_method: user_confirmed`; a headless auto-continue records `headless_assumed`, is reported as a WARN for must-review, MUST NOT be recorded as `user_confirmed` and MUST NOT be written back to glossary; a `medium` or `low` fact without either is a BLOCKER so admission cannot pass, unless it is parked by an existing controlled gap with `status: open_decision`, `needed_by` other than the current slice and `verification_refs` containing the fact `subject`, and no gap referencing that `subject` has `needed_by` equal to the current slice or `status: blocker`, in which case it is a WARN (the existing admission rules still force a gap needed by the current slice to be a blocker); `high` is accepted only when glossary has an exact hit with the same canonical module. The confirmation point `spec.terminology` is owned by `component-design`. Independent questioning SHALL include a `terminology:current_scope_items` scope whenever current scope items exist; it only requires a questioning disposition and the machine does not judge full coverage.

#### Scenario: Unconfirmed medium term in interactive design
- **WHEN** a term fact has confidence medium, extraction_method is neither user_confirmed nor headless_assumed, and no future open_decision gap parks it
- **THEN** P1 SHALL report `terminology_facts_confirmed` as a BLOCKER and admission SHALL NOT pass

#### Scenario: Unconfirmed term needed only by a future slice
- **WHEN** the same fact is referenced by an open_decision gap whose `needed_by` is a later slice, and by no gap needed by the current slice or with `status: blocker`
- **THEN** P1 SHALL report it only as a WARN and admission of the current slice SHALL be able to pass

#### Scenario: Unconfirmed term needed by both the current and a future slice
- **WHEN** the same fact is referenced by a future open_decision gap and also by a current-slice gap with `status: blocker`
- **THEN** the future gap SHALL NOT park it, P1 SHALL report `terminology_facts_confirmed` as a BLOCKER and admission SHALL NOT pass

#### Scenario: Headless auto-continue
- **WHEN** the same term fact records `headless_assumed`
- **THEN** P1 SHALL NOT block, SHALL report a must-review WARN, and glossary SHALL remain unchanged with no `user-approved` marker

#### Scenario: Canonical module outside the admitted set
- **WHEN** a term fact's canonical_module is not an admitted module
- **THEN** P1 SHALL report `terminology_facts_confirmed` as a BLOCKER

> **Enforced by:** `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/utils/component-blueprint-validator.ts`, `harness/scripts/utils/blueprint-questioning.ts`, `skills/reference/confirmation-registry.yaml`, `harness/tests/unit/component-assets.unit.test.ts`

### Requirement: Architecture impact is a blueprint decision per change item

Architecture impact SHALL be recorded as the flat decision subtype `kind: architecture_impact`, one decision per concrete change item, validated by the existing decision validator. `change` MUST be one of `add_module` (requires `module`, `layer`), `retire_module` (requires `module`; a module no longer in the catalog is only a WARN because closure placement removes it), `move_module` (requires `module`, `from_layer`, `to_layer`), `responsibility_rewrite` (requires an admitted `module`), `dependency_edge` (requires `from`, `to` as outer layer ids or module names and `direction: add|remove`), or `dsl_other` (requires `affected_items[]`), plus `rationale` and the existing owner/provenance/verification_refs/status. Layers MUST be current DSL outer layers. Composite architecture changes MUST be expressed as several decisions; no timing field or state machine is added. A verified_unchanged development view MUST NOT carry architecture_impact decisions. Placement of decided add/retire/move/responsibility changes into catalog or architecture knowledge SHALL use the existing closure `knowledge_refs` obligation.

#### Scenario: Invalid change fields
- **WHEN** a dependency_edge decision lacks `direction`, or an add_module layer is not a DSL outer layer
- **THEN** P1 SHALL report `blueprint_architecture_impact_invalid`

#### Scenario: Unchanged development view masks architecture change
- **WHEN** the development view is verified_unchanged and an architecture_impact decision exists
- **THEN** P1 SHALL report `blueprint_view_unchanged_masks_change` as a BLOCKER

> **Enforced by:** `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/utils/component-closure-knowledge.ts`, `harness/schemas/app-component-blueprint.schema.json`, `harness/tests/unit/component-assets.unit.test.ts`, `harness/tests/unit/change-unit-progression.unit.test.ts`

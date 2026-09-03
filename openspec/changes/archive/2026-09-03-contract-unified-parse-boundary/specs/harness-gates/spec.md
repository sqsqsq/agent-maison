## MODIFIED Requirements

### Requirement: Plan closure proves contract file-reference authorization

Before plan closure can pass, the harness SHALL parse `contracts.yaml` through the production contracts loader, resolve every schema-defined file reference into a normalized in-memory view, and require `references ⊆ contracts.files`. File references SHALL include at least `resource_keys[*].path`, media paths, the navigation registration/configuration file list `navigation.config_files[]`, HAR index/builder/export files and every other contracts-schema field that identifies a materialized file. A missing membership MUST produce a plan-phase BLOCKER naming the path and source field.

Plan closure SHALL adjudicate path safety, normalization and authorization only. Physical existence of an authorized path is NOT a plan-phase verdict: a plan MAY declare a file that coding will create, and the existence verdict SHALL remain the coding-phase `file_completeness` check over `contracts.files`.

Enforcement: `harness/scripts/check-plan.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `specs/phase-rules/plan-rules.yaml`

#### Scenario: Undeclared resource media blocks closure

- **WHEN** `resource_keys` references twenty logo media paths and none is present in top-level `contracts.files`
- **THEN** plan closure MUST fail and list the undeclared media references before coding starts

#### Scenario: Adding every referenced path closes the contract

- **WHEN** the same contract is regenerated with all twenty media paths in `contracts.files`
- **THEN** the reference-closure gate SHALL pass without changing any later UI-scope rule

#### Scenario: Legal contract remains unaffected

- **WHEN** every normalized schema-defined file reference is already a member of normalized `contracts.files`
- **THEN** the new gate SHALL not add a warning or failure

#### Scenario: Authorized navigation config file is not materialized yet

- **WHEN** `navigation.config_files` names a registration file that is present in `contracts.files` but does not exist on disk
- **THEN** plan closure SHALL pass, and the missing file SHALL be adjudicated by the coding-phase `file_completeness` check instead

## ADDED Requirements

### Requirement: One parse boundary decides contracts field legality

The contracts parser SHALL be the single authority that recognizes file-bearing `contracts.yaml` field names. The consumer relation SHALL be one-directional: every canonical field MUST have an identified production consumer, and a field whose only existence is the parser's own inventory MUST NOT be canonical. The converse MUST NOT hold — a consumer reading a non-canonical raw field does NOT make that field legal; such a read is a defect to be migrated onto the parse boundary, and the schema SHALL be extended only by a deliberate decision recorded here, never as a consequence of the read existing. The `navigation` section SHALL expose exactly one file-bearing field, `config_files: string[]`, naming navigation registration/configuration files; the retired speculative synonyms (`main_pages_file`, `route_map_file`, `page_registration_file`, `route_registration_file`, `page_files`, `route_files`, `pages[]`, `routes[]`) SHALL be treated as unknown file-like fields.

A downstream consumer MUST NOT re-interpret raw `contracts.navigation` fields. It SHALL consume the normalized reference view through a pure selector over the resolved closure, and a consumer declaration MUST NOT widen the set of legal contracts fields.

Enforcement: `harness/scripts/utils/contract-reference-closure.ts`, `harness/scripts/utils/types.ts`, `profiles/hmos-app/harness/coding-host-rules.ts`, `specs/artifact-schemas/contracts.schema.yaml`

#### Scenario: Retired navigation synonym is rejected

- **WHEN** `contracts.yaml` declares `navigation.main_pages_file` or `navigation.pages[].registration_file`
- **THEN** plan closure MUST report `unconsumed_file_field` for that source and MUST NOT resolve it into a reference

#### Scenario: Consumer reads navigation paths through the boundary

- **WHEN** the hmos-app coding host needs the navigation registration files
- **THEN** it SHALL select them by reference kind from the resolved closure, and a raw read of `contracts.navigation` outside the parse-boundary module SHALL fail the architecture guard

#### Scenario: Zero-consumer field stays rejected

- **WHEN** `contracts.yaml` carries a `registration_points` collection that no production code consumes
- **THEN** plan closure MUST keep reporting it as an unconsumed file-like field and MUST NOT normalize it into a supported alias

### Requirement: Unknown nested contracts containers cannot hide file references

The unconsumed-file-field detection MUST NOT depend on the outermost key matching the file-like name pattern. When an unknown field name does not match that pattern and its value is an object or array, the parser SHALL descend into the unknown subtree and report any file-like key carrying a file-like value as `unconsumed_file_field`, identifying the full source path. The descent MUST NOT be bounded by a nesting depth: a depth limit that silently stops is itself a fail-open, because burying the path deeper defeats the gate. Termination SHALL come from cycle detection over already-visited containers, not from truncation, and that protection SHALL cover **every** traversal on the rejection path — including the value-side file-like test — so that a self-referential YAML anchor cannot raise a stack overflow. An exception is the worst outcome available here: the closure runs during spec loading, so a throw aborts the load entirely and no structured `unconsumed_file_field` is ever produced. This descent SHALL remain rejection-only: it MUST NOT resolve references, MUST NOT authorize paths, and MUST NOT create a second interpretation of the document.

Enforcement: `harness/scripts/utils/contract-reference-closure.ts`, `harness/scripts/check-plan.ts`

#### Scenario: File path nested under a non-file-like container

- **WHEN** `contracts.yaml` contains `navigation.routes[].file` or a deeper `navigation.groups[].tabs[].registration_file`
- **THEN** plan closure MUST report each as `unconsumed_file_field` with its full source path instead of silently ignoring it

#### Scenario: File path buried below any fixed nesting budget

- **WHEN** a file-like key carrying a repository path sits deeper than any implementation nesting budget under unknown containers
- **THEN** plan closure MUST still report it as `unconsumed_file_field` rather than return an empty issue set

#### Scenario: Self-referential anchor inside a file-like value

- **WHEN** a file-like key's value is a YAML structure that references itself through an anchor
- **THEN** the parser MUST still report `unconsumed_file_field` for that key and MUST NOT raise a stack overflow that aborts spec loading

#### Scenario: Rejection scan grants no authorization

- **WHEN** the nested scan encounters a file-like leaf
- **THEN** it SHALL only produce an invalid-reference issue and SHALL NOT add the path to the resolved reference set

### Requirement: Navigation registration verdicts never fake success with SKIP

The hmos-app `page_registration` structure check SHALL first determine whether the feature declares any `nav_destination` component. With no such component the check MAY SKIP. Once navigation destinations exist, an empty `navigation.config_files` declaration and a declared-but-unreadable registration file SHALL both be BLOCKER failures naming the gap; the check MUST NOT report SKIP for either. Only a readable registration set SHALL be adjudicated on its content.

Enforcement: `profiles/hmos-app/harness/coding-host-rules.ts`

#### Scenario: Navigation destinations without a registration declaration

- **WHEN** components declare `nav_destination` but `navigation.config_files` is empty
- **THEN** `page_registration` MUST fail as a missing registration declaration rather than skip

#### Scenario: Declared registration file is absent

- **WHEN** `navigation.config_files` names a file that cannot be read
- **THEN** `page_registration` MUST fail and name the unreadable path in the same run

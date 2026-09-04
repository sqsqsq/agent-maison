---
derived_from:
  artifact: component-blueprint@1
  component_id: ledger
  blueprint_id: ledger-app-blueprint
  revision: 2
  source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
  artifact_sha256: sha256:24c32c0ccc9b55d3b3814b71523ecfa156bebe73cbfd8dfca405cef978685d90
projection: component-blueprint-review@1
---

# Ledger App component blueprint

Ledger data is persisted by the repository and projected through a replaying store to the UI.

## Design views

### logical

- Applicability: applicable
- Evolution impact: changed
- Unchanged evidence: —
- Purpose: Define ledger concepts and external operations.
- Stakeholders: product, development, test
- Current: Existing repository and create operation.
- Target: Explicit ledger projection contract.
- Delta: Freeze stable contract and state ownership.
- Decisions/gaps: decision:seam-shape
- Verification: verify:logical

Nodes:

- ledger-domain — owner=ledger-team; current=Repository entities; target=Stable ledger domain projection; basis=—; verification=verify:ledger-domain

### runtime

- Applicability: applicable
- Evolution impact: changed
- Unchanged evidence: —
- Purpose: Close loading, mutation, publication, subscription, and recovery.
- Stakeholders: development, test, operations
- Current: Repository loads and UI subscribes.
- Target: Replaying publication with lifecycle cleanup.
- Delta: Add explicit freshness and reconciliation.
- Decisions/gaps: decision:seam-shape
- Verification: verify:runtime

Nodes:

- ledger-repository — owner=ledger-team; current=Persists entries; target=Authoritative local source; basis=view:logical/node:ledger-domain; verification=verify:repository
- ledger-store — owner=app-state-team; current=In-memory projection; target=Replayable projection; basis=view:logical/node:ledger-domain; verification=verify:store

### development

- Applicability: applicable
- Evolution impact: changed
- Unchanged evidence: —
- Purpose: Assign implementation ownership and module seams.
- Stakeholders: development, test
- Current: Ledger files are grouped by technical type.
- Target: Ledger module owns repository and projection contract.
- Delta: Establish explicit module owner without introducing a Maison provider.
- Decisions/gaps: decision:seam-shape
- Verification: verify:development

Nodes:

- ledger-module — owner=ledger-team; current=Existing source package; target=Host-owned ledger seam; basis=view:logical/node:ledger-domain; verification=verify:ledger-module

### deployment

- Applicability: not_applicable
- Evolution impact: —
- Unchanged evidence: —
- Purpose: Decide whether deployment topology is in this component boundary.
- Stakeholders: architecture, operations
- Current: Single process and local persistence.
- Target: No deployment delta for this slice.
- Delta: none
- Decisions/gaps: decision:deployment-na
- Verification: verify:deployment-na

Nodes:

- None (evidence-backed not applicable view).

### scenarios

- Applicability: applicable
- Evolution impact: changed
- Unchanged evidence: —
- Purpose: Tie user-visible scenarios to design and implementation owners.
- Stakeholders: product, development, test
- Current: Add-entry flow exists.
- Target: Refresh and recovery are explicit.
- Delta: Add lifecycle coverage.
- Decisions/gaps: decision:seam-shape
- Verification: verify:scenarios

Nodes:

- add-entry-scenario — owner=ledger-team; current=User adds an entry; target=All consumers see a fresh snapshot; basis=—; verification=verify:add-entry-scenario

## Runtime data flows

### ledger-refresh-flow

- Data domains: data-domain:ledger
- External contracts: contract:create-entry-v1
- Logical contracts: contract:create-entry-v1
- Development owner: view:development/node:ledger-module
- Source of truth: authority=view:runtime/node:ledger-repository; persistence=sqlite:ledger-entry; projections=view:runtime/node:ledger-store; reconciliation=Repository revision wins; pending UI writes are retried idempotently.
- Initial load: id=repository-snapshot; strategy=repository snapshot before subscription attach; owner=app-state-team; freshness=repository revision at attach time
- State owner: view:runtime/node:ledger-repository; states=durable-ledger
- Recovery: id=reload-ledger; persistence=keep prior snapshot and expose retry; subscription=reload repository snapshot; process=rebuild store from repository
- Evidence: src/ledger/LedgerRepository.ts, src/ledger/LedgerStore.ts
- Verification: test/ledger/closure.test.ts#verifyLedgerFlow

Triggers:

- user_mutation — timing=immediate; idempotency=operation request id
- cold_start — timing=before-first-render; idempotency=replace projection at repository revision

Mutations and publications:

- mutation add-entry — persistence=sqlite:ledger-entry; publication=publication:ledger-changed; recovery=recovery:reload-ledger
- publication ledger-changed — snapshot=full-current-ledger

Subscriptions and consumers:

- subscription ledger-page-subscription — consumer=consumer:ledger-page; attach=page mount after snapshot; detach=page unmount; cleanup=remove observer token; replay=latest ledger snapshot; ordering=repository revision order
- consumer ledger-page — initial_load=initial-load:repository-snapshot; update=publication:ledger-changed

## Authority contracts

### create-entry-v1

- Owner: ledger-contract-owner; needed by: cu-ledger-refresh
- Operation: createEntry v1 (app-to-ledger-service); source=contracts/ledger-api.yaml#/operations/createEntry
- Request DTO: CreateEntryRequestV1; source=contracts/ledger-api.yaml#/dtos/CreateEntryRequestV1
  - amount: decimal-string; required=true; nullable=false; semantics=signed ledger amount; source=contracts/ledger-api.yaml#/dtos/CreateEntryRequestV1/fields/0
  - currency: iso-4217; required=true; nullable=false; semantics=entry currency; source=contracts/ledger-api.yaml#/dtos/CreateEntryRequestV1/fields/1
  - parent_id: string; required=false; nullable=true; semantics=optional parent category; source=contracts/ledger-api.yaml#/dtos/CreateEntryRequestV1/fields/2
- Response DTO: CreateEntryResponseV1; source=contracts/ledger-api.yaml#/dtos/CreateEntryResponseV1
  - entry_id: string; required=true; nullable=false; semantics=stable entry identity; source=contracts/ledger-api.yaml#/dtos/CreateEntryResponseV1/fields/0
- Mappings:
  - request-amount (direct): amount → LedgerEntry.amount; rule=Parse decimal without changing currency scale.; source=mappings/create-entry.yaml#/mappings/request-amount
  - request-parent-level (derivation): parent_id → LedgerEntry.parent_level_id; rule=Resolve parent hierarchy level from parent_id; this is not a wire field.; source=mappings/create-entry.yaml#/mappings/request-parent-level
  - request-currency (direct): currency → LedgerEntry.currency; rule=Preserve the ISO-4217 currency code.; source=mappings/create-entry.yaml#/mappings/request-currency
  - response-entry-id (direct): entry_id → LedgerEntry.id; rule=Preserve stable identity.; source=mappings/create-entry.yaml#/mappings/response-entry-id
- Errors: {"validation_error":"request rejected without mutation","conflict":"idempotent replay returns existing entry"}
- Idempotency: client_request_id scoped to active account
- NFR: {"freshness":"UI refresh within one publication turn","durability":"repository commit precedes publication"}

## Cross-view relations

- fabricated-relation: view:logical/node:ledger-domain → view:runtime/node:ledger-cache (caches); owner=ledger-team; verification=verify:invented

- repository-publishes-store: view:runtime/node:ledger-repository → view:runtime/node:ledger-store (publishes_snapshot); owner=app-state-team; verification=verify:repository-store-relation
- domain-owned-by-module: view:logical/node:ledger-domain → view:development/node:ledger-module (implemented_by); owner=ledger-team; verification=verify:domain-module-relation

## Independent questioning

- Provider: independent-design-questioning; status=complete; isolated=true; writes_ssot=false
- view:logical [answered_with_evidence]: Is the logical view supported by current evidence and an explicit target delta? — LedgerRepository owns durable state; LedgerStore owns the UI projection.; owner=architecture-owner; evidence=src/ledger/LedgerRepository.ts, test/ledger/repository.test.ts; verification=verify:state-owner
- view:runtime [answered_with_evidence]: Is runtime ownership and lifecycle closed? — The runtime flow closes load through recovery.; owner=architecture-owner; evidence=src/ledger/LedgerStore.ts; verification=verify:runtime-question
- view:development [answered_with_evidence]: Is development ownership explicit? — The ledger module owns the implementation seam.; owner=architecture-owner; evidence=src/ledger; verification=verify:development-question
- view:scenarios [answered_with_evidence]: Are scenarios traceable across views? — Add-entry traces to logical runtime and development objects.; owner=architecture-owner; evidence=verify:add-entry-scenario; verification=verify:scenario-question
- flow:ledger-refresh-flow [answered_with_evidence]: Does the flow close mutation publication subscription and recovery? — Every local flow reference resolves to a declared object.; owner=architecture-owner; evidence=verify:ledger-flow; verification=verify:flow-question
- relation:repository-publishes-store [answered_with_evidence]: Is repository publication linked to the store? — The relation is explicit and verified.; owner=architecture-owner; evidence=verify:repository-store-relation; verification=verify:relation-question
- relation:domain-owned-by-module [answered_with_evidence]: Is the logical domain assigned to a development owner? — The domain is implemented by the ledger module.; owner=architecture-owner; evidence=verify:domain-module-relation; verification=verify:relation-owner-question
- app_lens:module_boundaries [answered_with_evidence]: Are module boundaries explicit? — Ledger boundaries are explicit.; owner=architecture-owner; evidence=src/ledger; verification=verify:lens-module-boundaries
- app_lens:capability_seams [answered_with_evidence]: Are capability seams explicit? — LedgerDataSource is explicitly decided.; owner=architecture-owner; evidence=decision:seam-shape; verification=verify:lens-capability-seams
- app_lens:feature_flags [answered_with_evidence]: Are feature flags accounted for? — No flag changes the current ledger slice.; owner=architecture-owner; evidence=src/ledger; verification=verify:lens-feature-flags
- app_lens:data_producers_consumers [answered_with_evidence]: Are producers and consumers known? — Repository publication and page consumption are explicit.; owner=architecture-owner; evidence=verify:ledger-flow; verification=verify:lens-producers-consumers
- app_lens:lifecycle_triggers [answered_with_evidence]: Are lifecycle triggers assessed? — All six trigger conditions are evidence-backed.; owner=architecture-owner; evidence=verify:cold-start; verification=verify:lens-lifecycle-triggers
- app_lens:state_owners [answered_with_evidence]: Is every state owner unambiguous? — LedgerRepository owns durable ledger state.; owner=architecture-owner; evidence=src/ledger/LedgerRepository.ts; verification=verify:lens-state-owners
- app_lens:initialization [answered_with_evidence]: Is initialization explicit? — Repository snapshot precedes subscription attach.; owner=architecture-owner; evidence=verify:cold-start; verification=verify:lens-initialization
- app_lens:publication_subscription [answered_with_evidence]: Are publication and subscription closed? — Publication references and subscription cleanup are explicit.; owner=architecture-owner; evidence=verify:ledger-flow; verification=verify:lens-publication-subscription
- app_lens:ui_refresh [answered_with_evidence]: Is UI refresh freshness explicit? — Refresh occurs within one publication turn.; owner=architecture-owner; evidence=verify:ledger-flow; verification=verify:lens-ui-refresh
- app_lens:process_recovery [answered_with_evidence]: Is process recovery explicit? — The store rebuilds from the repository snapshot.; owner=architecture-owner; evidence=verify:process-recreation; verification=verify:lens-process-recovery

## Admission

- Status: pass
- Root questions complete: true
- Current slice: cu-ledger-refresh; contracts_ready=true; design_refs_ready=true; controlled_fakes=[]
- Blockers: —

## Decisions and gaps

- decision seam-shape: decided_with_authority; owner=architecture-owner; verification=test/ledger/closure.test.ts#verifySeamDecision
- decision deployment-na: not_applicable; owner=architecture-owner; verification=verify:deployment-na
- gap cloud-sync-future: open_decision; owner=cloud-contract-owner; needed_by=cu-cloud-sync-future; unlock=Approved cloud sync contract becomes accessible.

> Derived projection only. The canonical YAML remains the machine SSOT.

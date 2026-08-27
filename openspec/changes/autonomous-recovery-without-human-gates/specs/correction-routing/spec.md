## MODIFIED Requirements

### Requirement: Correction classifies to root layer with machine-computed revalidation

A correction SHALL be classified by `classifyCorrection` into `{root_layer, touched_layers[], revalidate[]}`. The revalidation set SHALL contain the root layer and every already-closed downstream phase required by the resolved workflow; revalidation is machine gate execution, not re-production of unaffected upstream artifacts. In attended mode the routing may be shown for user editing, but it SHALL NOT require a confirmation receipt. In unattended mode a frozen correction input plus the existing deterministic classifier SHALL route automatically; low confidence or ambiguous ownership SHALL fail closed as unresolved input rather than create a human quality gate. Any stale closure SHALL return to its owner through the same backtrack/re-sign path.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/correction-routing.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: post-delivery implementation defect starts a successor

- **WHEN** a completed feature receives frozen feedback that spacing is wrong while requirements are unchanged and the classifier resolves coding as the root
- **THEN** a successor/correction run SHALL route to coding and revalidate its closed downstream phases without modifying the predecessor's completion proof

### Requirement: Verification hand-off is an evidence gap

When a correction requires testing but the host lacks the required device/runtime capability, the runner SHALL record the concrete missing capability and project the existing external/capability-missing defer state. A request for someone to test manually, a manual-confirm record, or a user reply MUST NOT count as completion evidence. If the capability is available but the execution evidence is missing or invalid, the owning testing gate SHALL FAIL and retry/fuse normally.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/capability-resolution.ts`, `templates/AGENTS.md.template`

#### Scenario: correction host lacks a required device provider

- **WHEN** a correction's revalidation includes P0 device testing and preflight proves the selected profile/provider cannot supply it
- **THEN** the correction SHALL defer with the exact capability blocker and SHALL NOT announce completion or wait for a quality signature

## ADDED Requirements

### Requirement: User feedback after completion is successor input, not retrospective confirmation

User feedback received after a valid feature completion SHALL create or amend a new correction/successor input bound to the new run identity. The prior run's evidence and completion result SHALL remain immutable audit history. The feedback SHALL route to spec when it changes the target requirement and to the responsible implementation phase when the requirement is unchanged.

Enforcement: `harness/scripts/utils/correction-routing.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: changed UX intent routes to spec

- **WHEN** the user changes the desired layout after delivery rather than reporting an implementation mismatch
- **THEN** the new successor input SHALL route to spec and the old run SHALL NOT gain or lose a confirmation mark

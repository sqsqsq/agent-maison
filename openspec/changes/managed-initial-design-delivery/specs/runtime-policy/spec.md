## MODIFIED Requirements

### Requirement: Business automation authority comes from one common entry input

Task automation authority SHALL be a single explicit input: `authorization.autonomyAuthorized`. `goal-runner --detach`, `--resume … --detach` and the supervisor's same-form restart SHALL convert the user's unattended choice into that input at the launcher, pass the existing non-persistent `--authorize-autonomy` argument through to the detached child before `--detach` is stripped, and the session `--authorize-autonomy` SHALL produce the same value. Policy resolution MUST NOT infer authority from `runtimeOwnerKind`, executor mode, `--detached-child`, `manifest.unattended`, `approval_mode`, process owner, `initial_design`, `delivery_origin` or any agent ledger. The authorization input SHALL remain bounded by the original request scope, explicit prohibitions, required credentials/irreversible actions and hard budgets; it SHALL NOT upgrade a single-duty request into a complete delivery.

Managed initial design, authorized design repair and origin-bound CU continuation SHALL use that same original trusted authorization input. Recovery/supervisor SHALL retransmit it without treating origin as a durable grant. Equivalent authorization, capabilities, facts and budget SHALL yield the same business disposition, responsibility, next action, waiting/stopping and completion through session and detached transport; human presentation alone MAY differ. Ordinary repairable format/design gaps SHALL return to their responsible owner within existing bounds rather than require a new human approval merely because they occur before CU admission.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-supervisor.ts`.

#### Scenario: Detached child no longer guesses authority

- **WHEN** a user launches `goal-runner --detach` (fresh) or the supervisor restarts `--resume <run> --detach`
- **THEN** the parent converts the entry into the common authorization input and passes `--authorize-autonomy` to the child; restart and continuation SHALL NOT lose original authority or reset accumulated budget

#### Scenario: Transport and origin markers alone do not authorize

- **WHEN** only `--detached-child`, process owner, `manifest.unattended`, `approval_mode=never` or `delivery_origin` is present without trusted entry conversion or explicit session authorization
- **THEN** policy SHALL resolve `confirmation_required`; design/budget changes retain their original confirmation path

#### Scenario: Both transports see the same waiting semantics

- **WHEN** the same condition blocks a session-owned and a process-owned complete delivery
- **THEN** both SHALL use the same probe, remaining budget and cutoff; returning an item to the session SHALL change only transport/presentation, not recovery or business disposition

#### Scenario: Recoverable initial design gap returns to its owner

- **WHEN** an initial design has a repairable schema or contract gap within the original full-delivery authorization and remaining budget
- **THEN** both transports SHALL dispatch the same responsible design work instead of requiring a fresh grant solely because no CU exists

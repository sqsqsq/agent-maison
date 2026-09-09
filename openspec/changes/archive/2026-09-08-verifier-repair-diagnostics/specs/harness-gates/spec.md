# harness-gates Spec Delta

## ADDED Requirements

### Requirement: A diagnosable product failure still issues a verifier request

Verifier request production SHALL be decided by one shared pure predicate consumed by both the prompt assembly step and the summary writer. Its inputs SHALL be the resolved verifier plan, the phase, the script verdict and checks, the derived `report_validity`, and the existing `has_blocked` capability projection; no caller SHALL re-derive eligibility on its own, and the predicate SHALL NOT read a model, execute a provider, or persist state.

`disabled` SHALL produce nothing. `enabled` with a `PASS` script verdict SHALL keep the existing success path unchanged. `enabled` with a `FAIL` script verdict SHALL produce a request in exactly two shapes, both reproduced in production:

- **review** — `report_validity=PASS`, at least one BLOCKER FAIL, every BLOCKER FAIL is `negative_verdict_closure` or `conditional_pass_closure`, no BLOCKER SKIP, no blocked capability;
- **ut** — the UT compile gate PASS, the UT run gate FAIL attributed `code_regression`, no other BLOCKER FAIL or SKIP, no blocked capability, and `report_validity` not `FAIL`.

Every other failure — `INCOMPLETE`, missing source, malformed report artifacts or UT structure, compile / device / toolchain failures, and any mix of a negative verdict with a material failure — SHALL produce nothing, preserving the existing "fix the input or the environment first" exit. UT SHALL NOT mechanically require `report_validity=PASS`: a pure UT round may legitimately be `UNVERIFIED` because no report-format check ran, and eligibility rests on the real compile and execution facts. `ut_run_status` is a derived MINOR WARN panel and SHALL NOT block a diagnosis the predicate already allowed.

Attribution SHALL be read as `CheckResult.failure_kind` first, falling back to the existing `失败归因：` details parser only when the structured field is absent; structured device/toolchain classification SHALL win over conflicting text. There SHALL be exactly one implementation of that fallback parser.

The product verdict, blocker count and `closure_status` SHALL NOT change because a diagnosis request was issued. A verifier PASS SHALL NOT be consumable as a product PASS, and the failing phase SHALL NOT be required to close before the diagnosis runs.

Enforcement: `harness/scripts/utils/verifier-plan.ts`, `harness/harness-runner.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`

#### Scenario: A negative review verdict reaches the verifier

- **WHEN** review's script gate fails with `negative_verdict_closure` as its only BLOCKER FAIL, the report artifact checks pass, and no capability is blocked
- **THEN** the prompt SHALL be assembled, a request SHALL be issued and written to disk, and the summary SHALL still record `verdict=FAIL` with `closure_status=open` and no repair candidates until a report exists

#### Scenario: A negative verdict mixed with a material failure produces nothing

- **WHEN** review fails with `negative_verdict_closure` plus any other BLOCKER FAIL or BLOCKER SKIP, or with `report_validity=FAIL`
- **THEN** no prompt, request or subject SHALL be produced and the next action SHALL remain the existing fix-the-blockers route

#### Scenario: A real UT assertion failure is attributed and released

- **WHEN** every selected ohosTest module produced a real execution result and each failing module ran, produced cases, and failed some with concrete failures, with no missing tool, no timeout, no non-clear install blocking and no structured on-device failure evidence
- **THEN** the `ut_hvigor_test` FAIL SHALL carry `failure_kind=code_regression`, its details SHALL remain the unmodified formatter text, and the UT diagnosis request SHALL be issued

#### Scenario: An environment failure is never re-attributed as a product defect

- **WHEN** the UT failure carries a structured device or toolchain classification, an incomplete module execution, `total=0`, or a timeout
- **THEN** the formatter's own attribution SHALL stand, `code_regression` SHALL NOT be written, and no diagnosis request SHALL be issued

### Requirement: The repair diagnosis next action is decided first and rendered with its paths

When a diagnosis request has been issued and the current subject has no usable report text, `next_action` SHALL be `run_verifier_for_repair`. "Usable" SHALL mean more than a self-consistent terminal block: the checks that decide this diagnosis SHALL also be readable from the body — for UT the two candidate-required checks, for review the per-issue verification block. When they are missing, conflicting or placeholder, the round SHALL stay on this action and the NEXT line SHALL point at rewriting the report from the verifier's original reply, not at changing the product; falling back to the generic "fix the blockers" route makes the repeated harness re-read the same unusable body forever and produce no candidates. It SHALL be decided before every other branch of the next-action projection: the UT panel's `can_claim_done=false` route is otherwise always satisfied by exactly these failures and would swallow the diagnosis. Eligibility has already excluded every material and environment failure, so deciding it first SHALL NOT pre-empt any real fix-first route. It is an action string only — no new phase, no parallel state machine — and the PASS path SHALL be unchanged. Once a usable report exists for the current subject, the action SHALL fall back to the ordinary failure routing so the recomputed repair candidates drive the owner.

The failure console SHALL render this action before the generic "non-PASS means fix the blockers" line, and SHALL name the request path, the report write path and the follow-up command. The follow-up SHALL distinguish the two orchestrations: under goal orchestration the dispatcher ends the round and returns, because the outer runner re-runs the gate harness and recomputes candidates; otherwise the dispatcher re-runs this phase's harness once. That distinction SHALL be derived from the actual orchestration context — a residual environment variable alone SHALL NOT be treated as proof that an outer runner exists, and when it cannot be confirmed the conservative "re-run it yourself" instruction SHALL be given. A readable run-control file is not that proof either: the invocation SHALL carry the attempt identity the orchestration injects alongside the run id, and the run's owner SHALL still be `active`. A `released`, `orphaned_session` or `quiescing` owner means nobody will recompute the candidates, so those SHALL fall back to the self-rerun instruction.

The goal failure feedback SHALL carry the same three instructions and SHALL NOT require candidates to exist or the phase to be closed before the round returns; an attended callback SHALL NOT report `passed` to compensate.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/goal-runner.ts`, `agents/claude/templates/agents/phase-executor.md`, `agents/claude/templates/hooks/check-phase-completion.mjs`

#### Scenario: The UT completion panel does not swallow the diagnosis

- **WHEN** a UT diagnosis request is issued while `ut_run_status` reports `can_claim_done: NO`
- **THEN** `next_action` SHALL be `run_verifier_for_repair`

#### Scenario: The goal round does not run a second harness

- **WHEN** the round runs inside a confirmed goal agent invocation
- **THEN** the NEXT line SHALL tell the dispatcher to write the report and return, and SHALL NOT instruct it to re-run the phase harness

#### Scenario: A stale run id does not claim an outer rerun

- **WHEN** the environment still carries a run id whose run-control owner is `released`, `orphaned_session` or `quiescing`, or whose attempt identity is absent
- **THEN** the NEXT line SHALL give the self-rerun instruction

#### Scenario: An unreadable report body routes to a format repair

- **WHEN** the current subject's report has a self-consistent terminal block but its diagnosis-required checks cannot be read (missing, conflicting or placeholder)
- **THEN** `next_action` SHALL remain `run_verifier_for_repair`, the NEXT line SHALL instruct rewriting the report from the verifier's original reply, and no candidate SHALL be derived from that body

#### Scenario: The report arrives and the owner candidate appears

- **WHEN** the verifier's reply has been written verbatim for the current subject and the harness runs again over unchanged material
- **THEN** the subject SHALL be unchanged, the per-issue confirmations SHALL produce owner-routed repair candidates, `next_action` SHALL no longer be `run_verifier_for_repair`, and the product SHALL remain FAIL with `closure_status=open`

## MODIFIED Requirements

### Requirement: The verifier plan is resolved once and consumed by every stage

Whether a phase runs a verifier SHALL be resolved by one shared function from four inputs — the workflow's `verifier_prompt` declaration, the feature track, the resolved evidence policy, and whether the active adapter declares `verifier_subagent` — producing exactly one of `disabled` or `enabled`. The runner's production path, the receipt gate and the Skill guidance SHALL all consume that single result; none of them SHALL re-derive applicability on its own.

Resolution order SHALL be fixed and SHALL NOT be reordered by any caller: profile-disabled phase, then absent workflow declaration, then evidence policy `not_applicable` / `off`, then absent adapter reviewer, then enabled.

`disabled` SHALL mean **absent equals zero**: no `ai-prompt.md`, no request, no subject, no invocation, and no closure requirement. A workflow that does not declare `verifier_prompt` for a phase SHALL be `disabled` — that is "not applicable", not "missing", and a fallback template SHALL NOT be synthesized to fill the gap. Artifacts left on disk by an earlier `enabled` generation SHALL **never** re-activate a capability the resolver has judged `disabled`, and switching a phase from `enabled` to `disabled` SHALL NOT require deleting them.

`enabled` SHALL mean the capability exists this round; whether a request is actually issued SHALL be a separate judgement made by the shared request-eligibility predicate, which covers both the ordinary `PASS` path and the two narrow diagnosable-failure shapes. Applicability and eligibility SHALL remain two questions with two answers: a phase may be `enabled` and still issue nothing.

The resolution SHALL be identical in `interactive`, `headless` and `goal`. There SHALL be no mode-conditional branch anywhere in verifier adjudication: the previous asymmetry — an adapter-capability gate that applied to `interactive` only, paired with a publication path that refused to publish under `goal` — produced an empty intersection in which a completed, passing review could never close a phase, and burned two unattended runs before anyone noticed.

There SHALL be no third state. A `blocked` outcome existed to express "policy demands a verifier that this adapter cannot publish"; with publication no longer adapter-specific, the only remaining gap is a tool that cannot dispatch a subagent, which is disclosed as `disabled` rather than raised as a failure.

The resolution result SHALL NOT be persisted as a summary snapshot or any other parallel state.

Enforcement: `harness/scripts/utils/verifier-plan.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: A lite feature produces no verifier artifacts in any mode

- **WHEN** a `lite` feature runs `change`, `coding` or `exit` in interactive, headless or goal mode
- **THEN** the plan SHALL be `disabled`, no prompt/request/subject SHALL be written, and the closure path SHALL remain the existing change/coding/exit chain with the receipt mechanism not applicable

#### Scenario: An enabled phase can still issue nothing

- **WHEN** the plan resolves `enabled` and the script gate fails outside the two diagnosable shapes
- **THEN** the plan SHALL remain `enabled`, no request SHALL be issued, and the closure gate SHALL keep treating the phase as one that owes a verifier once its script gate passes

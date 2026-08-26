## ADDED Requirements

### Requirement: The visual provider identity is a paired CLI input, frozen in the manifest, adjudicated at one point

The goal runner SHALL accept `--visual-adapter` and `--visual-model` as a **pair**: supplying one
without the other SHALL fail fast. Both values SHALL be normalized and validated the same way the
existing explicit model pin CLI value is (trim, non-empty, bounded length, no control characters, no
model-name whitelist). CLI input SHALL take precedence over the personal local configuration.

An accepted provider identity SHALL be frozen into the manifest as
`visual_provider_pin: {adapter, model}`. That key SHALL enter the manifest identity hash
**conditionally on key presence**, exactly like the existing conditional identity fields, so older
manifests without the key are unaffected on resume. Manifest loading SHALL validate the shape. A
resume SHALL read the frozen value and SHALL NOT re-read the local configuration; a successor SHALL
inherit it with the other inherited fields.

The frozen identity SHALL reach the gate process on **every** execution path that has a manifest —
the detached runner and the attended session entry alike — through one shared injection helper. The
gate falls back to the personal configuration only when no frozen identity was injected; an attended
path that skips the injection would let a mid-run edit of the personal configuration swap the run's
visual endpoint, which is exactly what freezing exists to prevent.

A single pure function SHALL adjudicate the final provider pin, using a rule subset aligned with the
existing model-pin adjudicator: a fresh run accepts the CLI value; a resume with a differing value
requires `--override-manifest`; a successor's birth input may override the inherited value without
that flag.

The primary and the provider MAY be the same adapter with different models, and MAY be different
adapters. A provider identical to the primary endpoint SHALL NOT be an error — it is merely redundant
advisory information, since `native` mode does not call a provider at all.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`,
`harness/scripts/utils/goal-manifest-cli.ts`

#### Scenario: a lone flag fails fast

- **WHEN** the runner is started with `--visual-adapter` but no `--visual-model`
- **THEN** the run SHALL fail fast before any phase invocation with a message naming the missing flag

#### Scenario: an attended run keeps the frozen endpoint after a local edit

- **WHEN** an attended run's manifest froze a provider and the personal configuration is edited to a
  different provider before a gate round
- **THEN** the gate SHALL use the frozen manifest identity, not the edited personal configuration

#### Scenario: resume does not re-read personal configuration

- **WHEN** a run with a frozen `visual_provider_pin` is resumed after the local configuration changed
- **THEN** the run SHALL use the frozen pin, and changing it SHALL require the explicit override flag

### Requirement: Blind visual launch requires one explicit authorization per run

The goal runner SHALL accept an independent boolean flag `--allow-blind-visual`. This flag is the
goal-run carrier for an explicit choice to proceed without either primary image input or a legal
visual provider. `fidelity=reference_only` SHALL NOT count as that authorization, and the flag SHALL
NOT be written to `framework.local.json` or any other personal persistent configuration.

When the flag is explicitly present, the runner SHALL unconditionally freeze
`allow_blind_visual: true` into the manifest **before** the existing manifest identity-drift check.
The key SHALL enter the manifest identity hash conditionally on key presence. A fresh run MAY accept
the key directly. A resume SHALL use the frozen value without requiring the flag again; adding the
key to an older manifest that did not contain it SHALL require the existing `--override-manifest`
path. A successor SHALL strip the key from the inherited manifest, so the new run requires a new
explicit authorization. No post-canary manifest write, identity rebase, or second drift check SHALL
be introduced. The key MAY be present for a native or delegated run, but it SHALL NOT affect routing
outside the blind-without-provider branch.

After the primary canary attempt has completed, and before any formal phase invocation, the runner
SHALL evaluate one pure launch decision using only existing sources of truth:

- UI relevance from `resolveUiRelevanceForRun`;
- primary image input from the existing effective `resolveContextAdapterImageInput` chain, not from
  the current probe result directly;
- provider availability from the frozen `visual_provider_pin` plus adapter-catalog eligibility;
- authorization from the manifest's `allow_blind_visual` key.

The decision SHALL have exactly five branches: a non-UI requirement is allowed; a UI requirement
whose primary has image input is allowed as native; a blind primary with a legal provider is allowed
as delegated; a blind primary without a provider but with frozen authorization is allowed as blind;
and a blind primary without either provider or authorization is a pre-phase BLOCKER. The BLOCKER
message SHALL name both remedies: configure a visual provider through `record-visual-provider`, or
rerun with `--allow-blind-visual` to authorize blind execution explicitly.

The existing `canaryHardCliFailure` HALT branch SHALL run first and SHALL NOT be masked by the blind
authorization decision. Under `--dry-run`, the blocking branch SHALL emit a WARN containing
`would_block` and SHALL NOT stop, because no formal phase is launched. A configured provider whose
personal setup state is `unavailable` SHALL count as no provider, never as authorization. Once a
legal provider was selected and launch was admitted as delegated, a later provider invocation
failure SHALL remain on the existing fail-open path and SHALL NOT re-run this launch authorization
check.

Ordinary interactive use, attended goal use, and unattended goal use SHALL be three carriers of this
single policy, not separate policies: an interactive user's in-place "skip and run blind" choice
authorizes only that operation; attended goal orchestration translates the same choice into the CLI
flag; and unattended execution must either have a legal provider or pass the flag explicitly.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/goal-mode-entry.ts`,
`harness/scripts/utils/goal-manifest.ts`,
`harness/scripts/utils/goal-manifest-cli.ts`, `harness/scripts/utils/goal-preflight.ts`,
`harness/scripts/check-personal-setup.ts`

#### Scenario: a non-UI requirement is not subjected to the visual launch prerequisite

- **WHEN** the requirement is not UI-related, regardless of primary vision, provider, or authorization
- **THEN** the launch SHALL proceed without consulting or requiring a visual provider

#### Scenario: native vision ignores an otherwise present blind authorization

- **WHEN** a UI-related run has effective primary image input and its manifest contains
  `allow_blind_visual: true`
- **THEN** the launch SHALL proceed as native and the authorization key SHALL NOT change the route

#### Scenario: an eligible frozen provider admits delegated launch

- **WHEN** a UI-related run has a blind primary and a frozen provider whose adapter is eligible in
  the adapter catalog
- **THEN** the launch SHALL proceed as delegated without requiring blind authorization

#### Scenario: frozen authorization admits an otherwise blind launch

- **WHEN** a UI-related run has a blind primary, no legal provider, and
  `allow_blind_visual: true` in its manifest
- **THEN** the launch SHALL proceed as blind through the existing visual-debt and release projection

#### Scenario: an unauthorized blind UI launch is blocked before the phase

- **WHEN** a UI-related run has a blind primary, no legal provider, and no frozen authorization
- **THEN** the runner SHALL emit a pre-phase BLOCKER naming both configuration and explicit blind-run
  remedies, and SHALL NOT invoke the phase

#### Scenario: dry-run reports the same decision without blocking

- **WHEN** the unauthorized blind UI condition is reached under `--dry-run`
- **THEN** the runner SHALL emit a `would_block` WARN and SHALL NOT emit the formal-phase BLOCKER

#### Scenario: canary hard failure keeps priority

- **WHEN** the primary canary records a hard CLI failure and the blind authorization is also absent
- **THEN** the existing hard-failure HALT SHALL be reported, not the blind-launch BLOCKER

#### Scenario: resume and successor have different authorization lifetimes

- **WHEN** an authorized manifest is resumed and later used to create a successor
- **THEN** the resume SHALL use the frozen authorization without a new flag, while the successor
  SHALL contain no `allow_blind_visual` key and SHALL require a new explicit authorization if blind

#### Scenario: an unavailable configured provider is still no provider

- **WHEN** personal setup reports `visualProvider.state = unavailable` for a UI-related blind run
- **THEN** launch SHALL follow the no-provider branches and SHALL require explicit blind authorization

#### Scenario: provider runtime degradation does not reopen launch authorization

- **WHEN** a legally admitted delegated run later receives an `unavailable` or `invalid` provider result
- **THEN** the existing fail-open review behavior SHALL continue the development loop without another
  launch BLOCKER

### Requirement: An unsupported visual provider selection responds by input shape and never substitutes silently

The response to a provider adapter that is absent from the catalog-derived support list SHALL depend
only on how the selection arrived:

- **Ordinary interactive use** — on the first UI-related phase, when the local configuration is
  missing a provider **or** its adapter is unsupported, the framework MAY ask once for
  `adapter` + `model`, presenting the catalog-derived support list and allowing a reselection. If the
  user skips, that explicit choice authorizes this operation to proceed `blind` and SHALL NOT be
  persisted or asked again in that round.
- **Attended goal creation** — the same condition and the same selection/reselection flow apply
  before the manifest is created. A valid selection is written to the local configuration and then
  frozen into the manifest; skipping SHALL be translated into `--allow-blind-visual` so the run-scoped
  authorization is frozen before launch.
- **Unattended** — the framework SHALL NOT ask. A stale local configuration naming an unsupported
  adapter SHALL produce a warning and SHALL be ignored. A non-UI run, or a run carrying frozen blind
  authorization, MAY continue `blind`; a UI-related blind run without authorization SHALL stop at the
  pre-phase launch BLOCKER. A missing configuration follows the same matrix.
- **Explicit CLI** — `--visual-adapter` naming an unsupported adapter SHALL fail fast, and the error
  SHALL list the catalog-derived support list. Silently ignoring an explicit user input is forbidden.

In no case SHALL the framework substitute a different provider automatically, fall back between
providers, or recommend one implicitly by selecting it.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/check-personal-setup.ts`,
`harness/scripts/init-orchestrate.ts`, `harness/scripts/utils/adapter-catalog.ts`

#### Scenario: an existing unsupported selection is re-offered once, then dropped

- **WHEN** an interactive session finds a local configuration naming an unsupported provider adapter
- **THEN** the user SHALL be prompted once with the support list and the option to skip, and a skip
  SHALL continue `blind` without a second prompt in that round

#### Scenario: unattended stale selection obeys the shared launch matrix

- **WHEN** an unattended run reads a local configuration naming an unsupported provider adapter
- **THEN** the run SHALL warn and ignore the configuration; it SHALL continue blind only for a non-UI
  requirement or with frozen authorization, and SHALL block a UI-related unauthorized blind launch

#### Scenario: no automatic substitution

- **WHEN** any of the above paths rejects a provider selection
- **THEN** the framework SHALL NOT select another adapter on the user's behalf and SHALL NOT retry the
  round against a different provider

## MODIFIED Requirements

### Requirement: Visual signals are adjudicated before candidate materialization

Perception-sourced signals SHALL be adjudicated **before** any repair candidate is materialized, preserving the existing contract that `summary.repair_candidates[]` carries only trusted, actionable defects. The pipeline runs at the goal-runner collection site as a single source of truth (the harness-runner's check-domain assembly SHALL NOT process visual signals): producer emits each signal classified **actionable** or **uncertain** → signal-level identity → parse of the testing agent's fenced `defect-review` block (per-signal confirmed/disputed with rationale) → materialization decision.

Materialization has exactly two outcomes. An **actionable signal the agent's review confirms** is materialized as a regular repair candidate (`identity_schema: 'signal@1'`) and may drive a backtrack; a `PASS` verdict with such a candidate still backtracks (the existing guarantee preserved — "trusted" means this harness-synthesized concurrence, never agent self-report alone). **Every other perception signal — actionable but disputed by the agent, actionable but unreviewed, or producer-classified uncertain — SHALL stop the run before merge**: no candidate is written, and the runner halts `repair_adjudication_pending` (operator class, WAITING(human)) presenting the producer evidence and the agent's dispute rationale (when present) verbatim for human judgment. A WARN-level annotation is not a substitute for stopping — unresolved perception signals SHALL NOT be silently downgraded past the gate. There is **no automatic refuted verdict, no adjudication-layer verification algorithm, and no new summary schema for adjudication** (evidence lives in the producer output and the defect-review block; the only `summary.json` schema addition of this change is the optional `identity_schema` field, which is backward-compatible). Mechanical detection (OCR confusion, viewport/reference compatibility, geometry) lives only in the producer — a conflict between two sources proves disagreement, not which source is wrong, so it SHALL be classified uncertain at the producer or escalated to a human, never auto-resolved. Skipping the review block gives the agent no benefit (fail-closed to the stop path).

The producer SHALL classify uncertainty at the source: an OCR reading within edit distance 1 of a known candidate string SHALL be emitted as uncertain rather than a FAIL-grade text-placement signal, and vertical-order comparisons between a full-page stitched reference and a single-viewport screenshot SHALL be downgraded to uncertain with the calibre gap noted. The uncertain production wiring and stop ordering are frozen to existing carriers and control flow: the producer SHALL emit uncertain signals in an **optional `uncertain_signals[]` list on the existing producer-owned `VisualDiffStructuredPayload`**, each entry carrying the signal's `item_fingerprint`, the uncertainty reason, and the evidence reference; the list persists through the existing `checks[].structured` field of `script-report.json` (no new file or IPC). The goal runner SHALL read it when it reads the fresh summary and the round's script-report, forming a pending flag **before any PASS-path closure work**: with a non-empty list the runner SHALL NOT run receipt validation or closure finalization for the phase, SHALL still complete the existing `visual_round` event projection and integrity handling, and SHALL then halt `repair_adjudication_pending` without entering normal verdict processing or candidate merge — stopping only before merge is insufficient, since a lone uncertain signal alongside all-PASS screens would otherwise finalize the phase closure and then stop, leaving a success state and a WAITING halt coexisting. The producer SHALL NOT write uncertainty back into `visual-diff.json`, and no new file, ledger, receipt, or state machine is introduced for this wiring.

Human recovery SHALL reuse the existing visual-confirm human-sign channel — `visual-diff.json` screen `confirmed_by` with a human signer per the `isHumanVerified` predicate — as the single authoritative source: a human `--resume` after a convergence halt is itself one explicit release (the attempted invariant is re-established after execution, so each release requires a fresh human action). No manual-driver or confirmation-receipt path is introduced by this change as a recovery input, and no new receipt family or ledger is created. Halt guidance for `repair_not_converging` and `repair_adjudication_pending` SHALL name the concrete channel entry point and resume command — a WAITING state must accept future input. The review-phase FAIL retry prompt SHALL NOT contain fix-it-yourself inducements (e.g. "apply a minimal fix"); it SHALL instruct registering candidates with review evidence for adjudicated routing.

**Provider-sourced visual defects are a separate source and SHALL NOT enter this pipeline.** This
requirement governs **perception signals produced by the mechanical producer (T8)** and is unchanged
for them. A read-only visual provider under `vision_mode: delegated` runs *after* the primary agent
and is therefore structurally always "unreviewed" — routing it through the defect-review pipeline
would halt every delegated round for a human, which is the opposite of the delegated contract. A
provider payload that passes same-invocation validation SHALL therefore be materialized directly as a
repair candidate (a trusted, actionable critic candidate — not absolute truth), without requiring a
blind primary's `defect-review` concurrence, which would be a sham check. A provider payload that
fails validation SHALL be discarded and the round SHALL continue with blind semantics. In neither
case SHALL a provider result cause `repair_adjudication_pending`, and in neither case SHALL a provider
write `confirmed_by` or otherwise substitute for the final human visual confirmation.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: the OCR misread that burned run 60bcd1 is neutralized at the source

- **WHEN** OCR reads 「中国银行」 where the known candidate list contains 「中信银行」 at edit distance 1
- **THEN** the producer emits the signal as uncertain, no candidate is materialized, and the run stops `repair_adjudication_pending` for human judgment instead of backtracking

#### Scenario: a lone uncertain signal stops the run before closure, not after

- **WHEN** every screen passes except one signal the producer classified uncertain
- **THEN** the run halts `repair_adjudication_pending` **without invoking or completing receipt validation / closure finalization for the phase** — the uncertain signal is neither silently reduced to a WARN annotation nor left coexisting with a finalized PASS closure

#### Scenario: uncertain travels the real carrier from producer to runner

- **WHEN** the visual-diff check emits an `uncertain_signals[]` entry on its structured payload during a gate-harness run
- **THEN** the goal runner reads that entry from `checks[].structured` of the round's script-report and stops before verdict processing and candidate merge — with nothing written back into `visual-diff.json`

#### Scenario: the early stop does not drop visual-round bookkeeping

- **WHEN** the round carries a visual_round receipt and the runner stops early on uncertain signals
- **THEN** the existing `visual_round` event projection and integrity handling still complete before the halt

#### Scenario: an agent dispute stops the loop for human judgment instead of auto-refuting

- **WHEN** a mechanically actionable signal is disputed by the testing agent's defect-review entry
- **THEN** no candidate is materialized, the run halts `repair_adjudication_pending` with the dispute rationale presented verbatim, and no automatic backtrack or automatic refutation occurs

#### Scenario: an unreviewed signal cannot slip into a backtrack

- **WHEN** an actionable visual signal has no matching entry in the testing agent's defect-review block
- **THEN** no candidate is materialized and the halt guidance names the existing human channel that resumes the run

#### Scenario: a delegated provider defect drives repair without stopping the run

- **WHEN** a `delegated` round's provider payload passes same-invocation validation and enumerates a defect
- **THEN** the defect SHALL be materialized as a repair candidate that drives the primary's fix, and the
  run SHALL NOT halt `repair_adjudication_pending` for lack of a primary `defect-review` entry

#### Scenario: an invalid provider payload is dropped, not adjudicated

- **WHEN** a `delegated` round's provider payload fails validation
- **THEN** the payload SHALL be discarded with an event, the round SHALL continue with blind semantics,
  and no adjudication-pending halt SHALL be raised

# harness-gates Spec Delta

## MODIFIED Requirements

### Requirement: Reference-image receipt verification uses the runner's shared discovery denominator

The `vision/spec-refs-receipt.json` production and verification SHALL use the runner's shared
reference-image discovery set (requirement text explicit images UNION in-project requirement-source
direct-parent-directory images, deduplicated and deterministically sorted, with the
`ux-reference/` fallback only when the union is empty) as the expected denominator — recomputed
from the frozen run manifest (`requirement` + `requirement_source_files`) — instead of deriving the
denominator from the agent-produced `spec.md` alone. A spec that omits any discovered image SHALL
fail verification; the spec cannot shrink the denominator. The existing soft WARN / hard FAIL
thresholds and the rejection of fabricated `verified + vl_multimodal` are unchanged.

The receipt SHALL be addressed by material rather than by invocation. It SHALL bind `goal_run_id`,
the adapter, and each image's content hash; it SHALL NOT carry a top-level invocation id, and
verification SHALL NOT require an invocation-id equality or a runner event anchor over the receipt
file's digest. Production SHALL merge across invocations of the same run: a previous `read` SHALL be
inherited only while run, adapter and the image's content hash are all unchanged, and a replaced
image SHALL invalidate its record. A Read event SHALL match a reference image only by normalized
full path — a same-basename file at a different path SHALL NOT count as read. The receipt schema is
`1.1`; the loader SHALL accept only `1.1` and SHALL treat any other version as "no receipt", because
a same-run resume leaves a `1.0` residue whose `goal_run_id` matches and only the version test can
reject it.

A round that produced no per-image audit of its own SHALL NOT sign one. Because phase log paths are
fixed per phase, an attended round would otherwise re-audit the previous detached round's event log
and combine it with the current image hashes into a receipt that looks new; receipt production SHALL
therefore require a detached executor, and an attended round SHALL emit its production event with a
skipped status and a reason and write nothing. The runtime SHALL reject an `attended` executor paired
with a `process` owner, so the gate's only reliable in-machine attended signal (run-control
`owner.kind === 'session'`) cannot be bypassed.

Carrying a previous invocation's read forward SHALL be disclosed: the production event SHALL carry
the carried-over count and the goal report SHALL render it as one note row of the kind it already
renders. No new check id, severity, WARN class or summary field SHALL be introduced for it.

Enforcement: `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-report-generator.ts`, `profiles/hmos-app/harness/spec-visual-handoff-check.ts`

#### Scenario: spec omitting one discovered source image fails verification

- **WHEN** the shared discovery set contains three images but the spec's declared references/Reads
  cover only two
- **THEN** receipt verification reports the missing image as unread/undeclared and the terminal
  gate fails

#### Scenario: a same-basename file at another path is not a read

- **WHEN** the invocation reads `tmp/1-home.png` while the authoritative image is
  `ux-reference/1-home.png` with different content
- **THEN** the authoritative image SHALL be recorded unread and SHALL NOT be signed with its own hash

#### Scenario: a replaced image invalidates the carried-over read

- **WHEN** an earlier invocation of this run read two images, one of them is then replaced, and the
  next invocation reads nothing
- **THEN** the unchanged image keeps its read and is counted as carried over, while the replaced one
  becomes unread and the sign-off is refused

#### Scenario: an attended round does not re-sign a leftover log

- **WHEN** a detached round leaves `agent-events.jsonl` on disk, a reference image is replaced, and
  the next round runs attended
- **THEN** the production event SHALL be skipped with an attended reason, and the existing receipt
  file SHALL be left byte-identical

## ADDED Requirements

### Requirement: A refused visual sign-off names which of four states applies

The sign-off verifier SHALL label every failure with exactly one of `unreachable`, `not_probed`,
`not_yet` or `mismatch`, and `ui_spec_fidelity_gate` SHALL choose its message and its way out from
the most severe label present, in that order. No new check id and no change to the existing severity
ladder SHALL be introduced.

- `unreachable` SHALL be decided **only** by execution shape and audit capability: no goal run/attempt
  identity, an attended round (run-control `owner.kind === 'session'`), or an adapter with no
  registered structured-event parser. Its way out SHALL be to record `verified: unverified` honestly,
  naming goal orchestration + detached execution + a structured-events adapter as the reachable
  combination.
- `not_probed` SHALL cover a reachable shape whose run holds no probe-produced canary — including a
  `vision.image_input_override`, an expired canary, one belonging to another run, one failing the
  model pin, and a verdict that is not a real visual read. Its way out SHALL name deleting the
  override so preflight measures once, or re-running so the canary refreshes, or recording
  `unverified`.
- `not_yet` SHALL cover a reachable, measured run whose reference-read receipt is simply absent or
  not schema `1.1`. Its way out SHALL be to hand the work back to the runner, which signs the receipt
  after the invocation ends — the in-phase harness of a normal first round always sees no receipt,
  and it SHALL NOT be told that its execution shape is unsupported.
- `mismatch` SHALL cover material disagreement: unread images, hash mismatches, an uncovered
  denominator, or a run/adapter mismatch. Its way out SHALL name reading the missing images and
  checking whether a reference image was replaced.

Enforcement: `harness/scripts/utils/critic-receipt-producer.ts`, `profiles/hmos-app/harness/spec-ui-spec-check.ts`

#### Scenario: a normal first round is told to wait, not to downgrade

- **WHEN** the in-phase harness of a reachable, measured goal round runs before the runner has signed
  this round's receipt
- **THEN** the gate SHALL report "not yet produced" and SHALL NOT state that the execution shape does
  not support `vl_multimodal`

#### Scenario: an unmeasured run is not described as measured

- **WHEN** the run holds no probe-produced canary
- **THEN** the gate SHALL report the state as not measured and its text SHALL NOT assert that visual
  capability was measured

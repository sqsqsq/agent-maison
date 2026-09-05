# feature-artifact-layout Spec Delta

## ADDED Requirements

### Requirement: The verifier report markdown is the sole machine truth, written by the invoking agent

Each phase whose verifier plan resolves to `enabled` SHALL carry its machine-consumable verdict in a **subject-partitioned** markdown file, `<reports>/verifier.report.<subject>.md`. `summary.verifier_subject_id` alone decides which file is the current machine evidence, and `summary.verifier_report` names its path.

There SHALL be exactly **one writer**: the agent that dispatched the verifier. The verifier subagent SHALL keep its read-only tool grant and SHALL keep replying with the full report ending in exactly one versioned terminal block; the dispatcher SHALL write that reply **verbatim** — not summarized, not reduced to the terminal block — to the path named by `summary.verifier_report`. The verifier SHALL NOT be granted write access, the request SHALL NOT carry a report path for the verifier to write to, and no fallback second writer SHALL exist. A fallback in which the dispatcher writes only what it happens to hold would produce a report carrying a terminal block and no findings, which the loader would accept while repair candidates, WARN items and the multimodal review text silently vanish.

The subject partition SHALL be preserved: one file per subject, so no round can move, delete or overwrite another subject's file. A file whose terminal block echoes a different subject than its own name SHALL fail closed and SHALL NOT be repaired or moved. Stale files from superseded subjects SHALL be left in place; they are outside every consumer's read surface.

Adjudication SHALL rest on exactly three facts: the file exists, the terminal block echoes `summary.verifier_subject_id`, and `verdict` agrees with `blocker_count` (`PASS` ⟺ zero). A conclusion fingerprint, a subagent identity, a stored invocation/result subject pair, and a publication state machine SHALL NOT be required. The single recovery action for any failure SHALL be to re-run the verifier and rewrite the report.

The report SHALL NOT enter the evidence manifest protection set and SHALL NOT be hashed into the review closure attestation. Editing it after closure SHALL NOT mark any phase stale: the conclusion that closure adopted is already recorded in the summary, and a report whose modification is undetectable by design must not simultaneously act as a tamper tripwire.

Enforcement: `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/utils/verifier-subject.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: The dispatcher writes the verifier's full reply

- **WHEN** a verifier subagent returns a full report ending in one terminal block
- **THEN** the dispatching agent SHALL write that reply verbatim to `summary.verifier_report`, and the loader SHALL return its full text as `report_text` for repair candidates and read-image evidence

#### Scenario: A report echoing a stale subject is not evidence

- **WHEN** a report file's terminal block echoes a subject that differs from `summary.verifier_subject_id`
- **THEN** the loader SHALL report a subject mismatch, the phase SHALL be treated as having no current evidence, and the guidance SHALL be to re-run the verifier

#### Scenario: Editing the report after closure stales nothing

- **WHEN** a closed phase's `verifier.report.<subject>.md` is modified
- **THEN** evidence manifest recomputation and the review closure attestation SHALL both remain valid, and no phase SHALL be marked stale

## MODIFIED Requirements

### Requirement: Summary schema 1.3 makes the verifier fields conditional and separates the three roles

The run summary writer SHALL emit `schema_version` `"1.3"`, in which `ai_prompt`, `verifier_subject_id`, `verifier_request` and `verifier_report` are **conditional** fields present only when the phase's verifier plan resolved to `enabled`. Their absence SHALL mean "not applicable", never "missing".

`verifier_report` SHALL be written at request issue time, as the project-root-relative path `<reports>/verifier.report.<subject>.md`. It exists so the dispatching agent never composes that path itself; the console `NEXT` line SHALL name it directly.

The three roles previously conflated in one field SHALL be separated: **generation** is carried by `schema_version`, **applicability** is recomputed on demand from the resolved verifier plan, and **identity** is carried by `verifier_subject_id`. No applicability snapshot SHALL be persisted into the summary — applicability is a judgement that can be recomputed at any time, and freezing it into a field turns it into state that drifts.

`1.2` SHALL remain readable as the previous closure generation, and `1.0` / `1.1` SHALL remain readable as legacy with unknown assurance. The assurance obligations that `1.2` introduced (`assurance`, capability resolutions and fingerprint, `closure_status`) SHALL apply unchanged to `1.3`; consumers SHALL express that as a version **set**, not as an equality against a single literal, so that a future generation does not silently drop out of every gate.

Verifier evidence adjudication SHALL NOT dispatch on `schema_version`. The generation field records the summary's own shape; using it to pick between two verifier evidence protocols made a legitimately disabled capability read as "old artifact".

Enforcement: `harness/schemas/summary.schema.json`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A disabled phase writes no verifier fields at all

- **WHEN** the resolved verifier plan for a phase is `disabled`
- **THEN** the summary SHALL carry no `ai_prompt`, no `verifier_subject_id`, no `verifier_request` and no `verifier_report`, and no prompt, request or report SHALL be produced

#### Scenario: An enabled phase names its report path up front

- **WHEN** the plan is `enabled` and the script gate passes
- **THEN** the summary SHALL carry `verifier_report` pointing at `<reports>/verifier.report.<subject>.md`, and the console `NEXT` line SHALL instruct the dispatcher to write the verifier's reply to exactly that path

#### Scenario: The current generation is accepted by every assurance consumer

- **WHEN** a `1.3` summary reaches quality-axes validation, the upstream verdict gate, feature completion verification, assessment, or the UT attestation-first probe
- **THEN** it SHALL be treated as the current generation and SHALL NOT be classified as legacy

#### Scenario: Closure does not downgrade the generation

- **WHEN** the closure finalizer patches an open `1.3` summary to `closed`
- **THEN** the written summary SHALL still declare `1.3`

## REMOVED Requirements

### Requirement: verifier.report.json is the sole machine truth; the markdown is a human projection
**Reason**: The canonical JSON existed to carry hook-established binding fields — subagent identity, separately stored invocation/result subjects, and a conclusion fingerprint. All three served tamper resistance, which is not a priority, while the publication path that produced them made unattended closure unreachable and left every hookless adapter blocked.

**Migration**: The markdown written by the dispatching agent becomes the machine truth; delete `verifierReportJsonFilename` and `computeVerifierResultSha256`, and read the terminal block through `parseResultBlock`. Existing `verifier.report.<subject>.json` files are simply no longer read; closed phases are unaffected, and a phase re-validated without a markdown report is reviewed once more.

# feature-artifact-layout Spec Delta

## ADDED Requirements

### Requirement: verifier.report.json is the sole machine truth; the markdown is a human projection

Each phase that runs a verifier subagent SHALL carry its machine-consumable verdict in a **subject-partitioned** file, `<reports>/verifier.report.<subject>.json` (`schema_version` `"2.0"`), published by the SubagentStop hook only after identity binding succeeds. `summary.verifier_subject_id` alone decides which file is the current machine evidence.

The partition is not a naming convention — it is what makes cross-subject interference structurally impossible. A single fixed filename makes every round compete for one mutable file, and any "am I still authorized?" check is separated from the mutation by a gap in which the subject can rotate; moving that check later only moves the window. With one file per subject, no round can move, delete or overwrite another subject's file, and the question never arises. A file that self-declares a different subject than its own name SHALL fail closed; it SHALL NOT be moved or repaired. Stale files from superseded subjects SHALL be left in place — they are outside every consumer's read surface, and automatic cleanup would reintroduce concurrent deletion. The document SHALL record the subagent identity (`agent_id`, `agent_type`), **two separately stored subjects** (`invocation_subject` and `result_subject`), a strictly parsed `verdict` (`PASS`/`FAIL`), `blocker_count`, a `result_sha256` conclusion fingerprint, the full `report_text`, and audit-only metadata (`agent_transcript_path`, `session_id`) that participates in no adjudication.

`<reports>/verifier.report.<subject>.md` SHALL be a human-readable projection regenerated from that JSON. Inside the subject/JSON closure domain no machine consumer may parse it: not the receipt gate, not repair-candidate derivation, not the multimodal read-image evidence gate, not the goal phase snapshot. Every one of them SHALL read the identity-verified JSON through the shared `loadVerifierEvidence()` boundary and SHALL NOT fall back to the markdown when verification fails — a verification failure is the "no evidence" path, not a licence to read an unverified artifact.

Consequently the markdown SHALL NOT enter the **new** evidence manifest protection set, and editing it SHALL change no machine conclusion. A closure that was published before this change keeps its **own** manifest registration: the recorded `verifier.report.md` bytes still participate in hash reconciliation there, so editing the markdown of a grandfathered closure still marks it stale. That is byte protection under the old registration surface, not semantic parsing, and it is the only remaining place where the markdown affects a machine outcome.

Enforcement: `agents/claude/templates/hooks/record-verifier-report.mjs`, `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/goal-phase-snapshot.ts`

#### Scenario: Editing the markdown changes nothing in the new closure domain

- **WHEN** a phase holds an identity-verified `verifier.report.json` and someone rewrites `verifier.report.md` to claim the opposite verdict
- **THEN** the loader, the repair-candidate and read-image evidence text sources, the goal snapshot machine fields, and the check-receipt verdict SHALL all be byte-identical to before the edit

#### Scenario: Editing the markdown of a grandfathered closure still stales it

- **WHEN** an older closure whose manifest registered `verifier.report.md` has that file modified
- **THEN** manifest recomputation SHALL report the phase stale under its own registration surface

#### Scenario: An unverifiable JSON does not fall back to the markdown

- **WHEN** `verifier.report.json` is missing, unparseable, in conflict state, or fails the in-repository three-value subject comparison
- **THEN** every machine consumer SHALL behave as if no verifier evidence exists and SHALL NOT read `verifier.report.md` instead

### Requirement: The verifier report is bound to a runner-issued subject that survives closure

`harness-runner` SHALL be the single producer of `verifier_subject_id` and SHALL write it into the phase `summary.json` and into a versioned machine block appended to `ai-prompt.md`. The subject SHALL be derived from feature, phase, a canonical projection of the script report's gate facts, a canonical digest of the prompt's semantic content, the gate fingerprint, and worktree/source identity.

The derivation SHALL NOT include a hash of the whole `summary.json`: the base summary is published with `closure_status: "open"` and rewritten to `closed` by the closure finalizer, so a whole-file hash would rotate the subject at the very moment a phase closes and invalidate the verifier evidence that was just accepted. The closure finalizer's summary patch SHALL preserve the subject unchanged.

Neither hashed artifact SHALL be hashed **as formatted text**. Both carry runner telemetry — the script report embeds a wall-clock `timestamp`, an absolute `project_root`, and per-check free text containing elapsed times; the prompt embeds a substituted timestamp and the whole script report. Telemetry SHALL therefore be excluded **before formatting**, from the structured facts:

- the script report contributes a canonical projection that is **exclusion-based at every level** — the whole document's top-level fields (present and future) and each check's fields (present and future) are included by default, and exactly one **explicit telemetry domain** is excluded: the top-level `timestamp` and `project_root`, plus the volatile substrings inside per-check free text;
- the prompt contributes a canonical digest produced by the **same assembly pass** that writes the file, with exactly two placeholders substituted for the volatile regions (the timestamp and the embedded script report).

A field whitelist SHALL NOT be used at **either** level. A whitelist's failure mode is silent: it omits every field it has not heard of. The check-level whitelist omitted `failure_kind`, `actionability`, `affected_files`, `source` and `structured`; the top-level whitelist then omitted `capability_resolutions`, `compat_applied` and `compat_expired`. In both cases `ai-prompt.md` could change materially while the subject stayed put and a previous verifier `PASS` was reused. Exclusion-based projection is required precisely so that fields added later bind by default, with no one having to remember to extend a list.

Because the prompt digest replaces the embedded script report with a placeholder, the script-report projection carries the **entire** binding responsibility for gate facts; it cannot delegate any of it back to the prompt.

Volatile substrings inside free text SHALL be separated **at the producer**, not guessed at the consumer: a check whose `details` embeds an elapsed time, a wall clock, a temporary path or a process id SHALL emit both the human-readable `details` and a `details_material` projection rendered from the same template with the volatile position replaced by a fixed placeholder, and the canonical projection SHALL prefer `details_material` when present. A producer that omits this does not fail closed — it makes its phase's subject rotate on every run, which re-locks the "re-run the harness to close" path; that cost is the reason the discipline sits with the producer.

Post-hoc regex normalization of the final free text SHALL NOT be used: it is wrong in both directions — it does not match non-ISO telemetry such as an elapsed-time string, so a no-op re-run still rotates the subject and self-locks the "re-run the harness to close" path; and it erases genuine ISO datetimes in business content, so a real requirement change fails to rotate the subject and the previous verifier verdict is silently reused.

The canonical location of every artifact named here SHALL be resolved through the single reports-directory resolver that honours `paths.reports_dir_pattern`. No consumer — including the pure-JavaScript hook, the evidence manifest, and the closure attestation — may hand-assemble an equivalent path, because a second path opinion means evidence is published under one directory and verified under another.

`ai-prompt.md` SHALL be the only machine production entry point for the subject. Callers SHALL deliver that file **verbatim** as the Task prompt for `subagent_type=verifier`; transcribing the prompt template by hand, excerpting it, or rewriting the machine block SHALL cause identity binding to fail closed rather than to degrade silently.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/verifier-subject.ts`, `harness/scripts/utils/check-telemetry.ts`, `harness/scripts/utils/report-generator.ts`, `harness/prompts/verify-*.md`, `harness/schemas/summary.schema.json`

#### Scenario: A normal open-to-closed closure keeps the subject valid

- **WHEN** a phase publishes verifier evidence while its summary is `open`, and the closure finalizer then patches the summary to `closed` with a `closure_commit`
- **THEN** `summary.verifier_subject_id` SHALL be unchanged and the evidence SHALL still verify

#### Scenario: Re-running the harness with no material change does not rotate the subject

- **WHEN** the harness is re-run for a phase whose gate facts, prompt content, gate fingerprint and source identity are unchanged, even though the run took a different amount of time and stamped a different wall clock
- **THEN** the derived subject SHALL be identical and the already published verifier evidence SHALL remain valid

#### Scenario: A top-level script-report field that the code has never heard of still rotates the subject

- **WHEN** the script report gains or changes a top-level field outside the telemetry domain — `capability_resolutions`, `compat_applied`, `compat_expired`, or a field introduced after this change
- **THEN** the subject SHALL rotate, because that content reaches the verifier through `ai-prompt.md`

#### Scenario: A changed failure attribution rotates the subject even when the status does not change

- **WHEN** a check keeps the same `status` but its `failure_kind`, `actionability`, `affected_files`, `source`, `structured` payload or semantic `details` prose changes
- **THEN** the subject SHALL rotate, because the verifier's own input changed

#### Scenario: A business datetime in the reviewed content does rotate the subject

- **WHEN** an acceptance criterion's deadline datetime changes and the harness is re-run
- **THEN** the subject SHALL rotate, so the previous verifier verdict cannot be reused for the changed requirement

#### Scenario: A new harness run over changed inputs rotates the subject

- **WHEN** the prompt content or gate facts change and the harness is re-run
- **THEN** the subject SHALL rotate and the previous verifier evidence SHALL no longer verify, requiring a fresh verifier run

## MODIFIED Requirements

### Requirement: Phase completion receipt template (slim, schema 2.0)

phase-completion-receipt.md 模板 MUST 以 frontmatter `receipt_schema: "2.0"` 标识新格式；字段集 MUST 为：feature/phase、agent_model/agent_runtime、claimed_completion_at、claimed_completion_commit_sha、verifier_subagent（invoked_via + verdict 摘录）、反假设三 checkbox、testing_run_artifacts（仅 testing）、evidence_manifest 指针（机器回写）。缺 `receipt_schema` 键的存量回执 MUST 按旧格式（1.x）全量校验规则处理。

`verifier_subagent` 块（`invoked_via` / `report_path` / `verdict` / `ran_at`）MUST 被视为**兼容投影**，不再构成裁决权威：verifier 的机器事实一律取自身份验真后的 `verifier.report.json`。手填 `verdict: "PASS"` MUST NOT 使一份未通过身份验真的报告闭环。该块 MUST 至少保留一个 minor 窗口，防止存量回执解析断裂。

投影字段中**只有 `verdict` 有机器对应物**，故只对它做一致性提示：手填 verdict 与机器真源不符时 MUST 记 MAJOR 而**非** BLOCKER，且 MUST NOT 影响 pass/fail。其余三个字段（`invoked_via` / `report_path` / `ran_at`）MUST 仅作留档，**不做任何校验**——为完全无裁决权威的字段再造一套无权威校验只会制造噪声，并让人误以为它们仍参与判定。

#### Scenario: 双格式共存
- **WHEN** 实例中同时存在旧格式回执（无 receipt_schema）与新模板产出的 2.0 回执
- **THEN** check-receipt 按各自格式分派校验，旧格式行为零变化

#### Scenario: 手填 verifier 字段不再构成通过条件
- **WHEN** 回执自称 `verifier_subagent.verdict: "PASS"` 且 `report_path` 指向一份手写的 Markdown，但该阶段没有身份验真通过的 `verifier.report.json`
- **THEN** check-receipt MUST BLOCKER FAIL，失败归因指向机器真源缺失而非文书填写

> **Enforced by:** `harness/templates/phase-completion-receipt.md`, `harness/scripts/check-receipt.ts`

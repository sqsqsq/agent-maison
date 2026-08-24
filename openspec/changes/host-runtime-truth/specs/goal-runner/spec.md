# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Windows headless binary resolution honors PATH/Spawnability truth per candidate name

On Windows, headless binary resolution SHALL iterate adapter candidate names in their existing
declared order, and within each name SHALL select the first candidate in `where.exe` output order
(or PATH-directory order as fallback) that is an explicitly supported and spawnable Windows
executable form — never preferring `.exe` across directories over an earlier `.cmd/.bat`, and never
accepting an extensionless POSIX (`#!/bin/sh`) or ELF shim merely because the file exists. Supported
forms SHALL be `.exe`, `.cmd/.bat` (spawned through the existing cross-spawn/containment path), and
extensionless files whose header is a native PE image (`MZ`). The resolution result SHALL carry
diagnostic shadowed-candidate info (found-but-skipped or lower-priority entries, bounded) for the
`adapter_probe` event; no CLI registry, lockfile, or version pin table SHALL be introduced.

Enforcement: `harness/scripts/utils/headless-binary-resolve.ts`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: npm codex.cmd precedes WindowsApps codex.exe in PATH order

- **WHEN** `where.exe codex` returns the npm shim (`codex.cmd`) before the WindowsApps `codex.exe`
  and the npm shim is a supported `.cmd` form
- **THEN** the resolver SHALL select the npm `codex.cmd` and SHALL NOT skip it to pick the later
  `.exe`

#### Scenario: extensionless POSIX/ELF shims are not spawnable Windows runtimes

- **WHEN** a `where.exe` hit has no extension and its file header is `#!/bin/sh` or ELF magic
- **THEN** the resolver SHALL skip it (recording it as shadowed) and continue to the next candidate
  in order; an extensionless hit with native PE header remains selectable as `bare`

### Requirement: Probe, canary and formal invoke reuse one session-resolved binary identity

The goal run SHALL resolve the headless binary once for the execution session at preflight, and
SHALL reuse that resolved absolute path for the adapter version probe, the vision canary probe, and
every formal phase invoke (`resolveHeadlessInvokePlan` built-in adapter plans SHALL use the
session-resolved binary as `argv[0]`; custom `headless_invoke` templates are not injected).
`adapter_probe` SHALL include the resolved binary path and shadowed-candidate diagnostics. Resume
re-resolves in the new process. No cross-process registry or lockfile is introduced.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: adapter version probe runs the same absolute binary as the formal invoke

- **WHEN** preflight resolves `C:\...\npm\codex.cmd` for the session
- **THEN** `probeAdapterVersion` runs that absolute `.cmd` path (via cross-spawn), the canary probe
  uses the same path, and the formal phase plan's `argv[0]` is the same absolute path

### Requirement: Formal phase invoke hard CLI/guardian failures halt before harness with zero content retry

After a formal phase agent invoke, a structural hard failure SHALL be classified by a shared pure
function that covers (a) a structured `spawn_error` fact — including child spawn races, resolved
binary short-circuits, and guardian containment establishment failures projected at the
agent-invoke boundary as `[maison-guardian]` + stable ASCII operation marker
(`CreateProcess(` / `AssignProcessToJobObject` / `ResumeThread`) with exit code 2 and never by
localized text or exit code 2 alone — and (b) CLI/config argument incompatibility, and (c) the
recovered Codex structured error envelope `status:400 + invalid_request_error + requires a newer
version of Codex`. On a hit, the runner SHALL emit `phase_halt(adapter_cli_hard_failure)` before
spawning any gate harness, register the incident as external, and SHALL NOT consume a content
retry and SHALL NOT attribute `spec_file_exists`. Ordinary agent content failures (including exit 2
without guardian diagnostics) SHALL keep the existing harness/retry semantics.

Enforcement: `harness/scripts/utils/vision-canary.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: Codex 0.138 model-compatibility 400 stops after one formal invoke

- **WHEN** the formal phase invoke returns the Codex structured 400 envelope for a newer-required
  model
- **THEN** exactly one formal invoke is recorded (`agent_invoke_start` count 1), no harness is
  spawned, no content retry is consumed, and the phase halts with `adapter_cli_hard_failure`

#### Scenario: guardian CreateProcess error 5 stops before harness

- **WHEN** the guardian exits 2 with `[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5 ...`
- **THEN** the invoke result carries the projected `spawn_error`
  (`maison_guardian_containment_failed`), the phase halts with `adapter_cli_hard_failure`,
  `agent_process_started` remains 0, no harness runs, and no content retry is consumed

## MODIFIED Requirements

### Requirement: Inline canary signing consumes the shared canary decision SSOT on this invoke's stdout boundary

The spec-phase inline canary signing point SHALL use `resolveCanaryCacheDecision`/`parseCanaryAnswer`
exclusively (the `isCanaryAnswerComplete + classifyCanaryResponse(raw)` fork SHALL be removed).
Structured adapters SHALL adjudicate from the pure `agent-events.jsonl` final-result projection;
non-structured adapters SHALL consume only this invocation's `stdout` plus
`exitCode/timed_out/silent_killed/skipped` facts — never stderr, prompt echo, or the human-readable
mixed `agent-output.log`. A valid tail answer may sign the capability receipt; a standalone
`CANNOT_SEE_IMAGE`, pure echo, or failed invoke SHALL NOT sign. Capability and auditability remain
separate axes: adapters with `tool_event_provenance=none` (e.g. Codex) SHALL NOT sign per-image refs
receipts or `vl_multimodal` even with a `tool_read` canary — they keep working with images but must
record `verified: unverified`; structured adapters require per-image Read of this invoke for final
signing. Prompt, closure-only read blocks, retry guidance, and the spec skill SHALL state the
provenance-reachable exit for each adapter class; existing soft WARN / hard FAIL thresholds and the
rejection of fabricated `verified + vl_multimodal` are unchanged.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/vision-canary.ts`, `skills/feature/spec/SKILL.md`

#### Scenario: prompt echo with placeholder keys plus a correct tail answer signs the capability receipt

- **WHEN** the invoke stdout contains the canary prompt echo (placeholder keys, `CANNOT_SEE_IMAGE`)
  followed by a complete correct answer
- **THEN** the last-legal-assignment parser yields the canonical answer, `tool_read` is classified,
  and the capability receipt is issued

#### Scenario: pure echo or standalone blind declaration does not sign

- **WHEN** the invoke stdout contains only the echoed prompt keys (placeholders) or only an
  independent `CANNOT_SEE_IMAGE` line
- **THEN** no capability receipt is issued, and the run continues on the blind workflow

### Requirement: Requirement source provenance persists and drives a single shared reference-image denominator

The `--requirement-file` shared resolver SHALL return the frozen text plus an optional
`requirement_source_files[]` list (project-root-relative for in-project files; out-of-project
sources are text-only and never scanned). A fresh goal manifest SHALL persist the list and include
it in the identity hash when present; resume reads only frozen values; successors inherit and
dedupe-append on explicit file increments. goal-mode entry and fidelity-intent-init SHALL consume
the same result, and the fidelity-intent SSOT SHALL keep the same list as an optional field (no
second image manifest). Reference-image discovery SHALL be a single bounded set: explicit project
image paths in the requirement text UNION a one-level scan of supported images in each in-project
source's direct parent directory, deduplicated by canonical path and deterministically sorted,
falling back to `feature/ux-reference/` only when the union is empty. Inline requirements trigger
no sibling scan; out-of-project sources are never scanned. That same discovery result SHALL be the
expected denominator for the capability `derive.visual-reference` dependency, the spec OCR
pre-scan, the phase prompt's authoritative image paths, and the reference mapping gate /
`vision/spec-refs-receipt.json` production and verification — a spec that omits any discovered
image SHALL fail; the spec SHALL NOT shrink the denominator itself.

Enforcement: `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/critic-receipt-producer.ts`

#### Scenario: three source-directory images flow through capability/OCR/prompt/receipt and a missing spec entry fails

- **WHEN** a fresh run uses `--requirement-file` whose directory holds three supported images and
  no explicit text path
- **THEN** the three images form the shared discovery set used by OCR pre-scan, the phase prompt's
  authoritative paths, `derive.visual-reference` dependencies, receipt production and verification;
  if the agent's spec omits one of them, verification SHALL fail
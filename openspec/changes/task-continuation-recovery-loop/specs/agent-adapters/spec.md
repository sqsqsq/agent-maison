## MODIFIED Requirements

### Requirement: Terminal event parsing is adapter-scoped and consumes stdout directly

Terminal event parsing SHALL be enabled only for adapters with a verified terminal contract, resolved
from the adapter identity of the invocation plan. The parser SHALL consume the raw stdout chunk
stream with cross-chunk line buffering and SHALL NOT require the three-file structured-event split
(that split belongs to the tool-evidence contract and is unrelated). The parser SHALL accept only
structured JSON lines: unparseable lines SHALL be skipped with no text-regex fallback, and events
nested inside turn items (including item-level error items and item error fields) SHALL NOT be
treated as turn terminal states.

Terminal event shapes SHALL be pinned by fixtures captured from real CLI runs; hand-written shapes
SHALL NOT be used as the contract baseline.

A status-code variant of a real failure envelope — the real fixture byte-for-byte with only the `status` value replaced — MAY be used to test a status-code branch that has no real sample. Such fixtures SHALL be labeled synthetic in the test name, SHALL NOT be used as the contract baseline, and a real envelope whose shape differs SHALL fall back to the existing path rather than be matched by a guessed shape. Adapters without any real failure-envelope sample (currently cursor and opencode) SHALL NOT receive a guessed envelope.

Enforcement: `harness/scripts/utils/codex-terminal-events.ts`,
`harness/tests/unit/fixtures/codex-terminal-*.jsonl`

#### Scenario: half-line chunk boundaries

- **WHEN** the terminal event stream is delivered in arbitrary chunk sizes that split JSON lines
- **THEN** the parser SHALL reach the same conclusion as it would for whole-line delivery, and SHALL
  fire each terminal observation at most once

#### Scenario: item-level errors inside a turn that completes

- **WHEN** a turn contains item-level error records and then emits its `completed` terminal event
- **THEN** the parser SHALL report completion and SHALL NOT report a terminal failure

#### Scenario: Synthetic status variants stay labeled

- **WHEN** the 429, 5xx, 401, and 403 branches are tested without real samples
- **THEN** each fixture SHALL be the real 400 envelope with only the status replaced and SHALL be named as synthetic, separately from the real samples

## ADDED Requirements

### Requirement: Codex terminal-failure status codes separate transient from hard failures

For Codex, the status code SHALL be read only from the `turn.failed` segment of the invoke's terminal error excerpt; a top-level `error` segment SHALL NOT supply it and SHALL NOT override it. Only a terminal failure SHALL count: an error that is followed by a successful completion in the same turn SHALL NOT count. Status 429 and 5xx SHALL be recognized by the API-disconnect sentinel as transient and retried with backoff; status 401 and 403 SHALL be a hard CLI failure (external) for both the canary probe and the formal invoke; status 400 SHALL keep its existing recognition. "Model unsupported" SHALL be recognized only from the recovered 400 envelope with its recorded phrasings, shared by the hard-failure resolver and the substitution check. Adapters without a model replay flag (chrys, generic) SHALL NOT substitute models. Adapters without a real envelope sample SHALL keep returning no transient recognition.

Enforcement: `harness/scripts/utils/goal-headless-sentinel.ts`, `harness/scripts/utils/vision-canary.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: A terminal 429 is retried as transient

- **WHEN** a Codex spec invoke ends with a `turn.failed` segment carrying status 429
- **THEN** the phase verdict SHALL be attributed `transient_api_error`, a transient retry SHALL be scheduled, and the phase SHALL be invoked once more

#### Scenario: An error followed by completion is not a failure

- **WHEN** a Codex turn emits an error with status 429 and then completes successfully
- **THEN** neither the sentinel nor the hard-failure resolver SHALL treat the invoke as failed

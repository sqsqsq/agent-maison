# agent-adapters Spec Delta

## ADDED Requirements

### Requirement: Codex declares streaming delivery and stdout-JSON usage capture

The Codex adapter SHALL declare `goal_capability.output_delivery: streaming` and
`goal_capability.usage_capture: stdout_json`, matching the observed behavior of `codex exec --json`
(events arrive on stdout as JSONL as they occur; the terminal `turn.completed` event carries the
turn's usage object, which the existing stdout-JSON usage parser reads without adding a capture
enum). The adapter SHALL keep `tool_event_provenance` at its default `none`.

The `--json` flag SHALL be appended by the adapter's own argv builder, independently of any
tool-evidence capability field, and SHALL be placed so that the previously verified flag order
(top-level approval flag before `exec`; `exec [--model <v>] --sandbox <mode>`) is unchanged. The
declarative `headless_invoke` template remains capability-validation only; the runtime argv builder
is the single source of truth.

Enforcement: `agents/codex/adapter.yaml`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: terminal flag is independent of tool-evidence declaration

- **WHEN** the adapter plan is built with any `tool_event_provenance` value
- **THEN** the resulting argv SHALL be byte-identical and SHALL contain the terminal-event flag,
  and SHALL NOT contain the Claude-family structured-output flags

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

Enforcement: `harness/scripts/utils/codex-terminal-events.ts`,
`harness/tests/unit/fixtures/codex-terminal-*.jsonl`

#### Scenario: half-line chunk boundaries

- **WHEN** the terminal event stream is delivered in arbitrary chunk sizes that split JSON lines
- **THEN** the parser SHALL reach the same conclusion as it would for whole-line delivery, and SHALL
  fire each terminal observation at most once

#### Scenario: item-level errors inside a turn that completes

- **WHEN** a turn contains item-level error records and then emits its `completed` terminal event
- **THEN** the parser SHALL report completion and SHALL NOT report a terminal failure

### Requirement: Structured stdout envelopes are projected before canary grading

Canary grading SHALL project a structured stdout envelope back to the agent's message text before
applying line-anchored answer parsing, whenever the adapter's headless stdout is an envelope rather
than plain text.
Grading raw envelope bytes with line anchors yields a guaranteed miss and would misreport an adapter
that actually answered as one that did not answer. The projection dialect SHALL be resolved from the
adapter identity and its argv-injection conditions, and SHALL return no text when the envelope lacks
a successful terminal state — in which case the run SHALL decline to grade rather than guess.

Enforcement: `harness/scripts/utils/vision-canary.ts`, `harness/scripts/utils/codex-terminal-events.ts`,
`harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: adapter answers the canary inside a JSONL envelope

- **WHEN** the adapter's stdout is JSONL and its agent message contains the canonical answer lines
- **THEN** grading SHALL project the message text first and SHALL resolve the answer normally

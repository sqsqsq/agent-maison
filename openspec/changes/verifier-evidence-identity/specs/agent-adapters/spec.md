# agent-adapters Spec Delta

## ADDED Requirements

### Requirement: The SubagentStop verifier hook consumes subagent identity and fails closed on any missing field

The shared SubagentStop hook SHALL determine report ownership **only** from the invoking Task prompt and the subagent's own final message. It SHALL NOT read the shared phase state file to infer feature/phase, SHALL NOT parse the main-session transcript, and SHALL NOT write back to the phase state file at all — the retired `last_verifier_report` / `last_seen_*` write-back MUST NOT be reintroduced, because Stop-hook freshness is derived from `session_id` + `updated_at` only.

The hook SHALL consume these payload fields: `agent_id` (subagent identity), `agent_transcript_path` (the subagent's own transcript), `last_assistant_message` (the subagent's final answer), and `agent_type` for provenance. `agent_type` MAY be an empty string and SHALL be recorded honestly without being a fail-closed condition on its own — not because the matcher firing proves the subagent type (it does not on every adapter; see the matcher note below) but because `agent_type` participates in no part of the binding. Ownership is decided entirely by the invocation machine block, which a non-verifier subagent does not carry. `transcript_path` denotes the main session and SHALL NOT be consulted for either identity or verdict.

Adapters MAY fire the hook for subagents other than the verifier — the SubagentStop matcher is not honoured identically across adapters. That over-firing SHALL be harmless by construction: a subagent whose transcript's first user prompt carries no machine block SHALL fail closed to the bedside record and SHALL never publish canonical evidence. Registration SHALL NOT be relied upon as a filter.

Binding SHALL be a three-way equality established **once, at publication time**: the invocation subject taken from the first user prompt of `agent_transcript_path`, the result subject taken from the single versioned terminal block inside `last_assistant_message`, and the current `summary.verifier_subject_id`. The published JSON SHALL store the invocation and result subjects as **separate fields** so that all later verification compares only in-repository values; no consumer SHALL reopen any transcript afterwards, and `agent_transcript_path` SHALL be retained as audit metadata only. Any missing field, unreadable transcript, absent or duplicated machine block, unparseable terminal block, subject mismatch, or rotated subject SHALL land the report in a non-authoritative bedside file with a machine-readable `reason` and SHALL leave the canonical evidence untouched.

Enforcement: `agents/claude/templates/hooks/record-verifier-report.mjs`, `agents/claude/templates/settings.json`, `agents/codeagent/templates/settings.json`

#### Scenario: A stale phase state file cannot misroute a report

- **WHEN** the shared phase state file points at one phase while a verifier subagent for a different phase finishes
- **THEN** the report SHALL be written under the phase named in the invocation machine block, and no file SHALL be written under the phase named by the state file

#### Scenario: The main session claiming PASS cannot override a subagent FAIL

- **WHEN** the main session transcript contains `verdict: PASS` while the subagent's terminal block reports `FAIL`
- **THEN** the published verdict SHALL be `FAIL`

#### Scenario: A missing subagent identity field fails closed without touching shared state

- **WHEN** the payload lacks `agent_id`, `agent_transcript_path`, or `last_assistant_message`, or the final message carries no single parseable terminal block
- **THEN** the hook SHALL exit 0, publish nothing canonical, write a bedside record naming the reason, and leave the phase state file byte-identical

### Requirement: Adapter verifier-closure support is declared only from an observed payload

An adapter MAY be declared as supporting verifier closure through the shared SubagentStop hook only when its **actual** payload has been observed to carry the consumed identity fields. Documentation-derived or kernel-derived assumptions SHALL NOT substitute for an observation.

The Claude adapter is observed and supported: the shipping Claude Code 2.1.246 binary declares `SubagentStop` as the session base (`session_id`, `transcript_path`, `cwd`, `prompt_id?`, `permission_mode?`) plus `stop_hook_active`, `agent_id`, `agent_transcript_path`, `agent_type`, and optional `last_assistant_message`, and its emitter sets `agent_transcript_path` from the subagent id while `transcript_path` stays the main session.

The codeagent adapter is observed and supported (host capture, 2026-08-29). Its SubagentStop payload carries every consumed field with the same semantics — `transcript_path` is the main session, `agent_transcript_path` is the subagent and resolves to a real file, and the subagent transcript's first user prompt reproduces the delivered Task prompt verbatim. It additionally carries `is_kia_repo` and `process_id`, which this hook does not consume, and omits `prompt_id`, which is optional on the Claude side as well. Unknown extra fields SHALL be ignored rather than treated as a contract violation.

One observed divergence: codeagent does **not** filter the SubagentStop matcher by agent type — every registered entry fires, including a `matcher: "verifier"` entry for a subagent whose `agent_type` is the empty string. Per the over-firing rule above this changes no outcome, but no adapter's registration may be treated as an identity filter.

An adapter whose payload lacks the consumed fields would be permanently bedside, which is not a completed degradation path — it means that adapter cannot close a phase. Such a state SHALL be recorded explicitly rather than shipped silently.

Enforcement: `agents/codeagent/adapter.yaml`, `agents/README.md`, `agents/claude/templates/hooks/record-verifier-report.mjs`

#### Scenario: A kernel-derived adapter with the full field set binds normally

- **WHEN** an adapter that shares the hook delivers a payload carrying `agent_id`, `agent_transcript_path` and `last_assistant_message`, and the three subjects agree
- **THEN** the hook SHALL publish canonical evidence exactly as for the observed adapter

#### Scenario: An over-firing matcher cannot publish evidence for a non-verifier subagent

- **WHEN** an adapter fires the verifier-registered SubagentStop hook for an unrelated subagent whose transcript carries no machine block
- **THEN** the hook SHALL write only a bedside record and SHALL leave any canonical evidence untouched

#### Scenario: An unobserved adapter is not declared as supported

- **WHEN** an adapter's SubagentStop payload has not been captured
- **THEN** the adapter documentation SHALL record the binding as suspended and SHALL NOT assert verifier-closure support

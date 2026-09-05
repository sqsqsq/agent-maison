# agent-adapters Spec Delta

## ADDED Requirements

### Requirement: An adapter declares whether it can run a verifier subagent

The adapter-side verifier declaration SHALL be a single boolean `verifier_subagent` in `agents/<adapter>/adapter.yaml`, meaning "a host run has been observed to dispatch a verifier subagent with this tool" — nothing about runtime mode, transport, or publication mechanism. A missing field SHALL mean `false`.

Nothing else about the verifier is adapter-specific. The shared rule bundle instructs every adapter to dispatch `subagent_type: verifier` with the request JSON delivered verbatim, and the terminal-block contract lives in `harness/prompts/verify-*.md`, rendered into `ai-prompt.md` for whoever reads it. The only remaining question is whether the tool can run a subagent at all.

`true` SHALL NOT be pre-registered on the strength of a materialized rule file. A shared rule being written to disk does not prove the tool loads it: the opencode adapter documents that `.opencode/rules/*` is never auto-loaded, chrys treats its rules as reference-reachable only, and generic is an arbitrary external CLI. Registering those as capable would send every phase into "report missing → re-run → still missing", which is the failure shape this change exists to remove.

Capability SHALL NOT be re-derived from an adapter-name allowlist in TypeScript, from kernel family, from the presence of a subagents template directory, or from a hooks directory.

Enforcement: `agents/adapter-schema.yaml`, `agents/claude/adapter.yaml`, `agents/codeagent/adapter.yaml`, `agents/codex/adapter.yaml`, `harness/scripts/utils/adapter-catalog.ts`, `harness/scripts/utils/verifier-plan.ts`

#### Scenario: An adapter with an observed subagent channel is capable in every mode

- **WHEN** an adapter declares `verifier_subagent: true` and a `full` phase resolves the evidence policy to `required`
- **THEN** the plan SHALL be `enabled` in `interactive`, `headless` and `goal` alike, and the same request/report protocol SHALL apply in all three

#### Scenario: An undeclared adapter discloses rather than blocks

- **WHEN** the active adapter carries no `verifier_subagent`, or declares it `false`
- **THEN** the plan SHALL be `disabled` with reason `adapter_has_no_reviewer`, no request SHALL be issued, and the closure gate SHALL pass while disclosing `not_reviewed`

#### Scenario: A materialized rule file is not a capability claim

- **WHEN** an adapter receives the shared rule bundle that describes verifier dispatch but has no observed subagent run
- **THEN** capability resolution SHALL still return `false`, and no heuristic over template directories or rule files SHALL override the declaration

## REMOVED Requirements

### Requirement: An adapter declares verifier capability, and an undeclared adapter has none
**Reason**: `transport` / `publisher` / `modes` described a publication mechanism that no longer exists. With the report written by the invoking agent, publication is mode-agnostic and mechanism-free; the only remaining adapter fact is whether a verifier subagent can be dispatched at all.

**Migration**: Replace `verifier_capability` with the boolean `verifier_subagent` in every `agents/<adapter>/adapter.yaml`; delete `parseVerifierCapabilityDeclaration` / `loadVerifierCapabilityDeclaration` / `resolveVerifierCapability` and the `VERIFIER_CAPABILITY_*` constant sets.

### Requirement: The SubagentStop verifier hook consumes subagent identity and fails closed on any missing field
**Reason**: The hook is deleted. Binding a conclusion to a subagent identity answers "was it the same subagent that wrote this", which contributes nothing to whether the conclusion is correct — while its fail-closed path turned a completed review into "no review exists" and burned two unattended runs.

**Migration**: Delete `agents/claude/templates/hooks/record-verifier-report.mjs` and the `SubagentStop` registration from both `settings.json` templates; the invoking agent writes the verifier's reply to `summary.verifier_report`.

### Requirement: Adapter verifier-closure support is declared only from an observed payload
**Reason**: Payload capture was a precondition for hook-based publication. With no hook, there is no payload to capture and no per-adapter binding to certify.

**Migration**: Replace the observed-payload registry with the single `verifier_subagent` boolean, whose evidence is an observed host run rather than a captured payload shape.

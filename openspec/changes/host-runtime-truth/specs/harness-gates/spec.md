# Harness Gates Spec Delta

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

Enforcement: `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`, `profiles/hmos-app/harness/spec-visual-handoff-check.ts`

#### Scenario: spec omitting one discovered source image fails verification

- **WHEN** the shared discovery set contains three images but the spec's declared references/Reads
  cover only two
- **THEN** receipt verification reports the missing image as unread/undeclared and the terminal
  gate fails
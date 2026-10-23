## REMOVED Requirements

### Requirement: CU-bound lite Features reuse the contracts change_unit sidecar

**Reason**: c2f7a91e retires lite execution and its dedicated artifacts/entry points. Canonical source clauses are explicitly marked retired until archive removes them; deleted implementations are no longer claimed as current enforcement.

**Migration**: Ignore residual track keys on modern runs; finish historical change/coding/exit runs with their matching old release or start a newly authorized run, preserving delivery budgets. Non-lite behavior remains supported.


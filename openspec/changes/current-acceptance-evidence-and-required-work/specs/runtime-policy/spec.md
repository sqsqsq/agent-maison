## ADDED Requirements

### Requirement: Verification-only recovery follows invocation facts and original budgets

Verification-only recovery SHALL reuse an existing invocation only when it is settled or has an accepted bound report, its corresponding raw gate originals/events prove PASS, its negative outer verdict is solely the current old finding awaiting verification, and its products and related business inputs remain valid. Retry ordinal and an unrelated effective phase PASS MUST NOT substitute for these facts. Real gate failure, unknown provenance and substantial input changes SHALL retain normal affected repair/verification.

Pure gate completion, verification and transcription MUST NOT consume content-repair allowance. Their actual model calls and time SHALL count toward the original total and wall budgets. Undelivered work MUST NOT be reported as a failed repair attempt, and MUST NOT erase resources already consumed. The runner MUST NOT start a new call at the existing total-call limit or implicitly increase its budget. Machine-only gate, closure, finalizer and completion projection MAY finish after the last permitted call when no additional call is required and wall time permits.

#### Scenario: Last permitted verification call completes machine closure

- **WHEN** a valid settled invocation requires one original-verifier recovery call with 29 of 30 calls already consumed
- **THEN** only that call advances the total to 30, zero authors are allocated, and remaining machine-only closure can finish without a 31st call

#### Scenario: No call remains for necessary verification

- **WHEN** 30 of 30 calls have been consumed and a necessary verification remains
- **THEN** recovery stops at the existing budget_turns boundary with the concrete outstanding task and owner, without a fresh run, counter reset or automatic increase

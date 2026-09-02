# Hylyre output contracts (SSOT)

This directory is the **single source of truth** for Hylyre-owned output contracts
(`trace.json`, `test-report.md`, and the machine result protocol). It ships as
package-data with both the wheel and the plain-source release, so consumers can
read and validate the protocol **offline**, without this repository's `docs/`.

Consumer repos (e.g. SimulatedWalletForHmos `framework/`) consume **these files
directly**; they must not maintain a synonymous copy of the protocol.

## Files

| File | Role |
|---|---|
| [`step-outcome-v1.md`](step-outcome-v1.md) | **Normative** Step Outcome Protocol v1 (`hylyre.step-outcome/1`): outcome variants, failure/cause/reason, four code registries, selector request/resolution, artifacts, reducer rules, pre-run reject, legacy dispatch |
| [`builder-decision-table.md`](builder-decision-table.md) | **Normative** mapping from execution facts to `StepResult` / pre-run reject, plus reducer derivation rows and the single-builder wiring list |
| [`output-schema.json`](output-schema.json) | JSON Schema (draft 2020-12) for the `0.4-p0` trace, the reusable `stepResultV1` node, and the `pre_run_reject` envelope; also retains the legacy `0.3-p0` / `0.2-p4` / `0.1-p0` shapes for read-only compatibility |
| [`report-sections.yaml`](report-sections.yaml) | Required Markdown sections, status/verdict enums, expected-check modes |
| [`reference_reducer.py`](reference_reducer.py) | **Normative executable oracle** for the cross-row rules JSON Schema cannot express: `prior_step` root references, the CaseResult three axes, run outcome, `candidate_count` recomputation, expected-check policy and the `tool_calls` projection |
| [`golden/`](golden) | Positive and negative fixtures for every schema node; directory convention is the expectation (`<target>/valid/` must pass, `<target>/invalid/` must be rejected, `trace/invalid-crossrow/` must pass the schema but be rejected by the reducer/verifier) |

## Protocol versions

| trace `schema_version` | `result_protocol` | Status |
|---|---|---|
| `0.4-p0` | `hylyre.step-outcome/1` (required) | current; the only evidence-eligible shape |
| `0.3-p0` | must be absent | legacy, read-only; never converted to v1 evidence |
| `0.2-p4` / `0.1-p0` | must be absent | legacy, read-only |

All read entries dispatch on `(schema_version, result_protocol)` and **fail closed**
on unknown or mismatched combinations. See `step-outcome-v1.md` §14.

## Reading the contract from code

```python
from hylyre.contracts import GOLDEN_DIR, load_output_schema, validate_against

errors = validate_against("/$defs/stepResultV1", step_dict)   # [] when valid
errors = validate_against("/$defs/pre_run_reject", envelope)
```

## Verifying the contract package

```bash
python scripts/verify_contracts.py
```

This checks the schema itself, every golden fixture, the cross-row reducer/verifier
oracle, the `report-sections.yaml` version dispatch, the registry/decision-table
consistency suite, and the real `hylyre run --plan` / `--steps-file` pre-run reject
behaviour (single stdout JSON, exit `2`, zero device calls, no trace/report write).

**Note for offline consumers**: `scripts/verify_contracts.py` and `tests/schema/`
live in the Hylyre repository and are *not* installed with the package. The
protocol itself — this directory, including `reference_reducer.py` and
`golden/**` — is fully self-contained and needs neither of them.

## Change process

1. Propose via an OpenSpec change under `openspec/changes/*/specs/contracts/`.
2. Update **this directory first** — `step-outcome-v1.md`, `builder-decision-table.md`,
   `output-schema.json`, `report-sections.yaml` and `golden/**` must change in the
   **same** commit; the registries, decision-table rows and fixtures are cross-checked
   mechanically and will fail apart.
3. Then update `hylyre/report/emit.py` and `hylyre/harness/runner.py` so generation
   and L5 verification stay aligned.
4. Update `tests/schema/` and the L5 unit tests in the same PR.
5. Run `python -m pytest` and, for a representative plan,
   `hylyre run --use-fakes …` + `hylyre report verify …`
   (fixture: `tests/e2e/fixtures/mock-test-plan.md`).

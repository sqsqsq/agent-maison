# Hylyre output contracts (SSOT)

This directory defines **Hylyre-owned** constraints for generated artifacts (`test-report.md`, `trace.json`).  
Consumer repos (e.g. SimulatedWalletForHmos `framework/`) may have their own harness rules; Hylyre uses **compatibility mirroring** in CI (soft warning) without importing their code.

## Files

- `output-schema.json` — JSON Schema for `trace.json` (expand toward full harness schema in P4).
- `report-sections.yaml` — Required Markdown sections and allowed status/verdict enums.

## Change process

1. Propose via OpenSpec change under `openspec/changes/*/specs/contracts/` (or edit `openspec/specs/contracts/spec.md` for small doc-only deltas, as appropriate).
2. Update **`hylyre/contracts/`** first (`output-schema.json`, `report-sections.yaml`), then **`hylyre/report/emit.py`** and **`hylyre/harness/runner.py`** so generation and L5 verification stay aligned.
3. Update **`tests/schema/`** and L5 unit tests (for example `tests/unit/test_harness_verify.py`) in the same PR.
4. Run **`python -m pytest`** and, for a representative plan, **`hylyre run --use-fakes …` + `hylyre report verify …`** (fixture: `tests/e2e/fixtures/mock-test-plan.md`) before merging.

"""Synthesize ScenarioRunResult from ``run --steps-file`` batch output."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hylyre.scenario.plan_parse import ParsedPlan, TestCase
from hylyre.scenario.reducer import make_case_result
from hylyre.scenario.results import CaseResult, StepResult
from hylyre.scenario.runner import ScenarioRunResult

#: One batch is one case. `prior_step` causality is only defined inside a case,
#: so projecting each row into its own single-step case would strand every
#: abort-suffix row's reference and produce a trace the verifier rejects.
BATCH_CASE_ID = "STEPS-BATCH"


def _step_from_row(row: dict[str, Any]) -> StepResult:
    """Rehydrate the v1 ledger row the batch already produced.

    There is deliberately no fallback: a row without ``step_result`` is a
    wiring bug, and guessing a failure classification from the row's flat
    ``status`` is exactly what P0-7 forbids.
    """

    raw = row.get("step_result")
    if not isinstance(raw, dict):
        raise ValueError(
            f"batch row {row.get('index')} has no step_result; the batch runner "
            "must build every row through the single StepResult builder"
        )
    return StepResult(
        index=int(raw["index"]),
        kind=str(raw["kind"]),
        role=raw["role"],
        duration_ms=float(raw.get("duration_ms", 0.0)),
        device_session=bool(raw.get("device_session", False)),
        outcome=dict(raw["outcome"]),
        selector=raw.get("selector"),
        artifacts=tuple(raw.get("artifacts") or ()),
        diagnostic=raw.get("diagnostic"),
        extensions=dict(raw.get("extensions") or {}),
    )


def steps_batch_to_scenario_result(
    *,
    feature: str,
    steps_path: Path,
    batch: dict[str, Any],
    bundle: str | None = None,
    page_name: str | None = None,
    use_fakes: bool = False,
) -> ScenarioRunResult:
    """Map a steps-file batch to a plan-shaped result for report/trace emit.

    The whole batch becomes a single case whose steps keep their original batch
    indexes, so an abort suffix's ``cause.prior_step`` still references a real
    earlier root in the same case.
    """

    _ = (bundle, page_name)
    steps: list[StepResult] = []
    labels: list[str] = []
    for row in batch.get("results", []):
        if not isinstance(row, dict):
            continue
        steps.append(_step_from_row(row))
        labels.append(json.dumps(row.get("step", {}), ensure_ascii=False))

    name = f"{len(steps)} planned step(s) from {Path(steps_path).name}"
    case = TestCase(
        case_id=BATCH_CASE_ID,
        name=name,
        preconditions="-",
        steps="; ".join(labels)[:2000] or "-",
        expected="-",
        priority="P2",
        ac_ref="AC-STEPS",
    )
    notes = "; ".join(s.diagnostic for s in steps if s.diagnostic)
    case_results: list[CaseResult] = []
    if steps:
        case_results.append(
            make_case_result(case, steps, expected_check_mode="empty", notes=notes)
        )

    plan = ParsedPlan(path=Path(steps_path), cases=tuple([case] if steps else []))
    return ScenarioRunResult(
        feature=feature,
        plan=plan,
        case_results=tuple(case_results),
        use_fakes=use_fakes,
        environment=(
            {"ui_driver": "fake", "hypium_version": "unavailable"}
            if use_fakes
            else None
        ),
    )

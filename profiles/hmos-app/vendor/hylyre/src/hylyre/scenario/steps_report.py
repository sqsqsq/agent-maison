"""Synthesize ScenarioRunResult from ``run --steps-file`` batch output."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hylyre.scenario.plan_parse import ParsedPlan, TestCase
from hylyre.scenario.runner import CaseResult, ScenarioRunResult


def steps_batch_to_scenario_result(
    *,
    feature: str,
    steps_path: Path,
    batch: dict[str, Any],
    bundle: str | None = None,
    page_name: str | None = None,
) -> ScenarioRunResult:
    """Map per-step batch results to plan-shaped ``ScenarioRunResult`` for report/trace emit."""
    cases: list[TestCase] = []
    case_results: list[CaseResult] = []
    tool_log: list[dict[str, Any]] = []

    if bundle:
        entry: dict[str, Any] = {"kind": "start_app", "bundle": bundle}
        if page_name:
            entry["page_name"] = page_name
        tool_log.append(entry)

    for row in batch.get("results", []):
        if not isinstance(row, dict):
            continue
        idx = int(row.get("index", len(cases)))
        step_obj = row.get("step", {})
        case_id = f"STEP-{idx:03d}"
        name = json.dumps(step_obj, ensure_ascii=False)[:120]
        tc = TestCase(
            case_id=case_id,
            name=name,
            preconditions="-",
            steps=name,
            expected="-",
            priority="P2",
            ac_ref=f"AC-{idx:03d}",
        )
        cases.append(tc)
        status = "通过" if row.get("status") == "ok" else (
            "跳过" if row.get("status") == "skipped" else "失败"
        )
        notes = ""
        if status == "失败":
            notes = str(row.get("error", ""))[:2000]
        elif status == "跳过":
            notes = str(row.get("error", ""))[:2000]
        case_results.append(CaseResult(case=tc, status=status, notes=notes))
        tool_log.append(
            {
                "case": case_id,
                "kind": "planned_json",
                "status": row.get("status"),
                "step": step_obj,
            }
        )

    plan = ParsedPlan(path=Path(steps_path), cases=tuple(cases))
    return ScenarioRunResult(
        feature=feature,
        plan=plan,
        case_results=tuple(case_results),
        use_fakes=False,
        tool_calls=tuple(tool_log),
    )

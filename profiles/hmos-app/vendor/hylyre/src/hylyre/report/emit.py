"""Build Markdown and trace projections from one ``CaseResult`` ledger."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import hylyre
from hylyre.contracts import RESULT_PROTOCOL, TRACE_SCHEMA_V1
from hylyre.scenario.runner import ScenarioRunResult, resolved_outcome
from hylyre.scenario.results import redact_text

TRACE_SCHEMA_VERSION = TRACE_SCHEMA_V1
LEGACY_TRACE_SCHEMA_VERSIONS = frozenset({"0.1-p0", "0.2-p4", "0.3-p0"})
_TIERS = ("P0", "P1", "P2")


def write_run_artifacts(
    result: ScenarioRunResult,
    *,
    report_path: Path,
    trace_path: Path,
    model_backend: str = "fake",
    schema_version: str = TRACE_SCHEMA_VERSION,
) -> None:
    """Write both projections; neither output owns runtime result state."""

    report_path.parent.mkdir(parents=True, exist_ok=True)
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        _markdown_report(result, schema_version=schema_version), encoding="utf-8"
    )
    trace_path.write_text(
        json.dumps(
            _trace_object(
                result,
                model_backend=model_backend,
                schema_version=schema_version,
            ),
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _normalize_tier(priority: str) -> str:
    p = priority.upper().strip()
    if p in _TIERS:
        return p
    if p.startswith("P0"):
        return "P0"
    if p.startswith("P1"):
        return "P1"
    return "P2"


def _verdict_from_outcome(outcome: str, pass_ratio: float) -> str:
    if outcome == "success" and pass_ratio >= 1.0:
        return "达标"
    if outcome == "partial" and pass_ratio > 0:
        return "有条件达标"
    if 0 < pass_ratio < 1.0:
        return "有条件达标"
    return "不达标"


def _priority_counts(result: ScenarioRunResult) -> dict[str, dict[str, int]]:
    buckets: dict[str, dict[str, int]] = {t: {"total": 0, "passed": 0} for t in _TIERS}
    for cr in result.case_results:
        tier = _normalize_tier(cr.case.priority)
        bucket = buckets[tier]
        bucket["total"] += 1
        if cr.verification == "passed" and cr.evidence == "complete":
            bucket["passed"] += 1
    return buckets


def _safe_cell(value: Any) -> str:
    return str(value).replace("|", "/").replace("\n", " ").strip()


def _attribution(step: Any) -> tuple[str, str]:
    """Human-readable attribution for the Markdown table.

    This is a projection of the outcome carrier, not a second classification:
    a blocked step shows its own cause, never the root step's failure.
    """

    outcome = step.to_dict()["outcome"]
    status = outcome["status"]
    if status == "failed":
        return f"failure.{outcome['failure']['domain']}", outcome["failure"]["code"]
    if status == "blocked":
        cause = outcome["cause"]
        if cause["type"] == "prior_step":
            return "cause.prior_step", f"step {cause['step_index']}"
        return f"cause.{cause['type']}", cause["code"]
    if status == "skipped":
        return f"reason.{outcome['reason']['type']}", outcome["reason"]["code"]
    observation = outcome.get("observation") or {}
    return f"observation.{observation.get('kind', '-')}", "-"


def _markdown_report(
    result: ScenarioRunResult,
    *,
    schema_version: str = TRACE_SCHEMA_VERSION,
) -> str:
    lines: list[str] = []
    passed = sum(
        1
        for item in result.case_results
        if item.verification == "passed" and item.evidence == "complete"
    )
    total = len(result.case_results)
    ratio = passed / total if total else 0.0
    outcome = resolved_outcome(result)
    verdict = _verdict_from_outcome(outcome, ratio)
    buckets = _priority_counts(result)

    lines.extend(
        [
            f"# 测试报告 — {result.feature}",
            "",
            "## 测试概览",
            "",
            f"- **特性**: {result.feature}",
            f"- **计划**: `{result.plan.path.as_posix()}`",
            f"- **模式**: {'fake 驱动（无真机）' if result.use_fakes else '真机'}",
            f"- **trace schema**: `{schema_version}`",
            "",
            "## 测试执行结果",
            "",
            "| 用例编号 | 用例名称 | 优先级 | 关联 AC | 状态 | execution | verification | evidence | expected_check_mode | 备注 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for cr in result.case_results:
        c = cr.case
        lines.append(
            "| "
            + " | ".join(
                [
                    _safe_cell(c.case_id),
                    _safe_cell(c.name),
                    _safe_cell(c.priority),
                    _safe_cell(c.ac_ref),
                    _safe_cell(cr.status),
                    _safe_cell(cr.execution),
                    _safe_cell(cr.verification),
                    _safe_cell(cr.evidence),
                    _safe_cell(cr.expected_check_mode),
                    _safe_cell(redact_text(cr.notes) or ""),
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## 步骤证据",
            "",
            "| 用例编号 | index | kind | role | status | 归因 | code | outcome |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for cr in result.case_results:
        for step in cr.steps:
            carrier, code = _attribution(step)
            outcome_json = json.dumps(
                step.to_dict()["outcome"], ensure_ascii=False, sort_keys=True
            )
            lines.append(
                "| "
                + " | ".join(
                    [
                        _safe_cell(cr.case.case_id),
                        str(step.index),
                        _safe_cell(step.kind),
                        _safe_cell(step.role),
                        _safe_cell(step.status),
                        _safe_cell(carrier),
                        _safe_cell(code),
                        _safe_cell(outcome_json),
                    ]
                )
                + " |"
            )
    lines.extend(["", "## 缺陷清单", ""])
    failures = [
        cr for cr in result.case_results if cr.status in ("失败", "阻塞")
    ]
    if not failures:
        lines.append("无失败项。")
    else:
        for cr in failures:
            lines.append(
                f"- **{_safe_cell(cr.case.case_id)}** "
                f"{_safe_cell(cr.case.name)}: {cr.status} — "
                f"{_safe_cell(redact_text(cr.notes) or '')}"
            )
    lines.extend(["", "## 通过率统计", ""])
    for tier in _TIERS:
        bucket = buckets[tier]
        t, ok = bucket["total"], bucket["passed"]
        pct = f"{100.0 * ok / t:.1f}%" if t else "n/a"
        lines.append(f"- **{tier}**: {ok}/{t}（{pct}）")
    overall = f"{100.0 * passed / total:.1f}%" if total else "n/a"
    lines.append(f"- **总体**: {passed}/{total}（{overall}）")
    lines.extend(
        [
            "",
            "## 结论",
            "",
            f"{verdict}（执行结果 outcome={outcome}，通过率 {passed}/{total}）。",
            "",
        ]
    )
    return "\n".join(lines)


def _trace_environment(
    result: ScenarioRunResult, *, schema_version: str
) -> dict[str, str]:
    supplied = dict(result.environment or {})
    return {
        "hylyre_version": hylyre.__version__,
        "hypium_version": supplied.get("hypium_version", "unavailable"),
        "trace_schema_version": schema_version,
        "result_protocol": RESULT_PROTOCOL,
        "selector_engine": "fake" if result.use_fakes else "mixed",
        "ui_driver": supplied.get("ui_driver", "unknown"),
    }


def _trace_object(
    result: ScenarioRunResult,
    *,
    model_backend: str,
    schema_version: str = TRACE_SCHEMA_VERSION,
) -> dict[str, Any]:
    outcome = resolved_outcome(result)
    cases = [cr.to_dict() for cr in result.case_results]
    trace: dict[str, Any] = {
        "schema_version": schema_version,
        "result_protocol": RESULT_PROTOCOL,
        "feature": result.feature,
        "phase": "testing",
        "outcome": outcome,
        "model_backend": model_backend,
        "tool_calls": list(result.tool_calls),
        "retries": 0,
        "artifacts": {
            "plan": result.plan.path.as_posix(),
            "use_fakes": result.use_fakes,
        },
        "cases": cases,
    }
    if schema_version == TRACE_SCHEMA_VERSION:
        trace["environment"] = _trace_environment(
            result, schema_version=schema_version
        )
    else:
        # Legacy envelopes never declare the v1 protocol.
        trace.pop("result_protocol", None)
    return trace


__all__ = [
    "LEGACY_TRACE_SCHEMA_VERSIONS",
    "TRACE_SCHEMA_VERSION",
    "write_run_artifacts",
]

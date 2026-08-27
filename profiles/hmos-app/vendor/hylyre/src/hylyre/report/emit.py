"""Build ``test-report.md`` and ``trace.json`` for a scenario run."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hylyre.scenario.runner import ScenarioRunResult, resolved_outcome

_TIERS = ("P0", "P1", "P2")


def write_run_artifacts(
    result: ScenarioRunResult,
    *,
    report_path: Path,
    trace_path: Path,
    model_backend: str = "fake",
) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(_markdown_report(result), encoding="utf-8")
    trace_path.write_text(
        json.dumps(_trace_object(result, model_backend=model_backend), indent=2),
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


def _outcome_from_result(result: ScenarioRunResult) -> str:
    return resolved_outcome(result)


def _verdict_from_outcome(outcome: str, pass_ratio: float) -> str:
    if outcome == "success" and pass_ratio >= 1.0:
        return "达标"
    if outcome == "partial" or 0 < pass_ratio < 1.0:
        return "有条件达标"
    return "不达标"


def _priority_counts(result: ScenarioRunResult) -> dict[str, dict[str, int]]:
    """P0/P1/P2 buckets: total vs passed (unknown priorities → P2)."""
    buckets: dict[str, dict[str, int]] = {t: {"total": 0, "passed": 0} for t in _TIERS}
    for cr in result.case_results:
        tier = _normalize_tier(cr.case.priority)
        b = buckets[tier]
        b["total"] += 1
        if cr.status == "通过":
            b["passed"] += 1
    return buckets


def _markdown_report(result: ScenarioRunResult) -> str:
    lines: list[str] = []
    passed = sum(1 for r in result.case_results if r.status == "通过")
    total = len(result.case_results)
    ratio = passed / total if total else 0.0
    outcome = _outcome_from_result(result)
    verdict = _verdict_from_outcome(outcome, ratio)
    buckets = _priority_counts(result)

    lines.append(f"# 测试报告 — {result.feature}")
    lines.append("")
    lines.append("## 测试概览")
    lines.append("")
    lines.append(f"- **特性**: {result.feature}")
    lines.append(f"- **计划**: `{result.plan.path.as_posix()}`")
    lines.append(f"- **模式**: {'fake 驱动（无真机）' if result.use_fakes else '真机'}")
    lines.append("")
    lines.append("## 测试执行结果")
    lines.append("")
    lines.append(
        "| 用例编号 | 用例名称 | 优先级 | 关联 AC | 状态 | 备注 |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for cr in result.case_results:
        c = cr.case
        lines.append(
            f"| {c.case_id} | {c.name} | {c.priority} | {c.ac_ref} | {cr.status} | {cr.notes} |"
        )
    lines.append("")
    lines.append("## 缺陷清单")
    lines.append("")
    failures = [cr for cr in result.case_results if cr.status in ("失败", "阻塞")]
    if not failures:
        lines.append("无失败项。")
    else:
        for cr in failures:
            lines.append(f"- **{cr.case.case_id}** {cr.case.name}: {cr.status} — {cr.notes}")
    lines.append("")
    lines.append("## 通过率统计")
    lines.append("")
    for pr in _TIERS:
        b = buckets[pr]
        t, ok = b["total"], b["passed"]
        pct = f"{100.0 * ok / t:.1f}%" if t else "n/a"
        lines.append(f"- **{pr}**: {ok}/{t}（{pct}）")
    overall = f"{100.0 * passed / total:.1f}%" if total else "n/a"
    lines.append(f"- **总体**: {passed}/{total}（{overall}）")
    lines.append("")
    lines.append("## 结论")
    lines.append("")
    lines.append(
        f"{verdict}（执行结果 outcome={outcome}，通过率 {passed}/{total}）。"
    )
    lines.append("")
    return "\n".join(lines)


def _trace_object(result: ScenarioRunResult, *, model_backend: str) -> dict[str, Any]:
    outcome = _outcome_from_result(result)
    return {
        "schema_version": "0.2-p4",
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
        "cases": [
            {
                "id": cr.case.case_id,
                "status": cr.status,
                "priority": cr.case.priority,
                "ac_ref": cr.case.ac_ref,
                "notes": cr.notes,
            }
            for cr in result.case_results
        ],
    }

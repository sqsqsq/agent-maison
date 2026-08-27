"""Report/trace verification harness (L5)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from hylyre.scenario.plan_parse import parse_test_plan

_CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
_TIERS = ("P0", "P1", "P2")


def verify_report(
    report: Path | str,
    trace: Path | str,
    plan: Path | str | None = None,
) -> bool:
    """Verify artifacts against Hylyre contracts. Returns True or raises ValueError."""
    rpath = Path(report)
    tpath = Path(trace)
    report_text = rpath.read_text(encoding="utf-8")
    trace_data = json.loads(tpath.read_text(encoding="utf-8"))
    sections = _load_report_contract()

    _validate_trace_schema(trace_data)
    _validate_report_headings(report_text, sections["report_required_sections"])
    statuses = sections["execution_status_values"]
    verdicts = set(sections["verdict_values"])
    rows = _parse_execution_table(report_text, statuses)
    _validate_verdict(report_text, verdicts)
    if plan is not None:
        _validate_plan_report_ids(Path(plan), rows)
    _validate_defects_section(report_text, rows)
    required_tiers = tuple(sections.get("pass_rate_required_tiers", _TIERS))
    overall_label = str(sections.get("pass_rate_overall_label", "总体"))
    _validate_pass_rate_section(report_text, rows, required_tiers, overall_label)
    _validate_conclusion_consistency(report_text, rows, verdicts)
    _validate_trace_outcome(trace_data, rows)
    _trace_matches_plan(trace_data, rows)
    return True


def _load_report_contract() -> dict[str, Any]:
    ypath = _CONTRACTS / "report-sections.yaml"
    data = yaml.safe_load(ypath.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("report-sections.yaml invalid")
    return data


def _validate_trace_schema(trace_data: dict[str, Any]) -> None:
    if trace_data.get("schema_version") == "0.2-p4" and not trace_data.get("cases"):
        raise ValueError("trace.json schema_version 0.2-p4 requires non-empty cases[]")
    schema_path = _CONTRACTS / "output-schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(trace_data), key=lambda e: e.path)
    if errors:
        msg = "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:5])
        raise ValueError(f"trace.json schema: {msg}")


def _validate_report_headings(report: str, required: list[str]) -> None:
    for title in required:
        if not re.search(rf"^##\s+{re.escape(title)}\s*$", report, re.MULTILINE):
            raise ValueError(f"test-report.md missing required section heading: ## {title}")


def _normalize_tier(priority: str) -> str:
    p = priority.upper().strip()
    if p in _TIERS:
        return p
    if p.startswith("P0"):
        return "P0"
    if p.startswith("P1"):
        return "P1"
    return "P2"


def _parse_execution_table(
    report: str,
    allowed_statuses: list[str],
) -> dict[str, dict[str, str]]:
    """Map case_id -> {status, ac_ref, priority}."""
    m = re.search(r"^##\s+测试执行结果\s*$", report, re.MULTILINE)
    if not m:
        raise ValueError("No ## 测试执行结果 section")
    rest = report[m.end() :]
    lines = rest.splitlines()
    table_lines: list[str] = []
    for line in lines:
        if "|" in line and line.strip().startswith("|"):
            table_lines.append(line)
        elif table_lines and line.strip() == "":
            break
        elif table_lines and line.startswith("#"):
            break
    if len(table_lines) < 2:
        raise ValueError("测试执行结果 has no markdown table")

    header = _split_md_row(table_lines[0])
    if "状态" not in header:
        raise ValueError("Execution table missing 状态 column")
    idx_id = header.index("用例编号")
    idx_ac = header.index("关联 AC")
    idx_status = header.index("状态")
    idx_pri = header.index("优先级")

    out: dict[str, dict[str, str]] = {}
    for row_line in table_lines[2:]:
        cells = _split_md_row(row_line)
        if len(cells) <= max(idx_id, idx_ac, idx_status, idx_pri):
            continue
        cid = cells[idx_id].strip()
        status = cells[idx_status].strip()
        ac = cells[idx_ac].strip()
        pri = cells[idx_pri].strip()
        if not cid or cid.startswith("---"):
            continue
        if status not in allowed_statuses:
            raise ValueError(
                f"Invalid execution status {status!r} for case {cid}; "
                f"allowed: {allowed_statuses}"
            )
        if not ac:
            raise ValueError(f"关联 AC empty for case {cid}")
        out[cid] = {"status": status, "ac_ref": ac, "priority": pri}
    if not out:
        raise ValueError("No execution rows parsed")
    return out


def _split_md_row(line: str) -> list[str]:
    s = line.strip().strip("|")
    return [c.strip() for c in s.split("|")]


def _validate_verdict(report: str, verdicts: set[str]) -> None:
    m = re.search(r"^##\s+结论\s*$", report, re.MULTILINE)
    if not m:
        raise ValueError("No ## 结论 section")
    rest = report[m.end() :]
    chunk = rest.split("\n##")[0]
    if not any(v in chunk for v in verdicts):
        raise ValueError(
            f"结论 must mention one of {sorted(verdicts)}; got:\n{chunk[:400]!r}"
        )


def _section_body(report: str, title: str) -> str:
    m = re.search(rf"^##\s+{re.escape(title)}\s*$", report, re.MULTILINE)
    if not m:
        raise ValueError(f"Missing section ## {title}")
    rest = report[m.end() :]
    return rest.split("\n##")[0]


def _validate_defects_section(
    report: str,
    rows: dict[str, dict[str, str]],
) -> None:
    body = _section_body(report, "缺陷清单").strip()
    has_fail = any(r["status"] in ("失败", "阻塞") for r in rows.values())
    if has_fail:
        if "无失败项" in body:
            raise ValueError("缺陷清单 must not claim 无失败项 when cases failed or blocked")
        if not re.search(r"(?m)^\s*-\s+\*\*", body):
            raise ValueError("缺陷清单 must list failing cases when there are 失败/阻塞")
    else:
        if "无失败项" not in body:
            raise ValueError("缺陷清单 must include 无失败项 when all cases passed/skipped")


def _tier_counts(rows: dict[str, dict[str, str]]) -> dict[str, tuple[int, int]]:
    buckets = {t: [0, 0] for t in _TIERS}
    for r in rows.values():
        tier = _normalize_tier(r["priority"])
        buckets[tier][1] += 1
        if r["status"] == "通过":
            buckets[tier][0] += 1
    return {t: (buckets[t][0], buckets[t][1]) for t in _TIERS}


def _validate_pass_rate_section(
    report: str,
    rows: dict[str, dict[str, str]],
    required_tiers: tuple[str, ...],
    overall_label: str,
) -> None:
    body = _section_body(report, "通过率统计")
    expected = _tier_counts(rows)
    passed_all = sum(1 for r in rows.values() if r["status"] == "通过")
    total_all = len(rows)

    for tier in required_tiers:
        ok, tot = expected.get(tier, (0, 0))
        pat = rf"(?m)^\s*-\s+\*\*{re.escape(tier)}\*\*:\s*(\d+)/(\d+)"
        m = re.search(pat, body)
        if not m:
            raise ValueError(
                f"通过率统计 missing or malformed line for **{tier}** (expected {ok}/{tot})"
            )
        gok, gtot = int(m.group(1)), int(m.group(2))
        if gok != ok or gtot != tot:
            raise ValueError(
                f"通过率统计 **{tier}** mismatch: report {gok}/{gtot}, "
                f"from table {ok}/{tot}"
            )

    oo_pat = rf"(?m)^\s*-\s+\*\*{re.escape(overall_label)}\*\*:\s*(\d+)/(\d+)"
    om = re.search(oo_pat, body)
    if not om:
        raise ValueError(f"通过率统计 missing **{overall_label}** line")
    o_ok, o_tot = int(om.group(1)), int(om.group(2))
    if o_ok != passed_all or o_tot != total_all:
        raise ValueError(
            f"通过率统计 **{overall_label}** mismatch: report {o_ok}/{o_tot}, "
            f"from table {passed_all}/{total_all}"
        )


def _outcome_from_statuses(statuses: list[str]) -> str:
    if not statuses:
        return "success"
    if all(s == "通过" for s in statuses):
        return "success"
    if any(s == "失败" for s in statuses) and any(s == "通过" for s in statuses):
        return "partial"
    if any(s == "失败" for s in statuses) or any(s == "阻塞" for s in statuses):
        return "failed"
    return "success"


def _expected_verdict(outcome: str, passed: int, total: int) -> str:
    ratio = passed / total if total else 0.0
    if outcome == "success" and ratio >= 1.0:
        return "达标"
    if outcome == "partial" or 0 < ratio < 1.0:
        return "有条件达标"
    return "不达标"


def _validate_conclusion_consistency(
    report: str,
    rows: dict[str, dict[str, str]],
    verdicts: set[str],
) -> None:
    chunk = _section_body(report, "结论").strip()
    statuses = [r["status"] for r in rows.values()]
    outcome = _outcome_from_statuses(statuses)
    passed = sum(1 for s in statuses if s == "通过")
    total = len(statuses)
    ev = _expected_verdict(outcome, passed, total)

    mo = re.search(r"outcome=(success|partial|failed)", chunk)
    if not mo:
        raise ValueError("结论 must contain outcome=success|partial|failed")
    if mo.group(1) != outcome:
        raise ValueError(
            f"结论 outcome mismatch: report {mo.group(1)!r}, expected {outcome!r}"
        )

    mp = re.search(r"通过率\s+(\d+)/(\d+)", chunk)
    if not mp:
        raise ValueError("结论 must contain 通过率 n/m")
    if int(mp.group(1)) != passed or int(mp.group(2)) != total:
        raise ValueError(
            f"结论 通过率 mismatch: report {mp.group(1)}/{mp.group(2)}, "
            f"expected {passed}/{total}"
        )

    mv = re.match(r"^(达标|有条件达标|不达标)", chunk.strip())
    if not mv:
        raise ValueError("结论 must start with 达标|有条件达标|不达标")
    if mv.group(1) != ev:
        raise ValueError(
            f"结论 verdict mismatch: report lead {mv.group(1)!r}, "
            f"expected {ev!r} for outcome={outcome}, pass_ratio={passed}/{total}"
        )
    if mv.group(1) not in verdicts:
        raise ValueError(f"invalid verdict {mv.group(1)}")


def _validate_trace_outcome(
    trace_data: dict[str, Any],
    rows: dict[str, dict[str, str]],
) -> None:
    statuses = [r["status"] for r in rows.values()]
    expected = _outcome_from_statuses(statuses)
    got = trace_data.get("outcome")
    if got != expected:
        raise ValueError(
            f"trace.json outcome {got!r} != expected {expected!r} from execution table"
        )


def _validate_plan_report_ids(
    plan_path: Path,
    report_cases: dict[str, dict[str, str]],
) -> None:
    parsed = parse_test_plan(plan_path)
    plan_ids = {c.case_id for c in parsed.cases}
    report_ids = set(report_cases.keys())
    missing = plan_ids - report_ids
    if missing:
        raise ValueError(
            f"Report table missing plan cases: {sorted(missing)}"
        )
    extra = report_ids - plan_ids
    if extra:
        raise ValueError(
            f"Report table has unknown case ids vs plan: {sorted(extra)}"
        )


def _trace_matches_plan(
    trace_data: dict[str, Any],
    report_cases: dict[str, dict[str, str]],
) -> None:
    cases = trace_data.get("cases")
    if not isinstance(cases, list):
        return
    for entry in cases:
        if not isinstance(entry, dict):
            continue
        cid = entry.get("id")
        st = entry.get("status")
        if cid in report_cases and st != report_cases[cid]["status"]:
            raise ValueError(
                f"trace case {cid} status {st!r} != report {report_cases[cid]['status']!r}"
            )

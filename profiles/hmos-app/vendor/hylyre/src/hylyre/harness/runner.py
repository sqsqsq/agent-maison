"""Report/trace verification harness (L5)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from hylyre.contracts import RESULT_PROTOCOL, TRACE_SCHEMA_V1
from hylyre.contracts.reference_reducer import verify_trace
from hylyre.scenario.plan_parse import parse_test_plan

_CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
_TIERS = ("P0", "P1", "P2")
_NEW_TRACE_SCHEMA = TRACE_SCHEMA_V1
_LEGACY_TRACE_SCHEMAS = {"0.1-p0", "0.2-p4", "0.3-p0"}


class UnsupportedTraceProtocol(ValueError):
    """Fail-closed dispatch result, carrying the frozen machine code."""

    code = "unsupported_schema_or_protocol"


def trace_schema_kind(trace: Path | str | dict[str, Any]) -> str:
    """Dispatch on ``(schema_version, result_protocol)``; never guess.

    Returns ``current`` only for ``0.4-p0`` + ``hylyre.step-outcome/1``,
    ``legacy`` for the read-only historical shapes that correctly do *not*
    declare the protocol, and ``unsupported`` for everything else — including a
    legacy trace that claims the v1 protocol and a v1 schema that omits it.
    Unsupported must fail loudly; silently returning empty checks for an
    unrecognized combination is the failure mode P0-17 exists to prevent.
    """

    if isinstance(trace, dict):
        data = trace
    else:
        data = json.loads(Path(trace).read_text(encoding="utf-8"))
    version = data.get("schema_version")
    protocol = data.get("result_protocol")
    if version == _NEW_TRACE_SCHEMA:
        return "current" if protocol == RESULT_PROTOCOL else "unsupported"
    if version in _LEGACY_TRACE_SCHEMAS:
        return "unsupported" if protocol is not None else "legacy"
    return "unsupported"


#: Frozen machine codes for the read-side dispatch (spec section 14.2).
DISPATCH_CODES: dict[str, str | None] = {
    "current": None,
    "legacy": "legacy_unsupported_for_evidence",
    "unsupported": "unsupported_schema_or_protocol",
}


def trace_dispatch_code(trace: Path | str | dict[str, Any]) -> str | None:
    """The frozen dispatch code for this trace, or ``None`` when it is current.

    Consumers route on this, never on the internal ``kind`` alias and never by
    parsing an exception message.
    """

    return DISPATCH_CODES[trace_schema_kind(trace)]


def trace_verification_label(trace: Path | str | dict[str, Any]) -> str:
    kind = trace_schema_kind(trace)
    if kind == "legacy":
        return "legacy trace; readable compatibility only, not new StepResult evidence"
    if kind == "current":
        return f"current trace; {RESULT_PROTOCOL} StepResult evidence"
    return "unsupported schema/protocol combination"


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
    required_sections = list(sections["report_required_sections"])
    if trace_data.get("schema_version") in _LEGACY_TRACE_SCHEMAS:
        required_sections = [s for s in required_sections if s != "步骤证据"]
    _validate_report_headings(report_text, required_sections)
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
    if trace_data.get("schema_version") == _NEW_TRACE_SCHEMA:
        _validate_new_trace_consistency(report_text, trace_data, rows)
    return True


def verify_report_details(
    report: Path | str,
    trace: Path | str,
    plan: Path | str | None = None,
) -> dict[str, Any]:
    """Return explicit compatibility metadata while keeping ``verify_report`` bool-compatible."""

    verify_report(report, trace, plan)
    kind = trace_schema_kind(trace)
    return {
        "ok": True,
        "trace_kind": kind,
        "dispatch_code": DISPATCH_CODES[kind],
        "evidence_eligible": kind == "current",
        "label": trace_verification_label(trace),
    }


def _load_report_contract() -> dict[str, Any]:
    ypath = _CONTRACTS / "report-sections.yaml"
    data = yaml.safe_load(ypath.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("report-sections.yaml invalid")
    return data


def _validate_trace_schema(trace_data: dict[str, Any]) -> None:
    """Structure by JSON Schema, cross-row rules by the shipped oracle.

    Deliberately absent: the 0.3-p0 rule that every non-passed step must carry
    ``failure_kind``/``failure_code``. That rule forced unexecuted ``blocked``
    steps and policy ``skipped`` steps to fabricate a failure taxonomy, and is
    removed rather than renamed — ``blocked`` carries a cause, ``skipped``
    carries a reason, and neither carries a failure.
    """

    kind = trace_schema_kind(trace_data)
    if kind == "unsupported":
        raise UnsupportedTraceProtocol(
            "trace.json declares an unsupported (schema_version, result_protocol) "
            f"combination: {trace_data.get('schema_version')!r} / "
            f"{trace_data.get('result_protocol')!r}; expected "
            f"{TRACE_SCHEMA_V1!r} + {RESULT_PROTOCOL!r}, or a legacy schema with "
            "no result_protocol"
        )
    if trace_data.get("schema_version") == "0.2-p4" and not trace_data.get("cases"):
        raise ValueError("trace.json schema_version 0.2-p4 requires non-empty cases[]")

    schema_path = _CONTRACTS / "output-schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(trace_data), key=lambda e: e.path)
    if errors:
        msg = "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:5])
        raise ValueError(f"trace.json schema: {msg}")

    if kind != "current":
        return

    cases = trace_data.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("new trace schema requires non-empty cases[]")
    ids = [c.get("id") for c in cases if isinstance(c, dict)]
    if len(ids) != len(set(ids)):
        raise ValueError("trace.json duplicate case id")

    # Cross-row rules JSON Schema cannot express: prior_step root references,
    # CaseResult reduction, run outcome, candidate_count and the tool_calls
    # projection. One implementation, shipped with the contract.
    problems = verify_trace(trace_data)
    if problems:
        raise ValueError("trace.json cross-row: " + "; ".join(problems[:5]))


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
    idx_execution = header.index("execution") if "execution" in header else None
    idx_verification = header.index("verification") if "verification" in header else None
    idx_evidence = header.index("evidence") if "evidence" in header else None
    idx_expected_mode = (
        header.index("expected_check_mode") if "expected_check_mode" in header else None
    )

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
        if cid in out:
            raise ValueError(f"duplicate report case id {cid}")
        if status not in allowed_statuses:
            raise ValueError(
                f"Invalid execution status {status!r} for case {cid}; "
                f"allowed: {allowed_statuses}"
            )
        if not ac:
            raise ValueError(f"关联 AC empty for case {cid}")
        row: dict[str, str] = {"status": status, "ac_ref": ac, "priority": pri}
        for key, position in (
            ("execution", idx_execution),
            ("verification", idx_verification),
            ("evidence", idx_evidence),
            ("expected_check_mode", idx_expected_mode),
        ):
            if position is not None and position < len(cells):
                row[key] = cells[position].strip()
        out[cid] = row
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
        return "aborted"
    if all(s == "通过" for s in statuses):
        return "success"
    if any(s == "失败" for s in statuses) and any(s == "通过" for s in statuses):
        return "partial"
    if any(s == "失败" for s in statuses) or any(s == "阻塞" for s in statuses):
        return "failed"
    # All skipped/inconclusive rows are not a successful verification run, but
    # a skip is not itself an assertion failure.
    return "partial"


def _expected_verdict(outcome: str, passed: int, total: int) -> str:
    ratio = passed / total if total else 0.0
    if outcome == "success" and ratio >= 1.0:
        return "达标"
    if outcome == "partial" and ratio > 0:
        return "有条件达标"
    if 0 < ratio < 1.0:
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

    mo = re.search(r"outcome=(success|partial|failed|aborted)", chunk)
    if not mo:
        raise ValueError("结论 must contain outcome=success|partial|failed|aborted")
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
        raise ValueError("trace.json cases must be an array")
    trace_ids = [
        str(entry.get("id"))
        for entry in cases
        if isinstance(entry, dict) and entry.get("id") is not None
    ]
    if set(trace_ids) != set(report_cases):
        raise ValueError(
            f"trace/report case id set mismatch: trace={sorted(set(trace_ids))}, "
            f"report={sorted(report_cases)}"
        )
    for entry in cases:
        if not isinstance(entry, dict):
            continue
        cid = entry.get("id")
        st = entry.get("status")
        if cid in report_cases and st != report_cases[cid]["status"]:
            raise ValueError(
                f"trace case {cid} status {st!r} != report {report_cases[cid]['status']!r}"
            )


def _validate_new_trace_consistency(
    report: str,
    trace_data: dict[str, Any],
    rows: dict[str, dict[str, str]],
) -> None:
    """Check the Markdown projection against the ledger.

    ``tool_calls`` is already recomputed by the oracle in
    :func:`_validate_trace_schema`; here we only prove the Markdown step table
    is derived from the same rows and invents no attribution of its own.
    """

    expected_steps: dict[tuple[str, int], dict[str, Any]] = {}
    for case in trace_data.get("cases", []):
        if not isinstance(case, dict):
            continue
        cid = str(case["id"])
        row = rows.get(cid)
        if row is None:
            raise ValueError(f"trace case {cid} missing from report")
        for field in ("priority", "ac_ref", "status"):
            if str(case.get(field, "")) != row[field]:
                raise ValueError(
                    f"trace/report case {cid} {field} mismatch: "
                    f"{case.get(field)!r} != {row[field]!r}"
                )
        for field in ("execution", "verification", "evidence", "expected_check_mode"):
            if field in row and str(case.get(field, "")) != row[field]:
                raise ValueError(
                    f"trace/report case {cid} {field} mismatch: "
                    f"{case.get(field)!r} != {row[field]!r}"
                )
        for step in case.get("steps", []):
            if not isinstance(step, dict):
                continue
            key = (cid, int(step["index"]))
            if key in expected_steps:
                raise ValueError(f"duplicate step identity {cid}:{key[1]}")
            expected_steps[key] = step

    body = _section_body(report, "步骤证据")
    lines = [line for line in body.splitlines() if line.strip().startswith("|")]
    if len(lines) < 2:
        raise ValueError("步骤证据 has no markdown table")
    actual_steps: set[tuple[str, int]] = set()
    for line in lines[2:]:
        cells = _split_md_row(line)
        if len(cells) < 8 or cells[0].startswith("---"):
            continue
        cid = cells[0].strip()
        try:
            idx = int(cells[1].strip())
        except ValueError as exc:
            raise ValueError(f"步骤证据 invalid index for {cid}: {cells[1]!r}") from exc
        key = (cid, idx)
        if key in actual_steps:
            raise ValueError(f"duplicate Markdown step identity {cid}:{idx}")
        actual_steps.add(key)
        expected = expected_steps.get(key)
        if expected is None:
            raise ValueError(f"Markdown has unknown step {cid}:{idx}")
        if cells[2].strip() != str(expected["kind"]):
            raise ValueError(f"Markdown step {cid}:{idx} kind mismatch")
        if cells[4].strip() != str(expected["outcome"]["status"]):
            raise ValueError(f"Markdown step {cid}:{idx} status mismatch")
        try:
            markdown_outcome = json.loads(cells[7].strip())
        except json.JSONDecodeError as exc:
            raise ValueError(f"Markdown step {cid}:{idx} outcome is not JSON") from exc
        if markdown_outcome != expected["outcome"]:
            raise ValueError(f"Markdown step {cid}:{idx} outcome mismatch")
    if actual_steps != set(expected_steps):
        raise ValueError(
            f"Markdown/trace step set mismatch: report={sorted(actual_steps)}, "
            f"trace={sorted(expected_steps)}"
        )

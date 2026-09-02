"""Reference reducer/verifier for Step Outcome Protocol v1.

This is the **executable oracle** for the cross-row rules that JSON Schema
cannot express: ``prior_step`` root references, the CaseResult three axes,
the run outcome, ``candidate_count`` recomputation, the expected-check policy
rule and the ``tool_calls`` projection.

It implements ``step-outcome-v1.md`` sections 9 and 12 literally and is part of
the frozen contract package, so Hylyre's Phase 1 reducer/verifier and Maison's
consumer can be held against the same behaviour.

It is deliberately *not* the production reducer: it reads a finished trace
document and reports violations. It creates no ledger, no sidecar and no second
source of truth.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "reduce_case",
    "run_outcome",
    "tool_calls_projection",
    "verify_trace",
]

_SCREEN_ARTIFACTS = frozenset({"screenshot", "ui_dump", "visible_elements"})
_EXPECTED_EXCLUDED_MODES = frozenset({"disabled_by_flag", "unavailable_no_vlm"})


def _status(step: dict[str, Any]) -> str:
    return str(step["outcome"]["status"])


def _is_root_blocked(step: dict[str, Any]) -> bool:
    outcome = step["outcome"]
    return outcome["status"] == "blocked" and outcome["cause"]["type"] in {
        "capability",
        "infrastructure",
    }


def _capture_unavailable(step: dict[str, Any]) -> bool:
    capture = step.get("extensions", {}).get("hylyre.capture")
    return isinstance(capture, dict) and capture.get("screen") == "unavailable"


def _boundary_applies(step: dict[str, Any]) -> bool:
    """Section 8.1: does this row owe a failure-boundary screen artifact?"""

    outcome = step["outcome"]
    return bool(
        step.get("device_session")
        and outcome["status"] == "failed"
        and outcome["failure"]["domain"] in {"selector", "assertion"}
    )


def required_assertions(
    steps: list[dict[str, Any]], expected_check_mode: str
) -> list[dict[str, Any]]:
    """Section 9.2: assertions that participate in the verification gate."""

    return [
        s
        for s in steps
        if s["role"] == "assertion"
        and not (
            s["kind"] == "expected_check"
            and expected_check_mode in _EXPECTED_EXCLUDED_MODES
        )
    ]


def _reduce_execution(steps: list[dict[str, Any]]) -> str:
    """Section 9.1."""

    for step in steps:
        outcome = step["outcome"]
        if outcome["status"] == "failed" and outcome["failure"]["domain"] == (
            "infrastructure"
        ):
            return "infrastructure_failed"
        if outcome["status"] == "blocked" and outcome["cause"]["type"] == (
            "infrastructure"
        ):
            return "infrastructure_failed"
    for step in steps:
        if _status(step) == "failed" or _is_root_blocked(step):
            return "aborted"
    return "completed"


def _reduce_evidence(steps: list[dict[str, Any]], expected_check_mode: str) -> str:
    """Section 9.3."""

    required = required_assertions(steps, expected_check_mode)
    required_ids = {id(s) for s in required}
    for step in steps:
        if _boundary_applies(step) and _capture_unavailable(step):
            return "incomplete"
        if _status(step) != "passed":
            continue
        observation = step["outcome"].get("observation")
        if not observation:
            return "incomplete"
        if (
            id(step) in required_ids
            and observation.get("assertion_type") == "toast"
            and observation["facts"].get("trigger_window_covered") is not True
        ):
            return "incomplete"
    return "complete"


def _reduce_verification(
    steps: list[dict[str, Any]],
    expected_check_mode: str,
    execution: str,
    evidence: str,
) -> str:
    """Section 9.2."""

    if execution != "completed":
        return "failed"
    if any(_status(s) in {"failed", "blocked"} for s in steps):
        return "failed"
    required = required_assertions(steps, expected_check_mode)
    if not required:
        return "inconclusive"
    if any(_status(s) == "skipped" for s in required):
        return "inconclusive"
    if not all(_status(s) == "passed" for s in required):
        return "inconclusive"
    if evidence != "complete":
        return "inconclusive"
    if expected_check_mode == "checked_vlm":
        expected_rows = [s for s in steps if s["kind"] == "expected_check"]
        if len(expected_rows) != 1 or _status(expected_rows[0]) != "passed":
            return "inconclusive"
    return "passed"


def _reduce_legacy_status(
    steps: list[dict[str, Any]], execution: str, verification: str
) -> str:
    """Section 9.5."""

    if execution == "infrastructure_failed":
        return "阻塞"
    if verification == "passed":
        return "通过"
    if any(_status(s) == "failed" for s in steps):
        return "失败"
    if any(_status(s) == "blocked" for s in steps):
        return "阻塞"
    if steps and all(_status(s) == "skipped" for s in steps):
        return "跳过"
    return "跳过"


def reduce_case(case: dict[str, Any]) -> dict[str, str]:
    """Return the four derived CaseResult values for one case document."""

    steps = list(case["steps"])
    mode = str(case["expected_check_mode"])
    execution = _reduce_execution(steps)
    evidence = _reduce_evidence(steps, mode)
    verification = _reduce_verification(steps, mode, execution, evidence)
    return {
        "execution": execution,
        "verification": verification,
        "evidence": evidence,
        "status": _reduce_legacy_status(steps, execution, verification),
    }


def run_outcome(cases: list[dict[str, Any]]) -> str:
    """Section 9.6, first matching rule wins."""

    if not cases:
        return "aborted"
    fully_passed = [
        c
        for c in cases
        if c["execution"] == "completed"
        and c["verification"] == "passed"
        and c["evidence"] == "complete"
    ]
    if len(fully_passed) == len(cases):
        return "success"
    if any(
        c["execution"] == "infrastructure_failed"
        or any(_status(s) == "blocked" for s in c["steps"])
        for c in cases
    ):
        return "failed"
    if any(c["verification"] == "failed" for c in cases):
        return "partial" if fully_passed else "failed"
    return "partial"


def tool_calls_projection(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Section 12: the only legal ``tool_calls`` value for these cases."""

    calls: list[dict[str, Any]] = []
    for case in cases:
        for step in case["steps"]:
            outcome = step["outcome"]
            status = outcome["status"]
            projection: dict[str, Any] = {"status": status}
            if status == "failed":
                projection["failure"] = {
                    "domain": outcome["failure"]["domain"],
                    "code": outcome["failure"]["code"],
                }
            elif status == "blocked":
                cause = outcome["cause"]
                projection["cause"] = (
                    {"type": "prior_step", "step_index": cause["step_index"]}
                    if cause["type"] == "prior_step"
                    else {"type": cause["type"], "code": cause["code"]}
                )
            elif status == "skipped":
                projection["reason"] = {
                    "type": outcome["reason"]["type"],
                    "code": outcome["reason"]["code"],
                }
            calls.append(
                {
                    "case": case["id"],
                    "index": step["index"],
                    "kind": step["kind"],
                    "role": step["role"],
                    "outcome": projection,
                }
            )
    return calls


def _verify_prior_steps(case: dict[str, Any]) -> list[str]:
    """Section 2.4: prior_step must point at a real root outcome, same case."""

    problems: list[str] = []
    by_index = {s["index"]: s for s in case["steps"]}
    for step in case["steps"]:
        outcome = step["outcome"]
        if outcome["status"] != "blocked":
            continue
        cause = outcome["cause"]
        if cause["type"] != "prior_step":
            continue
        where = f"{case['id']}:{step['index']}"
        target_index = cause["step_index"]
        if target_index >= step["index"]:
            problems.append(
                f"{where}: prior_step references index {target_index} which is not earlier"
            )
            continue
        target = by_index.get(target_index)
        if target is None:
            problems.append(
                f"{where}: prior_step references missing index {target_index}"
            )
            continue
        target_outcome = target["outcome"]
        if target_outcome["status"] == "failed":
            continue
        if target_outcome["status"] == "blocked" and target_outcome["cause"]["type"] in {
            "capability",
            "infrastructure",
        }:
            continue
        if target_outcome["status"] == "blocked":
            problems.append(
                f"{where}: prior_step -> prior_step chain via index {target_index}"
            )
        else:
            problems.append(
                f"{where}: prior_step targets a non-root "
                f"{target_outcome['status']} step {target_index}"
            )
    return problems


def _candidate_count_is_exempt(resolution: dict[str, Any]) -> bool:
    """Section 6.1 exemption: an uncountable unresolvable may list partial candidates.

    A resolver can legitimately see some candidates without being able to compute
    the total (a virtualized list is the standard case). The protocol keeps that
    partial evidence rather than discarding it, so ``candidate_count`` stays
    ``null`` and is not recomputed from ``candidates``.
    """

    return (
        resolution.get("state") == "unresolvable"
        and (resolution.get("facts") or {}).get("candidate_countable") is False
    )


def _verify_selectors(case: dict[str, Any]) -> list[str]:
    """Section 6.1: candidate_count must be recomputable from candidates."""

    problems: list[str] = []
    for step in case["steps"]:
        selector = step.get("selector")
        if not selector:
            continue
        resolution = selector["resolution"]
        candidates = resolution.get("candidates") or []
        if not candidates:
            continue
        if _candidate_count_is_exempt(resolution):
            continue
        if resolution.get("candidate_count") != len(candidates):
            problems.append(
                f"{case['id']}:{step['index']}: candidate_count "
                f"{resolution.get('candidate_count')} != {len(candidates)} candidates"
            )
    return problems


def _verify_expected_check_policy(case: dict[str, Any]) -> list[str]:
    """Section 9.7 / decision row D-28."""

    if case["expected_check_mode"] != "checked_vlm":
        return []
    problems: list[str] = []
    for step in case["steps"]:
        if step["kind"] != "expected_check":
            continue
        if _status(step) == "skipped":
            code = step["outcome"]["reason"]["code"]
            problems.append(
                f"{case['id']}:{step['index']}: expected_check_mode=checked_vlm "
                f"cannot carry skipped/{code}"
            )
    return problems


def _verify_boundary_artifacts(case: dict[str, Any]) -> list[str]:
    """Section 8.1, cross-checked against the reduced evidence axis."""

    problems: list[str] = []
    for step in case["steps"]:
        if not _boundary_applies(step):
            continue
        has_screen = any(
            a["kind"] in _SCREEN_ARTIFACTS for a in step.get("artifacts", [])
        )
        if not has_screen and not _capture_unavailable(step):
            problems.append(
                f"{case['id']}:{step['index']}: root failure without a "
                "failure-boundary screen artifact or capture-unavailable marker"
            )
    return problems


def verify_trace(trace: dict[str, Any]) -> list[str]:
    """Return every cross-row violation in a 0.4-p0 trace (empty when clean)."""

    problems: list[str] = []
    cases = list(trace.get("cases") or [])

    seen_ids: set[str] = set()
    for case in cases:
        if case["id"] in seen_ids:
            problems.append(f"duplicate case id {case['id']}")
        seen_ids.add(case["id"])

        indexes = [s["index"] for s in case["steps"]]
        if len(indexes) != len(set(indexes)):
            problems.append(f"{case['id']}: duplicate step index")

        problems.extend(_verify_prior_steps(case))
        problems.extend(_verify_selectors(case))
        problems.extend(_verify_expected_check_policy(case))
        problems.extend(_verify_boundary_artifacts(case))

        derived = reduce_case(case)
        for axis, value in derived.items():
            if case[axis] != value:
                problems.append(
                    f"{case['id']}: {axis}={case[axis]!r} but reduces to {value!r}"
                )

    expected_outcome = run_outcome(cases)
    if trace.get("outcome") != expected_outcome:
        problems.append(
            f"run outcome {trace.get('outcome')!r} but reduces to {expected_outcome!r}"
        )

    expected_calls = tool_calls_projection(cases)
    if trace.get("tool_calls") != expected_calls:
        problems.append("tool_calls is not the projection of cases[].steps[]")

    return problems

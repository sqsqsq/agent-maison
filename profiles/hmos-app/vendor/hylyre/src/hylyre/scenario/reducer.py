"""CaseResult / RunResult reduction (P0-8, P1-10).

The three axes, the legacy Chinese status, the run outcome and ``tool_calls``
are *derived*; no entry may set them freely.

The rules live in ``hylyre/contracts/reference_reducer.py`` — the normative,
shipped oracle — and this module delegates to it rather than restating them.
That is deliberate: a second implementation of section 9 would be free to
drift from the frozen contract, and the whole point of the freeze is that
Hylyre and its consumers reduce identically.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from hylyre.contracts import reference_reducer
from hylyre.scenario.plan_parse import TestCase
from hylyre.scenario.results import CaseResult, ExpectedCheckMode, StepResult

__all__ = [
    "make_case_result",
    "reduce_case_axes",
    "run_outcome",
    "tool_calls_projection",
]


def _case_view(
    steps: Sequence[StepResult],
    expected_check_mode: str,
    case_id: str = "case",
) -> dict[str, Any]:
    """Minimal unredacted case document the oracle understands."""

    return {
        "id": case_id,
        "expected_check_mode": expected_check_mode,
        "steps": [step.raw_dict() for step in steps],
    }


def reduce_case_axes(
    steps: Sequence[StepResult],
    *,
    expected_check_mode: str,
    case_id: str = "case",
) -> dict[str, str]:
    """Return ``execution``/``verification``/``evidence``/legacy ``status``."""

    return reference_reducer.reduce_case(
        _case_view(steps, expected_check_mode, case_id)
    )


def make_case_result(
    case: TestCase,
    steps: Sequence[StepResult],
    *,
    expected_check_mode: ExpectedCheckMode = "empty",
    notes: str = "",
) -> CaseResult:
    """Build a CaseResult whose axes are reduced, never asserted."""

    frozen = tuple(steps)
    axes = reduce_case_axes(
        frozen, expected_check_mode=expected_check_mode, case_id=case.case_id
    )
    return CaseResult(
        case=case,
        status=axes["status"],
        notes=notes[:4000],
        execution=axes["execution"],  # type: ignore[arg-type]
        verification=axes["verification"],  # type: ignore[arg-type]
        evidence=axes["evidence"],  # type: ignore[arg-type]
        expected_check_mode=expected_check_mode,
        steps=frozen,
    )


def run_outcome(case_results: Iterable[CaseResult]) -> str:
    """Project cases to the run outcome using the frozen ordered rules."""

    return reference_reducer.run_outcome([cr.raw_dict() for cr in case_results])


def tool_calls_projection(case_results: Iterable[CaseResult]) -> list[dict[str, Any]]:
    """The only legal ``tool_calls`` value for these cases (lossy projection)."""

    return reference_reducer.tool_calls_projection(
        [cr.raw_dict() for cr in case_results]
    )

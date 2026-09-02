"""The single ``OperationOutcome`` -> ``StepResult`` builder (P0-7).

Every entry — real plan runner, native/resolver driver, fake runner,
``run --steps-file``/inline batch, atomic CLI, MCP and the session daemon —
constructs ledger rows through :func:`build_step_result` and nothing else.

Forbidden, and structurally impossible once callers go through here:

1. hand-assembling a ``StepResult`` (the fake used to);
2. guessing a failure from a batch row's legacy status;
3. treating an assertion's ``None`` return as ``passed``;
4. reverse-engineering a v1 row from a legacy Chinese status.

The builder adds exactly the envelope facts an operation cannot know: the plan
index/kind/role, the measured duration and whether a device session was live.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from hylyre.api.outcome import (
    ActionObservation,
    ArtifactRef,
    artifact_from_file,
    Failure,
    OperationBlocked,
    OperationFailed,
    OperationOutcome,
    OperationPassed,
    OperationSkipped,
    PriorStepCause,
)
from hylyre.scenario.results import StepResult

__all__ = [
    "artifact_from_file",
    "blocked_by_prior_step",
    "build_step_result",
    "outcome_from_exception",
    "step_response",
]


def step_response(step: StepResult) -> dict[str, Any]:
    """The envelope every non-trace entry returns for a single step.

    Atomic CLI, MCP and the session daemon all declare the same protocol
    version as the trace, so a consumer dispatches on one field everywhere
    instead of guessing per entry.
    """

    from hylyre.contracts import RESULT_PROTOCOL

    return {"result_protocol": RESULT_PROTOCOL, "step_result": step.to_dict()}


def batch_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Same declaration for a batch response."""

    from hylyre.contracts import RESULT_PROTOCOL

    return {"result_protocol": RESULT_PROTOCOL, **payload}

_SCREEN_ARTIFACTS = frozenset({"screenshot", "ui_dump", "visible_elements"})


def build_step_result(
    outcome: OperationOutcome,
    *,
    index: int,
    kind: str,
    role: str,
    duration_ms: float = 0.0,
    device_session: bool = False,
) -> StepResult:
    """Attach the envelope facts to a transient outcome and freeze the row."""

    if not isinstance(
        outcome,
        (OperationPassed, OperationFailed, OperationBlocked, OperationSkipped),
    ):
        raise TypeError(
            "build_step_result requires an OperationOutcome; "
            f"got {type(outcome).__name__}"
        )
    if role not in ("action", "assertion"):
        raise ValueError(f"role must be action or assertion; got {role!r}")

    outcome_dict = outcome.outcome_dict()
    observation = outcome_dict.get("observation")
    if observation is not None:
        # L-1: role and observation must describe the same thing. The builder
        # is the only place that knows both, so it is the only place that can
        # keep them consistent.
        expected_kind = "assertion" if role == "assertion" else "action"
        if observation.get("kind") != expected_kind:
            raise ValueError(
                f"step {index} role={role} cannot carry a "
                f"{observation.get('kind')} observation"
            )

    selector = outcome.selector.to_dict() if outcome.selector else None
    if selector is not None and outcome_dict["status"] in ("blocked", "skipped"):
        # L-2: a step that was never attempted cannot report a resolution.
        selector = {
            "request": selector["request"],
            "resolution": {
                "state": "not_attempted",
                "candidate_count": None,
                "selected": None,
                "candidates": [],
            },
        }

    return StepResult(
        index=int(index),
        kind=kind,
        role=role,  # type: ignore[arg-type]
        duration_ms=float(duration_ms),
        device_session=bool(device_session),
        outcome=outcome_dict,
        selector=selector,
        artifacts=tuple(a.to_dict() for a in outcome.artifacts),
        diagnostic=outcome.diagnostic,
        extensions=dict(outcome.extensions),
    )


def blocked_by_prior_step(
    *,
    index: int,
    kind: str,
    role: str,
    root_index: int,
) -> StepResult:
    """A suffix row for a case that stopped at ``root_index``.

    It carries a ``cause`` and never the root's ``failure``: copying the root
    classification onto every unexecuted step is what turned one real failure
    into dozens of downstream defects under 0.3-p0.
    """

    return build_step_result(
        OperationBlocked(cause=PriorStepCause(step_index=int(root_index))),
        index=index,
        kind=kind,
        role=role,
    )


def outcome_from_exception(exc: BaseException) -> OperationFailed:
    """Normalize an *unexpected* exception into a failed outcome.

    Expected negative results never reach here — drivers return them as
    outcomes. Classification is by exception type only: matching on message
    text is what previously turned plan errors into ``driver_failure``.
    """

    from hylyre.api.exceptions import PlannedStepContractError

    if isinstance(exc, PlannedStepContractError):
        # Only an explicitly typed planned-step contract violation is blamed on
        # the plan (decision row D-18). A generic ValueError from a driver is a
        # driver bug and falls through to internal.unexpected_exception.
        return OperationFailed(
            failure=Failure(
                "contract",
                "contract.invalid_step",
                {"detected_in": "adapter", "exception_type": type(exc).__name__},
            ),
            diagnostic=str(exc)[:4000],
        )
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return OperationFailed(
            failure=Failure(
                "infrastructure",
                "infrastructure.transport_failure",
                {"exception_type": type(exc).__name__, "attempted": True},
            ),
            diagnostic=str(exc)[:4000],
        )
    return OperationFailed(
        failure=Failure(
            "internal",
            "internal.unexpected_exception",
            {"exception_type": type(exc).__name__},
        ),
        diagnostic=str(exc)[:4000],
    )


def has_screen_artifact(artifacts: Sequence[Mapping[str, Any]]) -> bool:
    """Does this row satisfy the failure-boundary evidence obligation?"""

    return any(a.get("kind") in _SCREEN_ARTIFACTS for a in artifacts)

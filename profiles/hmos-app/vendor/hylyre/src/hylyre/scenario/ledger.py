"""Single planned-step execution ledger used by plan and steps-file paths."""

from __future__ import annotations

import json
import time
from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.api.exceptions import PlannedStepContractError
from hylyre.api.outcome import (
    ActionObservation,
    OperationOutcome,
    OperationPassed,
)
from hylyre.api.step_dispatch import dispatch_planned_step
from hylyre.scenario.results import StepResult, redact_evidence, redact_text
from hylyre.scenario.step_builder import (
    blocked_by_prior_step,
    build_step_result,
    outcome_from_exception,
)
from hylyre.scenario.step_text import (
    json_step_syntax_error,
    looks_like_planned_json,
    non_json_step_error,
    normalize_planned_step_text,
)

_ASSERTION_ROOTS = frozenset({"wait_for", "wait_gone", "assert_toast"})
_ASSERTION_ACTION_TYPES = frozenset({"wait_for", "wait_gone", "assert_toast"})


def _parse_step_object(step: Any) -> dict[str, Any] | None:
    if isinstance(step, dict):
        return step
    if not isinstance(step, str):
        return None
    normalized = normalize_planned_step_text(step)
    if not looks_like_planned_json(step):
        return None
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def toast_assertion_on_unsupported(step: Any) -> str | None:
    """Return a planned Toast assertion's explicit unsupported policy."""

    parsed = _parse_step_object(step)
    if not isinstance(parsed, dict):
        return None
    block: Any = parsed.get("assert_toast")
    if block is None and isinstance(parsed.get("action"), dict):
        action = parsed["action"]
        if action.get("type") == "assert_toast":
            block = action
    if not isinstance(block, dict):
        return None
    return str(block.get("on_unsupported") or "error").strip().lower()


def planned_step_kind(step: Any) -> str:
    if isinstance(step, str):
        normalized = normalize_planned_step_text(step)
        if looks_like_planned_json(step):
            try:
                parsed = json.loads(normalized)
            except json.JSONDecodeError:
                return "planned_json"
            if isinstance(parsed, dict):
                return planned_step_kind(parsed)
        return "ai_action"
    if isinstance(step, dict):
        roots = [str(k) for k in step if k in {
            "action", "touch", "input", "swipe", "scroll", "scroll_to",
            "back", "home", "stop_app", "clear_app", "wait", "wait_for",
            "wait_gone", "wait_idle", "assert_toast", "start_app",
        }]
        if len(roots) == 1:
            root = roots[0]
            if root == "action" and isinstance(step.get(root), dict):
                return str(step[root].get("type") or root)
            return root
        return "planned_step"
    return "planned_step"


def planned_step_role(step: Any) -> str:
    if isinstance(step, str):
        normalized = normalize_planned_step_text(step)
        if looks_like_planned_json(step):
            try:
                parsed = json.loads(normalized)
            except json.JSONDecodeError:
                return "action"
            if isinstance(parsed, dict):
                return planned_step_role(parsed)
        return "action"
    if isinstance(step, dict):
        if "action" in step and isinstance(step.get("action"), dict):
            kind = str(step["action"].get("type") or "")
        else:
            kind = next((str(k) for k in _ASSERTION_ROOTS if k in step), "")
        return "assertion" if kind in _ASSERTION_ROOTS or kind in _ASSERTION_ACTION_TYPES else "action"
    return "action"


async def _execute_step_value(agent: HylyreAgent, step: Any, *, case_id: str) -> Any:
    if isinstance(step, dict):
        return await dispatch_planned_step(agent, step, case_id=case_id)
    if not isinstance(step, str):
        raise TypeError(f"{case_id}: planned step must be a JSON object or text")
    normalized = normalize_planned_step_text(step)
    if not normalized:
        raise PlannedStepContractError(f"{case_id}: planned step is empty")
    if looks_like_planned_json(step):
        try:
            payload = json.loads(normalized)
        except json.JSONDecodeError as e:
            raise PlannedStepContractError(json_step_syntax_error(case_id, e, step)) from e
        if not isinstance(payload, dict):
            raise PlannedStepContractError(
            f"{case_id}: planned JSON step must be an object"
        )
        return await dispatch_planned_step(agent, payload, case_id=case_id)
    if agent.vlm is None:
        # Proven unavailable before the operation is dispatched: a capability
        # block, not a failure and not a policy skip.
        from hylyre.api.outcome import CapabilityCause, OperationBlocked

        return OperationBlocked(
            cause=CapabilityCause(
                code="capability.not_configured",
                capability_id="vlm_natural_language_step",
                probe_status="not_configured",
                probe_source="agent.vlm_preflight",
            ),
            diagnostic=non_json_step_error(case_id),
        )
    return await agent.ai_action(normalized)


async def execute_ledger_step(
    agent: HylyreAgent,
    step: Any,
    *,
    index: int,
    case_id: str,
    device_session: bool | None = None,
) -> StepResult:
    """Execute one step and always return one finalized StepResult.

    The operation returns a typed outcome; this function only measures the
    step and hands it to the single builder. It never inspects a dict to guess
    what happened, and an assertion that returns nothing is never a pass.
    """

    kind = planned_step_kind(step)
    role = planned_step_role(step)
    t0 = time.perf_counter()
    try:
        value: Any = await _execute_step_value(agent, step, case_id=case_id)
        outcome = _require_outcome(value, kind=kind, case_id=case_id)
    except Exception as exc:  # noqa: BLE001 - unexpected only; expected paths return outcomes
        # A wiring bug (an operation returning something that is not an
        # outcome) must still produce a ledger row: "every dispatched step has
        # a StepResult" is the invariant, and letting a TypeError escape here
        # would break it precisely when something is already wrong.
        outcome = outcome_from_exception(exc)
    # Read the session fact *after* the operation: the agent connects lazily,
    # so sampling it beforehand would report "no session" for the first step of
    # every run and silently exempt it from the failure-boundary obligation.
    session = agent.is_connected if device_session is None else device_session
    return build_step_result(
        outcome,
        index=index,
        kind=kind,
        role=role,
        duration_ms=(time.perf_counter() - t0) * 1000.0,
        device_session=session,
    )


def _require_outcome(
    value: Any, *, kind: str, case_id: str
) -> OperationOutcome:
    """Every operation must speak the protocol; nothing else is interpreted."""

    from hylyre.api.exceptions import PlannedStepContractError
    from hylyre.api.outcome import (
        OperationBlocked,
        OperationFailed,
        OperationSkipped,
    )

    if isinstance(
        value,
        (OperationPassed, OperationFailed, OperationBlocked, OperationSkipped),
    ):
        return value
    raise TypeError(
        f"{case_id}: operation {kind!r} returned {type(value).__name__}, "
        "not an OperationOutcome; every driver/agent operation must return the "
        "typed union (see hylyre/contracts/step-outcome-v1.md section 7)"
    )


async def execute_expected_assertion(
    agent: HylyreAgent,
    instruction: str,
    *,
    index: int,
    case_id: str,
    device_session: bool | None = None,
) -> StepResult:
    """Run the expected-result VLM check as a normal assertion ledger row."""

    t0 = time.perf_counter()
    try:
        value: Any = await agent.ai_assert(instruction)
        outcome = _require_outcome(value, kind="expected_check", case_id=case_id)
    except Exception as exc:  # noqa: BLE001
        outcome = outcome_from_exception(exc)
    session = agent.is_connected if device_session is None else device_session
    return build_step_result(
        outcome,
        index=index,
        kind="expected_check",
        role="assertion",
        duration_ms=(time.perf_counter() - t0) * 1000.0,
        device_session=session,
    )


def step_result_to_batch_row(step: StepResult, raw_step: Any) -> dict[str, Any]:
    """Compatibility projection for the ``run --steps-file`` CLI response.

    ``step_result`` is the v1 row and the only source of truth here; the flat
    ``status`` stays for humans reading the batch JSON and is never read back
    to reconstruct a classification.
    """

    status = "ok" if step.status == "passed" else (
        "skipped" if step.status == "skipped" else "error"
    )
    row: dict[str, Any] = {
        "index": step.index,
        "step": (
            redact_evidence(raw_step)
            if isinstance(raw_step, (dict, list, tuple))
            else redact_text(str(raw_step))
        ),
        "status": status,
        "elapsed_ms": step.duration_ms,
        "step_result": step.to_dict(),
    }
    if step.diagnostic:
        row["error"] = redact_text(step.diagnostic)
    if step.artifacts:
        row["diagnostics"] = [a["path"] for a in step.artifacts]
    return row


__all__ = [
    "blocked_by_prior_step",
    "execute_expected_assertion",
    "execute_ledger_step",
    "planned_step_kind",
    "planned_step_role",
    "step_result_to_batch_row",
    "toast_assertion_on_unsupported",
]

"""Dispatch one planned JSON step dict to HylyreAgent (shared by scenario runner and batch steps)."""

from __future__ import annotations

from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.api.exceptions import PlannedStepContractError
from hylyre.api.outcome_from_error import typed_exception_outcome
from hylyre.api.planned_step_keys import PLANNED_STEP_ROOT_KEYS

_DISPATCH_BY_ROOT: dict[str, str] = {
    "action": "run_planned_action",
    "touch": "run_planned_tap",
    "input": "run_planned_input",
    "swipe": "run_planned_swipe",
    "scroll": "run_planned_scroll",
    "scroll_to": "run_planned_scroll_to",
    "back": "run_planned_back",
    "home": "run_planned_home",
    "stop_app": "run_planned_stop_app",
    "clear_app": "run_planned_clear_app",
    "wait": "run_planned_wait",
    "wait_for": "run_planned_wait_for",
    "wait_gone": "run_planned_wait_gone",
    "wait_idle": "run_planned_wait_idle",
    "assert_toast": "run_planned_assert_toast",
    "start_app": "run_planned_start_app_step",
}


async def dispatch_planned_step(
    agent: HylyreAgent,
    payload: dict[str, Any],
    *,
    case_id: str = "step",
) -> Any:
    """Run a single planned step object (same root keys as test-plan rows after ``json.loads``)."""
    roots = [k for k in _DISPATCH_BY_ROOT if k in payload]
    if len(roots) != 1:
        allowed = ", ".join(PLANNED_STEP_ROOT_KEYS)
        if not roots:
            raise PlannedStepContractError(
                f"{case_id}: JSON step must contain exactly one root key "
                f"among: {allowed}"
            )
        raise PlannedStepContractError(
            f"{case_id}: JSON step has multiple root keys {roots!r}; "
            f"use one of: {allowed}"
        )
    root = roots[0]
    method_name = _DISPATCH_BY_ROOT[root]
    fn = getattr(agent, method_name)
    try:
        return await fn(payload)
    except Exception as exc:  # noqa: BLE001 - typed control flow only
        # Expected negative results are values, not exceptions. The resolver
        # raises them deep in its call chain, so they are converted exactly
        # once, here, on exception *type* — never on message text. Anything
        # unrecognized keeps propagating as a genuinely unexpected failure.
        block = payload.get(root)
        if root == "action" and isinstance(block, dict):
            block = {k: v for k, v in block.items() if k != "type"}
        outcome = typed_exception_outcome(
            exc, block if isinstance(block, dict) else None
        )
        if outcome is None:
            raise
        return outcome

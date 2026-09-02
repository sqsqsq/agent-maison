"""Pre-run plan contract validation (Step Outcome Protocol v1, P0-7B).

Empty cases and statically invalid planned steps are rejected *before* any
device is contacted, because there is no legal ``StepResult`` that could carry
the result.  This is a protocol decision, not a process crash: callers emit the
frozen ``pre_run_reject`` envelope on stdout and exit with code ``2`` without
creating or rewriting a trace/report.

See ``hylyre/contracts/step-outcome-v1.md`` §11 and
``hylyre/contracts/builder-decision-table.md`` section A.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from hylyre.api.planned_step_keys import PLANNED_STEP_ROOT_KEYS
from hylyre.api.selector_contract import SUPPORTED_MATCHES
from hylyre.contracts import RESULT_PROTOCOL
from hylyre.scenario.plan_parse import parse_test_plan
from hylyre.scenario.step_text import (
    looks_like_planned_json,
    normalize_planned_step_text,
)

#: Registered pre-run contract codes (``output-schema.json`` ``preRunRejectCode``).
PRE_RUN_REJECT_CODES = (
    "contract.empty_case",
    "contract.invalid_step",
    "contract.invalid_selector",
    "contract.invalid_match",
)

_MATCH_KEYS = frozenset({"match", "area_match", "at_match"})
_TOUCH_SELECTOR_KEYS = ("by_text", "by_id", "by_type", "by_key", "all")


@dataclass(frozen=True)
class ContractRejection:
    """One plan-validation violation, reported before any device call."""

    code: str
    path: str
    summary: str
    case_id: str | None = None
    step_index: int | None = None

    def envelope(self) -> dict[str, Any]:
        """Return the frozen ``pre_run_reject`` envelope for this rejection."""

        return {
            "result_protocol": RESULT_PROTOCOL,
            "command_status": "rejected",
            "phase": "pre_run_validation",
            "rejection": {
                "domain": "contract",
                "code": self.code,
                "case_id": self.case_id,
                "step_index": self.step_index,
                "path": self.path,
                "summary": self.summary,
            },
        }

    def to_json(self) -> str:
        return json.dumps(self.envelope(), ensure_ascii=False)


def iter_plan_steps(text: str) -> list[str]:
    """Split one plan cell exactly the way the runner will execute it."""

    normalized = text.replace("；", "\n").replace(";", "\n")
    return [ln.strip() for ln in normalized.splitlines() if ln.strip()]


def _bad_match(value: Any) -> bool:
    if value is None:
        return False
    if not isinstance(value, str):
        return True
    return value.strip().lower() not in SUPPORTED_MATCHES


def _walk_dicts(node: Any) -> Iterable[dict[str, Any]]:
    if isinstance(node, dict):
        yield node
        for child in node.values():
            yield from _walk_dicts(child)
    elif isinstance(node, list):
        for child in node:
            yield from _walk_dicts(child)


def _touch_blocks(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Return ``(json path suffix, block)`` for statically checkable touch blocks."""

    blocks: list[tuple[str, dict[str, Any]]] = []
    touch = payload.get("touch")
    if isinstance(touch, dict):
        blocks.append(("touch", touch))
    action = payload.get("action")
    if isinstance(action, dict) and action.get("type") == "touch":
        blocks.append(("action", {k: v for k, v in action.items() if k != "type"}))
    return blocks


def validate_planned_step(
    raw: Any,
    *,
    path: str,
    case_id: str | None = None,
    step_index: int | None = None,
) -> ContractRejection | None:
    """Validate one planned step statically; return the first violation."""

    if isinstance(raw, dict):
        payload: dict[str, Any] | None = raw
    elif isinstance(raw, str):
        if not looks_like_planned_json(raw):
            # Natural-language steps are resolved at runtime by the VLM path.
            return None
        try:
            parsed = json.loads(normalize_planned_step_text(raw))
        except json.JSONDecodeError as exc:
            return ContractRejection(
                code="contract.invalid_step",
                path=path,
                summary=f"planned JSON step is not parseable: {exc}",
                case_id=case_id,
                step_index=step_index,
            )
        if not isinstance(parsed, dict):
            return ContractRejection(
                code="contract.invalid_step",
                path=path,
                summary="planned JSON step must be an object",
                case_id=case_id,
                step_index=step_index,
            )
        payload = parsed
    else:
        return ContractRejection(
            code="contract.invalid_step",
            path=path,
            summary=(
                "planned step must be a JSON object or text, got "
                f"{type(raw).__name__}"
            ),
            case_id=case_id,
            step_index=step_index,
        )

    roots = [key for key in PLANNED_STEP_ROOT_KEYS if key in payload]
    if len(roots) != 1:
        allowed = ", ".join(PLANNED_STEP_ROOT_KEYS)
        summary = (
            f"planned JSON step must contain exactly one root key among: {allowed}"
            if not roots
            else f"planned JSON step has multiple root keys {sorted(roots)}"
        )
        return ContractRejection(
            code="contract.invalid_step",
            path=path,
            summary=summary,
            case_id=case_id,
            step_index=step_index,
        )

    root = roots[0]
    for block in _walk_dicts(payload):
        for key in _MATCH_KEYS:
            if key in block and _bad_match(block[key]):
                return ContractRejection(
                    code="contract.invalid_match",
                    path=f"{path}.{root}.{key}",
                    summary=(
                        f"unsupported {key} {block[key]!r}; supported values are "
                        "exact and contains"
                    ),
                    case_id=case_id,
                    step_index=step_index,
                )

    for suffix, block in _touch_blocks(payload):
        has_x = block.get("x") is not None
        has_y = block.get("y") is not None
        if has_x != has_y:
            return ContractRejection(
                code="contract.invalid_selector",
                path=f"{path}.{suffix}",
                summary="touch coordinates require both x and y",
                case_id=case_id,
                step_index=step_index,
            )
        targets = sum(
            1 for key in _TOUCH_SELECTOR_KEYS if block.get(key) is not None
        ) + int(has_x and has_y)
        if targets != 1:
            return ContractRejection(
                code="contract.invalid_selector",
                path=f"{path}.{suffix}",
                summary=(
                    "touch requires exactly one of (x and y), by_text, by_id, "
                    f"by_type, by_key or all; got {targets}"
                ),
                case_id=case_id,
                step_index=step_index,
            )
    return None


def validate_plan_contract(plan_path: Path | str) -> ContractRejection | None:
    """Validate a parsed ``test-plan.md`` before any device is contacted."""

    plan = parse_test_plan(plan_path)
    for case in plan.cases:
        steps = iter_plan_steps(case.steps)
        if not steps:
            return ContractRejection(
                code="contract.empty_case",
                path=f"cases[{case.case_id}].steps",
                summary="case contains no executable planned step",
                case_id=case.case_id,
            )
        for index, raw in enumerate(steps):
            rejection = validate_planned_step(
                raw,
                path=f"cases[{case.case_id}].steps[{index}]",
                case_id=case.case_id,
                step_index=index,
            )
            if rejection is not None:
                return rejection
    return None


def validate_steps_contract(
    steps: list[Any], *, path_prefix: str = "steps"
) -> ContractRejection | None:
    """Validate a ``run --steps-file`` / inline batch payload before execution."""

    if not steps:
        return ContractRejection(
            code="contract.empty_case",
            path=path_prefix,
            summary="steps payload contains no executable planned step",
        )
    for index, raw in enumerate(steps):
        rejection = validate_planned_step(
            raw, path=f"{path_prefix}[{index}]", step_index=index
        )
        if rejection is not None:
            return rejection
    return None


__all__ = [
    "PRE_RUN_REJECT_CODES",
    "ContractRejection",
    "iter_plan_steps",
    "validate_plan_contract",
    "validate_planned_step",
    "validate_steps_contract",
]

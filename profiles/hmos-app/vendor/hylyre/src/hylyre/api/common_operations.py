"""Common planned operations, using the existing resolver and outcome protocol."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Any

from hylyre.api.common_operation_contract import COMMON_OPERATION_KEYS, validate_common_operation
from hylyre.api.exceptions import CapabilityUnsupported, PlannedStepContractError
from hylyre.api.outcome import (
    ActionObservation, CapabilityCause, Failure, OperationBlocked, OperationFailed,
    OperationPassed, SelectorEvidence, SelectorResolution, artifact_from_file,
)
from hylyre.api.selector_contract import selector_request
from hylyre.api.selector_ops import tree_from_dump
from hylyre.api.selector_resolve import resolve_one
from hylyre.ui_dump_hints import parse_bounds_rect


def capability_block(operation: str, exc: Exception) -> OperationBlocked:
    return OperationBlocked(cause=CapabilityCause(
        "capability.unsupported", operation, "unsupported", "driver.common_operation",
        facts={"reason": str(exc)},
    ), diagnostic=str(exc))


class CommonOperationsMixin:
    async def run_planned_common_operation(self, payload: dict[str, Any], *, artifact_dir: Any = None, artifact_base: Any = None) -> Any:
        root = next(k for k in COMMON_OPERATION_KEYS if k in payload)
        block = payload[root]
        validate_common_operation(root, block)
        try:
            await self._ensure_ui()
            return await self._apply_common_operation(root, block, artifact_dir=artifact_dir, artifact_base=artifact_base)
        except (CapabilityUnsupported, NotImplementedError) as exc:
            return capability_block(root, exc)

    async def _apply_common_operation(self, root: str, block: dict[str, Any], *, artifact_dir: Any = None, artifact_base: Any = None) -> Any:
        kwargs = dict(block)
        facts: dict[str, Any] = {}
        selector = None
        tree = None
        # One snapshot resolves all endpoints and area before any injected action.
        target_fields = {
            "drag": ("start", "end"), "slide": ("start", "end"),
            "two_finger_swipe": ("start1", "end1", "start2", "end2"),
        }.get(root, ())
        needs_targets = bool(target_fields) or root in {
            "multi_finger_touch", "gesture", "get_component_property", "clear_text", "set_checked"
        } or "area" in block
        if needs_targets:
            tree = tree_from_dump(await self.dump_ui())
        screen = parse_bounds_rect(str((tree or {}).get("attributes", {}).get("bounds", "")))

        def resolve(value: dict[str, Any], *, component: bool = False) -> Any:
            nonlocal selector
            if "x" in value:
                point = (value["x"], value["y"])
                selected = {"point": list(point)}
            else:
                hit = resolve_one(tree, value, lift_text=not component)
                point = hit.center
                selector = SelectorEvidence(selector_request(value), SelectorResolution.unique(hit.id or hit.key or str(hit.tree_index), hit.tap_bounds))
                selected = {"id": hit.id, "key": hit.key, "type": hit.type, "text": hit.text,
                            "bounds": hit.tap_bounds, "point": list(point)}
                if component:
                    return selected
            if screen is None:
                raise CapabilityUnsupported("screen bounds are unavailable for endpoint validation")
            if not (screen[0] <= point[0] < screen[2] and screen[1] <= point[1] < screen[3]):
                raise PlannedStepContractError(f"screen point {point!r} is outside {screen!r}")
            return point

        area_bounds = None
        if "area" in block:
            area = resolve(block["area"], component=True)
            area_bounds = parse_bounds_rect(area["bounds"])
            if area_bounds is None or area_bounds[2] <= area_bounds[0] or area_bounds[3] <= area_bounds[1]:
                raise PlannedStepContractError("area has no usable bounds")
            kwargs["area"] = area_bounds
            facts["area"] = area

        def endpoint(value: dict[str, Any]) -> tuple[int, int]:
            point = resolve(value)
            if area_bounds and not (area_bounds[0] <= point[0] < area_bounds[2] and area_bounds[1] <= point[1] < area_bounds[3]):
                raise PlannedStepContractError(f"point {point!r} is outside area {area_bounds!r}")
            return point

        for name in target_fields:
            kwargs[name] = endpoint(block[name])
        if target_fields:
            facts["targets"] = {name: list(kwargs[name]) for name in target_fields}
        if root == "multi_finger_touch":
            kwargs["points"] = [endpoint(p) for p in block["points"]]
            facts["points"] = kwargs["points"]
        if root == "gesture":
            kwargs["fingers"] = [[endpoint(p) for p in finger["points"]] for finger in block["fingers"]]
            facts["fingers"] = kwargs["fingers"]
        if root in {"get_component_property", "clear_text", "set_checked"}:
            kwargs["target"] = resolve(block["target"], component=True)
            facts["target"] = kwargs["target"]
        if root == "set_checked":
            desired = block["checked"]
            target = kwargs["target"]
            checkable = await self._ui.get_component_property(target=target, property="checkable")
            if not checkable:
                return OperationFailed(failure=Failure("contract", "contract.invalid_step", {"reason": "target is not checkable"}), selector=selector)
            before = await self._ui.get_component_property(target=target, property="checked")
            changed = before != desired
            after = before
            if changed:
                await self._ui.touch(x=target["point"][0], y=target["point"][1], wait_time=0.1)
                deadline = time.monotonic() + block.get("timeout", 3)
                try:
                    while True:
                        after = await self._ui.get_component_property(target=target, property="checked")
                        if after == desired or time.monotonic() >= deadline:
                            break
                        await asyncio.sleep(min(0.1, max(0, deadline - time.monotonic())))
                except Exception as exc:
                    facts.update(before=before, after=None, checked=desired, changed=True,
                                 confirmation_error={"type": type(exc).__name__, "message": str(exc)})
                    return OperationFailed(
                        failure=Failure("infrastructure", "infrastructure.x_hylyre.state_confirmation_failed",
                                        {"reason": "checked state could not be observed after clicking"}),
                        observation=ActionObservation(root, True, facts), selector=selector,
                        diagnostic=str(exc),
                    )
            facts.update(before=before, after=after, checked=desired, changed=changed)
            observation = ActionObservation(root, True, facts)
            if after != desired:
                return OperationFailed(failure=Failure("infrastructure", "infrastructure.x_hylyre.state_confirmation_failed", {"reason": "checked state confirmation failed"}), observation=observation, selector=selector)
            return OperationPassed(observation=observation, selector=selector)

        result = await getattr(self._ui, root)(**kwargs)
        artifacts = ()
        if root == "get_component_property":
            facts.update(property=block["property"], value=result)
        elif root == "has_app":
            facts.update(bundle=block["bundle"], installed=result)
        elif root == "current_app":
            facts.update(result)
        elif root == "shell":
            facts.update(result)
            raw = facts.pop("raw_evidence", None)
            if raw is not None:
                from hylyre.api.failure_diag import DEFAULT_FAILURE_DIR
                directory = Path(artifact_dir) if artifact_dir is not None else DEFAULT_FAILURE_DIR
                directory.mkdir(parents=True, exist_ok=True)
                path = directory / f"{uuid.uuid4().hex}.json"
                path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
                artifacts = (artifact_from_file("log", path, base=artifact_base or directory),)
                facts["raw_evidence_path"] = str(path.resolve())
            for name in ("stdout", "stderr"):
                value = facts.get(name)
                if isinstance(value, str) and len(value) > 65536:
                    facts[name] = value[:65536]
                    facts[f"{name}_truncated"] = True
            observation = ActionObservation(root, not facts.get("timed_out", False), facts)
            if facts.get("timed_out") or facts.get("transport_error") or facts.get("transport_exit_code") != 0 or facts.get("exit_code") != 0:
                code = "infrastructure.transport_failure" if facts.get("timed_out") or facts.get("transport_error") or facts.get("transport_exit_code") != 0 else "infrastructure.x_hylyre.device_command_failed"
                return OperationFailed(failure=Failure("infrastructure", code, {"operation": root}), observation=observation, artifacts=artifacts)
        return OperationPassed(observation=ActionObservation(root, True, facts), selector=selector, artifacts=artifacts)

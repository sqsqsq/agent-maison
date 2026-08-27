"""Maison-owned Hylyre runtime step telemetry wrapper.

The vendored Hylyre 0.3.1 trace records planned payloads and case outcomes but
does not expose per-step runtime observations. This wrapper runs the unchanged
Hylyre CLI in the same process, observes the real Hypium UI driver immediately
before and after each executed step, and appends those facts to trace.json.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import sys
from typing import Any


SCHEMA_VERSION = "1.0"
COLLECTOR = "maison-hylyre-runtime-telemetry"
COLLECTOR_VERSION = "1.0"

_events: list[dict[str, Any]] = []


def _canonical(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _step_sha256(step: str) -> str:
    """Bind telemetry to the exact normalized plan text shared with TypeScript."""
    from hylyre.scenario.step_text import normalize_planned_step_text

    return _sha256_text(normalize_planned_step_text(step))


def _walk(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _bounds(value: Any) -> list[int] | None:
    if isinstance(value, (list, tuple)) and len(value) >= 4:
        try:
            return [int(value[0]), int(value[1]), int(value[2]), int(value[3])]
        except (TypeError, ValueError):
            return None
    if isinstance(value, dict):
        keys = ("left", "top", "right", "bottom")
        if all(key in value for key in keys):
            try:
                return [int(value[key]) for key in keys]
            except (TypeError, ValueError):
                return None
    if isinstance(value, str):
        nums = [int(v) for v in re.findall(r"-?\d+", value)]
        if len(nums) >= 4:
            return nums[:4]
    return None


def _node_bounds(node: dict[str, Any]) -> list[int] | None:
    for key in ("bounds", "bound", "rect", "rectangle"):
        if key in node:
            parsed = _bounds(node[key])
            if parsed is not None:
                return parsed
    return None


def _observed_ids(dump: Any) -> list[str]:
    values = {
        str(node["id"])
        for node in _walk(dump)
        if isinstance(node.get("id"), str) and str(node["id"])
    }
    return sorted(values)


def _screen(dump: Any) -> dict[str, Any]:
    return {
        "signature_sha256": _sha256_text(_canonical(dump)),
        "observed_element_ids": _observed_ids(dump),
    }


def _declared_step(step: str) -> tuple[str, dict[str, Any] | None, dict[str, str] | None, str]:
    from hylyre.scenario.step_text import normalize_planned_step_text

    normalized = normalize_planned_step_text(step)
    try:
        payload = json.loads(normalized)
    except Exception:
        return "ai_action", None, None, _step_sha256(step)
    if not isinstance(payload, dict) or len(payload) != 1:
        return "invalid", payload if isinstance(payload, dict) else None, None, _step_sha256(step)
    action_kind = next(iter(payload))
    body = payload.get(action_kind)
    block = body if isinstance(body, dict) else {}
    if action_kind == "action" and isinstance(block, dict):
        target_block = block
    else:
        target_block = block
    declared: dict[str, str] | None = None
    for key in ("by_id", "by_text"):
        value = target_block.get(key) if isinstance(target_block, dict) else None
        if isinstance(value, str) and value:
            declared = {"kind": key, "value": value}
            break
    return action_kind, payload, declared, _step_sha256(step)


def _actual_hit(dump: Any, declared: dict[str, str] | None) -> dict[str, Any] | None:
    if not declared:
        return None
    kind = declared["kind"]
    value = declared["value"]
    hits: list[tuple[int, dict[str, Any], list[int] | None]] = []
    for node in _walk(dump):
        matched = (
            kind == "by_id" and node.get("id") == value
        ) or (
            kind == "by_text"
            and (node.get("text") == value or node.get("originalText") == value)
        )
        if not matched:
            continue
        bounds = _node_bounds(node)
        area = 2**63 - 1
        if bounds is not None:
            area = max(0, bounds[2] - bounds[0]) * max(0, bounds[3] - bounds[1])
        hits.append((area, node, bounds))
    if not hits:
        return None
    _, node, bounds = min(hits, key=lambda item: item[0])
    stable_id = node.get("id")
    return {
        "stable_node_id": str(stable_id) if isinstance(stable_id, str) else None,
        "bounds": bounds,
    }


async def _capture(agent: Any) -> Any:
    await agent._ensure_ui()
    ui = getattr(agent, "_ui", None)
    if ui is None:
        raise RuntimeError("HylyreAgent UI driver unavailable after _ensure_ui")
    return await ui.dump_ui()


def _install_patch() -> None:
    import hylyre.scenario.runner as runner

    original = runner._execute_one_step

    async def observed_execute_one_step(
        agent: Any,
        case_id: str,
        step: str,
        tool_log: list[dict[str, Any]],
        *,
        step_idx: int = 0,
    ) -> None:
        action_kind, _payload, declared, step_sha = _declared_step(step)
        pre_dump: Any | None = None
        post_dump: Any | None = None
        capture_errors: list[str] = []
        try:
            pre_dump = await _capture(agent)
        except Exception as exc:
            capture_errors.append(f"pre:{type(exc).__name__}:{exc}")
        actual_hit = _actual_hit(pre_dump, declared) if pre_dump is not None else None
        outcome = "passed"
        raised: BaseException | None = None
        try:
            await original(agent, case_id, step, tool_log, step_idx=step_idx)
        except BaseException as exc:
            outcome = "failed"
            raised = exc
        try:
            post_dump = await _capture(agent)
        except Exception as exc:
            capture_errors.append(f"post:{type(exc).__name__}:{exc}")
        _events.append(
            {
                "case_id": case_id,
                "step_index": step_idx,
                "action_kind": action_kind,
                "step_sha256": step_sha,
                "declared_target": declared,
                "actual_hit": actual_hit,
                "pre_screen": _screen(pre_dump) if pre_dump is not None else None,
                "post_screen": _screen(post_dump) if post_dump is not None else None,
                "outcome": outcome,
                "capture_error": "; ".join(capture_errors) if capture_errors else None,
            }
        )
        if raised is not None:
            raise raised

    runner._execute_one_step = observed_execute_one_step


def _arg_value(name: str) -> str | None:
    try:
        index = sys.argv.index(name)
    except ValueError:
        return None
    if index + 1 >= len(sys.argv):
        return None
    return sys.argv[index + 1]


def _append_trace() -> None:
    trace_path = _arg_value("--trace-out")
    if not trace_path or not os.path.isfile(trace_path):
        return
    with open(trace_path, "r", encoding="utf-8") as handle:
        trace = json.load(handle)
    trace["runtime_step_telemetry"] = {
        "schema_version": SCHEMA_VERSION,
        "provider": {
            "id": "hylyre",
            "version": importlib.metadata.version("hylyre"),
            "collector": COLLECTOR,
            "collector_version": COLLECTOR_VERSION,
        },
        "goal_run_id": os.environ.get("MAISON_GOAL_RUN_ID", "standalone"),
        "attempt_id": os.environ.get("MAISON_GOAL_ATTEMPT", "standalone"),
        "device_target": {
            "serial": os.environ.get("HARNESS_HDC_TARGET") or None,
            "target_kind": os.environ.get("MAISON_DEVICE_TARGET_KIND") or None,
            "session_id": os.environ.get("MAISON_DEVICE_SESSION_ID") or None,
        },
        "steps": _events,
    }
    temporary = trace_path + ".runtime-telemetry.tmp"
    with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(trace, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, trace_path)


def main() -> None:
    _install_patch()
    exit_code = 0
    try:
        from hylyre.cli.__main__ import main as hylyre_main

        hylyre_main()
    except SystemExit as exc:
        exit_code = int(exc.code or 0)
    finally:
        _append_trace()
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()

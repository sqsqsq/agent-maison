"""Batch execution of planned JSON steps (CLI / session daemon / MCP)."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.api.failure_diag import capture_failure_boundary
from hylyre.cli.commands.loop_cmd import _session_ipc, _with_hypium_agent
from hylyre.scenario.ledger import (
    execute_ledger_step,
    planned_step_kind,
    planned_step_role,
    step_result_to_batch_row,
    toast_assertion_on_unsupported,
)
from hylyre.scenario.results import StepResult
from hylyre.scenario.step_builder import (
    batch_response,
    blocked_by_prior_step,
    build_step_result,
)


def _normalize_on_fail(raw: str) -> str:
    s = raw.strip().lower()
    if s in ("abort", "skip"):
        return s
    raise ValueError("on_fail must be abort or skip")


async def run_steps_on_agent(
    agent: HylyreAgent,
    steps: list[dict[str, Any]],
    on_fail: str = "abort",
    *,
    failure_dir: str | Path | None = None,
    artifact_base: str | Path | None = None,
) -> dict[str, Any]:
    """Execute planned JSON dicts sequentially; return structured per-step results."""
    mode = _normalize_on_fail(on_fail)
    results: list[dict[str, Any]] = []
    total = len(steps)
    t0_all = time.perf_counter()
    toast_probe: dict[str, Any] | None = None
    executed_count = 0

    if total == 0:
        return batch_response(
            {
                "total": 0,
                "executed": 0,
                "results": [],
                "on_fail": mode,
                "total_elapsed_ms": 0.0,
            }
        )

    for idx, raw in enumerate(steps):
        if not isinstance(raw, dict):
            raise TypeError(f"steps[{idx}] must be object, got {type(raw).__name__}")
        operation_attempted = False

        if toast_probe is not None and planned_step_kind(raw) == "assert_toast":
            # Capability proven missing before dispatch: blocked, or skipped
            # when the plan explicitly allows it. Never a failure of the
            # triggering action.
            from hylyre.scenario.runner import _toast_capability_outcome

            step_result = build_step_result(
                _toast_capability_outcome(
                    toast_probe,
                    skip=toast_assertion_on_unsupported(raw) == "skip",
                ),
                index=idx,
                kind=planned_step_kind(raw),
                role=planned_step_role(raw),
                device_session=agent.is_connected,
            )
            toast_probe = None
        else:
            if _batch_step_triggers_toast(steps, idx):
                from hylyre.scenario.runner import _probe_toast_listener

                toast_probe = await _probe_toast_listener(agent)
            operation_attempted = True
            step_result = await execute_ledger_step(
                agent,
                raw,
                index=idx,
                case_id=f"step-{idx}",
            )
        if operation_attempted:
            executed_count += 1
        failure = step_result.failure or {}
        if (
            step_result.status == "failed"
            and failure.get("domain") in ("selector", "assertion")
            and step_result.device_session
        ):
            artifacts, capture_error = await capture_failure_boundary(
                agent,
                failure_dir=failure_dir,
                label=f"step-{idx}",
                relative_to=artifact_base,
            )
            if artifacts:
                step_result = replace(
                    step_result, artifacts=tuple(a.to_dict() for a in artifacts)
                )
            else:
                step_result = replace(
                    step_result,
                    extensions={
                        **step_result.extensions,
                        "hylyre.capture": {
                            "screen": "unavailable",
                            "reason_code": _capture_reason_code(capture_error),
                            "detail": (capture_error or "capture unavailable")[:500],
                        },
                    },
                )
        results.append(step_result_to_batch_row(step_result, raw))
        if step_result.status in ("failed", "blocked") and mode == "abort":
            for blocked_idx in range(idx + 1, total):
                blocked = blocked_by_prior_step(
                    index=blocked_idx,
                    kind=planned_step_kind(steps[blocked_idx]),
                    role=planned_step_role(steps[blocked_idx]),
                    root_index=idx,
                )
                results.append(
                    step_result_to_batch_row(blocked, steps[blocked_idx])
                )
            return batch_response(
                {
                    "total": total,
                    "executed": executed_count,
                    "results": results,
                    "on_fail": mode,
                    "total_elapsed_ms": round(
                        (time.perf_counter() - t0_all) * 1000.0, 3
                    ),
                }
            )

    return batch_response(
        {
            "total": total,
            "executed": executed_count,
            "results": results,
            "on_fail": mode,
            "total_elapsed_ms": round((time.perf_counter() - t0_all) * 1000.0, 3),
        }
    )


def run_steps_fake(
    steps: list[dict[str, Any]],
    on_fail: str = "abort",
) -> dict[str, Any]:
    """Offline stub for a steps batch: same builder, same protocol, no device.

    ``--use-fakes`` used to be accepted and then ignored on this path, so the
    run silently connected to the first available device. Fake mode now has a
    real implementation here rather than a silent fallback.
    """

    from hylyre.scenario.runner import fake_step_outcome

    mode = _normalize_on_fail(on_fail)
    results: list[dict[str, Any]] = []
    total = len(steps)
    executed = 0
    root_index: int | None = None

    for idx, raw in enumerate(steps):
        if not isinstance(raw, dict):
            raise TypeError(f"steps[{idx}] must be object, got {type(raw).__name__}")
        kind = planned_step_kind(raw)
        role = planned_step_role(raw)

        if root_index is not None and mode == "abort":
            step_result = blocked_by_prior_step(
                index=idx, kind=kind, role=role, root_index=root_index
            )
        else:
            executed += 1
            step_result = build_step_result(
                fake_step_outcome(raw, kind=kind, role=role),
                index=idx,
                kind=kind,
                role=role,
                device_session=False,
            )
            if step_result.status in ("failed", "blocked") and root_index is None:
                root_index = idx
        results.append(step_result_to_batch_row(step_result, raw))

    return batch_response(
        {
            "total": total,
            "executed": executed,
            "results": results,
            "on_fail": mode,
            "total_elapsed_ms": 0.0,
        }
    )


def _batch_step_triggers_toast(
    steps: list[dict[str, Any]], index: int
) -> bool:
    if index + 1 >= len(steps):
        return False
    next_step = steps[index + 1]
    if "assert_toast" in next_step:
        return True
    action = next_step.get("action")
    return isinstance(action, dict) and action.get("type") == "assert_toast"


def load_steps_json_array(path: Path) -> list[dict[str, Any]]:
    raw = Path(path).read_text(encoding="utf-8")
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("--steps-file must contain a JSON array of step objects")
    return [dict(x) for x in parsed]  # type: ignore[arg-type]


def parse_steps_inline(json_str: str) -> list[dict[str, Any]]:
    parsed = json.loads(json_str)
    if not isinstance(parsed, list):
        raise ValueError("--steps must be a JSON array of step objects")
    return [dict(x) for x in parsed]  # type: ignore[arg-type]


def execute_run_steps(
    steps: list[dict[str, Any]],
    *,
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
    on_fail: str = "abort",
    bundle: str | None = None,
    page_name: str | None = None,
    wait_time: float = 1.0,
    params: str = "",
    failure_dir: str | Path | None = None,
    artifact_base: str | Path | None = None,
    use_fakes: bool = False,
) -> dict[str, Any]:
    """CLI/sync entry: offline stub, IPC session daemon, or ephemeral agent."""
    if use_fakes:
        if session_file is not None:
            # A session *is* a live device connection, so combining it with
            # fake mode has no coherent meaning. Say so instead of picking one.
            raise ValueError(
                "--use-fakes cannot be combined with --session: a session is a "
                "live device connection"
            )
        # Decided before any agent is constructed: fake never reaches a device.
        return run_steps_fake(steps, on_fail=on_fail)
    if session_file is not None:
        ipc_params: dict[str, Any] = {
            "steps": steps,
            "on_fail": on_fail,
            "bundle": bundle,
            "page_name": page_name,
            "wait_time": wait_time,
            "params": params,
        }
        if failure_dir is not None:
            ipc_params["failure_dir"] = str(Path(failure_dir).resolve())
        return _session_ipc(session_file, "run_steps", ipc_params)

    async def _go(agent: HylyreAgent) -> dict[str, Any]:
        if bundle:
            await agent.start_app(
                bundle,
                page_name=page_name,
                params=params or "",
                wait_time=wait_time,
            )
        return await run_steps_on_agent(
            agent,
            steps,
            on_fail=on_fail,
            failure_dir=failure_dir,
            artifact_base=artifact_base,
        )

    return asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )


def _capture_reason_code(capture_error: str | None) -> str:
    """Why the failure boundary could not be captured.

    Capture is always attempted now (entries resolve a default directory), so
    reaching here means the device or transport genuinely could not be read —
    the only case spec section 8.1 allows the escape hatch for.
    """

    _ = capture_error
    return "infrastructure.transport_failure"

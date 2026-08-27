"""Batch execution of planned JSON steps (CLI / session daemon / MCP)."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.api.exceptions import StepSkipped
from hylyre.api.failure_diag import capture_step_failure
from hylyre.api.step_dispatch import dispatch_planned_step
from hylyre.cli.commands.loop_cmd import _session_ipc, _with_hypium_agent


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
) -> dict[str, Any]:
    """Execute planned JSON dicts sequentially; return structured per-step results."""
    mode = _normalize_on_fail(on_fail)
    results: list[dict[str, Any]] = []
    total = len(steps)
    t0_all = time.perf_counter()

    if total == 0:
        return {
            "total": 0,
            "executed": 0,
            "results": [],
            "on_fail": mode,
            "total_elapsed_ms": 0.0,
        }

    for idx, raw in enumerate(steps):
        if not isinstance(raw, dict):
            raise TypeError(f"steps[{idx}] must be object, got {type(raw).__name__}")
        t0 = time.perf_counter()
        try:
            await dispatch_planned_step(agent, raw, case_id=f"step-{idx}")
            elapsed = (time.perf_counter() - t0) * 1000.0
            results.append(
                {
                    "index": idx,
                    "step": raw,
                    "status": "ok",
                    "elapsed_ms": round(elapsed, 3),
                }
            )
        except StepSkipped as e:
            elapsed = (time.perf_counter() - t0) * 1000.0
            results.append(
                {
                    "index": idx,
                    "step": raw,
                    "status": "skipped",
                    "error": str(e)[:4000],
                    "elapsed_ms": round(elapsed, 3),
                }
            )
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000.0
            diag = await capture_step_failure(
                agent, failure_dir=failure_dir, step_label=f"step-{idx}"
            )
            results.append(
                {
                    "index": idx,
                    "step": raw,
                    "status": "error",
                    "error": (str(e)[:4000] + diag)[:4000],
                    "elapsed_ms": round(elapsed, 3),
                    "diagnostics": diag.strip() or None,
                }
            )
            if mode == "abort":
                return {
                    "total": total,
                    "executed": len(results),
                    "results": results,
                    "on_fail": mode,
                    "total_elapsed_ms": round(
                        (time.perf_counter() - t0_all) * 1000.0, 3
                    ),
                }

    return {
        "total": total,
        "executed": len(results),
        "results": results,
        "on_fail": mode,
        "total_elapsed_ms": round((time.perf_counter() - t0_all) * 1000.0, 3),
    }


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
) -> dict[str, Any]:
    """CLI/sync entry: IPC session daemon or ephemeral Hypium agent."""
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
            agent, steps, on_fail=on_fail, failure_dir=failure_dir
        )

    return asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )

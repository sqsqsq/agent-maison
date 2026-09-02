"""Register Tier A MCP tools (mirror planned JSON steps)."""

from __future__ import annotations

from hylyre.scenario.step_builder import step_response

from collections.abc import Awaitable, Callable
import json
from pathlib import Path
from typing import Any

from hylyre.api.planned_step_keys import TIER_A_MCP_TOOL_SUFFIXES


def register_tier_a_mcp_tools(
    mcp: Any,
    *,
    loop_cmd: Any,
    _session_agent: Callable[[str], Any],
    _call_logged_async: Callable[
        [str, Callable[[], Awaitable[Any]]], Awaitable[Any]
    ],
) -> None:
    """Attach ``hylyre_run_<step>`` tools for each Tier A root key."""

    descriptions: dict[str, str] = {
        "back": "System / Nav stack back (planned JSON root back).",
        "home": "Home key / launcher (planned JSON root home).",
        "stop_app": "Stop app process (planned JSON root stop_app).",
        "clear_app": "Clear app data (planned JSON root clear_app).",
        "wait": "Fixed sleep seconds (planned JSON root wait).",
        "wait_for": "Wait for selector to appear (planned JSON root wait_for).",
        "wait_gone": "Wait for selector to disappear (planned JSON root wait_gone).",
        "wait_idle": "Wait for UI idle (planned JSON root wait_idle).",
        "assert_toast": "Assert toast text (planned JSON root assert_toast).",
        "scroll_to": "Scroll until target visible; optional tap (planned JSON root scroll_to).",
    }

    for suffix in TIER_A_MCP_TOOL_SUFFIXES:
        tool_name = f"hylyre_run_{suffix}"
        desc = descriptions.get(suffix, f"Planned JSON root {suffix}.")

        def _make_tool(name: str, description: str) -> None:
            @mcp.tool(name=name, description=description)
            async def _tool(
                payload: dict[str, Any],
                device_sn: str | None = None,
                session_id: str | None = None,
                mock_port: int | None = None,
                lyrebird_url: str | None = None,
                failure_dir: str | None = None,
            ) -> str:
                async def _run() -> str:
                    from hylyre.cli.commands import steps_cmd

                    # One atomic tool, one envelope. Routing through the batch
                    # runner when a failure_dir happened to be passed made the
                    # same tool return `total/results` instead of
                    # `result_protocol + step_result`, so a consumer could not
                    # typed-parse it without first guessing which shape it got.
                    fd = Path(failure_dir).resolve() if failure_dir else None
                    if session_id:
                        result = await loop_cmd._run_atomic_ledger_step(
                            _session_agent(session_id),
                            payload,
                            case_id="mcp-atomic-step",
                            failure_dir=fd,
                        )
                        return json.dumps(result, ensure_ascii=False)
                    import anyio

                    result = await anyio.to_thread.run_sync(
                        lambda: loop_cmd.execute_dispatch_planned_step(
                            payload=payload,
                            device_sn=device_sn,
                            mock_port=mock_port,
                            lyrebird_url=lyrebird_url,
                            failure_dir=fd,
                        )
                    )
                    return json.dumps(result, ensure_ascii=False)

                return await _call_logged_async(name, _run)

        _make_tool(tool_name, desc)

    @mcp.tool(
        name="hylyre_run_start_app_step",
        description="In-plan start_app JSON root (distinct from hylyre_start_app flags).",
    )
    async def hylyre_run_start_app_step(
        payload: dict[str, Any],
        device_sn: str | None = None,
        session_id: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                from hylyre.scenario.ledger import execute_ledger_step

                agent = _session_agent(session_id)
                result = await execute_ledger_step(
                    agent, payload, index=0, case_id="mcp-atomic-start-app"
                )
                return json.dumps(step_response(result), ensure_ascii=False)
            import anyio

            result = await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_dispatch_planned_step(
                    payload=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_start_app_step", _run)

"""FastMCP stdio server — curated atomic tools mapped to Hylyre CLI logic (P5)."""

from __future__ import annotations

from hylyre.scenario.step_builder import step_response

import base64
import json
import os
import sys
import time
import traceback
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

from hylyre.diagnostic_log import diagnostic_log as _mcp_log


@dataclass
class _McpSession:
    agent: Any  # HylyreAgent
    trace_state: dict[str, Any] | None = None


_T = TypeVar("_T")


async def _call_logged_async(
    tool_name: str, fn: Callable[[], Awaitable[_T]]
) -> _T:
    start = time.perf_counter()
    _mcp_log(f"tool_start name={tool_name}")
    try:
        result = await fn()
    except Exception:
        elapsed = time.perf_counter() - start
        _mcp_log(
            f"tool_error name={tool_name} elapsed_s={elapsed:.3f}\n"
            f"{traceback.format_exc()}"
        )
        raise
    elapsed = time.perf_counter() - start
    _mcp_log(f"tool_end name={tool_name} elapsed_s={elapsed:.3f}")
    return result


def _call_logged(tool_name: str, fn: Any, *args: Any, **kwargs: Any) -> Any:
    start = time.perf_counter()
    _mcp_log(f"tool_start name={tool_name}")
    try:
        result = fn(*args, **kwargs)
    except Exception:
        elapsed = time.perf_counter() - start
        _mcp_log(
            f"tool_error name={tool_name} elapsed_s={elapsed:.3f}\n"
            f"{traceback.format_exc()}"
        )
        raise
    elapsed = time.perf_counter() - start
    _mcp_log(f"tool_end name={tool_name} elapsed_s={elapsed:.3f}")
    return result


def build_mcp():  # type: ignore[no-untyped-def]
    """Construct FastMCP app with registered tools (lazy-imports fastmcp)."""
    _mcp_log("build_mcp start")
    from fastmcp import FastMCP

    from hylyre.cli.commands import ai_cmd, device, doctor, loop_cmd, mock_cmd, run_cmd
    from hylyre.progress import store as progress_store
    from hylyre.wiring import create_hypium_agent

    sessions: dict[str, _McpSession] = {}

    mcp = FastMCP(
        name="hylyre",
        instructions=(
            "Hylyre: HarmonyOS UI + Lyrebird mock testing. "
            "Safer CI path: hylyre_run_plan use_fakes=true. "
            "Agent-loop (no VLM): dump_ui / screenshot / run_* JSON "
            "(action tap input swipe scroll) + report_* . "
            "Batch known steps: hylyre_run_steps (list of planned JSON dicts in one call, "
            "reduces MCP round trips; prefer over repeated run_tap/run_swipe when steps are fixed). "
            "App knowledge: hylyre_find, hylyre_app_* page CRUD + hylyre_app_find / fingerprint. "
            "hylyre_open_session reuses Hypium for faster MCP loops; optional for parity with CLI."
        ),
    )

    def _session_agent(session_id: str) -> Any:
        sess = sessions.get(session_id)
        if sess is None:
            raise ValueError(f"unknown session_id {session_id!r}")
        return sess.agent

    async def _atomic_step_result(agent: Any, payload: dict[str, Any]) -> str:
        from hylyre.scenario.ledger import execute_ledger_step

        result = await execute_ledger_step(
            agent, payload, index=0, case_id="mcp-atomic-step"
        )
        return json.dumps(step_response(result), ensure_ascii=False)

    async def _live_ui_payload_full(
        *,
        session_id: str | None,
        session_path: str | None,
        device_sn: str | None,
    ) -> dict[str, Any]:
        """Augmented dump with full Hypium attrs (for save / find / fingerprint)."""
        from hylyre.ui_dump_filter import DumpFilterSpec, apply_ui_dump_filter

        modes = sum(bool(x) for x in (session_id, session_path, device_sn))
        if modes > 1:
            raise ValueError(
                "pass at most one of session_id, session_path, device_sn "
                "(omit device_sn when using MCP session_id)"
            )
        if modes == 0:
            raise ValueError(
                "pass exactly one of session_id, session_path, device_sn"
            )
        if session_id:
            agent = _session_agent(session_id)
            payload = await agent.dump_ui()
            return apply_ui_dump_filter(payload, DumpFilterSpec(full=True))
        import anyio

        sess = Path(session_path) if session_path else None

        def _sync_dump() -> dict[str, Any]:
            return loop_cmd.execute_dump_ui_dict(
                device_sn=device_sn,
                session_file=sess,
                dump_filter=DumpFilterSpec(full=True),
            )

        return await anyio.to_thread.run_sync(_sync_dump)

    @mcp.tool(
        name="hylyre_run_plan",
        description=(
            "Execute test-plan.md → test-report.md + trace.json; runs L5 verify. "
            "Set use_fakes=true for stubbed runs without a device."
        ),
    )
    def hylyre_run_plan(
        plan_path: str,
        feature: str,
        report_out: str,
        trace_out: str,
        use_fakes: bool = False,
        device_sn: str | None = None,
        bundle: str | None = None,
        page_name: str | None = None,
        wait_time: float = 1.0,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
        mock_group: str | None = None,
        skip_assert_expected: bool = False,
        model_backend: str | None = None,
        failure_dir: str | None = None,
    ) -> str:
        def _run() -> str:
            fd = Path(failure_dir) if failure_dir else None
            return run_cmd.execute_scenario(
                plan=Path(plan_path),
                feature=feature,
                report_out=Path(report_out),
                trace_out=Path(trace_out),
                use_fakes=use_fakes,
                device_sn=device_sn,
                bundle=bundle,
                page_name=page_name,
                wait_time=wait_time,
                mock_port=mock_port,
                lyrebird_url=lyrebird_url,
                mock_group=mock_group,
                skip_assert_expected=skip_assert_expected,
                model_backend=model_backend,
                failure_dir=fd,
            )

        return _call_logged("hylyre_run_plan", _run)

    @mcp.tool(
        name="hylyre_report_verify",
        description=(
            "Validate test-report.md + trace.json (L5 harness). "
            "plan_path optional for ad-hoc traces."
        ),
    )
    def hylyre_report_verify(
        report_path: str,
        trace_path: str,
        plan_path: str | None = None,
    ) -> str:
        def _run() -> str:
            plan_arg = Path(plan_path) if plan_path else None
            details = run_cmd.execute_report_verify(
                report=Path(report_path),
                trace=Path(trace_path),
                plan=plan_arg,
            )
            return f"Contracts OK ({details['label']})"

        return _call_logged("hylyre_report_verify", _run)

    @mcp.tool(
        name="hylyre_open_session",
        description=(
            "MCP-only: keep Hypium agent connection open (mock optional). "
            "Pass session_id to screenshot/dump/run/report tools."
        ),
    )
    async def hylyre_open_session(
        device_sn: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            _mcp_log(f"open_session enter device_sn={device_sn}")
            t0 = time.perf_counter()
            agent = create_hypium_agent(
                device_sn=device_sn,
                vlm=None,
                mock_port=mock_port,
                lyrebird_base_url=lyrebird_url,
            )
            _mcp_log(f"open_session agent_created {time.perf_counter()-t0:.2f}s")
            await agent.ensure_connected()
            _mcp_log(f"open_session connected {time.perf_counter()-t0:.2f}s")
            sid = str(uuid.uuid4())
            sessions[sid] = _McpSession(agent=agent, trace_state=None)
            _mcp_log(f"open_session done sid={sid} {time.perf_counter()-t0:.2f}s")
            return json.dumps({"session_id": sid})

        return await _call_logged_async("hylyre_open_session", _run)

    @mcp.tool(
        name="hylyre_close_session",
        description="Close MCP session opened by hylyre_open_session.",
    )
    async def hylyre_close_session(session_id: str) -> str:
        async def _run() -> str:
            sess = sessions.pop(session_id, None)
            if sess is None:
                raise ValueError(f"unknown session_id {session_id!r}")
            await sess.agent.aclose()
            return "ok"

        return await _call_logged_async("hylyre_close_session", _run)

    @mcp.tool(
        name="hylyre_screenshot",
        description=(
            "Device screenshot bytes as base64 ({mime, base64}). "
            "session_id uses persistent agent; else one-shot via device_sn."
        ),
    )
    async def hylyre_screenshot(
        device_sn: str | None = None,
        session_id: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                raw = await agent.ui.screenshot()
            else:
                import anyio

                _mime, raw = await anyio.to_thread.run_sync(
                    lambda: loop_cmd.execute_screenshot_bytes(device_sn=device_sn)
                )
            mime = "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else "image/png"
            payload = {
                "mime": mime,
                "base64": base64.standard_b64encode(raw).decode("ascii"),
            }
            return json.dumps(payload)

        return await _call_logged_async("hylyre_screenshot", _run)

    @mcp.tool(
        name="hylyre_dump_ui",
        description=(
            "Hypium UiTree JSON for non-multimodal planners; "
            "session_id or device_sn. Default minimal attrs; use full=true for raw."
        ),
    )
    async def hylyre_dump_ui(
        device_sn: str | None = None,
        session_id: str | None = None,
        filter_text: str | None = None,
        filter_id: str | None = None,
        filter_key: str | None = None,
        keep_clickable: bool = False,
        keep_scrollable: bool = False,
        max_depth: int | None = None,
        keep_attrs: str | None = None,
        prune_attrs: str | None = None,
        full: bool = False,
        summary: bool = False,
    ) -> str:
        async def _run() -> str:
            from hylyre.ui_dump_filter import DumpFilterSpec, apply_ui_dump_filter

            kattrs = (
                frozenset(x.strip() for x in keep_attrs.split(",") if x.strip())
                if keep_attrs
                else frozenset()
            )
            pattrs = (
                frozenset(x.strip() for x in prune_attrs.split(",") if x.strip())
                if prune_attrs
                else frozenset()
            )
            spec = DumpFilterSpec(
                filter_text=filter_text,
                filter_id=filter_id,
                filter_key=filter_key,
                keep_clickable=keep_clickable,
                keep_scrollable=keep_scrollable,
                max_depth=max_depth,
                keep_attrs=kattrs,
                prune_attrs=pattrs,
                full=full,
                summary=summary,
            )
            if session_id:
                agent = _session_agent(session_id)
                tree = await agent.dump_ui()
                tree = apply_ui_dump_filter(tree, spec)
            else:
                import anyio

                tree = await anyio.to_thread.run_sync(
                    lambda: loop_cmd.execute_dump_ui_dict(
                        device_sn=device_sn, dump_filter=spec
                    )
                )
            return json.dumps(tree, ensure_ascii=False)

        return await _call_logged_async("hylyre_dump_ui", _run)

    @mcp.tool(
        name="hylyre_start_app",
        description="Hypium start_app (atomic); optional MCP session_id.",
    )
    async def hylyre_start_app(
        bundle: str,
        device_sn: str | None = None,
        session_id: str | None = None,
        page_name: str | None = None,
        params: str = "",
        wait_time: float = 1.0,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                await agent.start_app(
                    bundle,
                    page_name=page_name,
                    params=params,
                    wait_time=wait_time,
                )
                return "ok"
            import anyio

            await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_start_app(
                    bundle=bundle,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                    page_name=page_name,
                    params=params,
                    wait_time=wait_time,
                )
            )
            return "ok"

        return await _call_logged_async("hylyre_start_app", _run)

    @mcp.tool(
        name="hylyre_run_action",
        description='One planned JSON step root key "action" (no VLM).',
    )
    async def hylyre_run_action(
        payload: dict[str, Any],
        device_sn: str | None = None,
        session_id: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                return await _atomic_step_result(agent, payload)
            import anyio

            result = await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_run_action(
                    payload=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_action", _run)

    @mcp.tool(
        name="hylyre_run_tap",
        description='One planned tap JSON root key "touch" (no VLM).',
    )
    async def hylyre_run_tap(
        payload: dict[str, Any],
        device_sn: str | None = None,
        session_id: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                return await _atomic_step_result(agent, payload)
            import anyio

            result = await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_run_tap(
                    payload=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_tap", _run)

    @mcp.tool(
        name="hylyre_run_input",
        description='One planned input JSON root key "input" (no VLM).',
    )
    async def hylyre_run_input(
        payload: dict[str, Any],
        device_sn: str | None = None,
        session_id: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                return await _atomic_step_result(agent, payload)
            import anyio

            result = await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_run_input(
                    payload=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_input", _run)

    @mcp.tool(
        name="hylyre_run_swipe",
        description=(
            "Hypium swipe JSON root swipe (UP/DOWN/LEFT/RIGHT); "
            "half-modal lists need area.by_type Scroll."
        ),
    )
    async def hylyre_run_swipe(
        payload: dict[str, Any],
        device_sn: str | None = None,
        session_id: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                return await _atomic_step_result(agent, payload)
            import anyio

            result = await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_run_swipe(
                    payload=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_swipe", _run)

    @mcp.tool(
        name="hylyre_run_scroll",
        description=(
            "Hypium mouse_scroll JSON scroll (up/down, steps); "
            "modal lists prefer at.by_type Scroll."
        ),
    )
    async def hylyre_run_scroll(
        payload: dict[str, Any],
        device_sn: str | None = None,
        session_id: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
    ) -> str:
        async def _run() -> str:
            if session_id:
                agent = _session_agent(session_id)
                return await _atomic_step_result(agent, payload)
            import anyio

            result = await anyio.to_thread.run_sync(
                lambda: loop_cmd.execute_run_scroll(
                    payload=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_scroll", _run)

    @mcp.tool(
        name="hylyre_run_steps",
        description=(
            "Run multiple planned JSON steps (same root keys as run_tap/run_swipe/input/..."
            ") in one call to cut MCP latency. Exactly one of session_id, "
            "session_path, device_sn; optional bundle+page_name to start_app first."
        ),
    )
    async def hylyre_run_steps(
        steps: list[dict[str, Any]],
        session_id: str | None = None,
        session_path: str | None = None,
        device_sn: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
        on_fail: str = "abort",
        bundle: str | None = None,
        page_name: str | None = None,
        wait_time: float = 1.0,
        params: str = "",
        feature: str | None = None,
        report_out: str | None = None,
        trace_out: str | None = None,
        steps_path: str | None = None,
        model_backend: str | None = None,
        failure_dir: str | None = None,
    ) -> str:
        from hylyre.cli.commands import steps_cmd

        async def _run() -> str:
            fd = Path(failure_dir).resolve() if failure_dir else None
            if feature or report_out or trace_out:
                if not (feature and report_out and trace_out):
                    raise ValueError(
                        "report mode requires feature, report_out, and trace_out"
                    )
                sp = Path(steps_path) if steps_path else Path("<mcp-steps>")
                import anyio

                msg, _ = await anyio.to_thread.run_sync(
                    lambda: run_cmd.execute_steps_scenario(
                        steps_path=sp,
                        steps=[dict(x) for x in steps],
                        feature=feature,
                        report_out=Path(report_out),
                        trace_out=Path(trace_out),
                        device_sn=device_sn,
                        bundle=bundle,
                        page_name=page_name,
                        wait_time=wait_time,
                        params=params,
                        mock_port=mock_port,
                        lyrebird_url=lyrebird_url,
                        session_file=Path(session_path) if session_path else None,
                        on_fail=on_fail,
                        model_backend=model_backend,
                        failure_dir=fd,
                    )
                )
                return msg
            modes = sum(bool(x) for x in (session_id, session_path, device_sn))
            if modes != 1:
                raise ValueError(
                    "pass exactly one of session_id, session_path, device_sn"
                )
            if not isinstance(steps, list):
                raise ValueError("steps must be a list")

            normalized: list[dict[str, Any]] = []
            for i, raw in enumerate(steps):
                if not isinstance(raw, dict):
                    raise ValueError(f"steps[{i}] must be object")
                normalized.append(dict(raw))

            if session_id:
                agent = _session_agent(session_id)
                if bundle:
                    await agent.start_app(
                        str(bundle),
                        page_name=page_name,
                        params=params,
                        wait_time=float(wait_time),
                    )
                out = await steps_cmd.run_steps_on_agent(
                    agent, normalized, on_fail=on_fail, failure_dir=fd
                )
                return json.dumps(out, ensure_ascii=False)

            import anyio

            sess = Path(session_path) if session_path else None
            result = await anyio.to_thread.run_sync(
                lambda ns=normalized, ds=device_sn: steps_cmd.execute_run_steps(
                    ns,
                    device_sn=ds,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                    session_file=sess,
                    on_fail=on_fail,
                    bundle=bundle,
                    page_name=page_name,
                    wait_time=wait_time,
                    params=params,
                    failure_dir=fd,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_run_steps", _run)

    @mcp.tool(
        name="hylyre_report_begin",
        description=(
            "Start incremental trace dict (draft schema). "
            "Optional session_id stores state on MCP session."
        ),
    )
    def hylyre_report_begin(
        feature: str,
        plan_path: str | None = None,
        model_backend: str = "none",
        session_id: str | None = None,
    ) -> str:
        def _run() -> str:
            pp = Path(plan_path) if plan_path else None
            state = run_cmd.execute_report_begin(
                feature=feature,
                trace_path=None,
                plan_path=pp,
                trace_state=None,
                model_backend=model_backend,
            )
            if session_id:
                sess = sessions.get(session_id)
                if sess is None:
                    raise ValueError(f"unknown session_id {session_id!r}")
                sess.trace_state = state
            return json.dumps(state, ensure_ascii=False)

        return _call_logged("hylyre_report_begin", _run)

    @mcp.tool(
        name="hylyre_report_record",
        description="Append one case to trace_state dict (pass JSON or use session_id).",
    )
    def hylyre_report_record(
        case_id: str,
        name: str,
        priority: str,
        ac_ref: str,
        status: str,
        notes: str = "",
        trace_state: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> str:
        def _run() -> str:
            effective_dict: dict[str, Any] | None = trace_state
            if session_id:
                sess = sessions.get(session_id)
                if sess is None:
                    raise ValueError(f"unknown session_id {session_id!r}")
                effective_dict = (
                    sess.trace_state if trace_state is None else trace_state
                )
            if effective_dict is None:
                raise ValueError(
                    "Provide trace_state dict or session_id with prior begin"
                )
            updated = run_cmd.execute_report_record(
                trace_path=None,
                trace_state=effective_dict,
                case_id=case_id,
                name=name,
                priority=priority,
                ac_ref=ac_ref,
                status=status,
                notes=notes,
            )
            if session_id:
                sessions[session_id].trace_state = updated
            return json.dumps(updated, ensure_ascii=False)

        return _call_logged("hylyre_report_record", _run)

    @mcp.tool(
        name="hylyre_report_finalize",
        description="Write report.md + final trace.json + L5 verify from trace_state.",
    )
    def hylyre_report_finalize(
        report_out: str,
        trace_out: str,
        trace_state: dict[str, Any] | None = None,
        session_id: str | None = None,
        plan_path: str | None = None,
        model_backend: str | None = None,
    ) -> str:
        def _run() -> str:
            effective_finalize = trace_state
            if session_id:
                sess = sessions.get(session_id)
                if sess is None:
                    raise ValueError(f"unknown session_id {session_id!r}")
                effective_finalize = (
                    sess.trace_state if trace_state is None else trace_state
                )
            if effective_finalize is None:
                raise ValueError(
                    "Provide trace_state or session_id with recorded cases"
                )
            pp = Path(plan_path) if plan_path else None
            return run_cmd.execute_report_finalize(
                trace_path=None,
                trace_state=effective_finalize,
                plan_path=pp,
                report_out=Path(report_out),
                trace_out=Path(trace_out),
                model_backend=model_backend,
            )

        return _call_logged("hylyre_report_finalize", _run)

    @mcp.tool(
        name="hylyre_device_list",
        description="List hdc device serials (requires hdc on PATH).",
    )
    def hylyre_device_list() -> str:
        return _call_logged(
            "hylyre_device_list",
            lambda: device.format_device_list_text(),
        )

    @mcp.tool(
        name="hylyre_doctor",
        description="Environment readiness: Python, node, npm, hdc, mitmproxy, lyrebird.",
    )
    def hylyre_doctor() -> str:
        def _run() -> str:
            rows = doctor.gather_doctor_checks()
            return doctor.format_doctor_plain(rows)

        return _call_logged("hylyre_doctor", _run)

    @mcp.tool(
        name="hylyre_ai_action",
        description="One VLM-planned UI action (needs HYLYRE_VLM_* + hylyre[device]).",
    )
    def hylyre_ai_action(instruction: str, device_sn: str | None = None) -> str:
        return _call_logged(
            "hylyre_ai_action",
            lambda: ai_cmd.execute_ai_action(
                device_sn=device_sn, instruction=instruction
            ),
        )

    @mcp.tool(
        name="hylyre_ai_query",
        description=(
            "VLM visual query; schema is string|number|boolean. "
            "Returns answer text."
        ),
    )
    def hylyre_ai_query(
        instruction: str,
        device_sn: str | None = None,
        schema: str = "string",
    ) -> str:
        return _call_logged(
            "hylyre_ai_query",
            lambda: ai_cmd.execute_ai_query(
                device_sn=device_sn, instruction=instruction, schema=schema
            ),
        )

    @mcp.tool(
        name="hylyre_ai_assert",
        description="VLM assertion on current screen; raises if condition fails.",
    )
    def hylyre_ai_assert(instruction: str, device_sn: str | None = None) -> str:
        return _call_logged(
            "hylyre_ai_assert",
            lambda: ai_cmd.execute_ai_assert(
                device_sn=device_sn, instruction=instruction
            ),
        )

    @mcp.tool(
        name="hylyre_mock_activate",
        description="Activate Lyrebird mock group UUID against admin API base URL.",
    )
    def hylyre_mock_activate(
        group_id: str,
        lyrebird_url: str | None = None,
    ) -> str:
        return _call_logged(
            "hylyre_mock_activate",
            lambda: mock_cmd.execute_mock_activate(group_id, lyrebird_url),
        )

    @mcp.tool(
        name="hylyre_collect_list",
        description=(
            "Swipe UP inside scroll area (default by_type Scroll); merge Text rows. "
            "Half-modal sheets already start at top: do NOT pass reset_to_top or "
            "bidirectional unless you intentionally need DOWN sweeps. "
            "If hints lack likely_more_content_below, the list likely fits the viewport. "
            "session_id, session_path, or device_sn."
        ),
    )
    async def hylyre_collect_list(
        session_id: str | None = None,
        session_path: str | None = None,
        device_sn: str | None = None,
        mock_port: int | None = None,
        lyrebird_url: str | None = None,
        scroll_by_type: str | None = None,
        scroll_by_text: str | None = None,
        scroll_by_id: str | None = None,
        scroll_by_key: str | None = None,
        item_pattern: str | None = None,
        max_scrolls: int = 10,
        swipe_distance: int = 60,
        max_stable_rounds: int = 2,
        reset_to_top: bool = False,
        bidirectional: bool = False,
        early_bounce_break: bool = True,
    ) -> str:
        from hylyre.cli.commands import collect_cmd

        async def _run() -> str:
            modes = sum(bool(x) for x in (session_id, session_path, device_sn))
            if modes > 1:
                raise ValueError(
                    "pass at most one of session_id, session_path, device_sn "
                    "(omit device_sn when using MCP session_id)"
                )

            payload = {
                "scroll_by_type": scroll_by_type,
                "scroll_by_text": scroll_by_text,
                "scroll_by_id": scroll_by_id,
                "scroll_by_key": scroll_by_key,
                "item_pattern": item_pattern,
                "max_scrolls": max_scrolls,
                "swipe_distance": swipe_distance,
                "max_stable_rounds": max_stable_rounds,
                "reset_to_top": reset_to_top,
                "bidirectional": bidirectional,
                "early_bounce_break": early_bounce_break,
            }

            if session_id:
                agent = _session_agent(session_id)
                result = await collect_cmd.collect_list_on_agent(agent, payload)
                return json.dumps(result, ensure_ascii=False)

            import anyio

            sess = Path(session_path) if session_path else None
            result = await anyio.to_thread.run_sync(
                lambda: collect_cmd.execute_collect_list(
                    params=payload,
                    device_sn=device_sn,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                    session_file=sess,
                )
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_collect_list", _run)

    @mcp.tool(
        name="hylyre_find",
        description=(
            "Flat search on live UI dump (max 50). "
            "Returns JSON hits plus root _hylyre_hints (scroll signals). "
            "Pass session_id, session_path, or device_sn; "
            "plus by_text and/or by_id_pattern/by_key_pattern."
        ),
    )
    async def hylyre_find(
        session_id: str | None = None,
        session_path: str | None = None,
        device_sn: str | None = None,
        by_text: str | None = None,
        by_id_pattern: str | None = None,
        by_key_pattern: str | None = None,
        limit: int = 50,
    ) -> str:
        from hylyre.cli.commands.find_cmd import find_in_payload

        async def _run() -> str:
            if not any((by_text, by_id_pattern, by_key_pattern)):
                raise ValueError(
                    "pass at least one of by_text, by_id_pattern, by_key_pattern"
                )
            payload = await _live_ui_payload_full(
                session_id=session_id,
                session_path=session_path,
                device_sn=device_sn,
            )
            result = find_in_payload(
                payload,
                by_text=by_text,
                by_id_pattern=by_id_pattern,
                by_key_pattern=by_key_pattern,
                limit=limit,
            )
            return json.dumps(result, ensure_ascii=False)

        return await _call_logged_async("hylyre_find", _run)

    @mcp.tool(
        name="hylyre_app_page_save",
        description=(
            "Save named UI page snapshot + refresh bundle index. "
            "from_dump path XOR session_id/session_path/device_sn."
        ),
    )
    async def hylyre_app_page_save(
        bundle: str,
        name: str,
        store_dir: str | None = None,
        ability_name: str | None = None,
        app_version: str | None = None,
        from_dump: str | None = None,
        session_id: str | None = None,
        session_path: str | None = None,
        device_sn: str | None = None,
        auto_fingerprint: bool = False,
    ) -> str:
        from hylyre.app_store.page_store import save_page_snapshot
        from hylyre.app_store.paths import resolve_write_dir

        async def _run() -> str:
            if from_dump:
                if any((session_id, session_path, device_sn)):
                    raise ValueError(
                        "from_dump is mutually exclusive with "
                        "session_id/session_path/device_sn"
                    )
                payload = json.loads(Path(from_dump).read_text(encoding="utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("from_dump JSON must be an object")
            else:
                payload = await _live_ui_payload_full(
                    session_id=session_id,
                    session_path=session_path,
                    device_sn=device_sn,
                )
            write_root = resolve_write_dir(store_dir)
            path = save_page_snapshot(
                store_dir=write_root,
                bundle=bundle,
                page_name=name,
                tree_payload=payload,
                ability_name=ability_name,
                app_version=app_version,
                auto_fingerprint=auto_fingerprint,
            )
            return json.dumps({"path": str(path.resolve())}, ensure_ascii=False)

        return await _call_logged_async("hylyre_app_page_save", _run)

    @mcp.tool(
        name="hylyre_app_page_load",
        description="Load saved page snapshot JSON (searches store dirs until found).",
    )
    def hylyre_app_page_load(
        bundle: str,
        name: str,
        store_dir: str | None = None,
    ) -> str:
        from hylyre.app_store.page_store import load_page_snapshot
        from hylyre.app_store.paths import resolve_read_dirs

        def _run() -> str:
            last_err: Exception | None = None
            for d in resolve_read_dirs(store_dir):
                try:
                    snap = load_page_snapshot(d, bundle, name)
                    return json.dumps(snap, ensure_ascii=False)
                except FileNotFoundError as e:
                    last_err = e
                    continue
            raise FileNotFoundError(str(last_err or "snapshot not found"))

        return _call_logged("hylyre_app_page_load", _run)

    @mcp.tool(
        name="hylyre_app_page_list",
        description="List saved page slugs for bundle (union across readable store dirs).",
    )
    def hylyre_app_page_list(
        bundle: str,
        store_dir: str | None = None,
    ) -> str:
        from hylyre.app_store.page_store import list_page_snapshots
        from hylyre.app_store.paths import resolve_read_dirs

        def _run() -> str:
            names: set[str] = set()
            for d in resolve_read_dirs(store_dir):
                names.update(list_page_snapshots(d, bundle))
            return json.dumps(sorted(names), ensure_ascii=False)

        return _call_logged("hylyre_app_page_list", _run)

    @mcp.tool(
        name="hylyre_app_page_diff",
        description=(
            "Compare saved page fingerprint vs live dump or JSON file. "
            "against=current needs session_id/session_path/device_sn."
        ),
    )
    async def hylyre_app_page_diff(
        bundle: str,
        name: str,
        against: str = "current",
        session_id: str | None = None,
        session_path: str | None = None,
        device_sn: str | None = None,
        store_dir: str | None = None,
    ) -> str:
        from hylyre.app_store.page_store import diff_snapshots, load_page_snapshot
        from hylyre.app_store.paths import resolve_read_dirs

        async def _run() -> str:
            snap = None
            for d in resolve_read_dirs(store_dir):
                try:
                    snap = load_page_snapshot(d, bundle, name)
                    break
                except FileNotFoundError:
                    continue
            if snap is None:
                raise FileNotFoundError("snapshot not found")
            if against == "current":
                cur = await _live_ui_payload_full(
                    session_id=session_id,
                    session_path=session_path,
                    device_sn=device_sn,
                )
            else:
                cur_raw = json.loads(Path(against).read_text(encoding="utf-8"))
                if not isinstance(cur_raw, dict):
                    raise ValueError("against file must be a JSON object")
                cur = cur_raw
            out = diff_snapshots(snap, cur)
            return json.dumps(out, ensure_ascii=False)

        return await _call_logged_async("hylyre_app_page_diff", _run)

    @mcp.tool(
        name="hylyre_app_page_delete",
        description="Delete saved page snapshot and prune bundle index (write dir only).",
    )
    def hylyre_app_page_delete(
        bundle: str,
        name: str,
        store_dir: str | None = None,
    ) -> str:
        from hylyre.app_store.page_store import delete_page_snapshot
        from hylyre.app_store.paths import resolve_write_dir

        def _run() -> str:
            delete_page_snapshot(resolve_write_dir(store_dir), bundle, name)
            return json.dumps({"status": "ok"}, ensure_ascii=False)

        return _call_logged("hylyre_app_page_delete", _run)

    @mcp.tool(
        name="hylyre_app_find",
        description=(
            "Search merged bundle index across readable dirs "
            "(by_text substring / by_id_pattern regex)."
        ),
    )
    def hylyre_app_find(
        bundle: str,
        by_text: str | None = None,
        by_id_pattern: str | None = None,
        store_dir: str | None = None,
    ) -> str:
        from hylyre.app_store.cross_find import search_all_indexes

        def _run() -> str:
            hits = search_all_indexes(
                bundle,
                by_text=by_text,
                by_id_pattern=by_id_pattern,
                store_dir=store_dir,
            )
            return json.dumps(hits, ensure_ascii=False)

        return _call_logged("hylyre_app_find", _run)

    @mcp.tool(
        name="hylyre_app_fingerprint",
        description=(
            "SHA256 fingerprint from structural (type,id,key) triples. "
            "from_dump XOR session_id/session_path/device_sn."
        ),
    )
    async def hylyre_app_fingerprint(
        from_dump: str | None = None,
        session_id: str | None = None,
        session_path: str | None = None,
        device_sn: str | None = None,
    ) -> str:
        from hylyre.app_store.fingerprint import compute_ui_fingerprint

        async def _run() -> str:
            if from_dump:
                if any((session_id, session_path, device_sn)):
                    raise ValueError(
                        "from_dump is mutually exclusive with "
                        "session_id/session_path/device_sn"
                    )
                payload = json.loads(Path(from_dump).read_text(encoding="utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("from_dump JSON must be an object")
            else:
                payload = await _live_ui_payload_full(
                    session_id=session_id,
                    session_path=session_path,
                    device_sn=device_sn,
                )
            tree = payload.get("tree")
            if not isinstance(tree, dict):
                raise ValueError("payload missing tree dict")
            fp, lines = compute_ui_fingerprint(tree)
            return json.dumps({"fingerprint": fp, "inputs": lines}, ensure_ascii=False)

        return await _call_logged_async("hylyre_app_fingerprint", _run)

    @mcp.tool(
        name="hylyre_progress_show",
        description="Tail of docs/progress.md from repo root (cwd). Default last 120 lines.",
    )
    def hylyre_progress_show(tail_lines: int = 120) -> str:
        return _call_logged(
            "hylyre_progress_show",
            lambda: progress_store.format_progress_excerpt(tail_lines=tail_lines),
        )

    try:
        from hylyre.app_store.paths import resolve_write_dir

        _wd = resolve_write_dir(None)
        _mcp_log(f"app_store write_dir={_wd}")
        _cwd = Path.cwd()
        if Path.home() in _wd.resolve().parents and not (_cwd / "pyproject.toml").is_file():
            _mcp_log(
                f"app_store_warning cwd={_cwd} not a Hylyre repo root; "
                "snapshots may land under home. Set HYLYRE_APP_STORE_DIR or "
                "point Cursor MCP cwd at the Hylyre checkout (see docs/cursor-mcp-setup.md)."
            )
    except Exception as e:
        _mcp_log(f"app_store_probe_failed {e}")

    from hylyre.mcp.tier_a_tools import register_tier_a_mcp_tools

    register_tier_a_mcp_tools(
        mcp,
        loop_cmd=loop_cmd,
        _session_agent=_session_agent,
        _call_logged_async=_call_logged_async,
    )

    _mcp_log("build_mcp end")
    return mcp


def serve_stdio(*, show_banner: bool = False) -> None:
    """Run MCP over stdio (Cursor / Claude Desktop).

    Important: stdio transport reserves ``sys.stdout`` for JSON-RPC protocol
    framing. Anything written there breaks the client. We must:

    1. Pre-import Hypium so its xdevice ``StreamHandler(sys.stdout)`` binds to
       a safe sink. Lazy import inside an MCP tool is *unsafe* — once stdio
       transport rebinds stdout, ``StreamHandler.addHandler`` can deadlock
       against MCP's anyio reader.
    2. Temporarily redirect ``sys.stdout`` -> ``sys.stderr`` during the import
       so any handlers Hypium captures already point at stderr.
    3. After the eager import, scrub any handler that still points at the
       original real stdout.
    """
    _mcp_log(f"serve_stdio start show_banner={show_banner}")

    import logging

    real_stdout = sys.stdout
    real_stdout_buffer = getattr(real_stdout, "buffer", None)
    sys.stdout = sys.stderr
    try:
        _mcp_log("eager_hypium_import start (stdout->stderr)")
        from hylyre.drivers.hypium.driver import load_hypium_shim

        load_hypium_shim()
        _mcp_log("eager_hypium_import done")
    except ImportError as e:
        _mcp_log(f"eager_hypium_import skipped (not installed): {e}")
    except Exception as e:  # pragma: no cover - defensive
        _mcp_log(f"eager_hypium_import failed: {e}")
    finally:
        sys.stdout = real_stdout

    # Belt-and-braces: rewrite any logging StreamHandler still bound to the real
    # stdout (or its buffer) over to stderr, so future Hypium logs never touch
    # the JSON-RPC channel.
    def _rebind_handler(h: logging.Handler) -> None:
        try:
            stream = getattr(h, "stream", None)
            if stream is real_stdout or (
                real_stdout_buffer is not None
                and getattr(stream, "buffer", None) is real_stdout_buffer
            ):
                h.stream = sys.stderr  # type: ignore[attr-defined]
                _mcp_log(f"rebound_handler {h!r} -> stderr")
        except Exception:
            pass

    try:
        for h in list(logging.getLogger().handlers):
            _rebind_handler(h)
        for name in list(logging.Logger.manager.loggerDict):
            lg = logging.getLogger(name)
            for h in list(getattr(lg, "handlers", []) or []):
                _rebind_handler(h)
    except Exception as e:  # pragma: no cover
        _mcp_log(f"rebind_handlers_failed: {e}")

    mcp = build_mcp()
    try:
        mcp.run(transport="stdio", show_banner=show_banner)
    finally:
        _mcp_log("serve_stdio stop")

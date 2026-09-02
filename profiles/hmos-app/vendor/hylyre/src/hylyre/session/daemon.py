"""Async TCP JSON-line server holding one connected HylyreAgent."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.wiring import create_hypium_agent


async def _dispatch(agent: HylyreAgent, method: str, params: dict[str, Any]) -> Any:
    if method == "ping":
        return {"pong": True}
    if method == "shutdown":
        await agent.aclose()
        return {"shutdown": True}
    if method == "dump_ui":
        return await agent.dump_ui()
    if method == "screenshot_bytes":
        import base64

        raw = await agent.ui.screenshot()
        mime = "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else "image/png"
        return {
            "mime": mime,
            "base64": base64.standard_b64encode(raw).decode("ascii"),
        }
    if method == "start_app":
        await agent.start_app(
            str(params["bundle"]),
            page_name=params.get("page_name"),
            params=str(params.get("params") or ""),
            wait_time=float(params.get("wait_time") or 1.0),
        )
        return "ok"
    if method == "run_action":
        from hylyre.scenario.ledger import execute_ledger_step
        from hylyre.scenario.step_builder import step_response

        return step_response(
            await execute_ledger_step(
                agent, dict(params["payload"]), index=0, case_id="atomic-step"
            )
        )
    if method == "run_tap":
        from hylyre.scenario.ledger import execute_ledger_step
        from hylyre.scenario.step_builder import step_response

        return step_response(
            await execute_ledger_step(
                agent, dict(params["payload"]), index=0, case_id="atomic-step"
            )
        )
    if method == "run_input":
        from hylyre.scenario.ledger import execute_ledger_step
        from hylyre.scenario.step_builder import step_response

        return step_response(
            await execute_ledger_step(
                agent, dict(params["payload"]), index=0, case_id="atomic-step"
            )
        )
    if method == "run_swipe":
        from hylyre.scenario.ledger import execute_ledger_step
        from hylyre.scenario.step_builder import step_response

        return step_response(
            await execute_ledger_step(
                agent, dict(params["payload"]), index=0, case_id="atomic-step"
            )
        )
    if method == "run_scroll":
        from hylyre.scenario.ledger import execute_ledger_step
        from hylyre.scenario.step_builder import step_response

        return step_response(
            await execute_ledger_step(
                agent, dict(params["payload"]), index=0, case_id="atomic-step"
            )
        )
    if method == "run_step":
        from hylyre.scenario.ledger import execute_ledger_step

        from hylyre.scenario.step_builder import step_response

        return step_response(
            await execute_ledger_step(
                agent, dict(params["payload"]), index=0, case_id="atomic-step"
            )
        )
    if method == "run_steps":
        from hylyre.cli.commands import steps_cmd as _steps_cmd

        st = params.get("steps") or []
        if not isinstance(st, list):
            raise ValueError("run_steps.steps must be a list")
        step_objs = []
        for i, row in enumerate(st):
            if not isinstance(row, dict):
                raise ValueError(f"run_steps.steps[{i}] must be object")
            step_objs.append(dict(row))
        on_fail_p = params.get("on_fail") or "abort"
        b = params.get("bundle")
        if b:
            await agent.start_app(
                str(b),
                page_name=params.get("page_name"),
                params=str(params.get("params") or ""),
                wait_time=float(params.get("wait_time") or 1.0),
            )
        return await _steps_cmd.run_steps_on_agent(
            agent, step_objs, on_fail=str(on_fail_p), failure_dir=params.get("failure_dir")
        )
    if method == "collect_list":
        from hylyre.cli.commands.collect_cmd import collect_list_on_agent

        return await collect_list_on_agent(agent, dict(params))

    raise ValueError(f"unknown method {method!r}")


async def _handle_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    agent: HylyreAgent,
    lock: asyncio.Lock,
    auth_token: str,
    shutdown_event: asyncio.Event,
) -> None:
    stop_daemon = False
    try:
        raw = await reader.readline()
        if not raw:
            return
        try:
            msg = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            err = json.dumps(
                {"id": None, "ok": False, "error": f"invalid json: {e}"},
                ensure_ascii=False,
            ).encode("utf-8")
            writer.write(err + b"\n")
            await writer.drain()
            return
        if not isinstance(msg, dict):
            raise ValueError("request must be an object")
        req_id = msg.get("id")
        token = msg.get("token")
        method = msg.get("method")
        params = msg.get("params") or {}
        if token != auth_token:
            out = {"id": req_id, "ok": False, "error": "invalid auth token"}
        elif not isinstance(method, str):
            out = {"id": req_id, "ok": False, "error": "missing method"}
        elif not isinstance(params, dict):
            out = {"id": req_id, "ok": False, "error": "params must be an object"}
        else:
            try:
                async with lock:
                    result = await _dispatch(agent, method, params)
                out = {"id": req_id, "ok": True, "result": result}
                if method == "shutdown":
                    stop_daemon = True
            except Exception as e:
                out = {"id": req_id, "ok": False, "error": str(e)[:8000]}
        writer.write(json.dumps(out, ensure_ascii=False).encode("utf-8") + b"\n")
        await writer.drain()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        if stop_daemon:
            shutdown_event.set()


async def run_session_daemon(
    *,
    session_file: Path,
    auth_token: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    host: str = "127.0.0.1",
) -> None:
    agent = create_hypium_agent(
        device_sn=device_sn,
        vlm=None,
        mock_port=mock_port,
        lyrebird_base_url=lyrebird_url,
    )
    lock = asyncio.Lock()
    shutdown_event = asyncio.Event()

    connect_timeout = float(os.environ.get("HYLYRE_SESSION_CONNECT_TIMEOUT", "180"))
    try:
        await asyncio.wait_for(agent.ensure_connected(), timeout=connect_timeout)
    except asyncio.TimeoutError as e:
        await agent.aclose()
        raise RuntimeError(
            f"Hypium connect timed out after {connect_timeout}s "
            "(device offline or busy; set HYLYRE_SESSION_CONNECT_TIMEOUT to adjust)"
        ) from e

    async def handle(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        await _handle_client(
            reader,
            writer,
            agent=agent,
            lock=lock,
            auth_token=auth_token,
            shutdown_event=shutdown_event,
        )

    srv = await asyncio.start_server(handle, host, 0, reuse_address=True)
    sockets = srv.sockets
    if not sockets:
        raise RuntimeError("session daemon failed to bind TCP port")
    port = sockets[0].getsockname()[1]

    from hylyre.session.schema import SCHEMA_VERSION, write_session_record

    write_session_record(
        session_file,
        {
            "schema_version": SCHEMA_VERSION,
            "pid": os.getpid(),
            "host": host,
            "port": port,
            "auth_token": auth_token,
            "device_sn": device_sn,
            "mock_port": mock_port,
            "lyrebird_url": lyrebird_url,
        },
    )

    async def _stop_when_requested() -> None:
        await shutdown_event.wait()
        srv.close()
        await srv.wait_closed()

    watcher = asyncio.create_task(_stop_when_requested())
    try:
        await srv.serve_forever()
    finally:
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass
        await agent.aclose()
        session_file.unlink(missing_ok=True)


def main_daemon_blocking() -> None:
    """Entry point: read env vars and run asyncio loop."""
    session_file = Path(os.environ["HYLYRE_SESSION_FILE"])
    auth_token = os.environ["HYLYRE_SESSION_TOKEN"]
    device_sn = os.environ.get("HYLYRE_SESSION_DEVICE_SN") or None
    mock_port_s = os.environ.get("HYLYRE_SESSION_MOCK_PORT")
    lyrebird_url = os.environ.get("HYLYRE_SESSION_LYREBIRD_URL") or None
    mock_port = int(mock_port_s) if mock_port_s else None

    async def _go() -> None:
        await run_session_daemon(
            session_file=session_file,
            auth_token=auth_token,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
        )

    try:
        asyncio.run(_go())
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main_daemon_blocking()

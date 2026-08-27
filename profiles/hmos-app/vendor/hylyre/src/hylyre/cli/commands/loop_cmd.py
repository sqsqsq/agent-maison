"""Atomic device helpers — screenshot, UI dump, planned JSON steps (CLI / MCP shared logic)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar

from hylyre.api.agent import HylyreAgent
from hylyre.drivers.hypium import HypiumDriver
from hylyre.ui_dump_filter import DumpFilterSpec, apply_ui_dump_filter
from hylyre.ui_dump_hints import augment_ui_dump_payload
from hylyre.wiring import create_hypium_agent

_T = TypeVar("_T")


def _session_ipc(session_file: Path, method: str, params: dict[str, Any]) -> Any:
    from hylyre.session.client import session_ipc_call

    return session_ipc_call(session_file, method, params)


async def _with_hypium_driver(
    *,
    device_sn: str | None,
    fn: Callable[[HypiumDriver], Awaitable[_T]],
) -> _T:
    driver = HypiumDriver(device_sn=device_sn)
    try:
        await driver.connect()
        return await fn(driver)
    finally:
        await driver.close()


async def _with_hypium_agent(
    *,
    device_sn: str | None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    fn: Callable[[HylyreAgent], Awaitable[_T]],
) -> _T:
    agent = create_hypium_agent(
        device_sn=device_sn,
        vlm=None,
        mock_port=mock_port,
        lyrebird_base_url=lyrebird_url,
    )
    try:
        return await fn(agent)
    finally:
        await agent.aclose()


def execute_screenshot_bytes(
    *,
    device_sn: str | None = None,
    session_file: Path | None = None,
) -> tuple[str, bytes]:
    """Return ``(mime, image_bytes)`` from Hypium capture."""
    if session_file is not None:
        import base64

        r = _session_ipc(session_file, "screenshot_bytes", {})
        mime = str(r["mime"])
        raw = base64.standard_b64decode(str(r["base64"]))
        return mime, raw

    async def _cap(driver: HypiumDriver) -> bytes:
        return await driver.screenshot()

    raw = asyncio.run(_with_hypium_driver(device_sn=device_sn, fn=_cap))
    mime = "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else "image/png"
    return mime, raw


def execute_screenshot_file(
    *,
    device_sn: str | None,
    out: Path,
    session_file: Path | None = None,
) -> str:
    """Write screenshot bytes to ``out``; suffix hints jpeg vs png."""
    mime, raw = execute_screenshot_bytes(
        device_sn=device_sn, session_file=session_file
    )
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    suffix = ".jpeg" if mime == "image/jpeg" else ".png"
    if out.suffix.lower() not in (".jpeg", ".jpg", ".png"):
        out = out.with_suffix(suffix)
    out.write_bytes(raw)
    return str(out.resolve())


def execute_dump_ui_dict(
    *,
    device_sn: str | None = None,
    session_file: Path | None = None,
    dump_filter: DumpFilterSpec | None = None,
) -> dict[str, Any]:
    """Return structured UI tree JSON (default: minimal attrs; use ``full=True`` for raw Hypium)."""
    if session_file is not None:
        raw = _session_ipc(session_file, "dump_ui", {})
    else:

        async def _dump(driver: HypiumDriver) -> dict[str, Any]:
            return await driver.dump_ui()

        raw = asyncio.run(_with_hypium_driver(device_sn=device_sn, fn=_dump))

    if not isinstance(raw, dict):
        return raw
    augmented = augment_ui_dump_payload(raw)
    spec = dump_filter if dump_filter is not None else DumpFilterSpec(full=False)
    return apply_ui_dump_filter(augmented, spec)


def execute_dump_ui_file(
    *,
    device_sn: str | None,
    out: Path,
    session_file: Path | None = None,
    dump_filter: DumpFilterSpec | None = None,
) -> str:
    payload = execute_dump_ui_dict(
        device_sn=device_sn, session_file=session_file, dump_filter=dump_filter
    )
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return str(out.resolve())


def execute_start_app(
    *,
    bundle: str,
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    page_name: str | None = None,
    params: str = "",
    wait_time: float = 1.0,
    session_file: Path | None = None,
) -> str:
    if session_file is not None:
        _session_ipc(
            session_file,
            "start_app",
            {
                "bundle": bundle,
                "page_name": page_name,
                "params": params,
                "wait_time": wait_time,
            },
        )
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        await agent.start_app(
            bundle, page_name=page_name, params=params, wait_time=wait_time
        )

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def execute_run_action(
    *,
    payload: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> str:
    if session_file is not None:
        _session_ipc(session_file, "run_action", {"payload": payload})
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        await agent.run_planned_action(payload)

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def execute_run_tap(
    *,
    payload: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> str:
    if session_file is not None:
        _session_ipc(session_file, "run_tap", {"payload": payload})
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        await agent.run_planned_tap(payload)

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def execute_run_input(
    *,
    payload: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> str:
    if session_file is not None:
        _session_ipc(session_file, "run_input", {"payload": payload})
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        await agent.run_planned_input(payload)

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def execute_run_swipe(
    *,
    payload: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> str:
    if session_file is not None:
        _session_ipc(session_file, "run_swipe", {"payload": payload})
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        await agent.run_planned_swipe(payload)

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def apply_cli_swipe_area_overrides(
    payload: dict[str, Any],
    *,
    area_by_type: str | None = None,
    area_by_text: str | None = None,
    area_by_id: str | None = None,
    area_by_key: str | None = None,
) -> dict[str, Any]:
    """Merge optional CLI ``--area-*`` flags into ``payload["swipe"]["area"]``.

    CLI wins when set (overwrites JSON ``area``). At most one selector flag.
    """
    opts = [
        ("by_type", area_by_type),
        ("by_text", area_by_text),
        ("by_id", area_by_id),
        ("by_key", area_by_key),
    ]
    sel = [(k, str(v).strip()) for k, v in opts if v is not None and str(v).strip()]
    if len(sel) > 1:
        raise ValueError("pass at most one of --area-by-type/text/id/key")
    swipe = payload.get("swipe")
    if not isinstance(swipe, dict):
        raise ValueError("payload root must include a swipe object")
    out = dict(payload)
    swipe_copy = dict(swipe)
    if sel:
        swipe_copy["area"] = {sel[0][0]: sel[0][1]}
    out["swipe"] = swipe_copy
    return out


def apply_cli_scroll_at_overrides(
    payload: dict[str, Any],
    *,
    at_by_type: str | None = None,
    at_by_text: str | None = None,
    at_by_id: str | None = None,
    at_by_key: str | None = None,
) -> dict[str, Any]:
    """Merge optional CLI ``--at-*`` flags into ``payload["scroll"]["at"]``.

    CLI wins when set (overwrites JSON ``at``). At most one selector flag.
    """
    opts = [
        ("by_type", at_by_type),
        ("by_text", at_by_text),
        ("by_id", at_by_id),
        ("by_key", at_by_key),
    ]
    sel = [(k, str(v).strip()) for k, v in opts if v is not None and str(v).strip()]
    if len(sel) > 1:
        raise ValueError("pass at most one of --at-by-type/text/id/key")
    scroll = payload.get("scroll")
    if not isinstance(scroll, dict):
        raise ValueError("payload root must include a scroll object")
    out = dict(payload)
    scroll_copy = dict(scroll)
    if sel:
        scroll_copy["at"] = {sel[0][0]: sel[0][1]}
    out["scroll"] = scroll_copy
    return out


def execute_run_scroll(
    *,
    payload: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> str:
    if session_file is not None:
        _session_ipc(session_file, "run_scroll", {"payload": payload})
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        await agent.run_planned_scroll(payload)

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def execute_dispatch_planned_step(
    *,
    payload: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> str:
    """Run any planned JSON step via ``dispatch_planned_step``."""
    if session_file is not None:
        _session_ipc(session_file, "run_step", {"payload": payload})
        return "ok"

    async def _go(agent: HylyreAgent) -> None:
        from hylyre.api.step_dispatch import dispatch_planned_step

        await dispatch_planned_step(agent, payload)

    asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )
    return "ok"


def run_planned_step_json(
    *,
    payload_json: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None = None,
) -> None:
    import typer

    try:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("JSON root must be an object")
        execute_dispatch_planned_step(
            payload=payload,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except json.JSONDecodeError as e:
        typer.secho(f"Invalid JSON: {e}", err=True)
        raise typer.Exit(code=2) from e
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


def run_screenshot_out(
    *,
    device_sn: str | None,
    out: Path,
    session_file: Path | None = None,
) -> None:
    import typer

    try:
        path = execute_screenshot_file(
            device_sn=device_sn, out=out, session_file=session_file
        )
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo(path)


def run_dump_ui_out(
    *,
    device_sn: str | None,
    out: Path,
    session_file: Path | None = None,
    dump_filter: DumpFilterSpec | None = None,
) -> None:
    import typer

    try:
        path = execute_dump_ui_file(
            device_sn=device_sn,
            out=out,
            session_file=session_file,
            dump_filter=dump_filter,
        )
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo(path)


def run_start_app_cli(
    *,
    bundle: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    page_name: str | None,
    params: str,
    wait_time: float,
    session_file: Path | None = None,
) -> None:
    import typer

    try:
        execute_start_app(
            bundle=bundle,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            page_name=page_name,
            params=params,
            wait_time=wait_time,
            session_file=session_file,
        )
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


def run_action_json(
    *,
    payload_json: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None = None,
) -> None:
    import typer

    try:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("JSON root must be an object")
        execute_run_action(
            payload=payload,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except json.JSONDecodeError as e:
        typer.secho(f"Invalid JSON: {e}", err=True)
        raise typer.Exit(code=2) from e
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


def run_tap_json(
    *,
    payload_json: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None = None,
) -> None:
    import typer

    try:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("JSON root must be an object")
        execute_run_tap(
            payload=payload,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except json.JSONDecodeError as e:
        typer.secho(f"Invalid JSON: {e}", err=True)
        raise typer.Exit(code=2) from e
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


def run_swipe_json(
    *,
    payload_json: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None = None,
    area_by_type: str | None = None,
    area_by_text: str | None = None,
    area_by_id: str | None = None,
    area_by_key: str | None = None,
) -> None:
    import typer

    try:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("JSON root must be an object")
        payload = apply_cli_swipe_area_overrides(
            payload,
            area_by_type=area_by_type,
            area_by_text=area_by_text,
            area_by_id=area_by_id,
            area_by_key=area_by_key,
        )
        execute_run_swipe(
            payload=payload,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except json.JSONDecodeError as e:
        typer.secho(f"Invalid JSON: {e}", err=True)
        raise typer.Exit(code=2) from e
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


def run_scroll_json(
    *,
    payload_json: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None = None,
    at_by_type: str | None = None,
    at_by_text: str | None = None,
    at_by_id: str | None = None,
    at_by_key: str | None = None,
) -> None:
    import typer

    try:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("JSON root must be an object")
        payload = apply_cli_scroll_at_overrides(
            payload,
            at_by_type=at_by_type,
            at_by_text=at_by_text,
            at_by_id=at_by_id,
            at_by_key=at_by_key,
        )
        execute_run_scroll(
            payload=payload,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except json.JSONDecodeError as e:
        typer.secho(f"Invalid JSON: {e}", err=True)
        raise typer.Exit(code=2) from e
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


def run_input_json(
    *,
    payload_json: str,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None = None,
) -> None:
    import typer

    try:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("JSON root must be an object")
        execute_run_input(
            payload=payload,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except json.JSONDecodeError as e:
        typer.secho(f"Invalid JSON: {e}", err=True)
        raise typer.Exit(code=2) from e
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")

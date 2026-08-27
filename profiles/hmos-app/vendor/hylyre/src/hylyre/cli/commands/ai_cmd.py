"""Structured AI-like tap/input on a real device (P1: no VLM; P3 adds semantics)."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

import typer
from rich.console import Console

from hylyre.drivers.hypium import HypiumDriver

console = Console()


async def _with_hypium_agent(
    device_sn: str | None,
    fn: Callable[[Any], Awaitable[None]],
) -> None:
    from hylyre.wiring import create_hypium_agent_with_env_vlm

    agent = create_hypium_agent_with_env_vlm(device_sn=device_sn)
    if agent.vlm is None:
        raise ValueError(
            "Natural-language commands require HYLYRE_VLM_ENDPOINT "
            "(optional HYLYRE_VLM_API_KEY, HYLYRE_VLM_MODEL)."
        )
    try:
        await fn(agent)
    finally:
        await agent.aclose()


def run_ai_tap(
    *,
    device_sn: str | None,
    x: int | None,
    y: int | None,
    by_text: str | None,
    by_id: str | None,
    wait_time: float,
) -> None:
    async def _run() -> None:
        driver = HypiumDriver(device_sn=device_sn)
        try:
            await driver.connect()
            await driver.touch(
                x=x,
                y=y,
                by_text=by_text,
                by_id=by_id,
                wait_time=wait_time,
            )
        finally:
            await driver.close()

    try:
        asyncio.run(_run())
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except Exception as e:  # pragma: no cover - device/runtime failures
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from e


def run_ai_input(
    *,
    device_sn: str | None,
    value: str,
    by_text: str | None,
    by_id: str | None,
) -> None:
    async def _run() -> None:
        driver = HypiumDriver(device_sn=device_sn)
        try:
            await driver.connect()
            await driver.input_text(
                value, by_text=by_text, by_id=by_id
            )
        finally:
            await driver.close()

    try:
        asyncio.run(_run())
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except Exception as e:  # pragma: no cover
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from e


def run_ai_action(*, device_sn: str | None, instruction: str) -> None:
    async def _run() -> None:
        async def _go(agent: Any) -> None:
            await agent.ai_action(instruction)

        await _with_hypium_agent(device_sn, _go)

    try:
        asyncio.run(_run())
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except Exception as e:  # pragma: no cover
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from e


def run_ai_query(
    *,
    device_sn: str | None,
    instruction: str,
    schema: str,
) -> None:
    st = schema.lower().strip()
    py_schema: type | None = None
    if st == "number":
        py_schema = float
    elif st == "boolean":
        py_schema = bool
    elif st == "string":
        py_schema = str

    async def _run() -> None:
        async def _go(agent: Any) -> None:
            out = await agent.ai_query(instruction, schema=py_schema)
            console.print(out)

        await _with_hypium_agent(device_sn, _go)

    try:
        asyncio.run(_run())
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except Exception as e:  # pragma: no cover
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from e


def run_ai_assert(*, device_sn: str | None, instruction: str) -> None:
    async def _run() -> None:
        async def _go(agent: Any) -> None:
            await agent.ai_assert(instruction)

        await _with_hypium_agent(device_sn, _go)

    try:
        asyncio.run(_run())
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except AssertionError as e:
        console.print(f"[red]ASSERT:[/red] {e}")
        raise typer.Exit(code=3) from e
    except Exception as e:  # pragma: no cover
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from e


def execute_ai_action(*, device_sn: str | None, instruction: str) -> str:
    """VLM action; raises same exceptions as CLI path (no typer)."""

    async def _run() -> None:
        async def _go(agent: Any) -> None:
            await agent.ai_action(instruction)

        await _with_hypium_agent(device_sn, _go)

    asyncio.run(_run())
    return "ok"


def execute_ai_query(
    *, device_sn: str | None, instruction: str, schema: str
) -> str:
    st = schema.lower().strip()
    py_schema: type | None = None
    if st == "number":
        py_schema = float
    elif st == "boolean":
        py_schema = bool
    elif st == "string":
        py_schema = str

    out_box: list[Any] = []

    async def _run() -> None:
        async def _go(agent: Any) -> None:
            out_box.append(await agent.ai_query(instruction, schema=py_schema))

        await _with_hypium_agent(device_sn, _go)

    asyncio.run(_run())
    return str(out_box[0])


def execute_ai_assert(*, device_sn: str | None, instruction: str) -> str:
    async def _run() -> None:
        async def _go(agent: Any) -> None:
            await agent.ai_assert(instruction)

        await _with_hypium_agent(device_sn, _go)

    asyncio.run(_run())
    return "ok"

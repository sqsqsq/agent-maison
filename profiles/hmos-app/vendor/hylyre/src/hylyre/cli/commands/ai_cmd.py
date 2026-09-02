"""Structured AI-like tap/input on a real device (P1: no VLM; P3 adds semantics)."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

import typer
from rich.console import Console

from hylyre.api.step_dispatch import dispatch_planned_step
from hylyre.drivers.hypium import HypiumDriver

console = Console()


async def _with_hypium_agent(
    device_sn: str | None,
    fn: Callable[[Any], Awaitable[None]],
    *,
    require_vlm: bool = True,
) -> None:
    """Run ``fn`` against a connected agent.

    ``require_vlm`` is False for the structured tap/input entries: they name a
    target explicitly and never call a model, so demanding VLM configuration
    for them would be a false prerequisite.
    """

    from hylyre.wiring import create_hypium_agent_with_env_vlm

    agent = create_hypium_agent_with_env_vlm(device_sn=device_sn)
    if require_vlm and agent.vlm is None:
        raise ValueError(
            "Natural-language commands require HYLYRE_VLM_ENDPOINT "
            "(optional HYLYRE_VLM_API_KEY, HYLYRE_VLM_MODEL)."
        )
    try:
        await fn(agent)
    finally:
        await agent.aclose()


def _ai_step_response(
    *,
    device_sn: str | None,
    kind: str,
    role: str,
    run,
    require_vlm: bool = True,
) -> dict[str, Any]:
    """Run one AI operation through the single builder and return its envelope.

    An AI-driven tap is still a planned step: discarding its outcome and
    reporting a fixed "ok" is how a failing action was reported as success.
    """

    from hylyre.scenario.step_builder import build_step_result, step_response
    from hylyre.scenario.step_builder import outcome_from_exception

    box: list[Any] = []

    async def _outer() -> None:
        async def _go(agent: Any) -> None:
            try:
                outcome = await run(agent)
            except Exception as exc:  # noqa: BLE001 - unexpected only
                outcome = outcome_from_exception(exc)
            box.append(
                build_step_result(
                    outcome,
                    index=0,
                    kind=kind,
                    role=role,
                    device_session=agent.is_connected,
                )
            )

        await _with_hypium_agent(device_sn, _go, require_vlm=require_vlm)

    asyncio.run(_outer())
    return step_response(box[0])


def _emit_ai_step(response: dict[str, Any]) -> None:
    """Print the envelope and fail the command when the step did not pass."""

    import json as _json

    # Plain stdout, not rich formatting: this envelope is parsed by tools.
    typer.echo(_json.dumps(response, ensure_ascii=False))
    if response["step_result"]["outcome"]["status"] != "passed":
        raise typer.Exit(code=1)


def run_ai_tap(
    *,
    device_sn: str | None,
    x: int | None,
    y: int | None,
    by_text: str | None,
    by_id: str | None,
    wait_time: float,
) -> None:
    touch: dict[str, Any] = {"wait_time": wait_time}
    if x is not None and y is not None:
        touch.update({"x": x, "y": y})
    elif by_text is not None:
        touch["by_text"] = by_text
    elif by_id is not None:
        touch["by_id"] = by_id
    else:
        console.print("[red]tap requires x/y, by_text or by_id[/red]")
        raise typer.Exit(code=2)
    _emit_ai_step(execute_ai_tap(device_sn=device_sn, touch=touch))


def run_ai_input(
    *,
    device_sn: str | None,
    value: str,
    by_text: str | None,
    by_id: str | None,
) -> None:
    block: dict[str, Any] = {"text": value}
    if by_text is not None:
        block["by_text"] = by_text
    if by_id is not None:
        block["by_id"] = by_id
    _emit_ai_step(execute_ai_input(device_sn=device_sn, block=block))


def run_ai_action(*, device_sn: str | None, instruction: str) -> None:
    try:
        response = execute_ai_action(device_sn=device_sn, instruction=instruction)
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    _emit_ai_step(response)


def execute_ai_tap(*, device_sn: str | None, touch: dict[str, Any]) -> dict[str, Any]:
    """Structured tap as a protocol step (no VLM)."""

    return _ai_step_response(
        device_sn=device_sn,
        kind="touch",
        role="action",
        run=lambda agent: dispatch_planned_step(agent, {"touch": touch}, case_id="ai-tap"),
        require_vlm=False,
    )


def execute_ai_input(*, device_sn: str | None, block: dict[str, Any]) -> dict[str, Any]:
    """Structured input as a protocol step (no VLM)."""

    return _ai_step_response(
        device_sn=device_sn,
        kind="input",
        role="action",
        run=lambda agent: dispatch_planned_step(agent, {"input": block}, case_id="ai-input"),
        require_vlm=False,
    )


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
    import json as _json

    import typer

    response = execute_ai_assert(device_sn=device_sn, instruction=instruction)
    typer.echo(_json.dumps(response, ensure_ascii=False))
    if response["step_result"]["outcome"]["status"] != "passed":
        raise typer.Exit(code=1)


def execute_ai_action(*, device_sn: str | None, instruction: str) -> dict[str, Any]:
    """VLM action as a protocol step.

    Previously this discarded the outcome and returned a literal "ok", so a
    failing action was reported as a success by every caller.
    """

    return _ai_step_response(
        device_sn=device_sn,
        kind="ai_action",
        role="action",
        run=lambda agent: agent.ai_action(instruction),
    )


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


def execute_ai_assert(*, device_sn: str | None, instruction: str) -> dict[str, Any]:
    """Run a VLM assertion and return the protocol envelope.

    Discarding the outcome and returning a fixed "ok" reported a false green
    for every failing assertion — the exact class of defect this protocol
    exists to make impossible.
    """

    from hylyre.scenario.step_builder import build_step_result, step_response
    from hylyre.scenario.step_builder import outcome_from_exception

    box: list[Any] = []

    async def _run() -> None:
        async def _go(agent: Any) -> None:
            outcome = await agent.ai_assert(instruction)
            box.append(
                build_step_result(
                    outcome,
                    index=0,
                    kind="expected_check",
                    role="assertion",
                    device_session=agent.is_connected,
                )
            )

        await _with_hypium_agent(device_sn, _go)

    asyncio.run(_run())
    return step_response(box[0])

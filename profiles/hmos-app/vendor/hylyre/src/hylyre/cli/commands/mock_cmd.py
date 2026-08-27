"""Lyrebird / mock Typer commands."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

from hylyre.drivers.hypium import hdc_cli
from hylyre.drivers.lyrebird.cert_bootstrap import (
    mitm_trust_instructions,
    push_mitm_ca_to_device,
)
from hylyre.drivers.lyrebird.controller import (
    LyrebirdController,
    require_lyrebird_distribution,
)
from hylyre.drivers.lyrebird import pidfile

console = Console()


def _base_url(url: Optional[str]) -> str:
    return (url or os.environ.get("HYLYRE_LYREBIRD_URL") or "http://127.0.0.1:9090").rstrip(
        "/"
    )


def run_mock_start(
    mock_port: int,
    data: Optional[Path],
    pid_path: Optional[Path],
) -> None:
    try:
        require_lyrebird_distribution()
    except ImportError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    pp = pid_path or pidfile.default_pid_path()
    old = pidfile.read_pid(pp)
    if old is not None and pidfile.is_pid_alive(old):
        console.print(
            f"[yellow]PID file {pp} references running process {old}; "
            "`hylyre mock stop` first.[/yellow]"
        )
        raise typer.Exit(code=1)

    async def _go() -> None:
        ctrl = LyrebirdController()
        try:
            await ctrl.start_local(
                data_root=data,
                mock_port=mock_port,
                no_browser=True,
            )
            pid = ctrl.subprocess_pid
            if pid is not None:
                pidfile.write_pid(pp, pid)
            console.print(
                f"[green]Lyrebird[/green] mock API [cyan]{ctrl.base_url}[/cyan] "
                f"(pid [bold]{pid}[/bold], pidfile [dim]{pp}[/dim])"
            )
        finally:
            await ctrl.aclose()

    try:
        asyncio.run(_go())
    except typer.Exit:
        raise
    except Exception as e:  # pragma: no cover
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1) from e


def run_mock_stop(pid_path: Optional[Path]) -> None:
    pp = pid_path or pidfile.default_pid_path()
    pid = pidfile.read_pid(pp)
    if pid is None:
        console.print(f"[yellow]No PID in {pp}[/yellow]")
        raise typer.Exit(code=1)
    if not pidfile.is_pid_alive(pid):
        console.print(f"[yellow]Process {pid} not running; clearing pidfile[/yellow]")
        pidfile.clear_pidfile(pp)
        return
    pidfile.terminate_pid(pid)
    pidfile.clear_pidfile(pp)
    console.print(f"[green]Stopped[/green] pid {pid}")


def run_mock_status(base_url: Optional[str]) -> None:
    async def _go() -> None:
        ctrl = LyrebirdController(base_url=_base_url(base_url))
        try:
            st = await ctrl.status()
            console.print(json.dumps(st, indent=2, ensure_ascii=False))
        finally:
            await ctrl.aclose()

    asyncio.run(_go())


def run_mock_activate(group_id: str, base_url: Optional[str]) -> None:
    async def _go() -> None:
        ctrl = LyrebirdController(base_url=_base_url(base_url))
        try:
            await ctrl.activate_group(group_id)
            console.print(f"[green]Activated[/green] group {group_id!r}")
        finally:
            await ctrl.aclose()

    asyncio.run(_go())


def execute_mock_activate(group_id: str, base_url: Optional[str]) -> str:
    """Activate Lyrebird mock group; raises on HTTP/runtime errors."""

    async def _go() -> None:
        ctrl = LyrebirdController(base_url=_base_url(base_url))
        try:
            await ctrl.activate_group(group_id)
        finally:
            await ctrl.aclose()

    asyncio.run(_go())
    return f"Activated group {group_id!r}"


def run_mock_deactivate(base_url: Optional[str]) -> None:
    async def _go() -> None:
        ctrl = LyrebirdController(base_url=_base_url(base_url))
        try:
            await ctrl.deactivate_all()
            console.print("[green]Deactivated[/green] all mock groups")
        finally:
            await ctrl.aclose()

    asyncio.run(_go())


def run_mock_capture(
    output: Path,
    base_url: Optional[str],
    full: bool,
) -> None:
    async def _go() -> None:
        ctrl = LyrebirdController(base_url=_base_url(base_url))
        try:
            await ctrl.export_flows(output, full_detail=full)
            console.print(f"[green]Wrote[/green] {output} (full_detail={full})")
        finally:
            await ctrl.aclose()

    asyncio.run(_go())


def run_mock_push_ca(
    ca_cert: Optional[Path],
    serial: Optional[str],
    remote: str,
) -> None:
    try:
        local, rem = push_mitm_ca_to_device(
            ca_cert=ca_cert, serial=serial, remote_path=remote
        )
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except hdc_cli.HdcNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except hdc_cli.HdcError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=e.exit_code or 1) from e
    console.print(f"[green]Sent[/green] {local} → device:{rem}")
    text = mitm_trust_instructions(
        hdc_serial=serial,
        ca_cert=local,
        device_remote_path=rem,
    )
    console.print(text)


def run_mock_cert_instructions(
    ca_cert: Optional[Path],
    serial: Optional[str],
) -> None:
    text = mitm_trust_instructions(
        hdc_serial=serial,
        ca_cert=ca_cert,
    )
    console.print(text)

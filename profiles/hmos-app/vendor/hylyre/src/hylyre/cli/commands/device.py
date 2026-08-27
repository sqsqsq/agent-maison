"""Device commands: hdc list / install (P1)."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from hylyre.drivers.hypium import hdc_cli

console = Console()


def format_device_list_text() -> str:
    """hdc targets as plain lines (MCP / scripting). Raises HdcNotFoundError, HdcError."""
    targets = hdc_cli.list_targets()
    if not targets:
        return "No devices reported by hdc."
    lines = ["hdc targets:", *(f"  {i}. {t}" for i, t in enumerate(targets, start=1))]
    return "\n".join(lines)


def first_device_serial() -> str | None:
    """First serial from ``hdc list targets``, or None if none."""
    targets = hdc_cli.list_targets()
    return targets[0] if targets else None


def run_device_list(*, first_only: bool = False) -> None:
    try:
        if first_only:
            serial = first_device_serial()
            if not serial:
                console.print("[yellow]No devices reported by hdc.[/yellow]")
                raise typer.Exit(code=1)
            typer.echo(serial)
            return
        targets = hdc_cli.list_targets()
    except hdc_cli.HdcNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except hdc_cli.HdcError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=e.exit_code or 1) from e
    table = Table(title="hdc targets")
    table.add_column("#", style="dim")
    table.add_column("serial", style="cyan")
    if not targets:
        console.print(table)
        console.print("[yellow]No devices reported by hdc.[/yellow]")
        return
    for i, t in enumerate(targets, start=1):
        table.add_row(str(i), t)
    console.print(table)


def run_device_cold_restart(
    *,
    bundle: str,
    serial: str | None,
    ability: str | None,
    wait_time: float,
) -> None:
    import time

    try:
        hdc_cli.force_stop(bundle, serial=serial)
        start_args = ["aa", "start", "-a", ability, "-b", bundle] if ability else [
            "aa",
            "start",
            bundle,
        ]
        hdc_cli.shell(start_args, serial=serial)
        if wait_time > 0:
            time.sleep(wait_time)
    except hdc_cli.HdcNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except hdc_cli.HdcError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=e.exit_code or 1) from e
    suffix = f" (-t {serial})" if serial else ""
    console.print(f"[green]Cold restart[/green] {bundle}{suffix}")


def run_device_force_stop(*, bundle: str, serial: str | None) -> None:
    try:
        hdc_cli.force_stop(bundle, serial=serial)
    except hdc_cli.HdcNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except hdc_cli.HdcError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=e.exit_code or 1) from e
    suffix = f" (-t {serial})" if serial else ""
    console.print(f"[green]Force stop[/green] {bundle}{suffix}")


def run_device_install(hap: Path, serial: str | None) -> None:
    try:
        hdc_cli.install_hap(hap, serial=serial)
    except hdc_cli.HdcNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=2) from e
    except hdc_cli.HdcError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=e.exit_code or 1) from e
    suffix = f" (-t {serial})" if serial else ""
    console.print(f"[green]Installed[/green] {hap}{suffix}")

"""P2b: optional pip install + quick checks for mock / Lyrebird tooling."""

from __future__ import annotations

import subprocess
import sys

import typer
from rich.console import Console
from rich.table import Table

from hylyre.cli.commands import doctor
from hylyre.drivers.lyrebird.controller import require_lyrebird_distribution

console = Console()


def run_bootstrap_mock(*, install: bool) -> None:
    """Install mitmproxy+lyrebird via pip when requested; then show mock-related doctor rows."""
    if install:
        console.print(
            "[dim]Running pip install mitmproxy lyrebird (same interpreter as hylyre)…[/dim]"
        )
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "mitmproxy", "lyrebird"],
            timeout=900,
        )
        if proc.returncode != 0:
            raise typer.Exit(code=1)
        console.print("[green]pip install finished.[/green]")
    console.print(
        "Tip: in the Hylyre repo prefer [cyan]pip install -e '.[mock]'[/cyan] "
        "so extras match this checkout."
    )
    try:
        require_lyrebird_distribution()
    except ImportError as e:
        console.print(f"[yellow]lyrebird import: {e}[/yellow]")
    else:
        console.print("[green]lyrebird import ok[/green]")

    all_rows = doctor.gather_doctor_checks()
    pick = [
        r
        for r in all_rows
        if r.name.startswith("mitmproxy") or r.name.startswith("lyrebird")
    ]
    table = Table(title="mock toolchain (subset)")
    table.add_column("Check")
    table.add_column("Status")
    table.add_column("Detail")
    for r in pick:
        st = "[green]OK[/green]" if r.ok else "[red]MISSING[/red]"
        table.add_row(r.name, st, r.detail)
    console.print(table)
    console.print("Next: [bold]hylyre doctor[/bold] for the full matrix.")

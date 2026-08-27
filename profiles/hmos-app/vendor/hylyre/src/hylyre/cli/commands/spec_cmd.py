"""``hylyre spec`` — lightweight OpenSpec discovery without requiring the npm CLI."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import typer
from rich.console import Console

from hylyre.progress import store

console = Console()


def _openspec_root(start: Path | None = None) -> Path:
    return store.find_hylyre_repo_root(start) / "openspec"


def run_spec_list(*, use_openspec_cli: bool = True) -> None:
    """List changes/spec dirs, or delegate to ``openspec list`` when available."""
    root = _openspec_root()
    if not root.is_dir():
        console.print(f"[red]Missing openspec directory: {root}[/red]")
        raise typer.Exit(code=2)

    exe = shutil.which("openspec") if use_openspec_cli else None
    if exe:
        proc = subprocess.run(
            [exe, "list"],
            cwd=root.parent,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if proc.stdout:
            console.print(proc.stdout.rstrip())
        if proc.stderr:
            console.print(f"[dim]{proc.stderr.rstrip()}[/dim]")
        if proc.returncode != 0:
            console.print(
                "[yellow]openspec list failed; falling back to directory listing.[/yellow]"
            )
        else:
            return

    specs = root / "specs"
    changes = root / "changes"
    console.print("[bold]openspec/specs[/bold]")
    if specs.is_dir():
        for d in sorted(specs.iterdir()):
            if d.is_dir() and (d / "spec.md").is_file():
                console.print(f"  [cyan]spec[/cyan] {d.name}")
            elif d.is_dir():
                console.print(f"  [dim]dir {d.name}[/dim]")
    else:
        console.print("  (none)")
    console.print("[bold]openspec/changes[/bold] (non-archive)")
    if changes.is_dir():
        for d in sorted(changes.iterdir()):
            if d.is_dir() and d.name != "archive":
                console.print(f"  [yellow]change[/yellow] {d.name}")
        arch = changes / "archive"
        if arch.is_dir():
            archived = sum(1 for _ in arch.iterdir() if _.is_dir())
            console.print(f"  [dim]archive/ ({archived} entries)[/dim]")
    else:
        console.print("  (none)")
    if not exe:
        console.print(
            "\n[dim]Tip: install OpenSpec CLI for richer output — "
            "npm i -g @fission-ai/openspec[/dim]"
        )

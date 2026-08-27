"""``hylyre progress`` — show or append ``docs/progress.md``."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from hylyre.progress import store

console = Console()


def run_progress_show(*, path: Path | None = None, tail_lines: int | None = None) -> None:
    """Print progress file path and contents (optional tail)."""
    p = path or store.default_progress_path()
    console.print(f"[dim]Progress file:[/dim] {p.resolve()}")
    if not p.is_file():
        console.print("[yellow](file does not exist yet)[/yellow]")
        return
    text = p.read_text(encoding="utf-8")
    if tail_lines is not None and tail_lines > 0:
        lines = text.splitlines()
        text = "\n".join(lines[-tail_lines:])
        if lines:
            console.print(f"[dim](last {tail_lines} lines)[/dim]")
    console.print(text)


def run_progress_append(message: str, *, path: Path | None = None, title: str | None) -> None:
    if not message.strip():
        console.print("[red]Message is empty.[/red]")
        raise typer.Exit(code=2)
    out = store.append_progress_section(message, path=path, title=title)
    console.print(f"[green]Appended to {out}[/green]")


def run_progress_path_only(*, path: Path | None = None) -> None:
    """Print resolved progress path only (for scripts)."""
    p = (path or store.default_progress_path()).resolve()
    typer.echo(str(p))

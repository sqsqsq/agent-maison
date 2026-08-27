"""CLI / MCP shared logic for app knowledge store."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer

from hylyre.app_store.cross_find import search_all_indexes
from hylyre.app_store.fingerprint import compute_ui_fingerprint
from hylyre.app_store.page_store import (
    delete_page_snapshot,
    diff_snapshots,
    load_page_snapshot,
    list_page_snapshots,
    save_page_snapshot,
)
from hylyre.app_store.paths import resolve_write_dir
from hylyre.cli.commands.loop_cmd import execute_dump_ui_dict
from hylyre.ui_dump_filter import DumpFilterSpec

app_cli = typer.Typer(help="Bundle-level UI knowledge (snapshots + index)")
page_cli = typer.Typer(help="Persist named UI snapshots under .hylyre/apps")
app_cli.add_typer(page_cli, name="page")


def _load_payload_from_file(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("dump JSON must be an object")
    return data


def _live_payload(*, device_sn: str | None, session_file: Path | None) -> dict[str, Any]:
    return execute_dump_ui_dict(
        device_sn=device_sn,
        session_file=session_file,
        dump_filter=DumpFilterSpec(full=True),
    )


@app_cli.command("find")
def app_find(
    bundle: str = typer.Argument(..., help="Application bundle id."),
    by_text: str | None = typer.Option(None, "--by-text"),
    by_id_pattern: str | None = typer.Option(None, "--by-id-pattern"),
    store_dir: Path | None = typer.Option(
        None,
        "--store-dir",
        help="Override HYLYRE_APP_STORE_DIR / cwd .hylyre/apps",
    ),
) -> None:
    """Search merged indexes across configured store dirs."""
    hits = search_all_indexes(
        bundle,
        by_text=by_text,
        by_id_pattern=by_id_pattern,
        store_dir=store_dir,
    )
    typer.echo(json.dumps(hits, ensure_ascii=False))


@app_cli.command("fingerprint")
def app_fingerprint(
    from_dump: Path | None = typer.Option(
        None,
        "--from-dump",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Saved dump-ui JSON with tree.",
    ),
    session: Path | None = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from hylyre session start.",
    ),
    device_sn: str | None = typer.Option(None, "--device-sn"),
) -> None:
    """Compute structural fingerprint (type,id,key triples) for a dump."""
    if from_dump is not None:
        if session is not None or device_sn is not None:
            typer.secho("--from-dump is mutually exclusive with --session/--device-sn", err=True)
            raise typer.Exit(code=2)
        payload = _load_payload_from_file(from_dump)
    elif session is not None or device_sn is not None:
        payload = _live_payload(device_sn=device_sn, session_file=session)
    else:
        typer.secho("pass --from-dump or (--session / --device-sn)", err=True)
        raise typer.Exit(code=2)
    tree = payload.get("tree")
    if not isinstance(tree, dict):
        typer.secho("payload missing tree", err=True)
        raise typer.Exit(code=1)
    fp, lines = compute_ui_fingerprint(tree)
    typer.echo(json.dumps({"fingerprint": fp, "inputs": lines}, ensure_ascii=False))


@page_cli.command("save")
def page_save(
    bundle: str = typer.Argument(...),
    name: str = typer.Argument(..., help="Stable page slug (filename stem)."),
    ability_name: str | None = typer.Option(None, "--ability"),
    app_version: str | None = typer.Option(None, "--app-version"),
    from_dump: Path | None = typer.Option(None, "--from-dump"),
    session: Path | None = typer.Option(None, "--session", "-S"),
    device_sn: str | None = typer.Option(None, "--device-sn"),
    auto_fingerprint: bool = typer.Option(False, "--auto-fingerprint"),
    store_dir: Path | None = typer.Option(None, "--store-dir"),
) -> None:
    """Write page snapshot JSON + update bundle index."""
    if from_dump is not None:
        if session is not None or device_sn is not None:
            typer.secho("--from-dump is mutually exclusive with --session/--device-sn", err=True)
            raise typer.Exit(code=2)
        try:
            payload = _load_payload_from_file(from_dump)
        except Exception as e:
            typer.secho(f"page save failed (load dump): {e}", err=True)
            raise typer.Exit(code=1) from e
    elif session is not None or device_sn is not None:
        try:
            payload = _live_payload(device_sn=device_sn, session_file=session)
        except Exception as e:
            typer.secho(f"page save failed (live dump): {e}", err=True)
            raise typer.Exit(code=1) from e
    else:
        from hylyre.drivers.hypium import hdc_cli

        try:
            targets = hdc_cli.list_targets()
        except Exception as e:
            typer.secho(f"page save failed (list devices): {e}", err=True)
            raise typer.Exit(code=1) from e
        if len(targets) == 1:
            device_sn = targets[0]
            try:
                payload = _live_payload(device_sn=device_sn, session_file=None)
            except Exception as e:
                typer.secho(f"page save failed (live dump): {e}", err=True)
                raise typer.Exit(code=1) from e
        elif len(targets) == 0:
            typer.secho(
                "page save: no device connected; pass --from-dump or --session or --device-sn",
                err=True,
            )
            raise typer.Exit(code=2)
        else:
            typer.secho(
                "page save: multiple devices connected; pass --device-sn. "
                f"Connected: {', '.join(targets)}",
                err=True,
            )
            raise typer.Exit(code=2)
    try:
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
    except Exception as e:
        typer.secho(f"page save failed (persist snapshot): {e}", err=True)
        raise typer.Exit(code=1) from e
    typer.echo(str(path.resolve()))


@page_cli.command("load")
def page_load(
    bundle: str = typer.Argument(...),
    name: str = typer.Argument(...),
    store_dir: Path | None = typer.Option(None, "--store-dir"),
) -> None:
    """Print snapshot JSON (searches read dirs until found)."""
    from hylyre.app_store.paths import resolve_read_dirs

    last_err: Exception | None = None
    for d in resolve_read_dirs(store_dir):
        try:
            snap = load_page_snapshot(d, bundle, name)
            typer.echo(json.dumps(snap, ensure_ascii=False))
            return
        except FileNotFoundError as e:
            last_err = e
            continue
    typer.secho(str(last_err or "not found"), err=True)
    raise typer.Exit(code=1)


@page_cli.command("list")
def page_list(
    bundle: str = typer.Argument(...),
    store_dir: Path | None = typer.Option(None, "--store-dir"),
) -> None:
    """List saved page slugs (union across read dirs)."""
    from hylyre.app_store.paths import resolve_read_dirs

    names: set[str] = set()
    for d in resolve_read_dirs(store_dir):
        names.update(list_page_snapshots(d, bundle))
    typer.echo(json.dumps(sorted(names), ensure_ascii=False))


@page_cli.command("delete")
def page_delete(
    bundle: str = typer.Argument(...),
    name: str = typer.Argument(...),
    store_dir: Path | None = typer.Option(None, "--store-dir"),
) -> None:
    """Remove snapshot + prune index (write dir only)."""
    try:
        delete_page_snapshot(resolve_write_dir(store_dir), bundle, name)
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo("ok")


@page_cli.command("diff")
def page_diff(
    bundle: str = typer.Argument(...),
    name: str = typer.Argument(...),
    against: str = typer.Option(
        "current",
        "--against",
        help="'current' live dump, or path to JSON file.",
    ),
    session: Path | None = typer.Option(None, "--session", "-S"),
    device_sn: str | None = typer.Option(None, "--device-sn"),
    store_dir: Path | None = typer.Option(None, "--store-dir"),
) -> None:
    """Compare saved snapshot fingerprint vs live or another dump."""
    from hylyre.app_store.paths import resolve_read_dirs

    snap = None
    for d in resolve_read_dirs(store_dir):
        try:
            snap = load_page_snapshot(d, bundle, name)
            break
        except FileNotFoundError:
            continue
    if snap is None:
        typer.secho("snapshot not found", err=True)
        raise typer.Exit(code=1)
    try:
        if against == "current":
            if session is None and device_sn is None:
                typer.secho("--against current requires --session or --device-sn", err=True)
                raise typer.Exit(code=2)
            cur = _live_payload(device_sn=device_sn, session_file=session)
        else:
            cur = _load_payload_from_file(Path(against))
        out = diff_snapshots(snap, cur)
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo(json.dumps(out, ensure_ascii=False))

"""Flat finder over live UI dumps."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from hylyre.cli.commands.loop_cmd import execute_dump_ui_dict
from hylyre.diagnostic_log import diagnostic_log
from hylyre.ui_dump_filter import DumpFilterSpec


def find_in_payload(
    payload: dict[str, Any],
    *,
    by_text: str | None = None,
    by_id_pattern: str | None = None,
    by_key_pattern: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Return hits plus planner hints copied from payload root."""
    tree = payload.get("tree")
    hints_raw = payload.get("_hylyre_hints")
    hints: dict[str, Any] = hints_raw if isinstance(hints_raw, dict) else {}
    if not isinstance(tree, dict):
        return {
            "hits": [],
            "_hylyre_hints": hints,
            "limit": limit,
            "truncated": False,
        }
    id_re = re.compile(by_id_pattern) if by_id_pattern else None
    key_re = re.compile(by_key_pattern) if by_key_pattern else None

    hits: list[dict[str, Any]] = []

    def walk(n: Any, depth: int = 0) -> None:
        if depth > 650 or len(hits) >= limit:
            return
        if not isinstance(n, dict):
            return
        attrs = n.get("attributes")
        if isinstance(attrs, dict):
            txt = str(attrs.get("text") or attrs.get("originalText") or "").strip()
            nid = str(attrs.get("id") or "").strip()
            key = str(attrs.get("key") or "").strip()
            ok = True
            if by_text is not None and by_text not in txt:
                ok = False
            if ok and id_re is not None and not id_re.search(nid):
                ok = False
            if ok and key_re is not None and not key_re.search(key):
                ok = False
            if ok:
                hits.append(
                    {
                        "type": str(attrs.get("type") or ""),
                        "text": txt,
                        "id": nid,
                        "key": key,
                        "bounds": attrs.get("bounds") or "",
                        "clickable": attrs.get("clickable") or "",
                        "scrollable": attrs.get("scrollable") or "",
                    }
                )
        for ch in n.get("children") or []:
            walk(ch, depth + 1)

    _t_walk = time.perf_counter()
    walk(tree)
    diagnostic_log(
        f"find_in_payload walk_ms={(time.perf_counter() - _t_walk) * 1000:.1f}"
    )
    truncated = len(hits) >= limit
    return {
        "hits": hits[:limit],
        "_hylyre_hints": hints,
        "limit": limit,
        "truncated": truncated,
    }


def find_live_elements(
    *,
    device_sn: str | None = None,
    session_file: Path | None = None,
    by_text: str | None = None,
    by_id_pattern: str | None = None,
    by_key_pattern: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    payload = execute_dump_ui_dict(
        device_sn=device_sn,
        session_file=session_file,
        dump_filter=DumpFilterSpec(full=True),
    )
    return find_in_payload(
        payload,
        by_text=by_text,
        by_id_pattern=by_id_pattern,
        by_key_pattern=by_key_pattern,
        limit=limit,
    )


def run_find_cli(
    *,
    device_sn: str | None,
    session_file: Path | None,
    by_text: str | None,
    by_id_pattern: str | None,
    by_key_pattern: str | None,
    limit: int,
) -> None:
    import typer

    if not any((by_text, by_id_pattern, by_key_pattern)):
        typer.secho(
            "pass at least one of --by-text / --by-id-pattern / --by-key-pattern",
            err=True,
        )
        raise typer.Exit(code=2)
    try:
        result = find_live_elements(
            device_sn=device_sn,
            session_file=session_file,
            by_text=by_text,
            by_id_pattern=by_id_pattern,
            by_key_pattern=by_key_pattern,
            limit=limit,
        )
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    typer.echo(json.dumps(result, ensure_ascii=False))

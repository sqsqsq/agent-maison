"""Scroll + merge helper for virtualized lists (bottom sheets, long lists)."""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.diagnostic_log import diagnostic_log
from hylyre.cli.commands.loop_cmd import _with_hypium_agent


def _build_swipe_payload(
    direction: str,
    distance: int,
    scroll_area: dict[str, str],
    scroll_root: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build swipe payload; adds ``scrollable: true`` when a scrollable root was found."""
    area: dict[str, Any] = dict(scroll_area)
    if scroll_root is not None:
        attrs = scroll_root.get("attributes") or {}
        if str(attrs.get("scrollable", "")).lower() == "true":
            area["scrollable"] = True
    return {"swipe": {"direction": direction, "distance": distance, "area": area}}


def _selector_matches(attrs: dict[str, Any], scroll_area: dict[str, str]) -> bool:
    if "by_type" in scroll_area:
        if str(attrs.get("type")) != str(scroll_area["by_type"]):
            return False
    if "by_id" in scroll_area:
        if str(attrs.get("id")) != str(scroll_area["by_id"]):
            return False
    if "by_text" in scroll_area:
        t = str(attrs.get("text") or attrs.get("originalText") or "")
        if str(scroll_area["by_text"]) not in t:
            return False
    if "by_key" in scroll_area:
        if str(attrs.get("key")) != str(scroll_area["by_key"]):
            return False
    return True


def find_container_root(
    node: Any, scroll_area: dict[str, str], depth: int = 0
) -> Any:
    """First DFS match: selector only (no scrollable requirement)."""
    if depth > 600 or not isinstance(node, dict):
        return None
    attrs = node.get("attributes")
    if isinstance(attrs, dict) and _selector_matches(attrs, scroll_area):
        return node
    for ch in node.get("children") or []:
        hit = find_container_root(ch, scroll_area, depth + 1)
        if hit is not None:
            return hit
    return None


def find_scroll_root(node: Any, scroll_area: dict[str, str], depth: int = 0) -> Any:
    """First DFS match: scrollable + selector."""
    if depth > 600 or not isinstance(node, dict):
        return None
    attrs = node.get("attributes")
    if isinstance(attrs, dict):
        scrollable = str(attrs.get("scrollable", "")).lower() == "true"
        if scrollable and _selector_matches(attrs, scroll_area):
            return node
    for ch in node.get("children") or []:
        hit = find_scroll_root(ch, scroll_area, depth + 1)
        if hit is not None:
            return hit
    return None


def gather_text_items(
    node: Any,
    pattern_re: re.Pattern[str] | None,
    acc: list[dict[str, Any]],
    depth: int = 0,
) -> None:
    if depth > 600 or not isinstance(node, dict):
        return
    attrs = node.get("attributes")
    if isinstance(attrs, dict):
        typ = str(attrs.get("type") or "")
        text = str(attrs.get("text") or attrs.get("originalText") or "").strip()
        if typ == "Text" and text:
            row = {
                "text": text,
                "id": str(attrs.get("id") or ""),
                "key": str(attrs.get("key") or ""),
                "bounds": attrs.get("bounds") or "",
                "type": typ,
            }
            blob = " ".join((row["id"], row["key"], row["text"]))
            if pattern_re is None or pattern_re.search(blob):
                acc.append(row)
    for ch in node.get("children") or []:
        gather_text_items(ch, pattern_re, acc, depth + 1)


def normalize_collect_params(params: dict[str, Any]) -> dict[str, Any]:
    """Merge CLI flags into rpc params."""
    scroll_area: dict[str, str] = {}
    if params.get("scroll_by_id"):
        scroll_area["by_id"] = str(params["scroll_by_id"])
    elif params.get("scroll_by_text"):
        scroll_area["by_text"] = str(params["scroll_by_text"])
    elif params.get("scroll_by_key"):
        scroll_area["by_key"] = str(params["scroll_by_key"])
    else:
        scroll_area["by_type"] = str(params.get("scroll_by_type") or "Scroll")
    out = {
        "scroll_area": scroll_area,
        "item_pattern": params.get("item_pattern"),
        "max_scrolls": int(params.get("max_scrolls") or 10),
        "swipe_distance": int(params.get("swipe_distance") or 60),
        "max_stable_rounds": int(params.get("max_stable_rounds") or 2),
        "reset_to_top": bool(params.get("reset_to_top")),
        "bidirectional": bool(params.get("bidirectional")),
        "early_bounce_break": bool(params.get("early_bounce_break", True)),
    }
    return out


def _visible_rows_fingerprint(
    tree: dict[str, Any],
    scroll_area: dict[str, str],
    pattern_re: re.Pattern[str] | None,
) -> frozenset[tuple[str, str, str]]:
    scroll_root = find_scroll_root(tree, scroll_area)
    acc: list[dict[str, Any]] = []
    if scroll_root is not None:
        gather_text_items(scroll_root, pattern_re, acc)
    else:
        gather_text_items(tree, pattern_re, acc)
    return frozenset((r["id"], r["key"], r["text"]) for r in acc)


async def _swipe_until_viewport_stable(
    agent: HylyreAgent,
    *,
    scroll_area: dict[str, str],
    direction: str,
    swipe_distance: int,
    stable_need: int,
    max_swipes: int,
    pattern_re: re.Pattern[str] | None,
    early_bounce_break: bool,
    phase: str,
) -> int:
    """Swipe inside scroll_area until visible Text fingerprint stops changing."""
    stable = 0
    prev_fp: frozenset[tuple[str, str, str]] | None = None
    iterations_done = 0
    fp_checkpoint: frozenset[tuple[str, str, str]] | None = None
    for i in range(max_swipes):
        iterations_done = i + 1
        t_dump = time.perf_counter()
        tree_payload = await agent.dump_ui()
        dump_ms = (time.perf_counter() - t_dump) * 1000.0
        tree = tree_payload.get("tree") if isinstance(tree_payload, dict) else None
        if not isinstance(tree, dict):
            break
        fp = _visible_rows_fingerprint(tree, scroll_area, pattern_re)
        scroll_root = find_scroll_root(tree, scroll_area)

        if (
            early_bounce_break
            and fp_checkpoint is not None
            and fp == fp_checkpoint
        ):
            diagnostic_log(
                f"collect_list phase={phase} iter={iterations_done} "
                f"dir={direction} early_bounce=1 dump_ms={dump_ms:.1f}"
            )
            break

        diagnostic_log(
            f"collect_list phase={phase} iter={iterations_done} dir={direction} "
            f"dump_ms={dump_ms:.1f}"
        )

        if prev_fp is not None and fp == prev_fp:
            stable += 1
            if stable >= stable_need:
                break
        else:
            stable = 0
        prev_fp = fp
        if scroll_root is None:
            break
        fp_checkpoint = fp
        payload = _build_swipe_payload(
            direction, swipe_distance, scroll_area, scroll_root,
        )
        t_swipe = time.perf_counter()
        await agent.run_planned_swipe(payload)
        swipe_ms = (time.perf_counter() - t_swipe) * 1000.0
        diagnostic_log(
            f"collect_list phase={phase} iter={iterations_done} dir={direction} "
            f"swipe_ms={swipe_ms:.1f}"
        )
    return iterations_done


async def _collect_merge_direction(
    agent: HylyreAgent,
    *,
    scroll_area: dict[str, str],
    pattern_re: re.Pattern[str] | None,
    direction: str,
    swipe_distance: int,
    stable_need: int,
    max_scrolls: int,
    items: list[dict[str, Any]],
    seen: set[tuple[str, str, str]],
    early_bounce_break: bool,
    phase: str,
) -> int:
    stable = 0
    iterations_done = 0
    fp_checkpoint: frozenset[tuple[str, str, str]] | None = None
    for i in range(max_scrolls):
        iterations_done = i + 1
        t_dump = time.perf_counter()
        tree_payload = await agent.dump_ui()
        dump_ms = (time.perf_counter() - t_dump) * 1000.0
        tree = tree_payload.get("tree") if isinstance(tree_payload, dict) else None
        if not isinstance(tree, dict):
            break

        scroll_root = find_scroll_root(tree, scroll_area)
        acc: list[dict[str, Any]] = []
        if scroll_root is not None:
            gather_text_items(scroll_root, pattern_re, acc)
        else:
            gather_text_items(tree, pattern_re, acc)

        fp = _visible_rows_fingerprint(tree, scroll_area, pattern_re)

        if (
            early_bounce_break
            and fp_checkpoint is not None
            and fp == fp_checkpoint
        ):
            diagnostic_log(
                f"collect_list phase={phase} iter={iterations_done} "
                f"dir={direction} early_bounce=1 dump_ms={dump_ms:.1f}"
            )
            break

        diagnostic_log(
            f"collect_list phase={phase} iter={iterations_done} dir={direction} "
            f"dump_ms={dump_ms:.1f}"
        )

        added = 0
        for row in acc:
            rfp = (row["id"], row["key"], row["text"])
            if rfp not in seen:
                seen.add(rfp)
                items.append(row)
                added += 1

        if added == 0:
            stable += 1
            if stable >= stable_need:
                break
        else:
            stable = 0

        if scroll_root is None:
            break

        fp_checkpoint = fp
        payload = _build_swipe_payload(
            direction, swipe_distance, scroll_area, scroll_root,
        )
        t_swipe = time.perf_counter()
        await agent.run_planned_swipe(payload)
        swipe_ms = (time.perf_counter() - t_swipe) * 1000.0
        diagnostic_log(
            f"collect_list phase={phase} iter={iterations_done} dir={direction} "
            f"swipe_ms={swipe_ms:.1f}"
        )

    return iterations_done


async def collect_list_on_agent(
    agent: HylyreAgent, params: dict[str, Any]
) -> dict[str, Any]:
    """Accept either CLI-shaped params (scroll_by_*) or normalized RPC params (scroll_area)."""
    if "scroll_area" in params:
        scroll_area = dict(params["scroll_area"])
        ip = params.get("item_pattern")
        pattern_re = re.compile(str(ip)) if ip else None
        max_scrolls = int(params.get("max_scrolls") or 10)
        swipe_distance = int(params.get("swipe_distance") or 60)
        stable_need = max(1, int(params.get("max_stable_rounds") or 2))
        reset_to_top = bool(params.get("reset_to_top"))
        bidirectional = bool(params.get("bidirectional"))
        early_bounce_break = bool(params.get("early_bounce_break", True))
    else:
        p = normalize_collect_params(params)
        scroll_area = p["scroll_area"]
        pattern_re = (
            re.compile(str(p["item_pattern"])) if p.get("item_pattern") else None
        )
        max_scrolls = p["max_scrolls"]
        swipe_distance = p["swipe_distance"]
        stable_need = max(1, p["max_stable_rounds"])
        reset_to_top = p["reset_to_top"]
        bidirectional = p["bidirectional"]
        early_bounce_break = p["early_bounce_break"]

    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    iterations_reset = 0
    if reset_to_top:
        iterations_reset = await _swipe_until_viewport_stable(
            agent,
            scroll_area=scroll_area,
            direction="DOWN",
            swipe_distance=swipe_distance,
            stable_need=stable_need,
            max_swipes=max_scrolls,
            pattern_re=pattern_re,
            early_bounce_break=early_bounce_break,
            phase="reset_to_top",
        )

    iterations_up = await _collect_merge_direction(
        agent,
        scroll_area=scroll_area,
        pattern_re=pattern_re,
        direction="UP",
        swipe_distance=swipe_distance,
        stable_need=stable_need,
        max_scrolls=max_scrolls,
        items=items,
        seen=seen,
        early_bounce_break=early_bounce_break,
        phase="merge_up",
    )

    iterations_down = 0
    if bidirectional:
        iterations_down = await _collect_merge_direction(
            agent,
            scroll_area=scroll_area,
            pattern_re=pattern_re,
            direction="DOWN",
            swipe_distance=swipe_distance,
            stable_need=stable_need,
            max_scrolls=max_scrolls,
            items=items,
            seen=seen,
            early_bounce_break=early_bounce_break,
            phase="merge_down",
        )

    return {
        "items": items,
        "iterations": iterations_reset + iterations_up + iterations_down,
        "iterations_reset": iterations_reset,
        "iterations_up": iterations_up,
        "iterations_down": iterations_down,
        "unique_count": len(items),
        "scroll_area": scroll_area,
        "reset_to_top": reset_to_top,
        "bidirectional": bidirectional,
        "early_bounce_break": early_bounce_break,
    }


def execute_collect_list(
    *,
    params: dict[str, Any],
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
) -> dict[str, Any]:
    if session_file is not None:
        from hylyre.session.client import session_ipc_call

        return session_ipc_call(
            session_file, "collect_list", normalize_collect_params(params)
        )

    async def _go(agent: HylyreAgent) -> dict[str, Any]:
        return await collect_list_on_agent(agent, params)

    return asyncio.run(
        _with_hypium_agent(
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            fn=_go,
        )
    )


def run_collect_list_cli(
    *,
    out: Path | None,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    session_file: Path | None,
    scroll_by_type: str | None,
    scroll_by_text: str | None,
    scroll_by_id: str | None,
    scroll_by_key: str | None,
    item_pattern: str | None,
    max_scrolls: int,
    swipe_distance: int,
    max_stable_rounds: int,
    reset_to_top: bool,
    bidirectional: bool,
    early_bounce_break: bool,
) -> None:
    import typer

    params: dict[str, Any] = {
        "scroll_by_type": scroll_by_type,
        "scroll_by_text": scroll_by_text,
        "scroll_by_id": scroll_by_id,
        "scroll_by_key": scroll_by_key,
        "item_pattern": item_pattern,
        "max_scrolls": max_scrolls,
        "swipe_distance": swipe_distance,
        "max_stable_rounds": max_stable_rounds,
        "reset_to_top": reset_to_top,
        "bidirectional": bidirectional,
        "early_bounce_break": early_bounce_break,
    }
    opts = [
        scroll_by_type,
        scroll_by_text,
        scroll_by_id,
        scroll_by_key,
    ]
    if sum(1 for x in opts if x) > 1:
        typer.secho(
            "pass at most one of --scroll-by-type/text/id/key", err=True
        )
        raise typer.Exit(code=2)
    try:
        result = execute_collect_list(
            params=params,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session_file,
        )
    except ImportError as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=2) from e
    except Exception as e:
        typer.secho(str(e), err=True)
        raise typer.Exit(code=1) from e
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if out is not None:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(text + "\n", encoding="utf-8")
        typer.echo(str(Path(out).resolve()))
    else:
        typer.echo(text)

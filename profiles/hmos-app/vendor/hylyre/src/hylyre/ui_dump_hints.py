"""Augment Hypium UI dump JSON with planner-facing hints (scroll / truncation)."""

from __future__ import annotations

import re
import time
from typing import Any

from hylyre.diagnostic_log import diagnostic_log


_BOUNDS_RE = re.compile(r"^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$")


def parse_bounds_rect(value: str | None) -> tuple[int, int, int, int] | None:
    if not value or not isinstance(value, str):
        return None
    m = _BOUNDS_RE.match(value.strip())
    if not m:
        return None
    x1, y1, x2, y2 = (int(m.group(i)) for i in range(1, 5))
    return (x1, y1, x2, y2)


def _walk_scroll_hints(node: Any, acc: list[dict[str, Any]], depth: int) -> None:
    if depth > 400 or not isinstance(node, dict):
        return
    attrs = node.get("attributes")
    if not isinstance(attrs, dict):
        attrs = {}
    typ = str(attrs.get("type") or "")
    scrollable = str(attrs.get("scrollable", "")).lower() == "true"
    bounds_s = attrs.get("bounds")
    orig_s = attrs.get("origBounds") or attrs.get("orig_bounds")
    bounds = parse_bounds_rect(bounds_s if isinstance(bounds_s, str) else None)
    orig = parse_bounds_rect(orig_s if isinstance(orig_s, str) else None)

    if scrollable and typ in ("Scroll", "List", "Grid", "WaterFlow"):
        hint: dict[str, Any] = {
            "control_type": typ,
            "bounds": bounds_s,
            "origBounds": orig_s,
            "id": attrs.get("id") or "",
            "key": attrs.get("key") or "",
        }
        if bounds and orig:
            # Content extends below visible clip (common virtualized list signal)
            if orig[3] > bounds[3] + 4:
                hint["likely_more_content_below"] = True
            if orig[2] > bounds[2] + 4:
                hint["likely_more_content_right"] = True
        acc.append(hint)

    for ch in node.get("children") or []:
        _walk_scroll_hints(ch, acc, depth + 1)


def augment_ui_dump_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of payload with ``_hylyre_hints`` inserted."""
    out = dict(payload)
    tree = out.get("tree")
    scroll_hints: list[dict[str, Any]] = []
    t_w = time.perf_counter()
    if isinstance(tree, dict):
        _walk_scroll_hints(tree, scroll_hints, 0)
    diagnostic_log(
        f"augment_ui_dump_payload walk_ms={(time.perf_counter() - t_w) * 1000:.1f}"
    )
    out["_hylyre_hints"] = {
        "scrollable_containers": scroll_hints[:80],
        "scrollable_container_count": len(scroll_hints),
    }
    return out

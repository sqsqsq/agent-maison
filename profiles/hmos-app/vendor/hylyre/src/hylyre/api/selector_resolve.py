"""Resolve rich selector predicates against a Hypium UI dump tree."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from hylyre.api.exceptions import SelectorResolutionError
from hylyre.ui_dump_hints import parse_bounds_rect

_OVERLAY_TYPE_MARKERS = (
    "Sheet",
    "Dialog",
    "Popup",
    "Menu",
    "ModalWindow",
    "Overlay",
    "BindSheet",
)

_RICH_PREDICATE_KEYS = frozenset(
    {
        "scope",
        "within",
        "below",
        "above",
        "after",
        "before",
        "all",
        "index",
        "match",
        "visible",
        "clickable",
        "enabled",
        "by_type",
        "scroll_into_view",
        "prefer_native_text",
    }
)

_MAX_ENABLED_ANCESTOR_AREA_RATIO = 0.85


@dataclass(frozen=True)
class ResolvedHit:
    center: tuple[int, int]
    tap_bounds: str
    attrs: dict[str, Any]
    overlay_rank: int
    depth: int
    tree_index: int
    type: str = ""
    text: str = ""
    id: str = ""
    key: str = ""
    clickable: bool = False
    enabled: bool = False

    def summary_row(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "text": self.text,
            "id": self.id,
            "key": self.key,
            "bounds": self.tap_bounds,
            "overlay_rank": self.overlay_rank,
            "center": list(self.center),
            "clickable": self.clickable,
            "enabled": self.enabled,
        }


@dataclass
class _FlatNode:
    node: dict[str, Any]
    attrs: dict[str, Any]
    depth: int
    tree_index: int
    overlay_rank: int
    parent_indices: tuple[int, ...]
    path_key: tuple[int, ...]


def has_rich_selector_fields(block: dict[str, Any]) -> bool:
    if not isinstance(block, dict):
        return False
    if block.get("all") is not None:
        return True
    if any(block.get(k) is not None for k in _RICH_PREDICATE_KEYS):
        return True
    base_count = sum(
        1 for k in ("by_text", "by_id", "by_type", "by_key", "x", "y") if block.get(k) is not None
    )
    return base_count > 1


def _attr_bool(attrs: dict[str, Any], key: str) -> bool:
    return str(attrs.get(key, "")).lower() == "true"


def _node_text(attrs: dict[str, Any]) -> str:
    return str(attrs.get("text") or attrs.get("originalText") or "").strip()


def _is_overlay_type(typ: str) -> bool:
    t = str(typ or "")
    return any(m in t for m in _OVERLAY_TYPE_MARKERS)


def _bounds_area(rect: tuple[int, int, int, int] | None) -> int:
    if rect is None:
        return 0
    x1, y1, x2, y2 = rect
    return max(0, x2 - x1) * max(0, y2 - y1)


def _center_of_bounds(bounds_s: str | None) -> tuple[int, int] | None:
    rect = parse_bounds_rect(bounds_s if isinstance(bounds_s, str) else None)
    if rect is None:
        return None
    x1, y1, x2, y2 = rect
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def _center_in_bounds(center: tuple[int, int], bounds_s: str) -> bool:
    rect = parse_bounds_rect(bounds_s if bounds_s else None)
    if rect is None:
        return False
    x, y = center
    x1, y1, x2, y2 = rect
    return x1 <= x <= x2 and y1 <= y <= y2


def _hit_with_match_node_center(hit: ResolvedHit, fn: _FlatNode) -> ResolvedHit:
    match_bounds = str(fn.attrs.get("bounds") or "")
    mc = _center_of_bounds(match_bounds)
    if mc is None:
        return hit
    return ResolvedHit(
        center=mc,
        tap_bounds=match_bounds,
        attrs=dict(fn.attrs),
        overlay_rank=fn.overlay_rank,
        depth=fn.depth,
        tree_index=fn.tree_index,
        type=str(fn.attrs.get("type") or ""),
        text=_node_text(fn.attrs),
        id=str(fn.attrs.get("id") or ""),
        key=str(fn.attrs.get("key") or ""),
        clickable=_attr_bool(fn.attrs, "clickable"),
        enabled=_attr_bool(fn.attrs, "enabled"),
    )


def _is_usable_tap_hit(hit: ResolvedHit) -> bool:
    rect = parse_bounds_rect(hit.tap_bounds if hit.tap_bounds else None)
    if rect is None or _bounds_area(rect) <= 0:
        return False
    x, y = hit.center
    x1, y1, x2, y2 = rect
    return x1 <= x <= x2 and y1 <= y <= y2


def finalize_tap_hit(
    tree: dict[str, Any],
    pred: dict[str, Any],
    hit: ResolvedHit,
) -> ResolvedHit:
    """Ensure tap center is usable; fall back to matched node center when lift is degenerate."""
    if _is_usable_tap_hit(hit):
        return hit
    work_pred = dict(pred)
    work_pred.pop("scope", None)
    work_pred.pop("within", None)
    for root in _search_roots(tree, pred):
        flat, screen_area = _flatten_subtree(root)
        for fn in flat:
            if not _pred_matches_node(flat, fn, work_pred, screen_area=screen_area):
                continue
            remediated = _hit_with_match_node_center(hit, fn)
            if _is_usable_tap_hit(remediated):
                return remediated
            alt = _flat_to_hit(fn)
            if alt and _is_usable_tap_hit(alt):
                return alt
    return hit


def pick_best_tap_hit(hits: list[ResolvedHit]) -> ResolvedHit | None:
    ordered = _sort_hits(hits)
    for hit in ordered:
        if _is_usable_tap_hit(hit):
            return hit
    return ordered[0] if ordered else None


def _uses_text_lift(work_pred: dict[str, Any]) -> bool:
    return work_pred.get("by_text") is not None or (
        work_pred.get("all")
        and any(
            isinstance(s, dict) and s.get("by_text") is not None
            for s in (work_pred.get("all") or [])
        )
    )


def resolve_first_hit_match_center_in_container(
    tree: dict[str, Any],
    pred: dict[str, Any],
    container_bounds_s: str,
) -> ResolvedHit | None:
    """Full-tree resolve; accept when matched node center is inside container bounds."""
    if not container_bounds_s:
        return None
    work_pred = dict(pred)
    work_pred.pop("scope", None)
    work_pred.pop("within", None)

    candidates: list[ResolvedHit] = []
    for root in _search_roots(tree, pred):
        flat, screen_area = _flatten_subtree(root)
        for fn in flat:
            if not _pred_matches_node(flat, fn, work_pred, screen_area=screen_area):
                continue
            match_center = _center_of_bounds(str(fn.attrs.get("bounds") or ""))
            if match_center is None or not _center_in_bounds(
                match_center, container_bounds_s
            ):
                continue
            if _uses_text_lift(work_pred):
                lifted = _lift_tap_target(flat, fn.tree_index, screen_area=screen_area)
                hit = _flat_to_hit(lifted)
            else:
                hit = _flat_to_hit(fn)
            if hit is None:
                continue
            if not _center_in_bounds(hit.center, container_bounds_s):
                hit = _hit_with_match_node_center(hit, fn)
            hit = finalize_tap_hit(tree, pred, hit)
            if _is_usable_tap_hit(hit):
                candidates.append(hit)
    if not candidates:
        return None
    return _sort_hits(candidates)[0]


def _find_overlay_roots(tree: dict[str, Any]) -> list[dict[str, Any]]:
    overlays: list[dict[str, Any]] = []

    def walk(node: Any, depth: int = 0) -> None:
        if depth > 700 or not isinstance(node, dict):
            return
        attrs = node.get("attributes")
        if isinstance(attrs, dict) and _is_overlay_type(str(attrs.get("type") or "")):
            overlays.append(node)
        for ch in node.get("children") or []:
            if isinstance(ch, dict):
                walk(ch, depth + 1)

    walk(tree)
    return overlays


def _flatten_subtree(
    root: dict[str, Any],
    *,
    overlay_rank_start: int = 0,
    path_prefix: tuple[int, ...] = (),
) -> tuple[list[_FlatNode], int]:
    flat: list[_FlatNode] = []
    screen_area = 1
    root_attrs = root.get("attributes")
    if isinstance(root_attrs, dict):
        rr = parse_bounds_rect(str(root_attrs.get("bounds") or ""))
        if rr:
            screen_area = _bounds_area(rr) or 1

    def walk(
        node: dict[str, Any],
        depth: int,
        overlay_rank: int,
        parent_indices: tuple[int, ...],
        path_key: tuple[int, ...],
    ) -> None:
        if depth > 700:
            return
        attrs = node.get("attributes")
        if not isinstance(attrs, dict):
            attrs = {}
        typ = str(attrs.get("type") or "")
        rank = overlay_rank + (1 if _is_overlay_type(typ) else 0)
        idx = len(flat)
        flat.append(
            _FlatNode(
                node=node,
                attrs=attrs,
                depth=depth,
                tree_index=idx,
                overlay_rank=rank,
                parent_indices=parent_indices,
                path_key=path_key,
            )
        )
        children = node.get("children") or []
        if not isinstance(children, list):
            return
        new_parents = parent_indices + (idx,)
        for i, ch in enumerate(children):
            if isinstance(ch, dict):
                walk(ch, depth + 1, rank, new_parents, path_key + (i,))

    walk(root, 0, overlay_rank_start, (), path_prefix)
    return flat, screen_area


def _lift_tap_target(
    flat: list[_FlatNode],
    match_idx: int,
    *,
    screen_area: int,
) -> _FlatNode:
    fn = flat[match_idx]

    def area_of(node: _FlatNode) -> int:
        return _bounds_area(parse_bounds_rect(str(node.attrs.get("bounds") or "")))

    for anc_idx in reversed(fn.parent_indices + (match_idx,)):
        anc = flat[anc_idx]
        if _attr_bool(anc.attrs, "clickable"):
            return anc

    max_area = int(screen_area * _MAX_ENABLED_ANCESTOR_AREA_RATIO) if screen_area else 0
    for anc_idx in reversed(fn.parent_indices + (match_idx,)):
        anc = flat[anc_idx]
        if not _attr_bool(anc.attrs, "enabled"):
            continue
        if max_area and area_of(anc) > max_area:
            continue
        return anc
    return fn


def _text_matches(text: str, pattern: str, match_mode: str) -> bool:
    if match_mode == "exact":
        return text == pattern
    return pattern in text


def _base_selector_match(attrs: dict[str, Any], pred: dict[str, Any]) -> bool:
    match_mode = str(pred.get("match") or "contains")
    if pred.get("by_text") is not None:
        if not _text_matches(_node_text(attrs), str(pred["by_text"]), match_mode):
            return False
    if pred.get("by_id") is not None:
        if str(attrs.get("id") or "") != str(pred["by_id"]):
            return False
    if pred.get("by_type") is not None:
        if str(attrs.get("type") or "") != str(pred["by_type"]):
            return False
    if pred.get("by_key") is not None:
        if str(attrs.get("key") or "") != str(pred["by_key"]):
            return False
    return True


def _filter_match(attrs: dict[str, Any], pred: dict[str, Any]) -> bool:
    if pred.get("visible") is True:
        rect = parse_bounds_rect(str(attrs.get("bounds") or ""))
        if rect is None or _bounds_area(rect) <= 0:
            return False
    if pred.get("clickable") is True and not _attr_bool(attrs, "clickable"):
        return False
    if pred.get("enabled") is True and not _attr_bool(attrs, "enabled"):
        return False
    return True


def _resolve_anchor_indices(
    flat: list[_FlatNode], anchor: dict[str, Any], *, screen_area: int
) -> list[int]:
    hits: list[int] = []
    for i, fn in enumerate(flat):
        if not _base_selector_match(fn.attrs, anchor):
            continue
        lifted = _lift_tap_target(flat, i, screen_area=screen_area)
        if _filter_match(lifted.attrs, anchor):
            hits.append(lifted.tree_index)
    return hits


def _relative_match(
    flat: list[_FlatNode],
    target_idx: int,
    *,
    anchor_indices: list[int],
    relation: str,
) -> bool:
    if not anchor_indices:
        return True
    tfn = flat[target_idx]
    if relation == "within":
        for a in anchor_indices:
            if target_idx == a or a in tfn.parent_indices:
                return True
        return False
    if relation == "after":
        return any(target_idx > a for a in anchor_indices)
    if relation == "before":
        return any(target_idx < a for a in anchor_indices)
    if relation in ("below", "above"):
        t_rect = parse_bounds_rect(str(tfn.attrs.get("bounds") or ""))
        if t_rect is None:
            return False
        t_y = (t_rect[1] + t_rect[3]) // 2
        for a in anchor_indices:
            a_rect = parse_bounds_rect(str(flat[a].attrs.get("bounds") or ""))
            if a_rect is None:
                continue
            a_y = (a_rect[1] + a_rect[3]) // 2
            if relation == "below" and t_y > a_y:
                return True
            if relation == "above" and t_y < a_y:
                return True
        return False
    return True


def _single_pred_on_flat(
    flat: list[_FlatNode],
    fn: _FlatNode,
    pred: dict[str, Any],
    *,
    screen_area: int,
) -> bool:
    has_base = any(pred.get(k) is not None for k in ("by_text", "by_id", "by_type", "by_key"))
    if has_base and not _base_selector_match(fn.attrs, pred):
        return False

    if pred.get("by_text") is not None:
        target = _lift_tap_target(flat, fn.tree_index, screen_area=screen_area)
    else:
        target = fn

    tattrs = target.attrs
    for k in ("by_type", "by_id", "by_key"):
        if pred.get(k) is not None:
            if not _base_selector_match(tattrs, {k: pred[k]}):
                return False
    if not _filter_match(tattrs, pred):
        return False

    for rel in ("within", "below", "above", "after", "before"):
        anchor = pred.get(rel)
        if anchor is None:
            continue
        if not isinstance(anchor, dict):
            return False
        anchor_idx = _resolve_anchor_indices(flat, anchor, screen_area=screen_area)
        if not _relative_match(
            flat, target.tree_index, anchor_indices=anchor_idx, relation=rel
        ):
            return False
    return True


def _pred_matches_node(
    flat: list[_FlatNode],
    fn: _FlatNode,
    pred: dict[str, Any],
    *,
    screen_area: int,
) -> bool:
    subs = pred.get("all")
    if subs is not None:
        if not isinstance(subs, list) or not subs:
            return False
        text_sub = next(
            (s for s in subs if isinstance(s, dict) and s.get("by_text") is not None),
            None,
        )
        if text_sub is not None:
            if not _base_selector_match(fn.attrs, text_sub):
                return False
            target = _lift_tap_target(flat, fn.tree_index, screen_area=screen_area)
            tidx = target.tree_index
        else:
            if not _single_pred_on_flat(flat, fn, subs[0], screen_area=screen_area):
                return False
            target = fn
            tidx = fn.tree_index
        for s in subs:
            if not isinstance(s, dict):
                return False
            if s is text_sub:
                continue
            sp = dict(s)
            for rel in ("within", "below", "above", "after", "before"):
                sp.pop(rel, None)
            tattrs = target.attrs
            for k in ("by_type", "by_id", "by_key", "by_text"):
                if sp.get(k) is not None:
                    if not _base_selector_match(tattrs, {k: sp[k]}):
                        return False
            if not _filter_match(tattrs, sp):
                return False
        for s in subs:
            if not isinstance(s, dict):
                return False
            for rel in ("within", "below", "above", "after", "before"):
                anchor = s.get(rel)
                if anchor is None:
                    continue
                if not isinstance(anchor, dict):
                    return False
                anchor_idx = _resolve_anchor_indices(flat, anchor, screen_area=screen_area)
                if not _relative_match(
                    flat, tidx, anchor_indices=anchor_idx, relation=rel
                ):
                    return False
        return True
    return _single_pred_on_flat(flat, fn, pred, screen_area=screen_area)


def _flat_to_hit(fn: _FlatNode) -> ResolvedHit | None:
    bounds_s = str(fn.attrs.get("bounds") or "")
    center = _center_of_bounds(bounds_s)
    if center is None:
        return None
    return ResolvedHit(
        center=center,
        tap_bounds=bounds_s,
        attrs=dict(fn.attrs),
        overlay_rank=fn.overlay_rank,
        depth=fn.depth,
        tree_index=fn.tree_index,
        type=str(fn.attrs.get("type") or ""),
        text=_node_text(fn.attrs),
        id=str(fn.attrs.get("id") or ""),
        key=str(fn.attrs.get("key") or ""),
        clickable=_attr_bool(fn.attrs, "clickable"),
        enabled=_attr_bool(fn.attrs, "enabled"),
    )


def _sort_hits(hits: list[ResolvedHit]) -> list[ResolvedHit]:
    return sorted(
        hits,
        key=lambda h: (-h.overlay_rank, -int(h.clickable), -int(h.enabled), h.tree_index),
    )


def _search_roots(tree: dict[str, Any], pred: dict[str, Any]) -> list[dict[str, Any]]:
    scope = pred.get("scope")
    within = pred.get("within")
    if scope == "top_overlay":
        overlays = _find_overlay_roots(tree)
        if overlays:
            return [overlays[-1]]
    if isinstance(within, dict):
        flat_all, sa = _flatten_subtree(tree)
        roots: list[dict[str, Any]] = []
        for fn in flat_all:
            if _single_pred_on_flat(flat_all, fn, within, screen_area=sa):
                roots.append(fn.node)
        return roots if roots else []
    return [tree]


def resolve_targets(tree: dict[str, Any], pred: dict[str, Any]) -> list[ResolvedHit]:
    if not isinstance(tree, dict):
        raise SelectorResolutionError("tree must be a dict")
    if not isinstance(pred, dict):
        raise SelectorResolutionError("pred must be a dict")

    work_pred = dict(pred)
    work_pred.pop("scope", None)
    work_pred.pop("within", None)

    raw_hits: list[ResolvedHit] = []
    seen: set[tuple[int, int]] = set()

    for root in _search_roots(tree, pred):
        flat, screen_area = _flatten_subtree(root)
        for fn in flat:
            if not _pred_matches_node(flat, fn, work_pred, screen_area=screen_area):
                continue
            if work_pred.get("by_text") is not None or (
                work_pred.get("all")
                and any(
                    isinstance(s, dict) and s.get("by_text") is not None
                    for s in (work_pred.get("all") or [])
                )
            ):
                lifted = _lift_tap_target(flat, fn.tree_index, screen_area=screen_area)
                hit = _flat_to_hit(lifted)
            else:
                hit = _flat_to_hit(fn)
            if hit is None or hit.center in seen:
                continue
            seen.add(hit.center)
            raw_hits.append(hit)

    ordered = _sort_hits(raw_hits)
    index_raw = pred.get("index")
    if index_raw is not None:
        idx = int(index_raw)
        if idx < 0 or idx >= len(ordered):
            raise SelectorResolutionError(
                f"index {idx} out of range for {len(ordered)} hit(s)",
                candidates_summary=[h.summary_row() for h in ordered],
            )
        return [ordered[idx]]
    return ordered


def resolve_one(tree: dict[str, Any], pred: dict[str, Any]) -> ResolvedHit:
    hits = resolve_targets(tree, pred)
    if not hits:
        raise SelectorResolutionError(
            f"no matching UI target for predicate {pred!r}",
            candidates_summary=[],
        )
    return hits[0]


def candidates_summary(hits: list[ResolvedHit]) -> list[dict[str, Any]]:
    return [h.summary_row() for h in hits]

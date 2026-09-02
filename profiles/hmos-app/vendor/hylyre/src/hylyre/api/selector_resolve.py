"""Resolve rich selector predicates against a Hypium UI dump tree."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from hylyre.api.exceptions import SelectorContractError, SelectorResolutionError
from hylyre.api.selector_contract import normalize_match, text_matches
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
        "scrollable",
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
    requested_match: str | None = None
    effective_match: str = "contains"
    engine: str = "resolver"
    candidate_count: int = 0
    resolution_kind: str | None = None
    fragment_bounds: str | None = None
    node: dict[str, Any] | None = None

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
            "requested_match": self.requested_match,
            "effective_match": self.effective_match,
            "engine": self.engine,
            "candidate_count": self.candidate_count,
            "resolution_kind": self.resolution_kind,
            "fragment_bounds": self.fragment_bounds,
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
        node=fn.node,
    )


def _is_usable_tap_hit(hit: ResolvedHit) -> bool:
    rect = parse_bounds_rect(hit.tap_bounds if hit.tap_bounds else None)
    if rect is None or _bounds_area(rect) <= 0:
        return False
    x, y = hit.center
    x1, y1, x2, y2 = rect
    return x1 <= x <= x2 and y1 <= y <= y2


def _inline_fragments(attrs: dict[str, Any]) -> list[dict[str, Any]]:
    """Read only explicit fragment metadata; never infer it from character ranges."""

    for key in ("inline_fragments", "fragments", "spans", "inline_targets"):
        raw = attrs.get(key)
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
    return []


def _has_explicit_inline_metadata(attrs: dict[str, Any]) -> bool:
    """Return true only for dump metadata that explicitly describes rich text."""

    for key in (
        "rich_text",
        "is_rich_text",
        "inline",
        "is_inline",
        "aggregate_text",
        "inline_text",
        "inline_target",
    ):
        value = attrs.get(key)
        if isinstance(value, bool) and value:
            return True
        if isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"}:
            return True
    return any(
        isinstance(attrs.get(key), list)
        for key in ("inline_fragments", "fragments", "spans", "inline_targets")
    )


def _fragment_hit(
    fn: _FlatNode,
    fragment: dict[str, Any],
    *,
    requested_match: str | None,
    effective_match: str,
) -> ResolvedHit | None:
    text = str(fragment.get("text") or fragment.get("content") or "").strip()
    bounds = str(fragment.get("bounds") or fragment.get("fragment_bounds") or "")
    center = _center_of_bounds(bounds)
    semantic = fragment.get("action") or fragment.get("semantic_action")
    if center is None:
        raw_center = fragment.get("center")
        if isinstance(raw_center, (list, tuple)) and len(raw_center) >= 2:
            center = (int(raw_center[0]), int(raw_center[1]))
    clickable = str(fragment.get("clickable", "false")).lower() == "true"
    if not text or center is None or (not clickable and not semantic):
        return None
    merged = dict(fn.attrs)
    merged.update(fragment)
    merged["type"] = str(fragment.get("type") or "Span")
    return ResolvedHit(
        center=center,
        tap_bounds=bounds,
        attrs=merged,
        overlay_rank=fn.overlay_rank,
        depth=fn.depth,
        tree_index=fn.tree_index,
        type=str(merged.get("type") or "Span"),
        text=text,
        id=str(merged.get("id") or ""),
        key=str(merged.get("key") or ""),
        clickable=clickable,
        enabled=str(merged.get("enabled", "true")).lower() == "true",
        requested_match=requested_match,
        effective_match=effective_match,
        resolution_kind=("semantic_action" if semantic else "span_bounds"),
        fragment_bounds=bounds,
        node=fn.node,
    )


def _inline_hits_for_node(
    fn: _FlatNode,
    pred: dict[str, Any],
    *,
    requested_match: str | None,
    effective_match: str,
) -> list[ResolvedHit]:
    wanted = pred.get("by_text")
    if wanted is None:
        return []
    out: list[ResolvedHit] = []
    for fragment in _inline_fragments(fn.attrs):
        fragment_text = str(fragment.get("text") or fragment.get("content") or "").strip()
        if text_matches(fragment_text, str(wanted), effective_match):
            hit = _fragment_hit(
                fn,
                fragment,
                requested_match=requested_match,
                effective_match=effective_match,
            )
            if hit is not None:
                out.append(hit)
    return out


def _primary_text_predicate(pred: dict[str, Any]) -> dict[str, Any] | None:
    if pred.get("by_text") is not None:
        return pred
    subs = pred.get("all")
    if isinstance(subs, list):
        for sub in subs:
            if isinstance(sub, dict) and sub.get("by_text") is not None:
                return sub
    return None


def _text_predicate_with_inherited_match(
    pred: dict[str, Any], text_pred: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    selected = text_pred or _primary_text_predicate(pred)
    if selected is None:
        return None
    if selected.get("match") is not None or pred.get("match") is None:
        return selected
    inherited = dict(selected)
    inherited["match"] = pred["match"]
    return inherited


def _text_match_for_predicate(
    pred: dict[str, Any], text_pred: dict[str, Any] | None = None
) -> tuple[str | None, str]:
    selected = _text_predicate_with_inherited_match(pred, text_pred)
    source = selected or pred
    return normalize_match(source.get("match"), selector=source)


def _selector_evidence_for_predicate(
    pred: dict[str, Any],
    *,
    engine: str,
    candidate_count: int,
    selected_id: str | None = None,
    bounds: str | None = None,
) -> dict[str, Any]:
    requested, effective = _text_match_for_predicate(pred)
    return {
        "engine": engine,
        "requested_match": requested,
        "effective_match": effective,
        "candidate_count": int(candidate_count),
        "selected_id": selected_id,
        "bounds": bounds,
    }


def _inline_target_is_unresolvable(
    fn: _FlatNode,
    pred: dict[str, Any],
    *,
    text_pred: dict[str, Any] | None = None,
) -> bool:
    """Detect an explicitly inline-looking aggregate Text node with no real target."""

    selected = _text_predicate_with_inherited_match(pred, text_pred)
    if selected is None:
        return False
    wanted = selected.get("by_text")
    if wanted is None:
        return False
    attrs = fn.attrs
    typ = str(attrs.get("type") or "").lower()
    if typ != "text":
        return False
    node_text = _node_text(attrs)
    _requested, effective = _text_match_for_predicate(pred, selected)
    if not text_matches(node_text, str(wanted), effective):
        return False
    # The dump cannot distinguish a dynamic Row label from flattened rich
    # text by ancestor type.  Only an explicit host signal is authoritative.
    return _has_explicit_inline_metadata(attrs)


def _has_real_inline_descendant(
    flat: list[_FlatNode], fn: _FlatNode, pred: dict[str, Any]
) -> bool:
    selected = _text_predicate_with_inherited_match(pred)
    wanted = selected.get("by_text") if selected else None
    if wanted is None:
        return False
    _requested, effective = _text_match_for_predicate(pred, selected)
    for other in flat:
        if fn.tree_index not in other.parent_indices:
            continue
        typ = str(other.attrs.get("type") or "").lower()
        if typ not in {"span", "inline", "inlinetext"}:
            continue
        fragment_text = _node_text(other.attrs)
        if not text_matches(fragment_text, str(wanted), effective):
            continue
        center = _center_of_bounds(str(other.attrs.get("bounds") or ""))
        semantic = other.attrs.get("action") or other.attrs.get("semantic_action")
        if center is not None and (_attr_bool(other.attrs, "clickable") or semantic):
            return True
    return False


def _is_noninteractive_inline_node(fn: _FlatNode) -> bool:
    typ = str(fn.attrs.get("type") or "").lower()
    return typ in {"span", "inline", "inlinetext"} and not (
        _attr_bool(fn.attrs, "clickable")
        or fn.attrs.get("action")
        or fn.attrs.get("semantic_action")
    )


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
    _validate_selector_predicate(pred)
    if not container_bounds_s:
        return None
    work_pred = dict(pred)
    work_pred.pop("scope", None)
    work_pred.pop("within", None)
    text_pred = _text_predicate_with_inherited_match(pred)
    requested_match, effective_match = _text_match_for_predicate(pred, text_pred)

    candidates: list[ResolvedHit] = []
    has_unresolvable_inline_candidate = False
    for root in _search_roots(tree, pred):
        flat, screen_area = _flatten_subtree(root)
        for fn in flat:
            inline_hits = _inline_hits_for_node(
                fn,
                text_pred or work_pred,
                requested_match=requested_match,
                effective_match=effective_match,
            )
            for inline_hit in inline_hits:
                if _center_in_bounds(inline_hit.center, container_bounds_s):
                    candidates.append(inline_hit)
            if inline_hits:
                continue
            if not _pred_matches_node(flat, fn, work_pred, screen_area=screen_area):
                continue
            if text_pred is not None and _inline_target_is_unresolvable(
                fn, pred, text_pred=text_pred
            ):
                has_unresolvable_inline_candidate = True
            match_center = _center_of_bounds(str(fn.attrs.get("bounds") or ""))
            if match_center is None or not _center_in_bounds(
                match_center, container_bounds_s
            ):
                continue
            if _uses_text_lift(work_pred) and not _is_noninteractive_inline_node(fn):
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
    if has_unresolvable_inline_candidate and len(candidates) == 1:
        raise SelectorResolutionError(
            "inline target has no independently clickable bounds",
            failure_code="inline_target_unresolvable",
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=0
            ),
            evidence={
                "resolution_kind": "aggregate_text_only",
                "fragment_bounds": None,
            },
        )
    ordered = [
        replace(
            hit,
            requested_match=requested_match,
            effective_match=effective_match,
            candidate_count=len(candidates),
            engine="resolver",
        )
        for hit in _sort_hits(candidates)
    ]
    if len(ordered) > 1:
        raise SelectorResolutionError(
            f"ambiguous target inside container: {len(ordered)} candidates",
            candidates_summary=candidates_summary(ordered),
            failure_code="selector_ambiguous",
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=len(ordered)
            ),
            evidence={"candidate_count": len(ordered)},
        )
    return ordered[0]


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
    return text_matches(text, pattern, match_mode)


def _base_selector_match(attrs: dict[str, Any], pred: dict[str, Any]) -> bool:
    _requested, match_mode = normalize_match(
        pred.get("match"), selector=pred
    )
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
    if pred.get("scrollable") is True and not _attr_bool(attrs, "scrollable"):
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
        return False
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
        text_sub_raw = next(
            (s for s in subs if isinstance(s, dict) and s.get("by_text") is not None),
            None,
        )
        text_sub = _text_predicate_with_inherited_match(pred, text_sub_raw)
        if text_sub is not None and text_sub_raw is not None:
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
            if s is text_sub_raw:
                continue
            sp = dict(_text_predicate_with_inherited_match(pred, s) or s)
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
        node=fn.node,
    )


def node_for_hit(tree: dict[str, Any], hit: ResolvedHit) -> dict[str, Any]:
    """Return the exact node selected by a resolver hit, never a first DFS match."""

    if isinstance(hit.node, dict):
        return hit.node
    flat, _screen_area = _flatten_subtree(tree)
    if 0 <= hit.tree_index < len(flat):
        return flat[hit.tree_index].node
    raise SelectorResolutionError(
        "resolver hit does not map to a node",
        selector={
            "engine": hit.engine,
            "requested_match": hit.requested_match,
            "effective_match": hit.effective_match,
            "candidate_count": hit.candidate_count,
            "selected_id": hit.id or None,
            "bounds": hit.tap_bounds or None,
        },
        failure_code="selector_not_found",
    )


def _sort_hits(hits: list[ResolvedHit]) -> list[ResolvedHit]:
    return sorted(
        hits,
        key=lambda h: (-h.overlay_rank, -int(h.clickable), -int(h.enabled), h.tree_index),
    )


def _search_roots(tree: dict[str, Any], pred: dict[str, Any]) -> list[dict[str, Any]]:
    scope = pred.get("scope")
    within = pred.get("within")
    base_roots: list[dict[str, Any]] | None = None
    if scope == "top_overlay":
        overlays = _find_overlay_roots(tree)
        if overlays:
            base_roots = [overlays[-1]]
        else:
            return []
    if isinstance(within, dict):
        roots_to_search = base_roots if base_roots is not None else [tree]
        roots: list[dict[str, Any]] = []
        for root in roots_to_search:
            flat_all, sa = _flatten_subtree(root)
            for fn in flat_all:
                if _single_pred_on_flat(flat_all, fn, within, screen_area=sa):
                    roots.append(fn.node)
        return roots
    if base_roots is not None:
        return base_roots
    return [tree]


def _validate_selector_predicate(
    pred: dict[str, Any], *, _seen: set[int] | None = None
) -> None:
    """Validate the whole predicate graph before any candidate search."""

    if not isinstance(pred, dict):
        raise SelectorContractError("selector predicate must be an object", selector={})
    seen = _seen if _seen is not None else set()
    marker = id(pred)
    if marker in seen:
        raise SelectorContractError("selector predicate cannot contain cycles", selector=pred)
    seen.add(marker)
    normalize_match(pred.get("match"), selector=pred)

    scope = pred.get("scope")
    if scope is not None and scope != "top_overlay":
        raise SelectorContractError(
            f"unsupported selector scope {scope!r}", selector=pred
        )

    index = pred.get("index")
    if index is not None:
        if isinstance(index, bool) or not isinstance(index, int) or index < 0:
            raise SelectorContractError(
                f"selector index must be a non-negative integer; got {index!r}",
                selector=pred,
            )

    for relation in ("within", "below", "above", "after", "before"):
        if relation not in pred:
            continue
        anchor = pred.get(relation)
        if not isinstance(anchor, dict):
            raise SelectorContractError(
                f"selector {relation} anchor must be an object",
                selector=pred,
            )
        _validate_selector_predicate(anchor, _seen=seen)

    subs = pred.get("all")
    if subs is not None:
        if not isinstance(subs, list) or not subs:
            raise SelectorContractError(
                "selector all must be a non-empty array", selector=pred
            )
        for sub in subs:
            if not isinstance(sub, dict):
                raise SelectorContractError(
                    "selector all entries must be objects", selector=pred
                )
            _validate_selector_predicate(sub, _seen=seen)
    seen.remove(marker)


def resolve_targets(tree: dict[str, Any], pred: dict[str, Any]) -> list[ResolvedHit]:
    if not isinstance(tree, dict):
        raise SelectorResolutionError("tree must be a dict")
    if not isinstance(pred, dict):
        raise SelectorResolutionError("pred must be a dict")

    _validate_selector_predicate(pred)
    text_pred = _text_predicate_with_inherited_match(pred)
    requested_match, effective_match = _text_match_for_predicate(pred, text_pred)

    work_pred = dict(pred)
    work_pred.pop("scope", None)
    work_pred.pop("within", None)

    raw_hits: list[ResolvedHit] = []
    seen: set[tuple[int, int]] = set()

    for root in _search_roots(tree, pred):
        flat, screen_area = _flatten_subtree(root)
        for fn in flat:
            inline_hits = _inline_hits_for_node(
                fn,
                text_pred or work_pred,
                requested_match=requested_match,
                effective_match=effective_match,
            )
            if inline_hits:
                raw_hits.extend(inline_hits)
                continue
            if _has_real_inline_descendant(flat, fn, text_pred or work_pred):
                continue
            if not _pred_matches_node(flat, fn, work_pred, screen_area=screen_area):
                continue
            if work_pred.get("by_text") is not None or (
                work_pred.get("all")
                and any(
                    isinstance(s, dict) and s.get("by_text") is not None
                    for s in (work_pred.get("all") or [])
                )
            ):
                if _is_noninteractive_inline_node(fn):
                    lifted = fn
                else:
                    lifted = _lift_tap_target(
                        flat, fn.tree_index, screen_area=screen_area
                    )
                hit = _flat_to_hit(lifted)
            else:
                hit = _flat_to_hit(fn)
            seen_key = (id(root), hit.tree_index) if hit is not None else None
            if hit is None or seen_key in seen:
                continue
            assert seen_key is not None
            seen.add(seen_key)
            raw_hits.append(hit)

    ordered = _sort_hits(
        [
            replace(
                hit,
                requested_match=requested_match,
                effective_match=effective_match,
                candidate_count=len(raw_hits),
                engine="resolver",
            )
            for hit in raw_hits
        ]
    )
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
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=0
            ),
        )
    if len(hits) > 1:
        raise SelectorResolutionError(
            f"ambiguous UI target for predicate {pred!r}: {len(hits)} candidates",
            candidates_summary=candidates_summary(hits),
            failure_code="selector_ambiguous",
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=len(hits)
            ),
            evidence={"candidate_count": len(hits)},
        )
    return hits[0]


def resolve_action_one(tree: dict[str, Any], pred: dict[str, Any]) -> ResolvedHit:
    """Resolve one action target and distinguish aggregate inline text failures."""

    hits = resolve_targets(tree, pred)
    if not hits:
        text_pred = _text_predicate_with_inherited_match(pred)
        requested = text_pred.get("by_text") if text_pred else None
        if requested is not None:
            for root in _search_roots(tree, pred):
                flat, screen_area = _flatten_subtree(root)
                for fn in flat:
                    if _inline_target_is_unresolvable(
                        fn, pred, text_pred=text_pred
                    ):
                        raise SelectorResolutionError(
                            f"inline target {requested!r} has no real fragment bounds/action",
                            failure_code="inline_target_unresolvable",
                            selector=_selector_evidence_for_predicate(
                                pred, engine="resolver", candidate_count=0
                            ),
                            evidence={
                                "resolution_kind": "aggregate_text_only",
                                "fragment_bounds": None,
                            },
                        )
        raise SelectorResolutionError(
            f"no matching UI target for action predicate {pred!r}",
            candidates_summary=[],
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=0
            ),
        )
    if len(hits) > 1:
        raise SelectorResolutionError(
            f"ambiguous action target for predicate {pred!r}: {len(hits)} candidates",
            candidates_summary=candidates_summary(hits),
            failure_code="selector_ambiguous",
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=len(hits)
            ),
            evidence={
                "candidate_count": len(hits),
                "candidates": candidates_summary(hits),
            },
        )
    hit = hits[0]
    if (
        str(hit.type or "").lower() in {"span", "inline", "inlinetext"}
        and not hit.clickable
        and not (hit.attrs.get("action") or hit.attrs.get("semantic_action"))
    ):
        raise SelectorResolutionError(
            "inline Span has no declared clickable semantics",
            failure_code="inline_target_unresolvable",
            selector=_selector_evidence_for_predicate(
                pred, engine="resolver", candidate_count=1
            ),
            evidence={
                "resolution_kind": "span_without_clickable_semantics",
                "fragment_bounds": hit.tap_bounds or None,
            },
        )
    text_pred = _text_predicate_with_inherited_match(pred)
    if text_pred is not None and hit.resolution_kind is None:
        # A fragment hit is the only valid substring click target. Normal full
        # text/button targets are allowed to use their own bounds/ancestor.
        for root in _search_roots(tree, pred):
            flat, screen_area = _flatten_subtree(root)
            for fn in flat:
                if (
                    (fn.tree_index == hit.tree_index or hit.tree_index in fn.parent_indices)
                    and _inline_target_is_unresolvable(
                        fn, pred, text_pred=text_pred
                    )
                ):
                    raise SelectorResolutionError(
                        "inline target has no independently clickable bounds",
                        failure_code="inline_target_unresolvable",
                        selector=_selector_evidence_for_predicate(
                            pred, engine="resolver", candidate_count=1
                        ),
                        evidence={"resolution_kind": "aggregate_text_only"},
                    )
    return hit


def candidates_summary(hits: list[ResolvedHit]) -> list[dict[str, Any]]:
    return [h.summary_row() for h in hits]

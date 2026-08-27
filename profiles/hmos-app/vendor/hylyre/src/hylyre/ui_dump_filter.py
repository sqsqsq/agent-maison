"""Optional pruning/filtering of Hypium UI dump payloads (after ``_hylyre_hints``)."""

from __future__ import annotations

import copy
import re
import time
from dataclasses import dataclass, field
from typing import Any

from hylyre.diagnostic_log import diagnostic_log


DEFAULT_MINIMAL_ATTRS: frozenset[str] = frozenset(
    {"type", "text", "id", "key", "bounds", "clickable", "scrollable"}
)


@dataclass
class DumpFilterSpec:
    """Filter/prune options for ``dump-ui`` output."""

    filter_text: str | None = None
    filter_id: str | None = None
    filter_key: str | None = None
    keep_clickable: bool = False
    keep_scrollable: bool = False
    max_depth: int | None = None
    keep_attrs: frozenset[str] = field(default_factory=frozenset)
    prune_attrs: frozenset[str] = field(default_factory=frozenset)
    full: bool = False
    summary: bool = False

    def active_regex_filters(self) -> bool:
        return any((self.filter_text, self.filter_id, self.filter_key))


def _compile(pat: str | None) -> re.Pattern[str] | None:
    if not pat:
        return None
    return re.compile(pat)


def _attrs_dict(node: dict[str, Any]) -> dict[str, Any]:
    raw = node.get("attributes")
    return raw if isinstance(raw, dict) else {}


def _node_matches_regex(
    attrs: dict[str, Any],
    *,
    text_re: re.Pattern[str] | None,
    id_re: re.Pattern[str] | None,
    key_re: re.Pattern[str] | None,
) -> bool:
    text = str(attrs.get("text") or attrs.get("originalText") or "")
    nid = str(attrs.get("id") or "")
    key = str(attrs.get("key") or "")
    if text_re and text_re.search(text):
        return True
    if id_re and id_re.search(nid):
        return True
    if key_re and key_re.search(key):
        return True
    return False


def _node_matches_keep_flags(
    attrs: dict[str, Any], *, keep_clickable: bool, keep_scrollable: bool
) -> bool:
    if keep_clickable and str(attrs.get("clickable", "")).lower() == "true":
        return True
    if keep_scrollable and str(attrs.get("scrollable", "")).lower() == "true":
        return True
    return False


def _collect_marked_paths(
    node: dict[str, Any],
    spec: DumpFilterSpec,
    depth: int,
    text_re: re.Pattern[str] | None,
    id_re: re.Pattern[str] | None,
    key_re: re.Pattern[str] | None,
    path: tuple[int, ...],
    marked: set[tuple[int, ...]],
    depth_cap: int | None,
) -> bool:
    """DFS: mark nodes on paths to matches; return True if this subtree has any match."""
    if depth_cap is not None and depth > depth_cap:
        return False

    attrs = _attrs_dict(node)
    children = node.get("children")
    if not isinstance(children, list):
        children = []

    child_hit = False
    for i, ch in enumerate(children):
        if isinstance(ch, dict):
            if _collect_marked_paths(
                ch,
                spec,
                depth + 1,
                text_re,
                id_re,
                key_re,
                path + (i,),
                marked,
                depth_cap,
            ):
                child_hit = True

    self_hit = False
    if spec.active_regex_filters():
        self_hit = _node_matches_regex(attrs, text_re=text_re, id_re=id_re, key_re=key_re)
    if spec.keep_clickable or spec.keep_scrollable:
        self_hit = self_hit or _node_matches_keep_flags(
            attrs,
            keep_clickable=spec.keep_clickable,
            keep_scrollable=spec.keep_scrollable,
        )

    subtree_hit = self_hit or child_hit
    if subtree_hit:
        marked.add(path)
        for plen in range(0, len(path) + 1):
            marked.add(path[:plen])
    return subtree_hit


def _prune_tree_to_marked(
    node: dict[str, Any],
    path: tuple[int, ...],
    marked: set[tuple[int, ...]],
    depth: int,
    depth_cap: int | None,
) -> dict[str, Any] | None:
    if depth_cap is not None and depth > depth_cap:
        return None
    out = copy.deepcopy(node)
    children = out.get("children")
    if not isinstance(children, list):
        return out if path in marked else None

    new_children: list[dict[str, Any]] = []
    for i, ch in enumerate(children):
        if not isinstance(ch, dict):
            continue
        child_path = path + (i,)
        pruned = _prune_tree_to_marked(ch, child_path, marked, depth + 1, depth_cap)
        if pruned is not None:
            new_children.append(pruned)

    out["children"] = new_children
    if path in marked or new_children:
        return out
    return None


def _clip_tree_depth(node: dict[str, Any], depth: int, max_depth: int) -> dict[str, Any] | None:
    if depth > max_depth:
        return None
    out = copy.deepcopy(node)
    ch = out.get("children")
    if not isinstance(ch, list):
        return out
    new_ch: list[dict[str, Any]] = []
    for c in ch:
        if isinstance(c, dict):
            clipped = _clip_tree_depth(c, depth + 1, max_depth)
            if clipped is not None:
                new_ch.append(clipped)
    out["children"] = new_ch
    return out


def _trim_attrs(attrs: dict[str, Any], *, allowed: frozenset[str]) -> dict[str, Any]:
    return {k: v for k, v in attrs.items() if k in allowed}


def _apply_attr_policy(
    node: dict[str, Any],
    *,
    allowed_attrs: frozenset[str],
    depth: int,
    depth_cap: int | None,
) -> None:
    if depth_cap is not None and depth > depth_cap:
        return
    attrs = node.get("attributes")
    if isinstance(attrs, dict):
        node["attributes"] = _trim_attrs(attrs, allowed=allowed_attrs)
    ch = node.get("children")
    if isinstance(ch, list):
        for child in ch:
            if isinstance(child, dict):
                _apply_attr_policy(
                    child, allowed_attrs=allowed_attrs, depth=depth + 1, depth_cap=depth_cap
                )


def _build_allowed_attrs(spec: DumpFilterSpec) -> frozenset[str]:
    if spec.full:
        return frozenset()
    base = set(DEFAULT_MINIMAL_ATTRS)
    base |= spec.keep_attrs
    base -= spec.prune_attrs
    return frozenset(base)


def tree_to_summary_list(
    node: Any,
    *,
    acc: list[dict[str, Any]] | None = None,
    depth: int = 0,
    max_depth: int | None = None,
) -> list[dict[str, Any]]:
    if acc is None:
        acc = []
    if max_depth is not None and depth > max_depth:
        return acc
    if not isinstance(node, dict):
        return acc
    attrs = _attrs_dict(node)
    row = {
        "type": attrs.get("type", ""),
        "text": str(attrs.get("text") or attrs.get("originalText") or "").strip(),
        "id": str(attrs.get("id") or ""),
        "key": str(attrs.get("key") or ""),
        "bounds": attrs.get("bounds") or "",
        "clickable": attrs.get("clickable") or "",
        "scrollable": attrs.get("scrollable") or "",
    }
    has_signal = bool(row["text"]) or str(row["clickable"]).lower() == "true"
    if has_signal:
        acc.append(row)
    for ch in node.get("children") or []:
        if isinstance(ch, dict):
            tree_to_summary_list(ch, acc=acc, depth=depth + 1, max_depth=max_depth)
    return acc


def apply_ui_dump_filter(payload: dict[str, Any], spec: DumpFilterSpec) -> dict[str, Any]:
    """Return a filtered copy of ``payload`` (``tree`` + preserved root keys like hints)."""
    tree = payload.get("tree")
    if (
        isinstance(tree, dict)
        and spec.full
        and not spec.summary
        and spec.max_depth is None
        and not spec.active_regex_filters()
        and not spec.keep_clickable
        and not spec.keep_scrollable
        and not spec.keep_attrs
        and not spec.prune_attrs
    ):
        return payload

    t_all = time.perf_counter()
    out = dict(payload)
    tree = out.get("tree")
    if not isinstance(tree, dict):
        return out

    t_dc = time.perf_counter()
    tree = copy.deepcopy(tree)
    deepcopy_ms = (time.perf_counter() - t_dc) * 1000.0
    depth_cap = spec.max_depth

    needs_mark_prune = (
        spec.active_regex_filters() or spec.keep_clickable or spec.keep_scrollable
    )
    t_struct = time.perf_counter()
    if needs_mark_prune:
        text_re = _compile(spec.filter_text)
        id_re = _compile(spec.filter_id)
        key_re = _compile(spec.filter_key)
        marked: set[tuple[int, ...]] = set()
        _collect_marked_paths(
            tree,
            spec,
            0,
            text_re,
            id_re,
            key_re,
            (),
            marked,
            depth_cap,
        )
        pruned = _prune_tree_to_marked(tree, (), marked, 0, depth_cap)
        tree = pruned if pruned is not None else {"attributes": {}, "children": []}
    elif depth_cap is not None:
        clipped = _clip_tree_depth(tree, 0, depth_cap)
        tree = clipped if clipped is not None else {"attributes": {}, "children": []}
    struct_ms = (time.perf_counter() - t_struct) * 1000.0

    out["tree"] = tree

    t_attr = time.perf_counter()
    allowed = _build_allowed_attrs(spec)
    if not spec.full and isinstance(tree, dict):
        _apply_attr_policy(tree, allowed_attrs=allowed, depth=0, depth_cap=None)
    attr_ms = (time.perf_counter() - t_attr) * 1000.0

    summary_ms = 0.0
    if spec.summary:
        t_sum = time.perf_counter()
        items = tree_to_summary_list(out["tree"], max_depth=depth_cap)
        del out["tree"]
        out["summary"] = items
        out["_hylyre_summary_count"] = len(items)
        summary_ms = (time.perf_counter() - t_sum) * 1000.0

    total_ms = (time.perf_counter() - t_all) * 1000.0
    diagnostic_log(
        "apply_ui_dump_filter "
        f"total_ms={total_ms:.1f} deepcopy_ms={deepcopy_ms:.1f} "
        f"struct_ms={struct_ms:.1f} attr_ms={attr_ms:.1f} summary_ms={summary_ms:.1f}"
    )
    return out


def dump_filter_spec_from_dict(raw: dict[str, Any]) -> DumpFilterSpec:
    """Build spec from CLI/MCP kwargs (snake_case keys)."""
    ka = raw.get("keep_attrs")
    pa = raw.get("prune_attrs")
    keep_set = (
        frozenset(x.strip() for x in str(ka).split(",") if x.strip()) if ka else frozenset()
    )
    prune_set = (
        frozenset(x.strip() for x in str(pa).split(",") if x.strip()) if pa else frozenset()
    )
    md = raw.get("max_depth")
    return DumpFilterSpec(
        filter_text=raw.get("filter_text"),
        filter_id=raw.get("filter_id"),
        filter_key=raw.get("filter_key"),
        keep_clickable=bool(raw.get("keep_clickable")),
        keep_scrollable=bool(raw.get("keep_scrollable")),
        max_depth=int(md) if md is not None else None,
        keep_attrs=keep_set,
        prune_attrs=prune_set,
        full=bool(raw.get("full")),
        summary=bool(raw.get("summary")),
    )


def default_dump_postprocess(payload: dict[str, Any]) -> dict[str, Any]:
    """Default: minimal attributes on full tree (no structural filtering)."""
    return apply_ui_dump_filter(payload, DumpFilterSpec(full=False))

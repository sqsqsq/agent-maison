"""Agent helpers: rich selector touch, wait, scroll-until-visible."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from hylyre.api.exceptions import SelectorResolutionError
from hylyre.api.selector_resolve import (
    ResolvedHit,
    candidates_summary,
    finalize_tap_hit,
    has_rich_selector_fields,
    pick_best_tap_hit,
    resolve_first_hit_match_center_in_container,
    resolve_one,
    resolve_targets,
)
from hylyre.diagnostic_log import diagnostic_log

if False:  # TYPE_CHECKING
    from hylyre.api.agent import HylyreAgent

_INPUT_SKIP_KEYS = frozenset(
    {
        "text",
        "into",
        "mode",
        "value",
        "prefer_native_text",
        "focus_wait",
    }
)


def tree_from_dump(payload: dict[str, Any]) -> dict[str, Any]:
    tree = payload.get("tree")
    if not isinstance(tree, dict):
        raise SelectorResolutionError("dump_ui payload missing tree dict")
    return tree


def pred_from_touch_block(touch: dict[str, Any]) -> dict[str, Any]:
    """Build resolver predicate from a touch block (strip touch-only keys)."""
    skip = frozenset({"x", "y", "wait_time", "scroll_into_view", "prefer_native_text"})
    return {k: v for k, v in touch.items() if k not in skip and v is not None}


def uses_resolver(touch: dict[str, Any]) -> bool:
    if touch.get("prefer_native_text") is True:
        return False
    if touch.get("by_key") is not None:
        return True
    if touch.get("by_text") is not None:
        return True
    if has_rich_selector_fields(touch):
        return True
    return False


def uses_native_only(touch: dict[str, Any]) -> bool:
    if touch.get("x") is not None and touch.get("y") is not None:
        return True
    if touch.get("by_id") is not None and not has_rich_selector_fields(touch):
        if touch.get("by_text") is None and touch.get("by_key") is None:
            return True
    if touch.get("prefer_native_text") is True and touch.get("by_text") is not None:
        return True
    return False


def pred_from_input_block(block: dict[str, Any]) -> dict[str, Any]:
    """Build resolver predicate from an input block (``into`` or top-level selectors)."""
    into = block.get("into")
    if isinstance(into, dict):
        return {k: v for k, v in into.items() if v is not None}
    return {
        k: v
        for k, v in block.items()
        if k not in _INPUT_SKIP_KEYS and v is not None
    }


def uses_resolver_for_input(block: dict[str, Any]) -> bool:
    if block.get("prefer_native_text") is True:
        return False
    if isinstance(block.get("into"), dict):
        return True
    if block.get("by_key") is not None:
        return True
    if block.get("by_type") is not None:
        return True
    if has_rich_selector_fields(block):
        return True
    return False


def uses_native_input_only(block: dict[str, Any]) -> bool:
    if uses_resolver_for_input(block):
        return False
    bt = block.get("by_text")
    bid = block.get("by_id")
    if bt is not None and bid is None:
        return True
    if bid is not None and bt is None:
        return True
    return False


async def resolve_input_hit(agent: Any, block: dict[str, Any]) -> ResolvedHit:
    payload = await agent.dump_ui()
    tree = tree_from_dump(payload)
    pred = pred_from_input_block(block)
    try:
        hit = resolve_one(tree, pred)
    except SelectorResolutionError as e:
        summary = e.candidates_summary or candidates_summary(
            resolve_targets(tree, pred)
        )
        diagnostic_log(
            f"input selector_resolve miss pred={pred!r} candidates={summary!r}"
        )
        raise
    if len(resolve_targets(tree, pred)) > 1:
        diagnostic_log(
            f"input selector_resolve multi-hit using first of "
            f"{candidates_summary(resolve_targets(tree, pred))!r}"
        )
    return hit


def _node_bounds(node: dict[str, Any]) -> str:
    attrs = node.get("attributes")
    if isinstance(attrs, dict):
        return str(attrs.get("bounds") or "")
    return ""


def is_pure_by_text_pred(pred: dict[str, Any]) -> bool:
    if pred.get("by_text") is None:
        return False
    probe = {k: v for k, v in pred.items() if k != "visible"}
    if has_rich_selector_fields(probe):
        return False
    return all(
        probe.get(k) is None
        for k in ("by_id", "by_type", "by_key", "scope", "within", "all", "index")
    )


def _scroll_hit(tree: dict[str, Any], pred: dict[str, Any], hit: ResolvedHit) -> ResolvedHit:
    return finalize_tap_hit(tree, pred, hit)


async def _try_native_by_text_hit(agent: Any, text: str) -> ResolvedHit | None:
    """Last resort: Hypium ``BY.text`` locate (aligns with touch native fallback)."""
    ui = getattr(agent, "_ui", None)
    if ui is None:
        return None
    locate = getattr(ui, "locate_by_text", None)
    if not callable(locate):
        return None
    try:
        center = await locate(by_text=text)
    except Exception as e:
        diagnostic_log(f"native locate_by_text failed text={text!r} err={e!r}")
        return None
    if center is None:
        return None
    x, y = int(center[0]), int(center[1])
    if x == 0 and y == 0:
        return None
    bounds_s = f"[{x},{y}][{x + 1},{y + 1}]"
    return ResolvedHit(
        center=(x, y),
        tap_bounds=bounds_s,
        attrs={"text": text, "type": "NativeByText"},
        overlay_rank=0,
        depth=0,
        tree_index=0,
        text=text,
    )


async def _try_pure_by_text_resolve_fallback(
    agent: Any, target_pred: dict[str, Any]
) -> ResolvedHit:
    """After scroll loop (no container): re-dump resolve, then native BY.text locate."""
    text = str(target_pred["by_text"])
    payload = await agent.dump_ui()
    tree = tree_from_dump(payload)
    bare = {"by_text": text}
    for pred in ({"by_text": text, "visible": True}, bare):
        best = pick_best_tap_hit(resolve_targets(tree, pred))
        if best is not None:
            return _scroll_hit(tree, bare, best)
    native = await _try_native_by_text_hit(agent, text)
    if native is not None:
        return native
    raise SelectorResolutionError(
        f"scroll_until_visible: target not found for by_text {text!r}",
        candidates_summary=candidates_summary(resolve_targets(tree, bare)),
    )


async def resolve_touch_hit(agent: Any, touch: dict[str, Any]) -> ResolvedHit:
    payload = await agent.dump_ui()
    tree = tree_from_dump(payload)
    pred = pred_from_touch_block(touch)
    if touch.get("by_text") is not None and not has_rich_selector_fields(touch):
        pred.setdefault("visible", True)
    try:
        hit = resolve_one(tree, pred)
    except SelectorResolutionError as e:
        summary = e.candidates_summary or candidates_summary(
            resolve_targets(tree, pred)
        )
        diagnostic_log(
            f"selector_resolve miss pred={pred!r} candidates={summary!r}"
        )
        raise
    if len(resolve_targets(tree, pred)) > 1:
        diagnostic_log(
            f"selector_resolve multi-hit using first of "
            f"{candidates_summary(resolve_targets(tree, pred))!r}"
        )
    return hit


async def wait_rich_selector(
    agent: Any,
    block: dict[str, Any],
    *,
    timeout: float,
    want_gone: bool,
    poll_interval: float = 0.4,
) -> None:
    pred = {
        k: v
        for k, v in block.items()
        if k not in ("timeout",) and v is not None
    }
    deadline = time.monotonic() + float(timeout)
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        payload = await agent.dump_ui()
        tree = tree_from_dump(payload)
        hits = resolve_targets(tree, pred)
        present = len(hits) > 0
        if want_gone and not present:
            return
        if not want_gone and present:
            return
        last_err = SelectorResolutionError(
            f"wait {'gone' if want_gone else 'for'}: target not in desired state"
        )
        await asyncio.sleep(poll_interval)
    msg = str(last_err) if last_err else f"timeout after {timeout}s"
    raise TimeoutError(msg)


async def scroll_until_visible(
    agent: Any,
    *,
    target_pred: dict[str, Any],
    container: dict[str, Any] | None,
    max_scrolls: int = 15,
    swipe_distance: int = 60,
) -> ResolvedHit:
    from hylyre.cli.commands.collect_cmd import (
        _build_swipe_payload,
        _visible_rows_fingerprint,
        find_container_root,
        find_scroll_root,
    )

    container_selector = dict(container) if container else None
    swipe_area: dict[str, Any] = (
        dict(container) if container else {"by_type": "List"}
    )
    for i in range(max_scrolls):
        payload = await agent.dump_ui()
        tree = tree_from_dump(payload)

        # (1) Already-visible short-circuit — independent of scrollable
        if container_selector is not None:
            croot = find_container_root(tree, container_selector)
            if croot is not None:
                hits = resolve_targets(croot, target_pred)
                best = pick_best_tap_hit(hits)
                if best is not None:
                    return _scroll_hit(tree, target_pred, best)
                if i == 0:
                    bounds = _node_bounds(croot)
                    if bounds:
                        bounded = resolve_first_hit_match_center_in_container(
                            tree, target_pred, bounds
                        )
                        if bounded is not None:
                            return bounded
        else:
            hits = resolve_targets(tree, target_pred)
            best = pick_best_tap_hit(hits)
            if best is not None:
                return _scroll_hit(tree, target_pred, best)

        # (2) Scroll decision — still requires scrollable root
        scroll_root = find_scroll_root(tree, swipe_area)
        if scroll_root is None and i == 0 and container_selector is None:
            swipe_area = {"scrollable": True}
            scroll_root = find_scroll_root(tree, {"by_type": "Scroll"})
        if scroll_root is None:
            break
        swipe_payload = _build_swipe_payload(
            "UP", swipe_distance, swipe_area, scroll_root
        )
        await agent.run_planned_swipe(swipe_payload)
        await asyncio.sleep(0.2)
        payload2 = await agent.dump_ui()
        tree2 = tree_from_dump(payload2)
        fp = _visible_rows_fingerprint(tree2, swipe_area, None)
        _ = fp  # bounce detection optional

    if container is None and is_pure_by_text_pred(target_pred):
        return await _try_pure_by_text_resolve_fallback(agent, target_pred)

    raise SelectorResolutionError(
        f"scroll_until_visible: target not found after {max_scrolls} scrolls",
        candidates_summary=[],
    )

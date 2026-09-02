"""Agent helpers: rich selector touch, wait, scroll-until-visible."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from hylyre.api.exceptions import AssertionMismatch, SelectorResolutionError
from hylyre.api.selector_contract import selector_evidence
from hylyre.api.selector_resolve import (
    ResolvedHit,
    candidates_summary,
    finalize_tap_hit,
    has_rich_selector_fields,
    node_for_hit,
    resolve_action_one,
    resolve_first_hit_match_center_in_container,
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
    if block.get("by_text") is not None:
        return True
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
        hit = resolve_action_one(tree, pred)
    except SelectorResolutionError as e:
        summary = e.candidates_summary or candidates_summary(
            resolve_targets(tree, pred)
        )
        diagnostic_log(
            f"input selector_resolve miss pred={pred!r} candidates={summary!r}"
        )
        raise
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


def _require_unique_scroll_hit(
    hits: list[ResolvedHit], pred: dict[str, Any]
) -> ResolvedHit | None:
    if not hits:
        return None
    if len(hits) > 1:
        raise SelectorResolutionError(
            f"ambiguous scroll target for predicate {pred!r}: {len(hits)} candidates",
            candidates_summary=candidates_summary(hits),
            failure_code="selector_ambiguous",
            selector=selector_evidence(
                pred, engine="resolver", candidate_count=len(hits)
            ),
            evidence={"candidate_count": len(hits)},
        )
    return hits[0]


def _require_unique_container_hit(
    tree: dict[str, Any], pred: dict[str, Any]
) -> ResolvedHit:
    hits = resolve_targets(tree, pred)
    if not hits:
        raise SelectorResolutionError(
            f"scroll container not found for predicate {pred!r}",
            failure_code="selector_not_found",
            selector=selector_evidence(pred, engine="resolver", candidate_count=0),
            evidence={"candidate_count": 0, "container": "not_found"},
        )
    if len(hits) > 1:
        raise SelectorResolutionError(
            f"ambiguous scroll container for predicate {pred!r}: {len(hits)} candidates",
            candidates_summary=candidates_summary(hits),
            failure_code="selector_ambiguous",
            selector=selector_evidence(
                pred, engine="resolver", candidate_count=len(hits)
            ),
            evidence={"candidate_count": len(hits), "container": "ambiguous"},
        )
    return hits[0]


async def _try_pure_by_text_resolve_fallback(
    agent: Any, target_pred: dict[str, Any]
) -> ResolvedHit:
    """After scroll loop (no container), re-dump and apply the same resolver."""
    text = str(target_pred["by_text"])
    payload = await agent.dump_ui()
    tree = tree_from_dump(payload)
    bare = {"by_text": text}
    if target_pred.get("match") is not None:
        bare["match"] = target_pred["match"]
    for pred in ({"by_text": text, "visible": True}, bare):
        hits = resolve_targets(tree, pred)
        if len(hits) == 1:
            return _scroll_hit(tree, bare, resolve_action_one(tree, pred))
        if len(hits) > 1:
            return resolve_action_one(tree, pred)
    raise SelectorResolutionError(
        f"scroll_until_visible: target not found for by_text {text!r}",
        candidates_summary=candidates_summary(resolve_targets(tree, bare)),
        selector=bare,
    )


async def resolve_touch_hit(agent: Any, touch: dict[str, Any]) -> ResolvedHit:
    payload = await agent.dump_ui()
    tree = tree_from_dump(payload)
    pred = pred_from_touch_block(touch)
    if touch.get("by_text") is not None and not has_rich_selector_fields(touch):
        pred.setdefault("visible", True)
    try:
        hit = resolve_action_one(tree, pred)
    except SelectorResolutionError as e:
        summary = e.candidates_summary or candidates_summary(
            resolve_targets(tree, pred)
        )
        diagnostic_log(
            f"selector_resolve miss pred={pred!r} candidates={summary!r}"
        )
        raise
    return hit


async def wait_rich_selector(
    agent: Any,
    block: dict[str, Any],
    *,
    timeout: float,
    want_gone: bool,
    poll_interval: float = 0.4,
):
    """Rich-selector presence/absence assertion as a typed outcome.

    A timeout is not a selector failure: the resolver ran to completion and
    observed the target absent (or still present). That is an assertion that
    executed and did not match, so it reports ``assertion.mismatch`` with the
    observation attached — reporting ``selector.not_found`` here is the
    ``role=assertion + observed_present=false + failure_kind=selector``
    contradiction the protocol exists to remove.
    """

    from hylyre.api.outcome import (
        Failure,
        OperationFailed,
        OperationPassed,
        SelectorEvidence,
        SelectorResolution,
        absence_observed,
        presence_observed,
    )
    from hylyre.api.selector_contract import selector_request

    pred = {
        k: v
        for k, v in block.items()
        if k not in ("timeout",) and v is not None
    }
    request = selector_request(pred)
    deadline = time.monotonic() + float(timeout)
    hits: list[Any] = []
    while True:
        payload = await agent.dump_ui()
        tree = tree_from_dump(payload)
        hits = resolve_targets(tree, pred)
        present = len(hits) > 0
        if want_gone and not present:
            return OperationPassed(
                observation=absence_observed(False, candidate_count=0),
                selector=SelectorEvidence(request, SelectorResolution.not_found()),
            )
        if not want_gone and present:
            first = hits[0]
            return OperationPassed(
                observation=presence_observed(True, candidate_count=len(hits)),
                selector=SelectorEvidence(
                    request,
                    SelectorResolution(
                        "unique" if len(hits) == 1 else "ambiguous",
                        len(hits),
                        (
                            {"id": first.id or None, "bounds": first.tap_bounds}
                            if len(hits) == 1
                            else None
                        ),
                        [
                            {"id": h.id or None, "bounds": h.tap_bounds}
                            for h in hits[: max(len(hits), 1) if len(hits) > 1 else 1]
                        ],
                    ),
                ),
            )
        if time.monotonic() >= deadline:
            break
        await asyncio.sleep(poll_interval)

    observed_present = len(hits) > 0
    observation = (
        absence_observed(observed_present, candidate_count=len(hits))
        if want_gone
        else presence_observed(observed_present, candidate_count=len(hits))
    )
    resolution = (
        SelectorResolution.not_found()
        if not hits
        else SelectorResolution(
            "unique" if len(hits) == 1 else "ambiguous",
            len(hits),
            (
                {"id": hits[0].id or None, "bounds": hits[0].tap_bounds}
                if len(hits) == 1
                else None
            ),
            [{"id": h.id or None, "bounds": h.tap_bounds} for h in hits],
        )
    )
    return OperationFailed(
        failure=Failure(
            "assertion",
            "assertion.mismatch",
            {"assertion": "absence" if want_gone else "presence", "timeout_s": float(timeout)},
        ),
        observation=observation,
        selector=SelectorEvidence(request, resolution),
        diagnostic=(
            f"wait_{'gone' if want_gone else 'for'} timed out after {timeout}s"
        ),
    )


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
        selected_container: dict[str, Any] | None = None
        if container_selector is not None:
            container_hit = _require_unique_container_hit(tree, container_selector)
            selected_container = node_for_hit(tree, container_hit)
            if selected_container is not None:
                hits = resolve_targets(selected_container, target_pred)
                best = _require_unique_scroll_hit(hits, target_pred)
                if best is not None:
                    return _scroll_hit(
                        tree,
                        target_pred,
                        resolve_action_one(selected_container, target_pred),
                    )
                if i == 0:
                    bounds = _node_bounds(selected_container)
                    if bounds:
                        bounded = resolve_first_hit_match_center_in_container(
                            tree, target_pred, bounds
                        )
                        if bounded is not None:
                            return bounded
        else:
            hits = resolve_targets(tree, target_pred)
            best = _require_unique_scroll_hit(hits, target_pred)
            if best is not None:
                return _scroll_hit(
                    tree, target_pred, resolve_action_one(tree, target_pred)
                )

        # (2) Scroll decision — still requires scrollable root
        scroll_probe = dict(swipe_area)
        scroll_probe.setdefault("scrollable", True)
        try:
            _require_unique_container_hit(tree, scroll_probe)
            scroll_root = find_scroll_root(
                selected_container if selected_container is not None else tree,
                swipe_area,
            )
        except SelectorResolutionError as exc:
            if (
                container_selector is not None
                or i != 0
                or exc.failure_code != "selector_not_found"
            ):
                raise
            # The implicit List probe is only a compatibility hint.  If no
            # List exists, require a unique scrollable Scroll before falling
            # back; never take the first DFS hit.
            swipe_area = {"by_type": "Scroll"}
            try:
                _require_unique_container_hit(
                    tree, {"by_type": "Scroll", "scrollable": True}
                )
            except SelectorResolutionError as fallback_exc:
                if fallback_exc.failure_code != "selector_not_found":
                    raise
                # No scroll container is a valid state for the legacy
                # by_text fallback; it must still resolve the target strictly
                # rather than inventing a scroll action.
                scroll_root = None
            else:
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

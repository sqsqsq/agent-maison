"""Shared selector match contract, independent of Hypium."""

from __future__ import annotations

from typing import Any

from hylyre.api.exceptions import SelectorContractError

SUPPORTED_MATCHES = frozenset({"exact", "contains"})
DEFAULT_MATCH = "contains"


def normalize_match(
    requested: Any,
    *,
    selector: dict[str, Any] | None = None,
) -> tuple[str | None, str]:
    """Return ``requested_match`` and the validated effective match."""

    if requested is None:
        return None, DEFAULT_MATCH
    if not isinstance(requested, str):
        raise SelectorContractError(
            f"match must be one of exact or contains; got {requested!r}",
            selector=selector,
        )
    value = requested.strip().lower()
    if value not in SUPPORTED_MATCHES:
        raise SelectorContractError(
            f"unsupported match {requested!r}; supported values are exact and contains",
            selector=selector,
        )
    return requested, value


def text_matches(text: str, pattern: str, match: Any = None) -> bool:
    """Apply the same exact/contains semantics in resolver and fake paths."""

    _requested, effective = normalize_match(match)
    return text == pattern if effective == "exact" else pattern in text


def selector_evidence(
    pred: dict[str, Any] | None,
    *,
    engine: str,
    candidate_count: int,
    selected_id: str | None = None,
    bounds: str | None = None,
    selected_center: tuple[int, int] | None = None,
) -> dict[str, Any]:
    requested, effective = normalize_match(
        (pred or {}).get("match"), selector=pred
    )
    return {
        "engine": engine,
        "requested_match": requested,
        "effective_match": effective,
        "candidate_count": int(candidate_count),
        "selected_id": selected_id,
        "bounds": bounds,
        "selected_center": list(selected_center) if selected_center else None,
    }


_REQUEST_KEYS: tuple[tuple[str, str], ...] = (
    ("by_id", "by_id"),
    ("by_key", "by_key"),
    ("by_text", "by_text"),
    ("by_type", "by_type"),
)
_CONSTRAINT_KEYS = (
    "scope",
    "within",
    "below",
    "above",
    "after",
    "before",
    "all",
    "index",
    "visible",
    "clickable",
    "enabled",
    "scrollable",
)


def selector_request(pred: dict[str, Any] | None) -> "SelectorRequest":
    """Derive the v1 selector *request* from a planned predicate.

    ``kind`` records what the plan asked by, which decides whether ``value`` is
    a structured identity (``by_id``/``by_key``/``by_type``) or user-visible
    text (``by_text``) for redaction purposes.  Rich predicate fields become
    ``constraints`` so the request stays comparable with the resolution.
    """

    from hylyre.api.outcome import SelectorRequest

    block = dict(pred or {})
    present = [(kind, key) for key, kind in _REQUEST_KEYS if block.get(key) is not None]
    constraints = {k: block[k] for k in _CONSTRAINT_KEYS if block.get(k) is not None}

    if block.get("x") is not None and block.get("y") is not None and not present:
        return SelectorRequest(
            "coordinates",
            None,
            None,
            {**constraints, "x": block["x"], "y": block["y"]},
        )
    if not present:
        return SelectorRequest("composite", None, block.get("match"), constraints)
    if len(present) > 1 or constraints:
        # More than one predicate, or a nested/positional constraint: the
        # request is composite even when one key would have described it.
        primary_kind, primary_key = present[0]
        extra = {k: block[k] for _kind, k in present[1:]}
        return SelectorRequest(
            "composite",
            str(block[primary_key]),
            block.get("match"),
            {**constraints, **extra, "primary": primary_kind},
        )
    kind, key = present[0]
    return SelectorRequest(kind, str(block[key]), block.get("match"), {})  # type: ignore[arg-type]


__all__ = [
    "DEFAULT_MATCH",
    "SUPPORTED_MATCHES",
    "normalize_match",
    "selector_evidence",
    "selector_request",
    "text_matches",
]

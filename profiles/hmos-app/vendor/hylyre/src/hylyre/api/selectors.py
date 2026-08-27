"""Parse planned-step selector fields (by_text / by_id / by_type / by_key)."""

from __future__ import annotations

from typing import Any


def selector_kwargs_from_block(block: dict[str, Any]) -> dict[str, str | None]:
    """Return at most one selector key from a step block."""
    opts = [
        ("by_text", block.get("by_text")),
        ("by_id", block.get("by_id")),
        ("by_type", block.get("by_type")),
        ("by_key", block.get("by_key")),
    ]
    present = [(name, val) for name, val in opts if val is not None]
    if len(present) > 1:
        raise ValueError(
            "pass at most one of by_text, by_id, by_type, by_key "
            f"(got {present!r})"
        )
    out: dict[str, str | None] = {
        "by_text": None,
        "by_id": None,
        "by_type": None,
        "by_key": None,
    }
    if len(present) == 1:
        name, val = present[0]
        out[name] = str(val)
    return out


def require_selector(block: dict[str, Any], *, step: str) -> dict[str, str | None]:
    """Like ``selector_kwargs_from_block`` but require exactly one selector."""
    kw = selector_kwargs_from_block(block)
    if not any(kw.values()):
        raise ValueError(
            f"{step} requires exactly one of by_text, by_id, by_type, by_key"
        )
    return kw

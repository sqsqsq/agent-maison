"""Stable fingerprint over structural triples (type, id, key)."""

from __future__ import annotations

import hashlib
from typing import Any


def iter_structure_triples(node: Any, depth: int = 0) -> list[tuple[str, str, str]]:
    """Collect ``(type, id, key)`` where at least one of id/key non-empty."""
    if depth > 600 or not isinstance(node, dict):
        return []
    attrs = node.get("attributes")
    rows: list[tuple[str, str, str]] = []
    if isinstance(attrs, dict):
        typ = str(attrs.get("type") or "")
        nid = str(attrs.get("id") or "").strip()
        key = str(attrs.get("key") or "").strip()
        if nid or key:
            rows.append((typ, nid, key))
    for ch in node.get("children") or []:
        rows.extend(iter_structure_triples(ch, depth + 1))
    return rows


def compute_ui_fingerprint(tree: dict[str, Any]) -> tuple[str, list[str]]:
    triples = iter_structure_triples(tree)
    lines = sorted(f"{t}\x1f{i}\x1f{k}" for t, i, k in triples)
    blob = "\n".join(lines).encode("utf-8")
    digest = hashlib.sha256(blob).hexdigest()
    return digest, lines

"""Search merged indexes across read dirs."""

from __future__ import annotations

from pathlib import Path

from hylyre.app_store.page_store import load_index, search_index
from hylyre.app_store.paths import resolve_read_dirs


def search_all_indexes(
    bundle: str,
    *,
    by_text: str | None = None,
    by_id_pattern: str | None = None,
    store_dir: str | Path | None = None,
) -> list[dict]:
    hits: list[dict] = []
    seen: set[tuple[str, str, tuple[str, ...]]] = set()
    for d in resolve_read_dirs(store_dir):
        idx = load_index(d, bundle)
        sub = search_index(idx, by_text=by_text, by_id_pattern=by_id_pattern)
        for h in sub:
            tup = (
                str(h.get("store_key")),
                str((h.get("selector") or {})),
                tuple(sorted(h.get("pages") or [])),
            )
            if tup in seen:
                continue
            seen.add(tup)
            nh = dict(h)
            nh["resolved_store_dir"] = str(d)
            hits.append(nh)
    return hits

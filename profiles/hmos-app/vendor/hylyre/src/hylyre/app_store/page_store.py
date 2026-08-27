"""Page snapshot CRUD + selector index."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hylyre.app_store.fingerprint import compute_ui_fingerprint
from hylyre.app_store.paths import bundle_root, index_path, pages_dir

PAGE_SCHEMA = "hylyre-app-page-v1"
INDEX_SCHEMA = "hylyre-app-index-v1"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_key_elements(tree: dict[str, Any]) -> list[dict[str, Any]]:
    acc: list[dict[str, Any]] = []

    def walk(n: Any, depth: int = 0) -> None:
        if depth > 600 or not isinstance(n, dict):
            return
        attrs = n.get("attributes")
        if isinstance(attrs, dict):
            nid = str(attrs.get("id") or "").strip()
            txt = str(attrs.get("text") or attrs.get("originalText") or "").strip()
            if nid or txt:
                acc.append(
                    {
                        "type": str(attrs.get("type") or ""),
                        "text": txt,
                        "id": nid,
                        "key": str(attrs.get("key") or "").strip(),
                        "bounds": str(attrs.get("bounds") or ""),
                        "clickable": str(attrs.get("clickable") or ""),
                        "scrollable": str(attrs.get("scrollable") or ""),
                    }
                )
        for ch in n.get("children") or []:
            walk(ch, depth + 1)

    walk(tree)
    return acc


def synthetic_element_key(el: dict[str, Any]) -> str:
    if el.get("id"):
        return f"id:{el['id']}"
    if el.get("key"):
        return f"key:{el['key']}"
    return f"text:{hash(el.get('text', ''))}"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_index(store_dir: Path, bundle: str) -> dict[str, Any]:
    ip = index_path(store_dir, bundle)
    if not ip.is_file():
        return {
            "schema_version": INDEX_SCHEMA,
            "bundle": bundle,
            "elements": {},
        }
    data = _load_json(ip)
    if data.get("schema_version") != INDEX_SCHEMA:
        data = {
            "schema_version": INDEX_SCHEMA,
            "bundle": bundle,
            "elements": dict(data.get("elements") or {}),
        }
    data.setdefault("elements", {})
    return data


def save_index(store_dir: Path, bundle: str, idx: dict[str, Any]) -> None:
    idx["schema_version"] = INDEX_SCHEMA
    idx["bundle"] = bundle
    _atomic_write(index_path(store_dir, bundle), idx)


def merge_index_for_page(
    idx: dict[str, Any],
    *,
    bundle: str,
    page_name: str,
    elements: list[dict[str, Any]],
) -> dict[str, Any]:
    bucket: dict[str, Any] = idx.setdefault("elements", {})
    ts = _utc_now()
    seen_keys: set[str] = set()
    for el in elements:
        sk = synthetic_element_key(el)
        seen_keys.add(sk)
        sel: dict[str, Any] = {}
        if el.get("id"):
            sel["by_id"] = el["id"]
        elif el.get("key"):
            sel["by_key"] = el["key"]
        entry = bucket.get(sk)
        if entry is None:
            bucket[sk] = {
                "selector": sel,
                "text": el.get("text") or "",
                "type": el.get("type") or "",
                "pages": [page_name],
                "last_seen_at": ts,
            }
        else:
            pages = list(entry.get("pages") or [])
            if page_name not in pages:
                pages.append(page_name)
            entry["pages"] = pages
            entry["last_seen_at"] = ts
            if sel:
                entry["selector"] = sel
            bucket[sk] = entry
    return idx


def remove_page_from_index(idx: dict[str, Any], page_name: str) -> dict[str, Any]:
    bucket = idx.setdefault("elements", {})
    stale = []
    for sk, entry in list(bucket.items()):
        pages = [p for p in list(entry.get("pages") or []) if p != page_name]
        if pages:
            entry["pages"] = pages
            bucket[sk] = entry
        else:
            stale.append(sk)
    for sk in stale:
        del bucket[sk]
    return idx


def save_page_snapshot(
    *,
    store_dir: Path,
    bundle: str,
    page_name: str,
    tree_payload: dict[str, Any],
    ability_name: str | None = None,
    app_version: str | None = None,
    auto_fingerprint: bool = False,
) -> Path:
    tree = tree_payload.get("tree")
    if not isinstance(tree, dict):
        raise ValueError("snapshot payload must contain dict tree")
    fp_val = None
    fp_inputs: list[str] | None = None
    if auto_fingerprint:
        fp_val, fp_inputs = compute_ui_fingerprint(tree)
    snap = {
        "schema_version": PAGE_SCHEMA,
        "bundle": bundle,
        "ability_name": ability_name or "",
        "page_name": page_name,
        "app_version": app_version,
        "fingerprint": fp_val,
        "fingerprint_inputs": fp_inputs or [],
        "captured_at": _utc_now(),
        "tree": tree_payload,
        "key_elements": extract_key_elements(tree),
        "actions": [],
    }
    root = bundle_root(store_dir, bundle)
    root.mkdir(parents=True, exist_ok=True)
    out = pages_dir(store_dir, bundle) / f"{page_name}.json"
    _atomic_write(out, snap)
    idx = load_index(store_dir, bundle)
    merge_index_for_page(
        idx, bundle=bundle, page_name=page_name, elements=snap["key_elements"]
    )
    save_index(store_dir, bundle, idx)
    return out


def load_page_snapshot(store_dir: Path, bundle: str, page_name: str) -> dict[str, Any]:
    path = pages_dir(store_dir, bundle) / f"{page_name}.json"
    if not path.is_file():
        raise FileNotFoundError(str(path))
    return _load_json(path)


def list_page_snapshots(store_dir: Path, bundle: str) -> list[str]:
    d = pages_dir(store_dir, bundle)
    if not d.is_dir():
        return []
    return sorted(p.stem for p in d.glob("*.json"))


def delete_page_snapshot(store_dir: Path, bundle: str, page_name: str) -> None:
    path = pages_dir(store_dir, bundle) / f"{page_name}.json"
    path.unlink(missing_ok=True)
    idx = load_index(store_dir, bundle)
    remove_page_from_index(idx, page_name)
    save_index(store_dir, bundle, idx)


def search_index(
    idx: dict[str, Any],
    *,
    by_text: str | None = None,
    by_id_pattern: str | None = None,
) -> list[dict[str, Any]]:
    import re

    id_re = re.compile(by_id_pattern) if by_id_pattern else None
    hits: list[dict[str, Any]] = []
    for sk, entry in (idx.get("elements") or {}).items():
        text = str(entry.get("text") or "")
        sel = entry.get("selector") or {}
        nid = str(sel.get("by_id") or "")
        if by_text and by_text not in text:
            continue
        if id_re and not id_re.search(nid):
            continue
        hits.append(
            {
                "store_key": sk,
                "selector": sel,
                "text": text,
                "type": entry.get("type") or "",
                "pages": list(entry.get("pages") or []),
                "last_seen_at": entry.get("last_seen_at"),
            }
        )
    return hits


def diff_snapshots(
    saved: dict[str, Any], current_tree_payload: dict[str, Any]
) -> dict[str, Any]:
    stree = saved.get("tree") or {}
    ctree = current_tree_payload.get("tree")
    if not isinstance(ctree, dict):
        raise ValueError("current payload missing tree")
    inner_saved = stree.get("tree") if isinstance(stree.get("tree"), dict) else stree
    if not isinstance(inner_saved, dict):
        inner_saved = {}
    fp_s = str(saved.get("fingerprint") or "")
    fp_c, _ = compute_ui_fingerprint(ctree)
    ks = {synthetic_element_key(e) for e in saved.get("key_elements") or []}
    kc_el = extract_key_elements(ctree)
    kc = {synthetic_element_key(e) for e in kc_el}
    return {
        "fingerprint_saved": fp_s,
        "fingerprint_current": fp_c,
        "same_fingerprint": bool(fp_s) and fp_s == fp_c,
        "missing_vs_saved": sorted(kc - ks),
        "missing_vs_current": sorted(ks - kc),
    }

"""Hylyre app knowledge package."""

from hylyre.app_store.fingerprint import compute_ui_fingerprint, iter_structure_triples
from hylyre.app_store.page_store import (
    delete_page_snapshot,
    diff_snapshots,
    extract_key_elements,
    load_index,
    load_page_snapshot,
    list_page_snapshots,
    merge_index_for_page,
    remove_page_from_index,
    save_index,
    save_page_snapshot,
    search_index,
)
from hylyre.app_store.paths import (
    bundle_root,
    index_path,
    pages_dir,
    resolve_read_dirs,
    resolve_write_dir,
)

__all__ = [
    "bundle_root",
    "compute_ui_fingerprint",
    "delete_page_snapshot",
    "diff_snapshots",
    "extract_key_elements",
    "index_path",
    "iter_structure_triples",
    "load_index",
    "load_page_snapshot",
    "list_page_snapshots",
    "merge_index_for_page",
    "pages_dir",
    "remove_page_from_index",
    "resolve_read_dirs",
    "resolve_write_dir",
    "save_index",
    "save_page_snapshot",
    "search_index",
]

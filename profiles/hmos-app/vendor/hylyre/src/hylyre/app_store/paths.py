"""Resolve Hylyre app-knowledge storage directories (Cursor / framework / CI)."""

from __future__ import annotations

import os
from pathlib import Path


def _uniq(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for p in paths:
        try:
            rp = p.expanduser().resolve()
        except OSError:
            continue
        if rp not in seen:
            seen.add(rp)
            out.append(rp)
    return out


def resolve_read_dirs(cli_store_dir: str | Path | None = None) -> list[Path]:
    """Search order for reads (merge); includes ``~/.hylyre/apps`` last."""
    ordered: list[Path] = []
    if cli_store_dir:
        ordered.append(Path(cli_store_dir))
    env = os.environ.get("HYLYRE_APP_STORE_DIR", "").strip()
    if env:
        ordered.append(Path(env))
    ordered.append(Path.cwd() / ".hylyre" / "apps")
    ordered.append(Path.home() / ".hylyre" / "apps")
    return _uniq(ordered)


def resolve_write_dir(cli_store_dir: str | Path | None = None) -> Path:
    """First writable directory among CLI → env → cwd (never ~/.hylyre by default)."""
    candidates: list[Path] = []
    if cli_store_dir:
        candidates.append(Path(cli_store_dir))
    env = os.environ.get("HYLYRE_APP_STORE_DIR", "").strip()
    if env:
        candidates.append(Path(env))
    candidates.append(Path.cwd() / ".hylyre" / "apps")
    last_err: OSError | None = None
    for raw in _uniq(candidates):
        try:
            raw.mkdir(parents=True, exist_ok=True)
            probe = raw / ".hylyre_write_probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return raw
        except OSError as e:
            last_err = e
            continue
    msg = "No writable app store directory"
    if last_err:
        msg += f": {last_err}"
    raise RuntimeError(msg)


def bundle_root(store_dir: Path, bundle: str) -> Path:
    safe = bundle.replace("/", "_").replace("\\", "_")
    return store_dir / safe


def pages_dir(store_dir: Path, bundle: str) -> Path:
    return bundle_root(store_dir, bundle) / "pages"


def index_path(store_dir: Path, bundle: str) -> Path:
    return bundle_root(store_dir, bundle) / "index.json"

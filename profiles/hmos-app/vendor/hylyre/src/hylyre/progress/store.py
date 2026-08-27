"""Locate Hylyre repo ``docs/progress.md`` and append timestamped notes."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path


def find_hylyre_repo_root(start: Path | None = None) -> Path:
    """Walk upward for a ``pyproject.toml`` that declares the hylyre package."""
    cur = (start or Path.cwd()).resolve()
    for p in [cur, *cur.parents]:
        manifest = p / "pyproject.toml"
        if not manifest.is_file():
            continue
        try:
            text = manifest.read_text(encoding="utf-8")
        except OSError:
            continue
        if 'name = "hylyre"' in text or 'name="hylyre"' in text:
            return p
    return cur


def default_progress_path(start: Path | None = None) -> Path:
    return find_hylyre_repo_root(start) / "docs" / "progress.md"


def read_progress_text(*, path: Path | None = None) -> str:
    p = path or default_progress_path()
    if not p.is_file():
        return ""
    return p.read_text(encoding="utf-8")


def append_progress_section(
    message: str,
    *,
    path: Path | None = None,
    title: str | None = None,
) -> Path:
    """Append a dated markdown section. Creates parent dirs; creates file if missing."""
    p = path or default_progress_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    head = title or f"## {stamp} · hylyre progress"
    block = f"\n\n{head}\n\n{message.rstrip()}\n"
    prev = p.read_text(encoding="utf-8") if p.is_file() else ""
    p.write_text(prev.rstrip() + block, encoding="utf-8")
    return p


def format_progress_excerpt(
    *,
    start: Path | None = None,
    tail_lines: int = 120,
) -> str:
    """Path + optional tail of ``docs/progress.md`` (for MCP / scripts)."""
    p = default_progress_path(start)
    if not p.is_file():
        return f"{p.resolve()}\n(file does not exist yet)"
    lines = p.read_text(encoding="utf-8").splitlines()
    if tail_lines > 0 and len(lines) > tail_lines:
        body = "\n".join(lines[-tail_lines:])
        return f"{p.resolve()}\n---\n(last {tail_lines} lines)\n{body}"
    return f"{p.resolve()}\n---\n" + "\n".join(lines)


def append_compat_framework_drift_note(
    missing_keys: list[str],
    *,
    path: Path | None = None,
    start: Path | None = None,
    dedupe_tail_chars: int = 12000,
) -> bool:
    """Record consumer trace schema drift in ``docs/progress.md``. Skips if same key set
    already appears near EOF (avoids cron spam). Returns True if a new section was written.
    """
    if not missing_keys:
        return False
    sig = ",".join(missing_keys)
    p = path or default_progress_path(start)
    if p.is_file():
        tail = p.read_text(encoding="utf-8")[-dedupe_tail_chars:]
        if "compat-framework 自动" in tail and sig in tail:
            return False
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    title = f"## {day} · framework schema drift（compat-framework 自动）"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    body = (
        f"- **consumer**：`SimulatedWalletForHmos` — `framework/harness/trace/trace.schema.json`（与 "
        f"本仓 `hylyre/contracts/output-schema.json` 顶层 `properties` 软比对）。\n"
        f"- **缺失字段（consumer 有、本仓无）**：`{missing_keys}`。\n"
        f"- **签名**：`{sig}` · **时间**：{stamp}\n"
        f"- **处理**：请评估是否更新 Hylyre SSOT；软提醒 CI，不阻塞发布。\n"
    )
    append_progress_section(body, path=p, title=title)
    return True

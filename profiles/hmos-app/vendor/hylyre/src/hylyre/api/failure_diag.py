"""Best-effort UI dump + screenshot on step failure."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hylyre.diagnostic_log import diagnostic_log


async def capture_step_failure(
    agent: Any,
    *,
    failure_dir: Path | str | None,
    step_label: str,
) -> str:
    """Write dump + screenshot; return note suffix (empty if skipped)."""
    if failure_dir is None:
        return ""
    base = Path(failure_dir)
    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        diagnostic_log(f"failure_diag mkdir failed: {e!r}")
        return ""
    safe = step_label.replace("/", "_").replace("\\", "_")
    json_path = base / f"{safe}.json"
    png_path = base / f"{safe}.png"
    try:
        payload = await agent.dump_ui()
        json_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as e:
        diagnostic_log(f"failure_diag dump failed: {e!r}")
    try:
        raw = await agent.ui.screenshot()
        png_path.write_bytes(raw)
    except Exception as e:
        diagnostic_log(f"failure_diag screenshot failed: {e!r}")
    parts: list[str] = []
    if json_path.is_file():
        parts.append(f"ui_dump={json_path.name}")
    if png_path.is_file():
        parts.append(f"screenshot={png_path.name}")
    if not parts:
        return ""
    return " failure_artifacts: " + ", ".join(parts)

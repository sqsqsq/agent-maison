"""Append-only diagnostics shared by MCP server, Hypium driver, and CLI primitives."""

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path


def diagnostic_log(message: str) -> None:
    """Best-effort: ``<cwd>/.hylyre/mcp-server.log`` plus stderr (never stdout)."""
    ts = datetime.now().isoformat(timespec="seconds")
    line = f"{ts} pid={os.getpid()} {message}\n"
    try:
        log_path = Path.cwd() / ".hylyre" / "mcp-server.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass
    try:
        sys.stderr.write(line)
        sys.stderr.flush()
    except Exception:
        pass

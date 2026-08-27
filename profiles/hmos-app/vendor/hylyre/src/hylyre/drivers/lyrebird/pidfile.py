"""PID file helpers for `hylyre mock start` / `stop` (local dev)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def default_pid_path() -> Path:
    return Path.cwd() / ".hylyre" / "lyrebird.pid"


def write_pid(path: Path, pid: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(int(pid)), encoding="utf-8")


def read_pid(path: Path) -> int | None:
    if not path.is_file():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes

            k = ctypes.windll.kernel32
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            h = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
            if h:
                k.CloseHandle(h)
                return True
            return False
        except Exception:
            return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def terminate_pid(pid: int) -> None:
    if pid <= 0:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            check=False,
        )
        return
    import signal

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return


def clear_pidfile(path: Path) -> None:
    path.unlink(missing_ok=True)

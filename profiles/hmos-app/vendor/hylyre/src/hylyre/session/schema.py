"""Session file format written by ``hylyre session start``."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "hylyre-session-v1"


def default_session_file_path(cwd: Path | None = None) -> Path:
    base = cwd if cwd is not None else Path.cwd()
    return base / ".hylyre" / "session.json"


@dataclass(frozen=True)
class SessionRecord:
    host: str
    port: int
    auth_token: str
    pid: int
    device_sn: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SessionRecord:
        if data.get("schema_version") != SCHEMA_VERSION:
            raise ValueError(
                f"unsupported session schema_version {data.get('schema_version')!r}"
            )
        return cls(
            host=str(data["host"]),
            port=int(data["port"]),
            auth_token=str(data["auth_token"]),
            pid=int(data["pid"]),
            device_sn=(
                str(data["device_sn"]) if data.get("device_sn") is not None else None
            ),
        )


def load_session_record(path: Path | str) -> SessionRecord:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"session file not found: {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("session file must contain a JSON object")
    return SessionRecord.from_dict(data)


def write_session_record(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

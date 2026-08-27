"""Synchronous JSON-RPC-over-TCP client for session daemon."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any

from hylyre.session.schema import load_session_record


def _read_line(sock: socket.socket, *, max_len: int = 50 * 1024 * 1024) -> bytes:
    """Read until LF without NUL; chunked recv for large JSON lines."""
    buf = bytearray()
    while len(buf) < max_len:
        chunk = sock.recv(min(65536, max_len - len(buf)))
        if not chunk:
            break
        nl = chunk.find(b"\n")
        if nl >= 0:
            buf.extend(chunk[:nl])
            break
        buf.extend(chunk)
    if len(buf) >= max_len:
        raise ValueError("IPC response line too long")
    return bytes(buf)


def session_ipc_call(
    session_file: Path | str,
    method: str,
    params: dict[str, Any],
    *,
    timeout_s: float = 300.0,
) -> Any:
    rec = load_session_record(session_file)
    payload = {
        "id": 1,
        "token": rec.auth_token,
        "method": method,
        "params": params,
    }
    line = json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n"
    with socket.create_connection((rec.host, rec.port), timeout=timeout_s) as sock:
        sock.sendall(line)
        raw = _read_line(sock, max_len=80 * 1024 * 1024)
    try:
        msg = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise RuntimeError(f"invalid IPC response: {raw[:200]!r}") from e
    if not isinstance(msg, dict):
        raise RuntimeError("IPC response must be a JSON object")
    if not msg.get("ok"):
        raise RuntimeError(msg.get("error") or "IPC error")
    return msg.get("result")

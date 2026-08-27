"""CLI ``hylyre session`` — persistent Hypium TCP daemon for atomic commands."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import typer

from hylyre.drivers.lyrebird.pidfile import is_pid_alive, terminate_pid
from hylyre.session.client import session_ipc_call
from hylyre.session.schema import default_session_file_path, load_session_record


def run_daemon_cli() -> None:
    """Internal entry: reads HYLYRE_SESSION_* env and serves JSON-RPC."""
    from hylyre.session.daemon import main_daemon_blocking

    main_daemon_blocking()


def run_session_start(
    *,
    session_file: Path | None,
    device_sn: str | None,
    mock_port: int | None,
    lyrebird_url: str | None,
    wait_s: float,
) -> None:
    session_path = Path(session_file) if session_file else default_session_file_path()

    if session_path.is_file():
        try:
            rec = load_session_record(session_path)
            if is_pid_alive(rec.pid):
                try:
                    session_ipc_call(session_path, "ping", {}, timeout_s=5.0)
                    typer.secho(
                        f"session already active (pid={rec.pid}); stop first or use "
                        f"a different --session-file",
                        err=True,
                    )
                    raise typer.Exit(code=2)
                except Exception:
                    terminate_pid(rec.pid)
        except (FileNotFoundError, ValueError, KeyError):
            session_path.unlink(missing_ok=True)

    token = uuid.uuid4().hex
    env = os.environ.copy()
    env["HYLYRE_SESSION_FILE"] = str(session_path.resolve())
    env["HYLYRE_SESSION_TOKEN"] = token
    if device_sn:
        env["HYLYRE_SESSION_DEVICE_SN"] = device_sn
    if mock_port is not None:
        env["HYLYRE_SESSION_MOCK_PORT"] = str(mock_port)
    if lyrebird_url:
        env["HYLYRE_SESSION_LYREBIRD_URL"] = lyrebird_url

    cmd = [sys.executable, "-m", "hylyre", "session", "daemon"]
    kwargs: dict[str, object] = {
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = (
            subprocess.DETACHED_PROCESS
            | subprocess.CREATE_NEW_PROCESS_GROUP
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    else:
        kwargs["start_new_session"] = True

    subprocess.Popen(cmd, **kwargs)

    deadline = time.time() + wait_s
    while time.time() < deadline:
        if session_path.is_file():
            try:
                data = json.loads(session_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                time.sleep(0.05)
                continue
            if isinstance(data, dict) and data.get("port") is not None:
                try:
                    session_ipc_call(session_path, "ping", {}, timeout_s=10.0)
                except Exception:
                    time.sleep(0.05)
                    continue
                typer.echo(str(session_path.resolve()))
                return
        time.sleep(0.05)

    typer.secho("timeout waiting for session daemon to bind", err=True)
    raise typer.Exit(code=1)


def run_session_stop(*, session_file: Path | None) -> None:
    session_path = Path(session_file) if session_file else default_session_file_path()
    if not session_path.is_file():
        typer.secho("no session file", err=True)
        raise typer.Exit(code=2)

    try:
        rec = load_session_record(session_path)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        typer.secho(f"invalid session file: {e}", err=True)
        session_path.unlink(missing_ok=True)
        raise typer.Exit(code=2) from e

    try:
        session_ipc_call(session_path, "shutdown", {}, timeout_s=30.0)
    except Exception:
        pass

    for _ in range(80):
        if not is_pid_alive(rec.pid):
            break
        time.sleep(0.05)
    else:
        terminate_pid(rec.pid)

    session_path.unlink(missing_ok=True)
    typer.echo("ok")


def run_session_status(*, session_file: Path | None) -> None:
    session_path = Path(session_file) if session_file else default_session_file_path()
    if not session_path.is_file():
        typer.echo(json.dumps({"alive": False, "reason": "no session file"}))
        return
    try:
        rec = load_session_record(session_path)
    except Exception as e:
        typer.echo(json.dumps({"alive": False, "reason": str(e)}))
        return
    alive_pid = is_pid_alive(rec.pid)
    ping_ok = False
    err = ""
    if alive_pid:
        try:
            session_ipc_call(session_path, "ping", {}, timeout_s=5.0)
            ping_ok = True
        except Exception as e:
            err = str(e)[:500]
    typer.echo(
        json.dumps(
            {
                "alive": bool(alive_pid and ping_ok),
                "pid": rec.pid,
                "host": rec.host,
                "port": rec.port,
                "device_sn": rec.device_sn,
                "ping_ok": ping_ok,
                "error": err,
            },
            ensure_ascii=False,
        )
    )

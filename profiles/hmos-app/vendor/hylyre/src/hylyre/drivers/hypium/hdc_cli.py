"""HDC helpers for Hylyre CLI (no Hypium import)."""

from __future__ import annotations

import base64
import math
import re
import shlex
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any


class HdcNotFoundError(RuntimeError):
    pass


class HdcError(RuntimeError):
    def __init__(self, message: str, *, exit_code: int | None = None) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def hdc_exe() -> str | None:
    return shutil.which("hdc")


def list_targets(*, timeout: float = 20.0) -> list[str]:
    exe = hdc_exe()
    if not exe:
        raise HdcNotFoundError(
            "hdc not found on PATH; install HarmonyOS device tools and retry"
        )
    proc = subprocess.run(
        [exe, "list", "targets"],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        raise HdcError(
            (proc.stderr or proc.stdout or "hdc list targets failed").strip(),
            exit_code=proc.returncode,
        )
    lines = []
    for line in (proc.stdout or "").splitlines():
        s = line.strip()
        if not s or s.startswith("[") or "Connected" in s:
            continue
        lines.append(s)
    return lines


def install_hap(hap: Path, *, serial: str | None = None, timeout: float = 600.0) -> None:
    exe = hdc_exe()
    if not exe:
        raise HdcNotFoundError(
            "hdc not found on PATH; install HarmonyOS device tools and retry"
        )
    if not hap.is_file():
        raise FileNotFoundError(str(hap))
    cmd = [exe]
    if serial:
        cmd.extend(["-t", serial])
    cmd.extend(["install", str(hap.resolve())])
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "hdc install failed").strip()
        raise HdcError(msg, exit_code=proc.returncode)


def file_send(
    local: Path,
    remote: str,
    *,
    serial: str | None = None,
    timeout: float = 120.0,
) -> None:
    """Send a file to the device via ``hdc file send local remote``."""
    exe = hdc_exe()
    if not exe:
        raise HdcNotFoundError(
            "hdc not found on PATH; install HarmonyOS device tools and retry"
        )
    if not local.is_file():
        raise FileNotFoundError(str(local))
    cmd = [exe]
    if serial:
        cmd.extend(["-t", serial])
    cmd.extend(["file", "send", str(local.resolve()), remote])
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "hdc file send failed").strip()
        raise HdcError(msg, exit_code=proc.returncode)


def build_shell_argv(
    *,
    hdc_bin: str,
    args: list[str],
    serial: str | None = None,
) -> list[str]:
    cmd = [hdc_bin]
    if serial:
        cmd.extend(["-t", serial])
    cmd.extend(["shell", *args])
    return cmd


def build_force_stop_argv(
    *,
    hdc_bin: str,
    bundle: str,
    serial: str | None = None,
) -> list[str]:
    return build_shell_argv(
        hdc_bin=hdc_bin, args=["aa", "force-stop", bundle], serial=serial
    )


def shell(
    args: list[str],
    *,
    serial: str | None = None,
    timeout: float = 120.0,
) -> str:
    exe = hdc_exe()
    if not exe:
        raise HdcNotFoundError(
            "hdc not found on PATH; install HarmonyOS device tools and retry"
        )
    cmd = build_shell_argv(hdc_bin=exe, args=args, serial=serial)
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "hdc shell failed").strip()
        raise HdcError(msg, exit_code=proc.returncode)
    return (proc.stdout or "").strip()


def structured_shell(
    command: str,
    *,
    serial: str | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Run shell text on one bound device, retaining transport and device facts.

    HDC merges device stderr into stdout and does not relay the device status.
    The nested shell keeps an ``exit`` in the command from ending our wrapper.
    Raw transport evidence is returned for the caller's existing artifact path.
    """
    if not isinstance(command, str) or not command.strip() or "\x00" in command:
        raise ValueError("shell command must be a nonempty string without NUL")
    if not isinstance(serial, str) or not serial.strip() or "\x00" in serial:
        raise ValueError("a bound device serial is required for structured shell")
    if (
        isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or not math.isfinite(timeout)
        or timeout <= 0
    ):
        raise ValueError("shell timeout must be a finite positive number")
    exe = hdc_exe()
    if not exe:
        raise HdcNotFoundError(
            "hdc not found on PATH; install HarmonyOS device tools and retry"
        )

    marker = f"__HYLYRE_RC_{uuid.uuid4().hex}"
    wrapped = f"sh -c {shlex.quote(command)}; printf '\\n{marker}=%s\\n' \"$?\""
    argv = build_shell_argv(hdc_bin=exe, args=[wrapped], serial=serial)
    raw_stdout = b""
    raw_stderr = b""
    transport_exit_code: int | None = None
    timed_out = False
    started = False
    transport_error: str | None = None
    try:
        with subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ) as proc:
            started = True
            try:
                raw_stdout, raw_stderr = proc.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                proc.kill()
                raw_stdout, raw_stderr = proc.communicate()
                transport_error = "hdc shell timed out; remote process status is unknown"
            except OSError:
                proc.kill()
                proc.communicate()
                transport_exit_code = proc.returncode
                raise
            transport_exit_code = proc.returncode
    except OSError as error:
        transport_error = f"hdc shell transport failed: {error}"

    stdout = raw_stdout.decode("utf-8", errors="replace")
    hdc_stderr = raw_stderr.decode("utf-8", errors="replace")
    raw_evidence = {"stdout": stdout, "stderr": hdc_stderr}
    for stream, raw in (("stdout", raw_stdout), ("stderr", raw_stderr)):
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError:
            raw_evidence[f"{stream}_base64"] = base64.b64encode(raw).decode("ascii")
    exit_code: int | None = None
    marker_found = False
    if not timed_out:
        tail = re.search(
            rb"(?P<newline>\r?\n)" + marker.encode("ascii")
            + rb"=(?P<code>[0-9]{1,3})(?P=newline)\Z", raw_stdout
        )
        if tail is not None and int(tail["code"]) <= 255:
            marker_found = True
            exit_code = int(tail["code"])
            stdout = raw_stdout[: tail.start()].decode("utf-8", errors="replace")
        if transport_exit_code not in (None, 0):
            transport_error = hdc_stderr or "hdc shell transport failed"
        elif transport_error is None and not marker_found:
            transport_error = "hdc shell device exit marker is missing or malformed"

    return {
        "stdout": stdout,
        "stderr": None,
        "exit_code": exit_code,
        "transport_exit_code": transport_exit_code,
        "stderr_available": False,
        "timed_out": timed_out,
        "remote_status_unknown": timed_out or (started and not marker_found),
        "marker_found": marker_found,
        "transport_error": transport_error,
        "raw_evidence": raw_evidence,
    }


def force_stop(bundle: str, *, serial: str | None = None, timeout: float = 60.0) -> str:
    return shell(["aa", "force-stop", str(bundle)], serial=serial, timeout=timeout)


def build_file_send_argv(
    *,
    hdc_bin: str,
    local: Path,
    remote: str,
    serial: str | None = None,
) -> list[str]:
    """Build argv for ``hdc file send`` (for tests; no subprocess)."""
    cmd = [hdc_bin]
    if serial:
        cmd.extend(["-t", serial])
    cmd.extend(["file", "send", str(local.resolve()), remote])
    return cmd

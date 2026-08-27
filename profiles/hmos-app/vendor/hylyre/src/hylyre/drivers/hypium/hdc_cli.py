"""HDC helpers for Hylyre CLI (no Hypium import)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


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
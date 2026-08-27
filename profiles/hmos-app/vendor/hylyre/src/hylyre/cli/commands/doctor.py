"""Environment diagnostics."""

from __future__ import annotations

import importlib.util
import importlib.metadata
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from rich.console import Console
from rich.table import Table

console = Console()


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def _python_check() -> CheckResult:
    v = sys.version_info
    ok = v.major == 3 and v.minor >= 10
    detail = f"{v.major}.{v.minor}.{v.micro} ({sys.executable})"
    return CheckResult("Python", ok, detail)


_LYREBIRD_INSTALL_URL = "https://github.com/Meituan-Dianping/lyrebird#install"


def _lyrebird_check() -> CheckResult:
    if importlib.util.find_spec("lyrebird") is None:
        return CheckResult(
            "lyrebird (pip)",
            False,
            f"pip install 'hylyre[mock]' or pip install lyrebird — {_LYREBIRD_INSTALL_URL}",
        )
    try:
        ver = importlib.metadata.version("lyrebird")
        detail = f"package found{f', {ver}' if ver else ''}"
    except importlib.metadata.PackageNotFoundError:
        detail = "package found on import path"
    except Exception as e:  # pragma: no cover
        detail = f"package found but metadata lookup failed: {e}"
        return CheckResult("lyrebird (pip)", False, detail)
    return CheckResult("lyrebird (pip)", True, detail)


def _windows_openssl_env_check() -> CheckResult | None:
    if sys.platform != "win32":
        return None
    lib = os.environ.get("LIB", "").strip()
    inc = os.environ.get("INCLUDE", "").strip()
    if lib and inc:
        return CheckResult(
            "Windows: LIB/INCLUDE (Lyrebird OpenSSL)",
            True,
            "Both set; ensure they point at a prebuilt OpenSSL as in Lyrebird README.",
        )
    return CheckResult(
        "Windows: LIB/INCLUDE (Lyrebird OpenSSL)",
        False,
        "Not set — Lyrebird needs OpenSSL + LIB/INCLUDE on Windows, or use Docker "
        f"(overbridge/lyrebird). See {_LYREBIRD_INSTALL_URL}",
    )


def _cmd_version(exe: str, *version_args: str) -> tuple[bool, str]:
    path = shutil.which(exe)
    if not path:
        return False, f"{exe} not found on PATH"
    try:
        out = subprocess.run(
            [path, *version_args],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        line = (out.stdout or out.stderr or "").strip().splitlines()[0:1]
        ver = line[0] if line else "(no output)"
        return True, f"{path} → {ver}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)


def _mitmproxy_ca_file_check() -> CheckResult:
    p = Path.home() / ".mitmproxy" / "mitmproxy-ca-cert.pem"
    env = os.environ.get("HYLYRE_MITM_CA", "").strip()
    if env:
        p = Path(env).expanduser()
    mitm_on_path = bool(shutil.which("mitmproxy") or shutil.which("mitmdump"))
    if p.is_file():
        return CheckResult("mitmproxy CA (PEM)", True, str(p.resolve()))
    if not mitm_on_path:
        return CheckResult(
            "mitmproxy CA (PEM)",
            True,
            "N/A until mitmproxy on PATH — optional for plain HTTP mock",
        )
    return CheckResult(
        "mitmproxy CA (PEM)",
        False,
        "Not found at "
        f"{p}. Run mitmproxy once or set HYLYRE_MITM_CA; see hylyre mock push-ca",
    )


def gather_doctor_checks() -> list[CheckResult]:
    """Collect environment checks (shared by CLI doctor and MCP)."""
    rows: list[CheckResult] = [_python_check()]

    ok_node, node_detail = _cmd_version("node", "--version")
    rows.append(CheckResult("Node.js", ok_node, node_detail))

    ok_npm, npm_detail = _cmd_version("npm", "--version")
    rows.append(CheckResult("npm", ok_npm, npm_detail))

    hdc_ok, hdc_detail = _cmd_version("hdc", "version")
    rows.append(CheckResult("hdc (HarmonyOS)", hdc_ok, hdc_detail))

    mitm_ok = bool(shutil.which("mitmproxy") or shutil.which("mitmdump"))
    mitm_detail = (
        "mitmproxy / mitmdump on PATH"
        if mitm_ok
        else "Install mitmproxy: https://mitmproxy.org/ (required for Lyrebird proxy)"
    )
    rows.append(CheckResult("mitmproxy", mitm_ok, mitm_detail))

    rows.append(_mitmproxy_ca_file_check())

    rows.append(_lyrebird_check())
    win_ssl = _windows_openssl_env_check()
    if win_ssl is not None:
        rows.append(win_ssl)

    return rows


def format_doctor_plain(rows: list[CheckResult]) -> str:
    """Plain-text doctor summary for MCP (no Rich markup)."""
    lines = ["Hylyre doctor", "-" * 40]
    all_ok = True
    for r in rows:
        all_ok = all_ok and r.ok
        status = "OK" if r.ok else "MISSING"
        lines.append(f"{r.name}: {status} — {r.detail}")
    lines.append("-" * 40)
    lines.append("All checks passed." if all_ok else "Some optional tools are missing.")
    return "\n".join(lines)


def run_doctor() -> None:
    """Print environment readiness for Hylyre development and execution."""
    rows = gather_doctor_checks()

    table = Table(title="Hylyre doctor")
    table.add_column("Check", style="cyan")
    table.add_column("Status", style="bold")
    table.add_column("Detail")

    all_ok = True
    for r in rows:
        all_ok = all_ok and r.ok
        status = "[green]OK[/green]" if r.ok else "[red]MISSING[/red]"
        table.add_row(r.name, status, r.detail)

    console.print(table)

    if not rows[0].ok:
        console.print(
            "\n[bold red]Python 3.10+ required.[/bold red] "
            "Install from https://www.python.org/downloads/ and ensure `python` is on PATH."
        )
    if sys.platform == "win32":
        console.print(
            "\n[dim]Lyrebird on Windows: native wheels may require MSVC Build Tools "
            "(https://visualstudio.microsoft.com/visual-cpp-build-tools/). "
            "Docker alternative: image overbridge/lyrebird, then set HYLYRE_LYREBIRD_URL "
            "to the Lyrebird API base URL (see README).[/dim]"
        )
    if not all_ok:
        console.print(
            "\n[yellow]Some optional tools are missing; Hypium/Lyrebird paths may fail until installed.[/yellow]"
        )
    else:
        console.print("\n[green]All checks passed.[/green]")

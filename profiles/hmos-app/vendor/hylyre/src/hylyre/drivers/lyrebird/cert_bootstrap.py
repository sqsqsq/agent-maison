"""MITM / HarmonyOS trust: checklist + hdc push helpers (add-cert-bootstrap)."""

from __future__ import annotations

import os
from pathlib import Path

from hylyre.drivers.hypium import hdc_cli

_DEFAULT_REMOTE = "/data/local/tmp/hylyre-mitm-ca.pem"


def default_mitm_ca_path() -> Path:
    """Default mitmproxy CA location (may not exist yet)."""
    return Path.home() / ".mitmproxy" / "mitmproxy-ca-cert.pem"


def resolve_mitm_ca_cert(ca_cert: Path | None) -> Path:
    """Resolve PEM path: explicit > HYLYRE_MITM_CA > ~/.mitmproxy/mitmproxy-ca-cert.pem."""
    if ca_cert is not None:
        p = ca_cert.expanduser().resolve()
        if not p.is_file():
            raise FileNotFoundError(f"CA certificate not found: {p}")
        return p
    env = os.environ.get("HYLYRE_MITM_CA", "").strip()
    if env:
        p = Path(env).expanduser().resolve()
        if not p.is_file():
            raise FileNotFoundError(f"HYLYRE_MITM_CA is not a file: {p}")
        return p
    d = default_mitm_ca_path()
    if not d.is_file():
        raise FileNotFoundError(
            "No CA file: pass --ca-cert, set HYLYRE_MITM_CA, or run mitmproxy once to create "
            f"{d}"
        )
    return d


def push_mitm_ca_to_device(
    *,
    ca_cert: Path | None = None,
    serial: str | None = None,
    remote_path: str = _DEFAULT_REMOTE,
) -> tuple[Path, str]:
    """Push PEM to device via hdc. Returns (local_path, remote_path)."""
    local = resolve_mitm_ca_cert(ca_cert)
    hdc_cli.file_send(local, remote_path, serial=serial)
    return local, remote_path


def mitm_trust_instructions(
    *,
    hdc_serial: str | None = None,
    ca_cert: Path | None = None,
    device_remote_path: str | None = None,
) -> str:
    """Human-run steps; if device_remote_path set, assumes CA already pushed there."""
    lines = [
        "## HarmonyOS 设备信任 MITM / Lyrebird 证书",
        "",
    ]
    if device_remote_path:
        lines.extend(
            [
                f"CA 已推到设备路径：`{device_remote_path}`（见 `hylyre mock push-ca`）。",
                "1. 在设备 **设置 → 安全 → 加密与凭据 → 从存储安装**（或当前系统版本等价入口），",
                "   选择该路径下的证书文件并完成安装。",
                "2. 确认 Wi‑Fi / 应用已配置 Lyrebird 或 mitmproxy **代理主机与端口**。",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "自动化：在项目根执行 ",
                "`hylyre mock push-ca`（或 `--ca-cert` / 设置 `HYLYRE_MITM_CA`），",
                "将 mitmproxy PEM 推到 `/data/local/tmp/` 后再在设备上安装。",
                "",
                "手工清单：",
                "1. 在一台已安装 **mitmproxy** 的机器上生成或导出 CA（如 `~/.mitmproxy/mitmproxy-ca-cert.pem`）。",
                "2. 将 PEM 推到设备（`hdc file send ...` 或 `hylyre mock push-ca`）。",
                "3. 在设备 **设置** 中 **从存储安装** CA。",
                "4. 确认代理端口与 Lyrebird / mitmproxy 一致。",
                "",
            ]
        )
    if ca_cert:
        lines.append(f"- 参考证书路径：`{ca_cert}`")
    if hdc_serial:
        lines.append(
            f"- 多设备时使用 `hdc -t {hdc_serial} ...` 或 `hylyre mock push-ca --serial {hdc_serial}`。"
        )
    lines.append("")
    lines.append(
        "企业设备若禁止用户 CA，需预置合规代理或使用允许的调试证书。"
    )
    return "\n".join(lines)

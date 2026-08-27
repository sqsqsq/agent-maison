"""Lyrebird HTTP API + optional local process (requires `pip install 'hylyre[mock]'`)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx

from hylyre.drivers.base.mock_controller import MockControllerBase
from hylyre.drivers.lyrebird.exceptions import LyrebirdApiError


def require_lyrebird_distribution() -> None:
    if importlib.util.find_spec("lyrebird") is None:
        raise ImportError(
            "The `lyrebird` package is not installed. "
            "Install: pip install 'hylyre[mock]' (or pip install lyrebird). "
            "Run `hylyre doctor` for mitmproxy / Windows OpenSSL / Docker checks. "
            "Upstream: https://github.com/Meituan-Dianping/lyrebird#install"
        )


def _expect_code(payload: dict[str, Any]) -> None:
    code = payload.get("code")
    if code is not None and code != 1000:
        raise LyrebirdApiError(
            str(payload.get("message", payload)),
            payload=payload,
        )


class LyrebirdController(MockControllerBase):
    """Talks to Lyrebird admin API (default `http://127.0.0.1:9090`)."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:9090",
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(30.0),
        )
        self._proc: subprocess.Popen[bytes] | None = None

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def subprocess_pid(self) -> int | None:
        if self._proc is None:
            return None
        return int(self._proc.pid)

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def start_local(
        self,
        *,
        data_root: Path | None = None,
        mock_port: int = 9090,
        no_browser: bool = True,
    ) -> None:
        require_lyrebird_distribution()
        if self._proc is not None and self._proc.poll() is None:
            raise LyrebirdApiError("Lyrebird subprocess already running on this controller")
        if not self._owns_client:
            raise LyrebirdApiError(
                "start_local() requires a LyrebirdController that owns its HTTP client"
            )
        self._base_url = f"http://127.0.0.1:{mock_port}"
        await self.aclose()
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(30.0),
        )
        self._owns_client = True
        cmd: list[str] = [
            sys.executable,
            "-m",
            "lyrebird",
            "--mock",
            str(mock_port),
        ]
        if no_browser:
            cmd.append("-b")
        if data_root is not None:
            cmd.extend(["--data", str(data_root.resolve())])
        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        self._proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=creation_flags,
        )
        await self._wait_until_ready(timeout_s=45.0)

    async def _wait_until_ready(self, *, timeout_s: float) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        last_err: str | None = None
        while loop.time() < deadline:
            try:
                r = await self._client.get("/api/status")
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, dict) and data.get("code", 1000) == 1000:
                        return
            except (httpx.HTTPError, json.JSONDecodeError, LyrebirdApiError) as e:
                last_err = str(e)
            await asyncio.sleep(0.35)
        msg = "Lyrebird did not become ready in time"
        if last_err:
            msg += f": {last_err}"
        raise LyrebirdApiError(msg)

    async def stop_local(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()

    async def activate_group(self, group_id: str) -> None:
        r = await self._client.put(f"/api/mock/{group_id}/activate")
        if r.status_code >= 400:
            raise LyrebirdApiError(
                f"activate {group_id!r} failed: HTTP {r.status_code}",
                status_code=r.status_code,
                payload=_safe_json(r),
            )
        data = r.json()
        if isinstance(data, dict):
            _expect_code(data)

    async def deactivate_all(self) -> None:
        r = await self._client.put("/api/mock/group/deactivate")
        if r.status_code >= 400:
            raise LyrebirdApiError(
                f"deactivate failed: HTTP {r.status_code}",
                status_code=r.status_code,
                payload=_safe_json(r),
            )
        data = r.json()
        if isinstance(data, dict):
            _expect_code(data)

    async def status(self) -> dict[str, Any]:
        r = await self._client.get("/api/status")
        r.raise_for_status()
        body = r.json()
        if not isinstance(body, dict):
            raise LyrebirdApiError("Unexpected /api/status payload", payload=body)
        return body

    async def list_activated_groups(self) -> dict[str, Any]:
        r = await self._client.get("/api/mock/activated")
        if r.status_code >= 400:
            raise LyrebirdApiError(
                f"activated: HTTP {r.status_code}",
                status_code=r.status_code,
            )
        data = r.json()
        if not isinstance(data, dict):
            raise LyrebirdApiError("Unexpected activated payload", payload=data)
        _expect_code(data)
        inner = data.get("data")
        return inner if isinstance(inner, dict) else {}

    async def list_flows(self) -> list[dict[str, Any]]:
        r = await self._client.get("/api/flow")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict):
            _expect_code(data)
            inner = data.get("data")
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        raise LyrebirdApiError("Unexpected /api/flow payload", payload=data)

    async def export_flows(
        self, output: Path, *, full_detail: bool = False
    ) -> None:
        flows = await self.list_flows()
        if not full_detail:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(
                json.dumps(flows, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            return
        detailed: list[dict[str, Any]] = []
        for item in flows:
            fid = item.get("id")
            if not isinstance(fid, str):
                continue
            r = await self._client.get(f"/api/flow/{fid}")
            if r.status_code != 200:
                continue
            chunk = r.json()
            if isinstance(chunk, dict) and "data" in chunk:
                inner = chunk.get("data")
                if isinstance(inner, dict):
                    detailed.append(inner)
            elif isinstance(chunk, dict):
                detailed.append(chunk)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(detailed, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )


def _safe_json(r: httpx.Response) -> object | None:
    try:
        return r.json()
    except json.JSONDecodeError:
        return None

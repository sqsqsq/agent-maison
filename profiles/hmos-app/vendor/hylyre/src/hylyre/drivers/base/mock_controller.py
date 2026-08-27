"""Abstract mock / Lyrebird controller contract."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class MockControllerBase(ABC):
    """Async contract for HTTP mock backends (Lyrebird in P2)."""

    @abstractmethod
    async def start_local(
        self,
        *,
        data_root: Path | None = None,
        mock_port: int = 9090,
        no_browser: bool = True,
    ) -> None:
        """Start a local Lyrebird (or compatible) process; no-op if externally managed."""

    @abstractmethod
    async def stop_local(self) -> None:
        """Stop process started via `start_local` (no-op if none)."""

    @abstractmethod
    async def activate_group(self, group_id: str) -> None:
        """Activate a mock data group (Lyrebird group id / UUID string)."""

    @abstractmethod
    async def deactivate_all(self) -> None:
        """Deactivate all mock groups."""

    @abstractmethod
    async def status(self) -> dict[str, Any]:
        """Backend status payload (e.g. Lyrebird /api/status)."""

    @abstractmethod
    async def list_activated_groups(self) -> dict[str, Any]:
        """Return provider-specific structure of active groups (e.g. `/api/mock/activated`)."""

    @abstractmethod
    async def list_flows(self) -> list[dict[str, Any]]:
        """List captured proxy flows (summaries)."""

    @abstractmethod
    async def export_flows(
        self, output: Path, *, full_detail: bool = False
    ) -> None:
        """Write a JSON snapshot of captured flows (not a strict HAR export)."""

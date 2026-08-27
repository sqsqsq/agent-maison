"""Default composition: concrete Hypium / Lyrebird / HTTP VLM + ``HylyreAgent``.

Keeps `hylyre.api` free of imports of optional vendor packages at module import time
(where possible); this module may import `hypium` / `lyrebird` drivers.
"""

from __future__ import annotations

import os

from hylyre.api.agent import HylyreAgent
from hylyre.drivers.base import VlmClientBase


def create_hypium_agent(
    *,
    device_sn: str | None = None,
    vlm: VlmClientBase | None = None,
    mock_port: int | None = None,
    lyrebird_base_url: str | None = None,
) -> HylyreAgent:
    """Hypium UI + optional Lyrebird HTTP client + optional VLM.

    Lyrebird is only constructed when ``lyrebird_base_url`` or ``mock_port`` + env URL is set.
    Pass ``vlm`` or rely on CLI to attach ``HttpVlmClient.from_env()``.
    """
    from hylyre.drivers.hypium import HypiumDriver

    ui = HypiumDriver(device_sn=device_sn)
    mock = None
    base = (
        lyrebird_base_url
        or os.environ.get("HYLYRE_LYREBIRD_URL")
        or (
            f"http://127.0.0.1:{mock_port}"
            if mock_port is not None
            else None
        )
    )
    if base:
        from hylyre.drivers.lyrebird import LyrebirdController

        mock = LyrebirdController(base_url=base)
    return HylyreAgent(ui=ui, mock=mock, vlm=vlm)


def create_hypium_agent_with_env_vlm(
    *,
    device_sn: str | None = None,
    mock_port: int | None = None,
    lyrebird_base_url: str | None = None,
) -> HylyreAgent:
    """Like :func:`create_hypium_agent` but attaches :class:`HttpVlmClient` when env is set."""
    from hylyre.vlm import HttpVlmClient

    vlm = HttpVlmClient.from_env()
    return create_hypium_agent(
        device_sn=device_sn,
        vlm=vlm,
        mock_port=mock_port,
        lyrebird_base_url=lyrebird_base_url,
    )

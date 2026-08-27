"""Abstract UI driver (HarmonyOS / Hypium facade)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


def _exactly_one_touch_target(
    *,
    x: int | None,
    y: int | None,
    by_text: str | None,
    by_id: str | None,
) -> None:
    has_coord = x is not None and y is not None
    has_partial_coord = (x is not None) ^ (y is not None)
    if has_partial_coord:
        raise ValueError("touch coordinates require both x and y")
    n = sum([has_coord, by_text is not None, by_id is not None])
    if n != 1:
        raise ValueError(
            "touch requires exactly one of: (x and y), by_text, or by_id"
        )


class UiDriverBase(ABC):
    """Minimal async surface for P1 (Hypium-backed + fakes)."""

    @abstractmethod
    async def connect(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def start_app(
        self,
        bundle: str,
        *,
        page_name: str | None = None,
        params: str = "",
        wait_time: float = 1.0,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    async def touch(
        self,
        *,
        x: int | None = None,
        y: int | None = None,
        by_text: str | None = None,
        by_id: str | None = None,
        wait_time: float = 0.1,
    ) -> None:
        raise NotImplementedError

    async def locate_by_text(self, *, by_text: str) -> tuple[int, int] | None:
        """Hypium-native locate (``BY.text`` + ``find_component``). Optional; default unsupported."""
        _ = by_text
        return None

    @abstractmethod
    async def input_text(
        self,
        text: str,
        *,
        by_text: str | None = None,
        by_id: str | None = None,
        mode: Any | None = None,
    ) -> None:
        """If both selectors are omitted, implementations may use current cursor / focused field."""
        raise NotImplementedError

    @abstractmethod
    async def screenshot(self) -> bytes:
        """Raster screenshot bytes (Hypium emits JPEG; fakes may use PNG)."""
        raise NotImplementedError

    async def dump_ui(self) -> dict[str, Any]:
        """Return a JSON-serializable UI hierarchy for external planners (no VLM).

        Default: not implemented (Hypium / fakes override).
        """
        raise NotImplementedError(
            "dump_ui is not implemented for this UiDriver"
        )

    async def swipe(
        self,
        *,
        direction: str,
        distance: int = 60,
        area_by_text: str | None = None,
        area_by_id: str | None = None,
        area_by_type: str | None = None,
        area_by_key: str | None = None,
        area_scrollable: bool | None = None,
        side: str | None = None,
        start_point: tuple[float | int, float | int] | None = None,
        swipe_time: float = 0.3,
        speed: int | None = None,
    ) -> None:
        """Directional swipe (Hypium ``UiDriver.swipe``).

        Default: not implemented (Hypium / fakes override).
        """
        raise NotImplementedError("swipe is not implemented for this UiDriver")

    async def mouse_scroll(
        self,
        *,
        direction: str,
        steps: int,
        x: int | None = None,
        y: int | None = None,
        at_by_text: str | None = None,
        at_by_id: str | None = None,
        at_by_type: str | None = None,
        at_by_key: str | None = None,
        at_scrollable: bool | None = None,
        key1: int | None = None,
        key2: int | None = None,
    ) -> None:
        """Mouse-wheel style scroll (Hypium ``mouse_scroll``); typically vertical ``up``/``down``.

        Default: not implemented (Hypium / fakes override).
        """
        raise NotImplementedError(
            "mouse_scroll is not implemented for this UiDriver"
        )

    async def press_back(
        self,
        *,
        times: int = 1,
        mode: str = "key",
        side: str = "RIGHT",
        height: float = 0.5,
    ) -> None:
        """System / stack back (Hypium ``press_back`` / ``swipe_to_back``)."""
        raise NotImplementedError("press_back is not implemented for this UiDriver")

    async def press_home(self) -> None:
        """Home key / launcher (Hypium ``press_home`` / ``go_home``)."""
        raise NotImplementedError("press_home is not implemented for this UiDriver")

    async def stop_app(self, bundle: str, *, wait_time: float = 0.5) -> None:
        raise NotImplementedError("stop_app is not implemented for this UiDriver")

    async def clear_app_data(self, bundle: str) -> None:
        raise NotImplementedError(
            "clear_app_data is not implemented for this UiDriver"
        )

    async def wait_seconds(self, seconds: float) -> None:
        raise NotImplementedError("wait_seconds is not implemented for this UiDriver")

    async def wait_for_selector(
        self,
        *,
        by_text: str | None = None,
        by_id: str | None = None,
        by_type: str | None = None,
        by_key: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        raise NotImplementedError(
            "wait_for_selector is not implemented for this UiDriver"
        )

    async def wait_for_selector_gone(
        self,
        *,
        by_text: str | None = None,
        by_id: str | None = None,
        by_type: str | None = None,
        by_key: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        raise NotImplementedError(
            "wait_for_selector_gone is not implemented for this UiDriver"
        )

    async def wait_for_idle(
        self,
        *,
        idle_time: float = 0.7,
        timeout: float = 10.0,
    ) -> None:
        raise NotImplementedError(
            "wait_for_idle is not implemented for this UiDriver"
        )

    async def assert_toast(
        self,
        text: str,
        *,
        timeout: float = 3.0,
        fuzzy: str = "equal",
        poll_interval: float = 0.3,
        on_unsupported: str = "error",
    ) -> None:
        raise NotImplementedError("assert_toast is not implemented for this UiDriver")

    def _validate_touch_kwargs(
        self,
        *,
        x: int | None,
        y: int | None,
        by_text: str | None,
        by_id: str | None,
    ) -> None:
        _exactly_one_touch_target(x=x, y=y, by_text=by_text, by_id=by_id)

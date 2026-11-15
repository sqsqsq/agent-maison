"""Hypium-native adaptations for the JSON common-operation contract."""

from __future__ import annotations

from typing import Any

from hylyre.api.component_properties import property_value
from hylyre.api.exceptions import CapabilityUnsupported, PlannedStepContractError, SelectorResolutionError
from hylyre.ui_dump_hints import parse_bounds_rect


class HypiumCommonOperations:
    async def _common_call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        from hylyre.drivers.hypium.driver import _to_thread
        await self._require_raw()
        fn = getattr(self._raw, name, None)
        if not callable(fn):
            raise CapabilityUnsupported(f"Hypium {name} is unavailable")
        try:
            from hypium.exception import HypiumNotSupportError, HypiumNotImplementError
            unsupported = (HypiumNotSupportError, HypiumNotImplementError, NotImplementedError)
        except ImportError:
            unsupported = (NotImplementedError,)
        try:
            return await _to_thread(fn, *args, **kwargs)
        except unsupported as exc:
            raise CapabilityUnsupported(str(exc)) from exc

    def _connected_serial(self) -> str:
        serial = self._device_sn or getattr(self._raw, "device_sn", None)
        if not isinstance(serial, str) or not serial.strip() or serial == "unknown":
            raise CapabilityUnsupported("cannot identify the connected HDC device serial")
        return serial

    async def _native_identity(self, target: dict[str, Any]) -> Any:
        from hylyre.drivers.hypium.driver import load_hypium_shim, _to_thread
        await self._require_raw()
        shim = load_hypium_shim()
        if target.get("id"):
            by = shim.BY.id(target["id"])
        elif target.get("key"):
            by = shim.BY.key(target["key"])
        else:
            by = shim.BY.type(target["type"])
        fn = getattr(self._raw, "find_all_components", None)
        if not callable(fn):
            raise CapabilityUnsupported("native component identity cannot be verified")
        components = await _to_thread(fn, by)
        if components is None:
            components = []
        elif not isinstance(components, (tuple, list)):
            components = [components]
        expected = parse_bounds_rect(target.get("bounds"))
        matches = []
        for component in components:
            bounds = await self._common_call("get_component_property", component, "bounds")
            if all(hasattr(bounds, k) for k in ("left", "top", "right", "bottom")):
                actual = (int(bounds.left), int(bounds.top), int(bounds.right), int(bounds.bottom))
            elif isinstance(bounds, (list, tuple)) and len(bounds) == 4:
                actual = tuple(bounds)
            else:
                actual = parse_bounds_rect(str(bounds))
            if expected is not None and actual == expected:
                matches.append(component)
        if len(matches) != 1:
            raise SelectorResolutionError(
                f"native identity has {len(matches)} matches for resolved bounds",
                failure_code="selector_ambiguous" if len(matches) > 1 else "selector_not_found",
                candidates_summary=[{"id": target.get("id"), "bounds": target.get("bounds")} for _ in matches],
            )
        return matches[0]

    async def drag(self, *, start: tuple, end: tuple, press_time: float | None = None,
                   drag_time: float = 1, speed: int | None = None) -> None:
        await self._require_raw()
        if press_time is not None:
            if press_time < 1.5:
                raise CapabilityUnsupported("Hypium 6.0.7.210 cannot honor drag.press_time below its 1.5-second native hold")
            impl = getattr(self._raw, "_driver_impl", None)
            backend = getattr(impl, "driver", None)
            get_level = getattr(backend, "get_api_level", None)
            if not callable(get_level):
                raise CapabilityUnsupported("cannot verify API >= 20 for explicit drag.press_time")
            from hylyre.drivers.hypium.driver import _to_thread
            if await _to_thread(get_level) < 20:
                raise CapabilityUnsupported("explicit drag.press_time requires device API >= 20")
        kwargs = {"drag_time": drag_time}
        if press_time is not None:
            kwargs["press_time"] = press_time
        if speed is not None:
            kwargs["speed"] = speed
        await self._common_call("drag", start, end, **kwargs)

    async def slide(self, *, start: tuple, end: tuple, duration: float = 0.3) -> None:
        await self._common_call("slide", start, end, slide_time=duration)

    @staticmethod
    def _rect(area: tuple[int, int, int, int] | None) -> Any:
        if area is None:
            return None
        from hypium.model.basic_data_type import Rect
        left, top, right, bottom = area
        return Rect(left=left, top=top, right=right, bottom=bottom)

    async def fling(self, *, direction: str, distance: int = 50, area: tuple | None = None, speed: str = "fast") -> None:
        await self._common_call("fling", direction.upper(), distance=distance, area=self._rect(area), speed=speed)

    async def pinch_in(self, *, area: tuple, scale: float = 0.4, direction: str = "diagonal", **kwargs: Any) -> None:
        await self._common_call("pinch_in", self._rect(area), scale=scale, direction=direction, **kwargs)

    async def pinch_out(self, *, area: tuple, scale: float = 1.6, direction: str = "diagonal", **kwargs: Any) -> None:
        await self._common_call("pinch_out", self._rect(area), scale=scale, direction=direction, **kwargs)

    @staticmethod
    def _area_point(point: tuple[int, int], area: tuple | None) -> tuple[int, int]:
        # Hypium adds Rect.left/top to integer pixels too; subtract exactly once.
        return (point[0] - area[0], point[1] - area[1]) if area else point

    async def two_finger_swipe(self, *, start1: tuple, end1: tuple, start2: tuple, end2: tuple,
                               duration: float = 0.5, area: tuple | None = None) -> None:
        points = [self._area_point(p, area) for p in (start1, end1, start2, end2)]
        await self._common_call("two_finger_swipe", *points, duration=duration, area=self._rect(area))

    async def multi_finger_touch(self, *, points: list[tuple], duration: float = 0.1, area: tuple | None = None) -> None:
        await self._common_call("multi_finger_touch", [self._area_point(p, area) for p in points], duration=duration, area=self._rect(area))

    async def gesture(self, *, fingers: list[list[tuple]], speed: int = 2000) -> None:
        from hypium.uidriver.gesture import Gesture
        gestures = []
        for points in fingers:
            gesture = Gesture().start(points[0])
            for point in points[1:]:
                gesture.move_to(point)
            gestures.append(gesture)
        if len(gestures) == 1:
            await self._common_call("inject_gesture", gestures[0], speed=speed)
        else:
            await self._common_call("inject_multi_finger_gesture", gestures, speed=speed)

    @staticmethod
    def _key(value: str | int) -> Any:
        from hypium.model.basic_data_type import KeyCode
        return KeyCode[value] if isinstance(value, str) else value

    async def press_key(self, *, key: str | int, mode: str = "normal") -> None:
        await self._common_call("press_key", self._key(key), mode=mode)

    async def press_combination_key(self, *, keys: list[str | int]) -> None:
        if len(keys) == 3:
            await self._require_raw()
            backend = getattr(getattr(self._raw, "_driver_impl", None), "driver", None)
            get_os_info = getattr(backend, "get_os_info", None)
            if not callable(get_os_info):
                raise CapabilityUnsupported("cannot verify native three-key combination support")
            from hylyre.drivers.hypium.driver import _to_thread
            os_info = await _to_thread(get_os_info)
            # This SDK documents that HMOS silently ignores the third key.
            if not isinstance(os_info, (tuple, list)) or not os_info or str(os_info[0]).strip().lower() != "openharmony":
                raise CapabilityUnsupported("three-key combinations require confirmed OpenHarmony; HMOS ignores the third key")
        await self._common_call("press_combination_key", *(self._key(key) for key in keys))

    async def clear_text(self, *, target: dict[str, Any]) -> None:
        component = await self._native_identity(target)
        typ = await self._common_call("get_component_property", component, "type")
        if not any(name in str(typ).lower() for name in ("input", "textarea", "textfield", "search")):
            raise PlannedStepContractError(f"clear_text target type {typ!r} is not an input component")
        await self._common_call("clear_text", component)

    async def move_cursor(self, *, direction: str, times: int = 1) -> None:
        await self._common_call("move_cursor", direction.upper() if direction in {"left", "right", "up", "down"} else direction, times=times)

    async def get_component_property(self, *, target: dict[str, Any], property: str) -> Any:
        component = await self._native_identity(target)
        value = await self._common_call("get_component_property", component, property)
        return property_value({property: value}, property)

    async def current_app(self) -> dict[str, Any]:
        value = await self._common_call("current_app")
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            bundle, ability = value[:2]
        elif isinstance(value, str):
            bundle, ability = value, None
        elif isinstance(value, dict) and value.get("bundle"):
            bundle, ability = value["bundle"], value.get("ability")
        else:
            raise CapabilityUnsupported("current_app returned no observable bundle")
        if not isinstance(bundle, str) or not bundle.strip():
            raise CapabilityUnsupported("current_app returned no observable bundle")
        return {"bundle": bundle, "ability": ability or None,
                **({"ability_unavailable": "provider returned no ability"} if not ability else {})}

    async def has_app(self, *, bundle: str) -> bool:
        # Native has_app uses a substring shell filter; compare the fixed package list exactly.
        result = await self.shell(command="bm dump -a")
        if result.get("exit_code") != 0 or result.get("transport_exit_code", 0) != 0 or result.get("transport_error") or result.get("timed_out"):
            raise ConnectionError("cannot obtain the installed bundle list")
        return bundle in {line.strip() for line in result["stdout"].splitlines()}

    async def recent_tasks(self) -> None:
        await self._common_call("swipe_to_recent_task")

    async def shell(self, *, command: str, timeout: float = 60) -> dict[str, Any]:
        from hylyre.drivers.hypium.driver import _to_thread
        from hylyre.drivers.hypium.hdc_cli import structured_shell, HdcNotFoundError
        await self._require_raw()
        try:
            return await _to_thread(structured_shell, command, serial=self._connected_serial(), timeout=timeout)
        except HdcNotFoundError as exc:
            raise CapabilityUnsupported(str(exc)) from exc

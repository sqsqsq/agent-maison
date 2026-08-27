"""Hypium-backed UiDriver (optional dependency: pip install 'hylyre[device]')."""

from __future__ import annotations

import asyncio
import importlib
import time
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from types import ModuleType
from typing import Any, Callable, TypeVar

from hylyre.diagnostic_log import diagnostic_log
from hylyre.drivers.base.ui_driver import UiDriverBase

_T = TypeVar("_T")


@dataclass(frozen=True)
class _HypiumShim:
    """Resolved Hypium imports (lazy)."""

    hypium_mod: ModuleType
    UiDriver: Any
    BY: Any


_hypium_singleton: _HypiumShim | None = None


def load_hypium_shim() -> _HypiumShim:
    """Import Hypium lazily so `hylyre` installs without the device extra.

    NOTE for MCP stdio: this import has side effects (xdevice's
    ``platform_logger`` attaches a ``StreamHandler(sys.stdout)`` at module load
    time). Callers serving over stdio must invoke this function *before* the
    transport rebinds ``sys.stdout``, ideally with ``sys.stdout`` temporarily
    pointed at ``sys.stderr`` so captured handlers do not poison the JSON-RPC
    channel. See :func:`hylyre.mcp.server.serve_stdio`.
    """
    global _hypium_singleton
    if _hypium_singleton is None:
        try:
            hypium_mod = importlib.import_module("hypium")
        except ImportError as e:  # pragma: no cover - message only
            raise ImportError(
                "Hypium is not installed. Install the device extra: "
                "pip install 'hylyre[device]'"
            ) from e
        UiDriver = getattr(hypium_mod, "UiDriver")
        BY = getattr(hypium_mod, "BY")
        _hypium_singleton = _HypiumShim(
            hypium_mod=hypium_mod, UiDriver=UiDriver, BY=BY
        )
    return _hypium_singleton


def reset_hypium_shim_for_tests() -> None:
    """Test hook: clear lazy Hypium singleton."""
    global _hypium_singleton
    _hypium_singleton = None


async def _to_thread(fn: Callable[..., _T], /, *args: Any, **kwargs: Any) -> _T:
    import functools

    try:
        import anyio.to_thread as _ayt

        return await _ayt.run_sync(functools.partial(fn, *args, **kwargs))
    except ImportError:
        return await asyncio.to_thread(fn, *args, **kwargs)


def _validate_swipe_distance_pct(distance: int) -> int:
    d = int(distance)
    if d < 1 or d > 100:
        raise ValueError("swipe distance must be an integer 1–100 (percent of swipe region)")
    return d


def _normalize_hypium_swipe_direction(direction: str) -> str:
    d = direction.strip().upper()
    if d not in {"UP", "DOWN", "LEFT", "RIGHT"}:
        raise ValueError(
            "swipe direction must be UP, DOWN, LEFT, or RIGHT "
            f"(case-insensitive); got {direction!r}"
        )
    return d


def _normalize_hypium_swipe_side(side: str | None) -> Any:
    if side is None:
        return None
    from hypium.model.basic_data_type import UiParam

    key = side.strip().upper()
    mapping = {
        "LEFT": UiParam.LEFT,
        "RIGHT": UiParam.RIGHT,
        "TOP": UiParam.TOP,
        "BOTTOM": UiParam.BOTTOM,
    }
    if key not in mapping:
        raise ValueError(
            "swipe side must be LEFT, RIGHT, TOP, or BOTTOM "
            f"(case-insensitive); got {side!r}"
        )
    return mapping[key]


def _center_from_hypium_bounds(raw_bounds: Any) -> tuple[int, int] | None:
    from hylyre.ui_dump_hints import parse_bounds_rect

    if isinstance(raw_bounds, str):
        rect = parse_bounds_rect(raw_bounds)
    elif isinstance(raw_bounds, (list, tuple)) and len(raw_bounds) >= 4:
        rect = tuple(int(v) for v in raw_bounds[:4])  # type: ignore[assignment]
    elif raw_bounds is not None and all(
        hasattr(raw_bounds, attr) for attr in ("left", "top", "right", "bottom")
    ):
        rect = (
            int(raw_bounds.left),
            int(raw_bounds.top),
            int(raw_bounds.right),
            int(raw_bounds.bottom),
        )
    else:
        return None
    if rect is None:
        return None
    x1, y1, x2, y2 = rect
    return ((x1 + x2) // 2, (y1 + y2) // 2)


def _hypium_component_center(comp: Any) -> tuple[int, int] | None:
    for name in ("getBounds", "get_bounds"):
        fn = getattr(comp, name, None)
        if callable(fn):
            center = _center_from_hypium_bounds(fn())
            if center is not None:
                return center
    bounds = getattr(comp, "bounds", None)
    if bounds is not None:
        return _center_from_hypium_bounds(bounds)
    for name in ("getCenter", "get_center", "center"):
        val = getattr(comp, name, None)
        if callable(val):
            val = val()
        if isinstance(val, (list, tuple)) and len(val) >= 2:
            return (int(val[0]), int(val[1]))
    return None


def _hypium_single_selector(shim: _HypiumShim, **kw: Any) -> Any:
    """At most one of by_text / by_id / by_type / by_key, optionally chained with scrollable."""
    by_text = kw.get("by_text")
    by_id = kw.get("by_id")
    by_type = kw.get("by_type")
    by_key = kw.get("by_key")
    scrollable = kw.get("scrollable")
    opts = [
        ("by_text", by_text),
        ("by_id", by_id),
        ("by_type", by_type),
        ("by_key", by_key),
    ]
    present = [(name, val) for name, val in opts if val is not None]
    if len(present) > 1:
        raise ValueError(
            "pass at most one of by_text, by_id, by_type, by_key for swipe area / scroll at"
        )
    if not present:
        return None
    name, val = present[0]
    if name == "by_text":
        sel = shim.BY.text(val)
    elif name == "by_id":
        sel = shim.BY.id(val)
    elif name == "by_type":
        sel = shim.BY.type(val)
    else:
        sel = shim.BY.key(val)
    if scrollable is True:
        sel = sel.scrollable(True)
    return sel


class HypiumDriver(UiDriverBase):
    def __init__(
        self,
        *,
        device_sn: str | None = None,
        log_level: str = "info",
        connect_kwargs: dict[str, Any] | None = None,
    ) -> None:
        self._device_sn = device_sn
        self._log_level = log_level
        self._extra_connect = connect_kwargs or {}
        self._raw: Any | None = None

    @property
    def raw(self) -> Any | None:
        """Underlying hypium.UiDriver instance (set after connect)."""
        return self._raw

    async def connect(self) -> None:
        if self._raw is not None:
            return

        def _load_and_connect() -> Any:
            shim = load_hypium_shim()
            kwargs: dict[str, Any] = {
                "log_level": self._log_level,
                **self._extra_connect,
            }
            if self._device_sn is not None:
                kwargs["device_sn"] = self._device_sn
            return shim.UiDriver.connect(connector="hdc", **kwargs)

        self._raw = await _to_thread(_load_and_connect)

    async def close(self) -> None:
        if self._raw is None:
            return
        raw = self._raw
        self._raw = None
        await _to_thread(raw.close)

    async def start_app(
        self,
        bundle: str,
        *,
        page_name: str | None = None,
        params: str = "",
        wait_time: float = 1.0,
    ) -> None:
        await self._require_raw()
        raw = self._raw
        await _to_thread(
            lambda: raw.start_app(
                bundle, page_name, params, wait_time
            )
        )

    async def touch(
        self,
        *,
        x: int | None = None,
        y: int | None = None,
        by_text: str | None = None,
        by_id: str | None = None,
        wait_time: float = 0.1,
    ) -> None:
        self._validate_touch_kwargs(
            x=x, y=y, by_text=by_text, by_id=by_id
        )
        await self._require_raw()
        shim = load_hypium_shim()
        raw = self._raw
        if x is not None and y is not None:
            target = (int(x), int(y))
        elif by_text is not None:
            target = shim.BY.text(by_text)
        else:
            target = shim.BY.id(by_id)
        wt = float(wait_time)
        await _to_thread(
            lambda: raw.touch(
                target,
                mode="normal",
                scroll_target=None,
                wait_time=wt,
                offset=None,
            )
        )

    async def locate_by_text(self, *, by_text: str) -> tuple[int, int] | None:
        await self._require_raw()
        shim = load_hypium_shim()
        raw = self._raw
        text = str(by_text)

        def _locate() -> tuple[int, int] | None:
            comp = raw.find_component(shim.BY.text(text))
            return _hypium_component_center(comp)

        try:
            return await _to_thread(_locate)
        except Exception as e:
            diagnostic_log(f"hypium locate_by_text miss text={text!r} err={e!r}")
            return None

    async def input_text(
        self,
        text: str,
        *,
        by_text: str | None = None,
        by_id: str | None = None,
        mode: Any | None = None,
    ) -> None:
        await self._require_raw()
        raw = self._raw
        if by_text is None and by_id is None:
            await _to_thread(lambda: raw.input_text_on_current_cursor(text))
            return
        shim = load_hypium_shim()
        if by_text is not None and by_id is not None:
            raise ValueError("pass at most one of by_text or by_id")
        selector = shim.BY.text(by_text) if by_text is not None else shim.BY.id(by_id)
        component = await _to_thread(
            lambda: raw.find_component(selector)
        )
        await _to_thread(
            lambda: raw.input_text(component, text, mode)
        )

    async def screenshot(self) -> bytes:
        await self._require_raw()
        raw = self._raw
        # Hypium checks save_path.endswith("jpeg") — ".jpg" is rejected.
        with NamedTemporaryFile(suffix=".jpeg", delete=False) as tmp:
            path = Path(tmp.name)
        try:
            await _to_thread(
                lambda: raw.capture_screen(str(path), True, None)
            )
            return await _to_thread(path.read_bytes)
        finally:
            path.unlink(missing_ok=True)

    async def dump_ui(self) -> dict[str, Any]:
        """Dump UI hierarchy via Hypium ``UiTree`` (device ``uitest dumpLayout``)."""
        await self._require_raw()
        raw = self._raw

        def _sync_dump() -> dict[str, Any]:
            uitree = raw.UiTree
            t0 = time.perf_counter()
            uitree.refresh()
            diagnostic_log(
                f"hypium_dump_ui uitree.refresh_ms="
                f"{(time.perf_counter() - t0) * 1000:.1f}"
            )
            tree = uitree.tree
            if tree is None:
                raise RuntimeError("Hypium UiTree.refresh() produced no tree")
            return {
                "schema_version": "hylyre-hypium-ui-dump-v1",
                "source": "hypium.UiTree",
                "tree": tree,
            }

        return await _to_thread(_sync_dump)

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
        await self._require_raw()
        shim = load_hypium_shim()
        raw = self._raw
        dir_s = _normalize_hypium_swipe_direction(direction)
        dist = _validate_swipe_distance_pct(distance)
        area = _hypium_single_selector(
            shim,
            by_text=area_by_text,
            by_id=area_by_id,
            by_type=area_by_type,
            by_key=area_by_key,
            scrollable=area_scrollable,
        )
        side_arg = _normalize_hypium_swipe_side(side)
        sp: tuple[float, float] | None = None
        if start_point is not None:
            sp = (float(start_point[0]), float(start_point[1]))
        wt = float(swipe_time)
        spd = None if speed is None else int(speed)

        def _go() -> None:
            raw.swipe(dir_s, dist, area, side_arg, sp, wt, spd)

        await _to_thread(_go)

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
        await self._require_raw()
        shim = load_hypium_shim()
        raw = self._raw
        from hypium.model.basic_data_type import UiParam

        dl = direction.strip().lower()
        if dl in ("up", "u"):
            scroll_dir = UiParam.UP
        elif dl in ("down", "d"):
            scroll_dir = UiParam.DOWN
        else:
            raise ValueError(
                "mouse_scroll direction must be up or down "
                f"(case-insensitive); got {direction!r}"
            )
        st = int(steps)
        if st < 1:
            raise ValueError("mouse_scroll steps must be >= 1")

        selector = _hypium_single_selector(
            shim,
            by_text=at_by_text,
            by_id=at_by_id,
            by_type=at_by_type,
            by_key=at_by_key,
            scrollable=at_scrollable,
        )
        if selector is not None:
            if x is not None or y is not None:
                raise ValueError(
                    "mouse_scroll: do not pass x/y together with at_by_* selectors"
                )
            pos: Any = selector
        elif x is not None and y is not None:
            pos = (int(x), int(y))
        elif x is None and y is None:
            pos = (0.5, 0.5)
        else:
            raise ValueError("mouse_scroll requires both x and y when using coordinates")

        def _go() -> None:
            raw.mouse_scroll(pos, scroll_dir, st, key1, key2)

        await _to_thread(_go)

    async def press_back(
        self,
        *,
        times: int = 1,
        mode: str = "key",
        side: str = "RIGHT",
        height: float = 0.5,
    ) -> None:
        await self._require_raw()
        raw = self._raw
        t = max(1, int(times))
        mode_l = str(mode).strip().lower()
        side_s = str(side).strip().upper()
        h = float(height)

        def _once_key() -> None:
            fn = getattr(raw, "press_back", None) or getattr(raw, "go_back", None)
            if fn is None:
                raise RuntimeError("Hypium UiDriver has no press_back/go_back")
            fn()

        def _once_swipe() -> None:
            raw.swipe_to_back(side=side_s, times=1, height=h)

        for _ in range(t):
            if mode_l == "swipe":
                await _to_thread(_once_swipe)
            elif mode_l in ("key", "normal", ""):
                await _to_thread(_once_key)
            else:
                raise ValueError(
                    "press_back mode must be 'key' or 'swipe' "
                    f"(got {mode!r})"
                )

    async def press_home(self) -> None:
        await self._require_raw()
        raw = self._raw

        def _go() -> None:
            fn = getattr(raw, "press_home", None) or getattr(raw, "go_home", None)
            if fn is None:
                raise RuntimeError("Hypium UiDriver has no press_home/go_home")
            fn()

        await _to_thread(_go)

    async def stop_app(self, bundle: str, *, wait_time: float = 0.5) -> None:
        await self._require_raw()
        raw = self._raw
        pkg = str(bundle)
        wt = float(wait_time)
        await _to_thread(lambda: raw.stop_app(pkg, wt))

    async def clear_app_data(self, bundle: str) -> None:
        await self._require_raw()
        raw = self._raw
        pkg = str(bundle)
        await _to_thread(lambda: raw.clear_app_data(pkg))

    async def wait_seconds(self, seconds: float) -> None:
        await self._require_raw()
        raw = self._raw
        sec = float(seconds)
        if sec < 0:
            raise ValueError("wait seconds must be >= 0")
        await _to_thread(lambda: raw.wait(sec))

    async def wait_for_selector(
        self,
        *,
        by_text: str | None = None,
        by_id: str | None = None,
        by_type: str | None = None,
        by_key: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        await self._require_raw()
        shim = load_hypium_shim()
        raw = self._raw
        sel = _hypium_single_selector(
            shim,
            by_text=by_text,
            by_id=by_id,
            by_type=by_type,
            by_key=by_key,
        )
        if sel is None:
            raise ValueError(
                "wait_for_selector requires one of by_text, by_id, by_type, by_key"
            )
        to = float(timeout)
        await _to_thread(lambda: raw.wait_for_component(sel, to))

    async def wait_for_selector_gone(
        self,
        *,
        by_text: str | None = None,
        by_id: str | None = None,
        by_type: str | None = None,
        by_key: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        await self._require_raw()
        shim = load_hypium_shim()
        raw = self._raw
        sel = _hypium_single_selector(
            shim,
            by_text=by_text,
            by_id=by_id,
            by_type=by_type,
            by_key=by_key,
        )
        if sel is None:
            raise ValueError(
                "wait_for_selector_gone requires one of "
                "by_text, by_id, by_type, by_key"
            )
        to = float(timeout)
        await _to_thread(lambda: raw.wait_for_component_disappear(sel, to))

    async def wait_for_idle(
        self,
        *,
        idle_time: float = 0.7,
        timeout: float = 10.0,
    ) -> None:
        await self._require_raw()
        raw = self._raw
        idle = float(idle_time)
        to = float(timeout)
        await _to_thread(lambda: raw.wait_for_idle(idle, to))

    async def assert_toast(
        self,
        text: str,
        *,
        timeout: float = 3.0,
        fuzzy: str = "equal",
        poll_interval: float = 0.3,
        on_unsupported: str = "error",
    ) -> None:
        await self._require_raw()
        raw = self._raw
        expect = str(text)
        deadline = time.monotonic() + float(timeout)
        interval = max(0.05, float(poll_interval))
        fz = str(fuzzy)
        mode = str(on_unsupported).strip().lower()

        def _try_once() -> bool:
            try:
                raw.check_toast(expect, fz, int(max(1, timeout)))
                return True
            except Exception:
                return False

        last_err: Exception | None = None
        while time.monotonic() < deadline:
            try:
                ok = await _to_thread(_try_once)
                if ok:
                    return
            except Exception as e:
                last_err = e
            await asyncio.sleep(interval)

        if mode == "skip":
            from hylyre.api.exceptions import StepSkipped

            raise StepSkipped(
                f"toast assertion unsupported or timed out for {expect!r} "
                f"(on_unsupported=skip)"
            )
        msg = (
            last_err.args[0]
            if last_err and last_err.args
            else f"toast not found: {expect!r} within {timeout}s"
        )
        raise RuntimeError(msg)

    async def install_app(self, hap_path: str | Path, **kwargs: Any) -> None:
        """Install a .hap from the host via Hypium (uses hdc under the hood)."""
        await self._require_raw()
        raw = self._raw
        hap = str(hap_path)
        await _to_thread(lambda: raw.install_app(hap, "", **kwargs))

    async def _require_raw(self) -> None:
        if self._raw is None:
            raise RuntimeError("UiDriver is not connected; call connect() first")

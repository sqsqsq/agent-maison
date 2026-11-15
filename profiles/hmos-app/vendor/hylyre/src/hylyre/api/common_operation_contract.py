"""JSON-only validation shared by preflight and every operation entry point."""

from __future__ import annotations

import math
from typing import Any

from hylyre.api.component_properties import BOOLEAN_PROPERTIES, COMPONENT_PROPERTIES
from hylyre.api.exceptions import PlannedStepContractError, SelectorContractError

# Registration requires an explicit offline-observation policy for each operation.
COMMON_OPERATION_REQUIRES_OBSERVATION: dict[str, bool] = {
    "drag": False,
    "slide": False,
    "fling": False,
    "pinch_in": False,
    "pinch_out": False,
    "two_finger_swipe": False,
    "multi_finger_touch": False,
    "gesture": False,
    "press_key": False,
    "press_combination_key": False,
    "get_component_property": True,
    "shell": True,
    "clear_text": False,
    "move_cursor": False,
    "set_checked": True,
    "current_app": True,
    "has_app": True,
    "recent_tasks": False,
}
COMMON_OPERATION_KEYS = tuple(COMMON_OPERATION_REQUIRES_OBSERVATION)

COMMON_OPERATION_EXAMPLES = {
    "drag": {"start": {"by_id": "item"}, "end": {"x": 300, "y": 500}, "press_time": 1.5},
    "slide": {"start": {"x": 100, "y": 200}, "end": {"x": 300, "y": 500}, "duration": 0.3},
    "fling": {"direction": "UP", "distance": 50, "speed": "fast"},
    "pinch_in": {"area": {"by_id": "canvas"}, "scale": 0.4, "direction": "diagonal"},
    "pinch_out": {"area": {"by_id": "canvas"}, "scale": 1.6, "direction": "diagonal"},
    "two_finger_swipe": {"start1": {"x": 100, "y": 200}, "end1": {"x": 100, "y": 400},
                         "start2": {"x": 200, "y": 200}, "end2": {"x": 200, "y": 400}, "duration": 0.5},
    "multi_finger_touch": {"points": [{"x": 100, "y": 200}, {"x": 200, "y": 200}], "duration": 0.1},
    "gesture": {"fingers": [{"points": [{"x": 100, "y": 200}, {"x": 200, "y": 300}, {"x": 300, "y": 200}]}], "speed": 2000},
    "press_key": {"key": "ENTER", "mode": "normal"},
    "press_combination_key": {"keys": ["CTRL_LEFT", "A"]},
    "get_component_property": {"target": {"by_id": "field"}, "property": "text"},
    "shell": {"command": "printf 'hylyre\\n'", "timeout": 60},
    "clear_text": {"target": {"by_id": "field"}},
    "move_cursor": {"direction": "left", "times": 1},
    "set_checked": {"target": {"by_id": "checkbox"}, "checked": True, "timeout": 3},
    "current_app": {}, "has_app": {"bundle": "com.example.app"}, "recent_tasks": {},
}

# Hypium 6.0.7.210 names, frozen here so preflight does not import the device extra.
KEY_NAMES: frozenset[str] = frozenset(('FN', 'UNKNOWN', 'HOME', 'BACK', 'MEDIA_PLAY_PAUSE', 'MEDIA_STOP', 'MEDIA_NEXT', 'MEDIA_PREVIOUS', 'MEDIA_REWIND', 'MEDIA_FAST_FORWARD', 'VOLUME_UP', 'VOLUME_DOWN', 'POWER', 'CAMERA', 'VOLUME_MUTE', 'MUTE', 'BRIGHTNESS_UP', 'BRIGHTNESS_DOWN', 'NUM_0', 'NUM_1', 'NUM_2', 'NUM_3', 'NUM_4', 'NUM_5', 'NUM_6', 'NUM_7', 'NUM_8', 'NUM_9', 'STAR', 'POUND', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'COMMA', 'PERIOD', 'ALT_LEFT', 'ALT_RIGHT', 'SHIFT_LEFT', 'SHIFT_RIGHT', 'TAB', 'SPACE', 'SYM', 'EXPLORER', 'ENVELOPE', 'ENTER', 'DEL', 'GRAVE', 'MINUS', 'EQUALS', 'LEFT_BRACKET', 'RIGHT_BRACKET', 'BACKSLASH', 'SEMICOLON', 'APOSTROPHE', 'SLASH', 'AT', 'PLUS', 'MENU', 'PAGE_UP', 'PAGE_DOWN', 'ESCAPE', 'FORWARD_DEL', 'CTRL_LEFT', 'CTRL_RIGHT', 'CAPS_LOCK', 'SCROLL_LOCK', 'META_LEFT', 'META_RIGHT', 'FUNCTION', 'SYSRQ', 'BREAK', 'MOVE_HOME', 'MOVE_END', 'INSERT', 'FORWARD', 'MEDIA_PLAY', 'MEDIA_PAUSE', 'MEDIA_CLOSE', 'MEDIA_EJECT', 'MEDIA_RECORD', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'NUM_LOCK', 'NUMPAD_0', 'NUMPAD_1', 'NUMPAD_2', 'NUMPAD_3', 'NUMPAD_4', 'NUMPAD_5', 'NUMPAD_6', 'NUMPAD_7', 'NUMPAD_8', 'NUMPAD_9', 'NUMPAD_DIVIDE', 'NUMPAD_MULTIPLY', 'NUMPAD_SUBTRACT', 'NUMPAD_ADD', 'NUMPAD_DOT', 'NUMPAD_COMMA', 'NUMPAD_ENTER', 'NUMPAD_EQUALS', 'NUMPAD_LEFT_PAREN', 'NUMPAD_RIGHT_PAREN', 'VIRTUAL_MULTITASK', 'SLEEP', 'ZENKAKU_HANKAKU', 'ND', 'RO', 'KATAKANA', 'HIRAGANA', 'HENKAN', 'KATAKANA_HIRAGANA', 'MUHENKAN', 'LINEFEED', 'MACRO', 'NUMPAD_PLUSMINUS', 'SCALE', 'HANGUEL', 'HANJA', 'YEN', 'STOP', 'AGAIN', 'PROPS', 'UNDO', 'COPY', 'OPEN', 'PASTE', 'FIND', 'CUT', 'HELP', 'CALC', 'FILE', 'BOOKMARKS', 'NEXT', 'PLAYPAUSE', 'PREVIOUS', 'STOPCD', 'CONFIG', 'REFRESH', 'EXIT', 'EDIT', 'SCROLLUP', 'SCROLLDOWN', 'NEW', 'REDO', 'CLOSE', 'PLAY', 'BASSBOOST', 'PRINT', 'CHAT', 'FINANCE', 'CANCEL', 'KBDILLUM_TOGGLE', 'KBDILLUM_DOWN', 'KBDILLUM_UP', 'SEND', 'REPLY', 'FORWARDMAIL', 'SAVE', 'DOCUMENTS', 'VIDEO_NEXT', 'VIDEO_PREV', 'BRIGHTNESS_CYCLE', 'BRIGHTNESS_ZERO', 'DISPLAY_OFF', 'BTN_MISC', 'GOTO', 'INFO', 'PROGRAM', 'PVR', 'SUBTITLE', 'FULL_SCREEN', 'KEYBOARD', 'ASPECT_RATIO', 'PC', 'TV', 'TV2', 'VCR', 'VCR2', 'SAT', 'CD', 'TAPE', 'TUNER', 'PLAYER', 'DVD', 'AUDIO', 'VIDEO', 'MEMO', 'CALENDAR', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'CHANNELUP', 'CHANNELDOWN', 'LAST', 'RESTART', 'SLOW', 'SHUFFLE', 'VIDEOPHONE', 'GAMES', 'ZOOMIN', 'ZOOMOUT', 'ZOOMRESET', 'WORDPROCESSOR', 'EDITOR', 'SPREADSHEET', 'GRAPHICSEDITOR', 'PRESENTATION', 'DATABASE', 'NEWS', 'VOICEMAIL', 'ADDRESSBOOK', 'MESSENGER', 'BRIGHTNESS_TOGGLE', 'SPELLCHECK', 'COFFEE', 'MEDIA_REPEAT', 'IMAGES', 'BUTTONCONFIG', 'TASKMANAGER', 'JOURNAL', 'CONTROLPANEL', 'APPSELECT', 'SCREENSAVER', 'ASSISTANT', 'KBD_LAYOUT_NEXT', 'BRIGHTNESS_MIN', 'BRIGHTNESS_MAX', 'KBDINPUTASSIST_PREV', 'KBDINPUTASSIST_NEXT', 'KBDINPUTASSIST_PREVGROUP', 'KBDINPUTASSIST_NEXTGROUP', 'KBDINPUTASSIST_ACCEPT', 'KBDINPUTASSIST_CANCEL', 'FRONT', 'SETUP', 'WAKE_UP', 'SENDFILE', 'DELETEFILE', 'XFER', 'PROG1', 'PROG2', 'MSDOS', 'SCREENLOCK', 'DIRECTION_ROTATE_DISPLAY', 'CYCLEWINDOWS', 'COMPUTER', 'EJECTCLOSECD', 'ISO', 'MOVE', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24', 'PROG3', 'PROG4', 'DASHBOARD', 'SUSPEND', 'HP', 'SOUND', 'QUESTION', 'CONNECT', 'SPORT', 'SHOP', 'ALTERASE', 'SWITCHVIDEOMODE', 'BATTERY', 'BLUETOOTH', 'WLAN', 'UWB', 'WWAN_WIMAX', 'RFKILL', 'CHANNEL', 'BTN_0', 'BTN_1', 'BTN_2', 'BTN_3', 'BTN_4', 'BTN_5', 'BTN_6', 'BTN_7', 'BTN_8', 'BTN_9'))


def _require(ok: bool, message: str) -> None:
    if not ok:
        raise PlannedStepContractError(message)


def positive(value: Any, name: str, *, integer: bool = False, maximum: float | None = None) -> None:
    _require(not isinstance(value, bool) and isinstance(value, int if integer else (int, float))
             and (isinstance(value, int) or math.isfinite(value)) and value > 0 and (maximum is None or value <= maximum),
             f"{name} must be a positive {'integer' if integer else 'finite number'}"
             + (f" <= {maximum}" if maximum is not None else ""))


def validate_boolean_filters(node: Any) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key in BOOLEAN_PROPERTIES or key == "visible":
                _require(isinstance(value, bool), f"{key} must be a JSON boolean")
            validate_boolean_filters(value)
    elif isinstance(node, list):
        for value in node:
            validate_boolean_filters(value)


def target(value: Any, name: str, *, component: bool = False) -> None:
    _require(isinstance(value, dict) and bool(value), f"{name} must be a target object")
    if "x" in value or "y" in value:
        _require(not component and set(value) == {"x", "y"}, f"{name} requires a component selector" if component else f"{name} requires only x and y")
        for axis in ("x", "y"):
            coordinate = value.get(axis)
            _require(isinstance(coordinate, int) and not isinstance(coordinate, bool) and coordinate >= 0,
                     f"{name}.{axis} must be a non-negative integer screen pixel")
    else:
        from hylyre.api.selector_resolve import _validate_selector_predicate
        _require(any(k in value for k in ("by_id", "by_text", "by_key", "by_type", "all")), f"{name} requires a selector")
        _require("scroll_into_view" not in value, f"{name}: use an explicit scroll_to before the gesture")
        try:
            _validate_selector_predicate(value)
        except SelectorContractError as exc:
            raise PlannedStepContractError(str(exc)) from exc
        validate_boolean_filters(value)


def validate_touch_mode(block: dict[str, Any]) -> None:
    mode = block.get("mode", "normal")
    _require(mode in ("normal", "long", "double"), "touch.mode must be normal, long or double")
    if "press_time" in block:
        _require(mode == "long", "touch.press_time requires mode=long")
        positive(block["press_time"], "touch.press_time")


def key_code(value: Any) -> None:
    _require((isinstance(value, int) and not isinstance(value, bool) and value >= 0)
             or (isinstance(value, str) and value in KEY_NAMES), "key must be a known Hypium KeyCode name or non-negative integer")


def validate_common_operation(root: str, block: Any) -> None:
    _require(isinstance(block, dict), f"{root} must be an object")
    validate_boolean_filters(block)
    fields = {
        "drag": {"start", "end", "press_time", "drag_time", "speed"},
        "slide": {"start", "end", "duration"},
        "fling": {"direction", "distance", "area", "speed"},
        "pinch_in": {"area", "scale", "direction", "dead_zone_ratio"},
        "pinch_out": {"area", "scale", "direction", "dead_zone_ratio"},
        "two_finger_swipe": {"start1", "end1", "start2", "end2", "duration", "area"},
        "multi_finger_touch": {"points", "duration", "area"},
        "gesture": {"fingers", "speed"}, "press_key": {"key", "mode"},
        "press_combination_key": {"keys"}, "get_component_property": {"target", "property"},
        "shell": {"command", "timeout"}, "clear_text": {"target"},
        "move_cursor": {"direction", "times"}, "set_checked": {"target", "checked", "timeout"},
        "current_app": set(), "has_app": {"bundle"}, "recent_tasks": set(),
    }[root]
    _require(not (set(block) - fields), f"{root}: unsupported fields {sorted(set(block) - fields)}")
    if root in {"drag", "slide"}:
        target(block.get("start"), "start"); target(block.get("end"), "end")
    if root == "drag":
        _require(not ("speed" in block and "drag_time" in block), "drag.speed and drag_time are mutually exclusive")
    for name in ("duration", "press_time", "drag_time", "timeout"):
        if name in block:
            positive(block[name], f"{root}.{name}")
    if "area" in block:
        target(block["area"], "area", component=True)
    if root == "fling":
        _require(isinstance(block.get("direction"), str) and block["direction"].upper() in {"UP", "DOWN", "LEFT", "RIGHT"}, "fling.direction must be UP/DOWN/LEFT/RIGHT (case-insensitive)")
        positive(block.get("distance", 50), "fling.distance", integer=True, maximum=100)
        _require(block.get("speed", "fast") in ("fast", "normal", "slow"), "fling.speed must be fast/normal/slow")
    elif "speed" in block:
        positive(block["speed"], f"{root}.speed", integer=True, maximum=40000)
    if root in {"pinch_in", "pinch_out"}:
        target(block.get("area"), "area", component=True)
        scale = block.get("scale", 0.4 if root == "pinch_in" else 1.6)
        positive(scale, "scale")
        _require((0 < scale < 1) if root == "pinch_in" else (1 < scale < 2), f"invalid {root}.scale")
        _require(block.get("direction", "diagonal") in ("diagonal", "horizontal"), "invalid pinch direction")
        if "dead_zone_ratio" in block:
            positive(block["dead_zone_ratio"], "dead_zone_ratio")
            _require(block["dead_zone_ratio"] < 0.5, "dead_zone_ratio must be < 0.5")
    if root == "two_finger_swipe":
        for name in ("start1", "end1", "start2", "end2"):
            target(block.get(name), name)
    if root == "multi_finger_touch":
        points = block.get("points")
        _require(isinstance(points, list) and 2 <= len(points) <= 4, "points requires 2–4 fingers")
        for point in points:
            target(point, "point")
    if root == "gesture":
        fingers = block.get("fingers")
        _require(isinstance(fingers, list) and len(fingers) >= 1, "gesture requires at least one finger")
        for finger in fingers:
            _require(isinstance(finger, dict) and set(finger) == {"points"}, "finger requires points")
            points = finger["points"]
            _require(isinstance(points, list) and len(points) >= 2, "each finger requires at least two points")
            for point in points:
                target(point, "gesture point")
    if root == "press_key":
        key_code(block.get("key"))
        _require(block.get("mode", "normal") in ("normal", "long", "double"), "invalid press_key.mode")
    if root == "press_combination_key":
        keys = block.get("keys")
        _require(isinstance(keys, list) and 2 <= len(keys) <= 3, "combination requires 2–3 keys")
        for key in keys:
            key_code(key)
        _require(len(set(keys)) == len(keys), "combination keys must be distinct")
    if root in {"get_component_property", "clear_text", "set_checked"}:
        target(block.get("target"), "target", component=True)
    if root == "get_component_property":
        _require(isinstance(block.get("property"), str) and block["property"] in COMPONENT_PROPERTIES, "unknown component property")
    if root == "set_checked":
        _require(isinstance(block.get("checked"), bool), "checked must be a JSON boolean")
    if root == "move_cursor":
        _require(block.get("direction") in ("left", "right", "up", "down", "begin", "end"), "invalid cursor direction")
        positive(block.get("times", 1), "times", integer=True)
    if root in {"has_app", "shell"}:
        name = "bundle" if root == "has_app" else "command"
        _require(isinstance(block.get(name), str) and bool(block[name].strip()) and "\x00" not in block[name], f"{name} must be a non-empty string without NUL")

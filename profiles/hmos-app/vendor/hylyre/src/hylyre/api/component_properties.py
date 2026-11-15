"""The shared observable component-property contract (missing is not false)."""

from __future__ import annotations

from typing import Any

from hylyre.api.exceptions import CapabilityUnsupported

BOOLEAN_PROPERTIES = frozenset({"enabled", "focused", "clickable", "scrollable", "checked", "checkable"})
COMPONENT_PROPERTIES = frozenset({"id", "text", "key", "type", *BOOLEAN_PROPERTIES})


def has_boolean_filters(value: Any, *, properties: frozenset[str] = BOOLEAN_PROPERTIES) -> bool:
    if isinstance(value, dict):
        return any(k in properties or has_boolean_filters(v, properties=properties) for k, v in value.items())
    if isinstance(value, list):
        return any(has_boolean_filters(v, properties=properties) for v in value)
    return False


def observable_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    return None


def property_value(attrs: dict[str, Any], name: str) -> Any:
    if name not in attrs:
        raise CapabilityUnsupported(f"component property {name!r} is not observable")
    value = attrs[name]
    if name in BOOLEAN_PROPERTIES:
        value = observable_bool(value)
        if value is None:
            raise CapabilityUnsupported(f"component property {name!r} is not observable")
    return value

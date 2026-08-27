"""Planned JSON step root keys (Tier A Hypium capabilities)."""

from __future__ import annotations

# Root keys accepted by step_dispatch (excluding legacy "action" envelope).
PLANNED_STEP_ROOT_KEYS: tuple[str, ...] = (
    "action",
    "touch",
    "input",
    "swipe",
    "scroll",
    "scroll_to",
    "back",
    "home",
    "stop_app",
    "clear_app",
    "wait",
    "wait_for",
    "wait_gone",
    "wait_idle",
    "assert_toast",
    "start_app",
)

TIER_A_ATOMIC_CLI_COMMANDS: tuple[str, ...] = (
    "back",
    "home",
    "stop-app",
    "clear-app",
    "wait",
    "wait-for",
    "wait-gone",
    "wait-idle",
    "assert-toast",
    "scroll-to",
)

TIER_A_MCP_TOOL_SUFFIXES: tuple[str, ...] = (
    "back",
    "home",
    "stop_app",
    "clear_app",
    "wait",
    "wait_for",
    "wait_gone",
    "wait_idle",
    "assert_toast",
    "scroll_to",
)

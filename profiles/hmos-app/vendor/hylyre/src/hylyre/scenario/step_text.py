"""Normalize test-plan step cell text before JSON detection."""

from __future__ import annotations

import re


def normalize_planned_step_text(raw: str) -> str:
    """Strip markdown wrappers so ``json.loads`` can see planned JSON."""
    s = raw.strip()
    if not s:
        return s
    # Markdown code fence first (before peeling `` ` `` from ```).
    fence = re.search(r"^```(?:json)?\s*([\s\S]*?)```\s*$", s, re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    # Single or double backtick wrappers (common in Agent-generated tables).
    while len(s) >= 2 and s[0] == "`" and s[-1] == "`":
        s = s[1:-1].strip()
    return s


def looks_like_planned_json(text: str) -> bool:
    """True when normalized text appears to be a JSON object (planned step)."""
    s = normalize_planned_step_text(text)
    return bool(s) and s.lstrip().startswith("{")


def non_json_step_error(case_id: str) -> str:
    """Error when a step is natural language but no VLM is configured."""
    return (
        f"{case_id}: 非 JSON 的测试步骤需要配置 VLM（HYLYRE_VLM_ENDPOINT 等），"
        "或在计划中使用单行 JSON。"
        "若步骤本是 JSON，请去掉 markdown 反引号或 ``` 围栏。"
        '合法示例: {"touch":{"by_text":"…"}} 或 '
        '{"action":{"type":"touch","by_text":"…"}}'
    )


def json_step_syntax_error(case_id: str, exc: Exception, raw: str) -> str:
    """Error when step looks like JSON but fails to parse."""
    snippet = normalize_planned_step_text(raw)[:200]
    return (
        f"{case_id}: 测试步骤 JSON 语法错误: {exc}"
        f"（原文片段: {snippet!r}）"
    )

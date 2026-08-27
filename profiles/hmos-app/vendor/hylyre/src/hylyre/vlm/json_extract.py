"""Extract a JSON object from model text (handles occasional markdown fences)."""

from __future__ import annotations

import json
import re
from typing import Any


def extract_json_object(text: str) -> dict[str, Any]:
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", s, re.IGNORECASE)
    if fence:
        s = fence.group(1).strip()
    try:
        out = json.loads(s)
    except json.JSONDecodeError:
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            out = json.loads(s[start : end + 1])
        else:
            raise
    if not isinstance(out, dict):
        raise ValueError("VLM JSON must be an object at top level")
    return out

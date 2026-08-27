"""Abstract VLM / vision client for natural-language UI steps (P3)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class VlmClientBase(ABC):
    """Interpret screenshots + instructions; return structured JSON-like dicts."""

    @abstractmethod
    async def vision_json(
        self,
        *,
        instruction: str,
        screenshot_png: bytes,
        response_schema: str,
    ) -> dict[str, Any]:
        """Return a dict for the requested logical schema.

        ``response_schema`` is one of: ``tap``, ``input``, ``action``, ``query``,
        ``assert``, ``locate`` — implementations may embed this in the model prompt.
        """

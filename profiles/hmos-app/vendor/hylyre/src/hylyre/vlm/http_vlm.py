"""OpenAI-compatible chat completions with vision (env-configured)."""

from __future__ import annotations

import base64
import os
from typing import Any

import httpx

from hylyre.drivers.base import VlmClientBase
from hylyre.vlm.json_extract import extract_json_object


def _schema_instruction(response_schema: str) -> str:
    return {
        "tap": (
            'Reply with JSON only: {"touch": {"x": <int>, "y": <int>}} '
            'OR {"touch": {"by_text": "<str>"}} OR {"touch": {"by_id": "<str>"}}.'
        ),
        "input": (
            'Reply with JSON only: {"input": {"text": "<str>", "by_text": null, "by_id": null}} '
            "(by_text/by_id optional selectors)."
        ),
        "action": (
            "Reply with JSON only describing ONE UI step: "
            '{"action": {"type": "touch", "x": <int>, "y": <int>}} OR '
            '{"action": {"type": "touch", "by_text": "<str>"}} OR '
            '{"action": {"type": "touch", "by_id": "<str>"}} OR '
            '{"action": {"type": "input", "text": "<str>", "by_text": null, "by_id": null}}.'
        ),
        "query": (
            'Reply with JSON only: {"answer": <string|number|boolean>, '
            '"dtype": "string"|"number"|"boolean"}.'
        ),
        "assert": 'Reply with JSON only: {"ok": <true|false>, "reason": "<short string>"}.',
        "locate": (
            'Reply with JSON only: '
            '{"region": {"x": <int>, "y": <int>, "width": <int>, "height": <int>}, '
            '"center": {"x": <int>, "y": <int>}}.'
        ),
    }.get(
        response_schema,
        '{"result": ...} JSON object only.',
    )


def image_data_url(image_bytes: bytes) -> str:
    """Build a data URL with a MIME type matching Hypium (often JPEG) or PNG fakes."""
    if image_bytes.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    else:
        mime = "image/png"
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


class HttpVlmClient(VlmClientBase):
    """POST to ``HYLYRE_VLM_ENDPOINT`` (e.g. https://api.openai.com/v1/chat/completions)."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str | None = None,
        model: str = "gpt-4o-mini",
        timeout: float = 120.0,
    ) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    @classmethod
    def from_env(cls) -> HttpVlmClient | None:
        endpoint = os.environ.get("HYLYRE_VLM_ENDPOINT", "").strip()
        if not endpoint:
            return None
        return cls(
            endpoint=endpoint,
            api_key=os.environ.get("HYLYRE_VLM_API_KEY"),
            model=os.environ.get("HYLYRE_VLM_MODEL", "gpt-4o-mini"),
        )

    async def vision_json(
        self,
        *,
        instruction: str,
        screenshot_png: bytes,
        response_schema: str,
    ) -> dict[str, Any]:
        data_url = image_data_url(screenshot_png)
        sys_msg = (
            "You are a HarmonyOS UI automation planner. "
            + _schema_instruction(response_schema)
            + " No markdown, no prose outside JSON."
        )
        user_parts: list[dict[str, Any]] = [
            {"type": "text", "text": instruction},
            {
                "type": "image_url",
                "image_url": {"url": data_url},
            },
        ]
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        body = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": user_parts},
            ],
            "temperature": 0.1,
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(self._endpoint, json=body, headers=headers)
            r.raise_for_status()
            data = r.json()
        text = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not isinstance(text, str):
            raise ValueError("Unexpected VLM response shape (no string content)")
        return extract_json_object(text)

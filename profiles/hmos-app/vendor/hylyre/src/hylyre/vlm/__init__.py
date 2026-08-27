"""Concrete VLM clients (HTTP, env-based). Outer `api/` depends only on ``VlmClientBase`` ABC."""

from hylyre.vlm.http_vlm import HttpVlmClient

__all__ = ["HttpVlmClient"]

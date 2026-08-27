"""Heuristic budgets for MCP tool descriptions (approx. GPT-style tokens)."""

from __future__ import annotations


def approximate_token_count(text: str) -> int:
    """Rough lower-bound proxy: whitespace-delimited word count ≳ subword token count."""
    return len((text or "").split())


def description_within_budget(description: str, *, max_tokens: int = 500) -> bool:
    return approximate_token_count(description or "") <= max_tokens

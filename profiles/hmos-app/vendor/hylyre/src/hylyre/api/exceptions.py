"""Planned-step execution signals (skip / selector resolution)."""

from __future__ import annotations


class StepSkipped(Exception):
    """Step intentionally skipped (e.g. unsupported environment capability)."""


class SelectorResolutionError(Exception):
    """No matching UI target for a rich selector predicate."""

    def __init__(
        self,
        message: str,
        *,
        candidates_summary: list[dict] | None = None,
    ) -> None:
        super().__init__(message)
        self.candidates_summary = candidates_summary or []

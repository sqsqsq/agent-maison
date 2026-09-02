"""Typed planned-step execution signals and stable failure classification."""

from __future__ import annotations


class StepSkipped(Exception):
    """Step intentionally skipped (e.g. unsupported environment capability)."""

    def __init__(
        self,
        message: str,
        *,
        failure_kind: str = "capability",
        failure_code: str = "capability_unsupported",
        evidence: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.failure_kind = failure_kind
        self.failure_code = failure_code
        self.evidence = evidence


class PlannedStepContractError(ValueError):
    """A planned step's own shape is invalid (decision row D-18).

    Only this type maps to ``contract.*``. A bare ``ValueError`` from inside a
    driver is a driver bug, and blaming the test plan for it is exactly the
    mis-attribution 0.3-p0 made in the other direction.
    """


class SelectorResolutionError(Exception):
    """No matching UI target for a rich selector predicate."""

    def __init__(
        self,
        message: str,
        *,
        candidates_summary: list[dict] | None = None,
        failure_code: str = "selector_not_found",
        selector: dict | None = None,
        evidence: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.candidates_summary = candidates_summary or []
        self.failure_kind = "selector"
        self.failure_code = failure_code
        self.selector = selector
        self.evidence = evidence or {
            "candidate_count": len(self.candidates_summary),
            "candidates": list(self.candidates_summary),
        }


class SelectorContractError(SelectorResolutionError):
    """Invalid selector syntax/match mode; never silently widened."""

    def __init__(self, message: str, *, selector: dict | None = None) -> None:
        raw_selector = dict(selector or {})
        super().__init__(
            message,
            # Keep the frozen Maison failure-code enum.  The human message
            # still explains that the match value is invalid, while selector
            # consumers receive the existing not-found classification.
            failure_code="selector_not_found",
            selector={
                "engine": "resolver",
                "requested_match": raw_selector.get("match"),
                "effective_match": None,
                "candidate_count": 0,
                "selected_id": None,
                "bounds": None,
                "predicate": raw_selector,
            },
        )


class AssertionMismatch(AssertionError):
    """A supported assertion ran and returned a negative result."""

    def __init__(
        self,
        message: str,
        *,
        evidence: dict | None = None,
        selector: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.failure_kind = "assertion"
        self.failure_code = "assertion_mismatch"
        self.evidence = evidence
        self.selector = selector


class CapabilityUnsupported(RuntimeError):
    """A framework/device capability is unavailable, not an assertion mismatch."""

    def __init__(self, message: str, *, evidence: dict | None = None) -> None:
        super().__init__(message)
        self.failure_kind = "capability"
        self.failure_code = "capability_unsupported"
        self.evidence = evidence


# ``classify_exception`` is deliberately gone. It classified by searching the
# exception's class name and message for tokens like "device not found", which
# is how a plain ValueError became ``infrastructure/driver_failure``. Mapping is
# now by exception *type* only, in
# :mod:`hylyre.api.outcome_from_error`, and the ``failure_kind``/``failure_code``
# attributes above are internal control-flow signals: they identify which typed
# outcome to build and never reach a trace.

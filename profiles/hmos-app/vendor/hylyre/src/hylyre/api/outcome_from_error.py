"""Map Hylyre's typed control-flow exceptions to protocol outcomes.

The resolver signals expected negative results (zero candidates, ambiguity, an
unresolvable inline target) by raising typed exceptions deep inside a long call
chain. This module converts them **once**, at the single dispatch boundary, so
that nothing leaving an operation is ever an exception carrying a negative
result — which is what P0-6 requires of the operation surface.

The mapping is driven purely by exception *type* and by structured attributes
the exception already carries. It never inspects a message: matching on error
text is how 0.3-p0 turned plan errors into ``driver_failure``.
"""

from __future__ import annotations

from typing import Any

from hylyre.api.exceptions import (
    AssertionMismatch,
    CapabilityUnsupported,
    SelectorContractError,
    SelectorResolutionError,
    StepSkipped,
)
from hylyre.api.outcome import (
    Failure,
    OperationFailed,
    OperationOutcome,
    OperationSkipped,
    Reason,
    SelectorEvidence,
    SelectorRequest,
    SelectorResolution,
)

__all__ = ["typed_exception_outcome"]

#: Legacy resolver failure codes -> v1 (domain, code).
_SELECTOR_CODES: dict[str, tuple[str, str]] = {
    "selector_not_found": ("selector", "selector.not_found"),
    "selector_ambiguous": ("selector", "selector.ambiguous"),
    "inline_target_unresolvable": ("selector", "selector.inline_unresolvable"),
}


def _request_from_legacy(
    selector: Any, planned_block: dict[str, Any] | None = None
) -> SelectorRequest:
    """Prefer the plan's own predicate; the request records intent, not findings."""

    from hylyre.api.selector_contract import selector_request

    if isinstance(selector, dict):
        predicate = selector.get("predicate")
        if isinstance(predicate, dict):
            return selector_request(predicate)
    if isinstance(planned_block, dict):
        return selector_request(planned_block)
    if isinstance(selector, dict):
        return SelectorRequest("composite", None, selector.get("requested_match"), {})
    return SelectorRequest("composite", None, None, {})


def _candidates(exc: SelectorResolutionError) -> list[dict[str, Any]]:
    rows = getattr(exc, "candidates_summary", None) or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "id": row.get("id") or None,
                "type": row.get("type") or None,
                "bounds": row.get("bounds") or None,
            }
        )
    return out


def _selector_outcome(
    exc: SelectorResolutionError, planned_block: dict[str, Any] | None = None
) -> OperationFailed:
    code = str(getattr(exc, "failure_code", "") or "selector_not_found")
    if code not in _SELECTOR_CODES:
        # Folding an unknown resolver code into `not_found` would report "the
        # target does not exist" for something nobody actually classified.
        raise NotImplementedError(
            f"resolver produced an unmapped failure_code {code!r}; register it "
            "in _SELECTOR_CODES together with its v1 code"
        )
    domain, v1_code = _SELECTOR_CODES[code]
    request = _request_from_legacy(getattr(exc, "selector", None), planned_block)
    candidates = _candidates(exc)

    if v1_code == "selector.ambiguous" and len(candidates) >= 2:
        resolution = SelectorResolution.ambiguous(candidates)
    elif v1_code == "selector.inline_unresolvable":
        resolution = SelectorResolution.unresolvable(
            "selector.inline_fragment_unresolvable",
            dump_status="available",
            request_complete=True,
            resolver_entered=True,
            candidate_countable=False,
            fragment_anchor=None,
            fragment_bounds=None,
        )
    else:
        resolution = SelectorResolution.not_found()

    return OperationFailed(
        failure=Failure(domain, v1_code, {"resolver_code": code}),
        selector=SelectorEvidence(request, resolution),
        diagnostic=str(exc)[:4000],
    )


def typed_exception_outcome(
    exc: BaseException, planned_block: dict[str, Any] | None = None
) -> OperationOutcome | None:
    """Return the outcome for a typed control-flow exception, else ``None``.

    ``None`` means "not an expected negative result" — the caller then treats
    it as a genuinely unexpected exception.
    """

    if isinstance(exc, SelectorContractError):
        # An invalid match/selector is a contract violation, not a missing
        # target. 0.3-p0 flattened it to selector_not_found to keep a frozen
        # enum intact, which told consumers the UI was wrong when the plan was.
        return OperationFailed(
            failure=Failure(
                "contract",
                "contract.invalid_selector",
                {"detected_in": "resolver"},
            ),
            selector=SelectorEvidence(
                _request_from_legacy(getattr(exc, "selector", None), planned_block),
                SelectorResolution.not_attempted(),
            ),
            diagnostic=str(exc)[:4000],
        )
    if isinstance(exc, SelectorResolutionError):
        return _selector_outcome(exc, planned_block)
    if isinstance(exc, AssertionMismatch):
        evidence = getattr(exc, "evidence", None) or {}
        from hylyre.api.outcome import AssertionObservation

        observation = AssertionObservation(
            "custom",
            False,
            {k: v for k, v in evidence.items() if k != "result"},
        )
        return OperationFailed(
            failure=Failure("assertion", "assertion.mismatch"),
            observation=observation,
            diagnostic=str(exc)[:4000],
        )
    if isinstance(exc, StepSkipped):
        return OperationSkipped(
            reason=Reason(
                "policy",
                "optional_check.on_unsupported_skip",
                {
                    "probe_status": "unsupported",
                    "probe_source": "driver.step_skipped",
                },
            ),
            diagnostic=str(exc)[:4000],
        )
    if isinstance(exc, CapabilityUnsupported):
        # Raised from inside a dispatched operation: attempted, then found
        # unsupported. A pre-dispatch probe would have produced a blocked
        # cause instead.
        return OperationFailed(
            failure=Failure(
                "capability",
                "capability.unsupported",
                {"dispatched": True},
            ),
            diagnostic=str(exc)[:4000],
        )
    return None

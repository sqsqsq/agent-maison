"""Transient ``OperationOutcome`` tagged union (Step Outcome Protocol v1, P0-6).

Every driver/agent operation returns one of :class:`OperationPassed`,
:class:`OperationFailed`, :class:`OperationBlocked` or :class:`OperationSkipped`.
The union is isomorphic to ``StepResult.outcome`` but carries no plan identity
(``index``/``kind``/``role``), no timing and no session facts — the single
builder in :mod:`hylyre.scenario.step_builder` adds those.

This is an in-memory interface only: it is never persisted, never becomes a
second source of truth, and never reaches a trace except through the builder.

Expected negative results are *values*, not exceptions: zero/multiple selector
candidates, ``matched=false`` assertions, capability gaps, infrastructure
unavailability and policy skips all come back as an outcome. Python exceptions
are reserved for genuinely unexpected failures (driver crash, unexpected I/O,
internal bugs) and are normalized by the builder into
``failed + internal.unexpected_exception``.

See ``hylyre/contracts/step-outcome-v1.md`` sections 2, 5, 6 and 7.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence

__all__ = [
    "ActionObservation",
    "ArtifactRef",
    "AssertionObservation",
    "CapabilityCause",
    "Failure",
    "InfrastructureCause",
    "Observation",
    "OperationBlocked",
    "OperationFailed",
    "OperationOutcome",
    "OperationPassed",
    "OperationSkipped",
    "PriorStepCause",
    "Reason",
    "SelectorEvidence",
    "SelectorRequest",
    "SelectorResolution",
    "absence_observed",
    "artifact_from_file",
    "expected_checked",
    "presence_observed",
    "toast_observed",
]

FailureDomain = Literal[
    "contract", "selector", "assertion", "capability", "infrastructure", "internal"
]
AssertionType = Literal["presence", "absence", "toast", "expected", "custom"]
ResolutionState = Literal[
    "not_attempted", "not_found", "unique", "ambiguous", "unresolvable"
]


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return value


# --------------------------------------------------------------- observation
@dataclass(frozen=True)
class ActionObservation:
    """What an operation actually did. ``performed`` is about effect, not attempt."""

    operation: str
    performed: bool = True
    facts: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "action",
            "operation": self.operation,
            "performed": bool(self.performed),
            "facts": _plain(self.facts),
        }


@dataclass(frozen=True)
class AssertionObservation:
    """What an assertion actually observed. Present only when it really ran."""

    assertion_type: AssertionType
    matched: bool
    facts: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "assertion",
            "assertion_type": self.assertion_type,
            "matched": bool(self.matched),
            "facts": _plain(self.facts),
        }


Observation = ActionObservation | AssertionObservation


def presence_observed(observed: bool, **facts: Any) -> AssertionObservation:
    return AssertionObservation(
        "presence",
        bool(observed),
        {"expected_present": True, "observed_present": bool(observed), **facts},
    )


def absence_observed(observed: bool, **facts: Any) -> AssertionObservation:
    return AssertionObservation(
        "absence",
        not observed,
        {"expected_present": False, "observed_present": bool(observed), **facts},
    )


def toast_observed(
    observed: bool, *, trigger_window_covered: bool, channel: str = "driver", **facts: Any
) -> AssertionObservation:
    return AssertionObservation(
        "toast",
        bool(observed),
        {
            "channel": channel,
            "observed": bool(observed),
            "trigger_window_covered": bool(trigger_window_covered),
            **facts,
        },
    )


def expected_checked(matched: bool, *, channel: str = "vlm", **facts: Any) -> AssertionObservation:
    return AssertionObservation(
        "expected",
        bool(matched),
        {
            "channel": channel,
            "instruction_checked": True,
            "matched": bool(matched),
            **facts,
        },
    )


# ------------------------------------------------------------------ failure
@dataclass(frozen=True)
class Failure:
    """A failure this step actually experienced; the only routable root event."""

    domain: FailureDomain
    code: str
    facts: Mapping[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"domain": self.domain, "code": self.code}
        if self.facts:
            out["facts"] = _plain(self.facts)
        return out


# -------------------------------------------------------------------- cause
@dataclass(frozen=True)
class PriorStepCause:
    """This step was not attempted because an earlier root outcome stopped the case."""

    step_index: int

    def to_dict(self) -> dict[str, Any]:
        return {"type": "prior_step", "step_index": int(self.step_index)}


@dataclass(frozen=True)
class CapabilityCause:
    """A pre-dispatch probe proved a required capability unavailable."""

    code: str
    capability_id: str
    probe_status: str
    probe_source: str
    provider_id: str | None = None
    facts: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": "capability",
            "code": self.code,
            "capability_id": self.capability_id,
            "facts": {
                **_plain(self.facts),
                "probe_status": self.probe_status,
                "probe_source": self.probe_source,
            },
        }
        if self.provider_id:
            out["provider_id"] = self.provider_id
        return out


@dataclass(frozen=True)
class InfrastructureCause:
    """A pre-dispatch probe proved the infrastructure unavailable."""

    code: str
    probe_status: str
    probe_source: str
    resource_kind: str | None = None
    facts: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        facts: dict[str, Any] = {
            **_plain(self.facts),
            "probe_status": self.probe_status,
            "probe_source": self.probe_source,
        }
        if self.resource_kind:
            facts["resource_kind"] = self.resource_kind
        return {"type": "infrastructure", "code": self.code, "facts": facts}


Cause = PriorStepCause | CapabilityCause | InfrastructureCause


# ------------------------------------------------------------------- reason
@dataclass(frozen=True)
class Reason:
    """An explicit policy or not-applicable decision not to execute."""

    type: Literal["policy", "not_applicable"]
    code: str
    facts: Mapping[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type, "code": self.code}
        if self.facts:
            out["facts"] = _plain(self.facts)
        return out


# ----------------------------------------------------------------- selector
@dataclass(frozen=True)
class SelectorRequest:
    """What the plan asked for. Never backfilled from what was found."""

    kind: Literal["by_id", "by_text", "by_key", "by_type", "coordinates", "composite"]
    value: str | None = None
    match: str | None = None
    constraints: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "value": self.value,
            "match": self.match,
            "constraints": _plain(self.constraints),
        }


@dataclass(frozen=True)
class SelectorResolution:
    """What the executor actually found. Never the plan's intent."""

    state: ResolutionState
    candidate_count: int | None = None
    selected: Mapping[str, Any] | None = None
    candidates: Sequence[Mapping[str, Any]] = ()
    reason_code: str | None = None
    facts: Mapping[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "state": self.state,
            "candidate_count": self.candidate_count,
            "selected": _plain(self.selected) if self.selected else None,
            "candidates": [_plain(c) for c in self.candidates],
        }
        if self.state == "unresolvable":
            out["reason_code"] = self.reason_code
            out["facts"] = _plain(self.facts or {})
        return out

    @staticmethod
    def not_attempted() -> "SelectorResolution":
        return SelectorResolution("not_attempted", None, None, ())

    @staticmethod
    def not_found() -> "SelectorResolution":
        return SelectorResolution("not_found", 0, None, ())

    @staticmethod
    def unique(target_id: str, bounds: str | None = None) -> "SelectorResolution":
        selected = {"id": target_id, "bounds": bounds}
        return SelectorResolution("unique", 1, selected, (dict(selected),))

    @staticmethod
    def ambiguous(candidates: Sequence[Mapping[str, Any]]) -> "SelectorResolution":
        items = [dict(c) for c in candidates]
        return SelectorResolution("ambiguous", len(items), None, items)

    @staticmethod
    def unresolvable(
        reason_code: str,
        *,
        dump_status: str,
        request_complete: bool,
        resolver_entered: bool,
        candidate_countable: bool,
        candidate_count: int | None = None,
        candidates: Sequence[Mapping[str, Any]] = (),
        **facts: Any,
    ) -> "SelectorResolution":
        return SelectorResolution(
            "unresolvable",
            candidate_count if candidate_countable else None,
            None,
            [dict(c) for c in candidates],
            reason_code,
            {
                "dump_status": dump_status,
                "request_complete": bool(request_complete),
                "resolver_entered": bool(resolver_entered),
                "candidate_countable": bool(candidate_countable),
                **facts,
            },
        )


@dataclass(frozen=True)
class SelectorEvidence:
    request: SelectorRequest
    resolution: SelectorResolution

    def to_dict(self) -> dict[str, Any]:
        return {
            "request": self.request.to_dict(),
            "resolution": self.resolution.to_dict(),
        }


@dataclass(frozen=True)
class ArtifactRef:
    kind: Literal["screenshot", "ui_dump", "visible_elements", "log"]
    path: str
    sha256: str
    bytes_len: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "kind": self.kind,
            "path": self.path.replace("\\", "/"),
            "sha256": self.sha256,
        }
        if self.bytes_len is not None:
            out["bytes"] = int(self.bytes_len)
        return out


# ------------------------------------------------------- the outcome union
@dataclass(frozen=True)
class _OperationBase:
    selector: SelectorEvidence | None = None
    artifacts: Sequence[ArtifactRef] = ()
    diagnostic: str | None = None
    extensions: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OperationPassed(_OperationBase):
    observation: Observation | None = None

    def outcome_dict(self) -> dict[str, Any]:
        if self.observation is None:  # pragma: no cover - guarded by the builder
            raise ValueError("OperationPassed requires an observation")
        return {"status": "passed", "observation": self.observation.to_dict()}


@dataclass(frozen=True)
class OperationFailed(_OperationBase):
    failure: Failure | None = None
    observation: Observation | None = None

    def outcome_dict(self) -> dict[str, Any]:
        if self.failure is None:  # pragma: no cover - guarded by the builder
            raise ValueError("OperationFailed requires a failure")
        out: dict[str, Any] = {"status": "failed", "failure": self.failure.to_dict()}
        if self.observation is not None:
            out["observation"] = self.observation.to_dict()
        return out


@dataclass(frozen=True)
class OperationBlocked(_OperationBase):
    cause: Cause | None = None

    def outcome_dict(self) -> dict[str, Any]:
        if self.cause is None:  # pragma: no cover - guarded by the builder
            raise ValueError("OperationBlocked requires a cause")
        return {"status": "blocked", "cause": self.cause.to_dict()}


@dataclass(frozen=True)
class OperationSkipped(_OperationBase):
    reason: Reason | None = None

    def outcome_dict(self) -> dict[str, Any]:
        if self.reason is None:  # pragma: no cover - guarded by the builder
            raise ValueError("OperationSkipped requires a reason")
        return {"status": "skipped", "reason": self.reason.to_dict()}


OperationOutcome = (
    OperationPassed | OperationFailed | OperationBlocked | OperationSkipped
)


def artifact_from_file(
    kind: str, path: Path | str, *, base: Path | str | None = None
) -> ArtifactRef:
    """Hash a captured artifact and reference it relatively.

    The protocol requires a relative path and a real sha256, so a reference is
    only ever produced from a file that actually exists — an artifact is never
    asserted into being.
    """

    p = Path(path)
    data = p.read_bytes()
    rel = p
    if base is not None:
        try:
            rel = p.resolve().relative_to(Path(base).resolve())
        except ValueError:
            rel = Path(p.name)
    elif p.is_absolute():
        rel = Path(p.name)
    return ArtifactRef(
        kind=kind,  # type: ignore[arg-type]
        path=rel.as_posix(),
        sha256=hashlib.sha256(data).hexdigest(),
        bytes_len=len(data),
    )

"""Serializable scenario result contract (Step Outcome Protocol v1).

``StepResult`` is the single authoritative per-step ledger row. It is produced
only by :mod:`hylyre.scenario.step_builder` and reduced only by
:mod:`hylyre.scenario.reducer`; nothing else may construct or interpret it.

See ``hylyre/contracts/step-outcome-v1.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, Literal

from hylyre.scenario.plan_parse import TestCase

Execution = Literal["completed", "aborted", "infrastructure_failed"]
Verification = Literal["passed", "failed", "inconclusive"]
EvidenceStatus = Literal["complete", "incomplete"]
ExpectedCheckMode = Literal[
    "checked_vlm", "disabled_by_flag", "unavailable_no_vlm", "empty"
]
StepRole = Literal["action", "assertion"]
StepStatus = Literal["passed", "failed", "blocked", "skipped"]

_SENSITIVE_KEY_PARTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "account",
    "amount",
    "phone",
    "card",
    "id_number",
    "expected_text",
    "actual_text",
    "event_text",
    "input_value",
    "by_text",
    "by_value",
    "error",
    "notes",
)

_SENSITIVE_TEXT_PATTERNS = (
    re.compile(
        r"(?i)(?:account|账号|amount|金额|余额|phone|手机号|card|卡号|token|secret|password)"
        r"\s*[:=：]\s*[^,;，；\s)]+"
    ),
    re.compile(r"(?i)(?:by_text|text|value|instruction|expected|actual)\s*[:=：]\s*(['\"])(.*?)\1"),
    re.compile(
        r"(?i)(['\"])(?:by_text|text|value|instruction|expected|actual)\1"
        r"\s*:\s*(['\"])(.*?)\2"
    ),
    re.compile(r"(?<![\w])(?:¥|￥|\$)\s*[0-9][0-9,]*(?:\.[0-9]+)?"),
    re.compile(r"(?<![\w])[0-9][0-9,]{5,}(?![\w])"),
)

# These are structured selector association keys.  Their values identify a
# canonical UI target and must remain comparable in serialized evidence.
_SELECTOR_VALUE_KEYS = frozenset({"by_id", "by_key", "id", "key", "selected_id"})
# Bounds are machine evidence too, not user-facing text.
_STRUCTURED_SCALAR_KEYS = frozenset({"bounds", "fragment_bounds"})
_STRUCTURED_VALUE_KEYS = _SELECTOR_VALUE_KEYS | _STRUCTURED_SCALAR_KEYS
_SENSITIVE_VALUE_KEYS = frozenset(
    {
        "text",
        "value",
        "instruction",
        "answer",
        "expected",
        "actual",
        "by_text",
        "by_value",
    }
)

#: Selector request kinds whose ``value`` is a structured identity, not user text.
_STRUCTURED_REQUEST_KINDS = frozenset({"by_id", "by_key", "by_type"})


def redact_text(value: str | None) -> str | None:
    """Mask sensitive human-facing text while retaining structured evidence."""

    if value is None:
        return None
    text = str(value)
    for pattern in _SENSITIVE_TEXT_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def redact_evidence(value: Any, *, key: str = "") -> Any:
    """Redact likely sensitive evidence before it reaches a trace/report."""

    lowered = key.lower()
    if lowered in _STRUCTURED_VALUE_KEYS and (
        value is None or isinstance(value, str)
    ):
        # Structured selector fields are machine evidence, not user text.
        # Unexpected containers fall through to recursive handling below so
        # nested text/value fields still redact.
        return value
    if lowered in _SENSITIVE_VALUE_KEYS or any(
        part in lowered for part in _SENSITIVE_KEY_PARTS
    ):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(k): redact_evidence(v, key=str(k))
            for k, v in value.items()
        }
    if isinstance(value, list):
        child_key = "" if lowered in _STRUCTURED_VALUE_KEYS else key
        return [redact_evidence(v, key=child_key) for v in value]
    if isinstance(value, tuple):
        child_key = "" if lowered in _STRUCTURED_VALUE_KEYS else key
        return [redact_evidence(v, key=child_key) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def redact_selector(selector: dict[str, Any] | None) -> dict[str, Any] | None:
    """Redact a v1 selector without breaking structured target identity.

    ``request.value`` is verbatim for ``by_id``/``by_key``/``by_type`` (a
    canonical target name) and redacted for ``by_text`` (user-visible copy).
    ``resolution.selected``/``candidates`` ids, types and bounds are machine
    evidence and stay verbatim; ``fragment_anchor`` is text and does not.
    """

    if not selector:
        return None
    request = dict(selector.get("request") or {})
    resolution = dict(selector.get("resolution") or {})

    kind = str(request.get("kind", ""))
    constraints = request.get("constraints") or {}
    if kind == "composite":
        # A composite request keeps the identity of whichever predicate is
        # primary: a composite built around by_id is still a structured target,
        # and redacting it would undo the 0.4.1 selector-identity fix.
        kind = str(constraints.get("primary") or "by_text")
    value = request.get("value")
    if value is not None and kind not in _STRUCTURED_REQUEST_KINDS:
        value = redact_text(str(value))
    safe_request = {
        "kind": request.get("kind"),
        "value": value,
        "match": request.get("match"),
        "constraints": redact_evidence(request.get("constraints") or {}),
    }

    def _target(item: Any) -> Any:
        if not isinstance(item, dict):
            return redact_evidence(item)
        out = {k: item[k] for k in ("id", "type", "bounds") if k in item}
        return out

    safe_resolution: dict[str, Any] = {
        "state": resolution.get("state"),
        "candidate_count": resolution.get("candidate_count"),
        "selected": _target(resolution["selected"]) if resolution.get("selected") else None,
        "candidates": [_target(c) for c in resolution.get("candidates") or []],
    }
    if resolution.get("state") == "unresolvable":
        safe_resolution["reason_code"] = resolution.get("reason_code")
        facts = dict(resolution.get("facts") or {})
        if facts.get("fragment_anchor") is not None:
            facts["fragment_anchor"] = redact_text(str(facts["fragment_anchor"]))
        safe_resolution["facts"] = facts
    return {"request": safe_request, "resolution": safe_resolution}


@dataclass(frozen=True)
class StepResult:
    """One planned step's authoritative ledger row (Step Outcome Protocol v1).

    ``outcome`` holds the already-discriminated outcome object; there is no
    second, flat representation of the same facts.
    """

    index: int
    kind: str
    role: StepRole
    duration_ms: float = 0.0
    device_session: bool = False
    outcome: dict[str, Any] = field(default_factory=dict)
    selector: dict[str, Any] | None = None
    artifacts: tuple[dict[str, Any], ...] = ()
    diagnostic: str | None = None
    extensions: dict[str, Any] = field(default_factory=dict)

    @property
    def status(self) -> StepStatus:
        return str(self.outcome.get("status", ""))  # type: ignore[return-value]

    @property
    def failure(self) -> dict[str, Any] | None:
        return self.outcome.get("failure")

    @property
    def cause(self) -> dict[str, Any] | None:
        return self.outcome.get("cause")

    @property
    def reason(self) -> dict[str, Any] | None:
        return self.outcome.get("reason")

    @property
    def observation(self) -> dict[str, Any] | None:
        return self.outcome.get("observation")

    def raw_dict(self) -> dict[str, Any]:
        """Serialized shape *without* privacy redaction, for reduction only."""

        return {
            "index": int(self.index),
            "kind": self.kind,
            "role": self.role,
            "duration_ms": round(float(self.duration_ms), 3),
            "device_session": bool(self.device_session),
            "outcome": self.outcome,
            "selector": self.selector,
            "artifacts": [dict(a) for a in self.artifacts],
            "diagnostic": self.diagnostic,
            "extensions": dict(self.extensions),
        }

    def to_dict(self) -> dict[str, Any]:
        """Serialized shape as persisted: redacted, structured identity intact."""

        return {
            "index": int(self.index),
            "kind": self.kind,
            "role": self.role,
            "duration_ms": round(float(self.duration_ms), 3),
            "device_session": bool(self.device_session),
            "outcome": redact_evidence(self.outcome),
            "selector": redact_selector(self.selector),
            "artifacts": [dict(a) for a in self.artifacts],
            "diagnostic": redact_text(self.diagnostic),
            "extensions": redact_evidence(dict(self.extensions)),
        }


@dataclass(frozen=True)
class CaseResult:
    """Case identity plus the single authoritative per-step result ledger.

    The three axes and the legacy status are *reduced* from ``steps`` by
    :mod:`hylyre.scenario.reducer`; no entry may set them freely.
    """

    case: TestCase
    status: str = ""
    notes: str = ""
    execution: Execution = "completed"
    verification: Verification = "inconclusive"
    evidence: EvidenceStatus = "complete"
    expected_check_mode: ExpectedCheckMode = "empty"
    steps: tuple[StepResult, ...] = field(default_factory=tuple)

    def raw_dict(self) -> dict[str, Any]:
        return {
            "id": self.case.case_id,
            "name": self.case.name,
            "priority": self.case.priority,
            "ac_ref": self.case.ac_ref,
            "status": self.status,
            "notes": self.notes or "",
            "execution": self.execution,
            "verification": self.verification,
            "evidence": self.evidence,
            "expected_check_mode": self.expected_check_mode,
            "steps": [step.raw_dict() for step in self.steps],
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.case.case_id,
            "name": self.case.name,
            "priority": self.case.priority,
            "ac_ref": self.case.ac_ref,
            "status": self.status,
            "notes": redact_text(self.notes) or "",
            "execution": self.execution,
            "verification": self.verification,
            "evidence": self.evidence,
            "expected_check_mode": self.expected_check_mode,
            "steps": [step.to_dict() for step in self.steps],
        }


__all__ = [
    "CaseResult",
    "EvidenceStatus",
    "Execution",
    "ExpectedCheckMode",
    "StepResult",
    "StepRole",
    "StepStatus",
    "Verification",
    "redact_evidence",
    "redact_selector",
    "redact_text",
]

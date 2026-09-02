"""Run scenarios from a test plan with one authoritative step ledger.

Both the real-device path and the offline stub build every row through the
single builder; the stub only changes where observations come from, never what
the protocol means.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from hylyre.api.agent import HylyreAgent
from hylyre.api.outcome import (
    ActionObservation,
    SelectorEvidence,
    SelectorResolution,
    CapabilityCause,
    Failure,
    InfrastructureCause,
    OperationBlocked,
    OperationFailed,
    OperationPassed,
    OperationSkipped,
    Reason,
    presence_observed,
)
from hylyre.api.failure_diag import capture_failure_boundary
from hylyre.api.selector_contract import selector_request
from hylyre.scenario.ledger import (
    _execute_step_value,
    execute_expected_assertion,
    execute_ledger_step,
    planned_step_kind,
    planned_step_role,
    toast_assertion_on_unsupported,
)
from hylyre.scenario.plan_parse import ParsedPlan, TestCase, parse_test_plan
from hylyre.scenario.reducer import make_case_result, run_outcome, tool_calls_projection
from hylyre.scenario.results import CaseResult, StepResult
from hylyre.scenario.step_builder import blocked_by_prior_step, build_step_result
from hylyre.scenario.step_text import normalize_planned_step_text

#: Namespace for facts that are true of the offline stub, not of a device.
FAKE_NAMESPACE = "x_hylyre_fake.stub"


def resolved_outcome(result: "ScenarioRunResult") -> str:
    """Project case axes to the trace outcome using the frozen ordered rules."""

    return run_outcome(result.case_results)


@dataclass(frozen=True)
class ScenarioRunResult:
    feature: str
    plan: ParsedPlan
    case_results: tuple[CaseResult, ...]
    use_fakes: bool
    environment: dict[str, str] | None = None

    @property
    def tool_calls(self) -> tuple[dict[str, Any], ...]:
        """Lossy projection derived exclusively from ``cases[].steps[]``."""

        return tuple(tool_calls_projection(self.case_results))


#: Facts that are true of the offline stub, not of a device.
_STUB_EXTENSIONS = {FAKE_NAMESPACE: {"channel": "fake", "device": False}}


def fake_step_outcome(
    raw: Any,
    *,
    kind: str,
    role: str,
    forced: str | None = None,
) -> Any:
    """The offline stub's outcome for one planned step.

    Shared by every fake entry (plan and steps-file), so "fake" means the same
    thing everywhere: it changes where observations come from, never what the
    protocol means. The stub never fabricates an assertion result, and every
    row it produces carries a namespaced stub fact plus ``device_session=false``
    so it can never be mistaken for device evidence.

    ``forced`` carries a plan fixture's explicit intent (``skip``/``fail``/
    ``block`` from a case-id suffix); a steps-file batch has no such marker.
    """

    if forced == "skip":
        return OperationSkipped(
            reason=Reason(
                "policy",
                "x_hylyre_fake.fixture_skip",
                {"probe_status": "not_configured", "probe_source": "fake.runner"},
            ),
            extensions=_STUB_EXTENSIONS,
            diagnostic="fake mode: skipped by fixture",
        )
    if forced == "fail":
        if role == "assertion":
            return OperationFailed(
                failure=Failure("assertion", "assertion.mismatch"),
                observation=presence_observed(False),
                extensions=_STUB_EXTENSIONS,
                diagnostic="fake mode: fixture forces failure",
            )
        return OperationFailed(
            failure=Failure("selector", "selector.not_found"),
            observation=ActionObservation(kind, False, {"channel": "fake"}),
            # A stub claiming selector.not_found must show the same
            # request/resolution shape a real run would, or it is useless as a
            # consumer conformance gate.
            selector=SelectorEvidence(
                selector_request(_planned_selector_block(raw)),
                SelectorResolution.not_found(),
            ),
            extensions=_STUB_EXTENSIONS,
            diagnostic="fake mode: fixture forces failure",
        )
    if forced == "block":
        return OperationBlocked(
            cause=InfrastructureCause(
                code="infrastructure.device_unavailable",
                probe_status="unavailable",
                probe_source="fake.runner",
                resource_kind="device",
            ),
            extensions=_STUB_EXTENSIONS,
            diagnostic="fake mode: blocked by fixture",
        )
    if role == "assertion":
        # A stub has nothing to observe. Reporting a pass here is the
        # empty-assertion false green the protocol exists to remove.
        return OperationBlocked(
            cause=CapabilityCause(
                code="capability.not_configured",
                capability_id="fake.ui_observation",
                probe_status="not_configured",
                probe_source="fake.runner",
            ),
            extensions=_STUB_EXTENSIONS,
            diagnostic="fake mode: assertions are not observable offline",
        )
    return OperationPassed(
        observation=ActionObservation(kind, True, {"channel": "fake"}),
        extensions=_STUB_EXTENSIONS,
    )


def _planned_selector_block(raw: Any) -> dict[str, Any]:
    """The selector predicate a planned step asked for, for stub evidence."""

    from hylyre.scenario.ledger import _parse_step_object

    parsed = _parse_step_object(raw) or {}
    for key in ("touch", "input", "wait_for", "wait_gone", "scroll_to"):
        block = parsed.get(key)
        if isinstance(block, dict):
            return block
    action = parsed.get("action")
    if isinstance(action, dict):
        return {k: v for k, v in action.items() if k != "type"}
    return {}


def _expected_is_empty(expected: str) -> bool:
    return not expected.strip() or expected.strip() == "-"


def _is_root_blocked(step: StepResult) -> bool:
    cause = step.cause or {}
    return step.status == "blocked" and cause.get("type") in (
        "capability",
        "infrastructure",
    )


class ScenarioRunner:
    """Execute plan rows; fake mode is deterministic without devices."""

    def __init__(self, *, use_fakes: bool = False) -> None:
        self._use_fakes = use_fakes

    def run_plan_file(
        self,
        plan_path: Path | str,
        *,
        feature: str,
        check_expected: bool = True,
    ) -> ScenarioRunResult:
        if not self._use_fakes:
            raise ValueError(
                "Real-device runs use run_plan_on_agent(); "
                "pass use_fakes=True for run_plan_file()."
            )
        plan = parse_test_plan(plan_path)
        results = [
            self._fake_case_result(case, check_expected=check_expected)
            for case in plan.cases
        ]
        return ScenarioRunResult(
            feature=feature,
            plan=plan,
            case_results=tuple(results),
            use_fakes=True,
            environment={"ui_driver": "fake", "hypium_version": "unavailable"},
        )

    @staticmethod
    def _fake_case_result(
        case: TestCase, *, check_expected: bool = True
    ) -> CaseResult:
        """Offline stub rows, built through the same builder as a real run.

        The stub does not pretend to observe a device: it never fabricates an
        assertion result, and every row is marked ``device_session=false`` plus
        a namespaced stub fact so it can never be mistaken for device evidence.
        """

        raw_steps = _iter_steps(case.steps)
        step_results: list[StepResult] = []
        stub = {FAKE_NAMESPACE: {"channel": "fake", "device": False}}
        root_index: int | None = None

        for idx, raw in enumerate(raw_steps):
            kind = planned_step_kind(raw)
            role = planned_step_role(raw)

            if root_index is not None:
                step_results.append(
                    blocked_by_prior_step(
                        index=idx, kind=kind, role=role, root_index=root_index
                    )
                )
                continue

            upper = case.case_id.upper()
            forced: str | None = None
            if "跳过" in raw or upper.endswith("-SKIP"):
                forced = "skip"
            elif upper.endswith("-FAIL"):
                forced = "fail"
            elif upper.endswith("-BLOCK"):
                forced = "block"
            outcome = fake_step_outcome(raw, kind=kind, role=role, forced=forced)
            step = build_step_result(
                outcome, index=idx, kind=kind, role=role, device_session=False
            )
            step_results.append(step)
            if step.status == "failed" or _is_root_blocked(step):
                root_index = idx

        expected_mode = "empty"
        if not _expected_is_empty(case.expected):
            expected_mode = (
                "disabled_by_flag" if not check_expected else "unavailable_no_vlm"
            )
            step_results.append(
                _expected_not_run_row(
                    index=len(step_results),
                    mode=expected_mode,
                    extensions=stub,
                )
            )

        return make_case_result(
            case,
            step_results,
            expected_check_mode=expected_mode,  # type: ignore[arg-type]
            notes="fake mode: deterministic stub; expected result not checked",
        )

    async def run_plan_on_agent(
        self,
        agent: HylyreAgent,
        plan_path: Path | str,
        *,
        feature: str,
        bundle: str | None = None,
        page_name: str | None = None,
        wait_time: float = 1.0,
        params: str = "",
        mock_group: str | None = None,
        check_expected: bool = True,
        failure_dir: Path | str | None = None,
        artifact_base: Path | str | None = None,
    ) -> ScenarioRunResult:
        """Drive ``HylyreAgent`` from plan rows and retain every step result.

        ``artifact_base`` is the directory recorded artifact paths are relative
        to — the trace file's directory, so the trace is self-locating.
        """

        if self._use_fakes:
            raise ValueError("run_plan_on_agent requires ScenarioRunner(use_fakes=False)")
        plan = parse_test_plan(plan_path)
        if agent.mock_controller is not None and mock_group:
            await agent.mock_activate_group(mock_group)
        if bundle:
            await agent.start_app(
                bundle,
                page_name=page_name,
                params=params or "",
                wait_time=wait_time,
            )
        results: list[CaseResult] = []
        device_lost = False
        for case in plan.cases:
            if device_lost:
                # Decision row D-23: a later case does not re-attempt against a
                # device already proven gone, and it never reaches across cases
                # for a prior_step. It forms its own root from a fresh probe.
                probe = await _probe_device(agent)
                if probe is not None:
                    results.append(_device_unavailable_case(case, probe))
                    continue
                device_lost = False
            result = await self._run_case_on_agent(
                agent,
                case,
                check_expected=check_expected,
                failure_dir=failure_dir,
                artifact_base=artifact_base,
            )
            results.append(result)
            device_lost = result.execution == "infrastructure_failed"
        return ScenarioRunResult(
            feature=feature,
            plan=plan,
            case_results=tuple(results),
            use_fakes=False,
            environment={
                "ui_driver": type(agent.ui).__name__,
                "hypium_version": str(
                    getattr(agent.ui, "hypium_version", "unavailable")
                    or "unavailable"
                ),
            },
        )

    async def _run_case_on_agent(
        self,
        agent: HylyreAgent,
        case: TestCase,
        *,
        check_expected: bool,
        failure_dir: Path | str | None = None,
        artifact_base: Path | str | None = None,
    ) -> CaseResult:
        step_results: list[StepResult] = []
        notes: list[str] = []
        raw_steps = _iter_steps(case.steps)
        toast_probe: dict[str, Any] | None = None
        root_index: int | None = None

        for step_idx, step in enumerate(raw_steps):
            kind = planned_step_kind(step)
            role = planned_step_role(step)

            if root_index is not None:
                step_results.append(
                    blocked_by_prior_step(
                        index=step_idx, kind=kind, role=role, root_index=root_index
                    )
                )
                continue

            # A Toast assertion needs its listener started before the trigger.
            # If that capability is proven missing *before* dispatch, the Toast
            # step is blocked or skipped by policy — the trigger action itself
            # is unaffected and must not inherit the capability gap.
            if _step_triggers_toast_assertion(raw_steps, step_idx):
                toast_probe = await _probe_toast_listener(agent)

            if kind == "assert_toast" and toast_probe is not None:
                policy = toast_assertion_on_unsupported(step)
                current = build_step_result(
                    _toast_capability_outcome(toast_probe, skip=policy == "skip"),
                    index=step_idx,
                    kind=kind,
                    role=role,
                    device_session=agent.is_connected,
                )
                toast_probe = None
            else:
                current = await execute_ledger_step(
                    agent,
                    step,
                    index=step_idx,
                    case_id=case.case_id,
                )

            if current.status in ("failed", "blocked"):
                current = await _attach_failure_boundary(
                    agent,
                    current,
                    failure_dir=failure_dir,
                    label=f"{case.case_id}-step-{step_idx}",
                    artifact_base=artifact_base,
                )
            if current.diagnostic:
                notes.append(current.diagnostic)
            step_results.append(current)

            if current.status == "failed" or _is_root_blocked(current):
                root_index = step_idx

        expected_mode, expected_row = await _expected_check_row(
            agent,
            case,
            index=len(step_results),
            check_expected=check_expected,
            root_index=root_index,
        )
        if expected_row is not None:
            step_results.append(expected_row)
            if expected_row.diagnostic:
                notes.append(expected_row.diagnostic)

        if root_index is not None:
            blocked_after = sum(1 for s in step_results if s.status == "blocked")
            if blocked_after:
                notes.append(
                    f"step {root_index} is the root outcome; "
                    f"{blocked_after} later step(s) were not executed"
                )

        return make_case_result(
            case,
            step_results,
            expected_check_mode=expected_mode,  # type: ignore[arg-type]
            notes="; ".join(notes),
        )


def _expected_not_run_row(
    *,
    index: int,
    mode: str,
    extensions: dict[str, Any] | None = None,
) -> StepResult:
    """The expected-check row for a policy decision not to run it."""

    if mode == "disabled_by_flag":
        reason = Reason("policy", "expected_check.disabled_by_flag")
        diagnostic = "expected check disabled by flag"
    else:
        reason = Reason(
            "policy",
            "expected_check.unavailable_no_vlm",
            {"probe_status": "not_configured", "probe_source": "agent.vlm_preflight"},
        )
        diagnostic = "expected check unavailable: no VLM configured"
    return build_step_result(
        OperationSkipped(
            reason=reason, extensions=extensions or {}, diagnostic=diagnostic
        ),
        index=index,
        kind="expected_check",
        role="assertion",
    )


async def _expected_check_row(
    agent: HylyreAgent,
    case: TestCase,
    *,
    index: int,
    check_expected: bool,
    root_index: int | None,
) -> tuple[str, StepResult | None]:
    """Decide the expected-check mode and its ledger row (decision rows D-24..D-28)."""

    if _expected_is_empty(case.expected):
        return "empty", None
    if not check_expected:
        return "disabled_by_flag", _expected_not_run_row(
            index=index, mode="disabled_by_flag"
        )
    if agent.vlm is None:
        return "unavailable_no_vlm", _expected_not_run_row(
            index=index, mode="unavailable_no_vlm"
        )
    if root_index is not None:
        # D-28: the check was contracted to run; a prior root outcome stopped
        # it. That is a prior_step block, never "no VLM".
        return "checked_vlm", blocked_by_prior_step(
            index=index, kind="expected_check", role="assertion", root_index=root_index
        )
    return "checked_vlm", await execute_expected_assertion(
        agent,
        case.expected.strip(),
        index=index,
        case_id=case.case_id,
    )


async def _probe_device(agent: HylyreAgent) -> dict[str, Any] | None:
    """Read-only liveness probe; returns probe facts when the device is gone."""

    try:
        await agent.dump_ui()
    except Exception as exc:  # noqa: BLE001 - probe result, not an operation
        return {
            "probe_status": "offline",
            "probe_source": "device_preflight",
            "resource_kind": "device",
            "diagnostic": str(exc)[:2000],
        }
    return None


def _device_unavailable_case(case: TestCase, probe: dict[str, Any]) -> CaseResult:
    """A whole case blocked by a device a fresh probe proved unavailable."""

    raw_steps = _iter_steps(case.steps)
    steps: list[StepResult] = []
    for idx, raw in enumerate(raw_steps):
        kind = planned_step_kind(raw)
        role = planned_step_role(raw)
        if idx == 0:
            steps.append(
                build_step_result(
                    OperationBlocked(
                        cause=InfrastructureCause(
                            code="infrastructure.device_unavailable",
                            probe_status=str(probe["probe_status"]),
                            probe_source=str(probe["probe_source"]),
                            resource_kind="device",
                        ),
                        diagnostic=probe.get("diagnostic"),
                    ),
                    index=idx,
                    kind=kind,
                    role=role,
                )
            )
            continue
        steps.append(
            blocked_by_prior_step(index=idx, kind=kind, role=role, root_index=0)
        )
    return make_case_result(
        case,
        steps,
        expected_check_mode="empty",
        notes="device proven unavailable by a fresh probe before this case",
    )


async def _probe_toast_listener(agent: HylyreAgent) -> dict[str, Any] | None:
    """Start Toast observation; describe the outcome when it does not start.

    A *capability* gap and an unexpected transport error are different facts.
    Only the former is eligible for ``on_unsupported=skip`` — collapsing them
    would let a broken listener be silently skipped, which is exactly what the
    policy must not do.
    """

    from hylyre.api.exceptions import CapabilityUnsupported

    try:
        listener = await agent.start_toast_listening()
    except CapabilityUnsupported as exc:
        return {
            "probe_status": "unsupported",
            "probe_source": "runtime_preflight",
            "provider_id": type(agent.ui).__name__,
            "diagnostic": str(exc)[:2000],
        }
    except Exception as exc:  # noqa: BLE001 - unexpected: never skippable
        return {"unexpected_error": exc, "diagnostic": str(exc)[:2000]}
    if isinstance(listener, dict) and listener.get("listener_started") is False:
        return {
            "probe_status": "unsupported",
            "probe_source": "runtime_preflight",
            "provider_id": str(listener.get("channel") or type(agent.ui).__name__),
            "diagnostic": "toast listener did not start",
        }
    return None


def _toast_capability_outcome(probe: dict[str, Any], *, skip: bool) -> Any:
    """A Toast capability proven missing before dispatch (D-06 / D-27)."""

    if "unexpected_error" in probe:
        # Not a capability gap: an unexpected listener failure is a failure of
        # this assertion, and `on_unsupported=skip` does not apply to it.
        from hylyre.scenario.step_builder import outcome_from_exception

        return outcome_from_exception(probe["unexpected_error"])

    facts = {
        "probe_status": probe["probe_status"],
        "probe_source": probe["probe_source"],
        "capability_id": "toast_listener",
        "provider_id": probe.get("provider_id"),
    }
    diagnostic = probe.get("diagnostic")
    if skip:
        return OperationSkipped(
            reason=Reason("policy", "optional_check.on_unsupported_skip", facts),
            diagnostic=diagnostic,
        )
    return OperationBlocked(
        cause=CapabilityCause(
            code="capability.unsupported",
            capability_id="toast_listener",
            probe_status=str(probe["probe_status"]),
            probe_source=str(probe["probe_source"]),
            provider_id=probe.get("provider_id"),
        ),
        diagnostic=diagnostic,
    )


async def _attach_failure_boundary(
    agent: HylyreAgent,
    step: StepResult,
    *,
    failure_dir: Path | str | None,
    label: str,
    artifact_base: Path | str | None = None,
) -> StepResult:
    """Attach the failure-boundary screen artifact for a real root failure.

    Only selector/assertion root failures inside a live device session owe one
    (protocol section 8.1). Capture is never faked: when it fails, the row says
    so through the ``hylyre.capture`` extension and the reducer downgrades the
    case evidence.
    """

    failure = step.failure or {}
    if step.status != "failed" or failure.get("domain") not in ("selector", "assertion"):
        return step
    if not step.device_session:
        return step

    artifacts, capture_error = await capture_failure_boundary(
        agent, failure_dir=failure_dir, label=label, relative_to=artifact_base
    )
    if artifacts:
        return replace(step, artifacts=tuple(a.to_dict() for a in artifacts))
    return replace(
        step,
        extensions={
            **step.extensions,
            "hylyre.capture": {
                "screen": "unavailable",
                "reason_code": _capture_reason_code(capture_error),
                "detail": (capture_error or "no failure-dir configured")[:500],
            },
        },
    )


def _step_triggers_toast_assertion(steps: list[str], index: int) -> bool:
    if index + 1 >= len(steps):
        return False
    next_step = normalize_planned_step_text(steps[index + 1])
    try:
        parsed = json.loads(next_step)
    except (TypeError, json.JSONDecodeError):
        return False
    return isinstance(parsed, dict) and (
        "assert_toast" in parsed
        or (
            isinstance(parsed.get("action"), dict)
            and parsed["action"].get("type") == "assert_toast"
        )
    )


def _iter_steps(text: str) -> list[str]:
    normalized = text.replace("；", "\n").replace(";", "\n")
    return [ln.strip() for ln in normalized.splitlines() if ln.strip()]


async def _execute_one_step(
    agent: HylyreAgent,
    case_id: str,
    step: str,
    tool_log: list[dict[str, Any]],
    *,
    step_idx: int = 0,
) -> Any:
    """Backward-compatible helper without maintaining a second tool log."""

    _ = (tool_log, step_idx)
    return await _execute_step_value(agent, step, case_id=case_id)


__all__ = [
    "CaseResult",
    "ScenarioRunResult",
    "ScenarioRunner",
    "StepResult",
    "resolved_outcome",
]


def _capture_reason_code(capture_error: str | None) -> str:
    """Why the failure boundary could not be captured.

    Capture is always attempted now (entries resolve a default directory), so
    reaching here means the device or transport genuinely could not be read —
    the only case spec section 8.1 allows the escape hatch for.
    """

    _ = capture_error
    return "infrastructure.transport_failure"

"""hylyre run — scenario runner entry."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import typer

from hylyre.harness.runner import verify_report, verify_report_details
from hylyre.report.emit import write_run_artifacts
from hylyre.scenario.plan_contract import (
    ContractRejection,
    validate_plan_contract,
    validate_steps_contract,
)
from hylyre.scenario.plan_parse import ParsedPlan, TestCase
from hylyre.scenario.runner import CaseResult, ScenarioRunResult, ScenarioRunner
from hylyre.scenario.steps_report import steps_batch_to_scenario_result

TRACE_DRAFT_SCHEMA = "0.1-p0"


def emit_pre_run_reject(rejection: ContractRejection) -> None:
    """Write the only stdout JSON object for a plan reject and exit with code 2.

    Nothing else may reach stdout, no device is contacted, and neither
    ``--trace-out`` nor ``--report-out`` is created or rewritten.
    """

    typer.echo(rejection.to_json())
    raise typer.Exit(code=2)


def reject_plan_before_run(plan: Path) -> None:
    """Emit ``pre_run_reject`` when a plan violates the step contract."""

    try:
        rejection = validate_plan_contract(plan)
    except ValueError:
        # Plan parsing errors keep their existing non-protocol handling.
        return
    if rejection is not None:
        emit_pre_run_reject(rejection)


def reject_steps_before_run(steps: list[Any]) -> None:
    """Emit ``pre_run_reject`` when a steps payload violates the step contract."""

    rejection = validate_steps_contract(steps)
    if rejection is not None:
        emit_pre_run_reject(rejection)


def infer_model_backend_from_env() -> str:
    """Default trace ``model_backend`` when not overridden on CLI."""
    return (
        os.environ.get("HYLYRE_VLM_MODEL", "").strip()
        or (
            "http-vlm"
            if os.environ.get("HYLYRE_VLM_ENDPOINT", "").strip()
            else "none"
        )
    )


def resolve_model_backend(override: str | None, *, use_fakes: bool) -> str:
    """CLI / env resolution: explicit flag, then env inference, then ``fake`` for stub runs."""
    if override is not None and override.strip():
        return override.strip()
    if use_fakes:
        return "fake"
    return infer_model_backend_from_env()


def execute_scenario(
    *,
    plan: Path,
    feature: str,
    report_out: Path,
    trace_out: Path,
    use_fakes: bool,
    device_sn: str | None = None,
    bundle: str | None = None,
    page_name: str | None = None,
    wait_time: float = 1.0,
    params: str = "",
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    mock_group: str | None = None,
    skip_assert_expected: bool = False,
    model_backend: str | None = None,
    failure_dir: Path | str | None = None,
) -> str:
    """Run plan, write artifacts, L5 verify. Returns message; raises ValueError on verify failure."""
    mb = resolve_model_backend(model_backend, use_fakes=use_fakes)
    if use_fakes:
        runner = ScenarioRunner(use_fakes=True)
        result = runner.run_plan_file(
            plan,
            feature=feature,
            check_expected=not skip_assert_expected,
        )
        write_run_artifacts(
            result, report_path=report_out, trace_path=trace_out, model_backend=mb
        )
    else:
        result, _ = asyncio.run(
            _run_on_device(
                plan=plan,
                feature=feature,
                device_sn=device_sn,
                bundle=bundle,
                page_name=page_name,
                wait_time=wait_time,
                params=params,
                mock_port=mock_port,
                lyrebird_url=lyrebird_url,
                mock_group=mock_group,
                skip_assert_expected=skip_assert_expected,
                failure_dir=failure_dir,
                artifact_base=Path(trace_out).parent,
            )
        )
        write_run_artifacts(
            result,
            report_path=report_out,
            trace_path=trace_out,
            model_backend=mb,
        )
    verify_report(report_out, trace_out, plan)
    return f"Wrote {report_out} and {trace_out}"


def execute_steps_scenario(
    *,
    steps_path: Path,
    steps: list[dict[str, Any]],
    feature: str,
    report_out: Path,
    trace_out: Path,
    device_sn: str | None = None,
    bundle: str | None = None,
    page_name: str | None = None,
    wait_time: float = 1.0,
    params: str = "",
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    session_file: Path | None = None,
    on_fail: str = "abort",
    model_backend: str | None = None,
    failure_dir: Path | str | None = None,
    use_fakes: bool = False,
) -> tuple[str, ScenarioRunResult]:
    """Run steps-file batch, emit plan-compatible report + trace, L5 verify."""
    from hylyre.cli.commands import steps_cmd

    batch = steps_cmd.execute_run_steps(
        steps,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session_file,
        on_fail=on_fail,
        bundle=bundle,
        page_name=page_name,
        wait_time=wait_time,
        params=params,
        failure_dir=failure_dir,
        artifact_base=Path(trace_out).parent,
        use_fakes=use_fakes,
    )
    result = steps_batch_to_scenario_result(
        feature=feature,
        steps_path=steps_path,
        batch=batch,
        bundle=bundle,
        page_name=page_name,
        use_fakes=use_fakes,
    )
    mb = resolve_model_backend(model_backend, use_fakes=use_fakes)
    write_run_artifacts(
        result,
        report_path=report_out,
        trace_path=trace_out,
        model_backend=mb,
    )
    verify_plan = (
        steps_path
        if steps_path.is_file() and steps_path.suffix.lower() in (".md", ".markdown")
        else None
    )
    verify_report(report_out, trace_out, verify_plan)
    return f"Wrote {report_out} and {trace_out}", result


def execute_report_begin(
    *,
    feature: str,
    trace_path: Path | None = None,
    plan_path: Path | None = None,
    trace_state: dict[str, Any] | None = None,
    model_backend: str = "none",
) -> dict[str, Any]:
    """Initialize incremental trace state (draft schema); persist when ``trace_path`` set."""
    if trace_state is not None:
        raise ValueError("execute_report_begin: use trace_state=None")
    state: dict[str, Any] = {
        "schema_version": TRACE_DRAFT_SCHEMA,
        "feature": feature,
        "phase": "testing",
        "outcome": "success",
        "model_backend": model_backend,
        "retries": 0,
        "artifacts": {
            "adhoc": True,
            "plan": str(plan_path) if plan_path else None,
        },
        "cases": [],
    }
    if trace_path is not None:
        trace_path.write_text(
            json.dumps(state, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    return state


def execute_report_record(
    *,
    trace_path: Path | None = None,
    trace_state: dict[str, Any] | None = None,
    case_id: str,
    name: str,
    priority: str,
    ac_ref: str,
    status: str,
    notes: str = "",
) -> dict[str, Any]:
    """Append one case row to incremental trace state."""
    if trace_state is not None:
        state = trace_state
    elif trace_path is not None:
        state = json.loads(trace_path.read_text(encoding="utf-8"))
    else:
        raise ValueError("Need trace_path or trace_state")
    entry = {
        "id": case_id,
        "status": status,
        "priority": priority,
        "ac_ref": ac_ref,
        "notes": notes,
        "name": name,
    }
    state.setdefault("cases", []).append(entry)
    if trace_path is not None:
        trace_path.write_text(
            json.dumps(state, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    return state


def execute_report_finalize(
    *,
    trace_path: Path | None = None,
    trace_state: dict[str, Any] | None = None,
    plan_path: Path | None = None,
    report_out: Path,
    trace_out: Path,
    model_backend: str | None = None,
) -> str:
    """Build ScenarioRunResult from incremental cases; write report + trace; L5 verify."""
    if trace_state is not None:
        state = trace_state
    elif trace_path is not None:
        state = json.loads(trace_path.read_text(encoding="utf-8"))
    else:
        raise ValueError("Need trace_path or trace_state")
    raw_cases: list[dict[str, Any]] = state.get("cases", [])
    if not raw_cases:
        raise ValueError("finalize requires at least one recorded case")
    feature = str(state.get("feature", "")).strip() or "adhoc"
    parsed_cases: list[TestCase] = []
    case_results: list[CaseResult] = []
    for c in raw_cases:
        cid = str(c["id"])
        tc = TestCase(
            case_id=cid,
            name=str(c.get("name", "")),
            preconditions="",
            steps="",
            expected="",
            priority=str(c.get("priority", "P2")),
            ac_ref=str(c.get("ac_ref", "")),
        )
        parsed_cases.append(tc)
        case_results.append(
            CaseResult(
                case=tc,
                status=str(c["status"]),
                notes=str(c.get("notes", "")),
                execution=(
                    "completed"
                    if str(c["status"]) in ("通过", "失败", "跳过")
                    else "infrastructure_failed"
                ),
                verification=(
                    "passed"
                    if str(c["status"]) == "通过"
                    else "failed"
                    if str(c["status"]) in ("失败", "阻塞")
                    else "inconclusive"
                ),
                evidence="complete" if str(c["status"]) == "通过" else "incomplete",
            )
        )
    plan_marker = plan_path if plan_path is not None else Path("(ad-hoc)")
    parsed = ParsedPlan(path=plan_marker, cases=tuple(parsed_cases))
    result = ScenarioRunResult(
        feature=feature,
        plan=parsed,
        case_results=tuple(case_results),
        use_fakes=False,
    )
    mb = (
        model_backend
        if model_backend is not None and model_backend.strip()
        else str(state.get("model_backend", "none"))
    )
    write_run_artifacts(
        result,
        report_path=report_out,
        trace_path=trace_out,
        model_backend=mb,
        schema_version="0.2-p4",
    )
    verify_plan = plan_path if plan_path is not None else None
    verify_report(report_out, trace_out, verify_plan)
    return f"Wrote {report_out} and {trace_out}"


def run_scenario(
    *,
    plan: Path,
    feature: str,
    report_out: Path,
    trace_out: Path,
    use_fakes: bool,
    device_sn: str | None = None,
    bundle: str | None = None,
    page_name: str | None = None,
    wait_time: float = 1.0,
    params: str = "",
    mock_port: int | None = None,
    lyrebird_url: str | None = None,
    mock_group: str | None = None,
    skip_assert_expected: bool = False,
    model_backend: str | None = None,
    failure_dir: Path | str | None = None,
) -> None:
    try:
        msg = execute_scenario(
            plan=plan,
            feature=feature,
            report_out=report_out,
            trace_out=trace_out,
            use_fakes=use_fakes,
            device_sn=device_sn,
            bundle=bundle,
            page_name=page_name,
            wait_time=wait_time,
            params=params,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            mock_group=mock_group,
            skip_assert_expected=skip_assert_expected,
            model_backend=model_backend,
            failure_dir=failure_dir,
        )
    except ValueError as exc:
        typer.secho(f"verify_report failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(msg)


async def _run_on_device(
    *,
    plan: Path,
    feature: str,
    device_sn: str | None,
    bundle: str | None,
    page_name: str | None,
    wait_time: float,
    params: str,
    mock_port: int | None,
    lyrebird_url: str | None,
    mock_group: str | None,
    skip_assert_expected: bool,
    failure_dir: Path | str | None = None,
    artifact_base: Path | str | None = None,
) -> tuple[ScenarioRunResult, str]:
    from hylyre.wiring import create_hypium_agent_with_env_vlm

    agent = create_hypium_agent_with_env_vlm(
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_base_url=lyrebird_url,
    )
    try:
        runner = ScenarioRunner(use_fakes=False)
        result = await runner.run_plan_on_agent(
            agent,
            plan,
            feature=feature,
            bundle=bundle or None,
            page_name=page_name,
            wait_time=wait_time,
            params=params,
            mock_group=mock_group or None,
            check_expected=not skip_assert_expected,
            failure_dir=failure_dir,
            artifact_base=artifact_base,
        )
        return result, infer_model_backend_from_env()
    finally:
        await agent.aclose()


def execute_report_verify(
    *,
    report: Path,
    trace: Path,
    plan: Path | None = None,
) -> dict[str, Any]:
    """Raises ValueError when contracts fail."""
    return verify_report_details(report, trace, plan)


def run_report_verify(
    *,
    report: Path,
    trace: Path,
    plan: Path | None = None,
) -> None:
    try:
        details = execute_report_verify(report=report, trace=trace, plan=plan)
    except ValueError as exc:
        typer.secho(f"verify_report failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"Contracts OK ({details['label']})")


def run_report_begin(
    *,
    feature: str,
    trace_out: Path,
    plan_path: Path | None,
    model_backend: str,
) -> None:
    try:
        execute_report_begin(
            feature=feature,
            trace_path=trace_out,
            plan_path=plan_path,
            model_backend=model_backend,
        )
    except ValueError as exc:
        typer.secho(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    typer.echo(str(trace_out.resolve()))


def run_report_record(
    *,
    trace_path: Path,
    case_id: str,
    name: str,
    priority: str,
    ac_ref: str,
    status: str,
    notes: str,
) -> None:
    try:
        execute_report_record(
            trace_path=trace_path,
            case_id=case_id,
            name=name,
            priority=priority,
            ac_ref=ac_ref,
            status=status,
            notes=notes,
        )
    except ValueError as exc:
        typer.secho(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    typer.echo("ok")


def run_report_finalize(
    *,
    trace_path: Path,
    plan_path: Path | None,
    report_out: Path,
    trace_write: Path,
    model_backend: str | None,
) -> None:
    try:
        msg = execute_report_finalize(
            trace_path=trace_path,
            plan_path=plan_path,
            report_out=report_out,
            trace_out=trace_write,
            model_backend=model_backend,
        )
    except ValueError as exc:
        typer.secho(f"verify_report failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(msg)

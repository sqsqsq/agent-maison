"""Typer CLI entrypoint."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import json
import typer

from hylyre.cli.commands import (
    ai_cmd,
    app_cmd,
    bootstrap_cmd,
    collect_cmd,
    device as device_cmd,
    doctor as doctor_cmd,
    find_cmd,
    loop_cmd,
    mock_cmd,
    progress_cmd,
    run_cmd,
    session_cmd,
    spec_cmd,
    steps_cmd,
)
from hylyre.cli.tier_a_run_commands import register_tier_a_run_commands
from hylyre.ui_dump_filter import DumpFilterSpec

app = typer.Typer(
    no_args_is_help=True,
    help="Hylyre — Hypium + Lyrebird unified device testing (HarmonyOS).",
    pretty_exceptions_enable=False,
)
report_app = typer.Typer(help="Test report tools")
app.add_typer(report_app, name="report")

run_app = typer.Typer(help="Run test plans (--plan / --steps), or atomic Hypium JSON steps")
app.add_typer(run_app, name="run")

device_app = typer.Typer(help="Device helpers (HDC + Hypium)")
app.add_typer(device_app, name="device")

ai_app = typer.Typer(help="Structured UI actions (P1); natural language in P3")
app.add_typer(ai_app, name="ai")

mock_app = typer.Typer(help="Lyrebird mock control (P2)")
app.add_typer(mock_app, name="mock")

bootstrap_app = typer.Typer(help="Optional mock toolchain bootstrap (P2b)")
app.add_typer(bootstrap_app, name="bootstrap")

progress_app = typer.Typer(help="View or append docs/progress.md")
app.add_typer(progress_app, name="progress")

spec_app = typer.Typer(help="OpenSpec workspace helpers")
app.add_typer(spec_app, name="spec")

session_app = typer.Typer(
    help="Persistent Hypium TCP session — reuse connection across atomic CLI calls.",
)
app.add_typer(session_app, name="session")

app.add_typer(app_cmd.app_cli, name="app")


@progress_app.callback(invoke_without_command=True)
def progress_default(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is None:
        progress_cmd.run_progress_show()


@progress_app.command("show")
def progress_show(
    tail: Optional[int] = typer.Option(
        None,
        "--tail",
        "-n",
        min=1,
        help="Print only the last N lines.",
    ),
) -> None:
    """Print docs/progress.md path and contents."""
    progress_cmd.run_progress_show(tail_lines=tail)


@progress_app.command("append")
def progress_append(
    message: str = typer.Option(
        ...,
        "--message",
        "-m",
        help="Markdown body to append (new dated section).",
    ),
    title: Optional[str] = typer.Option(
        None,
        "--title",
        help="Override default '## YYYY-MM-DD · hylyre progress' heading.",
    ),
) -> None:
    """Append a section to docs/progress.md (creates file if needed)."""
    progress_cmd.run_progress_append(message, title=title)


@progress_app.command("path")
def progress_path() -> None:
    """Print resolved docs/progress.md path (for shell scripts)."""
    progress_cmd.run_progress_path_only()


@spec_app.callback(invoke_without_command=True)
def spec_default(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is None:
        spec_cmd.run_spec_list()


@spec_app.command("list")
def spec_list() -> None:
    """Run openspec list when installed, else print specs/ + changes/ summary."""
    spec_cmd.run_spec_list()


@session_app.command("daemon", hidden=True)
def session_daemon_hidden() -> None:
    """Internal: spawned by ``session start``."""
    session_cmd.run_daemon_cli()


@session_app.command("start")
def session_start(
    session_file: Optional[Path] = typer.Option(
        None,
        "--session-file",
        help="Where to write session JSON (default ./.hylyre/session.json).",
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    wait_s: float = typer.Option(
        120.0,
        "--wait-s",
        help="Max seconds to wait for daemon socket + ping.",
    ),
) -> None:
    """Start background Hypium session daemon; prints session JSON path."""
    session_cmd.run_session_start(
        session_file=session_file,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        wait_s=wait_s,
    )


@session_app.command("stop")
def session_stop(
    session_file: Optional[Path] = typer.Option(
        None,
        "--session-file",
        help="Session JSON path (default ./.hylyre/session.json).",
    ),
) -> None:
    """Stop daemon and remove session file."""
    session_cmd.run_session_stop(session_file=session_file)


@session_app.command("status")
def session_status(
    session_file: Optional[Path] = typer.Option(
        None,
        "--session-file",
        help="Session JSON path (default ./.hylyre/session.json).",
    ),
) -> None:
    """Print JSON status (pid, ping_ok)."""
    session_cmd.run_session_status(session_file=session_file)


@run_app.callback(invoke_without_command=True)
def run_plan_batch(
    ctx: typer.Context,
    plan: Optional[Path] = typer.Option(
        None,
        "--plan",
        exists=True,
        dir_okay=False,
        readable=True,
        help="test-plan.md — batch mode when no subcommand.",
    ),
    steps: Optional[str] = typer.Option(
        None,
        "--steps",
        help=(
            "JSON array of planned step objects, e.g. "
            '\'[{"touch":{"by_id":"x"}}]\' (mutually exclusive with --steps-file).'
        ),
    ),
    steps_file: Optional[Path] = typer.Option(
        None,
        "--steps-file",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Path to JSON file: array of planned step objects (--plan excludes this).",
    ),
    on_fail: str = typer.Option(
        "abort",
        "--on-fail",
        help="abort: stop on first error; skip: record error and continue.",
    ),
    steps_out: Optional[Path] = typer.Option(
        None,
        "--out",
        "-o",
        help="Write batch steps result JSON (default: stdout).",
    ),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
    page_name: Optional[str] = typer.Option(
        None,
        "--page-name",
        help="Hypium ability name — used with --bundle on plan or steps batch.",
    ),
    start_wait_time: float = typer.Option(
        1.0,
        "--wait-time",
        help="start_app wait (seconds) when --bundle is set (plan or steps batch).",
    ),
    feature: Optional[str] = typer.Option(
        None,
        "--feature",
        help="Feature slug for report/trace metadata.",
    ),
    report_out: Optional[Path] = typer.Option(
        None,
        "--report-out",
        help="Output test-report.md",
    ),
    trace_out: Optional[Path] = typer.Option(
        None,
        "--trace-out",
        help="Output trace.json",
    ),
    use_fakes: bool = typer.Option(
        False,
        "--use-fakes",
        help="Stub results (no Hypium); CI smoke.",
    ),
    device_sn: Optional[str] = typer.Option(
        None,
        "--device-sn",
        help="Hypium hdc -t serial.",
    ),
    bundle: Optional[str] = typer.Option(
        None,
        "--bundle",
        help="start_app bundle before cases.",
    ),
    mock_port: Optional[int] = typer.Option(
        None,
        "--mock-port",
        help="Lyrebird admin port on 127.0.0.1.",
    ),
    lyrebird_url: Optional[str] = typer.Option(
        None,
        "--lyrebird-url",
        help="Lyrebird base URL.",
    ),
    mock_group: Optional[str] = typer.Option(
        None,
        "--mock-group",
        help="Lyrebird mock group UUID.",
    ),
    skip_assert_expected: bool = typer.Option(
        False,
        "--skip-assert-expected",
        help="Skip VLM ai_assert on 预期结果.",
    ),
    model_backend: Optional[str] = typer.Option(
        None,
        "--model-backend",
        help="trace.json model_backend override.",
    ),
    failure_dir: Optional[Path] = typer.Option(
        None,
        "--failure-dir",
        help="Directory for step-failure UI dumps and screenshots.",
    ),
) -> None:
    """Batch: ``hylyre run --plan …`` or ``hylyre run --steps-file …``.
    Subcommands: action / tap / input / swipe / scroll / start-app."""
    if ctx.invoked_subcommand is not None:
        return
    has_plan = plan is not None
    has_steps = steps is not None or steps_file is not None

    if has_plan and has_steps:
        typer.secho(
            "Cannot combine --plan with --steps/--steps-file.",
            err=True,
        )
        raise typer.Exit(2)

    if has_steps:
        if steps is not None and steps_file is not None:
            typer.secho(
                "Pass at most one of --steps or --steps-file.",
                err=True,
            )
            raise typer.Exit(2)
        try:
            if steps_file is not None:
                step_list = steps_cmd.load_steps_json_array(Path(steps_file))
            elif steps is not None:
                step_list = steps_cmd.parse_steps_inline(steps)
            else:
                raise AssertionError("unreachable")
        except Exception as e:
            typer.secho(f"Invalid steps JSON: {e}", err=True)
            raise typer.Exit(2)
        wants_report = (
            feature is not None or report_out is not None or trace_out is not None
        )
        fd = failure_dir
        if fd is None and trace_out is not None:
            # Beside the trace, so every recorded artifact path resolves from
            # dirname(trace_path) alone — no working-directory dependency.
            fd = Path(trace_out).parent / "failures"
        if wants_report:
            need = []
            if feature is None:
                need.append("--feature")
            if report_out is None:
                need.append("--report-out")
            if trace_out is None:
                need.append("--trace-out")
            if need:
                typer.secho(
                    f"Steps report mode requires: {', '.join(need)}",
                    err=True,
                )
                raise typer.Exit(2)
            steps_path = (
                Path(steps_file)
                if steps_file is not None
                else Path("<inline-steps>")
            )
            # P0-7B: reject a contract-invalid batch before any device call and
            # before --report-out/--trace-out are created.
            run_cmd.reject_steps_before_run(step_list)
            try:
                msg, synth = run_cmd.execute_steps_scenario(
                    steps_path=steps_path,
                    steps=step_list,
                    feature=feature,
                    report_out=report_out,
                    trace_out=trace_out,
                    device_sn=device_sn,
                    bundle=bundle,
                    page_name=page_name,
                    wait_time=start_wait_time,
                    mock_port=mock_port,
                    lyrebird_url=lyrebird_url,
                    session_file=session,
                    on_fail=on_fail,
                    model_backend=model_backend,
                    failure_dir=fd,
                    use_fakes=use_fakes,
                )
            except ValueError as exc:
                typer.secho(f"verify_report failed: {exc}", err=True)
                raise typer.Exit(1) from exc
            except Exception as e:
                typer.secho(str(e), err=True)
                raise typer.Exit(1) from e
            typer.echo(msg)
            from hylyre.scenario.runner import resolved_outcome

            raise typer.Exit(0 if resolved_outcome(synth) == "success" else 1)
        try:
            result_dict = steps_cmd.execute_run_steps(
                step_list,
                device_sn=device_sn,
                mock_port=mock_port,
                lyrebird_url=lyrebird_url,
                session_file=session,
                on_fail=on_fail,
                bundle=bundle,
                page_name=page_name,
                wait_time=start_wait_time,
                failure_dir=fd,
                use_fakes=use_fakes,
            )
        except Exception as e:
            typer.secho(str(e), err=True)
            raise typer.Exit(1)
        text = json.dumps(result_dict, ensure_ascii=False, indent=2)
        if steps_out is not None:
            steps_out.parent.mkdir(parents=True, exist_ok=True)
            steps_out.write_text(text + "\n", encoding="utf-8")
            typer.echo(str(steps_out.resolve()))
        else:
            typer.echo(text)
        any_err = any(
            r.get("status") == "error" for r in result_dict.get("results", [])
        )
        raise typer.Exit(1 if any_err else 0)

    if plan is None:
        typer.secho(
            "Batch mode requires --plan, or --steps/--steps-file "
            "(or use a subcommand; try `hylyre run --help`).",
            err=True,
        )
        raise typer.Exit(2)
    need = []
    if feature is None:
        need.append("--feature")
    if report_out is None:
        need.append("--report-out")
    if trace_out is None:
        need.append("--trace-out")
    if need:
        typer.secho(f"Batch mode also requires: {', '.join(need)}", err=True)
        raise typer.Exit(2)
    fd_plan = failure_dir
    if fd_plan is None and trace_out is not None:
        fd_plan = Path(trace_out).parent / "failures"
    # P0-7B: reject a contract-invalid plan before any device call and before
    # --report-out/--trace-out are created.
    run_cmd.reject_plan_before_run(Path(plan))
    run_cmd.run_scenario(
        plan=plan,
        feature=feature,
        report_out=report_out,
        trace_out=trace_out,
        use_fakes=use_fakes,
        device_sn=device_sn,
        bundle=bundle,
        page_name=page_name,
        wait_time=start_wait_time,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        mock_group=mock_group,
        skip_assert_expected=skip_assert_expected,
        model_backend=model_backend,
        failure_dir=fd_plan,
    )


@run_app.command("action")
def run_action_step(
    payload_json: str = typer.Option(
        ...,
        "--json",
        "-j",
        help='Planned JSON root key "action", e.g. {"action":{"type":"touch","by_text":"OK"}}',
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
) -> None:
    """One Hylyre planned-action JSON step (no VLM)."""
    loop_cmd.run_action_json(
        payload_json=payload_json,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session,
    )


@run_app.command("tap")
def run_tap_step(
    payload_json: str = typer.Option(
        ...,
        "--json",
        "-j",
        help='Planned tap JSON, e.g. {"touch":{"by_text":"OK"}}',
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
) -> None:
    """One Hylyre planned tap JSON (no VLM)."""
    loop_cmd.run_tap_json(
        payload_json=payload_json,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session,
    )


@run_app.command("input")
def run_input_step(
    payload_json: str = typer.Option(
        ...,
        "--json",
        "-j",
        help='Planned input JSON, e.g. {"input":{"text":"hi","by_id":"x"}}',
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
) -> None:
    """One Hylyre planned input JSON (no VLM)."""
    loop_cmd.run_input_json(
        payload_json=payload_json,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session,
    )


@run_app.command("swipe")
def run_swipe_step(
    payload_json: str = typer.Option(
        ...,
        "--json",
        "-j",
        help=(
            'Planned swipe JSON, e.g. '
            '\'{"swipe":{"direction":"DOWN","distance":60}}\' '
            '(prefer swipe.area or --area-by-type Scroll on modal sheets)'
        ),
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
    area_by_type: Optional[str] = typer.Option(
        None,
        "--area-by-type",
        help="Merge swipe.area.by_type (often Scroll inside bottom-sheet).",
    ),
    area_by_text: Optional[str] = typer.Option(
        None,
        "--area-by-text",
        help="Merge swipe.area.by_text (overrides JSON area when set).",
    ),
    area_by_id: Optional[str] = typer.Option(
        None,
        "--area-by-id",
        help="Merge swipe.area.by_id (overrides JSON area when set).",
    ),
    area_by_key: Optional[str] = typer.Option(
        None,
        "--area-by-key",
        help="Merge swipe.area.by_key (overrides JSON area when set).",
    ),
) -> None:
    """One Hypium directional swipe JSON (no VLM)."""
    loop_cmd.run_swipe_json(
        payload_json=payload_json,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session,
        area_by_type=area_by_type,
        area_by_text=area_by_text,
        area_by_id=area_by_id,
        area_by_key=area_by_key,
    )


@run_app.command("scroll")
def run_scroll_step(
    payload_json: str = typer.Option(
        ...,
        "--json",
        "-j",
        help=(
            'Mouse-wheel scroll JSON, e.g. '
            '\'{"scroll":{"direction":"down","steps":5}}\' '
            'or add --at-by-type Scroll for modal lists'
        ),
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
    at_by_type: Optional[str] = typer.Option(
        None,
        "--at-by-type",
        help="Merge scroll.at.by_type (e.g. Scroll in bottom-sheet).",
    ),
    at_by_text: Optional[str] = typer.Option(
        None,
        "--at-by-text",
        help="Merge scroll.at.by_text (overrides JSON at when set).",
    ),
    at_by_id: Optional[str] = typer.Option(
        None,
        "--at-by-id",
        help="Merge scroll.at.by_id (overrides JSON at when set).",
    ),
    at_by_key: Optional[str] = typer.Option(
        None,
        "--at-by-key",
        help="Merge scroll.at.by_key (overrides JSON at when set).",
    ),
) -> None:
    """One Hypium mouse_scroll step (vertical; no VLM)."""
    loop_cmd.run_scroll_json(
        payload_json=payload_json,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session,
        at_by_type=at_by_type,
        at_by_text=at_by_text,
        at_by_id=at_by_id,
        at_by_key=at_by_key,
    )


@run_app.command("start-app")
def run_start_app_step(
    bundle: str = typer.Option(..., "--bundle", help="Application bundle id."),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
    page_name: Optional[str] = typer.Option(None, "--page-name"),
    params: str = typer.Option("", "--params"),
    wait_time: float = typer.Option(1.0, "--wait-time"),
) -> None:
    """start_app via Hypium (atomic CLI)."""
    loop_cmd.run_start_app_cli(
        bundle=bundle,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        page_name=page_name,
        params=params,
        wait_time=wait_time,
        session_file=session,
    )


register_tier_a_run_commands(run_app)


@app.command("screenshot")
def screenshot_cmd(
    out: Path = typer.Option(
        ...,
        "--out",
        "-o",
        help="Output image path (.jpeg or .png).",
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
) -> None:
    """Capture device screenshot via Hypium (no VLM)."""
    loop_cmd.run_screenshot_out(device_sn=device_sn, out=out, session_file=session)


@app.command("dump-ui")
def dump_ui_cmd(
    out: Path = typer.Option(
        ...,
        "--out",
        "-o",
        help="Output JSON path (Hypium UiTree / uitest dumpLayout).",
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
    filter_text: Optional[str] = typer.Option(
        None,
        "--filter-text",
        help="Regex; keep matching nodes and ancestor chains.",
    ),
    filter_id: Optional[str] = typer.Option(
        None,
        "--filter-id",
        help="Regex against element id.",
    ),
    filter_key: Optional[str] = typer.Option(
        None,
        "--filter-key",
        help="Regex against element key.",
    ),
    keep_clickable: bool = typer.Option(
        False,
        "--keep-clickable",
        help="Keep subtrees containing clickable=true nodes.",
    ),
    keep_scrollable: bool = typer.Option(
        False,
        "--keep-scrollable",
        help="Keep subtrees containing scrollable=true nodes.",
    ),
    max_depth: Optional[int] = typer.Option(
        None,
        "--max-depth",
        min=0,
        help="Clip UI tree depth from root.",
    ),
    keep_attrs: Optional[str] = typer.Option(
        None,
        "--keep-attrs",
        help="Comma-separated attribute names to add beyond minimal set.",
    ),
    prune_attrs: Optional[str] = typer.Option(
        None,
        "--prune-attrs",
        help="Comma-separated attribute names to remove from minimal output.",
    ),
    full: bool = typer.Option(
        False,
        "--full",
        help="Emit full Hypium attributes (disable minimal trimming).",
    ),
    summary: bool = typer.Option(
        False,
        "--summary",
        help="Flat text-bearing rows instead of tree (drops tree body).",
    ),
) -> None:
    """Dump UI hierarchy JSON for external agents (no VLM)."""
    kattrs = (
        frozenset(x.strip() for x in keep_attrs.split(",") if x.strip())
        if keep_attrs
        else frozenset()
    )
    pattrs = (
        frozenset(x.strip() for x in prune_attrs.split(",") if x.strip())
        if prune_attrs
        else frozenset()
    )
    spec = DumpFilterSpec(
        filter_text=filter_text,
        filter_id=filter_id,
        filter_key=filter_key,
        keep_clickable=keep_clickable,
        keep_scrollable=keep_scrollable,
        max_depth=max_depth,
        keep_attrs=kattrs,
        prune_attrs=pattrs,
        full=full,
        summary=summary,
    )
    loop_cmd.run_dump_ui_out(
        device_sn=device_sn, out=out, session_file=session, dump_filter=spec
    )


@app.command("find")
def find_elements_cmd(
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start`.",
    ),
    by_text: Optional[str] = typer.Option(None, "--by-text"),
    by_id_pattern: Optional[str] = typer.Option(None, "--by-id-pattern"),
    by_key_pattern: Optional[str] = typer.Option(None, "--by-key-pattern"),
    limit: int = typer.Option(
        50,
        "--limit",
        min=1,
        help="Max hits (default 50).",
    ),
) -> None:
    """Search live UI tree for matching nodes; prints JSON with hits + _hylyre_hints."""
    find_cmd.run_find_cli(
        device_sn=device_sn,
        session_file=session,
        by_text=by_text,
        by_id_pattern=by_id_pattern,
        by_key_pattern=by_key_pattern,
        limit=limit,
    )


@app.command("collect-list")
def collect_list_cmd(
    out: Optional[Path] = typer.Option(
        None,
        "--out",
        "-o",
        help="Optional JSON output path (default: stdout).",
    ),
    device_sn: Optional[str] = typer.Option(None, "--device-sn"),
    mock_port: Optional[int] = typer.Option(None, "--mock-port"),
    lyrebird_url: Optional[str] = typer.Option(None, "--lyrebird-url"),
    session: Optional[Path] = typer.Option(
        None,
        "--session",
        "-S",
        help="Session JSON from `hylyre session start` (reuse Hypium connection).",
    ),
    scroll_by_type: Optional[str] = typer.Option(
        None,
        "--scroll-by-type",
        help="Scroll/list container type match (default Scroll when omitted).",
    ),
    scroll_by_text: Optional[str] = typer.Option(
        None,
        "--scroll-by-text",
        help="Locate scroll container by substring of node text.",
    ),
    scroll_by_id: Optional[str] = typer.Option(
        None,
        "--scroll-by-id",
        help="Locate scroll container by id.",
    ),
    scroll_by_key: Optional[str] = typer.Option(
        None,
        "--scroll-by-key",
        help="Locate scroll container by key.",
    ),
    item_pattern: Optional[str] = typer.Option(
        None,
        "--item-pattern",
        help="Regex filter on id|key|text of Text rows.",
    ),
    max_scrolls: int = typer.Option(
        10,
        "--max-scrolls",
        min=1,
        help="Upper bound on swipe iterations.",
    ),
    swipe_distance: int = typer.Option(
        60,
        "--swipe-distance",
        min=1,
        help="Hypium swipe distance (UP) inside scroll area.",
    ),
    max_stable_rounds: int = typer.Option(
        2,
        "--max-stable-rounds",
        min=1,
        help="Stop after N consecutive dumps with no new Text rows.",
    ),
    reset_to_top: bool = typer.Option(
        False,
        "--reset-to-top",
        help=(
            "Before collecting, swipe DOWN inside the scroll area until the visible "
            "Text fingerprint stabilizes (helps when list position is unknown)."
        ),
    ),
    bidirectional: bool = typer.Option(
        False,
        "--bidirectional",
        help=(
            "After the UP pass, swipe DOWN and merge again until stable "
            "(captures rows above the starting viewport)."
        ),
    ),
    early_bounce_break: bool = typer.Option(
        True,
        "--early-bounce-break/--no-early-bounce-break",
        help=(
            "After a swipe, stop immediately if the next dump unchanged (edge bounce). "
            "Disable to require max-stable-rounds only (legacy)."
        ),
    ),
) -> None:
    """Swipe UP inside a scroll container and merge Text rows until stable."""
    collect_cmd.run_collect_list_cli(
        out=out,
        device_sn=device_sn,
        mock_port=mock_port,
        lyrebird_url=lyrebird_url,
        session_file=session,
        scroll_by_type=scroll_by_type,
        scroll_by_text=scroll_by_text,
        scroll_by_id=scroll_by_id,
        scroll_by_key=scroll_by_key,
        item_pattern=item_pattern,
        max_scrolls=max_scrolls,
        swipe_distance=swipe_distance,
        max_stable_rounds=max_stable_rounds,
        reset_to_top=reset_to_top,
        bidirectional=bidirectional,
        early_bounce_break=early_bounce_break,
    )


@device_app.command("list")
def device_list(
    first: bool = typer.Option(
        False,
        "--first",
        help="Print only the first device serial (for shell substitution); exit 1 if none.",
    ),
) -> None:
    """List HarmonyOS device targets via hdc."""
    device_cmd.run_device_list(first_only=first)


@device_app.command("install")
def device_install(
    hap: Path = typer.Argument(..., exists=True, dir_okay=False, readable=True),
    serial: Optional[str] = typer.Option(
        None,
        "--serial",
        "-t",
        help="Device serial (hdc -t); default first/only device.",
    ),
) -> None:
    """Install a .hap onto the device via hdc."""
    device_cmd.run_device_install(hap, serial)


@device_app.command("force-stop")
def device_force_stop(
    bundle: str = typer.Option(..., "--bundle", "-b", help="Application bundle id."),
    serial: Optional[str] = typer.Option(None, "--serial", "-t", help="Device serial."),
) -> None:
    """Force-stop app via positional ``aa force-stop <bundle>``."""
    device_cmd.run_device_force_stop(bundle=bundle, serial=serial)


@device_app.command("cold-restart")
def device_cold_restart(
    bundle: str = typer.Option(..., "--bundle", "-b", help="Application bundle id."),
    serial: Optional[str] = typer.Option(None, "--serial", "-t"),
    ability: Optional[str] = typer.Option(
        None, "--ability", "-a", help="Main Ability name for aa start."
    ),
    wait_time: float = typer.Option(
        1.0, "--wait-time", help="Seconds to wait after start."
    ),
) -> None:
    """Force-stop then start app (cold restart)."""
    device_cmd.run_device_cold_restart(
        bundle=bundle, serial=serial, ability=ability, wait_time=wait_time
    )


@report_app.command("verify")
def report_verify(
    report: Path = typer.Option(
        ...,
        "--report",
        exists=True,
        dir_okay=False,
        readable=True,
    ),
    trace: Path = typer.Option(
        ...,
        "--trace",
        exists=True,
        dir_okay=False,
        readable=True,
    ),
    plan: Optional[Path] = typer.Option(
        None,
        "--plan",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Optional; omit for ad-hoc incremental runs.",
    ),
) -> None:
    """Verify test-report.md + trace.json against Hylyre contracts."""
    run_cmd.run_report_verify(report=report, trace=trace, plan=plan)


@report_app.command("begin")
def report_begin(
    feature: str = typer.Option(..., "--feature", help="Feature slug for trace."),
    trace_out: Path = typer.Option(
        ...,
        "--trace-out",
        help="Incremental draft trace.json path.",
    ),
    plan_path: Optional[Path] = typer.Option(
        None,
        "--plan",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Optional reference plan path (metadata only).",
    ),
    model_backend: str = typer.Option(
        "none",
        "--model-backend",
        help="Draft trace model_backend field.",
    ),
) -> None:
    """Start incremental trace.json (draft schema) for agent-loop workflows."""
    run_cmd.run_report_begin(
        feature=feature,
        trace_out=trace_out,
        plan_path=plan_path,
        model_backend=model_backend,
    )


@report_app.command("record")
def report_record(
    trace_path: Path = typer.Option(
        ...,
        "--trace",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Draft trace.json from report begin.",
    ),
    case_id: str = typer.Option(..., "--case", help="Case id (用例编号)."),
    name: str = typer.Option(..., "--name", help="Case title."),
    priority: str = typer.Option(..., "--priority"),
    ac_ref: str = typer.Option(..., "--ac", help="关联 AC."),
    status: str = typer.Option(..., "--status", help="通过|失败|阻塞|跳过"),
    notes: str = typer.Option("", "--notes"),
) -> None:
    """Append one case row to incremental trace.json."""
    run_cmd.run_report_record(
        trace_path=trace_path,
        case_id=case_id,
        name=name,
        priority=priority,
        ac_ref=ac_ref,
        status=status,
        notes=notes,
    )


@report_app.command("finalize")
def report_finalize(
    trace_path: Path = typer.Option(
        ...,
        "--trace",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Draft trace.json with recorded cases.",
    ),
    report_out: Path = typer.Option(..., "--report-out"),
    trace_out: Path = typer.Option(..., "--trace-out", help="Final trace.json (L5 schema)."),
    plan_path: Optional[Path] = typer.Option(
        None,
        "--plan",
        exists=True,
        dir_okay=False,
        readable=True,
        help="Optional; verify IDs vs plan when set.",
    ),
    model_backend: Optional[str] = typer.Option(
        None,
        "--model-backend",
        help="Override trace model_backend for finalize.",
    ),
) -> None:
    """Render Markdown report + final trace.json and run L5 verify."""
    run_cmd.run_report_finalize(
        trace_path=trace_path,
        plan_path=plan_path,
        report_out=report_out,
        trace_write=trace_out,
        model_backend=model_backend,
    )


@app.command()
def doctor() -> None:
    """Check Python, Node, npm, hdc, mitmproxy readiness."""
    doctor_cmd.run_doctor()


@bootstrap_app.command("mock")
def bootstrap_mock(
    install: bool = typer.Option(
        False,
        "--install",
        help="Run pip install mitmproxy lyrebird into the current interpreter.",
    ),
) -> None:
    """Install common mock dependencies and show a subset of doctor checks."""
    bootstrap_cmd.run_bootstrap_mock(install=install)


mcp_app = typer.Typer(help="MCP server (P5)")
app.add_typer(mcp_app, name="mcp")


@mcp_app.command("serve")
def mcp_serve(
    show_banner: bool = typer.Option(
        False,
        "--show-banner",
        help="Print FastMCP startup banner (default off for host compatibility).",
    ),
    transport: str = typer.Option(
        "stdio",
        "--transport",
        help="Transport (only stdio is supported).",
    ),
) -> None:
    """Start MCP stdio server (FastMCP; requires: pip install 'hylyre[mcp]')."""
    if transport != "stdio":
        typer.secho(
            f"Only --transport stdio is supported (got {transport!r}).",
            err=True,
        )
        raise typer.Exit(code=2)
    try:
        from hylyre.mcp.server import serve_stdio
    except ImportError as exc:
        typer.secho(
            "FastMCP not installed. Run: pip install 'hylyre[mcp]'",
            err=True,
        )
        raise typer.Exit(code=2) from exc
    serve_stdio(show_banner=show_banner)


@ai_app.callback()
def ai_callback() -> None:
    """P1: structured tap/input. P3: natural language via HYLYRE_VLM_* + action/query/assert."""


@mock_app.callback()
def mock_callback() -> None:
    """Mock / Lyrebird: start daemon, activate groups, export flows."""


@mock_app.command("start")
def mock_start(
    mock_port: int = typer.Option(
        9090,
        "--mock-port",
        "-p",
        help="Port passed to `lyrebird --mock` (admin API base).",
    ),
    data: Optional[Path] = typer.Option(
        None,
        "--data",
        "-d",
        help="Mock data root for `lyrebird --data` (directory).",
    ),
    pid_file: Optional[Path] = typer.Option(
        None,
        "--pid-file",
        help="Where to store Lyrebird PID (default: ./.hylyre/lyrebird.pid).",
    ),
) -> None:
    """Start Lyrebird in the background (requires hylyre[mock])."""
    mock_cmd.run_mock_start(
        mock_port=mock_port,
        data=data,
        pid_path=pid_file,
    )


@mock_app.command("stop")
def mock_stop(
    pid_file: Optional[Path] = typer.Option(
        None,
        "--pid-file",
        help="PID file from `mock start` (default: ./.hylyre/lyrebird.pid).",
    ),
) -> None:
    """Stop Lyrebird using the PID file written by `mock start`."""
    mock_cmd.run_mock_stop(pid_path=pid_file)


@mock_app.command("status")
def mock_status(
    url: Optional[str] = typer.Option(
        None,
        "--url",
        help="Mock API base URL (default env HYLYRE_LYREBIRD_URL or http://127.0.0.1:9090).",
    ),
) -> None:
    """GET /api/status from a running Lyrebird."""
    mock_cmd.run_mock_status(base_url=url)


@mock_app.command("activate")
def mock_activate(
    group_id: str = typer.Argument(..., help="Mock group id (UUID)."),
    url: Optional[str] = typer.Option(
        None,
        "--url",
        help="Mock API base URL (or HYLYRE_LYREBIRD_URL).",
    ),
) -> None:
    """PUT /api/mock/{group}/activate."""
    mock_cmd.run_mock_activate(group_id, base_url=url)


@mock_app.command("deactivate")
def mock_deactivate(
    url: Optional[str] = typer.Option(
        None,
        "--url",
        help="Mock API base URL (or HYLYRE_LYREBIRD_URL).",
    ),
) -> None:
    """Deactivate all mock groups."""
    mock_cmd.run_mock_deactivate(base_url=url)


@mock_app.command("capture")
def mock_capture(
    output: Path = typer.Option(
        ...,
        "--output",
        "-o",
        help="Where to write JSON snapshot of /api/flow.",
    ),
    url: Optional[str] = typer.Option(
        None,
        "--url",
        help="Mock API base URL (or HYLYRE_LYREBIRD_URL).",
    ),
    full: bool = typer.Option(
        False,
        "--full",
        help="Fetch each /api/flow/{id} detail (slower).",
    ),
) -> None:
    """Export captured flows from Lyrebird to JSON (not strict HAR)."""
    mock_cmd.run_mock_capture(output=output, base_url=url, full=full)


@mock_app.command("push-ca")
def mock_push_ca(
    ca_cert: Optional[Path] = typer.Option(
        None,
        "--ca-cert",
        help="PEM path; default HYLYRE_MITM_CA or ~/.mitmproxy/mitmproxy-ca-cert.pem",
    ),
    serial: Optional[str] = typer.Option(
        None,
        "--serial",
        "-t",
        help="Device serial for hdc -t",
    ),
    remote: str = typer.Option(
        "/data/local/tmp/hylyre-mitm-ca.pem",
        "--remote",
        help="Destination path on device",
    ),
) -> None:
    """Push mitmproxy CA to device via hdc file send; then print install steps."""
    mock_cmd.run_mock_push_ca(ca_cert=ca_cert, serial=serial, remote=remote)


@mock_app.command("cert")
def mock_cert(
    ca_cert: Optional[Path] = typer.Option(
        None,
        "--ca-cert",
        help="Optional path to mitmproxy CA for copy/paste instructions.",
    ),
    serial: Optional[str] = typer.Option(
        None,
        "--serial",
        "-t",
        help="Optional device serial for hdc -t hints.",
    ),
) -> None:
    """Print HarmonyOS MITM trust checklist (see also mock push-ca)."""
    mock_cmd.run_mock_cert_instructions(ca_cert=ca_cert, serial=serial)


@ai_app.command("tap")
def ai_tap(
    device_sn: Optional[str] = typer.Option(
        None,
        "--device-sn",
        help="Device serial; omit to use hdc default device.",
    ),
    x: Optional[int] = typer.Option(None, "--x", help="Tap X (requires --y)."),
    y: Optional[int] = typer.Option(None, "--y", help="Tap Y (requires --x)."),
    by_text: Optional[str] = typer.Option(None, help="Tap component matching text."),
    by_id: Optional[str] = typer.Option(None, help="Tap component matching id/key."),
    wait_time: float = typer.Option(0.1, help="Hypium touch wait_time."),
) -> None:
    """Tap using coordinates or a single selector (hypium extra)."""
    ai_cmd.run_ai_tap(
        device_sn=device_sn,
        x=x,
        y=y,
        by_text=by_text,
        by_id=by_id,
        wait_time=wait_time,
    )


@ai_app.command("input")
def ai_input(
    value: str = typer.Argument(..., help="Text to input."),
    device_sn: Optional[str] = typer.Option(
        None,
        "--device-sn",
        help="Device serial; omit to use hdc default device.",
    ),
    by_text: Optional[str] = typer.Option(None, help="Target component matching text."),
    by_id: Optional[str] = typer.Option(None, help="Target component matching id/key."),
) -> None:
    """Type text into focused field or into a matched component (hypium extra)."""
    ai_cmd.run_ai_input(
        device_sn=device_sn,
        value=value,
        by_text=by_text,
        by_id=by_id,
    )


@ai_app.command("action")
def ai_action(
    instruction: str = typer.Argument(..., help="Natural-language UI step."),
    device_sn: Optional[str] = typer.Option(
        None,
        "--device-sn",
        help="Device serial; omit to use hdc default device.",
    ),
) -> None:
    """One VLM-planned action (requires HYLYRE_VLM_ENDPOINT and hypium extra)."""
    ai_cmd.run_ai_action(device_sn=device_sn, instruction=instruction)


@ai_app.command("query")
def ai_query(
    instruction: str = typer.Argument(..., help="What to read from the current screen."),
    device_sn: Optional[str] = typer.Option(
        None,
        "--device-sn",
        help="Device serial; omit to use hdc default device.",
    ),
    schema: str = typer.Option(
        "string",
        "--schema",
        help="Coerce answer: string | number | boolean",
    ),
) -> None:
    """VLM visual query; prints answer to stdout."""
    ai_cmd.run_ai_query(
        device_sn=device_sn,
        instruction=instruction,
        schema=schema,
    )


@ai_app.command("assert")
def ai_assert(
    instruction: str = typer.Argument(..., help="Condition that should hold on screen."),
    device_sn: Optional[str] = typer.Option(
        None,
        "--device-sn",
        help="Device serial; omit to use hdc default device.",
    ),
) -> None:
    """VLM assertion; exit code 3 on failure."""
    ai_cmd.run_ai_assert(device_sn=device_sn, instruction=instruction)


def main() -> None:
    app()


if __name__ == "__main__":
    main()

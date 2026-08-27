"""Register Tier A ``hylyre run <step>`` subcommands."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from hylyre.cli.commands import loop_cmd

# CLI subcommand name -> help example JSON
_TIER_A_RUN_SPECS: tuple[tuple[str, str], ...] = (
    ("back", '{"back":{}}'),
    ("home", '{"home":{}}'),
    ("stop-app", '{"stop_app":{"bundle":"com.example.app"}}'),
    ("clear-app", '{"clear_app":{"bundle":"com.example.app"}}'),
    ("wait", '{"wait":{"seconds":1.5}}'),
    ("wait-for", '{"wait_for":{"by_text":"钱包","timeout":10}}'),
    ("wait-gone", '{"wait_gone":{"by_text":"加载中","timeout":10}}'),
    ("wait-idle", '{"wait_idle":{"timeout":10}}'),
    ("assert-toast", '{"assert_toast":{"text":"操作成功","timeout":3}}'),
    ("scroll-to", '{"scroll_to":{"by_text":"招商银行","in":{"by_type":"List"},"tap":true}}'),
)


def _register_one(run_app: typer.Typer, cli_name: str, example: str) -> None:
    def _cmd(
        payload_json: str = typer.Option(
            ...,
            "--json",
            "-j",
            help=f"Planned JSON, e.g. '{example}'",
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
        loop_cmd.run_planned_step_json(
            payload_json=payload_json,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session,
        )

    run_app.command(cli_name)(_cmd)


def register_tier_a_run_commands(run_app: typer.Typer) -> None:
    """Attach Tier A atomic run subcommands to ``run_app``."""
    for cli_name, example in _TIER_A_RUN_SPECS:
        _register_one(run_app, cli_name, example)

    def run_start_app_planned_step(
        payload_json: str = typer.Option(
            ...,
            "--json",
            "-j",
            help=(
                'Planned start_app JSON, e.g. '
                '\'{"start_app":{"bundle":"com.example.app"}}\''
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
    ) -> None:
        """start_app as planned JSON (in-plan restart; distinct from ``run start-app``)."""
        loop_cmd.run_planned_step_json(
            payload_json=payload_json,
            device_sn=device_sn,
            mock_port=mock_port,
            lyrebird_url=lyrebird_url,
            session_file=session,
        )

    run_app.command("start-app-step")(run_start_app_planned_step)

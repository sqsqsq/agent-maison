"""Failure-boundary capture: screen evidence for a real root failure.

Protocol section 8.1 requires a root selector/assertion failure inside a live
device session to be backed by a screenshot or a UI dump — proof of *which
screen* the run was actually on when it failed, rather than a prose claim.

The obligation is deliberately narrow: one artifact group per root failure. It
never becomes per-step capture, never fires on a success path, and never
fabricates a file when the device cannot be read.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hylyre.api.outcome import ArtifactRef, artifact_from_file
from hylyre.diagnostic_log import diagnostic_log

#: Where failure-boundary artifacts land when an entry names no directory.
#: A run that cannot say *which screen* it failed on has incomplete evidence,
#: so "nobody configured a directory" must not become a reason to skip capture
#: — and must never be reported as a device/transport failure that never
#: happened. ``.hylyre/`` is the repo's existing local-state convention.
DEFAULT_FAILURE_DIR = Path(".hylyre") / "failures"


async def capture_failure_boundary(
    agent: Any,
    *,
    failure_dir: Path | str | None,
    label: str,
    relative_to: Path | str | None = None,
) -> tuple[list[ArtifactRef], str | None]:
    """Capture the failure boundary.

    ``relative_to`` is the directory the recorded ``path`` is relative to. For
    a run that writes a trace this is the trace file's directory, so a consumer
    resolves an artifact as ``dirname(trace_path) / path`` with no knowledge of
    the producer's working directory. When no trace is written (atomic/batch
    inline responses) the caller-supplied ``failure_dir`` is the base, since
    there is no trace for the path to be relative to.

    Returns ``(artifacts, error)``. An empty artifact list with an error is a
    truthful "capture unavailable" — the caller records that in a namespaced
    extension and the reducer marks the case evidence incomplete.
    """

    base = Path(failure_dir) if failure_dir is not None else DEFAULT_FAILURE_DIR
    path_base = Path(relative_to) if relative_to is not None else base
    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        diagnostic_log(f"failure_diag mkdir failed: {e!r}")
        return [], f"cannot create failure dir: {e}"

    safe = label.replace("/", "_").replace("\\", "_")
    artifacts: list[ArtifactRef] = []
    errors: list[str] = []

    dump_path = base / f"{safe}.json"
    try:
        payload = await agent.dump_ui()
        dump_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        artifacts.append(artifact_from_file("ui_dump", dump_path, base=path_base))
    except Exception as e:  # noqa: BLE001 - capture must never mask the failure
        diagnostic_log(f"failure_diag dump failed: {e!r}")
        errors.append(f"ui_dump: {e}")

    png_path = base / f"{safe}.png"
    try:
        raw = await agent.ui.screenshot()
        png_path.write_bytes(raw)
        artifacts.append(artifact_from_file("screenshot", png_path, base=path_base))
    except Exception as e:  # noqa: BLE001
        diagnostic_log(f"failure_diag screenshot failed: {e!r}")
        errors.append(f"screenshot: {e}")

    if artifacts:
        return artifacts, None
    return [], "; ".join(errors) or "capture produced no artifact"


async def capture_step_failure(
    agent: Any,
    *,
    failure_dir: Path | str | None,
    step_label: str,
) -> str:
    """Legacy note-string helper retained for the batch CLI's human output."""

    artifacts, _error = await capture_failure_boundary(
        agent, failure_dir=failure_dir, label=step_label
    )
    if not artifacts:
        return ""
    parts = [f"{a.kind}={Path(a.path).name}" for a in artifacts]
    return " failure_artifacts: " + ", ".join(parts)


__all__ = ["capture_failure_boundary", "capture_step_failure"]

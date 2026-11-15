"""Parse ``test-plan.md`` — 测试用例清单 table."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from hylyre.scenario.step_text import normalize_planned_step_text


@dataclass(frozen=True)
class TestCase:
    """One row of the 测试用例清单 table."""

    case_id: str
    name: str
    preconditions: str
    steps: str
    expected: str
    priority: str
    ac_ref: str


@dataclass(frozen=True)
class ParsedPlan:
    path: Path
    cases: tuple[TestCase, ...]


_SECTION_RE = re.compile(r"^\s*#{2,3}\s+(.+?)\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{3,}")


def parse_test_plan(path: Path | str) -> ParsedPlan:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    lines = text.splitlines()
    table_start: int | None = None
    for i, line in enumerate(lines):
        m = _SECTION_RE.match(line)
        if m and "测试用例清单" in m.group(1):
            for j in range(i + 1, len(lines)):
                if "|" in lines[j] and "---" not in lines[j]:
                    table_start = j
                    break
            break
    if table_start is None:
        raise ValueError(f"No 测试用例清单 table found in {p}")

    header_cells = _split_row(lines[table_start])
    if len(header_cells) < 7:
        raise ValueError(f"Expected 7 columns in test plan table, got {header_cells!r}")

    sep_idx = table_start + 1
    if sep_idx >= len(lines) or not _TABLE_SEP_RE.match(lines[sep_idx]):
        raise ValueError("Missing markdown table separator after header")

    cases: list[TestCase] = []
    for k in range(sep_idx + 1, len(lines)):
        row_line = lines[k].strip()
        if not row_line or not row_line.startswith("|"):
            break
        cells = _split_row(lines[k])
        if len(cells) < 7:
            continue
        case = TestCase(
            case_id=cells[0],
            name=cells[1],
            preconditions=cells[2],
            steps=cells[3],
            expected=cells[4],
            priority=cells[5],
            ac_ref=cells[6],
        )
        if case.case_id and not case.case_id.startswith("-"):
            cases.append(case)

    if not cases:
        raise ValueError(f"No test cases parsed from table in {p}")

    return ParsedPlan(path=p, cases=tuple(cases))


def _normalize_step_breaks(cell: str) -> str:
    """Replace legacy breaks in the step cell, leaving JSON string data intact."""
    result: list[str] = []
    depth = 0
    quoted = escaped = False
    at_start = True
    i = 0
    while i < len(cell):
        char = cell[i]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif cell.startswith("<br/>", i):
            result.append(" ")
            i += len("<br/>")
            continue
        elif depth:
            if char == '"':
                quoted = True
            elif char in "{[":
                depth += 1
            elif char in "}]":
                depth -= 1
        elif (
            at_start and cell[i:i + 4].lower() == "json"
            and "".join(result).rstrip().endswith("```")
        ):
            result.append(cell[i:i + 4])
            i += 4
            continue
        elif at_start and char == "{":
            depth = 1
            at_start = False
        elif char in ";；\r\n":
            at_start = True
        elif not char.isspace() and char != "`":
            at_start = False
        result.append(char)
        i += 1
    return "".join(result)


def _split_row(line: str) -> list[str]:
    raw = re.split(r"(?<!\\)\|", line.strip().strip("|"))
    cells: list[str] = []
    for index, cell in enumerate(raw):
        cell = cell.replace(r"\|", "|")
        if index == 3:
            cell = normalize_planned_step_text(_normalize_step_breaks(cell))
        else:
            cell = normalize_planned_step_text(cell.replace("<br/>", " "))
        cells.append(cell)
    return cells


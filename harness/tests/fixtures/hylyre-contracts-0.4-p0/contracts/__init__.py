"""Contract assets (schemas, protocol spec, decision table, golden fixtures).

This package is the single source of truth for the Hylyre output contracts and
ships as package-data with both the wheel and the plain-source release, so
downstream consumers can read and validate the protocol offline.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTRACTS_DIR = Path(__file__).resolve().parent
GOLDEN_DIR = CONTRACTS_DIR / "golden"
#: Schema-valid traces that the reducer/verifier MUST reject (cross-row rules).
CROSSROW_DIR = GOLDEN_DIR / "trace" / "invalid-crossrow"

OUTPUT_SCHEMA_PATH = CONTRACTS_DIR / "output-schema.json"
REPORT_SECTIONS_PATH = CONTRACTS_DIR / "report-sections.yaml"
STEP_OUTCOME_SPEC_PATH = CONTRACTS_DIR / "step-outcome-v1.md"
BUILDER_DECISION_TABLE_PATH = CONTRACTS_DIR / "builder-decision-table.md"
REFERENCE_REDUCER_PATH = CONTRACTS_DIR / "reference_reducer.py"

RESULT_PROTOCOL = "hylyre.step-outcome/1"
TRACE_SCHEMA_V1 = "0.4-p0"
LEGACY_TRACE_SCHEMAS = frozenset({"0.1-p0", "0.2-p4", "0.3-p0"})

#: golden fixture directory name -> JSON pointer of the schema node it targets.
GOLDEN_TARGETS: dict[str, str] = {
    "trace": "",
    "step": "/$defs/stepResultV1",
    "outcome": "/$defs/outcomeV1",
    "cause": "/$defs/causeV1",
    "reason": "/$defs/reasonV1",
    "observation": "/$defs/observationV1",
    "selector": "/$defs/selectorV1",
    "resolution": "/$defs/selectorResolutionV1",
    "artifact": "/$defs/artifactRef",
    "tool-call": "/$defs/toolCallV1",
    "case": "/$defs/caseResultV1",
    "pre-run-reject": "/$defs/pre_run_reject",
}


@lru_cache(maxsize=1)
def load_output_schema() -> dict[str, Any]:
    """Return the parsed ``output-schema.json`` document."""

    return json.loads(OUTPUT_SCHEMA_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def schema_validator(pointer: str = ""):
    """Return a validator for the whole schema or one ``$defs`` node.

    ``pointer`` is a JSON pointer relative to the schema root, e.g.
    ``"/$defs/stepResultV1"``.  References inside the node still resolve
    against the full document.
    """

    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    schema = load_output_schema()
    base = str(schema["$id"])
    resource = Resource(contents=schema, specification=DRAFT202012)
    registry = Registry().with_resource(base, resource)
    target: dict[str, Any] = {"$ref": f"{base}#{pointer}"} if pointer else {"$ref": base}
    return Draft202012Validator(target, registry=registry)


def validate_against(pointer: str, instance: Any) -> list[str]:
    """Return human-readable schema errors for ``instance`` (empty when valid)."""

    validator = schema_validator(pointer)
    return [
        f"{list(err.absolute_path)}: {err.message}"
        for err in sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    ]


__all__ = [
    "BUILDER_DECISION_TABLE_PATH",
    "CONTRACTS_DIR",
    "CROSSROW_DIR",
    "GOLDEN_DIR",
    "GOLDEN_TARGETS",
    "LEGACY_TRACE_SCHEMAS",
    "OUTPUT_SCHEMA_PATH",
    "REFERENCE_REDUCER_PATH",
    "REPORT_SECTIONS_PATH",
    "RESULT_PROTOCOL",
    "STEP_OUTCOME_SPEC_PATH",
    "TRACE_SCHEMA_V1",
    "load_output_schema",
    "schema_validator",
    "validate_against",
]

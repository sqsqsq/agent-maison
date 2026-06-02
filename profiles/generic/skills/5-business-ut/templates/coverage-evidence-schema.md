# coverage-evidence.json Schema（UT 覆盖证据）

> 路径：`doc/features/<feature>/ut/reports/coverage-evidence.json`
> **Skill 5 在存在 `ut_layer ∈ {unit, both}` 范围时须产出**；harness **不会**自造 `mappings[]`（仅校验，避免自证绿洞）。

## 何时必填

- **必填**：`acceptance.yaml` 中至少一条 `ut_layer ∈ {unit, both}` **且 `priority ∈ {P0, P1}`** 的 AC/BD。
- **mappings[] 必填**：对上述每条 P0/P1 scope，须有一行 `mappings[]`，且 `evidence_source` 须可追溯到 UT 标签、DAG `linked_*`（含 `nodes[]`）或 `ac-coverage.json` 的 `ut_covered: true`。
- **可省略或空文件 + `skip_reason`**：仅 device-only AC、仅 P2+ unit/both、或 profile 禁用 UT compile/run。

## Schema（JSON）

```json
{
  "schema_version": "1.0",
  "feature": "demo-feature",
  "primary_evidence_source": "dag_ephemeral",
  "sources": {
    "dag_archived": ["02-Feature/Demo/test/dag/foo.dag.yaml"],
    "dag_ephemeral": ["doc/features/demo-feature/ut/reports/flow-dag/foo.dag.yaml"],
    "ac_coverage": ["doc/features/demo-feature/ut/reports/ac-coverage.json"],
    "ut_tags": ["02-Feature/Demo/src/ohosTest/ets/test/demo.test.ets"]
  },
  "mappings": [
    {
      "scope_id": "AC-1",
      "scope_kind": "acceptance_criterion",
      "evidence_source": "ut_tags",
      "evidence_ref": "02-Feature/Demo/src/ohosTest/ets/test/demo.test.ets"
    }
  ],
  "skip_reason": null
}
```

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | string | 固定 `"1.0"` |
| `feature` | string | feature 名 |
| `primary_evidence_source` | enum | 本 feature 实际采用的**最高优先级**证据源 |
| `sources` | object | 各证据源路径列表 |
| `mappings` | array | AC/branch → 证据映射 |
| `skip_reason` | string? | allowlist 降级时填写 |

### `primary_evidence_source` / `mappings[].evidence_source`

`dag_archived` | `dag_ephemeral` | `ac_coverage` | `ut_tags`

**优先级**（高→低）：`dag_archived` > `dag_ephemeral` > `ac_coverage` > `ut_tags`

**DAG 追溯**：`linked_acceptance` / `linked_boundaries` 可在 DAG 顶层或 `nodes[]`（如 assertion 节点）声明。

**ac_coverage**：须对应 `ut/reports/ac-coverage.json` 中该 `scope_id` 的 `ut_covered: true`（harness UT 阶段写入）。

## 门禁语义（与 OpenSpec `ut-flow-dag-evidence` 对齐）

- in-scope `unit/both` P0/P1 **缺证据** → `ut_case_per_unit_ac` / `ut_coverage_evidence_resolves` **FAIL**，非静默 SKIP。
- SKIP 仅当：无 unit/both scope、profile 禁用 UT、或已登记兼容降级（`skip_reason`）。

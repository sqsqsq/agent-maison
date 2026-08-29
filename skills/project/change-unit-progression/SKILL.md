---
name: change-unit-progression
description: Validate and continuously execute canonical Change Units from an admitted App component blueprint, one Goal Mode Feature at a time. Use after P1 blueprint admission; do not use for P3 component closure.
---

# Change Unit progression

Use this Skill when a blueprint has an admitted canonical artifact. Canonical `change-unit@1` artifacts live in its evolution workspace: `<features_dir>/<blueprint_id>/<change_unit_id>/change-unit.yaml`（`<features_dir>` 默认 `doc/features`，经框架解析；CU 目录即该 CU 的 Feature 施工目录）。

**两段入口前提不同（M7）**：

| 段 | 入口前提 | 出口 |
|---|---|---|
| **设计准备段** | admitted blueprint；**canonical CU 数量为 0 合法** | decomposition provider 提临时候选 → consumer validator 校验后**原子**写出 1..N canonical CU → design gate/readiness。停在 selector 之前，不启动 Goal Mode |
| **施工段** | admitted blueprint **且 ≥1 canonical CU** | selector 选一个 ready CU → 既有 Goal Mode 单并发推进 → `ready_for_component_closure` |

设计准备段的入口放宽**不传导到施工段**：没有任何 canonical CU 时，selector 不选择、Goal Mode 不启动，推进决策返回 `design_preparation_required`（这是合法入口提示，不是故障）。设计准备段通常由 `/component-design` 编排入口调用；直接进入本 Skill 时同样适用。

> 真实宿主场景：选中 CU 前的准入与缺失输入三级路由见
> [真实宿主准入与回灌契约](../../reference/real-host-admission-and-feedback.md)。

## Authority and entry

- Run `check:change-unit`（`--blueprint <blueprint_id> --unit <change_unit_id>`）for each candidate before deriving readiness. A decomposition Provider may propose only temporary/in-memory candidates; only the consumer validator may accept a provenance-bearing canonical CU. Accepting a batch is atomic: any candidate failing schema, identity, design closure, provenance or source authority rejects the whole batch and writes nothing. Accepting a candidate whose canonical path already exists fails closed — correct an accepted unit with a new revising/superseding CU, never by re-accepting.
- Read CU intent, predicates, provides and design targets from the canonical artifact. Read component design from `component_blueprint_ref`; never copy either definition into a Feature.
- Derive the Feature identity from `(blueprint_id, change_unit_id)`：逻辑 id = `cu-` + base64url 编码，物理路径 = `<features_dir>/<blueprint_id>/<change_unit_id>`（经框架 SSOT 解析，不手工拼接）。`contracts.change_unit` contains only ID mappings; `contracts.state_management` remains the sole runtime-construction authority.
- `blueprint_id` 是路径键；`component_id` 只做所有权/一致性核验。requires/provides、carry-forward 与 ready set 全部限定同一 `blueprint_id` 工作区，跨工作区 CU（含同部件早期演进）不满足依赖。
- Resolve workflow track and expected phase chain from the existing workflow/track SSOT. Goal Mode events, receipts, evidence and verified feature completion remain execution truth.

## Progression

1. Re-derive completion (`ABSENT|VALID|STALE|INVALID`), current blueprint target admission, exact requires/provides, blocker probes and ready candidates from formal artifacts.
2. If an existing Goal Mode run is active, resume it and do not start another CU.
3. Otherwise select at most one ready CU by ascending numeric priority, then stable `change_unit_id`.
4. Hand Goal Mode the canonical CU path/ref/hash, blueprint ref and derived Feature id. After it returns, reread all facts before selecting again.
5. On failure, pause or awaiting-human, stop on that run. Do not create a P2 checkpoint or start a second CU.

Blueprint/CU identity drift makes unimplemented mappings and readiness stale. Preserve completed CU artifacts and Goal Mode history; carry completed provides forward only when every historical stable target still resolves and remains admitted in the current blueprint. Otherwise return to P1 reconciliation. Corrections to completed work use a new revising/superseding CU id.

## Boundaries

- Standalone Features without `change_unit_ref` keep their existing workflow and are not P2 errors.
- `ready_for_component_closure` is only a handoff to later P3 evaluation. Never create or claim component closure here.
- Do not add a registry, ledger, lock, daemon, semantic-diff/invalidates engine, dynamic Provider loader or second recovery authority.
- The first release assumes one main Agent/process. If multiple writers become a real requirement, stop and propose a separate change.

## REMOVED Requirements

### Requirement: Init gitignore includes feature goal-runs

**Reason**: 宿主 `.gitignore` 是宿主自己的 SCM 配置，不属于 Maison 发布件契约。init 不再读取、诊断、创建或修改它，`ensureCanonicalGitignore` 与 canonical host patterns（含 `doc/features/*/goal-runs/`）整体退场；`canonical-gitignore.ts` 一并删除。运行时产物边界仍由 `specs/runtime-artifact-policy.json` 单独承载（见 `framework-integrity` delta），与宿主是否忽略这些路径无关。

**Migration**: 宿主已有 `.gitignore` 内容保持原样，Maison 不迁移、不删除、不反向清理。宿主若希望忽略 `doc/features/*/goal-runs/` 等运行时输出，自行维护即可；这不再是 init 的任务，也不再是任何 Maison gate 的输入。

## MODIFIED Requirements

### Requirement: check-init probe phase is read-only

The init inspection harness MUST NOT perform filesystem writes during probe.
Writes previously done in check-init (deprecated cleanup, auto_overwrite sync)
MUST be delegated to init-orchestrate approved tasks.

check-init MUST NOT read, diagnose, create, or modify the host project's
`.gitignore` in any phase. The inspection table SHALL NOT contain a `.gitignore`
inspection row, and no replacement inspection, advisory, or always-SKIP
placeholder MAY be introduced for it. `check-init.ts` SHALL NOT import
canonical-gitignore helpers, expose `gitignore_sync` on its report, or export
gitignore parsing/coverage/advisory helpers from `__testing`.

#### Scenario: check-init probe does not write gitignore
- **WHEN** harness init phase runs against a project root without `.gitignore`
- **THEN** the probe completes without creating, reading, or modifying `.gitignore`,
  and the inspection table contains no `.gitignore` row at all

#### Scenario: No compatibility shell replaces the removed inspection
- **WHEN** the inspection table is enumerated after this change
- **THEN** it MUST NOT contain any inspection whose target is the host `.gitignore`,
  under the old index or any renamed/always-SKIP successor

> **Enforced by:** `harness/scripts/check-init.ts`,
> `harness/scripts/utils/init-task-planner.ts`

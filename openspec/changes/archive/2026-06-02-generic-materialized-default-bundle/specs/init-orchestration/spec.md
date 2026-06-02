## MODIFIED Requirements

### Requirement: S3 execution plan honors S2 materialized adapter selection

For `--execute` with `context.json`, the orchestrator MUST rebuild
`materialize-adapter:*` tasks from `materializedAdapters` or
`configWritePayload.materialized_adapters`. Readonly S1 probe MUST remain
unchanged when no context is supplied.

When `materialized_adapters` includes `generic` and project `paths` omits
`agent_bundle_root`, the orchestrator and executor MUST still materialize
`generic` using harness defaults (`.agents` / `inline`). Personal/local
`agent_adapter` MUST NOT cause generic to be dropped from the S3 plan or
blocked solely because bundle root is unset on disk.

#### Scenario: CREATE with context cursor materializes cursor not generic
- **WHEN** `prepareInitExecutionPlan` runs on an empty project root with
  context `materializedAdapters: ["cursor"]`
- **THEN** the plan MUST include `materialize-adapter:cursor` and MUST NOT
  include `materialize-adapter:generic`

#### Scenario: CREATE with two adapters materializes both
- **WHEN** context lists `["claude", "cursor"]`
- **THEN** the plan MUST include both `materialize-adapter:claude` and
  `materialize-adapter:cursor`

#### Scenario: claude+generic without agent_bundle_root materializes generic at default .agents
- **WHEN** context lists `materializedAdapters: ["claude", "generic"]` and
  `configWritePayload.paths` has no `agent_bundle_root`, and personal/local
  config has `agent_adapter: "claude"`
- **THEN** `prepareInitExecutionPlanWithStaleIds` MUST include
  `materialize-adapter:generic` and MUST NOT list it in `staleMaterializeTaskIds`
- **AND** executing `materialize-adapter:generic` MUST write bundle skills under
  `.agents/skills/` (default inline layout)

#### Scenario: Unknown decision task_id is rejected after reconcile
- **WHEN** `--execute` runs with a decision containing `totally-unknown-task`
  (not a stale `materialize-adapter:*` entry)
- **THEN** execution MUST fail validation and MUST NOT write project artifacts

#### Scenario: Non-stale materialize-adapter task_id is rejected
- **WHEN** `--execute` runs with a decision containing `materialize-adapter:evil`
  that is not in the S3 plan and not in the S1→S2 stale whitelist
- **THEN** execution MUST fail validation and MUST NOT write project artifacts

> **Enforced by:** `harness/scripts/utils/init-task-planner.ts`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/tests/unit/init-orchestrate.unit.test.ts`,
> `harness/tests/unit/init-task-executor.unit.test.ts`

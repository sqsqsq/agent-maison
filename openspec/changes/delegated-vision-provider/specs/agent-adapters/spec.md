## ADDED Requirements

### Requirement: A complete `visual_provider` declaration is the single source of provider support and eligibility

The adapter schema SHALL define an optional `visual_provider` object with the frozen shape
`{readonly_invoke, image_transport, stdout_envelope, model_replay}`. A declaration is **complete**
only when every one of those fields is present and valid.

Provider support and provider run-time eligibility SHALL be derived **solely** by scanning that field
across the adapter catalog. The framework SHALL NOT maintain a TypeScript adapter whitelist, SHALL
NOT intersect with or subtract from the model-pin adapter set, SHALL NOT infer eligibility from
adapter kernel family (a Claude-kernel fork without its own declaration is **not** eligible), and
SHALL NOT keep a hand-written support list in documentation. Help text, interactive prompts, CLI
validation and runtime routing SHALL all consume the same catalog-derived result.

The ordinary `goal_capability` block SHALL NOT participate in provider eligibility: the complete
`visual_provider` declaration alone carries the invoke, model-replay, image-transport and
stdout-envelope contract. An adapter MAY therefore be a provider without being materialized as a
project adapter and without a usable `goal_capability`.

The first batch SHALL declare `visual_provider` for `claude`, `codex`, `cursor` and `opencode` only.
`codeagent`, `chrys` and `generic` SHALL NOT declare it and SHALL NOT be usable as providers.

Each declaration SHALL be admitted only after a real invocation smoke run on the locked CLI version
proves the declared read-only isolation, model replay and image transport. Where a locked CLI does
not actually provide the declared isolation, the declaration SHALL NOT be admitted, and the provider
SHALL NOT fall back to the adapter's project-default configuration.

Enforcement: `agents/adapter-schema.yaml`, `agents/{claude,codex,cursor,opencode}/adapter.yaml`,
`harness/scripts/utils/adapter-catalog.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: a Claude-kernel fork is not admitted by family

- **WHEN** an adapter shares the Claude kernel and its argv builders but declares no `visual_provider`
- **THEN** it SHALL NOT appear in the derived support list and SHALL NOT be accepted as a provider

#### Scenario: eligibility survives an unusable goal capability

- **WHEN** an adapter carries a complete `visual_provider` declaration while its `goal_capability` is
  missing or invalid
- **THEN** it SHALL remain an eligible provider, because provider eligibility reads only the
  `visual_provider` declaration

#### Scenario: the support list has exactly one source

- **WHEN** the support list is rendered into a prompt, a CLI error, or validation logic
- **THEN** every rendering SHALL come from the catalog scan, and no second enumeration of adapter
  names SHALL exist in code or documentation

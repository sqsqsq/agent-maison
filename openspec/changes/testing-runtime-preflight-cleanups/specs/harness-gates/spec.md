## ADDED Requirements

### Requirement: A provider channel id must exist in the capability registry at plan time

`provider:<capability-id>` is a compile-time dispatch declaration, and its id SHALL be checked for **existence** in the capability registry when the execution-channel declaration is resolved — before any build, install, Hylyre, or device action — not after the run has finished. The registry is the active profile's declared `capabilities` map (`ctx.resolvedProfile.capabilities`). Both the declared id and every registry key are normalized with `normalizeCapabilityKey` (explicit alias table only) and MUST match by exact string equality: Maison SHALL NOT fold hyphen/underscore/dot variants, case, prefixes, or similarity into a match, because guessing a capability from its name is the same discipline violation as guessing a channel from case prose. A registered capability whose severity is `SKIP` exists for this check; whether it is usable remains the responsibility of capability resolution and the channel evidence obligation.

An unknown id SHALL make the declaration not closed (`ok=false`): `testing_execution_channel` SHALL FAIL as a `plan_contract` BLOCKER, the device pipeline SHALL NOT start, and the detail SHALL say that the capability does not exist in the registry so the case can never pass, name the registered capability keys (normalized, sorted; an empty registry is stated explicitly), and direct the author to change the channel or register the capability with a provider. Device-free report-only reconciliation SHALL still recompute in full. `parseExecutionChannel` remains a pure lexical parser and SHALL NOT read the profile; plans without provider cases SHALL be unaffected.

Enforcement: `harness/scripts/utils/execution-channel.ts`, `harness/scripts/check-testing.ts`

#### Scenario: An unregistered provider id blocks before any device action

- **WHEN** a top-level test case declares `execution_channel=provider:device-test.perf-probe` and the active profile registers no capability with that normalized key
- **THEN** `testing_execution_channel` SHALL FAIL with `failure_kind=plan_contract`, the detail SHALL list the registered capability keys, and no build, install, Hylyre, or device call SHALL be made

#### Scenario: A registered id passes the existence check without proving a result

- **WHEN** a case declares `provider:device_test.visual_diff` and the profile registers `device_test.visual_diff`, including with `severity: SKIP`
- **THEN** the declaration SHALL treat the id as existing and the case SHALL continue to be judged only by capability resolution and the channel evidence obligation

#### Scenario: A separator or case variant is not a match

- **WHEN** the plan declares `provider:device_test.visual-diff` or `provider:Device_Test.visual_diff` while the profile registers `device_test.visual_diff`
- **THEN** the id SHALL be treated as unknown and the declaration SHALL FAIL

#### Scenario: Report-only is not truncated by an unknown id

- **WHEN** `--report-reconcile-only` runs against a historical run whose top plan carries an unknown provider id
- **THEN** the run SHALL still recompute every report projection and keep the phase failing through the declaration BLOCKER alone

### Requirement: A Hylyre case may reset the app only with a leading stop_app→start_app preamble

Formal derived Hylyre plans compile in one shared device session and do not clear the navigation stack between cases. A case that needs a known starting state MAY begin with exactly one **reset preamble**: `{"stop_app":{"bundle":B}}` immediately followed by `{"start_app":{"bundle":B,"page_name":P}}`, placed at the head of the case. `B` and `P` SHALL equal the identity the harness itself uses for its pre-launch (the install candidate bundle name and the resolved Hypium page name) and SHALL be injected into the linter and the derive knowledge by the harness; the derive writer SHALL NOT invent them. The step linter SHALL reject a `start_app` without a directly preceding `stop_app`, a `stop_app` that is not closed by an immediately following `start_app`, any `start_app` or `stop_app` outside the case head, a second lifecycle group in the same case, a preamble whose bundle or page name differs from the harness identity, and a preamble whose identity cannot be resolved. The decision rule is deliberately simple: only step index 0 may be `stop_app` and only step index 1 may be `start_app`, and any `start_app`/`stop_app` root key at any other index is a STEP-003 BLOCKER — this is what makes the preamble exactly one and always paired. `clear_app` is not part of this preamble and SHALL NOT be added by the derive writer; the `action`-wrapped `start_app` form remains rejected. The adhoc steps path keeps its full `start_app` prohibition because the harness cold-restarts there. Runner-level pre-launch and cold restart behavior SHALL NOT change, and no screen state machine, reachability graph, or Hylyre teardown state machine SHALL be introduced.

Enforcement: `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/utils/hylyre-standard-derive-knowledge.ts`, `harness/scripts/utils/hylyre-planned-step-lint.ts`, `harness/scripts/check-testing.ts`

#### Scenario: A leading stop_app→start_app preamble compiles

- **WHEN** a `channel=hylyre` case begins with `stop_app` and `start_app` carrying the harness bundle and page name, followed by its business steps
- **THEN** the step linter SHALL report zero violations for the preamble, and NAV/STEP-SETUP rules SHALL treat it as a setup action

#### Scenario: start_app without stop_app is rejected

- **WHEN** a case begins with `start_app` and no directly preceding `stop_app`
- **THEN** compilation SHALL FAIL for that case with a STEP-003 BLOCKER

#### Scenario: stop_app without a closing start_app is rejected

- **WHEN** a case begins with `stop_app` and the next step is a business step or the case ends
- **THEN** compilation SHALL FAIL for that case with a STEP-003 BLOCKER

#### Scenario: A second reset preamble in the same case is rejected

- **WHEN** a case begins with `stop_app`, `start_app`, `stop_app`, `start_app`
- **THEN** compilation SHALL FAIL for that case, because at most one preamble is allowed and any lifecycle root key beyond index 0/1 is rejected

#### Scenario: A lifecycle step in the middle of a case is rejected

- **WHEN** `start_app` or `stop_app` appears after the first business step of a case
- **THEN** compilation SHALL FAIL for that case

#### Scenario: A preamble with a foreign identity is rejected

- **WHEN** the preamble's `bundle` or `page_name` differs from the harness pre-launch identity, or that identity cannot be resolved
- **THEN** compilation SHALL FAIL and the detail SHALL name the expected identity source

#### Scenario: The adhoc path still forbids start_app

- **WHEN** an adhoc steps file contains `start_app` in any position
- **THEN** the adhoc linter SHALL reject it as before

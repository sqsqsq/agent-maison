# runtime-policy Specification

## Purpose
TBD - created by archiving change verification-matrix. Update Purpose after archive.
## Requirements
### Requirement: evidence_profile config knob

`framework.config.json` MAY 声明顶层 `evidence_profile: strict|balanced`；缺省 MUST 为 strict 且行为与引入前逐一等值。`minimal` MUST NOT 是合法 config 值——它只能是 lite track 的求解结果。

#### Scenario: 缺省零变化
- **WHEN** 消费者 config 未声明 evidence_profile
- **THEN** 全部凭证按 strict（现状）求解，既有夹具零回归

#### Scenario: 全局声明 minimal 被拒
- **WHEN** config 写入 `evidence_profile: "minimal"`
- **THEN** config 校验 FAIL

> **Enforced by:** `specs/framework.config.schema.json`, `harness/config.ts`

### Requirement: Evidence matrix resolution

`resolveEvidencePolicy` MUST 按矩阵求解：full×strict 全 required；full×balanced（仅交互态）verifier 仅 {spec, coding} required（保留集 config 可覆写）、receipt required、trace optional；lite resolved=minimal——verifier off、receipt not_applicable、exit 脚本门禁 required。headless/goal MUST 恒按 strict 求解。

#### Scenario: balanced 交互态跳过 review 阶段 verifier
- **WHEN** interactive + full + balanced 下求解 review phase
- **THEN** verifier=off、receipt=required、脚本门禁=required

#### Scenario: goal-mode 无视 balanced
- **WHEN** goal-runner 驱动同一 feature（config 声明 balanced）
- **THEN** 全凭证按 strict required

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`

### Requirement: Anti-cheat red lines are outside the matrix

The `framework_integrity`, build-fingerprint binding, asset-crop source/bbox/tool/hash reproduction, process-input sanitization, and `diff_within_scope` checks SHALL remain outside runtime policy's tier matrix
and SHALL stay enabled. Legacy signer, confirmation, and halt-confirm quality credentials SHALL NOT be
runtime red lines or matrix inputs and MUST NOT lower the actual machine checks.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `profiles/hmos-app/harness/asset-crop-validation.ts`, `harness/tests/`

#### Scenario: legacy signer does not bypass crop reproduction

- **WHEN** a crop artifact has a legacy signer field but its current source/bbox reproduction fails
- **THEN** the crop gate SHALL fail independently of runtime tier and signer identity

### Requirement: Resolved phase chains expose ownership inputs without becoming an owner registry

Runtime policy SHALL expose the active full/lite/custom workflow phase set and order to the phase write-boundary resolver. Artifact ownership SHALL still come from phase-contract `produces` plus artifact/evidence resolvers, and source ownership SHALL still come from coding scope and profile-specific UT/testing resolvers. Runtime policy MUST NOT add a path-owner manifest, hard-code the canonical six phases, or grant a custom phase source ownership merely because it exists in the chain.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: lite workflow derives only its real nodes

- **WHEN** the active chain is `change → coding → exit`
- **THEN** owner/backtrack resolution SHALL use only those nodes and SHALL NOT invent spec, plan, review, UT, or testing targets

### Requirement: Runtime capability support and produced evidence are separate facts

Runtime policy/capability resolution SHALL determine provider/profile support before a phase invocation without reading current-run output evidence. Evidence produced after invocation SHALL be validated by the owning checker and MUST NOT mutate the immutable pre-check capability report. Unsupported capability projects capability-missing; declared support with missing or invalid output projects a checker failure.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/harness-runner.ts`

#### Scenario: current evidence cannot retroactively change capability

- **WHEN** a runtime provider declares step telemetry support but produces no observation file
- **THEN** the capability report SHALL remain `available` and testing SHALL report evidence FAIL rather than rewriting support to capability-missing

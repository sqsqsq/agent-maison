## MODIFIED Requirements

### Requirement: evidence_profile config knob

`framework.config.json` MAY 声明顶层 `evidence_profile: strict|balanced`；缺省 MUST 为 strict 且行为与引入前逐一等值。`minimal` MUST NOT 是合法 config 值；lite 已退役，阶段较少 MUST NOT 自动降低证据要求。

#### Scenario: 缺省零变化
- **WHEN** 消费者 config 未声明 evidence_profile
- **THEN** 全部凭证按 strict（现状）求解，既有夹具零回归

#### Scenario: 全局声明 minimal 被拒
- **WHEN** config 写入 `evidence_profile: "minimal"`
- **THEN** config 校验 FAIL

> **Enforced by:** `specs/framework.config.schema.json`, `harness/config.ts`

### Requirement: Evidence matrix resolution

旧协议的 `resolveEvidencePolicy` MUST 按矩阵求解：full×strict verifier/trace/exploration required、receipt not_applicable；full×balanced（**由 config 显式声明，任意 mode 生效**）verifier 仅 {spec, coding} required（保留集默认写死，config 字段未接线）、receipt not_applicable、trace optional、exploration required。

降档 MUST 只由 `config.evidence_profile` 触发，`ctx.mode` MUST NOT 参与求解：缺省（无该字段 / 显式 strict）时 interactive、headless、goal 三态输出逐一等值于 strict，声明 balanced 时三态输出同样逐一相同。`resolveProfileLabel` MUST 与 `resolveEvidencePolicy` 同判——档位标签写进 `evidence_policy_snapshot.profile_resolved` 与控制台，标签说 strict 而求解按 balanced 走会让宿主读到与实际不符的档位。

balanced 下两根轴的降档范围 MUST 分别陈述，不得合并成同一个 phase 集合：`verifier` 按保留集分流，故 plan / review / ut / testing 四个 feature phase 关闭；`trace` 无条件降 optional，对**全部六个** feature phase 生效，**含仍要求 verifier 的 spec / coding**。

`verifier=off` MUST 只免除"要求提供"，MUST NOT 免除已经存在的负面结论：当前 subject 已有一份验真通过（subject 回显匹配、verdict 与 blocker_count 自洽）且 verdict ≠ PASS 的 verifier 报告时，闭环 MUST 仍否决。报告缺席或为 PASS 时才是零要求。

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/config.ts`

#### Scenario: balanced 跳过 review 阶段 verifier

- **WHEN** full + balanced 下求解 review phase（interactive 或 goal 均可）
- **THEN** verifier=off、receipt=not_applicable、trace=optional、exploration=required，脚本门禁不受影响

#### Scenario: goal-mode 同样按声明的 balanced 求解

- **WHEN** goal-runner 驱动同一 feature 且 config 声明 `evidence_profile: balanced`
- **THEN** 求解结果与 interactive×balanced 逐一相同——保留集外 verifier=off、六个 feature phase 的 trace=optional，`profile_resolved` 记 `balanced`

#### Scenario: 保留阶段的 verifier 与 trace 范围不相等

- **WHEN** full + balanced 下求解 spec 或 coding phase
- **THEN** verifier=required 的同时 trace=optional——两根轴的降档范围 SHALL NOT 被当成同一个集合

#### Scenario: 关轴不免除已有的负面结论

- **WHEN** verifier 解析为 off，但当前 subject 已有一份验真通过的 verifier 报告且 verdict ≠ PASS
- **THEN** summary MUST 保留该 subject 与报告落点、证据状态记 `fail`，check-receipt MUST 仍记 `verifier_not_pass` BLOCKER；脚本门禁 PASS SHALL NOT 构成放行

### Requirement: Anti-cheat red lines are outside the matrix

The framework control-plane write boundary, build-fingerprint binding, asset-crop reproduction, process-input sanitization, and `diff_within_scope` SHALL remain outside runtime policy's evidence-tier matrix. The framework boundary SHALL be enforced by an out-of-model read-only principal where available, or represented honestly by the cooperative editing-tool guard where it is not.

Runtime policy SHALL NOT introduce or lower a framework Git dirty check, HEAD/commit identity, per-file manifest hashing, sidecar self-check, foreign-file scan, trust baseline, allowlist, or bypass. The guard's shell/script/external-process blind spots SHALL remain explicit at every tier. Legacy signer/confirmation fields SHALL not lower actual machine checks.

The runtime-artifact policy consumed by this boundary SHALL describe only Maison output and guard paths. It SHALL NOT derive host source-control configuration, and no tier SHALL gain a compensating detector that reads or writes the host `.gitignore`.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `agents/shared/guard-framework-write-core.mjs`, `harness/tests/unit/runtime-policy.unit.test.ts`

#### Scenario: Framework boundary does not depend on evidence tier

- **WHEN** an authorized narrowed workflow or relaxed evidence profile is active
- **THEN** the environment read-only boundary or cooperative editing-tool guard SHALL remain unchanged, and no Git/hash detector SHALL be added as a tier-independent fallback

#### Scenario: Legacy signer does not bypass crop reproduction

- **WHEN** a crop artifact has a legacy signer field but current source/bbox reproduction fails
- **THEN** the crop gate SHALL fail independently of runtime tier and signer identity

### Requirement: Resolved phase chains expose ownership inputs without becoming an owner registry

Runtime policy SHALL expose the validated execution scope's phase set and order (supported non-lite legacy full/custom chains only under their birth protocol) to the phase write-boundary resolver. Artifact ownership SHALL still come from phase-contract `produces` plus artifact/evidence resolvers, and source ownership SHALL still come from coding scope and profile-specific UT/testing resolvers. Runtime policy MUST NOT add a path-owner manifest, hard-code the canonical six phases, or grant a custom phase source ownership merely because it exists in the chain.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: Retired birth chains are not ownership input

- **WHEN** a historical frozen chain contains change or exit
- **THEN** entry SHALL diagnose the existing migration boundary before stage validation and SHALL NOT rewrite the chain or dispatch its nodes


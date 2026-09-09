# runtime-policy Spec Delta

## MODIFIED Requirements

### Requirement: Evidence matrix resolution

`resolveEvidencePolicy` MUST 按矩阵求解：full×strict verifier/trace/exploration required、receipt not_applicable；full×balanced（**由 config 显式声明，任意 mode 生效**）verifier 仅 {spec, coding} required（保留集默认写死，config 字段未接线）、receipt not_applicable、trace optional、exploration required；lite resolved=minimal——verifier off、receipt not_applicable、exit 脚本门禁 required。

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

### Requirement: Pure policy resolver set

policy 模块 MUST 提供核心纯函数 `classifyRequestRoute()`、`resolveFeatureTrack()`、`resolveEvidencePolicy()`、`resolvePhaseChain()`；判定集合可由后续 change 在同一模块扩展（C5 增 `resolveCorrectionTarget` / `classifyCorrection` / `resolveEnforcementTier`），扩展 MUST 同守纯函数与 default 等值不变式；`resolveEvidencePolicy` MUST NOT 执行文件 I/O（`provided` 属校验层事实，不在 policy 输出枚举内），输出限于 `required|optional|off|not_applicable`。

Enforcement: `harness/scripts/utils/runtime-policy.ts`

#### Scenario: 未声明降档时 headless/goal 仍 strict

- **WHEN** `runtimeContext.mode` 为 `headless` 或 `goal`，且 config **未**声明 `evidence_profile: balanced`
- **THEN** `resolveEvidencePolicy` 按 strict 求解——verifier=required、trace=required、exploration=required、**receipt=not_applicable**（strict 从来不是"全 required"）

#### Scenario: default 态与现状等值

- **WHEN** 无 feature.yaml、config 无 evidence 段、track 缺省 full
- **THEN** interactive、headless、goal 三态的求解结果逐一相同且与收编前硬编码行为等值

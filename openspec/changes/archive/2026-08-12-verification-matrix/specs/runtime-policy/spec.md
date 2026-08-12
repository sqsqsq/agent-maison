# Delta: Runtime Policy — evidence_profile 与证据矩阵

## ADDED Requirements

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

`framework_integrity`、视觉验真链（build 指纹绑定、asset_crop_validation、signed_by 自签拦截、进程注入自净）、`diff_within_scope`、goal halt-confirm 凭证链 MUST NOT 出现在矩阵求解输出中，MUST 恒开启，其恒开性 MUST 由单测断言。

#### Scenario: balanced 不豁免 diff_within_scope
- **WHEN** 任意 track × profile 组合运行 coding/exit
- **THEN** diff_within_scope 照常执行

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `harness/tests/`

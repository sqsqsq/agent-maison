# Delta: Init Orchestration — project_scale 判定

## ADDED Requirements

### Requirement: Init proposes project_scale with user confirmation

framework-init MUST 按 catalog 模块数（≤3）与代码量估算建议 `project_scale: small|standard`，经用户确认后写入 config；缺省（未声明）MUST 为 standard 且行为与引入前一致。确认点 MUST 登记 confirmation-registry。

#### Scenario: 单模块小工程建议 small
- **WHEN** init 扫描到 catalog 模块数 ≤3
- **THEN** 建议 small 档并停等用户确认，确认后写入 config

#### Scenario: 缺省零变化
- **WHEN** 消费者 config 无 project_scale 字段
- **THEN** 全部行为按 standard（现状）

> **Enforced by:** `skills/project/framework-init/SKILL.md`, `harness/scripts/utils/config-builder.ts`

### Requirement: phases_disabled union semantics

`config.phases_disabled` 与 profile `phases_disabled` MUST 取并集，由 profile-loader 与 C0 `resolvePhaseChain` 统一裁剪 phase set；small 档 MUST 默认将 `module-graph` 加入 config 禁用集（用户可移除）。

#### Scenario: small 档 module-graph 被裁剪
- **WHEN** small 档实例运行 `--phase module-graph`
- **THEN** runner 报该 phase 已按 scale 禁用

> **Enforced by:** `harness/profile-loader.ts`, `harness/scripts/utils/runtime-policy.ts`

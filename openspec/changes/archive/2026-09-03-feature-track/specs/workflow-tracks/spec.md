# Delta: Workflow Tracks — 分轨 schema 语义

## ADDED Requirements

### Requirement: Feature phase track membership is explicit for lite

workflow schema 1.1 中 `scope: feature` 的 phase 缺省 MUST 只属于 `["full"]`；lite 成员资格 MUST 显式标注 `tracks`。`scope: global` 的 phase 缺省对全 track 适用。

#### Scenario: fork workflow 新 phase 不漏入 lite
- **WHEN** fork workflow 新增未标注 `tracks` 的 feature phase
- **THEN** 该 phase 只出现在 full 链，lite 链不包含它

> **Enforced by:** `specs/workflow-schema.json`, `harness/workflow-loader.ts`

### Requirement: Per-track requires and auto_chain are explicit

同一 phase 在不同 track 下依赖不同时 MUST 用 `requires_by_track` 声明；存在 lite-only phase 的 workflow MUST 显式声明 `auto_chain_by_track.lite`。C0 `resolvePhaseChain` MUST 只做链与 DAG/tracks 的一致性校验，MUST NOT 隐式推导。

#### Scenario: coding 分轨依赖
- **WHEN** spec-driven workflow 下 lite track 解析 coding 的依赖
- **THEN** 得到 `[change]`（来自 requires_by_track.lite）而非 `[plan]`

#### Scenario: 缺显式 lite 链即 FAIL
- **WHEN** workflow 含 `tracks: ["lite"]` 的 phase 但缺 `auto_chain_by_track.lite`
- **THEN** loader 校验 FAIL，拒绝加载

> **Enforced by:** `harness/workflow-loader.ts`, `harness/scripts/utils/runtime-policy.ts`

### Requirement: Schema version 1.1 with 1.0 compatibility

workflow-loader MUST 同时接受 `schema_version: "1.0"`（全量视作 full 单轨，分轨字段出现即 FAIL）与 `"1.1"`。

#### Scenario: 旧 workflow 零变化
- **WHEN** 消费者实例仍用 1.0 workflow
- **THEN** 加载行为与升级前逐一等值

> **Enforced by:** `harness/workflow-loader.ts`

## MODIFIED Requirements

### Requirement: Feature phase track membership is explicit for lite

旧协议兼容读取中，workflow schema 1.1 中 `scope: feature` 的 phase 缺省 MUST 只属于 `["full"]`；lite 成员资格 MUST 显式标注 `tracks`。`scope: global` 的 phase 缺省对全 track 适用。

#### Scenario: fork workflow 新 phase 不漏入 lite
- **WHEN** 旧协议 fork workflow 新增未标注 `tracks` 的 feature phase
- **THEN** 该 phase 只出现在 full 链，lite 链不包含它

> **Enforced by:** `specs/workflow-schema.json`, `harness/workflow-loader.ts`

### Requirement: Per-track requires and auto_chain are explicit

仅在旧协议解析中，同一 phase 在不同 track 下依赖不同时 MUST 用 `requires_by_track` 声明；存在 lite-only phase 的 workflow MUST 显式声明 `auto_chain_by_track.lite`。C0 `resolvePhaseChain` MUST 只做链与 DAG/tracks 的一致性校验，MUST NOT 隐式推导。

#### Scenario: coding 分轨依赖
- **WHEN** 旧协议 spec-driven workflow 下 lite track 解析 coding 的依赖
- **THEN** 得到 `[change]`（来自 requires_by_track.lite）而非 `[plan]`

#### Scenario: 缺显式 lite 链即 FAIL
- **WHEN** 旧协议 workflow 含 `tracks: ["lite"]` 的 phase 但缺 `auto_chain_by_track.lite`
- **THEN** loader 校验 FAIL，拒绝加载

> **Enforced by:** `harness/workflow-loader.ts`, `harness/scripts/utils/runtime-policy.ts`

## ADDED Requirements

### Requirement: New requests compose obligations instead of selecting tracks

新协议 MUST 根据请求终点、未满足义务与有效事实确定执行范围；workflow 预设顺序 MUST NOT 自动成为全部必跑义务。新任务 MUST NOT 使用 change/exit 或要求用户选择 lite/full；fork/extension 未知职责 MUST 报 unknown 或缺口，不得默认为可跳过。项目级 Skill MUST 可在自身输入和授权满足时独立调用，不强制变成 Feature phase。

#### Scenario: Existing design supports a logic repair
- **WHEN** 正式需求已通过蓝图准入且验收/施工投影有效，仅需实现、审查和单元证据
- **THEN** 范围 MUST 可为 coding → review → ut，不补造 spec/plan/testing 或空报告

#### Scenario: Unknown extension obligation
- **WHEN** extension 声明无法解析的职责
- **THEN** 范围 MUST 保留 unknown 与责任方，MUST NOT 默认省略或自动执行未知阶段

> **Enforced by (planned P2/P6/P7):** `harness/scripts/utils/runtime-policy.ts`、
> `harness/workflow-loader.ts`、`workflows/spec-driven.workflow.yaml`；g1 仅建立规范。

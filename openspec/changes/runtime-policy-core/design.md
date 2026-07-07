# Design: Runtime Policy Core

## 模块形态

`harness/scripts/utils/runtime-policy.ts`——纯函数集合，无 I/O 副作用（feature.yaml / config 由调用方读入后传参）。所有运行时（runner / check-receipt / goal-runner / status / transition-policy）只消费该模块输出，不各自持有 phase 枚举或 evidence 判断。

## 四判定契约

```ts
type RequestRoute = 'direct' | 'feature';
type FeatureTrack = 'lite' | 'full';
type EvidenceLevel = 'required' | 'optional' | 'off' | 'not_applicable';

interface RuntimeContext {
  mode: 'interactive' | 'headless' | 'goal';
  adapter: string;
  phase: string;
  workflow: string;
  can_prompt_user: boolean;
  can_collect_usage: boolean;
}

interface EvidencePolicy {
  verifier: EvidenceLevel;
  receipt: EvidenceLevel;
  trace: EvidenceLevel;
  exploration: EvidenceLevel;
}
```

- `resolveEvidencePolicy`：`mode !== 'interactive'` 时强制按 strict 求解（headless/goal 不吃降档）；本 change 内 config 尚无 `evidence_profile` 段（C2 引入），默认恒 strict → 输出与现状等值。
- `resolvePhaseChain`：从 workflow YAML 的 `artifacts[]`（含 C1 引入的 `tracks`/`requires_by_track`/`auto_chain_by_track`，本 change 先按单轨 full 实现）计算合法 phase 集；对声明链与 DAG 做一致性校验，不做隐式推导。

## 枚举收编策略

- TS 侧：`type Phase` 改为 `string` + 运行时 `assertPhaseInWorkflow(phase, workflowSpec)`；`FEATURE_PHASE_ORDER` 由 `resolvePhaseChain` 输出替代（goal-runner 批量授权解析同源）。
- trace.schema.json：`phase.enum` 改 `pattern: "^[a-z][a-z0-9-]*$"`；语义合法性由 runner 写入前按 workflow 合法集校验（schema 只管形态，语义单点在 C0）。
- phase-alias（prd/design 旧名）保留映射表，但合法集来源改 workflow。

## Stop hook 跨进程快照

- runner 每次运行把 policy 快照写入 `.current-phase.json`：`{ policy_schema_version, track, evidence: {...} }`。
- 下发 hook（.mjs，独立进程、不 import harness）读快照：缺失 / `policy_schema_version` 不符 / 解析失败 → **按 full+strict 全凭证判定**（fail-closed）。降级路径专项夹具。
- 旧 state 文件（无快照字段）按 full+strict 解释，沿用既有 grace/ttl 治理，无 schema 破坏。

## 验收

- 契约单测：default（无 feature.yaml、无 evidence_profile、interactive/headless 各态）下四判定输出与现状硬编码行为逐一等值。
- `cd harness && npm test` 全绿（含全部既有 fixture 零改动）。

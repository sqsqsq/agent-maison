# Tasks: Runtime Policy Core

## 1. Policy 模块

- [ ] `runtime-policy.ts`：四判定纯函数 + RuntimeContext/EvidencePolicy 类型契约
- [ ] 契约单测：default 态四判定输出与现状逐一等值（interactive/headless/goal 三态）

## 2. 枚举收编

- [ ] check-receipt.ts：`VALID_PHASES`/`type Phase` → workflow 合法集校验
- [ ] phase-transition-policy.ts：`FeaturePhase`/`FEATURE_PHASE_ORDER` → resolvePhaseChain 输出
- [ ] trace.schema.json：phase enum → pattern；runner 写入前按 workflow 合法集校验
- [ ] compat-loader / backfill-context-exploration / context-exploration / exploration-strategy / goal-progress / phase-alias 同型枚举收编
- [ ] goal-runner / goal-monitor / goal-status 消费 resolvePhaseChain

## 3. Stop hook 快照

- [ ] runner 写 `.current-phase.json` policy 快照（含 `policy_schema_version`）
- [ ] check-phase-completion.mjs / record-verifier-report.mjs 读快照；缺失/版本不符 fail-safe 回 strict
- [ ] 旧 state（无快照）按 full+strict 解释；降级路径夹具

## 4. Verify

- [ ] `cd harness && npm test` 全绿（既有 fixture 零改动）
- [ ] `npm run openspec:validate`
- [ ] `npm run release:verify`

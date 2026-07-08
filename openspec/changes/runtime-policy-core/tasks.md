# Tasks: Runtime Policy Core

## 1. Policy 模块

- [x] `runtime-policy.ts`：四判定纯函数 + RuntimeContext/EvidencePolicy 类型契约
- [x] 契约单测：default 态四判定输出与现状逐一等值（interactive/headless/goal 三态；`runtime-policy.unit.test.ts` 11 case，含合成 lite workflow 新 phase 一等公民验证）

## 2. 枚举收编

- [x] check-receipt.ts：`VALID_PHASES`/`type Phase` → workflow 合法集校验（parseArgs 只查存在性，main 内 assertWorkflowFeaturePhase）
- [x] phase-transition-policy.ts：`FeaturePhase`→string、`FEATURE_PHASE_ORDER`→legacy 回退常量；validateFeatureChainDag/resolveAutoChain 全部改 workflow 派生序
- [x] trace.schema.json：phase enum → pattern；语义校验单点在 check-receipt（workflow 合法集）
- [x] compat-loader / backfill / context-exploration 运行时集合 / goal-progress / phase-alias（normalizePhaseId 放宽为 string 透传）收编；`CANONICAL_FEATURE_PHASES` 保留为唯一 legacy 回退 SSOT（设计内）；context-exploration/exploration-strategy 的编译期类型联合留待 C4 重定义（运行时集合已单源）
- [x] goal-runner / goal-monitor / goal-status 经 transition-policy 的 workflow 派生链消费（无残留字面量枚举，扫描确认）

## 3. Stop hook 快照

- [x] runner 写 `.current-phase.json` policy 快照（phase-state.mergeAndWritePhaseState 注入 buildPolicySnapshot，含 `policy_schema_version`）
- [x] check-phase-completion.mjs 增 readPolicySnapshot/policyRequires；缺失/版本不符 fail-safe 回 strict；receipt 判定经 policyRequires 分派（record-verifier-report.mjs 无闭环判定，无需接入）
- [x] 旧 state（无快照）按 full+strict 解释——既有 hook 全量测试（T1~T13，state 均无快照字段）即降级路径回归

## 4. Verify

- [x] `cd harness && npm test` 全绿（typecheck + 1484 单测【含本 change 11 case，review 修复后确认真实计入】+ 35 fixtures，既有 fixture 零改动）
- [x] `npm run openspec:validate`（31/31）
- [ ] `npm run release:verify`（随批次收尾统跑）

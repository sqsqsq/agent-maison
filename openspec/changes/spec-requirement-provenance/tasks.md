# Tasks — spec-requirement-provenance

映射 plan c8e5b3f1 t1（v8 定稿）。批 1 不碰 t2（blocked 投影 / mismatch 归因 / next_action 留给批 2）。

- [x] 1. `FidelityIntentSsot` 增可选 `requirement_provenance`（goal_manifest / explicit_cli / intent_fallback）；writer `writeFidelityIntentSsot` 必写入参；loader：缺字段=legacy 兼容、枚举非法=corrupt；不 bump `FIDELITY_INTENT_SCHEMA_VERSION`。
- [x] 2. 共享 `FidelityRoutingInitInput` 增必填 `requirementProvenance`；三调用点接线：goal-preflight `evaluateFidelityTierPreflight` 与 goal-runner vision 收紧重建传 `goal_manifest`；`fidelity-intent-init` CLI 只传 `explicit_cli`/`intent_fallback`。
- [x] 3. `fidelity-intent-init` 增 `--requirement-file`（与 `--requirement` 走共享 `resolveRequirementInput`）+ 局部空值预检（`--requirement ""`/`"   "` fail-fast，含 `--requirement "   " --requirement-file valid.txt` 组合例）。
- [x] 4. `derive.requirement` 候选链插入 fidelity-intent SSOT 段（valid ∧ explicit_cli ∧ 身份匹配）；新段依赖只绑 fidelity-intent.json path+sha256；intent_fallback/缺字段/corrupt/跨身份不解锁；宽泛文档不扫；三段全 absent 的 detail 列来源+两条修复路径。
- [x] 5. 单测：15 例（goal 零变化锁 / explicit_cli 解锁+依赖绑定 / intent_fallback·旧版·枚举非法·跨身份·corrupt·宽泛文档反例锁 / change.md 回归锁（含 SSOT 无条件绑定）/ **lite change 零变化回归锁** / 三段全无话术 / resolveRequirementInput 互斥+空文件 / CLI fail-fast 组合例 / 三调用点接线**行为断言**（goal-preflight + goal-runner 收紧重建 + CLI explicit/intent_fallback）/ 重签 SSOT 血缘（exists:false→true））。
- [x] 5'. review 跟进：SSOT 段只在 `options.phase==='spec'` 启用（lite change 纯 change.md 分支零变化）；goal-runner 行为断言同时验 execution_identity 重建；CLI 清理路径用 `detectRepoLayout(__dirname).projectRoot`。
- [x] 6. E2E：真实 harness-runner + fidelity-intent-init（不设 MAISON_GOAL_RUN_ID）——带需求 → summary PASS / capability resolved；不带需求（intent_fallback）→ INCOMPLETE / capability blocked / requirement absent；check-receipt 经 `slim_summary_not_pass` 拒非 PASS。
- [x] 7. 验收：`cd harness && npm test` 全绿（typecheck + unit 3193/0 + fixtures 44/44）；`node scripts/check-plan-version.mjs`、`npm run openspec:validate` 通过。
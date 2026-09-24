## 1. 实施

- [x] 1.1 `canProduceVerifierRequest` 的 BLOCKER SKIP 过滤认 `isCheckNotApplicable`（review / ut 两形态）。
- [x] 1.2 check-ut 已确认不适用的 19 处 BLOCKER SKIP 出口与 hmos-app coding host 两处出口打标。
- [x] 1.3 诊断 prompt 说明与 `harness/prompts/verify-ut.md` 例外句同步。

## 2. 验收

- [x] 2.1 资格判定正反例、真实 checker 出口打标正反例、prompt 两处承载断言。
- [x] 2.2 typecheck、目标套件、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`、全量 harness 测试。

归档随发布流程，不在本 change 的实施批内。

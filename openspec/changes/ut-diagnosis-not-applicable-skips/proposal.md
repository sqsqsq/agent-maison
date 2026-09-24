## Why

UT 产品断言失败回退 coding 的唯一候选 `ut_product_assertion_failure` 依赖诊断 verifier，而诊断资格把任何 BLOCKER SKIP 都当成"门禁没跑完"拒绝。宿主 UT 报告恒带 3 项"已确认不适用"的 BLOCKER SKIP（无 L3 记录、未导入 MockKit、无 characterization DAG），UT→coding 回退因此结构性不可达，只会同签名 no_progress 停机。

## What Changes

- 诊断资格复用既有 `CHECK_NOT_APPLICABLE_MARKER` / `isCheckNotApplicable`：带"已确认不适用"标注的 BLOCKER SKIP 不再挡诊断；未标注的 SKIP 照旧挡。标注只豁免 SKIP，不改变 BLOCKER FAIL 的既有判定。
- check-ut 与 hmos-app coding host 只给"已确认判据对象不存在"的 SKIP 出口打标；工件缺失/无效、上游已阻断、执行没跑成的出口不打标。status/severity/details 不变。
- 诊断 prompt 说明与 `verify-ut.md` 例外句同步改为"没有其它 BLOCKER FAIL，也没有未标注为已确认不适用的 BLOCKER SKIP"。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: 「A diagnosable product failure still issues a verifier request」的 SKIP 条件认已确认不适用标注。

## Impact

`harness/scripts/utils/verifier-plan.ts`、`harness/scripts/check-ut.ts`、`profiles/hmos-app/harness/coding-host-rules.ts`、`harness/scripts/utils/report-generator.ts`、`harness/prompts/verify-ut.md`。宿主 UT / coding PASS 报告的 `blocking_skips` 随打标缩小，next_action 回到正常闭环指令。不新增字段、协议或门禁。

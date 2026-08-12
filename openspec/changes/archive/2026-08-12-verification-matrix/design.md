# Design: Verification Matrix

## 证据矩阵（resolveEvidencePolicy 的求解表）

| track × profile | 脚本门禁 | LLM verifier | receipt | trace |
|---|---|---|---|---|
| full × strict | required（现状） | required（现状） | required（现状） | required（现状） |
| full × balanced（仅交互态） | required | {spec, coding} required，其余 off（config 可覆写保留集） | required（跨会话 resume 语义） | optional |
| lite（resolved=minimal） | exit 一次 required | off | not_applicable | optional |

- `evidence_profile` 只在 `runtimeContext.mode === 'interactive'` 时参与求解；headless/goal 一律按 strict。
- `minimal` 不是 config 合法值——它是 lite track 的求解结果（防用户全局声明 minimal 逃门禁）。

## 两层机读契约

```yaml
# receipt frontmatter / .current-phase.json 内 evidence_policy_snapshot
evidence_policy_snapshot:
  policy_schema_version: "1.0"
  profile_resolved: balanced         # strict | balanced | minimal
  items:
    verifier:  { policy: off,      validation_status: skipped_by_policy }
    receipt:   { policy: required, validation_status: provided }
    trace:     { policy: optional, validation_status: missing }   # optional+missing 不 FAIL
    exploration: { policy: required, validation_status: provided }
```

- check-receipt 对每个硬必需块先查 policy：`required` → 现有校验逻辑；`off`/`not_applicable` → 写 `skipped_by_policy`/`not_applicable` 不 FAIL；`optional` → 缺失仅 WARN。
- lite feature 整体：check-receipt 返回 exit 0 + 顶层 `not_applicable` 机读标注——Resume Gate 见此走 lite 闭环判据（exit 报告 + checkbox），绝不当 receipt-passed。

## closure 三态

`closure_status` 来源按 policy 分派：`receipt_passed`（full）/ `closed_by_exit_report`（lite）/ `open`。harness-runner :664 的 `receiptValidation?.status === 'passed'` 硬等改为查 C0 输出的 closure 判据；next_step（:776 `run_verifier_then_receipt`）按矩阵给出（balanced 下 verifier off 的 phase 直接 `fill_receipt`）。

## 不降档红线（单测锁死清单）

`framework_integrity`、视觉验真链（build 指纹绑定 / asset_crop_validation / signed_by 自签拦截 / 进程注入自净）、`diff_within_scope`、goal-mode halt-confirm 凭证链——这些检查的启用与 evidence_profile/track **解耦**，矩阵求解结果不得包含它们的开关。

## Fixtures

矩阵各象限契约夹具：full×balanced 保留集、headless 强制 strict、lite not_applicable + Resume Gate 判读、旧 state 无快照按 full+strict、optional+missing 仅 WARN。

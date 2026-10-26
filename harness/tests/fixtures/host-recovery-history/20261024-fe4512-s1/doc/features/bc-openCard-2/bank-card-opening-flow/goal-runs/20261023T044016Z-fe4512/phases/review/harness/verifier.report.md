| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| review_dimension_coverage | PASS | MAJOR | `review/review-report.md:69-75,156-229` 覆盖架构、接口、资源/规范、异常、功能与视觉；34 项 must-have 和 16 项结构声明均逐项列出，抽查源码承载一致。 |
| issue_accuracy | PASS | BLOCKER | CR-004 与实际占位图及 `plan/visual-parity.yaml:78-82` 一致；CR-005 对应 `BankCardSelectionPage.ets:40-45` 且违反 `spec/spec.md:223`；CR-006 对应两入口仅在显式关闭时设置 dismissing、系统消失只挂 `onDisappear` 的源码事实。 |
| fix_recommendation_actionable | PASS | MAJOR | `review/review-report.md:115-117` 三条建议均指出具体文件/生命周期或异常分支、修改方向和验证方式。 |
| false_positive_rate | PASS | MAJOR | 3 条未关闭问题均有代码或视觉产物依据；未发现已验证误报，误报率 0/3。 |
| blocker_threshold | PASS | BLOCKER | `review/review-report.md:133-141,234-242` 为 0 BLOCKER、1 个允许披露的 best-effort 视觉 MAJOR，结论“通过（保留非阻断债务）”符合规则。 |
| coding_rules_referenced | WARN | MINOR | `review/review-report.md:119` 仅追溯 CR-004，并称 CR-005/006 无 semantic rule；但 profile overlay 实有 `error_handling_completeness:369` 与 `business_logic_correctness:358`。 |
| reference_crosscheck | WARN | MAJOR | 抽查 `AddBankCardPage.ets:225-258,363,396`、`OtpVerificationSheet.ets:199-212`、搜索行设备 bbox 与视觉债务均属实；但报告 34 个仅写 basename 的 `文件:行` 无法从仓根直接解析，且 `review-report.md:25` 仍把“当前返修”写成 OTP，和本轮 CR-007 限界复审不一致。 |
| conventions_semantics | SKIP | MAJOR | `doc/conventions.md` 不存在，Harness `conventions_coverage` 亦明确判定本工程未启用惯例核对。 |

```issue-verification
- issue: CR-004
  verdict: confirmed
  repair_owner: coding
  evidence: result_payment_guide_placeholder.png | 发布前替换为具有手机屏幕、二维码和手持动作的近似原创插画，并在 testing 重新截图核对。
```

```yaml
verification_result:
  phase: "review"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:22:09.325Z"
  checks:
    - id: coding_rules_referenced
      status: WARN
      severity: MINOR
      details: |
        `doc/features/bc-openCard-2/bank-card-opening-flow/review/review-report.md:119`
        正确引用了 CR-004 的 `visual_parity_render` / `structure_declaration_ledger`，
        但称 CR-005/CR-006 在现行规则中没有 semantic rule。
        `framework/profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml:358`
        定义 `business_logic_correctness`，`:369` 定义
        `error_handling_completeness`，分别可追溯 CR-006 与 CR-005。
      suggestion: |
        由 review 报告责任方把规则追溯说明补为 profile overlay 的
        `error_handling_completeness` 与 `business_logic_correctness`；不改变问题定级或产品结论。
    - id: reference_crosscheck
      status: WARN
      severity: MAJOR
      details: |
        源码抽查确认 `AddBankCardPage.ets:225-258` 的 `searchRow()`、
        `:363/:396` 的两态消费、`OtpVerificationSheet.ets:199-212`
        的 OTP 响应式按钮均与报告一致；设备量测
        `measure-card_type_sheet.json` 也记录
        `background_search_bank=[48,454,1272,586]`。
        但 Harness 已提示 34 个 basename-only `文件:行` 无法按仓根解析。
        此外 `review-report.md:25` 仍写“当前返修只改变 OtpVerificationSheet”，
        与报告版本 v1.7 和本轮实际 CR-007 搜索行返修相反。
      suggestion: |
        由 review 报告责任方将源码引用改为仓根相对路径或“完整路径 + symbol”，
        并把审查范围首段更新为 CR-007 搜索行限界复审；无需重做已验证的代码审查。
    - id: conventions_semantics
      status: SKIP
      severity: MAJOR
      details: |
        `doc/conventions.md` 不存在，脚本报告的 `conventions_coverage`
        明确为 SKIP，因此本轮无工程惯例台账可供语义抽查。
      suggestion: |
        无需处理；若后续启用 `doc/conventions.md`，再按当时实际 diff 消费。
  summary:
    total: 8
    pass: 5
    fail: 0
    warn: 2
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 74587d84afdbb09b3a7ca9f25b108b0152c4f6e57f43c5882cff240757dd81a6
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

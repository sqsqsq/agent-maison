| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| review_dimension_coverage | FAIL | MAJOR | `spec/ui-spec.yaml:9-22,183-191,290-298,402-407` 共声明 34 个 P0 `must_have_elements`；`review/review-report.md:159-181` 仅逐项复核 16 条结构台账，未给出 must-have 全覆盖结论。 |
| issue_accuracy | PASS | BLOCKER | CR-004 由 `BankCardOpeningResultPage.ets:54-59`、`visual-parity.yaml:78-82` 及实际占位图确认；CR-005 对应 `BankCardSelectionPage.ets:40-45,153-187` 与 `spec.md:223`；CR-006 所述显式关闭状态路径见两入口页 `:63-111/:66-114`。 |
| fix_recommendation_actionable | PASS | MAJOR | `review/review-report.md:115-117` 三条建议均明确修改对象、方向及验证动作，可操作率 3/3。 |
| false_positive_rate | PASS | MAJOR | 核对 CR-004～CR-006 对应资源、源码和规约后未发现确定误报，误报率 0/3。 |
| blocker_threshold | PASS | BLOCKER | `review/review-report.md:124-132,188-197` 为 0 BLOCKER、1 条获准披露的 best-effort 视觉 MAJOR，结论“有条件通过”与规则一致。 |
| coding_rules_referenced | WARN | MINOR | `coding-rules.yaml:56-84` 可承接 CR-004 的视觉规则；CR-005/CR-006 的“异常处理/逻辑错误”未追溯到该文件中实际存在的具体规则 id，明确追溯率仅 1/3。 |
| reference_crosscheck | FAIL | MAJOR | `review/review-report.md:102-103` 引用的 `_adhoc/testing/reports/20261024-140337/.../trace.json` 与 `20261024-140906/.../trace.json` 均不存在；其余抽查的 coding summary、正式 testing UI 树和视觉债务引用存在且含义一致。 |
| conventions_semantics | SKIP | MAJOR | `doc/conventions.md` 不存在，按检查标准不适用。 |

```issue-verification
- issue: CR-004
  verdict: confirmed
  evidence: result_payment_guide_placeholder.png | 发布前替换为具有手机屏幕、二维码和手持动作的近似原创插画，并在 testing 重新截图核对。
```

```yaml
verification_result:
  phase: "review"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:05:51.527Z"
  checks:
    - id: review_dimension_coverage
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml:9-22、183-191、290-298、402-407
        对四个 P0 页面共声明 34 个 must_have_elements。review/review-report.md:159-181
        只逐项复核 structure-conformance.yaml 的 16 条结构声明，没有逐项覆盖或引用覆盖其余
        must-have，例如 background_add_bank_title、selection_next_btn、otp_next_btn、
        result_finish_btn。pixel_1to1 要求 must-have 全覆盖，当前视觉维度执行不完整。
      suggestion: |
        review 报告责任方在“视觉保真”中按 ui-spec 四个页面逐项列出全部 must_have_elements，
        为每项绑定当前源码或落盘证据并给出结论；可引用结构台账，但不能把 16 条结构声明当作
        34 条 must-have 的替代。
    - id: coding_rules_referenced
      status: WARN
      severity: MINOR
      details: |
        framework/specs/phase-rules/coding-rules.yaml:56-84 存在视觉保真与结构台账规则，可追溯
        CR-004；当前文件 semantic_checks 为空，报告也未为 CR-005、CR-006 指向实际存在的
        coding rule id。按当前规则文件计算，明确追溯仅 1/3，低于 70%。
      suggestion: |
        review 报告责任方为每条问题补充当前 coding-rules.yaml 中真实存在的规则 id；若异常处理
        和业务逻辑确无对应条目，应明确标注“无现行 coding rule，仅由 spec/acceptance 约束”，
        不要引用不存在的规则名。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/bank-card-opening-flow/review/review-report.md:102-103
        把 `_adhoc/testing/reports/20261024-140337/hylyre/trace.json` 和
        `_adhoc/testing/reports/20261024-140906/hylyre/trace.json` 作为 18/18、20/20 的关闭证据，
        但仓库中均不存在这两个路径。关键关闭证据无法按引用复核。
        相比之下，coding/reports/summary.json:942,945 和正式 testing
        `20261024T185039Z-266` 的失败 UI 树均能核到报告所述内容。
      suggestion: |
        review 报告责任方将两处 ad-hoc 引用改为当前仓库中可读取、可长期保留的真实证据路径；
        若证据未落盘，则删除完成步数断言，并把相应结论降为“缺少可复核证据”。
    - id: conventions_semantics
      status: SKIP
      severity: MAJOR
      details: |
        工程中不存在 doc/conventions.md，按本检查项规则跳过。
      suggestion: |
        无需处理；未来启用 conventions 台账后再执行语义核对。
  summary:
    total: 8
    pass: 4
    fail: 2
    warn: 1
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: ec6e47a87b35888569cda682263fb425f3378b0804dd9133e4ca301198fcbdc7
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| review_dimension_coverage | FAIL | MAJOR | `review/review-report.md:65-75` 未消费 `constraints/README.md:49-53` 的五个 review 域；且报告声明检查接口一致性，但 `contracts.yaml:192` 的 `@Prop candidate` 与 `OtpVerificationSheet.ets:15` 的 `openingService` 不一致。 |
| issue_accuracy | WARN | BLOCKER | CR-004、CR-005 有直接证据；CR-006 的源码确实缺少统一的消失前回调（`AddBankCardPage.ets:411-420`、`AllBanksPage.ets:280-289`），但尚无系统返回/下滑路径的运行证据。 |
| fix_recommendation_actionable | PASS | MAJOR | `review/review-report.md:111-113` 三项均指定文件、修改方向和验证动作。 |
| false_positive_rate | WARN | MAJOR | 3 项中 2 项 confirmed、0 项 refuted、1 项 unclear；CR-006 缺真实系统关闭路径复现，无法给出确定误报率。 |
| blocker_threshold | PASS | BLOCKER | `review/review-report.md:121-125,184-193` 为 BLOCKER=0、仅一个允许披露的 best-effort 视觉 MAJOR，结论“有条件通过”一致。 |
| coding_rules_referenced | PASS | MINOR | `review/review-report.md:111-113` 的视觉保真、异常处理、逻辑错误均对应预定义审查分类和业务/异常规则。 |
| reference_crosscheck | PASS | MAJOR | `coding/reports/summary.json:942`、两份 ad-hoc `trace.json:1-20` 与各自 18/20 步文件、`visual-parity.yaml:78-82`、`structure-conformance.yaml:4-68` 均与报告引用一致。 |
| conventions_semantics | SKIP | MAJOR | `doc/conventions.md` 不存在；Harness `conventions_coverage` 明确为 SKIP。 |

```issue-verification
- issue: CR-004
  verdict: confirmed
  evidence: result_payment_guide_placeholder.png | 发布前替换为具有手机屏幕、二维码和手持动作的近似原创插画，并在 testing 重新截图核对。
- issue: CR-005
  verdict: confirmed
  evidence: BankCardSelectionPage.ets | 捕获加载异常并增加明确空态；候选为空时保持下一步禁用并允许返回，不伪造候选。
- issue: CR-006
  verdict: unclear
  evidence: AddBankCardPage.ets, AllBanksPage.ets | 在两处 Sheet 生命周期开始消失时统一进入 dismissing 状态（采用当前 SDK 支持的 will-dismiss/will-disappear 回调），让所有关闭原因复用 pending 重开队列；补一条系统关闭后立即重开的设备用例。
```

```yaml
verification_result:
  phase: "review"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T18:19:59.411Z"
  checks:
    - id: review_dimension_coverage
      status: FAIL
      severity: MAJOR
      details: |
        `doc/extensions/knowledge/constraints/README.md:49-53` 要求 review 消费
        UX、SEC、DFX、COMPAT、ENV 五个域，但 `review/review-report.md:65-75`
        没有逐域结论。报告还声明检查了组件接口签名，而
        `contracts.yaml:192` 要求 OtpVerificationSheet 提供
        `@Prop candidate: BankCardCandidate`，当前
        `OtpVerificationSheet.ets:15` 改为持有 `openingService`，报告未披露该契约漂移。
      suggestion: |
        报告责任方补充五域 diff 审计结论，并把 OtpVerificationSheet 的契约漂移登记为
        接口不一致；由设计责任方判断修订 contracts 还是由 coding 恢复既有契约。
    - id: issue_accuracy
      status: WARN
      severity: BLOCKER
      details: |
        CR-004 由实际占位图、`ui-spec.yaml:545-551` 与
        `visual-parity.yaml:78-82` 共同确认。CR-005 由
        `BankCardSelectionPage.ets:40-45,140-220` 与 `spec.md:223` 确认。
        CR-006 的两个页面确实只在显式关闭/继续时设置 sheetDismissing，并仅在
        onDisappear 清理，但缺少系统返回、下滑等关闭方式下的运行时回调顺序证据。
      suggestion: |
        保留 CR-004、CR-005；CR-006 在正式 testing 覆盖系统关闭后立即重开，
        再据实改为 confirmed 或 refuted。
    - id: false_positive_rate
      status: WARN
      severity: MAJOR
      details: |
        已确认 CR-004、CR-005，未发现确定误报；CR-006 因缺系统关闭路径实测只能
        判 unclear，因此当前无法计算最终误报率。
      suggestion: |
        用设备用例补齐 CR-006 的系统返回/下滑关闭证据后重新计算。
    - id: conventions_semantics
      status: SKIP
      severity: MAJOR
      details: |
        `doc/conventions.md` 不存在，且 Harness 明确判定本工程未启用惯例核对。
      suggestion: |
        无需处理。
  summary:
    total: 8
    pass: 4
    fail: 1
    warn: 2
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 197275563cabe560b91d91f552afb864a8e217cb61fefb693393c4bc7f13b134
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

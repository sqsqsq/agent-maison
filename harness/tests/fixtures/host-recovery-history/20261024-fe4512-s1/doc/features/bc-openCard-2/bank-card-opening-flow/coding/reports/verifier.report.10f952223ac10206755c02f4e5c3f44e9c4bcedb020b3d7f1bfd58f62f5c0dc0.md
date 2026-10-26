| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/summary.json:99-105`：`coding_compile: PASS`、`can_claim_done: true`。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:42-181` 串联候选加载、选择门禁、OTP 与保存结果；`OpeningNavigationService.ets:7-15` 落实成功/失败清栈。 |
| error_handling_completeness | PASS | MAJOR | BD-1/2：`BankCardOpeningService.ets:66-115`、`OtpService.ets:26-83`；BD-3：`BankCardRepository.ets:151-169`；BD-4：`OtpVerificationSheet.ets:24-27,68-73`。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:86-144` 的接口与 `BankCardRepository.ets:151-174`、`BankCardOpeningService.ets:125-159`、`OtpService.ets:2-8`、`OpeningNavigationService.ets:6-15` 一致；模型字段见各 `data/model/*.ets`。 |
| component_props_consistency | FAIL | MAJOR | `contracts.yaml:187-199,200-208` 与 `OtpVerificationSheet.ets:7-17`、`BankCardOpeningResultPage.ets:5-12` 存在确定性 props 漂移。 |
| data_ownership_compliance | PASS | MAJOR | presentation 通过 service/repository 操作业务数据；RDB 仅位于 `BankCardRepository.ets:31-134`，账号 AppStorage 写入位于 `AccountService.ets:20-71`。 |
| simulation_data_isolation | PASS | MINOR | 银行与候选 mock 封装于 `BankRepository.ets:9-209`，页面只调用 repository/service，不读取 mock 标记。 |
| spec_acceptance_to_code | PASS | MAJOR | AC-1～AC-6 分别落实于 `AddBankCardPage.ets:63-112,422-457`、`BankCardSelectionPage.ets:24-85,141-243`、`OtpVerificationSheet.ets:19-116,165-212`、`BankCardOpeningResultPage.ets:14-84`、`WalletDestinationRegistry.ets:1-22`。 |
| reference_crosscheck | PASS | MAJOR | 路由常量经 `BankConstants` 被页面消费，宿主注册见 `Phone/pages/index.ets:24-41`；搜索节点与文案对应 `ui-spec.yaml:58-66`、`AddBankCardPage.ets:225-258`、`string.json:320-325`。 |
| visual_parity_backstop | WARN | MAJOR | `fidelity-intent.json:5-6` 为 `pixel_1to1/best_effort`；`ui-spec.yaml:450-458` 与 `BankCardOpeningResultPage.ets:54-59` 明示结果引导图仍是近似占位。 |
| visual_multimodal_parity | SKIP | MAJOR | 本轮 prompt 未注入 `context-images/` sidecar 像素文件，视觉多模态层降级。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:13:42.899Z"
  checks:
    - id: component_props_consistency
      status: FAIL
      severity: MAJOR
      details: |
        `contracts.yaml:192` 声明 OtpVerificationSheet 必须接收
        `@Prop candidate: BankCardCandidate`，但
        `OtpVerificationSheet.ets:7-17` 没有 candidate，改为接收未登记的
        `openingService: BankCardOpeningService`。
        `contracts.yaml:207` 声明结果页路由 prop 为
        `result: OpeningResult`，实际 `BankCardOpeningResultPage.ets:7-12`
        是 `@Prop routeParam: Object` 后强制转换。
        当前 service 注入被真实页面消费，产品流程证据充分，但组件契约尚未同步。
      suggestion: |
        由 plan/契约责任方确认现有统一 service 注入设计，并将 contracts.yaml 的
        OtpVerificationSheet 与结果页 props 更新为真实签名；若契约不可变，再由 coding
        调整组件签名，同时保持单一 opening session。
    - id: visual_parity_backstop
      status: WARN
      severity: MAJOR
      details: |
        `spec/reports/fidelity-intent.json:5-6` 表明本轮为 pixel_1to1、
        best_effort，故该残差不升级为 BLOCKER。
        `spec/ui-spec.yaml:450-458` 明确真实手持手机二维码插画尚未提供，
        当前仅允许中性占位；源码 `BankCardOpeningResultPage.ets:54-59`
        确实引用 `result_payment_guide_placeholder`。静态结构与颜色映射存在，
        但不能据此宣称最终视觉保真。
      suggestion: |
        发布前由视觉素材责任方提供真实结果引导插画，替换占位资源并执行设备视觉复核。
    - id: visual_multimodal_parity
      status: SKIP
      severity: MAJOR
      details: |
        本轮 prompt 没有注入 `context-images/` sidecar 像素文件，无法按要求逐图读取；
        视觉多模态层已降级。
      suggestion: |
        需要多模态结论时，由 harness 注入完整 sidecar 图片清单后重新执行该检查。
  summary:
    total: 11
    pass: 8
    fail: 1
    warn: 1
    blockers: 0
    verdict: PASS
```

```issue-verification
- issue: UP-001
  verdict: confirmed
  evidence: "coding/upstream-issues.md:1891-1893 的完整问题为：旧轮次曾报告 named_business_handler 解析异常；当前可读证据 coding/reports/script-report.json:1029-1035 显示该检查已为 PASS，因此本轮不再存在可交接的上游缺陷。原修复建议为：无需修改上游产物；保留历史关闭记录并以当前 harness 结果为准。实际核对 script-report.json:1029-1035 后确认 named_business_handler.status=PASS，关闭判断成立。"
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 10f952223ac10206755c02f4e5c3f44e9c4bcedb020b3d7f1bfd58f62f5c0dc0
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

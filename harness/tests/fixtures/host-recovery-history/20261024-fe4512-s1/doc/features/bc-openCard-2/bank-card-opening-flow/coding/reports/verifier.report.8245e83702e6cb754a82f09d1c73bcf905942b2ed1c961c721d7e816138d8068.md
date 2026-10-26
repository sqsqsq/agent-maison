| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/summary.json:103-104`：`can_claim_done: true`，`coding_compile: PASS`。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:42-181` 实现选型、候选、OTP、保存与结果阶段；`OtpVerificationSheet.ets:199-212` 以响应式 `otp` 控制提交按钮。 |
| error_handling_completeness | PASS | MAJOR | `OtpService.ets:30-80` 覆盖重发门禁/取消；`BankCardRepository.ets:151-169` 覆盖事务回滚与幂等回查；`OtpVerificationSheet.ets:101-116` 覆盖保存中门禁及失活结果抑制。 |
| interface_signature_consistency | FAIL | BLOCKER | `contracts.yaml:120-123` 声明 `sendMockCode(mobile: string)`，实现 `OtpService.ets:3` 为 `sendMockCode(_mobile: string)`；参数名未按接口契约一致。 |
| component_props_consistency | WARN | MAJOR | `contracts.yaml:187-199` 声明 `OtpVerificationSheet.candidate @Prop`，实际 `OtpVerificationSheet.ets:7-17` 通过注入 `openingService` 持有候选；`contracts.yaml:200-208` 的 `result` 路由参数实际为 `BankCardOpeningResultPage.ets:7-12` 的 `routeParam: Object` 后强转。 |
| data_ownership_compliance | PASS | MAJOR | `BankCardSelectionPage.ets:26-31` 仅组装 Repository/Service；RDB 操作封装于 `BankCardRepository.ets:31-174`。 |
| simulation_data_isolation | PASS | MINOR | 银行与候选 mock 均封装于 `BankRepository.ets:4-209`，presentation 仅调用 `getBanks/getCards`。 |
| spec_acceptance_to_code | PASS | MAJOR | AC-1/2/3/4/5/6 分别由 `CardTypeSheet.ets:14-150`、`BankCardSelectionPage.ets:40-237`、`OtpVerificationSheet.ets:19-212`、`BankCardOpeningService.ets:136-181`、`OpeningNavigationService.ets:7-15`、`WalletDestinationRegistry.ets:1-21` 承载。 |
| reference_crosscheck | WARN | MAJOR | `coding/upstream-issues.md:7` 引用脚本 `:1012-1018`，当前 `named_business_handler` 实际位于 `script-report.json:1029-1035`；组件 props 也存在上述契约定位漂移。 |
| visual_parity_backstop | PASS | MAJOR | 脚本 `visual_parity` 为 PASS；当前修复仅使 `OtpVerificationSheet.ets:199-207` 显式读取 `@State otp`，未改变既有结构、资源或色值映射。 |
| visual_multimodal_parity | SKIP | MAJOR | 视觉多模态层已降级（adapter 不支持图像）。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T18:58:32.014Z"
  checks:
    - id: interface_signature_consistency
      status: FAIL
      severity: BLOCKER
      details: |
        `doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml:120-123`
        将 OtpService.sendMockCode 的参数声明为 `mobile: string`；实际
        `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets:3`
        使用 `_mobile: string`。本检查明确要求参数名称与类型逐项一致，因此当前公共接口签名与契约不一致。
      suggestion: |
        coding owner 修改 `OtpService.ets`，将参数名恢复为 `mobile` 并以不改变本地假发送语义的方式消费该参数；
        随后重新运行真实编译与 coding harness。
    - id: component_props_consistency
      status: WARN
      severity: MAJOR
      details: |
        `contracts.yaml:187-199` 仍声明 `OtpVerificationSheet` 接收 `candidate @Prop`，
        实际 `OtpVerificationSheet.ets:7-17` 接收普通 `openingService`，候选由 service/session 持有。
        `contracts.yaml:200-208` 声明结果页 route param 名为 `result`，
        实际 `BankCardOpeningResultPage.ets:7-12` 为 `routeParam: Object` 后转换。
        当前调用链可工作，但组件契约描述与合法重组后的真实输入形态存在漂移。
      suggestion: |
        由 plan/contracts owner 在后续责任阶段核实并同步组件输入契约；本轮不要为了登记漂移回退已工作的业务编排。
    - id: reference_crosscheck
      status: WARN
      severity: MAJOR
      details: |
        `coding/upstream-issues.md:7` 将 named_business_handler 的证据定位到
        `script-report.json:1012-1018`，当前真实 PASS 记录位于
        `script-report.json:1029-1035`。实体结论仍成立，但行号已漂移。
        同时，contracts 中 OtpVerificationSheet/结果页 props 与当前实现存在上述定位漂移。
      suggestion: |
        更新问题表证据定位；由 contracts owner同步组件输入描述，避免后续审查继续依赖过期 props。
    - id: visual_multimodal_parity
      status: SKIP
      severity: MAJOR
      details: |
        视觉多模态层已降级（adapter 不支持图像）。
      suggestion: |
        继续由既定 delegated visual review 与 testing 真机视觉证据承担图像级验收。
  summary:
    total: 11
    pass: 7
    fail: 1
    warn: 2
    skip: 1
    blockers: 1
    verdict: FAIL
```

```issue-verification
- issue: UP-001
  verdict: confirmed
  evidence: coding/upstream-issues.md:7 的完整问题为“旧轮次曾报告 named_business_handler 解析异常；当前可读证据显示该检查已为 PASS，因此本轮不再存在可交接的上游缺陷”，修复建议为“无需修改；保留历史记录并以当前 harness 结果为准”。当前 script-report.json:1029-1035 确认 named_business_handler.status=PASS；仅原表中的 1012-1018 行号已漂移，不影响关闭结论。
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 8245e83702e6cb754a82f09d1c73bcf905942b2ed1c961c721d7e816138d8068
verdict: FAIL
blocker_count: 1
<!-- /maison-verifier-result:v1 -->

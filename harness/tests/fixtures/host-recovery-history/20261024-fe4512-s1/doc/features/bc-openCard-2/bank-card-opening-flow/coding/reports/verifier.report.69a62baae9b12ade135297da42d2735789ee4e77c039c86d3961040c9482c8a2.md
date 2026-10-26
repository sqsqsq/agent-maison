| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/summary.json:101-104`：`can_claim_done: true`、`coding_compile: PASS`；`script-report.json:1064`：工程级编译通过。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:54-63`、`OtpService.ets:23-80`、`BankCardRepository.ets:151-169`：保存结果映射、OTP 状态机及事务幂等链路与设计一致。 |
| error_handling_completeness | FAIL | MAJOR | `OtpVerificationSheet.ets:115-125` 保存异步执行；`BankCardSelectionPage.ets:225-233` 的 Sheet 未配置 dismissal 拦截，用户可在保存期间关闭，违背 BD-4。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:89-145` 声明的 Repository、Service、CompletionContext 类和方法均与对应源码签名一致。 |
| component_props_consistency | PASS | MAJOR | `contracts.yaml:165-201` ↔ `CardTypeSheet.ets:7-11`、`OtpVerificationSheet.ets:15-22`、`BankCardSelectionPage.ets:15-20`，声明的 props/state/events 均已实现。 |
| data_ownership_compliance | PASS | MAJOR | `OtpVerificationSheet.ets:116-119` 通过 Repository/Service 保存；presentation 未直接操作 RDB、文件系统或写入业务 AppStorage。 |
| simulation_data_isolation | PASS | MINOR | `BankRepository.ets:9-209` 封装银行及候选卡 mock；`AccountService.ets:39-47` 封装手机号 mock，presentation 不判断 mock 标记。 |
| spec_acceptance_to_code | FAIL | MAJOR | `acceptance.yaml:66-84,159-170` 要求提交后必达结果页且中途取消不得写库；当前保存期间可交互关闭，随后 `OtpVerificationSheet.ets:120-125` 丢弃已完成结果。 |
| reference_crosscheck | PASS | MAJOR | `contracts.yaml:353-362` 的 AC/BD→源码映射、`BankConstants` 路由常量及 `visual-parity.yaml:27-76` 的组件映射均可定位且含义一致。 |
| visual_parity_backstop | PASS | MAJOR | `script-report.json:1078`：`visual_parity` PASS；`visual-parity.yaml:27-76` 映射四个目标界面，源码使用对应语义色和必备 element id。 |
| visual_multimodal_parity | SKIP | MAJOR | 本轮 prompt 未注入 `context-images/` 像素文件或 sidecar 清单，无法形成逐图读图证据。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T16:54:40.471Z"
  checks:
    - id: error_handling_completeness
      status: FAIL
      severity: MAJOR
      details: |
        BD-4（acceptance.yaml:159-170）要求结果页之前的取消不写数据库；本轮 phase_delta
        （ai-prompt.md:8698）进一步明确“保存期间保持不可关闭”。

        OtpVerificationSheet.ets:115-119 设置 saving 后等待实际 Repository 保存，
        但 BankCardSelectionPage.ets:225-233 的 bindSheet 未注册 shouldDismiss/onWillDismiss。
        当前 SDK common.d.ts:15720-15746 明确：未注册 shouldDismiss 时，下拉、返回键、
        点击蒙层或关闭图标会立即关闭 Sheet。关闭触发 OtpVerificationSheet.ets:36-39，
        仅重置 UI 状态，不能取消已经开始的 Repository 写入；异步返回后
        OtpVerificationSheet.ets:120-125 因 isActive=false 丢弃 OpeningResult。
        因而可能出现“数据库已写入，但用户未进入结果页”的半途取消语义。
      suggestion: |
        由 coding 责任方在 BankCardSelectionPage 的 bindSheet 上增加 shouldDismiss/onWillDismiss
        拦截，并把子组件 saving 状态同步给父页面；saving=true 时保持 Sheet 打开，
        saving=false 时才调用 dismiss。保留现有 isActive 检查处理真正的页面销毁。
    - id: spec_acceptance_to_code
      status: FAIL
      severity: MAJOR
      details: |
        AC-4（acceptance.yaml:66-84）要求保存成功或失败均携带完整卡号和结果进入结果页；
        BD-4（acceptance.yaml:159-170）要求中途取消不写数据库。保存期间交互关闭后，
        Repository 仍可能完成提交，而 OtpVerificationSheet.ets:120-125 会丢弃结果，
        两项验收不能同时成立。
      suggestion: |
        复用上述 Sheet dismissal 门禁修复，并验证保存成功、保存失败及保存中下拉/返回/点蒙层
        三类路径：前两类必须进入结果页，保存中交互关闭必须被拒绝。
    - id: visual_multimodal_parity
      status: SKIP
      severity: MAJOR
      details: |
        视觉多模态层已降级：本轮上下文未提供可由读图工具打开的 context-images 像素文件及
        sidecar 清单；ui-spec.yaml:2 仍为 verified: unverified。
      suggestion: |
        在后续 device visual_diff/testing 阶段注入四屏原图并逐屏核对布局、主题色、真实资产与文案。
  summary:
    total: 11
    pass: 8
    fail: 2
    warn: 0
    blockers: 0
    verdict: PASS
```

```issue-verification
- issue: UP-001
  verdict: confirmed
  evidence: "问题描述：旧轮次曾报告 named_business_handler 解析异常；当前可读证据 coding/reports/script-report.json:1012-1018 显示该检查已为 PASS，因此本轮不再存在可交接的上游缺陷。涉及文件：framework/profiles/hmos-app/harness/named-handler.ts。修复建议原文：无需修改；保留历史记录并以当前 harness 结果为准。实际判断：当前 script-report 的 named_business_handler 状态确为 PASS，关闭结论成立。"
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 69a62baae9b12ade135297da42d2735789ee4e77c039c86d3961040c9482c8a2
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

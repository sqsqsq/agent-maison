| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/summary.json:101-104`：`can_claim_done: true`、`coding_compile: PASS`。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:7-40`、`BankCardRepository.ets:47-76`、`OpeningNavigationService.ets:7-15` 实现脱敏、校验、幂等保存及成功/失败清栈。 |
| error_handling_completeness | PASS | MAJOR | `OtpVerificationSheet.ets:90-107`、`BankCardRepository.ets:47-76`、`AddBankCardPage.ets:347-381` 覆盖 BD-1 至 BD-4 的输入门禁、写库失败映射及瞬态清理。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:86-144` 与各 Repository/Service/Context 的方法参数及返回类型一致。 |
| component_props_consistency | FAIL | MAJOR | `contracts.yaml:200-208` 声明结果页 route prop 为 `result: OpeningResult`；`BankCardOpeningResultPage.ets:5-12,88-90` 实际为 `routeParam: Object` 并强制转换。 |
| data_ownership_compliance | PASS | MAJOR | `BankCardCandidate.ets:6-12`、`BankCardOpeningCompletionContext.ets:1-17`、`HomeTabPage.ets:35-42`：完整卡号仅在后台模型、RDB 与一次性交接链流转，未渲染或记录日志。 |
| simulation_data_isolation | PASS | MINOR | `BankRepository.ets:9-209` 与 `OtpService.ets:1-5` 均使用本地 mock 数据，无网络调用。 |
| spec_acceptance_to_code | PASS | MAJOR | `acceptance.yaml:5-169` 的 AC-1..AC-6、BD-1..BD-4 分别落在双入口 Sheet、选卡页、OTP、RDB、结果页和宿主路由实现中。 |
| reference_crosscheck | PASS | MAJOR | `Phone/pages/index.ets:23-37`、`WalletMain/index.ets:11-17` 与 `BankConstants.ets` 的新增路由和跨模块 builder 接线一致。 |
| visual_parity_backstop | WARN | MAJOR | `fidelity-intent.json:3-7` 为 `pixel_1to1 + best_effort + approximate`；`visual-parity.yaml:78-98` 明确保留结果插画和盲档视觉债务。 |
| visual_multimodal_parity | WARN | MAJOR | 四张参考图已读取；`BankCardOpeningResultPage.ets:54-59` 使用的占位图与参考图中的手机、二维码及手部插画明显不同。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T16:24:36.645Z"
  checks:
    - id: component_props_consistency
      status: FAIL
      severity: MAJOR
      details: |
        contracts.yaml:200-208 将 BankCardOpeningResultPage 的路由参数声明为
        `result: OpeningResult`；实际源码 BankCardOpeningResultPage.ets:7 使用
        `@Prop routeParam: Object`，并在 10-12 行以类型断言转换。实现依赖运行时
        调用方传入正确对象，未按组件契约暴露具名、强类型的 result prop。
      suggestion: |
        由编码责任方将组件改为 `@Prop result: OpeningResult`，并在
        buildBankCardOpeningResultPage 中将路由 Object 校验/转换后赋给 result；
        或由设计责任方在确认该通用路由适配形态为权威约定后修订 contracts.yaml。
    - id: visual_parity_backstop
      status: WARN
      severity: MAJOR
      details: |
        spec/reports/fidelity-intent.json:3-7 明确为 pixel_1to1、best_effort、
        approximate；plan/visual-parity.yaml:78-98 又登记结果插画 major 债务及
        四屏 bbox、间距、字重待截图核验。当前静态源码足以确认节点和语义色接线，
        但不足以证明像素保真。
      suggestion: |
        发布前替换结果页占位插画，并使用真机四屏截图完成几何和字体对照。
    - id: visual_multimodal_parity
      status: WARN
      severity: MAJOR
      details: |
        已直接读取四张参考图并对照实现。前三屏的主要结构与源码一致；结果页参考图
        包含绿色成功图标、手机二维码和手部插画，而源码
        BankCardOpeningResultPage.ets:54-59 渲染
        result_payment_guide_placeholder.png；该资源实际是灰色抽象占位图。
        此差异已在 visual-parity.yaml:78-82 登记为 major 视觉债务，且严格度为
        best_effort，故本轮记 WARN，不升级为 BLOCKER。

        ```read-image-evidence
        - file: 3-点击任意银行拉起添卡选卡半模态.jpg
          observation: 灰色遮罩上的底部半模态，含标题、关闭按钮、银行卡片、储蓄卡/信用卡单选、协议和蓝色继续按钮。
        - file: 4-点击信用卡或储蓄卡后拉起选卡页面.jpg
          observation: 全屏银行选卡页，含银行标题、脱敏卡号、红色单选/协议状态和居中的红色下一步按钮。
        - file: 5-选中某张卡片后拉起短信验证.jpg
          observation: 验证码半模态包含脱敏手机号、数字输入、倒计时重试按钮、置灰全宽下一步按钮及系统数字键盘。
        - file: 6-短信验证完成后结果页.jpg
          observation: 无标题栏结果页，含绿色成功图标、添卡成功文案、手机二维码与手部插画、NFC 区域和底部完成按钮；NFC 区域已被需求明确排除。
        ```
      suggestion: |
        由视觉资产责任方提供或裁切可信的结果引导插画，替换
        result_payment_guide_placeholder.png；随后以真机截图复核四屏布局。
  summary:
    total: 11
    pass: 8
    fail: 1
    warn: 2
    blockers: 0
    verdict: PASS
```

```issue-verification
- issue: UP-001
  verdict: refuted
  evidence: "coding/upstream-issues.md:5 原问题称 named-handler.ts:108 对合法数组 calls 无条件执行 ua.calls.split(...)，建议 Maison 同时接受字符串数组与兼容字符串并重跑 harness。当前 framework/profiles/hmos-app/harness/named-handler.ts:107-112 已通过 `for (const call of ua.calls ?? [])` 逐项处理数组，再对单个 call 执行 split；本轮脚本报告同时将 named_business_handler、coding_compile 和 coding_run_status 列为 PASS。因此所述当前唯一 BLOCKER 已不成立，上游问题表状态已过时。"
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 078c78c840dab1e2a1241bc6692f9c0345466120c0b7ffafa71b1e5b2aa8b5d7
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/ai-prompt.md:1575-1612`：Harness `fail=0`、`blockers=0`、`verdict=PASS`，且 `coding_compile`、`coding_run_status` 均列入 passed_check_ids。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:42-181` 实现 ENTRY→TYPE_SELECTED→CARD_SELECTED→OTP_ACTIVE→SAVING→RESULT，候选加载、OTP 门禁、保存成功/失败结果均由同一真实协调入口驱动。 |
| error_handling_completeness | PASS | MAJOR | `BankCardRepository.ets:151-169` 事务失败回滚且避免重复卡半写；`BankCardOpeningService.ets:161-181` 将不可用/保存异常映射为失败 `OpeningResult`；`OtpVerificationSheet.ets:24-27,68-73` 关闭时停止计时并清理 OTP。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:86-144` 的 repository/service/context 方法与 `BankCardRepository.ets:151-174`、`BankCardOpeningService.ets:125-181`、`OtpService.ets:2-5`、`OpeningNavigationService.ets:6-15`、`BankOpeningCompletionContext.ets:2-17` 对齐。 |
| component_props_consistency | FAIL | MAJOR | `contracts.yaml:187-207` 声明 `OtpVerificationSheet.@Prop candidate` 与结果页 `result` 路由属性；源码 `OtpVerificationSheet.ets:13-15` 改为回调和 `openingService` 注入且无 `candidate`，`BankCardOpeningResultPage.ets:7-11` 使用 `routeParam`。 |
| data_ownership_compliance | PASS | MAJOR | `BankCardOpeningCompletionContext.ets:3-16` 单次 publish/consume/clear；`HomeTabPage.ets:30-42` 首页消费成功卡号；`OpeningResultPage.ets:31-47` 未渲染完整卡号。 |
| simulation_data_isolation | PASS | MINOR | `BankRepository.ets:175-209` mock 卡仅在 data repository；`OtpService.ets:1-5` 明确本地模拟且无网络请求；生产持久化仍经 `RdbBankCardStore`（`BankCardRepository.ets:31-134`）。 |
| spec_acceptance_to_code | FAIL | MAJOR | `acceptance.yaml:97-101` 将 AC-5 成功回首页 checkpoint 绑定 `home_root`；`HomeTabPage.ets:70-124` 根 `Column` 未声明该稳定 id，导致验收 checkpoint 无法绑定。 |
| reference_crosscheck | FAIL | MAJOR | `contracts.yaml:310-312` 与 `plan/visual-parity.yaml:8-10` 的资源 key 为 `result_payment_guide`，但 `BankCardOpeningResultPage.ets:54` 实际引用 `$r('app.media.result_payment_guide_placeholder')`。 |
| visual_parity_backstop | WARN | MAJOR | `fidelity-intent.json:5-7` 为 `pixel_1to1 + best_effort + approximate`；`plan/visual-parity.yaml:78-82` 明确结果插画仍是 release-blocking major 视觉债务。 |
| visual_multimodal_parity | WARN | MAJOR | 四张参考图已逐图读取；前三屏结构/主题与源码大体一致，结果页源码 `BankCardOpeningResultPage.ets:54-59` 的抽象占位无法匹配参考图的手机、二维码与手部插画。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T18:02:39.906Z"
  checks:
    - id: component_props_consistency
      status: FAIL
      severity: MAJOR
      details: |
        contracts.yaml:187-199 要求 OtpVerificationSheet 暴露
        `candidate: BankCardCandidate` 的 @Prop；实际
        OtpVerificationSheet.ets:13-15 暴露 onFinished/onClose，并以普通字段
        `openingService` 接收流程状态，没有 candidate 属性。
        contracts.yaml:200-208 将结果页路由属性命名为 result；实际
        BankCardOpeningResultPage.ets:7-11 使用 routeParam 并在 result() 中强转。
        当前运行链能够工作，但组件接口没有逐字兑现 contracts.yaml。
      suggestion: |
        由 plan/coding 责任方统一真源：若 service 注入与 routeParam 是既定 ArkUI
        承载方式，修订 contracts.yaml 的 props/route-param 声明；否则按合同补齐
        candidate/result 属性，并保持现有单一业务协调入口。
    - id: spec_acceptance_to_code
      status: FAIL
      severity: MAJOR
      details: |
        acceptance.yaml:97-101 的 AC-5 checkpoint 要求成功完成后 wallet_home
        可通过 `home_root` 定位。HomeTabPage.ets:70-124 的根 Column 没有 `.id('home_root')`。
        导航行为本身由 OpeningNavigationService.ets:7-15 的 success clear 实现，
        但当前验收锚点无法绑定，不能据此声明 AC-5 的 checkpoint 已完整落码。
      suggestion: |
        coding 责任方在 HomeTabPage 根容器添加稳定 `home_root` id；不要改变现有
        Navigation/clear 语义。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        contracts.yaml:310-312 和 plan/visual-parity.yaml:8-10 均把逻辑/资源 key
        登记为 `result_payment_guide`，而 BankCardOpeningResultPage.ets:54 实际引用
        `app.media.result_payment_guide_placeholder`。物理文件确为已登记占位图，
        但代码资源 ID 与契约 key 不一致。
        另：coding/upstream-issues.md:7 引用 script-report.json:1012-1018 作为
        named_business_handler PASS 证据，实际当前报告的对应位置是
        script-report.json:1029-1035；结论仍成立，但定位已过时。
      suggestion: |
        统一资源 key：优先让实际 ArkUI resource key 与 contracts/visual-parity 的
        `result_payment_guide` 一致；若必须保留 placeholder 后缀，则同步修订两份契约。
        同时更新 upstream-issues.md 的证据行号。
    - id: visual_parity_backstop
      status: WARN
      severity: MAJOR
      details: |
        spec/reports/fidelity-intent.json:5-7 将本轮定为 pixel_1to1、
        best_effort、approximate，因此本项不升级为 BLOCKER。
        plan/visual-parity.yaml:78-82 已登记 result_guide_illustration 为 major
        视觉债务；BankCardOpeningResultPage.ets:54-59 仍渲染 placeholder。
        ui-spec.yaml 仍为 verified=unverified，缺少真机截图/visual diff，不能宣称整体保真。
      suggestion: |
        发布前由视觉素材责任方替换真实或经批准的近似插画，并用四屏真机截图执行
        visual diff；本轮保留该债务，不据静态代码宣称 pixel parity。
    - id: visual_multimodal_parity
      status: WARN
      severity: MAJOR
      details: |
        已直接读取四张参考图。卡型半模态、选卡页、OTP 半模态的主要层级、
        品牌动作色、按钮位置和文案结构与实现大体同向；结果页存在可直接确认的明显冲突：
        参考图中心是手持手机与二维码的具象插画，源码仅加载已登记的抽象 placeholder。
        ui-spec verified=unverified，因此不作整体 PASS 结论。
        ```read-image-evidence
        - file: 3-点击任意银行拉起添卡选卡半模态.jpg
          observation: 底部圆角半模态含银行行、储蓄卡/信用卡单选、授权说明与蓝色继续按钮。
        - file: 4-点击信用卡或储蓄卡后拉起选卡页面.jpg
          observation: 全屏选卡页含银行标题、掩码卡号卡片、红色协议勾选与红色下一步按钮。
        - file: 5-选中某张卡片后拉起短信验证.jpg
          observation: 底部验证码半模态含手机号掩码、数字输入、倒计时操作和宽幅禁用按钮。
        - file: 6-短信验证完成后结果页.jpg
          observation: 成功页中心为绿色成功图标、成功文案及手持手机二维码具象插画；NFC 区位于其下但已被本次范围明确排除。
        ```
      suggestion: |
        保持 NFC 区排除不变；仅替换 result_guide_illustration 的占位素材并在真机上核对
        四屏 bbox、字体、颜色与系统键盘状态。
  summary:
    total: 11
    pass: 6
    fail: 3
    warn: 2
    blockers: 0
    verdict: PASS
```

```issue-verification
- issue: UP-001
  verdict: confirmed
  evidence: coding/upstream-issues.md:7 的完整问题为“旧轮次曾报告 named_business_handler 解析异常；当前可读证据显示该检查已为 PASS，因此本轮不再存在可交接的上游缺陷”，修复建议为“无需修改；保留历史记录并以当前 harness 结果为准”。当前真实证据位于 coding/reports/script-report.json:1029-1035：named_business_handler status=PASS、details=“ui_bindings.user_actions.calls 引用的业务函数均为命名函数（非 inline lambda）”。关闭结论成立，但原登记的 1012-1018 行号已过时。
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 2d0a804a71fbfc77a4ec50f06437bc6214f17be67de3fededab49fe49faada77
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| coding_compile_gate | PASS | BLOCKER | `coding/reports/ai-prompt.md:1562-1606`：Harness `fail=0`、`blockers=0`、`verdict=PASS`，`coding_compile` 与 `coding_run_status` 均在 passed_check_ids。 |
| business_logic_correctness | PASS | MAJOR | `BankCardOpeningService.ets:42-181` 实现完整阶段流、候选加载、OTP 门禁及保存结果映射。 |
| error_handling_completeness | PASS | MAJOR | `BankCardRepository.ets:151-169` 事务失败回滚；`BankCardOpeningService.ets:161-181` 将存储异常映射为失败结果；`OtpVerificationSheet.ets:24-27,68-73` 清理计时与 OTP。 |
| interface_signature_consistency | PASS | BLOCKER | `contracts.yaml:86-144` 的接口和模型与对应 repository、service、context 源码签名一致。 |
| component_props_consistency | FAIL | MAJOR | `contracts.yaml:187-207` 声明 `OtpVerificationSheet.@Prop candidate` 和结果页 `result` 路由属性；源码分别使用 `openingService`（`OtpVerificationSheet.ets:13-15`）与 `routeParam`（`BankCardOpeningResultPage.ets:7-11`）。 |
| data_ownership_compliance | PASS | MAJOR | `BankOpeningCompletionContext.ets:3-16` 单次交接；`HomeTabPage.ets:30-42` 消费成功卡号；结果页未渲染完整卡号。 |
| simulation_data_isolation | PASS | MINOR | `BankRepository.ets:175-209` 与 `OtpService.ets:1-5` 将 mock 数据隔离于 data/domain，生产持久化仍使用 `RdbBankCardStore`。 |
| spec_acceptance_to_code | PASS | MAJOR | `acceptance.yaml:97-101` 要求 `home_root`；`HomeTabPage.ets:121-124` 已在根容器添加 `.id('home_root')`，AC-5 checkpoint 可绑定。 |
| reference_crosscheck | FAIL | MAJOR | `contracts.yaml:310-312`、`plan/visual-parity.yaml:8-10` 登记资源 key `result_payment_guide`，源码 `BankCardOpeningResultPage.ets:54` 引用 `result_payment_guide_placeholder`。 |
| visual_parity_backstop | WARN | MAJOR | `fidelity-intent.json:5-7` 为 `pixel_1to1 + best_effort + approximate`；`plan/visual-parity.yaml:78-82` 仍登记结果插画 major 视觉债务。 |
| visual_multimodal_parity | WARN | MAJOR | 四张参考图已逐图读取；结果页参考图为手机、二维码和手部具象插画，源码 `BankCardOpeningResultPage.ets:54-59` 仍使用抽象占位。 |

```yaml
verification_result:
  phase: "coding"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T18:06:02.911Z"
  checks:
    - id: component_props_consistency
      status: FAIL
      severity: MAJOR
      details: |
        contracts.yaml:187-199 要求 OtpVerificationSheet 暴露
        `candidate: BankCardCandidate` 的 @Prop；实际
        OtpVerificationSheet.ets:13-15 使用 onFinished/onClose 回调和普通字段
        `openingService`，没有 candidate 属性。
        contracts.yaml:200-208 将结果页路由属性命名为 result；实际
        BankCardOpeningResultPage.ets:7-11 使用 routeParam 并在 result() 中强转。
        本轮新增 home_root 未改变上述接口差异，也未引入直接回归。
      suggestion: |
        由 plan/coding 责任方统一组件契约：若 service 注入与 routeParam 是既定 ArkUI
        承载方式，修订 contracts.yaml；否则按合同补齐 candidate/result 属性。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        contracts.yaml:310-312 和 plan/visual-parity.yaml:8-10 均登记资源 key
        `result_payment_guide`，但 BankCardOpeningResultPage.ets:54 实际引用
        `app.media.result_payment_guide_placeholder`。物理文件存在且属于已披露占位，
        但代码资源 ID 与契约 key 仍不一致。
      suggestion: |
        统一实际 ArkUI resource key 与 contracts/visual-parity 的
        `result_payment_guide`；若保留 placeholder 后缀，则同步修订两份契约。
    - id: visual_parity_backstop
      status: WARN
      severity: MAJOR
      details: |
        spec/reports/fidelity-intent.json:5-7 将本轮定为 pixel_1to1、
        best_effort、approximate，因此本项不升级为 BLOCKER。
        plan/visual-parity.yaml:78-82 已将 result_guide_illustration 登记为 major
        视觉债务；BankCardOpeningResultPage.ets:54-59 仍渲染 placeholder。
        ui-spec.yaml 仍为 verified=unverified，缺少真机截图/visual diff，
        不能声明整体像素保真。
      suggestion: |
        发布前替换真实或经批准的近似插画，并用四屏真机截图执行 visual diff。
    - id: visual_multimodal_parity
      status: WARN
      severity: MAJOR
      details: |
        已直接读取四张参考图。卡型半模态、选卡页和 OTP 半模态的主要结构、
        品牌动作色与按钮位置和实现大体同向。结果页存在明显冲突：参考图中心是
        手持手机与二维码的具象插画，源码只加载已登记的抽象 placeholder。
        ui-spec verified=unverified，因此不作整体 PASS 结论。
        ```read-image-evidence
        - file: 3-点击任意银行拉起添卡选卡半模态.jpg
          observation: 底部圆角半模态含银行行、双卡型单选、授权说明与蓝色继续按钮。
        - file: 4-点击信用卡或储蓄卡后拉起选卡页面.jpg
          observation: 全屏选卡页含银行标题、掩码卡号、红色协议勾选与红色下一步按钮。
        - file: 5-选中某张卡片后拉起短信验证.jpg
          observation: 底部验证码半模态含手机号掩码、数字输入、倒计时和宽幅禁用按钮。
        - file: 6-短信验证完成后结果页.jpg
          observation: 成功页含绿色状态图标、成功文案及手持手机二维码具象插画；NFC 区已被需求明确排除。
        ```
      suggestion: |
        保持 NFC 区排除不变；替换结果页占位素材，并在真机核对四屏几何、字体和颜色。
  summary:
    total: 11
    pass: 7
    fail: 2
    warn: 2
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 0775f7ea13da9047d0c9098c33324063c6feddbf1222e936a6049ab9bd7fd0d4
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

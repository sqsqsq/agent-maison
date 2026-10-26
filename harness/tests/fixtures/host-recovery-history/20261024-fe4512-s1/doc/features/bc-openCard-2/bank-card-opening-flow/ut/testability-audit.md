# 银行卡开卡业务级 UT 可测性预检

```yaml
schema_version: "1.0"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
records:
  - acceptance_id: AC-1
    entry_point: { symbol: BankCardOpeningSession, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: AC-2
    entry_point: { symbol: BankRepository.getCards|BankCardOpeningService.maskCardNumber, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankRepository, kind: pure, seam: none }, { name: BankCardOpeningService, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: AC-3
    entry_point: { symbol: OtpVerificationState, file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets }
    testability_level: L1
    dependencies: [{ name: OtpService, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: AC-4
    entry_point: { symbol: BankCardOpeningService.begin|loadCandidates|startOtp|completeOpening, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L1
    dependencies: [{ name: BankRepository, kind: di_injectable, seam: constructor_injection }, { name: OtpService, kind: di_injectable, seam: constructor_injection }, { name: BankCardRepository, kind: di_injectable, seam: constructor_injection }]
    verdict: testable
  - acceptance_id: AC-6
    entry_point: { symbol: walletDestinationNames|isWalletDestination, file: 01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets }
    testability_level: L0
    dependencies: [{ name: WalletDestinationRegistry, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: BD-1
    entry_point: { symbol: BankCardOpeningSession.canOpenOtp|canSubmit, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: BD-2
    entry_point: { symbol: OtpVerificationState.resend|tick, file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets }
    testability_level: L1
    dependencies: [{ name: OtpService, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: BD-3
    entry_point: { symbol: BankCardRepository.save|BankCardOpeningService.saveCandidate, file: 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets }
    testability_level: L1
    dependencies: [{ name: BankCardRepository, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: BD-4
    entry_point: { symbol: BankCardOpeningSession.cancel|OtpVerificationState.cancel, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L1
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }, { name: OtpVerificationState, kind: pure, seam: none }]
    verdict: testable
```

## 已闭环问题

UT-004 已由 coding 返修并经 review 收口：`02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:31` 提供构造注入，`:42` 起提供候选、OTP 与选择阶段入口，`:143` 的 `completeOpening` 暴露保存期与结果态。UT 现可驱动 `ENTRY→TYPE_SELECTED→CARD_SELECTED→OTP_ACTIVE→SAVING→RESULT`；真实结果页导航按 AC-5 的 device 层验证，不在 UT 伪造 ArkUI 栈。

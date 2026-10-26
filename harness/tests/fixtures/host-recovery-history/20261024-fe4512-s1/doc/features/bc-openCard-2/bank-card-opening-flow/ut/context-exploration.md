---
schema_version: "1.1.0"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
phase: ut
change_intent: "消费 coding 可测性返修，为银行卡开卡 CU 建立可执行业务级 UT 证据"
estimated_loc_delta: 360
touches_layers: [data, domain, product]
adds_new_exports: false
ready_to_produce: true
has_blocker_coverage_risk: false
source_code_paths:
  - 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
  - 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
  - 01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets
  - 02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets
  - 02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets
  - 01-Product/Phone/src/ohosTest/ets/test/List.test.ets
  - 02-Feature/WalletMain/oh-package.json5
  - 01-Product/Phone/oh-package.json5
key_inputs_read:
  - doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml
  - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml
  - doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml
  - doc/features/bc-openCard-2/bank-card-opening-flow/context/facts.md
  - doc/module-catalog.yaml#WalletMain,AccountManager,Phone
  - doc/glossary.yaml#添卡,首页
  - doc/architecture.md
  - framework/profiles/hmos-app/skills/business-ut/profile-addendum.md
---

# UT Research Sub-Phase

## Code Facts

| 路径 | 签名级事实 | UT 影响 |
|---|---|---|
| `BankCardOpeningService.ets` | `BankCardOpeningSession` 提供 begin、卡型/卡片/协议/OTP 选择、组合门禁和 reset；service 构造注入 Repository 并统一映射保存结果。 | AC-1、BD-1、BD-4 为 L0，AC-4 成功/失败为 L1。 |
| `OtpService.ets` | `OtpVerificationState` 构造注入 `OtpService`，提供 start/resend/tick/updateOtp/cancel。 | AC-3、BD-2、BD-4 可由 Spy 驱动，无需 ArkUI runtime。 |
| `BankCardRepository.ets` | `BankCardStore` 是显式接口，Repository 构造注入 store；save 包含事务、幂等回查与异常回滚。 | AC-4、BD-3 可用内存 Spy 验证真实 Repository 编排。 |
| `BankRepository.ets` | `getCards(bankCode, cardType)` 返回本地完整候选，`maskCardNumber` 只转换展示值。 | AC-2 可直接验证筛选、数量、掩码和完整卡号保留。 |
| `WalletDestinationRegistry.ets` | `walletDestinationNames` 同时返回既有与新增钱包目的页，`isWalletDestination` 由 Phone 根 builder 实际消费。 | AC-6 可在 Phone ohosTest 直接验证，不导入 ArkUI。 |
| `bank_open_card_ut.test.ets` | 当前 CU 的 canonical test ref 指向该文件的八个命名证据函数。 | 用真实函数而非注释满足 CU test_refs，并注册全部新用例。 |
| `spy/SpyBankRepository.ets` | 旧银行卡列表回归套件继续使用该数据 Spy。 | 保留既有回归载体，不把其用例计入本 CU 覆盖。 |
| `List.test.ets`（WalletMain/Phone） | 两模块均以函数调用注册测试套件。 | 新 suite 必须接入对应 List，避免 total=0。 |
| `acceptance.yaml` | AC-1/2/3/4/6 与 BD-1..4 均为 P0/P1 且 `ut_layer: both`。 | 九条均需精确标签、coverage evidence 和真实运行结果。 |
| `use-cases.yaml` | UC-1 有 BR-SUCCESS/BR-FAILURE，数据边界名严格为 `BankCardRepository`。 | 生成两条 ephemeral DAG，并以同名 boundary 与 Spy preset 对齐。 |

## Decisions Unlocked

- 仅写 WalletMain/Phone 的 `src/ohosTest` 与本阶段 UT 产物，不修改产品源码。
- AC-1/2/3/6 与 BD-1..4 的局部规则可测；AC-4 已由统一无 ArkUI 协调入口闭环，成功/失败分支均可直接驱动。
- 以两个 branch 用例、精确 AC/BD 用例和 Phone 路由用例共同覆盖冻结 UT 范围。
- 旧银行卡列表用例原样迁入独立 legacy suite 并继续注册，避免当前 CU 的禁 UI import 影响新文件。

## Research Verdict

局部规则、事务、路由注册及完整成功/失败分支均已有可直接驱动的生产入口。testing 回流返修未改变这些签名或边界；本轮复用既有 UT/DAG/Spy 并通过正式 harness 重跑，不修改产品源码。

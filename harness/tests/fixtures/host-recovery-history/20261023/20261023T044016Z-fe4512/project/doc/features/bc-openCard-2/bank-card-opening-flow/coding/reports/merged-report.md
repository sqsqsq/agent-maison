# CODING 阶段验证报告 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

> 生成时间: 2026-10-23T05:27:30.146Z
> 保证等级: full
> 能力解析: 4 项

## 一、脚本 Harness 检查结果

| 指标 | 值 |
|------|-----|
| 总检查项 | 64 |
| PASS | 34 |
| FAIL | 2 |
| WARN | 26 |
| SKIP | 2 |
| BLOCKER 数 | 1 |
| **裁定** | **FAIL** |

### 失败项明细

#### 🚫 named_business_handler

- **描述**: named_business_handler 执行异常
- **详情**: [Harness 内部错误] ua.calls.split is not a function
TypeError: ua.calls.split is not a function
    at scanNamedBusinessHandler (D:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\harness\named-handler.ts:108:32)
    at scanNamedBusinessHandler (D:\1.code\SimulatedWalletForHmos\framework\harness\scripts\utils\named-handler.ts:23:12)
    at checkNamedBusinessHandlerCoding (D:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-coding.ts:522:40)
    at D:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-coding.ts:762:35
    at safeRun (D:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-coding.ts:660:12)
    at Object.check (D:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-coding.ts:762:21)
    at runScriptHarness (D:\1.code\SimulatedWalletForHmos\framework\harness\harness-runner.ts:3262:26)
    at main (D:\1.code\SimulatedWalletForHmos\framework\harness\harness-runner.ts:1328:15)
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
- **建议**: 门禁脚本自身异常（framework 缺陷，非本 feature 产物问题）——请把完整栈回灌 agent-maison 源仓修复；不要修改产物或 framework 发布件来绕过。
- **来源**: check-coding.ts

#### 🚫 coding_run_status

- **描述**: Coding 阶段脚本门禁总体状态
- **详情**: can_claim_done: NO
contracts.files: 29
contracts.modules: 3
coding_compile: PASS
blocker_fail_count: 1
critical_skip_count: 0
blocking_warn_count: 0
blocker_fail_ids: named_business_handler
- **建议**: 先修复 BLOCKER FAIL；若存在 critical_skip_ids，请补齐 contracts.yaml / plan trace / diff baseline 后重跑。
- **来源**: check-coding.ts

### 警告项

- ⚠️ **context_exploration_facts_source_stale**: 本阶段授权内源码已变化但未登记精确 delta：02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_source_stale**: 本阶段授权内源码已变化但未登记精确 delta：02-Feature/WalletMain/src/main/ets/index.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_source_stale**: 本阶段授权内源码已变化但未登记精确 delta：02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_source_stale**: 本阶段授权内源码已变化但未登记精确 delta：02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_source_stale**: 本阶段授权内源码已变化但未登记精确 delta：02-Feature/WalletMain/src/main/resources/base/element/color.json；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_source_stale**: 本阶段授权内源码已变化但未登记精确 delta：02-Feature/WalletMain/src/main/resources/base/element/string.json；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets；追溯弱一级，不阻断本阶段。
- ⚠️ **context_exploration_facts_scope_coverage**: 本阶段授权内新增或修改的源码未登记：02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png；追溯弱一级，不阻断本阶段。
- ⚠️ **page_registration**: 以下实际页面所属模块未识别到静态路由形式，须由 review/真机核验可达性：02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets、02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets、02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets、02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
- ⚠️ **naming_conventions**: 2 处命名规范问题：
  - 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets:4: 资源 key "*" 不是 snake_case
  - 文件名 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets 不是 PascalCase
- ⚠️ **component_new_static_checks**: WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#buildBankCardOpeningResultPage: 静态分析未确认 scalable_font_unit=unknown、declared_touch_target=unknown；review 核对真实组件源码，适用交互/视觉由 testing 验证；不代表通过或不适用。
- ⚠️ **component_new_static_checks**: WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets#buildBankCardSelectionPage: 静态分析未确认 scalable_font_unit=unknown、declared_touch_target=unknown；review 核对真实组件源码，适用交互/视觉由 testing 验证；不代表通过或不适用。
- ⚠️ **static_fidelity_score**: 基线未校验（ui-spec verified=unverified）：静态保真分仅供参考，不作保真结论。
- ⚠️ **structure_declaration_ledger**: implemented_by 定位未命中当前源码，需更新定位并核实实际结构：card_type_overlay_root｜bg_color=color.overlay_dim → AddBankCardPage|AllBanksPage.bindSheet；card_type_background_page｜bg_color=color.page_bg → AddBankCardPage|AllBanksPage；debit_card_row｜layout_group=card_type_rows → CardTypeSheet.cardTypeRow；credit_card_row｜layout_group=card_type_rows → CardTypeSheet.cardTypeRow；otp_overlay_root｜bg_color=color.overlay_dim → BankCardSelectionPage.bindSheet
（台账仅用于定位：缺项或位置过时不证明产品缺陷；实际结构由独立 review 与设备/视觉验证。）
- ⚠️ **code_to_plan**: 37 个 .ets 文件不在 contracts.yaml 的规划中：
  - 02-Feature/WalletMain/src/main/ets/data/model/BankGroup.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/CardCategory.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/FinanceEntry.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/HomeCardState.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/MessageInfo.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/PromoInfo.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/ServiceEntry.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/SettingEntry.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/HomeRepository.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/MineRepository.ets
  - 02-Feature/WalletMain/src/main/ets/domain/service/BankGroupService.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/components/AccountCard.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/components/AccountConfirmDialog.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/components/AddCardParityAnchors.ets
  ... 还有 22 项

## 二、AI Harness 语义验证

> AI Harness 尚未执行。

## 三、最终裁定

**FAIL** — 存在 1 个 BLOCKER 级别失败，必须修复后重新验证。

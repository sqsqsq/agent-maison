# Code Review 报告 — bank-card-opening-flow

> **模块标识**: `cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93`
> **审查日期**: 2026-10-24
> **审查版本**: v1.7（CR-007 搜索行返修限界复审）
> **审查人**: 当前 review 阶段执行者；本轮调用 Claude Code CLI 独立只读复审
> **保证等级**: `full`
> **能力解析说明**: 正式 contracts、acceptance、spec、plan、源码、结构台账与四张参考图均可解析；消费 2026-10-24T19:16:45.224Z 的 coding PASS、coding verifier PASS、当前构建搜索行真机诊断与本轮 Claude Code CLI 复审；review 未重跑完整 testing 或像素验收。
> **对应设计文档**: `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md`

---

## 一、审查范围

### 审查模块

| 模块名 | 所属层 | 格式 | 审查文件数 |
|---|---|---|---:|
| WalletMain | 02-Feature | HAR | 24 |
| AccountManager | 04-BusinessBase | HAR | 3 |
| Phone | 01-Product | HAP | 2 |

### 文件范围

复用上一轮对 `contracts.yaml > files` 的完整审查；本轮按 re-review 规则只核最新 testing 回流的 OTP 共同根因、实际返修文件及其直接调用链，不重启无界审计。失败证据来自 `testing/reports/20261024T185039Z-266/hylyre/trace.json` 与 TC-001/005/008 三份失败 UI 树；当前返修只改变 `OtpVerificationSheet.ets` 的按钮响应式投影，旧的两个 ad-hoc trace 仅继续证明此前选卡门禁与显式 Sheet 关闭修复。

实际覆盖路径：

```text
02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets
02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets
02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets
02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets
02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets
02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets
02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets
02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets
02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets
02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets
02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets
02-Feature/WalletMain/src/main/ets/index.ets
02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
02-Feature/WalletMain/src/main/resources/base/element/string.json
02-Feature/WalletMain/src/main/resources/base/element/color.json
02-Feature/WalletMain/src/main/resources/base/element/float.json
02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png
04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets
04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets
04-BusinessBase/AccountManager/src/main/ets/index.ets
01-Product/Phone/src/main/ets/pages/index.ets
01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets
```

审查基线为提交 `9b37cce3281566e6d20f5071dc502866d976ebe3` 加当前工作树中的本轮实现。

---

## 二、审查方法

| 审查维度 | 依据文档 | 检查要点 |
|---|---|---|
| 架构合规性 | `doc/architecture.md`、module catalog、profile addendum | 外层依赖、模块内分层、WalletMain 出口、Phone 装配 |
| 接口一致性 | `contracts.yaml` | 模型字段、Repository/Service 签名、组件状态/事件、路由参数 |
| 编码规范 | ArkTS pitfalls、coding 机器报告 | 类型安全、资源引用、异步与生命周期、完整卡号隐私 |
| 命名规范 | coding rules、ArkTS pitfalls | 新增模型、Repository、Service、组件、资源 key 与路由常量命名 |
| 业务逻辑 | `spec.md`、`acceptance.yaml`、`plan.md`、`use-cases.yaml` | 卡型/卡片门禁、OTP、RDB、成功/失败清栈、取消与重复操作 |
| 数据层 | `contracts.yaml`、Repository 源码 | RDB 建表、事务、幂等、失败回滚与敏感字段边界 |
| 视觉保真 | 四张原图、`ref-elements.yaml`、`visual-parity.yaml`、`structure-conformance.yaml` | 排除/延后、可见文案、16 条结构声明与引导图语义 |

最新 coding 阶段真实编译结果为 PASS（`coding/reports/summary.json`，生成时间 2026-10-24T19:16:45.224Z），coding verifier subject `10f952223ac10206755c02f4e5c3f44e9c4bcedb020b3d7f1bfd58f62f5c0dc0` 为 PASS；review 按验证相称原则未重复编译。本轮独立检视真实调用为 `claude -p --model opus --permission-mode dontAsk --output-format json`，Claude Code 版本 `2.1.310`，CLI 返回 canonical model `claude-opus-5-5`。CLI 确认 CR-007 静态关闭，但把搜索行导致旧 `bc-openCard-1` 首屏银行行数减少列为 MAJOR；本阶段按当前冻结目标裁决该意见不成立：本需求明确要求背景页实现参考图搜索行，而当前 acceptance 的兼容义务仅约束既有路由名称与返回语义，未要求维持旧视觉的 7 行布局。该变化是当前目标授权的页面布局替换，不作为缺陷或返修候选；设备上仍须按本需求的 `card_type_sheet` 目标做最终视觉验收。CLI 全程只读且未修改仓库。

---

## 三、问题清单

### 既有意见关闭核对

- CR-001 已修复：`CardTypeSheet.aboutToAppear()` 仅重置为 `null`，继续按钮在未选择时保持禁用；卡型只在行点击后赋值。
- CR-002 已修复：OTP 保存时关闭按钮禁用且点击路径显式拒绝；组件消失会把 `isActive` 置为 `false`，在途保存完成后不会再调用 `onFinished()`。
- CR-003 已修复：`selection_agreement` 改为银行名与卡型双占位，`BankCardSelectionPage` 从当前银行及路由卡型传入参数。

上述返修未改变模块依赖、导出、路由注册、RDB 接口或正常流程状态机，未发现直接回归。

### UT 可测性返修核对

- `BankCardRepository` 新增 `BankCardStore`/`RdbBankCardStore` 构造注入边界；默认生产构造仍要求 `Context` 并使用同一 RDB，保存路径仍执行事务、幂等回查和失败回滚，没有测试 fast path。
- `BankCardOpeningService` 新增 `saveCandidate` 和 `BankCardOpeningSession`；`CardTypeSheet`、`BankCardSelectionPage`、`OtpVerificationSheet` 均真实消费该 session，卡型、卡片、协议和六位 OTP 门禁未旁路。
- `OtpVerificationState` 提供 start/tick/resend/cancel；Sheet 仍在出现时自动发送，60 秒内拒绝重发，消失时清 Timer/OTP，保存期关闭保护与消失后回调抑制保持。
- `WalletDestinationRegistry` 覆盖 4 个旧目的页与 2 个新增目的页，Phone 根 `navDestinationMap` 在原 builder 分支前实际消费该入口；现有分支与参数传递未改变。

上述变化与其直接调用链未发现新回归；AC/BD 的断言覆盖仍由下一阶段 UT 真实生成和运行，本报告不预签 UT 通过。

### testing 回流返修核对

- 根因一已关闭：正式失败 UI 树显示协议已勾选但 `selection_next_btn.enabled=false`。`BankCardSelectionPage` 现以 `@State selectedCandidate` 与 `@State agreementAccepted` 驱动按钮响应式重算，同时点击时仍由 `openingService.canOpenOtp()` 作业务门禁。当前构建的 `doc/features/_adhoc/testing/reports/20261024-140337/hylyre/trace.json` 完成 18/18 步，点击下一步后成功定位 `otp_sheet_title`。
- 根因二已关闭（显式关闭路径）：`AddBankCardPage` 与 `AllBanksPage` 以 `sheetDismissing`/`pendingBank` 协调关闭动画，保留 Sheet 内容到 `onDisappear` 再清理，并在关闭期缓存重开请求。当前构建的 `doc/features/_adhoc/testing/reports/20261024-140906/hylyre/trace.json` 完成 20/20 步，覆盖关闭、重开、再次关闭及点击“更多”。
- `HomeTabPage` 根容器新增稳定 `home_root` 验收锚点，不改变导航或展示语义。
- 最新正式 testing 在 TC-001 step 38、TC-005 step 32、TC-008 step 25 复现同一现象：UI 树中 `otp_input.text` 已为六位数字，但 `otp_next_btn.enabled=false`，因此未进入结果页。该证据把根因限定在 OTP 按钮可用态投影，而非 RDB、结果路由或清栈。
- 当前返修在 `OtpVerificationSheet` 中新增 `isOtpComplete()`，按钮的 `enabled`、文字颜色和背景色直接读取页面 `@State otp`；`handleOtpChange()` 仍先更新 `BankCardOpeningService` 再同步页面状态，点击后 `saveSelectedCard()` 仍以 `openingService.canSubmit()` 作最终业务校验。显示投影与业务真源职责清晰，没有新增 fast path 或绕过六位数字、会话、卡片、协议门禁。
- 本次只改变响应式 UI 投影，未修改 RDB、OTP 倒计时状态机、结果页路由/清栈或跨模块出口；未发现直接回归。此前 review 无法合理发现该运行时缺陷，是因为当时的当前构建窄证据只覆盖“选卡页进入 OTP”，报告也明确把完整 TC-001～TC-008 留给正式 testing；新 UI 树首次提供了“原生输入框显示六位但按钮仍禁用”的确定性证据。
- TC-002 step 18 为 `scroll_to ab_row_cmb` 的 `selector.ambiguous`，没有已执行产品断言失败，按现有回流分类保留给 testing 重派生/消歧，不归为 coding 缺陷。
- 当前修复尚无返修后的设备 trace；完整 TC-001/005/008 与其余用例仍由后续正式 testing 重跑闭环，本报告不预签真机通过。

### 当前未关闭问题

| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |
|---|---|---|---|---|---|
| CR-004 | MAJOR | 视觉保真 | 结果页仍使用抽象灰色占位图，未表达参考图的手机、二维码与手持动作。该差异已由 `plan/visual-parity.yaml` 登记为 best-effort major 视觉债务，且原始需求允许引导图“大差不差”；因此本轮只披露，不作为功能返修阻断，但发布就绪仍受阻。 | `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 发布前替换为具有手机屏幕、二维码和手持动作的近似原创插画，并在 testing 重新截图核对。 |
| CR-005 | MINOR | 异常处理 | `loadCandidates()` 没有异常分支，候选为空时只显示空白卡片容器和禁用按钮，没有 spec E5 要求的空态说明。当前 mock 正常路径可达 1–2 张卡，但数据配置漂移或非法路由参数会落入无解释死端。 | `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 捕获加载异常并增加明确空态；候选为空时保持下一步禁用并允许返回，不伪造候选。 |
| CR-006 | MINOR | 逻辑错误 | 新的关闭竞态修复仅在应用内 `onClose`/继续路径预先设置 `sheetDismissing=true`。若 Sheet 由系统返回、下滑等框架关闭路径触发，双向绑定可先将 `showCardTypeSheet` 置为 false，而 `sheetDismissing` 仍为 false；退出动画期间重点银行可能直接置 true，随后迟到的 `onDisappear` 又把这次重开清掉。当前 ad-hoc 只覆盖显式“X”关闭，未覆盖该路径。 | `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets`, `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 在两处 Sheet 生命周期开始消失时统一进入 dismissing 状态（采用当前 SDK 支持的 will-dismiss/will-disappear 回调），让所有关闭原因复用 pending 重开队列；补一条系统关闭后立即重开的设备用例。 |

规则追溯：CR-004 由 `ui-spec.yaml`、`ref-elements.yaml` 及 coding 规则 `visual_parity_render` / `structure_declaration_ledger` 约束；CR-005/CR-006 在现行 `coding-rules.yaml` 没有专门 semantic rule，分别以 spec E5 和实际 ArkUI Sheet 生命周期行为为依据，不引用不存在的规则 id。CR-007 已关闭，不再计入未关闭问题。

### 本轮 CR-007 关闭核对

- `AddBankCardPage.searchRow()` 在标题/副标题与银行白卡之间渲染搜索图标、“搜索银行”、分隔线及“搜索”，根节点 id 为 `background_search_bank`；收起态与展开态均消费该 builder，同一时刻由条件分支只渲染一个实例。
- 两段可见文案分别来自 `add_bank_card_search_placeholder` 与 `add_bank_card_search_action` 资源，没有新增硬编码字符串；所用颜色与尺寸资源均已存在，最新 coding 编译和资源检查为 PASS。
- 搜索行没有接管银行行点击、Sheet 状态或路由调用；`openCardTypeSheet()`、`bindSheet` 与选卡路由调用链未因该返修改变。
- 当前构建 ad-hoc 导航 8/8 步通过，并在设备树定位 `background_search_bank` 为 `[48,454,1272,586]`；这证明元素已渲染且流程可达，不代替 testing 的像素与完整交互验收。

---

## 四、问题统计

| 严重程度 | 数量 |
|---|---:|
| BLOCKER | 0 |
| MAJOR | 1 |
| MINOR | 2 |
| INFO | 0 |
| **合计** | **3** |

---

## 五、修复建议摘要

### 已关闭的必须返修项

CR-001～CR-003 已全部关闭；最新 OTP 按钮响应式返修关闭了 testing 回流的共同功能根因。CR-007 也已由搜索行与资源文案返修关闭，当前构建已有元素定位与导航可达证据，未重新打开既有意见。

### 非阻断后续项

1. CR-004 是既有 best-effort major 视觉债务：不阻断本轮 review，但发布前必须替换并重验。
2. CR-005 是异常/空候选时的 MINOR 体验缺口，可在后续维护中补明确空态，不要求新增状态机或平行数据源。
3. CR-006 是本轮 Sheet 生命周期返修的直接边界缺口；不阻断当前 review，但正式 testing 应覆盖系统关闭路径，若复现则回 coding 做同一生命周期的最小修复。

---

## 六、视觉保真

### 素材与有效范围

- 已直接核对四张原始参考图。`result_nfc_panel` 按需求原句排除；状态栏、系统数字键盘和低置信 OCR 文案按目标简报保留为合法 best-effort 延后，不派 coding 扩大范围。
- 本轮没有 `coding/visible-text-exemptions.yaml`；coding 可见文案机器检查通过。CR-003 是文案语义与当前银行/卡型不一致，不是白名单问题。
- `result_payment_guide_placeholder.png` 的资源存在性通过，但语义近似仍不足，见 CR-004；本报告按 `visual-parity.yaml` 的既有 major debt 处置，不重复建立债务账，也不把“文件存在”当视觉通过。

### P0 must-have 全覆盖复核

依据：`spec/ui-spec.yaml > screens[].must_have_elements` 与 `spec/ref-elements.yaml`。四屏共 34 项；源码承载仅证明元素存在，不替代后续设备几何/像素验证。

| screen | element_id | 结论 | 源码/裁决依据 |
|---|---|---|---|
| `card_type_sheet` | `background_add_bank_title` | PASS | `AddBankCardPage.ets:170-200` 的 navBar 与 `add_bank_card_title`。 |
| `card_type_sheet` | `background_add_bank_subtitles` | PASS | `AddBankCardPage.ets:202-223` 的左右副标题。 |
| `card_type_sheet` | `background_search_bank` | PASS | `AddBankCardPage.ets:225-258` 的 `searchRow()` 使用资源文案并声明稳定 id；收起态和展开态分别在 `:363`、`:396` 消费，当前构建设备树已定位该节点。 |
| `card_type_sheet` | `background_bank_row` | PASS | `AddBankCardPage.ets:260-345` 通过 `BankListRow` 渲染银行行。 |
| `card_type_sheet` | `card_type_sheet_title` | PASS | `CardTypeSheet.ets:68-73`。 |
| `card_type_sheet` | `card_type_sheet_close` | PASS | `CardTypeSheet.ets:75-88`。 |
| `card_type_sheet` | `card_type_sheet_panel` | PASS | `CardTypeSheet.ets:151-156`。 |
| `card_type_sheet` | `card_type_bank_row` | PASS | `CardTypeSheet.ets:93-108`。 |
| `card_type_sheet` | `debit_card_row` | PASS | `CardTypeSheet.ets:110-112`。 |
| `card_type_sheet` | `credit_card_row` | PASS | `CardTypeSheet.ets:113-115`。 |
| `card_type_sheet` | `card_type_authorization_copy` | PASS | `CardTypeSheet.ets:123-128`。 |
| `card_type_sheet` | `card_type_agreement_copy` | PASS | `CardTypeSheet.ets:130-135`。 |
| `card_type_sheet` | `card_type_continue_btn` | PASS | `CardTypeSheet.ets:137-150`。 |
| `bank_card_selection` | `selection_back_btn` | PASS | `BankCardSelectionPage.ets:113-126`。 |
| `bank_card_selection` | `selection_nav_title` | PASS | `BankCardSelectionPage.ets:128-133`。 |
| `bank_card_selection` | `selection_hint` | PASS | `BankCardSelectionPage.ets:146-151`。 |
| `bank_card_selection` | `selection_card_container` | PASS | `BankCardSelectionPage.ets:153-187`。 |
| `bank_card_selection` | `bank_card_candidate_1` | PASS | `BankCardSelectionPage.ets:154-182` 的 keyed `ForEach` 动态 id。 |
| `bank_card_selection` | `selection_agreement_check` | PASS | `BankCardSelectionPage.ets:189-195`。 |
| `bank_card_selection` | `selection_agreement` | PASS | `BankCardSelectionPage.ets:197-202`。 |
| `bank_card_selection` | `selection_next_btn` | PASS | `BankCardSelectionPage.ets:208-221`。 |
| `otp_verification_sheet` | `otp_sheet_title` | PASS | `OtpVerificationSheet.ets:121-126`。 |
| `otp_verification_sheet` | `otp_sheet_close` | PASS | `OtpVerificationSheet.ets:128-146`。 |
| `otp_verification_sheet` | `otp_sheet_panel` | PASS | `OtpVerificationSheet.ets:213-218`。 |
| `otp_verification_sheet` | `otp_instruction` | PASS | `OtpVerificationSheet.ets:151-156`。 |
| `otp_verification_sheet` | `otp_phone_hint` | PASS | `OtpVerificationSheet.ets:158-163`。 |
| `otp_verification_sheet` | `otp_input` | PASS | `OtpVerificationSheet.ets:165-175`。 |
| `otp_verification_sheet` | `otp_resend_action` | PASS | `OtpVerificationSheet.ets:177-189`。 |
| `otp_verification_sheet` | `otp_next_btn` | PASS | `OtpVerificationSheet.ets:199-212`；返修后读取页面 `@State otp`。 |
| `opening_result_success` | `result_status_icon` | PASS | `BankCardOpeningResultPage.ets:21-29`。 |
| `opening_result_success` | `result_title` | PASS | `BankCardOpeningResultPage.ets:31-38`。 |
| `opening_result_success` | `result_description` | PASS | `BankCardOpeningResultPage.ets:40-47`。 |
| `opening_result_success` | `result_guide_illustration` | PASS（存在性） | `BankCardOpeningResultPage.ets:54-59`；语义差异另见 CR-004。 |
| `opening_result_success` | `result_finish_btn` | PASS | `BankCardOpeningResultPage.ets:63-73`。 |

### 结构声明台账逐条复核

依据：`doc/features/bc-openCard-2/bank-card-opening-flow/coding/structure-conformance.yaml`。

| node_id | 结论 | 源码核对 |
|---|---|---|
| `card_type_overlay_root` | PASS | 两个入口均以 `bindSheet` 承载 CardTypeSheet。 |
| `card_type_background_page` | PASS | AddBankCardPage/AllBanksPage 作为半模态背板保留。 |
| `card_type_sheet_panel` | PASS | CardTypeSheet 根 Column 使用页面背景资源。 |
| `card_type_bank_card` | PASS | 银行与卡型共用白色卡片容器。 |
| `card_type_bank_row` | PASS | logo 与银行名在首行。 |
| `debit_card_row` | PASS | 支持项经同一 `cardTypeRow` 模板渲染。 |
| `credit_card_row` | PASS | 支持项经同一 `cardTypeRow` 模板渲染。 |
| `bank_card_selection_root` | PASS | 选卡页根 Column 使用页面背景资源。 |
| `selection_card_container` | PASS | 候选卡 Column 使用卡片背景资源。 |
| `bank_card_candidate_1` | PASS | ForEach 的候选行模板真实存在。 |
| `otp_overlay_root` | PASS | BankCardSelectionPage 以 `bindSheet` 承载 OTP。 |
| `otp_sheet_panel` | PASS | OTP 根 Column 使用页面背景资源。 |
| `otp_code_row` | PASS | 输入框与重发按钮位于同一白色 Row。 |
| `otp_input` | PASS | TextInput 位于 Row 左侧并占剩余宽度。 |
| `otp_resend_action` | PASS | 重发按钮位于 Row 右侧，宽度 30%。 |
| `opening_result_root` | PASS | 结果页根 Column 使用页面背景资源。 |

结构台账属实，但只证明布局承载存在；真机 bbox、字体、键盘、返回手势与像素差异仍由 testing 负责。

---

## 七、结论

**审查结论**: 通过（保留非阻断债务）

CR-001～CR-003、最新 OTP 按钮响应式根因与 CR-007 均保持关闭；最新编译、当前构建的搜索行定位/导航证据及限界复审未发现返修引入的契约内直接回归。CR-004 是已登记的 best-effort 非关键视觉债务，CR-005/CR-006 为既有 MINOR，不阻断 review 闭环；其余设备像素、系统关闭边界和完整流程仍由冻结后继 `ut → testing` 验证。

**判定依据**:

- BLOCKER 数量: 0
- MAJOR 数量: 1（已登记 best-effort 非关键视觉债务）
- MINOR 数量: 2
- 判定规则：无 BLOCKER、无未关闭功能性 MAJOR；仅保留合法 best-effort 非关键视觉 MAJOR 与两个 MINOR，因此 review 通过并继续披露发布债务。

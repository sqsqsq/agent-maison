---
schema_version: "1.1"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
run_id: "20261023T044016Z-fe4512"
established_by: spec
ready_to_produce: true
has_blocker_coverage_risk: false
key_inputs_read:
  - "framework/specs/phase-rules/spec-rules.yaml — 已读"
  - "framework/profiles/hmos-app/skills/spec/profile-addendum.md — 已读"
  - "doc/module-catalog.yaml — 已读"
  - "doc/glossary.yaml — 已读"
  - "doc/architecture.md — 已读"
  - "build-profile.json5 — 已读"
  - "doc/component-index.yaml — 已读"
  - "doc/features/bc-openCard-2/blueprint/component-blueprint.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/change-unit.yaml — 已读"
  - "doc/features/原始需求/1-2-银行卡/原始需求.md — 已读"
source_code_paths:
  - "01-Product/Phone/src/main/ets/pages/index.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/index.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets"
  - "02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets"
  - "02-Feature/WalletMain/src/main/resources/base/element/color.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/float.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/string.json"
  - "02-Feature/WalletMain/src/main/resources/base/profile/route_map.json"
  - "02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/index.ets"
exploration_mode: "sequential"
change_intent: "feature"
estimated_loc_delta: 1500
touches_layers:
  - "01-Product"
  - "02-Feature/shared"
  - "02-Feature/data"
  - "02-Feature/domain"
  - "02-Feature/presentation"
  - "04-BusinessBase/data"
  - "04-BusinessBase/domain"
adds_new_exports: true
single_function_scope: false
decisions_unlocked:
  - "从添加银行卡页与全部银行页复用同一开卡会话入口"
  - "卡型、具体卡片、验证码、保存结果与定向清栈的验收边界"
  - "WalletMain/AccountManager/Phone 三模块范围与职责"
  - "四张参考图的盲档 UI-Spec、资产占位与视觉债务"
  - "成功完成回钱包首页、失败回最初添加银行卡页"
subagents_used: ""
searches_performed_estimate: 12
files_inspected_count: 35
---

## 探索预算与检索

- 检索现有银行入口的点击行为、路由常量、根 `navDestination` 注册和公开导出。
- 检索账号模型与服务是否已有可供验证码提示使用的手机号字段。
- 核对 CU `touches`、蓝图术语事实、既有 acceptance 候选与成功目的地冲突裁决。
- 读取四份 OCR JSON 和四份只读视觉观察 sidecar；未直接查看参考图片。
- 核对现有资源 token、字符串、路由映射及银行卡相关既有 UT。

## 已检视文件与原因

| 路径（相对仓库根） | 为何读 |
|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 确认添加银行卡页银行点击现状、导航上下文与页面结构 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 确认全部银行页银行点击现状及既有分组/索引行为 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 确认根导航栈装配与目的页注册责任 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 确认账号模型尚无手机号字段 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | 确认 mock 账号入口及手机号供给缺口 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 确认银行数据为本地 mock，尚无卡型和具体卡候选 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 确认既有四个路由与新增路由接线面 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 确认旧银行数据/分组/导航异常测试基线 |
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | 投影术语、Scope、验收和冲突裁决 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/change-unit.yaml` | 绑定 purpose、provide、predicate 与允许修改模块 |
| `build-profile.json5` | 核对 Phone/WalletMain/AccountManager 的物理模块路径与 HarmonyOS SDK 配置 |

## Code Facts

| 路径 | 发现的事实 | 对本阶段产出的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `handleBankTap` 当前记录银行 code 后展示 `not_supported`，不导航。 | F1/AC-1 明确从该入口改为同一卡型选择半模态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | `handleBankTap` 同样只展示 `not_supported`；页面已有 A-Z 分组和索引。 | 第二入口须与添加银行卡页复用相同开卡会话，不破坏既有浏览能力。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` | 银行模型只有 code/name/pinyin/initial/logo/badge。 | 需求须扩展每家银行支持卡型和 mock 具体卡候选。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 仅返回 20 家本地银行数据，无卡候选查询。 | 具体卡选择继续归 WalletMain 本地 mock 数据面，不引入真实银行网络。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 仅导出既有页面 builder，未导出选卡页和结果页。 | 新全屏目的页须经模块出口导出，再由 Phone 装配。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，`navDestinationMap` 最远只注册 `AllBanksPage`。 | 新目的页注册归 Phone；业务清栈策略仍由 WalletMain 计算与发起。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 首页持有来自 Phone 的同源 `@Link navPathStack`。 | 成功完成后清栈回根首页可复用现有同源栈，不另造路由体系。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | `UserProfile` 只有登录态、展示账号和头像。 | 验证码提示所需手机号须由 AccountManager mock 模型补充。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile/login` 未返回手机号；服务为本地模拟。 | 手机号来自账号 mock，短信发送同样明确为 mock。 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 只声明 CardPack/AddCardEntry/AddBankCard/AllBanks 四个目的页。 | AC-6 覆盖新增注册与旧路由不受损。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 旧 UT 已覆盖 20 家银行顺序、分组、空态与栈未挂载异常。 | 本轮测试须保留这些回归，并新增开卡状态、持久化与路由清理断言。 |
| `02-Feature/WalletMain/src/main/resources/base/element/color.json` | 已有页面背景、卡片、文字、链接蓝等资源 token。 | UI-Spec 优先引用项目 token；无可信品牌色时不凭世界知识新增品牌真值。 |

## 关键结论

- 蓝图术语事实仅有“银行卡开卡”，权威模块为 WalletMain、置信度 medium，易混 Phone 应用壳与 AccountManager 账号域；按 CU 投影写入并记录 headless must-review。
- CU `touches` 派生的可修改模块集合精确为 `WalletMain`、`AccountManager`、`Phone`；不扩展 CommUI/CommFunc。
- 成功目的地冲突按蓝图裁决：本轮成功回钱包首页并携带完整卡号；卡详情页延期。失败回最初添加银行卡页。
- 完整卡号只进入受控内存对象和应用沙箱 RDB，不显示、不写日志；UI 只显示前四后四。
- 四张参考图均需建模；结果页 NFC 激活区按需求原句登记 `excluded`，不是 defer。
- 当前无直接视觉能力，`ui-spec` 必须保持 `verified: unverified`；品牌 logo/结果插画缺可信外观绑定时使用可见占位并登记视觉债务。

## 覆盖风险

| 风险 | 处理 |
|---|---|
| OCR 对浅色按钮文案和个别协议字符识别不完整 | 逐字文案优先采用 OCR 高置信文本；需求明确给出的“下一步”等交互文案作为需求事实；残余登记盲档待复核。 |
| 无法亲自核对颜色、像素间距和素材外观 | 不猜测、不声明 VL verified；使用 reviewer sidecar 作结构旁证并保留视觉债务。 |
| 参考结果页包含 NFC 激活区域但需求明确本轮不要 | 以需求原句为上位目标，ref-elements 登记 `excluded`。 |
| 成功后“首页/详情页”两种表述冲突 | 复用蓝图已记录裁决：编号需求与“后续详情页”说明优先，本轮成功回首页。 |

## 进入产出

Research Sub-Phase 已满足：真实源码路径已读、Code Facts 覆盖三模块和数据/导航/账号边界、决策均由 CU/蓝图/需求或当前代码支撑；`ready_to_produce: true` 且无 BLOCKER 覆盖风险。

## phase_delta: plan

本阶段承接 spec 建立的有效 facts 基线，仅补充施工设计所需事实；未改写 `established_by: spec`、run 身份或原始 Code Facts。

| 路径 | 事实 | 对 plan 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/change-unit.yaml` | canonical CU revision=4，提供 3 个 provide、5 个 target predicate、18 个 design ref；touches 只解析到 WalletMain、AccountManager、Phone。 | `contracts.yaml` 必须完整生成 `change_unit_ref`、predicate/provide/design-ref 三类映射，模块范围不得越界。 |
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | development 节点已给出模型、接口、文件、组件和 use case；runtime flow 明确 RDB 幂等保存、失败结果、一次性完成上下文和定向清栈。 | plan 只做施工落位，不重裁共同设计；`use-cases.yaml` 必须物化。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1..AC-6、BD-1..BD-4、NFR-1 已闭合，AC-5 将失败目的地绑定为 `AddBankCardPage`。 | 功能映射覆盖 F1..F7，并保持成功回首页、失败回添加银行卡页。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml` | 四个 P0 屏幕、全部 token/asset/must-have 元素已登记；素材模式为 approximate，结果引导插画为 placeholder。 | 生成 `plan/visual-parity.yaml`，逐屏映射组件、资源和视觉债务；不声称已直接看图。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `handleBankTap` 仍只 Toast；页面通过 `NavPathContext.stack()` 使用宿主唯一栈。 | 复用既有页面与导航体系，仅把银行点击接到卡型 Sheet。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 分组与字母索引已经存在，银行点击仍只 Toast。 | 保留浏览行为，只替换银行点击后的开卡入口。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 银行数据是本地 async mock，尚无卡型和卡候选接口。 | 扩展现有 Repository，不新增网络层。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 跨模块出口尚未导出新增目的页 builder。 | 新页面 builder 必须从该出口导出，Phone 只能经出口装配。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，目的页映射只到 `AllBanksPage`。 | Phone 仅追加两个目的页注册，不承载开卡业务。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | `UserProfile` 尚无 `mobile`。 | 仅在账号域补 mock 手机号字段。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile/login` 尚未提供手机号。 | 保持 AccountService 为手机号唯一供给者，WalletMain 不复制账号 mock。 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 现有四个路由已登记。 | 追加两个新目的页，既有名字和顺序语义保持兼容。 |
| `02-Feature/WalletMain/src/main/module.json5`、`04-BusinessBase/AccountManager/src/main/module.json5`、`01-Product/Phone/src/main/module.json5` | WalletMain/AccountManager 是 HAR，Phone 是 entry HAP；均面向 phone。 | contracts.modules 的 format/package_path 与宿主配置对齐，不新增模块配置变更。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 当前目标包含银行卡型枚举、持有完整卡号的候选卡模型与选卡路由参数。 | `contracts.yaml` 将该文件列为候选卡和跨页面参数的施工落点；展示层只能使用脱敏卡号。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 当前目标包含成功卡号的单次 `publish/consume/clear` 进程内交接。 | 成功清栈回首页后由首页消费完整卡号并立即清除，不另建持久状态。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 当前目标包含完整卡号、成功标记和可选受控错误的结果参数。 | 写库成功或失败都进入统一结果页；完整卡号只供后台导航交接。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 当前目标包含 RDB 所需的卡号、类别、银行、银行卡型、添加时间、两项支付状态和交易记录字段。 | 数据契约覆盖需求规定的最小持久化字段集合。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 当前目标包含 `wallet_bank_cards.rdb/cards` 建表、按完整卡号幂等保存、事务回滚与列表读取。 | RDB 保存归 WalletMain data 层；失败不得留下半写记录。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 当前目标包含开卡会话、候选卡加载、OTP 门禁、卡号脱敏、持久化转换与成功/失败结果映射。 | plan 以该服务承接跨页面业务状态和保存编排，不把业务规则放入 Phone 壳。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 当前目标包含成功发布完整卡号并清栈回首页、失败清除上下文并定向返回添加银行卡页。 | 结果页唯一完成动作复用同一清栈策略，禁止返回过程页。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 当前目标包含假的短信发送、60 秒倒计时、归零后重发、仅数字输入和六位提交门禁。 | OTP 规则保持本地 mock 且可由页面时钟或 UT 驱动，不新增网络端点。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 当前目标包含按银行支持能力展示储蓄卡/信用卡单选项、协议文案和选择后可用的继续按钮。 | 两个银行入口复用同一半模态组件，并将银行与卡型传给具体选卡页。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 当前目标包含账号 mock 手机号提示、默认发送、倒计时/重发、六位数字校验与保存提交。 | 半模态只管理响应式 UI/计时器生命周期，保存结果通过回调进入结果页。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 当前目标包含无标题栏结果页、成功/失败状态、引导插画、返回拦截和唯一完成按钮。 | 页面不展示完整卡号；完成按钮调用统一定向清栈服务。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 当前目标包含银行候选卡列表、前四后四脱敏、单选、协议门禁和 OTP 半模态入口。 | 具体选卡页使用现有 `NavPathStack` 体系，并保持 ArkUI `@State` 驱动按钮响应。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 当前目标包含 14656 字节的结果引导占位素材；其外观未由本阶段直接视觉验证。 | 依 `approximate` 素材模式用于结果页，保留已登记 major 视觉债务，不冒充参考图裁图。 |

plan 决策已由上述事实解锁：三模块施工拆分、RDB 模型与接口、四屏组件/状态、统一导航链、完整 CU sidecar、UseCase 分支和视觉 parity 映射；无 scope 扩展、无架构 DSL/模块集合/职责重写。

## phase_delta: coding

本轮为 testing 返修回退，保留既有 spec 建立身份与已验证基线；仅登记当前失败证据与本阶段负责的修复事实。

| 路径 | 事实 | 影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T175459Z-004/hylyre/trace.json` | TC-001/004/005/006/007/008 均在点击 `selection_next_btn` 后找不到 `otp_sheet_title`；失败 UI 树显示协议已勾选但 `selection_next_btn.enabled=false`。 | 修复选卡页的响应式继续门禁；后续 OTP/结果失败按级联缺陷处理。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 按钮 `.enabled()` 只读取普通 `openingService` 内部状态，没有直接读取 `@State selectedCandidate/agreementAccepted`。 | UI 门禁改为以页面响应式状态判定，同时保持 service 为业务状态真源。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T175459Z-004/hylyre/trace.json` | TC-002/003 在卡型 Sheet 关闭后立即操作底层页面：展开点击未生效，重入时 Sheet 未出现。 | 修复 Sheet 关闭阶段的底层交互与延迟回调覆盖重入状态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `onClose` 与延迟 `onDisappear` 都清理状态；关闭动画期间 Sheet 容器仍可能拦截底层操作。 | 使关闭后的底层交互可达，并避免延迟回调覆盖新一轮打开。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | Sheet 内容过早随 `selectedBank=null` 消失，会让 UI 锚点先于原生遮罩退出；关闭后立即点击被遮罩吞掉。 | 保留内容到 `onDisappear` 再清理，并对关闭期重入请求做延后处理。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 与添加银行卡页复用相同 bindSheet 生命周期，存在同类关闭/重入竞态。 | 对两个入口应用一致的 Sheet 生命周期修复。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | AC-5 checkpoint 要求稳定 `home_root`，原根容器缺该 id。 | 增加验收锚点，不改变首页导航或展示语义。 |
| `doc/features/_adhoc/testing/reports/20261024-140337/hylyre/trace.json` | 当前构建从首页走到选卡并点击下一步后，`otp_sheet_title` 出现，18/18 steps 通过。 | TC-001/004/005/006/007/008 的共同 OTP 入口阻断已在当前构建复核消除。 |
| `doc/features/_adhoc/testing/reports/20261024-140906/hylyre/trace.json` | 当前构建执行卡型 Sheet 关闭后立即重入及再次关闭后点击“更多”，20/20 steps 通过。 | TC-002/003 对应的关闭动画竞态已在当前构建复核消除。 |

## phase_delta: coding

本阶段承接 spec 建立、plan 补充的有效 facts 基线；已复读 contracts、acceptance、use-cases、ui-spec、ArkTS 易错点、模块配置、页面注册、资源目录和三模块实际源码。无新增 Scope 或上游契约决策。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 账号模型尚无手机号字段，现有构造器采用可选参数对象。 | 沿现有模型补 `mobile`，不在 WalletMain 复制账号 mock。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile/login` 是本地 mock 的唯一用户资料供给。 | 两条返回路径统一提供 mock 手机号，验证码页只消费掩码。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 20 家银行为本地常量，尚无支持卡型与具体卡候选。 | 保留既有银行顺序与字段，增量补全双卡型和每类 1–2 张完整 mock 卡。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 银行点击目前只显示暂不支持；页面已使用 `NavPathContext`。 | 替换点击终点为共享卡型 Sheet，不新建路由体系。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 银行点击目前只显示暂不支持；分组、索引和返回行为已完成。 | 仅接入共享卡型 Sheet，保留旧浏览行为。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，新增目的页尚未注册。 | 仅经 WalletMain 出口追加 Selection/Result builder。 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 已有四个目的页且名称稳定。 | 追加两个新目的页，保留旧路由条目。 |
| `02-Feature/WalletMain/src/main/resources/base/media/bank_logo_cmb.png` | BankRepository 已建立招商银行用途绑定。 | 卡型、候选卡复用该 repo_ref；不声称视觉验真。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/asset-manifest.yaml` | 结果引导图明确登记为可见 placeholder 和 major 视觉债务。 | 物化独立 placeholder 资源，不冒充参考图真裁图。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` | `BankInfo` 已增加 `supportedCardTypes`，由银行 mock 数据声明实际支持的卡型。 | 卡型 Sheet 只渲染该银行支持的储蓄卡/信用卡选项。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 新增 `BankCardType`、完整卡号候选模型和选卡页路由参数。 | 卡型与完整卡号在普通数据模型中跨页面传递，界面仅消费脱敏结果。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 新增成功卡号的一次性 publish/consume/clear 上下文。 | 成功清栈回首页后可单次交接完整卡号，消费后立即清空。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 新增携带完整卡号、成功标记和受控错误码的结果模型。 | RDB 成功或失败均可进入统一结果页，完整卡号不用于界面展示。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 新增银行卡持久化记录模型，覆盖卡号、总卡类别、银行、银行卡型、添加时间、支付状态和交易记录。 | RDB 字段与 AC-4/持久化契约一一对应。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 新增 `wallet_bank_cards.rdb/cards` 建表、按完整卡号幂等保存、事务回滚和列表读取。 | 保存成功返回记录；异常不保留半写记录，唯一冲突回查既有记录。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 新增卡号脱敏、六位数字验证码校验、持久化模型与结果模型转换。 | 核心业务规则脱离 ArkUI，可由后续 UT 直接驱动。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 新增成功 publish 后清栈、失败定向返回 `AddBankCardPage` 的完成策略。 | 结果页只需调用具名 `finish`，统一执行 AC-5 清栈规则。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 新增不联网、不记录手机号的 mock 短信发送服务。 | 验证码 Sheet 出现与重发时复用同一异步入口。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 新增按银行支持能力渲染卡型、单选、协议文案和继续按钮的半模态内容。 | 两个银行入口复用同一组件，并以具名方法推进选卡页。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 新增账号手机号读取与脱敏、自动 mock 发送、60 秒倒计时、六位数字输入、RDB 保存和结果回调。 | 覆盖 AC-3/AC-4 与 BD-2/BD-3/BD-4，关闭时清理计时器和瞬态状态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 新增按银行/卡型加载 1–2 张候选卡、仅显示前四后四、单选与协议门禁、验证码 Sheet 接线。 | 实现具体卡片选择页面并通过既有 `NavPathContext` 推进结果页。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 新增无标题栏结果页、系统返回拦截、成功/失败状态和唯一完成按钮。 | 完成动作统一进入 `OpeningNavigationService.finish`，页面不显示完整卡号。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | WalletMain 出口已导出选卡页和结果页 builder。 | Phone 仅经跨模块出口注册新增目的页，不深路径引用。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 首页 `aboutToAppear` 单次消费成功卡号，并切换到有卡展示模式。 | 成功清栈回根首页后接收本次开卡结果，避免常驻监听。 |
| `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets` | 新增两个路由名、60 秒倒计时和六位验证码长度常量。 | 页面间沿既有路由规则共享稳定名称与状态参数。 |
| `02-Feature/WalletMain/src/main/resources/base/element/color.json` | 新增开卡半模态遮罩色资源。 | Sheet 视觉 token 可通过资源系统解析，不在 UI 中硬编码色值。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 新增四屏文案与动态格式资源，并按 ui-spec 将背景支持数更新为 100 家。 | 用户可见文案统一走资源键并与盲档 UI-Spec 对齐。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 新增结果页独立可见占位插画，来源仍为 asset-manifest 已登记的 approximate/placeholder。 | 满足运行时资源引用；保留 major 视觉债务，不冒充参考图真裁素材。 |

## phase_delta: review

本阶段沿用 `established_by: spec` 的既有事实基线与 plan/coding 增量；审查基线为提交 `9b37cce3281566e6d20f5071dc502866d976ebe3` 加当前工作树中的本轮实现。review 只核对契约、实现与直接调用链，不改写产品源码或上游产物。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml` | 正式范围绑定 WalletMain、AccountManager、Phone，并声明模型、接口、组件、状态流与文件清单。 | 按完整契约范围审查，不以已跟踪 diff 列表排除新增文件。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1..AC-6、BD-1..BD-4、NFR-1 是当前验收依据。 | 正常、失败、重复、倒计时、返回与隐私路径均须沿源码核对。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/structure-conformance.yaml` | coding 已登记四个 P0 屏的结构承载。 | review 逐条回看 `implemented_by` 源码；设备像素结论仍留给 testing。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/plan/visual-parity.yaml` | fidelity_target 为 pixel_1to1，asset 模式 approximate，当前 verified 为 unverified。 | 不把占位插画或未执行的真机像素核验误判为视觉 PASS；合法 defer/excluded 按目标简报保留。 |
| `02-Feature/WalletMain/src/main/ets` | 本轮实现包含新增模型、Repository、Domain Service、两个 Sheet、两个页面及既有入口接线。 | 沿完整卡号、RDB、OTP timer、NavPathStack 和完成上下文追踪业务与生命周期正确性。 |
| `04-BusinessBase/AccountManager/src/main/ets` | 账号域增加 mock mobile 供 OTP 页面读取。 | 核对旧构造调用兼容性与手机号不被 UI/日志明文泄漏。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 宿主追加 Selection/Result 两个 destination。 | 核对只经 WalletMain 出口装配且既有路由不受损。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 已核对银行卡型、完整候选卡和选卡路由参数。 | 模型与 contracts 对齐；完整卡号不得直接展示或记录日志。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 已核对成功卡号的一次性 publish/consume/clear。 | 首页消费后清空，静态链路符合完成交接契约。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 已核对成功/失败、完整卡号和受控错误字段。 | 成功失败均能携带后台完整卡号；结果页不渲染该字段。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 已核对 RDB 记录的八个持久字段。 | 字段与 contracts 对齐。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 已核对建表、事务、幂等回查、回滚和列表映射。 | 静态设计符合原子保存契约；真实 RDB 行为交 UT/testing。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 已核对卡号脱敏、OTP 校验和模型转换。 | 当前 mock 正常路径不展示完整卡号。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 已核对成功 clear 与失败 popToName 规则。 | 与当前成功回首页、失败回 AddBankCardPage 裁决一致。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 已核对本地 mock 发送无网络、无手机号日志。 | 满足当前模拟短信边界。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 出现时自动预选首个支持卡型。 | 违反未选择卡型时按钮禁用的当前契约，登记 CR-001。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 保存期间关闭仍可执行，关闭不取消在途保存及完成回调。 | 取消语义与重复结果路由风险，登记 CR-002。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 已核对成功/失败展示、返回拦截与唯一完成按钮。 | 静态结构符合；真实侧滑拦截交 testing。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选为空或加载异常时没有明确空态。 | spec E5 异常体验缺口，登记 CR-005。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 占位图缺少手机、二维码和手部引导语义。 | 不满足结果页近似引导语义，登记 CR-004。 |

## phase_delta: coding

本次为 review 回退后的 coding 窄返修；保留 `established_by: spec` 与既有基线，仅核对注入的 CR-001～CR-003，不扩展到未注入候选或其它阶段产物。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | `selectedType` 虽声明为 `null`，但 `aboutToAppear()` 会自动选中首个支持卡型。 | 删除隐式预选，恢复 BD-1 的显式选择门禁。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 保存异步开始后关闭按钮仍可触发，组件消失会把 `saving` 复位，而在途保存结束仍调用 `onFinished`。 | 保存期间拒绝显式关闭，并以组件活跃标记阻止消失后的完成回调。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 协议资源未传入当前银行与当前卡型。 | 由已加载银行和路由卡型向格式化资源传参。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | `selection_agreement` 固定写成招商银行信用卡协议。 | 改为受控的银行名、卡型格式占位，避免跨银行/卡型错误主体。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/upstream-issues.md` | 既有问题表缺少 `## 问题清单` 标题且列序不符合 `coding-upstream-issues@1`；当前 `coding/reports/script-report.json:1012` 起的同一检查已为 PASS。 | 仅修正当前阶段自有问题表格式并把陈旧问题标记为已关闭，不修改 framework。 |

设备诊断：当前构建已成功安装到登记设备，设备门通过；临时导航脚本在首页首步未找到“添加管理卡片”，未到达目标页面，诊断 trace 为 `doc/features/_adhoc/testing/reports/20261024-123725/hylyre/trace.json`。因此本轮不声称完成真机交互复核，卡型初始态、动态协议展示和保存期关闭行为仍由后续正式 testing 验收。

## phase_delta: review

本次为 CR-001～CR-003 定向返修后的复审；保留 `established_by: spec` 与原始事实基线，仅登记返修文件及直接影响，不重启无边界审查。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | `aboutToAppear()` 重置为未选择态，卡型仅由用户点击赋值，继续动作保持双重空值门禁。 | CR-001 已修复。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 保存期间显式关闭被禁用；组件消失后以 `isActive` 阻止在途保存回调继续导航。 | CR-002 已修复，未发现直接回归。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 协议文案从当前银行与路由卡型取得动态格式参数。 | 与资源改动共同关闭 CR-003。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | `selection_agreement` 使用银行名、卡型两个受控占位。 | CR-003 已修复。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 仍为抽象占位，缺少手机、二维码与手持语义。 | 沿用 `plan/visual-parity.yaml` 已登记的 best-effort major 视觉债务；不阻断 review，发布前必须替换并重验。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选加载仍无异常/空态说明。 | 保留 CR-005（MINOR），不扩大本次返修范围。 |

## phase_delta: ut

本阶段承接 `established_by: spec` 的既有事实基线，只追加业务级 UT 的真实可测性结论；未改写需求、契约、实现或 review 产物。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1、AC-2、AC-3、AC-4、AC-6 与 BD-1..BD-4 均声明 `ut_layer: both`；其具体预期与本轮断言分类逐条命中。 | 这些条目不能因当前实现不可测而静默降级；L3 必须回 owning phase 修复接缝或经有效需求修订。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml` | `UC-1` 把 `BankCardOpeningService` 声明为 coordinator，并要求成功/失败分支具有完整阶段序列和 `BankCardRepository.save` 调用。 | UT 必须驱动真实业务入口，不能在测试内重写 coordinator。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 当前仅有 `maskCardNumber`、`isValidOtp`、`toStoredCard`、`toOpeningResult`，没有 state、Repository 依赖或保存分支入口。 | AC-2 局部规则为 L0；完整 UC-1、AC-4 与 BD-3 命中 L3。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | `RdbStore` 由私有 `openStore()` 创建并缓存，事务与查询/插入/回滚无可替换边界。 | 真实 RDB 原子性与失败恢复不能在单元隔离下预设，需 coding 最小接缝。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 定义 `BankCardType`、完整卡号候选与选卡路由参数。 | 为 AC-2/AC-4 fixture 提供真实类型；不产生状态序列。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | `publish/consume/clear` 实现一次性进程内卡号交接。 | 可做 L0 状态所有权断言，但不能替代成功分支与清栈实测。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 结果对象保留完整卡号、成功标记和可选受控错误。 | 可直接断言 AC-4 的结果映射字段。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 持久化模型包含卡号、类别、银行、卡型、添加时间、两项支付状态和交易记录。 | 可直接断言转换结果字段；RDB 原子性仍需接缝。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | `finish()` 直接依赖 `NavPathStack`，成功 clear、失败 popToName。 | AC-5 是 device-only；UT 不导入导航运行时。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | `sendMockCode()` 是无网络的异步空实现。 | 可作为可注入边界，但当前 OTP 组件未把状态机开放给 UT。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 卡型选择与继续门禁位于组件私有状态/方法。 | AC-1/BD-1 命中 L3，需要无 UI session 入口。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 发送、倒计时、重发、保存和取消清理编排位于 ArkUI 组件。 | AC-3、BD-2、BD-4 没有 UT 白名单允许的真实入口，需提取无 UI 状态对象。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选加载、选卡与协议门禁位于页面私有状态/方法。 | AC-2 的数据规则可测，但 BD-1 的组合门禁仍为 L3。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 完成动作直接消费 `NavPathContext.stack()`。 | 真实结果页退出与手势行为交 device testing。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 新旧目的页注册位于 `@Entry`/`Navigation` 宿主代码。 | AC-6 的真实注册/往返不能由 UT 直接构造；需非 UI 路由决策入口或上游有效分层修订。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 实际图像是灰色抽象占位，与 review 记录一致。 | 不纳入 UT；保留 testing/release 的视觉债务。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 现有测试仍属于上一需求，标签为 AC-14/AC-16/AC-G3 等，不对应本 CU。 | 保留其字节与注册关系，但不得计入当前 AC/BD 覆盖。 |

预期来源核对：上述正确性结论逐条来自 `acceptance.yaml` 对应 AC/BD 原文；实现与既有测试只用于判断当前可执行事实，不被当作预期来源。当前没有新增断言，因此无需登记 characterization 用例。

## phase_delta: coding

本次为 UT 可测性审计回退后的 coding 窄返修；保留 `established_by: spec` 与既有基线，逐项核实 AC-1、AC-3、AC-4、AC-6、BD-1～BD-4 的 option_b 候选，不改写验收语义或 UT 产物。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 当前仅提供脱敏、OTP 校验和模型转换，没有统一承载卡型、卡片、协议、OTP 门禁与保存分支的无 UI session。 | 在现有 domain service 文件内增加最小 opening-session 状态与 repository 注入编排，供页面和 UT 共用。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 当前只有 mock 发送方法；倒计时、重发、输入和取消状态全部位于 ArkUI 组件。 | 增加可注入 `OtpService`、由调用方驱动 tick 的无 UI OTP 状态对象。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 当前 Repository 私有创建 `RdbStore`，事务、查询、插入和回滚无法由 Spy 驱动。 | 引入最小 store wrapper 注入，生产仍使用唯一 RDB wrapper。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 显式卡型选择门禁只存在于组件私有状态。 | 组件改为消费 opening session，不改变初始未选中语义。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 自动发送、倒计时、重发、验证码校验、保存与取消清理均由组件私有字段直接编排。 | 组件改为消费 OTP/opening session；保存期间保持不可关闭，消失后取消在途完成回调。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 卡片与协议组合继续条件只存在于页面私有字段判断。 | 页面复用 opening session 的组合门禁并把真实选择同步到 session。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 新旧目的页集合只编码在 `@Entry` 的 builder 分支中。 | 提取无 UI 路由识别入口，并由 builder 实际消费。 |

## phase_delta: review

本次为 UT 可测性回退返修后的定向复审；保留 `established_by: spec`、run 身份和既有事实基线，只登记本轮新增/变化源码及其直接影响，不重启无边界审查。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 新增 `BankCardStore` 与 `RdbBankCardStore`，`BankCardRepository` 支持构造注入；生产默认仍落到同一 RDB wrapper。 | 核对事务、幂等回查、异常映射及生产路径未被测试接缝替换。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 新增 repository 注入的 `saveCandidate` 和无 ArkUI 的 `BankCardOpeningSession`；页面继续消费真实候选与门禁。 | 核对卡型、卡片、协议、OTP 组合门禁及成功/失败结果映射。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 新增可注入发送服务、显式 tick/resend/cancel 的 `OtpVerificationState`。 | 核对自动发送、60 秒窗口、快速重复点击与取消清理未改变产品语义。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 卡型 Sheet 改为消费 `BankCardOpeningSession`，初始仍未选中。 | CR-001 保持关闭；继续按钮门禁无直接回归。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 页面把银行、卡型、候选与协议状态同步到同一个 opening session，并把 session 传入 OTP Sheet。 | 选卡与协议门禁仍由实际 UI 调用；既有 CR-005 空态缺口未变化。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | Sheet 改为消费 `OtpVerificationState`/`BankCardOpeningSession`，生产保存仍创建真实 RDB Repository。 | 自动发送、倒计时、验证码门禁、保存期关闭保护和消失后回调抑制均保持。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | 新增新旧钱包目的页的无 UI 识别入口。 | Phone 内部职责未外溢；作为本轮新增源码纳入复审与追溯。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `navDestinationMap` 在既有 builder 分支前实际调用 `isWalletDestination`。 | 新接缝不是测试专用死代码；旧路由和两个新增路由仍由原 builder 分支承载。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 现有旧需求测试载体字节未因本轮生产接缝返修改变。 | 本阶段只读核对，不越界补写下一阶段 UT。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` | 既有银行数据 Spy 仍只服务旧测试，不参与生产路径。 | 不把旧测试当作本 CU 已覆盖；后续 UT 需针对新接缝增加真实断言。 |

## phase_delta: ut

本次在 coding 可测性返修与 review 收口后恢复 UT；保留原始 `established_by: spec` 基线，只登记当前 UT 真实消费事实和本阶段拥有的测试文件。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | `BankCardOpeningSession` 与 repository 构造注入已存在，上一轮 AC-1/AC-4/BD-1/BD-4 的 L3 原因消失。 | 可直接驱动组合门禁和成功/失败保存结果。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | `OtpVerificationState` 提供 start/resend/tick/updateOtp/cancel 且依赖可注入。 | AC-3、BD-2、BD-4 可由 Spy 验证发送序列、倒计时与清理。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | `BankCardStore` 与构造注入已存在，真实 Repository 保存编排可隔离系统 RDB。 | AC-4、BD-3 可覆盖事务、幂等和异常回滚。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | Phone 根导航实际消费的纯函数路由集合已存在。 | AC-6 可由 Phone ohosTest 覆盖新旧目的页共存。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 新增当前 CU 的 AC-1/2/3/4/6、BD-1..4 与 BR-SUCCESS/BR-FAILURE 用例。 | 成为 contracts.change_unit test_refs 的 canonical 证据载体。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankCardOpeningDependencies.ets` | 新增 Repository、Store、OtpService 的强类型 Spy/Fake。 | 隔离系统 IO，同时保留调用序列和失败预设。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` | 旧银行卡列表 legacy suite 仍真实引用该既有 Spy。 | 纳入当前测试目标 facts 覆盖，但不作为本 CU AC/BD 证据。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets` | 原 `bank_open_card_ut.test.ets` 的旧银行卡列表用例原样迁移并继续注册。 | 保留既有回归，不让历史 UI import 混入当前 CU 测试文件。 |
| `01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets` | 新增纯路由注册回归用例。 | 直接证明 AC-6 的 Phone 路由集合。 |

预期来源核对：每条新增正确性断言均对照 `acceptance.yaml` 的同名 AC/BD 原文；BR-SUCCESS/BR-FAILURE 对照 `use-cases.yaml`。源码只提供入口和当前事实，不充当预期来源。

## phase_delta: ut

独立 verifier 对脚本 PASS 材料复核后确认：局部测试不能冒充 `use-cases.yaml` 的完整分支证据。本节只追加新证据，不改写此前真实通过的局部测试事实。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml` | BR-SUCCESS/BR-FAILURE 要求完整阶段序列及候选、OTP、保存、完成调用。 | 完整分支标签只能放在驱动同一真实协调入口的用例上。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | service/session 分别覆盖门禁与保存，但没有统一阶段状态，也未注入候选、OTP 与完成策略。 | AC-4 的完整分支仍为 L3；形成 UT-004 coding repair candidate。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 已移除三个局部用例上不真实的 BR-SUCCESS/BR-FAILURE 标签，保留其精确 AC/BD 断言。 | 防止局部规则测试被误算为端到端分支覆盖。 |

## phase_delta: coding

本次针对 UT-004 / AC-4 回退候选做窄返修；继续保留原始 `established_by: spec` 和既有事实基线，不修改 contracts、acceptance 或 UT 产物。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | `BankCardOpeningService` 现由既有 `BankRepository`、`OtpVerificationState`、`BankCardRepository` 和 `BankCardOpeningSession` 组合候选加载、OTP、保存及 ENTRY→RESULT 阶段状态。 | AC-4 成功/失败链获得无 ArkUI 的真实协调入口；未新增 Port 或平行存储真源。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 页面创建生产 RDB Repository 与 OTP 状态后，把选卡、协议及候选加载事件转发给同一 `BankCardOpeningService`。 | 协调入口由真实产品页面消费，不是测试专用死代码。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | Sheet 将自动发送、重发、tick、输入校验和保存完成转发给父页传入的同一 service；保存期间关闭保护和消失后回调抑制仍保留。 | UI 只同步可渲染状态，AC-4 保存结果及阶段可由后续 UT 直接断言。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | `walletDestinationNames()` 同时列出四个既有钱包目的页和两个本轮新增目的页，`Phone/pages/index.ets` 在 builder 分支前实际调用 `isWalletDestination()`。 | 该前轮路由接缝继续作为 AC-6 真实生产消费事实；本次 AC-4 窄返修不修改其字节。 |

## phase_delta: review

本次为 UT-004 / AC-4 协调入口窄返修后的定向复审；保留 `established_by: spec`、run 身份及全部既有事实，只核对既有意见、当前返修和直接回归。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | service 组合既有候选、OTP、RDB 与 session 边界，统一暴露候选加载、OTP、保存完成及 `ENTRY→RESULT` 阶段/结果状态。 | AC-4 获得可由 UT 驱动的真实生产协调入口；未新增平行状态真源或测试 fast path。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 页面构造生产 `BankCardRepository` 和 `OtpVerificationState`，并将候选、选卡、协议与 Sheet 事件转发给同一 service。 | 证明协调入口被产品调用链消费；既有 CR-005 空态缺口未变化。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | Sheet 转发 OTP 启动、重发、tick、输入与 `completeOpening`，仅镜像渲染所需状态。 | 成功/失败结果继续来自真实保存路径；CR-002 的保存期关闭保护与消失后回调抑制保持。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 返修后 coding verdict=PASS，生成时间 2026-10-24T17:20:13.633Z，保证等级 full。 | 复用最新编译与 coding 机器门禁；review 不重复执行无新增信息的全量编译。 |

## phase_delta: ut

本次 UT 返修继续保留原始 `established_by: spec` 基线；补登记 harness 当前目标中已有的两个 suite 注册入口，不改写上游事实。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets` | 注册 `bankOpenCardUtTest` 与既有 legacy suite。 | 当前 CU 的 WalletMain 用例会进入真实 Hypium suite。 |
| `01-Product/Phone/src/ohosTest/ets/test/List.test.ets` | 注册 `walletDestinationRegistryTest` 与既有 Ability suite。 | AC-6 的 Phone 路由回归会进入真实 Hypium suite。 |

## phase_delta: testing

本阶段沿用 `established_by: spec` 的已验证基线，只补充真机计划、执行锚点与视觉证据所需事实；不修改需求、设计、产品源码或 UT。

| 路径 | 事实 | 对 testing 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1..AC-6、BD-1..BD-4 均为 `device` 或 `both`；NFR-1 要求本地交互目标不超过 300ms。 | 测试计划覆盖全部 AC/BD；当前 Hylyre 无校准时延采样原语，NFR-1 以 `manual:perf_sampling` 如实保留。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 添加银行卡页以 `col_row_cmb` 打开共用 `CardTypeSheet`，并保留旧的展开与全部银行入口。 | AC-1 主入口和 AC-6 旧路由均可通过稳定 `id` 驱动。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 全部银行页以 `ab_row_cmb` 打开同一 `CardTypeSheet`。 | AC-1 第二入口单独设计真机用例，避免只验证一个入口。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | Sheet 暴露标题、关闭、卡型、协议和继续按钮的稳定 `id`，继续按钮在未选卡型时禁用。 | 卡型单选、取消重入和初始门禁可用 Hylyre 驱动。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 选卡页暴露候选、协议、下一步与 OTP Sheet 的稳定 `id`；候选 UI 只渲染掩码卡号。 | AC-2、BD-1 与 OTP 入口可由真机步骤和 checkpoint 断言覆盖。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | OTP Sheet 出现即发送，使用数字输入、60 秒倒计时、关闭清理和六位验证码门禁。 | AC-3、BD-2、BD-4 分别以输入、等待重发和关闭重入用例覆盖。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 结果页拦截 `onBackPressed`，唯一退出动作为 `result_finish_btn`。 | AC-5 以返回拦截和完成清栈路径验证。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 当前根 Column 未声明 acceptance checkpoint 所引用的 `home_root`。 | testing 不改产品源码；保留 AC-5 原 checkpoint，让 native 证据与 harness 如实判定并在失败时交回 coding。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml` | 四个 P0 屏为 `card_type_sheet`、`bank_card_selection`、`otp_verification_sheet`、`opening_result_success`，fidelity 为 `pixel_1to1`。 | 建立四屏 `visual-diff-nav.json`，由正式 visual capture/diff 链采集与裁决。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 候选卡在后台持有完整卡号，路由参数由银行 code 与卡型组成。 | 真机只断言掩码 UI；完整卡号传递与候选筛选复用 UT 证据。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 成功完整卡号使用一次性 publish/consume/clear 上下文交给首页。 | AC-5 以完成后回首页及过程页消失为设备可观察结果，不在 UI 读取完整卡号。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 成功/失败结果均携带完整卡号、布尔结果与受控错误码。 | 结果页设备测试只断言状态文案与导航；敏感参数不进入 selector、截图文案或日志。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 持久化模型包含卡号、类别、银行、银行卡型、添加时间、支付状态与交易记录。 | 成功设备链走真实 RDB；字段完整性与原子性继续由 UT 负责，避免 UI 重复验证内部字段。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 生产页面使用真实 RDB wrapper，当前产品包没有可由 Hylyre安全触发的失败注入入口。 | 成功路径真机执行；BD-3/失败结果页登记 `manual:data_injection`，不添加测试行为开关。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 统一协调候选、协议、OTP、保存与 RESULT 阶段，页面真实消费该 service。 | 端到端成功用例沿产品入口驱动，不采用测试专用 fast path。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 成功 clear 回首页，失败定向 pop 到 `AddBankCardPage`。 | AC-5/BD-3 的设备预期分别绑定首页与添加银行卡页。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | mock 发送状态由 60 秒 countdown 门禁控制，归零后可重发。 | TC-006 保留一轮真实 60 秒等待，不缩短产品常量。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 结果页当前使用已登记的近似占位插画。 | 不把文件存在当视觉通过；`pixel_1to1` 由本轮截图与参考图真实裁决。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | 新旧六个钱包目的页由纯路由集合统一识别并被 Phone 根导航消费。 | AC-6 真机回归覆盖旧页面往返，并由当前装机包验证新增目的页可达。 |

## phase_delta: review

本次为 testing 回流返修后的定向复审；保留 `established_by: spec` 与既有基线，只登记当前返修事实、窄真机证据及直接回归，不重启无界审计。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选与协议同步到页面 `@State` 以驱动按钮响应式重算，实际打开 OTP 时仍由 `BankCardOpeningService.canOpenOtp()` 校验。 | TC-001/004/005/006/007/008 的共同禁用按钮根因按代码关闭，未形成平行业务真源。 |
| `doc/features/_adhoc/testing/reports/20261024-140337/hylyre/trace.json` | 当前构建从选卡进入 OTP 的 18/18 步通过。 | 为上述共同根因提供当前构建窄真机证据；不替代后续正式 testing 全量重跑。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 显式关闭/继续路径设置 dismissing，关闭期重开使用 pending 队列，`onDisappear` 后清理或重开。 | TC-002/003 的显式关闭竞态按代码关闭；系统关闭原因未在消失前统一置 dismissing，形成 CR-006 MINOR。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 与添加银行卡页使用对称的 Sheet 生命周期协调。 | 主入口修复逻辑一致；全部银行入口仍需正式 testing 覆盖系统关闭边界。 |
| `doc/features/_adhoc/testing/reports/20261024-140906/hylyre/trace.json` | 当前构建关闭、重开、再次关闭及点击“更多”的 20/20 步通过。 | 为显式关闭竞态提供当前构建窄真机证据。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 根容器新增稳定 `home_root` id。 | AC-5 完成后首页 checkpoint 可绑定，不改变导航或展示语义。 |

## phase_delta: ut

本次在 testing 回流返修及定向 review 闭环后恢复 UT。保留 `established_by: spec` 与此前已验证的 UT 基线；最新产品改动只涉及页面响应式状态、Sheet 生命周期协调和设备 checkpoint，不改变可脱离 ArkUI 驱动的业务入口或既有 UT 断言语义。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 现有用例继续覆盖 AC-1/2/3/4、BD-1..4 与 BR-SUCCESS/BR-FAILURE，调用的 service、OTP、Repository 签名未被最新返修改动。 | 复用当前测试字节并真实重跑，无需新增或改写断言。 |
| `01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets` | 路由注册回归仍覆盖 AC-6；最新返修未修改 `WalletDestinationRegistry`。 | 复用 Phone suite 并真实重跑。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets` | 当前 suite 注册 `bankOpenCardUtTest` 与 legacy suite。 | WalletMain 目标用例可由正式 harness 执行。 |
| `01-Product/Phone/src/ohosTest/ets/test/List.test.ets` | 当前 suite 注册 `walletDestinationRegistryTest`。 | Phone 路由用例可由正式 harness 执行。 |

## phase_delta: testing

本轮复用 `established_by: spec` 基线与既有 testing 计划；根据当前 HAP 的原生失败截图，仅修正 testing 自有的执行导航，不改产品源码、UT 或需求 SSOT。

| 路径 | 事实 | 对 testing 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T183031Z-701/hylyre/failures/TC-001-step-35.png` | 六位验证码输入完成后系统键盘仍展开，`otp_next_btn` 位于键盘遮挡区且 native selector 不可见。 | 新派生计划在 OTP 提交前先执行系统返回收起键盘，并再次断言 `otp_sheet_title`，再点击下一步。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T183031Z-701/hylyre/failures/TC-002-step-18.png` | 全部银行页已正确到达；招商银行位于当前视口以下，直接 `touch ab_row_cmb` 无候选。 | 新派生计划先 `scroll_to ab_row_cmb` 再点击，保持同一业务预期。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T183031Z-701/hylyre/failures/TC-007-step-26.png` | OTP 关闭重入后输入框已清空且倒计时重新开始；TextInput placeholder 未作为独立 `by_text` 节点暴露。 | TC-007 改用稳定 `otp_input` id 验证输入框重现，倒计时仍用可观察文案断言。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T184500Z-agentfix/hylyre/test-plan.hylyre.md` | 仅补齐列表滚动、键盘收起与 TextInput id 断言，顶层 TC 集合和执行通道未变化。 | 用新 execution key 重跑九条 Hylyre 用例，旧 trace 保持只读。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/device-testing/visual-diff-nav.json` | 结果页视觉导航在 OTP 输入后增加收起键盘与 OTP 身份复核。 | 允许 `opening_result_success` 在不改产品行为的前提下到达并采集当前截图。 |

## phase_delta: coding

本轮承接既有 spec 基线与 testing 回流证据，仅处理 OTP 六位输入后按钮仍禁用的共同产品根因，不改需求、测试计划或正式 testing 证据。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T185039Z-266/hylyre/trace.json` | TC-001 step 38、TC-005 step 32、TC-008 step 25 均在六位验证码已输入且 OTP Sheet 仍显示后，点击下一步未进入结果页。 | 三条回修候选归并为同一 OTP 提交按钮响应式门禁缺陷。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T185039Z-266/hylyre/failures/TC-001-step-38.json` | UI 树中 `otp_input.text=123456`，但 `otp_next_btn.enabled=false`。 | 证明失败发生在按钮可用态投影，不是结果页路由或 RDB 保存失败。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | `otp` 已是页面 `@State`，输入时同步到 service；按钮可用态却只调用读取普通 service 字段的 `canSubmit()`。 | 按钮渲染显式读取 `@State otp`，点击后的保存仍保留 service 最终校验，避免平行业务真源。 |

## phase_delta: review

本次复审保留 `established_by: spec` 与全部既有基线，只登记最新 OTP 回流返修及其直接影响。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 当前按钮的 `enabled`、文字色和背景色显式读取页面 `@State otp`；输入变化仍同步到 `BankCardOpeningService`，保存入口仍调用 `openingService.canSubmit()`。 | 修复 testing UI 树证明的响应式投影缺陷，同时保留 service/session 的最终业务门禁；未形成 fast path 或平行业务真源。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T185039Z-266/hylyre/trace.json` | TC-001/005/008 的失败均发生在旧构建六位 OTP 可见但按钮禁用；TC-002 是 selector ambiguous。 | 三条 coding 候选归并为已返修的共同根因；TC-002 继续归 testing 重派生，不扩大 coding 范围。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 最新 coding 编译、verifier 与 receipt 均 PASS，生成时间 2026-10-24T19:03:18.131Z。 | 复用相称的机器证据，不重复编译；返修后的设备实效仍由下一轮正式 testing 验证。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml` | 四个 P0 `pixel_1to1` 屏共声明 34 个 must-have；其中 `background_search_bank` 同时在 `ref-elements.yaml` 标为 `implement`。 | review 必须全覆盖核对，不能由 16 条结构台账替代。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 当前背景页实现标题、副标题和银行列表，但没有 `background_search_bank` 对应的搜索输入或文案；WalletMain 主源码和资源全局检索亦无“搜索银行”。 | 形成 CR-007 BLOCKER；归 coding 补齐既有页面，不修改 spec 或扩大需求。 |
## phase_delta: review

本次为 CR-007 搜索行返修后的限界复审；保留原始 `established_by`、run 身份和既有事实基线，只追加当前返修及直接影响。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 新增 `searchRow()`，收起态与展开态均在副标题和银行白卡之间渲染稳定 id `background_search_bank`；该 builder 不挂点击事件。 | CR-007 的 must-have 承载已补齐，且未接管银行点击、Sheet 状态或路由调用链。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 新增 `add_bank_card_search_placeholder` 与 `add_bank_card_search_action`，值分别为“搜索银行”“搜索”。 | ref-elements 文案改用资源承载，无新增硬编码字符串。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 当前返修后 coding verdict 为 PASS，generated_at 为 `2026-10-24T19:16:45.224Z`。 | 复用与实际改动相称的编译/静态门禁，不在 review 重复全量构建。 |
| `doc/features/_adhoc/testing/reports/measure-20261024-151528/shot-card_type_sheet.png` | 当前构建已在真机渲染搜索行，设备量测定位 `background_search_bank=[48,454,1272,586]`；导航 8/8 步通过。 | CR-007 有真实渲染与可达证据；完整像素和交互仍由 testing 负责。 |

独立 Claude Code CLI 指出新增 56vp 搜索行会使旧 `bc-openCard-1` 收起态七行布局减少一行。当前有效目标明确要求参考图中的搜索行，而本 CU 的旧行为兼容验收只约束路由名称和返回语义；该视觉变化按当前目标裁决为授权替换，不形成返修候选。

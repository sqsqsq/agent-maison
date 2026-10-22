---
schema_version: "1.1"
feature: "cu-YmMtb3BlbkNhcmQtMgBjb21wbGV0ZS1iYW5rLWNhcmQtb3BlbmluZw"
run_id: "20261020T093340Z-1a0796"
established_by: spec
phase: spec
ready_to_produce: true
has_blocker_coverage_risk: false
key_inputs_read:
  - "doc/glossary.yaml — 已完整读取并按易混项消歧"
  - "doc/module-catalog.yaml — 已完整读取并核对职责与 NOT_responsible_for"
  - "doc/architecture.md — 已完整读取并核对分层、依赖与跨模块出口"
  - "framework/specs/phase-rules/spec-rules.yaml — 已读取当前 spec 结构与视觉门禁"
  - "framework/profiles/hmos-app/skills/spec/profile-addendum.md — 已读取 hmos-app 补充"
  - "doc/features/bc-openCard-2/blueprint/component-blueprint.yaml — 已读取 revision 4 的术语、开发视图、运行流与持久化契约"
  - "doc/features/bc-openCard-2/complete-bank-card-opening/change-unit.yaml — 已读取 canonical CU purpose、touches、predicates 与 invariants"
  - "doc/features/原始需求/1-2-银行卡/原始需求.md — 已读取需求原文"
  - "build-profile.json5 — 已读取模块物理路径、HarmonyOS SDK 与产品配置"
source_code_paths:
  - "01-Product/Phone/src/main/ets/pages/index.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/index.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets"
  - "02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/index.ets"
exploration_mode: sequential
change_intent: feature
estimated_loc_delta: 1500
touches_layers:
  - presentation
  - domain
  - data
adds_new_exports: true
single_function_scope: false
decisions_unlocked:
  - "投影 CU 的 WalletMain、AccountManager 精确 Scope，不在 spec 扩展模块"
  - "定义两个既有银行入口共用的完整开卡旅程与清栈结果"
  - "定义完整卡号后台/RDB处理、前四后四展示和失败原子性验收"
  - "定义 60 秒验证码状态机与六位数字输入验收"
  - "按四张参考图、OCR 与观察 sidecar 建模四个 P0 屏幕"
  - "将缺失的结果引导插画登记为可见占位视觉债务"
subagents_used: ""
searches_performed_estimate: 12
files_inspected_count: 31
---

## 探索预算与检索

- 检索既有银行卡入口、银行 Mock、卡片仓储、模块出口与 Phone 根导航注册，确认当前路由和数据责任。
- 检索 AccountManager 的 `UserProfile` 与 `AccountService`，确认当前没有可供验证码提示使用的完整 Mock 手机号。
- 检索 WalletMain 资源目录，确认 20 家银行 logo 已存在且用途由 `BankRepository` 明确；未发现与结果页手机/手引导插画目的相符的资源。
- 读取四份 OCR JSON 与四份只读视觉观察 sidecar；本执行者无视觉能力，不把 sidecar 当作自身看图结论。

## 已检视文件与原因

| 路径（相对仓库根） | 为何读 |
|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 核实现有银行点击行为、页面状态与 `NavPathContext` 用法 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 核实全部银行页的同类点击行为和返回约定 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 核实 20 家 Mock 银行与已有 logo 资源引用 |
| `02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets` | 核实当前仅有卡种展示数据、尚无 RDB 写入 |
| `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets` | 核实现有路由名、去抖与日志常量 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 核实 WalletMain 跨模块导出口 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 核实唯一 `NavPathStack`、现有 `navDestination` 注册方式 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 核实用户模型当前字段 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | 核实 Mock 账号来源与登录/未登录返回行为 |
| `04-BusinessBase/AccountManager/src/main/ets/index.ets` | 核实账号域跨模块导出口 |

## Code Facts（代码事实，BLOCKER 级必填）

| 路径 | 发现的事实 | 对本阶段产出的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `handleBankTap` 仅记录银行 code 并显示 `not_supported`，不导航。 | AC 必须明确替换为卡类型半模态，且保留错误提示/可恢复性。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | `handleBankTap` 与添加银行卡页同样只提示暂不支持。 | 两个入口必须调用同一开卡行为并纳入路由回归。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 当前 20 家银行只有展示字段与 logo，未声明支持卡类型或候选银行卡。 | 本需求需扩充 Mock 银行能力与每类 1–2 张候选卡。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets` | 当前只返回卡种与首页展示状态，没有数据库、表或保存方法。 | `CardRepository` 必须成为 `wallet_cards` RDB schema 与写入唯一 owner。 |
| `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets` | 路由名集中于 `BankConstants`，现有去抖窗口为 500ms。 | 新页面/操作继续复用既有路由规则和常量入口，不另建导航真源。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 当前只导出既有卡包/添卡/银行页面 builder。 | 新 `NavDestination` builder 如需跨模块装配，必须由此出口导出。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，`aboutToAppear` 绑定 `NavPathContext`，路由由同一 `navDestinationMap` 分发。 | 结果清栈与新增页面必须消费同一栈；验收覆盖旧路由不受损。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | `UserProfile` 仅含登录态、展示账号与头像，无手机号。 | 验证码提示所需手机号必须由蓝图授权的账号模型提供，UI 只展示脱敏值。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile()` 未登录也返回模型，但当前没有完整 Mock 手机号字段。 | 规范要求登录/未登录均能取得同一非秘密 Mock 手机号，避免 UI 自造账号数据。 |
| `04-BusinessBase/AccountManager/src/main/ets/index.ets` | `UserProfile` 与 `AccountService` 已经由唯一入口导出。 | 新手机号字段沿既有导出类型传播，不新建跨模块深路径引用。 |
| `02-Feature/WalletMain/src/main/resources/base/media/` | 20 家 `bank_logo_*` 均存在且由 `BankRepository` 明确引用；没有用途明确的结果页手机/手引导插画。 | 银行 logo 可登记 `repo_ref`；结果引导插画必须登记 placeholder 与视觉债务。 |
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | 开发节点模块集合为 WalletMain、AccountManager；Phone 仅作为单栈装配/写引用事实。 | spec `in_scope_modules` 精确投影这两个模块，`expansions_with_user_approval` 为空。 |

## 关键结论（支撑本阶段产出）

- 本 CU 是一次性完整旅程：入口、选类型、选卡、短信验证、RDB 写入、结果页与清栈不可拆分成可见半成品。
- `WalletMain` 拥有 UI、临时会话、开卡服务、Mock 候选卡和 RDB；`AccountManager` 只提供账号 Mock 手机号；既有 Phone/CommFunc 单栈机制保持不变。
- 成功结果按蓝图 revision 4 的明确裁决清栈回钱包首页；需求页面说明中“跳卡详情页”属于未来版本，不进入本期。
- 完整卡号只允许存在于后台对象、RDB 和结果传参，UI/日志/失败输出只显示掩码或非敏感状态。
- 四张参考图全部属于 P0 屏幕分母；NFC 激活区域按需求原句登记 `excluded`，不是 defer。

## 覆盖风险（诚实声明）

| 风险 | 处理 |
|---|---|
| 执行者无视觉能力，不能自行核验颜色、像素尺寸和插画外观 | OCR 提供逐字文本与位置，结构来自需求和只读观察 sidecar；`verified: unverified`，未知样式进入盲审待复核/视觉债务 |
| 结果页引导插画没有用途明确的仓内资源 | 在 asset manifest 中登记可见 `illustration` placeholder；不复用用途不符的营销或卡包插画 |
| 参考图只展示成功结果状态 | 成功屏按参考图建模；失败状态按需求定义同结构的状态变体，不虚构失败插画或额外文案 |

## 进入产出

Research Sub-Phase 已完成：真实源码路径、Code Facts、视觉输入、CU 范围与决策均已核对；可以生成 spec 阶段主产物。

## phase_delta: plan

### 本阶段新增代码与设计事实

| 路径 | 事实 | 对 plan 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | revision 4 的 typed contracts 已授权 17 个施工文件，包含 WalletMain UI/data/domain、AccountManager profile 与 Phone 根路由装配；未授权 WalletMain 资源文件。 | `contracts.files` 必须完整保留蓝图写集，plan 不自行加入 `string.json`、`color.json`、`float.json` 或媒体文件。 |
| `doc/features/bc-openCard-2/complete-bank-card-opening/change-unit.yaml` | canonical CU 含 4 个 predicate、1 个 provide、14 个 design_ref；touches 派生的可修改模块集合为 `WalletMain`、`AccountManager`。 | `contracts.change_unit` 必须覆盖全部稳定 ID；`contracts.modules` 只声明两个可修改业务模块。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 银行点击仍只显示 `not_supported`；页面通过 `NavPathContext.stack()` 使用宿主唯一栈。 | 改造 `handleBankTap` 为统一开卡入口，并保留既有返回、全部银行和错误恢复行为。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 全部银行页拥有同样的 `handleBankTap` 暂不支持行为。 | 两个入口调用同一 `BankCardOpeningService.start`，不得复制第二套流程状态。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `navDestinationMap` 目前只注册既有四个 WalletMain builder。 | 按蓝图写集增加具体卡片页与结果页 builder 装配，继续使用同一 `NavPathStack`。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets` | 当前只提供卡分类与本机卡布尔值，没有 RDB 初始化、写入或读取。 | 在同一 Repository 增加 `wallet_cards.db` schema v1 与保存/读取能力，保持唯一持久化 owner。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 不含“选择卡类型”“输入验证码”“添卡成功/失败”等新页面文案资源键。 | 这是蓝图授权写集未覆盖的施工缺口；plan 不越权补资源文件，交 authoritative-content/harness 诚实裁决。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 当前模型没有 `phoneNumber`。 | 在既有模型增加非秘密完整 Mock 手机号字段，由 WalletMain 读取后脱敏。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | 登录与未登录 profile 都由同一服务创建，但当前未注入手机号。 | `getUserProfile`、`login` 返回同一 Mock 手机号，不新增账号真源。 |
| `02-Feature/WalletMain/src/main/module.json5`、`01-Product/Phone/src/main/module.json5` | WalletMain 是 HAR，Phone 是 entry HAP；本期不改变模块格式或部署单元。 | `contracts.modules` 保持既有格式，Phone 仅做蓝图指定的根路由装配接线。 |

### 本阶段裁决与可施工结论

- Scope 精确继承 canonical CU：`WalletMain`、`AccountManager`，不发起 plan 内扩展；Phone 文件仅按蓝图既有路由装配写集映射，不把 Phone 业务责任并入 `contracts.modules`。
- 复用现有单 `NavPathStack`、`NavPathContext`、`BankRepository`、`CardRepository` 与 `AccountService`；不新增平行路由、账号或持久化真源。
- 蓝图运行流包含多步交互、写库失败恢复、结果发布/消费和生命周期清理，必须物化 `use-cases.yaml` 与完整 `state_management`。
- 四个 P0 屏幕继续以 `spec/ui-spec.yaml`、OCR 与观察 sidecar 为视觉输入；本执行者无视觉能力，不声称看图或验真。
- 架构影响为 `none`：不修改架构 DSL、模块集合、模块职责或 `doc/architecture.md`。

### Research Sub-Phase 自检

- 已读取 plan Skill、详细流程、hmos-app addendum、行为规约、headless 闸门、spec、acceptance、蓝图/CU、架构/catalog/config、组件索引和实际源码。
- 当前新增事实足以确定施工文件、符号、运行流、导航与测试映射；`ready_to_produce` 维持 `true`。
- 已知资源授权缺口不被猜测或越权修补；由 plan harness 给出责任路由。

## phase_delta: coding

### 本阶段实施事实

| 路径 | 事实 | 影响 |
|---|---|---|
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 现有 profile 没有验证码提示所需的手机号。 | 增加非秘密 Mock `phoneNumber`，不新建账号真源。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | 登录与未登录 profile 均由同一服务构造。 | 两条分支统一注入 Mock 完整手机号。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCandidate.ets` | 仓内尚无开卡候选卡与路由参数模型。 | 按 contracts 新建储蓄卡/信用卡类型、候选卡和阶段参数。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 当前没有 RDB 存储模型或开卡结果快照。 | 按 schema v1 映射完整卡号、支付状态与交易记录字段。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 20 家银行仅有展示数据。 | 在同一 repository 提供支持卡类型与每类 1–2 张本地候选卡。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets` | 现有 repository 只负责卡种展示数据。 | 在唯一 owner 内增加 `wallet_cards.db` schema v1 的建表、原子插入和按完整卡号读取。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 开卡多步业务编排不存在。 | 以普通数据状态、六位数字校验和单次写库实现命名入口，不导入 UI 运行时。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 现有两个银行入口都只提示暂不支持。 | 新增共用底部半模态，对支持类型单选并只发布命名回调。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/SmsVerificationSheet.ets` | 现有流程无验证码状态。 | 新增默认发送、60 秒倒计时、重发与六位数字限制。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 尚无具体卡片选择页。 | 新增可选候选卡、卡号前四后四掩码、协议和短信半模态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/CardOpenResultPage.ets` | 尚无不可返回的开卡结果屏。 | 新增成功/失败快照和唯一完成操作；结果引导图保留契约声明的可见占位债务。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 该页是已注册路由，并使用宿主唯一 `NavPathStack`。 | 改为共用开卡入口，并在冻结边界排除 Phone 时作为选卡/结果阶段的已注册宿主。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 该页与添加银行卡页存在重复的“暂不支持”点击逻辑。 | 改为同一开卡服务入口和共用卡类型半模态。 |
| `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets` | 现有路由常量真源只有旧页面名。 | 增加开卡阶段、验证码时间与 RDB 表常量，不新建平行导航真源。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | HAR 出口尚无新建页 builder。 | 只导出宿主未来可消费的两个 builder，内部 service/repository 保持私有。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 契约列出新 builder 接线，但本轮冻结写边界与目标简报均排除 Phone。 | 不修改受保护宿主源码；复用已注册 `AddBankCardPage` 路由承载阶段参数，并将冲突交给 harness 裁决。 |

### coding 决策

- 按 AccountManager → WalletMain data → domain → presentation 的依赖顺序实施。
- 完整卡号只进入候选模型、服务传参与 RDB；UI 仅调用掩码派生函数。
- 不修改 spec/plan/acceptance/CU，不纳入 Phone、CommUI 或 CommFunc 产品源码。

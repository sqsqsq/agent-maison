---
schema_version: "1.1"
feature: "cu-YmMtb3BlbkNhcmQtMgBpbXBsZW1lbnQtYmFuay1jYXJkLW9wZW5pbmc"
run_id: "20261015T142539Z-bc2ff7"
established_by: spec
ready_to_produce: true
has_blocker_coverage_risk: false
key_inputs_read:
  - "framework/specs/phase-rules/spec-rules.yaml — 已读"
  - "framework/profiles/hmos-app/skills/spec/profile-addendum.md — 已读"
  - "doc/module-catalog.yaml — 已读"
  - "doc/glossary.yaml — 已读"
  - "doc/architecture.md — 已读"
  - "doc/component-index.yaml — 已读"
  - "doc/features/bc-openCard-2/blueprint/component-blueprint.yaml — 已读"
  - "doc/features/bc-openCard-2/implement-bank-card-opening/change-unit.yaml — 已读"
  - "build-profile.json5 — 已读"
source_code_paths:
  - "build-profile.json5"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AddCardEntryPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/CardPackPage.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/domain/service/BankGroupService.ets"
  - "02-Feature/WalletMain/src/main/ets/index.ets"
  - "02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets"
  - "01-Product/Phone/src/main/ets/pages/index.ets"
  - "02-Feature/WalletMain/src/main/resources/base/element/string.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/color.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/float.json"
exploration_mode: "sequential"
change_intent: "feature"
estimated_loc_delta: 1400
touches_layers:
  - "01-Product"
  - "02-Feature"
  - "04-BusinessBase"
adds_new_exports: true
single_function_scope: false
decisions_unlocked:
  - "按 CU 投影 WalletMain、AccountManager、Phone 三模块 Scope"
  - "保留 AC-1～AC-7 与 BD-1～BD-6，并补齐四张参考图的视觉验收定义"
  - "沿既有 NavPathContext 单栈接入，不建立平行路由"
  - "RDB 是已添加银行卡唯一持久化真源，完整卡号不在 UI 或日志直出"
  - "盲档按 OCR 与 delegated observation 建模，素材缺口显式记视觉债务"
subagents_used: "none; sequential equivalent exploration"
searches_performed_estimate: 12
files_inspected_count: 31
---

## 探索预算与检索

- 检索现有银行卡入口、银行模型/仓库、路由 builder、账号资料与既有 UT，确认当前行为和可复用接线。
- 读取 CU/蓝图的 acceptance、development nodes、terminology facts、冲突裁决与 `saveBankCard` 权威契约。
- 读取四张参考图的 OCR JSON 与 delegated visual observation；本 agent 未直接观看图片。

## 已检视文件与原因

| 路径（相对仓库根） | 为何读 |
|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 确认既有银行点击、页面形态与 NavPathContext 用法 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 确认全部银行页点击、分组与返回行为 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` | 确认银行模型当前缺少支持卡类型 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 确认 20 家 mock 银行与现有资源键 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 确认跨模块 builder 出口 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 确认账号资料当前没有手机号 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | 确认 mock 账号资料唯一入口 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 确认根 Navigation、单栈 attach 与现有 route map |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 确认旧银行列表与分组行为已有回归载体 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 确认既有文案与本轮待新增文案边界 |
| `02-Feature/WalletMain/src/main/resources/base/element/color.json` | 确认可复用的蓝色、危险色与中性色 token |
| `02-Feature/WalletMain/src/main/resources/base/element/float.json` | 确认既有银行页间距、字号与圆角 token |

## Code Facts（代码事实，BLOCKER 级必填）

| 路径 | 发现的事实 | 对本阶段产出的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `handleBankTap` 仅记录银行短码并提示“暂不支持”，未进入开卡流程。 | AC-1 要求该入口改为统一卡类型半模态，同时保留页面原有收起/展开与返回行为。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | `handleBankTap` 同样只提示“暂不支持”；页面已复用 `NavPathContext.stack()`。 | 第二入口必须走与添加银行卡页相同的会话和半模态，不另建路由机制。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` | 模型仅含 code/name/pinyin/initial/logo/badgeRes。 | 需在 WalletMain 内补支持卡类型；具体卡候选继续由该 feature 的 mock 数据提供。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 当前提供 20 家本地常量银行，已有对应 logo 资源。 | UI 中所选银行 logo 可复用仓内资源；默认每家支持储蓄卡与信用卡。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 当前只导出既有卡包、添卡、添加银行卡和全部银行 builder。 | 新的具体卡片页与结果页须经同一出口文件导出。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | `UserProfile` 没有 mobile 字段。 | OTP 提示手机号必须由 AccountManager 的 mock 资料补齐，WalletMain 不复制账号真理。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile()` 是账号资料唯一入口，当前返回登录态、展示账号与头像。 | OTP 流只消费该服务新增的 mock 手机号；读取失败按 BD-5 收口。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 只登记四个既有二级页，并由 `NavPathContext.attach` 绑定单栈。 | 新页面仅追加既有 `navDestinationMap` 分支，禁止创建第二套路由/栈。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 旧 UT 已覆盖 20 家数据、分组、空态与资源缺失等旧行为。 | 本轮 UT 必须在保留旧用例的同时新增开卡会话、RDB 与导航命令覆盖。 |
| `02-Feature/WalletMain/src/main/resources/base/element/color.json` | 已有 `brand_primary=#007DFF`、`brand_danger=#FF3B30`、页面/卡片/文字中性色。 | 盲档仅引用仓内 Design Token，不把模型猜测当品牌色真值。 |

## 关键结论（支撑本阶段产出）

- CU 的 `touches[].design_ref` 映射到 `WalletMain`、`AccountManager`、`Phone`，三者即本 spec 的完整可修改模块集合；`CommFunc`、`CommUI` 只读复用。
- `BankCardOpeningSession` 是单次开卡状态唯一 owner；`WalletMainBankCardStore.bank_cards` 是已添加卡片唯一持久化真源。
- 完整卡号仅用于内存业务流转与 RDB；UI 只显示前四后四，日志不得输出完整卡号。
- 成功完成目标按蓝图冲突裁决落钱包首页；银行卡详情页属于后续能力。失败完成回 `AddCardEntryPage`。
- 四张参考图全部进入 Visual Handoff；NFC 激活区按需求原句排除，结果引导插画因盲档且无可信素材使用可见占位并记视觉债务。

## 覆盖风险（诚实声明）

| 风险 | 处理 |
|---|---|
| 本 agent 无视觉能力 | 使用 OCR JSON 和 delegated observation 建模，`verified: unverified`；不声称亲眼核图。 |
| 结果页引导插画缺少用途明确的仓内等价素材 | `asset-manifest.yaml` 显式 placeholder；发布前需替换并由视觉回环清偿。 |
| 参考图 3 背景展示搜索栏和“支持 100 家银行”，与既有 20 家 mock 页面不一致 | 以当前需求/CU 与既有 20 家数据为上位目标；搜索栏仅作参考背景视觉债务，不改变旧页面业务契约。 |

## 进入产出

Research Sub-Phase 自检完成：来源路径存在，Code Facts 超过门槛，决策与事实一一对应；可进入 spec 主产物撰写。

## phase_delta: plan

本阶段承接 `established_by: spec` 的有效基线，不改写既有事实；施工设计前新增核对如下。

| 路径 | 事实 | 对 plan 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/implement-bank-card-opening/change-unit.yaml` | canonical CU 为 `implement-bank-card-opening` revision 8，`touches` 精确授权 WalletMain、AccountManager、Phone 共 21 个实现/资源/UT 路径，并要求映射 4 个 predicate、1 个 provide 与全部 design refs。 | `contracts.yaml` 必须提供完整 `change_unit` sidecar；`contracts.files` 不得超出该精确写集。 |
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | development 投影给出三个既有模块、模型/接口/组件/文件；runtime flow 指定单一 `BankCardOpeningSession`、RDB 真源、保存后结果快照、清栈成功后才 reset，以及完整 ordered steps。 | plan 只补施工精确度，不重裁模块责任或创建平行状态/存储/导航真源。 |
| `doc/features/bc-openCard-2/implement-bank-card-opening/acceptance.yaml` | 当前有效验收为 AC-1～AC-8、BD-1～BD-8 与 NFR-1～NFR-4；其中所有 `unit`/`both` 条目需由业务用例分支覆盖，AC-6/AC-8 的设备义务保留给 testing。 | `use-cases.yaml` 覆盖成功、存储失败、幂等/冲突、取消、账号失败、清栈失败、空候选、防重入和重建；不把 UI 返回/视觉副作用塞入 data boundary。 |
| `framework/harness/scripts/utils/change-unit-feature-projection.ts` | plan 阶段允许以 `planned:` 表示尚未物化的文件/符号；predicate/provide 映射必须同时有 implementation/test refs，每个 design ref 必须同时有 implementation/verification refs。 | 新文件与 UT 落点使用可在后续阶段转为真实文件/符号核验的 project-relative refs。 |
| `framework/profiles/hmos-app/harness/plan-visual-parity-check.ts` | ui-spec 的全部 P0 节点须映射到 `contracts.components`，且组件文件必须属于 `contracts.files`；全部 asset/token 也须映射到 `contracts.resource_keys`。 | `plan/visual-parity.yaml` 按五屏/背景承载组件归属覆盖 68 个 P0 节点，并映射 2 个 asset 与 18 个 token。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 现有 20 家银行和 logo 资源为本地常量；`BankInfo` 尚无 `supportedTypes`，Repository 尚无按银行/卡型取候选卡接口。 | 就地扩展现有模型/仓库，不新建第二个银行数据源。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 通过 `NavPathContext.attach` 维护单一 `NavPathStack`，二级页由 `navDestinationMap` builder 注册。 | 仅追加 `BankCardSelectionPage` 与 `BankCardResultPage` builder 分支；不新增 `main_pages.json` 页面或第二套导航。 |
| `02-Feature/WalletMain/src/main/module.json5` | WalletMain 为 HAR，设备类型为 phone；与根 `build-profile.json5` 模块清单一致。 | `contracts.modules[WalletMain].format/package_path` 使用 HAR 与既有模块路径，未臆造新模块或入口。 |
| `04-BusinessBase/AccountManager/src/main/module.json5` | AccountManager 为 HAR，设备类型为 phone；与根 `build-profile.json5` 模块清单一致。 | `contracts.modules[AccountManager].format/package_path` 使用 HAR 与既有模块路径，未臆造新模块或入口。 |
| `01-Product/Phone/src/main/module.json5` | Phone 为 entry HAP，设备类型为 phone；与根 `build-profile.json5` 模块清单一致。 | `contracts.modules[Phone].format/package_path` 使用 HAP 与既有模块路径，未臆造新模块或入口。 |
| `02-Feature/WalletMain/oh-package.json5`、`04-BusinessBase/AccountManager/oh-package.json5`、`01-Product/Phone/oh-package.json5` | 现有包依赖已具备 Phone→WalletMain 与 WalletMain→AccountManager/CommUI/CommFunc，AccountManager→CommFunc。 | 本轮不修改模块依赖配置；模块架构图复用现有合法依赖边。 |
| `spec/ui-spec.yaml` 与四份 OCR/visual observation sidecar | 四张权威参考均已建模，`fidelity_target=pixel_1to1`、`asset_acquisition_mode=approximate`、`verified=unverified`；结果插画为明确 placeholder，NFC 区明确排除。 | 施工绑定沿现有 token/OCR 文案与 bbox；不声称直接看图，插画 major 视觉债务保留到 testing/release。 |

Research 自检：上述目标文件与依赖已实际读取，蓝图/CU/验收/代码/视觉输入可解析，无需修改上游产物；`ready_to_produce` 与 `has_blocker_coverage_risk: false` 继续成立。

### plan 重试补充输入登记

本阶段 `key_inputs_read` 增量（保持 `established_by: spec` 基线不变）：

- `02-Feature/WalletMain/src/main/module.json5` — 已读；确认 WalletMain 为 HAR、设备类型为 phone。
- `04-BusinessBase/AccountManager/src/main/module.json5` — 已读；确认 AccountManager 为 HAR、设备类型为 phone。
- `01-Product/Phone/src/main/module.json5` — 已读；确认 Phone 为 entry HAP、设备类型为 phone。

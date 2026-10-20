---
schema_version: "1.1"
feature: cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw
run_id: 20261019T033030Z-1b91ba
established_by: spec
ready_to_produce: true
has_blocker_coverage_risk: false
key_inputs_read:
  - build-profile.json5
  - doc/module-catalog.yaml
  - doc/glossary.yaml
  - doc/architecture.md
  - doc/component-index.yaml
  - framework/profiles/hmos-app/skills/spec/profile-addendum.md
  - doc/features/bc-openCard-2/blueprint/component-blueprint.yaml
  - doc/features/bc-openCard-2/open-card-flow/change-unit.yaml
  - doc/features/原始需求/1-2-银行卡/原始需求.md
source_code_paths:
  - 01-Product/Phone/src/main/ets/pages/index.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
  - 02-Feature/WalletMain/src/main/ets/index.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets
  - 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets
  - 02-Feature/WalletMain/src/main/resources/base/element/color.json
  - 02-Feature/WalletMain/src/main/resources/base/element/float.json
  - 02-Feature/WalletMain/src/main/resources/base/element/string.json
  - 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
  - 02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets
  - 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets
  - 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets
  - 04-BusinessBase/AccountManager/src/main/ets/index.ets
exploration_mode: sequential
change_intent: feature
estimated_loc_delta: 1000
touches_layers:
  - 01-Product
  - 02-Feature
  - 04-BusinessBase
adds_new_exports: true
single_function_scope: false
decisions_unlocked:
  - 沿用蓝图 AC/BD，仅补视觉 checkpoint
  - 保持根导航栈和既有路由
  - 复用银行 logo，未知文案/几何/引导图记未验证
subagents_used: none; sequential equivalent
searches_performed_estimate: 8
files_inspected_count: 22
---

## Code Facts

本轮 spec 按 facts admission 的 stale 指示重新核对真实来源；established_by 仍为实际建立者 spec。下方旧 phase_delta 保留为历史，本轮有效增量在末尾；旧“无 OCR”和旧组件选型缺口不代表当前事实。

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | 唯一根 NavPathStack；注册 CardPackPage/AddCardEntryPage/AddBankCardPage/AllBanksPage；HomeTab 用 @Link | 新增页继续接现有栈 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | handleBankTap 仍提示暂不支持 | 双入口行为需要改变 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 同样提示暂不支持；返回 pop 当前栈 | 保留字母索引和老返回 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | 仅银行代码/名称/拼音/logo，无支持类型 | 候选卡/类型由 WalletMain 承载 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | mock 银行 logo 均引用 bank_logo_* | 可复用资源用途，未验视觉 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | 首页 cardMode 由 HomeRepository 读取，当前无开卡完成消费 | 成功后应按全卡号读取 RDB 并刷新 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 无完整手机号字段 | 沿蓝图扩展 phoneNumber |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | 当前 mock 登录展示邮箱掩码，非 catalog 所述手机号 MaskUtil 路径 | 以源码为准；不得从展示串还原手机号 |
| 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json | 现有四个目的页与壳层注册相同 | 新旧入口均须回归 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets | 已有 home_page_ut 与 bank_open_card_ut 注册 | 下游复用测试载体，不在 spec 写测试 |

## phase_delta: spec

首次实际阶段建立事实；无前驱 facts 基线。原始需求与蓝图是行为依据，四张参考图仅确认为存在，本执行者无视觉且无 OCR，不宣称读图。conventions、component-catalog、三个模块 code-graph 均未启用。当前 git status --short 为空。

| 路径 | 事实 | 影响 |
|---|---|---|
| build-profile.json5 | Phone/WalletMain/AccountManager 模块 srcPath 与 Scope 一致；compatibleSdkVersion=6.0.1(21) | 不改变构建配置，沿现有手机目标验收 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/BankListRow.ets | 行 ID 为 prefix_row_code；添加银行收起态 col，全部银行 ab | checkpoint 使用 col_row_cmb / ab_row_cmb |

## phase_delta: plan

沿用已验证 spec 建立的基线和 established_by，不重建事实身份。当前 canonical resolver 投影为 resolved（蓝图 revision 4 / CU revision 5）；仅补施工映射、用例与视觉组件归属。知识输入已读取相关 Catalog 职责/反例、Glossary、architecture、完整 component-index、profile plan addendum；conventions、component-catalog 与模块 code-graph 不存在，不自动创建。组件候选 SectionCard/ActionListItem 与银行页 live 源码已核对；上游选择 WalletMain 自定义业务组件，不修改公共组件。

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | navDestinationMap 仅四个既有 builder；HomeTabPage 以 @Link 接根栈 | 新增两分支并保留旧路由，不能传 @Prop 栈 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | handleBankTap 暂不支持；expanded 和全部银行跳转节流独立 | 只接卡类型 sheet，保留原布局和返回状态 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | handleBankTap 暂不支持；字母索引依赖 BankInfo 拼音字段 | 保留原字段/分组/字母锚点 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | 现有 pinyin/initial/logo/badgeRes 为列表消费者所需 | supportedCardTypes 是增量，不能按投影删旧字段 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | getBanks 返回本地完整银行列表及 bank_logo_* 资源 | 默认双类型及每种 1–2 张候选由此扩展，无远程请求 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | loadHomeData 会重取 mock cardMode，目前无 RDB 订阅 | 成功回调按号读取后需防旧异步加载覆盖有卡态 |
| 02-Feature/WalletMain/src/main/ets/data/repository/HomeRepository.ets | launchOverride 与默认无卡是现有演示态，不是持久卡真源 | 不修改此未授权文件；HomeTabPage 将 RDB 结果作为本轮成功刷新依据 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | UserProfileParams 可选参数、avatar/accountText 已被消费 | 增量 phoneNumber，保留构造兼容性 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | getUserProfile/login 返回 Promise<UserProfile>；展示串为掩码邮箱 | 完整 mock 手机来自独立 phoneNumber，不从 displayAccount 还原 |
| 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json | 四个路由与 Phone 映射一致 | 同步添加 BankCardSelectionPage/AddCardResultPage |
| 02-Feature/WalletMain/src/main/ets/index.ets | 既有页面 builder 经 HAR 出口供 Phone 使用 | 新 builder 必须同路径导出 |
| 04-BusinessBase/AccountManager/src/main/ets/index.ets | 已导出 UserProfile 和 AccountService | 维持既有包入口，不深路径跨模块引用 |
| 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets | 已有两路由名、节流和银行几何常量 | 新路由/OTP 常量仍放此授权文件 |
| 02-Feature/WalletMain/src/main/resources/base/element/color.json | ui-spec 四个颜色 token 均已存在 | 仅按资源键复用，不声称参考图采色 |
| 02-Feature/WalletMain/src/main/resources/base/element/float.json | 已有银行字号/间距资源 | 字号按 fp，触控尺寸在 coding 中落实并真机验证 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets | 注册 home_page_ut 和 bank_open_card_ut | 保留注册并增量加入本 CU 新测试 |
| doc/features/bc-openCard-2/open-card-flow/contracts.yaml | 当前缺失，canonical typed 投影提供精确写集及模型签名 | 本阶段生成完整 change_unit sidecar，不扩大 files |
| doc/features/bc-openCard-2/open-card-flow/use-cases.yaml | 当前缺失，蓝图含四条成功/失败/取消/重复提交分支 | 物化原分支，补齐同一验收内单卡类型和计时边界 |
| doc/features/bc-openCard-2/open-card-flow/plan/visual-parity.yaml | spec 已有全部四图及 UI 节点/资源来源 | 全节点映射，verified 维持 unverified，NFC 排除 |
| 02-Feature/WalletMain/src/main/module.json5 | 已读取：HAR，deviceTypes=phone，无新增模块或权限 | 继续现有打包模式，无配置变更 |
| 02-Feature/WalletMain/oh-package.json5 | 包入口 src/main/ets/index.ets；已依赖 AccountManager/CommUI/CommFunc | 不新增依赖 |

裁决：原需求结果页说明的“去卡详情”按已裁决的 result-destination 落为本期成功回首页；NFC 明确不做。无视觉，本阶段未看图、未生成参考图几何事实；沿 spec 已声明文本与待复核项继续。

## phase_delta: plan

重试复核：保持已验证基线及 established_by=spec。`git diff --name-status d3f48b2c38521d049b1ec7fb670cc0c9cf6e8416` 与 `git status --porcelain=v1 --untracked-files=all` 均无输出；Feature 文档被忽略，故该结果只证明受版本管理的源码和配置未变化，不证明文档无历史变更。当前磁盘 plan 已记录同一上游缺口，不能将重试误当成上游已修复。

| 路径 | 事实 | 影响 |
|---|---|---|
| doc/features/bc-openCard-2/blueprint/component-blueprint.yaml | 两条组件决定 kind 均为 component_selection，不是消费契约要求的 component_asset_selection | 上游 component-design 修复后才能生成合法施工映射；本阶段只读 |
| doc/features/bc-openCard-2/open-card-flow/change-unit.yaml | decision design_refs 仅含 navigation-stack、rdb-schema、result-destination、scope-modules | 不在 Feature 发明 CU 未包含的 decision ref |
| doc/features/bc-openCard-2/open-card-flow/contracts.yaml | 七个页面/组件已有 custom 投影，但无可引用的 canonical 组件选型决定 | 保留既有契约和写集，禁止删除组件或改为 utility 规避 |
| doc/features/bc-openCard-2/open-card-flow/plan/plan.md | 原有上游修复候选与当前磁盘事实一致 | 追加本次重试结果；等待正式 harness 生成新的 summary |

## phase_delta: spec

本轮 20261019T033030Z-1b91ba 重建当前来源语义，不沿用旧 run 的完成结论。已实际读取原需求、当前蓝图相关设计/验收、review 对应章节、CU、现有 acceptance、四份 OCR 与四份 visual-observations。保留未变化的源码事实与建立者身份，下面逐项替代失效来源的历史结论；没有执行 plan/coding。

| 路径 | 事实 | 影响 |
|---|---|---|
| doc/features/bc-openCard-2/blueprint/component-blueprint.yaml | 当前 revision 5；七项 UI 组件决定均为 component_asset_selection，涵盖四个新界面及三个兼容演进页面；AC-1..8/BD-1..5 的业务预期未改变 | 旧 plan 关于 component_selection 的阻断事实已失效；spec 只同步引用，不改蓝图 |
| doc/features/bc-openCard-2/blueprint/component-blueprint.review.md | 当前 derived_from revision 5；明确成功回首页、失败回 AddBankCardPage、同一根栈、七项组件选型 | 与目标一致；不把旧报告当当前设计缺口 |
| doc/features/bc-openCard-2/open-card-flow/change-unit.yaml | 当前 revision 7，指向 blueprint revision 5；touches 为 WalletMain/AccountManager/Phone，provide 与五个 target predicate 保持原定义 | Scope 集合保持不变，不触碰 CommUI/CommFunc |
| doc/features/bc-openCard-2/open-card-flow/acceptance.yaml | 现有 AC/BD 与当前蓝图逐条一致，已有六个核心 checkpoint；source 字符串仍指旧派生材料 | 保留业务字段及来源历史，不换戳逃避对齐；本轮补失败 checkpoint 与当前复核说明 |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/fidelity-intent.json | execution_identity=20261019T033030Z-1b91ba；pixel_1to1 / best_effort / approximate；initializer 已确认复用有效 SSOT | 原样投影三轴，verified 保持 unverified |
| doc/features/原始需求/1-2-银行卡/原始需求.md | NFC 激活明确不做，详情页为后续；手机号来自账号 mock，银行每类型 mock 1–2 卡 | 结果成功回首页；完整卡号仅业务数据，协议纯文本 |
| 01-Product/Phone/src/main/ets/pages/index.ets | 仍只有四个旧目的页，单根 NavPathStack，HomeTab 通过 @Link 消费 | 当前产品源码仍是干净基线；新增目的页留给下游 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | handleBankTap 仍显示 not_supported，已有 col_root 与 col 银行行锚点 | 保留双入口/取消恢复验收 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | handleBankTap 仍显示 not_supported；ab_root、ab_back_btn 与字母索引存在 | 保留旧路由及索引回归 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | bank_logo_* 与银行代码有明确引用 | repo_ref 有用途依据，不等于视觉验真 |
| 02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets | 当前只返回卡种与 mock 本机卡状态，不是银行卡 RDB | 不把现有卡种库冒充新持久记录库 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | mock 账号展示仍为掩码邮箱；getUserProfile 不提供完整手机号 | catalog 的 maskPhone 描述与源码不同，继续以源码为准，新增 phoneNumber 沿蓝图 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 仍只有 isLoggedIn/displayAccount/avatar | 兼容扩展既有构造参数，不从展示串反解手机号 |
| 05-SystemBase/CommFunc/src/main/ets/shared/navigation/NavPathContext.ets | attach/stack 只持根栈引用 | 仅消费，不修改公共模块 |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/3-点击任意银行拉起添卡选卡半模态.ocr.json | 当前有逐词 bbox、完整说明和协议文案；1320×2120 | 可补文本位置，不再声称无 OCR |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/4-点击信用卡或储蓄卡后拉起选卡页面.ocr.json | 提示文案可靠，协议存在“云内付”等低质识别；1320×2120 | 可靠片段逐字消费，歧义列待复核 |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/5-选中某张卡片后拉起短信验证.ocr.json | 手机号为示例掩码、计时为 55 秒，键盘 OCR 有噪声 | 不把示例数字改成业务常量；运行初值仍为 60 秒 |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/6-短信验证完成后结果页.ocr.json | 成功/说明/完成文案清晰，NFC 文案属明确排除；1320×2172 | 保留完整参考图分母，NFC 登记 excluded |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/3-点击任意银行拉起添卡选卡半模态.visual.json | provider 观察为银行与两类型同一白卡、标题关闭同行、窄蓝色按钮；非执行者亲见 | 补结构与按钮语义，像素未验证 |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/4-点击信用卡或储蓄卡后拉起选卡页面.visual.json | provider 观察包含返回箭头、银行卡 logo/选中标记、协议勾选、窄红色按钮 | 补缺失元素，精确品牌色不凭观察猜 hex |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/5-选中某张卡片后拉起短信验证.visual.json | provider 观察为输入框和按钮等宽、数字键盘在下 | OTP 真机验收需键盘可见态；不自行绘制系统键盘 |
| doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/6-短信验证完成后结果页.visual.json | provider 观察为绿色成功图标、手持手机插画、灰底蓝字完成按钮 | 补按钮变体，插画仍缺可信资产并披露 |

已检查 git status --short 无输出，仅证明受版本管理源码干净；Feature 文档被忽略，不能据此宣称无历史文档。conventions/component-catalog 缺失；组件索引全文已读。独立视觉观察是上下文，不是质量裁决。

## phase_delta: spec

| 路径 | 事实 | 影响 |
|---|---|---|
| doc/features/bc-openCard-2/open-card-flow/acceptance.yaml | 本阶段经 deriveBlueprintSkillInput 重新消费当前 canonical CU 与蓝图；compareAuthoritativeContent 无业务差异，逐行采用当前权威字段并保留 spec checkpoint/coverage | 更新已验证的来源戳以反映本次责任阶段重建，不沿用旧版标识，不修改上游或下游 |

## phase_delta: plan

本轮 run=20261019T033030Z-1b91ba，保留上述基线与 established_by=spec。已读当前需求、spec/acceptance、Catalog、Glossary、architecture、完整组件索引、plan 主干及 profile；不存在 conventions/component-catalog。通过原 deriveBlueprintSkillInput 只读解析得到 resolved，逐项比较旧施工内容，确认旧组件缺口已由上游修复。本次不改蓝图/CU/spec、产品源码或运行证据目录。

| 路径 | 事实 | 影响 |
|---|---|---|
| doc/features/bc-openCard-2/blueprint/component-blueprint.yaml | revision 5；四个新 UI 为 custom，AddBankCardPage/AllBanksPage/HomeTabPage 为 evolve；对应决定均有 canonical ref | 用真实上游组件字段替换旧投影，不自行重选 |
| doc/features/bc-openCard-2/open-card-flow/contracts.yaml | 旧来源为 CU 5/蓝图4；三个既有组件 kind/resolution 与当前设计不同，state_management.design_ref 也旧 | 保留有效模型、签名、写集及补充，重建当前 change_unit 精确映射 |
| doc/features/bc-openCard-2/open-card-flow/use-cases.yaml | 成功、失败、取消、重复提交与上游语义一致；单类型/重发为既有验收内补充 | 复核权威内容后保留分支，更新本阶段真实来源 |
| doc/features/bc-openCard-2/open-card-flow/plan/plan.md | 仍称蓝图4/CU5组件缺口未解决 | 修正当前依据与组件落位，历史失败由旧报告保留 |
| doc/features/bc-openCard-2/open-card-flow/plan/visual-parity.yaml | 尚未映射当前 spec 新增返回、手机号后缀、系统键盘、失败图标/插画及颜色 token | 补全部节点和 token；系统键盘只是宿主状态，不自绘、不虚构应用测试 ID |
| 01-Product/Phone/src/main/ets/pages/index.ets | 四旧 builder、唯一根栈，首页用 @Link；没有新目的页 | 继续原注册点，保留旧路由 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | handleBankTap 为暂不支持；expanded 独立于栈 | 只替换后继行为，保留原页面状态 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 原有分组/字母索引与 pop 返回 | 原位接 sheet，不重建页面 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | loadHomeData 异步重取演示 cardMode | 完成通知查库刷新需防旧加载覆盖；不改 HomeRepository |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | pinyin/initial/logo/badgeRes 为既有字段 | 增量支持类型保留构造与消费者兼容 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | getUserProfile/login 仍给掩码邮箱，无完整手机号 | 独立扩展 phoneNumber；不反解展示串 |

只消费 spec 中 OCR/observation 的有来源结构和文本，本执行者无视觉。NFC 明确排除；成功回首页按现有效需求裁决。像素、颜色和插画仍 unverified，不能以映射完整宣称视觉验收。

## phase_delta: coding

承接 validated predecessor baseline，保留 established_by=spec 与原 run 身份。已读真实源码、contracts/use-cases/acceptance/plan、完整 ui-spec、架构、适用模块画像/术语、组件索引与 profile。personal setup 指定 project-root 后 ok；本轮入场 git status 为空。无 ReadLints 工具，逐文件使用宿主 ArkTS parser 读取语法诊断，类型/资源/ArkTS 限制由正式 harness 真实编译验证，不声称原生 IDE lint 已运行。

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | 四旧 builder、同源根栈 | 增量两新路由 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | 暂不支持提示、展开状态独立 | 只接本地 sheet |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 暂不支持提示、分组索引与 pop | 复用同一 sheet，不改索引 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | 异步 mock cardMode，无 home_root | 增加 RDB 读取与稳定订阅，防旧任务覆盖 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | 现有银行展示字段被 BankListRow/分组消费 | supportedCardTypes 增量保留旧字段 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | 本地银行/资源绑定，无候选卡 | 加稳定完整卡号候选 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 可选构造参数，无 phoneNumber | 兼容新增字段 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | displayAccount 是邮箱掩码 | 独立 mock phoneNumber，不反解展示串 |
| 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets | 旧路由常量 | 增加两新路由及 OTP 时间/位数 |
| 02-Feature/WalletMain/src/main/ets/index.ets | HAR main 指向此出口 | 新 builder 由此导出 |
| 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json | 四旧路由 | 保留并增量注册 |
| 02-Feature/WalletMain/src/main/resources/base/element/string.json | 现有文案资源 | 新增 OCR/需求文本 |
| 02-Feature/WalletMain/src/main/resources/base/element/color.json | 现有 token 可复用 | 近似色不宣称参考采样 |

裁决：成功回首页、失败回 AddBankCardPage 采用已裁决契约；NFC 排除；不修改 CommUI/CommFunc、上游产物或 UT 文件。无视觉，不声明看过原图。结果插画保持已声明占位和视觉债务。所有新增文件限 contracts.files，新增业务逻辑的 UT 留给冻结 ut 阶段。

## phase_delta: coding

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardType.ets | debit/credit 枚举 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardInfo.ets | 完整卡号与两个支付状态，不保存显示掩码 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/data/model/CardRecord.ets | 十个持久字段，genericCardType=bank_card（蓝图 mappings/6） | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/data/model/OpenCardResult.ets | 真实成功/失败及完整卡号 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/data/model/OpenCardSessionParams.ets | 选卡参数及结果导航载荷 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets | 真实 RDB 表、唯一约束、事务、关闭 resultSet；protected openStore 为现有类测试接缝 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/domain/service/BankCardMaskService.ets | 前四后四显示，不反写完整号 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/domain/service/OpenCardFlow.ets | 普通业务类，无 UI imports；timer 与 single-flight 保存归该实例 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets | 实际支持数组单选、初始继续禁用 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets | 账号手机号脱敏、数字输入；实际 Flow 由父页传入 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets | 真实选卡和 OTP，保存后才导航，UI 防重复 continuation | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddCardResultPage.ets | 返回屏蔽，成功通知先于 clear，失败回 AddBankCardPage | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/ets/shared/OpenCardCompletionBridge.ets | 单 listener/单 pending 一次性消费，不持久保存业务记录 | 本轮授权实现，供 review/UT 消费 |
| 02-Feature/WalletMain/src/main/resources/base/media/card_open_result_guide.png | 480×360 可见手机/卡片图形占位，PNG provenance 标注 unverified；不是参考图裁切 | 对应 spec 占位插画语义，仍为 major 视觉债务 |

首轮正式编译定位 flow 初始化与键盘 API 名称两处错误，已修正为初始化实例和 SDK enableKeyboardOnFocus。真实单文件 parser 检查通过，完整类型结论以重跑 harness 为准。

## phase_delta: coding

本次 retry 仅诊断既有八项 BLOCKER，承接原 validated baseline 及 established_by，不修改任何产品源码或上游产物。已按 coding/reports/trace.json.start_commit=d3f48b2c38521d049b1ec7fb670cc0c9cf6e8416 查看 tracked diff，并用 git status 纳入新增文件。check-receipt 确认既有 summary FAIL、8 BLOCKER、无 verifier request。未发现需要先撤销的排障配置改动。

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/resources/base/element/color.json | 相对基线仅新增两个 open_card 颜色资源 | 属本功能实现依赖；不能为恢复旧证据指纹删除 |
| 02-Feature/WalletMain/src/main/resources/base/element/string.json | 相对基线新增开卡类型、选卡、OTP 与结果文案 | 属实现依赖；上游 stale 需责任方重验 |
| 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json | 保留四旧路由并新增两新路由 | 不撤销正常接线以绕过 stale |
| 01-Product/Phone/src/main/ets/pages/index.ets | 新 builder import 和 navDestination 分支已存在，旧分支保留 | host_entry_reachability 的缺 entry_symbol 不是这处代码缺接线 |
| 02-Feature/WalletMain/src/main/ets/index.ets | 两新 builder 已经从 HAR 出口导出 | 与新增路由消费一致 |
| doc/features/bc-openCard-2/open-card-flow/contracts.yaml | integration_points 第 480–489 行的三个条目均没有 entry_symbol；files 含尚未产出的 UT 文件 | plan 责任方修复入口契约；UT 所有权与 coding 文件完整性要求需交 driver 调和，不在本阶段补空测试 |
| doc/component-index.yaml | 未收录两个新 builder；既有页面 builder 的字体/触控静态结论也为 unknown | 需要授权的索引维护及静态分析责任方核查，不删导出或向 wrapper 添加无效 UI 来规避 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddCardResultPage.ets | 实际 struct 内含 fp 字号与 44 高按钮，builder 仅调用 struct | 静态 unknown 不能直接等同缺少声明，亦不能宣称通过 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets | 实际 struct 内含 fp 字号与 44 高按钮，builder 仅调用 struct | 同上，保留真实实现交责任方处理 |

本轮不扩充设计、不提前写 UT、不刷新图谱、不读取或修改 framework 内部实现；当前 source 与已有编译 PASS 证据保持一致。重新运行 coding harness 产出本次机器结论，未通过前不进入 review。无视觉观察或真机验收结论。

---
schema_version: "1.1"
feature: "cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw"
run_id: "20261022T103904Z-179a73"
established_by: "spec"
ready_to_produce: true
has_blocker_coverage_risk: false
context_intent: "复用蓝图补齐视觉验收并核对三模块源码"
change_intent: "feature"
estimated_loc_delta: 1000
touches_layers: ["01-Product","02-Feature","04-BusinessBase"]
adds_new_exports: true
exploration_mode: "subagent"
subagents_used: ["/root/spec_research"]
files_inspected_count: 24
searches_performed_estimate: 9
source_code_paths: ["01-Product/Phone/src/main/ets/pages/index.ets","02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets","02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets","02-Feature/WalletMain/src/main/ets/index.ets","02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets","02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets","02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets","02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets","02-Feature/WalletMain/src/main/resources/base/element/color.json","02-Feature/WalletMain/src/main/resources/base/element/float.json","02-Feature/WalletMain/src/main/resources/base/element/string.json","02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets","04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets","04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets","04-BusinessBase/AccountManager/src/main/ets/index.ets"]
key_inputs_read: ["build-profile.json5","doc/module-catalog.yaml","doc/glossary.yaml","doc/architecture.md","doc/component-index.yaml","framework.config.json","framework/docs/README.md","framework/profiles/hmos-app/skills/README.md","framework/profiles/hmos-app/skills/spec/profile-addendum.md","doc/features/bc-openCard-2/blueprint/component-blueprint.yaml","doc/features/bc-openCard-2/blueprint/contract-authority.yaml"]
decisions_unlocked: ["两入口统一流程","账号手机号为新增字段","单一导航栈","四图完整建模"]
---

# Spec 实际建立事实

## Code Facts

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | 既有模块出口或根 Navigation 装配须继承。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | 银行模型没有支持卡类型字段。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | 现有 20 家 mock 银行及 logo 可复用，不读取 RDB。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/index.ets | 既有模块出口或根 Navigation 装配须继承。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | 银行点击仅 not_supported；更多是原页面展开状态。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 银行点击仅 not_supported；字母索引与逐层返回已存在。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | @Link 与根 Navigation 同栈，当前首页为 mock 展示。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets | 既有资源/常量真源，原银行列表语义保持。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/resources/base/element/color.json | 既有资源/常量真源，原银行列表语义保持。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/resources/base/element/float.json | 既有资源/常量真源，原银行列表语义保持。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/main/resources/base/element/string.json | 既有资源/常量真源，原银行列表语义保持。 | 下游按蓝图最小接线，不建立平行真源。 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets | 既有银行数量/分组/异常 UT 需要保留。 | 下游按蓝图最小接线，不建立平行真源。 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 现有账号模型/服务/出口没有手机号，登录展示串为脱敏邮箱。 | 下游按蓝图最小接线，不建立平行真源。 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | 现有账号模型/服务/出口没有手机号，登录展示串为脱敏邮箱。 | 下游按蓝图最小接线，不建立平行真源。 |
| 04-BusinessBase/AccountManager/src/main/ets/index.ets | 现有账号模型/服务/出口没有手机号，登录展示串为脱敏邮箱。 | 下游按蓝图最小接线，不建立平行真源。 |

## Knowledge 与能力
已读取 Catalog/Glossary/architecture 和组件索引；doc/conventions.md、doc/component-catalog.yaml 不存在。CodeGraph 无法解析，回源码；只读探索子代理结果已消费。四张 authoritative_refs、OCR 与 visual-observations 已读；无视觉能力，观察 sidecar 不等于视觉验真。

## phase_delta: spec

| 路径 | 事实 | 影响 |
|---|---|---|
| spec/ui-spec.yaml | 四参考图建立独立屏与动态状态 | 补视觉 checkpoint，不修改蓝图验收预期 |

| build-profile.json5 | 当前target 6.0.2(22)、compatible 6.0.1(21)，模块路径与架构一致 | 不改配置 |

## phase_delta: plan

保留 spec 建立的基线与 established_by；本阶段直接消费 derive.blueprint-contracts 的 resolved 投影、canonical CU revision 4，不补造 spec 执行。CodeGraph 不可用，按目标源码核实。conventions 与 component-catalog 未启用；组件索引及 BankListRow 定义/调用已读，沿蓝图 ui-components 的 custom 决定施工。

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | 根 Navigation 唯一栈，aboutToAppear attach 到 NavPathContext，navDestinationMap 注册原四页面 | 仅追加新 builder；保留原分支与 @Link 栈 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | expanded 为页内状态，银行回调只提示 not_supported | 替换银行点击行为，关闭半模态不得重建列表 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 复用 BankListRow，上抛银行点击；索引通过 Scroller 定位 | 复用同一开卡入口，保留字母索引与返回 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | getBanks 为编译期 mock，未包含支持卡类型和候选卡 API | 扩充同源 mock，不改旧银行顺序/分组 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | @Link 同源栈，aboutToAppear 加载 mock 展示 | 增加完成载荷消费和 RDB 重读；保留原首页入口 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 只有登录标记、展示账号与头像 | 按蓝图新增 mockPhone，不用邮箱伪装手机号 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | getUserProfile 返回账号模型；既有登录与注销维护 AppStorage | 增加 mock 手机号来源，保持登录契约 |
| doc/features/bc-openCard-2/open-card-flow/contracts.yaml | 本阶段生成 typed 投影及完整 CU sidecar，补充 BankRepository 边界签名、UI 状态与视觉资源映射 | coding/UT 以此为施工真源 |
| doc/features/bc-openCard-2/open-card-flow/use-cases.yaml | 本阶段物化蓝图用例，不改既有分支语义 | 业务 UT 继承成功/存储失败分支并覆盖取消与幂等 |
| doc/features/bc-openCard-2/open-card-flow/plan/plan.md | 本阶段叙述施工定位、路由清理与存储实现约束 | 不修改上游验收或产品源码 |
| doc/features/bc-openCard-2/open-card-flow/plan/visual-parity.yaml | 本阶段映射全部 ui-spec 节点、token、asset | 四图分母不缩小；无视觉能力不声称已核图 |

Research 完成：已核对架构/config、Catalog/Glossary 相关模块、profile、根构建模块声明、WalletMain 包依赖与 module.json5。Personal setup 显式 project-root 后为 ok；首次缺 project-root 的检测读错根，不代表宿主未配置。引导图保留 spec 的 placeholder/未核验状态，NFC 排除。成功到首页、失败到添加银行卡页沿当前蓝图 navigation-cleanup 裁决，不提前实现未来卡详情页。

本阶段补充 key_inputs_read: ["02-Feature/WalletMain/src/main/module.json5", "02-Feature/WalletMain/oh-package.json5"]。已实际读取 module.json5：HAR phone，不需新权限。

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/module.json5 | 当前模块为 HAR，设备类型 phone | 新页面继续在同模块，无新增配置 |
| 02-Feature/WalletMain/oh-package.json5 | 已依赖 AccountManager、CommUI、CommFunc 公共包 | 不新增包或依赖边 |

## phase_delta: coding

Research 已完成：读取 contracts/acceptance/use-cases/ui-spec、plan、架构 DSL、适用 Catalog/Glossary、组件索引与 BankListRow、三模块包/模块配置和根页面注册、既有银行双入口、首页、账号服务及公共导航出口。保留原 spec 基线和 established_by。conventions、component-catalog 与相关 CodeGraph 未启用，不创建。四图仅消费 OCR 与 observation sidecar，不声称视觉核验。按目标裁决成功回首页，失败回添加银行卡；NFC 排除。当前无 ReadLints 工具，以 framework profile checkCodingLint 逐文件静态检查，最终真实编译补齐类型/资源核验。

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | 原 mock 为20家，无候选卡读取 | 保持原顺序并增加类型/候选卡 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | expanded 是页内状态 | 半模态关闭不得重建宿主 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | Scroller 与字母索引已有 | 只替换银行回调，保留旧导航 |
| 01-Product/Phone/src/main/ets/pages/index.ets | NavPathContext 绑定唯一栈 | 追加 builder 与首页激活回调 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 原参数均可选 | 新字段默认值不破坏旧调用 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | 首页目前只读 mock | 订阅一次性载荷并从 RDB 重读 |

### 施工后逐路径增量

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/index.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardStackSection.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/resources/base/element/string.json | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardRecord.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardType.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/model/MockBankCard.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/model/SaveBankCardResult.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/domain/model/BankOpeningResultPayload.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/domain/model/OtpSession.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningCoordinator.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningNavigator.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardResultPage.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/ets/shared/BankOpeningCompletionBridge.ets | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |
| 02-Feature/WalletMain/src/main/resources/base/media/open_card_guide.svg | 本阶段按开卡契约实现/接线；源码已逐文件静态检查，最终编译见 coding reports | 支撑选卡、存储、结果或首页恢复，新增导出仅公共路由和导航接线 |

PhoneAbility.onForeground 补发既有 Context.eventHub 通知，使 HomeTabPage 在 warm resume 重读 RDB；CardStackSection 增两个可选展示属性，展示最新 RDB 卡的银行与脱敏号，保留其它 mock 展示。不新增依赖/导航系统。harness 首轮自动更新了 doc/component-index.yaml（发现新 builder）；该写入不是 agent 手工策展。

## phase_delta: review

保留原始基线正文与 established_by，本阶段仅消费既有事实。全读 contracts.files 29 项及调用链，打开四张参考图。无产品或测试源码写入。审查详细证据见 review/context-exploration.md 与 review/review-report.md。

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | supportedCardTypes 为新增必填字段 | 旧 fixture 构造须同步，CR-001 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets | useLogoMissing 对象未提供该必填字段 | 旧 UT 编译存在确定性兼容回归，回 coding |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets | selection_next 使用蓝色 brand_primary | 与已打开图4红色按钮不同，CR-002；视觉 token owner 回 spec |
| doc/features/bc-openCard-2/open-card-flow/coding/structure-conformance.yaml | 九条声明均独立打开源码核对，只有文件定位导致机器 WARN | 不重写上游台账；结构结论逐条写 review 报告 |


### Review 调用链增量覆盖

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardType.ets | DEBIT/CREDIT 字符串枚举 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardRecord.ets | 完整卡号、两种类型、银行、时间、支付状态、交易 JSON 字段齐备 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/data/model/MockBankCard.ets | 候选卡完整号保留，maskCardNumber 仅显示前四后四 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/data/model/SaveBankCardResult.ets | 成功标记、全号、摘要三字段 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets | 唯一卡号约束及异常后查询恢复，ResultSet finally 关闭 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/domain/model/OtpSession.ets | 六位数字正则、截止时间倒计时、stop 解绑 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/domain/model/BankOpeningResultPayload.ets | 全号与保存结果的内存载荷 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningCoordinator.ets | 流程唯一实例，generation 过滤旧响应，inFlight 防重复保存 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningNavigator.ets | 成功发布并激活首页后清栈；失败清栈再推添加银行卡 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/shared/BankOpeningCompletionBridge.ets | 泛型单条载荷 publish/takePending 及监听增删 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets | 支持类型动态行及单选，继续异步防重入 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets | 账号来源手机号，数字输入与倒计时同行，提交防重入 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardResultPage.ets | 参数读取、成败渲染，拦截返回，完成仅一次 | 本阶段静态核验，运行结果不作推断 | 
| 01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets | onForeground 通过 eventHub 发出钱包通知，Home 订阅重读 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardStackSection.ets | 可选银行与脱敏号覆盖原 mock 显示 | 本阶段静态核验，运行结果不作推断 | 
| 02-Feature/WalletMain/src/main/resources/base/media/open_card_guide.svg | 实际手机/二维码/手势 SVG，按原需求允许近似 | 本阶段静态核验，运行结果不作推断 | 
## phase_delta: coding

CR-001 返修前已核对 BankInfo、BankCardType、BankRepository、SpyBankRepository、bank_open_card_ut.test.ets 及 List.test.ets。supportedCardTypes 是必填业务字段，旧 logo 缺失 fixture 未同步；本轮仅补 DEBIT/CREDIT 枚举数组及模块内类型导入，保持旧断言与生产代码。目标测试作为 coding 返修诊断执行，不替代冻结链的正式 UT 阶段；未涉及设备 UI/交互，无需 UI 复现。

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets | useLogoMissing 的 BankInfo 缺必填 supportedCardTypes | 补齐合法借记卡/信用卡数据，恢复旧测试类型兼容性 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets | 旧套件名含空格，被既有目标测试 provider 的类名规则拒绝；经 prepare-request 后临时仅改 describe 名执行，8 条原断言实际通过 | 诊断后恢复原文件全部字节，避免无业务收益的上游基线失效；该原生日志证明相同断言与修复后 fixture 能编译/执行，但不是最终原套件名文件的逐字节新鲜 PASS |

CR-001 诊断日志：doc/reports/cr001-coding-diagnosis/native/WalletMain/hdc-test.WalletMain.log，Tests run: 8, Failure: 0, Error: 0, Pass: 8, Ignore: 0；对应 hvigor-ut-build.WalletMain.log 编译成功。该次请求 summary 记录运行时快照；恢复 describe 名后不得宣称 request 对最终字节仍 fresh。最终产品源无变，正式 UT 阶段仍须沿其既有原生执行链验收；专项目标类名限制已披露，不改框架、不放宽契约、不修改任何断言。


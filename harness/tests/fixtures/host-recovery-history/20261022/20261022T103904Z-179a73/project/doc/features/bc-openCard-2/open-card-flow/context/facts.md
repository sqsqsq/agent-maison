---
schema_version: "1.1"
feature: "cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw"
run_id: "20261022T103904Z-179a73"
established_by: "coding"
ready_to_produce: true
has_blocker_coverage_risk: false
context_intent: "本次 coding 首阶段 admission：读取当前源码重建失效 facts，核实 CR-001"
change_intent: "feature"
estimated_loc_delta: 1000
touches_layers: ["01-Product", "02-Feature", "04-BusinessBase"]
adds_new_exports: true
exploration_mode: "subagent"
subagents_used: ["/root/coding_research"]
files_inspected_count: 34
searches_performed_estimate: 9
source_code_paths: ["01-Product/Phone/src/main/ets/pages/index.ets", "02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets", "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets", "02-Feature/WalletMain/src/main/ets/index.ets", "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets", "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets", "02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets", "02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets", "02-Feature/WalletMain/src/main/resources/base/element/string.json", "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets", "02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets", "02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets", "02-Feature/WalletMain/src/main/ets/presentation/components/BankListRow.ets", "02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningCoordinator.ets", "02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets", "02-Feature/WalletMain/src/main/ets/data/model/BankCardRecord.ets", "02-Feature/WalletMain/src/main/ets/data/model/BankCardType.ets", "02-Feature/WalletMain/src/main/ets/data/model/MockBankCard.ets", "02-Feature/WalletMain/src/main/ets/data/model/SaveBankCardResult.ets", "02-Feature/WalletMain/src/main/ets/domain/model/BankOpeningResultPayload.ets", "02-Feature/WalletMain/src/main/ets/domain/model/OtpSession.ets", "02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningNavigator.ets", "02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets", "02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets", "02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardResultPage.ets", "02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets", "02-Feature/WalletMain/src/main/ets/shared/BankOpeningCompletionBridge.ets", "02-Feature/WalletMain/src/main/resources/base/element/color.json", "02-Feature/WalletMain/src/main/resources/base/element/float.json", "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets", "04-BusinessBase/AccountManager/src/main/ets/index.ets", "01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets", "02-Feature/WalletMain/src/main/ets/presentation/components/CardStackSection.ets", "02-Feature/WalletMain/src/main/resources/base/media/open_card_guide.svg"]
key_inputs_read: ["build-profile.json5", "oh-package.json5", "framework.config.json", "doc/module-catalog.yaml", "doc/glossary.yaml", "doc/architecture.md", "doc/component-index.yaml", "framework/docs/README.md", "framework/profiles/hmos-app/skills/README.md", "framework/profiles/hmos-app/skills/coding/profile-addendum.md", "doc/features/bc-openCard-2/open-card-flow/contracts.yaml", "doc/features/bc-openCard-2/open-card-flow/acceptance.yaml", "doc/features/bc-openCard-2/open-card-flow/use-cases.yaml", "02-Feature/WalletMain/oh-package.json5", "02-Feature/WalletMain/src/main/module.json5", "01-Product/Phone/src/main/module.json5", "01-Product/Phone/src/main/resources/base/profile/main_pages.json"]
decisions_unlocked: ["从当前源码重建 coding facts，不继承无效 spec 身份", "保留 CR-001 已存在合法 fixture 同步和旧断言", "经正式 coding harness 核验实际闭环状态"]
---

# Coding 实际建立事实

本 run 首个实际阶段为 coding；旧 facts 的 spec 建立资格已被 admission 判无效，故按本次明确的 source reconstruction 输入重新读取当前源码建立此基线。未通过修改 run_id 或虚构 spec 执行承接旧基线。旧阶段报告仍保持原样可追溯。

## Code Facts

| 路径 | 事实 | 影响 |
|---|---|---|
| 01-Product/Phone/src/main/ets/pages/index.ets | aboutToAppear 挂载同一 NavPathStack，注册两个新 builder；setHomeActivator 切首页 Tab。 | 保持单一 Navigation。 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets | supportedCardTypes 为必填 BankCardType[]，不是可选字段。 | 所有 fixture 必须同步。 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets | getBanks 每家包含 DEBIT/CREDIT；getMockCards 按银行/类型校验并返回稳定完整卡号。 | 保留旧银行顺序及分组语义。 |
| 02-Feature/WalletMain/src/main/ets/index.ets | 导出两个新页面 builder 与 BankOpeningNavigator。 | Phone 经公开出口装配。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets | handleBankTap 调用 coordinator.start；本地 typeSheetVisible 控制 bindSheet，消失后再 push。 | 已非 not_supported；保留 expanded 状态。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets | 本地 allBanksTypeSheetVisible 与同一 coordinator；字母索引仍 scrollToIndex。 | 双入口一致，保留旧索引。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets | 订阅一次性完成载荷，RDB list 读取银行名/脱敏卡号；生命周期解绑监听。 | 当前已非纯 mock 首页。 |
| 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets | 增加选卡和结果路由名，保留旧路由常量。 | 根壳注册名对应。 |
| 02-Feature/WalletMain/src/main/resources/base/element/string.json | open_* 字符串覆盖类型、协议、OTP、结果文案；插值使用 %s/%d。 | UI 复用资源，不添加文案。 |
| 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets | mockPhone 默认 18500003841；构造参数可覆盖，旧账号字段仍保持。 | 验证码从账号 mock 读取原始手机号。 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets | useLogoMissing fixture 已增加合法两种卡类型；原错误、空数据 preset 不变。 | CR-001 两行兼容修复已存在，不撤销、不弱化类型。 |
| 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets | 既有银行顺序、分组、空数据、异常、导航、缺 logo 断言未改。 | 旧套件须真实执行；不新增或改断言。 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/BankListRow.ets | 行回调传出 BankInfo；logo 与 badge 使用银行资源。 | 复用既有组件。 |
| 02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningCoordinator.ets | 普通协调类使用已登记 Repository，校验 OTP 后等待 save；结果含完整卡号。 | 不把完整卡号输出 UI/日志。 |
| 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets | RDB bank_card.db，card_number UNIQUE，插入忽略冲突后查询确认；ResultSet finally close。 | 持久化及幂等真源保持在 Repository。 |

## phase_delta: coding

本次仅重建 facts 并核实既有修复，无新增产品源码或测试修改。与 trace.start_commit 90fd8a947683c8cec39dc8ec03e9076cb149ffd6 比较，SpyBankRepository 只有枚举 import 与 supportedCardTypes 两行，旧测试 diff 为空。前次范围失败与本次明确 implementation:CR-001 的归属解释需由正式门禁裁决；不撤销功能所需兼容修复、不伪造 UT 产出事实。

## Knowledge 与能力

已读取当前架构、模块/术语、组件索引与 BankListRow 定义和调用、包入口与模块配置。conventions、component-catalog 和三模块 code-graph 未启用，不创建。此次修复仅 fixture 兼容与 facts admission，不改变 UI 或交互，无需设备复现来验证这两行类型修复。视觉能力仍为 NO；既有 pixel_1to1 / approximate 与未验真债务保留，不声称看图或视觉通过。

## phase_delta: coding

补齐本次 admission 的完整当前源码目标覆盖；以下均已读取实际文件，不以旧事实代替。

| 路径 | 事实 | 影响 |
|---|---|---|
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardRecord.ets | 定义完整卡号、卡大类、银行/卡类型、时间、两支付状态与交易 JSON。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/data/model/BankCardType.ets | DEBIT/CREDIT 字符串枚举，两种合法银行卡类型。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/data/model/MockBankCard.ets | 模型保留完整号；maskCardNumber 前四后四，不足八位统一星号。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/data/model/SaveBankCardResult.ets | success、cardNumber、errorMessage 均为必填。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/domain/model/BankOpeningResultPayload.ets | fullCardNumber 与 SaveBankCardResult 构成结果载荷。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/domain/model/OtpSession.ets | 六位数字正则，open 即 send，deadline 60秒，每秒 tick，stop 清计时器及回调。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningNavigator.ets | 成功 publish 并激活首页再 clear；失败 clear 后 push 添加银行卡，沿 NavPathContext。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets | supportedCardTypes ForEach，单个 selectedType；继续异步 selectCardType，按钮承担同意动作。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets | 从 AccountService 获取 mockPhone，输入 filter/maxLength 与完整正则双校验，消失 closeOtp。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardResultPage.ets | onReady 接结果，隐藏返回并 onBackPressed true；只有完成调用 coordinator.finish。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets | 保留选中卡和协议状态，OTP 关闭后在 onDisappear push 结果，SAVING 时阻止关闭。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/shared/BankOpeningCompletionBridge.ets | 单个 pending，takePending 消费清空；订阅去重和取消订阅。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/resources/base/element/color.json | 已有 brand_primary 蓝色，页面/卡片/导航 token 复用。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/resources/base/element/float.json | 字体 fp 与银行间距 vp 资源；旧银行页几何继续使用。 | 保留已有契约与实现，不新增产品变更。 |
| 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets | getUserProfile 返回 UserProfile，沿默认 mockPhone；旧 AppStorage 登录契约不变。 | 保留已有契约与实现，不新增产品变更。 |
| 04-BusinessBase/AccountManager/src/main/ets/index.ets | 公开导出 UserProfile 和 AccountService，Feature 无深路径引用。 | 保留已有契约与实现，不新增产品变更。 |
| 01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets | onForeground 发 walletForeground 让首页重读，仍 loadContent pages/index。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/ets/presentation/components/CardStackSection.ets | 新增两个默认空的 Prop，仅顶层卡使用真实银行与脱敏号，原入口保留。 | 保留已有契约与实现，不新增产品变更。 |
| 02-Feature/WalletMain/src/main/resources/base/media/open_card_guide.svg | SVG 是近似手机/二维码原子插画，没有界面文案；未视觉验真。 | 保留已有契约与实现，不新增产品变更。 |

# Code Review 报告 — open-card-flow

> **模块标识**: `cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw`
> **审查日期**: 2026-10-22
> **审查版本**: v1.0
> **审查人**: Codex
> **保证等级**: `full`
> **能力解析说明**: review/reports/summary.json 的 assurance=full，六个 capability_resolutions 均 resolved；这是输入保证等级，不是产品通过结论。
> **对应设计文档**: `doc/features/bc-openCard-2/open-card-flow/plan/plan.md`

## 一、审查范围

基线为 HEAD `90fd8a947683c8cec39dc8ec03e9076cb149ffd6`，审查当前工作区（包含未跟踪新文件）。正式范围为 contracts.yaml 的全部 29 个文件，覆盖 WalletMain HAR、AccountManager HAR、Phone HAP；另外沿调用链读取 SpyBankRepository、PhoneAbility、CardStackSection、既有 AddCardEntryPage/CardPackPage/MineTabPage、CommUI SectionCard/ActionListItem。未修改产品或测试。

文件清单以 `../contracts.yaml#files` 为真源；新数据模型、两 Repository、OtpController、Coordinator、Navigator、CompletionBridge、四个新 UI、双入口、首页、资源、三模块出口、根路由及旧 UT 均已逐文件阅读。读取架构、Catalog/Glossary 相关职责、组件库存和 profile 易错点；conventions、component-catalog 和三个相关 CodeGraph 不存在，未创建。

### 实际审查文件清单

- `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets`
- `02-Feature/WalletMain/src/main/ets/data/model/BankCardType.ets`
- `02-Feature/WalletMain/src/main/ets/data/model/BankCardRecord.ets`
- `02-Feature/WalletMain/src/main/ets/data/model/MockBankCard.ets`
- `02-Feature/WalletMain/src/main/ets/data/model/SaveBankCardResult.ets`
- `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets`
- `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets`
- `02-Feature/WalletMain/src/main/ets/domain/model/OtpSession.ets`
- `02-Feature/WalletMain/src/main/ets/domain/model/BankOpeningResultPayload.ets`
- `02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningCoordinator.ets`
- `02-Feature/WalletMain/src/main/ets/domain/service/BankOpeningNavigator.ets`
- `02-Feature/WalletMain/src/main/ets/shared/BankOpeningCompletionBridge.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardResultPage.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets`
- `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets`
- `02-Feature/WalletMain/src/main/ets/index.ets`
- `02-Feature/WalletMain/src/main/resources/base/element/string.json`
- `02-Feature/WalletMain/src/main/resources/base/element/color.json`
- `02-Feature/WalletMain/src/main/resources/base/element/float.json`
- `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets`
- `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets`
- `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets`
- `04-BusinessBase/AccountManager/src/main/ets/index.ets`
- `01-Product/Phone/src/main/ets/pages/index.ets`
- `01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets`
- `02-Feature/WalletMain/src/main/ets/presentation/components/CardStackSection.ets`
- `02-Feature/WalletMain/src/main/resources/base/media/open_card_guide.svg`

## 二、审查方法

按架构、接口、编码、业务边界、数据责任五个维度审查，并对照 contracts、use-cases、acceptance、plan 与四张原图核验 UI。入口→类型选择→选卡→验证码→RDB→结果→完成清栈→首页重读逐段追踪；检查取消、异步过期、防重复提交、失败结果和唯一卡号恢复。未执行新的编译或测试；复用 coding/reports/script-report.json 的 coding_compile=PASS 和 hvigor-build.meta.json/log，仅证明应用 assembleHap，不证明 ohosTest 编译。

架构静态核对：跨模块均通过既有出口，shared 泛型桥不导入 domain，Phone 不持有卡片数据库，data 不向上依赖。新路由由原根 navDestinationMap 追加，旧四分支保留。RDB 表完整保存全卡号、两类类型、银行、添加时间、支付状态、交易 JSON；ResultSet 在 finally 关闭；插入异常仅在查询已有号成功后恢复成功。完整卡号不直接呈现在 UI/日志。以上为静态结论；真实清栈、系统返回/侧滑、键盘、倒计时和持久化重启仍待 testing。

### 视觉保真

实际打开原始需求目录的 3/4/5/6 四张 JPG，覆盖全部 P0 屏；未采集运行截图、不重跑像素度量。消费 `coding/reports/script-report.json` 的 visual_parity=PASS（仅 presence）、static_fidelity_score=WARN（基线 unverified）、structure_declaration_ledger=WARN；不把这些当作视觉通过。资源为 repo logo 与源码 SVG，未消费 crop，因此无适用裁图验真/contact sheet。`open_card_guide.svg` 有手机、二维码和手势构图；原需求明确“大差不差”，不因标为 placeholder 就要求精确复刻插画。

可见文案：消费同一 coding script-report 的检查，另逐条读 `coding/visible-text-exemptions.yaml`。三项“添卡失败”“银行卡保存失败，请稍后重试”“重新发送”分别来自失败分支和倒计时归零要求，豁免有据；无豁免可覆盖颜色或其他视觉差异。

逐条独立复核 `coding/structure-conformance.yaml`（9/9，非抽查）：

| node_id | 源码核验 | 原图核验 |
|---|---|---|
| type_root | CardTypeSheet 根 Column 绑定 color_page_bg | 图3 半模态浅灰背景，结构一致，精确颜色待机器测量 |
| type_bank_surface | 同文件银行与类型共用白色 Column | 图3 同一卡片内银行行与两类卡行一致 |
| type_savings | typeRow(DEBIT)，selectedType 同源单选 | 图3 与信用卡同组，顺序一致 |
| type_credit | typeRow(CREDIT)，selectedType 同源单选 | 图3 与储蓄卡同组，顺序一致 |
| selection_root | BankCardSelectionPage 内容 Column 绑定 color_page_bg | 图4 背景结构一致 |
| selection_cards | 同页候选卡 Column 绑定 color_card_bg | 图4 白卡行结构一致 |
| otp_root | OtpVerificationSheet 根 Column 绑定 color_page_bg | 图5 输入半模态背景结构一致 |
| otp_field_row | 同文件 TextInput 与重发 Button 同白底 Row | 图5 同行输入与倒计时一致 |
| result_root | BankCardResultPage 根 Column 绑定 color_page_bg | 图6 无标题结果页背景结构一致 |

台账统一 how 文本中“类型选项共享单选状态”仅适用于类型行；对其他条目仅确认其实际背景声明。implemented_by 只有文件路径导致机器定位 WARN，打开源码已核实真实承载，不将定位弱点冒充产品缺陷。全部 must_have 由上述四组件和原生系统栏/键盘承载；NFC 两元素按目标明确排除。选卡主按钮颜色存在 CR-002，不能用 presence PASS 掩盖。选中图标的默认主题色/形态及全部屏幕几何仍待 testing 的真实截图核验，不声称通过。

目标裁决：成功回钱包首页，失败清栈后回 AddBankCardPage；未来卡详情跳转不在本次实现。NFC 激活两元素明确不做。协议仅文本不要求可点击富文本。类型页“同意并继续”本身是同意动作，不为 contracts 中未消费的 agreementAccepted 字段增造复选框。

## 三、问题清单

| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |
|---|---|---|---|---|---|
| CR-001 | BLOCKER | 接口不一致 | BankInfo 第5行新增必填 supportedCardTypes，但原有 SpyBankRepository.useLogoMissing 第29行的 BankInfo 对象未补字段。编译旧 bank_open_card_ut.test.ets 时会在该对象赋值处缺少必填成员，旧 logo 降级用例无法执行。应用 assembleHap PASS 不覆盖此 ohosTest 源码。是本轮接口变化引入的确定性兼容回归，不是要求提前完成所有新 UT。 | `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` | coding 责任：同步已有 fixture 的合法 supportedCardTypes，保留必填业务契约和旧断言；通过框架目标测试入口验证旧 UT 可编译并执行。无需新增机制或放宽类型。 |
| CR-002 | MAJOR | 视觉保真 | 图4 招商银行具体卡片页的下一步为红色，源码第119行 selection_next 明确使用 brand_primary=#007DFF 蓝色。spec/ui-spec.yaml 同节点也承认“观察sidecar声明红色按钮…暂用既有token，列为待复核”，本轮直接打开原图确认红/蓝差异。冻结目标为四图布局保真，临时 token 不是豁免，且原需求仅允许结果插图近似。 | `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 根因归 spec 视觉 token：责任阶段先把 selection_next 映射到参考图正确的银行按钮颜色，再由 plan/coding 消费到资源和该按钮；不要全局改 brand_primary 影响其他蓝色页面。最终真机核该按钮与选中控件。 |

## 四、问题统计

| 严重程度 | 数量 |
|---|---|
| BLOCKER | 1 |
| MAJOR | 1 |
| MINOR | 0 |
| INFO | 0 |
| **合计** | **2** |

## 五、修复建议摘要

CR-001 修复生产接口变化遗漏的旧 fixture，再验证受影响测试。CR-002 回视觉输入 owner 补正确 token，并同步该节点实现；不扩大为新设计系统或全局主题重构。当前阶段只报告、不改早期产物或受保护源码。后续复核仅检查这两项和直接回归，复用仍有效编译证据，不因审查轮次重复全量测试。

验收边界：两项关闭后仍需既定 ut/testing 验证 AC-1..AC-7、BD-1..BD-3、NFR-1。特别关注所有银行入口、关闭再开验证码、等待60秒重发、真实 RDB 重读、失败结果、旧新页面互跳及结果页侧滑禁止。

## 六、结论

**审查结论**: 不通过

**判定依据**: BLOCKER 数量 1，MAJOR 数量 1，均未关闭。报告结构校验通过不等于产品通过；由 runner 回责任阶段修复。未运行 UT/真机，不声明视觉或导航验收完成。


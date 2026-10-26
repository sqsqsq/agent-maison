---
schema_version: "1.1.0"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
phase: "review"
ready_to_produce: true
has_blocker_coverage_risk: false
key_inputs_read:
  - "doc/features/bc-openCard-2/bank-card-opening-flow/context/facts.md — 已读并仅追加 phase_delta: review"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/spec/spec.md — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/plan/visual-parity.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/coding/structure-conformance.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json — 已读"
  - "doc/module-catalog.yaml、doc/glossary.yaml、doc/architecture.md — 已读适用原文"
  - "framework/profiles/hmos-app/skills/code-review/profile-addendum.md — 已读"
  - "framework/profiles/hmos-app/skills/coding/reference/arkts-pitfalls.md — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/ut/testability-audit.md — 已读返修来源"
source_code_paths:
  - "02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets"
  - "02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets"
  - "02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets"
  - "02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets"
  - "02-Feature/WalletMain/src/main/ets/index.ets"
  - "02-Feature/WalletMain/src/main/resources/base/profile/route_map.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/string.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/color.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/float.json"
  - "02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png"
  - "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/index.ets"
  - "01-Product/Phone/src/main/ets/pages/index.ets"
  - "01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets"
  - "02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets"
  - "02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets"
exploration_mode: "direct"
change_intent: "re-review after OTP testing failure backtrack repair"
estimated_loc_delta: 300
touches_layers: ["shared", "data", "domain", "presentation", "product-shell"]
adds_new_exports: true
single_function_scope: false
decisions_unlocked:
  - "CR-001～CR-003 保持关闭；最新 testing 回流的 OTP 六位输入按钮投影根因由当前单文件返修关闭"
  - "BankCardStore、BankCardOpeningSession、OtpVerificationState 与 Phone route registry 均被生产调用"
  - "审查结论：1 BLOCKER / 1 个非阻断视觉 MAJOR / 2 MINOR；background_search_bank 未实现，判定不通过并回 coding"
  - "视觉结构台账 16 项与源码承载一致；结果引导占位图继续按既有 best-effort major debt 披露"
subagents_used: "none"
searches_performed_estimate: 18
files_inspected_count: 31
---

## 探索预算与检索

- 最新回流：读取 `testing/reports/20261024T185039Z-266/hylyre/trace.json`、TC-001/005/008 失败 UI 树与截图；三处均为六位验证码可见而 `otp_next_btn.enabled=false`，TC-002 则是 selector ambiguous。
- 当前返修差异：`OtpVerificationSheet.ets` 相对上一份 review closure attestation 的 SHA-256 已变化；按钮改为读取页面 `@State otp`，保存入口仍以 service/session 校验为最终门禁。未发现对 RDB、倒计时、路由或清栈的直接影响。
- verifier 指出 must-have 覆盖缺口后，按 `ui-spec.yaml` 四个 P0 屏逐项核完 34 项；33 项有源码承载，`background_search_bank` 在 `AddBankCardPage.ets` 及 WalletMain 资源中均不存在，且 `ref-elements.yaml` 为 `implement`，形成 CR-007 BLOCKER。

- 基线：提交 `9b37cce3281566e6d20f5071dc502866d976ebe3` 加当前工作树中的 coding 产出。
- 复用上一轮对 `contracts.yaml > files` 的完整审查，并按 review closure attestation 的 SHA-256 差异精确定位本次 7 个变化生产文件和 1 个新增 Phone 源文件；另只读核对既有 UT 载体与 Spy。
- 沿完整卡号、RDB 事务、OTP 倒计时/保存、NavPathStack 清栈、完成上下文与 AccountService mobile 调用链追踪。
- 对照四张原始参考图、`ref-elements.yaml`、`visual-parity.yaml` 和 `structure-conformance.yaml`；未重跑设备像素度量。
- 检索完整卡号的展示/日志触点、跨模块 import、WalletMain 出口、route_map 与 Phone destination 注册。

## 已检视文件与原因

| 范围 | 为何读 |
|---|---|
| `contracts.yaml` 的 29 个 files 条目 | 正式审查范围 SSOT；其中 UT 文件归后续 ut 阶段 |
| WalletMain 新增模型/Repository/Service | 核对字段、接口、RDB 原子性、幂等、脱敏和导航规则 |
| 两个入口页、两个 Sheet、选卡页、结果页、首页 | 核对正常、取消、异常、重复操作和页面栈行为 |
| AccountManager mobile 扩展 | 核对账号域归属、旧调用兼容与隐私边界 |
| Phone 根页、WalletMain 出口、route_map | 核对旧路由兼容、跨模块出口和新增 destination |
| `WalletDestinationRegistry.ets` | 核对新增无 UI 路由识别入口被 Phone 根导航真实消费，而非测试专用死代码 |
| `BankCardOpeningSession` / `OtpVerificationState` / `BankCardStore` | 核对 UT 可测接缝不改变生产默认行为、状态生命周期或持久化边界 |
| 四张参考图及视觉治理产物 | 逐条核对 P0 结构声明、排除/延后和引导图语义 |

## Code Facts

| 路径 | 发现的事实 | 对本阶段产出的影响 |
|---|---|---|
| `CardTypeSheet.ets:12-24,126-139` | Sheet 出现时重置 `selectedType = null`，仅卡型行点击后赋值，继续按钮与处理函数都有空值门禁。 | CR-001 已关闭。 |
| `OtpVerificationSheet.ets:23-33,98-118,130-148` | 保存期间关闭按钮禁用；组件消失后 `isActive=false`，在途保存不得继续回调 `onFinished`。 | CR-002 已关闭；未发现返修直接回归。 |
| `BankCardSelectionPage.ets:40-44,175-180`、`string.json:376-377` | 协议资源按当前银行与路由卡型传入两个格式参数。 | CR-003 已关闭。 |
| `result_payment_guide_placeholder.png` | 图片仍是抽象灰色卡片占位，不包含参考图的手机、二维码与手部引导。 | 保留为 `visual-parity.yaml` 已登记的非阻断 best-effort major debt，发布前必须替换。 |
| `BankCardSelectionPage.ets:29-34,125-159` | 候选加载无 catch，空数组仅渲染空容器，无空态说明。 | 数据异常/空候选时不满足 spec E5，形成 MINOR。 |
| `BankCardRepository.ets` | 完整卡号作主键；查询、插入、回滚与唯一冲突回查均在 Repository 内。 | RDB 原子性和幂等设计静态核对通过，真实数据库行为交 UT/testing。 |
| `OpeningNavigationService.ets`、`BankCardOpeningResultPage.ets` | 成功 publish 后 clear 回根，失败 popToName 到 AddBankCardPage；结果页拦截 back。 | 与当前成功/失败裁决一致；侧滑真实效果交设备验证。 |
| `BankCardRepository.ets:21-29,31-69,136-174` | Store wrapper 可注入；默认构造仍要求 Context 并创建 `RdbBankCardStore`，保存仍执行 begin/query/insert/commit，异常回滚后回查。 | AC-4/BD-3 的生产 RDB 路径保持，接缝未引入测试 fast path。 |
| `BankCardOpeningService.ets:21-203` | service 组合 BankRepository、OtpVerificationState、BankCardRepository 与 session，统一驱动候选、OTP、保存、完成及 ENTRY→RESULT 阶段状态。 | AC-4 成功/失败完整分支获得无 ArkUI 的真实生产入口；页面调用链真实复用该对象。 |
| `BankCardSelectionPage.ets:21-71,94-105` | 页面构造生产 RDB/OTP 依赖，并把加载、选卡、协议和 OTP Sheet 事件交给同一 service。 | 返修不是测试专用死代码；页面仍只保留渲染镜像状态。 |
| `OtpVerificationSheet.ets:29-112` | Sheet 将发送、重发、tick、输入和完成保存转发给父页传入的 service。 | 60 秒门禁、六位 OTP 与成功/失败结果仍走生产协调入口。 |
| `OtpService.ets:8-81`、`OtpVerificationSheet.ets:31-125` | 状态对象在发送成功后启动 60 秒倒计时，倒计时期间和发送中拒绝重发；Sheet 生命周期执行 cancel/timer 清理并保留既有保存期关闭保护。 | AC-3、BD-2、BD-4 接缝与产品语义一致，未发现直接回归。 |
| `WalletDestinationRegistry.ets:1-22`、`pages/index.ets:24-40` | route registry 覆盖 4 个旧目的页和 2 个新目的页，根 builder 在分派前实际消费识别结果。 | AC-6 新旧目的页集合可由后续 UT 驱动；实际 builder 分支保持不变。 |
| `BankCardSelectionPage.ets:18-73,208-221` | 候选与协议的页面 `@State` 驱动按钮响应式重算，业务动作仍由同一 opening service 校验。 | 正式 testing 的六个 OTP 入口失败共因已由当前构建 ad-hoc 18/18 证据关闭。 |
| `AddBankCardPage.ets:63-112,411-420`、`AllBanksPage.ets:67-115,280-289` | 显式关闭使用 dismissing/pending 状态协调动画；系统关闭原因尚未在消失前统一置 dismissing。 | 显式关闭竞态由 ad-hoc 20/20 关闭；系统关闭后立即重开形成新增 MINOR CR-006。 |
| `HomeTabPage.ets:121-124` | 根容器声明稳定 `home_root`。 | AC-5 完成后首页 checkpoint 可绑定，未改变产品行为。 |

## 关键结论

- 分层依赖、跨模块出口、路由注册、资源引用和 RDB 字段映射未发现 BLOCKER；coding 的最近一次真实编译为 PASS。
- 三个功能性 MAJOR 已按原责任归属修复；testing 回流返修未重新打开这些问题，也没有新增功能性 MAJOR。
- 新增 CR-006 是 Sheet 非显式关闭路径的直接边界 MINOR；不扩大为新状态机，交 coding/testing 用现有生命周期机制闭环。
- 结果插画差异是上游已登记的 best-effort 非关键视觉 MAJOR，可披露后推进，但发布就绪继续 BLOCKED。
- `structure-conformance.yaml` 的 16 个 `implemented_by/how` 均能在对应源码找到真实承载；这只证明结构存在，不替代像素级设备验收。

## 覆盖风险

| 风险 | 处理 |
|---|---|
| 未在设备上操作倒计时、侧滑和真实 NavPathStack | 明确留给 testing；不宣称运行时通过。 |
| 本 CU 的新 UT 断言尚未生成 | 冻结链下一阶段为 ut；现有旧需求测试与 Spy 只作载体核对，不冒充本 CU 覆盖。 |
| 结果插画允许近似但近似边界主观 | 当前资产缺少手机/二维码/手势三个核心线索；沿用既有 major debt，不重造台账，交 testing/发布前重验。 |

## 进入产出

`ready_to_produce: true`；复审覆盖足以确认既有返修保持关闭、可测接缝无直接回归，并形成有条件通过裁决，无 BLOCKER 级覆盖风险。
## CR-007 返修限界复审（2026-10-24）

本轮复用既有正式范围与事实基线，只核 CR-007 的两处返修文件、页面直接布局/点击调用链和返修造成的直接回归，不重启全量审计。

| 路径 | 新事实 | 审查影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 新增 `searchRow()`，在收起态和展开态的副标题与银行白卡之间渲染 `background_search_bank`；该行不挂点击事件。 | CR-007 的元素承载已存在；银行点击、Sheet 状态和路由调用链未被搜索行接管。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 新增“搜索银行”“搜索”两个资源 key。 | 可见文案与 ref-elements 对齐且没有新增硬编码字符串。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 2026-10-24T19:16:45.224Z 的 coding 汇总为 PASS，当前修复后的编译、资源和静态规则通过。 | 复用该结果，不在纯 review 重复编译。 |
| `doc/features/_adhoc/testing/reports/measure-20261024-151528/shot-card_type_sheet.png` | 当前构建截图与设备量测定位 `background_search_bank`，ad-hoc 导航 8/8 步通过。 | 证明元素真实渲染且流程可达；像素判定仍留给正式 testing。 |

独立检视实际调用：`claude -p --model opus --permission-mode dontAsk --output-format json`；Claude Code `2.1.310`，canonical model `claude-opus-5-5`。CLI 确认 CR-007 静态关闭，并提出旧 `bc-openCard-1` 七行布局会减少一行。当前冻结目标明确要求新增搜索行，而本 CU 的旧行为兼容验收只约束路由名称与返回语义，因此该布局变化属于当前目标授权，不登记为本 CU 缺陷；正式 testing 继续按当前 `card_type_sheet` 视觉目标验收。

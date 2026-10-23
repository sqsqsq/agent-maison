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



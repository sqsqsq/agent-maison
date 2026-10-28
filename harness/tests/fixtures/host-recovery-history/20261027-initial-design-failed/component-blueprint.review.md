---
derived_from:
  artifact: component-blueprint@1
  component_id: wallet
  blueprint_id: bc-openCard-2
  revision: 1
  source_fingerprint: sha256:0f483e509979a5e90a6619c56fdf486b3372ce1c838f8e566af9dbda317881cd
  artifact_sha256: sha256:7b11cf36b77aff8b06a7fa45edeb1e35c00d33dfcfcbd0f27238b61f0354cef9
  change_units: []
projection: component-blueprint-review@12
---

# 银行卡添卡

<a id="design-626c75657072696e743a62632d6f70656e436172642d32"></a>
> 尚未补写评审说明；正文按当前已有字段展示。

阅读入口：先阅读方案、旅程、关键流程和交付安排；类型、方法、完整分支与验收全文见同文档的[技术与追溯参考](#reference)。

<a id="summary"></a>
## 1 方案摘要

从两个银行入口完成模拟选卡、验证码、本地保存及按结果清栈。

<a id="journey"></a>
## 4 用户旅程与界面

### scenarios-opening


<a id="solution"></a>
## 5 整体方案

银行卡数据和业务能力

提供卡种、模拟卡、验证码和完整卡持久化

WalletMain 实现添卡和 RDB；Phone 注册路由；AccountManager 提供 mock 手机号

<a id="flows"></a>
## 6 关键流程

### card-write-and-result

<a id="recovery"></a>
## 9 失败与恢复

### card-write-and-result

**处理**：结果页展示失败并保留本次完整卡号；完成后回添卡入口

**重试**：重新发起添卡

<a id="delivery"></a>
## 11 施工与上线

尚未拆分。

<a id="reference"></a>
## 技术与追溯参考

部件 wallet · 蓝图 bc-openCard-2 · revision 1 · 准入 阻塞

本文根据 canonical 蓝图与当前施工单元确定性生成，文首保留精确来源身份。是否通过设计交接见 readiness；施工授权、映射与完成结论由原责任阶段确认。可选说明缺失或过期不改变这些结论。

参考保留全部声明；不从名称、目录或数组顺序推断调用、依赖与未声明存储设计。正文的验收链接按来源目标与条目编号定位。

### A 字段与类型

<a id="review-summary-details"></a>
#### 原概述与目标

| 关切 | 设计说明 |
| --- | --- |
| 背景 | — |
| 问题 | — |
| 本次改变 | 从两个银行入口完成模拟选卡、验证码、本地保存及按结果清栈。 |
| 整体定位 | — |
| 范围 | — |
| 不做什么 | — |

未记录：背景（设计说明）；问题（设计说明）；整体定位（设计说明）；范围（设计说明）；不做什么（设计说明）。

<a id="review-terms"></a>
#### 领域模型、字段与枚举

设计期未写入领域模型，将由 plan 补；不从 DTO 推断另一份持久化模型。

### B 接口与存储明细

#### 本部件实际消费或提供的操作与 DTO

未记录接口契约。

#### 运行流与状态明细

<a id="design-766965773a72756e74696d652f666c6f773a636172642d77726974652d616e642d726573756c74"></a>
##### card-write-and-result

数据域：bank-card；契约：无；开发责任：view:development/node:development-opening

触发：

| 类型 | 时机 | 幂等 |
| --- | --- | --- |
| user | 六位验证码完成且点击下一步 | 提交期间禁用重复点击；卡号唯一约束避免重复卡 |

首次加载：load · 打开或创建 RDB；责任方 WalletMain；范围 本机已保存卡；新鲜度 提交时使用当前写入结果

权威状态：view:logical/node:logical-opening；持久化 local-rdb:wallet-cards；投影/缓存 view:runtime/node:runtime-opening；调和 以 RDB 写入结果为准，失败不得展示成功
状态责任方：view:runtime/node:runtime-opening；状态 选择银行；选择类型；选择卡；验证码；保存中；结果

写入与发布：

| 写入 | 类型 | 持久化 | 发布 | 恢复 |
| --- | --- | --- | --- | --- |
| save | user | local-rdb:wallet-cards | publication:result | recovery:save-failure |

| 发布 | 载荷 |
| --- | --- |
| result | 完整卡号与写入成功或失败结果，交给结果页 |

订阅与消费者：

未声明订阅。

| 消费者 | 首次加载 | 更新 |
| --- | --- | --- |
| result-page | initial-load:load | publication:result |

失败与恢复：save-failure

| 恢复关切 | 处理 |
| --- | --- |
| 失败处理 | 结果页展示失败并保留本次完整卡号；完成后回添卡入口 |
| 重试 | 重新发起添卡 |

生命周期：

全表共同依据：doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md。

| 场景 | 覆盖裁决 |
| --- | --- |
| 冷启动 | 已覆盖 |
| 热恢复 | 已覆盖 |
| 页面挂载 | 已覆盖 |
| 页面卸载 | 已覆盖 |
| 账号切换 | 已覆盖 |
| 进程重建 | 已覆盖 |
| 后台写入 | 不适用 |

验证关注：doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md

未记录：触发；时机；快照/语义；消费语义；处理。

### C 完整验收

设计期未写入 acceptance，将由 spec 补；不能把 absence 或文档成功当作设计充分。

### D 全部用例分支与界面调用

#### 用例、数据边界与分支

设计期未写入 use_cases，将由 plan 按真实义务补充。

### E 施工精确映射

### F 需求追溯

#### 需求追溯总表

| 需求项 | 类型 | 原始来源 |
| --- | --- | --- |
| bank-card-opening | requirement | doc/features/原始需求/1-2-银行卡/原始需求.md |

- bank-card-opening：[来源](../../../../doc/features/%E5%8E%9F%E5%A7%8B%E9%9C%80%E6%B1%82/1-2-%E9%93%B6%E8%A1%8C%E5%8D%A1/%E5%8E%9F%E5%A7%8B%E9%9C%80%E6%B1%82.md)

| 需求项 | 蓝图登记地址 | 当前 CU 直接引用 |
| --- | --- | --- |
| bank-card-opening | [scenarios-opening](#design-766965773a7363656e6172696f732f6e6f64653a7363656e6172696f732d6f70656e696e67) | 无 CU 直接引用 |

### G 质询、决定与稳定地址

<a id="reader-source-details"></a>
#### 决策精确声明

未记录决策及被否方案。

<a id="review-quality"></a>
#### 质量属性与数据生命周期

部件级质量属性未记录；精确阈值见已有 NFR。

<a id="review-data-domains"></a>
#### 数据用途与生命周期

数据生命周期未记录。

#### 风险、缺口与诊断

准入 阻塞；切片 open-card；阻塞 —

#### 来源不可用与降级影响

| 来源能力 | 可用 | 实际处置 |
| --- | --- | --- |
| se-manual-contracts | 否 | 不适用 |
| conventions-knowledge | 否 | 不适用 |

#### 设计内容与表达诊断（非阻断）

- $.review\_summary.reader\_guide：尚未补写评审说明；按当前设计字段展示。

#### App 根问题

| 问题 | 回答 | 裁决 | 依据 |
| --- | --- | --- | --- |
| 模块边界是什么？ | WalletMain 承担添卡和卡数据，Phone 注册目的地，AccountManager 提供账号 mock 手机号；依现有模块出口。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 哪些能力通过接缝消费？ | 页面调用 WalletMain 的卡仓库，账号手机号通过 AccountManager 出口读取，Phone 只装配导航。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 功能开关如何影响本切片？ | 本需求不引入功能开关，既有入口改为选择卡类型。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 谁生产、谁消费数据？ | 模拟银行和卡由本地数据源提供；确认保存的完整卡由 RDB 持久化；结果页和首页消费本次交接。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 生命周期有哪些触发？ | 打开验证码即发送模拟短信并启动计时；关闭停止计时；点击有效验证码后等待保存。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 谁拥有状态？ | 页面持有流程中临时选择，仓库持有数据库访问；RDB 是成功写入的权威。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 如何初始化？ | 银行列表按现有仓库加载；创建或打开 RDB，结果页接收当前完整卡号与成功状态。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 如何发布与订阅？ | 本轮完成操作经现有导航栈交接本次结果，临时状态在流程结束清理；无后台订阅。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 界面如何刷新？ | 写入完成后结果页显示真实结果；成功完成后首页接收本次卡号，失败回添卡入口。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |
| 进程如何恢复？ | 半完成的选择与验证码不持久化；进程重建不伪造成功，已提交成功的卡由 RDB 保留。 | 已据证回答 | doc/features/原始需求/1-2-银行卡/原始需求.md；doc/features/bc-openCard-2/blueprint/design-draft.md |

#### 编号速查

#### 稳定设计地址

- blueprint:bc-openCard-2：[bc-openCard-2](#design-626c75657072696e743a62632d6f70656e436172642d32)
- view:logical：[逻辑视图](#design-766965773a6c6f676963616c)
- view:logical/node:logical-opening：[logical-opening](#design-766965773a6c6f676963616c2f6e6f64653a6c6f676963616c2d6f70656e696e67)
- view:runtime：[运行时视图](#design-766965773a72756e74696d65)
- view:runtime/node:runtime-opening：[runtime-opening](#design-766965773a72756e74696d652f6e6f64653a72756e74696d652d6f70656e696e67)
- view:runtime/flow:card-write-and-result：[card-write-and-result](#design-766965773a72756e74696d652f666c6f773a636172642d77726974652d616e642d726573756c74)
- view:development：[开发视图](#design-766965773a646576656c6f706d656e74)
- view:development/node:development-opening：[development-opening](#design-766965773a646576656c6f706d656e742f6e6f64653a646576656c6f706d656e742d6f70656e696e67)
- view:deployment：[部署视图](#design-766965773a6465706c6f796d656e74)
- view:deployment/node:deployment-opening：[deployment-opening](#design-766965773a6465706c6f796d656e742f6e6f64653a6465706c6f796d656e742d6f70656e696e67)
- view:scenarios：[场景视图](#design-766965773a7363656e6172696f73)
- view:scenarios/node:scenarios-opening：[scenarios-opening](#design-766965773a7363656e6172696f732f6e6f64653a7363656e6172696f732d6f70656e696e67)
- relation:journey-logic：[journey-logic](#design-72656c6174696f6e3a6a6f75726e65792d6c6f676963)

通过 /component-design 提出意见。

### H 4+1 与章节对照

| 建模视图 | 正文阅读位置 |
| --- | --- |
| 场景（+1） | [用户旅程与界面](#journey)、验收（正文无此部分） |
| 逻辑 | [整体方案](#solution)、数据与存储（正文无此部分） |
| 运行时 | [关键流程](#flows)、[失败与恢复](#recovery) |
| 开发 | [整体方案](#solution)、[施工与上线](#delivery) |
| 部署 | 质量与安全（正文无此部分）、[施工与上线](#delivery) |

#### 场景视图（+1）

<a id="design-766965773a7363656e6172696f73"></a>
添卡用户旅程

| 适用性 | 本次影响 | 当前 | 目标 | 变化/依据 |
| --- | --- | --- | --- | --- |
| 适用 | 有变化 | 无法从银行进入绑卡 | 从两个银行入口进入类型、选卡、验证码及结果页 | 从两个银行入口进入类型、选卡、验证码及结果页 |

<a id="design-766965773a7363656e6172696f732f6e6f64653a7363656e6172696f732d6f70656e696e67"></a>
| 设计对象 | 模块/责任方 | 当前 | 目标 |
| --- | --- | --- | --- |
| scenarios-opening | — / WalletMain | 无法从银行进入绑卡 | 从两个银行入口进入类型、选卡、验证码及结果页 |

未记录：依据。

#### 逻辑视图

<a id="design-766965773a6c6f676963616c"></a>
银行卡数据和业务能力

| 适用性 | 本次影响 | 当前 | 目标 | 变化/依据 |
| --- | --- | --- | --- | --- |
| 适用 | 有变化 | 现有银行数据没有卡种、持久卡或验码 | 提供卡种、模拟卡、验证码和完整卡持久化 | 提供卡种、模拟卡、验证码和完整卡持久化 |

<a id="design-766965773a6c6f676963616c2f6e6f64653a6c6f676963616c2d6f70656e696e67"></a>
| 设计对象 | 模块/责任方 | 当前 | 目标 |
| --- | --- | --- | --- |
| logical-opening | — / WalletMain | 现有银行数据没有卡种、持久卡或验码 | 提供卡种、模拟卡、验证码和完整卡持久化 |

未记录：依据。

#### 运行时视图

<a id="design-766965773a72756e74696d65"></a>
写入及导航生命周期

| 适用性 | 本次影响 | 当前 | 目标 | 变化/依据 |
| --- | --- | --- | --- | --- |
| 适用 | 有变化 | 点击银行只提示 | 选择、验证、保存并依据实际结果清栈 | 选择、验证、保存并依据实际结果清栈 |

<a id="design-766965773a72756e74696d652f6e6f64653a72756e74696d652d6f70656e696e67"></a>
| 设计对象 | 模块/责任方 | 当前 | 目标 | 依据 |
| --- | --- | --- | --- | --- |
| runtime-opening | — / WalletMain | 点击银行只提示 | 选择、验证、保存并依据实际结果清栈 | view:logical/node:logical-opening |

#### 开发视图

<a id="design-766965773a646576656c6f706d656e74"></a>
工程模块与职责

| 适用性 | 本次影响 | 当前 | 目标 | 变化/依据 |
| --- | --- | --- | --- | --- |
| 适用 | 有变化 | WalletMain 提供银行页面，Phone 注册目的地，AccountManager 管理账号 | WalletMain 实现添卡和 RDB；Phone 注册路由；AccountManager 提供 mock 手机号 | WalletMain 实现添卡和 RDB；Phone 注册路由；AccountManager 提供 mock 手机号 |

<a id="design-766965773a646576656c6f706d656e742f6e6f64653a646576656c6f706d656e742d6f70656e696e67"></a>
| 设计对象 | 模块/责任方 | 当前 | 目标 | 依据 |
| --- | --- | --- | --- | --- |
| development-opening | WalletMain / WalletMain | WalletMain 提供银行页面，Phone 注册目的地，AccountManager 管理账号 | WalletMain 实现添卡和 RDB；Phone 注册路由；AccountManager 提供 mock 手机号 | view:logical/node:logical-opening |

#### 部署视图

<a id="design-766965773a6465706c6f796d656e74"></a>
本地 App 与数据库

| 适用性 | 本次影响 | 当前 | 目标 | 变化/依据 |
| --- | --- | --- | --- | --- |
| 适用 | 有变化 | Phone HAP 和本地模拟银行数据 | 同一 HAP 增加本地 RDB，不依赖真实短信服务 | 同一 HAP 增加本地 RDB，不依赖真实短信服务 |

<a id="design-766965773a6465706c6f796d656e742f6e6f64653a6465706c6f796d656e742d6f70656e696e67"></a>
| 设计对象 | 模块/责任方 | 当前 | 目标 |
| --- | --- | --- | --- |
| deployment-opening | — / WalletMain | Phone HAP 和本地模拟银行数据 | 同一 HAP 增加本地 RDB，不依赖真实短信服务 |

未记录：依据。

#### 本部件落点与外部参与方

| 参与方 |
| --- |
| deployment-opening |

未记录：职责；输入；输出；不负责范围；失败影响。

#### 外部契约与关系的本侧责任

#### 各视图的显式联系

<a id="design-72656c6174696f6e3a6a6f75726e65792d6c6f676963"></a>
| 关系 | 起点 | 终点 | 类型 | 责任方 | 认领 CU |
| --- | --- | --- | --- | --- | --- |
| journey-logic | view:scenarios/node:scenarios-opening | view:logical/node:logical-opening | uses | WalletMain | 无 CU 直接引用 |

```mermaid
flowchart LR
  n1["scenarios-opening（场景）"]
  n2["logical-opening（逻辑）"]
  n1 -->|uses| n2
```

##### scenarios-opening

旅程未记录。

| 逻辑对象/契约 | 运行流 | 开发落点 | 部署落点 |
| --- | --- | --- | --- |
| view:logical/node:logical-opening | view:runtime/node:runtime-opening | view:development/node:development-opening | view:deployment/node:deployment-opening |

---
derived_from:
  artifact: component-blueprint@1
  component_id: ledger
  blueprint_id: ledger-app-blueprint
  revision: 2
  source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
  artifact_sha256: sha256:6f453f5f1e30479830e27b4981d584544738ffa39db0784ae23f6cd12b2897a6
  change_units:
    - change_unit_id: ledger-consumer
      binding: bound
      identity_neutral_digest: acc4d2d8cc6e943bd2d5dcc9ae92103799d1dd0b5ce79a0547f9f382485bae80
    - change_unit_id: ledger-recovery
      binding: bound
      identity_neutral_digest: 5d557f0a09562a0be0217bb325799cad73444c9df4e07d59cdcb75f73cd8c0b2
    - change_unit_id: ledger-refresh
      binding: bound
      identity_neutral_digest: df5077c46ca4a628607b6b0ea3244e6329fa40f2d95e4b5675a356203d8c78dc
    - change_unit_id: ledger-summary
      binding: bound
      identity_neutral_digest: e0e7df92e03fb48f32e6ff2fd9a275f379b8935c3e1b5258657b17e9003d7d46
projection: component-blueprint-review@3
---

# Ledger App component blueprint

<a id="design-626c75657072696e743a6c65646765722d6170702d626c75657072696e74"></a>
revision 2 · 准入 pass · hash 6f453f5f1e30

## 概述

Ledger data is persisted by the repository and projected through a replaying store to the UI.

### 视图变化总览

<a id="design-766965773a6c6f676963616c"></a><a id="design-766965773a72756e74696d65"></a><a id="design-766965773a646576656c6f706d656e74"></a><a id="design-766965773a6465706c6f796d656e74"></a><a id="design-766965773a7363656e6172696f73"></a>
| 视图 | 适用/影响 | 当前 → 目标 | 本次变化/未变依据 |
| --- | --- | --- | --- |
| logical | applicable / changed | Existing repository and create operation. → Explicit ledger projection contract. | Freeze stable contract and state ownership. |
| runtime | applicable / changed | Repository loads and UI subscribes. → Replaying publication with lifecycle cleanup. | Add explicit freshness and reconciliation. |
| development | applicable / changed | Ledger files are grouped by technical type. → Ledger module owns repository and projection contract. | Establish explicit module owner without introducing a Maison provider. |
| deployment | not\_applicable / — | Single process and local persistence. → No deployment delta for this slice. | none |
| scenarios | applicable / changed | Add-entry flow exists. → Refresh and recovery are explicit. | Add lifecycle coverage. |

## 需求与范围

| 需求项 | 类型 | 原始来源 |
| --- | --- | --- |
| req-ledger-refresh | requirement | requirements/ledger.md#REQ-LEDGER-REFRESH |

- req-ledger-refresh：[来源](../../../../requirements/ledger.md#REQ-LEDGER-REFRESH)

## 方案与模块职责

### logical

<a id="design-766965773a6c6f676963616c2f6e6f64653a6c65646765722d646f6d61696e"></a>
| 节点 | 模块 | 责任方 | 当前 | 目标 |
| --- | --- | --- | --- | --- |
| ledger-domain (Ledger domain) | — | ledger-team | Repository entities | Stable ledger domain projection |

### runtime

<a id="design-766965773a72756e74696d652f6e6f64653a6c65646765722d7265706f7369746f7279"></a><a id="design-766965773a72756e74696d652f6e6f64653a6c65646765722d73746f7265"></a>
| 节点 | 模块 | 责任方 | 当前 | 目标 |
| --- | --- | --- | --- | --- |
| ledger-repository (LedgerRepository) | — | ledger-team | Persists entries | Authoritative local source |
| ledger-store (LedgerStore) | — | app-state-team | In-memory projection | Replayable projection |

### development

<a id="design-766965773a646576656c6f706d656e742f6e6f64653a6c65646765722d6d6f64756c65"></a>
| 节点 | 模块 | 责任方 | 当前 | 目标 |
| --- | --- | --- | --- | --- |
| ledger-module (Ledger module) | ledger | ledger-team | Existing source package | Host-owned ledger seam |

### scenarios

<a id="design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f"></a>
| 节点 | 模块 | 责任方 | 当前 | 目标 |
| --- | --- | --- | --- | --- |
| add-entry-scenario (Add entry and refresh other consumers) | — | ledger-team | User adds an entry | All consumers see a fresh snapshot |

### 跨视图关系

<a id="design-72656c6174696f6e3a7265706f7369746f72792d7075626c69736865732d73746f7265"></a><a id="design-72656c6174696f6e3a646f6d61696e2d6f776e65642d62792d6d6f64756c65"></a>
| 关系 | 起点 | 终点 | 类型 | 责任方 |
| --- | --- | --- | --- | --- |
| repository-publishes-store | view:runtime/node:ledger-repository | view:runtime/node:ledger-store | publishes\_snapshot | app-state-team |
| domain-owned-by-module | view:logical/node:ledger-domain | view:development/node:ledger-module | implemented\_by | ledger-team |

### 设计依据：App 根问题

| 问题 | 回答 | 裁决 | 依据 |
| --- | --- | --- | --- |
| 模块边界是什么？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 哪些能力通过接缝消费？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 功能开关如何影响本切片？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 谁生产、谁消费数据？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 生命周期有哪些触发？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 谁拥有状态？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 如何初始化？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 如何发布与订阅？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 界面如何刷新？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |
| 进程如何恢复？ | Ledger module owns repository and store integration. | answered\_with\_evidence | src/ledger |

## 关键运行流程

<a id="design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77"></a>
### ledger-refresh-flow

数据域：data-domain:ledger；契约：contract:create-entry-v1；开发责任：view:development/node:ledger-module

触发：

| 触发 | 类型 | 时机 | 幂等 |
| --- | --- | --- | --- |
| committed-user-mutation | user\_mutation | immediate | operation request id |
| cold-start-load | cold\_start | before-first-render | replace projection at repository revision |

首次加载：repository-snapshot · repository snapshot before subscription attach；责任方 app-state-team；范围 active account ledger；新鲜度 repository revision at attach time

权威状态：view:runtime/node:ledger-repository；持久化 sqlite:ledger-entry；投影/缓存 view:runtime/node:ledger-store；调和 Repository revision wins; pending UI writes are retried idempotently.
状态责任方：view:runtime/node:ledger-repository；状态 durable-ledger

写入与发布：

| 写入 | 类型 | 持久化 | 发布 | 恢复 |
| --- | --- | --- | --- | --- |
| add-entry | user | sqlite:ledger-entry | publication:ledger-changed | recovery:reload-ledger |

| 发布 | 快照/语义 |
| --- | --- |
| ledger-changed | full-current-ledger |

订阅与消费者：

| 订阅 | 发布 | 消费者 | 建立/解除 | 快照/重放 | 清理 | 顺序 |
| --- | --- | --- | --- | --- | --- | --- |
| ledger-page-subscription | — | consumer:ledger-page | page mount after snapshot / page unmount | latest ledger snapshot | remove observer token | repository revision order |

| 消费者 | 首次加载 | 更新 |
| --- | --- | --- |
| ledger-page | initial-load:repository-snapshot | publication:ledger-changed |

失败与恢复：reload-ledger · —；持久化失败 keep prior snapshot and expose retry；订阅失败 reload repository snapshot；进程重建 rebuild store from repository

生命周期：

| 场景 | 覆盖裁决 | 依据 |
| --- | --- | --- |
| cold\_start | covered | test/ledger/closure.test.ts#verifyColdStartLifecycle |
| warm\_resume | covered | test/ledger/closure.test.ts#verifyWarmResumeLifecycle |
| page\_attach | covered | test/ledger/closure.test.ts#verifyPageAttachLifecycle |
| page\_detach | covered | test/ledger/closure.test.ts#verifyPageDetachLifecycle |
| account\_switch | covered | test/ledger/closure.test.ts#verifyAccountSwitchLifecycle |
| process\_recreation | covered | test/ledger/closure.test.ts#verifyProcessRecreationLifecycle |
| background\_write | not\_applicable | decision:no-background-writer |

验证关注：test/ledger/closure.test.ts#verifyLedgerFlow

## 外部契约与数据变化

<a id="design-636f6e74726163743a6372656174652d656e7472792d7631"></a>
### create-entry-v1

操作：createEntry · v1 · app-to-ledger-service；责任方 ledger-contract-owner；需要方 cu-ledger-refresh

**请求 DTO：CreateEntryRequestV1**

| 字段 | 类型 | 必需 | 可空 | 语义 |
| --- | --- | --- | --- | --- |
| amount | decimal-string | true | false | signed ledger amount |
| currency | iso-4217 | true | false | entry currency |
| parent\_id | string | false | true | optional parent category |

**响应 DTO：CreateEntryResponseV1**

| 字段 | 类型 | 必需 | 可空 | 语义 |
| --- | --- | --- | --- | --- |
| entry\_id | string | true | false | stable entry identity |

映射：

| 映射 | 类型 | 源字段 | 目标字段 | 规则 |
| --- | --- | --- | --- | --- |
| request-amount | direct | amount | LedgerEntry.amount | Parse decimal without changing currency scale. |
| request-parent-level | derivation | parent\_id | LedgerEntry.parent\_level\_id | Resolve parent hierarchy level from parent\_id; this is not a wire field. |
| request-currency | direct | currency | LedgerEntry.currency | Preserve the ISO-4217 currency code. |
| response-entry-id | direct | entry\_id | LedgerEntry.id | Preserve stable identity. |

错误：validation\_error：request rejected without mutation；conflict：idempotent replay returns existing entry
幂等：client\_request\_id scoped to active account
非功能要求：freshness：UI refresh within one publication turn；durability：repository commit precedes publication

## 决策与取舍

<a id="design-6465636973696f6e3a7365616d2d7368617065"></a><a id="design-6465636973696f6e3a6465706c6f796d656e742d6e61"></a>
| 决策 | 类型 | 结论 | 选择依据 | 状态 | 责任方 |
| --- | --- | --- | --- | --- | --- |
| seam-shape | evolution\_candidate | keep\_direct；契约 LedgerDataSource；provider Host LedgerRepository implementations；consumer Host LedgerStore；绑定时机 App composition root；失败语义 Surface source failure and preserve prior projection.；Source variation affects lifecycle, tests, and reconciliation.；再次提取条件 A second source ships in the same release window. | 未记录 | decided\_with\_authority | architecture-owner |
| deployment-na | — | 未记录 | 未记录 | not\_applicable | architecture-owner |

## 施工拆分

### ledger-consumer

Deliver the ledger-consumer vertical slice from the admitted ledger blueprint.

来源绑定：已绑定。

交付结果：

| 谓词 | 职责 | 交付语义 | 提供项 | 验证关注 |
| --- | --- | --- | --- | --- |
| behavior | behavior | ledger-consumer behavior is executable. | ledger-consumer-ready | verify:ledger-consumer:behavior |
| owner | owner | LedgerRepository owns durable state. | ledger-consumer-ready | verify:ledger-consumer:owner |
| consumer | consumer | Ledger page is a real consumer. | ledger-consumer-ready | verify:ledger-consumer:consumer |
| contract | contract | create-entry-v1 remains authoritative. | ledger-consumer-ready | verify:ledger-consumer:contract |
| provider | provider | Host LedgerRepository is the first Provider. | ledger-consumer-ready | verify:ledger-consumer:provider |
| recovery | recovery | Repository snapshot restores state. | ledger-consumer-ready | verify:ledger-consumer:recovery |

| 提供项 | 交付说明 |
| --- | --- |
| ledger-consumer-ready | ledger-consumer vertical output is complete. |

显式依赖：

| 依赖 | 上游 CU | 上游提供项 |
| --- | --- | --- |
| need-refresh | ledger-refresh | ledger-refresh-vertical-slice |

可修改模块：ledger。
此范围不替代或扩大 Feature contracts.files 的写授权。

| 修改责任方 | 写入范围 | 设计引用 |
| --- | --- | --- |
| ledger-team | planned:src/ledger/ledger-consumer；planned:test/ledger/ledger-consumer | view:development/node:ledger-module |

保留约束：

| 说明 | 依据 |
| --- | --- |
| Repository commit remains authoritative. | verify:ledger-flow |

安全中间态：The slice builds and recovers independently.
构建：verify:ledger-consumer:build；兼容：verify:ledger-consumer:compatibility；恢复：verify:ledger-consumer:recovery

设计与执行阻塞项：无。

设计引用：

- [view:logical/node:ledger-domain](#design-766965773a6c6f676963616c2f6e6f64653a6c65646765722d646f6d61696e)
- [view:runtime/node:ledger-repository](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d7265706f7369746f7279)
- [view:runtime/node:ledger-store](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d73746f7265)
- [view:runtime/flow:ledger-refresh-flow](#design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77)
- [view:development/node:ledger-module](#design-766965773a646576656c6f706d656e742f6e6f64653a6c65646765722d6d6f64756c65)
- [view:scenarios/node:add-entry-scenario](#design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f)
- [relation:repository-publishes-store](#design-72656c6174696f6e3a7265706f7369746f72792d7075626c69736865732d73746f7265)
- [relation:domain-owned-by-module](#design-72656c6174696f6e3a646f6d61696e2d6f776e65642d62792d6d6f64756c65)
- [contract:create-entry-v1](#design-636f6e74726163743a6372656174652d656e7472792d7631)
- [decision:seam-shape](#design-6465636973696f6e3a7365616d2d7368617065)

验证关注：verify:ledger-consumer:vertical

### ledger-recovery

Deliver the ledger-recovery vertical slice from the admitted ledger blueprint.

来源绑定：已绑定。

交付结果：

| 谓词 | 职责 | 交付语义 | 提供项 | 验证关注 |
| --- | --- | --- | --- | --- |
| behavior | behavior | ledger-recovery behavior is executable. | ledger-recovery-ready | verify:ledger-recovery:behavior |
| owner | owner | LedgerRepository owns durable state. | ledger-recovery-ready | verify:ledger-recovery:owner |
| consumer | consumer | Ledger page is a real consumer. | ledger-recovery-ready | verify:ledger-recovery:consumer |
| contract | contract | create-entry-v1 remains authoritative. | ledger-recovery-ready | verify:ledger-recovery:contract |
| provider | provider | Host LedgerRepository is the first Provider. | ledger-recovery-ready | verify:ledger-recovery:provider |
| recovery | recovery | Repository snapshot restores state. | ledger-recovery-ready | verify:ledger-recovery:recovery |

| 提供项 | 交付说明 |
| --- | --- |
| ledger-recovery-ready | ledger-recovery vertical output is complete. |

显式依赖：

| 依赖 | 上游 CU | 上游提供项 |
| --- | --- | --- |
| need-consumer | ledger-consumer | ledger-consumer-ready |

可修改模块：ledger。
此范围不替代或扩大 Feature contracts.files 的写授权。

| 修改责任方 | 写入范围 | 设计引用 |
| --- | --- | --- |
| ledger-team | planned:src/ledger/ledger-recovery；planned:test/ledger/ledger-recovery | view:development/node:ledger-module |

保留约束：

| 说明 | 依据 |
| --- | --- |
| Repository commit remains authoritative. | verify:ledger-flow |

安全中间态：The slice builds and recovers independently.
构建：verify:ledger-recovery:build；兼容：verify:ledger-recovery:compatibility；恢复：verify:ledger-recovery:recovery

设计与执行阻塞项：无。

设计引用：

- [view:logical/node:ledger-domain](#design-766965773a6c6f676963616c2f6e6f64653a6c65646765722d646f6d61696e)
- [view:runtime/node:ledger-repository](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d7265706f7369746f7279)
- [view:runtime/node:ledger-store](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d73746f7265)
- [view:runtime/flow:ledger-refresh-flow](#design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77)
- [view:development/node:ledger-module](#design-766965773a646576656c6f706d656e742f6e6f64653a6c65646765722d6d6f64756c65)
- [view:scenarios/node:add-entry-scenario](#design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f)
- [relation:repository-publishes-store](#design-72656c6174696f6e3a7265706f7369746f72792d7075626c69736865732d73746f7265)
- [relation:domain-owned-by-module](#design-72656c6174696f6e3a646f6d61696e2d6f776e65642d62792d6d6f64756c65)
- [contract:create-entry-v1](#design-636f6e74726163743a6372656174652d656e7472792d7631)
- [decision:seam-shape](#design-6465636973696f6e3a7365616d2d7368617065)

验证关注：verify:ledger-recovery:vertical

### ledger-refresh

Land the approved ledger refresh vertical slice without creating a second runtime authority.

来源绑定：已绑定。

交付结果：

| 谓词 | 职责 | 交付语义 | 提供项 | 验证关注 |
| --- | --- | --- | --- | --- |
| refresh-behavior | behavior | A committed ledger mutation refreshes every affected consumer. | ledger-refresh-vertical-slice | verify:ledger-flow |
| runtime-owner | owner | LedgerRepository owns durable ledger state. | ledger-refresh-vertical-slice | verify:state-owner |
| page-consumer | consumer | Ledger page consumes initial and published snapshots. | ledger-refresh-vertical-slice | verify:add-entry-scenario |
| source-contract | contract | The approved create-entry operation and mappings remain authoritative. | ledger-refresh-vertical-slice | verify:create-entry-operation |
| repository-provider | provider | Host LedgerRepository provides LedgerDataSource. | ledger-refresh-vertical-slice | verify:ledger-source-contract |
| lifecycle-recovery | recovery | The store rebuilds from the repository after process recreation. | ledger-refresh-vertical-slice | verify:process-recreation |

| 提供项 | 交付说明 |
| --- | --- |
| ledger-refresh-vertical-slice | Ledger mutation, publication, consumer refresh, recovery and host seam are constructable. |

显式依赖：

未声明上游依赖；不从目录、purpose 或数组顺序推断施工顺序。

可修改模块：ledger。
此范围不替代或扩大 Feature contracts.files 的写授权。

| 修改责任方 | 写入范围 | 设计引用 |
| --- | --- | --- |
| ledger-team | planned:src/ledger；planned:test/ledger | view:development/node:ledger-module |

保留约束：

| 说明 | 依据 |
| --- | --- |
| Repository commit remains authoritative and precedes publication. | verify:ledger-flow |

安全中间态：The vertical slice builds and recovers independently while preserving standalone Feature compatibility.
构建：verify:feature-build；兼容：verify:standalone-feature；恢复：verify:process-recreation

设计与执行阻塞项：无。

设计引用：

- [view:logical/node:ledger-domain](#design-766965773a6c6f676963616c2f6e6f64653a6c65646765722d646f6d61696e)
- [view:runtime/node:ledger-repository](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d7265706f7369746f7279)
- [view:runtime/node:ledger-store](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d73746f7265)
- [view:runtime/flow:ledger-refresh-flow](#design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77)
- [view:development/node:ledger-module](#design-766965773a646576656c6f706d656e742f6e6f64653a6c65646765722d6d6f64756c65)
- [view:scenarios/node:add-entry-scenario](#design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f)
- [relation:repository-publishes-store](#design-72656c6174696f6e3a7265706f7369746f72792d7075626c69736865732d73746f7265)
- [relation:domain-owned-by-module](#design-72656c6174696f6e3a646f6d61696e2d6f776e65642d62792d6d6f64756c65)
- [contract:create-entry-v1](#design-636f6e74726163743a6372656174652d656e7472792d7631)
- [decision:seam-shape](#design-6465636973696f6e3a7365616d2d7368617065)

验证关注：verify:ledger-flow；verify:ledger-source-contract

### ledger-summary

Deliver the ledger-summary vertical slice from the admitted ledger blueprint.

来源绑定：已绑定。

交付结果：

| 谓词 | 职责 | 交付语义 | 提供项 | 验证关注 |
| --- | --- | --- | --- | --- |
| behavior | behavior | ledger-summary behavior is executable. | ledger-summary-ready | verify:ledger-summary:behavior |
| owner | owner | LedgerRepository owns durable state. | ledger-summary-ready | verify:ledger-summary:owner |
| consumer | consumer | Ledger page is a real consumer. | ledger-summary-ready | verify:ledger-summary:consumer |
| contract | contract | create-entry-v1 remains authoritative. | ledger-summary-ready | verify:ledger-summary:contract |
| provider | provider | Host LedgerRepository is the first Provider. | ledger-summary-ready | verify:ledger-summary:provider |
| recovery | recovery | Repository snapshot restores state. | ledger-summary-ready | verify:ledger-summary:recovery |

| 提供项 | 交付说明 |
| --- | --- |
| ledger-summary-ready | ledger-summary vertical output is complete. |

显式依赖：

| 依赖 | 上游 CU | 上游提供项 |
| --- | --- | --- |
| need-refresh-summary | ledger-refresh | ledger-refresh-vertical-slice |

可修改模块：ledger。
此范围不替代或扩大 Feature contracts.files 的写授权。

| 修改责任方 | 写入范围 | 设计引用 |
| --- | --- | --- |
| ledger-team | planned:src/ledger/ledger-summary；planned:test/ledger/ledger-summary | view:development/node:ledger-module |

保留约束：

| 说明 | 依据 |
| --- | --- |
| Repository commit remains authoritative. | verify:ledger-flow |

安全中间态：The slice builds and recovers independently.
构建：verify:ledger-summary:build；兼容：verify:ledger-summary:compatibility；恢复：verify:ledger-summary:recovery

设计与执行阻塞项：

| 阻塞项 | 阶段 | 责任方 | 原因 | 解除条件 |
| --- | --- | --- | --- | --- |
| release-approval | execution | release-owner | A current release decision is pending. | The authoritative approval revision advances. |

设计引用：

- [view:logical/node:ledger-domain](#design-766965773a6c6f676963616c2f6e6f64653a6c65646765722d646f6d61696e)
- [view:runtime/node:ledger-repository](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d7265706f7369746f7279)
- [view:runtime/node:ledger-store](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d73746f7265)
- [view:runtime/flow:ledger-refresh-flow](#design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77)
- [view:development/node:ledger-module](#design-766965773a646576656c6f706d656e742f6e6f64653a6c65646765722d6d6f64756c65)
- [view:scenarios/node:add-entry-scenario](#design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f)
- [relation:repository-publishes-store](#design-72656c6174696f6e3a7265706f7369746f72792d7075626c69736865732d73746f7265)
- [relation:domain-owned-by-module](#design-72656c6174696f6e3a646f6d61696e2d6f776e65642d62792d6d6f64756c65)
- [contract:create-entry-v1](#design-636f6e74726163743a6372656174652d656e7472792d7631)
- [decision:seam-shape](#design-6465636973696f6e3a7365616d2d7368617065)

验证关注：verify:ledger-summary:vertical

### 需求追溯总表

只列登记地址的直接引用者；覆盖结论由 component closure 负责。

| 需求项 | 蓝图登记地址 | 当前 CU 直接引用 |
| --- | --- | --- |
| req-ledger-refresh | [view:scenarios/node:add-entry-scenario](#design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f) | ledger-consumer；ledger-recovery；ledger-refresh；ledger-summary |
| req-ledger-refresh | [view:runtime/flow:ledger-refresh-flow](#design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77) | ledger-consumer；ledger-recovery；ledger-refresh；ledger-summary |
| req-ledger-refresh | [contract:create-entry-v1](#design-636f6e74726163743a6372656174652d656e7472792d7631) | ledger-consumer；ledger-recovery；ledger-refresh；ledger-summary |

## 风险、待决项与验收关注

准入：pass；切片：cu-ledger-refresh；阻塞：—

<a id="design-6761703a636c6f75642d73796e632d667574757265"></a>
| 缺口 | 状态 | 责任方 | 需要方 | 解除条件 |
| --- | --- | --- | --- | --- |
| cloud-sync-future | open\_decision | cloud-contract-owner | cu-cloud-sync-future | Approved cloud sync contract becomes accessible. |

### provider 可用性与降级

| provider | 可用 | 缺失处置 |
| --- | --- | --- |
| conventions-knowledge | false | not\_applicable |
| component-assets | false | not\_applicable |

## 附录：独立质询

| 范围 | 问题 | 裁决 | 回答 |
| --- | --- | --- | --- |
| view:logical | Is the logical view supported by current evidence and an explicit target delta? | answered\_with\_evidence | LedgerRepository owns durable state; LedgerStore owns the UI projection. |
| view:runtime | Is runtime ownership and lifecycle closed? | answered\_with\_evidence | The runtime flow closes load through recovery. |
| view:development | Is development ownership explicit? | answered\_with\_evidence | The ledger module owns the implementation seam. |
| view:scenarios | Are scenarios traceable across views? | answered\_with\_evidence | Add-entry traces to logical runtime and development objects. |
| flow:ledger-refresh-flow | Does the flow close mutation publication subscription and recovery? | answered\_with\_evidence | Every local flow reference resolves to a declared object. |
| relation:repository-publishes-store | Is repository publication linked to the store? | answered\_with\_evidence | The relation is explicit and verified. |
| relation:domain-owned-by-module | Is the logical domain assigned to a development owner? | answered\_with\_evidence | The domain is implemented by the ledger module. |
| app\_lens:module\_boundaries | Are module boundaries explicit? | answered\_with\_evidence | Ledger boundaries are explicit. |
| app\_lens:capability\_seams | Are capability seams explicit? | answered\_with\_evidence | LedgerDataSource is explicitly decided. |
| app\_lens:feature\_flags | Are feature flags accounted for? | answered\_with\_evidence | No flag changes the current ledger slice. |
| app\_lens:data\_producers\_consumers | Are producers and consumers known? | answered\_with\_evidence | Repository publication and page consumption are explicit. |
| app\_lens:lifecycle\_triggers | Are lifecycle triggers assessed? | answered\_with\_evidence | All six trigger conditions are evidence-backed. |
| app\_lens:state\_owners | Is every state owner unambiguous? | answered\_with\_evidence | LedgerRepository owns durable ledger state. |
| app\_lens:initialization | Is initialization explicit? | answered\_with\_evidence | Repository snapshot precedes subscription attach. |
| app\_lens:publication\_subscription | Are publication and subscription closed? | answered\_with\_evidence | Publication references and subscription cleanup are explicit. |
| app\_lens:ui\_refresh | Is UI refresh freshness explicit? | answered\_with\_evidence | Refresh occurs within one publication turn. |
| app\_lens:process\_recovery | Is process recovery explicit? | answered\_with\_evidence | The store rebuilds from the repository snapshot. |
| terminology:current\_scope\_items | Do business nouns in current scope items have terminology facts? | answered\_with\_evidence | Ledger nouns map to the existing ledger module; no new or ambiguous term needs a terminology fact. |

## 附录：稳定设计地址

- [blueprint:ledger-app-blueprint](#design-626c75657072696e743a6c65646765722d6170702d626c75657072696e74)
- [view:logical](#design-766965773a6c6f676963616c)
- [view:logical/node:ledger-domain](#design-766965773a6c6f676963616c2f6e6f64653a6c65646765722d646f6d61696e)
- [view:runtime](#design-766965773a72756e74696d65)
- [view:runtime/node:ledger-repository](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d7265706f7369746f7279)
- [view:runtime/node:ledger-store](#design-766965773a72756e74696d652f6e6f64653a6c65646765722d73746f7265)
- [view:runtime/flow:ledger-refresh-flow](#design-766965773a72756e74696d652f666c6f773a6c65646765722d726566726573682d666c6f77)
- [view:development](#design-766965773a646576656c6f706d656e74)
- [view:development/node:ledger-module](#design-766965773a646576656c6f706d656e742f6e6f64653a6c65646765722d6d6f64756c65)
- [view:deployment](#design-766965773a6465706c6f796d656e74)
- [view:scenarios](#design-766965773a7363656e6172696f73)
- [view:scenarios/node:add-entry-scenario](#design-766965773a7363656e6172696f732f6e6f64653a6164642d656e7472792d7363656e6172696f)
- [relation:repository-publishes-store](#design-72656c6174696f6e3a7265706f7369746f72792d7075626c69736865732d73746f7265)
- [relation:domain-owned-by-module](#design-72656c6174696f6e3a646f6d61696e2d6f776e65642d62792d6d6f64756c65)
- [decision:seam-shape](#design-6465636973696f6e3a7365616d2d7368617065)
- [decision:deployment-na](#design-6465636973696f6e3a6465706c6f796d656e742d6e61)
- [gap:cloud-sync-future](#design-6761703a636c6f75642d73796e632d667574757265)
- [contract:create-entry-v1](#design-636f6e74726163743a6372656174652d656e7472792d7631)

通过 `/component-design` 提出意见；授权裁决仍沿既有 feedback 接缝处理。

> 本文为 canonical 蓝图与 CU 的单向派生物，可重建；不作为人工批准记录或第二设计真源。

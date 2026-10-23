## Why

179a73 的返修把测试兼容问题派给 coding，却要求 UT 写入证明，并在重开后丢失合法源码写入和原 facts 基线。剩余队列被当作归属和依赖，造成可恢复任务耗尽；退役 lite 分支也继续影响现代请求。

## What Changes

- **BREAKING**：移除 lite 专用阶段、Skill、规则和共享分支。残留 `track: lite` 忽略并提示；旧 change/coding/exit 冻结链只由匹配旧发布件收尾或重新发起，详见 MIGRATION.md。
- 用唯一内存责任解析结果连接候选、写界、assess、运行时、义务重开和完成；保留 spec-driven 非 lite 定义。
- coding 可修本次实现直接造成的既有测试兼容问题，新增一项 `coding_existing_test_preserved`；新增用例/断言仍归 UT，真实验证独立签发。
- verification 候选保留真实 owner；以 requires/control_edges/实际输入决定依赖，允许 UT 承接等待它的 review 问题。
- 重开保留合法历史写入和原建立者 facts 基线；真实 owner 可沿现有有效 manifest 核验采纳旧误写。
- 上游问题格式/证据/归属过滤给可修反馈，终态说明实际最后失败及责任。

## Capabilities

### New Capabilities

- `repair-responsibility`: 单源责任解析、五类动作、有限测试兼容修补及合法历史承接。

### Modified Capabilities

- `workflow-tracks`: lite 退役与现代残留键/旧冻结链迁移边界。
- `phase-write-boundary`: 原始契约归属独立于剩余队列，合法修改者与验证签发者分离。
- `correction-routing`: verification 真实负责方和上游问题反馈。
- `skill-contracts`: 移除退役契约，明确有限测试修补与独立验证。
- `agent-adapters`: 移除 lite 入口及旧分档默认。
- `feature-artifact-layout`: 移除 change.md 专用产物，facts 保持原建立者。
- `harness-gates`: 删除 change/exit 专用门与闭环分支。
- `runtime-policy`: 删除 minimal/lite 求解及派发分支。
- `goal-runner`: 现代范围与非 lite 旧链的同源消费。
- `change-unit-continuous-progression`: 删除 CU lite 专用承诺，保留通用 CU sidecar。
- `instance-extension-management`: 路由只接受仍支持的职责。
- `complex-capability-meta-model`: 当前准入说明移除退役入口。

## Impact

影响 coding/review/UT/testing、责任候选、运行时与 facts 输入、Skill 契约、profile 测试定位及快照模拟 Agent；不新增依赖、持久 owner 表或恢复协议。不更改版本，不操作宿主/设备，开发回放不替代 pending 联合宿主观察。

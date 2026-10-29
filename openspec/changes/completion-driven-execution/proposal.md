## Why

阶段冷调用会丢失作者上下文，恢复还可能重复执行或沿用旧权限。已批准的72b6f0d9按P1→P4把同一请求收编为工作单元持续执行与真实完成闭环；本次先落实P1专用会话及恢复底座。

## What Changes

- P1在既有run、owner、请求和调用流上准确续接Codex、Claude与DSH原生会话，缺失会话时按当前事实重建专用上下文。
- P1统一两运输的上下文、写入归因、中断保全、独立核验权限与用户明示截止。新增底座不接受默认总调用或阶段总时长配额。
- **BREAKING** 后续P2/P3将同源检查/完成评估接入此底座，并删除固定阶段派工、默认配额及主上下文执行fallback；该切换和MIGRATION由各自阶段补齐。
- P4承接开发全链和用户安排的真实宿主联合验收；短CLI验证不代表原请求交付。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `agent-adapters`: 以准确原生ID续接、真实流持久化及当前权限编译执行参数。
- `goal-driver-handoff`: 两运输共用工作单元输入，重复回报幂等，运行中事实回流与中断后成果保全。
- `phase-write-boundary`: 工作单元作者与独立核验按产物性质和真实授权写入，保护正式结果。

## Impact

修改agent-invoke、共同executor、session handoff、现有runtime接线、manifest可选用户截止及定向测试；不新增运行器、场外状态或依赖。所有检查族可消费相同工作单元上下文，P1不提前删去P2/P3负责的旧消费者。仅Maison开发仓与隔离工程，不操作宿主/设备，不打包或改版本。

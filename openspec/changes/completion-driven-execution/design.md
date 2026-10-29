## Context

架构依据为docs/architecture.md与72b6f0d9的P1→P4。既有run、owner epoch、invoke_id、原始agent-events流和写入快照能够保存执行事实，无需另一运行器或会话数据库。b84未验收代码已按批准迁移表恢复，计划与原件保留。

## Goals / Non-Goals

**Goals:** P1提供可由P2直接消费的工作单元上下文、准确原生续接、共同运输、独立写界、绝对用户截止、运行中观察及可靠中断保全。

**Non-Goals:** 本阶段不实现P2完成/无进展判据，不做P3入口切换和全部旧预算消费者删除，不运行真实宿主或P4联合验收。四阶段共用此change，后续阶段按自己的范围补齐delta与任务。

## Decisions

- 原生定位只增加provider_session_id；从对应调用原始流立即持久化，恢复先核run、adapter、projectRoot与当前权限。缺ID或权限变化重建专用上下文，公开说明恢复边界。独立核验不使用作者会话。
- WorkUnitExecutionContext原位收编阶段上下文，phase只保留里程碑/旧消费者定位含义。purpose和既有请求身份仍是职责事实；executionRole只是当前调用的派生视图。
- 用户明示时限使用manifest可选user_deadline_at，UTC绝对值只换算一次。旧budget和phase timeout不作为新执行底座调用前提；具体工具超时与owner租约仍承担各自保护。
- 观察返回原始工具流、当前快照和写入变化，调用方复用相同结果不制造新评估。中断由现有owner绑定的进程/会话执行，确认停止后才记录waiting与产物；判定何时无进展由P2唯一负责。
- 写边界从Skill I/O、profile和可信范围派生。作者可写实现与测试输入，正式完成原件/绑定输入继续显式保护，真实runner工具产物沿既有排除与writer/重建保护。独立上下文不等于原生只读：质询/canary请求原生只读并披露实际能力，正式review/格式修复保留原有有界报告及工具能力，不获得产品源码写权。

## Risks / Trade-offs

- [原生会话不支持或已失效] → 真实报告能力边界，按当前事实重建；不使用--last、不回落主会话施工。
- [Claude恢复保留旧system snapshot] → 权限改变时按新授权重建，CLI实际收窄工具集；不靠追加一句prompt撤权。
- [旧消费者仍含阶段/配额控制] → P1只提供最终结构组成，P3统一切换并删除旧控制，本change不发布双路线。

## Migration Plan

先完成P1定向验证、三个CLI隔离续接与官方门禁；P2接检查/完成同源，P3切入口并更新MIGRATION和现行规范，P4完成开发全链及用户安排的宿主验收。各阶段提交可审切点，不把中间状态打包给消费者。

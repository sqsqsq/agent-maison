## Context

P2 已提供冻结 execution_scope、真实 attended 身份、successor 与基础完成验证，P3–P6 已提供实际来源及独立执行。P7 收编上层消费者与发布迁移，计划正文保持不变。

## Goals / Non-Goals

**Goals:** 完成范围与 CU/Component 目标覆盖同源；新旧协议明确分派；公开默认切换与比例相称验收。

**Non-Goals:** 不新建完成账本、兼容执行器或迁移状态；不改消费者历史；fixture 不冒充真实宿主；不擅自正式发布。

## Decisions

1. 现有 completion 增量版本绑定执行范围指纹，reader 独立读取出生范围，保留原件、run/attempt/事件血缘检查；旧记录继续旧合同。
2. CU 消费与 handoff 复用已存在的冻结范围/出生候选解析；候选只供新 run 准备，不成为完成证据。需求与验收聚合复用 P1 绑定内容，不要求物化叙述文档。
3. 默认 workflow/contract 走现代协议，旧 run 使用出生版本与冻结链恢复；内部兼容正文不依赖退役 slash 跳板。沿现有 UPDATE 备份清理，不新增 registry。
4. 先完成源代码和机械验证，再按已有打包命令验证临时 consumer。真实宿主资料尽早收集，未到位时明确保留未完成项。

## Risks / Trade-offs

- 默认切换可能暴露固定文件/旧阶段读取 → 沿实际消费链修复，既有新旧组合用例核对。
- 设备或宿主缺失 → 机械结果独立报告，真实宿主 todo 不勾选。

## Migration Plan

先接通完成与版本读取，再切默认及清理入口；MIGRATION 说明旧运行恢复与新请求来源要求。无发布指令时不执行正式 release:all。

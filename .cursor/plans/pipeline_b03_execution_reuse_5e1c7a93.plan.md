---
name: 六阶段重构 B03 提纲 — 构建执行复用与报告整理
overview: B02宿主后按真实浪费细化UT出包/重复执行和报告整理；保留completion probe、terminal仲裁和硬预算。
version: 3.0.0
todos:
  - id: b03-detail-after-b02
    content: 结合B01/B02的C-U日志细化本批具体复用点、输入边界、成本代价、提交组和验收命令，避免先造缓存机制。
    status: pending
  - id: b03-executor-lifecycle
    content: 撤回不因summary closed结束进程的通用改造；inline删除后保留既有completion probe/grace/kill和terminal仲裁。
    status: cancelled
  - id: b03-mode-context
    content: 细化attended被注入unattended指令的已确认接线问题，用现有executor上下文修提示分支并做bridge fixture，不扩展真实支持。
    status: pending
  - id: b03-build-ut-reuse
    content: 优先传递同次UT构建结果消除重复出包；跨harness重复执行仅按本批宿主证据和现有结果记录做最小补接。
    status: pending
  - id: b03-device-report-reuse
    content: 保留execution-key/force-device/report-only；辅助timing与报告问题可重建或UNKNOWN时不重新装机，真实执行缺口和性能AC仍须验证。
    status: pending
  - id: b03-local-acceptance
    content: 完成本批输入变化/复用/失败结果的生产调用次数测试、必要文档/OpenSpec与candidate本地验收。
    status: pending
  - id: b03-host-acceptance
    content: 用户触发bc-openCard-1的C-U受影响UT/testing goal窗口，验证目标重复消除且真实测试不漏，闭环后才进B04。
    status: pending
---

# B03滚动提纲

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。依赖B02宿主通过；先细化再实施。

## 本轮收缩

删除原第2条“必要输出未收齐不得仅凭summary closed结束进程”。保留 [phase-completion-probe](../../harness/scripts/utils/phase-completion-probe.ts)、[agent-invoke](../../harness/scripts/utils/agent-invoke.ts) 的完成探针/grace/kill与Codex terminal失败优先，避免已完成进程拖到硬预算。B02去inline依赖，不用改probe兜底；独立视觉provider不变。

## 待细化的真实工作

- [hvigor-runner.runHvigorTest](../../profiles/hmos-app/harness/hvigor-runner.ts) 在前置编译后再次出包：先传已有同次构建结果，不先做全局缓存。
- 内外harness重复UT/设备执行：从B01/B02实际日志确认，再使用已有HAP/执行键/结果记录判断复用。输入变、更晚失败、用户fresh要求不能沿用成功；证据不足时保留真实执行并披露。
- [check-testing](../../harness/scripts/check-testing.ts) 的timing/报告对账：区分统计与真实trace/包/设备/AC；统计可重建或UNKNOWN，不能冒充性能AC通过。
- [runtime.buildPhasePrompt](../../harness/scripts/goal-phase-runtime.ts) 的attended禁问提示用既有执行上下文纠正，fixture证明waiting正常；不引入第二套driver或新增K-A能力。

## 验收与非目标

细化需写清复用键实际已有字段、会放弃的fresh保证、相关命令和准确的工具次数断言。相同输入不重复真实执行、变化输入确实执行；旧成功不能盖新失败，缓存不增加稳定性轮次；completion清理仍有界。

不加通用缓存服务/manifest，不换UT框架，不减原生编译/业务断言。四主格代码契约和K/A fixture覆盖，用户触发C-U受影响窗口实测；候选件与精确命令先备好，不能自己替换主宿主。通过后才进B04。

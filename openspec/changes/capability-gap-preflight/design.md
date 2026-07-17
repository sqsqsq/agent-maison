# Design: capability-gap-preflight

见 proposal What Changes 与 plan e6a3c9f4 §三 t3-min（本 change 刻意最薄：preflight 形态，不触碰证据链契约；设计细节以 delta specs 为准）。

关键实现点：
1. 共享 preflight = resolvePhasePersonalPrerequisites + ensurePersonalSetup 的结构化包装，goal-runner 与 harness-runner 同源消费。
2. HARNESS_PREFLIGHT 持久化落 harness/state/（或 run 目录），stdout 同时打一行 'HARNESS_PREFLIGHT: {json}' 标记供无状态解析。
3. halt_reason=await_human_capability_gap 为新枚举值；goal-status/progress 渲染为「等待人工补齐环境能力，修好后 --resume」。


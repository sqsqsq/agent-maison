# Tasks: capability-gap-preflight

## 1. 结构化 preflight 出口

- [x] ensurePersonalSetup 返回结构化 result（经 runCapabilityPreflight 包装：code/prerequisites/message/双出口指引）（ok/code/capability/prerequisite/message/guidance 双出口）
- [x] harness-runner personal-setup 失败路径：exit 前输出机读 HARNESS_PREFLIGHT（stdout 标记行 + state 持久化），退出码语义不变

## 2. 交互态双出口话术

- [x] BLOCK 文案改双出口（引导安装默认 | 用户确认后诚实停止；确认=知情记录非授权；harness 不读 stdin）
- [x] skills 侧同步一句（agents-entry-detail §4.1 第 5 条补 resume 指引）（agents-entry-detail 环境判定纪律已落，此处只接"停止后 resume"指引）

## 3. goal 前置插入点

- [x] goal-runner：每 phase 每 attempt 在 agent_invoke_start 之前调共享 preflight（初跑与 --resume 均重检）
- [x] 缺口时不产生 agent_invoke_start（phase_halt.halt_reason=await_human_capability_gap + halted→run_end HALTED）：run_end=HALTED + halt_reason=await_human_capability_gap + 非零退出；不进 CUMULATIVE_HALT_FAMILY
- [x] goal-report 人读阶梯补 await_human_capability_gap 行（双出口+resume 指引）
- [x] v3：outcomes 携带 halt_reason/halt_guidance + run_end 终态事件携带 halt_reason（HALTED 时）+ goal 路径 emit HARNESS_PREFLIGHT
- [x] v4：guidance_install 双路解除话术（配置漂移自动失效直接 resume / 其余跑 --ensure 人工 reprobe 再 resume；环境没修 resume 会再次拦截）——"自动授予"话术随授予模型废弃一并移除；"resume 后仍缺口→再次 halt、修好→放行"在 toolchain-probe 单测层兑现（goal e2e 夹具仍欠）

## 4. 夹具

- [x] 能力齐备默认路径零变化（既有 goal/harness fixtures 全绿 + goal-capability-gate 集成夹具①直接断言：齐备→放行、零事件、无 HARNESS_PREFLIGHT 持久化）
- [x] 缺口 halt 语义（v5，goal-capability-gate 集成夹具走**真实链**：hmos-app profile 前置解析→ensure 门→probe 深检→事件落盘）：缺口=仅 phase_halt(await_human_capability_gap) 事件、**无 agent_invoke_start**、outcome.halt_reason/guidance 正确、HARNESS_PREFLIGHT 持久化带缺口码；resume 重检（环境未修）→再次 halt；人工 reprobe/修好（wrapper verified）→放行；run_end 携带 halt_reason 的取值语义由 resolveLastHaltReason 单测承载（invoke-gate 与 run_end 逻辑已抽取为 goal-runner 导出函数，主循环只剩 push+break 接线）
- [x] 进程级 goal-runner e2e → **用户拍板（2026-07-16）不立项**：不建进程级夹具基建（goal-runner 以 detectRepoLayout(__dirname) 决定 projectRoot，夹具须把 framework 树物化进临时消费工程，成本高），主循环接线的回归防护由**宿主工程真实需求重跑实测**承载；本 change 的 preflight 语义验收以 invoke-gate 真实链夹具（goal-capability-gate.unit.test.ts）收口
- [x] HARNESS_PREFLIGHT 机读输出（stdout 标记行 + state/.harness-preflight.json 持久化）可被 goal-runner 解析（交互态同样落盘）
- [x] 边界负例：结构性保证——preflight 只消费 prerequisite 码与 probe.project_compile，四个运行后 failure_kind 无进入路径（util 头注写死）

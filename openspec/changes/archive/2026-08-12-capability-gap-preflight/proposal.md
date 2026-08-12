# capability-gap-preflight — 工具链能力缺口诚实化（preflight 最小闭环）

## Why

plan e6a3c9f4 t3-min（07-16 多轮外部 review 收敛）：工具链能力现状是 profile 静态二态（BLOCKER/SKIP），环境缺口只能死磕（2.3.0 宿主"反复失败 6+ 次"）或换 generic 整段跳过。人签 waiver 放行通道因签发侧（confirmation-credential-issuance）未落地已出窗；本窗做**诚实停止**：缺口发生在 phase 开始前的 preflight（agent 未开跑），无需贯穿 CheckResult→evidence→completion 证据链——机器行为恒=输出结构化缺口+非零退出，不放行不绕过，环境修好后 resume。goal 侧关键时序：goal-runner 先发 agent_invoke_start 再调 agent、harness 在 agent 会话内才跑——等 harness 侧出口时 agent 已烧一轮，故 preflight 必须前移到 invoke 之前。

## What Changes

- **t1 结构化 preflight 出口**：ensurePersonalSetup 返回稳定结构化 preflight result（code/capability/prerequisite/指引）；harness-runner 在 personal-setup 失败 exit 前输出+持久化 HARNESS_PREFLIGHT 机读结果（现状裸 console.error+exit 1，goal 侧无从分类）。
- **t2 交互态双出口话术**：deveco_toolchain_missing / deveco_toolchain_capability_failed 类缺口输出双出口——引导安装（默认）| 用户确认后诚实停止（记录缺口声明与答复；答复采集由宿主交互层负责，harness 不读 stdin、不新增确认 receipt；「确认」仅知情记录不构成授权）。
- **t3 goal 前置插入点**：goal-runner 在每 phase 每 attempt 的 agent_invoke_start **之前**调共享 preflight（初跑与 --resume 均重检）；缺口时不产生 agent_invoke_start，直接 run_end=HALTED + halt_reason=await_human_capability_gap + 非零退出；不进 CUMULATIVE_HALT_FAMILY（无累计语义）。
- **t4 边界**：缺口判定只认显式前置能力码；ohos_test_sign_gap/ohos_test_hap_missing/device_tool_missing/device_install_failed 四个运行后 failure_kind 永不属于本通道（b4e7a2c9 双侧写死条款）；默认路径（能力齐备）全回归零变化。

显式非目标：waiver 放行/deferred_by_waiver 校验态/AWAITING_HUMAN_REVIEW 封顶（t3-full，俟 issuance 排期另立 plan）；EvidenceValidationStatus/receipt/feature-completion 契约（不触碰）。

## Capabilities

### Modified Capabilities

- `goal-runner`：invoke 前共享 preflight、await_human_capability_gap halt、resume 重检。
- `harness-gates`：personal-setup 结构化 preflight 出口（HARNESS_PREFLIGHT 持久化）与交互态双出口话术。

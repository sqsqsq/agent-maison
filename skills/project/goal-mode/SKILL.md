# Goal 模式（薄驱动）

> **BLOCKER**：本 Skill 只选择运行方式并启动/接入唯一 `GoalPhaseRuntime`。阶段事实来自既有 summary / closure / evidence，跨阶段建议只来自 `assess@1`；本 Skill 与宿主都不维护 next-phase 表，不执行私有 assess/gate/advance 循环，也不复制 runtime 裁决。

项目请求的输入、原生入口与停止点见 [project-entry](../../../docs/operations/project-entry.md)；仅执行本次授权职责，不由本 Skill 自行启动后继。

## 何时使用

用户要求以目标模式持续推进一个 feature 时使用。对用户只暴露两种模式：

- **有人在场**：自动执行已授权工作；出现必须由人决定或补充的信息时，立即列出等待项并询问。
- **无人值守**：自动执行已授权工作；把必须由人处理的事项停放为等待项，并确保 run 可脱离当前会话继续或稍后恢复。

明确说“我会看着、需要时问我”按有人在场处理；明确说“我先离开、后台继续、`--detach`”按无人值守处理，不重复确认。**当前存在对话不等于用户选择了有人在场**。意图不明确时必须使用 [confirmation-registry.yaml](../../reference/confirmation-registry.yaml) 的 `goal.run_mode`，只问“有人在场 / 无人值守”，不向用户暴露 `in-session`、`headless`、tier 等内部术语。选择有人在场后先走 `goal-mode-entry --prepare-scope` 生成范围候选，然后**两个载体二选一**：① 不建 run 的交互完整交付——直接 `harness-runner --phase <p> --feature <f>` 逐阶段跑，首次调用由机器把范围冻结进 `<features_dir>/<feature>/execution-scope.json`；② 需要 run 级预算 / 恢复时走 `--prepare-run` → attach（两次调用都显式传 `--run-mode attended`，`--prepare-scope` 不传也不接受该参数），run 以**转交时 feature 的有效范围**出生。权威优先级：本次关联的 run > feature 冻结记录；说不清时工具明确报错，不替你选边。选择无人值守后只走 `goal-runner --detach`。**候选生成是通用前置步骤**，与需求是否涉及 UI 无关。

## 输入

| 字段 | 必填 | 说明 |
|---|---|---|
| `feature` | 是 | feature slug |
| `requirement` | 否 | 需求描述 |
| `start_phase` / `end_phase` | 否 | 默认由 workflow 决定 |
| `adapter` | 否 | 按 personal setup 的已物化 adapter 解析 |
| `adapter_model` | 否 | **仅 headless/unattended（含 `--detach`）**：并发多窗口跑不同模型或要钉住本 run 模型时，启动 goal run 传 `--adapter-model <id>`——权威模型输入，随 headless argv 回放（`chrys`/`generic` 不支持，传即 BLOCKER）。**有人在场（in-session attended）不适用**——由宿主会话自跑，本 Skill 不消费该字段，不得静默未钉 |
| `run_mode` | 条件 | 明确意图直接映射；歧义时走 `goal.run_mode` |

## 唯一 runtime 循环

以下循环只由 `GoalPhaseRuntime` 执行，Skill/宿主不得逐项重实现：

1. **Assess**：读取 `assess@1` 结构化结果；不得凭聊天上下文猜当前阶段。
2. **Authorize**：runtime 校验预算、权限、preflight、device policy、write guard、trust、lease/fencing 与 adapter capability。`assess` 推荐不等于越权许可。
3. **Execute one phase**：runtime 冻结 phase-scoped context，再调用薄 executor。attended 请求中的 `run_id/phase/attempt_id/owner_id/owner_epoch` 必须原样传给 initializer、harness 与 `--sync-closure`，不得靠兄弟 shell 继承 env；**无人值守（`--detach`）相反**——上下文由 runner 注入的 env 继承，harness 与闭环命令不带这组 `--goal-*` 参数，传了会被判「模式不匹配」当场拒绝（入口拒绝 ≠ 执行了测试，也不是租约过期）。只有 receipt 正式 closed 后才可回传 `passed`。
4. **Gate / verdict / reassess**：runtime 独占 gate、verdict、重试/回退、closure 与下一轮；不得根据上一轮宿主内存直接决定下一 phase。

若 adapter 未声明 `in_session_reconcile + phase_context_isolation`，回退为“agent 自跑单 phase harness，再 assess”的手动编排；不得伪装为自治循环。无人值守需要 adapter 的 resume/handoff 能力，缺失时停止并明确说明能力缺口。

**两入口互斥与 phase executor（plan 07a41ec6 T9）**：本 Skill（GoalPhaseRuntime）与 Claude 原生 `/goal` 路径是两个入口，不得同时推进同一任务。原生 `/goal` 路径下主会话是薄 driver：每个阶段最多派发一个 `subagent_type: phase-executor` 子代理负责该阶段的产出与自检（跑 harness、投 verifier、跑 check-receipt），主会话只投递最小输入并收回 summary 路径与终态块；同一会话上下文不连续执行两个阶段；`--revalidate` 只是检查命令，不推进阶段。

## 启动与续跑

开始前按顺序执行：

1. [host-harness-readiness.md](../../reference/host-harness-readiness.md) 与 [harness-cli-cwd.md](../../reference/harness-cli-cwd.md)。
2. [personal-setup-gate.md](../../reference/personal-setup-gate.md)，以返回的 `activeAdapter` 为准；保留其 `visualProvider` advisory，但有人在场时须等第 4 步 canary 得出 primary effective image-input 后，才决定是否执行 S2.1 询问。
3. 链路含设备阶段时执行 [device-policy-gate.md](../../reference/device-policy-gate.md)。`device_policy_unset` 必须先确认（**只看 `code`，不看 `configured`**——坏凭据/只有 `disabled` 时 `configured=true` 而 `code=unset`；退出码非零或 stdout 非 JSON = 执行失败须停止，含凭据库不可读，不得当成"未配置"引导重新登记）；PIN 只能由用户在真实 TTY 登记，**绝不要让用户把 PIN 发到对话里**，也不得代输。
4. 有人在场且需求 UI 相关的新 run，先按 [interactive-vision-canary.md](../../reference/interactive-vision-canary.md) 完成 interactive canary（新鲜缓存会自动 `SKIP`），再消费同一条 effective image-input 结论：primary blind 时可按 personal setup S2.1 配置合法 provider，也可保持未配置；这不产生盲跑 waiver。随后按运维文档的通用两步走：先 `--prepare-scope` 生成范围候选（本步与 UI 无关，任何完整交付都要做；主 Agent 只提供四项输入，绑定与指纹一律由机器计算），核对它打印的范围投影与说明，再用 operations 文档的 `goal-mode-entry.ts --prepare-run --run-mode attended --feature ... --requirement ... --adapter ...` 创建 `manifest + run_created + run-control`；chain 含 coding/ut 时创建会冻结 `manifest.run_base_sha`，HEAD 不可得即停止且不派发 agent。严格视觉需求是否可继续由 requirement/capability 门禁裁决。已有 run 只按同一 `run_id` 恢复，attach/resume 不得补造 `run_created`。停机后请用户补上缺的输入、**重新发起同一请求**：`--prepare-run` 按接续决策返回既有 run 或新出生的后继 run（都照常以返回的 `run_id` attach；后继的承接审计与范围转交在附着时补写），或说明保持停止；无人值守重跑同一条 `--detach` 命令即可（正式开始过的 run 停下不到 5 分钟会先保持停止，过了冷却再发；有人在场不设冷却）。不要让用户找 run id 或拼 `--resume` / `--supersede` / `--force-resume`。attach 必须显式传 `--run-mode attended`，且 `--adapter` 必须等于 manifest adapter。无人值守只走 `goal-runner --detach`。

有人在场由当前会话提供 executor transport，生产入口固定为可执行 `harness/scripts/goal-mode-entry.ts` host bridge（`runGoalModeHostBridge()`→`GoalPhaseRuntime`）；完整命令和 JSONL phase callback 协议见 operations 文档。唯一 runtime 负责 assess、attempt、receipt/gate、verdict、重试/回退、closure 与 owner fence；Skill/宿主不得另拼推进循环或自行构造 owner token。active adapter 必须为每个 bridge 请求提供隔离 phase context，能力缺失即按上节回退。无人值守必须使用真正的 detached runner；`--detach` 本身即选择无人值守，差异仅是 `DetachedGoalPhaseExecutor` 的 adapter spawn transport。**非 orphan 状态下**，session 与 detached process 互转只能走 mailbox handoff：当前 owner 写 `handoff_requested`、静默并释放，新 owner 以 `epoch+1` CAS 接管并写 `handoff_accepted`。仅 `orphaned_session` 可在用户显式授权后通过既有 `--force-resume` / `forceTakeoverRunOwner` 执行 epoch takeover；supervisor 永不得触发该例外。禁止复制或转换 ledger。

具体 CLI、adapter 解析、detach 启动握手、进度汇报与 opt-in 盯守见 [goal-mode-operations.md](../../reference/goal-mode-operations.md)。

## 每轮汇报

稳定输出以下用户可见字段：

- feature、当前 phase、round
- 模式：有人在场 / 无人值守
- 本轮结果与下一动作
- 等待项（没有则省略）
- `run_id` 与进度文件

无人值守（`--detach`）启动后：launcher 已用 manifest / 本次新增 events / liveness / progress 做一次**有界启动握手**（≤30s），stdout 的 `startup.state` 区分 `ready`、快速 `terminal`、`alive_timeout` 与 `failed`；不得把 pid/目录单独当健康，也不得在 launcher 返回后再手搓轮询。`failed` 立即准确通知，`alive_timeout` 只表示尚未就绪且进程仍活，不能杀进程；其余汇报 `run_id` 与续查入口后**立即结束当前轮次**。不进入 monitor，除非用户明确要求盯守；查进度唯一入口是 `goal-status`。

遇到 human-only recommendation 时不得启动 phase：有人在场立即询问；无人值守写入等待项并安全停放。`DEFERRED` / `PARTIAL` 不得宣称完成。

## 不可绕过的边界

- driver 只做授权、失效事务、预算与运行控制；不得重写 `assess` 的跨阶段建议。
- preflight、device、timeout、cleanup、pass-snapshot、evidence freshness、write guard 与 fencing 仍是硬门禁。
- 非 owner 或旧 epoch 不得写 events / progress / manifest，也不得启动 phase。
- 主 agent 必须自己运行 harness/runner；不得把命令作为唯一出路推给用户。
- goal agent、attended/detached executor 与 supervisor 永不得构造 `--rebaseline-to`；该参数只属于 goal runtime 外的操作者管理命令，详见运行手册。
- 不得把 INCOMPLETE 软化为 PASS，不得在 Skill 内新增阶段顺序或 verdict→next-phase 表。
- 子代理（verifier / phase-executor）的结果只能同步等待，或先做与其结果无关的工作；禁止 sleep、轮询、后台等待器；verifier 未返回前不得修改它正在审的材料。

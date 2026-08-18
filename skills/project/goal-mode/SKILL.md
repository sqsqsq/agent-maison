# Goal 模式（薄驱动）

> **BLOCKER**：本 Skill 只编排 `assess → authorize → execute one phase → reassess`。阶段事实来自既有 summary / closure / evidence，跨阶段建议只来自 `assess@1`；本 Skill 不维护 next-phase 表，也不复制 runner 裁决。

## 何时使用

用户要求以目标模式持续推进一个 feature 时使用。对用户只暴露两种模式：

- **有人在场**：自动执行已授权工作；出现必须由人决定或补充的信息时，立即列出等待项并询问。
- **无人值守**：自动执行已授权工作；把必须由人处理的事项停放为等待项，并确保 run 可脱离当前会话继续或稍后恢复。

明确说“我会看着、需要时问我”按有人在场处理；明确说“我先离开、后台继续、`--detach`”按无人值守处理，不重复确认。意图不明确时使用 [confirmation-registry.yaml](../../reference/confirmation-registry.yaml) 的 `goal.run_mode`，只问“有人在场 / 无人值守”，不向用户暴露 `in-session`、`headless`、tier 等内部术语。

## 输入

| 字段 | 必填 | 说明 |
|---|---|---|
| `feature` | 是 | feature slug |
| `requirement` | 否 | 需求描述 |
| `start_phase` / `end_phase` | 否 | 默认由 workflow 决定 |
| `adapter` | 否 | 按 personal setup 的已物化 adapter 解析 |
| `adapter_model` | 否 | **仅 headless/unattended（含 `--detach`）**：并发多窗口跑不同模型或要钉住本 run 模型时，启动 goal run 传 `--adapter-model <id>`——权威模型输入，随 headless argv 回放（`chrys`/`generic` 不支持，传即 BLOCKER）。**有人在场（in-session attended）不适用**——由宿主会话自跑，本 Skill 不消费该字段，不得静默未钉 |
| `run_mode` | 条件 | 明确意图直接映射；歧义时走 `goal.run_mode` |

## 每轮唯一循环

1. **Assess**：读取 `assess@1` 结构化结果；不得凭聊天上下文猜当前阶段。
2. **Authorize**：driver 校验预算、权限、preflight、device policy、write guard、trust、lease/fencing 与 adapter capability。`assess` 推荐不等于越权许可。
3. **Execute one phase**：每个 phase 必须使用新鲜的 phase-scoped context，只把结构化 outcome/evidence 写回既有 manifest、events、progress 与 phase artifact。
4. **Reassess**：重新运行 `assess@1`，然后进入下一轮；不得根据上一轮内存直接决定下一 phase。

若 adapter 未声明 `in_session_reconcile + phase_context_isolation`，回退为“agent 自跑单 phase harness，再 assess”的手动编排；不得伪装为自治循环。无人值守需要 adapter 的 resume/handoff 能力，缺失时停止并明确说明能力缺口。

## 启动与续跑

开始前按顺序执行：

1. [host-harness-readiness.md](../../reference/host-harness-readiness.md) 与 [harness-cli-cwd.md](../../reference/harness-cli-cwd.md)。
2. [personal-setup-gate.md](../../reference/personal-setup-gate.md)，以返回的 `activeAdapter` 为准。
3. 链路含设备阶段时执行 [device-policy-gate.md](../../reference/device-policy-gate.md)。`device_policy_unset` 必须先确认（**只看 `code`，不看 `configured`**——坏凭据/只有 `disabled` 时 `configured=true` 而 `code=unset`；退出码非零或 stdout 非 JSON = 执行失败须停止，含凭据库不可读，不得当成"未配置"引导重新登记）；PIN 只能由用户在真实 TTY 登记，**绝不要让用户把 PIN 发到对话里**，也不得代输。
4. 新 run 先用 operations 文档的 `goal-mode-entry.ts --prepare-run --feature ... --requirement ... --adapter ...` 创建 manifest/run-control；已有 run 只按同一 `run_id` 恢复。随后 host bridge 取得 run-control owner/epoch 后才能执行 phase。

有人在场由当前会话逐轮驱动，生产入口固定为可执行 `harness/scripts/goal-mode-entry.ts` host bridge（内部调用 `runGoalModeHostBridge()`→`runGoalModeInSession()`→`runInSessionRound()`）；完整命令和 JSONL phase callback 协议见 operations 文档。Skill/宿主不得另拼循环或自行构造 owner token。active adapter 必须为每个 bridge 请求提供隔离 phase context，能力缺失即按上节回退。无人值守必须使用真正的 detached runner；`--detach` 本身即选择无人值守。session 与 detached process 互转时只能走 mailbox handoff：当前 owner 写 `handoff_requested`、静默并释放，新 owner 以 `epoch+1` CAS 接管并写 `handoff_accepted`。禁止复制或转换 ledger。

具体 CLI、adapter 解析、detach 启动握手、进度汇报与 opt-in 盯守见 [goal-mode-operations.md](../../reference/goal-mode-operations.md)。

## 每轮汇报

稳定输出以下用户可见字段：

- feature、当前 phase、round
- 模式：有人在场 / 无人值守
- 本轮结果与下一动作
- 等待项（没有则省略）
- `run_id` 与进度文件

无人值守（`--detach`）启动后：先执行**有界启动握手**（≤30s，只查 manifest 落盘 / `detach.log` 增长 / liveness；按结果分类汇报——有可信终态/等待态证据就报真实状态，非终态且进程健康报「已启动」，超窗但进程仍活报「尚未就绪，进程仍存活」，仅进程确实死亡且无结束证据才报「未存活」），汇报 `run_id` 与续查入口后**立即结束当前轮次**；不进入 monitor，除非用户明确要求盯守。查进度唯一入口是 `goal-status`。

遇到 human-only recommendation 时不得启动 phase：有人在场立即询问；无人值守写入等待项并安全停放。`DEFERRED` / `PARTIAL` 不得宣称完成。

## 不可绕过的边界

- driver 只做授权、失效事务、预算与运行控制；不得重写 `assess` 的跨阶段建议。
- preflight、device、timeout、cleanup、pass-snapshot、evidence freshness、write guard 与 fencing 仍是硬门禁。
- 非 owner 或旧 epoch 不得写 events / progress / manifest，也不得启动 phase。
- 主 agent 必须自己运行 harness/runner；不得把命令作为唯一出路推给用户。
- 不得把 INCOMPLETE 软化为 PASS，不得在 Skill 内新增阶段顺序或 verdict→next-phase 表。

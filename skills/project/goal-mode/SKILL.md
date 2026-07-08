# Goal 模式（薄入口）

> **BLOCKER**：本 Skill 是 **goal-runner 的宿主入口**，不实现独立 phase 裁决循环。裁决 SSOT：`harness/scripts/utils/phase-transition-policy.ts` + `goal-runner.ts`。宿主可见能力仅 **slash / 自然语言 / Skill**；**禁止**要求宿主手跑 harness（执行权见 [user-confirmation-ux.md](../../reference/user-confirmation-ux.md) §8.2b · `framework-agent-execution`）。

## 何时使用

用户要求进入 **目标模式 / 全自动（无人值守）**，对某个 **feature** 从指定 phase 推进到终点时，进入本 Skill 并由 **agent 自跑** goal-runner。「全链路 / 从 spec 到真机 / 一个需求做到尾」等表述属于 **batch_authorized**（对话内多 phase），**不是**本 Skill 的 goal 触发词。

## 输入解析

| 字段 | 必填 | 说明 |
|------|------|------|
| `feature` | 是 | feature slug |
| `requirement` | 否 | 需求描述 |
| `start_phase` / `end_phase` | 否 | 默认 spec→testing |
| `adapter` | 否 | 用户显式指定 agent → 校验 ∈ `materialized_adapters` 且入口产物存在 → 映射 `RESOLVED_ADAPTER`；未物化 → **STOP** 引导 `/framework-init` |

## 条件加载索引

- **首次启动 / 续跑 / 监控 loop 前**：完整读 [goal-mode-operations.md](../../reference/goal-mode-operations.md)（adapter 解析阶梯、personal setup 分流表、survival-first 启动事故背景、监控 loop 全部细则、manifest 字段）——本文档只留骨架命令，细节与 BLOCKER 判据均在那里。

## Agent 必须执行（勿推给用户）

**BLOCKER**：主 agent 须通过 Shell **自己**启动 goal-runner，读取报告后用自然语言汇报；**不得**在回复里写「请用户执行以下命令」作为唯一出路。

前置（**严格顺序**）：[host-harness-readiness](../../reference/host-harness-readiness.md) Tier_1 + [harness-cli-cwd](../../reference/harness-cli-cwd.md) → Personal setup（见 reference 的解析阶梯与分流表）。

### 首次启动

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "<需求描述>" \
  --adapter <activeAdapter（check-personal-setup 返回的 SSOT）> \
  [--adapter-source <user_explicit|entry_declared|registry>] \
  [--start spec] [--end testing] [--dry-run]
```

`--dry-run` 仅用于 agent 自验参数；用户要求真跑时去掉。`--adapter` 须为 check-personal-setup 的 `activeAdapter`（SSOT），goal-runner 会以 `framework.local.json` 对账：与记录冲突即 STOP。**仅当用户明确要本次临时换 adapter** 才加 `--override-adapter`。

**无人值守一律用真 `--detach`**（不是只靠宿主"后台启动"，二者语义不同——事故背景见 reference）：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "<需求>" --adapter <adapter> --detach
```

`--detach` 启动后**解析 stdout JSON 取 `run_id`**。**启动后存活自校验（BLOCKER）**：拿到 `run_id` 后必须确认它**真的起来了**——`report_dir/detach.log` 在增长、`goal-status` 活性正常。若没起来，如实报"启动未存活"，**不要**回报"已在后台跑"。

### 续跑

用户说「继续 goal run `<run-id>`」→ agent 自跑（**须带 feature**）：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --resume <run-id> --feature <feature-slug>
```

**BLOCKER**：主 agent **不得自行循环 `--resume`**；续跑必须由**用户**在对话中显式触发。若上次终态为 `HALTED` 或 `DEFERRED`，默认须加 `--force-resume`（冷却期内会被拒绝）。

### manifest（可选，agent 写入后自跑）

复杂参数可写 `goal-manifest.yaml`（schema：`framework/workflows/goal-manifest.schema.yaml`），再 `goal-runner.ts --manifest <path>`；字段说明见 reference。

## 运行中进度汇报

启动 runner 后，立刻告诉用户 `run_id` 与 `progress.json` 路径。除非用户明确要求 **fire-and-forget**，主 agent 在当前活跃对话轮次内 **必须**进入 bounded monitor（只读等待器，不启动/不续跑/不杀掉 goal-runner）：

```bash
cd framework/harness && npx ts-node scripts/goal-monitor.ts \
  --feature <feature-slug> --run-id <run-id|latest> \
  --since-event <last-seen-event-index> \
  --max-seconds 240 --markdown
```

loop 循环方式、超时耦合、liveness 异常处置等全部细则见 reference——**BLOCKER 要点**：调用 `--max-seconds N` 时宿主工具 timeout 必须显式 `> N`。

## 门禁清单表

| 检查 | 判据 | 失败处置 |
|---|---|---|
| 前台无人值守真跑 | `approval_mode=never` 且无 `--detach` | goal-runner BLOCKER 退出，改用 `--detach` |
| adapter 冲突 | `framework.local.json` 记录与请求不一致 | 默认尊重 local；换需走 registry `setup.adapter` |
| 未物化 adapter | `no_materialized_adapter` 等 code | STOP，引导 `/framework-init` |

## 报告解读（汇报给用户）

终态后 Read `<features_dir>/<feature>/goal-runs/<run-id>/goal-report.md` + `progress.md`：

| 状态 | 含义 |
|------|------|
| `COMPLETED` | 无 DEFERRED，全链 PASS |
| `DEFERRED` / `PARTIAL` | 存在外部阻塞未闭环，**禁止**宣称完成 |
| `HALTED` | FAIL 重试耗尽或 policy 拒绝续行 |

## 与原生 /goal 的关系

Maison 全链路 SSOT 是本 Skill → agent 自跑 **goal-runner**；Claude/Codex 原生 `/goal` 第一版仅为 adapter metadata + 条件模板占位，**不**替代 harness 裁决。

## 禁止

- 在本 Skill 内复刻 `classifyPhaseVerdict` / `resolveAutoChain` 逻辑
- 将 INCOMPLETE 软通过为 PASS 或 completed
- 把 `npx ts-node scripts/goal-runner.ts` 贴给用户让其手动执行
- personal-setup / preflight 门控失败、`no_materialized_adapter`、或任何歧义 → **STOP**，把结论与建议交回用户；**严禁**自行绕过 goal-runner、**严禁**转入自由改码、**严禁**据单次失败探测自下「项目未物化」结论而不复核 `--project-root`

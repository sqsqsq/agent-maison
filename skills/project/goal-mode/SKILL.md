# Goal 模式（薄入口）

> **BLOCKER**：本 Skill 是 **goal-runner 的宿主入口**，不实现独立 phase 裁决循环。
> 裁决 SSOT：`harness/scripts/utils/phase-transition-policy.ts` + `goal-runner.ts`。
> 宿主可见能力仅 **slash / 自然语言 / Skill**；**禁止**要求宿主手跑 harness（执行权见 [user-confirmation-ux.md](../../reference/user-confirmation-ux.md) §8.2b · `framework-agent-execution`）。

## 何时使用

用户要求进入 **目标模式 / 全自动（无人值守）**，对某个 **feature** 从指定 phase 推进到终点时，进入本 Skill 并由 **agent 自跑** goal-runner。

「全链路 / 从 spec 到真机 / 一个需求做到尾」等表述属于 **batch_authorized**（对话内多 phase），**不是**本 Skill 的 goal 触发词。

## 宿主怎么触发（用户侧）

| 方式 | 示例 |
|------|------|
| Claude slash | `/goal-mode demo-feature 全自动从 spec 做到 testing` |
| 自然语言 | 「对 `demo-feature` 进入目标模式，无人值守全自动」 |
| Codex/Cursor/generic Skill | 读跳板（skill id `goal-mode`）后进入本 Skill 正文 |

解析用户输入得到：

| 字段 | 必填 | 说明 |
|------|------|------|
| `feature` | 是 | feature slug |
| `requirement` | 否 | 需求描述 |
| `start_phase` / `end_phase` | 否 | 默认 spec→testing |
| `adapter` | 否 | 用户显式指定 agent（如「用 cursor 跑 goal」）→ 校验 ∈ `materialized_adapters` 且入口产物存在 → 映射 `--adapter`；未物化 → **STOP** 引导 `/framework-init`（不在 goal 流程内写项目产物） |

## Agent 必须执行（勿推给用户）

**BLOCKER**：主 agent 须通过 Shell **自己**启动 goal-runner，读取报告后用自然语言汇报；**不得**在回复里写「请用户执行以下命令」作为唯一出路。

前置：

1. [host-harness-readiness](../../reference/host-harness-readiness.md) Tier_1 + [harness-cli-cwd](../../reference/harness-cli-cwd.md)。
2. **Personal setup**（按是否显式指定 adapter 分流）：

   **A. 用户已显式指定 `adapter` 且已物化**（输入表 `adapter` 列 / 「用 cursor 跑 goal」等）→ 校验 ∈ `materialized_adapters` 且入口产物存在后，**可跳过** `--ensure`，直接 `--adapter <name>` 启动 goal-runner（goal-runner preflight 的 `argv_adapter` provenance 会放行，即使尚无 `framework.local.json`）。

   **B. 用户未显式指定 adapter** → **BLOCKER**：启动 goal-runner **之前**须 [personal-setup-gate](../../reference/personal-setup-gate.md)：

   ```bash
   cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>
   ```

   **仅解析 stdout JSON**（`ok`, `code`, `activeAdapter`, `candidates`, `message`）。按 `code` 分流：

   | `code` | 行为 |
   |--------|------|
   | `ok` | 已就绪（或 `--ensure` 已自动写入 `framework.local.json`）→ 继续 |
   | `needs_adapter_choice` | 多 adapter：registry **`setup.adapter`** 交互选择 → `init-orchestrate --scope personal` 的 **`record-adapter`** 写盘（**须经 `executionContext.activeAdapter`，禁 agent 手写 JSON**）；过程见 personal-setup-gate.md S1–S3 |
   | `no_materialized_adapter` / `not_in_materialized` / `entry_not_materialized` | **STOP**，引导 `/framework-init` |

   **边界**：写 `framework.local.json`（个人、gitignored）由 `record-adapter` 完成，**允许**；「不写项目产物」指 `.cursor/**`、`framework.config.json`、物化清单——二者不混为一谈。

### 首次启动

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "<需求描述>" \
  --adapter <显式指定或 personal setup 后的 active adapter> \
  [--start spec] [--end testing] [--dry-run]
```

`--dry-run` 仅用于 agent 自验参数；用户要求真跑时去掉。

### 续跑

用户说「继续 goal run `<run-id>`」→ agent 自跑（**须带 feature**）：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --resume <run-id> --feature <feature-slug>
```

**BLOCKER**：主 agent **不得自行循环 `--resume`**；续跑必须由**用户**在对话中显式触发。长时间后台运行时，允许每隔约 5–10 分钟跑**一次性** `goal-status --markdown` 向用户汇报进度（这不是 `--resume` 续跑）。

若上次终态为 `HALTED` 或 `DEFERRED`，默认须加 `--force-resume`（冷却期内会被拒绝）；勿在无用户确认时自动续跑。

### manifest（可选，agent 写入后自跑）

复杂参数可写 `goal-manifest.yaml`（schema：`framework/workflows/goal-manifest.schema.yaml`），再：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts --manifest <path>
```

## manifest 关键字段

- `feature`：feature slug（**必填**）
- `start_phase` / `end_phase`：起止 phase（默认 spec→testing）
- `dependency_policy`：哪些外部阻塞可 DEFERRED 续行（非 completed）
- `unattended`：写权限/审批/超时（preflight BLOCKER）
- 运行证据：`doc/features/<feature>/goal-runs/<run-id>/`（manifest、events、progress.json、每 phase prompt/输出、goal-report）

### 运行中进度汇报

启动 runner 后（建议后台 `block_until_ms: 0`），立刻告诉用户 `run_id` 与 `progress.json` 路径。

需要汇报「仍在跑什么」时，agent 自跑**一次性**（poll 一帧即退出，**不要**跑 `--watch` 常驻）：

```bash
cd framework/harness && npx ts-node scripts/goal-status.ts \
  --feature <feature-slug> --run-id <run-id|latest> --markdown
```

- **主干**：低频（5–10min）定时 poll 上述命令，覆盖静默卡死。
- **加速器（Cursor 等支持 `notify_on_output` 的宿主）**：匹配 runner stdout 里程碑行 `GOAL_PHASE` / `GOAL_RUN`，有进展时再 poll。
- 读 `progress.json` 时若 `generated_at` 很旧，须降级信任；权威活性用 `goal-status`（实时重算锁 pid）。
- 软窗口 `SUSPECTED_STALL` = 安静但可能活着；硬 `STALLED` = 超时/锁孤儿等真异常。

## 报告解读（汇报给用户）

终态后 Read `doc/features/<feature>/goal-runs/<run-id>/goal-report.md` + `progress.md`，用自然语言说明：

| 状态 | 含义 |
|------|------|
| `COMPLETED` | 无 DEFERRED，全链 PASS |
| `DEFERRED` / `PARTIAL` | 存在外部阻塞未闭环，**禁止**宣称完成 |
| `HALTED` | FAIL 重试耗尽或 policy 拒绝续行 |

## 与原生 /goal 的关系

- Maison 全链路 SSOT 是本 Skill → agent 自跑 **goal-runner**。
- Claude/Codex 原生 `/goal` 第一版仅为 adapter metadata + 条件模板占位，**不**替代 harness 裁决。

## 禁止

- 在本 Skill 内复刻 `classifyPhaseVerdict` / `resolveAutoChain` 逻辑
- 将 INCOMPLETE 软通过为 PASS 或 completed
- 把 `npx ts-node scripts/goal-runner.ts` 贴给用户让其手动执行

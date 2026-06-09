# Goal 模式（薄入口）

> **BLOCKER**：本 Skill 是 **goal-runner 的宿主入口**，不实现独立 phase 裁决循环。
> 裁决 SSOT：`harness/scripts/utils/phase-transition-policy.ts` + `goal-runner.ts`。
> 宿主可见能力仅 **slash / 自然语言 / Skill**；**禁止**要求宿主手跑 harness（执行权见 [user-confirmation-ux.md](../../reference/user-confirmation-ux.md) §8.2b · `framework-agent-execution`）。

## 何时使用

用户要求进入 **目标模式 / 全自动（无人值守）**，对某个 **feature** 从指定 phase 推进到终点时，进入本 Skill 并由 **agent 自跑** goal-runner。

「全链路 / 从 PRD 到真机 / 一个需求做到尾」等表述属于 **batch_authorized**（对话内多 phase），**不是**本 Skill 的 goal 触发词。

## 宿主怎么触发（用户侧）

| 方式 | 示例 |
|------|------|
| Claude slash | `/goal-mode demo-feature 全自动从 prd 做到 testing` |
| 自然语言 | 「对 `demo-feature` 进入目标模式，无人值守全自动」 |
| Codex/Cursor/generic Skill | 读跳板（skill id `goal-mode`）后进入本 Skill 正文 |

解析用户输入得到：`feature`（**必填**）、`requirement`（可选 `start_phase` / `end_phase`）。

## Agent 必须执行（勿推给用户）

**BLOCKER**：主 agent 须通过 Shell **自己**启动 goal-runner，读取报告后用自然语言汇报；**不得**在回复里写「请用户执行以下命令」作为唯一出路。

前置： [host-harness-readiness](../../reference/host-harness-readiness.md) Tier_1 + [harness-cli-cwd](../../reference/harness-cli-cwd.md)。

### 首次启动

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "<需求描述>" \
  --adapter <当前 framework.config.json agent_adapter> \
  [--start prd] [--end testing] [--dry-run]
```

`--dry-run` 仅用于 agent 自验参数；用户要求真跑时去掉。

### 续跑

用户说「继续 goal run `<run-id>`」→ agent 自跑（**须带 feature**）：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --resume <run-id> --feature <feature-slug>
```

### manifest（可选，agent 写入后自跑）

复杂参数可写 `goal-manifest.yaml`（schema：`framework/workflows/goal-manifest.schema.yaml`），再：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts --manifest <path>
```

## manifest 关键字段

- `feature`：feature slug（**必填**）
- `start_phase` / `end_phase`：起止 phase（默认 prd→testing）
- `dependency_policy`：哪些外部阻塞可 DEFERRED 续行（非 completed）
- `unattended`：写权限/审批/超时（preflight BLOCKER）
- 运行证据：`doc/features/<feature>/goal-runs/<run-id>/`（manifest、events、每 phase prompt/输出、goal-report）

## 报告解读（汇报给用户）

Read `doc/features/<feature>/goal-runs/<run-id>/goal-report.md`，用自然语言说明：

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

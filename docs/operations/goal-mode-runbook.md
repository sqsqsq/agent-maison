# Goal 模式运行手册（维护者 / agent 参考）

> **宿主入口 SSOT**：[goal-mode/SKILL.md](../../skills/project/goal-mode/SKILL.md)（slash `/goal-mode` 或自然语言「目标模式 / 全自动」；**禁止**要求用户手跑 harness）。
> 裁决 SSOT：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)（`goal_mode` **优先于** `batch_authorized`）

## 概述

`goal-runner` 是 Maison 工具无关的确定性全链路编排器：按 phase DAG 逐阶段 headless 调 agent → 跑 harness → 裁决 → 续行/重试/停止。运行证据落在 `doc/features/<feature>/goal-runs/<run-id>/`。

原生 Claude/Codex `/goal` 仅为可选加速层；闭环裁决以 harness `summary.json` + runner 为准。

## 宿主怎么用（产品面）

| 入口 | 说明 |
|------|------|
| `/goal-mode <feature> [需求]` | Claude slash（路由到 Skill） |
| 自然语言 | 「目标模式 / 全自动 / 无人值守全自动」→ agent 读 goal-mode Skill |
| Codex/Cursor/generic | skills-bridge 跳板（skill id `goal-mode`）→ 完整 Skill |

「全链路 / 从 spec 到真机」等属于 **batch_authorized**（对话内多 phase），不是 goal 模式触发词。

用户**不**直接执行 `goal-runner`；主 agent 按 Skill 内「Agent 必须执行」自跑。

## 维护者 / CI 调试（非宿主默认路径）

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "需求描述" \
  --adapter claude \
  --dry-run
```

去掉 `--dry-run` 前须确认 `unattended` 契约（manifest 或 adapter `goal_capability.external_runner.unattended`）。

续跑：`--resume <run-id> --feature <feature-slug>`（或 `--manifest <path>`）。

证据：`doc/features/<feature>/goal-runs/<run-id>/manifest.json`、`events.jsonl`、`goal-report.{md,json}`。

## 状态语义

| 最终状态 | 含义 |
|----------|------|
| `COMPLETED` | 全链 PASS，无 DEFERRED |
| `DEFERRED` | 到达 end 但存在外部阻塞未闭环 |
| `PARTIAL` | 中途停止或未到 end 且有 DEFERRED |
| `HALTED` | FAIL 重试耗尽或 policy 拒绝续行 |

**DEFERRED ≠ 完成**：不得宣称 UT/真机已闭环。

## Adapter 选择与 personal setup（goal 入口）

优先级：**显式 `--adapter` / 用户指定** > `framework.local.json`（`agent_adapter`）> 引导建立 local。

1. goal-mode Skill 启动 runner **前**跑 `check-personal-setup.ts --json --ensure`（见 [personal-setup-gate.md](../../skills/reference/personal-setup-gate.md)）。
2. 多 adapter → `needs_adapter_choice` → registry `setup.adapter` → `init-orchestrate --scope personal` → `record-adapter`（写 `framework.local.json`，非项目产物）。
3. 用户显式指定 adapter 且已物化 → 可 `--adapter` 直启（goal-runner preflight 不因缺 local 误杀）。
4. 未指定且 `source=fallback` → preflight BLOCKER，须先完成 personal setup。

## 两级校验

- **check-init**：`goal_capability` 缺失仅 WARN
- **goal-runner preflight**：`manifest.adapter` ∈ materialized + 入口产物 + `goal_capability`/`unattended` + **provenance**（仅 `fallback` 拦 personal setup）+ 无头 CLI 可解析（`--dry-run` 降级 WARN）

## Headless 路径（MVP 硬化）

- Claude：`claude -p` + `--permission-mode dontAsk` / `--allowedTools`（结构化 argv，不经 shell tokenize）
- Codex：`codex exec --sandbox workspace-write --ask-for-approval never|on-request`
- Cursor：`cursor-agent`（回落 `agent`）`-p` + prompt **positional argv**（`-p` 已含 write/shell；`approval_mode=never` 时加 `--force --trust`）。**禁止** `cursor agent --print`。Windows `.cmd` 垫片经 **cross-spawn** spawn（`harness` 依赖 `cross-spawn`）。
- Chrys：`chrys run --task <PROMPT_FILE> -C <PROJECT_ROOT> --agent Code --json`（文件传 prompt；preflight 空 `PROMPT_FILE` 时回退 positional）。前置：CLI 在 PATH 或 `%LOCALAPPDATA%\chrys\bin`；`bootstrap_runtime` 需 provider 凭据（`~/.chrys` 或 `.env`）；先手跑 `chrys run "hi" --agent Code` 验证。无流式输出（`agent-output.log` phase 结束前可能为空）；退出码 0/1(stderr JSON)/124/130。
- OpenCode：`opencode run --dangerously-skip-permissions --dir <PROJECT_ROOT>` + **stdin 灌 prompt**（**勿用 `-p`**，其为 `--password`）。前置：`npm i -g opencode-ai`，bin 名 `opencode`；模型/凭据由 opencode config/auth 提供，先手跑 `opencode run "hi"` 验证。**skill 落 opencode 自有原生目录 `.opencode/skill/<id>/SKILL.md`**（opencode 长期稳定的主 skill 目录，兼容当前版本及传统原生目录；不依赖较新的 `.agents` 外部 skill 发现）。`AGENTS.md` 仍在项目根（opencode 原生读为 instructions）。opencode **自动加载的只有** `AGENTS.md` + `.opencode/{skill,skills}/**/SKILL.md`；`.opencode/rules/*` 不自动加载（引用可达，非有效规则入口），maison 不碰用户 `.opencode/opencode.json`。默认开关全开（勿设 `OPENCODE_DISABLE_PROJECT_CONFIG` 等禁用 bundle 的 env）。Windows `.cmd` 经 cross-spawn。

```bash
# Chrys dry-run 示例
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter chrys --dry-run

# OpenCode dry-run 示例
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter opencode --dry-run
```

### 从无后台能力的宿主 shell 启动（chrys / opencode TUI 等）→ 必须 `--detach`

当**编排 agent 自己**（如 chrys TUI 的内置 shell 工具）去启动 goal-runner，而该 shell **仅阻塞、有超时上限、无后台模式**时：直接跑会秒级超时 → runner 变孤儿后台续跑 → agent 误判超时又重复起 run → 子进程互杀（chrys 实测）。**加 `--detach`**：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter chrys --detach
```

- launcher **秒级 fork 后台 child 并打印一行 JSON**（`{detached, run_id, report_dir, log, pid}`）后 `exit 0`；宿主 shell 拿到干净 0 退出码立即返回，**不触发超时杀树**。
- child 的 stdio 重定向到 `report_dir/detach.log`，**不继承宿主 shell 的管道**（否则宿主 `communicate()`/阻塞读会一直等到 child 关 pipe，反而拖到超时杀树）。
- 解析 launcher JSON 取 `run_id`，随后按下文 `goal-status` 轮询；`--detach` 同样兼容 `--resume <run-id> --feature <f> --detach`。
- 适用前提（实测，chrys `foundation/platform/process.py`）：宿主 shell 用 `CREATE_NEW_CONSOLE` 而非 kill-on-close Job Object，且**仅在超时/取消时杀树**——故 launcher 干净退出即可让 detach 存活。

**监控口径（chrys/opencode 无流式）**：`phases/<phase>/agent-output.log` 在 phase 结束前**恒为空**——活性**只**看 `goal-status` / `progress.json` / events 心跳（每 ~60s 一拍），**禁止** tail `agent-output.log` 判断卡死。

## 运行中进度（progress 契约）

事实源：`events.jsonl`（append-only）。派生快照：`progress.json` / `progress.md`（可重建）。

```bash
cd framework/harness && npx ts-node scripts/goal-status.ts \
  --feature <feature-slug> --run-id latest --json
```

| 入口 | 用途 |
|------|------|
| `progress.json` | IDE/插件/CI 文件 watch |
| `goal-status --json` | 无法直接解析路径时的命令契约；**实时重算** liveness + `generated_at` 新鲜度降级 |
| `goal-status --markdown` | agent 向用户汇报 |
| `goal-status --watch` | **仅供人在终端**；agent 勿跑常驻 watch；可加 `--max-ticks N` 限制轮询次数（测试/脚本用） |

**新鲜度降级**：非终态快照若 `generated_at` 超过 heartbeat 间隔 2–3 倍，不得信任 raw `status: RUNNING`（后台 terminal 随 IDE 会话回收会留下谎报）。终态快照（`COMPLETED`/`DEFERRED`/`PARTIAL`/`HALTED`）不降级。

**不要**把 `agent-output.log` 正文或 runner stdout 日志当协议；stdout 里程碑行 `GOAL_PHASE` / `GOAL_RUN` 是受维护的轻契约（通知锚点）。

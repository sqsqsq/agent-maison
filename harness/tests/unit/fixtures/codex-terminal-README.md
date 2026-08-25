# Codex terminal JSONL fixtures（plan e6b3f8d2 t1）

来源与纪律：**事件形态一律取自真实 `codex exec --json` 落盘样本，不得凭记忆手写**。
采集机器 CLI 版本 `codex-cli 0.149.0`（2026-08-25 本机实采）。

| 文件 | 采法 | 覆盖形态 |
|---|---|---|
| `codex-terminal-completed.real.jsonl` | `codex --ask-for-approval never exec --sandbox read-only --skip-git-repo-check --json`，prompt 走 stdin（"Reply with exactly the word OK"），进程 exit 0 | `thread.started` → `turn.started` → `item.completed(agent_message)` → **`turn.completed`（含 usage）** |
| `codex-terminal-failed.real.jsonl` | 同上但 `--model definitely-not-a-real-model-xyz`（ChatGPT 账号不支持该模型），进程 exit 1 | `item.completed(item.type=error)`（**item 级**错误）、**顶层 `error` 事件**、**`turn.failed`（含 error.message）** |
| `codex-terminal-item-error-then-completed.real.jsonl` | 同上，prompt 要求跑一条 shell 命令（沙箱拒绝 → 模型自行重试 → MCP 调用被审批策略拒绝），进程 exit 0 | 多条 `item.started`/`item.completed`，含 `item.error` 非空 + `status:"failed"` 的 `mcp_tool_call`，**turn 仍以 `turn.completed` 收尾** —— 证明 item 级错误 ≠ turn 终态 |
| `codex-terminal-error-then-completed.spliced.jsonl` | **由上面两份真实样本的原始行拼接**（`failed` 的顶层 `error` 行 + `completed` 的 thread/turn/message/`turn.completed` 行），未新增或改写任何字段 | 官方合法序列「顶层 error → 后续 turn.completed」——解析器不得据 error 提前判死/杀进程 |

已做脱敏：`codex-terminal-item-error-then-completed.real.jsonl` 里的本机绝对路径替换为
`<redacted-path>`、超长 MCP 结果正文截断（保留 JSON 结构与全部 `type`/`status`/`error`
字段）。其余文件逐字节原样。

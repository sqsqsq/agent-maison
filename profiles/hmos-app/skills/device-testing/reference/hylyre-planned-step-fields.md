# Hylyre Planned Step 字段规则（vendored SSOT）

> 从 [`hylyre-0.1.0-py3-none-any.whl`](../../../vendor/hylyre/hylyre-0.1.0-py3-none-any.whl) 内 `hylyre/api/agent.py` 与 `planned_step_keys.py` 提取。
> Framework 仓内 **不** 包含 Hylyre 工程的 `docs/agent-plan-a.md`；本文件供 agent / lint / derive 消费。

## 根键 SSOT

与 [`hylyre-planned-step-keys.ts`](../../../../../harness/scripts/utils/hylyre-planned-step-keys.ts) 同步：

`touch` · `input` · `swipe` · `scroll` · `back` · `home` · `stop_app` · `clear_app` · `wait` · `wait_for` · `wait_gone` · `wait_idle` · `assert_toast` · `start_app`（即席 harness **禁止** steps 内 `start_app`）

**禁止作为步骤根键的 CLI 名**：`dump_ui` / `dump-ui` / `page_save` / `screenshot` 等（见 `FORBIDDEN_STEP_ROOT_KEYS`）。

## 等待类：seconds vs timeout（易混）

| 根键 | 时长字段 | 默认 | 其它必填 | 运行时错误示例 |
|------|----------|------|----------|----------------|
| `wait` | **`seconds`** | — | — | `wait requires seconds` |
| `wait_for` | **`timeout`** | 10 | selector / by_text / by_id | selector 缺失 |
| `wait_gone` | **`timeout`** | 10 | selector / by_text / by_id | selector 缺失 |
| `wait_idle` | **`timeout`** | 10 | —（`idle_time` 默认 0.7） | — |
| `assert_toast` | **`timeout`** | 3 | **`text`** | `assert_toast requires text` |

**常见误写**：`{"wait":{"timeout":3}}` — lint 规则 **STEP-WAIT-SECONDS** 会在写前拦截。

## 各根键最小 JSON 形态

```json
{"touch":{"by_text":"按钮"}}
{"touch":{"by_id":"btn_id"}}
{"input":{"by_id":"field","text":"100"}}
{"swipe":{"direction":"UP","distance":50}}
{"scroll":{"direction":"down","steps":6}}
{"back":{}}
{"home":{}}
{"wait":{"seconds":2}}
{"wait_for":{"by_text":"加载完成","timeout":10}}
{"wait_gone":{"by_id":"spinner","timeout":10}}
{"wait_idle":{"idle_time":0.7,"timeout":10}}
{"assert_toast":{"text":"成功","timeout":3}}
```

## 观察 UI（非 planned step）

`dump-ui` 为 **CLI 探索命令**（warmup / 即席 `--dump-ui-only`），**不得**写进步骤 JSON 根键 `dump_ui`。

## Lint 规则 ID（framework）

| 规则 | 说明 |
|------|------|
| STEP-001 | 每步恰好一个已知根键 |
| STEP-002 | 禁止 CLI 名根键（含 `dump_ui`） |
| STEP-WAIT | `wait_for` 缺 selector/by_text/by_id |
| STEP-WAIT-SECONDS | `wait` 缺 `seconds` 或误用 `timeout`/`duration` |

写前校验：`cd framework/harness && npm run lint-adhoc-steps -- --file <path>`

## 版本

- Hylyre wheel：`0.1.0`（`framework/profiles/hmos-app/vendor/hylyre/`）
- 字段变更时：同步更新 wheel、`hylyre-planned-step-keys.ts`、本文件、`hylyre-planned-step-lint.ts`

# Hylyre Planned Step 字段规则（vendored SSOT）

> 从 [`hylyre-0.2.0-py3-none-any.whl`](../../../vendor/hylyre/hylyre-0.2.0-py3-none-any.whl) 内 `hylyre/api/planned_step_keys.py`、`selector_resolve.py` 等提取。
> Framework 仓内 **不** 包含 Hylyre 工程的 `docs/agent-plan-a.md`；本文件供 agent / lint / derive 消费。

## 根键 SSOT

与 [`hylyre-planned-step-keys.ts`](../../../../../harness/scripts/utils/hylyre-planned-step-keys.ts) 同步：

`touch` · `input` · `swipe` · `scroll` · **`scroll_to`** · `back` · `home` · `stop_app` · `clear_app` · `wait` · `wait_for` · `wait_gone` · `wait_idle` · `assert_toast` · `start_app`（即席 harness **禁止** steps 内 `start_app`）

**禁止作为步骤根键的 CLI 名**：`dump_ui` / `dump-ui` / `page_save` / `screenshot` 等（见 `FORBIDDEN_STEP_ROOT_KEYS`）。

## 富选择器（Hylyre 0.2+ · touch / wait_for 块内）

同名按钮 / 半模态叠层场景优先用富选择器，而非改被测应用源码加 id。

| 字段 | 用途 | 示例 |
|------|------|------|
| `scope: "top_overlay"` | 限定当前最上层 sheet/dialog/popup 子树 | 半模态「下一步」 vs 背后页面同名按钮 |
| `within` / `below` / `above` / `after` / `before` | 相对锚点定位 | `{"within":{"by_text":"短信验证"}}` |
| `all` | 多条件 AND | `{"all":[{"by_text":"下一步"},{"enabled":true}]}` |
| `index` | 多命中时取第 N 个（0-based） | `{"by_text":"下一步","index":1}` |
| `visible` / `clickable` / `enabled` | 过滤不可见/不可点项 | `{"by_text":"下一步","enabled":true}` |

**默认行为**：仅 `by_text` 且无其它富字段时，Hylyre 0.2 **默认 `visible: true`**，优先命中可见可点项（通常即顶层 overlay）。

```json
{"touch":{"by_text":"下一步","scope":"top_overlay"}}
{"touch":{"by_text":"下一步","within":{"by_text":"短信验证"}}}
{"wait_for":{"by_text":"加载完成","scope":"top_overlay","timeout":10}}
```

## 滚动（Hylyre 0.2+）

**`scroll_to` 根键**（长列表 / 虚拟化，自动滚到目标可见）：

```json
{"scroll_to":{"by_text":"招商银行","in":{"by_type":"List"}}}
```

**touch 内联**（可选）：

```json
{"touch":{"by_text":"招商银行","scroll_into_view":{"by_type":"List"}}}
```

## 等待类：seconds vs timeout（易混）

| 根键 | 时长字段 | 默认 | 其它必填 | 运行时错误示例 |
|------|----------|------|----------|----------------|
| `wait` | **`seconds`** | — | — | `wait requires seconds` |
| `wait_for` | **`timeout`** | 10 | selector / by_text / 富选择器字段 | selector 缺失 |
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
{"scroll_to":{"by_text":"招商银行","in":{"by_type":"List"}}}
{"back":{}}
{"home":{}}
{"wait":{"seconds":2}}
{"wait_for":{"by_text":"加载完成","timeout":10}}
{"wait_gone":{"by_id":"spinner","timeout":10}}
{"wait_idle":{"idle_time":0.7,"timeout":10}}
{"assert_toast":{"text":"成功","timeout":3}}
```

## Toast 断言（Hylyre 0.2+ 降级约定）

部分 HarmonyOS 版本 / 设备上 `assert_toast` 可能因环境不支持而失败（非被测应用缺陷）。**处理约定**：

- 若 trace 明确为 toast 捕获不可用：在 **test-report.md** 标 **跳过** 并备注「环境不支持 toast 断言」，**勿**当作应用 P0 硬失败。
- 步骤失败时 Hylyre 0.2 会在 **`--failure-dir`** 下落 UI dump + 截图（见 profile addendum）；失败截图 NoneType 崩溃已在 0.2 修复。

## 观察 UI（非 planned step）

`dump-ui` 为 **CLI 探索命令**（warmup / 即席 `--dump-ui-only`），**不得**写进步骤 JSON 根键 `dump_ui`。

## Lint 规则 ID（framework）

| 规则 | 说明 |
|------|------|
| STEP-001 | 每步恰好一个已知根键 |
| STEP-002 | 禁止 CLI 名根键（含 `dump_ui`） |
| STEP-WAIT | `wait_for` 缺 selector / by_text / by_key / by_type / 富选择器字段 |
| STEP-WAIT-SECONDS | `wait` 缺 `seconds` 或误用 `timeout`/`duration` |

写前校验：`cd framework/harness && npm run lint-adhoc-steps -- --file <path>`

## 版本

- Hylyre wheel：`0.2.0`（`framework/profiles/hmos-app/vendor/hylyre/`）
- 字段变更时：同步更新 wheel、`hylyre-planned-step-keys.ts`、本文件、`hylyre-planned-step-lint.ts`

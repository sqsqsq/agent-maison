# Hylyre Planned Step 字段规则（vendored SSOT）

> 从 vendor 源码树 [`src/hylyre/api/planned_step_keys.py`](../../../vendor/hylyre/src/hylyre/api/planned_step_keys.py)、`selector_resolve.py` 等提取。
> Framework 仓内 **不** 包含 Hylyre 工程的 `docs/agent-plan-a.md`；本文件供 agent / lint / derive 消费。

## 根键 SSOT

与 [`hylyre-planned-step-keys.ts`](../../../../../harness/scripts/utils/hylyre-planned-step-keys.ts) 同步：

`touch` · `input` · `swipe` · `scroll` · **`scroll_to`** · `back` · `home` · `stop_app` · `clear_app` · `wait` · `wait_for` · `wait_gone` · `wait_idle` · `assert_toast` · `start_app`（正式派生：`stop_app`/`start_app` 仅允许作为 case 首部恰好一组复位前奏 `stop_app→start_app`，bundle/page_name 逐字取 derive hint 的 reset_preamble 字段；即席 harness **禁止** steps 内 `start_app`）

**禁止作为步骤根键的 CLI 名**：`dump_ui` / `dump-ui` / `page_save` / `screenshot` 等（见 `FORBIDDEN_STEP_ROOT_KEYS`）。

**与 visual_diff QA 的区分**：`device_test.visual_diff` 截图采集是 **device-testing 阶段级 QA/门禁动作**（harness 在 `device_test.run` 层通过 `captureVisualDiff` 直接发起），**不是** test-plan 派生步骤的根键。禁止在派生 `test-plan.md` 步骤 JSON 里写 `"screenshot": …` 根键；visual_diff 须走 SKILL Step 4.6 + harness 采集入口，不与 `FORBIDDEN_STEP_ROOT_KEYS` 冲突。

## 富选择器（Hylyre 0.2+ · touch / wait_for / input 块内）

同名按钮 / 半模态叠层场景优先用富选择器，而非改被测应用源码加 id。

| 字段 | 用途 | 示例 |
|------|------|------|
| `scope: "top_overlay"` | 限定当前最上层 sheet/dialog/popup 子树 | 半模态「下一步」 vs 背后页面同名按钮 |
| `within` / `below` / `above` / `after` / `before` | 相对锚点定位 | `{"within":{"by_text":"短信验证","match":"exact"}}` |
| `all` | 多条件 AND | `{"all":[{"by_text":"下一步","match":"exact"},{"enabled":true}]}` |
| `index` | 多命中时取第 N 个（0-based） | `{"by_text":"下一步","match":"exact","index":1}` |
| `visible` / `clickable` / `enabled` | 过滤不可见/不可点项 | `{"by_text":"下一步","match":"exact","enabled":true}` |

**正式 feature 派生计划的 match 纪律**：每个 `by_text` selector 都必须显式写 `match: "exact"` 或 `match: "contains"`；由 acceptance 意图选择，不能按数字/日期等字符特征推断，运行时也禁止 exact→contains fallback。`contains` 不是多候选选择器；action 默认 require unique，需消歧时复用 `index` / `scope` / `within` / `all`。仅 `by_text` 且无其它富字段时，Hylyre 0.2 **默认 `visible: true`** 仍是执行器的可见性默认，不替代 match 声明。

```json
{"touch":{"by_text":"下一步","match":"exact","scope":"top_overlay"}}
{"touch":{"by_text":"下一步","match":"contains","within":{"by_text":"短信验证","match":"exact"}}}
{"wait_for":{"by_text":"加载完成","match":"exact","scope":"top_overlay","timeout":10}}
```

**P0 身份断言不用手写（plan 07a41ec6 T3）**：harness 把派生计划装载进 run 目录时，按 acceptance checkpoint 自动插入精确形状的 `{"wait_for":{"by_id":"<required_id>","timeout":10}}` / `{"wait_gone":{"by_id":"<forbidden_id>","timeout":10}}`（源文件不改，注入清单落 `checkpoint-injection.json`）。派生只写导航、动作与 UX 断言：`visible` / `enabled` 等谓词断言**保留**为独立 UX 断言，但不算身份证据——上表的富选择器字段一旦出现在断言里，request.kind 就是 composite，P0 身份门只认裸 by_id。checkpoint 的触发动作在 case 内必须唯一，多候选或无绑定动作会在跑机前判 invalid_test 并列出 step。scroll/swipe 是合法动作，不要为过门禁改成 touch。已知边界表见 profile-addendum「已知边界」。

## 滚动（Hylyre 0.2+ · 0.3 先匹配）

**`scroll_to` 根键**（长列表 / 虚拟化，自动滚到目标可见）。Hylyre 0.3+：**滚动前先**在容器子树/全树匹配，目标已在屏内时立即返回，避免空滚。

```json
{"scroll_to":{"by_text":"招商银行","match":"contains","in":{"by_type":"List"}}}
```

**touch 内联**（可选）：

```json
{"touch":{"by_text":"招商银行","match":"contains","scroll_into_view":{"by_type":"List"}}}
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

## input（Hylyre 0.3+ · 定位 + 输入）

`input` 支持与 `touch` 一致的选择器词汇（`by_text` / `by_id` / `by_type` / `by_key` + 富选择器），或一步式 `into` 定位后输入：

```json
{"input":{"by_type":"TextInput","scope":"top_overlay","text":"123456"}}
{"input":{"into":{"by_type":"TextInput","scope":"top_overlay"},"text":"123456"}}
```

**无选择器**时 `input` 落到**当前聚焦框**（等价 `input_text_on_current_cursor`）；若无聚焦框则输入丢失且无报错——对只有 placeholder 的验证码框，**勿**裸 `{"input":{"text":"…"}}`，应带 `by_type`/`into` 或先 `touch` 聚焦。

```json
{"touch":{"by_type":"TextInput","scope":"top_overlay"}}
{"wait":{"seconds":1}}
{"input":{"text":"123456"}}
```

## 各根键最小 JSON 形态

```json
{"touch":{"by_text":"按钮","match":"exact"}}
{"touch":{"by_id":"btn_id"}}
{"input":{"by_id":"field","text":"100"}}
{"input":{"by_type":"TextInput","scope":"top_overlay","text":"123456"}}
{"swipe":{"direction":"UP","distance":50}}
{"scroll":{"direction":"down","steps":6}}
{"scroll_to":{"by_text":"招商银行","match":"contains","in":{"by_type":"List"}}}
{"back":{}}
{"home":{}}
{"wait":{"seconds":2}}
{"wait_for":{"by_text":"加载完成","match":"exact","timeout":10}}
{"wait_gone":{"by_id":"spinner","timeout":10}}
{"wait_idle":{"idle_time":0.7,"timeout":10}}
{"assert_toast":{"text":"成功","timeout":3}}
```

## Toast 断言（能力不可用的机器归因）

部分 HarmonyOS 版本 / 设备上 `assert_toast` 可能因环境不支持而失败（非被测应用缺陷）。**处理约定**：

- 归 `blocked` 还是 `failed` 由 Hylyre 按冻结 builder 判定表的 **attempted 事实**决定，不由报告作者选择：dispatch **之前**探针已证明缺失 → `outcome.status=blocked` + `cause.type=capability`；已 dispatch **之后**才返回不支持 → `outcome.status=failed` + `failure.domain=capability`。
- 报告按 trace 的实际结论如实登记（**阻塞** / **失败**），**不得**改写成人工「跳过」，也**勿**当作应用 P0 硬失败。Maison 只消费 nested `outcome.cause` / `outcome.failure` 投 capability defer，零 coding candidate。
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
| STEP-007 | 正式 `by_text` 必须显式 `match: exact|contains`，非法值硬失败 |

写前校验：`cd framework/harness && npm run lint-adhoc-steps -- --file <path>`

## 版本

- Hylyre vendor 发布件：`0.5.1`（`framework/profiles/hmos-app/vendor/hylyre/`，Maison 只交付源码树 `src/`；**不交付 wheel**——Maison 走 plain-source vendor，运行时代码仅兼容外部 legacy wheel 布局）
- 结果协议：`hylyre.step-outcome/1`；trace schema：`0.4-p0`。发布件内 `hylyre/contracts/` 与冻结契约包逐字一致（`contracts_tree_sha256 = cc738c272324…1bae`）
- 字段变更时：同步更新 vendor 发布件、`hylyre-planned-step-keys.ts`、本文件、`hylyre-planned-step-lint.ts`

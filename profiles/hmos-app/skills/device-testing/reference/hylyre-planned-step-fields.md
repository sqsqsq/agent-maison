# Hylyre Planned Step 字段规则（vendored SSOT）

> 从 vendor 源码树 [`src/hylyre/api/planned_step_keys.py`](../../../vendor/hylyre/src/hylyre/api/planned_step_keys.py)、`selector_resolve.py` 等提取。
> Framework 仓内 **不** 包含 Hylyre 工程的 `docs/agent-plan-a.md`；本文件供 agent / lint / derive 消费。

## 根键 SSOT

与 [`hylyre-planned-step-keys.ts`](../../../../../harness/scripts/utils/hylyre-planned-step-keys.ts) 同步：

`touch` · `input` · `swipe` · `scroll` · **`scroll_to`** · `back` · `home` · `stop_app` · `clear_app` · `wait` · `wait_for` · `wait_gone` · `wait_idle` · `assert_toast` · `start_app` · `drag` · `slide` · `fling` · `pinch_in` · `pinch_out` · `two_finger_swipe` · `multi_finger_touch` · `gesture` · `press_key` · `press_combination_key` · `get_component_property` · `shell` · `clear_text` · `move_cursor` · `set_checked` · `current_app` · `has_app` · `recent_tasks`（正式派生：`stop_app`/`start_app` 仅允许作为 case 首部恰好一组复位前奏 `stop_app→start_app`，bundle/page_name 逐字取 derive hint 的 reset_preamble 字段；即席 harness **禁止** steps 内 `start_app`）

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
| `visible` / `clickable` / `enabled` / `scrollable` / `checked` / `checkable` / `focused` | 输入须为JSON布尔；visible仅true限定可见边界，其余六项true/false精确过滤 | `{"by_text":"下一步","match":"exact","enabled":true}` |

**正式 feature 派生计划的 match 纪律**：每个 `by_text` selector 都必须显式写 `match: "exact"` 或 `match: "contains"`；由 acceptance 意图选择，不能按数字/日期等字符特征推断，运行时也禁止 exact→contains fallback。`contains` 不是多候选选择器；action 默认 require unique，需消歧时复用 `index` / `scope` / `within` / `all`。仅 `by_text` 且无其它富字段时，Hylyre 0.2 **默认 `visible: true`** 仍是执行器的可见性默认，不替代 match 声明。

```json
{"touch":{"by_text":"下一步","match":"exact","scope":"top_overlay"}}
{"touch":{"by_text":"下一步","match":"contains","within":{"by_text":"短信验证","match":"exact"}}}
{"wait_for":{"by_text":"加载完成","match":"exact","scope":"top_overlay","timeout":10}}
```

**P0 身份断言不用手写（plan 07a41ec6 T3/T12）**：harness 装载 run 副本时，按 acceptance checkpoint 自动插入裸 `wait_for by_id`（required）/ `wait_gone by_id`（forbidden），源文件不改。同一 case 的合法重复触发会逐次注入与验证：证据只属于该动作之后、下次同目标触发或更早的返回/复位之前；已有等价裸断言仅在该区间复用。完整的进入→返回→再次进入必须保留，不能删动作或拆 case 来过门禁。`visible` / `enabled` 等 UX 谓词断言原样保留但不代替身份；真正的 selector 目标歧义或无匹配动作仍在跑机前判 invalid_test，点名 TC/step 与缺少的消歧信息。scroll/swipe 不改 touch。已知边界见 profile-addendum。

**系统与边缘返回**：checkpoint 使用 `action: { type: back }` 表示系统返回，派生为 `{"back":{}}`。用 `action: { type: back, mode: swipe, side: RIGHT }` 验证从右侧边缘发起的返回，派生为 `{"back":{"mode":"swipe","side":"RIGHT"}}`。从左侧发起时写 `LEFT`。每个 checkpoint 窗口只执行一次返回，动作前用裸 `wait_for by_id` 观察起始屏，后置屏与禁止节点由 checkpoint 的 `required_element_ids`、`forbidden_element_ids` 承载。已有屏未在 ui-spec 中建模时可在 checkpoint 写 `pre_screen_element_id`。返回被拦截时也须提供前后两次可比较观测。普通横向 `swipe` 保留滚动或浏览语义，导航返回使用设备的边缘返回原语。

同一用例需要证明系统返回与边缘返回的后置条件时，分别声明两个 checkpoint 并将两条验收 ID 关联到该用例。两次执行沿原步骤顺序分别取证。

从其他屏收键盘或做导航复位时，在该动作前的同一窗口用裸 `wait_for by_id` 观察可辨识的所在屏。没有临近屏身份时，设备证据无法区分该动作和检查点返回。输入可能改变界面状态，因此起始屏观测应放在输入之后。

**证据分工**：设备步骤观察页面及倒计时的实际前后值。数据库的生产写入、读回、字段和重复行数，以及发送次数，由应用内测试通过生产调用取证。

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

## Hylyre 0.6.0 常用设备操作

本版新增18个直接根键；touch仍沿用同一根键。Maison只消费上游注册与既有STEP lint，参数合法性由Hylyre共享预检负责，不在TypeScript复制第二套驱动参数协议。18个新增根键的示例进入标准/即席derive hint的同一step_shape_catalog，touch双击/长按形态为补充示例；替换示例id、坐标为当前页面真实目标。共享目录不提供stop_app/clear_app/start_app占位示例；正式复位前奏只取derive hint的reset_preamble（含同源身份），不得自行拼接。

```json
{"touch":{"by_id":"item","mode":"double"}}
{"touch":{"by_id":"item","mode":"long","press_time":3,"wait_time":0.1}}
{"drag":{"start":{"by_id":"item"},"end":{"x":300,"y":500},"press_time":1.5}}
{"slide":{"start":{"x":100,"y":200},"end":{"x":300,"y":500},"duration":0.3}}
{"fling":{"direction":"UP","distance":50,"speed":"fast"}}
{"pinch_in":{"area":{"by_id":"canvas"},"scale":0.4,"direction":"diagonal"}}
{"pinch_out":{"area":{"by_id":"canvas"},"scale":1.6,"direction":"diagonal"}}
{"two_finger_swipe":{"start1":{"x":100,"y":200},"end1":{"x":100,"y":400},"start2":{"x":200,"y":200},"end2":{"x":200,"y":400},"duration":0.5}}
{"multi_finger_touch":{"points":[{"x":100,"y":200},{"x":200,"y":200}],"duration":0.1}}
{"gesture":{"fingers":[{"points":[{"x":100,"y":200},{"x":200,"y":300},{"x":300,"y":200}]}],"speed":2000}}
{"press_key":{"key":"ENTER","mode":"normal"}}
{"press_combination_key":{"keys":["CTRL_LEFT","A"]}}
{"get_component_property":{"target":{"by_id":"field"},"property":"text"}}
{"shell":{"command":"printf 'hylyre\\n'","timeout":60}}
{"clear_text":{"target":{"by_id":"field"}}}
{"move_cursor":{"direction":"left","times":1}}
{"set_checked":{"target":{"by_id":"checkbox"},"checked":true,"timeout":3}}
{"current_app":{}}
{"has_app":{"bundle":"com.example.app"}}
{"recent_tasks":{}}
```

- 新手势端点是屏幕绝对整数像素或既有富选择器，区域只约束边界，不改变端点原点；全部目标/区域解析且唯一后才注入。需要先滚动的目标显式写scroll_to。
- drag显式press_time要求设备API>=20且能力可核实；本机SDK无法兑现小于1.5秒的按住时长时blocked，不忽略参数。speed与drag_time不能同时显式给。slide仅duration映射slide_time，默认0.3秒，不接受speed。
- fling方向与swipe一样不区分大小写，distance=1–100（默认50）；speed仅fast/normal/slow（默认fast）。pinch方向仅diagonal/horizontal；scale分别(0,1)/(1,2)，dead_zone_ratio若给则(0,0.5)。two_finger_swipe默认0.5秒；multi_finger_touch要求2–4点、默认0.1秒；gesture每指至少两点、默认speed=2000，整条一次注入，不用串行slide替代。
- press_key.key是精确KeyCode名称或非负整数；组合键2–3个不同键，一次同时按下。HMOS或无法确认三键能力时blocked，不能丢第三键。clear_text原生清空真实输入控件；move_cursor对当前焦点移动，不自动点击重置光标。
- 属性首批id/text/key/type/enabled/focused/clickable/scrollable/checked/checkable；缺属性不是false/空文本。布尔读取将bool或字符串true/false归一；布尔查询facts.value在trace中保留bool，文本值及target.text仍脱敏。get_component_property/current_app/has_app及Shell均是action事实，不能增加断言覆盖；前三个纯查询不计正式STEP-SETUP准备动作，首个断言前仍须有同case的准备/导航动作。set_checked有读前/必要时点击一次/复读结果，可作为普通步骤执行，但不能作为Maison P0 checkpoint绑定动作，也不代替独立业务断言。缺真实观测的fake查询、状态设置和Shell保持blocked。
- wait_for/wait_gone新增checked/checkable/focused过滤，与已有clickable/enabled/scrollable一样精确匹配true/false。**兼容变化**：显式false过去被忽略的调用应移除该字段；字符串布尔须改成JSON布尔。含新增三状态（含嵌套）的等待使用实际匹配文本节点，其它旧rich等待继续升父；组件读写和新手势area始终定位实际匹配节点。
- wait_gone只证明完整谓词零匹配，目标消失也成立，不等于目标仍存在且checked=false。需要后者用wait_for checked=false。合法非负index在等待完整谓词零匹配时按presence/absence处理；有候选但index越界仍报错，动作定位索引规则不变。唯一控件无需冗余index:0。缺属性不可观测不会让absence假通过。
- shell.command原文允许引号、分号、中文、管道和转义换行，timeout默认60秒。设备固定到当前选择/session的serial；stdout与设备exit_code、transport_exit_code分开，非零/超时均失败，stderr不可独立获取时null/false，不重试动作。命令只在当前任务授权范围内执行。Markdown表格的管道按标准写\|（或JSON \u007c），JSON内部中英文分号/转义换行不能拆步或改写。
- 自 Hylyre 0.6.1 起，正式 Markdown 计划中，步骤 JSON 的 command/text 字符串可直接写字面 `<br/>`。普通文本中的 `<br/>` 仍按原规则换为空格，表格内的竖线仍写作 `\|`。

结果协议仍为hylyre.step-outcome/1、trace schema仍为0.4-p0；native协议最低版本0.5.0不因新增操作无条件上调。能力成功须真实设备反馈，报告verify或动作passed不证明所有业务/端点断言通过。

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

- Hylyre vendor 发布件：`0.6.1`（`framework/profiles/hmos-app/vendor/hylyre/`，Maison 只交付源码树 `src/`；**不交付 wheel**——Maison 走 plain-source vendor，运行时代码仅兼容外部 legacy wheel 布局）
- 结果协议：`hylyre.step-outcome/1`；trace schema：`0.4-p0`。发布件内 `hylyre/contracts/` 与冻结契约包逐字一致（`contracts_tree_sha256 = cc738c272324…1bae`）
- 字段变更时：同步更新 vendor 发布件、`hylyre-planned-step-keys.ts`、本文件、`hylyre-planned-step-lint.ts`

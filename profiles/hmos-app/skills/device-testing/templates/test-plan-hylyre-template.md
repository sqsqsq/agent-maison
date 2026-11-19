# 测试计划（派生执行格式） — {module-name}

> 此文件由 agent 从顶层 `test-plan.md` 派生而来；**由 profile 真机自动化消费** 执行本文件。
> **不要手工编辑此文件**；要修改测试用例请改顶层 `test-plan.md` 后重新派生。
>
> 派生规则见 profile addendum「真机自动化」章与 **Hylyre** 文档 `docs/agent-plan-a.md`（位于 Hylyre 工程）。
>
> **步骤列必须为裸 JSON**（不要用 Markdown 反引号包裹）；Hylyre `_JSONISH` 不识别反引号。
> 推荐 **direct 根键**：`{"touch":{"by_text":"…","match":"exact"}}`；正式 feature 的 `by_text` 必须显式选择 `match: exact|contains`，预启由 harness `aa start` 完成，步骤列**不含** `start_app`。
>
> 为每个 Hylyre 用例注明可核对的起始状态与必要准备。可使用已获准的隔离数据或已有可执行准备步骤。进程重启只复位进程。
> 某个用例缺少可得数据状态或稳定 selector 时，在交回中记录用例、验收 ID 和缺失条件，由原验证方核对。保留原断言和执行通道，等待正式工具生成执行结果。
> 视觉导航单独交回 feature 下的 `device-testing/visual-diff-nav.json`。旧 `testing/visual-diff-nav.json` 可用于核对当前屏与到达步骤。

## 测试用例清单

<!-- ⚠️ 上方标题节为解析锚点，禁止删改层级语义 -->
<!-- ⚠️ 表头 7 列固定顺序；「测试步骤」列单行 JSON + `;` 分隔；禁用 `<br/>` -->

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |
|----------|---------|---------|---------|---------|--------|---------|
| TC-001 | 卡片列表展示 | 已启动 app（harness aa start 预启） | {"touch":{"by_text":"我的钱包","match":"exact"}} ; {"swipe":{"direction":"UP","distance":50,"area":{"by_type":"Scroll"}}} | 列表展示至少 1 张卡片 | P0 | AC-001 |
| TC-002 | 充值 100 元 | 已启动 app | {"touch":{"by_text":"充值","match":"exact"}} ; {"input":{"text":"100","by_id":"amount_input"}} ; {"touch":{"by_text":"确认","match":"exact"}} | Toast 显示充值成功 | P0 | AC-005 |
| TC-003 | 横向滚动一屏卡片 | 在卡片列表页 | {"swipe":{"direction":"LEFT","distance":80,"area":{"by_id":"card_list"}}} | 下一组卡片露出 | P1 | AC-002 |
| TC-004 | 滚轮翻页 | 在长内容页 | {"scroll":{"direction":"down","steps":6,"at":{"by_type":"Scroll"}}} | 滚动至下一屏 | P2 | AC-008 |
| TC-010 | 进子页后回 Tab（示例） | 已在「首页」Tab | {"touch":{"by_text":"进入卡包","match":"exact"}} ; {"back":{}} | 回到首页 Tab，底栏「首页」可点 | P0 | AC-nav |
| TC-011 | 子页污染后下一用例（示例） | 已在「首页」Tab | {"back":{}} ; {"touch":{"by_text":"+","match":"exact"}} | 进入目标子页 | P0 | AC-nav |

<!-- 列表内横向滑须带 area；Nav 返回只用 back，勿用无 area 的 swipe RIGHT -->
<!-- 执行通道以顶层计划为准，每个 channel=hylyre 的 TC 保留原用例与有效断言 -->

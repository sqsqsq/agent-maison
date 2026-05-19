# 测试计划（派生执行格式） — {module-name}

> 此文件由 agent 从顶层 `test-plan.md` 派生而来；**由 profile 真机自动化消费** 执行本文件。
> **不要手工编辑此文件**；要修改测试用例请改顶层 `test-plan.md` 后重新派生。
>
> 派生规则见 profile addendum「真机自动化」章与 **Hylyre** 文档 `docs/agent-plan-a.md`（位于 Hylyre 工程）；
> 最小骨架也可对照 Hylyre 仓库 `tests/e2e/fixtures/json-steps-test-plan.md`。
>
> 缺少稳定 selector 的用例**不出现在本文件**，直接在顶层 test-report.md 的「执行状态」列标「跳过」。

## 测试用例清单

<!-- ⚠️ 上方标题节为解析锚点，禁止删改层级语义 -->
<!-- ⚠️ 表头 7 列固定顺序；「测试步骤」列单行 JSON + `;` 分隔；禁用 `<br/>` -->

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |
|----------|---------|---------|---------|---------|--------|---------|
| TC-001 | 卡片列表展示 | 已启动 app | `{"touch":{"by_text":"我的钱包"}}` ; `{"action":{"type":"swipe","direction":"UP","distance":50,"area":{"by_type":"Scroll"}}}` | 列表展示至少 1 张卡片 | P0 | AC-001 |
| TC-002 | 充值 100 元 | 在首页 | `{"touch":{"by_text":"充值"}}` ; `{"input":{"text":"100","by_id":"amount_input"}}` ; `{"touch":{"by_text":"确认"}}` | Toast 显示充值成功 | P0 | AC-005 |
| TC-003 | 横向滚动一屏卡片 | 在卡片列表页 | `{"swipe":{"direction":"LEFT","distance":80,"area":{"by_id":"card_list"}}}` | 下一组卡片露出 | P1 | AC-002 |
| TC-004 | 滚轮翻页 | 在长内容页 | `{"scroll":{"direction":"down","steps":6,"at":{"by_type":"Scroll"}}}` | 滚动至下一屏 | P2 | AC-008 |
| TC-010 | 进子页后回 Tab（示例） | 已在「首页」Tab | `{"touch":{"by_text":"进入卡包"}}` ; `{"back":{}}` | 回到首页 Tab，底栏「首页」可点 | P0 | AC-nav |
| TC-011 | 子页污染后下一用例（示例） | 已在「首页」Tab | `{"back":{}}` ; `{"touch":{"by_text":"+"}}` | 进入目标子页 | P0 | AC-nav |

<!-- 列表内横向滑须带 area；Nav 返回只用 back，勿用无 area 的 swipe RIGHT -->
<!-- 不进派生计划的 TC（缺 selector / 需人工）由 agent 在顶层 test-report.md 标「跳过」，不在此处出现 -->

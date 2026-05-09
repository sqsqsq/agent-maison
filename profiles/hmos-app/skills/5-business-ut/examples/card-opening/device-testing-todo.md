# 真机测试待办 — card-opening（样例 · v2.1）

> **v2.1 样例说明**：本文件由 Skill 5 Step 6 自动产出，供 Skill 6 消费。
> 真实路径：`doc/features/card-opening/device-testing-todo.md`
>
> 每条对应 `acceptance.yaml` 中 `ut_layer ∈ {device, both}` 的 AC/BD：
> - UT 已通过 `flow.state.*` 与 Spy 的 `callLog` 覆盖业务侧语义；
> - 本文件列出真机侧需补验的 UI / 交互 / 渲染层要点。
> - DAG 中的 `ui_subscription` 节点应在这里有对应条目（由 harness `device_ac_delegation` 语义审查）。

## 业务流程映射

- `use_cases[card_opening]`（`doc/features/card-opening/use-cases.yaml`）
  - coordinator：`CardOpenFlow`
  - UT 已覆盖分支：`happy_path` / `validate_fail` / `apply_fail` / `persist_fail` / `sms_fail_rollback` / `user_cancel_in_waiting_sms`

## 真机覆盖项

### AC-5 开卡成功后跳转到结果页 · ut_layer=device

- **来源**：`acceptance.yaml > criteria > AC-5`
- **linked_flow / linked_branch**：`card_opening / happy_path`
- **UT 已保证**：
  - `flow.state.phase === Phase.Success`
  - `flow.state.resultCardId === 'c1'`
  - `spyStore.currentCards[0].status === 'Active'`
- **真机需验证**：
  - [ ] 短验通过后导航栈栈顶为 `CardOpenResultPage`
  - [ ] 跳转参数包含 `{ cardId }`
  - [ ] 页面转场动画自然无卡顿
  - [ ] 结果页展示卡片的银行 logo、尾号、持卡人

### AC-8 校验失败弹出错误 Toast · ut_layer=both

- **来源**：`acceptance.yaml > criteria > AC-8`
- **linked_flow / linked_branch**：`card_opening / validate_fail`
- **UT 已保证**：
  - `flow.state.phase === Phase.Failed`
  - `flow.state.errorCode === 'VAL_ERR'`
  - 不触发任何后续端口调用
- **真机需验证**：
  - [ ] Toast 文案与 PRD 文案一致（"该卡暂不支持开卡"）
  - [ ] Toast 出现在页面中央偏下，持续 ≥ 2 秒
  - [ ] Toast 消失后开卡按钮恢复可点击

### AC-9 短验失败弹出错误 Toast 并停留在短验页 · ut_layer=both

- **来源**：`acceptance.yaml > criteria > AC-9`
- **linked_flow / linked_branch**：`card_opening / sms_fail_rollback`
- **UT 已保证**：
  - `flow.state.phase === Phase.Failed`
  - `flow.state.errorCode === 'SMS_ERR'`
  - `spyStore.callLog` 为 `['save', 'rollback']`
- **真机需验证**：
  - [ ] Toast 文案为"短信验证码不正确"
  - [ ] 短验输入框被清空、自动获得焦点
  - [ ] 页面不返回首页（导航栈深度保持不变）
  - [ ] 2 秒后允许再次提交短验

### AC-10 等待短验阶段可点击取消 · ut_layer=both

- **来源**：`acceptance.yaml > criteria > AC-10`
- **linked_flow / linked_branch**：`card_opening / user_cancel_in_waiting_sms`
- **UT 已保证**：`flow.state.phase === Phase.Failed` 且 `errorCode === 'USER_CANCELLED'`；已写入的卡被回滚
- **真机需验证**：
  - [ ] 短验页显示"取消"按钮（非致残态）
  - [ ] 点击取消后弹二次确认 Dialog
  - [ ] 确认后返回首页，首页卡片列表不出现该卡
  - [ ] 取消后 Toast 提示"已取消开卡"

### BD-2 持久化失败后按钮禁用 · ut_layer=both

- **来源**：`acceptance.yaml > boundaries > BD-2`
- **linked_flow / linked_branch**：`card_opening / persist_fail`
- **UT 已保证**：`flow.state.phase === Phase.Failed` 且 `errorCode === 'PERSIST_ERR'`
- **真机需验证**：
  - [ ] "重试"按钮在失败后可点击
  - [ ] "下一步"按钮在失败态下置灰
  - [ ] Toast 提示"本地存储异常"

### BD-3 弱网络场景下的 loading 转圈 · ut_layer=device

- **来源**：`acceptance.yaml > boundaries > BD-3`
- **linked_flow / linked_branch**：N/A（纯交互）
- **真机需验证**：
  - [ ] 发起 `validateOpen` 时按钮禁用并显示 loading
  - [ ] 超过 5 秒未响应时显示"正在处理，请稍候"

## 与测试计划的对接

Skill 6 将本文件每条 checklist 子项合并为 1 条测试用例的测试步骤，
用例的"关联 AC"字段记录 `AC-X (ut_layer=..., linked_flow=..., linked_branch=...)`。

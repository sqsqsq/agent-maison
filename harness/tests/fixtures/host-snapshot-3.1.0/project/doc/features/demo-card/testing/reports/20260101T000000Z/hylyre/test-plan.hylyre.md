# 派生 Hylyre 测试计划

## 测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |
| --- | --- | --- | --- | --- | --- | --- |
| TC-001 | 开卡入口 | 冷启动 | {"touch":{"by_id":"bank_row_cmb"}}; {"wait_for":{"by_id":"open_card_title","timeout":10}} | 进入开卡流程页 | P0 | AC-1 |
| TC-002 | 银行列表展示 | 冷启动 | {"back":{}}; {"wait_for":{"by_id":"bank_row_cmb","timeout":10}} | 列表展示银行条目 | P1 | AC-2 |

---
explicit_skip_tc_ids:
  - TC-012
  - TC-013
  - TC-014
  - TC-015
  - TC-016
---

# 测试计划（派生执行格式） — bc-openCard

> v1.0.8：短信验证码「聚焦 → 光标 input」+ keyboardLeftButton 收起键盘 → wait_for enabled 下一步。

## 测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |
|----------|---------|---------|---------|---------|--------|---------|
| TC-001 | 添卡首页收起态展示 | harness 冷启动 | {"wait_for":{"by_text":"卡包","timeout":30}}; {"touch":{"by_text":"卡包"}}; {"wait_for":{"by_text":"添加卡片","timeout":15}}; {"touch":{"by_text":"添加卡片"}}; {"wait_for":{"by_text":"添加银行卡","timeout":15}}; {"wait_for":{"by_text":"免输卡号添卡","timeout":10}} | 收起态标题与副文案可见 | P0 | AC-1 |
| TC-002 | 收起态展开与查看全部 | 位于添卡首页收起态 | {"touch":{"by_text":"更多"}}; {"wait_for":{"by_text":"搜索银行","timeout":10}}; {"touch":{"by_text":"查看全部银行"}}; {"wait_for":{"by_text":"全部银行","timeout":15}} | 展开态与全部银行页可达 | P0 | AC-2 |
| TC-003 | 全部银行搜索 | 位于全部银行页 | {"input":{"by_id":"all_banks_search","text":"招商"}}; {"wait_for":{"by_text":"招商银行","timeout":10}} | 搜索过滤正确 | P0 | AC-3 |
| TC-004 | 选卡类型半模态 | 位于全部银行页 | {"back":{}}; {"wait_for":{"by_text":"招商银行","timeout":15}}; {"touch":{"by_text":"招商银行"}}; {"wait_for":{"by_text":"选择卡类型","timeout":15}} | 半模态展示储蓄卡选项 | P0 | AC-4 |
| TC-005 | 选具体卡协议下一步 | 选卡类型半模态已开 | {"touch":{"by_text":"同意并继续","scope":"top_overlay"}}; {"wait_for":{"by_text":"请选择要添加的银行卡","timeout":15}}; {"touch":{"by_type":"Checkbox"}}; {"wait":{"seconds":0.5}}; {"touch":{"by_id":"next_step_btn"}}; {"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-header","timeout":20}}; {"swipe":{"direction":"UP","distance":80}}; {"wait":{"seconds":0.5}} | 短信半模态拉起并展开 | P0 | AC-5 |
| TC-006 | 短信验证码错误 | 短信半模态已开 | {"touch":{"by_type":"TextInput","scope":"top_overlay"}}; {"wait":{"seconds":0.5}}; {"input":{"text":"000000"}}; {"touch":{"by_key":"keyboardLeftButton"}}; {"wait":{"seconds":0.5}}; {"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next","enabled":true,"timeout":15}}; {"touch":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next","enabled":true,"scope":"top_overlay"}}; {"assert_toast":{"text":"验证码错误","timeout":5}} | Toast 提示错误码 | P0 | BD-2 |
| TC-007 | 短信验证成功 | 短信半模态仍开 | {"touch":{"by_type":"TextInput","scope":"top_overlay"}}; {"wait":{"seconds":0.3}}; {"touch":{"by_key":"keyboardRightButton"}}; {"wait":{"seconds":0.1}}; {"touch":{"by_key":"keyboardRightButton"}}; {"wait":{"seconds":0.1}}; {"touch":{"by_key":"keyboardRightButton"}}; {"wait":{"seconds":0.1}}; {"touch":{"by_key":"keyboardRightButton"}}; {"wait":{"seconds":0.1}}; {"touch":{"by_key":"keyboardRightButton"}}; {"wait":{"seconds":0.1}}; {"touch":{"by_key":"keyboardRightButton"}}; {"wait":{"seconds":0.2}}; {"input":{"text":"123456"}}; {"touch":{"by_key":"keyboardLeftButton"}}; {"wait":{"seconds":0.5}}; {"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next","enabled":true,"timeout":15}}; {"touch":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next","enabled":true,"scope":"top_overlay"}}; {"wait_for":{"by_text":"添卡成功","timeout":20}} | 进入成功页 | P0 | AC-6 |
| TC-008 | 成功页完成按钮 | 位于成功页 | {"wait_for":{"by_id":"maison:bc-opencard:add_success-done","timeout":10}}; {"touch":{"by_id":"maison:bc-opencard:add_success-done"}}; {"wait_for":{"by_text":"交易记录","timeout":15}} | 进入卡详情 | P0 | AC-7 |
| TC-009 | 卡详情区块 | 位于卡详情 | {"wait_for":{"by_text":"交易记录","timeout":10}}; {"wait_for":{"by_text":"华为支付","timeout":10}} | 卡面与交易区可见 | P0 | AC-8 |
| TC-010 | 卡包银行卡分区 | 已添卡 | {"back":{}}; {"wait_for":{"by_id":"maison:bc-opencard:card_pack_with_cards:list_card_container","timeout":15}}; {"touch":{"by_text":"查看全部","within":{"by_id":"maison:bc-opencard:card_pack_with_cards:list_card_container"}}} | 分区与查看全部可点 | P0 | AC-9 |
| TC-011 | 银行卡列表半模态 | 卡包有卡 | {"touch":{"by_text":"查看全部","within":{"by_id":"maison:bc-opencard:card_pack_with_cards:list_card_container"}}}; {"wait_for":{"by_id":"maison:bc-opencard:bank_card_list_sheet:sheet_scaffold-header","timeout":15}} | 列表半模态打开 | P1 | AC-12 |

<!-- sync: test-plan v1.0.8 2026-07-29 -->

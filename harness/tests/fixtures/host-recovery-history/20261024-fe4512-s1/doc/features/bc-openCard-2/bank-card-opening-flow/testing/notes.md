# Testing 补充观察

## 2026-10-24 · run `20261023T044016Z-fe4512`

- 正式 build/install 均通过，目标为真机 `3UJ0225321000395`、`default/debug`。
- 首轮 native run 被系统“USB 连接方式”弹窗遮挡；已通过受控 ad-hoc 设备链点击“确定”并以 absence assertion 证明弹窗消失。该轮不作为产品证据。
- 修正派生计划的 composite selector 与状态刷新等待后，`TC-009`（旧路由往返回归）真实通过；入口、卡型 Sheet、选卡页均可由稳定 id 到达。
- 多条独立冷启动用例稳定复现：选择候选并勾选协议后点击 `selection_next_btn`，`otp_sheet_title` 在 10 秒内不出现。权威 trace 为 `testing/reports/20261024T174757Z-893/hylyre/trace.json`；harness 已生成 coding/product repair candidates。
- `TC-002` / `TC-003` 的 Sheet 关闭后立即操作仍可能含 bindSheet 退出动画时序因素；后续 coding 回修后复验时应先检查失败截图/UI dump，再决定是否只需在派生计划增加固定退出等待，避免把纯测试时序误改成产品逻辑。
- 视觉链仅成功采集卡型 Sheet 两个 overlay target 与选卡页；OTP/结果页因同一不可达链未采集。已采屏存在 T8 保护区重叠、选卡协议/按钮布局与文案差异等确定性/视觉残差；`visual_diff` 为 FAIL，未手改 provider 证据或 verdict。
- `TC-010`（RDB 失败注入）为 `manual:data_injection`，`TC-011`（300ms）为 `manual:perf_sampling`；两项留在分母且不算 PASS。

## 2026-10-24 · testing rerun `20261024T184311Z-686`

- 本轮使用当前 HAP 真机重跑；`TC-003`、`TC-004`、`TC-006`、`TC-007`、`TC-009` 通过。此前 TC-007 的 placeholder 文本断言已改为稳定 `otp_input` id，关闭重入后空输入框与新倒计时得到原生证据。
- `TC-001`、`TC-005`、`TC-008` 在输入 6 位验证码并收起系统键盘后均能真实定位并点击 `otp_next_btn`，但结果页锚点在等待窗口内未出现。失败截图显示验证码仍为 6 位、按钮仍呈禁用样式；harness 已分别生成 coding/product repair candidates，testing 不改产品源码。
- `TC-002` 已到达“全部银行”页；`scroll_to ab_row_cmb` 因页面同时暴露外层 List 与 `ab_group_list` 两个滚动容器而 fail-closed。下轮 testing 派生应在 coding 回流后将滚动限定到 `in.by_id=ab_group_list`，再点击 `ab_row_cmb`；该项不投 coding。
- 视觉链采集了 5/6 个 P0 screen/overlay；`opening_result_success` 因上述结果页不可达未截图。已采屏仍有 card type sheet 保护区重叠、选卡协议文本/布局与按钮对比度等确定性和视觉残差；`visual_diff` 保持 FAIL。
- 最终 harness：`verdict=FAIL`、`blocker_count=9`、`can_claim_done=NO`、`closure_status=open`。本轮未输出 verifier request，因此未调用 verifier，也未运行 `--sync-closure`。

## 2026-10-24 · testing closure rerun `20261024T194450Z-003`

- 当前装机包的 TC-001..TC-009 均为 `completed/passed/complete`；TC-010 `manual:data_injection` 与 TC-011 `manual:perf_sampling` 继续作为已知能力缺口留在分母。
- TC-002 的列表滚动已限定到 `ab_group_list`；TC-003 与 TC-007 已补 P0 AC 追溯并由 harness 注入完整 checkpoint 身份断言，`p0_coverage_integrity` 通过。
- 脚本 harness 为 PASS、0 BLOCKER；视觉差异以 6 个 screen WARN 和 release-blocking debt 保留，不冒充 `pixel_1to1` 已满足。
- verifier PASS（0 BLOCKER）；非阻断观察为：报告视觉缺陷严重度与 visual-debt 投影不一致、稳定性散文与单轮表格矛盾、visual-diff 屏记录缺显式 `reverse_missing[]`。按阶段规则留待后续报告/视觉产出方处理，本轮不改产品源码或机器视觉证据。

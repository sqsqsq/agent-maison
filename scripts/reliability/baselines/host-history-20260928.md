<!-- 宿主历史参考值（plan 1dbe4fa4 §5.3）。跨框架版本、初始现场不同，只作参考，不与受控基线混算，也不能替代 t5。
生成：2026-09-28，node scripts/reliability-metrics.mjs --project "D:\1.code\SimulatedWalletForHmos" --feature cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdy12Mg --framework-root "D:\1.code\SimulatedWalletForHmos\framework" --observations scripts/reliability/observations/host-history-20260928.json --format md
“已确认（动作 N）”的 N 是观察记录 interventions[] 的下标（从 0 起）。宿主 git status --short 跑前跑后均 24 行。 -->

# 可靠性指标

- 输入：{"project_root":"D:\\1.code\\SimulatedWalletForHmos","feature":"cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdy12Mg","framework_root":"D:\\1.code\\SimulatedWalletForHmos\\framework","runs_dir":"D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\open-card-flow-v2\\goal-runs","runs":null,"observations":["host-history-20260928"],"scenario_result_files":0}
- 交付周期边界：20260920T100035Z-f829b8

## 任务

| 任务 | run | 宣称完成 | 记录与当前义务 | 独立验收 | 结论 | 停止状态 | 操作者动作 | 候选（已确认/总） | 恢复成本 |
|---|---|---|---|---|---|---|---|---|---|
| host-history-bc-openCard-2 | 20260924T135354Z-97af3f, 20260926T134302Z-0457a6, 20260926T154226Z-ae92d8, 20260928T043051Z-be091c(observation) | 否 | 记录 ok（20260920T100035Z-f829b8）；未覆盖 7；阻塞 4 | 失败 | 未完成 | HALTED / canary_cli_hard_failure / WAITING+external（等外部条件，但没有唤醒手段） [external] | 7（产品决策 0） | 4/5 | 未恢复：墙钟 5193.1 min，活跃 67.1 min，调用 11（计到任务末） |

## 故障明细

| 任务 | 故障（run#事件） | 时间 | 阶段 | 类型 / verdict / halt_reason | 状态 | 终点 | 墙钟 | 活跃 | 调用 |
|---|---|---|---|---|---|---|---|---|---|
| host-history-bc-openCard-2 | 20260924T135354Z-97af3f#21 | 2026-09-24T13:58:40.238Z | ut | phase_halt / - / executor_waiting | 已恢复 | 20260926T154226Z-ae92d8#49（该阶段 PASS） | 2998.0 min | 16.1 min | 6 |
| host-history-bc-openCard-2 | 20260926T134302Z-0457a6#23 | 2026-09-26T15:25:37.167Z | coding | phase_verdict / FAIL / no_progress_guard | 已恢复 | 20260926T154226Z-ae92d8#17（该阶段 PASS） | 20.2 min | 3.4 min | 2 |
| host-history-bc-openCard-2 | 20260926T154226Z-ae92d8#84 | 2026-09-26T16:17:14.893Z | testing | phase_verdict / FAIL / backtrack_limit | 未恢复 | - | 2174.5 min（计到任务末） | 30.5 min | 4 |
| host-history-bc-openCard-2 | 20260928T043051Z-be091c#1 | 2026-09-28T04:31:46.626Z | coding | phase_halt / FAIL / canary_cli_hard_failure | 未恢复 | - | 0.0 min（计到任务末） | 0.0 min | 0 |

## run 明细

| run | 会话段（无 run_end） | 正式活跃 | 调用（按阶段） | 实际回退 / 累计字段 | run_end 数 | 有效终态 | successor_of（线索） |
|---|---|---|---|---|---|---|---|
| 20260924T135354Z-97af3f | 1（0） | 4.6 min | 1 {"ut":1} | 0 / - | 1 | HALTED executor_waiting | - |
| 20260926T134302Z-0457a6 | 2（1） | 2.2 min | 3 {"coding":3} | 0 / - | 1 | HALTED no_progress_guard | 20260920T100035Z-f829b8 |
| 20260926T154226Z-ae92d8 | 1（0） | 64.9 min | 8 {"coding":2,"review":2,"ut":2,"testing":2} | 1 / 2 | 1 | HALTED backtrack_limit | 20260920T100035Z-f829b8 |
| 20260928T043051Z-be091c | 1（0） | 0.0 min | 0 {} | 0 / - | 1 | HALTED canary_cli_hard_failure | 20260920T100035Z-f829b8 |

## 操作者动作候选

- host-history-bc-openCard-2：resume_without_supervisor @ 20260926T134302Z-0457a6#14 2026-09-26T15:24:58.124Z → 未确认
- host-history-bc-openCard-2：supersede_successor @ 20260926T134302Z-0457a6#2 2026-09-26T13:43:17.204Z → 已确认（动作 1）
- host-history-bc-openCard-2：supersede_successor @ 20260926T154226Z-ae92d8#2 2026-09-26T15:42:46.600Z → 已确认（动作 5）
- host-history-bc-openCard-2：model_pin_change @ 20260926T154226Z-ae92d8#0 2026-09-26T15:42:29.312Z → 已确认（动作 5）
- host-history-bc-openCard-2：model_pin_change @ 20260928T043051Z-be091c#0 2026-09-28T04:31:34.808Z → 已确认（动作 6）

## 六项指标

- 正确自主完成：0/1（操作者动作未知 0，不计入分子）
- 自动恢复：0/1（未知 0）
- 人工救场次数：7（产品决策 0；动作未知的任务 0）
- 观察到的错误完成数：0（只描述本次运行）
- 恢复成本：host-history-bc-openCard-2=未恢复
- 重复运行稳定性：{"S1":"未测","S6":"未测","S11":"未测"}
- 无影响阶段重跑：host-history-bc-openCard-2=代理 0

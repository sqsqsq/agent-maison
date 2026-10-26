# 测试报告 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

## 测试概览

- **特性**: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
- **计划**: `D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T175459Z-004/hylyre/test-plan.hylyre.md`
- **模式**: 真机
- **trace schema**: `0.4-p0`

## 测试执行结果

| 用例编号 | 用例名称 | 优先级 | 关联 AC | 状态 | execution | verification | evidence | expected_check_mode | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | 添加银行卡入口完成成功开卡 | P0 | AC-1 / AC-2 / AC-3 / AC-4 / AC-5 / BD-1 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 28 is the root outcome; 15 later step(s) were not executed |
| TC-002 | 全部银行入口复用卡型 Sheet | P0 | AC-1 / AC-6 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 14 is the root outcome; 9 later step(s) were not executed |
| TC-003 | 卡型 Sheet 取消后重入复位 | P0 | BD-1 / BD-4 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 16 is the root outcome; 2 later step(s) were not executed |
| TC-004 | 候选卡掩码与协议组合门禁 | P0 | AC-2 / BD-1 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag |
| TC-005 | OTP 自动发送与六位数字门禁 | P0 | AC-3 / BD-1 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 19 is the root outcome; 11 later step(s) were not executed |
| TC-006 | OTP 倒计时归零与重发 | P0 | AC-3 / BD-2 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 19 is the root outcome; 7 later step(s) were not executed |
| TC-007 | OTP 关闭后重新进入清空瞬态 | P0 | BD-4 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 19 is the root outcome; 8 later step(s) were not executed |
| TC-008 | 结果页返回拦截与完成清栈 | P0 | AC-5 | 失败 | aborted | failed | complete | disabled_by_flag | expected check disabled by flag; step 19 is the root outcome; 10 later step(s) were not executed |
| TC-009 | 旧路由往返回归 | P1 | AC-6 | 通过 | completed | passed | complete | disabled_by_flag | expected check disabled by flag |

## 步骤证据

| 用例编号 | index | kind | role | status | 归因 | code | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-001 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-001 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 10 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 11 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 12 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 13 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 14 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 15 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-001 | 16 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 17 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 18 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 19 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 20 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 21 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 22 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-001 | 23 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 24 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-001 | 25 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 26 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-001 | 27 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-001 | 28 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-001 | 29 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 30 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 31 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 32 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 33 | input | action | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 34 | wait_idle | action | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 35 | touch | action | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 36 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 37 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 38 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 39 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 40 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 41 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 42 | touch | action | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 43 | wait_for | assertion | blocked | cause.prior_step | step 28 | {"cause": {"step_index": 28, "type": "prior_step"}, "status": "blocked"} |
| TC-001 | 44 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-002 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-002 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-002 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-002 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-002 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-002 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-002 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-002 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-002 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-002 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-002 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-002 | 11 | wait_gone | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "absence", "facts": {"candidate_count": 0, "expected_present": false, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-002 | 12 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-002 | 13 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-002 | 14 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-002 | 15 | scroll_to | action | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 16 | touch | action | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 17 | wait_for | assertion | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 18 | touch | action | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 19 | wait_for | assertion | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 20 | wait_for | assertion | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 21 | wait_for | assertion | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 22 | wait_for | assertion | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 23 | wait_for | assertion | blocked | cause.prior_step | step 14 | {"cause": {"step_index": 14, "type": "prior_step"}, "status": "blocked"} |
| TC-002 | 24 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-003 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-003 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-003 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-003 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-003 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-003 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-003 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 11 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-003 | 12 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 13 | wait_gone | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "absence", "facts": {"candidate_count": 0, "expected_present": false, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-003 | 14 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-003 | 15 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-003 | 16 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-003 | 17 | wait_for | assertion | blocked | cause.prior_step | step 16 | {"cause": {"step_index": 16, "type": "prior_step"}, "status": "blocked"} |
| TC-003 | 18 | wait_gone | assertion | blocked | cause.prior_step | step 16 | {"cause": {"step_index": 16, "type": "prior_step"}, "status": "blocked"} |
| TC-003 | 19 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-004 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-004 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-004 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 11 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-004 | 12 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 13 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 14 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 15 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 16 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 17 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 18 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 19 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-004 | 20 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 21 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-004 | 22 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 23 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-004 | 24 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-004 | 25 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-004 | 26 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-005 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-005 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-005 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-005 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-005 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-005 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-005 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 11 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-005 | 12 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 13 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-005 | 14 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 15 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-005 | 16 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 17 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-005 | 18 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-005 | 19 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-005 | 20 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 21 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 22 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 23 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 24 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 25 | input | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 26 | wait_idle | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 27 | input | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 28 | wait_idle | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 29 | touch | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 30 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-005 | 31 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-006 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-006 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-006 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-006 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-006 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-006 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-006 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 11 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-006 | 12 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 13 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-006 | 14 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 15 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-006 | 16 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 17 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-006 | 18 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-006 | 19 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-006 | 20 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 21 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 22 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 23 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 24 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 25 | touch | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 26 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-006 | 27 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-007 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-007 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-007 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-007 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-007 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-007 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-007 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 11 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-007 | 12 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 13 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-007 | 14 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 15 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-007 | 16 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 17 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-007 | 18 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-007 | 19 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-007 | 20 | input | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 21 | touch | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 22 | wait_gone | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 23 | wait_idle | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 24 | touch | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 25 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 26 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 27 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-007 | 28 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-008 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-008 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-008 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-008 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-008 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-008 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-008 | 10 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 11 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-008 | 12 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 13 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-008 | 14 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 15 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-008 | 16 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 17 | wait_idle | action | passed | observation.action | - | {"observation": {"facts": {"idle_reached": true}, "kind": "action", "operation": "wait_idle", "performed": true}, "status": "passed"} |
| TC-008 | 18 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-008 | 19 | wait_for | assertion | failed | failure.assertion | assertion.mismatch | {"failure": {"code": "assertion.mismatch", "domain": "assertion", "facts": {"assertion": "presence"}}, "observation": {"assertion_type": "presence", "facts": {"candidate_count": 0, "expected_present": true, "observed_present": false, "raw_return_present": false}, "kind": "assertion", "matched": false}, "status": "failed"} |
| TC-008 | 20 | input | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 21 | wait_idle | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 22 | touch | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 23 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 24 | back | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 25 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 26 | touch | action | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 27 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 28 | wait_for | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 29 | wait_gone | assertion | blocked | cause.prior_step | step 19 | {"cause": {"step_index": 19, "type": "prior_step"}, "status": "blocked"} |
| TC-008 | 30 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |
| TC-009 | 0 | stop_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_stopped": true}, "kind": "action", "operation": "stop_app", "performed": true}, "status": "passed"} |
| TC-009 | 1 | start_app | action | passed | observation.action | - | {"observation": {"facts": {"bundle_started": true}, "kind": "action", "operation": "start_app", "performed": true}, "status": "passed"} |
| TC-009 | 2 | touch | action | passed | observation.action | - | {"observation": {"facts": {"center": [1021, 925], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 3 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 4 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 5 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 6 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 7 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 8 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 9 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 10 | scroll_to | action | passed | observation.action | - | {"observation": {"facts": {"center": [660, 1964], "engine": "resolver", "fragment_bounds": null, "resolution_kind": null, "tap": false}, "kind": "action", "operation": "scroll_to", "performed": true}, "status": "passed"} |
| TC-009 | 11 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 12 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 13 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 14 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 15 | touch | action | passed | observation.action | - | {"observation": {"facts": {"engine": "native"}, "kind": "action", "operation": "touch", "performed": true}, "status": "passed"} |
| TC-009 | 16 | wait_for | assertion | passed | observation.assertion | - | {"observation": {"assertion_type": "presence", "facts": {"candidate_count": 1, "expected_present": true, "observed_present": true, "raw_return_present": true}, "kind": "assertion", "matched": true}, "status": "passed"} |
| TC-009 | 17 | expected_check | assertion | skipped | reason.policy | expected_check.disabled_by_flag | {"reason": {"code": "expected_check.disabled_by_flag", "type": "policy"}, "status": "skipped"} |

## 缺陷清单

- **TC-001** 添加银行卡入口完成成功开卡: 失败 — expected check disabled by flag; step 28 is the root outcome; 15 later step(s) were not executed
- **TC-002** 全部银行入口复用卡型 Sheet: 失败 — expected check disabled by flag; step 14 is the root outcome; 9 later step(s) were not executed
- **TC-003** 卡型 Sheet 取消后重入复位: 失败 — expected check disabled by flag; step 16 is the root outcome; 2 later step(s) were not executed
- **TC-004** 候选卡掩码与协议组合门禁: 失败 — expected check disabled by flag
- **TC-005** OTP 自动发送与六位数字门禁: 失败 — expected check disabled by flag; step 19 is the root outcome; 11 later step(s) were not executed
- **TC-006** OTP 倒计时归零与重发: 失败 — expected check disabled by flag; step 19 is the root outcome; 7 later step(s) were not executed
- **TC-007** OTP 关闭后重新进入清空瞬态: 失败 — expected check disabled by flag; step 19 is the root outcome; 8 later step(s) were not executed
- **TC-008** 结果页返回拦截与完成清栈: 失败 — expected check disabled by flag; step 19 is the root outcome; 10 later step(s) were not executed

## 通过率统计

- **P0**: 0/8（0.0%）
- **P1**: 1/1（100.0%）
- **P2**: 0/0（n/a）
- **总体**: 1/9（11.1%）

## 结论

有条件达标（执行结果 outcome=failed，通过率 1/9）。

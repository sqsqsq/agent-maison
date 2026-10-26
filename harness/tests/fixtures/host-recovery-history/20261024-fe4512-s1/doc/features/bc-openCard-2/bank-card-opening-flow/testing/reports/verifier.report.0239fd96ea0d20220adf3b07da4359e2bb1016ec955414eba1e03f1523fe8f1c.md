| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| device_test_run_consumption | PASS | BLOCKER | `testing/reports/20261024T194450Z-003/hylyre/trace.json:4-6,2537-2545…12956-12964`：outcome=`success`，TC-001..TC-009 均为 completed/passed/complete；与 `testing/test-report.md:50-58` 一致。 |
| test_case_completeness | PASS | MAJOR | `testing/test-plan.md:41-49,79-89,100-114`：AC-1..AC-6、BD-1..BD-4、NFR-1 均有对应正常、异常或回归用例。 |
| test_steps_reproducible | PASS | MAJOR | `testing/test-plan.md:79-89`：抽查 TC-001、003、004、005、006、007、008、009，操作对象、输入值和顺序均明确。 |
| expected_result_specific | PASS | MAJOR | `testing/test-plan.md:79-89`：逐例给出可观察的页面、按钮门禁、倒计时、导航栈、数据库及响应阈值结果。 |
| nfr_test_coverage | PASS | MAJOR | `testing/test-plan.md:48,89,114,126`：NFR-1 的 300ms 指标由 TC-011 覆盖，并如实登记当前缺少校准采样通道。 |
| defect_severity_consistency | FAIL | MINOR | `testing/test-report.md:86-100` 将六项视觉缺陷均列为 MINOR；但视觉债务 SSOT `visual-debt.json` 的六个对应 open 条目均为 MAJOR。 |
| pass_criteria_met | PASS | BLOCKER | `testing/test-plan.md:146-151` 对照 `testing/test-report.md:108-118,135-143`：未达全分母及视觉目标时结论为“有条件达标”，且 trace outcome=success，无虚报“达标”。 |
| reference_crosscheck | WARN | MAJOR | `testing/test-report.md:68-78` 显示每条用例仅 1 个同键轮次，但 `:122` 写“9 条用例有同键多轮数据”；`:131` 又正确说明不足 2 轮。 |
| visual_diff_bidirectional | FAIL | MAJOR | `spec/reports/fidelity-intent.json:5-7` 为 pixel_1to1 + best_effort；`device-testing/device-screenshots/visual-diff.json:3-50` 起的六个 screen 均未提供规则要求的显式 `reverse_missing[]`，无法完成反向残差核对。 |

```yaml
verification_result:
  phase: "testing"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:48:57.091Z"
  checks:
    - id: defect_severity_consistency
      status: FAIL
      severity: MINOR
      details: |
        testing/test-report.md:86-100 将六个视觉 warn 汇总缺陷全部评级为 MINOR；
        doc/features/bc-openCard-2/bank-card-opening-flow/visual-debt.json 中相同六个 screen 的
        open 债务均明确记录 severity=MAJOR。报告评级与视觉债务 SSOT 不一致。
      suggestion: |
        由测试报告生成器按 visual-debt.json 的有效严重度生成缺陷清单，或在规则允许降级时输出
        可定位的降级依据，避免把 MAJOR 债务无说明地投影为 MINOR。
    - id: reference_crosscheck
      status: WARN
      severity: MAJOR
      details: |
        testing/test-report.md:68-78 的稳定性表中 TC-001..TC-009 的“同键轮数”均为 1；
        第 122 行却称“9 条用例有同键多轮数据”，与第 131 行“不足 2 轮”及表格原值矛盾。
        trace 状态、9/9 执行计数、两个 unsupported gap 和六项视觉债务引用均可定位且含义一致。
      suggestion: |
        由测试报告生成器把第 122 行改为“9 条用例仅有单轮同键数据”或等价表述。
    - id: visual_diff_bidirectional
      status: FAIL
      severity: MAJOR
      details: |
        spec/reports/fidelity-intent.json:5-7 表明 effective_fidelity=pixel_1to1、
        acceptance_strictness=best_effort，因此本项按 MAJOR 处理。
        device-testing/device-screenshots/visual-diff.json 的六个 screens 均有 verdict、must_fix
        和 defects，但均缺少规则要求逐屏显式存在的 reverse_missing[]；即使没有反向缺失，也应写 []。
        因此无法证明 ref-elements.yaml 中 implement 元素已完成双向残差核对。
      suggestion: |
        由视觉 diff 产出方重新对照 spec/ref-elements.yaml 生成每屏 reverse_missing 数组；
        无缺失时写空数组，有缺失时逐元素登记并关联 must_fix/defect，再重算报告投影。
  summary:
    total: 9
    pass: 6
    fail: 2
    warn: 1
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 0239fd96ea0d20220adf3b07da4359e2bb1016ec955414eba1e03f1523fe8f1c
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

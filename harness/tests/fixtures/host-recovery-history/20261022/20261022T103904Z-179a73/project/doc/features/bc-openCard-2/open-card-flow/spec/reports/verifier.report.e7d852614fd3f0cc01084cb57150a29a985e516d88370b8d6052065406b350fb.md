| id | status | severity | 证据（一行） |
|---|---|---|---|
| acceptance_testable | PASS | BLOCKER | `doc/features/bc-openCard-2/open-card-flow/acceptance.yaml:8` 起，AC-1..AC-7 均有操作步骤、可观察预期及验证分层。 |
| simulation_scope_awareness | PASS | MAJOR | `doc/features/bc-openCard-2/open-card-flow/spec/spec.md:50` 明确单机演示；F2/F3 标注 mock 卡及假短信，F4 明确实际 RDB 保存。 |
| business_flow_branch_coverage | PASS | MAJOR | `doc/features/bc-openCard-2/open-card-flow/spec/spec.md:86` 流程覆盖选类型、选卡、OTP、保存，以及写入失败、重复卡和关闭 OTP 分支。 |
| scenario_to_page | PASS | MAJOR | `doc/features/bc-openCard-2/open-card-flow/spec/spec.md:50` 的 S1/S2 对应卡类型与选卡组件，S3 对应结果页完成按钮及失败回退。 |
| visual_handoff_semantics | PASS | MAJOR | `doc/features/bc-openCard-2/open-card-flow/spec/spec.md:38` 四张原始图分别对应四屏；页面说明没有将当前实现改作视觉权威。 |
| reference_crosscheck | WARN | MAJOR | `doc/features/bc-openCard-2/open-card-flow/spec/ui-spec.yaml:596` 的蓝色 token 与图4观察 sidecar 的红色按钮描述存在已披露差异。 |
| fidelity_capture_governance | PASS | BLOCKER | `doc/features/bc-openCard-2/open-card-flow/spec/spec.md:30` 保留 pixel_1to1/approximate；`:78`、`:139` 明示占位与发布债务；NFC 排除符合原需求。 |

```yaml
verification_result:
  phase: spec
  feature: cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw
  timestamp: "2026-10-22T10:49:28.941Z"
  checks:
    - id: reference_crosscheck
      status: WARN
      severity: MAJOR
      details: |
        doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/4-点击信用卡或储蓄卡后拉起选卡页面.visual.json:49
        描述“红色圆角矩形按钮”；ui-spec.yaml:596 将 selection_next 绑定 brand_primary，
        其定义在同文件:996 为 #007DFF。
        ui-spec.yaml:600 已明确此 token 为暂用、待复核，spec/spec.md:135 也登记了颜色残差，
        因而不属于隐瞒差异或虚报验真，本轮不阻塞。
        其余已核对的 requirement_ref 与原始需求含义一致；术语和模块范围与蓝图及 CU 投影一致；
        bank-card-storage、navigation-cleanup、completion-payload 均可在蓝图及契约原文定位。
      suggestion: |
        父 agent 将本项记入 spec/notes.md，本轮不回修。
        后续 coding/testing 责任方依据当前机器视觉证据确定按钮与勾选颜色，
        不把暂用蓝色 token 当作已验证的像素基线。
  summary:
    total: 7
    pass: 6
    fail: 0
    warn: 1
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: e7d852614fd3f0cc01084cb57150a29a985e516d88370b8d6052065406b350fb
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

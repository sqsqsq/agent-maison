| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| acceptance_testable | PASS | BLOCKER | `acceptance.yaml:5-119`：AC-1 至 AC-6 均有操作步骤、可观察预期、测试层与设备关注点。 |
| simulation_scope_awareness | PASS | MAJOR | `spec/spec.md:210-213`：银行、卡候选、短信、账号手机号及支付状态均明确为本地模拟，RDB 为本地真实存储。 |
| business_flow_branch_coverage | PASS | MAJOR | `spec/spec.md:192-205`：覆盖 F1–F6 主路径、输入门禁循环、保存成功/幂等、保存失败及两个清栈终点。 |
| scenario_to_page | PASS | MAJOR | `spec/spec.md:177-186`：新增既有导航回归承载表，将 S4 的四个页面、动作、锚点和返回语义逐项绑定。 |
| visual_handoff_semantics | PASS | MAJOR | `spec/spec.md:46-93` 的四个权威参考与 `ui-spec.yaml:6,180,287,399` 四个 P0 屏一一对应，并明确 NFC 排除和视觉债务。 |
| reference_crosscheck | PASS | MAJOR | `acceptance.yaml:6-7` 显式关联 AC-1→F1/F2；`acceptance.yaml:92-93` 将原文“添加卡片页”明确解析为蓝图裁决的 `AddBankCardPage`。 |
| fidelity_capture_governance | PASS | BLOCKER | `spec/spec.md:58-84` 声明档位、采集模式及六项 deferral，逐项对应 `spec/ref-elements.yaml:4,20,30,39,41,46`；资产占位及发布阻断见 `spec/asset-manifest.yaml:28-50`。 |

```yaml
verification_result:
  phase: "spec"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-23T04:53:57.686Z"
  checks: []
  summary:
    total: 7
    pass: 7
    fail: 0
    warn: 0
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 3dda0da1336dbe085ecefb51d3f1564b907a162b71f962245cfe4a761f6dbb5c
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->

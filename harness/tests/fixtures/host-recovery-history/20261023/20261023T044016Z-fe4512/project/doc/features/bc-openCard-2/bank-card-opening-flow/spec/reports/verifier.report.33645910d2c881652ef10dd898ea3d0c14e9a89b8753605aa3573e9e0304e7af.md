| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| acceptance_testable | PASS | BLOCKER | `acceptance.yaml:5-118`：AC-1 至 AC-6 均包含 `verification_steps`、可观察的 `expected_result` 与合法 `ut_layer`。 |
| simulation_scope_awareness | PASS | MAJOR | `spec/spec.md:174-177`：完整卡号/RDB 边界明确，银行、候选卡、短信、手机号及支付状态均声明为本地模拟且不调用真实服务。 |
| business_flow_branch_coverage | PASS | MAJOR | `spec/spec.md:156-169`：流程覆盖 F1–F6 主路径、输入门禁循环、RDB 成功/幂等及失败分支和两个清栈终点。 |
| scenario_to_page | FAIL | MAJOR | `spec/spec.md:86` 的 S4 要求在添加卡片、添加银行卡、全部银行和钱包首页之间往返，但 `spec/spec.md:100-150` 未给添加卡片页、全部银行页或钱包首页的承载组件。 |
| visual_handoff_semantics | PASS | MAJOR | `spec/spec.md:46-68` 的四个 `authoritative_refs` 分别映射 `ui-spec.yaml:6,180,287,399` 的四个 P0 屏，并明确 NFC 排除与首页目的地裁决。 |
| reference_crosscheck | FAIL | MAJOR | `spec/spec.md:210` 将 AC-1 关联 F1、F2，但 `acceptance.yaml:5-24` 的 `prd_function` 仅为 F1；`acceptance.yaml:91` 写失败回“添加卡片页”，与 `spec/spec.md:139` 及 `change-unit.yaml:37` 的“最初添加银行卡页”不一致。 |
| fidelity_capture_governance | FAIL | BLOCKER | `spec/spec.md:45-60` 的 Visual Handoff 未声明 `fidelity_deferrals`，但 `spec/ref-elements.yaml:4,20,30,39,41,46` 存在六个 `disposition: defer`，无法完成要求的交叉一致性核验。 |

```yaml
verification_result:
  phase: "spec"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-23T04:53:57.686Z"
  checks:
    - id: scenario_to_page
      status: FAIL
      severity: MAJOR
      details: |
        `spec/spec.md:86` 的 S4 包含“在添加卡片、添加银行卡、全部银行和钱包首页之间按既有语义往返”。
        `spec/spec.md:100-150` 仅描述卡型半模态、具体银行卡页、验证码半模态、结果页及其状态；
        除作为遮罩背景的添加银行卡页外，找不到承载 S4 其余往返操作的页面组件。
      suggestion: |
        spec 责任方在“页面/界面描述”中补充既有导航回归承载表，按页面列出触发入口、返回动作和可验收组件/锚点。
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        `spec/spec.md:210` 明确 AC-1 覆盖 F1、F2，而 `acceptance.yaml:5-24` 只写 `prd_function: F1`，
        与 `acceptance.yaml:183-185` 声称 F2 已覆盖的汇总不一致。
        同时 `acceptance.yaml:91` 的失败终点是“最初添加卡片页”，
        但 `spec/spec.md:139`、`change-unit.yaml:37` 和蓝图的详细导航裁决均指向最初 AddBankCardPage/添加银行卡页。
        这些差异会使后续测试绑定到不同功能或目的页。
      suggestion: |
        spec 责任方统一 acceptance SSOT：让 AC-1 显式关联 F1、F2，并将 AC-5 的失败终点统一为已裁决的最初 AddBankCardPage。
    - id: fidelity_capture_governance
      status: FAIL
      severity: BLOCKER
      details: |
        `spec/spec.md:45-60` 声明 `fidelity_target: pixel_1to1` 和 `asset_acquisition_mode: approximate`，
        但没有 `fidelity_deferrals`。
        `spec/ref-elements.yaml:4,20,30,39,41,46` 却分别延后四个系统状态栏、系统数字键盘和低置信 OCR 文案。
        因而 Visual Handoff 无法与参考图侧 defer 清单逐项交叉核对；pixel_1to1 下这些仍是未满足义务。
      suggestion: |
        spec 责任方在 Visual Handoff YAML 中增加 `fidelity_deferrals`，逐项登记上述六个 element_id、原因、
        当前能力边界及清偿条件；保持其为视觉债务，不使用签名或 best-effort 文案将其冒充已满足。
  summary:
    total: 7
    pass: 4
    fail: 3
    warn: 0
    blockers: 1
    verdict: FAIL
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: 33645910d2c881652ef10dd898ea3d0c14e9a89b8753605aa3573e9e0304e7af
verdict: FAIL
blocker_count: 1
<!-- /maison-verifier-result:v1 -->

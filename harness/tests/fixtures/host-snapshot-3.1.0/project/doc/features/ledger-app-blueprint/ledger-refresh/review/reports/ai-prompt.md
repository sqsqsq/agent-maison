# Review 阶段语义验证 — cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g

> 自动生成于 2026-09-25T04:34:26.096Z
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-review.overlay.md`，须与本正文**合并阅读**（代码形态与审查侧重点以 profile 为准）。

---

## 一、你的角色

先读本次 subject、目标与基线。request 只审查明确代码/diff 和用户要求的维度，不强制本次 coding 或 Feature 文档，不写 Feature attestation/completion。组合交付必须对照绑定的契约、验收、CU design_refs、runtime flow 与组件资产；蓝图来源不降级。缺必需对照资料时对应义务 FAIL。叙述 spec/plan 仅在实际消费时检查，不能以审查旧基线替代本次实现；漂移与小改复用既有风险分类，不自行新增全测要求。

你是一名**独立的审查报告审核员**，专门负责评估 Code Review 报告本身的质量。你的任务是根据下方提供的 **Spec 规约**、**源代码**和**审查报告**，逐项评估审查报告是否全面、准确、可操作。

**关键原则：**
- 你独立于报告编写者，避免"自己验自己"的偏差
- 仅基于 Spec 规则和实际代码给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（章节存在性、表格格式、严重程度值域等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
- **阶段**: review

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/review-rules.yaml` 的完整内容，定义了 Review 阶段的通用约束规则：

```
phase: review
version: "1.0"
applies_to: "**/review-report.md"
structure_checks:
  negative_verdict_closure:
    description: >
      负面产品裁决闭环门禁（blind-visual-hardening d1）：审查结论=不通过 → BLOCKER FAIL， review
      不得闭环推进（bc-openCard 二轮：不通过+3 BLOCKER 曾以 summary PASS/closed 照常进
      ut/testing）。报告一致性（report_validity）归 conclusion_with_verdict，
      本门禁是产品裁决传播；verifier PASS 只证报告可信，永不改写产品裁决。
  upstream_verdict_gate:
    description: >
      跨阶段负面裁决传播门禁（blind-visual-hardening d1）：本阶段启动时消费上游阶段 summary.json
      机器裁决（verdict+blockers+证据链新鲜度）——上游 verdict 非 PASS / blocker 未清 / 证据
      stale|tampered → BLOCKER FAIL。Markdown 报告只是上游 harness 的解析输入，下游不重新解释上游散文（防
      TOCTOU）。
  conditional_pass_closure:
    description: >
      「有条件通过」闭环门禁（goal-fakepass-hardening 洞⑥）：结论=有条件通过 且 问题表 存在未标记 已关闭/已修复 的
      MAJOR → BLOCKER FAIL，review 不得闭环推进并回责任阶段修复。 legacy
      conditional_review_authorization receipt 可读但不改变 verdict。LLM verifier 的
      PASS 只证报告可信，不被消费为产品 PASS。
  required_chapters:
    description: |
      Review 报告必须包含以下章节： 审查范围、审查方法、问题清单、问题统计、修复建议摘要、结论
    severity: BLOCKER
    rule:
      expected_headings:
        - 审查范围
        - '"审查方法" or "审查维度"'
        - 问题清单
        - 问题统计
        - '"修复建议" or "修复建议摘要"'
        - '"结论" or "审查结论"'
      match: heading_text_contains
  issue_table_format:
    description: |
      「问题清单」必须包含 Markdown 表格，表头至少包含： 编号、严重程度、分类、问题描述、涉及文件、修复建议
    severity: BLOCKER
    rule:
      section: 问题清单
      expect: markdown_table
      required_columns:
        - 编号
        - '"严重程度" or "严重等级"'
        - 分类
        - 问题描述
        - 涉及文件
        - 修复建议
  severity_values:
    description: |
      问题严重程度必须使用统一分级：BLOCKER / MAJOR / MINOR / INFO
    severity: BLOCKER
    rule:
      section: 问题清单
      column: 严重程度
      allowed_values:
        - BLOCKER
        - MAJOR
        - MINOR
        - INFO
  issue_category_values:
    description: |
      问题分类必须来自预定义类别： 分层违规、接口不一致、资源引用、命名规范、 硬编码、逻辑错误、异常处理、性能、安全、其他
    severity: MAJOR
    rule:
      section: 问题清单
      column: 分类
      allowed_values:
        - 分层违规
        - 接口不一致
        - 资源引用
        - 命名规范
        - 硬编码
        - 逻辑错误
        - 异常处理
        - 性能
        - 安全
        - 其他
  statistics_summary:
    description: |
      「问题统计」章节必须包含各严重程度的计数汇总
    severity: MAJOR
    rule:
      section: 问题统计
      expect: count_by_severity
      severities:
        - BLOCKER
        - MAJOR
        - MINOR
        - INFO
  scope_declaration:
    description: |
      「审查范围」必须明确列出本次审查涉及的模块列表和文件范围
    severity: MAJOR
    rule:
      section: 审查范围
      expect: '"module_list" or "file_list"'
  conclusion_with_verdict:
    description: |
      「结论」章节必须包含明确的审查结论：通过 / 有条件通过 / 不通过， 且不通过时必须说明 BLOCKER 数量
    severity: BLOCKER
    rule:
      section: 结论
      expect: verdict
      allowed_values:
        - 通过
        - 有条件通过
        - 不通过
  metadata_header:
    description: |
      报告顶部必须包含模块标识、审查日期、审查版本、审查人等元数据
    severity: MINOR
    rule:
      expect: blockquote_metadata
      required_fields:
        - 模块标识
        - 审查日期
        - 审查版本
  visual_fidelity_review:
    description: >
      P1-B（plan f2d8c4a6）：UI 需求（spec ui_change 需 ui-spec）的 review
      报告必须包含「视觉保真」审查维度， 且引用执行证据——素材验真（asset-crop-validation/contact-sheet）、可见文案
      diff（visible_text/豁免表复核）、 结构声明台账逐条复核（P1-4②·c9e2a7f4：引用
      coding/structure-conformance.yaml，打开 implemented_by 对应 struct 源码验证 how
      属实，pixel_1to1 P0 全条目不许抽查——台账自报面的唯一人审关口）、 must_have 覆盖。pixel_1to1
      下四类证据**全覆盖**（不许抽查）→ 缺任一 FAIL BLOCKER；非 pixel_1to1 至少一类。review 不重跑度量、消费
      spec/coding 落盘报告。 round6 实证（RC6）：review 五维 checklist 无一条看图，废图+乱布局"有条件通过"。
      诚实边界：本 check 只核"证据被引用"，引用真实性归当前 AI verifier 的 issue_accuracy 与 item-level
      证据绑定复验。
    severity: BLOCKER
    rule:
      expect: visual_fidelity_dimension_with_evidence
semantic_checks:
  review_dimension_coverage:
    description: >
      审查必须覆盖以下维度： 架构层合规性（依据 framework.config.json > architecture.outer_layers）、
      模块内部分层（依据 architecture.module_inner_layers）、 接口一致性（vs
      plan.md）、资源引用完整性、命名规范、异常处理、 spec 功能覆盖、视觉保真（UI 需求，P1-B：消费 spec/coding
      落盘报告，见 visual_fidelity_review）
    severity: MAJOR
    ai_prompt_hint: >
      检查审查报告是否涵盖了所有关键维度， 特别是架构分层和 plan.md 一致性是否被审查； UI 需求（有 ui-spec 的
      feature）还须检查「视觉保真」维度是否真实执行—— 报告引用的
      asset-crop-validation/contact-sheet/文案豁免表是否真实存在且结论与产物一致（抽样核对，防"声称看过"）
  issue_accuracy:
    description: |
      报告中指出的问题必须准确——引用的文件路径和代码位置必须真实存在， 问题描述必须与实际代码缺陷匹配
    severity: BLOCKER
    ai_prompt_hint: |
      抽样验证问题清单中的若干项： (1) 引用的文件路径是否存在； (2) 问题描述是否与实际代码匹配； (3) 严重程度评级是否合理
  fix_recommendation_actionable:
    description: |
      每条问题的修复建议必须具体可操作，不能仅是"请修复"这类模糊表述
    severity: MAJOR
    ai_prompt_hint: |
      检查修复建议是否包含：(1) 具体修改哪个文件/方法； (2) 如何修改（代码示例或明确步骤）
  false_positive_rate:
    description: |
      报告中不应包含误报（实际上不是问题的项），误报率应低于 10%
    severity: MAJOR
    ai_prompt_hint: |
      逐条审查问题清单，判断是否存在误报： 代码实际上是正确的但被标记为问题的情况
  blocker_threshold:
    description: |
      如果存在 BLOCKER 级别问题，结论必须为"不通过"； 如果零 BLOCKER 但有 MAJOR，结论应为"有条件通过"
    severity: BLOCKER
    ai_prompt_hint: |
      验证结论与问题统计的一致性： BLOCKER > 0 → 必须"不通过"； BLOCKER = 0 且 MAJOR > 0 → 应"有条件通过"
  coding_rules_referenced:
    description: >
      Review 发现的问题应能追溯到 framework/specs/phase-rules/coding-rules.yaml
      中的具体规则项，确保审查基于统一标准
    severity: MINOR
    ai_prompt_hint: |
      检查问题清单中的分类和描述是否与 coding-rules.yaml 中的规则对应
traceability_checks:
  component_asset_selection:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_asset_projection:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_export_registered:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_new_static_checks:
    severity: BLOCKER
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  component_uncurated:
    severity: MAJOR
    description: 组件资产检查；语义见 docs/concepts/component-assets.md。
  conventions_coverage:
    description: 惯例文件存在时核对全量台账、声明落位、蓝图贯穿与 gate 引用；无文件且无声明时跳过
    severity: MAJOR
  change_unit_feature_projection:
    description: 审查 CU-bound Feature identity、ID-only mappings、运行时唯一真源与真实纵向接缝完整性
    severity: BLOCKER
  issue_to_file:
    description: |
      问题清单中每条的「涉及文件」必须是工程中真实存在的文件路径
    severity: BLOCKER
    rule:
      source: 问题清单.涉及文件
      check: file_exists_on_disk
  issue_to_coding_rule:
    description: |
      问题清单中每条的「分类」应能对应到 coding-rules.yaml 中的某条规则
    severity: MINOR
    rule:
      source: 问题清单.分类
      target: framework/specs/phase-rules/coding-rules.yaml
      match: category_maps_to_rule
  review_scope_to_design:
    description: |
      审查范围中声明的模块列表应与 plan.md 的模块变更摘要一致
    severity: MAJOR
    rule:
      source: 审查范围.模块列表
      target: plan.md > 模块变更摘要
      coverage: 100%
  blocker_fix_verification:
    description: |
      标记为 BLOCKER 的问题在修复后，必须有明确的验证记录 （若报告包含修复验证章节）
    severity: MAJOR
    ai_prompt_hint: |
      如果报告中有修复记录，验证每个 BLOCKER 是否都有对应的修复和验证结果
exploration_thresholds:
  min_files_inspected: 5
  min_source_code_paths: 3
  min_searches: 4
  min_code_facts: 3
  require_subagent_when_review_files_gt: 8
  exploration_mode_allowed:
    - subagent
    - sequential
exploration_strategy:
  default_mode: sequential
  scoring:
    threshold: 60
    dimensions:
      - id: module_loc
        weight: 25
        tiers:
          - gte: 50000
            score: 25
          - gte: 20000
            score: 15
          - gte: 5000
            score: 8
      - id: scope_breadth
        weight: 20
        tiers:
          - gte: 3
            score: 20
          - gte: 2
            score: 12
          - gte: 1
            score: 5
      - id: cross_layer
        weight: 20
        signal: touches_multiple_outer_layers
        score_if_true: 20
      - id: new_api_surface
        weight: 15
        signal: adds_exports_or_public_api
        score_if_true: 15
      - id: dependency_fan_out
        weight: 20
        tiers:
          - gte: 10
            score: 20
          - gte: 5
            score: 12
          - gte: 2
            score: 5
  sequential_multiplier: 2
  sequential_min_files_inspected_add: 5

```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-review.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{
  "phase": "review",
  "feature": "cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g",
  "timestamp": "2026-09-25T04:34:26.082Z",
  "project_root": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur",
  "assurance": "degraded",
  "capability_resolutions": [
    {
      "id": "capability_review_code_context",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "fail",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "code",
          "state": "resolved",
          "selected_source": "derive.codebase",
          "selected_source_fingerprint": "9d5c312f535515947c5960a4611943514f8a627a51341872e71135d4dbfc1d52",
          "binding": {
            "input_id": "code",
            "source": {
              "kind": "derive",
              "provider_id": "derive.codebase"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\ClosureFixture.ts",
                "exists": true,
                "sha256": "3d9ce426b6a10261ea819bcb0866c214a204cb4771d389d99193be39fdeb6d3d",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerFeature.ets",
                "exists": true,
                "sha256": "438c43280a11f6c1ded9988f7ebe9ec4b96e6fae38140a92d481c5c409eba431",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeBypass.ts",
                "exists": true,
                "sha256": "266e45c659ba29f63892abecd7f5ac1766e6080a11874dc5dd0ff7f2095834cb",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeConsumer.ts",
                "exists": true,
                "sha256": "05e74157c1ebb27756b6c54ff3da21b9157c9cd6815b9670d806b592143ec6b7",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerSourceSeam.ts",
                "exists": true,
                "sha256": "70cd301f29ed47420f1790c182b8eef73fe27532c46a50c469e68e6fb173c762",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\closure.test.ts",
                "exists": true,
                "sha256": "24c2cd85fa29ca62fd6408410e0823394d79cf452649af48ba20e45642130943",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\seam-bypass.case.ts",
                "exists": true,
                "sha256": "4d329f5ccd0a2e2a9105d832f184d991406e1bb37579f833df16dcd3181205b2",
                "role": "derive"
              }
            ],
            "source_refs": [
              "src/ledger/LedgerFeature.ets",
              "src/ledger/LedgerIntakeConsumer.ts",
              "src/ledger/LedgerSourceSeam.ts",
              "src/ledger/LedgerIntakeBypass.ts",
              "src/ledger/ClosureFixture.ts",
              "test/ledger/closure.test.ts",
              "test/ledger/seam-bypass.case.ts"
            ],
            "content_fingerprint": "9d5c312f535515947c5960a4611943514f8a627a51341872e71135d4dbfc1d52"
          },
          "attempts": [
            {
              "kind": "derive",
              "source": "derive.codebase",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerFeature.ets",
                  "exists": true,
                  "sha256": "438c43280a11f6c1ded9988f7ebe9ec4b96e6fae38140a92d481c5c409eba431",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeConsumer.ts",
                  "exists": true,
                  "sha256": "05e74157c1ebb27756b6c54ff3da21b9157c9cd6815b9670d806b592143ec6b7",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerSourceSeam.ts",
                  "exists": true,
                  "sha256": "70cd301f29ed47420f1790c182b8eef73fe27532c46a50c469e68e6fb173c762",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeBypass.ts",
                  "exists": true,
                  "sha256": "266e45c659ba29f63892abecd7f5ac1766e6080a11874dc5dd0ff7f2095834cb",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\ClosureFixture.ts",
                  "exists": true,
                  "sha256": "3d9ce426b6a10261ea819bcb0866c214a204cb4771d389d99193be39fdeb6d3d",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\closure.test.ts",
                  "exists": true,
                  "sha256": "24c2cd85fa29ca62fd6408410e0823394d79cf452649af48ba20e45642130943",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\seam-bypass.case.ts",
                  "exists": true,
                  "sha256": "4d329f5ccd0a2e2a9105d832f184d991406e1bb37579f833df16dcd3181205b2",
                  "role": "derive"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "capability_review_design_context",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "contracts",
          "state": "resolved",
          "selected_source": "contracts@1",
          "selected_source_fingerprint": "04a515fc0c34d8968cf3c647189137d27da189ed70d0ceeff10d7d0449da865c",
          "binding": {
            "input_id": "contracts",
            "source": {
              "kind": "artifact",
              "artifact": "contracts@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                "exists": true,
                "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                "exists": true,
                "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                "exists": true,
                "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\contracts.yaml",
                "exists": true,
                "sha256": "3499e70fb614809fb58bcc5d016df794739d83c40d74e3eb47e403c65fffd440",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                "exists": true,
                "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                "exists": true,
                "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                "exists": true,
                "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/ledger-app-blueprint/ledger-refresh/contracts.yaml",
              "doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml",
              "doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml",
              "contracts/ledger-api.yaml",
              "mappings/create-entry.yaml",
              "requirements/ledger.md",
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml"
            ],
            "content_fingerprint": "04a515fc0c34d8968cf3c647189137d27da189ed70d0ceeff10d7d0449da865c"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "contracts@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\contracts.yaml",
                  "exists": true,
                  "sha256": "3499e70fb614809fb58bcc5d016df794739d83c40d74e3eb47e403c65fffd440",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                  "exists": true,
                  "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                  "exists": true,
                  "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                  "exists": true,
                  "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                  "exists": true,
                  "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                  "exists": true,
                  "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\contracts.yaml"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_review_narrative_context",
      "axis": "functional",
      "active": true,
      "state": "pruned",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "spec",
          "state": "absent",
          "selected_source": null,
          "selected_source_fingerprint": null,
          "attempts": [
            {
              "kind": "artifact",
              "source": "spec@1",
              "state": "absent",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\spec\\spec.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\prd\\PRD.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\prd\\spec.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\PRD.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\spec.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                }
              ],
              "upstream_producer": "spec",
              "detail": "spec@1 missing"
            }
          ]
        },
        {
          "id": "plan",
          "state": "absent",
          "selected_source": null,
          "selected_source_fingerprint": null,
          "attempts": [
            {
              "kind": "artifact",
              "source": "plan@1",
              "state": "absent",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\plan\\plan.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\design\\design.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\design\\plan.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\design.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\plan.md",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "plan@1 missing"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_review_acceptance_context",
      "axis": "evidence",
      "active": true,
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "acceptance",
          "state": "resolved",
          "selected_source": "acceptance@1",
          "selected_source_fingerprint": "0dc9fdaefb26fc585bea8857d34f22839c9834c2ef15f7034f1a63170e1158bf",
          "binding": {
            "input_id": "acceptance",
            "source": {
              "kind": "artifact",
              "artifact": "acceptance@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                "exists": true,
                "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                "exists": true,
                "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\acceptance.yaml",
                "exists": true,
                "sha256": "2a8b257571d1b6b8e7b1b589374f132cf0ec52429c1c4165a9362c55227270de",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                "exists": true,
                "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                "exists": true,
                "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                "exists": true,
                "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                "exists": true,
                "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/ledger-app-blueprint/ledger-refresh/acceptance.yaml",
              "doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml",
              "doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml",
              "contracts/ledger-api.yaml",
              "mappings/create-entry.yaml",
              "requirements/ledger.md",
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml"
            ],
            "content_fingerprint": "0dc9fdaefb26fc585bea8857d34f22839c9834c2ef15f7034f1a63170e1158bf"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "acceptance@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\acceptance.yaml",
                  "exists": true,
                  "sha256": "2a8b257571d1b6b8e7b1b589374f132cf0ec52429c1c4165a9362c55227270de",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                  "exists": true,
                  "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                  "exists": true,
                  "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                  "exists": true,
                  "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                  "exists": true,
                  "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                  "exists": true,
                  "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "spec",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\acceptance.yaml"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_review_use_cases",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "use_cases",
          "state": "resolved",
          "selected_source": "use-cases@1",
          "selected_source_fingerprint": "0961de9f661666b3d325144476278a22b7a359ef2af618cbb884e49bd4e2f2a0",
          "binding": {
            "input_id": "use_cases",
            "source": {
              "kind": "artifact",
              "artifact": "use-cases@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                "exists": true,
                "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                "exists": true,
                "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                "exists": true,
                "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                "exists": true,
                "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                "exists": true,
                "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                "exists": true,
                "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml",
              "doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml",
              "doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml",
              "contracts/ledger-api.yaml",
              "mappings/create-entry.yaml",
              "requirements/ledger.md",
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml"
            ],
            "content_fingerprint": "0961de9f661666b3d325144476278a22b7a359ef2af618cbb884e49bd4e2f2a0"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "use-cases@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                  "exists": true,
                  "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                  "exists": true,
                  "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                  "exists": true,
                  "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                  "exists": true,
                  "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                  "exists": true,
                  "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_review_visual_context",
      "axis": "visual",
      "active": false,
      "state": "not_applicable",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.ui",
      "applicability_dependencies": [],
      "applicability_detail": "visual-evidence explicitly not applicable",
      "inputs": []
    }
  ],
  "capability_resolution_contract_fingerprint": "1699c507921c59f201d8c31d95991c4e2834a65b3d6f61352050e1fd7faf7e47",
  "checks": [
    {
      "id": "issue_category_values",
      "category": "structure",
      "description": "问题分类必须来自预定义类别： 分层违规、接口不一致、资源引用、命名规范、 硬编码、逻辑错误、异常处理、性能、安全、其他",
      "severity": "MAJOR",
      "status": "WARN",
      "details": "1 个未定义的分类值：可读性。建议使用预定义类别。",
      "source": "issue_category_values"
    },
    {
      "id": "issue_to_coding_rule",
      "category": "traceability",
      "description": "问题清单中每条的「分类」应能对应到 coding-rules.yaml 中的某条规则",
      "severity": "MINOR",
      "status": "WARN",
      "details": "仅 0/1 (0%) 条问题可追溯到 coding-rules.yaml。",
      "suggestion": "建议使用预定义分类以增强问题到规约的追溯性。",
      "source": "issue_to_coding_rule"
    },
    {
      "id": "conventions_coverage",
      "category": "traceability",
      "severity": "MAJOR",
      "status": "SKIP",
      "description": "惯例文件存在时核对全量台账、声明落位、蓝图贯穿与 gate 引用；无文件且无声明时跳过",
      "details": "惯例文件不存在且无声明；本工程未启用惯例核对。",
      "affected_files": [
        "doc/conventions.md",
        "doc/features/ledger-app-blueprint/ledger-refresh/review/review-report.md"
      ],
      "source": "conventions_coverage"
    }
  ],
  "summary": {
    "total": 23,
    "pass": 20,
    "fail": 0,
    "warn": 2,
    "skip": 1,
    "blockers": 0,
    "verdict": "PASS"
  },
  "passed_check_ids": [
    "node_options_injection",
    "context_exploration_facts_phase_delta_present",
    "required_chapters",
    "issue_table_format",
    "severity_values",
    "statistics_summary",
    "review_reference_lint",
    "scope_declaration",
    "conclusion_with_verdict",
    "metadata_header",
    "issue_to_file",
    "review_scope_to_design",
    "change_unit_feature_projection",
    "conditional_pass_closure",
    "negative_verdict_closure",
    "upstream_verdict_gate",
    "capability_review_code_context",
    "capability_review_design_context",
    "capability_review_acceptance_context",
    "capability_review_use_cases"
  ]
}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 8 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: 审查维度覆盖度 (review_dimension_coverage)

- **严重等级**: MAJOR
- **评估方法**:
  1. 审查报告的「审查方法」章节是否声明了以下维度：
     - 五层架构合规性
     - 模块内四层分层
     - 接口一致性（vs plan.md / contracts.yaml）
     - 资源引用完整性
     - 命名规范
     - 异常处理（vs acceptance.yaml）
     - spec 功能覆盖
     - 视觉保真（UI 需求，P1-B·f2d8c4a6：消费 spec/coding 落盘报告——asset-crop-validation/contact-sheet、
       可见文案豁免表复核、结构声明台账逐条复核（P1-4②·c9e2a7f4：structure-conformance.yaml 的每条
       implemented_by 须打开源码验证 how 属实）、must_have 覆盖；pixel_1to1 全覆盖不许抽查）
  2. 问题清单中是否有来自上述各维度的检查结果
  3. 若某个关键维度完全未审查（未在方法中声明且问题清单无相关分类），标为 FAIL
  4. 特别关注：架构分层和 plan.md 一致性是否被充分审查
  5. UI 需求特别关注：「视觉保真」维度引用的产物路径是否真实存在、结论是否与产物一致
     （抽样打开 asset-crop-validation.json / 豁免表核对，防"声称看过"——脚本门禁 visual_fidelity_review
     只核证据被引用，真实性靠本检查兜）

### 检查 2: 问题准确性 (issue_accuracy)

- **严重等级**: BLOCKER
- **评估方法**:
  1. **未关闭的 BLOCKER/MAJOR 必须逐条全验**（它们会作为可修缺陷候选驱动自动回退
     coding——一条幻觉 CR 就会驱动改正确的代码，抽样不够）；MINOR/INFO 可抽样 5-10 条
  2. 对每条验证问题：
     a. 验证「涉及文件」路径是否在上下文源代码中存在
     b. 验证「问题描述」是否与实际代码匹配——阅读对应源代码，确认问题确实存在
     c. 验证「严重程度」评级是否合理（对照 review-rules.yaml 中的分级标准）
  3. 若发现某条问题是误报（代码实际上是正确的但被标记为问题），标记为误报
  4. 误报率计算：误报数 / 验证数
     - 误报率 ≤ 10%: PASS
     - 误报率 10%-30%: WARN
     - 误报率 > 30%: FAIL
  5. **逐条裁决必须同时以机器可读块输出**（责任阶段路由消费——只有 confirmed 的问题
     才能生成回退候选；无此块=全部问题视为未验证，零候选）。在报告正文追加：

     ```issue-verification
     - issue: CR-001
       verdict: confirmed
       evidence: SelectBankCardPage.ets | 补 onDisappear/shouldDismiss 复位状态机
     - issue: CR-002
       verdict: refuted
       evidence: OpenCardFlow.ets | 消费 upsertCard 的 duplicated 字段并提示
     ```

     verdict 取值：`confirmed`（打开源码确认问题真实存在）/ `refuted`（误报）/
     `unclear`（无法判定）。**只列你真正打开源码验证过的问题**；未验证的不列
     （宁缺——unclear 与缺席都不产生候选）。
     `evidence` **必填，格式＝`<涉及文件名> | <该行修复建议原文>`**：
     ①涉及文件名（如 `SelectBankCardPage.ets`）；
     ②**原样复制**问题清单里这一行的「修复建议」（无该列时复制「问题描述」）——
     必须逐字照抄，不要改写、概括或只写关键词。
     原因：它用于识别"上一轮 verifier 产物被当成本轮证据"。只写文件名不够（同一文件的
     问题可能已经完全换了）；只写相似短语也不够（「修复下拉菜单状态机错误」与
     「修复短信验证状态机错误」是两个缺陷）。**照抄不全的条目一律不采信**，该问题会
     留在 review 要求重新验证——这是刻意的保守设计，不会误驱动改码。

### 检查 3: 修复建议可操作性 (fix_recommendation_actionable)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐条审查问题清单中的「修复建议」列
  2. 判断每条修复建议是否满足：
     a. 指明具体修改哪个文件和/或方法
     b. 提供修改方向或代码示例（如"将 import 改为 xxx"、"添加 try/catch"）
     c. 不是泛化的"请修复"、"需要改正"等模糊表述
  3. 统计可操作的修复建议占比：
     - ≥ 80%: PASS
     - 60%-80%: WARN
     - < 60%: FAIL

### 检查 4: 误报率 (false_positive_rate)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐条审查问题清单，对每条问题：
     a. 阅读对应的源代码
     b. 判断代码是否确实存在该问题
     c. 若代码实际正确但被标记为问题，该条为误报
  2. 重点关注：
     - 分层违规：import 路径是否确实跨层
     - 接口不一致：签名是否确实与 contracts.yaml 不同
     - 硬编码：文本是否确实在 UI 组件中使用（log 和常量不算）
  3. 误报数 / 总问题数：
     - ≤ 10%: PASS
     - 10%-20%: WARN
     - > 20%: FAIL

### 检查 5: BLOCKER 与结论一致性 (blocker_threshold)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 统计问题清单中 BLOCKER 级问题数量
  2. 阅读「结论」章节中的审查结论
  3. 验证一致性：
     - BLOCKER > 0 → 结论必须为"不通过"
     - BLOCKER = 0 且 MAJOR > 0 → 结论应为"有条件通过"
     - BLOCKER = 0 且 MAJOR = 0 → 结论应为"通过"
  4. 若不一致，判为 FAIL
  5. 同时检查：标为 BLOCKER 的问题是否确实达到 BLOCKER 级别
     （如架构违规、接口不一致应为 BLOCKER，命名问题不应为 BLOCKER）

### 检查 6: 编码规则追溯 (coding_rules_referenced)

- **严重等级**: MINOR
- **评估方法**:
  1. 检查问题清单中的「分类」列
  2. 验证分类是否使用了 review-rules.yaml 中定义的预定义类别
  3. 对于每条问题，判断其分类是否能对应到 `coding-rules.yaml` 中的具体规则：
     - "分层违规" → layer_compliance / inter_module_dependency
     - "接口不一致" → interface_signature_consistency
     - "资源引用" → coding_compile（真实构建为唯一真源；静态 resource_integrity 已退役）
     - "命名规范" → naming_conventions
     - "硬编码" → no_hardcoded_strings
     - "逻辑错误" → business_logic_correctness
     - "异常处理" → error_handling_completeness
  4. 追溯率 ≥ 70%: PASS；< 70%: WARN

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 逐条核对本阶段产物里的跨文件引用——问题条目引用的 `文件:行`、token/常量值、路径 ↔ 当前源码；视觉类问题 ↔ visual-debt 台账与 ui-spec 的实际值。每条引用都要打开被引用的原文核对，不凭记忆、不凭上下文摘要。
- **判定标准**: 引用对象存在且含义一致 → PASS；个别引用漂移（行号/名称过期但对象仍可定位） → WARN；关键引用指向不存在或含义相反的对象 → FAIL
- **证据**: 列出核对过的引用（`引用 → 原文位置`）与不一致项


### 检查 8: 工程惯例台账语义 (conventions_semantics)

- **严重等级**: MAJOR
- **评估方法**: `paths.conventions` 文件存在时独立读台账全文与目标源码（审查范围由 `contracts.files` 目标文件集合定义），抽查台账判定并检查漏选，不得只因 plan 没声明便忽略条目；适用条目打开范例验证文件/符号；VIOLATION 须有同 id 与范例路径的问题且判断有代码依据；CU 所引蓝图采用的惯例是否传到声明，NOT_APPLICABLE 理由是否真实；gate 卡只委托，不抄其它报告结果。
- **判定标准**: 台账判定与代码一致 → PASS；范例失效或个别漏选 → WARN；按生效日与 git blame 核对属 legacy 的违反只作 advisory、无法断代不得升级阻断；无惯例文件 → SKIP
- **证据**: 抽查条目 → 代码位置；漏选 / 误判清单

---

## 六、上下文文件

以下是本次验证的上下文：被审产物与直接依据内联；上游文档与源码只给**路径清单**，需要核对时用 Read 按路径读取，不要全量通读。

被审 feature 根目录：`doc/features/cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g/`（相对仓根；下方清单里的相对路径同样相对仓根）。

### (resolved input code)

```
- path: src/ledger/LedgerFeature.ets
  content: >
    export class LedgerFeature {
      private entries: number[] = [];
      add(amount: number): number { this.entries.push(amount); return this.balance(); }
      balance(): number { return this.entries.reduce((a, b) => a + b, 0); }
      restore(saved: number[]): number { this.entries = [...saved]; return this.balance(); }
    }
- path: src/ledger/LedgerIntakeConsumer.ts
  content: >
    // 接缝的真实 Consumer：只经稳定契约取数，不 import 任何具体 Provider。

    // proveSeamConsumerNoBypass 会对本文件做源码级检查——改成直接依赖某个 Provider 就会被抓到。


    import { LedgerSource, resolveLedgerSource } from './LedgerSourceSeam';


    export interface LedgerIntakeResult {
      sourceId: string;
      total: number;
    }


    export function ledgerIntake(source: LedgerSource | undefined):
    LedgerIntakeResult {
      const resolved = resolveLedgerSource(source);
      return {
        sourceId: resolved.sourceId,
        total: resolved.read().reduce((sum, item) => sum + item, 0),
      };
    }
- path: src/ledger/LedgerSourceSeam.ts
  content: >
    // 宿主演进接缝夹具（总纲 §11.3）：稳定契约 + 两个真实 Provider + 缺失裁决。

    // 这不是"接口摆设"——四项接缝证明会真的调用它，见 test/ledger/closure.test.ts。


    /** 稳定能力契约：记账来源。Consumer 只认它，不认任何具体实现。 */

    export interface LedgerSource {
      readonly sourceId: string;
      read(): number[];
    }


    /** Provider 甲：手动记账。 */

    export const manualLedgerSource: LedgerSource = {
      sourceId: 'manual',
      read: () => [120, 80],
    };


    /** Provider 乙：自动记账。同契约、不同实现与不同数据。 */

    export const autoLedgerSource: LedgerSource = {
      sourceId: 'auto',
      read: () => [45, 55, 100],
    };


    /**
     * 蓝图对该接缝的缺失/失败裁决 = block：Provider 不在场必须显式失败，
     * 不得静默返回空结果冒充成功。
     */
    export const LEDGER_SOURCE_ABSENCE_SEMANTICS = 'block';


    export function resolveLedgerSource(source: LedgerSource | undefined):
    LedgerSource {
      if (!source) throw new Error('ledger_source_absent');
      return source;
    }
- path: src/ledger/LedgerIntakeBypass.ts
  content: |
    // 反例 Consumer：故意绕过接缝，直接依赖具体 Provider。
    // 只被 test/ledger/seam-bypass.case.ts 引用，用来证明绕过检查真的能判负——
    // 正链的 Consumer 是 LedgerIntakeConsumer.ts，本文件不参与任何 obligation。

    import { autoLedgerSource } from './LedgerSourceSeam';

    export function bypassingLedgerIntake(): number {
      return autoLedgerSource.read().reduce((sum, item) => sum + item, 0);
    }
- path: src/ledger/ClosureFixture.ts
  content: |
    export const componentClosureCombination = 'componentClosureCombination';
    export const alternateComponentClosure = 'alternateComponentClosure';

    export const fixtureSymbols = [
      'behavior',
      'owner',
      'consumer',
      'contract',
      'provider',
      'recovery',
      'refresh-behavior',
      'runtime-owner',
      'page-consumer',
      'source-contract',
      'repository-provider',
      'lifecycle-recovery',
      'ledger-refresh-vertical-slice',
      'ledger-consumer-ready',
      'ledger-recovery-ready',
      'ledger-summary-ready',
    ];
- path: test/ledger/closure.test.ts
  content: >
    // 宿主演进接缝（总纲 §11.3）的四项证明在本文件末尾——它们真的调用 src/ledger 的接缝，

    // 不是 return true 占位。其余 verify* 仍是夹具占位符（其真值由各自 obligation 的证据层承担）。

    import {
      LEDGER_SOURCE_ABSENCE_SEMANTICS,
      LedgerSource,
      autoLedgerSource,
      manualLedgerSource,
      resolveLedgerSource,
    } from '../../src/ledger/LedgerSourceSeam';

    import { ledgerIntake } from '../../src/ledger/LedgerIntakeConsumer';

    import { consumerAvoidsSeamBypass } from './seam-no-bypass-check';


    export function componentClosureCombination(): boolean { return true; }

    export function alternateComponentClosure(): boolean { return true; }

    export function verifyLedgerFlow(): boolean { return true; }

    export function verifyUserMutationTrigger(): boolean { return true; }

    export function verifyColdStartTrigger(): boolean { return true; }

    export function verifyInitialLoad(): boolean { return true; }

    export function verifyStateOwner(): boolean { return true; }

    export function verifyMutationPropagation(): boolean { return true; }

    export function verifyPublication(): boolean { return true; }

    export function verifySubscription(): boolean { return true; }

    export function verifyConsumerRefresh(): boolean { return true; }

    export function verifyRecovery(): boolean { return true; }

    export function verifyColdStartLifecycle(): boolean { return true; }

    export function verifyWarmResumeLifecycle(): boolean { return true; }

    export function verifyPageAttachLifecycle(): boolean { return true; }

    export function verifyPageDetachLifecycle(): boolean { return true; }

    export function verifyAccountSwitchLifecycle(): boolean { return true; }

    export function verifyProcessRecreationLifecycle(): boolean { return true; }

    export function verifySeamDecision(): boolean { return true; }

    export function verifyPreservedInvariant(): boolean { return true; }

    export function verifyChangeUnit(): boolean { return true; }

    export function verifySafeBuild(): boolean { return true; }

    export function verifySafeCompatibility(): boolean { return true; }

    export function verifySafeRecovery(): boolean { return true; }

    export function verifyTemporaryAsset(): boolean { return true; }

    export function proveSeamContractCompatibility(): boolean {
      // 两个 Provider 满足同一稳定契约，且同一个 Consumer 都能消费。
      const providers: LedgerSource[] = [manualLedgerSource, autoLedgerSource];
      return providers.every(provider =>
        typeof provider.sourceId === 'string' && provider.sourceId.length > 0
        && Array.isArray(provider.read())
        && typeof ledgerIntake(provider).total === 'number');
    }


    export function proveSeamProviderReplacement(): boolean {
      // 换 Provider 不改 Consumer：同一函数、同一结果形状，只有数据随实现变化。
      const first = ledgerIntake(manualLedgerSource);
      const second = ledgerIntake(autoLedgerSource);
      const sameShape = Object.keys(first).sort().join(',') === Object.keys(second).sort().join(',');
      return sameShape && first.sourceId !== second.sourceId && first.total > 0 && second.total > 0;
    }


    export function proveSeamAbsenceFailure(): boolean {
      // 蓝图裁决=block：Provider 缺席必须显式失败，不得静默成功。
      if (LEDGER_SOURCE_ABSENCE_SEMANTICS !== 'block') return false;
      try {
        resolveLedgerSource(undefined);
        return false;
      } catch (error) {
        return (error as Error).message === 'ledger_source_absent';
      }
    }


    export function proveSeamConsumerNoBypass(): boolean {
      // 真实 Consumer 只经契约取数；反例由 seam-bypass.case.ts 用同一把尺子判负。
      return consumerAvoidsSeamBypass('LedgerIntakeConsumer.ts');
    }



    export function verifiesComponentClosure(): boolean { return
    componentClosureCombination(); }
- path: test/ledger/seam-bypass.case.ts
  content: |
    // 绕过反例：用与正例完全相同的检查函数，对故意绕过接缝的 Consumer 求值——必须判负。
    //
    // 独立成文件是硬约束：component-closure.unit.test.ts 对 closure.test.ts 做命名空间导入，
    // 会把其中每个导出函数都执行并按返回值写进 ut/testing 证据链；把一个"恒返回 false"的导出
    // 放进去会当场打红正链。

    import { consumerAvoidsSeamBypass } from './seam-no-bypass-check';

    /** 正例 Consumer：不依赖具体 Provider → true。 */
    export function bypassCheckAcceptsCleanConsumer(): boolean {
      return consumerAvoidsSeamBypass('LedgerIntakeConsumer.ts');
    }

    /** 反例 Consumer：直接 import 了具体 Provider → false。 */
    export function bypassCheckRejectsBypassingConsumer(): boolean {
      return consumerAvoidsSeamBypass('LedgerIntakeBypass.ts');
    }

```

### (resolved input contracts)

```
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
source: derive.blueprint-contracts:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
version: "1"
modules:
  - name: ledger
    layer: 02-Feature
    format: HAR
    change_type: modify
    package_path: src/ledger
module_dependencies: {}
data_models: []
interfaces: []
components: []
files:
  - src/ledger/LedgerFeature.ets
change_unit:
  predicate_mappings:
    - predicate_id: refresh-behavior
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: runtime-owner
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: page-consumer
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: source-contract
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: repository-provider
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: lifecycle-recovery
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
  provide_mappings:
    - provide_id: ledger-refresh-vertical-slice
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
  design_ref_mappings:
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: logical
          id: ledger-domain
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: runtime
          id: ledger-repository
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: runtime
          id: ledger-store
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: flow
          view_id: runtime
          id: ledger-refresh-flow
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: development
          id: ledger-module
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: scenarios
          id: add-entry-scenario
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: relation
          id: repository-publishes-store
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: relation
          id: domain-owned-by-module
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: contract
          id: create-entry-v1
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: decision
          id: seam-shape
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
  change_unit_ref:
    artifact: change-unit@1
    component_id: ledger
    blueprint_id: ledger-app-blueprint
    change_unit_id: ledger-refresh
    revision: 1
    artifact_sha256: sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d
state_management:
  - data: ledger
    scope: component
    decorator: none
    holder: LedgerStore
    module: ledger
    owner_ref: view:runtime/node:ledger-repository
    contract_refs:
      - contract:create-entry-v1
    ordered_steps:
      - persist mutation
      - publish snapshot
      - refresh consumer
    lifecycle_triggers:
      - process_recreation
    failure_recovery:
      strategy: reload repository snapshot
    mutations:
      - mutation_id: add-entry
        kind: user
        publication_ref: publication:ledger-changed
        recovery_ref: recovery:reload-ledger
    publications:
      - publication_id: ledger-changed
    subscriptions:
      - subscription_id: ledger-page-subscription
        consumer_ref: consumer:ledger-page
        publication_ref: publication:ledger-changed
        replay_or_snapshot: latest
        cleanup: detach observer
    consumers:
      - consumer_id: ledger-page
        initial_load_ref: initial-load:repository-snapshot
        update_ref: publication:ledger-changed
    design_ref:
      artifact: component-blueprint@1
      component_id: ledger
      blueprint_id: ledger-app-blueprint
      revision: 2
      source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
      artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
      target:
        kind: flow
        view_id: runtime
        id: ledger-refresh-flow

```

### (resolved input acceptance)

```
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
source: derive.blueprint-acceptance:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
version: "1"
boundaries: []
criteria:
  - id: AC-1
    prd_function: null
    priority: P0
    description: refresh and recover
    testable: true
    verification_steps:
      - 新增一笔账目后观察账页与重启后的余额
    expected_result: consumer refreshed
    ut_layer: unit
    ut_focus: flow

```

### (resolved input use_cases)

```
schema_version: "2"
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
use_cases:
  - id: ledger-refresh
    coordinator: LedgerFeature.add
    ui_bindings:
      - ui: LedgerPage
        role: entry
        user_actions:
          - trigger: 点击新增账目
            calls: LedgerFeature.add
    state_model:
      phases:
        - start
        - done
    branches:
      - id: success
        scenario: persisted ledger snapshot is published to the consumer
        expected_phase_seq:
          - start
          - done
        linked_acceptance:
          - AC-1
source: derive.blueprint-contracts:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439

```

### (resolved artifact use-cases@1)

```
schema_version: "2"
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
use_cases:
  - id: ledger-refresh
    coordinator: LedgerFeature.add
    ui_bindings:
      - ui: LedgerPage
        role: entry
        user_actions:
          - trigger: 点击新增账目
            calls: LedgerFeature.add
    state_model:
      phases:
        - start
        - done
    branches:
      - id: success
        scenario: persisted ledger snapshot is published to the consumer
        expected_phase_seq:
          - start
          - done
        linked_acceptance:
          - AC-1
source: derive.blueprint-contracts:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439

```

### doc/features/ledger-app-blueprint/ledger-refresh/review/review-report.md

```
# 审查报告

> **模块标识**: ledger
> **审查日期**: 2026-01-01
> **审查版本**: 1.0
> **保证等级**: standard

## 1. 审查范围

模块：ledger。文件范围：

- src/ledger/LedgerFeature.ets
- src/ledger/LedgerIntakeConsumer.ts
- src/ledger/LedgerSourceSeam.ts
- src/ledger/LedgerIntakeBypass.ts
- src/ledger/ClosureFixture.ts
- test/ledger/closure.test.ts
- test/ledger/seam-bypass.case.ts

## 2. 审查维度

| 维度 | 结论 |
|------|------|
| 契约一致性 | 通过 |
| 视觉保真 | 不适用（无界面变更） |

## 3. 问题清单

| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |
|------|------|----------|----------|----------|----------|
| R-1 | 可读性 | MINOR | 方法缺少用途注释 | src/ledger/LedgerFeature.ets | 补充注释 |

## 4. 问题统计

| 严重程度 | 数量 |
|----------|------|
| BLOCKER | 0 |
| MAJOR | 0 |
| MINOR | 1 |

## 5. 修复建议

- R-1：下一次迭代补充注释，不阻断本次交付。

## 6. 结论

**审查结论**: 通过

```

### doc/features/ledger-app-blueprint/ledger-refresh/context/facts.md

```
---
schema_version: "1.1"
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
run_id: 20260925T043336Z-8e78e2
established_by: coding
ready_to_produce: true
has_blocker_coverage_risk: false
exploration_mode: sequential
key_inputs_read:
  - doc/glossary.yaml
  - doc/module-catalog.yaml
  - doc/architecture.md
subagents_used: none
decisions_unlocked:
  - ledger_refresh
files_inspected_count: 14
searches_performed_estimate: 10
source_code_paths:
  - src/ledger/LedgerFeature.ets
  - src/ledger/LedgerIntakeConsumer.ts
  - src/ledger/LedgerSourceSeam.ts
  - src/ledger/LedgerIntakeBypass.ts
  - src/ledger/ClosureFixture.ts
  - test/ledger/closure.test.ts
  - test/ledger/seam-bypass.case.ts
---

## Code Facts

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| src/ledger/LedgerFeature.ets | LedgerFeature.ets 已读 | 账目刷新沿用 |
| src/ledger/LedgerIntakeConsumer.ts | LedgerIntakeConsumer.ts 已读 | 账目刷新沿用 |
| src/ledger/LedgerSourceSeam.ts | LedgerSourceSeam.ts 已读 | 账目刷新沿用 |
| src/ledger/LedgerIntakeBypass.ts | LedgerIntakeBypass.ts 已读 | 账目刷新沿用 |
| src/ledger/ClosureFixture.ts | ClosureFixture.ts 已读 | 账目刷新沿用 |
| test/ledger/closure.test.ts | closure.test.ts 已读 | 账目刷新沿用 |
| test/ledger/seam-bypass.case.ts | seam-bypass.case.ts 已读 | 账目刷新沿用 |

## phase_delta: coding

本阶段研究结论已确认。

## phase_delta: review

本阶段研究结论已确认。

```

---

## 七、输出格式（必须严格遵循）

先给**汇总表**（每个检查项一行，PASS 也要列），再只对 **status ≠ PASS** 的项写 YAML 明细。
PASS 项不写论证，证据一行即可；证据不足时给 WARN 并说明缺什么，不要硬判 FAIL。
不要复述脚本 Harness 已判定的结构项，不要输出本节之外的自由文本。

本轮检查项与严重等级：

| id | severity |
|---|---|
| review_dimension_coverage | MAJOR |
| issue_accuracy | BLOCKER |
| fix_recommendation_actionable | MAJOR |
| false_positive_rate | MAJOR |
| blocker_threshold | BLOCKER |
| coding_rules_referenced | MINOR |
| reference_crosscheck | MAJOR |
| conventions_semantics | MAJOR |

### 7.1 汇总表

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| <check_id> | PASS / WARN / FAIL / SKIP | <severity> | <一行证据> |

### 7.2 非 PASS 项明细

```yaml
verification_result:
  phase: "review"
  feature: "cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g"
  timestamp: "2026-09-25T04:34:26.096Z"
  checks:            # 只列 status ≠ PASS 的项；每项字段固定
    - id: <check_id>
      status: FAIL | WARN | SKIP
      severity: <该项声明的 severity>
      details: |
        <证据：文件路径 + 行号/引文 + 判断依据>
      suggestion: |
        <修正建议：谁改、改哪个文件、改成什么>
  summary:
    total: 8
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（章节存在性、表格格式、严重程度值域等）
2. 若审查报告的问题清单为空（无问题），则检查 2/3/4 可标为 PASS 或 SKIP
3. 问题准确性验证（检查 2）要求你阅读实际源代码来验证问题是否真实存在
4. 对每一项检查，请给出**具体的代码/文档证据**（文件路径 + 关键引文），而非泛泛而谈
5. BLOCKER 与结论一致性（检查 5）是 BLOCKER 级别——结论必须与问题统计匹配
6. **报告终态 ≠ 产品裁决**（本节尤其适用于「本轮为产品失败诊断」请求）：终态块的 `blocker_count`
   只数**你自己这轮语义检查**中 severity=BLOCKER 且 status=FAIL 的项数，`verdict=PASS` 当且仅当它为 0。
   审查报告确认了 N 条产品缺陷、review 结论是「不通过」/「有条件通过」，**都不进这个计数**——
   报告准确且你自己无 BLOCKER FAIL 时正确终态就是 `PASS / 0`；产品的 FAIL 与 open 闭环状态由 harness 保持，
   不会因你判 PASS 而放行。反过来，把 confirmed 条数当 `blocker_count`、或为了"和产品一致"硬写 FAIL，
   会造出 `FAIL / 0`、`PASS / 非 0` 这类自相矛盾的无效证据，并让逐条 confirmed 派生的回修候选整批消失。

---

## 终态块（唯一版本化结论出口 · 必填）

> **你收到的 Task prompt 是一份 request JSON**（`kind: "maison_verifier_request"`），
> 不是本文件全文。按其中的 `prompt_path` 用 Read 工具读取磁盘上的 `ai-prompt.md`，
> 那才是本轮要审的材料（可达上百 KB，刻意不走传输面）。
>
> 结束时，回答的**最后**必须且只能出现一个终态块，`verifier_subject_id` **逐字回显**
> request 里的 `subject_id`（不得改写、不得截断、不得自行编造）：
>
> ```
> <!-- maison-verifier-result:v1 -->
> verifier_subject_id: <request.subject_id，64 位小写 hex>
> verdict: PASS | FAIL
> blocker_count: <BLOCKER 级 FAIL 数量，整数>
> <!-- /maison-verifier-result:v1 -->
> ```
>
> `verdict=PASS` 当且仅当 `blocker_count=0`；两者不一致的报告一律判为无效证据。
>
> 若你收到的**不是**这样一份 request JSON（例如被手抄成模板、只给了 feature/phase，
> 或 JSON 前后夹带了额外指令）：照常输出审查结论，并在正文显著位置说明
> 「未收到合法 verifier request，本次报告不可入闭环，请调用方把
> `summary.verifier_request` 指向的 JSON 整段重投」。**不要自行编造 subject。**

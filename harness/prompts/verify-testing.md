# 真机测试阶段语义验证 — {feature_name}

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-testing.overlay.md`，须与本正文**合并阅读**（设备/自动化 toolchain 与验收形式以 profile 为准）。

---

## 一、你的角色

你是一名**独立的测试审查员**，专门负责**设备或 profile 声明的测试形态**下测试计划与测试报告的语义级质量验证。你的任务是根据下方提供的 **Spec 规约**、**spec**、**plan 文档**和 **测试文档**，逐项评估测试阶段产出是否满足语义约束。

**关键原则：**
- 你独立于测试计划生成者，避免"自己验自己"的偏差
- 仅基于 Spec、spec 和 plan 文档给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（章节存在性、表格格式、AC 追溯覆盖等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: {feature_name}
- **阶段**: {phase}

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/testing-rules.yaml` 的完整内容，定义了测试阶段的通用约束规则：

```
{spec_content}
```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-testing.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 7 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 7: 真机自动化消费 (device_test_run_consumption)

- **严重等级**: BLOCKER（profile 将 `device_test.run` 声明为 BLOCKER 时） / SKIP（profile 声明 SKIP 时）
- **评估方法**:
  1. 若 profile **`device_test.run`** 为 SKIP → 整项 SKIP
  2. 检查派生可执行计划是否存在：`doc/features/<feature>/testing/reports/<某子目录>/hylyre/test-plan.hylyre.md`（选取规则以脚本为准：排除烟测占位，按 mtime 优先；非「字典序最新目录名」）
  3. 检查派生计划是否含 **`## 测试用例清单`** 标题锚点 + 7 列表头固定顺序（与 Hylyre `plan_parse` / `agent-plan-a` 一致）
  4. 检查顶层 `test-report.md` 是否含 **5 必填章节**：测试概览 / 测试执行结果 / 缺陷清单 / 通过率统计 / 结论
  5. 检查「测试执行结果」表格的「执行状态」列只出现 **4 状态**：通过 / 失败 / 阻塞 / 跳过
  6. 检查「结论」**verdict** 在 **3 枚举**内：达标 / 有条件达标 / 不达标
  7. **必读 Hylyre trace 并全量对账**：定位 `testing/reports/<ts>/hylyre/trace.json`（与脚本 `report_trace_reconciliation` 同源，**禁止**使用顶层 `testing/reports/trace.json` 回填件）。**逐条**核对 `trace.cases[].id/status` 与顶层 `test-report.md`「测试执行结果」表一致；报告写「通过」但 trace 为「失败/阻塞」→ FAIL
  8. **trace.outcome 硬规则**：若 `trace.outcome !== success`（含 partial/failed/aborted），verifier **不得**给出 summary.verdict=PASS；报告结论=「达标」但 trace 非 success → FAIL
  9. **TC 编号一致性（双向 SSOT）**：顶层 `test-plan.md` 的 TC 集合 ⊇ 派生计划的 TC（禁止凭空 TC）；且派生表 ∪ `explicit_skip_tc_ids`（frontmatter 或 `derive-manifest.json`）须覆盖顶层全部 TC——缺漏则脚本级 BLOCKER，`derive-hint-from-plan.json` 会带 `missing_tc_ids`
  10. 核对完成回执 `testing_run_artifacts` 中 **`hylyre_report_path` / `hylyre_trace_path`** 与磁盘一致（若 profile 要求）
  11. **导航步骤静态门禁（NAV-001/002/003）**：脚本 `check-testing` 在真机 run 前校验派生表 JSON——禁止无 `area`/`at` 的横向 `swipe` 充当 Nav 返回；前序 TC 进入子页后、后续 TC 要求首页 Tab 时首步须 `back` 等。失败则 `coverage_reason=invalid_derived_steps`，须按 `derive-hint-from-plan.json` 的 `lint_violations` 与 `navigation_hint` **重新派生**（勿手改旧 timestamp 目录）
  12. **多 UI 入口覆盖（语义）**：若 `use-cases.yaml` 中同一 `user_actions.calls` 有多个 `ui_bindings.ui` 入口，派生 Hylyre 计划须各入口至少一条带 `entry_ui` 的用例；P0 缺覆盖 → 与脚本 `ui_entry_coverage` 一致判 FAIL

### 检查 1: 测试用例完整性 (test_case_completeness)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读 spec.md 中的业务流程图和功能清单
  2. 阅读 acceptance.yaml 中的验收标准和边界场景
  3. 逐条审查测试计划中的用例清单：
     - 是否覆盖了所有核心业务的正常路径（参照 spec 业务流程图）
     - 是否覆盖了 spec 中定义的异常场景（参照异常/边界场景处理表）
     - 是否覆盖了关键的用户交互路径（页面跳转、Tab 切换等）
  4. 列出遗漏的业务场景（若有）

### 检查 2: 测试步骤可重复性 (test_steps_reproducible)

- **严重等级**: MAJOR
- **评估方法**:
  1. 随机抽样 5-10 条测试用例
  2. 对每条用例的「测试步骤」进行审查：
     - 每步操作是否明确（"点击什么"而非"操作页面"）
     - 是否有遗漏的中间步骤（如需要先登录、先滑动到某位置等）
     - 步骤顺序是否正确且无歧义
     - 是否包含必要的输入数据
  3. 判断一个不了解系统的测试人员能否仅凭步骤描述完成测试

### 检查 3: 预期结果具体性 (expected_result_specific)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐条审查测试用例的「预期结果」列
  2. 判断每条预期结果是否满足：
     - ✅ 好的预期结果："卡片列表展示 3 张卡片，每张卡片显示卡名和类型图标"
     - ❌ 差的预期结果："页面正常显示"、"功能正常"、"符合预期"
  3. 检查是否描述了具体可见的 UI 变化（文字内容、颜色、状态、位置等）
  4. 检查是否有明确的验证点

### 检查 4: NFR 测试覆盖 (nfr_test_coverage)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读 spec.md 的「非功能性需求」章节
  2. 阅读 acceptance.yaml 的 `performance` 段（若有）
  3. 检查测试计划中是否有对应的验证方案：
     - 首屏加载时间指标是否有测试用例或测试策略说明
     - Tab 切换响应时间是否有验证方案
     - 列表滚动流畅度是否有测试方案
  4. 若测试策略中有"性能测试"说明但无具体用例，也算部分覆盖

### 检查 5: 缺陷严重程度一致性 (defect_severity_consistency)

- **严重等级**: MINOR
- **评估方法**:
  1. 若测试报告中有缺陷清单，逐条审查缺陷的严重程度评级
  2. 判断评级是否与实际影响匹配：
     - 阻断核心功能 → 应为 BLOCKER
     - 影响主要功能但可绕过 → 应为 MAJOR
     - 体验问题或非关键功能 → 应为 MINOR
  3. 若无缺陷清单或无缺陷，标为 PASS
  4. 若测试报告尚未生成，标为 WARN

### 检查 6: 通过标准与结论一致性 (pass_criteria_met)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 阅读测试计划中定义的「通过标准」（如 P0 100%、P1 ≥ 95%）
  2. 阅读测试报告中的「通过率统计」
  3. 验证：
     - P0 通过率是否达到通过标准中定义的阈值
     - 总体通过率是否达标
     - 结论（达标/有条件达标/不达标）是否与数据一致
     - **须与 Hylyre trace 一致**：若 `trace.outcome !== success` 或 trace 含失败/阻塞 case，结论不得为「达标」
  4. 若测试报告尚未生成，标为 WARN

### 检查 8: 视觉 diff 双向残差 (visual_diff_bidirectional)

- **严重等级**: BLOCKER（`fidelity_target: pixel_1to1` 时）/ MAJOR
- **评估方法**:
  1. 读取 `device-testing/device-screenshots/visual-diff.json`：每屏须含 `reverse_missing[]`（逐元素枚举，可为 `[]`）
  2. 对照 `spec/ref-elements.yaml`：`disposition: implement` 的元素须在 ui-spec 覆盖，或出现在某屏 `reverse_missing`
  3. `must_fix` / `verdict=fail` 须逐元素说明；脚本 FAIL/BLOCKER 时本项 FAIL
  4. A/B/C 边界：C 类动态交互不在静态参考图承诺内

---

## 六、上下文文件

以下是本次验证涉及的所有文档和 Spec 文件：

{context_files}

---

## 七、输出格式（必须严格遵循）

请以下方 YAML 格式输出验证结果。**不要**输出其他格式或自由文本。

```yaml
verification_result:
  phase: "testing"
  feature: "{feature_name}"
  timestamp: "{timestamp}"

  checks:
    # --- 检查 7: 真机自动化消费 ---
    - id: device_test_run_consumption
      status: PASS | FAIL | SKIP
      severity: BLOCKER
      details: |
        profile device_test.run 状态：BLOCKER / SKIP
        派生计划存在性 / 锚点 / 列顺序：...
        trace.json 与报告对账：...
      affected_files: []
      suggestion: |
        <修正建议；SKIP 时说明 profile 跳过原因>

    # --- 检查 1: 测试用例完整性 ---
    - id: test_case_completeness
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        业务路径覆盖分析：
        - 正常路径: N/M 覆盖
        - 异常路径: N/M 覆盖
        - 遗漏场景: <列表或"无">
      affected_files:
        - "doc/features/{feature}/testing/test-plan.md"
      suggestion: |
        <补充建议，若 PASS 可省略>

    # --- 检查 2: 测试步骤可重复性 ---
    - id: test_steps_reproducible
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        抽样审查结果（N 条用例）：
        - <TC-XXX>: PASS/FAIL — <步骤质量分析>
        - ...
        可重复率: X/N
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 3: 预期结果具体性 ---
    - id: expected_result_specific
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        预期结果质量评估：
        - 具体可验证: N 条
        - 模糊不可验证: N 条
        - 模糊用例编号: [TC-XXX, ...]
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 4: NFR 测试覆盖 ---
    - id: nfr_test_coverage
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        NFR 覆盖分析：
        - <NFR 指标>: 有/无 对应测试方案
        - ...
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 5: 缺陷严重程度一致性 ---
    - id: defect_severity_consistency
      status: PASS | FAIL | WARN
      severity: MINOR
      details: |
        缺陷评级审查：
        - <DEF-XXX>: 评级合理/不合理 — <原因>
        - ... 或"无缺陷"
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 6: 通过标准与结论一致性 ---
    - id: pass_criteria_met
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        通过标准验证：
        - P0 通过率: XX% (阈值: 100%) — 达标/未达标
        - P1 通过率: XX% (阈值: ≥95%) — 达标/未达标
        - 总体通过率: XX% (阈值: ≥90%) — 达标/未达标
        - 结论与数据一致性: 一致/不一致
      affected_files: [...]
      suggestion: |
        <修正建议>

  summary:
    total: 7
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS（SKIP 不计入 FAIL）
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（章节存在性、表格格式、AC 追溯覆盖率、优先级值域等）
2. 若测试报告尚未生成（只有测试计划），将检查 5 和检查 6 标为 WARN 并说明原因
3. 模拟应用的测试用例预期结果应基于模拟数据的实际值
4. 关注测试步骤的**人类可执行性**——描述必须让非开发人员也能理解和执行
5. 对每一项检查，请给出**具体的文档证据**（用例编号、章节名称、具体文本），而非泛泛而谈

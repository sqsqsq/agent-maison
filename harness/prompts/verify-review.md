# Review 阶段语义验证 — {feature_name}

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-review.overlay.md`，须与本正文**合并阅读**（代码形态与审查侧重点以 profile 为准）。

---

## 一、你的角色

你是一名**独立的审查报告审核员**，专门负责评估 Code Review 报告本身的质量。你的任务是根据下方提供的 **Spec 规约**、**源代码**和**审查报告**，逐项评估审查报告是否全面、准确、可操作。

**关键原则：**
- 你独立于报告编写者，避免"自己验自己"的偏差
- 仅基于 Spec 规则和实际代码给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（章节存在性、表格格式、严重程度值域等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: {feature_name}
- **阶段**: {phase}

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/review-rules.yaml` 的完整内容，定义了 Review 阶段的通用约束规则：

```
{spec_content}
```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-review.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 7 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: 审查维度覆盖度 (review_dimension_coverage)

- **严重等级**: MAJOR
- **评估方法**:
  1. 审查报告的「审查方法」章节是否声明了以下维度：
     - 五层架构合规性
     - 模块内四层分层
     - 接口一致性（vs design.md / contracts.yaml）
     - 资源引用完整性
     - 命名规范
     - 异常处理（vs acceptance.yaml）
     - PRD 功能覆盖
  2. 问题清单中是否有来自上述各维度的检查结果
  3. 若某个关键维度完全未审查（未在方法中声明且问题清单无相关分类），标为 FAIL
  4. 特别关注：架构分层和 design.md 一致性是否被充分审查

### 检查 2: 问题准确性 (issue_accuracy)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 从问题清单中**抽样** 5-10 条问题（优先选择 BLOCKER 和 MAJOR 级别）
  2. 对每条抽样问题：
     a. 验证「涉及文件」路径是否在上下文源代码中存在
     b. 验证「问题描述」是否与实际代码匹配——阅读对应源代码，确认问题确实存在
     c. 验证「严重程度」评级是否合理（对照 review-rules.yaml 中的分级标准）
  3. 若发现某条问题是误报（代码实际上是正确的但被标记为问题），标记为误报
  4. 误报率计算：误报数 / 抽样数
     - 误报率 ≤ 10%: PASS
     - 误报率 10%-30%: WARN
     - 误报率 > 30%: FAIL

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
     - "资源引用" → resource_integrity
     - "命名规范" → naming_conventions
     - "硬编码" → no_hardcoded_strings
     - "逻辑错误" → business_logic_correctness
     - "异常处理" → error_handling_completeness
  4. 追溯率 ≥ 70%: PASS；< 70%: WARN

### 检查 7: 探索覆盖充分性 (context_exploration_sufficiency)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 读取 `doc/features/{feature_name}/review/context-exploration.md`（schema 1.1.0）
  2. 对照审查范围与 contracts：`source_code_paths`、`Code Facts` 是否覆盖被审源码
  3. 探索与结论范围明显不匹配 → FAIL

### 检查 8: 行为合规 — 研究有据 (behavior_research_grounded)

- **严重等级**: BLOCKER
- **评估方法**: 问题清单中的代码引用是否真实；未读代码即下结论 → FAIL

### 检查 9: 行为合规 — 最小可行 (behavior_minimum_viable)

- **严重等级**: MAJOR
- **评估方法**: 是否提出超出本次变更范围的「顺手改进」→ FAIL

### 检查 10: 行为合规 — 追溯闭环 (behavior_verify_loop)

- **严重等级**: MAJOR
- **评估方法**: 问题 ↔ coding-rules ↔ contracts 追溯是否断链 → FAIL

### 检查 11: 行为合规 — Scope 精准 (behavior_scope_surgical)

- **严重等级**: BLOCKER
- **评估方法**: 审查是否局限于本次 feature diff；评 unrelated 预存问题为 BLOCKER 且无依据 → FAIL

---

## 六、上下文文件

以下是本次验证涉及的所有文档和源代码文件：

{context_files}

---

## 七、输出格式（必须严格遵循）

请以下方 YAML 格式输出验证结果。**不要**输出其他格式或自由文本。

```yaml
verification_result:
  phase: "review"
  feature: "{feature_name}"
  timestamp: "{timestamp}"

  checks:
    # --- 检查 1: 审查维度覆盖度 ---
    - id: review_dimension_coverage
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        各维度覆盖情况：
        - 五层架构合规性: 已覆盖/未覆盖
        - 模块内四层分层: 已覆盖/未覆盖
        - 接口一致性: 已覆盖/未覆盖
        - 资源引用完整性: 已覆盖/未覆盖
        - 命名规范: 已覆盖/未覆盖
        - 异常处理: 已覆盖/未覆盖
        - PRD 功能覆盖: 已覆盖/未覆盖
        覆盖率: X/7
      suggestion: |
        <修正建议，若 PASS 可省略>

    # --- 检查 2: 问题准确性 ---
    - id: issue_accuracy
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        抽样验证结果（N 条）：
        - CR-XXX: PASS/误报 — <验证详情>
        - CR-YYY: PASS/误报 — <验证详情>
        - ...
        误报率: X/N (XX%)
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 3: 修复建议可操作性 ---
    - id: fix_recommendation_actionable
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        可操作性评估：
        - 具体可操作: X 条
        - 模糊不可操作: Y 条
        可操作率: X/(X+Y) (XX%)
        不可操作示例：
        - CR-XXX: "<修复建议内容>" — 缺少具体文件/方法
      suggestion: |
        <修正建议>

    # --- 检查 4: 误报率 ---
    - id: false_positive_rate
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐条验证结果：
        - CR-XXX: 正确/误报 — <原因>
        - CR-YYY: 正确/误报 — <原因>
        - ...
        误报数: X  总数: N  误报率: XX%
      suggestion: |
        <修正建议>

    # --- 检查 5: BLOCKER 与结论一致性 ---
    - id: blocker_threshold
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        BLOCKER 数量: N
        MAJOR 数量: N
        报告结论: "通过/有条件通过/不通过"
        一致性: 一致/不一致 — <原因>
        BLOCKER 级别合理性：
        - CR-XXX (BLOCKER): 合理/过高 — <原因>
      suggestion: |
        <修正建议>

    # --- 检查 6: 编码规则追溯 ---
    - id: coding_rules_referenced
      status: PASS | FAIL | WARN
      severity: MINOR
      details: |
        分类追溯结果：
        - "分层违规" (N条) → coding-rules: layer_compliance
        - "接口不一致" (N条) → coding-rules: interface_signature_consistency
        - ...
        追溯率: X/N (XX%)
      suggestion: |
        <修正建议>

    # --- 检查 7: 探索覆盖充分性 ---
    - id: context_exploration_sufficiency
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        context-exploration.md: <路径>
        摘要与审查范围/问题涉及文件的一致性: PASS/FAIL — <证据>
        source_code_paths / Code Facts: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_research_grounded
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        问题引用 ↔ 实际源码: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_minimum_viable
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        超出 diff 的改进建议: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_verify_loop
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        问题 ↔ rules/contracts: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_scope_surgical
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        审查范围 ↔ 本次 diff: PASS/FAIL
      suggestion: |
        <修正建议>

  summary:
    total: 11
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

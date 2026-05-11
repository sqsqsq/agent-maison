# PRD 阶段语义验证 — {feature_name}

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-prd.overlay.md`，须与本正文**合并阅读**（宿主产品形态、UI/交付术语以 profile 为准）。

---

## 一、你的角色

你是一名**独立的 PRD 审查员**，专门负责**当前工程类型（由 `project_profile` 与实例 Spec 界定）**下的产品需求文档质量验证。你的任务是根据下方提供的 **Spec 规约**和 **PRD 文档**，逐项评估 PRD 是否满足语义约束。

**关键原则：**
- 你独立于文档编写者，避免"自己验自己"的偏差
- 仅基于 Spec 规则给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（章节存在性、表格格式、优先级合法性等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: {feature_name}
- **阶段**: {phase}

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/prd-rules.yaml` 的完整内容，定义了 PRD 阶段的通用约束规则：

```
{spec_content}
```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-prd.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下语义检查项。每项都有具体的评估方法和判定标准（以 merged phase-rules 是否包含对应条目为准；overlay -only 项见 profile 的 `verify-prd.overlay.md`）。

### 检查 1: 功能概述清晰度 (overview_clarity)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读「功能概述」章节
  2. 判断是否满足：
     - 一句话概括模块的核心价值（不超过 50 字为宜）
     - 包含目标用户或使用场景的暗示
     - 不使用空泛词汇（如"xxx 功能"、"相关能力"等）
  3. 若概述过于冗长或使用列举方式而非总结性描述，视为质量不足

### 检查 2: 使用场景具体性 (user_scenario_specificity)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读「目标用户与使用场景」章节
  2. 对每个使用场景检查是否包含：
     - 具体的用户角色（非泛化的"用户"）
     - 明确的操作目标（用户想要完成什么）
     - 前置条件（触发该场景需要什么条件）
  3. 检查场景覆盖度：是否覆盖了主要使用路径

### 检查 3: 功能描述可执行性 (feature_description_actionable)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐条阅读功能清单表中每项的「描述」列
  2. 判断每条描述是否足够具体，让开发人员无歧义地理解需要实现什么
  3. 不允许仅有抽象描述（如"支持 xxx 功能"而没有说明具体行为）
  4. 若某功能的 UI 交互、数据来源、结果预期均不明确，判为 FAIL

### 检查 4: 验收标准可测试性 (acceptance_testable)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 逐条审查验收标准中的每条 AC 项
  2. 判断每条 AC 是否满足：
     - 包含明确的操作步骤或前置条件
     - 包含可观察的预期结果（如"显示xxx"、"跳转到xxx"）
     - 可以通过手动或自动化方式验证
  3. "暂不支持"类功能的 AC，只要指明"弹出 Toast"即视为可测试
  4. 若 AC 仅有定性描述（如"用户体验好"）而无量化标准，判为 FAIL

### 检查 5: 宿主 UI 框架术语 (ui_component_terminology)

- **严重等级**: 以 merged `prd-rules.yaml`（含 profile overlay）中本检查项声明为准；未声明时 **SKIP**
- **评估方法**:
  1. 在上方 Spec 的 `semantic_checks` 中查找是否存在 `ui_component_terminology`
  2. **若不存在**：`status: SKIP`，`details` 写明「当前 profile 未注册此项」
  3. **若存在**：按该条的 `description` / `ai_prompt_hint` 执行；并合并阅读 profile 的 `verify-prd.overlay.md`（若存在）中的补充说明

### 检查 6: 模拟范围意识 (simulation_scope_awareness)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读功能清单和界面描述，识别所有依赖真实后端的功能点
     （如支付、银行接口、账号验证、数据存储等）
  2. 检查每个此类功能点是否已标注为"模拟数据"或"写死数据"
  3. 若存在未标注模拟策略的真实后端依赖，判为 FAIL
  4. 若所有功能均已明确标注数据来源（本地写死/模拟/真实），判为 PASS

### 检查 7: 业务流程分支覆盖 (business_flow_branch_coverage)

- **严重等级**: MAJOR
- **评估方法**:
  1. 审查「业务流程图」中的 Mermaid 流程图
  2. 检查：
     - 是否涵盖了主路径（正常使用流程）
     - 是否包含至少一条异常/分支路径（如操作失败、空状态等）
     - 流程图节点是否与功能清单中的功能点对应
  3. 对比功能清单 P0 功能，确认关键路径均在流程图中体现

### 检查 8: 使用场景到页面追溯 (scenario_to_page)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读「目标用户与使用场景」中描述的每个用户操作
  2. 在「页面/界面描述」中查找承载该操作的 UI 组件
  3. 对每个场景给出追溯结果：
     - 哪个用户操作对应哪个页面的哪个组件
     - 是否存在场景中描述的操作在界面中找不到承载组件的情况

### 检查 9: Visual Handoff 与版面权威 (visual_handoff_semantics)

- **严重等级**: MAJOR（与脚本 `check-prd` 互补：脚本校验结构；你校验语义一致性）
- **何时可跳过语义核对**：脚本报告已 SKIP Visual Handoff（`enforcement=off` 或 `--skip-visual-handoff`）时，本检查标注 SKIP。
- **评估方法**:
  1. 读取 PRD 中带根字段 `ui_change` 的 yaml 块（若脚本已 PASS/WARN Visual Handoff，以此为准）。
  2. 若 `ui_change` ∈ {`new_or_changed`, `copy_edits_only`}：
     - `authoritative_refs` 是否与「页面/界面描述」的区域划分大致对应（可追溯）？
     - 正文是否仍写「仅以当前实现为基线」等与 handoff 矛盾之语？若矛盾 → FAIL 或 WARN。
  3. 若使用 `repo_assets` / `screenshot_pack`：对照脚本报告可能的 **Resolved Visual Sources**／`visual_resolution_rows`：`path` 是否为全分辨率真源或等价导出目录语义（而非聊天缩略图）？若 `agent_reachable=false`，正文是否给出**人工/NAS**可复验的批次、版本或与内门户截图的对照说明？
  4. 若使用 URL 类 `kind`：是否仍说明版本/帧/归档批次，避免「只有一个泛链接」导致无法对齐？内网门户若不可直连，是否在正文声明**可达代理**或可下载快照的策略？

---

## 六、上下文文件

以下是本次验证涉及的文档：

{context_files}

---

## 七、输出格式（必须严格遵循）

请以下方 YAML 格式输出验证结果。**不要**输出其他格式或自由文本。

```yaml
verification_result:
  phase: "prd"
  feature: "{feature_name}"
  timestamp: "{timestamp}"

  checks:
    # --- 检查 1: 功能概述清晰度 ---
    - id: overview_clarity
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        <功能概述是否简洁明确，是否包含核心价值描述>
      suggestion: |
        <修正建议，若 PASS 可省略>

    # --- 检查 2: 使用场景具体性 ---
    - id: user_scenario_specificity
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐场景检查结果：
        - S1: PASS/FAIL — 用户角色/操作目标/前置条件...
        - S2: PASS/FAIL — ...
      suggestion: |
        <修正建议>

    # --- 检查 3: 功能描述可执行性 ---
    - id: feature_description_actionable
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐功能检查结果：
        - F1: PASS/FAIL — ...
        - F2: PASS/FAIL — ...
      suggestion: |
        <修正建议>

    # --- 检查 4: 验收标准可测试性 ---
    - id: acceptance_testable
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        逐条 AC 检查结果：
        - AC-1: PASS/FAIL — 是否包含操作步骤/预期结果...
        - AC-2: PASS/FAIL — ...
        可测试率: X/N
      suggestion: |
        <修正建议>

    # --- 检查 5: 宿主 UI 框架术语（仅当 spec 含 ui_component_terminology） ---
    - id: ui_component_terminology
      status: PASS | FAIL | WARN | SKIP
      severity: MINOR
      details: |
        <SKIP 时写明未注册；否则给出证据>
      suggestion: |
        <修正建议>

    # --- 检查 6: 模拟范围意识 ---
    - id: simulation_scope_awareness
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        依赖后端的功能点及其模拟标注情况：
        - <功能>: PASS/FAIL — 是否标注模拟策略...
      suggestion: |
        <修正建议>

    # --- 检查 7: 业务流程分支覆盖 ---
    - id: business_flow_branch_coverage
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        主路径覆盖: PASS/FAIL
        异常路径覆盖: PASS/FAIL
        功能点对应: X/N 功能在流程图中有节点
      suggestion: |
        <修正建议>

    # --- 检查 8: 使用场景到页面追溯 ---
    - id: scenario_to_page
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐场景追溯结果：
        - S1: PASS/FAIL — 操作 → 页面/组件
        - S2: PASS/FAIL — ...
      suggestion: |
        <修正建议>

    # --- 检查 9: Visual Handoff 语义 ---
    - id: visual_handoff_semantics
      status: PASS | FAIL | WARN | SKIP
      severity: MAJOR
      details: |
        <ui_change 与版面描述是否一致；是否与「以当前实现为基线」等矛盾>
      suggestion: |
        <修正建议>

  summary:
    total: 9
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（章节存在性、表格格式、优先级值域等）
2. 若 PRD 文档缺少某个章节导致无法进行语义检查，将该检查标为 WARN 并说明原因
3. 对于模拟阶段的 PRD，"暂不支持"功能点只要明确标注了 Toast 行为即视为描述充分
4. 对每一项检查，请给出**具体的文档证据**（章节名 + 关键引文），而非泛泛而谈
5. 重点关注 P0 功能的验收标准可测试性（检查 4 是 BLOCKER 级别）

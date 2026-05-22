# Coding 阶段语义验证 — {feature_name}

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-coding.overlay.md`，须与本正文**合并阅读**（宿主 toolchain 细则）。

## 一、你的角色

你是一名**独立的代码审查员**，专门负责宿主工程源代码的语义级质量验证。源码形态、组件模型与 toolchain 以 **`project_profile` 与 profile overlay** 为准；中性原则是对齐 Spec 与设计契约。你的任务是根据下方提供的 **Spec 规约**、**设计文档**和**源代码**，逐项评估编码阶段产出是否满足语义约束。

**关键原则：**
- 你独立于代码生成者，避免"自己验自己"的偏差
- 仅基于 Spec 和设计文档给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（文件存在性、分层合规、资源引用等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: {feature_name}
- **阶段**: {phase}

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/coding-rules.yaml` 的完整内容，定义了编码阶段的通用约束规则：

```
{spec_content}
```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-coding.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断（例如：若脚本报告某些文件缺失，你的语义验证也应考虑这一缺失的影响）：

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 8 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: 业务逻辑正确性 (business_logic_correctness)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读 design.md 中的服务层接口定义（Repository 方法签名及其语义）
  2. 阅读对应的 Repository 实现代码，验证：
     - 方法返回值是否符合设计描述（数据格式、数量约束）
     - 模拟数据是否覆盖了设计中要求的场景
  3. 阅读 design.md 中的组件树结构
  4. 阅读对应的页面/组件代码，验证：
     - 组件层级是否与组件树一致
     - 页面间跳转逻辑是否与导航设计一致
  5. 检查状态管理是否使用了设计指定的装饰器（@State / @Prop / @Link / @Provide / @Consume）

### 检查 2: 异常处理完整性 (error_handling_completeness)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从上下文文件中的 acceptance.yaml 的 `boundaries` 章节提取**所有**异常场景（BD-1 至 BD-N）
  2. 逐条读取每个 BD 项的 `scenario`、`handling`、`expected_behavior` 字段
  3. 在源代码中查找对应的处理逻辑，判断代码是否满足 `handling` 描述的处理方式和 `expected_behavior` 描述的预期行为
  4. 对每条 BD 给出 PASS / FAIL / WARN 判定
  5. 注意：处理方式可以是显式的 try/catch、条件分支、空状态 UI，或通过架构设计隐式保证（如本地写死数据天然免疫网络异常）

### 检查 3: 接口签名一致性 (interface_signature_consistency)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 从 contracts.yaml 的 `interfaces` 章节提取所有 class/method 定义
  2. 逐一对比实际代码中的实现：
     - 类名是否一致
     - 方法名是否一致
     - 参数列表（名称 + 类型）是否一致
     - 返回类型是否一致
     - async 标记是否一致
  3. 从 contracts.yaml 的 `data_models` 章节提取所有数据模型定义
  4. 逐一对比实际代码：
     - 字段名、类型、是否必填
     - enum 值是否一致
  5. 标出每一处不一致的具体差异

### 检查 4: 组件 Props 一致性 (component_props_consistency)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 contracts.yaml 的 `components` 章节提取每个组件的：
     - `state` 定义（@State 变量列表）
     - `props` 定义（@Prop 变量列表）
     - `events` 定义（回调事件列表）
  2. 对比实际代码中的装饰器声明：
     - @State 变量是否与设计一致
     - @Prop 变量是否与设计一致
     - 事件回调是否实现
  3. 检查父组件传递给子组件的 Props 是否类型匹配

### 检查 5: 数据所有权合规 (data_ownership_compliance)

- **严重等级**: MAJOR
- **评估方法**:
  1. 审查 presentation 层代码（pages/ 与 components/ 下的宿主实现文件）
  2. 检查是否存在以下违规行为：
     - 直接操作 AppStorage 写入业务数据（读取全局状态可以，但写入业务数据应通过 Repository）
     - 直接构造模拟数据（模拟数据应封装在 Repository 层）
     - 直接操作数据库或文件系统
  3. 正常模式：presentation 通过 Repository/Service 获取数据，通过状态装饰器管理 UI 状态

### 检查 6: 模拟数据隔离 (simulation_data_isolation)

- **严重等级**: MINOR
- **评估方法**:
  1. 检查 data/repository/ 下的 Repository 文件，确认模拟数据封装在内部
  2. 检查 presentation 层代码是否感知数据来源（如判断 `isMock`、读取模拟标记等）
  3. 理想状态：将来替换为真实 API 时，只需修改 Repository 内部实现，presentation 层无需变更

### 检查 7: PRD 验收标准覆盖 (prd_acceptance_to_code)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 acceptance.yaml 的 `criteria` 章节提取所有 P0 和 P1 验收标准（AC-1 至 AC-N）
  2. 逐条审查代码中是否有对应的功能实现：
     - AC 描述的 UI 元素是否在代码中存在
     - AC 描述的交互行为是否有对应事件处理
     - AC 描述的数据约束是否在代码中体现
  3. 对每条 AC 给出 PASS / FAIL / WARN 判定
  4. 对 P2 的 AC 项，若未实现标注为 WARN（非 FAIL）

### 检查 8: 探索覆盖充分性 (context_exploration_sufficiency)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 读取 `doc/features/{feature_name}/coding/context-exploration.md`（schema 1.1.0）
  2. 对照 contracts、acceptance、design：`source_code_paths`、`Code Facts` 是否覆盖实际改动文件
  3. 探索文件缺失且脚本已 FAIL → 本项 FAIL

### 检查 9: 行为合规 — 研究有据 (behavior_research_grounded)

- **严重等级**: BLOCKER
- **评估方法**: 实现是否能在 Code Facts 中找到依据；凭空虚构 API/路径 → FAIL

### 检查 10: 行为合规 — 最小可行 (behavior_minimum_viable)

- **严重等级**: MAJOR
- **评估方法**: 是否实现 contracts 未声明的符号或投机抽象 → FAIL

### 检查 11: 行为合规 — 追溯闭环 (behavior_verify_loop)

- **严重等级**: MAJOR
- **评估方法**: contracts ↔ 源码 ↔ acceptance 是否断链 → FAIL

### 检查 12: 行为合规 — Scope 精准 (behavior_scope_surgical)

- **严重等级**: BLOCKER
- **评估方法**: git diff / 变更是否超出 design scope 与 contracts 文件清单 → FAIL

---

## 六、上下文文件

以下是本次验证涉及的所有文档和源代码文件：

{context_files}

---

## 七、输出格式（必须严格遵循）

请以下方 YAML 格式输出验证结果。**不要**输出其他格式或自由文本。

```yaml
verification_result:
  phase: "coding"
  feature: "{feature_name}"
  timestamp: "{timestamp}"

  checks:
    # --- 检查 1: 业务逻辑正确性 ---
    - id: business_logic_correctness
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        <你的具体发现，包括哪些业务逻辑正确/不正确>
      affected_files:
        - "path/to/implementation-file"
      suggestion: |
        <修正建议，若 PASS 可省略>

    # --- 检查 2: 异常处理完整性 ---
    - id: error_handling_completeness
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐条列出每个边界场景的检查结果：
        - BD-X (<scenario>): PASS/FAIL — 原因...
        - BD-Y (<scenario>): PASS/FAIL — 原因...
        - ... (覆盖 acceptance.yaml boundaries 中的所有 BD 项)
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 3: 接口签名一致性 ---
    - id: interface_signature_consistency
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        逐类逐方法对比结果：
        - <ClassName>.<methodName>: PASS/FAIL — ...
        - ... (覆盖 contracts.yaml interfaces 中的所有 class/method)
        数据模型对比：
        - <ModelName>: PASS/FAIL — ...
        - ... (覆盖 contracts.yaml data_models 中的所有模型)
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 4: 组件 Props 一致性 ---
    - id: component_props_consistency
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐组件对比 @State/@Prop/事件：
        - <ComponentName>: PASS/FAIL — ...
        - ... (覆盖 contracts.yaml components 中定义了 state/props/events 的所有组件)
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 5: 数据所有权合规 ---
    - id: data_ownership_compliance
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        <是否发现 presentation 层绕过 Repository 直接操作数据的情况>
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 6: 模拟数据隔离 ---
    - id: simulation_data_isolation
      status: PASS | FAIL | WARN
      severity: MINOR
      details: |
        <模拟数据封装情况，上层是否与数据来源解耦>
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 7: PRD 验收标准覆盖 ---
    - id: prd_acceptance_to_code
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐条验收标准覆盖情况：
        - <AC-id> (<description 摘要>): PASS/FAIL — ...
        - ... (覆盖 acceptance.yaml criteria 中的所有 AC 项)
        P0 覆盖率: X/N
        P1 覆盖率: X/N
        P2 覆盖率: X/N
      affected_files: [...]
      suggestion: |
        <修正建议>

    # --- 检查 8: 探索覆盖充分性 ---
    - id: context_exploration_sufficiency
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        context-exploration.md: <路径>
        摘要与 contracts/实现/跨模块导出的一致性: PASS/FAIL — <证据>
        source_code_paths / Code Facts: PASS/FAIL
      affected_files:
        - "doc/features/{feature_name}/coding/context-exploration.md"
      suggestion: |
        <修正建议>

    - id: behavior_research_grounded
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        Code Facts ↔ 实现决策: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_minimum_viable
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        超 contracts 投机实现: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_verify_loop
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        contracts ↔ code ↔ acceptance: PASS/FAIL
      suggestion: |
        <修正建议>

    - id: behavior_scope_surgical
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        diff 超出 design scope/contracts: PASS/FAIL
      suggestion: |
        <修正建议>

  summary:
    total: 12
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（文件存在性、分层合规、资源引用等）
2. 若源代码文件缺失导致无法进行某项语义检查，将该检查标为 WARN 并说明原因
3. 对于"暂不支持"类的占位功能，只要 Toast 正确弹出即视为 PASS
4. 模拟阶段的数据正确性要求：写死数据的格式和数量需满足 contracts.yaml 中的约束，但不要求真实 API 调用
5. 对每一项检查，请给出**具体的代码证据**（文件路径 + 关键代码行），而非泛泛而谈

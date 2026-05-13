# Design 阶段语义验证 — {feature_name}

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-design.overlay.md`，须与本正文**合并阅读**。

---

## 一、你的角色

你是一名**独立的技术设计审查员**，负责对技术设计文档做语义级质量验证。宿主分层、模块格式与实现语言以 **`project_profile` + `doc/architecture.md` + `framework.config.json > architecture`** 为准；细则可对照本阶段 profile 的 `verify-design.overlay.md`。你的任务是根据下方提供的 **Spec 规约**、**设计文档**和 **PRD**，逐项评估设计文档是否满足语义约束。

**关键原则：**
- 你独立于文档编写者，避免"自己验自己"的偏差
- 仅基于 Spec 规则和 PRD 需求给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（章节存在性、表格格式、映射覆盖率等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: {feature_name}
- **阶段**: {phase}

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/design-rules.yaml` 的完整内容，定义了设计阶段的通用约束规则：

```
{spec_content}
```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-design.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 10 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: 五层架构合规性 (five_layer_compliance)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 阅读模块架构图中的 Mermaid 图和模块变更摘要表
  2. 逐个模块检查是否在正确的架构层：
     - 01-Product：应用/产品壳层主入口（模块格式以 catalog 与设计为准）
     - 02-Feature：特性层功能模块（可含业务 UI 与数据）
     - 03-CommonBusiness：跨 Feature 共享的业务能力
     - 04-BusinessBase：基础业务能力（账号、鉴权与外部结算能力等）
     - 05-SystemBase：与业务无关的基础工具（UI 组件、工具类）
  3. 检查依赖方向是否全部自上而下（01→02→03→04→05），不允许逆向依赖
  4. 检查 Feature 子层级是否合理（如 02-Feature 内部模块不应互相依赖）

### 检查 2: 模块内四层合规性 (module_internal_layer_compliance)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 逐个文件检查其路径是否符合 shared/data/domain/presentation 四层规则：
     - `shared/`：常量、工具、公共组件
     - `data/model/`：数据模型定义
     - `data/repository/`：数据仓库（模拟数据封装）
     - `domain/service/`：领域服务
     - `presentation/pages/`：页面
     - `presentation/components/`：UI 组件
  2. 重点检查：
     - 模型类是否放在 data/model 而非 presentation
     - Repository 是否放在 data/repository 而非 domain
     - 页面是否放在 presentation/pages 而非根目录

### 检查 3: 模块最小性 (module_minimality)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐个审查新增模块，确认每个模块都有 PRD 功能点直接驱动
  2. 检查「不创建的模块」章节是否合理解释了排除原因
  3. 若存在没有 PRD 功能引用的新增模块，判为 FAIL
  4. 若 03-CommonBusiness 层创建了模块但无跨 Feature 共享需求，判为 FAIL

### 检查 4: 功能拆分合理性 (feature_split_accuracy)

- **严重等级**: MAJOR
- **评估方法**:
  1. 逐条审查 PRD 功能映射表中的「分配模块」列
  2. 判断每个功能点是否分配到了职责最匹配的模块：
     - 账号相关 → AccountManager
     - 通用 UI 组件 → CommUI
     - 工具能力（日志、格式化）→ CommFunc
     - 页面 UI 和业务逻辑 → Feature 层对应模块
  3. 若功能拆分存在明显的职责混乱（如业务逻辑放在 SystemBase 层），判为 FAIL

### 检查 5: 数据类型合法性 (data_type_legality)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 审查「数据模型定义」中所有代码块里的字段类型
  2. 确认都是**当前宿主/设计约定**的合法类型（禁止无依据的 `any`、松散 `object`）：
     - 基础类型：string、number、boolean（及宿主等价物）
     - 平台类型：由 profile/设计声明的资源、样式、国际化等类型（若有）
     - 集合类型：Array、Map 或宿主等价集合
     - 自定义枚举：在文档中有定义
     - 可空标记：文档中与宿主一致的联合/可空写法（如 `Type | null`）
  3. 不允许使用 `any`、`object`（无约束）、或未定义的自造类型
  4. 若发现非法类型，逐一列出

### 检查 6: P0/P1 无未决项 (no_tbd_in_p0_p1)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 在设计文档全文中搜索以下标记：
     - "待定"、"TBD"、"TODO"、"待确认"、"待补充"、"后续"
  2. 对找到的每处标记，判断其是否在 P0/P1 功能的上下文中
  3. P0/P1 范围内存在任何未决标记，判为 FAIL
  4. P2 或附录中的未决标记可标为 WARN

### 检查 7: 架构文档一致性 (architecture_doc_consistency)

- **严重等级**: MAJOR
- **前置条件**: 先读取 design.md「架构影响声明 (architecture_impact)」子节中的 yaml，获取 `impact` 字段
- **评估方法**:
  1. **若 `impact == none`** —— 直接返回 `status: NOT_APPLICABLE`（在 YAML 中使用 `status: PASS` 并在 details 注明"architecture_impact=none，feature 级变更不要求与 architecture.md 对齐"），**不再**做任何对比
  2. **若 `impact != none`**：
     - 对比 design.md 中的「分层归属（外层 id）」、「跨模块依赖边」、「出口约定（`architecture.cross_module_exports_file` 声明的文件名）」与 `doc/architecture.md` 及 `framework.config.json > architecture` 是否一致
     - **不要**比对业务模块清单的行级细节（该职责已由 `doc/module-catalog.yaml` 承担）
     - 对照 design.md「架构影响声明.architecture_md_updates」列出的每一条，核查相应更新是否已在 architecture.md 中落盘（业务模块清单行、架构级变更记录条目、分层/依赖/出口章节等）
     - 若分层 / 依赖边 / 出口约定存在不一致且未在 design 中说明差异原因，判为 FAIL
     - 若 `architecture_md_updates` 中声明的更新未在 architecture.md 中找到对应落盘证据，判为 FAIL
  3. 若 architecture.md 不在上下文文件中，标为 WARN

### 检查 8: 导航流程一致性 (navigation_flow_consistency)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 design.md 的「路由/导航设计」中提取页面跳转路径
  2. 从 PRD 的「业务流程图」中提取业务操作流转
  3. 对比：
     - PRD 中每条跳转路径是否在导航设计中有对应配置
     - 导航设计中的返回路径是否与 PRD 流程一致
     - 路由设计中的目标页 / 路由项是否覆盖 PRD 流程中的每条跳转（宿主导航 API 以 `project_profile` 为准；补充语义见同目录 `verify-design.overlay.md`，由 profile 挂载）
  4. 若存在 PRD 流程图中的路径在导航设计中缺失，判为 FAIL

### 检查 9: 验收标准到接口追溯 (acceptance_to_interface)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 PRD 的验收标准中提取涉及数据展示/操作的 AC 项
  2. 对每条 AC，在 design.md 中查找支撑实现的：
     - 数据模型（是否有对应字段来存储 AC 描述的数据）
     - 接口方法（是否有方法来获取/操作 AC 描述的数据）
     - 组件定义（是否有 UI 组件来展示 AC 描述的内容）
  3. 对每条 P0 AC 给出追溯结果
  4. 若 P0 AC 在设计中找不到任何支撑，判为 FAIL

### 检查 10: 探索覆盖充分性 (context_exploration_sufficiency)

- **严重等级**: MAJOR（与脚本 Harness 互补：`check-design` 校验探索凭证与最低 `key_inputs_read`；你负责判断摘要是否**实质上**支撑设计决策）
- **评估方法**:
  1. 读取 `doc/features/{feature_name}/design/context-exploration.md`
  2. 对照 PRD、acceptance、architecture、`framework.config.json`、module-catalog 及 design 中的 contracts/导航/模块变更：摘要中的检索与 `decisions_unlocked` 是否覆盖**真正影响分层、依赖边、接口签名**的阅读证据
  3. 若设计涉及多模块或大量 contracts 但摘要无对应代码/文档检索痕迹，或 `coverage_risks` 与已知交叉影响矛盾 → FAIL
  4. subagent/并行探索与 SKILL 触发条件严重不符且复杂度已显然越阈 → WARN 或 FAIL
  5. 探索文件缺失且脚本已 FAIL → 本项 FAIL；证据不足 → WARN

---

## 六、上下文文件

以下是本次验证涉及的所有文档：

{context_files}

---

## 七、输出格式（必须严格遵循）

请以下方 YAML 格式输出验证结果。**不要**输出其他格式或自由文本。

```yaml
verification_result:
  phase: "design"
  feature: "{feature_name}"
  timestamp: "{timestamp}"

  checks:
    # --- 检查 1: 五层架构合规性 ---
    - id: five_layer_compliance
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        逐模块检查结果：
        - <模块名> (层): PASS/FAIL — ...
        依赖方向检查: PASS/FAIL
      suggestion: |
        <修正建议，若 PASS 可省略>

    # --- 检查 2: 模块内四层合规性 ---
    - id: module_internal_layer_compliance
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        逐模块文件路径检查：
        - <模块名>: PASS/FAIL — <违规文件路径（如有）>
      suggestion: |
        <修正建议>

    # --- 检查 3: 模块最小性 ---
    - id: module_minimality
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐模块必要性检查：
        - <模块名>: PASS/FAIL — PRD 驱动的功能点...
      suggestion: |
        <修正建议>

    # --- 检查 4: 功能拆分合理性 ---
    - id: feature_split_accuracy
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐功能拆分检查：
        - F1 → <模块>: PASS/FAIL — 职责匹配...
        - F2 → <模块>: PASS/FAIL — ...
      suggestion: |
        <修正建议>

    # --- 检查 5: 数据类型合法性 ---
    - id: data_type_legality
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        逐模型字段类型检查：
        - <ModelName>.<field>: <type> — PASS/FAIL
      suggestion: |
        <修正建议>

    # --- 检查 6: P0/P1 无未决项 ---
    - id: no_tbd_in_p0_p1
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        TBD/待定标记搜索结果：
        - 第 X 行: "<上下文>" — P0/P1/P2 范围
      suggestion: |
        <修正建议>

    # --- 检查 7: 架构文档一致性 ---
    - id: architecture_doc_consistency
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        architecture_impact: <none | dsl_change | module_set_change | responsibility_rewrite>
        # impact == none 时：status=PASS，details 仅写 "NOT_APPLICABLE — feature 级变更"
        # impact != none 时：
        一致性对比：
        - 分层归属: PASS/FAIL — <不一致之处>
        - 跨模块依赖边: PASS/FAIL — <不一致之处>
        - 出口约定 (cross_module_exports_file): PASS/FAIL — <不一致之处>
        architecture_md_updates 落盘核查：
        - <update 条目 1>: PASS/FAIL — <在 architecture.md 第 X 节找到 / 未找到>
        - <update 条目 2>: PASS/FAIL — ...
      suggestion: |
        <修正建议>

    # --- 检查 8: 导航流程一致性 ---
    - id: navigation_flow_consistency
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        PRD 流程 → 导航设计 追溯：
        - <路径>: PASS/FAIL — ...
      suggestion: |
        <修正建议>

    # --- 检查 9: 验收标准到接口追溯 ---
    - id: acceptance_to_interface
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        逐 AC 追溯结果（P0/P1）：
        - AC-1: PASS/FAIL — 模型: <>, 接口: <>, 组件: <>
        - AC-2: PASS/FAIL — ...
        P0 追溯覆盖率: X/N
      suggestion: |
        <修正建议>

    # --- 检查 10: 探索覆盖充分性 ---
    - id: context_exploration_sufficiency
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        context-exploration.md: <路径>
        摘要与设计/配置/PRD 决策可追溯性: PASS/FAIL — <证据>
        多模块或 contracts 复杂度与探索深度是否匹配: PASS/FAIL/WARN
      suggestion: |
        <修正建议>

  summary:
    total: 10
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（章节存在性、表格列完整性、PRD 覆盖率等）
2. 若设计文档缺少某个章节导致无法进行语义检查，将该检查标为 WARN 并说明原因
3. 本项目为模拟应用，数据全部写死——对"模拟数据"的类型合法性检查应适度宽容
4. 对每一项检查，请给出**具体的文档证据**（章节名 + 关键引文 / 文件路径），而非泛泛而谈
5. 五层架构和四层规则是 BLOCKER 级别，严格审查依赖方向和文件放置位置

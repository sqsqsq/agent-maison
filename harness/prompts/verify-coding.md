# Coding 阶段语义验证 — {feature_name}

**当前独核资格与结果边界**：只消费机器实际签发的当前 request/material，phase 只选择检查方法。有「本轮为独立问题诊断」一节时，按具体对象和原报告逐条核实；证据缺口记为未知，其他可核实的问题继续验证。独核终态只表示本次语义核实，产品 FAIL 和缺失执行由共同完成处置保留。补核保留原目标、完整拒修论据和相关反证，按本轮实证判断。

实施边界：以原始需求及有效更正中的真实限制、公共接口/数据契约和阶段职责为准。files、预计模块、私有名字/位置不是逐项许可；合法重组不要求创建空壳或回签预测。必须看实际 diff（含新增、删除、重命名）及必要源码，核对自然语言中的明确禁止；预测外模块的必要性、影响与回归依据在报告中显著披露。真实越权、公共契约违约或漏实现仍 FAIL，不能靠披露或登记齐全放行。

核对本次承诺的测试层级与生产入口一致：UT 驱动可隔离的真实业务状态/异常；UI、焦点和导航栈交设备。both 的两层互补，不要求 UT 实例化 UI，也不能只测 helper 冒充流程通过。L3 候选回原责任方；option_a 不批准降低当前验收。仅核当前材料，不新增一轮设计或额外门禁。

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-coding.overlay.md`，须与本正文**合并阅读**（宿主 toolchain 细则）。

## 一、你的角色

现代调用以附带的 resolved 输入及 binding 为对照：目标、契约、验收和真实源码；蓝图派生内容与物化输入等价，不因没有 spec.md/plan.md 降级。CU 的 design_refs、state_management runtime 链、组件资产选型须逐项对照真实实现。仅在输入确含叙述文档时检查其章节；缺必需契约或实现超出授权须 FAIL 并归因到设计责任方，经既有回退重签处理。

你是一名**独立的代码审查员**，专门负责宿主工程源代码的语义级质量验证。源码形态、组件模型与 toolchain 以 **`project_profile` 与 profile overlay** 为准；中性原则是对齐 Spec 与设计契约。你的任务是根据下方提供的 **Spec 规约**、**设计文档**和**源代码**，逐项评估编码阶段产出是否满足语义约束。

**关键原则：**
- 你独立于代码生成者，避免"自己验自己"的偏差
- 仅基于 Spec 和设计文档给出客观判定，不做主观偏好评价
- 脚本 Harness 已完成了确定性的结构检查（文件存在性、分层合规、资源引用等），你负责**脚本无法覆盖的语义级检查**
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 真实编译依据

先读取第四节的 `coding_compile`（旧名 `coding_hvigor_build`）与 `coding_run_status`，以及同轮 `summary.json` 的 `run_statuses`（可读时）。直接消费机器的编译状态和 `can_claim_done`，脚本投影中的 `passed_check_ids` 表示对应检查已 PASS。旧报告的 `coding_compile_gate` 仍可读取，本轮不另列该项、不重复判分。

机器报告编译 FAIL、BLOCKER SKIP 或 `can_claim_done: NO` 时，产品完成条件仍未满足，即使编译失败发生在其他模块。相关诊断中引用机器给出的第一条编译错误（路径、行号和消息）、`failure_kind` 及同轮 `summary.next_action`（如有），继续核实已签发对象的具体业务、断言和真实责任方。缺编译证据标明缺口。独核 PASS 不产生编译 PASS，也不改变产品完成处置。

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

### 检查 1: 业务逻辑正确性 (business_logic_correctness)

- **严重等级**: MAJOR
- **评估方法**:
  1. 阅读 plan.md 中的服务层接口定义（Repository 方法签名及其语义）
  2. 阅读对应的 Repository 实现代码，验证：
     - 方法返回值是否符合设计描述（数据格式、数量约束）
     - 模拟数据是否覆盖了设计中要求的场景
  3. 阅读 plan.md 中的组件树结构
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
     - 参数类型、顺序和必选性是否符合公共调用契约；按名消费的参数名也须一致
     - 返回类型是否一致
     - async 标记是否一致
  3. 从 contracts.yaml 的 `data_models` 章节提取所有数据模型定义
  4. 逐一对比实际代码：
     - 字段名、类型、是否必填
     - enum 值是否一致
  5. 只按位置调用、类型与顺序一致的形参改名，记录对齐差异，不要求产品返工。判 BLOCKER 时指出真实受影响的调用或契约、定位及放过的后果。

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

### 检查 7: spec 验收标准覆盖 (spec_acceptance_to_code)

- **严重等级**: MAJOR
- **评估方法**:
  1. 从 acceptance.yaml 的 `criteria` 章节提取所有 P0 和 P1 验收标准（AC-1 至 AC-N）
  2. 逐条审查代码中是否有对应的功能实现：
     - AC 描述的 UI 元素是否在代码中存在
     - AC 描述的交互行为是否有对应事件处理
     - AC 描述的数据约束是否在代码中体现
  3. 对每条 AC 给出 PASS / FAIL / WARN 判定
  4. 对 P2 的 AC 项，若未实现标注为 WARN（非 FAIL）

### 检查 14: 视觉背板语义 (visual_parity_backstop)

- **严重等级**: BLOCKER（硬像素契约：`fidelity_target: pixel_1to1` **且** `acceptance_strictness: hard`，以 `spec/reports/fidelity-intent.json` 的 `effective_fidelity` / `acceptance_strictness` 为准）/ 否则 MAJOR（**软档**下自报的样式残差走视觉债务披露、不驱动回退，但仍阻断发布；不要因这类残差把本项判 BLOCKER 或要求回退）
- **评估方法**:
  1. ui-spec 带 `color_ref`/`semantic_role` 的节点是否在 **visual-parity.yaml 有 ui_spec_node_id→contract_component 映射**
  2. 映射 struct 源码是否引用对应 `$r('app.color.*')`（组件级，非 feature 全局有一处即可）
  3. `must_have_elements` 是否在组件树或 string/源码可见；脚本 `visual_parity` FAIL → 本项 FAIL

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 逐条核对本阶段产物里的跨文件引用——代码引用的接口签名、常量、资源 ID、路由 ↔ contracts.yaml / ui-spec.yaml / 资源文件；spec 验收标准编号 ↔ 代码注释或测试锚点。每条引用都要打开被引用的原文核对，不凭记忆、不凭上下文摘要。
- **判定标准**: 引用对象存在且含义一致 → PASS；个别引用漂移（行号/名称过期但对象仍可定位） → WARN；关键引用指向不存在或含义相反的对象 → FAIL
- **证据**: 列出核对过的引用（`引用 → 原文位置`）与不一致项


---

## 六、上下文文件

以下是本次验证的上下文：被审产物与直接依据内联；上游文档与源码只给**路径清单**，需要核对时用 Read 按路径读取，不要全量通读。

被审 feature 根目录：`{features_dir}/{feature_name}/`（相对仓根；下方清单里的相对路径同样相对仓根）。

{context_files}

---

## 七、输出格式（必须严格遵循）

先给**汇总表**（每个检查项一行，PASS 也要列），再只对 **status ≠ PASS** 的项写 YAML 明细。
PASS 项不写论证，证据一行即可；证据不足时给 WARN 并说明缺什么，不要硬判 FAIL。
不要复述脚本 Harness 已判定的结构项，不要输出本节之外的自由文本。

本轮检查项与严重等级：

| id | severity |
|---|---|
| business_logic_correctness | MAJOR |
| error_handling_completeness | MAJOR |
| interface_signature_consistency | BLOCKER |
| component_props_consistency | MAJOR |
| data_ownership_compliance | MAJOR |
| simulation_data_isolation | MINOR |
| spec_acceptance_to_code | MAJOR |
| reference_crosscheck | MAJOR |
| visual_parity_backstop | BLOCKER（硬像素契约 pixel_1to1 ∧ hard）/ MAJOR（其余档位） |
| visual_multimodal_parity | MAJOR |

### 7.1 汇总表

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| <check_id> | PASS / WARN / FAIL / SKIP | <severity> | <一行证据> |

### 7.2 非 PASS 项明细

```yaml
verification_result:
  phase: "coding"
  feature: "{feature_name}"
  timestamp: "{timestamp}"
  checks:            # 只列 status ≠ PASS 的项；每项字段固定
    - id: <check_id>
      status: FAIL | WARN | SKIP
      severity: <该项声明的 severity>
      details: |
        <证据：文件路径 + 行号/引文 + 判断依据>
      suggestion: |
        <修正建议：谁改、改哪个文件、改成什么>
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

## 七-b、多模态视觉对照（ui_change=new_or_changed 时 · MAJOR）

> **Verifier 必须是多模态模型**（强 VL：Composer / Claude 等）。纯文本 verifier 对本节标 SKIP 并在 summary 注明降级。

当 spec 声明 `ui_change: new_or_changed` 且上下文含 **原图 + ui-spec.yaml** 时，额外执行：

### 检查 N: 视觉多模态 parity (visual_multimodal_parity)

- **严重等级**: MAJOR
- **评估方法**:
  1. **用读图工具**逐个读取本轮提示清单明确列出的 sidecar 像素文件。目录中的历史图片不属于本轮；Markdown 链接不能作为已读图证据。
  2. 打开 ui-spec.yaml，对照实现代码与资源，逐区域报告：版面结构 / 品牌主题色 / 真实资产 vs 占位 / 文案逐字保真
  3. ui-spec `verified=unverified` 时：仅报告明显冲突，不宣称整体保真 PASS
- **读图证据块（必填，可机读）**：结论中须含 fenced `read-image-evidence` 块，每条 `- file: <sidecar文件名>` + `observation: <关键观察>`（与 sidecar 清单一一对应）
- **证据**: 按屏列出 must-fix 项（若有）

若 adapter `image_input=none` 或上下文无图片注入：本检查 **SKIP**，details 写「视觉多模态层已降级（adapter 不支持图像）」。

若 adapter 为 `tool_read` 但未输出合规读图证据块：本检查 **WARN**，details 写「未取得读图证据，多模态降级（区别于 adapter 不支持）」。

---

## 八、注意事项

1. 编译与 `can_claim_done` 采用本轮机器结果。终态块只数本轮语义 BLOCKER FAIL。
2. **不要重复脚本 Harness 已覆盖的检查**（文件存在性、分层合规、资源引用等）
3. 若源代码文件缺失导致无法进行某项语义检查，将该检查标为 WARN 并说明原因
4. 对于"暂不支持"类的占位功能，只要 Toast 正确弹出即视为 PASS
5. 模拟阶段的数据正确性要求：写死数据的格式和数量需满足 contracts.yaml 中的约束，但不要求真实 API 调用
6. 对每一项检查，请给出**具体的代码证据**（文件路径 + 关键代码行），而非泛泛而谈

---

## 终态块（唯一版本化结论出口 · 必填）

若材料含 coding 可选上游问题表，逐条读取其责任产物和当前证据（含编译日志），用原 `issue-verification` fenced 块输出 `- issue: <原ID>`、`verdict: confirmed|refuted|unclear`、`evidence: <责任文件名 + 材料给出的完整问题/依据＋修复建议原文 + 实际判断依据>`。缺证据、只是实现/资源漏写、错误甩锅须 refuted/unclear；不要求编造 review 结论。owner 的拒修理由须一起看；事实拒修按材料中的 `repair_candidate:<指纹>` 逐条核实，evidence 包含完整依据。蓝图/CU/DSL 归设计 owner，源码和日志只是证据。无提案不补空表。

> 运行时可在原 request JSON 前附已签复核范围。按 JSON（`kind: "maison_verifier_request"`）
> 内的 `prompt_path` 读取本轮磁盘材料 `ai-prompt.md`。
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
> request 字段须保持原样。缺合法 JSON（例如仅有 feature/phase 或字段被改）时仍输出审查结论，
> 明示报告不可采信，请运行时重新投递 `summary.verifier_request` 原件。**不要自行编造 subject。**


具名入口核实：`named_business_handler` PASS 只证明所有 calls 声明可定位。Page 方法可承接 UI 事件；unit/both 验收的倒计时、重发门禁等必须有无需 UI runtime 的真实可驱动业务入口。真实 NavPathStack/UI/手势留设备测试；缺接缝沿现有 testability/设计 owner 链核实修复，不能用静态名字或辅助函数测试代签业务可测性。

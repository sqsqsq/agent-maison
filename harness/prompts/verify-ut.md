# 业务级 UT 阶段语义验证 — {feature_name}（v2.1 · UseCase 去代码化）

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。

---

## 一、你的角色

你是一名**独立的测试审查员**，专门负责业务级单元测试（UT）的语义级质量验证。
你的任务是根据下方提供的 **Spec 规约**、**use-cases.yaml**（若存在）、**DAG 文件**、**业务编排源代码**（coordinator / Page 命名方法 / Flow 类 / 导出函数，代码形态由 Skill 3 自选）与 **UT 代码**，逐项评估 UT 阶段产出是否满足 v2.1 的语义约束。

**v2.1 关键原则（与 v2 的差异）：**
- `UseCase` 不再强制为代码中的类，而是 `use-cases.yaml` 中的**规约 / 导航图**：`coordinator`（指向真实代码里的类/方法/函数）、`ui_bindings`（UI↔业务入口映射）、`data_boundaries`（引用 `contracts.yaml` 已登记的 data 层类，而非新造 Port 接口）
- **不再校验 `domain/usecase/*.ets`、`Port` 接口、UseCase 类纯净度**等代码形态硬规则
- UT 作为**既有代码的消费者**：直接调用 `ui_bindings.user_actions.calls` 声明的**命名函数**（Page 方法 / Flow 方法 / 导出函数），在 `data_boundaries` 处打桩
- **UI 层仍绝对禁止进入 UT**（`@Component` / `struct` / `NavPathStack` / `showToast` / `$r` / `$rawfile` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics` 等）

**审查方针：**
- 你独立于 UT 生成者，避免"自己验自己"的偏差
- 仅基于 Spec 与代码给出客观判定，不做主观偏好评价
- 脚本 Harness (`check-ut.ts`) 已完成了所有**确定性检查**（schema / 无环 / 禁用符号扫描 / 标签格式 / 覆盖计数 / boundary 匹配 / named_business_handler 等），你负责**脚本无法覆盖的语义级检查**
- **不要**重新给出"应该新造 Port 接口 / UseCase 类"之类的建议——这是 v2.1 明确否定的反模式
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 二、功能模块

- **模块名称**: {feature_name}
- **阶段**: {phase}

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/ut-rules.yaml` 的完整内容，定义了 UT 阶段的通用约束规则：

```
{spec_content}
```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-ut.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 7 项 v2.1 语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: state_model 完备性 (state_model_completeness)

- **严重等级**: MAJOR
- **前置**：若 `doc/features/{feature_name}/use-cases.yaml` 不存在，整项 SKIP（本 feature 不满足复杂度阈值即可豁免）
- **评估方法**:
  1. 读取每个 UseCase 的 `state_model.phases` 与 `state_model.fields`
  2. 对比 PRD.md / design.md 中的流程图与状态机描述
  3. 逐个分支审查 `branches[].expected_phase_sequence`：
     - 是否存在"多个分支共用一个过载态"（例如校验失败和短验失败都映射到 Failed 而未用 errorCode 区分）——可接受但需要 errorCode 字段扩展
     - 是否缺少必要的中间态（如 WaitingSms / Persisting / Verifying）
     - 终态是否区分清晰（Success / Failed 应单独存在）
  4. 检查 `expected_phase_sequence` 列出的所有 phase 是否都在 `state_model.phases` 集合内

- **输出**：每个 UseCase 的 `state_model` 质量 + 漏态列表

### 检查 2: ui_bindings 完整性 (ui_bindings_completeness) 【替代旧的 port_abstraction_quality】

- **严重等级**: MAJOR
- **前置**：若 `use-cases.yaml` 不存在，整项 SKIP
- **评估方法**:
  1. 列出 PRD.md / design.md 中涉及本 use_case 的**所有 UI 节点**（页面、弹窗、组件），对比 `ui_bindings[]`：
     - 每个参与此业务流程的 UI 是否都有条目（`role` 是否合理标注 entry/progress/dialog/result/passive）
     - `subscribes` 是否与 `state_model.phases` / `state_model.fields` 对齐（不应订阅不存在的字段）
  2. 每个 `user_actions[].calls` 是否指向**真实存在的命名函数**（由 `named_business_handler` 已做结构性检查；你补充语义判断：命名是否表达业务意图，而非 `onClick1`/`handler` 之类空词）
  3. 检查是否存在**应有未有的 UI 绑定**：例如短验弹框肯定需要 `confirmSms` 这类入口
  4. `data_boundaries` 是否覆盖业务流涉及的所有外部依赖（云端 / 本地持久化 / 系统服务）；是否混入了不属于数据边界的东西（UI、路由、toast 不应进入 data_boundaries）

- **输出**：ui_bindings 完整度评分 + 缺失/冗余条目

### 检查 3: 端到端驱动真实性 (end_to_end_driving) 【BLOCKER】

- **严重等级**: **BLOCKER**
- **评估方法**:
  1. 对每个 `it()` 用例，检查下面三项是否同时成立：
     - **命名入口驱动**：用例通过调用 `ui_bindings.user_actions.calls` 声明的命名函数（或 `coordinator` 的方法）驱动业务，而不是直接构造一个数据对象、绕过业务编排检查 Repository
     - **callLog / 调用序列断言**：对 data_boundary 替身（`SpyXxx` / `FakeXxx` / `StubXxx` / 原型替换）的 `callLog` 或 `called*` 计数断言至少出现 1 次
     - **状态多阶段断言**：对业务状态字段（`phase` / `errorCode` / 业务 model 的关键字段）做 `expect` 至少 2 次，且覆盖**中间态与终态**
  2. 对比对应 branch 的 `expected_phase_sequence` 与 `expected_port_calls` / `not_called`：UT 的断言是否与之一致
  3. 若 `use-cases.yaml` 不存在：退化判定——用例必须至少调用一个**真实业务函数**（而非仅 `expect(repo.getX().length).assertLargerThan(0)` 的单数据接口断言）
  4. 判定逻辑：
     - 三项全部成立 → PASS
     - 任一项不成立 → FAIL（BLOCKER）
     - 信息不足 → WARN

- **反例**：`expect((await cardRepo.getCardList()).length).assertLargerThan(0)`（未驱动 coordinator/命名函数，单数据接口断言）→ FAIL

### 检查 4: branch 语义覆盖 (branch_coverage_semantic)

- **严重等级**: MAJOR
- **前置**：若 `use-cases.yaml` 不存在，整项 SKIP
- **评估方法**:
  1. 阅读 PRD.md 中的"异常场景"清单，或 design.md 的 Mermaid 状态机
  2. 列出所有应测异常：`network_failure` / `validate_fail` / `auth_fail` / `sms_fail` / `persist_fail` / `user_cancel` / `timeout` / `insufficient_resource` 等
  3. 对比 `use-cases.yaml > branches[]` 是否覆盖了这些异常：
     - 覆盖 → 记录已覆盖分支
     - 遗漏 → 列出 gap，建议新增 branch id 与 linked_acceptance
  4. 还要检查 happy_path 是否唯一（是否有重复分支只是 mock 值不同）

- **输出**：已覆盖/遗漏异常表 + 建议新增 branches

### 检查 5: device AC 委派一致性 (device_ac_delegation)

- **严重等级**: MAJOR
- **评估方法**:
  1. 找到 `acceptance.yaml` 中所有 `ut_layer ∈ {device, both}` 的 AC/BD
  2. 检查 `doc/features/{feature_name}/device-testing-todo.md` 是否存在，且每条 device/both AC 都有对应条目（通过 AC id 引用即可）
  3. 若该文件缺失 → 判定 WARN 并给出最小模板建议
  4. 若文件存在但遗漏某 AC → 判定 FAIL 并列出遗漏项
  5. 检查 `both` AC：UT 侧是否已经覆盖了可在 UT 验证的语义部分（state / data_boundary / 业务数据），真机侧是否覆盖了 UI 层
  6. 参考 DAG 中 `ui_subscription` 节点（仅文档/真机 todo 用，UT 忽略）是否已翻译为 device-testing-todo 条目

- **输出**：缺失委派条目 + 模板片段

### 检查 6: 打桩合理性 (stub_reasonableness) 【替代旧的 mock_reasonableness】

- **严重等级**: MAJOR
- **评估方法**:
  1. 审查 data_boundary 替身（`SpyXxx` / `FakeXxx` / `StubXxx` / `Xxx.prototype.method = ...`）：
     - 预设返回值的字段是否与 `data/model` 的定义吻合（字段名、类型、必填项）
     - 错误路径的 `fail(code)` / `throws(err)` 是否匹配业务代码中处理的错误码（可通过 grep 业务源码找到 `ERROR_CODE` 字符串比对）
     - 值域是否合理（如金额不能为负、cardId 非空）
  2. 检查 Spy 自身**不含业务判断**（Spy 内部不能写 `if (input.x) throw ...`，业务判断要在 coordinator 或 Page 方法里）
  3. 检查 Spy 是否漏实现了 data_boundary 的某些方法（实现类型 = `use-cases.yaml > data_boundaries[].methods`）
  4. 若采用"原型方法替换"而非子类化方案：确认 `afterEach` 或 `afterAll` 恢复了原型，避免跨用例污染

- **输出**：替身实现质量评估 + 修正建议

### 检查 7: 测试隔离性 (test_isolation)

- **严重等级**: MAJOR
- **评估方法**:
  1. 检查每个 `describe` 块：
     - `beforeEach` 中是否重建 **替身 + 待测业务入口所需的上下文**（v2 强约束：每条 it() 必须独立）
     - 是否存在模块级共享的可变变量被跨用例修改（如 `const storage = new SpyStorage()` 放在 describe 外）
  2. 检查测试用例间是否存在隐式依赖：用例 B 的 Arrange 是否依赖用例 A 的 side effect
  3. 评估用例能否以任意顺序运行而结果一致
  4. 若使用原型方法替换方案，验证 `afterEach` 是否还原，避免污染后续用例

- **输出**：隔离性问题清单

---

## 六、上下文文件

以下是本次验证涉及的所有文档、use-cases.yaml、DAG、业务编排源代码和 UT 文件：

{context_files}

---

## 七、输出格式（必须严格遵循）

请以下方 YAML 格式输出验证结果。**不要**输出其他格式或自由文本。

```yaml
verification_result:
  phase: "ut"
  feature: "{feature_name}"
  timestamp: "{timestamp}"

  checks:
    - id: state_model_completeness
      status: PASS | FAIL | WARN | SKIP
      severity: MAJOR
      details: |
        逐 UseCase 审查（若无 use-cases.yaml 则 SKIP 并说明理由）：
        - <use_case_id>: PASS/FAIL — <具体发现>
        - 漏态: [...]
      affected_files:
        - "doc/features/{feature_name}/use-cases.yaml"
      suggestion: |
        <修正建议，若 PASS 可省略>

    - id: ui_bindings_completeness
      status: PASS | FAIL | WARN | SKIP
      severity: MAJOR
      details: |
        逐 UseCase × ui_bindings 审查：
        - <use_case_id>.<ui>:
            role: <entry|progress|dialog|result|passive>
            user_actions 命名质量: <评价>
            subscribes vs state_model 对齐: <YES/NO>
        缺失 UI 绑定: [...]
        data_boundaries 完备性: <评价>
      affected_files: [...]
      suggestion: |
        <修正建议>

    - id: end_to_end_driving
      status: PASS | FAIL | WARN
      severity: BLOCKER
      details: |
        逐 it() 驱动力评估：
        - <file>:"<it name>":
            named_entry_called: YES/NO
            boundary_callLog_asserts: <count>
            state_asserts: <count>
            phase_coverage: <中间态 + 终态是否齐全>
            verdict: PASS/FAIL
        ...
      affected_files: [...]
      suggestion: |
        <修正建议>

    - id: branch_coverage_semantic
      status: PASS | FAIL | WARN | SKIP
      severity: MAJOR
      details: |
        异常场景比对：
        PRD 列出的异常: [...]
        use-cases.yaml 已覆盖: [...]
        遗漏分支: [...]
      affected_files: [...]
      suggestion: |
        建议新增 branches:
        - id: <xxx>
          scenario: <...>
          linked_acceptance: [<AC-X>]

    - id: device_ac_delegation
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        device/both AC 列表: [...]
        device-testing-todo.md 是否存在: YES/NO
        遗漏条目: [...]
        ui_subscription 节点翻译情况: [...]
      affected_files:
        - "doc/features/{feature_name}/device-testing-todo.md"
        - "doc/features/{feature_name}/acceptance.yaml"
      suggestion: |
        <修正建议 + 模板片段>

    - id: stub_reasonableness
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        替身审查：
        - <SpyClassName / 原型替换点>: PASS/FAIL — <字段/值域/错误码合理性>
        - 跨用例污染风险: [...]
      affected_files: [...]
      suggestion: |
        <修正建议>

    - id: test_isolation
      status: PASS | FAIL | WARN
      severity: MAJOR
      details: |
        隔离性分析：
        - beforeEach 重建替身+上下文: YES/NO
        - 共享可变状态: [...]
        - 隐式依赖: [...]
        - 原型替换还原: YES/NO/NA
      affected_files: [...]
      suggestion: |
        <修正建议>

  summary:
    total: 7
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    skip: <SKIP 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（use-cases.yaml schema、ui_bindings 非空、named_business_handler、boundary_matches_contracts、ut_import_whitelist、it 标签格式、boundaries_all_stubbed、覆盖计数等）
2. 本文件 v2.1 的核心 BLOCKER 是 **end_to_end_driving**——如果用例仍然是"调 Repository 查 length"这种老式单数据接口测试，必须 FAIL
3. 若 UT 文件依赖了 `@Component` / `struct` / `NavPathStack` / `showToast` / `$r` / `$rawfile` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics` 等 UI 符号，脚本 Harness 已经会 FAIL；你无需重复判断，但可在 `test_isolation` 或 `end_to_end_driving` 中顺带引用其对"脱离 UI runtime 驱动"的负面影响
4. 对每一项检查，请给出**具体的代码证据**（文件路径 + 关键代码行），而非泛泛而谈
5. 若 `use-cases.yaml` 不存在但 acceptance.yaml 有 `ut_layer ∈ {unit, both}` 的 AC：
   - 检查 1 / 2 / 4 置为 SKIP（SKIP 原因注明"本 feature 未达复杂度阈值或未产出 use-cases.yaml"）
   - 检查 3（end_to_end_driving）仍需以"调用真实业务函数且断言充分"为标准进行判定
   - 检查 5 / 6 / 7 正常执行
6. **严禁**建议"新增 Port 接口 / 新增 domain/usecase/*.ets 类"——这是 v2.1 明确否定的反模式。如需改善可测试性，建议形式应为：
   - 抽取 Page 内部 inline lambda 为命名方法 / 导出函数
   - 将业务编排从 Page 下沉到独立 `Flow` / `Coordinator` 普通类（非 `@Component struct`）
   - 在 `use-cases.yaml` 的 `ui_bindings` 补映射，在 `data_boundaries` 补边界声明

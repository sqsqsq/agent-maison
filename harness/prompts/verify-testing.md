# 真机测试阶段语义验证 — {feature_name}

**当前独核资格与结果边界**：只消费机器实际签发的当前 request/material，phase 只选择检查方法。有「本轮为独立问题诊断」一节时，按具体对象和原报告逐条核实；证据缺口记为未知，其他可核实的问题继续验证。独核终态只表示本次语义核实，产品 FAIL 和缺失执行由共同完成处置保留。补核保留原目标、完整拒修论据和相关反证，按本轮实证判断。

> 自动生成于 {timestamp}
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
> 现代调用按冻结 scope 与有效解析验收（含 P3 投影）核验 device/both AC、BD、NFR 和视觉义务，不因缺 spec/plan 跳过 P0 runtime 机器证据。manual、离线、缺 provider/图片、trace failed 都是未完成，不得改 N/A；纯 unit TC 仍遵守设备前 R8。request 只对本次明确目标及原生断言负责；零设备范围的 reconcile-only 是只读诊断，不是测试 PASS。
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

以下是脚本 Harness (`check-testing.ts`) 的本轮结果。直接引用 `report_trace_reconciliation`、执行通道/完整性、结构检查和 `ui_entry_coverage` 的机器状态。`passed_check_ids` 中的检查已 PASS。计划选取、派生用例集合、章节、表头、状态枚举、导航步骤静态规则及报告与原生 trace 的逐条对账由脚本完成。

执行通道由顶层 `test-plan.md` 的 `execution_channel` 声明。脚本已在 `testing_execution_channel`、`device_test_run` 和 `testing_case_execution_completeness` 中检查通道与执行事实。正式派生用例集合须与顶层 `channel=hylyre` 的用例集合完全相等；正式派生计划禁止登记 `explicit_skip_tc_ids`，显式跳过不能抵消覆盖缺口。按本轮机器结果引用这些结论。

保留机器记录的 FAIL、未执行和覆盖缺口。缺失或不可用的证据明确记为未知，非 success 的设备结果和失败/阻塞用例保持原状；顶层回填 `testing/reports/trace.json` 不能替代本轮权威 trace。机器对账 PASS 只表示报告与 trace 一致。可按具体语义问题打开对应的原生执行片段和截图，无需重新全量对账。

```
{script_report}
```

---

## 五、语义检查项（你的核心任务）

逐项核对本轮适用的语义检查。判 BLOCKER 时指出受影响的真实验收、证据定位及放过的后果。

### 检查 7: 真机自动化消费 (device_test_run_consumption)

- **严重等级**: BLOCKER（profile 将 `device_test.run` 声明为 BLOCKER 时） / SKIP（profile 声明 SKIP 时）
- **评估方法**:
  1. 若 profile **`device_test.run`** 为 SKIP → 整项 SKIP
  2. 引用第四节机器结果和具体用例，判断实际执行的步骤和断言能否证明原来的 device/both 验收；同一业务动作有多个 UI 入口时，核实实际步骤是否从承诺的入口触发、是否验证对应的结果。
  3. 核实报告引用的截图是否来自本轮相应步骤并支持界面、焦点或导航等结论；报告称已修复的缺陷，核实复测是否覆盖原失败行为及触发条件。
  4. 已有机器失败和执行覆盖缺口引用原检查；独立发现用例、截图或复测无法证明承诺时，指出具体验收和应核实的原证据。

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
  2. 用本轮机器核对过的统计、执行结果和负面结论判断报告是否满足计划声明的 P0 及总体阈值；不重新计算逐条 trace 结果、通过率或枚举。
  3. 核实「达标」或「有条件达标」的理由是否覆盖原验收，是否仍有待复测的失败或有效证据缺口；机器认定的未通过或未执行在原处置中保留。
  4. 若测试报告尚未生成，标为 WARN

### 检查 8: 视觉 diff 双向残差 (visual_diff_bidirectional)

- **严重等级**: BLOCKER（硬像素契约：`fidelity_target: pixel_1to1` **且** `acceptance_strictness: hard`，以 `spec/reports/fidelity-intent.json` 的 `effective_fidelity` / `acceptance_strictness` 为准）/ 否则 MAJOR
- **评估方法**:
  1. 读取 `device-testing/device-screenshots/visual-diff.json`：每屏须含 `reverse_missing[]`（逐元素枚举，可为 `[]`）
  2. 对照 `spec/ref-elements.yaml`：`disposition: implement` 的元素须在 ui-spec 覆盖，或出现在某屏 `reverse_missing`
  3. `must_fix` / `verdict=fail` 须逐元素说明；脚本 FAIL/BLOCKER 时本项 FAIL
  4. **G3 样式/布局逐项核对（pixel_1to1）**：对 ui-spec 声明了 `variant` / `layout_group` / `align` / `width_ratio` / `bg_color` 的节点，逐一在真机截图上核对——按钮填充形态是否匹配 `variant`（实心/tonal/描边/幽灵/纯文字）、同 `layout_group` 元素是否真同行、`align`/`width_ratio` 是否一致（治"全宽 vs 右侧药丸"）、区域 `bg_color` 是否匹配（治灰底 vs 蓝底）。不符按档位处理：
     - **硬像素契约**（pixel_1to1 ∧ hard）：major/blocker 残差写入结构化缺陷和对应 `must_fix`，由 gate 有效授权结论返修；完整锚定的 minor-only 只作 WARN 披露，不产 coding 候选或阻断债务，不能仅凭 raw fail/非空 must_fix 升级
     - **软档**（其余档位，含 pixel_1to1 ∧ best_effort）：执行者/VL 自报的 **major** 样式不符记为该屏 `defects[]`（severity=major，以 `must_fix_refs` 引用对应 must_fix），并在 `must_fix` 里写清修法；harness gate 会按档位把该屏降级为视觉债务并披露在 `downgraded_screens`——不阻断阶段推进、不驱动回退，但**仍阻断发布**直到修复重验。纯 minor 残差只记 `defects[]`（severity=minor）披露，不因此新写 must_fix。不要因这类自报样式残差把本项判 BLOCKER 或要求整链回退
     - 两档都保留原阻断/修复规则：独立确定性失败（T8 major/hard 信号、锚点文本整块缺失、双向残差、缺 `by_id` 锚点）、blocker、未锚定 legacy 指令及核心操作走不通/结果错/关键信息缺失或不可读（记 blocker）。minor 不豁免这些检查；raw fail 若仅由有效 minor 或既有 soft 降级意见支撑，不能再独立拒证。缺证按 testing 重采/重评处理，不猜 coding 修法
  5. A/B/C 边界：C 类动态交互不在静态参考图承诺内

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 对报告关于验收、失败原因和复测的实质引用，打开对应的原生运行片段或 device-screenshots 核证。用例状态、执行计数与 trace 的关系直接引用本轮 `report_trace_reconciliation`。
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
| device_test_run_consumption | BLOCKER |
| test_case_completeness | MAJOR |
| test_steps_reproducible | MAJOR |
| expected_result_specific | MAJOR |
| nfr_test_coverage | MAJOR |
| defect_severity_consistency | MINOR |
| pass_criteria_met | BLOCKER |
| reference_crosscheck | MAJOR |
| visual_diff_bidirectional | BLOCKER（硬像素契约 pixel_1to1 ∧ hard）/ MAJOR（其余档位） |

### 7.1 汇总表

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| <check_id> | PASS / WARN / FAIL / SKIP | <severity> | <一行证据> |

### 7.2 非 PASS 项明细

```yaml
verification_result:
  phase: "testing"
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

1. **不要重复脚本 Harness 已覆盖的检查**（章节存在性、表格格式、AC 追溯覆盖率、优先级值域等）
2. 若测试报告尚未生成（只有测试计划），将检查 5 和检查 6 标为 WARN 并说明原因
3. 模拟应用的测试用例预期结果应基于模拟数据的实际值
4. 关注测试步骤的**人类可执行性**——描述必须让非开发人员也能理解和执行
5. 对每一项检查，请给出**具体的文档证据**（用例编号、章节名称、具体文本），而非泛泛而谈

---

## 终态块（唯一版本化结论出口 · 必填）

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

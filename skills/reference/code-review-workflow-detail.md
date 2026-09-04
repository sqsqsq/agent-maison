# code-review 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/code-review/SKILL.md`](../feature/code-review/SKILL.md)。本文承载视觉保真维度执行定义（pixel_1to1 相关）与 Step 2 各审查子维度的完整检查项；触发/门禁清单/闭环判定仍以主文档为准。

## 视觉保真维度执行定义（UI 需求必做，pixel_1to1 核心红线）

**不重跑度量，消费落盘产物**；pixel_1to1 P0 **全覆盖不许抽查**（非 pixel_1to1 或 P1 屏可抽查）：

1. **素材验真核验**：打开 `spec/reports/asset-crop-validation.json` 确认全部 crop `verified`；对照 `spec/reports/asset-contact-sheet-*.png` 逐张人核裁图与红框对应（3 秒/张）；有 failed/pending/真人翻案留痕的逐条确认处置。
2. **可见文案 diff 复核**：核对 coding 门禁 `visible_text_whitelist` 结果；若存在 `coding/visible-text-exemptions.yaml`，**逐条复核豁免 rationale 是否正当**（豁免是自报面，review 是唯一人审关口）。
3. **结构声明台账逐条复核**：打开 `coding/structure-conformance.yaml`，对**每一条** entry（pixel_1to1 P0 全条目核对，**不许抽查**）：①打开 `implemented_by` 对应 struct 源码，验证 `how` 描述属实；②对照参考原图确认该结构声明本身与原图一致。台账是 coding 自报面，review 必须独立逐条复核；门禁 `structure_declaration_ledger` 只保"逐条表过态+struct 真实存在"，登记真实性还须由本阶段证据与后续 device 机器信号共同闭环。复核结论逐条写进 review-report.md 并引用台账路径。
4. **must_have_elements 覆盖**：全部 must_have 与变更屏在源码有真实承载（消费 `visual_parity` 结果，不重扫）。

把各项核对结论+引用的报告路径写进 review-report.md 的「视觉保真」维度章节；pixel_1to1 下缺任一类证据引用，`visual_fidelity_review` 判 FAIL。

**在线高保真**：review harness 消费 lock/快照做 fidelity 治理签字（ratchet/deferrals），不对图、不联网；像素对图仅在 device-testing。

## 工程惯例核对（文件存在时）

输入参数是**目标文件集合**；当前 Feature 模式由规范化 `contracts.files` 提供，不以 diff 定义范围。
按 `paths.conventions`（缺失键使用框架默认值）读取全文，独立于 plan 的声明逐条执行：

1. 判适用性，再核对目标代码是否符合；gate 索引卡不重判，固定 `GATE_DELEGATED`。
2. 对 `contracts.conventions_applied` 核对“声明 vs 实现”；每个 planned location 须按完整路径段命中目标文件。
3. CU 有所引蓝图时，蓝图 convention facts 中的 id 必须已声明，或在台账明确判 `NOT_APPLICABLE`；不得无声丢弃设计依据。
4. 适用条目必须打开 Golden Example；文件不存在或 `#symbol` 文本找不到 → WARN，不做 hash/drift。
5. 仅新代码条目：未跟踪/未提交行为新；`git blame` 日期 ≥ 生效日为新，早于生效日为 legacy。
   legacy 违反只列 INFO advisory；无 blame/无历史记 `NOT_ASSESSED` advisory，不得阻断。

报告追加「工程惯例覆盖台账」：每个 `##` id 恰一行，列为 `惯例 id | 判定 | 依据`。
判定仅 `PASS / VIOLATION / GATE_DELEGATED / NOT_APPLICABLE / NOT_ASSESSED`；
VIOLATION 必须在问题清单有引用同 id 与范例路径的条目（legacy 违反仍用 VIOLATION，但问题严重级别仅 INFO）。
文件不存在且无声明不产出台账；文件缺失但声明非空必须报告悬空契约，不得按未启用跳过。
review 只能建议将重复意见升格为惯例，写入仍由 `/conventions-bootstrap` 逐条确认。

## Step 2 审查子维度完整检查项

**2.1 架构合规性（BLOCKER）**：①外层依赖合规——逐文件检查 import/包依赖是否违反 `outer_layers[].can_depend_on` 与同层 `intra_layer_deps` 策略；②模块内分层——验证 import 遵循 profile 声明的内层顺序；③文件完整性——对照 `contracts.yaml > files` 检查每个文件是否存在；④资源引用完整性——检查资源引用调用的 key 是否在资源定义中存在。

**2.2 接口一致性（BLOCKER）**：①数据模型一致——对比 `contracts.yaml > data_models` 与实际代码 class/interface（字段名/类型/必填/enum 值）；②接口签名一致——对比 `interfaces` 与实际方法实现（方法名/参数/返回类型/async 标记）；③组件 Props 一致——对比 `components` 与实际组件装饰器声明。

**2.3 编码规范（MAJOR）**：①命名规范（模块 PascalCase、struct 名与文件名一致、资源 key snake_case）；②硬编码字符串（presentation 层未走资源机制的 UI 文本）；③禁止 any 类型；④async/await 模式（是否存在 `.then()/.catch()` 回调链，排除 Promise.all 等）。

**2.4 业务逻辑（MAJOR）**：①异常处理完整性——对照 `acceptance.yaml > boundaries` 检查每个异常场景是否有代码处理；②业务流程正确性——对照 plan.md 服务层接口和组件树验证数据流转；③spec 验收标准覆盖——对照 `criteria` 的 P0/P1 项验证代码有对应实现。

**2.5 数据层（MAJOR/MINOR）**：①数据所有权合规——presentation 层是否绕过 Repository 直接操作数据源；②模拟数据隔离——模拟数据是否封装在 data/repository 内部。

完整检查清单：`framework/profiles/<project_profile.name>/skills/code-review/templates/review-checklist.md`。

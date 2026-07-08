# code-review 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/code-review/SKILL.md`](../feature/code-review/SKILL.md)。本文承载视觉保真维度执行定义（pixel_1to1 相关）与 Step 2 各审查子维度的完整检查项；触发/门禁清单/闭环判定仍以主文档为准。

## 视觉保真维度执行定义（UI 需求必做，pixel_1to1 核心红线）

**不重跑度量，消费落盘产物**；pixel_1to1 P0 **全覆盖不许抽查**（非 pixel_1to1 或 P1 屏可抽查）：

1. **素材验真核验**：打开 `spec/reports/asset-crop-validation.json` 确认全部 crop `verified`；对照 `spec/reports/asset-contact-sheet-*.png` 逐张人核裁图与红框对应（3 秒/张）；有 failed/pending/真人翻案留痕的逐条确认处置。
2. **可见文案 diff 复核**：核对 coding 门禁 `visible_text_whitelist` 结果；若存在 `coding/visible-text-exemptions.yaml`，**逐条复核豁免 rationale 是否正当**（豁免是自报面，review 是唯一人审关口）。
3. **结构声明台账逐条复核**：打开 `coding/structure-conformance.yaml`，对**每一条** entry（pixel_1to1 P0 全条目核对，**不许抽查**）：①打开 `implemented_by` 对应 struct 源码，验证 `how` 描述属实；②对照参考原图确认该结构声明本身与原图一致。台账是 coding 自报面，**本维度是它唯一的人审关口**——门禁 `structure_declaration_ledger` 只保"逐条表过态+struct 真实存在"，**登记内容对不对由你兜**（非文本类结构如 tab 容器/分组视觉，device OCR 也兜不住，你是用户终审前最后防线）。复核结论逐条写进 review-report.md 并引用台账路径。
4. **must_have_elements 覆盖**：全部 must_have 与变更屏在源码有真实承载（消费 `visual_parity` 结果，不重扫）。

把各项核对结论+引用的报告路径写进 review-report.md 的「视觉保真」维度章节；pixel_1to1 下缺任一类证据引用，`visual_fidelity_review` 判 FAIL。

**在线高保真**：review harness 消费 lock/快照做 fidelity 治理签字（ratchet/deferrals），不对图、不联网；像素对图仅在 device-testing。

## Step 2 审查子维度完整检查项

**2.1 架构合规性（BLOCKER）**：①外层依赖合规——逐文件检查 import/包依赖是否违反 `outer_layers[].can_depend_on` 与同层 `intra_layer_deps` 策略；②模块内分层——验证 import 遵循 profile 声明的内层顺序；③文件完整性——对照 `contracts.yaml > files` 检查每个文件是否存在；④资源引用完整性——检查资源引用调用的 key 是否在资源定义中存在。

**2.2 接口一致性（BLOCKER）**：①数据模型一致——对比 `contracts.yaml > data_models` 与实际代码 class/interface（字段名/类型/必填/enum 值）；②接口签名一致——对比 `interfaces` 与实际方法实现（方法名/参数/返回类型/async 标记）；③组件 Props 一致——对比 `components` 与实际组件装饰器声明。

**2.3 编码规范（MAJOR）**：①命名规范（模块 PascalCase、struct 名与文件名一致、资源 key snake_case）；②硬编码字符串（presentation 层未走资源机制的 UI 文本）；③禁止 any 类型；④async/await 模式（是否存在 `.then()/.catch()` 回调链，排除 Promise.all 等）。

**2.4 业务逻辑（MAJOR）**：①异常处理完整性——对照 `acceptance.yaml > boundaries` 检查每个异常场景是否有代码处理；②业务流程正确性——对照 plan.md 服务层接口和组件树验证数据流转；③spec 验收标准覆盖——对照 `criteria` 的 P0/P1 项验证代码有对应实现。

**2.5 数据层（MAJOR/MINOR）**：①数据所有权合规——presentation 层是否绕过 Repository 直接操作数据源；②模拟数据隔离——模拟数据是否封装在 data/repository 内部。

完整检查清单：`framework/profiles/<project_profile.name>/skills/code-review/templates/review-checklist.md`。

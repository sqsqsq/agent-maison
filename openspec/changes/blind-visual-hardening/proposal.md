## Why

2026-07-13~16 宿主 bc-openCard 第二轮实锤事故（plan a9d4c7e2，codex 四轮 + cursor 四轮 review 定稿）：盲宿主（minimax 2.7 / receipts 记 GLM-5.1-Alpha-Auto，非多模态，逐阶段 CodeAgentCLI 驱动）产出线框级 UI（零可见图标、无容器/导航/关闭钮、23 张渲染不可见 placeholder PNG），但 14/14 真机 TC 全 PASS、四阶段全部闭环、test-report「达标可发布」。五洞：①review 终态「不通过+3 BLOCKER」但 summary verdict:PASS/closed 照样推进——`conclusion_with_verdict` 只校验一致性、洞⑥ `conditional_pass_closure` 只覆盖「有条件通过」分支，全库无任何机制消费「不通过」（report_validity 与 product_verdict 混用一个 PASS）；②盲档视觉链路四点停摆（VL 检查合法 SKIP / 确定性采集缺 nav 配置未启动【宿主旧包 WARN，HEAD 已 BLOCKER】/ 非 pixel 档降 WARN 不阻断 / 负面证据不传播到完成态）；③goal-fakepass-hardening 档位三态意图检测只在 goal preflight 生效，逐阶段驱动路径漏检 → 缺省 semantic_layout 全部 pixel 硬门禁未激活；④22 项素材声明 acquisition:crop（盲模型不可能完成）未验真，coding 物化空白占位仅 WARN，设备测试真值=uitree 存在性（Image 节点在=可见）；⑤视觉债务全埋 WARN/soft_advisories，结论零 caveat。硬约束：宿主短期只有 minimax（盲模型），外置 VL/换模型路线不可用——全部措施须在纯盲档内成立。

## What Changes

- **d1 verdict lattice 与负面裁决传播**（两切片）：切片一——review「不通过」/testing「不达标」→ phase BLOCKER FAIL（补洞⑥漏掉的分支）；跨阶段传播消费新鲜 summary+receipt（Markdown 只是解析输入，防 TOCTOU）。切片二——summary schema 1.1：顶层 `report_validity`（报告可解析/可信，独立于产品裁决）+ `quality_axes`（functional/visual/asset/evidence 对象化：applicable/required_for_release/verdict/blocking_class/source_checks/resolution）+ 三条 schema 不变量；双投影分立（顶层兼容 verdict 按 required_for_phase_advance；feature completion 按 required_for_release）；旧 verdict 由唯一解析器生成兼容投影；legacy 1.0 summary 不作 1.1 completion 干净依据；resolution 映射严格复用 needs_fix/needs_human 现行语义（FAIL→PARTIAL/FEATURE_INCOMPLETE，人工确认不能解除确定性 FAIL）。
- **d2 盲档素材完整性**：crop 左移禁令收窄版（禁盲模型执行/自证 crop，四条件齐备的可信外部产物放行为消费态）；role/criticality 机器派生与交叉对账（不信 agent 自报）；物化 sanity 按 role 分档（brand-critical 空白/纯色 → BLOCKER 不分档位）；分角色占位生成（brand_logo→text_avatar / system_symbol→sys symbol / illustration→中性插画占位框，禁空白 PNG）；设备渲染可见性两验收节点（calibrate 冻结样本/误报率/阈值版本 → enforce 才算达成）；素材债务三态清偿（source/binding/render 全 VERIFIED 才关闭）。
- **d3 可执行盲档 UI kit**：profile 内 ArkUI block 模板 + 确定性 scaffolder 生成进宿主公共层（目录四级解析：config 显式 > profile 推荐 > architecture 推导 > halt 问人）；实例语义锚点 `maison:<feature>:<screen_id>:<semantic_node_id>:<instance_key>`（字符集/长度约束）；ui-spec container 语义节点与 block 映射；声明→源码锚点→uitree 三段闭环 check；kit gallery fixture 防自身退化。
- **d4 fidelity 意图三态覆盖扩面**：t6 三态检测（强意图+盲→DEFERRED_CAPABILITY_MISSING / 含混+参考图→await_human_fidelity_tier / 只升不降）从 goal preflight 扩到逐阶段驱动路径（harness-runner spec 前置钩子，同源实现勿 fork）；reference_intent/desired/effective/downgrade_receipt 落盘。
- **d5 视觉债务 SSOT 与人工验收 receipt**：visual-debt.json（机器派生）+ md 投影；债务→quality_axes 映射（completion_status=FUNCTIONALLY_COMPLETE_VISUAL_PENDING 仅为投影标签，不绕过 verify-feature-completion）；人工视觉验收 receipt（冻结阈值每维 ≥4/5、结构化 screens 映射、rubric_version/policy_hash 绑定、只清偿主观项不洗确定性 FAIL、accepted≠closed 审计分立）。
- **d6 确定性视觉反馈回路**：visual-feedback.json SSOT + md 投影；两类信号分立（离散事实可直接 visual FAIL；连续指标默认 advisory，超冻结阈值才升级；禁单一全局相似度裁决整体质量）；收敛跟踪扩展 visual-rounds-ledger（不建并行状态机）；deterministic_feedback 采集策略由 harness 按「盲档+UI change」机器派生、与 fidelity 档位解耦（治 capture-completeness pixel-only 早退）；反馈身份用 framework_package_digest（发布包环境无 git commit）。

显式非目标：外置 VL/BYO-VL（用户硬约束否决）；OCR 引擎升级；goal 模式 halt 分类扩展（沿用既有）；宿主工程修复（用户重跑）；receipt 签发体系（沿 goal-fakepass-hardening 边界，归 runtime-policy-core 后继）。

## Capabilities

### New Capabilities

- `verdict-lattice`：report_validity 与产品多轴裁决分离、负面裁决传播、双投影、legacy 政策的完成语义能力。
- `blind-ui-kit`：盲模型可实例化的 ArkUI block 库 + scaffolder + 三段闭环验证能力。

### Modified Capabilities

- `harness-gates`：盲档素材完整性门禁面（crop 禁令/role sanity/渲染可见性）、fidelity 意图检测逐阶段扩面。
- `visual-diff`：确定性反馈 JSON SSOT、两类信号分立、采集档位解耦、ledger 收敛扩展。
- `confirmation-receipts`：新增 `human_visual_acceptance` 消费动作（冻结 rubric 阈值/结构化 screens/清偿边界）。
- `feature-artifact-layout`：新 artifacts（visual-debt.json+md、visual-feedback.json+md、asset-request.md、ui-kit manifest、visual-acceptance receipt 落点）。

## Impact

- Affected specs: verdict-lattice（新增）、blind-ui-kit（新增）、harness-gates、visual-diff、confirmation-receipts、feature-artifact-layout
- Affected code: `harness/scripts/check-{review,testing,spec,coding,receipt}.ts`、`harness/scripts/harness-runner.ts`（spec 前置钩子/quality_axes writer）、`harness/scripts/utils/{fidelity-shared,verify-feature-completion,phase-transition-policy,visual-rounds-ledger,markdown-parser}.ts`、新 utils `{quality-axes,visual-debt,upstream-verdict-gate}.ts`、`harness/schemas/summary.schema.json`（1.1）、`profiles/hmos-app/harness/{asset-*,visual-diff-*,capture-completeness-check}.ts`、新 `profiles/hmos-app/ui-kit/**` + scaffolder、`specs/phase-rules/*.yaml`（gate 登记）、`skills/`（盲档工作法/告知文案对齐）
- **Breaking / MIGRATION.md**：①review 结论「不通过」从此阻断 phase 闭环——存量 feature 若带未闭环不通过报告，重跑 review 前不得推进；②summary schema 1.1——1.0 消费方兼容读取，但 1.0 summary 不得作为 1.1 completion 干净依据（须当前 gate_fingerprint 重跑或保守 INCOMPLETE）；③盲档下 brand-critical 素材空白物化从 WARN 升 BLOCKER；④UI 需求 spec 阶段新增 fidelity 意图前置检测（逐阶段路径），强意图+盲模型将 DEFERRED 而非静默降档——宿主交互成本属设计内（每条带图需求一次确认）。

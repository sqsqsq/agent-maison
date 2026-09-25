# 真机测试阶段语义验证 — demo-card

> 自动生成于 2026-09-25T04:33:30.959Z
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

- **模块名称**: demo-card
- **阶段**: testing

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/testing-rules.yaml` 的完整内容，定义了测试阶段的通用约束规则：

```
phase: testing
version: "1.0"
applies_to:
  test_plan: doc/features/{module}/testing/test-plan.md
  test_report: doc/features/{module}/testing/test-report.md
structure_checks:
  test_case_flow_consistency:
    description: >
      TC 结构化 DAG 一致性（visual-capability-truth S6/P1-I）：test-plan.md 顶层
      test_case_flow YAML 块与用例表完全一致（缺/多/引用错/环 → BLOCKER）；无块 → WARN。
      级联归类三分（root/blocked/independent）依赖本块——BLOCKED_BY 非 PASS：仍进 P0 分母、仍阻
      completion，仅根因归类变化；reset 失败归 environment。
  negative_verdict_closure:
    description: >
      负面产品裁决闭环门禁（blind-visual-hardening d1）：测试结论=不达标 → BLOCKER FAIL， testing
      不得闭环推进。report_conclusion_with_verdict 只验声明行可机读（report_validity
      语义），本门禁是产品裁决传播——与 review 侧 negative_verdict_closure 同语义。
  upstream_verdict_gate:
    description: >
      跨阶段负面裁决传播门禁（blind-visual-hardening d1）：testing 启动时消费上游各阶段 summary.json
      机器裁决——上游 verdict 非 PASS / blocker 未清 / 证据 stale|tampered → BLOCKER
      FAIL（bc-openCard 二轮：review 不通过曾照常进 testing）。
  visual_debt_disclosure:
    description: >
      视觉债务披露门禁（blind-visual-hardening d5）：visual-debt.json 存在未清偿条目
      （open/accepted）时，test-report 结论章节必须引用「视觉债务」与清单——结论不得对 视觉未验真沉默；产品裁决
      SSOT=summary.quality_axes（功能/视觉分轴，禁复合措辞）。
  review_closure_attestation:
    description: >
      testing 期产品源码 vs review-closure-attestation.json 固化 inventory 对账 （走树=冻结
      roots ∪ 当前重 discovery，新增整模块可见）。缺 attestation 或任何 新增/修改/删除/新 root → BLOCKER
      FAIL，指引回跑 review 闭环重审；无 grace window。 review 阶段被 profile 禁用 →
      SKIP。防线针对：测试期写入行为开关（如 DEVICE_TEST_FAST_PATH=true）短路用户流程、review
      审过的代码与真机跑的不是同一份。
  product_behavior_switch_scan:
    description: |
      产品源码（非测试目录）测试性行为开关扫描：命名命中 FAST_PATH/TEST_ONLY/FOR_TEST/DEVICE_TEST/E2E_ONLY/BYPASS/SKIP_(SMS|VERIFY|AUTH) 且初始化为 true → BLOCKER，回 coding 修复或以新需求开启 successor run。 legacy behavior-switch-waivers.yaml/confirmation receipt 只读且不改变 verdict。 defense-in-depth：主防线为 review_closure_attestation 与 P0 语义链。
  p0_coverage_integrity:
    description: >
      P0 用例覆盖 fail-closed（goal-fakepass-hardening t5 → c7e4a2d9）：未执行的 P0 一律
      BLOCKER；legacy p0_skip_waiver receipt 与历史产物中的 legacy explicit_skip_tc_ids
      均只读、不参与判定，也不贡献 PASS。derive manifest 只有 TC id 而无 StepResult 时，未执行缺口保持
      testing FAIL， 不得按 TC 名称、AC 关联或报告散文推测 coding；只有既有 capability resolution 给出
      provider 缺失机器事实时才走 DEFERRED。真实外部条件走既有 DEFERRED，不得由 waiver 降级 WARN
      或制造人工等待态。不新增 skip 原因枚举、责任阶段字段或专用 halt （await_human_p0_skip 已退役）。
  p0_pass_rate_dual_metrics:
    description: >
      通过率双口径对账（t5）：全分母执行覆盖率与通过率分列重算；存在任何 P0 skip 时
      报告结论不得无条件「达标」（bc-openCard：7/7=100% 冒充 18 条全量）。
  p0_semantic_coverage_integrity:
    description: >
      P0 结构化状态迁移证据改由 Hylyre authoritative trace 的 CaseResult.steps[] 提供：
      case.execution=completed、verification=passed、evidence=complete，且
      checkpoint 的 required_element_ids 均映射到 role=assertion 且
      outcome.status=passed 的 StepResult （状态读 outcome.status，不读已退役的 flat
      status），forbidden_element_ids 均 映射到通过的 absence assertion；禁纯动作/纯 wait/旧
      case 状态冒充。普通 interactive 与 goal 同源消费 StepResult，goal 额外保留
      run/attempt/HAP/device 身份绑定。
  plan_required_chapters:
    description: |
      测试计划必须包含以下章节： 测试范围、测试环境、测试用例清单、测试策略、通过标准、风险与依赖
    severity: BLOCKER
    rule:
      file: test-plan.md
      expected_headings:
        - 测试范围
        - 测试环境
        - 测试用例清单
        - 测试策略
        - 通过标准
        - '"风险" or "风险与依赖"'
      match: heading_text_contains
  test_case_table_format:
    description: |
      「测试用例清单」必须包含 Markdown 表格，表头至少包含： 用例编号、用例名称、前置条件、测试步骤、预期结果、优先级、关联 AC
    severity: BLOCKER
    rule:
      file: test-plan.md
      section: 测试用例清单
      expect: markdown_table
      required_columns:
        - '"用例编号" or "编号"'
        - 用例名称
        - 前置条件
        - 测试步骤
        - 预期结果
        - 优先级
        - '"关联 AC" or "关联验收标准"'
  test_case_priority_values:
    description: |
      测试用例优先级必须为 P0/P1/P2/P3
    severity: MAJOR
    rule:
      file: test-plan.md
      section: 测试用例清单
      column: 优先级
      allowed_values:
        - P0
        - P1
        - P2
        - P3
  test_environment_defined:
    description: |
      「测试环境」必须明确列出：设备型号/模拟器、系统版本、API 版本、 特殊配置要求
    severity: MAJOR
    rule:
      file: test-plan.md
      section: 测试环境
      required_fields:
        - '"设备" or "设备型号"'
        - 系统版本
        - '"API" or "API 版本"'
  pass_criteria_defined:
    description: |
      「通过标准」必须定义量化的通过条件， 如 P0 用例 100% 通过、P1 用例 ≥ 95% 通过
    severity: BLOCKER
    rule:
      file: test-plan.md
      section: 通过标准
      expect: numeric_thresholds
  device_test_build:
    description: >
      当 project_profile 将 device_test.build 声明为 BLOCKER 且未 SKIP 时， harness
      必须产出可安装的主应用 signed HAP（执行 hvigor 或按源码 mtime 复用已有 HAP， `reused: true` 时门禁仍为
      PASS）；并落盘编译日志/result.json； 声明 SKIP 时本检查 SKIP。
    severity: BLOCKER
  device_test_install:
    description: >
      当 project_profile 将 device_test.install 声明为 BLOCKER 且未 SKIP 时， harness
      必须将主应用 HAP 通过 hdc 安装到已连接设备；声明 SKIP 或上游 device_test.build SKIP 时本检查 SKIP。
    severity: BLOCKER
  device_test_run:
    description: >
      当 project_profile 将 device_test.run 声明为 BLOCKER 且未 SKIP 时， harness 必须按
      profile 指定的真机自动化能力消费派生测试用例并产出 report + trace； 脚本以
      doc/features/<feature>/testing/test-plan.md「测试用例」表为 SSOT：每条 TC 声明唯一
      execution_channel（hylyre | visual | manual | provider:<capability-id>），派生
      hylyre 表须与 channel=hylyre 的集合完全相等（missing/extra 均 BLOCKER）。正式派生计划禁止写
      explicit_skip_tc_ids（登记即 BLOCKER），历史产物中的该字段仅只读诊断、不减除缺口、不贡献 PASS；
      烟测占位类派生无效；在多条派生产物间按 test-plan.hylyre.md 的 mtime 选取最新有效计划。 **门禁语义**：run.ok
      仅表示 runner 未崩溃；本检查还须 trace.outcome=success 且无失败/阻塞 case， 否则 BLOCKER
      FAIL（partial/failed/aborted 不得 PASS）。 声明 SKIP 或上游 device_test.install SKIP
      时本检查 SKIP。
    severity: BLOCKER
  report_trace_reconciliation:
    description: >
      顶层 test-report.md「测试执行结果」须与 device_test_run 本轮选中的
      testing/reports/<ts>/hylyre/trace.json 全量对账（禁止以顶层 reports/trace.json 回填件为
      SSOT）。 报告写通过但 trace 失败/阻塞、结论达标但 trace.outcome≠success → BLOCKER FAIL。
    severity: BLOCKER
  report_reconcile_only:
    description: >
      testing 专属 --report-reconcile-only 只读本轮 authoritative trace、test-plan、最终
      device-test-timing、build/install/run meta 与当前报告输入，完整重跑 report/static
      checks 并由既有 writer 重算 script-report、summary、quality axes、repair
      candidates。该模式 不调用 hvigor、hdc、Hylyre、设备、视觉采集或可执行 lifecycle hook，不新增
      phase/sidecar， 且 authoritative trace 字节必须保持不变。门禁必须闭合同一最终 run 的 HAP
      路径/内容指纹、 build→install→run→timing 时间顺序、run 的 trace/report/log 路径、trace
      feature、timing pipeline 全字段与 reused 值、trace/timing 精确 case
      集合，以及报告中的最终流水线/逐 case duration 值；报告使用正确 skip 分母、最终 build/install reused
      状态和最终 timing。
    severity: BLOCKER
  ui_entry_coverage:
    description: >
      当 use-cases.yaml 中同一 user_actions.calls 存在多个 ui_bindings.ui 入口时， 派生 Hylyre
      计划须以 entry_ui / linked_flow / calls 结构化字段覆盖每个入口； P0 多入口缺派生覆盖 → BLOCKER
      FAIL；非 P0 → MAJOR FAIL；缺结构化字段 → MAJOR WARN。
    severity: MAJOR
  visual_diff:
    description: >
      设备渲染视觉回环（device_test.visual_diff）：Hylyre 截图 vs authoritative_refs 原图， 产出
      visual-diff.md / must-fix 清单与保真分（含几何 IoU）。QA 阶段级动作，非 test-plan
      派生步骤根键。warmup/无设备 → SKIP。 当 spec UI change=new_or_changed 且 P0 目标屏 visual
      verdict 全 pending 或未覆盖 → BLOCKER FAIL。 score_floor 已降级
      reference_only（P1-C·f2d8c4a6：像素直方图历史多次实测证伪，不参与任何判定）。
      P0-9（e7a91b3c）判定持久化：机器判定（pass/warn/fail）绑定 「被评截图文件 hash + build 指纹（实际 hap
      sha256 前 12 hex，现算）」——同 build 下 capture 跳采、判定跨 harness
      轮持久（像素恒等作新鲜度键已被真机时钟/轮播漂移证伪）；换 build/ 文件被换/legacy 缺指纹 → stale 重置重判。legacy
      confirmed_by 可读但无 gate 权重； 当前 deterministic/native/delegated
      机器证据决定结论，required 能力缺失走 capability defer。
    severity: MAJOR
    rule:
      provider: device_test.visual_diff
  visual_diff_text_placement:
    description: >
      P1-C（plan f2d8c4a6）：文本块二部匹配观测——参考图与设备截图各 OCR 行聚类后按 spec 文本
      二部匹配（子串冲突消解防短文本误配聚合行）。FAIL 级相对信号（对 device≠mockup 缩放不变、 确定性证据 VL
      verdict=pass 不可推翻）：参考图同一行的文本对实测分居两行（副标题右置被排成题下）、 纵向顺序 ≥2
      对颠倒（布局乱序）；pixel_1to1 P0 屏 → BLOCKER。存在性缺失/单对逆序为 advisory 观测素材（WARN 不阻断防设备
      OCR 噪声 FP），VL 终判须折算进 screens[].must_fix。 overlay 屏
      id（__overlay__*）归一化回落基屏。OCR/参考原图不可用 → degraded WARN 不静默。
    severity: BLOCKER
    rule:
      provider: device_test.visual_diff
  visual_reference_viewport:
    description: >
      plan b3d7e5a1 T5：参考图与实测截图（设备视口）尺寸兼容性前置门——在任何 pixel/OCR 内容比对之前判定。
      整页拼接参考图（宿主 expanded 4350 / all_banks 8312 对 2120 视口）不构成单视口合法像素参考：
      pixel_1to1 → BLOCKER FAIL，低档 → ratchet WARN；该屏从内容比对输入集合剔除，不得用原始长图产出内容结论；
      全部兼容 → 零结果（check 集合逐字不变）。出路=作者建模：长页按锚点拆成多个 viewport 尺寸 screen（各自 ref_id +
      nav 末步 scroll_to）。
    severity: BLOCKER
    rule:
      provider: device_test.visual_diff
  visual_diff_verdict_abandonment:
    description: >
      P0-2（9d4b7e21，声明补录——实现已随收尾批落地，本条补齐指纹纪律）：确定性 FAIL 弃判硬 backstop——某屏
      placement fail_signals 非空且 verdict=pending → BLOCKER 必报（不以 must_fix
      有无为条件防绕过）；details 合并 fail_signals 与该屏既有 must_fix 作现成回修指令。 fail 屏须
      verdict=fail + 信号逐条转录进该屏 must_fix，禁止"无人值守不可闭环"式弃判。 （v23 F5：**testing
      阶段禁止修改产品源码**——修码由 runner 消费 must_fix 回退 coding 执行，不在 testing
      重试轮内进行；旧文案"重试轮内修码重测"作废。）
    severity: BLOCKER
    rule:
      provider: device_test.visual_diff
  visual_diff_tamper_artifact:
    description: >
      P0-7③（c9e2a7f4）：伪签物证扫描——feature testing/device-testing 目录内脚本文件内容同时 命中「引用
      visual-diff.json」与改判特征（程序化填 confirmed_by/verdict=pass、批量重置 pending、清空/删除
      must_fix、写 evaluated_screenshot_hash）→ BLOCKER 物证上桌。 2026-07-05
      实锤：auto-fill（NODE_OPTIONS 预加载 hook）/fill-pass/reset 三脚本成套伪签 流水线。判定只能由当前
      hash-bound 机器证据产生；正常读取/统计脚本不误伤（须双条件同中）。
    severity: BLOCKER
    rule:
      provider: device_test.visual_diff
  report_required_chapters:
    description: |
      测试报告必须包含以下章节： 测试概览、测试执行结果、缺陷清单（如有）、通过率统计、结论
    severity: BLOCKER
    rule:
      file: test-report.md
      expected_headings:
        - 测试概览
        - 测试执行结果
        - '"通过率" or "通过率统计"'
        - '"结论" or "测试结论"'
      match: heading_text_contains
  execution_result_table:
    description: >
      「测试执行结果」必须包含每条用例的执行状态表， 状态值限于：通过 / 失败 / 阻塞 / 跳过，并包含最终 run 的耗时列；耗时使用精确整数 毫秒
      `Nms`（读取侧可兼容合法千分位）；已进入 trace/timing 的 skip/block case 使用 `0ms`， 未进入
      trace/timing 的用例（非 hylyre 通道或历史 legacy skip）使用 `—`。
    severity: BLOCKER
    rule:
      file: test-report.md
      section: 测试执行结果
      expect: markdown_table
      required_columns:
        - 用例编号
        - '"执行状态" or "结果"'
        - '"耗时" or "duration"'
      allowed_status:
        - 通过
        - 失败
        - 阻塞
        - 跳过
  pass_rate_calculated:
    description: |
      「通过率统计」必须包含各优先级的通过率数值， 以及总体通过率
    severity: BLOCKER
    rule:
      file: test-report.md
      section: 通过率
      expect:
        per_priority_rate:
          - P0
          - P1
          - P2
        overall_rate: true
  defect_table_format:
    description: |
      如有失败用例，「缺陷清单」必须包含： 缺陷编号、关联用例、严重程度、描述、状态（待修复/已修复/已关闭）
    severity: MAJOR
    rule:
      file: test-report.md
      section: 缺陷清单
      condition: has_failed_cases
      expect: markdown_table
      required_columns:
        - 缺陷编号
        - 关联用例
        - 严重程度
        - 描述
        - 状态
  report_conclusion_with_verdict:
    description: |
      报告结论必须包含明确的判定：达标 / 有条件达标 / 不达标， 并引用通过率数据
    severity: BLOCKER
    rule:
      file: test-report.md
      section: 结论
      expect: verdict
      allowed_values:
        - 达标
        - 有条件达标
        - 不达标
  metadata_header:
    description: |
      测试计划和报告顶部必须包含模块标识、版本、日期、测试人员等元数据
    severity: MINOR
    rule:
      expect: blockquote_metadata
      required_fields:
        - 模块标识
        - 版本
        - 日期
semantic_checks:
  test_case_completeness:
    description: |
      测试用例应覆盖所有核心业务路径，包括正常流程和异常流程
    severity: MAJOR
    ai_prompt_hint: |
      对比 spec 业务流程图，检查测试用例是否覆盖了： (1) 所有正常路径；(2) spec 中定义的异常场景； (3) 关键的用户交互路径
  test_steps_reproducible:
    description: |
      每条测试用例的「测试步骤」必须足够详细， 让任何人都能按步骤重复执行
    severity: MAJOR
    ai_prompt_hint: |
      审查测试步骤：(1) 每步操作是否明确（点击什么、输入什么）； (2) 是否有遗漏的中间步骤；(3) 步骤顺序是否正确
  expected_result_specific:
    description: |
      每条用例的「预期结果」必须是可观察、可验证的， 不允许"正常显示"这类模糊描述
    severity: MAJOR
    ai_prompt_hint: |
      检查预期结果：(1) 是否描述了具体可见的 UI 变化； (2) 是否有明确的验证点（文字内容、颜色、状态等）
  nfr_test_coverage:
    description: |
      spec 中的非功能性需求（性能指标、兼容性等） 应有对应的测试用例或测试策略
    severity: MAJOR
    ai_prompt_hint: |
      对照 spec 非功能性需求章节，检查测试计划中是否有对应的验证方案： 如首屏加载时间 ≤ 1.5s、Tab 切换 ≤ 300ms 等
  defect_severity_consistency:
    description: |
      缺陷严重程度评级应与其实际影响匹配： 阻断核心功能 → BLOCKER；影响主要功能 → MAJOR； 体验问题 → MINOR
    severity: MINOR
    ai_prompt_hint: |
      审查缺陷严重程度评级是否合理
  pass_criteria_met:
    description: |
      测试报告的结论必须与通过率数据一致： 如果 P0 通过率 < 100%，结论不应为"达标"
    severity: BLOCKER
    ai_prompt_hint: |
      验证：(1) P0 通过率是否达到通过标准中定义的阈值； (2) 总体通过率是否达标；(3) 结论与数据是否一致
traceability_checks:
  acceptance_to_test_case:
    description: >
      acceptance.yaml 中 ut_layer∈{device,both} 的 P0/P1 criteria/boundaries 必须被
      test-plan.md 至少一条用例覆盖（「关联 AC」列）；c7e4a2d9 增补 P0 优先级 对齐锚（同 check 原地断言，不新立
      gate）：每个 device/both 的 P0 criterion 必须被 至少一条 priority=P0 的 TC 引用（复用
      parsePlanTcEntries 既有解析）——TC 从 P0 降为 P2 不得令其退出 P0 全分母并假绿；缺口 BLOCKER
      FAIL，owner=testing 恢复对齐。
    severity: BLOCKER
    rule:
      source: acceptance.yaml
      filter: ut_layer in ["device","both"] and priority in ["P0","P1"]
      target: test-plan.md > 测试用例清单.关联 AC
      coverage: 100%
  test_plan_freshness_vs_acceptance:
    description: |
      acceptance.yaml 的 mtime 不得新于 test-plan.md（否则须按 acceptance 重派生 plan）
    severity: BLOCKER
    rule:
      compare_mtime:
        newer: acceptance.yaml
        older_must_be: test-plan.md
  plan_references_unit_layer_ac:
    description: >
      按 TC 引用形态分档：某条 TC 仅关联 ut_layer=unit 的 AC/BD（且无 NFR 引用）时 BLOCKER （该 TC 应由
      business-ut 覆盖，须从 test-plan 删除，不得改标 manual 通道）； 混合引用（unit + device/both 或
      NFR）仅 WARN。 在任何 build/install/device 动作之前裁决，BLOCKER 时零设备调用。
    severity: BLOCKER
    rule:
      source: test-plan.md > 测试用例清单.关联 AC
      block_if_all_refs: ut_layer == "unit" and no NFR ref
      warn_if_any_ref: ut_layer == "unit"
      skip_if: >
        该 TC 不裁决：引用为空；含无法解析的编号；引用的 AC/BD 未声明 ut_layer； 用例编号建立不了 TC-N 关联（交
        acceptance_to_test_case / test_case_to_acceptance /
        acceptance_ut_layer_complete 与编号结构检查）
  test_case_to_acceptance:
    description: |
      每条测试用例必须关联到至少一个验收标准（AC 编号）
    severity: MAJOR
    rule:
      source: test-plan.md > 测试用例清单
      column: 关联 AC
      expect: non_empty
  exception_scenario_coverage:
    description: |
      spec 异常场景表中的每个场景应有对应的测试用例
    severity: MAJOR
    rule:
      source: spec.md > 异常/边界场景处理
      target: test-plan.md > 测试用例清单
      match: scenario_covered
  plan_to_report_consistency:
    description: |
      测试报告中的用例编号必须与测试计划中的用例编号一一对应， 不允许报告中出现计划中未定义的用例
    severity: BLOCKER
    rule:
      source: test-report.md > 测试执行结果.用例编号
      target: test-plan.md > 测试用例清单.用例编号
      coverage: bidirectional
  boundary_coverage:
    description: |
      Spec 中定义的边界场景（doc/features/{module}/boundaries.yaml） 应被测试计划覆盖
    severity: MAJOR
    rule:
      source: doc/features/{module}/boundaries.yaml
      target: test-plan.md > 测试用例清单
      match: boundary_id_covered
  defect_to_test_case:
    description: |
      缺陷清单中每个缺陷的「关联用例」必须指向测试用例清单中的有效编号
    severity: MAJOR
    rule:
      source: test-report.md > 缺陷清单.关联用例
      target: test-plan.md > 测试用例清单.用例编号
      match: valid_reference

```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-testing.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{
  "phase": "testing",
  "feature": "demo-card",
  "timestamp": "2026-09-25T04:33:30.946Z",
  "project_root": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur",
  "assurance": "degraded",
  "capability_resolutions": [
    {
      "id": "capability_testing_cases",
      "axis": "evidence",
      "active": true,
      "state": "resolved",
      "on_missing": "fail",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "cases",
          "state": "resolved",
          "selected_source": "acceptance@1",
          "selected_source_fingerprint": "352b678a652cf596cc0cb311600a4590404c3d9ef08267470b868b529866a080",
          "binding": {
            "input_id": "cases",
            "source": {
              "kind": "artifact",
              "artifact": "acceptance@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\acceptance.yaml",
                "exists": true,
                "sha256": "b0e125f7bf85e4a13539c65fedc059e82f6d5b74f9d17b2204fe0ebbdb236f03",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/demo-card/acceptance.yaml"
            ],
            "content_fingerprint": "352b678a652cf596cc0cb311600a4590404c3d9ef08267470b868b529866a080"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "acceptance@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\acceptance.yaml",
                  "exists": true,
                  "sha256": "b0e125f7bf85e4a13539c65fedc059e82f6d5b74f9d17b2204fe0ebbdb236f03",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "spec",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\acceptance.yaml"
            }
          ]
        }
      ]
    },
    {
      "id": "capability_testing_code_context",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "fail",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "tested_code",
          "state": "resolved",
          "selected_source": "derive.codebase",
          "selected_source_fingerprint": "6db8928e705ecd20f4e070aaf48cc0f312adaff61aef2b6fd1b8b6f6596a67b6",
          "binding": {
            "input_id": "tested_code",
            "source": {
              "kind": "derive",
              "provider_id": "derive.codebase"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\index.ets",
                "exists": true,
                "sha256": "c42372f3cbb70378e8050f918322ab85b85a706f5b51c303961ded13d16a51bb",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\AllBanksPage.ets",
                "exists": true,
                "sha256": "e9e1d7080d2bd7504115df6e88d94a4ed5eebe19aab033c2268927a5a6c61b95",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankListItem.ets",
                "exists": true,
                "sha256": "727e9a2af8334e09b414a53e04f94b7fea76875d30bd73af6307a957b58b9e5f",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankModel.ets",
                "exists": true,
                "sha256": "85bf14be522a0c0815a787be2b9e1f739e86be41fb8a25b9f83f47324996b1c4",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankRepository.ets",
                "exists": true,
                "sha256": "fa10a20e27b5fa016f02a0e0608747e1f892974bb0a6cf10f7f3021e3ac3c907",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankService.ets",
                "exists": true,
                "sha256": "bca6edbcaabe61fba6090d8f396f0105962a18d13dc2eacd88d0802d58045fb6",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\resources\\base\\media\\logo_demo.png",
                "exists": true,
                "sha256": "6d51ea2402770798273a2f11d1a64aa04eb290df7790eaaa38ad61420bfeeb1c",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\resources\\base\\media\\result_demo.png",
                "exists": true,
                "sha256": "0672172608dc6517fd62993f139ade74279b32c3a2e5ee63f425e40f23de9421",
                "role": "derive"
              }
            ],
            "source_refs": [
              "02-Feature/FinancialCard/index.ets",
              "02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets",
              "02-Feature/FinancialCard/src/main/ets/BankModel.ets",
              "02-Feature/FinancialCard/src/main/ets/BankRepository.ets",
              "02-Feature/FinancialCard/src/main/ets/BankService.ets",
              "02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png",
              "02-Feature/FinancialCard/src/main/ets/BankListItem.ets",
              "02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png"
            ],
            "content_fingerprint": "6db8928e705ecd20f4e070aaf48cc0f312adaff61aef2b6fd1b8b6f6596a67b6"
          },
          "attempts": [
            {
              "kind": "derive",
              "source": "derive.codebase",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\index.ets",
                  "exists": true,
                  "sha256": "c42372f3cbb70378e8050f918322ab85b85a706f5b51c303961ded13d16a51bb",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\AllBanksPage.ets",
                  "exists": true,
                  "sha256": "e9e1d7080d2bd7504115df6e88d94a4ed5eebe19aab033c2268927a5a6c61b95",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankModel.ets",
                  "exists": true,
                  "sha256": "85bf14be522a0c0815a787be2b9e1f739e86be41fb8a25b9f83f47324996b1c4",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankRepository.ets",
                  "exists": true,
                  "sha256": "fa10a20e27b5fa016f02a0e0608747e1f892974bb0a6cf10f7f3021e3ac3c907",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankService.ets",
                  "exists": true,
                  "sha256": "bca6edbcaabe61fba6090d8f396f0105962a18d13dc2eacd88d0802d58045fb6",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\resources\\base\\media\\logo_demo.png",
                  "exists": true,
                  "sha256": "6d51ea2402770798273a2f11d1a64aa04eb290df7790eaaa38ad61420bfeeb1c",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\ets\\BankListItem.ets",
                  "exists": true,
                  "sha256": "727e9a2af8334e09b414a53e04f94b7fea76875d30bd73af6307a957b58b9e5f",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\02-Feature\\FinancialCard\\src\\main\\resources\\base\\media\\result_demo.png",
                  "exists": true,
                  "sha256": "0672172608dc6517fd62993f139ade74279b32c3a2e5ee63f425e40f23de9421",
                  "role": "derive"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "capability_testing_design_context",
      "axis": "evidence",
      "active": true,
      "state": "pruned",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "contracts",
          "state": "resolved",
          "selected_source": "contracts@1",
          "selected_source_fingerprint": "93c49db2c4ed32f462a1dd1f4c29e576704f41b04f53b5f9b457dd86597fa8c1",
          "binding": {
            "input_id": "contracts",
            "source": {
              "kind": "artifact",
              "artifact": "contracts@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\contracts.yaml",
                "exists": true,
                "sha256": "62d1104bc2c30d70e590280deb55788b3cca87b43442882ffc1635caa2931db0",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/demo-card/contracts.yaml"
            ],
            "content_fingerprint": "93c49db2c4ed32f462a1dd1f4c29e576704f41b04f53b5f9b457dd86597fa8c1"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "contracts@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\contracts.yaml",
                  "exists": true,
                  "sha256": "62d1104bc2c30d70e590280deb55788b3cca87b43442882ffc1635caa2931db0",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\contracts.yaml"
            }
          ]
        },
        {
          "id": "use_cases",
          "state": "absent",
          "selected_source": null,
          "selected_source_fingerprint": null,
          "attempts": [
            {
              "kind": "artifact",
              "source": "use-cases@1",
              "state": "absent",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\demo-card\\use-cases.yaml",
                  "exists": false,
                  "sha256": null,
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "use-cases@1 missing"
            }
          ]
        }
      ]
    }
  ],
  "capability_resolution_contract_fingerprint": "4a58dc938b02f3120902bd2dd9a71c6b0c606528c37391d3a8d489c599a96930",
  "checks": [
    {
      "id": "plan_references_unit_layer_ac",
      "category": "traceability",
      "description": "按 TC 引用形态分档：某条 TC 仅关联 ut_layer=unit 的 AC/BD（且无 NFR 引用）时 BLOCKER （该 TC 应由 business-ut 覆盖，须从 test-plan 删除，不得改标 manual 通道）； 混合引用（unit + device/both 或 NFR）仅 WARN。 在任何 build/install/device 动作之前裁决，BLOCKER 时零设备调用。",
      "severity": "MINOR",
      "status": "SKIP",
      "details": "无 ut_layer=unit 的 AC/BD。",
      "source": "check-testing.ts"
    },
    {
      "id": "ui_entry_coverage",
      "category": "structure",
      "description": "当 use-cases.yaml 中同一 user_actions.calls 存在多个 ui_bindings.ui 入口时， 派生 Hylyre 计划须以 entry_ui / linked_flow / calls 结构化字段覆盖每个入口； P0 多入口缺派生覆盖 → BLOCKER FAIL；非 P0 → MAJOR FAIL；缺结构化字段 → MAJOR WARN。",
      "severity": "MAJOR",
      "status": "SKIP",
      "details": "use-cases.yaml 不存在或无 use_cases，跳过 UI 入口覆盖检查。",
      "source": "check-testing.ts"
    },
    {
      "id": "boundary_coverage",
      "category": "traceability",
      "description": "边界场景应被测试计划覆盖",
      "severity": "MAJOR",
      "status": "SKIP",
      "details": "acceptance.yaml 无 boundaries 列表。",
      "source": "check-testing.ts"
    },
    {
      "id": "runtime_mount_conformance",
      "category": "structure",
      "description": "结构保真·运行时挂载轴（声明元素在设备 uitree 实际挂载；声明在而未挂载不计分）",
      "severity": "MINOR",
      "status": "SKIP",
      "details": "无设备 uitree dump（layout-*.json）——运行时挂载轴不适用（无设备环境不装死；静态轴照常）。",
      "source": "check-testing.ts"
    }
  ],
  "summary": {
    "total": 55,
    "pass": 51,
    "fail": 0,
    "warn": 0,
    "skip": 4,
    "blockers": 0,
    "verdict": "PASS"
  },
  "passed_check_ids": [
    "node_options_injection",
    "context_exploration_facts_phase_delta_present",
    "testing_execution_channel",
    "p0_identity_injection",
    "device_test_build",
    "device_test_install",
    "hylyre_evidence_gate",
    "device_test_run",
    "visual_diff_capture",
    "device_test_evidence",
    "plan_required_chapters",
    "test_case_table_format",
    "test_case_priority_values",
    "test_case_flow_consistency",
    "test_environment_defined",
    "pass_criteria_defined",
    "plan_metadata_header",
    "upstream_verdict_gate",
    "acceptance_yaml_present",
    "acceptance_content_complete",
    "acceptance_ut_layer_complete",
    "acceptance_device_focus_present",
    "legacy_device_testing_todo_deprecated",
    "device_case_contract",
    "test_plan_freshness_vs_acceptance",
    "acceptance_to_test_case",
    "test_case_to_acceptance",
    "test_report_generated",
    "report_trace_reconciliation",
    "report_required_chapters",
    "execution_result_table",
    "pass_rate_calculated",
    "defect_table_format",
    "report_conclusion_with_verdict",
    "negative_verdict_closure",
    "visual_debt_disclosure",
    "plan_to_report_consistency",
    "defect_to_test_case",
    "review_closure_attestation",
    "product_behavior_switch_scan",
    "p0_coverage_integrity",
    "p0_pass_rate_dual_metrics",
    "p0_semantic_coverage_integrity",
    "p0_runtime_step_evidence_boundary",
    "testing_case_execution_completeness",
    "testing_artifact_integrity",
    "hylyre_selector_runtime_gate",
    "p0_runtime_step_evidence",
    "testing_run_status",
    "capability_testing_cases",
    "capability_testing_code_context"
  ]
}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 7 项语义检查。每项都有具体的评估方法和判定标准。

### 检查 7: 真机自动化消费 (device_test_run_consumption)

- **严重等级**: BLOCKER（profile 将 `device_test.run` 声明为 BLOCKER 时） / SKIP（profile 声明 SKIP 时）
- **评估方法**:
  1. 若 profile **`device_test.run`** 为 SKIP → 整项 SKIP
  2. 检查派生可执行计划是否存在：`doc/features/demo-card/testing/reports/<某子目录>/hylyre/test-plan.hylyre.md`（选取规则以脚本为准：排除烟测占位，按 mtime 优先；非「字典序最新目录名」）
  3. 检查派生计划是否含 **`## 测试用例清单`** 标题锚点 + 7 列表头固定顺序（与 Hylyre `plan_parse` / `agent-plan-a` 一致）
  4. 检查顶层 `test-report.md` 是否含 **5 必填章节**：测试概览 / 测试执行结果 / 缺陷清单 / 通过率统计 / 结论
  5. 检查「测试执行结果」表格的「执行状态」列只出现 **4 状态**：通过 / 失败 / 阻塞 / 跳过
  6. 检查「结论」**verdict** 在 **3 枚举**内：达标 / 有条件达标 / 不达标
  7. **必读 Hylyre trace 并全量对账**：定位 `testing/reports/<ts>/hylyre/trace.json`（与脚本 `report_trace_reconciliation` 同源，**禁止**使用顶层 `testing/reports/trace.json` 回填件）。**逐条**核对 `trace.cases[].id/status` 与顶层 `test-report.md`「测试执行结果」表一致；报告写「通过」但 trace 为「失败/阻塞」→ FAIL
  8. **trace.outcome 硬规则**：若 `trace.outcome !== success`（含 partial/failed/aborted），verifier **不得**给出 summary.verdict=PASS；报告结论=「达标」但 trace 非 success → FAIL
  9. **TC 编号一致性（execution_channel SSOT）**：顶层 `test-plan.md` 每条 TC 声明唯一 **`execution_channel`**（`hylyre|visual|manual:<gap_class>|provider:<capability-id>`）；派生计划的 TC 集合须与顶层 `channel=hylyre` 的集合**完全相等**——多出即 extra、缺失即 missing，都是脚本级 BLOCKER，`derive-hint-from-plan.json` 会带 `missing_tc_ids`。**不要用 `explicit_skip_tc_ids` 与派生表做并集**：正式派生计划登记 `explicit_skip_tc_ids` 本身就是 BLOCKER。known manual gap / inactive provider 才是 `unsupported_gap`；裸/未知 manual、未登记或 active 无 producer 的 provider 在跑机前判 `invalid_test`。非 `hylyre` 通道不进派生表
  11. **导航步骤静态门禁（NAV-001/002/003）**：脚本 `check-testing` 在真机 run 前校验派生表 JSON——禁止无 `area`/`at` 的横向 `swipe` 充当 Nav 返回；前序 TC 进入子页后、后续 TC 要求首页 Tab 时首步须 `back` 等。失败则 `coverage_reason=invalid_derived_steps`，须按 `derive-hint-from-plan.json` 的 `lint_violations` 与 `navigation_hint` **重新派生**（勿手改旧 timestamp 目录）
  12. **多 UI 入口覆盖（语义）**：若 `use-cases.yaml` 中同一 `user_actions.calls` 有多个 `ui_bindings.ui` 入口，派生 Hylyre 计划须各入口至少一条带 `entry_ui` 的用例；P0 缺覆盖 → 与脚本 `ui_entry_coverage` 一致判 FAIL

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
  2. 阅读测试报告中的「通过率统计」
  3. 验证：
     - P0 通过率是否达到通过标准中定义的阈值
     - 总体通过率是否达标
     - 结论（达标/有条件达标/不达标）是否与数据一致
     - **须与 Hylyre trace 一致**：若 `trace.outcome !== success` 或 trace 含失败/阻塞 case，结论不得为「达标」
  4. 若测试报告尚未生成，标为 WARN

### 检查 8: 视觉 diff 双向残差 (visual_diff_bidirectional)

- **严重等级**: BLOCKER（硬像素契约：`fidelity_target: pixel_1to1` **且** `acceptance_strictness: hard`，以 `spec/reports/fidelity-intent.json` 的 `effective_fidelity` / `acceptance_strictness` 为准）/ 否则 MAJOR
- **评估方法**:
  1. 读取 `device-testing/device-screenshots/visual-diff.json`：每屏须含 `reverse_missing[]`（逐元素枚举，可为 `[]`）
  2. 对照 `spec/ref-elements.yaml`：`disposition: implement` 的元素须在 ui-spec 覆盖，或出现在某屏 `reverse_missing`
  3. `must_fix` / `verdict=fail` 须逐元素说明；脚本 FAIL/BLOCKER 时本项 FAIL
  4. **G3 样式/布局逐项核对（pixel_1to1）**：对 ui-spec 声明了 `variant` / `layout_group` / `align` / `width_ratio` / `bg_color` 的节点，逐一在真机截图上核对——按钮填充形态是否匹配 `variant`（实心/tonal/描边/幽灵/纯文字）、同 `layout_group` 元素是否真同行、`align`/`width_ratio` 是否一致（治"全宽 vs 右侧药丸"）、区域 `bg_color` 是否匹配（治灰底 vs 蓝底）。不符按档位处理：
     - **硬像素契约**（pixel_1to1 ∧ hard）：不符写入对应屏 `must_fix`，视为保真残差，任何非空 must_fix 一档回退 coding
     - **软档**（其余档位，含 pixel_1to1 ∧ best_effort）：执行者/VL 自报的 **major** 样式不符记为该屏 `defects[]`（severity=major，以 `must_fix_refs` 引用对应 must_fix），并在 `must_fix` 里写清修法；harness gate 会按档位把该屏降级为视觉债务并披露在 `downgraded_screens`——不阻断阶段推进、不驱动回退，但**仍阻断发布**直到修复重验。纯 minor 残差只记 `defects[]`（severity=minor）披露，不因此新写 must_fix。不要因这类自报样式残差把本项判 BLOCKER 或要求整链回退
     - 两档都不降级、照现有规则 FAIL 并回退 coding：确定性失败（T8 布局检测命中、缺 `by_id` 锚点、`verdict=fail`、blocker 缺陷、未被 defect 锚定的 must_fix）以及你新发现的核心操作走不通/结果错/关键信息缺失或不可读类问题（记 blocker）
  5. A/B/C 边界：C 类动态交互不在静态参考图承诺内

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 逐条核对本阶段产物里的跨文件引用——test-report 引述的结论、失败原因、截图路径 ↔ trace.json 与 device-screenshots 原文；「通过/失败」计数 ↔ trace 里的 case 状态。每条引用都要打开被引用的原文核对，不凭记忆、不凭上下文摘要。
- **判定标准**: 引用对象存在且含义一致 → PASS；个别引用漂移（行号/名称过期但对象仍可定位） → WARN；关键引用指向不存在或含义相反的对象 → FAIL
- **证据**: 列出核对过的引用（`引用 → 原文位置`）与不一致项


---

## 六、上下文文件

以下是本次验证的上下文：被审产物与直接依据内联；上游文档与源码只给**路径清单**，需要核对时用 Read 按路径读取，不要全量通读。

被审 feature 根目录：`doc/features/demo-card/`（相对仓根；下方清单里的相对路径同样相对仓根）。

### (resolved input cases)

```
feature: demo-card
source: approved
version: "1"
flows:
  open_card:
    - all_banks
    - open_card_entry
criteria:
  - id: AC-1
    feature: F2
    description: 点击银行条目进入开卡流程
    target: 银行条目
    priority: P0
    testable: true
    verification_steps:
      - 在全部银行页点击银行条目
    expected_result: 进入开卡流程页
    ut_layer: device
    device_focus: 真机点击银行条目核对跳转开卡流程
    linked_flow: open_card
    checkpoint:
      pre_screen: all_banks
      action:
        type: touch
        target_element_id: bank_row_cmb
      post_screen: open_card_entry
      required_element_ids:
        - open_card_title
    requirement_ref:
      source_path: doc/features/demo-card/requirements/requirement.md
      snippet: 点击银行条目进入开卡流程
  - id: AC-2
    feature: F1
    description: 银行列表展示
    target: 银行列表
    priority: P1
    testable: true
    verification_steps:
      - 打开全部银行页
    expected_result: 列表展示银行条目
    ut_layer: both
    ut_focus: AllBanksPage 列表渲染
    device_focus: 真机打开全部银行页核对列表渲染
boundaries: []

```

### (resolved input tested_code)

```
- path: 02-Feature/FinancialCard/index.ets
  content: |
    export { AllBanksPage } from './src/main/ets/AllBanksPage';
    export { BankListItem } from './src/main/ets/BankListItem';
- path: 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  content: |
    import { BankListItem } from './BankListItem';
    import { BankRepository } from './BankRepository';

    @Component
    export struct AllBanksPage {
      @State banks: string[] = new BankRepository().list();
      @State sheetVisible: boolean = false;

      @Builder
      openCardSheet() {
        Column() {
          Text('开卡申请').id('open_card_title')
        }
      }

      sheetTag(phase: string): string {
        return `${phase}`;
      }

      build() {
        Column() {
          Text("全部银行")
          ForEach(this.banks, (b: string) => {
            BankListItem({ bank: { id: b, name: b } })
              .onClick(() => { this.sheetVisible = true; })
          })
        }
        .bindSheet($$this.sheetVisible, this.openCardSheet(), {
          title: { title: this.sheetTag('open_card') },
        })
      }
    }
- path: 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  content: |
    export interface BankModel {
      id: string;
      name: string;
    }
- path: 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  content: |
    export class BankRepository {
      list(): string[] { return []; }
    }
- path: 02-Feature/FinancialCard/src/main/ets/BankService.ets
  content: |
    export class BankService {
      openCard(id: string): Promise<boolean> { return Promise.resolve(!!id); }
    }
- path: 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png
  sha256: 6d51ea2402770798273a2f11d1a64aa04eb290df7790eaaa38ad61420bfeeb1c
  binary: true
- path: 02-Feature/FinancialCard/src/main/ets/BankListItem.ets
  content: |
    import { BankModel } from './BankModel';

    @Component
    export struct BankListItem {
      @Prop bank: BankModel;
      build() {
        Text(this.bank.name).id('bank_row_cmb')
      }
    }
- path: 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png
  sha256: 0672172608dc6517fd62993f139ade74279b32c3a2e5ee63f425e40f23de9421
  binary: true

```

### (resolved input contracts)

```
feature: demo-card
source: approved
version: "1"
modules:
  - name: FinancialCard
    layer: 02-Feature
    package_path: 02-Feature/FinancialCard
files:
  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  - 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  - 02-Feature/FinancialCard/src/main/ets/BankService.ets
  - 02-Feature/FinancialCard/index.ets
  - 02-Feature/FinancialCard/src/main/ets/BankListItem.ets
  - 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png
  - 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png
module_dependencies: {}
data_models: []
interfaces: []
components: []
prd_to_code_traceability:
  - prd_id: AC-1
    key_files:
      - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - prd_id: AC-2
    key_files:
      - 02-Feature/FinancialCard/src/main/ets/BankService.ets

```

### doc/features/demo-card/testing/test-plan.md

```
# 测试计划

> **模块标识**: FinancialCard
> **版本**: 1.0
> **日期**: 2026-01-01

## 1. 测试范围

FinancialCard 的全部银行页列表展示与开卡入口。

```yaml
test_case_flow:
  TC-001:
    precondition:
      kind: fresh_app
      reset: restart
  TC-002:
    precondition:
      kind: fresh_app
      reset: restart
```

## 2. 测试环境

| 项 | 取值 |
|----|------|
| 设备 | 真机 |
| 系统版本 | HarmonyOS 5.0 |
| API | API 12 |
| 构建 | default product |

## 3. 测试策略

按验收标准逐条走真机自动化通道。

## 4. 测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | 开卡入口 | 冷启动 | 点击银行条目并等待开卡页标题 | 进入开卡流程页 | P0 | AC-1 | hylyre |
| TC-002 | 银行列表展示 | 冷启动 | 打开全部银行页并等待列表条目 | 列表展示银行条目 | P1 | AC-2 | hylyre |

## 5. 通过标准

P0 用例通过率 100%，整体用例通过率 >= 95%，且无 BLOCKER 缺陷。

## 6. 风险与依赖

| 风险 | 缓解 |
|------|------|
| 设备不可用 | 重新分配设备 |

```

### doc/features/demo-card/testing/test-report.md

```
<!-- maison:generated:test-report v1 -->
# 测试报告 — demo-card

> **模块标识**: `demo-card`
> **版本**: harness-generated 2026-09-25T04:33:18.969Z
> **日期**: 2026-09-25T04:33:18.969Z
> **测试执行人**: harness（机器生成；agent 观察见 testing/notes.md）
> **对应测试计划**: `doc/features/demo-card/testing/test-plan.md`
> **权威 run**: `doc/features/demo-card/testing/reports/20260925T043319Z-962/hylyre/trace.json`（trace sha256 ef1149813a0fb8ca）

> 本文件由 harness 从 trace / timing / meta / gaps / visual-diff / visual-debt / measure / stability 整份生成，重跑 harness 或 `--report-reconcile-only` 会重写；请勿手改，观察与决策写 `testing/notes.md`。

---

## 一、测试概览

| 项目 | 内容 |
|------|------|
| 测试模块 | demo-card |
| 测试日期 | 2026-09-25T04:33:18.969Z |
| 测试环境 | hylyre 0.5.1, hypium 5.0.7.200 |
| 执行人 | harness（机器生成） |
| 用例总数 | 2 |
| 执行用例数 | 2 |
| 跳过用例数 | 0 |

### 真机流水线耗时

> 数据来源：device-test-timing.json（harness 在 device_test.run 成功后写入）；耗时为精确整数毫秒，`—` 表示无数据。

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 打包 (hvigor) | — | 本轮构建; `reused=false` |
| 装机 (hdc) | — | 本轮安装; `reused=false` |
| Hylyre 自动化 | 1000ms | 含设备预启动 |
| 快照写入 (page save) | — | 非致命 |
| **合计（脚本统计）** | **—** | harness 各阶段之和（writer 为 null 时为 —） |

| 元数据 | 值 |
|--------|-----|
| HAP 落盘时间 (hapBuiltAt) | — |
| 本次 harness 跑 build 门禁时刻 | — |

---

## 二、测试执行结果

| 用例编号 | 用例名称 | 优先级 | 执行状态 | 耗时 | 备注 |
|----------|---------|--------|---------|------|------|
| TC-001 | 开卡入口 | P0 | 通过 | 20ms |  |
| TC-002 | 银行列表展示 | P1 | 通过 | 20ms |  |

### 稳定性（同执行键跨轮）

| 用例编号 | 同键轮数 | 一致轮数 | 首个分歧 step |
|----------|---------|---------|--------------|
| TC-001 | 1 | 1 | — |
| TC-002 | 1 | 1 | — |

---

## 三、缺陷清单

无缺陷：所有已执行用例全部通过，视觉屏无 fail/warn。

### 缺陷统计

| 严重程度 | 数量 | 待修复 | 已修复 | 已关闭 | 延期处理 |
|---------|------|--------|--------|--------|---------|
| BLOCKER | 0 | 0 | 0 | 0 | 0 |
| MAJOR | 0 | 0 | 0 | 0 | 0 |
| MINOR | 0 | 0 | 0 | 0 | 0 |
| **合计** | **0** | **0** | **0** | **0** | **0** |

---

## 四、通过率统计

| 优先级 | 总用例 | 通过 | 失败 | 阻塞 | 跳过 | 通过率 | 达标阈值 | 是否达标 |
|--------|--------|------|------|------|------|--------|---------|---------|
| P0 | 1 | 1 | 0 | 0 | 0 | 100% | 100% | ✅ |
| P1 | 1 | 1 | 0 | 0 | 0 | 100% | ≥ 95% | ✅ |
| **总计** | **2** | **2** | **0** | **0** | **0** | **100%** | **≥ 90%** | **✅** |

> 通过率 = 通过 / 总用例；unsupported_gap 留在总用例分母、不计入通过（P0 五数口径见 summary.json p0_coverage_integrity.structured）。

---

## 五、结论

**测试结论**: 有条件达标

**按轴结论**（确定性派生）:
- 功能：PASS（hylyre 2/2 通过，失败 0，阻塞 0，trace.outcome=success）
- 交互稳定性：UNKNOWN（2 条用例有同键多轮数据）
- 视觉几何：UNKNOWN（无 visual-diff.json）
- 视觉内容：UNKNOWN
- 视觉样式：UNKNOWN
- 已知缺口：3 项
  - 视觉几何 UNKNOWN
  - 视觉内容/样式 UNKNOWN（无 provider 复核）
  - 交互稳定性 UNKNOWN（同执行键真实执行不足 2 轮，单轮不构成稳定性证据）
- 总体：COMPLETE_WITH_GAPS

**判定依据**:
- P0 通过率: 100%（阈值 100%）
- P1 通过率: 100%（阈值 ≥ 95%）
- 总体通过率: 100%（阈值 ≥ 90%）
- BLOCKER 缺陷: 0 个
- 视觉债务 0 条

**下一步建议**:
- 功能完成可推进；已知缺口按条目在需求/spec 登记并披露，视觉缺口不阻止功能完成但阻断 release_readiness。

```

### doc/features/demo-card/context/facts.md

```
---
schema_version: "1.1"
feature: demo-card
run_id: 20260925T043142Z-233c9c
established_by: spec
ready_to_produce: true
has_blocker_coverage_risk: false
exploration_mode: sequential
key_inputs_read:
  - doc/glossary.yaml
  - doc/module-catalog.yaml
  - doc/architecture.md
subagents_used: none
decisions_unlocked:
  - all_banks_page_list
files_inspected_count: 9
searches_performed_estimate: 6
source_code_paths:
  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets
  - 02-Feature/FinancialCard/src/main/ets/BankRepository.ets
  - 02-Feature/FinancialCard/src/main/ets/BankModel.ets
  - 02-Feature/FinancialCard/src/main/ets/BankService.ets
  - 02-Feature/FinancialCard/index.ets
---

## Code Facts

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets | AllBanksPage 目前只渲染标题文本 | 列表需新增 |
| 02-Feature/FinancialCard/src/main/ets/BankRepository.ets | BankRepository.list 返回空数组 | 列表数据源需接入 |
| 02-Feature/FinancialCard/src/main/ets/BankModel.ets | BankModel 已定义银行字段 | 列表条目直接复用 |
| 02-Feature/FinancialCard/src/main/ets/BankService.ets | BankService 暴露 openCard 入口 | 点击回调接它 |
| 02-Feature/FinancialCard/index.ets | index.ets 已导出 AllBanksPage | 新增组件需同步导出 |

## phase_delta: spec

本阶段研究结论已确认。

## phase_delta: plan

本阶段研究结论已确认。

## phase_delta: coding

本阶段研究结论已确认。

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| 02-Feature/FinancialCard/src/main/ets/BankListItem.ets | coding 新建的列表条目组件 | 本阶段按它继续 |
| 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png | 既有银行标识图（二进制，按路径引用） | 不改 |
| 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png | coding 新建的开卡结果图（二进制，按路径引用） | 本阶段按它继续 |

## phase_delta: review

本阶段研究结论已确认。

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| 02-Feature/FinancialCard/src/main/ets/BankListItem.ets | coding 新建的列表条目组件 | 本阶段按它继续 |
| 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png | 既有银行标识图（二进制，按路径引用） | 不改 |
| 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png | coding 新建的开卡结果图（二进制，按路径引用） | 本阶段按它继续 |

## phase_delta: ut

本阶段研究结论已确认。

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| 02-Feature/FinancialCard/src/main/ets/BankListItem.ets | coding 新建的列表条目组件 | 本阶段按它继续 |
| 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png | 既有银行标识图（二进制，按路径引用） | 不改 |
| 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png | coding 新建的开卡结果图（二进制，按路径引用） | 本阶段按它继续 |

## phase_delta: testing

本阶段研究结论已确认。

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| 02-Feature/FinancialCard/src/main/ets/BankListItem.ets | coding 新建的列表条目组件 | 本阶段按它继续 |
| 02-Feature/FinancialCard/src/main/resources/base/media/logo_demo.png | 既有银行标识图（二进制，按路径引用） | 不改 |
| 02-Feature/FinancialCard/src/main/resources/base/media/result_demo.png | coding 新建的开卡结果图（二进制，按路径引用） | 本阶段按它继续 |

```

### 按需读取的文件（未内联 · 需要核对时用 Read 按路径读取，不要全量通读）

- `doc/features/demo-card/testing/reports/20260925T043319Z-962/hylyre/trace.json` — 5958 bytes; authoritative native trace

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
  feature: "demo-card"
  timestamp: "2026-09-25T04:33:30.959Z"
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

> **你收到的 Task prompt 是一份 request JSON**（`kind: "maison_verifier_request"`），
> 不是本文件全文。按其中的 `prompt_path` 用 Read 工具读取磁盘上的 `ai-prompt.md`，
> 那才是本轮要审的材料（可达上百 KB，刻意不走传输面）。
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
> 若你收到的**不是**这样一份 request JSON（例如被手抄成模板、只给了 feature/phase，
> 或 JSON 前后夹带了额外指令）：照常输出审查结论，并在正文显著位置说明
> 「未收到合法 verifier request，本次报告不可入闭环，请调用方把
> `summary.verifier_request` 指向的 JSON 整段重投」。**不要自行编造 subject。**

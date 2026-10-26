# 真机测试阶段语义验证 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

> 自动生成于 2026-10-24T19:51:29.821Z
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

- **模块名称**: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
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
  testing_constraint_walkthrough:
    description: >
      应用域约束在本阶段的消费形态是**实机验证**：读 doc/extensions/knowledge/constraints/README.md
      的适用矩阵，取 testing 那一列， 逐个非「—」的格子核对——该域是否已按格子写明的方式在真机上走查/测量/核对过，
      并给出结论（命中该域时；未命中的写明依据）。命中判据与条目内容以该域文件为准。
      **本阶段是这些约束的最后一道关**：前面几个阶段能验的是「声明了」「写进代码了」，
      只有这里能验「在真机上确实是那样」。结论须具体到走查了什么、看到了什么， 「已验证」三个字不构成结论。 矩阵中标「—」的域本阶段不消费。
    severity: MAJOR
    ai_prompt_hint: >
      打开 doc/extensions/knowledge/constraints/README.md 找到适用矩阵，记下 testing 列
      所有非「—」的域及其验证方式（走查/测量/核对/故障注入各有各的做法，按格子字面执行）。
      逐域核对测试报告：做了没有、结论是什么、证据是什么（截图、数值、日志）。 **只写「符合要求」而没有可复核证据的，记为未验证**。
      需要人工在真机上操作而本轮未做的，如实记为待验证并说明阻塞原因，不要写成已通过。
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
exploration_thresholds: {}

```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-testing.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{
  "phase": "testing",
  "feature": "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93",
  "timestamp": "2026-10-24T19:51:24.645Z",
  "project_root": "D:\\1.code\\SimulatedWalletForHmos",
  "assurance": "full",
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
          "selected_source_fingerprint": "d46260b73f3fe267f8652ed4c4daee09642844add4db880539924bb16ed9c02b",
          "binding": {
            "input_id": "cases",
            "source": {
              "kind": "artifact",
              "artifact": "acceptance@1"
            },
            "dependencies": [
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\acceptance.yaml",
                "exists": true,
                "sha256": "60ca0798a0abd9f71e718c642dabb6e1fc5ce0713ac2c333fc7ad58964d1b3d6",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml"
            ],
            "content_fingerprint": "d46260b73f3fe267f8652ed4c4daee09642844add4db880539924bb16ed9c02b"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "acceptance@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\acceptance.yaml",
                  "exists": true,
                  "sha256": "60ca0798a0abd9f71e718c642dabb6e1fc5ce0713ac2c333fc7ad58964d1b3d6",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "spec",
              "detail": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\acceptance.yaml"
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
          "selected_source_fingerprint": "ef00b999011c756a17b4c7780bb32b32e022e4767a4457aecb53bad641a73447",
          "binding": {
            "input_id": "tested_code",
            "source": {
              "kind": "derive",
              "provider_id": "derive.codebase"
            },
            "dependencies": [
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\01-Product\\Phone\\src\\main\\ets\\navigation\\WalletDestinationRegistry.ets",
                "exists": true,
                "sha256": "248d0e20be41280480b38d4a71fde6ba3996b2a4a7087393e89730a76165629f",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\01-Product\\Phone\\src\\main\\ets\\pages\\index.ets",
                "exists": true,
                "sha256": "c3e17ad03316367064f60cab14d49481eaa5a2d551ba41bad24e6f1a16e6c8e5",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\BankCardCandidate.ets",
                "exists": true,
                "sha256": "238a6b9bebac812a23f666d32e6d6b69af1309c84a7056c302323309b5cc1f10",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\BankInfo.ets",
                "exists": true,
                "sha256": "44e0db74c0bac252e63a0da69af0aa986dec35c5132daf4be089ad50a3904992",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\BankOpeningCompletionContext.ets",
                "exists": true,
                "sha256": "619ba798be856082f337f52482d06ff7bf9b8f314febcbc33f01765e6e4f89ac",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\OpeningResult.ets",
                "exists": true,
                "sha256": "7aef81041f69bcee34c401167d41ef36fd4e8f956d138cfa446304afd3a0f625",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\StoredCard.ets",
                "exists": true,
                "sha256": "91f0e5ebc47d7524f4892824d72767feb0863ae429928aa98f2423c1afe7cf94",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\repository\\BankCardRepository.ets",
                "exists": true,
                "sha256": "e37016f70b00692092d863bcb5186c9d1e8bfe446f8d28c653b29a36fdf9ea78",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\repository\\BankRepository.ets",
                "exists": true,
                "sha256": "45e35adb9536871ae95b18228bed2871bc42d4be342a1c000ccd040880ef1e35",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\domain\\service\\BankCardOpeningService.ets",
                "exists": true,
                "sha256": "8b022f1ee0020e880b1bb799f2beb914d2d60c33f0da9dde41c187f7200af41b",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\domain\\service\\OpeningNavigationService.ets",
                "exists": true,
                "sha256": "c517e8551ee64be83792c9fb42370cd439f89bec4dfbffaec119ff9257bee088",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\domain\\service\\OtpService.ets",
                "exists": true,
                "sha256": "bbe518fdc1bbd88e60b98a96eacc7fef4759028d7e232ba189097e593665319f",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\index.ets",
                "exists": true,
                "sha256": "7a854693ef4c516d125b47eeff71115a65641cd46d6ee0d5950cff308829992f",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\components\\CardTypeSheet.ets",
                "exists": true,
                "sha256": "2fd3f5d09e53f7b4fac275c5b7f0a59d103d37bc0e577eb51a84d051a5a3e3a4",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\components\\OtpVerificationSheet.ets",
                "exists": true,
                "sha256": "e0376d1aa4396c11d37c2cf2b412b2e38affc5b32edc3bafa5496ad1130664d3",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\AddBankCardPage.ets",
                "exists": true,
                "sha256": "e2a1d6d06e959661848ae2b064c5fdb629481c1b2d409a85d22574b98d3ddba5",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\AllBanksPage.ets",
                "exists": true,
                "sha256": "f822d14033e00d59c2b2c9987631e10d6fd3e1683a13d6728aded8a8ac13ea94",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\BankCardOpeningResultPage.ets",
                "exists": true,
                "sha256": "d9589422aca3f459574dc9a590f3df347cd29521fe25151a7eb2581102f0561e",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\BankCardSelectionPage.ets",
                "exists": true,
                "sha256": "5be74f8de46fa24b27f553a4d2bea52a4d64876cdd82b1e8e64fa6337606dfc4",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\HomeTabPage.ets",
                "exists": true,
                "sha256": "b51d01ec291ec7ac6bc22caa01a36a3dd0f58e6540845ab7e4dd10fcd4d21d75",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\shared\\constant\\BankConstants.ets",
                "exists": true,
                "sha256": "eae748f4a6f58e86682d60e7f8aab7e7965e49fd7dff54aa91ba3546cb642a0b",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\element\\color.json",
                "exists": true,
                "sha256": "5216bc6304a96e40a42fe8d20bba3f608626f86d29fd896f52cbac6b9f1b11f4",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\element\\float.json",
                "exists": true,
                "sha256": "691295c683cf1d199c7e0cf0ef04f9e0cc61005c6fb742202ace6cb488fd74fd",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\element\\string.json",
                "exists": true,
                "sha256": "81643574376adafbfbe0ab2b276c267677bf1a4c24257278440c352079ee9394",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\media\\result_payment_guide_placeholder.png",
                "exists": true,
                "sha256": "e8155a66f7476b56e571d74b4774aa0e5c6a5ed57f24458227008e3d3fb65228",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\profile\\route_map.json",
                "exists": true,
                "sha256": "51eb86e3a1e902c622192477713d15020308585fe612378ba873ace5d5bc33db",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\04-BusinessBase\\AccountManager\\src\\main\\ets\\data\\model\\UserProfile.ets",
                "exists": true,
                "sha256": "043b16cd29f489a03b8ae7b742df4974d48436845437064325e207d6a1ba8b55",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\04-BusinessBase\\AccountManager\\src\\main\\ets\\domain\\service\\AccountService.ets",
                "exists": true,
                "sha256": "0e97cba80995bbafaf7bdbcfae6ef44f25079e1775e609a7fe530716018b84b6",
                "role": "derive"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\04-BusinessBase\\AccountManager\\src\\main\\ets\\index.ets",
                "exists": true,
                "sha256": "4f41856f439aeb2b26f8e748ad39992dbc1dbb049608c503e7867804a4e95662",
                "role": "derive"
              }
            ],
            "source_refs": [
              "01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets",
              "01-Product/Phone/src/main/ets/pages/index.ets",
              "02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets",
              "02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets",
              "02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets",
              "02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets",
              "02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets",
              "02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets",
              "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets",
              "02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets",
              "02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets",
              "02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets",
              "02-Feature/WalletMain/src/main/ets/index.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets",
              "02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets",
              "02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets",
              "02-Feature/WalletMain/src/main/resources/base/element/color.json",
              "02-Feature/WalletMain/src/main/resources/base/element/float.json",
              "02-Feature/WalletMain/src/main/resources/base/element/string.json",
              "02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png",
              "02-Feature/WalletMain/src/main/resources/base/profile/route_map.json",
              "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets",
              "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets",
              "04-BusinessBase/AccountManager/src/main/ets/index.ets"
            ],
            "content_fingerprint": "ef00b999011c756a17b4c7780bb32b32e022e4767a4457aecb53bad641a73447"
          },
          "attempts": [
            {
              "kind": "derive",
              "source": "derive.codebase",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\01-Product\\Phone\\src\\main\\ets\\navigation\\WalletDestinationRegistry.ets",
                  "exists": true,
                  "sha256": "248d0e20be41280480b38d4a71fde6ba3996b2a4a7087393e89730a76165629f",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\01-Product\\Phone\\src\\main\\ets\\pages\\index.ets",
                  "exists": true,
                  "sha256": "c3e17ad03316367064f60cab14d49481eaa5a2d551ba41bad24e6f1a16e6c8e5",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\BankCardCandidate.ets",
                  "exists": true,
                  "sha256": "238a6b9bebac812a23f666d32e6d6b69af1309c84a7056c302323309b5cc1f10",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\BankInfo.ets",
                  "exists": true,
                  "sha256": "44e0db74c0bac252e63a0da69af0aa986dec35c5132daf4be089ad50a3904992",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\BankOpeningCompletionContext.ets",
                  "exists": true,
                  "sha256": "619ba798be856082f337f52482d06ff7bf9b8f314febcbc33f01765e6e4f89ac",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\OpeningResult.ets",
                  "exists": true,
                  "sha256": "7aef81041f69bcee34c401167d41ef36fd4e8f956d138cfa446304afd3a0f625",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\model\\StoredCard.ets",
                  "exists": true,
                  "sha256": "91f0e5ebc47d7524f4892824d72767feb0863ae429928aa98f2423c1afe7cf94",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\repository\\BankCardRepository.ets",
                  "exists": true,
                  "sha256": "e37016f70b00692092d863bcb5186c9d1e8bfe446f8d28c653b29a36fdf9ea78",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\data\\repository\\BankRepository.ets",
                  "exists": true,
                  "sha256": "45e35adb9536871ae95b18228bed2871bc42d4be342a1c000ccd040880ef1e35",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\domain\\service\\BankCardOpeningService.ets",
                  "exists": true,
                  "sha256": "8b022f1ee0020e880b1bb799f2beb914d2d60c33f0da9dde41c187f7200af41b",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\domain\\service\\OpeningNavigationService.ets",
                  "exists": true,
                  "sha256": "c517e8551ee64be83792c9fb42370cd439f89bec4dfbffaec119ff9257bee088",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\domain\\service\\OtpService.ets",
                  "exists": true,
                  "sha256": "bbe518fdc1bbd88e60b98a96eacc7fef4759028d7e232ba189097e593665319f",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\index.ets",
                  "exists": true,
                  "sha256": "7a854693ef4c516d125b47eeff71115a65641cd46d6ee0d5950cff308829992f",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\components\\CardTypeSheet.ets",
                  "exists": true,
                  "sha256": "2fd3f5d09e53f7b4fac275c5b7f0a59d103d37bc0e577eb51a84d051a5a3e3a4",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\components\\OtpVerificationSheet.ets",
                  "exists": true,
                  "sha256": "e0376d1aa4396c11d37c2cf2b412b2e38affc5b32edc3bafa5496ad1130664d3",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\AddBankCardPage.ets",
                  "exists": true,
                  "sha256": "e2a1d6d06e959661848ae2b064c5fdb629481c1b2d409a85d22574b98d3ddba5",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\AllBanksPage.ets",
                  "exists": true,
                  "sha256": "f822d14033e00d59c2b2c9987631e10d6fd3e1683a13d6728aded8a8ac13ea94",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\BankCardOpeningResultPage.ets",
                  "exists": true,
                  "sha256": "d9589422aca3f459574dc9a590f3df347cd29521fe25151a7eb2581102f0561e",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\BankCardSelectionPage.ets",
                  "exists": true,
                  "sha256": "5be74f8de46fa24b27f553a4d2bea52a4d64876cdd82b1e8e64fa6337606dfc4",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\presentation\\pages\\HomeTabPage.ets",
                  "exists": true,
                  "sha256": "b51d01ec291ec7ac6bc22caa01a36a3dd0f58e6540845ab7e4dd10fcd4d21d75",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\ets\\shared\\constant\\BankConstants.ets",
                  "exists": true,
                  "sha256": "eae748f4a6f58e86682d60e7f8aab7e7965e49fd7dff54aa91ba3546cb642a0b",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\element\\color.json",
                  "exists": true,
                  "sha256": "5216bc6304a96e40a42fe8d20bba3f608626f86d29fd896f52cbac6b9f1b11f4",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\element\\float.json",
                  "exists": true,
                  "sha256": "691295c683cf1d199c7e0cf0ef04f9e0cc61005c6fb742202ace6cb488fd74fd",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\element\\string.json",
                  "exists": true,
                  "sha256": "81643574376adafbfbe0ab2b276c267677bf1a4c24257278440c352079ee9394",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\media\\result_payment_guide_placeholder.png",
                  "exists": true,
                  "sha256": "e8155a66f7476b56e571d74b4774aa0e5c6a5ed57f24458227008e3d3fb65228",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\02-Feature\\WalletMain\\src\\main\\resources\\base\\profile\\route_map.json",
                  "exists": true,
                  "sha256": "51eb86e3a1e902c622192477713d15020308585fe612378ba873ace5d5bc33db",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\04-BusinessBase\\AccountManager\\src\\main\\ets\\data\\model\\UserProfile.ets",
                  "exists": true,
                  "sha256": "043b16cd29f489a03b8ae7b742df4974d48436845437064325e207d6a1ba8b55",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\04-BusinessBase\\AccountManager\\src\\main\\ets\\domain\\service\\AccountService.ets",
                  "exists": true,
                  "sha256": "0e97cba80995bbafaf7bdbcfae6ef44f25079e1775e609a7fe530716018b84b6",
                  "role": "derive"
                },
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\04-BusinessBase\\AccountManager\\src\\main\\ets\\index.ets",
                  "exists": true,
                  "sha256": "4f41856f439aeb2b26f8e748ad39992dbc1dbb049608c503e7867804a4e95662",
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
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "contracts",
          "state": "resolved",
          "selected_source": "contracts@1",
          "selected_source_fingerprint": "e30d65628e0869c950af47b0c14b3303f93054d0b2f4d33ab10a1fb057cc946c",
          "binding": {
            "input_id": "contracts",
            "source": {
              "kind": "artifact",
              "artifact": "contracts@1"
            },
            "dependencies": [
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\change-unit.yaml",
                "exists": true,
                "sha256": "27fa5f44fb3150337359eaa6d14244ddea742139c4325cf9dce106fdcf5be883",
                "role": "artifact"
              },
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\contracts.yaml",
                "exists": true,
                "sha256": "6cff61240132f92e0fbdec8e3275229da40c59d032486d14f60472d022669c90",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml"
            ],
            "content_fingerprint": "e30d65628e0869c950af47b0c14b3303f93054d0b2f4d33ab10a1fb057cc946c"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "contracts@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\contracts.yaml",
                  "exists": true,
                  "sha256": "6cff61240132f92e0fbdec8e3275229da40c59d032486d14f60472d022669c90",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\contracts.yaml"
            }
          ]
        },
        {
          "id": "use_cases",
          "state": "resolved",
          "selected_source": "use-cases@1",
          "selected_source_fingerprint": "13214e59c92865b042ab81d264a8b89d90fe62ebbe449bbaf13f7a8faa03cbba",
          "binding": {
            "input_id": "use_cases",
            "source": {
              "kind": "artifact",
              "artifact": "use-cases@1"
            },
            "dependencies": [
              {
                "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\use-cases.yaml",
                "exists": true,
                "sha256": "4f66f56d5e50b61ed1a67b8587a4e4bfa95f11e47c54afa7f1b3eea738c38a9d",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml"
            ],
            "content_fingerprint": "13214e59c92865b042ab81d264a8b89d90fe62ebbe449bbaf13f7a8faa03cbba"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "use-cases@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\use-cases.yaml",
                  "exists": true,
                  "sha256": "4f66f56d5e50b61ed1a67b8587a4e4bfa95f11e47c54afa7f1b3eea738c38a9d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "D:\\1.code\\SimulatedWalletForHmos\\doc\\features\\bc-openCard-2\\bank-card-opening-flow\\use-cases.yaml"
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
      "source": "plan_references_unit_layer_ac"
    },
    {
      "id": "derived_selector_contract",
      "category": "structure",
      "description": "派生 Hylyre selector 必须可追溯到 ui-spec",
      "severity": "MINOR",
      "status": "WARN",
      "details": "[SELECTOR-SPEC-001] 共 84 个 canonical selector 问题：\n  - TC-001 step 2 by_text=添加管理卡片: by_text 未映射到当前 feature ui-spec text（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 3 by_id=cp_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 4 by_id=cp_add_card_btn: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 5 by_id=ac_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 6 by_id=ac_bank_card_row: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 7 by_id=col_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 8 by_id=col_row_cmb: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-001 step 45 by_id=home_root: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-002 step 2 by_text=添加管理卡片: by_text 未映射到当前 feature ui-spec text（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-002 step 3 by_id=cp_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-002 step 4 by_id=cp_add_card_btn: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决\n  - TC-002 step 5 by_id=ac_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决",
      "suggestion": "用 derive-hylyre-plan-hint 的 selector_contract 只读查询修正；dump/cache 发现的候选须先回写 ui-spec/锚点注入。",
      "source": "derived_selector_contract"
    },
    {
      "id": "test_case_to_acceptance",
      "category": "traceability",
      "description": "每条测试用例必须关联到至少一个验收标准（AC 编号）",
      "severity": "MAJOR",
      "status": "WARN",
      "details": "1 条测试用例未关联 AC/BD 编号：\n  - TC-011",
      "suggestion": "每条测试用例的「关联 AC」列应包含至少一个 AC 或 BD 编号。",
      "source": "test_case_to_acceptance"
    },
    {
      "id": "visual_diff",
      "category": "structure",
      "description": "设备渲染视觉回环（device_test.visual_diff）：Hylyre 截图 vs authoritative_refs 原图， 产出 visual-diff.md / must-fix 清单与保真分（含几何 IoU）。QA 阶段级动作，非 test-plan 派生步骤根键。warmup/无设备 → SKIP。 当 spec UI change=new_or_changed 且 P0 目标屏 visual verdict 全 pending 或未覆盖 → BLOCKER FAIL。 score_floor 已降级 reference_only（P1-C·f2d8c4a6：像素直方图历史多次实测证伪，不参与任何判定）。 P0-9（e7a91b3c）判定持久化：机器判定（pass/warn/fail）绑定 「被评截图文件 hash + build 指纹（实际 hap sha256 前 12 hex，现算）」——同 build 下 capture 跳采、判定跨 harness 轮持久（像素恒等作新鲜度键已被真机时钟/轮播漂移证伪）；换 build/ 文件被换/legacy 缺指纹 → stale 重置重判。legacy confirmed_by 可读但无 gate 权重； 当前 deterministic/native/delegated 机器证据决定结论，required 能力缺失走 capability defer。",
      "severity": "MAJOR",
      "status": "WARN",
      "details": "screens=6；pass=0；warn=6；fail=0；skipped=0；pending=0；must_fix=26；p0=6；defects=38\n[provenance] critic 回执生效档位=unverified（交互态无法从外部证明图片注入——不宣称\"已证明看图\"；防线=SSOT 强制写 verdict 前逐屏 Read crop）\n[fingerprints] ineligible（本轮整体不参与熔断比较）：capture_not_run：本轮未执行视觉采集（build/install/run 或静态门禁提前返回），旧视觉状态不得参与熔断\n【按档位降级（fidelity=pixel_1to1、acceptance_strictness=best_effort，非硬像素契约）】以下屏的 must_fix / major 缺陷为自报样式残差，记视觉债务、不驱动回退（仍阻断发布）：bank_card_selection(shape_mismatch@selection_next_btn), card_type_sheet__overlay__card_type_overlay_root(other@card_type_sheet_panel,other@card_type_bank_row,other@card_type_continue_btn), card_type_sheet__overlay__card_type_sheet_panel(other@card_type_sheet_panel,other@card_type_bank_row,other@card_type_continue_btn), otp_verification_sheet__overlay__otp_overlay_root(other@otp_next_btn), otp_verification_sheet__overlay__otp_sheet_panel(other@otp_next_btn), opening_result_success(other@result_guide_illustration)\n边缘哨兵：超阈 tile 有结构差异但未被 defect.bbox 登记，VL 须复核区域：bank_card_selection[7,0 7,1 7,2 7,3 7,4 7,5]\n【t2 hard 命中被降级】T8 hard 命中转录为 minor（机器确定性证据不得降级）：card_type_sheet__overlay__card_type_overlay_root[A1_protected_region#ce22df03d2e971ec], card_type_sheet__overlay__card_type_sheet_panel[A1_protected_region#5a30a0d2481c27fb]——severity 至少 major\n【t2 落账提醒】T8 warn 命中未转录 defects（终判前须落账或以 defect 记录处置结论）：otp_verification_sheet__overlay__otp_overlay_root[B3_order_inverted#0e507cfab37497f9], otp_verification_sheet__overlay__otp_sheet_panel[B3_order_inverted#11b0f42e7c002577]\n【T8 布局不变量违反（运行时布局树确定性证据，VL pass 不可推翻、禁止弃判）】card_type_sheet__overlay__card_type_overlay_root[A1_protected_region#ce22df03d2e971ec] bbox=[0.0364,0.4214,0.9273,0.0839]: 保护区 [card_type_sheet_close] 被可交互控件「col_row_citic」侵入（{\"x1\":48,\"y1\":961,\"x2\":1272,\"y2\":1129}）——移出保护区或调整布局 | card_type_sheet__overlay__card_type_sheet_panel[A1_protected_region#5a30a0d2481c27fb] bbox=[0.0364,0.4214,0.9273,0.0839]: 保护区 [card_type_sheet_close] 被可交互控件「col_row_citic」侵入（{\"x1\":48,\"y1\":961,\"x2\":1272,\"y2\":1129}）——移出保护区或调整布局\n【T8 布局结构观测（WARN 档，档位见 layout-oracle-calibration.md）】bank_card_selection[B2_group_container_missing#963efe857d8a9a51] bbox=[0.0409,0.1348,0.9182,0.4079]: 声明分组容器 [bank_card_selection_root]（bg_color=color.page_bg）的子元素 selection_hint/selection_card_container/selection_agreement_check/selection_agreement/selection_next_btn 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡 | bank_card_selection[B3_order_inverted#f43ddb76359d2ac0] bbox=[0.0515,0.3719,0.9076,0.0689]: [selection_agreement_check]（order=3）与 [selection_agreement]（order=4）运行时纵向顺序颠倒（y=876 vs 862） | card_type_sheet__overlay__card_type_overlay_root[B2_group_container_missing#09991a0da942d2d5] bbox=[0.0364,0.0185,0.9273,0.2157]: 声明分组容器 [card_type_background_page]（bg_color=color.page_bg）的子元素 background_add_bank_title/background_search_bank 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡 | card_type_sheet__overlay__card_type_overlay_root[B3_order_inverted#3af5585b71343481] bbox=[0.0364,0.4488,0.9273,0.0539]: [card_type_sheet_title]（order=0）与 [card_type_sheet_close]（order=1）运行时纵向顺序颠倒（y=1035 vs 1016） | card_type_sheet__overlay__card_type_sheet_panel[B2_group_container_missing#b25ebbbfe91772e3] bbox=[0.0364,0.0185,0.9273,0.2157]: 声明分组容器 [card_type_background_page]（bg_color=color.page_bg）的子元素 background_add_bank_title/background_search_bank 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡 | card_type_sheet__overlay__card_type_sheet_panel[B3_order_inverted#efc063214eff7edc] bbox=[0.0364,0.4488,0.9273,0.0539]: [card_type_sheet_title]（order=0）与 [card_type_sheet_close]（order=1）运行时纵向顺序颠倒（y=1035 vs 1016） …共 9 处\n≥2 屏共享 screenshot_hash（疑似 Tab 未切换/重复采集，至少一屏为错图）：a8c6fbd6dfdd4211:card_type_sheet__overlay__card_type_overlay_root+card_type_sheet__overlay__card_type_sheet_panel\n文本块观测 per-element 素材（advisory，VL 终判须折算进 screens[].must_fix；不直接阻断）：card_type_sheet__overlay__card_type_overlay_root: 「添加银行卡」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「免输卡号添卡    支持 100」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「搜索银行    搜索」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「招商银行」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验） | card_type_sheet__overlay__card_type_sheet_panel: 「添加银行卡」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「免输卡号添卡    支持 100」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「搜索银行    搜索」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「招商银行」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验） | otp_verification_sheet__overlay__otp_overlay_root: 「55 秒后重试」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验） | otp_verification_sheet__overlay__otp_sheet_panel: 「55 秒后重试」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）",
      "affected_files": [
        "doc/features/bc-openCard-2/bank-card-opening-flow/visual-diff.md"
      ],
      "structured": {
        "kind": "visual_diff",
        "channel_evidence_usable": true,
        "evidence_block_owner": null,
        "placement_verified_screens": [
          "bank_card_selection",
          "card_type_sheet__overlay__card_type_overlay_root",
          "card_type_sheet__overlay__card_type_sheet_panel",
          "otp_verification_sheet__overlay__otp_overlay_root",
          "otp_verification_sheet__overlay__otp_sheet_panel",
          "opening_result_success"
        ],
        "downgraded_screens": [
          "bank_card_selection",
          "card_type_sheet__overlay__card_type_overlay_root",
          "card_type_sheet__overlay__card_type_sheet_panel",
          "otp_verification_sheet__overlay__otp_overlay_root",
          "otp_verification_sheet__overlay__otp_sheet_panel",
          "opening_result_success"
        ],
        "loop_id": "goal:20261023T044016Z-fe4512",
        "attempt_id": "i25",
        "goal_run_id": "20261023T044016Z-fe4512",
        "build_fingerprint": "b991e757c69c",
        "screens_hash": "300987d1f6e8d361",
        "defect_fingerprints": [],
        "fingerprintable": false,
        "source_fail_hit_ids": [],
        "source_warn_ids": [
          "visual_diff_layout_invariants",
          "0e507cfab37497f9",
          "11b0f42e7c002577"
        ],
        "await_human_only": false,
        "actionable_residual": false,
        "round": {
          "disposition": "duplicate",
          "decision": {
            "fused": false
          },
          "row": {
            "schema_version": "1.0",
            "at": "2026-10-24T19:42:57.751Z",
            "loop_id": "goal:20261023T044016Z-fe4512",
            "goal_run_id": "20261023T044016Z-fe4512",
            "attempt_id": "i25",
            "base_state_hash": "a0eac83b5386b881",
            "build_fingerprint": "b991e757c69c",
            "screens_hash": "300987d1f6e8d361",
            "defect_fingerprints": [],
            "source_fail_hit_ids": [],
            "source_warn_ids": [
              "0e507cfab37497f9",
              "11b0f42e7c002577",
              "visual_diff_layout_invariants"
            ],
            "fingerprintable": false,
            "actionable_residual": false,
            "await_human_only": false,
            "decision": {
              "fused": false
            },
            "row_hash": "ed3a2baba9549b4f"
          },
          "corrupt_lines": 0
        },
        "t8_unstable_findings": [],
        "t8_findings": [
          {
            "screen_id": "bank_card_selection",
            "finding_id": "963efe857d8a9a51",
            "signal": "B2_group_container_missing",
            "tier": "warn",
            "elements": [
              "selection_hint",
              "selection_card_container",
              "selection_agreement_check",
              "selection_agreement",
              "selection_next_btn"
            ],
            "bbox": [
              0.0409,
              0.1348,
              0.9182,
              0.4079
            ]
          },
          {
            "screen_id": "bank_card_selection",
            "finding_id": "f43ddb76359d2ac0",
            "signal": "B3_order_inverted",
            "tier": "warn",
            "elements": [
              "selection_agreement_check",
              "selection_agreement"
            ],
            "bbox": [
              0.0515,
              0.3719,
              0.9076,
              0.0689
            ]
          },
          {
            "screen_id": "card_type_sheet__overlay__card_type_overlay_root",
            "finding_id": "ce22df03d2e971ec",
            "signal": "A1_protected_region",
            "tier": "hard",
            "elements": [
              "card_type_sheet_close",
              "col_row_citic"
            ],
            "bbox": [
              0.0364,
              0.4214,
              0.9273,
              0.0839
            ]
          },
          {
            "screen_id": "card_type_sheet__overlay__card_type_overlay_root",
            "finding_id": "09991a0da942d2d5",
            "signal": "B2_group_container_missing",
            "tier": "warn",
            "elements": [
              "background_add_bank_title",
              "background_search_bank"
            ],
            "bbox": [
              0.0364,
              0.0185,
              0.9273,
              0.2157
            ]
          },
          {
            "screen_id": "card_type_sheet__overlay__card_type_overlay_root",
            "finding_id": "3af5585b71343481",
            "signal": "B3_order_inverted",
            "tier": "warn",
            "elements": [
              "card_type_sheet_title",
              "card_type_sheet_close"
            ],
            "bbox": [
              0.0364,
              0.4488,
              0.9273,
              0.0539
            ]
          },
          {
            "screen_id": "card_type_sheet__overlay__card_type_sheet_panel",
            "finding_id": "5a30a0d2481c27fb",
            "signal": "A1_protected_region",
            "tier": "hard",
            "elements": [
              "card_type_sheet_close",
              "col_row_citic"
            ],
            "bbox": [
              0.0364,
              0.4214,
              0.9273,
              0.0839
            ]
          },
          {
            "screen_id": "card_type_sheet__overlay__card_type_sheet_panel",
            "finding_id": "b25ebbbfe91772e3",
            "signal": "B2_group_container_missing",
            "tier": "warn",
            "elements": [
              "background_add_bank_title",
              "background_search_bank"
            ],
            "bbox": [
              0.0364,
              0.0185,
              0.9273,
              0.2157
            ]
          },
          {
            "screen_id": "card_type_sheet__overlay__card_type_sheet_panel",
            "finding_id": "efc063214eff7edc",
            "signal": "B3_order_inverted",
            "tier": "warn",
            "elements": [
              "card_type_sheet_title",
              "card_type_sheet_close"
            ],
            "bbox": [
              0.0364,
              0.4488,
              0.9273,
              0.0539
            ]
          },
          {
            "screen_id": "otp_verification_sheet__overlay__otp_overlay_root",
            "finding_id": "0e507cfab37497f9",
            "signal": "B3_order_inverted",
            "tier": "warn",
            "elements": [
              "otp_sheet_title",
              "otp_sheet_close"
            ],
            "bbox": [
              0.0364,
              0.6066,
              0.9273,
              0.0539
            ]
          },
          {
            "screen_id": "otp_verification_sheet__overlay__otp_sheet_panel",
            "finding_id": "11b0f42e7c002577",
            "signal": "B3_order_inverted",
            "tier": "warn",
            "elements": [
              "otp_sheet_title",
              "otp_sheet_close"
            ],
            "bbox": [
              0.0364,
              0.6066,
              0.9273,
              0.0539
            ]
          },
          {
            "screen_id": "opening_result_success",
            "finding_id": "d8c3f200230643bb",
            "signal": "B2_group_container_missing",
            "tier": "warn",
            "elements": [
              "result_guide_illustration",
              "result_finish_btn"
            ],
            "bbox": [
              0.0598,
              0.3714,
              0.8803,
              0.5447
            ]
          }
        ]
      },
      "source": "visual_diff"
    },
    {
      "id": "visual_feedback",
      "category": "structure",
      "description": "确定性视觉反馈（盲档 deterministic_feedback：JSON SSOT + md 投影，两类信号分立）",
      "severity": "MAJOR",
      "status": "WARN",
      "details": "【视觉反馈】硬不变量 4 项（声明文案设备侧缺失）+ advisory 12 项；收敛=stalled：\n  - [bank_card_selection] 参考图文本「《招商银行」设备侧缺失（ui-spec 声明文案——硬不变量）\n  - [bank_card_selection] 参考图文本「侨同意并阅读《云内付App一键绑卡用户授权协议)》、《招商银行信」设备侧缺失（ui-spec 声明文案——硬不变量）\n  - [bank_card_selection] 参考图文本「用卡快捷支付服务协议》，授权云闪付获得您在本行银行卡号等信」设备侧缺失（ui-spec 声明文案——硬不变量）\n  - [bank_card_selection] 参考图文本「息。」设备侧缺失（ui-spec 声明文案——硬不变量）\n（阻断承载：文本存在性 BLOCKER 归既有 OCR 门禁；本条为修复输入 SSOT——见 visual-feedback.md）",
      "suggestion": "按 visual-feedback.md 逐条修复后重跑设备采集；stalled/regressing 会被轮次账本熔断链捕获。",
      "structured": {
        "kind": "visual_feedback",
        "convergence": "stalled",
        "hard": 4,
        "advisory": 12
      },
      "source": "visual_diff"
    }
  ],
  "summary": {
    "total": 61,
    "pass": 56,
    "fail": 0,
    "warn": 4,
    "skip": 1,
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
    "ui_entry_coverage",
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
    "boundary_coverage",
    "render_visibility_calibrate",
    "runtime_mount_conformance",
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
    "testing_channel_evidence_obligation",
    "p0_runtime_step_evidence",
    "testing_run_status",
    "capability_testing_cases",
    "capability_testing_code_context",
    "capability_testing_design_context"
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
  2. 检查派生可执行计划是否存在：`doc/features/cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93/testing/reports/<某子目录>/hylyre/test-plan.hylyre.md`（选取规则以脚本为准：排除烟测占位，按 mtime 优先；非「字典序最新目录名」）
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
     - **硬像素契约**（pixel_1to1 ∧ hard）：major/blocker 残差写入结构化缺陷和对应 `must_fix`，由 gate 有效授权结论返修；完整锚定的 minor-only 只作 WARN 披露，不产 coding 候选或阻断债务，不能仅凭 raw fail/非空 must_fix 升级
     - **软档**（其余档位，含 pixel_1to1 ∧ best_effort）：执行者/VL 自报的 **major** 样式不符记为该屏 `defects[]`（severity=major，以 `must_fix_refs` 引用对应 must_fix），并在 `must_fix` 里写清修法；harness gate 会按档位把该屏降级为视觉债务并披露在 `downgraded_screens`——不阻断阶段推进、不驱动回退，但**仍阻断发布**直到修复重验。纯 minor 残差只记 `defects[]`（severity=minor）披露，不因此新写 must_fix。不要因这类自报样式残差把本项判 BLOCKER 或要求整链回退
     - 两档都保留原阻断/修复规则：独立确定性失败（T8 major/hard 信号、锚点文本整块缺失、双向残差、缺 `by_id` 锚点）、blocker、未锚定 legacy 指令及核心操作走不通/结果错/关键信息缺失或不可读（记 blocker）。minor 不豁免这些检查；raw fail 若仅由有效 minor 或既有 soft 降级意见支撑，不能再独立拒证。缺证按 testing 重采/重评处理，不猜 coding 修法
  5. A/B/C 边界：C 类动态交互不在静态参考图承诺内

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 逐条核对本阶段产物里的跨文件引用——test-report 引述的结论、失败原因、截图路径 ↔ trace.json 与 device-screenshots 原文；「通过/失败」计数 ↔ trace 里的 case 状态。每条引用都要打开被引用的原文核对，不凭记忆、不凭上下文摘要。
- **判定标准**: 引用对象存在且含义一致 → PASS；个别引用漂移（行号/名称过期但对象仍可定位） → WARN；关键引用指向不存在或含义相反的对象 → FAIL
- **证据**: 列出核对过的引用（`引用 → 原文位置`）与不一致项


---

## 六、上下文文件

以下是本次验证的上下文：被审产物与直接依据内联；上游文档与源码只给**路径清单**，需要核对时用 Read 按路径读取，不要全量通读。

被审 feature 根目录：`doc/features/cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93/`（相对仓根；下方清单里的相对路径同样相对仓根）。

### doc/module-catalog.yaml

```
候选摘录，非全文，按路径读完整来源。

[
  {
    "name": "AccountManager",
    "layer": "04-BusinessBase",
    "sub_layer": null,
    "format": "HAR",
    "one_liner": "跨 Feature 的账号域能力（**HAR**，仅依赖 **`CommFunc`**）：基于 **`AppStorage`** 的登录布尔、展示账号串与 **`LoginState` 枚举流水线**（含 **`LOGGING_IN`** 过渡态；枚举另含 **`LOGIN_FAILED`** 占位，当前模拟路径未触发）；**`AccountService`** 单例为唯一入口；**`login()`** 经 **`setTimeout` 模拟异步**后写入脱敏展示串（**`MaskUtil.maskPhone`**）；登录实现为可替换**模拟成功**（注释指向华为账号 Kit）。",
    "responsibilities": [
      "以 **`AccountService.getInstance()`** 懒初始化单例；首次实例化执行 **`initStorage()`**，对 **`AccountConstants`** 声明的 **`wallet_*`** 键在缺失时 **`setOrCreate`** 默认值（未登录 / 空串 / **`LoginState.NOT_LOGGED_IN`**）。",
      "**`notify(state)`** 同步 **`STORAGE_LOGIN_STATE`** 并遍历内存 **`listeners`** 广播；**`onLoginStateChanged` / `offLoginStateChanged`** 以回调引用增删（调用方须 **`off` 同一函数引用**，典型见 **`WalletMain` · `MineTabPage`**）。",
      "**`login()`**：先 **`notify(LOGGING_IN)`**，**`await` 固定间隔 `setTimeout`**（模拟网络），再以硬编码演示手机号调用 **`MaskUtil.maskPhone`**，写入 **`STORAGE_IS_LOGGED_IN` / `STORAGE_DISPLAY_ACCOUNT`**，最后 **`notify(LOGGED_IN)`** 并返回 **`UserProfile`**。",
      "**`logout()`**：清零登录与展示串并 **`notify(NOT_LOGGED_IN)`**。",
      "**`getUserProfile()`**：从 **`AppStorage`** 读取布尔与展示串组装 **`UserProfile`**（**`avatar`** 当前为 **`null`**）；**`UserProfile.accountText`** 未登录时返回展示文案「未登录」。"
    ],
    "NOT_responsible_for": [
      "不负责 **`Phone` / `WalletMain`** 的页面编排、**`pushPath`**、**`NavPathContext.attach` / `stack()`** 等导航壳；本模块只提供 **`AccountService` + AppStorage 真理** 供 UI 调用。",
      "不负责华为账号 Kit、OAuth 页面与合规弹窗；当前为 **setTimeout + 写死成功** 的演示实现，**禁止**在 PRD 中默认等同生产级 Huawei ID。",
      "不负责通用 ArkUI 组件、主题、纯 Toast；归 **`CommUI`**。",
      "不承担卡发行、支付清算等线下钱包业务；演示账号流 **≠** 生产中台。"
    ],
    "typical_business_terms": [
      "账号管理",
      "登录",
      "登出",
      "我的账号",
      "未登录"
    ],
    "easily_confused_with": [
      {
        "module": "CommFunc",
        "disambiguation": "若只讨论 **`MaskUtil.maskPhone` 等纯工具**、与「是否已登录、`LoginState`、监听回调」无关 → **CommFunc**。\n若讨论 **AppStorage 账号键、`AccountService`、登录/登出生命周期与 `UserProfile`** → **AccountManager**（本模块）。本模块可依赖 **`CommFunc`**，禁止反向依赖。\n"
      },
      {
        "module": "CommUI",
        "disambiguation": "**列表项/主题色/Toast 等可复用 UI 积木** → **CommUI**。\n**登录态写入、展示账号串、`LoginState` 订阅** → **AccountManager**（本模块）。不要在 **`CommUI`** 通用组件内嵌 **`AccountService`** 单例逻辑。\n"
      },
      {
        "module": "WalletMain",
        "disambiguation": "**`AccountService` / `UserProfile` / AppStorage 账号键 / 登录监听** → **AccountManager**（权威域）。\n**「我的」页布局与编排、金融列表占位跳转等 feature UX** → **WalletMain**；页面调用本模块 API，**真理仍在** **`AccountManager`**。\n"
      },
      {
        "module": "Phone",
        "disambiguation": "**账号模型、存储键、`login`/`logout`、`LoginState`、监听** → **AccountManager**（本模块）。\n**`PhoneAbility`、`loadContent`、根 `Navigation`/`Tabs`、`NavPathContext`、`navDestination`** → **Phone**；入口 HAP **不**复制账号域实现。\n"
      }
    ],
    "key_exports": [
      "AccountConstants",
      "LoginState",
      "UserProfile",
      "AccountService"
    ],
    "entry_file": "04-BusinessBase/AccountManager/src/main/ets/index.ets"
  },
  {
    "name": "WalletMain",
    "layer": "02-Feature",
    "sub_layer": null,
    "format": "HAR",
    "one_liner": "钱包**主 feature**（HAR）：经 **`index.ets`** 导出 `HomeTabPage`（**`@Link navPathStack`**，源码注释禁止 **`@Prop`** 以免 `pushPath` 丢句柄）、`MineTabPage`（壳层可不传入栈）及卡包/添卡 **`@Builder`**；宿主（如 **`Phone`**）以 **`HomeTabPage({ navPathStack: $navPathStack })`** 与 `@Link` 绑定同源栈并 **`pushPath`**；二级 **`NavDestination`** 内亦可 **`NavPathContext.stack().pushPath`**（依赖宿主已 **`NavPathContext.attach`**）；presentation/data 编排卡引导、宫格、轮播与 **`HomeRepository` / `MineRepository` / `CardRepository`** 等读模型，并组合 **`AccountManager` / `CommUI` / `CommFunc`**。",
    "responsibilities": [
      "对外导出 `HomeTabPage`、`MineTabPage`、`buildCardPackPage`、`buildAddCardEntryPage`，供 **`Phone`** 等宿主装配；`HomeTabPage` **必须**通过 **`@Link navPathStack`** 接收与宿主根 **`Navigation`** 同源的 `NavPathStack`（宿主侧典型写法 **`HomeTabPage({ navPathStack: $navPathStack })`**）；**禁止**用 **`@Prop`** 传递栈（注释说明用于规避真机句柄问题）。",
      "在首页路径使用传入的 **`navPathStack.pushPath`** 触发 **`CardPackPage` / `AddCardEntryPage`**（路由名与宿主 **`navDestination`** 一致）；在 **`NavDestination`** 子页（如 **`CardPackPage`**）内可使用 **`NavPathContext.stack().pushPath`** 继续导航（如进入添卡），**前提**为宿主已在根页执行 **`NavPathContext.attach`**。",
      "在 **`MineTabPage`** 集成 **`AccountService` / `UserProfile` / `LoginState`**（**`AccountManager`**）：`aboutToAppear` 注册 **`onLoginStateChanged`**，`aboutToDisappear` 调用 **`offLoginStateChanged`**；登录与档案真理仍在 **`AccountManager`**，本模块仅编排 UI 与监听。",
      "维护 **`HomeRepository` / `MineRepository` / `CardRepository`** 及 **`ServiceEntry` / `PromoInfo` / `CardCategory` / `FinanceEntry`** 等模型，支撑首页/我的/卡包/添卡 UX（当前多为本地/Mock）。",
      "在 feature 组件中组合 **`CommUI`**（如 **`ActionListItem` / `SectionCard` / `showToast`**）与 **`CardGuideSection` / `AccountCard`** 等带钱包语义的 presentation 组件；异常路径通过 **`showToast`** 提示（如首页数据不可用）。"
    ],
    "NOT_responsible_for": [
      "不负责应用级入口、**`PhoneAbility`**、根 **`Navigation` / `Tabs` / `NavPathContext.attach`**；宿主壳归 **`Phone`**，本模块 Tab 与二级 builder **消费**已挂载的导航上下文。",
      "不负责 **`AccountService`** 单例实现与 AppStorage 键语义权威定义；真理在 **`AccountManager`**。",
      "不复制 **`CommUI`** 通用设计系统实现。",
      "不承担生产级卡发行、清算、NFC/SE 等线下业务；当前偏演示，不可默认等同生产卡系统。"
    ],
    "typical_business_terms": [
      "钱包主功能",
      "卡包",
      "添卡",
      "首页",
      "我的"
    ],
    "easily_confused_with": [
      {
        "module": "AccountManager",
        "disambiguation": "若讨论 **`AccountService` / 登录与登出 / `UserProfile` / `LoginState` / AppStorage 中账号态** 的**领域服务与数据模型** → **AccountManager**（权威域）。\n若讨论**「我的」页怎么摆、和首页如何跳转、卡包/添卡流程 UI** 等**feature 内页面与路由编排** → **WalletMain**（本模块），即使代码里在「我的」调用了 `AccountService`。\n"
      },
      {
        "module": "CommUI",
        "disambiguation": "可复用、无钱包业务名状的 **ListItem/卡片容器/主题色/Toast** → **CommUI**。\n**卡引导、卡分类列表、与「卡包」强绑定的 feature 专页/区块** → **WalletMain**；可 import `CommUI`，但**业务组件与数据绑定**的归属在仓库路径 `02-Feature/WalletMain`。\n"
      },
      {
        "module": "CommFunc",
        "disambiguation": "**纯工具与日志/脱敏**、与卡包/首页/我的的**产品语义**无关 → **CommFunc**。\n与**钱包 Tab、卡种入口、服务宫格/活动与导航 `pushPath` / `NavPathContext.stack` 的业务语义**强相关 → **WalletMain**；**`NavPathContext.attach` 与全局栈宿主挂载**仍属 **`Phone` + `CommFunc`**。\n"
      },
      {
        "module": "Phone",
        "disambiguation": "**卡种/服务宫格/卡包/添卡、`pushPath` 触发点、feature 内 Repository 与用例、`NavPathContext.stack()` 在子页内的继续导航** → **WalletMain**（本模块）。\n**Entry HAP、`PhoneAbility`、`loadContent`、根 `Navigation`+双 Tab 壳、`NavPathContext.attach`、`navDestination` 注册二级 `@Builder`** → **Phone**；`Phone` 的 `pages/index` 从本模块 import 子页并传入 **`$navPathStack`** 绑定，**本模块不实现** Ability 与 HAP 壳。\n"
      }
    ],
    "key_exports": [
      "HomeTabPage",
      "MineTabPage",
      "buildCardPackPage",
      "buildAddCardEntryPage"
    ],
    "entry_file": "02-Feature/WalletMain/src/main/ets/index.ets"
  },
  {
    "name": "Phone",
    "layer": "01-Product",
    "sub_layer": null,
    "format": "HAP",
    "one_liner": "应用**入口 HAP**：`PhoneAbility` 加载 `pages/index`；根 `Index` 装配 `Navigation`+双 `Tabs`，`aboutToAppear` 中 `NavPathContext.attach`；**首页 Tab** 以 **`HomeTabPage({ navPathStack: $navPathStack })`** 传入与宿主同源栈（与 `WalletMain` 内 `@Link navPathStack` 配套），**我的 Tab** 壳层直接装载 **`MineTabPage()`**；`navDestination` 注册卡包/添卡至 `WalletMain` 的 builder；含 **`PhoneBackupAbility`（backup）**；**不实现**业务数据与账号域，仅壳与多 HAR 聚合。",
    "responsibilities": [
      "维护 `PhoneAbility`（`UIAbility`）：`onWindowStageCreate` 中 `loadContent('pages/index', …)`，生命周期节点使用 `hilog` 记录；`onCreate` 尝试设置应用级 `ColorMode`。",
      "在 `pages/index.ets` 声明 `@Entry`：`Navigation(this.navPathStack)` + 底部 `Tabs`（首页/我的）；`aboutToAppear` 调用 `NavPathContext.attach(this.navPathStack)`（`@aspect/CommFunc`）；**首页** `TabContent` 内渲染 **`HomeTabPage({ navPathStack: $navPathStack })`**，向 feature 传入与宿主一致的栈绑定；**我的** `TabContent` 内渲染 **`MineTabPage()`**（当前壳层未向其传入 `navPathStack`）；`navDestination` 将 `CardPackPage` / `AddCardEntryPage` 映射到 `@aspect/WalletMain` 的 `buildCardPackPage` / `buildAddCardEntryPage`。",
      "通过 HAP `oh-package.json5` 声明对 `WalletMain`、`AccountManager`、`CommUI`、`CommFunc` 的依赖，固定「入口壳 + feature + 基座」装配图。",
      "声明 `PhoneBackupAbility`（`BackupExtensionAbility`，`type: backup`）及 `backup_config` 元数据挂载点；具体备份策略以配置与系统契约为准。"
    ],
    "NOT_responsible_for": [
      "**不负责**首页服务宫格、活动轮播、卡包列表、我的页金融入口等**业务数据与用例**；此类归属 **`WalletMain` 的 Repository 与 feature 子页**。",
      "**不负责** `AccountService` / 登录态 / `UserProfile` 的域模型与存储；`Index` 仅消费 `WalletMain` 中已接好的「我的」页，**不**在 HAP 内复制账号领域逻辑。",
      "**不定义**可跨应用复用的通用 `ActionListItem` / 主题等；继续由 **`CommUI` / `CommFunc`** 提供，本壳只做页面级装配。",
      "不承担发布渠道、分账、真机 SE 等**渠道与合规**决策；HAP 仅持工程级配置与能力声明。"
    ],
    "typical_business_terms": [
      "主应用",
      "应用入口",
      "启屏",
      "底 Tab"
    ],
    "easily_confused_with": [
      {
        "module": "WalletMain",
        "disambiguation": "若讲 **应用 Ability、窗口与 `loadContent`、HAP 依赖声明、多 Tab 的壳层 `Navigation`、入口 `@Entry`、`NavPathContext` 挂载栈** → **Phone**（本模块）。\n若讲 **首页/我的内具体卡引导、服务宫格数据、`buildCardPackPage` 业务 UI、`HomeRepository` 等** → **WalletMain**；`Phone` 的 `Index` 只 **import 并放置** 这些 export，不承载 feature 内仓库与用例实现。\n"
      },
      {
        "module": "AccountManager",
        "disambiguation": "**入口壳、`PhoneAbility`、`Navigation`/`Tabs`、`NavPathContext.attach`、`navDestination`、HAP 级依赖聚合** → **Phone**（本模块）。\n**`AccountService`、AppStorage 账号键、`login`/`logout`、`LoginState`、`UserProfile` 真理** → **AccountManager**；本模块仅 **依赖并装载**含账号 UI 的子页，**不**在 HAP 内复制账号领域实现。\n"
      },
      {
        "module": "CommUI",
        "disambiguation": "**`PhoneAbility`、`loadContent`、根 `Navigation`/`Tabs`、`NavPathContext`、`navDestination`、HAP 装配** → **Phone**（本模块）。\n**`ActionListItem`、`SectionCard`、`CommColors`、`showToast` 等跨业务复用积木** → **CommUI**；壳层 **import** 拼装，**不在 HAP 再造一套设计系统实现**。\n"
      },
      {
        "module": "CommFunc",
        "disambiguation": "**`PhoneAbility`、`loadContent`、根壳层 `Navigation`/`Tabs`、调用 `NavPathContext.attach`、HAP 依赖聚合** → **Phone**（本模块）。\n**`Logger`、`MaskUtil`、`NavPathContext` 的实现本体**（无 Ability、无页面壳）→ **CommFunc**；本模块 **依赖并调用**其 API，**不在 HAP 重复实现**通用工具与上下文类。\n"
      }
    ],
    "key_exports": [],
    "entry_file": "01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets"
  }
]
```

### (knowledge navigation)

```
## Knowledge inputs

动笔前读取适用原文；索引/候选不是事实确认或已读证明。维护写入须沿原授权与时点，不在 run 内擅自刷新图谱。

- `doc/module-catalog.yaml` — 模块职责、反例与易混项；完整索引可继续探索
- `doc/glossary.yaml` — 术语与 alias 候选；字面命中不替代语义消歧
- `framework/docs/README.md` — 框架背景索引，按当前任务跟随相关原始链接
- `framework/profiles/hmos-app/skills/README.md` — 当前 profile 知识与 Skill 资产协议
- `framework/profiles/hmos-app/skills/device-testing/profile-addendum.md` — 执行 device-testing 前阅读当前 profile 补充；正文超过内联预算，须按原路径分批读取，未声称读完
- `02-Feature/WalletMain/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 02-Feature/WalletMain（文件缺失 / 未启用；不声称已消费）
- `04-BusinessBase/AccountManager/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 04-BusinessBase/AccountManager（文件缺失 / 未启用；不声称已消费）
- `01-Product/Phone/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 01-Product/Phone（文件缺失 / 未启用；不声称已消费）
- 02-Feature/WalletMain/code-graph.yaml 不存在；回源码探索 02-Feature/WalletMain，不自动建图。
- 04-BusinessBase/AccountManager/code-graph.yaml 不存在；回源码探索 04-BusinessBase/AccountManager，不自动建图。
- 01-Product/Phone/code-graph.yaml 不存在；回源码探索 01-Product/Phone，不自动建图。
- 无术语字面候选不代表无适用知识；继续读取完整索引并语义消歧。
```

### (resolved input cases)

```
schema_version: "1.0"
feature: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
criteria:
  - id: AC-1
    prd_function: F1
    related_functions:
      - F1
      - F2
    priority: P0
    description: 添加银行卡页和全部银行页点击任一银行均打开该银行的卡型选择半模态。
    testable: true
    verification_steps:
      - 分别从两个入口点击同一银行
      - 核对银行名与 logo
      - 核对支持卡型与后续流程一致
    expected_result: 不再提示暂不支持；半模态展示该银行支持卡型且只能单选。
    ut_layer: both
    ut_focus: 两个入口调用同一 opening session 参数构造与卡型单选规则。
    device_focus: 两入口真机点击与半模态视觉、关闭和继续行为。
    checkpoint:
      pre_screen: add_bank_card
      action:
        target_element_id: col_row_cmb
      post_screen: card_type_sheet
      required_element_ids:
        - card_type_sheet_title
        - card_type_bank_row
        - debit_card_row
        - credit_card_row
        - card_type_continue_btn
    requirement_ref:
      source_path: doc/features/原始需求/1-2-银行卡/原始需求.md
      snippet: 之前点击任一银行点击后，提示暂不支持，本次需求改为拉起选择卡类型半模态页面。
      snippet_sha256: c5e1166cbf6b17d91f3c640c8941fbd04ebf10c35ca3329ab62dca90dd8d84ba
  - id: AC-2
    prd_function: F3
    priority: P0
    description: 具体卡片页按银行和卡型展示一至两张 mock 卡，界面只显示前四后四，后台保留完整卡号。
    testable: true
    verification_steps:
      - 选择不同银行与卡型
      - 检查卡片数量和掩码
      - 检查传入验证码页的模型保留完整卡号
    expected_result: 展示格式为前四加掩码加后四；业务对象仍持有完整卡号。
    ut_layer: both
    ut_focus: 候选筛选和 maskCardNumber 边界。
    device_focus: 页面布局、单选和协议门禁。
    checkpoint:
      pre_screen: card_type_sheet
      action:
        target_element_id: card_type_continue_btn
      post_screen: bank_card_selection
      required_element_ids:
        - selection_nav_title
        - selection_hint
        - bank_card_candidate_1
        - selection_agreement
        - selection_next_btn
    requirement_ref:
      source_path: doc/features/原始需求/1-2-银行卡/原始需求.md
      snippet: 银行的选择具体卡片页面，展示该银行支持的银行卡信息，卡号只显示前四后四，但实际后台数据要按完整卡号处理。
      snippet_sha256: 4656ff7ac021e7869dd05b28deeb8117cbc93bf8ed200d9544b48fb184bde945
  - id: AC-3
    prd_function: F4
    priority: P0
    description: 验证码半模态出现即触发一次 mock 发送，60 秒内不可重发，仅六位数字使下一步可用。
    testable: true
    verification_steps:
      - 打开验证码弹层
      - 输入非法和合法字符
      - 推进倒计时至零并重发
    expected_result: 手机号掩码来自账号 mock；倒计时、重发和按钮状态符合要求。
    ut_layer: both
    ut_focus: 六位数字校验、倒计时状态机和重发门禁。
    device_focus: 数字键盘、弹层视觉和按钮启停。
    checkpoint:
      pre_screen: bank_card_selection
      action:
        target_element_id: selection_next_btn
      post_screen: otp_verification_sheet
      required_element_ids:
        - otp_sheet_title
        - otp_phone_hint
        - otp_input
        - otp_resend_action
        - otp_next_btn
    requirement_ref:
      source_path: doc/features/原始需求/1-2-银行卡/原始需求.md
      snippet: 输入验证码半模态页面，拉起后默认触发一次假的短信发送，之后右侧按钮变为倒计时，用户必须输入6位验证码才能点击下一步。
      snippet_sha256: b90e431612171cdcdbad3b41bd936f75fd3d8cf42149b788dc4236fc4bfac64d
  - id: AC-4
    prd_function: F5
    priority: P0
    description: 提交验证码后完整卡数据写入 RDB；无论成功或失败都携带完整卡号和结果进入结果页。
    testable: true
    verification_steps:
      - 分别让 Repository 保存成功和失败
      - 读取数据库记录
      - 检查 OpeningResult 的完整卡号和结果
    expected_result: 成功时数据库字段完整且卡号唯一；失败时无半写记录但结果页收到完整卡号与失败状态。
    ut_layer: both
    ut_focus: RDB 映射、幂等和失败结果。
    device_focus: 成功/失败结果页呈现与跨页参数。
    checkpoint:
      pre_screen: otp_verification_sheet
      action:
        target_element_id: otp_next_btn
      post_screen: opening_result_success
      required_element_ids:
        - result_status_icon
        - result_title
        - result_description
        - result_guide_illustration
        - result_finish_btn
    requirement_ref:
      source_path: doc/features/原始需求/1-2-银行卡/原始需求.md
      snippet: 无论写入成功还是失败，将本次添加的卡片卡号（全卡号）和开卡结果带着跳转到添加结果页。
      snippet_sha256: 397d06bf90202823855fe10b339d868f7017d13f0d0292dbc9b83480886cf52c
  - id: AC-5
    prd_function: F6
    priority: P0
    description: 结果页无返回入口并拦截侧滑/系统返回，只能点击完成；完成后开卡过程页从栈中移除。
    testable: true
    verification_steps:
      - 在结果页尝试系统返回与侧滑
      - 点击完成
      - 连续返回检查历史页已清除
    expected_result: 返回动作不离开结果页；成功携带完整卡号回钱包首页，失败回最初添加卡片页，均不能再看到本轮过程页。
    navigation_resolution: 蓝图详细导航裁决将‘最初添加卡片页’绑定为 AddBankCardPage/添加银行卡页；不得绑定 AddCardEntryPage。
    ut_layer: device
    ut_focus: 导航清栈计算可用纯函数覆盖。
    device_focus: 返回手势拦截、完成按钮和真实 NavPathStack。
    checkpoint:
      pre_screen: opening_result_success
      action:
        target_element_id: result_finish_btn
      post_screen: wallet_home
      required_element_ids:
        - home_root
    requirement_ref:
      source_path: doc/features/原始需求/1-2-银行卡/原始需求.md
      snippet: 添加结果页是个全屏页面，没有左滑箭头，也禁止左滑事件。
      snippet_sha256: 490381c8b6b42efb77a3f56604b3468939e34dc8184cc5fd11a0cf049607b619
  - id: AC-6
    prd_function: F7
    priority: P1
    description: 原有添加卡片、添加银行卡、全部银行、钱包首页导航链保持可用。
    testable: true
    verification_steps:
      - 运行既有路由用例
      - 在真机往返添加卡片与全部银行页面
    expected_result: 既有路由名称和页面返回语义不受新增流程破坏。
    ut_layer: both
    ut_focus: 路由注册和旧入口回归。
    device_focus: 旧页面互相跳转与返回。
    requirement_ref:
      source_path: doc/features/原始需求/1-2-银行卡/原始需求.md
      snippet: 测试用例要包含老代码和本轮新开发代码的页面互相跳转功能，不能导致原有路由受损。
      snippet_sha256: ac15e5291b666545510f25a924e0a4199a235258a04a34557d111026129edaf8
boundaries:
  - id: BD-1
    prd_exception: E1
    scenario: 用户输入或选择不完整。
    description: 未选择卡型、卡片、未同意协议或验证码不是六位数字时不得继续。
    priority: P0
    handling: 保持当前页面和输入，继续按钮置灰，不创建数据库记录。
    expected_behavior: 用户补齐合法输入后才可继续。
    affected_functions:
      - F2
      - F3
      - F4
    ut_layer: both
    ut_focus: 卡型、卡片、协议与六位数字验证码的组合门禁。
    device_focus: 四个界面的按钮启停和中途取消行为。
  - id: BD-2
    prd_exception: E2
    scenario: 用户快速重复点击发送验证码。
    description: 倒计时期间重复点击发送不触发新发送；归零后仅一次点击重启 60 秒。
    priority: P0
    handling: 倒计时状态为唯一门禁，忽略不可用期间点击。
    expected_behavior: 同一倒计时窗口只发生一次 mock 发送。
    affected_functions:
      - F4
    ut_layer: both
    ut_focus: 60 秒倒计时状态机、重复点击忽略与归零重启。
    device_focus: 倒计时文案和重发按钮实际交互。
  - id: BD-3
    prd_exception: E3
    scenario: 数据库创建、查询或插入失败。
    description: RDB 保存异常仍进入失败结果页且不泄漏完整卡号到日志或界面。
    priority: P0
    handling: 回滚/不提交当前写入，生成失败 OpeningResult，日志只记错误类别。
    expected_behavior: 失败结果页可完成退出，数据库无损坏或半写记录。
    affected_functions:
      - F5
      - F6
    ut_layer: both
    ut_focus: RDB 初始化/写入异常映射、事务原子性与敏感数据日志检查。
    device_focus: 失败结果页和完成后返回添加银行卡页。
  - id: BD-4
    prd_exception: E4
    scenario: 用户中途取消卡型或验证码流程。
    description: 半模态关闭或页面返回在结果页之前只丢弃当前未提交选择，不写数据库。
    priority: P1
    handling: 释放当前 opening session 的临时选择与计时器。
    expected_behavior: 返回原入口，重新进入时从初始状态开始。
    affected_functions:
      - F1
      - F2
      - F3
      - F4
    ut_layer: both
    ut_focus: Sheet 关闭与页面离开时的状态和 Timer 清理。
    device_focus: 中途关闭后重新进入的初始状态。
performance:
  - id: NFR-1
    metric: 交互响应
    threshold: "300"
    unit: ms
    description: 本地页面切换和按钮状态变化在普通真机上应即时可感，目标不超过 300ms；RDB 首次初始化除外但必须有进行中状态。
coverage_summary:
  total_functions: 7
  p0_functions: 6
  p1_functions: 1
  criteria_count: 6
  boundaries_count: 4
  performance_count: 1
  functions_with_ac:
    - F1
    - F2
    - F3
    - F4
    - F5
    - F6
    - F7
  uncovered_functions: []
  p0_p1_coverage: 7/7
  notes: AC-1..AC-6、BD-1..BD-4 与 NFR-1 逐字段保持蓝图权威内容；checkpoint 与 requirement_ref 为
    spec 视觉验收补充。

```

### (resolved input tested_code)

```
- path: 01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets
  content: |
    const CARD_PACK_PAGE: string = 'CardPackPage';
    const ADD_CARD_ENTRY_PAGE: string = 'AddCardEntryPage';
    const ADD_BANK_CARD_PAGE: string = 'AddBankCardPage';
    const ALL_BANKS_PAGE: string = 'AllBanksPage';
    const BANK_CARD_SELECTION_PAGE: string = 'BankCardSelectionPage';
    const BANK_CARD_OPENING_RESULT_PAGE: string = 'BankCardOpeningResultPage';

    /** Phone 根 Navigation 实际消费的新旧钱包目的页集合。 */
    export function walletDestinationNames(): string[] {
      return [
        CARD_PACK_PAGE,
        ADD_CARD_ENTRY_PAGE,
        ADD_BANK_CARD_PAGE,
        ALL_BANKS_PAGE,
        BANK_CARD_SELECTION_PAGE,
        BANK_CARD_OPENING_RESULT_PAGE
      ];
    }

    export function isWalletDestination(name: string): boolean {
      return walletDestinationNames().indexOf(name) >= 0;
    }
- path: 01-Product/Phone/src/main/ets/pages/index.ets
  content: >
    import { NavPathContext } from '@aspect/CommFunc';

    import {
      buildAddBankCardPage,
      buildAddCardEntryPage,
      buildAllBanksPage,
      buildBankCardOpeningResultPage,
      buildBankCardSelectionPage,
      buildCardPackPage,
      HomeTabPage,
      MineTabPage
    } from '@aspect/WalletMain';

    import { isWalletDestination } from
    '../navigation/WalletDestinationRegistry';


    @Entry

    @Component

    struct Index {
      @State navPathStack: NavPathStack = new NavPathStack();
      @State currentTabIndex: number = 0;

      aboutToAppear(): void {
        NavPathContext.attach(this.navPathStack);
      }

      @Builder
      navDestinationMap(name: string, param: Object) {
        if (isWalletDestination(name)) {
          if (name === 'CardPackPage') {
            buildCardPackPage();
          } else if (name === 'AddCardEntryPage') {
            buildAddCardEntryPage();
          } else if (name === 'AddBankCardPage') {
            buildAddBankCardPage();
          } else if (name === 'AllBanksPage') {
            buildAllBanksPage();
          } else if (name === 'BankCardSelectionPage') {
            buildBankCardSelectionPage(param);
          } else if (name === 'BankCardOpeningResultPage') {
            buildBankCardOpeningResultPage(param);
          }
        }
      }

      @Builder
      floatingTabBar() {
        Row() {
          Column({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.house_fill'))
              .fontSize(22)
              .fontColor([this.currentTabIndex === 0 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected')])
            Text($r('app.string.tab_home'))
              .fontSize(12)
              .fontColor(this.currentTabIndex === 0 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected'))
          }
          .layoutWeight(1)
          .onClick(() => {
            this.currentTabIndex = 0;
          })

          Column({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.person_fill'))
              .fontSize(22)
              .fontColor([this.currentTabIndex === 1 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected')])
            Text($r('app.string.tab_mine'))
              .fontSize(12)
              .fontColor(this.currentTabIndex === 1 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected'))
          }
          .layoutWeight(1)
          .onClick(() => {
            this.currentTabIndex = 1;
          })
        }
        .width('92%')
        .padding({ top: 8, bottom: 8 })
        .margin({ left: '4%', right: '4%', bottom: 12 })
        .backgroundColor(Color.White)
        .borderRadius(28)
        .shadow({ radius: 16, color: '#1A000000', offsetY: 4 })
      }

      build() {
        Navigation(this.navPathStack) {
          Stack({ alignContent: Alignment.Bottom }) {
            Column() {
              if (this.currentTabIndex === 0) {
                HomeTabPage({ navPathStack: $navPathStack })
              } else {
                MineTabPage()
              }
            }
            .width('100%')
            .height('100%')
            .padding({ bottom: 72 })

            this.floatingTabBar()
          }
          .width('100%')
          .height('100%')
          .backgroundColor($r('app.color.phone_page_bg'))
        }
        .hideTitleBar(true)
        .mode(NavigationMode.Stack)
        .navDestination(this.navDestinationMap)
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets
  content: |
    export enum BankCardType {
      DEBIT = 'DEBIT',
      CREDIT = 'CREDIT'
    }

    /** 银行提供的本地 mock 卡候选；完整卡号禁止直接展示或写日志。 */
    export interface BankCardCandidate {
      bankCode: string;
      bankName: string;
      cardNumber: string;
      cardType: BankCardType;
    }

    /** 具体卡片页路由参数。 */
    export interface BankCardSelectionParams {
      bankCode: string;
      cardType: BankCardType;
    }
- path: 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets
  content: |
    import { BankCardType } from './BankCardCandidate';

    /** 单家银行的展示数据（模拟数据，来源见 BankRepository） */
    export interface BankInfo {
      /** 银行短码，同时是 element id 后缀与 logo 资源键后缀，如 'cmb' */
      code: string;
      /** 银行显示名，如 '招商银行' */
      name: string;
      /** 汉语拼音全拼小写，用于块内升序排序，如 'zhaoshang' */
      pinyin: string;
      /** 拼音首字母大写，用于分块与字母索引，如 'Z' */
      initial: string;
      /** 品牌 logo 资源 */
      logo: Resource;
      /** 营销角标文案资源；无角标时为 undefined */
      badgeRes?: Resource;
      /** 当前银行支持的银行卡类型 */
      supportedCardTypes: BankCardType[];
    }
- path: 02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets
  content: >
    /** 成功开卡的一次性交接上下文；首页消费后立即清空。 */

    export class BankOpeningCompletionContext {
      private static pendingCardNumber: string | undefined = undefined;

      static publish(fullCardNumber: string): void {
        BankOpeningCompletionContext.pendingCardNumber = fullCardNumber;
      }

      static consume(): string | undefined {
        const value: string | undefined = BankOpeningCompletionContext.pendingCardNumber;
        BankOpeningCompletionContext.pendingCardNumber = undefined;
        return value;
      }

      static clear(): void {
        BankOpeningCompletionContext.pendingCardNumber = undefined;
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets
  content: |
    export interface OpeningResultParams {
      fullCardNumber: string;
      success: boolean;
      errorMessage?: string;
    }

    /** 开卡结果路由参数；完整卡号仅供后台交接，不得渲染或记录日志。 */
    export class OpeningResult {
      fullCardNumber: string;
      success: boolean;
      errorMessage?: string;

      constructor(params: OpeningResultParams) {
        this.fullCardNumber = params.fullCardNumber;
        this.success = params.success;
        this.errorMessage = params.errorMessage;
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets
  content: |
    export interface StoredCardParams {
      cardNumber: string;
      category: string;
      bankName: string;
      bankCardType: string;
      addedAt: number;
      huaweiPayEnabled: boolean;
      unionPayQuickPassEnabled: boolean;
      transactionRecords: string;
    }

    /** 钱包银行卡 RDB 的领域记录。 */
    export class StoredCard {
      cardNumber: string;
      category: string;
      bankName: string;
      bankCardType: string;
      addedAt: number;
      huaweiPayEnabled: boolean;
      unionPayQuickPassEnabled: boolean;
      transactionRecords: string;

      constructor(params: StoredCardParams) {
        this.cardNumber = params.cardNumber;
        this.category = params.category;
        this.bankName = params.bankName;
        this.bankCardType = params.bankCardType;
        this.addedAt = params.addedAt;
        this.huaweiPayEnabled = params.huaweiPayEnabled;
        this.unionPayQuickPassEnabled = params.unionPayQuickPassEnabled;
        this.transactionRecords = params.transactionRecords;
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
  content: >
    import { Context } from '@kit.AbilityKit';

    import { relationalStore } from '@kit.ArkData';

    import { StoredCard } from '../model/StoredCard';


    const DATABASE_NAME: string = 'wallet_bank_cards.rdb';

    const TABLE_NAME: string = 'cards';

    const CREATE_TABLE_SQL: string =
      'CREATE TABLE IF NOT EXISTS cards (' +
      'card_number TEXT PRIMARY KEY, ' +
      'category TEXT NOT NULL, ' +
      'bank_name TEXT NOT NULL, ' +
      'bank_card_type TEXT NOT NULL, ' +
      'added_at INTEGER NOT NULL, ' +
      'huawei_pay_enabled INTEGER NOT NULL, ' +
      'union_pay_quick_pass_enabled INTEGER NOT NULL, ' +
      'transaction_records TEXT NOT NULL)';
    const SELECT_COLUMNS: string =
      'card_number, category, bank_name, bank_card_type, added_at, ' +
      'huawei_pay_enabled, union_pay_quick_pass_enabled, transaction_records';

    /** Repository 的最小存储接缝；生产实现仍唯一落到 RDB。 */

    export interface BankCardStore {
      beginTransaction(): Promise<void>;
      commit(): Promise<void>;
      rollBack(): Promise<void>;
      findByCardNumber(cardNumber: string): Promise<StoredCard | undefined>;
      insert(card: StoredCard): Promise<void>;
      list(): Promise<StoredCard[]>;
    }


    /** 对 Harmony RDB 的薄包装，把系统对象隔离在 data 层。 */

    export class RdbBankCardStore implements BankCardStore {
      private storePromise: Promise<relationalStore.RdbStore> | null = null;
      private readonly context: Context;

      constructor(context: Context) {
        this.context = context;
      }

      private async store(): Promise<relationalStore.RdbStore> {
        if (this.storePromise === null) {
          this.storePromise = this.openStore();
        }
        return this.storePromise;
      }

      private async openStore(): Promise<relationalStore.RdbStore> {
        const config: relationalStore.StoreConfig = {
          name: DATABASE_NAME,
          securityLevel: relationalStore.SecurityLevel.S1
        };
        const store: relationalStore.RdbStore = await relationalStore.getRdbStore(this.context, config);
        await store.executeSql(CREATE_TABLE_SQL);
        return store;
      }

      async beginTransaction(): Promise<void> {
        const store: relationalStore.RdbStore = await this.store();
        store.beginTransaction();
      }

      async commit(): Promise<void> {
        const store: relationalStore.RdbStore = await this.store();
        store.commit();
      }

      async rollBack(): Promise<void> {
        const store: relationalStore.RdbStore = await this.store();
        store.rollBack();
      }

      async findByCardNumber(cardNumber: string): Promise<StoredCard | undefined> {
        const store: relationalStore.RdbStore = await this.store();
        const resultSet: relationalStore.ResultSet = await store.querySql(
          `SELECT ${SELECT_COLUMNS} FROM ${TABLE_NAME} WHERE card_number = ?`,
          [cardNumber]
        );
        try {
          if (!resultSet.goToFirstRow()) {
            return undefined;
          }
          return this.readCard(resultSet);
        } finally {
          resultSet.close();
        }
      }

      async insert(card: StoredCard): Promise<void> {
        const store: relationalStore.RdbStore = await this.store();
        const values: relationalStore.ValuesBucket = {
          card_number: card.cardNumber,
          category: card.category,
          bank_name: card.bankName,
          bank_card_type: card.bankCardType,
          added_at: card.addedAt,
          huawei_pay_enabled: card.huaweiPayEnabled ? 1 : 0,
          union_pay_quick_pass_enabled: card.unionPayQuickPassEnabled ? 1 : 0,
          transaction_records: card.transactionRecords
        };
        await store.insert(TABLE_NAME, values);
      }

      async list(): Promise<StoredCard[]> {
        const store: relationalStore.RdbStore = await this.store();
        const resultSet: relationalStore.ResultSet = await store.querySql(
          `SELECT ${SELECT_COLUMNS} FROM ${TABLE_NAME} ORDER BY added_at DESC`
        );
        const cards: StoredCard[] = [];
        try {
          if (!resultSet.goToFirstRow()) {
            return cards;
          }
          do {
            cards.push(this.readCard(resultSet));
          } while (resultSet.goToNextRow());
          return cards;
        } finally {
          resultSet.close();
        }
      }

      private readCard(resultSet: relationalStore.ResultSet): StoredCard {
        return new StoredCard({
          cardNumber: resultSet.getString(0),
          category: resultSet.getString(1),
          bankName: resultSet.getString(2),
          bankCardType: resultSet.getString(3),
          addedAt: resultSet.getLong(4),
          huaweiPayEnabled: resultSet.getLong(5) === 1,
          unionPayQuickPassEnabled: resultSet.getLong(6) === 1,
          transactionRecords: resultSet.getString(7)
        });
      }
    }


    /** 钱包银行卡本地 Repository；完整卡号是唯一业务键。 */

    export class BankCardRepository {
      private readonly store: BankCardStore;

      constructor(context: Context | null = null, store: BankCardStore | null = null) {
        if (store !== null) {
          this.store = store;
          return;
        }
        if (context === null) {
          throw new Error('bank card store unavailable');
        }
        this.store = new RdbBankCardStore(context);
      }

      async save(card: StoredCard): Promise<StoredCard> {
        await this.store.beginTransaction();
        try {
          const existing: StoredCard | undefined = await this.store.findByCardNumber(card.cardNumber);
          if (existing !== undefined) {
            await this.store.commit();
            return existing;
          }
          await this.store.insert(card);
          await this.store.commit();
          return card;
        } catch {
          await this.store.rollBack();
          const existing: StoredCard | undefined = await this.store.findByCardNumber(card.cardNumber);
          if (existing !== undefined) {
            return existing;
          }
          throw new Error('bank card save failed');
        }
      }

      async list(): Promise<StoredCard[]> {
        return this.store.list();
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
  content: >
    import { BankInfo } from '../model/BankInfo';

    import { BankCardCandidate, BankCardType } from
    '../model/BankCardCandidate';


    export class BankRepository {
      /**
       * 20 家银行模拟数据（编译期常量），顺序 = 展开态参考图顺序。
       * 无网络 / 无 IPC / 无数据库，不读任何持久化介质（BD-6）。
       */
      async getBanks(): Promise<BankInfo[]> {
        return [
          {
            code: 'cmb',
            name: '招商银行',
            pinyin: 'zhaoshang',
            initial: 'Z',
            logo: $r('app.media.bank_logo_cmb'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'icbc',
            name: '工商银行',
            pinyin: 'gongshang',
            initial: 'G',
            logo: $r('app.media.bank_logo_icbc'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'citic',
            name: '中信银行',
            pinyin: 'zhongxin',
            initial: 'Z',
            logo: $r('app.media.bank_logo_citic'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'hxb',
            name: '华夏银行',
            pinyin: 'huaxia',
            initial: 'H',
            logo: $r('app.media.bank_logo_hxb'),
            badgeRes: $r('app.string.bank_badge_first_bind'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'ccb',
            name: '建设银行',
            pinyin: 'jianshe',
            initial: 'J',
            logo: $r('app.media.bank_logo_ccb'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'abc',
            name: '农业银行',
            pinyin: 'nongye',
            initial: 'N',
            logo: $r('app.media.bank_logo_abc'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'bocom',
            name: '交通银行',
            pinyin: 'jiaotong',
            initial: 'J',
            logo: $r('app.media.bank_logo_bocom'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'psbc',
            name: '邮储银行',
            pinyin: 'youchu',
            initial: 'Y',
            logo: $r('app.media.bank_logo_psbc'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'spdb',
            name: '浦发银行',
            pinyin: 'pufa',
            initial: 'P',
            logo: $r('app.media.bank_logo_spdb'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'cmbc',
            name: '民生银行',
            pinyin: 'minsheng',
            initial: 'M',
            logo: $r('app.media.bank_logo_cmbc'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'pab',
            name: '平安银行',
            pinyin: 'pingan',
            initial: 'P',
            logo: $r('app.media.bank_logo_pab'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'cgb',
            name: '广发银行',
            pinyin: 'guangfa',
            initial: 'G',
            logo: $r('app.media.bank_logo_cgb'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'cib',
            name: '兴业银行',
            pinyin: 'xingye',
            initial: 'X',
            logo: $r('app.media.bank_logo_cib'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'bosh',
            name: '上海银行',
            pinyin: 'shanghai',
            initial: 'S',
            logo: $r('app.media.bank_logo_bosh'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'bobj',
            name: '北京银行',
            pinyin: 'beijing',
            initial: 'B',
            logo: $r('app.media.bank_logo_bobj'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'bonj',
            name: '南京银行',
            pinyin: 'nanjing',
            initial: 'N',
            logo: $r('app.media.bank_logo_bonj'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'bonb',
            name: '宁波银行',
            pinyin: 'ningbo',
            initial: 'N',
            logo: $r('app.media.bank_logo_bonb'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'bogz',
            name: '广州银行',
            pinyin: 'guangzhou',
            initial: 'G',
            logo: $r('app.media.bank_logo_bogz'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'ceb',
            name: '光大银行',
            pinyin: 'guangda',
            initial: 'G',
            logo: $r('app.media.bank_logo_ceb'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          },
          {
            code: 'boc',
            name: '中国银行',
            pinyin: 'zhongguo',
            initial: 'Z',
            logo: $r('app.media.bank_logo_boc'),
            supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
          }
        ];
      }

      /** 按银行与卡型返回 1–2 张完整 mock 候选；完整卡号只供后台链路使用。 */
      async getCards(bankCode: string, cardType: BankCardType): Promise<BankCardCandidate[]> {
        const banks: BankInfo[] = await this.getBanks();
        const index: number = banks.findIndex((bank: BankInfo) => bank.code === bankCode);
        if (index < 0) {
          return [];
        }
        const bank: BankInfo = banks[index];
        if (bank.supportedCardTypes.indexOf(cardType) < 0) {
          return [];
        }
        if (bankCode === 'cmb' && cardType === BankCardType.CREDIT) {
          return [
            { bankCode: bank.code, bankName: bank.name, cardNumber: '4392123412342269', cardType: cardType },
            { bankCode: bank.code, bankName: bank.name, cardNumber: '5187123412349088', cardType: cardType }
          ];
        }
        const bankSeed: string = (index + 1).toString().padStart(2, '0');
        const typeSeed: string = cardType === BankCardType.DEBIT ? '11' : '22';
        const first: BankCardCandidate = {
          bankCode: bank.code,
          bankName: bank.name,
          cardNumber: `6222${bankSeed}00000000${typeSeed}`,
          cardType: cardType
        };
        if (index % 2 !== 0) {
          return [first];
        }
        return [first, {
          bankCode: bank.code,
          bankName: bank.name,
          cardNumber: `9555${bankSeed}00000000${typeSeed}`,
          cardType: cardType
        }];
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
  content: >
    import {
      BankCardCandidate,
      BankCardSelectionParams,
      BankCardType
    } from '../../data/model/BankCardCandidate';

    import { OpeningResult } from '../../data/model/OpeningResult';

    import { StoredCard } from '../../data/model/StoredCard';

    import { BankCardRepository } from
    '../../data/repository/BankCardRepository';

    import { BankRepository } from '../../data/repository/BankRepository';

    import { OtpVerificationState } from './OtpService';


    export enum BankCardOpeningPhase {
      ENTRY = 'ENTRY',
      TYPE_SELECTED = 'TYPE_SELECTED',
      CARD_SELECTED = 'CARD_SELECTED',
      OTP_ACTIVE = 'OTP_ACTIVE',
      SAVING = 'SAVING',
      RESULT = 'RESULT'
    }


    /** 开卡纯业务规则，可脱离 ArkUI 直接验证。 */

    export class BankCardOpeningService {
      private readonly repository: BankCardRepository | null;
      private readonly bankRepository: BankRepository;
      private readonly otpState: OtpVerificationState | null;
      private readonly session: BankCardOpeningSession;
      private openingPhase: BankCardOpeningPhase = BankCardOpeningPhase.ENTRY;
      private openingResult: OpeningResult | null = null;

      constructor(
        repository: BankCardRepository | null = null,
        bankRepository: BankRepository = new BankRepository(),
        otpState: OtpVerificationState | null = null,
        session: BankCardOpeningSession = new BankCardOpeningSession()
      ) {
        this.repository = repository;
        this.bankRepository = bankRepository;
        this.otpState = otpState;
        this.session = session;
      }

      begin(bankCode: string, cardType: BankCardType): void {
        this.session.begin(bankCode);
        this.session.selectCardType(cardType);
        this.openingResult = null;
        this.openingPhase = BankCardOpeningPhase.TYPE_SELECTED;
      }

      async loadCandidates(): Promise<BankCardCandidate[]> {
        const params: BankCardSelectionParams | null = this.session.selectionParams();
        if (params === null) {
          return [];
        }
        return this.bankRepository.getCards(params.bankCode, params.cardType);
      }

      selectCandidate(candidate: BankCardCandidate): void {
        this.session.selectCandidate(candidate);
        this.openingPhase = BankCardOpeningPhase.CARD_SELECTED;
      }

      setAgreementAccepted(accepted: boolean): void {
        this.session.setAgreementAccepted(accepted);
      }

      canOpenOtp(): boolean {
        return this.session.canOpenOtp();
      }

      async startOtp(mobile: string): Promise<boolean> {
        if (!this.canOpenOtp() || this.otpState === null) {
          return false;
        }
        const sent: boolean = await this.otpState.start(mobile);
        if (sent) {
          this.openingPhase = BankCardOpeningPhase.OTP_ACTIVE;
        }
        return sent;
      }

      async resendOtp(): Promise<boolean> {
        if (this.otpState === null) {
          return false;
        }
        return this.otpState.resend();
      }

      tickOtp(): number {
        return this.otpState === null ? 0 : this.otpState.tick();
      }

      updateOtp(value: string, maxLength: number): string {
        if (this.otpState === null) {
          return '';
        }
        const otp: string = this.otpState.updateOtp(value, maxLength);
        this.session.setOtp(otp);
        return otp;
      }

      otpValue(): string {
        return this.otpState === null ? '' : this.otpState.otp;
      }

      otpCountdownSeconds(): number {
        return this.otpState === null ? 0 : this.otpState.countdownSeconds;
      }

      otpSending(): boolean {
        return this.otpState !== null && this.otpState.sending;
      }

      canSubmit(expectedOtpLength: number): boolean {
        return this.otpState !== null && this.otpState.canSubmit(expectedOtpLength) && this.session.canSubmit();
      }

      phase(): BankCardOpeningPhase {
        return this.openingPhase;
      }

      result(): OpeningResult | null {
        return this.openingResult;
      }

      maskCardNumber(cardNumber: string): string {
        if (cardNumber.length <= 8) {
          return cardNumber;
        }
        return `${cardNumber.substring(0, 4)} **** **** ${cardNumber.substring(cardNumber.length - 4)}`;
      }

      isValidOtp(otp: string): boolean {
        return /^\d{6}$/.test(otp);
      }

      toStoredCard(candidate: BankCardCandidate): StoredCard {
        return new StoredCard({
          cardNumber: candidate.cardNumber,
          category: 'BANK_CARD',
          bankName: candidate.bankName,
          bankCardType: candidate.cardType === BankCardType.DEBIT ? 'DEBIT' : 'CREDIT',
          addedAt: Date.now(),
          huaweiPayEnabled: true,
          unionPayQuickPassEnabled: true,
          transactionRecords: '[]'
        });
      }

      toOpeningResult(
        candidate: BankCardCandidate,
        success: boolean,
        errorMessage: string = ''
      ): OpeningResult {
        return new OpeningResult({
          fullCardNumber: candidate.cardNumber,
          success: success,
          errorMessage: errorMessage.length > 0 ? errorMessage : undefined
        });
      }

      async saveCandidate(candidate: BankCardCandidate): Promise<OpeningResult> {
        if (this.repository === null) {
          return this.toOpeningResult(candidate, false, 'RDB_STORE_UNAVAILABLE');
        }
        try {
          await this.repository.save(this.toStoredCard(candidate));
          return this.toOpeningResult(candidate, true);
        } catch {
          return this.toOpeningResult(candidate, false, 'RDB_SAVE_FAILED');
        }
      }

      async completeOpening(expectedOtpLength: number): Promise<OpeningResult | null> {
        const candidate: BankCardCandidate | null = this.session.selectedCandidate();
        if (candidate === null || !this.canSubmit(expectedOtpLength)) {
          return null;
        }
        this.openingPhase = BankCardOpeningPhase.SAVING;
        this.openingResult = await this.saveCandidate(candidate);
        this.openingPhase = BankCardOpeningPhase.RESULT;
        return this.openingResult;
      }

      cancelOtp(): void {
        if (this.openingPhase !== BankCardOpeningPhase.OTP_ACTIVE) {
          return;
        }
        if (this.otpState !== null) {
          this.otpState.cancel();
        }
        this.session.setOtp('');
        this.openingPhase = BankCardOpeningPhase.CARD_SELECTED;
      }

      cancel(): void {
        if (this.otpState !== null) {
          this.otpState.cancel();
        }
        this.session.cancel();
        this.openingResult = null;
        this.openingPhase = BankCardOpeningPhase.ENTRY;
      }
    }


    /** 跨 ArkUI 页面复用的开卡选择与继续门禁。 */

    export class BankCardOpeningSession {
      private bankCode: string = '';
      private cardType: BankCardType | null = null;
      private candidate: BankCardCandidate | null = null;
      private agreementAccepted: boolean = false;
      private otp: string = '';

      begin(bankCode: string): void {
        this.reset();
        this.bankCode = bankCode;
      }

      selectCardType(cardType: BankCardType): void {
        this.cardType = cardType;
      }

      selectionParams(): BankCardSelectionParams | null {
        if (this.bankCode.length === 0 || this.cardType === null) {
          return null;
        }
        return { bankCode: this.bankCode, cardType: this.cardType };
      }

      selectCandidate(candidate: BankCardCandidate): void {
        this.candidate = candidate;
      }

      setAgreementAccepted(accepted: boolean): void {
        this.agreementAccepted = accepted;
      }

      setOtp(otp: string): void {
        this.otp = otp;
      }

      canOpenOtp(): boolean {
        return this.candidate !== null && this.agreementAccepted;
      }

      canSubmit(): boolean {
        return this.canOpenOtp() && /^\d{6}$/.test(this.otp);
      }

      selectedCandidate(): BankCardCandidate | null {
        return this.candidate;
      }

      cancel(): void {
        this.reset();
      }

      reset(): void {
        this.bankCode = '';
        this.cardType = null;
        this.candidate = null;
        this.agreementAccepted = false;
        this.otp = '';
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets
  content: >
    import { BankOpeningCompletionContext } from
    '../../data/model/BankOpeningCompletionContext';

    import { OpeningResult } from '../../data/model/OpeningResult';

    import { BankConstants } from '../../shared/constant/BankConstants';


    /** 开卡完成后的定向清栈规则。 */

    export class OpeningNavigationService {
      finish(stack: NavPathStack, result: OpeningResult): void {
        if (result.success) {
          BankOpeningCompletionContext.publish(result.fullCardNumber);
          stack.clear(false);
          return;
        }
        BankOpeningCompletionContext.clear();
        stack.popToName(BankConstants.ROUTE_ADD_BANK_CARD, false);
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
  content: >
    /** 本地短信模拟服务；不发送网络请求，也不记录手机号。 */

    export class OtpService {
      async sendMockCode(mobile: string): Promise<void> {
        if (mobile.length === 0) {
          return Promise.resolve();
        }
        return Promise.resolve();
      }
    }


    /** 可由页面时钟或 UT 显式驱动的 OTP 状态对象。 */

    export class OtpVerificationState {
      otp: string = '';
      countdownSeconds: number = 0;
      sending: boolean = false;
      active: boolean = false;
      private mobile: string = '';
      private readonly otpService: OtpService;
      private readonly countdownStart: number;

      constructor(otpService: OtpService, countdownStart: number) {
        this.otpService = otpService;
        this.countdownStart = countdownStart;
      }

      async start(mobile: string): Promise<boolean> {
        this.reset();
        this.active = true;
        this.mobile = mobile;
        return this.send();
      }

      async resend(): Promise<boolean> {
        if (!this.active || this.countdownSeconds > 0) {
          return false;
        }
        return this.send();
      }

      tick(): number {
        if (!this.active || this.countdownSeconds === 0) {
          return this.countdownSeconds;
        }
        this.countdownSeconds -= 1;
        return this.countdownSeconds;
      }

      updateOtp(value: string, maxLength: number): string {
        this.otp = value.replace(/[^0-9]/g, '').substring(0, maxLength);
        return this.otp;
      }

      canSubmit(expectedLength: number): boolean {
        return this.active && this.otp.length === expectedLength && /^\d+$/.test(this.otp);
      }

      cancel(): void {
        this.active = false;
        this.reset();
      }

      reset(): void {
        this.otp = '';
        this.countdownSeconds = 0;
        this.sending = false;
        this.mobile = '';
      }

      private async send(): Promise<boolean> {
        if (!this.active || this.sending || this.mobile.length === 0) {
          return false;
        }
        this.sending = true;
        try {
          await this.otpService.sendMockCode(this.mobile);
          if (!this.active) {
            return false;
          }
          this.countdownSeconds = this.countdownStart;
          return true;
        } finally {
          this.sending = false;
        }
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/index.ets
  content: >
    export { applyLaunchHomeCardMode } from './shared/HomeLaunchBridge';


    export { HomeTabPage } from './presentation/pages/HomeTabPage';


    export { MineTabPage } from './presentation/pages/MineTabPage';


    export { buildCardPackPage } from './presentation/pages/CardPackPage';


    export { buildAddCardEntryPage } from
    './presentation/pages/AddCardEntryPage';


    export { buildAddBankCardPage } from './presentation/pages/AddBankCardPage';


    export { buildAllBanksPage } from './presentation/pages/AllBanksPage';


    export { buildBankCardSelectionPage } from
    './presentation/pages/BankCardSelectionPage';


    export { buildBankCardOpeningResultPage } from
    './presentation/pages/BankCardOpeningResultPage';
- path: 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
  content: >
    import { BankCardSelectionParams, BankCardType } from
    '../../data/model/BankCardCandidate';

    import { BankInfo } from '../../data/model/BankInfo';

    import { BankCardOpeningSession } from
    '../../domain/service/BankCardOpeningService';


    @Component

    export struct CardTypeSheet {
      @Prop bank: BankInfo;
      @State selectedType: BankCardType | null = null;
      onContinue: (bank: BankInfo, cardType: BankCardType) => void =
        (_bank: BankInfo, _cardType: BankCardType): void => {};
      onClose: () => void = (): void => {};
      private readonly openingSession: BankCardOpeningSession = new BankCardOpeningSession();

      aboutToAppear(): void {
        this.selectedType = null;
        this.openingSession.begin(this.bank.code);
      }

      private selectCardType(cardType: BankCardType): void {
        this.openingSession.selectCardType(cardType);
        this.selectedType = cardType;
      }

      private continueOpening(): void {
        const params: BankCardSelectionParams | null = this.openingSession.selectionParams();
        if (params === null) {
          return;
        }
        this.onContinue(this.bank, params.cardType);
      }

      private closeSheet(): void {
        this.openingSession.cancel();
        this.selectedType = null;
        this.onClose();
      }

      @Builder
      private cardTypeRow(cardType: BankCardType, text: Resource, elementId: string) {
        Row() {
          Text(text)
            .fontSize(16)
            .fontColor(this.selectedType === cardType
              ? $r('app.color.brand_primary')
              : $r('app.color.color_text_primary'))
            .layoutWeight(1)

          SymbolGlyph(this.selectedType === cardType
            ? $r('sys.symbol.checkmark_circle_fill')
            : $r('sys.symbol.circle'))
            .fontSize(22)
            .fontColor([this.selectedType === cardType
              ? $r('app.color.brand_primary')
              : $r('app.color.color_text_secondary')])
        }
        .width('100%')
        .height(52)
        .padding({ left: 16, right: 16 })
        .id(elementId)
        .onClick(() => {
          this.selectCardType(cardType);
        })
      }

      build() {
        Column() {
          Row() {
            Text($r('app.string.card_type_sheet_title'))
              .fontSize($r('app.float.bank_font_page_title'))
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.color_text_primary'))
              .layoutWeight(1)
              .id('card_type_sheet_title')

            Row() {
              SymbolGlyph($r('sys.symbol.xmark'))
                .fontSize(18)
                .fontColor([$r('app.color.color_text_primary')])
            }
            .width(36)
            .height(36)
            .justifyContent(FlexAlign.Center)
            .backgroundColor($r('app.color.color_nav_btn_bg'))
            .borderRadius(18)
            .id('card_type_sheet_close')
            .onClick(() => {
              this.closeSheet();
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          Column() {
            Row() {
              Image(this.bank.logo)
                .width(34)
                .height(34)
                .objectFit(ImageFit.Contain)
                .margin({ right: 12 })
              Text(this.bank.name)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.color_text_primary'))
            }
            .width('100%')
            .height(56)
            .padding({ left: 16, right: 16 })
            .id('card_type_bank_row')

            if (this.bank.supportedCardTypes.indexOf(BankCardType.DEBIT) >= 0) {
              this.cardTypeRow(BankCardType.DEBIT, $r('app.string.bank_card_type_debit'), 'debit_card_row')
            }
            if (this.bank.supportedCardTypes.indexOf(BankCardType.CREDIT) >= 0) {
              this.cardTypeRow(BankCardType.CREDIT, $r('app.string.bank_card_type_credit'), 'credit_card_row')
            }
          }
          .width('100%')
          .backgroundColor($r('app.color.color_card_bg'))
          .borderRadius($r('app.float.bank_radius_card'))
          .margin({ top: 18 })
          .id('card_type_bank_card')

          Text($r('app.string.card_type_authorization', this.bank.name))
            .fontSize(13)
            .fontColor($r('app.color.color_text_secondary'))
            .width('100%')
            .margin({ top: 14 })
            .id('card_type_authorization_copy')

          Text($r('app.string.card_type_agreement'))
            .fontSize(13)
            .fontColor($r('app.color.brand_primary'))
            .width('100%')
            .margin({ top: 12 })
            .id('card_type_agreement_copy')

          Button($r('app.string.card_type_continue'))
            .enabled(this.selectedType !== null)
            .width('50%')
            .height(46)
            .fontSize(16)
            .fontColor(Color.White)
            .backgroundColor(this.selectedType === null
              ? $r('app.color.button_tonal_bg')
              : $r('app.color.brand_primary'))
            .margin({ top: 20, bottom: 16 })
            .id('card_type_continue_btn')
            .onClick(() => {
              this.continueOpening();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 18 })
        .alignItems(HorizontalAlign.Center)
        .backgroundColor($r('app.color.color_page_bg'))
        .id('card_type_sheet_panel')
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
  content: >
    import { AccountService, UserProfile } from '@aspect/AccountManager';

    import { OpeningResult } from '../../data/model/OpeningResult';

    import { BankCardOpeningService } from
    '../../domain/service/BankCardOpeningService';

    import { BankConstants } from '../../shared/constant/BankConstants';


    @Component

    export struct OtpVerificationSheet {
      @State mobile: string = '';
      @State otp: string = '';
      @State countdownSeconds: number = 0;
      @State sending: boolean = false;
      @State saving: boolean = false;
      onFinished: (result: OpeningResult) => void = (_result: OpeningResult): void => {};
      onClose: () => void = (): void => {};
      openingService: BankCardOpeningService = new BankCardOpeningService();
      private timerId: number = -1;
      private isActive: boolean = false;

      aboutToAppear(): void {
        this.isActive = true;
        void this.loadMobileAndSend();
      }

      aboutToDisappear(): void {
        this.isActive = false;
        this.resetTransientState();
      }

      private async loadMobileAndSend(): Promise<void> {
        const profile: UserProfile = await AccountService.getInstance().getUserProfile();
        if (!this.isActive) {
          return;
        }
        this.mobile = profile.mobile;
        const sent: boolean = await this.openingService.startOtp(this.mobile);
        this.syncOtpState();
        if (sent) {
          this.startCountdownTimer();
        }
      }

      private async sendCode(): Promise<void> {
        const sent: boolean = await this.openingService.resendOtp();
        this.syncOtpState();
        if (sent && this.isActive) {
          this.startCountdownTimer();
        }
      }

      private startCountdownTimer(): void {
        this.stopCountdown();
        this.timerId = setInterval(() => {
          const remaining: number = this.openingService.tickOtp();
          this.syncOtpState();
          if (remaining === 0) {
            this.stopCountdown();
          }
        }, 1000);
      }

      private stopCountdown(): void {
        if (this.timerId >= 0) {
          clearInterval(this.timerId);
          this.timerId = -1;
        }
      }

      private resetTransientState(): void {
        this.stopCountdown();
        this.openingService.cancelOtp();
        this.syncOtpState();
        this.saving = false;
      }

      private handleOtpChange(value: string): void {
        this.openingService.updateOtp(value, BankConstants.OTP_LENGTH);
        this.syncOtpState();
      }

      private syncOtpState(): void {
        this.otp = this.openingService.otpValue();
        this.countdownSeconds = this.openingService.otpCountdownSeconds();
        this.sending = this.openingService.otpSending();
      }

      private canSubmit(): boolean {
        return this.openingService.canSubmit(BankConstants.OTP_LENGTH);
      }

      private isOtpComplete(): boolean {
        return /^\d{6}$/.test(this.otp);
      }

      private maskMobile(mobile: string): string {
        if (mobile.length < 7) {
          return mobile;
        }
        return `${mobile.substring(0, 3)}****${mobile.substring(mobile.length - 4)}`;
      }

      private async saveSelectedCard(): Promise<void> {
        if (this.saving || !this.canSubmit()) {
          return;
        }
        this.saving = true;
        const result: OpeningResult | null = await this.openingService.completeOpening(BankConstants.OTP_LENGTH);
        if (!this.isActive) {
          return;
        }
        this.saving = false;
        if (result === null) {
          return;
        }
        this.stopCountdown();
        this.onFinished(result);
      }

      build() {
        Column() {
          Row() {
            Text($r('app.string.otp_sheet_title'))
              .fontSize($r('app.float.bank_font_page_title'))
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.color_text_primary'))
              .layoutWeight(1)
              .id('otp_sheet_title')

            Row() {
              SymbolGlyph($r('sys.symbol.xmark'))
                .fontSize(18)
                .fontColor([$r('app.color.color_text_primary')])
            }
            .width(36)
            .height(36)
            .justifyContent(FlexAlign.Center)
            .backgroundColor($r('app.color.color_nav_btn_bg'))
            .borderRadius(18)
            .enabled(!this.saving)
            .id('otp_sheet_close')
            .onClick(() => {
              if (this.saving) {
                return;
              }
              this.resetTransientState();
              this.onClose();
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          Text($r('app.string.otp_instruction'))
            .fontSize(14)
            .fontColor($r('app.color.color_text_secondary'))
            .width('100%')
            .margin({ top: 24 })
            .id('otp_instruction')

          Text($r('app.string.otp_phone_hint', this.maskMobile(this.mobile)))
            .fontSize(14)
            .fontColor($r('app.color.color_text_primary'))
            .width('100%')
            .margin({ top: 4 })
            .id('otp_phone_hint')

          Row() {
            TextInput({ text: this.otp, placeholder: $r('app.string.otp_input_placeholder') })
              .type(InputType.Number)
              .maxLength(BankConstants.OTP_LENGTH)
              .fontSize(16)
              .backgroundColor(Color.Transparent)
              .layoutWeight(1)
              .id('otp_input')
              .onChange((value: string) => {
                this.handleOtpChange(value);
              })

            Button(this.countdownSeconds > 0
              ? $r('app.string.otp_countdown', this.countdownSeconds)
              : $r('app.string.otp_resend'))
              .enabled(this.countdownSeconds === 0 && !this.sending)
              .width('30%')
              .height(44)
              .fontSize(14)
              .fontColor($r('app.color.brand_primary'))
              .backgroundColor(Color.Transparent)
              .id('otp_resend_action')
              .onClick(() => {
                void this.sendCode();
              })
          }
          .width('100%')
          .height(58)
          .padding({ left: 12, right: 8 })
          .backgroundColor($r('app.color.color_card_bg'))
          .borderRadius(12)
          .margin({ top: 18 })
          .id('otp_code_row')

          Button($r('app.string.opening_next'))
            .enabled(this.isOtpComplete() && !this.saving)
            .width('88%')
            .height(48)
            .fontSize(16)
            .fontColor(this.isOtpComplete() ? Color.White : $r('app.color.brand_primary'))
            .backgroundColor(this.isOtpComplete()
              ? $r('app.color.brand_primary')
              : $r('app.color.button_tonal_bg'))
            .margin({ top: 24, bottom: 18 })
            .id('otp_next_btn')
            .onClick(() => {
              void this.saveSelectedCard();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 18 })
        .alignItems(HorizontalAlign.Center)
        .backgroundColor($r('app.color.color_page_bg'))
        .id('otp_sheet_panel')
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets
  content: >
    import { Context } from '@kit.AbilityKit';

    import { Logger, NavPathContext } from '@aspect/CommFunc';

    import { showToast } from '@aspect/CommUI';

    import { BankCardSelectionParams, BankCardType } from
    '../../data/model/BankCardCandidate';

    import { BankInfo } from '../../data/model/BankInfo';

    import { BankRepository } from '../../data/repository/BankRepository';

    import { BankGroupService } from '../../domain/service/BankGroupService';

    import { BankConstants } from '../../shared/constant/BankConstants';

    import { BankListRow } from '../components/BankListRow';

    import { CardTypeSheet } from '../components/CardTypeSheet';


    /**
     * 添加银行卡页面：收起态与展开态是同一路由的两个形态（expanded 状态位切换，不入栈），
     * 从全部银行页返回后仍保持展开态（AC-12）。
     */
    @Component

    struct AddBankCardPage {
      @State banks: BankInfo[] = [];
      @State expanded: boolean = false;
      @State availableHeightVp: number = 0;
      @State loadFailed: boolean = false;
      @State selectedBank: BankInfo | null = null;
      // arkui-lint:allow arkui_singleton_flow_multi_subscriber — 两个独立入口页各自承载本页 Sheet，并非共享 singleton 状态。
      @State showCardTypeSheet: boolean = false;
      private readonly bankRepo: BankRepository = new BankRepository();
      private lastNavAtMs: number = 0;
      private lastToastAtMs: number = 0;
      private sheetDismissing: boolean = false;
      private pendingBank: BankInfo | null = null;

      aboutToAppear(): void {
        void this.loadBanks();
      }

      /** 取数：本地常量数据源，异常降级为空态并提示一次（BD-2） */
      private async loadBanks(): Promise<void> {
        try {
          this.banks = await this.bankRepo.getBanks();
          this.loadFailed = false;
        } catch (err) {
          this.banks = [];
          this.loadFailed = true;
          Logger.error(BankConstants.LOG_TAG, 'load banks failed on AddBankCardPage');
          this.showTip($r('app.string.bank_list_load_failed'));
        }
      }

      /** 节流提示（BD-3）：同一窗口内只提示一次 */
      private showTip(res: Resource): void {
        const now: number = Date.now();
        if (now - this.lastToastAtMs < BankConstants.TOAST_THROTTLE_MS) {
          return;
        }
        this.lastToastAtMs = now;
        try {
          const ctx = this.getUIContext().getHostContext() as Context;
          showToast(ctx.resourceManager.getStringSync(res.id));
        } catch (err) {
          Logger.error(BankConstants.LOG_TAG, 'show toast failed on AddBankCardPage');
        }
      }

      /** 双入口复用的卡型选择起点。 */
      private openCardTypeSheet(bank: BankInfo): void {
        Logger.info(BankConstants.LOG_TAG, 'bank tapped: %{public}s', bank.code);
        if (this.showCardTypeSheet && !this.sheetDismissing) {
          return;
        }
        if (this.sheetDismissing) {
          this.pendingBank = bank;
          return;
        }
        this.selectedBank = bank;
        this.showCardTypeSheet = true;
      }

      private continueToCardSelection(bank: BankInfo, cardType: BankCardType): void {
        this.sheetDismissing = true;
        this.pendingBank = null;
        this.showCardTypeSheet = false;
        const param: BankCardSelectionParams = { bankCode: bank.code, cardType: cardType };
        try {
          NavPathContext.stack().pushPath({
            name: BankConstants.ROUTE_BANK_CARD_SELECTION,
            param: param
          });
        } catch {
          Logger.error(BankConstants.LOG_TAG, 'push BankCardSelectionPage failed');
          this.showTip($r('app.string.bank_nav_failed'));
        }
      }

      private closeCardTypeSheet(): void {
        this.sheetDismissing = true;
        this.pendingBank = null;
        this.showCardTypeSheet = false;
      }

      private handleCardTypeSheetDisappear(): void {
        this.showCardTypeSheet = false;
        this.sheetDismissing = false;
        const pendingBank: BankInfo | null = this.pendingBank;
        this.pendingBank = null;
        if (pendingBank === null) {
          this.selectedBank = null;
          return;
        }
        setTimeout(() => {
          this.selectedBank = pendingBank;
          this.showCardTypeSheet = true;
        }, 0);
      }

      /** 「更多」：同页切换为展开态，不入栈（AC-4） */
      private handleMoreTap(): void {
        if (this.showCardTypeSheet && !this.sheetDismissing) {
          return;
        }
        this.expanded = true;
      }

      /** 「查看全部银行」：入栈全部银行页面，带防重入窗口（AC-6 / BD-3） */
      private handleViewAllBanks(): void {
        if (this.showCardTypeSheet && !this.sheetDismissing) {
          return;
        }
        const now: number = Date.now();
        if (now - this.lastNavAtMs < BankConstants.NAV_DEBOUNCE_MS) {
          return;
        }
        this.lastNavAtMs = now;
        try {
          NavPathContext.stack().pushPath({ name: BankConstants.ROUTE_ALL_BANKS });
        } catch (err) {
          Logger.error(BankConstants.LOG_TAG, 'push AllBanksPage failed');
          this.showTip($r('app.string.bank_nav_failed'));
        }
      }

      /** 返回上一页（AC-13） */
      private handleBack(): void {
        try {
          NavPathContext.stack().pop();
        } catch (err) {
          Logger.error(BankConstants.LOG_TAG, 'pop from AddBankCardPage failed');
          this.showTip($r('app.string.bank_nav_failed'));
        }
      }

      private visibleRowCount(): number {
        // 白卡不占满剩余屏高：先扣掉参考图版面里白卡下沿到容器下沿的留白，再按行高分配（AC-2 = 7 行）
        return BankGroupService.calcVisibleRowCount(
          this.availableHeightVp - BankConstants.CARD_BOTTOM_RESERVE_VP,
          BankConstants.ROW_HEIGHT_VP,
          BankConstants.PILL_BLOCK_HEIGHT_VP,
          this.banks.length
        );
      }

      private pillBanks(): BankInfo[] {
        const visible: number = this.visibleRowCount();
        const iconCount: number = BankGroupService.calcPillIconCount(
          this.banks.length,
          visible,
          BankConstants.MAX_PILL_ICONS
        );
        return this.banks.slice(visible, visible + iconCount);
      }

      @Builder
      private navBar(prefix: string) {
        Row() {
          // 返回按钮：浅灰圆底 + 左箭头（参考图形态）。刻意不用 Button 容器，避免与自绘圆底样式冲突。
          Row() {
            SymbolGlyph($r('sys.symbol.chevron_left'))
              .fontSize(20)
              .fontColor([$r('app.color.color_text_primary')])
          }
          .width(36)
          .height(36)
          .justifyContent(FlexAlign.Center)
          .backgroundColor($r('app.color.color_nav_btn_bg'))
          .borderRadius(18)
          .id(`${prefix}_back_btn`)
          .onClick(() => {
            this.handleBack();
          })

          Text($r('app.string.add_bank_card_title'))
            .fontSize($r('app.float.bank_font_page_title'))
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.color_text_primary'))
            .margin({ left: 12 })
            .id(`${prefix}_page_title`)
        }
        .width('100%')
        .height(48)
        .alignItems(VerticalAlign.Center)
        .id(`${prefix}_nav_bar`)
      }

      @Builder
      private subtitleRow(prefix: string) {
        Row() {
          Text($r('app.string.add_bank_card_no_input'))
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_text_secondary'))
            .textAlign(TextAlign.Start)
            .id(`${prefix}_subtitle_left`)

          Blank()

          Text($r('app.string.add_bank_card_support_count'))
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_text_secondary'))
            .textAlign(TextAlign.End)
            .id(`${prefix}_subtitle_right`)
        }
        .width('100%')
        .padding({ left: 12, right: 12 })
        // 上留白 36vp：参考图 1-a 白卡上沿在 y=453px（3.0 px/vp），16vp 时白卡整体偏上 59px
        .margin({ top: 36, bottom: 12 })
      }

      @Builder
      private searchRow(prefix: string) {
        Row() {
          SymbolGlyph($r('sys.symbol.magnifyingglass'))
            .fontSize(18)
            .fontColor([$r('app.color.color_text_secondary')])

          Text($r('app.string.add_bank_card_search_placeholder'))
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_text_secondary'))
            .margin({ left: 8 })
            .id(`${prefix}_search_placeholder`)

          Blank()

          Divider()
            .vertical(true)
            .height(20)
            .color($r('app.color.color_line_divider'))

          Text($r('app.string.add_bank_card_search_action'))
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_link_blue'))
            .margin({ left: 12 })
            .id(`${prefix}_search_action`)
        }
        .width('100%')
        .height(44)
        .padding({ left: 12, right: 12 })
        .backgroundColor($r('app.color.color_card_bg'))
        .borderRadius($r('app.float.bank_radius_card'))
        .margin({ bottom: 12 })
        .id('background_search_bank')
      }

      /** 收起态白卡：按剩余屏高渲染的银行行 + 「更多」药丸 */
      @Builder
      private collapsedCard() {
        Column() {
          ForEach(this.banks.slice(0, this.visibleRowCount()), (bank: BankInfo, index: number) => {
            BankListRow({
              bank: bank,
              idPrefix: 'col',
              showDivider: index < this.visibleRowCount() - 1,
              onTap: (tapped: BankInfo): void => {
                this.openCardTypeSheet(tapped);
              }
            })
          }, (bank: BankInfo) => bank.code)

          if (this.pillBanks().length > 0) {
            Row() {
              ForEach(this.pillBanks(), (bank: BankInfo) => {
                Image(bank.logo)
                  .width(22)
                  .height(22)
                  .objectFit(ImageFit.Contain)
                  .margin({ right: 6 })
                  .id(`col_pill_icon_${bank.code}`)
              }, (bank: BankInfo) => bank.code)

              Text($r('app.string.bank_more'))
                .fontSize($r('app.float.bank_font_caption'))
                .fontColor($r('app.color.color_text_secondary'))
                .margin({ left: 2 })
                .id('col_more_text')

              SymbolGlyph($r('sys.symbol.chevron_down'))
                .fontSize(14)
                .fontColor([$r('app.color.color_text_secondary')])
                .margin({ left: 4 })
                .id('col_more_chevron')
            }
            .height($r('app.float.bank_space_pill_height'))
            .padding({ left: 12, right: 12 })
            .backgroundColor($r('app.color.color_pill_bg'))
            .borderRadius($r('app.float.bank_radius_pill'))
            // 24 + 32(药丸) + 12 = PILL_BLOCK_HEIGHT_VP，与参考图 1-a 的药丸块 206px 对齐
            .margin({ top: 24, bottom: 12 })
            .id('col_more_pill')
            .onClick(() => {
              this.handleMoreTap();
            })
          }
        }
        .width('100%')
        .backgroundColor($r('app.color.color_card_bg'))
        .borderRadius($r('app.float.bank_radius_card'))
        .id('col_bank_card')
      }

      /** 展开态白卡：20 行 + 卡内页脚「查看全部银行」 */
      @Builder
      private expandedCard() {
        Column() {
          ForEach(this.banks, (bank: BankInfo, index: number) => {
            BankListRow({
              bank: bank,
              idPrefix: 'exp',
              showDivider: index < this.banks.length - 1,
              onTap: (tapped: BankInfo): void => {
                this.openCardTypeSheet(tapped);
              }
            })
          }, (bank: BankInfo) => bank.code)

          Text($r('app.string.bank_view_all_banks'))
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_link_blue'))
            .width('100%')
            .height(48)
            .textAlign(TextAlign.Center)
            .id('exp_view_all_banks_btn')
            .onClick(() => {
              this.handleViewAllBanks();
            })
        }
        .width('100%')
        .backgroundColor($r('app.color.color_card_bg'))
        .borderRadius($r('app.float.bank_radius_card'))
        .id('exp_bank_card')
      }

      @Builder
      private emptyState() {
        Text(this.loadFailed ? $r('app.string.bank_list_load_failed') : $r('app.string.bank_list_empty'))
          .fontSize($r('app.float.bank_font_caption'))
          .fontColor($r('app.color.color_text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Center)
          .margin({ top: 48 })
      }

      @Builder
      private collapsedBody() {
        Column() {
          this.navBar('col')
          this.subtitleRow('col')
          this.searchRow('col')

          Column() {
            if (this.banks.length === 0) {
              this.emptyState()
            } else {
              this.collapsedCard()
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          .onAreaChange((_oldValue: Area, newValue: Area) => {
            // 容器高由 layoutWeight 决定（父驱动），子元素变化不会回写高度，故无量测反馈环
            this.availableHeightVp = Number.parseFloat(newValue.height.toString());
          })
        }
        .width('100%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({
          left: $r('app.float.bank_space_page_margin'),
          right: $r('app.float.bank_space_page_margin')
        })
        .backgroundColor($r('app.color.color_page_bg'))
        .id('col_root')
      }

      @Builder
      private expandedBody() {
        Column() {
          this.navBar('exp')
          this.subtitleRow('exp')
          this.searchRow('exp')

          if (this.banks.length === 0) {
            this.emptyState()
          } else {
            List() {
              ListItem() {
                this.expandedCard()
              }
            }
            .width('100%')
            .layoutWeight(1)
            .scrollBar(BarState.Off)
          }
        }
        .width('100%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({
          left: $r('app.float.bank_space_page_margin'),
          right: $r('app.float.bank_space_page_margin')
        })
        .backgroundColor($r('app.color.color_page_bg'))
        .id('exp_root')
      }

      @Builder
      private cardTypeSheetBuilder() {
        if (this.selectedBank !== null) {
          CardTypeSheet({
            bank: this.selectedBank,
            onContinue: (bank: BankInfo, cardType: BankCardType): void => {
              this.continueToCardSelection(bank, cardType);
            },
            onClose: (): void => {
              this.closeCardTypeSheet();
            }
          })
        }
      }

      build() {
        NavDestination() {
          Stack() {
            if (this.expanded) {
              this.expandedBody()
            } else {
              this.collapsedBody()
            }
          }
          .width('100%')
          .height('100%')
          .bindSheet($$this.showCardTypeSheet, this.cardTypeSheetBuilder(), {
            height: SheetSize.FIT_CONTENT,
            showClose: false,
            dragBar: false,
            enableOutsideInteractive: false,
            backgroundColor: $r('app.color.color_page_bg'),
            onDisappear: () => {
              this.handleCardTypeSheetDisappear();
            }
          })
        }
        .hideTitleBar(true)
        .onBackPressed(() => {
          this.handleBack();
          return true;
        })
      }
    }


    @Builder

    export function buildAddBankCardPage() {
      AddBankCardPage();
    }
- path: 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets
  content: >
    import { Context } from '@kit.AbilityKit';

    import { Logger, NavPathContext } from '@aspect/CommFunc';

    import { showToast } from '@aspect/CommUI';

    import { BankCardSelectionParams, BankCardType } from
    '../../data/model/BankCardCandidate';

    import { BankGroup } from '../../data/model/BankGroup';

    import { BankInfo } from '../../data/model/BankInfo';

    import { BankRepository } from '../../data/repository/BankRepository';

    import { BankGroupService } from '../../domain/service/BankGroupService';

    import { BankConstants } from '../../shared/constant/BankConstants';

    import { BankListRow } from '../components/BankListRow';

    import { CardTypeSheet } from '../components/CardTypeSheet';


    /**
     * 全部银行页面：A-Z 分组列表（每块「字母标签 + 白卡」）+ 右缘竖排字母索引条。
     * 内容列右内缩 40vp、索引条宽 16vp 距右 4vp，两者 bounds 零相交（AC-G1）。
     */
    @Component

    struct AllBanksPage {
      @State groups: BankGroup[] = [];
      @State indexLetters: string[] = [];
      @State loadFailed: boolean = false;
      @State selectedBank: BankInfo | null = null;
      // arkui-lint:allow arkui_singleton_flow_multi_subscriber — 两个独立入口页各自承载本页 Sheet，并非共享 singleton 状态。
      @State showCardTypeSheet: boolean = false;
      private readonly bankRepo: BankRepository = new BankRepository();
      private readonly listScroller: Scroller = new Scroller();
      private lastToastAtMs: number = 0;
      private sheetDismissing: boolean = false;
      private pendingBank: BankInfo | null = null;

      aboutToAppear(): void {
        void this.loadGroups();
      }

      /** 取数 + 分组：异常降级为空态并提示一次（BD-2） */
      private async loadGroups(): Promise<void> {
        try {
          const banks: BankInfo[] = await this.bankRepo.getBanks();
          this.groups = BankGroupService.groupByInitial(banks);
          this.indexLetters = BankGroupService.collectIndexLetters(this.groups);
          this.loadFailed = false;
        } catch (err) {
          this.groups = [];
          this.indexLetters = [];
          this.loadFailed = true;
          Logger.error(BankConstants.LOG_TAG, 'load banks failed on AllBanksPage');
          this.showTip($r('app.string.bank_list_load_failed'));
        }
      }

      /** 节流提示（BD-3） */
      private showTip(res: Resource): void {
        const now: number = Date.now();
        if (now - this.lastToastAtMs < BankConstants.TOAST_THROTTLE_MS) {
          return;
        }
        this.lastToastAtMs = now;
        try {
          const ctx = this.getUIContext().getHostContext() as Context;
          showToast(ctx.resourceManager.getStringSync(res.id));
        } catch (err) {
          Logger.error(BankConstants.LOG_TAG, 'show toast failed on AllBanksPage');
        }
      }

      /** 与添加银行卡页复用同一卡型选择流程。 */
      private openCardTypeSheet(bank: BankInfo): void {
        Logger.info(BankConstants.LOG_TAG, 'bank tapped: %{public}s', bank.code);
        if (this.showCardTypeSheet && !this.sheetDismissing) {
          return;
        }
        if (this.sheetDismissing) {
          this.pendingBank = bank;
          return;
        }
        this.selectedBank = bank;
        this.showCardTypeSheet = true;
      }

      private continueToCardSelection(bank: BankInfo, cardType: BankCardType): void {
        this.sheetDismissing = true;
        this.pendingBank = null;
        this.showCardTypeSheet = false;
        const param: BankCardSelectionParams = { bankCode: bank.code, cardType: cardType };
        try {
          NavPathContext.stack().pushPath({
            name: BankConstants.ROUTE_BANK_CARD_SELECTION,
            param: param
          });
        } catch {
          Logger.error(BankConstants.LOG_TAG, 'push BankCardSelectionPage failed');
          this.showTip($r('app.string.bank_nav_failed'));
        }
      }

      private closeCardTypeSheet(): void {
        this.sheetDismissing = true;
        this.pendingBank = null;
        this.showCardTypeSheet = false;
      }

      private handleCardTypeSheetDisappear(): void {
        this.showCardTypeSheet = false;
        this.sheetDismissing = false;
        const pendingBank: BankInfo | null = this.pendingBank;
        this.pendingBank = null;
        if (pendingBank === null) {
          this.selectedBank = null;
          return;
        }
        setTimeout(() => {
          this.selectedBank = pendingBank;
          this.showCardTypeSheet = true;
        }, 0);
      }

      /** 字母索引点击：同页定位到对应分块（AC-8） */
      private handleLetterTap(letter: string): void {
        if (this.showCardTypeSheet && !this.sheetDismissing) {
          return;
        }
        const index: number = this.indexLetters.indexOf(letter);
        if (index < 0) {
          return;
        }
        this.listScroller.scrollToIndex(index);
      }

      /** 返回上一页（AC-12） */
      private handleBack(): void {
        try {
          NavPathContext.stack().pop();
        } catch (err) {
          Logger.error(BankConstants.LOG_TAG, 'pop from AllBanksPage failed');
          this.showTip($r('app.string.bank_nav_failed'));
        }
      }

      @Builder
      private navBar() {
        Row() {
          Row() {
            SymbolGlyph($r('sys.symbol.chevron_left'))
              .fontSize(20)
              .fontColor([$r('app.color.color_text_primary')])
          }
          .width(36)
          .height(36)
          .justifyContent(FlexAlign.Center)
          .backgroundColor($r('app.color.color_nav_btn_bg'))
          .borderRadius(18)
          .id('ab_back_btn')
          .onClick(() => {
            this.handleBack();
          })

          Text($r('app.string.all_banks_title'))
            .fontSize($r('app.float.bank_font_page_title'))
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.color_text_primary'))
            .margin({ left: 12 })
            .id('ab_page_title')
        }
        .width('100%')
        .height(48)
        .alignItems(VerticalAlign.Center)
        .id('ab_nav_bar')
      }

      /** 右缘字母索引条：字母集合由分组结果派生，无对应银行的字母不展示（BD-7） */
      @Builder
      private letterIndex() {
        Column() {
          ForEach(this.indexLetters, (letter: string) => {
            Text(letter)
              .fontSize($r('app.float.bank_font_index_letter'))
              .fontColor($r('app.color.color_text_secondary'))
              .textAlign(TextAlign.Center)
              .width('100%')
              .padding({ top: 3, bottom: 3 })
              .id(`ab_index_letter_${letter}`)
              .onClick(() => {
                this.handleLetterTap(letter);
              })
          }, (letter: string) => letter)
        }
        .width($r('app.float.bank_space_ab_index_width'))
        .margin({ right: 4 })
        .id('ab_letter_index')
      }

      @Builder
      private groupBlock(group: BankGroup) {
        Column() {
          Text(group.letter)
            .fontSize($r('app.float.bank_font_caption'))
            .fontColor($r('app.color.color_text_secondary'))
            .width('100%')
            .height($r('app.float.bank_space_group_label_height'))
            .textAlign(TextAlign.Start)
            .id(`ab_group_label_${group.letter}`)

          Column() {
            ForEach(group.banks, (bank: BankInfo, index: number) => {
              BankListRow({
                bank: bank,
                idPrefix: 'ab',
                showDivider: index < group.banks.length - 1,
                onTap: (tapped: BankInfo): void => {
                  this.openCardTypeSheet(tapped);
                }
              })
            }, (bank: BankInfo) => bank.code)
          }
          .width('100%')
          .backgroundColor($r('app.color.color_card_bg'))
          .borderRadius($r('app.float.bank_radius_card'))
          .id(`ab_group_card_${group.letter}`)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }

      @Builder
      private cardTypeSheetBuilder() {
        if (this.selectedBank !== null) {
          CardTypeSheet({
            bank: this.selectedBank,
            onContinue: (bank: BankInfo, cardType: BankCardType): void => {
              this.continueToCardSelection(bank, cardType);
            },
            onClose: (): void => {
              this.closeCardTypeSheet();
            }
          })
        }
      }

      build() {
        NavDestination() {
          Stack({ alignContent: Alignment.End }) {
            Column() {
              this.navBar()

              if (this.groups.length === 0) {
                Text(this.loadFailed ? $r('app.string.bank_list_load_failed') : $r('app.string.bank_list_empty'))
                  .fontSize($r('app.float.bank_font_caption'))
                  .fontColor($r('app.color.color_text_secondary'))
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .margin({ top: 48 })
              } else {
                List({ scroller: this.listScroller }) {
                  ForEach(this.groups, (group: BankGroup) => {
                    ListItem() {
                      this.groupBlock(group)
                    }
                  }, (group: BankGroup) => group.letter)
                }
                .width('100%')
                .layoutWeight(1)
                .scrollBar(BarState.Off)
                .id('ab_group_list')
              }
            }
            .width('100%')
            .height('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({
              left: $r('app.float.bank_space_page_margin'),
              right: $r('app.float.bank_space_ab_content_right_margin')
            })

            this.letterIndex()
          }
          .width('100%')
          .height('100%')
          .backgroundColor($r('app.color.color_page_bg'))
          .id('ab_root')
          .bindSheet($$this.showCardTypeSheet, this.cardTypeSheetBuilder(), {
            height: SheetSize.FIT_CONTENT,
            showClose: false,
            dragBar: false,
            enableOutsideInteractive: false,
            backgroundColor: $r('app.color.color_page_bg'),
            onDisappear: () => {
              this.handleCardTypeSheetDisappear();
            }
          })
        }
        .hideTitleBar(true)
        .onBackPressed(() => {
          this.handleBack();
          return true;
        })
      }
    }


    @Builder

    export function buildAllBanksPage() {
      AllBanksPage();
    }
- path: 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets
  content: >
    import { NavPathContext } from '@aspect/CommFunc';

    import { OpeningResult } from '../../data/model/OpeningResult';

    import { OpeningNavigationService } from
    '../../domain/service/OpeningNavigationService';


    @Component

    struct BankCardOpeningResultPage {
      @Prop routeParam: Object;
      private readonly navigationService: OpeningNavigationService = new OpeningNavigationService();

      private result(): OpeningResult {
        return this.routeParam as OpeningResult;
      }

      private finishOpeningFlow(): void {
        this.navigationService.finish(NavPathContext.stack(), this.result());
      }

      build() {
        NavDestination() {
          Column() {
            Column() {
              SymbolGlyph(this.result().success
                ? $r('sys.symbol.checkmark_circle_fill')
                : $r('sys.symbol.xmark_circle_fill'))
                .fontSize(64)
                .fontColor([this.result().success
                  ? $r('app.color.brand_fuel_green')
                  : $r('app.color.brand_danger')])
                .id('result_status_icon')

              Text(this.result().success
                ? $r('app.string.opening_result_success_title')
                : $r('app.string.opening_result_failure_title'))
                .fontSize(22)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.color_text_primary'))
                .margin({ top: 14 })
                .id('result_title')

              Text(this.result().success
                ? $r('app.string.opening_result_success_description')
                : $r('app.string.opening_result_failure_description'))
                .fontSize(14)
                .fontColor($r('app.color.color_text_secondary'))
                .textAlign(TextAlign.Center)
                .margin({ top: 8 })
                .id('result_description')
            }
            .width('100%')
            .alignItems(HorizontalAlign.Center)
            .margin({ top: 96 })
            .id('result_state_group')

            Image($r('app.media.result_payment_guide_placeholder'))
              .width('58%')
              .height('33%')
              .objectFit(ImageFit.Contain)
              .margin({ top: 24 })
              .id('result_guide_illustration')

            Blank()

            Button($r('app.string.opening_finish'))
              .width('88%')
              .height(52)
              .fontSize(16)
              .fontColor($r('app.color.brand_primary'))
              .backgroundColor($r('app.color.button_tonal_bg'))
              .margin({ bottom: 28 })
              .id('result_finish_btn')
              .onClick(() => {
                this.finishOpeningFlow();
              })
          }
          .width('100%')
          .height('100%')
          .alignItems(HorizontalAlign.Center)
          .backgroundColor($r('app.color.color_page_bg'))
          .id('opening_result_root')
        }
        .hideTitleBar(true)
        .onBackPressed(() => {
          return true;
        })
      }
    }


    @Builder

    export function buildBankCardOpeningResultPage(param: Object) {
      BankCardOpeningResultPage({ routeParam: param });
    }
- path: 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
  content: >
    import { Context } from '@kit.AbilityKit';

    import { Logger, NavPathContext } from '@aspect/CommFunc';

    import { BankCardCandidate, BankCardSelectionParams, BankCardType } from
    '../../data/model/BankCardCandidate';

    import { BankInfo } from '../../data/model/BankInfo';

    import { OpeningResult } from '../../data/model/OpeningResult';

    import { BankCardRepository } from
    '../../data/repository/BankCardRepository';

    import { BankRepository } from '../../data/repository/BankRepository';

    import { BankCardOpeningService } from
    '../../domain/service/BankCardOpeningService';

    import { OtpService, OtpVerificationState } from
    '../../domain/service/OtpService';

    import { BankConstants } from '../../shared/constant/BankConstants';

    import { OtpVerificationSheet } from '../components/OtpVerificationSheet';


    @Component

    struct BankCardSelectionPage {
      @Prop routeParam: Object;
      @State candidates: BankCardCandidate[] = [];
      @State bank: BankInfo | null = null;
      @State selectedCandidate: BankCardCandidate | null = null;
      @State agreementAccepted: boolean = false;
      @State showOtpSheet: boolean = false;
      private readonly bankRepository: BankRepository = new BankRepository();
      private openingService: BankCardOpeningService = new BankCardOpeningService();

      aboutToAppear(): void {
        const params: BankCardSelectionParams = this.params();
        const context: Context = this.getUIContext().getHostContext() as Context;
        this.openingService = new BankCardOpeningService(
          new BankCardRepository(context),
          this.bankRepository,
          new OtpVerificationState(new OtpService(), BankConstants.OTP_COUNTDOWN_SECONDS)
        );
        this.openingService.begin(params.bankCode, params.cardType);
        void this.loadCandidates();
      }

      private params(): BankCardSelectionParams {
        return this.routeParam as BankCardSelectionParams;
      }

      private async loadCandidates(): Promise<void> {
        const params: BankCardSelectionParams = this.params();
        const banks: BankInfo[] = await this.bankRepository.getBanks();
        this.bank = banks.find((item: BankInfo) => item.code === params.bankCode) ?? null;
        this.candidates = await this.openingService.loadCandidates();
      }

      private selectCandidate(candidate: BankCardCandidate): void {
        this.openingService.selectCandidate(candidate);
        this.selectedCandidate = candidate;
      }

      private cardTypeText(): Resource {
        return this.params().cardType === BankCardType.DEBIT
          ? $r('app.string.bank_card_type_debit')
          : $r('app.string.bank_card_type_credit');
      }

      private openOtpVerificationSheet(): void {
        if (!this.openingService.canOpenOtp()) {
          return;
        }
        this.showOtpSheet = true;
      }

      private updateAgreementAccepted(accepted: boolean): void {
        this.openingService.setAgreementAccepted(accepted);
        this.agreementAccepted = accepted;
      }

      private canOpenOtp(): boolean {
        // ArkUI 只能追踪页面 @State；service 内部普通字段不能单独驱动 enabled 重算。
        return this.selectedCandidate !== null && this.agreementAccepted;
      }

      private handleOpeningResult(result: OpeningResult): void {
        this.showOtpSheet = false;
        try {
          NavPathContext.stack().pushPath({
            name: BankConstants.ROUTE_BANK_CARD_RESULT,
            param: result
          });
        } catch {
          Logger.error(BankConstants.LOG_TAG, 'push opening result page failed');
        }
      }

      private handleBack(): void {
        try {
          NavPathContext.stack().pop();
        } catch {
          Logger.error(BankConstants.LOG_TAG, 'pop from BankCardSelectionPage failed');
        }
      }

      @Builder
      private otpSheetBuilder() {
        if (this.selectedCandidate !== null) {
          OtpVerificationSheet({
            openingService: this.openingService,
            onFinished: (result: OpeningResult): void => {
              this.handleOpeningResult(result);
            },
            onClose: (): void => {
              this.showOtpSheet = false;
            }
          })
        }
      }

      @Builder
      private navBar() {
        Row() {
          Row() {
            SymbolGlyph($r('sys.symbol.chevron_left'))
              .fontSize(20)
              .fontColor([$r('app.color.color_text_primary')])
          }
          .width(36)
          .height(36)
          .justifyContent(FlexAlign.Center)
          .backgroundColor($r('app.color.color_nav_btn_bg'))
          .borderRadius(18)
          .id('selection_back_btn')
          .onClick(() => {
            this.handleBack();
          })

          Text(this.bank?.name ?? '')
            .fontSize($r('app.float.bank_font_page_title'))
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.color_text_primary'))
            .margin({ left: 12 })
            .id('selection_nav_title')
        }
        .width('100%')
        .height(48)
        .alignItems(VerticalAlign.Center)
        .id('selection_nav_bar')
      }

      build() {
        NavDestination() {
          Column() {
            this.navBar()

            Text($r('app.string.selection_hint'))
              .fontSize(14)
              .fontColor($r('app.color.color_text_secondary'))
              .width('100%')
              .margin({ top: 42, bottom: 14 })
              .id('selection_hint')

            Column() {
              ForEach(this.candidates, (candidate: BankCardCandidate, index: number) => {
                Row() {
                  if (this.bank !== null) {
                    Image(this.bank.logo)
                      .width(34)
                      .height(34)
                      .objectFit(ImageFit.Contain)
                      .margin({ right: 12 })
                  }
                  Text(this.openingService.maskCardNumber(candidate.cardNumber))
                    .fontSize(16)
                    .fontColor($r('app.color.color_text_primary'))
                    .layoutWeight(1)
                  SymbolGlyph(this.selectedCandidate?.cardNumber === candidate.cardNumber
                    ? $r('sys.symbol.checkmark_circle_fill')
                    : $r('sys.symbol.circle'))
                    .fontSize(22)
                    .fontColor([this.selectedCandidate?.cardNumber === candidate.cardNumber
                      ? $r('app.color.brand_danger')
                      : $r('app.color.color_text_secondary')])
                }
                .width('100%')
                .height(58)
                .padding({ left: 16, right: 16 })
                .id(`bank_card_candidate_${index + 1}`)
                .onClick(() => {
                  this.selectCandidate(candidate);
                })
              }, (candidate: BankCardCandidate) => candidate.cardNumber)
            }
            .width('100%')
            .backgroundColor($r('app.color.color_card_bg'))
            .borderRadius($r('app.float.bank_radius_card'))
            .id('selection_card_container')

            Row() {
              Toggle({ type: ToggleType.Checkbox, isOn: this.agreementAccepted })
                .selectedColor($r('app.color.brand_danger'))
                .id('selection_agreement_check')
                .onChange((isOn: boolean) => {
                  this.updateAgreementAccepted(isOn);
                })

              Text($r('app.string.selection_agreement', this.bank?.name ?? '', this.cardTypeText()))
                .fontSize(13)
                .fontColor($r('app.color.color_text_secondary'))
                .layoutWeight(1)
                .margin({ left: 8 })
                .id('selection_agreement')
            }
            .width('100%')
            .alignItems(VerticalAlign.Top)
            .margin({ top: 12 })

            Button($r('app.string.opening_next'))
              .enabled(this.canOpenOtp())
              .width('30%')
              .height(46)
              .fontSize(16)
              .fontColor(Color.White)
              .backgroundColor(this.canOpenOtp()
                ? $r('app.color.brand_danger')
                : $r('app.color.button_tonal_bg'))
              .margin({ top: 22 })
              .id('selection_next_btn')
              .onClick(() => {
                this.openOtpVerificationSheet();
              })
          }
          .width('100%')
          .height('100%')
          .padding({ left: 18, right: 18 })
          .alignItems(HorizontalAlign.Center)
          .backgroundColor($r('app.color.color_page_bg'))
          .id('bank_card_selection_root')
          .bindSheet($$this.showOtpSheet, this.otpSheetBuilder(), {
            height: SheetSize.FIT_CONTENT,
            showClose: false,
            dragBar: false,
            backgroundColor: $r('app.color.color_page_bg'),
            onDisappear: () => {
              this.showOtpSheet = false;
            }
          })
        }
        .hideTitleBar(true)
        .onBackPressed(() => {
          this.handleBack();
          return true;
        })
      }
    }


    @Builder

    export function buildBankCardSelectionPage(param: Object) {
      BankCardSelectionPage({ routeParam: param });
    }
- path: 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets
  content: >
    import { Context } from '@kit.AbilityKit';

    import { showToast } from '@aspect/CommUI';

    import { BankOpeningCompletionContext } from
    '../../data/model/BankOpeningCompletionContext';

    import { HomeCardDisplayMode } from '../../data/model/HomeCardState';

    import { MessageInfo } from '../../data/model/MessageInfo';

    import { HomeRepository } from '../../data/repository/HomeRepository';

    import { PromoInfo } from '../../data/model/PromoInfo';

    import { ServiceEntry } from '../../data/model/ServiceEntry';

    import { CardGuideSection } from '../components/CardGuideSection';

    import { CardStackSection } from '../components/CardStackSection';

    import { HomeTabHeader } from '../components/HomeTabHeader';

    import { MessageCenterRow } from '../components/MessageCenterRow';

    import { PromoSwiper } from '../components/PromoSwiper';

    import { ServiceGridSwiper } from '../components/ServiceGridSwiper';


    @Component

    export struct HomeTabPage {
      /** NavPathStack 禁止 @Prop（真机 pushPath 会丢原生句柄 SIGSEGV），须与 Navigation 同源 @Link */
      @Link navPathStack: NavPathStack;
      @State services: ServiceEntry[] = [];
      @State promos: PromoInfo[] = [];
      @State cardMode: HomeCardDisplayMode = HomeCardDisplayMode.NO_CARD;
      @State lastOpenedCardNumber: string | undefined = undefined;
      @State message: MessageInfo = {
        text: $r('app.string.msg_center_welcome'),
        showUnreadDot: false
      };
      private readonly homeRepo: HomeRepository = new HomeRepository();

      aboutToAppear(): void {
        this.consumeOpeningCompletion();
        void this.loadHomeData();
      }

      private consumeOpeningCompletion(): void {
        const cardNumber: string | undefined = BankOpeningCompletionContext.consume();
        if (cardNumber === undefined) {
          return;
        }
        this.lastOpenedCardNumber = cardNumber;
        HomeRepository.setLaunchCardModeOverride(HomeCardDisplayMode.WITH_CARD);
      }

      private handleTitleTap(): void {
        const nextMode = this.cardMode === HomeCardDisplayMode.WITH_CARD
          ? HomeCardDisplayMode.NO_CARD
          : HomeCardDisplayMode.WITH_CARD;
        HomeRepository.setLaunchCardModeOverride(nextMode);
        this.cardMode = nextMode;
        void this.loadHomeData();
      }

      private async loadHomeData(): Promise<void> {
        try {
          this.cardMode = await this.homeRepo.getCardDisplayMode();
          const hasCard: boolean = this.cardMode === HomeCardDisplayMode.WITH_CARD;
          this.promos = [];
          this.services = [];
          this.services = await this.homeRepo.getServiceEntries(hasCard);
          this.promos = await this.homeRepo.getPromoList(hasCard);
          this.message = await this.homeRepo.getMessageInfo(this.cardMode);
        } catch {
          this.services = [];
          this.promos = [];
          const ctx = this.getUIContext().getHostContext() as Context;
          showToast(ctx.resourceManager.getStringSync($r('app.string.home_data_unavailable').id));
        }
      }

      build() {
        Column() {
          HomeTabHeader({
            onAddCard: () => {
              this.navPathStack.pushPath({ name: 'AddCardEntryPage' });
            },
            onTitleTap: (): void => {
              this.handleTitleTap();
            }
          })

          Scroll() {
            Column({ space: 16 }) {
              if (this.cardMode === HomeCardDisplayMode.NO_CARD) {
                CardGuideSection({
                  onGoCardPack: () => {
                    this.navPathStack.pushPath({ name: 'CardPackPage' });
                  }
                })
              } else {
                CardStackSection({
                  onGoCardPack: () => {
                    this.navPathStack.pushPath({ name: 'CardPackPage' });
                  }
                })
              }

              if (this.services.length > 0) {
                ServiceGridSwiper({ services: this.services })
              }

              MessageCenterRow({ message: this.message })

              if (this.promos.length > 0) {
                PromoSwiper({
                  promos: this.promos,
                  imageFirst: this.cardMode === HomeCardDisplayMode.NO_CARD
                })
                  .key(this.cardMode === HomeCardDisplayMode.WITH_CARD ? 'promo_with_card' : 'promo_no_card')
              }
            }
            .width('100%')
            .padding({
              left: 16,
              right: 16,
              bottom: 24
            })
          }
          .layoutWeight(1)
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg_page'))
        .id('home_root')
      }
    }
- path: 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets
  content: >
    /**
     * 银行卡开卡（添加银行卡 / 全部银行）常量。
     * 只承载资源键无法承载的东西：路由名、数值上限、时间窗口，以及可见行数算术要用的几何数值
     * （$r('app.float.*') 不能直接参与同步算术，故与 float.json 同值镜像）。
     */
    export class BankConstants {
      /** 添加银行卡页面路由名（与 Phone 根页 navDestinationMap / route_map.json 一致） */
      static readonly ROUTE_ADD_BANK_CARD: string = 'AddBankCardPage';

      /** 全部银行页面路由名 */
      static readonly ROUTE_ALL_BANKS: string = 'AllBanksPage';

      /** 银行内部具体卡片选择页 */
      static readonly ROUTE_BANK_CARD_SELECTION: string = 'BankCardSelectionPage';

      /** 银行卡开卡结果页 */
      static readonly ROUTE_BANK_CARD_RESULT: string = 'BankCardOpeningResultPage';

      /** 验证码倒计时秒数 */
      static readonly OTP_COUNTDOWN_SECONDS: number = 60;

      /** 验证码允许长度 */
      static readonly OTP_LENGTH: number = 6;

      /** 收起态药丸内最多展示的剩余银行小图标数 */
      static readonly MAX_PILL_ICONS: number = 5;

      /** 跳转防重入窗口（ms，BD-3 / ENV-02） */
      static readonly NAV_DEBOUNCE_MS: number = 500;

      /** 提示节流窗口（ms，BD-3） */
      static readonly TOAST_THROTTLE_MS: number = 500;

      /** 银行行高（vp），与 float.json 的 bank_space_row_height 同值 */
      static readonly ROW_HEIGHT_VP: number = 56;

      /**
       * 药丸整块占位高（vp）= 上留白 24 + 药丸 32 + 下留白 12，与 float.json 的
       * bank_space_pill_block_height 同值；参考图 1-a 实测 206px ÷ 3.0 px/vp ≈ 68vp
       */
      static readonly PILL_BLOCK_HEIGHT_VP: number = 68;

      /**
       * 收起态白卡下沿到容器下沿的预留（vp）。参考图 1-a 实测 194px ÷ 3.0 px/vp ≈ 65vp：
       * 白卡不占满剩余屏高，这段留白必须参与可见行数的减法，否则会多渲染一行（AC-2 要求 7 行）
       */
      static readonly CARD_BOTTOM_RESERVE_VP: number = 65;

      /** 日志 tag */
      static readonly LOG_TAG: string = 'BankOpenCard';
    }
- path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
  content: |
    {
      "color": [
        {
          "name": "brand_primary",
          "value": "#007DFF"
        },
        {
          "name": "text_primary",
          "value": "#000000"
        },
        {
          "name": "text_secondary",
          "value": "#888888"
        },
        {
          "name": "text_tertiary",
          "value": "#C7C7CC"
        },
        {
          "name": "bg_page",
          "value": "#F2F2F2"
        },
        {
          "name": "bg_surface",
          "value": "#FFFFFF"
        },
        {
          "name": "wallet_primary",
          "value": "#007DFF"
        },
        {
          "name": "wallet_text_primary",
          "value": "#000000"
        },
        {
          "name": "wallet_text_secondary",
          "value": "#888888"
        },
        {
          "name": "wallet_text_tertiary",
          "value": "#C7C7CC"
        },
        {
          "name": "wallet_page_bg",
          "value": "#F2F2F2"
        },
        {
          "name": "wallet_surface_bg",
          "value": "#FFFFFF"
        },
        {
          "name": "brand_bank_orange",
          "value": "#FF9500"
        },
        {
          "name": "brand_bank_pink",
          "value": "#FF6B81"
        },
        {
          "name": "brand_fuel_green",
          "value": "#34C759"
        },
        {
          "name": "brand_id_yellow",
          "value": "#FFCC00"
        },
        {
          "name": "brand_danger",
          "value": "#FF3B30"
        },
        {
          "name": "wallet_badge_gray",
          "value": "#8E8E93"
        },
        {
          "name": "promo_placeholder",
          "value": "#F2F2F2"
        },
        {
          "name": "button_tonal_bg",
          "value": "#E8F3FF"
        },
        {
          "name": "home_banner_end",
          "value": "#FFFFFF"
        },
        {
          "name": "card_stack_cmb",
          "value": "#E8A317"
        },
        {
          "name": "card_stack_transit",
          "value": "#1E6FD9"
        },
        {
          "name": "card_stack_fund",
          "value": "#2E8B57"
        },
        {
          "name": "card_stack_access",
          "value": "#F5F5F5"
        },
        {
          "name": "color_page_bg",
          "value": "#F2F3F5"
        },
        {
          "name": "color_card_bg",
          "value": "#FFFFFF"
        },
        {
          "name": "color_text_primary",
          "value": "#1A1A1A"
        },
        {
          "name": "color_text_secondary",
          "value": "#606163"
        },
        {
          "name": "color_line_divider",
          "value": "#CCCCCC"
        },
        {
          "name": "color_icon_chevron",
          "value": "#CCCCCC"
        },
        {
          "name": "color_nav_btn_bg",
          "value": "#E7E8EA"
        },
        {
          "name": "color_pill_bg",
          "value": "#F2F3F5"
        },
        {
          "name": "color_link_blue",
          "value": "#1F57C8"
        },
        {
          "name": "color_badge_border",
          "value": "#D87639"
        },
        {
          "name": "color_badge_bg",
          "value": "#FFFBEF"
        },
        {
          "name": "opening_overlay_dim",
          "value": "#66000000"
        }
      ]
    }
- path: 02-Feature/WalletMain/src/main/resources/base/element/float.json
  content: |
    {
      "float": [
        {
          "name": "home_title_size",
          "value": "20fp"
        },
        {
          "name": "guide_banner_height",
          "value": "160vp"
        },
        {
          "name": "bank_font_page_title",
          "value": "20fp"
        },
        {
          "name": "bank_font_row_title",
          "value": "16fp"
        },
        {
          "name": "bank_font_caption",
          "value": "14fp"
        },
        {
          "name": "bank_font_badge",
          "value": "10fp"
        },
        {
          "name": "bank_font_index_letter",
          "value": "10fp"
        },
        {
          "name": "bank_space_page_margin",
          "value": "16vp"
        },
        {
          "name": "bank_space_row_height",
          "value": "56vp"
        },
        {
          "name": "bank_space_logo_size",
          "value": "34vp"
        },
        {
          "name": "bank_space_divider_inset",
          "value": "52vp"
        },
        {
          "name": "bank_space_row_inner_padding",
          "value": "16vp"
        },
        {
          "name": "bank_space_ab_content_right_margin",
          "value": "40vp"
        },
        {
          "name": "bank_space_ab_index_width",
          "value": "16vp"
        },
        {
          "name": "bank_space_group_label_height",
          "value": "56vp"
        },
        {
          "name": "bank_radius_card",
          "value": "16vp"
        },
        {
          "name": "bank_radius_pill",
          "value": "24vp"
        },
        {
          "name": "bank_space_pill_height",
          "value": "32vp"
        },
        {
          "name": "bank_space_pill_block_height",
          "value": "68vp"
        }
      ]
    }
- path: 02-Feature/WalletMain/src/main/resources/base/element/string.json
  content: |
    {
      "string": [
        {
          "name": "module_desc",
          "value": "WalletMain"
        },
        {
          "name": "tab_home",
          "value": "首页"
        },
        {
          "name": "tab_mine",
          "value": "我的"
        },
        {
          "name": "home_title",
          "value": "钱包"
        },
        {
          "name": "mine_title",
          "value": "我的"
        },
        {
          "name": "card_pack_title",
          "value": "卡包"
        },
        {
          "name": "card_pack_section_title",
          "value": "卡包"
        },
        {
          "name": "add_card_title",
          "value": "添加卡片"
        },
        {
          "name": "card_guide_subtitle",
          "value": "集中管理您的卡证票券钥匙"
        },
        {
          "name": "add_manage_cards",
          "value": "添加管理卡片"
        },
        {
          "name": "more_services",
          "value": "更多服务"
        },
        {
          "name": "not_supported",
          "value": "暂不支持"
        },
        {
          "name": "not_logged_in",
          "value": "未登录"
        },
        {
          "name": "add_card_desc",
          "value": "银行卡/交通卡/门禁卡等"
        },
        {
          "name": "manage_non_local",
          "value": "管理非本机卡片"
        },
        {
          "name": "non_local_cards",
          "value": "非本机卡片"
        },
        {
          "name": "manage_sheet_empty_text",
          "value": "暂无非本机卡片"
        },
        {
          "name": "msg_center_welcome",
          "value": "欢迎使用钱包消息中心!"
        },
        {
          "name": "msg_center_charge_success",
          "value": "畅行无忧卡·金陵通刷卡扣费成功"
        },
        {
          "name": "msg_center_timestamp",
          "value": "2 小时前"
        },
        {
          "name": "card_stack_mock_bank_cmb",
          "value": "招商银行"
        },
        {
          "name": "card_stack_mock_label_cmb",
          "value": "信用卡"
        },
        {
          "name": "card_stack_mock_bank_fund",
          "value": "北京住房公积金"
        },
        {
          "name": "card_stack_mock_label_fund",
          "value": "管理中心"
        },
        {
          "name": "card_stack_mock_bank_transit",
          "value": "江苏交通一卡通"
        },
        {
          "name": "card_stack_mock_label_transit",
          "value": "畅行无忧卡"
        },
        {
          "name": "card_stack_mock_bank_access",
          "value": "华为智能门禁"
        },
        {
          "name": "card_stack_mock_label_access",
          "value": "门禁卡"
        },
        {
          "name": "home_title_add_action",
          "value": "+"
        },
        {
          "name": "home_promo_no_detail",
          "value": "暂无详情"
        },
        {
          "name": "home_data_unavailable",
          "value": "数据暂不可用，请稍后再试"
        },
        {
          "name": "home_mock_service_s1_name",
          "value": "Huawei Card"
        },
        {
          "name": "home_mock_service_s2_name",
          "value": "信用卡还款"
        },
        {
          "name": "home_mock_service_s3_name",
          "value": "优惠加油"
        },
        {
          "name": "home_mock_promo_p1_title",
          "value": "数字金融生活新方式"
        },
        {
          "name": "home_mock_promo_p1_desc",
          "value": "这些金融元服务，承包你的全场景金融需求"
        },
        {
          "name": "home_mock_promo_p2_title",
          "value": "春日出行"
        },
        {
          "name": "home_mock_promo_p2_desc",
          "value": "交通卡充值满减"
        },
        {
          "name": "home_mock_promo_p3_title",
          "value": "安全用卡"
        },
        {
          "name": "home_mock_promo_p3_desc",
          "value": "守护您的资金安全"
        },
        {
          "name": "home_mock_promo_wc_p1_title",
          "value": "会员卡（酒店、航司）、校园卡上线"
        },
        {
          "name": "home_mock_promo_wc_p1_desc",
          "value": "钱包全管理，出行更从容"
        },
        {
          "name": "home_mock_promo_wc_p2_title",
          "value": "数字金融生活新方式"
        },
        {
          "name": "home_mock_promo_wc_p2_desc",
          "value": "这些金融元服务，承包你的全场景金融需求"
        },
        {
          "name": "home_mock_promo_wc_p3_title",
          "value": "安全用卡"
        },
        {
          "name": "home_mock_promo_wc_p3_desc",
          "value": "守护您的资金安全"
        },
        {
          "name": "finance_section_title",
          "value": "金融信息"
        },
        {
          "name": "settings_section_title",
          "value": "设置与帮助"
        },
        {
          "name": "local_cards_section",
          "value": "本设备卡片"
        },
        {
          "name": "local_cards_empty",
          "value": "暂无本机卡片"
        },
        {
          "name": "wallet_login_hint",
          "value": "点击登录华为账号"
        },
        {
          "name": "login_confirm_title",
          "value": "登录"
        },
        {
          "name": "login_confirm_message",
          "value": "确认登录华为账号？"
        },
        {
          "name": "logout_confirm_title",
          "value": "登出"
        },
        {
          "name": "logout_confirm_message",
          "value": "确认退出当前账号？"
        },
        {
          "name": "dialog_confirm",
          "value": "确认"
        },
        {
          "name": "dialog_cancel",
          "value": "取消"
        },
        {
          "name": "bottom_tab",
          "value": "bottom tab"
        },
        {
          "name": "bottom_tab_wc",
          "value": "bottom tab wc"
        },
        {
          "name": "bottom_tab_mine",
          "value": "bottom tab mine"
        },
        {
          "name": "add_card_type_bank_subtitle",
          "value": "双击电源键便捷支付"
        },
        {
          "name": "add_card_type_transit_subtitle",
          "value": "一张卡可刷全国"
        },
        {
          "name": "add_card_type_access_subtitle",
          "value": "手机就是门禁卡"
        },
        {
          "name": "add_card_type_car_key_subtitle",
          "value": "手机秒变车钥匙"
        },
        {
          "name": "add_card_type_id_subtitle",
          "value": "随时随地查看证件"
        },
        {
          "name": "card_cat_bank",
          "value": "银行卡"
        },
        {
          "name": "card_cat_transit",
          "value": "交通卡"
        },
        {
          "name": "card_cat_access",
          "value": "门禁卡"
        },
        {
          "name": "card_cat_car_key",
          "value": "车钥匙"
        },
        {
          "name": "card_cat_id",
          "value": "证件"
        },
        {
          "name": "mine_finance_huawei_pay",
          "value": "华为支付"
        },
        {
          "name": "mine_finance_bank_account",
          "value": "银行电子账户"
        },
        {
          "name": "mine_finance_transaction",
          "value": "银行卡交易记录"
        },
        {
          "name": "mine_finance_transit_refund",
          "value": "交通卡退款记录"
        },
        {
          "name": "mine_setting_settings",
          "value": "设置"
        },
        {
          "name": "mine_setting_help",
          "value": "帮助和反馈"
        },
        {
          "name": "add_bank_card_title",
          "value": "添加银行卡"
        },
        {
          "name": "add_bank_card_no_input",
          "value": "免输卡号添卡"
        },
        {
          "name": "add_bank_card_support_count",
          "value": "支持 100 家银行"
        },
        {
          "name": "add_bank_card_search_placeholder",
          "value": "搜索银行"
        },
        {
          "name": "add_bank_card_search_action",
          "value": "搜索"
        },
        {
          "name": "bank_more",
          "value": "更多"
        },
        {
          "name": "bank_view_all_banks",
          "value": "查看全部银行"
        },
        {
          "name": "all_banks_title",
          "value": "全部银行"
        },
        {
          "name": "bank_badge_first_bind",
          "value": "首绑送12元券包"
        },
        {
          "name": "bank_list_empty",
          "value": "暂无可添加的银行"
        },
        {
          "name": "bank_list_load_failed",
          "value": "银行列表加载失败，请稍后重试"
        },
        {
          "name": "bank_nav_failed",
          "value": "页面跳转失败，请重试"
        },
        {
          "name": "card_type_sheet_title",
          "value": "选择卡类型"
        },
        {
          "name": "bank_card_type_debit",
          "value": "储蓄卡"
        },
        {
          "name": "bank_card_type_credit",
          "value": "信用卡"
        },
        {
          "name": "card_type_authorization",
          "value": "为了您的银行卡开通华为支付和银联手机闪付服务，需要您授权银联提供实名信息给%s。"
        },
        {
          "name": "card_type_agreement",
          "value": "我已阅读快捷支付服务协议、银联无卡自助消费授权协议"
        },
        {
          "name": "card_type_continue",
          "value": "同意并继续"
        },
        {
          "name": "selection_hint",
          "value": "请选择您要绑定的银行卡"
        },
        {
          "name": "selection_agreement",
          "value": "同意并阅读《云闪付App一键绑卡用户授权协议》、《%s%s快捷支付服务协议》，授权云闪付获得您在本行银行卡号等信息。"
        },
        {
          "name": "opening_next",
          "value": "下一步"
        },
        {
          "name": "otp_sheet_title",
          "value": "输入验证码"
        },
        {
          "name": "otp_instruction",
          "value": "为确认是您本人操作，请输入发送至手机"
        },
        {
          "name": "otp_phone_hint",
          "value": "%s 的验证码。"
        },
        {
          "name": "otp_input_placeholder",
          "value": "输入短信验证码"
        },
        {
          "name": "otp_countdown",
          "value": "%d 秒后重试"
        },
        {
          "name": "otp_resend",
          "value": "重新发送"
        },
        {
          "name": "opening_result_success_title",
          "value": "添卡成功"
        },
        {
          "name": "opening_result_success_description",
          "value": "可用于实体店二维码支付和网上商城支付"
        },
        {
          "name": "opening_result_failure_title",
          "value": "添卡失败"
        },
        {
          "name": "opening_result_failure_description",
          "value": "银行卡添加失败，请稍后重试"
        },
        {
          "name": "opening_finish",
          "value": "完成"
        }
      ]
    }
- path: 02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png
  sha256: e8155a66f7476b56e571d74b4774aa0e5c6a5ed57f24458227008e3d3fb65228
  binary: true
- path: 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
  content: >
    {
      "routerMap": [
        {
          "name": "CardPackPage",
          "pageSourceFile": "src/main/ets/presentation/pages/CardPackPage.ets",
          "buildFunction": "buildCardPackPage",
          "data": {
            "description": ""
          }
        },
        {
          "name": "AddCardEntryPage",
          "pageSourceFile": "src/main/ets/presentation/pages/AddCardEntryPage.ets",
          "buildFunction": "buildAddCardEntryPage",
          "data": {
            "description": ""
          }
        },
        {
          "name": "AddBankCardPage",
          "pageSourceFile": "src/main/ets/presentation/pages/AddBankCardPage.ets",
          "buildFunction": "buildAddBankCardPage",
          "data": {
            "description": ""
          }
        },
        {
          "name": "AllBanksPage",
          "pageSourceFile": "src/main/ets/presentation/pages/AllBanksPage.ets",
          "buildFunction": "buildAllBanksPage",
          "data": {
            "description": ""
          }
        },
        {
          "name": "BankCardSelectionPage",
          "pageSourceFile": "src/main/ets/presentation/pages/BankCardSelectionPage.ets",
          "buildFunction": "buildBankCardSelectionPage",
          "data": {
            "description": ""
          }
        },
        {
          "name": "BankCardOpeningResultPage",
          "pageSourceFile": "src/main/ets/presentation/pages/BankCardOpeningResultPage.ets",
          "buildFunction": "buildBankCardOpeningResultPage",
          "data": {
            "description": ""
          }
        }
      ]
    }
- path: 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets
  content: |
    export interface UserProfileParams {
      isLoggedIn?: boolean;
      displayAccount?: string;
      mobile?: string;
      avatar?: Resource | null;
    }

    export class UserProfile {
      isLoggedIn: boolean = false;
      displayAccount: string = '';
      mobile: string = '';
      avatar: Resource | null = null;

      constructor(params?: UserProfileParams) {
        if (params) {
          if (params.isLoggedIn !== undefined) {
            this.isLoggedIn = params.isLoggedIn;
          }
          if (params.displayAccount !== undefined) {
            this.displayAccount = params.displayAccount;
          }
          if (params.mobile !== undefined) {
            this.mobile = params.mobile;
          }
          if (params.avatar !== undefined) {
            this.avatar = params.avatar;
          }
        }
      }

      get accountText(): string {
        return this.isLoggedIn ? this.displayAccount : '未登录';
      }
    }
- path: 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets
  content: >
    import { AccountConstants } from '../../shared/constant/AccountConstants';

    import { LoginState } from '../../data/model/LoginState';

    import { UserProfile } from '../../data/model/UserProfile';


    type LoginStateCallback = (state: LoginState) => void;


    export class AccountService {
      private static instance: AccountService | null = null;
      private static readonly MOCK_MOBILE: string = '18512343841';
      private readonly listeners: LoginStateCallback[] = [];

      static getInstance(): AccountService {
        if (AccountService.instance === null) {
          AccountService.instance = new AccountService();
          AccountService.instance.initStorage();
        }
        return AccountService.instance;
      }

      private initStorage(): void {
        if (!AppStorage.Has(AccountConstants.STORAGE_IS_LOGGED_IN)) {
          AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, false);
        }
        if (!AppStorage.Has(AccountConstants.STORAGE_DISPLAY_ACCOUNT)) {
          AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, '');
        }
        if (!AppStorage.Has(AccountConstants.STORAGE_LOGIN_STATE)) {
          AppStorage.setOrCreate(AccountConstants.STORAGE_LOGIN_STATE, LoginState.NOT_LOGGED_IN);
        }
      }

      private notify(state: LoginState): void {
        AppStorage.setOrCreate(AccountConstants.STORAGE_LOGIN_STATE, state);
        this.listeners.forEach((cb: LoginStateCallback) => {
          cb(state);
        });
      }

      async getUserProfile(): Promise<UserProfile> {
        const logged: boolean = AppStorage.get<boolean>(AccountConstants.STORAGE_IS_LOGGED_IN) ?? false;
        const display: string = AppStorage.get<string>(AccountConstants.STORAGE_DISPLAY_ACCOUNT) ?? '';
        return new UserProfile({
          isLoggedIn: logged,
          displayAccount: display,
          mobile: AccountService.MOCK_MOBILE,
          avatar: null
        });
      }

      async login(): Promise<UserProfile> {
        this.notify(LoginState.LOGGING_IN);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 400);
        });
        // 模拟阶段：写死登录成功（后续可替换为华为账号 Kit）
        const masked: string = '*****6790@**.com';
        AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, true);
        AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, masked);
        this.notify(LoginState.LOGGED_IN);
        return new UserProfile({
          isLoggedIn: true,
          displayAccount: masked,
          mobile: AccountService.MOCK_MOBILE,
          avatar: null
        });
      }

      async logout(): Promise<void> {
        AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, false);
        AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, '');
        this.notify(LoginState.NOT_LOGGED_IN);
      }

      onLoginStateChanged(callback: LoginStateCallback): void {
        if (this.listeners.indexOf(callback) < 0) {
          this.listeners.push(callback);
        }
      }

      offLoginStateChanged(callback: LoginStateCallback): void {
        const idx: number = this.listeners.indexOf(callback);
        if (idx >= 0) {
          this.listeners.splice(idx, 1);
        }
      }

      /** 真机 visual-diff 冷启动：Want.parameters.mineLoggedIn=true 预置已登录展示态 */
      static applyLaunchPreset(raw: string | undefined): void {
        if (raw === 'logged_in' || raw === 'true') {
          AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, true);
          AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, '*****6790@**.com');
          AppStorage.setOrCreate(AccountConstants.STORAGE_LOGIN_STATE, LoginState.LOGGED_IN);
        }
      }
    }
- path: 04-BusinessBase/AccountManager/src/main/ets/index.ets
  content: |
    export { AccountConstants } from './shared/constant/AccountConstants';

    export { LoginState } from './data/model/LoginState';

    export { UserProfile } from './data/model/UserProfile';

    export { AccountService } from './domain/service/AccountService';

```

### (resolved input contracts)

```
schema_version: "1.0"
feature: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
source: doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md
version: "1.0"
modules:
  - name: WalletMain
    layer: 02-Feature
    format: HAR
    change_type: modify
    package_path: 02-Feature/WalletMain
    export_file: 02-Feature/WalletMain/src/main/ets/index.ets
  - name: AccountManager
    layer: 04-BusinessBase
    format: HAR
    change_type: modify
    package_path: 04-BusinessBase/AccountManager
    export_file: 04-BusinessBase/AccountManager/src/main/ets/index.ets
  - name: Phone
    layer: 01-Product
    format: HAP
    change_type: modify
    package_path: 01-Product/Phone
module_dependencies:
  WalletMain:
    - AccountManager
    - CommUI
    - CommFunc
  AccountManager:
    - CommFunc
  Phone:
    - WalletMain
    - AccountManager
    - CommUI
    - CommFunc
data_models:
  - name: BankCardType
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets
    kind: enum
    values:
      - name: DEBIT
        value: DEBIT
      - name: CREDIT
        value: CREDIT
  - name: BankInfo
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets
    kind: interface
    fields:
      - name: code
        type: string
        required: true
      - name: name
        type: string
        required: true
      - name: pinyin
        type: string
        required: true
      - name: initial
        type: string
        required: true
      - name: logo
        type: Resource
        required: true
      - name: badgeRes
        type: Resource
        required: false
      - name: supportedCardTypes
        type: BankCardType[]
        required: true
  - name: BankCardCandidate
    file: 02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets
    kind: interface
    fields:
      - name: bankCode
        type: string
        required: true
        description: 银行短码
      - name: bankName
        type: string
        required: true
        description: 银行显示名
      - name: cardNumber
        type: string
        required: true
        description: 完整 mock 卡号，仅后台链路使用
      - name: cardType
        type: BankCardType
        required: true
        description: DEBIT 或 CREDIT
  - name: StoredCard
    file: 02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets
    kind: class
    fields:
      - name: cardNumber
        type: string
        required: true
        description: 完整卡号且为唯一业务键
      - name: category
        type: string
        required: true
        description: 总卡类别，本轮为 BANK_CARD
      - name: bankName
        type: string
        required: true
        description: 银行名称
      - name: bankCardType
        type: string
        required: true
        description: 储蓄卡或信用卡
      - name: addedAt
        type: number
        required: true
        description: 添加时间毫秒时间戳
      - name: huaweiPayEnabled
        type: boolean
        required: true
        description: 华为支付开通状态
      - name: unionPayQuickPassEnabled
        type: boolean
        required: true
        description: 银联手机闪付状态
      - name: transactionRecords
        type: string
        required: true
        description: 交易记录 JSON，本轮默认空数组
  - name: OpeningResult
    file: 02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets
    kind: class
    fields:
      - name: fullCardNumber
        type: string
        required: true
        description: 完整卡号，仅后台交接
      - name: success
        type: boolean
        required: true
        description: 保存结果
      - name: errorMessage
        type: string
        required: false
        description: 失败时的受控错误说明
  - name: UserProfile
    file: 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets
    kind: class
    fields:
      - name: isLoggedIn
        type: boolean
        required: true
      - name: displayAccount
        type: string
        required: true
      - name: mobile
        type: string
        required: true
        description: 账号 mock 手机号，验证码页只显示掩码
      - name: avatar
        type: Resource | null
        required: false
interfaces:
  - layer: data
    file: 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
    class: BankCardRepository
    methods:
      - name: save
        params:
          - name: card
            type: StoredCard
        return: Promise<StoredCard>
        async: true
        description: 以完整卡号为唯一键原子保存；重复卡号回查既有记录并视为成功。
      - name: list
        params: []
        return: Promise<StoredCard[]>
        async: true
        description: 读取已保存银行卡。
  - layer: domain
    file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
    class: BankCardOpeningService
    methods:
      - name: maskCardNumber
        params:
          - name: cardNumber
            type: string
        return: string
        async: false
        description: 只输出前四与后四。
      - name: isValidOtp
        params:
          - name: otp
            type: string
        return: boolean
        async: false
        description: 精确校验六位数字。
      - name: toStoredCard
        params:
          - name: candidate
            type: BankCardCandidate
        return: StoredCard
        async: false
        description: 生成默认支付状态和空交易记录。
      - name: toOpeningResult
        params:
          - name: candidate
            type: BankCardCandidate
          - name: success
            type: boolean
          - name: errorMessage
            type: string
        return: OpeningResult
        async: false
        description: 成功或失败均保留完整卡号用于后台交接。
  - layer: data
    file: 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
    class: BankRepository
    methods:
      - name: getBanks
        params: []
        return: Promise<BankInfo[]>
        async: true
        description: 返回本地 mock 银行及支持卡型。
      - name: getCards
        params:
          - name: bankCode
            type: string
          - name: cardType
            type: BankCardType
        return: Promise<BankCardCandidate[]>
        async: true
        description: 按银行与卡型返回一至两张完整 mock 候选卡。
  - layer: domain
    file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
    class: OtpService
    methods:
      - name: sendMockCode
        params:
          - name: mobile
            type: string
        return: Promise<void>
        async: true
        description: 本地假发送。
  - layer: domain
    file: 02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets
    class: OpeningNavigationService
    methods:
      - name: finish
        params:
          - name: stack
            type: NavPathStack
          - name: result
            type: OpeningResult
        return: void
        async: false
        description: 成功发布完整卡号后 clear 回首页；失败 popToName 到 AddBankCardPage。
  - layer: domain
    file: 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets
    class: AccountService
    methods:
      - name: getUserProfile
        params: []
        return: Promise<UserProfile>
        async: true
        description: 返回含 mobile 的账号 mock。
  - layer: data
    file: 02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets
    class: BankOpeningCompletionContext
    methods:
      - name: publish
        params:
          - name: fullCardNumber
            type: string
        return: void
        async: false
        description: 暂存一次性成功卡号。
      - name: consume
        params: []
        return: string|undefined
        async: false
        description: 取出并立即清空。
      - name: clear
        params: []
        return: void
        async: false
        description: 清空未消费值。
components:
  - name: AddBankCardPage
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets
    kind: page
    asset_selection: &a1
      resolution: custom
      rationale: 卡型、卡片、验证码和结果页均携带银行卡流程状态，不能由无业务状态的通用列表项直接配置得到。
    state:
      - name: selectedBank
        decorator: "@State"
        type: BankInfo | null
      - name: showCardTypeSheet
        decorator: "@State"
        type: boolean
    events:
      - name: openCardTypeSheet
        description: 银行点击统一入口。
    children:
      - BankListRow
      - CardTypeSheet
  - name: AllBanksPage
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets
    kind: page
    asset_selection: *a1
    state:
      - name: selectedBank
        decorator: "@State"
        type: BankInfo | null
      - name: showCardTypeSheet
        decorator: "@State"
        type: boolean
    events:
      - name: openCardTypeSheet
        description: 银行点击统一入口。
    children:
      - BankListRow
      - CardTypeSheet
  - name: CardTypeSheet
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
    kind: component
    asset_selection: *a1
    props:
      - name: bank
        decorator: "@Prop"
        type: BankInfo
    state:
      - name: selectedType
        decorator: "@State"
        type: BankCardType | null
    events:
      - name: onContinue
        description: 携带 bankCode/cardType 进入选卡页。
      - name: onClose
        description: 丢弃未提交卡型。
  - name: BankCardSelectionPage
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
    kind: page
    asset_selection: *a1
    nav_destination: BankCardSelectionPage
    linked_functions:
      - buildBankCardSelectionPage
    state:
      - name: candidates
        decorator: "@State"
        type: BankCardCandidate[]
      - name: selectedCandidate
        decorator: "@State"
        type: BankCardCandidate | null
      - name: agreementAccepted
        decorator: "@State"
        type: boolean
      - name: showOtpSheet
        decorator: "@State"
        type: boolean
    events:
      - name: openOtpVerificationSheet
        description: 选卡且同意协议后打开验证码弹层。
    children:
      - OtpVerificationSheet
  - name: OtpVerificationSheet
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
    kind: component
    asset_selection: *a1
    props:
      - name: candidate
        decorator: "@Prop"
        type: BankCardCandidate
    state:
      - name: mobile
        decorator: "@State"
        type: string
      - name: otp
        decorator: "@State"
        type: string
      - name: countdownSeconds
        decorator: "@State"
        type: number
      - name: sending
        decorator: "@State"
        type: boolean
      - name: saving
        decorator: "@State"
        type: boolean
    events:
      - name: resendCode
        description: 归零后重新发送。
      - name: saveSelectedCard
        description: 保存并跳转结果页。
      - name: onClose
        description: 取消 Timer 并清理 OTP 状态。
  - name: BankCardOpeningResultPage
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets
    kind: page
    asset_selection: *a1
    nav_destination: BankCardOpeningResultPage
    linked_functions:
      - buildBankCardOpeningResultPage
    props:
      - name: result
        decorator: route_param
        type: OpeningResult
    events:
      - name: finishOpeningFlow
        description: 唯一退出动作。
  - name: HomeTabPage
    module: WalletMain
    file: 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets
    kind: page
    asset_selection: *a1
    state:
      - name: lastOpenedCardNumber
        decorator: "@State"
        type: string | undefined
    events:
      - name: consumeOpeningCompletion
        description: aboutToAppear 单次消费成功卡号。
state_management:
  - state_id: opening-session
    data: opening-session
    scope: 当前入口到结果页
    decorator: "@State + NavPathStack params"
    holder: AddBankCardPage|AllBanksPage / BankCardSelectionPage / OtpVerificationSheet
    module: WalletMain
    design_ref:
      artifact: component-blueprint@1
      component_id: wallet-bank-card-opening
      blueprint_id: bc-openCard-2
      revision: 1
      source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
      artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
      target:
        kind: node
        view_id: runtime
        id: bank-card-opening-flow
    owner_ref: view:runtime/node:bank-card-opening-flow
    contract_refs:
      - contract:bank-card-persistence
    ordered_steps:
      - AddBankCardPage 或 AllBanksPage 调用 CardTypeSheet.open(bank)，传入所选
        BankInfo；关闭时丢弃未提交选择。
      - CardTypeSheet 只允许选中一个受支持卡型；同意并继续后调用 NavPathContext.stack().pushPath 进入
        BankCardSelectionPage，参数包含 bankCode 与 cardType。
      - BankCardSelectionPage 调用 BankRepository.getCards(bankCode, cardType) 返回
        1 至 2 张完整 mock 卡；页面只渲染 maskCardNumber(fullNumber)。
      - 用户选卡并同意协议后，BankCardSelectionPage 打开 OtpVerificationSheet，内存参数包含所选完整
        BankCardCandidate。
      - OtpVerificationSheet 出现时调用 AccountService.getUserProfile() 取得
        UserProfile.mobile，渲染掩码手机号；随后调用 OtpService.sendMockCode(mobile) 并启动 60
        秒倒计时，仅接受六位数字，倒计时结束前禁止重发。
      - OtpVerificationSheet 关闭或 aboutToDisappear 时取消 Timer 并清空
        otp/sending/saving；关闭验证码弹层只丢弃验证码状态，保留具体卡片页上的当前卡片选择供用户继续。
      - 用户提交验证码后，OtpVerificationSheet 调用
        BankCardOpeningService.toStoredCard(candidate) 生成 StoredCard，再调用
        BankCardRepository.save(card) 并等待 RDB 返回；服务将成功或异常统一映射为
        OpeningResult(fullCardNumber, success, errorMessage)。
      - 页面将 OpeningResult 通过 NavPathStack 参数推入
        BankCardOpeningResultPage；结果页禁用返回手势和系统返回。
      - 用户点击完成后，结果页调用 OpeningNavigationService.finish(stack, result)：成功先把
        fullCardNumber 写入进程内 BankOpeningCompletionContext，再调用 stack.clear(false)
        回根首页；失败调用 stack.popToName('AddBankCardPage', false)，保留最初 AddBankCardPage
        并删除 AllBanksPage、选卡页和结果页。
  - state_id: persisted-bank-card-flow-mapping
    data: persisted-bank-card-flow
    scope: 应用沙箱持久态及成功完成一次性交接
    decorator: RDB + publish/consume
    holder: BankCardRepository
    module: WalletMain
    design_ref:
      artifact: component-blueprint@1
      component_id: wallet-bank-card-opening
      blueprint_id: bc-openCard-2
      revision: 1
      source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
      artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
      target:
        kind: flow
        view_id: runtime
        id: persisted-bank-card-flow
    owner_ref: view:development/node:bank-card-repository
    contract_refs:
      - contract:bank-card-persistence
    ordered_steps:
      - 验证码提交后把 BankCardCandidate 转为 StoredCard，并调用 BankCardRepository.save。
      - Repository 在单事务内按完整卡号查询后插入，并发唯一冲突回查既有记录。
      - 保存结果映射为 OpeningResult；结果页消费后，成功参数经 CompletionContext 单次交给
        HomeTabPage，失败定向返回 AddBankCardPage。
    lifecycle_triggers:
      - user_otp_submit
      - result_page_finish
      - home_tab_appear
    mutations:
      - mutation_id: save-bank-card
        kind: foreground
        persistence_ref: wallet_bank_cards.rdb/cards
        publication_ref: publication:bank-card-saved
        recovery_ref: recovery:save-result
    publications:
      - publication_id: bank-card-saved
        payload: OpeningResult 中的完整卡号、成功标记和错误说明；仅在内存调用链传递，不写日志或界面明文。
      - publication_id: opening-completed
        payload: 成功完成时发布到 BankOpeningCompletionContext 的单次完整卡号；HomeTabPage 消费即清除上下文。
    subscriptions:
      - subscription_id: home-completion-on-appear
        consumer_ref: consumer:wallet-home
        publication_ref: publication:opening-completed
        attach: HomeTabPage.aboutToAppear 调用 BankOpeningCompletionContext.consume()。
        detach: 无常驻监听。
        cleanup: consume() 返回后立即清空 Context 内静态值；页面仅在当前生命周期的 lastOpenedCardNumber
          状态中保留，离开页面释放。
        replay_or_snapshot: Context 只保留最近一次尚未消费的成功卡号。
        ordering: 结果页先 publish(fullCardNumber)，再 stack.clear(false) 使 HomeTabPage 出现并消费。
    consumers:
      - consumer_id: opening-result-page
        initial_load_ref: initial-load:opening-card-candidates
        update_ref: publication:bank-card-saved
      - consumer_id: wallet-home
        initial_load_ref: initial-load:opening-card-candidates
        update_ref: publication:opening-completed
    failure_recovery:
      recovery_id: save-result
      handling: 写库失败仍生成失败 OpeningResult 并进入结果页；数据库不留下半写记录。若写入已提交但进程在结果页 push
        前终止，下次重复添加通过完整卡号幂等回查既有记录。
      retry: 本轮结果页不重试，用户点击完成回添加卡片页后可重新开始；进程终止后不恢复未完成页面会话。
navigation:
  config_files:
    - 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
resource_keys:
  WalletMain:
    color:
      - key: color_page_bg
        value: "#F2F3F5"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: color_card_bg
        value: "#FFFFFF"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: color_text_primary
        value: "#1A1A1A"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: color_text_secondary
        value: "#606163"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: color_nav_btn_bg
        value: "#E7E8EA"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: brand_primary
        value: "#007DFF"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: button_tonal_bg
        value: "#E8F3FF"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: brand_danger
        value: "#FF3B30"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: brand_fuel_green
        value: "#34C759"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
      - key: opening_overlay_dim
        value: "#66000000"
        path: 02-Feature/WalletMain/src/main/resources/base/element/color.json
    float:
      - key: bank_space_page_margin
        value: 16vp
        path: 02-Feature/WalletMain/src/main/resources/base/element/float.json
      - key: bank_radius_card
        value: 16vp
        path: 02-Feature/WalletMain/src/main/resources/base/element/float.json
      - key: bank_font_page_title
        value: 20fp
        path: 02-Feature/WalletMain/src/main/resources/base/element/float.json
    media:
      - key: bank_logo_cmb
        media: 02-Feature/WalletMain/src/main/resources/base/media/bank_logo_cmb.png
        description: 仓内既有招商银行 logo。
      - key: result_payment_guide
        media: 02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png
        description: 近似模式下的可见占位，发布前视觉债务。
files:
  - 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets
  - 02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
  - 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
  - 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
  - 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
  - 02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
  - 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
  - 02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets
  - 02-Feature/WalletMain/src/main/ets/index.ets
  - 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
  - 02-Feature/WalletMain/src/main/resources/base/element/string.json
  - 02-Feature/WalletMain/src/main/resources/base/element/color.json
  - 02-Feature/WalletMain/src/main/resources/base/element/float.json
  - 02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png
  - 04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets
  - 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets
  - 04-BusinessBase/AccountManager/src/main/ets/index.ets
  - 01-Product/Phone/src/main/ets/pages/index.ets
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets
prd_to_code_traceability:
  - prd_id: F1
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
  - prd_id: F2
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
  - prd_id: F3
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
      - 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
  - prd_id: F4
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
      - 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets
  - prd_id: F5
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
      - 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
  - prd_id: F6
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets
      - 01-Product/Phone/src/main/ets/pages/index.ets
  - prd_id: F7
    priority: P1
    key_files:
      - 02-Feature/WalletMain/src/main/ets/index.ets
      - 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
      - 01-Product/Phone/src/main/ets/pages/index.ets
  - prd_id: AC-1
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
  - prd_id: AC-2
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
  - prd_id: AC-3
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
  - prd_id: AC-4
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
  - prd_id: AC-5
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets
  - prd_id: AC-6
    priority: P1
    key_files:
      - 02-Feature/WalletMain/src/main/resources/base/profile/route_map.json
      - 01-Product/Phone/src/main/ets/pages/index.ets
  - prd_id: BD-1
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets
  - prd_id: BD-2
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
  - prd_id: BD-3
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
  - prd_id: BD-4
    priority: P1
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets
      - 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
  - prd_id: NFR-1
    priority: P0
    key_files:
      - 02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets
      - 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
change_unit:
  change_unit_ref:
    artifact: change-unit@1
    component_id: wallet-bank-card-opening
    blueprint_id: bc-openCard-2
    change_unit_id: bank-card-opening-flow
    revision: 4
    artifact_sha256: sha256:27fa5f44fb3150337359eaa6d14244ddea742139c4325cf9dce106fdcf5be883
  predicate_mappings:
    - predicate_id: flow-behavior
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets#CardTypeSheet
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets#BankCardSelectionPage
        - planned:02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets#OtpVerificationSheet
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#bank_card_opening_flow
    - predicate_id: state-owners
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
        - planned:02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets#BankOpeningCompletionContext
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#bank_card_state_owners
    - predicate_id: result-consumers
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#BankCardOpeningResultPage
        - 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets#HomeTabPage
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#bank_card_result_consumers
    - predicate_id: persistence-contract
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
        - planned:02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets#StoredCard
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#bank_card_persistence
    - predicate_id: navigation-recovery
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets#OpeningNavigationService
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#BankCardOpeningResultPage
        - 01-Product/Phone/src/main/ets/pages/index.ets#navDestinationMap
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#opening_navigation_recovery
  provide_mappings:
    - provide_id: bank-card-opening-complete
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#BankCardOpeningService
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#BankCardOpeningResultPage
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#bank_card_opening_complete
    - provide_id: bank-card-rdb
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#bank_card_rdb
    - provide_id: opening-navigation-cleanup
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets#OpeningNavigationService
      test_refs:
        - planned:02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets#opening_navigation_cleanup
  design_ref_mappings:
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: logical
          id: bank-card-opening-domain
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#BankCardOpeningService
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-2
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: runtime
          id: bank-card-opening-flow
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#BankCardOpeningService
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#BankCardOpeningResultPage
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-5
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: flow
          view_id: runtime
          id: persisted-bank-card-flow
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
        - planned:02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets#BankOpeningCompletionContext
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-4
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: development
          id: bank-card-opening-ui
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets#CardTypeSheet
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets#BankCardSelectionPage
        - planned:02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets#OtpVerificationSheet
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#BankCardOpeningResultPage
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml#card_type_sheet
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: development
          id: bank-card-repository
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#BD-3
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: development
          id: phone-route-wiring
      implementation_refs:
        - 01-Product/Phone/src/main/ets/pages/index.ets#navDestinationMap
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-6
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: development
          id: account-mobile-mock
      implementation_refs:
        - 04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets#getUserProfile
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-3
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: deployment
          id: local-wallet-runtime
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-4
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: node
          view_id: scenarios
          id: open-card-user-journey
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#BankCardOpeningService
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-1
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: contract
          id: bank-card-persistence
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#BD-3
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: decision
          id: custom-opening-ui
      implementation_refs:
        - 02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets#AddBankCardPage
        - 02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets#AllBanksPage
        - planned:02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets#CardTypeSheet
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets#BankCardSelectionPage
        - planned:02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets#OtpVerificationSheet
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets#BankCardOpeningResultPage
        - 02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets#HomeTabPage
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml#opening_result_success
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: decision
          id: card-number-privacy
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#maskCardNumber
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-2
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: decision
          id: result-stack-policy
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets#finish
      verification_refs:
        - doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml#AC-5
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: relation
          id: scenario-to-domain
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#BankCardOpeningService
      verification_refs:
        - doc/features/bc-openCard-2/blueprint/component-blueprint.yaml#scenario-to-domain
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: relation
          id: runtime-to-domain
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets#BankCardOpeningService
      verification_refs:
        - doc/features/bc-openCard-2/blueprint/component-blueprint.yaml#runtime-to-domain
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: relation
          id: development-implements-runtime
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets#BankCardSelectionPage
      verification_refs:
        - doc/features/bc-openCard-2/blueprint/component-blueprint.yaml#development-implements-runtime
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: relation
          id: repository-persists-domain
      implementation_refs:
        - planned:02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets#BankCardRepository
      verification_refs:
        - doc/features/bc-openCard-2/blueprint/component-blueprint.yaml#repository-persists-domain
    - design_ref:
        artifact: component-blueprint@1
        component_id: wallet-bank-card-opening
        blueprint_id: bc-openCard-2
        revision: 1
        source_fingerprint: sha256:fb887c31df3f865b23b566d1e43d3f3364ee13da663fdc0257ef628a40bc9590
        artifact_sha256: sha256:5dfb52537711026c3a4b82d4b4e9a4e3dc979ea749e3d33c61308428c0093a29
        target:
          kind: relation
          id: phone-wires-wallet-pages
      implementation_refs:
        - 01-Product/Phone/src/main/ets/pages/index.ets#navDestinationMap
      verification_refs:
        - doc/features/bc-openCard-2/blueprint/component-blueprint.yaml#phone-wires-wallet-pages

```

### (resolved input use_cases)

```
schema_version: "1.0"
feature: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
coordinator: BankCardOpeningService
ui_bindings:
  - ui: AddBankCardPage|AllBanksPage
    role: opening_entry
    user_actions:
      - trigger: tap_bank
        calls:
          - openCardTypeSheet
  - ui: BankCardSelectionPage
    role: card_selection
    user_actions:
      - trigger: tap_next
        calls:
          - openOtpVerificationSheet
  - ui: BankCardOpeningResultPage
    role: opening_result
    user_actions:
      - trigger: tap_finish
        calls:
          - finishOpeningFlow
use_cases:
  - id: UC-1
    name: 完成银行卡开卡
    coordinator: BankCardOpeningService
    ui_bindings:
      - ui: AddBankCardPage|AllBanksPage
        role: entry
        user_actions:
          - trigger: tap_bank
            calls:
              - openCardTypeSheet
      - ui: BankCardSelectionPage
        role: progress
        user_actions:
          - trigger: tap_next
            calls:
              - openOtpVerificationSheet
      - ui: OtpVerificationSheet
        role: dialog
        user_actions:
          - trigger: submit_otp
            calls:
              - saveSelectedCard
      - ui: BankCardOpeningResultPage
        role: result
        user_actions:
          - trigger: tap_finish
            calls:
              - finishOpeningFlow
    data_boundaries:
      - name: BankCardRepository
        type: BankCardRepository
        kind: storage
        methods:
          - save
          - list
    state_model:
      phases:
        - ENTRY
        - TYPE_SELECTED
        - CARD_SELECTED
        - OTP_ACTIVE
        - SAVING
        - RESULT
    branches:
      - scenario: 成功保存银行卡
        id: BR-SUCCESS
        linked_acceptance:
          - AC-1
          - AC-2
          - AC-3
          - AC-4
          - AC-5
        expected_phase_seq:
          - ENTRY
          - TYPE_SELECTED
          - CARD_SELECTED
          - OTP_ACTIVE
          - SAVING
          - RESULT
        expected_port_calls:
          - BankRepository.getCards
          - OtpService.sendMockCode
          - BankCardRepository.save
          - OpeningNavigationService.finish
      - scenario: 保存银行卡失败
        id: BR-FAILURE
        linked_acceptance:
          - AC-4
          - AC-5
          - BD-3
        expected_phase_seq:
          - ENTRY
          - TYPE_SELECTED
          - CARD_SELECTED
          - OTP_ACTIVE
          - SAVING
          - RESULT
        expected_port_calls:
          - BankCardRepository.save
          - OpeningNavigationService.finish

```

### doc/features/bc-openCard-2/bank-card-opening-flow/testing/test-plan.md

```
# 测试计划 — bank-card-opening-flow

> **模块标识**: `bank-card-opening-flow`  
> **Feature**: `cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93`  
> **版本**: v1.0  
> **日期**: 2026-10-24  
> **测试负责人**: goal-mode device-testing agent（run `20261023T044016Z-fe4512`）  
> **对应 spec**: `doc/features/bc-openCard-2/bank-card-opening-flow/spec/spec.md`  
> **对应设计**: `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md`  
> **验收 SSOT**: `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml`

```yaml
test_case_flow:
  TC-001: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-002: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-003: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-004: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-005: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-006: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-007: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-008: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-009: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-010: { precondition: { kind: fresh_app, reset: external_data_injection } }
  TC-011: { precondition: { kind: fresh_app, reset: external_perf_sampling } }
```

---

## 一、测试范围

### 测试模块

| 模块名 | 所属层 | 格式 | 说明 |
|---|---|---|---|
| WalletMain | 02-Feature | HAR | 双入口、卡型/卡片/OTP/结果 UI、RDB 与开卡状态 |
| AccountManager | 04-BusinessBase | HAR | OTP 提示所需 mock 手机号 |
| Phone | 01-Product | HAP | 根导航与新旧 NavDestination 装配 |

### 测试功能点

- AC-1：添加银行卡页和全部银行页进入同一卡型选择半模态。
- AC-2：候选卡数量、卡号掩码、单选和协议门禁。
- AC-3：自动 mock 发送、60 秒倒计时、重发和六位数字门禁。
- AC-4：保存成功/失败结果页及跨页参数；成功路径使用真实 RDB，失败路径保留为数据注入缺口。
- AC-5：结果页返回拦截、唯一完成动作和定向清栈。
- AC-6：钱包首页、添加卡片、添加银行卡、全部银行新旧路由回归。
- BD-1..BD-4：不完整输入、重复重发、RDB 异常、中途取消与状态清理。
- NFR-1：本地交互响应目标 300ms；当前工具无校准采样通道，如实披露。
- 四个 P0 目标屏按 `pixel_1to1` 通过阶段级 visual capture/diff 取证。

### 测试范围说明

- **包含范围**：acceptance 中全部 `ut_layer=device|both` 的 AC/BD，以及 device 侧 NFR-1；四张参考图对应屏幕。
- **排除范围**：结果页 NFC 激活区（需求明确本次不做）；系统状态栏、系统数字键盘皮肤和低置信 OCR 孤立文案按目标简报中的合法延后处理。
- **不重复范围**：纯领域计算、RDB 事务/幂等细节已由 UT 覆盖；本阶段只验证真实 UI、导航、设备行为与视觉证据。

---

## 二、测试环境

| 项目 | 要求 |
|---|---|
| 设备型号 | VDE-AL10，目标序列号 `3UJ0225321000395` |
| 系统版本 | HarmonyOS `6.1.0.135(SP8C00E120R3P7)` |
| API 版本 | API 24 |
| 屏幕分辨率 | 1320 × 2120 px，竖屏 |
| DevEco Studio | `D:/Program Files/Huawei/DevEco Studio` |
| 应用包 | `com.example.simulatedwallet` / `PhoneAbility` |
| 构建维度 | runner 冻结的 `product=default`、`buildMode=debug` |
| 自动化 | Hylyre `0.5.1`，trace `0.4-p0`，protocol `hylyre.step-outcome/1` |
| 特殊配置 | 设备策略为已登记的 existing credential；正式链路 build → install → run → visual diff |

---

## 三、测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |
|---|---|---|---|---|---|---|---|
| TC-001 | 添加银行卡入口完成成功开卡 | 冷启动到钱包首页，mock 数据可用 | 1. 首页进入卡包与添加卡片页<br>2. 点击银行卡进入添加银行卡页<br>3. 点击招商银行打开卡型 Sheet<br>4. 选择储蓄卡并继续<br>5. 选择第一张卡、勾选协议并下一步<br>6. 输入 `123456` 并提交<br>7. 在成功结果页点击完成 | 四个新页面依次可达；候选卡仅显示掩码；成功结果页出现；完成后回钱包首页且过程页不可返回 | P0 | AC-1 / AC-2 / AC-3 / AC-4 / AC-5 / BD-1 | hylyre |
| TC-002 | 全部银行入口复用卡型 Sheet | 冷启动到钱包首页 | 1. 进入添加银行卡页并展开<br>2. 进入全部银行页<br>3. 点击招商银行<br>4. 断言卡型 Sheet 的银行名、储蓄卡、信用卡与继续按钮 | 第二入口不再提示暂不支持，展示与主入口相同的银行与卡型内容 | P0 | AC-1 / AC-6 | hylyre |
| TC-003 | 卡型 Sheet 取消后重入复位 | 冷启动到钱包首页 | 1. 从添加银行卡页打开卡型 Sheet<br>2. 选择信用卡<br>3. 点击关闭<br>4. 再次点击同一银行<br>5. 尝试直接点击继续并核对仍停留在 Sheet | 关闭丢弃未提交卡型；重入后未默认选中，继续动作不能进入选卡页 | P0 | AC-1 / BD-1 / BD-4 | hylyre |
| TC-004 | 候选卡掩码与协议组合门禁 | 冷启动到钱包首页 | 1. 进入信用卡选卡页<br>2. 核对 1–2 张候选与掩码文本<br>3. 未选择/未勾选时点击下一步<br>4. 选择候选并勾选协议后点击下一步 | 页面只显示前四后四；任一条件缺失不打开 OTP；两项齐全才打开 OTP Sheet | P0 | AC-2 / BD-1 | hylyre |
| TC-005 | OTP 自动发送与六位数字门禁 | 已进入具体卡片页 | 1. 选择卡并同意协议后打开 OTP Sheet<br>2. 核对掩码手机号和倒计时文案<br>3. 输入 `12345` 并尝试下一步<br>4. 输入 `123456` 并提交 | Sheet 出现即进入倒计时；五位数字不能提交；六位数字可提交并进入结果页 | P0 | AC-3 / BD-1 | hylyre |
| TC-006 | OTP 倒计时归零与重发 | 已进入 OTP Sheet | 1. 核对发送按钮处于倒计时不可用态<br>2. 等待倒计时归零出现“重新发送”<br>3. 点击一次重新发送<br>4. 核对重新进入倒计时 | 同一窗口没有第二次发送入口；归零后一次点击启动新的 60 秒窗口 | P0 | AC-3 / BD-2 | hylyre |
| TC-007 | OTP 关闭后重新进入清空瞬态 | 已进入 OTP Sheet | 1. 输入 `123456` 但不提交<br>2. 点击关闭<br>3. 在选卡页再次点击下一步<br>4. 核对输入框回到空占位且重新开始倒计时 | 关闭释放计时器和验证码；重入从新的自动发送与空输入开始 | P0 | AC-3 / BD-4 | hylyre |
| TC-008 | 结果页返回拦截与完成清栈 | 冷启动到钱包首页 | 1. 完成一次成功开卡到结果页<br>2. 触发系统返回并核对仍在结果页<br>3. 点击完成<br>4. 尝试返回并核对不能回到开卡过程 | 结果页无返回出口且系统返回无效；完成后成功回首页并移除本轮过程栈 | P0 | AC-5 | hylyre |
| TC-009 | 旧路由往返回归 | 冷启动到钱包首页 | 1. 首页→卡包→添加卡片→添加银行卡<br>2. 展开并进入全部银行<br>3. 返回添加银行卡页<br>4. 再返回添加卡片页 | 四个既有页面沿同一 NavPathStack 可达，返回语义与新增流程共存 | P1 | AC-6 | hylyre |
| TC-010 | RDB 失败结果页与退出 | 具备注入 RDB 创建/查询/插入失败的测试构建或数据接缝 | 1. 分别注入三类 RDB 失败<br>2. 提交合法验证码<br>3. 核对失败结果页<br>4. 点击完成并检查数据库与导航 | 失败仍携带受控结果进入失败页；UI/日志不泄漏完整卡号；无半写；完成回添加银行卡页 | P0 | AC-4 / AC-5 / BD-3 | manual:data_injection |
| TC-011 | 本地交互响应 300ms | 具备校准的设备时延采样通道 | 1. 采集卡型选择、按钮启停、本地页面跳转响应<br>2. 排除首次 RDB 初始化并核对进行中防重<br>3. 与 300ms 阈值比对 | 各本地交互目标不超过 300ms；首次 RDB 初始化期间不能重复提交 | P1 | NFR-1 | manual:perf_sampling |

### 用例统计

| 优先级 | 数量 | 说明 |
|---|---:|---|
| P0 | 9 | 8 条 Hylyre + 1 条已知数据注入缺口 |
| P1 | 2 | 1 条 Hylyre 路由回归 + 1 条性能采样缺口 |
| P2 | 0 | 无 |
| **合计** | **11** | Hylyre 9 条，known manual gap 2 条 |

### AC / BD / NFR 追溯

| 条目 | ut_layer | 覆盖用例 |
|---|---|---|
| AC-1 | both | TC-001、TC-002 |
| AC-2 | both | TC-001、TC-004 |
| AC-3 | both | TC-001、TC-005、TC-006 |
| AC-4 | both | TC-001、TC-005、TC-010 |
| AC-5 | device | TC-001、TC-008、TC-010 |
| AC-6 | both | TC-002、TC-009 |
| BD-1 | both | TC-001、TC-003、TC-004、TC-005 |
| BD-2 | both | TC-006 |
| BD-3 | both | TC-010 |
| BD-4 | both | TC-003、TC-007 |
| NFR-1 | device/both 性能项 | TC-011 |

---

## 四、测试策略

### 测试方法

- **功能与导航**：九条 Hylyre 用例均以冷重启复位，使用稳定 `id` 驱动；P0 checkpoint 由 harness 注入 native presence/absence 断言。
- **边界与恢复**：分别验证禁用门禁、关闭重入、60 秒重发窗口、返回拦截与栈清理。
- **真实持久化**：成功路径走当前生产 RDB；失败注入在现有产品/Hylyre 无安全原语，保留 `manual:data_injection`，不制造测试开关。
- **视觉保真**：四个 P0 屏由 `device-testing/visual-diff-nav.json` 导航，正式 visual capture/diff 采集截图与布局树；不把 screenshot 写进 planned steps。
- **性能**：当前驱动步骤耗时包含 UI 树刷新，不能当应用时延；NFR-1 保留 `manual:perf_sampling`，不伪造数值。

### 执行顺序

1. 静态校验顶层计划、派生覆盖和 selector 语法。
2. build → install → Hylyre 执行 TC-001..TC-009。
3. 采集四个 P0 屏并执行 `pixel_1to1` visual diff。
4. 由 harness 合成报告；manual gap 留在分母并逐条披露。

### 回归策略

- 产品修复后重跑受影响 TC；若修改共用入口、导航或 opening service，回归全部 P0 Hylyre 用例。
- 视觉 must_fix 由 runner 交回 coding；testing 阶段不修改产品源码或上游契约。

---

## 五、通过标准

| 指标 | 阈值 | 说明 |
|---|---:|---|
| P0 可执行用例通过率 | 100% | TC-001..TC-008 必须具备 completed/passed/complete native 证据 |
| P1 可执行用例通过率 | 100% | TC-009 必须通过 |
| Hylyre 总通过率 | 100% | 9/9；manual gap 不冒充通过 |
| BLOCKER 缺陷 | 0 | 功能、P0 checkpoint、视觉硬门禁均不得存在阻断 |
| known gap 披露率 | 100% | TC-010、TC-011 必须保留在分母并标明 gap_class |
| 视觉目标 | `pixel_1to1` | 四个 P0 屏无 blocker/major defect、must_fix 或确定性布局/文本命中 |

---

## 六、风险与依赖

### 已知风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| acceptance 的成功完成 checkpoint 要求 `home_root`，当前 HomeTabPage 未暴露该 id | TC-001/TC-008 的原生 checkpoint 可能失败 | 不在 testing 修改源码；保留原 checkpoint，由机器证据交回 coding 修复 |
| 结果页使用已登记的近似占位插画 | `pixel_1to1` 可能产生 major 视觉差异 | 由 visual diff 真实裁决并形成可定位 must_fix；不以既有债务洗绿 |
| RDB 失败需数据注入 | 默认生产包无法安全触发失败页 | TC-010 标 `manual:data_injection`，不新增行为开关或测试 fast path |
| 60 秒倒计时增加单例时长 | TC-006 单例约需 65 秒 | 只保留一条真实倒计时用例；不缩短产品常量 |

### 测试依赖

- 真机在线、已解锁且无系统弹窗遮挡。
- runner 注入的 product/buildMode 与目标设备身份不变。
- Hylyre vendor、hdc、DevEco/hvigor 由正式 harness 对齐。
- 上游 review/UT closure 证据保持有效。

### 环境限制

- Hylyre 当前无校准性能采样和 RDB 失败数据注入原语；两项按 profile 已知缺口分类。
- 系统状态栏与数字键盘皮肤由系统渲染，仅按目标简报披露 best-effort 债务，不降低应用自绘区域的视觉门禁。

```

### doc/features/bc-openCard-2/bank-card-opening-flow/testing/test-report.md

```
<!-- maison:generated:test-report v1 -->
# 测试报告 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

> **模块标识**: `cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93`
> **版本**: harness-generated 2026-10-24T19:44:51.836Z
> **日期**: 2026-10-24T19:44:51.836Z
> **测试执行人**: harness（机器生成；agent 观察见 testing/notes.md）
> **对应测试计划**: `doc/features/bc-openCard-2/bank-card-opening-flow/testing/test-plan.md`
> **权威 run**: `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T194450Z-003/hylyre/trace.json`（trace sha256 c9b11e8f64a89f9f）

> 本文件由 harness 从 trace / timing / meta / gaps / visual-diff / visual-debt / measure / stability 整份生成，重跑 harness 或 `--report-reconcile-only` 会重写；请勿手改，观察与决策写 `testing/notes.md`。

---

## 一、测试概览

| 项目 | 内容 |
|------|------|
| 测试模块 | cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93 |
| 测试日期 | 2026-10-24T19:44:51.836Z |
| 测试环境 | hylyre 0.5.1, hypium 6.1.0.210 |
| 执行人 | harness（机器生成） |
| 用例总数 | 11 |
| 执行用例数 | 9 |
| 跳过用例数 | 2 |

### 真机流水线耗时

> 数据来源：device-test-timing.json（harness 在 device_test.run 成功后写入）；耗时为精确整数毫秒，`—` 表示无数据。

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 打包 (hvigor) | 0ms | 复用既有 HAP; `reused=true` |
| 装机 (hdc) | 0ms | 复用已装版本; `reused=true` |
| Hylyre 自动化 | 215999ms | 含设备预启动 |
| 快照写入 (page save) | 6574ms | 非致命 |
| **合计（脚本统计）** | **—** | harness 各阶段之和（writer 为 null 时为 —） |

| 元数据 | 值 |
|--------|-----|
| HAP 落盘时间 (hapBuiltAt) | 2026-10-24T19:31:01.498Z |
| 本次 harness 跑 build 门禁时刻 | 2026-10-24T19:50:57.147Z |

---

## 二、测试执行结果

| 用例编号 | 用例名称 | 优先级 | 执行状态 | 耗时 | 备注 |
|----------|---------|--------|---------|------|------|
| TC-001 | 添加银行卡入口完成成功开卡 | P0 | 通过 | 25366ms |  |
| TC-002 | 全部银行入口复用卡型 Sheet | P0 | 通过 | 24754ms |  |
| TC-003 | 卡型 Sheet 取消后重入复位 | P0 | 通过 | 9483ms |  |
| TC-004 | 候选卡掩码与协议组合门禁 | P0 | 通过 | 11117ms |  |
| TC-005 | OTP 自动发送与六位数字门禁 | P0 | 通过 | 16166ms |  |
| TC-006 | OTP 倒计时归零与重发 | P0 | 通过 | 72256ms |  |
| TC-007 | OTP 关闭后重新进入清空瞬态 | P0 | 通过 | 17348ms |  |
| TC-008 | 结果页返回拦截与完成清栈 | P0 | 通过 | 17031ms |  |
| TC-009 | 旧路由往返回归 | P1 | 通过 | 15225ms |  |
| TC-010 | RDB 失败结果页与退出 | P0 | 跳过 | — | unsupported_gap:data_injection（留分母、不算通过） |
| TC-011 | 本地交互响应 300ms | P1 | 跳过 | — | unsupported_gap:perf_sampling（留分母、不算通过） |

> **断言披露**：显式断言 127/127 通过，自然语言预期跳过 9 条。

> **弱化旗标披露**：本轮真机执行命令含 --skip-assert-expected——只跳过上述 9 条自然语言预期（这部分未验证、非验收通过）；显式断言照常执行并按结果计入。

### 稳定性（同执行键跨轮）

| 用例编号 | 同键轮数 | 一致轮数 | 首个分歧 step |
|----------|---------|---------|--------------|
| TC-001 | 1 | 1 | — |
| TC-002 | 1 | 1 | — |
| TC-003 | 1 | 1 | — |
| TC-004 | 1 | 1 | — |
| TC-005 | 1 | 1 | — |
| TC-006 | 1 | 1 | — |
| TC-007 | 1 | 1 | — |
| TC-008 | 1 | 1 | — |
| TC-009 | 1 | 1 | — |

---

## 三、缺陷清单

| 缺陷编号 | 关联用例 | 严重程度 | 描述 | 状态 |
|----------|---------|---------|------|------|
| DEF-V001 | TC-001, TC-004, TC-005, TC-006, TC-007 | MINOR | 视觉 warn：屏 bank_card_selection，defects=5，must_fix=5；The first candidate's bank logo is visibly larger than the reference, approximately 96 versus 70 pixels at comparable image widths; its number text is also larger. This changes row proportions. Two candidates and different mock card numbers are permitted and are not defects. | 待修复 |
| DEF-V002 |  | MINOR | 视觉 warn：屏 card_type_sheet__overlay__card_type_overlay_root，defects=10，must_fix=6；The sheet begins around 45% of screen height versus 39% in the reference. This shifts its header and card list downward and leaves the continue action close to the bottom gesture area. All content is visible here; the screenshot does not establish that the action is unreachable. | 待修复 |
| DEF-V003 |  | MINOR | 视觉 warn：屏 card_type_sheet__overlay__card_type_sheet_panel，defects=10，must_fix=6；The panel starts around 45% of screen height rather than the reference's 39%, shortening the sheet and pushing its contents toward the bottom. Visibility is preserved; unreachable controls cannot be inferred from this image. | 待修复 |
| DEF-V004 |  | MINOR | 视觉 warn：屏 otp_verification_sheet__overlay__otp_overlay_root，defects=4，must_fix=3；The instruction starts at roughly 4% of screen width rather than the reference's 7% and uses smaller text. This changes the content hierarchy and wrapping. The panel's lower absolute position coincides with the absent keyboard; this image alone does not prove faulty keyboard avoidance or focus behavior. | 待修复 |
| DEF-V005 |  | MINOR | 视觉 warn：屏 otp_verification_sheet__overlay__otp_sheet_panel，defects=4，must_fix=3；The instruction has smaller text and approximately half the reference's horizontal inset. It remains readable. The keyboard is absent in this capture, so the panel's absolute vertical displacement is not independently classified as a layout defect. | 待修复 |
| DEF-V006 | TC-001, TC-008, TC-010 | MINOR | 视觉 warn：屏 opening_result_success，defects=5，must_fix=3；The success icon is lower, larger and a more saturated green than the reference: its top is around 19.5% of screen height instead of 14.6%. Success remains immediately understandable. | 待修复 |

### 缺陷统计

| 严重程度 | 数量 | 待修复 | 已修复 | 已关闭 | 延期处理 |
|---------|------|--------|--------|--------|---------|
| BLOCKER | 0 | 0 | 0 | 0 | 0 |
| MAJOR | 0 | 0 | 0 | 0 | 0 |
| MINOR | 6 | 6 | 0 | 0 | 0 |
| **合计** | **6** | **6** | **0** | **0** | **0** |

---

## 四、通过率统计

| 优先级 | 总用例 | 通过 | 失败 | 阻塞 | 跳过 | 通过率 | 达标阈值 | 是否达标 |
|--------|--------|------|------|------|------|--------|---------|---------|
| P0 | 9 | 8 | 0 | 0 | 1（含 gap 1） | 88.9% | 100% | ❌ |
| P1 | 2 | 1 | 0 | 0 | 1（含 gap 1） | 50% | ≥ 95% | ❌ |
| **总计** | **11** | **9** | **0** | **0** | **2（含 gap 2）** | **81.8%** | **≥ 90%** | **❌** |

> 通过率 = 通过 / 总用例；unsupported_gap 留在总用例分母、不计入通过（P0 五数口径见 summary.json p0_coverage_integrity.structured）。

---

## 五、结论

**测试结论**: 有条件达标

**按轴结论**（确定性派生）:
- 功能：PASS（hylyre 9/9 通过，失败 0，阻塞 0，trace.outcome=success；显式断言 127/127 通过，自然语言预期跳过 9 条）
- 交互稳定性：UNKNOWN（9 条用例有同键多轮数据）
- 视觉几何：UNKNOWN（visual-diff.json 6 屏：bank_card_selection=warn、card_type_sheet__overlay__card_type_overlay_root=warn、card_type_sheet__overlay__card_type_sheet_panel=warn、otp_verification_sheet__overlay__otp_overlay_root=warn、otp_verification_sheet__overlay__otp_sheet_panel=warn、opening_result_success=warn）
- 视觉内容：CHECKED
- 视觉样式：CHECKED
- 已知缺口：6 项
  - TC-010[manual:data_injection]
  - TC-011[manual:perf_sampling]
  - 视觉债务 open=6, accepted=0（visual-debt.md）
  - 视觉几何 UNKNOWN
  - 交互稳定性 UNKNOWN（同执行键真实执行不足 2 轮，单轮不构成稳定性证据）
  - 弱化旗标 --skip-assert-expected：自然语言预期跳过 9 条（未验证）；显式断言 127 条通过；结论不以「达标」签发
- 总体：COMPLETE_WITH_GAPS

**判定依据**:
- P0 通过率: 88.9%（阈值 100%）
- P1 通过率: 50%（阈值 ≥ 95%）
- 总体通过率: 81.8%（阈值 ≥ 90%）
- BLOCKER 缺陷: 0 个
- 视觉债务 6 条未清偿（open=6, accepted=0；SSOT=visual-debt.json / summary.quality_axes），功能达标与视觉验真是两根轴

**下一步建议**:
- 功能完成可推进；已知缺口按条目在需求/spec 登记并披露，视觉缺口不阻止功能完成但阻断 release_readiness。

```

### doc/features/bc-openCard-2/bank-card-opening-flow/context/facts.md

```
---
schema_version: "1.1"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
run_id: "20261023T044016Z-fe4512"
established_by: spec
ready_to_produce: true
has_blocker_coverage_risk: false
key_inputs_read:
  - "framework/specs/phase-rules/spec-rules.yaml — 已读"
  - "framework/profiles/hmos-app/skills/spec/profile-addendum.md — 已读"
  - "doc/module-catalog.yaml — 已读"
  - "doc/glossary.yaml — 已读"
  - "doc/architecture.md — 已读"
  - "build-profile.json5 — 已读"
  - "doc/component-index.yaml — 已读"
  - "doc/features/bc-openCard-2/blueprint/component-blueprint.yaml — 已读"
  - "doc/features/bc-openCard-2/bank-card-opening-flow/change-unit.yaml — 已读"
  - "doc/features/原始需求/1-2-银行卡/原始需求.md — 已读"
source_code_paths:
  - "01-Product/Phone/src/main/ets/pages/index.ets"
  - "02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets"
  - "02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets"
  - "02-Feature/WalletMain/src/main/ets/index.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets"
  - "02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets"
  - "02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets"
  - "02-Feature/WalletMain/src/main/resources/base/element/color.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/float.json"
  - "02-Feature/WalletMain/src/main/resources/base/element/string.json"
  - "02-Feature/WalletMain/src/main/resources/base/profile/route_map.json"
  - "02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets"
  - "04-BusinessBase/AccountManager/src/main/ets/index.ets"
exploration_mode: "sequential"
change_intent: "feature"
estimated_loc_delta: 1500
touches_layers:
  - "01-Product"
  - "02-Feature/shared"
  - "02-Feature/data"
  - "02-Feature/domain"
  - "02-Feature/presentation"
  - "04-BusinessBase/data"
  - "04-BusinessBase/domain"
adds_new_exports: true
single_function_scope: false
decisions_unlocked:
  - "从添加银行卡页与全部银行页复用同一开卡会话入口"
  - "卡型、具体卡片、验证码、保存结果与定向清栈的验收边界"
  - "WalletMain/AccountManager/Phone 三模块范围与职责"
  - "四张参考图的盲档 UI-Spec、资产占位与视觉债务"
  - "成功完成回钱包首页、失败回最初添加银行卡页"
subagents_used: ""
searches_performed_estimate: 12
files_inspected_count: 35
---

## 探索预算与检索

- 检索现有银行入口的点击行为、路由常量、根 `navDestination` 注册和公开导出。
- 检索账号模型与服务是否已有可供验证码提示使用的手机号字段。
- 核对 CU `touches`、蓝图术语事实、既有 acceptance 候选与成功目的地冲突裁决。
- 读取四份 OCR JSON 和四份只读视觉观察 sidecar；未直接查看参考图片。
- 核对现有资源 token、字符串、路由映射及银行卡相关既有 UT。

## 已检视文件与原因

| 路径（相对仓库根） | 为何读 |
|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 确认添加银行卡页银行点击现状、导航上下文与页面结构 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 确认全部银行页银行点击现状及既有分组/索引行为 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 确认根导航栈装配与目的页注册责任 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 确认账号模型尚无手机号字段 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | 确认 mock 账号入口及手机号供给缺口 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 确认银行数据为本地 mock，尚无卡型和具体卡候选 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 确认既有四个路由与新增路由接线面 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 确认旧银行数据/分组/导航异常测试基线 |
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | 投影术语、Scope、验收和冲突裁决 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/change-unit.yaml` | 绑定 purpose、provide、predicate 与允许修改模块 |
| `build-profile.json5` | 核对 Phone/WalletMain/AccountManager 的物理模块路径与 HarmonyOS SDK 配置 |

## Code Facts

| 路径 | 发现的事实 | 对本阶段产出的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `handleBankTap` 当前记录银行 code 后展示 `not_supported`，不导航。 | F1/AC-1 明确从该入口改为同一卡型选择半模态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | `handleBankTap` 同样只展示 `not_supported`；页面已有 A-Z 分组和索引。 | 第二入口须与添加银行卡页复用相同开卡会话，不破坏既有浏览能力。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` | 银行模型只有 code/name/pinyin/initial/logo/badge。 | 需求须扩展每家银行支持卡型和 mock 具体卡候选。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 仅返回 20 家本地银行数据，无卡候选查询。 | 具体卡选择继续归 WalletMain 本地 mock 数据面，不引入真实银行网络。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 仅导出既有页面 builder，未导出选卡页和结果页。 | 新全屏目的页须经模块出口导出，再由 Phone 装配。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，`navDestinationMap` 最远只注册 `AllBanksPage`。 | 新目的页注册归 Phone；业务清栈策略仍由 WalletMain 计算与发起。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 首页持有来自 Phone 的同源 `@Link navPathStack`。 | 成功完成后清栈回根首页可复用现有同源栈，不另造路由体系。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | `UserProfile` 只有登录态、展示账号和头像。 | 验证码提示所需手机号须由 AccountManager mock 模型补充。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile/login` 未返回手机号；服务为本地模拟。 | 手机号来自账号 mock，短信发送同样明确为 mock。 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 只声明 CardPack/AddCardEntry/AddBankCard/AllBanks 四个目的页。 | AC-6 覆盖新增注册与旧路由不受损。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 旧 UT 已覆盖 20 家银行顺序、分组、空态与栈未挂载异常。 | 本轮测试须保留这些回归，并新增开卡状态、持久化与路由清理断言。 |
| `02-Feature/WalletMain/src/main/resources/base/element/color.json` | 已有页面背景、卡片、文字、链接蓝等资源 token。 | UI-Spec 优先引用项目 token；无可信品牌色时不凭世界知识新增品牌真值。 |

## 关键结论

- 蓝图术语事实仅有“银行卡开卡”，权威模块为 WalletMain、置信度 medium，易混 Phone 应用壳与 AccountManager 账号域；按 CU 投影写入并记录 headless must-review。
- CU `touches` 派生的可修改模块集合精确为 `WalletMain`、`AccountManager`、`Phone`；不扩展 CommUI/CommFunc。
- 成功目的地冲突按蓝图裁决：本轮成功回钱包首页并携带完整卡号；卡详情页延期。失败回最初添加银行卡页。
- 完整卡号只进入受控内存对象和应用沙箱 RDB，不显示、不写日志；UI 只显示前四后四。
- 四张参考图均需建模；结果页 NFC 激活区按需求原句登记 `excluded`，不是 defer。
- 当前无直接视觉能力，`ui-spec` 必须保持 `verified: unverified`；品牌 logo/结果插画缺可信外观绑定时使用可见占位并登记视觉债务。

## 覆盖风险

| 风险 | 处理 |
|---|---|
| OCR 对浅色按钮文案和个别协议字符识别不完整 | 逐字文案优先采用 OCR 高置信文本；需求明确给出的“下一步”等交互文案作为需求事实；残余登记盲档待复核。 |
| 无法亲自核对颜色、像素间距和素材外观 | 不猜测、不声明 VL verified；使用 reviewer sidecar 作结构旁证并保留视觉债务。 |
| 参考结果页包含 NFC 激活区域但需求明确本轮不要 | 以需求原句为上位目标，ref-elements 登记 `excluded`。 |
| 成功后“首页/详情页”两种表述冲突 | 复用蓝图已记录裁决：编号需求与“后续详情页”说明优先，本轮成功回首页。 |

## 进入产出

Research Sub-Phase 已满足：真实源码路径已读、Code Facts 覆盖三模块和数据/导航/账号边界、决策均由 CU/蓝图/需求或当前代码支撑；`ready_to_produce: true` 且无 BLOCKER 覆盖风险。

## phase_delta: plan

本阶段承接 spec 建立的有效 facts 基线，仅补充施工设计所需事实；未改写 `established_by: spec`、run 身份或原始 Code Facts。

| 路径 | 事实 | 对 plan 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/change-unit.yaml` | canonical CU revision=4，提供 3 个 provide、5 个 target predicate、18 个 design ref；touches 只解析到 WalletMain、AccountManager、Phone。 | `contracts.yaml` 必须完整生成 `change_unit_ref`、predicate/provide/design-ref 三类映射，模块范围不得越界。 |
| `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml` | development 节点已给出模型、接口、文件、组件和 use case；runtime flow 明确 RDB 幂等保存、失败结果、一次性完成上下文和定向清栈。 | plan 只做施工落位，不重裁共同设计；`use-cases.yaml` 必须物化。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1..AC-6、BD-1..BD-4、NFR-1 已闭合，AC-5 将失败目的地绑定为 `AddBankCardPage`。 | 功能映射覆盖 F1..F7，并保持成功回首页、失败回添加银行卡页。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml` | 四个 P0 屏幕、全部 token/asset/must-have 元素已登记；素材模式为 approximate，结果引导插画为 placeholder。 | 生成 `plan/visual-parity.yaml`，逐屏映射组件、资源和视觉债务；不声称已直接看图。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `handleBankTap` 仍只 Toast；页面通过 `NavPathContext.stack()` 使用宿主唯一栈。 | 复用既有页面与导航体系，仅把银行点击接到卡型 Sheet。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 分组与字母索引已经存在，银行点击仍只 Toast。 | 保留浏览行为，只替换银行点击后的开卡入口。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 银行数据是本地 async mock，尚无卡型和卡候选接口。 | 扩展现有 Repository，不新增网络层。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | 跨模块出口尚未导出新增目的页 builder。 | 新页面 builder 必须从该出口导出，Phone 只能经出口装配。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，目的页映射只到 `AllBanksPage`。 | Phone 仅追加两个目的页注册，不承载开卡业务。 |
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | `UserProfile` 尚无 `mobile`。 | 仅在账号域补 mock 手机号字段。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile/login` 尚未提供手机号。 | 保持 AccountService 为手机号唯一供给者，WalletMain 不复制账号 mock。 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 现有四个路由已登记。 | 追加两个新目的页，既有名字和顺序语义保持兼容。 |
| `02-Feature/WalletMain/src/main/module.json5`、`04-BusinessBase/AccountManager/src/main/module.json5`、`01-Product/Phone/src/main/module.json5` | WalletMain/AccountManager 是 HAR，Phone 是 entry HAP；均面向 phone。 | contracts.modules 的 format/package_path 与宿主配置对齐，不新增模块配置变更。 |

plan 决策已由上述事实解锁：三模块施工拆分、RDB 模型与接口、四屏组件/状态、统一导航链、完整 CU sidecar、UseCase 分支和视觉 parity 映射；无 scope 扩展、无架构 DSL/模块集合/职责重写。

## phase_delta: coding

本轮为 testing 返修回退，保留既有 spec 建立身份与已验证基线；仅登记当前失败证据与本阶段负责的修复事实。

| 路径 | 事实 | 影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T175459Z-004/hylyre/trace.json` | TC-001/004/005/006/007/008 均在点击 `selection_next_btn` 后找不到 `otp_sheet_title`；失败 UI 树显示协议已勾选但 `selection_next_btn.enabled=false`。 | 修复选卡页的响应式继续门禁；后续 OTP/结果失败按级联缺陷处理。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 按钮 `.enabled()` 只读取普通 `openingService` 内部状态，没有直接读取 `@State selectedCandidate/agreementAccepted`。 | UI 门禁改为以页面响应式状态判定，同时保持 service 为业务状态真源。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T175459Z-004/hylyre/trace.json` | TC-002/003 在卡型 Sheet 关闭后立即操作底层页面：展开点击未生效，重入时 Sheet 未出现。 | 修复 Sheet 关闭阶段的底层交互与延迟回调覆盖重入状态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | `onClose` 与延迟 `onDisappear` 都清理状态；关闭动画期间 Sheet 容器仍可能拦截底层操作。 | 使关闭后的底层交互可达，并避免延迟回调覆盖新一轮打开。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | Sheet 内容过早随 `selectedBank=null` 消失，会让 UI 锚点先于原生遮罩退出；关闭后立即点击被遮罩吞掉。 | 保留内容到 `onDisappear` 再清理，并对关闭期重入请求做延后处理。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 与添加银行卡页复用相同 bindSheet 生命周期，存在同类关闭/重入竞态。 | 对两个入口应用一致的 Sheet 生命周期修复。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | AC-5 checkpoint 要求稳定 `home_root`，原根容器缺该 id。 | 增加验收锚点，不改变首页导航或展示语义。 |
| `doc/features/_adhoc/testing/reports/20261024-140337/hylyre/trace.json` | 当前构建从首页走到选卡并点击下一步后，`otp_sheet_title` 出现，18/18 steps 通过。 | TC-001/004/005/006/007/008 的共同 OTP 入口阻断已在当前构建复核消除。 |
| `doc/features/_adhoc/testing/reports/20261024-140906/hylyre/trace.json` | 当前构建执行卡型 Sheet 关闭后立即重入及再次关闭后点击“更多”，20/20 steps 通过。 | TC-002/003 对应的关闭动画竞态已在当前构建复核消除。 |

## phase_delta: coding

本阶段承接 spec 建立、plan 补充的有效 facts 基线；已复读 contracts、acceptance、use-cases、ui-spec、ArkTS 易错点、模块配置、页面注册、资源目录和三模块实际源码。无新增 Scope 或上游契约决策。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` | 账号模型尚无手机号字段，现有构造器采用可选参数对象。 | 沿现有模型补 `mobile`，不在 WalletMain 复制账号 mock。 |
| `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` | `getUserProfile/login` 是本地 mock 的唯一用户资料供给。 | 两条返回路径统一提供 mock 手机号，验证码页只消费掩码。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` | 20 家银行为本地常量，尚无支持卡型与具体卡候选。 | 保留既有银行顺序与字段，增量补全双卡型和每类 1–2 张完整 mock 卡。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 银行点击目前只显示暂不支持；页面已使用 `NavPathContext`。 | 替换点击终点为共享卡型 Sheet，不新建路由体系。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 银行点击目前只显示暂不支持；分组、索引和返回行为已完成。 | 仅接入共享卡型 Sheet，保留旧浏览行为。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `Navigation` 持有唯一 `NavPathStack`，新增目的页尚未注册。 | 仅经 WalletMain 出口追加 Selection/Result builder。 |
| `02-Feature/WalletMain/src/main/resources/base/profile/route_map.json` | 已有四个目的页且名称稳定。 | 追加两个新目的页，保留旧路由条目。 |
| `02-Feature/WalletMain/src/main/resources/base/media/bank_logo_cmb.png` | BankRepository 已建立招商银行用途绑定。 | 卡型、候选卡复用该 repo_ref；不声称视觉验真。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/asset-manifest.yaml` | 结果引导图明确登记为可见 placeholder 和 major 视觉债务。 | 物化独立 placeholder 资源，不冒充参考图真裁图。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` | `BankInfo` 已增加 `supportedCardTypes`，由银行 mock 数据声明实际支持的卡型。 | 卡型 Sheet 只渲染该银行支持的储蓄卡/信用卡选项。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 新增 `BankCardType`、完整卡号候选模型和选卡页路由参数。 | 卡型与完整卡号在普通数据模型中跨页面传递，界面仅消费脱敏结果。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 新增成功卡号的一次性 publish/consume/clear 上下文。 | 成功清栈回首页后可单次交接完整卡号，消费后立即清空。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 新增携带完整卡号、成功标记和受控错误码的结果模型。 | RDB 成功或失败均可进入统一结果页，完整卡号不用于界面展示。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 新增银行卡持久化记录模型，覆盖卡号、总卡类别、银行、银行卡型、添加时间、支付状态和交易记录。 | RDB 字段与 AC-4/持久化契约一一对应。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 新增 `wallet_bank_cards.rdb/cards` 建表、按完整卡号幂等保存、事务回滚和列表读取。 | 保存成功返回记录；异常不保留半写记录，唯一冲突回查既有记录。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 新增卡号脱敏、六位数字验证码校验、持久化模型与结果模型转换。 | 核心业务规则脱离 ArkUI，可由后续 UT 直接驱动。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 新增成功 publish 后清栈、失败定向返回 `AddBankCardPage` 的完成策略。 | 结果页只需调用具名 `finish`，统一执行 AC-5 清栈规则。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 新增不联网、不记录手机号的 mock 短信发送服务。 | 验证码 Sheet 出现与重发时复用同一异步入口。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 新增按银行支持能力渲染卡型、单选、协议文案和继续按钮的半模态内容。 | 两个银行入口复用同一组件，并以具名方法推进选卡页。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 新增账号手机号读取与脱敏、自动 mock 发送、60 秒倒计时、六位数字输入、RDB 保存和结果回调。 | 覆盖 AC-3/AC-4 与 BD-2/BD-3/BD-4，关闭时清理计时器和瞬态状态。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 新增按银行/卡型加载 1–2 张候选卡、仅显示前四后四、单选与协议门禁、验证码 Sheet 接线。 | 实现具体卡片选择页面并通过既有 `NavPathContext` 推进结果页。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 新增无标题栏结果页、系统返回拦截、成功/失败状态和唯一完成按钮。 | 完成动作统一进入 `OpeningNavigationService.finish`，页面不显示完整卡号。 |
| `02-Feature/WalletMain/src/main/ets/index.ets` | WalletMain 出口已导出选卡页和结果页 builder。 | Phone 仅经跨模块出口注册新增目的页，不深路径引用。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 首页 `aboutToAppear` 单次消费成功卡号，并切换到有卡展示模式。 | 成功清栈回根首页后接收本次开卡结果，避免常驻监听。 |
| `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets` | 新增两个路由名、60 秒倒计时和六位验证码长度常量。 | 页面间沿既有路由规则共享稳定名称与状态参数。 |
| `02-Feature/WalletMain/src/main/resources/base/element/color.json` | 新增开卡半模态遮罩色资源。 | Sheet 视觉 token 可通过资源系统解析，不在 UI 中硬编码色值。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 新增四屏文案与动态格式资源，并按 ui-spec 将背景支持数更新为 100 家。 | 用户可见文案统一走资源键并与盲档 UI-Spec 对齐。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 新增结果页独立可见占位插画，来源仍为 asset-manifest 已登记的 approximate/placeholder。 | 满足运行时资源引用；保留 major 视觉债务，不冒充参考图真裁素材。 |

## phase_delta: review

本阶段沿用 `established_by: spec` 的既有事实基线与 plan/coding 增量；审查基线为提交 `9b37cce3281566e6d20f5071dc502866d976ebe3` 加当前工作树中的本轮实现。review 只核对契约、实现与直接调用链，不改写产品源码或上游产物。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/contracts.yaml` | 正式范围绑定 WalletMain、AccountManager、Phone，并声明模型、接口、组件、状态流与文件清单。 | 按完整契约范围审查，不以已跟踪 diff 列表排除新增文件。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1..AC-6、BD-1..BD-4、NFR-1 是当前验收依据。 | 正常、失败、重复、倒计时、返回与隐私路径均须沿源码核对。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/structure-conformance.yaml` | coding 已登记四个 P0 屏的结构承载。 | review 逐条回看 `implemented_by` 源码；设备像素结论仍留给 testing。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/plan/visual-parity.yaml` | fidelity_target 为 pixel_1to1，asset 模式 approximate，当前 verified 为 unverified。 | 不把占位插画或未执行的真机像素核验误判为视觉 PASS；合法 defer/excluded 按目标简报保留。 |
| `02-Feature/WalletMain/src/main/ets` | 本轮实现包含新增模型、Repository、Domain Service、两个 Sheet、两个页面及既有入口接线。 | 沿完整卡号、RDB、OTP timer、NavPathStack 和完成上下文追踪业务与生命周期正确性。 |
| `04-BusinessBase/AccountManager/src/main/ets` | 账号域增加 mock mobile 供 OTP 页面读取。 | 核对旧构造调用兼容性与手机号不被 UI/日志明文泄漏。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 宿主追加 Selection/Result 两个 destination。 | 核对只经 WalletMain 出口装配且既有路由不受损。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 已核对银行卡型、完整候选卡和选卡路由参数。 | 模型与 contracts 对齐；完整卡号不得直接展示或记录日志。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 已核对成功卡号的一次性 publish/consume/clear。 | 首页消费后清空，静态链路符合完成交接契约。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 已核对成功/失败、完整卡号和受控错误字段。 | 成功失败均能携带后台完整卡号；结果页不渲染该字段。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 已核对 RDB 记录的八个持久字段。 | 字段与 contracts 对齐。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 已核对建表、事务、幂等回查、回滚和列表映射。 | 静态设计符合原子保存契约；真实 RDB 行为交 UT/testing。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 已核对卡号脱敏、OTP 校验和模型转换。 | 当前 mock 正常路径不展示完整卡号。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 已核对成功 clear 与失败 popToName 规则。 | 与当前成功回首页、失败回 AddBankCardPage 裁决一致。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 已核对本地 mock 发送无网络、无手机号日志。 | 满足当前模拟短信边界。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 出现时自动预选首个支持卡型。 | 违反未选择卡型时按钮禁用的当前契约，登记 CR-001。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 保存期间关闭仍可执行，关闭不取消在途保存及完成回调。 | 取消语义与重复结果路由风险，登记 CR-002。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 已核对成功/失败展示、返回拦截与唯一完成按钮。 | 静态结构符合；真实侧滑拦截交 testing。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选为空或加载异常时没有明确空态。 | spec E5 异常体验缺口，登记 CR-005。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 占位图缺少手机、二维码和手部引导语义。 | 不满足结果页近似引导语义，登记 CR-004。 |

## phase_delta: coding

本次为 review 回退后的 coding 窄返修；保留 `established_by: spec` 与既有基线，仅核对注入的 CR-001～CR-003，不扩展到未注入候选或其它阶段产物。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | `selectedType` 虽声明为 `null`，但 `aboutToAppear()` 会自动选中首个支持卡型。 | 删除隐式预选，恢复 BD-1 的显式选择门禁。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 保存异步开始后关闭按钮仍可触发，组件消失会把 `saving` 复位，而在途保存结束仍调用 `onFinished`。 | 保存期间拒绝显式关闭，并以组件活跃标记阻止消失后的完成回调。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 协议资源未传入当前银行与当前卡型。 | 由已加载银行和路由卡型向格式化资源传参。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | `selection_agreement` 固定写成招商银行信用卡协议。 | 改为受控的银行名、卡型格式占位，避免跨银行/卡型错误主体。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/upstream-issues.md` | 既有问题表缺少 `## 问题清单` 标题且列序不符合 `coding-upstream-issues@1`；当前 `coding/reports/script-report.json:1012` 起的同一检查已为 PASS。 | 仅修正当前阶段自有问题表格式并把陈旧问题标记为已关闭，不修改 framework。 |

设备诊断：当前构建已成功安装到登记设备，设备门通过；临时导航脚本在首页首步未找到“添加管理卡片”，未到达目标页面，诊断 trace 为 `doc/features/_adhoc/testing/reports/20261024-123725/hylyre/trace.json`。因此本轮不声称完成真机交互复核，卡型初始态、动态协议展示和保存期关闭行为仍由后续正式 testing 验收。

## phase_delta: review

本次为 CR-001～CR-003 定向返修后的复审；保留 `established_by: spec` 与原始事实基线，仅登记返修文件及直接影响，不重启无边界审查。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | `aboutToAppear()` 重置为未选择态，卡型仅由用户点击赋值，继续动作保持双重空值门禁。 | CR-001 已修复。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 保存期间显式关闭被禁用；组件消失后以 `isActive` 阻止在途保存回调继续导航。 | CR-002 已修复，未发现直接回归。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 协议文案从当前银行与路由卡型取得动态格式参数。 | 与资源改动共同关闭 CR-003。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | `selection_agreement` 使用银行名、卡型两个受控占位。 | CR-003 已修复。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 仍为抽象占位，缺少手机、二维码与手持语义。 | 沿用 `plan/visual-parity.yaml` 已登记的 best-effort major 视觉债务；不阻断 review，发布前必须替换并重验。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选加载仍无异常/空态说明。 | 保留 CR-005（MINOR），不扩大本次返修范围。 |

## phase_delta: ut

本阶段承接 `established_by: spec` 的既有事实基线，只追加业务级 UT 的真实可测性结论；未改写需求、契约、实现或 review 产物。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1、AC-2、AC-3、AC-4、AC-6 与 BD-1..BD-4 均声明 `ut_layer: both`；其具体预期与本轮断言分类逐条命中。 | 这些条目不能因当前实现不可测而静默降级；L3 必须回 owning phase 修复接缝或经有效需求修订。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml` | `UC-1` 把 `BankCardOpeningService` 声明为 coordinator，并要求成功/失败分支具有完整阶段序列和 `BankCardRepository.save` 调用。 | UT 必须驱动真实业务入口，不能在测试内重写 coordinator。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 当前仅有 `maskCardNumber`、`isValidOtp`、`toStoredCard`、`toOpeningResult`，没有 state、Repository 依赖或保存分支入口。 | AC-2 局部规则为 L0；完整 UC-1、AC-4 与 BD-3 命中 L3。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | `RdbStore` 由私有 `openStore()` 创建并缓存，事务与查询/插入/回滚无可替换边界。 | 真实 RDB 原子性与失败恢复不能在单元隔离下预设，需 coding 最小接缝。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 定义 `BankCardType`、完整卡号候选与选卡路由参数。 | 为 AC-2/AC-4 fixture 提供真实类型；不产生状态序列。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | `publish/consume/clear` 实现一次性进程内卡号交接。 | 可做 L0 状态所有权断言，但不能替代成功分支与清栈实测。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 结果对象保留完整卡号、成功标记和可选受控错误。 | 可直接断言 AC-4 的结果映射字段。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 持久化模型包含卡号、类别、银行、卡型、添加时间、两项支付状态和交易记录。 | 可直接断言转换结果字段；RDB 原子性仍需接缝。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | `finish()` 直接依赖 `NavPathStack`，成功 clear、失败 popToName。 | AC-5 是 device-only；UT 不导入导航运行时。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | `sendMockCode()` 是无网络的异步空实现。 | 可作为可注入边界，但当前 OTP 组件未把状态机开放给 UT。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 卡型选择与继续门禁位于组件私有状态/方法。 | AC-1/BD-1 命中 L3，需要无 UI session 入口。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 发送、倒计时、重发、保存和取消清理编排位于 ArkUI 组件。 | AC-3、BD-2、BD-4 没有 UT 白名单允许的真实入口，需提取无 UI 状态对象。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选加载、选卡与协议门禁位于页面私有状态/方法。 | AC-2 的数据规则可测，但 BD-1 的组合门禁仍为 L3。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 完成动作直接消费 `NavPathContext.stack()`。 | 真实结果页退出与手势行为交 device testing。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 新旧目的页注册位于 `@Entry`/`Navigation` 宿主代码。 | AC-6 的真实注册/往返不能由 UT 直接构造；需非 UI 路由决策入口或上游有效分层修订。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 实际图像是灰色抽象占位，与 review 记录一致。 | 不纳入 UT；保留 testing/release 的视觉债务。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 现有测试仍属于上一需求，标签为 AC-14/AC-16/AC-G3 等，不对应本 CU。 | 保留其字节与注册关系，但不得计入当前 AC/BD 覆盖。 |

预期来源核对：上述正确性结论逐条来自 `acceptance.yaml` 对应 AC/BD 原文；实现与既有测试只用于判断当前可执行事实，不被当作预期来源。当前没有新增断言，因此无需登记 characterization 用例。

## phase_delta: coding

本次为 UT 可测性审计回退后的 coding 窄返修；保留 `established_by: spec` 与既有基线，逐项核实 AC-1、AC-3、AC-4、AC-6、BD-1～BD-4 的 option_b 候选，不改写验收语义或 UT 产物。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 当前仅提供脱敏、OTP 校验和模型转换，没有统一承载卡型、卡片、协议、OTP 门禁与保存分支的无 UI session。 | 在现有 domain service 文件内增加最小 opening-session 状态与 repository 注入编排，供页面和 UT 共用。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 当前只有 mock 发送方法；倒计时、重发、输入和取消状态全部位于 ArkUI 组件。 | 增加可注入 `OtpService`、由调用方驱动 tick 的无 UI OTP 状态对象。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 当前 Repository 私有创建 `RdbStore`，事务、查询、插入和回滚无法由 Spy 驱动。 | 引入最小 store wrapper 注入，生产仍使用唯一 RDB wrapper。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 显式卡型选择门禁只存在于组件私有状态。 | 组件改为消费 opening session，不改变初始未选中语义。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 自动发送、倒计时、重发、验证码校验、保存与取消清理均由组件私有字段直接编排。 | 组件改为消费 OTP/opening session；保存期间保持不可关闭，消失后取消在途完成回调。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 卡片与协议组合继续条件只存在于页面私有字段判断。 | 页面复用 opening session 的组合门禁并把真实选择同步到 session。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 新旧目的页集合只编码在 `@Entry` 的 builder 分支中。 | 提取无 UI 路由识别入口，并由 builder 实际消费。 |

## phase_delta: review

本次为 UT 可测性回退返修后的定向复审；保留 `established_by: spec`、run 身份和既有事实基线，只登记本轮新增/变化源码及其直接影响，不重启无边界审查。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 新增 `BankCardStore` 与 `RdbBankCardStore`，`BankCardRepository` 支持构造注入；生产默认仍落到同一 RDB wrapper。 | 核对事务、幂等回查、异常映射及生产路径未被测试接缝替换。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 新增 repository 注入的 `saveCandidate` 和无 ArkUI 的 `BankCardOpeningSession`；页面继续消费真实候选与门禁。 | 核对卡型、卡片、协议、OTP 组合门禁及成功/失败结果映射。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | 新增可注入发送服务、显式 tick/resend/cancel 的 `OtpVerificationState`。 | 核对自动发送、60 秒窗口、快速重复点击与取消清理未改变产品语义。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | 卡型 Sheet 改为消费 `BankCardOpeningSession`，初始仍未选中。 | CR-001 保持关闭；继续按钮门禁无直接回归。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 页面把银行、卡型、候选与协议状态同步到同一个 opening session，并把 session 传入 OTP Sheet。 | 选卡与协议门禁仍由实际 UI 调用；既有 CR-005 空态缺口未变化。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | Sheet 改为消费 `OtpVerificationState`/`BankCardOpeningSession`，生产保存仍创建真实 RDB Repository。 | 自动发送、倒计时、验证码门禁、保存期关闭保护和消失后回调抑制均保持。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | 新增新旧钱包目的页的无 UI 识别入口。 | Phone 内部职责未外溢；作为本轮新增源码纳入复审与追溯。 |
| `01-Product/Phone/src/main/ets/pages/index.ets` | 根 `navDestinationMap` 在既有 builder 分支前实际调用 `isWalletDestination`。 | 新接缝不是测试专用死代码；旧路由和两个新增路由仍由原 builder 分支承载。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 现有旧需求测试载体字节未因本轮生产接缝返修改变。 | 本阶段只读核对，不越界补写下一阶段 UT。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` | 既有银行数据 Spy 仍只服务旧测试，不参与生产路径。 | 不把旧测试当作本 CU 已覆盖；后续 UT 需针对新接缝增加真实断言。 |

## phase_delta: ut

本次在 coding 可测性返修与 review 收口后恢复 UT；保留原始 `established_by: spec` 基线，只登记当前 UT 真实消费事实和本阶段拥有的测试文件。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | `BankCardOpeningSession` 与 repository 构造注入已存在，上一轮 AC-1/AC-4/BD-1/BD-4 的 L3 原因消失。 | 可直接驱动组合门禁和成功/失败保存结果。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | `OtpVerificationState` 提供 start/resend/tick/updateOtp/cancel 且依赖可注入。 | AC-3、BD-2、BD-4 可由 Spy 验证发送序列、倒计时与清理。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | `BankCardStore` 与构造注入已存在，真实 Repository 保存编排可隔离系统 RDB。 | AC-4、BD-3 可覆盖事务、幂等和异常回滚。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | Phone 根导航实际消费的纯函数路由集合已存在。 | AC-6 可由 Phone ohosTest 覆盖新旧目的页共存。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 新增当前 CU 的 AC-1/2/3/4/6、BD-1..4 与 BR-SUCCESS/BR-FAILURE 用例。 | 成为 contracts.change_unit test_refs 的 canonical 证据载体。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankCardOpeningDependencies.ets` | 新增 Repository、Store、OtpService 的强类型 Spy/Fake。 | 隔离系统 IO，同时保留调用序列和失败预设。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` | 旧银行卡列表 legacy suite 仍真实引用该既有 Spy。 | 纳入当前测试目标 facts 覆盖，但不作为本 CU AC/BD 证据。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets` | 原 `bank_open_card_ut.test.ets` 的旧银行卡列表用例原样迁移并继续注册。 | 保留既有回归，不让历史 UI import 混入当前 CU 测试文件。 |
| `01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets` | 新增纯路由注册回归用例。 | 直接证明 AC-6 的 Phone 路由集合。 |

预期来源核对：每条新增正确性断言均对照 `acceptance.yaml` 的同名 AC/BD 原文；BR-SUCCESS/BR-FAILURE 对照 `use-cases.yaml`。源码只提供入口和当前事实，不充当预期来源。

## phase_delta: ut

独立 verifier 对脚本 PASS 材料复核后确认：局部测试不能冒充 `use-cases.yaml` 的完整分支证据。本节只追加新证据，不改写此前真实通过的局部测试事实。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/use-cases.yaml` | BR-SUCCESS/BR-FAILURE 要求完整阶段序列及候选、OTP、保存、完成调用。 | 完整分支标签只能放在驱动同一真实协调入口的用例上。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | service/session 分别覆盖门禁与保存，但没有统一阶段状态，也未注入候选、OTP 与完成策略。 | AC-4 的完整分支仍为 L3；形成 UT-004 coding repair candidate。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 已移除三个局部用例上不真实的 BR-SUCCESS/BR-FAILURE 标签，保留其精确 AC/BD 断言。 | 防止局部规则测试被误算为端到端分支覆盖。 |

## phase_delta: coding

本次针对 UT-004 / AC-4 回退候选做窄返修；继续保留原始 `established_by: spec` 和既有事实基线，不修改 contracts、acceptance 或 UT 产物。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | `BankCardOpeningService` 现由既有 `BankRepository`、`OtpVerificationState`、`BankCardRepository` 和 `BankCardOpeningSession` 组合候选加载、OTP、保存及 ENTRY→RESULT 阶段状态。 | AC-4 成功/失败链获得无 ArkUI 的真实协调入口；未新增 Port 或平行存储真源。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 页面创建生产 RDB Repository 与 OTP 状态后，把选卡、协议及候选加载事件转发给同一 `BankCardOpeningService`。 | 协调入口由真实产品页面消费，不是测试专用死代码。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | Sheet 将自动发送、重发、tick、输入校验和保存完成转发给父页传入的同一 service；保存期间关闭保护和消失后回调抑制仍保留。 | UI 只同步可渲染状态，AC-4 保存结果及阶段可由后续 UT 直接断言。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | `walletDestinationNames()` 同时列出四个既有钱包目的页和两个本轮新增目的页，`Phone/pages/index.ets` 在 builder 分支前实际调用 `isWalletDestination()`。 | 该前轮路由接缝继续作为 AC-6 真实生产消费事实；本次 AC-4 窄返修不修改其字节。 |

## phase_delta: review

本次为 UT-004 / AC-4 协调入口窄返修后的定向复审；保留 `established_by: spec`、run 身份及全部既有事实，只核对既有意见、当前返修和直接回归。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | service 组合既有候选、OTP、RDB 与 session 边界，统一暴露候选加载、OTP、保存完成及 `ENTRY→RESULT` 阶段/结果状态。 | AC-4 获得可由 UT 驱动的真实生产协调入口；未新增平行状态真源或测试 fast path。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 页面构造生产 `BankCardRepository` 和 `OtpVerificationState`，并将候选、选卡、协议与 Sheet 事件转发给同一 service。 | 证明协调入口被产品调用链消费；既有 CR-005 空态缺口未变化。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | Sheet 转发 OTP 启动、重发、tick、输入与 `completeOpening`，仅镜像渲染所需状态。 | 成功/失败结果继续来自真实保存路径；CR-002 的保存期关闭保护与消失后回调抑制保持。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 返修后 coding verdict=PASS，生成时间 2026-10-24T17:20:13.633Z，保证等级 full。 | 复用最新编译与 coding 机器门禁；review 不重复执行无新增信息的全量编译。 |

## phase_delta: ut

本次 UT 返修继续保留原始 `established_by: spec` 基线；补登记 harness 当前目标中已有的两个 suite 注册入口，不改写上游事实。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets` | 注册 `bankOpenCardUtTest` 与既有 legacy suite。 | 当前 CU 的 WalletMain 用例会进入真实 Hypium suite。 |
| `01-Product/Phone/src/ohosTest/ets/test/List.test.ets` | 注册 `walletDestinationRegistryTest` 与既有 Ability suite。 | AC-6 的 Phone 路由回归会进入真实 Hypium suite。 |

## phase_delta: testing

本阶段沿用 `established_by: spec` 的已验证基线，只补充真机计划、执行锚点与视觉证据所需事实；不修改需求、设计、产品源码或 UT。

| 路径 | 事实 | 对 testing 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml` | AC-1..AC-6、BD-1..BD-4 均为 `device` 或 `both`；NFR-1 要求本地交互目标不超过 300ms。 | 测试计划覆盖全部 AC/BD；当前 Hylyre 无校准时延采样原语，NFR-1 以 `manual:perf_sampling` 如实保留。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 添加银行卡页以 `col_row_cmb` 打开共用 `CardTypeSheet`，并保留旧的展开与全部银行入口。 | AC-1 主入口和 AC-6 旧路由均可通过稳定 `id` 驱动。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 全部银行页以 `ab_row_cmb` 打开同一 `CardTypeSheet`。 | AC-1 第二入口单独设计真机用例，避免只验证一个入口。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` | Sheet 暴露标题、关闭、卡型、协议和继续按钮的稳定 `id`，继续按钮在未选卡型时禁用。 | 卡型单选、取消重入和初始门禁可用 Hylyre 驱动。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 选卡页暴露候选、协议、下一步与 OTP Sheet 的稳定 `id`；候选 UI 只渲染掩码卡号。 | AC-2、BD-1 与 OTP 入口可由真机步骤和 checkpoint 断言覆盖。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | OTP Sheet 出现即发送，使用数字输入、60 秒倒计时、关闭清理和六位验证码门禁。 | AC-3、BD-2、BD-4 分别以输入、等待重发和关闭重入用例覆盖。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` | 结果页拦截 `onBackPressed`，唯一退出动作为 `result_finish_btn`。 | AC-5 以返回拦截和完成清栈路径验证。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 当前根 Column 未声明 acceptance checkpoint 所引用的 `home_root`。 | testing 不改产品源码；保留 AC-5 原 checkpoint，让 native 证据与 harness 如实判定并在失败时交回 coding。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml` | 四个 P0 屏为 `card_type_sheet`、`bank_card_selection`、`otp_verification_sheet`、`opening_result_success`，fidelity 为 `pixel_1to1`。 | 建立四屏 `visual-diff-nav.json`，由正式 visual capture/diff 链采集与裁决。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` | 候选卡在后台持有完整卡号，路由参数由银行 code 与卡型组成。 | 真机只断言掩码 UI；完整卡号传递与候选筛选复用 UT 证据。 |
| `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` | 成功完整卡号使用一次性 publish/consume/clear 上下文交给首页。 | AC-5 以完成后回首页及过程页消失为设备可观察结果，不在 UI 读取完整卡号。 |
| `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` | 成功/失败结果均携带完整卡号、布尔结果与受控错误码。 | 结果页设备测试只断言状态文案与导航；敏感参数不进入 selector、截图文案或日志。 |
| `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` | 持久化模型包含卡号、类别、银行、银行卡型、添加时间、支付状态与交易记录。 | 成功设备链走真实 RDB；字段完整性与原子性继续由 UT 负责，避免 UI 重复验证内部字段。 |
| `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` | 生产页面使用真实 RDB wrapper，当前产品包没有可由 Hylyre安全触发的失败注入入口。 | 成功路径真机执行；BD-3/失败结果页登记 `manual:data_injection`，不添加测试行为开关。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` | 统一协调候选、协议、OTP、保存与 RESULT 阶段，页面真实消费该 service。 | 端到端成功用例沿产品入口驱动，不采用测试专用 fast path。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` | 成功 clear 回首页，失败定向 pop 到 `AddBankCardPage`。 | AC-5/BD-3 的设备预期分别绑定首页与添加银行卡页。 |
| `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` | mock 发送状态由 60 秒 countdown 门禁控制，归零后可重发。 | TC-006 保留一轮真实 60 秒等待，不缩短产品常量。 |
| `02-Feature/WalletMain/src/main/resources/base/media/result_payment_guide_placeholder.png` | 结果页当前使用已登记的近似占位插画。 | 不把文件存在当视觉通过；`pixel_1to1` 由本轮截图与参考图真实裁决。 |
| `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` | 新旧六个钱包目的页由纯路由集合统一识别并被 Phone 根导航消费。 | AC-6 真机回归覆盖旧页面往返，并由当前装机包验证新增目的页可达。 |

## phase_delta: review

本次为 testing 回流返修后的定向复审；保留 `established_by: spec` 与既有基线，只登记当前返修事实、窄真机证据及直接回归，不重启无界审计。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` | 候选与协议同步到页面 `@State` 以驱动按钮响应式重算，实际打开 OTP 时仍由 `BankCardOpeningService.canOpenOtp()` 校验。 | TC-001/004/005/006/007/008 的共同禁用按钮根因按代码关闭，未形成平行业务真源。 |
| `doc/features/_adhoc/testing/reports/20261024-140337/hylyre/trace.json` | 当前构建从选卡进入 OTP 的 18/18 步通过。 | 为上述共同根因提供当前构建窄真机证据；不替代后续正式 testing 全量重跑。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 显式关闭/继续路径设置 dismissing，关闭期重开使用 pending 队列，`onDisappear` 后清理或重开。 | TC-002/003 的显式关闭竞态按代码关闭；系统关闭原因未在消失前统一置 dismissing，形成 CR-006 MINOR。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` | 与添加银行卡页使用对称的 Sheet 生命周期协调。 | 主入口修复逻辑一致；全部银行入口仍需正式 testing 覆盖系统关闭边界。 |
| `doc/features/_adhoc/testing/reports/20261024-140906/hylyre/trace.json` | 当前构建关闭、重开、再次关闭及点击“更多”的 20/20 步通过。 | 为显式关闭竞态提供当前构建窄真机证据。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` | 根容器新增稳定 `home_root` id。 | AC-5 完成后首页 checkpoint 可绑定，不改变导航或展示语义。 |

## phase_delta: ut

本次在 testing 回流返修及定向 review 闭环后恢复 UT。保留 `established_by: spec` 与此前已验证的 UT 基线；最新产品改动只涉及页面响应式状态、Sheet 生命周期协调和设备 checkpoint，不改变可脱离 ArkUI 驱动的业务入口或既有 UT 断言语义。

| 路径 | 事实 | 对 ut 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` | 现有用例继续覆盖 AC-1/2/3/4、BD-1..4 与 BR-SUCCESS/BR-FAILURE，调用的 service、OTP、Repository 签名未被最新返修改动。 | 复用当前测试字节并真实重跑，无需新增或改写断言。 |
| `01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets` | 路由注册回归仍覆盖 AC-6；最新返修未修改 `WalletDestinationRegistry`。 | 复用 Phone suite 并真实重跑。 |
| `02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets` | 当前 suite 注册 `bankOpenCardUtTest` 与 legacy suite。 | WalletMain 目标用例可由正式 harness 执行。 |
| `01-Product/Phone/src/ohosTest/ets/test/List.test.ets` | 当前 suite 注册 `walletDestinationRegistryTest`。 | Phone 路由用例可由正式 harness 执行。 |

## phase_delta: testing

本轮复用 `established_by: spec` 基线与既有 testing 计划；根据当前 HAP 的原生失败截图，仅修正 testing 自有的执行导航，不改产品源码、UT 或需求 SSOT。

| 路径 | 事实 | 对 testing 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T183031Z-701/hylyre/failures/TC-001-step-35.png` | 六位验证码输入完成后系统键盘仍展开，`otp_next_btn` 位于键盘遮挡区且 native selector 不可见。 | 新派生计划在 OTP 提交前先执行系统返回收起键盘，并再次断言 `otp_sheet_title`，再点击下一步。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T183031Z-701/hylyre/failures/TC-002-step-18.png` | 全部银行页已正确到达；招商银行位于当前视口以下，直接 `touch ab_row_cmb` 无候选。 | 新派生计划先 `scroll_to ab_row_cmb` 再点击，保持同一业务预期。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T183031Z-701/hylyre/failures/TC-007-step-26.png` | OTP 关闭重入后输入框已清空且倒计时重新开始；TextInput placeholder 未作为独立 `by_text` 节点暴露。 | TC-007 改用稳定 `otp_input` id 验证输入框重现，倒计时仍用可观察文案断言。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T184500Z-agentfix/hylyre/test-plan.hylyre.md` | 仅补齐列表滚动、键盘收起与 TextInput id 断言，顶层 TC 集合和执行通道未变化。 | 用新 execution key 重跑九条 Hylyre 用例，旧 trace 保持只读。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/device-testing/visual-diff-nav.json` | 结果页视觉导航在 OTP 输入后增加收起键盘与 OTP 身份复核。 | 允许 `opening_result_success` 在不改产品行为的前提下到达并采集当前截图。 |

## phase_delta: coding

本轮承接既有 spec 基线与 testing 回流证据，仅处理 OTP 六位输入后按钮仍禁用的共同产品根因，不改需求、测试计划或正式 testing 证据。

| 路径 | 事实 | 对 coding 的影响 |
|---|---|---|
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T185039Z-266/hylyre/trace.json` | TC-001 step 38、TC-005 step 32、TC-008 step 25 均在六位验证码已输入且 OTP Sheet 仍显示后，点击下一步未进入结果页。 | 三条回修候选归并为同一 OTP 提交按钮响应式门禁缺陷。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T185039Z-266/hylyre/failures/TC-001-step-38.json` | UI 树中 `otp_input.text=123456`，但 `otp_next_btn.enabled=false`。 | 证明失败发生在按钮可用态投影，不是结果页路由或 RDB 保存失败。 |
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | `otp` 已是页面 `@State`，输入时同步到 service；按钮可用态却只调用读取普通 service 字段的 `canSubmit()`。 | 按钮渲染显式读取 `@State otp`，点击后的保存仍保留 service 最终校验，避免平行业务真源。 |

## phase_delta: review

本次复审保留 `established_by: spec` 与全部既有基线，只登记最新 OTP 回流返修及其直接影响。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` | 当前按钮的 `enabled`、文字色和背景色显式读取页面 `@State otp`；输入变化仍同步到 `BankCardOpeningService`，保存入口仍调用 `openingService.canSubmit()`。 | 修复 testing UI 树证明的响应式投影缺陷，同时保留 service/session 的最终业务门禁；未形成 fast path 或平行业务真源。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T185039Z-266/hylyre/trace.json` | TC-001/005/008 的失败均发生在旧构建六位 OTP 可见但按钮禁用；TC-002 是 selector ambiguous。 | 三条 coding 候选归并为已返修的共同根因；TC-002 继续归 testing 重派生，不扩大 coding 范围。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 最新 coding 编译、verifier 与 receipt 均 PASS，生成时间 2026-10-24T19:03:18.131Z。 | 复用相称的机器证据，不重复编译；返修后的设备实效仍由下一轮正式 testing 验证。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/spec/ui-spec.yaml` | 四个 P0 `pixel_1to1` 屏共声明 34 个 must-have；其中 `background_search_bank` 同时在 `ref-elements.yaml` 标为 `implement`。 | review 必须全覆盖核对，不能由 16 条结构台账替代。 |
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 当前背景页实现标题、副标题和银行列表，但没有 `background_search_bank` 对应的搜索输入或文案；WalletMain 主源码和资源全局检索亦无“搜索银行”。 | 形成 CR-007 BLOCKER；归 coding 补齐既有页面，不修改 spec 或扩大需求。 |
## phase_delta: review

本次为 CR-007 搜索行返修后的限界复审；保留原始 `established_by`、run 身份和既有事实基线，只追加当前返修及直接影响。

| 路径 | 事实 | 对 review 的影响 |
|---|---|---|
| `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` | 新增 `searchRow()`，收起态与展开态均在副标题和银行白卡之间渲染稳定 id `background_search_bank`；该 builder 不挂点击事件。 | CR-007 的 must-have 承载已补齐，且未接管银行点击、Sheet 状态或路由调用链。 |
| `02-Feature/WalletMain/src/main/resources/base/element/string.json` | 新增 `add_bank_card_search_placeholder` 与 `add_bank_card_search_action`，值分别为“搜索银行”“搜索”。 | ref-elements 文案改用资源承载，无新增硬编码字符串。 |
| `doc/features/bc-openCard-2/bank-card-opening-flow/coding/reports/summary.json` | 当前返修后 coding verdict 为 PASS，generated_at 为 `2026-10-24T19:16:45.224Z`。 | 复用与实际改动相称的编译/静态门禁，不在 review 重复全量构建。 |
| `doc/features/_adhoc/testing/reports/measure-20261024-151528/shot-card_type_sheet.png` | 当前构建已在真机渲染搜索行，设备量测定位 `background_search_bank=[48,454,1272,586]`；导航 8/8 步通过。 | CR-007 有真实渲染与可达证据；完整像素和交互仍由 testing 负责。 |

独立 Claude Code CLI 指出新增 56vp 搜索行会使旧 `bc-openCard-1` 收起态七行布局减少一行。当前有效目标明确要求参考图中的搜索行，而本 CU 的旧行为兼容验收只约束路由名称和返回语义；该视觉变化按当前目标裁决为授权替换，不形成返修候选。

```

### 按需读取的文件（未内联 · 需要核对时用 Read 按路径读取，不要全量通读）

- `doc/glossary.yaml` — 术语与 alias 候选；字面命中不替代语义消歧
- `framework/docs/README.md` — 框架背景索引，按当前任务跟随相关原始链接
- `framework/profiles/hmos-app/skills/README.md` — 当前 profile 知识与 Skill 资产协议
- `framework/profiles/hmos-app/skills/device-testing/profile-addendum.md` — 执行 device-testing 前阅读当前 profile 补充；正文超过内联预算，须按原路径分批读取，未声称读完
- `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T194450Z-003/hylyre/trace.json` — 364748 bytes; authoritative native trace

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
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:51:29.821Z"
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


---

## Lifecycle hooks（实例 / profile / framework）

### Hook fragment 1

<!-- hook:on_context_load:extension:constraint-application.md -->
# 应用域约束：按阶段消费

本工程有一批常驻工程约束，跨需求长期有效——每个需求都要过问，不能指望每次自己想起来。
它们的权威所在是 `doc/extensions/knowledge/constraints/`。

**怎么用**：读 `doc/extensions/knowledge/constraints/README.md` 的**适用矩阵**，
定位**当前阶段**那一列，逐域按格子写明的维度处理：

- 格子有内容 → 本阶段要按那个维度消费该域：先判本需求是否命中（判据在该域文件的条目表里），
  命中的按格子说的维度给出处置或结论；
- 格子是「—」→ 本阶段不消费该域，不必勉强写点什么充数。

命中域的具体条目、强制力、命中条件、处置与验证方式，见该域文件的条目表；
API 与配置字段级的做法见该域的 `## 落法附注`。

**结论落在本阶段的产物里**，不另建台账——产物即证据。哪些条目该出现在哪份产物的哪个位置，
由本阶段自己的规则决定，本文件不重复。

> 本文件只指路。域清单、消费维度、条目内容全部以 `constraints/` 目录为准——
> 那里改了，这里不用动。


---

## 目标简报（goal brief）

### 需求原文

# BankCard原始需求描述

> **需求名**: `bc-openCard-2`
> **创建日期**: 2026-06-10

---

## 一、需求描述

### 需求内容

本次需求内容是银行卡开卡需求，我把原始图片都归档到了本文件同级目录下。

#### 需求规格：

1.用户进入已有的添加卡片页面，之前已经开发过了。之前点击任一银行点击后，提示暂不支持，本次需求改为拉起选择卡类型半模态页面。

2.用户在全部银行页面，任一银行点击后，效果与添加银行卡页面效果一致。

3.选择卡类型半模态页面，会展示本银行支持的储蓄卡+信用卡，如果只支持储蓄卡或者信用卡则只展示一个即可。最多只能选择一种卡类型添加，选择后，下方可点击同意并继续按钮进入对应银行的选择具体卡片页面。

4.银行的选择具体卡片页面，展示该银行支持的银行卡信息，卡号只显示前四后四，但实际后台数据要按完整卡号处理。用户选择一张银行卡后，同意协议，点击下一步，拉起输入验证码半模态页面。

5.输入验证码半模态页面，拉起后默认触发一次假的短信发送，之后右侧按钮变为倒计时，用户必须输入6位验证码才能点击下一步。当前6位验证码可随意输入。倒计时归零后，右侧按钮从倒计时变成重新发送。点击后再次变为倒计时。用户输入完成验证码后，后台将完整卡数据写入RDB（本需求开始要创建卡片数据库和对应卡片数据表，将添加的卡片存入数据库中，数据库中字段至少包含卡号、卡类型[比如银行卡、交通卡、门禁卡等]、银行名称、卡类型、添加时间、开通华为支付状态、开通银联手机闪付状态、交易记录等内容），无论写入成功还是失败，将本次添加的卡片卡号（全卡号）和开卡结果带着跳转到添加结果页。

6.添加结果页是个全屏页面，没有左滑箭头，也禁止左滑事件。添加结果页根据带过来的添卡结果，展示成功或者失败状态。同时本页面只有点击完成按钮才能退出页面，并且在页面退出时，关闭当前栈中1-6的所有页面（都是本轮银行卡添卡页面）。如果本次添加是成功状态，则带着卡片卡号跳转到钱包首页（后续等银行卡详情页开发完，这里会引导跳到银行卡详情页，并携带当前卡片参数）。如果本次添加失败则仅将过程中的页面全部退出，回到最开始的添加卡片页面。

#### 页面说明：

- 1）选择卡类型半模态：页面布局完全参考'3-点击任意银行拉起添卡选卡半模态.jpg'。在添加银行卡或全部银行页面，点击某个银行后，拉起选择卡类型半模态（默认所有mock银行都支持储蓄卡和信用卡，该数据随银行数据走），上方是银行信息，然后是储蓄卡/信用卡二选一，下方有小字提示，然后是协议内容（本次默认按文本展示，不需要可点击富文本），最下方是同意并继续按钮。

- 2）选择具体卡片页面：页面布局完全参考'4-点击信用卡或储蓄卡后拉起选卡页面.jpg'。在第3步选择银行+卡类型后点击继续，跳转全屏的银行内部选卡页面，页面title就是银行名称，上方是小字提示，中间是可选择的不同卡片（每个银行，储蓄卡/信用卡，分别mock 1-2张卡数据），下方是协议（文本即可，不需要富文本），最下方是下一步。

- 3）输入验证码半模态：页面布局完全参考'5-选中某张卡片后拉起短信验证.jpg'。第4步选择具体卡片下一步后，拉起短语输入弹框，上方是小字提示（里面要展示用户手机号，从账号mock数据读），中间是输入框，左边输入右边发送按钮，用户点击发送后，需要将按钮变为60s倒计时，倒计时过程中按钮不允许再次点击。倒计时清零后，按钮重新变成再次发送，并且可再次点击。用户在短信输入框中，只能输入6位数字（需要校验），只有输入正确，下方下一步按钮才从置灰状态变为可点击。点击下一步后，则绑卡完成，进入添卡成功结果页。

- 4）添加结果页：页面布局完全参考'6-短信验证完成后结果页.jpg'。无title，全屏页面。上方根据前一个页面传递的添卡结果，控制上方图标/文案/下方小字的提示内容，然后附一张引导图片（大差不差就行了），再往下的激活nfc部分本次先不需要。最下方是完成按钮。点击完成按钮后，跳转到卡详情页。并且本次添加的卡片数据则需要写入数据库中，数据库要包含卡片的详细数据，比如卡号/类型/哪家银行/支持华为支付或银联手机闪付/交易记录，后续的卡详情等页面都是根据数据库读取卡数据并展示。有一点要注意：到了添加结果页，要屏蔽左滑事件，并且在点击完成按钮后，要把整个开卡过程中的所有开卡相关页面全部从页面栈中剔除（从添加银行卡页面开始，一直到结果页自身）。避免开卡完成后还能一直左滑看到开卡过程页面。

#### 路由规格

1. 所有页面跳转要遵循已有路由规则，相关代码参考模块画像去找，不要自由发挥或者另外写一套。
2. 测试用例要包含老代码和本轮新开发代码的页面互相跳转功能，不能导致原有路由受损。

### 请求结果与完成目标

- 完成终点：feature
- 请求结果：从原始需求和参考图完成 bc-openCard-2 的开发、测试与验收闭环

### 明确不做

需求原文里明确写了不要或本次不做的内容同样是排除项，即使尚未登记。
- 参考图元素 result_nfc_panel：「再往下的激活nfc部分本次先不需要」

### 本次延后

以下是 spec 登记的本次延后及债务，不是用户原文排除；理由和登记正当性仍须依当前目标核验。
- card_type_status_bar（ref_card_type_sheet）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- selection_status_bar（ref_bank_card_selection）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- otp_status_bar（ref_otp_verification_sheet）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- otp_system_numeric_keyboard（ref_otp_verification_sheet）：系统数字键盘由输入类型触发；不由应用绘制，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- result_status_bar（ref_opening_result_success）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- result_ocr_uncertain_copy（ref_opening_result_success）「回中加」：OCR 低置信孤立文本，reviewer 观察判定为插画区域而非可靠产品文案；留待有视觉能力复核（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
有效范围已明确而审查意见相反：更正 review 报告，不派扩大范围的 coding 返修；实现违约由 coding 恢复契约。只有登记错误、定义缺口或目标需要改变时回原设计/spec 责任方。
合法延后按当前严格度披露债务与发布状态；不豁免真实功能、数据或关键交互缺陷。

### 已授予的权限

- 写入模式 full-access，审批模式 never

### 判定办法

目标以当前有效的授权与明确修订为准；候选缺陷、参考图、下位产物与目标冲突时按目标裁决并留一行裁决记录，只有目标本身冲突或缺失且无法裁决时才问人。详见 framework 行为规约 skills/reference/agent-behavioral-principles.md「权威判定」。

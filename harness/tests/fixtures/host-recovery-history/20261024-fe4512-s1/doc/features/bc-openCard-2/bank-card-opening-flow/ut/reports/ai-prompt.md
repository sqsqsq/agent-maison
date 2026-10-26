# 业务级 UT 阶段语义验证 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93（v2.1 · UseCase 去代码化）

核对本次承诺的测试层级与生产入口一致：UT 驱动可隔离的真实业务状态/异常；UI、焦点和导航栈交设备。both 的两层互补，不要求 UT 实例化 UI，也不能只测 helper 冒充流程通过。L3 候选回原责任方；option_a 不批准降低当前验收。仅核当前材料，不新增一轮设计或额外门禁。

> 自动生成于 2026-10-24T19:29:13.123Z
> 本文件为 AI Harness 的 prompt，可发送给任意 AI 模型执行语义级验证。
> 现代调用消费绑定的 acceptance/contracts 与实际测试目标，P3 等价内容不因缺物理 spec/plan 降级。unit/both 的 AC、BD、NFR 都核对真实覆盖；性能基准必须有授权负载、指标和预期。request 只证明指定断言，不冒充 CU 完成；characterization 不自动成为正式期望。mock/testability 按真实依赖与目标核验，已明确 pure 的依赖不强造 mock-plan。UT 使用设备环境不自动产生 testing 义务。
>
> **Profile 语义补充**：实例若存在 `framework/profiles/<project_profile>/harness/prompts/verify-ut.overlay.md`，须与本正文**合并阅读**。

---

## 一、你的角色

你是一名**独立的测试审查员**，专门负责业务级单元测试（UT）的语义级质量验证。
你的任务是根据下方提供的 **Spec 规约**、**use-cases.yaml**（若存在）、**DAG 文件**、**业务编排源代码**（coordinator / Page 命名方法 / Flow 类 / 导出函数，代码形态由 coding 自选）与 **UT 代码**，逐项评估 UT 阶段产出是否满足 v2.1 的语义约束。

**v2.1 关键原则（与 v2 的差异）：**
- `UseCase` 不再强制为代码中的类，而是 `use-cases.yaml` 中的**规约 / 导航图**：`coordinator`（指向真实代码里的类/方法/函数）、`ui_bindings`（UI↔业务入口映射）、`data_boundaries`（引用 `contracts.yaml` 已登记的 data 层类，而非新造 Port 接口）
- **不再强制**校验「`domain/usecase/` 下 UseCase 类文件」、`Port` 接口形态、UseCase 类纯净度等**固定目录/类名**硬规则（以 `use-cases.yaml` 规约为准）
- UT 作为**既有代码的消费者**：直接调用 `ui_bindings.user_actions.calls` 声明的**命名函数**（Page 方法 / Flow 方法 / 导出函数），在 `data_boundaries` 处打桩
- **UI 层仍绝对禁止进入 UT**：具体禁入符号以 harness 的 `ut_import_whitelist` 及当前 profile 阶段规则为准；不得将 UI 组件或页面运行时依赖 import 进 UT。

**审查方针：**
- 你独立于 UT 生成者，避免"自己验自己"的偏差
- 仅基于 Spec 与代码给出客观判定，不做主观偏好评价
- 脚本 Harness (`check-ut.ts`) 已完成了所有**确定性检查**（schema / 无环 / 禁用符号扫描 / 标签格式 / 覆盖计数 / boundary 匹配 / named_business_handler / tsc 静态编译 等），你负责**脚本无法覆盖的语义级检查**
- **不要**重新给出"应该新造 Port 接口 / UseCase 类"之类的建议——这是 v2.1 明确否定的反模式
- 若证据不足以判定，标注为 WARN 而非强行判定

---

## 【HARD STOP — 不可绕过的产出约束】

> 以下约束是 business-ut 阶段的**红线**。违反任一条都应在最终报告的 `summary.verdict` 强制为 `FAIL`，并在对应检查项补 BLOCKER 级 `src_mutation_discipline` 条目。

1. **禁止修改业务源码**：business-ut 阶段**禁止**对**业务实现源码树**（如设计/contracts 列出的 `src/main` 或等价非测试根目录；路径前缀以本实例为准）下任何文件做**任何修改**（包括"顺手抽个函数方便 UT 调用"、"把 private 改成 public"、"新增一个工具函数"、"修改 barrel 导出路径"等）。
2. **可测性缺口交回 coding**：如确实无法通过 UT/Spy/Stub/原型替换绕过，记录文件、变更签名、技术理由和影响面，产出 coding repair candidate；由 coding owner 修改后重走 review→ut。
3. **人工授权不放行**：用户回复、署名、receipt 或 legacy `gap-notes.md > approved_src_mutations[]` 只可作为历史/普通输入，不得把源码漂移改判为 PASS。
4. **任一源码改动均违规**：脚本 Harness 的 `ut_no_src_mutation` 在 review 正式闭环后按 review closure attestation 的逐文件内容哈希对账产品源码树（review 未闭环时才回退 `src/main` 的 git diff）。**它已不是永久 BLOCKER**：漂移按风险分级记 MAJOR WARN（`check-ut.ts` `utDriftTieredWarn`），归类为 coding change 并列出所需复核，不阻塞 UT 闭环；纪律不变——UT 阶段仍禁止改业务源码，漂移仍要回 coding 纳入并按分级复核，**提交与否不影响结论**。你不得据此把已退役的硬门重新施加回来（把 WARN 说成 BLOCKER 就是），也不得反过来把它当作"改码没关系"。
5. **作为审查员的你**：在语义检查时，若发现 UT 目录外（即 `src/main` 侧）的业务代码与 plan.md / contracts.yaml 声明不一致，或出现"为了 UT 便利而新增的辅助函数"嫌疑（无对应 spec/plan 依据的工具函数、Getter/Setter 等），请在 `end_to_end_driving` 或新增的 `src_mutation_discipline` 项中标 BLOCKER。
6. **必须确认真实执行状态**：若脚本报告中的 `ut_run_status` 显示 `当前是否可以宣称 UT 完成：否`，或 **`ut.run`** 为 FAIL（报告可能仍显示 legacy 名 `ut_hvigor_test`）/ 被 **`ut.compile`**（legacy `ut_hvigor_build`）短路，则最终 `summary.verdict` 必须为 `FAIL`。不要把 `ut_tsc_compiles PASS` 误判为 UT 已真实运行通过。
   > **例外（产品失败诊断请求）**：本 prompt 若带「本轮为产品失败诊断」一节，则 harness 已确认这是它主动签发的诊断请求——`ut.compile` 通过、`ut.run` 是**真实用例断言失败**（归因 `code_regression`）、且没有其它 BLOCKER FAIL，也没有未标注为已确认不适用的 BLOCKER SKIP。此时**照常**逐项完成语义检查，尤其是 `end_to_end_driving` 与 `business_assertion_value` 这两项（它们的 PASS/FAIL 决定这次失败该回 coding 改产品还是回 UT 改测试）。`ut.run` 的产品执行 FAIL 由 harness 原样保留，**不由你的报告继承**：`summary.verdict` / `blocker_count` 只表示**本轮语义检查**的结论——你自己判出的 BLOCKER 级 FAIL 有几条就写几条，一条都没有就写 `PASS / 0`。把产品 FAIL 抄进终态并跳过这两项检查，只会让本该产生的回修候选整批消失。原生编译/执行约束在常规验证请求下不降低。

> 典型违规迹象（请特别留意）：
> - 业务源码树（非测试目录）里新增了看似仅为 UT 服务的函数，但该函数**没有对应的 spec/plan 条目**；
> - 原本 `private` 的方法被改为 `public`，且 UT 里就是在调这个刚变更的方法；
> - 新增的 export barrel / 中间文件只被 UT 导入、未被任何业务代码消费。

---

## 二、功能模块

- **模块名称**: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
- **阶段**: ut

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/ut-rules.yaml` 的完整内容，定义了 UT 阶段的通用约束规则：

```
phase: ut
version: "1.0"
applies_to:
  use_cases_spec: <features_dir>/{feature}/use-cases.yaml
  dag_files: "{module}/test/dag/**/*.yaml"
  ut_files: "{module}/src/ohosTest/ets/test/**/*.test.ets"
structure_checks:
  upstream_verdict_gate:
    description: >
      跨阶段负面裁决传播门禁（blind-visual-hardening d1）：ut 启动时消费上游各阶段 summary.json
      机器裁决——review 结论不通过（summary FAIL）等负面裁决未解决时 ut 不得启动（bc-openCard 二轮：不通过+3
      BLOCKER 曾照常进 ut）。
  harness_host_artifact_pollution:
    description: >
      framework harness 目录（ctx.harnessRoot）下不得出现
      contracts.modules[].package_path 对应的宿主 module 树；hmos-app 另扫 ohosTest /
      test/dag / *.test.ets。任一命中即 BLOCKER。
    severity: BLOCKER
  usecase_spec_recommended:
    description: >
      若 feature 满足以下任一复杂度条件，推荐产出 use-cases.yaml： (1) 多 UI 节点（页面+组件 ≥ 2）共享同一业务状态；
      (2) 多步云调用串行（≥ 2 次云端接口顺序依赖）； (3) 含回滚分支。 harness 无法精确判定复杂度，仅做弱提示：当
      acceptance.yaml 中 ut_layer ∈ {unit, both} 的 AC ≥ 3 条 且 use-cases.yaml 缺失时
      WARN。 单点加载类简单 feature（如 home-page）可只用 acceptance.yaml + dag.yaml。
    severity: WARN
    rule:
      trigger_if:
        - count(acceptance.yaml > criteria[ut_layer in [unit, both]]) >= 3
      and_missing:
        path: <features_dir>/{feature}/use-cases.yaml
  usecase_spec_schema:
    description: >
      use-cases.yaml 存在时必须符合 Schema v2：
        schema_version / feature / use_cases[]；
      每个 use_case 含 id / description / coordinator / ui_bindings /
      data_boundaries / state_model / branches。
    severity: BLOCKER
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_use_case:
        required_fields:
          - id
          - description
          - coordinator
          - ui_bindings
          - state_model
          - branches
        ui_bindings_each_required:
          - ui
          - role
          - user_actions
        data_boundaries_each_required_if_present:
          - name
          - type
          - kind
          - methods
        branches_each_required:
          - id
          - scenario
          - linked_acceptance
      ui_bindings_role_enum:
        - entry
        - progress
        - dialog
        - result
        - passive
      data_boundaries_kind_enum:
        - cloud
        - storage
        - system
  usecase_ui_bindings_nonempty:
    description: >
      use-cases.yaml 中每个 use_case 的 ui_bindings 至少有 1 条， 且全体 user_actions 合起来 ≥
      1 条（否则这条流不涉及 UI 触发， 应直接用 dag.yaml 测 Repository 级函数，不应产出 use-cases.yaml）。
    severity: BLOCKER
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_use_case:
        ui_bindings_min_count: 1
        total_user_actions_min: 1
  boundary_matches_contracts:
    description: >
      use-cases.yaml > data_boundaries[].type 必须能在 contracts.yaml >
      interfaces[].class 中找到同名类（确保 UT 打桩的对象是 plan 阶段登记的真实 data 层类）。
    severity: MAJOR
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_boundary:
        validate: boundary.type in contracts.yaml > interfaces[].class
  dag_files_parseable:
    description: >
      archived/ephemeral DAG 候选必须能解析为 YAML mapping。harness 须报告
      实际探测目录、候选路径、来源类型与解析错误；存在但损坏的 DAG 不得静默 跳过或误报为“未找到 DAG”。
    severity: BLOCKER
  dag_schema_compliance:
    description: >
      DAG 文件必须符合 DAG Schema：必填 flow_id / flow_name / module / entry_point /
      nodes；当 feature 产出了 use-cases.yaml 时， DAG 额外必填 use_case（指向
      use_cases[].id）与 branches（分支 id 列表）。
    severity: BLOCKER
    rule:
      for_each_dag_file:
        required_fields:
          - flow_id
          - flow_name
          - module
          - entry_point
          - nodes
        required_fields_if_use_cases_yaml_exists:
          - use_case
          - branches
        nodes_each_required:
          - id
          - type
          - description
  dag_node_type_valid:
    description: |
      DAG 节点的 type 必须来自合法枚举集。
    severity: BLOCKER
    rule:
      for_each_dag_node:
        field: type
        allowed_values:
          - code_execution
          - async_call
          - background_task
          - assertion
          - conditional_branch
          - user_trigger
          - port_call_cloud
          - port_call_local
          - state_transition
          - ui_subscription
          - user_intervention
          - ui_navigation
  dag_acyclic:
    description: DAG 必须可拓扑排序
    severity: BLOCKER
    rule:
      for_each_dag_file:
        validate: topological_sort_possible
  dag_source_file_exists:
    description: DAG 节点的 source.file 引用的文件在工程中必须存在
    severity: BLOCKER
    rule:
      for_each_dag_node:
        if_has: source.file
        check: file_exists_on_disk
  dag_linked_usecase:
    description: |
      当 feature 产出了 use-cases.yaml 时：
        DAG.use_case 必须在 use-cases.yaml > use_cases[].id 中存在；
        DAG.branches[] 必须全部在该 UseCase 的 branches[].id 中存在。
    severity: BLOCKER
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_dag_file:
        - use_case_in_spec: true
        - branches_all_in_spec: true
  dag_boundary_matches_spec:
    description: >
      DAG 中 port_call_cloud / port_call_local 节点的 boundary.name / boundary.type
      / boundary.method 必须在 use-cases.yaml > data_boundaries 中找到对应声明（仅当
      use-cases.yaml 存在时适用）。
    severity: MAJOR
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_dag_node:
        filter: type in ["port_call_cloud", "port_call_local"]
        validate: boundary.name + boundary.type + boundary.method matches
          data_boundaries[]
  dag_assertion_linked_branch:
    description: >
      type=assertion 的节点必须声明 linked_branch 或 linked_acceptance （以便 UT
      生成时对应到具体分支/验收项）。
    severity: MAJOR
    rule:
      for_each_dag_node:
        filter: type == "assertion"
        require_any_of:
          - field: linked_branch
            non_empty: true
          - field: linked_acceptance
            non_empty: true
  ut_file_naming:
    description: UT 文件名以 .test.ets 结尾，文件名反映业务流程
    severity: MAJOR
    rule:
      for_each_ut_file:
        expect: filename_ends_with
        suffix: .test.ets
  ut_framework_import:
    description: UT 文件必须导入 @ohos/hypium 并使用 describe/it 结构
    severity: BLOCKER
    rule:
      for_each_ut_file:
        must_import_from: "@ohos/hypium"
        must_contain:
          - describe(
          - it(
  ut_assertion_exists:
    description: 每个 it() 至少一条 expect 断言
    severity: BLOCKER
    rule:
      for_each_test_case:
        min_assertions: 1
  ut_tsc_compiles:
    description: >
      UT 文件（*.test.ets）必须能通过 TypeScript Compiler 静态编译（tsc --noEmit）： 零 Error
      级诊断。该规则使用轻量化 CompilerHost，将 .ets 虚拟为 .ts，并关闭 import
      resolution，仅检查测试文件本体的语法和文件内类型错误。 目的：防止弱模型生成的 UT 明显编译不过却被 harness 标绿（假
      PASS）。 跨文件类型错误由 ut_hvigor_build 兜底。
    severity: BLOCKER
    rule:
      for_each_ut_file:
        expect: ts_error_count == 0
      ambient_symbols:
        - describe / it / expect / beforeAll / beforeEach / afterAll / afterEach
        - Level / Size / TestType / DEFAULT (from @ohos/hypium)
        - MockKit / when (Hypium mock API; UT import 须 mock-plan
          strategy=mockkit，见 ut_hypium_mockkit_policy)
  ut_hvigor_build:
    description: >
      v2.2 新增（方案 B）：UT 所在 ohosTest 模块必须能通过 hvigor 真实编译。 这是 tsc --noEmit 规则的进阶护城河
      —— tsc 只检查单个测试文件本身， hvigor 则跨文件、跨模块编译，能发现 UT 对被测函数签名的实际违约。 工具链缺失时 FAIL（不
      SKIP）；HARNESS_SKIP_HVIGOR=1 显式跳过也 FAIL。
    severity: BLOCKER
    rule:
      scope: contracts.yaml > modules[].name （仅 ohosTest 目录下存在 UT 的模块）
      command: hvigorw --mode module -p module=<module>@ohosTest -p buildMode=debug
        assembleHap --analyze=advanced --parallel --incremental --daemon
      pass_if: exit_code == 0 AND parsed_error_count == 0
      log_persist: <features_dir>/<feature>/ut/reports/hvigor-ut-build.log
      on_tool_missing: FAIL
      on_env_skip: FAIL
      short_circuit: 若 ut_tsc_compiles 或 ut_hvigor_build FAIL，后续 ut_hvigor_test 直接短路
  ut_no_src_mutation:
    description: |
      business-ut（UT）阶段**禁止修改业务源码**。 对 02-Feature/**/src/main/**、01-Business/**/src/main/**、00-Common/**/src/main/** 等非 ohosTest/test 目录下的任何变更，不接受用户署名、receipt 或 gap-notes 放行； 所需源码改造必须交回 coding owner，并完整重走 review→ut→testing。 harness 做法：
        (1) 确定 baseRef：优先读 trace.json > start_commit；无则回退 HEAD~1；
        (2) git diff --name-only <base>..HEAD + 未提交变更 + untracked；
        (3) 按路径前缀筛出业务源码变更；
        (4) 任一命中均 FAIL BLOCKER 并路由 coding repair；legacy 授权字段只读且 inert。
    severity: BLOCKER
    rule:
      protected_prefixes:
        - 02-Feature/
        - 01-Business/
        - 00-Common/
      exclude_patterns:
        - "**/src/ohosTest/**"
        - "**/test/**"
      base_ref: trace.json > start_commit（否则回退 HEAD~1）
      fail_if: any changed business file
  ut_hvigor_test:
    description: >
      v2.2 新增（方案 C）：UT 必须在真机/模拟器上**实际运行**并全部通过， 作为 business-ut 的必要出口条件（而非
      SKIP）。该规则：
        (1) 先调用 hdc list targets 探测设备；
        (2) 无设备 → **FAIL BLOCKER**（不 SKIP；内网无设备的"软通过"是已知假 PASS 根因）；
        (3) 有设备 → hvigorw test 装机运行；
        (4) 解析 hypium 输出：total / failed / failures；failed > 0 FAIL；
        (5) HARNESS_SKIP_HVIGOR_TEST=1 逃生阀触发时仍然 FAIL（显式拒绝软通过）。
    severity: BLOCKER
    rule:
      device_probe: hdc list targets
      command: hvigorw --mode module -p module=<module>@ohosTest -p buildMode=debug
        test --analyze=advanced --parallel --incremental --daemon
      pass_if: exit_code == 0 AND hypium.failed == 0 AND hypium.total > 0
      log_persist: <features_dir>/<feature>/ut/reports/hvigor-test.log
      fail_modes:
        - "no_device: hdc 探测不到可用目标 → FAIL (BLOCKER) 且提示用户启动模拟器/接入真机"
        - "tool_missing: 找不到 hvigorw → FAIL (BLOCKER)"
        - "env_skip: HARNESS_SKIP_HVIGOR_TEST=1 → FAIL (BLOCKER)"
        - "hypium_failures: failed > 0 → FAIL (BLOCKER) 并列出失败用例堆栈"
        - "zero_total: 用例总数为 0 → FAIL（说明 ohosTest 未正确注册 List.test.ets）"
  ut_import_whitelist:
    description: >
      UT 文件的 import 必须落在白名单内：
        - @ohos/hypium
        - 被测模块的 data / domain / 业务编排类及其依赖的数据模型
        - 同目录下的 spy/ 目录（Spy/Fake/Stub 实现）
      严禁 import 任何 UI 符号，反向兜底防止 AI 为了"模拟用户动作" new 出 @Component struct。禁单项与
      no_ui_dep_in_ut 合并。
    severity: BLOCKER
    rule:
      for_each_ut_file:
        forbid_import_matching_any_of:
          - "@Component\\b"
          - "@Entry\\b"
          - "@Preview\\b"
          - "@Consume\\b"
          - "@Provide\\b"
          - \bNavPathStack\b
          - \bNavDestination\b
          - "@kit\\.ArkUI"
          - "@kit\\.ArkGraphics"
          - \$r\(
          - \$rawfile\(
          - getUIContext
          - PromptAction
          - \bshowToast\b
          - "@aspect/CommUI"
          - AppStorage
          - LocalStorage
  boundaries_all_stubbed:
    description: >
      当 feature 产出了 use-cases.yaml 时：仅对 type 已登记在 contracts.interfaces[].class
      中的 data_boundary，要求对应 UT 文件 new 出一个 Spy/Fake/Stub 实现并注入业务编排对象 （class
      命名格式：Spy{type} / Fake{type} / Stub{type}）； 未登记类型由
      boundary_matches_contracts WARN 披露。
    severity: BLOCKER
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_use_case:
        for_each_boundary:
          expect_in_ut_file_any_of:
            - new\s+Spy{boundary.type}\(
            - new\s+Fake{boundary.type}\(
            - new\s+Stub{boundary.type}\(
  it_name_has_ac_or_branch_tag:
    description: |
      每条 it() 的用例名称以 [AC-X]、[BD-X] 或 [BRANCH-<id>] 标签起始（可组合）， 便于追溯验收标准、边界或分支。
    severity: BLOCKER
    rule:
      for_each_test_case:
        name_matches_any_of:
          - ^\[AC-[^\]]+\]
          - ^\[BD-[^\]]+\]
          - ^\[BRANCH-[^\]]+\]
  it_drives_flow:
    description: |
      每条 it() 用例应端到端驱动业务流，不是单接口断言。量化门槛：
        - 若 feature 产出了 use-cases.yaml：≥2 次 boundary 调用断言 + ≥2 处
          coordinator.state / flow.state 断言；
        - 否则：≥1 次对被测函数的调用 + ≥1 条 expect 断言（弱门槛，
          简单 feature 不强求端到端编排）。
    severity: MAJOR
    rule:
      when_use_cases_yaml_exists:
        for_each_test_case:
          min_boundary_call_assertions: 2
          min_state_assertions: 2
      when_use_cases_yaml_absent:
        for_each_test_case:
          min_function_calls: 1
          min_expect: 1
      note: >
        弱模型兜底：当 UT 存在显式 `.callLog` / `.calls` 断言 且 存在 ≥2 处 `flow.state.\w+` 或
        `<coord>.state.\w+` 访问时视为通过。
  dag_cohesion:
    description: >
      同 UseCase 的所有 DAG 的 branches[] 必须互不重叠、并集覆盖 use-cases.yaml 中除标注 device_only
      外的全部分支。
    severity: MAJOR
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_use_case:
        dag_group_by_use_case:
          branches_no_overlap: true
          branches_cover_all_non_device_only: true
  ut_testability_audit_parseable:
    description: >
      已存在的 <features_dir>/{feature}/ut/testability-audit.md 必须能完整解析； 任一 fenced
      YAML 块损坏、根节点非 mapping 或 records 非数组均 BLOCKER， 不得用另一个可解析块掩盖。
    severity: BLOCKER
  ut_mock_plan_parseable:
    description: >
      已存在的 <features_dir>/{feature}/ut/mock-plan.yaml 必须是可解析的纯 YAML
      mapping；存在但损坏时须报告 canonical 路径，不得按“文件缺失”继续判定。
    severity: BLOCKER
  ut_testability_audit_present:
    description: >
      <features_dir>/{feature}/ut/testability-audit.md 必须存在，且对 acceptance.yaml
      中每条 ut_layer ∈ {unit, both} 的 AC/BD 各有一条审计记录（acceptance_id 对齐）。
    severity: BLOCKER
    rule:
      path: <features_dir>/{feature}/ut/testability-audit.md
      records_root: records[] YAML 或 fenced ```yaml 块
      template: framework/profiles/hmos-app/skills/business-ut/templates/testability-audit-template.md
  ut_unsupported_targets_handled:
    description: >
      testability-audit.md 中 testability_level=L3 的每条记录必须 selected ∈ {option_a,
      option_b}： option_a → 定义未闭环或 unit 义务仍在时生成 spec 裁定候选，UT 不改
      acceptance、不自批降级； option_b → 当前 UT 阶段 FAIL，并生成 coding repair
      candidate；coding 完成源码可测性改造 且重走 review 后，审计应降为 L1/L2 再继续 UT。
    severity: BLOCKER
    rule:
      acceptance_device_focus: <features_dir>/{feature}/acceptance.yaml > device_focus
      option_b_disposition: backtrack_to_phase:coding
  ut_mock_plan_present:
    description: >
      当 testability-audit 存在任一 L0/L1/L2
      记录时，<features_dir>/{feature}/ut/mock-plan.yaml 必须存在且含 spies[] 或
      doubles[]；非 pure dependencies[] 须在 mock-plan 中有 target_class 条目。被测
      entry_point（Flow/Coordinator 入口）不要求写入 mock-plan。
    severity: BLOCKER
    rule:
      path: <features_dir>/{feature}/ut/mock-plan.yaml
      template: framework/profiles/hmos-app/skills/business-ut/templates/mock-plan-schema.md
  ut_mock_plan_typed:
    description: >
      mock-plan.yaml 中每个 preset 必须声明 returns.ts_expr 或 throws.ts_expr； ts_expr
      须含显式类型断言（as Type）或 new 构造调用（脚本粗校验正则， 防 ArkTS 无类型字面量）。
    severity: BLOCKER
    rule:
      scan: presets[].returns.ts_expr | presets[].throws.ts_expr
      pattern_hint: as\\s+\\w+|new\\s+\\w+\\(
  ut_mock_plan_contracts_consistent:
    description: >
      mock-plan spies[].target_class 与 methods[].name 必须与 contracts.yaml >
      interfaces[] 中对应类与方法表一致。
    severity: BLOCKER
    rule:
      contracts: <features_dir>/{feature}/contracts.yaml
  dag_spy_preset_resolvable:
    description: >
      DAG 节点（port_call_cloud / port_call_local / async_call）若声明 spy_preset， 则该
      id 必须在 mock-plan 对应类与方法下存在；未声明 spy_preset 的旧 DAG 可仅靠
      mock_data（deprecated）。
    severity: BLOCKER
    rule:
      mock_plan: <features_dir>/{feature}/ut/mock-plan.yaml
  ut_hypium_mockkit_policy:
    description: >
      UT 若从 @ohos/hypium 导入 MockKit 或 when（Hypium 全局 mock API），则 mock-plan.yaml
      必须至少有一条 strategy=mockkit（doubles[] 须显式 strategy，禁止缺省视为 mockkit），
      target_class 须在 contracts.yaml interfaces[] 中登记；UT 内 MockKit.mock /
      when(Class.method) 须与 plan 中 mockkit 边界及 methods 对齐，禁止 mock
      testability-audit entry_point 或 use-cases coordinator；使用 when(...) 时须在源码引用
      plan presets[].id。 Spy 路线的 whenXxx 属性名不触发本规则；扫描全部 @ohos/hypium import 子句。
    severity: BLOCKER
    rule:
      mock_plan: <features_dir>/{feature}/ut/mock-plan.yaml
      contracts: <features_dir>/{feature}/contracts.yaml
semantic_checks:
  state_model_completeness:
    description: >
      use-cases.yaml > state_model.phases 是否足以表达所有业务分支； 是否遗漏了 WaitingSms /
      Verifying / Persisting 等关键中间态； expected_phase_seq 与 phases 集合是否一致。
    severity: MAJOR
    ai_prompt_hint: >
      对照 spec 流程图 / plan.md 状态机 / use-cases.yaml > branches， 判断 state_model
      是否存在"多个分支共用一个过载态"或"缺必要中间态"。
  ui_bindings_completeness:
    description: >
      use-cases.yaml > ui_bindings 是否完整覆盖了 plan.md 里提到的所有
      页面/组件；每个用户可触发的交互是否都有对应的 user_actions.calls； role=progress/result
      的展示页是否正确地归类为"不产生 user_actions"。
    severity: MAJOR
    ai_prompt_hint: >
      核对 plan.md 的 UI 清单与 ui_bindings：(1) 是否有遗漏的 UI 节点； (2) 每条
      user_actions.trigger 是否有对应的 calls 指向命名函数； (3) role 分类是否正确。
  handler_reachable:
    description: >
      ui_bindings.user_actions.calls 指向的每个函数符号必须在代码中存在， 且是命名方法 / 导出函数（不能只存在于
      inline lambda）。 由 coding 的 named_business_handler 规则兜底；此处做语义二次核对，
      关注"虽然代码里有同名符号，但实际被 inline lambda 覆盖"的伪实现。
    severity: BLOCKER
    ai_prompt_hint: |
      对每个 calls 目标，检查 (1) 符号定义存在；(2) 定义体不仅是对 lambda 的转发；(3) UT 可直接 await 该符号。
  end_to_end_driving:
    description: >
      UT 中每条 it() 是否真在端到端驱动——按 use-cases.yaml > branches 的 user_sequence /
      cloud_stubs / local_stubs / expected_phase_seq / expected_port_calls /
      expected_state 做编排与断言。
    severity: BLOCKER
    ai_prompt_hint: >
      审查每条 it()：(1) 是否按 user_sequence 顺序 await 业务入口函数； (2) 是否对 Spy 的 callLog
      做序列断言；(3) 是否对 coord.state 做多阶段断言。任一否 → BLOCKER FAIL。
  branch_coverage_semantic:
    description: >
      use-cases.yaml > branches 是否涵盖 spec 所有异常场景（network / validate fail /
      persist fail / user cancel 等），而不是只列 happy + 单一失败。
    severity: MAJOR
    ai_prompt_hint: |
      对比 spec 异常场景表 与 branches，列出未覆盖的异常路径。
  device_ac_delegation:
    description: >
      acceptance.yaml 中 ut_layer in [device, both] 的 AC/BD 必须声明非空
      device_focus；device-testing 的 test-plan.md 应覆盖这些条目的 P0/P1（脚本
      acceptance_to_test_case 为 BLOCKER）。确保无 AC「两层都没人测」。
    severity: BLOCKER
    ai_prompt_hint: >
      逐条比对：device/both 的 AC/BD 是否有可执行 device_focus；test-plan 是否关联其 id；缺
      device_focus 或 plan 未覆盖 → FAIL。
  mock_reasonableness:
    description: >
      Spy 预设返回值是否与数据模型一致；错误路径的 throw/fail 是否模拟 真实错误码（VAL_ERR / SMS_ERR /
      PERSIST_ERR 等）。
    severity: MAJOR
    ai_prompt_hint: |
      检查 SpyPort 预设值与 data/model 定义是否吻合；错误码能否在 业务编排源码中找到对应 fail(code) 调用。
  test_isolation:
    description: |
      每条 UT 用例独立：beforeEach 重建 Spy 与 coordinator，不跨用例共享。
    severity: MAJOR
    ai_prompt_hint: |
      检查 describe：(1) beforeEach 是否重建；(2) 是否存在共享 let 被 跨用例修改。
  ut_constraint_cases:
    description: >
      应用域约束在本阶段的消费形态是**用例**：读 doc/extensions/knowledge/constraints/README.md
      的适用矩阵，取 ut 那一列， 逐个非「—」的格子核对——该域是否已按格子写明的用例类型产出了对应的业务级用例
      （命中该域时；未命中的写明依据）。命中判据与条目内容以该域文件为准。 判据是**用例是否真的覆盖了那个场景**，不是用例名里有没有出现该域的词。
      矩阵中标「—」的域本阶段不消费，不必为其硬造用例。
    severity: MAJOR
    ai_prompt_hint: >
      打开 doc/extensions/knowledge/constraints/README.md 找到适用矩阵，记下 ut 列所有
      非「—」的域及其用例类型。对照本 feature 的业务级用例清单逐域核对：
      该类型的场景有没有对应用例，用例的前置条件与断言是否真的落在那个场景上。 **上游阶段声明会覆盖、而用例清单里找不到对应场景的，即 FAIL**——
      声明与验证之间的缺口正是本阶段该堵的。 域文件里 `<待补充>` 的部分按 README「读条目时须知」处理：定性评估，不臆造数值。
traceability_checks:
  change_unit_feature_projection:
    description: CU-bound Feature 的复杂流必须按机械事实提供 use-case/DAG 并链接可执行验证
    severity: BLOCKER
  ut_coverage_evidence_present:
    description: >
      当 feature 存在 in-scope unit/both P0/P1 时，须产出
      <features_dir>/{feature}/ut/reports/coverage-evidence.json（business-ut
      写入，harness 不自造 mapping）。 缺失或 invalid 时 BLOCKER/FAIL；UT tag / DAG linkage
      只能作为 mapping 的底层依据， 不能替代 required 文件本身。报告须给出 canonical relative + absolute
      path。
    severity: BLOCKER
  ut_coverage_evidence_resolves:
    description: >
      in-scope unit/both P0/P1 的每条 AC/BD 须在 coverage-evidence 映射、 精确 UT
      标签/linked branch、DAG linked（含 nodes[]）或 ac-coverage.json 中可解析； AC 与 BD
      同数字后缀不得交叉覆盖。失败须列出实际 scoped UT / DAG / evidence 路径。
    severity: BLOCKER
  ut_coverage_evidence_mappings_complete:
    description: >
      当 coverage-evidence.json 存在且存在 unit/both P0/P1 范围时，mappings[] 须覆盖每条 P0/P1
      scope_id，且每条 mapping 须有与 declared evidence_source
      一致的可解析依据（非空壳行）；dag_archived 与 dag_ephemeral 不得互相冒充。
    severity: BLOCKER
  origin_tag_required:
    description: |
      flow_type=characterization 时，非 assertion 节点须带 origin 元数据。
    severity: BLOCKER
  characterization_trace_matches:
    description: |
      characterization 路径下 UT 须含 [CHAR-*] 标签；DAG trace 与 UT 序列由 verifier 复核。
    severity: MAJOR
  branch_coverage_full:
    description: >
      use-cases.yaml 中每个 UseCase 的所有 branches，UT 中必须至少有 一个 it() 对应（通过
      [BRANCH-<id>] 标签或 body 里引用 branch id 识别）。
    severity: BLOCKER
    rule:
      only_if_exists: <features_dir>/{feature}/use-cases.yaml
      for_each_use_case:
        for_each_branch:
          expect_test_case_any_of:
            - name matches \[BRANCH-{branch.id}\]
            - body contains "{branch.id}"
  ut_case_per_unit_ac:
    description: >
      acceptance.yaml 中 ut_layer in [unit, both] 且 priority in [P0, P1] 的每条
      AC/BD 必须有可解析 UT 覆盖证据。优先用精确 it() 标签/linked branch； 兼容 coverage-evidence
      所声明并由底层事实支撑的 DAG / ac-coverage 来源。 至少须有一个 scoped UT 文件，且失败详情必须列出实际检查集合。
    severity: BLOCKER
    rule:
      source: acceptance.yaml > criteria + boundaries
      filter: ut_layer in ["unit","both"] and priority in ["P0","P1"]
      target: resolvable UT evidence (tag/branch, backed mapping, DAG, ac-coverage)
      coverage: 100%
      matching:
        any_of:
          - it name matches \[AC-{ac.id}\]
          - ac is in any branch.linked_acceptance whose branch id matches an it
            tag
  acceptance_coverage:
    description: >
      P0/P1 验收标准的 DAG 追溯覆盖率：只读取已解析 DAG 顶层/nodes[] 的 linked_acceptance /
      linked_boundaries，不读取 it() 名。分母只计 ut_layer ∈ [unit, both] 的 AC；device AC 交
      device-testing 负责。
    severity: BLOCKER
    rule:
      source: acceptance.yaml > criteria
      filter: priority in ["P0","P1"] and ut_layer in ["unit","both"]
      target: parsed DAG linked_acceptance / linked_boundaries
      coverage: 100%
  dag_to_source:
    description: |
      DAG 中每个非 assertion 节点的 source.file + source.function 必须 能在实际代码中找到对应的文件和函数。
    severity: BLOCKER
    rule:
      for_each_dag_node:
        filter: type != "assertion"
        if_has: source
        checks:
          - field: source.file
            expect: file_exists
          - field: source.function
            expect: function_exists_in_file
  boundary_coverage:
    description: >
      acceptance.yaml > boundaries 中 ut_layer in [unit, both] 的每条 边界都应有对应的 UT
      用例或 use-cases.yaml > branches 条目。
    severity: MAJOR
    rule:
      source: acceptance.yaml > boundaries
      filter: ut_layer in ["unit","both"]
      target: UT it() cases OR use-cases.yaml > branches
      coverage: 100%
exploration_thresholds:
  min_files_inspected: 5
  min_source_code_paths: 3
  min_searches: 4
  min_code_facts: 3
  require_subagent_when_use_cases_gt: 2
  exploration_mode_allowed:
    - subagent
    - sequential
exploration_strategy:
  default_mode: sequential
  scoring:
    threshold: 60
    dimensions:
      - id: module_loc
        weight: 25
        tiers:
          - gte: 50000
            score: 25
          - gte: 20000
            score: 15
          - gte: 5000
            score: 8
      - id: scope_breadth
        weight: 20
        tiers:
          - gte: 3
            score: 20
          - gte: 2
            score: 12
          - gte: 1
            score: 5
      - id: cross_layer
        weight: 20
        signal: touches_multiple_outer_layers
        score_if_true: 20
      - id: new_api_surface
        weight: 15
        signal: adds_exports_or_public_api
        score_if_true: 15
      - id: dependency_fan_out
        weight: 20
        tiers:
          - gte: 10
            score: 20
          - gte: 5
            score: 12
          - gte: 2
            score: 5
  sequential_multiplier: 2
  sequential_min_files_inspected_add: 5

```

---

## 四、脚本 Harness 检查结果

以下是脚本 Harness (`check-ut.ts`) 已完成的确定性检查报告。你无需重复检查这些项目，但应参考其结果辅助语义判断：

```
{
  "phase": "ut",
  "feature": "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93",
  "timestamp": "2026-10-24T19:29:07.695Z",
  "project_root": "D:\\1.code\\SimulatedWalletForHmos",
  "assurance": "full",
  "capability_resolutions": [
    {
      "id": "capability_ut_core_context",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "fail",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
        {
          "id": "code",
          "state": "resolved",
          "selected_source": "derive.codebase",
          "selected_source_fingerprint": "ef00b999011c756a17b4c7780bb32b32e022e4767a4457aecb53bad641a73447",
          "binding": {
            "input_id": "code",
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
        },
        {
          "id": "acceptance",
          "state": "resolved",
          "selected_source": "acceptance@1",
          "selected_source_fingerprint": "d46260b73f3fe267f8652ed4c4daee09642844add4db880539924bb16ed9c02b",
          "binding": {
            "input_id": "acceptance",
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
      "id": "capability_ut_design_context",
      "axis": "functional",
      "active": true,
      "state": "resolved",
      "on_missing": "fail",
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
        }
      ]
    },
    {
      "id": "capability_ut_use_case_context",
      "axis": "evidence",
      "active": true,
      "state": "resolved",
      "on_missing": "prune",
      "applicability_provider_id": "applicability.always",
      "applicability_dependencies": [],
      "inputs": [
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
  "capability_resolution_contract_fingerprint": "cb2ad91cc24a176ed34a87e534170c535883ab43c49c387f18728b2779adeeca",
  "checks": [
    {
      "id": "ut_unsupported_targets_handled",
      "category": "structure",
      "description": "testability-audit.md 中 testability_level=L3 的每条记录必须 selected ∈ {option_a, option_b}： option_a → 定义未闭环或 unit 义务仍在时生成 spec 裁定候选，UT 不改 acceptance、不自批降级； option_b → 当前 UT 阶段 FAIL，并生成 coding repair candidate；coding 完成源码可测性改造 且重走 review 后，审计应降为 L1/L2 再继续 UT。",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "无 L3（不可测）记录，跳过 option_a/b 处置检查。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_unsupported_targets_handled"
    },
    {
      "id": "ut_hypium_mockkit_policy",
      "category": "structure",
      "description": "UT 若从 @ohos/hypium 导入 MockKit 或 when（Hypium 全局 mock API），则 mock-plan.yaml 必须至少有一条 strategy=mockkit（doubles[] 须显式 strategy，禁止缺省视为 mockkit）， target_class 须在 contracts.yaml interfaces[] 中登记；UT 内 MockKit.mock / when(Class.method) 须与 plan 中 mockkit 边界及 methods 对齐，禁止 mock testability-audit entry_point 或 use-cases coordinator；使用 when(...) 时须在源码引用 plan presets[].id。 Spy 路线的 whenXxx 属性名不触发本规则；扫描全部 @ohos/hypium import 子句。",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "本 feature 责任域内的 UT 未从 @ohos/hypium 导入 MockKit/when（或存量文件无新增 mock 用法），跳过 mock 策略门禁。\n身份基线：基线=28394b60d2d017c70c18aa01449469e0d04bf107（锚=run_base_sha）",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_hypium_mockkit_policy"
    },
    {
      "id": "it_drives_flow",
      "category": "structure",
      "description": "每条 it() 用例应端到端驱动业务流，不是单接口断言。量化门槛：\n  - 若 feature 产出了 use-cases.yaml：≥2 次 boundary 调用断言 + ≥2 处\n    coordinator.state / flow.state 断言；\n  - 否则：≥1 次对被测函数的调用 + ≥1 条 expect 断言（弱门槛，\n    简单 feature 不强求端到端编排）。",
      "severity": "MAJOR",
      "status": "WARN",
      "details": "22 个 it() 用例驱动力不足：\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[AC-14] 银行数据源返回 20 条完整记录且顺序与展开态参考图一致\" — portRefs=0 stateRefs=0 expects=4\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[AC-16] 拼音分组产出 11 块、字母升序且块内按全拼升序\" — portRefs=0 stateRefs=0 expects=5\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[AC-16][BD-7] 字母索引集合由分组结果派生，逐一相等且不含空分块字母\" — portRefs=0 stateRefs=0 expects=4\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[AC-G3][BD-1] 数据源返回空数组时列表/药丸/分组三处可见性派生量均为 0\" — portRefs=1 stateRefs=0 expects=6\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[AC-G3][BD-2] 取数异常可 await 可 catch，吞掉后降级为空态且无未捕获 rejection\" — portRefs=1 stateRefs=0 expects=5\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[BD-4] 导航栈未挂载时取栈抛出，被 try/catch 吞掉后不外抛且调用方状态不变\" — portRefs=0 stateRefs=0 expects=3\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[BD-5] logo 为空图位时行模型仍完整返回名称与点击载荷\" — portRefs=0 stateRefs=0 expects=6\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: \"[AC-14][BD-6] 数据源不读持久化介质，两次独立调用返回等价结果\" — portRefs=0 stateRefs=0 expects=4\n  - 01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets: \"[AC-6] existing and bank-opening destinations remain registered together\" — portRefs=0 stateRefs=0 expects=6\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: \"[AC-1][BD-1] opening session enforces each continue gate\" — portRefs=0 stateRefs=0 expects=9\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: \"[AC-2] card candidates are filtered while only the rendered number is masked\" — portRefs=0 stateRefs=0 expects=5\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: \"[AC-3][BD-2] OTP starts once, blocks resend, resets at zero and accepts six digits\" — portRefs=3 stateRefs=0 expects=11\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: \"[BD-4] cancelling sheet state clears selection, OTP and timers without persistence\" — portRefs=1 stateRefs=0 expects=6\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: \"[AC-4] completion context exposes the full number once and then clears it\" — portRefs=0 stateRefs=0 expects=2\n  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: \"[AC-4] repository commits all stored fields and treats a repeated number as success\" — portRefs=2 stateRefs=0 expects=10\n  ... 还有 7 项",
      "affected_files": [
        "02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets",
        "01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets",
        "02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets"
      ],
      "suggestion": "数量是本 WARN 的触发线索，不是判据；请确认该 it() 覆盖了命名入口驱动、调用序列与状态迁移（纯函数/单规则用例只需保证错误实现会让它失败并覆盖边界/异常）。",
      "source": "it_drives_flow"
    },
    {
      "id": "origin_tag_required",
      "category": "traceability",
      "description": "flow_type=characterization 时，非 assertion 节点须带 origin 元数据。",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "无 flow_type=characterization 的 DAG，跳过。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "origin_tag_required"
    },
    {
      "id": "characterization_trace_matches",
      "category": "traceability",
      "description": "characterization 路径下 UT 须含 [CHAR-*] 标签；DAG trace 与 UT 序列由 verifier 复核。",
      "severity": "MAJOR",
      "status": "SKIP",
      "details": "无 characterization flow，跳过。",
      "source": "characterization_trace_matches"
    }
  ],
  "summary": {
    "total": 62,
    "pass": 57,
    "fail": 0,
    "warn": 1,
    "skip": 4,
    "blockers": 0,
    "verdict": "PASS"
  },
  "passed_check_ids": [
    "node_options_injection",
    "change_unit_feature_projection",
    "dag_files_parseable",
    "ut_testability_audit_parseable",
    "context_exploration_facts_phase_delta_present",
    "upstream_verdict_gate",
    "acceptance_yaml_present",
    "acceptance_content_complete",
    "acceptance_ut_layer_complete",
    "acceptance_device_focus_present",
    "legacy_device_testing_todo_deprecated",
    "harness_host_artifact_pollution",
    "usecase_spec_recommended",
    "usecase_spec_schema",
    "usecase_ui_bindings_nonempty",
    "boundary_matches_contracts",
    "named_business_handler",
    "ut_testability_audit_present",
    "ut_mock_plan_parseable",
    "ut_mock_plan_present",
    "ut_mock_plan_typed",
    "ut_mock_plan_contracts_consistent",
    "dag_schema_compliance",
    "dag_node_type_valid",
    "dag_acyclic",
    "dag_source_file_exists",
    "dag_linked_usecase",
    "dag_boundary_matches_spec",
    "dag_assertion_linked_branch",
    "dag_cohesion",
    "dag_spy_preset_resolvable",
    "ut_file_naming",
    "ut_framework_import",
    "ut_assertion_exists",
    "ut_tsc_compiles",
    "ut_hvigor_build",
    "ut_hvigor_test",
    "ut_no_src_mutation",
    "mock_stub_for_async",
    "test_registration",
    "ut_import_whitelist",
    "boundaries_all_stubbed",
    "it_name_has_ac_or_branch_tag",
    "dag_to_acceptance",
    "acceptance_coverage",
    "dag_to_source",
    "ut_coverage_evidence_present",
    "ut_coverage_evidence_mappings_complete",
    "ut_coverage_evidence_resolves",
    "branch_coverage_full",
    "ut_case_per_unit_ac",
    "boundary_coverage",
    "ut_ac_coverage_report_written",
    "ut_run_status",
    "capability_ut_core_context",
    "capability_ut_design_context",
    "capability_ut_use_case_context"
  ]
}
```

---

## 五、语义检查项（你的核心任务）

请逐一完成以下 **11** 项 v2.1/v2.3 语义检查。每项都有具体的评估方法和判定标准。

### 检查 1: state_model 完备性 (state_model_completeness)

- **严重等级**: MAJOR
- **前置**：若 `doc/features/cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93/use-cases.yaml` 不存在，整项 SKIP（本 feature 不满足复杂度阈值即可豁免）
- **评估方法**:
  1. 读取每个 UseCase 的 `state_model.phases` 与 `state_model.fields`
  2. 对比 spec.md / plan.md 中的流程图与状态机描述
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
  1. 列出 spec.md / plan.md 中涉及本 use_case 的**所有 UI 节点**（页面、弹窗、组件），对比 `ui_bindings[]`：
     - 每个参与此业务流程的 UI 是否都有条目（`role` 是否合理标注 entry/progress/dialog/result/passive）
     - `subscribes` 是否与 `state_model.phases` / `state_model.fields` 对齐（不应订阅不存在的字段）
  2. 检查是否存在**应有未有的 UI 绑定**：例如短验弹框肯定需要 `confirmSms` 这类入口
  3. `data_boundaries` 是否覆盖业务流涉及的所有外部依赖（云端 / 本地持久化 / 系统服务）；是否混入了不属于数据边界的东西（UI、路由、toast 不应进入 data_boundaries）

- **输出**：ui_bindings 完整度评分 + 缺失/冗余条目

### 检查 3: 业务入口可达性 (handler_reachable)

- **严重等级**: MAJOR
- **前置**：若 `use-cases.yaml` 不存在，整项 SKIP
- **评估方法**（与 `named_business_handler` 脚本检查互补 — 脚本只验"符号是否存在"，你验"语义是否合理"）:
  1. 对 `ui_bindings[].user_actions[].calls` 每个目标：
     - 命名是否表达业务意图（如 `chooseCard` / `confirmSms`），而非 `onClick1` / `handler2` / `btnAction` 之类空词
     - 对应代码里该命名函数是否实际承载业务逻辑（而非仅是一层转发：`chooseCard() { this.a = 1 }` 没有任何外部副作用也是不可测的）
     - UT 侧是否真的在调用它（grep UT 文件 → 若从未被任何 `it()` 直接 `await`/调用，该入口形同虚设）
  2. 对 `coordinator` 字段指向的符号：
     - 若是类名（如 `TaskSubmitFlow`），该类是否在 `coordinator_file`（若声明）或其他合理位置真实存在
     - 若是 `Page.method` 路径，对应 Page 里是否存在该命名方法
     - 若是导出函数名，是否在任何 `export function {name}` / `export const {name} =` 中可见
  3. 反模式检查：
     - 业务逻辑大部分仍写在 `.onClick(async () => { ... })` 里，`ui_bindings.user_actions.calls` 只指向一层转发壳 — FAIL
     - `calls` 指向 Repository/Api 方法（越过 coordinator 直接调 data 层）— FAIL，业务编排被旁路
  4. 判定逻辑：
     - 所有 `calls` 都命名合理、真实存在、且承载了业务逻辑 → PASS
     - 存在空词命名 / 转发壳 / 被旁路 → FAIL
     - 信息不足 → WARN

- **输出**：逐条 calls 的可达性评估 + 空壳 / 旁路清单

### 检查 4: 端到端驱动真实性 (end_to_end_driving) 【BLOCKER】

- **严重等级**: **BLOCKER**
- **评估方法**:
- **适用范围（先判用例形态，再套下面第 1 条的三项）**：
  - **流程类用例** = 驱动 coordinator / 涉及 data_boundary 替身 / 有阶段状态迁移。第 1 条三项**逐字适用**，判定逻辑不变。
  - **纯函数 / 单规则用例** = 无 data_boundary 替身、无多阶段状态迁移。它既没有替身可断言调用序列，也没有中间态可断——第 1 条的「callLog / 调用序列断言」与「状态多阶段断言」两项按**不适用**处理（不是"不成立"，不判 FAIL），只要求：该 `it` 若被错误实现会失败 + 覆盖了该规则的边界/异常。
  - 形态由**被测对象**决定（有替身/有阶段就是流程类），verifier 按代码判，**不接受**"我说它是纯函数"。
  1. 对每个 `it()` 用例，检查下面三项是否同时成立（后两项按上面的适用范围）：
     - **命名入口驱动**：用例通过调用 `ui_bindings.user_actions.calls` 声明的命名函数（或 `coordinator` 的方法）驱动业务，而不是直接构造一个数据对象、绕过业务编排检查 Repository
     - **callLog / 调用序列断言**：对 data_boundary 替身（`SpyXxx` / `FakeXxx` / `StubXxx` / 原型替换）的 `callLog` 或 `called*` 计数断言至少出现 1 次
     - **状态多阶段断言**：对业务状态字段（`phase` / `errorCode` / 业务 model 的关键字段）做 `expect` 至少 2 次，且覆盖**中间态与终态**
  2. 对比对应 branch 的 `expected_phase_sequence` 与 `expected_port_calls` / `not_called`：UT 的断言是否与之一致
  3. 若 `use-cases.yaml` 不存在：退化判定——用例必须至少调用一个**真实业务函数**（而非仅 `expect(repo.getX().length).assertLargerThan(0)` 的单数据接口断言）
  4. 判定逻辑：
     - **适用的**各项全部成立 → PASS
     - **适用的**任一项不成立 → FAIL（BLOCKER）
     - 信息不足 → WARN

- **反例**：`expect((await cardRepo.getCardList()).length).assertLargerThan(0)`（未驱动 coordinator/命名函数，单数据接口断言）→ FAIL

### 检查 4B: 业务价值断言密度 (business_assertion_value) 【BLOCKER】

- **严重等级**: **BLOCKER**
- **评估方法**:
  1. 每个 `it()` 必须能说明它验证了哪条业务规则，而不是只验证"函数能返回"或"数组非空"。
  2. happy path 至少包含三类断言中的两类：返回值 / 状态迁移 / data_boundary 调用序列 / 持久化结果。**适用范围**：本项只对**流程类用例**（驱动 coordinator / 涉及 data_boundary 替身 / 有阶段状态迁移）要求；**纯函数 / 单规则用例**不作此要求（它只有返回值一类可断言），判据回到第 1 项与下面第 5 项。
  3. 异常 path 必须断言错误状态、错误码、回滚行为或 `not_called`，不能只断言"不会 crash"。
  4. Spy/Stub 的预设值必须与业务场景相关；重复的 mock 值但不同 `it()` 名称不算有效分支覆盖。
  5. 判据是**该 `it` 若被错误实现会不会失败**，以及**是否覆盖了该规则的边界/异常**——不是断言条数。用单条精确断言完整验证一个纯函数是**合法形态**，不得因此判 FAIL；反之，堆三条 `assertLargerThan(0)` 却对错误实现照样通过的空壳用例仍判 FAIL。「只测 repository 静态数据结构而 acceptance 要求业务流程」这一支**保留**（它判的是测错了对象，不是数量），判定 FAIL。

- **输出**：逐个 `it()` 标注业务规则、断言类型数量、是否覆盖异常语义。

### 检查 4C: mock-plan 与 DAG/UT 对齐（mock_plan_traceability）【v2.3】

- **严重等级**: **BLOCKER**（当 `doc/features/cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93/ut/mock-plan.yaml` 存在且 feature 含 L0/L1/L2 可测项时）
- **前置**：若 mock-plan 不存在且 harness 对 `ut_mock_plan_present` 为 SKIP，则本项 SKIP
- **评估方法**:
  1. 阅读 `ut/mock-plan.yaml`：每个 `presets[].id` 是否在业务上有明确含义（success / 各类失败 / 边界值）
  2. 对每条 DAG（尤其 `port_call_*` / `async_call`）：若节点含 `spy_preset`，preset 是否能覆盖该分支在 spec / acceptance 上需要的 happy + 关键失败（与 mock-plan 对照）
  3. 阅读 UT：切换分支时是否使用 mock-plan 宣言的 preset（或等价命名的 `whenXxx`），**避免**在 `it()` 内重新手写与 mock-plan `ts_expr` 不一致的大段字面量
  4. 若 mock-plan 有 preset 但 DAG/UT 从未引用对应依赖方法 → WARN 或 FAIL（视是否造成覆盖缺口）
  5. **新 DAG** 须在 `port_call_*` / `async_call` 上优先声明 `spy_preset` 引用 mock-plan；`mock_data` 仅过渡期兼容，新 feature **禁止**再往 DAG 堆无类型字面量（与 `mock-plan-schema.md` / `dag-schema.md` 一致）。
- **输出**：preset ↔ 分支 ↔ `it()` 映射表；缺口清单

### 检查 5: branch 语义覆盖 (branch_coverage_semantic)

- **严重等级**: MAJOR
- **前置**：若 `use-cases.yaml` 不存在，整项 SKIP
- **评估方法**:
  1. 阅读 spec.md 中的"异常场景"清单，或 plan.md 的 Mermaid 状态机
  2. 列出所有应测异常：`network_failure` / `validate_fail` / `auth_fail` / `sms_fail` / `persist_fail` / `user_cancel` / `timeout` / `insufficient_resource` 等
  3. 对比 `use-cases.yaml > branches[]` 是否覆盖了这些异常：
     - 覆盖 → 记录已覆盖分支
     - 遗漏 → 列出 gap，建议新增 branch id 与 linked_acceptance
  4. 还要检查 happy_path 是否唯一（是否有重复分支只是 mock 值不同）

- **输出**：已覆盖/遗漏异常表 + 建议新增 branches

### 检查 6: device AC 委派一致性 (device_ac_delegation)

- **严重等级**: BLOCKER
- **评估方法**:
  1. 找到 `acceptance.yaml` 中所有 `ut_layer ∈ {device, both}` 的 AC/BD
  2. 每条须声明非空、可执行的 `device_focus`（both 还须拆分 `ut_focus`）
  3. 若缺 `device_focus` → FAIL 并给出补写示例
  4. 检查 `both` AC：UT 是否覆盖业务语义；`device_focus` 是否覆盖 UI 层
  5. 参考 DAG `ui_subscription` 是否与 `device_focus` 一致
  6. legacy `device-testing-todo.md` 若仍存在 → WARN 建议删除（非 SSOT）

- **输出**：缺失 device_focus 列表 + 补写片段

### 检查 7: 打桩合理性 (stub_reasonableness) 【替代旧的 mock_reasonableness】

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

### 检查 8: 测试隔离性 (test_isolation)

- **严重等级**: MAJOR
- **评估方法**:
  1. 检查每个 `describe` 块：
     - `beforeEach` 中是否重建 **替身 + 待测业务入口所需的上下文**（v2 强约束：每条 it() 必须独立）
     - 是否存在模块级共享的可变变量被跨用例修改（如 `const storage = new SpyStorage()` 放在 describe 外）
  2. 检查测试用例间是否存在隐式依赖：用例 B 的 Arrange 是否依赖用例 A 的 side effect
  3. 评估用例能否以任意顺序运行而结果一致
  4. 若使用原型方法替换方案，验证 `afterEach` 是否还原，避免污染后续用例

- **输出**：隔离性问题清单

### 检查 R: 跨产物引用核对 (reference_crosscheck)

- **严重等级**: MAJOR
- **评估方法**: 逐条核对本阶段产物里的跨文件引用——测试用例引用的 use-case / AC 编号、mock 名称、DAG 节点 ↔ use-cases.yaml / acceptance.yaml / mock-plan / 源码符号。每条引用都要打开被引用的原文核对，不凭记忆、不凭上下文摘要。
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

### framework/profiles/hmos-app/skills/business-ut/profile-addendum.md

```
# `hmos-app` · Skill `business-ut` profile addendum

## 权威资产清单

| 维度 | 说明 |
|------|------|
| Hypium 与目录 | UT 运行于 `**/src/ohosTest/ets/test/**/*.test.ets`；`List.test.ets` 常作套件注册入口 |
| 模板与样例 | 键见机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml` 的 `business-ut` 段（如 `ut_template`、`sample_flow_dir`）；根 SKILL 用 `` `profile-skill-asset:business-ut/<键>` `` 引用 |
| Harness | `ut.compile` / `ut.run` 驱动 hvigor + hdc；可被 profile **SKIP**（如 `generic`） |
| 依赖 | `oh-package.json5` 声明 `@ohos/hypium` 等 |

## Context Exploration Gate（profile 补充）

实际写/跑 UT 前须读业务入口、**`**/src/ohosTest/ets/test/`** 下拟扩展的测试文件、**套件注册入口**（如 `List.test.ets`）及 **`oh-package.json5`** 的测试依赖。独立请求先消费 prepare 的落点与载体结果；正式调用再读本次绑定的 Spec/契约。只有本次需要 Spy/mock-plan 时才记录其路径，facts 使用入口返回的真实位置；只设计测试不要求创建这些产物。

**禁止反改业务架构**：不要为了 UT 新造 `domain/usecase/*.ets` 或 Port；业务嵌在 inline lambda 中时，反馈 coding 抽出命名方法。

## UT 写入路径（BLOCKER）

| ✅ 正确（相对 `<repo-root>`） | ❌ 错误 |
|------------------------------|--------|
| `02-Feature/Demo/src/ohosTest/ets/test/foo.test.ets` | `framework/harness/02-Feature/Demo/src/ohosTest/...` |
| `02-Feature/Demo/test/dag/flow.dag.yaml` | `framework/harness/02-Feature/Demo/test/dag/...` |
| `02-Feature/Demo/src/ohosTest/ets/test/spy/SpyX.ets` | 任意 Write 到 `framework/harness/` 下宿主 module 树 |

正式路径取自 `contracts.yaml > modules[].package_path`，独立请求取自 prepare/target probe 的配置模块与授权测试目标。`cd framework/harness && harness-runner` 后 Write 前须 `cd <repo-root>`（见 `harness-cli-cwd.md` §2.5）。门禁：`harness_host_artifact_pollution`。

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.business-ut` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:business-ut/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

### 示例（仅在 hmos-app 下）

与根 SKILL 交付摘要示例一致时，可采用如下示意（真实 feature 以仓库为准）：

| UseCase | branches 数 | UT 文件 | DAG 数 |
|---------|-------------|---------|--------|
| task_submission | 6 | `sample_flow.test.ets` | 1 |

| 文件 | 测试函数 | 用例数 |
|------|----------|--------|
| `sample_flow.test.ets` | `taskSubmitFlowTest` | 6 |

## `ut_import_whitelist` 禁止符号（与 `framework/profiles/hmos-app/harness/ut-ui-import-ban.ts` 对齐）

UT 源码中不得出现（含 import 行与部分函数体扫描）的典型模式包括：

`@Component` / `@Entry` / `@Preview` / `struct` / `NavPathStack` / `NavDestination` / `showToast` / `$r(` / `$rawfile(` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics` 等 —— **完整列表以 profile  harness 模块为准**，脚本由 `check-ut.ts` 动态加载。

```

### doc/features/bc-openCard-2/bank-card-opening-flow/ut/testability-audit.md

```
# 银行卡开卡业务级 UT 可测性预检

```yaml
schema_version: "1.0"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
records:
  - acceptance_id: AC-1
    entry_point: { symbol: BankCardOpeningSession, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: AC-2
    entry_point: { symbol: BankRepository.getCards|BankCardOpeningService.maskCardNumber, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankRepository, kind: pure, seam: none }, { name: BankCardOpeningService, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: AC-3
    entry_point: { symbol: OtpVerificationState, file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets }
    testability_level: L1
    dependencies: [{ name: OtpService, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: AC-4
    entry_point: { symbol: BankCardOpeningService.begin|loadCandidates|startOtp|completeOpening, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L1
    dependencies: [{ name: BankRepository, kind: di_injectable, seam: constructor_injection }, { name: OtpService, kind: di_injectable, seam: constructor_injection }, { name: BankCardRepository, kind: di_injectable, seam: constructor_injection }]
    verdict: testable
  - acceptance_id: AC-6
    entry_point: { symbol: walletDestinationNames|isWalletDestination, file: 01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets }
    testability_level: L0
    dependencies: [{ name: WalletDestinationRegistry, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: BD-1
    entry_point: { symbol: BankCardOpeningSession.canOpenOtp|canSubmit, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: BD-2
    entry_point: { symbol: OtpVerificationState.resend|tick, file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets }
    testability_level: L1
    dependencies: [{ name: OtpService, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: BD-3
    entry_point: { symbol: BankCardRepository.save|BankCardOpeningService.saveCandidate, file: 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets }
    testability_level: L1
    dependencies: [{ name: BankCardRepository, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: BD-4
    entry_point: { symbol: BankCardOpeningSession.cancel|OtpVerificationState.cancel, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L1
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }, { name: OtpVerificationState, kind: pure, seam: none }]
    verdict: testable
```

## 已闭环问题

UT-004 已由 coding 返修并经 review 收口：`02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:31` 提供构造注入，`:42` 起提供候选、OTP 与选择阶段入口，`:143` 的 `completeOpening` 暴露保存期与结果态。UT 现可驱动 `ENTRY→TYPE_SELECTED→CARD_SELECTED→OTP_ACTIVE→SAVING→RESULT`；真实结果页导航按 AC-5 的 device 层验证，不在 UT 伪造 ArkUI 栈。

问题文件存在但没有可读取的问题表行。使用 ## 问题清单 与列 ID | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议；问题描述须含当前可读证据 `项目相对路径:行号`，涉及文件填真正修复对象。coding-upstream-issues@1 不接受纯叙述替代表格。
```

### (knowledge navigation)

```
## Knowledge inputs

动笔前读取适用原文；索引/候选不是事实确认或已读证明。维护写入须沿原授权与时点，不在 run 内擅自刷新图谱。

- `doc/module-catalog.yaml` — 模块职责、反例与易混项；完整索引可继续探索
- `doc/glossary.yaml` — 术语与 alias 候选；字面命中不替代语义消歧
- `framework/docs/README.md` — 框架背景索引，按当前任务跟随相关原始链接
- `framework/profiles/hmos-app/skills/README.md` — 当前 profile 知识与 Skill 资产协议
- `framework/profiles/hmos-app/skills/business-ut/profile-addendum.md` — 执行 business-ut 前阅读当前 profile 补充
- `02-Feature/WalletMain/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 02-Feature/WalletMain（文件缺失 / 未启用；不声称已消费）
- `04-BusinessBase/AccountManager/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 04-BusinessBase/AccountManager（文件缺失 / 未启用；不声称已消费）
- `01-Product/Phone/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 01-Product/Phone（文件缺失 / 未启用；不声称已消费）
- 02-Feature/WalletMain/code-graph.yaml 不存在；回源码探索 02-Feature/WalletMain，不自动建图。
- 04-BusinessBase/AccountManager/code-graph.yaml 不存在；回源码探索 04-BusinessBase/AccountManager，不自动建图。
- 01-Product/Phone/code-graph.yaml 不存在；回源码探索 01-Product/Phone，不自动建图。
- 无术语字面候选不代表无适用知识；继续读取完整索引并语义消歧。
```

### (resolved input code)

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

### (resolved input acceptance)

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

### (resolved input test_targets)

```
- path: 01-Product/Phone/src/ohosTest/ets/test/List.test.ets
  content: >
    import abilityTest from './Ability.test';

    import walletDestinationRegistryTest from
    './WalletDestinationRegistry.test';


    export default function testsuite() {
      abilityTest();
      walletDestinationRegistryTest();
    }
- path: 01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets
  content: >
    import { describe, it, expect } from '@ohos/hypium';

    import {
      isWalletDestination,
      walletDestinationNames
    } from '../../../main/ets/navigation/WalletDestinationRegistry';


    export default function walletDestinationRegistryTest(): void {
      describe('wallet destination registry', () => {
        it('[AC-6] existing and bank-opening destinations remain registered together', 0, () => {
          const names: string[] = walletDestinationNames();
          expect(names.indexOf('AddCardEntryPage') >= 0).assertTrue();
          expect(names.indexOf('AddBankCardPage') >= 0).assertTrue();
          expect(names.indexOf('AllBanksPage') >= 0).assertTrue();
          expect(names.indexOf('BankCardSelectionPage') >= 0).assertTrue();
          expect(names.indexOf('BankCardOpeningResultPage') >= 0).assertTrue();
          expect(isWalletDestination('UnknownDestination')).assertFalse();
        });
      });
    }
- path: 02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets
  content: |
    import homePageUtTest from './home_page_ut.test';
    import bankOpenCardUtTest from './bank_open_card_ut.test';
    import bankListLegacyUtTest from './bank_list_legacy_ut.test';

    export default function testsuite() {
      homePageUtTest();
      bankOpenCardUtTest();
      bankListLegacyUtTest();
    }
- path: 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets
  content: >
    import { describe, it, expect, beforeEach } from '@ohos/hypium';

    import { NavPathContext } from '@aspect/CommFunc';

    import { BankInfo } from '../../../main/ets/data/model/BankInfo';

    import { BankGroup } from '../../../main/ets/data/model/BankGroup';

    import { BankRepository } from
    '../../../main/ets/data/repository/BankRepository';

    import { BankGroupService } from
    '../../../main/ets/domain/service/BankGroupService';

    import { BankConstants } from
    '../../../main/ets/shared/constant/BankConstants';

    import { SpyBankRepository } from './spy/SpyBankRepository';


    const EXPECTED_CODES: string =
      'cmb,icbc,citic,hxb,ccb,abc,bocom,psbc,spdb,cmbc,pab,cgb,cib,bosh,bobj,bonj,bonb,bogz,ceb,boc';
    const EXPECTED_NAMES: string =
      '招商银行,工商银行,中信银行,华夏银行,建设银行,农业银行,交通银行,邮储银行,浦发银行,民生银行,' +
      '平安银行,广发银行,兴业银行,上海银行,北京银行,南京银行,宁波银行,广州银行,光大银行,中国银行';

    /** 收起态可用高的参考值（vp）；只用于驱动派生算术，不代表真机量测 */

    const REF_AVAILABLE_HEIGHT_VP: number = 560;


    export default function bankListLegacyUtTest(): void {
      describe('bank open card unit', () => {
        let repo: BankRepository;
        let spyRepo: SpyBankRepository;

        beforeEach((): void => {
          repo = new BankRepository();
          spyRepo = new SpyBankRepository();
        });

        it('[AC-14] 银行数据源返回 20 条完整记录且顺序与展开态参考图一致', 0, async () => {
          const banks: BankInfo[] = await repo.getBanks();
          expect(banks.length).assertEqual(20);
          expect(banks.map((b: BankInfo) => b.code).join(',')).assertEqual(EXPECTED_CODES);
          expect(banks.map((b: BankInfo) => b.name).join(',')).assertEqual(EXPECTED_NAMES);

          let complete: number = 0;
          for (const bank of banks) {
            const ok: boolean = bank.code.length > 0 && bank.name.length > 0 &&
              bank.pinyin.length > 0 && bank.initial.length === 1 && bank.logo !== undefined;
            if (ok) {
              complete++;
            }
          }
          expect(complete).assertEqual(20);
        });

        it('[AC-16] 拼音分组产出 11 块、字母升序且块内按全拼升序', 0, async () => {
          const banks: BankInfo[] = await repo.getBanks();
          const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
          expect(groups.length).assertEqual(11);
          expect(groups.map((g: BankGroup) => g.letter).join('')).assertEqual('BGHJMNPSXYZ');
          expect(groups.map((g: BankGroup) => g.banks.length).join(',')).assertEqual('1,4,1,2,1,3,2,1,1,1,3');
          expect(groups[1].banks.map((b: BankInfo) => b.name).join(','))
            .assertEqual('工商银行,光大银行,广发银行,广州银行');
          expect(groups[10].banks.map((b: BankInfo) => b.pinyin).join(','))
            .assertEqual('zhaoshang,zhongguo,zhongxin');
        });

        it('[AC-16][BD-7] 字母索引集合由分组结果派生，逐一相等且不含空分块字母', 0, async () => {
          const banks: BankInfo[] = await repo.getBanks();
          const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
          const letters: string[] = BankGroupService.collectIndexLetters(groups);
          expect(letters.length).assertEqual(11);
          expect(letters.join('')).assertEqual(groups.map((g: BankGroup) => g.letter).join(''));
          expect(letters.indexOf('A')).assertEqual(-1);
          expect(BankGroupService.collectIndexLetters([]).length).assertEqual(0);
        });

        it('[AC-G3][BD-1] 数据源返回空数组时列表/药丸/分组三处可见性派生量均为 0', 0, async () => {
          spyRepo.useEmpty();
          let banks: BankInfo[] = [];
          let loadFailed: boolean = false;
          try {
            banks = await spyRepo.getBanks();
          } catch (err) {
            banks = [];
            loadFailed = true;
          }
          expect(banks.length).assertEqual(0);
          expect(loadFailed).assertFalse();

          const visibleRows: number = BankGroupService.calcVisibleRowCount(
            REF_AVAILABLE_HEIGHT_VP,
            BankConstants.ROW_HEIGHT_VP,
            BankConstants.PILL_BLOCK_HEIGHT_VP,
            banks.length
          );
          expect(visibleRows).assertEqual(0);
          expect(BankGroupService.calcPillIconCount(banks.length, visibleRows, BankConstants.MAX_PILL_ICONS))
            .assertEqual(0);
          expect(BankGroupService.groupByInitial(banks).length).assertEqual(0);
          expect(spyRepo.callLog.join(',')).assertEqual('getBanks');
        });

        it('[AC-G3][BD-2] 取数异常可 await 可 catch，吞掉后降级为空态且无未捕获 rejection', 0, async () => {
          spyRepo.useLoadError();
          let banks: BankInfo[] = [];
          let caught: boolean = false;
          try {
            banks = await spyRepo.getBanks();
          } catch (err) {
            banks = [];
            caught = true;
          }
          expect(caught).assertTrue();
          expect(banks.length).assertEqual(0);

          const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
          expect(groups.length).assertEqual(0);
          expect(BankGroupService.collectIndexLetters(groups).length).assertEqual(0);
          expect(spyRepo.callLog.length).assertEqual(1);
        });

        it('[BD-4] 导航栈未挂载时取栈抛出，被 try/catch 吞掉后不外抛且调用方状态不变', 0, () => {
          let navState: string = 'idle';
          let caught: boolean = false;
          let message: string = '';
          try {
            NavPathContext.stack();
            navState = 'navigated';
          } catch (err) {
            caught = true;
            message = (err as Error).message;
          }
          expect(caught).assertTrue();
          expect(navState).assertEqual('idle');
          expect(message.length > 0).assertTrue();
        });

        it('[BD-5] logo 为空图位时行模型仍完整返回名称与点击载荷', 0, async () => {
          spyRepo.useLogoMissing();
          const banks: BankInfo[] = await spyRepo.getBanks();
          expect(banks.length).assertEqual(1);

          const row: BankInfo = banks[0];
          expect(row.name).assertEqual('测试银行');
          expect(row.code).assertEqual('test');
          expect(row.logo.id).assertEqual(0);

          // 行仍进入分组结果 —— 即在两个列表页面仍可见、仍带完整点击载荷
          const groups: BankGroup[] = BankGroupService.groupByInitial(banks);
          expect(groups.length).assertEqual(1);
          expect(groups[0].banks[0].name).assertEqual('测试银行');
        });

        it('[AC-14][BD-6] 数据源不读持久化介质，两次独立调用返回等价结果', 0, async () => {
          const first: BankInfo[] = await repo.getBanks();
          const second: BankInfo[] = await new BankRepository().getBanks();
          expect(second.length).assertEqual(first.length);
          expect(second.map((b: BankInfo) => b.code).join(',')).assertEqual(EXPECTED_CODES);
          expect(second.map((b: BankInfo) => b.pinyin).join(','))
            .assertEqual(first.map((b: BankInfo) => b.pinyin).join(','));
          expect(second.map((b: BankInfo) => b.initial).join(''))
            .assertEqual(first.map((b: BankInfo) => b.initial).join(''));
        });
      });
    }
- path: 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets
  content: >
    import { describe, it, expect } from '@ohos/hypium';

    import { BankCardCandidate, BankCardType } from
    '../../../main/ets/data/model/BankCardCandidate';

    import { BankOpeningCompletionContext } from
    '../../../main/ets/data/model/BankOpeningCompletionContext';

    import { StoredCard } from '../../../main/ets/data/model/StoredCard';

    import { BankCardRepository } from
    '../../../main/ets/data/repository/BankCardRepository';

    import { BankRepository } from
    '../../../main/ets/data/repository/BankRepository';

    import {
      BankCardOpeningService,
      BankCardOpeningPhase,
      BankCardOpeningSession
    } from '../../../main/ets/domain/service/BankCardOpeningService';

    import { OtpVerificationState } from
    '../../../main/ets/domain/service/OtpService';

    import {
      SpyBankCardRepository,
      SpyBankCardStore,
      SpyOpeningBankRepository,
      SpyOtpService
    } from './spy/SpyBankCardOpeningDependencies';


    const FULL_CARD_NUMBER: string = '6225888888881234';

    const MOBILE: string = '13800138000';


    function candidate(): BankCardCandidate {
      return {
        bankCode: 'cmb',
        bankName: '招商银行',
        cardNumber: FULL_CARD_NUMBER,
        cardType: BankCardType.DEBIT
      };
    }


    export function bank_card_opening_flow(): void {
      describe('bank card opening flow', () => {
        it('[AC-1][BD-1] opening session enforces each continue gate', 0, () => {
          const session: BankCardOpeningSession = new BankCardOpeningSession();
          session.begin('cmb');
          expect(session.selectionParams() === null).assertTrue();
          expect(session.canOpenOtp()).assertFalse();

          session.selectCardType(BankCardType.DEBIT);
          const params = session.selectionParams();
          expect(params !== null).assertTrue();
          if (params !== null) {
            expect(params.bankCode).assertEqual('cmb');
            expect(params.cardType).assertEqual(BankCardType.DEBIT);
          }

          session.selectCandidate(candidate());
          expect(session.canOpenOtp()).assertFalse();
          session.setAgreementAccepted(true);
          expect(session.canOpenOtp()).assertTrue();
          session.setOtp('12345');
          expect(session.canSubmit()).assertFalse();
          session.setOtp('123456');
          expect(session.canSubmit()).assertTrue();
        });

        it('[AC-2] card candidates are filtered while only the rendered number is masked', 0, async () => {
          const cards: BankCardCandidate[] = await new BankRepository().getCards('cmb', BankCardType.DEBIT);
          const service: BankCardOpeningService = new BankCardOpeningService();
          expect(cards.length > 0).assertTrue();
          expect(cards.length <= 2).assertTrue();
          expect(cards[0].cardNumber.length > 8).assertTrue();
          expect(service.maskCardNumber(cards[0].cardNumber)).assertEqual('6222 **** **** 0011');
          expect(cards[0].cardNumber).assertEqual('6222010000000011');
        });

        it('[AC-3][BD-2] OTP starts once, blocks resend, resets at zero and accepts six digits', 0, async () => {
          const otpService: SpyOtpService = new SpyOtpService();
          const state: OtpVerificationState = new OtpVerificationState(otpService, 60);
          expect(await state.start(MOBILE)).assertTrue();
          expect(state.countdownSeconds).assertEqual(60);
          expect(otpService.callLog.length).assertEqual(1);
          expect(await state.resend()).assertFalse();
          expect(otpService.callLog.length).assertEqual(1);

          for (let second: number = 0; second < 60; second++) {
            state.tick();
          }
          expect(state.countdownSeconds).assertEqual(0);
          expect(await state.resend()).assertTrue();
          expect(state.countdownSeconds).assertEqual(60);
          expect(otpService.callLog.length).assertEqual(2);
          expect(state.updateOtp('12a34567', 6)).assertEqual('123456');
          expect(state.canSubmit(6)).assertTrue();
        });
      });
    }


    export function bank_card_state_owners(): void {
      describe('bank card state owners', () => {
        it('[BD-4] cancelling sheet state clears selection, OTP and timers without persistence', 0, async () => {
          const repository: SpyBankCardRepository = new SpyBankCardRepository();
          const session: BankCardOpeningSession = new BankCardOpeningSession();
          const otpState: OtpVerificationState = new OtpVerificationState(new SpyOtpService(), 60);
          session.begin('cmb');
          session.selectCardType(BankCardType.DEBIT);
          session.selectCandidate(candidate());
          session.setAgreementAccepted(true);
          session.setOtp('123456');
          await otpState.start(MOBILE);

          session.cancel();
          otpState.cancel();
          expect(session.selectionParams() === null).assertTrue();
          expect(session.selectedCandidate() === null).assertTrue();
          expect(session.canSubmit()).assertFalse();
          expect(otpState.active).assertFalse();
          expect(otpState.countdownSeconds).assertEqual(0);
          expect(repository.callLog.length).assertEqual(0);
        });
      });
    }


    export function bank_card_result_consumers(): void {
      describe('bank card result consumers', () => {
        it('[AC-4] completion context exposes the full number once and then clears it', 0, () => {
          BankOpeningCompletionContext.clear();
          BankOpeningCompletionContext.publish(FULL_CARD_NUMBER);
          expect(BankOpeningCompletionContext.consume()).assertEqual(FULL_CARD_NUMBER);
          expect(BankOpeningCompletionContext.consume()).assertUndefined();
        });
      });
    }


    export function bank_card_persistence(): void {
      describe('bank card persistence contract', () => {
        it('[AC-4] repository commits all stored fields and treats a repeated number as success', 0, async () => {
          const service: BankCardOpeningService = new BankCardOpeningService();
          const card: StoredCard = service.toStoredCard(candidate());
          const insertStore: SpyBankCardStore = new SpyBankCardStore();
          const insertRepository: BankCardRepository = new BankCardRepository(null, insertStore);
          const inserted: StoredCard = await insertRepository.save(card);
          expect(inserted.cardNumber).assertEqual(FULL_CARD_NUMBER);
          expect(inserted.category).assertEqual('BANK_CARD');
          expect(inserted.bankName).assertEqual('招商银行');
          expect(inserted.bankCardType).assertEqual('DEBIT');
          expect(inserted.huaweiPayEnabled).assertTrue();
          expect(inserted.unionPayQuickPassEnabled).assertTrue();
          expect(inserted.transactionRecords).assertEqual('[]');
          expect(insertStore.callLog.join(',')).assertEqual('beginTransaction,findByCardNumber,insert,commit');

          const existingStore: SpyBankCardStore = new SpyBankCardStore();
          existingStore.existing = card;
          const existing: StoredCard = await new BankCardRepository(null, existingStore).save(card);
          expect(existing.cardNumber).assertEqual(FULL_CARD_NUMBER);
          expect(existingStore.callLog.join(',')).assertEqual('beginTransaction,findByCardNumber,commit');
        });
      });
    }


    export function opening_navigation_recovery(): void {
      describe('opening navigation recovery state', () => {
        it('[AC-6] an abandoned completion payload is cleared before route recovery', 0, () => {
          BankOpeningCompletionContext.publish(FULL_CARD_NUMBER);
          BankOpeningCompletionContext.clear();
          expect(BankOpeningCompletionContext.consume()).assertUndefined();
          expect(FULL_CARD_NUMBER.length).assertEqual(16);
        });
      });
    }


    export function bank_card_opening_complete(): void {
      describe('bank card opening completion', () => {
        it('[BRANCH-BR-SUCCESS][AC-4] coordinated flow loads candidates, verifies OTP and saves successfully', 0, async () => {
          const cardRepository: SpyBankCardRepository = new SpyBankCardRepository();
          const bankRepository: SpyOpeningBankRepository = new SpyOpeningBankRepository();
          const otpService: SpyOtpService = new SpyOtpService();
          const otpState: OtpVerificationState = new OtpVerificationState(otpService, 60);
          const service: BankCardOpeningService = new BankCardOpeningService(
            cardRepository,
            bankRepository,
            otpState,
            new BankCardOpeningSession()
          );
          bankRepository.cards = [candidate()];
          const phases: BankCardOpeningPhase[] = [service.phase()];

          service.begin('cmb', BankCardType.DEBIT);
          phases.push(service.phase());
          const candidates: BankCardCandidate[] = await service.loadCandidates();
          service.selectCandidate(candidates[0]);
          phases.push(service.phase());
          service.setAgreementAccepted(true);
          expect(await service.startOtp(MOBILE)).assertTrue();
          phases.push(service.phase());
          expect(service.updateOtp('123456', 6)).assertEqual('123456');
          expect(service.canSubmit(6)).assertTrue();
          const completion = service.completeOpening(6);
          phases.push(service.phase());
          const result = await completion;
          phases.push(service.phase());

          expect(phases).assertDeepEquals([
            BankCardOpeningPhase.ENTRY,
            BankCardOpeningPhase.TYPE_SELECTED,
            BankCardOpeningPhase.CARD_SELECTED,
            BankCardOpeningPhase.OTP_ACTIVE,
            BankCardOpeningPhase.SAVING,
            BankCardOpeningPhase.RESULT
          ]);
          expect(result !== null && result.success).assertTrue();
          expect(result === null ? '' : result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
          expect(bankRepository.callLog).assertDeepEquals(['getCards:cmb:DEBIT']);
          expect(otpService.callLog).assertDeepEquals([`sendMockCode:${MOBILE}`]);
          expect(cardRepository.callLog).assertDeepEquals(['save']);
          expect(cardRepository.savedCards[0].cardNumber).assertEqual(FULL_CARD_NUMBER);
        });

        it('[BRANCH-BR-FAILURE][AC-4][BD-3] coordinated flow reaches a failed result when persistence throws', 0, async () => {
          const cardRepository: SpyBankCardRepository = new SpyBankCardRepository();
          cardRepository.shouldFail = true;
          const otpService: SpyOtpService = new SpyOtpService();
          const otpState: OtpVerificationState = new OtpVerificationState(otpService, 60);
          const service: BankCardOpeningService = new BankCardOpeningService(
            cardRepository,
            new SpyOpeningBankRepository(),
            otpState,
            new BankCardOpeningSession()
          );
          const phases: BankCardOpeningPhase[] = [service.phase()];

          service.begin('cmb', BankCardType.DEBIT);
          phases.push(service.phase());
          service.selectCandidate(candidate());
          phases.push(service.phase());
          service.setAgreementAccepted(true);
          expect(await service.startOtp(MOBILE)).assertTrue();
          phases.push(service.phase());
          service.updateOtp('123456', 6);
          const completion = service.completeOpening(6);
          phases.push(service.phase());
          const result = await completion;
          phases.push(service.phase());

          expect(phases).assertDeepEquals([
            BankCardOpeningPhase.ENTRY,
            BankCardOpeningPhase.TYPE_SELECTED,
            BankCardOpeningPhase.CARD_SELECTED,
            BankCardOpeningPhase.OTP_ACTIVE,
            BankCardOpeningPhase.SAVING,
            BankCardOpeningPhase.RESULT
          ]);
          expect(result !== null && !result.success).assertTrue();
          expect(result === null ? '' : result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
          expect(result === null ? '' : result.errorMessage).assertEqual('RDB_SAVE_FAILED');
          expect(otpService.callLog).assertDeepEquals([`sendMockCode:${MOBILE}`]);
          expect(cardRepository.callLog).assertDeepEquals(['save']);
          expect(cardRepository.savedCards.length).assertEqual(0);
        });

        it('[AC-4] save success returns the full card number and persisted payload', 0, async () => {
          const repository: SpyBankCardRepository = new SpyBankCardRepository();
          const service: BankCardOpeningService = new BankCardOpeningService(repository);
          const result = await service.saveCandidate(candidate());
          expect(result.success).assertTrue();
          expect(result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
          expect(result.errorMessage).assertUndefined();
          expect(repository.callLog.join(',')).assertEqual('save');
          expect(repository.savedCards.length).assertEqual(1);
          expect(repository.savedCards[0].cardNumber).assertEqual(FULL_CARD_NUMBER);
        });

        it('[AC-4][BD-3] save failure preserves the full number in a failed result', 0, async () => {
          const repository: SpyBankCardRepository = new SpyBankCardRepository();
          repository.shouldFail = true;
          const service: BankCardOpeningService = new BankCardOpeningService(repository);
          const result = await service.saveCandidate(candidate());
          expect(result.success).assertFalse();
          expect(result.fullCardNumber).assertEqual(FULL_CARD_NUMBER);
          expect(result.errorMessage).assertEqual('RDB_SAVE_FAILED');
          expect(repository.callLog.join(',')).assertEqual('save');
          expect(repository.savedCards.length).assertEqual(0);
        });
      });
    }


    export function bank_card_rdb(): void {
      describe('bank card RDB atomicity', () => {
        it('[AC-4][BD-3] insert failure rolls back, rechecks idempotency and leaves no half write', 0, async () => {
          const store: SpyBankCardStore = new SpyBankCardStore();
          store.failInsert = true;
          const repository: BankCardRepository = new BankCardRepository(null, store);
          const card: StoredCard = new BankCardOpeningService().toStoredCard(candidate());
          let failed: boolean = false;
          try {
            await repository.save(card);
          } catch {
            failed = true;
          }
          expect(failed).assertTrue();
          expect(store.inserted).assertUndefined();
          expect(store.callLog.join(',')).assertEqual(
            'beginTransaction,findByCardNumber,insert,rollBack,findByCardNumber'
          );
        });
      });
    }


    export function opening_navigation_cleanup(): void {
      describe('opening cleanup', () => {
        it('[BD-4] reset discards the active session and permits a clean restart', 0, () => {
          const session: BankCardOpeningSession = new BankCardOpeningSession();
          session.begin('cmb');
          session.selectCardType(BankCardType.CREDIT);
          session.selectCandidate(candidate());
          session.setAgreementAccepted(true);
          session.setOtp('123456');
          expect(session.canSubmit()).assertTrue();
          session.reset();
          expect(session.selectionParams() === null).assertTrue();
          expect(session.selectedCandidate() === null).assertTrue();
          expect(session.canOpenOtp()).assertFalse();
          expect(session.canSubmit()).assertFalse();
        });
      });
    }


    export default function bankOpenCardUtTest(): void {
      bank_card_opening_flow();
      bank_card_state_owners();
      bank_card_result_consumers();
      bank_card_persistence();
      opening_navigation_recovery();
      bank_card_opening_complete();
      bank_card_rdb();
      opening_navigation_cleanup();
    }
- path: 02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankCardOpeningDependencies.ets
  content: >
    import { BankCardCandidate, BankCardType } from
    '../../../../main/ets/data/model/BankCardCandidate';

    import { StoredCard } from '../../../../main/ets/data/model/StoredCard';

    import {
      BankCardRepository,
      BankCardStore
    } from '../../../../main/ets/data/repository/BankCardRepository';

    import { BankRepository } from
    '../../../../main/ets/data/repository/BankRepository';

    import { OtpService } from '../../../../main/ets/domain/service/OtpService';


    export class SpyOpeningBankRepository extends BankRepository {
      callLog: string[] = [];
      cards: BankCardCandidate[] = [];

      async getCards(bankCode: string, cardType: BankCardType): Promise<BankCardCandidate[]> {
        this.callLog.push(`getCards:${bankCode}:${cardType}`);
        return this.cards;
      }
    }


    export class SpyOtpService extends OtpService {
      callLog: string[] = [];
      shouldFail: boolean = false;

      async sendMockCode(mobile: string): Promise<void> {
        this.callLog.push(`sendMockCode:${mobile}`);
        if (this.shouldFail) {
          throw new Error('mock send failed');
        }
      }
    }


    export class SpyBankCardRepository extends BankCardRepository {
      callLog: string[] = [];
      savedCards: StoredCard[] = [];
      shouldFail: boolean = false;

      constructor() {
        super(null, new SpyBankCardStore());
      }

      async save(card: StoredCard): Promise<StoredCard> {
        this.callLog.push('save');
        if (this.shouldFail) {
          throw new Error('mock save failed');
        }
        this.savedCards.push(card);
        return card;
      }

      async list(): Promise<StoredCard[]> {
        this.callLog.push('list');
        return this.savedCards;
      }
    }


    export class SpyBankCardStore implements BankCardStore {
      callLog: string[] = [];
      existing: StoredCard | undefined = undefined;
      inserted: StoredCard | undefined = undefined;
      failInsert: boolean = false;
      existingAfterRollback: StoredCard | undefined = undefined;
      private rolledBack: boolean = false;

      async beginTransaction(): Promise<void> {
        this.callLog.push('beginTransaction');
      }

      async commit(): Promise<void> {
        this.callLog.push('commit');
      }

      async rollBack(): Promise<void> {
        this.callLog.push('rollBack');
        this.rolledBack = true;
      }

      async findByCardNumber(_cardNumber: string): Promise<StoredCard | undefined> {
        this.callLog.push('findByCardNumber');
        if (this.rolledBack && this.existingAfterRollback !== undefined) {
          return this.existingAfterRollback;
        }
        return this.existing;
      }

      async insert(card: StoredCard): Promise<void> {
        this.callLog.push('insert');
        if (this.failInsert) {
          throw new Error('mock insert failed');
        }
        this.inserted = card;
      }

      async list(): Promise<StoredCard[]> {
        this.callLog.push('list');
        if (this.existing === undefined) {
          return [];
        }
        return [this.existing];
      }
    }
- path: 02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets
  content: >
    import { BankInfo } from '../../../../main/ets/data/model/BankInfo';

    import { BankCardType } from
    '../../../../main/ets/data/model/BankCardCandidate';

    import { BankRepository } from
    '../../../../main/ets/data/repository/BankRepository';


    /**
     * BankRepository 子类替身，与 doc/features/bc-openCard-1/ut/mock-plan.yaml > spies[0] 1:1。
     * 三个 preset：banks_empty / banks_load_error / banks_logo_missing。
     * Spy 内不写任何业务判断，只做 preset 回放与调用记录。
     */
    export class SpyBankRepository extends BankRepository {
      /** 调用序列追溯 */
      callLog: string[] = [];
      private preset: string = 'banks_empty';
      private payload: BankInfo[] = [];

      /** preset: banks_empty —— 返回空数组 */
      useEmpty(): void {
        this.preset = 'banks_empty';
        this.payload = [];
      }

      /** preset: banks_load_error —— 抛出取数异常 */
      useLoadError(): void {
        this.preset = 'banks_load_error';
        this.payload = [];
      }

      /** preset: banks_logo_missing —— 返回一条 logo 为空图位的记录 */
      useLogoMissing(): void {
        const item: BankInfo = {
          code: 'test',
          name: '测试银行',
          pinyin: 'ceshi',
          initial: 'C',
          logo: { bundleName: '', moduleName: '', id: 0 } as Resource,
          supportedCardTypes: [BankCardType.DEBIT, BankCardType.CREDIT]
        };
        this.preset = 'banks_logo_missing';
        this.payload = [item];
      }

      async getBanks(): Promise<BankInfo[]> {
        this.callLog.push('getBanks');
        if (this.preset === 'banks_load_error') {
          throw new Error('bank load failed');
        }
        return this.payload;
      }
    }

```

### doc/features/bc-openCard-2/bank-card-opening-flow/ut/testability-audit.md

```
# 银行卡开卡业务级 UT 可测性预检

```yaml
schema_version: "1.0"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
records:
  - acceptance_id: AC-1
    entry_point: { symbol: BankCardOpeningSession, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: AC-2
    entry_point: { symbol: BankRepository.getCards|BankCardOpeningService.maskCardNumber, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankRepository, kind: pure, seam: none }, { name: BankCardOpeningService, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: AC-3
    entry_point: { symbol: OtpVerificationState, file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets }
    testability_level: L1
    dependencies: [{ name: OtpService, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: AC-4
    entry_point: { symbol: BankCardOpeningService.begin|loadCandidates|startOtp|completeOpening, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L1
    dependencies: [{ name: BankRepository, kind: di_injectable, seam: constructor_injection }, { name: OtpService, kind: di_injectable, seam: constructor_injection }, { name: BankCardRepository, kind: di_injectable, seam: constructor_injection }]
    verdict: testable
  - acceptance_id: AC-6
    entry_point: { symbol: walletDestinationNames|isWalletDestination, file: 01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets }
    testability_level: L0
    dependencies: [{ name: WalletDestinationRegistry, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: BD-1
    entry_point: { symbol: BankCardOpeningSession.canOpenOtp|canSubmit, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L0
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }]
    verdict: testable
  - acceptance_id: BD-2
    entry_point: { symbol: OtpVerificationState.resend|tick, file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets }
    testability_level: L1
    dependencies: [{ name: OtpService, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: BD-3
    entry_point: { symbol: BankCardRepository.save|BankCardOpeningService.saveCandidate, file: 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets }
    testability_level: L1
    dependencies: [{ name: BankCardRepository, kind: di_injectable, seam: constructor }]
    verdict: testable
  - acceptance_id: BD-4
    entry_point: { symbol: BankCardOpeningSession.cancel|OtpVerificationState.cancel, file: 02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets }
    testability_level: L1
    dependencies: [{ name: BankCardOpeningSession, kind: pure, seam: none }, { name: OtpVerificationState, kind: pure, seam: none }]
    verdict: testable
```

## 已闭环问题

UT-004 已由 coding 返修并经 review 收口：`02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets:31` 提供构造注入，`:42` 起提供候选、OTP 与选择阶段入口，`:143` 的 `completeOpening` 暴露保存期与结果态。UT 现可驱动 `ENTRY→TYPE_SELECTED→CARD_SELECTED→OTP_ACTIVE→SAVING→RESULT`；真实结果页导航按 AC-5 的 device 层验证，不在 UT 伪造 ArkUI 栈。

```

### doc/features/bc-openCard-2/bank-card-opening-flow/ut/mock-plan.yaml

```
schema_version: "1.0"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
imports:
  - { symbol: BankCardCandidate, from: "02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets" }
  - { symbol: StoredCard, from: "02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets" }
spies:
  - target_class: BankRepository
    target_file: 02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets
    base_strategy: subclass
    strategy: spy
    spy_fields:
      - { name: callLog, type: "string[]", default: "[]" }
      - { name: cards, type: "BankCardCandidate[]", default: "[]" }
    methods:
      - name: getCards
        params: [{ name: bankCode, type_text: string }, { name: cardType, type_text: BankCardType }]
        return_type: { text: "Promise<BankCardCandidate[]>" }
        presets:
          - id: cards_for_selected_bank
            returns: { ts_expr: "this.cards as BankCardCandidate[]" }
  - target_class: BankCardRepository
    target_file: 02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets
    base_strategy: subclass
    strategy: spy
    spy_fields:
      - { name: callLog, type: "string[]", default: "[]" }
      - { name: savedCards, type: "StoredCard[]", default: "[]" }
    methods:
      - name: save
        params: [{ name: card, type_text: StoredCard }]
        return_type: { text: "Promise<StoredCard>" }
        presets:
          - id: save_success
            returns: { ts_expr: "params[0] as StoredCard" }
          - id: save_failure
            throws: { ts_expr: "new Error('mock save failed')" }
      - name: list
        params: []
        return_type: { text: "Promise<StoredCard[]>" }
        presets:
          - id: list_empty
            returns: { ts_expr: "[] as StoredCard[]" }
  - target_class: OtpService
    target_file: 02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets
    base_strategy: subclass
    strategy: spy
    spy_fields:
      - { name: callLog, type: "string[]", default: "[]" }
    methods:
      - name: sendMockCode
        params: [{ name: mobile, type_text: string }]
        return_type: { text: "Promise<void>" }
        presets:
          - id: otp_send_success
            returns: { ts_expr: "undefined as void" }

```

### doc/features/bc-openCard-2/bank-card-opening-flow/ut/reports/ac-coverage.json

```
{
  "schema_version": "1.0",
  "feature": "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93",
  "generated_at": "2026-10-24T17:27:17.686Z",
  "harness_phase": "ut",
  "criteria": [
    {
      "id": "AC-1",
      "kind": "criterion",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[AC-1][BD-1] opening session enforces each continue gate"
      ]
    },
    {
      "id": "AC-2",
      "kind": "criterion",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[AC-2] card candidates are filtered while only the rendered number is masked"
      ]
    },
    {
      "id": "AC-3",
      "kind": "criterion",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[AC-3][BD-2] OTP starts once, blocks resend, resets at zero and accepts six digits"
      ]
    },
    {
      "id": "AC-4",
      "kind": "criterion",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[AC-4] completion context exposes the full number once and then clears it",
        "[AC-4] repository commits all stored fields and treats a repeated number as success",
        "[BRANCH-BR-SUCCESS][AC-4] coordinated flow loads candidates, verifies OTP and saves successfully",
        "[BRANCH-BR-FAILURE][AC-4][BD-3] coordinated flow reaches a failed result when persistence throws",
        "[AC-4] save success returns the full card number and persisted payload",
        "[AC-4][BD-3] save failure preserves the full number in a failed result",
        "[AC-4][BD-3] insert failure rolls back, rechecks idempotency and leaves no half write"
      ]
    },
    {
      "id": "AC-6",
      "kind": "criterion",
      "ut_layer": "both",
      "priority": "P1",
      "ut_covered": true,
      "it_tags": [
        "[AC-6] existing and bank-opening destinations remain registered together",
        "[AC-6] an abandoned completion payload is cleared before route recovery"
      ]
    }
  ],
  "boundaries": [
    {
      "id": "BD-1",
      "kind": "boundary",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[AC-G3][BD-1] 数据源返回空数组时列表/药丸/分组三处可见性派生量均为 0",
        "[AC-1][BD-1] opening session enforces each continue gate"
      ]
    },
    {
      "id": "BD-2",
      "kind": "boundary",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[AC-G3][BD-2] 取数异常可 await 可 catch，吞掉后降级为空态且无未捕获 rejection",
        "[AC-3][BD-2] OTP starts once, blocks resend, resets at zero and accepts six digits"
      ]
    },
    {
      "id": "BD-3",
      "kind": "boundary",
      "ut_layer": "both",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[BRANCH-BR-FAILURE][AC-4][BD-3] coordinated flow reaches a failed result when persistence throws",
        "[AC-4][BD-3] save failure preserves the full number in a failed result",
        "[AC-4][BD-3] insert failure rolls back, rechecks idempotency and leaves no half write"
      ]
    },
    {
      "id": "BD-4",
      "kind": "boundary",
      "ut_layer": "both",
      "priority": "P1",
      "ut_covered": true,
      "it_tags": [
        "[BD-4] 导航栈未挂载时取栈抛出，被 try/catch 吞掉后不外抛且调用方状态不变",
        "[BD-4] cancelling sheet state clears selection, OTP and timers without persistence",
        "[BD-4] reset discards the active session and permits a clean restart"
      ]
    }
  ],
  "summary": {
    "unit_scope_total": 9,
    "unit_covered": 9,
    "device_delegated": 1
  }
}

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
- `01-Product/Phone/src/main/ets/navigation/WalletDestinationRegistry.ets` — 762 字节；按路径核对目标源码
- `01-Product/Phone/src/main/ets/pages/index.ets` — 3052 字节；按路径核对目标源码
- `01-Product/Phone/src/ohosTest/ets/test/List.test.ets` — 213 字节；按路径核对目标源码
- `01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets` — 871 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/model/BankCardCandidate.ets` — 418 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets` — 731 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/model/BankOpeningCompletionContext.ets` — 625 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/model/OpeningResult.ets` — 492 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/model/StoredCard.ets` — 936 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/repository/BankCardRepository.ets` — 5687 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/data/repository/BankRepository.ets` — 6491 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets` — 7444 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/domain/service/OpeningNavigationService.ets` — 626 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets` — 2110 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/index.ets` — 689 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/components/CardTypeSheet.ets` — 4998 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/components/OtpVerificationSheet.ets` — 6482 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/pages/AddBankCardPage.ets` — 14632 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/pages/AllBanksPage.ets` — 9644 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardOpeningResultPage.ets` — 2883 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectionPage.ets` — 8450 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/presentation/pages/HomeTabPage.ets` — 4372 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/main/ets/shared/constant/BankConstants.ets` — 2081 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets` — 283 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets` — 7068 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` — 14706 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankCardOpeningDependencies.ets` — 2799 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` — 1617 字节；按路径核对目标源码
- `04-BusinessBase/AccountManager/src/main/ets/data/model/UserProfile.ets` — 838 字节；按路径核对目标源码
- `04-BusinessBase/AccountManager/src/main/ets/domain/service/AccountService.ets` — 3504 字节；按路径核对目标源码
- `04-BusinessBase/AccountManager/src/main/ets/index.ets` — 250 字节；按路径核对目标源码
- `02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets` — 7068 字节
- `02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets` — 14706 字节
- `02-Feature/WalletMain/src/ohosTest/ets/test/home_page_ut.test.ets` — 2463 字节
- `02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets` — 283 字节
- `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankCardOpeningDependencies.ets` — 2799 字节
- `02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets` — 1617 字节
- `01-Product/Phone/src/ohosTest/ets/test/Ability.test.ets` — 1734 字节
- `01-Product/Phone/src/ohosTest/ets/test/List.test.ets` — 213 字节
- `01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets` — 871 字节

---

## 七、输出格式（必须严格遵循）

先给**汇总表**（每个检查项一行，PASS 也要列），再只对 **status ≠ PASS** 的项写 YAML 明细。
PASS 项不写论证，证据一行即可；证据不足时给 WARN 并说明缺什么，不要硬判 FAIL。
不要复述脚本 Harness 已判定的结构项，不要输出本节之外的自由文本。

本轮检查项与严重等级：

| id | severity |
|---|---|
| state_model_completeness | MAJOR |
| ui_bindings_completeness | MAJOR |
| handler_reachable | MAJOR |
| end_to_end_driving | BLOCKER |
| business_assertion_value | BLOCKER |
| mock_plan_traceability | BLOCKER |
| branch_coverage_semantic | MAJOR |
| device_ac_delegation | BLOCKER |
| stub_reasonableness | MAJOR |
| test_isolation | MAJOR |
| reference_crosscheck | MAJOR |

### 7.1 汇总表

| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| <check_id> | PASS / WARN / FAIL / SKIP | <severity> | <一行证据> |

### 7.2 非 PASS 项明细

```yaml
verification_result:
  phase: "ut"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-24T19:29:13.123Z"
  checks:            # 只列 status ≠ PASS 的项；每项字段固定
    - id: <check_id>
      status: FAIL | WARN | SKIP
      severity: <该项声明的 severity>
      details: |
        <证据：文件路径 + 行号/引文 + 判断依据>
      suggestion: |
        <修正建议：谁改、改哪个文件、改成什么>
  summary:
    total: 11
    pass: <PASS 数>
    fail: <FAIL 数>
    warn: <WARN 数>
    blockers: <severity=BLOCKER 且 status=FAIL 的数量>
    verdict: PASS | FAIL
    # verdict 规则：若存在任何 BLOCKER 级 FAIL → FAIL；否则 → PASS
```

---

## 八、注意事项

1. **不要重复脚本 Harness 已覆盖的检查**（use-cases.yaml schema、ui_bindings 非空、named_business_handler、boundary_matches_contracts、ut_import_whitelist、it 标签格式、boundaries_all_stubbed、覆盖计数等）
2. 本文件 v2.1 的核心 BLOCKER 是 **end_to_end_driving**——如果用例仍然是"调 Repository 查 length"这种老式单数据接口测试，必须 FAIL
3. 若 UT 文件依赖了 **UI 层禁入清单**中的符号（具体列表以 harness/profile 为准），脚本 Harness 已经会 FAIL；你无需重复判断，但可在 `test_isolation` 或 `end_to_end_driving` 中顺带引用其对"脱离 UI runtime 驱动"的负面影响
4. 对每一项检查，请给出**具体的代码证据**（文件路径 + 关键代码行），而非泛泛而谈
5. 若 `use-cases.yaml` 不存在但 acceptance.yaml 有 `ut_layer ∈ {unit, both}` 的 AC：
   - 检查 1 / 2 / 4 置为 SKIP（SKIP 原因注明"本 feature 未达复杂度阈值或未产出 use-cases.yaml"）
   - 检查 3（end_to_end_driving）仍需以"调用真实业务函数且断言充分"为标准进行判定
   - 检查 5 / 6 / 7 正常执行
6. **严禁**建议"新增 Port 接口 / 新增独立 UseCase 类文件（按旧目录约定）"——这是 v2.1 明确否定的反模式。如需改善可测试性，建议形式应为：
   - 抽取 Page 内部 inline lambda 为命名方法 / 导出函数
   - 将业务编排下沉到独立 `Flow` / `Coordinator` 等**非 UI 组件**的普通类
   - 在 `use-cases.yaml` 的 `ui_bindings` 补映射，在 `data_boundaries` 补边界声明

---

## 终态块（唯一版本化结论出口 · 必填）

若 testability-audit 在既有 YAML 外附 `## 问题清单`，逐条读责任产物、实际源码/日志与双方依据。复用 `issue-verification` fenced 块：`- issue: <原ID>`、`verdict: confirmed|refuted|unclear`、`evidence: <责任文件名 + 材料给出的完整问题/依据＋修复建议原文 + 具体判断依据>`；无提案不补块。该诊断不抹掉真实编译/执行 FAIL 或未执行检查。可按现有契约合法测试的误判须 refuted，不借诊断擅改产品/验收。事实拒修以原 `repair_candidate:<指纹>` 为 issue、evidence 含完整拒修依据，目标冲突仍核原文引文。

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

## Profile Overlay：hmos-app

# Hypium / ohosTest · `verify-ut` 语义补充

合并阅读主 prompt 时额外关注：

1. **UI 禁入**与主文一致：以 `ut_import_whitelist` 为准；常见需避免 import 的符号包括 `@Component`、`struct`、`NavPathStack`、`showToast`、`$r`、`$rawfile`、`AppStorage`、`LocalStorage`、`@kit.ArkUI`、`@kit.ArkGraphics` 等。
2. `@ohos/hypium`、`describe`/`it` 结构及 **禁止 UI import**（与 `check-ut` 白名单一致）。
3. `use-cases.yaml` ↔ DAG ↔ UT 的 **branch / AC** 对齐与命名标签 `[AC-*]` / `[BRANCH-*]`。
4. mock-plan Spy/Fake/MockKit **类型化表达式** (`as Type` / `new`) 是否满足脚本粗校验意图。
5. **MockKit 滥用（verifier）**：若 UT 使用 `MockKit`/`when`，是否仅 mock `contracts` 外部边界、未 mock 被测 Flow/Coordinator；`when` 预设是否与 `mock-plan` 的 `strategy: mockkit` presets 一致；调用序断言是否仍由 Spy `callLog` 或显式证据覆盖。
6. **禁止**建议改消费者 `framework/` 内 `ts-compile.ts` 或根 `package.json` 过关。


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

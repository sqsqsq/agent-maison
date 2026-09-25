# 业务级 UT 阶段语义验证 — cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g（v2.1 · UseCase 去代码化）

> 自动生成于 2026-09-25T04:34:49.022Z
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

- **模块名称**: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
- **阶段**: ut

---

## 三、Spec 规约内容

以下是 `framework/specs/phase-rules/ut-rules.yaml` 的完整内容，定义了 UT 阶段的通用约束规则：

```
phase: ut
version: "2.3"
applies_to:
  use_cases_spec: doc/features/{feature}/use-cases.yaml
  dag_files: "{module}/test/dag/**/*.yaml"
  ut_files: "{module}/src/test/**/*"
structure_checks:
  upstream_verdict_gate:
    description: >
      跨阶段负面裁决传播门禁（blind-visual-hardening d1）：ut 启动时消费上游各阶段 summary.json
      机器裁决——review 结论不通过（summary FAIL）等负面裁决未解决时 ut 不得启动（bc-openCard 二轮：不通过+3
      BLOCKER 曾照常进 ut）。
  harness_host_artifact_pollution:
    description: >
      framework harness 目录（ctx.harnessRoot）下不得出现
      contracts.modules[].package_path 对应的宿主 module 树；profile 可扩展额外 glob。任一命中即
      BLOCKER。
    severity: BLOCKER
semantic_checks: {}
traceability_checks:
  change_unit_feature_projection:
    description: CU-bound Feature 的复杂流必须按机械事实提供 use-case/DAG 并链接可执行验证
    severity: BLOCKER
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
  "feature": "cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g",
  "timestamp": "2026-09-25T04:34:49.008Z",
  "project_root": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur",
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
          "selected_source_fingerprint": "9d5c312f535515947c5960a4611943514f8a627a51341872e71135d4dbfc1d52",
          "binding": {
            "input_id": "code",
            "source": {
              "kind": "derive",
              "provider_id": "derive.codebase"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\ClosureFixture.ts",
                "exists": true,
                "sha256": "3d9ce426b6a10261ea819bcb0866c214a204cb4771d389d99193be39fdeb6d3d",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerFeature.ets",
                "exists": true,
                "sha256": "438c43280a11f6c1ded9988f7ebe9ec4b96e6fae38140a92d481c5c409eba431",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeBypass.ts",
                "exists": true,
                "sha256": "266e45c659ba29f63892abecd7f5ac1766e6080a11874dc5dd0ff7f2095834cb",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeConsumer.ts",
                "exists": true,
                "sha256": "05e74157c1ebb27756b6c54ff3da21b9157c9cd6815b9670d806b592143ec6b7",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerSourceSeam.ts",
                "exists": true,
                "sha256": "70cd301f29ed47420f1790c182b8eef73fe27532c46a50c469e68e6fb173c762",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\closure.test.ts",
                "exists": true,
                "sha256": "24c2cd85fa29ca62fd6408410e0823394d79cf452649af48ba20e45642130943",
                "role": "derive"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\seam-bypass.case.ts",
                "exists": true,
                "sha256": "4d329f5ccd0a2e2a9105d832f184d991406e1bb37579f833df16dcd3181205b2",
                "role": "derive"
              }
            ],
            "source_refs": [
              "src/ledger/LedgerFeature.ets",
              "src/ledger/LedgerIntakeConsumer.ts",
              "src/ledger/LedgerSourceSeam.ts",
              "src/ledger/LedgerIntakeBypass.ts",
              "src/ledger/ClosureFixture.ts",
              "test/ledger/closure.test.ts",
              "test/ledger/seam-bypass.case.ts"
            ],
            "content_fingerprint": "9d5c312f535515947c5960a4611943514f8a627a51341872e71135d4dbfc1d52"
          },
          "attempts": [
            {
              "kind": "derive",
              "source": "derive.codebase",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerFeature.ets",
                  "exists": true,
                  "sha256": "438c43280a11f6c1ded9988f7ebe9ec4b96e6fae38140a92d481c5c409eba431",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeConsumer.ts",
                  "exists": true,
                  "sha256": "05e74157c1ebb27756b6c54ff3da21b9157c9cd6815b9670d806b592143ec6b7",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerSourceSeam.ts",
                  "exists": true,
                  "sha256": "70cd301f29ed47420f1790c182b8eef73fe27532c46a50c469e68e6fb173c762",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\LedgerIntakeBypass.ts",
                  "exists": true,
                  "sha256": "266e45c659ba29f63892abecd7f5ac1766e6080a11874dc5dd0ff7f2095834cb",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\src\\ledger\\ClosureFixture.ts",
                  "exists": true,
                  "sha256": "3d9ce426b6a10261ea819bcb0866c214a204cb4771d389d99193be39fdeb6d3d",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\closure.test.ts",
                  "exists": true,
                  "sha256": "24c2cd85fa29ca62fd6408410e0823394d79cf452649af48ba20e45642130943",
                  "role": "derive"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\test\\ledger\\seam-bypass.case.ts",
                  "exists": true,
                  "sha256": "4d329f5ccd0a2e2a9105d832f184d991406e1bb37579f833df16dcd3181205b2",
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
          "selected_source_fingerprint": "0dc9fdaefb26fc585bea8857d34f22839c9834c2ef15f7034f1a63170e1158bf",
          "binding": {
            "input_id": "acceptance",
            "source": {
              "kind": "artifact",
              "artifact": "acceptance@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                "exists": true,
                "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                "exists": true,
                "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\acceptance.yaml",
                "exists": true,
                "sha256": "2a8b257571d1b6b8e7b1b589374f132cf0ec52429c1c4165a9362c55227270de",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                "exists": true,
                "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                "exists": true,
                "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                "exists": true,
                "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                "exists": true,
                "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/ledger-app-blueprint/ledger-refresh/acceptance.yaml",
              "doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml",
              "doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml",
              "contracts/ledger-api.yaml",
              "mappings/create-entry.yaml",
              "requirements/ledger.md",
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml"
            ],
            "content_fingerprint": "0dc9fdaefb26fc585bea8857d34f22839c9834c2ef15f7034f1a63170e1158bf"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "acceptance@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\acceptance.yaml",
                  "exists": true,
                  "sha256": "2a8b257571d1b6b8e7b1b589374f132cf0ec52429c1c4165a9362c55227270de",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                  "exists": true,
                  "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                  "exists": true,
                  "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                  "exists": true,
                  "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                  "exists": true,
                  "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                  "exists": true,
                  "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "spec",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\acceptance.yaml"
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
          "selected_source_fingerprint": "04a515fc0c34d8968cf3c647189137d27da189ed70d0ceeff10d7d0449da865c",
          "binding": {
            "input_id": "contracts",
            "source": {
              "kind": "artifact",
              "artifact": "contracts@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                "exists": true,
                "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                "exists": true,
                "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                "exists": true,
                "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\contracts.yaml",
                "exists": true,
                "sha256": "3499e70fb614809fb58bcc5d016df794739d83c40d74e3eb47e403c65fffd440",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                "exists": true,
                "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                "exists": true,
                "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                "exists": true,
                "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/ledger-app-blueprint/ledger-refresh/contracts.yaml",
              "doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml",
              "doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml",
              "contracts/ledger-api.yaml",
              "mappings/create-entry.yaml",
              "requirements/ledger.md",
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml"
            ],
            "content_fingerprint": "04a515fc0c34d8968cf3c647189137d27da189ed70d0ceeff10d7d0449da865c"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "contracts@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\contracts.yaml",
                  "exists": true,
                  "sha256": "3499e70fb614809fb58bcc5d016df794739d83c40d74e3eb47e403c65fffd440",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                  "exists": true,
                  "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                  "exists": true,
                  "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                  "exists": true,
                  "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                  "exists": true,
                  "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                  "exists": true,
                  "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\contracts.yaml"
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
          "selected_source_fingerprint": "0961de9f661666b3d325144476278a22b7a359ef2af618cbb884e49bd4e2f2a0",
          "binding": {
            "input_id": "use_cases",
            "source": {
              "kind": "artifact",
              "artifact": "use-cases@1"
            },
            "dependencies": [
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                "exists": true,
                "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                "exists": true,
                "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                "exists": true,
                "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                "exists": true,
                "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                "exists": true,
                "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                "role": "artifact"
              },
              {
                "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                "exists": true,
                "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                "role": "artifact"
              }
            ],
            "source_refs": [
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml",
              "doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml",
              "doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml",
              "contracts/ledger-api.yaml",
              "mappings/create-entry.yaml",
              "requirements/ledger.md",
              "doc/features/ledger-app-blueprint/ledger-refresh/use-cases.yaml"
            ],
            "content_fingerprint": "0961de9f661666b3d325144476278a22b7a359ef2af618cbb884e49bd4e2f2a0"
          },
          "attempts": [
            {
              "kind": "artifact",
              "source": "use-cases@1",
              "state": "resolved",
              "dependencies": [
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\change-unit.yaml",
                  "exists": true,
                  "sha256": "fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\blueprint\\component-blueprint.yaml",
                  "exists": true,
                  "sha256": "339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\contracts\\ledger-api.yaml",
                  "exists": true,
                  "sha256": "6ba6f2f6de504f784319419444d92a50332f736a2d824c934d6f1fefcef584d2",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\mappings\\create-entry.yaml",
                  "exists": true,
                  "sha256": "984f318a52562578587ef8bf06db9e345255407390a12f9a0ac22bfc2ebc56b7",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\requirements\\ledger.md",
                  "exists": true,
                  "sha256": "1cb261b1d7fa9e60c5a113c6f1a8029a9101809ee206836d6ca8a885123cc988",
                  "role": "artifact"
                },
                {
                  "path": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml",
                  "exists": true,
                  "sha256": "40c6e782288c023909c9c04213a7a692ab94861a01f1416f23b43555bc890f5d",
                  "role": "artifact"
                }
              ],
              "upstream_producer": "plan",
              "detail": "C:\\Users\\shengqsq\\AppData\\Local\\Temp\\real-chain-IojIur\\doc\\features\\ledger-app-blueprint\\ledger-refresh\\use-cases.yaml"
            }
          ]
        }
      ]
    }
  ],
  "capability_resolution_contract_fingerprint": "9c6d16fac9432e1ae83f6e9a510f14224c0806f83bd9ac29a7c8df44b153fad0",
  "checks": [
    {
      "id": "boundary_matches_contracts",
      "category": "structure",
      "description": "boundary_matches_contracts",
      "severity": "MAJOR",
      "status": "SKIP",
      "details": "contracts.yaml 未声明 interfaces，跳过。",
      "source": "boundary_matches_contracts"
    },
    {
      "id": "named_business_handler",
      "category": "structure",
      "description": "named_business_handler",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "use-cases.yaml 不存在，跳过。",
      "source": "named_business_handler"
    },
    {
      "id": "ut_unsupported_targets_handled",
      "category": "structure",
      "description": "ut_unsupported_targets_handled",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "无 L3（不可测）记录，跳过 option_a/b 处置检查。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_unsupported_targets_handled"
    },
    {
      "id": "ut_mock_plan_parseable",
      "category": "structure",
      "description": "ut_mock_plan_parseable",
      "severity": "MINOR",
      "status": "SKIP",
      "details": "mock-plan.yaml 不存在；canonical_rel=doc/features/ledger-app-blueprint/ledger-refresh/ut/mock-plan.yaml；由对应 presence gate 决定是否必需。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_mock_plan_present"
    },
    {
      "id": "ut_mock_plan_present",
      "category": "structure",
      "description": "ut_mock_plan_present",
      "severity": "MINOR",
      "status": "SKIP",
      "details": "无需要 test double 的可测性记录（现代调用包含明确 pure 的依赖）。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_mock_plan_present"
    },
    {
      "id": "ut_mock_plan_typed",
      "category": "structure",
      "description": "ut_mock_plan_typed",
      "severity": "MINOR",
      "status": "SKIP",
      "details": "无 mock-plan 或 spies 为空，跳过类型化 ts_expr 检查。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_mock_plan_present"
    },
    {
      "id": "ut_mock_plan_contracts_consistent",
      "category": "structure",
      "description": "ut_mock_plan_contracts_consistent",
      "severity": "MINOR",
      "status": "SKIP",
      "details": "无 mock-plan 或 spies 为空，跳过与 contracts 对齐检查。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_mock_plan_present"
    },
    {
      "id": "ut_hypium_mockkit_policy",
      "category": "structure",
      "description": "ut_hypium_mockkit_policy",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "本 feature 责任域内的 UT 未从 @ohos/hypium 导入 MockKit/when（或存量文件无新增 mock 用法），跳过 mock 策略门禁。\n身份基线：基线=72b5c922ef424577e6148cedf7ade849b7655534（锚=run_base_sha）",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_hypium_mockkit_policy"
    },
    {
      "id": "ut_import_whitelist",
      "category": "structure",
      "description": "ut_import_whitelist",
      "severity": "BLOCKER",
      "status": "SKIP",
      "details": "当前合并后的 phase-rules 未声明 ut_import_whitelist，跳过。",
      "structured": {
        "applicability": "not_applicable"
      },
      "source": "ut_import_whitelist"
    },
    {
      "id": "it_drives_flow",
      "category": "structure",
      "description": "it_drives_flow",
      "severity": "MAJOR",
      "status": "WARN",
      "details": "1 个 it() 用例驱动力不足：\n  - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets: \"[BRANCH-success][AC-1] LedgerFeature.add 刷新余额并可恢复\" — portRefs=0 stateRefs=0 expects=2",
      "affected_files": [
        "src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets"
      ],
      "suggestion": "数量是本 WARN 的触发线索，不是判据；请确认该 it() 覆盖了命名入口驱动、调用序列与状态迁移（纯函数/单规则用例只需保证错误实现会让它失败并覆盖边界/异常）。",
      "source": "it_drives_flow"
    },
    {
      "id": "origin_tag_required",
      "category": "traceability",
      "description": "origin_tag_required",
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
      "description": "characterization_trace_matches",
      "severity": "MAJOR",
      "status": "SKIP",
      "details": "无 characterization flow，跳过。",
      "source": "characterization_trace_matches"
    },
    {
      "id": "boundary_coverage",
      "category": "traceability",
      "description": "boundary_coverage",
      "severity": "MAJOR",
      "status": "SKIP",
      "details": "acceptance.yaml 未声明 boundaries。",
      "source": "boundary_coverage"
    }
  ],
  "summary": {
    "total": 62,
    "pass": 49,
    "fail": 0,
    "warn": 1,
    "skip": 12,
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
    "ut_testability_audit_present",
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
- **前置**：若 `doc/features/cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g/use-cases.yaml` 不存在，整项 SKIP（本 feature 不满足复杂度阈值即可豁免）
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

- **严重等级**: **BLOCKER**（当 `doc/features/cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g/ut/mock-plan.yaml` 存在且 feature 含 L0/L1/L2 可测项时）
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

被审 feature 根目录：`doc/features/cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g/`（相对仓根；下方清单里的相对路径同样相对仓根）。

### (resolved input code)

```
- path: src/ledger/LedgerFeature.ets
  content: >
    export class LedgerFeature {
      private entries: number[] = [];
      add(amount: number): number { this.entries.push(amount); return this.balance(); }
      balance(): number { return this.entries.reduce((a, b) => a + b, 0); }
      restore(saved: number[]): number { this.entries = [...saved]; return this.balance(); }
    }
- path: src/ledger/LedgerIntakeConsumer.ts
  content: >
    // 接缝的真实 Consumer：只经稳定契约取数，不 import 任何具体 Provider。

    // proveSeamConsumerNoBypass 会对本文件做源码级检查——改成直接依赖某个 Provider 就会被抓到。


    import { LedgerSource, resolveLedgerSource } from './LedgerSourceSeam';


    export interface LedgerIntakeResult {
      sourceId: string;
      total: number;
    }


    export function ledgerIntake(source: LedgerSource | undefined):
    LedgerIntakeResult {
      const resolved = resolveLedgerSource(source);
      return {
        sourceId: resolved.sourceId,
        total: resolved.read().reduce((sum, item) => sum + item, 0),
      };
    }
- path: src/ledger/LedgerSourceSeam.ts
  content: >
    // 宿主演进接缝夹具（总纲 §11.3）：稳定契约 + 两个真实 Provider + 缺失裁决。

    // 这不是"接口摆设"——四项接缝证明会真的调用它，见 test/ledger/closure.test.ts。


    /** 稳定能力契约：记账来源。Consumer 只认它，不认任何具体实现。 */

    export interface LedgerSource {
      readonly sourceId: string;
      read(): number[];
    }


    /** Provider 甲：手动记账。 */

    export const manualLedgerSource: LedgerSource = {
      sourceId: 'manual',
      read: () => [120, 80],
    };


    /** Provider 乙：自动记账。同契约、不同实现与不同数据。 */

    export const autoLedgerSource: LedgerSource = {
      sourceId: 'auto',
      read: () => [45, 55, 100],
    };


    /**
     * 蓝图对该接缝的缺失/失败裁决 = block：Provider 不在场必须显式失败，
     * 不得静默返回空结果冒充成功。
     */
    export const LEDGER_SOURCE_ABSENCE_SEMANTICS = 'block';


    export function resolveLedgerSource(source: LedgerSource | undefined):
    LedgerSource {
      if (!source) throw new Error('ledger_source_absent');
      return source;
    }
- path: src/ledger/LedgerIntakeBypass.ts
  content: |
    // 反例 Consumer：故意绕过接缝，直接依赖具体 Provider。
    // 只被 test/ledger/seam-bypass.case.ts 引用，用来证明绕过检查真的能判负——
    // 正链的 Consumer 是 LedgerIntakeConsumer.ts，本文件不参与任何 obligation。

    import { autoLedgerSource } from './LedgerSourceSeam';

    export function bypassingLedgerIntake(): number {
      return autoLedgerSource.read().reduce((sum, item) => sum + item, 0);
    }
- path: src/ledger/ClosureFixture.ts
  content: |
    export const componentClosureCombination = 'componentClosureCombination';
    export const alternateComponentClosure = 'alternateComponentClosure';

    export const fixtureSymbols = [
      'behavior',
      'owner',
      'consumer',
      'contract',
      'provider',
      'recovery',
      'refresh-behavior',
      'runtime-owner',
      'page-consumer',
      'source-contract',
      'repository-provider',
      'lifecycle-recovery',
      'ledger-refresh-vertical-slice',
      'ledger-consumer-ready',
      'ledger-recovery-ready',
      'ledger-summary-ready',
    ];
- path: test/ledger/closure.test.ts
  content: >
    // 宿主演进接缝（总纲 §11.3）的四项证明在本文件末尾——它们真的调用 src/ledger 的接缝，

    // 不是 return true 占位。其余 verify* 仍是夹具占位符（其真值由各自 obligation 的证据层承担）。

    import {
      LEDGER_SOURCE_ABSENCE_SEMANTICS,
      LedgerSource,
      autoLedgerSource,
      manualLedgerSource,
      resolveLedgerSource,
    } from '../../src/ledger/LedgerSourceSeam';

    import { ledgerIntake } from '../../src/ledger/LedgerIntakeConsumer';

    import { consumerAvoidsSeamBypass } from './seam-no-bypass-check';


    export function componentClosureCombination(): boolean { return true; }

    export function alternateComponentClosure(): boolean { return true; }

    export function verifyLedgerFlow(): boolean { return true; }

    export function verifyUserMutationTrigger(): boolean { return true; }

    export function verifyColdStartTrigger(): boolean { return true; }

    export function verifyInitialLoad(): boolean { return true; }

    export function verifyStateOwner(): boolean { return true; }

    export function verifyMutationPropagation(): boolean { return true; }

    export function verifyPublication(): boolean { return true; }

    export function verifySubscription(): boolean { return true; }

    export function verifyConsumerRefresh(): boolean { return true; }

    export function verifyRecovery(): boolean { return true; }

    export function verifyColdStartLifecycle(): boolean { return true; }

    export function verifyWarmResumeLifecycle(): boolean { return true; }

    export function verifyPageAttachLifecycle(): boolean { return true; }

    export function verifyPageDetachLifecycle(): boolean { return true; }

    export function verifyAccountSwitchLifecycle(): boolean { return true; }

    export function verifyProcessRecreationLifecycle(): boolean { return true; }

    export function verifySeamDecision(): boolean { return true; }

    export function verifyPreservedInvariant(): boolean { return true; }

    export function verifyChangeUnit(): boolean { return true; }

    export function verifySafeBuild(): boolean { return true; }

    export function verifySafeCompatibility(): boolean { return true; }

    export function verifySafeRecovery(): boolean { return true; }

    export function verifyTemporaryAsset(): boolean { return true; }

    export function proveSeamContractCompatibility(): boolean {
      // 两个 Provider 满足同一稳定契约，且同一个 Consumer 都能消费。
      const providers: LedgerSource[] = [manualLedgerSource, autoLedgerSource];
      return providers.every(provider =>
        typeof provider.sourceId === 'string' && provider.sourceId.length > 0
        && Array.isArray(provider.read())
        && typeof ledgerIntake(provider).total === 'number');
    }


    export function proveSeamProviderReplacement(): boolean {
      // 换 Provider 不改 Consumer：同一函数、同一结果形状，只有数据随实现变化。
      const first = ledgerIntake(manualLedgerSource);
      const second = ledgerIntake(autoLedgerSource);
      const sameShape = Object.keys(first).sort().join(',') === Object.keys(second).sort().join(',');
      return sameShape && first.sourceId !== second.sourceId && first.total > 0 && second.total > 0;
    }


    export function proveSeamAbsenceFailure(): boolean {
      // 蓝图裁决=block：Provider 缺席必须显式失败，不得静默成功。
      if (LEDGER_SOURCE_ABSENCE_SEMANTICS !== 'block') return false;
      try {
        resolveLedgerSource(undefined);
        return false;
      } catch (error) {
        return (error as Error).message === 'ledger_source_absent';
      }
    }


    export function proveSeamConsumerNoBypass(): boolean {
      // 真实 Consumer 只经契约取数；反例由 seam-bypass.case.ts 用同一把尺子判负。
      return consumerAvoidsSeamBypass('LedgerIntakeConsumer.ts');
    }



    export function verifiesComponentClosure(): boolean { return
    componentClosureCombination(); }
- path: test/ledger/seam-bypass.case.ts
  content: |
    // 绕过反例：用与正例完全相同的检查函数，对故意绕过接缝的 Consumer 求值——必须判负。
    //
    // 独立成文件是硬约束：component-closure.unit.test.ts 对 closure.test.ts 做命名空间导入，
    // 会把其中每个导出函数都执行并按返回值写进 ut/testing 证据链；把一个"恒返回 false"的导出
    // 放进去会当场打红正链。

    import { consumerAvoidsSeamBypass } from './seam-no-bypass-check';

    /** 正例 Consumer：不依赖具体 Provider → true。 */
    export function bypassCheckAcceptsCleanConsumer(): boolean {
      return consumerAvoidsSeamBypass('LedgerIntakeConsumer.ts');
    }

    /** 反例 Consumer：直接 import 了具体 Provider → false。 */
    export function bypassCheckRejectsBypassingConsumer(): boolean {
      return consumerAvoidsSeamBypass('LedgerIntakeBypass.ts');
    }

```

### (resolved input acceptance)

```
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
source: derive.blueprint-acceptance:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
version: "1"
boundaries: []
criteria:
  - id: AC-1
    prd_function: null
    priority: P0
    description: refresh and recover
    testable: true
    verification_steps:
      - 新增一笔账目后观察账页与重启后的余额
    expected_result: consumer refreshed
    ut_layer: unit
    ut_focus: flow

```

### (resolved input contracts)

```
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
source: derive.blueprint-contracts:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
version: "1"
modules:
  - name: ledger
    layer: 02-Feature
    format: HAR
    change_type: modify
    package_path: src/ledger
module_dependencies: {}
data_models: []
interfaces: []
components: []
files:
  - src/ledger/LedgerFeature.ets
change_unit:
  predicate_mappings:
    - predicate_id: refresh-behavior
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: runtime-owner
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: page-consumer
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: source-contract
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: repository-provider
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - predicate_id: lifecycle-recovery
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
  provide_mappings:
    - provide_id: ledger-refresh-vertical-slice
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      test_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
  design_ref_mappings:
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: logical
          id: ledger-domain
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: runtime
          id: ledger-repository
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: runtime
          id: ledger-store
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: flow
          view_id: runtime
          id: ledger-refresh-flow
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: development
          id: ledger-module
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: node
          view_id: scenarios
          id: add-entry-scenario
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: relation
          id: repository-publishes-store
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: relation
          id: domain-owned-by-module
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: contract
          id: create-entry-v1
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
    - design_ref:
        artifact: component-blueprint@1
        component_id: ledger
        blueprint_id: ledger-app-blueprint
        revision: 2
        source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
        artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
        target:
          kind: decision
          id: seam-shape
      implementation_refs:
        - src/ledger/LedgerFeature.ets
      verification_refs:
        - src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets
  change_unit_ref:
    artifact: change-unit@1
    component_id: ledger
    blueprint_id: ledger-app-blueprint
    change_unit_id: ledger-refresh
    revision: 1
    artifact_sha256: sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d
state_management:
  - data: ledger
    scope: component
    decorator: none
    holder: LedgerStore
    module: ledger
    owner_ref: view:runtime/node:ledger-repository
    contract_refs:
      - contract:create-entry-v1
    ordered_steps:
      - persist mutation
      - publish snapshot
      - refresh consumer
    lifecycle_triggers:
      - process_recreation
    failure_recovery:
      strategy: reload repository snapshot
    mutations:
      - mutation_id: add-entry
        kind: user
        publication_ref: publication:ledger-changed
        recovery_ref: recovery:reload-ledger
    publications:
      - publication_id: ledger-changed
    subscriptions:
      - subscription_id: ledger-page-subscription
        consumer_ref: consumer:ledger-page
        publication_ref: publication:ledger-changed
        replay_or_snapshot: latest
        cleanup: detach observer
    consumers:
      - consumer_id: ledger-page
        initial_load_ref: initial-load:repository-snapshot
        update_ref: publication:ledger-changed
    design_ref:
      artifact: component-blueprint@1
      component_id: ledger
      blueprint_id: ledger-app-blueprint
      revision: 2
      source_fingerprint: sha256:a0185cdd8ca8118f9fbe075f05cb53cfb9e15e1429004c0dd75ca907ba7aa6b5
      artifact_sha256: sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439
      target:
        kind: flow
        view_id: runtime
        id: ledger-refresh-flow

```

### (resolved input use_cases)

```
schema_version: "2"
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
use_cases:
  - id: ledger-refresh
    coordinator: LedgerFeature.add
    ui_bindings:
      - ui: LedgerPage
        role: entry
        user_actions:
          - trigger: 点击新增账目
            calls: LedgerFeature.add
    state_model:
      phases:
        - start
        - done
    branches:
      - id: success
        scenario: persisted ledger snapshot is published to the consumer
        expected_phase_seq:
          - start
          - done
        linked_acceptance:
          - AC-1
source: derive.blueprint-contracts:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439

```

### (resolved artifact use-cases@1)

```
schema_version: "2"
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
use_cases:
  - id: ledger-refresh
    coordinator: LedgerFeature.add
    ui_bindings:
      - ui: LedgerPage
        role: entry
        user_actions:
          - trigger: 点击新增账目
            calls: LedgerFeature.add
    state_model:
      phases:
        - start
        - done
    branches:
      - id: success
        scenario: persisted ledger snapshot is published to the consumer
        expected_phase_seq:
          - start
          - done
        linked_acceptance:
          - AC-1
source: derive.blueprint-contracts:sha256:fe345106ba3e8501f59c180ed060d7a542e874db951d4b1a4e3324cc7862a66d:sha256:339adc9c74f433a74ea085f8dccf2490d4c7424e66bbd184a70a9e613e25a439

```

### doc/features/ledger-app-blueprint/ledger-refresh/ut/testability-audit.md

```
# 可测性审计

```yaml
records:
  - acceptance_id: AC-1
    entry_point: {file: src/ledger/LedgerFeature.ets, symbol: add}
    testability_level: L1
    dependencies:
      - {name: Array, kind: pure}
    verdict: testable
```

```

### doc/features/ledger-app-blueprint/ledger-refresh/ut/reports/ac-coverage.json

```
{
  "schema_version": "1.0",
  "feature": "cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g",
  "generated_at": "2026-09-25T04:34:38.127Z",
  "harness_phase": "ut",
  "criteria": [
    {
      "id": "AC-1",
      "kind": "criterion",
      "ut_layer": "unit",
      "priority": "P0",
      "ut_covered": true,
      "it_tags": [
        "[BRANCH-success][AC-1] LedgerFeature.add 刷新余额并可恢复"
      ]
    }
  ],
  "boundaries": [],
  "summary": {
    "unit_scope_total": 1,
    "unit_covered": 1,
    "device_delegated": 0
  }
}

```

### doc/features/ledger-app-blueprint/ledger-refresh/context/facts.md

```
---
schema_version: "1.1"
feature: cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g
run_id: 20260925T043336Z-8e78e2
established_by: coding
ready_to_produce: true
has_blocker_coverage_risk: false
exploration_mode: sequential
key_inputs_read:
  - doc/glossary.yaml
  - doc/module-catalog.yaml
  - doc/architecture.md
subagents_used: none
decisions_unlocked:
  - ledger_refresh
files_inspected_count: 14
searches_performed_estimate: 10
source_code_paths:
  - src/ledger/LedgerFeature.ets
  - src/ledger/LedgerIntakeConsumer.ts
  - src/ledger/LedgerSourceSeam.ts
  - src/ledger/LedgerIntakeBypass.ts
  - src/ledger/ClosureFixture.ts
  - test/ledger/closure.test.ts
  - test/ledger/seam-bypass.case.ts
---

## Code Facts

| 路径 | 事实 | 对本阶段影响 |
|------|------|--------------|
| src/ledger/LedgerFeature.ets | LedgerFeature.ets 已读 | 账目刷新沿用 |
| src/ledger/LedgerIntakeConsumer.ts | LedgerIntakeConsumer.ts 已读 | 账目刷新沿用 |
| src/ledger/LedgerSourceSeam.ts | LedgerSourceSeam.ts 已读 | 账目刷新沿用 |
| src/ledger/LedgerIntakeBypass.ts | LedgerIntakeBypass.ts 已读 | 账目刷新沿用 |
| src/ledger/ClosureFixture.ts | ClosureFixture.ts 已读 | 账目刷新沿用 |
| test/ledger/closure.test.ts | closure.test.ts 已读 | 账目刷新沿用 |
| test/ledger/seam-bypass.case.ts | seam-bypass.case.ts 已读 | 账目刷新沿用 |

## phase_delta: coding

本阶段研究结论已确认。

## phase_delta: review

本阶段研究结论已确认。

## phase_delta: ut

本阶段研究结论已确认。

```

### 按需读取的文件（未内联 · 需要核对时用 Read 按路径读取，不要全量通读）

- `src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets` — 399 字节

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
  feature: "cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g"
  timestamp: "2026-09-25T04:34:49.022Z"
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

---
name: UT v2 修正 — UseCase 去代码化，改为规约驱动
overview: |
  修正 v2 plan 的根本错误——把"UseCase 规约"和"UseCase 代码形态"捆绑，强加 domain/usecase/ + Port 接口 + 构造注入，相当于把 Hexagonal Architecture 塞进本不是这套方法论的项目。
  校正后定位：
  - UseCase 是 **YAML 规约**（Skill 2 设计产物），描述业务流经过哪些节点、分支、状态，以及 UI↔业务入口的映射表
  - 业务编排**代码形态不强制**——可以是 Page 命名方法、普通业务类（Flow/Coordinator）、导出函数，由 Skill 3 按复杂度选择
  - 唯一硬约束：业务编排必须是"UT 可直接调用的函数符号"（命名方法/导出函数），不能藏在 .onClick(() => {...}) 里
  - UT 消费 use-cases.yaml + 现有代码 + DAG，直接 new 业务编排类（若有）或直调命名方法，**绝不 new @Component struct**
  - UI 副作用（Toast / 导航 / 弹框）永远由 Page 订阅 state 后执行，交 Skill 6 真机验证
todos:
  - id: revert-home-page-usecase
    content: 回退 home-page 的错误 UseCase 产物 — 删 HomeLoadingUseCase.ets / HomeDataPort.ets / use-cases.yaml；HomeRepository 去掉 implements；HomeTabPage 回退到迁移前形态（保留 triggerLoad 作为命名方法即可）；design.md / contracts.yaml / acceptance.yaml 的 UseCase/Port 相关章节清理；删 spy/SpyHomeDataPort.ets 与 home_loading.* 文件，恢复原 home_page_ut.* 或按新规则重写一版"直接驱动 HomeRepository"的轻量 UT
    status: cancelled
  - id: usecase-schema-add-ui-bindings
    content: 扩充 framework/specs/use-cases.schema.yaml，加入 ui_bindings 表（每条含 ui 名、role、user_actions[{trigger, calls}]、subscribes[]），作为 AI 写 UT 的"UI↔业务入口 导航图"；coordinator 字段取代原 use_case_class，coordinator_file 可选（简单场景可不产出业务类，直接指向 Page 命名方法）；保留 triggers / data_boundaries / state_model / branches
    status: cancelled
  - id: drop-code-form-rules
    content: 从 framework/harness/rules/ut-rules.yaml 删除针对代码形态的硬规则 — usecase_class_pure / port_injection / domain-usecase-目录存在性 / dag_linked_usecase 里"必须指向类名"的约束；保留 usecase_spec_exists（规约层面）/ dag_covers_branches / ut_covers_branches / branch_port_sequence / no_ui_dep_in_ut / it_name_has_ac_or_branch_tag；对应 check-ut.ts 同步清理
    status: cancelled
  - id: skill3-named-handler-rule
    content: Skill 3 新增 named_business_handler 规则 — use-cases.yaml 里 ui_bindings.user_actions.calls 指向的每个函数，必须在对应文件里以命名方法或导出函数形式存在，不能只存在于 inline lambda；check-coding.ts 加对应扫描（基于 use-cases.yaml 逐条核验）；Skill 3 SKILL.md 增加"业务编排函数形态"小节，强调"不强制抽类，但强制命名"
    status: cancelled
  - id: skill5-ut-import-whitelist
    content: Skill 5 新增 UT 文件 import 白名单规则 — 允许 import 现有业务代码（Repository / Service / Flow / 数据模型）与 spy；禁止 import @Component / NavPathStack / showToast / AppStorage / $r / 任何 @ohos.arkui.* UI 装饰器；check-ut.ts 对 ohosTest 目录下所有 .test.ets 做静态扫描
    status: cancelled
  - id: rewrite-card-opening-sample
    content: 重写 framework/skills/5-business-ut/examples/card-opening/ 纸面样例 — 以 CardOpenFlow（普通业务类，非 UseCase，不进 domain/usecase/）承载 3 页+1 组件的共享编排；use-cases.yaml 写齐 ui_bindings（CardSelectPage / CardProcessPage / SmsVerifyComponent / CardResultPage 各自的 user_actions 与 subscribes）、data_boundaries（CardCloudApi / CardLocalStore 现有类，非 Port）、branches（happy_path / verify_fail / apply_fail / sms_fail / persist_fail 各自的 cloud_stubs + local_expect + expected_phase_seq）；DAG 与 UT 全部围绕 CardOpenFlow 写，无任何 UI 结构 new；附 device-testing-todo.md 清单
    status: cancelled
  - id: skill2-wording-align
    content: 改写 framework/skills/2-requirement-design/SKILL.md — 统一措辞"业务编排类/coordinator"替代"UseCase 类"；明确 use-cases.yaml 是**规约文档**非代码目录；ui_bindings 作为必填章节；何时需要产出 use-cases.yaml 的判定写清（多 UI 节点共享状态 / 多步云调用 / 含回滚分支，三者任一触发；否则 acceptance.yaml + dag.yaml 即可）
    status: cancelled
  - id: skill3-wording-align
    content: 改写 framework/skills/3-coding/SKILL.md — 删除"必须在 domain/usecase/ 产出类"的强制；替换为"按 use-cases.yaml 选择业务编排承载形态"并列三种合法形态（Page 命名方法 / 普通业务类 / 导出函数）及选择指引；强调 named_business_handler 硬约束；删所有 Port 接口强制
    status: cancelled
  - id: skill5-wording-align
    content: 改写 framework/skills/5-business-ut/SKILL.md — Step 1 重述为"读 use-cases.yaml 的 ui_bindings 作为 UT 入口导航图"；Step 2 DAG 按 branches 展开；Step 3 UT 用例按 user_sequence 机械翻译为 await 调用链；Step 6 输出 device-testing-todo.md；强调"绝不 new @Component，绝不 import UI 符号"
    status: cancelled
  - id: verify-ut-prompt-align
    content: 改写 framework/harness/prompts/verify-ut.md — 删除 port_abstraction_quality（现在没 Port 了）；新增 ui_bindings_completeness（每个参与 UI 都有对应 user_actions 或 subscribes）/ handler_reachable（所有 calls 目标可被 UT 直调）；保留 state_model_completeness / branch_coverage_semantic / device_ac_delegation
    status: cancelled
  - id: dag-schema-align
    content: 扩展 framework/specs/dag-schema.md — 节点类型保留 user_trigger / port_call_cloud / port_call_local / state_transition；新增 ui_subscription 节点（描述"某 UI 因 phase=X 展示/跳转"，仅用于 design 文档与 device-testing-todo 生成，UT 不断言）
    status: cancelled
  - id: regression-check
    content: 全量跑 harness — design/coding/ut verify 都通过；card-opening 纸面样例做 dry-run（脚本或人工核对）；home-page 回退后重跑 check-coding 与 check-ut 确认无 UseCase/Port 残留；最后 git commit 消息注明"fix(framework): 回退 UseCase 代码化强制，改为规约驱动"
    status: cancelled
---

# 修正动机（为何再次返工）

- v2 plan 把"**业务流程需要文档化规约**"和"**必须产出 UseCase 代码类 + Port 接口**"绑成一件事，导致把 Hexagonal Architecture 强加进本不是这个方法论的项目
- 实操翻车：home-page 这种单点加载被迫生成 HomeLoadingUseCase + HomeDataPort，典型过度设计；framework 的 usecase_spec_exists / usecase_class_pure 等硬规则会**系统性诱导**后续 feature 重复犯同样错误
- 用户校正后的正确定位已确认：
  1. UT 是消费方，不是生产方
  2. UseCase = YAML 规约，不是 .ets 类
  3. 代码形态由 Skill 3 按复杂度选——简单时就是 Page 命名方法，复杂时才抽 Flow/Coordinator 普通类
  4. UT 直接驱动"业务编排函数"，UI 副作用（导航/Toast/弹框）全走 Skill 6
  5. `use-cases.yaml` 关键价值在 `ui_bindings` 映射表——给 AI 精确的"UI 事件→业务入口"对照，让 UT 翻译变成机械过程

# 执行阶段（按依赖顺序）

## Phase 1 — 立即回退错误产物（解除现状污染）
- `revert-home-page-usecase`

## Phase 2 — Framework 规约层校正（定义新契约）
- `usecase-schema-add-ui-bindings`
- `dag-schema-align`

## Phase 3 — Framework 规则层校正（删错规则 + 加对规则）
- `drop-code-form-rules`
- `skill3-named-handler-rule`
- `skill5-ut-import-whitelist`
- `verify-ut-prompt-align`

## Phase 4 — Framework Skill 文档同步（措辞对齐）
- `skill2-wording-align`
- `skill3-wording-align`
- `skill5-wording-align`

## Phase 5 — 样例重写（范本替换）
- `rewrite-card-opening-sample`

## Phase 6 — 回归与提交
- `regression-check`

# 关键契约（对齐备忘）

## use-cases.yaml 新 Schema 骨架（核心变化）

```yaml
schema_version: "2.0"
feature: "card-opening"

use_cases:
  - id: "card_opening"
    coordinator: "CardOpenFlow"                      # 业务编排承载对象（可为类名或"CardSelectPage.onConfirmOpen"这样的方法路径）
    coordinator_file: "02-Feature/.../CardOpenFlow.ets"   # optional；无独立类时可省

    ui_bindings:                                     # ★ 本次修正的核心字段
      - ui: "CardSelectPage"
        role: "entry"
        user_actions:
          - trigger: "点击开卡按钮"
            calls: "flow.chooseCard"
          - trigger: "chooseCard 成功后自动触发"
            calls: "flow.startVerify"
      - ui: "CardProcessPage"
        role: "progress"
        subscribes: ["flow.state.phase"]
        user_actions: []                             # 纯展示 → UT 不覆盖，交 Skill 6
      - ui: "SmsVerifyComponent"
        role: "dialog"
        subscribes: ["flow.state.phase=WaitingSms"]
        user_actions:
          - trigger: "输入短验并点下一步"
            calls: "flow.submitSms"
      - ui: "CardResultPage"
        role: "result"
        subscribes: ["flow.state.phase", "flow.state.cardInfo"]
        user_actions: []

    data_boundaries:                                 # 替代旧的 ports；指向现有类，不新增接口
      - { name: "cloudApi",   type: "CardCloudApi",   kind: "cloud"   }
      - { name: "localStore", type: "CardLocalStore", kind: "storage" }

    state_model:
      phases: [Idle, Verifying, Applying, WaitingSms, Submitting, Success, Failed]
      fields:
        - { name: "errorCode", type: "string | null" }
        - { name: "cardInfo",  type: "CardInfo | null" }

    branches:
      - id: "happy_path"
        user_sequence: ["chooseCard", "startVerify", "submitSms"]
        cloud_stubs: { verifyCard: ok, applyResource: ok, verifySms: ok }
        local_expect: ["savePending", "markVerified", "commit"]
        expected_phase_seq: [Idle, Verifying, Applying, WaitingSms, Submitting, Success]
        linked_acceptance: ["AC-x", "AC-y"]
      # verify_fail / apply_fail / sms_fail / persist_fail ...
```

## 何时产出 use-cases.yaml（避免再次 home-page 化）

三条件任一满足才产出：
1. 多 UI 节点共享同一业务状态（如开卡 3 页+1 组件）
2. 多步云调用串行（≥2 次云端接口）
3. 含回滚分支（某步失败需撤销前一步持久化）

否则 `acceptance.yaml` + `dag.yaml` 足够，不产 use-cases.yaml，不抽业务编排类。

## Skill 3 新增硬规则 `named_business_handler`

- `ui_bindings[*].user_actions[*].calls` 的每个目标必须在代码里以**命名方法**或**导出函数**存在
- 反例：`Button('开卡').onClick(async () => { await verifyCard(); ... })` —— 业务逻辑藏在 lambda 里不可 UT
- 正例：`Button('开卡').onClick(() => this.flow.chooseCard())` + `flow.chooseCard()` 为命名方法
- 由 check-coding.ts 基于 use-cases.yaml 逐条核验

## Skill 5 新增硬规则 `ut_import_whitelist`

UT 文件（`ohosTest/**/*.test.ets`）禁止 import：
- `@Component` / `@Entry` / `@Preview` 等 ArkUI 装饰器
- `NavPathStack` / `router`
- `showToast` / `promptAction` 任何 UI 反馈工具
- `AppStorage` / `LocalStorage`
- `$r` / `$rawfile` 资源访问
- `@ohos.arkui.*` 整个包

允许 import：业务编排类、Repository、Service、数据模型、Spy 类、Hypium。

# 风险与取舍

- **风险**：回退 home-page 会丢掉 v2 plan 里"做过一次真实迁移"的声称，但这本就是虚假信心——保留它反而会让后来者把 HomeLoadingUseCase 当范式抄
- **取舍**：Skill 3 只强制"命名函数"不强制"抽类"，会让 AI 在模棱两可的中等复杂度场景犹豫。用 use-cases.yaml 触发三条件作为硬阈值兜底
- **遗留问题**：ArkTS `@Component struct` 在 hypium 下的 newable 限制仍在；这正是"UT 不 new UI 结构"这条原则的原始动因，不是 bug 是约束——接受并围绕它设计

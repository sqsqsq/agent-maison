---
name: Skill 5 融合 characterization 路径（存量/回归特征化 UT）
overview: |
  在 Skill 5（业务级 UT）中新增第三条执行路径 —— **path-c · characterization**，用于"只求不坏、不追问应该怎样"的存量代码回归防护网场景。
  核心决策：
  - **不新建 Skill 5.x**，对外仍是一个 Skill 5，保持 framework 外部 API 简洁
  - 同时对 Skill 5 做**结构化重构**：主 SKILL.md 收敛为"路由 + 共同契约"薄层，A/B/C 三条路径各自外抽到 `paths/path-*.md`，避免单文件膨胀并改善弱模型加载
  - 路径 C 的产物只含 `dag.yaml`（节点带 `origin: log_observed`）+ `*_characterization.test.ets` + `harvest-notes.md`；**刻意不产出** `acceptance.draft.yaml` / `contracts.draft.yaml`，避免 C 长得像"半个 B"污染语义
  - 路径 C 的入口可测性（业务藏在 `onClick=()=>{...}` 等不可直调点）由 `harvest-notes.md` 输出"重构提案清单"，**人工确认后**才反馈 Skill 3 执行；Skill 5 本身不改源码
  - path-c 的试点时间窗放在 bankcard 走完正常 Skill 1→5 并积累 ≥2 次联调日志之后；本 plan 只落结构与契约，不在 plan 内跑试点
  推进节奏：
  - Phase 1（SKILL.md 瘦身，语义零变化）→ Phase 2（新增 path-c 骨架 + 门禁 + 模板）→ Phase 3（bankcard 对照实验占位，仅留 TODO 不展开）
todos:
  - id: audit-current-skill5
    content: 盘点当前 framework/skills/5-business-ut/SKILL.md 的章节与 path-A/path-B 分叉位置，产出一份内部迁移清单（哪些段落搬到 paths/path-a-usecase.md、哪些搬到 paths/path-b-simple.md、哪些留在主 SKILL.md 作为共同约束），确定语义零变化的搬迁边界
    status: pending
  - id: extract-path-a-and-b
    content: 新建 framework/skills/5-business-ut/paths/ 目录，产出 path-a-usecase.md 与 path-b-simple.md；把当前 SKILL.md 的"路径 A（有 use-cases.yaml）"与"路径 B（无 use-cases.yaml）"相关的 Step 1~3 细节章节完整搬迁（骨架代码、打桩示例、每 it() 必备断言等），保持行为/产物/门禁完全一致；主 SKILL.md 对应位置改为一句话指向 + 链接
    status: pending
  - id: slim-main-skill-md
    content: 重写 framework/skills/5-business-ut/SKILL.md 为薄层主文（目标 ≤ 220 行），只保留：触发条件、核心理念、三路径决策树（见 §三）、共同门禁（ut_import_whitelist / boundaries_all_stubbed / it() 命名前缀）、通用产物（device-testing-todo / 交付摘要 / trace.json）、Harness 调用入口；Step 编号改为"路由 → 分路径执行 → 共同收尾"三段式
    status: pending
  - id: phase1-regression
    content: 对 Phase 1 的重构做回归 —— 在 home-page / WalletMain 现有 UT 上跑 harness-runner.ts --phase ut --feature home-page，确认门禁报告与重构前逐项一致（零 BLOCKER / 零新增 WARN）；人工对比 paths/path-b-simple.md 与原 SKILL.md 路径 B 章节，确认语义零漂移
    status: pending
  - id: path-c-skeleton
    content: 新建 framework/skills/5-business-ut/paths/path-c-characterization.md，按 §四 定义的 Step 结构落地 —— Step C1 读取输入（源码 + 日志切片 + 业务描述）/ Step C2 抽取观测序列 / Step C3 生成 DAG 节点（每节点 origin 必填）/ Step C4 入口可测性盘点与 harvest-notes 产出 / Step C5 生成 characterization UT（[CHAR-*] 命名）/ Step C6 共同收尾；流程中任何需要改源码的点一律落到 harvest-notes，不直接改代码
    status: pending
  - id: characterization-template
    content: 新建 framework/skills/5-business-ut/templates/characterization-template.md，包含：log-slice 约定格式（已脱敏、单次执行）、characterization UT 骨架（[CHAR-<flowName>] 命名、边界调用序列断言、状态迁移断言、返回 shape 断言）、harvest-notes.md 模板（重构提案条目格式：file + location + issue + proposed_refactor + impact + 用户决策框）
    status: pending
  - id: dag-schema-extend-origin
    content: 扩展 framework/specs/dag-schema.md —— 新增顶层字段 flow_type: usecase_driven | spec_driven | characterization（默认 usecase_driven，向后兼容）；节点层新增 origin: log_observed | static_inferred | human_confirmed（path-C 产物必填，A/B 保持可选）；文档说明 origin 的追溯语义
    status: pending
  - id: harness-rule-origin-required
    content: 在 framework/specs/phase-rules/ut-rules.yaml 新增 origin_tag_required 规则（BLOCKER，precondition flow_type == 'characterization'），同步改造 framework/harness/scripts/check-ut.ts 增加对应 checker；确认 path-A/B（flow_type != characterization）走 SKIP 不影响现状
    status: pending
  - id: harness-rule-relax-for-c
    content: 在 ut-rules.yaml 的 branch_coverage_full / ut_case_per_unit_ac / acceptance_coverage / linked_acceptance 等"需求侧"规则上加 precondition "flow_type != characterization"，让这些规则在 path-C 自动 SKIP；补充新规则 characterization_trace_matches（MAJOR） —— UT 断言的边界调用序列必须与 DAG 节点序列一致（DAG 即日志还原的 trace）
    status: pending
  - id: verify-ut-prompt-align
    content: 改写 framework/harness/prompts/verify-ut.md —— 在现有语义检查项前加一段 flow_type 判定引导；path-C 专属检查：(1) origin 标注一致性（DAG 节点 origin 是否合理）(2) harvest-notes 完整性（入口不可测点是否全部列入）(3) no_business_judgment_in_spy（Spy 里不许写业务判断，沿用共同约束）；path-A/B 语义检查保持不变
    status: pending
  - id: skill5-trigger-wording
    content: 在重构后的主 SKILL.md 触发条件章节补入 path-C 的触发词 —— "存量 UT"、"回归网"、"基于日志生成 UT"、"characterization 测试"、"给现有流程补测试"；同时在决策树小节说明三路径在同一触发词"生成 UT"下按上游产物自动路由的规则（有 use-cases.yaml → A；有 acceptance.yaml 无 use-cases.yaml → B；均无且提供日志切片 → C；否则提示用户先运行 Skill 1/2）
    status: pending
  - id: bankcard-pilot-todo
    content: 在本 plan 的 §六 留下 bankcard 对照实验的占位 TODO —— 明确时间窗（bankcard 过正常 Skill 1→5 + ≥2 次联调日志后启动）、验收标准（path-C 产物的边界调用序列与 path-A/B 产物差异在可解释范围内）、产物路径；本 plan 不展开执行，仅固化约定
    status: pending
  - id: cross-reference-check
    content: 全局引用检查 —— 搜索 framework 下所有引用 "framework/skills/5-business-ut/SKILL.md" 的地方（特别是 harness prompts、其他 Skill 的 "下游消费者" 表、CLAUDE.md / AGENTS.md.template），若有指向被外抽章节的细节锚点需改为 paths/path-*.md 锚点；对外入口 SKILL.md 路径保持不变
    status: pending
  - id: regression-final
    content: 跑最终回归 —— (1) harness-runner.ts --phase ut --feature home-page 确认 path-B 分支零差异 (2) 在一个临时 feature 上构造最小 path-C 输入（几行假日志 + 现有 HomeRepository）dry-run，确认 origin_tag_required / characterization_trace_matches 正确触发、A/B 规则正确 SKIP (3) 提交 commit，消息："feat(skill5): 融合 characterization 路径 + 主 SKILL.md 结构化重构"
    status: pending
isProject: false
---

# 一、改造动机与边界

## 1.1 问题
- Skill 5 当前只覆盖**增量需求**的 UT 生成链（PRD → acceptance → (use-cases) → UT），对**存量代码**无定义流程
- 用户在"存量 UT"场景下最朴素的诉求是**只求不坏**（characterization / 回归网），不追问"应该怎样"
- 业界成熟答案是 characterization testing + record-replay，不是"从日志反推规格再生成 UT"

## 1.2 本次改造范围（明确边界）
**做**：
- Skill 5 新增第三条执行路径 `path-c`，对外仍是一个 Skill 5
- 对 Skill 5 做结构化重构（主 SKILL.md 瘦身 + paths/ 外抽），为三路径提供可维护的平级承载
- 新增 DAG `flow_type` + 节点 `origin` 元数据
- 新增/调整若干 harness 门禁（origin_tag_required / characterization_trace_matches / 现有需求侧规则的条件式 SKIP）

**不做**：
- 不新建 Skill 5.x 或独立 Skill
- 不产出 `acceptance.draft.yaml` / `contracts.draft.yaml`（避免污染规格语义）
- 不在本 plan 里实际跑 bankcard 试点（只占位）
- 不改 Skill 1/2/3/4/6（Skill 3 的 named_business_handler 规则对 path-C 不强制，由 harvest-notes 反馈走人工→重构）
- 不修改业务源码（harvest 只产出提案）

# 二、重构后 Skill 5 目录结构

```
framework/skills/5-business-ut/
├── SKILL.md                              ← 主文，目标 ≤ 220 行
│   ├ 触发条件（含 path-C 新触发词）
│   ├ 核心理念（UT 是消费者，不驱动架构）
│   ├ 三路径决策树（§三）
│   ├ 共同门禁（ut_import_whitelist / boundaries_all_stubbed / it() 命名前缀）
│   ├ 通用产物（device-testing-todo / 交付摘要 / trace.json）
│   └ Harness 调用入口
│
├── paths/                                 ← 新增
│   ├── path-a-usecase.md                  ← 从主文外抽：路径 A 的 Step 1~3 细节
│   ├── path-b-simple.md                   ← 从主文外抽：路径 B 的 Step 1~3 细节
│   └── path-c-characterization.md         ← 新增：Step C1~C6（§四）
│
├── templates/
│   ├── dag-schema.md                      ← 扩展 flow_type + origin
│   ├── ut-template.md                     ← 保持现状（A/B 用）
│   ├── mock-strategy.md                   ← 保持现状
│   ├── use-cases-schema.md                ← 保持现状
│   └── characterization-template.md       ← 新增：log-slice 格式 + CHAR UT 骨架 + harvest-notes 模板
│
└── examples/
    └── card-opening/                      ← 保持现状（A 的范例）
    # 未来可加 examples/bankcard-characterization/，本 plan 不落
```

# 三、三路径决策树（主 SKILL.md 的核心路由逻辑）

同一触发词（"生成 UT"）下按上游产物自动路由：

| 上游产物状态 | 路由 | 产物命名前缀 | 门禁严格度 |
|---|---|---|---|
| 存在 `doc/features/<f>/use-cases.yaml` | **path-A · usecase-driven** | `[BRANCH-*]` / `[AC-*]` | 最严（全量需求侧规则） |
| 有 `acceptance.yaml` 但无 `use-cases.yaml` | **path-B · spec-driven simple** | `[AC-*]` / `[BD-*]` | 中等（需求侧规则生效） |
| 无 `acceptance.yaml`，但用户提供日志切片 + 业务描述 | **path-C · characterization** | `[CHAR-<flowName>]` | 松（需求侧规则 SKIP，增 origin + trace 规则） |
| 以上均无 | 提示用户先运行 Skill 1 或补充 characterization 输入；**不自动降级生成** |

**关键不变量**：
- `ut_import_whitelist` 在三路径下都是 BLOCKER（安全线）
- `boundaries_all_stubbed` 在三路径下都是 BLOCKER（桩必须打，不能真调）
- `it()` 命名前缀强制（三路径各自的前缀体系）

# 四、path-c 执行流程（Step C1~C6）

### Step C1 · 读取输入
| 输入 | 形式 | 必需 |
|---|---|---|
| 源码 | 目标模块 `src/main/ets/**` | ✅ |
| 日志切片 | 用户从一次执行中截取、已脱敏、单文件 | ✅ |
| 业务描述 | 用户一句话：这段日志对应什么业务 + 入口方法名（若能指出） | ✅ |
| 既有 `contracts.yaml` | 若有则用作边界类参考；无则从源码扫草稿**仅用于本地推理、不落文件** | ❌ |

**无 `acceptance.yaml` / `use-cases.yaml` 是前提**，存在则应走 path-A/B。

### Step C2 · 日志观测序列抽取
- 时间戳升序
- 抽取标记：`[函数名]` / `state=XXX` / `branch=YYY` / 业务关键字段
- 产物（内存态）：ordered events + 观测到的边界调用集 + 观测到的 state 迁移序列
- 不尝试挖"未观测分支"，不做 static inference

### Step C3 · 生成 DAG（flow_type: characterization）
```yaml
flow_id: bankcard_bind_char_20260424_01
flow_name: 绑卡成功 characterization（来源：2026-04-24 联调日志）
flow_type: characterization            # ★ 新增
module: bankcard
version: 1
entry_point:
  module: bankcard
  file: ...
  function: onConfirmBindCard
nodes:
  - id: n1
    type: port_call_cloud
    boundary: bankCardApi
    origin: log_observed               # ★ 新增，path-C 必填
    observed_at: "2026-04-24T10:23:15+08:00"
    description: 调用云端绑卡校验接口（从日志行 #12 还原）
    next: [n2]
  - ...
```
- 每节点必含 `origin`；不确定的节点禁止省略，改写为 `origin: static_inferred` 并在 `harvest-notes.md` 记录依据
- DAG 作为 **trace 的结构化表达**，Step C5 的 UT 必须对齐此序列

### Step C4 · 入口可测性盘点（harvest-notes）
- 对 Step C1 指明的业务入口方法做静态检查：
  - 是命名方法 / 导出函数 → OK
  - 嵌在 `onClick=()=>{...}` / lifecycle 回调里 → 记入 `harvest-notes.md` 的"重构提案清单"
- **不自动改代码**，也不直接调 Skill 3
- `harvest-notes.md` 条目格式：
  ```yaml
  - file: 02-Feature/BankCard/src/main/ets/pages/BankCardBindPage.ets
    location: "line 123, Button('确认绑卡').onClick(...)"
    issue: 业务逻辑嵌在 inline lambda 中，UT 无法直接调用
    proposed_refactor: 抽出命名方法 async onConfirmBindCard(): Promise<void>
    impact: 仅改本文件；对外签名无变化；UI 绑定改为 .onClick(() => this.onConfirmBindCard())
    user_decision: "[ ] 同意  [ ] 拒绝  [ ] 改写："
  ```
- 用户人工勾选后，由用户自行发起 Skill 3 执行重构；Skill 5 不越界

### Step C5 · 生成 characterization UT
- 文件名：`{module}/src/ohosTest/ets/test/{flow_id}_characterization.test.ets`
- `it()` 前缀：`[CHAR-<flowName>]`
- 每个 `it()` 必备断言（由 `characterization_trace_matches` MAJOR 规则强校验）：
  1. 调用 DAG `entry_point.function` 作为驱动
  2. `assertDeepEquals(spy.callLog, <DAG 节点序列还原的 boundary name 列表>)`
  3. 对观测到的 state 迁移序列做 ≥2 次 `expect`（覆盖中间态 + 终态）
  4. 对关键返回字段做 shape 断言（存在性 + 基本类型），**不**对具体业务值硬编码（避免锁死到某次日志的偶然值）

### Step C6 · 共同收尾（与 A/B 一致）
- `device-testing-todo.md`：若业务描述含 UI 相关条目，登记给 Skill 6
- 交付摘要：按 `flow_type: characterization` 展示特有字段（origin 分布、harvest-notes 条目数）
- `trace.json`：`phase: ut`，新增字段 `flow_type: characterization`

# 五、门禁调整总表

| 规则 | 改动 | 作用路径 | 严重级别 |
|---|---|---|---|
| `ut_import_whitelist` | 不变 | A/B/C | BLOCKER |
| `boundaries_all_stubbed` | 不变 | A/B/C | BLOCKER |
| `it_name_has_ac_or_branch_tag` | 扩展接受 `[CHAR-*]` 前缀 | A/B/C | BLOCKER |
| `it_drives_flow` | precondition: `flow_type != characterization`（C 走自己的 trace_matches） | A/B | MAJOR |
| `branch_coverage_full` | precondition: `flow_type == usecase_driven` | A | BLOCKER |
| `ut_case_per_unit_ac` | precondition: `flow_type in [usecase_driven, spec_driven]` | A/B | BLOCKER |
| `acceptance_coverage` | precondition: `flow_type in [usecase_driven, spec_driven]` | A/B | BLOCKER |
| `linked_acceptance` | precondition: `flow_type in [usecase_driven, spec_driven]` | A/B | MAJOR |
| `origin_tag_required` | **新增** precondition: `flow_type == characterization` — DAG 每节点 origin 必填且合法 | C | BLOCKER |
| `characterization_trace_matches` | **新增** precondition: `flow_type == characterization` — UT callLog 与 DAG 节点序列一致 | C | MAJOR |
| `named_business_handler` | Skill 3 规则不跨到 Skill 5；path-C 不调用此规则；harvest-notes 承载反馈 | — | — |

# 六、bankcard 对照实验（占位，本 plan 不执行）

**时间窗**：bankcard 完成 Skill 1→5 正常流程 + 积累 ≥2 次真实联调日志后启动。

**方法**：
1. 保留 bankcard 正常 Skill 5 产出（记为 A 版：`*.dag.yaml` + `*.test.ets`，基于 acceptance/use-cases）
2. 同一套源码 + 联调日志切片喂 path-C，生成 B 版：`*_characterization.dag.yaml` + `*_characterization.test.ets`
3. 对比 A 版与 B 版：
   - 边界调用序列一致性（允许 B 是 A 的子序列 —— B 只覆盖观测到的 happy path）
   - 状态迁移一致性（同上）
   - DAG 节点集合重合度（B ⊆ A 的 happy 分支节点集合）

**path-C 验收标准**（B 版相对 A 版）：
- 边界调用序列在 happy path 上 **100%** 一致（否则说明 C 的日志解析或 UT 生成错了）
- 状态迁移在 happy path 上 **100%** 一致
- 节点集合差异**完全可解释**（B 缺失的节点应对应 A 的非 happy 分支）

**产物路径（约定）**：
- `02-Feature/BankCard/test/dag/bankcard_bind_char_*.dag.yaml`
- `02-Feature/BankCard/src/ohosTest/ets/test/bankcard_bind_characterization.test.ets`
- `doc/features/bankcard/harvest-notes.md`
- 对照实验报告：`doc/experiments/bankcard_char_vs_usecase.md`（另行创建，不在本 plan 内）

# 七、执行顺序（按依赖）

## Phase 1 · Skill 5 结构化瘦身（语义零变化）
1. `audit-current-skill5` — 盘点迁移边界
2. `extract-path-a-and-b` — 外抽 path-A / path-B
3. `slim-main-skill-md` — 主文重写为薄层路由
4. `phase1-regression` — home-page 回归，0 差异才进 Phase 2

## Phase 2 · 新增 path-c 骨架（结构 + 模板 + 门禁）
5. `path-c-skeleton` — 新建 path-c-characterization.md
6. `characterization-template` — 新建模板
7. `dag-schema-extend-origin` — DAG schema 扩展
8. `harness-rule-origin-required` — 新规则 + checker
9. `harness-rule-relax-for-c` — 现有规则加 precondition
10. `verify-ut-prompt-align` — 语义审查 prompt 对齐
11. `skill5-trigger-wording` — 主 SKILL.md 触发词与决策树补全
12. `cross-reference-check` — 全局引用修补

## Phase 3 · 收尾 + bankcard 对照占位
13. `bankcard-pilot-todo` — 留 TODO 约定
14. `regression-final` — 最终回归 + commit

# 八、风险与取舍

- **风险 1**：主 SKILL.md 瘦身时意外漏掉某个历史约束（例如某条只在原路径 B 章节出现的 beforeEach 细节）。缓解：`phase1-regression` 作为门禁，home-page 现有 UT 跑不通就视为回滚信号
- **风险 2**：`origin: log_observed` 的 DAG 节点可能被误认为"有规格依据"，导致 path-C 产物在后续被当成 path-B 接口对待。缓解：`flow_type: characterization` 是 DAG 顶层强制字段，harness 以此区分；交付摘要明确标注"特征化 UT，非需求级覆盖"
- **风险 3**：characterization UT 锁死的行为可能本身是 bug。这是 characterization testing 方法论的固有代价，接受即可 —— 未来在 bankcard 试点后可考虑补一条"rebase 到规格"的流程（characterization UT 在 AC 成形后升级为 `[AC-*]`/`[BRANCH-*]`），本 plan 不处理
- **取舍**：不产出 `.draft.yaml` 规格文件。代价是未来如需把 characterization 升级到 spec-driven，需手工补 acceptance.yaml（这是对的 —— 自动生成的规格 draft 往往带系统性误导，本就该由人写）
- **取舍**：Step C4 的重构提案走"harvest-notes + 人工勾选"而非自动联动 Skill 3。代价是多一步人工介入，换来的是避免 Skill 5 跨界改源码 —— 符合用户明确要求的"必要重构要先列方案人工确认"

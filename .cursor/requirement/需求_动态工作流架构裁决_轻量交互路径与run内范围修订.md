# 需求文档：动态工作流两项架构裁决（轻量交互路径 / run 内范围修订）

> 文档性质：**需求输入 + 用户裁决**，交主干（main / 3.1.0）。不是施工图。
> 起草日期：2026-09-14。代码基线：main `db2edab8`（动态工作流 P1–P7 八笔提交之后）。
> 第二版（2026-09-14）：收编 claude 与 codex 两轮 review 的修正——D0.1 与 D0.2 互斥、visual 义务无派生来源、D2.3 前缀规则卡死回退、D1.3 冲突规则阻断 D2、D0.3 触发过宽、feature 终点不等于必跑 coding、事件哈希链不存在、run_base_sha 属出生身份字段、attach 证据描述不准确。codex 第二轮再收口：D1 不设重新批准门槛、删除 successor 兜底方案、impact 相关性不硬绑写集、visual 缺失沿既有定档规则、转入 run 继承 feature 有效范围而非出生段、历史 PASS 阶段证据失效可重跑、阶段证据支持 feature 载体、指纹链校验范围写实。方向不变，只改落地规则。
> 上位：[动态工作流总纲](../plans/动态工作流_总纲_全阶段Skill独立组合与义务驱动编排_91c4e7a2.plan.md)、[原需求 R1–R8](需求_按任务义务自动确定执行范围_动态阶段编排.md)。
> 关联原则：效率优先、简单优先、减法优先；用户不承担框架内部仪式；不做 A/B。

---

## 0. 交办口径（可原样转给实施 AI）

1. 先读本文件、总纲与 P2/P7 两份 plan，再读 §8 事实索引指到的代码位置。
2. 本文件是用户对总纲 §7 与 P2 §5.1、§6.1–§6.3 两处设计的**改判**，优先级高于总纲与 P2/P7 正文。总纲与 P2/P7 中与本文件冲突的句子按本文件修订，不得保留两套口径。
3. 先写 plan、过 review、再实施。**只写一份 P8 plan**，内部分三个可独立 review 的批次；不修订 P2/P7 来承载本次待办，P2/P7 与总纲只加冲突说明并指向 P8。plan 必须含"用户裁决 2026-09-14"节与"实施记录"节。五项共用 resolver、有效范围读取和完成链，拆成多份 plan 会重复定义合同。
4. 实施顺序固定：**批次 1 = D0.1 + D2；批次 2 = D0.3 + D0.2；批次 3 = D1**。批次内顺序 D0.1 → D2 → D0.3 → D0.2 → D1。D0.1 只改纯函数；D2 删代码、简化 runtime；D0.3 建在 D2 的 run 内修订之上；D0.2 产出 D1 首次冻结所需的候选；D1 最后接 feature 级载体。D1/D2 是已定裁决，不因批次实跑结果重新批准；批次 1 完成后的早期宿主实跑（§7）用于发现问题、调整实现，不是 D1 的开工门槛。
5. 每批次一个 OpenSpec change delta（修订 `obligation-execution-scope`、`dynamic-workflow-closure-migration` 对应 spec）。D2 必须整条改写 `openspec/changes/obligation-execution-scope/specs/goal-runner/spec.md` 的 Requirement "Scope successors use existing owner release and birth mechanisms"，不得保留后继语义与本文件并存。`npm run openspec:validate` 与 `cd harness && npm test` 全绿后停点回报，不得自行提交；提交不加任何 AI 署名。
6. 宿主实跑由用户触发；fixture 绿不等于宿主通过。
7. 本文件同时收编 2026-09-13 检视报告的三项 P1（§3 D0）：AI 自报 not_applicable 洗绿、候选生成器缺失、coding→plan 生产触发缺失。它们与 D1/D2 是同一批工程，不拆分立项。三项已由代码直接核实（§8），不依赖该报告原文。
8. 验证强度按实际改动风险执行：生产代码改动跑 §7 全套；纯文档、plan 状态、OpenSpec 文案改动只跑 `openspec:validate` 与 `check-plan-version`。

---

## 1. 一句话目标

- **D1 轻量交互路径**：交互模式的完整交付**不强制**创建 Goal run。冻结范围写入 feature 级机器记录，阶段运行、assess、完成判定与 CU 消费直接读它。本次关联的 run 存在时 run 权威；无 run 时 feature 记录权威；feature 记录转入 run 后只是来源历史，不与 run 的有效范围持续比对。
- **D2 run 内范围修订**：冻结范围的合法修订在**同一 run** 内以追加事件完成，出生记录不改；successor 只保留给失败修复型 supersede 与用户显式改需求。P2 §6.1–§6.3 的"正常后继交接"整体删除。

- **D0 三项前置缺口**：resolver 不采信候选对证据类义务的自报结论，按有效来源重算；零设备裁剪必须同时有验收分层、视觉责任来源与有来源的影响判断；新增候选范围生成入口，主 Agent 不再手写指纹；coding / review / correction 中**已归属 spec / plan 的真实责任缺口**由真实 checker 产出修订输入，经 D2 在同一 run 内回补 plan / spec。

各条的共同约束：范围计算仍只有 `resolveExecutionScope` 一个纯函数入口；不新增用户确认；不引入长期双栈开关。

---

## 2. 裁决背景

### 2.1 当前实现（D1 相关）

| 事实 | 位置 |
|---|---|
| 完整交付要求交互模式也先 `--prepare-run --run-mode attended` 再 attach，manifest.execution_scope 为唯一权威 | 总纲 §7；P2 §5.1；`docs/operations/project-entry.md:30` |
| 阶段运行只在有 goalRunId 时加载冻结范围 | `harness/scripts/utils/capability-resolution-entry-input.ts:229` |
| assess 只在有 runId 时读范围，否则回落 track 全链 | `harness/scripts/utils/assess.ts:450-457` |
| 完成记录写入要求 runId，原件落 `goal-runs/<run_id>/feature-completion.json` | `harness/scripts/utils/verify-feature-completion.ts:560` 起 |
| 验证器按 completion.run_id 加载出生范围，缺则 INVALID | `harness/scripts/utils/verify-feature-completion.ts:876-882` |
| CU 预期链按 run 范围解析 | `harness/scripts/utils/change-unit-completion.ts:64-96` |

代价：每个正式 feature 都多一套 run 目录、锁、owner、事件流；主 Agent 多两步 CLI 仪式并须保持 attach。attach 依赖 adapter 的 in-session bridge：codex 宿主已有真实 bridge 记录（`.cursor/verification/3.0.0-golden-three-screen-20260909/attended-review-*`），claude adapter 声明 `in_session_reconcile: true`；**cursor 这类纯 `external_runner` adapter 没有 in-session 能力，完整交付在这类宿主上无路可走**。这才是 D1 的动机，不是"attach 未验证过"。原需求 §5.2 第 5 条本就预期"run manifest（goal）与 feature 级记录（交互）"两个载体，总纲 §7 单方面收成一个。**用户裁决：恢复两个载体，明文规定优先级。** D1 是本批最重的新增机制，实施须严格按 D1.1–D1.6 的最小形状，不额外扩张。

### 2.2 当前实现（D2 相关）

| 事实 | 位置 |
|---|---|
| 未知义务不进链：新行为无验收时出生链只有 [spec] | `harness/scripts/utils/execution-scope.ts:119` 起 |
| spec/plan checker 产出 `scope_revision_input` → assess `revise_scope` | `harness/scripts/utils/blueprint-skill-projection.ts:36-61`；`assess.ts:895` |
| runtime 追加 `scope_revision_requested`、封卷旧 run、释放锁 | `harness/scripts/goal-phase-runtime.ts:9342-9347`、`:4263` |
| 后继出生：新 run_id、successor_of、继承预算/pin | `harness/scripts/utils/goal-run-creation.ts:41-90` |
| 六个中断窗口重入协议 | P2 §6.3；`execution-scope.unit.test.ts` 的 successor/intent/released/born 模式 |

代价：验收未定的新 feature 正常路径即两到三个 run 目录；"继续"要跨 run 追溯；六窗口协议是本批最重的代码；且偏离原需求 R5"通过既有 backtrack / correction 只更新受影响的义务与阶段"。**用户裁决：改为 run 内追加修订。**

---

## 3. D0 需求条目：三项 P1 缺口

### D0.1 义务判定防洗绿（resolver 护栏）

- **不采信候选自报，按来源重算。** 候选事实中 kind 为 `unit-evidence` / `device-evidence` / `visual-evidence` 的 applicability 字段，resolver 一律不采信，按下列来源重算后覆盖；候选写什么都不构成拒绝理由（D0.2 生成器本身就会把派生结果写进候选，"出现即拒绝"会拒掉自己生成的零设备候选）。不新增"机器生成 / AI 手写"标记来区分作者。
  - unit / device：现有验收分层派生（`<kind>:acceptance` 事实）；验收缺失或分层非法 → unknown。
  - visual：**当前 resolver 对 visual-evidence 没有任何派生逻辑，只透传候选**。必须接既有 fidelity 定档结果（`applicability.pixel_fidelity` 读取的同一 SSOT，`capability-resolution.ts:530-539`）与明确请求：SSOT 定档 pixel_1to1 → required，此时验收缺视觉条目是待补缺口（unresolved，owner=spec），不是取消责任的理由；SSOT 明确非 pixel_1to1，或 SSOT 缺失且请求 / 蓝图无视觉要求 → not_applicable（与现有 provider 对缺失的处理一致，不强迫非视觉任务补一份视觉文件）；unknown 只用于 SSOT 存在但状态非法 / 损坏，或请求 / 蓝图含视觉要求而定档尚未完成。不从 acceptance 分层推 visual。
- `completion_target=feature` 时，device-evidence 即使由验收算出 not_applicable，还必须有一条 AI 提交、**有来源**的影响判断才能裁掉 testing。建议形状：候选 `request.impact = { user_visible_behavior_change: boolean, reason, basis: InputBinding[] }`，basis 必须落在项目内（CU canonical、蓝图、代码文件）。`false` 且验收无设备层且 visual 非 required → device-evidence not_applicable；`true` → device-evidence required（reason 记"影响判断"）；缺失 → unknown，reason 记"影响依据缺失"，testing 不裁。字段名与位置由 plan 定，语义不变。
- **impact 的机器核验边界要写实**：resolver 只能核 basis 路径存在、位于项目内、指纹可读，并且 basis 与本次实际范围相关：有 implementation 义务时与其写集绑定或既有 contracts.files 有交集；仅 review / UT 的任务与本次审查 / 测试目标有交集；蓝图 / CU 来源路径经既有 CU→contracts 映射关联，不硬绑 implementation。"路径合法"不等于"无设备影响已证明"。impact 的 reason 由既有 review / 阶段检查对照 diff 核对，发现与实际影响不符时走 D0.3 归属产出修订，不在 resolver 里装语义判断。
- 候选中的 `satisfied_by` 在**冻结时**（prepare-run 出生与 D1 首次冻结）重新解析核验：只接受经 P1 解析、内容可读且指纹一致的输入绑定，或带 run_id 的既有阶段证据。现在只在 verify 时核，太晚。
- `hasNoTestingObligation` 与 reconcile-only 沿用上述结果，不另加判断。
- 验收：D0.2 正常生成的零设备候选（验收全 unit、fidelity 非 pixel、impact=false 且 basis 在项目内）可冻结且裁掉 testing；候选手写 `device-evidence: not_applicable` 但验收含 device 层 → 重算为 required，testing 保留；候选手写 `visual-evidence: not_applicable` 但 fidelity 为 pixel_1to1 → 重算为 required，缺视觉验收时进 unresolved 而非裁掉；fidelity SSOT 缺失且请求无视觉要求 → visual not_applicable，不强迫补文件；SSOT 损坏或请求含视觉要求而未定档 → unknown，testing 不裁；验收全 unit 但无 impact → unknown，testing 保留；impact=true → testing required；impact.basis 指向项目外、不存在或与本次实际范围无关 → 拒绝；仅 review / UT 的候选带指向审查目标的 impact → 通过，不因无 implementation 被拒；`execution-scope.unit.test.ts` 的 direct 模式改为带 impact 通过，原 `device:impact` 自报写法不再对结果产生影响。

### D0.2 候选范围生成入口

- 新增一个 harness CLI（挂在 goal-mode-entry 或 harness-runner，名字由 plan 定），输入：project-root、feature、completion_target、requested_results 文本、可选 requested_phases、D0.1 的 impact 判断（含来源路径）。
- 机器负责的部分：从 CU canonical / `derive.blueprint-acceptance` / `derive.blueprint-contracts` / `acceptance@1` / `contracts@1` 解析 design-context 与 acceptance-context 的绑定和 `satisfied_by`；从验收分层派生 unit / device 事实，从 fidelity SSOT 派生 visual 事实（与 D0.1 同一规则）；code-review 沿现有规则自动补；全部 `content_fingerprint` / `dependencies[].sha256` 机器计算。
- **implementation 是否需要执行由明确请求动作与现有有效证据决定，不由 completion_target 决定。** `completion_target` 只决定最终证明到哪一级（request / feature）。用户明确要求改代码 → implementation required（basis 为 contracts.files 写集绑定）；用户要求把已有实现的 Feature 验证完成、所缺只是 review / UT → 不新增 implementation，requested_phases 只列验证阶段，completion_target 仍可为 feature。复用现有 `requested_phases` 与义务输入表达，不新增分类系统。
- 输出：写 feature.yaml 的 `execution_scope` 候选；stdout 同时打印同一 resolver 的结果投影（phase_chain、每条义务的 applicability 与 reason、unresolved）与一句模板化说明（例如"已有设计与验收可用，本次实现、审查并运行相关 UT；无设备义务"）。这条说明就是原需求 R2 的用户可见输出，用模板投影，不调 LLM。
- 幂等：候选存在且指纹一致不重写；不一致时列出差异并要求显式覆盖参数；不静默覆盖。
- 主 Agent 职责缩为四项：completion_target、requested_results、明确请求动作（是否改代码、只验证还是完整交付，落为 requested_phases）、impact 判断（含来源路径）。`templates/AGENTS.md.template`、`skills/project/goal-mode/SKILL.md`、`skills/project/change-unit-progression/SKILL.md`、`docs/operations/project-entry.md` 写清这四项和 CLI 调用，删除任何暗示手写 basis 的表述。
- 无蓝图合法入口（非 CU feature）：以 `artifact@1` 与 `derive.requirement` 生成；缺验收则 acceptance-context unknown，不强造蓝图。
- 验收：对 `harness/tests/fixtures/component-blueprint/valid` 的 CU 生成候选 → prepare-run 与 D1 首次冻结直接可用；生成的绑定与 `resolveCapabilityInputs` 的绑定指纹一致；同输入重跑文件字节不变；候选被手改后重跑报差异不覆盖；已有有效实现、仅缺 review / UT 的请求生成的候选不含 implementation，链为 [review, ut]；明确要求改代码的请求必含 implementation；AGENTS 模板 smoke 无 lite/full、无"手写指纹"字样。
- 用户可见说明由 D0.2 同源模板投影产生，**同时复用既有 assess → NEXT_STEP 渲染**：本批必须保证 NEXT_STEP 消费新的有效范围，不出现范围外义务；不重造 renderer。

### D0.3 coding / review / correction 发现设计缺口的生产触发

- **触发条件收窄为"已归属 spec / plan 的真实责任缺口"，不是任何越界。** 写集越界（`diff_within_scope`、contract-reference-closure 未授权引用）大多数是 coding 改错文件或误引依赖，应留在 coding 修复。只有经既有根因归属（`repair-candidates.ts` 的 repair_owner / 责任阶段路由，plan b6e4c9f2 的统一路由）判定 repair_owner 为 spec / plan 的发现，才产出 `scope_revision_input`：新增 `design-decision`（或 `acceptance-definition`）required，basis 为触发的 diff / 文件绑定，requested_phases = [责任阶段, 剩余未执行阶段]，其余义务原样继承。D2 在同一 run 内修订，plan 执行后回 coding。plan 对是否扩展契约仍独立裁决，修订提议不预设结论。
- `check-coding` / `check-review`：沿上述归属产出，不各自新造判定；plan 列出现有哪些 check id 已带 repair_owner 归属可直接接线（§9 问题 8）。
- correction 流程（`--correction-init`、correction-routing、scope-replan）读取有效范围（D1.3 / D2.2 的统一入口）；路由到范围外阶段时产出同一 `scope_revision_input`，不再直接落 `backtrack_target_absent`。scope-replan 已消费 `ExecutionScope`（`scope-replan.ts:195-204`），缺的是链外责任的修订出口，不是范围本身。
- 不改 assess 的 `revise_scope` 判定；不新增第二条回退动作；不放宽 R8。
- 验收：`execution-scope.unit.test.ts` design-gap 场景现在靠 `onHarnessSummary` 注入，属于"注入测试未覆盖生产触发"——保留该 runtime 单测，另补真实入口验收：真实 check-coding 夹具中，获准目标确实需要新公共接口且归属 plan → 同 run 修订为 [plan, coding, review, ut]；误改写集外文件且归属 coding → 留在 coding 修复，无修订事件；review 归因 spec 的用例同理；`--correction-init` 在范围外阶段产出修订而非 halt；testing FAIL 仍不产生修订。

---

## 4. D1 需求条目：轻量交互路径

### D1.1 feature 级冻结记录

- 新增一份**机器写入、单 writer** 的 feature 级冻结记录，内容为 `ExecutionScope`（`resolveExecutionScope` 的输出）加：候选输入指纹、contracts/workflow 指纹（已有 `policy_fingerprint`）、冻结时间、`scope_source: "feature"`、修订数组（见 D2.7）。
- 路径经 `harness/config.ts` 的 `featureFilePath` / `resolveFeatureArtifact` 解析，禁止硬编码 `doc/features/`。文件名由 plan 定，建议与 feature.yaml 并列（例如 `execution-scope.json`）；**不写进 feature.yaml**，因为 feature.yaml 是 AI 可编辑的候选载体，冻结结果与候选混在一个文件里无法分辨谁改了谁。
- 总纲 §7"不新增 execution-scope.json"一句按本裁决删除。

### D1.2 冻结时机与不重算

- 交互模式下，对该 feature **第一次**执行任一 feature phase（`harness-runner --phase <p> --feature <f>`，无 run 身份）时，runner 读 feature.yaml 候选、经同一 `resolveExecutionScope` 计算并写入冻结记录。
- 之后每次阶段运行只读冻结记录，并核对候选指纹：候选被改动而冻结记录未经 D2.7 修订 → BLOCKER，指向既有 stale/correction 路径；不静默重算，不静默沿用。
- 候选缺失时的行为沿用现状（BLOCKER 报"缺少运行前范围输入"），不回落 track。

### D1.3 权威优先级

| 状态 | 权威 |
|---|---|
| **本次明确选择或关联的 run**（显式 `--run-id` / `--goal-run-id`、当前 active run 识别结果，manifest 含 execution_scope） | run 的有效范围（出生 + D2 修订） |
| 无关联 run，有 feature 冻结记录 | feature 冻结记录的有效范围 |
| 无法确定当前权威（既无关联 run 也无 feature 记录却有阶段报告；或 feature 记录声明已转入某 run 而该 run 不存在 / 损坏） | 明确报错，列出来源与缺失项，不选边 |
| 两者都无 | 按 D1.2 首次冻结；旧协议 run 按 P7 legacy 语义 |

- **"存在 run"收窄为本次关联的 run。** 目录里存在任何历史 run 不构成永久接管轻量路径的理由；关联关系只来自显式 run 身份或既有 active run 识别，不按目录 mtime 猜。
- 同一 feature 后起 Goal run 时，出生入口若发现 feature 冻结记录，**run 的出生范围等于转交时 feature 的有效范围**（出生段 + 已应用的 revisions），不从候选重算，保证一次计算；feature 记录写入 `transferred_to: <run_id>` 与转交时的有效范围指纹。feature 最初出生段与修订历史原样保留。
- **转入后 feature 记录是来源历史，不参与持续等值比较。** run 内发生 D2 合法修订后，run 有效范围与 feature 记录必然不同，这不是冲突。不做双向同步。只有 run 的出生范围指纹与 feature 记录登记的转交指纹不一致才是损坏。

### D1.4 消费者接线

以下读点全部改为通过一个统一入口取"当前有效范围"，入口内部按 D1.3 选来源；不允许各消费者自己判断 run/feature：

- `capability-resolution-entry-input.ts:229`（阶段输入上下文、facts 上下文、required_outputs）
- `assess.ts:450`（observeFeatureState）
- `harness-runner.ts:548`（`--report-reconcile-only` 零设备判定）
- `blueprint-skill-projection.ts:36`（`designScopeRevisionChecks` 目前要求 subject 带 run_id）
- `change-unit-completion.ts:64`（CU 预期链）
- `verify-feature-completion.ts`（写入与验证，见 D1.5）
- goal-status / 报告投影中引用范围的位置

`FactsInvocationContext.subject` 允许 `{ feature }` 无 run_id 的 Feature 身份；Feature facts 绑定 feature 与冻结记录指纹。

### D1.5 完成判定

- 无 run 时，完成记录原件落 feature 级（位置由 plan 定，经同一路径解析），`run_id: null`，`scope_source: "feature"`，`execution_scope_fingerprint` 为有效范围指纹。
- 验证器按 `scope_source` 选择出生范围来源：run → 现有逻辑；feature → 读冻结记录。其余判据不放松：阶段 receipt、evidence manifest、gate_fingerprint、freshness、required 义务覆盖、`chain === executionCompletionPhases(有效范围)` 全部沿用。
- 只有 feature.yaml、只有裸阶段报告、或冻结记录的范围内容 / 绑定 / revisions 链被非法改动，一律 INVALID；不得因无 run 而信任任何自报字段。校验复用现有 `validateExecutionScope`、指纹与证据机制，不为此另造签名体系。
- CU 消费 VALID completion 时不区分 scope_source。

### D1.6 "继续"

无 run 的"继续"= 读 feature 冻结记录 + 各阶段既有闭环状态决定下一步，不问 track，不重新计算范围。有 run 的"继续"沿现状。

### D1.7 验收

| 场景 | 期望 |
|---|---|
| 无 run，harness-runner 三次调用完成 coding→review→ut | completion VALID、CU VALID；无 goal-runs 目录；无 spec/plan/testing 空报告 |
| 同上，中途改候选删掉 testing 义务 | 下一阶段 BLOCKER，指向 stale/correction；冻结记录不变 |
| 同 feature 随后起 attended run | run 出生范围 = 转交时 feature 有效范围；不重算；feature 记录写入 transferred_to 与转交指纹 |
| feature 记录先经一次合法修订（S0→S1）再转入 run | run 以 S1 出生，不判损坏；feature 的 S0 与修订历史保留 |
| 转入 run 后发生 D2 合法修订 | 继续执行，不报冲突；feature 记录不改 |
| run 出生范围指纹与 feature 记录登记的转交指纹不同 | 明确报错，两个指纹与来源都在输出里 |
| 只有 feature.yaml + 裸报告；冻结记录范围内容被非法改动、绑定失配或 revisions 链断裂 | INVALID（复用现有指纹与证据校验；纯格式变化不作硬门禁，不另造签名体系） |
| 现有 attended / detached 场景 | 全部保持通过 |
| `--report-reconcile-only` 对无 run 的零设备 feature | 不要求 trace |

---

## 5. D2 需求条目：run 内范围修订

### D2.1 修订事件

- 在**同一 run** 的 `events.jsonl` 追加 `scope_revised` 事件，走既有 `goalEvents.emit`。内容：`revision_index`（从 1 递增）、`previous_scope_fingerprint`（前一有效范围指纹）、`execution_scope`（新范围，经 `validateExecutionScope`）、`revision_input`（触发它的 `scope_revision_input` 与来源绑定）、`trigger`（phase、check id）、`allowed_fields`。
- **事实更正：events.jsonl 没有逐条哈希链。** 只有 `run_created` 一条带 `event_hash`（`goal-run-creation.ts:105-159`），其余事件无链式哈希。修订事件的校验范围写实：`previous_scope_fingerprint` 逐条链接到出生指纹、`revision_index` 连续、每条修订过 `validateExecutionScope` 与 D2.3 约束，并与已有阶段证据、completion 记录的有效范围指纹及 `scope_revision_count` 对账。这能发现乱序、中间删除、范围内容篡改，以及 completion 之后的任何删改；**不承诺发现 completion 之前删掉最后一条修订，或篡改不进范围指纹的 `trigger` / `revision_input` 字段**。不为兑现"任意篡改可发现"新建签名或外部状态系统。
- 不新增文件、registry、租约或 manifest 字段。

### D2.2 有效范围

- 有效范围 = 出生范围（manifest.execution_scope，字节不变）+ 按 `revision_index` 顺序应用的 `scope_revised` 事件。
- 提供**唯一**函数计算有效范围（工作名 `loadEffectiveExecutionScope`），替换所有 `loadFrozenExecutionScope` 的运行时消费点（assess、driver、entry-input、verify-completion、change-unit-completion、reconcile-only、goal-status、facts 校验）。`loadFrozenExecutionScope` 只保留给"读出生范围"的场合。
- manifest.execution_scope、manifest.phase_chain 与 run_created 身份绑定保持出生值；chain_override / start / end 的"同值投影"改为与**出生**范围同值，执行链取自有效范围。
- 修订链断裂（`previous_scope_fingerprint` 对不上出生指纹或前一条）、index 重复或跳号、修订内容过不了 `validateExecutionScope` → 损坏，走既有恢复，不回退成出生范围继续跑。
- 凡读 `manifest.end_phase` / `phase_chain` 判断"run 是否到末段"的位置（`resolveEffectiveRunEnd`、goalEnd、报告投影等）必须改读有效范围，plan 列清单；这是 D2 最大的隐性改动面。

### D2.3 允许的修订

- 可改字段沿用 `SCOPE_REVISION_FIELDS` 语义：`execution_scope` 及其 phase_chain 投影；`requested_results`、`completion_target`、requirement、预算、pin、授权上下文、fidelity 不可改（现有约束原样保留）。
- 义务允许的变化：unknown → required / not_applicable；**not_applicable → required**（新事实发现影响，例如 coding 期间发现用户可见行为变化）；新增义务；补 `satisfied_by`；**撤销已失效的 `satisfied_by`**（被复用的证据因新事实 stale，相关阶段按既有 freshness 机制重跑）。**不得删除或降级 required 义务**（沿用 `designScopeRevisionChecks` 的 BLOCKER）。
- **执行历史与当前责任计划是两个序列，不共用 phase_chain。** 执行历史来自 events（phase_start / attempt / closure），只追加不改；有效范围的 phase_chain 是"从现在起还要执行什么"，允许按新事实调整。约束是：已 closed 且 PASS、**证据仍有效且未受本次修订影响**的阶段不进新 phase_chain（其义务经 `satisfied_by` 引用阶段证据承接）；证据已失效或受本次修订影响的历史 PASS 阶段必须能重新进入计划（与上一条"撤销 satisfied_by"一致）；已执行但未 PASS 的阶段可以重新出现在新链中（coding 失败 → [plan, coding, review, ut] 合法）；`validateExecutionScope` 对 phase_chain 的"不重复"约束保持，因为它只描述剩余计划。
- **阶段证据引用支持两种既定载体**：run 的阶段证据（现有 `ScopeEvidenceRef` 带 run_id）与 feature 级阶段证据（D1 无 run 路径，引用 feature 的 evidence manifest，形状由 plan 定），共用同一有效性检查（integrityOk、freshness、aggregate 指纹）；不允许轻量路径伪造 run_id 来满足现有引用形状。
- 是否修订由新事实决定，不由 PASS / FAIL 决定：测试失败、设备离线、manual、report 失败本身不产生修订（现有规则保留）；同一阶段既失败又暴露归属 spec / plan 的新事实时，修订合法，失败事实照常记录。

### D2.4 触发与继续

- 触发面不变：checker 产出 `scope_revision_input` → assess `revise_scope`。
- runtime 在 phase 边界校验并追加 `scope_revised` 后，**继续在同一 run 派发**下一阶段：不封卷、不释放锁、不生成后继；预算、重试计数、round/drift 指纹连续。
- **run_base_sha 是出生身份字段**（进 `computeManifestIdentityFields`，运行时有 write-once 防线，`goal-phase-runtime.ts:3160-3223`），不能在同一 run 内后补写进 manifest。[spec] 出生的 run 修订后首次进入 coding / ut 时，基线在**同一 run 内**解决：基线作为 `scope_revised` 事件的字段 `run_base_sha` 随首次含 coding/ut 的修订一起冻结（取当时 Git HEAD，沿原出生规则校验），所有读 `manifest.run_base_sha` 的位置改读"出生值或首条携带基线的修订事件"，write-once 语义在事件层保持（后续修订不得再携带或改写基线）。不为这种情形保留 successor 路径，那与 D2 裁决冲突。改动面须在 plan 里列全（§9 问题 9）。

### D2.5 successor 保留范围与删除清单

- 保留：失败修复型 supersede（e9d4b7a3 语义，含 `backtrack_target_absent` 的手工交接指引）、用户显式改需求经 correction/successor 签发新 run、creation-incomplete 修复。
- 删除：`scope_revision_requested` 事件及其读取、`createScopeSuccessor` 的正常后继路径、`cleanupScopeAncestors`、`goal-phase-runtime.ts` 中 detached attach-created 要求 verified scoped successor 的守卫、`execution-scope.unit.test.ts` 的 successor / intent / released / born 四种模式、`onScopeHandoff` 回调。P2 §6.1–§6.3 正文不删，按 §0 第 3 条加冲突说明指向 P8。同句禁令"不新建 execution-scope.json"在 `openspec/specs/runtime-policy/spec.md` 与 `openspec/changes/composable-workflow-foundation/specs/runtime-policy/spec.md` 各有一处，随批次 3 delta 一并修订，同句其余禁令保留。
- 3.1.0 尚未发布，没有任何宿主持有 `scope_revision_requested` 协议，**不写兼容 reader**，直接删。

### D2.6 完成判定

- `verifyFeatureCompletion` 用有效范围计算 expectedChain；completion 记录 `execution_scope_fingerprint` = 有效范围指纹，另记 `scope_revision_count`。
- completion 记录写入后，修订数量、有效范围指纹或已绑定证据与 completion 记录失配 → INVALID；其他改动（含不参与指纹的 `trigger` / `revision_input` 字段）按 D2.1 已声明的校验边界处理，不另造签名体系。

### D2.7 与 D1 的衔接

- feature 冻结记录同样支持追加修订：记录内 `revisions[]` 数组，元素形状与 `scope_revised` 事件一致，同一函数计算有效范围；出生段不改写。
- D1 路径的触发面相同（checker 的 `scope_revision_input`），由 harness-runner 在阶段收尾应用。

### D2.8 验收

| 场景 | 期望 |
|---|---|
| 出生链 [spec]，spec 产出 device AC | 同一 run 继续 coding→review→ut→testing；events 只有一个 run_created、无 successor；manifest.execution_scope 字节不变；completion VALID 且 expectedChain 含 testing |
| coding 已有一次执行记录（未 PASS）后报出归属 plan 的新接口 | 同一 run 修订为 [plan, coding, review, ut]；执行历史保留 coding 的失败记录；预算计数连续；plan 完成后 coding 重跑 |
| coding 期间发现用户可见行为变化（原 device-evidence not_applicable） | 修订为 required，testing 进入链尾；不报"降级 required"BLOCKER |
| 被复用的证据因新事实失效 | satisfied_by 撤销，对应阶段回到 phase_chain 重跑；不静默沿用 |
| 修订试图删除或降级 required 义务 | BLOCKER，不应用，run 不封卷为成功 |
| [spec] 出生的 run 修订后进入 coding | 基线随该条修订事件冻结一次且不可改；后续 diff 基线一致；无 successor |
| 历史 PASS 阶段的证据因新事实失效 | 该阶段重新进入 phase_chain 重跑；证据仍有效的 PASS 阶段不重跑 |
| completion 之后修订数量、有效范围指纹或已绑定证据失配 | INVALID；不进指纹的字段改动按 D2.1 边界处理 |
| completion 之前删除中间一条或改动范围内容 | 链断裂 → 损坏，走既有恢复 |
| testing FAIL、设备离线、manual | 无修订事件，范围不变（现有用例保留） |
| 修订事件写入后立即中断再重入 | 修订不重复应用，下一阶段只派发一次 |
| 中断于修订校验前 | 重入后恢复到 phase 边界再校验一次，仍只有一条修订 |
| D1 路径同场景 | feature 记录 revisions 追加一条，行为等价 |

---

## 6. 非目标与边界

- `resolveExecutionScope` 只做 D0.1 的护栏增量与"应用修订"纯函数，不改其余义务语义。
- 不动 request CLI（review/ut/testing 专项）、R8 护栏、P0 运行时证据规则。
- 不重造 NEXT_STEP renderer，但本批必须保证既有 assess → NEXT_STEP 与新的有效范围一致（D0.2）。旧 track / lite 字样残留不按数量清点：只处理新路径误用旧逻辑的位置，真实旧 run 消费者保留。
- `contract.capabilities[].obligation_kinds` 未被消费不直接定性为"合同未实现"（P1 允许 input_role）；只检查实际必需输入是否被错误剪枝。
- 不复制七份 plan 的实施日志，不为 facts 撞名做字段改名迁移。
- 不新增确认点、模式菜单、长期 feature flag；不做 A/B。
- 不批量改写宿主历史；旧 spec-driven run 按 P7 legacy 语义恢复。

---

## 7. 提交边界与验证

- D0.1 一笔（纯函数 + 测试）；D2 一笔或两笔（runtime 删改 + 测试重写）；D0.3 一笔（checker / correction 产出 + 真实夹具）；D0.2 一笔（CLI + 模板文案）；D1 一笔或两笔（载体与写入 + 消费者接线）。中间提交不得暴露"一半消费者读 run、一半读 feature"或"生成器已有、模板仍教手写"的半成品。
- 生产代码改动每笔：`cd harness && npm test`（含 typecheck）、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`。纯文档 / plan 状态 / OpenSpec 文案改动只跑后两项（§0 第 8 条）。
- P2/P7 plan 与总纲 §7 只加冲突说明并指向 P8；修订 `docs/concepts/skill-contracts.md` "P2 运行接线"节、`docs/concepts/phase-transition-policy.md`、`docs/operations/project-entry.md:30-32`、`templates/AGENTS.md.template` 完整交付一行、`skills/project/goal-mode/SKILL.md` 相关句。
- 宿主实跑顺序：批次 1 完成后先在 codex 宿主跑 RDB attended 场景，目的是早发现零设备裁剪与 run 内修订的实现问题；此时候选仍需手工准备（批次 2 的生成入口未到），**不得表述为普通用户入口已验收**。批次 2 后重跑同场景验收用户入口；批次 3 完成后再跑 RDB 无 run 交互场景。均由用户触发。
- Skill 单职责终点验收：spec / plan / coding 各补一条"只做本职责、在请求终点停止、不冒充整体完成"的验收，复用现有 request CLI 与阶段夹具；不为所有 Skill 新增无 Feature 的 request CLI。

---

## 8. 事实索引

| 事实 | 位置 |
|---|---|
| 范围纯函数与校验 | `harness/scripts/utils/execution-scope.ts:119`（resolve）、`:81`（validate） |
| AI 自报 not_applicable 直接裁掉 testing 的现状（D0.1） | `harness/tests/unit/execution-scope.unit.test.ts:150`（direct 模式的 device:impact） |
| 候选需手写指纹、无生成器（D0.2） | `feature-track.ts:79-85`；测试手算指纹 `execution-scope.unit.test.ts:143`；文档仅 `docs/operations/project-entry.md:30` |
| scope_revision_input 唯一生产者只在 spec/plan（D0.3） | `harness/scripts/utils/blueprint-skill-projection.ts:36-61`；check-coding / check-review 无 |
| coding 回退链外 plan 落 halt（D0.3） | `harness/scripts/utils/goal-assess-driver.ts:77-79`；`goal-phase-runtime.ts:9419-9426` |
| correction 流程尚未接通链外责任的有效范围修订（D0.3） | `correction-routing.ts`、`correction-commands.ts` 无 execution_scope 引用；`scope-replan.ts:195-204` 已消费 ExecutionScope 但无修订出口 |
| design-gap 场景由注入测试覆盖、生产触发未覆盖（D0.3） | `execution-scope.unit.test.ts:172-181` |
| 根因归属已有单一真源（D0.3 触发依据） | `harness/scripts/utils/repair-candidates.ts:379-383`（repair_owner 映射）、`:548`、`:861`（OWNER_CATEGORIES） |
| visual-evidence 无派生逻辑，只透传候选（D0.1） | `execution-scope.ts:56,69,78` 仅出现在常量与过滤，resolve 内无计算 |
| events.jsonl 无逐条哈希链，只有 run_created 有 event_hash（D2.1） | `goal-run-creation.ts:105`、`:159`、`:278`、`:346` |
| run_base_sha 是出生身份字段且 write-once（D2.4） | `goal-manifest.ts` computeManifestIdentityFields；`goal-phase-runtime.ts:3160-3223`；`goal-run-creation.ts:239-248`（successor 继承）与 `:249-254`（普通出生 HEAD 冻结，不属 successor 面，D2.5 不得删） |
| attended bridge 已有真实宿主记录；cursor 无 in-session（D1 动机） | `.cursor/verification/3.0.0-golden-three-screen-20260909/attended-review-*`；`agents/claude/adapter.yaml:112`；`agents/cursor/adapter.yaml` goal_capability.mode=external_runner |
| assess → NEXT_STEP 渲染已存在（§6） | `harness/scripts/utils/assess-renderer.ts:41-129` |
| 候选加载与验收再读 | `harness/scripts/utils/feature-track.ts:79-99` |
| 阶段输入按 run 加载范围 | `harness/scripts/utils/capability-resolution-entry-input.ts:229-290` |
| assess 范围来源 | `harness/scripts/utils/assess.ts:450-457`、`:895-902` |
| 修订意图发出 | `harness/scripts/goal-phase-runtime.ts:9062-9085`（读 scope_revision_input）、`:9342-9347`（emit） |
| 封卷 / 释放 / 后继循环 | `harness/scripts/goal-phase-runtime.ts:4211-4270` |
| 后继出生 | `harness/scripts/utils/goal-run-creation.ts:41-90`；`loadFrozenExecutionScope` `:93` |
| 可修订字段 | `harness/scripts/utils/goal-manifest.ts:751` |
| 完成写入 / 验证 | `harness/scripts/utils/verify-feature-completion.ts:560`、`:823`、`:876-882` |
| CU 预期链 | `harness/scripts/utils/change-unit-completion.ts:64-96` |
| reconcile-only 零设备 | `harness/harness-runner.ts:548-550` |
| 现有场景测试 | `harness/tests/unit/execution-scope.unit.test.ts:111-299` |
| 路径解析 | `harness/config.ts:1759`（featureFilePath）、`:1948`（resolveFeatureArtifact） |

---

## 9. 请 plan 先回答的问题

1. feature 冻结记录与无 run 完成原件的文件名、落点，以及与 `paths.features_dir` 三通道解析的关系。
2. D1 首次冻结在 harness-runner 的哪个位置发生（capability 解析之前），失败时报告形状。
3. D2 应用修订的位置是 phase 边界的哪一步（assess 之后、下一 phase 派发之前），以及与 `phaseDone` / 锁 touch 的先后。
4. 既有 attended 测试夹具中依赖 successor 的断言如何改写成 run 内断言，而不是删除断言。
5. `scope_revision_count` 是否需要进 completion schema 版本号递增；若需要，旧 1.2 记录如何解释。
6. D0.1 的 impact 字段放 `request` 还是独立顶层字段；`ExecutionScopeInput` 是否升 schema 版本。
7. D0.2 的 CLI 挂在 goal-mode-entry 还是 harness-runner；无 CU 的 feature 如何确定 requested_phases 默认值。
8. D0.3 中 check-coding / check-review 现有哪几个 check id 已带 repair_owner = spec / plan 归属可直接产出修订输入，列清单；写集越界类 check 归属 coding 时如何保证不误产修订。
9. D2.4 基线随修订事件冻结：所有读 `manifest.run_base_sha` 的位置清单、事件层 write-once 的实现，以及 drift decision / replay 层如何消费事件中的基线。
10. D0.1 visual 派生接 fidelity SSOT 的具体读取点（复用 `applicability.pixel_fidelity` 的哪个函数），以及 fidelity 缺失时 unknown 如何进 unresolved。
11. D2.3 "执行历史"从 events 的哪些事件类型派生，与现有 phase closure / evidence manifest 如何对账。
12. D1.3 "本次关联的 run"在 harness-runner 无 run 身份调用时如何识别 active run（复用现有哪个识别函数），以及 feature 记录 `transferred_to` 的写入时机。

---
name: 完成后演进与增量恢复统一 — 一个评估入口、一个执行出口、一组贯穿完成后修正的真实回归
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g6-change-unit-feature-pipeline-integration
  - g7-component-assembly-and-coverage-closure
  - g8-real-host-development-and-governance
relation: execution-trust-foundation
layer: change-unit
goal_requires:
  - blueprint-owned-terminology-scope-and-architecture-impact
  - obligation-driven-execution-scope
goal_provides:
  - feature-assessment-single-entry
  - post-completion-successor-exit
  - prior-release-host-snapshot-regression
real_host_validation: >
  宿主钱包 App（bc-openCard-2 工作区，CU open-card-flow-v2 已完成且绑定蓝图 rev2，蓝图已修到 rev3 并准入）：
  装新发布件后，不新建 v3、不回滚蓝图、不手改任何产物，经 /component-design 调和把 v2 的蓝图指针原位升到 rev3；
  assess 显示旧完成记录可信、逐义务给出 covered/uncovered；起 successor 只跑 uncovered 义务的责任阶段；
  新 completion 落新 run 目录、旧 completion 保留；最终 CU v2 在 rev3 下重新判定完成。
  同一宿主再走一次"完成后补测试"：只有 ut/testing 义务 uncovered，spec/plan/coding 证据复用。
  framework 快照夹具只证明机械行为，不替代上述语义验收。
parallel_authority_added: false
overview: >
  宿主"蓝图升版后已完成 CU 只剩新建 superseding CU 重走全链"不是单点 bug，而是 Maison 对"什么变了、
  影响哪些义务、哪些证据还能复用、剩下的谁做"没有统一解释：完成检查把"输入过期"和"凭证伪造"压成一个
  INVALID；CU 层、修正路由、运行时三套恢复规则各给一个答案；六个消费方各自复制半份判定；生命周期测试
  注入 verdict 从不撞真实裁决。本 plan 不建新模块：把现有绑定检查与 clean-pass 合成一个评估入口，
  uncovered 义务交现有责任路由与 successor 执行，CU 身份规则收成"契约不变即同一 CU、指针可原位升版"，
  并用上一版发布件的宿主快照跑五条完成后修正路径作为回归。精确引用解析器不放宽。
todos:
  - id: t1-assess-entry
    content: >
      §3.1：新建 assessFeature（拆 verifyFeatureCompletion：记录可信性 + 逐义务覆盖 = 绑定新鲜 ∧ 执行结果通过）：
      记录按自身 run 范围核验、覆盖按显式传入的本次范围判；unresolved/unknown 即 complete=false；clean-pass 的
      execution_scope 条目不摊回阶段；Feature↔CU 精确绑定失配收编为 plan 的 binding 缺口（artifact 与 derive 来源都覆盖）。
      删正则分类器与 STALE 裁决词；§3.5 六个消费方改接（observeChangeUnitCompletion、ready-set
      validateStaleReexecution、closure inputs、goal-status、goal-phase-runtime:4403、assess.ts）；按调用链替代完成后再删。
    status: completed
  - id: t2-cu-identity-reconcile
    content: >
      §3.3：CU 身份规则收敛——契约字段不变即同一 CU；carry-forward 通过时由唯一 consumer writer 原位升版三处指针
      （已完成与未完成同规则）；契约变化才新建 CU。closure inputs 双分支收为单路。`revises` 停止生成、保留读兼容。
      两份 OpenSpec 收成一条规则（§3.6）。
    status: completed
  - id: t3-successor-exit
    content: >
      §3.2：完成后修正 = `--supersede <完成 run>` 起 successor，顺序为「核合法源 run 与本次请求 → 在 supersede 上下文重解析候选
      （义务由当前输入重派生 + 既往证据复用）→ 建 run → 写审计 → 转交记录追加式改指后继、旧转交保留」；
      feature 载体（run_id=null）走 appendFeatureScopeRevision + fresh run，--supersede 对其拒绝。
      `--revalidate` 保持机械重验；AGENTS 模板 / phase-executor / MIGRATION 指引改指 successor。
    status: completed
  - id: t4-snapshot-core
    content: >
      §6：上一版发布件宿主快照夹具（由 real-chain 在钉住的 framework 提交上产出并提交）；本事故路径（蓝图升版）正例
      + 三条核心反例（伪造 completion、契约变化不得同 CU、carry-forward 失败不升版）随批一登记为 release-only 套件。
      t1–t4 同批交付，收口跑一次全量。
    status: completed
  - id: t5-five-paths-gate
    content: >
      §6 其余四条路径（补测试、改文案、改验收、证据损坏）从公开入口走到新完成结论并断言实际重跑范围；
      `release:verify` 接入：快照上已完成产物新增 BLOCKER 即发布失败，除非 MIGRATION 登记可验证迁移路径并重生成快照。
    status: completed
---

# 完成后演进与增量恢复统一（评估入口 / successor 出口 / 快照回归）

> 需求输入：用户 2026-09-24/25 裁决「方向按 codex，实施精简、简单、高效、统一」；codex 三轮意见（§9）。
> 代码基线：main 91aab353。事故：宿主 bc-openCard-2 于 2026-09-24 装 3.1.0 发布件（含 7753c18f）后，
> 新 run 撞 `change_unit_invalid`；agent 按 MIGRATION 修蓝图到 rev3 后，已完成 CU v2 的引用失效、completion 判 INVALID，
> 框架只剩"新建 superseding CU 重走六阶段"一条路。
> 三档（[e7a2c4f1](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §1.1）：蓝图指针漂移、验收文本变化属**第二档**（账本/形状），
> 现被判成一档阻断；本 plan 把"档"从检查者的手工判断改为义务覆盖结果的机器推导。

## 1. 事故链与证据（仓内核实，2026-09-24）

| # | 位置 | 事实 |
|---|---|---|
| 1 | `component-blueprint-validator.ts:71`、`component-blueprint-path.ts:157-166` | 7753c18f 新增的 `blueprint_node_module_missing` / 术语事实 / architecture_impact 三条准入规则挂在 `validateComponentBlueprint`，而它被 `resolveComponentBlueprintRef` 在**每次解析引用**时调用；上一版准入的蓝图 rev2 没有 `module` → 引用它的 CU 全部 `change_unit_invalid` |
| 2 | `component-blueprint-path.ts:143-153` | CU 的 `component_blueprint_ref` 锁 revision + source_fingerprint + artifact_sha256 三个精确值；蓝图只有一份 canonical 文件。蓝图升 rev3 后 v2 的 owner ref 在 `change-unit-validator.ts:104` 解析失败 → `change_unit_provenance_owner_unresolvable`（BLOCKER）→ `change-unit-path.ts:190` `change_unit_invalid` |
| 3 | `change-unit-completion.ts:187-192` | 已完成 CU 的观察器在 verify 判 VALID 后**再跑一遍** `validateChangeUnitFeatureProjection`，投影门走 `resolveChangeUnitRef` → 抛错 → state=INVALID「完成目标输入不可验证」。蓝图升版自身就足以让 v2 变 INVALID，与 acceptance.yaml 是否改动无关 |
| 4 | `verify-feature-completion.ts:1057`、`:1259` | `executionScopeEvidenceIssues` 有缺口即 `INVALID: 冻结范围尚未完成`；尾部用正则 `/失配\|非法\|缺失\|伪造\|血缘/` 分 INVALID/STALE，「requirement_sha256 与凭证记录失配（需求 SSOT 变更）」这种"世界变了"被判成"凭证伪造" |
| 5 | `component-closure-inputs.ts:245-297` | closure 对 owner ref ≠ 当前蓝图的 CU 走独立分支：跳过 provenance 解析、核 feature binding、再 `evaluateChangeUnitCarryForward`。说明设计意图本就允许已完成 CU 跨 revision，但只有 closure 接了 |
| 6 | `change-unit-feature-projection.ts:480,540-555`、`check-spec.ts:1267`、`check-plan.ts:989`、`change-unit-ready-set.ts:59-99` | spec/plan 门、ready-set 的 stale 重执行校验各自直接过精确解析器，对历史 revision 一律 fail-closed |
| 7 | `change-unit-model.ts:98`、`change-unit.schema.json:75` | `revises` 只有类型与 schema，全仓零消费者；`supersedes` 只在 closure 退役图消费。技能文档承诺的"修订 CU"路径不存在 |
| 8 | `openspec/specs/change-unit-continuous-progression/spec.md:288` | 「纠正已完成结果 MUST 创建新的 change_unit_id … 只有尚未实施 CU 可在蓝图调和后原位升 revision」 |
| 9 | `openspec/specs/correction-routing/spec.md:16` | 「Revalidation SHALL be executed by --revalidate … runs only the necessary existing checks」 |
| 10 | `revalidate.ts:48-75`、`verify-feature-completion.ts:704` | `planRevalidation` 跳过从未跑过的阶段、只跑脚本门；completion 原件写在 run 目录固定文件名下，同 run 再签会覆盖旧原件 |
| 11 | `harness/tests/unit/change-unit-progression.unit.test.ts:223` | `completionAdapter` 直接注入 VALID/STALE/INVALID，生命周期测试从不撞真实 completion 判定与投影门的组合 |
| 12 | `verify-feature-completion.ts:72-135`（实测） | `executionScopeEvidenceIssues` 只核绑定新鲜度与复用证据；required 义务无 satisfied_by、无执行证据时返回 `[]`。执行是否真的完成由 `collectCleanPassIssues`（`:300`）按**阶段**核，不按义务 |
| 13 | `feature-track.ts:282`、`capability-resolution.ts:575` | design-context 义务的 basis 既可能是 `derive.blueprint-contracts`，也可能是 `artifact: contracts@1`（依赖 contracts.yaml 字节）；宿主实际是后者。只改 change-unit.yaml 时 contracts.yaml 字节不变，普通绑定检查看不见 CU 已变 |
| 14 | `goal-phase-runtime.ts:4729,5141,6001`、`feature-execution-scope.ts:626-635,343` | 固定顺序：出生解析 → 建 run → 写 supersede 审计；出生解析器遇 `transferred_to` 直接抛错、候选漂移直接抛错；转交记录已有值时拒绝再转交 |

**结论**：三套恢复规则（#8 CU 层 / #9 修正路由 / 运行时范围修订 + successor）对同一个问题各给一个答案；六个消费方各持半份判定（#3/#5/#6）；"世界变了"与"凭证坏了"混成一个 INVALID（#4）；没有任何测试在"上一版产物 + 本版规则"上跑（#11）。宿主 agent 拿到的三个选项没有一个是框架设计出来的路。

## 2. 三个结构性问题（与 codex 一致，措辞收敛）

1. **三个"有效"压成一个状态**：「历史凭证可不可信」「它还覆盖当前哪些义务」「当前交付是否完成」是三问。现在一个 INVALID 回答全部，下游又把它当证据完整性故障。
2. **各层能拒绝，没有共同的恢复约定**：修正应保留什么、重验什么、谁重新确认完成，三套规则组合后无解。
3. **验证偏局部判据**：局部都绿，宿主一做"完成后再修正"就撞。

上一稿我提出的"resolver 放宽 / admitted_under 戳 / 内容寻址档案"三项**全部撤回**（codex P1-2 属实：carry-forward 只证地址与准入，不证内容；`admission: pass` 是 YAML 里的数据，不足以替代校验）。

## 3. 设计（不建新模块：一个入口、一个出口、一条身份规则）

### 3.1 统一评估入口 `assessFeature`

新增 `harness/scripts/utils/feature-assessment.ts`，唯一导出：

```ts
assessFeature(projectRoot, feature, opts: { expectedTrack; frameworkRoot; currentRunId? }): FeatureAssessment
// FeatureAssessment
//   record: { state: 'absent' } | { state: 'ok' | 'broken'; run_id: string | null; generated_at; reasons: string[] }
//   obligations: Array<{ id; kind; owner_phase; applicability; status: 'covered' | 'uncovered';
//                        class?: 'binding' | 'evidence' | 'result' | 'unknown'; reason?: string }>
//   blocking: string[]        // 与义务无关但阻止"完成"的世界事实：晚于凭证的未终局 run、corrupt run
//   complete: boolean         // record.state==='ok' && blocking 空 && 所有 required 义务 covered
```

**组成，全部从既有函数拆出，不新写判据**：

| 部分 | 来源 | 规则 |
|---|---|---|
| `record` | `verifyFeatureCompletion` `:925-1030` 的记录自洽段：投影/原件哈希、schema、chain vs workflow、phases↔chain、run_id 载体、run 事件血缘、attempt、gate_fingerprint、supersede 审计 | 任一失败 → `broken`。这是唯一还叫"凭证不可信"的东西 |
| `obligations[].status` 之 binding/evidence | `executionScopeEvidenceIssues`（`:72`）逐义务结果 | 输入绑定 stale（经 `readBoundInput` 内容对齐后仍 stale）→ `uncovered/binding`；复用证据失效 → `uncovered/evidence` |
| `obligations[].status` 之 result | `collectCleanPassIssues`（`:300`）的阶段级违例，按 `owner_phase` 摊回义务 | 责任阶段有任何 clean-pass 违例、或 required 义务的责任阶段不在 record.phases 且无 satisfied_by → `uncovered/result` 或 `uncovered/evidence`。**绑定无错不构成 covered**（codex P1-1） |
| `obligations[].status` 之 unknown | `applicability==='unknown'` | 一律 `uncovered/unknown` |
| 顶层 `artifact_hashes` / `requirement_sha256` / `review_attestation_aggregate` / `testing_source_aggregate`（`:1190-1215`） | 1.2 范围下它们已是义务绑定，不再单独比；1.1 legacy completion 保留比对，结果按责任阶段挂到义务（spec←spec/acceptance、plan←contracts、review←attestation、testing←source） | 失效只沿真实消费关系传播 |
| `blocking` | `:1240-1256` 晚于凭证的未终局 run、`collectCleanPassIssues` 的 corrupt run | 不是义务缺口，不路由到阶段，进 blocking |

**两套范围，不混用**（codex 三轮 P1-3）：`record` 按**它自己的** run 范围核验（`loadEffectiveExecutionScope(feature, record.run_id)`）；覆盖判定针对**调用方显式传入的本次合法范围** `opts.scope`——run 内是当前 run 有效范围，successor 出生是重新解析出的候选，无 run 的 CLI 是 feature 冻结记录的有效范围。新请求不得只读旧 record 的义务清单。传入范围 `unresolved` 非空或任一义务 `applicability === 'unknown'` → `complete: false`。无 record → `record.absent`；无范围可传 → `obligations: []`、`complete: false`。新 Feature 起步仍走 `--prepare-scope`，不经 assess。

**归因不重复计数**：`collectCleanPassIssues` 已把 `executionScopeEvidenceIssues` 的结果以 `condition: 'execution_scope'` 挂在 `chain[0]`（`:303-306`）。assess 摊派时**剔除**该 condition 的条目（绑定缺口已按义务算过），不得把 acceptance 绑定变化再算成 coding 的产品失败。

**Feature↔CU 精确绑定收编**（codex 三轮 P1-1）：design-context 义务可绑 `artifact: contracts@1`（§1 #13），只改 change-unit.yaml 时 contracts.yaml 字节不变，普通绑定检查看不见。assess 对 `cu-` feature 额外调用**现有** `inspectDerivedFeatureBinding` / `resolveChangeUnitRef` 的身份核对：contracts.yaml `change_unit_ref` 的 revision / artifact_sha256 与 canonical CU 失配 → plan 义务 `uncovered/binding`；artifact 与 derive 两种来源同样处理。复用旧检查，不加机制。

**删除**：`:1259` 正则分类器；`STALE` 作为裁决词（`CompletionVerdictKind` 收为 `VALID | INVALID` 仅供 `record` 内部使用，对外只暴露 `FeatureAssessment`）；`observeChangeUnitCompletion` `:187-192` 的二次投影门。

**三档在此处的机器落点**：`uncovered/result` = 一档（产品真值）；`uncovered/binding|evidence` = 二档（能内容对齐的已在 `readBoundInput` 自动对齐，对不齐才 uncovered 且只回责任阶段重做，不阻断其它阶段）；`uncovered/unknown` = 三档（沿用 unsupported_gap 语义）。不再由各检查自己拍 BLOCKER/WARN。

### 3.2 唯一执行出口：uncovered 按 owner_phase 交现有路由

| 时机 | 出口 | 现有机制 |
|---|---|---|
| run 内 | 范围修订 | `tryScopeReplan`（scope-replan.ts:112）、`scope_revised` 事件 |
| 完成后修正 | **successor**：`goal-runner --supersede <record.run_id>` | `createGoalRun`（goal-run-creation.ts:573）、`buildSupersedeAuditEvent`（`:273`） |
| 只需机械重验 | `--revalidate` 不变 | revalidate.ts；它**不签发** completion（现状） |

**successor 出生范围**（t3 的改动点：`goal-phase-runtime.ts:4721-4730`、`:4794-4799`、`:5141`、`:6001`；`feature-execution-scope.ts:321-345`）：
现状 successor **整份继承**源 run 有效范围并跳过出生解析（第五轮阻断 1）；整份继承拿不到改验收带来的新义务。
现有顺序是「解析出生范围（4729）→ 建 run（5141）→ 写 supersede 审计（6001）」，所以**不能**用"已审计"作出生解析的前提
（codex 三轮 P1-2，我上一稿写成了循环）。改为：

1. **先核合法 supersede 源与本次请求**：源 run manifest 可加载、出生记录 complete/legacy、终态 HALTED/COMPLETED/CHAIN_SLICE_COMPLETED（复用 `:4757-4767` 现有校验）；本次 requirement / requirement-file 已解析；
2. **在该 supersede 上下文中重新解析候选**：走 `resolveFeatureExecutionScope` 的 candidate 路径（`feature-execution-scope.ts:642`），义务由当前输入重新派生，`satisfied_by` 复用经 `executionScopeEvidenceIssues` 核验的既往阶段证据（feature-track.ts:350-357 现有逻辑），`phase_chain` = uncovered 义务的责任阶段。feature 记录的 `transferred_to` 在此上下文**不作出生范围来源、也不抛错**，只作血缘核对：必须等于本次 supersede 的源 run，否则拒绝出生；
3. `createGoalRun` 建后继 run，随后在现有位置写 supersede 审计事件；
4. **转交记录追加式改指后继、旧转交保留为历史**：`FeatureFrozenScope` 的转交由单值改为 `transfers[]`（最新一条即当前 `transferred_to` 语义，读侧兼容旧单值）；`registerFeatureScopeTransfer` 只在「旧转交对象 = 本次已审计的 supersede 源」时允许再转交，其余情形照旧拒绝（`:343`）。

不新写第二条范围构造器。新 completion 落 `goal-runs/<successor>/`，旧原件天然保留（`:704` 按 run 目录写）。

**feature 载体（`record.run_id === null`，runless completion）**：没有 run 可 supersede，不得 `--supersede null`。它的记录没有转交，完成后修正走现有 `appendFeatureScopeRevision`（`:282`，按当前输入追加范围修订）再起 **fresh run**（`evaluateFreshRunContinuation` 只拦失败终态 run，`:466`），出生解析读修订后的有效范围；`--supersede` 对它直接拒绝并提示走修订。

缺产出（补设计、产出测试、真机测试）就是 uncovered 义务的责任阶段被列入 `phase_chain`，由既有 runtime 真实执行；
`--revalidate` 不承担这些（codex P1-3）。

**指引改口**（宿主侧只给话术）：`templates/AGENTS.md.template:72`、`agents/claude/templates/agents/phase-executor.md:47`、
`docs/operations/project-entry.md`、MIGRATION：完成后修正 = "在同一 feature 上以 supersede 起后继，范围由框架算"；
在途修正仍 `--revalidate`。

### 3.3 CU 身份规则：契约不变即同一 CU，指针可原位升版

| 变化 | 处置 |
|---|---|
| 补证据、机械修复、验收/文案/蓝图**输入**变化，change-unit.yaml **契约字段**不变 | 同一 CU；uncovered 义务经 §3.2 补齐 |
| 蓝图升 admitted revision，且 `evaluateChangeUnitCarryForward` 通过（全部 target 仍解析且获准、无 unknown/open_decision/blocker） | **原位升版**：唯一 consumer writer（`change-unit-design-preparation.ts:110` `acceptChangeUnitDecomposition` 所在模块）重写 `component_blueprint_ref` / `design_refs[]` / `touches[].design_ref` 三处身份指针（revision、source_fingerprint、artifact_sha256）并 `revision+1`；change_unit_id 不变。**已完成与未完成 CU 同规则**，删掉 #8 的"只有尚未实施 CU 可原位升"限制 |
| carry-forward 失败 | 不升版；ready-set/closure 沿现状报 `carry_forward: false` + 原因，路由 `reconcile_blueprint`（回 /component-design 修蓝图或新建 CU） |
| 契约字段变化：`provides` / `requires` / `target_predicates` / `touches`（含 owner 与 design_ref 的 target 地址）/ `preserved_invariants` / `design_refs` 的 target 地址 | 新 `change_unit_id` + `supersedes`（现有规则；codex P1-4：不止两个字段） |
| `revises` | 停止生成；schema/model 保留可选字段供旧数据读取，不新增消费者 |

原位升版后 feature `contracts.yaml` 的 `change_unit_ref.artifact_sha256` 与 CU 不再一致。注意 contracts.yaml **本身字节不变**，
普通输入绑定看不见它——由 §3.1 收编的 Feature↔CU 精确绑定核对判 plan 义务 `uncovered/binding` → successor 的 plan 阶段重新投影
contracts（含新 change_unit_ref）。这条链是**计算出来**的，不是特例，但它依赖收编旧检查，不会自动发生。

**精确解析器不动**：`resolveComponentBlueprintRef`、`resolveChangeUnitRef` 保持身份 + 结构 + 目标有效性全量校验。
在途 CU 被新规则追溯判死仍属 MIGRATION 义务；只有已完成 CU 不再被解析器追溯，因为 §3.1 不拿旧 ref 过解析器。

"内容变了没有"不由 carry-forward 回答：design-context 义务的 basis 绑定就是 `derive.blueprint-acceptance` /
`derive.blueprint-contracts`（capability-resolution.ts:277），带 content_fingerprint。蓝图节点 `module` 变了 → 派生 contracts 变了 →
绑定 stale → plan 义务 uncovered → 在新蓝图下重新派生可修改模块集合（codex P1-2 的施工边界担忧在此闭合）。

### 3.4 closure inputs 收为单路

`component-closure-inputs.ts:245-297`：枚举 → `resolveChangeUnitRef` 精确解析；owner ref 身份不等于当前蓝图 → 不再进第二分支做
"无 provenance 校验 + binding 精确核对"，直接记 `carry_forward: false`（原因 = 未原位升版）。已按 §3.3 升版的 CU 天然走精确路。
completion 观察改调 `assessFeature`。`evaluateChangeUnitCarryForward` 保留，只回答 provides 能否满足下游依赖。

### 3.5 消费方接线表（按调用链替代完成后再删旧路）

| 消费方 | 现状 | 改后 |
|---|---|---|
| `change-unit-completion.ts` `observeChangeUnitCompletion` | verify + 二次投影 | `assessFeature` → state = `absent` / `broken`→INVALID / `complete`→VALID / 否则 INCOMPLETE（附 uncovered 清单）；删二次投影 |
| `change-unit-ready-set.ts` `validateStaleReexecution` | 自跑投影 | 读 assess.uncovered 作 legal blocker 清单；删本函数 |
| `component-closure-inputs.ts` | 双分支 + observe | §3.4 单路 + assess |
| `goal-status.ts:107`、`goal-phase-runtime.ts:4403` | `verifyFeatureCompletion().verdict === 'VALID'` | `assessFeature().complete` |
| `harness/scripts/assess.ts`（无 run CLI） | summary/staleness 拼装 | 展示 assess 的 record / uncovered / blocking |
| `check-spec.ts:1267`、`check-plan.ts:989` `loadChangeUnitBlueprintScope` | 精确解析 | **不改**：它们只在活跃 run 的 spec/plan 阶段跑，CU 已按 §3.3 升版 |
| `check-review.ts:1000` | `resolveChangeUnitRef` | 不改，同上 |
| `revalidate.ts` | 机械重验 | 不改；指引改口 |

### 3.6 规格收敛（两份 OpenSpec 收成一条规则，不新建 spec 文件）

- `change-unit-continuous-progression/spec.md:288` Requirement「Reconciliation re-resolves stable targets…」：
  删「纠正已完成结果 MUST 创建新的 change_unit_id … 只有尚未实施 CU 可原位升 revision」，改为 §3.3 表；
  新增 Scenario「蓝图升版、全部 target 仍解析 → 已完成 CU 原位升版，successor 只补 uncovered」与
  「契约字段变化 → 新 change_unit_id」；`ABSENT|VALID|STALE|INVALID` 措辞改为 assess 三态 + uncovered。
- `correction-routing/spec.md:16`：保留 `--revalidate` 为在途机械重验；新增 Requirement「完成后修正经 successor，范围由评估入口计算；
  `--revalidate` 不签发 completion」。
- `reconcile-assessment/spec.md`：Requirement「Assessment deterministically observes…」下补 `assessFeature` 为唯一完成评估入口。
- `verdict-lattice/spec.md`、`goal-runner/spec.md`、`feature-artifact-layout/spec.md`、`component-assembly-coverage-closure/spec.md` 中 STALE 措辞同步。
- 建一个 OpenSpec change（`post-completion-evolution-unification`），t5 归档。

## 4. 保留 / 裁剪双清单

**保留**：`resolveComponentBlueprintRef` / `resolveChangeUnitRef` 全量校验；`executionScopeEvidenceIssues` 与 `readBoundInput` 内容对齐；
`collectCleanPassIssues` 六条件；completion 1.2 记录格式与写入位置；`evaluateChangeUnitCarryForward`；`tryScopeReplan`；
`createGoalRun` / supersede 审计；`appendFeatureScopeRevision`；`inspectDerivedFeatureBinding`（收编进 assess）；`--revalidate`；responsible phase routing（b6e4c9f2）；局部注入 verdict 的单测（只限单元级）。

**裁剪**：`:1259` 正则分类器；`STALE` 裁决词；`observeChangeUnitCompletion` 二次投影；`validateStaleReexecution`；closure inputs 第二分支；
successor 整份继承范围（改走出生解析器）；规格 #8 的"已完成 CU 必新建 id"与"只有未实施 CU 可原位升版"；`revises` 生成。

**新增接线（唯一且点名复用目标）**：`assessFeature`（拆自 `verifyFeatureCompletion` + `collectCleanPassIssues`，六处消费同源）；
CU 指针原位升版（挂在唯一 consumer writer）；successor 出生复用候选解析路径 `resolveFeatureExecutionScope` + 转交记录追加式 `transfers[]`（同一记录内，不是新状态文件）；快照夹具一份 + release-only 套件一个。

## 5. 明确不做

- 不放宽任何精确引用解析器；不加 `admitted_under` 戳；不建蓝图 revision 档案或内容寻址库；不建语义 diff / invalidates 引擎。
- 不新建四个"职责模块"、不建通用图执行器、不加 registry / ledger / 第二状态机。
- 不要求所有破坏性变更自带自动迁移器：发布门要求的是**可验证迁移路径**（MIGRATION 条目 + 快照重生成后全绿）。
- 非 CU-bound 平铺 Feature：completion 评估同样改接 `assessFeature`，其余流程字节级不变。
- 不动 Goal Mode 运行权威、预算、events 协议。

## 6. 验收（正反例；t4 批一登记 ★ 项，t5 补齐其余）

夹具：`harness/tests/fixtures/host-snapshot-3.1.0/`——由 `real-chain` 在钉住的 framework 提交上跑完六阶段后捕获的宿主状态
（一个已完成 CU、其蓝图、goal-runs、completion；去除大二进制），随夹具记录产出提交号。套件 `lifecycle-evolution`，
`run-unit.ts` 显式登记 `releaseOnly: true`（同 real-chain）。所有用例从**公开入口**走：`/component-design` 调和 → `goal-runner --supersede` →
successor 执行 → 新 completion；断言实际重跑阶段集合、旧 completion 保留、越权反例。

| # | 场景 | 预期 |
|---|---|---|
| ★1 | 快照原样，不动任何文件 | `assessFeature`：record ok、全部 covered、`complete: true`。**发布门基线**：本版任何规则让它变 false 即发布失败 |
| ★2 | **本事故**：蓝图按新规则补 `module` 升 rev3 准入（含改进投影的内容）；CU v2 completed 绑 rev2 | **评估核心**（feature-assessment 单测）：只改 change-unit.yaml、contracts.yaml 不动 → record ok，plan `uncovered/binding` 且原因为 CU 绑定失配（**contracts.yaml 字节未变仍须判出**）。**端到端**（lifecycle L1，2026-09-26 按实测对齐）：调和 carry-forward 通过 → v2 三处指针原位升版指向 rev3、change_unit_id 不变，同批原子刷新旧机器投影（来源戳指向升版前身份）；successor 按 §3.2 顺序出生，候选按当前输入重生成，spec/plan 由刷新后的派生投影绑定覆盖、不进链；`phase_chain` = assess 判 uncovered 的责任阶段（快照实测 `[coding, review, ut]`，因这些阶段的证据清单登记了被刷新的派生文件为输入），`reused_phases` 为空；`transfers[]` 两条；新 completion 落新 run 目录，旧的仍在；不出现 v3 |
| ★3 | 伪造：手改 completion 原件里的 phases[].run_id | record `broken`；不进 uncovered；successor 不得以它为复用证据 |
| ★4 | 契约变化：CU `touches` 新增模块 | 调和拒绝原位升版，要求新 change_unit_id + supersedes；旧 CU 记录保留 |
| ★5 | carry-forward 失败：蓝图升版删掉 v2 一个 design_ref target | 不升版；ready-set/closure `carry_forward: false` 带原因；路由 `reconcile_blueprint`；不判 record broken |
| 6 | 完成后补测试：acceptance 加一条 ut 层断言，测试由后继 UT 以新增文件/用例产出 | **按真实消费关系重跑**（2026-09-25 用户裁决）：证据清单登记了 acceptance.yaml 为输入的阶段判 `uncovered/evidence`，successor 出生链 = assess 判 uncovered 的责任阶段（快照里为全链）；未登记的阶段复用；跑到新的完成结论 |
| 7 | 改文案：spec.md 改一段说明，acceptance 不变 | **按真实消费关系重跑**：证据清单登记了 spec.md 为输入的阶段判 `uncovered/evidence`（快照里为全链），出生链 = assess 判 uncovered 的责任阶段；不为"只改文案"另设豁免；跑到新的完成结论 |
| 8 | 改验收：acceptance 新增一条设备层断言 | 新义务 `uncovered/evidence` 落 testing；登记了 acceptance.yaml 为输入的阶段同样**按真实消费关系重跑**；successor 真实执行，夹具下 testing 走替身设备链，断言 `acceptance_to_test_case` FAIL 且 `complete=false`，不得假 PASS |
| 9 | 证据损坏：删 ut 的 `phase-evidence-manifest.json` | ut 义务 uncovered/evidence；record 仍 ok（记录未改）；successor 重跑 ut |
| 10 | 晚于凭证的未终局 run 在场 | `blocking` 非空、`complete: false`；不路由阶段 |
| 11 | 在途（未完成）CU 绑旧蓝图 rev2，新规则下 rev2 不过准入 | 仍 `change_unit_invalid`（解析器不放宽）；MIGRATION 指引修蓝图；升版后走 ★2 |
| 12 | `revises` 字段存在的旧 CU | 可读、不报 schema 错、不产生任何行为 |
| 13 | 非 CU-bound 平铺 Feature 完成后改 spec | assess 同规则；其余门禁与现状字节级一致 |
| 14 | 局部单测 `completionAdapter` 注入 VALID（既有） | 保留；但 lifecycle-evolution 内禁止注入 verdict，必须过真实 assess |
| 15 | feature 载体 runless completion 后改验收 | `--supersede` 拒绝并指向修订；`appendFeatureScopeRevision` 后 fresh run 出生读修订范围；新义务 uncovered，其余复用 |
| 16 | successor 源 run 出生记录 creation_incomplete，或 feature 转交对象 ≠ 本次 supersede 源 | 出生拒绝；不建 run、不写审计、转交记录不变 |
| 17 | 传入范围 `unresolved` 非空 | `complete: false`，unresolved 条目以 `uncovered/unknown` 呈现，不路由到阶段 |
| 18 | 只改 acceptance.yaml 一处绑定依据，coding 产物未动 | 仅 spec/testing 相关义务 `uncovered/binding`；coding 义务**不得**因 chain[0] 的 execution_scope 条目被判 `uncovered/result` |

反向变异（实施期每条 ★ 至少一次）：把 assess 的 result 摊派删掉 → ★1 仍 true 但 6/8/9 必须转红；把正则分类器加回 → ★2 的 record 变 broken 即抓到。

## 7. 必答七问（总纲 §12.1）

1. g6（CU 的 Feature/Goal Mode 完成事实与 evidence 权威统一到一个评估入口）、g7（closure 输入单路）、g8（上一版宿主快照进发布门）。
2. 解决"完成后演进"这一层的 concern：变化影响哪些义务、证据能否复用、剩余由谁做。放 CU 层会重造 registry，放修正路由会绕开 run 权威。
3. 输入真源：completion 记录、run events、有效执行范围、CU/蓝图 canonical；消费者：ready-set、closure、goal-status、runtime 完成判定、assess CLI、successor 出生。
4. 不新增状态、索引、注册表；新增一个拆分出的函数、一个 writer 内的指针升版动作、feature 冻结记录内转交字段改追加式、一份夹具。
5. 完成判定只此一处；范围只经出生解析器；CU 指针只由 consumer writer 改；`revises` 不再是第二条修订路径。
6. frontmatter `real_host_validation`：宿主 bc-openCard-2 在 rev3 下不新建 v3 完成 v2，再做一次"完成后补测试"只跑 ut/testing。
7. 若宿主实测显示 successor 出生解析被转交记录以外的原因挡住、或原位升版后 plan 重投影在真实蓝图上不收敛，说明 §3.2/§3.3 尺子错了：
   回滚 t2/t3，保留 t1/t4（评估入口与快照仍独立有效），原因回灌总纲 §8.2。

## 8. 文件、顺序与验证

主要文件：`harness/scripts/utils/feature-assessment.ts`（新）、`verify-feature-completion.ts`（拆分、删分类器）、`change-unit-completion.ts`、
`change-unit-ready-set.ts`、`component-closure-inputs.ts`、`change-unit-reconciliation.ts`（不改判据）、`change-unit-design-preparation.ts`（指针升版）、
`change-unit-model.ts` / `change-unit.schema.json`（`revises` 注释停用）、`goal-phase-runtime.ts:4721-4730,4794-4799`、`goal-run-creation.ts`、
`goal-status.ts`、`scripts/assess.ts`、`revalidate.ts`（仅注释/指引）、`templates/AGENTS.md.template`、`agents/claude/templates/agents/phase-executor.md`、
`skills/project/change-unit-progression/SKILL.md`、`skills/project/component-design/SKILL.md`、`docs/operations/project-entry.md`、`MIGRATION.md`、
四份 OpenSpec、`harness/tests/run-unit.ts`、`harness/tests/unit/lifecycle-evolution.unit.test.ts`（新）、`harness/tests/fixtures/host-snapshot-3.1.0/`（新）。

顺序：t1 → t2 → t3 → t4 为**批一**，同批交付（codex 收窄 1：不得先删校验、后补反例）；t5 为批二。每步子代理只跑过滤套件，批一收口跑一次全量。

```bash
cd harness && npm run test:unit -- --filter lifecycle-evolution
```

```bash
cd harness && npm run test:unit -- --filter real-chain
```

```bash
cd harness && npm test
```

另：`node scripts/check-plan-version.mjs`、`npm run openspec:validate`、docs 行数预算全绿；宿主验收按 `real_host_validation`。

## 9. codex 两轮意见对照

| 轮 | 意见 | 处置 |
|---|---|---|
| 一 | 三个"有效"压成一个状态 | 收：§3.1 record / obligations / complete 三分 |
| 一 | 各层能拒绝无共同恢复约定 | 收：§3.2 一个出口 + §3.6 规格收一条 |
| 一 | 验证偏局部 | 收：§6 快照 + 五路径 |
| 一 | 四职责表 | 收其语义，不建四模块：职责一 = 现有 scope，二三 = `assessFeature`，四 = 现有路由吃其输出 |
| 二 P1-1 | `executionScopeEvidenceIssues` 不是完整覆盖判定 | 属实（§1 #12 实测）。§3.1 合成 clean-pass 阶段结果按 owner_phase 摊派；绑定无错不算 covered；新 Feature 走 `--prepare-scope` |
| 二 P1-2 | 不能放宽 resolver 并把 carry-forward 当无影响 | 属实。撤回 resolver 放宽；历史继承在评估入口；内容变化由 design-context 绑定判；carry-forward 只作原位升版前提与依赖满足 |
| 二 P1-3 | `--revalidate` 不能当完成后出口；原件会覆盖 | 属实。§3.2 successor 出生走出生解析器；新 completion 落新 run 目录 |
| 二 P1-4 | CU 语义边界不止两个字段 | 属实。§3.3 契约字段全集；"change-unit.yaml 契约不变即同一 CU" |
| 二 收窄 1 | 快照与核心反例随批一 | 收：t4 在批一，★ 项为核心反例 |
| 二 收窄 2 | 发布门只挡意外回归，不强求自动迁移器 | 收：§5、★1 基线 + MIGRATION 可验证迁移路径 |
| 二 收窄 3 | 按调用链替代后再删；`revises` 停产保留读；局部注入单测保留 | 收：§3.5、§3.3、§6 #12/#14 |
| 三 P1-1 | CU 哈希失配靠内容指纹发现不了（design-context 绑 `contracts@1`） | 属实（§1 #13）。§3.1/§3.3 收编 `inspectDerivedFeatureBinding` / `resolveChangeUnitRef` 身份核对为 plan binding 缺口；§6 ★2 断言 contracts 字节未变仍判出 |
| 三 P1-2 | "已审计再出生"是循环；出生解析器遇转交/漂移直接抛错 | 属实（§1 #14）。§3.2 改为核源与请求 → 上下文内重解析候选 → 建 run → 写审计 → 转交追加式；feature 载体走 `appendFeatureScopeRevision` + fresh run；§6 #15/#16 |
| 三 P1-3 | 历史按旧范围、当前按本次范围；unknown → 不完成；clean-pass 已含绑定错误挂 chain[0] | 属实（`:303-306`）。§3.1 两套范围不混用、unresolved/unknown → false、execution_scope 条目不摊回阶段；§6 #17/#18 |
| 三 已澄清 | 已完成 CU 可原位升版；successor 可重算范围；阶段粒度作首期；record 混入当前证据降为正文同步 | 收：§3.3、§3.2、§3.1 按此定稿 |

## 实施记录

### t4a 快照生成（2026-09-25，未提交）

**结论：停在切点，待调度裁决。** 生成器可用、原址 ★1 VALID；但 §6 夹具的两个前提在 91aab353 上不成立，未入库 `project/`。

做了什么：
- 新增 `harness/tests/fixtures/host-snapshot-3.1.0/generate.ts`：复用 real-chain 正例 helper（均已 export，**未改任何非夹具文件**），
  跑 `runGoalRuntimeChain(realHarness)` 六阶段到 feature completion，捕获宿主目录到 `project/`；`--verify` 把快照复制到仓外 tmp、
  provision 当前框架后经公开入口 `goal-status` 判 ★1；导出 `loadHostSnapshot()` 供后续 lifecycle-evolution 复用。
- 新增同目录 `README.md`（生成命令、排除清单与核对、可移植性阻断证据）。
- 环境基线：`cd harness && npm run test:unit -- --filter real-chain` → `11 passed, 0 failed`（real-chain 3 + real-chain-seams 8，7m19s）。
- 试生成：`npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts` EXIT=0；feature `demo-card`，
  run `20260925T040040Z-ddadde`（终态 `CHAIN_SLICE_COMPLETED`），168 文件、约 1.5 MB、文本全 LF（node 扫描 crlf=0）。

★1 验证（`goal-status`，生产 `verifyFeatureCompletion`）：
- 生成根原址：`feature_status=FEATURE_COMPLETED (verify=VALID, chain=spec→plan→coding→review→ut→testing)`；
  移走 `.git` / `build/` / `fake-deveco/` 后原址重跑仍同一输出（排除项不影响判定）。
- 换根加载（`generate.ts --verify`）：`feature_status=FEATURE_INCOMPLETE (verify=INVALID; 冻结范围尚未完成；acceptance-context:pending: input binding stale C:\Users\shengqsq\AppData\Local\Temp\real-chain-FwX2Pd\doc\features\demo-card\acceptance.yaml…)`，`BASELINE_STAR1=FAIL`。
- 加载时把 events.jsonl 中生成根改写为加载根（75 处）：`feature_status=FEATURE_INCOMPLETE (verify 失败：[execution-scope] 修订链断裂于 #2)`。

阻断一（可移植性，生产格式）：`scope_revised` 事件写入的 basis `dependencies[].path` 是绝对路径，且进 `executionScopeFingerprint`
与修订链；`executionScopeEvidenceIssues`（verify-feature-completion.ts:106）按绝对路径 `existsSync`/`isInsideProjectRoot`。
快照只能在生成根原址判 VALID；生成时改写会破证据哈希，加载时改写等于重签。附带的真实影响：宿主工程换目录/换机器克隆后，已完成 feature 判 INVALID。
可选方向（未实施，需裁决）：① t1 同批把范围依赖改为工程相对路径并对旧绝对路径按记录内一致前缀重定位（快照随之可移植，但 3.1.0 旧产物仍需读兼容）；
② 快照不入库、发布门在钉住提交的 worktree 上现场生成（约 2–3 分钟/次，产物天然"上一版"）；③ 固定生成根（跨用户/跨平台不可行，不建议）。

阻断二（CU-bound 前提）：real-chain 的六阶段链是**平铺 Feature `demo-card`**；`real-chain.unit.test.ts:1080` 明载 CU-bound 不进 goal 链
（合成宿主 test-chain profile 无 design lens），全仓无 CU-bound 六阶段 goal 链（real-chain / seams 全部 `featureId: project.feature`）。
§6 所述"一个已完成 CU、其蓝图"无法由现有 real-chain 产出；★1 / #6–#10 / #13 可用平铺快照，★2 / ★4 / ★5 / #11 / #12 需要新建 CU-bound 链变体（新工程量，未估）。

排除清单：`framework/`（被替换的发布件，加载时 provision 当前代码）、`.git`（不可嵌入）、`build/`（替身 .hap，仅诊断文本提及）、
`fake-deveco/`（假工具链；`framework.local.json` 的 installPath 改写为 `./fake-deveco`）。绑定面核对：六阶段 manifest inputs/outputs
与范围 dependencies 全部落在 `02-Feature/**`、`doc/features/demo-card/**`。

未做：`project/` 已删除未入库（含本机用户名路径且换根即红）；生成根 `C:\Users\shengqsq\AppData\Local\Temp\real-chain-FwX2Pd` 保留供复核。

#### t4a 第二轮（2026-09-25，调度裁决后续做，未提交；取代上文"停在切点 / project 未入库"的结论）

两条裁决：
- **可移植性**：只做读侧重定位。不改写入格式、不改任何指纹、不改 events / frozen record；上文 ①②③ 均不选。
- **CU 绑定链**：本批新建，以测试侧为主。

顺序已照办：先做 CU 链变体，**在改任何生产代码之前**用基线代码生成快照，最后才实施读侧重定位。

**1. CU 绑定链变体**（只改测试；生产门没有拦，未改生产代码）
- 在 `harness/tests/unit/real-chain.unit.test.ts` 新增：
  - 宿主前置 `seedCuBoundHost`；
  - 三阶段作者材料 `writeCuCodingMaterials` / `writeCuReviewMaterials` / `writeCuUtMaterials`；
  - 链驱动 `runCuBoundChain`，正例链抽成 `runDemoCardChain`（语义不变）；
  - 公开入口判定 `goalStatusFeatureLine`；
  - 用例「real-chain CU 绑定链：canonical CU 经 coding→review→ut 真实 harness 到 feature completion」。
- 顺带把 `readSummary` / `dumpPhase` / `publishVerifier` / 证据 manifest / ai-prompt 的读路径改经 `featureRelativePath`；对平铺 id 字节级不变。
- 链的形状由实跑确定，每条都对应一个生产门：
  - 设计内容经生产 `materializeBlueprintSkillInputs`（即 `prepare-blueprint-design` CLI）物化。否则 coding 报 `acceptance@1 missing (producer=spec)`。
  - acceptance/design 义务由蓝图满足，出生链为 `[coding, review, ut]`。
  - 给出影响判断 `user_visible_behavior_change=false`。否则 `device-evidence` 义务 unknown、范围 unresolved，完成不了。
  - implementation/test ref 必须是已存在文件：物化拒绝缺失文件，ut 期拒绝 `planned:`（`change_unit_mapping_planned_ref_not_allowed`）。所以基线预置两份空壳，coding / ut 各自改写。
  - use-cases 必须有非空 `ui_bindings`（`usecase_ui_bindings_nonempty`）；复杂流要求 ephemeral DAG（`change_unit_dag_required`）；branch 用例需要 `[BRANCH-success]` 标签（`branch_coverage_full`）。
  - 施工落点放在 `src/ledger/**`，刻意不在任何产品源码根里。平铺 Feature 的完成凭证绑定全量产品源码 inventory（`testing_source_aggregate`），CU 改动若落在模块根里，两个 Feature 的完成凭证会互相作废。
- **放弃的准确性**：CU 链不含 spec/plan/testing（蓝图承担 spec/plan，无设备义务）；施工落点不在真实 HAR 模块内，模块内 CU 与平铺 Feature 共存时凭证互相作废的问题未覆盖。

**2. 快照（基线代码产出）**
- 生产代码 `git diff` 为空时，`npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts` 成功（GENDONE_EXIT=0）。
- 一个宿主、两个已完成 Feature，都在生成根原址判了 VALID 才捕获：

  | Feature | run | 身份 |
  |---|---|---|
  | 平铺 `demo-card` | `20260925T043142Z-233c9c` | — |
  | `cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g` | `20260925T043336Z-8e78e2` | blueprint `ledger-app-blueprint` rev 2；CU `ledger-refresh` rev 1 |

- 265 个文件，约 2.2 MB，crlf=0。
- 绝对 tmp 路径原样入库（生成根 `...\Temp\real-chain-IojIur`）；只有 `framework.local.json` 的假 DevEco installPath 改为相对路径。
- 排除项同上文。
- 改代码前换根加载：
  - demo-card `verify=INVALID; 冻结范围尚未完成；acceptance-context:pending: input binding stale …real-chain-IojIur\doc\features\demo-card\acceptance.yaml…`
  - CU `verify=INVALID; 冻结范围尚未完成；acceptance-context:candidate: input binding stale …real-chain-IojIur\contracts\ledger-api.yaml…`
  - 结果 `BASELINE_STAR1=FAIL`。

**3. 读侧重定位**（plan 未列的生产改动，理由见裁决一）
- **helper 落点**：`harness/scripts/utils/project-relative-path.ts`。
  - `resolveDependencyPath(projectRoot, recordedPath, legacyRoot?)`：相对路径按当前根拼；绝对路径在当前根内原样返回；在外且给了旧根，就把旧根前缀换成当前根（`\` 与 `/` 都认，盘符路径大小写不敏感）。
  - `inferLegacyProjectRoot(projectRoot, recorded)`：在记录的 `path` / `*_path` 字段里找第一条在当前根外、且含 `/<features_dir>/` 段的绝对路径，取其前缀；找不到返回 undefined，按原样判 stale。结果按记录对象 WeakMap 缓存。
  - 越界语义不变：各调用点对重定位后的路径照旧做 `isInsideProjectRoot`。
- **改接的读点**（grep `dep.path|dependency.path|.dependencies` 后逐个核对）：
  - `verify-feature-completion.ts`：`executionScopeEvidenceIssues` 的存在 / 字节 / 内容对齐三处，`computeRequirementSsotAggregate` 的 `readBoundInput`，`runtimeFidelityEvidenceIssue` 的 `trace_path`（device-test-evidence 也是绝对路径，是 ★1 实测撞出来的第二个读点）。
  - `execution-scope.ts`：`isExecutionSourceBasis`。
  - `capability-resolution.ts`：`readBoundInput` 新增可选第 3 参 `legacyRoot`，作用于 existenceDrift / boundSame；`readRunBoundContracts` 传入旧根。
  - `feature-track.ts`：`verifyBasisBinding` / `verifySatisfiedByBinding`（各加可选 `legacyRoot`）、`collectResolvedScopeFacts` 的 `derivePaths` / contracts 读取 / impact 相关性路径、`readScopeAcceptance`。
  - `capability-resolution-entry-input.ts`：`sourcePaths`。
  - `harness-runner.ts`：runless spec 的 requirement 绑定。
- **核对后不改的读点**：
  - phase-evidence-manifest `:421-428/438/565/574` 与 context-facts 的 baseline：读的是本轮新解析结果或按 manifest 相对路径重建，不是记录值。
  - entry-input 的 `expected_bindings` 比对：已由 `isLedgerOnlyBindingDrift` 容忍路径差异。
  - assess / report-generator：只展示文本。
  - request-phase：请求级绑定只在单次调用内有效。
- **未改（顺延，放弃的准确性）**：
  - check-testing 复用旧 trace 时读的 `trace_path` / `test_plan_path` / `derived_plan_path`（`:2336-2346`、`:2529-2540`、`:4124-4126`、`:4566`），以及 goal-phase-runtime `:2294`、phase-evidence-manifest `:497`。
  - 这些只在换根后**重跑 testing 阶段**时才触达。后果是不复用旧 trace、重跑设备链，不会误判 PASS；属 t3 successor 的范围。
- **顺延项**：写侧改为相对路径。会改变 `execution_scope_fingerprint` 与候选指纹，宿主在途 feature 出生会撞"候选已变更"，本批不做。

**4. ★1 验证**（`cd harness && npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts --verify`：复制到仓外 tmp、provision 当前框架、经 `goal-status` 判定）
- 生成根已移走 / 删除后，运行原文：

  ```text
  demo-card: feature_status=FEATURE_COMPLETED (verify=VALID, chain=spec→plan→coding→review→ut→testing)
  cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g: feature_status=FEATURE_COMPLETED (verify=VALID, chain=coding→review→ut)
  BASELINE_STAR1=PASS root=C:\Users\shengqsq\AppData\Local\Temp\host-snapshot-OsN0CX
  ```

- 反向注入（重定位不能把真变化洗成 VALID）：
  - 换根加载后改 demo-card `acceptance.yaml` 一处描述 → `verify=INVALID; 冻结范围尚未完成；acceptance-context:pending: input binding stale …`；
  - 给 `src/ledger/LedgerFeature.ets` 追加一行 → CU `verify=STALE; [coding] lineage_fresh(needs_fix): closure 后证据变更：src/ledger/LedgerFeature.ets…`。
- helper 单测已加进 `verify-feature-completion.unit.test.ts`，覆盖旧根推断、大小写与分隔符、不在旧根下原样返回、`..` 越界不放行、无 features 段不猜。

**5. 过滤套件**（日志逐个 grep 结论）
- `npm run typecheck` EXIT=0。
- 单测全部 0 FAIL：
  - verify-feature-completion 19/0；execution-scope 117/0；phase-evidence-manifest 21/0；context-facts 22/0；
  - blueprint-skill-projection 23/0；obligation-scoped-verification 12/0；spec-requirement-provenance 17/0；standalone-coding-review 44/0；
  - request-entry 30/0；capability-degradation 21/0；blocked-capability-projection 22/0；correction-c5-full 2/0；
  - coverage-evidence 16/0；review-context 4/0；phase-closure-finalizer 28/0；visual-debt 35/0。
- `--filter real-chain`：`12 passed, 0 failed`（real-chain 4，含新 CU 链用例；real-chain-seams 8）。

**改动文件**：
- 生产：`harness/scripts/utils/project-relative-path.ts`、`verify-feature-completion.ts`、`execution-scope.ts`、`capability-resolution.ts`、`feature-track.ts`、`capability-resolution-entry-input.ts`、`harness/harness-runner.ts`。
- 测试：`harness/tests/unit/real-chain.unit.test.ts`、`harness/tests/unit/verify-feature-completion.unit.test.ts`。
- 夹具：`harness/tests/fixtures/host-snapshot-3.1.0/{generate.ts,README.md,project/**}`。

### t1 评估入口（2026-09-25，未提交）

**结论**：`assessFeature` 落地，§3.5 六个消费方已改接，正则分类器 / completion 语义的 `STALE` / 观察器二次投影门 / `validateStaleReexecution` 已删。t1 todo 保持 `in_progress`，因为批一（t1–t4）的全量收口还没跑。

**拆分落点**
- 新文件 `harness/scripts/utils/feature-assessment.ts`：
  - 导出 `assessFeature(projectRoot, feature, { expectedTrack, expectedChain, frameworkRoot?, scope? })`，返回 `FeatureAssessment { record, obligations[], blocking[], complete }`。
  - 另导出 `assessmentReasons()`，供展示和 CU 的 INCOMPLETE blocker 共用。
  - 仓里原本就有一个 `utils/assess.ts` 的同名 `assessFeature`（阶段观察，概念不同）。`assess.ts` 和 `goal-phase-runtime.ts` 用别名 `assessFeatureCompletion` 导入新函数。
- `verify-feature-completion.ts`：
  - `verifyFeatureCompletion` 改名为 `inspectCompletionRecord`，只判记录自洽，返回 `VALID | INVALID`。`CompletionVerdictKind` 收成这两个值。
  - 世界变化不再写进 reasons，改为两个字段交给调用方：
    - `drift`：receipt 或 manifest aggregate 与记录不符；legacy 1.1 的顶层 artifact / requirement / attestation / source 比对也放这里，按 spec / plan / review / testing 各自的责任阶段挂。
    - `laterRuns`：晚于凭证的未终局 run。
  - 1.2 记录按**自身** run 范围核指纹、修订计数、completion_target 和完成链。
  - 从记录段移出、改由义务侧判的：原来的 `executionScopeEvidenceIssues` 缺口判 INVALID、clean-pass、1.2 的顶层比对。
- `executionScopeEvidenceIssues` 拆出结构化的 `executionScopeEvidenceFindings`，每条带 `{obligation_id, detail, class}`。字符串出口保留，是它的投影，现有 5 处调用方不改。
- `CleanPassIssue` 新增可选字段 `propagated_from`，只在 lineage 条目上设置。
- `change-unit-feature-projection.ts` 抽出 `changeUnitMappingIssues`，即 ID-only 的 predicate / provide / design 映射检查。`validateChangeUnitFeatureProjection` 也改用它，行为不变。

**覆盖规则**
- binding / evidence / unknown：来自 findings。
- `applicability==='unknown'`：判 `unknown`。
- required 义务既无 `satisfied_by`、责任阶段又不在 record.phases 里：判 `evidence`（codex P1-1）。
- clean-pass 按 `owner_phase` 摊回：
  - 剔除 `execution_scope` 和 `goal_run_identity_intact` 两类条目；后者进 `blocking`。
  - 条件到类别：lineage / attestation / summary schema / closure_commit / runtime 证据 → `evidence`；acceptance_binding → `binding`；其余 → `result`。
  - 该阶段没有 required 义务时，合成 `phase:<p>`，保证违例不会静默丢失。
- `cu-` Feature 的 CU 绑定：
  - `inspectDerivedFeatureBinding` 返回 conflict，或 revision / artifact_sha256 与 canonical CU 失配 → basis 含 `contracts@1` 或 `derive.blueprint-contracts` 的义务判 `uncovered/binding`。
  - 没有这类义务时，合成 `cu:feature-binding`（owner_phase 为 plan）。
- `complete` = record ok ∧ blocking 为空 ∧ 无任何 uncovered 义务。unresolved 和 unknown 都已算作 uncovered。

**被替换 / 删除的调用链**

| 消费方 | 改后 |
|---|---|
| `observeChangeUnitCompletion` | 调 assess：absent→ABSENT，broken→INVALID，complete→VALID，否则 INCOMPLETE（reasons 为 uncovered + blocking）。删掉 :144-148 的 CU 失配 STALE 早返回（收进 assess）、:186-194 的二次投影门、`changeUnitRefHash`。conflict→INVALID 早返回保留 |
| `ChangeUnitCompletionState` | `ABSENT | VALID | INCOMPLETE | INVALID`。注入接缝 `verify` 改为 `assess?: (input) => FeatureAssessment` |
| `change-unit-ready-set.ts` | 删 `validateStaleReexecution`。INCOMPLETE 的每条 reason 作为 legal blocker `change_unit_completion_incomplete`；ready 只剩 ABSENT |
| `component-closure-coverage.ts:65` | `INCOMPLETE` 映射到 closure 的 `stale`；ClosureObservation 枚举不动 |
| `goal-status.ts` | 改用 `assessFeature().complete`。完成行文本保持 `FEATURE_COMPLETED (verify=VALID, …)`，generate.ts / real-chain 按它解析；未完成行改为 `record=<state>; …` |
| `goal-phase-runtime.ts:4403` | 改用 `.complete` |
| `scripts/assess.ts` | 输出 JSON 新增 `feature_assessment {complete, record, uncovered, blocking}` |
| `verifyReusedExecutionScope` | 仅测试使用，改走 assess |
| 文档 / 注释 | `goal-mode-runbook.md` 同步（行数不变）；`change-unit-progression/SKILL.md` 的 `STALE` 改为 `INCOMPLETE` |

未改：`component-closure-inputs.ts` 双分支（属 t2，只经 observer 间接换上 assess）、check-spec / check-plan / check-review / revalidate、`quality-axes` 的 AxisVerdict STALE、goal-progress 的锁 STALE。

**测试**

新套件 `feature-assessment` 已在 run-unit 登记（非 release-only），共 7 例。夹具只用快照 `loadHostSnapshot()` 和生产 writer，不注入 verdict：
- ★1：快照两个 Feature 换目录加载，都是 `complete=true`。
- 结果摊派：CU 施工源码后改 → coding 义务 uncovered，record 仍 ok。
- ★2：只改 change-unit.yaml 的 purpose，contracts.yaml 字节断言未变 → `design-context:candidate` 为 plan 的 `uncovered/binding`，原因含「CU 绑定失配」。
- ★3：改原件 `phases[1].run_id` 并同步投影哈希 → record broken，义务全部 covered。
- #18：改 CU 的 acceptance.yaml（链首为 coding）→ 验收义务 `uncovered/binding`，coding 不被判 `uncovered/result`。
- codex P1-1：legacy seed 加显式合法范围（required UT 义务，无证据）。`executionScopeEvidenceIssues` 返回 `[]`，assess 判 `uncovered/evidence`。
- #17：unknown + unresolved → `uncovered/unknown`。

改造的既有测试：
- change-unit-progression：adapter 改注 assess；STALE→INCOMPLETE；「INCOMPLETE 只作 legal blocker」替换原 STALE 重执行例；「CU revision drift」改为直接断言 assess 的 CU 绑定。
- verify-feature-completion：helper 改走 assess；世界后变例改为断言 record ok + spec uncovered + blocking。
- execution-scope：helper 改为 `completionOf`（assess 投影）；P7 unmapped CU 改为 Feature 与 CU 两侧都判未完成，CU 为 INCOMPLETE。
- component-closure：STALE→INCOMPLETE。

**验证**（日志逐个 grep 结论）
- `npm run typecheck` EXIT=0；`node scripts/check-plan-version.mjs` PASS。
- `--filter` 结果：
  - feature-assessment 7/0；verify-feature-completion 19/0；change-unit-progression 97/0；component-closure 40/0；
  - component-design-handoff 10/0；evolution-workspace-path 13/0；goal-progress 56/0；assess 41/0；
  - revalidate-plan 3/0；mechanical-loop-closure 17/0；execution-scope 117/0；
  - real-chain（release-only，显式）：12/0（real-chain 4 + seams 8）。
- 中途两处红和修法：
  - evolution-workspace-path 反例前提红：legacy 无范围的 CU 完成缺映射，而旧观察器只对有范围的完成做投影。已改为映射完整性只在有范围时核。
  - execution-scope P7 红：Feature 级与 CU 级不再分两层裁决，已改断言。

**反向变异**（每条临时改 `feature-assessment.ts`，跑 `--filter feature-assessment` 后恢复，cmp 确认字节一致）

| 变异 | 结果 |
|---|---|
| M1 删掉 clean-pass 结果摊派 | ★1 仍绿，「结果摊派」例红（6/1）。P1-1 探针走的是规则 3，不经摊派，故不红，与任务书预期不同；已由「结果摊派」例抓到 |
| M2 把正则分类器加回（uncovered 原因命中 `/失配\|非法\|缺失\|伪造\|血缘/` 即判 record broken） | ★2 红 |
| M3 去掉 `execution_scope` 剔除 | #18 红 |
| M4 删 P1-1 规则 | P1-1 探针红 |
| M5 删 CU 绑定核对 | ★2 红 |

**偏离 plan 的取舍**（逐条写明放弃的准确性）
1. **opts 多了 `expectedChain`、少了 `currentRunId`**。
   - `expectedChain` 是 legacy 1.1 记录对账必需的，沿用现有消费方已解析的值。
   - `currentRunId` 目前没有调用方，按 YAGNI 不加，t3 需要时再加。
   - 放弃：无。
2. **`complete` 要求所有义务 covered，不只是 required**。not_applicable 义务的 basis 失效，同样会判 uncovered。
   - 理由：它的适用性判断依据已经变了。这与旧 verify 的行为一致（旧逻辑里有 gap 就判 INVALID）。
   - 放弃：not_applicable 义务 basis 失效时，本可以不阻断完成，现在也阻断。
3. **逐阶段 receipt / aggregate 不符归到义务侧 evidence，不再判记录不可信**（配合 §6 #9：删 manifest 时 record 仍 ok）。gate_fingerprint 只在 aggregate 相同时核，不等即 record broken。
   - 放弃：记录里的 receipt / aggregate 字段若被手改，会被归因为「该阶段证据后变」而不是「记录伪造」。两者都得 `complete=false`。
4. **feature 载体的阶段证明拆两半**：
   - attempt 和闭环指纹不符 → record broken；
   - summary 缺失、verdict、closure、manifest、fresh → 该阶段 evidence 缺口。
   - 放弃：同上，归因可能偏向重跑该阶段。
5. **lineage 沿链传染（`propagated_from`）不直接摊回下游**，改为逐阶段直查本阶段自身证据。这是「失效只沿真实消费关系传播」的最小落地。
   - 放弃：下游阶段 manifest 不含上游产物时，不再被连坐。
   - 发现：宿主快照里 coding / review / ut 的 manifest 输入**含 acceptance.yaml**。所以只改 acceptance 时，这些义务仍是 `uncovered/evidence`（不是 result）。§6 #7 / #8 期望「coding 及以后不重跑」，这与现行 phase-evidence-manifest 的输入登记冲突，需 t5 裁决。
6. **Feature↔CU 核对额外收编了 ID-only 映射完整性**（`changeUnitMappingIssues`），且只对有出生范围的完成生效。
   - 理由：删掉二次投影门后，P7「Feature evidence cannot credit an unmapped CU goal」会失去保护。
   - 映射检查只比 canonical CU 与 contracts 映射，**不经精确解析器**，符合 §3.3「不拿旧 ref 过解析器」。
   - 放弃：二次投影门里的 design / architecture / vertical-slice 检查不再对已完成 CU 追溯。
   - 附带变化：映射缺失时，Feature 本身在 goal-status 里也判 FEATURE_INCOMPLETE；原来只是 CU credit 被拒。
7. **INCOMPLETE 永远不进 ready**，uncovered 全部作为 legal blocker。
   - 原 STALE 在「重新绑定并过投影门」后可以重开，这条路随 `validateStaleReexecution` 一起删了。
   - 完成后修正出口由 t3 successor 承接；在它之前，INCOMPLETE CU 是「有合法原因的阻塞」，不是静默停滞。
8. **goal-status 完成行保留 `verify=VALID` 字样**，避免改动 generate.ts / real-chain 的解析；只有未完成行换成 `record=`。

**未做**：全量 `npm test`（批一收口时跑一次）；t2–t5；OpenSpec 措辞同步（§3.6，随 t2 / t5）。
### t2a CU 指针原位升版与规格收敛（2026-09-25，worktree，未提交）

范围：t2 中与评估入口无关的部分（§3.3 指针原位升版、`revises` 停产、§3.6 仅 change-unit-continuous-progression 一份）。
在隔离 worktree `D:\1.code\agent-maison\.claude\worktrees\agent-a7291f66b8917bd00`（快进到 91aab353）完成，由调度移植回主树。
closure inputs 单路（§3.4）与 t1 的消费方改接不在本段。

**做了什么**
- `change-unit-design-preparation.ts` 新增导出 `reconcileChangeUnitBlueprintRefs(projectRoot, blueprintId) → { bumped, skipped }`：
  - 枚举 canonical CU，owner ref 身份（revision / source_fingerprint / artifact_sha256）等于当前蓝图的跳过（幂等）。
  - 三处指针身份本就不一致 → `skipped`（`blueprint_ref_identity_inconsistent`，契约变化，须新 id + supersedes）；
    CU 绑定 revision 高于当前蓝图 → `skipped`（`blueprint_revision_regressed`）；
    `evaluateChangeUnitCarryForward`（判据未改）不通过 → `skipped` 带其原因。
  - 通过者从原文件字节重新解析，只改三处指针的三个身份字段与 CU `revision + 1`。
  - 全部待写 CU 先过 `validateChangeUnit`，任一 BLOCKER 抛 `change_unit_blueprint_ref_bump_rejected`、整批不落盘。
  - 落盘复用 accept 的 `writeCanonicalChangeUnit`（temp wx → rename），中途失败以原字节回滚本批。
- **接入点**：`deriveDesignPreparationReadiness` 派生 readiness 前调用一次，结果在返回值 `blueprintRefs` 中。
  `change-unit-progress-loop.ts` 没有 readiness / 入口调用（只有 provider boundary 校验与 ready-set 派生），**未接入、未改动**；
  推进循环遇指针漂移沿现状报 carry-forward 原因、路由回 `/component-design`。
- 输出样例（夹具蓝图 rev2→rev3）：
  `{"bumped":[{"change_unit_id":"ledger-consumer","revision":2,"blueprint_revision":3},…],"skipped":[]}`；
  删掉 relation `domain-owned-by-module` 时：`{"bumped":[],"skipped":[{"change_unit_id":"ledger-refresh","reasons":["relation:domain-owned-by-module 当前不可解析：无法解析 target kind=relation id=domain-owned-by-module。"]},…]}`。
- `revises`：`change-unit-model.ts` 字段注释「读兼容、不再生成、无消费者」；`change-unit.schema.json` 该属性加 `deprecated: true` 与 `$comment`。全仓 grep 无写入点。
- 规格：`openspec/specs/change-unit-continuous-progression/spec.md` 改五条 Requirement：
  - 调和规则改为 §3.3 表，删「纠正已完成结果 MUST 新建 id / 只有尚未实施 CU 可原位升」；
  - 新增 Scenario「蓝图升版全部 target 仍解析 → 已完成 CU 原位升版，successor 只补 uncovered」与「契约字段变化 → 新 id + supersedes」；
  - 完成观察 / ready set / 薄推进循环的 `ABSENT|VALID|STALE|INVALID` 改为 `assessFeature` 记录三态 + uncovered（P2 投影 `ABSENT|VALID|INCOMPLETE|INVALID`），
    新增 Scenario「输入变化 → INCOMPLETE 带 uncovered，不判 INVALID」；
  - 设计准备段加「指针原位升版」条目（同一校验、同一落盘原语，不构成第二套写入机制）。
  - 新建 change `openspec/changes/post-completion-evolution-unification/`（proposal / design / tasks / .openspec.yaml / 同名 delta，MODIFIED 五条）。
- SKILL：`change-unit-progression` 三处、`component-design` 两处措辞同步（契约不变即同一 CU、指针原位升版、契约变化新 id + supersedes、完成四态来自 `assessFeature`）。
  `skills/reference/app-component-blueprint-workflow.md` 核对后无需改。

**测试**（全部加在 `harness/tests/unit/component-design-handoff.unit.test.ts`；新文件要改 `run-unit.ts` 注册表，不在白名单内）
- 正例：蓝图 rev2→rev3（只改 revision 与 derived_results.input_revision，过 P1 校验）→ readiness 升版全部 4 个 CU；
  三处指针指向 rev3、CU revision+1、`change_unit_id` 不变；去掉身份字段后整份 CU 与升版前逐字段相等；
  `resolveChangeUnitRef` 精确解析通过；readiness `ready`；再跑一次 `bumped/skipped` 皆空、字节不变。
- ★4：按 rev3 身份手工追加一个 touch（契约变化）→ 该 CU 进 `skipped`（`blueprint_ref_identity_inconsistent`）、字节不变；
  同 id 候选再接受 → `change_unit_candidate_already_exists`，提示 supersedes。
- ★5：rev3 删掉 relation `domain-owned-by-module`（CU 的 design_ref target）→ 无升版，`skipped` 带「不可解析」原因，全部 CU 字节不变。
- 整批：一个待升 CU `purpose` 置空 → 抛 `change_unit_blueprint_ref_bump_rejected`，全部 CU 字节不变。
- 反向变异（同时去掉一致性守卫、carry-forward 判定、写前校验）：新增 3 条反例全红（PASS=11 FAIL=3），恢复后全绿。
- 命令与结果（日志逐个 grep 结论）：
  - `cd harness && npm run typecheck` EXIT=0；
  - `npm run test:unit -- --filter component-design` → component-design-host-seams 18/0、component-design-handoff 14/0；
  - `--filter change-unit-progression` 97/0；`--filter docs` → docs-authoring-lint 18/0；
  - `npm run check:docs`：`skill_body_max_lines` PASS（component-design 150 行 = 预算，change-unit-progression 47 行），Verdict PASS；
    唯一 FAIL 是既有 MAJOR `doc_freshness`（按提交时间，与本改动无关）；
  - 仓根 `npm run openspec:validate` → 49 passed, 0 failed（含 `change/post-completion-evolution-unification`）；
  - `node scripts/check-plan-version.mjs` PASS；改动文件 node 扫描 crlf=0。

**偏离与放弃的准确性**
- 白名单外一处：`change-unit-provider-boundary.ts` 把既有 `writeCanonicalChangeUnit` 改为 `export`，并把重复接受的报错文案从「新建修订/superseding CU」改为「新 id + supersedes / 指针原位升版」。
  原因：design-preparation 模块本身没有写盘实现，任务要求「与 accept 同一套原子写法」只能复用该原语；另写一份等于第二个写盘原语，与该模块「唯一写入原语」注释和 P2 规格冲突。
- 写前校验失败时整批抛错，所以 `deriveDesignPreparationReadiness` 会从「逐 CU 报 verdict」变成「整体抛错」。只发生在指针待升且另有 BLOCKER 的 CU 上，这种 CU 本就不可施工。
  放弃的准确性：这时其它 CU 的 perUnit 信息看不到，报错里只点名失败 CU 与 issue id。
- 在旧蓝图身份下原位手改契约字段（三处指针仍一致）无法与原稿区分，reconcile 会当成指针漂移升版。
  放弃的准确性：没有历史副本可比；该改动本身已使 Feature 的 `change_unit_ref` 失配，交由 t1 评估入口判 plan 义务 uncovered。
- 按原字节解析再序列化，YAML 注释不保留；consumer writer 写出的 CU 本来就没有注释。
- 在途 change `openspec/changes/composable-workflow-foundation` 的 delta 仍 MODIFIED「Completion observation…」旧措辞（`ABSENT|VALID|STALE|INVALID`）。
  不在白名单，未改；若它晚于本 change 归档，会把主规格改回旧措辞，需调度在归档前对齐。

### t3 successor 出口（2026-09-25，未提交）

**结论**：§3.2 四步落地，完成后修正走 `goal-runner --supersede <完成 run>`，出生范围在 supersede 上下文重解析。t3 todo 状态未改（批一全量收口未跑）。

**四步落点**（行号为当前工作区）
1. 核合法源与请求：`goal-phase-runtime.ts:4753-4810` 原有校验不动（manifest 可加载、出生记录 complete/legacy，`:4767`）。
   `:4799-4801` 不再把源 run 有效范围传给 `inheritSuccessorManifest`，该函数第 4 参 `scopeRevision` 已删（唯一调用方）。
   新增 `:4721-4727`：`--supersede` 带空值时拒绝，提示 feature 载体先追加修订。源 run 加载失败的报错（`:4804` 起）追加同一提示。
2. supersede 上下文重解析：`goal-phase-runtime.ts:5017-5025`，位于 requirement 增量合并之后、`createGoalRun`（`:5155`）之前。
   调 `resolveSuccessorExecutionScope`（`feature-execution-scope.ts:708`）：
   - feature 冻结记录只作血缘核对，当前转交对象 ≠ 源 run 即抛错。无记录不核。不做候选漂移检查、不从记录取范围。
   - 然后走 `resolveFeatureExecutionScope` 新增的 `reuse` 分支，即 `resolveWithPriorEvidence`（`feature-track.ts:153`）：
     ① 候选里失效的 `satisfied_by`（含定义类输入绑定）剔除，不再整份拒绝；
     ② 先解析一次得本次义务。记录 `ok` 时，每条 required 义务取完成原件 `phases[]` 中其责任阶段的 `{phase, run_id, evidence_manifest_aggregate}` 作证据引用，经 `collectResolvedScopeFacts` 原有阶段证据核验（`executionScopeEvidenceIssues`），核不过即剔除；
     ③ `assessFeature(opts.scope = 本次范围)` 判 uncovered 的义务撤回复用。
   - resolver 据此排 `phase_chain` 与 `reused_phases`。
   - 影响判断与源 run 有效范围的 `request_impact` 指纹相同时按继承处理（`impactInherited`，与修订路径同义）。否则 coding 改过的出生观察文件会让 impact 依据逐字节判失效、整份拒绝。
   - successor 在 `:5024` 用重解析结果替换继承来的旧出生范围，不做「manifest 自带范围不一致」比对。非 1.2 workflow 沿用源 manifest。
3. 建 run、写审计：`createGoalRun` `:5155`；审计 `:6014` 未动。首次转交登记 `:5163` 只管非 successor。
4. 转交追加式：审计循环之后（`:6032`）调 `registerFeatureScopeTransfer`。失败按 `supersede_target_invalid` 收口，不新增 halt_reason。
   `registerFeatureScopeTransfer`（`feature-execution-scope.ts:356`）的判定：
   - 未转交：指纹等于记录有效范围；
   - 同 run：幂等；
   - 已转交给别的 run：只有后继 run 自己的 events 里有 `supersede{target=当前转交对象, superseding=本 run}` 时才追加（`isAuditedSuccessor` `:396`）。指纹取后继 run 的出生范围，不信调用方；其余情形照旧拒绝。
   - `appendFeatureScopeRevision` 遇已转交仍拒绝。

**转交记录形状**
- `FeatureFrozenScope.transfers?: Array<{ run_id, scope_fingerprint, at? }>`，最新一条即当前转交对象，由 `currentFeatureScopeTransfer()` 读取。
- 读兼容在 `validateFeatureFrozenScope`：旧单值 `transferred_to` + `transferred_scope_fingerprint` 在内存里换成唯一一条（`at` 缺省），不回写；两种形状并存判损坏。
- 其它读点改为读 transfers：`feature-execution-scope.ts` 四处，`goal-run-creation.ts` `resolveEffectiveScopeSource` 三处（出生指纹对账按 run 找对应那一条）。

**指引改口**（宿主侧只写话术）
- `templates/AGENTS.md.template` 修正三问段末尾一句；
- `agents/claude/templates/agents/phase-executor.md` 硬性规则 `--revalidate` 条；
- `docs/operations/project-entry.md` 恢复段；
- `docs/operations/goal-mode-runbook.md` supersede 行，同行追加，行数不变；
- `MIGRATION.md`「3.1.0：按义务执行与旧运行恢复」追加一条；
- `openspec/specs/correction-routing/spec.md`：原 Requirement 补「`--revalidate` 不签发 completion」，新增 Requirement「完成后修正经 successor」及两条 Scenario；
- change delta `openspec/changes/post-completion-evolution-unification/specs/correction-routing/spec.md`（MODIFIED + ADDED）；proposal / tasks 各补一行。

**测试**
新套件 `successor-exit`，已登记 run-unit，非 release-only，约 35s。夹具为快照 `loadHostSnapshot()` + 生产 writer，经 `runGoalRuntimeChain`（进程内 goalMain，假 agent 一律失败，出生即停）走 goal-runner 公开入口，不注入 verdict。
- ★2（CU，蓝图 rev2→rev3）：
  - 夹具步骤：`reconcileChangeUnitBlueprintRefs` 原位升版 4 个 CU → 删三份派生投影后 `materializeBlueprintSkillInputs` 重物化（原因见偏离 1）→ 生产 writer 冻结并转交给源 run。
  - 出生链等于 assess 判 uncovered 的 required 义务的责任阶段。**实际 `phase_chain=[spec, plan, coding, review, ut]`，`reused=[]`**：蓝图、CU、contracts、use-cases、acceptance 都是这些阶段绑定或证据清单的输入。
  - 其余断言：`successor_of` 正确；后继 events 有 supersede 审计；`transfers` 为 `[源, 后继]`；旧 completion 原件字节不变；无新 CU 目录。
- #9（平铺，删 ut evidence manifest）：
  - `phase_chain=[ut]`，`reused=[spec, plan, coding, review, testing]`；
  - 每条复用引用 `run_id` 为源 run，aggregate 等于当前 manifest；`executionScopeEvidenceIssues` 复核为 `[]`；
  - 无冻结记录时登记是 no-op。
- #8（平铺，acceptance 加 AC-9 设备断言）：
  - `device-evidence:acceptance` 为 required、无 satisfied_by、reason 含 AC-9；
  - **实际 `phase_chain` 为全部六阶段**：每个阶段的证据清单都登记 acceptance.yaml 为输入，与 t1 记录一致；判据未改。
  - CU 版 #8 不可做：CU 验收是蓝图投影，手改 acceptance.yaml 即 `blueprint projection stale`，出生被拒，正确。
- #16a（源 run 重复 `run_created` → creation_incomplete）、#16b（转交对象为另一 run）：
  - 都拒绝出生，不建后继 manifest；
  - 转交记录、源 run events 字节不变。
- `execution-scope` 套件新增两条：
  - 旧单值读兼容：换形、无身份报「已转交」、修订被拒、同 run 幂等不改写、他 run 被拒、两形状并存报损坏；
  - #15：sync-closure 生成 feature 载体完成后，`--supersede ''` 与 `--supersede <不存在 run>` 都非零退出并指向「追加 feature 范围修订」，不建 run、记录字节不变；`appendFeatureScopeRevision` 后 `prepareGoalModeRun` 出生范围等于修订后有效范围。**无需生产改动，没有被别的门挡住**（只补了拒绝文案）。
- 既有 `D1 a superseding successor…` 改断言：重解析结果（无完成证据可复用时等于源出生范围）+ `transfers=[d1-src, d1-succ]`。另有 13 处 `.transferred_to` 读取改读 `transfers`。

**反向变异**（改 `feature-execution-scope.ts` 后跑 `--filter successor-exit`，恢复后 cmp 字节一致）

| 变异 | 结果 |
|---|---|
| 删血缘核对（`if (false && current !== sourceRunId)`） | #16b 红（4/1） |
| 转交改回单值覆盖（`transfers: [{ 新 }]`） | ★2 红「转交记录应追加、旧转交保留」（4/1） |

**验证**（日志逐个 grep 结论）
- `npm run typecheck` EXIT=0；
- `--filter successor-exit` 5/0；`--filter execution-scope` 119/0；
- 仓根 `npm run openspec:validate` 49 passed / 0 failed；`node scripts/check-plan-version.mjs` PASS；
- 改动文件 node 扫描 CR=0；
- 其余过滤套件见下一段。

**偏离 plan 与放弃的准确性**
1. **★2 的前半段被投影门挡住**，是 plan 未列的事实（§7 第 7 问的情形）。
   - 现象：蓝图升版（或只改 CU 描述）后，CU Feature 既有 `use-cases.yaml` 的来源戳 `derive.blueprint-contracts:<蓝图 sha>:<CU 指针 sha>` 与新投影冲突（`blueprint-skill-projection.ts:237`）。于是 acceptance@1 / contracts@1 都解析失败，任何出生（fresh 或 successor）都在 `readScopeAcceptance` / 依据核验处拒绝：`input binding stale; return to scope owner: plan: 既有 use-cases.yaml 与获准投影冲突`。
   - `materializeBlueprintSkillInputs` 不覆盖既有文件（`:256`），调和 writer 也不重投影。测试里用「删三份派生投影 + 同一生产物化 writer」模拟宿主补救。
   - 未改：投影门属精确校验、不放宽；是否让 t2 的调和一并重投影、或给 plan 阶段重投影权，待调度裁决。
   - 放弃：★2 没有证明「contracts.yaml 字节未变时 successor 只跑 plan」，该判定只有 t1 的 assess 单测。
2. **出生链只排此刻 uncovered 的阶段**（plan 原意）。
   - 上游重跑后下游证据才失效的情形，由完成判定暴露后再起 successor，代码注释已标「已知上限」。
   - 放弃：可能多一轮 successor。
3. **第 1 步未加「源 run 终态必须是 HALTED/COMPLETED/CHAIN_SLICE_COMPLETED」**。
   - 现有 `:4757-4767` 只核加载与出生记录。加终态门会挡住「崩溃未落 run_end 的僵尸 run 用 supersede 收尾」这条既有恢复路。
   - 放弃：未终局 run 也能被 supersede（与现状一致）。
4. **successor 按合并增量后的最终需求核候选 provenance**。
   - 带显式 requirement 增量且与候选不一致时，出生会以 stale 拒绝，须先 `--prepare-scope` 重生候选；旧行为是整份继承、不核。
   - 放弃：该路径多一步；无既有测试覆盖到它（相关过滤套件见下段）。
5. **再转交的 `scope_fingerprint` 取后继 run 出生范围**，不是 feature 记录有效范围（后继范围本就不同）。可信来源仍是机器读取，不信调用方。
6. 转交登记在审计之后失败时复用 `supersede_target_invalid` 收口，未新增 halt_reason（不动 events 协议）。

**其余过滤套件**（`--filter <id 子串>`，日志逐个 grep 结论，全部 0 FAIL）
- goal-run（含 goal-runner-* / goal-run-birth-contract）254/0；host-runtime-truth 23/0；adjudication 55/0；visual-provider 70/0；
- feature-assessment 7/0；verify-feature-completion 19/0；goal-phase-runtime 22/0；trust-lifecycle 5/0；goal-progress 56/0；
- revalidate 3/0；change-unit 97/0；component-design 32/0；component-closure 42/0；docs 18/0；
- real-chain（release-only，显式）12/0（real-chain 4 + seams 8）。
- 未跑：全量 `npm test`（批一收口时一次）。
### t2b closure inputs 单路与在途 change 措辞对齐（2026-09-25，未提交）

范围：§3.4 closure inputs 收为单路；§3.6 中 `component-assembly-coverage-closure` 一份；在途 change `composable-workflow-foundation` 的「Completion observation」delta 对齐。

**生产改动**：`harness/scripts/utils/component-closure-inputs.ts`
- 枚举循环只剩一个判断：owner `component_blueprint_ref` 身份等于当前蓝图 → `resolveChangeUnitRef` 精确解析，`carry_forward: true`。
- 其余 CU 直接用 `enumerateCanonicalChangeUnits` 已加载的 artifact 建 input，`carry_forward: false`。
  - reasons = 常量 `NOT_REPOINTED`「未原位升版：请经 /component-design 设计交接派生 readiness（reconcileChangeUnitBlueprintRefs）升版指针。」加上 `evaluateChangeUnitCarryForward(...).reasons`。carry-forward 不通过时，这些原因说明为何升不了。
  - carry-forward 在 try 内调用。artifact 结构坏到连它都跑不动时，仍落 `component_closure_change_unit_invalid`（fail-closed）。
- 删除：
  - 旧第二分支：去掉 provenance 的 `validateChangeUnit`，以及 `inspectDerivedFeatureBinding` 精确核对；
  - `historicalBlueprint` 双态；
  - `options.evaluateCarryForward` 注入项（全仓无调用方）；
  - featureInput 里的 historical 归一化（`normalizeHistoricalUnit` / `normalizeHistoricalContracts` / `currentRef`）；
  - 随之不再使用的 import。
- featureInput 改收 `onCurrentBlueprint`（= `input.carry_forward`）。未升版 CU 不做施工投影：`projection_issue_ids` 只剩 spec shape，`use_cases_required` 和 `dag_required` 都为 false。
- 保持不动：`supersedes` 退役图 `inspectRetirement`（只把参数类型换成 `RawClosureUnit`）；`observeCompletion` 仍走 t1 的 assess；精确解析器；`evaluateChangeUnitCarryForward` 判据。
- `component-closure-coverage.ts` 未改。

**规格**
- `openspec/specs/component-assembly-coverage-closure/spec.md`：
  - 改写 Requirement「Closure input set is component-bounded…」的第二段：单路规则、未升版者 `carry_forward:false` 带升版出口、不对旧蓝图做施工投影、`ABSENT|INCOMPLETE|INVALID`；
  - 原 Scenario「Historical completion needs carry-forward」拆成两条：「A CU not re-pointed yet does not contribute」「A removed target blocks the re-point」；
  - Enforced by 增加 `feature-assessment.ts`、`change-unit-design-preparation.ts`。
- 新建 delta `openspec/changes/post-completion-evolution-unification/specs/component-assembly-coverage-closure/spec.md`：MODIFIED 该 Requirement，全文与主规格一致。该 change 的 proposal.md / tasks.md 未动（t3 在改），合并时需把此 delta 登记进 proposal 的受影响 spec。
- `openspec/changes/composable-workflow-foundation/specs/change-unit-continuous-progression/spec.md`：「Completion observation…」Requirement 整块替换为主规格现行文本（与本 change 的 delta 逐字相同）：assess 投影 `ABSENT|VALID|INCOMPLETE|INVALID`、uncovered 清单，新增 Scenario「Changed inputs make obligations uncovered, not invalid」。该 delta 的其它 Requirement 未动。

**测试**：`harness/tests/unit/component-closure.unit.test.ts`
- 删旧例「historical CU contributes only through exact VALID completion and P2 carry-forward」，新增 3 例。
- 夹具：`bumpClosureBlueprint`（蓝图 revision+1 + derived_results.input_revision，与 handoff 测试做法相同）加生产 `reconcileChangeUnitBlueprintRefs`。completion 走真实 assess，不注入 verdict。
- 三例：
  1. 已升版：reconcile 升 4 个 CU → 全部精确路径，`carry_forward:true`，无 `component_closure_change_unit_invalid`。
  2. 未升版、carry-forward 可通过：4 个 CU 都在输入集，`carry_forward:false`，reasons 只有「未原位升版」指引；`evaluateComponentClosure` 给出 4 条 `component_closure_carry_forward_rejected`，全部为 `reconcile_blueprint` 路由；无 `feature_projection_invalid`；verdict FAIL。
  3. ★5（删 relation `domain-owned-by-module`）：reconcile 不升版；ledger-refresh `carry_forward:false`，reasons 含「未原位升版」和「relation:domain-owned-by-module … 不可解析」；无 change_unit_invalid。
- ★4 的 supersedes 退役图沿用既有例「exact supersedes conflicts and structural cycles…」，无回归。

**反向变异**（改 inputs.ts，跑 `--filter component-closure` 后恢复，cmp 确认字节一致）

| 变异 | 结果 |
|---|---|
| M1 改回旧第二分支语义：去掉 `NOT_REPOINTED`，carry-forward 通过即 `carry_forward:true` | 例 2、例 3 红（40/2） |
| M2 未升版 CU 也做施工投影（`onCurrentBlueprint` → `true`） | 例 2 红，报「未升版 CU 仍拿旧蓝图 ref 过施工投影」（41/1） |

**验证**（均写日志后 grep 结论）
- `cd harness && npm run typecheck` EXIT=0。
- `--filter` 结果：
  - component-closure 42/0；change-unit-progression 97/0；
  - component-design 32/0（host-seams 18 + handoff 14）；
  - evolution-workspace-path 13/0；mechanical-loop-closure 17/0；execution-scope 117/0。
- 仓根 `npm run openspec:validate` → 49 passed, 0 failed。
- 5 个改动文件用 node 扫描，crlf=0。

**偏离与放弃的准确性**
1. 未升版 CU 不再做 Feature 施工投影。旧实现会把它归一化到当前蓝图后预判投影问题。
   - 放弃：升版前看不到它在新蓝图下的映射缺口，要升版后才暴露。
   - 理由：它已被 `carry_forward:false` 挡住并路由 reconcile；用旧 ref 过解析器，只会多出一条路由错误（`repair_feature_or_evidence`）的重复 BLOCKER。
2. 未升版 CU 不再做结构校验和 Feature binding 精确核对（任务明令删除）。
   - 放弃：结构有问题、但 carry-forward 仍能跑通的旧 CU，不再在 closure 报 `change_unit_invalid`，只报 `carry_forward_rejected`。reconcile 升版时 `validateChangeUnit` 整批校验兜底。
3. 发现（非本段引入，未改）：已升版 CU 的 Feature contracts 仍绑旧 `change_unit_ref`。在 successor plan 重投影之前，closure 的 featureInput 会报 `component_closure_feature_projection_invalid:change_unit_identity_mismatch`，同时 assess 判 INCOMPLETE。这与 plan §3.3「plan 义务 uncovered/binding → successor 重投影」一致；例 1 只断言 CU input，不断言整份 closure 无 issue。
### t2c 旧投影刷新与 successor 候选重生成（2026-09-25，未提交）

问题陈述 = t3「偏离 1」：CU 指针升版后，CU 派生 feature 目录里的 `use-cases.yaml` / `acceptance.yaml` / `contracts.yaml` 仍是旧蓝图 + 旧 CU 的机器投影，
投影门（`deriveBlueprintSkillInput` 的 use-cases 冲突判定）拒绝该 feature 的任何新 run；successor 还读 feature 既有候选，其定义类 `satisfied_by` 过期被剔除，spec/plan 被排成执行阶段。

**A. 升版 writer 同批刷新旧机器投影**（精确解析器与投影门均未放宽）
- 判据（`blueprint-skill-projection.ts`，两层）：
  1. 写前只读核对来源戳 `inspectProjectionStamps`：
     - 既有文件都没有 `derive.blueprint-` 来源戳 → `'none'`，不归本 writer：不刷新、不覆盖，指针照常升版（t2a 行为）；
     - 全部指向升版前身份 → `'stamped'`。身份 = `acceptance.source = derive.blueprint-acceptance:<升版前 CU sha>:<升版前 component_blueprint_ref.artifact_sha256>`，contracts / use-cases 同式（`derive.blueprint-contracts:`），contracts 另要求 `change_unit.change_unit_ref.artifact_sha256 = 升版前 CU sha`；
     - 其余（部分带戳、戳不对、读不出）→ 该 CU 进 `skipped`，原因 `derived_projection_not_machine_owned`，一个字节不写。
  2. 覆盖前内容核对 `isStaleMachineProjection`：来源戳如上，且去掉身份字段（各层 `revision` / `source_fingerprint` / `artifact_sha256` 与顶层 `source`）后与新投影逐字段相同。不满足抛 `ProjectionNotMachineOwned`。
- 落点：同一个物化 writer `materializeBlueprintSkillInputs(…, refresh?)`，第四参 `{ changeUnitSha, blueprintSha }`，未新写第二个物化函数。
  - 先算两份投影（`deriveBlueprintSkillInput` 同带 `refresh`：仅刷新模式跳过它自己的 use-cases 冲突判定，改由 writer 覆盖前做上面第 2 层；无 `refresh` 时行为逐字不变）；
  - 再逐文件核对，全部通过才写；写出中途失败按原字节回滚已写文件。
- 原子批（`reconcileChangeUnitBlueprintRefs`）：
  - 预检（来源戳）→ 全部待升 CU 过 `validateChangeUnit`（原有）→ 写全部 CU 指针（原有）→ 对 `'stamped'` 的 CU 逐个调刷新 writer。新投影依赖落盘后的 CU，所以刷新只能排在指针写出之后。
  - 刷新抛 `ProjectionNotMachineOwned` → 只把该 CU 指针恢复原字节、进 `skipped`，其余 CU 照常。
  - 其它任何失败 → 整批回滚（全部 CU 指针 + 已刷新 feature 的三份文件按原字节 / 删除新建），抛 `change_unit_blueprint_ref_bump_rejected`（语义扩展，未新增错误码）。
  - frameworkRoot 由 `resolveProbeFrameworkRoot(projectRoot)` 取（宿主 `framework/`，无则 harness checkout），函数签名未变。
- 刷新后 `contracts.change_unit.change_unit_ref` 自然指向升版后 CU sha。feature 其它文件（feature.yaml、feature-completion.json、next.json、goal-runs 等）不动（测试逐字节断言）。
- 发布文档 `docs/concepts/blueprint-design-inputs.md`「唯一物化入口」段加一句刷新规则。

**B. successor 候选按当前输入重生成**
- `feature-track.ts`：把 `prepareFeatureScopeCandidate` 的候选生成段原样抽成 `buildFeatureScopeCandidate`（纯内存），`--prepare-scope` 与 successor 共用这一个生成点。
- `resolveFeatureExecutionScope` 删掉 t3 加的 `reuse` 分支与参数（唯一调用方已改），`resolveWithPriorEvidence` 改为导出，删 `previous` 参数与 `impactInherited`（理由见下）。
- `resolveSuccessorExecutionScope`（`feature-execution-scope.ts`）：
  - 血缘核对不变；
  - 主 Agent 四项输入取自源 run 有效范围：
    - `completionTarget` / `requestedResults` 原样；
    - `requestedPhases = executionCompletionPhases(源范围)`，即源 run 完成链，由框架按链算；
    - 影响判断的结论与理由原样，来源路径（`source_refs`）按当前字节重新绑定；
  - requirement 用合并增量后的最终文本；
  - 生成候选 → `resolveWithPriorEvidence`。不写回 feature.yaml，源 run 无有效范围时明确报错。
- 未被别的门挡住。

**★2 实测**（快照 CU，蓝图 rev2→rev3，reconcile 后直接 `--supersede`，无手工补救）
- `phase_chain=["coding","review","ut"]`，`reused=[]`；
- spec/plan 的 `acceptance-context` / `design-context` 由刷新后的派生投影绑定满足（`satisfied_by` 为输入绑定），不进链。
- 断言口径：按 §3.1 用 `resolveSuccessorExecutionScope`（生产函数，出生前在测试里预判）得到本次范围 → `assessFeature(opts.scope = 该范围)` 的 uncovered 责任阶段 = 实际出生链、且不含 spec/plan；后继 manifest 的出生范围指纹 = 预判指纹。
- 其余断言保持：`successor_of`、supersede 审计、`transfers=[源, 后继]`、旧原件字节不变、无新 CU 目录。
- 快照另三个 CU 的 contracts.yaml 是 P2 手写夹具（`source: P2 canonical fixture`）→ `'none'`，照常升版，`skipped=[]`。

**测试**
- `component-design-handoff` +4 例（快照夹具，`loadHostSnapshot()`）：
  - 正例：ledger-refresh 升版后三份文件都变了，且逐字段等于 `deriveBlueprintSkillInput` 新投影（acceptance、contracts、`use-cases@1`）；
    - 两种 kind 都 `resolved`（投影门放行）；`use-cases.source = derive.blueprint-contracts:<新 CU sha>:<新蓝图 sha>`；`change_unit_ref.artifact_sha256 = 新 CU sha`；`resolveChangeUnitRef` 通过；
    - feature.yaml / feature-completion.json / next.json 字节不变；再调和一次 bumped/skipped 皆空、投影字节不变。
  - 反例 ×2（手改 use-cases 一个字段且来源戳保持；来源戳改成别的值）：ledger-refresh 进 skipped（原因点名 use-cases.yaml），CU + 三份投影 + feature.yaml 五个文件字节不变。
  - 原子性 ×2：
    - ① contracts.yaml 内容改动、来源戳保持 → 指针不升，三份投影一个都不写（use-cases / acceptance 本可刷新也不写）；
    - ② use-cases.yaml 设只读（写出顺序 acceptance → contracts → use-cases，第三份失败）→ 抛 `change_unit_blueprint_ref_bump_rejected`，全部 CU 指针与三份投影字节回滚。
- 原 t2a 四例未改、全绿（base 夹具 contracts 为 P2 手写，走 `'none'`）。
- `successor-exit`：
  - ★2 去掉「删三份派生文件 + 重物化」，改为 reconcile → 直接 `--supersede`，断言如上；
  - #9 实测 `phase_chain=[ut]` 不变；`reused` 由 `[spec, plan, coding, review, testing]` 变为 `[coding, review, testing]`，spec/plan 的 required 义务全部由当前输入绑定满足（新增断言）。这是 B 的直接后果，见偏离 2。
  - #8（六阶段）、#16a、#16b 不回归。

**反向变异**（改生产文件后跑过滤套件，恢复后 `cmp` 字节一致）

| 变异 | 结果 |
|---|---|
| 刷新判据放宽为「存在即覆盖」（戳分类恒 `'stamped'` + 去掉覆盖前核对） | handoff 12/6：两条手改反例、原子性、正例（P2 手写夹具也被强行刷新→整批拒绝）、t2a 正例与 ★4 全红 |
| 只留来源戳、去掉「去身份字段后内容一致」（= 任务原文判据） | handoff 16/2：「来源戳保持的手改」反例与原子性 ① 红——只看戳挡不住保戳手改 |
| 去掉 writer 内部写出回滚 | handoff 17/1：原子性 ②「整批拒绝后投影未回滚」 |
| successor 候选改回读 feature 既有候选（补上当前 impact 以越过影响核验） | successor-exit 3/2：★2「spec/plan 不应 uncovered」红（spec/plan 以 `uncovered/evidence` 出现），#9 红 |

**验证**（日志逐个 grep 结论）
- `cd harness && npm run typecheck` EXIT=0。
- `--filter` 结果：
  - component-design：host-seams 18/0、handoff 18/0；successor-exit 5/0；component-closure 42/0；
  - feature-assessment 7/0；execution-scope 119/0；blueprint-skill-projection 23/0；change-unit-progression 97/0；request-entry 30/0；verify-feature-completion 19/0；
  - real-chain（release-only，显式）12/0（real-chain 4 + seams 8）。
  - `--filter goal-mode-entry` 匹配面过宽（跑成大半全量），中途手动停止，无结论；`prepareFeatureScopeCandidate` 的抽取由 request-entry / execution-scope 覆盖。
- 仓根 `npm run openspec:validate` 49 passed / 0 failed；`node scripts/check-plan-version.mjs` PASS。
- 未跑：全量 `npm test`（批一收口时一次）。
- 改动 7 个文件 node 扫描 CR=0。

**偏离与放弃的准确性**
1. **判据比任务原文多一层内容核对，并区分「无机器来源戳」**。
   - 只看来源戳挡不住「保戳手改」（变异 2 实证），任务要求的反例本身就需要内容核对。
   - 快照与 base 夹具里 P2 手写的 contracts.yaml 没有机器来源戳。按原文判据（ref sha 等于升版前 CU sha）会去刷新，派生失败后整批拒绝，t2a / t2b 全红；因此这类文件归为「不归本 writer」，照常升版不刷新。
   - 放弃 ①：蓝图升版若**改变了投影内容**（不只是身份），去身份后不一致，该 CU 被跳过、须人工删三份派生文件再调和。无法区分「蓝图改了」与「人改了」——没有旧蓝图字节可重算旧投影。宿主本次事故的蓝图修改是否落在被投影的 `acceptance` / `contracts` / `use_cases` 字段内**未核实**：只补节点属性（投影不拷贝）则走得通；若落在内，会被跳过并给出人工处理指引。
   - 放弃 ②：全部三份文件的来源戳都被人改成非机器值时视为手写、不刷新；此时若 use-cases.yaml 仍在，投影门照旧拒绝出生（与升版前同样被拒，不变差）。
   - 放弃 ③：新投影不再含某份文件（如蓝图删掉 use_cases）时，旧文件不删。
2. **successor 的 spec/plan 由当前输入绑定满足，不再算「阶段复用」**（#9 的 `reused` 少了 spec/plan）。
   - 这是按当前输入重生成候选的本意：定义义务现在有可核验的绑定。
   - 放弃：后继 completion 的阶段集合不再列出 spec/plan（它们由绑定覆盖，assess 判 covered）。
3. **`requested_phases` 取源 run 完成链**，不是全 workflow。全链会给源 run 没跑过的 testing 加请求标记，凭空进链。
   - 放弃：源 run 未请求、而新输入需要的阶段，只能靠派生义务（验收分层 / 影响判断）进链，不会因「用户请求」进链。
4. **影响判断的来源按当前字节重新绑定**，删掉 t3 的 `impactInherited`。
   - 原因：源 run 记录的影响绑定落在旧工程根、且被 coding 改过的文件上，原样继承会被判不可用；重新绑定后逐字节核对自然通过，`impactInherited` 成了死代码。
   - 放弃：影响判断的「出生时观察」语义换成「当前代码观察」，结论与理由仍是源 run 的。
5. 源 run 没有可读有效范围时 successor 直接报错（旧实现会退回读 feature 候选）。1.2 fresh run 都有出生范围，未发现依赖该退路的测试。
6. OpenSpec 规格未补刷新规则（任务未要求）。`change-unit-continuous-progression`「指针原位升版」条目可在 t5 顺带写一句。

#### t2d 判据收回（2026-09-25）

调度裁决：刷新只核来源戳，收回 t2c 的「去掉身份字段后内容一致」核对。t2c 段的偏离 1 及其「放弃 ①」随之作废。
- 理由 1：宿主事故的蓝图升版（rev2→rev3）恰恰改了会进投影的内容（development 节点补 `module`、术语事实、architecture_impact 决策）。按内容一致判据，宿主 CU v2 会被 skipped、退回人工处理，★2 要解决的正是这个场景。
- 理由 2：带 `derive.blueprint-*` 来源戳的文件按定义就是机器投影。「保戳手改」在旧蓝图下已被投影门（`deriveBlueprintSkillInput` 的 use-cases 冲突判定）拒绝、任何 run 起不来，是非法态而非人工决策，覆盖它即修复。「不覆盖人工决策」保护的是无来源戳的手写文件（仍不刷新、指针照常升版）。

**判据现状**
- `inspectProjectionStamps` 三态不变：
  - 无戳 → 不刷新、照常升版；
  - 全部戳指向升版前 CU sha + 蓝图 sha（contracts 另要求 `change_unit_ref.artifact_sha256` = 升版前 CU sha）→ 刷新；
  - 部分带戳 / 戳指向别的身份 / 读不出 → skipped `derived_projection_not_machine_owned`。
- 删除 `ProjectionNotMachineOwned`、`withoutIdentity`、`isStaleMachineProjection`，以及 reconcile 里「只撤回单个 CU」的分支。
- writer 覆盖前只复核同一来源戳（`hasPreBumpStamp`），不符即普通错误 → 整批回滚。原子批与回滚不变。
- `docs/concepts/blueprint-design-inputs.md` 那句同步为「来源戳指向升版前身份即刷新」。

**★2 变体（宿主事故形状）**
- 改动字段：快照蓝图 node `ledger-domain`（ledger-refresh 的 design_ref 目标）自带的 `acceptance.criteria[0].expected_result`。`deriveBlueprintSkillInput` 把 design_refs 目标的 `acceptance` / `contracts` / `use_cases` 字段原样合并进投影，所以该字段一定会流进 acceptance 投影。
- 改后升 revision，过 P1 校验；reconcile → ledger-refresh 升版，`acceptance.yaml` 刷新为新内容。
- successor 实测 `phase_chain=["coding","review","ut"]`、`reused=[]`，等于 assess（按出生范围）uncovered 的责任阶段，不含 spec/plan；与纯身份升版的 ★2 相同。

**测试改动**
- handoff：
  - 正例三组共用同一组断言：三份文件都变、逐字段等于新投影、投影门两种都 `resolved`、来源戳 / `change_unit_ref` 指向新身份、feature 其它文件不变、幂等。三组分别为：
    - 纯身份升版；
    - 投影内容变化（另断言 acceptance 的新 `expected_result`）；
    - 保戳手改一个 use-cases 字段（原反例改为正例，另断言手改值被修复）。
  - 反例两组：
    - use-cases 来源戳指向别的身份（保留）；
    - contracts `change_unit_ref` 指向别的 CU sha（由原子性 ① 改来）。
    - 两组都是 CU skipped，CU、三份投影、feature.yaml 字节不变。
  - 原子性保留写出中途失败整批回滚一例。
- successor-exit：★2 抽成 `star2(s, mutate?)`，新增「★2 变体」用例。

**反向变异**：把「部分带戳 / 戳指向别的身份」也放行（`inspectProjectionStamps` 恒返回 `'stamped'`）→ handoff 18/2，两条戳反例转红（writer 复核抛错 → 整批拒绝，不再是 skipped + 字节不变）；恢复后 cmp 一致。

**验证**（日志逐个 grep 结论）
- `npm run typecheck` EXIT=0。
- 过滤套件：
  - component-design：host-seams 18/0、handoff 20/0；
  - successor-exit 6/0；blueprint-skill-projection 23/0；feature-assessment 7/0；change-unit-progression 97/0；component-closure 42/0；
  - real-chain（显式）12/0。
- 仓根 `openspec:validate` 49/0；`check-plan-version` PASS。
- 未跑：全量 `npm test`（批一收口时一次）。

### t4b lifecycle-evolution 套件（2026-09-25，未提交）

**结论：套件已落地并登记为 release-only。7 条用例全绿；L2 / L3 / L4 被一个生产缺口挡住。按任务书要求未改生产代码，停在这里报告。**

**做了什么**
- 新增 `harness/tests/unit/lifecycle-evolution.unit.test.ts`，并在 `run-unit.ts` 登记 `{ id: 'lifecycle-evolution', releaseOnly: true }`。
- 主线 `evolve()`：
  1. 加载快照，做宿主改动（全部用生产 writer）；
  2. `freezeAndTransfer`：冻结范围并转交给源 run；
  3. 提交；
  4. 用生产 `resolveSuccessorExecutionScope` 预判本次范围，取 `assessFeature(opts.scope=该范围)` 的 uncovered 责任阶段作为期望出生链；
  5. 经 goal-runner `--supersede`（进程内 goalMain，`realHarness`），用 real-chain 的逐阶段作者材料真跑后继链。
- 每条后继用例都断言：
  - 出生链等于预判；
  - `successor_of` 正确，supersede 审计事件在；
  - 旧 completion 原件字节不变；
  - `transfers=[源, 后继]`；
  - 无新 CU 目录；
  - 新 completion 落在后继 run 目录，`record.run_id=后继`，`complete=true`。
  - 全程不注入 verdict。
- 复用：
  - `successor-exit.unit.test.ts` 的 helper 改为 export；`supersede()` 加可选第 5 参 `extra`，透传给 `runGoalRuntimeChain`，缺省时行为不变。
  - real-chain 的 writer、`publishVerifier`、`dumpPhase` 原样复用。

**两处夹具适配**（都不是生产改动，逐条写明放弃的准确性）

1. **facts 身份位**
   - 现象：real-chain 的 writer 每阶段都把 `run_id` 写成当前 run。源链全程是同一个 run，所以没有差别。
   - 后继里，非建立阶段走的是「经验证的已有基线」：基线段（含 `run_id`）一字不能动（`context_exploration_facts_baseline_stale`），基线下 run_id 核对豁免。
   - 首跑 L5 原样复用 writer，撞上 `context_exploration_facts_established_by_invalid`。
   - 改法（`factsIdentity()`）：建立阶段重跑时用当前 run；其余阶段沿用 facts 里已记录的 run_id。
   - 放弃的准确性：无。这是真实 agent 的合法写法。但 real-chain writer 本身不认这条规则，后继场景不能直接复用。

2. **lineage diff 基线不可达**
   - 现象：快照不含 `.git`（t4a 的排除项），而后继按 lineage 继承源 run 的 `run_base_sha`。coding 的 `diff_within_scope` 取不到这个对象就 fail-closed。首跑 L1 实测：`baseRef 不可达（不存在的 commit）：72b5c922…`。宿主上历史完整，不会发生。
   - 近似做法：
     - 每个 Feature 的 lineage 基线 = 快照去掉**该 Feature 自己**的 `<module>/src/ohosTest` 之后的树；
     - 完整快照作为这两个基线的合并提交；
     - 用 `git update-ref refs/replace/<源 run 基线 sha> <近似提交>` 让对象可取。
     - 生产路径与命令都不变。
   - 试过并放弃的两种：
     - 「基线 = 快照 HEAD」：UT 文件不在 diff 里，ut 判 AC-1 无覆盖证据。宿主不会这样。
     - 「两个 Feature 共用去掉全部 ohosTest 的基线」：CU 的 coding 把平铺 Feature 的测试文件判越界。宿主上 CU 源 run 的基线里这个文件本来就存在。
   - 放弃的准确性：
     - 近似基线不是源 run 出生前的原树。coding 改过的产品源码、新建的 BankListItem 和 PNG 在近似基线里已经是终态，diff 只剩测试文件和后继改动。
     - 所以「源 run 全部改动 + 后继改动」的合并 diff 的 scope 判定没有覆盖。
     - CU 的测试文件在宿主基线里是空壳（归「存量文件内新增用例」），在近似里是「新建」（全量问责，更严）。
     - 根治要让快照带上 git 历史（如 bundle）。这属于 t4a 夹具范围，没有做。

**每条用例的实际出生链与结论**（2026-09-25 实跑）

| 用例 | 预判 uncovered（id@owner/class） | 实际出生链 | reused | 结论 |
|---|---|---|---|---|
| L0 ★1 | —（快照原样，无 git） | — | — | 两个 Feature 均 `complete=true` |
| L1 ★2 事故形状（CU，蓝图 rev2→rev3，并改 `ledger-domain` 的验收 `expected_result`） | implementation:request@coding/evidence、code-review:request:review@review/evidence、unit-evidence:acceptance@ut/evidence | `[coding, review, ut]` | `[]` | 三阶段真 harness PASS，`CHAIN_SLICE_COMPLETED`，新 completion 落后继 run，`complete=true` |
| L2 #6 补测试（平铺，加 AC-3 unit 层 + 新测试文件） | 六个义务全部是 `/evidence`（acceptance-context:candidate@spec … device-evidence:acceptance@testing） | `[spec, plan, coding, review, ut, testing]` | `[]` | **BLOCKED**：spec、plan PASS；coding 的 `diff_within_scope` FAIL，run HALTED |
| L3 #7 改文案（平铺，改 spec.md 一段） | 同 L2，六条 `/evidence` | 六阶段 | `[]` | **BLOCKED**：同 L2 |
| L4 #8 改验收（平铺，加 AC-9 device 层） | 同 L2，六条 `/evidence` | 六阶段（含 testing） | `[]` | **BLOCKED**：停在 coding，testing 没跑到。testing 真跑后的结论（COMPLETE_WITH_GAPS 或不完成）**尚未取得** |
| L5 #9 删 ut 的 manifest（平铺） | unit-evidence:acceptance@ut/evidence | `[ut]` | `[coding, review, testing]` | ut PASS，`complete=true` |
| L6 #10 晚到的未终局 run | — | — | — | `record=ok`；`blocking` 含该 run；义务全部 covered；`complete=false` |
| L7 #11 在途 CU（删 development 节点 `ledger-module` 的 `module`，不升版） | — | — | — | 见下方 L7 细节 |
| L8 #12 `revises` | — | — | — | 见下方 L8 细节 |
| L9 ★3 伪造记录（CU，改 `phases[1].run_id`） | assess：`record=broken`，uncovered `[]` | `[coding, review, ut]` | `[]` | 出生时 `reused_phases=[]`，没有义务引用旧阶段证据，无新 CU 目录（只验出生，不跑链） |

- L7 细节：
  - 删之前，三个在途 CU 都能解析。
  - 删之后，ledger-consumer、ledger-recovery、ledger-summary 全部 `change_unit_invalid`。
  - 已完成 CU 仍是 `record=ok`，uncovered 如实列出：acceptance-context:candidate@spec/binding、design-context:candidate@plan/binding、implementation:request@coding/evidence、code-review:request:review@review/evidence、unit-evidence:acceptance@ut/binding、device-evidence:acceptance@testing/binding、phase:testing@testing/binding。
- L8 细节：
  - ledger-consumer 加上 `revises` 后，load、validate 都没有 BLOCKER。
  - 已完成 CU 仍是 `complete=true`。
  - 调和空转，结果 `{bumped:[],skipped:[]}`。
  - 蓝图升版后，它和其它 CU 一样被原位升版，`revises` 原样保留。

**生产缺口：挡住 L2 / L3 / L4**（未改，交调度裁决）
- 受影响用例：L2 / L3 / L4，都是平铺 Feature 完成后修正、且后继链含 coding。
- 检查：`check-coding.ts` 的 `checkDiffWithinScope`（`diff_within_scope`，BLOCKER）。
- 错误原文：`本次实现超出冻结模块或文件授权：02-Feature/FinancialCard/src/ohosTest/ets/test/AllBanksPage.test.ets`（L2 还多一个 `…/BankListItem.test.ets`）。
- 根因：
  - 后继按 lineage 继承源 run 的 diff 基线（goal-run-creation 的 `successor run_base_sha`），所以 diff 里有源 run 的 ut 新建的测试文件。
  - UT 产出豁免 `replayUtOwnedWrites(loadAuthoritativeRunEvents(…, runId))`（`check-coding.ts:345-356`，plan f3b8d261）只回放**本 run** 的事件。
  - 平铺 Feature 的测试文件不在 contracts.files 里，于是被判为 coding 越界。
  - CU 的测试文件由 `change_unit.*.test_refs` 授权，所以 L1 不受影响。
- 宿主能否复现：能。平铺源 run 的出生基线里本来就没有这个测试文件（是源 run 的 ut 新建的），宿主历史完整时 diff 同样包含它。本近似没有放大这个问题。
- 影响面：§6 #6 / #7 / #8，以及任何「平铺 Feature 完成后修正、后继需要重跑 coding」的场景。
- 套件处置：
  - L2–L4 的代码保留，在 `BLOCKED` 表里逐条写明原因；运行时打印 `BLOCKED（未执行）`，不计入结果。
  - 缺口修复后，删掉对应条目即可恢复执行。
  - 不用「断言当前失败」的方式把缺陷行为锁住。

**与 §6 表预期不同之处**（交 review 裁决）
1. #6（L2）
   - 预期：uncovered={ut, testing}，只跑这两个阶段。
   - 实际：六个义务全部 uncovered/evidence，出生链六阶段。原因是每个阶段的证据清单都登记了 acceptance.yaml（t1 偏离 5、t3 #8 已记录）。
2. #7（L3）
   - 预期：内容对齐后 covered，或只有 spec 义务 uncovered；coding 及以后不重跑。
   - 实际：只改 spec.md 也是六阶段全链。spec.md 同样进了下游各阶段的证据清单。
3. #8（L4）
   - 出生链六阶段（t3 已记）；testing 的结论没有取得，被上面的缺口挡在 coding。
   - 夹具的 test-chain profile 有 device_test 替身，`deviceGate` 默认注入 READY(physical)。所以 testing 如果能到达，走的是替身设备链，而不是任务书设想的 unsupported_gap 路径。
   - AC-9 没有对应的设备用例，预期 testing 会报覆盖缺口，但这一点还没实跑。
4. ★2（L1）
   - §6 预期：coding / review / ut / testing 的证据复用，只补 plan。
   - 实际：CU 蓝图升版并改了投影内容后，出生链是 `[coding, review, ut]`，`reused=[]`。spec / plan 的义务由刷新后的派生投影绑定满足，与 t2c、t2d 的实测一致。该 CU 没有 testing 义务。
5. ★3（L9）
   - 「出生链 = assess 的 uncovered 责任阶段」在记录不可信时不成立。
   - assess 按 ★3 不把 broken 记录摊成义务缺口，uncovered 为空。
   - 出生解析器不从不可信记录取复用证据，链是全部 required 义务的责任阶段 `[coding, review, ut]`。
   - L9 按后者断言。
6. #11（L7）
   - §6 只写了「仍然 change_unit_invalid」。
   - 实测还看到：已完成 CU 的 uncovered 覆盖 spec 到 testing 全部责任阶段。原因是蓝图字节变了，所有绑定蓝图派生输入的义务都 binding / evidence 失效。
   - record 仍是 ok，符合 §3.3「不追溯判 broken」。

**时长**
- `--filter lifecycle-evolution` 全套 103 s。
- 分项：L0 1.5 s、L1 59.7 s、L5 9.0 s、L6 1.0 s、L7 1.2 s、L8 2.6 s、L9 25.2 s。
- L2–L4 未执行；临时解除 BLOCKED 单独实跑，每条约 20 s，都停在 coding。

**验证**（日志逐个 grep 结论）
- `npm run typecheck` EXIT=0。
- 过滤套件：
  - `--filter lifecycle-evolution` 7/0；
  - `--filter successor-exit` 6/0；
  - `--filter feature-assessment` 7/0；
  - `--filter real-chain` 12/0（real-chain 4 + seams 8，476 s）。
- `node scripts/check-plan-version.mjs` PASS；三个改动文件用 node 扫描，CR=0。
- 未跑：全量 `npm test`（批一收口时跑一次）。

**偏离**
- 任务书要求 L2–L4「跑完 → 新完成结论」。因上述生产缺口没有达成；按「不改生产代码、停下报告」处理，也没有登记必红用例。
- L9 没有让后继跑完链（任务书只要求出生断言）。

**改动文件**
- `harness/tests/unit/lifecycle-evolution.unit.test.ts`（新）
- `harness/tests/run-unit.ts`（登记一行）
- `harness/tests/unit/successor-exit.unit.test.ts`（helper 改为 export；`supersede()` 加可选 `extra` 参）

### t3c successor 沿血缘回放 UT 产出（2026-09-25，未提交）

**结论：t4b 抓到的缺口已修。L3 / L4 跑到新的完成结论；L2 越过了这个缺口，但又撞上第二个、性质不同的缺口（宿主在两次 run 之间自己提交的测试文件），仍在 `BLOCKED`，交调度裁决。**

**落点**
- 新 helper `loadLineageRunEvents(projectRoot, feature, runId)`，放在 `harness/scripts/utils/goal-run-creation.ts`，紧挨 `loadAuthoritativeRunEvents`：
  - 先读本 run 事件；
  - 本 run manifest 有 `successor_of` 时，以它为 seed 调用既有的 `collectSupersededAncestorEvents`（沿审计 supersede 递归、按 ts 升序），把祖先事件接在本 run 事件之前；
  - 没有 `successor_of` 时，返回值就是本 run 事件，与现状逐字相同。
- `check-coding.ts` 的 `diff_within_scope` 是唯一取事件的地方，改为调用这个 helper。`replayUtOwnedWrites` 没有改：祖先事件排在前面，源 run 后续阶段的改写照常让 `voidedBy` 成立。
- 其它消费方已排查：`replayUtOwnedWrites` 只有 check-coding 在用。check-ut / check-review 没有按事件判断 UT 归属的逻辑。goal-run-creation 里 `phase_write_observed` 的另一处消费属于 fresh-run continuation 判定，不属于 UT 归属，不动。
- 放在 goal-run-creation 而不是任务书举例的 goal-runner-phase / phase-write-boundary：它和 `loadAuthoritativeRunEvents` 同属一层（读 run manifest + events），check-coding 原本就从这里 import，不新增依赖方向。这只是落点选择，没有放弃任何准确性。
- 精确解析器、diff 基线继承规则都没有改。

**L2–L4 实测**（`--filter lifecycle-evolution`，2026-09-25）

| 用例 | 出生链 | reused | 结论 |
|---|---|---|---|
| L2 #6 补测试 | `[spec, plan, coding, review, ut, testing]` | `[]` | **仍 BLOCKED（新原因）**：spec、plan PASS；coding `diff_within_scope` FAIL，只剩 `02-Feature/FinancialCard/src/ohosTest/ets/test/BankListItem.test.ets`，`AllBanksPage.test.ets` 已由血缘承接 |
| L3 #7 改文案 | `[spec, plan, coding, review, ut, testing]` | `[]` | 六阶段全部 PASS，`CHAIN_SLICE_COMPLETED`，`complete=true`，新 completion 落在后继 run（35.4 s） |
| L4 #8 改验收（AC-9 device 层） | `[spec, plan, coding, review, ut, testing]` | `[]` | spec 到 ut 全部 PASS。testing 在夹具的替身设备链上真跑，打包和装机都是 PASS；`acceptance_to_test_case` FAIL（AC-9 没有设备用例，P1 覆盖 1/2）。重试一次后同一 blocker_signature 触发 `no_progress_guard`，run HALTED，`complete=false`，record 为 `ok`，`blocking` 含该 HALTED 后继 run。没有假 PASS，断言通过（37.3 s） |

- L2 新原因：`change` 里宿主自己写了 `BankListItem.test.ets` 并提交（`utCoversAc3`），然后才起后继。后继 diff 基线继承源 run，所以这个文件在 diff 里；它不在 `contracts.files` 里，任何 run 也没有它的 UT 调用事实，于是被判为 coding 越界。这不是本缺口（跨 run UT 产出）。它属于「宿主在两次 run 之间的提交落在 lineage diff 里」，要修得动 diff 基线继承或 coding 归属规则，本任务约束不许改。
- 探针（未入库）：把 L2 的 `change` 临时改成只加 AC-3 验收、测试文件交后继的 ut 去写，L2 六阶段全部 PASS，`complete=true`（36.7 s）。说明除上面这一点外，L2 没有其它阻塞。探针代码已还原。
- `BLOCKED` 表只留 L2，原因改写为新缺口；L3 / L4 已移出。

**测试**
- `standalone-coding-review` 新增一条用例：`b2d7f4e9 t3c a successor inherits the source run UT output through the lineage, and a later source coding rewrite still voids it`。
  - 正例：源 run 的 ut 事件里有 `Value.test.ets` 的 owned 写，用生产 `createGoalRun` 起一个 `successor_of=源`、继承源 `run_base_sha` 的后继。后继自己的事件里没有 UT 事实，在后继身份下 `diff_within_scope` PASS。
  - 反例：源 run 的 coding 先改写该文件、再恢复成 UT 字节，然后起新后继。结果 FAIL，affected 含该文件，details 含「被 coding 改写」。
  - 夹具 `context(phase, goalRunId = manifest.run_id)` 加了可选 run 身份参数，缺省时行为不变。
  - 原有 U4「非血缘的其它 run 不承接」仍然 PASS，锁住「只沿 supersede 血缘，不是任意 run」。
- 反向变异：把 helper 改成恒只返回本 run 事件，结果如下（恢复后重跑全绿）：
  - `standalone-coding-review` 44/1，新用例转红：`本次实现超出冻结模块或文件授权：src/demo/src/ohosTest/ets/test/Value.test.ets`；
  - `lifecycle-evolution` 7/2：L3 转红（coding `diff_within_scope` 报 `AllBanksPage.test.ets`），L4 转红（后继没有执行 testing）。
  - L2 在 BLOCKED 里不执行，所以由 L3 / L4 代它承担「变异转红」的证据。

**验证**（日志逐个 grep 结论）
- `npm run typecheck`：EXIT=0。
- 过滤套件：
  - `--filter standalone-coding-review`：45/0；
  - `--filter phase-write-boundary`：9/0；
  - `--filter lifecycle-evolution`：9/0，L2 BLOCKED 未执行；
  - `--filter successor-exit`：7/0。
- `node scripts/check-plan-version.mjs`：PASS。
- 四个改动文件用 node 扫描，CR=0。
- `--filter coding`：64/0，匹配面为以下四个套件，没有过宽：
  - standalone-coding-review 45；
  - coding-failure-kinds 15；
  - generic-coding-host 1；
  - profile:hmos-app:coding-lint-provider 3。
- `--filter real-chain`（显式）：12/0，其中 real-chain 4、real-chain-seams 8，含 RC-9 / RC-9b。
- 未跑：全量 `npm test`（批一收口时跑一次）。

**偏离**
- 任务书要求 L2 跑到新完成结论，没有达成，原因是上面那个第二缺口。放弃的准确性：lifecycle-evolution 没有覆盖「宿主手写测试文件后起后继」这条路径，只有探针证明变体可以跑完。
- 为了临时单跑 L2–L4，迭代期间给 runAll 加过一个 env 过滤开关，收口前已删除，不入库。

**改动文件**
- `harness/scripts/utils/goal-run-creation.ts`（新增 `loadLineageRunEvents`，import `collectSupersededAncestorEvents`、`relFeaturesDir`）
- `harness/scripts/check-coding.ts`（取事件改用这个 helper）
- `harness/tests/unit/standalone-coding-review.unit.test.ts`（新增用例；`context` 加可选 run 身份参数）
- `harness/tests/unit/lifecycle-evolution.unit.test.ts`（`BLOCKED` 只留 L2，原因改写）

#### t3c 补：L2 按调度裁决走 `--rebaseline-to`（2026-09-25，未提交）

**结论：rebaseline 在进程内测试里没有被挡，出生和 coding 都正常；但 ut 阶段撞上第三个缺口，L2 仍未跑到完成结论，重新放回 `BLOCKED`，交调度裁决。宿主指引没有改，理由见下文。**

**做法**
- `evolve()` 加了可选字段 `rebaseline`，L2 设为 true：宿主改动提交后取 `git rev-parse HEAD`，经 `runGoalRuntimeChain` 既有的 `rebaselineTo` 参数传入 `--rebaseline-to <sha>`。
- 按现有实现断言三处记录：
  - 后继 manifest 的 `run_base_sha` 等于该 sha；
  - `run_created` 事件带 `rebaseline_from_run_id=源 run`；
  - supersede 审计事件带 `rebaseline_to=该 sha`。
- 其余通用断言照旧。

**实测**（`--filter lifecycle-evolution`）
- `validateRebaselineRequest` 没有被 `hasGoalExecutionSignal` 挡住，出生成功，上面三处 rebaseline 断言全部通过。
- 出生链 `[spec, plan, coding, review, ut, testing]`，reused `[]`。
- spec / plan / coding / review PASS，coding `diff_within_scope` 不再报越界。
- ut FAIL，run HALTED，`complete=false`。testing 的 PASS 来自盘上旧 summary，不是这次后继的结论。
- ut FAIL 的检查：
  - `ut_coverage_evidence_mappings_complete`：AC-2 / AC-3 的 `evidence_source=ut_tags` 找不到底层证据；
  - `ut_coverage_evidence_resolves`：AC-2 / AC-3 无覆盖证据；
  - `ut_case_per_unit_ac`：「无 scoped UT 文件可分析」。
- 根因：check-ut 的覆盖口径 `coverageUtFiles = targetCaseView`，来自 plan 423e5d0f 的「只问责本 feature 责任域」。它以 `run_base_sha` 为身份基线，只认基线之后新建的测试文件或存量文件里新增的用例。日志原文：「新建 0 个文件 + 存量文件内新增 0 个用例；工作模式=cover_feature_change … 锚=run_base_sha」。
  - rebaseline 之后，源 run 写的 `AllBanksPage.test.ets` 和宿主提交的 `BankListItem.test.ets` 都已经在基线里。它们本来就属于这个 feature，但不再计作覆盖证据。
  - 沿用 lineage 基线（L3 / L4）时，这些文件相对源 run 出生基线是新建的，所以能计入。
- 影响：凡是经 `--rebaseline-to` 起、且链上含 ut 的后继，只要不重新产出测试，ut 就过不了（已有的测试不算，agent 只能重写用例）。这是 rebaseline 路径与 UT 覆盖口径之间的缺口，不是夹具造出来的。

**处置**
- L2 重新放回 `BLOCKED`，写明新原因。rebaseline 的代码和断言保留，缺口修复后删掉该条目即可恢复执行。
- 宿主指引（`templates/AGENTS.md.template`、`docs/operations/project-entry.md`）没有改。原因：指引建议的「已提交就把基线重设为当前提交」，在链上含 ut 时会把宿主带进上面这个死路。等调度对缺口裁决后再补，所以 `--filter docs` 也没跑。
- 已知未覆盖路径（交 t5 裁决是否补覆盖）：
  - 宿主**未提交**就手写测试文件后起后继：会被 coding 判越界，正解是先提交，或把测试交给后继的 UT 阶段写；
  - 宿主**已提交**后走 rebaseline 起后继：卡在 ut 覆盖口径，即本节的缺口。
  - 前一节探针已证明第三种写法可以跑完：宿主只改验收、测试文件交给后继 UT 写、沿用 lineage 基线。

**验证**（日志逐个 grep 结论）
- `npm run typecheck`：EXIT=0。
- 过滤套件：
  - `--filter lifecycle-evolution`：9/0，L2 BLOCKED 未执行；
  - `--filter successor-exit`：7/0；
  - `--filter goal-run`：254/0，共 9 个套件，含 goal-run-birth-contract 20 与 goal-runner-testing-integrity 84。
- `check-plan-version`：PASS。
- `--filter docs`：未跑，因为文档没改。

#### t3c 定稿：L2 / L2b（2026-09-25，未提交）

**调度裁决**：上一节的「第三个缺口」**不是缺陷**。它是 plan 423e5d0f 用户裁决过的棘轮授权基线：本轮 UT 覆盖证据只认本轮基线之后产出的测试。上一节里「缺口」「死路」等表述按此更正。

**实测**（`--filter lifecycle-evolution` 11/0，`BLOCKED` 机制已整体删除）

| 用例 | 宿主改动 | 出生链 / reused | 结论 |
|---|---|---|---|
| L2 #6 补测试（主用例） | 只在 acceptance 加 AC-3（unit 层）；测试文件交后继 ut 写；沿用源 run 基线 | 六阶段 / `[]` | 六阶段全部 PASS，`CHAIN_SLICE_COMPLETED`，`complete=true`，新 completion 落在后继 run（37.4 s） |
| L2b #6 变体（立场断言） | 加 AC-3，并手写 `BankListItem.test.ets`、更新 UT 证据文件，然后提交；用 `--rebaseline-to <HEAD>` 起后继 | 六阶段 / `[]` | 见下（31.0 s） |

L2b 的断言全部成立：
- 三处 rebaseline 记录正确：manifest `run_base_sha`、`run_created.rebaseline_from_run_id`、supersede 审计的 `rebaseline_to`；
- 后继真跑了 coding 和 ut，coding `diff_within_scope` PASS；
- ut FAIL，失败检查含 `ut_coverage_evidence_resolves` 与 `ut_coverage_evidence_mappings_complete`；
- `it_name_has_ac_or_branch_tag` 的 details 写着「新建 0 个文件 + 存量文件内新增 0 个用例 … 锚=run_base_sha」；
- `complete=false`，record 仍为 ok，没有假 PASS。

**宿主指引**（话术，追加在原 t3 改口段末尾，同一行，不增加行数）：「改动已提交进仓库的，起后继时把基线重设为当前提交；未提交的沿用源 run 基线。测试用例一律交给后继的 UT 阶段产出，框架不把基线里已有的测试算作本轮覆盖证据。」
- `templates/AGENTS.md.template:74`，全文 117 行；
- `docs/operations/project-entry.md:38`，全文 43 行；
- `--filter docs`（docs-authoring-lint）18/0，含 `checkEntryTemplateBudget`。

**已知路径**（登记，不补覆盖）：宿主**未提交**就手写测试文件后起后继，会被 coding `diff_within_scope` 判越界。正解是先提交、起后继时重设基线，并让 UT 产出测试。

**验证**
- `npm run typecheck`：EXIT=0。
- 过滤套件：
  - `--filter docs`：18/0；
  - `--filter lifecycle-evolution`：11/0；
  - `--filter successor-exit`：7/0。
- `check-plan-version`：PASS。
- 改动文件 CR=0。
- 未跑：全量（批一收口时跑一次）。

**本节改动文件**
- `harness/tests/unit/lifecycle-evolution.unit.test.ts`：L2 改为第三种写法；新增 L2b；删除 `BLOCKED`。
- `templates/AGENTS.md.template`
- `docs/operations/project-entry.md`
### Codex 一轮 review 四条必须修复（2026-09-25，未提交）

纪律：每条先写按 Codex 反例会转红的测试并跑红，再修复跑绿，最后撤掉修复做反向变异。四条反例都复现成功，核实结论均为**成立**。
日志都在 scratchpad：`red-*.log`（修复前）、`g-*.log`（修复后）、`mut-*.log`（变异）、`v-*.log`（其余验证）。

**1. [P1] 投影刷新写到一半失败——成立**
- 红测试：`component-design-handoff`「b2d7 t2c refresh atomicity: a write that dies half-way leaves the file being written intact」。
  - 桩：`require('fs').writeFileSync` 写到 `use-cases.yaml*` 时先写入一半内容再抛 ENOSPC，只触发一次。
  - 修复前红（20/1）：`写到一半的投影留下损坏字节 / 未回滚`，CU 指针已回滚但 use-cases.yaml 留下半截字节。
- 修复（`blueprint-skill-projection.ts:303-321`，`materializeBlueprintSkillInputs`）：
  - 逐文件写到 `<file>.tmp-<pid>` 再 `renameSync`，与 completion 原件（verify-feature-completion.ts:727）同一写法；失败时删除临时文件后抛出；
  - 原 `flag:'wx'` 的「新文件不得已存在」语义改为写前 `existsSync` 检查；
  - writer 内部回滚已成功项（原逻辑）。当前项靠 rename 原子性保持原字节，所以外层批回滚无需再登记它。
- 未采用：外层 `change-unit-design-preparation.ts` 在调用前就登记当前 feature 原字节。试过：既有「use-cases.yaml 只读」原子性用例里，外层回滚去写只读文件抛 EPERM，吞掉了 `change_unit_blueprint_ref_bump_rejected`。在 temp→rename 之下这一步也是多余的，已撤回，只改了注释（`:311`）。
- 绿：component-design（host-seams 18/0 + handoff 21/0）。
- 反向变异 m1（去掉 rename，直接写目标文件）：handoff 20/1，新用例转红。

**2. [P1] CU 升版破坏 `supersedes` 退役关系——成立**
- 红测试（`component-closure`）：
  - 「b2d7 re-point keeps a supersedes chain (consumer → recovery → summary) exact across the bump」
    - 修复前红：`component_closure_supersedes_invalid ... ledger-recovery`，4 个 CU 全部升版后 consumer/recovery 的 supersedes 失效；
  - 「b2d7 re-point: a CU retired by a referrer that is not bumped in this batch is not bumped either」
    - 引用方 consumer 因契约变化被跳过，被引用的 summary 却照样升版，consumer 的精确引用失效。
    - 这是 Codex 反例的同根情形：新建 CU 在新蓝图下 supersedes 旧 CU，旧 CU 一升版引用就失效。
  - 修复前 42/2。
- 修复（`change-unit-design-preparation.ts:239-272`，`reconcileChangeUnitBlueprintRefs` 内，写前校验之前）：
  - `exactRef`：只维护升版前精确成立的引用，判据为 blueprint_id / change_unit_id / revision / artifact_sha256 全部相等；
  - 不动点收敛：引用方本批不升版（在当前蓝图上、被跳过、或自身被钉住）→ 被引用者移出本批，进 `skipped`，原因 `superseded_by_unbumped: 被 X 以 supersedes 精确引用…`。退役 CU 在 closure 里本就不贡献（`currentUnits` 只取未退役者），所以不升版没有代价；
  - 拓扑改写 `finalize`：递归先算被引用者升版后的字节 sha（`sha256Bytes(YAML.stringify(next))`，与 `writeCanonicalChangeUnit` 写出的字节相同），再把引用方 `supersedes.revision / artifact_sha256` 改为新值，最后算引用方自己的 sha。精确引用不可能成环，因为两个 CU 不可能互相包含对方的字节哈希。
  - 之后照旧：全量 `validateChangeUnit` → 整批写出 → 投影刷新；原子性与回滚不变。引用未升版 CU、或升版前就不精确的 supersedes 一律不动（不洗白）。
  - `revises` 是读兼容遗留、无消费者，不维护。
- 绿：component-closure 44/0；change-unit-progression 97/0；component-design 39/0。
- 反向变异：
  - m2a（`pending.forEach(finalize)` → `void finalize`）：43/1，链式用例红；
  - m2b（不动点循环不进入）：43/1，钉住用例红。

**3. [P1] 显式需求增量下 successor 仍按旧需求复用——成立**
- 红测试（`successor-exit`）：「需求增量（codex r1 P1-3）只改显式需求、不预改产物 …」。
  - 平铺快照 Feature，`--supersede` 加 `--requirement '查询超时由 3s 改为 5s（非视觉行为调整）'`，产物不动；
  - 修复前红：`phase_chain=[] reused=["coding","review","ut","testing"]`，runtime 以 empty scope 拒绝出生。
- 修复：
  - `feature-assessment.ts:58-62,138`：`AssessFeatureOptions.requirementSha?`。clean-pass 与沿链传染直查（同一个 `currentRequirementSha` 变量）用它；缺省仍是 `computeRunRequirementSha(记录 run)`。record 恒按历史 run 核验。
  - `feature-track.ts:153,195`：`resolveWithPriorEvidence` 的 ctx 加 `requirementSha`，只传给第 ③ 步的覆盖判定。
  - `feature-execution-scope.ts:39,746-751`：`resolveSuccessorExecutionScope` 用合并后的最终需求**原文**（不 trim，与 `computeRunRequirementSha` 读 manifest.requirement 同口径）经 `computeRequirementShaFromText` 算哈希传下去。
  - runtime 调用点（goal-phase-runtime.ts:5022）本就传入合并后的 `manifest.requirement`，未改。
- 结果：需求变了 → 各阶段闭环记录的 requirement_sha256 ≠ 最终需求 → lineage stale → uncovered → 撤回复用。实测 `phase_chain=[spec, plan, coding, review, ut, testing]`，`reused=[]`。
- 新用例断言：
  - 出生链 = `assessFeature(scope=出生范围, requirementSha=最终需求)` 的 uncovered 责任阶段，record `ok`；
  - 后继 manifest.requirement = 合并文本；
  - 正例：源需求原文按同口径算出的哈希 = `computeRunRequirementSha(源 run)`，按它 assess 为 `complete`。
  - #9（不带增量，phase_chain=[ut]）与 ★2 / ★2 变体（[coding, review, ut]）均不回归，证明需求未变时复用不受影响。
- 绿：successor-exit 7/0；feature-assessment 7/0；execution-scope 119/0。
- 反向变异 m3（resolveWithPriorEvidence 不传 requirementSha）：successor-exit 6/1，新用例以原症状 `phase_chain=[]` 转红。
- 放弃的准确性：
  - 需求一变就整链重跑：每个阶段的闭环都绑定了需求哈希，现行 lineage 语义下没有「只影响 spec」的细分；
  - 第 ② 步阶段证明复用核验（`executionScopeEvidenceIssues`）本身仍不比需求，由第 ③ 步 assess 撤回，结果等价，未改该共享判据。

**4. [P2] 旧根推断遇重复 features_dir 段——成立**
- 红测试（`verify-feature-completion`，helper 单测所在套件，无独立 `project-relative-path` 套件）：「b2d7f4e9 t4 (codex r1 P2-4) …」。
  - 旧根 `D:\archives\doc\features\host`，两条依赖 `…\host\doc\features\demo\{acceptance,contracts}.yaml`；
  - 修复前红：推出 `D:\archives`。
- 修复（`project-relative-path.ts:43-89`，`inferLegacyProjectRoot`）：
  - 收集记录里全部工程外绝对路径，marker 每处出现的前缀都作候选（盘符路径大小写不敏感去重）；
  - 唯一候选直接取，保持原行为，含依赖记为 `exists:false` 的情形；
  - 多个候选：按「重定位后在当前工程内且存在」的依赖数打分，最高者胜出；并列（含全为 0）返回 undefined，如实 stale；
  - 重定位与越界检查仍走原 `resolveDependencyPath` + `isInsideProjectRoot`。
- 新用例另断言：候选都不可判时返回 undefined。
- 绿：verify-feature-completion 20/0。
- 反向变异 m4（多候选退回取第一个）：19/1。

**改动文件**
- 生产：
  - `harness/scripts/utils/blueprint-skill-projection.ts`
  - `harness/scripts/utils/change-unit-design-preparation.ts`
  - `harness/scripts/utils/feature-assessment.ts`
  - `harness/scripts/utils/feature-track.ts`
  - `harness/scripts/utils/feature-execution-scope.ts`
  - `harness/scripts/utils/project-relative-path.ts`
- 测试：
  - `harness/tests/unit/component-design-handoff.unit.test.ts`（+1 例）
  - `harness/tests/unit/component-closure.unit.test.ts`（+2 例）
  - `harness/tests/unit/successor-exit.unit.test.ts`（+1 例）
  - `harness/tests/unit/verify-feature-completion.unit.test.ts`（+1 例）
- 未碰 check-coding.ts、goal-runner-phase.ts、phase-write-boundary.ts、lifecycle-evolution 套件、plan 文件。

**验证**（日志逐个 grep 结论）
- `cd harness && npm run typecheck` EXIT=0。
- 过滤套件：
  - component-design：host-seams 18/0、handoff 21/0；
  - component-closure 44/0；successor-exit 7/0；verify-feature-completion 20/0；
  - blueprint-skill-projection 23/0；feature-assessment 7/0；execution-scope 119/0；change-unit-progression 97/0；
  - real-chain（显式）12/0（real-chain 4 + seams 8）。
- 仓根 `npm run openspec:validate` 49 passed / 0 failed；`node scripts/check-plan-version.mjs` PASS。
- 10 个改动文件 node 扫描 CR=0。
- `--filter project-relative-path` 匹配面过宽（跑成大半全量），已手动停止并清理进程，无结论；该 helper 的单测在 verify-feature-completion 套件内，已绿。
- 未跑：全量 `npm test`（留给批一收口）。
- 五次变异恢复后（从备份按字节写回），component-design 39/0、component-closure 44/0、verify-feature-completion 20/0、successor-exit 7/0 复跑全绿（`post-*.log`）。
### Codex 二轮：退役 CU 不再阻断设计交接与推进 + 两条非阻断（2026-09-25，未提交）

一轮 ①③④ 已核实修复。本段处理 ② 新增的 `superseded_by_unbumped` 规则引入的 P1 回归，外加两条非阻断。日志都在 scratchpad 的 `r2-*.log`。

**P1 已退役 CU 仍阻断设计交接与推进——成立**
- 场景：B 已绑当前蓝图 rev3，并精确 `supersedes` 仍绑 rev2 的 A。
  - 调和时 A 被钉住不升版（`superseded_by_unbumped`，这条规则保留）；
  - 但 `deriveDesignPreparationReadiness` 仍要求 A 可施工，design gate 以 `change_unit_blueprint_unresolvable` 拒绝它，readiness 永久 `ready=false`；
  - ready set 也仍含 A。
- 红测试（`component-design-handoff`「b2d7 active set: …」三例；全绿之后另在 `component-closure` 补 1 例）：
  - 正例 1：A 指针一致，被钉住；
  - 正例 2：A 三处指针不一致，属契约变化，本就不可施工。两个正例都断言：readiness `ready=true`、`nextEntry=change-unit-progression`，活动集合与 ready set 都不含 A；
  - 反例 3：B 的 supersedes 目标 sha 不精确。断言 A 仍是活动 CU、以非 constructable 阻断 readiness、仍在 ready set 里（非法引用照旧阻断）；
  - 修复前（`r2-red-handoff.log`）：22/2，两个正例红，报 `合法退役的 A 仍阻断设计交接 … ledger-summary: reconcile_blueprint / change_unit_blueprint_unresolvable`；反例本就绿。
- 修复：
  - 共用判定 `retiredChangeUnitIds(projectRoot, blueprintId)`，放在 `component-closure-inputs.ts:171-190`（导出）：
    - 直接调 closure 既有的 `inspectRetirement`，退役条件相同：同部件、目标 revision 与 artifact_sha256 与 canonical 精确一致；
    - 只把它的入参类型放宽为 `Pick<RawClosureUnit, 'ref' | 'changeUnit'>`（`:113`），没有复制判据；
    - 卷入冲突或环的目标不算退役（issue path 命中 `change-unit:<id>` 即排除），照旧阻断；
    - 枚举或单个 CU 加载失败时不判退役，也就是按活动 CU 照旧校验、照旧报错。
  - readiness（`change-unit-design-preparation.ts:353-357`）：调和之后只对活动 CU 派生 perUnit、changeUnitIds、ready。退役 CU 的可见性由 `blueprintRefs.skipped` 里的 `superseded_by_unbumped` 原因承担。
  - ready set（`change-unit-ready-set.ts:73-80`）：入口按同一集合过滤。于是 ready、unfinished、silentProgressStall、allCompleted 全都只看活动 CU；注入的 `options.units` 同样过滤。
  - 精确解析器、design gate、closure 判据都未改。
- closure 侧用例（`component-closure`「b2d7 active set: B on the current blueprint exactly supersedes A on the old one …」）：
  - 调和后 A 进 skipped（`superseded_by_unbumped`）；
  - closure 把 A 记为 `current=false`、`retired_by=ledger-consumer`，没有任何 supersedes issue；
  - ready set 不含 A。
  - 放在 closure 套件，是因为 handoff 夹具没有 framework 树，跑不了完整的 closure 输入。
- 绿：component-design（host-seams 18/0 + handoff 24/0）；component-closure 45/0。
- 反向变异：
  - r2m1（readiness 不做活动过滤）：handoff 22/2，两个正例红；
  - r2m2（ready set 不做活动过滤）：closure 44/1（新例红），handoff 22/2（正例断言 ready set 不含 A）。
  - 恢复后复跑全绿。
- 放弃的准确性：
  - readiness 的 `perUnit` / `changeUnitIds` 不再列出退役 CU，只能从 `blueprintRefs.skipped` 看到它及原因；
  - `allCompleted` 是否忽略 A，只通过「A 不在 ready set 的 projections 里」间接证明。夹具里其它 CU 没有 VALID completion，无法直接构造 `allCompleted=true`。

**非阻断 1 宿主话术——已改**
- 改动：`templates/AGENTS.md.template:74` 与 `docs/operations/project-entry.md:38` 同句原位替换为「测试用例一律由后继的 UT 阶段以新增测试文件或新增用例产出（同字节重写不算覆盖）」，不增行。
- plan 正文里的同一句（:1197）未动：不改 plan。
- 结果：`--filter docs` 通过（docs-authoring-lint 18/0）。

**非阻断 2 L4 断言锁定——已做**
- 改动：`lifecycle-evolution.unit.test.ts` L4 读取 testing `script-report.json` 的 FAIL 检查：
  - 断言其中有 `acceptance_to_test_case`，且 details 含 `AC-9`；
  - 日志同时打印 FAIL 检查 id。
- 实测输出：`failed=["acceptance_to_test_case","testing_run_status"]`，verdict=FAIL，complete=false。
- 结果：lifecycle-evolution（显式）11/0。
- 这条锁没有做反向变异。

**改动文件（本轮）**
- 生产：
  - `harness/scripts/utils/component-closure-inputs.ts`
  - `harness/scripts/utils/change-unit-design-preparation.ts`
  - `harness/scripts/utils/change-unit-ready-set.ts`
- 测试：
  - `harness/tests/unit/component-design-handoff.unit.test.ts`（+3 例）
  - `harness/tests/unit/component-closure.unit.test.ts`（+1 例）
  - `harness/tests/unit/lifecycle-evolution.unit.test.ts`（L4 加锁）
- 文档：`templates/AGENTS.md.template`、`docs/operations/project-entry.md`

**验证**（日志逐个 grep 结论）
- `cd harness && npm run typecheck` EXIT=0。
- 过滤套件：
  - component-design 42/0；component-closure 45/0；change-unit-progression 97/0；successor-exit 7/0；
  - lifecycle-evolution（显式）11/0；real-chain（显式）12/0；docs 18/0。
- 仓根 `node scripts/check-plan-version.mjs` PASS。
- 8 个改动文件 node 扫描 CR=0。
- 未跑全量（另一进程在跑）。

### t5 发布门文档与 OpenSpec 归档（2026-09-26，未提交）

**结论**：批二完成，t5 置 `completed`。发布门接线沿用既有 `release-all.mjs` / `candidate-release.mjs` 的 `run-unit.ts --release`（`lifecycle-evolution` 已登记 `releaseOnly: true`），本批只补文档与归档，未改生产代码、未动快照 `project/`、未重生成快照。

**改动**
- `docs/operations/release-checklist.md`：「自动（BLOCKER）」第 1 步下补 release-only 执行口径（日常 `npm test` 只校验存在；`release:all` / `candidate:build` 以 `--release` 执行 real-chain、real-chain-seams、lifecycle-evolution）、单跑命令、兼容基线规则（L0 转红只有「修回归」或「MIGRATION 登记迁移步骤 → 快照上按步骤迁移后 L0 为 true → 按 README 重生成并更新钉住提交」两种处置，不要求自动迁移器）。
- `harness/tests/fixtures/host-snapshot-3.1.0/README.md`：新增「重生成规则」节（何时、禁止无迁移路径重生成、目标提交上跑 generate.ts、更新钉住产出、`--verify` 与 `--filter lifecycle-evolution` 复核）。
- `MIGRATION.md`：3.1.0「按义务执行与旧运行恢复」列表末尾加一条消费者向说明（以上一版宿主产物为兼容基线；无条目即无需宿主动作）。
- OpenSpec `tasks.md` 补 `3d.1`（t5）后归档。

**归档**
- `npm run openspec -- status --change post-completion-evolution-unification --json`：四个 artifact 全 `done`，`isComplete: true`；tasks.md 无 `- [ ]`。
- delta 比对（scratchpad node 脚本按 `### Requirement:` 分块逐字比对）：三份 delta 共 8 条 Requirement 与主规格**逐字相同**（change-unit-continuous-progression 5、component-assembly-coverage-closure 1、correction-routing 2），主规格无缺失内容 → 用 `--skip-specs`，避免重复追加。
- `npm run openspec -- archive post-completion-evolution-unification --skip-specs -y`：EXIT=0，`archived as '2026-09-26-post-completion-evolution-unification'`；目录移至 `openspec/changes/archive/2026-09-26-post-completion-evolution-unification/`。

**验证**（日志写 scratchpad `t5-*.log` 后 grep 结论）
- `npm run openspec:validate`：48 passed / 0 failed，enforcement PASS。
- `node scripts/check-plan-version.mjs`（默认模式）：EXIT=0。
- `npm run release:check-plans`（`--release`）：EXIT=1，但 FAIL 清单**不含本 plan**；列出的是 8 份其它 3.1.0 plan 仍有未完成 todo（7e1d4b93、e7a2c4f1、a3d9b5f7、91c4e7a2、c8b4e731、d4a1f7c3、1f3d7a92、6f2a9c41），不属本批范围。
- `cd harness && npm run test:unit -- --filter docs`：docs-authoring-lint 18/0。
- `cd harness && npm run test:unit -- --filter lifecycle-evolution`（显式）：11/0，未受文档改动影响。
- 未跑全量：本批只改文档与 OpenSpec 归档，无生产 / 测试代码改动。

**偏离**
- todo 正文写「`release:verify` 接入」；实际接入点是 `release:all` / `candidate:build` 的 `run-unit.ts --release`（批一已登记），`release:verify` 只校验发布包结构，未另加一道。放弃的准确性：单独运行 `npm run release:verify` 不执行 L0 基线；正式发版走 `release:all` 时执行。

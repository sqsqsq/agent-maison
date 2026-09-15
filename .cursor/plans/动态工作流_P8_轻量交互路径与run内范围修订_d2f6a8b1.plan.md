---
name: 动态工作流 P8 — 轻量交互路径与 run 内范围修订
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g1-meta-model-and-boundary
  - g6-change-unit-feature-pipeline-integration
relation: core
layer: change-unit
goal_requires:
  - frozen-obligation-execution-scope
  - dynamic-workflow-layered-closure
goal_provides:
  - in-run-scope-revision
  - feature-level-frozen-scope
real_host_validation: >
  批次 1 后在 codex 宿主跑 RDB attended 场景，验证零设备裁剪与 run 内修订的实现；
  此时候选仍手工准备，不得表述为用户入口已验收。批次 2 后重跑同场景验收候选生成入口；
  批次 3 后跑 RDB 无 run 交互场景（cursor 这类纯 external_runner adapter 亦须可完整交付）。
  三轮均由用户触发；fixture 绿不等于宿主通过。
parallel_authority_added: false
overview: >
  收编用户 2026-09-14 的两项架构改判与三项 P1 缺口：冻结范围的合法修订在同一 run 内追加事件完成
  （删除正常后继交接），交互模式的完整交付不再强制创建 Goal run（feature 级冻结记录作第二载体），
  resolver 不采信候选对证据类义务的自报结论，新增候选生成 CLI，真实 checker 归属产出修订输入。
  范围计算仍只有 resolveExecutionScope 一个纯函数入口；不新增确认点、feature flag、registry、
  租约或签名体系；不重造 NEXT_STEP renderer。
todos:
  - id: p8-b1-resolver-guard
    content: >
      批次 1 第一步（D0.1，纯函数 + 读取层 + 测试，单独一笔）：resolver 对 unit-evidence /
      device-evidence / visual-evidence 的候选 applicability 一律不采信，按验收分层与 fidelity SSOT 重算；
      feature 终点的 device 裁剪追加有来源的 request.impact 判断；satisfied_by 在冻结时重解析核验。
      resolver 保持纯函数，解析事实由既有读取层经 ResolvedScopeFacts 传入（§4.1.0）。见 §4.1。
    status: completed
  - id: p8-b1-in-run-revision
    content: >
      批次 1 第二步（D2，runtime 删改 + 测试重写，一至两笔）：追加 scope_revised 事件与
      loadEffectiveExecutionScope 唯一有效范围入口，替换全部运行时消费点；删除 §4.2.2 的后继机制清单；
      基线随首条含 coding/ut 的修订在事件层冻结一次；整条改写 obligation-execution-scope 的
      successor Requirement。见 §4.2。
    status: completed
  - id: p8-b2-design-gap-trigger
    content: >
      批次 2 第一步（D0.3，一笔）：coding / review / correction 中经既有 repair_owner 归属判定为
      spec / plan 的真实责任缺口产出 scope_revision_input，由 D2 在同一 run 内回补；
      写集越界类留在 coding。补真实 check 入口验收，保留既有注入单测。见 §5.1。
    status: pending
  - id: p8-b2-scope-candidate-cli
    content: >
      批次 2 第二步（D0.2，一笔）：goal-mode-entry 新增 --prepare-scope 生成 feature.yaml 的
      execution_scope 候选并投影 resolver 结果与模板化说明；主 Agent 职责缩为四项；
      同步 AGENTS 模板与三份 Skill / 文档，删除暗示手写指纹与手写 basis 的表述。见 §5.2。
    status: pending
  - id: p8-b3-feature-scope-carrier
    content: >
      批次 3（D1，一至两笔）：新增 feature 级冻结记录与无 run 完成原件，统一有效范围入口按
      D1.3 优先级选来源，接线七个消费者，完成判定按 scope_source 选出生范围来源；
      转入 run 时以 feature 有效范围出生并登记 transferred_to。见 §6。
    status: pending
---

# P8：轻量交互路径与 run 内范围修订

> 上位：[总纲](动态工作流_总纲_全阶段Skill独立组合与义务驱动编排_91c4e7a2.plan.md)；
> 需求输入与用户裁决：[需求_动态工作流架构裁决_轻量交互路径与run内范围修订](../requirement/需求_动态工作流架构裁决_轻量交互路径与run内范围修订.md)（第二版，2026-09-14）。
> 本 plan 是对总纲 §7 与 [P2](动态工作流_P2_执行范围与运行时统一编排_b7e4c9a2.plan.md) §5.1、§6.1–§6.3 的改判承接，
> 优先级高于总纲与 P2/[P7](动态工作流_P7_分层完成判定与兼容迁移及宿主验收_a3d9b5f7.plan.md) 正文。
> P2/P7 与总纲不承载本批待办，只加冲突说明并指向本 plan（§4.2.5）。
> 本 plan 引用的行号取自 main `db2edab8` 当前文件，与需求文档 §8 的行号各自独立核对。

## 1. 目标与批次

| 批次 | 条目 | 一句话 | 提交笔数 |
|---|---|---|---|
| 1 | D0.1 → D2 | 义务判定防洗绿；冻结范围的合法修订在同一 run 内以追加事件完成，删除正常后继 | 1 + (1~2) |
| 2 | D0.3 → D0.2 | 已归属 spec/plan 的真实责任缺口产出修订输入；新增候选范围生成 CLI | 1 + 1 |
| 3 | D1 | 交互模式完整交付不强制 Goal run，feature 级冻结记录作第二载体 | 1~2 |

批次内顺序固定 D0.1 → D2 → D0.3 → D0.2 → D1。D0.1 只改纯函数与其读取层（§4.1.0），是 D2 与 D0.2 的共同地基；
D0.3 建在 D2 的 run 内修订之上；D0.2 产出 D1 首次冻结所需的候选；D1 最后接 feature 级载体。
D1/D2 是已定裁决，不因批次实跑结果重新批准。

中间提交不得暴露「一半消费者读 run、一半读 feature」或「生成器已有、模板仍教手写」的半成品。

## 2. 用户裁决 2026-09-14

需求文档 D0/D1/D2 的裁决要点与本 plan 的承接位置逐条对应。

| 裁决编号 | 裁决要点 | 本 plan 承接位置 |
|---|---|---|
| D0.1 | 候选事实中 `unit-evidence` / `device-evidence` / `visual-evidence` 的 applicability **一律不采信**，按来源重算后覆盖；候选写什么都不构成拒绝理由；不新增「机器生成 / AI 手写」标记 | §4.1.1 |
| D0.1 | unit / device 来源 = 现有验收分层派生（`<kind>:acceptance`）；验收缺失或分层非法 → unknown | §4.1.1 表 |
| D0.1 | visual 来源 = 既有 fidelity 定档 SSOT + 明确请求；pixel_1to1 → required（缺视觉验收是 unresolved 待补缺口，不是取消理由）；明确非 pixel 或 SSOT 缺失且无视觉要求 → not_applicable；SSOT 损坏 / 有视觉要求但未定档 → unknown。**不从 acceptance 分层推 visual** | §4.1.2、§3 问题 10 |
| D0.1 | `completion_target=feature` 时 device 裁剪还须一条 AI 提交、**有来源**的影响判断；`false`+验收无设备层+visual 非 required → not_applicable；`true` → required；缺失 → unknown，testing 不裁 | §4.1.3 |
| D0.1 | impact 的机器核验边界写实：只核 basis 路径存在、在项目内、指纹可读，且与本次实际范围相关；reason 由既有 review / 阶段检查对照 diff 核，不在 resolver 里装语义判断 | §4.1.3 |
| D0.1 | `satisfied_by` 在**冻结时**重新解析核验（现在只在 verify 时核，太晚） | §4.1.4 |
| D0.1 | `hasNoTestingObligation` 与 reconcile-only 沿用上述结果，不另加判断 | §4.1.5 |
| D0.2 | 新增候选范围生成 CLI；机器负责绑定解析、分层派生、fidelity 派生、code-review 自动补与全部指纹计算 | §5.2.1 |
| D0.2 | **implementation 是否执行由明确请求动作与现有有效证据决定，不由 `completion_target` 决定**；复用既有 `requested_phases`，不新增分类系统 | §5.2.2、§3 问题 7 |
| D0.2 | 输出 = feature.yaml 的 `execution_scope` 候选 + stdout 的 resolver 结果投影 + 一句模板化说明（不调 LLM）；幂等，不静默覆盖 | §5.2.3 |
| D0.2 | 主 Agent 职责缩为四项；四份文档写清并删除暗示手写 basis / 手写指纹的表述 | §5.2.4 |
| D0.2 | 用户可见说明**复用既有 assess → NEXT_STEP 渲染**，保证不出现范围外义务；不重造 renderer | §5.2.5 |
| D0.3 | 触发条件收窄为「已归属 spec / plan 的真实责任缺口」；写集越界大多是 coding 改错文件，留在 coding 修复 | §5.1.1、§3 问题 8 |
| D0.3 | 归属依据 = 既有 `repair-candidates.ts` 的 repair_owner / 责任阶段路由（plan b6e4c9f2），check-coding / check-review 不各自新造判定 | §5.1.2 |
| D0.3 | correction 流程读取有效范围；路由到范围外阶段时产出同一 `scope_revision_input`，不再直接落 `backtrack_target_absent` | §5.1.3 |
| D0.3 | 不改 assess 的 `revise_scope` 判定；不新增第二条回退动作；不放宽 R8 | §5.1.4 |
| D1.1 | 新增机器写入、单 writer 的 feature 级冻结记录，内容为 `ExecutionScope` + 候选输入指纹 + policy 指纹 + 冻结时间 + `scope_source:"feature"` + 修订数组；路径经 `featureFilePath` / `resolveFeatureArtifact` 解析；**不写进 feature.yaml**；总纲 §7「不新增 execution-scope.json」按本裁决删除 | §6.1、§3 问题 1 |
| D1.2 | 交互模式对该 feature **第一次**执行任一 feature phase 时冻结；之后只读并核对候选指纹，不静默重算、不静默沿用；候选缺失沿用现状 BLOCKER，不回落 track | §6.2、§3 问题 2 |
| D1.3 | 权威优先级四行表；「存在 run」收窄为**本次关联的 run**；同 feature 后起 Goal run 时出生范围 = 转交时 feature 的**有效**范围（出生段 + 已应用 revisions），不从候选重算；转入后 feature 记录是来源历史，**不参与持续等值比较** | §6.3、§3 问题 12 |
| D1.4 | 七个读点全部改为统一入口取「当前有效范围」；`FactsInvocationContext.subject` 允许无 run_id 的 Feature 身份 | §6.4 |
| D1.5 | 无 run 时完成原件落 feature 级，`run_id: null`、`scope_source:"feature"`；验证器按 `scope_source` 选出生范围来源；其余判据不放松；不为此另造签名体系 | §6.5 |
| D1.6 | 无 run 的「继续」= 读 feature 冻结记录 + 各阶段既有闭环状态，不问 track、不重算范围 | §6.6 |
| D2.1 | 同一 run 的 `events.jsonl` 追加 `scope_revised`，走既有 `goalEvents.emit`；**事实更正：events.jsonl 没有逐条哈希链**，只有 `run_created` 有 `event_hash`，修订事件的校验范围按需求写实，不新建签名或外部状态系统；不新增文件、registry、租约或 manifest 字段 | §4.2.1 |
| D2.2 | 有效范围 = 出生范围 + 按 `revision_index` 顺序应用的修订；提供**唯一**函数 `loadEffectiveExecutionScope` 替换全部运行时消费点；`loadFrozenExecutionScope` 只保留「读出生范围」；manifest 三字段保持出生值；凡读 `end_phase` / `phase_chain` 判断「是否到末段」的位置改读有效范围 | §4.2.3、§4.2.4 |
| D2.3 | 可改字段沿用 `SCOPE_REVISION_FIELDS`；义务允许 unknown→required / **not_applicable→required** / 新增 / 补 `satisfied_by` / **撤销已失效的 satisfied_by**；**不得删除或降级 required**；**执行历史与当前责任计划是两个序列，不共用 phase_chain**；阶段证据支持 run 与 feature 两种载体；是否修订由新事实决定，不由 PASS/FAIL 决定 | §4.2.3、§3 问题 11 |
| D2.4 | 触发面不变；runtime 校验并追加后**继续在同一 run 派发**，不封卷、不释放锁；`run_base_sha` 随首条含 coding/ut 的修订在事件层冻结一次，write-once 语义在事件层保持；不为这种情形保留 successor 路径 | §4.2.2、§3 问题 9 |
| D2.5 | successor 保留失败修复型 supersede、用户显式改需求、creation-incomplete 修复；删除清单六项；3.1.0 未发布，**不写兼容 reader，直接删** | §4.2.2 |
| D2.6 | `verifyFeatureCompletion` 用有效范围算 expectedChain；completion 记 `scope_revision_count`；写入后失配 → INVALID；其他改动按 D2.1 已声明的校验边界处理 | §4.2.6、§3 问题 5 |
| D2.7 | feature 冻结记录同样支持追加修订（`revisions[]`，元素形状与事件一致，同一函数算有效范围）；触发面相同，由 harness-runner 在阶段收尾应用 | §6.7 |
| 共同 | 范围计算仍只有 `resolveExecutionScope` 一个纯函数入口；不新增用户确认；不引入长期双栈开关 | §7、§8 |
| 交办 §0.3 | 只写一份 P8 plan，内部分三个可独立 review 的批次；P2/P7 与总纲只加冲突说明 | 本文件、§4.2.5 |
| 交办 §0.4 | 实施顺序固定，批次 1 后的早期宿主实跑用于发现问题、不是 D1 的开工门槛 | §1、frontmatter `real_host_validation` |
| 交办 §0.5 | 每批一个 OpenSpec change delta；D2 必须整条改写 successor Requirement，不得两套口径并存 | §4.2.5、§5.3、§6.8 |
| 交办 §0.8 | 验证强度按实际改动风险；纯文档 / plan 状态 / OpenSpec 文案改动只跑 `openspec:validate` 与 `check-plan-version` | §9 |

### 2.1 放弃的准确性索引（与裁决无语义偏离）

本 plan 与裁决**没有语义上的偏离**；下表是各处「放弃的准确性」的索引，正文写在各自章节，读者按 plan 施工时不必回查本表。

| # | 放弃的准确性 | 正文 |
|---|---|---|
| 1 | 主 Agent 每次必须显式写 `--requested-phases`（不引入任何动作分类器） | §3 问题 7 |
| 2 | D0.3 的生产触发面只覆盖 UI 文件面的设计缺口；非 UI 面无 coding 侧机器归属，继续靠 review 路径域归属与手工指引 | §3 问题 8 |
| 3 | 无身份调用的 active run 识别未能核实；实验不成立时收窄为只认显式 run 身份，并在冻结前主动做读取检查 | §3 问题 12 |
| 4 | 删 `goal-phase-runtime.ts:4511` 的 detached 守卫后，失去「detached attach-created 的 successor 血缘」一维校验 | §7.2 |
| 5 | 无 run 完成原件缺 `attempt` 与 run 终局两维证据（轻量路径上确实不存在对应事实，不伪造 run_id 去凑） | §6.5 H2 |
| 6 | 第三通道（自定义 `featuresDirAbs`）的无 run 完成判定若无法四段一致，显式记为不支持并写进文档 | §3 问题 1 |

> 已关闭的两项：第一版曾把「不删 P2 §6.1–§6.3 正文」与「删 detached 守卫」列为偏离裁决——需求文档第二版 D2.5 已明写两者，它们**就是裁决本身**（守卫的准确性代价改挂上表 #4）。
> `scope_revision_count` 的 schema 版本一项在第二轮删除：1.2 未外流已由代码证据确证（§3 问题 5），「不递增」是事实结论而非取舍。

## 3. §9 问题回答

### 问题 1 — feature 冻结记录与无 run 完成原件的文件名、落点，与 `paths.features_dir` 三通道解析的关系

| 载体 | 文件名 | 解析函数 | 绝对路径 |
|---|---|---|---|
| feature 级冻结记录 | `execution-scope.json` | `featureFilePath(projectRoot, feature, 'execution-scope.json')`（`harness/config.ts:1759`） | `<features_dir>/<feature>/execution-scope.json`，与 `feature.yaml` 并列 |
| 无 run 完成原件 | `feature-completion.json` | `featureFilePath(projectRoot, feature, path.join('completion', 'feature-completion.json'))` | `<features_dir>/<feature>/completion/feature-completion.json` |
| 无 run 完成投影 | `feature-completion.json` | 沿现状 `featureFilePath(projectRoot, feature, 'feature-completion.json')`（`change-unit-completion.ts:72`、`verify-feature-completion.ts:620-621`） | `<features_dir>/<feature>/feature-completion.json`，`original_path` 指向上一行 |

三通道解析关系：`featureFilePath(projectRoot, feature, fileName, opts?)` 内部经 `featureDirResolved`（`config.ts:1735-1742`）解析，已覆盖三条通道——默认 `doc/features`（`config.ts:622` `DEFAULT_PATHS.features_dir`）、`framework.config.json` 的 `paths.features_dir`（`config.ts:296`、`:1902`）、调用方第四参数 `opts` 的 **`FeaturePathOptions.featuresDirAbs`**（绝对路径，`config.ts:1816-1818`；`featureDirResolved:1738` 对它 `path.resolve` 后拼 `featureRelativePath(feature)`）覆盖。因此 D1 全程只用 `featureFilePath`，禁止任何 `doc/features` 字面量。

**自定义绝对 features 目录的传递链（第三通道，必须逐段显式带 `featuresDirAbs`）**：
① 冻结 —— `ensureFeatureExecutionScopeFrozen` 从 harness-runner 已解析的 features 目录取绝对值并转成 `{ featuresDirAbs }` 传给每个 `featureFilePath`；
② 读取 —— `readFeatureFrozenScope` / `loadEffectiveExecutionScope` 的可选参数同形，缺省时才回落 `featuresDirPath(projectRoot)`；
③ 转交 —— `goal-mode-entry --prepare-run` 与 `goal-phase-runtime` 出生路径已各自持有 `featuresDir`（见 §3 问题 12 的两个入口），写 `transferred_to` 时按同一 `featuresDirAbs` 解析，禁止重新从 config 推；
④ 完成验证 —— `verify-feature-completion` 现有 `featureFilePath` 调用点（`:913`、`:920`、`:973`）均未传 opts，D1 的 feature 载体分支必须与它们同源：要么整条链都不传（默认/config 两通道），要么同批把 opts 透传下去。**批次 3 实施第一步先跑一次「自定义 `featuresDirAbs` 下无 run 完成」夹具，确认四段一致**；若发现 verify 侧无法接收 opts，本 plan 的取舍是把第三通道的无 run 完成判定显式记为不支持并在文档写明，而不是让四段各自推路径。

**不用 `resolveFeatureArtifact`（`config.ts:1948`）**：该函数的职责是 canonical / legacy 双候选读回退，服务的是 `PHASE_SCOPED_ARTIFACTS`（`config.ts:1772-1780`）里有历史扁平形态的阶段产物。`execution-scope.json` 与 `completion/feature-completion.json` 是全新文件、从无 legacy 形态，走双候选只会引入一个永远不存在的回退路径。需求 D1.1 的「经 `featureFilePath` / `resolveFeatureArtifact` 解析」在本 plan 落为「经 `featureFilePath` 解析」，二者同源（`resolveFeatureArtifact` 的候选也由同一 `featureDirResolved` 产生），禁止硬编码这一条约束不变。

投影 / 原件分离的落点约束：现在 `verify-feature-completion.ts:912-915` 硬性要求原件位于 `goal-runs/<completion.run_id>/` 内。D1.5 改为按 `scope_source` 二分——`'run'` 走原判据不动；`'feature'` 要求原件位于 `<features_dir>/<feature>/completion/` 内，同样用 `isInsideProjectRoot` 锁目录，不放松「原件落点必须由 runner 拥有」的语义。

### 问题 2 — D1 首次冻结在 harness-runner 的哪个位置，失败时报告形状

位置：`harness/harness-runner.ts:877` 的 `if (!phaseIsGlobal) { try {` 块内，**`resolveCapabilityResolutionEntryInput`（`:879`）调用之前**，作为该 try 块的第一步。理由：capability 解析已经要消费有效范围（`capability-resolution-entry-input.ts:229` 起），冻结必须先于它完成；而该 try 已有统一的失败出口，不必新增控制流。

调用形状：`ensureFeatureExecutionScopeFrozen({ projectRoot, frameworkRoot: resolvedFrameworkRoot, feature, featuresDirAbs, runId: process.env.MAISON_GOAL_RUN_ID?.trim() })`。`featuresDirAbs` 即 `FeaturePathOptions.featuresDirAbs`（绝对路径；缺省 undefined 走前两条通道，见问题 1 的传递链）。`runId` 有值 → 直接返回（run 权威，不写 feature 记录）；无值 → 按 D1.2 首次冻结或读已有记录并核对候选指纹。

失败报告形状：复用 `capabilityInputChecks` 数组（`harness-runner.ts:873`），推入一条 `CheckResult`：

~~~ts
{ id: 'execution_scope_frozen', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
  description: 'feature 级冻结范围可用且与候选一致',
  details: '<原因> | candidate_fingerprint=<..16> frozen_candidate_fingerprint=<..16> source=<execution-scope.json 相对路径>',
  affected_files: ['<features_dir>/<feature>/feature.yaml', '<features_dir>/<feature>/execution-scope.json'],
  suggestion: '候选已变更而冻结范围未经修订：走既有 stale/correction 路径（harness-runner --correction-init）；不要手改冻结记录。' }
~~~

三种失败原因各自一句 details 前缀：`候选缺失`（沿现状 BLOCKER「缺少运行前范围输入」，`feature-track.ts:82` 的 throw，不回落 track）、`候选指纹与冻结记录不一致`、`冻结记录损坏`（`validateExecutionScope` 抛错原文）。不新增退出码路径——BLOCKER FAIL 走 harness-runner 既有汇总。

### 问题 3 — D2 应用修订的位置，与 `phaseDone` / 锁 touch 的先后

位置：`harness/scripts/goal-phase-runtime.ts:9341` 现有的 `if (assessment.recommendation.action === 'revise_scope' && pendingScopeRevision)` 分支。触发输入不变——`:9062-9063` 从本阶段 `script-report.json` 的 `checks[].scope_revision_input` 收集。

**修订边界的正确定义（第一轮 review 阻断 7 的更正）**：边界 = **本阶段结果已落盘、归属事实可用之后**，不是「closure 已成功之后」。
理由（代码事实）：`phase-closure-finalizer.ts:545` 明写 `if (current.parsed.verdict !== 'PASS' || current.parsed.blocker_count !== 0) throw` —— **FAIL summary 根本提交不了 closure**；而需求 D2.3 末行与 D2.8 第二行明确要求「coding 失败 + 同时暴露归属 spec/plan 的新事实」必须能修订。把修订挂在 closure 成功之后，这条验收永远走不到。
成功 closure 只决定**哪些证据可复用**（§3 问题 11 的复用判据），不作为任何修订的前置条件。
另一处事实更正：`phaseDone = true` 实际在 `goal-phase-runtime.ts:9348`，即修订分支（`:9341-9347`）**之后**；第一版写「`phaseDone` 已置位」是错的。

boundary 内的固定顺序。**事件顺序按代码更正（第二轮 review M1）**：`goal-phase-runtime.ts:9101` 的 `runAssess()` 在前，`:9162-9172` 的 `decideAndEmit({ ..., verdictEvent: { phase, verdict, ... } })` 才提交阶段结果事件。第一版把失败路径写成「`phase_verdict`/`phase_halt` 事件已写 → assess」，顺序倒了。统一顺序是：

> **结果落盘 / 归属输入准备 → assess → 阶段结果事件 → 修订追加 → `phaseDone`**

*成功路径（本阶段 verdict=PASS）*
1. 本阶段 `script-report.json`（`:1196`）与 summary 落盘；closure 由既有 `phase-closure-finalizer` 提交成功；修订输入已在 script-report 上（§5.1.2 ①②）；
2. `runAssess()`（`:9101`）给出 `revise_scope`（`assess.ts:893-897`）；
3. 阶段结果事件由 `decideAndEmit`（`:9162-9172`）提交；
4. **本步**：`applyScopeRevision`（`:9341` 分支，见下）——此时本阶段已具备「已 closed 且 PASS」的全部事实，可参与复用判据；
5. `phaseDone = true`（`:9348` 原位不动）→ 按 §4.2.3 的游标取法派发下一阶段，写 `phase_start`（`:6279` / `:7260`）。

*失败路径（本阶段 verdict=FAIL / 有 BLOCKER，closure 未提交）*
1. 本阶段 `script-report.json` 与 summary 已落盘（`:9061-9063` 的修订输入就取自 script-report）；closure **提交不了**（`phase-closure-finalizer.ts:545`）；
2. `runAssess()` 给出 `revise_scope`；
3. 阶段结果事件（FAIL 的 `phase_verdict`，或 halt 时的 `phase_halt`）由同一 `decideAndEmit` 提交——**失败事实照常记录**（D2.3 原话）；
4. **本步**：`applyScopeRevision`，与成功路径**同一函数**；差别只在函数内部——本阶段不满足复用判据，因此它与责任阶段一并留在新 `phase_chain` 里（D2.8「执行历史保留 coding 的失败记录；plan 完成后 coding 重跑」）；
5. `phaseDone = true` → 派发新链首个未完成阶段（通常是责任阶段 plan/spec）。

`applyScopeRevision` 本体（两条路径共用）：读 events 求当前有效范围与 `revision_index` 最大值 → 用 `resolveExecutionScope` 生成新范围 → `validateExecutionScope` + D2.3 约束（不得删除 / 降级 required；复用判据见 §3 问题 11）→ 必要时冻结 `run_base_sha`（§3 问题 9）→ `goalEvents.emit({ type: 'scope_revised', ... })`。

**无 run 路径（D2.7）的同一边界**：harness-runner 在写完本阶段 script-report / summary 之后、进程退出之前应用 `revisions[]` 追加——同样**不**以 closure 成功为条件（无 run 路径的 coding FAIL 同样要能修订）。第一版把它写成「harness-runner 写完本阶段 closure、退出前」，按本节更正为「写完本阶段结果、退出前」（§6.7 同步）。

与锁的关系：**owner 锁与 Feature 锁全程持有不释放**——第 3 步位于既有 `acquireGoalLocks` 的 finally 之内，`releaseAllLocks` / `releaseRunOwner` 不被调用（这正是与旧后继路径 `:4263-4270` 的根本差别）。锁心跳 touch 沿既有节奏，不为修订插入额外 touch；追加事件本身是一次 append，不跨心跳周期。

幂等（对应 D2.8「修订事件写入后立即中断再重入」与「中断于修订校验前」）：第 3 步开头先扫 events 求 `scope_revised` 集合；若已存在一条 `revision_input` 指纹与本次相同的修订，直接跳到第 4 步，不重复追加。这替换现在 `:9342` 的 `prior` 单条去重（旧逻辑只允许一条交接意图，新逻辑允许多条但按输入指纹去重）。中断于校验前 → 重入后回到 phase 边界重新执行第 2–3 步，结果仍只有一条。

### 问题 4 — 既有 attended 夹具中依赖 successor 的断言如何改写成 run 内断言

改写对象：`harness/tests/unit/execution-scope.unit.test.ts:232-248` 的 `else` 分支（非 direct 模式）。
**行号更正（第一轮 review 必修 6）**：第一版写 `:265-283`，那段实际是 `direct` 模式的复用 / 篡改反例块，与 successor 无关；successor 断言在 `:232-248`，`onScopeHandoff` 注入块在 `:193-200`，模式枚举 for 循环在 `:297`（不是 `:298`）。下表行号按 main `db2edab8` 重取。逐条对应，**没有一条断言被删掉**：

| 原断言（行） | 原意图 | run 内改写 |
|---|---|---|
| `intents.length === 1`（`:235`，`duplicate handoff intent`） | 交接意图不重复 | `revisions.length === 1 && revisions[0].revision_index === 1`（`scope_revised` 事件），message 改 `duplicate scope revision` |
| `agent_invoke_start` 计数 === 1（`:236`，`source phase repeated`） | 源阶段不重跑 | **按模式分开**：`revision` 模式（源阶段 spec，修订后不再回 spec）仍断言 `spec === 1`；`design-gap` 模式源阶段是 coding，修订为 `[plan, coding, review, ut]` 后 coding **必然被派发两次**，断言改为 `coding === 2` 且第二次的 `invoke_id` 序号严格大于第一次，message 改 `revised chain did not re-dispatch the responsible phase`。第一版「原样保留、恰一次」与 D2.8「plan 完成后 coding 重跑」自相矛盾 |
| `successor.phase_chain` deepEqual（`:238`） | 新链正确 | `loadEffectiveExecutionScope(root, feature, 'p2-attended').scope.phase_chain` deepEqual 同一期望值 |
| `successor.end_phase`（`:239`） | 新末段正确 | ① 有效范围末段 === 同值；② **新增反向断言**「出生 `end_phase` 不被改写」。**第二轮 review M1 更正**：不能写死 `=== 'spec'` —— `:141` 的 `request(...)` 对 `design-gap` 取 `['coding','review','ut']`（`:156` 的 prepare CLI 据此出生），其出生 `end_phase` 是 `ut` 不是 `spec`。改为**在修订发生前先读一次 manifest 存为 `birthEndPhase`，修订后断言 `manifest.end_phase === birthEndPhase`**（与模式无关，且比字面值更强） |
| `successor.successor_of === 'p2-attended'`（`:239`） | 血缘登记 | `fs.readdirSync(featureFilePath(root, feature, 'goal-runs')).length === 1` 且 manifest 无 `successor_of` 字段，message 改 `in-run revision created a second run` |
| `invoke_id.endsWith('-i2')`（`:241`，`successor reset consumed turns`） | 预算 / 轮次不清零 | 同 run events 中修订**之后**首个 `agent_invoke_start` 的 `invoke_id` 仍以 `-i2` 结尾，message 保留原意 |
| `run_created` 计数 === 1（`:242`，`duplicate successor birth`） | 出生唯一 | 同 run events 中 `run_created` 仍恰一条，message 改 `duplicate run birth` |
| `execution_scope.unresolved.length`（`:244`，`source scope rewritten`） | 出生范围不被改写 | `manifest.execution_scope` 的 `executionScopeFingerprint` === `run_created.manifest_identity_fields.execution_scope` 对应摘要（比「unresolved 条数」更强，直接锁字节语义） |
| design-gap 的 `run_end.status === 'PARTIAL'`（`:245`，`failure source was washed into success`） | 失败不被涂成成功 | ① coding 的失败记录（`phase_verdict` FAIL / `phase_backtrack_requested`）在 events 中保留；② 修订发生时 run **未**写 run_end；③ plan→coding 重跑后最终 `run_end.status === 'COMPLETED'` |
| `again.invokedPhases.length === 0`（`:246`） | 已完成不重复调用 | 原样保留（同 run resume 幂等） |
| `recoveryMarker` 未被提前删除 / 完成后已清理（`:194-198`、`:247`） | 交接期恢复状态生命周期 | `onScopeHandoff` 随机制删除；恢复状态断言改挂到既有 coding-base 路径在同 run 内的存活 / 清理，注入点见下方「注入点更正」 |

**注入点更正（第一轮 review 必修 1）**：第一版打算用 `afterHarnessPass` 作「修订后中断」注入点。代码事实否定它——`goal-runner-testing-integrity.unit.test.ts:730` 的 `opts.afterHarnessPass?.(...)` 在 fake harness **写完 PASS summary、`return { exitCode: 0 }` 之前**触发，早于 runtime 的 assess 与修订分支（`goal-phase-runtime.ts:9341`），覆盖不了「修订事件追加后立即中断」。
因此三个 run 内中断窗口的注入改为：

- `revision-precut`（修订**校验前**中断）：`onHarnessSummary`（`:531`，同样早于 runtime）——语义匹配，保留；
- `revision-cut`（修订**写入后**立即中断）：**新增一个 runtime 侧注入点**，在 `goal-phase-runtime.ts` 的 `applyScopeRevision` 于 `goalEvents.emit({ type: 'scope_revised' })` **之后**调用既有可选回调。做法是**原位替换**——`GoalPhaseRuntimeLaunchOptions` 上被删的 `onScopeHandoff` 字段改名为 `onScopeRevision?: (boundary: 'applied') => void`，测试辅助器 `goal-runner-testing-integrity.unit.test.ts:302` 的参数与 `:916`、`:934` 两处转发同步改名。**不是新增机制，是同一个测试注入口的重命名**；删除清单 §4.2.2 #6 相应改为「改名 + 收窄为一个 boundary」。

模式枚举改写（`:111` 的联合类型与 `:297` 的 for 循环）：`successor / intent / released / born` 四个模式合并为两个 run 内模式——

- `revision`：spec 产出 device AC → 同 run 修订 → 继续 coding→review→ut→testing（覆盖原 `successor`）；
- `revision-cut`：在 `scope_revised` 写入**后**立即抛错中断，重入验证不重复应用（覆盖原 `intent` / `released` / `born` 三个交接窗口在 run 内的唯一等价窗口）。

另补一个 `revision-precut`：在修订**校验前**抛错中断（对应 D2.8「中断于修订校验前」）。净效果：4 个 handoff 模式 → 3 个 run 内模式，断言总数不减。

`design-gap` 模式保留（它测的是 coding 报出归属 plan 的新事实），断言按上表改写。

### 问题 5 — `scope_revision_count` 是否需要 completion schema 版本号递增；旧 1.2 记录如何解释

**不递增。** `FEATURE_COMPLETION_SCHEMA_VERSION` 保持 `'1.2'`（`harness/scripts/utils/verify-feature-completion.ts:56`）。

理由：1.2 是 3.1.0 窗口内新增的 schema，3.1.0 尚未发布，没有任何宿主持有 1.2 记录——「旧 1.2 记录如何解释」这个问题在事实上不成立。直接在 1.2 内加两个必填字段 `scope_revision_count: number` 与 `scope_source: 'run' | 'feature'`，writer（`:592-608`）、reader / 校验（`:819-882`）同批改；缺字段的 1.2 记录判 INVALID（与现在缺 `execution_scope_fingerprint` 判 INVALID 同口径，`:823`）。

`LEGACY_COMPLETION_SCHEMA_VERSION = '1.1'`（`:57`）继续按现有 legacy 合同解释，不读这两个字段，`:876-882` 的 legacy 分支不动。

**外流问题已由代码证据关闭（第二轮 review M4）**：3.0.0 正式发布件（commit `453a4df6`）的 `verify-feature-completion.ts:51` 里 `FEATURE_COMPLETION_SCHEMA_VERSION` 是 `'1.1'`；`'1.2'` 只存在于 main。**1.2 从未外流**，因此：不递增、直接完善 1.2；legacy `'1.1'` 保持原合同（`:876-882` 分支不动）。第一版的「前置确认 / 若外流则退 1.3」全部删除，不留待办。

### 问题 6 — D0.1 的 impact 字段放 `request` 还是独立顶层；`ExecutionScopeInput` 是否升 schema 版本

放 `ExecutionScopeInput.request.impact`（`harness/scripts/utils/execution-scope.ts:39-43` 的 `request` 对象内），形状按需求建议：

~~~ts
request: {
  completion_target: 'request' | 'feature';
  requested_results: string[];
  requested_phases: string[];
  impact?: { user_visible_behavior_change: boolean; reason: string; basis: InputBinding[] };
}
~~~

理由：impact 是「本次请求的影响判断」，与 `completion_target` / `requested_results` / `requested_phases` 同属请求面；`facts` 数组是「来源事实」，放顶层会与 facts 语义混淆，也会让 `resolveExecutionScope` 多一个平行入参。

**不升 schema 版本**：`ExecutionScopeInput` 本身没有版本字段（`:38-48` 无 `schema_version`），候选文件的版本由 `ExecutionScope.schema_version`（输出侧，`:26`）表达，而输出**只增加一个可选字段**（`request_impact`，见 §4.1.0），schema 保持 `'1.0'`。`impact` 是可选字段，旧候选（无 impact）在 `completion_target=feature` 且验收无设备层时按 D0.1 落 unknown（reason「影响依据缺失」），testing 不裁——这正是期望行为，无需版本门。

### 问题 7 — D0.2 的 CLI 挂在 goal-mode-entry 还是 harness-runner；无 CU 的 feature 如何确定 `requested_phases` 默认值

**挂 `harness/scripts/goal-mode-entry.ts`**，新增 boolean 旗标 `--prepare-scope`（加进 `:343` 的 `boolean:` 数组，与 `--prepare-run` 并列）。

理由：候选是「出生前输入」，与 `--prepare-run`（`:99`、`:361`、`:380-401`）同一生命周期节点、同一 `--project-root` / `--framework-root` 解析（`:367-368`）、同一 `--feature` / `--requirement-file` 入参；用户入口只多一个旗标，不多一个命令。`harness-runner` 是阶段执行器，其 `--prepare-request`（`harness-runner.ts:348`、`:533`）服务 request 专项报告目录，语义与「生成 Feature 候选」不同，挂过去会让两个 prepare 语义撞名。

入参：`--project-root`、`--feature`、`--completion-target <request|feature>`、`--requested-results <文本，可重复>`、可选 `--requested-phases <逗号分隔>`、`--impact-behavior-change <true|false>`、`--impact-reason <文本>`、`--impact-basis <项目内相对路径，可重复>`、`--overwrite`（幂等冲突时的显式覆盖）。

无 CU 的 feature 的 `requested_phases` 默认值：**不设 workflow 全链兜底**。`resolveExecutionScope` 要求 `requested_phases` 非空（`execution-scope.ts:150` 的 `strings(request.requested_phases, ..., true)`），空数组是硬失败，所以必须有确定来源：

**事实更正（第一轮 review 阻断 2）**：第一版把「请求文本经 `derive.requirement` 解析出实现动作」当默认值来源。代码事实否定它——`derive.requirement` 的两个分支（`capability-resolution.ts:273-276` 的 inputContext 分支返回 `options.requirement.trim()` 原文，`:341-350` 的 feature 分支只返回 `goal_requirement:<fp>` 摘要）都只负责「需求文本是否可用」，**没有任何动作分类能力**，也不判断缺不缺 review / UT 证据。把动作分类器包装成既有 provider 能力即是凭空发明。本 plan 改为：动作不明确一律要求主 Agent 显式给出 `requested_phases`（这本就是 D0.2 划给主 Agent 的四项职责之一）；证据是否有效走**既有阶段证据检查**，不新造解析器。

| 情形 | 默认值 | 依据 |
|---|---|---|
| `--requested-phases` 显式给出 | 原样 | 用户明确请求动作（D0.2 主 Agent 四项职责之一） |
| `completion_target=request` 且未给 | **拒绝**，打印「request 终点必须显式给出 `--requested-phases`」 | request 终点本就是「用户点名跑哪个阶段」，猜测即越权 |
| `completion_target=feature` 且未给 | **拒绝**，打印「请求动作须由 `--requested-phases` 显式给出（改代码 → 含 `coding`；只补验证 → 只列验证阶段）」，并**附一份机器体检**：对每个 feature phase 打印既有阶段证据检查的三元结果（`loadPhaseEvidenceManifest(...)?.integrityOk`、`recomputePhaseEvidenceStaleness(...)[0].verdict`、阶段 `summary.json` 的 `verdict` / `closure_status`），供主 Agent 据此自己决定列哪些阶段 | 不猜动作；机器只呈现事实，判断权留给显式请求 |

被删的两行（「feature 且请求含改代码 → `['coding']`」「feature 且只缺验证 → 按解析缺口给 `['review']` / `['ut']`」）对应的能力**不实现**。
**放弃的准确性**：主 Agent 每次都必须写一次 `--requested-phases`，少不掉这一步输入；换来的是不引入任何动作分类器。若后续判定这一步摩擦不可接受，正确做法是单独提案一个真实的动作分类入口并走裁决，而不是借 `derive.requirement` 的名义偷渡。
需求 D0.2 的两条相关验收不受影响：「仅缺 review/UT 的请求 → 候选不含 implementation、链为 `[review, ut]`」由 `--requested-phases review,ut` 达成，「明确改代码的请求必含 implementation」由 `--requested-phases coding`（其余阶段仍由 resolver 义务闭包补：`code-review` 自动补见 `execution-scope.ts:167-172`，unit/device 由验收分层派生）达成——**仍然不由 `completion_target` 决定**，这正是 D0.2 的原话。

CLI 在 stdout 打印推导依据（哪条规则命中、读了哪些文件、上表体检的逐阶段结果），不静默。

### 问题 8 — check-coding / check-review 现有哪些 check id 已带 `repair_owner = spec / plan` 归属；写集越界类如何不误产修订

grep `CHECK_ID_OWNER_REGISTRY`（`harness/scripts/utils/repair-candidates.ts:379-383`）——**机器归属注册表总共只有三条**：

| check id | 归属 | 生产点 | 组装点（`collectPhaseRepairCandidates`） |
|---|---|---|---|
| `scope_consistency_with_spec` | spec | `harness/scripts/check-plan.ts:330`、`:342`、`:352`、`:367`、`:383`（统一由 `:1185` 的 `checkScopeConsistencyWithPrd` 产出） | `repair-candidates.ts:576-588`，`phase === 'plan'` |
| `device_ac_delegation` | spec | UT verifier 报告，经 `parseVerifierCheckStatus` 读出 | `repair-candidates.ts:590-598`，`phase === 'ut'` |
| `ui_scope_violation` | plan | `harness/scripts/check-coding.ts:490` 的 `ui_diff_within_declared_files`，`failure_kind === 'ui_scope_violation'`（由 `ui-scope-gate.ts:194-196` 产出） | `repair-candidates.ts:663-675`，`phase === 'coding'`（`:658` 属 testing 块，第一版写错） |

即：**check-coding 自身唯一带 plan 归属的入口是 `ui_diff_within_declared_files` 的 `ui_scope_violation` 分类**；**check-review 自身没有任何注册的机器归属 check id**，review 侧的 spec / plan 归属来自 `collectReviewRepairCandidates`（`repair-candidates.ts:568-575`）的路径域归属，category 在那里算出，可得 `'spec' | 'plan'`。testing 侧另有 `repair_owner` 直读通道（`:641-652`，来源 `check-testing.ts:3587-3609`）。

**接线点（第一轮 review 阻断 4 的更正）**：`collectPhaseRepairCandidates` **不是**生产链上的组装入口。代码事实：checker 只写 `failure_kind`（`check-coding.ts:498` 的 `failure_kind: r.failureKind`），把 `failure_kind` 转成 `classification` 并真正组装候选的是共享实现 `buildSummaryRepairCandidates`（`repair-candidates.ts:716-735`），它在生产里只有两个调用方——

| # | 调用点 | 时机 | 为什么两个都必须接 |
|---|---|---|---|
| ① | `harness/harness-runner.ts:2106` | summary writer，跑在 verifier **之前** | 机器 check 归属（`ui_scope_violation` 等）此刻已可得 |
| ② | `harness/scripts/utils/phase-closure-finalizer.ts:644`（`recomputeClosureRepairCandidates`） | 闭环冻结前重算 | review 候选要求 verifier 逐条 confirmed，首次 writer 跑时 verifier 尚无产物；`--sync-closure` 不重跑脚本 harness，**不在这里补就永远落不进 closed summary**（该函数注释原话） |

**载体必须是 `script-report.json`，不是 summary（第二轮 review B5）**。第一版写「随 closed summary 写入，runtime 读的正是 script-report」——两句自相矛盾，核实后逐条更正：

| 事实 | 位置 |
|---|---|
| `script-report.json` 在 Step 3 落盘，**早于** summary 组装 | `harness-runner.ts:1196` `generateScriptReport(...)` |
| summary 组装只把候选写进 `summary.repair_candidates` | `harness-runner.ts:2106-2120` |
| closure 重算**读** script-report、**写** summary | `phase-closure-finalizer.ts:603-608` 读 / `:672-685` 组装 / `:709-718` 写 summary |
| runtime 只从磁盘 `script-report.json` 的 `checks[].scope_revision_input` 取修订输入 | `goal-phase-runtime.ts:9061-9063` |

**组装点不能前移到 Step 3 之前（第三轮 review 阻断 3）**。第二轮打算把 `buildSummaryRepairCandidates` 前移到 `:1196` 之前。核实后否定，两条硬事实：

- 本轮 verifier 正文由 `harness-runner.ts:1984-1989` 的 `loadVerifierReportTextOrNull(..., { subjectId: anchoredSubjectId })` 取得，而 `anchoredSubjectId` 要到那一步才确定（该处注释原文：不传 subjectId 会读到**上一轮**的磁盘 summary 现值）。前移即丢掉本轮 subject，review 候选恒零或取错正文。
- 唯一的晚到补偿入口 `phase-closure-finalizer.ts:672` 的重算，被 `:545-548` 的 `if (verdict !== 'PASS' || blocker_count !== 0) throw` 挡在前面——**FAIL 到不了那里**。于是「首次无候选、随后 verifier 确认了一个导致 FAIL 的缺陷」这条最需要修订的路径，修订输入永远落不了盘。

因此接线改为：新增纯函数 `scopeRevisionInputFromRepairCandidates(candidates, effectiveScope, ctx)`，在**①②两处**各调用一次，产物写回 **`script-report.json` 的对应 `CheckResult.scope_revision_input`**（内存 `CheckResult` 加字段不够——runtime 读的是磁盘文件）：

- **①本轮 subject 确定之后的结果边界（PASS / FAIL 都到得了）**：组装点**留在原位**——`writeRunSummaryBase`（`harness-runner.ts:1808`）内 `:2106` 的既有 `buildSummaryRepairCandidates` 调用处，它在 `:1984-1989` 的 subject 锚定**之后**，且该函数在 `harness-runner.ts:1315` 被**无条件**调用（`finalReport` 的 verdict 是 PASS 还是 FAIL 都写），因此是一个 PASS/FAIL 均可达的结果边界。在该处同时做两件事：填 `summary.repair_candidates`（现状不变）**＋** 把 `scope_revision_input` 回写进磁盘 `script-report.json`。
- **②closure 重算（只承担成功闭环）**：`recomputeClosureRepairCandidates` 已在读 script-report（`:603-608`），把重算出的候选对应的 `scope_revision_input` **回写进 script-report.json**（与它今天写回 summary 的动作并列，在 `:709-718` 的 staged-rename 之前）。它只覆盖 PASS closure 这一支；FAIL 支由①兜住。

**回写 script-report 不会造成证据指纹失配**（codex 附注，已核实并采纳）：`phase-evidence-manifest.ts:459-462` 在发布时按 `PHASE_REPORTS_OUTPUT_FILES` 逐个 `addEntry(abs,'output')` 重算当前字节，`phase-closure-finalizer.ts:716-718` 的 `publishEvidenceBinding` → rename 在其后；按上述时序回写落在重算之前，manifest 纳入的是回写后的字节。

**只接 checker 层覆盖不了这条链**：checker 层没有 `classification`（只有 `failure_kind`），也拿不到 verifier 结果。
**晚到候选的两条路径**：FAIL 轮由①在同一轮的结果边界落盘（这正是第二轮方案漏掉的）；PASS 轮若候选要到 verifier 确认后才成立，由②在 closure 重算时回写。两条都进磁盘 script-report，runtime 在同一 phase 边界读到（`goal-phase-runtime.ts:9061-9063`）。
**同一候选两次出现时不得产生两条修订**：`applyScopeRevision` 的幂等按 `revision_input` 指纹去重（§3 问题 3），①②产出同一候选时指纹相同，只落一条。
**`--sync-closure` 出口同样覆盖**：该路径（`harness-runner.ts:599-612`）不经普通阶段尾部，但它调用的正是 `finalizePhaseClosure` → `recomputeClosureRepairCandidates`，因此②的回写在这条出口上自动生效；验收见 §5.4 的晚到候选行。

候选筛选条件不变：`category === 'spec' || category === 'plan'` 且 `source_phase ∈ {'coding','review'}`。不新增 check id、不动 `CHECK_ID_OWNER_REGISTRY`、不读原始 `checks` 数组之外的东西。

**写集越界类如何保证不误产修订（第一轮 review 阻断 3 的更正）**：第一版的保证只对 `diff_within_scope` 成立，对 UI 门不成立。
- 成立的部分：`diff_within_scope`（`check-coding.ts:320-330`，`failure_kind: 'scope_violation'`）与 contract-reference-closure 的未授权引用**没有注册进 `CHECK_ID_OWNER_REGISTRY`**；`checkOwnedCandidate` 对未注册 id 返回 `null`（`repair-candidates.ts:395`）。它们在结构上产不出 spec / plan 候选。
- **不成立的部分**：`ui-scope-gate.ts:194-196` 的判据是 `[...uiChanged].filter(file => !declared.has(file))` —— **任何**越出 `contracts.files` 的 UI 文件变更都产 `ui_scope_violation`，注册表把它一律归 plan。「coding 误改了一个 UI 文件」与「获准目标确有设计缺口」在这一层**无法区分**，前者会满足本 plan 原来的唯一触发条件。反过来，「非 UI 的新公共接口缺口」在今天**根本没有任何生产触发**（注册表总共只有三条，coding 侧只有 `ui_scope_violation`）。

**第二轮引入的「模块内 / 模块外」二分与新 check id `ui_scope_mis_edit` 整体删除（第三轮 review 阻断 2）。** 接受 codex 的核心判断：**模块命中只证明「范围相关」，不证明「设计责任」**——它是我发明的启发式，仓库里没有任何代码支撑「同模块内的越界 = 真实设计缺口」。发明第二个启发式来补第一个启发式是错误方向，删除，注册表、`ui-scope-gate`、`collectPhaseRepairCandidates`、assess 四层**一行不改**。

**本 plan 在归属层不新增任何判定，也不新增字段（第四轮 review 阻断 1）。** 第三轮写成「修订输入**已经带**真实设计事实才生成修订输入」——这是循环定义：`design-decision` 事实是这一步的**输出**，不是可检查的前提。核实：`RepairCandidate`（`repair-candidates.ts:32-52`）只有 `id / category / files / summary / item_fingerprint / source_phase`（加 testing 专用的 `signal@1` 标记），**没有任何承载设计事实的字段**；coding 组装分支（`:663-675`）也只提供 checkId、`affected_files` 与 detail。把不存在的字段当筛选前提，正反例就没有可执行的输入区别。

正确的接线（**输入=既有候选，输出=设计事实**，一个方向）：

`scopeRevisionInputFromRepairCandidates` 消费既有共享归属层已产出的 spec / plan 候选，对每条候选**生成**一条 `design-decision`（review 归因 spec 时为 `acceptance-definition`）required 事实：

- `basis` = 该候选 `files`（`RepairCandidate.files`，已是规范化 posix 相对路径）对应的 diff / 文件绑定 —— **可核验**，走 §4.1.0 的同一套绑定核验；
- `reason` 取候选 `summary`，语义是「**这项越界需要 plan 裁决**」，**不是**「机器已证明该扩展合理」；
- `requested_phases = [责任阶段, 剩余未执行阶段]`，其余义务原样继承（§5.1.1 的既有形状）。

因此触发条件回到**一条**：候选 `category ∈ {'spec','plan'}` 且 `source_phase ∈ {'coding','review'}`。没有第二条合取、没有意图筛选、没有新 check、没有新字段、没有分类器。
plan 拿到该提议后是否扩展契约仍由它独立裁决（D0.3 原文「修订提议不预设结论」）——误改型提议在这里被 plan 打回，这正是需求自带的安全阀。

**驳回 B4 的第三点要求（「模块内、模块外误改都断言到 assess 留在 coding」），给代码与需求证据：**

1. 需求 D0.3 对「留在 coding」的界定是**点名枚举**的，原文：「写集越界（`diff_within_scope`、contract-reference-closure 未授权引用）大多数是 coding 改错文件或误引依赖，应留在 coding 修复。」——枚举里**没有 `ui_scope_violation`**。
2. 这两个被点名的 check 今天**已经**留在 coding：它们未注册进 `CHECK_ID_OWNER_REGISTRY`，`checkOwnedCandidate` 对未注册 id 返回 `null`（`repair-candidates.ts:395`），结构上产不出 spec/plan 候选。需求这一条**无需任何改动即已满足**。
3. `ui_scope_violation → plan` 是**先于本 plan 就已上线**的裁决，注册表原文注释写死了理由：「`ui_scope_violation` 即使 `affected_files` 是产品源码也归 plan——scope 越界是 plan 冻结面的裁决问题」（`repair-candidates.ts:377-378`）。把它改成留在 coding 是**推翻一条既有裁决**，既不在需求 D0.3 的改动面内，也不是本 plan 被授权处置的范围；要改须单独提案并走裁决。
4. 误改被路由回 plan **不是泄漏，是设计**：D0.3 原文「plan 对是否扩展契约仍独立裁决，修订提议不预设结论」——plan 拿到一个误改型提议时的正确动作就是**拒绝扩展契约并把它打回 coding**。这条安全阀是需求自带的，不需要在机器侧提前判断意图。

**机器无法区分意图，这是一条如实记录的边界**（§2.1 #2 扩写）：`ui_scope_violation` 只知道「某 UI 文件不在 `contracts.files` 里」，既有代码没有任何信号能分辨「获准目标确实需要它」与「coding 改错了文件」。本 plan **不发明**这个信号；需求 §3 D0.3 验收第一行（「获准目标确实需要新公共接口且归属 plan」）因此落在「既有候选满足 `category`/`source_phase` 条件 → 生成设计事实 → 断言生成结果」的夹具上，意图正确性由 plan 阶段的独立裁决兜底，不由 coding 侧的机器判据兜底。

**非 UI 的新公共接口缺口没有 coding 侧生产触发，本 plan 不补**（§2.1 #2）：非 UI 面继续靠 review 侧 `collectReviewRepairCandidates` 的路径域归属（`repair-candidates.ts:568-575`）与 UT 的 `device_ac_delegation`（→ spec），以及既有 `backtrack_target_absent` 手工指引。需求验收措辞**不改写去迁就夹具**（B4 末句，接受）。

正反例都必须经过真实归属链（`buildSummaryRepairCandidates` → 注册表 → assess 路由）。反例见 §5.4。

### 问题 9 — `run_base_sha` 随修订事件冻结：读点清单、事件层 write-once、drift / replay 消费

grep `run_base_sha`（`harness/` 下，排除 `tests/`）的**全部**位置，分三类：

**A. 运行期读取（本 plan 要改的面）**

| # | 位置 | 角色 | 本 plan 处置 |
|---|---|---|---|
| A1 | `harness/scripts/utils/goal-run-baseline.ts:29`、`:35` | `resolveGoalRunBaseline` —— 现代 run 的**唯一**基线读点 | 改：`manifest.run_base_sha` → `resolveRunBaseline(manifest, events)` |
| A2 | `harness/scripts/goal-phase-runtime.ts:7238` | `runtimeFacts.runBaseSha = manifest.run_base_sha`，注入 `PhaseExecutionContext` | 改：同上一个纯函数 |
| A3 | `harness/scripts/utils/ui-scope-gate.ts:142` | 只消费 A1 的失败 `reason`，不直读 manifest | 不改（经 A1 自动获得） |
| A4 | `harness/scripts/utils/ut-target-resolver.ts:144` | 文案，说明基线来自出生冻结 | 改文案：「出生时冻结，或由首条含 coding/ut 的 `scope_revised` 事件冻结」 |
| A5 | `harness/scripts/utils/goal-phase-executor.ts:93` | 校验 `context.runtimeFacts.runBaseSha` 为 40-hex（链含 coding/ut 时） | 不改（消费 A2 的结果） |
| A6 | `harness/scripts/utils/agent-invoke.ts:1029` | 注释：goal agent 不接受调用方 diff 基线 | 不改 |
| A7 | `harness/scripts/goal-phase-runtime.ts:4848` | 文案「goal run 只认 manifest.run_base_sha」 | 改文案，同 A4 |

**B. 出生 / 身份 / write-once 防线（一律不改）**

`goal-manifest.ts:95`（字段声明）、`:227-230`（`computeManifestIdentityFields` 条件身份字段）、`:699-702`（40-hex 校验）、`:718`（构造）、`:1084-1085`（校验）；
`goal-run-creation.ts:260`、`:268`（`run_created.run_base_sha_digest`）、`:314-316`（出生摘要比对）、`:351-358`（manifest 与出生摘要存在性 / 值一致）；
`goal-phase-runtime.ts:3160-3161`（`manifest_identity_rebase` 回放禁止改写）、`:3217-3223`（drift 决策 `run_base_sha_write_once_violation`）；
`goal-failure-classifier.ts:297-298`（`run_base_sha_missing` / `_invalid` 分类）；
`goal-canonical-lifecycle.ts:5`、`:109-110`（`run_base_sha_digest` 规范化）。

**C. 随 D2.5 后继删除而消失（范围已按第一轮 review 阻断 8 收窄）**

只删 `firstImplementationSuccessor` 的**专用参数与专用分支**：`goal-run-creation.ts:79`（`GoalRunCreationOptions.firstImplementationSuccessor` 字段声明）与 `:239` 条件里的 `&& !options.firstImplementationSuccessor` 子句。

**第一版的错误（已更正）**：
- `goal-run-creation.ts:240-257` **整段保留**。逐行核实：`:239-248` 是**通用 successor 血缘继承**（`options.manifest.successor_of` → 要求可信 lineage `run_base_sha`，否则报「须人工 rebaseline supersede」），D2.5 明文保留的显式 supersede 走的正是这条；`:249-254` 的 `else` 分支是**普通出生基线冻结**（`resolveHead()` 取 HEAD）。整段删掉会让新 run 全部错误重取 HEAD，并让合法 supersede 失去 lineage 校验。
- `goal-phase-runtime.ts:4620-4621` **保留**。它位于 `:4604` 起的 `if (!argv.resume && !dryRunMode) { const sourceRunId = requestedSupersedeTargets[0]; ...}` 块内，即**显式 `--supersede` 路径**，不是正常 scope successor 专用代码；`:4619-4621` 把源 run 的冻结基线读出并赋给 `source.run_base_sha`（不可用则 `delete`），删掉后事件中冻结的基线传不给合法 supersede。

`goal-phase-runtime.ts:4673`（`--rebaseline-to` 显式重签）**保留**——属 supersede 面，D2.5 明确保留。
A1 / A2 两个运行期读点与 B 类（manifest identity 的 drift / replay 防线）保持第一版结论不变（该两项已经第一轮 review 核实正确）。

**实现（最小面）**：新增纯函数 `resolveRunBaseline(manifest, events): { baseSha?: string; source: 'birth' | 'revision' }`——
返回 `manifest.run_base_sha`（出生值）；出生无值时返回**第一条**携带 `run_base_sha` 的 `scope_revised` 事件的值。只有 A1 / A2 两处调用它。B 类完全不动，因为 `manifest.run_base_sha` 在修订路径下**从始至终不被写入**，所以「manifest 里出现 `run_base_sha` 变化 = 篡改」这条防线原样成立（且更严：修订不再给它任何合法写入理由）。

**事件层 write-once**：追加 `scope_revised` 时，携带 `run_base_sha` 的**充要条件**是——
① `manifest.run_base_sha` 不存在（出生链只有 spec/plan）；
② 已有 `scope_revised` 事件中**没有任何一条**携带 `run_base_sha`；
③ 本次修订后的**有效** `phase_chain` 含 `coding` 或 `ut`。
三条同时成立才取 `resolveGoalRunHeadSha(projectRoot)`（`goal-run-creation.ts:163`）并沿 `goal-manifest.ts:1084` 的 40-hex 校验写入；任一不成立则本条不得携带。违反（后续修订再携带、或携带了不同值）→ 视为链损坏，走既有恢复，不覆盖。

**drift decision / replay 层**：不改。`resolveManifestDriftDecision`（`:3217-3223`）与 `resolveManifestIdentityBaseline`（`:3160-3161`）仍只看 manifest / `run_created` / `manifest_identity_rebase`；修订事件从不进 manifest identity，故不进入 drift 比较面。replay（恢复重入）侧只需 A1 / A2 在扫 events 求有效范围时**同一次**扫出基线事件——`loadEffectiveExecutionScope` 与 `resolveRunBaseline` 共用同一份 `loadAuthoritativeEvents` 结果，不额外读盘。

### 问题 10 — D0.1 visual 派生接 fidelity SSOT 的具体读取点；fidelity 缺失时 unknown 如何进 unresolved

复用 `harness/scripts/utils/capability-resolution.ts:530-539` 的 `applicability.pixel_fidelity` 分支所调用的**同两个函数**（同一 SSOT，不新建读取路径）：

- `loadFidelityIntentSsotState(projectRoot, feature)` —— `harness/scripts/utils/fidelity-shared.ts:836`，返回三态 `missing` / `corrupt` / `valid`，`valid` 时带 `doc.selected_fidelity`；
- `fidelityIntentSsotPath(projectRoot, feature)` —— 同文件 `:825`，即 `<feature>/spec/reports/fidelity-intent.json`，作为派生事实 `basis` 的 dependency 路径（与 `capability-resolution.ts:529` 的 `dependency(ssotPath, 'applicability')` 同源）。

映射表（resolver 内新增的 `visual-evidence:fidelity` 派生事实，与现有 `<kind>:acceptance` 派生同位置写入，`execution-scope.ts:129-141` 之后）：

「请求 / 蓝图是否含视觉要求」的机器来源（**调度者裁决 2026-09-15**）：既有 `resolveUiRelevanceForRun(projectRoot, feature, requirement)`（`harness/scripts/utils/fidelity-shared.ts:1259-1270`）。它是现成的两级正信号——spec.md 存在时以其 `ui_change` 字段为准（`UI_CHANGE_REQUIRES_UI_SPEC`），spec.md 不存在时回落需求文本启发式 `detectUiRelevantRequirement`。goal-preflight 与 goal-runner 已共用它（该函数注释写明「抽出单一函数两处共用，避免再次分岔」），**本 plan 不得再造第三个读法**。
`requirement` 实参按调用点取既有需求文本来源，三处：

| 调用点 | `requirement` 来源 |
|---|---|
| 出生路径（`--prepare-run` / fresh runtime 出生） | prepare-run 的 `--requirement` / `manifest.requirement` |
| feature.yaml 候选路径（`resolveFeatureExecutionScope`） | `request.requested_results.join('\n')`（候选无 run manifest 可读） |
| runtime 修订（R4）与 checker 修订预算（R3） | `manifest.requirement` |

| SSOT 状态 | 请求 / 蓝图是否含视觉要求（`resolveUiRelevanceForRun`） | applicability | reason |
|---|---|---|---|
| `valid` + `selected_fidelity === 'pixel_1to1'` | — | `required` | `fidelity ssot: pixel_1to1` |
| `valid` + 其它 `selected_fidelity` | — | `not_applicable` | `fidelity ssot: selected_fidelity=<值>` |
| `missing` | 否 | `not_applicable` | `fidelity 未定档且请求无视觉要求` |
| `missing` | 是 | `unknown` | `请求含视觉要求而定档尚未完成` |
| `corrupt` | — | `unknown` | `fidelity ssot corrupt` |

与 `capability-resolution.ts:530-539` 的行为对齐点：那里对 `state !== 'valid'` 一律 `applicable: false`（不阻塞），因为它是 capability 层的剪枝；resolver 这里对 `corrupt` 与「有视觉要求但未定档」升为 `unknown`，因为义务层的 unknown 不等于阻塞、只是不许裁掉责任（D0.1 明写「与现有 provider 对缺失的处理一致，不强迫非视觉任务补一份视觉文件」——`missing` + 无视觉要求 → `not_applicable` 就是这条对齐）。

**unknown 如何进 unresolved**：不需要新代码。`resolveExecutionScope` 现有通路 `:174` 已把所有 `applicability === 'unknown'` 的义务映射成 `unresolved` 项，`owner = owner_phase`；`visual-evidence` 的 provider 是 `obligations.testing`（`:56`），故 owner = testing；`:187-190` 再把依赖它的下游从 `needed` 移出。`validateExecutionScope:99` 已保证 unknown 义务必须有对应 unresolved 项，删不掉。

**「SSOT 定档 pixel_1to1 但验收缺视觉条目 → unresolved 且 owner=spec」**（D0.1 明写这是待补缺口而非取消责任）：不给 `visual-evidence` 造 owner 例外，而是**额外**产出一条 `acceptance-definition` 的 unknown 事实（provider `obligations.spec`，`:51`，owner_phase = spec），reason「pixel_1to1 定档缺视觉验收条目」。

**第一版「自动获得、零新分支」是错的（第一轮 review 必修 2）**，逐字核实后更正：
- `:179` 的 definition-gap 分支判据写死为 `if (kind === 'acceptance-context' || kind === 'design-context')`，**不认 `acceptance-definition`**；一条 `acceptance-definition: unknown` 只会掉进 `:187` 的 `else if (needed.has(gap.owner) && !investigation.has(gap.owner))`，而 spec 恰在 `investigation` 集合内（`:176` 由 `obligations.spec` / `obligations.plan` 构成），该分支整条不执行；
- `:173` 的 `needed` 只收 `applicability === 'required' && !satisfied_by` 的义务，unknown 事实**永远不会**把 spec 加进 `needed`，因此 spec 也不会进 `phase_chain`——「spec 可执行回补」并不成立。

因此本条**必须补接一个分支。方案已定稿为 A（第五轮 review 必修 3，不再留待选设计）**：

把 `:179` 的判据从两个 kind 的字面比较改为「kind ∈ `OBLIGATION_PROVIDERS['obligations.spec'] ∪ OBLIGATION_PROVIDERS['obligations.plan']`」，即 `acceptance-context / acceptance-definition / design-context / design-decision` 四个 kind 统一走 definition-gap 通路。

定稿理由（原先列 A 为优先项的同一条）：`OBLIGATION_PROVIDERS`（`execution-scope.ts:49-57`）本就是「哪些 kind 归哪个 provider」的既有单一真源，A 直接消费它，把「哪些 kind 算定义缺口」从两处硬编码收成一处；B 只是再加一个字面量，留着同一份知识的第二个副本。
A 的已知改动面（批次 1 实施时**验证**、不再作为选型条件）：`design-decision`（D0.3 产出的 kind）也进入该通路。§4.4 的既有 `design-gap` 用例与本节下方三条断言一并跑；若实跑发现 `design-decision` 进该通路产生实际回归，**按当时的事实调整实现**并写进实施记录——但那是修 A 的实现，不是回退到 B。

**另须**让 spec 进入可执行面：`needed` 的构造（`:173`）之外，对 owner ∈ `investigation` 且 kind 属定义缺口的 unresolved 项，把 owner 加入 `needed`（investigation 本身按 `:177-190` 的设计「仍可执行」，这正是缺口的回补者）。
验收必须同时锁两件事（§4.4 已有 `D0.1 self-reported visual not_applicable is recomputed from fidelity ssot` 用例，追加断言）：① `visual-evidence` 仍为 `required`（责任不取消）；② `phase_chain` **含 spec**（缺口可执行回补）且 `unresolved` 中该条 owner=spec；③ 下游（testing）在缺口未补前不被算作可执行。

### 问题 11 — D2.3「执行历史」从 events 的哪些事件类型派生，与现有 phase closure / evidence manifest 如何对账

执行历史**全部来自既有事件类型，不新增任何类型**：

| 事件类型 | 位置 | 承载的历史事实 |
|---|---|---|
| `phase_start` | `goal-phase-runtime.ts:6279`、`:7260` | 该 phase 被派发过；`resolvePhaseRunIds`（`verify-feature-completion.ts:728-734`）已按它按 ts 选最新 run |
| `agent_invoke_start`（invoke 序号） | 经 `derivePhaseInvocationAttempt`（`verify-feature-completion.ts:740-752`） | attempt 序号、预算 / 轮次连续性 |
| `phase_backtrack_requested` | `goal-phase-runtime.ts:5842`、`:7710`、`:9471` | 失败 / 回退历史，`:6095` 已用它折算 `backtracksUsed` |
| `phase_verdict` / `phase_halt` | 经 `rebuildOutcomesFromEvents`（`goal-runner-phase.ts:752-760`） | **该 phase 的结果语义**（PASS / 非 PASS / HALT）。`phase_halt` 覆盖同 phase 在先的 provisional `phase_verdict`（该函数注释原话），第一版漏列这两类，导致「执行历史」里根本没有结果维度 |
| `run_end` | `resolveEffectiveRunEnd`（`goal-runner-phase.ts:725`） | 封卷状态（run 内修订期间**不写**） |

**复用判据（第一轮 review 阻断 6 的更正）**。第一版的三元合取（`phase_start` + `integrityOk` + `fresh`）有两处硬错，逐条核实后重写：

*错误 ①：`fresh` 不等于 PASS。* `assess.ts:532-541` 才是既有的闭环判据——`closure = evidenceVerdict === 'fresh' ? 'closed' : 'stale'` **只在** `!legacy && summary.closure_status === 'closed' && closure_commit.schema_version === '1.0'` 三条同时成立时才赋值，而 `summary.verdict`（`assess.ts:511`）是独立的一维。第一版引用的 `assess.ts:461-465` 只是 `recomputePhaseEvidenceStaleness` 的调用，根本不含 verdict / closure 维度。

*错误 ②：不能直接复用 `executionScopeEvidenceIssues` 来兜底。* `verify-feature-completion.ts:75-82` 对 `ScopeEvidenceRef` 的检查里写着 `const terminal = resolveEffectiveRunEnd(...)`，并要求 `['CHAIN_SLICE_COMPLETED','COMPLETED'].includes(terminal.status)` —— 即**来源 run 必须已有成功 run_end**。D2 明确不封卷，所以「spec 刚在本 run 闭环 → 同一 run 内引用它的证据」会被这条判成 `reused evidence invalid`。§7.2 第一版把 `executionScopeEvidenceIssues` 整体列为 `createScopeSuccessor` 的接手门禁，这一条必须按下表拆开。

判定某 phase 是否算「已 closed 且 PASS、证据仍有效、未受本次修订影响」，按**证据来源属本 run 还是历史 run** 二分：

| 维度 | 本 run 已闭环阶段（D2 主路径） | 历史 run 的终局证据（既有 `ScopeEvidenceRef` 复用） |
|---|---|---|
| 结果语义 | 阶段 `summary.json` 的 `verdict === 'PASS'` 且 `closure_status === 'closed'` 且 `closure_commit.schema_version === '1.0'`（`assess.ts:511`、`:537-538` 同一把尺）；且 events 中该 phase 的最后一条 `phase_verdict` 为 PASS 且无覆盖它的 `phase_halt`（`rebuildOutcomesFromEvents` 同一把尺） | 同左，**另加** `resolveEffectiveRunEnd` 终局 ∈ `{CHAIN_SLICE_COMPLETED, COMPLETED}`（沿用 `verify-feature-completion.ts:75-82` 原判据，一行不改） |
| 身份 | `resolvePhaseRunIds(...).runIds[phase] === manifest.run_id`（本 run） | `resolvePhaseRunIds(...).runIds[phase] === ref.run_id` |
| 证据完整性 | `loadPhaseEvidenceManifest(...)?.integrityOk === true` 且 `manifest.aggregate_sha256 === ref.evidence_manifest_aggregate` | 同左 |
| 新鲜度 | `recomputePhaseEvidenceStaleness(...)[0].verdict === 'fresh'` | 同左 |
| attempt 对账 | `derivePhaseInvocationAttempt`（`verify-feature-completion.ts:740-752`）与记录一致 | 同左 |

实现上**不删除任何终局检查**：`executionScopeEvidenceIssues` 增加一个可选参数 `currentRunId?: string`，仅当 `ref.run_id === currentRunId` 时跳过 `resolveEffectiveRunEnd` 那一项（因为当前 run 按定义未封卷），其余五项照跑；不传该参数时行为与今天逐字节相同。**不放宽历史 run 的判据，不把 fresh 当 PASS。**

- 上表全部成立 → 该 phase **不进**新 `phase_chain`，其义务改挂 `satisfied_by: ScopeEvidenceRef { phase, run_id, evidence_manifest_aggregate }`（`execution-scope.ts:10-14`），并进 `reused_phases`；
- 任一不成立（证据失效 / 被本次修订的写集影响）→ 允许重新进入 `phase_chain`，同时**撤销**对应 `satisfied_by`（D2.3「撤销已失效的 satisfied_by」），相关阶段按既有 freshness 机制重跑；
- 已执行但未 PASS 的阶段（有 `phase_start`，`phase_verdict` 非 PASS 或被 `phase_halt` 覆盖，或无有效 closure）→ 可以重新出现在新链中（`[plan, coding, review, ut]` 合法）。

`validateExecutionScope` 的既有约束无需放宽：`:106` 已要求复用阶段不得同时在 `phase_chain` 内，`:83` 的 `phase_chain` 不重复约束保持（它只描述「从现在起还要执行什么」，与执行历史是两个序列）。

### 问题 12 — D1.3「本次关联的 run」如何识别；feature 记录 `transferred_to` 的写入时机

**显式身份链（已核实，第一版这段正确）**：
显式 `--goal-run-id`（或 attended bridge 传入）→ `bindAttendedGoalContext`（`harness/harness-runner.ts:358-397`）→ `validateAttendedGoalContext` 校验四元组身份 → 写 `process.env.MAISON_GOAL_RUN_ID`（`:394`）。
所有下游只读这一个值：`harness-runner.ts:225`、`:546`、`:726`、`:885`、`:2086`、`:2588`，`check-coding.ts:323`/`:477`、`check-review.ts:1131`、`check-receipt.ts:258`/`:545`、`fidelity-intent-init.ts:179`。

**但这条链回答的不是问题 12（第一轮 review 必修 3）**。需求 D1.3 问的是「harness-runner **无 run 身份**调用时如何识别 active run」，而 `bindAttendedGoalContext:370-373` 写着 `if (input.goalRunId === undefined) { ...; return { bound: false }; }` —— 没拿到显式 run id 就直接返回未绑定，**它是显式身份校验器，不是发现机制**。把它称作「active run 识别」是把校验冒充成发现。

**结论：`未能核实` —— 仓库中没有现成的「无身份调用时发现 active run」函数。** 本 plan 的处置：

1. **不新增 registry、不扫目录、不按 mtime 猜**（D1.3 明文禁止，且总纲禁「第二 run 目录 / 场外状态」）。
2. 可核实的候选来源已点名（第二轮 review M2 给出，已逐行核实）：
   - `goal-run-lock.ts:10-14`（`FEATURE_LOCK_NAME='.feature.lock'`、`STALE_LOCK_MS`）、`:16-31`（`LockRecord` 带 `run_id` / `pid` / `hostname` / `updated_at` / `epoch`）、`:45-52`（`readLockRecord`）、`:54-72`（`isLockStale`：同机 pid 活着→永不 stale，跨机只看 TTL）；
   - `goal-run-control.ts:114-117`（`readRunControl(runDir, expectedRunId?)`，fencing epoch / owner）。
   批次 3 实施第一步**先落一条读取实验**：读该 feature 的 `.feature.lock`，用 `readLockRecord` + `isLockStale` 判断是否存在活着的持柄者及其 `run_id`，再用 `readRunControl` 核该 run 的 owner。实验结论（可用性、误判面）写进实施记录，**在结论落地前不得声称已有识别机制**。
3. **这条读取检查必须前置到「冻结 / 选择 feature 权威之前」**（M2 要求），即 §3 问题 2 的 `ensureFeatureExecutionScopeFrozen` 入口第一步：发现活着的持柄者 → 按 D1.3 第一行以该 run 为权威（或按第三行报错），**不得先冻结 feature 记录再补救**。
4. 实验若证明锁记录不足以安全判定活性（残留锁 / 跨机 / pid 复用），则 D1.3 第一行的「本次关联的 run」**收窄为只认显式 `--goal-run-id` / `--run-id`**，并且**在收窄之下，读取检查发现任何非 stale 的 `.feature.lock` 记录时一律明确报错**（走 D1.3 第三行「不选边」），不静默走 feature 载体。
   **放弃的准确性（第一版的兜底依据已删除）**：第一版写「该情形下无身份调用本就拿不到 Feature 锁」——**这是错的**：`harness-runner.ts:370-372` 无 `--goal-run-id` 直接返回未绑定，Feature 锁由 `goal-phase-runtime.ts:3887-3899` 的 Goal runtime 获取，无身份 harness 调用**根本不参与那场锁竞争**。因此真正的保证只能是第 3 步的主动读取检查，而不是锁竞争。
   **实验失败不得自动授权两套有效范围并行**（M2 原话）：第 4 步的收窄以「发现活锁即报错」为代价换取单一权威，不以「走 feature 载体」为默认。验收改为 `D1 runless call under a live feature lock reports instead of choosing a side`。

因此 D1.3 的统一入口签名是：

~~~ts
loadEffectiveExecutionScope(projectRoot, feature, runId?: string): {
  scope: ExecutionScope; source: 'run' | 'feature'; run_id: string | null;
}
~~~

`runId` 有值 → run 权威（出生范围 + `scope_revised` 事件）；无值 → feature 冻结记录（出生段 + `revisions[]`）；两者都无但存在阶段报告 → 抛错并列出已查来源与缺失项（D1.3 第三行）；两者都无且无阶段报告 → 调用方按 D1.2 首次冻结。

**明确排除**：`classifyGoalRunsDir`（`fidelity-shared.ts:355`）与 `resolvePhaseRunIds`（`verify-feature-completion.ts:720`）只用于**历史阶段证据定位**，不得用来「猜当前 run」——目录里存在任何历史 run 不构成永久接管轻量路径的理由（D1.3 明文）。

**两个出生入口都必须接（第一轮 review 阻断 11）**。`resolveFeatureExecutionScope` 在生产里有两个调用点，第一版只处置了前者：

| # | 入口 | 位置 | 场景 |
|---|---|---|---|
| ① | `prepareGoalModeRun` | `goal-mode-entry.ts:102` | attended `--prepare-run` |
| ② | **fresh / detached runtime 自带出生** | `goal-phase-runtime.ts:4573-4574`（`requestedExecutionScope = manifest.execution_scope ?? resolveFeatureExecutionScope(...)`） | 不经 prepare 的 fresh 启动与 detached |

②仍直接从 feature.yaml 候选重算，因此「feature 已由 S0 修订为 S1 后从这条入口启动」会以 S0（甚至与 S1 冲突的重算结果）出生，也不会写 `transferred_to`。
处置：**两个入口共用同一段逻辑**，提取为一个函数 `resolveBirthExecutionScope(projectRoot, feature, workflow, frameworkRoot, opts?)`——有 feature 冻结记录 → 返回其**有效**范围（出生段 + 已应用 revisions，不重算候选）；无记录 → 沿现状 `resolveFeatureExecutionScope`。①②各自把原调用原位替换为它（**原位替换，不是新增第三条路径**）。出生成功后的 `transferred_to` 登记同样两处都做。
批次 3 验收必须含 **detached 反例**：`D1 detached birth after a feature-level revision uses S1 and registers transferred_to`；只验 attended 不算覆盖。

**`transferred_to` 写入时机**：入口①在 `goal-mode-entry.ts --prepare-run` 的出生路径（manifest 组装见 `:104-116`），入口②在 `goal-phase-runtime.ts` 的 fresh 出生路径，均为 **`createGoalRun` 成功返回之后、`ensureRunControl` 之前**，向 feature 冻结记录追加：

~~~json
{ "transferred_to": "<run_id>", "transferred_scope_fingerprint": "<转交时 feature 有效范围的 executionScopeFingerprint>" }
~~~

顺序理由：run 出生是「先写 manifest.json，再追加 run_created」的两段写（`goal-run-creation.ts:236` 起）；出生未完成时，feature 侧绝不能留下指向不存在 run 的指针。出生完成后再写，最坏残留是「run 已存在但 feature 记录未登记」——这一状态由 D1.3 第一行覆盖（本次关联的 run 优先，feature 记录无 `transferred_to` 也不报错），不产生误判。反向残留（feature 记录声明转入某 run 而该 run 不存在 / 损坏）才是 D1.3 第三行的明确报错。

同时，出生范围**不从候选重算**：上表两个入口经 `resolveBirthExecutionScope` 取 `loadEffectiveExecutionScope(projectRoot, feature).scope`（feature 有效范围 = 出生段 + 已应用 revisions），替代现在经 `resolveFeatureExecutionScope`（`feature-track.ts:79-85`）重算候选的路径。feature 记录的最初出生段与修订历史原样保留。

## 4. 批次 1：D0.1 + D2

### 4.1 D0.1 义务判定防洗绿（第一笔，纯函数 + 读取层 + 测试）

#### 4.1.0 resolver 保持纯函数：已解析事实如何进来（第一轮 review 阻断 1）

第一版要求 resolver「读 fidelity SSOT、检查 basis 文件存在、重解析 `satisfied_by` 证据」，同时又限定「只改纯函数文件」，两者不相容。代码事实：`resolveExecutionScope(input, workflow, acceptance?)`（`execution-scope.ts:119`）的三个入参里没有 `projectRoot`、没有 `feature`、没有解析上下文；真正承担「按来源重读 + 内容指纹核验」的是 `readBoundInput`（`capability-resolution.ts:486-501`）。

**处置：沿用 `acceptance` 参数已经确立的模式——读取层先解析好，resolver 只做纯计算。** `resolveExecutionScope` 增加**一个**可选入参 `resolved?: ResolvedScopeFacts`：

~~~ts
interface ResolvedScopeFacts {
  /** fidelity 定档结果（由读取层调 loadFidelityIntentSsotState 得到），含作 basis 的 dependency */
  fidelity: { state: 'missing' | 'corrupt' | 'valid'; selected_fidelity?: string; binding: InputBinding };
  /** impact.basis 的核验结论（存在 / 项目内 / 指纹一致），由读取层逐条算好 */
  impact_basis: Array<{ input_id: string; ok: boolean; detail: string }>;
  /** satisfied_by 的重解析结论（InputBinding 经 readBoundInput、ScopeEvidenceRef 经阶段证据检查） */
  satisfied_by: Array<{ obligation_id: string; ref_index: number; ok: boolean; detail: string }>;
  /** impact 相关性判定所需的目标集合，见 §4.1.3 */
  targets: { implementation_files: string[]; contracts_files: string[]; review_targets: string[]; ut_targets: string[] };
}
~~~

- **产出方（既有读取层，不新建）**：把事实组装提取为**一个**导出函数 `collectResolvedScopeFacts(input, ctx)`，放在 `feature-track.ts`（与 `readScopeAcceptance` 同文件同范式——`:88-96` 就是现成的「读取层用 `readBoundInput` 解析、把结果递给纯函数」）。
- **必须接到全部生产 resolver 调用（第二轮 review B1）**。第一版只安排了出生读取层与 D1 冻结入口，漏掉两个修订路径；而 resolver 在缺 `resolved` 时把三类证据义务一律落 `unknown`，于是一次合法的设计修订就会把已定的 device/unit/visual 结论打回 unknown，并被 `goal-phase-runtime.ts:9072-9074` 的「cannot subtract required obligations」当成降级直接拒绝。逐处安排：

| # | 生产 resolver 调用点 | 场景 | 事实来源 |
|---|---|---|---|
| R1 | `feature-track.ts:84`（`resolveFeatureExecutionScope` 内） | 两个出生入口 + D0.2 生成器 | 就地调 `collectResolvedScopeFacts` |
| R2 | D1 首次冻结入口（§3 问题 2） | 无 run 首次冻结 | 同上 |
| R3 | **`blueprint-skill-projection.ts:55`**（`designScopeRevisionChecks` 的 `resolveExecutionScope(proposal, workflow, acceptance)`） | checker 侧的修订**预算**（判断提议是否会缩义务） | 同上；`ctx` 取自既有 `CheckContext`（已有 `projectRoot` / `feature` / `frameworkRoot` / `resolvedInputs`）。**并须同时修第三参数 `acceptance`，见下** |
| R4 | **`goal-phase-runtime.ts:9085`**（runtime 应用修订时的 `resolveExecutionScope(input, workflow, readScopeAcceptance(...))`） | run 内修订落地 | 同上；`readScopeAcceptance` 已在同一行调用，`collectResolvedScopeFacts` 与它并列取同一 `projectRoot` / `feature` / `frameworkRoot` |

四处**共用同一个组装函数**，出生、checker 预算、runtime 修订三种时机得到同一份事实口径；resolver 保持零 `fs`。

**R3 还缺第三参数 `acceptance`（第三轮 review 阻断 1）**。核实 `blueprint-skill-projection.ts:53`：

~~~ts
const acceptance = ctx.phase === 'spec' && ctx.featureSpec.acceptance ? { value: ctx.featureSpec.acceptance, binding: resolved.binding } : undefined;
~~~

`ctx.phase === 'spec'` 是硬条件 —— **plan 阶段恒为 `undefined`**。而 `ResolvedScopeFacts` 只承载 fidelity / impact_basis / satisfied_by / targets，**不含验收**。于是 plan 产出新 contracts 后走这条修订预算：验收缺失 → `resolveExecutionScope` 内 `unit-evidence` / `device-evidence` 的 `<kind>:acceptance` 派生整段不执行（`execution-scope.ts:130-141` 由 `if (acceptance)` 包住）→ 两者重算为 unknown → 紧接着 `:56` 的「设计修订不得静默删除冻结义务」把已有 required 判成降级，**合法的 plan 修订被自己的预算拒绝**。

处置：R3 的第三参数改为**从 proposal 自身调 `readScopeAcceptance`**（`feature-track.ts:88-96`，出生与 R4 已在用的同一函数，输入正是 `Pick<ExecutionScopeInput,'facts'>`）：

~~~ts
const acceptance = ctx.phase === 'spec' && ctx.featureSpec.acceptance
  ? { value: ctx.featureSpec.acceptance, binding: resolved.binding }   // 本轮 spec 刚产出的有效新验收，优先
  : readScopeAcceptance(ctx.projectRoot, proposal, { feature: ctx.feature, frameworkRoot: ctx.frameworkRoot });
~~~

**顺序必须是「本轮验收优先、其余从 proposal 重读」，不能写成 `readScopeAcceptance(...) ?? 兜底`（第四轮 review 必修 1）**。核实：`readScopeAcceptance` 在 `feature-track.ts:94` **直接**调 `readBoundInput`，后者遇失效绑定在 `capability-resolution.ts:493-497` **抛错**（不是返回 `undefined`）；`??` 只接 `null`/`undefined`，右侧永远不会执行。第三轮写的「旧绑定失效时由 spec 新验收兜底」因此不成立——那会变成一个抛错的裸调用。
改为先判本轮：spec 阶段已产出有效新验收时直接用它与它的绑定（此时 proposal 里的旧绑定本就可能已失效，没有理由去读）；其余情况（含 plan 阶段）从 proposal 重读。
**一般 stale 错误不吞**：`readScopeAcceptance` 抛出的绑定失效异常照旧向上传播——它本来就该让本次修订预算失败并回 scope owner（`readBoundInput` 的错误文案原文即「input binding stale; return to scope owner」），不得用 `try/catch` 转成 `undefined` 静默继续，那会把「验收来源已失效」洗成「没有验收」→ 又回到 unknown 降级的老问题。
**四个 resolver 调用点因此在「事实」与「验收」两个入参上都同源**。
验收（§4.4 新增）：`D0.1 plan-phase revision keeps unit/device from the existing acceptance`——已有有效验收的 feature，在 plan 阶段产出新 contracts 触发修订预算，断言 `unit-evidence` / `device-evidence` **不**变成 unknown、`design_scope_facts` **不**报 BLOCKER。

- **代码 / 测试目标类绑定不能盲调 `readBoundInput`（同一阻断的第二半，第二轮 review B1）**。核实：`derive.codebase` / `derive.test-targets` 只有在 `options.inputContext` 存在且 `options.testTargets` 非空时才走解析分支（`capability-resolution.ts:278-289`，返回带 `value` 的 `{path, content}[]`）；普通 Feature 分支（`:335-339`）返回的是 `{ state:'resolved', dependencies, detail:'project_root' }`，**没有 `value`**，而 `readBoundInput:493` 第一条判据就是 `result.value === undefined` → 必抛 `input binding stale`。
  因此 `collectResolvedScopeFacts` 对每条绑定二分，**不得一律调 `readBoundInput`**：
  - `source.kind === 'artifact'`，或 `derive.blueprint-acceptance` / `derive.blueprint-contracts` / `derive.requirement`（有解析值的 provider）→ 调 `readBoundInput`，用它的抛错作结论；
  - `derive.codebase` / `derive.test-targets` → **只核 `dependencies[]`**（路径存在、在项目内、`sha256` 与当前字节一致，与 `readBoundInput:494` 的 `matches(dep, dependency(dep.path, dep.role))` 同一把尺、同一实现），**不比 `content_fingerprint`**——该 provider 在冻结上下文里本就没有解析值可比。这一点必须写进 `collectResolvedScopeFacts` 的注释，并由一条用例锁住（`D0.1 codebase basis is verified by dependencies, not by a parsed value`）；若未来要给它真实解析上下文，须显式提供 `inputContext` + `testTargets`，属独立提案。
  **适用面：两类 basis 都覆盖，`satisfied_by` 一律不覆盖（第三轮建议 1 + 第四轮 review 必修 2）**：

| 位置 | 核验方式 |
|---|---|
| `obligation.basis` | 有解析值的 provider → `readBoundInput`；`derive.codebase` / `derive.test-targets` → 只核 `dependencies[]` |
| **`request.impact.basis`** | **同上，共用同一函数**。第三轮把例外写成「只对 `obligation.basis` 生效」，而 §4.1.3 第 3 条要求 impact basis 直接 `readBoundInput` —— 当 impact 来源用代码类绑定时（D0.1 明写 basis 可以是「CU canonical、蓝图、**代码文件**」），`capability-resolution.ts:335-339` 没有解析值，读取器必拒，等于又把 D0.1 的代码来源影响判断堵死 |
| `satisfied_by` 中的 `InputBinding` | **一律 `readBoundInput`（`capability-resolution.ts:486-499`）重解析**，不可解析即拒绝冻结（§4.1.4），**不得**借这条例外放宽——它是「这项义务已被满足」的凭证，解析值必须可重现；basis 只是「判断的来源」 |

  实施时 `collectResolvedScopeFacts` 里写**两个**函数：`verifyBasisBinding`（两类 basis 共用）与 `verifySatisfiedByBinding`（严格重解析），不共用一个宽松路径。
  **放弃的准确性**：`derive.codebase` 类 **basis** 的核验强度停在「文件字节未变」，不含「解析值未变」——但该 provider 在这个上下文里根本不产生解析值，比 `content_fingerprint` 是无意义的（今天的 `verify-feature-completion.ts:69-73` 对这类 basis 走的也是 `isExecutionSourceBasis` 豁免，同一取向）。
- **resolver 内**：只读 `resolved` 的布尔 / 枚举结论做映射与拒绝，不碰 `fs`、不碰 `projectRoot`。`resolved` 缺省（旧调用方 / 纯单测）时，三类证据义务的派生一律落 `unknown`（**不是** `not_applicable`），保证「没给来源就不许裁」这条护栏在类型上也成立。
- 因此「批次 1 第一笔只改纯函数文件」收窄为准确表述：**`execution-scope.ts` 纯函数 + `feature-track.ts` 读取层各改一处**，改动文件清单 §4.1.6 同步。

**`content_fingerprint` 的语义（同一阻断的第二半）**：`readBoundInput:498` 的比较是
`crypto.createHash('sha256').update(stableStringify(result.value)).digest('hex') !== binding.content_fingerprint`
—— 即**解析后值的稳定序列化摘要**，不是文件原始字节的 sha256（文件字节由 `binding.dependencies[].sha256` 单独核，同函数 `:495-497`）。凡本 plan 出现「`content_fingerprint` 与当前字节一致」的措辞（§4.1.4 原文）一律按此更正：**复用 P1 对解析内容的核验，即直接调 `readBoundInput` 并让它抛错，不自行重算任何哈希。**

**修订时 `impact` 的承接（同一阻断的第三半）**：`blueprint-skill-projection.ts:52` 重建 `proposal: ExecutionScopeInput` 时只带 `{ completion_target, requested_results, requested_phases }`，**不带 `impact`**。D0.1 落地后，一个合法的零设备范围只要再被修订一次，`request.impact` 就丢了 → device 掉回 `unknown` → testing 不再能裁，等于每次修订都倒退一格。
处置：`:52` 的 request 构造改为 `{ ...scope 出生时的 request 面, requested_phases: remaining }`，显式带上 `impact`。**来源**：出生范围的 `request.impact` 今天没有被存进 `ExecutionScope`（输出结构只有 `completion_target` / `requested_results`）。因此 `ExecutionScope` 同批新增一个字段 `request_impact?: ExecutionScopeInput['request']['impact']`，由 resolver 原样回写，供所有修订重建方读取。这是**本 plan 唯一新增的 `ExecutionScope` 字段**，纳入 `executionScopeFingerprint`（自动——该函数对整个对象取摘要）。

**`request_impact` 是「可经有来源的修订更正」的继承默认值，不是不可改项（第二轮 review B2）**。第一版把它写成「请求边界、禁止修改」，与已定裁决直接冲突——核实：
- 需求 D2.3 的不可改清单是「`requested_results`、`completion_target`、requirement、预算、pin、授权上下文、fidelity」，**不含 impact**；
- 需求 D2.8 第三行明写「coding 期间发现用户可见行为变化（原 device-evidence not_applicable）→ 修订为 required，testing 进入链尾，不报『降级 required』BLOCKER」。
而 D0.1 又要求 resolver 覆盖**所有**候选的 device 结论、不采信自报——若旧 `impact=false` 被永久继承，这条裁决在结构上永远无法兑现。

因此规则写实为三条：

1. **继承默认**：修订未提供新 `impact` 时，从当前有效范围的 `request_impact` 原样继承；任何修订路径**不得静默丢弃**它（这正是 B1 要修的那半）。
2. **可更正**：修订**可以**携带新的 `request.impact`，但必须满足与出生时**完全相同**的机器核验（§4.1.3 的四条：存在、项目内、绑定一致、与本次实际范围相关），且其 `basis` 必须是本次修订新引入的有来源事实——复用 `goal-phase-runtime.ts:9084` 已有的「修订必须带新 sourced facts」判据，不新造谓词。更正后经同一 `resolveExecutionScope` 重算，device 结论由 resolver 得出，**不通过采信候选 applicability 绕过 D0.1**。
3. **仍受 D2.3 的方向约束**：重算结果若导致某条 required 义务被删除或降级，照旧被「不得删除 / 降级 required」拦下（§4.2.4）。`not_applicable → required` 不是降级，放行；`required → not_applicable` 被拦。

`SCOPE_REVISION_FIELDS`（`goal-manifest.ts:751`）本身不变——它管的是 manifest 字段，`request_impact` 随 `execution_scope` 一起进出，不需要单列。
验收（§4.4 新增一行）：`D2 sourced impact correction flips device from not_applicable to required`——出生 `impact=false` 且 device `not_applicable` → coding 期间带新 basis 的 `impact=true` 修订 → device `required`、testing 进链尾、**不报降级 BLOCKER**；同时反例 `D2 impact correction without new sourced basis is rejected`。

#### 4.1.1 候选自报一律不采信

`harness/scripts/utils/execution-scope.ts` 的 `resolveExecutionScope`（`:119`）在构建 `obligations` 之前，对 `input.facts` 中 `kind ∈ {'unit-evidence','device-evidence','visual-evidence'}` 的每条事实，用派生结果**覆盖** `applicability` 与 `reason`（`basis` 追加派生来源绑定，不丢原 basis）。候选写什么都不构成拒绝理由——D0.2 生成器本身就把派生结果写进候选，「出现即拒绝」会拒掉自己生成的零设备候选。不新增「机器生成 / AI 手写」标记。

| kind | 来源 | unknown 条件 |
|---|---|---|
| `unit-evidence` | 现有验收分层派生 `unit-evidence:acceptance`（`:129-141`，`collectUnitScopeIds`） | 验收缺失，或 `checkAcceptanceUtLayerComplete` FAIL（分层非法） |
| `device-evidence` | 现有验收分层派生 `device-evidence:acceptance`（`collectDeviceScopeIds` + `hasUnknownPerformanceLayer`） | 同上，或性能层待定 |
| `visual-evidence` | fidelity SSOT，见 §3 问题 10 | SSOT 损坏；或请求 / 蓝图含视觉要求而定档未完成 |

现有 `:129-141` 只在 `acceptance` 存在时写入 `<kind>:acceptance` 事实，且用 `Object.assign(previous, fact)` 覆盖同 id 候选——覆盖机制已在；本次要做的是把覆盖面从「同 id」扩到「同 kind 的全部候选事实」，并补上 visual 这条从来没有的派生逻辑（`:56`、`:69`、`:78` 只在常量与过滤中出现，resolve 内无计算）。

#### 4.1.2 visual 派生

见 §3 问题 10。派生事实 id 用 `visual-evidence:fidelity`，`basis` 为 `fidelityIntentSsotPath` 的 dependency。**不从 acceptance 分层推 visual。**
「含视觉要求」一维经 `resolveUiRelevanceForRun`（§3 问题 10 的裁决表），`requirement` 实参按调用点取，三处来源见同表。**「SSOT 缺失 + 无 spec.md + 需求文本无 UI 词」才落 `not_applicable`**——这仍满足 D0.1「不强迫非视觉任务补一份视觉文件」，且缺 spec.md 时的判据与既有 preflight 完全一致。

#### 4.1.3 impact 判断

字段位置与形状见 §3 问题 6。`completion_target === 'feature'` 时的 device 结论：

| 条件 | device-evidence | reason |
|---|---|---|
| `impact.user_visible_behavior_change === false` 且验收无设备层 且 visual 非 required | `not_applicable` | `影响判断：无用户可见行为变化` |
| `impact.user_visible_behavior_change === true` | `required` | `影响判断：存在用户可见行为变化` |
| `impact` 缺失 | `unknown` | `影响依据缺失` |

`basis` 机器核验边界（写实；**前三条由读取层执行并经 §4.1.0 的 `resolved.impact_basis` 传入，resolver 只读结论**）：

1. 每条 basis 的 dependency 路径存在；
2. 位于项目内（`isInsideProjectRoot`，读取层已有同款校验，见 `feature-track.ts:93`）；
3. 内容可读且与绑定一致 —— 走 §4.1.0 的 **`verifyBasisBinding`**（有解析值的 provider 交 `readBoundInput` 自己判；`derive.codebase` / `derive.test-targets` 只核 `dependencies[]` 字节）。**不得对 impact basis 一律 `readBoundInput`** —— D0.1 明写 basis 可以是代码文件，而这类 provider 在冻结上下文没有解析值，必被读取器拒绝（第四轮 review 必修 2）；也不自行重算哈希；
4. 与本次实际范围相关 —— **目标集合逐条点名来自哪个字段**（`resolved.targets`，由读取层从同一份候选算出，resolver 只做集合相交）：

| 任务形态 | 目标集合取自 | 判定 |
|---|---|---|
| 有 `implementation` required 义务 | `implementation_files` = 该义务 `basis[].dependencies[].path` 中 `role === 'derive'` 的项（即写集来源）；`contracts_files` = 该范围内 `design-context` / `design-decision` 义务所绑定的 `contracts@1` / `derive.blueprint-contracts` 解析值的 `files` 字段 | basis 路径与两者之一有交集即通过 |
| 仅 review（无 implementation） | `review_targets` = `code-review` 义务 `basis[].dependencies[].path`；无绑定时退为上一行的 `contracts_files` | 同上 |
| 仅 UT | `ut_targets` = `unit-evidence` 义务 `basis[].dependencies[].path`；无绑定时退为 `contracts_files` | 同上 |
| 蓝图 / CU 来源路径 | `contracts_files`（经既有 CU→contracts 映射得到，**不硬绑 implementation**） | 同上 |

任一不成立 → 拒绝（抛 `fail`），不降级为 unknown。`impact.reason` 的语义正确性**不在 resolver 里判**——由既有 review / 阶段检查对照 diff 核对，发现与实际影响不符时走 D0.3 归属产出修订。

**目标集合为空时的两条子情形（调度者裁决 2026-09-15 第三条）**：空集合**永远不得**被读成「basis 无关」——那时根本没有可比对的东西。二者都不新造语义：

| 子情形 | 判定 | 处置 |
|---|---|---|
| (a) 本次**含 implementation 义务**（`requested_phases` 含 implementation provider 的阶段，或候选有 `implementation` 事实），但 `contracts.files` 为空且 implementation 事实无写集 basis | 范围声明本身有问题 | **拒绝**，文案指向声明面：「范围未声明可核验的写集（contracts.files 为空且 implementation 无写集来源），责任方 plan」。与 `check-coding.ts:326` 既有 `diff_within_scope` FAIL「施工契约缺少 files/modules」**同一口径**，只是前移到冻结时 |
| (b) 本次**无 implementation 义务**且无 review / UT 目标（如出生链只有 spec / plan） | 相关性无法核验 | 按**既有的「影响依据缺失」同一条路**：`device-evidence` 落 `unknown`，reason 记「影响依据无可核验范围」，**testing 不裁**。不新增状态 |

实现分工照 §4.1.0：读取层只多给一个布尔 `impact_targets_available`（目标集合是否非空）；「是否含 implementation 义务」由 resolver 用既有 `OBLIGATION_PROVIDERS` 注册表算（不硬编码 `coding` 这个 phase id）。两条子情形各在 §4.4 补一行用例。

#### 4.1.4 `satisfied_by` 冻结时核验

现在只在 verify 时核（`verify-feature-completion.ts:75-82`）。本次把同一核验前移到**冻结时**，按 §4.1.0 分工：

- **读取层**（`feature-track.ts` 与 D1 冻结入口）对每条 `satisfied_by` 元素算结论并填 `resolved.satisfied_by`：
  `InputBinding` 形态 → **一律**调 `readBoundInput`（它一次性核 P1 可解析、`dependencies[].sha256` 文件字节、`content_fingerprint` 解析值摘要三项；**不自行重算哈希，不与文件原始字节比对 `content_fingerprint`**）。**§4.1.0 里「只核文件字节」的例外不适用于这里**——`satisfied_by` 不可解析即拒绝冻结（第三轮 review 建议 1）；
  `ScopeEvidenceRef` 形态（带 `run_id`）→ 调 §3 问题 11 表里的同一组既有检查（含 `currentRunId` 参数语义）。
- **resolver**（`resolveExecutionScope` 末尾、`validateExecutionScope` 调用前）只读结论：任一 `ok === false` → 拒绝冻结（抛 `fail`，details 带 `detail` 原文）。

作用点：两个出生入口（§3 问题 12 的①②）与 D1 首次冻结——因为三者都经同一读取层与同一纯函数。

#### 4.1.5 下游不另加判断

`hasNoTestingObligation`（`execution-scope.ts:67-72`）与 reconcile-only（`harness-runner.ts:544-556`）沿用上述结果，不改判定逻辑。

#### 4.1.6 改动文件清单（批次 1 第一笔）

| 文件 | 改动 |
|---|---|
| `harness/scripts/utils/execution-scope.ts` | `ExecutionScopeInput.request` 加可选 `impact`；`ExecutionScope` 加只读 `request_impact`（§4.1.0）；resolve 加可选入参 `resolved?: ResolvedScopeFacts`；resolve 内新增 visual 派生、kind 级覆盖、impact 结论、`satisfied_by` 结论消费、definition-gap 分支补接（§3 问题 10 **方案 A**，已定稿）。**不引入 `fs` / `projectRoot`** |
| `harness/scripts/utils/feature-track.ts` | **读取层**：`resolveFeatureExecutionScope`（`:79-85`）在调 resolver 前算出 `ResolvedScopeFacts` 五项（fidelity 状态、impact_basis、satisfied_by、targets），与既有 `readScopeAcceptance`（`:88-96`）同位置、同范式 |
| `harness/scripts/utils/blueprint-skill-projection.ts` | `:52` 的 `proposal.request` 带上 `request_impact`（§4.1.0 第三半）——与 §4.2.7 的「提取降级判定」合并为同一笔改动 |
| `harness/scripts/utils/fidelity-shared.ts` | **参考依赖，非改动项**（只被读取层 import；确认 `loadFidelityIntentSsotState:836` / `fidelityIntentSsotPath:825` 已 export）。第七轮 review M3：不再列在「改动」列内 |
| `harness/tests/unit/execution-scope.unit.test.ts` | 新增 §4.4 验收矩阵第一组用例；`direct` 模式的 `device:impact` 自报写法（`:150`）改为带 `request.impact` 通过 |

删除清单：无（D0.1 是纯增量护栏）。
**第一笔的范围表述更正**：第一版写「只改纯函数」。按 §4.1.0，实际是「纯函数 + 同文件族的读取层各一处」；批次 1 第一笔的边界按本表为准。

### 4.2 D2 run 内范围修订（第二笔，必要时拆两笔）

#### 4.2.1 `scope_revised` 事件

在同一 run 的 `events.jsonl` 追加，走既有 `goalEvents.emit`。字段：

~~~ts
{
  type: 'scope_revised';
  revision_index: number;              // 从 1 递增
  previous_scope_fingerprint: string;  // 前一有效范围指纹（首条 = 出生指纹）
  execution_scope: ExecutionScope;     // 新范围，已过 validateExecutionScope
  revision_input: ExecutionScopeInput; // 触发它的 scope_revision_input 与来源绑定
  trigger: { phase: string; check_id: string };
  allowed_fields: readonly string[];   // = SCOPE_REVISION_FIELDS
  run_base_sha?: string;               // 仅首条含 coding/ut 的修订携带，见 §3 问题 9
}
~~~

**事实更正（需求 D2.1 已收编）**：`events.jsonl` 没有逐条哈希链，只有 `run_created` 一条带 `event_hash`（`goal-run-creation.ts:105`、`:159`）。修订事件的校验范围按需求写实：

- 能发现：乱序、中间删除、范围内容篡改、completion 之后的任何删改——靠 `previous_scope_fingerprint` 逐条链接到出生指纹、`revision_index` 连续、每条过 `validateExecutionScope` 与 D2.3 约束、并与已有阶段证据 / completion 的 `execution_scope_fingerprint` 及 `scope_revision_count` 对账；
- **不承诺**发现：completion 之前删掉最后一条修订，或篡改不进范围指纹的 `trigger` / `revision_input` 字段。

不为兑现「任意篡改可发现」新建签名或外部状态系统。不新增文件、registry、租约或 manifest 字段。

#### 4.2.2 删除清单（D2.5，逐项到文件与符号）

| # | 删除项 | 文件与符号 |
|---|---|---|
| 1 | `scope_revision_requested` 事件类型声明 | `harness/scripts/utils/goal-run-creation.ts:33-40` `interface ScopeRevisionRequested` |
| 2 | 该事件的全部读取点 | `goal-run-creation.ts:48`；`goal-phase-runtime.ts:4220`、`:4263`、`:6227`（局部 `scopeRevisionRequested`）、`:9342`（`prior` 查询） |
| 3 | 该事件的 emit | `goal-phase-runtime.ts:9344` |
| 4 | `createScopeSuccessor` 正常后继路径 | `goal-run-creation.ts:42-83` 整函数；import / 调用点 `goal-phase-runtime.ts:144`、`:4243`、`:4264`、`:4511` |
| 5 | `cleanupScopeAncestors` | `goal-phase-runtime.ts:4213-4231`（定义）、`:4254`、`:4267`（调用） |
| 6 | `onScopeHandoff` 回调 → **原位改名**为 `onScopeRevision`（一个 boundary：`'applied'`），见 §3 问题 4「注入点更正」 | `goal-phase-runtime.ts:4181`（`GoalPhaseRuntimeLaunchOptions` 字段）、`:4263`、`:4270`、`:9346`；`goal-mode-entry.ts:172`、`:271`；**测试辅助器同批改名**：`harness/tests/unit/goal-runner-testing-integrity.unit.test.ts:302`（参数声明）、`:916`、`:934`（两处转发）——第一版漏列这三处 |
| 7 | 四个 handoff 测试模式 | `harness/tests/unit/execution-scope.unit.test.ts:111`（mode 联合类型的 `successor`/`intent`/`released`/`born`）、`:297`（for 枚举，第一版写成 `:298`）、`:193-200`（`onScopeHandoff` 注入块，第一版写成 `:285-293`——那段是 `direct` 模式的复用 / 篡改反例，与本项无关）——断言按 §3 问题 4 迁移，**不删断言** |
| 8 | `goal-phase-runtime.ts:4511` 的 detached 守卫 | 需求 D2.5 已点名。该行原文 `if (executorMode === 'detached' && (!manifest.execution_scope \|\| !manifest.successor_of \|\| createScopeSuccessor(...)?.run_id !== manifest.run_id)) throw` —— 依赖被删的 `createScopeSuccessor`，后继路径删除后恒不可满足。接手门禁见 §7.2 |
| 9 | P2 §6.1–§6.3 正文 | **按 D2.5 原文不删，加冲突说明块**，见 §4.2.5。这是裁决本身，不是本 plan 的取舍 |

**3.1.0 尚未发布，没有任何宿主持有 `scope_revision_requested` 协议，不写兼容 reader，直接删。**

保留（D2.5 明文）：失败修复型 supersede（e9d4b7a3 语义，含 `backtrack_target_absent` 的手工交接指引 `buildBacktrackTargetAbsentGuidance`，`goal-phase-runtime.ts:9424`）、用户显式改需求经 correction/successor 签发新 run、creation-incomplete 修复、`--rebaseline-to` 显式重签（`:4673`）、`inheritSuccessorManifest` 与 `buildSupersedeAuditEvent` 本体。

#### 4.2.3 有效范围唯一入口

新增 `loadEffectiveExecutionScope(projectRoot, feature, runId?)`（落在 `harness/scripts/utils/goal-run-creation.ts`，与 `loadFrozenExecutionScope` 同文件，避免新增模块）：

有效范围 = 出生范围（`manifest.execution_scope`，字节不变）+ 按 `revision_index` 顺序应用的 `scope_revised` 事件。链断裂（`previous_scope_fingerprint` 对不上出生指纹或前一条）、index 重复 / 跳号、内容过不了 `validateExecutionScope` 或 D2.3 约束 → **损坏**，走既有恢复，**不回退成出生范围继续跑**。

`loadFrozenExecutionScope` 保留，但语义收窄为「读出生范围」，仅供出生 / 身份校验场合。**全部 13 个非测试消费点**逐个裁决：

| 位置 | 现状 | 处置 |
|---|---|---|
| `harness/harness-runner.ts:547`、`:549` | reconcile-only 零设备 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/assess.ts:450` | `observeFeatureState` | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/capability-resolution-entry-input.ts:229` | 阶段输入上下文 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/capability-resolution.ts:505` | `readRunBoundContracts` | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/blueprint-skill-projection.ts:37` | `designScopeRevisionChecks` | → `loadEffectiveExecutionScope`（D1 另去掉 run_id 强制，见 §6.4） |
| `harness/scripts/utils/change-unit-completion.ts:80`、`:96` | CU 预期链 / completion run 定位 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/feature-track.ts:29` | `resolveFeatureTrack` 的「有 scope 即 full」 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/upstream-verdict-gate.ts:41` | 上游裁决门 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/verify-feature-completion.ts:100` | 历史 completion 的 prior scope | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/verify-feature-completion.ts:534` | `executionScopeEvidenceIssues` 入口 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/verify-feature-completion.ts:560` | completion 写入 | → `loadEffectiveExecutionScope` |
| `harness/scripts/utils/verify-feature-completion.ts:876` | completion 验证的出生范围 | → `loadEffectiveExecutionScope`；配合 §4.2.6 的 `scope_revision_count` 对账 |
| `harness/scripts/utils/goal-run-creation.ts:43` | `createScopeSuccessor` 内 | 随 §4.2.2 #4 删除 |

**manifest 三字段保持出生值**：`manifest.execution_scope`、`manifest.phase_chain` 与 `run_created` 身份绑定不变。`goal-phase-runtime.ts:4863-4867` 现在把 `start_phase` / `end_phase` / `chain_override` 按 `manifest.execution_scope.phase_chain` 同值投影——这个「同值投影」保留，但明确它同步的是**出生**范围；执行链取自有效范围（`:4869` 的 `requestedChain`、`:5159` 的 `frozenChain` 改读有效范围）。`goal-manifest.ts:1089` 的 `execution_scope/phase_chain mismatch` 校验因此仍成立（比的是出生值对出生值）。

**凡读 `end_phase` / `phase_chain` 判断「run 是否到末段」的位置改读有效范围**（D2.2 称之为最大的隐性改动面），清单：

| 位置 | 现读 | 处置 |
|---|---|---|
| `goal-phase-runtime.ts:4869` | `manifest.execution_scope.phase_chain` → `requestedChain` | 改读有效范围 |
| **`goal-phase-runtime.ts:4878`** | `fullWorkflowChain = executionCompletionPhases(manifest.execution_scope)` | **改读有效范围**。第一版漏列。它是完整完成链，`:9780` 的 completion 生成把它当 `chain` 传下去；不改则修订后新增的阶段永远不进完成链 |
| **`goal-phase-runtime.ts:6645`** | `checkPlanAuthority({ executionScope: manifest.execution_scope, ... })`（进 coding 前的 plan 授权预检） | **改读有效范围**。第一版漏列。修订把 plan 加进链后，授权判据仍看出生范围会判错 |
| **`goal-phase-runtime.ts:9068`** | `const old = manifest.execution_scope`（修订输入的请求边界与 required 义务比较基准） | **改读有效范围**。第一版漏列。第二次修订必须与**上一条修订后**的有效范围比，与出生范围比会把合法的第二次修订判成越界 |
| **`goal-phase-runtime.ts:9780`** | completion 生成资格：`!manifest.execution_scope \|\| (completion_target === 'feature' && !manifest.execution_scope.unresolved.length)` | **改读有效范围**。第一版漏列，且这是 D2 主场景的死结——`[spec]` 出生的 run 其出生 `unresolved` 永远非空（spec 尚未定 device 义务），不改则修订后跑完全链也生成不出完成凭证 |
| `goal-phase-runtime.ts:5159` | `manifest.phase_chain` → `frozenChain` | 改读有效范围 |
| `goal-phase-runtime.ts:3569` | 提示语「frozen remaining chain」 | 改读有效范围 |
| `goal-phase-runtime.ts:3774-3775` | prompt「Frozen phase chain」/ first phase | 改读有效范围 |
| `goal-phase-runtime.ts:9093` | `goalEnd: manifest.end_phase` 传 assess | 改读有效范围末段 |
| `goal-mode-entry.ts:152`、`:155` | `executionScope?.phase_chain` / `manifest.end_phase` | 出生路径，保持出生值（不改） |
| `assess.ts:454`、`:456` | `executionCompletionPhases(scope)` / `goalEnd` | 经 §4.2.3 换入口后自动获得有效范围 |
| `assess-renderer.ts:103` | `goalEnd ??= manifest.end_phase` | 改：优先取有效范围末段，manifest 仅 legacy 兜底 |
| `goal-progress.ts:801`、`:804` | `manifest.execution_scope?.phase_chain` / `manifest.end_phase` | 改读有效范围（报告投影） |
| `goal-timeout.ts:284` | `manifest.end_phase` per-phase 超时 | 改读有效范围末段 |
| `goal-runner-phase.ts:725` `resolveEffectiveRunEnd` | 从 events 求 run_end | **不改**（它读的是 run_end 事件，不是 chain） |
| `change-unit-completion.ts:54`、`change-unit-progress-loop.ts:95` | `resolveEffectiveRunEnd` | 不改（同上） |

**当前执行链、循环游标与终点判定如何随修订更新**（第一版只列了读点；第二轮 review B3 指出重算三个启动变量根本切换不了主循环——核实属实，整段重写）：

*事实链（逐行核实）*
- 真正被主循环消费的是 `goal-phase-runtime.ts:5187-5194` 的 **`const chain`**（由 `modernBirth ? frozenChain : legacyFidelityRecovery ? [...] : frozenChain` 派生）；重赋值 `frozenChain` 之后 `chain` 不会变。
- 循环本体 `:6228` `for (let phaseIdx = chainStartIndex; phaseIdx < chain.length && ...; phaseIdx++)`，`:6229` `const phase = chain[phaseIdx]`。
- 阶段结果投影 `:9327` `outcomes.push({ phase, verdict, ... })`。
- 终点判定 `:9640-9643` `outcomes.length === chain.length && outcomes.at(-1).phase === chain.at(-1)`。

*处置*

1. `const chain`（`:5187`）改为 `let chain`；`applyScopeRevision` 成功 emit 后**在同一处**按新的有效范围整体重赋值 `chain`（`frozenChain` / `requestedChain` / `fullWorkflowChain` 三个启动变量同样重算，但它们只是派生输入，`chain` 才是执行真值）。
2. 循环游标：修订后不用 `phaseIdx + 1`，而是把 `phaseIdx` 重设为「新 `chain` 中**第一个尚未满足 §3 问题 11 复用判据**的阶段下标 − 1」（因为 `for` 头部会 `++`）。删段 / 插段 / 回退到责任阶段三种形状共用这一条，不需要各自的游标算术。
3. **终点判定不能再用数量等式**（B3 点名）。修订改链后 `chain` 长度与 `outcomes` 不再一一对应。改为**按最新有效结果覆盖 chain**：`reachedEnd = !halted && chain.every(p => latest(outcomes, p)?.verdict === 'PASS' && !latest(outcomes, p)?.advance_blocked)`，其中 `latest(outcomes, p)` = `outcomes` 中该 phase 的**最后一条**（不是 `some`）。`:9644` 的 `terminalChain` 相应改为 `chain.map(String)`（原来的 `scopeRevisionRequested` 分支随 §4.2.2 #2 一起删）。
4. **`outcomes` 保持「当前有效结果投影」，不改成第二份只追加的历史（第三轮 review 必修 1）**。第二轮写的「只追加、不改写」与既有消费者冲突，核实如下：
   - `goal-phase-runtime.ts:6677` 与 `:9509` 都在做 `outcomes = outcomes.filter(o => !invalidated.includes(String(o.phase)))` —— 回退时**主动剔除**失效 outcome，`outcomes` 从来就不是只追加的；
   - `goal-runner-phase.ts:756-772` 的 events-only 重建也只保留每个 phase 的**最新**终局结果（`lastTerminal` / `lastHalt` 两个 Map）；
   - `phase-transition-policy.ts:416-426` 用 `phases.some(p => p.halted)` / `.deferred` 判终态——留着旧的 halted / deferred outcome 会把终态压低成 HALTED / PARTIAL。
   因此：**执行历史只由 events 保存**（这才是 D2.3「两个序列」的落点），`outcomes` 继续是当前有效结果投影，`:6677` / `:9509` 的 filter **保留不动**；修订后责任阶段重跑时，同一 phase 的新结果按第 3 条的 `latest` 取最后一条。`:9327` 的 push 一行不动。
   （B3 的另外三项——`chain` 重赋值、游标重建、`currentRunId` 透传——第三轮确认方向正确，不重做。）
5. resume / 重入：`chain` 与游标经同一 `loadEffectiveExecutionScope` + 第 2 步的同一取法重建（**复用既有事件恢复逻辑**，不是只替换三个启动变量），**不从 manifest 重算**——这是「不回退成出生范围继续跑」的落点。

**当前 run 证据例外必须贯穿全部运行中消费点（B3 后半）**。§3 问题 11 的 `currentRunId` 参数只接在修订写入处是不够的——核实：`scope-replan.ts:201-205` 的 `checkPlanAuthority` 在**进 coding 前**（`goal-phase-runtime.ts:6645`）再次调用 `executionScopeEvidenceIssues`，不带当前 run 上下文；其终局检查在 `verify-feature-completion.ts:75-81`。于是「同 run 刚闭环的 plan 被复用」会在进 coding 时被判 `live_drift` 而回 replan。
处置：`checkPlanAuthority` 的入参加 `currentRunId?: string`，由 `:6645` 的调用方传 `manifest.run_id`，透传给 `executionScopeEvidenceIssues`。**凡运行中（同一 run 未封卷）调用该函数的位置一律传当前 run 身份；历史来源（`ref.run_id !== currentRunId`）的终局检查一行不放宽。** 批次 1 实施前先 `grep -n "executionScopeEvidenceIssues" harness --include=*.ts | grep -v tests/` 取全量调用点逐个裁决，结果写进实施记录。

完成投影、coding 授权（`:6645`）与后续修订比较（`:9068`）**同批消费同一个有效范围变量**，不得任何一处继续读 `manifest.execution_scope`（除 §4.2.3 明列的「出生值」场合）。

#### 4.2.4 允许的修订（D2.3）

可改字段沿用 `SCOPE_REVISION_FIELDS`（`goal-manifest.ts:751`）：`execution_scope`、`phase_chain`、`start_phase`、`end_phase`、`chain_override`。`requested_results`、`completion_target`、requirement、预算、pin、授权上下文、fidelity **不可改**（现有约束原样保留，`goal-run-creation.ts:60` 的 request boundary 校验迁到修订校验里）。

义务允许的变化：`unknown → required / not_applicable`；**`not_applicable → required`**；新增义务；补 `satisfied_by`；**撤销已失效的 `satisfied_by`**。
**不得删除或降级 required 义务** —— 沿用 `designScopeRevisionChecks` 现有的 BLOCKER（`blueprint-skill-projection.ts:56-58`），把该判定提取为共用函数供 runtime 的修订校验调用（同一把尺，不复制谓词）。

执行历史与当前责任计划是两个序列，对账见 §3 问题 11。

阶段证据引用支持两种载体，共用同一有效性检查（`integrityOk` / freshness / aggregate 指纹）：
- run 载体：现有 `ScopeEvidenceRef { phase, run_id, evidence_manifest_aggregate }`（`execution-scope.ts:10-14`）；
- feature 载体（D1 无 run 路径）：`{ phase, feature_scope: true, evidence_manifest_aggregate }`，由 §6 交付。
**不允许轻量路径伪造 run_id 来满足现有引用形状。**

**类型判别式必须同批改**（需求 §8 未点名、但结构上强制）：`EvidenceOrInputRef` 是 `InputBinding | ScopeEvidenceRef` 的裸联合。feature 载体没有 `run_id`，凡用 `'run_id' in ref` 作**正向识别证据引用**的位置都会把它误判为 `InputBinding`。逐处核实后分两类处置：

| 位置 | 现判别式 | 处置 |
|---|---|---|
| `execution-scope.ts:77`（`isExecutionSourceBasis`） | `satisfied_by?.some(proof => 'run_id' in proof)` | **改** `'evidence_manifest_aggregate' in proof` |
| `execution-scope.ts:113`（control_edges 校验） | `'run_id' in ref && ref.phase === edge.before` | **改**同上 |
| `execution-scope.ts:194`（控制前置满足） | 同上 | **改**同上 |
| `execution-scope.ts:207`（`reused_phases` 收集） | `.filter((ref): ref is ScopeEvidenceRef => 'run_id' in ref)` | **改**同上 |
| `capability-resolution-entry-input.ts:240` | `.filter(ref => 'input_id' in ref)` | **不改**。它要筛的就是 `InputBinding`，`'input_id' in ref` 已是 `InputBinding` 的正向判别式，feature 载体同样没有 `input_id`，行为正确。（第一版把它列进「六处一次改完」是错的——改成筛证据引用会让阶段输入上下文丢掉全部输入绑定。行号也应是 `:240` 而非 `:239`） |
| `capability-resolution.ts:506` | `.filter((ref): ref is InputBinding => 'input_id' in ref)` | **不改**，同上 |

即：**四处改、两处保持**。批次 1 引入 `ScopeEvidenceRef` 消费点时不得新增基于 `'run_id' in ref` 的判别；批次 3 交付 feature 载体时把上表四处一次改完。

是否修订由新事实决定，不由 PASS / FAIL 决定：测试失败、设备离线、manual、report 失败本身不产生修订（现有规则保留，见 `execution-scope.unit.test.ts` 的 `testing-fail` 模式）；同一阶段既失败又暴露归属 spec / plan 的新事实时，修订合法，失败事实照常记录。

#### 4.2.5 OpenSpec delta（批次 1）

**每批唯一 delta 责任（交办 §0.5「每批次一个 OpenSpec change delta」）**：

| 批次 | 唯一负责的 change | 该批必须一并处置的冲突条款 |
|---|---|---|
| 1 | `obligation-execution-scope` | 本批表格三行 + 下方「与裁决直接冲突的活动规范」表的 ①②③ |
| 2 | `obligation-execution-scope`（续，D0.3 的 reconcile-assessment 面） | 见 §5.3（**已按本条收窄为一个 change**） |
| 3 | `dynamic-workflow-closure-migration` | 见 §6.8（`composable-workflow-foundation` 与已部署基线的同句禁令按 D2.5 原文随本批修订，属**同一条禁令的两个承载处**，不构成第二个 delta 责任） |

**与裁决直接冲突的活动规范（第一轮 review 必修 5：第一版只删了「不新建 execution-scope.json」一句，其余条款仍与 D1/D2 并存）**。逐条核实后的完整清单，两个承载处内容逐字相同：

| # | 条款（`openspec/changes/composable-workflow-foundation/specs/runtime-policy/spec.md` / 已部署 `openspec/specs/runtime-policy/spec.md`） | 冲突 | 处置（批次 1 delta） |
|---|---|---|---|
| ① | `:104` / `:160`「完整 Feature 交付在首阶段前 MUST 经现有 goal-mode-entry prepare/attended attach 或 detached 入口建立真实 run；manifest.execution_scope MUST 是运行权威」 | 直接否定 D1（交互完整交付不强制 run、feature 记录作第二载体） | 改写为「完整 Feature 交付 MUST 有**唯一**的冻结范围权威；权威按 P8 D1.3 的优先级四行选取（本次关联的 run → feature 冻结记录）。**首次执行任一 feature phase 且两者皆无时，MUST 按 D1.2 由机器从候选冻结一次**（合法首次冻结）；**权威缺失或损坏**（有阶段报告却无任一权威，或 feature 记录声明已转入某 run 而该 run 不存在 / 损坏）时 MUST 报错，MUST NOT 回落候选或选边」。**第二轮 review M3 更正**：第一版只写「两者皆无 MUST 报错」，把 D1.2 的合法首次冻结也一并封死了 |
| ② | `:106` / `:162`「范围变更 MUST 回责任方，沿既有 correction/backtrack/successor 重新签发；**前驱封卷、释放 owner/锁后**由同一 runtime 创建后继」 | 直接否定 D2（不封卷、不释放锁、不生成后继） | 改写为「合法范围修订 MUST 在同一 run 内追加 `scope_revised` 完成，MUST NOT 封卷或释放 owner/锁；successor 只保留给失败修复型 supersede、用户显式改需求与 creation-incomplete 修复」 |
| ③ | Scenario `Spec discovers a new device obligation`（`:118-120` / `:174-176`）「**先封卷交接再创建绑定新范围的后继**」 | 同② | 整条 Scenario 改为 run 内语义：「THEN 同一 run 追加 `scope_revised` 并继续派发，MUST NOT 产生第二个 run_created」 |
| ③b | **Scenario `Resume ignores changed workflow defaults`（`:114-116` / `:170-172`）的 THEN「需要变更时经责任方重签后继」** | 同②（第一版漏列，第二轮 review M3 点名；已逐行核实两处逐字相同） | THEN 改为「恢复 MUST 使用**有效范围**（出生 + 已应用 `scope_revised`），MUST NOT 重算候选；需要变更时由责任方在同一 run 内追加合法修订」 |
| ④ | `:108` / `:164`「MUST NOT 新建 execution-scope.json、第二 run 目录、场外状态或平行完成协议」 | 仅第一项与 D1.1 冲突 | **按 D2.5 原文随批次 3 delta 处置**（§6.8），只删「execution-scope.json」一项，其余三项原样保留 |

①②③③b 在批次 1 处置（它们描述的正是 D2 改掉的机制，不能等到批次 3）；④在批次 3 处置（它对应 D1 的载体，批次 3 才交付）。
**每批唯一 delta 的边界写实**：一批只有**一个 change 承载行为 delta**（批次 1/2 = `obligation-execution-scope`，批次 3 = `dynamic-workflow-closure-migration`）；`composable-workflow-foundation` 与已部署基线 `openspec/specs/runtime-policy/spec.md` 承载的是**同一批被改判条款的旧载体**，随该批同步修订，不引入第二份行为 delta。
**已部署基线 `openspec/specs/runtime-policy/spec.md` 的同步不是条件句**：批次 1 与批次 3 各自的 change delta 落地后，按 openspec 既有流程把对应条款同步到已部署基线；第一版的「若 openspec 工具要求，同批同步」删除——同步是必做项，不是工具的可选行为。

| 文件 | 改动 |
|---|---|
| `openspec/changes/obligation-execution-scope/specs/goal-runner/spec.md` | **整条改写** Requirement `Scope successors use existing owner release and birth mechanisms` → `Scope revisions are appended inside the same run`。正文改为：phase 边界追加一条 `scope_revised`，保持请求边界与 required 义务，**不封卷、不释放 owner/锁、不生成后继**；有效范围 = 出生 + 按 index 应用；链断裂即损坏走既有恢复；重入不重复应用。三个既有 Scenario 全改为 run 内语义（`Spec reveals a device obligation`、`Handoff is interrupted` → `Revision is interrupted`、`Coding discovers a design gap`），新增 `Baseline is frozen by the first coding-bearing revision`。Enforcement 路径改为 `harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/goal-run-creation.ts`、`harness/scripts/utils/goal-runner-phase.ts`、`harness/scripts/utils/goal-manifest.ts`、`harness/scripts/utils/execution-scope.ts`（`goal-run-control.ts` 移除——修订路径不碰 run-control）。**不得保留后继语义与本文件并存。** |
| `openspec/changes/obligation-execution-scope/specs/runtime-policy/spec.md` | 在 Requirement `One pure scope resolver derives obligations and stable order` 内补 D0.1 护栏：证据类义务的候选自报 applicability MUST NOT be trusted；来源为验收分层与 fidelity SSOT；feature 终点的 device 裁剪 MUST 另有有来源的 impact 判断；`satisfied_by` MUST 在冻结时重解析。补两条 Scenario（洗绿被重算、impact 缺失时 testing 不裁） |
| `openspec/changes/composable-workflow-foundation/specs/runtime-policy/spec.md` | 上表 ①②③ 的改写（`:104`、`:106`、`:118-120`）。批次 1 的唯一 delta 责任在 `obligation-execution-scope`，本文件按「同一条冲突条款的另一承载处」同批修订，不单列为第二个 delta |
| `openspec/specs/runtime-policy/spec.md` | 同上（`:160`、`:162` 及对应 Scenario），已部署基线同步，非条件句 |
| `openspec/changes/obligation-execution-scope/tasks.md` | 追加「## 4. P8 批次 1（run 内修订与 resolver 护栏）」小节与验收记录 |
| `.cursor/plans/动态工作流_P2_...b7e4c9a2.plan.md` | §6.1 标题下加冲突说明块：「本节的正常后继交接已被 P8（用户裁决 2026-09-14）整体改判为 run 内追加修订，正文保留仅作历史；实施口径以 P8 §4.2 为准。」§5.1 加一句指向 P8 §6 的轻量路径。**只加说明，不改其它正文，不动 todos。** |
| `.cursor/plans/动态工作流_总纲_...91c4e7a2.plan.md` | §7（`:195`）「不新增 execution-scope.json 或第二 run 目录」一句加冲突说明并指向 P8 §6.1（该句按 D1.1 裁决删除的部分只删「不新增 execution-scope.json」，「不新增第二 run 目录」保留且被 D2 强化） |
| `.cursor/plans/动态工作流_P7_...a3d9b5f7.plan.md` | §4 兼容矩阵与 §6 场景 5 引用 successor 处加冲突说明指向 P8 |

#### 4.2.6 完成判定（D2.6）

`verifyFeatureCompletion` 用**有效范围**计算 `expectedChain`（经 `executionCompletionPhases(有效范围)`）。completion 记录：
`execution_scope_fingerprint` = 有效范围指纹；新增 `scope_revision_count`（见 §3 问题 5）。
completion 写入后，修订数量、有效范围指纹或已绑定证据与 completion 记录失配 → INVALID（`verify-feature-completion.ts:876-882` 分支扩展）。其他改动（含不参与指纹的 `trigger` / `revision_input`）按 §4.2.1 已声明的校验边界处理，不另造签名体系。

#### 4.2.7 改动文件清单（批次 1 第二笔）

| 文件 | 改动 |
|---|---|
| `harness/scripts/utils/goal-run-creation.ts` | 删 `ScopeRevisionRequested` 与 `createScopeSuccessor`；新增 `loadEffectiveExecutionScope`、`applyScopeRevisions`、`resolveRunBaseline` |
| `harness/scripts/goal-phase-runtime.ts` | 删 §4.2.2 #2/#3/#5/#6 的符号；`:9341` 分支改为 run 内 `applyScopeRevision` + 继续派发；`:4211-4270` 的后继循环整体移除；`:7238` 基线注入改用 `resolveRunBaseline`；§4.2.3 末段表的六处链读取改有效范围 |
| `harness/scripts/goal-mode-entry.ts` | `onScopeHandoff` **改名**为 `onScopeRevision`（`:172`、`:271`）——与 §4.2.2 #6、§3 问题 4「注入点更正」一致，不是纯删除 |
| `harness/tests/unit/goal-runner-testing-integrity.unit.test.ts:302`、`:916`、`:934` | 测试辅助器的参数声明与两处转发同批改名为 `onScopeRevision`（第七轮 review M3 补列） |
| `harness/scripts/utils/scope-replan.ts:194-205` | `checkPlanAuthority` 入参加 `currentRunId?`，透传给 `executionScopeEvidenceIssues`（§4.2.3 末段的同 run 证据例外；第七轮 review M3 补列——调用在 `:204`，此前只写了 `goal-phase-runtime.ts:6645` 的调用方） |
| `harness/scripts/utils/goal-run-baseline.ts` | `:29-35` 改用 `resolveRunBaseline` |
| `harness/scripts/utils/goal-manifest.ts` | `:822-823` 的 `scopeRevision` 重签路径收窄为 supersede 专用（不再服务正常后继）；`SCOPE_REVISION_FIELDS` 保留 |
| `harness/scripts/utils/blueprint-skill-projection.ts` | 提取「不得删除 / 降级 required」判定为共用函数供 runtime 复用 |
| `harness/scripts/utils/assess.ts`、`assess-renderer.ts`、`capability-resolution.ts`、`capability-resolution-entry-input.ts`、`change-unit-completion.ts`、`feature-track.ts`、`upstream-verdict-gate.ts`、`verify-feature-completion.ts`、`goal-progress.ts`、`goal-timeout.ts`、`harness-runner.ts`、`ut-target-resolver.ts` | §4.2.3 的入口替换与文案修订 |
| `harness/tests/unit/execution-scope.unit.test.ts` | §3 问题 4 的模式与断言改写 |
| `docs/concepts/skill-contracts.md`（「P2 运行接线」节）、`docs/concepts/phase-transition-policy.md` | 后继交接段改写为 run 内修订 |

### 4.3 批次 1 测试改写清单

| 测试 | 改动 |
|---|---|
| `harness/tests/unit/execution-scope.unit.test.ts:111` mode 联合类型 | `successor`/`intent`/`released`/`born` → `revision`/`revision-cut`/`revision-precut` |
| `harness/tests/unit/execution-scope.unit.test.ts:297` for 枚举 | 同步 |
| `harness/tests/unit/execution-scope.unit.test.ts:232-248` else 分支断言 | 按 §3 问题 4 表逐条改写（11 条断言全部保留语义；design-gap 的「源阶段恰一次」按 run 内事实改判为两次） |
| `harness/tests/unit/execution-scope.unit.test.ts:193-200` 的 `onScopeHandoff` 注入块 | 改用 `onHarnessSummary`（修订前中断，`goal-runner-testing-integrity.unit.test.ts:531`）与**改名后的 `onScopeRevision('applied')`**（修订后中断，runtime 侧 emit 之后）注入。**不用 `afterHarnessPass`**——它在 `:730` 于 fake harness 返回前触发，早于 runtime 修订，覆盖不了「写入后立即中断」 |
| `harness/tests/unit/goal-runner-testing-integrity.unit.test.ts:302`、`:916`、`:934` | 辅助器 `onScopeHandoff` 参数声明与两处转发同批改名为 `onScopeRevision`（第一版漏列） |
| `harness/tests/unit/execution-scope.unit.test.ts:150` 的 `device:impact` 自报 | 改为 `request.impact`；原自报写法**保留在另一条新用例中**作为「自报不影响结果」的反例。（第八轮 review M3：本行起的「同文件」曾因上一行插入了另一个文件而含混，改为逐行点名） |
| `harness/tests/unit/execution-scope.unit.test.ts:143` 的手算指纹 | **批次 1 即改为经 `resolveCapabilityInputs` 构造绑定，指纹与生产同源**（调度者裁决 2026-09-15 第二条）。原写法 `sha256(stableStringify(YAML.parse(原文)))` 与 `resolveArtifact`（`capability-resolution.ts:233-243`）对 `acceptance@1` / `contracts@1` / `use-cases@1` 返回的 **SpecLoader 解析值**是两个口径，过不了 §4.1.4 的 `readBoundInput` 重解析。§4.1.4 **不放宽**——夹具冒充生产绑定正是仓库明令禁止的模式，这次是它被 D0.1 护栏正确抓住。夹具里**所有**手拼 InputBinding（`design:cu` 的 contracts 绑定、`request.impact.basis`、design-gap 与 revision 场景的 fresh 绑定）统一改走 `resolveCapabilityInputs` 或其返回的绑定，**不留第二种造法** |
| `harness/tests/unit/execution-scope.unit.test.ts` 的 `testing-fail` 模式 | 保留，断言从「无 `scope_revision_requested`」改为「无 `scope_revised`」 |
| `harness/tests/unit/execution-scope.unit.test.ts` 的 `design-gap` 模式 | 保留，断言改 run 内（同 run 修订为 `[plan, coding, review, ut]`，coding 失败记录保留） |

### 4.4 批次 1 验收矩阵

D0.1 验收（需求 §3 D0.1 末段逐行）：

| 需求验收行 | 用例名（`execution-scope.unit.test.ts`） |
|---|---|
| D0.2 正常生成的零设备候选可冻结且裁掉 testing | `D0.1 generated zero-device candidate freezes and prunes testing`（批次 2 补生成器后启用；批次 1 先用等价手造候选） |
| 候选手写 `device-evidence: not_applicable` 但验收含 device 层 → 重算 required，testing 保留 | `D0.1 self-reported device not_applicable is recomputed from acceptance layering` |
| 候选手写 `visual-evidence: not_applicable` 但 fidelity 为 pixel_1to1 → 重算 required，缺视觉验收进 unresolved | `D0.1 self-reported visual not_applicable is recomputed from fidelity ssot` |
| fidelity SSOT 缺失且请求无视觉要求 → visual not_applicable，不强迫补文件 | `D0.1 missing fidelity ssot without visual request stays not_applicable` |
| SSOT 损坏或请求含视觉要求而未定档 → unknown，testing 不裁 | `D0.1 corrupt or undecided fidelity keeps testing in scope` |
| 验收全 unit 但无 impact → unknown，testing 保留 | `D0.1 missing impact keeps device unknown` |
| impact=true → testing required | `D0.1 behavior-change impact requires device evidence` |
| impact.basis 指向项目外 / 不存在 / 与本次范围无关 → 拒绝 | `D0.1 impact basis outside project or unrelated is rejected`（三个子断言） |
| 仅 review 的候选带指向审查目标的 impact → 通过 | `D0.1 review-only request with scoped impact is accepted`。**加回归护栏**（§5.1.1a）：`resolvedInputs.values['code'].state === 'resolved'`、`dependencies` 覆盖预期代码目标、capability assurance 非 `blocked` |
| **仅 UT** 的候选带指向测试目标的 impact → 通过（需求 D0.1「仅 review／UT」的另一半；第七轮 review M4 补列） | `D0.1 ut-only request with scoped impact is accepted`。同款回归护栏——UT 的 `code` 是 `base` / `on_missing: fail`（`skills/feature/business-ut/contract.yaml:14`），目标被误删会直接 blocked，这条用例是 §5.1.1a 修法的主要证伪面 |
| `direct` 模式改为带 impact 通过，原 `device:impact` 自报不再影响结果 | `real prepare CLI / bridge scope lifecycle: direct` + `D0.1 self-report has no effect on the result` |
| `satisfied_by` 冻结时核验 | `D0.1 satisfied_by is re-resolved at freeze time`（正例 + 指纹漂移反例） |
| **目标集合为空 (a)**：含 implementation 义务但 `contracts.files` 为空且 implementation 无写集 basis → 拒绝，文案指向范围声明 | `D0.1 empty write set with an implementation duty is rejected as a scope declaration gap`（断言错误文案含「责任方 plan」，**不**含「与本次范围无关」） |
| **目标集合为空 (b)**：无 implementation 义务且无 review / UT 目标 → device `unknown`、reason「影响依据无可核验范围」、testing 不裁 | `D0.1 unverifiable impact scope keeps device unknown without pruning testing` |
| **plan 阶段修订预算不丢既有验收派生**（§4.1.0 R3） | `D0.1 plan-phase revision keeps unit/device from the existing acceptance`——已有有效验收的 feature 在 plan 阶段产出新 contracts 触发 `designScopeRevisionChecks`，断言 `unit-evidence` / `device-evidence` **不**变成 unknown、`design_scope_facts` **不**报 BLOCKER |
| **验收绑定失效时不被吞掉**（§4.1.0 必修 1） | `D0.1 stale acceptance binding surfaces instead of degrading to unknown`——proposal 里的 acceptance 绑定指纹漂移后，修订预算以 `input binding stale` 失败并回 scope owner，**不**静默落 unknown |
| **impact.basis 用代码类绑定可通过**（§4.1.0 必修 2） | `D0.1 code-file impact basis is verified by dependencies`——`request.impact.basis` 指向 `derive.codebase` 绑定时按字节核验通过；同一绑定出现在 `satisfied_by` 时仍必须重解析（反例） |

D2 验收（需求 §5 D2.8 逐行）：

| 需求验收行 | 用例名 |
|---|---|
| 出生链 [spec]，spec 产出 device AC → 同一 run 继续到 testing；只有一个 run_created、无 successor；manifest.execution_scope 字节不变；completion VALID 且 expectedChain 含 testing | `real prepare CLI / bridge scope lifecycle: revision` |
| coding 已有一次未 PASS 执行后报出归属 plan 的新接口 → 同 run 修订为 `[plan, coding, review, ut]`；失败记录保留；预算连续；plan 后 coding 重跑 | `real prepare CLI / bridge scope lifecycle: design-gap` |
| coding 期间发现用户可见行为变化（原 device not_applicable）→ 修订为 required，testing 进链尾，不报降级 BLOCKER | `D2 not_applicable to required revision is accepted`；并加 `D2 sourced impact correction flips device from not_applicable to required`（出生 `impact=false` → 带新 basis 的 `impact=true` 修订 → device required）与反例 `D2 impact correction without new sourced basis is rejected`（§4.1.0 B2 段） |
| 修订后责任阶段被重新派发、终点判定不用数量等式 | `D2 revised chain re-dispatches the responsible phase and still reaches the end`。**断言分两处放**（第五轮 review 必修 2）：① **执行历史断言放 events** —— coding 的两次 `phase_start`/`agent_invoke_start` 与首次 FAIL 的 `phase_verdict` 都在 `events.jsonl` 里；② **`outcomes` 只断言最新有效结果覆盖当前链**（每个 chain phase 的 `latest` 为 PASS），run 仍能 COMPLETED。不得断言「`outcomes` 含两条 coding」——`goal-runner-phase.ts:756-772` 事件恢复按阶段只取最新终局结果，`goal-phase-runtime.ts:9509` 也会过滤失效结果，那条断言与 §4.2.3 第 4 条的「当前有效结果投影」直接冲突 |
| 同 run 刚闭环的 plan 证据被 coding 授权复用而不被判 live_drift | `D2 same-run closed plan evidence passes the coding authority gate`（锁 `checkPlanAuthority` 的 `currentRunId` 透传） |
| 被复用的证据因新事实失效 → satisfied_by 撤销，对应阶段回链重跑 | `D2 invalidated satisfied_by returns its phase to the chain` |
| 修订试图删除或降级 required → BLOCKER，不应用，run 不封卷为成功 | `D2 revision cannot delete or downgrade a required obligation` |
| [spec] 出生的 run 修订后进入 coding → 基线随该条修订冻结一次且不可改；后续 diff 基线一致；无 successor | `D2 baseline is frozen once by the first coding-bearing revision`（含「第二条修订再携带基线 → 损坏」反例） |
| 历史 PASS 阶段证据因新事实失效 → 重新进链；证据仍有效的 PASS 阶段不重跑 | `D2 stale passed phase re-enters the chain, fresh one does not` |
| completion 之后修订数量 / 有效范围指纹 / 已绑定证据失配 → INVALID | `D2 completion mismatch after revision is INVALID`（三个子断言） |
| completion 之前删除中间一条或改动范围内容 → 链断裂即损坏 | `D2 broken revision chain is corruption, not a fallback to birth scope` |
| testing **FAIL** → 无修订事件，范围不变 | `real prepare CLI / bridge scope lifecycle: testing-fail`（现有用例保留；`execution-scope.unit.test.ts:173` 注入的就是普通 BLOCKER FAIL） |
| **设备离线**、**manual** → 无修订事件，范围不变（第七轮 review M4：现有夹具只注入普通 FAIL，覆盖不了另两种输入） | `D2 device offline produces no revision` 与 `D2 manual verdict produces no revision`——各自注入对应的 `failure_kind` / verdict，断言 events 无 `scope_revised` 且有效范围指纹不变 |
| 修订事件写入后立即中断再重入 → 不重复应用，下一阶段只派发一次 | `real prepare CLI / bridge scope lifecycle: revision-cut` |
| 中断于修订校验前 → 重入后回到 phase 边界再校验一次，仍只有一条修订 | `real prepare CLI / bridge scope lifecycle: revision-precut` |
| D1 路径同场景 | 批次 3 交付，见 §6.9 |

## 5. 批次 2：D0.3 + D0.2

### 5.1 D0.3 coding / review / correction 的生产触发（第一笔）

#### 5.1.1 触发条件

**只有**经既有根因归属判定 `repair_owner` 为 spec / plan 的发现才产出 `scope_revision_input`。写集越界（`diff_within_scope`、contract-reference-closure 未授权引用）大多是 coding 改错文件或误引依赖，留在 coding 修复。

产出形状：新增 `design-decision`（review 归因 spec 时为 `acceptance-definition`）required 事实，`basis` 为触发的 diff / 文件绑定，`requested_phases = [责任阶段, 剩余未执行阶段]`，其余义务原样继承。D2 在同一 run 内修订，plan / spec 执行后回 coding。**plan 对是否扩展契约仍独立裁决，修订提议不预设结论。**

#### 5.1.1a 触发文件绑定是「修订时核验的历史来源」（第五轮 review 阻断 1）

**缺口**：`basis` 绑的是触发时刻那个文件的**当前字节**。正常的「plan 拒绝扩展 → coding 撤回误改」走完之后，文件字节必然与绑定里的摘要不同，于是 completion 被自己的修复动作判死。逐行核实：

| 事实 | 位置 |
|---|---|
| 历史代码来源豁免**不含** `design-decision` / `acceptance-definition` | `execution-scope.ts:78` 的 kinds 白名单只有 `implementation / code-review / unit-evidence / device-evidence / visual-evidence` |
| 未豁免的 basis 逐条比当前字节 | `verify-feature-completion.ts:70-71`：`if (basis && isExecutionSourceBasis(...)) continue;` 否则 `sha256File(dep.path) !== dep.sha256` → `input binding stale` |
| 该 issue 进完成阻断 | `verify-feature-completion.ts:244`（`collectCleanPassIssues` 把 `executionScopeEvidenceIssues` 全量纳入） |
| runtime 补阶段 `satisfied_by` 时**保留原 basis**，消不掉这个问题 | `goal-phase-runtime.ts:9077-9081`（`{ ...(existing ?? obligation), satisfied_by: [...] }`） |

**处置（最小面，复用既有机制，不整体放宽）**：把 `'design-decision'` 与 `'acceptance-definition'` 加进 `execution-scope.ts:78` 的 kinds 白名单。适用范围由该函数**已有的三个前置条件**自然收紧，不额外加判据：

1. `dependency.role === 'derive'`（`:76`）—— 只豁免「触发时观察到的代码文件」；`contracts@1` 等 artifact 类绑定仍逐字节核，不受影响；
2. `isInsideProjectRoot`（`:76`）——项目外一律不豁免；
3. `scope.phase_chain.includes(obligation.owner_phase) || satisfied_by 有 run 证据`（`:77`）—— 责任阶段要么还在链上待执行，要么已有阶段闭环证据承接。

即：**后续验证由责任阶段（plan/spec）的闭环证据承接**，与 `implementation` 等既有输出义务同一取向（`:74` 的注释原话：Birth-only code observations; current outputs remain bound by phase evidence）。**不放宽 `satisfied_by`**（§4.1.0 的 `verifySatisfiedByBinding` 一律重解析），**不放宽其它 kind**。

**但只扩白名单不够：触发文件还从第二条路进了责任阶段的当前证据（第六轮 review 阻断 1）。** 第六轮写的单点修法**本身是回归**（第七轮 review B1），两处一起更正。

**第二条链（事实成立，保留）**：

| # | 事实 | 位置 |
|---|---|---|
| ① | `sourcePaths` 从**全部** `obligation.basis`（`:234` 的 `bindings`）收 `role === 'derive' && exists` 的文件 | `capability-resolution-entry-input.ts:242` |
| ② | 同一份 `sourcePaths` 既作 `factsContext.source_paths`，又作 `testTargets` 返回 | `capability-resolution-entry-input.ts:251-254`、`:287` |
| ③ | 多个阶段契约消费 `derive.codebase`，有 `inputContext` + `testTargets` 时按目标生成**当前文件依赖** | `capability-resolution.ts:278-289` |
| ④ | `factsContext.source_paths` 逐条进证据 inputs | `phase-evidence-manifest.ts:437` |
| ⑤ | capability 依赖经收集进 `extraInputs` | `phase-closure-finalizer.ts:195-202` → `capabilityResolutionEvidenceInputs:162` → `:305-308` |
| ⑥ | manifest 的 inputs/outputs 逐条比当前字节 → `stale` → 进 completion 的 `lineage_fresh` 阻断 | `phase-evidence-manifest.ts:903-909`；`verify-feature-completion.ts:358-371` |

**事实更正：源码进证据**不止**两个入口（第七轮 review M1）。** 第六轮写的「只有两个入口且都由 `sourcePaths` 喂 → 故单点修改充分」这条推理**不成立**。逐行核实后的完整入口表：

| 入口 | 位置 | 携带什么 | 本 plan 处置 |
|---|---|---|---|
| E1 `factsContext.source_paths` | `phase-evidence-manifest.ts:437` | 由 `sourcePaths` 喂 | **只剔除修订历史触发依据**，见下方 R-目标收集 |
| E2 capability 解析依赖 | `phase-closure-finalizer.ts:195-202` → `:305-308` | capability 解析产物里的依赖，**其中** `derive.codebase` / `derive.test-targets` 那部分由 `testTargets`（= `sourcePaths`）决定 | 随 E1 的 R-目标收集一起变（**同上游的那部分**）；其余依赖不动 |
| E3 `resolvedInputs.values` 的绑定 / 解析尝试依赖 | `phase-evidence-manifest.ts:426-431` | 每个已解析输入的 `binding.dependencies`（`capability-resolution.ts:598-601` 由该输入的全部 attempts 汇总）。**与 E2 大面积重叠**：`phase-closure-finalizer.ts:195-202` 遍历 capability 的**全部** `attempts.dependencies`，**不排除 artifact 类**，而 `skills/feature/plan/contract.yaml:7-14` 正把 `acceptance` / `contracts` 列为 capability 输入——因此**代码依赖与 artifact 依赖都可能同时经 E2 与 E3 登记**。（第九轮 review M1：第一版写「artifact 类只走 E3」不符事实） | **不追加任何全局豁免**——真实设计输入与当前代码目标都必须继续绑定；只有 R-目标收集剔除的那两个 kind 不再进入上游 |
| E4 facts 基线依赖 | `phase-evidence-manifest.ts:438` | 既有 facts 声明与建立阶段证据（`capability-resolution-entry-input.ts:266`） | **不动** |
| E5 PASS check 的 `affected_files` | `phase-closure-finalizer.ts:238-242` → `:308` | 本阶段 script-report 里 PASS check 声明的受影响文件 | **不动**——被检查对象仍应绑定 |

即：**入口存在 ≠ 都该豁免**。本 plan 只改 R-目标收集这一处上游（修订历史触发依据的进入路径）；**E3/E4/E5 的登记机制一行不改**——但要写实：E2/E3 的依赖集合本就随上游解析结果变化，剔除两个 kind 后它们携带的路径自然少掉那部分，这是上游变化的传导，不是对它们额外开的豁免。真实设计输入、被检查对象与输出义务的验证一行不放宽。
**因此「撤回后仍判 stale」有一类是正确行为**：当触发文件**同时**是责任阶段的真实当前输入（例如它本来就在 plan 的 `codebase` 目标里）时，它会继续经 E2/E3 登记，撤回改变字节 → `phase-evidence-manifest.ts:903-909` 判 stale → 责任阶段重新闭环。**这不是缺陷，是证据机制应有的反应**；§5.4 的闭环用例须把「触发文件不是当前输入」与「触发文件同时是当前输入」两种形态分开断言，不得要求后者也免于 stale。
两条闭环用例里这几个入口实际携带的东西：E3 带 `acceptance@1` / `contracts@1` 等 artifact 绑定的依赖（plan/spec 修复后它们**变化**，正是应当触发重新闭环的部分）；E4 带 facts 基线声明的来源文件；E5 带本阶段 PASS check 声明的受影响文件（plan 阶段即其产出的 `contracts.yaml` 等）。用例断言因此必须区分「历史触发摘要不再阻断」与「当前正式输入 / 输出仍被绑定」。

**修法（第七轮 review B1：两条规则，不能合并）**

第六轮把 `isExecutionSourceBasis` 整体套到 `:242` 的 `sourcePaths` 收集上，是直接回归。核实：该函数的 kind 白名单（`execution-scope.ts:78`）本就含 `implementation / code-review / unit-evidence` —— **正是 review / UT 当前要检查的代码目标**；它也不限阶段。合法范围里设计与验收绑定都来自 artifact，代码来源**只**挂在这几类的 derive basis 上。整体套用的后果逐行核实：

| 链条 | 位置 |
|---|---|
| `testTargets = sourcePaths` 被清空 | `capability-resolution-entry-input.ts:287` |
| `derive.codebase` 无目标 → `absent` | `capability-resolution.ts:278-280` |
| UT 的 `code` 是 `input_role: base, on_missing: fail` | `skills/feature/business-ut/contract.yaml:7`、`:14` |
| review 的 `code` 同样 base / fail | `skills/feature/code-review/contract.yaml:7`、`:15` |
| absent + `on_missing === 'fail'` → `blocked` | `capability-resolution.ts:678-682` |
| blocked assurance 不得提交 PASS closure | `phase-closure-finalizer.ts:553-554` |

（plan 的 `capability_plan_codebase` 是 `enhancement` / `prune`，只能证明 plan 自己不缺输入，证明不了 UT / review。）

因此拆成**两条互不相同的规则**：

| 规则 | 作用面 | 判据 |
|---|---|---|
| R-摘要豁免 | `expectedBindings`（`:239`）与 `executionScopeEvidenceIssues`（`verify-feature-completion.ts:70`）的**字节比对** | `isExecutionSourceBasis` **原样**，含全部七个 kind（含本 plan 新增的两个）。**这条不改** |
| R-目标收集 | `sourcePaths`（`:242`）→ `factsContext.source_paths` 与 `testTargets` | **只跳过本 plan 新增的两个 kind**：`design-decision` / `acceptance-definition`（即「修订历史触发依据」）。`implementation` / `code-review` / `unit-evidence` / `device-evidence` / `visual-evidence` 的 derive basis **照收为当前目标** |

~~~ts
const REVISION_TRIGGER_KINDS = new Set(['design-decision', 'acceptance-definition']);
const sourcePaths = [...new Set(scope.obligations
  .filter(obligation => !REVISION_TRIGGER_KINDS.has(obligation.kind))
  .flatMap(obligation => obligation.basis.flatMap(binding => binding.dependencies
    .filter(dep => dep.role === 'derive' && dep.exists)
    .map(dep => path.relative(options.projectRoot, dep.path).replace(/\\/g, '/')))))];
~~~

理由：这两个 kind 的 owner 是 spec / plan，其 derive basis 按定义就是「触发这次修订的那个文件当时的样子」，不是任何阶段的当前检查目标——因此从**目标收集**里剔除；**字节豁免**仍由 R-摘要豁免承担。**真实代码输入门禁完整保留。**

**回归护栏（B1 要求）**：§4.4 / §5.4 的「仅 review」「仅 UT」用例必须加断言——`resolvedInputs.values['code'].state === 'resolved'`、其 `dependencies` 覆盖预期代码目标、capability assurance **非** `blocked`。没有这两条断言，本节的修法改动无法被证伪。

**review diff 补目标分支的准确定性（第七轮 review M1 后半，采纳）**：`capability-resolution-entry-input.ts:243-249` 会在过滤后追加路径，但要求 implementation required、路径仍在 `contracts.files`、且当前 diff 非删除；`git-diff.ts:313` 比的是基线到当前工作区的**净变化**，因此**完全撤回到基线的文件不会被重新加入**，plan 拒绝扩展、文件仍不在契约中的情形也不会加入；而「仍在授权写集且保留实际改动」的文件会重新加入——**那是当前审查输入，不是回归**，不得一概当作问题。

**误放行核对（codex 第六轮已核，采纳记录）**：扩白名单不会让「未处理的 UI 设计缺口」蒙混完成——契约未扩且越界改动仍在时 `ui-scope-gate.ts:196-200` 仍 FAIL，完成检查 `verify-feature-completion.ts:260-265` 仍要求链内各阶段 PASS。责任由阶段检查、闭环证据与后续 coding / review 承接，**无须重开 UI 意图分类**（§10.6）。

§5.4 的两条闭环用例据此同时检查**撤回后的责任阶段证据**与**最终 completion**（见该表）。

#### 5.1.2 接线点

接线点按 §3 问题 8 的更正取**生产链上真正的两个组装入口**，不是 checker 层：

| # | 调用点 | 写盘载体 | PASS/FAIL 可达性 | 说明 |
|---|---|---|---|---|
| ① | `harness/harness-runner.ts:2106`（`writeRunSummaryBase` 内既有的 `buildSummaryRepairCandidates` 调用处，**位置不动**）——在此同时把 `scope_revision_input` 回写进磁盘 `script-report.json` | summary + **`script-report.json`** | **两者皆可达**（`writeRunSummaryBase` 在 `:1315` 被无条件调用），且在 `:1984-1989` 的本轮 verifier subject 锚定之后 | 覆盖机器 check 归属与本轮 verifier 已确认的候选，**含 FAIL 轮** |
| ② | `harness/scripts/utils/phase-closure-finalizer.ts:644`（`recomputeClosureRepairCandidates`）——产物**回写 script-report.json**，在 `:709-718` 的 staged-rename 之前 | **`script-report.json`** + summary | **只 PASS**（`:545-548` 拒 FAIL/BLOCKER） | 只承担成功闭环；`--sync-closure` 出口（`harness-runner.ts:599-612`）走同一函数，自动覆盖 |

新增一个纯函数 `scopeRevisionInputFromRepairCandidates(candidates, effectiveScope, ctx)`，在①②各调用一次，把结果挂到既有 `CheckResult.scope_revision_input`（`harness/scripts/utils/types.ts:574`，字段已在）**并随 script-report 落盘**——runtime 读的是磁盘 script-report（`goal-phase-runtime.ts:9061-9063`），只给内存 `CheckResult` 加字段到不了消费方。
候选筛选**只有一条**：`category ∈ {'spec','plan'}` 且 `source_phase ∈ {'coding','review'}`。第三轮的第二条合取（「获准目标内、非域外误改」）随第四轮 review 阻断 1 删除——归属层没有承载该信号的字段，它既不可判也与已撤回的要求绑定。
①②产出同一候选时由 `applyScopeRevision` 的 `revision_input` 指纹去重（§3 问题 3），不会落两条修订。
**不各自新造判定、不新增 check id、不动 `CHECK_ID_OWNER_REGISTRY`。**

#### 5.1.3 correction 流程

`harness-runner.ts:664`（`--correction-init`）、`harness/scripts/utils/correction-routing.ts`、`correction-commands.ts:210`（feature 修正的责任阶段路由）改为读有效范围（§4.2.3 的统一入口）。路由到范围外阶段时产出同一 `scope_revision_input`，不再直接落 `backtrack_target_absent`（`goal-phase-runtime.ts:9418-9424`）。
`scope-replan.ts:194-204`（`checkPlanAuthority`）已消费 `ExecutionScope`，缺的是链外责任的修订出口——补出口即可，不改它的授权判据。

#### 5.1.4 不动的面

不改 assess 的 `revise_scope` 判定（`assess.ts:893-897`）；不新增第二条回退动作（`goal-assess-driver.ts:74` 与 `:81-83` 的唯一回退路由保持）；不放宽 R8。

#### 5.1.5 改动文件清单（批次 2 第一笔）

| 文件 | 改动 |
|---|---|
| `harness/scripts/utils/repair-candidates.ts` | 新增 `scopeRevisionInputFromRepairCandidates`（纯函数，不改归属逻辑、不改注册表） |
| `harness/scripts/utils/ui-scope-gate.ts` | **参考依赖，非改动项**（第三轮删除了第二轮的模块内 / 外二分与新 check id，见 §3 问题 8；批次 3 的 G6 另有改动，见 §6.8）。第七轮 review M3 |
| `harness/scripts/utils/execution-scope.ts:78` | §5.1.1a：`isExecutionSourceBasis` 的 kind 白名单加 `design-decision` / `acceptance-definition`（第六轮 review 建议 2 补列） |
| `harness/scripts/utils/capability-resolution-entry-input.ts:242` | §5.1.1a 的 **R-目标收集**：`sourcePaths` **只跳过** `design-decision` / `acceptance-definition` 两个 kind（修订历史触发依据），`implementation` / `code-review` / `unit-evidence` / `device-evidence` / `visual-evidence` 的 derive basis **照收为当前目标**。**不得**套用 `isExecutionSourceBasis`——那条是 R-摘要豁免，只管字节比对（第六轮的「逐 dep 套豁免」写法已于第七轮撤销，因会清空 UT / 纯 review 的代码目标致 `blocked`）。配套护栏见 §4.4 的「仅 review」「仅 UT」两行 |
| `harness/harness-runner.ts:2106` | 在既有 `buildSummaryRepairCandidates` 调用处（位置不动）追加：调 `scopeRevisionInputFromRepairCandidates` 并把 `scope_revision_input` 回写进磁盘 **script-report.json**；PASS/FAIL 两轮都到得了 |
| `harness/scripts/utils/phase-closure-finalizer.ts:644` | 闭环重算侧同上，产物**回写 script-report.json**（只 PASS 支；覆盖晚到的 verifier confirmed 候选与 `--sync-closure` 出口） |
| `harness/scripts/utils/correction-routing.ts`、`correction-commands.ts` | 读有效范围；范围外阶段产出 `scope_revision_input` |
| `harness/scripts/utils/scope-replan.ts:194-205` | §5.1.3 的链外责任修订出口（`checkPlanAuthority` 已消费 `ExecutionScope`，补出口即可，不改授权判据）。第七轮 review M3 补列 |
| `harness/scripts/goal-phase-runtime.ts` | `backtrack_target_absent` 分支：先看是否有 spec/plan 归属的修订输入，有则走修订 |
| `harness/tests/unit/execution-scope.unit.test.ts` + 真实 check 夹具 | §5.4 验收 |

删除清单：无（D0.3 是接线，`backtrack_target_absent` 路径本身保留给真正无处可回的情形）。

### 5.2 D0.2 候选范围生成入口（第二笔）

#### 5.2.1 CLI

`goal-mode-entry.ts --prepare-scope`，入参见 §3 问题 7。机器负责：
从 CU canonical / `derive.blueprint-acceptance` / `derive.blueprint-contracts` / `acceptance@1` / `contracts@1` 解析 design-context 与 acceptance-context 的绑定与 `satisfied_by`；从验收分层派生 unit / device 事实；从 fidelity SSOT 派生 visual 事实（与 D0.1 同一规则、同一函数）；code-review 沿现有规则自动补（`execution-scope.ts:167-172`）；全部 `content_fingerprint` / `dependencies[].sha256` 机器计算（复用 `resolveCapabilityInputs` 的同一绑定构造，保证指纹一致）。

无蓝图合法入口（非 CU feature）：以 `artifact@1` 与 `derive.requirement` 生成；缺验收则 acceptance-context unknown，**不强造蓝图**。

#### 5.2.2 implementation 由请求动作决定

见 §3 问题 7 表。`completion_target` 只决定最终证明到哪一级。复用现有 `requested_phases` 与义务输入表达，**不新增分类系统**。

#### 5.2.3 输出与幂等

输出：写 feature.yaml 的 `execution_scope` 候选；stdout 同时打印同一 resolver 的结果投影（`phase_chain`、每条义务的 applicability 与 reason、unresolved）与一句模板化说明（例：「已有设计与验收可用，本次实现、审查并运行相关 UT；无设备义务」）。这条说明就是原需求 R2 的用户可见输出，**用模板投影，不调 LLM**。

幂等：候选存在且指纹一致 → 不重写（字节不变）；不一致 → 列出差异并要求 `--overwrite`；不静默覆盖。

#### 5.2.4 主 Agent 职责与文档

主 Agent 职责缩为四项：`completion_target`、`requested_results`、明确请求动作（是否改代码、只验证还是完整交付，落为 `requested_phases`）、impact 判断（含来源路径）。

| 文件 | 改动 |
|---|---|
| `templates/AGENTS.md.template:56` | 「完整实现交付」一行改写为四项职责 + `--prepare-scope` 调用；删除任何暗示手写 basis / 手写指纹的表述 |
| `skills/project/goal-mode/SKILL.md` | 同上 |
| `skills/project/change-unit-progression/SKILL.md` | 同上 |
| `docs/operations/project-entry.md:30-32` | 同上；`:30` 的「不得手写已满足义务或运行结果」改为「候选由 `--prepare-scope` 生成，主 Agent 只提供四项输入」 |

#### 5.2.5 NEXT_STEP 复用

用户可见说明由同源模板投影产生，**同时复用既有 assess → NEXT_STEP 渲染**（`harness/scripts/utils/assess-renderer.ts:41-48` 的 `formatAssessNextStep`）。本批必须保证 NEXT_STEP 消费新的有效范围、不出现范围外义务；**不重造 renderer**。验收见 §5.4。

#### 5.2.6 改动文件清单（批次 2 第二笔）

| 文件 | 改动 |
|---|---|
| `harness/scripts/goal-mode-entry.ts` | `--prepare-scope` 旗标（`:343` boolean 数组）、参数解析与分支（与 `:380-401` 的 `--prepare-run` 并列） |
| `harness/scripts/utils/feature-track.ts` | 新增候选写入 / 幂等比对（与 `resolveFeatureExecutionScope` `:79-85` 同文件） |
| `harness/scripts/utils/execution-scope.ts` | **参考依赖，非改动项**（生成器复用 D0.1 的派生函数，须在批次 1 提取为可复用导出）。第七轮 review M3 |
| `templates/AGENTS.md.template`、`skills/project/goal-mode/SKILL.md`、`skills/project/change-unit-progression/SKILL.md`、`docs/operations/project-entry.md` | §5.2.4 |

删除清单：`templates/AGENTS.md.template` 与三份文档中所有「手写指纹」「手写 basis」「lite/full」残留表述（按 §5.4 的 smoke 断言逐条清）。

### 5.3 OpenSpec delta（批次 2）

**唯一 delta 责任：`obligation-execution-scope`**（交办 §0.5）。第一版把 D0.2 的条款挂到 `scope-aware-project-entry` 从而形成第二个 change delta，与「每批一个」冲突，已改为两条 Requirement 都落在同一个 change 内。

| 文件 | 改动 |
|---|---|
| `openspec/changes/obligation-execution-scope/specs/reconcile-assessment/spec.md` | Requirement `Assess observes the frozen execution scope` 补 D0.3：只有经既有 repair_owner 归属为 spec / plan 的发现 MAY 产出 `scope_revision_input`，且该输入 MUST 由候选自身的可核验文件绑定生成 `design-decision`／`acceptance-definition` required 事实；需求点名的写集越界（`diff_within_scope`、contract-reference-closure 未授权引用）MUST 留在 coding（今天已由「未注册 id → null」保证）；提议 MUST NOT 预设 plan 的裁决结论；correction 路由到范围外阶段 MUST 产出同一输入而非直接 `backtrack_target_absent`。补三条 Scenario。**第三轮的「且落在获准目标内 / 域外误改 MUST 留在 coding」两句随第四轮阻断 1 删除** |
| `openspec/changes/obligation-execution-scope/specs/skill-contracts/spec.md`（本 change 下新增 delta 文件） | 补 D0.2：候选 MUST 由机器入口生成，绑定与指纹与 `resolveCapabilityInputs` 同源；implementation MUST NOT 由 `completion_target` 决定，MUST 由显式 `requested_phases` 表达；用户可见说明 MUST 复用既有 assess → NEXT_STEP 渲染。补两条 Scenario。**唯一 delta，无例外**——第一版留的「若工具约束则跨到 `scope-aware-project-entry`」兜底按第二轮 review M3 删除；`scope-aware-project-entry` 若有被本批改判的旧条款，按「旧载体同步修订」处理（同 §4.2.5 的边界口径），不承载行为 delta |
| `openspec/changes/obligation-execution-scope/tasks.md` | 追加 P8 批次 2 小节与验收记录 |

### 5.4 批次 2 验收矩阵

D0.3（需求 §3 D0.3 末段逐行）：

| 需求验收行 | 用例 |
|---|---|
| 保留现有靠 `onHarnessSummary` 注入的 design-gap runtime 单测 | `real prepare CLI / bridge scope lifecycle: design-gap`（原样保留） |
| 真实 check-coding 夹具：获准目标确实需要一个契约未覆盖的 UI 文件 → `ui_scope_violation` 经既有注册表归属 plan（满足 `category`/`source_phase` 唯一条件）→ **生成** `design-decision` 事实 → 同 run 修订为 `[plan, coding, review, ut]` | `D0.3 real check-coding plan-owned gap triggers an in-run revision`（**必须经 `buildSummaryRepairCandidates` 真实归属链**，不得手拼候选对象；断言的是**生成结果**——事实的 `basis` 逐条对应候选 `files`、链变成 `[plan, coding, review, ut]`——触发者是候选本身） |
| 需求 D0.3 点名的写集越界（`diff_within_scope` / contract-reference-closure 未授权引用）→ 留在 coding 修复，无 spec/plan 候选、无修订事件 | `D0.3 named write-set violations stay in coding`。**断言到 assess 的输出**：summary 无 `category='plan'` 候选、assess 推荐**不是** `rerun_phase(plan)`、也不是 `backtrack_target_absent`、无修订事件（锁 `repair-candidates.ts:395` 的「未注册 id → null」） |
| `ui_scope_violation` 归属 plan → 由候选自身的 `files` 生成 `design-decision` 修订输入，`reason` 语义是「需要 plan 裁决」而非「已证明扩展合理」 | `D0.3 plan-owned ui violation yields a design-decision for plan to adjudicate`（断言生成事实的 `basis` 逐条对应候选 `files` 且经绑定核验；断言 `reason` 取自候选 `summary`）。**第三轮的「不带设计事实则不修订」反例随第四轮阻断 1 删除**——`RepairCandidate`（`repair-candidates.ts:32-52`）无该字段，那条反例在生产上造不出输入区别 |
| plan 收到误改型提议后拒绝扩展契约 → 打回 coding → **coding 实际撤回误改文件 → 责任阶段证据仍 fresh 且 completion VALID** | `D0.3 plan declines an unjustified extension and the reverted file still completes`（第五轮阻断 1 + 第六轮阻断 1）。用例必须跑到**完整闭环终点**，断言：① plan 不扩大 `contracts.files`；② coding 把文件改回原字节；③ `executionScopeEvidenceIssues` **不**报 `input binding stale`（白名单那一路）；④ **`recomputePhaseEvidenceStaleness(.., ['plan'])` 判 `fresh`**、plan 的 evidence manifest inputs **不含**该触发文件（`sourcePaths` 那一路）；⑤ `verifyFeatureCompletion` 判 VALID 且无 `lineage_fresh` issue。**既有注入用例覆盖不了它**——`execution-scope.unit.test.ts:171` 的 `onCoding` 只在 `direct` 模式改文件，须为本用例单建撤回动作 |
| **review 归因 spec 同理**（需求 D0.3；第六轮建议 1 + 第七轮 review M2 更正断言） | `D0.3 spec-owned finding completes after the trigger file is fixed`。**触发路径必须是真实的 review→spec 归属**：`deriveCategoryFromFiles`（`repair-candidates.ts:86-101`）按路径域判定，只有 `spec.md` / `acceptance.yaml` / `spec/` 下的文件才归 spec，且**全部文件同域**才产候选——夹具的 finding 必须指向 `spec/acceptance.yaml` 这类路径，**不能拿任意产品源码冒充**。断言：① 历史触发摘要不再阻断完成（`executionScopeEvidenceIssues` 不报 stale）；② **修复后的正式设计输入 / 输出仍被当前证据绑定**——`acceptance.yaml` 既是 spec 的输入也是它的产出（`skills/feature/spec/contract.yaml:10`、`:20`），经 `phase-evidence-manifest.ts:426` 读解析绑定登记，同路径 input/output 合并为 both 后仍列入 inputs（`:492-494`），**因此不得断言「spec manifest inputs 不含触发文件」**（那会误拒正确实现）；③ `verifyFeatureCompletion` 判 VALID。**反例保留两条**：spec 缺口未处理 → 不能完成；闭环后真实设计输入变化 → 仍判 stale、不能完成（锁「豁免只对历史触发摘要生效，不整体关闭 freshness」）。**不机械继承** plan 专用断言（「不扩大 `contracts.files`」「coding 撤回原字节」） |
| 晚到候选（PASS 支）：首次 writer 无 verifier、闭环重算才出现 spec 归属的 review 候选 → 仍产出同一修订，且不重复 | `D0.3 late verifier-confirmed candidate still revises exactly once`。**必须断言 `script-report.json` 上出现了 `scope_revision_input`**（runtime 的实际读取面），不能只看 summary |
| **晚到候选（FAIL 支）**：本轮 verifier 确认了一个导致 FAIL 的缺陷 → 该轮 writer（`harness-runner.ts:1315` 无 verdict 门控）即写出修订输入；后续按重跑指引（`harness-runner.ts:2522` / `goal-phase-runtime.ts:8017`）再次进 writer 时不重复追加 | `D0.3 failing round writes the revision input and rerun does not duplicate it`（锁 §5.1.2 ① 的 PASS/FAIL 均可达，与 `revision_input` 指纹去重） |
| `--sync-closure` 出口的晚到候选同样进入消费链 | `D0.3 sync-closure exit still writes the revision input to script-report` |
| review 归因 spec 的用例同理 | `D0.3 real check-review spec-owned finding triggers an in-run revision` |
| `--correction-init` 在范围外阶段产出修订而非 halt | `D0.3 correction to an out-of-scope phase revises instead of halting` |
| testing FAIL 仍不产生修订 | `real prepare CLI / bridge scope lifecycle: testing-fail`（保留） |

D0.2（需求 §3 D0.2 末段逐行）：

| 需求验收行 | 用例 |
|---|---|
| 对 `harness/tests/fixtures/component-blueprint/valid` 的 CU 生成候选 → prepare-run 与 D1 首次冻结直接可用 | `D0.2 generated candidate is directly usable by prepare-run`（D1 首次冻结部分在批次 3 补断言） |
| 生成的绑定与 `resolveCapabilityInputs` 的绑定指纹一致 | **批次 1 已交付**（§4.3 的夹具改造把所有绑定改走 `resolveCapabilityInputs`，指纹同源已被 §4.1.4 的重解析护栏实跑锁住）；批次 2 **复用**该结论，只补「生成器产出的候选与同一函数指纹一致」这一条增量断言 |
| 同输入重跑文件字节不变 | `D0.2 regeneration is byte-identical` |
| 候选被手改后重跑报差异不覆盖 | `D0.2 hand-edited candidate is reported, not overwritten` |
| 已有有效实现、仅缺 review / UT 的请求生成的候选不含 implementation，链为 `[review, ut]` | `D0.2 verification-only request yields no implementation obligation` |
| 明确要求改代码的请求必含 implementation | `D0.2 explicit code-change request includes implementation` |
| AGENTS 模板 smoke 无 lite/full、无「手写指纹」字样 | `D0.2 AGENTS template smoke has no lite/full or hand-written fingerprint wording` |
| NEXT_STEP 消费新的有效范围，不出现范围外义务 | `D0.2 NEXT_STEP projects only in-scope obligations`（复用 `formatAssessNextStep`，不新建 renderer） |

## 6. 批次 3：D1 轻量交互路径

### 6.1 feature 级冻结记录（D1.1）

文件与路径解析见 §3 问题 1。内容：

~~~ts
interface FeatureFrozenScope {
  schema_version: '1.0';
  scope_source: 'feature';
  frozen_at: string;                     // ISO
  candidate_fingerprint: string;         // feature.yaml.execution_scope 候选的指纹
  policy_fingerprint: string;            // 已有 ExecutionScope.policy_fingerprint（contracts/workflow 指纹）
  execution_scope: ExecutionScope;       // 出生段，resolveExecutionScope 的输出
  revisions: ScopeRevision[];            // D2.7，元素形状与 scope_revised 事件一致（无 run 字段）
  transferred_to?: string;               // D1.3
  transferred_scope_fingerprint?: string;
}
~~~

机器写入、单 writer（只有 harness-runner 的冻结入口与阶段收尾的修订应用写它）。**不写进 feature.yaml**——feature.yaml 是 AI 可编辑的候选载体，冻结结果与候选混在一个文件里无法分辨谁改了谁。

总纲 §7（`:195`）「不新增 execution-scope.json」按本裁决删除（处置见 §4.2.5 表最后三行与 §6.8）。

### 6.2 冻结时机与不重算（D1.2）

位置与失败形状见 §3 问题 2。规则：
- 交互模式下，对该 feature **第一次**执行任一 feature phase（`harness-runner --phase <p> --feature <f>`，无 run 身份）时，runner 读 feature.yaml 候选、经同一 `resolveExecutionScope` 计算并写入冻结记录；
- 之后每次阶段运行只读冻结记录，并核对候选指纹：候选被改动而冻结记录未经 D2.7 修订 → BLOCKER，指向既有 stale/correction 路径；**不静默重算，不静默沿用**；
- 候选缺失时沿用现状 BLOCKER（`feature-track.ts:82` 的 throw「缺少运行前范围输入」），**不回落 track**。

### 6.3 权威优先级（D1.3）

| 状态 | 权威 |
|---|---|
| 本次关联的 run（显式 `--run-id` / `--goal-run-id`、既有 active run 识别结果，manifest 含 execution_scope） | run 的有效范围（出生 + D2 修订） |
| 无关联 run，有 feature 冻结记录 | feature 冻结记录的有效范围（出生段 + revisions） |
| 无法确定当前权威（既无关联 run 也无 feature 记录却有阶段报告；或 feature 记录声明已转入某 run 而该 run 不存在 / 损坏） | 明确报错，列出来源与缺失项，**不选边** |
| 两者都无 | 按 D1.2 首次冻结；旧协议 run 按 P7 legacy 语义 |

识别机制与 `transferred_to` 写入时机见 §3 问题 12。
同一 feature 后起 Goal run 时，出生范围 = **转交时 feature 的有效范围**（出生段 + 已应用 revisions），不从候选重算，保证一次计算。feature 最初出生段与修订历史原样保留。
**转入后 feature 记录是来源历史，不参与持续等值比较**：run 内发生 D2 合法修订后两者必然不同，这不是冲突，不做双向同步。只有「run 的出生范围指纹 ≠ feature 记录登记的 `transferred_scope_fingerprint`」才是损坏。

### 6.4 消费者接线（D1.4）

七个读点全部改为通过 §3 问题 12 的统一入口取当前有效范围，入口内部按 D1.3 选来源；**不允许各消费者自己判断 run/feature**。批次 1 已把它们从 `loadFrozenExecutionScope` 换到 `loadEffectiveExecutionScope`（§4.2.3），批次 3 只需把 `runId` 从必填改为可选并删掉各自的「无 run 则回落」分支：

**批次 3 必须同批拆掉的真实 run 门禁（第一轮 review 阻断 9）**。第一版只列了「扩展 subject 类型 + 替换 loader」七点，但无 run 的 coding→review→UT 在第一阶段就会被下列四道现存门直接拒掉；不一并处置会留下「部分消费者读 feature、部分走旧 run 链」的半成品（正是 §1 明令不得出现的中间态）：

| # | 门 | 代码事实 | 批次 3 处置 |
|---|---|---|---|
| G1 | 现代 coding 拒绝无 run，**且紧接着仍调 run 基线** | `check-coding.ts:324` `if (!runId) return result('FAIL', '现代 Feature coding 缺少真实 run 身份')`；**`:330-333`** `resolveGoalRunBaseline(...runId)` → `!baseline.available` 即 FAIL → `diffChangedFilesWithStatus({ baseRef: baseline.baseSha })` | 两处一起改（第一版只处置了 `:324`）：① 判据从「有 runId」改为「有**有效范围权威**」，`readRunBoundContracts` 换成读有效范围的等价函数（`capability-resolution.ts:505` 已在 §4.2.3 换入口）；② **基线走下方 G5 的统一来源选择**，不再直接调 `resolveGoalRunBaseline` |
| G2 | review 的施工输入分支仍调 run 基线 | `capability-resolution-entry-input.ts:243-249`：`readRunBoundContracts(..., goalRunId)` + `resolveGoalRunBaseline(..., goalRunId)` + `diffChangedFilesWithStatus({ baseRef: baseline.baseSha })` | contracts 走有效范围；基线走 G5 |
| **G5** | **diff 基线的统一来源选择**（第二轮 review B6：第一版只给 review 安排了基线，coding 与 UI 门漏了） | 三个消费方各自直调 `resolveGoalRunBaseline`：`check-coding.ts:330`、`capability-resolution-entry-input.ts:245`、`ui-scope-gate.ts:137` | 提取**一个**函数 `resolveEffectiveDiffBaseline(projectRoot, feature, runId?)`，三个消费方原位替换为它。返回值形状与 `resolveGoalRunBaseline` 同构（`{ available, baseSha?, reason? }`），语义见下方「G5 的三态」 |
| **G6** | **无 run 时 UI scope 门整门 SKIP，且依赖 run 基线** | `ui-scope-gate.ts:123-131` `if (!runId) return { status: 'SKIP', ... }`（原文理由：「本门依赖 runner 的 run 级冻结锚…normal 模式无此锚」）；`:137` `resolveGoalRunBaseline(projectRoot, feature, runId)` | **现代 feature 权威存在时不得再走这条历史 SKIP**：`:123` 的条件从 `!runId` 改为「既无 run、**也无** feature 冻结记录」——旧 normal 模式（两者皆无）保持 SKIP 原文不动；有 feature 冻结记录时继续执行，白名单取有效范围绑定的 `contracts.files`，基线取 G5。`check-coding.ts:477-490` 的 `designedSkip`（`r.status === 'SKIP' && runId === null`）同步改为「按本门返回的 SKIP 语义」，避免有 feature 权威时把 BLOCKER 降成 MINOR |
| G3 | facts 校验无条件要求 run_id | `context-facts.ts:188` `if (!subject.run_id \|\| (!invocation.baseline && record.run_id !== subject.run_id)) issue(...)` | 按 subject 形态二分：`{feature, run_id}` 沿现状；`{feature}` 改为绑定**冻结记录指纹**。**指纹字段点名**：facts frontmatter 用新键 `frozen_scope_fingerprint`，值 = `executionScopeFingerprint(有效范围)`，与 `record.run_id` 互斥（两者同时出现即 issue）；校验位置就是 `:186-191` 这个 `if ('feature' in subject)` 块内，不新开校验函数 |
| G4 | 上游裁决链被 `if (runId)` 包住 | `upstream-verdict-gate.ts:38` | 条件改为「有 run 或有 feature 冻结记录」，无 run 时 `scope.phase_chain` 取自 feature 记录的有效范围；两者皆无时沿现状回落 workflow 默认链（`:45` 起的既有分支不动） |

**G5 的三态（第三轮 review 阻断 4：第二轮只写「无 run → `HARNESS_DIFF_BASE_REF`，取不到即 FAIL」，两头都不对）**。逐行核实的事实链：

| 事实 | 位置 |
|---|---|
| `resolveHarnessDiffBaseRef()` 在 goal 上下文返回 `undefined`，否则返回 `HARNESS_DIFF_BASE_REF` 的 trim 值（空串也归 `undefined`） | `phase-state.ts:178-181` |
| 既有非 goal 消费者把它**直接**交给 `diffChangedFiles`，**不做非空要求** | `check-coding.ts:400-404` |
| `diffChangedFiles` 对空 baseRef **默认 `'working'`**，并把 `'working'` 翻成 `baseRef='HEAD'` + `workingOnly=true`（与 `git status` 语义一致） | `git-diff.ts:129-139` |
| 但新接线的三个消费者用的是 `diffChangedFilesWithStatus`，它要求 `git rev-parse --verify <baseRef>^{commit}` 通过 | `git-diff.ts:306-310` |

于是第二轮方案两头都会坏：**未设 env** → 按「取不到即 FAIL」直接 FAIL（而既有语义本该是「与工作区比」）；**设了既有合法值 `working`** → 原样透传给 `diffChangedFilesWithStatus` → `rev-parse working^{commit}` 失败 → 报「baseRef 不可达」。

因此 G5 的语义写实为三态，**归一放在统一入口里做，不新增基线存储**：

| 输入 | 归一结果 | 说明 |
|---|---|---|
| 有 run | `resolveGoalRunBaseline(projectRoot, feature, runId)` 原样 | 一行不改 |
| 无 run，`resolveHarnessDiffBaseRef()` 为 `undefined`（未设 env），**或**值为 `'working'` | `{ available: true, baseSha: <当前 HEAD>, workingTree: true }` | 复用 `git-diff.ts:132-139` 已有的「空 / working → HEAD + workingOnly」归一，**不自己发明默认值**；调用方据 `workingTree` 走与 `diffChangedFiles` 相同的工作区比较语义 |
| 无 run，env 是显式 commit-ish | 原义透传（`rev-parse --verify` 由 `diffChangedFilesWithStatus` 照旧执行） | 保持既有 committed base 的用法 |
| 无 run，env 是显式值但 `rev-parse` 不通过 | `{ available: false, reason }` → 消费方 FAIL | 只有这一种才 FAIL，不再把「未设 env」误判成不可用 |

三个消费者共用这一份结果；`diffChangedFilesWithStatus` 需要接受 `workingTree` 语义（与 `diffChangedFiles` 的 `workingOnly` 同款），实施时优先把两者的 baseRef 归一逻辑提到同一处，**不复制**。

上述 **G1–G6** 与下表七个读点**同一笔提交**完成。
G6 的验收必须是无 run 的**真实 UI 正反例**（§6.9 新增两行）：无 run + feature 冻结记录下，改动契约内 UI 文件 → 门 PASS；改动契约外 UI 文件 → 门 FAIL（BLOCKER，不是 SKIP、不是 MINOR）。

| 位置 | 批次 3 改动 |
|---|---|
| `capability-resolution-entry-input.ts:229` | `if (goalRunId)` 外层条件改为「有 run 或有 feature 记录」；`factsContext.subject` 在无 run 时用 `{ feature }`；`first_phase` 取有效范围 `phase_chain[0]`；`:243-249` 的 review 分支按 G2 处置 |
| `assess.ts:450` | 删 `options.runId ?` 三元，改统一入口；`:452` 的 `track` 回落只在两者都无时生效 |
| `harness-runner.ts:548` | `--report-reconcile-only` 零设备判定的 `(args['goal-run-id'] \|\| process.env.MAISON_GOAL_RUN_ID)` 前置条件放开为「有 run 或有 feature 记录」 |
| `blueprint-skill-projection.ts:36-37` | 删 `!('run_id' in subject) \|\| !subject.run_id` 的 return（现在无 run 即直接放弃修订提议） |
| `change-unit-completion.ts:64-96` | `resolveChangeUnitExpectedExecution` 的 `record.run_id` 分支扩展为 `scope_source` 二分；`scopedCompletionRunId` 在 feature 载体下返回 null 而非放弃 |
| `verify-feature-completion.ts` | 见 §6.5 |
| `goal-progress.ts:801-804`、`assess-renderer.ts:103` | 报告投影中引用范围的位置改统一入口 |

`FactsInvocationContext.subject`（`harness/scripts/utils/context-facts.ts:42`）由
`{ feature: string; run_id: string } | { request_sha256: string; report_dir: string }`
扩为
`{ feature: string; run_id: string } | { feature: string } | { request_sha256: string; report_dir: string }`。
Feature facts 绑定 feature 与冻结记录指纹（替代 run_id 的身份位）。
`capability-resolution-entry-input.ts:214` 的 `manifest.phase_chain?.[0] !== factsContext.first_phase` 校验在无 run 时改比冻结记录的有效范围首阶段。

### 6.5 完成判定（D1.5）

- 无 run 时完成原件落 feature 级（路径见 §3 问题 1），`run_id: null`、`scope_source: 'feature'`、`execution_scope_fingerprint` = 有效范围指纹、`scope_revision_count` = `revisions.length`；
- 验证器按 `scope_source` 选出生范围来源：`'run'` → 现有逻辑（`verify-feature-completion.ts:876-882`）；`'feature'` → 读冻结记录；
- 其余判据**不放松**：阶段 receipt、evidence manifest、`gate_fingerprint`、freshness、required 义务覆盖、`chain === executionCompletionPhases(有效范围)` 全部沿用；
- 只有 feature.yaml、只有裸阶段报告、或冻结记录的范围内容 / 绑定 / revisions 链被非法改动 → 一律 INVALID；**不得因无 run 而信任任何自报字段**；
- 校验复用现有 `validateExecutionScope`、指纹与证据机制，**不为此另造签名体系**；
- `completion.run_id` 现在是必填 string（`:909-910`），改为 `string | null` 并与 `scope_source` 联动校验（`'run'` 必有、`'feature'` 必为 null）；原件落点校验（`:912-915`）按 `scope_source` 二分；

**第一版漏掉的硬绑定与生成调用方（第一轮 review 阻断 10）**。`:909-915` 只是顶层 run_id 与原件落点，后半段还有三处逐阶段 / 血缘级的 run 绑定，以及一处 CU 侧的路径限制，全部必须同批处置：

| # | 位置 | 现状 | 批次 3 处置 |
|---|---|---|---|
| H1 | `verify-feature-completion.ts:834` | 逐阶段结构校验要求 `typeof p.run_id === 'string'` | 改为 `string \| null`，并与 `scope_source` 联动（`'feature'` 载体下逐阶段 `run_id` 必为 null） |
| H2 | `:920-969` | 每个 phase 的血缘核验读 `goal-runs/<rec.run_id>/events.jsonl`，要求 `phase_start` + 成功 `run_end` + `derivePhaseInvocationAttempt` 对账 | **feature 载体的阶段证明结构**：`{ phase, run_id: null, gate_fingerprint, receipt_sha256, evidence_manifest_aggregate, closure_fingerprint }`，判据换成 feature 侧既有的同强度事实——阶段 `summary.json` 的 `verdict==='PASS'` + `closure_status==='closed'` + `closure_commit.schema_version==='1.0'`（`assess.ts:511`/`:537-538` 同一把尺）+ `loadPhaseEvidenceManifest(...).integrityOk` + `recomputePhaseEvidenceStaleness(...)==='fresh'`。**attempt 与 run_end 两项在无 run 路径下没有等价物**，不伪造：`attempt` 记 null 并由 `scope_source==='feature'` 显式豁免该项对账 |
| H3 | `:972-975` | 生成 run 自身必须有 `events.jsonl` | `scope_source==='feature'` 时改为「冻结记录存在且 `validateExecutionScope` 通过、`revisions` 链完整」 |
| H4 | `change-unit-completion.ts:77` | `if (!isInsideProjectRoot(featureFilePath(projectRoot, featureId, 'goal-runs'), original)) throw '原件不在该 Feature 的 run 目录'` —— **在读 `record.run_id`（`:78`）之前**就把无 run 原件挡掉 | 落点检查按原件所在目录二分：`goal-runs/` 内 → 现状；`<features_dir>/<feature>/completion/` 内 → 放行并走 `scope_source==='feature'` 分支（`:80` 的 `loadFrozenExecutionScope(..., record.run_id)` 相应改统一入口）。**先改这一处，否则 D1.7 的「CU VALID」验收到不了** |

**生成调用方（第一版完全没安排）**：全文搜索确认 `generateFeatureCompletion` 在生产里**只有一个**调用点——`goal-phase-runtime.ts:9794`，即 Goal runtime 内部。只改 writer 函数不会产生任何无 run 完成原件。
**生成条件不能用「phase_chain 已空」（第二轮 review B7）**。核实：`executionCompletionPhases`（`execution-scope.ts:215-217`）返回 `[...new Set([...reused_phases.map(p=>p.phase), ...phase_chain])]` —— `phase_chain` 是**范围中的计划链**，完成链由复用阶段与它组合；`harness-runner.ts:1347-1368` 的 `finalizePhaseClosure` 也不改范围。正常 coding→review→ut 跑完**不会**清空 `phase_chain`，第一版的条件永远不成立，标准无修订路径将永远生成不出原件。**也不得为了清空链去额外制造一次范围修订**（B7 末句）。

处置，生成条件与 goal 侧同构（`goal-phase-runtime.ts:9780-9793` 的同一把尺，**提取为共用函数 `shouldGenerateFeatureCompletion(scope, ...)`，不复制判据**）：

1. 无 run 身份 且 有 feature 冻结记录；
2. 有效范围 `completion_target === 'feature'`；
3. 有效范围 `unresolved.length === 0`；
4. 完整有效完成链 `executionCompletionPhases(有效范围)` 的**每个阶段**都通过既有 clean-pass 判据（`collectCleanPassIssues` 返回空，与 goal 侧 `:9781-9787` 同一调用）。

**两个出口共用同一条三步顺序（第三轮 review 必修 2）**。第二轮只给普通出口写了「在修订应用之后」，`--sync-closure` 出口只接了生成函数——那条路会漏掉本轮新产生的责任（晚到候选经 §5.1.2 ② 回写 script-report 后，恰恰是在 sync 出口才成立）。两个出口一律走：

> **消费修订输入（应用 `revisions[]`）→ 重新读取有效范围 → 按上述四条件检查并生成 completion**

| 出口 | 位置 | 说明 |
|---|---|---|
| 普通阶段尾部 | `harness-runner.ts:1347-1368` 的 `finalizePhaseClosure` 之后、进程退出之前 | 交互三连跑的常规路径 |
| `--sync-closure` | `harness-runner.ts:599-612`：`runSyncClosure` 返回 `exitCode === 0` 之后、`process.exit` 之前（**不经普通阶段尾部**；其闭环在 `phase-state.ts:524-558` 返回） | 用户显式同步闭环时**同样要先应用修订再判完成** |

两处调用的是**同一个** `applyFeatureScopeRevisionsThenMaybeComplete(...)`（内部先做 §6.7 的修订应用，再做本节四条件检查与生成），三步顺序与判据零重复。
四条 clean-pass 条件沿用既有 `collectCleanPassIssues`（`verify-feature-completion.ts:240-246` 起，含 `:246` 的「完成链与冻结范围失配」）——第三轮确认可保留，不改判据。
**注意**：`collectCleanPassIssues:244` 内部也调 `executionScopeEvidenceIssues` 且不带当前 run 身份，属 §4.2.3 末段要求逐个裁决的调用点之一，实施时一并处置。
**放弃的准确性**：无 run 完成原件因此缺 `attempt` 与 run 终局两维证据（H2 已列）。补偿是 H2 表中的五项阶段级判据一项不减，且 D1.5 明写「不得因无 run 而信任任何自报字段」；这两维在轻量路径上**确实不存在**对应事实，不用伪造 run_id 去凑（D2.3 明令「不允许轻量路径伪造 run_id」）。

- CU 消费 VALID completion 时**不区分** `scope_source`（H4 放行之后）。

### 6.6 「继续」（D1.6）

无 run 的「继续」= 读 feature 冻结记录 + 各阶段既有闭环状态（`recomputePhaseEvidenceStaleness` + `loadPhaseEvidenceManifest`）决定下一步，**不问 track，不重新计算范围**。有 run 的「继续」沿现状。实现上无需新代码：`assess.ts` 的 `observeFeatureState` 换入口后即得（§6.4）。

### 6.7 与 D2 的衔接（D2.7）

feature 冻结记录的 `revisions[]` 与 run 的 `scope_revised` 事件**共用同一有效范围计算函数**（§4.2.3 的 `applyScopeRevisions`），元素形状一致（feature 载体无 `run_base_sha` 字段——无 run 路径的 diff 基线沿既有非 goal harness 的 `HARNESS_DIFF_BASE_REF` 通道，不引入新基线概念）。出生段不改写。
D1 路径的触发面相同（checker 的 `scope_revision_input`），由 harness-runner 在**阶段收尾**应用——按 §3 问题 3 的更正，边界是「写完本阶段**结果**、退出前」，**不以 closure 成功为条件**（无 run 路径的 coding FAIL 同样必须能修订）。

阶段证据引用的 feature 载体形状（§4.2.4）由本批交付，共用同一有效性检查；**不允许轻量路径伪造 run_id**。

### 6.8 改动文件清单与 OpenSpec delta（批次 3）

| 文件 | 改动 |
|---|---|
| `harness/scripts/utils/feature-execution-scope.ts`（新增，唯一新文件） | `FeatureFrozenScope` 类型、`readFeatureFrozenScope` / `freezeFeatureExecutionScope` / `appendFeatureScopeRevision`（单 writer） |
| `harness/scripts/utils/goal-run-creation.ts` | `loadEffectiveExecutionScope` 的 `runId` 改可选，无 run 时读 feature 记录 |
| `harness/harness-runner.ts` | `:877` 处的首次冻结调用；阶段收尾的修订应用；`:548` 零设备判定前置条件放开；**无 run 完成原件的唯一生成调用点**（§6.5「生成调用方」） |
| `harness/scripts/goal-mode-entry.ts`、`harness/scripts/goal-phase-runtime.ts` | **两个出生入口**（`goal-mode-entry.ts:102`、`goal-phase-runtime.ts:4573-4574`）共用 `resolveBirthExecutionScope`：优先取 feature 有效范围；出生完成后各自写 `transferred_to`（§3 问题 12） |
| `harness/scripts/check-coding.ts:324`、`harness/scripts/utils/upstream-verdict-gate.ts:38`、`harness/scripts/utils/context-facts.ts:186-191` | §6.4 的 G1 / G4 / G3 三道 run 门 |
| `harness/scripts/utils/ui-scope-gate.ts:123-131`、`:137` | §6.4 **G6**：SKIP 条件由 `!runId` 改为「既无 run 也无 feature 冻结记录」；基线改走 G5。（第五轮 review 建议 1 补列——§5.1.5 的「ui-scope-gate 无改动」只针对批次 2 的归属面，批次 3 的 G6 确实要改这个文件） |
| `harness/scripts/utils/git-diff.ts:129-139`、`:306-310`、`harness/scripts/utils/phase-state.ts:178-181` | §6.4 **G5**：新增 `resolveEffectiveDiffBaseline` 三态归一；`diffChangedFilesWithStatus` 接受 `workingTree` 语义，与 `diffChangedFiles` 的 baseRef 归一逻辑提到同一处（**不复制**）。第五轮 review 建议 1 补列 |
| `harness/scripts/check-coding.ts:330`、`harness/scripts/utils/capability-resolution-entry-input.ts:245` | 同上 G5：两个既有基线消费者原位替换为统一入口 |
| `harness/scripts/utils/context-facts.ts:42` | `subject` 联合类型扩展 |
| `harness/scripts/utils/capability-resolution.ts:503-509` | `readRunBoundContracts` 的签名要求 `runId: string` 且内部走 `loadFrozenExecutionScope(.., runId)`（`:504-505`），无 run 路径调不动它。§6.4 G1/G2 说的「contracts 走有效范围」落点就是这里：`runId` 改可选、改用统一入口取有效范围，其余判据（找 `contracts@1` / `derive.blueprint-contracts` 绑定后 `readBoundInput`，`:506-509`）一行不改。第八轮 review M3 补列 |
| `harness/scripts/utils/execution-scope.ts:77`、`:113`、`:194`、`:207` | §4.2.4 的四处证据判别式改 `evidence_manifest_aggregate in ref`（第七轮 review M3 补列——此前只在 §4.2.4 正文写了「批次 3 一次改完」，文件清单漏列） |
| `harness/tests/unit/execution-scope.unit.test.ts` | §6.9 全部用例的落点（含 G5/G6 与 feature 载体判别式的回归）。第七轮 review M3 补列 |
| `harness/scripts/utils/verify-feature-completion.ts` | §6.5 全部改动（writer `:560-621`、verifier `:800-915` 的 `:834` / `:909-915` / `:920-969` / `:972-975`） |
| `harness/scripts/utils/change-unit-completion.ts:77` | §6.5 的 H4：原件落点二分（先于读 `record.run_id`） |
| `harness/scripts/utils/capability-resolution-entry-input.ts`、`assess.ts`、`blueprint-skill-projection.ts`、`change-unit-completion.ts`、`goal-progress.ts`、`assess-renderer.ts` | §6.4 |
| `docs/operations/project-entry.md:30-32`、`templates/AGENTS.md.template:56`、`skills/project/goal-mode/SKILL.md` | 完整交付一行改写：交互完整交付不再强制 prepare-run + attach；两个载体与优先级写明 |
| `.cursor/plans/动态工作流_总纲_...91c4e7a2.plan.md:195` | 删「不新增 execution-scope.json」并加指向 P8 §6.1 的说明（「不新增第二 run 目录」保留） |

OpenSpec delta（批次 3）：

| 文件 | 改动 |
|---|---|
| `openspec/changes/dynamic-workflow-closure-migration/specs/workflow-tracks/spec.md` | Requirement `Modern default and legacy restoration remain distinct` 补 D1：交互完整交付 MAY 使用 feature 级冻结记录作权威；权威优先级四行；转入 run 时 MUST 以转交时 feature 有效范围出生 |
| `openspec/changes/dynamic-workflow-closure-migration/specs/harness-gates/spec.md:5` | Requirement `Dynamic completion binds authoritative scope and resolved requirements`：**原句必须改写，不能只追加新句**（第二轮 review M3）。现文「Required obligations, reused evidence, original artifact location and **run/attempt/event lineage** MUST remain verified」是无条件的，与 D1.5 的无 run 载体直接冲突。改为按载体限定——`run/attempt/event lineage` MUST remain verified **for the run carrier**；feature 载体 MUST 以阶段 receipt / evidence manifest / `gate_fingerprint` / freshness / 义务覆盖与冻结记录完整性替代，MUST NOT 伪造 run_id。再补 D1.5：完成验证按 `scope_source` 选出生范围来源，其余判据不放松；只有候选 / 裸报告 MUST INVALID |
| `openspec/changes/composable-workflow-foundation/specs/runtime-policy/spec.md:108` | **删「MUST NOT 新建 execution-scope.json」**（保留「第二 run 目录、场外状态或平行完成协议」三项），改为「feature 级冻结记录是 P8 裁决的第二载体，MUST 由机器单 writer 写入且 MUST NOT 混入 feature.yaml」。同文件 `:104`/`:106`/Scenario 的三条冲突条款已在批次 1 处置（§4.2.5） |
| `openspec/specs/runtime-policy/spec.md:164` | 同上（已部署基线同步，**必做项，非条件句**） |
| `openspec/changes/dynamic-workflow-closure-migration/tasks.md` | 追加 P8 批次 3 小节与验收记录。批次 3 的唯一 delta 责任在本 change；`composable-workflow-foundation` 与已部署基线只承载同一条禁令的另外两处，不单列 |

### 6.9 批次 3 验收矩阵（需求 §4 D1.7 逐行）

| 需求验收行 | 用例名 |
|---|---|
| 无 run，harness-runner 三次调用完成 coding→review→ut → completion VALID、CU VALID；无 goal-runs 目录；无 spec/plan/testing 空报告 | `D1 runless interactive delivery reaches VALID completion` |
| 同上，中途改候选删掉 testing 义务 → 下一阶段 BLOCKER 指向 stale/correction；冻结记录不变 | `D1 candidate drift blocks the next phase and leaves the frozen record intact` |
| 同 feature 随后起 attended run → run 出生范围 = 转交时 feature 有效范围；不重算；feature 记录写入 `transferred_to` 与转交指纹 | `D1 goal run is born from the transferred feature effective scope` |
| feature 记录先经一次合法修订（S0→S1）再转入 run → run 以 S1 出生，不判损坏；feature 的 S0 与修订历史保留 | `D1 transfer after a feature-level revision uses S1 and keeps history` |
| 转入 run 后发生 D2 合法修订 → 继续执行，不报冲突；feature 记录不改 | `D1 in-run revision after transfer is not a conflict` |
| run 出生范围指纹与 feature 记录登记的转交指纹不同 → 明确报错，两个指纹与来源都在输出里 | `D1 transfer fingerprint mismatch reports both fingerprints` |
| 只有 feature.yaml + 裸报告；冻结记录范围内容被非法改动、绑定失配或 revisions 链断裂 → INVALID | `D1 runless completion rejects bare reports and tampered frozen scope`（四个子断言；纯格式变化不作硬门禁） |
| 现有 attended / detached 场景全部保持通过 | `real prepare CLI / bridge scope lifecycle: *` 全组（回归） |
| `--report-reconcile-only` 对无 run 的零设备 feature → 不要求 trace | `D1 reconcile-only needs no trace for a runless zero-device feature` |
| **无 run + feature 冻结记录下 UI scope 门真实生效**（G6）：改契约内 UI 文件 → PASS | `D1 runless ui scope gate passes for a declared ui file` |
| 同上：改契约外 UI 文件 → FAIL（BLOCKER，**不是** SKIP、**不是** MINOR） | `D1 runless ui scope gate blocks an undeclared ui file` |
| 无 run 的 coding diff 基线经 G5 三态归一：未设 env / `HARNESS_DIFF_BASE_REF=working` → 与工作区比（**不 FAIL**）；显式 commit → 原义；显式值 rev-parse 不通过 → FAIL | `D1 runless diff baseline normalizes working and fails only on a bad explicit ref`（三个子断言，锁 §6.4 G5 三态表） |
| 无身份调用遇到活着的 `.feature.lock` → 明确报错，不选边、不静默走 feature 载体 | `D1 runless call under a live feature lock reports instead of choosing a side`（§3 问题 12 第 4 步） |
| 无 run 完成原件由普通闭环出口生成 | `D1 runless completion is generated at the normal phase closure exit` |
| 无 run 完成原件由 `--sync-closure` 出口生成（同一函数） | `D1 runless completion is generated at the sync-closure exit` |
| D2.8 最后一行「D1 路径同场景」：feature 记录 revisions 追加一条，行为等价 | `D1 feature-level revision is behaviorally equivalent to scope_revised` |

## 7. 保留 / 裁剪双清单

### 7.1 新增接线点及其可核实的复用目标

| 新增 | 复用目标（点名可核实） |
|---|---|
| `scope_revised` 事件 | 既有 `goalEvents.emit` 与 `events.jsonl`（`goal-phase-runtime.ts:9344` 同一通道）；不新增文件 / registry / 租约 / manifest 字段 |
| `loadEffectiveExecutionScope` | 与 `loadFrozenExecutionScope`（`goal-run-creation.ts:86`）同文件同参数形状；内部复用 `loadEventsJsonlStrict` 与 `validateExecutionScope` |
| `applyScopeRevisions` | 复用 `resolveExecutionScope`（唯一纯函数入口）与 `executionScopeFingerprint`（`execution-scope.ts:60`） |
| 「不得删除 / 降级 required」校验 | **提取**自 `blueprint-skill-projection.ts:56-58` 的既有 BLOCKER，runtime 与 checker 共用同一函数（不复制谓词） |
| `resolveRunBaseline` | 只被 `goal-run-baseline.ts:29-35` 与 `goal-phase-runtime.ts:7238` 调用；出生 / 身份 / drift 三层防线一行不改 |
| `resolveEffectiveDiffBaseline`（统一 diff 基线入口，§6.4 G5） | 有 run → 原样 `resolveGoalRunBaseline`（一行不改）；无 run → 既有 `resolveHarnessDiffBaseRef`（`phase-state.ts:178-181`）+ `git-diff.ts:132-139` 已有的「空 / working → HEAD + workingOnly」归一。三个既有消费者（`check-coding.ts:330`、`capability-resolution-entry-input.ts:245`、`ui-scope-gate.ts:137`）原位替换，**不新增基线存储** |
| visual 派生 | 复用 `loadFidelityIntentSsotState` / `fidelityIntentSsotPath`（`fidelity-shared.ts:836` / `:825`），与 `capability-resolution.ts:530-539` 同一 SSOT |
| `request.impact` | 落在既有 `ExecutionScopeInput.request` 内；`basis` 复用既有 `InputBinding` 与 `isInsideProjectRoot` |
| `scopeRevisionInputFromRepairCandidates` | 唯一输入是既有 `collectPhaseRepairCandidates`（`repair-candidates.ts:566`）的输出；不新增 check id、不动 `CHECK_ID_OWNER_REGISTRY` |
| `--prepare-scope` | 挂既有 `goal-mode-entry.ts` 的 argv 解析（`:343`），与 `--prepare-run` 共用 projectRoot / frameworkRoot 解析（`:367-368`）；绑定构造复用 `resolveCapabilityInputs` |
| `execution-scope.json`（feature 冻结记录） | 路径经既有 `featureFilePath`（`config.ts:1759`）；内容是既有 `ExecutionScope` + 既有 `policy_fingerprint`；校验复用 `validateExecutionScope` 与既有指纹 / 证据机制 |
| feature 载体的 `ScopeEvidenceRef` 变体 | 与 run 载体共用同一有效性检查（`integrityOk` / freshness / aggregate 指纹，`verify-feature-completion.ts:75-82`） |
| 用户可见说明 | 复用既有 `formatAssessNextStep`（`assess-renderer.ts:41-48`），**不重造 renderer** |
| 唯一新文件 `feature-execution-scope.ts` | 因单 writer 语义需要独立边界；不新增目录、不新增配置项 |

### 7.2 被删机制与接手它的确定性门禁

| 被删 | 原承担的保证 | 接手的确定性门禁 |
|---|---|---|
| `scope_revision_requested` 事件 | 交接意图可审计、重入唯一 | `scope_revised` 事件：`revision_index` 连续 + `previous_scope_fingerprint` 链接到出生指纹 + `revision_input` 指纹去重（§4.2.1、§3 问题 3 幂等段） |
| `createScopeSuccessor` | 新范围经受校验的出生入口（请求边界不变、required 不缩、证据不 stale） | 修订校验：`validateExecutionScope` + D2.3 约束 + `executionScopeEvidenceIssues`（原 `goal-run-creation.ts:74-77` 的同一调用迁到修订路径）。**但该函数对 `ScopeEvidenceRef` 要求来源 run 已有成功 run_end（`verify-feature-completion.ts:75-82` 的 `resolveEffectiveRunEnd`），而 D2 不封卷** —— 按 §3 问题 11 加可选参数 `currentRunId`，只对「引用即当前 run」的那一项跳过终局检查，其余五项与历史 run 判据一行不放宽 |
| `createScopeSuccessor` 的 owner / 锁释放顺序 | 同一时刻只有一个执行者 | 不再需要——修订全程不释放锁，Feature 锁与 run owner 连续持有（§3 问题 3） |
| `cleanupScopeAncestors` | 完成后清理后继链上的临时恢复状态 | 无后继链即无祖先可清；同 run 的恢复状态由既有 run 级 GC（`deleteRunTrustState`）承接 |
| `onScopeHandoff` 回调 | 测试注入四个交接窗口 | **原位改名**为 `onScopeRevision('applied')`（runtime 侧，emit 之后）+ 既有 `onHarnessSummary`（修订前中断）；`afterHarnessPass` 因触发点早于 runtime 修订而**不可用**（§3 问题 4「注入点更正」） |
| `goal-phase-runtime.ts:4511` 的 detached 守卫 | detached attach-created 必须有已验证的 scoped successor 血缘 | `assertGoalRunAttachable` + `inspectGoalRunCreation` 的出生完整性检查。**放弃的准确性**：失去「detached attach-created 的 successor 血缘」这一维校验——出生完整性只证明该 run 自己出生完整，不证明它是某个已验证 successor。D2.5 已点名删除，故不作取舍项；但批次 1 须补一条夹具确认 detached attach-created 在无 successor 语义下仍被出生完整性检查挡住损坏出生（`D2 detached attach-created still requires complete birth`） |
| `goal-run-creation.ts:79` 的 `firstImplementationSuccessor` 专用参数与 `:239` 的专用条件子句 | 首个 implementation successor 跳过 lineage 基线要求 | 基线在同一 run 内只冻结一次，事件层 write-once（§3 问题 9）。**`:240-257` 的通用 successor 继承与普通出生冻结不删**（§3 问题 9 C 类已更正）；`--rebaseline-to` 显式重签路径保留 |
| 四个 handoff 测试模式 | 11 条交接期断言 | 逐条迁移到 run 内断言（§3 问题 4），断言总数不减；新增两条反向断言（出生 end_phase 不变、goal-runs 只有一个目录）。**一条断言的语义按 run 内事实改判**：design-gap 的「源阶段恰一次」改为 coding 两次（修订后责任阶段完成即重跑），语义从「源阶段不重跑」变为「责任阶段确实被重新派发」 |
| 「不新增 execution-scope.json」禁令（总纲 §7、两处 runtime-policy spec） | 防止第二个运行权威 | D1.3 的权威优先级四行 + D1.5 的「不得因无 run 而信任任何自报字段」+ 单 writer 约束；「不新增第二 run 目录 / 场外状态 / 平行完成协议」三项禁令**原样保留** |

## 8. 非目标与边界

- `resolveExecutionScope` 只做 D0.1 的护栏增量与「应用修订」纯函数，不改其余义务语义。
- 不动 request CLI（review/ut/testing 专项）、R8 护栏、P0 运行时证据规则。
- 不重造 NEXT_STEP renderer；本批只保证既有 assess → NEXT_STEP 与新的有效范围一致。
- 旧 track / lite 字样残留**不按数量清点**：只处理新路径误用旧逻辑的位置，真实旧 run 消费者保留。
- `contract.capabilities[].obligation_kinds` 未被消费不直接定性为「合同未实现」；只检查实际必需输入是否被错误剪枝。
- 不复制七份 plan 的实施日志，不为 facts 撞名做字段改名迁移。
- **不新增确认点、模式菜单、长期 feature flag、registry、租约、签名体系；不做 A/B。**
- 不批量改写宿主历史；旧 spec-driven run 按 P7 legacy 语义恢复。
- Skill 单职责终点验收：spec / plan / coding 各补一条「只做本职责、在请求终点停止、不冒充整体完成」的验收，复用现有 request CLI 与阶段夹具；不为所有 Skill 新增无 Feature 的 request CLI。

## 9. 提交边界与验证

| 批次 | 笔数与边界 |
|---|---|
| 1 | D0.1 一笔（纯函数 + 读取层 + 测试，见 §4.1.0 与 §4.1.6）；D2 一笔或两笔（runtime 删改 + 测试重写） |
| 2 | D0.3 一笔（checker / correction 产出 + 真实夹具）；D0.2 一笔（CLI + 模板文案） |
| 3 | D1 一笔或两笔（载体与写入 + 消费者接线） |

每笔生产代码改动：`cd harness && npm test`（含 typecheck）、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`、`git diff --check`、本批文件 LF 检查（用 node 扫行尾，不用 shell 管道猜）。
纯文档 / plan 状态 / OpenSpec 文案改动跑 **`npm run openspec:validate` 与 `node scripts/check-plan-version.mjs`**（交办 §0.8 的原话），外加 `git diff --check` 与 LF 检查。第一版写「只跑后两项」——在本节加入 diff / LF 两项之后，「后两项」已指向错误的命令，故按名直写。
单元测试先把完整输出写入日志文件再 grep 结论，不靠截断的终端输出下判断。

全绿后**停点回报，不得自行提交**；提交不加任何 AI 署名。

宿主实跑顺序（均由用户触发，见 frontmatter `real_host_validation`）：批次 1 后 codex 宿主 RDB attended → 批次 2 后重跑同场景验收用户入口 → 批次 3 后 RDB 无 run 交互场景。**fixture 绿不等于宿主通过。**

## 10. review 记录

> 第一轮 codex review（2026-09-14，判「不可进入实施」）。**每条意见都先打开其引用的代码位置逐字核实再处置**；
> 核实基线 main `db2edab8`。结论：17 条全部属实，**无一条驳回**。

### 10.1 阻断（11 条）

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| 阻断 1 | D0.1 未定义可保持纯函数的输入承接方式；`content_fingerprint` 语义写错；修订时 impact 丢失 | 接受 | §4.1.0（新增）、§4.1.3、§4.1.4、§4.1.6 | `resolveExecutionScope(input, workflow, acceptance?)`（`execution-scope.ts:119`）无 projectRoot/feature/解析上下文；`readBoundInput`（`capability-resolution.ts:486-501`）才做重读与核验，其比较是 `sha256(stableStringify(result.value))` 即解析值摘要，文件字节由 `dependencies[].sha256` 单独核；`blueprint-skill-projection.ts:52` 的 proposal.request 只带三个字段，无 impact |
| 阻断 2 | 默认阶段推导依赖 `derive.requirement` 不存在的解析能力 | 接受 | §3 问题 7（删两行默认推导，改为要求显式 `requested_phases` + 机器体检） | `capability-resolution.ts:273-276` 返回需求原文、`:341-350` 返回 `goal_requirement:<fp>` 摘要，均无动作分类、无证据缺口判断 |
| 阻断 3 | UI 越界 ≠ 真实设计缺口，反例不成立 | 接受 | §3 问题 8（改为两条合取 + UI 门内二分）、§5.4（反例必须命中 UI 门） | `ui-scope-gate.ts:194-196` 的判据是 `[...uiChanged].filter(f => !declared.has(f))`，任何越界都产 `ui_scope_violation`；`repair-candidates.ts:379-383` 的注册表把它一律归 plan；注册表总共三条，非 UI 的 coding 设计缺口无生产触发 |
| 阻断 4 | checker 产出的是 `failure_kind`，真正组装在别处；review 候选晚到 | 接受 | §3 问题 8「接线点」、§5.1.2、§5.1.5、§5.4 | `check-coding.ts:498` 只写 `failure_kind`；`buildSummaryRepairCandidates`（`repair-candidates.ts:716`）做 `failure_kind → classification`，生产调用方只有 `harness-runner.ts:2106` 与 `phase-closure-finalizer.ts:644`（后者注释原文：`--sync-closure` 不重跑脚本 harness，不补则候选永远落不进 closed summary） |
| 阻断 5 | D2 消费者清单漏四个直读出生范围的关键位置 | 接受 | §4.2.3（补四行 + 新增「执行链与游标如何更新」段） | `:4878` `fullWorkflowChain = executionCompletionPhases(manifest.execution_scope)`；`:6645` `checkPlanAuthority({ executionScope: manifest.execution_scope })`；`:9068` `const old = manifest.execution_scope`；`:9780` completion 生成资格读 `manifest.execution_scope.unresolved.length` |
| 阻断 6 | 阶段复用判据既不能证明 PASS，又会拒绝当前 run 的合法证据 | 接受 | §3 问题 11（整节重写为二分表 + `currentRunId` 参数）、§7.2 | `assess.ts:511` 的 `summary.verdict` 与 `:537-538` 的 `closure_status==='closed'`+`closure_commit.schema_version==='1.0'` 才是闭环判据，`:540` 的 fresh 只在其内生效；第一版引用的 `:461-465` 只是 staleness 调用。`verify-feature-completion.ts:75-82` 要求 `resolveEffectiveRunEnd` 终局 ∈ {CHAIN_SLICE_COMPLETED, COMPLETED}。`goal-runner-phase.ts:752-760` 的 `phase_verdict`/`phase_halt` 才承载结果语义 |
| 阻断 7 | 修订时机被错误限定为 closure 已成功 | 接受 | §3 问题 3（整节重写：成功 / 失败两条路径）、§6.7 | `phase-closure-finalizer.ts:545` `if (verdict !== 'PASS' \|\| blocker_count !== 0) throw` —— FAIL 提交不了 closure；`goal-phase-runtime.ts:9348` 的 `phaseDone = true` 在修订分支 `:9341-9347` **之后** |
| 阻断 8 | 删除清单误删必须保留的 supersede 基线继承 | 接受 | §3 问题 9 C 类（收窄为只删 `firstImplementationSuccessor` 专用参数与条件子句）、§7.2 | `goal-run-creation.ts:239-248` 是通用 successor lineage 继承（显式 supersede 走它），`:249-254` 是普通出生 HEAD 冻结；`goal-phase-runtime.ts:4604` 块由 `requestedSupersedeTargets[0]` 驱动，`:4619-4621` 属显式 `--supersede` 路径 |
| 阻断 9 | D1 七点接线不足以让无 run 的 coding→review→UT 跑起来 | 接受 | §6.4（新增 G1–G4 四道门表，与七个读点同笔提交） | `check-coding.ts:324` `if (!runId) return result('FAIL', ...)`；`capability-resolution-entry-input.ts:243-249` 调 `readRunBoundContracts` + `resolveGoalRunBaseline`；`context-facts.ts:188` 无条件 `if (!subject.run_id ...) issue`；`upstream-verdict-gate.ts:38` `if (runId) {` |
| 阻断 10 | 完成原件方案遗漏生成调用方及后半段 run 血缘校验 | 接受 | §6.5（新增 H1–H4 表 + 「生成调用方」段 + 放弃的准确性）、§6.8 | `generateFeatureCompletion` 生产唯一调用点 `goal-phase-runtime.ts:9794`；`verify-feature-completion.ts:834` 要求 `typeof p.run_id === 'string'`，`:920`/`:973` 要求 goal-runs 下的 events.jsonl；`change-unit-completion.ts:77` 在读 `record.run_id`（`:78`）之前就限制原件必须在 goal-runs |
| 阻断 11 | 转入 run 只覆盖 attended prepare，遗漏另一条出生入口 | 接受 | §3 问题 12（新增两入口表 + `resolveBirthExecutionScope` + detached 反例） | `resolveFeatureExecutionScope` 生产调用点两处：`goal-mode-entry.ts:102` 与 `goal-phase-runtime.ts:4573-4574`（`manifest.execution_scope ?? resolveFeatureExecutionScope(...)`） |

### 10.2 必须修正（6 条）

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| 必修 1 | 测试迁移含错误切点、遗漏调用方、自相矛盾的断言 | 接受 | §3 问题 4「注入点更正」、§4.2.2 #6/#7、§4.3、§7.2 | `goal-runner-testing-integrity.unit.test.ts:302` 参数声明 + `:916`/`:934` 转发未列；`:730` 的 `afterHarnessPass` 在 fake harness `return { exitCode: 0 }` 之前触发；design-gap 修订后 coding 必被派发两次 |
| 必修 2 | visual「零新分支即可形成 spec 缺口」的解释错误 | 接受 | §3 问题 10（新增方案 A/B + 三条验收断言） | `execution-scope.ts:179` 的 definition-gap 判据写死 `acceptance-context \|\| design-context`，不认 `acceptance-definition`；`:173` 的 `needed` 只收 required 义务，unknown 不会把 spec 加进 needed |
| 必修 3 | §9 问题 12 回答的是显式身份绑定，不是 active run 识别 | 接受 | §3 问题 12（显式写「未能核实」+ 锁记录实验 + 收窄兜底与其放弃的准确性） | `harness-runner.ts:370-373` `if (input.goalRunId === undefined) { ...; return { bound: false }; }` |
| 必修 4 | 路径覆盖参数写错 | 接受 | §3 问题 1（改 `featuresDirAbs` + 第四参数 + 四段传递链）、§3 问题 2（调用形状） | `config.ts:1816-1818` `interface FeaturePathOptions { featuresDirAbs?: string }`；`featureFilePath(..., opts?)` 第四参，`featureDirResolved:1738` 消费它 |
| 必修 5 | OpenSpec 仍保留与裁决直接冲突的活动规范；批次 delta 不唯一 | 接受 | §4.2.5（新增每批 delta 责任表 + 冲突条款 ①–④ 表）、§5.3（收窄为一个 change）、§6.8 | `composable-workflow-foundation/.../runtime-policy/spec.md:104`（完整交付 MUST 建立真实 run）、`:106`（封卷释放后创后继）、`:118-120` Scenario（先封卷交接再创建后继）；已部署基线 `openspec/specs/runtime-policy/spec.md:160`/`:162` 逐字相同 |
| 必修 6 | 事实索引、需求版本与验证命令需校正 | 接受（六个子项全改） | 见右栏 | ①successor 断言在 `execution-scope.unit.test.ts:232-248`、注入在 `:193-200`、枚举在 `:297`（→§3 问题 4、§4.2.2 #7、§4.3）；②候选缺失 throw 在 `feature-track.ts:82`（→§3 问题 2、§6.2）；③coding 组装块 `repair-candidates.ts:663-675`，`:658` 属 testing（→§3 问题 8）；④`capability-resolution-entry-input.ts:240` 的 `'input_id' in ref` 应继续筛 `InputBinding`（→§4.2.4 改为「四处改、两处保持」）；⑤需求第二版已明写不删 P2 正文并点名 detached 守卫（→§2.1 删两行取舍、§4.2.2 新增 #8/#9）；⑥验证命令直写 `openspec:validate` 与 `check-plan-version`（→§9） |

### 10.3 建议

| 意见 | 处置 |
|---|---|
| 「1.2 从未随发布件外流」未能核实，保留 plan 的事实检查及明确版本分支 | 第一轮接受保留；**第二轮已按 M4 关闭**——3.0.0 发布件（`453a4df6`）的 `verify-feature-completion.ts:51` 是 `'1.1'`，1.2 从未外流，全部前置检查删除（§3 问题 5、§2.1） |

### 10.4 第二轮 codex review（2026-09-15，判「仍有阻断」）

> 首轮 17 条中，第二轮确认已修复：阻断 2 / 8 / 11、必修 2 / 4；其余部分修复或未闭环，按下表二次处置。
> 同样逐条打开引用位置核实，基线 main `db2edab8`。结论：**13 条全部属实，无一条驳回。**

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| B1 | ResolvedScopeFacts 没贯穿修订调用链；代码/测试目标类绑定不能盲调 `readBoundInput` | 接受 | §4.1.0（新增 R1–R4 表 + 绑定二分 + 放弃的准确性）、§4.1.6 | 生产 resolver 调用还有 `blueprint-skill-projection.ts:55` 与 `goal-phase-runtime.ts:9085`；`:9072-9074` 会把退回 unknown 判成「cannot subtract required obligations」。`capability-resolution.ts:278-289` 需 inputContext+testTargets 才有解析值，`:335-339` 的普通 `derive.codebase` 分支返回 `{state:'resolved', detail:'project_root'}` **无 `value`** → `readBoundInput:493` 必抛 |
| B2 | 「impact 不可修订」卡死已裁决的影响更正 | 接受 | §4.1.0（`request_impact` 三条规则 + 两条验收）、§4.4 | 需求 D2.3 不可改清单无 impact；D2.8 第三行明写 `not_applicable → required` 合法 |
| B3 | 重算三个链变量切换不了主循环；数量等式判终点失效；复用例外只接修订写入处不够 | 接受 | §4.2.3（「执行链、循环游标与终点判定」整段重写 5 条 + `checkPlanAuthority` 的 `currentRunId`）、§4.4 | `goal-phase-runtime.ts:5187-5194` 的 `const chain` 才是执行真值，`:6228-6229` 消费它；`:9327` push outcomes，`:9640-9643` 用 `outcomes.length === chain.length`；`scope-replan.ts:201-205` 的 `checkPlanAuthority` 再次调 `executionScopeEvidenceIssues` 且不带当前 run |
| B4 | 模块内外二分不能证明责任归属，反例没真正回到 coding | 接受 | §3 问题 8（改为两个 check id，模块外走未注册 id）、§5.1.5、§5.4（反例断言到 assess 输出 + 新增「模块内但无设计事实」反例） | `CHECK_ID_OWNER_REGISTRY:379-383` 按 check id 归属，`checkOwnedCandidate:395-406` 与 `:663-675` 照样产 `category='plan'`；`assess.ts:820-848` 按 category 路由回 plan 或落 `backtrack_target_absent` |
| B5 | 把 summary 写入误当成 script-report 写入 | 接受 | §3 问题 8「载体」表、§5.1.2、§5.1.5、§5.4 | `harness-runner.ts:1196` script-report 先落盘、`:2106-2120` 只写 `summary.repair_candidates`；`phase-closure-finalizer.ts:603-608` 读 script-report、`:672-685`/`:709-718` 写 summary；`goal-phase-runtime.ts:9061-9063` 只读磁盘 script-report |
| B6 | G1–G4 漏掉 coding 基线与无 run UI 门 | 接受 | §6.4（G1 补 `:330-333`；新增 G5 统一基线来源、G6 UI 门）、§6.8、§6.9 | `check-coding.ts:330-333` 紧接着调 `resolveGoalRunBaseline`；`ui-scope-gate.ts:123-131` 无 run 即 SKIP，`:137` 依赖 run 基线 |
| B7 | 无 run completion 生成条件不可达，且漏 `--sync-closure` 出口 | 接受 | §6.5（四条生成条件 + 两个出口表）、§6.9 | `execution-scope.ts:215-217` 完成链 = `reused_phases ∪ phase_chain`，正常闭环不清空 `phase_chain`；`harness-runner.ts:1347-1368` 不改范围；`:599-612` 的 `--sync-closure` 直接 `process.exit`，闭环在 `phase-state.ts:524-558` |
| M1 | 阶段顺序写反；`end_phase === 'spec'` 断言不适用所有模式 | 接受 | §3 问题 3（统一为「结果落盘 → assess → 阶段结果事件 → 修订 → phaseDone」）、§3 问题 4 表 | `goal-phase-runtime.ts:9101` 先 `runAssess()`，`:9162-9172` 才 `decideAndEmit` 提交 verdict；`execution-scope.unit.test.ts:141` 对 design-gap 取 `['coding','review','ut']`，出生 `end_phase` 是 `ut` |
| M2 | 锁兜底不能写成既有保证 | 接受 | §3 问题 12（删「本就拿不到 Feature 锁」；改为冻结前主动读取检查 + 发现活锁即报错） | `harness-runner.ts:370-372` 无 run id 直接未绑定；Feature 锁由 `goal-phase-runtime.ts:3887-3899` 获取，无身份调用不参与竞争。可复用来源已核实：`goal-run-lock.ts:16-31`/`:45-52`/`:54-72`、`goal-run-control.ts:114-117` |
| M3 | OpenSpec 漏条款；「唯一 delta」仍留例外；harness-gates 旧句无条件 | 接受 | §4.2.5（新增 ③b + ① 的 D1.2 分支 + delta 边界写实）、§5.3（删跨 change 兜底）、§6.8（harness-gates:5 改写而非追加） | `composable-workflow-foundation/.../runtime-policy/spec.md:114-116` 与已部署 `:170-172` 的 Scenario THEN 仍写「经责任方重签后继」；`dynamic-workflow-closure-migration/specs/harness-gates/spec.md:5` 的 `run/attempt/event lineage MUST remain verified` 无条件 |
| M4 | 按新事实删除全部 schema 前置检查 | 接受 | §2.1、§3 问题 5、§10.3 | 调度者提供并经确认：3.0.0 发布件 `453a4df6` 的 `verify-feature-completion.ts:51` 为 `'1.1'`，main 为 `'1.2'`，1.2 从未外流 |
| 建议 1 | 保留 H2 的诚实不适用处理 | 接受（不改） | §6.5 H2 原样保留 | 前提「receipt / manifest / gate / freshness / 义务覆盖继续执行」已在 H2 表与 §6.5 第三条写明 |
| 建议 2 | 删过时的事实索引偏移说明；`feature-track.ts:82` 残留 | 接受 | 原 §10.4 偏移表删除；§6.2 的 `:83` 改 `:82` | 需求 §8 的行号偏移说明已在第一轮按实际行号施工，留着只会误导后续代理 |

### 10.5 第三轮 codex review（2026-09-15，判「存在阻断」）

> 第二轮 13 条中已闭合 7 条（B2、M1、M2、M3、M4、建议 1、建议 2）。本轮 4 阻断 2 必修 1 建议，逐条打开引用位置核实，基线 main `db2edab8`。
> 结论：**6 条接受，1 条部分驳回（阻断 2 的第三点要求）**。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| 阻断 1 | B1 未闭合：R3 补了 `ResolvedScopeFacts`，仍缺验收输入 | 接受 | §4.1.0「R3 还缺第三参数 `acceptance`」段 + §4.4 新增反例 | `blueprint-skill-projection.ts:53` 的 `acceptance` 由 `ctx.phase === 'spec' && ...` 门住，plan 阶段恒 `undefined`；`execution-scope.ts:130-141` 的 `<kind>:acceptance` 派生整段由 `if (acceptance)` 包住 → 验收缺失即 unknown → `:56` 判成降级。改法按 codex：R3 从 proposal 调 `readScopeAcceptance`（`feature-track.ts:88-96`）作第三参数 |
| 阻断 2 | B4 未闭合：模块内误改仍归 plan，「真实设计事实」没进归属判据 | **部分接受、部分驳回** | §3 问题 8 整段重写 + §5.1.5 + §5.4 | **接受**「模块命中不证明设计责任」→ 第二轮的模块内/外二分与新 check id `ui_scope_mis_edit` **整体删除**，归属层零改动；修订输入额外要求 `design-decision` 真实事实。**驳回**「模块内、模块外误改都断言到 assess 留在 coding」——证据：① 需求 D0.3 对「留在 coding」是点名枚举（`diff_within_scope`、contract-reference-closure），**不含 `ui_scope_violation`**；② 这两个 check 未注册，`repair-candidates.ts:395` 已保证返回 null，需求该条无需改动即满足；③ `ui_scope_violation → plan` 是先于本 plan 的既有裁决，注册表注释写死理由（`repair-candidates.ts:377-378`「scope 越界是 plan 冻结面的裁决问题」），推翻它不在需求 D0.3 的改动面内；④ 误改被路由回 plan 是需求自带的安全阀（D0.3「plan 对是否扩展契约仍独立裁决，修订提议不预设结论」）。机器无法区分意图这一点如实记录（§2.1 #2），**不发明信号** |
| 阻断 3 | B5 未闭合：晚到的负面 review 候选被 PASS closure 前置条件挡住 | 接受 | §3 问题 8「组装点不能前移」段 + §5.1.2 载体表（新增 PASS/FAIL 可达性列） | `harness-runner.ts:1984-1989` 的 `anchoredSubjectId` 在 Step 3（`:1196`）之后才确定，前移即丢本轮 subject；`phase-closure-finalizer.ts:545-548` 在 `:672` 重算之前拒 FAIL/BLOCKER。改法：组装点**留在** `writeRunSummaryBase`（`:1808`，`:2106` 处），该函数在 `:1315` 被无条件调用 → PASS/FAIL 均可达；closure 重算只承担成功闭环。附注（证据冻结不构成阻断）已核实采纳：`phase-evidence-manifest.ts:459-462` 发布时按当前字节重算，`phase-closure-finalizer.ts:716-718` 的 publish→rename 在其后 |
| 阻断 4 | B6 未闭合：G5 没承接既有非 goal 基线的默认值与 working 语义 | 接受 | §6.4「G5 的三态」新增表 + §6.9 验收行改写 | `phase-state.ts:178-181` 无 env 返回 `undefined`；`check-coding.ts:400-404` 直接透传；`git-diff.ts:129-139` 空 → `working` → `HEAD`+`workingOnly`；但 `diffChangedFilesWithStatus`（`git-diff.ts:306-310`）要求 `rev-parse --verify <ref>^{commit}` —— 未设 env 会 FAIL、`working` 会被当 commit 拒绝。改法：统一入口三态归一，复用既有归一逻辑，不新增基线存储 |
| 必修 1 | B3 部分修复：不要把 outcomes 改成第二份只追加历史 | 接受 | §4.2.3 第 3、4 条重写 | `goal-phase-runtime.ts:6677`、`:9509` 都在 `outcomes = outcomes.filter(...)` 剔除失效项；`goal-runner-phase.ts:756-772` 重建只留每阶段最新；`phase-transition-policy.ts:416-426` 用 `some(halted)`/`some(deferred)` 判终态，旧 outcome 会压低终态。改法：执行历史只由 events 保存，`outcomes` 保持当前有效结果投影（filter 保留），终点按 `latest` 覆盖 chain，不用 `some` |
| 必修 2 | B7 部分修复：`--sync-closure` 须先应用修订再判 completion | 接受 | §6.5「两个出口共用三步顺序」重写 | `harness-runner.ts:599-612` 的 sync 出口不经普通阶段尾部。改法：两出口共用「消费修订输入 → 重读有效范围 → 检查并生成」；四条 clean-pass 条件（`verify-feature-completion.ts:240-246`）保留 |
| 建议 1 | 限定「只核文件字节」的适用面 | 接受 | §4.1.0 绑定二分段 + §4.1.4 | 例外只对 `basis` 生效；`satisfied_by` 一律经 `readBoundInput`（`capability-resolution.ts:486-499`）重解析，不可解析即拒绝。实施时两条写成分开的函数，不共用宽松路径 |

### 10.6 第三轮核实中记录的需求 / 代码边界（只记录，不在本 plan 处置）

| 发现 | 说明 |
|---|---|
| 需求 §3 D0.3 验收第一行假设 check-coding 存在「能证明真实设计缺口」的机器归属 | 代码里 coding 侧归属 plan 的 check 只有 `ui_scope_violation`（`CHECK_ID_OWNER_REGISTRY:379-383`），它只知道「某 UI 文件不在 `contracts.files` 里」，**无法分辨获准需要与误改**。本 plan 不发明该信号；意图正确性由 D0.3 自带的「plan 独立裁决、提议不预设结论」兜底。若要机器侧真正区分，须单独提案一个带设计语义的 coding 侧 check 并走裁决 |

### 10.7 第四轮 codex review（2026-09-15）

> 本轮先裁决了第三轮的驳回：**驳回成立**，codex 撤回「模块内、模块外 UI 误改都必须让 assess 留在 coding」的要求（其核实结论与本 plan §3 问题 8 的四条证据一致：`repair-candidates.ts:377` 固定归 plan、`:395` 未注册返回 null、`ui-scope-gate.ts:194` 只比较 UI 变更与 `contracts.files`、无区分信号；保留 plan 独立裁决符合需求）。
> 第三轮 6 条中 4 条关闭（阻断 3、阻断 4、必修 1、必修 2）。本轮 1 阻断 2 必修 1 建议，**全部接受**。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| 阻断 1 | B4 未闭环：「真实设计事实」没有生产来源（把输出当成了生成前提），且旧筛选规则未删净 | 接受 | §3 问题 8 重写为「输入=既有候选、输出=设计事实」单方向；§5.1.2 删第二条合取；§5.3 删「且落在获准目标内 / 域外误改 MUST 留在 coding」；§5.4 正反例改写 | `RepairCandidate`（`repair-candidates.ts:32-52`）字段只有 `id / category / files / summary / item_fingerprint / source_phase`（+ testing 专用 `signal@1`），**无任何设计事实字段**；coding 组装分支 `:663-675` 只给 checkId / `affected_files` / detail。因此第三轮的「带事实才生成」是循环定义，正反例在生产上造不出输入区别。改法按 codex：由候选自身的可核验 `files` 绑定**生成** `design-decision`，`reason` 语义为「需要 plan 裁决」，不声称机器已证明扩展合理；不新增 check / 字段 / 分类器 |
| 必修 1 | R3 的 `??` 接不住失效绑定异常 | 接受 | §4.1.0 R3 代码块与说明改写 | `feature-track.ts:94` 直接调 `readBoundInput`，`capability-resolution.ts:493-497` 遇失效绑定**抛错**而非返回 undefined，`??` 右侧永不执行。改为「本轮 spec 有效新验收优先 → 其余从 proposal 重读」，并明确**不吞**一般 stale 错误（否则「来源失效」会被洗成「没有验收」，回到 unknown 降级） |
| 必修 2 | 字节例外漏掉 `request.impact.basis` | 接受 | §4.1.0 适用面改为三行表；§4.1.3 第 3 条改写 | 第三轮把例外限定为「只对 `obligation.basis`」，而 §4.1.3 要求 impact basis 直接 `readBoundInput`；D0.1 明写 impact basis 可以是代码文件，`capability-resolution.ts:335-339` 这类绑定无解析值必被拒 → 又堵死 D0.1 的代码来源影响判断。改为：两类 basis 共用 `verifyBasisBinding`，`satisfied_by` 中的 `InputBinding` 一律 `verifySatisfiedByBinding` 重解析 |
| 建议 1 | 同步验收矩阵 | 接受 | §4.4 补三行、§5.4 补 FAIL 支一行 | §4.1.0 承诺的 plan 阶段验收此前只写在正文、未进 §4.4（已补，并一并补失效绑定与代码类 impact basis 两行）；晚到候选此前只写 closure（PASS 支），已补 FAIL 支——依据 codex 本轮任务 B 的核实：`harness-runner.ts:1315` 不以 verdict 门控，FAIL 晚到经重跑指引 `:2522` 与 `goal-phase-runtime.ts:8017` 再次进 writer |

> 任务 B 其余结论：阻断 3（组装时机）、阻断 4（G5 三态）、必修 1（outcomes 投影）、必修 2（两出口顺序）均关闭。任务 C：每批 delta 唯一，对照需求 §6 无新增机制。

### 10.8 第五轮 codex review（2026-09-15）

> 第四轮 3 条（必修 1、必修 2、建议 1）全部关闭。本轮 1 阻断 3 必修 1 建议，**全部接受**。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| 阻断 1 | 候选文件绑定的后续消费未闭环：正常「plan 拒绝扩展 → coding 撤回误改」会把 completion 判 stale | 接受 | 新增 §5.1.1a；§5.4 用例延伸到完整闭环终点 | `execution-scope.ts:78` 的历史代码来源豁免白名单**不含** `design-decision` / `acceptance-definition`；`verify-feature-completion.ts:70-71` 未豁免即逐字节比并报 `input binding stale`，`:244` 把它纳入完成阻断；`goal-phase-runtime.ts:9077-9081` 补 `satisfied_by` 时保留原 basis，消不掉。改法按 codex：把两个 kind 加进该白名单，适用范围由该函数已有的三个前置（`role === 'derive'`、项目内、责任阶段在链或有 run 证据）自然收紧，后续验证由责任阶段闭环证据承接；**不放宽 `satisfied_by`、不放宽其它 kind** |
| 必修 1 | 第四轮撤销的生成前提仍有残句 | 接受 | 原 `:376`（§3 问题 8 末段）与 `:1084`（§5.4 正例行）改写 | 两处仍写「且修订输入带真实设计事实」「触发者是那条设计事实」。统一改为「既有候选满足 `category`/`source_phase` 条件 → 生成设计事实 → 断言生成结果」。§5.1.2、§5.3 第四轮已正确修订，不动 |
| 必修 2 | outcomes 验收仍要求保存历史，与已关闭裁决冲突 | 接受 | 原 `:962`（§4.4 行）改写 | 该行要求「`outcomes` 含两条 coding」，与 §4.2.3 第 4 条「outcomes 是当前有效结果投影」冲突。已核 `goal-runner-phase.ts:756-772` 按阶段只取最新终局结果、`goal-phase-runtime.ts:9509` 过滤失效结果。改为：两次 coding 执行与首次失败断言放 **events**，`outcomes` 只断言最新有效结果覆盖当前链 |
| 必修 3 | 十二问中仍有未同步表述与「实施时再定」 | 接受 | §3 问题 6（原 `:277`）与 §3 问题 10（原 `:455-463`） | ① `:277` 的「输出结构不变」与 §4.1.0 新增的 `ExecutionScope.request_impact` 矛盾 → 改为「输出只增加一个可选字段，schema 保持 `'1.0'`」；② `:455` 的「两选一，实施时按实跑结果定」→ 按原列优先级**定稿方案 A**（复用 `OBLIGATION_PROVIDERS` 单一真源），验收保留；实跑若发现回归则修 A 的实现并记录，不回退到 B，不留待选设计 |
| 建议 1 | 补齐汇总清单 | 接受 | §6.8 补三行、§7.1 补一行 | §6.8（批次 3 文件清单）此前未列 G5/G6 要改的 `ui-scope-gate.ts`、`git-diff.ts`、`phase-state.ts` 与两个基线消费者；§7.1（新增接线点索引）未列统一 diff 基线入口 `resolveEffectiveDiffBaseline`。均为索引同步，无新机制 |

> 本轮 codex 另确认：修订结果边界、同 run 证据例外、G5 三态、两出口顺序均无回归；每批唯一 delta 无例外；对照需求 §6 无新增机制。
> **两项仍是「有明确兜底的实施验证项，不得宣称已验证」**（codex 点名 plan `:159`、`:515-519`，本 plan 原文即如此写）：路径第三通道（自定义 `featuresDirAbs` 的无 run 完成判定，§3 问题 1）与活锁识别（§3 问题 12 的锁记录读取实验）。
> 已撤回的 UI 意图分类要求不重开（§3 问题 8、§10.6）。

### 10.9 第六轮 codex review（2026-09-15）

> 第五轮必修 1/2/3 与建议 1 全部关闭；阻断 1 部分修复未闭环。本轮 1 阻断 2 建议，**全部接受**。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| 阻断 1 | 白名单只消掉一路；触发文件仍经 `sourcePaths` 进责任阶段的当前证据，撤回后照样 stale | 接受 | §5.1.1a 新增第二条链的六行事实表 + 单点修法 + 误放行核对；§5.4 两条用例加证据断言 | ① `capability-resolution-entry-input.ts:242` 的 `sourcePaths` 从**全部** basis 收 derive 文件，**未**套用 `:239` 已在用的 `isExecutionSourceBasis`（两处口径不一致，这是根因）；② 同一份 `sourcePaths` 既作 `factsContext.source_paths` 又作 `testTargets`（`:287`）；③ `skills/feature/plan/contract.yaml:8`/`:13` 消费 `derive.codebase`，`capability-resolution.ts:278-289` 据 testTargets 生成当前文件依赖；④ 源码进证据只有两个入口且**都由 `sourcePaths` 喂**（`phase-evidence-manifest.ts:437`；`phase-closure-finalizer.ts:195-202` → `capabilityResolutionEvidenceInputs:162` → `:305-308`）；⑤ `phase-evidence-manifest.ts:903-909` 逐条比字节判 stale；⑥ `verify-feature-completion.ts:358-371` 把它计入 `lineage_fresh`。**修法=单点对齐 `:242` 的过滤口径**，因为它是两条登记入口的唯一共同上游；真实设计输入（`design-context`/`acceptance-context`）不在白名单内故照收；`capability_plan_codebase` 是 `on_missing: prune` 故目标变少不失败 |
| 建议 1 | 补足 `acceptance-definition` 的豁免验收 | 接受 | §5.4 新增 `D0.3 spec-owned finding completes after the trigger file is fixed` 行（含正例与两个反例） | 需求 D0.3「review 归因 spec 的用例同理」；第五轮只落了 plan 归属那一条 |
| 建议 2 | 清理两处汇总遗漏 | 接受 | §4.1.6（原 `:710`）「方案 A/B」→「**方案 A**，已定稿」；§5.1.5 补 `execution-scope.ts:78` 与 `capability-resolution-entry-input.ts:242` 两行 | 与 §3 问题 10 的定稿、§10.8 必修 3 的结论统一 |

> codex 本轮另核并采纳的一条**误放行核对**：扩白名单不会让未处理的 UI 设计缺口蒙混完成——契约未扩且越界改动仍在时 `ui-scope-gate.ts:196-200` 仍 FAIL，`verify-feature-completion.ts:260-265` 仍要求链内各阶段 PASS。已写进 §5.1.1a。
> 其余前五轮关闭项未发现需重开；每批唯一 delta 无例外；无 §6 新增机制。

### 10.10 第七轮 codex review（2026-09-15）

> 第六轮建议 2 关闭；阻断 1 的单点修法**引入直接回归**，建议 1 写入但断言不适用。本轮 1 阻断 4 必修 2 参考项，**全部接受**。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| B1 | 第六轮的 `sourcePaths` 全局收窄会删掉 UT / 纯 review 所需的真实代码输入 | 接受 | §5.1.1a 的「修法」段整体重写为**两条规则**；§4.4 / §5.4 加回归护栏断言 | `isExecutionSourceBasis` 的 kind 白名单（`execution-scope.ts:78`）本就含 `implementation / code-review / unit-evidence`，且不限阶段；`:287` 令 `testTargets = sourcePaths`；空目标 → `derive.codebase` absent（`capability-resolution.ts:278-280`）→ UT 的 `code` 是 base/fail（`skills/feature/business-ut/contract.yaml:7`、`:14`）、review 同样 base/fail（`code-review/contract.yaml:7`、`:15`）→ `capability-resolution.ts:678-682` 判 `blocked` → `phase-closure-finalizer.ts:553-554` 拒绝提交 closure。**修法按调度者与 codex 同向的定案：R-摘要豁免（`isExecutionSourceBasis` 原样，管字节比对）与 R-目标收集（只跳过 `design-decision` / `acceptance-definition` 两个新 kind）是两条规则，不合并。** plan 的 `enhancement/prune` 只能证明 plan 自己不缺输入 |
| M1 | 「源码进证据只有两个入口且都由 `sourcePaths` 喂」不成立 | 接受 | §5.1.1a 的事实表改为 **E1–E5 五个入口** + 两条闭环用例各入口实际携带物的说明 | 另有三条：`resolvedInputs.values` 的绑定 / 尝试依赖（`phase-evidence-manifest.ts:426-431`）、facts 基线依赖（`:438`，来自 `capability-resolution-entry-input.ts:266`）、PASS check 的 `affected_files`（`phase-closure-finalizer.ts:238-242` → `:308`）。三者**不动**——真实设计输入与被检查对象仍须绑定。「唯一共同上游」这条论证已删除。review diff 补目标分支的准确定性（`entry-input.ts:243-249` + `git-diff.ts:313` 净变化语义）一并采纳记录 |
| M2 | 新增 spec 正例的「沿用上面五条断言」不适用真实 spec 归属链 | 接受 | §5.4 该行重写 | `deriveCategoryFromFiles`（`repair-candidates.ts:86-101`）按路径域判定，只有 `spec.md` / `acceptance.yaml` / `spec/` 归 spec 且要求全部文件同域 → 夹具触发路径必须是这类；`acceptance.yaml` 既是 spec 输入也是其产出（`skills/feature/spec/contract.yaml:10`、`:20`），经 `phase-evidence-manifest.ts:426` 登记、`:492-494` 同路径 both 仍入 inputs → **不得断言「spec manifest inputs 不含触发文件」**。改为断言「历史触发摘要不再阻断 + 修复后的正式输入/输出仍被绑定」，保留两个反例，不机械继承 plan 专用断言 |
| M3 | 批次改动清单遗漏与描述冲突（五项） | 接受 | §4.2.7 补 `scope-replan.ts` 与测试辅助器、`onScopeHandoff` 改为「改名」；§5.1.5 补 `scope-replan.ts`；§6.8 补 `execution-scope.ts` 四处判别式与测试落点；§1/§4.1 的「只改纯函数」措辞同步；三处「无改动」文件改标「参考依赖，非改动项」 | `checkPlanAuthority` 的实际调用在 `scope-replan.ts:204`；回调声明 / 转发在 `goal-runner-testing-integrity.unit.test.ts:302`、`:916`、`:934`；判别式在 `execution-scope.ts:77`、`:113`、`:194`、`:207` |
| M4 | 验收矩阵两项子场景未覆盖 | 接受 | §4.4 补「仅 UT」行；§4.4 把 testing-fail 行拆为 FAIL / 设备离线 / manual 三个明确子场景 | `execution-scope.unit.test.ts:173` 的现有夹具只注入普通 BLOCKER FAIL，证明不了设备离线与 manual |

**参考项（实施时验证，不改 plan——本 plan 原文即如此写，仍不得宣称已验证）**：
1. 自定义 `featuresDirAbs` 四段传递（§3 问题 1）：`config.ts:1759` 有 `opts` 形参，而 `verify-feature-completion.ts:913` 当前未传；
2. 无身份调用的活锁识别（§3 问题 12）：可复用 `goal-run-lock.ts:45` 的 `readLockRecord` / `isLockStale` 与 `goal-run-control.ts:114` 的 `readRunControl`。

> codex 本轮另确认：需求 D0.1 / D0.2 / D0.3 / D1.7 / D2.8 的验收行已逐行对应到用例名（M4 两项已补）；每批 delta 唯一；无 §6 新增机制；前六轮已关闭项无回归。

### 10.11 第八轮 codex review（2026-09-15）

> 第七轮 M2、M4 关闭，§5.1.1a 全节核对连续无截断；B1、M1、M3 各有残留。本轮 1 阻断 2 必修，**全部接受**，均为清单 / 措辞与正文的同步。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| B1 | 正式改动清单仍要求执行已撤销的错误修法 | 接受 | §5.1.5 的 `capability-resolution-entry-input.ts:242` 行重写 | 该行仍写「逐 dep 套 `isExecutionSourceBasis`」，与 §5.1.1a 已定稿的两条规则直接冲突；照清单实施会重新引入第七轮已确认的回归（`execution-scope.ts:75-78` 的豁免含 `implementation` / `code-review` / `unit-evidence` → `capability-resolution-entry-input.ts:287` 的 `testTargets` 清空 → `capability-resolution.ts:278-280` absent → `code-review/contract.yaml:15` 与 `business-ut/contract.yaml:14` 的 base/fail → blocked）。已改为「只跳过 `design-decision` / `acceptance-definition`，其它 kind 照收」，并点名配套护栏在 §4.4 的「仅 review」「仅 UT」两行 |
| M1 | E2/E3 携带物被错误划为互斥来源 | 接受 | §5.1.1a 的 E2 / E3 两行重写 | `capability-resolution.ts:598-601` 为**每个**已解析输入构造 `binding.dependencies`（由该输入全部 attempts 汇总），因此 `codebase` / `test_targets` 这类输入的依赖同时出现在 E2（`phase-closure-finalizer.ts:195-202` 收集 capability 依赖）与 E3（`phase-evidence-manifest.ts:426-431` 读 `resolvedInputs.values`）——**两条是可能重叠的登记通道**，E3 写「与 `sourcePaths` 无关」不成立。已改为如实描述重叠，并明确**不追加任何全局豁免**：撤回后 `phase-evidence-manifest.ts:903-909` 仍可能判 stale，当触发文件同时是真实当前输入时它**应当**保持绑定，这不是缺陷 |
| M3 | 清单补漏与措辞同步未完成（三项） | 接受 | §6.8 补 `capability-resolution.ts:503-509`；§9 批次表「纯函数 + 测试」→「纯函数 + 读取层 + 测试」；§4.3 测试清单逐行点名文件 | ① `readRunBoundContracts`（`:503`）签名要求 `runId: string` 且内部 `loadFrozenExecutionScope(.., runId)`（`:504-505`），无 run 路径调不动——G1/G2 说的「contracts 走有效范围」落点就是它，`runId` 改可选、换统一入口，`:506-509` 的绑定查找与 `readBoundInput` 一行不改；② §9 的批次表与 §1 / §4.1 / §4.1.6 已同步的读取层改动不一致；③ §4.3 的「同文件」在插入 `goal-runner-testing-integrity.unit.test.ts` 一行后产生指代歧义——**全表六行一律改为点名 `harness/tests/unit/execution-scope.unit.test.ts`**，不只修 codex 点到的两行 |

**全文残留清扫（本轮按调度者要求执行，逐项 grep 并逐条判读）**：`纯函数 + 测试` / `纯函数+测试` → 0 处；`与 sourcePaths 无关` → 0 处；`无改动（` → 0 处；`| 同文件 ` → 0 处。
仍有命中但**属正确的更正 / 记录文本**（保留）：`逐 dep 套`（§5.1.5 内「第六轮的『逐 dep 套豁免』写法已于第七轮撤销」）、`只改纯函数`（§1 的「只改纯函数与其读取层」与 §4.1.0 / §4.1.6 的更正叙述）、`只有两个入口` / `唯一共同上游`（§5.1.1a 与 §10.10 对第六轮错误论证的否定）。

**建议项（实施参考，不改 plan；本 plan 原文即如此写，仍不得宣称已验证）**：§3 问题 1 的自定义 `featuresDirAbs` 四段传递验证；§3 问题 12 的活锁识别读取实验。

> codex 本轮复核：§5.1.1a 全节连续无截断；M2 / M4 补齐；每批唯一 delta；§6 非目标一致。

### 10.12 第九轮 codex review（2026-09-15）——总判「无阻断，可进入实施」

> 第八轮 B1、M3 关闭；M1 剩一处非阻断文案。本轮 1 条，接受。

| # | 意见要点 | 处置 | 落点 | 核实到的代码事实 |
|---|---|---|---|---|
| M1（文案） | §5.1.1a 的 E3 行写「artifact 类设计／验收输入的依赖则只走这条」不符事实 | 接受 | §5.1.1a 的 E3 行与其下方结论段重写 | `phase-closure-finalizer.ts:195-202` 遍历 capability 的**全部** `attempts.dependencies`，**不排除 artifact 类**；`skills/feature/plan/contract.yaml:7-14` 把 `acceptance` / `contracts` 列为 capability 输入 → 它们同样经 E2 登记。已改为「代码依赖与 artifact 依赖都可能同时经 E2 / E3 登记」；「E3 原样保留」改为「登记机制不改，其依赖集合随上游解析结果变化」；并把 §10.11 已记的「触发文件同时是真实当前输入时，撤回后判 stale 属正确行为」**同步进正文**，要求 §5.4 闭环用例把两种形态分开断言 |

**两项参考项保持「实施时验证」**（不得宣称已验证）：§3 问题 1 的自定义 `featuresDirAbs` 四段传递；§3 问题 12 的活锁识别读取实验。

> codex 第九轮总判：**无阻断，可进入实施。**

## 11. 实施记录

> 每个批次完成后在本节追加；另一个代理据此续接。格式：日期 / 批次 / 改了什么 / 验证输出 / 与 plan 的偏差与放弃的准确性 / 未决项。

### 批次 1（D0.1 + D2）

#### D0.1 第一笔 — 进行中（生产代码已落，测试 / 夹具未改完）

- 日期：2026-09-15
- 提交：**未提交**（按交办口径，改动只落工作树，等用户 review）

**已改文件（生产）**

| 文件 | 改动 |
|---|---|
| `harness/scripts/utils/execution-scope.ts` | `ExecutionScopeInput.request.impact?`（新类型 `ScopeImpactJudgement`）；`ExecutionScope.request_impact?`；新导出 `ResolvedScopeFacts`；`resolveExecutionScope` 增第四可选入参 `resolved`；`DERIVED_EVIDENCE_KINDS` 三 kind 的派生 + 同 kind 全量覆盖；visual 从 fidelity SSOT 派生；feature 终点的 impact 结论；`satisfied_by` 结论消费；definition-gap 判据改用 `OBLIGATION_PROVIDERS` 单一真源（§3 问题 10 **方案 A**）+ 定义缺口 owner 进 `needed`；`request_impact` 回写输出 |
| `harness/scripts/utils/feature-track.ts` | 新增读取层 `collectResolvedScopeFacts`、`verifyBasisBinding`、`verifySatisfiedByBinding`；`resolveFeatureExecutionScope`（R1）接上 |
| `harness/scripts/utils/blueprint-skill-projection.ts` | R3：第三参数 acceptance 改「本轮优先 → 否则从 proposal 重读」（不吞 stale）；接 `collectResolvedScopeFacts`；proposal 继承 `scope.request_impact` |
| `harness/scripts/goal-phase-runtime.ts` | R4：修订重建接 `collectResolvedScopeFacts`；`input.request.impact ??= old.request_impact` 继承 |
| `harness/scripts/utils/verify-feature-completion.ts` | `executionScopeEvidenceIssues` 增可选 `currentRunId`：仅对「引用即当前 run」跳过 `resolveEffectiveRunEnd` 终局检查，其余五项与历史 run 判据一行不放宽（§3 问题 11 / §4.2.3 末段） |
| `harness/scripts/utils/capability-resolution.ts` | **提取** `resolveUiRequirementSignal`（原 `resolveApplicability` 的 `applicability.ui` 分支整体外提，零行为变化），供读取层复用同一谓词而非复制正则 |

**验证**

- `npx tsc --noEmit -p tsconfig.typecheck.json` → 退出 0
- `npm run test:unit` → 第一轮 `4468 passed, 16 failed`；修掉下方「实现错误①」后 → **`4475 passed, 9 failed（共 4484）`**
- `npm test` 全量与 `openspec:validate`：**尚未跑**（等 D0.1 的夹具改完再跑，避免噪声）

**剩余 9 个失败的统一根因（属计划内、未做完的部分）**：夹具候选不带 `request.impact`，于是「验收全 unit + 无 impact → device unknown」生效 → testing 进 unresolved。这正是需求 D0.1 的预期行为（「验收全 unit 但无 impact → unknown，testing 保留」），对应的夹具改造在 plan §4.1.6 / §4.3（`execution-scope.unit.test.ts:150` 的 `device:impact` 自报改 `request.impact`）与 §4.4 尚未执行。落点分布：`execution-scope.unit.test.ts` 6 个、`obligation-scoped-verification.unit.test.ts` 2 个、`standalone-coding-review.unit.test.ts` 1 个。

**实现过程中发现并修掉的自身错误（记录以免重犯）**

1. 首版把 `isExecutionSourceBasis` 之外的「同 kind 覆盖」误扩成了「同 kind **注入**」：没有候选事实时也凭空注入 `unknown`，导致显式 `--request ut` 被自己的 unknown 事实经 definition-gap 通路把 ut 从 `needed` 里删掉（`request-ut` / `testing-fail` 两个模式报「empty scope」）。**覆盖与注入是两条规则**：覆盖永远执行（防洗绿），注入沿用既有条件（有真实来源，或 feature 终点且该阶段未被显式请求）。修正后 16 → 9。
2. 首版把「impact 缺失 → device unknown」写成无条件，会把「验收确有设备层（required）」也降级成 unknown——那正是 D0.1 要防的洗绿方向。需求原文是「即使由验收算出 not_applicable，还必须有影响判断**才能裁掉** testing」，即 impact 只把关**裁剪**。已改为：仅当验收派生为 `not_applicable` 时，缺 impact 才落 unknown；`required` 恒保持。

#### 与 plan 的偏离 / 放弃的准确性（本笔）

| # | 事项 | 说明 |
|---|---|---|
| 1 | **`visual_requested` 的机器来源 —— 已由调度者裁决（2026-09-15），不再是偏离** | 我实施时发现 §3 问题 10 / §4.1.2 给 visual 派生点名了 `loadFidelityIntentSsotState` 与 `fidelityIntentSsotPath`，却**从未点名**「请求 / 蓝图是否含视觉要求」这一维的机器来源，遂暂用「只有存在的 spec.md 且未声明 `ui_change:false` 才算有视觉要求」并停下汇报。**调度者裁决 2026-09-15：用既有 `resolveUiRelevanceForRun`（`fidelity-shared.ts:1259-1270`）**——spec.md 在时看 `ui_change`（`UI_CHANGE_REQUIRES_UI_SPEC`），不在时回落 `detectUiRelevantRequirement(requirement)`；goal-preflight 与 goal-runner 已共用它，**不得再造第三个读法**。我暂用的「缺 spec.md 算无视觉要求」**不采纳**，改为按需求文本判。已落代码，`requirement` 实参三处来源见 §3 问题 10 裁决表，每个调用点代码注释写明来源。 |
| 2 | impact 相关性（§4.1.3 第 4 条）在读取层判定 | plan 写「`resolved.targets` 传入，resolver 只做集合相交」。实际路径归一化需要 `projectRoot`，进 resolver 就破了纯函数约束。改为：读取层算出每条 basis 的 `related` 布尔并填进 `impact_basis`，`targets` 原样保留在结构里供诊断与复核；resolver 只读 `ok && related`。**调度者已接受。** |
| 3 | `resolveUiRequirementSignal` 的提取 —— **已整体撤回** | 我曾把 `capability-resolution.ts` 的 `applicability.ui` 分支外提为导出函数供读取层复用（§4.1.6 清单外的一处改动）。裁决改用 `resolveUiRelevanceForRun` 后它**不再有任何消费者**，故按调度者要求整体撤回，`applicability.ui` 分支回到原样——`git diff harness/scripts/utils/capability-resolution.ts` 现为空，diff 只留必要面。 |

#### D0.1 续（调度者裁决 2026-09-15 落地后）

**`visual_requested` 裁决已落地**：改用既有 `resolveUiRelevanceForRun`（`fidelity-shared.ts:1259-1270`），`requirement` 三处实参来源见 §3 问题 10 裁决表，每个调用点代码注释写明来源。我暂用的「缺 spec.md 算无视觉要求」已撤销。
**`resolveUiRequirementSignal` 提取已整体撤回**：裁决后无消费者，`git diff harness/scripts/utils/capability-resolution.ts` 现为空。

**夹具改造（§4.1.6 / §4.3 第一项）**：`execution-scope.unit.test.ts:150` 的 `device:impact` 自报事实改为 `input.request.impact`，basis 指向真实产品文件（在 `contracts.files` 内）。

**验证**：typecheck 退出 0；`npm run test:unit` → **4475 passed, 9 failed（共 4484）**（与改夹具前同数，但失败内容前进了一步，见下）。

#### 新发现：plan §4.1.4 与 §4.3 冲突（需裁决，已阻断 D0.1 收尾）

夹具改成 `request.impact` 后，`design-gap` 模式的失败信息变为：

> `[execution-scope] 影响依据与本次范围无关：code: dependencies verified (no parsed value for derive.codebase) | 目标集合=空`

追下去是同一个根因，且牵连两处：

**代码事实**：`resolveArtifact`（`capability-resolution.ts:233-243`）对 `acceptance@1` / `contracts@1` / `use-cases@1` 返回的是 **SpecLoader 解析后的值**（`parsed.contracts` 等），不是 YAML 原文；而 `readBoundInput`（`:496`）比的是 `sha256(stableStringify(result.value))`。生产侧绑定由 `resolveCapabilityInputs`（`:598-601`）用同一条解析结果算指纹，故自洽。**但测试夹具 `execution-scope.unit.test.ts:143` 是手算的**——`sha256(stableStringify(YAML.parse(原文)))`，与 SpecLoader 解析值不同。

**后果**（两条，都由 §4.1.4「`satisfied_by` 一律 `readBoundInput` 重解析」触发）：
1. 读取层读 `contracts@1` 取 `files` 以组装 `targets.contracts_files` 时 `readBoundInput` 抛错 → 目标集合为空 → 合法 impact 被判「与范围无关」；
2. `verifySatisfiedByBinding` 对夹具里 `design:cu` 的 `satisfied_by`（同一手算绑定）同样会拒。

**冲突点**：§4.1.4 要求 `satisfied_by` 一律经 `readBoundInput` 重解析（第三轮 review 建议 1 明确要求，不得放宽）；而 §4.3 的测试改写清单写着「`execution-scope.unit.test.ts:143` 手算指纹 | **保留**（D0.2 前测试仍自建绑定；批次 2 追加『生成器绑定与 `resolveCapabilityInputs` 指纹一致』的用例）」。两者不可同时成立——手算指纹过不了 `readBoundInput`。

**建议处置（待裁决）**：把「绑定经 `resolveCapabilityInputs` 构造、指纹与生产同源」从批次 2 提前到批次 1 的夹具改造里，即 §4.3 该行由「保留」改为「改为经 `resolveCapabilityInputs` 取绑定」。理由：这不是放宽判据，而是让夹具与生产用同一条造绑定路径——正是仓库既有纪律（禁止手工拼对象冒充生产接线）。**不建议**反向放宽 §4.1.4，那会把「满足依据可重现」这条 D0.1 护栏打掉。

在此裁决前，D0.1 的剩余 9 个失败无法收敛，故暂停，不自行改方案。

**剩余 9 个失败分布**：`execution-scope.unit.test.ts` 系列 5（direct / design-gap / P7×3）、`obligation-scoped-verification.unit.test.ts` 2、`standalone-coding-review.unit.test.ts` 1、`capability-resolution` 相关 1。

#### D2 第二笔 — 仍未开始

**调度者裁决 2026-09-15（第二条）**：采纳上条建议——§4.3 的「`:143` 手算指纹保留」改为「**批次 1 即改为经 `resolveCapabilityInputs` 构造绑定，指纹与生产同源**」；§4.1.4 的「`satisfied_by` 一律 `readBoundInput` 重解析」**不放宽**。裁决理由与我一致：手算 `sha256(stableStringify(YAML.parse(原文)))` 与 `resolveArtifact` 返回的 SpecLoader 解析值本来就是两个口径，夹具冒充生产绑定是仓库明令禁止的模式（verification-must-target-production），这次是它被 D0.1 护栏正确抓住。
配套已落：§4.3 该行改写；§5.4 的「生成的绑定与 `resolveCapabilityInputs` 指纹一致」改为「批次 1 已交付，批次 2 复用」。夹具里所有手拼 InputBinding 统一改走 `resolveCapabilityInputs`，不留第二种造法。

**夹具绑定改造已落**（裁决第二条）：`execution-scope.unit.test.ts` 里**全部**手拼 InputBinding 改走生产解析器——新增 `liveBinding(phase, id)` helper（内部调 `resolveCapabilityInputs`，断言 `state === 'resolved'` 后取其 `binding`），替换四处：`design:cu` 的 contracts 绑定、`request.impact.basis`、design-gap 注入的 fresh codebase 绑定、`afterHarnessPass` 的 fresh acceptance 绑定。**不留第二种造法**；`stableStringify` / 手算 `content_fingerprint` 在该文件的候选构造里已清零。
另加一处诊断（生产侧）：`collectResolvedScopeFacts` 读 contracts 失败时不再静默吞，把原因写进 `impact_basis[].detail`（`contracts read ok, files=N` / `contracts unreadable: <msg>`）——「合法 impact 被判无关」最常见的根因就是契约读不出来，吞掉它等于让下游猜。

**验证**：typecheck 退出 0；`npm run test:unit` → **4475 passed, 9 failed（共 4484）**（数不变，但 design-gap 的失败信息再次前进，定位到下面这条）。

#### 新发现：§4.1.3 的 impact 相关性规则在「无声明写集」时自相矛盾（需裁决，阻断 D0.1 收尾）

用 `--filter "scope lifecycle: design-gap"` 单跑拿到的诊断原文：

> `影响依据与本次范围无关：codebase: dependencies verified (no parsed value for derive.codebase) | 目标集合=空 | contracts read ok, files=0`

即：**contracts 读取成功，但 `files` 本来就是空的**。核实夹具 `harness/tests/fixtures/component-blueprint/valid/doc/features/ledger-app-blueprint/ledger-refresh/contracts.yaml`：`modules: []`、`files: []`、`change_unit.predicate_mappings: []` —— 这是一份**刻意不声明写集**的 CU 结构夹具。

于是 §4.1.3 第 4 条的目标集合为空 → 任何 impact basis 都判「无关」→ **零设备候选永远冻结不了**，直接与 D0.1 自己的验收行「D0.2 正常生成的零设备候选（验收全 unit、fidelity 非 pixel、impact=false 且 basis 在项目内）可冻结且裁掉 testing」冲突。

两个层面的问题，**都超出 plan 字面**：

1. **规则层**：§4.1.3 假定「本次实际范围」总能算出一个非空目标集合。当 `contracts.files` 为空且无 implementation 事实时，「无关」这个判定没有意义——此时该拒的是「范围没声明写集」这件事本身（属 scope 问题），而不是把 impact 判成无关。plan 没有定义这一态。
2. **夹具层**：`design-gap` 模式 `requested_phases` 含 `coding`（确有 implementation 义务），但夹具只给 `direct` 模式加了 implementation 事实与写集 basis；`direct` 因此 `implementation_files` 非空、impact 判定通过，`design-gap` 则为空。真实形态下「请求 coding」的候选本就该带一条有写集来源的 implementation 事实。

**我的建议（不自行实施，等裁决）**：
- 规则层：目标集合为空时**不判「无关」**，改为按「范围未声明可核验的写集」拒绝并给出该原因（保持 fail-closed，但把责任指到正确的地方）；或明确允许「无写集声明时相关性检查跳过、仅保留前三条 basis 核验」。二者都需要点名，我不替 plan 定。
- 夹具层：给 `design-gap`（以及任何 `requested_phases` 含 coding 的模式）补上与 `direct` 同款的 implementation 事实 + 写集 basis。这一条我认为是纯粹的夹具真实性修正，但它会改变该用例的出生范围形状，所以一并请裁决。

在此之前不动方案，D0.1 的 9 个失败无法收敛。

**剩余 9 个失败**：`execution-scope.unit.test.ts` 系列 5（direct / design-gap / P7×3）、`obligation-scoped-verification.unit.test.ts` 2、`standalone-coding-review.unit.test.ts` 1、其余 1。其中 design-gap 已定位到上述根因；direct 的失败是另一条断言（尚未逐条定位）。

**调度者裁决 2026-09-15（第三条）已落地**：

- **规则层**（§4.1.3 新增子情形表）：目标集合为空时一律不判「无关」。(a) 含 implementation 义务但无可核验写集 → 拒绝，文案「范围未声明可核验的写集（contracts.files 为空且 implementation 无写集来源），责任方 plan」（与 `check-coding.ts:326` 同口径，前移到冻结时）；(b) 无 implementation 义务且无 review/UT 目标 → 走既有「影响依据缺失」同一条路，device `unknown`、reason「影响依据无可核验范围」、testing 不裁。
  实现：读取层只多给一个布尔 `ResolvedScopeFacts.impact_targets_available`；「是否含 implementation 义务」由 resolver 用既有 `OBLIGATION_PROVIDERS` 注册表算（**不硬编码 `coding` 这个 phase id**）。
- **夹具层**：`design-gap` 与任何 `requested_phases` 含 coding 的模式，出生候选补与 `direct` 同款的 implementation 事实 + 写集 basis（经 `liveBinding` 构造）。**未改** `harness/tests/fixtures/component-blueprint/valid` 里共享的 contracts.yaml（`modules`/`files` 为空是它作为 CU 结构夹具的既定形态，多处测试依赖）。
- **§4.4 已补两行用例**（(a)/(b) 各一）。

**用例出生范围形状变化（按裁决要求记录）**：`design-gap` 模式的出生候选此前只有 `design:cu` 一条事实，现多一条 `implementation:source`（required，basis = 经 `liveBinding('plan','codebase')` 的写集来源）。因该模式 `requested_phases` 本就含 `coding`，implementation 义务此前由 `<kind>:request:coding` 兜底生成；补事实后该兜底不再触发，义务改由事实承载、且带上了写集来源。出生 `phase_chain` 形状不变（仍 `['coding','review','ut']`），变化的是 implementation 义务的 basis 从空变为有来源。

**夹具第三处真实性修正（同一裁决精神，已落）**：`direct` / `design-gap` 的出生候选还必须绑定**验收来源**。核实该 CU 夹具（`component-blueprint/valid/.../ledger-refresh`）**根本没有任何验收内容**——无 `acceptance.yaml`，`liveBinding('ut','acceptance')` 报 `spec: 缺精确 acceptance 内容，design_refs/verification_refs 不等价于设计`。因此该场景在**测试自己的临时 root** 里写入一份 unit 层验收（`criteria: [{id: AC-REFRESH, priority: P1, ut_layer: unit, ...}]`）再取绑定；**共享夹具目录一个字节没动**（裁决要求）。
同时 `design-gap` 的 `onCoding` 改为也修改产品文件——它提出的修订必须带**新的有来源事实**（`goal-phase-runtime.ts:9084`），而出生候选现在已经绑了同一份 codebase 来源，文件不变就产不出新事实。

**验证**：typecheck 退出 0；`npm run test:unit` → **4475 passed, 9 failed（共 4484）**。计数未变，但失败阶段连续前移三轮（冻结期 impact 拒绝 → 范围可冻结 → 进入执行/完成阶段），说明每一步确实解开了一层。

#### 新发现：impact.basis 在修订期被重新核验字节，与「coding 本就会改这些文件」直接冲突（需裁决）

`design-gap` 现在的报错：

> `[execution-scope] 影响依据不可用：codebase: 依据字节已变化 ...\AllBanksPage.ets`

链条：出生时 `request.impact.basis` 绑的是 `derive.codebase` 对产品文件的**当时字节**；coding 按设计修改了该文件；修订期 R4 再次调 `collectResolvedScopeFacts`，`verifyBasisBinding` 比字节 → 必然不一致 → 拒绝整条修订。

**这是 §4.1.3 第 3 条套到修订路径上的结构性问题**：impact 是「出生时对代码的影响判断」，它的 basis 按定义就是**会被 coding 改掉**的那些文件。只要 coding 动过写集，任何继承的 impact 都会在下一次修订时被自己的 basis 判死。

与 §4.1.0 已定的规则 1 也不自洽：「修订未提供新 impact 时，从当前有效范围的 `request_impact` **原样继承**」——继承的判断不应被重新审一次来源字节。

**我的建议（不自行实施）**：impact.basis 的字节核验**只在冻结/出生时做**；修订路径上——
- 修订**未**提供新 impact（原样继承 `request_impact`）→ **不重新核验** basis 字节（它是历史观察，与 §5.1.1a 对 `design-decision` 触发文件的处理同一取向）；
- 修订**提供了新** impact（§4.1.0 规则 2 的「可更正」）→ 按出生时完全相同的四条核验，因为那是一次新的、针对当前代码的判断。

实现上就是 `collectResolvedScopeFacts` 多接一个「impact 是否为本次新提供」的标记，继承态跳过 impact_basis 的字节比对（其余核验不变）。**不放宽出生期，不放宽 satisfied_by。**

#### 仍待定位

`direct` / `P7 ×2` 现在失败于 `{"verdict":"INVALID","reasons":["无 feature-completion 投影"]}`——范围已能冻结、链能跑，但完成凭证没生成。尚未逐条定位；怀疑与 `goal-phase-runtime.ts:9780` 的完成生成资格（读**出生**范围的 `unresolved`）有关，而那正是 §4.2.3 列为 D2 必改的四个漏列消费点之一。若属实，这几条要等 D2 才能收敛，届时在 D2 一并验收。
`P7 two real CU runs` 仍 `execution_scope_unresolved: device-evidence: 验收缺失`——该用例走的是另一个 CU（`ledger-consumer` 等），同样无验收内容，需比照本轮的第三处修正处理。
`obligation-scoped-verification` 2 条与 `standalone-coding-review` 1 条仍是「候选不带 impact / 不带验收绑定」同一类，待同款修正。

**调度者裁决 2026-09-15（第四条）已落地**：impact.basis 的**内容核验只在出生 / D1 首次冻结时做**。修订路径上——继承态（本次未提供新 impact）**不重比内容**，只保留「项目内 + 路径未消失」的完整性检查（它是出生时刻的历史观察，取向与 §5.1.1a 对 `design-decision` 触发文件一致）；本次**提供了新** impact（D2 B2 的有来源更正）时按出生期完全相同的四条核验。
实现：`collectResolvedScopeFacts` 的 ctx 加 `impactInherited?: boolean`，`verifyBasisBinding` 加 `skipContentCheck`；两个修订调用点各自声明——R4（runtime）按「proposal 是否自带 impact」计算，R3（checker 修订预算）恒 `true`（它从不新写 impact）。**出生期与 `satisfied_by` 一行未放宽。**

**D0.1 纯函数级验收：13 / 13 全绿。** 用 `harness/tests/d01probe.ts`（临时探针，批次 1 收口后删除）直接打 `resolveExecutionScope`，逐条对应 §4.4：

| §4.4 验收行 | 结果 |
|---|---|
| 自报 device `not_applicable` 经验收分层重算为 required | PASS |
| 自报 visual `not_applicable` 经 fidelity SSOT 重算为 required | PASS |
| SSOT 缺失且无视觉要求 → visual `not_applicable`（不强迫补文件） | PASS |
| SSOT 损坏 / 有视觉要求未定档 → unknown，testing 不裁 | PASS |
| 验收全 unit 但无 impact → device unknown，testing 保留 | PASS |
| impact=true → device required，且 `request_impact` 回写进范围 | PASS |
| 有来源 impact=false + 验收无设备层 → device `not_applicable`、testing 被裁 | PASS |
| `satisfied_by` 冻结时核验失败即拒绝冻结 | PASS |
| **(a)** 含 implementation 义务但无可核验写集 → 拒绝，文案含「责任方 plan」 | PASS |
| **(b)** 无 implementation 义务且无 review/UT 目标 → device unknown、reason「影响依据无可核验范围」 | PASS |
| 定义缺口（方案 A）让 owner（spec）进入可执行链且进 unresolved | PASS |
| 验收含 device 层时缺 impact **不得**把 required 降级 | PASS |
| 验收 unit 层链形状不变 | PASS |

#### 剩余 9 个 runtime 级失败：逐条标注依赖（按裁决第四条要求，不在 D0.1 上死等）

| # | 用例 | 现失败点 | 依赖的 §4.2.3 消费点 / 处置 |
|---|---|---|---|
| 1 | `real prepare CLI / bridge scope lifecycle: direct` | `{"verdict":"INVALID","reasons":["无 feature-completion 投影"]}` | **D2 依赖**：`goal-phase-runtime.ts:9780` 的完成生成资格读**出生**范围 `unresolved`（§4.2.3 新补的四个漏列消费点之一）。范围已能冻结、链能跑完 |
| 2 | `P7 Feature evidence cannot credit an unmapped CU goal` | 同上 | **D2 依赖**，同 `:9780` |
| 3 | `P7 new default creates real attended completion and CU credit without testing` | 同上 | **D2 依赖**，同 `:9780` |
| 4 | `real prepare CLI / bridge scope lifecycle: design-gap` | 裁决第四条落地前为「影响依据不可用：依据字节已变化」 | 本轮已修；其后续断言属 successor→revision 迁移，**D2 依赖**（§4.2.2 删除清单 + §3 问题 4 断言迁移） |
| 5 | `P7 two real CU runs retain distinct scopes and Component combination duties` | `execution_scope_unresolved: device-evidence: 验收缺失` | **夹具依赖**：走另一个 CU（`ledger-consumer` 等），同样无验收内容，比照本轮第三处修正处理（D2 阶段一并做） |
| 6 | `validated spec facts reach actual P2 acceptance reader…` | `device-evidence:acceptance` unknown「影响依据缺失」 | **夹具依赖**：`obligation-scoped-verification.unit.test.ts` 的候选不带 `request.impact`，同款修正 |
| 7 | `performance shares explicit layers…` | `hasNoTestingObligation(scope)` 为假 | **夹具依赖**：同上文件，同款修正 |
| 8 | `zero-testing reconcile CLI validates frozen scope…` | attended-goal-context 上下文不完整 | **夹具依赖**：同上文件 |
| 9 | `birth to coding uses real bound design…` | `critical_skip_ids: visual_parity` | **夹具依赖**：`standalone-coding-review.unit.test.ts` 的候选不带 impact / 验收绑定 |

按裁决第四条的推进顺序：D0.1 纯函数级已全绿，上述 9 条全部标注依赖后**直接进 D2**；D2 完成后统一跑 `npm test` 全量 + `openspec:validate`，届时批次 1 必须整体全绿。

#### D2 第二笔 — 进行中

> 状态锚点：**生产代码与测试全部 typecheck 通过（退出 0）**；尚未跑 unit / openspec。任何代理从这里接手都可直接编译。

##### 已完成：§4.2.1 事件 + §4.2.3 有效范围入口

`harness/scripts/utils/goal-run-creation.ts`
- 删 `interface ScopeRevisionRequested`，改为 `ScopeRevisedEvent`（字段照 §4.2.1：`revision_index` / `previous_scope_fingerprint` / `execution_scope` / `revision_input` / `trigger` / `allowed_fields` / 可选 `run_base_sha`），注释里把「能发现 / 不承诺发现」两档如实写明；
- 新增 `loadScopeRevisions`（排序 + index 连续 + `previous_scope_fingerprint` 链回出生指纹 + 逐条 `validateExecutionScope` + `allowed_fields` 边界校验；**任何一项不成立即抛错，绝不退回出生范围继续跑**）；
- 新增 `applyScopeRevisions(birth, events)`、`loadEffectiveExecutionScope(projectRoot, feature, runId)`、`resolveRunBaseline(manifest, events)`（出生值优先；出生无值时取**唯一**一条携带基线的修订事件，多于一条即判链损坏）、`loadAuthoritativeRunEvents`（有效范围与基线共用一次读盘）；
- `validateExactSha` 由私有改为导出（40-hex 规则单一实现，供事件层基线冻结复用）。

##### 已完成：§4.2.2 删除清单

| # | 项 | 完成情况 |
|---|---|---|
| 1 | `ScopeRevisionRequested` 类型 | **已删**（由 `ScopeRevisedEvent` 取代） |
| 2 | 该事件全部读取点 | **已删**：`goal-run-creation.ts` 内读取随 `createScopeSuccessor` 一并删除；`goal-phase-runtime.ts` 的 `cleanupScopeAncestors` 内读取、`:9334` 的 `prior` 查询均已删除 |
| 3 | 该事件 emit | **已删**，原位替换为 `scope_revised` 追加 |
| 4 | `createScopeSuccessor` 整函数 + import/调用点 | **已删**：函数体删除并留一段说明注释（写明 successor 只保留给失败修复型 supersede / 用户显式改需求 / creation-incomplete 修复）；runtime 的 import、resume 路径调用、run 循环调用全部移除 |
| 5 | `cleanupScopeAncestors` | **已删**：定义与两处调用全删（无后继链即无祖先可清；同 run 恢复状态由既有 run 级 GC 承接） |
| 6 | `onScopeHandoff` → **改名** `onScopeRevision('applied')` | **已改**：`GoalPhaseRuntimeLaunchOptions`、runtime 触发点、`goal-mode-entry.ts` 的类型与透传、**测试辅助器三处**（`goal-runner-testing-integrity.unit.test.ts` 的参数声明 + 两处转发）全部同批改名 |
| 7 | 四个 handoff 测试模式 | **已改**：mode 联合类型与 for 枚举由 `successor/intent/released/born` 换成 `revision/revision-cut/revision-precut`；注入块改挂 `onScopeRevision`。**断言迁移尚未做**（见下方未决项） |
| 8 | `goal-phase-runtime.ts` 的 detached 守卫 | **已删**，原位留注释说明由 `assertGoalRunAttachable` + `inspectGoalRunCreation` 承接、并指向 §7.2 记录的放弃准确性 |
| 9 | P2 §6.1–§6.3 正文 | 不删（裁决本身），属 §4.2.5 OpenSpec/plan 文档面，**未做** |

##### 已完成：运行时修订应用（§3 问题 3 的顺序）

`goal-phase-runtime.ts` 的 `revise_scope` 分支整体重写：
- 在**同一 run** 追加 `scope_revised`（走既有 `goalEvents.emit`），**不封卷、不释放 owner/Feature 锁**——该块仍在既有 `acquireGoalLocks` 的 finally 内，`releaseAllLocks` / `releaseRunOwner` 不被调用；
- 幂等按 `revision_input` 指纹去重（D2.8「修订写入后立即中断再重入」）；
- 应用前调**共用**的 `assertRevisionKeepsRequiredObligations`（§4.2.4：从 `blueprint-skill-projection.ts` 的既有 BLOCKER 提取为 `findSubtractedRequiredObligations` + 抛错包装，checker 侧改为调用同一函数，**不复制谓词**）；
- `run_base_sha` 三条充要条件（manifest 无基线 + 既有修订都没带过 + 本次修订后的链含 coding/ut）同时成立才携带，取 `resolveGoalRunHeadSha` 并过 `validateExactSha`；
- 修订输入与触发 check id 在读取 `script-report.json` 时一并捕获（`pendingScopeRevisionInput` / `pendingScopeRevisionCheckId`）；
- **修订比较基准改为当前有效范围**（`applyScopeRevisions(birth, events)`），不再与出生范围比——否则合法的第二次修订会被判成请求边界漂移。

##### 已完成：§4.2.3 的链 / 游标 / 主循环（部分）

- `const chain` → `let chain`（`:5172`），修订落地后整体重赋值为新的有效范围链——只改派生的 `frozenChain` 切不动主循环，这是第二轮 review B3 点名的坑；
- 主循环 `for (let phaseIdx = chainStartIndex; ...)` 去掉 `!scopeRevisionRequested` 早退条件（修订让**同一个**循环继续跑）；
- 游标不做 `+1` 推进，按「新链中第一个尚无有效 PASS 结果的阶段」重取（删段 / 插段 / 回退责任阶段三种形状共用一条规则）；
- `GoalPhaseRuntime.run()` 的 `for(;;)` 重启循环与 `nextArgs` 重启 argv 一并删除（无后继即无重启），resume 与收尾两处 `loadFrozenExecutionScope` 换 `loadEffectiveExecutionScope`。

##### 已完成：§4.2.3 的 13 个消费点 + B3 四个漏列点 + 终点判定（未决项 1–3）

**13 个消费点全部换入口**（`grep loadFrozenExecutionScope` 现只剩两处**合法的出生范围读取**：`verify-feature-completion.ts` 内取 birth 做 `scope_revision_count` 对账与「缺出生范围即 INVALID」）：

| 文件 | 处置 |
|---|---|
| `harness-runner.ts:547/549` | → `loadEffectiveExecutionScope` |
| `assess.ts:450` | → 同上 |
| `capability-resolution-entry-input.ts:229` | → 同上 |
| `capability-resolution.ts:504-505`（`readRunBoundContracts`） | → 同上 |
| `blueprint-skill-projection.ts:59` | → 同上 |
| `change-unit-completion.ts:80 / :96` | → 同上 |
| `feature-track.ts:31` | → 同上 |
| `upstream-verdict-gate.ts:41` | → 同上 |
| `verify-feature-completion.ts:107 / :541 / :567` | → 同上 |
| `verify-feature-completion.ts:883` | 改为 **birth 读一次**（缺即 INVALID）+ **effective 作对账基准** |

**B3 点名的四个漏列消费点**：
- `:4855 requestedChain` / `:4864 fullWorkflowChain` → 新增 `effectiveBirthScope`（出生 + 已应用修订）统一供给；
- `:6641 checkPlanAuthority` → 传有效范围**并**传 `currentRunId`（同 run 刚闭环的 plan 证据不得被判 live_drift）；
- `:9066 revise_scope` 的比较基准 `old` → 有效范围（第二次修订不再与出生范围比）；
- `:9833 完成生成资格` → **读有效范围**。这是「无 feature-completion 投影」三条失败的直接根因：`[spec]` 出生的 run 其出生 `unresolved` 永远非空，读出生值等于让 D2 主场景结构上拿不到完成凭证。

**终点判定（未决项 2）**：`:9688` 的 `outcomes.length === chain.length` 数量等式删除，改为**按最新有效结果覆盖 chain**（`latestOutcome(phase)` 取该 phase 最后一条，要求 PASS 且未 advance_blocked）。按第三轮 M1 裁决：**`outcomes` 保持当前有效结果投影**（回退时 `:6677`/`:9509` 的 filter 原样保留），执行历史只由 events 保存，**不做「只追加」**。`terminalChain` 同步改为 `chain.map(String)`。

**未决项 3（`scopeRevisionRequested` 残留）**：声明、`break` 早退、`:9833`/`:9893` 两处引用全部删除。

**§3 问题 9 的基线读点（A1/A2）一并接线**（原先漏接，实跑报 `framework_corruption: immutable run_base_sha is unavailable`）：
- A1 `goal-run-baseline.ts:27-36` → `resolveRunBaseline(manifest, events)`，失败文案改为「既无 manifest.run_base_sha 也无携带基线的 scope_revised」；legacy/env 回退仍禁止；
- A2 `goal-phase-runtime.ts:7241` 的 `runtimeFacts.runBaseSha` → 同一 resolver。
- B 类（manifest identity / drift / replay 三层防线）**一行未改**——修订路径下 `manifest.run_base_sha` 自始至终不被写入，故「manifest 里出现变化 = 篡改」这条防线原样成立。

**§4.2.6 完成判定（顺带做掉，避免同处改两遍）**：
- `FeatureCompletion` 加 `scope_revision_count?: number`，writer 按事件实算；
- verifier 先读 birth（缺即 INVALID），再取 effective 作 `execution_scope_fingerprint` 与 `expectedChain` 的基准，并**对账 `scope_revision_count` 与事件数**，失配即 INVALID；
- `collectCleanPassIssues` 与 `scope-replan.checkPlanAuthority` 各加 `runId` / `currentRunId`，透传给 `executionScopeEvidenceIssues`——同 run 未封卷的证据不再被终局检查误杀，历史 run 判据一行未放宽。

##### 已完成：测试断言迁移（未决项 4，部分）

`execution-scope.unit.test.ts` 的 else 分支按 §3 问题 4 表**逐条迁移，无一删除**：交接意图→`scope_revised` 唯一且 index=1；源阶段调用次数按模式分开（design-gap 的 coding **两次**并断言 invoke_id 不同，revision 的 spec 仍一次）；新链改断言 `loadEffectiveExecutionScope`；新增反向断言**出生 `end_phase` / `phase_chain` 不被改写**（按第三轮 M1 改为与**事先捕获的出生值**比，不写死 `'spec'`）；`successor_of` 不存在 + `goal-runs` 仍只有一个目录；`run_created` 仍一条；预算连续性改断言**修订之后**首个 invoke 仍 `-i2`；design-gap 追加「失败记录保留 + 修订时未写 run_end + 最终 CHAIN_SLICE_COMPLETED」三条。
注入块改挂 `onScopeRevision('applied')`；mode 联合类型与 for 枚举换成 `revision` / `revision-cut` / `revision-precut`。

##### 实跑暴露并修掉的四个自身错误（D2 期，记录以免重犯）

跑通链路的过程里，失败信息连续前移四轮，每轮都指向一个真实错误：

1. **A1/A2 基线读点漏接**（实跑报 `framework_corruption: immutable run_base_sha is unavailable`，5 个用例）。我写了 `resolveRunBaseline` 却没接到 `goal-run-baseline.ts:27-36` 与 `goal-phase-runtime.ts:7241`。已接；B 类三层防线仍一行未改。
2. **完成判定传了两份不同的范围**：`chain` 取自有效范围而 `executionScope` 仍传 `manifest.execution_scope`（出生），于是 `verify-feature-completion.ts:246` 的「完成链与冻结范围失配」必然触发。已统一为 `completionScope`，并把 `chain` 改为**在完成点按 `completionScope` 重算**（`completionChain`），不再复用启动时的 `fullWorkflowChain`；`resolvePhaseRunIds` 同步用它。
3. **把 `impact.basis` 折进了 device 义务的 basis**。impact 是**请求级**事实，已经随 `request_impact` 连同它自己的 basis 一起走；再复制进义务 basis，等于把一份「出生时刻的代码观察」塞进完成期会逐字节核验的证据链——coding 一改写集就 stale（实跑报 `device-evidence:acceptance: input binding stale`）。已去掉复制，义务的 `reason` 仍记「影响判断：…」。
4. **§5.1.1a 的白名单只写进了 plan，没落到代码**。`execution-scope.ts:110` 的 `isExecutionSourceBasis` kind 白名单仍是原来五项，`design-decision` / `acceptance-definition` 不在内，于是 design-gap 的触发文件在完成期被判 `design:new-api: input binding stale`。**已补**这两个 kind（前置条件 `role==='derive'` + 项目内 + 责任阶段在链或有 run 证据一条未加）。这条是「写进 plan ≠ 落进代码」的实例，收口前须逐条回读 plan 的每个"已定"改动点。

另修一处产品可观测性：`feature_completion_skipped` 事件此前只报 `pending=N`，逼着读者猜是哪条义务挡住了凭证；已改为把前 6 条 issue 的 `[phase] condition: detail` 一并打出——本轮四个错误全是靠它定位的。

另删一处发明：读取层原本给 fidelity SSOT **伪造**了一个 `InputBinding`（手搓 `content_fingerprint`）放进 visual 义务的 basis，完成期同样被逐字节核验（`visual-evidence:fidelity: input binding stale`）。SSOT 是**派生来源**不是 P1 可解析输入，已彻底移除该伪造绑定与 `ResolvedScopeFacts.fidelity.binding` 字段；visual 的 `reason` 仍记录定档状态。手搓绑定在夹具里被禁，在生产里更不该有。

**D0.1 纯函数探针复跑：13 / 13 仍全绿**（上述改动未回归 D0.1）。

##### 当前实跑状态（D2 未收口）

`npm run test:unit` → **4469 passed, 14 failed（共 4483）**。typecheck 退出 0。D0.1 纯函数探针 13/13。

与 D2 开工时（15 failed）相比，已消除的失败类别：`framework_corruption: run_base_sha 不可用`（5 例）、`duplicate handoff intent`（2 例）、`birth end_phase was rewritten`（3 例）、`device-evidence / visual-evidence / design:new-api input binding stale`（3 类）、`完成链与冻结范围失配`。`direct` 与 `P7 unmapped` 已越过完成凭证生成，推进到更后面的复用断言。

**剩余 14 条的分类与下一步**：

| 类别 | 条数 | 现象 | 下一步 |
|---|---|---|---|
| 修订后责任链未被重新派发 | 6（revision / revision-precut / design-gap / detached ×3） | `无 feature-completion 投影`，跳过原因是 `[coding]/[review]/[ut] verdict_pass: summary verdict=缺失`——即修订把链扩到 coding→…→testing 后，这些阶段**没有真正跑** | 查修订落地后的 `chain` 重赋值与游标重取是否真的作用到主循环（detached 走 `GoalPhaseRuntime` 另一条入口；`afterHarnessPass` 注入的修订发生在 spec 之后，需确认此时 `phaseIdx` 计算基准正确） |
| `revision-cut` 的预算连续性断言 | 1 | `revision reset consumed turns` | 中断重入后首个 invoke 的 `-i2` 断言需按 run 内语义再核（中断发生在 emit 之后，重入不应重复追加，但 invoke 序号基准要确认） |
| 复用证据断言 | 2（direct / P7 new default） | `fully reused Feature evidence did not validate` | `verifyReusedExecutionScope` 走 `executionScopeEvidenceIssues` 且未传 `currentRunId`；需判断此处该不该传（它验的是**既有完成记录**，可能应保持严格） |
| 夹具未改（批次 1 早期已标注的依赖） | 4（`obligation-scoped-verification` ×3、`standalone-coding-review` ×1） | 候选不带 `request.impact` / 验收绑定 | 比照 `execution-scope.unit.test.ts` 的三处夹具修正同款处理 |
| CU 无验收内容 | 1（`P7 two real CU runs`） | `execution_scope_unresolved: device-evidence: 验收缺失` | 比照第三处夹具修正（临时 root 写 unit 层验收） |

##### 修订链重新派发的真根因（6 条一次销号）

调度者的单一根因猜测成立，且比预想更靠前。链路上共三处「同一条链必须来自同一个范围」的断点，逐个实跑定位：

1. **`frozenChain` 读的是 `manifest.phase_chain`（出生值）**（`goal-phase-runtime.ts:5152`）。`manifest.phase_chain` 按 §4.2.3 的裁决**必须保持出生值**（身份投影），所以它不能再驱动执行——`[spec]` 出生的 run 修订后仍只执行 `[spec]`，resume 后直接收口。改为：有 `execution_scope` 的 run 一律用 `requestedChain`（已是有效范围链），legacy run 才回落 `manifest.phase_chain`。**这一处修好后，D2 主场景在实跑里真正跑通**：events 显示 `spec(total=1)` → 修订 → `coding/review/ut/testing(total=4)` → `CHAIN_SLICE_COMPLETED`。
2. **完成凭证生成器仍收启动时的 `fullWorkflowChain`**（`:9876`），而它的 `executionScope` 已是有效范围 → `verify-feature-completion.ts:246` 的「完成链与冻结范围失配」必然触发。改为传同一个 `completionChain`。
3. **verifier 的 clean-pass 重算未传 `runId`**（`verify-feature-completion.ts:1040`）→ 生成 run 自己刚闭环、尚未封卷的阶段被终局检查误杀。已传 `completion.run_id`；历史 run 判据一行未放宽。

三处的共同教训：**凡「链」与「范围」成对出现的地方，两者必须来自同一次求解**；本 plan 里这对东西出现了五处（启动、主循环、完成资格、clean-pass、生成器），错了三处。

**实跑：`4476 passed, 7 failed（共 4483）`**（D2 开工时 15 failed）。修订全族（`revision` / `revision-cut` / `revision-precut` / `design-gap` / `detached` ×3）**全部通过**。

##### 剩余 7 条

| # | 用例 | 类别 |
|---|---|---|
| 1 | `birth to coding uses real bound design…` | 夹具：`standalone-coding-review.unit.test.ts` 候选不带 impact / 验收绑定 |
| 2 | `performance shares explicit layers…` | 夹具：`obligation-scoped-verification.unit.test.ts` 同款 |
| 3 | `zero-testing reconcile CLI…` | 夹具：同上文件 |
| 4 | `validated spec facts reach actual P2 acceptance reader…` | 夹具：同上文件 |
| 5 | `real prepare CLI / bridge scope lifecycle: direct` | `verifyReusedExecutionScope` 复用断言——需判定该路径是否应传 `currentRunId`（它验的是**既有完成记录**，倾向保持严格，可能要改的是夹具的复用输入） |
| 6 | `P7 new default creates real attended completion…` | 同 5 |
| 7 | `P7 two real CU runs…` | 夹具：另一 CU 无验收内容，比照第三处夹具修正 |

7 条里 5 条是夹具、2 条待判定，**无一条属 D2 机制本身**。

##### 仍未决

1. `revision-precut`（修订**校验前**中断）的 `onHarnessSummary` 注入分支尚未写；
2. §4.2.3 末段链读取表里 `goal-progress.ts:801/804`、`goal-timeout.ts:284`、`assess-renderer.ts:103` 与 runtime 的两处 prompt 文案（`:3574`、`:3776`）尚未换有效范围；
3. §4.2.5 OpenSpec delta 全部未做（含 §4.2.5 冲突条款表 ①②③③b 与 P2/P7/总纲冲突说明）；
4. §4.4 D2 段用例（`D2 not_applicable to required revision is accepted` 等 12 行）尚未逐条落为用例；
5. 9 条依赖标注未销号；`harness/tests/d01probe.ts` 待处置。

##### 第一轮未决项（已被上方小节取代，保留供追溯）

1. **§4.2.3 的 13 个消费点尚未逐个替换**：目前只换了 `GoalPhaseRuntime.run()` 内的两处。还需按 §4.2.3 表替换 `harness-runner.ts:547/549`、`assess.ts:450`、`capability-resolution-entry-input.ts:229`、`capability-resolution.ts:505`、`blueprint-skill-projection.ts:37`、`change-unit-completion.ts:80/96`、`feature-track.ts:29`、`upstream-verdict-gate.ts:41`、`verify-feature-completion.ts:100/534/560/876`，以及**第二轮 review B3 补的四个漏列点** `goal-phase-runtime.ts:4878/6645/9068/9780` 与末段链读取表的六处。
2. **终点判定尚未改**：`:9640-9643` 仍是 `outcomes.length === chain.length` 数量等式，须按 §4.2.3 第 3 条改为「按最新有效结果覆盖 chain」（`latest` 而非 `some`），`terminalChain` 同步。
3. **`scopeRevisionRequested` 变量残留**：`:6227` 的声明与 `:9780` 完成生成资格里的引用尚未清理（它现在恒为 false，但应随 §4.2.2 #2 彻底删掉）。
4. **测试断言迁移未做**：§3 问题 4 的逐条改写表（11 条断言）与 §4.3 清单尚未落到 `execution-scope.unit.test.ts` 的 else 分支；`revision-precut` 的 `onHarnessSummary` 注入尚未写。
5. **§4.2.5 OpenSpec delta 未做**：`obligation-execution-scope` 的 goal-runner Requirement 整条改写 + runtime-policy 护栏 + §4.2.5 冲突条款表的 ①②③③b + P2/P7/总纲冲突说明。
6. **§4.2.6 完成判定未做**：`scope_revision_count` 进 completion、`verifyFeatureCompletion` 用有效范围算 expectedChain。
7. 批次 1 的 9 条依赖标注尚未销号；`harness/tests/d01probe.ts` 临时探针待处置（收口时删除或转正式用例，二选一）。

未动任何 D2 面的代码：`scope_revised` 事件、`loadEffectiveExecutionScope` / `applyScopeRevisions` / `resolveRunBaseline`、§4.2.2 删除清单九项、§4.2.3 的 13 个消费点与链 / 游标 / 终点判定、§4.2.5 OpenSpec delta 均未开工。

#### D2 第二笔 — 完成（批次 1 整体全绿，待用户 review 后提交）

> **锚点：批次 1（D0.1 + D2）代码与测试全部完成，三条验证全绿，未 commit。**

**三条验证原始结果行**

```
cd harness && npm test            → 结果：4500 passed, 0 failed (共 4500)   ← unit
                                  → 结果：46 passed, 0 failed (共 46)       ← fixtures
                                     DONE=0（含 typecheck）
npm run openspec:validate         → Totals: 45 passed, 0 failed (45 items)
                                     [openspec-enforcement] PASS
node scripts/check-plan-version.mjs → [check-plan-version] mode=default current=3.1.0 / PASS
git diff --check                  → 退出 0；改动文件 25 个全 LF（CR=0）
```

**9 条依赖标注销号**：批次 1 早期标注的 9 条失败全部消除——3 条「无 feature-completion 投影」由 §4.2.3 的链/范围同源修复销号；1 条 design-gap 由 successor→revision 迁移销号；5 条夹具类由本轮夹具真实性修正销号。

**`d01probe.ts` 处置**：**转正式用例并入 `execution-scope.unit.test.ts`**（13 条，原样保留断言），临时探针文件已删除。理由：这 13 条正是 §4.4 的 D0.1 验收行，锁的是「候选自报 applicability 一律不采信」这条护栏，属长期资产而非一次性诊断。

**§4.2.5 OpenSpec delta（批次 1）**

| 文件 | 改动 |
|---|---|
| `openspec/changes/obligation-execution-scope/specs/goal-runner/spec.md` | Requirement `Scope successors use existing owner release and birth mechanisms` → **整条改写**为 `Scope revisions are appended inside the same run`：同 run 追加、不封卷/不释放锁/不生成后继；有效范围定义与 manifest 出生值不变；链断即损坏不回退出生范围；重入按输入指纹去重；执行历史留 events、结果投影取最新；`run_base_sha` 由首条 coding/ut 修订冻结一次。三个既有 Scenario 全改 run 内语义（`Handoff is interrupted` → `Revision is interrupted`），新增 `Baseline is frozen by the first coding-bearing revision`。Enforcement 去掉 `goal-run-control.ts`（修订路径不碰 run-control），补 `execution-scope.ts` |
| `openspec/changes/composable-workflow-foundation/specs/runtime-policy/spec.md` + `openspec/specs/runtime-policy/spec.md` | §4.2.5 冲突条款表 ①②③③b **四条全部同步改写**（两文件各 4/4）：①「完整交付必须建立真实 run」→ 唯一权威 + 有效范围 + 合法首次冻结分支 + 缺失/损坏须报错；②「封卷释放后创建后继」→ 同 run 追加、不封卷/不释放/不生成后继、successor 只留三种情形；③`Spec discovers a new device obligation` Scenario → run 内语义；③b`Resume ignores changed workflow defaults` Scenario → 恢复读有效范围、变更由同 run 修订 |

**§4.4 用例逐行**（全部实跑通过）

D0.1 段 13 条（并入 `execution-scope.unit.test.ts`）：自报 device / visual 重算、SSOT 缺失不强迫补文件、SSOT 损坏或未定档 unknown、无 impact 保留 testing、impact=true 要求 device、有来源 impact=false 裁掉 testing、satisfied_by 冻结核验、(a) 无写集拒绝、(b) 无可核验范围 unknown、定义缺口 owner 可执行、device 层缺 impact 不降级、unit 层链形状。
D2 段：`D2 not_applicable to required revision is accepted`、`D2 revision cannot delete or downgrade a required obligation`、`D2 broken revision chain is corruption, not a fallback to birth scope`、`D2 baseline is frozen once by the first coding-bearing revision` 四条新用例；端到端行由 `real prepare CLI / bridge scope lifecycle` 的 `revision` / `revision-cut` / `revision-precut` / `design-gap` / `testing-fail` / `detached×3` 覆盖（真实 runtime 驱动）。

**本轮新增的教训（与前四条并列）**

5. **凡「链」与「范围」成对出现的地方，两者必须来自同一次求解**。本 plan 里这对东西出现五处（启动 / 主循环 / 完成资格 / clean-pass / 生成器），我错了三处，逐个实跑才暴露。
6. **夹具里「自报 required」同样不可信**：`blueprint-skill-projection` 的「不得静默删除 required」用例原本用一条自报 `required` 的 device 事实作前提——D0.1 生效后该前提本身被重算掉，用例失去意义。已改为从 device 层验收派生出**真正**的 required 再测减法。这类「用自报事实当测试前提」的用例，在防洗绿护栏落地后都要重新审。

#### 批次 1 代码 review 第一轮（codex，9 阻断 / 6 必修 / 1 建议）——逐条处置

全部 16 条**先开代码核实再处置**；本轮无驳回（逐条均在引用位置复现属实）。三条验证见本节末。

| # | 结论 | 处置位置 |
|---|---|---|
| B1 历史 PASS 被强制复用，撤销失效证据无法回链 | 接受（属实：`completed` 分支无条件覆盖 `satisfied_by`；游标用 `outcomes.some(PASS)`） | `goal-phase-runtime.ts` 修订提议块：新增 `revoked` 集合（候选带义务但不带证据 = 主动撤销，不再补回）；新增「证据引用冻结前核验→不通过即撤销（不是硬失败）」一遍，判据复用 `collectResolvedScopeFacts` → `executionScopeEvidenceIssues(currentRunId)`（§3 问题 11 同一把尺，`satisfied_by` 里的 `InputBinding` 仍按 §4.1.4 硬拒）；被撤销阶段的 outcome 经既有失效过滤剔除，游标改用 `latest` 而非 `some` |
| B2 impact 继承与更正无一致契约 | 接受（属实：checker 显式回带 `impact`，runtime 却按「字段是否存在」判继承） | 同文件：`impactInherited` 改为「与有效范围 `request_impact` 的**实际差异**」；判为更正时要求 impact 自身 basis 是本次新来源（不借同批其它新事实的信用） |
| B3 required 保护可被改 kind 绕过 + 重算前误拒 | 接受 | 谓词移入 `execution-scope.ts` 并按 `id + kind` 判定（`owner_phase` 是 kind 的函数，不再重复）；删除 runtime 重算前「候选自报非 required 即拒」的分支，统一由重算后的 `assertRevisionKeepsRequiredObligations` 判结果 |
| B4 历史触发文件仍进当前阶段证据 | 接受 | `capability-resolution-entry-input.ts` 的 `sourcePaths` 按 §5.1.1a R-目标收集实现：只跳过 `design-decision` / `acceptance-definition`；顺手删掉因此失去消费方的 `bindings` 局部量 |
| B5 pixel 定档缺视觉验收未产定义缺口 | 接受（属实：生产只标 required，用例手工注入缺口） | 读取层新增 `fidelity.visual_acceptance_present`（复用既有 `uiSpecAbsPath`，不新建读法）；resolver 在 visual 为 required 且缺件时产 `acceptance-definition:visual` unknown，走方案 A 的 definition-gap 通路（spec 可执行、testing 不可执行） |
| B6 空 impact basis 可直接裁掉 testing | 接受（最高优先级的 fail-open） | resolver 在消费前校验 impact 结构：`user_visible_behavior_change` 必须是布尔、`reason` 非空、`basis` 非空；缺字段不再等同明确的 false |
| B7 basis 字节核验缺失与无指纹放行 | 接受（**其中一个子点部分驳回**，见下） | `verifyBasisBinding`：字节例外收成 `derive.codebase` / `derive.test-targets` **白名单**（原为「非解析值 provider」的反向推断）；所有形态先核项目内 + 来源存在；无 40-hex 摘要一律判失败；`ResolvedScopeFacts` 增 `basis` 结论并接到**全部** `obligation.basis`（plan §4.1.0 明列的两类 basis 都覆盖），执行输出类 kind 的 derive 观察沿用与完成侧同一份 `EXECUTION_SOURCE_KINDS` 豁免内容比对（路径/存在性不豁免） |
| B8 修订重放不校验前后约束、排序掩盖乱序 | 接受 | `loadScopeRevisions` 改为**按事件物理顺序**校验（删除 sort），并复跑写入侧同一组约束：请求边界不可改 + 不得删除/降级 required |
| B9 事件基线读取未执行三条充要条件 | 接受 | `resolveRunBaseline`：出生已有基线而事件仍携带 → 链损坏（不再静默忽略）；携带者必须含 coding/ut、必须是首条这样的修订、值必须过 `validateExactSha` |
| M1 reconcile-only 漏传当前 run 身份 | 接受 | `harness-runner.ts` 传 `goalRunId`（跨 run 引用的终局检查不变） |
| M2 出生未传真实 requirement | 接受 | `resolveFeatureExecutionScope` 增 `requirement?`；`goal-mode-entry` 传 `--requirement`、fresh runtime 传 `manifest.requirement`；仅无 run 的候选解析（change-unit 投影）保留 `requested_results` 回退 |
| M3 prompt / 报告 / 预算仍用旧链 | 接受 | prompt 调用点传「出生 manifest + 有效范围」的浅拷贝（不改 manifest 字节）；`fullWorkflowChain` 改 `let` 并随修订重算；`goal-progress` 的链优先取最后一条 `scope_revised`（首个 `run_start.chain` 不再覆盖有效范围）；`goal-timeout` 的预算链接受 `effectiveChain` 入参，修订后重算 wall 与 deadline（已消耗预算 `priorActiveMs` 不变） |
| M4 中断测试与失败无修订断言未真正迁移 | 接受 | `revision-precut` 在 `onHarnessSummary` 真注入校验前中断，并断言切点确实命中、重入后仍只有一条修订、spec 被派发两次、修订后 invoke 序号为 `-i3`（预算连续）；`testing-fail` 断言改为「无 `scope_revised` 且有效范围指纹 == 出生指纹」 |
| M5 验收矩阵多项无生产链断言 | 接受 | 见下方新增用例表 |
| M6 D0.1 的 OpenSpec delta 未交付 | 接受 | `obligation-execution-scope/specs/runtime-policy/spec.md` 的 resolver Requirement 补四段 D0.1 护栏 + 两条 Scenario；`tasks.md` 增「## 4. P8 批次 1」与本轮返修记录；`design.md` 决策 5/6 标注被 P8 改判（后继交接语义作废） |
| S1 清理失去消费者的后继遗留 | 接受 | 删 `createGoalRun` 的 `firstImplementationSuccessor` 参数与其条件子句（无任何调用方，含测试）；删 runtime 末尾那段最终无动作的 completion 验证块 |

**本轮新增 / 改写的用例**

| 用例 | 锁住什么 |
|---|---|
| `D0.1 an impact judgement without structure or source never prunes a duty` | B6：空 basis / 缺布尔 / 空 reason 三个子断言 |
| `D0.1 a basis binding that no longer verifies rejects the freeze` | B7：义务 basis 结论进 resolver |
| `D0.1 pixel_1to1 without visual acceptance opens a spec definition gap` | B5：视觉责任不取消 + spec 可执行 + testing 不可执行 + 有验收件时不产缺口 |
| `D0.1 review-only and ut-only requests keep their code targets while revision triggers stay out`（`standalone-coding-review.unit.test.ts`） | B4 的**证伪面**：经生产桥接 + `resolveCapabilityInputs` 断言 `code` resolved、依赖覆盖真实目标、assurance 非 blocked，且触发文件不进 `testTargets` / `source_paths`。**已做变异验证**：去掉过滤即 FAIL（「review collected the revision trigger as a current target」） |
| `D2 revision cannot delete or downgrade a required obligation`（追加子断言） | B3：同 id 改 kind 也算减法 |
| `D2 broken revision chain ...`（追加子断言） | B8：重放拒绝「结构合法但删 required」「改请求边界」；两条物理顺序颠倒的修订**不被排序修复** |
| `D2 baseline is frozen once by the first coding-bearing revision`（重写） | B9：事件带真实 `execution_scope` / `revision_index`；出生已有基线而事件携带 → 抛；非 coding/ut 携带 → 抛；非首条携带 → 抛；非 40-hex → 抛 |
| `real prepare CLI / bridge scope lifecycle: revision-revoke`（新模式） | B1 端到端：提议撤回 design 证据 → 该证据**不被补回**、plan 真的重新派发、有效链 `[plan, coding, review, ut, testing]`、CU 期望链同步 |
| `... : testing-offline` / `... : testing-manual`（新模式） | §4.4「设备离线 / manual 不产生修订」：各注入对应 `failure_kind` / `actionability`，断言无 `scope_revised` 且有效范围指纹不变 |
| `... : design-gap`（加强） | B2：提议**原样带回**继承的 impact（与 checker 同形），coding 已改过该文件仍必须通过——按「字段存在即更正」会在这里失败 |
| `direct` 尾部追加生产链断言 | M5：契约漂移后经 `collectResolvedScopeFacts` 得到 `satisfied_by.ok === false`，resolver 拒绝冻结（不再只注入布尔） |
| `revision` / `revision-cut` / `revision-precut` / `revision-revoke` 尾部追加 | M5：completion 的 `scope_revision_count` 与事件对账，篡改计数即 INVALID |

**B7 的部分驳回（有证据，实跑证实）**

codex 写「derive 分支接受**实际不存在且 `exists:false`** 的依赖」，据此要求「落实来源存在」。**「每条 dependency 都必须存在」这半条不成立**：`capability-resolution.ts:599` 的 `dependencies: dedupeDependencies(attempts.flatMap(attempt => attempt.dependencies))` 把**全部解析尝试**的依赖并进绑定，因此蓝图派生绑定天然带着一条 `exists:false` 的物理产物依赖（`blueprint-skill-projection.unit.test.ts` 的「bound absent artifact attempt was ignored」锁的正是这个形状：物理件一旦出现，同一绑定即判 stale）。而 D0.1 明写 basis 可以是「CU canonical、**蓝图**、代码文件」。

我先按 codex 原文实现了「每条依赖都必须存在」，全量 4507 条里**恰好一条**失败——`validated spec facts reach actual P2 acceptance reader with derived and materialized sources`，报错 `acceptance: 依据不存在 .../acceptance.yaml`，即上述蓝图形状。已改为**存在性一致性**（声明存在则必须仍在、声明不存在则必须仍不在，与 `readBoundInput:494` 的 `matches` 同一把尺）。B7 的其余三个子点（项目内核验缺失、`sha256` 为空即跳过比对、`verifyBasisBinding` 未接到 `obligation.basis`）全部按原文修复。**放弃的准确性**：一条「声明不存在且确实不存在」的依赖不再单独构成拒绝理由——它本来就是绑定身份的一部分，由 `readBoundInput` 的解析值核验兜底。

**本轮已知的测试空白（如实记录，不掩盖）**

- B2 的**否定面**「更正 impact 但不带自己的新来源 → 拒绝」只有生产代码，没有用例：该判定位于 `GoalPhaseRuntime.run()` 的修订提议块内，不经任何可单独调用的导出；为它单造一次端到端 run（只为断言一次抛错）性价比低。肯定面（继承不被误判为更正）已由 `design-gap` 端到端锁住。**放弃的准确性**：该分支目前只有代码 review 背书。

**三条验证（本轮返修后重跑，原始结果行）**

~~~
cd harness && npm test              结果：4507 passed, 0 failed (共 4507)   ← unit
                                    结果：46 passed, 0 failed (共 46)       ← fixtures
                                    DONE=0（含 typecheck）
npm run openspec:validate           Totals: 45 passed, 0 failed (45 items)
                                    [openspec-enforcement] PASS
node scripts/check-plan-version.mjs [check-plan-version] mode=default current=3.1.0 / PASS
git diff --check                    退出 0；30 个改动文件全 LF（CR=0）
~~~

返修新增的改动文件（在批次 1 原 23 个已跟踪文件之上）：`harness/scripts/utils/goal-progress.ts`、`harness/scripts/utils/goal-timeout.ts`、`openspec/changes/obligation-execution-scope/design.md`、`openspec/changes/obligation-execution-scope/specs/runtime-policy/spec.md`、`openspec/changes/obligation-execution-scope/tasks.md`；`harness/tests/unit/standalone-coding-review.unit.test.ts` 由改文案升为承载 B4 证伪用例。

**本轮教训（第 7 条）**

7. **「按 review 原文实现」也必须先跑一遍再下结论**：B7 的「每条 basis 依赖都必须存在」照字面实现后，全量 4507 条里恰好一条失败，指出蓝图派生绑定天生带 `exists:false` 依赖——review 的方向对（确有 fail-open），但它给的判据边界比事实宽一格。**先实现、再实跑、再按事实收边**，比在纸面上争论快得多，也比照单全收安全。

#### 批次 1 代码 review 第二轮（codex，4 阻断 2 必修）——逐条处置

四条阻断全部属实（其中两条在实跑中暴露出**更深的同源缺陷**，一并修）；两条必修属实；B2 用例空白按裁决补齐，不再留空。

| # | 结论 | 处置 |
|---|---|---|
| 阻断 1（B1/M5）撤销无法跨中断恢复 | 接受。核实：撤销只过滤内存 `outcomes`；`goal-runner-phase.ts:761` 的事件重建不认修订，`applyInvalidationsToResume` 只消费 backtrack / `phase_invalidated` | 撤销时**发既有的 `phase_invalidated` 事件**（每个被撤销阶段一条，`reason: 'scope_revised'`）——恢复侧一行不改就认它；内存侧改为调用**同一个** `applyInvalidationsToResume`，即时游标与恢复共用一个判断。**不选 `phase_backtrack_requested`**：那条同时是回退预算计数器，范围修订不是回退 |
| 阻断 2（B2）首次补 impact 对 undefined 求指纹 | 接受（本轮引入的直接回归） | 只有双方都有值才比指纹；有新值无旧值即属更正，自身新来源检查保留 |
| 阻断 3（B5）视觉缺口无消除路径 | 接受（缺口只"不再新增"，继承来的 unknown 永久阻塞） | 缺口改为**双向派生**：`visual_acceptance_present === true` 时把继承来的 `acceptance-definition:visual` 从事实里移除；视觉义务本身仍 required |
| 阻断 4（B7）无真实来源的 basis 仍可通过 | 接受 | 无解析值分支要求**至少一条真实存在的依赖**（全 `exists:false` 直接判失败），且每条存在依赖必须有 40/64-hex 摘要；内容豁免改为**只跳过字节比对**，provider 边界与摘要结构一律先过（豁免不再提前 return） |
| 必修 1（M3）进度按出生链算 wall | 接受 | `goal-progress.ts` 的 `resolveWallClockMs(manifest, chain)` 传当前链，与 runtime 同源 |
| 必修 2（M6）OpenSpec 与实现冲突 | 接受 | runtime-policy delta 区分「**缺少**判断（落 unknown、不裁）」与「**提供非法**判断（拒绝冻结）」，新增一条 Scenario；并区分「义务被保留」与「阶段当前可执行」（定义缺口会暂时挡住 testing）。goal-runner delta 补 no-op / 新来源 / 撤销可恢复三条语义 |

**实跑中暴露的三处同源生产缺陷（阻断 1 的用例把它们钓出来，全部已修）**

1. **修订携带的「请求标记」义务会被重复创建**：显式请求的阶段在出生时产出 `<kind>:request:<phase>`（required）；修订把它作为事实带回后，D0.1 的证据派生把它覆写成 `not_applicable`，紧接着 resolver 又按「该阶段被请求且无 required 事实」**再造一条同 id 义务** → `validateExecutionScope` 判重复 id，整条修订崩。修法：请求标记表达的是**用户请求**而非候选观察，已存在则原地重申为 required，不再 push 第二条。（顺带把「义务字段或身份非法」的报错补上 id，否则这类问题只能靠猜。）
2. **无变化的提议被当成错误**：被撤销的阶段重跑后会**重新发布自己的报告**（提议内容不变）。此前「必须带新来源」在 resolve **之前**执行，于是这条无害的重复提议直接抛错、把它本要修复的 run 打断。修法：先 resolve，**解析结果与当前有效范围一致即视为 no-op**（静默跳过）；只有真正改变范围的提议才要求新来源。
3. **刚闭环的阶段证据不算"新来源"**：撤销后重跑的阶段，其唯一的新事实就是**自己新产出的闭环证据**。修法：「新来源」判据同时接受「本 run 新附加且经 `integrityOk` 核验的阶段证据引用」。不放宽其它任何一条（请求边界、不得删降 required 原样）。

**本轮新增 / 改写用例**

| 用例 | 锁住什么 |
|---|---|
| `real prepare CLI / bridge scope lifecycle: revision-revoke`（**重写**） | 阻断 1 的反例：spec 真实 PASS 并由修订 #1 附上闭环证据 → coding 提出修订 #2 撤销该证据 → **在修订落盘后立刻中断** → 恢复后 spec 必须**重新派发**（断言 `phase_invalidated` 在场、撤销点之后有 spec 的 `agent_invoke_start`、切点确实命中）→ 修订 #3 重新附上新证据后 spec 才回到复用态。共 3 条修订、spec 两次调用、run 到 CHAIN_SLICE_COMPLETED、completion 正常生成 |
| `... : impact-first`（新） | 阻断 2：有效范围无 `request_impact` 时首次补入合法 impact（自带新来源）必须通过并写进范围——旧代码在这里对 `undefined` 求指纹直接抛错 |
| `... : impact-reuse`（新） | B2 否定面（裁决要求）：更正复用出生 basis、同批另有新来源的事实 → 拒绝、无 `scope_revised`、有效范围指纹不变 |
| `D0.1 the visual definition gap is cleared once the artifact exists`（新） | 阻断 3：缺件时开缺口（testing 不可执行）→ 携带旧缺口的修订在补件后**清除**它 → testing 恢复可执行、视觉义务仍 required；并经真实 `applyScopeRevisions` 重放确认 |

**与 codex 的一处口径差（写明，不隐藏）**

阻断 3 的「checker `:45` 提前返回」我**未改**：`designScopeRevisionChecks` 在验收绑定未变时返回空，是因为此时没有任何新来源可带；若强行提议，会被 runtime 的「修订必须带新来源」判据拒绝（那条判据只接受新绑定或本 run 新闭环证据），等于把一次空转换成一次硬失败。补件的连续路径由「spec 重跑产出新验收绑定 / 新闭环证据 → 修订 → 缺口清除」承担，已由上表两条用例覆盖。**放弃的准确性**：spec 只补 `ui-spec.yaml`、不产生任何新绑定且不重跑的极端形态，仍需另起 run 才能解除缺口。

**三条验证（第二轮返修后重跑，原始结果行）**

~~~
cd harness && npm test              结果：4510 passed, 0 failed (共 4510)   ← unit
                                    结果：46 passed, 0 failed (共 46)       ← fixtures
                                    DONE=0（含 typecheck）
npm run openspec:validate           Totals: 45 passed, 0 failed (45 items)
                                    [openspec-enforcement] PASS
node scripts/check-plan-version.mjs [check-plan-version] PASS
git diff --check                    退出 0；30 个改动文件全 LF（CR=0）
~~~

**本轮教训（第 8 条）**

8. **端到端反例会把"想清楚了"的设计一路钓穿**。阻断 1 只要求「撤销要能跨中断」，但为它写的那条真实 run 连环钓出三处独立缺陷：请求标记义务被重复创建、无变化的重复提议被当成错误、刚闭环的证据不算新来源——三处都在纯函数用例和既有端到端场景里完全看不见，只有「真实历史 PASS + 撤销 + 中断 + 恢复」这条完整链路能触发。**凡是「恢复」「重入」「第二次」这类词出现在需求里，就必须有一条把它们串起来跑的用例**，分开测等于没测。

#### 批次 1 代码 review 第三轮（codex，3 阻断 1 必修 + 两处清理）——逐条处置

三条阻断、一条必修全部属实并修复；两处清理完成。**阻断 2 按调度者方向做成「单事件自足」**（核实可行，未停下）。

| # | 结论 | 处置 |
|---|---|---|
| 阻断 1（B1）`phase_invalidated` 错误接受 PASS+retry | 接受。核实：`rebuildOutcomesFromEvents` 跳过 `action=retry`，而 `applyInvalidationsToResume` 的 `revalidated` 只看 `verdict==='PASS'` → 失效被清掉、outcomes 里留下的却是**失效前**那条 PASS | `revalidated` 改用与事件重建**同一终局判据**：`action !== 'retry' && advance_blocked !== true`；事件形参类型补这两个字段 |
| 阻断 2（B1）两个事件非原子 | 接受。按调度者方向核实后**采用派生方案**：`revokedPhasesByRevision(birth, events)` 从「前一有效范围 vs 新范围」比对 `satisfied_by` 中的阶段证据，得出被撤销阶段；`eventsWithScopeRevocations` 把它投影进事件流交给**既有的** `applyInvalidationsToResume`（可行性已实跑确认，无需改那个函数）。**`phase_invalidated` 的写入整条删除**——不再是真值、也不再是投影之外的第二次落盘。恢复侧与 run 内侧读同一份派生结果，中断窗口从结构上消失 |
| 阻断 3（B3）「新来源」未限定本 run | 接受 | 判据提取为纯函数 `hasNewSourcedFact(previous, facts, currentRunId)`（与 `findSubtractedRequiredObligations` 同一范式，为的是能被直接证伪），其中阶段证据分支加 `ref.run_id === currentRunId`；历史 run 的合法证据不再算作本次修订的理由 |
| 必修 1（B2）显式 `impact: null` 被静默继承 | 接受 | runtime 只对 `undefined` 继承，显式 `null` 直接拒绝；resolver 侧另加一道 `null` / 非对象即 `fail('影响判断结构非法')`，其它调用方同样受保护 |
| 清理 | 接受 | `assess.ts` 的 "successor scope" 文案改为「在本 run 内追加修订」；`ui-scope-gate.ts` 同类文案一并改（grep 全仓只剩这两处）；删 `goal-run-creation.ts` 里随 `createScopeSuccessor` 失去消费方的四个 import（`readRunControl` / `ensureRunControl` / `executionScopeEvidenceIssues` / `resolveEffectiveRunEnd` / `inheritSuccessorManifest`）。逐个 grep 核实 runtime 侧无同类残留 |

**本轮用例（两条做了变异验证）**

| 用例 | 锁住什么 |
|---|---|
| `applyInvalidationsToResume：PASS+retry / advance_blocked 不算重新验证`（`mutation-backtrack.unit.test.ts`） | 阻断 1。**变异验证**：去掉 `action !== 'retry' && advance_blocked !== true` 该用例即 FAIL |
| `D2 only this run can supply the new fact a revision stands on` | 阻断 3 四个子断言（什么都没有 / 本 run 新闭环证据 / 历史 run 证据 / 新绑定）。**变异验证**：去掉 `ref.run_id === currentRunId` 后历史 run 证据被判为新来源 |
| `real prepare CLI / bridge scope lifecycle: impact-null`（新模式） | 必修 1：真实 runtime 修订携带 `impact: null` → 拒绝、无 `scope_revised`、有效范围指纹不变 |
| `... : revision-revoke`（断言改写） | 阻断 2：断言**不再写** `phase_invalidated`（`assert(!sourceEvents.some(...))`），切点就落在唯一那条 `scope_revised` 写完之后，恢复仍重跑 spec；并直接断言 `revokedPhasesByRevision(...).get(2) === ['spec']`——撤销集合可从修订内容本身派生 |

**`D0.1 the visual definition gap is cleared once the artifact exists` 的覆盖边界（按裁决写明）**

该用例只覆盖**纯 resolver + `applyScopeRevisions` 重放**两层：缺件时开缺口（testing 不可执行）、携带旧缺口的提议在补件后清除它、重放后有效链含 testing。它**不经过** `designScopeRevisionChecks` 与 `GoalPhaseRuntime`，因此**不能证伪** checker 的提前返回分支（`blueprint-skill-projection.ts:45`），也不能证明「spec 补齐 → 同 run 自动修订」这条端到端链路。按第二轮裁决，该放弃可接受；真正的端到端补件路径仍待批次 2/3 的 pixel 夹具落地后才有条件覆盖。

**三条验证（第三轮返修后重跑，原始结果行）**

~~~
cd harness && npm test              结果：4513 passed, 0 failed (共 4513)   ← unit
                                    结果：46 passed, 0 failed (共 46)       ← fixtures
                                    DONE=0（含 typecheck）
npm run openspec:validate           Totals: 45 passed, 0 failed (45 items)
                                    [openspec-enforcement] PASS
node scripts/check-plan-version.mjs [check-plan-version] PASS
git diff --check                    退出 0；32 个改动文件全 LF（CR=0）
~~~

**本轮教训（第 9 条）**

9. **"两个事件要原子"往往是问题被摆错了位置**。第二轮我给撤销补了一条 `phase_invalidated` 事件，codex 立刻指出两次写入之间仍有窗口——而正解不是加提交边界，是让**单条事件自足**：撤销集合本来就能从「前后两版范围的 satisfied_by 差集」确定性派生，写第二条事件既多余又制造了窗口。**先问「这个事实能不能从已有记录推出来」，再考虑怎么把它可靠地写下去**；能派生的东西一旦落成第二份记录，就同时背上了一致性与原子性两个新问题。

#### 批次 1 代码 review 第四轮（codex，2 阻断 1 必修 3 建议）——逐条处置

两条阻断、一条必修属实并修复；三条建议全做（建议 2 改动面确认很小，未推迟到批次 2）。

| # | 结论 | 处置 |
|---|---|---|
| 阻断 1 派生投影未覆盖全部读取方 | 接受。核实 `phase_invalidated` 的生产读取方**恰好三个**：`applyInvalidationsToResume`（:2962）、`deriveHaltValidationOnlyEligibility`（:3090）、`isClosureOnlyRetryPending`（`goal-runner-phase.ts:1132`）——此前只有第一个拿到投影 | 出生范围提为 `birthScope` 单点解析；恢复段建一份 `recoveryEvents = eventsWithScopeRevocations(birthScope, priorEvents)` 同时喂前两个读取方；`attemptHistory`（:6420）改为同一投影喂第三个。三个读取方从此读同一份真值 |
| 阻断 2 误撤仍有有效证据的阶段 | 接受 | 撤销判据改为**按义务**：只有 `kept.length === 0`（该义务再无任何阶段证据）才把 owner 阶段计入撤销集合；两条证据撤一条不再触发 |
| 必修 `scope_revision_count` 缺字段被当 0 | 接受 | 1.2 记录强制校验该字段为非负整数，缺失即 INVALID（不再 `?? 0`） |
| 建议 1 未使用 import | 采纳 | 删 `loadAuthoritativeRunEvents` / `loadFrozenExecutionScope` 两个（逐个 grep 核实其余仍有消费方） |
| 建议 2 goal-progress 手工读最后一条修订 | 采纳（改动 8 行） | 改用与所有消费方同一的 `applyScopeRevisions(validateExecutionScope(birth), events)`；**外裹 try/catch**：损坏时面板退回既有 `run_start.chain` 投影而不是变空白——在本组件里 fail-open 是对的，损坏的 fail-closed 责任在 runtime |
| 建议 3 `hasNewSourcedFact` 未核 `request_impact.basis` | 采纳 | 「范围已携带的来源」= 全部义务 basis ∪ `previous.request_impact.basis` |

**本轮用例**

| 用例 | 锁住什么 |
|---|---|
| `D2 every recovery reader sees the derived revocation, not just the invalidation filter` | 阻断 1。三个读取方各一条断言，**每条都先断言「未投影时的前提」**：未投影时 `isClosureOnlyRetryPending` 返回 true、`deriveHaltValidationOnlyEligibility` 返回资格——即「跳过 agent」；投影后分别变为 false / null。前提断言让这条用例无法在修法失效时静默通过 |
| `D2 a revocation is only derived when a duty is left with no phase evidence` | 阻断 2 正反两例：双证据撤一条 → 不撤销；证据清空 → 撤销该阶段 |
| `direct` / 修订族 completion 段追加 | 必修：删掉 `scope_revision_count` 字段后 completion 判 INVALID |
| `D2 only this run can supply the new fact...` 追加子断言 | 建议 3：冻结 impact 自己的 basis 不算新来源 |

**覆盖边界（如实记录）**

阻断 1 的两个读取方是在**生产投影 → 生产读取方**的边界上直接证伪的，但没有把「撤销 + 旧 PASS+retry / WAITING halt」串成一次真实 run 的端到端中断：构造这种形态要让夹具的假 harness 先产出一轮 closure 未完成的 PASS（`failReceiptFor` 注入），与既有 `revision-revoke` 的切点叠加后回合数与预算断言都要重排，收益（再证一次同一条投影接线）与代价不成比例。**放弃的准确性**：三个读取方各自的行为已锁死，「runtime 确实把投影传给了它们」这一步由代码 review 背书（三处调用点都在同一屏内）。

**三条验证（第四轮返修后重跑，原始结果行）**

~~~
cd harness && npm test              结果：4515 passed, 0 failed (共 4515)   ← unit
                                    结果：46 passed, 0 failed (共 46)       ← fixtures
                                    DONE=0（含 typecheck）
npm run openspec:validate           Totals: 45 passed, 0 failed (45 items)
                                    [openspec-enforcement] PASS
node scripts/check-plan-version.mjs [check-plan-version] PASS
git diff --check                    退出 0；32 个改动文件全 LF（CR=0）
~~~

**本轮教训（第 10 条）**

10. **换了真值来源，就要把"谁在读它"重新数一遍**。第三轮把撤销从「写一条事件」改成「从修订内容派生」是对的，但我只把派生结果接回了原来那一个读取方——同一份事实另外两个读取方（validation-only 资格、closure-only 重试）仍在读没有它的原始流，于是"阶段该重跑"和"这阶段可以跳过 agent"能同时成立。**改了事实的产生方式后，`grep` 一遍这个事实的全部消费点、逐个确认它们拿到的是新版本**，比在原处反复加固更重要。配套写法：这类用例先断言「不接投影时的错误行为确实存在」，再断言接上后变对——没有前提断言的"修好了"用例，修法一失效就静默变绿。

#### 批次 1 代码 review 第五轮（codex 判「无阻断，可进入通过状态」）——收尾两条建议

| # | 处置 |
|---|---|
| 建议 1 `applyInvalidationsToResume` 子断言缺前提 | 补上：先断言**未投影时旧 outcome 仍在（长度 1）**，再断投影后为 0——与同一用例另两个读取方的写法一致，修法失效时不会静默变绿 |
| 建议 2 `goal-progress` 回退判断 | `revisedChain?.length` → `revisedChain !== undefined`：合法的空有效链（阶段已全部复用）不再被误当作「没有有效范围」而回落出生链 |
| 建议 3 | 已在第四轮实现，无改动 |

**批次 1 停点状态**：frontmatter 的 `p8-b1-resolver-guard` 与 `p8-b1-in-run-revision` 两个 todo 置 `completed`；按需求 §0.5 停点，**不进批次 2**，等用户 review 后决定提交。`harness/reports/_p8-review/`（gitignored）未触碰。

**三条验证（第五轮收尾后重跑，原始结果行）**

~~~
cd harness && npm test              结果：4515 passed, 0 failed (共 4515)   ← unit
                                    结果：46 passed, 0 failed (共 46)       ← fixtures
                                    DONE=0（含 typecheck）
npm run openspec:validate           Totals: 45 passed, 0 failed (45 items)
                                    [openspec-enforcement] PASS
node scripts/check-plan-version.mjs mode=default current=3.1.0 / PASS
git diff --check                    退出 0；32 个改动文件全 LF（CR=0）
~~~

**批次 1 改动文件清单（按笔分组，32 个：30 已跟踪 + 2 未跟踪文档）**

*D0.1（防洗绿：纯函数 + 读取层）*
`harness/scripts/utils/execution-scope.ts`、`harness/scripts/utils/feature-track.ts`、`harness/scripts/utils/blueprint-skill-projection.ts`、`harness/scripts/goal-mode-entry.ts`

*D2（run 内修订：事件、有效范围、消费点、恢复）*
`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/goal-run-creation.ts`、`harness/scripts/utils/verify-feature-completion.ts`、`harness/scripts/utils/goal-run-baseline.ts`、`harness/scripts/utils/capability-resolution.ts`、`harness/scripts/utils/capability-resolution-entry-input.ts`、`harness/scripts/utils/change-unit-completion.ts`、`harness/scripts/utils/upstream-verdict-gate.ts`、`harness/scripts/utils/scope-replan.ts`、`harness/scripts/utils/assess.ts`、`harness/scripts/utils/goal-progress.ts`、`harness/scripts/utils/goal-timeout.ts`、`harness/scripts/utils/ui-scope-gate.ts`、`harness/harness-runner.ts`

*测试*
`harness/tests/unit/execution-scope.unit.test.ts`、`standalone-coding-review.unit.test.ts`、`blueprint-skill-projection.unit.test.ts`、`obligation-scoped-verification.unit.test.ts`、`goal-runner-testing-integrity.unit.test.ts`、`mutation-backtrack.unit.test.ts`

*OpenSpec*
`openspec/changes/obligation-execution-scope/specs/goal-runner/spec.md`、`.../specs/runtime-policy/spec.md`、`.../tasks.md`、`.../design.md`、`openspec/changes/composable-workflow-foundation/specs/runtime-policy/spec.md`、`openspec/specs/runtime-policy/spec.md`

*未跟踪*
本 plan、`.cursor/requirement/需求_动态工作流架构裁决_轻量交互路径与run内范围修订.md`

### 批次 2（D0.3 + D0.2）

（待填）

- 日期：
- 提交：
- 改动摘要：
- 验证输出：
- 与 plan 的偏差与放弃的准确性：
- 未决项 / 交接：

### 批次 3（D1）

（待填）

- 日期：
- 提交：
- 改动摘要：
- 验证输出：
- 与 plan 的偏差与放弃的准确性：
- 未决项 / 交接：

### 宿主实跑记录

（待填）

| 轮次 | 触发日期 | 宿主 / 场景 | 结果 | 回灌到哪个批次 |
|---|---|---|---|---|
| 批次 1 后 | | codex / RDB attended | | |
| 批次 2 后 | | codex / RDB attended（用户入口） | | |
| 批次 3 后 | | codex / RDB 无 run 交互 | | |

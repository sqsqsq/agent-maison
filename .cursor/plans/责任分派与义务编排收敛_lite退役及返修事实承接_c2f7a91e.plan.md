---
name: 责任分派与义务编排收敛 — lite 退役、同源归属与返修事实承接
version: 3.1.0
parent_goal: balanced-delivery-and-reliability-a47c9d62
advances:
  - g1-default-delivery-baseline
  - g3-recoverable-execution
  - g5-proportionate-verification
  - g6-real-host-delivery
  - g7-lean-governance
relation: core
layer: closure
goal_requires:
  - existing-skill-output-contracts-and-profile-source-ownership
  - existing-obligation-scope-and-request-authority
  - existing-write-observations-and-facts-baseline-provenance
  - existing-verified-repair-candidates-and-design-owner-continuation
goal_provides:
  - retired-lite-track-with-explicit-migration-boundary
  - shared-responsibility-resolution-independent-of-remaining-queue
  - dependency-aware-owner-repair-and-obligation-handoff
  - repair-reentry-preserving-valid-writes-and-original-facts-baseline
  - actionable-upstream-proposal-feedback-and-terminal-guidance
real_host_validation: >
  开发期只读保全 20261022T103904Z-179a73 的真实记录，在开发仓副本中回放历史错误与
  修复后的生产接线。实施不改业务宿主、不操作手机；开发通过不等于交付完成。
  后续与 8a t8、371 t5、5bdd t9、395 t6、28 及其前序 pending 项、a47 R5/H1
  共用一次用户安排的干净联合观察，不另起长跑。系统引导已完成，不保留或制造 OOBE；
  395 引导分支仍为真机未验证、开发接线覆盖。现有联合验收全部保持 pending。
parallel_authority_added: false
overview: >
  作为动态工作流总纲 91c4e7a2 的 g2-integration-review 收口，交付观察挂 a47 R6。
  基于 242f6b1d 和 179a73 的真实返修失败，先彻底删除退役 lite 轨，
  再让义务编排、候选派修、写入边界、事实承接及完成消费使用同一份责任结论。
  区分产物归属、请求授权、可用职责、实际依赖和剩余队列，不用当前队列或路径兜底替代它们。
  spec-driven 的非 lite 旧定义本批评估并保留，不另造工作流、责任注册表或恢复协议。
todos:
  - id: t1-real-evidence-and-dispatch-inventory
    content: 起草期已完成 §2/§3 只读诊断和派活盘点；实施先将 179a73 原件入库、登记来源哈希并用生产入口重放，按最新代码核对盘点增量，不另设确认停点。
    status: completed
  - id: t2-retire-lite-first
    content: 按 §4 先删除 lite 专用检查、规则、Skill、工作流链、共享执行分支及对应夹具单测，清除两处 /change-lite 指引并写迁移说明；保留 spec-driven 非 lite 定义和无关通用代码。
    status: completed
  - id: t3-shared-responsibility-and-composition
    content: 按 §5.1–§5.3 收编职责解析与五类动作，落实用户确认的 coding 有限测试兼容修补和一项保留检查，接通 verification 修复及真实依赖；不按队列缺席授予写权，不新增持久真源。
    status: completed
  - id: t4-consumers-and-repair-continuation
    content: 按 §3/§5.4 将候选、写界、核验、assess、runtime、无 run/后继和设计负责方接到同源结论，删除各自派活规则，覆盖下游承接、已复用 owner 重开、请求边界及拒修返回。
    status: completed
  - id: t5-facts-baseline-and-observed-writes
    content: 按 §5.5 兑现 179a73 合法写入与原基线承接；按 §2.3 修复快照模拟 Agent 的本阶段 delta 登记并跑全部迁移消费者，保留新规则文案及真实门禁指纹。
    status: completed
  - id: t6-proposal-feedback-and-docs
    content: 按 §5.6/§6 对上游问题表给出可修反馈、保留独立核实和拒修出路，对齐终态原因/责任/下一步及现行 Skill、规则、OpenSpec、MIGRATION，不改四条总原则原文。
    status: completed
  - id: t7-development-validation-and-cli-review
    content: 按 §7 完成 obligation-driven 完整/裁剪/request 组合与 179a73 生产回放、lite 迁移反例、有效快照回归、必要变异、官方 npm test 和受影响 release-only 整套；实际 Claude Code CLI review 打印调用/模型/结论，提交前汇报。
    status: completed
  - id: t8-joint-host-observation
    content: 按 §8 与既有 pending 项共用一次干净宿主联合验收，观察真实交付、责任恢复、非必要重跑及人工介入；本轮不执行，不用开发通过替代宿主验收。
    status: pending
---

# 责任分派与义务编排收敛

## 1. 定位与本轮边界

本 plan 是 [动态工作流总纲 91c4e7a2](动态工作流_总纲_全阶段Skill独立组合与义务驱动编排_91c4e7a2.plan.md) 的 **g2-integration-review 收口实施清单**，沿该总纲已有 Skill contract → 义务范围 → assess → runtime → completion 架构收编接缝，不另立平行架构。交付目标与宿主观察挂 [a47c9d62](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md) R6；frontmatter 继续引用该 goal，不能把 plan todo ID 冒充 goal ID。起草基线 `242f6b1d7efd067218950f37767d65f72f4cd25d`，根版本 `3.1.0`；版本号本批不动，是否升版由用户决定。遵守 [AGENTS.md](../../AGENTS.md) 与 [overview §1.2.1](../../docs/overview.md#121-四条总设计原则)；四条原文不改。

目标不是再为一种报错补专门回退，而是让每项真实工作只有一个可解释的负责方，按本次目标和真实依赖安排执行。阶段暂时不在队列，不意味着它不负责；某阶段有能力修改，也不等于本次请求授权它修改。轻量来自义务少、输入可复用和职责可组合，不再依靠已退役的 `change → coding → exit` 轨。

本轮仅修订计划、总纲及受影响 plan 正文并同步路标；不实施删除或生产代码修改，不提交、不打包、不动宿主和手机。不新建 `.cursor/` 目录。28/395/5bdd/371/8a 已完成开发范围不重开，8a t8 本次联合观察记失败并保持 pending。用户 10-22 已授权修订 91 总纲 §4/§10、P7 等现行 lite 兼容承诺，按新裁决注明取代关系，不抹掉历史实施记录或把旧完成状态改成未做。实施前重新检查最新 HEAD 与工作区归属，不纳入其它会话改动。

用户补充裁决：先完整退役 lite，删除其专用产物和共享分支；`spec-driven` 非 lite 旧定义只评估、不删除。实现顺序为 t1 只读取证 → t2 lite 减法 → t3–t6 同源责任与接线 → t7 统一开发验收。只做 lite 删除不能作为整批闭环交付。

## 2. 179a73：已核事实、缺口与保全

来源：宿主 `D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-2/open-card-flow/goal-runs/20261022T103904Z-179a73/`。发布件 source_commit 与起草基线一致。本次仅从宿主读取；后续测试全部在开发仓复制工程中执行。

### 2.1 真实经过

| 事实 | 已核结果与含义 |
|---|---|
| 首轮调用 | spec-i1、plan-i2、coding-i3 PASS；review-i4 确实执行且 FAIL，不是“review 尚未开始” |
| 返修 | review 的 CR-001 指向 `SpyBankRepository.ets` 缺少新增必填字段；候选被派给 coding。coding-i5/i6/i7 均失败，最终 `content_retry_exhausted`；共四次 coding 调用，但只有后三次是返修失败 |
| 派活与写界矛盾 | 候选路径兜底把测试文件归 coding；同一文件的 `phase_write_observed` 却归 ut，coding 的检查要求“本周期 UT 产出事实”。两行兼容修补不改变测试断言，旧规则仍不能闭环；用户 10-22 追加裁决明确允许此类 coding 当场修补，本批统一派修和写界 |
| facts 承接异常 | i5 仍携原 spec 基线，i6/i7 缺失该基线；提示要求 coding 建立 facts，同时又要求不改原基线。所报十个源码路径仍与 coding-i3 的合法写后哈希一致；最终改写 facts 后 spec/plan 因该文件变化被判过期 |
| 上游提案无反馈 | i6 的问题表缺可读的具体行引用；i7 改为叙述，生产解析得到零行。另有 coding 过滤器用“非 spec/plan 即 coding”排除 UT/facts 目标。格式问题与错误归属须分别修，不能靠接受任意叙述绕过核实 |
| 终态解释 | 最后报告仍保留较早 review→coding 的处置，最终 halt 未给出对应的有效指导；应区分历史执行过与当前结论失效，不能让用户继续把不归 coding 的问题交给 coding |
| 已生效的前批成果 | coding-i3 的实际改动中，三个未预测文件已通过范围检查并闭环；结构台账、路由静态未确认和组件静态 unknown 已按现行规则处理。不能据本次失败宣称 8a 全部未生效，也不能据这些通过宣称整单完成 |

UT 与 testing 没有正式开始。返修期间一次修改临时测试入口后的诊断执行，不代表当前最终字节或正式 UT 已通过。终态为 7/30 turns，约 67.7 分钟，未触达 480 分钟硬预算。

### 2.2 t1 保全与可复现边界

沿现有 `harness/tests/fixtures/host-recovery-history/` 做来源清单和哈希：manifest、events、有效范围修订、各调用 summary/check/verifier/问题表、facts 调用上下文及基线、相关写入观察、CR-001、contracts 与复现需要的最小源码。可从已有只读保全副本复制；没有副本才只读宿主。原件保留原字节，复制环境适配另列，不能伪造缺失产物或改旧事件来得到 PASS。

起草期进一步核对的触发条件：

1. review→coding 回退形成失效 fence，`loadCompletedFactsBaseline` 只取 fence 后调用；i5 的 22 条基线依赖已承接 coding-i3 写后内容，当前字节全部匹配。i5 只修改测试替身，该写入归为 deferred_to_checker，coding 的 owned 写入为零；没有新增基线源码变化，也没有中断调用。
2. 在该形状下，`capability-resolution-entry-input.ts:362` 的 `!changed.size && !interrupted && !carryUnchangedBaseline` 会拒绝原基线。**“无新增变化”不是“没有可承接事实”。** 已通过旧调用的真实写入不应因重开义务而消失。
3. 后备重建基线调用 `createObservedSourceHashReader(entry, establishing, options.phase)`，排除了 coding 自身的历史写入；只有 owner 的完成证据仍 fresh 时才可能补回。coding 此时返修 FAIL，不能再靠旧 PASS 满足这项条件。用当前生产 reader 只读对照“排除 coding/不排除 coding”，恰好得到现场所报的 10 个路径；它们当前哈希都对应 coding-i3 的合法写后值。
4. 后备路径据此认为依赖变化，又因当前队首是 coding 允许它重建；提示同时保留旧基线禁改说明。i6/i7 随后确实不再携带 baseline，改写 facts 又让上游判过期。原件中的 first_phase 比较也是本批要收编的队首派活，但不把它说成本次 10 个差异的唯一原因。

上述结论来自真实事件/依赖逐字节比较、当前源码分支及生产 reader 对照；没有修改宿主事件或执行宿主检查。实施回放须在副本还原 i6 入场前状态，锁住整条生产链，不能仅凭 reader 的单点结果标完成。

### 2.3 已提交快照仍有迁移缺陷

更正前版的遗漏：`host-snapshot-3.1.0/migrate.ts` 已提交，不代表迁移行为正确，本批明确修复。当前生产 `computeGateFingerprint` 计算 plan 为 `3.1.0:874e45a17799`；只在内存将 rules 替换为前一提交内容，结果为 `3.1.0:022730770c99`。两行规则说明变化使旧快照 plan 失效并需真实重验，这不是缺提交，也不应伪造旧指纹通过。

模拟 Agent 的 `researchIfRequested` 只在 onCoding/onUt 调用，且用全文 `prior.includes` 去重：其它阶段的同路径不能满足当前 plan 的 `phase_delta: plan`。因此仅在 onPlan 加调用仍不够。**首选修法**：保留新规则文案，让需要调查的每个模拟阶段按生产解析的本阶段 delta（合并同阶段段落）与有效基线判断缺项，只登记当前目标；不改原始基线、不以其它阶段登记代替当前义务。不降低生产 `context_exploration_facts_scope_coverage`，不改旧快照原件。

Claude 在相同 HEAD 报告 feature-assessment 13/3、goal-budget-integration 6/3，以及 successor-exit-early 5、lifecycle-evolution 4、reliability-scenarios-foundation 2 条相关失败，共 17 条；本轮核实了指纹变化和 helper 缺陷，未重复运行这些长测试，不把他方执行说成本轮结果。若首选修法遭到具体新证据否定，才评估文案退路；本计划不以恢复“files 是唯一授权集合”的错误说明作为验收捷径。

所有通过 `migrateHostSnapshot` / `loadMigratedHostSnapshot` 的消费者必须复验，包括直接引用的 assess、blueprint-review-design、change-unit-content-revision、feature-assessment、goal-budget-integration、successor-exit，以及经共享 helper/套件分片使用的 lifecycle-evolution、reliability-scenarios-foundation。实施按实际调用关系补齐名单，整套/全部相关分片运行，不只复验已报红的 17 条。

## 3. 派活点盘点与收编表

下表是起草期已完成的生产派活盘点：按函数调用族覆盖问题对象、归属来源、缺席行为及收编动作；行号仅作当前定位。t1 只核最新代码相对该表的增量并补测试定位，不把首次盘点留给开工后重新设计。字段/路径消费者中“决定责任/授权/调度”与“仅展示”分开，不做全仓规则审计，不把此表变成运行时注册表。

| 生产位置/入口 | 修复对象如何确定 | 当前归属依据 | 目标本次缺席的现状 | 收编后的处理 |
|---|---|---|---|---|
| `repair-candidates.ts:116/479` 路径分类/review 候选 | 已核实 CR 的目标 files；不能用报错位置替代根因 | spec/plan 路径之外都算 coding；设计文件另分 | UT 目标被错误命名为 coding，缺席原因没有分析 | 从真实目标读责任契约，保留来源和核实；删除测试→coding 一律兜底；按有限兼容修补或真正 UT 工作分流 |
| `effectiveRepairOwner` / `collectPhaseRepairCandidates` / `buildSummaryRepairCandidates` | check 明示原因、受影响目标及具体失败证据 | 去向表、显式 owner 和分阶段三类过滤混用 | 不匹配分支可能无候选，留当前阶段重试 | 显式按成因归属先入共享解析，单一 check ID 不能覆盖多因缺陷 |
| `readPhaseRepairIssues` / `currentPhaseOwnsRepairTarget` | coding/UT 问题表的修复目标与可读证据 | coding 用路径兜底，UT 用 profile/契约 | 误当自有而过滤；非法格式静默零行 | 同源归属过滤，格式/证据/自有职责分别给可修反馈 |
| `harness-runner.ts:2402–2416` / finalizer `:602–658` | 自检/正式闭环里的检查及已核实问题 | 各自重组候选，finalizer owner 白名单没有 ut | 一侧可表达的 owner 可能被另一侧丢弃 | 一套归属/候选投影，不因阶段白名单吞 UT/testing |
| `scopeRevisionInputFromRepairCandidates` | 可信候选指向的新或重开义务 | category→fact kind→已有 provider/owner | request 和部分类别提前排除；缺 owner 不产提案 | 用真实负责方与请求授权生成既有义务，不能仅按终点标签决定权限 |
| `roundOwnerPhase` / `resolveInvalidatablePhases` / decline readers | 当前回修轮的问题与拒修结果 | 类别映射本轮链，尝试 full/lite | 映射不到就不参与失效；拒修可能找错责任阶段 | 与注入/调度同源，拒修理由返回原提出方；无新事实受原熔断约束 |
| `correction-routing.ts:57–128` / correction commands | 用户 correction 回答、问题分类与现有产物 | 固定类别表和 lite 特判 | 一处返回 null，另一处派给 chain[0] | 去除固定派活兜底，按请求与真实负责方处理，保留交互授权边界 |
| `phase-write-boundary.ts:194–300` | 要写的产物/源码及有效请求边界 | produces 先受 phaseOrder 裁剪，UT 根又无条件归 ut | 产物 owner 会因队列缺席消失，测试 owner 却仍存在 | 独立读取责任契约，再投影合法写入权限；不把缺席当改归属 |
| `check-coding.ts:354` / 写入观察 / runtime `:597` | 实际 diff、返修目标和历史合法写入 | UT 根+本周期 UT 证明；提示仍按 category/chain | 兼容修补交 coding，却仍强求 UT 写入证明 | 派修与写界一致，合法修改者与验证签发者区分，历史写入可承接 |
| `capability-resolution-entry-input.ts:220/298/472/526/579` / context-facts | 实际源变化、基线来源及本阶段增量 | first_phase 与当前队首比较，部分旧写入排除 | 基线丢失后派队首重建，上游又被新字节失效 | 原建立阶段负责基线；下游只追加增量，承接既有合法写入 |
| `upstream-verdict-gate.ts:284` | 当前真正消费的输入与负面结论 | order.slice 把排序前项都当硬前置 | 未出现报告跳过；前方阶段失败可能反挡其修复方 | 真实 requires/control_edges/输入依赖决定可执行性，完成仍核未闭合负面 |
| `utils/assess.ts:854` / renderer / goal-assess-driver | 候选、义务缺口与观测结果 | 再把 category 映射观测链，renderer 也重算 | 映射不到给 backtrack_target_absent | 推荐与执行消费同一动作；展示不再决定目标 |
| `execution-scope.ts` / feature-track / 有效视图 | 原请求、义务适用性与有效满足证据 | 已有 provider、授权域和证明推导队列 | 已完成/材料满足/不适用/未知均可能不排队 | 保留现有模型，按五种缺席原因消费；不造第二完成状态 |
| runtime 写越界、修订、backtrack、注入（`:7891/8876/9441/10718/11165`） | 已判定的真实修复或越权目标 | 授权域检查与数组位置/三类映射并存 | 有的可接回，有的因缺席或位于后面而拒绝 | 统一合法责任动作，复用原重开/重排事务，不另直跳游标 |
| phase-transition-policy / goal-runner-phase | 当前失败性质和已确定的修复依赖 | verdict→retry/advance；延迟主要用于外部阻断 | 没有内部 owner 交接时只剩重试/停止 | 内部交接沿义务，不伪装 device/external；真实 FAIL 不改成 PASS |
| design-repair-unattended / change-unit-design-preparation | 具体设计缺口及已核实设计目标 | 设计权威、借锁修订与独立质询 | 设计方不是 Feature 链节点，本来就走外部权威链 | 统一分派到原设计链，发布/重绑/接续照旧，不强加 Feature 阶段 |
| goal-mode-entry / decideRunContinuation / design-delivery-entry | 原请求变化、有效范围、未完责任及绑定 | 现有恢复/后继与预算规则 | 当前来源未完或绑定变化可续接/后继 | 继承责任/拒修/预算，不用换 run 避开派单或清计数 |
| verify-feature-completion / feature-assessment / progress/report | 请求终点、必要义务、真实执行和验证结果 | 有效证据为主，部分指导投影旧处置 | 可能只显示当前队列，漏讲历史执行/最终阻断 | 完成读责任闭环，展示历史与当前状态分开，终态指导对应最后原因 |
| 保真恢复 runtime `:6845` / goal-preflight | 真实保真/验收缺口 | 旧分支写 spec；入口 `:5964` 已先检查 spec 存在 | 不存在时不会无条件派 spec，不能把猜测写成事故 | 只作盘点及直接回归，保留适用守卫，按共享责任接线、不另造保真机制 |
| profile UT/testing / device readiness | 真实产品失败、工具链或设备证据 | 已有 coding/verification/capability/external 分流 | 不具备能力时本就有诊断/等待出口 | 同源归属不把所有异常变代码返修，不重做 395 判据 |
| `runtime-policy.ts:308` RequestRoute.direct（L0） | 用户请求的正式性/维护信号 | direct/feature 路由，与 lite 无关 | 不生成正式链是合法 direct 行为 | 记录并保留，不删除 L0 或强升 Feature；原生验证仍需要 |

所有写入 owner、候选 target、问题单过滤、拒修回传、assess 推荐与 runtime 调度须一致；“两个函数分别算出一样的字面值”不算收编。只有身份核对及历史展示允许读取冻结记录原值，不能据旧队列另判任务完成或可达性。

## 4. 前置减法：退役 lite，保留 spec-driven 非 lite 定义

### 4.1 删除范围与边界

| 范围 | 处理 |
|---|---|
| `harness/scripts/check-change.ts`、`check-exit.ts` | 删除专用入口及注册；有其它消费者的通用函数保留在既有合适模块，不以删除入口为由丢失正式轨检查 |
| `specs/phase-rules/change-rules.yaml`、`exit-rules.yaml`，lite 专属 `change.schema.yaml` | 删除专用规则/产物定义及当前 inventory、解析、注册引用；确认没有现代职责消费后移除相应适配 |
| `skills/legacy/change-lite/` | 删除整套退役 Skill/contract；移除 adapter/命令/模板和目录索引中的入口 |
| `workflows/spec-driven.workflow.yaml` | 删除 `auto_chain_by_track.lite`、coding 的 lite tracks/requires 覆写和 change/exit 节点；保留非 lite 的完整旧定义，不删除工作流文件 |
| 共享执行代码 | 清掉 runtime-policy、workflow-loader、config、runner、correction（含 VERIFICATION_CATEGORIES 的 exit）、Skill/receipt/facts/phase-state/写界、profile host 等处的 lite 专用分支、类型值及兜底；不保留“lite 实际映射成 full”的隐藏兼容 |
| 专用夹具与单测 | 删除 generic `fixtures/lite/` 与 HMOS `fixtures/lite/`、lite 专用用例及注册；混合套件仅去掉退役场景，保留现代责任、一般工作流和终态保障 |
| 当前指引 | 清除 `skills/feature/spec/SKILL.md` 的 `/change-lite`、`skills/project/component-design/SKILL.md` 的 `/change-lite`；同步现行 README、规则、模板、adapter、Skill 索引和活跃 OpenSpec 的可用入口说明 |

不得按名字误删：`lite-json-schema.ts` 及其单测是通用 JSON Schema 校验器；`check-change-unit.ts` 属 CU；`successor-exit` 等测试保障运行终态；进程 exit 钩子也不属于退役轨。历史 plan、归档规格及真实事件保留历史，不改写旧事实。当前对外规则不得再推荐 lite。

区分**废弃配置提示**和**旧运行身份**：新请求或现代 run 遗留的 `track: lite` 一律不参与派发，给一次明确的退役提示，按有效 execution_scope 或本次请求的义务解析继续；不能仅因这个残留键拒绝现代运行，也不把它转成 full 六阶段。对旧 lite 的识别先于已删除阶段/规则的注册校验；若冻结出生链（或既有旧协议识别出的实际历史链）包含 change/exit，则新版不执行该旧 run，沿现有入口诊断明确给出迁移办法，不静默失败、不篡改其原链。`MIGRATION.md` 写明：**已移除 lite；残留 track: lite 被忽略；旧 lite 运行用匹配的旧发布件收尾或重新发起运行，新版不续跑旧 change/coding/exit 链。** 新运行仍遵守既有原请求、真实授权和交付周期预算规则，不把迁移当预算清零手段。

用户 10-22 裁决同步到 91 总纲 §4/§10、P7 兼容矩阵，以及 P2/P4/P6/P8 中仍生效的 lite 保留承诺；注明本批 c2f7a91e 承接删除、旧历史仅作事实。P7 等已有 completed 状态不因此翻回 pending。现行 OpenSpec 规范在实施时走既有 change 提案同步；历史版本说明、归档 change 和旧测试执行记录不改写。

### 4.2 spec-driven 的本批评估结论

当前默认 SSOT 是 `harness/config.ts` 的 `obligation-driven`；其 schema 1.2 用 obligation provider、输入与 requires 推导所需阶段。`spec-driven` 是 schema 1.1 的旧完整工作流定义，除 lite 链外仍被兼容/恢复测试、通用 fixture builder 及旧 manifest 使用。测试树检索 `rg -l 'spec-driven' harness/tests profiles -g '*.ts'`（排除 node_modules/reports）命中 **45 个 TypeScript 文件：42 个测试文件、3 个 helper**；不是 45 个必须删除的独立能力，也不是现代生产入口必须保留旧默认的理由。

本批结论：保留非 lite 定义、其现有解析兼容及非 lite 测试；不批量重写 45 个文件，不借责任改造删除旧完整工作流。新责任规则只以 obligation-driven 的职责/义务及设计负责方建模。旧 full 若进入保留的兼容入口，沿现有输入转换到相同责任上下文，不新建旧轨派活表；不能只因无 `obligation_provider_id` 静默丢候选。用保留的 full 快照验证兼容即可，不为它发明新的编排模型。未来是否退役整个 spec-driven，需独立评估后另议。

现代工作流的轻量组合、`completion_target=request/feature` 与旧 `full/lite` 轨不是同一维度。本批删除后一组中的 lite，不删除小任务和单职责入口。

## 5. 统一责任与恢复设计

### 5.1 归属、授权、能力、依赖、队列分别回答一个问题

1. **修什么、谁负责**：先沿已有问题表→独立 verifier→候选，以及检查给出的具体原因确定修复对象，再用 Skill `produces/verifies`、artifact inventory、profile UT 根、实现职责、有效输入绑定和基线来源解析责任。分清**引入问题者、获准修改者、验证结论签发者**；测试报错不等于要改测试，facts 报错不等于要让业务 Agent 改基线。蓝图/CU/架构仍归设计方；日志与 `evidence_refs` 是证据，不因此成为要改的文件。
2. **能否派给它**：原请求及有效授权决定能做什么；有效 workflow/Skill/provider 与能力可用性决定谁能实际执行。显式按成因标出的 `repair_owner` 优先参与解析，但不能越过请求授权、把不存在的能力变成可用。多原因 check 不可只看 ID。
3. **何时执行**：既有 obligations、输入绑定、requires/control_edges 和有效证明决定待办及依赖；剩余 `phase_chain` 只是派生队列，`reused_phases` 也不是永久免修标记。编排和完成消费继续使用 28 的有效视图。

从 `resolvePhaseWriteBoundary` 内部复用/抽出原始责任契约读取，使其不先受当前 phaseOrder 筛选；写界是责任契约在本次授权和职责组合下的投影。不能反过来用已筛选写界证明“没有 owner”，也不能只因为某 owner 缺席就把测试文件改归 coding。三种角色的允许关系写入现有 Skill 契约/说明；不增加第二份角色登记表，源码修改权限不能隐含签发测试 PASS 的权限。

共享解析是现有调用中的纯派生结果，输入带现有请求/范围/能力上下文，结果供候选、边界、assess 与 runtime 使用。不新增持久 owner 表、角色登记表、事件类型、候选版本、状态机或通用策略引擎；不复制目录正则或 check-id→phase 清单。只有一处给出责任结论，各消费者各做原来负责的执行或核验。

唯一实现落点定为 `harness/scripts/utils/repair-responsibility.ts` 的 `resolveRepairResponsibility`。它复用写界背后的 Skill/profile/权威输入读取，返回本次内存结果：**修复对象、负责方、三种角色（问题引入者/合法修改者/验证签发者）、动作、原因**；不确定的角色保留未知，不猜成 coding。必要的契约读取辅助函数也集中在该模块；写界、候选、assess、runtime 和完成消费不得再各自重建责任表。实施 review 逐个调用点对照此唯一出处，结果不落成新注册表或状态文件。

### 5.2 修复候选可表达真实负责方

现有候选 `category` 只允许 spec/plan/coding，且代码注释认为 verification 没有回修语义，这正是 UT 替身无法正确派修的结构限制；本批必须把它和消费者一起收编，不能只在写界补一个 if。

复用 `CorrectionCategory` 已有的 `verification` 类别，修正 `RepairOwnerCategory`、既有 summary 校验与消费者的三类限制。验证类的具体 owner 从目标产物/义务解析为 UT、testing 或实际注册的提供方，不把 verification 固定等同于 UT，不给测试目录制造第二份清单。已有 `repair_owner` 字段和闭环投影也须能承接该真实 owner，不新增另一字段。

旧候选三类记录仍可读取；旧 `category=coding` 指向测试文件时，按 §5.3.1 的有限兼容修补或真正 UT 工作区分，不拿历史粗分类单独授予写权。现有指纹、来源、证据、拒修与轮次身份保持；不为分类纠正重置同一问题的无进展事实或硬预算；误派阶段已用的局部重试不转嫁为真实负责方已经重试过，沿现有阶段计数处理，不加新计数器。若一个问题涉及多个责任产物，按已核实修复对象生成各自必要义务，保留共同问题来源，不把混合文件集一律丢弃或全交 coding。

这属于**既有字段取值及责任语义修正**，不是无契约变化的抽函数。t3/t4 须同步 normal runner 与 finalizer、形状校验、候选注入、范围提案、拒修归属、重开与展示；旧 reader 的三类过滤不能残留。新候选使用既有 `scope_revision_input`；verification 依解析出的具体负责方选择已有 `unit-evidence` / `device-evidence` 等相应 kind，不能在 SCOPE_REVISION_FACT_KIND 再写死一个 verification→UT 映射，不造新义务家族。

### 5.3 五种动作及不能越过的条件

| 情形 | 使用现有通道做什么 | 质量/授权边界 |
|---|---|---|
| 当前职责能修 | 送入本阶段现有返修窗口，修后原检查重验 | 真实失败仍 FAIL，不以提案或接单代替完成 |
| 已执行 owner 需要重做 | 重开其义务，经有效视图撤销受影响证明、原回退事务重排 | owner 已复用或不在队列也可接回；不抹掉合法写入历史，不重跑无关上游 |
| 尚待执行 owner 能承接 | 把可信问题记入该 owner 的既有必需义务和提示；只执行不依赖未解决结果的合法工作 | 未做的下游工作不冒充当前阶段缺陷；但真实 review 否决仍未解决，需 owner 修复后完成受影响的 review/收口，不伪造 PASS |
| owner 当前未排队 | 在原请求已授权、provider 可用且该义务确有必要时，经原范围解析/修订纳入 | 完整 Feature 不等于六阶段全跑；显式只审查的 request 不擅自改代码；禁用/缺失能力不假装存在 |
| 蓝图/CU/架构需裁定 | 分流到既有设计负责方链，草稿、质询、检查、发布、重绑和正常 continuation | 无人值守仅在既有授权内静默修订；不由 coding/UT 原地改权威，不降低用户验收 |

上述是内部判定的五类结果，不增加五种持久状态或新事件。没有合法负责方、能力不可用、用户明确边界或硬预算挡住时，使用现有相应诊断/等待/停放出口，说明缺口和下一步；不能默认当前阶段重试，也不能凭空补一个节点。

**缺席原因先分清，再选动作**：

| 为什么没有该阶段 | 判定与处理 |
|---|---|
| 已完成 | 成果与当前义务仍有效就复用；真实新缺陷或输入变化才恢复，不能每次派单都重跑 |
| 已由蓝图或其它有效材料满足 | 消费已有合法结果，缺少物理阶段不补空调用；新冲突回真正产物责任方 |
| 本次不需要 | 不凭空派活；出现新事实时先重新判断适用义务，不按默认全链补齐 |
| 只授权审查 | 出具真实问题与影响，未经授权不改代码/测试；请求审查完成不等于产品通过 |
| 需要但能力不存在或被禁用 | 明确必要能力缺口和可行动下一步，不能冒充已执行、不塞给 coding、不发到幽灵阶段 |

授权规则从原请求的 `requested_results`、有效义务和原范围修订读取，不按 feature/request 标签自动允许或禁止一切扩链。“把这个功能完成”：原目标内必要工作且能力可用时可补入；“只审查”：不修改；“修这个函数并验证”：使用必要的实现和验证能力，不自动补蓝图或六阶段；用户明确限制目录、阶段、外部操作或总预算时仍遵守。无 run 与 run 内同源，不靠落盘方式扩大许可。

### 5.3.1 用户已确认：coding 有限测试兼容修补

用户 2026-10-22 已批准，并扩展为**有无独立 UT 职责均适用**：本次实现直接造成的既有测试编译/兼容问题，由 coding 当场修补；新增测试、修改断言仍归 UT。179a73 的 SpyBankRepository 补必填字段属于前者。不能再仅凭 ohosTest 路径把这类修补强制交 UT，也不能因没有 UT 阶段就把任意测试修改交 coding。

三种角色分别落实到 coding/business-ut 的现有 Skill 契约及说明：coding 可修改与本次实现直接相关的既有类型、import、测试数据或替身，前提是下面的保留检查通过；UT 负责新增/调整测试及断言；测试通过结论由真实测试执行与原核验接口产生，coding 的源码修改许可不是自报 PASS、改报告或降低验收的许可。review-only 不获得这项写权；验证能力缺失仍如实未验。

契约落点是 `skills/feature/coding/contract.yaml`、`skills/feature/business-ut/contract.yaml` 及各自 SKILL/reference：保留既有 `source/implementation`、`ut_source_and_dag` 和 verifies 接口，明确前者的有限兼容写入、后者的新增测试/断言责任；共享责任读取、调用写界、正式 checker 与提示都消费这一边界，不能只改文案。沿现有 `deferred_to_checker` 收集需要判断的修改，由新检查与原产出证据确认能否承接；不得把整个 UT 目录改归 coding，不伪造旧 owned 事件，也不再强求合法兼容文件必须由 UT 重新写一遍。

coding 做有限兼容修补时，在既有 coding 报告中逐项列出修改的测试数据/替身、实际修改及原因，review 照常审阅这些真实 diff。复用原报告及检查详情，不为披露另建必填产物、字段或门禁；不能把“已披露”代替保留检查和真实复验。

**只新增一项小检查 `coding_existing_test_preserved`**，准入场景为 179a73，收益是允许必要兼容修补且机器阻止改测试绕过失败。仅检查 coding 实际修改的测试源码，沿 profile 定位和现有测试源码解析，不扩成全仓测试审计：

- 对照本次修补前的有效原件，已有测试用例定义和断言必须原样保留，不得删除、修改；不得添加跳过/禁用标记，不得借改名/替换用例掩盖删除。新增用例、断言或必须改动原测试体的修法交 UT，不属于这项有限许可。
- 复用已有 Git/diff 基线或可读取的原调用材料取得真实前置字节；基线必须对应修补前版本。若 UT 此前已合法更新该文件，不能拿更旧的 run Git 版本替代它。现有 PhaseInvocationSnapshot 只有哈希，不能谎称可从哈希还原原文；原件不可取得或解析不能确认时，该文件不能使用有限豁免，按原通道交 UT/报告缺口，不新增快照系统。
- 原文件只是 fixture/Spy、没有用例或断言时，仍需确认修改后没有新增测试、断言或跳过声明；不能一律把所有“零断言文件”当可随意改写。
- 违反时保留真实失败，按同源责任交 UT 或报告实际能力/授权缺口，不默认让 coding 反复重试。自检与正式 gate 读同一份比较结果/输入，不再各写一套判据。

`ut_assertion_exists` 只检查用例中有没有 expect，不能替代前后保留检查。新检查只证明这些源码片段未被删改/跳过，不宣称整个测试行为或覆盖率已充分；真实编译、测试、review 与既有覆盖验收照常。按现有检查去向表/静态基线登记这一项，不新增停机原因、开关、候选字段、权限清单或状态协议。

### 5.4 编排必须服从依赖，不服从数组位置

`obligation-driven.auto_chain` 已声明只是排序偏好，review 与 UT 的 `requires` 都指向 coding，testing 依赖二者。统一 `upstream_verdict_gate`、候选回退、assess 与 driver 对“上游”的判断：根据本次真实消费的输入和依赖，而非一律 `order.slice(0, idx)`。

179a73 按用户新裁决的目标动作：CR-001 的既有替身必填字段兼容修补由 coding 当场完成，新保留检查证明原用例/断言未变，coding 写界不再要求 UT 曾经写过这个文件；随后 review 与业务 UT 真实复验。另用真正需要新增/修改测试的案例验证 review→UT：UT 不被正等待它修复的 review 否决反挡；未满足 review 与 UT 前 testing 和 Feature 完成仍不可放行。若缺陷实际是生产源码错误，UT 不能借此越过 coding 的真实失败；应回 coding 后再验。执行先后和结论通过是两回事。

当 review 的待修问题已交 UT、尚无修复或拒修的新事实时，调度应选可执行的 UT 责任工作，不能仅因排序偏好又先跑 review。依赖这一判断的事实来自既有问题、候选与义务关联，不另落临时依赖表；owner 返回修复证据或拒修理由后，原评审才继续裁定。保留 review 的真实否决，但不把它扩成与缺陷无关的所有执行操作都被禁止。

沿用已有范围修订、义务重开、拒修回传和有效视图，收编 `backtrack_to_phase` 与候选两条入口；无修订提案的回退同样按真实授权/依赖处理，不再用 `chain.indexOf` 的缺席结论或队首兜底单独派活。下游承接不能冒充 `externalBlocked` 走设备“延迟并继续”；不要新增平行 pending 队列。涉及失效时只按真实输入关系失效，不把全序所有后项都当依赖，更不能让下游新增测试/报告回卷无关 spec/plan。

只有 design 发布令冻结绑定失效等现有明确条件才经 `decideRunContinuation` 续接/审计后继；普通派单失误优先在有效范围内修复。原请求、累计预算、未完义务与拒修理由继续继承，不教主 Agent 拼需求增量刷新机会。

### 5.5 facts 与合法写入必须可承接

归属事实和“本阶段是否已完成”分开：撤销 coding 旧 PASS 是为了新修复义务，不会让先前真实且合法的 coding 写入变成未知外部修改。179a73 的旧兼容字节按用户新裁决和保留检查重新核验，沿当前规则生成有效结论；不改写历史 FAIL、观察归属或旧授权记录。复用现有 `phase_write_observed` 的归属、前后哈希及原调用身份，重签时按当前字节确认能否承接；不能要求修复阶段重做所有首次实现才拿回来源。

对**超出有限兼容许可的跨职责测试写入**（包括旧误派，以及被 `coding_existing_test_preserved` 判为越界或无法确认的新写入），不能事后给错误写入者补权，也不能当作永远清不掉的污点。共享责任判断将其转为真实负责方待办；若 coding 当前失败仅由这些待采纳的测试路径造成，不将这项失败当成阻止 UT 处理它的生产源码缺陷。生产源码的真实失败仍先修，完成裁决中的未闭合缺陷仍保留；不另加一条撤回再交接的平行路线。

真实负责方可以修正字节，也可以核验后保留当前字节；后者沿既有 UT 产出 manifest/有效闭环记录登记当前哈希，不强求“再改一遍”才有 owned 写入。coding 写界消费这份**晚于原误写**的有效负责方事实；原事实的 run/调用因果与输入哈希照旧核对，不新增采纳协议。UT 未采纳不能通过；采纳后 coding 再越出有限许可改写该文件，原事实仍按现有 voidedBy/新鲜度规则失效。需要的只是读取原有负责方事实，不能把整条 lineage 曾有 codingWrites 当永久否决。

原 facts 基线的建立者、内容与指纹沿原调用上下文/记录读取，不由当前剩余队首重定义。**下游阶段只追加本阶段增量，不改写基线；确需重建时交回实际建立阶段。** 返修接回 coding 时仍以原 spec 基线加各阶段合法增量读取；只是本阶段进入/失效，不要求重写 `established_by` 或旧来源。建立阶段未在当前队列时按其真实责任与授权接回，不能改称当前队首。纯框架承接故障先修框架，不让 Agent 重写事实把错误洗掉。

t1 查明的基线拒绝分支与新鲜度/上游门一起消费此结论，不能只改提示让 Agent 忍受冲突。外部改写、路径消失、UT 越权改源码、篡改原基线仍应被识别；“合法历史写入可承接”不等于历史 PASS 永久有效，也不忽略契约或真实源文件变化。

### 5.6 上游提案必须能修正，终态必须可行动

继续使用已登记 `coding-upstream-issues@1` 的 `coding/upstream-issues.md`、UT `testability-audit`、review 问题表及逐条独立核实。不增必填报告或新提交命令。报告缺席仍合法；文件存在却解析为零行（含只有段落）时，在 coding 报告给出期望问题表格式并带入下一轮提示。已有行无可采纳条目时分别反馈重复 ID、行号不可读、当前职责应自修或责任不明，不能只留下“0 candidate”。合法的显式“无上游问题”不需制造问题；反馈不新增阻断门禁。

可读事实 → AI 提案 → 独立核实 → 真实 owner 修订/拒修 → 原阶段带理由复验的链保持。修复对象与证据分开解析，UT 测试和原 spec facts 不能被 coding 的路径兜底过滤掉；普通自有缺陷也不能伪装上游问题逃避修复。责任方拒修后理由回原阶段，旧核实不能忽略新拒修；同一问题无新事实沿既有无进展/预算收敛，不加计数器。

终态从最后有效失败与责任判定生成“具体原因、谁能修、下一步”。真实外部障碍和无合法入口如实说明，不强派 coding。报告保留“review 曾执行且失败”与“当前 review 未满足”两个事实，不用剩余阶段列表抹掉历史；不沿用早一轮的 backtrack 作为最终指导。历史无指导记录仍保留，回放只证明新代码能生成正确指导。

## 6. 减法、机制准入与文档同步

不采用的方案：不放开 coding 修改整个测试目录；不按 feature/request 标签二分是否扩链；不退回“files 是唯一授权集合”等旧规则文案；不新增 owner/角色注册表或状态机；不按队首兜底派活；不把 lite 映射成 full。这些做法会掩盖真实责任或重新制造平行规则，本批只沿既有职责、义务、核实与恢复链收编。

| 改动 | 场景与收益 | 复用与代价边界 |
|---|---|---|
| 删除 lite | 退役轨仍影响共享归属与回退，让“轻量”混指两套模型 | 删除专用代码/测试和 live 引用；旧运行明确退出，不新增兼容执行器 |
| 共享责任与派发 | 179a73 同一 UT 文件一边派 coding、一边禁止写；缺席阶段导致幽灵派单 | 复用 Skill/profile/义务/授权及原恢复事务；内部纯派生，不新增注册表、状态或协议 |
| 有限测试兼容保留检查 | 用户 10-22 追加裁决；179a73 必填字段修补被写界误拦，但放权不能让 coding 删改测试绕过失败 | 只新增 coding_existing_test_preserved，复用实际 diff、前置原件与现有解析；保留新增测试/改断言的 UT 职责，无原件不虚报通过，无新状态/协议 |
| 候选接入 verification | 三类字段不能承接真实 UT/testing 修复 | 扩展既有字段至已存在的 CorrectionCategory 语义，同步旧记录兼容；无新字段、版本或停机原因 |
| 按真实依赖承接 | review 发现 UT 缺陷，却可能阻止 UT 修复 | 复用 workflow requires/control_edges 与绑定输入；不放行真实否决，不造“临时通过” |
| 写入/基线与反馈 | 返修丢已观察归属、无效提案被吞，Agent 只能反复改错地方 | 沿既有观察、上下文、报告与诊断；不新增证据账本、恢复快照或格式门禁 |

同步当前 Skill/reference（spec、component-design、coding、review、business-ut、device-testing、goal-mode）、产物/运行契约、check 说明、workflow README、相关动态工作流/责任恢复/OpenSpec、MIGRATION。逐项删掉“测试一律交 coding”“目标缺席回队首”“review 排在前面所以必是 UT 上游”“旧 lite 仍可执行”等不一致指引。非本批的设备诊断、组件许可、性能缓存不扩面。

`spec-driven` 的非 lite 兼容说明与默认 obligation-driven 区分；不删除通用组合能力，不把所有小任务重命名成 full 六阶段。overview 四条总原则原文保持；必要解释放职责/编排文档，不另写一套原则。

## 7. 开发验收：生产接线与反例

历史层持续识别旧事件中的错误，生产层把相同输入交给新代码执行正确动作，两层不可混用。模型/设备执行可用限定替身；归属、检查、候选、核实、范围修订、写入观察、基线、上游门、runtime、拒修及完成判断必须走生产入口。不能手填一个 owner 然后只测试 switch。

| 场景 | 必须证明 |
|---|---|
| lite 完整退役 | 专用文件/注册/分支删除，当前公开入口不再出现 `/change-lite`；残留 track: lite 被忽略并明示，现代请求照义务运行；实际 change/exit 旧 run 不续跑且给迁移提示，不转 full；通用 lite-json-schema、CU 与终态测试保留 |
| spec-driven 评估边界 | 非 lite 定义保留，受影响 full fixture/旧记录可读；没有批量删除 45 个引用或重新写一套旧轨责任规则 |
| 同源归属 | review/coding/UT 提出相同修复目标与原因时得到相同修改/验证角色；普通源码、UT 替身的有限兼容/测试设计两种原因、spec/plan产物、facts基线/增量、设计权威分别正确；证据文件不误派为修复文件 |
| 完整义务链 | review→UT 测试修复，UT→coding 生产修复，testing→plan/spec 真实定义修复，设计方另链，修后实际核验；真实 review FAIL/P0/断言失败未被放行 |
| 裁剪义务链 | owner 已复用、尚未排队、受定义缺口暂挂时都按授权和必要义务处理；正常下游测试/报告不回卷上游，无关阶段不被强制加入 |
| request | 只 review 不改代码；阶段限定不能越权；小修加验证不升级整条链；无 run 和 run 内结论一致；provider 禁用/缺失时不派幽灵阶段 |
| 实现破坏旧测试 | 有独立 UT 和无独立 UT 两种均由 coding 完成有限兼容修补；旧用例/断言原样、无跳过才允许；删改用例/断言、新增测试、加 skip 或无法确认均交 UT/报告缺口。交接后 UT 修正/核验采纳即可继续，coding 不因这些测试路径的失败反挡 UT；生产源码真失败仍先回 coding，验证签发独立 |
| 依赖与质量 | UT 可修等待它的 review 问题，但不能绕过真正有缺陷的 coding 输入；未闭合 review/UT 时 testing/完成仍被挡；无平行临时 PASS 或新的延迟状态 |
| 179a73 正确组合 | 从 coding-i3 合法写入与原 facts 基线、review CR-001 开始，coding 补旧替身必填字段且保留检查通过，再 review/UT 真实复验并继续完成；不再强求 UT 曾写同一文件 |
| 179a73 已失败状态恢复 | 固定 i6 入场前状态恢复（不是拿 i7 终态冒充）；已有兼容字节按新保留检查重新核验，合法历史源码写入可承接，不重签原 spec facts；i7 另核终态指导。错误提案获反馈后核实/拒修均能继续 |
| 非兼容旧误派恢复 | UT 保留现有字节不改写但真实核验/采纳，写界闭合、review复核后继续；UT未采纳仍不通过；采纳后coding再作不获准修改，现有 voidedBy/新鲜度拦住 |
| facts 反例 | 原字节真改、外部未知写入、契约变化或非法跨职责改写仍会触发对应责任处理；只撤销 PASS、重排队首或增加下游报告不导致基线丢失 |
| 拒修/重开/接续 | owner 拒修带理由回原阶段，同问题无新事实不能反复续跑；有效新事实可重开；设计重绑后的后继沿原入口且不重置预算/未完义务 |
| 最终报告 | 终态含最后具体检查/原因、真实 owner 与下一步；如实显示 review 已执行但结论未满足；不沿用过期恢复指导 |
| 快照迁移 | 保留当前新规则文字，plan 指纹变化导致重验时，模拟 Agent 正确补本阶段 delta；同路径只在其它阶段登记不能算本阶段完成；全部迁移消费者继续正常完成，不退旧文案或抹指纹 |

组合采用两两覆盖，避免全排列：阶段链形态（现代 Feature 裁剪链、自定义/禁用阶段）× 完成终点（feature、单职责 request）× owner 状态（已完成、尚未执行、不适用、不可用）。对可恢复且已授权的格子，验收终点必须是修好、复验并按请求完成；只审查或能力不可用的格子验证准确结果/缺口且不扩权，不以“补回一个节点”算成功。

目标测试覆盖对应函数与真实 runtime 接线。必要反向变异至少锁住：测试回退旧 coding 兜底、有限兼容保留检查失效、候选/finalizer 丢 UT、上游门改回队列前缀、返修遗忘合法写入、原建立者被新队首覆盖、问题单过滤无反馈。对于已有另一机制正确接住的变异，不为了单点变红添加镜像断言；验收真正错误动作或假通过是否被抓住。

受影响 release-only 按现有注册整套执行：`real-chain`、`real-chain-seams`、`reliability-scenarios`、`design-authority-repair`、`change-unit-revision-recovery`、`lifecycle-evolution`，按既有用例/套件分片并行，保持工程副本隔离、汇总不漏用例。此外覆盖普通 successor/repair continuity 与 §2.3 全部迁移消费者。不能以默认 npm test 的 SKIP 或只挑单例代替。先定位目标测试，稳定代码再跑一次官方 `cd harness && npm test`（含官方 typecheck）、`npm run openspec:validate`、`node scripts/check-plan-version.mjs` 与 LF 检查；后续窄返修复用仍有效整套结果。关键责任/承接/反馈分支做生产变异，所承诺错误动作必须被回放抓住。

按“老规矩”执行实施：主会话调度与验收，实际开发/返修委派 `gpt-6.1-sol`、`xhigh`；实际 Claude Code CLI review 并打印调用、真实模型和结论。中途核对自行调用 CLI，不设阶段性用户停点；本批全部完成后统一交 Claude 评审。§5.3.1 已获用户明确裁决，按两项边界实施，不再重复请求确认。记录在 `harness/reports/c2f7a91e/`；不新建 `.cursor/` 目录。提交须用户批准，提交信息不带署名尾注，不打包，宿主重跑由用户安排。

## 8. 当前状态与宿主验收

2026-10-22 修订：起草期已完成 §3 派活盘点，核实三种责任角色、缺席原因、facts 无变化拒收与自身写入排除、快照门禁指纹和模拟 Agent 缺口；按 91 g2 收口，不另起架构。同步用户授权范围内的相关 plan 正文，开发 t1–t8 仍 pending，待评审及用户实施指令。尚未复制本批正式回放夹具，未删除 lite、未修生产/测试代码；不得将诊断或他方测试报告写成开发通过。用户 10-22 已确认并扩大 §5.3.1：有无独立 UT 均由 coding 作有限兼容修补，新增测试/改断言仍归 UT，并明确授权新增一项前后保留检查；当前仅写入计划，未实施。

开发闭环之后，与 8a t8 及前序联合 pending 待办共用一次用户安排的原需求干净观察。关注实际交付、能否交给真实负责方修好继续、无效回卷与非必要人工介入；未出现的恢复分支只认开发接线覆盖。保留 395 引导分支真机未验证的事实，不恢复或制造 OOBE。当前宿主与手机不操作，旧运行不手修，不将观察失败倒写为旧批开发未完成。

2026-10-22 计划核对：实际调用 Claude Code CLI，订阅登录，模型 claude-opus-5-5。首个模型调用达到轮次上限无结论；一次命令行传入全文超过 Windows 长度限制未启动模型，随后改用标准输入。有效首评 9 轮指出旧误派字节需由真实负责方采纳，已补；用户随后批准并扩大有限兼容修补权限、授权新增保留检查，最终窄复核 2 轮确认裁决及既有返修落实，仅要求把同一承接路径覆盖新检查不通过的写入，现已按原文边界补齐，不再整轮重审。CLI 原始结论与调用记录位于 harness/reports/c2f7a91e/；此记录只说明计划核对，未实施、未跑开发全量测试，todos 状态不变。

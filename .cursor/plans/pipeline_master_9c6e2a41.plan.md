---
name: 六阶段效率与准确性重构总计划 — HMOS × Claude/Codex × goal/非goal
overview: B01先细化施工图，后续批次滚动设计，宿主回归收敛为两个检查点（B02 后、B06）；核心四格实测，codeagent及attended保留fixture覆盖，不新增机制。
version: 3.0.0
todos:
  - id: b01-accept-verifier-repair
    content: 验收B01施工图：负面结果可诊断回修、输出解析一致、删除过时指令；目标测试和用户触发的C-U宿主回归通过。
    status: pending
  - id: b02-accept-vision-evidence
    content: B01本地验收后细化并验收B02，解除inline终签死锁与非goal/attended不可达；保留completion probe，完成B01+B02合并C-U回归（spec→ut窗口）。
    status: pending
  - id: b03-accept-execution-reuse
    content: B02本地验收后细化并验收B03，按真实浪费解决UT重复构建/执行和报告整理，不重构进程生命周期；本地验收，宿主回归并入B06。
    status: pending
  - id: b04-accept-attribution-prior-review
    content: 细化并验收B04的归因与prior review消费两项，不改one-shot、不新增变化范围调度；本地验收，宿主回归并入B06。
    status: pending
  - id: b05-accept-phase-contracts
    content: 细化并验收B05的默认strict/显式配置、剩余F09、plan不适用出口和expect数量WARN口径；本地验收，宿主回归并入B06。
    status: pending
  - id: b06-accept-matrix-delivery
    content: 复用B02后的合并C-U证据，完成B03–B05的C-U回归，补C-N/X-U/X-N真实差异与codeagent/attended回放fixture，完成候选件验收与发布就绪。
    status: pending
---

# 六阶段重构总计划

## 1. 目标与执行方式

用户要求覆盖HMOS的Claude、Codex两类adapter及goal/非goal，并按总plan和子plan分批完成。2026-09-06吸收Claude评审：只有B01细化为可执行施工图，B02至B06保留提纲，前批本地验收通过后再细化、评审、实施。宿主回归收敛为两个检查点（用户2026-09-06裁定）：B02完成后一次，spec→ut窗口同时验收B01与B02对真实模型行为的改动；B05完成后一次并入B06矩阵。代价：B03–B05若有只在宿主暴露的问题，靠批次边界重打候选件二分定位，而不是逐批实跑。施工图须有具体行为、文件、非目标、代价、提交边界和可执行验收；不机械照搬07a41ec6的篇幅或取舍数量。

覆盖 spec → plan → coding → review → ut → testing。原则SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)。保留原生编译/测试、质量目标、范围授权、设备凭据和硬预算；不新增平行状态机、常态人签、通用缓存平台或独立传输层。

全部plan绑定当前3.0.0窗口，不bump版本；真要顺延再按version/deferred_to规则处理。总todo只记验收里程碑，实现待办只在子plan。仅修订plan不代表实施或宿主验证完成。

保留 [07a41ec6](3.0.0效率优先_闭环仪式减法与verifier一次化与证据按输入复用_07a41ec6.plan.md) 与 [d2f7a9c4](verifier证据链裁剪_删hook发布与身份绑定_报告即真源_d2f7a9c4.plan.md) 的成果；后者t6-verify-and-host仍待验收，复用有效结果，不代勾状态。

## 2. 本轮评审裁决

| 意见 | 裁决与落实 |
|---|---|
| B01只有原则、缺施工细节 | 采纳：B01冻结D0至D8、精确资格、调用顺序、命令与宿主完成判据；其余五批滚动细化 |
| 宿主验证太晚 | 采纳后于09-06按用户裁定收敛为两个检查点（B02后、B06），见§1；B06只补差异格 |
| 撤回completion-kill改造 | 采纳：B02去inline质量消费者后保留summary probe/grace/kill。stdout仍供CLI硬失败诊断和usage，不能说完全无消费者，但不据此等待阶段全文；独立visual provider不混改 |
| 矩阵过重 | 主实测C-U/C-N/X-U/X-N；K/A保留静态、生产函数、回放、fixture覆盖，不强制本机缺席工具实测，不新增支持；满足原请求的两类adapter×两模式 |
| Codex传输前提过时 | 采纳：接受09-05宿主确认的verifier能力与现有Task/subagent_type协议，B01只核对，不抽象传输层 |
| 过时指令先删 | 采纳：已明确的后续阶段MUST subagent、attestation BLOCKER、无provider旧证明要求移入B01；B05检查剩余一致性 |
| B04过于投机 | 采纳：one-shot和新变化范围调度本轮不实施，原todo取消；已有熔断保留。真实宿主新证据出现才重新登记 |
| B05范围蔓延 | 收缩到F08、剩余F09、plan不适用出口、数量WARN。静态it_drives_flow本来就是WARN，不重复降级；仅对齐误导建议和verifier按数量硬判 |
| 宿主集成由用户触发 | 采纳：候选件先准备，主宿主替换、物化和goal实跑由用户触发或明确委托；本组plan实施授权不自动包含这些外部变更 |

## 3. 事实、证据与落点

| 编号 | 已确认事实 | 落点 |
|---|---|---|
| F01 | review负面/UT真实断言FAIL无verifier请求，回修又依赖verifier；生产writer复现 | B01 |
| F02 | UT正式PASS表格与只读YAML消费者不一致；生产解析器复现 | B01 |
| F03 | HMOS spec-i3..i5的结束后签回执与内部门禁冲突；完成清理后的非零退出又拒签 | B02；不据此改通用probe |
| F04 | 非goal终签要求goal身份；Codex terminal与逐图审计不同 | B02 |
| F05 | attended callback无stdout却有inline消费；共享prompt注入unattended指令，静态调用链成立 | B02去inline；B03细化模式提示，fixture验证 |
| F06 | codeagent attended为manual，Claude/Codex为in_session；生产路由复现 | B06回放/fixture，不增加支持 |
| F07 | timeout settled计one-shot attempted；函数复现但无浪费有效机会的宿主实证 | 观察，不实施 |
| F08 | 相同balanced配置在goal被强制strict；策略复现 | B05保留默认strict、允许显式配置 |
| F09 | facts增量/漂移WARN/无provider豁免已实现，部分硬文案未同步 | 明确项B01，其余B05 |
| F10 | 重复harness/UT出包、timing控制复用、固定章节与断言数量 | B03/B05按反馈细化，不引申新系统 |

代码：[harness-runner](../../harness/harness-runner.ts)、[回修](../../harness/scripts/utils/repair-candidates.ts)、[runtime](../../harness/scripts/goal-phase-runtime.ts)。原宿主样本只读路径：D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-1/goal-runs/20260905T103028Z-79d3fd。

## 4. 验收矩阵

| 格 | 验证等级 | 重点 |
|---|---|---|
| C-U | Claude goal无人值守，B01至B05逐批实跑 | stream-json、负面回修、收口、无重复仪式 |
| C-N | Claude非goal，B06真实差异 | 当前Task委派、调用方写报告、Stop、无goal身份 |
| X-U | Codex goal无人值守，B06真实差异 | exec JSONL终态、已登记verifier、审计none不误判盲 |
| X-N | Codex非goal，B06真实差异 | 当前verifier协议、无hook依赖、无goal身份 |
| K-N/K-U/K-A | codeagent静态/回放/fixture | .cac身份与共享模板，K-A的manual回退不冒充自治支持 |
| C-A/X-A | attended生产bridge fixture/回放 | 显式身份、callback、waiting/resume、模式提示 |

N的manual/batch作为授权子用例，不增加两套真实六阶段验收。核心四格覆盖六阶段公共契约，至少一条真实贯穿链，其余复用有效基线做真实差异片段，不要求四次重新开发需求。补充格不标实测PASS；增加真实支持须另行明确范围。

原生/goal、/goal-mode、bridge和external runner只检查当前入口与既有runtime一致；元数据不等于可调用能力。本轮不借入口审计统一重写执行器或原生产品行为。

## 5. 批次与依赖

| 批 | 子plan | 当前范围 | 状态 |
|---|---|---|---|
| B01 | [verifier回修施工图](pipeline_b01_verifier_repair_3a7f9c12.plan.md) | F01/F02、明确F09删除、adapter现状核对 | 可按施工图评审实施 |
| B02 | [视觉提纲](pipeline_b02_vision_evidence_8d2b4f60.plan.md) | inline/goal身份死锁与视觉事实分离 | B01本地验收后细化 |
| B03 | [执行复用提纲](pipeline_b03_execution_reuse_5e1c7a93.plan.md) | 重复构建/执行、报告整理，保留probe | B02本地验收后细化 |
| B04 | [归因与prior review提纲](pipeline_b04_scoped_recovery_2f8a6d40.plan.md) | 仅归因和prior review消费者一致 | B03本地验收后细化 |
| B05 | [策略与适用性提纲](pipeline_b05_phase_contracts_7b3e9a15.plan.md) | 默认strict/显式配置、剩余F09、n/a、数量WARN | B04本地验收后细化 |
| B06 | [差异验收提纲](pipeline_b06_matrix_acceptance_4d9c1f72.plan.md) | 核心四格差异、补充fixture、发布就绪 | 前批证据齐后细化 |
| B07 | [视觉回修归因与golden复用施工图](pipeline_b07_visual_repair_attribution_6e4a2c8b.plan.md) | minor视觉信号不产coding候选、T8 hard不得降级、复用不绕过golden采集、B06 E格适用性前置 | 本地完成并提交（09-07：06dcfe1d 施工图 / 40ec6c26 D1–D3 / 1387a249 D6 / C3 实施记录）；codex 两轮 approve、全量 npm test 3901+46 全过；宿主补验收归 B06 `b06-host-b07-reacceptance` |
| B08 | [复用证据绑定与长图推导施工图](pipeline_b08_reuse_evidence_and_ref_derivation_9b2d5e7c.plan.md) | 复用态证据按执行键身份核验、执行键 HAP 回落与 hap 未知记录不参与复用、参考图顶部一屏推导、unverifiable retry 不打归因 | 本地完成并提交（09-07：be5a3448 施工图 / 90ce28a0 D1–D4 / 8f76266e D6 / C3 实施记录）；codex 两轮 approve、全量 npm test 3937+46 全过；宿主补验收归 B06 `b06-host-b08-reacceptance` |

前批代码、相关文档、目标测试通过并提交后即可细化下一批；宿主C-U回归只在B02后与B06两处，用户未触发则对应host todo保持pending。若已知后批缺陷挡住目标窗口，明确记录依赖并调整前置顺序，不造PASS、不越批热修，也不连续叠五批未验收改动。

B07（09-07 据 B06 取证新增，[6e4a2c8b](pipeline_b07_visual_repair_attribution_6e4a2c8b.plan.md)）只做本地修复：完成判据 = 其 §7 本地验收 + 根 AGENTS 的一次全量 `harness npm test`；宿主补验收是 B06 的 `b06-host-b07-reacceptance`（用户触发、窗口由用户定），B06 收口以该项为里程碑之一。B07 的 plan 评审不走 dev/review 循环（用户裁定），实施与检视才走。 B08 同此：本地完成判据 = 其 §7；宿主补验收是 B06 的 `b06-host-b08-reacceptance`（用户触发，testing→testing 窗口）。

本轮取消通用completion probe重构、one-shot改造、新变化范围调度、可测性前移体系、测试质量体系重写、K/A新增真实支持。既有局部重验/漂移分级照常使用。观察项再入实施必须重登frontmatter，不能成为隐藏待办。

## 6. 逐批宿主与交付

每个宿主检查点（B02后、B06）先准备校验的candidate zip、变更说明及精确宿主命令，由用户触发集成和C-U运行，或明确委托后执行。bc-openCard-1作产品基线，优先隔离验收副本，从有效上游进入受影响阶段并跑到本批窗口闭环，不每批重写六阶段。

必须有真实goal调用、目标生产行为及无直接回归；诊断发现产品FAIL是合法中间态，最终须回owner修好并闭环。未解决外部依赖如实未完成，不用dry-run或中间FAIL冒充宿主通过。

仅plan变动跑plan校验；生产改动typecheck和目标测试，发布内容遵守AGENTS全测。candidate:build已有的全量结果复用，纯文字返修不再全测。收益从现有events/summary/tool日志记录，不建A/B或基准平台。

复用 [candidate-release](../../scripts/candidate-release.mjs) 构建/测试/校验，宿主替换和物化由用户触发，禁止热改framework源码。实施及宿主验证真实完成才勾plan，之后按既有promote提升同一zip并补全局发布门禁；正式发版不是plan完成之前的循环前置，本计划只交付候选件验收与发布就绪。

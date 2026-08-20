## Context

P0 已冻结单向引用：Component closure 只能由一份部件蓝图、归属该蓝图的 Change Unit 与既有执行完成事实派生，不能成为可手改完成台账。P1 已提供 `component-blueprint@1`、确定性 component path、稳定 blueprint/view/node/relation/flow/decision/contract 地址、跨视图与 runtime 完整性门、分层准入和 revision/fingerprint 调和，但现有 `discovery.inputs` 尚未把当前范围原始需求形成可寻址闭集，演进卡的 `human_decision` 也未冻结枚举。P2 已提供 `change-unit@1`、确定性 CU→Feature identity、ID-only Feature 施工映射、四态 completion observation、exact dependencies、carry-forward 与无状态连续推进，但其接缝门目前会把所有 `evolution_candidate` 都当成已建缝。

当前仍缺少一个可信消费者把这些局部事实重新组装成部件级证明。`verifyFeatureCompletion()=VALID` 只能说明单个 Feature 的阶段和证据闭合；它不能证明全部目标谓词都有 owner、蓝图设计被施工消费、跨 CU 的状态传播真实贯通、迁移/NFR 已收口，或已批准的宿主演进接缝确实可替换且未被 Consumer 绕过。

本设计受复杂能力总纲 §6.1、§6.6、§9、§11.2–§11.3、§15，3.1 总计划 §6.4、§9、§11–§13，以及 P0/P1/P2 已冻结契约约束。首个真实宿主仍是 AI 记账 App；framework fixture 只证明机械语义。

## Goals / Non-Goals

**Goals:**

- 固定 `component-closure@1` 的 component-owned、可重建派生投影及输入绑定。
- 以 P1 discovery traceability 收紧当前范围需求/目标/不变量/高风险的稳定来源与蓝图映射，使 P3 能发现“输入存在但蓝图漏接”。
- 从当前蓝图和 canonical CU 集机械派生不可由作者删减的 closure obligations。
- 把每个 obligation 对账到 CU/组合 owner、Feature 施工映射、实现、适当验证层级和可信证据。
- 复用 P2 completion/carry-forward/dependency 语义，不创造 P3 完成事实或历史改写入口。
- 在部件层重建适配 4+1 跨视图关系、runtime 数据流、组合边、迁移/NFR 和宿主演进接缝证明。
- 冻结 `establish_seam|keep_direct` 并让 P2/P3 只对前者启用接缝施工与闭环义务。
- 输出确定性 verdict、结构化剩余缺口和供团队评审的单向 Markdown projection。

**Non-Goals:**

- 不实现跨部件 Capability E2E closure，也不因单部件 PASS 宣称其它部件或完整能力完成。
- 不新增 registry、执行账本、checkpoint、全局事件日志、锁、daemon、动态插件运行时、通用引用注册表或图执行器。
- P3 evaluator 不反向修改任何 P1/P2/Feature/Goal Mode 实例事实；本 change 只原位收紧尚未归档的 P1 traceability/evolution 与 P2 seam 判定协议。
- 不把五个视图拆成独立完成台账，不复制稳定工程知识，不用文件存在或 Markdown 自报 PASS。
- 不要求无蓝图归属的独立小 Feature 参与 Component closure。

## Decisions

### Decision 1: closure 是 component-owned 派生投影，不是第三套完成事实

当前闭环投影使用唯一确定性路径：

```text
<project_root>/blueprint/component/<component_id>/component-closure.yaml
<project_root>/blueprint/component/<component_id>/component-closure.md
```

YAML 根对象为 `component-closure@1`，至少包含 `component_id`、target=blueprint 的完整 `component_blueprint_ref`、`input_fingerprint`、`evaluated_at`、排序后的 requirement-source/CU/Feature observation、coverage rows、provider observations、knowledge writeback refs、degradations、gaps 与派生 verdict。YAML 不保存自哈希；loader 从原始字节返回 `artifact_sha256`。若未来上游需要引用 closure，只使用 loader 返回的 `(artifact, component_id, component_blueprint_ref, input_fingerprint, artifact_sha256)`，不增加注册表或任意路径 fallback。

`input_fingerprint` 从排序后的输入 manifest 确定性计算：P1 已验证的 `current_scope_items` source identity、完整 requirement traceability mappings、蓝图 ref/原始字节 hash、所有 canonical CU ref/原始字节 hash、派生 Feature identity、Feature contracts/acceptance/completion 绑定、权威 evidence/receipt hashes 和会影响裁决的 provider observation identity。时间戳、展示顺序和 Markdown 不进入 fingerprint。checker 每次由稳定内核重新枚举输入、派生完整 obligation/coverage row/verdict 并与 YAML 逐字段对账；作者写入 `PASS`、遗漏 row、调换 owner/evidence 或伪造输入 hash 均失败。

首次生成由现有 checker 的 `--write` 模式执行固定顺序：evaluate 当前权威输入，原子写 canonical YAML，从实际 YAML 字节计算 hash，用该 YAML 与 hash 确定性生成 Markdown，再通过同一生产校验入口复核。Markdown 必须在进入团队评审前完整展示蓝图身份、CU revision/hash 与 completion/carry-forward 原因、Feature contracts/acceptance/completion/evidence hashes、coverage 的 source/blueprint/Feature mapping 与精确 evidence identity、Provider authority observation，以及 gap 的 source/obligation/needed-by；它不是 SSOT，不能反向覆盖 YAML 或输入事实。

备选方案是在蓝图根写 `closure_status`。这会让 P1 拥有 P3 状态并在每次执行事实变化时重写蓝图，故拒绝。只输出临时控制台文本又无法形成可复核团队评审材料，亦拒绝。

### Decision 2: 输入集合只按既有 component path 和显式 supersedes 计算

稳定内核先加载当前 component blueprint，要求 P1 schema、identity、fingerprint、questioning/admission 全部有效。P1 在既有 `discovery.inputs.current_scope_items` 中保存权威输入包已识别的 `requirement|goal|invariant|high_risk` 闭集：每项带稳定 `item_id`、kind、指向精确来源/fragment 的可解析 `source_ref`；项目内文件必须绑定实际原始字节 hash，revision 只能作为附加 identity。`source_fingerprint` 只从规范化 discovery facts、这些 current-scope source identities 及其 provenance/revision/hash 重算。`discovery.requirement_traceability` 必须以相同 `item_id` 与之双向一一覆盖，并映射至少一个真实 blueprint stable address，但 mapping 不进入 `source_fingerprint`；mapping 变化通过 blueprint revision、原始 `artifact_sha256` 与 P3 `input_fingerprint` 失配体现。P3 还会重读相同本地来源，把实际 raw hash 放入既有 input manifest，避免人工 revision/hash 未刷新时旧 closure 假绿。来源缺失/越界/不可解析、source hash 缺失或不符、重复 ID、任一输入无 traceability、额外 traceability、空映射或悬空/外部 component 映射直接形成 blocker。随后只枚举同一 component 的 canonical `change-units/*.yaml`。P3 不解析 PRD 自然语言，也不从目录猜需求；无法提供稳定 source fragment 的非结构化材料由既有人工权威输入先给出 current-scope item identity，而不是由 closure 猜取。首期不新增 `traceability_fingerprint` 或其它状态。

当前有效 CU 集默认包含目录内全部合法 CU。若一个合法 CU 通过现有精确 `supersedes` ref 指向另一 canonical CU，则被指向者仅作为历史输入保留，不再单独承担当前 closure obligation；superseding CU 必须完成并覆盖当前蓝图切片。一个历史 CU 被多个当前 CU 冲突 supersede、ref/hash 不匹配或 supersedes 形成环时 fail-closed。`revises` 只表达修订关系，不自动退休旧 CU。首期不建设迁移表或 semantic diff。

每个当前 CU 重新执行 P2 artifact/design/Feature projection 校验。当前蓝图 identity 上的 CU 必须有 `VALID` completion；引用历史蓝图 identity 的已完成 CU 只有 P2 carry-forward 对全部历史 stable target 返回 allowed 才可贡献覆盖。`ABSENT` 为未完成 gap，`STALE` 路由重新派生/重执行，`INVALID` 路由完成证据修复；P3 不改写这些状态。

### Decision 3: obligation 集合由输入机械派生，coverage row 只能绑定不能重定义

obligation id 由 `kind + authority artifact identity + stable local address/id` 确定性生成。首期来源闭集为：

- P1 discovery traceability：每个当前范围原始 `requirement|goal|invariant|high_risk` 及其 source identity 和全部 blueprint stable-address mappings；
- P1：每个 applicable view、当前 target/delta 或被 CU 引用的 node、current-scope relation、runtime flow 及其条件式边、当前设计 decision/gap、被当前 CU 需要的 contract/NFR、验证 refs 与 App lens 中影响本次目标的适用项；
- P2：当前 CU 的 purpose、target predicates、preserved invariants、touches、provides/requires、safe intermediate state、verification refs 与显式 blocker；
- Feature：对应 CU 的 acceptance criteria/boundaries、ID-only construction mappings、`contracts.state_management`、条件式 use-case/DAG 义务，以及 completion 绑定的 phase/evidence facts；
- closure 组合层：跨 CU 新增的调用/数据/状态/发布边、迁移/兼容/feature flag/双写/临时资产去留、适用 NFR、剩余风险接受和稳定知识归位。

纯当前态且 target/delta 未变化、未被当前 CU 修改的蓝图节点只形成 current-fact obligation，要求权威 provenance/evidence，不强造施工 CU。远期 gap 只有在 `needed_by` 指向当前 CU/closure，或被当前 CU design closure 引用时才阻塞；否则保留为带 owner/needed-by 的 non-blocking frontier。

稳定内核必须从 requirement→blueprint mappings、P1 stable relations/flows、P2 target/design/dependency refs、确定性 CU→Feature identity、Feature mappings、分层验证义务和 canonical evidence identity 唯一派生每条 row 的 owner/combination owner、Feature mapping、evidence level、evidence identity 与 observation。YAML 只能物化该结果，不提供人工选择点；checker 对完整规范化 row 逐字段重算。无法唯一派生、候选冲突或缺少精确关系时，分别路由 P1 traceability/design、P2 CU/dependency 或 Feature mapping/evidence 修复，不允许 closure 内补选。缺失、多余、重复、调换 owner、无关但有效 evidence 或跨 component row 均失败。

### Decision 4: 实现与证据只通过既有消费门解析

P3 不建设通用 evidence/ref registry。CU owner、predicate/provide/design mapping 复用 P2 loader/validator；文件和符号复用现有 project-relative path、source/symbol/test/verification 消费门；completion 只调用 `observeChangeUnitCompletion()`/`verifyFeatureCompletion()`；UT/coverage、contract/API、build/runtime、visual/device/manual 观察只消费现有 canonical reports、receipts、evidence manifests 和其既有 verifier。

文件存在、自然语言 `passed`、Markdown checkbox、provider 返回布尔值、Feature completion hash 或 closure row 自报 observation 都不能成为证据。Kernel 先按 obligation、权威 `file#symbol`、owner Feature 与当前 raw hash 形成精确 evidence identity；这一步只建立待验证请求，不代表执行成功。Provider 只能从 Kernel 请求集合中逐项返回；稳定内核随后要求同 Feature/phase 的 canonical `script-report.json` 中存在 `id=symbol`、`status=PASS` 且 `affected_files` 精确绑定该 file 的 check，并要求该 report 已进入 fresh `phase-evidence-manifest`、receipt pointer 与 VALID completion 链。`script-report.json` 复用既有 phase report 输出与 verifier，不新增证据文件类型。未执行、执行失败、报告未绑定、manifest/receipt stale，或同 Feature 的其它 identity 均不得替代；某 evidence 类型尚无可信 resolver 时保留 gap/blocker，而不是引入通用 registry 或按字符串猜测。

一个 obligation 必须有恰当层级证据，不要求每项都跑所有层级：纯函数/契约可由 UT/contract 证明；跨模块或跨 CU 组合边需要 module/API/integration 证据；UI 可观察刷新、生命周期恢复或平台行为需要蓝图/acceptance 指定的 UI/device/manual 层。低层绿灯不能替代明确要求的高层证据。

### Decision 5: 跨视图闭环从 stable address 到施工与证据双向重建

P3 复用 P1 stable address index 和完整性检查，但增加“是否被真实施工消费”的维度：

- applicable view 的目标/delta 节点必须有 current CU design ref 或合法 combination owner；
- scenario 步骤必须能追到 logical 对象/契约、runtime 交互、development owner，跨运行边界时追到 deployment 节点；
- runtime relation 必须引用 logical 数据/契约并有 development mapping；development 模块必须有 design basis；deployment 节点必须映射软件/数据/平台约束；
- 同一术语、契约版本、state owner 与 failure semantics 在蓝图、CU、Feature contracts 和证据中一致。

P1 结构正确但没有任何 CU/Feature 消费的当前目标设计仍是 gap；CU 自己增加未获蓝图支持的共同设计也是 design bypass。P3 不修改蓝图来消除冲突，而是路由 P1 reconciliation 或 CU/Feature mapping 修复。

### Decision 6: runtime closure 按稳定 flow 和条件式边逐项对账

对每个当前范围 runtime flow，P3 先复用 P1 结构闭合，再把 `flow_id` 及 trigger/initial-load/state-owner/mutation/publication/subscription/consumer/recovery/lifecycle 的局部 stable id 分别对账到当前 CU design refs、Feature `contracts.state_management` 中同 ID/传播边、真实 owner/implementation 和该局部对象自己的 evidence identity；flow 级共同 ref 不能替代逐边观察。义务按实际行为条件式生成：只读 flow 不要求伪造 mutation/subscription；一旦声明 mutation/publication/subscription/consumer，就必须分别证明 persistence/recovery、producer→publication→全部受影响 consumer、snapshot/replay/order/cleanup、initial load/update source 与可观察刷新。

当 producer、owner、consumer 或 recovery 分属多个 CU/Feature 时，额外生成 combination obligation，要求一个贯穿真实组装的 scenario/use-case/integration/UI/device observation；每个 Feature 单独 VALID 不能替代。cold start、warm resume、page attach/detach、account switch、process recreation、background/system/external write 只对蓝图声明适用项生成 obligation，但适用项不得由 closure 作者改为 N/A。

### Decision 7: requires/provides、迁移/NFR 和临时资产共同进入最终组装

P3 复用 P2 exact dependency checker，要求当前 CU requires 全部由当前有效或合法 carry-forward 的 provider satisfy，且无 cycle、悬空 provide、当前 blocker 或证据损坏。CU 之间新增的调用、数据、状态和发布边必须有组合验证，不能只靠静态 requires 名称。

迁移、兼容、回滚、feature flag、双写、临时 fake/adapter/资产、NFR 与剩余风险只从 P1 cross-view/contract/结构化 decision/gap、CU safe intermediate state/blocker 和 Feature acceptance/evidence 中派生。每项必须有“保留、迁移、移除、延期/接受”之一的权威 disposition、owner、目标门槛和精确验证/知识归位 ref；缺结构化来源时报告 gap，不按 `temporary|adapter|fake|dual-write` 等关键词或处置 prose 猜出义务/PASS。

稳定知识只接受已列入 discovery 知识输入、且可解析到 architecture/catalog/conventions/长期 spec/scenarios/ADR 中具体 `#conclusion-id` 的 ref。仅文件存在不构成归位；closure 记录精确引用与验证结果，不复制内容，也不自动编辑这些真源。

### Decision 8: 宿主演进接缝只验证 P1 明确批准的变化轴

P1 将每个 `kind=evolution_candidate` 的 `human_decision` 冻结为闭集 `establish_seam|keep_direct`。只有 resolver 同时返回 `kind=evolution_candidate`、`status=decided_with_authority` 和 `human_decision=establish_seam` 时，P2 才执行首次纵切/后续 Provider 规则，P3 才生成接缝 closure obligations；普通 decision 和 `keep_direct` 候选只走普通设计、CU 与 dependency 规则。`keep_direct` 仍必须保留再提取条件，但不会因缺 contract/provider/consumer 纵切被阻塞。P3 对明确建缝项进一步要求：

1. 稳定契约的 operation/DTO/mapping/error/NFR 与契约测试兼容；
2. 替换或新增 Provider 时既有 Consumer 的稳定 contract binding 不变；
3. Provider 缺失/失败 observation 符合蓝图裁决的降级、禁用、阻塞或 fail-closed；
4. Consumer 的 implementation/dependency refs 不绕过稳定契约直连具体 Provider。

若契约或 Consumer 必须变化，结果是 reconcile/version/migration gap，不允许把它标为同一接缝内的成功替换。四项证明必须由 `closure_proofs` 分别绑定四个互不复用、同时列于 decision tests 且可由既有验证门解析的 evidence identity；源码注释、Provider/Contract 名称共现或同一个 decision mapping 不能代替证明。检查只解析当前 decision、CU/Feature mappings、精确测试证据，不引入宿主 provider registry。

### Decision 9: final verdict 只有三态，失败原因保持结构化

最终 verdict 由稳定聚合器重算：

- `PASS`：全部 required obligations 覆盖，所有输入/证据 current 且无 degradation；
- `PASS_WITH_DEGRADATION`：全部 required obligations 覆盖，但存在不影响当前目标声明的 optional provider 缺失，且每项 degradation 有影响边界、owner 和重新触发条件；
- `FAIL`：存在任一 uncovered obligation、当前 blocker、stale/invalid input、权威冲突、必需 provider 缺失或不可接受风险。

`gaps[]` 使用 `incomplete|blocked|stale|invalid|conflict` 分类，并携带 obligation/source refs、owner、needed_by、reason、unlock condition 与 route：`repair_feature_or_evidence`、`repair_or_add_change_unit`、`reconcile_blueprint`、`resolve_authority_or_risk`。分类是报告信息，不形成可编辑状态机。相同规范化输入必须得到字节稳定排序的 rows/gaps/verdict。

### Decision 10: canonical input enumeration 属于内核，只有证据观察可由 provider 适配

Canonical P1/P2/Feature/completion input enumeration、input binding、obligation/row derivation、覆盖规则和 verdict aggregation 全部属于稳定内核，不定义 input collector Provider，也不允许替换输入成员选择。静态 provider 只把既有自动化、UI/device/visual 或 human/risk 验证事实投影为 Kernel 已请求的精确 evidence identity observation；默认 Provider 只认领通过上述 canonical report→manifest→receipt→completion 链核验的 identity，不自动认领 requested set。未请求、未执行、执行失败、同 Feature 但不同 obligation、completion hash 或按文件名猜测的 observation 均不得覆盖 row。任何 provider 都不能写 Goal Mode facts、删减 obligation、改 owner/evidence binding 或直接设置 verdict。三张证据 Seam Card 由 capability spec 唯一冻结，不新增 rules registry。

required evidence provider/层级缺失形成 blocker；optional provider 缺失只在其维度不属于 required obligation 时形成 degradation。重复权威 provider、同一 evidence identity 冲突或 observation 与原始 evidence hash 不一致均 fail-closed。退出只清理临时 observation/cache 并使 closure stale 重算，正式蓝图/CU/Feature/evidence 保留。

### Decision 11: P1/P2 变化只使 closure stale，不允许反向改写

蓝图 revision/source/artifact hash、CU revision/raw hash、Feature contracts/acceptance/completion/evidence hash、carry-forward 或 provider observation 任一变化，都会使旧 `input_fingerprint` 失配。P3 checker 必须拒绝消费旧 verdict并重派生；无法重算时输出 FAIL gap。P3 不创建、修改或删除 P2 ready set，不把历史 completion 改回 pending，也不要求 P1 写 closure status。

## Risks / Trade-offs

- **[Risk] P1 的部分 cross-view/NFR 信息是开放结构，无法安全解析全部 prose。** → 只从稳定地址、结构化 contract/decision/gap/lens 字段和现有 verifier 派生；不支持的内容成为可定位 gap，不按关键词猜测。
- **[Risk] 原始需求来源格式各异，P3 可能被迫建设 PRD 解析器。** → 既有 discovery/人工权威输入先形成 `current_scope_items` 稳定清单，P1 验证精确 source identity 与蓝图地址映射的双向闭集；P3 验证闭集和 source hash，不解释任意正文语义。
- **[Risk] 全部 Feature completion VALID 容易被误当组合 PASS。** → 对跨 CU relation/runtime/seam 强制 combination obligation 和贯穿证据。
- **[Risk] closure YAML 自身变成手工覆盖表。** → obligation 闭集、input fingerprint、observation 与 verdict 全部由 checker 重算；Markdown 单向派生。
- **[Risk] optional visual/device provider 缺失被误报为 PASS。** → 只有当前 obligation 未要求该层时才允许 degradation；已分配 UI/device/manual 层则 provider 缺失直接 FAIL。
- **[Risk] 历史 CU 与当前蓝图变化需要语义 diff。** → 仅复用 P2 stable-target carry-forward 和精确 supersedes；首期不猜等价、不建迁移表。
- **[Risk] closure 计算成本随 CU/证据增长。** → 只枚举单 component canonical path，以 input hash 缓存可丢弃中间结果；缓存不是权威，首期不做 daemon。

## Migration Plan

1. 先原位收紧尚未归档的 P1 blueprint：新增 current-scope requirement traceability，并把 evolution `human_decision` 限定为 `establish_seam|keep_direct`；同步 P2 seam gate 只消费 `establish_seam`。更新在研 fixtures，不形成已发布消费者迁移。
2. 以新增 P3 schema/loader/checker/Skill 和 fixtures 落地，不修改 Feature/Goal Mode artifact 的权威语义。
3. 只有显式拥有 canonical component blueprint/CU 的复杂建设进入 P3；独立 Feature 保持原行为。
4. 首次运行生成 current closure YAML 和 derived Markdown；任何旧/非法 closure 文件只被拒绝或重生，不迁移为完成事实。
5. 回滚 P3 projection/checker 不影响蓝图、CU、Feature、Goal Mode facts 与稳定知识真源；P1 traceability/枚举和 P2 精确 seam 判定作为已纠正契约保留。

## Open Questions

- AI 记账真实多 CU、运行/恢复和界面材料何时齐备，决定宿主语义验收时点；不影响 framework 机械契约实施。
- 首批宿主是否具备 c2 视觉/真机 provider 由真实环境决定；若当前蓝图把该层列为 required，缺失即 blocker，否则只形成有边界的 degradation。
- 每项稳定结论最终应归入 architecture、catalog、conventions、长期 spec、scenario 或 ADR，由宿主评审按既有真源职责选择；P3 只验证 ref 可解析且内容已归位，不发明统一知识 registry。

---
name: 责任阶段统一路由 — review 缺陷回退与 assess 事实供给拉通（responsible-phase-unified-routing）
version: 3.0.0
# 版本说明：默认跟随当前 3.0.0 窗口（是否计入发布门由用户裁定；不改版本号、不新开窗口）。
# 【文件历史注记】实施收尾时本文件曾被 PowerShell 编码事故损坏（GBK 误读 UTF-8 回写），
# 按最终定稿重建；方案内容与 codex 三轮 review 定稿一致，todos 状态如实反映实施结果。
overview: >
  宿主实锤（run 20260816T125231Z-4a2d28）：review 确认 3 条真实 MAJOR 产品缺陷
  （CR-001/002/003，精确行号+修复方案），goal 链没有自动回退 coding——实际行为是
  conditional_pass_closure BLOCKER → assess 连续推荐 rerun_phase:review 原地重试 →
  耗尽 content_retry_exhausted HALT，靠用户人工决策+宿主手动 supersede 才完成回退修复。
  归因（与 codex 双方核实一致）：assess 决策层与 backtrack 执行链都在，断的是事实供给
  ——deterministic_defects 唯一采集器写死 phase==='testing'；invalidatablePhases 限定
  ut/testing（ut 因 hasActionable 恒空实际不可达）；review 缺陷表被压缩成抽象 blocker id
  细节全丢（同一张表门禁敢机器化消费判 BLOCKER，却没接给 assess）。全链矩阵：逆向回退
  仅 testing→coding 与 ui_scope_violation→plan 两条特例通；review→coding / ut→coding /
  plan→spec / ut·testing→spec 全不通；check-plan 等文案指路「修 spec」但无路由。
  本 plan 按「谁的产物谁修」一条通用规则收口（codex plan-review 三轮返修后定稿）：
  单一共享事实 summary.repair_candidates[]（信任条件钉死、归属机器推导、两层指纹）
  → assess 按 workflow 严格映射责任目标（不硬编码 phase 集合）→ goal/manual/batch
  三类 driver 只差授权形态 → 特例收编。不新增 receipt/sidecar/状态机/路由表/执行器；
  复用既有失效事务、回退预算、指纹防震荡、closure 新鲜度、backtrack_target_absent。
  四项裁决已按 codex 建议定案（用户 review 通过）：①共享事实=单一 summary SSOT
  （repair_candidates[]，无 sidecar、无 review 报告「责任阶段」列——agent 不得自报
  覆盖机器归属）；②回退预算不分层，共用既有 backtrack 池与指纹防震荡；
  ③conditional_review_authorization 机制原样保留（其语义本就是「显式接受已知风险」），
  仅在候选生成时识别有效 receipt 以抑制自动回退+文案退出「默认等人签」话术；
  ④统一架构一次完成，不分二期。testing→spec 本期不接（用户裁定：无机器生产点，
  文档可说明人工返回 spec，不得伪装成 assess 已能自动路由）。
todos:
  - id: t1-repair-candidates-ssot
    content: >
      单一共享事实 summary.repair_candidates[]（可选字段；替代 goal-runner 私有采集，
      manual/batch 因此天然可见）。每条 candidate：缺陷编号/涉及文件/修复建议摘要/
      责任类别/item_fingerprint/source_phase。
      【指纹两层（codex 三轮定稿，不新增第三种指纹或新账本）】item_fingerprint =
      hash(问题编号+规范化涉及文件+规范化修复摘要)——缺陷身份；round_fingerprint =
      排序后 item 集合 hash（复用 roundFingerprintOf 思路）——整轮防震荡：
      CR-001/002/003 与 CR-014 整轮指纹不同（新问题可再回退）；原样重现同指纹直接
      命中熔断。禁复用泛化 blocker_signature。
      【责任类别复用既有 CorrectionCategory（spec|plan|coding|verification），不新造
      枚举】推导优先级：①机器 check id 已明确归属以其为准（锁定例：review 可信产品
      缺陷→coding；UT 可信产品断言失败→coding；testing actionable→coding；
      scope_consistency_with_spec→spec；device_ac_delegation→spec；
      ui_scope_violation→plan——即使 affected_files 是产品源码也不得误投 coding）；
      ②无机器归属才按 affected_files 路径域兜底；③仍无法判断→不产 candidate（宁缺
      毋滥）。不新增 agent 自报「责任阶段」字段。
      【review 侧信任合取（缺一不产）】报告结构可信（report_validity=PASS）+ 所有准备
      进入候选的 open BLOCKER/MAJOR 由既有 verifier **逐条验证**（issue-verification
      fenced 块契约；现 issue_accuracy 抽样 5-10 条+误报率≤10% 仍 PASS——全局 PASS
      不足以投影，一条幻觉 CR 不得驱动改正确代码）+ 未验证/refuted/unclear 不产 +
      覆盖「有条件通过+open MAJOR」与「不通过+open BLOCKER/MAJOR」两分支 + 有效
      conditional_review_authorization receipt 在场→抑制（人已显式接受风险）。
      【ut 侧信任合取】真实 assertion failure + UT 结构门禁通过 + verifier 确认测试
      语义有效 + 非环境/工具链归因；不造 LLM 根因分类器。
      【上游件生产点（实施项非文案项）】plan：scope_consistency_with_spec FAIL→spec
      类；ut：verifier device_ac_delegation FAIL→spec 类；coding：ui_scope_violation
      →plan 类。testing 侧 collectActionableDefects 保留为证据链验真器，其输出并入
      同一形态（收编刀）；goal deterministic_defects 从此只是指纹投影。
      conditional_pass_closure 文案同步退出「等人签是主路径」话术。
    status: completed
  - id: t2-assess-workflow-derived-targets
    content: >
      通用 assess：recommendation 消费 candidates 责任类别，按**当前 resolved
      workflow/track** 映射实际 phase（lite 轨 change/coding/exit、custom 不出现幽灵
      spec/plan——不硬编码集合）。【映射严格失败（codex 三轮）】新增
      mapCategoryToChainPhase：映射不到当前 chain 真实节点返回 null→既有
      backtrack_target_absent；**删除「找不到 return chain[0]」静默回链首**（未知责任
      误投错误阶段的根源）；correction 修正意见路由原行为保留（共享偏好表非平行表）。
      测试覆盖 full/lite/custom/目标不存在四态。多类别并存选最上游，**按责任阶段分组
      保留整组事实**：phase_backtrack_requested 事件承载全部分组（复用既有事件），链
      重走到各责任阶段只注入属于它的候选（mixed-owner 不丢）。目标不在授权链内→既有
      backtrack_target_absent 语义（不挪用 upstream_closure_gap——语义污染归因）。
      phase-transition-policy 加 backtrack_to_phase action；goal-assess-driver earlier
      分支从「只允许 coding」泛化为「assess 选中的任意可信 earlier phase（candidates
      非空+invalidatable 含目标）」；invalidatablePhases 按最上游目标及其下游推导；
      ut「缺陷→retry」单测按新语义翻案（ut 回退走 assess 统一路由，不经该分类器）。
    status: completed
  - id: t3-three-driver-modes
    content: >
      三类 driver 只差授权形态，零新增执行器/状态/预算文件/事件账本。
      【goal】复用既有 backtrack 事务/回退预算共用池/round_fingerprint 防震荡（同轮
      指纹只换一次回退，新指纹允许再退）；backtrack_to_phase 执行分支与 testing 特例
      同构（target-absent/limit/fingerprint-repeat 三分类 halt）；候选注入按当前
      phase 类别过滤（未受信上下文措辞，不含授权语气）。
      【manual】assess-renderer 渲染 REPAIR_CANDIDATES 确认菜单（「review 发现 N 个
      可信产品代码缺陷，责任阶段 coding：1=返回 coding 修复后重走 review 2=暂停
      3=其它」）；用户选 1 后由当前人工 agent 切换 Skill 继续——不新增执行器，绝不
      擅自跨阶段改文件；goal/batch 模式不渲染菜单。
      【batch 授权区间须有下界（codex 三轮）】复用 manifest.start_phase 作下界、
      through_phase 作上界，在 resolved chain 上判定目标∈[start_phase, through_phase]：
      区间内自动回退；区间外转 manual；缺下界 fail-closed。判别例：授权 coding→testing
      时 review 回 coding 自动、回 plan/spec 转 manual；custom/lite 按实际 chain 序。
    status: completed
  - id: t4-migration-tests-openspec
    content: >
      验收+规格+迁移。组合级验收（决策链 observation→assess→driver 同构宿主剧本）：
      ①CR-001/002/003 三候选→rerun_phase:coding（backtrack_to_phase）+driver 放行，
      不再 rerun_phase:review；②新集合指纹允许再回退/原样重现命中熔断（两层指纹判别）；
      ③「不通过+BLOCKER」分支产候选；④verifier 逐条缺失/refuted/unclear→零候选；
      ⑤有效 conditional receipt→抑制；⑥plan→spec 与 lite→change（无幽灵 phase）；
      ⑦mixed-owner 失效面最上游级联；⑧batch 区间判别三例；⑨manual 菜单渲染/抑制。
      OpenSpec change unified-responsible-phase-routing（proposal+goal-runner delta
      两 Requirement 五 Scenario+tasks）。
      【物理收编（本轮完成——codex review 冻结项⑦：不保留平行机制等待以后收编）】
      testing 证据链验真器（collectActionableDefects，保留）的产物合并回
      summary.repair_candidates（唯一真源，写失败 fail-closed halt
      `repair_candidates_unwritable`）；**删除** goal-runner 的 backtrack_to_coding
      执行分支与 ui_scope_violation→plan 专用 tryScopeReplan 调用点（tryScopeReplan
      本身保留：plan_authority_unverifiable / invalidation_journal_untrusted 仍用）；
      补 ut→coding assertion 信任合取生产点（ut_hvigor_test FAIL ∧ code_regression ∧
      UT 结构门禁无其他 BLOCKER FAIL ∧ verifier end_to_end_driving+business_assertion_value
      均 PASS）。所有责任阶段回退统一走
      summary.repair_candidates → assess → backtrack_to_phase。
      check-plan/device-testing SKILL「指路无路由」文案对齐（只描述已接线路由；可说明
      「人工返回 spec」，不得伪装 assess 自动路由）。testing→spec 本期不接（用户裁定）。
    status: completed
---

# 责任阶段统一路由 — 实施记录（2026-08-17）

四个 todo 全部实施完成，验证全绿：unit 3228/3228、fixtures 44/44、OpenSpec strict
37/37（新 change 入册）、typecheck、git diff --check、check-plan-version。

## 落点清单

（下表为两轮 codex review 返修后的**最终**落点）

- 新增 `harness/scripts/utils/repair-candidates.ts`（事实层 SSOT：两层指纹/归属推导/
  信任合取含 evidence 双绑定/四类生产点/失效面推导/**生产与测试共用接线实现**
  `buildSummaryRepairCandidates`、`restoreBacktrackCandidatesFromEvents`）
  + `repair-candidates.unit.test.ts`（29 例，含生产接线级与判别复现负例）
- `types.ts`/`quality-axes.ts`/`schemas/summary.schema.json`：summary 可选字段+形状校验+**JSON schema 声明**
- `harness-runner.ts`：summary 落盘前经共享实现组装（artifact resolver 读正式 review
  路径 / report_validity 闸 / conditional receipt 判定 / failure_kind 优先归因）
- `prompts/verify-review.md`：逐条全验 + issue-verification 块（evidence 双绑定契约）
- `correction-routing.ts`：mapCategoryToChainPhase 严格映射（chain[0] 兜底从责任路由删除）
- `assess.ts`：**直读 phase summary 候选**（唯一真源）+ 最上游推荐分支；旧
  deterministic_defects 裁决分支删除
- `goal-reconcile-observation.ts`：候选不进 reconcile（无第二份事实）
- `phase-transition-policy.ts`：`backtrack_to_phase` action；testing 专用裁决删除
- `goal-assess-driver.ts`：earlier 分支泛化；旧 backtrack_to_coding fallback 删除
- `goal-runner.ts`：观测接线 + invalidatable 推导 + **唯一** backtrack_to_phase 执行分支
  + 按阶段过滤注入 + testing 验真器产物合并回 summary（含 summaryAbsPath 缺失 fail-closed）
  + resume 候选恢复走共享实现；旧 backtrack_to_coding 分支与 ui_scope 专用调用点删除
- `assess-renderer.ts`：manual REPAIR_CANDIDATES 菜单（读 assess 观测同一真源）
- `goal-in-session-driver.ts`：batch 区间下界（recommendationAuthorized）
- `openspec/changes/unified-responsible-phase-routing/`（proposal+delta+tasks）

## codex 首轮 review 冻结 8 项——已全部返修（2026-08-17）

首轮实施虽全量绿，但**核心宿主事故路径在真实生产链上未接通**（纯函数测试绕过生产
读取路径造成假绿），且"统一路由与旧特例并存"违反简单原则。8 项逐条核实属实后返修：

1. **review 正式报告路径**：`featureFilePath` 手拼 `<feature>/review-report.md` 读不到
   canonical 的 `<feature>/review/review-report.md` → 改走既有 `resolveFeatureArtifact`。
2. **summary.schema.json 未声明 repair_candidates**（顶层 `additionalProperties:false`
   会拒）→ 补声明 + 生产接线测试用 lite-json-schema（check-receipt 同一把尺）校验。
3. **batch/in-session 拿不到候选**（assess 只读 reconcile 复制的那份）→ 架构简化：
   **assess 直读 phase summary 候选**（唯一真源），reconcile 复制整体删除，goal/manual/
   batch 三链共用同一事实与同一裁决；manual 菜单改读 assess 观测。
4. **crash/resume 丢候选、旧候选不清**→ 事件回放恢复 `candidates` 且**无条件覆盖**
   （非 repair 回退自动清空），与 backtrackCodingContext 同款纪律。
5. **ui_scope 生产接线断**：`classification` 只读 details 文本，而 check 侧真实归因在
   `failure_kind` → 改 `c.failure_kind ?? extractFailureClassification(c.details)`。
6. **verifier 可能复用旧证据**（只按 CR ID 匹配）→ `issue-verification` 块增 `evidence`
   行绑定当前 CR 内容，对不上/缺失=旧产物不采信（零新增 receipt/key/ledger）。
7. **统一路由未真正统一**（双轨并存 + 我改写 plan 正文缩减已批准 scope，属实）→
   本轮完成物理收编：testing 验真器产物合并回 `repair_candidates`（写失败
   `repair_candidates_unwritable` fail-closed）、**删除** `backtrack_to_coding` 执行分支
   与 `ui_scope_violation` 专用 replan 调用点、补 UT product assertion 生产点；
   plan 正文已恢复"本轮完成收编"的已批准范围。
8. **测试没过生产接线**→ 补 6 条生产接线级回归（正式路径/schema/crash-resume/batch
   链/ui_scope 真实 failure_kind/UT 合取/verifier 新鲜度），并把端到端桩 writer 改为
   调用**生产组装函数**（桩与真实 writer 同源——原桩只写 blockers，端到端测不到统一路由）。

## codex 二轮 review 冻结 4 项——已全部返修（2026-08-17）

首轮返修后 codex 复核：1-5 项确认修复，6-8 未真正闭环，另加记录矛盾一项。

1. **旧 testing 特例仍在参与裁决**（双轨未真删）：assess 的 `deterministic_defects →
   backtrack_to_coding` 分支、goal-assess-driver 的同款 fallback、
   phase-transition-policy 的 testing 专用裁决**全部删除**；`deterministic_defects`
   降为诊断/指纹投影，不再决定路由。另修 codex 指出的绕过口：testing 有可信缺陷但
   `summaryAbsPath` 缺失时也进 `repair_candidates_unwritable`（不落回任何旧路）。
   注：源码漂移等其它恢复机制仍可用 `backtrack_to_coding` 动作，与缺陷路由无关。
2. **verifier 新鲜度挡不住「同 CR、同文件、问题已变」**（codex 判别复现证伪我的实现）：
   evidence 由「文件命中 OR 摘要命中」改为**同时绑定**文件与当前问题内容片段；
   verify-review 模板同步要求 evidence 必含文件名+当前问题/修复建议原文片段；
   新增 codex 那条判别复现为负例（同 CR/同文件/问题已变 → 零候选）。
3. **所谓生产接线测试仍是源码正则/手工拼装**：把接线提取为**生产与测试共用实现**
   ——`buildSummaryRepairCandidates`（harness-runner summary writer 调它，R8.1/R8.4
   调同一函数，含「无归因来源→零候选」判别）、`restoreBacktrackCandidatesFromEvents`
   （goal-runner resume 调它，R8.2 用真实事件流验恢复与清空）；R8.3 改为**磁盘真实
   summary.json → assessFeature 自读 → batch driver 授权**，不再手工构造观测。
   源码正则断言全部删除。
4. **记录矛盾**：本节以上为准；旧「实施偏差」段（称收编延后/UT 未接/组合级替代/文档
   延后）已随本轮全部落地而作废，故删除；OpenSpec proposal 与 tasks 同步改写为当前
   架构（summary 唯一真源、旧缺陷路由物理收编、无 reconcile 复制），未完成项从
   已完成 change 的 tasks 中移出。

返修后：repair-candidates 29/29（含判别复现负例）、端到端 goal 链 33/33、
OpenSpec strict 37/37、typecheck PASS；提交前重跑完整 `cd harness && npm test`。

## codex 三轮 review——1 个生产阻断 + 2 处记录，已返修（2026-08-17）

1. **verifier 内容绑定仍过松**（codex 判别复现：当前「修复短信验证状态机错误」与旧轮
   「修复下拉菜单状态机错误」共享「状态机错误」四字，片段匹配仍误采信）→ 判据由
   「文件命中 ∧ 任意 4 字片段命中」收紧为「文件命中 ∧ **完整包含**当前行修复建议/
   问题摘要（规范化逐字包含）」；verify-review 契约改为
   `evidence: <涉及文件名> | <该行修复建议原文>` 并明示"必须逐字照抄、不得概括"；
   新增两条负例（共享通用短语 / 照抄截断 → 零候选）。取舍如实记录：verifier 未照抄
   即不产候选、落回原地 retry——宁保守不误驱动改码。
2. **文档范围描述冲突**：OpenSpec t4 的「独立文档整理、不在本 change 范围」注释删除，
   改为「文案经逐条核对已符合新路由，无需代码修改」（device-testing 已写 assess 提供
   回修起点；check-plan 只提示人工修 spec，均未伪装自动路由）——不留未来文档任务。
3. **测试数量记录过期**：28 → 29（本节以上数字为准）。

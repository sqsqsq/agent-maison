---
name: verifier 证据链裁剪 — 删 SubagentStop hook 发布与身份绑定 / 报告即真源 / adapter 能力矩阵归零 / goal 与 interactive 一条路
version: 3.0.0
# 窗口说明：Br_release_3.0.0 长期线（宿主体验优化），与 main 的 3.1.0 蓝图刻意不同号（记忆 branch-integration-strategy）。
# 原则来源：沿用 07a41ec6 D0 冻结的四条（效率优先；产品与 UX 准确性优先于过程证据完整性；缺 verifier/receipt/签名
# 默认不阻止普通开发完成；可以不复审、可以复用，但必须诚实标注），以及用户 2026-09-03 裁定"防篡改永远不是高优先级"。
# 触发事件：宿主 bc-openCard-1 2026-09-04 无人值守 goal run 两轮 HALT closure_wall_repeated——harness PASS、verifier
# 真跑且 PASS，但 record-verifier-report.mjs 在 MAISON_GOAL_HEADLESS=1 下一律落 bedside，check-receipt 只认 canonical
# JSON，闭环永远差最后一步。用户 2026-09-05 质疑"为啥非要搞这些垃圾证据"；codex 反思与 Claude 检视一致：hook 独占
# 发布、四方对账、conflict、16 种 bedside 分类全部服务于"主 agent 不能伪造 PASS"这一个防篡改目标，而它把"发布手续
# 失败"判成"检查不存在"，让真实完成的审查作废、run 熔断——手续比结果更有权威，这是倒置。
# 已核实的规模：record-verifier-report.mjs 945 行、verifier-evidence.ts 451 行、verifier-request.ts 249 行、
# verifier-plan.ts 191 行、两份对应单测 1601 行，合计约 3400 行；bedside 失败分类 16 种；loader 错误码 10 种。
# 上游 plan：a9d4e7c2（verifier 能力化、短 request、subject）、e5b8c3f7（证据身份绑定、hook 四方对账）、
# e79e3773（hook 加 MAISON_GOAL_HEADLESS 旁路——其存在理由"hook 读 .current-phase.json 串台"已被 e5b8c3f7 删除，
# 但旁路代码没删）、07a41ec6 T7（subject 按审前材料寻址、既往 PASS 沿用）。本 plan 只做减法，T7 的寻址与复用原样保留。
# v2（2026-09-05，用户纠正）：verifier 调用通道从来是 adapter 无关的——共享规则要求每个 adapter 用各自原生子代理执行，
# 终态块契约在 verify-*.md 里；codex 在宿主每阶段都起 verifier 子代理。08-29 起 codex 被判 blocked 与 goal 熔断同根。
# v3（同日，codex review 三处 P1）：① 单写者改为调用方（phase executor / 主 agent）把 verifier 完整回复写成 MD，
# 不给 verifier Write、不加 report_path、不做兜底双写；② 共享规则被物化 ≠ 运行时会读取（opencode/chrys 的 rules
# 明写"引用可达、非自动加载"，generic 是任意 CLI），无可执行子代理的 adapter 披露 not_reviewed、不反复重跑；
# ③ 删除报告的两处哈希门（evidence manifest 登记、closure attestation 的 verifier_report_sha256），否则"不检测修改"
# 与 stale 自相矛盾。另按 P2：subject 措辞按真实派生字段写；e2e 驱动"收到回复→写 MD→闭环"接线；grep 归零限定生产面。
overview: >
  verifier 结论要成为机器真源，今天必须经过：runner 签发 subject → 主 agent 原样投递 request → 子代理回终态块 →
  SubagentStop hook 读子代理转录首条 prompt 反解 request、claimed path 等值核对、agent_id 三重绑定、幂等/conflict
  分治后才发布 canonical JSON；任何一环不成立就落 bedside，"不入闭环"。真正影响正确性的只有三样：审的是哪份材料
  （subject，由 feature / phase / prompt_path / 审前材料指纹 / gate fingerprint 派生，材料变则 subject 变，已有）、
  结论是什么（verdict + blocker_count）、属于哪个阶段（报告所在目录）。本 plan 把机器真源改为
  verifier.report.<subject>.md：verifier 子代理照旧只回复完整报告（末尾终态块，parseResultBlock 已有），调用它的
  phase executor / 主 agent 把回复原样写到 summary.verifier_report 指向的路径，单写者。校验只剩三条：文件在、终态块
  回显的 subject 等于 summary 当前 subject、verdict 与 blocker_count 一致；不匹配的唯一恢复动作是重跑 verifier。
  删除 hook、settings.json 的 SubagentStop 注册、canonical JSON、result hash、conflict、bedside、报告的 manifest
  登记与 attestation 哈希、adapter 的 verifier_capability × modes 矩阵、verifier-plan 的 blocked 态、
  verifier_provider_unavailable 与 resolve_verifier_provider_then_rerun。发布链模式无关：goal / headless /
  interactive 走同一条路，本次熔断的缺陷随之消失；codex 等无 hook 的 adapter 自 08-29 起被 blocked 与此同根，一并恢复。
  adapter 只留一个布尔 verifier_subagent（有可执行子代理通道才为 true），false 的 adapter 披露 not_reviewed、不阻断、
  不重跑。每项写明放弃的准确性；不做 A/B，由用户拿新发布件回宿主跑本次熔断的原场景。
todos:
  - id: t0-openspec-change-first
    content: >-
      T0 先立单一 OpenSpec change `verifier-report-as-truth`，strict validation 与 enforcement-paths 校验通过后再动代码。delta：agent-adapters 删三条 requirement（"An adapter declares verifier capability…"、"The SubagentStop verifier hook consumes subagent identity…"、"Adapter verifier-closure support is declared only from an observed payload"），新增一条"adapter 以布尔 verifier_subagent 声明是否具备可执行的 verifier 子代理通道；false 或缺省时 verifier 轴披露 not_reviewed 且不阻断"，保留 CodeAgent headless full-permission 条；feature-artifact-layout 把"verifier.report.json is the sole machine truth; the markdown is a human projection"改写为"verifier.report.<subject>.md, written by the invoking agent from the verifier's reply, is the sole machine truth"，terminal block requirement 保留并加"该块在报告文件末尾"，summary 增 verifier_report 字段；harness-gates 删"Concurrent verifier rounds are separated by identity…conflict"与"A missing verifier provider never suppresses script diagnosis"，"The verifier plan is resolved once…"改二态（disabled/enabled，adapter 只贡献 verifier_subagent 布尔），"check-receipt adjudicates verifier evidence by identity…"改为按 subject 回显与 verdict 一致性裁决并删 grandfather 代际分派，"The review closure attestation binds identity-verified verifier evidence"改为只记 verifier_subject_id、不记报告哈希，evidence manifest 保护面不含 verifier 报告；runtime-policy 若提及 blocked 一并清理。
    status: completed
  - id: t1-caller-writes-report
    content: >-
      T1 单写者=调用方。verifier 子代理行为与 7 份 harness/prompts/verify-*.md 不改，agents/claude/templates/agents/verifier.md 的审查内容 / tools / 输出格式不改（仍回复完整报告、末尾恰好一个终态块；其过期发布链说明在 T5 清理）。harness-runner.ts 在签发 request 时同步写 summary.verifier_report = `<reports>/verifier.report.<subject>.md`（相对项目根），buildNextLine 的 run_verifier_then_receipt / rerun_verifier_with_current_request 两个 case 改为"把 request 整段投给 verifier → 把它的回复原样写入 <verifier_report> → 跑 check-receipt"；types.ts / summary.schema.json 增该字段。调用方指引统一一句话："verifier 返回后，用 Write 把回复全文原样（不删不改不摘要）写入 summary.verifier_report 指向的路径，再跑 check-receipt"：agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc §3 与错误处置表、skills/reference/agents-entry-detail.md §4.1 第 2 条、skills/feature 六篇 SKILL.md 的"Task prompt = 短 request JSON 整段"段落、agents/claude/templates/agents/phase-executor.md。verifier.request.<subject>.json 结构不变。放弃：报告全文经调用方上下文再写一次盘（T7 已把 verifier 输出瘦成终态块 + 条目表，成本可接受）。
    status: completed
  - id: t2-evidence-loader-md-no-hash-gates
    content: >-
      T2 loader 改读 MD，报告哈希门删除，消费者接线。verifier-evidence.ts 重写为约 80 行：loadVerifierEvidenceForSubject 读 `verifier.report.<subject>.md` → parseResultBlock（verifier-subject.ts 现成）→ 块内 verifier_subject_id 必须等于入参 subject → PASS ⟺ blocker_count=0；错误码只留 report_missing / block_unparseable / subject_mismatch / verdict_inconsistent，恢复话术统一为"把 summary.verifier_request 指向的 request JSON 整段投给 verifier，把回复写入 summary.verifier_report，再跑 check-receipt"；VerifierEvidence 去掉 agent_id / agent_type / result_sha256 / json_path_*，改 md_path_abs / md_path_rel，report_text = MD 全文；loadVerifierEvidence / findPriorPassVerifierEvidence（扫 `verifier.report.<64hex>.md`）/ deriveVerifierClosureRecord / loadVerifierReportTextOrNull / readSummaryVerifierSubjectId 签名不变。verifier-subject.ts 删 verifierReportJsonFilename、computeVerifierResultSha256。消费者：check-receipt.ts 删 grandfather 代际分派（readSummarySchemaVersion / readSummaryClosureStatus 随之删）与回执手填字段 drift 投影，只留 enabled 分支的"当前 subject 命中 / 既往 PASS 沿用 / 缺失 BLOCKER"三路；phase-evidence-manifest.ts 保护面**不再登记** verifier 报告（删 verifierReportJsonFilename 引用与 subject 分区登记块）；closure-attestation.ts 删 verifier_report_sha256，只保留 verifier_subject_id（schema 版本号递增）；goal-phase-snapshot.ts 只复制 MD 为 verifier.report.md，verifier_evidence 去 agent_id；phase-closure-finalizer.ts、repair-candidates.ts、check-receipt 多模态读图证据不改（文本来源自动变 MD）。放弃：报告发布后被改、同 subject 并发结论互斥、闭环后报告被改，三者均不再可检测（见一）。
    status: completed
  - id: t3-delete-hook-and-capability
    content: >-
      T3 整套删除 + 一个布尔。删 agents/claude/templates/hooks/record-verifier-report.mjs；agents/claude/templates/settings.json 与 agents/codeagent/templates/settings.json 删 SubagentStop 段；agents/claude/adapter.yaml 与 agents/codeagent/adapter.yaml 删 verifier_capability 块及 notes 里的绑定实证段，改为 `verifier_subagent: true`；agents/codex/adapter.yaml 加 `verifier_subagent: true`（宿主实证：每阶段起 verifier 子代理，用户 2026-09-05 确认）；cursor / opencode / chrys / generic 不写（缺省 false；opencode/chrys 的 rules 明写"引用可达、非自动加载"，generic 是任意 CLI，实测后再翻 true）；agents/adapter-schema.yaml 删 verifier_capability 字段、新增 verifier_subagent（boolean | optional，描述写清"只登记宿主实测过能起 verifier 子代理的工具，说的是工具有无可执行通道，与运行模式无关"）；adapter-catalog.ts 删 parseVerifierCapabilityDeclaration / loadVerifierCapabilityDeclaration / resolveVerifierCapability，换成读一个布尔的 resolveVerifierSubagentDeclared；verifier-plan.ts 删 VERIFIER_CAPABILITY_* 常量、VerifierCapabilityDeclaration、blocked 态与 verifier_provider_unavailable，VerifierPlanMode 收成 disabled / enabled，输入把 adapterCapability 换成 adapterHasVerifierSubagent（boolean），判定顺序 profile 禁用 > workflow 未声明 > policy 不适用/off > adapter 无子代理（disabled / adapter_has_no_reviewer）> 启用；harness-runner.ts 删 blocked 阶梯 check、decideNextAction 的 blocked 分支、buildPassGuidanceLines / buildNextLine 的 resolve_verifier_provider_then_rerun case，adapter_has_no_reviewer 时不生成 request、控制台一行披露；check-receipt.ts 删 blocked 分支，adapter_has_no_reviewer 时 observed.verifier 记新状态 `not_reviewed` 并入 warnings（非阻断），summary 闭环记录如实携带；types.ts / summary-blockers.ts 同步状态枚举；agents/README.md 的 payload 契约与支持矩阵删除。放弃：声明 true 但运行时起不了子代理的 adapter 会 report_missing → 按既有 no-progress 熔断停下，由 operator 把声明改 false（见一）。
    status: completed
  - id: t4-tests
    content: >-
      T4 测试同步。删 harness/tests/unit/record-verifier-report-hook.unit.test.ts、verifier-evidence-identity.unit.test.ts、tests/utils/verifier-identity-fixture.ts，run-unit.ts 去对应两条 suite；tests/utils/verifier-evidence-fixture.ts 改为"模拟调用方写入"：给定 verifier 回复文本（正文 + 终态块），写到 summary.verifier_report 指向的路径，签名尽量不变以少改调用点；新增 verifier-evidence.unit.test.ts（不超过 150 行）：命中 / 缺失 / subject 回显不符 / 终态块零个或多个 / verdict 与 blocker 矛盾 / 既往 PASS 沿用登记 current_material_not_reverified / 闭环后改动 MD 不使 manifest 或 attestation stale；verifier-plan.unit.test.ts 删 case4、case6 的 adapter 轴，补两条：verifier_subagent 缺省的 adapter 在 full 下判 disabled / adapter_has_no_reviewer，codex 在 full × interactive/goal 下与 claude 同判 enabled；verifier-production-routing / check-receipt-policy / receipt-slim / receipt-path-reconcile / e2e-spec-requirement-closure 改用新 fixture；codeagent-adapter.unit.test.ts 的 hook 清单去 record-verifier-report；新增 e2e 一条驱动真实接线：MAISON_GOAL_HEADLESS=1 下 spec harness PASS → 断言 summary.verifier_report 与 NEXT 行给出的报告路径一致 → fixture 按该路径写入一份 verifier 回复 → check-receipt closed；再一条：adapter=opencode 的 full × spec，harness PASS 不生成 request、summary 无 verifier_request，check-receipt 通过并携带 not_reviewed 警告。真实模型能否照指引写文件由 T6 宿主回跑验收。放弃：无。
    status: completed
  - id: t5-docs-migration
    content: >-
      T5 文档。MIGRATION.md 删 hook 消费契约与 verifier_capability 登记段，新增 3.0.0 Breaking 条目：机器真源改为调用方从 verifier 回复写出的 verifier.report.<subject>.md；canonical JSON、SubagentStop hook、bedside、adapter verifier_capability、报告哈希门删除；adapter 新字段 verifier_subagent；升级动作 = 宿主重新物化 .claude/settings.json（.cac 同）与规则/skill 跳板，删除实例里的 hooks/record-verifier-report.mjs，framework/harness/state/last-verifier-report.* 可删；旧 verifier.report.<subject>.json 不再被读取，已 closed 阶段不受影响，revalidate 时若无 MD 报告须重审一次。agents/README.md 删 SubagentStop payload 契约与支持矩阵，改为 verifier_subagent 一行说明；docs/operations/harness-runbook.md 报告表三行改两行（request / report.md），加 summary.verifier_report 说明；RELEASE-NOTES-v3.0.0.md verifier 段改写；docs/skills/phase6-keyword-allowlist.md 删 last-verifier-report 行；verifier-request.ts / verifier-subject.ts / verifier-material.ts 头注释去 hook 措辞；agents/claude/templates/agents/verifier.md（codeagent 共享）只删"输入契约"里"SubagentStop hook 绑定报告归属"与"报告会落 bedside、不入闭环"两处过期说明，改为"回复会由调用方原样写入 summary.verifier_report，subject 回显不符即无效"，审查内容、tools 白名单、输出格式一字不动。放弃：无。
    status: completed
  - id: t6-verify-and-host
    content: >-
      T6 收口验证。整批：`cd harness && npm test`、typecheck、`npm run openspec:validate`、`npm run release:check-plans`、LF（node 扫）与 `git diff --check`。宿主：由用户拿新发布件在 bc-openCard-1 起无人值守 goal run 跑 spec 阶段（本次熔断的原场景），预期 phase executor 把 verifier 回复写出 verifier.report.<subject>.md、gate harness 的 check-receipt closed、无 closure_wall_repeated；attended 与 interactive 各跑一阶段确认同路；codex 跑一阶段确认从 INCOMPLETE 恢复闭环。不做 A/B；问题回灌本 plan 七、实施记录。
    status: pending
---

# verifier 证据链裁剪：删 SubagentStop hook 发布与身份绑定 / 报告即真源 / adapter 能力矩阵归零 / goal 与 interactive 一条路（d2f7a9c4）

状态：**v3 待 review（2026-09-05，Claude 起草；v2 按用户纠正重写 D4；v3 吸收 codex review 三处 P1 与三处 P2）。** 分工按既定：用户 review 本 plan → codex 实施 → Claude review。

关联资产：

- 触发事件：宿主 bc-openCard-1 2026-09-04 无人值守 goal run 两轮 `closure_wall_repeated`（宿主诊断文件 `scratch/goal-headless-verifier-blocker-20260904.md`，未读，只据其转述与本仓源码核实）；记忆 `design-principle-efficiency-first`、`human-sign-gate-removal`（同类整套删除的先例）。
- 上游 plan：[verifier能力化_policy驱动短request与稳定subject裁撤_a9d4e7c2](./verifier能力化_policy驱动短request与稳定subject裁撤_a9d4e7c2.plan.md)、[goal_verifier_hook_串台收尾_e79e3773](./goal_verifier_hook_串台收尾_e79e3773.plan.md)、[3.0.0效率优先_07a41ec6](./3.0.0效率优先_闭环仪式减法与verifier一次化与证据按输入复用_07a41ec6.plan.md)（T7 subject 寻址与既往 PASS 沿用原样保留）。
- OpenSpec 归档：`openspec/changes/archive/2026-09-03-verifier-evidence-identity`（本 plan 反向 delta 的对象）。
- 邻接缺陷（不在本 plan）：harness 派生的 `visual-debt.{json,md}` 落 feature 根目录未被写归因排除 → `phase_write_owner_unresolved`；一行排除 + 一条单测，见 [写边界归属门禁裁撤_1741b6f2](./写边界归属门禁裁撤_信息缺失不再终局与源码漂移单次裁决_1741b6f2.plan.md) 或单独小改。

---

## 零、决策纪要

### D0 原则与判断

沿用 07a41ec6 D0 四条。本次事故的本质：hook 独占发布、四方对账、conflict、16 种 bedside 分类，全部服务于"主 agent 不能伪造 PASS"这一个防篡改目标；而 fail-closed 教条把"发布手续失败"判成"检查不存在"，真实完成的审查作废、run 熔断。手续比结果更有权威，是倒置。机制层的空洞是验证盲区：没有一条 goal × full × verifier=required 的端到端闭环测试，这类回归只能靠宿主撞出来。

### D1 报告即真源，单写者是调用方

机器真源 = `<reports>/verifier.report.<subject>.md`。verifier 子代理照旧只做一件事：回复完整报告，末尾恰好一个终态块（`verifier_subject_id` / `verdict` / `blocker_count`，`parseResultBlock` 现成）。调用它的 phase executor / 主 agent 把回复**原样**写到 `summary.verifier_report` 指向的路径，然后跑 check-receipt。只有这一个写者：不给 verifier Write 权限、request 不加 report_path、没有兜底双写（v2 的"verifier 只回终态块 + 主 agent 兜底写返回全文"会写出一份只有终态块、却能闭环的报告，repair candidates / WARN / 多模态正文全丢——codex review P1）。canonical JSON、`result_sha256`、`state=conflict`、bedside 与 `last-verifier-report.*` 全部删除。MD 从"人读投影、机器不解析"改回"唯一真源"——这正是 e5b8c3f7 关死的通道，本 plan 有意打开：那条通道只对篡改有意义。

### D2 只保留三样有效证据

审了哪份材料（`subject_id` = sha256(feature, phase, prompt_path, 审前材料指纹 material_sha256, gate_fingerprint)，07a41ec6 T7 已做，材料变则 subject 变，原样保留）、结论是什么（verdict + blocker_count）、属于哪个阶段（报告所在 reports 目录）。校验只剩三条：文件在、终态块回显的 subject 等于 `summary.verifier_subject_id`、verdict 与 blocker_count 一致。任一不成立的唯一恢复动作是重跑 verifier 并重写 MD，不是熔断、不是改文书。

### D3 hook 与能力矩阵整套删除，发布链模式无关

`record-verifier-report.mjs`（945 行）、两份 settings.json 的 SubagentStop 注册、adapter 的 `verifier_capability × modes` 声明与入册纪律、adapter-schema 字段、adapter-catalog 的解析器、verifier-plan 的 `blocked` 态、`verifier_provider_unavailable`、`resolve_verifier_provider_then_rerun`。调用方写文件在 interactive 与 headless `claude -p` 下是同一条代码，`MAISON_GOAL_HEADLESS` 不再参与任何 verifier 判定；`reports/` 目录已在写归因快照排除面内，写报告不会触发写边界。不做 runner 侧 spawn verifier：嵌套 claude CLI 无法认证（记忆 nested-claude-cli-cannot-auth），且一条路已够。

### D4 调用通道 adapter 无关；有没有可执行的子代理是一个布尔

事实核对（用户 2026-09-05 纠正 + codex review）：verifier 的调用契约从来不是 adapter 专属。共享规则 `framework-agent-execution.mdc` §3 对每个 adapter 都要求"Task 触发 `subagent_type: verifier`，prompt = request JSON 整段"，终态块契约写在全部 `harness/prompts/verify-*.md` 里随 ai-prompt.md 渲染。codex 在宿主每阶段都起 verifier 子代理，通道成立；08-29 起 check-receipt 只认 hook 发布的 JSON，codex 没有 hook，被判 `blocked`——与 goal 熔断同根。但共享规则被物化 ≠ 运行时会读取、≠ 存在原生子代理：opencode 的 adapter notes 明写 `.opencode/rules` 不被自动加载，chrys 的 rules 是"引用可达"，generic 是任意外部 CLI。对它们一律判 enabled 会走回"report_missing → 重跑 → 再 missing → 熔断"。

裁决：adapter 只留一个布尔 `verifier_subagent`，语义是"宿主实测过该工具能起 verifier 子代理"，与运行模式无关、与发布机制无关。claude / codeagent / codex 为 true；cursor / opencode / chrys / generic 缺省 false，实测后翻。false 时 verifier plan 判 `disabled / adapter_has_no_reviewer`：不生成 request、不重跑，check-receipt 的 observed.verifier 记 `not_reviewed` 并以 WARN 披露，闭环不阻断（D0 第 3、4 条）。不恢复 publisher / modes 矩阵。

### D5 grandfather 代际分派删除

check-receipt 不再按 `summary.schema_version` 分"当代 / 上一代"。已 closed 的旧代阶段不受影响（closure_status 在盘）；被 revalidate 时若无 MD 报告则重审一次。`readSummarySchemaVersion` / `readSummaryClosureStatus` 随之删。

### D6 summary 增 verifier_report，NEXT 行给出路径

runner 签发 request 时同步写 `summary.verifier_report`（相对项目根，`<reports>/verifier.report.<subject>.md`），NEXT 行三段式："投 request → 把回复写入 <verifier_report> → 跑 check-receipt"。调用方不自己拼路径。request JSON 结构不变，subject 派生不变。

### D7 报告哈希门删除，消费者接线

evidence manifest 保护面不再登记 verifier 报告；closure attestation 删 `verifier_report_sha256`，只保留 `verifier_subject_id`。否则"删 result hash 后不检测修改"与"改一下 MD 就 stale"自相矛盾（codex review P1）。闭环时采用的结论已经在 summary（verdict / closure_status / verifier_closure）里，报告本身闭环后是资料。goal snapshot 只复制 MD；repair candidates 与多模态读图证据的正文来源自动变 MD；`deriveVerifierClosureRecord`（既往 PASS 沿用 + `current_material_not_reverified`）签名与语义不变。

## 一、放弃的准确性（逐项）

| 项 | 放弃什么 | 为什么可接受 |
|---|---|---|
| D1 | 调用方或任何人可以写一份 subject 正确、verdict=PASS 的报告，机器层不再识别 | 用户裁定防篡改不是优先级；subject 仍挡住"旧 PASS 冒充当前结果"这一真实错误源；兜底靠下游阶段（review / testing 门禁）与人 |
| D1 | 报告全文经调用方上下文再写一次盘 | T7 已把 verifier 输出瘦成终态块 + 条目表；换来的是单写者、零权限变更、零兜底分支 |
| D2 | 同 subject 并发两个 verifier 不再报 conflict，后写覆盖先写 | skills 已明写只起一个 verifier；并发是异常用法，不值得一个状态机 |
| D2 | 调用方写错路径只表现为 report_missing | 路径由 summary.verifier_report 给出，不靠 agent 推导；恢复动作相同 |
| D3 | 不再核对子代理身份（agent_id / transcript / 首条 prompt） | 这些只回答"是不是同一个子代理写的"，对结论正确性无贡献 |
| D4 | verifier_subagent=false 的 adapter 没有独立语义审查 | 如实记 not_reviewed 并 WARN 披露；现状是整轨 INCOMPLETE，披露优于阻断 |
| D4 | 声明 true 但运行时起不了子代理 → report_missing → 既有 no-progress 熔断 | 这是声明错了，operator 改 false 即止；不为此加运行时探测 |
| D5 | 旧代 closed 阶段 revalidate 时须重审一次 | 3.0.0 本就是 Breaking 版本；已 closed 阶段零动作 |
| D7 | 闭环后报告被改不再使 manifest / attestation stale | 采用的结论在 summary；报告闭环后是资料，改它不改结论 |

## 二、预期效果

| 指标 | 现状 | 预期 |
|---|---|---|
| verifier 证据链代码 | 约 3400 行（含 1600 行单测） | 约 500 行（loader 约 80 行 + 新单测不超过 150 行 + 既有 request/subject/material） |
| 发布失败形态 | 16 种 bedside 分类 + 10 种 loader 错误码 | 4 种 loader 错误码，恢复动作 1 种（重跑 verifier 并重写 MD） |
| goal 无人值守闭环 | 任何 verifier=required 阶段不可达 | 与 interactive 同路 |
| codex 等无 hook adapter 的 full track | 08-29 起 blocked → INCOMPLETE | 与 claude 同路闭环 |
| adapter 能力声明 | verifier_capability × modes 矩阵、入册纪律、支持表 | 一个布尔 verifier_subagent |
| 报告写者 | SubagentStop hook（仅 claude/codeagent、仅 interactive） | 调用方 Write，任何 adapter、任何模式 |
| 宿主实例文件 | .claude/hooks 三个 + settings.json SubagentStop | hooks 两个，settings.json 无 SubagentStop |
| 端到端盲区 | goal × full × required 无闭环测试 | 两条 e2e 钉死（goal 写入接线、无子代理 adapter 披露） |

## 三、非目标

- 不改 verifier 提示模板 `harness/prompts/verify-*.md` 的任何内容；`agents/verifier.md` 保留审查内容、只读权限（tools: Read, Glob, Grep）和输出格式，只删过期的发布链说明（T5）；不改 subject / material 寻址（07a41ec6 T7）；不改 evidence policy、track、profile 档位。
- 不动 Stop hook `check-phase-completion.mjs` 与 PreToolUse `guard-framework-write.mjs`；不动 goal-runner / GoalPhaseRuntime。
- 不做 runner 侧 spawn verifier、不做签名、不新增状态机或第二套发布路径、不给 verifier 加写权限、不做运行时子代理探测。
- 不处理 visual-debt 写归因缺陷（邻接 plan 或单独一行改动）。
- 不做 A/B；不为旧 JSON 报告写迁移器（不再读取即可）。

## 四、提交边界（分段用，不是提交授权）

T0 → (T1 + T2 + T3) → T4 → T5 → T6。T1–T3 是一次不可分割的行为切换（写方换了、读方换了、旧发布者删了），允许合为一个提交；T0 前置、T4 与 T5 各一段、T6 只有验证记录。任何一段都以 review 结论为准，不由实施方自行提交。

## 五、验证策略

- 每个 todo 只跑对应单测；T2/T3 跨面修改加 typecheck；不在每段前重复完整 `npm test`。
- 整批收口：`cd harness && npm test`、typecheck、`npm run openspec:validate`（含 enforcement-paths）、`npm run release:check-plans`、LF（node 扫）与 `git diff --check`。
- 宿主由用户执行：新发布件在 bc-openCard-1 起无人值守 goal run 跑 spec（本次熔断原场景）；再各跑一阶段 attended、interactive 与 codex 确认同路。问题回灌本 plan 七、实施记录。

## 六、完成判据

1. 生产面（harness/、agents/ 的 adapter.yaml 与 templates、skills/、docs/operations/、openspec/specs/）不存在 `record-verifier-report`、`verifier_capability`、`verifier_provider_unavailable`、`resolve_verifier_provider_then_rerun`、`last-verifier-report`、`bedside` 字样；MIGRATION.md、RELEASE-NOTES、openspec/changes/archive、.cursor/plans 不在此限。
2. `verifier.report.<subject>.md` 是唯一被机器读取的 verifier 产物；loader 错误码恰四种，话术只指向重跑 verifier 并重写 MD。
3. `MAISON_GOAL_HEADLESS=1` 下 spec 阶段：harness PASS → summary.verifier_report 与 NEXT 行一致 → 按该路径写入 verifier 回复 → check-receipt closed，有 e2e 覆盖。
4. verifier plan 只有 disabled / enabled 两态，adapter 只贡献一个布尔；codex 在 full 下与 claude 同判 enabled；verifier_subagent 缺省的 adapter 判 adapter_has_no_reviewer，不生成 request，check-receipt 通过并 WARN 披露 not_reviewed，有 e2e 覆盖。
5. 既往 PASS 沿用（completed_with_prior_review + current_material_not_reverified）行为与 07a41ec6 T7 一致。
6. evidence manifest 保护面不含 verifier 报告；closure attestation 只记 verifier_subject_id；闭环后改动 MD 不使任一者 stale，有单测覆盖。
7. OpenSpec strict validation 通过，三处 spec 无残留 hook / JSON 真源 / capability 矩阵 / 报告哈希要求。
8. MIGRATION 写明升级动作（重新物化 settings.json 与跳板、删实例旧 hook、新字段 verifier_subagent）。
9. 宿主原场景无人值守跑通 spec 闭环，无 `closure_wall_repeated`；codex 跑通一阶段闭环。

## 七、实施记录

（待填）

### 2026-09-05：Claude 实施（用户一次性授权亲自实施）

分工例外：本轮由用户明确指示 Claude 实施（"你才是实施者，现在工作区干净了，开始 plan 开发吧"），
codex 已回退其未授权改动，工作区从干净树起步。

**T0（OpenSpec）**：立 change `verifier-report-as-truth`（proposal + tasks + 三份 delta），
strict validation 与 enforcement-paths 通过后归档为 `2026-09-05-verifier-report-as-truth`，
canonical spec 已合并：agent-adapters +1/-3、feature-artifact-layout +1/~1/-1、harness-gates +3/~1/-4。
归档后发现一条遗漏（harness-gates `Receipt hard blocks dispatch by policy` 仍写 `blocked` 与代际分派），
已同步修正 canonical spec 并在归档 delta 追加 MODIFIED 记录，保持变更日志可追溯。

**T1（单写者=调用方）**：`issueVerifierRequest` 同时定下报告路径，写入 `summary.verifier_report`；
`buildPassGuidanceLines` 与 `buildNextLine` 改三步指引（投 request → 原样全文写入报告路径 → check-receipt）。
指引 sweep 六处：shared rules §3 与错误处置表、agents-entry-detail §4.1、六篇 feature SKILL、
phase-executor、Stop hook 恢复话术。verifier 子代理保持只读，request 结构未变。

**T2（loader 改读 MD，哈希门删除）**：`verifier-evidence.ts` 451 → 320 行（含 30 行解释性头注释），
错误码 10 → 4，恢复话术单一出处 `rerunGuidance()`。删 `verifierReportJsonFilename` /
`computeVerifierResultSha256`；check-receipt 删代际分派（新增本地 `readSummarySchemaVersionForReceipt`
只服务 legacy receipt 格式兼容，与 verifier 无关）；manifest 不再登记报告；attestation 删两个哈希字段、
`schema_version` 升 1.2（1.0/1.1 仍可读）；goal snapshot 只复制 MD。

**T3（整套删除 + 一个布尔）**：删 `record-verifier-report.mjs`（945 行）与两份 settings.json 的
SubagentStop 段；`verifier_capability` → `verifier_subagent` 布尔（claude / codeagent / codex 登记 true）；
adapter-catalog 677 → 604 行（能力解析器整段换成一个布尔读取）；verifier-plan 191 → 170 行、收成二态，`adapter_has_no_reviewer` 作为 disabled reason；
runner 与 check-receipt 的 blocked 阶梯、`verifier_provider_unavailable`、
`resolve_verifier_provider_then_rerun` 全部删除；`EvidenceValidationStatus` 新增 `not_reviewed`。

**T4（测试）**：删 hook 单测与 identity 单测（合计 1601 行）；identity fixture 里的通用工程脚手架
恢复为 `verifier-project-fixture.ts`（剔除 hook 驱动部分），evidence fixture 改写为"调用方写入"；
新增 `verifier-evidence.unit.test.ts`（6 例）；verifier-plan 改二态并新增"三模式同判"回归；
production-routing 的 blocked 用例改为无审查员用例；新增两条 e2e——headless 链路与未登记 adapter 披露。

**T5（文档）**：MIGRATION 新增 Breaking 章节（含五步升级动作与放弃项）；agents/README 的 verifier
章节重写并保留"已删除不得恢复"清单；harness-runbook 报告表两行合一；RELEASE-NOTES 三处；
allowlist 删 bedside 行；verifier.md 只删过期发布链说明（审查内容 / tools / 输出格式一字未动）。

**T6（验证）**：

| 项 | 结果 |
| --- | --- |
| typecheck（harness tsconfig） | 干净 |
| `npm test` 全量 | **3806 passed / 0 failed**（308 套件） |
| `npm run openspec:validate` | 30/30 + enforcement PASS |
| `npm run release:check-plans` | 本 plan 全部 todo completed；仓库整体 FAIL 来自另一份未完成 plan（a7c3e9d2），改动前即存在（已用 git stash 对照确认） |
| LF / `git diff --check` | 59 文件全 LF；whitespace clean |
| 变更规模 | 55 文件，+990 / −4455（含删除 hook 945 行与两份单测 1601 行） |

**实施中发现并修正的两处自身失误**：

1. 首轮把 `verifier-identity-fixture.ts` 整份删掉，但其中 `makeVerifierProject` / `seedPhase` 是与
   hook 无关的通用脚手架，production-routing 依赖它 —— 已恢复为 `verifier-project-fixture.ts`。
2. 新增的 headless e2e 首版同时撞上 goal run identity 这道**正交**的 fail-closed 门
   （plan f9c2e6b4 t1 要求真实 run manifest）。改为：harness 在 `MAISON_GOAL_HEADLESS=1` 下跑
   （复现熔断场景的生产侧），check-receipt 不带 goal env 跑（goal identity 已由 goal gate 用例覆盖）。
   用例注释写明了这条覆盖边界，不假装覆盖了没覆盖的东西。

**完成判据 1 的口径澄清**：生产代码与 adapter 配置中已无活引用；剩余字面命中全部是
"已删除，不得恢复"性质的解释性注释（adapter-catalog 头、adapter-schema 字段说明、agents/README
删除清单、两处测试注释），它们是防回潮的记录，刻意保留。

**未做**：宿主验证（T6 第 6 项）须由用户在真实宿主执行；本轮未提交任何 commit。

### 2026-09-05：codex review 返修（三处 P1/P2 + 一处验收边界）

codex review 判"暂不通过，主方案不用重做"，四条全部核实属实并已修：

**[P1] `not_reviewed` 没进 summary。** 我上一轮读代码时误判：`buildEvidencePolicySnapshot` 的结果
只写进 `.current-phase.json`，`phase-closure-finalizer` 虽然收 `evidencePolicySnapshot` 参数却从不
使用它，summary 类型与 schema 里也没有这个字段。控制台 WARN 随 run 消失，等于没披露——违反 D0 第 4 条
（可以不复审，不能把"未复审"说成"已 PASS"）。改法：在 `writeRunSummaryBase`（summary 的**单一写者**，
普通 harness / `--sync-closure` / goal 三条路径都经它）推一条 readiness_signal
`verifier_not_reviewed`（status=incomplete）。写在 check-receipt 里只能覆盖闭环那一次。

**[P2] 两个消费者仍读旧 canonical JSON。** 我上一轮按 `loadVerifierEvidence` 的调用者列表扫消费面，
漏了这两处**自己手拼路径**的——正是当初 e5b8c3f7 想收编却漏网的写法：
`receipt-scaffold.ts`（回执投影：新 MD 已通过、阶段已 closed，投影出的 report_path 和 verdict 却是空的；
残留旧 JSON 时更会展示上一代结论）与 `revalidate.ts`（同材料复用被误记成 `missing`）。
两处都改成走共享 loader；`receipt-scaffold` 里只服务旧 JSON 的 `readVerifierVerdict` 一并删除。

**[P2] 新 fixture 写出半截路径，测试没发现。** `patchSummarySubject` 按 reports 目录反推基准，得到
`spec/reports/…`，而契约是仓根相对。夹具与被测各拼各的路径，于是一起"通过"。改法：`projectRoot` 改为
必填参数（不给默认值——留默认就还能继续拼错），并新增用例⑦直接钉契约：从项目根解析
`summary.verifier_report` 必须命中真实文件，且与实际写入路径是同一个文件。

**[验收边界] headless e2e 之前在闭环前退出了 goal 环境**，不算复现原场景。现已改为全程同一套 goal 身份：
`prepareGoalModeRun` 建真实 run manifest、`casAcquireRunOwner` 取合法 owner/epoch、initializer 绑定
SSOT 身份到该 run，harness 与 check-receipt 都带 `MAISON_GOAL_HEADLESS=1` + RUN_ID/ATTEMPT，最终断言
`closure_status === 'closed'`。owner kind 取 session 是因为 CLI initializer 的 attended 上下文只接受它
（生产无人值守由 goal-runner preflight 内部初始化、不经这条 CLI），与本用例要验的 verifier 链路无关，
用例注释已写明这一点。

**新增回归**（verifier-evidence 由 6 例增到 9 例）：

| 用例 | 钉住什么 |
| --- | --- |
| ⑦ | `summary.verifier_report` 是仓根相对路径，按它能找到报告，且与写入路径同一文件 |
| ⑧ | 回执投影从 MD 取 report_path/verdict；故意残留一份结论相反的旧 JSON，不得被采信 |
| ⑨ | 重验账本按 MD 判复用；终态块坏掉的报告不得算复用（与缺失同判） |

e2e 侧另加：未登记 adapter 用例断言 `summary.readiness_signals` 真的带
`verifier_not_reviewed`/incomplete（控制台不算数）。`verifierModeOf` 为此 export，仅供单测直驱。

**返修中被全量测试抓出的一处连带影响**：新加的 readiness signal 初版用 `status: incomplete`，
触发了 `decideNextAction` 的 `readinessSignals.some(s => s.status === 'incomplete')` 分支，
`next_action` 从 `fill_receipt_then_sync_closure` 变成 `complete_readiness_warnings_then_continue`。
闭环本身不受影响（e2e 仍 exit 0 且 closed），但指引会让调用方去"完成"一件他完不成的事——
工具起不了子代理不是待办的准备项。改为 `status: unknown`：这条轴的实情是**没有结论**，正是 unknown
的语义（对比先例 `script_revalidated` 用 ready，因为脚本确实重跑了）。

这处是单跑套件发现不了的：verifier-evidence 与 e2e 都绿，只有 verifier-production-routing 的
next_action 分流表把它抓住了。

**本轮验证**：verifier-evidence 9/9、verifier-production-routing 7/7、e2e 7/7、typecheck 干净；
openspec 30/30；空白与 LF 干净；**全量 3809 passed / 0 failed（308 套件）**。

仍未做：宿主验证（T6 第 6 项，status 保持 pending）。本轮未提交任何 commit。

**2026-09-05 收尾（用户核查 MIGRATION 升级动作时发现，Claude 实施，codex 复核方向一致）**：T3 删了
`record-verifier-report.mjs` 模板与两份 settings.json 的 SubagentStop 注册，但漏了把它登记进 adapter 的
`deprecated_artifacts`——hooks 段物化只复制不清理（init-task-executor 仅 copyFileSync），宿主上的旧脚本会一直
留着，T5 的 MIGRATION 于是把"手动删"写成了升级步骤。现补：claude / codeagent 两份 adapter.yaml 各声明
`hooks/record-verifier-report.mjs: backup_delete`（UPDATE 的 S3 `cleanup-deprecated` 备份到 `.framework-backup/<stamp>/`
后删，结果进 run-log `cleanup_results`）；MIGRATION 第 2 条改为自动清理、第 3 条 `last-verifier-report.*`
改为"运行时状态、无消费者、可保留"（它在 gitignore 的 harness/state 下，adapter 根够不到，不为死文件加机制）。
回归：codeagent-adapter 套件新增一条断言两份 adapter 均有该声明。验证：check-adapter-catalog-consistency PASS、
init-task-executor 24/24、init-orchestrate 82/82、codeagent-adapter 12/12、adapter-bridge 4/4；
全量 `npm test` 3815 passed / 0 failed + fixtures 46/46。宿主需重新打包集成才能获得此项。未提交。

# verifier-evidence-identity

## Why

SubagentStop hook 自 2026-04-27（`3eee7598`）起，用**触发时刻**的共享状态文件 `.current-phase.json` 决定 verifier 报告归属，并从 `payload.transcript_path`（主会话）正则找第一个 `verdict: PASS` 当结论；payload 里真正的子 agent 身份字段一个都没被消费。宿主 SimulatedWalletForHmos `bc-openCard-1`（2026-08-28）上 plan/coding/UT 三个 verifier 交错运行，UT 结束时把结论写进了 coding 的 `verifier.report.md`，当轮两次；宿主一度以"旁路件"（把 verifier 正文落到 hook 不覆写的路径）规避，用户已两次感知。

并发只是触发条件，不是根因。两种成灾形态都源于同一处身份缺失：

- **闭环后错写** → `verifier.report.md` 在 evidence manifest 保护面内（`bd5a87e1`，2026-07-15）→ 证据链 stale → 无辜阶段级联重跑（宿主实测形态）；
- **闭环前错写** → manifest 忠实封存错误证据。`check-receipt` 当时只校验回执**手填** verdict 字符串、`invoked_via` 正则、`report_path` 文件存在——不解析报告、不验身份、不对账内容。于是一份身份错位的报告可以被当作合法凭证封进闭环。这是**凭证链完整性**问题，比"多跑几遍"严重。

`ce15ea17`（2026-06-12）为 goal headless 打过旁路，说明病根早被认知，但只修了 headless，attended 保留原缺陷；单测 `record-verifier-report-hook.unit.test.ts` 还把"按 state 写目录"固化成了预期行为。

字段面已实抓钉死（Claude Code 2.1.246 发行二进制内的 zod schema 与发射点，见 tasks 附录）：`SubagentStop` 携带 `agent_id` / `agent_transcript_path` / `agent_type` / `last_assistant_message?`，`transcript_path` 指主会话、`agent_transcript_path` 指子代理。身份信息一直都在，只是没被用。

## What Changes

- **subject 由 runner 单点生成且跨闭环稳定**：`harness-runner` 在写 base summary 时派生 `verifier_subject_id = sha256(feature | phase | script-report 物质哈希 | 去 subject 块后的 ai-prompt 物质哈希 | gate fingerprint | source_commit | worktree_digest)`，写入 summary 并嵌入 `ai-prompt.md` 的版本化机器块。**明确排除整份 summary SHA**——base summary 以 `closure_status=open` 落盘、finalizer 改写为 closed，用整份 SHA 会让正常闭环即自锁。两个输入都**不按格式化文本哈希**：script-report 走结构化投影（剔除 `timestamp` / `project_root` / 逐项自由文本里的耗时），prompt 走装配侧同源的规范化摘要（只把 `{timestamp}` 与 `{script_report}` 换成占位符）。对最终自由文本叠 ISO 正则两头都不准——抓不到 `耗时 … ms` 这类非 ISO telemetry（零改动重跑也换代 → 自锁，而"跑完 verifier 再跑一次 harness 关环"是一等闭环路径），却会抹掉业务正文里真实的 ISO 截止时间（需求真变了却不换代）。
- **调用方原样投递**：`ai-prompt.md` 是 subject 的唯一机器生产入口，主 agent / goal runtime 必须把它**全文**作为 Task prompt 交给 `subagent_type=verifier`，不得手抄模板或改写机器块。
- **三重等值绑定，transcript 只读一次**：hook 于发布时从 `agent_transcript_path` 首条 user prompt 取 invocation subject、从 `last_assistant_message` 的唯一版本化终态块取 result subject，与当前 `summary.verifier_subject_id` 三者相等才发布。两个 subject **分别存入** `verifier.report.json`；此后一切验真只比仓内三值，**绝不重开 transcript**（会话清理/换机/归档后仓内证据必须自足），`agent_transcript_path` 只作审计元数据。
- **`verifier.report.json` 成唯一机器真源**（schema 2.0）：身份（agent_id/agent_type）、双 subject、严格解析的 verdict、BLOCKER 计数、结论指纹、完整正文、审计元数据。`verifier.report.md` 降为从 JSON 生成的人读投影。废除"全篇正则找第一个 `verdict: PASS`"。
- **机器消费面全量收编**：新增共享 `loadVerifierEvidence()` 解析边界，扫替全部四处机器消费点——check-receipt 验真、repair candidates、multimodal 读图证据、goal snapshot。MD 在新闭环域内不解析、不入新 manifest，编辑零机器影响；grandfather 旧闭环域内 MD 仍按**旧** manifest 登记字节参与 hash 对账，修改即 stale（字节保护，非语义解析）。
- **check-receipt 真验真**：五项校验——feature/phase 匹配、agent 身份在场、subject 现值、结构合法、verdict 与 BLOCKER 计数一致。回执手填 `invoked_via/report_path/verdict/ran_at` **退出裁决权威**，降为兼容投影（与机器事实不符只报 MAJOR），保留至少一个 minor 窗口防存量解析断裂。
- **行为矩阵冻结，唯一分派锚 = `summary.verifier_subject_id` 在场与否**（新版 runner 必写、旧件必缺）：在场 ∧ `policy.verifier=required` → 只认新 schema JSON；`policy.verifier=off` → loader 不调用、JSON/MD 均不要求（现状语义保留）；缺席 ∧ closed ∧ 旧 manifest 仍 fresh → grandfather（只走既有 freshness 链复核，不解析 MD、不要求 JSON）；缺席 ∧ 其余 → 指引先重跑 harness 生成 subject 化产物。重新裁决只随新 harness run 进入。
- **并发发布是 CAS，不是读-判-写**：原子替换只保证不写半截，**不保证**「读→裁决→写」原子——两个
  同 subject 的 verifier 都读到"无文件"就会双双写 `published`，后写者静默覆盖前写者（PASS 吞 FAIL）。
  首次发布走原子 create-if-absent，`conflict` 对同 subject 单调吸收（永不回落 published），旧 subject
  件先原子让位再回到创建入口。回归用真并发两进程验证，并做过变异验证。
- **幂等/冲突分治**：同 subject + 同 agent_id + 同 result hash → 幂等且**不重写**（重写会换 `generated_at`，让刚封存的 manifest 无谓 stale）；同 subject 但不同 agent_id 或不同 result hash → `state=conflict`，两侧全记，check-receipt 必 FAIL——绝不保留先到的 PASS 静默吞掉后到的 FAIL；subject 过期 → stale 落 bedside，禁止覆盖 canonical。写入路径由 framework config + 机器块 feature/phase **自行推导**，claimed path 仅等值核对，越界（`../` / 绝对路径 / 跨 feature）拒绝。
- **hook 完全退出 `.current-phase.json` 写面**：`last_verifier_report` / `last_seen_*` 写回整体删除且不得恢复——Stop 新鲜度实际只读 `session_id` + `updated_at`。
- **manifest / attestation 改绑 JSON**：`PHASE_REPORTS_OUTPUT_FILES` 由 `verifier.report.md` 切到 `verifier.report.json`；review closure attestation 的 `verifier_report_sha256` 从 `sha256File(md)` 改绑**身份验真通过**的 JSON 文件哈希，并新增 `verifier_subject_id` / `verifier_result_sha256` 两个可读锚，schema 演进到 1.1。
- **codeagent 已实抓并确认共享绑定成立（2026-08-29 宿主采集）**：消费的四个字段全在场且语义同构，子代理转录首条 user prompt 复现了原样投递的 Task prompt，无需 adapter-specific 分支。它多出 `is_kia_repo` / `process_id` 两个本 hook 不消费的字段（未知字段一律忽略），少一个 claude 侧本就可选的 `prompt_id`。**一处已实证差异**：codeagent 不按 agent type 过滤 SubagentStop 的 matcher，注册项一律触发（`matcher: "verifier"` 对 `agent_type: ""` 的子 agent 同样触发）。这不改变任何结论——非 verifier 子 agent 的转录里没有机器块，一律 `invocation_subject_absent` → bedside——但它推翻了"触发即证明类型"这条理由，故 `agent_type` 不 fail-closed 的依据改为"它根本不参与绑定"，并补了一条过度触发的回归。
- **不做**：数据库、签名体系、常驻服务、全局锁、额外账本；不禁并发 verifier（并发是被支持的正常形态，收口靠身份而非互斥）。goal headless 保留现有非权威 bedside 旁路（携 subject），不扩入 goal closure，`goal-runner` spec 不动。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feature-artifact-layout`: `verifier.report.json`（schema 2.0）成为 verifier 的机器真源，`verifier.report.md` 降为人读投影；receipt 的 `verifier_subagent` 块降为兼容投影；新 manifest 保护面收 JSON 不收 MD。
- `agent-adapters`: SubagentStop payload 的消费契约（消费哪些字段、字段缺失如何降级）与 adapter 降级矩阵；codeagent 绑定状态如实记录。
- `harness-gates`: check-receipt 的 verifier 块改判身份验真并按 subject 在场与否分派；review closure attestation 绑定面从 MD 改到验真后的 JSON。

## Impact

- `harness/scripts/utils/verifier-subject.ts`（新增，subject 派生与机器块格式 SSOT）、`harness/scripts/utils/verifier-evidence.ts`（新增，唯一解析边界）。
- `agents/claude/templates/hooks/record-verifier-report.mjs`（重写；codeagent 共享同一份模板）。
- `harness/harness-runner.ts`（subject 单点生成 + 注入 ai-prompt + repair candidates 收编）、`harness/scripts/check-receipt.ts`（verifier 块 + 读图证据）、`harness/scripts/utils/goal-phase-snapshot.ts`、`harness/scripts/utils/phase-evidence-manifest.ts`、`harness/scripts/utils/closure-attestation.ts`、`harness/scripts/utils/types.ts` 与 `harness/schemas/summary.schema.json`。
- `harness/prompts/verify-*.md`（七份，终态块契约）、`harness/templates/phase-completion-receipt.md`、六个 feature skill 与 `skills/reference/agents-entry-detail.md`、`agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc`、`docs/operations/harness-runbook.md`、`agents/README.md`。
- 新增单测套 `harness/tests/unit/verifier-evidence-identity.unit.test.ts`（十三件回归）与两个共享夹具；`record-verifier-report-hook.unit.test.ts` 的 state 路由与 state 写回断言被**翻转**。
- Phases affected: 全部跑 verifier 的 feature 阶段；goal closure 与 `goal-runner` spec 不变。
- 与 active changes 的关系：`ut-direct-attestation-baseline` 与 `contract-unified-parse-boundary`（均 2026-08-28）都未触碰本链路（git 核实），delta 无重叠。本 change 保持 `ut-direct-attestation-baseline` 定稿的 attestation loader 语义不变，只演进 attestation 的 verifier 绑定字段。
- `MIGRATION.md`: 存量已 closed 且 manifest 仍 fresh 的阶段走 grandfather，零动作；未闭环的存量阶段需**重跑 harness**（生成 subject 化 summary/ai-prompt，分钟级）→ 原样投递 ai-prompt.md 重跑 verifier → 重跑 check-receipt。不改业务代码、不从 spec 重走。

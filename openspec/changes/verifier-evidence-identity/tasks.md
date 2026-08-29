## 1. Runner-owned subject (plan e5b8c3f7 T1)

- [x] 1.1 Add `harness/scripts/utils/verifier-subject.ts` as the single SSOT for subject derivation and for both machine block formats (invocation block in `ai-prompt.md`, terminal result block in the verifier answer)
- [x] 1.2 Derive `verifier_subject_id` in `writeRunSummaryBase` from feature/phase + script-report material hash + subject-block-stripped `ai-prompt.md` material hash + gate fingerprint + `source_commit_sha` + `worktree_digest`, explicitly excluding any whole-summary hash
- [x] 1.3 Normalize wall-clock timestamps out of both hashed artifacts (user ruling 2026-08-29) so a no-op harness re-run keeps the subject stable, while any material change still rotates it
- [x] 1.4 Write the subject into `summary.json` (schema + TypeScript type) and inject the versioned machine block into `ai-prompt.md`; injection strips any previous block first so re-runs are idempotent
- [x] 1.5 Add the single versioned terminal-block contract to all seven `harness/prompts/verify-*.md`, retiring "scan the whole answer for the first `verdict: PASS`"
- [x] 1.6 Sweep the verifier invocation surface (six feature skills, `skills/reference/agents-entry-detail.md`, `framework-agent-execution.mdc`): the Task prompt is `ai-prompt.md` delivered verbatim, never a hand-transcribed template

## 2. Hook rewrite with three-way binding (plan e5b8c3f7 T2)

- [x] 2.1 **Go/no-go payload capture (gate item).** Nested `claude -p` could not authenticate in the implementing sandbox (host holds the OAuth token in memory; `~/.claude/.credentials.json` carries `expiresAt: 0`), so the field contract was pinned from the same-version shipping binary instead — a stronger source than documentation. See Appendix A.
  - Claude adapter: **GO** — all consumed fields present.
  - codeagent adapter: **GO** — captured on a host with the CLI available (2026-08-29, user-driven). All four consumed fields present with identical semantics; one divergence recorded (the matcher is not filtered by agent type). See Appendix B.
- [x] 2.2 Read the transcript exactly once, at publication: invocation subject from the first user prompt of `agent_transcript_path`, result subject from the single terminal block in `last_assistant_message`
- [x] 2.3 Require three-way equality against `summary.verifier_subject_id` and store `invocation_subject` / `result_subject` as separate fields so later verification never reopens a transcript
- [x] 2.4 Derive the write path from framework config + the machine block's feature/phase; use the claimed path only for an equality cross-check and reject `..` / absolute / drive-prefixed / cross-feature claims
- [x] 2.5 Implement the four publication states: idempotent (no rewrite), conflict (atomic, both sides recorded), stale subject (bedside, canonical untouched), atomic replace for a fresh matching subject
- [x] 2.6 Delete the `.current-phase.json` write surface entirely (`last_verifier_report` / `last_seen_*`); unify goal-headless and missing-identity into one bedside fail-closed path carrying a machine-readable reason
- [x] 2.7 Confirm the `matcher: "verifier"` registration in both `agents/claude/templates/settings.json` and `agents/codeagent/templates/settings.json` (unchanged). The 2026-08-29 capture showed codeagent does **not** honour the matcher as an agent-type filter, so registration is documented as a hint rather than a guarantee and the binding never relies on it

## 3. Shared parse boundary and consumer sweep (plan e5b8c3f7 T3)

- [x] 3.1 Add `harness/scripts/utils/verifier-evidence.ts` with `loadVerifierEvidence()` comparing only in-repository values, plus `readSummaryVerifierSubjectId()` / `readSummaryClosureStatus()` dispatch helpers; every failure form is its own structured error code
- [x] 3.2 Rewrite the check-receipt verifier block around the frozen behavior matrix (subject present / `policy.verifier=off` / grandfather / re-run the harness), with the five identity checks
- [x] 3.3 Sweep the four machine consumers onto the loader: check-receipt verification, repair candidates (`harness-runner.ts`), multimodal read-image evidence (`check-receipt.ts`), goal snapshot (`goal-phase-snapshot.ts`, which keeps archiving the markdown for humans while its machine fields come from the JSON)
- [x] 3.4 Retire the receipt's hand-written `invoked_via` / `report_path` / `verdict` / `ran_at` from adjudication, keeping them as a compatibility projection (a mismatch is MAJOR, not BLOCKER) for at least one minor window

## 4. Manifest and attestation truth switch (plan e5b8c3f7 T4)

- [x] 4.1 Switch `PHASE_REPORTS_OUTPUT_FILES` from `verifier.report.md` to `verifier.report.json`; verification walks the entries recorded in each manifest, so older manifests keep byte-accounting their markdown automatically
- [x] 4.2 Rebind the review closure attestation's `verifier_report_sha256` to the identity-verified JSON (null when unverified) and add `verifier_subject_id` / `verifier_result_sha256`
- [x] 4.3 Advance the attestation `schema_version` to `1.1` while keeping `1.0` readable — no consumer reads the verifier binding, so older attestations keep reconciling against their own recorded inventory

## 5. Regressions (plan e5b8c3f7 T5)

- [x] 5.1 Add `harness/tests/unit/verifier-evidence-identity.unit.test.ts` with the thirteen cases, driving the real hook and the real `check-receipt.ts` (13/13 green)
- [x] 5.2 Add the shared fixtures `tests/utils/verifier-identity-fixture.ts` and `tests/utils/verifier-evidence-fixture.ts`, both rendering the machine blocks through the production SSOT rather than hand-copied strings
- [x] 5.3 Flip the two fossilized assertions in `record-verifier-report-hook.unit.test.ts`: routing now comes from the invocation machine block (a stale state file must not misroute), and the state write surface must stay byte-unchanged
- [x] 5.4 Update the existing receipt fixtures (`check-receipt-policy`, `receipt-slim`, `receipt-path-reconcile`, `e2e-spec-requirement-closure`) to publish hook-shaped evidence, leaving their original discriminating variables intact

## 6. Spec and documentation (plan e5b8c3f7 T6)

- [x] 6.1 Publish this change with three spec deltas (`feature-artifact-layout`, `agent-adapters`, `harness-gates`); `goal-runner` untouched
- [x] 6.2 Sync the hook template header, `docs/operations/harness-runbook.md`, the receipt template's verifier section, and `agents/README.md`

## 7. Verification

- [x] 7.1 Run `npm test` at the repository root (harness typecheck + unit suites + fixtures)
  - Review round 2 re-run: 3690 unit / 46 fixtures, 0 failed. The reviewer's single E2E flake did not reproduce across repeated full runs; it is cross-suite observation interference on the repository's own `doc/features`, not a defect introduced here — recorded as an open observation rather than claimed fixed.
- [x] 7.2 Run `npm run openspec:validate`
- [x] 7.3 Run `node scripts/check-plan-version.mjs`
- [ ] 7.4 Run mandatory `npm run release:verify`
  - Deferred: the release gate is a branch-integration step for `Br_release_3.0.0`, and this change is delivered to the working tree for human review before any commit.
- [x] 7.5 Capture a real codeagent SubagentStop payload and either confirm the shared binding or implement an adapter-specific one
  - Captured 2026-08-29 (user-driven, host environment): shared binding confirmed, no adapter-specific branch needed. The capture invalidated one *rationale* (not one behaviour) — see Appendix B — so the hook comment, the `agent-adapters` delta and a new regression variant were corrected accordingly.
- [ ] 7.6 Host replay on SimulatedWalletForHmos (user-driven, ask first)
  - Path: for each affected phase, re-run the harness (subject-bearing summary/ai-prompt, minutes) → deliver `ai-prompt.md` verbatim to the verifier → re-run check-receipt. No source changes, no commits, no re-run from spec. Phases already closed with a fresh manifest need nothing.

## 8. Review round 2 fixes (2026-08-29)

独立评审判「暂不通过」，5 个机制性阻断 + 3 项裁剪。逐条收口如下；每条都补了**能抓住原缺陷**的
回归（新增的三条都做过变异验证：把修复退化回去，对应用例立刻转红）。

- [x] 8.1 **[P0] 并发发布 last-writer-wins**：原实现是"读旧件→裁决→写"，原子替换只保证不写半截、
      不保证这一整段原子；两个同 subject 的 verifier 都读到"无文件"就会双双写 `published`，后写者
      静默覆盖前写者（评审实测 PASS 稳定吞掉 FAIL）。改为 CAS 循环：首次发布走**原子
      create-if-absent**（`link()`，不支持硬链接的文件系统退回 `wx`），`conflict` 对同 subject
      **单调吸收**（永不回落 `published`），旧 subject 件先原子让位再回到创建入口。三方以上并发时
      side 列表尽力而为并显式标注 `sides_completeness`，但 conflict **状态**不会丢。
      回归：新增用例 ⑧b **真并发**（`spawn` 同时起两进程 × 4 轮）。原有用例⑧是串行的"先 PASS 再
      FAIL"，后到者总能读到已落盘文件，属假覆盖，保留但降级为幂等/结构断言。
- [x] 8.2 **[P0 配套] CAS 测试缝**：两个 node 进程的启动开销足以把"读→写"串行化——不加缝的并发回归
      在**退化版本上也会绿**（实测）。按 `phase-closure-finalizer` 的 `maybeCrash` 惯例加一个
      env 门控延时，把窗口确定性拉开；生产路径零成本。
- [x] 8.3 **[P1] subject 指纹两头都不准**：旧修法对**最终自由文本**叠 ISO 正则——抓不到
      `耗时 ${durationMs} ms` 这类非 ISO telemetry（零改动重跑也换代 → 自锁），却会抹掉业务正文里
      真实的 ISO 截止时间（需求真变了却不换代）。改为在**格式化之前**排除 telemetry：
      `canonicalScriptReportDigest()` 从结构化事实取投影（保留 phase/feature/汇总计数/逐项
      `{id,status,severity,blocking_class}`/assurance/能力契约指纹；剔除 `timestamp`、
      `project_root`、逐项自由文本），prompt 侧由 `assembleAIPrompt` **同一次装配**产出规范化摘要
      （只把 `{timestamp}` 与 `{script_report}` 换成占位符）。ISO 正则整体删除。
      回归：新增套 `verifier-subject-material.unit.test.ts`（telemetry 不换代 / 门禁事实必换代 /
      业务时间必换代 / 畸形输入不崩栈），骨架照 profile 的真实 `耗时 … ms` 形态构造。
- [x] 8.4 **[P1] `result_sha256` 未验证**：loader 只查非空就采信，于是把一份合法 FAIL 件的
      verdict/blocker_count/正文改成"干净通过"、保留原 hash，可整份通过验真。改为用生产 SSOT
      `computeVerifierResultSha256` 重算严格比对 + 64 hex 形态校验，新增错误码
      `result_hash_mismatch`。回归并入用例⑤。
- [x] 8.5 **[P1] reports 路径三份真源**：hook 的手写 fallback 是旧布局（而 `loadFrameworkConfig`
      会给缺字段的配置注入 `doc/features/…`，既有 profile-routing 回归已钉死）；manifest 手拼
      `receiptDir/reports`（自定义 pattern 下 summary/verifier 整组落在保护面外）；attestation
      验真通过却重建错误路径把绑定记成 null。收口：hook 的默认值对齐 TS；manifest 与 attestation
      改走 `featurePhaseReportsDir` / `evidence.json_path_abs`；并把 `featurePhaseReportsDir` 里
      **不必要的急切 frameworkRoot 求值改成惰性**——那正是各消费方另拼路径的动因，根治后连
      `verifier-evidence.ts` 里那份 `receiptDir/reports` 兜底（第三份意见）也一并删除。
      回归：新增用例 ⑩b 跨实现路径等价（配置缺字段 / 自定义 pattern 两态 × hook + loader +
      manifest + attestation 四方同址）。
- [x] 8.6 **[P1] 两条恢复指引不可执行**：①conflict 文案要求"重跑 harness 换代 subject"，但本设计
      下无物质变化时 subject 恒定，重跑必然回到同一个 conflict——死锁。改为可执行三步：停止/等待同
      subject 的全部 verifier → 删除该 conflict 件 → 只启动一个 verifier 原样投递现有
      `ai-prompt.md`（hook 投影 / loader 话术 / spec 三处同步）。②Stop hook 仍教"传入
      feature/phase/报告路径"，照做必落 `invocation_subject_absent`；改为明示投递 `ai-prompt.md` 全文。
- [x] 8.7 **[裁剪] 七份 `verify-*.md` 的协议副本删除**：运行时机器块已带真实 subject 与完整格式，
      静态副本是第二份会漂移的真源。改为四行指针（指向机器块 + 缺块时如何 fail-closed 表述），
      七份各减 15 行。
- [x] 8.8 **[裁剪] 回执投影校验收窄**：四个投影字段里只有 `verdict` 有机器对应物，规格改为只对它
      做 MAJOR 提示，其余三个明确"仅留档、不校验"——为零权威字段再造一套无权威校验只会制造噪声。
- [x] 8.9 **[卫生] EOL 归一**：21 个我用整文件重写方式改过的文件带出了 CRLF（仓库
      `.gitattributes` 是 `* text=auto eol=lf`），已全部归一为 LF，`git diff --check` 干净。
      **未改动任何 git config**——那是用户环境，不在本任务授权内。

## 9. Review round 3 fixes (2026-08-29)

独立评审再判「不能收口」，2 个 P1；上一轮 5 项确认已修、无新扩面。两条都已收口，且各自补了
**经变异验证**的回归。

- [x] 9.1 **[P1] 迟到的旧 subject 仍能挪走并覆盖当前证据（TOCTOU）**。入口处那次 summary 校验
      会在 CAS 期间过期：旧 hook 过校验 → runner 换代 → 新 verifier 发布当前证据 → 旧 hook 恢复，
      此时它拿"文件 subject ≠ **我的** subject"当让位判据，于是把当前证据挪进 superseded 并回写
      旧 subject——**有效证据被销毁**（评审实测 `canonicalAfterLate = old subject`）。
      收口：发布循环**每轮重取 summary 现值**，并把授权判据改成「文件 subject ≠ **summary 现值**
      且**我就是** summary 现值」——即评审给的第二条路"旧 subject 永远没有权限移动当前 subject 的
      文件"，用授权检查表达，不引入锁、不串行 verifier 执行。不再是当前 subject 的一轮**整体停手**
      （不创建、不让位、不改写），落 bedside `subject_rotated_during_publish`。
      回归：新增用例 ③b，用 CAS 测试缝构造精确交错（旧 hook 挂起 → 换代 + 新证据发布 → 旧 hook 恢复）。
      变异验证：撤掉授权判据即复现评审报的旧 subject 回写。
- [x] 9.2 **[P1] script-report 投影过度裁剪**。prompt 摘要把整份 script report 换成占位符，绑定
      责任全落在投影上；而投影只留 `id/status/severity/blocking_class` 四字段，漏掉
      `failure_kind`/`actionability`/`affected_files`/`source`/`structured` 与全部自由文本——
      ai-prompt.md 真变了 subject 却不变，旧 PASS 被复用（评审实测 `{"equal": true}`）。
      收口按评审给的边界，**不再维护白名单、也不恢复自由文本正则**：
      · 投影改为**排除式**——默认纳入 check 的全部字段（含未来新增），只排除显式 telemetry 域；
      · 新增 `harness/scripts/utils/check-telemetry.ts` 与 `CheckResult.details_material`：
        生产端用 `renderDetailsWithTelemetry()` 以**同一模板**渲染两遍（人读留真实耗时，
        material 拿占位符），杜绝两份文本漂移；
      · 5 处内嵌耗时的生产点全部改造（`profiles/hmos-app/harness/ut-host-impl.ts` ×3、
        `coding-host-rules.ts` ×2，后者的两个 details builder 改为接收耗时文本参数）。
      回归：新增 E（状态不变但 failure_kind/actionability/affected_files/source/structured/
      正文变化 → 必换代，逐字段消融）、F（只有 telemetry 变化 → 不换代）、G（生产端漏用 helper
      时诚实换代——把"纪律成本"钉成可见契约，而不是留一条看不见的坑）。
      变异验证：把投影退回四字段白名单，E 立刻转红。
- [x] 9.3 规格同步：`feature-artifact-layout` 删除写死的四字段投影，改为"默认纳入全部语义/裁决
      字段 + 排除显式 telemetry 域 + 禁用白名单"，并写明生产端拆分纪律与其代价；
      `harness-gates` 补 TOCTOU 授权判据与对应场景。

## 10. Review round 4 fixes (2026-08-29)

两个阻断；上一轮 7 项确认成立、未返工。

- [x] 10.1 **[P0] 不同 subject 共用同一文件 → 授权复查仍是 check-then-act**。评审的定性成立：
      "我还有权限吗"与"改共享文件"是两步，两步之间就能换代，把复查放得再晚也只是挪窗口。
      上一轮我选了授权检查，这一轮改用评审给的另一条路——**证据按 subject 分区**：
      `verifier.report.<64位subject>.json`（+ 同名 `.md`）。三条规则：
      ①`summary.verifier_subject_id` 单独决定当前证据是哪一份；②不同 subject 永远写不同文件，
      谁也没有能力移动/删除/覆盖别人的文件；③同 subject 的并发仍走 CAS + conflict 单调升级。
      新增纯函数 `verifierReportJsonFilename` / `verifierReportMdFilename`（只接受合法 64 hex，
      hook 侧逐字符复刻）；runner 把该 subject 的准确路径写进 ai-prompt.md 机器块；
      loader 先读 summary subject 再推导路径；manifest 改为按当前 subject **动态登记**
      （静态表移除固定名）；goal snapshot 快照名保持稳定但源文件由 loader 选出的 subject 决定；
      attestation 早已用 loader 的绝对路径，无需再动。
      **删除**：`stepAsideSuperseded`、`verifier.report.superseded.json`、CAS 循环内的反复
      summary 授权判断、跨 subject 的让位/替换与 `rotatedMidFlight`。文件自述 subject 与文件名
      不符 → fail-closed（`canonical_subject_mismatch`），不移动、不修复。旧 subject 文件留在
      原地不清理——自动清理会重新引入并发删除。
      回归：③b 按验收时序重写（A 停在最终写入前 → 换代到 B → B 发布 → 记录 B 字节 → 放行 A →
      B 字节必须不变 → loader 仍返回 B）。变异验证：退回固定文件名即整套转红。
- [x] 10.2 **[P1] ScriptReport 顶层仍是白名单**。check 层已改排除式，顶层却还手写六个字段，
      于是 `capability_resolutions` / `compat_applied` / `compat_expired` 与将来新增的顶层
      语义字段整组不绑定——同一类静默失败。改为**整份报告排除式**：解构掉 `timestamp` /
      `project_root` 两项显式 telemetry，其余顶层字段（含未知/未来字段）默认进入，`checks`
      走已修好的 check 层规范化；摘要版本提到 `script-report-material@3`。
      回归新增用例 H：`capability_resolutions` / `compat_applied` / `compat_expired` /
      一个代码尚未认识的 `future_semantic` 顶层字段各自必换代，仅 `timestamp` / `project_root`
      变化不得换代。变异验证：把顶层退回白名单，H 立刻转红。
- [x] 10.3 规格同步：`feature-artifact-layout` 改写证据文件名契约（分区即结构性隔离、自述不符
      fail-closed、旧文件不清理）与"两层都禁用白名单"；`harness-gates` 用"分区消除共享可变资源"
      取代授权判据段，场景改为 A/B 字节隔离。

未按禁止清单增加任何东西：无第三次 summary 复查、无文件锁/租约/current 指针、无 superseded
状态机、无自动清理、无新顶层白名单、无自由文本正则。

## 11. Review round 5 fixes (2026-08-29)

两个原始阻断（P0 subject 分区 / 顶层白名单）经评审判定关闭；本轮两处接线与验收窗口修正 +
两处残留裁剪，均为小修，未动架构。

- [x] 11.1 **[P1] goal snapshot 没有真正复用 loader 的结果**。它调完 `loadVerifierEvidence()`
      之后又独立读了一次 summary subject，再按第二次结果复制文件。两种不一致：loader 验证 A
      之后 summary 换成 B → 快照 `verifier_evidence=A` 却复制 B 的文件；loader 验真失败但
      summary 仍有 subject → 未验真的 conflict/损坏 JSON 照样被复制进稳定名。
      改为直接用 `loaded.evidence.json_path_abs` 与 `loaded.evidence.subject_id`，删除对
      `readSummaryVerifierSubjectId` 的导入与第二次读取。未加锁、未加重试。
      回归：用例⑧ 追加断言——conflict 下 `verifier_evidence` 与两份快照路径全为 `null`。
      变异验证：退回"另读一次 summary"的旧接线即转红。
- [x] 11.2 **[P2] ③b 的假绿窗口**。原先对 A 的文件用可选判断，A 启动过慢时会在入口命中
      `subject_stale`、根本没进目标窗口，用例仍 PASS。改为**强制断言** A 的分区文件必须存在。
      另补一条：仅"文件存在"挡不住反向退化——A 若在换代**之前**就跑完，用例退化成串行 A→B
      也满足该断言。故追加**写入顺序**断言（A 的 mtime ≥ B 的 mtime），把"A 确实挂在 B 发布
      期间、之后才恢复"钉死。变异验证：禁用 CAS 测试缝后（模拟 A 未进窗口），顺序断言转红。
- [x] 11.3 裁剪：hook 注释里与实现矛盾的"旧件让位"表述改写为"跨 subject 的让位/替换已删除、
      旧文件留在原地不清理"；删除无读者的 `PHASE_REPORTS_DYNAMIC_OUTPUT_NOTE`，其说明并入
      `PHASE_REPORTS_OUTPUT_FILES` 自身的注释（那里才有读者）。

## Appendix A — SubagentStop payload capture (task 2.1)

**Method.** A live capture was attempted first: a sandbox project under the session scratchpad with `.claude/settings.json` registering a `matcher: "verifier"` SubagentStop dump hook, a `.claude/agents/verifier.md` probe agent, and a headless `claude -p` run. It failed at authentication — the harness host keeps the OAuth token in memory and the on-disk `~/.claude/.credentials.json` carries `expiresAt: 0`, so a nested CLI cannot refresh. The sandbox was removed. The contract was then read out of the **shipping binary of the same version** (`@anthropic-ai/claude-code` 2.1.246, `bin/claude.exe`), which pins the actual emitted fields rather than documentation.

**Claude Code 2.1.246 — schema.** `SubagentStop` = base ∧ `{ stop_hook_active: boolean, agent_id: string, agent_transcript_path: string, agent_type: string, last_assistant_message?: string ("Text content of the last assistant message before stopping. Avoids the need to read and parse the transcript file."), background_tasks?, session_crons? }`, where base = `{ session_id, transcript_path, cwd, prompt_id?, permission_mode?, agent_id? ("Present only when the hook fires from within a subagent") }`.

**Claude Code 2.1.246 — emitter.** `{...base, hook_event_name: "SubagentStop", stop_hook_active, agent_id: <subagent id>, agent_transcript_path: <derived from the subagent id>, agent_type: <type> ?? "", last_assistant_message: <subagent's last assistant text>}`. This settles the documentation ambiguity noted in the plan: `transcript_path` is the main session, `agent_transcript_path` is the subagent. The in-binary hook description agrees: "Input to command is JSON with agent_id, agent_type, and agent_transcript_path."

**Consequences taken into the implementation.** `agent_type` is emitted as `a ?? ""` and may therefore be empty — the hook records it honestly and does not fail closed on it, since the matcher firing already proves the subagent type. `last_assistant_message` is optional, so its absence is a fail-closed bedside path.

**codeagent.** Not capturable on the implementing machine (no `codeagent`/`codeagentcli` binary; global npm holds only claude/codex/opencode/openspec/pi). Escalated rather than guessed; captured separately on a host that has the CLI — see Appendix B.

## Appendix B — codeagent SubagentStop capture (task 7.5)

**Method.** A one-off probe sandbox (`.cac/settings.json` registering dump hooks for SubagentStop ×2, SubagentStart, Stop and PreToolUse; `.cac/agents/verifier.md` probe subagent; an `ai-prompt.md` carrying a real subject machine block) driven by `codeagentcli -p --dangerously-skip-permissions < task-prompt.txt` with cwd set to the sandbox. 2026-08-29, user-driven.

**Result: GO.** Two SubagentStop events were captured. Payload keys: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `agent_id`, `agent_type`, `is_kia_repo`, `process_id`, `hook_event_name`, `stop_hook_active`, `agent_transcript_path`, `last_assistant_message`. All four consumed fields are present; `transcript_path` differs from `agent_transcript_path` and the latter resolves to a real file whose first user prompt reproduces the delivered `ai-prompt.md` verbatim, so both the invocation subject and the result subject parse and match. `CODEAGENT3_PROJECT_DIR` is injected. Relative to Claude the payload adds `is_kia_repo` / `process_id` (not consumed; unknown fields are ignored) and omits `prompt_id` (optional on the Claude side too).

**Divergence found — a falsified rationale, not a falsified behaviour.** codeagent does not filter the SubagentStop matcher by agent type: both registered entries fired for both events, including `matcher: "verifier"` firing for a subagent whose `agent_type` was the empty string. The implementation's behaviour was already correct (a non-verifier subagent's transcript has no machine block, so it fails closed to bedside and can never publish), but the stated reason for not fail-closing on an empty `agent_type` — "the matcher having fired already proves the subagent type" — is false on this adapter. Corrected in the hook comment and the `agent-adapters` delta; regression variant "非 verifier 子 agent（matcher 过度触发）→ invocation_subject_absent" added to case ⑥.

---
name: feature-completion — 完成凭证结构性不可达的框架缺口（宿主 run deb77f 实证）
overview: 宿主 run 20260908T011803Z-deb77f 六阶段 PASS 闭环、真机 P0 13/13、三屏 visual-diff 全 pass 且 0 must_fix，却收 PARTIAL、无完成凭证。只读复现 collectCleanPassIssues 的 11 条并逐条追到源码，是三组 writer/消费侧缺口而非产品问题：① asset 轴（指纹链 0 布局误用、指纹链 3 硬编码"恒不继承"、零检查面轴判 UNVERIFIED）；② 完成侧只认 legacy runtime_fidelity；③ 视觉债务账本按 check id 归集，而 visual_diff 结果在只有 WARN 命中时被改名，BLOCKER 债务永不闭账；账本又把 WARN 来源当阻断、并对每个阶段的 summary 压 visual 轴。全部修在产生错误事实的 writer 处，每处几行，不加字段、不加消费侧特判、不建新机制。宿主收尾范围在本地修复后按实际可复用路径核对，不预设整链重跑。
version: 3.0.0
todos:
  - id: fc-plan-review
    content: 施工图由用户 + codex 评审。R1 四条、R2（v4 三处裁剪出错 + D2 unsupported 回落 + 收尾范围）已采纳（§8）。通过后先把本 plan 提交为基线，再按循环协议实施。
    status: pending
  - id: fc-asset-axis
    content: 按 D1：(a) harness-runner.ts:1542 → inferRepoLayout；(b) 删 :1602 硬编码 issue；(c) quality-axes 零映射 check 的 visual/asset 轴 → NOT_APPLICABLE，**testing 期 asset 除外**（保留继承入口）；导出 resolveAssetAxisInheritance；V1–V3。
    status: pending
  - id: fc-native-runtime-completion
    content: 按 D2：runtimeFidelityEvidenceIssue 按 dispatchHylyreResult 三态分派——v1 → native（artifact_binding ∧ run/attempt ∧ manifest 绑定）；legacy_unsupported ∧ runtime_fidelity → 原 legacy 校验；unsupported → needs_fix 永不回落；V4–V7。
    status: pending
  - id: fc-visual-debt-ledger
    content: 按 D3：(a) 账本对 visual_diff 源按 structured.kind 归集；(b) 三态收口——FAIL 入账/开账，PASS 或 WARN 关账，仅 SKIP 或缺席保留历史；(c) 保留 visual_reference_viewport 源登记，删其特殊清偿分支；(d) 债务压 visual 轴只在 testing 期；V8–V11。
    status: pending
  - id: fc-spec-docs
    content: 按 D5：新 change 三条 delta + MIGRATION 3.0.x（不写"旧 feature 须整链重跑"）。
    status: pending
  - id: fc-local-acceptance
    content: V1–V12 全绿 + typecheck + LF 扫描 + 一次全量 `cd harness && npm test`。宿主收尾按 §5 在本地修复后据实核对，由用户触发。
    status: pending
isProject: false
---

# feature-completion 完成判据修复（a3f7c1d9）

状态：**v5，待 review，未开工。** 原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)（效率优先、简单优先、减法；每项改动写明放弃的准确性）。

**完成边界**：本 plan 的完成 = 本地修复 + §4 判据。宿主收尾（§5）在本地修复后据实核对范围，由用户触发；需求是否完成以凭证为准。

## 1. 问题边界（宿主 run `20260908T011803Z-deb77f`，2026-09-08 用户授权只读侦察）

### 1.0 实证

- events.jsonl 末尾：testing-i13 `phase_verdict PASS/advance`，`deterministic_defects=[]`，紧接 `run_end PARTIAL`。无设备封顶事件，`target_kind` 全程 `physical`。PARTIAL 唯一来源是 [goal-phase-runtime.ts:9487–9504](../../harness/scripts/goal-phase-runtime.ts)：链尾 `collectCleanPassIssues` 有 needs_fix → `blockingFix`。
- 在宿主 `framework/harness` 下只读调用 `collectCleanPassIssues`（六阶段链）复现 **11 条**：

| # | phase | condition | detail | 根因 |
|---|---|---|---|---|
| 1–5 | spec / plan / coding / review / testing | quality_axis_verified | visual 轴 UNVERIFIED（needs_fix/agent，**retry_phase=testing**） | §1.3 债务压轴 |
| 6 | ut | quality_axis_verified | visual 轴 UNVERIFIED（retry_phase=ut，source_checks 空） | §1.1(c) 零检查面 |
| 7–9 | plan / review / ut | quality_axis_verified | asset 轴 UNVERIFIED（source_checks 空） | §1.1(c) |
| 10 | testing | quality_axis_verified | asset 轴 STALE：`gate fingerprint 重算异常：Cannot locate harness root…；build fingerprint 链未接入（7.2b pending）` | §1.1(a)(b) |
| 11 | testing | runtime_step_evidence | `device-test-evidence 缺 runtime_fidelity` | §1.2 |

- 各阶段自身 visual 检查：spec 全 PASS（唯 `capture_completeness_external` WARN：参考图 OCR 22/70 行未捕获，样本如"等内多园人更多"，OCR 噪声）；plan 全 PASS；coding `visual_parity` PASS、`static_fidelity_score` WARN（结构分 0%，check 自述"不得据此宣称"）；review PASS；testing `visual_diff_capture` PASS（同键复用）、`visual_diff_layout_invariants` WARN（3 屏 pass、must_fix=0、defects=11 全 minor）、`visual_reference_viewport` WARN、`runtime_mount_conformance` WARN。`device-testing/device-screenshots/visual-diff.json` 三屏 `pass`、must_fix 0。
- visual-debt.json 4 条 open：`static_fidelity_score`(MAJOR/WARN 来源)、`capture_completeness_external`(MAJOR/WARN)、`visual_diff`(BLOCKER，i9 真缺陷轮遗留)、`visual_reference_viewport`(MINOR/WARN)。
- device-test-evidence.json：`goal_run_id=deb77f`、`attempt_id=i13`、`artifact_binding` 在、无 `runtime_fidelity`。

### 1.1 asset 轴：三处 writer 缺口

**(a)** [harness-runner.ts:1542](../../harness/harness-runner.ts) `detectRepoLayout(projectRoot)`；[repo-layout.ts:21](../../harness/repo-layout.ts) 从入参向上找 `harness-runner.ts`，consumer 与 standalone 都在下方 → 必抛 → :1556 catch 成"重算异常"。全仓唯一一处传 projectRoot 给 detect。
**(b)** :1602 无条件 push "build fingerprint 链未接入（7.2b pending）"。7.2b 在 [visual-capability-truth tasks.md:88](../../openspec/changes/archive/2026-08-14-visual-capability-truth-superseded/tasks.md) 顺延 3.1.0 且"不作发布阻塞"，代码效果却是阻塞每个有素材需求的发布。而 build/install HAP 内容指纹一致性在同一 testing 阶段已由 [check-testing.ts:2456](../../harness/scripts/check-testing.ts) 核过（不一致 → testing FAIL，summary 走不到继承）。
**(c)** [quality-axes.ts:212](../../harness/scripts/utils/quality-axes.ts) applicable 只看 ui-spec 不看阶段；:268 零执行 → UNVERIFIED。asset 检查只在 spec/coding/testing 产出，ut 无 visual 检查。evidence 轴有零映射降解先例（:257）。注意 [applyAssetAxisInheritance](../../harness/scripts/utils/quality-axes.ts):312 的入口条件恰是"applicable ∧ UNVERIFIED ∧ 零 source_checks"——testing 期的 asset 零检查面**就是继承入口**，不能一并降为不适用（codex R2 #1）。

### 1.2 完成侧只认 legacy telemetry

[verify-feature-completion.ts:333–369](../../harness/scripts/utils/verify-feature-completion.ts) ⑧ → [runtime-step-evidence.ts:434](../../harness/scripts/utils/runtime-step-evidence.ts) `缺 runtime_fidelity` 直接返回；该字段唯一生产者依赖 legacy telemetry，无 writer 调用。testing 门禁 [check-testing.ts:3684](../../harness/scripts/check-testing.ts) 早已 native 优先。规格 [goal-runner:642](../../openspec/specs/goal-runner/spec.md)、[runtime-step-evidence](../../openspec/specs/runtime-step-evidence/spec.md)（native 唯一裁决源）要求 native；08-27 人签退役只迁了门禁侧。单测只有负例。

### 1.3 视觉债务账本：三处 writer 缺口

**(a) id 改名 → BLOCKER 债务永不闭账。** [visual-diff-check.ts:1000](../../profiles/hmos-app/harness/visual-diff-check.ts) `finalizeVisualDiffHits`：只有 WARN 级命中时 `resultId = top.id`——结果以 `visual_diff_layout_invariants` 之名落盘（structured.kind 仍 `visual_diff`）。[visual-debt.ts:154](../../harness/scripts/utils/visual-debt.ts) 按 `c.id === checkId` 归集 → 零命中 → "历史条目单调保留"。B08 给 `visual_reference_viewport` 的清偿条件（:161 `id==='visual_diff'` PASS）同样永不满足。
**(b) WARN 来源入账并阻断。** :155 `worst = FAIL ?? WARN ?? SKIP(非 MINOR)`，:270 `countBlockingDebt` open 即阻断。OCR 噪声、静态启发分、顶部一屏外三条在本需求上永不转绿，而它们的 check 都已 PASS 阶段并在 summary 里披露——账本把披露升级成永久 release 阻断（codex R1 #2）。**用户已授权：视觉 WARN 披露不阻断。**
**(c) 每个阶段都压轴。** [harness-runner.ts:1637](../../harness/harness-runner.ts) `applyVisualDebtPipeline` 对所有阶段执行 open>0 → visual PASS 压成 UNVERIFIED（retry_phase 硬编码 testing）。#1–5 的来源；回退重跑 coding 时，testing 遗留的 open 债务照样污染 coding 快照。
**(d) reducer 的"来源表以外历史条目单调保留"（:214）**：从 `DEBT_SOURCE_CHECKS` 删除某来源不会删掉宿主已有条目，反而让它永久 open（codex R2 #3）。

### 1.4 修复不改 rules，上游闭环仍 fresh；坏快照的刷新路径

gate fingerprint = framework version + phase-rules yaml（[gate-fingerprint.ts:10](../../harness/scripts/utils/gate-fingerprint.ts)）。本 plan 只修 writer，不动 rules。deb77f 上游 summary 里的 visual/asset UNVERIFIED 是已落盘快照。**现有刷新路径**（[harness-runner.ts:1238–1262](../../harness/harness-runner.ts)）：不在 goal gate 环境下（`MAISON_GOAL_GATE_HARNESS` 未设）独立跑 `harness-runner --phase <p> --feature <f>`，full track 且 verdict PASS 且 receipt 校验通过 → `finalizePhaseClosure` 重写 summary 与该阶段 manifest；下游 manifest 只绑上游**交付物**（spec.md/ui-spec 等）为 input，不绑上游 summary，故不传导 stale。这条路径不跑 agent，各阶段的 agent 产物未变。它**不能**刷新的是 run 血缘：`resolvePhaseRunIds`（[verify-feature-completion.ts:606](../../harness/scripts/utils/verify-feature-completion.ts)）按最新 `phase_start` 选 run，独立 harness 不发 phase_start，spec–ut 仍引用 deb77f（PARTIAL）→ :816–822 判 INVALID。§5 据此列两条路径，本地修复后再定。

## 2. 非目标

- 不改 testing 门禁；不让 writer 写 `runtime_fidelity`；不给 device-test-evidence.json 加字段；不给账本加字段。
- 不改 `finalizeVisualDiffHits` 的 id 改名（B07 归因按 id/kind 消费）。
- 不改 `detectRepoLayout` 语义；不改设备真实性封顶；不改血缘规则；不加消费侧特判；不写迁移器。
- 不在完成侧重跑任何门禁已判并被 manifest 冻结的事实（P0 覆盖、schema、artifact binding、HAP/device）。
- 不重建候选件、不跑宿主。

## 3. 裁决

### D1 asset 轴（三处）

**(a)** :1542 `detectRepoLayout(projectRoot)` → `inferRepoLayout(projectRoot)`（:211 已 import）。导出 `resolveAssetAxisInheritance` 供直测。
**(b)** 删 :1602 那行 push，注释改为"链 3（build）由本阶段 `device_test_install` 的 build/install HAP 指纹一致性承担（check-testing :2456）；不一致时 testing FAIL，不会到继承"。
放弃的准确性：继承不再单独复核 HAP；HAP↔源码树绑定非密码学，靠链 1（review attestation 源码未漂移）+ B03 ut 出包唯一化间接成立。7.2b 密码学绑定留 3.1.0（plan c2e9f4d7）。codex 三轮 P1-5 "部分 provenance 不得继承"的前提是"build 链无任何证据"，该前提已不成立。
**(c)** [quality-axes.ts:257](../../harness/scripts/utils/quality-axes.ts) 旁加零映射降解，**排除 testing 期的 asset**：
```
if ((id === 'visual' || (id === 'asset' && phase !== 'testing')) && applicable && b.sources.length === 0) applicable = false;
```
判据是"零映射 check"，不是"零执行"：有 check 但全 SKIP（盲档）仍 UNVERIFIED。testing 期 asset 零检查面保持 UNVERIFIED，由既有 `applyAssetAxisInheritance` 接管（继承 PASS / STALE；无 coding summary 时保持 UNVERIFIED，fail-closed 不变）。`validateSummaryV11` 的 applicable=false 不变量自动满足；`projectPhaseAdvanceVerdict` 对 NOT_APPLICABLE `continue`，推进语义不变。

### D2 完成侧 native 分支（R1 #4 + R2：按 trace 协议三态分派，unsupported 永不回落）

[verify-feature-completion.ts:378](../../harness/scripts/utils/verify-feature-completion.ts) `runtimeFidelityEvidenceIssue`：

```
读 doc（不可读 → 原文案）
身份：expectedRunId/AttemptId 非空时须等于 doc.goal_run_id / attempt_id（文案沿用现有两条）
raw = JSON(doc.trace_path)（不可读 → 'trace 不可读'）
switch dispatchHylyreResult(raw).kind:
  'v1'                 → !doc.artifact_binding ? 'native trace 在场但缺 artifact_binding'
                        : phaseManifestBindsRuntimeArtifacts(projectRoot, feature, doc)（从 validate 末段提取导出，两分支共用）
  'legacy_unsupported' → doc.runtime_fidelity ? 原 validateRuntimeFidelityEvidenceDocument 逐字不变（过渡）
                        : '既无 native v1 trace 也无 legacy runtime_fidelity'
  'unsupported'        → 'trace 协议不可判别/混装：' + detail（**不回落 legacy**，即使 doc 带 runtime_fidelity）
```

为什么只有这几项：spec :642 要求的 provider/trace/derived plan/HAP/device 绑定全部在 `artifact_binding` 与 doc 身份字段里，由 testing 门禁 :3684/:3766 在闭环时验过，随后被 phase-evidence-manifest 冻结、⑤ `lineage_fresh` 保证未改。完成侧只需确认"是 native、身份对、未改"。重算 schema/binding/HAP 都是第二 verdict source（plan 1741b6f2 "同一批事实只裁决一次"）。

### D3 视觉债务账本（四处）

**(a) 归集按 kind。** `deriveVisualDebt` 对 `checkId==='visual_diff'`：`hits = checks.filter(c => c.id==='visual_diff' || (c.structured as {kind?:unknown})?.kind==='visual_diff')`（[visual-diff-check.ts:855](../../profiles/hmos-app/harness/visual-diff-check.ts) 冻结的 structured 形状）。
**(b) 三态收口（R2 #2）。** 替换 :155 的 `worst` 与 :172 的 `!worst` 分支：
```
const fail = hits.find(c => c.status === 'FAIL');
const settled = hits.some(c => c.status === 'PASS' || c.status === 'WARN');
if (hits.length === 0 || (!fail && !settled)) → 历史条目单调保留（缺席 / 仅 SKIP）
else if (!fail)                                → 该 check 全部历史条目 closed
else                                           → 以 fail 为 worst 开账/续账（既有 scope 逻辑不变）
```
WARN 的披露面不变：check 结果、summary、`visual_debt_disclosure` 照旧，只是不入账、不阻断。
放弃的准确性（**用户已授权，不再询问**）：WARN 级视觉缺口（OCR 未捕获行、静态启发分、顶部一屏外、布局不变量 minor）不再阻断 release。B08 D3 "reference_viewport 阻断 release 直到按段建模/换图"据此撤销：该条目在长图需求上永不转绿，效果等于长图需求永不发布，与 B08 选顶部一屏推导的初衷相反。FAIL 来源（真缺陷）仍入账阻断；B07 D1 minor 不产候选不受影响。
**(c) 保留来源登记，删特殊分支（R2 #3）。** `DEBT_SOURCE_CHECKS` 里 `visual_reference_viewport` **保留**；:158–170 B08 的特殊清偿分支删除，让它走 (b) 的通用规则——宿主现有那条 open 条目在下一轮 `visual_reference_viewport` WARN 时按 settled 关账。
**(d) 压轴只在 testing。** `applyVisualDebtPipeline` 压 visual 轴的分支加 `report.phase === 'testing'`；账本写入仍每阶段执行（各阶段 FAIL 债务照记）。release point 在 testing，上游阶段的 visual 轴只反映本阶段检查；否则回退重跑的 coding 会被 testing 遗留债务污染快照。

### D4 不做

- 不把 `detectRepoLayout` 改成先 infer 后 detect 的兜底。
- 不读 testing summary 的 `p0_runtime_step_evidence` PASS 作凭据（spec :644）。
- 不在 review/ut 做 asset 继承。
- 不改血缘规则、不加 resume 守卫、不加完成侧特判、不写债务迁移器（§8）。

### D5 规格

新 change `openspec/changes/<date>-completion-native-runtime-and-visual-debt/`：
- runtime-step-evidence：Requirement "Completion consumes native runtime evidence"（v1 trace + artifact_binding + manifest 绑定；legacy_unsupported 仅在带 runtime_fidelity 时过渡；unsupported 永不回落）。
- visual-diff：债务源 `visual_diff` 按 structured.kind 归集；FAIL 开账、PASS/WARN 关账、SKIP/缺席保留；B08 reference_viewport 特殊清偿撤销（来源登记保留）；债务压轴仅 testing。
- verdict-lattice：零映射 check 的 visual/asset 轴 NOT_APPLICABLE，testing 期 asset 保留继承入口。
- MIGRATION 3.0.x：asset 轴 consumer 继承修复；P0 需求完成凭证自本版可达；WARN 视觉缺口不再阻断 release；修复前闭环的 feature，其上游 summary 快照可由独立 harness 重闭环刷新（§5），**不写成强制整链重跑**。

## 4. 验证判据

| # | 判据 | 落点 |
|---|---|---|
| V1 | consumer 布局临时工程（`<tmp>/framework/` 放 rules yaml + package.json）+ coding summary（asset PASS、gate_fingerprint 与 `computeGateFingerprint` 一致）+ review attestation ok + 无 open asset 债务 → `provenanceIntact=true`，apply 后 testing asset PASS；反例：gate_fingerprint 改一位 → "漂移" | 新单测 harness-runner-asset-inheritance |
| V2 | `deriveQualityAxes`：ui-spec 有 assets、phase=ut、checks 无 visual/asset 映射 → 两轴 NOT_APPLICABLE；**phase=testing、asset 零映射 → asset 仍 applicable+UNVERIFIED（继承入口保留）**；有一条 `asset_*` SKIP → asset UNVERIFIED；`validateSummaryV11` 通过 | quality-axes 单测（R2 #1 针对性用例） |
| V3 | 既有 quality-axes / harness-runner 测试逐字通过 | — |
| V4 | **正例**：P0 acceptance + device-test-evidence.json（无 runtime_fidelity、有 artifact_binding、run/attempt 与 seedCleanChain 一致）+ v1 信封 trace（`dispatchHylyreResult` 判 v1）+ testing manifest 含两文件 → 无 `runtime_step_evidence`；`generate` 成功、`verify` VALID——**首个 P0 需求干净完成正例** | verify-feature-completion 单测 |
| V5 | 反例：attempt_id 改 → "不匹配"；manifest 不含 trace → "未绑定"；缺 artifact_binding → 文案；legacy_unsupported 且无 runtime_fidelity → 文案 | 同上 |
| V6 | 三态：v1 trace + doc 含 runtime_fidelity → 只走 native；**unsupported trace（缺 schema_version / 混装）+ runtime_fidelity 完整 → 仍 needs_fix，不回落**；legacy_unsupported + runtime_fidelity → legacy 分支行为不变 | 同上（R2 针对性用例） |
| V7 | 既有负例 :195、:279 逐字通过；legacy 校验函数 diff 为零 | 同上 + git diff |
| V8 | 账本归集：历史 `debt:visual_diff`(BLOCKER) + 本轮 `{id:'visual_diff_layout_invariants', WARN, structured:{kind:'visual_diff'}}` → closed；本轮 kind 命中 FAIL → open；本轮 `visual_diff` PASS → closed | visual-debt 单测 |
| V9 | 三态收口：历史 open 条目 + 本轮该 check **仅 SKIP** → 保持 open（R2 #2 针对性用例）；本轮缺席 → 保持 open；本轮 WARN → closed；本轮 FAIL → open | 同上 |
| V10 | reference_viewport：历史 open 条目 + 本轮 `visual_reference_viewport` WARN → closed（走通用规则，R2 #3 针对性用例）；来源登记仍在表内 | 同上 |
| V11 | runner：coding 阶段有 open 债务时 visual 轴不被压；testing 阶段有 open 债务时压 UNVERIFIED（既有语义） | harness-runner 单测 |
| V12 | typecheck、LF 扫描（node）、一次全量 `cd harness && npm test` | — |

## 5. 宿主收尾（用户触发，本地修复后据实核对，不在本批判据）

前置：候选件含本 plan。两条路径，本地修复后按 §1.4 的复用事实与 codex/用户裁定选一条：

- **路径 A（不跑 agent，需先核实血缘）**：对 spec/plan/coding/review/ut 各跑一次独立 `harness-runner --phase <p> --feature bc-openCard-1`（不设 goal gate env）刷新 summary 快照；再 `--supersede deb77f --start testing --end testing` 重跑 testing（同键复用，分钟级）→ 链尾零 issue → 凭证生成。**已知阻碍**：`verify-feature-completion` 的血缘对 spec–ut 仍引用 deb77f（PARTIAL）→ INVALID（§1.4）。要走此路须先在本仓单独裁定血缘规则（§6 第一项），本 plan 不做。
- **路径 B（整链）**：`--supersede deb77f` 从 spec 起整链跑，physical 设备，不设 golden env。上游产物已在盘上，各阶段 agent 实际工作量待实测，不预设 4.5 小时。
- 预期终态：plan/review/ut asset NOT_APPLICABLE、ut visual NOT_APPLICABLE；testing asset PASS（继承）、visual PASS（0 阻断债务）、`p0_runtime_step_evidence` PASS；链尾 `collectCleanPassIssues` 零 issue → `feature_completion_generated`；`verify-feature-completion` VALID。若仍有 issue，`feature_completion_skipped pending=N` 列出，回本仓归因。
- 不做：不手改 deb77f 任何文件；不对旧 run "再验证一次"当作恢复。

## 6. 剩余责任登记（不建、只记）

| 项 | 归属 |
|---|---|
| 血缘规则按引用 run 终态整体拒绝 PARTIAL/HALTED run 闭环的阶段（与规格 :626 supersede 复用上游闭环矛盾），使"PARTIAL 后只重跑 testing"不可达——若选 §5 路径 A 则单独开小 plan 裁定 | 框架 |
| 全 advance 的 PARTIAL run 纯 resume 时 `lastTestingTargetKind=null` 不封顶（设备封顶型 PARTIAL 的洞，本 run 未触发） | 框架 |
| `runtime_mount_conformance` 挂载率 54%（长列表未滚入）作为 WARN 披露是否足够 | 需求资产 |
| 7.2b 构建指纹与源码链密码学绑定 | plan c2e9f4d7（3.1.0） |

## 7. 交叠与依赖

- B08（90ce28a0）：D3(c) 删 B08 在 visual-debt.ts:158–170 的特殊清偿分支（来源登记保留）；其余无交叠。7b2e9d4c：无交叠。
- 提交边界：S1 = D1 + V1–V3；S2 = D2 + V4–V7；S3 = D3 + V8–V11；S4 = D5 + 实施记录。不署名。

## 8. 评审记录

- **codex R1（09-08）四条全采纳**：#1 build 链 :1602 → D1(b)；#2 归类错 → §1.0 表按宿主实证重写（6 visual + 4 asset + 1 runtime）；#3 旧 PARTIAL 重验不成立 → §1.4；#4 legacy 先于 native → D2 按 trace 协议分派。
- **v3（宿主只读侦察）**：PARTIAL 根因是 clean-pass needs_fix 非设备封顶；新增 §1.3 账本根因。
- **v4（用户问"有没有搞复杂"）——砍掉五项**：完成侧重算 HAP、账本 `source_status` 两档阻断、完成侧按 retry_phase 特判、血缘改造 + resume 守卫、D2 的 schema/binding 重算。
- **codex R2（09-08）三条 P1 + 两条提醒 + 收尾范围，全采纳**：#1 零检查面 NOT_APPLICABLE 会跳掉 testing asset 继承 → D1(c) 排除 testing 期 asset，V2 针对性用例；#2 `worst=FAIL` 会让仅 SKIP 关掉历史真失败 → D3(b) 三态收口（FAIL 开账 / PASS·WARN 关账 / SKIP·缺席保留），V9；#3 删来源登记不会删宿主已有条目 → D3(c) 保留登记、删特殊分支，V10；D2 补 `unsupported` 永不回落 legacy，V6；删"仍须用户拍板"（WARN 披露不阻断已授权）；§5 改为本地修复后按现有刷新路径（独立 harness 重闭环）据实定范围，MIGRATION 不写强制整链重跑，血缘问题登记 §6 不恢复 v3 改造。

## 9. 实施记录

（实施时由子代理续写：每条改动给 `grep -n` 行号证据。）

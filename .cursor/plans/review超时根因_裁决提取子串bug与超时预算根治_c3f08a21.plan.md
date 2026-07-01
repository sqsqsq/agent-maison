---
name: 全阶段门禁根治 — 裁决提取子串 bug + 跨阶段超时预算（P0+P1）
version: 2.4.0
overview: >
  宿主 06-29 反馈 review 超时 6h+：裁决子串误判（review 特有）叠加全 6 阶段共用 3600 一刀切超时。
  P0 声明式裁决提取 + 模板收敛 + 元门禁 + 歧义拒绝；P1 per-phase 超时 + wall 派生 + 历史 manifest
  迁移 + 超时重试复用 partial。全绿并已提交（e371533f）。release-note（重 retry 调大 wall 提示）
  与本轮延后项见正文。
todos:
  - id: p0-verdict-extraction
    content: extractDeclaredVerdict 声明式提取（锚定+最长优先+诱饵排除+歧义拒绝），接入 check-review/testing-trace-gates/check-testing
    status: completed
  - id: p0-templates-metalint-regression
    content: review+双 profile testing 模板收敛；元门禁禁两种裸子串裁决形态；不通过/达标回归补盲
    status: completed
  - id: p1a-per-phase-timeout
    content: resolvePhaseTimeout 共享 util + 默认表 + wall 派生防脑裂 + 历史 manifest 迁移（仅 resume）
    status: completed
  - id: p1b-partial-reuse
    content: 超时重试复用 partial 产物 + mtime 守卫
    status: completed
---

# 全阶段门禁根治（本轮 P0 + P1）— 裁决提取子串 bug + 跨阶段超时预算

> 来源：宿主工程 xuzhiqiang 06-29 反馈（2.3.0）。
> 范围：用户要求**不只修 review**，全阶段（spec/plan/coding/review/ut/testing）纳入。
> 本轮 = **P0 + P1（并列止血优先级，见 §0）**；P2 见 `phase内checkpoint_resume_重阶段续跑_d7b1e4f2.plan.md`。
> 状态：诊断 + 两份外部 review（cursor/codex）已对 2.4.0 main **逐条核实**，修正已并入。用户已认同"无声明行即 FAIL"收紧。

---

## ✅ 实施完成（P0 + P1，本轮）

全量绿：`npm --prefix harness test` → typecheck 干净 + **1293 单测 + 35 fixtures 全过**。

**落地清单：**
- P0-A 共享 `extractDeclaredVerdict`（[markdown-parser.ts](harness/scripts/utils/markdown-parser.ts)，锚定声明行+最长优先+诱饵排除，容忍 `**label**:` 强调标记）→ 接入 [check-review.ts](harness/scripts/check-review.ts)、[testing-trace-gates.ts `parseReportConclusionVerdict`](harness/scripts/utils/testing-trace-gates.ts)、[check-testing.ts](harness/scripts/check-testing.ts)
- P0-B 模板收敛：review（清「判定依据」+「下一步建议」两段）、testing 双 profile
- P0-C 元门禁 [verdict-extraction.unit.test.ts](harness/tests/unit/verdict-extraction.unit.test.ts)：收窄到精确 bug 形态 `X.includes(回调参数)` + 裁决语义双重判定，含正向自检防 guard 退化
- P0-D 回归：review（不通过+2BLOCKER→PASS / 通过+1BLOCKER→FAIL）、testing（污染段取声明行 / reconcile 裁决-trace 矛盾）
- P1-A 共享 [goal-timeout.ts](harness/scripts/utils/goal-timeout.ts) `resolvePhaseTimeout`/`resolveWallClock` → 接入 runner+progress+schema+manifest 类型；默认 manifest 去掉硬编码 3600
- P1-B 超时重试复用 partial（[goal-runner.ts](harness/scripts/goal-runner.ts) `collectTimeoutResumableArtifacts` + buildPhasePrompt 续作块）

**实现决策（与初版 plan 的偏差，已记录）：** per-phase 超时优先级最终定为
`phase_timeout_seconds[phase] → 显式 flat timeout_seconds → 默认表 → 3600`（**flat 显式覆盖 > 默认表**，而非初版的"表优先"）。原因：测试与用户显式设 `timeout_seconds` 时理应被尊重；为让"开箱走默认表"成立，默认 manifest 不再硬编码 3600。adapter 的 `external_runner.unattended.timeout_seconds` 是 adapter 自身 invoke 契约、不流入 goal manifest，未改。

### ✅ Round-2（收口 review 的 cursor/codex 共识，全部已核实+实现，1298 单测绿）
- **A 歧义拒绝（root，两位 reviewer 同提）**：`extractDeclaredVerdict` 声明行须**恰好命中一个**裁决词（`distinctVerdictsInLine` 正确扣除子串包含）；未填充模板（三词全在）→ null → FAIL，不再静默读成"有条件通过"。三模板声明行改 `<填写单一裁决，删除本占位>`，候选值移到非声明行（不含 `结论:` 冒号形态，不被锚定）。
- **C 历史 manifest 迁移（root，codex 命中用户现场要害）**：[goal-manifest.ts `applyLegacyTimeoutMigration`](harness/scripts/utils/goal-manifest.ts)——legacy 扁平 `timeout_seconds=3600` 且无 phase map → 删除 → resume 走默认表（否则 2.3.0 历史续跑里 review/testing 仍只 60min）。**仅接入 `loadGoalManifestFromRun`（resume 旧 run）**；round-3 修正：**不再动 `loadGoalManifestFile`**——用户手写 --manifest 的显式 3600 是主动选择，须按"扁平覆盖所有 phase"契约保留（codex round-3 命中；含"手写显式 3600 保留"回归测试）。
- **B 元门禁补形态②（防复发，cursor 命中盲区）**：元门禁加扫 `\.includes\('裁决字面量'\)`（testing-trace-gates 旧 bug 形态），含正向自检；现仓已零残留。
- **D partial 复用 mtime 守卫（codex P2 防陈旧）**：`collectTimeoutResumableArtifacts` 加 `sinceMs=wallClockStartMs`，只复用本 run 内产出的产物，过滤跨 run 陈旧报告。

### 留作 P2 / release-note 的低优先项（已记录，本轮不做）
- 派生 wall 只保证"单次无重试"跑完；重 retry（120min×2 等）长跑仍可能撞 wall → release-note 提示可显式调大 `wall_clock_minutes`，或等 P2 checkpoint/resume。
- `--resume` 跨进程续跑首轮拿不到 `priorAttemptTimedOut`（进程内初值 false）→ P1-B partial 提示不注入（prior-failure summary 仍注入）。补法=从事件日志回读上轮 timed_out → 归入 P2。

---

## 0. 优先级修正（来自数据再解读）

原始日志显示 **plan / coding 第 1 次也都超时重试**，不止 review：

| 阶段 | 第1次 | 原因 |
|------|------|------|
| plan | 超时重试 | 纯预算不够（无 verdict bug） |
| coding | 超时重试 | 同上 |
| review | 超时 + 误判 FAIL | 预算不够 **叠加** verdict bug |

→ **超时（P1-A）是跨阶段、占比最大的耗时根因（≈3 阶段各 ~60min ≈ 3h）；verdict bug 是 review 额外叠加。** 故本轮 **P0 与 P1-A 并列止血**，P1-A 不是次要项。

---

## 一、全阶段诊断（逐阶段 + utils 核实）

| 阶段 | 散文裁决提取 | Class-A bug | 核实结论 |
|------|------------|-----------------|---------|
| spec | 否（验收/术语表 table+heading） | 无 | [check-spec.ts:758](harness/scripts/check-spec.ts) 是术语别名覆盖，清白 |
| plan | 否（table+heading） | 无 | 清白（但首次超时，见 §0） |
| coding | **完全无**散文裁决 | 无 | 清白（但首次超时，见 §0） |
| **review** | 是 `结论:通过/不通过` | **有，已爆** | [check-review.ts:433](harness/scripts/check-review.ts) 子串误判→false FAIL |
| ut | 否（结构化 `build.status==='PASS'`） | 无 | [check-ut.ts:3372](harness/scripts/check-ut.ts) 清白 |
| **testing** | 是 `结论:达标/不达标`（**两处**） | **有，latent 真误判** | 见下 |

### Class-A 真 bug（root），共 **3 个实例**（含外部 review 补漏）
1. [check-review.ts:433-434](harness/scripts/check-review.ts)：`['通过','有条件通过','不通过'].find(includes)` → `'通过'` 是另两者子串，恒命中 → 有 BLOCKER 时 [:456](harness/scripts/check-review.ts) 误判 FAIL；[:466](harness/scripts/check-review.ts) 死代码。**已爆**。
2. **[testing-trace-gates.ts:143-150](harness/scripts/utils/testing-trace-gates.ts) `parseReportConclusionVerdict()`（codex 补漏，本轮重点）**：虽**已最长优先**排序（躲过子串优先级半个 bug），但**仍扫整个 结论 段**→ 段内"若不达标…"等枚举会让 `includes('不达标')` 命中 → 喂给 `reconcileReportWithHylyreTrace` 对账 → **真会 false-mismatch**。比 check-testing.ts:781 更要紧。
3. [check-testing.ts:781-782](harness/scripts/check-testing.ts)：`some(includes)` presence-only，同根未爆，一并治。

### 模板放大（root，**两段污染** + 双 profile）
- review [review-report-template.md](skills/feature/code-review/templates/review-report-template.md)：**「判定依据」81-82 行**（"不通过"/"有条件通过"）**和**「下一步建议」84-87 行**两处**都裸列裁决词（cursor 补漏：原 plan 只抓了下一步建议）。
- testing 模板 **两个 profile 都中**：[hmos-app .../test-report-template.md:89,100-102](profiles/hmos-app/skills/device-testing/templates/test-report-template.md) 与 [generic .../test-report-template.md:70,81-83](profiles/generic/skills/device-testing/templates/test-report-template.md)：声明行三选一 + 下一步建议三词全列。
- 同 [[visual-fidelity-vl-selfreport-rootcause]] 硬学习：散文上做子串度量天然不鲁棒。

### Issue-C 跨阶段超时（root）— 全 6 阶段共用一个 3600，**3 个源**
- 默认 manifest [goal-runner.ts:851](harness/scripts/goal-runner.ts) 硬编码 + 运行时 `?? 3600` 回落 [goal-runner.ts:1159](harness/scripts/goal-runner.ts) + 卡死判断同源 [goal-progress.ts:696](harness/scripts/utils/goal-progress.ts) + 6 个 adapter.yaml 全 3600。schema [goal-manifest.schema.yaml:61](workflows/goal-manifest.schema.yaml) 无 per-phase 概念。
- [goal-runner-phase.ts:67-69](harness/scripts/utils/goal-runner-phase.ts) 超时即 `agent_timeout_unclosed` → 即便 harness PASS 也整 attempt 作废、fresh-context 从零重做。

### 测试盲区（root 配套）
- [review-context.unit.test.ts:84](harness/tests/unit/review-context.unit.test.ts) `validReport` 结论只写"通过"，从未覆盖"不通过/有条件通过/不达标"。

---

## 二、P0 — 根除裁决子串误判类（3 实例 + 双模板 + 防复发）

### P0-A：抽全阶段共用"声明式裁决提取器"（实现细节写死，防退化）
- 落 [markdown-parser.ts](harness/scripts/utils/markdown-parser.ts)：
  ```ts
  extractDeclaredVerdict(section, verdictsLongestFirst): { verdict|null; matchedLine? }
  ```
  实现约束（采纳 cursor/codex）：
  1. **锚定声明行**：声明 label 必须是 `审查结论|测试结论|结论判定|结论` 后接 `:：`；**`判定` 仅作兼容兜底，且必须显式排除 `判定依据|判定规则` 等诱饵 label**（codex 最终钉死）。取**首个"行内能用最长优先匹配出裁决词"**的行。
  2. 行内**最长优先**匹配（`有条件通过>不通过>通过`）。
  3. 无可匹配声明行 → `null`（调用方判 FAIL + 精确提示）。
  4. **不得退化为只 reorder 数组**——只 reorder 仍会被"下一步建议/判定依据"骗到；锚定 + 诱饵排除是必需项。
- [ ] 实现 + 单测（不通过/有条件通过/通过/不达标/缺声明行/三词全列/「判定依据」诱饵行不被误锚）
- [ ] [check-review.ts](harness/scripts/check-review.ts) `checkConclusionWithVerdict` 改用之；死分支恢复可达
- [ ] **[testing-trace-gates.ts](harness/scripts/utils/testing-trace-gates.ts) `parseReportConclusionVerdict` 改用之（本轮必改，codex）**
- [ ] [check-testing.ts:781](harness/scripts/check-testing.ts) 改用之，并升级为"裁决 vs trace.outcome/失败用例数"一致性交叉校验

### P0-B：报告模板收敛为唯一可机读声明（清两段 + 双 profile）
- [ ] review 模板：清 **「判定依据」(81-82)** 与 **「下一步建议」(84-87)** 两处裸裁决 token；`**审查结论**: <单一裁决>` 为唯一声明行
- [ ] testing 模板 **hmos-app + generic 两份**同样收敛
- [ ] 同步任何其他 `profiles/*` 副本（防漂移 [[merge-not-new-files]]）

### P0-C：元门禁，禁止全阶段重新引入反模式（root 防复发）
- [ ] lint/单测扫 **`harness/scripts/**` 全量（含 `utils/`，不只 check-*.ts）**，命中裸子串裁决即 **硬 FAIL**，强制走 `extractDeclaredVerdict`（设为唯一允许裁决入口）。对齐既有 meta-lint。
- [ ] **匹配必须收窄（cursor+codex 共同钉死，否则变噪声门禁）**：harness/scripts 下有 20+ 处**合法** `includes`（列名/路径/heading/phase 白名单）。**不得**用宽泛 `(find|some)+includes` 全量扫。仅当**同时**满足：(a) 数组/变量/字面量是裁决语义——命名含 `verdict|conclusion|结论|判定` **或**字面量含裁决 token，且 (b) token 命中 `通过|不通过|有条件通过|达标|不达标|有条件达标`，且 (c) 配 `includes` —— 才 FAIL。可留极小 allowlist 兜底正常用法。

### P0-D：补回归测试（填盲区）
- [ ] review：`不通过+2 BLOCKER`→PASS；`通过+1 BLOCKER`→FAIL（落 [review-context.unit.test.ts](harness/tests/unit/review-context.unit.test.ts)）
- [ ] testing：`不达标+trace≠success`→一致；`达标+trace 有失败用例`→mismatch

---

## 三、P1 — 跨阶段超时预算根治（与 P0 并列止血）

### P1-A：统一 `resolvePhaseTimeout` 共享 util（防 runner/progress 脑裂）+ per-phase 默认表
- [ ] 新增共享 `resolvePhaseTimeout(phase, manifest)`（落 goal-manifest/goal-timeout util），**同时接入**：runner [:1159](harness/scripts/goal-runner.ts)、progress [:696](harness/scripts/utils/goal-progress.ts)、默认 manifest [:851](harness/scripts/goal-runner.ts)、schema、6 个 adapter.yaml。否则 runner 等 90min 但 progress 按 60min 报 STALLED。
- [ ] schema/manifest 增 `unattended.phase_timeout_seconds: {spec,plan,coding,review,ut,testing}`（可选；缺省回落内置默认表，再回落全局 `timeout_seconds`）。
- [ ] **内置默认表（采纳 cursor 建议值，写死避免拍脑袋）**：spec 900s(15m)、plan 5400s(90m)、coding 5400s(90m)、review 7200s(120m)、testing 7200s(120m)、ut 3600s(60m)；review/testing 再叠加 [review-rules.yaml:234](specs/phase-rules/review-rules.yaml) `exploration_strategy.scoring` 复合分上浮（保守、有上限）。
- [ ] **wall_clock 必须随 chain 派生（codex 钉死：默认表总和 495m > 现默认 wall 480m，全链单次无重试就会被总 wall 截断）**：默认 `wall_clock_minutes = max(480, Σ(resolved chain phase timeouts) + buffer)`，**保证"全链单次无重试在满预算下能跑完"**这一不变量；重试叠加仍受 wall 硬顶（符合预期）。
- [ ] 单测：各 phase 解析差异化；runner 与 progress 解析**同值**（脑裂回归）；**Σ(chain per-phase) ≤ 派生 wall**（预算自洽回归）

### P1-B：超时 ≠ 内容失败，重试复用 partial 产物
- [ ] `agent_timeout_unclosed` 重试时，把已落盘 partial（review-report.md / test-report.md / context-exploration.md）连 prior-failure 一并回喂（扩展 [goal-runner.ts:1097-1118](harness/scripts/goal-runner.ts) 注入），避免从零重做探索。
- [ ] 进阶（采纳 cursor）：partial 已"接近完成"（report 已含结论+清单）时，重试预算只补差额并**强制复用** partial。

---

## 四、本轮不纳入、单独记录的议题
- **消费者侧 `framework/` 只读护栏**：截图显示宿主 review 子 agent 被 false-FAIL 逼着**自行改了 framework 的 check-review.ts**。根因修掉后该应急行为消失；但"消费者 agent 能改 framework 运行时文件"是独立隐患，记为独立议题，不阻塞本轮。

## 五、验收（可证伪）
- review：`不通过+N BLOCKER`→`conclusion_with_verdict` PASS（修前必 FAIL）；`通过+1 BLOCKER`→仍 FAIL。
- testing：`parseReportConclusionVerdict` 在"结论=达标但下一步建议含'若不达标'"的报告上取**达标**（修前会误取不达标）。
- P0-C：写回裸子串裁决（含 utils）→ 元门禁单测 FAIL。
- P1-A：19 文件 review 解析 timeout>3600 且≤wall；runner 与 progress 同值。
- P1-B：超时重试日志显示复用 partial，未重跑全量探索。
- `npm` 全量单测绿。

## 六、落地顺序（采纳两份 review 收敛）
1. P0-A/B/C/D + **P1-A 同轮**（止血：消除 false-FAIL + 阶段重跑两大根因）
2. P1-B 紧随 P1-A
3. P2 独立排期（见独立计划）

## 七、约束
- 不擅自 bump（[[version-bump-only-on-request]]）；落 main（[[no-branch-without-request]]）；合并进既有文件（[[merge-not-new-files]]）；goal/普通模式拉齐（[[goal-and-normal-mode-capability-parity]]）。

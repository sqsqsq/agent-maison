---
name: UT 改码门禁 direct 基线归一 — attestation-first 免提交
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan（用户分支策略：全部调整与测试在本分支做完再统一 cp 主干）。
# v1（2026-08-28）：宿主 SimulatedWalletForHmos bc-openCard-1 attended 实锤立项，
#   机制深挖结论见正文二/三节（全部 ground truth 已核实）。
# v2（2026-08-28，吸收 review 一轮 4 返修，逐条核实后修订；裁决=窄返修后通过，核心方案与
#   T1-T5 结构保留，不扩全链重构）：
# [返修1 采纳] direct 分派先判 review 正式 closed（summary 1.2 ∧ closure_status==='closed'
#   ∧ closure_commit.schema_version==='1.0'）再看 attestation——attestation 写点在最终
#   summary rename 之前（finalizer 提交序），闭环中途崩溃可留孤儿 attestation，文件存在
#   不代表 closure 已提交；孤儿一律不得采用。补单测「attestation 在而 summary 仍 open →
#   不进 attested 分支」。只改判断顺序，不引入完整 evidence resolver。
# [返修2 采纳] worktree_digest 表述纠错——宿主实测 coding/review=7df6bae04f45c82f、UT 仅
#   增测试后=57928bed32f58915：digest 含测试目录，职责是防 summary 在工作区变化后被复用，
#   不是产品源码基线。改述为「attestation 已固化正确的产品源码内容基线，提交及回执级联
#   不提供额外源码一致性证明」。
# [返修3 采纳] goal-host-replay-fixes 是 active change（23/26 tasks）非已归档——T4 改为
#   新建独立 change 补其只覆盖 goal 环境而遗留的 direct 分支，不动 goal 既有裁决/恢复
#   语义；新出现的 goal-runtime-enforcement-fixes-2（goal 信号下 coding/exit 忽略 live
#   diff env、明确保留 non-goal 行为）与本 plan 无直接冲突。
# [返修4 采纳] 宿主回灌去绝对化——框架更新后先由既有上游新鲜度门禁确认 review closure：
#   fresh 直接重跑 UT；因 framework version/workflow/review 输入变化判 stale 则免提交
#   补跑一次 review 闭环再 UT。宿主当前 3.0.0 工作区 review evidence 实测 fresh，本次
#   同窗口修复预期只重跑 UT。
# v3（2026-08-28，复审：上轮 4 项确认修复，补 1 项并行集成约束后终审通过）：
# [必须项 采纳] 并行 active change goal-runtime-enforcement-fixes-2 已改同一 check-ut.ts：
#   goal 判定 isGoalOrchestrationEnv() → hasGoalExecutionSignal()（:955，agent-side goal
#   识别），direct env 基线 process.env.HARNESS_DIFF_BASE_REF → resolveHarnessDiffBaseRef()
#   （:959，live env 隔离）——已对工作区核实。T1 增集成约束：实施基于该 change 后代码
#   形态，不得恢复旧谓词/裸读 env（否则回退其修复）；机制表与目标模型同步为现名。
# [非阻断① 采纳] 七节 fallback 域表述改为「该域保留既有兼容行为及已知 commit-blind
#   风险；本 change 只保证已有正式 review closure 的 direct 场景」。
# [非阻断② 采纳] T3 todo「四路分派」→「分派全路」，防用例数再漂移。
todos:
  - id: t1-attestation-first-dispatch
    content: T1 check-ut 分派重构：direct 模式 attestation-first（attested 裁决分支 + 缺失 fail-closed + review 未闭环 git fallback），goal 分支零改动。
    status: completed
  - id: t2-fallback-wording-and-comments
    content: T2 话术与注释收敛：SKILL 约束#11、git-diff.ts/source-drift-facts.ts 头注释、fallback 提示语限定生效域。
    status: completed
  - id: t3-tests-and-fixtures
    content: T3 单测分派全路 + 宿主形态回归 fixture（attested_pass/attested_drift_fail）+ 既有 fixture 等值不动 + commit 洗码负例。
    status: completed
  - id: t4-openspec-change
    content: T4 openspec change ut-direct-attestation-baseline（harness-gates delta，对齐 goal 侧既有条目补 direct 侧）。
    status: completed
  - id: t5-docs-sync
    content: T5 文档面同步：全仓 ut_no_src_mutation 提法扫替（提交基线/HARNESS_DIFF_BASE_REF 话术限定为 fallback 域）。
    status: completed
overview: >
  宿主 bc-openCard-1 attended 实锤：UT 门禁 ut_no_src_mutation 在 direct 模式用 git 基线，
  把 coding 阶段 47 个合法未提交产物全判成 UT 违规，唯一出路被话术指向"提交"，与用户
  不擅自提交政策构成制度死锁；而正确的免提交基线（review closure attestation，内容哈希）
  每次 review 闭环都已落盘、testing 门禁全模式在用，唯独 check-ut 把它锁在 goal 环境后面。
  本 plan 把分派条件从"编排身份"改为"基线可用性"：direct 先判 review 正式闭环——闭环且
  attestation 可读→内容哈希裁决；闭环但缺失/不可读→fail-closed；未闭环→保留 git fallback
  （孤儿 attestation 不采用）。零新机制、零新信任面。
---

# UT 改码门禁 direct 基线归一：attestation-first 免提交（f3a9d2c7）

状态：**v3 终审通过后已实施（2026-08-28，分支 Br_release_3.0.0）：T1–T4 落地并吸收三轮实施 review（逐条修完，见下方偏离记录）；T5 文档扫替已完成，「RELEASE-NOTES 增补」经用户裁决**不在本轮做**——本窗口 `RELEASE-NOTES-v3.0.0.md` 尚不存在，等发布窗口统一生成，故 t5 todo 保持 pending。本轮改动已提交至 Br_release_3.0.0（未 push、未 cp 主干、未回灌宿主）。openspec change=`ut-direct-attestation-baseline`；`npm test` 3630 单测 + 46 fixture 全绿，`openspec:validate` 41/41，`check-plan-version` PASS。**
状态更新（2026-09-03）：t5 按用户裁决置 completed；RELEASE-NOTES-v3.0.0 增补随发布窗口生成时统一处理，不再作为本 plan 待办。
**宿主回灌已完成（2026-08-28，用户驱动，framework e21547c8）：验收场景 7 命中——review 重闭环刷新 attestation（13:55:37Z，114 文件/6 roots，contracts_sha256 逐字节吻合）后 UT 直接 PASS，`ut_no_src_mutation` 走 attested-clean 文案、无 git baseRef、全程零提交（宿主工作区 49 项未提交变更原样保留）。只读核验于当日完成。**

### 实施偏离记录（正文规范未改，按 plan 规则在此登记）

实施期两轮 review 定点纠了三处，结论与本 plan 正文不一致但方向一致（更严、不更松），逐条登记：

1. **孤儿 attestation 的处置**：正文第四节与 T3④ 定为「落 fallback，行为与旧 git 等值」；实施改为 **fail-closed**。理由：只要 attestation 在盘，「summary 没了/退回 open」就不能解释成「从未闭过环」——否则「闭环 → 改码并 `git commit` → 删 `summary.json`」即可把门禁降级回 commit-blind 的 working diff 而 PASS（上游 verdict 门禁对缺失 summary 也是 `if (!v.summaryExists) continue` 直接跳过，全链无人拦截）。红线 1「孤儿 attestation 不读不采信」仍成立——只用「在不在」，内容一字不读；红线 5「既有 fixture EXPECTED 零变更」也仍成立——那两个 fixture 无 attestation，仍在 fallback 域。
2. **漂移 guidance 出路②**：正文写「按 attestation 里该文件的 sha 逐文件回退」；实施改为「从编辑器本地历史/备份取回 review 时的内容，再用 attestation 的 sha256 **核对**」。理由：attestation 只存 `{path, sha256}` 不存内容，且 coding 产物可能从未提交，原文不是可执行动作。
3. **改动文件超出 T1–T5 列举**：新增 `harness/scripts/utils/closure-attestation.ts` 的 loader 最小结构校验（`inventory.roots/files` 不成型即返回 null）。理由：合法 JSON、错误结构的 attestation 原会一路抛到 reconcile，生产上被 `safeRun` 兜成 `framework_bug` 而非规格承诺的 `review_closure_baseline_unavailable`，恢复指引也跟着指错。不新建 resolver，不改任何判定语义，全部消费方走各自既有的 fail-closed 通道。

**已知边界（写进 spec，不假装封住）**：把 review 闭环产物**全部**删光，盘上就真的观察不到痕迹，仍会落到 git fallback。默认工作流允许 review/UT 并行，「没有 summary」本身不能当错误，故不采纳「review 启用即强制 summary 存在」。要防"恶意删光全部证据"须改 DAG 或引入工作区之外的可信锚，属独立 change。
触发：宿主 SimulatedWalletForHmos bc-openCard-1（2026-08-28，attended/direct，harness 走非 goal 路径）UT 阶段仅剩 `ut_no_src_mutation` 一枚 BLOCKER——coding 产物（9 改动 + 38 新文件）从未提交，git 基线把它们全算到 UT 头上；`HARNESS_DIFF_BASE_REF=working` 无效（产物本就在工作区）；下游给出的唯一闭环出路=提交，随即触发 `slim_summary_source_sha_stale` 四阶段回执级联重跑。UT 代码本身已写完、真机 21/21 全通、其余 61 项全 PASS——门禁拦下的全部是无辜者。

---

## 一、问题陈述与定性

`ut_no_src_mutation`（v2.2 红线 5.2：business-ut 不得擅改业务源码）的**红线本身正确且保留**——它防的是"UT agent 改产品代码洗绿测试"，bc-openCard 有事故前科。错的是 direct 模式的**基线选择**：

- 门禁要回答的是相位归属问题（"UT 阶段改了什么"），git diff 只能回答"相对某 commit 差了什么"；框架在 coding→review→ut 边界从不留 commit（用户政策也不允许），于是"全部工作区漂移"被冒充"UT 的改动"——**误伤是结构性的，不是偶发**。
- 正确基线**已经存在**：review 四件套闭环点由 check-receipt 无条件生成 `review-closure-attestation.json`（全产品源码树逐文件 sha256，[phase-closure-finalizer.ts:167](../../harness/scripts/utils/phase-closure-finalizer.ts)），attended 模式一样生成；testing 阶段的同类门禁 `review_closure_attestation`（[check-testing.ts:3804](../../harness/scripts/check-testing.ts)）**不分模式**消费它。唯独 [check-ut.ts:955](../../harness/scripts/check-ut.ts) 以 `isGoalOrchestrationEnv()` 分派，direct 一律落 git 路径。

定性：**基线选择绑错了变量**。"goal 还是 attended"是编排身份，"attestation 在不在"才是基线可用性；两者无因果。上一轮 openspec（goal-host-replay-fixes，plan e7c2a4d8 T4d）只修了 goal 侧，direct 侧留下缺口。

## 二、机制现状（ground truth，全部已核实）

| 环节 | 位置 | 事实 |
|---|---|---|
| attestation 生成 | [phase-closure-finalizer.ts:167](../../harness/scripts/utils/phase-closure-finalizer.ts)（productionEvidence，phase==='review' 无条件写）；调用点 check-receipt --phase review 通过路径（[check-receipt.ts:1103](../../harness/scripts/check-receipt.ts)） | 全模式生成；goal 身份字段仅可选标注。inventory=五源并集 roots 走树、排除测试子树（ohosTest/test/tests/mock），逐文件 sha256 + aggregate |
| 消费者①（全模式） | [check-testing.ts:3849](../../harness/scripts/check-testing.ts) checkReviewClosureAttestationGate | 缺失 BLOCKER（no grace window）、漂移 BLOCKER；attended 今天就在信这份文件 |
| 消费者②（仅 goal） | [check-ut.ts:955](../../harness/scripts/check-ut.ts) `if (hasGoalExecutionSignal())`（goal-runtime-enforcement-fixes-2 后现名，含 agent-side goal 识别）→ checkUtNoSrcMutationGoalEnv（:879，缺失 fail-closed、clean PASS、漂移走 classifySourceDrift → goal 专用 blocker） | direct 拿不到该分支 |
| direct git 路径 | [check-ut.ts:958-973](../../harness/scripts/check-ut.ts) 基线=`resolveHarnessDiffBaseRef()`（HARNESS_DIFF_BASE_REF 的 live-env 隔离读取，同上 change 现名）→ trace.start_commit → 默认 working | working 基线只看未提交变更（[git-diff.ts:10](../../harness/scripts/utils/git-diff.ts) 明示），committed 不可见 |
| provider 归一层 | [source-drift-facts.ts:30](../../harness/scripts/utils/source-drift-facts.ts) driftFactsFromClosureAttestation | 纯 I/O+归一，**不含 goal 判定**——direct 直接可用 |
| 回执 sha 绑定 | [check-receipt.ts:429](../../harness/scripts/check-receipt.ts) slim_summary_source_sha_stale | HEAD 一动四阶段回执全 stale——"提交"出路的级联代价来源 |
| Skill 话术 | [SKILL.md:172](../../skills/feature/business-ut/SKILL.md) 约束 #11 | 教 agent 设 HARNESS_DIFF_BASE_REF=working；只治"历史提交过多"（stale base），治不了"产物未提交"（宿主实测证伪） |

## 三、缺陷清单（五条，本次深挖）

1. **分派条件绑错变量**：编排身份 ≠ 基线可用性（见一）。
2. **git 基线语义性答非所问**：无相位边界 commit 时，"工作区漂移"≠"UT 改动"；coding 合法产物被结构性误伤。
3. **反向 fail-open**：默认 working 基线 commit-blind——UT agent 把非法改码 `git commit` 即从 diff 隐身；且 `HARNESS_DIFF_BASE_REF` 是被裁决方可设的 env（#11 还教它设）——裁决尺度由被裁决者挑选。内容哈希基线对两招免疫。
4. **制度死锁三角**：①门禁要求产物入 git 基线=提交；②回执 sha 锁 HEAD=提交即四阶段 stale 重跑；③用户政策=不擅自提交。两两可共存，三者凑齐必死锁——而 review closure attestation 已固化正确的产品源码内容基线，提交及其引发的回执级联并不提供任何额外的源码一致性证明。（注：worktree_digest 不承担此职责——它含测试目录，职责是防 summary 在工作区变化后被复用，宿主实测 coding/review=`7df6bae04f45c82f`、UT 仅增测试后=`57928bed32f58915`，UT 合法产出即会使其变化。）
5. **话术把结构缺陷包装成用户义务**：失败指引只给"提交/回退 coding 重走全流程"，从不提盘上已有正确基线。

## 四、目标模型：基线可用性分派

```
checkUtNoSrcMutation(ctx):
  goal 环境（判定=hasGoalExecutionSignal()，现状）→ checkUtNoSrcMutationGoalEnv（e7c2a4d8 定稿，零改动）
  direct → 先判 review 是否正式 closed*：
      ├─ closed ∧ attestation 可读      → attested 分支（内容哈希对账，见下）
      ├─ closed ∧ attestation 缺失/不可读 → BLOCKER fail-closed（基线被删/损坏，
      │                                    不回退 git、不读 gap-notes）
      └─ review 未闭环/禁用             → 既有 git fallback，行为逐字保留；
                                          孤儿 attestation 一律忽略不采信
```

\* review 正式 closed 最低判据：review 阶段 summary.json `schema_version==='1.2' ∧ closure_status==='closed' ∧ closure_commit.schema_version==='1.0'`。**先判 closed 再看 attestation 的顺序不可倒**：attestation 写点在最终 summary rename 之前（finalizer 提交序），闭环中途崩溃可留孤儿 attestation，文件存在不代表 closure 已提交。legacy summary（无 closure_status）视为未闭环走 fallback，details 标注基线降级原因——与 ut-legacy-coexistence 的共存精神一致，不破存量。closed 探测 I/O 异常/不可解析 → 视为"闭环状态不可核实"，fail-closed（不进 attested、不回退 git）。只改判断顺序与探测判据，不引入完整 evidence resolver。

**attested 分支语义**（direct）：

- 复用 `driftFactsFromClosureAttestation`（provider 层本就模式中立）。
- clean → PASS，id `ut_no_src_mutation`，details：`基线=review closure attestation：review 后源码零漂移（coding 阶段合法实现不在裁决域；不依赖 git 提交状态）`。
- 漂移 → BLOCKER FAIL，id 仍 `ut_no_src_mutation`（不复用 goal 专用 id——那两个注册了 human_only 与 runner 决策梯语义，e7c2a4d8 v5 P1-⑥/v6 P0 定稿不动），`failure_kind='post_review_source_drift'`，`blocking_class='ut_no_src_mutation'`，affected_files=漂移清单。**归因措辞为"review 后源码漂移"而非"UT 改了码"**——门禁不猜作者（可能是 UT agent，也可能是 review 后人工/重 coding 改动），只判"review 审过的树变了"。
- guidance 两分支：合法改动（可测性接缝/修复）→ 回 coding 纳入并重走 review 闭环（重闭环即刷新 attestation）后再闭环 UT；误改/排障残留 → 按 attestation 逐文件 sha 回退。
- **不接 classifySourceDrift/任何授权链**：direct 无 runner 三源授权；人签通行证已整套剪除（决议在案），不新开任何放行通道；gap-notes/用户回复照旧不参与质量放行。

**为什么这是更合理也更简单的解**：裁决域收敛为红线本意（"review 审过之后树还动没动"）；testing 全模式已在执行同一裁决，UT 采用只是把漂移提前一阶段暴露，闭环口径零放宽；对 commit 洗码免疫（补缺陷 3）；免提交（拆缺陷 4 死锁，回执 sha 模型不用动）；信任面零新增（attended testing 已信该文件，direct 的 trace.json/env 本就 agent 可写，人在场是 attended 兜底）；实现=改一个分派 + 一段话术，不新造机制。附带收益：attested 分支不依赖 git，非 git 宿主也能过此门禁（现 git 路径直接 FAIL"要求项目是 git 仓库"）。

**否决的备选**（防复议回潮）：每阶段强制提交纪律（撞用户政策+回执级联）；UT 入口新造快照（重复 attestation 已有能力，多一信任面，且写点在 agent 手里比 review 闭环点更弱）；给 coding 产物开授权名单（重开 approved_src_mutations 已剪除的洗绿通道）；只降低提交代价（治症状）。

## 五、实施批次（待 review 后动手）

### T1 check-ut 分派重构（核心）
- `checkUtNoSrcMutation` 按第四节分派（**先判 review 正式 closed，再看 attestation**）；新增 `checkUtNoSrcMutationDirectAttested`（clean/漂移两果）与 review closed 探测 helper（三字段判据如第四节，放 check-ut 内部或 phase 状态 util，不进 provider 层）。
- fallback 分支显式忽略孤儿 attestation（不读、不采信、不入 details 误导）。
- **并行集成约束（复审必须项）**：实施基于当前 `goal-runtime-enforcement-fixes-2` 后的代码形态——goal 分支继续以 `hasGoalExecutionSignal()` 判定；git fallback 继续通过 `resolveHarnessDiffBaseRef()` 读取 direct override。**不得恢复 `isGoalOrchestrationEnv()`、不得直接读 `process.env.HARNESS_DIFF_BASE_REF`**（否则回退该 change 刚修好的 agent-side goal 识别与 live env 隔离）。
- goal 分支签名不动（或仅把已加载的 closure 下传避免重复 I/O——不改行为）。
- fail-closed 分支：id `ut_no_src_mutation`、`failure_kind='review_closure_baseline_unavailable'`，guidance=补跑 review 闭环（harness+verifier+receipt+check-receipt）重建 attestation；明示不回退 run-start/working diff。

### T2 话术与注释收敛
- [SKILL.md:172](../../skills/feature/business-ut/SKILL.md) 约束 #11 改写：attestation 基线下"历史变更多"形态消失；`stale_diff_base`/`HARNESS_DIFF_BASE_REF=working` 药方限定 fallback 域（review 未闭环）；新增一句：报大量非 UT 文件漂移时先核对 review 闭环是否最新（重走 review 闭环刷新基线），**不得要求用户提交 coding 产物过门禁**。
- [git-diff.ts:1-15](../../harness/scripts/utils/git-diff.ts) 头注释：标注其在 ut_no_src_mutation 中已降为 fallback 采集器及生效域。
- [source-drift-facts.ts:1-11](../../harness/scripts/utils/source-drift-facts.ts) 头注释："普通模式=trace 基线"的表述改为"普通模式 attestation-first，git 为 review 未闭环时的 fallback"。
- fallback FAIL 的 details 增一行基线降级原因（why 走的 git），suggestion 中"回 coding 重走"保留。

### T3 测试与 fixture
- 单测（goal-runner-phase / 新 describe）：分派全路各至少一例——①attested clean PASS（工作区挂满未提交 coding 产物，**非 git 目录也 PASS**）；②attested 漂移 FAIL（断言无授权提法、failure_kind、affected_files）；③attestation 删除 ∧ review 已闭环 → fail-closed，不回退 git；④**孤儿 attestation 负例（返修1）：attestation 在而 review summary 仍 open → 不得进 attested 分支**（落 fallback，行为与旧 git 等值）；⑤review 未闭环 → 与既有 git 行为等值（现 fixture EXPECTED 逐字不变）。
- 新 profile fixture：`v2_2/ut_no_src_mutation_attested_pass`（宿主形态回归：review 闭环 + 未提交 coding 产物 + UT 仅写 ohosTest）与 `v2_2/ut_no_src_mutation_attested_drift_fail`；夹具需铺 review reports（summary 1.2 closed + attestation），参照 [closed-feature-fixture.ts](../../harness/tests/utils/closed-feature-fixture.ts) 同源生成。
- commit 洗码负例：attested 分支下 UT 改码后 `git commit`，仍 FAIL（哈希树不看 git）——钉死缺陷 3 的修复。
- 谓词扫描器（[adjudication.unit.test.ts:631](../../harness/tests/unit/adjudication.unit.test.ts)）核对：check-ut 仍是非反推用法，扫描器不需白名单变更（如变更须说明）。
- 既有 goal 单测（host-replay-fixes 等）全绿=goal 零改动的回归证明。

### T4 openspec change `ut-direct-attestation-baseline`
- **新建独立 change**：proposal + specs/harness-gates delta + tasks，把 direct 侧 attestation-first 分派（含先判 closed 的顺序）、fail-closed 与 fallback 生效域写进 spec；tasks 与本 plan T1-T5 对应。
- 与 active changes 的关系准确表述：补充 **active** `goal-host-replay-fixes`（23/26 tasks，非已归档）只覆盖 goal 环境而遗留的 direct 分支，**不修改** goal 既有裁决与恢复语义；`goal-runtime-enforcement-fixes-2`（goal 信号下 coding/exit 忽略 live diff env、明确保留 non-goal 行为）与本 change 无直接冲突，delta 不与其重叠。

### T5 文档面同步
- 全仓 grep `ut_no_src_mutation`/`HARNESS_DIFF_BASE_REF` 扫替提法：[docs/skills/business-ut.md](../../docs/skills/business-ut.md)、[skills/reference/business-ut-workflow-detail.md](../../skills/reference/business-ut-workflow-detail.md)、[docs/overview.md](../../docs/overview.md)、[docs/operations/harness-runbook.md](../../docs/operations/harness-runbook.md)、[docs/profiles/hmos-app-harness-toolchain.md](../../docs/profiles/hmos-app-harness-toolchain.md)、两份 testability-audit-template、[harness/prompts/verify-ut.md](../../harness/prompts/verify-ut.md)；RELEASE-NOTES 增补。

## 六、验收场景（完成判据）

1. **宿主形态回归**（T3 fixture ①）：47 个未提交 coding 产物在场，UT 只写测试 → PASS，全程零 git 提交、零回执 stale。
2. UT 改 1 个业务源文件 → FAIL 精确列出该文件，guidance 只有"回 coding 重走 review"与"按 sha 回退"两路，无任何授权/提交话术。
3. review 已闭环但 attestation 被删 → fail-closed BLOCKER，不静默回退 git。
4. review 未闭环迭代跑 → 行为与改造前逐字等值（既有 fixture EXPECTED 零变更）。
5. attested 分支下 commit 洗码 → 仍 FAIL。
6. goal 环境行为零变化（既有 goal 单测全绿）。
7. 宿主回灌（用户驱动，先问再碰）：宿主对话框答"3 不提交"保持现场 → 框架更新后**先由既有上游新鲜度门禁确认 review closure**——fresh 则直接重跑 ut harness；因 framework version/workflow/review 输入变化被判 stale 则**免提交**补跑一次 review 闭环再跑 UT。宿主当前 3.0.0 工作区 review evidence 实测 fresh，本次同窗口修复预期只需重跑 UT。

## 七、边界与悬置（防膨胀）

- **不动**回执 `slim_summary_source_sha` 的 HEAD 绑定：本 plan 后 UT 闭环不再需要提交，级联不再触发；identity 模型改造属独立 change。
- **不扩** attestation inventory 到非 src 工程配置（模块根 build-profile.json5 等）：collectProductSourceFiles 只走 `<root>/src/**`，该边界与 goal/testing 现状一致（行为开关扫描部分兜底）；要扩属独立 change。
- **不新造** UT 入口快照、**不复活**授权名单/人签链（剪除决议在案）。
- fallback 域内 working 基线 commit-blind 缺陷维持现状：该域保留既有兼容行为及已知 commit-blind 风险，**本 change 只保证已有正式 review closure 的 direct 场景**；git fallback 完全退役属后续 change。
- goal 侧一切语义（专用 blocker id、human_only 注册、决策梯、保守恢复）不在本 plan 范围。
- **非阻断后续项**（仅在出现独立事故证据或产品明确要求时再立项，本 plan 一概不做）：全消费点统一 verified resolver；testing 裸读 attestation 的强化；`ut requires: [review]` 的 workflow 调整（review/UT 并行问题）；coding-closure 内容快照。
- 宿主 bc-openCard-1 现场处置不在本 plan：由用户在宿主对话框选"3 不提交"暂停，等本 plan 落地后按验收场景 7 的路径重跑。

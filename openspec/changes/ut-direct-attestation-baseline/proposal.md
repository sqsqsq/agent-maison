# ut-direct-attestation-baseline

## Why

宿主 SimulatedWalletForHmos `bc-openCard-1`（2026-08-28，attended/direct，harness 走非 goal 路径）在 UT 阶段只剩 `ut_no_src_mutation` 一枚 BLOCKER：coding 阶段 9 改动 + 38 新文件从未提交（框架在 coding→review→ut 边界从不留 commit，用户政策也不允许擅自提交），direct 分支的 git 基线把这 47 个合法产物全算成 UT 的改动；`HARNESS_DIFF_BASE_REF=working` 无效（产物本就在工作区）；下游给出的唯一出路是"提交"，而提交立即触发 `slim_summary_source_sha_stale` 的四阶段回执级联重跑。UT 代码已写完、真机 21/21 全通、其余 61 项全 PASS——门禁拦下的全部是无辜者。

根因是**分派条件绑错了变量**：`ut_no_src_mutation` 用「goal 还是 attended」这个**编排身份**来选基线，而真正决定基线能不能用的是「review closure attestation 在不在」这个**基线可用性**，两者无因果。正确基线早已存在且全模式生成：review 四件套闭环点由 check-receipt 无条件写出 `review-closure-attestation.json`（全产品源码树逐文件 sha256），testing 阶段的同类门禁 `review_closure_attestation` 不分模式地消费它；唯独 UT 把它锁在 goal 环境后面。active change `goal-host-replay-fixes` 只覆盖 goal 环境，遗留了 direct 分支。

git 基线在这里还是**反向 fail-open**：默认 working 基线 commit-blind——UT agent 把非法改码 `git commit` 即从 diff 中隐身；且 `HARNESS_DIFF_BASE_REF` 是被裁决方可设的 env（skill 话术还在教它设），等于让裁决尺度由被裁决者挑选。内容哈希基线对这两招都免疫。

## What Changes

- direct（非 goal）模式的 `ut_no_src_mutation` 改为 **attestation-first**：先判 review 是否**正式闭环**，再看 attestation；两步顺序不可倒。
- review 正式闭环 ∧ attestation 可读 → 走内容哈希对账（复用既有 `driftFactsFromClosureAttestation`）：零漂移 PASS，漂移 BLOCKER FAIL（`post_review_source_drift`）。
- review 正式闭环 ∧ attestation 缺失/不可读 → BLOCKER fail-closed（`review_closure_baseline_unavailable`），不回退 run-start/working diff、不读 gap-notes。
- 闭环状态本身不可核实（summary I/O 异常或不可解析）→ 同样 fail-closed：既不进 attested，也不回退 git。
- **闭环证据半有半无**（attestation 在盘而 summary 缺失/open/legacy）→ 同样 fail-closed。attestation 在盘即证明本 feature 跑过闭环机制，「summary 没了」不能被解释成「从未闭过环」——否则「闭环 → 改码并 commit → 删 summary」即可把门禁降级回 commit-blind 的 working diff 而 PASS（上游 verdict 门禁对缺失 summary 也是直接跳过，全链无人拦截）。孤儿 attestation 的**内容**仍一律不读不采信，只用「在不在」做残缺判定。
- **盘上观察不到任何闭环痕迹**（无 attestation 且 summary 缺失/legacy），或 profile 明确禁用 review → 保留既有 git fallback 行为；FAIL details 增一行基线降级原因。
- 探测本身要诚实：`fs.existsSync` 对 `EACCES`/`ENOTDIR` 返回 false，Windows 还把「路径中段是个文件」报成 `ENOENT`——故改为自 projectRoot **自上而下**解析路径，中段非目录/末段非普通文件/任何非 ENOENT 异常一律判 `unverifiable` 而非 `absent`。attestation 若「JSON 合法但结构损坏」（`inventory.roots/files` 不成型）也在 loader 处判基线不可用，不再一路抛到 reconcile 变成 `framework_bug`。
- **本 change 只覆盖「证据残缺」**：把**全部** review 闭环产物一并删除，盘上就真的什么都观察不到，仍会落到 fallback；且默认工作流允许 review/UT 并行，「没有 summary」本身不能当错误。要防"恶意删光全部证据"须改 DAG 或引入工作区之外的可信锚，明确不在本 change 范围。
- 归因措辞为「review 后源码漂移」而非「UT 改了码」——门禁不推断作者；guidance 只有两路：回 coding 纳入并重走 review 闭环 / 从本地历史·备份取回 review 时的内容再用 attestation 的 sha256 核对（attestation 只存哈希不存内容，能验证不能还原）。
- 话术面同步：`HARNESS_DIFF_BASE_REF=working` / `stale_diff_base` 药方限定 fallback 域，删除「提交 coding 产物过门禁」类出路。
- 零新机制、零新信任面、零新放行通道：不接 `classifySourceDrift`，不引入授权名单/人签/gap-notes 放行；goal 分支零改动。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-gates`: direct 模式 `ut_no_src_mutation` 以 review closure attestation 为首选基线并按 closed→attestation 的固定顺序分派，基线不可用或闭环证据残缺即 fail-closed，git diff 降为「盘上观察不到任何闭环痕迹」时的 fallback。

## Impact

- `harness/scripts/check-ut.ts`（分派 + attested 分支 + closed 三态探测 + fallback 归位）、`harness/scripts/utils/closure-attestation.ts`（loader 最小结构校验）、`harness/scripts/utils/git-diff.ts` 与 `harness/scripts/utils/source-drift-facts.ts`（生效域头注释）。
- `skills/feature/business-ut/SKILL.md` 约束 #11 与相关文档面的 `ut_no_src_mutation` / `HARNESS_DIFF_BASE_REF` 提法。
- 新增单测套 `harness/tests/unit/ut-direct-attestation-baseline.unit.test.ts` 与两个 profile fixture（`ut_no_src_mutation_attested_pass` / `ut_no_src_mutation_attested_drift_fail`）。
- Phases affected: UT（direct 编排）；goal 编排、testing 与回执 sha 模型不变。
- 与 active changes 的关系：补充 active `goal-host-replay-fixes`（23/26 tasks，非已归档）只覆盖 goal 环境而遗留的 direct 分支，**不修改** goal 既有裁决与恢复语义（专用 blocker id、`human_only` 注册、runner 决策梯与保守恢复一律不动）；`goal-runtime-enforcement-fixes-2`（goal 信号下 coding/exit 忽略 live diff env、明确保留 non-goal 行为）与本 change 无直接冲突，delta 不与其重叠——本 change 沿用它定稿的 `hasGoalExecutionSignal()` 与 `resolveHarnessDiffBaseRef()` 形态，不恢复旧谓词、不裸读 env。
- `MIGRATION.md`: no consumer migration。存量 feature 若 review 已正式闭环则直接受益；review 未闭环的迭代跑行为不变。

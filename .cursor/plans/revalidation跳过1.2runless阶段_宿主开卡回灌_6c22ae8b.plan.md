---
name: --revalidate 不认 run 权威（宿主开卡回灌）
version: 3.1.0
overview: >
  `--revalidate` 是 harness-runner 三个 feature 入口里唯一没走范围权威预检的：链取自无 run 身份的
  workflow 默认链、子进程也没有身份，于是在 1.2 run 权威的 feature 上必然在第一个目标阶段报
  execution_scope_frozen + capability_resolution_contract，并把该阶段已闭环的 PASS summary 覆盖成 FAIL。
  修法只复用既有统一入口：revalidate 在第一次 spawn 前调用 ensureFeatureExecutionScopeFrozen（与
  --sync-closure / --report-reconcile-only 同形），把 run 身份传给 resolveUpstreamPhaseChain，并让"权威解析失败
  的空链"非零退出而不是写成功账本。第二档（账本/权威），未发现控制影响、仅诊断展示污染，低严重级。待实施。
todos:
  - id: rv-fix
    content: 按 §3 在 revalidate.ts 落三处改动；按 §6 补三条单测并做反向变异；迭代跑目标套件，收口跑一次全量，结果记 §八。
    status: completed
---

# --revalidate 不认 run 权威（宿主开卡回灌）

> 需求输入：调度者 2026-09-24 派发（宿主 bc-openCard-2/open-card-flow-v2 的 `revalidation.json`，09-22 16:40Z）。
> 代码基线：main 797f7af6。`revalidate.ts` 自 3.0.0（2f753436 / 61ae696f）后没改过，早于 P8 的范围权威统一入口。
> 三档（[e7a2c4f1](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §1.1）：**第二档**。这是权威/身份判定，不是产品真值；
> 不修也不会让用户拿到坏产品，但会造出一条假的阶段 FAIL，并让 revalidate 在这类 feature 上完全不能用。

## 1. 证据

| # | 位置 | 事实 |
|---|---|---|
| 1 | 宿主 `revalidation.json` | 16:40:51Z `from=ut`，链 spec→…→testing（六段），目标 plan/coding/review=stale；只跑了 plan：FAIL、exit 1，后面的阶段都没跑 |
| 2 | 宿主 `plan/reports/summary.json` | 16:40:54Z FAIL，blockers：`execution_scope_frozen`（"没有 run 身份、也没有 feature 冻结记录，但已有阶段产物"）+ `capability_resolution_contract` |
| 3 | 宿主 run f829b8 | manifest 链是 coding→review→ut→testing；spec/plan 的义务在 scope 里由 `acceptance@1`/`contracts@1` 输入绑定满足，`reused_phases=[]`。events 显示 09-20 18:44 testing-i8 静默中断，16:42:24Z（revalidate 后 93s）`resume start_phase=testing`，09-24 02:40Z 完成，`feature-completion` VALID；feature 目录**没有** `execution-scope.json` |
| 4 | 宿主 plan 证据 | plan 在 09-18 run c7689f（链=[plan]）里跑过并闭环（`phase-evidence-manifest.json` 20:08Z 绑定了 `summary.json`）。所以它不是"runless 产出"，而是**另一个 run 权威下的已闭环阶段**，revalidate 把那份 PASS 覆盖了 |
| 5 | `revalidate.ts:143` | `resolveUpstreamPhaseChain(projectRoot, feature)` 不传 runId。没有 feature 冻结记录时回落 workflow 默认链（`upstream-verdict-gate.ts:37-63`），范围外的 plan 就进了重验域 |
| 6 | `revalidate.ts:199-203` | 子进程 `harness-runner --phase <p> --feature <f>`，只继承 env。宿主这次调用没有 `MAISON_GOAL_RUN_ID` |
| 7 | `feature-execution-scope.ts:419,477-486` | 没有 runId、没有冻结记录、但已有阶段产物 → `execution_scope_frozen` FAIL（P8 D1.3 "不选边"，这样判是对的） |
| 8 | `capability-resolution-entry-input.ts:234-235` + `capability-resolution.ts:826-835` | 没有 run、也没有 feature 权威时不产 inputContext；在 1.2 workflow 下 contract 1.1 与 invocation 不匹配 → `capability_resolution_contract` FAIL。和 #7 是同一个原因 |
| 9 | `harness-runner.ts:1048-1052` | 这两个检查一 FAIL，就用 `writeRunSummaryBase` 覆盖该阶段的 `summary.json`，覆盖发生在任何检查器跑之前 |
| 10 | `harness-runner.ts:557-569`、`:636-648` | `--report-reconcile-only`、`--sync-closure` 在碰 summary 之前**都先**调 `ensureFeatureExecutionScopeFrozen`；`--revalidate`（`:691-704`）没有这一步 |

**结论**：两个 blocker 都必然出现，和 plan 本身的内容无关——只要没有 run 身份，换成 coding/review 当第一个目标也一样 FAIL。
所以 revalidate 在"run 权威、没有 feature 冻结记录"的 1.2 feature 上**从来不可用**，而且每调用一次就毁掉一个阶段的闭环 summary。
调用来源：AGENTS 模板 `templates/AGENTS.md.template:72` 和 `agents/claude/templates/agents/phase-executor.md:47` 的"修正后跑 --revalidate"指引；
宿主 agent 在 run 静默中断、恢复之前手动跑了一次（`--from ut`）。这是推断，宿主侧没有留下命令行原文。

## 2. 消费面（决定严重级别）

| 消费方 | 读 feature 级 plan summary？ | 本案影响 |
|---|---|---|
| goal runtime assess（`assess.ts:450-454`，带 runId） | 阶段集合 = `executionCompletionPhases(scope)`；plan 不在 f829b8 的范围内 | 无（run 已 VALID 完成） |
| upstream_verdict_gate（带 runId） | 链 = run 的有效范围 | 无 |
| 新 goal run 截断链 preflight（`goal-phase-runtime.ts:5058,5425`） | 1.2 下 `fullWorkflowChain` = 范围阶段，上游不含 plan；而且只看 evidence 新鲜度，不看 verdict | 无 |
| 新 run 的范围构造（`feature-track.ts:350-357` 复用 `executionScopeEvidenceIssues`） | 输入绑定看文件；证据引用在无 run 分支看 manifest 完整性与新鲜度（`verify-feature-completion.ts:109-117`），有 run 分支另核 run 终局与 run 身份；都不看 summary verdict | 无新增（plan evidence 在 revalidate 前就已 stale） |
| `goal-mode-entry --prepare-scope` 缺 requested phases（`feature-track.ts:683` `featureScopePhaseHealth` → `goal-mode-entry.ts:480`） | 读各阶段 summary 的 verdict / closure，作为 `phase_evidence_health` 展示 | 展示会出现 plan=FAIL；该出口本就返回 1，控制不变 |
| candidate promote 的 golden evaluator（`evaluate-bc-opencard.ts:349-373`） | 读 coding summary 的 asset 轴 | 与 plan summary 无关 |
| 回退目标（backtrack_target_absent） | 由当前阶段的责任类别映射到 run 链 | 无 |
| feature-completion / check-exit | 只核范围内阶段；check-exit 不读 summary | 无 |
| 无 run 的 `scripts/assess.ts` CLI（宿主 `next.json` 02:43Z） | 走默认链，列出 `plan failed` gap | 仅展示层；推荐动作被 `spec missing` 主导（run_phase spec），有没有这条 FAIL 结果都一样 |

**严重级别：低（P3）**。未发现本案带来新的控制影响（不多回退、不停机、不误判完成），但诊断展示仍被污染（无 run assess、
prepare-scope 体检）。真正的害处是：revalidate 在这类 feature 上是个坏入口，会覆盖已闭环阶段的 PASS summary。

## 3. 设计（只改 `harness/scripts/utils/revalidate.ts`）

1. `runRevalidate` 开头取 `const runId = process.env.MAISON_GOAL_RUN_ID?.trim() || undefined`，与 harness-runner 那两个入口同源。
   `:143` 改为 `resolveUpstreamPhaseChain(projectRoot, feature, runId)`：有身份时，链就是 run 的有效范围，范围外的阶段不再成为目标。
2. **解析失败的空链先拦**：链解析之后、`planRevalidation` 与无目标成功早退**之前**，若 `resolution.degraded && chain.length === 0`
   就打印既有的 `degradedReason`，`return 1`，不写成功账本。触发场景：feature 记录已转交 run、却无身份调用（`goal-run-creation.ts:186-189`），
   或 run 范围记录损坏（`:172-183`）。这两种情况都会抛错，被 `upstream-verdict-gate.ts:44` 捕获成空链；不拦的话，`revalidate.ts:188-191`
   会把"权威无法解析"写成"无需重验、成功"。非空的默认链回退（`:60-62`）保持不变。
3. 在 `plan.targets.length === 0` 早退**之后**、第一次 spawn **之前**调用
   `ensureFeatureExecutionScopeFrozen({ projectRoot, frameworkRoot, feature, runId })`。有 checks 就逐条打印 `details`/`suggestion`
   （与 `--sync-closure` 同形），另加一行"该 feature 的权威在 goal run 上时，恢复该 run 即可重验，runner 会自己重算新鲜度"，然后 `return 1`，
   不 spawn、不写任何阶段 summary。放在早退之后，是为了不让无目标的 revalidate 产生首次冻结的副作用。
   有目标就一定已经有 summary，所以这一步实际上只会走到核对或 FAIL 分支。该入口不是完整的 run 身份验证器：非空 runId 直接视为 run 权威
   （`feature-execution-scope.ts:419`）；无身份但合法、未转交、候选一致的 feature 冻结记录照常使用（`:461-474`）。**不另加"无身份一律拒绝"**。
4. workflow 1.1（legacy）：入口先查 feature 锁（`:435`）。无身份且存在活锁时会新增拒绝，这是统一权威规则的结果；
   其余情况返回 not-applicable，行为不变。

## 4. 保留 / 裁剪

- **保留**：`planRevalidation` 纯函数与它的目标语义；"未跑过不在重验域"；FAIL 即停；`revalidation.json` 账本形状；D1.3 不选边的 FAIL 文案。
- **裁剪**：无新增字段、状态、CLI 旗标或文案契约。唯一新增接线：`ensureFeatureExecutionScopeFrozen`，也就是 `harness-runner.ts:560,638` 已经在用的那个入口；
  空链拦截只消费既有的 `UpstreamChainResolution.degraded/degradedReason`。

## 5. 否决方案

- **按 "1.2 runless 阶段" 标签跳过 spec/plan**：没有这种标签，而且 plan 实际上是在 c7689f 里跑过的（§1 #4）。该切的是"权威能不能确定"，不是阶段类别。
- **从 goal-runs 目录推断最近的 run 当身份**：违反 D1.3 不选边（`feature-execution-scope.ts:477-479`）。
- **给 --revalidate 加 `--goal-run-id`**：这个旗标是 attended 四元组，必须成组传（`harness-runner.ts:364-381`），等于新增入参契约。
- **框架自愈、回写 plan summary**：这是新机制，而本案没有控制层面的消费方，只有展示污染（§2）。
- **在 check-plan 里对范围外阶段降 SKIP**：会把判定分散到每个检查器，根因在入口。
- **只在早退之后做预检（首版）／把冻结入口前移到早退之前／无身份一律拒绝**：分别会让权威解析失败从无目标出口返回 0（§6 ③）、给无目标的 revalidate 带来首次冻结副作用、误伤合法 feature 冻结记录路径（§3.3）；故只前移空链判定（§3.2）。

## 6. 验证

- `cd harness && npm run typecheck`。
- `execution-scope` 套件新增三条（沿用该套件已有的 1.2 真实 CLI 夹具）：
  ① 1.2 feature，没有 run 身份、没有冻结记录，有已闭环阶段，并且**确实有目标**：显式传 `--from <该阶段>`，或在闭环后改一个输入
  制造 stale（`revalidate.ts:65-73` 会跳过 fresh 阶段）。走真实生产调用 `runRevalidate`，断言返回 1、输出里有 `execution_scope_frozen`
  的详情，该阶段 `summary.json` 和 `script-report.json` **字节不变**；
  ② 带 `MAISON_GOAL_RUN_ID` 的 run 权威 feature，范围 = coding 起，范围内阶段 fresh，范围外 plan 有 stale summary →
  返回 0、不 spawn，`revalidation.json` 的 `chain` 等于 run 的范围、不含 plan，`targets` 为空；
  ③ feature 冻结记录 `transferred_to=<run>`（沿 execution-scope.unit.test.ts:1536 既有转交用例：先冻结、`prepareGoalModeRun` 建 run 并登记转交，再清掉调用环境的 `MAISON_GOAL_RUN_ID`，不手改 JSON），无身份调用、**不传 `--from`**（否则删掉拦截后可能仍因起点不在链中返回 1，削弱反向变异）→ 返回 1，输出里有 `degradedReason`，不 spawn，不写 `exit_code: 0` 的账本。
- 反向变异：删掉 §3.3 的预检，① 必须变红（summary 被覆盖）；把 runId 从 §3.1 去掉，② 必须变红；删掉 §3.2 的空链拦截，③ 必须变红（返回 0）。
- 回归：`--filter revalidate-plan`、`--filter e2e-spec-requirement-closure`（legacy 1.1 revalidate 端到端，必须保持绿）。
- 收口：`cd harness && npm test` 跑一次，完整输出先写入日志文件再 grep 结论。

## 7. 已落盘的假 FAIL 与放弃的准确性

- **宿主不需要动作，框架也不自愈**。§2 已经说明带身份的控制消费方都不读它。以后的 run 如果把 plan 排进链，会重跑并覆盖；
  如果用输入绑定满足 plan 义务，就不会读它。给宿主的说明话术：「旧 plan FAIL 属于本次错误重验的残留，不代表当前完成的 run 失败，
  无需为清理展示而重跑。」
- 放弃的准确性：① 权威无法确定且有重验目标时 revalidate 只拒绝、不代劳（合法 feature 冻结记录仍照 §3.3 可用），调用方要自己去恢复 run；② 宿主那次 revalidate 的调用来源是推断（§1 末），
  不改模板话术；③ 无 run 的 `scripts/assess.ts` CLI 在 run 权威 feature 上也走默认链（§2 末行），属于同一类"入口不认权威"，
  但只影响展示，不在本 plan 范围，只记录在这里。

## 八、实施记录

### 2026-09-24 rv-fix（基线 main 29bc55bd，未 commit）

**改动**
- `harness/scripts/utils/revalidate.ts`（+20/−1）：
  - §3.1 开头取 `MAISON_GOAL_RUN_ID`（trim，空即 undefined），传给 `resolveUpstreamPhaseChain` 第三参；
  - §3.2 链解析后、新鲜度计算与 `planRevalidation` 之前：`resolution.degraded && chain.length === 0` → `console.error` 打印 `degradedReason`、`return 1`，不写账本；非空默认链回退不动；
  - §3.3 无目标早退之后、首次 spawn 之前调用 `ensureFeatureExecutionScopeFrozen({ projectRoot, frameworkRoot, feature, runId })`；有 checks 逐条打印 `✗ <id>：<details>` + `改法：<suggestion>`，再加一行"恢复该 run 即可重验"，`return 1`，不 spawn、不写账本、不碰 summary。
    打印格式与 `--sync-closure` 同内容（details/suggestion），另带 check id，便于输出里认出 `execution_scope_frozen`。
- `harness/tests/unit/execution-scope.unit.test.ts`：新增 `revalidateCaptured` 小助手（进程内调真实 `runRevalidate`、捕获 console、按调用临时设 `MAISON_GOAL_RUN_ID` 与 `NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main` 后还原）+ 三条用例，全部沿 `setupRunlessProject` / `seedRunlessChain` 夹具：
  ① `revalidate without authority refuses before spawning and leaves closed summaries byte-identical`（无身份、无冻结记录、`--from coding`）；
  ② `revalidate under a run identity keeps out-of-scope phases out of the target set`（`prepareGoalModeRun` 建 run、feature 目录无冻结记录＝宿主 f829b8 形态；链 coding→review→ut fresh；plan 闭环后改 summary 造 stale）；
  ③ `revalidate without identity on a transferred feature fails instead of reporting nothing to do`（冻结 → `prepareGoalModeRun` 登记转交 → 无身份、不传 `--from`）。

**验证**（完整输出先落日志再 grep）
- `cd harness && npm run typecheck`：exit 0（改动后与收尾各一次）。
- `--filter execution-scope`：117 passed / 0 failed（新增 3 条）。
- 回归：`--filter e2e-spec-requirement-closure` 10/0（含 legacy 1.1 `E2E revalidate` 用例）；`--filter revalidate-plan` 3/0；`--filter verifier-evidence` 11/0（`verifierModeOf` 引用方）。
- 全量 `npm test`：**未跑**，由协调方统一收口一次。

**反向变异**（每次只改 `revalidate.ts` 一处，跑 `--filter execution-scope`）
- 删 §3.3 预检 → ① 红（116/1），断言 `summary.json 被覆盖`；子进程真实重跑 coding，写出 `execution_scope_frozen` + `capability_resolution_contract` 两条 BLOCKER，与宿主 §1 #2 同形。
- 去掉 §3.1 传入的 runId → ② 红（116/1）：链回落 workflow 默认链，目标变 `plan(stale)、coding、review、ut`，plan 被重跑成 FAIL 并中断。
- 删 §3.2 空链拦截 → ③ 红（116/1）：输出"链上没有需要重验的阶段"，返回 0。
- 还原方式：变异前把实现版 `revalidate.ts` 备份到会话 scratchpad，每次变异后从备份拷回，`cmp` 字节一致；**没用 `git checkout`**（该文件的实现本身未提交，checkout 会连实现一起抹掉）。收尾 `git status` 只有本 plan 两个文件 + 并行 d7e3b9a4 笔二的文件，无变异残留、无开发仓新增产物。

**偏差 / 放弃的准确性**
- 测试助手设 `NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main`：夹具的 `framework/harness` 是 junction，不加时一旦被 spawn，子进程按 realpath 落到开发仓（首次变异实测：在开发仓 preflight `no_materialized_adapter` 失败，没写任何文件），① 只能靠"输出缺 execution_scope_frozen"变红，看不到 summary 被覆盖。加上后子进程按 consumer 布局落回夹具，① 的字节断言真正生效。正常（未变异）路径不 spawn，此设置无作用。
- 输出格式带 check id：plan §3.3 写"与 `--sync-closure` 同形"，那边只打印 details；这里多打一个 id，文案契约不变（无新字段、无新旗标）。
- ② 选"run 已建、feature 无冻结记录"形态（与宿主同），没有先冻结再转交；后者的无身份路径由 ③ 覆盖。
- todo 置 `in_progress`：代码与目标验证完成，唯剩全量收口由协调方跑；跑绿后置 `completed`。

**不确定点**
- 无。§3.4（1.1 无身份 + feature 活锁新增拒绝）未单独加用例：它直接来自 `ensureFeatureExecutionScopeFrozen` 既有锁检查（`:435`，位于 workflow 版本判断之前；锁检查本身已有 `D1 runless call under a live feature lock …` 覆盖，该用例是 1.2 夹具），1.1 无锁路径由 e2e legacy revalidate 保绿。

**调度者收口（2026-09-24）**：全量 `cd harness && npm test`（含本 plan 与 d7e3b9a4 笔二的树）：unit 4781 passed / 0 failed、fixtures 46/0、EXIT=0；codex code review 一轮通过（无阻断，验收缺口=全量，已补）。todo `rv-fix` → completed。

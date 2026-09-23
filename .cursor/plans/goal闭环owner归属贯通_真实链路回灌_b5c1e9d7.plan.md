---
name: goal 闭环 owner 归属贯通（真实链路回灌）
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g6-change-unit-feature-pipeline-integration
  - g8-real-host-development-and-governance
relation: core
layer: change-unit
goal_requires:
  - phase-source-inputs-independent-of-write-duty
  - pre-release-real-chain-regression
goal_provides:
  - closure-owner-attribution-continuity
real_host_validation: >
  宿主 bc-openCard-2/open-card-flow-v2 同一 feature 不回退、不新建 CU：用本轮发布件重跑 1.2
  出生链（spec/plan 起步 → 范围修订延长到 coding），确认 coding 按有效写集改过 plan 读集里的
  产品源码后，post_agent 授权门不再判 live_drift、不再落 upstream_closure_gap halt，且新落盘的
  spec/plan/coding manifest 源码条目带 owner_phase。既有旧 run 不回填、不自愈（§7）。
parallel_authority_added: false
overview: >
  real-chain（plan d4a1f7c3 §10.12）在确定性输入下实跑出一条确定阻断：1.2 下 coding 只要按
  有效写集改过 plan/spec 读集里的产品源码，post_agent 授权门就判 plan closure 漂移，而 rev2
  已把 plan 移出链 → 无处回退 → upstream_closure_gap halt。这是**账本归属**（三档里的第二档），
  不是产品真值，不得单独阻断链。根因是既有 owner 归属机制在 goal 路径上三处断线：最终闭环不传
  factsContext、授权门不告诉新鲜度「当前 owner 正在施工」、观察期（spec）研究源码拿不到下游
  施工归属。本 plan 只接回既有通道：闭环入口透传已有身份并重建调用上下文、授权门显式传当前
  owner、归属资格覆盖「义务在、阶段还没进链」这一态。不新增登记表/落盘清单/豁免开关，
  不放宽终局 completion。
todos:
  - id: own-closure-context
    content: >
      第一笔「闭环归属登记」：按 §3.1（根因 A）在 finalizePhaseClosure 共享入口重建缺失的
      factsContext，并把两个缺参调用方已有的 run 身份透传进来；按 §3.3（根因 C）让归属资格
      覆盖「实现义务在、owner 阶段还没进链」这一态。补 §4 的 OWN-T1–T3（经 goal 最终闭环，
      不手填 manifest）。
    status: completed
  - id: own-authority-owner
    content: >
      第二笔「授权门传当前 owner」：按 §3.2（根因 B）给 checkPlanAuthority 加当前 owner 入参，
      沿 executionScopeEvidenceIssues 透到两处 recompute；终局 completion（:412）不改。补 §4 的
      OWN-T4（经真实 coding post_agent 门）与 OWN-T5/T6（该门对非 coding 不可达，走实际消费点）。
    status: completed
  - id: own-validation
    content: >
      按 §6 跑 typecheck、目标套件、real-chain 正例（**收口条件含把 real-chain 两个套件按
      releaseOnly 恢复登记进 run-unit 的 CORE_SUITES**），全量 unit/fixtures 收口一次；
      验证输出如实记入 §8。不打包、不提交、不改宿主。
    status: completed
---

# goal 闭环 owner 归属贯通（真实链路回灌）

> 需求输入：real-chain 正例实跑阻断（plan d4a1f7c3 §10.12「发现的生产缺陷」），codex 裁定 P1。
> 代码基线：main 04855bf5（3.1.0）。前序：[阶段输入与证据归属修复](阶段输入与证据归属修复_宿主开卡回灌_6f2a9c41.plan.md) §3.3
> 立了 owner 归属机制并补了 P1-T5/P1-T12，但只覆盖 manifest writer 手工入参这一段；
> [判定分级与失败传播收敛](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §1.1 定的三档在这里适用：
> **归属/新鲜度属第二档，不得单独阻断阶段**。

## 1. 缺陷与证据

现象（real-chain 正例，确定性输入）：coding 阶段 `phase_halt halt_reason=upstream_closure_gap`，
detail = `design-context:request:plan: reused evidence invalid；自动回退不可用：plan 不在本 run 的有效范围内（chain=coding→review→ut→testing）`。
链路逐段（行号以函数名为准）：

| # | 位置 | 事实 |
|---|---|---|
| 1 | `capability-resolution-entry-input.ts:375-383`（`codeTargets`） | 1.2 下 spec/plan 的 `derive.codebase` 从冻结范围解析出 5 个产品源码文件，`state=resolved` |
| 2 | `phase-closure-finalizer.ts:164`（`capabilityResolutionEvidenceInputs`） | 这 5 个文件经 summary 的 `capability_resolutions[].inputs[].attempts[].dependencies` 进入 spec/plan 的 `phase-evidence-manifest.json` 的 `inputs`，**无 owner_phase** |
| 3 | coding agent | 按有效写集改写其中 2 个（`index.ets` / `AllBanksPage.ets`） |
| 4 | `goal-phase-runtime.ts:8195`（`runPlanAuthorityGate('post_agent')`）→ `scope-replan.ts:213` → `verify-feature-completion.ts:107/119` | agent 返回后、gate 之前复检授权；1.2 走 design-context 分支 → `recomputePhaseEvidenceStaleness(projectRoot, feature, [ref.phase])`（**无 opts**） |
| 5 | `phase-evidence-manifest.ts:946` | 逐条目比对：spec `stale`（changed_paths 即那 2 个文件）→ 传染 plan → `reused evidence invalid` |
| 6 | `goal-phase-runtime.ts:6909` | rev2 已把 plan 移出链，`tryScopeReplan` 无处回退 → halt |

单变量实跑（d4a1f7c3 §10.12，留存夹具根上对同一个 `checkPlanAuthority` 调两次，唯一变量＝那 2 个文件的字节）：

| 变量 | `checkPlanAuthority` | `recomputePhaseEvidenceStaleness(['spec','plan'])` |
|---|---|---|
| coding 改过源码（原样） | `replan / live_drift / design-context:request:plan: reused evidence invalid` | spec `stale`（2 个 .ets），plan `stale propagated_from=spec` |
| 还原成 spec 记录的字节 | **`ok`** | spec `fresh`、plan `fresh` |

宿主同构：`bc-openCard-2` 的 coding/review/ut manifest 的源码条目同样无 `owner_phase`。

## 2. 根因与调用方清单

### A. goal 的最终闭环不传 `factsContext` → 源码条目没有 owner

`resolvePhaseEvidenceManifest`（`phase-evidence-manifest.ts:442-452`）**只有**在拿到
`opts.factsContext` 时才按 `source_owners` 给条目盖 `owner_phase`；没有它，第 2 段那条
`extraInputs` 路径落下的就是裸条目。`finalizePhaseClosure` 生产调用方**共 5 个，其中 4 个缺参**
（`grep -n "finalizePhaseClosure(" harness --include=*.ts`，排除 `tests/`、`dist/`、`.codex/`）：

| 调用方 | 传 `factsContext`？ | 现场可取的 run 身份 |
|---|---|---|
| `harness/harness-runner.ts:1480` | **是** | 非 goal 路径；goal 下 `deferFullClosureToGoalRunner`（:1462）把闭环让给父进程，这条不生效 |
| `harness/scripts/goal-phase-runtime.ts:8408` | 否 | **本缺陷的主路径**；已传 `goalRunId: manifest.run_id` |
| `harness/scripts/goal-phase-runtime.ts:1786` | 否 | 原 attempt receipt 复验后的补闭环；已传 `goalRunId` |
| `harness/scripts/check-receipt.ts:1204` | 否 | 同文件 `:258` 已有 `runId = process.env.MAISON_GOAL_RUN_ID?.trim()`，但没交给闭环 |
| `harness/scripts/utils/phase-state.ts:524` | 否 | 本函数入参 `opts.goalIdentity.runId`（由 `goal-phase-runtime.ts:9183` 的恢复闭环传入）在手却丢弃 |

落盘 summary 没有 `factsContext` / `source_owners`（`capabilityResolutionEvidenceInputs` 只取 `dependencies[].path`），「直接复用子进程结果」不成立——必须在闭环入口按仓内冻结事实重建。

### B. 授权检查没告诉新鲜度「当前 owner 仍在执行中」

`recomputePhaseEvidenceStaleness` 的 `ownedOutputIsCurrent`（`phase-evidence-manifest.ts:863-877`）
已有两条承接：`pendingOwnerPhase`（:866，owner 正在施工）与「owner 已闭环且输出新鲜」（:872-876）。
post_agent 门跑在 coding 闭环**之前**，后一条必然不成立，前一条没人传。消费点全清单（grep
`checkPlanAuthority` / `tryScopeReplan` / `executionScopeEvidenceIssues`，排除 `tests/`）：

| 消费点 | 处置 |
|---|---|
| `goal-phase-runtime.ts:6843`（`runPlanAuthorityGate` 内，pre_spawn / post_agent 共用） | 传当前 owner |
| `scope-replan.ts:198`（`checkPlanAuthority` 定义）→ `:213`（1.2 design-context 分支）/ `:226`（legacy `recompute(['plan'])`） | 加入参，两条分支都透传 |
| `verify-feature-completion.ts:66`（`executionScopeEvidenceIssues` 签名）→ `:107` / `:119` 两处 recompute | 加可选入参，透传 |
| `verify-feature-completion.ts:412`（终局 completion ⑤ 血缘） | **不改**：终局不得默认「正在施工」豁免 |
| `harness-runner.ts:574`、`feature-track.ts:353`、`verify-feature-completion.ts:132/297/1049` | **不改**：都不是「某 owner 正在施工」的时刻，缺省即今天行为 |

### C. 观察期（spec）建立的研究源码拿不到下游施工归属

spec 的 manifest 里那 5 个研究源码条目一个 owner 也没有，于是只修 A+B，spec 仍 `stale` 并传染 plan，
链照样断。**两道闸各挡一半，缺一不可**：

- **集合不对称**：`capability-resolution-entry-input.ts:419-426` 算 `source_owners` 时，code owner
  分支（:420）**只遍历 `contractFiles`**，test owner 分支（:423）遍历 `contractFiles ∪ sourcePaths`；
  spec 跑在 contracts 存在之前（contracts 由 plan 产出），`contractFiles` 为空。
- **资格判据不覆盖「阶段还没进链」**：`mayAdvance`（:391-395）要求 owner 就是本阶段、或
  `scope.phase_chain.indexOf(owner) > phaseIndex`、或本阶段产 contracts。真实 1.2 出生链只有
  `[spec, plan]`，coding **不在链里** → `indexOf('coding') === -1`；spec 又不产 contracts
  （`producesContracts`，:345）→ false。而把 coding 补进链的范围修订（`goal-phase-runtime.ts:9639`）
  **晚于** spec/plan 的闭环（:8408）。所以只做集合 union 仍然一个 owner 都盖不上。
  （plan 阶段例外：`producesContracts` 为真即无条件放行，前提是 A 先把 `factsContext` 送进闭环。）

## 3. 修法

### 3.1 A：在共享闭环入口重建调用上下文（不持久化新清单）

`phase-closure-finalizer.ts` 的 `publishEvidenceBinding`（:372）里，当 `opts.factsContext` 缺失时，
用**既有**入口 `resolveCapabilityResolutionEntryInput({ projectRoot, feature, phase, featuresDir,
goalRunId, frameworkRoot })` 重建，把返回的 `factsContext` 交给 `resolvePhaseEvidenceManifest`。
该函数的非 `invocation` 分支只读仓内事实：`resolveEffectiveScopeSource`（冻结范围）、phase contract
1.1、`contracts.yaml`、`context/facts.md`——与子进程当初同一个函数、同一份冻结材料。所以不是新机制：
只是把已有入参补上，goal 路径的 manifest 形状与 `harness-runner.ts:1480` 的非 goal 路径**收敛为同一种**。

- **两个缺参调用方必须透传现场已有的身份，不得退回 feature 载体**：`check-receipt.ts:1204` 用同文件
  `:258` 的 `runId`，`phase-state.ts:524` 用本函数入参 `opts.goalIdentity?.runId`。理由是硬的：范围已
  转交给某 run 的 feature，在**没有 run 身份**时 `resolveEffectiveScopeSource`（`goal-run-creation.ts:187`）
  直接抛「已转交……带上该 run 身份再跑」，被下条 try/catch 吞掉后照样生成无 owner 的证据。真没有身份（非 goal 的 `--sync-closure`）才走 feature 载体。
- 重建只允许**恢复既有行为**：整体 try/catch，失败即退回 `factsContext === undefined`（今天的路径）并按既有 `console.warn` 口径披露一行，不抛，不引入新失败面。

### 3.2 B：授权检查显式传当前 owner

`checkPlanAuthority`（`scope-replan.ts:198`）加一个可选入参（当前正在执行的阶段），
`goal-phase-runtime.ts:6843` 传 `String(phase)`（该门只在 `phase === 'coding'` 时进入，见 :6834 早退），
沿 `executionScopeEvidenceIssues` 透到 `verify-feature-completion.ts:107/119` 与 `scope-replan.ts:226`，
落成 `recomputePhaseEvidenceStaleness` 既有的 `pendingOwnerPhase`。语义不变：**只有「条目 owner 就是
当前正在跑的阶段」才承接**，其余判据一字不动；完成验证（:412）与非施工时刻的消费点不传。

### 3.3 C：归属集合对称 + 资格覆盖「义务在、阶段还没进链」

两处都要改，只改一处无效（§2 C）：

1. **集合**：`capability-resolution-entry-input.ts:420` 的遍历集合由 `contractFiles.filter(非测试)` 改为
   `(contractFiles ∪ sourcePaths).filter(非测试)`——与紧邻的 :423 测试分支同形。内层既有判据 `codeOwner === options.phase || historical.has(file)` 不动（`sourcePaths ⊆ historical`，契约文件原条件不变）。
2. **资格**：`mayAdvance`（:391）**保留原三条分支不动**，再 OR 一条只认「阶段还没进链」的新分支，
   两个条件缺一不可（判据只取冻结范围自己的字段，不新增字段）：
   - `!scope.phase_chain.includes(owner)`——**方向约束的替代品**。没有这一条，coding 已闭环且此后
     无范围修订时 `satisfied_by` 仍为空（只有修订才按完成阶段补证明，`feature-track.ts:762`），
     review 会拿到上游 coding owner：既有 P1-T12（`standalone-coding-review.unit.test.ts:683`
     断言此时必须**无** owner）立刻红，且 coding 再闭环新字节后旧 review 可能经 owner 输出承接被误判 fresh。
   - 范围里存在 `applicability === 'required'`、`satisfied_by` 为空、`owner_phase === owner` 的义务
     （按 `owner` 入参匹配，`mayAdvance` 对 code/test 两个 owner 共用）。`owner_phase` 建表时
     （`execution-scope.ts:407`）取 artifact id，与 `phase_chain` 无关；未进链时 `:442-448` 必然同时
     登记 `unresolved` 缺口——即「阶段暂被定义缺口挡住」的既有表示。**不是「`codeOwner` 非空」**
     （`ownerOf`，:386，无实现义务时回退契约 producer 恒非空，单验非空＝全放行）。

预期分布：spec/plan（有实现义务）盖 owner；纯验证范围（如 review 起链，无实现义务又不产 contracts）
`mayAdvance` 仍为假，一个 owner 也拿不到。plan 因 `producesContracts` 恒放行（既有行为、不改），
纯 plan Research 的源码条目照样带 coding owner——OWN-T3 的反例不得建在 plan 上。

## 4. 反例清单与测试落点

| id | 用例 | 必须经过 | 落点 |
|---|---|---|---|
| OWN-T1 | goal 最终闭环后，plan/spec manifest 的产品源码条目带 `owner_phase=coding` | `finalizePhaseClosure`（非 manifest writer） | `harness/tests/unit/phase-closure-finalizer.unit.test.ts` |
| OWN-T2 | 观察期起链（出生链 `[spec, plan]`、coding 尚未进链、spec 时无 contracts）：spec manifest 的研究源码条目同样带 `owner_phase=coding` | 同上 | 同上 |
| OWN-T3 | **反例**：范围内无实现义务**且本阶段不产 contracts**（如 review 起链的纯验证范围）→ 条目无 owner，源码变更仍 `stale`。**不得建在 plan 上**（`producesContracts` 恒放行，见 §3.3） | 同上 | 同上 |
| OWN-T4 | coding 按有效写集改产品源码后，`post_agent` 门判 `ok`（不 replan、不 halt） | `runPlanAuthorityGate('post_agent')`（真实 coding 接线） | `harness/tests/unit/standalone-coding-review.unit.test.ts`（已有真实 scope/contracts 构造，P1-T12 同址） |
| OWN-T5 | **反例**：review/ut/testing 改 coding 产品源码 → 仍 `stale`。**不走 post_agent 门**（`goal-phase-runtime.ts:6834` 对非 coding 立即 `return false`，该门在这些阶段不可达），改走实际消费点：`recomputePhaseEvidenceStaleness`（不传 owner）与 `verifyFeatureCompletion` ⑤ | 新鲜度/completion 消费点 | `harness/tests/unit/phase-evidence-manifest.unit.test.ts` |
| OWN-T6 | **反例**：终局 completion（`verify-feature-completion.ts:412`）不吃「正在施工」豁免；UT 改自有测试仍承接（既有 P1-T5 语义不回归） | `verifyFeatureCompletion` | `harness/tests/unit/phase-evidence-manifest.unit.test.ts` |

既有 P1-T5 / P1-T12 只手工调 manifest writer，锁不住本缺陷——新增用例一律**经生产闭环入口与真实消费点**，禁止手填 manifest 或手喂 `factsContext`。
**§3.3 条目 2 的新分支由既有断言把关**：P1-T12 `standalone-coding-review.unit.test.ts:683`（review 不得拿到 coding owner）**原样不改必须继续绿**，与 OWN-T2（coding 未进链时 spec 必须拿到 owner）一正一反夹住新分支。
**最终验收**：`real-chain 正例：spec→testing 六阶段真实 harness 全链 PASS + closed`（`harness/tests/unit/real-chain.unit.test.ts`）通过。

## 5. 保留 / 裁剪 / 不做

保留：三处 recompute 的全部既有判据；`currentRunId` 同 run 未终局豁免；终局 completion 的严格语义；`mayAdvance` 既有三条放行（含 `producesContracts`）与方向约束；写集/基线对非法写入的既有拦截（`check-coding.ts:330` 不因归属而放宽）。

裁剪：无新增文件/落盘清单/CLI/开关。A 补既有入参并透传现场已有身份，B 补既有 `opts` 字段，C 一处集合对齐 + `mayAdvance` 增一条读冻结范围既有字段的分支（净新增行数预期 < 30）。

不做：不回填/不重算宿主既有 manifest（§7）；不给 completion 加豁免；不为闭环新建归属表；不把源码从证据面整体排除；不改宿主；不改 `harness-runner.ts:1480` 这条已正确的路径。

## 6. 提交划分与验证命令

- 笔一（own-closure-context）：`phase-closure-finalizer.ts` + `check-receipt.ts` + `utils/phase-state.ts` + `capability-resolution-entry-input.ts` + OWN-T1–T3。
- 笔二（own-authority-owner）：`scope-replan.ts` + `verify-feature-completion.ts` + `goal-phase-runtime.ts` + OWN-T4–T6。

以下命令在 **`harness/` 工作目录**执行（`npm run release:check-plans` 在仓库根，见 `package.json:19`）。
过滤器只能交给 **unit runner**：`npm test` 是 `typecheck && test:unit && test:fixtures`
（`harness/package.json:24`），`npm test -- --filter X` 的 `--filter X` 落在最外层脚本上、**到不了**
`run-unit`，于是全量照跑一遍。`run-unit` 又只读**第一个** `--filter`（`harness/tests/run-unit.ts:435`），
所以一条命令一个过滤器：

```
npm run typecheck
npm run test:unit -- --filter phase-closure-finalizer
npm run test:unit -- --filter phase-evidence-manifest
npm run test:unit -- --filter capability-resolution
npm run test:unit -- --filter standalone-coding-review   # 含 P1-T12 原断言
npm run test:unit -- --filter real-chain                 # 最终验收；须先完成下面的登记，否则等于没跑
npm test                                                 # 收口一次（自带 typecheck + unit + fixtures，不再另跑 test:fixtures）
cd .. && npm run release:check-plans
```

**`--filter real-chain` 的前提**：该套件在本 plan 开工时**未登记**（`run-unit.ts:414` 整段被注释）。未登记时
`selectSuites`（`harness/tests/utils/select-suites.ts:24`）找不到匹配 id，会退化成 case-name 过滤并照跑
其它全部套件，real-chain 一个用例都不执行——看着绿其实没跑。收口条件因此含：把 `real-chain` / `real-chain-seams`
按 `releaseOnly: true` 恢复登记进 `CORE_SUITES`（按 id 单跑时 release-only 会执行）。登记之前只能用既有 `runAll()` 直调该模块，不得用 `--filter` 的结果下判断。
迭代期只跑目标套件；全量只在收口跑一次。单测输出先落日志文件再取结论。

## 7. 风险

1. **C 的时序**：出生链不含 coding 时资格只能从「冻结范围里未兑现的 implementation 义务 + owner 不在链内」取（§3.3）。实施时须先实跑打印 spec 闭环那一刻的 `scope.obligations`，确认该义务在且 `owner_phase === 'coding'`；取不到则 A+B 全部落空，须停下来重新定位，**不得**退回「`codeOwner` 非空即放行」（纯验证范围会被一并放行，OWN-T3 立刻红），**也不得**去掉 `!phase_chain.includes(owner)`（P1-T12 立刻红）。
2. **A 的重建可能在闭环期抛**：`resolvePhaseEvidenceManifest` 对 `factsContext.baseline.dependencies`
   走 `addBoundInput`，字节漂移且非本阶段 owner 时**抛** `input binding stale`（`phase-evidence-manifest.ts:427`）
   ——今天的 goal 闭环没有这条路径。但重建侧**先**校验 establishing 证据并按当前 owner 字节/已闭环
   owner 输出重建依赖（`capability-resolution-entry-input.ts:293-325`），未必会撞上。**不得预先启用
   「去 baseline」**：先用 OWN-T1 实证；确有新失败面时，去 baseline 只作用于 **writer 入参**，
   `subject`/`first_phase`/`source_paths`/`source_owners` 必填不动，不影响 facts 侧既有校验
   （`context-facts.ts:51/217`），并在 §8 记下放弃的准确性（establishing 退化为 `first_phase === phase`）。
3. **宿主既有 manifest 缺 `owner_phase`**：按 6f2a9c41 §3.3「已有错误生成的现代证据不得就地改哈希
   或假装 fresh」——**不回填、不自愈、不批量重写**。且**再调一次闭环不会重产证据**：summary 已 `closed`
   时 `finalizePhaseClosure` 在 `phase-closure-finalizer.ts:559` 直接返回 `transitioned:false /
   evidence_rebound:false`，不重写 manifest。旧 run 必须走**真正的重验流程**（使该阶段证据失效并重跑
   该阶段闭环）才会带上 owner；做不到按既有范围明确的恢复提示处理。
4. **过度归属**：A+C 让更多源码条目带上 coding owner，但只改「账本归属」这一档，**不扩写权**——写集
   与基线仍由 `check-coding.ts:330` 按契约 files/modules 与 diff 基线拦截，归属侧同口径
   （`verify-feature-completion.ts:98` 的 `isExecutionSourceBasis`）。OWN-T5 锁「非 owner 阶段改产品源码仍 stale」。

## 8. 实施记录

### 8.1 §7 两条风险的实证结论（先做，实跑取证）

**风险 1（C 的时序）——成立，两个条件都在。** 在留存的 1.2 夹具根（`real-chain-RaeBmo`，
run `20260922T094206Z-24e6e3`）上读**出生范围**（spec 闭环那一刻在册的那一份，
`loadFrozenExecutionScope`）：

- `phase_chain = ["spec","plan"]`——`coding` 不在链里；
- 义务 `implementation:request:coding`：`kind=implementation`、`owner_phase=coding`、
  `applicability=required`、`satisfied_by=0`；
- `unresolved` 里同时登记 `implementation:request:coding@spec->[coding]`（即「阶段暂被定义缺口挡住」）。

对照：同一 run 的**有效范围**（两次修订之后）`phase_chain = ["coding","review","ut","testing"]`、
`unresolved = []`——§3.3 条目 2 的第一个条件（owner 不在链内）因此在 coding 闭环 / review 时不成立，
P1-T12 的反例面自动保住。**故 §3.3 的资格判据可以取，不需要退回任何被 plan 明令禁止的替代。**

**风险 2（A 的重建在闭环期抛 `input binding stale`）——未发生，不启用「去 baseline」。**
六阶段真实链跑通后全程 `grep 'input binding stale' = 0`、`grep '闭环归属上下文重建失败' = 0`。
原因与 §7 的推测一致：重建侧先按当前 owner 字节 / 已闭环 owner 输出重建依赖
（`capability-resolution-entry-input.ts:302-311`），owner 就是本阶段时 `addBoundInput` 走
`owner === String(phase)` 那一支，根本不做字节比对。**`subject` / `first_phase` / `source_paths` /
`source_owners` 一字未动，没有放弃任何准确性。**

### 8.2 改动清单

**生产（7 个文件，净增约 50 行，多数是注释）**

| 文件 | 改动 |
|---|---|
| `harness/scripts/utils/phase-closure-finalizer.ts` | 新增 `rebuildFactsContext()`（整体 try/catch，失败 `console.warn` 后退回 `undefined`）；`publishEvidenceBinding` 的 `factsContext` 改 `opts.factsContext ?? rebuildFactsContext(opts)` |
| `harness/scripts/check-receipt.ts` | 闭环调用透传同文件已有的 `runId` |
| `harness/scripts/utils/phase-state.ts` | **只加注释，不改调用**（身份改由 finalizer 从 `summary.run_id` 取，§8.7 阻断 1） |
| `harness/scripts/utils/capability-resolution-entry-input.ts` | code owner 遍历集合改 `contractFiles ∪ sourcePaths`（与测试分支同形，内层判据不动）；`mayAdvance` 保留原三条，OR 一条「owner 不在链内 且 范围里有该 owner 的 required、`satisfied_by` 空的义务」 |
| `harness/scripts/utils/scope-replan.ts` | `checkPlanAuthority` 加可选 `pendingOwnerPhase`，design-context 与 legacy recompute 两条分支都透传 |
| `harness/scripts/utils/verify-feature-completion.ts` | `executionScopeEvidenceIssues` 加第 6 个可选位参，落到 :107 / :119 两处 recompute；**终局 completion ⑤ 血缘（:419）与 :132 / :297 / :1049 一字未动** |
| `harness/scripts/goal-phase-runtime.ts` | `runPlanAuthorityGate` 传 `pendingOwnerPhase: String(phase)` |

**测试与夹具**

| 文件 | 改动 |
|---|---|
| `harness/tests/unit/phase-closure-finalizer.unit.test.ts` | 新增 1.2 最小工程 `mkOwnershipProject`（候选走生产 `prepareFeatureScopeCandidate`，真 git 基线）+ `closeOwnershipPhase`（**只给 `goalRunId`**，不喂 factsContext）；OWN-T1 / T2 / T3 / T4 四条 |
| `harness/tests/unit/phase-evidence-manifest.unit.test.ts` | OWN-T5（新鲜度消费点：非 owner 阶段与冒名 pendingOwner 都不得洗绿，真 owner 单变量对照） |
| `harness/tests/unit/execution-scope.unit.test.ts` | `design-gap-revert` 的 ④ 后半断言改写（见 §8.5 偏差 1） |
| `harness/tests/unit/real-chain.unit.test.ts` | `writeFacts` 改为**累积** phase_delta 段 + 本阶段 delta 表承接新目标；coding 材料顺序调整（先落产物再写 facts）；review 报告「审查范围」列全解析后的 code 输入（见 §8.5 偏差 2 / 3） |
| `harness/tests/run-unit.ts` | `real-chain` 按 `releaseOnly: true` **恢复登记**；`real-chain-seams` 仍不登记并写明两条独立红的定位线索 |
| `openspec/changes/closure-owner-attribution-continuity/` | 新增 proposal / tasks / `specs/skill-contracts` MODIFIED delta |

### 8.3 测试映射与变异实测（每条生产改动各一次）

| 变异 | 改法 | 实测结果 |
|---|---|---|
| M1（A 重建） | `factsContext: opts.factsContext`（去掉 `?? rebuildFactsContext`） | `phase-closure-finalizer` **PASS=22 FAIL=4**（OWN-T1 / T2 / T3 / T4 全红）；顺带证明 §8.5 偏差 1 的归因（`execution-scope` 在该变异下回到 114/0） |
| M2（C 集合） | 遍历集合改回 `contractFiles` | `phase-closure-finalizer` **PASS=23 FAIL=3**（OWN-T1 / T2 / T4） |
| M3（C 资格） | 删掉 `mayAdvance` 新分支 | `phase-closure-finalizer` **PASS=24 FAIL=2**（OWN-T1 / T2） |
| M4（B → scope-replan:226） | 去掉 recompute 的 `pendingOwnerPhase` 透传 | `phase-closure-finalizer` **PASS=25 FAIL=1**（OWN-T4） |
| M5（B → goal-phase-runtime 门） | 去掉 `pendingOwnerPhase: String(phase)` | `--filter real-chain` **PASS=1 FAIL=1**，日志重现 `===== upstream_closure_gap =====` |
| M6（B → verify-feature-completion:107/119） | 两处 recompute 去掉 `freshnessOpts` | `--filter real-chain` **PASS=1 FAIL=1**，同样重现 `upstream_closure_gap` |

每次变异后都已还原并复核 `git diff --stat` 回到本笔的行数。

**未单独变异覆盖（如实记账）**：`check-receipt.ts:1204` 的 `goalRunId` 透传。它是「把现场已有的
变量交给下一层」的一行，且仓内没有任何夹具会在**范围已转交给某 run**的工程上跑
`check-receipt --sync-closure`；它喂的 `rebuildFactsContext` 本体由 M1 覆盖。**放弃的准确性：
该路径的归属产出未被任何断言锁住**。（`phase-state.ts` 那条按偏差 9 未透传，无需覆盖。）

### 8.4 验证结果（原始输出先落日志文件再 grep）

| 门 | 结果 |
|---|---|
| `cd harness && npx tsc --noEmit -p tsconfig.typecheck.json` | 退出码 **0**（每次改动后都重跑） |
| `--filter phase-closure-finalizer` | **PASS=26 FAIL=0**（含 OWN-T1 / T2 / T3 / T4） |
| `--filter phase-evidence-manifest` | **PASS=21 FAIL=0**（含 OWN-T5；既有 P1-T5 原断言未改、仍绿） |
| `--filter standalone-coding-review` | **PASS=34 FAIL=0**（**P1-T12 原断言一字未改、继续绿**） |
| `--filter scope-replan` | **PASS=15 FAIL=0** |
| `--filter execution-scope` | **PASS=114 FAIL=0**（改写一条断言，见 §8.5 偏差 1） |
| `--filter real-chain`（正例，release-only 已登记） | **PASS=2 FAIL=0，65 066 ms**（两次取值 63–65 s，与 04855bf5 基线同量级） |
| real-chain 六阶段逐阶段 | spec / plan / coding / review / ut / testing **全部 `verdict=PASS` + `closure_status=closed`**，run `status=CHAIN_SLICE_COMPLETED`，`agent_invokes=12`；全程 `live_drift` / `upstream_closure_gap` / `input binding stale` / 重建失败告警**各 0 次** |
| 归属实测（六份 manifest 逐条读） | spec / plan：6 条 `.ets` 全部 `input` + `owner_phase=coding`；coding：全部 `both` + `owner_phase=coding`；review / ut / testing：**全部无 owner**（P1-T12 的「已消费 owner 不得保留豁免标记」语义在真实链上同样成立） |
| `real-chain-seams`（直调 `runAll`，仍未登记） | **PASS=4 FAIL=2，176 871 ms**（1.2 打通前是 2/4）。两条红见 §8.5 偏差 6 |
| `npx openspec validate --all --strict` + `npm run openspec:validate` | **47 passed, 0 failed**，含 `✓ change/closure-owner-attribution-continuity`；enforcement 路径 PASS |
| `node scripts/check-plan-version.mjs` | `mode=default current=3.1.0` **PASS** |
| `git diff --check` | 干净（退出码 0） |
| LF（node 逐字节扫 `\r\n`） | 全部改动 / 新增文件 crlf=**0** |
| `cd harness && npm test` 全量收口 | **4712 passed, 0 failed** + fixtures 46/0，退出码 0（见 §8.6，首跑抓到偏差 9 后复跑） |

### 8.5 偏差与放弃的准确性（逐条）

1. **改了一条既有断言**：`execution-scope.unit.test.ts` 的 `design-gap-revert` ④ 后半
   「触发文件不得作为当前输入进 plan 证据」。**归因经单变量实测确认**（M1：去掉闭环重建，该用例
   立刻回绿）——原断言之所以成立，只是因为 goal 的闭环当时**什么源码都不登记**；非 goal 路径
   （`harness-runner.ts:1480`）本来就登记。本夹具里「修订触发文件」与「implementation 义务的写集
   文件」是**同一个** `AllBanksPage.ets`，它经未被 `REVISION_TRIGGER_KINDS` 过滤的 implementation
   义务 basis 进入读集，所以「没被当作当前目标」在 1.2 goal 链上不再可观测。
   改后断言：该条目若在 plan 证据里，**必须带 `owner_phase='coding'`**。
   **放弃的准确性：R-目标收集那一路在本夹具里失去了直接判据**（R-摘要豁免仍由同段 ③ 锁住，
   B4 要防的后果由「撤回后 plan 仍 fresh」锁住）。
2. **夹具 `writeFacts` 原来每阶段整文件重写，把上游阶段的 `## phase_delta:` 段删掉了。**
   生产的 facts 证据哈希按段分片（`factsPhaseFingerprint` = [baseline, 本阶段 delta]），删掉 spec 段
   就让 spec 那条 facts 证据**真的**失效 → plan 期 `facts baseline stale` → plan 被当成建立阶段、
   四条研究量化门一起红。改为**累积**（与 P1-T12 的真实 agent 形状一致：追加一节）。
   **这是夹具与真实 agent 的行为差，不是生产缺陷**；baseline 段逐字不变。
3. **夹具两处材料按真实门禁补齐**（都不是放宽判据）：① coding 之后每个阶段的 facts 要在**本阶段
   delta 表**里承接新落盘的 `BankListItem.ets`（`context_exploration_facts_scope_coverage` 认
   `declared ∪ 本阶段 delta 路径列`；写进 frontmatter 会改 baseline 段、把上游证据作废）；
   ② review 报告「审查范围」必须列**解析后的 code 输入全量**（`review_scope_to_design` 比的是
   `resolvedInputs.values.code`，1.2 下就是冻结范围的源码读集，不是「agent 觉得自己改了哪几个」）。
   两条都是 1.2 打通后第一次被真实门禁驱动到，1.1 下不存在。
4. **OWN-T4 的落点与覆盖面与 §4 表不同。** §4 把它放 `standalone-coding-review.unit.test.ts` 并要求
   「经 `runPlanAuthorityGate('post_agent')` 真实接线」。实际：该门是 goal 主循环里的闭包，单测不可达；
   而 P1-T12 那条链的 design-context 是被 **contracts 输入绑定**满足的，`checkPlanAuthority` 会走
   :211 分支、对源码字节无感，做不成单变量。改为放在本笔的 1.2 最小工程上，直接调
   `checkPlanAuthority` 并**逐字段照搬 :6843 的入参形状**，单变量只有 `pendingOwnerPhase`。
   **`:213 → executionScopeEvidenceIssues` 那条分支的覆盖由 real-chain 正例承担**（缺陷本来就出在那里，
   M5 / M6 两次变异都在它上面复现了 `upstream_closure_gap`）。
   **放弃的准确性：`scope-replan.ts:213` 分支没有快单测**，只有 release-only 的真实链覆盖。
   （曾试过在最小工程上直接造 `executionScopeEvidenceIssues` 的 1.2 用例——不成立：:107 / :119 的
   recompute **不传 `frameworkRoot`**，最小工程没有 `framework/` 目录时推导出的框架根与闭环记录的
   环境指纹不等，未动源码就判 stale。已删除该用例，不留半截断言。）
5. **OWN-T6 未单独立条。** 调度指令的范围是 OWN-T1..T5；终局 completion 侧本笔**一行未改**
   （`verify-feature-completion.ts:419` 的 ⑤ 血缘重算与 :132 / :297 / :1049 三个消费点都不传新入参），
   OWN-T5 在新鲜度侧锁住了「非 owner 冒领豁免必须失败」。**放弃的准确性：没有一条用例直接对
   `verifyFeatureCompletion` 断言「终局不吃施工豁免」。**
6. **`real-chain-seams` 仍不登记**（§8「不登记必红套件」）。1.2 打通后它由 2/4 变成 **4/2**，剩两条红：
   - **RC-8a**：`真修改仍被判无进展停机`（`phase_halt plan no_progress_guard`）——d4a1f7c3 §10.12
     已单独记账，与本缺陷无关，未定位；
   - **RC-4 前提②**：链跑到 UT 之后**首次**到达该断言，`doc/features/<f>/ut/reports/ac-coverage.json`
     出现在 verifier subject 材料里。`createRuntimeArtifactPredicate` 只作用于
     `buildVerifierMaterialView` 的 **manifest 那一路**（`verifier-material.ts:128`），`contextFiles`
     那一路不过这个谓词——究竟是断言前提写错还是材料面真漏，本笔未定论。
   两条定位清楚后与 `real-chain` 一起按 `releaseOnly` 登记回来。
7. **OpenSpec 补了 delta（plan 未预告）。** `skill-contracts` 的既有条款写着
   「不得把全部读取目标或**写集外 Research** 统一归给 coding」，而 §3.3 的集合并集在任何
   `mayAdvance(codeOwner)` 为真的阶段都会把读集里的 Research 源码归给该 owner——语义确有外扩，
   所以新建 change `closure-owner-attribution-continuity`，用一条 MODIFIED Requirement 把
   「遍历集合 = 写集 ∪ 本阶段读取目标」「资格四选一、`producer 非空` 不算资格」「goal 闭环须与
   非 goal 路径产出同一种归属」写明，并补三条 Scenario（观察期得 owner / 纯验证范围不得 owner /
   goal 闭环重建失败只退回不新增失败面）。**写入许可不随归属外扩**（§5 的保留项一条未动）。
9. **（已被 §8.7 阻断 1 取代，原文保留以留痕）§3.1 点名的 `phase-state.ts:524` 透传最终没做**。
   实测证伪了「只是补一个入参」这个前提：`goalRunId` 不只喂重建——`productionEvidence`
   （`phase-closure-finalizer.ts:303`）用 `Boolean(opts.goalRunId?.trim()) || isGoalEnvironment()`
   决定要不要**强制** requirement 血缘哈希，它在重建的 try/catch **之外**。
   `check-receipt` 那条路的身份来自 `MAISON_GOAL_RUN_ID`，`isGoalEnvironment()` 本来就为真、
   透传不改判据；而 `runSyncClosureDetailed` 的身份来自调用方入参，透传会**第一次**为
   `--sync-closure` 打开那道强制门——全量收口首跑当场抓到：既有 `check-receipt-policy` 的
   两条 T4（`T4：current summary 不读取旧 receipt attempt…` / `T4：receipt 路径不可写…`）
   报 `goal 环境闭环无法计算 requirement 血缘哈希（run=run-X）`，**4710 passed / 2 failed**。
   §3.1 明令重建「不引入新失败面」，故这条路维持现状（取不到 run 身份 → 重建落空 → 退回
   今天的无归属行为，**不是**新失败），并在原处留注释写明为什么。
   ~~放弃的准确性：`--sync-closure`（含 `goal-phase-runtime.ts:9183` 的恢复闭环）这条路的证据
   仍然没有 `owner_phase`。~~ **codex review 后已解决**：身份改从正在闭环的那份 summary 的
   `run_id` 取，两件事就此解耦——归属接上，血缘门触发条件一字未动（§8.7 阻断 1）。
10. **不回填、不自愈**（§7 风险 3 原样执行）：宿主与夹具里已落盘的无归属 manifest 一个字没碰；
   `summary` 已 `closed` 时 `finalizePhaseClosure` 仍在 `phase-closure-finalizer.ts:559` 直接返回
   `transitioned:false`，重跑闭环不会重产证据。

### 8.6 首轮全量收口（`cd harness && npm test`，跑两次）

| 轮次 | 结果 |
|---|---|
| **首跑**（`phase-state.ts` 还在透传 `goalRunId`） | **`NPM_TEST_EXIT=1`**，墙钟 **1 440 125 ms**；`4710 passed, 2 failed（共 4712）`。唯一红的套件 `Suite [check-receipt-policy] PASS=20 FAIL=2`——两条既有 T4 报 `goal 环境闭环无法计算 requirement 血缘哈希（run=run-X）`。**这就是偏差 9 的实证来源**：透传 `goalRunId` 顺带打开了 `productionEvidence` 的 requirement 血缘强制门 |
| **复跑**（按偏差 9 撤回该透传后） | **`NPM_TEST_EXIT=0`**，墙钟 **1 459 762 ms**；`4712 passed, 0 failed（共 4712）` + fixtures `46 passed, 0 failed`；329 个 `Suite [...]` 行**无一条 `FAIL!=0`**；日志含 `[SKIP] suite real-chain：release-only（加 --release 或 --filter real-chain 执行）`——**新登记的套件对日常 `npm test` 零增量** |

复跑里与本笔相关的套件逐条：`standalone-coding-review` 34/0、`execution-scope` 114/0、
`scope-replan` 15/0、`check-receipt-policy` 22/0、`phase-closure-finalizer` 26/0、
`phase-evidence-manifest` 21/0。

**基线对账**：04855bf5 的 `npm test` 是 4707 passed；本笔 **4712 = 4707 + 5**（OWN-T1/T2/T3/T4 + OWN-T5），
`real-chain` 的 2 例照旧不计（release-only 不执行）。

**收口后复跑**（撤回透传之后再确认一次，因为那是一处生产改动）：
`--filter real-chain` **PASS=2 FAIL=0 / 64 981 ms**；`npx tsc --noEmit -p tsconfig.typecheck.json` 退出码 0；
`node scripts/check-plan-version.mjs` PASS；`git diff --check` 干净；LF 全部改动/新增文件 crlf=0。

**一处如实说明**：全量复跑期间只改过两处**纯注释**（`phase-closure-finalizer.unit.test.ts` 的
段头 `OWN-T1..T3` → `OWN-T1..T4`、`phase-evidence-manifest.unit.test.ts` 里 OWN-T5 的覆盖面措辞
收准），改后都重跑了 `npx tsc --noEmit`（0）与对应过滤套件（26/0、21/0），未再跑第三次 24 分钟全量。

### 8.7 codex review 返修（2 阻断 + 2 建议，全部落地）

#### 阻断 1：恢复闭环（`--sync-closure`）这条路仍不产归属 —— 属实，已按「拆开开关」的思路修

codex 不接受 §8.5 偏差 9 的「不引入新失败面」作为不做的理由，要求**只为归属重建接入 runId，
不动 requirement 强制门原条件**。落地取的是比「加一个开关字段」更小的那种：

- `rebuildFactsContext` 的 run 身份改为 **`opts.goalRunId?.trim() || summary.run_id?.trim()`**。
  身份取自**正在闭环的那份 canonical summary 的 `run_id`**（由产出它的 harness 轮次写下，
  就是这份证据自己的 run 身份；恢复闭环这条路进 finalizer 之前，receipt 已在
  `phase-state.ts` 的 `tryValidateReceipt` 带 `goalIdentity` 校验过身份）。
  **与 `recoverPartialPublication` 不是同一件事**——后者校验的是 **staged** summary，
  且只有调用方给了 `goalRunId` 时才约束 run 等值（codex 二轮建议 2 指正，原文此处表述不准）。
- 因此：**零新增入参、零新增开关、零判据改动**。`goalRunId` 的含义一字未动，
  `productionEvidence` 的 `Boolean(opts.goalRunId?.trim()) || isGoalEnvironment()` 逐字保留，
  `--sync-closure` 不会被第一次拉进 requirement 血缘强制门（`check-receipt-policy` 两条 T4 复绿）。
- `utils/phase-state.ts` 因此**不需要**改调用（偏差 9 的注释已改写为指向这条实现）：
  它落的 summary 本来就带 `run_id`，归属在这条路上自动接上。
- 新增 **OWN-T6**（`phase-closure-finalizer.unit.test.ts`）：**不传 `goalRunId`** 的闭环
  （= `phase-state` 的调用形态）必须按 `summary.run_id` 重建出 `owner_phase=coding`。
- **变异 M7**（把回落删掉、只留 `opts.goalRunId`）→ `phase-closure-finalizer` **PASS=26 FAIL=1**，
  红的正是 OWN-T6。

**§8.5 偏差 9 随之作废**（原文保留在下方并标注已被本节取代），放弃的准确性收回：
`--sync-closure` / 恢复闭环的证据现在同样带 `owner_phase`。

#### 阻断 2：并集把非源码 Research 文件也归给了 coding —— 属实，已按宿主源码判据收窄

合格 facts 的 `source_code_paths` 允许含 `doc/module-catalog.yaml` / `framework.config.json`
这类来源（`context-facts.unit.test.ts:72` 即此形），旧写法会给它们盖上 `owner_phase=coding`，
于是它们的漂移在 owner 施工期被 `pendingOwnerPaths`（`phase-evidence-manifest.ts:907`）整批豁免
——与 OpenSpec 既有条款「需求、contracts 与其它非源码输入不适用此承接规则」相悖。

- 修法（**本条已被 §8.9 收紧**：当时只筛了并集的读集那一半，写集那一半留了口子）：
  并进来的那一半先过 **`profileCodingHost.sourceFileSuffixes`**——宿主自己声明的
  「什么算源码」，与 `check-coding.ts:718`、`correction-commands.ts:483` 同一个判据，
  **不另立路径表**。
- 未声明该判据的 profile（`generic`）→ 空集 → 不盖 owner、漂移照旧 stale（fail-safe 方向）。
  OWN 夹具因此改用 `hmos-app`（`['.ets']`）并把源码换成 `.ets`，与 P1-T12 同形。
- 反例落在 **OWN-T2 内**（同一份 facts、同一次闭环，单变量只有"是不是源码"）：
  `doc/research-notes.md` 必须无 owner，且改它之后即便声明 `pendingOwnerPhase: 'coding'`
  spec 证据仍 `stale`。OWN-T6 同点复核。
- **变异 M8**（去掉 `isHostSourceFile` 筛）→ `phase-closure-finalizer` **PASS=25 FAIL=2**，
  报文逐字为「非源码研究来源拿到了 owner=coding——并集没过宿主的源码判据」。
- 真实链复核（`REAL_CHAIN_DEBUG=1` 留存夹具逐份读 manifest）：spec/plan 5/5、coding 12/12
  `.ets` 带 `owner_phase=coding`，review/ut/testing 0 个；**六份 manifest 里带 owner 的非 `.ets` 条目为 0**。

#### 建议 3：OWN-T4 补带 `executionScope` 的调用形态

已在 OWN-T4 内追加一对同样的单变量断言，入参形态与 `goal-phase-runtime.ts:6843` 一致
（带有效范围）。**如实说明覆盖边界**：本范围的 design-context 尚未 satisfied，仍落到
`scope-replan.ts:226` 的 recompute 那支；`:213 → executionScopeEvidenceIssues` 那一格要求
`satisfied_by` 是**阶段证据**引用，它只由一次真实范围修订（`feature-track.ts:762`）产生，
在最小工程里造不出来，覆盖仍由 release-only 的 `real-chain` 正例承担（M5/M6 两次变异都在其上复现）。
这条断言锁住的是「范围一在场不得绕开本次修复」。

#### 建议 4：为「纯修订触发文件」补独立锁

`execution-scope.unit.test.ts` 的 `design-gap-revert` 里触发文件同时是 implementation 写集文件，
`REVISION_TRIGGER_KINDS` 在那里不可观测（§8.5 偏差 1）。新增
**`standalone-coding-review.unit.test.ts` 的 `D0.3b`**：用一个**只当触发依据**的文件
（`src/demo/trigger.ts`，不在 contracts.files 里），同一条生产解析出来的 binding 只换 obligation 的
`kind`，经真实 goal run + 生产 bridge 断言——`design-context` 时它**是**当前读取目标（对照组成立），
`design-decision` / `acceptance-definition` 时**不是**。

#### 返修后验证

| 门 | 结果 |
|---|---|
| `cd harness && npx tsc --noEmit -p tsconfig.typecheck.json` | 退出码 **0** |
| `--filter phase-closure-finalizer` | **PASS=27 FAIL=0**（含 OWN-T1/T2/T3/T4/T6） |
| `--filter check-receipt-policy` | **PASS=22 FAIL=0**（两条 T4 复绿） |
| `--filter context-facts` | **PASS=22 FAIL=0** |
| `--filter execution-scope` | **PASS=114 FAIL=0** |
| `--filter standalone-coding-review` | **PASS=35 FAIL=0**（+1 = D0.3b；P1-T12 原断言仍未改） |
| `--filter phase-evidence-manifest` / `--filter scope-replan` | **21/0** / **15/0** |
| `--filter real-chain` | **PASS=2 FAIL=0，66 092 ms**；六阶段 PASS + closed |
| 变异 M7 / M8 | 各红 1 / 2 条，见上 |
| `npx openspec validate --all --strict` | **47 passed, 0 failed**（delta 已同步收窄措辞并补一条非源码 Scenario） |
| 全量 `cd harness && npm test` | 见 §8.8 |

### 8.8 返修后全量收口

`cd harness && npm test` → **`NPM_TEST_EXIT=0`**，墙钟 **1 463 890 ms**；
`4714 passed, 0 failed（共 4714）` + fixtures `46 passed, 0 failed`；
329 个 `Suite [...]` 行**无一条 `FAIL!=0`**；日志含 1 行
`[SKIP] suite real-chain：release-only`——新登记套件对日常 `npm test` 仍是零增量。

与本笔相关的套件逐条：`standalone-coding-review` 35/0、`execution-scope` 114/0、`scope-replan` 15/0、
`context-facts` 22/0、`check-receipt-policy` 22/0、`phase-closure-finalizer` 27/0、
`phase-evidence-manifest` 21/0。

**基线对账**：04855bf5 是 4707 passed；本笔 **4714 = 4707 + 7**
（OWN-T1/T2/T3/T4/T6 五条 + `phase-evidence-manifest` 的 OWN-T5 + `standalone-coding-review` 的 D0.3b）。
`real-chain` 的 2 例照旧不计（release-only 不执行），单跑 **PASS=2 FAIL=0 / 66 092 ms**。

**一处如实说明**：本次全量跑完后，`utils/phase-state.ts` 的那段**纯注释**又改写了一次
（把"暂不采纳"的旧说法改成指向 §8.7 的实现）。改动为注释、无行为差异，改后重跑
`npx tsc --noEmit`（0）与 `git diff --check`（干净），未再跑第四次 24 分钟全量。

**最终门**：`npx openspec validate --all --strict` + `npm run openspec:validate` **47 passed, 0 failed**；
`node scripts/check-plan-version.mjs` PASS；`git diff --check` 干净；20 个改动/新增文件 crlf=**0**。
不打包、不提交、未碰宿主。

### 8.9 codex 第二轮返修（1 阻断 + 2 措辞，全部落地）

#### 阻断：并集的**写集那一半**没过源码判据 —— 属实，已改成两侧同判据

`contracts.files` 只被 `contracts.schema.yaml:49` 约束为非空字符串、
`contract-reference-closure.ts:36` 只做路径规范化——「写集必然都是源码」不成立。
一条非源码路径若**同时**落在写集与研究读集里，`historical.has(file)` 照样给它实现阶段 owner，
其漂移随即在施工期被 `pendingOwnerPaths`（`phase-evidence-manifest.ts:907`）整批豁免。

改法：`(contractFiles ∪ sourcePaths).filter(!isTestPath && isHostSourceFile)`——**一个判据、两侧同过**。

**判据**：profile 声明的源码后缀，与 `check-coding.ts:718` / `correction-commands.ts:483`
**逐字同法**（同样的 `.` 归一 + **大小写敏感** `endsWith`——建议 1 已按此改，原先我写成了
`toLowerCase()` 比较，与源头不一致）。

> **本节当时还加了第二条「落在 `contracts.modules[].package_path` 内即算源码」的兜底，
> 理由是不加会让 P1-T12 变红。codex 第三轮裁定该兜底是「放宽生产判据迁就错配夹具」，已删除；
> 正确的修法是修夹具的 profile 声明。** 全部细节与新的反例见 §8.10。

新增 **OWN-T7**（`phase-closure-finalizer.unit.test.ts`）：`approvedDesign` 夹具的
`contracts.files` **故意**混入 `doc/research-notes.md`，它同时在 facts 的 `source_code_paths` 里；
在 coding 闭环（`codeOwner === phase`，owner 无条件成立的那一支）后断言——
同一次闭环里源码拿到 `owner_phase=coding`（正向对照），该非源码路径 **无 owner**，
且改它之后即便声明 `pendingOwnerPhase: 'coding'` 证据仍 `stale`。

**变异 M9**（把筛退回只作用于 `sourcePaths` 那一半）→ `phase-closure-finalizer`
**PASS=27 FAIL=1**，红的正是 OWN-T7，报文逐字「写集里的非源码路径拿到了 owner=coding」。

#### 建议 1：后缀比较改回大小写敏感 —— 已改（见上）

#### 建议 2：`summary.run_id` 的措辞收准 —— 已改

原注释写「`recoverPartialPublication` 判跨 run 复原用的也是它」，不准确：那里校验的是
**staged** summary，且只有调用方给了 `goalRunId` 时才约束 run 等值。
`phase-closure-finalizer.ts` 与 `utils/phase-state.ts` 两处注释、以及本节之前的 §8.7 表述，
统一改为准确说法：**身份取自正在闭环的那份 canonical summary 的 `run_id`**（由产出它的
harness 轮次写下，就是这份证据自己的 run 身份）；恢复闭环这条路进 finalizer 之前，receipt 已在
`phase-state.ts` 的 `tryValidateReceipt` 带 `goalIdentity` 校验过身份。

#### 返修后验证

| 门 | 结果 |
|---|---|
| `cd harness && npx tsc --noEmit -p tsconfig.typecheck.json` | 退出码 **0** |
| `--filter phase-closure-finalizer` | **PASS=28 FAIL=0**（+1 = OWN-T7） |
| `--filter standalone-coding-review` | **PASS=35 FAIL=0**（**P1-T12 原断言仍一字未改、继续绿**） |
| `--filter check-receipt-policy` / `--filter context-facts` | **22/0** / **22/0** |
| `--filter execution-scope` / `--filter phase-evidence-manifest` / `--filter scope-replan` | **114/0** / **21/0** / **15/0** |
| `real-chain` 正例 | **PASS=2 FAIL=0，66 363 ms**；六阶段 PASS + closed |
| 真实链归属复核（留存夹具逐份读 manifest） | spec/plan `.ets` 5/5、coding 12/12 带 `owner_phase=coding`；review/ut/testing 0 个；**六份里带 owner 的非 `.ets` 条目为 0** |
| 变异 M9 | `phase-closure-finalizer` **27/1**，红的是 OWN-T7 |
| `npx openspec validate --all --strict` | **47 passed, 0 failed**（delta 改为「两侧同判据」并把 Scenario 扩到写集那一侧） |
| 全量 `cd harness && npm test` | **`NPM_TEST_EXIT=0`**，墙钟 **1 363 235 ms**；`4715 passed, 0 failed（共 4715）` + fixtures `46 passed, 0 failed`；329 个 `Suite [...]` 行**无一条 `FAIL!=0`**，日志含 1 行 `[SKIP] suite real-chain：release-only` |
| `node scripts/check-plan-version.mjs` / `git diff --check` / LF | PASS / 干净 / 20 个改动·新增文件 crlf=**0** |

**基线对账（最终）**：04855bf5 是 4707 passed；本笔 **4715 = 4707 + 8**——OWN-T1/T2/T3/T4/T6/T7 六条
+ `phase-evidence-manifest` 的 OWN-T5 + `standalone-coding-review` 的 D0.3b。
`real-chain` 的 2 例照旧不计（release-only 不执行），单跑 **PASS=2 FAIL=0 / 66 363 ms**。
不打包、不提交、未碰宿主。

### 8.10 codex 第三轮返修（1 裁定 + 4 项，全部落地）

#### 裁定：`package_path` 内即算源码那条 OR 分支是**放宽生产判据迁就错配夹具** —— 已删

裁定理由核实属实：生产检查直接按模块根读 `<package_path>/oh-package.json5`
（`profiles/hmos-app/harness/coding-host-rules.ts` / `profile-path-conventions.ts`），
模块根下本就常驻非源码文件——拿目录当源码判据会把 README / 清单一并归给实现阶段。
§8.9 里「放弃的准确性：模块包路径内的非源码文件仍会拿到 owner」那段**不再存在，也不再需要**：

- **判据只剩一条**：profile 声明的源码后缀，`.` 归一 + **大小写敏感** `endsWith`，与
  `check-coding.ts:718` / `correction-commands.ts:483` 逐字同法。并集两侧同过，无兜底、无残余面。
- **P1-T12 的红是夹具与 profile 错配，不是判据太严**：该夹具声明 `hmos-app`
  （`sourceFileSuffixes: ['.ets']`）却把写集写成 `src/demo/value.ts`。
  修的是夹具：新增 `frameworkDeclaringTsSources()`——除 `profiles/` 外整套 framework 目录
  junction 回仓，`profiles/hmos-app` 只放原样拷贝的 `profile.yaml` 与两个 shim
  （`coding-host-rules` 复用仓内真实 host、仅把 `sourceFileSuffixes` 换成 `['.ts']`；
  `profile-path-conventions` 整份转发），在 P1-T12 内以一行局部 `frameworkRoot` 遮蔽生效。
  **生产 profile 一个字没动，P1-T12 的断言也一个字没动**（35/0）。
- **OWN-T7 补齐模块目录反例**：新增 `src/demo/src/main/README.md`（**在**模块包路径内、
  也在 `src/main` 内），与 `doc/research-notes.md` 一起既进 `contracts.files` 又进
  `source_code_paths`；两条都断言无 owner，且各自改动后即便声明 `pendingOwnerPhase: 'coding'`
  证据仍 `stale`（每轮改完还原，保持单变量）。
- **变异 M10**（整条后缀筛删掉）→ `phase-closure-finalizer` **PASS=25 FAIL=3**
  （OWN-T2 / OWN-T6 / OWN-T7），报文点名到具体路径。

#### 措辞残留（第 5 项）已改准

`phase-closure-finalizer.unit.test.ts` 的 OWN-T6 注释与 `openspec .../proposal.md` 里
「与 `recoverPartialPublication` 是同一份权威身份」的说法删除，统一为：
**身份取自正在闭环的那份 canonical summary 的 `run_id`**（由产出它的 harness 轮次写下），
goal 恢复路径进闭环之前 receipt 已带 goal 身份校验过。

#### OpenSpec（第 4 项）

`skill-contracts` delta 删掉模块目录兜底条款，改为「源码判据 MUST 复用 profile 声明的源码后缀
（大小写敏感，与实现检查同法），不另立路径表，也 MUST NOT 以『落在模块包路径内』兜底」；
非源码 Scenario 的 WHEN 补「含落在模块包路径内的那种」。proposal / tasks 同步。

#### 返修后验证

| 门 | 结果 |
|---|---|
| `cd harness && npx tsc --noEmit -p tsconfig.typecheck.json` | 退出码 **0** |
| `--filter phase-closure-finalizer` | **PASS=28 FAIL=0** |
| `--filter standalone-coding-review` | **PASS=35 FAIL=0**（P1-T12 断言一字未改） |
| `--filter context-facts` / `--filter execution-scope` | **22/0** / **114/0** |
| `--filter check-receipt-policy` / `--filter phase-evidence-manifest` | **22/0** / **21/0** |
| `real-chain` 正例 | **PASS=2 FAIL=0，66 679 ms**；六阶段 PASS + closed |
| 真实链归属复核 | spec/plan `.ets` 5/5、coding 12/12 带 `owner_phase=coding`；review/ut/testing 0 个；**六份 manifest 里带 owner 的非 `.ets` 条目为 0** |
| 变异 M10 | `phase-closure-finalizer` **25/3**（OWN-T2 / T6 / T7） |
| `npx openspec validate --all --strict` | **47 passed, 0 failed** |
| 全量 `cd harness && npm test` | **`NPM_TEST_EXIT=0`**，墙钟 **1 361 045 ms**；`4715 passed, 0 failed（共 4715）` + fixtures `46 passed, 0 failed`；329 个 `Suite [...]` 行**无一条 `FAIL!=0`**，日志含 1 行 `[SKIP] suite real-chain：release-only` |
| `check-plan-version` / `git diff --check` / LF | PASS / 干净 / crlf=**0** |

**最终基线对账**：04855bf5 是 4707 passed；本笔 **4715 = 4707 + 8**——
`phase-closure-finalizer` 的 OWN-T1/T2/T3/T4/T6/T7 六条 + `phase-evidence-manifest` 的 OWN-T5
+ `standalone-coding-review` 的 D0.3b。`real-chain` 的 2 例照旧不计（release-only 不执行），
单跑 **PASS=2 FAIL=0 / 66 679 ms**。不打包、不提交、未碰宿主。

### 8.11 codex 第四轮（判"无阻断、可提交"，只剩 1 条 P3，已修）

**P3：`frameworkDeclaringTsSources()` 造的 `p4-fw-ts-*` 临时 framework 目录没人清。**
它落在独立 tmp 下、且带一圈 junction，而 P1-T12 原本没有 `finally`，套件末尾的清理只管 `f.root`
——成功和失败都会遗留目录与链接。已把 P1-T12 的整段主体包进 `try { … } finally { removeShimFramework(frameworkRoot); }`
（只加缩进与包裹，**断言正文一字未改**），清理函数**先摘 junction 再删目录**
（`fs.rmSync(recursive)` 本就不跟进链接，先摘最稳；摘不掉的回落 `rmdirSync`），
清理自身的异常一律吞掉，不盖过用例结论。

| 门 | 结果 |
|---|---|
| `cd harness && npx tsc --noEmit -p tsconfig.typecheck.json` | 退出码 **0** |
| `--filter standalone-coding-review` | **PASS=35 FAIL=0** |
| tmp 残留（成功路径） | `p4-fw-ts-*` **0 个**（跑前先把历史遗留的 4 个删净，跑后仍为 0） |
| tmp 残留（**失败路径**，受控注入 `throw` 后跑一轮再撤回） | 套件如期 **PASS=34 FAIL=1**（`Error: CLEANUP PROBE`），`p4-fw-ts-*` 仍 **0 个**——`finally` 在失败路径同样生效 |
| 仓内目标复核（junction 清理不得误删真目录） | `specs` 12 项、`profiles/hmos-app/harness` 94 项、顶层目录齐全，`git status` 无额外改动 |
| `git diff --check` / LF / `check-plan-version` | 干净 / crlf=**0** / PASS |

按指令**未跑全量**（本笔只动这一个测试文件的清理与缩进，生产代码一字未动；上一轮全量收口
`NPM_TEST_EXIT=0 / 4715 passed / fixtures 46` 仍是该生产快照的收口数）。不提交。

### 8.12 提交

**已提交 e128e07f**（codex 四轮 review 判可提交；收口数：unit **4715 passed / 0 failed**、
fixtures **46 / 0**、release-only 正例 `real-chain` **PASS=2 FAIL=0**）。
宿主验收（frontmatter `real_host_validation`：bc-openCard-2/open-card-flow-v2 同 feature 重跑 1.2 出生链）
**未做**，留宿主侧执行。

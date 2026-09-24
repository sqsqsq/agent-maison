---
name: coding 越界集合承接 UT 产出（真实链路回灌）
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g6-change-unit-feature-pipeline-integration
  - g8-real-host-development-and-governance
relation: core
layer: change-unit
goal_requires:
  - pre-release-real-chain-regression
goal_provides:
  - coding-scope-ut-output-handoff
real_host_validation: >
  宿主下一轮出现「UT 在本 run 新建测试文件（基线里没有）→ testing 或 UT 回退 coding」时，回退后的
  coding 不再因该测试文件判 diff_within_scope 越界、不再同签名 no_progress_guard 停机；coding 若在
  回退轮自己改写该测试文件，仍 FAIL 并列出该路径。bc-openCard-2 当前没撞（测试文件在基线里已存在），
  本 plan 不以它为收口证据。
parallel_authority_added: false
overview: >
  plan 14771034 RC-9 在真实 goal runtime 上撞出：testing→coding 回退后，coding 的 diff_within_scope 把
  ut 阶段自己新建的测试文件判越界（run 基线累计 diff，不看写者），UT 文件列不列进 contracts.files
  都有一轮过不去。修法只收窄归属：runtime 已在每次调用前后逐文件哈希，把 UT 调用写自己测试根的
  那部分（今天分类为 allowed 后丢弃）随既有 phase_write_observed 事件落下；check-coding 只从
  「模块内、不在 contracts.files」的越界集合里扣除「本 run UT 调用产出、此后无他阶段改写、当前字节
  仍等于产出字节」的具体文件。run 基线、contracts 权威、模块越界一律不动。不写代码，待 review。
todos:
  - id: cso-fix
    content: 按 §3 落生产修复（分类带出 UT 自有源码写 → 随既有事件落盘 → check-coding 扣除；observations 落盘不截断），补 §4 单测 U1–U6/R1/W1 与 phase-write-boundary 规格。
    status: completed
  - id: cso-real-chain
    content: 按 §4.2 在正式修复上登记 RC-9、补 RC-9b（UT→coding），重跑 14771034 C2 变异 ③④，结果回写 14771034 §9 与本 plan §8。
    status: pending
  - id: cso-validation
    content: 按 §6 迭代目标套件、全量收口一次，结果记 §8。
    status: in_progress
---

# coding 越界集合承接 UT 产出（真实链路回灌）

> 需求输入：调度者 2026-09-24 派发；缺陷记于 [宿主语料四条真实路径进 real-chain](宿主语料四条真实路径进real-chain_14771034.plan.md) §9.3/§10.1，
> codex 裁定属实、P1、须短 plan。代码基线：main 844606b3（工作树另有 verifier 模板对齐批与 14771034 T0–C2，未提交）。
> 三档：归属误判属**第二档**——修归属，不撤范围写保护（[判定分级](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §1.1）。
> 相关前序：[6f2a9c41](阶段输入与证据归属修复_宿主开卡回灌_6f2a9c41.plan.md) §3.3「UT 修改本阶段测试不应使 coding 失效」；
> [b5c1e9d7](goal闭环owner归属贯通_真实链路回灌_b5c1e9d7.plan.md) §3/§7.4「归属只改账本，不扩写权，`check-coding` 不因归属放宽」。

## 1. 缺陷与证据

| # | 位置 | 事实 |
|---|---|---|
| 1 | `check-coding.ts:337-342` | 现代分支：`diffChangedFilesWithStatus(run 基线)` → 两端路径（`:339` 含 `oldPath`）→ `classifyChangedFiles` → 越界 = 模块外 ∪「模块内且不在 `closure.authorized_files`」。不读阶段、不读调用前后写入 |
| 2 | `git-diff.ts:353-382` | `git diff --name-status -M -z <base>` + 未跟踪文件记 `A`：run 内**任何阶段**的新增都在集合里 |
| 3 | `goal-run-creation.ts:203-217` | run 基线出生冻结（或首条含 coding/ut 的修订冻结），回退不重置 |
| 4 | `check-coding.ts:81-84` | `file_completeness` 要求 `contracts.files` 每项存在 → 把 UT 文件预列进 contracts，首轮 coding 判缺 |
| 5 | RC-9 实跑（14771034 §9.3） | attended + detached 同样复现：testing→coding 回退后 coding 写了 id 仍 FAIL `diff_within_scope`，越界清单恰为 `…/src/ohosTest/ets/test/AllBanksPage.test.ets`（ut 本 run 新建）；同签名二轮 `no_progress_guard` halt，RC-9 ④⑤⑥ 未到达 |
| 6 | 单变量（同 §9.3，已还原） | 只把 profile 测试路径从 `:342` 剔除 → RC-9 七条全过（141.6/148.5 s）。**该补丁即被 codex 否决的 (a)，见 §3.4** |

同根路径（均为「UT 已在工作区留下新测试文件 + 之后再进 coding」）：UT→coding（`repair-candidates.ts:600-632`
`ut_product_assertion_failure`，UT 未闭环即回退，**最早撞**）；review→coding（第二轮起工作区已有 UT 产出）；
testing→plan→coding（基线不重置）。宿主 `bc-openCard-2` 没撞只因两份测试文件在基线里已存在。

## 2. 越界集合与写归因现状

| 谁 | 何时 | 算什么 | 消费点 / 去向 |
|---|---|---|---|
| `check-coding` `diff_within_scope` | coding 的 agent 自检与 runtime gate | run 基线→工作区累计差异的越界集合（§1 #1） | BLOCKER FAIL → `scope_violation` |
| `resolvePhaseWriteBoundary`（`phase-write-boundary.ts:226-255`） | 每次调用前（`goal-phase-runtime.ts:6993-7003`） | UT 根（`resolveUtSourceRoots`，`profile-path-conventions.ts:8-13`）归 `ut`；coding 模块前缀归 `coding` 且 `excludedPrefixes` = UT 根 | 调用前后快照的归属表 |
| `capture/diffPhaseInvocationSnapshots`（`:362-454`） | 调用前（`goal-phase-runtime.ts:7387`，attended/detached 共用 `executeExecutor` `:7534`）与调用后（`:7832`） | 逐文件前后 sha256，只归本调用 | `classifyPhaseInvocationChanges` |
| `classifyPhaseInvocationChanges`（`:478-513`） | 同上 | `allowed`（本阶段唯一 owner）/ `violations`（他阶段 artifact 域）/ `observed`（`deferred_to_checker` 或 `unattributed`） | `observed` → `phase_write_observed` 事件（`goal-phase-runtime.ts:7869-7892`）；`violations` → 回退；**`allowed` 丢弃，不落任何记录** |

结论：「UT 调用写了自己测试根里的 X，写后字节 H」这件事 runtime 当场算出来了（`allowed` 带 `postSha256`），
但没有持久化，check-coding 事后无从区分写者；coding 在自己调用里写 UT 根则被分类为 `observed(owner=ut, deferred_to_checker)`
（`phase-write-boundary.unit.test.ts:165` 锁定）——即把裁决**交给** check-coding，而 check-coding 恰恰不看写者。

## 3. 修法

### 3.1 事实产出：随既有事件落下 UT 自有源码写（runtime，调用后、gate 前）

- `classifyPhaseInvocationChanges` 已对每条 change 求 `resolvePhasePathOwnership`；让 `allowed` 条目保留该 ownership（与
  `observed` 同形），不新增判据。
- `goal-phase-runtime.ts:7869` 同一处：`phase === 'ut'` 时，取 `allowed` 中 `roles` 含 `kind:'source'` 的条目，以
  `owned: [{path, how, pre_sha256, post_sha256}]`（不截断，缺一条只会回到今天的 FAIL）挂进**同一个** `phase_write_observed`
  事件；事件发出条件由「`observed` 非空」放宽为「`observed` 或 `owned` 非空」，`observations` 为空时写 `[]`。
- **作废侧同样完整落盘**：同处 `observations: classifiedWrites.observed.slice(0, 50)`（`goal-phase-runtime.ts:7878`）取消落盘截断，
  `observed_count` 保留；只在展示层（日志/诊断文案）截断。否则反例成立：coding 两次调用先改测试文件、再恢复 UT 字节，该路径两次都排在
  第 51 条以后 → 作废事实没落盘、最终字节又匹配 → 错误承接。只让 `owned` 不截断不够（§4.1 R1）。
- 只记 UT：它是唯一消费者（§3.2）要的事实；coding 自己的 allowed 写不落（不扩成全量写账）。
- 覆盖 UT 未闭环就回 coding：事实在**调用后、gate 前**产出，与 UT verdict、UT manifest 是否闭环无关；UT 阶段内多次调用逐次追加。

### 3.2 事实消费：check-coding 只扣「可归属 + 字节匹配」的具体文件

- `phase-write-boundary.ts` 新增一个纯函数：按事件顺序回放本 run 的 `phase_write_observed`——`phase==='ut'` 的 `owned` 条目
  置 `path → post_sha256`（`removed` 为 `null`）；**任何其它阶段**的 `observations` 命中同一路径即作废该路径的事实（「UT 产出后
  被他阶段改写」）。返回 `Map<path, sha|null>`。
- `check-coding.ts:342`：`classified.violations`（模块外）**原样保留**；只对 `inScopeHits.filter(!authorized)` 这一半，扣除满足
  「Map 有该路径 且 值 === 当前工作区状态（sha256 或不存在=null）」的文件。重命名两端（`:339`）各自独立判定。
- 事件来源：仅 `runId` 且 `authority.source === 'run'` 时，用 `loadAuthoritativeRunEvents(projectRoot, feature, runId)`
  （`goal-run-creation.ts:221`，同文件 `resolveEffectiveScopeSource` 已在读同一份事件）。无 run（交互态 / feature 权威）→ 空 Map → 行为不变。
- FAIL 的 details 对曾有 UT 事实但未承接的路径附一句原因（字节已变 / UT 产出后被 `<phase>` 改写），便于回修，不改判定。
- 先例：`goal-run-creation.ts:415-429` 已按 `phase_write_observed.observations[].post_sha256` 回放「最后已知字节」判修复是否发生——
  同一事件、同一字段语义、同一「当前字节 vs 记录字节」比较。

### 3.3 为何不是新机制

不新增事件类型、文件、owner 表、开关；归属仍由写边界既有解析器当场派生（`owned` 只是 `allowed` 不再丢弃），落在 runner 已有的
run 内事件；消费点是已在读同一事件流的 check-coding。规格 `phase-write-boundary/spec.md:29` 的「No persistent pass snapshot」
禁的是持久 PASS 快照与场外归属状态（codex 一轮裁定），本条只随调用增量记录 UT 自有写，与既有 `observations` 同形；规格补说明（§6）。

### 3.4 否决的方案（codex 裁定边界，写作约束）

- **(a) 越界集合无条件剔除 profile 测试路径**：coding 真新增 UT 文件时 runtime 只 `observed/deferred_to_checker`（`phase-write-boundary.ts:499`，
  单测 `:165`），无别的门兜底；且 hmos 正则含任意 `/test/`（`profile-path-conventions.ts:5`），比当前模块 UT 根宽。
- **(b) 只查 owner_phase / 已闭环**：owner 只从 contracts 与研究来源产生（`capability-resolution-entry-input.ts:458`），新测试不在其中；
  PASS 检查的 `affected_files` 进 manifest 只作 `extraInputs`、不补 owner（`phase-closure-finalizer.ts:243/309`）；只按路径豁免放过 coding 对
  旧 UT 产出的再改写；「只认已闭环」覆盖不到 UT→coding。
- **UT 目标解析作归属证明**（`check-ut.ts:4346-4361` → `ut-file-scope.ts:113-136`）：`scoped` = git 工作区变更测试 ∪ context 声明，
  coding 写的也在内；无线索时 `fallback:all`（`:134`）。它回答「本需求该测哪些」，不回答「谁写的」——不用。
- **UT manifest 输出哈希作事实**（`phase-evidence-manifest.ts:71`）：UT→coding 时 UT 未闭环、无 manifest；coding 改产品后整份 UT manifest
  必 stale（`:945`），而承接不得要求它 fresh。——不用。
- **contracts.files 预列 UT 文件 + file_completeness 跳过测试根**：等于把写权授给 coding，违反「coding 自写测试不得豁免」；不得顺手「跳过测试根」。预列本身的问题另登记（§7.2）。

## 4. 反例与测试落点

### 4.1 单测（经生产 `coding.check`；事件经 §3.1 同一分类函数从真实写入产出，写入同一 run 的 events.jsonl）

落点 `standalone-coding-review.unit.test.ts`（`:227-243` 同址，已有 run + git + 真实 check-coding）；fixture profile 无 UT 根约定时
照 `real-chain-host.ts:163-169` 先例补。生产者侧落点 `phase-write-boundary.unit.test.ts`。

| id | 构造 | 期望 | 锁住什么 |
|---|---|---|---|
| U1 | UT 调用窗口内新建测试文件 → `owned` 事实；字节不动 | `diff_within_scope` PASS | 承接正例（首轮 coding 不列该文件，`file_completeness` 不受影响） |
| U2 | U1 后改该文件字节 | FAIL，列出该路径 | 字节锁 |
| U3 | U1 后一次 coding 调用改该文件（落盘 `observed owner=ut`），**下一次**调用写回 UT 原字节 | 持续 FAIL，直到 UT 再次调用产出新事实 | 归属锁（与字节锁互相独立）。**边界**：同一次调用内改后又恢复原字节，前后快照判 clean（`phase-write-boundary.ts:437`），不可见——接受净差异口径，不加文件操作监控，不承诺「任何写过都能发现」 |
| U4 | 无 UT 事实的测试根新文件（coding 首轮自写 / 事实只在**别的 run** 的 events） | FAIL | coding 自增测试、跨 run 不承接；不用 `fallback:all` |
| U5 | U1 事实在场 + 模块内未授权产品源码（`:237-240` 原例）/ 模块外业务文件（该路径**也带**字节匹配的 UT `owned` 事实——生产分类器不会对模块外路径产 `owned`，此条按事件形状手写，只为让 M4 可证伪） | 均 FAIL | 模块越界与未授权产品源码照拦 |
| U6 | 基线测试文件经 UT 改写（事实 H）后：① 被删；② 被移出测试根（`R` 两端）；③ 对照：UT 自己在根内改名（旧端事实=删除、新端事实=H） | ①② FAIL（旧端当前不存在≠H，新端无事实）；③ PASS | 删除 / 移出不承接，重命名两端各自判定 |
| R1 | **经 runtime 生产事件序列化**（`goal-runner-testing-integrity` 的 `runGoalRuntimeChain`）：UT 桩新建测试文件；coding 桩两次调用（首次 gate 桩 FAIL 触发同阶段重试）——第一次额外写 ≥50 个排序在前的 observed 文件并改目标文件，第二次恢复 UT 原字节 | 事件里目标路径的 observation 在场、`observations.length === observed_count`；对该 run 事件跑 §3.2 回放函数，目标路径事实已作废 | 作废侧不截断（去掉 §3.1 的取消截断即红） |
| W1 | `phase-write-boundary` 分类：UT 调用写 UT 根 → `allowed` 带 `source` role；coding 调用写同一路径 → 仍 `observed/deferred_to_checker`（`:165` 原断言不改） | — | 事实只可能来自 UT 调用 |

### 4.2 真实 goal runtime（real-chain-seams，release-only）

- **RC-9**（testing→coding，`real-chain-seams.unit.test.ts:945` 已写）：七条判据原样，在正式修复上全过后在 `runAll` 前登记。
  另断「承接不免 UT 重验」：回退后 UT 有新 `phase_start` 且其闭环晚于 coding 次轮闭环（不要求旧 UT manifest fresh）。
- **RC-9b**（UT→coding）：UT 执行替身（`real-chain-host.ts:172-188`）`checkUtHvigorTest` 按产品源码字面判 `FAIL classification=code_regression`
  （与 `device-test-run.js` 渲染规则同法，测试基建、零生产改动），UT verifier 报告文本给 `end_to_end_driving`/`business_assertion_value` PASS；
  coding 仅在本 run 已有 `phase_backtrack_requested from_phase=ut to_phase=coding` 后写对。判据：候选 `ut_product_assertion_failure`
  category=coding；回退后 coding PASS（无 `diff_within_scope` FAIL）；UT 重跑 PASS+closed；六阶段终局 PASS+closed。**先做可行性实验**
  （同 14771034 T0 纪律），替身不足以触发时如实记为未覆盖，不改生产凑。RC-9b 实验**不阻塞**生产修复开工。
- review→coding、testing→plan→coding 不单列用例：同一事件回放、同一扣除，差别只在回退入口（§5 放弃的准确性）。

### 4.3 变异（改源仓生产文件、实跑后还原）

M1 去字节比较 → U2 红；M2 去「他阶段改写作废」→ U3 红；M3 runtime 不发 `owned` → RC-9、RC-9b 红（coding 停机）——U1 由分类器
产出事实后自行写事件、不经 runtime，**不保证**被 M3 杀；M4 扣除扩到 `classified.violations` → U5 红（U5 的模块外路径须**同时**带匹配的
UT 事实，否则证明不了模块外保护），改成按 profile 测试正则扣除 → U4 红；M5 恢复 observations 落盘截断 → R1 红。另在正式修复上重跑 14771034 C2 变异：
③ `invalidatedBt` 只留目标阶段 → RC-9 红于 ②；④ 去 b5c1e9d7「owner 已闭环且输出新鲜」承接 → RC-9 回退前即红（预期按 14771034 §10.3-4 实测口径）。

## 5. 保留 / 裁剪 / 不做

- 保留：run 基线（不重置）、contracts 权威（coding 不自扩 `contracts.files`）、模块越界、`file_completeness`、写边界分类的
  `violations/observed` 语义与 `:165` 断言、UT 回退重验（`goal-phase-runtime.ts:9835` 作废窗口）、b5c1e9d7 的归属承接判据。
- 裁剪：`allowed` 不再丢弃（仅 UT 源码域进事件）；无新文件、无新事件类型、无新开关。
- 不做：通用跨阶段硬门；交互态（无 run、无调用快照）承接——无事实来源，行为不变，用户在阶段间提交或设 `HARNESS_DIFF_BASE_REF`
  即不撞（**放弃的准确性**：goal/普通模式在此点不对称）；gate 期（调用窗口外）harness 写 UT 根的文件——无事实，回到今天的 FAIL；
  `resumePostAgent` 跳过快照的那次调用不产新事实（此前已落盘的有效事实照常复用）；coding 删除「UT 本 run 新建」的文件不在 diff 内、不被本门看见（既有行为，UT 重跑会重建）。

## 6. 验证与提交划分

- 迭代（`harness/`，一条命令一个 `--filter`，输出先落日志再 grep）：`npm run typecheck`；`--filter phase-write-boundary`；
  `--filter standalone-coding-review`；`--filter goal-runner-testing-integrity`（R1；事件发出条件变化，`:1797/1828/2492/2520` 用
  `.find(type==='phase_write_observed')` 取首条——定位一律收窄到 `phase==='testing'`，断言内容不变）；
  `--filter goal-run-birth-contract`（`observations` 消费方）；`--filter adjudication`（`:613` 源码正则）；`--filter real-chain`；
  `npm run openspec:validate`。
- 收口一次：`cd harness && npm test`；`node scripts/check-plan-version.mjs`；`git diff --check`；node 逐字节扫 LF。
- 规格：`openspec/specs/phase-write-boundary/spec.md` 第二条 Requirement（`:29`）补说明——该句禁的是持久 PASS 快照与场外归属状态，
  不禁 run 内按调用增量记录的事实；UT 调用的自有源码写随观察事件记录前后哈希，observations 完整落盘；它不授予任何写权，coding 范围门
  仅据此扣除字节未变且无他阶段改写的 UT 产出。补一个 Scenario（UT 新建测试 → 回退 coding 原字节承接；coding 改写后不承接）。
- 提交（均不 commit，待调度者；工作树按归属分拣）：笔一 `phase-write-boundary.ts` + `goal-phase-runtime.ts` + `check-coding.ts` + 规格 + U1–U6/R1/W1
  （+ 必要的 `.find` 定位收窄）；笔二 并入 14771034 C2（`device-test-run.js`、材料、seams 的 RC-9 登记 + RC-9b + UT 替身），
  C2 变异 ③④ 结果回写 14771034 §9。

## 7. 风险与拿不准

1. **承接可否被 coding 伪造**：两重锁——归属事实只由 runtime 在 UT 调用窗口外侧产出（agent 进程不经手分类），字节必须等于该事实；
   coding 在自己窗口写 UT 根只会产生作废事实的 `observed`。残余面：agent 直接改写 `goal-runs/**/events.jsonl`（快照有意排除 runner 路径，
   `phase-write-boundary.ts:345-351`；events 写者不验证）——与 6279fcd7 §8 同一非密码学边界，按协作可恢复信任模型接受、不加签名。
   窗口内自检时本次调用的 `observed` 尚未落盘，只有字节锁生效；runtime gate 时两锁俱全。归属锁是**净差异**口径（U3 边界）。
2. **登记的既有独立缺陷（本笔不修）**：`contracts.files` 预列 UT 文件时，`check-coding.ts:82` 无条件要求存在，与 `skill-contracts/spec.md:62`
   （允许后继阶段创建的授权产出）及 `capability-resolution-entry-input.ts:399` 不一致。本 plan 只让「不列」走通；「列了」留待另起。
3. **只记 UT**（codex 裁定成立）：事件量与既有断言扰动最小、贴唯一消费者；代价是 runtime 多一个 `phase==='ut'` 条件。
4. **预算**：RC-9 ≈ 140–150 s（已实测）、RC-9b 估 110–130 s（未实测），两者只进 release-only 发布门。

## 8. 实施记录

（顺序：§3.1 必改 → 生产修复 + 单测 + 规格 → RC-9/RC-9b/C2 变异 ③④ 归 14771034 C2。）

### 8.1 笔一（2026-09-24，基线 main 0f10dd56，未 commit）

**生产**
- `harness/scripts/utils/phase-write-boundary.ts`：`classifyPhaseInvocationChanges` 的 `allowed` 条目带 ownership（与 `observed`
  同形，判据不变）；新增纯函数 `replayUtOwnedWrites(events)`——按序回放 `phase_write_observed`：`phase==='ut'` 的 `owned` 置
  `path → post_sha256`（removed 为 `null`，只收 64 位 hex/null）；任何事件的 `observations` 及 `phase_write_violation.violations`
  命中已有事实即标 `voidedBy=<该事件 phase>`；之后 UT 再写同路径则重置为新事实。
- `harness/scripts/goal-phase-runtime.ts`（原 :7869）：`phase==='ut'` 时取 `allowed` 中带 `source` 角色的写，以
  `owned:[{path,how,pre_sha256,post_sha256}]` 挂进同一 `phase_write_observed`；发出条件放宽为 `observed` 或 `owned` 非空
  （`owned` 为空时不写该键，其余阶段事件字节不变）；`observations` 取消 `.slice(0, 50)`，`observed_count` 保留。
- `harness/scripts/check-coding.ts` `diff_within_scope` 现代分支：`runId && authority.source==='run'` 时
  `replayUtOwnedWrites(loadAuthoritativeRunEvents(...))`；只对 `inScopeHits` 中未授权的那一半，扣除「有事实 ∧ 未作废 ∧ 当前字节
  （不存在=null）=== 事实」的路径；`classified.violations`（模块外）原样；重命名两端本就各自进 `files`，逐端判。FAIL details 对有事实
  却未承接的路径追加「UT 产出后字节已变 / UT 产出后被 <phase> 改写」，`affected_files` 与判定不变。
- `harness/scripts/utils/goal-run-creation.ts`：`currentFileHash` 改为 export（复用 :415 先例的同一「当前字节」口径）。

**规格**：`openspec/specs/phase-write-boundary/spec.md` 第二条 Requirement 补说明（禁令指持久 PASS 快照/场外归属状态，不含 run 内
按调用记录；observations 完整落盘；UT `owned` 不授写权，coding 门只据此扣除字节未变且无后续观测/越权的 UT 产出；模块外/基线/契约不动）
+ Enforcement 补 `harness/scripts/check-coding.ts` + 新 Scenario「UT 新建测试回 coding 原字节承接；后续调用改写即使恢复字节也不承接，
直到 UT 再记」。

**测试映射**
| id | 落点 | 说明 |
|---|---|---|
| W1 | `phase-write-boundary.unit.test.ts` 新 case | UT 调用写 UT 根 → `allowed` 带 source 角色与 post hash；同一 diff 按 coding 分类 → observed/deferred；`:165` 原 case 未改 |
| U1 | `standalone-coding-review.unit.test.ts` | 对照：无事实同文件 FAIL；UT 调用产出后 PASS；`contracts.files` 未扩、`file_completeness` PASS；coding 调用改产品后仍 PASS（不要求旧 UT manifest fresh） |
| U2 | 同上 | UT 产出后直接改字节 → FAIL 列路径，details 含「字节已变」 |
| U3 | 同上 | coding 调用改写（落盘 observed）→ 下一次 coding 调用恢复 UT 原字节 → 仍 FAIL（details「被 coding 改写」）；UT 再写新字节 → PASS |
| U4 | 同上 | coding 调用自写测试（只有 observed）→ FAIL；事实只在别的 run 目录 events → FAIL |
| U5 | 同上 | UT 事实在场 + 模块内未授权产品源码 → FAIL 且 `affected_files` 恰为该文件；模块外 `src/other/outside.ts` 带手写字节匹配 `owned` → FAIL 且恰为该文件 |
| U6①②③ | 同上（夹具新增 `baselineTest` 选项把 `Base.test.ets` 放进基线提交） | UT 改写基线测试后被删 → FAIL；移出测试根 → 两端 FAIL；UT 在根内改名 → PASS |
| U6④ | 同上（**新增**，plan 未列） | UT 改写后由 coding 调用改名（旧端删除+新端新增）→ 两端 FAIL，details「被 coding 改写」——锁「coding 自删/自改名测试不豁免」 |
| R1 | `goal-runner-testing-integrity.unit.test.ts` | 经 `runGoalRuntimeChain` 生产事件序列化：UT#1 新建 `z-target.test.ets` → testing#1 must_fix 回 coding → coding#2 在同一 UT 目录写 `a000…a049` + 改 target（gate 桩 FAIL）→ coding#3 恢复 UT 原字节。断：UT 事件 `owned` 含 target；首个 `observed_count>50` 的 coding 事件 `observations.length===observed_count` 且 target 索引 ≥50；盘上字节=UT 原字节；`replayUtOwnedWrites` 判 `voidedBy==='coding'` |
| — | 同文件 :1797/:1828/:2492/:2520 | `.find(type==='phase_write_observed')` 收窄为 `&& e.phase==='testing'`，断言内容不变 |

**反例清单对照**：模块内未授权产品源码/模块外业务文件仍 FAIL=U5；首轮 coding 不列 UT 文件不失败、UT 新建后回 coding 原字节承接=U1；
coding 自增/改/删/改名测试不豁免=U4(增)/U2·U3(改)/U6④(删+改名)，首轮与回退轮在判定上同一路径（只看事件序列，不看轮次）；测试根内不属本 run
的文件不承接=U4 跨 run + U1 对照；UT 产出被删/改/移出=U6①/U2/U6②；coding 修产品后承接不要求整份旧 UT manifest fresh=U1 末段，
「承接仍要 UT 重验」属 RC-9 判据（笔二）。

**变异（改生产文件→跑目标套件→cp 备份还原并 cmp 确认）**
| id | 改动 | 结果 |
|---|---|---|
| M1 | check-coding 去字节比较（`!fact.voidedBy` 即扣除） | standalone 41/3：U2、U6①、U6② 红 |
| M2 | replay 不消费 `observations` 作废 | standalone 42/2：U3、U6④ 红 |
| M3 | runtime 不发 `owned`（`phase==='ut'` 条件恒假） | integrity 83/1：R1 红于「UT 调用须随事件落 owned」；U1 不经 runtime，按 plan 校准不期望被杀；RC-9/RC-9b 部分归笔二 |
| M4a | 扣除扩到 `classified.violations` | standalone 43/1：U5 红 |
| M4b | 改为按 `/src/ohosTest/` 正则扣除 | standalone 37/7：U4 红（U1 对照、U2/U3/U6①②④ 同红） |
| M5 | 恢复 `observations.slice(0, 50)` | integrity 83/1：R1 红于「observations 须完整落盘：50 vs 51」（其后 target 缺席→回放未作废亦红，首断言先触发） |

**验证（迭代期，日志先落盘再 grep）**：typecheck exit 0；phase-write-boundary 9/0；standalone-coding-review 44/0；
goal-runner-testing-integrity 84/0；goal-run-birth-contract 20/0；adjudication 55/0；`npm run openspec:validate` 47 passed +
enforcement PASS；`--release --filter real-chain` 9/0（real-chain 3 + seams 6，正例全链 PASS+closed 不受影响）。全量收口见 8.2。

**与 plan 不同的取舍（放弃的准确性）**
1. 回放返回 `Map<path, {sha256, voidedBy?}>` 而非 `Map<path, sha|null>`：作废条目保留并标 `voidedBy`，供 FAIL details 写「被 <phase>
   改写」；「Map 有该路径」相应读作「有且未作废」。不放弃准确性。
2. 作废侧除 `observations` 外也消费 `phase_write_violation.violations`（调度 prompt 口径「observation/violation」）；violations 的落盘
   仍按既有 `.slice(0, 50)`（未改）。放弃的准确性：UT 根路径只有在同时落进某阶段 artifact 域时才会成为 violation，结构上几乎不发生；
   若单次调用 >50 条 violation 且其中含 UT 根路径排在 50 以后，该作废会丢失。按当前注册结构（分类要求唯一 owner 且有 artifact 角色，普通 UT 源码跨阶段修改走完整 observations，与其它 owner 的 artifact 重叠则成为多归属 observation；artifact 清单见 specs/artifact-schemas/inventory.yaml）未发现可达的第 51 条逃逸路径——该限定只对当前注册结构成立，不以"回退重验兜底"泛化。
3. 作废不区分作废者阶段（plan 写「其它阶段」）：UT 自己调用中的 observed（多归属）同样作废。更严，不放宽。
4. 当前字节复用 `currentFileHash`（跟随符号链接），快照对符号链接记链接文本哈希：UT 产出的符号链接**不保证承接**（实现未过滤 symlink——通常不匹配而回到今天的 FAIL；目标内容恰等于链接文本时可匹配，删除链接也可能以 null 承接）。
   放弃的准确性：不提供符号链接形态 UT 产出的承接保证，也不显式排除。
5. `owned` 仅在非空时写键（plan 未规定）；其余阶段事件字节与改前一致。
6. U6④ 为补反例清单「coding 删/改名测试」新增；U1 末段为补「不要求旧 UT manifest fresh」新增。夹具 `fixture()` 新增第二参 `baselineTest`，
   test-profile 照先例补 `profile-path-conventions.js`，经生产 `tryLoadUtSourceRootResolver` 加载。
7. U 系列的事件序列化在测试侧按 runtime 形状手写（plan 已接受）；runtime 序列化只由 R1 锁。

**登记（本笔不修）**：§7.2 `contracts.files` 预列 UT 文件时 `check-coding.ts:82` 无条件要求存在的既有缺陷，仍未修。

**未做（笔二）**：RC-9 登记 / RC-9b 实验 / 14771034 C2 变异 ③④。

### 8.2 笔一收口
`cd harness && npm test` 一次：typecheck + unit 4773/0 + fixtures 46/0，exit 0；`node scripts/check-plan-version.mjs` exit 0；
`git diff --check` 无输出；node 逐字节扫 9 个改动文件均 LF。todo：`cso-fix` → completed；`cso-validation` → in_progress（笔二的
real-chain 验证未跑）；`cso-real-chain` 保持 pending。

Review：codex 第一轮 1 阻断 + 4 建议，已改——observations 落盘不截断（§3.1、R1、M5）；U3 写明净差异边界（§4.1）；M3/M4 预期校准、
U5 模块外路径带匹配事实（§4.1、§4.3）；预列 UT 文件登记为既有独立缺陷、不跳过测试根（§3.4、§7.2）；RC-9b 不阻塞开工（§4.2）。
裁定成立：事实产出点、复用 `phase_write_observed` 加独立 `owned`、只记 UT、`spec.md:29` 补说明而非改禁令、扣除位置、伪造面接受、
resume 复用已有事实、四处取首条断言收窄到 testing。

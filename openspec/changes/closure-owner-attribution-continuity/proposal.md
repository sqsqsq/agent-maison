# closure-owner-attribution-continuity

## Why

`real-chain` 正例（确定性输入、真实 harness 六阶段）实跑出一条确定阻断：workflow 1.2 下
coding 只要按有效写集改过 spec/plan 读集里的产品源码，`post_agent` 授权门就判 plan closure
漂移，而范围修订此时已把 plan 移出链 → 无处回退 → `upstream_closure_gap` 停机。

这是**账本归属**这一档，不是产品真值：既有归属机制（`source_owners` → `owner_phase` →
`ownedOutputIsCurrent`）本来就是为这一态设计的，只是在 goal 路径上三处没接上。

- goal 的最终闭环调 `finalizePhaseClosure` 时不带 `factsContext`（子进程那份不外流、summary 也不落它），
  于是源码条目落成裸条目——真实宿主 `bc-openCard-2` 的 coding/review/ut manifest 同样一条 `owner_phase` 都没有。
- 授权门的新鲜度重算不知道「当前 owner 正在施工」，既有 `pendingOwnerPhase` 承接没人传。
- 观察期（出生链只有 spec/plan）研究源码拿不到下游施工归属：归属集合只遍历 `contracts.files`
  （spec 跑在 contracts 产出之前，该集合为空），资格判据也不覆盖「义务在、owner 阶段还没进链」。

## What Changes

- **goal 的最终闭环按仓内冻结事实重建调用上下文**：`publishEvidenceBinding` 在 `factsContext`
  缺失时调**既有**入口 `resolveCapabilityResolutionEntryInput`（与子进程同一个函数、同一份冻结范围 /
  phase contract 1.1 / `context/facts.md`），goal 路径的 manifest 形状与非 goal 路径收敛为同一种。
  run 身份优先取调用方透传的 `goalRunId`，缺省回落**正在闭环的那份 canonical summary 的 `run_id`**
  （由产出它的 harness 轮次写下，就是这份证据自己的 run 身份；goal 恢复路径进闭环之前，
  receipt 已带 goal 身份校验过）。因此 `--sync-closure` / 恢复闭环这条不传 `goalRunId` 的入口
  同样产出归属，而 `goalRunId` 同时承担的 requirement 血缘强制门触发条件一字不动。
  重建失败即退回今天的行为并披露一行，不引入新失败面。
- **授权门显式传当前 owner**：`checkPlanAuthority` 加可选入参并沿 `executionScopeEvidenceIssues`
  透到两处新鲜度重算，落成既有 `pendingOwnerPhase`。语义不变——只有「条目 owner 就是当前正在跑的
  阶段」才承接；终局 completion 的血缘检查与其它非施工时刻的消费点不传。
- **归属集合对称 + 资格覆盖「义务在、阶段还没进链」**：code owner 分支的遍历集合由
  `contracts.files` 改为 `contracts.files ∪ 本阶段读取目标`（与紧邻的测试目标分支同形），
  且**两侧都先过同一条源码判据**——profile 声明的源码后缀（与 `check-coding.ts:718` 逐字同法，
  大小写敏感）。**不以目录位置兜底**：模块包路径内同样常驻非源码文件。写集与研究读集里的
  非源码路径都不得因此获得实现阶段归属；
  `mayAdvance` 保留原三条放行，再 OR 一条只认「owner 不在链里 **且** 冻结范围里存在该 owner
  的 required、未满足义务」的分支。判据只取冻结范围既有字段。

不新增登记表、落盘清单、CLI、开关、halt reason 或豁免；不回填/不自愈宿主既有 manifest；
不放宽终局 completion；不扩写权（写集与基线仍由 `check-coding` 按契约与 diff 基线拦截）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-contracts`：源码 evidence 的责任派生集合与资格条件（观察期的 owner 尚未进链一态），
  以及 goal 最终闭环必须与非 goal 路径产出同一种归属。

## Impact

- 影响 runtime：`harness/scripts/utils/phase-closure-finalizer.ts`、
  `harness/scripts/utils/capability-resolution-entry-input.ts`、
  `harness/scripts/utils/scope-replan.ts`、`harness/scripts/utils/verify-feature-completion.ts`、
  `harness/scripts/goal-phase-runtime.ts`、`harness/scripts/check-receipt.ts`。
- 已知上限：本 change **不回填**已落盘的无归属 manifest（旧 run 须走真正的重验流程才会带上
  `owner_phase`）；归属扩大之后，责任阶段读过但不在写集内的 Research 源码同样按该 owner 记账，
  写入许可不因此放宽。

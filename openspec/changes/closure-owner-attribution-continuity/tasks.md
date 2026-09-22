# closure-owner-attribution-continuity tasks

- [x] t1 闭环归属登记：`phase-closure-finalizer.ts` 的 `publishEvidenceBinding` 在缺 `factsContext`
      时经既有入口 `resolveCapabilityResolutionEntryInput` 重建（整体 try/catch，失败退回今天的路径
      并按既有 `console.warn` 口径披露一行）；run 身份优先 `goalRunId`、缺省回落
      `summary.run_id`（缺身份时 `resolveEffectiveScopeSource` 对已转交范围直接抛错，重建必然落空），
      因此恢复闭环 / `--sync-closure` 也产出归属而不改动 requirement 血缘强制门的触发条件；
      `check-receipt.ts` 透传同文件已有的 `runId`。
- [x] t2 归属集合与资格：`capability-resolution-entry-input.ts` 的 code owner 分支遍历集合改为
      `(contractFiles ∪ sourcePaths).filter(宿主源码判据)`（**两侧同判据**；判据 = profile 的
      `sourceFileSuffixes`（与 `check-coding.ts:718` 逐字同法：`.` 归一 + 大小写敏感 `endsWith`），
      不另立路径表、不以模块目录兜底；后缀不认即按无归属处理）；`mayAdvance` 保留原三条分支，增一条
      「owner 不在 `phase_chain` 内 且 范围里存在该 owner 的 required、`satisfied_by` 为空的义务」。
- [x] t3 授权门传当前 owner：`scope-replan.ts` 的 `checkPlanAuthority` 加可选入参，沿
      `verify-feature-completion.ts` 的 `executionScopeEvidenceIssues` 透到两处
      `recomputePhaseEvidenceStaleness`；`goal-phase-runtime.ts` 的 `runPlanAuthorityGate` 传
      `String(phase)`。终局 completion 的 ⑤ 血缘与其它非施工消费点不传。
- [x] t4 回归（经生产闭环入口与真实消费点，不手填 manifest、不手喂 factsContext）：
      `phase-closure-finalizer.unit.test.ts` OWN-T1/T2/T3/T4；
      `phase-closure-finalizer.unit.test.ts` OWN-T6（恢复闭环按 summary.run_id 重建）、OWN-T2 里的
      非源码研究来源反例与 OWN-T7（非源码路径同时在写集与读集）；`phase-evidence-manifest.unit.test.ts` OWN-T5；
      `standalone-coding-review.unit.test.ts` D0.3b（纯修订触发文件不进读集）；
      既有 P1-T5 / P1-T12 原断言不改继续绿；
      `real-chain.unit.test.ts` 正例六阶段 PASS + closed（release-only）。
- [ ] t5 宿主验收：`bc-openCard-2/open-card-flow-v2` 同一 feature 不回退、不新建 CU，用本轮发布件
      重跑 1.2 出生链，确认 coding 按有效写集改过 plan 读集里的产品源码后 `post_agent` 门不再判
      `live_drift`、不再落 `upstream_closure_gap`，且新落盘的 manifest 源码条目带 `owner_phase`。

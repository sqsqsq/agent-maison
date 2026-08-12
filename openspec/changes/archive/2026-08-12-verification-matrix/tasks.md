# Tasks: Verification Matrix

## 1. Config 与 policy

- [x] config template + schema 增 `evidence_profile: strict|balanced`（field_notes 说明；minimal 非法值）——`specs/framework.config.schema.json` + `harness/config.ts` FrameworkConfig.evidence_profile
- [x] C0 `resolveEvidencePolicy` 接入矩阵求解（headless/goal 强制 strict；balanced 保留集 config 可覆写 `balanced_verifier_retained_phases`）
- [x] 红线清单落 spec + 单测锁死（矩阵输出结构上只有 4 项 + 红线实现文件源码扫描零耦合，见 `runtime-policy.unit.test.ts` 两条"不降档红线"case）

## 2. check-receipt policy 化

- [x] 五个硬必需块按 policy 分派；optional 缺失仅 WARN（verifier/trace/exploration 三块接入 `resolveEvidencePolicy`；script_harness/commit_sha/self_check/反假设条款四项恒 required，不参与矩阵——非"降档红线"清单但同属不可降档的诚实性校验）
- [x] lite feature：exit 0 + 顶层 `not_applicable` 机读标注（`tryValidateReceipt` 架构性短路零 subprocess；check-receipt.ts 主流程也短路防直接 CLI 误用）
- [x] receipt 模板按 policy 分节（strict 全填；off 项标 skipped_by_policy 语义）——由 `buildEvidencePolicySnapshot` 统一钉死 off/not_applicable 的 validation_status，无需模板改写

## 3. snapshot 与 closure

- [x] `evidence_policy_snapshot` 两层契约（policy + validation_status）写入 `.current-phase.json`（`CurrentPhaseStatePartial.evidence_policy_snapshot`；receipt frontmatter 本身不改写——由 check-receipt.ts 计算态承载，见 design 实施记录）
- [x] harness-runner closure 三态（receipt_passed / closed_by_exit_report / open）+ next_action 按矩阵——新增 `resolvePhaseClosureSource` 纯函数，`writeRunSummary` 的 `closed` 判定改为 track-aware
- [x] Resume Gate 对 not_applicable 走 lite 闭环判据——`runSyncClosure` 新增 not_applicable 分支，不误盖 summary 为 open
- [x] Stop hook 消费 snapshot（缺省 full+strict 解释旧 state）——`policyRequires` 机制在 C1 已备，C2 起 `buildPolicySnapshot` 真实按 track 求解，本批更新陈旧注释 + 补 T21/T22 端到端回归钉

## 4. Fixtures 与 Verify

- [x] 矩阵各象限夹具（full×balanced 保留集 / headless 强制 strict / lite not_applicable / 旧 state 兼容 / optional+missing WARN）——`check-receipt-policy.unit.test.ts`（7 case，真实 spawn check-receipt.ts 子进程）+ `hook-stale-state.unit.test.ts` T21/T22（Stop hook 端到端）+ `runtime-policy.unit.test.ts`（矩阵纯函数 6 case + 红线锁 2 case + closure 1 case）
- [x] `cd harness && npm test` 全绿（缺省 strict 路径零回归；1530 单测 + 40 fixtures）
- [x] `npm run openspec:validate`（31/31）+ `npm run release:verify`（技术项全 PASS；plan-version FAIL 为预期语义——3.0.0 窗口仍有其它 pending todo）

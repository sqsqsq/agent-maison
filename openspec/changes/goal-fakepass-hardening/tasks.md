## 1. 立项与共评审（实施顺序 1-2）

- [x] 1.1 OpenSpec change 立项（proposal/design/specs 四域 delta）
- [x] 1.2 五方冲突矩阵（design.md §2：两基线三并行 + 排批结论）
- [x] 1.3 receipt schema/信任锚定稿——对码修正：runtime-policy-core 为纯重构 change 无凭证 scope；消费契约 SSOT 冻结于本 change confirmation-receipts spec，签发落位后继 change `confirmation-credential-issuance`（design §3.4）
- [x] 1.4 与 goal-mode-unattended-survival 对齐状态枚举——INTERRUPTED 与本 change 成功侧枚举正交，可共存，单点 types 各自消费（design §3.4b）

## 2. 基座四件（实施顺序 3）

- [x] 2.1 resolvePhaseEvidenceManifest()：复用 spec-loader REQUIRED/OPTIONAL 表（已导出加注）+ outputs overlay + 环境字段；单测 8 例全绿（`phase-evidence-manifest.{ts,unit.test.ts}`）
- [x] 2.2 phase_closure_fingerprint 无环封装序：回执规范化剔指针（RECEIPT_MANIFEST_POINTER_KEYS 单点）+ manifest 不自 hash + 回执/manifest 入集即 throw + staleness 传染；单测覆盖幂等/单向收敛
- [x] 2.3a closure-attestation util：discoverProductSourceRoots() 五源并集（残余扫描=孤儿 fail-safe 构造性实现）+ 空集 fail-safe + 对账四态；单测 5 例含"contracts 未登记新文件绕过"事故派生 fixture（`closure-attestation.{ts,unit.test.ts}`）
- [x] 2.3b 接线：check-receipt review 闭环点生成 attestation + 全阶段 evidence manifest + 回执指针（替换式写入，重跑幂等）；check-testing 新 `review_closure_attestation` BLOCKER（缺失/差异/新 root 全 FAIL，profile 禁用 review 才 SKIP；testing-rules.yaml 已登记）
- [x] 2.4a verify-feature-completion util：clean_pass 六条件（collectCleanPassIssues 生成/验证共用）+ 三态验真 + runner-owned 原子写 + 投影指针；单测 5 例含手工伪造→INVALID、更晚 HALTED→STALE、supersedes 豁免（`verify-feature-completion.{ts,unit.test.ts}`）
- [x] 2.4b 接线：goal-runner run-end 全链 clean_pass 时生成 completion（resolvePhaseRunIds 逐阶段 run 归属；非 clean 记 feature_completion_skipped 里程碑）；goal-status 尾行 feature_status 只消费 verify-feature-completion（expectedChain 独立自 workflow+track 解析）
- [x] 2.x t1 账本 util 前置：headless-assumptions.ts（JSONL schema/registry 交叉核验/legacy md 保守全量/collectAutoDecisions）；单测 7 例用事故双表格式做 fixture
- [x] 2.5 状态枚举迁移：GoalRunStatus 增 CHAIN_SLICE_COMPLETED/AWAITING_HUMAN_REVIEW（COMPLETED 仅 legacy 读兼容，写出侧绝迹）；resolveGoalRunStatus 增 pendingHumanReview 封顶；goal-progress 终态集/goal-runner 残锁判定随迁；goal-report 状态行自带切片范围+待复核计数、"自动决议汇总"节替换旧 Must-review（旧正则实现删除）；runbook 文档随 4.2
- [x] 2.6 截断链 preflight：start_phase 非链首 → 上游 staleness 重算 + review attestation 存在性核验，失败拒启（文本断言不作数）；--supersede 可重复 flag + 审计事件 + 目标存在性校验
- 备注：guessFrameworkRoot 经 inferRepoLayout 布局感知（path-governance 元测试拦下硬编码 framework/ 前缀后修正）
- [x] 2.7 codex 五轮（基座代码 review）3P0+4P1 全修复（2026-07-13）：
  ①completion verifier 不再信自报 chain——expectedChain 强制参数（缺失即 INVALID）+ feature/chain/phases 一一对账 + 原件落点须 goal-runs/<run_id>/ + run events 存在性（缩链复现用例固化）；
  ②manifest 防洗白——aggregate 重算（改条目留旧 aggregate → tampered）+ 回执 evidence_manifest_sha256 指针锚（整体重写 manifest 亦 tampered）+ schema 完整性校验；
  ③attestation 对账走 冻结 roots ∪ 当前重 discovery——新增整模块（newmod/src/main 含 fast path）→ new_roots+added FAIL（复现用例固化）；
  ④supersedes 须 {type:'supersede'} 审计事件核验，自报无事件 → INVALID（原测试的绕过契约已改正）；
  ⑤outputs 保护面补 summary/verifier/trace + spec/ui-spec.yaml + ref-elements.yaml；environment 补 framework_version/profile；
  ⑥registry 读失败 → readable:false fail-closed（不再静默零 gate）；
  ⑦JSONL 强校验：source 枚举/ts 格式/decision_id 重复/expectedPhase-expectedRunId 失配。
  全量 1898/1898 通过；codex 指出的"生产接线未做"属实=2.3b/2.4b/2.5/2.6/3.x 既定余量

## 3. 门禁面（实施顺序 4）

- [x] 3.1a t1 接线：check-receipt goal 环境 `headless_assumptions_ledger` BLOCKER（JSONL 缺失/行非法/registry 不可读/gate 无记录全 FAIL）；buildUnattendedExecutionBlock JSONL 契约+行为开关红线句；report 汇总节+legacy 兼容
- [x] 3.1b §9.3 文档改写（user-confirmation-ux.md：JSONL SSOT/md 投影/账本≠授权/check-receipt BLOCKER）
- [x] 3.2 t10 confirmation-receipt.ts：信任锚六条款（预置 registry 取键/禁内嵌密钥材料/unknown 一律 INVALID/规范化全量签名/revoked 失效/MAC 仅 env 引用形态）；单测 6 例含"自签+内嵌公钥→INVALID"回归；五消费点接线（t3 waiver/t5 skip waiver/t6 降档/3.9 授权/t4b flow_contract）
- [x] 3.3 t3 behavior-switch-scan.ts + 坐标级 waiver（file+symbol+content_sha256+receipt；sha 失配即失效）+ coding/testing 双接线；单测 2 例（事故 BankAddConstants fixture 指到行）
- [x] 3.4 t4a：acceptance flows/checkpoint 解析 + 三约束（边须 P0 AC 拥有/跳边 FAIL/requirement_ref sha256 验存+逐字在源文档）+ flow_contract 确认点（绑定 acceptance/ui-spec/requirement 哈希，改动即 stale；无 receipt→WARN+clean_pass 拒绝）+ check-spec 接线
- [x] 3.5 t4b p0_semantic_coverage_integrity：对账派生计划 step 序列（纯 wait 冒充 FAIL/动作须指向 checkpoint 目标/后置 wait_for required 元素/flow 中间屏边须有已执行通过 owning TC——事故死刑条款）+ 双口径重算（p0_pass_rate_dual_metrics：有 P0 skip 不得无条件「达标」）；⚠️ **deferred（诚实边界）**：运行时坐标 hit-test/页面签名 anti-replay/forbidden 元素运行时缺席证明需 Hylyre provider step 级采集扩展（trace 现无 step 观测），后继与 layout-oracle dump 链共建——本层已确定性击杀全部事故形态，deferred 项已写入 testing-rules 描述
- [x] 3.6 t5：p0_coverage_integrity（P0 skip 无 receipt waiver → BLOCKER failure_kind=await_human_p0_skip）+ classifier/goal-runner/report 全链 halt 分类与内联引导（三出路话术）+ CUMULATIVE_HALT_FAMILY
- [x] 3.7 t6：dereferenceRequirementDocs（越界/超限防线）+ 三态意图（"尽量与截图一致"=ambiguous）+ fidelity_intent_reconciliation（check-spec BLOCKER，人签 deferral 仅降 WARN）+ evaluateFidelityTierPreflight（强意图+无视觉→DEFERRED_CAPABILITY_MISSING；ambiguous+有图未预授权→await_human_fidelity_tier）+ --fidelity/--fidelity-receipt 只升不降；单测 5 例含 codex P1-7 两用例分离
- [x] 3.8 t7：nav 缺失/非法=完备性 BLOCKER（档位无关、单屏门槛）+ ux_reference_mapping（需求引用图禁自划 out-of-scope/裁剪证明 crop_of+reason/多数 out-of-scope FAIL）；⚠️ 部分：unreachable 条目的 nav-config 消费（capture 跳过+status 封顶）留待 visual-diff-nav validate 扩展
- [x] 3.9 conditional_pass_closure（check-review）：有条件通过+未闭环 MAJOR+无授权 receipt → BLOCKER；receipt 有效仅降 WARN

## 4. 收尾（实施顺序 5）

- [x] 4.1 t9：goal-report WARN 列+摘要（visual/coverage/evidence/p0/fidelity 类置顶）+ `${$r()}` Resource 插值 lint（落 hmos profile coding host——root-zero-host-name 元测试拦下根级实现后修正）+ mock 可辨识性入 device-testing 红线
- [x] 4.2 文档：runbook 状态语义表全量改写（新枚举/新 halt/verify-feature-completion 唯一判据/--supersede）、§9.3、device-testing 红线节、MIGRATION.md 四条 breaking
- [x] 4.3 bc-openCard 事故 fixture（单测内固化）：BankAddConstants 行为开关、fast path 派生步序三连、10-skip+「达标」双口径、双格式账本表、manifest 摘要 vs 原始需求「完全参考」两用例、伪造 completion、缩链、supersedes 无审计、新模块隐身、manifest 篡改双形态
- [x] 4.4 cd harness && npm test 等价物全绿（typecheck 0 错 + unit 1917/1917 + fixtures 44/44）
- [x] 4.5 npm run openspec:validate（35/35）
- [x] 4.6 release:smoke-consumer PASS；⚠️ release:verify 的 plan-version 门禁被**既有** 5 个 3.0.0 未完成 plan（consumer-guard/critic-loop/轻量化/layout-oracle/signed-hap）挡住——非本 change 引入，发布前须由各自 plan 收口
- [ ] 4.7 openspec update/archive 时 rerun node scripts/patch-openspec-artifacts.mjs（归档期动作，实现期不适用）

## 5. codex 六轮基座 review 修复（3P0+3P1+3P2 全采纳，2026-07-13）

- [x] 5.1 P0-1 manifest 刚生成即 stale：canonicalizeReceiptContent 归一尾部空行 + writeReceiptManifestPointer 替换式写入（生产 writer 幂等）；单测改用生产 writer（不再 appendFileSync 绕过）
- [x] 5.2 P0-2 信任锚 agent 可绕：defaultTrustRegistryPath 改 env(MAISON_TRUST_REGISTRY)/home 目录，**拒绝项目根**；HMAC key env 强制 MAISON_HMAC_ 前缀 + agent-invoke stripTrustAnchorEnv 从子进程 env 剥除；run_id 强制绑定（expected 有则 payload 必有且相等）；单测含"项目根自建 registry 自签→INVALID"
- [x] 5.3 P0-3 运行时证据边界：p0_semantic PASS 附 p0_runtime_step_evidence_boundary WARN（声明未验运行时 action-target/step 序列/hit-test/forbidden，Hylyre provider 采集为 deferred）；spec delta 加对应 scenario；单测断言 WARN 存在
- [x] 5.4 P0-4 completion 不验血缘：verify 逐 phase 核验引用 run 有 phase_start 事件 + run_end 成功态（非 phase_start/HALTED→INVALID）；生成 run 须有 events；单测复现"仅 run_start→INVALID"（原绿灯契约已改正）
- [x] 5.5 P0-5 environment/需求不入重算：recompute 增 environment 重算（config/workflow/gate/version 任一变→stale）；readReceiptManifestPointer null 改 fail-closed（manifest 存在但缺指针→tampered）；check-receipt 传 collectRequirementSsotPaths 作 extraInputs（原始需求/解引用文档/ux-reference 入血缘）
- [x] 5.6 P0-6 深层模块绕过：discoverProductSourceRoots 残余扫描去深度上限（src/main 命中即剪枝）；单测复现 a/b/c/d/src/main 深层孤儿
- [x] 5.7 P1-1 AWAITING 封顶不接真实门禁：hasPendingHumanReview 消费 collectCleanPassIssues（flow_contract/waiver/档位钳制/待复核）而非仅 ledger 计数；goal-runner run-end 全链评估
- [x] 5.8 P1-2 closure 不绑当前 run：check-receipt 传 expectedRunId（旧 run JSONL 不得复用）+ attestation runIdentity（run/attempt 不再恒 null）
- [x] 5.9 P1-3 receipt run_id 可选绑定：改强制（见 5.2）；五消费点 object_hash 口径不变
- [x] 5.10 验证：typecheck 0 + unit 1922/1922 + fixtures 44/44 + openspec 35/35（净增 4 adversarial 复现用例：项目根 registry 自签/深层孤儿/run 血缘缺失/manifest 生产 writer 幂等）

## 6. codex 七轮基座 review 修复（3P0+3P1+2P2 全采纳，2026-07-13）

- [x] 6.1 P0-1 run_end 缺失仍 VALID：血缘核验要求成功侧 run_end 显式存在（null=未终局/崩溃/截断→INVALID）；单测攻击 C 复现
- [x] 6.2 P0-2 内联 requirement 不入血缘：collectRequirementSsotPaths 追加 goal-runs/<run>/manifest.json（纯内联需求改写→manifest.json hash 变→上游 closure stale）；completion 增 requirement_sha256 绑定+verify 重算；单测复现
- [x] 6.3 P0-3 运行时证据仅 WARN 不阻止完成：collectCleanPassIssues ⑧ runtime_step_evidence（有 P0 device flow 且无 provider step 证据产物→needs_human 封顶 AWAITING_HUMAN_REVIEW，不 FEATURE_COMPLETED）；testing 侧 WARN 保留为 advisory（testing 可 PASS，完成侧封顶）；spec delta 加 scenario；单测复现+provider 证据解除
- [x] 6.4 P1-1 receipt run_id 绑定语义澄清：降档 receipt per-run（goal-preflight 已传 run_id）；waiver/flow_contract/conditional feature 级 object_hash 绑定（含 feature，跨 feature/对象重放失败，同对象跨 run 复用是真人授权的设计意图）；spec 明确二分语义，收回"全消费点强制 run_id"的过度声明
- [x] 6.5 P1-2 clean_pass 误分类：CleanPassIssue 加 kind(needs_fix|needs_human)；hasPendingHumanReview 只消费 needs_human（verdict FAIL/stale/tampered/attestation 失配=needs_fix 不投影 AWAITING）；单测分类断言
- [x] 6.6 P1-3 completion schema 缺绑定字段：增 requirement_sha256/per-phase attempt/testing_source_aggregate/review_attestation_aggregate；verify 三者重算对账
- [x] 6.7 P2-1 manifest 无身份校验：loadPhaseEvidenceManifest 校验 manifest.feature/phase===请求值（跨 feature/phase 搬运重标→tampered）；单测复现
- [x] 6.8 P2-2 goal 缺 run_id 静默降级：check-receipt goal 环境缺 MAISON_GOAL_RUN_ID→BLOCKER fail-closed（run identity 必填）
- [x] 6.9 修复 self-inflicted 解析 bug：runtimeStepEvidencePresent JSDoc 含 `reports/*/` 的 `*/` 提前闭合块注释→吞掉后续 backtick 成游离模板→远端 320 行报错（改 &lt;ts&gt; 转义）。硬学习：块注释内禁 `*/` 字面
- [x] 6.10 验证：typecheck 0 + unit 1926/1926 + fixtures 44/44 + openspec 35/35 + smoke-consumer

## 7. codex 八轮基座 review 修复（2P0+2P1+P2 全采纳，2026-07-13）

- [x] 7.1 P0-1 空文件伪造 runtime evidence：废弃文件存在性判定（空 {} 即解除是后门），改为消费 runtime_fidelity_attestation receipt（信任锚同 t10，绑定 feature+acceptance+testing 源码 aggregate）；provider 落地后 runner 签发，落地前真人带外确认；单测复现"空文件不解除/有效 receipt 解除"
- [x] 7.2 P0-2 新 run 换需求不使旧 closure stale：computeRunRequirementSha（当前权威 run 的规范化 requirement 内容 hash，非文件路径）；evidence manifest environment 记录 requirement_sha256；recompute 比对当前权威 requirement→不一致 stale；截断链 preflight/verify/generate 全传当前 run requirement sha；单测复现"换需求 B→spec closure stale"
- [x] 7.3 P1-1 attempt 装饰字段+Number("i3")=NaN：attestation/completion attempt 改字符串（invocation 序数）；resolvePhaseRunIds 读 phase_start.attempt 返回 {runIds, attempts}；goal-runner 传 phaseAttempts；check-receipt 用 env 字符串不 Number
- [x] 7.4 P1-2 needs_fix 仍写 CHAIN_SLICE_COMPLETED：goal-runner run-end classifyCleanPassIssues 分 needsHuman/needsFix；resolveGoalRunStatus 增 blockingFix→PARTIAL（needs_fix 不投影成功态）；单测断言
- [x] 7.5 P2 completion 结构校验+schema 升级：schema_version 1.0→1.1（旧版 INVALID）；verify 增 phases 数组/字段类型/新绑定字段类型完整校验（畸形/旧版 INVALID 而非抛异常）
- [x] 7.6 验证：typecheck 0 + unit 1927/1927 + fixtures 44/44 + openspec 35/35 + smoke-consumer PASS（净增 5 复现：空文件/有效 receipt runtime evidence、换需求 closure stale、needs_fix→PARTIAL、attempt 字符串）

## 8. codex 九轮基座 review 修复（1P0+1P1+2P2 全采纳，2026-07-13）

- [x] 8.1 P0 requirement_sha256:null 旧 closure 被新需求复用：recompute 传 current 时记录为 null → stale（requirement_unbound，fail-closed）；goal preflight 当前 SHA 算不出 → BLOCKER 拒启；goal 环境闭环算不出 → BLOCKER 不产出未绑定 closure；单测复现"交互态 null 合法 + 新 goal 消费即 stale"
- [x] 8.2 P1 attempt 装饰+口径错：规范口径改为 agent_invoke_start.invoke_id 尾段 i<N>（invocation 序数，resume 单调；phase_start.attempt=retries+1 会归零不是身份）；derivePhaseInvocationAttempt 单点共享（resolvePhaseRunIds 生成 + verifier 重推导对账）；改写 attempt → INVALID；单测复现 forged-i999
- [x] 8.3 P2 schema 守卫不完整：补 artifact_hashes/supersedes/generated_at/workflow_track/parent_run_id 完整类型守卫（缺字段 INVALID 不抛异常）+ expectedTrack 对账（goal-status 已传）；单测参数化删字段负例
- [x] 8.4 P2 OpenSpec 与 receipt 模型矛盾：goal-runner spec 改写为 runtime_fidelity_attestation receipt 二选一规则（runner 签发 after provider / 真人带外 before；绑定+失效语义；空文件明示不作数）+ attempt 规范口径 + requirement null=unbound fail-closed 语义
- [x] 8.5 验证：typecheck 0 + unit 1929/1929 + fixtures 44/44 + openspec 35/35 + smoke-consumer PASS

## 9. codex 十轮基座 review 修复（1P1+1P2 全采纳，2026-07-15）

- [x] 9.1 P1 malformed invocation 退化为合法 attempt:null：derivePhaseInvocationAttempt 改三态（absent=无 invoke 事件兼容态 / valid(i<N>) / invalid=事件存在但 invoke_id 缺失或畸形）；invalid 生成侧 resolvePhaseRunIds 抛错拒产凭证、验证侧 push "invocation 事件非法" → INVALID，不再与 absent 合流 null===null 放行；单测补合法 i<N> 正向 roundtrip（resolvePhaseRunIds→generate→verify=VALID）+ malformed 最小复现（invoke_id="malformed"+attempt:null → INVALID）+ 生成侧 assert.throws
- [x] 9.2 P2 expectedTrack 可选=fail-open API：改必填（与 expectedChain 同哲学），缺失/空 → INVALID"expectedTrack 缺失"；对账无条件执行；goal-status 已合规传参；单测补 expectedTrack:'' → INVALID
- [x] 9.3 OpenSpec 同步：attempt 三态推导语义（malformed 不得退化 null）+ expected chain/track 均为消费方强制输入（唯一入口无 fail-open 可选参数）
- [x] 9.4 验证：typecheck 0 + unit 1930/1930 + fixtures 44/44 + openspec 35/35 + smoke-consumer PASS

## 1. 契约先行

- [x] 1.1 按 2026-09-01 发布件升级事故修订本 change：普通 init/phase 与 Framework identity 完全脱离宿主 Git；降级环境只保留合作式编辑守卫；package identity 单 loader；历史结果只读；发布内容单一发布件拓扑。继续 supersede archived consumer integrity/write guard 谱系，并保持与 `runtime-policy-core` compatible。
- [x] 1.2 对修订后的 proposal/design/spec/tasks 执行 strict validate；通过后再改生产代码，不把本领域 delta 混进 testing change。

## 2. runtime hash / Git 家族退场

- [x] 2.1 删除 consumer 普通 phase 的 per-file hash 与 manifest `files[]` 运行时依赖；保留非阻断 package identity。
- [x] 2.2 删除 manifest selfcheck、foreign-file、workspace tmp hygiene 与 consumer per-file EOL hash 复算。
- [x] 2.3 legacy `integrity.allow_local_drift` / `drift_allowlist` 保持可解析、读取即忽略、不能解锁守卫；迁移说明只落 schema/template/MIGRATION，删除运行时 advisory/check。
- [x] 2.4 每个 current attempt 只生成一次过滤后的 `decisionSummary`；classification/meta/affected files/signature/no-progress/actionability/repair/reconcile/新事件字段全部使用它。legacy-only 零泄漏，legacy+content 只保留 content，process injection 仍 halt；raw summary 仅供 verdict/closure/visual receipt 与历史 renderer。

## 3. 运行时 Git 与身份收口

- [x] 3.1 删除 `harness-runner` 全模式 framework preflight，以及 `framework-integrity.ts` 的 Git scope/status/tracked/dirty、`framework_integrity`/`framework_control_plane_dirty` writer 与 child_process/canonical-gitignore dirty 依赖；不得留下 SKIP/PASS 空壳。
- [x] 3.2 统一 package identity：loader 直接解析 sidecar manifest SHA；visual-feedback 删除 framework cwd `git rev-parse HEAD` 与 sidecar 二次哈希，复用 manifest version/source_commit/built_at/manifest SHA；五种 Git 环境身份一致。
- [x] 3.3 保留 Write/Edit 守卫并诚实描述 fail-open、shell/脚本/场外进程盲区；删除所有“查时 integrity 兜底”，不新增 detector/bypass/baseline。

## 4. 身份、发布边界与当前文档

- [x] 4.1 修订 README、MIGRATION、overview、framework-init/scan prompt、materialized rules、device-testing addendum、skills/readiness/concepts/inventory/boundary、AGENTS/config 模板与 agent settings/hooks：只保留发布件拓扑，删除操作性 submodule/HEAD/tracked/commit 与 dirty fallback 叙事；有界文本核查通过。
- [x] 4.2 `docs/vendor/**` 继续由 `scripts/release-excludes.json` 排除，pack/verify 现有断言不弱化。
- [x] 4.3 同步原 plan `a6c4e9f2` D5/T6（重开 T6 后据实完成）与 testing M0/M1 review/guard inventory 的错误 by-design 记录；T8 保持 pending，不操作宿主。

## 5. 回归与收口

- [x] 5.1 临时 consumer 复现旧 HEAD→完整新包→M/D/??→不提交，并执行真实 `init-orchestrate UPDATE`；run-log/summary 的 `run-global-phases` 成功、catalog 无 Framework Git result；五态 catalog/identity 继续等价。
- [x] 5.2 更新 lifecycle smoke `CASE_REGISTRY`/`STAGES`/clone/context export 与 registry 单测，真实执行升级事故 stage；同时验证 Write/Edit guard、process integrity、历史报告只读兼容与新报告零 framework Git result。
- [x] 5.3 重开项定向测试、typecheck、OpenSpec strict、plan-version、diff/LF 全部通过；复用仍有效的最近全量 `npm test` 结果，除非生产改动引入新的跨面风险；不运行宿主、真机、提交或推送。

## 6. framework-init 正向意图收口（plan 33714d0c 重开）

> 第 1–5 节记录 `c3d8e1f6` 轮次的真实完成状态，不重写；本节是 2026-09-01 后续真实回归推翻旧结论后重新打开的工作。

- [x] 6.1 契约收口（T1）：修订本 change 的 proposal/design，新增 `specs/harness-gates/spec.md` 与 `specs/init-orchestration/spec.md` delta，并在 `specs/framework-integrity/spec.md` 用 MODIFIED 把 runtime-artifact policy 消费者收敛为 Git 中性 helper + Write/Edit guard 两个。framework-init 的正向入口、真实 S1 continuation、明确取消、误加载零副作用与 current-turn S4 作用域只落 init-orchestration delta，不混入 framework identity requirement。strict 通过后才改生产内容；不新建平行 change、不改 archived changes、不归档本 change。
- [x] 6.2 删除 init 宿主 SCM 耦合（T2）：删除 `harness/scripts/show-last-committed-framework-config.mjs` 与全部现行调用、canonical S1.1 的 committed config 恢复、`recovered_framework_config`；删除 check-init inspection #11 与 gitignore imports/`gitignore_sync`/`__testing` 导出、planner `ensure-gitignore` task、executor `ensureCanonicalGitignore` writer；删除 `harness/scripts/utils/canonical-gitignore.ts`（宿主 patterns/等价/advisory/parse/writer/env bypass）。仍有消费者的 `RuntimeArtifactPolicy` 类型/loader/`matchesPolicyPattern` 原位迁到 `harness/scripts/utils/runtime-artifact-policy.ts`，继续读同一 `specs/runtime-artifact-policy.json`。audit：普通 init/phase 仍零 `framework_integrity` / `framework_control_plane_dirty` / Git 派生 blocker / 永久空壳，且未误删 package identity、EOL helper、process integrity、历史 renderer 与业务 Git evidence。
- [x] 6.3 framework-init 正向入口（T3）：`skills/skills.index.yaml` description 收敛为正向范围且不含 `Git`/`SCM`/`status`/`diff`/`add`/`stage`/`commit`/`push`；canonical 删除 route/result enum、两个旧 route label、`framework-init-routing-contract` 锚点与十行自然语言表、Git-only 优先级、普通任务 taxonomy 与“先 X 再 init”编排，只保留正向入口 / 真实 S1 continuation / 明确取消 / 无名称零副作用退出 / 原 Tier_1→S4 内核；canonical ≤260 行、AGENTS 模板 ≤120 行，预算不提高。
- [x] 6.4 入口面与文档清理（T4）：shared bridge 与 Claude/CodeAgent/Cursor command frontmatter 逐字等于 index description，command 只作薄入口；`templates/AGENTS.md.template` L0 行恢复通用 direct 描述并删除 Git 枚举/优先级/handoff；`skills/README.md`、`agents/README.md` 同步；清理 `specs/phase-rules/init-rules.yaml`、`skills/reference/harness-cli-cwd.md`、`skills/project/framework-init/templates/staging-schema-example.md`、`profiles/hmos-app/skills/framework-init/profile-addendum.md`、`docs/overview.md`、`docs/operations/release-checklist.md`、`MIGRATION.md` 中的 committed config / ensure-gitignore / 自动 gitignored 承诺；七类 adapter 继续共享同一平台中性 canonical。
- [x] 6.5 测试收窄（T5）：`framework-init-routing-contract.unit.test.ts` 重写为 `framework-init-entry-contract.unit.test.ts`（删除 `ROUTING_CASES`/`routingRows()`/route 表解析/AGENTS Git taxonomy 断言），只验证正向 description、显式 init、真实 S1 后合法批准、明确取消、误加载零副作用、行数预算与七类 adapter 物化；删除 `canonical-gitignore.unit.test.ts` 及 suite 注册；`init-task-executor` / `init-orchestrate` / `init-orchestrate-smoke` / `template-renderer` / profile addendum 相关 ensure-gitignore 与 inspection #11 断言退场；guard/release 测试改读 Git 中性 helper；smoke 删除 canonical gitignore evaluator/stage 接线但保留 `upgradeOverlay` 五态不变性与其它真实 Git/run evidence。
- [x] 6.6 current-turn 结果隔离（T6）：canonical/commands 明确 S4 只证明产生它的 turn/run；新增同一 task 两轮 test-only fixture（Turn A 显式 init 产生真实 S4；Turn B 普通请求，`framework-init selected/read/invoked=false`、无新 report、不重播旧 S4、不宣称本轮 init 完成），另加独立误加载 fixture 只断言零 init 副作用退出。不建立 router/nonce/token/租约/route DB/外部 baseline；测试名称与说明诚实限定为 Maison 已发布文本、物化字节与内部 fixture。
- [x] 6.7 Maison 内部验收（T7）：OpenSpec strict、harness typecheck、entry-contract / current-turn / init / check-init / planner / executor / orchestrate / adapter / guard / release-boundary / framework-identity / history-compat / smoke-registry 定向 suites、`cd harness && npm test`、`node --test scripts/tests/release-identity.unit.mjs`、`node scripts/check-plan-version.mjs`、受影响发布内容有界文本与调用点核查、`git diff --check` 与本批 CR/LF 检查全部通过，并逐项复核事故断言而非只报“全绿”。不运行 candidate/release pack、宿主操作或真实客户端回归。
- [x] 6.8 复审整改（codex P0+P1）：把 `specs/framework-integrity` 的 `Write-time guard blocks editing-tool writes into vendored framework/` 与 `specs/goal-runner` 的 `Integrity blockers classify as framework_integrity_block and halt on first touch` 从「改标题的 MODIFIED」改为 `REMOVED（base 原标题逐字）+ ADDED（新标题）`，确保归档后不残留 `drift_allowlist` 解锁、check-time backstop、manifest/foreign-file runtime blocker；base `harness-gates` 不再用现存但无关的文件冒充 `Enforcement:`，改为 Former-enforcement 注记由 REMOVED delta 承接；删除 hmos-app framework-init addendum 的宿主 `.gitignore` 指引整段并把 `generated-source-classifier` 对应用例翻成反向断言；清理 device-testing addendum、consumer-boundary、framework.local 模板/schema、guard 提示、goal 运行时输出、testing-write-boundary、product-source-snapshot 等处的 `gitignored` / canonical gitignore / init ignore fallback 承诺；`init-rules.yaml`（`required_logical_items` / `singleton_indices` / `applies_to` / 描述）、check-init 诊断文案与 `docs/overview.md` 统一为 10 项，并在 init smoke 中读取真实 `init-rules.yaml` 与 probe 逻辑索引集合对账；canonical 删除普通任务负向枚举并在 entry-contract 加反向断言；删除 check-init 已无消费者的 config import。归档投影模拟、OpenSpec strict、typecheck、定向与全量测试全部通过。

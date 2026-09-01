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

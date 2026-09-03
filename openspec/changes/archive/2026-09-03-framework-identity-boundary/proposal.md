## Why

宿主不得静默改写 Maison 控制面，这个目标成立；但身份边界不能由宿主 Git 状态证明。2026-09-01 的真实升级给出决定性反例：新发布件 manifest 声明 1094 个文件，missing=0、per-file hash mismatch=0、`RELEASE-MANIFEST.json` 与 `.sha256` 一致；宿主 HEAD 仍是旧发布件，新包覆盖后正常产生 65 modified、4 deleted、235 untracked。`harness-runner` 随后无条件执行 scoped Git dirty preflight，把这 304 条合法版本差异作为 catalog 的唯一 BLOCKER。

Git dirty 同时具有两类确定性缺陷：合法更新未提交会 FAIL；非法修改一旦提交可能 PASS；非 Git 宿主又会 SKIP。它只能描述宿主协作状态，不能证明发布件来源、授权或完整性。宿主是否使用 Git、是否 tracked/staged/committed/clean、HEAD 是否仍是旧发布件，均不属于 Maison 契约。

正确修复是彻底删除普通 init/phase 的 Framework Git 身份与裁决读取，把包完整性留在可信发布/明确集成边界，并诚实区分强隔离与同一 Windows 用户下的合作式编辑守卫。

## What Changes

- **BREAKING** 普通 init、catalog、所有 feature phase 与 goal gate 不再读取宿主 Git 来判断 framework 身份或完整性；新运行不再生产 `framework_integrity`、`framework_control_plane_dirty` 或由 framework Git 状态导致的 `framework_integrity_block`，也不保留永久 SKIP/PASS 空壳结果。
- **BREAKING** 删除 `harness-runner` 的 `runFrameworkIntegrityPreflight` 全模式入口，以及 `framework-integrity.ts` 的 Git scope/status/tracked/dirty 实现、退役配置字段 runtime advisory 与相关依赖。
- **BREAKING** 删除另一条生产期 Git 身份读取：`visual-feedback.ts` 不再以 `frameworkRoot` 为 cwd 执行 `git rev-parse HEAD`。visual feedback 与 check-init 复用同一个 package identity loader：version、`source_commit`、`built_at` 来自包内 manifest；manifest SHA 直接读取既有 sidecar 的 64-hex 声明值，不哈希 sidecar 文本。
- framework 写权限继续由模型外安全主体授予。具备 task sandbox、只读挂载、受限 OS token/ACL 时使用强隔离；同一 Windows 用户且无受限 token 时只保留 Write/Edit/MultiEdit/NotebookEdit 合作式守卫，并明确承认 shell、脚本、`node -e` 与场外进程盲区。不得用事后 detector 假装补齐。
- `integrity.drift_allowlist` / `integrity.allow_local_drift` 继续只为存量配置解析兼容而保留，读取即忽略且不能解锁守卫；迁移说明只落 schema/template/MIGRATION，不再由普通运行产生 advisory/check。
- 历史 summary/report 中的 `framework_integrity`、旧 subtype 与 `integrity_subtypes` 保持只读可解析/展示，不重写历史，不形成新 writer，也不进入 current attempt 的 meta、signature/no-progress、repair/reconcile 或新事件字段。`node_options_injection` 等真实现行 integrity blocker 的安全裁决保持不变。
- 发布包 per-file manifest/sidecar 校验只保留在 Maison pack/release verify 与用户明确触发的 updater/集成边界；普通 phase 只可读取非阻断 package identity。
- 当前消费者发布内容统一为 Maison 发布件解压到宿主 `framework/` 的唯一拓扑；删除操作性 submodule、Vendor/Submodule 双布局、gitlink、Framework HEAD、tracked/commit 生效叙事。`docs/vendor/**` 继续作为开发交接材料排除出发布件。
- **BREAKING** framework-init 收口为**纯正向入口**：只由显式选择/调用、首次接入发布件、创建/补齐/迁移 `framework.config.json`、集成新发布件后刷新 config/adapters/materialized artifacts，或当前对话中尚未完成的真实 S1 的合法 S2 批准触发。它不是全局请求 router、preflight 或 public gate；普通请求不选择、不读取、不经过该 Skill。删除 Git/SCM 专用 discovery 词与 Git-only 优先级、普通任务 taxonomy、route/result enum、自然语言 route 表/parser、`ROUTING_CASES` 与 expected-label fixture、`exit_init_continue_git_l0` / `git_l0_then_framework_init` 两个 route label，以及 Skill 内“先 X 再 init”的编排。若客户端/模型误加载 Skill，则在 readiness/S1/planner/harness/结果之前零 init 副作用退出；该兜底不命名、不枚举、不落 route 表，也不新增 router/状态机/env key/nonce/token/租约。
- **BREAKING** 删除 init 对宿主 SCM 的历史耦合：`harness/scripts/show-last-committed-framework-config.mjs` 与 `recovered_framework_config` 恢复支线、check-init `.gitignore` inspection #11、planner 的 `ensure-gitignore` task、executor 的 `ensureCanonicalGitignore` writer、`canonical-gitignore.ts` 的宿主 ignore patterns/等价映射/advisory/parse 与 `CHECK_INIT_SKIP_GITIGNORE_SYNC` 环境 bypass 全部退场，不留兼容空壳。宿主现有 `.gitignore` 字节不迁移、不删除——Maison 只是不再管理它。仍有真实消费者的 `RuntimeArtifactPolicy` 类型/loader/matcher 原位迁到 Git 中性的 `harness/scripts/utils/runtime-artifact-policy.ts`，继续以 `specs/runtime-artifact-policy.json` 为唯一真源。
- **current-turn 结果隔离**：S4 只证明其 `run_log` 对应的那次 S3 run。用户发送下一条消息后，旧 `InitTaskPlan`/run-log/summary/S4 只是历史上下文；当前 turn 没有新建 init run/report 就不得宣称“本轮 init 已完成”、复述旧计数或列出旧报告路径。唯一例外是尚未完成的真实 S1 作为合法 S2 批准上下文，且仍须本轮实际新建 S3 run。这是 canonical/command 的 turn-local 文本约束，不写磁盘状态、不改 run-log schema、不给报告加 token。反例记录：真实 task `01a019b4-2f73-7a41-834e-04994cf04684` 只有 `20260901T122648Z` 单个 init run（`executed=14`/`skipped=6`/`failed=0`），下一 turn 的普通请求零工具调用、零新报告，却逐字重播了该 S4 与报告路径。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `framework-integrity`: 模型外写权限边界与合作式编辑守卫；普通运行明确禁止宿主 Git/HEAD/dirty 裁决；package identity 非阻断；历史结果只读兼容；runtime-artifact policy 只服务 Git 中性 helper 与 Write/Edit guard 两个消费者，`canonical-gitignore.ts` 退场。
- `runtime-policy`: framework 控制面红线不随 tier 降级，但实现只能是模型外强隔离或合作式编辑守卫，不得恢复 Git dirty/runtime hash detector，也不得派生宿主 Git 配置或补偿 detector。
- `harness-gates`: check-init 探测不再读写宿主 `.gitignore`；`.gitignore` inspection 与 canonical host patterns 整体删除，不留替代 inspection 或永久 SKIP 空壳。
- `init-orchestration`: framework-init 纯正向入口、误加载零副作用退出、明确取消只停 init、S4 的 turn/run 作用域；init 不读写宿主 SCM，config 不从 Git 历史恢复；`ensure-gitignore` task/writer 退场。
- `goal-runner`: framework Git dirty 不再产生 blocker；真实 process integrity 等现行 blocker 仍按既有 integrity 语义处理；历史 subtype 仅作 provenance。
- `release-boundary`: 发布件唯一交付拓扑；vendor 交接文档不进入 consumer 包。

## Impact

- 生产实现：`harness/scripts/utils/framework-integrity.ts`、`harness/harness-runner.ts`、`profiles/hmos-app/harness/visual-feedback.ts`、`harness/scripts/utils/goal-failure-classifier.ts`、`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/await-confirm-guidance.ts`、`harness/scripts/utils/goal-report-generator.ts`、`harness/scripts/utils/adjudication.ts`、`agents/shared/guard-framework-write-core.mjs` 与 adapter hook/settings。
- 配置与身份：`harness/config.ts`、`specs/framework.config.schema.json`、`templates/framework.config.template.json`、check-init/package identity 与 visual-feedback identity 测试。
- 消费者发布内容：根 `README.md`、`MIGRATION.md`、`docs/overview.md`、framework-init Skill/scan prompt、agent materialized rules、device-testing addendum、skills/readiness/concepts/inventory/boundary 文档与 `templates/AGENTS.md.template`。
- 回归：`framework-integrity`/goal/guard/config/runtime-policy/visual-feedback 单测，`scripts/smoke-consumer-lifecycle.mjs`、registry 单测、release identity/candidate binding。
- 记录同步：原 plan `a6c4e9f2` D5/T6 与当前 testing M0/M1 review/guard inventory 的错误 by-design 结论。
- **谱系 supersede**：继续取代 archived `2026-08-12-consumer-framework-integrity-guard` 与 `2026-08-12-consumer-write-guard` 的 runtime hash/sidecar/foreign/allowlist 结论；历史文件不改写。
- 与 active `runtime-policy-core` 仍 compatible：该 change 的 phase/evidence resolver 重构不与本 change 的 framework 控制面边界条款重叠。
- framework-init 入口面：`skills/skills.index.yaml`、`skills/project/framework-init/SKILL.md`、`skills/README.md`、`agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md`、`agents/{claude,codeagent,cursor}/templates/commands/framework-init.md`、`templates/AGENTS.md.template`、`agents/README.md`。
- init 宿主 SCM 解耦：删除 `harness/scripts/show-last-committed-framework-config.mjs` 与 `harness/scripts/utils/canonical-gitignore.ts`；改 `harness/scripts/check-init.ts`、`harness/scripts/utils/init-task-planner.ts`、`harness/scripts/utils/init-task-executor.ts`；新增 Git 中性 `harness/scripts/utils/runtime-artifact-policy.ts`；同步 `specs/runtime-artifact-policy.json` 注释、`specs/phase-rules/init-rules.yaml`、`skills/reference/harness-cli-cwd.md`、`skills/project/framework-init/templates/staging-schema-example.md`、`profiles/hmos-app/skills/framework-init/profile-addendum.md`、`docs/overview.md`、`docs/operations/release-checklist.md`、`MIGRATION.md`。
- 回归（本轮）：`framework-init-entry-contract`（原 `framework-init-routing-contract` 重写）、`framework-init-current-turn-isolation`（新增两轮 fixture）、`init-orchestrate`、`init-orchestrate-smoke`、`init-task-executor`、`template-renderer`、`guard-framework-write`、`release-shipped-in-ignored-dirs`、`smoke-lifecycle-registry`；删除 `canonical-gitignore.unit.test.ts` 及其 suite 注册。
- 本 change 不含 provider per-TC、Hylyre 协议/source、宿主 T8、真机、打包、提交或推送。

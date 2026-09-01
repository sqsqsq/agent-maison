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

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `framework-integrity`: 模型外写权限边界与合作式编辑守卫；普通运行明确禁止宿主 Git/HEAD/dirty 裁决；package identity 非阻断；历史结果只读兼容。
- `runtime-policy`: framework 控制面红线不随 tier 降级，但实现只能是模型外强隔离或合作式编辑守卫，不得恢复 Git dirty/runtime hash detector。
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
- 本 change 不含 provider per-TC、Hylyre 协议/source、宿主 T8、真机、打包、提交或推送。

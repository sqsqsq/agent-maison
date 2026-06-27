## Why

宿主工程把 framework 当 vendored 源码集成（解压发布件覆盖 `framework/`），开发期间——尤其 goal-mode 无人值守代理被门禁挡住时——可能就地改 framework 源码。实测案例：SimulatedWalletForHmos/homepage 跑动后 `framework/` 有 13 个 harness 文件本地漂移、与发布件不一致而长期无人察觉。回灌有效修复只能消除"这次"的漂移，无法阻止"下次"再改。

## What Changes

- **发布件补 per-file 哈希并随包下发**：`pack-release.mjs` 在 staging（sanitize + LF 归一）后对每个文件按字节算 sha256，写入**包内** `framework/RELEASE-MANIFEST.json`（`{schema_version, version, files:[{path, sha256}]}`，**不含 zip sha**，避免 zip 自指循环）；dist sidecar manifest 继续含 zip sha 并链式引用包内 manifest hash。`verify-release-pack.mjs` 校验包内 manifest 存在性、per-file 自洽、覆盖完整与 sidecar 引用一致。
- **consumer 防漂移 preflight**：新增**全局自检** `framework_integrity`，由 harness-runner 入口对**所有模式（普通 + goal）**直调（不经 capability-registry，不被 profile SKIP / provider 缺失影响）。以包内 manifest 为准逐文件 sha256 比对 `framework/`，漂移/缺失默认 BLOCKER。
- **布局自适应**：source/dev layout（无包内 manifest，如 framework 自身仓）→ no-op SKIP，不误伤 `npm test`；仅 consumer layout（有包内 manifest）enforce。
- **显式逃生开关**：`framework.config.json` 的 `integrity.allow_local_drift=true` 把漂移降为 WARN；`integrity.drift_allowlist[]` 按路径放行有意 fork。

## Capabilities

### New Capabilities

- `framework-integrity`: consumer 侧 framework 源码防漂移完整性门禁 + 发布件 per-file 哈希供给。

### Modified Capabilities

None.

## Impact

- 影响发布脚本：`scripts/pack-release.mjs`、`scripts/verify-release-pack.mjs`。
- 新增 runtime：`harness/scripts/utils/framework-integrity.ts`，接入 `harness/harness-runner.ts` 入口。
- 影响 config：`framework.config.json` 新增可选 `integrity.{allow_local_drift, drift_allowlist}`（不破坏既有 config；缺省即默认 enforce）。
- 测试：`harness/tests/unit/framework-integrity.unit.test.ts`（SKIP/PASS/FAIL/WARN/allowlist/运行时不误报 7 场景）；`verify-release-pack` 包内 manifest 断言。
- MIGRATION.md：消费者升级后**首次跑 harness 即启用防漂移门禁**——已有本地改动会判 BLOCKER；须回灌上游或在 `framework.config.json` 显式 opt-out。

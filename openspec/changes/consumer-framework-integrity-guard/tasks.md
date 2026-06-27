## 1. 发布件供给（per-file manifest）

- [x] 1.1 `pack-release.mjs`：staging 后按字节算 per-file sha256，写包内 `framework/RELEASE-MANIFEST.json`（不含 zip sha）
- [x] 1.2 dist sidecar manifest 增 `inZipManifest{path, sha256}` 链式引用
- [x] 1.3 `verify-release-pack.mjs`：包内 manifest 存在性 + per-file 自洽 + 覆盖完整 + sidecar 引用一致

## 2. consumer 防漂移门禁

- [x] 2.1 新增 `framework-integrity.ts` preflight（manifest 缺失 no-op；漂移默认 BLOCKER；allow_local_drift→WARN；drift_allowlist 放行；RELEASE-MANIFEST.json 自身排除）
- [x] 2.2 harness-runner 入口直调（普通 + goal 全模式，不经 capability-registry）
- [x] 2.3 `framework.config.json` 支持 `integrity.{allow_local_drift, drift_allowlist}`

## 3. 验证与文档

- [x] 3.1 单测 framework-integrity（7 场景）+ 注册 run-unit
- [x] 3.2 MIGRATION.md 消费者迁移条目（默认 BLOCKER + opt-out 用法）
- [x] 3.3 `cd harness && npm test` 全 PASS

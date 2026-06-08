# Tasks: ut-harness-pollution-gate

## 1. Harness core

- [x] 1.1 新增 `harness/scripts/utils/harness-path-guard.ts`
- [x] 1.2 `check-ut.ts` 编排 `harness_host_artifact_pollution`
- [x] 1.3 `ut-rules.yaml` + hmos overlay 声明规则
- [x] 1.4 `adhoc-canonical-paths.ts` 复用 `isUnderHarnessRoot`

## 2. Profile

- [x] 2.1 `UtHostImpl.collectHarnessPollutionExtras?` 类型
- [x] 2.2 hmos-app `ut-host-impl.ts` 实现 extras

## 3. Docs & gitignore

- [x] 3.1 harness-cli-cwd §2.5、business-ut Step 3.0、profile-addendum、framework-agent-execution、consumer-framework-boundary
- [x] 3.2 `canonical-gitignore.ts` 追加 ohosTest/test/dag

## 4. Verify

- [x] 4.1 `harness-path-guard.unit.test.ts`
- [x] 4.2 `cd harness && npm test` 全 PASS
- [x] 4.3 `npm run openspec:validate`

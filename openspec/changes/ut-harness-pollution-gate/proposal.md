# Proposal: UT harness 污染门禁

## Why

消费者工程 Skill 5 执行 `cd framework/harness && harness-runner` 后，agent 用相对路径 Write UT，产物落在 `framework/harness/{package_path}/...`。现有 `check-ut` 只扫 `<repo-root>/{package_path}/src/ohosTest/...`，误写不可见，仅报「未找到 UT」。

## What Changes

- 根 `check-ut` 新增 `harness_host_artifact_pollution`（BLOCKER）：`ctx.harnessRoot` 下出现 `contracts.modules[].package_path` 即 FAIL
- 新增 `harness/scripts/utils/harness-path-guard.ts`（`isUnderHarnessRoot`、`formatPollutionDisplayPath`、`collectContractPackagePathPollution`）
- hmos-app profile 可选 `collectHarnessPollutionExtras`（ohosTest / test/dag / *.test.ets glob）
- Skill 5 / harness-cli-cwd / consumer-framework-boundary 文档：Write Path Gate
- `canonical-gitignore` 二级保险；单元测试覆盖 consumer / external display path

## Impact

- Affected specs: harness-gates
- Affected code: `harness/scripts/check-ut.ts`, `harness/scripts/utils/harness-path-guard.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`, `specs/phase-rules/ut-rules.yaml`, `skills/`, `agents/`

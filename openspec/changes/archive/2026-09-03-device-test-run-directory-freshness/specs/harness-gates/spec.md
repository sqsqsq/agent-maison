# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Device-test run artifacts are written to a fresh timestamped directory

每次执行 device_test.run 前，check-testing MUST 在 `featurePhaseReportsDir/reports` 下新建 `<timestamp>/hylyre/` 目录（timestamp 为 UTC ISO 压缩形态 `<YYYYMMDD>T<HHMMSS>Z-<ms>`，保留毫秒精度，同秒连续执行仍须互异），并把选中的 `test-plan.hylyre.md` 及其同目录 `derive-manifest.json`（若存在）原样复制到新目录；本轮 `test-report.md` / `trace.json` / `failures/` MUST 全部写入新目录。目录认领 MUST 为排他式原子 mkdir（非 recursive；已存在即 `EEXIST`，fail-closed 零写入，不覆盖、不复用旧 timestamp 目录，不存在 existsSync+recursive mkdir 的 TOCTOU 竞态）。原始派生目录 MUST 保持字节不变（只读输入）。复制件 mtime MUST 以本次执行为时点，使既有 mtime 选择器自然落在新目录（消费者无需改动）。

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/derived-hylyre-plan.ts`

#### Scenario: 连续执行生成两个独立目录

- **WHEN** 同一源派生计划被连续选中执行两次（含同秒不同毫秒）
- **THEN** 生成两个不同 timestamp 的新执行目录，第二次执行产物写入第二个目录，选择器（mtime 最新）指向第二次目录

#### Scenario: 目录冲突 fail-closed（原子认领）

- **WHEN** 目标 `<timestamp>/hylyre/` 目录已存在（并发/重入，排他 mkdir 得 `EEXIST`)
- **THEN** 本轮执行抵返 BLOCKER FAIL，不调用 runner、不覆盖旧目录、不写入任何文件
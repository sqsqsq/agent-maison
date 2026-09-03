## Why

宿主实测（bc-openCard，2026-08-12）暴露执行产物溯源错乱：device-test 的 report/trace
被写回旧 timestamp 目录（目录名 08-10、内容 08-12），读者无法从目录名判断执行时间；
同类问题可能复发（harness 把「任意已存在的派生文件」当执行输入，同目录复用导致
溯源/新鲜度混叠）。本 change 收敛执行目录与派生输入的归属边界。

## What Changes

- `device_test.run` 执行前在 `featurePhaseReportsDir/reports` 下新建
  `<timestamp>/hylyre/` 目录（毫秒精度，同秒互异），把选中派生计划与
  `derive-manifest.json` 原样复制进新目录；本轮 report/trace/failures 全部写入新目录。
- 目录认领为排他式原子 mkdir：已存在即 `EEXIST` → fail-closed（零写入、不覆盖、
  不复用旧 timestamp 目录），消除 existsSync+recursive mkdir 的 TOCTOU 竞态。
- 原派生目录保持字节不变（只读输入）；复制件 mtime 以执行为时点，mtime 选择器
  自然落在新目录，消费者无需改动。

## Capabilities

### Modified Capabilities

- `harness-gates`: device_test.run 的执行产物与派生输入写入独立的新鲜 timestamp
  目录，且以排他式 mkdir 原子认领；冲突即 fail-closed。

## Impact

- 生产代码：`harness/scripts/check-testing.ts`、`harness/scripts/utils/derived-hylyre-plan.ts`
  （新增 `hylyreRunTimestamp` / `prepareFreshHylyreRunDir`）。
- 单测：`harness/tests/unit/derived-hylyre-plan.unit.test.ts`（连续执行/字节不变/
  无 trace 不回退/冲突 fail-closed/同秒互异）。
- 无 schema/协议变更；消费者（mtime 选择器、evidence composer）零改动。
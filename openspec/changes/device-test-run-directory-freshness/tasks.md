# device-test-run-directory-freshness

## 1. 实现

- [x] 1.1 `hylyreRunTimestamp`（毫秒精度 `<YYYYMMDD>T<HHMMSS>Z-<ms>`，同秒互异）+ `prepareFreshHylyreRunDir`（排他式原子 mkdir 认领、复制派生计划与 manifest、原目录只读、冲突 fail-closed）—— (`harness/scripts/utils/derived-hylyre-plan.ts`)
- [x] 1.2 `check-testing.ts` 接线：执行前新建执行目录，report/trace/failures 写入新目录；目录冲突 → BLOCKER FAIL 且不调用 runner
- [x] 1.3 单测覆盖连续执行两目录 / 原目录字节不变 / 第二轮无 trace 不回退第一轮 / 目录冲突零写入 fail-closed / 同秒不同毫秒互异 / 源缺失 fail-closed

## 2. 验证

- [x] 2.1 `cd harness && npm test` unit 3276/3276 + fixtures 44/44（二轮 review 后全量）
- [x] 2.2 `npm run openspec:validate` 34/34；`node scripts/check-plan-version.mjs` PASS；`git diff --check` 干净
- [ ] 2.3 宿主复验（device-test 输出落在新 timestamp 目录、原派生目录字节不变）——需宿主拿到新版本后执行，本仓库内保持 pending
# Design: goal-mode MVP

## Evidence path

`resolveGoalReportDir({ featuresDir, feature, runId })` → `{featuresDir}/{feature}/goal-runs/{runId}/`. `manifest.feature` 必填。

## Resume

`loadGoalManifestFromRun(projectRoot, runId, { feature, featuresDir })` 单一路径。CLI：`--resume` 无 `--feature` 且无 `--manifest` → BLOCKER 退出。

## NL policy

`resolveTransitionPolicy`: goal 专用词先于 `BATCH_PHRASES` 匹配。

## Gitignore

仅追加 `doc/features/*/goal-runs/`；不整树忽略 `doc/features/`。

## OpenSpec archive

archive 后须断言 `goal-mode-skill/` 存在、`goal-orchestration-skill/` 不存在；若 archive 未删旧目录则手工收敛。

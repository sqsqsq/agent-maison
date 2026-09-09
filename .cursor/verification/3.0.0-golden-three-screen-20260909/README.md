# 三屏 golden 基线验证

2026-09-09 用户明确批准采用 bc-openCard-1 原始三屏需求。来源 SHA256 和固定页面映射在发布契约 note 中登记。

- consumer-golden: 26 passed / 0 failed；golden-capture-targets: 8 / 0。
- 完整 harness 回归：结果：3962 passed, 0 failed (共 3962)；结果：46 passed, 0 failed (共 46)，包含 typecheck。
- existing-host-diagnostic.json：本地更新后的 evaluator/契约读取原宿主 run 73fc05，14 项 PASS。外层标为 local_baseline_diagnostic，不是新安装候选件产出的正式发布报告，不用于 promote。
- 未修改宿主 framework 或原报告；旧十屏 FAIL 证据仍保留在上一日收尾目录。

## 2026-09-09 installed candidate acceptance

Candidate source: 453a4df68fb72fa515500848720a3ee28887bbe1. Full candidate build, 3962 unit checks, 46 fixtures, package verification, and consumer lifecycle smoke passed. See installed-candidate.json for exact hashes. Host framework-only installation commit: 583281c4.

- report-only-installed.json: actual installed candidate CLI PASS, before subsequent goal regression.
- b05-na-checks.json and b05-quantity-check.json: targeted checks from actual CLI runs on a disposable host copy; unrelated whole-phase failures remain recorded, not asserted PASS. balanced goal-mode receipt also explicitly reports verifier off; absent run identity prevents claiming that receipt closed.
- attended-review-summary.json / events / goal-report: actual bridge with isolated phase context. review PASS/advance and closed; overall run PARTIAL because other phases in the disposable host retained negative-test state.
- b04-spec-gap-report.json / events: actual strict/unverified negative case; canonical runtime classified spec_capture_gap. Owner ended the scenario with waiting after observing the negative result.
- Main run 20260909T011221Z-710361 is still in progress. Initial Claude OAuth failure, USB system dialog, and accidental agent git restore of installed candidate are preserved in host raw logs. Driver stopped execution, restored the same ZIP, committed only framework installation, and resumed using configured Codex model. Mixed-version results are not release acceptance.
- Two untriggered C-N branches are pending the user’s release-scope decision. No final release or golden PASS is asserted yet.

The isolated-host folder is a disposable copy, excluded only through this checkout’s local Git exclude. Raw model logs, full test logs and private host copies are kept locally; selected reports and this index are the committed evidence.

## Final release — 2026-09-09

The user explicitly cancelled all remaining tests and requested formal release. B06 and the master plan are closed; release:check-plans PASS. The same validated candidate ZIP was promoted without rebuilding or rerunning tests. Final SHA256: c1285f7322bf38db9cea56edfd5f7207bb97b49564deb6855ce18e8b071abfbb. See formal-release.manifest.json. Final golden/completion revalidation is cancelled, not asserted PASS; historical HALTED/stale results remain unchanged. No production or release-script changes were made for this closeout.

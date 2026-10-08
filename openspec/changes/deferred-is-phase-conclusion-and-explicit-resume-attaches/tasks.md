## 1. 计划冻结

- [x] 1.1 plan b7d2e9f4 经 codex 两轮评审冻结（§7）；单批实施，记录在 plan §8。

## 2. 延迟定义与驱动前进（t1）

- [x] 2.1 `isDeferredSummary` 只认 `verdict=INCOMPLETE` / `completion_status=deferred`。
- [x] 2.2 `selectRunnerActionFromAssess` 的 `resolve_deferred`：目标在后 → `advance`。

## 3. 显式恢复改附着（t2）

- [x] 3.1 显式接续段对未启动 run 改附着，保留 `--force-resume`；拒绝文案区分出生事件与真源损坏。

## 4. 报告终止轴（t3）

- [x] 4.1 时间线终止轴与 `buildAgentWarn` 消费 `completion_observed`。

## 5. 文档与验证（t4）

- [x] 5.1 `MIGRATION.md`、运维手册、第四轮观察记录；本 change 严格校验。
- [x] 5.2 typecheck 与目标套件、plan 扫描、`git diff --check`、LF 复核。
- [ ] 5.3 代码冻结后由调度一次运行 `cd harness && npm test` 与受影响 release-only 链路。

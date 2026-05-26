# Operations · 工程化运行手册

把 framework 实际跑起来需要的一切操作性文档：怎么跑、报告在哪、出错怎么排查。

| 文件                                                  | 写了什么                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| [`harness-runbook.md`](./harness-runbook.md)          | Harness：默认 **spec-driven** 下 **11** 个 phase、报告路径、关键门禁速查、常见报错 |
| [`release-checklist.md`](./release-checklist.md)      | zip 发版自检：`release:verify` / `release:pack`、边界速查 |

## 候选议题（按需补）

- `ci-integration.md`：在 CI 里跑 harness 的范式（GitHub Actions / GitLab CI / 自建）
- `troubleshooting.md`：常见报错诊断（按报错关键词索引）

# harness

Framework phase harness — scripts、fixture 回归与 profile-aware runner。

## 安装

```bash
cd framework/harness && npm install
```

消费者实例仅在 `framework/harness` 下安装；勿在宿主工程根安装 framework runtime。源码仓开发在仓根运行 `npm run harness:install`，或在源码仓的 `harness/` 下安装。

## 常用命令

| 命令 | 说明 |
|------|------|
| 源码仓根目录 `npm test` | 一次 typecheck，并行运行全部 unit、profile、有效 fixture 和根工具测试 |
| 源码仓根目录 `npm test -- --filter <套件名>` | 本地按套件名的字面子串排错，零命中报错 |
| `npm run check:spec` | spec 阶段（canonical） |
| `npm run check:plan` | plan 阶段（canonical） |
| `npm run check:global` | catalog + glossary + docs |

每例从准备到清理最多 30 秒，整轮最多 30 分钟。开发验收使用无筛选的根命令，报告写入 `harness/reports/test-run/full.json`。消费者发布件的 `framework/harness` 下，`npm test` 运行 `check:global`。开发期 plan、goal 或 OpenSpec 纯文字改动使用相应校验及 diff/LF 检查。

## Legacy phase script alias

v2.3 起 canonical phase id 为 `spec` / `plan`。以下 npm script **保留为便利别名**，内部仍走 `harness-runner` + phase-alias WARN：

| Legacy script | 映射 |
|---------------|------|
| `npm run check:prd` | `--phase prd` → normalize 为 `spec` |
| `npm run check:design` | `--phase design` → normalize 为 `plan` |

新 CI / 文档请优先使用 `check:spec` / `check:plan`。别名保留 ≥2 minor 窗口，见根 `MIGRATION.md` §v2.3。

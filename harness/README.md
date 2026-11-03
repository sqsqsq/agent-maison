# harness

Framework phase harness — scripts、fixture 回归与 profile-aware runner。

## 安装

```bash
cd framework/harness && npm install
```

消费者实例仅在 `framework/harness` 下安装；勿在宿主工程根安装 framework runtime。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm test` | typecheck 一次 + 全部 unit/profile（含 release-only）+ 全部 fixture；收口与发布完整全量 |
| `npm run test:changed` | 按当前输入与逐组通过事实生成并执行必选计划；必选项只能加不能减 |
| `npm run check:spec` | spec 阶段（canonical） |
| `npm run check:plan` | plan 阶段（canonical） |
| `npm run check:global` | catalog + glossary + docs |

## Legacy phase script alias

v2.3 起 canonical phase id 为 `spec` / `plan`。以下 npm script **保留为便利别名**，内部仍走 `harness-runner` + phase-alias WARN：

| Legacy script | 映射 |
|---------------|------|
| `npm run check:prd` | `--phase prd` → normalize 为 `spec` |
| `npm run check:design` | `--phase design` → normalize 为 `plan` |

新 CI / 文档请优先使用 `check:spec` / `check:plan`。别名保留 ≥2 minor 窗口，见根 `MIGRATION.md` §v2.3。

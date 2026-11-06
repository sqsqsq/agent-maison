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
| `npm test` | 正式发布完整全量：typecheck 一次 + 日常及扩展域全部有效 unit/profile 与 fixture；不按缓存裁剪 |
| `npm run test:daily` | 日常全集与 typecheck；普通 plan 收口及候选测试门禁，不写正式 full/completeRun 证明 |
| `npm run test:changed` | 日常域按需，保留旧红与源码真实依赖；缺基线最多扩大到日常全集，必选项只能加不能减 |
| `npm run check:spec` | spec 阶段（canonical） |
| `npm run check:plan` | plan 阶段（canonical） |
| `npm run check:global` | catalog + glossary + docs |

以上测试入口用于源码仓。消费者发布件移除开发测试脚本，`framework/harness` 的 `npm test` 仍为 `check:global`。

普通 Skill/发布文档正文改动选择实际文案、投影消费者和一条精确正常代表；机器声明、职责/权限/验收约束变化追加对应回归，混合 TS 改动取真实依赖并集。开发 plan/goal/OpenSpec 纯文字用相应校验及 diff/LF 检查。自然语言行为变化仍须依据实际 diff 追加必要短回归。

`run-test-plan.ts` 的 `--daily` 与 `--full` 互斥。报告位于 `reports/test-run/`，标明 `changed`、`daily` 或 `full`；正式未执行或仍红单列。`--add` 可增加 suite 或打印的精确 group ID（含逗号的 ID 应整段引号传入），不升级本轮 scope，也不删除原必选组。

## Legacy phase script alias

v2.3 起 canonical phase id 为 `spec` / `plan`。以下 npm script **保留为便利别名**，内部仍走 `harness-runner` + phase-alias WARN：

| Legacy script | 映射 |
|---------------|------|
| `npm run check:prd` | `--phase prd` → normalize 为 `spec` |
| `npm run check:design` | `--phase design` → normalize 为 `plan` |

新 CI / 文档请优先使用 `check:spec` / `check:plan`。别名保留 ≥2 minor 窗口，见根 `MIGRATION.md` §v2.3。

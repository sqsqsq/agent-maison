# Framework 发版自检清单

AgentMaison 自身发 zip 发布件（`framework-<semver>.zip`）前的 BLOCKER 与可选项。

## 自动（BLOCKER）

1. **Harness 回归**

   ```bash
   npm run release:all
   ```

   发布链内调用一次 `npm test`，完整执行日常与扩展域的 typecheck、全部有效 unit/profile（含 release-only）及 fixture；无需发布前再单独跑全量。每轮开发使用 `npm run test:changed` 日常域按需计划，普通 plan 收口使用 `npm run test:daily` 日常全集和本次必要验证。测试执行/分类基础设施改动用定向接线验证证明无漏组、scope 串用或正式晋升绕过，不因此例行重跑数小时业务全量；已知日常缺陷不能通过分层豁免。下面的 pack/verify 命令用于分步诊断，完整发布链已经包含它们。

   **release-only 套件**也包含在 `npm test` 完整全量中；底层 `test:unit` 默认仍保留原诊断筛选行为。单跑：

   ```bash
   cd harness && npm run test:unit -- --filter lifecycle-evolution
   ```

   **兼容基线**：`lifecycle-evolution` 的 L0 要求上一版宿主快照（[`host-snapshot-3.1.0`](../../harness/tests/fixtures/host-snapshot-3.1.0/README.md)）原样加载后 `assessFeature().complete === true`。L0 转红只有两种合法处置：

   - 修回归；
   - 有意的破坏性变更：(a) 在 `MIGRATION.md` 登记宿主可执行的迁移步骤；(b) 在快照上按该步骤迁移后 L0 重新为 true；(c) 按快照 README「重生成规则」重生成快照并更新钉住提交。不要求自动迁移器。

2. **Plan 版本门禁 + 维护者 CHANGELOG（dev-only）**

   ```bash
   npm run release:check-plans    # --release：当前窗口 plan 须全完成或已顺延
   npm run release:changelog      # 生成 MAINTAINER-CHANGELOG.md
   ```

   开发期轻量校验（非发布阻断）：`node scripts/check-plan-version.mjs`

3. **发布包规则 + 内容验收**

   ```bash
   npm install          # 根目录，拉取 archiver / extract-zip（仅 maison 发版用）
   npm run release:verify
   ```

4. **产出正式 zip**

   ```bash
   npm run release:pack
   ```

   检查：

   - `dist/framework-<version>.zip`
   - `dist/framework-<version>.manifest.json`（sidecar，不进 zip）

5. **dry-run 抽查（可选）**

   ```bash
   npm run release:pack -- --dry-run
   ```

6. **layout 烟测（已纳入 `harness` unit：`runner-layout-smoke`）**

   - standalone：`--phase docs` 报告写入 `harness/reports/`，不得出现 `framework/harness/reports/`
   - consumer：可用 `npm run release:pack -- --stage-only` 产出 `dist/release-staging/framework/` 作 fixture 来源

7. **版本窗口切换（发布后）**

   ```bash
   npm run release:version -- bump --patch   # 或 --minor / --major
   ```

   bump 前须已通过 `release:check-plans`；随后补 `RELEASE-NOTES-v<上一版本>.md`。

## 中间候选与正式晋升

```bash
npm run candidate:build
npm run candidate:promote -- --evaluator-report <consumer-golden-report.json>
# 主干已前进时，指定保留的候选来源；该来源的 package.json 决定候选版本
npm run candidate:promote -- --source-root <受测隔离副本> --evaluator-report <consumer-golden-report.json>
```

构建候选先运行 `test:daily` 日常全集，再 pack、校验同一 zip、执行同 zip 消费者 lifecycle smoke；候选通过可按原授权回灌宿主。候选 sidecar 记录日常测试输入 id 和来源目录，`complete` 只说明候选构建及 smoke 完成，尚不代表正式发布资格。

晋升保留 zip SHA、包内 manifest、consumer golden 和发布 plan 门禁。正式完整测试必须对应其来源当前稳定的 `InputSnapshot`，结果明确为 `scope=full`、`full=true`，并有同输入的 `completeRun` 通过事实；daily/changed 或阶段检查不能代替。没有可复用证明时，在匹配来源执行一次 `npm test`，发布 plan 门禁也使用该来源的版本窗口。来源先经已有 pack 的 `--stage-only` 得到 sanitize/LF 后发布集合，与候选逐文件对齐；只比较，不重打候选 zip。多文件、缺文件、内容或版本不一致，以及测试后输入漂移，均不得晋升。

请保留候选对应的受测副本。干净提交可用其 `source_commit` 还原隔离来源；含未提交内容时仅 HEAD 不足以重现。找不到匹配来源须重新构建候选，不改写当前工作区凑一致。仅开发期 plan/测试输入变化可以产生新的 full 输入 id，前提是正式结果绑定实际来源，且发布集合仍与候选相同；不要求 full id 等于最初 daily id。

只有正式全量、同 zip smoke、golden 和包身份均通过，而发布 plan 门禁未过时，保留 `eligible` 候选并等待 plan 完结；其它失败不授予正式资格。最终晋升移动原 zip，保持宿主已验收的字节。开发期 `test:*`、`candidate:*` 和 `release:*` 脚本不进消费者 package；消费者 `framework/harness` 的 `npm test` 仍为 `check:global`。

来源 plan 状态改变会使输入快照变化，`eligible` 后重新 promote 可能需要重新执行全量；正式发布前先确认来源门禁已准备完成。

## 人工（可选）

在任意消费者工程（如 SimulatedWalletForHmos）：

1. 备份或删除现有 `framework/`
2. 将 `dist/framework-<version>.zip` 解压到工程根（应得到 `<工程根>/framework/`）
3. 验证：

   ```bash
   cd framework/harness && npm install
   npx ts-node harness-runner.ts --phase catalog
   ```

## 排除规则 SSOT

[`scripts/release-excludes.json`](../../scripts/release-excludes.json)

## 消费者 init / setup smoke（编排化重构后）

在解压 zip 后的消费者工程：

1. **项目 init**

   ```bash
   cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope project --project-root <实例根>
   ```

   确认 stdout 为合法 `InitTaskPlan` JSON（S1 零写盘：重复执行前后 config mtime 不变，除非用户已批准 S3；宿主 `.gitignore` 任何阶段都不被读写）。

2. **个人 setup**（每位开发者一次）

   ```bash
   cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <实例根>
   # 多 adapter 或 DevEco：再按 personal-setup-gate 走 personal orchestrate
   ```

   确认生成 `framework.local.json`（个人级本地配置）且 **未** 修改 `materialized_adapters` 以外的项目文件。

3. **feature phase 门控**

   ```bash
   cd framework/harness && npx ts-node harness-runner.ts --phase spec --feature smoke-feature
   ```

   无 local setup 时 feature phase 应 exit 1；`--ensure` 在单一物化 adapter 时应自动写 local。

4. **legacy config 迁移**（UPDATE）：`agent_adapter` / DevEco installPath 外迁到 local + `materialized_adapters` 写入项目 config（`migrate-config` 任务）。

## 交互层 smoke（v4.0+）

在 framework 仓根执行（**Phase A 源模板 + Phase B 消费者 tmpdir smoke**）：

```bash
cd framework/harness && npx ts-node scripts/smoke-interaction-renderer.ts
```

对已跑 **项目 init + personal setup** 的消费者工程，可只验实例产物：

```bash
npx ts-node framework/harness/scripts/smoke-interaction-renderer.ts --project-root <实例根>
```

断言（Phase B consumer smoke 覆盖）：

- `.claude/rules/interaction-renderer.md` 存在
- `.claude/rules/widget-options/` 与 `confirmation-ux.md` **不存在**
- UPDATE `deprecated_artifacts_cleaned` 清理旧产物（tmpdir 内模拟）
- generic + 自定义 `paths.agent_bundle_root`（如 `.codex`）时 renderer 落在 `.codex/rules/`，非默认 `.agents/rules/`

## ClaudeCode + MiniMax 2.7 人工验收（发版前建议）

在真实消费者工程 + ClaudeCode CLI + MiniMax 2.7 下实测至少 6 类交互须渲染为**键盘选择**（非纯文本输入）：

1. **init** — `init.materialized_adapters` + `init.task_plan`（**非** legacy Q1=y）
2. **setup** — `setup.adapter`（personal，仅已物化项）
3. **spec** — 术语映射 artifact gate（`spec.terminology`）
4. **coding** — 逐模块交付（`coding.module_batch`）
5. **UT** — DAG 确认（`ut.dag_confirm`）
6. **phase.next_step** — 跨阶段动态 label
7. **ad-hoc** — 未登记临时交互仍走 AskUserQuestion fallback

## 相关命令

| 命令 | 说明 |
|------|------|
| `npm run release:pack` | 产出 zip + manifest |
| `npm run release:pack -- --dry-run` | 只统计 include/exclude |
| `npm run release:pack -- --out D:/releases` | 指定输出目录 |
| `npm run release:check-plans` | plan 版本发布门禁（`--release`） |
| `npm run release:changelog` | 生成 `MAINTAINER-CHANGELOG.md` |
| `npm run release:version -- status` | 当前版本窗口与 plan 统计 |
| `npm run release:version -- bump --patch` | 推进 patch（minor/major 同理） |
| `npm run release:verify` | 规则单测 + plan 版本 + 临时目录打包/解压/断言 |

# Framework 发版自检清单

AgentMaison 自身发 zip 发布件（`framework-<semver>.zip`）前的 BLOCKER 与可选项。

## 自动（BLOCKER）

1. **Harness 回归**

   ```bash
   npm run release:all
   ```

   发布链从仓根运行一次 `npm test`，执行 typecheck、全部 unit、profile、有效 fixture 和根工具测试。每轮开发和 plan 收口使用同一入口。本地排错可按套件名筛选，例如 `npm test -- --filter runner-layout-smoke`，筛选不写全量证明。下面的 pack/verify 命令用于分步诊断，完整发布链已经包含它们。

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

构建候选先在稳定来源运行一次根 `npm test`，全绿后打包，再以同一 zip 完成包校验与消费者 lifecycle smoke。冒烟验证临时宿主安装、克隆、覆盖升级和全局检查。恢复与交付由真实宿主任务验证。候选 sidecar 记录构建全量起止输入、通过计数、源码身份和同一 zip 身份。`complete` 表示候选构建及 smoke 已完成。

晋升核对构建时绑定的全量通过证明、zip SHA、包内 manifest、consumer golden 和发布 plan 门禁。旧候选仅有日常结果、缺少证明或证明与候选不匹配时重新构建。候选来源按既有打包规则生成发布文件清单，与原 zip 的版本和各文件字节核对。主干进入下一版本时，可指定对应版本且发布内容一致的保留来源，用于检查发布 plan 门禁。

只有全量、同 zip smoke、golden 和包身份均通过，且仅发布 plan 门禁未过时，候选才标记为 `eligible`。门禁通过后重新执行晋升，移动宿主已验收的同一 zip。消费者 `framework/harness` 的 `npm test` 仍为 `check:global`。

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

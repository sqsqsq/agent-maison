# Framework 发版自检清单

AgentMaison 自身发 zip 发布件（`framework-<semver>.zip`）前的 BLOCKER 与可选项。

## 自动（BLOCKER）

1. **Harness 回归**

   ```bash
   cd harness && npm test
   ```

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

   确认 stdout 为合法 `InitTaskPlan` JSON（S1 零写盘：重复执行前后 `.gitignore` / config mtime 不变，除非用户已批准 S3）。

2. **个人 setup**（每位开发者一次）

   ```bash
   cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <实例根>
   # 多 adapter 或 DevEco：再按 personal-setup-gate 走 personal orchestrate
   ```

   确认生成 `framework.local.json`（gitignored）且 **未** 修改 `materialized_adapters` 以外的项目提交文件。

3. **feature phase 门控**

   ```bash
   cd framework/harness && npx ts-node harness-runner.ts --phase prd --feature smoke-feature
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
3. **PRD** — 术语映射 artifact gate（`prd.terminology`）
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

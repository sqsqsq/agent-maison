# Framework 发版自检清单

AgentMaison 自身发 zip 发布件（`framework-<semver>.zip`）前的 BLOCKER 与可选项。

## 自动（BLOCKER）

1. **Harness 回归**

   ```bash
   cd harness && npm test
   ```

2. **发布包规则 + 内容验收**

   ```bash
   npm install          # 根目录，拉取 archiver / extract-zip（仅 maison 发版用）
   npm run release:verify
   ```

3. **产出正式 zip**

   ```bash
   npm run release:pack
   ```

   检查：

   - `dist/framework-<version>.zip`
   - `dist/framework-<version>.manifest.json`（sidecar，不进 zip）

4. **dry-run 抽查（可选）**

   ```bash
   npm run release:pack -- --dry-run
   ```

5. **layout 烟测（已纳入 `harness` unit：`runner-layout-smoke`）**

   - standalone：`--phase docs` 报告写入 `harness/reports/`，不得出现 `framework/harness/reports/`
   - consumer：可用 `npm run release:pack -- --stage-only` 产出 `dist/release-staging/framework/` 作 fixture 来源

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

## 交互层 smoke（v4.0+）

在 framework 仓根执行（**Phase A 源模板 + Phase B 消费者 tmpdir smoke**）：

```bash
cd framework/harness && npx ts-node scripts/smoke-interaction-renderer.ts
```

对已 `/framework-init --adapter claude` 的消费者工程，可只验实例产物：

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

1. **init** — adapter 选型（registry `init.adapter`）
2. **PRD** — 术语映射 artifact gate（`prd.terminology`）
3. **coding** — 逐模块交付（`coding.module_batch`）
4. **UT** — DAG 确认（`ut.dag_confirm`）
5. **phase.next_step** — 跨阶段动态 label
6. **ad-hoc** — 未登记临时交互仍走 AskUserQuestion fallback

## 相关命令

| 命令 | 说明 |
|------|------|
| `npm run release:pack` | 产出 zip + manifest |
| `npm run release:pack -- --dry-run` | 只统计 include/exclude |
| `npm run release:pack -- --out D:/releases` | 指定输出目录 |
| `npm run release:verify` | 规则单测 + 临时目录打包/解压/断言 |

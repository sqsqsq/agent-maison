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

## 相关命令

| 命令 | 说明 |
|------|------|
| `npm run release:pack` | 产出 zip + manifest |
| `npm run release:pack -- --dry-run` | 只统计 include/exclude |
| `npm run release:pack -- --out D:/releases` | 指定输出目录 |
| `npm run release:verify` | 规则单测 + 临时目录打包/解压/断言 |

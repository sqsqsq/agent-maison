# Framework 3.3 发布说明（Init config modernize + Reports 外置）

**发布日期**：2026-05-25  
**对比基线**：Framework 3.2（§5.1.B 后置 BACKFILL 安全网）  
**适用读者**：实例工程维护者、Framework 维护者

---

## 摘要

`/framework-init` UPDATE 现支持 **三 pass config 同步**，无需手改 `framework.config.json` 即可 modernize 老实例：

| Pass | 机制 | 典型内容 |
|------|------|----------|
| 1 BACKFILL | 只补缺失 key | `paths.state_file`、`state_machine.*`、`toolchain.hvigor.*` |
| 2 MIGRATION | modernize 已有 key | `project_type` → `project_profile.sub_variant`，删 `project_type` |
| 3 CONFIRM | 行为级变更（Q1.C） | `paths.reports_dir_pattern` |

---

## 主要变更

### Init config 三 pass（`merge-framework-config.mjs`）

- `--apply`：Pass 1 + Pass 2 自动执行。
- `--confirm-reports-dir-pattern=y|n`：Pass 3，对应 Skill 00 **Q1.C**。
- `check-init` 第 1 项新增 `migration_keys`、`confirm_keys`。

### Reports 外置与 Q1.C

- 推荐值：`doc/features/<feature>/<phase>/reports`（SSOT：`config.ts` → `DEFAULT_REPORTS_DIR_PATTERN`）。
- **不进** `DEFAULT_PATHS` / silent BACKFILL：磁盘未配置时 runtime **仍回退** `framework/harness/reports/<feature>/<phase>/`。
- Q1.C=y 后由 merge 写入磁盘；Q1.C=n 保持 legacy（init 不自动搬迁旧报告文件）。

### Skill 00

- Step 2 不再写入顶层 `project_type`；改写 `project_profile.sub_variant`。
- §0.3.4 新增 **Q1.C**；§5.1.C / §5.1.D 文档化 migration + confirm pass。
- Step 7 须汇报 migration / Q1.C 结果，禁止「请手改 config」话术。

### 模板

- `framework.config.template.json`：修复 JSON 语法、加入 `reports_dir_pattern`（CREATE 整文件参照；UPDATE 仍走 Q1.C）。

---

## 升级指引

1. 更新 `framework/` submodule 到含 v3.3 的提交。
2. 工程根执行 **`/framework-init` UPDATE**；Q1.C 默认推荐 **y**。
3. Step 5.1.B：`merge-framework-config.mjs --apply`（backfill + migration）。
4. Q1.C=y：`merge-framework-config.mjs --apply --confirm-reports-dir-pattern=y`。
5. （可选）按 [`MIGRATION.md`](MIGRATION.md)「Legacy 报告手动迁移」搬迁旧报告。
6. 验证：`cd framework/harness && npm test`。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`MIGRATION.md`](MIGRATION.md) § v3.3.2 | 三 pass 机制与 checklist |
| [`skills/00-framework-init/SKILL.md`](skills/00-framework-init/SKILL.md) | Q1.C / §5.1.C / §5.1.D |
| [`harness/scripts/utils/config-field-merger.ts`](harness/scripts/utils/config-field-merger.ts) | BACKFILL / MIGRATION / CONFIRM SSOT |

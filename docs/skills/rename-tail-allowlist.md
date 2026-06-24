# Skill/Phase 改名尾巴 — allowlist 说明

> **机器真源**：[`scripts/rename-tail-inventory.mjs`](../../scripts/rename-tail-inventory.mjs) 内 `PATH_ALLOWLIST` 数组。本文为人读说明；增删放行路径须改脚本，再同步本节。

盘点脚本：[`scripts/rename-tail-inventory.mjs`](../../scripts/rename-tail-inventory.mjs)

```bash
node scripts/rename-tail-inventory.mjs
node scripts/rename-tail-inventory.mjs --fail-on-non-allowlisted
```

扫描范围：**仅发布文件集**（`collectReleaseFiles()`，与 zip 内容同口径）。不扫 dev-only（`.cursor/`、根 `scripts/`、`.gitignore`、`harness/tests/` 等）；allowlist 九类里列出的 dev 路径是为分类 SSOT，不代表会被本脚本扫到。全仓零残留需另开模式，非 P1 验收口径。

扫描模式：

- `\bprd\b` 词边界
- design-phase 残留（`--phase design`、`check:design`、`design 阶段`、`phase: design` 等）；**不**抓普通英文 `design`（如 UI design、`design.md` 文件名、OpenSpec `design.md`）
- numbered skill 路径与 `Skill N` prose；以及 backtick / bare / range 五 kind（见 [`harness/scripts/utils/no-numbered-skill-scan.ts`](../../harness/scripts/utils/no-numbered-skill-scan.ts)）

验收：**非 allowlist 命中 = 0**（非裸扫 after=0）。

## 九类 SSOT allowlist

| # | 类别 | 典型路径 / 说明 |
|---|------|----------------|
| 1 | 兼容 alias 实现 | `harness/scripts/utils/phase-alias.ts`、`capability-alias.ts`、`phase-transition-policy.ts`、`compat-loader.ts` |
| 2 | npm script alias | `harness/package.json` 的 `check:prd` / `check:design`（见 [`harness/README.md`](../../harness/README.md)） |
| 3 | 测试 fixtures / 单测 | `harness/tests/**`、`profiles/**/harness/tests/**` |
| 4 | 历史迁移脚本 | 根 `scripts/migrate-*`、`phase-rename-*`、`fix-unit-test-phases.mjs` 等（dev-only，不进 zip） |
| 5 | MIGRATION / RELEASE-NOTES / evolution 兼容叙事 | 破坏性叙事或维护同步中的 legacy `prd`/`design` 说明（含 `docs/evolution/extension-protocol-v1.md`、`extension-e2e-acceptance.md`） |
| 6 | 报告生成物 | `harness/reports/**` |
| 7 | OpenSpec `design.md` | `openspec/**`（dev-only） |
| 8 | 历史 plan | `.cursor/plans/**`（dev-only） |
| 9 | check 脚本内部标识 | `check-spec.ts` / `check-plan.ts` 内 `prd` 变量名、legacy 错误文案；`spec-visual-handoff-check.ts` 参数名 `prd` |
| 10 | 活编号 skill-id alias（运行时 + MIGRATION 镜像） | `harness/scripts/utils/profile-skill-assets.ts`（整文件 exclude）；`MIGRATION.md` 内 `profile-skill-asset` 对照表行（`LIVE_ALIAS_DOC_RULE` 内容匹配，非行号） |

额外固定放行：

- `summary.schema.json` / `trace.schema.json` 中 legacy enum 项
- `docs/concepts/phase-terminology.md` legacy 对照表
- `docs/visual-handoff-config-migration.md`、`docs/overview.md` 中的 alias 说明
- `skills/reference/confirmation-registry.yaml` 中 `prd.*` / `design.*` 确认点 id（兼容窗口内保留）
- `skills/project/framework-init/**` 中 legacy `prd` 段迁移说明
- **numbered-skill 扫描器 SSOT**：`no-numbered-skill-scan.ts`、`legacy-skill-bridge-cleanup.ts` 内 legacy 词表常量（自排除）

## P0 Option B 权衡（release 硬门禁）

- `release:verify` **硬门禁**含 MJS numbered-skill 五 kind scan（[`check-no-numbered-skill-release.mjs`](../../scripts/check-no-numbered-skill-release.mjs)）；与 harness `check:docs` 的 `no_numbered_skill_*` 口径对齐（prose/backtick/bare/range + path）
- consumer 侧 `check:docs` e2e 降为推荐烟测：`npm run release:smoke-consumer`
- **风险**：仅能在 consumer layout `check:docs` 触发的 BLOCKER，发版时可能不被 `release:verify` 自动拦住
- **缓解**：发版前跑 `release:smoke-consumer`；后续可评估扩 MJS gate 或把特定 check 子集纳入 verify

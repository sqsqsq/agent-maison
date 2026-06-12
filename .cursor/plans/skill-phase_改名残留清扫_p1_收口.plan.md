---
name: skill-phase 改名残留清扫 P1 收口
overview: P1 收口（2.3.0 同窗口）：收掉 prd/design 与剩余 Skill N 残留、修 summary.schema 等 SSOT、建 inventory/allowlist。与 P0 一并完成后再打发布件。
version: 2.3.0
deferred_from: skill-phase_改名残留清扫_b384bc66.plan.md
todos:
  - id: audit-inventory
    content: inventory 加宽口径（\bprd\b + design-phase + path/prose）+ before/after 基线 + allowlist 分类
    status: completed
  - id: wave1-ssot
    content: summary.schema enum、confirmation-registry、feature-compat 文档、code-graph、goal-mode/phase-terminology 等 SSOT
    status: completed
  - id: wave1-prompts
    content: harness/prompts + profiles/**/harness/prompts 旧 phase design→plan（verifier 直接消费）
    status: completed
  - id: wave2-prose-remainder
    content: tests/README、.gitignore、trace.schema、profile addendum 等剩余 Skill N 文案
    status: completed
  - id: allowlist-doc
    content: rename-tail-allowlist（九类 SSOT）+ Option B 权衡文档 + inventory --fail-on-non-allowlisted
    status: completed
  - id: verify-full
    content: 非 allowlist=0 + summary.schema 单测 + npm test + check:docs（含 doc_freshness）全 PASS
    status: completed
isProject: false
---

# Skill/Phase 改名残留清扫 — P1 收口

## 版本绑定

`version: 2.3.0`（与 P0 同窗口；两 plan 均 completed 后再 `release:pack`）。

## 前置条件

- [P0 plan](skill-phase_改名残留清扫_b384bc66.plan.md) 已完成：六份 feature SKILL 无 Skill N 编号、`check:docs` prose=0、MJS release 硬门禁已接入
- 宿主 init verify 已 PASS

## 范围

### 1. inventory（加宽口径）

- `\bprd\b`、design-phase 模式、numbered path/prose scan
- allowlist 九类（含 OpenSpec design.md、check 脚本内部命名）
- `--fail-on-non-allowlisted` 验收

### 2. SSOT / schema（含实质 bug）

| 项 | 说明 |
| --- | --- |
| `summary.schema.json` L30 | phase enum 与 runner `spec`/`plan` 对齐 |
| `confirmation-registry.yaml` L464 | 速查文案 |
| `feature-compat.schema.yaml` L15 | 仅文档过时（`compat-loader.ts` 已 normalize） |
| `code-graph/SKILL.md` | `spec/plan/coding` |
| goal-mode、phase-terminology、gap-notes、extensibility、compat-protocol | 见 P0 plan §A |

### 3. harness prompt 语义（§C）

`verify-plan.md`、`verify-coding.md`、`verify-ut.md`、`verify-coding.overlay.md` 等旧 phase `design` → `plan`。

### 4. 剩余 prose

`harness/tests/README.md`、`.gitignore`、`trace.schema.json`、profile addendum。

### 5. 扩展门禁 + allowlist 文档

- 可选：`npm test` standalone prose/path scan
- 可选：`check-phase-canonical-prose.ts`
- [`docs/skills/rename-tail-allowlist.md`](../docs/skills/rename-tail-allowlist.md) 或 MIGRATION 附录
- `harness/README.md` 说明 `check:prd` legacy

**allowlist 九类（SSOT）**：

1. 兼容 alias 实现（phase-alias、capability-alias 等）
2. npm script alias（`check:prd` / `check:design`）
3. 测试 fixtures / 单测断言
4. 历史迁移脚本（根 `scripts/migrate-*`）
5. MIGRATION / RELEASE-NOTES 叙事
6. 报告生成物（`harness/reports/**`）
7. OpenSpec `design.md` 三元组与 openspec skill 目录
8. 历史 plan（`.cursor/plans/`）
9. check 脚本内部标识（如 `check-spec.ts` 内 `prd` 变量名）

**P0 Option B 权衡（须在 allowlist/runbook 写明）**：

- P0 `release:verify` **硬门禁仅 MJS numbered-skill scan**；consumer docs e2e 降为推荐烟测
- **风险**：未来新增、且仅能在 consumer layout `check:docs` 触发的 BLOCKER，发版时可能不被 `release:verify` 自动拦住
- **缓解**：发版前跑 `release:smoke-consumer`；P1 评估是否扩 MJS gate 或把特定 check 子集纳入 verify

## 验收

1. `node scripts/<inventory>.mjs --fail-on-non-allowlisted` — 非 allowlist = 0
2. `summary.schema.json` 单测 / 样例 validate PASS
3. `cd harness && npm test` 全 PASS
4. `npm run check:docs` 全 PASS（`doc_freshness` MAJOR 清零）
5. spot-check：confirmation-registry、`verify-coding.md`、无 Skill `[0-6]`

## 实施顺序

1. inventory + allowlist 草案 + before 基线
2. Wave 1 SSOT / schema / prompt
3. 剩余 prose
4. 扩展门禁 + allowlist 定稿
5. after 基线 + 全量验收

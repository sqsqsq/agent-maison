---
name: 编号 skill 残留清扫
version: 2.4.0
overview: 清理重命名后遗留的少量编号化 skill 引用（确定瑕疵：code-review 的 SKILL.md 标题仍为 `4-code-review`；可选：6 个 feature SKILL.md 链接 label 的 `00-framework-init` 前缀），并为护栏正则补一条反引号 id 形（`(`N-xxx`)`）检测，把这类漏网纳入门禁防回潮。
todos:
  - id: fix-code-review-title
    content: "A: skills/feature/code-review/SKILL.md L1 标题 `4-code-review` → `code-review`"
    status: completed
  - id: normalize-init-labels
    content: "B(可选): 6 个 feature SKILL.md L7 链接 label `00-framework-init` → `framework-init`（目标路径已正确，仅改显示文字）"
    status: completed
  - id: harden-scanner
    content: "C: no-numbered-skill-scan.ts 增加反引号 id 形检测 `(`N-xxx`)`，复用现有排除口径，并兼容 B 的取舍"
    status: completed
  - id: verify-tests
    content: "D: 全仓复扫仅剩故意保留桶；cd harness && npm test 全 PASS；新护栏分支补最小单测 fixture"
    status: completed
isProject: false
---

# 编号 skill 残留清扫

> 版本窗口：绑定当前在研 `package.json.version = 2.4.0`，不 bump。落地为 `.plan.md` 时 frontmatter 须写 `version: 2.4.0`。
> 背景：结构性重命名（编号目录 → 扁平语义名 spec/plan/coding/...）已完成，无任何编号目录（`skills/**/[0-9]*-*/` 命中 0）。仓内已有护栏 `harness/scripts/utils/no-numbered-skill-scan.ts` + 单测在防回潮。本 plan 只清"护栏当前抓不到的少量漏网"。

## 现状分桶（已核实，勿误清）

- **不该动（历史/工具数据）**：`.cursor/plans/**`、`RELEASE-NOTES-v*.md`、`MAINTAINER-CHANGELOG.md`、`openspec/changes/archive/**`、迁移脚本 `scripts/utf8-rename-*.mjs` / `restore-*.mjs`、各 `harness/tests` fixtures —— 旧名是冻结历史或重命名映射数据。
- **故意保留（描述清理任务/迁移表）**：`MIGRATION.md`、[`agents/README.md`](agents/README.md) L58、[`docs/overview.md`](docs/overview.md) L224、[`docs/concepts/extensibility.md`](docs/concepts/extensibility.md) L113、[`skills/project/framework-init/SKILL.md`](skills/project/framework-init/SKILL.md) L180 —— 这些点名 `3-coding`/`1-prd-design` 是为讲清 `cleanup-deprecated` 与迁移对照，删了反而讲不清。
- **本 plan 处理（真漏网）**：见下。

## 改造点

### A. 确定瑕疵：code-review 标题（BLOCKER 级一致性）

- [`skills/feature/code-review/SKILL.md`](skills/feature/code-review/SKILL.md) L1 当前为 `# Code Review Skill (`4-code-review`)`，与兄弟 skill 不一致（`# Spec 阶段 Skill (`spec`)`、`# 编码 Skill (`coding`)`）。
- 改为 `# Code Review Skill (`code-review`)`。

### B. 可选：6 个 feature SKILL.md 的链接 label

- `spec` / `plan` / `coding` / `code-review` / `business-ut` / `device-testing` 各自 SKILL.md L7 的链接显示文字为 `` [`00-framework-init`](../../project/framework-init/SKILL.md) ``。
- 超链接**目标路径正确**（`project/framework-init/`），仅可见 label 带 `00-` 前缀。
- 决策点：若追求 label 与扁平命名一致 → 改显示文字为 `` `framework-init` ``；若认为 `00-framework-init` 是规范叫法 → 保留不动。**建议改**，与全仓扁平命名对齐。

### C. 护栏加固（防回潮，治本）

- 现有 `NUMBERED_PROSE_RE = /Skill\s*(?:00|0|[1-6])(?!\d).../` 只抓 `Skill N` 文案与 `skills/N-xxx/` 路径，抓不到 `` (`4-code-review`) `` 这种**反引号 id 形**（A 项漏网正因如此）。
- 在 [`harness/scripts/utils/no-numbered-skill-scan.ts`](harness/scripts/utils/no-numbered-skill-scan.ts) 增一条 backtick-id 检测（如匹配 `` `(?:00-framework-init|0-catalog-bootstrap|[1-6]-(?:spec|plan|coding|code-review|business-ut|device-testing))` ``），沿用现有 `NOISE_EXCLUDE_GLOBS` / `HISTORY_EXCLUDE_GLOBS` 排除口径，避免误伤 MIGRATION/历史。
- 注意保留对"故意保留桶"的兼容：B 桶若选择保留 `00-framework-init` label，则新正则需放行 framework-init 反引号形，或把这些行登记为 allowlist。

### D. 验收

- 全仓再扫一遍两类残留（路径 + 反引号 id），仅剩"故意保留桶"。
- `cd harness && npm test` 全 PASS（AGENTS.md BLOCKER）；新增护栏分支需带最小单测 fixture（正向/负向各一）。

## 顺序与力度

- 最小档：仅做 A（一行标题修正）。
- 推荐档：A + C（修瑕疵 + 护栏抓 backtick 形，杜绝再漏）。
- 完整档：A + B + C（再统一 label 风格）；B 涉及 6 文件但仅改显示文字，零行为影响。
---
name: feature artifact archival
overview: 把 doc/features/<feature>/ 下的阶段主产物（PRD.md、design.md、review-report.md、test-plan.md、test-report.md）统一归档进各自的 <phase>/ 子目录，与已有的 context-exploration.md / phase-completion-receipt.md / reports/ 同住；跨阶段全局契约（acceptance.yaml、contracts.yaml 等）保持在 feature 根目录。通过在 config.ts 引入"产物→阶段"SSOT 映射 + 双读解析器实现，新布局为默认、旧扁平路径在读取侧回退兼容。
todos:
  - id: opsx-propose
    content: 用 /opsx-propose 建立 OpenSpec 变更：proposal.md + init/feature-artifact 布局 spec delta + tasks.md
    status: completed
  - id: config-ssot
    content: 在 harness/config.ts 新增 PHASE_SCOPED_ARTIFACTS(basename键) + artifact resolver 契约（featureArtifactPath / resolveFeatureArtifact 返回 {actualPath,canonicalPath,legacyPath,usedLegacy,legacyDuplicate,exists} / relFeatureArtifact / featureArtifactPhaseOf）；入参带 <phase>/ 前缀须幂等归一化，exists=false 时 actualPath===canonicalPath，ut 产物无扁平 legacy
    status: completed
  - id: wire-entry
    content: spec-loader.inspectFeatureArtifacts 与 harness-runner 入口校验改为按产物逐个 resolve（阶段产物走嵌套、全局契约走根），避免误判缺文件
    status: completed
  - id: wire-reads
    content: 全部产物读点改用 resolver——spec-loader.loadFeatureDoc、check-coding(design.md/contracts)、check-ut(loadDesignMd)、check-testing(111/920/1622/1715 test-plan/report)、derive-hylyre-plan-hint、harness-runner.collectContextFiles、backfill-context-exploration.ARTIFACT_REL 存在性判断
    status: completed
  - id: wire-catalog
    content: check-catalog.ts feature_scope_integrity 反扫 PRD.md/design.md 改为按 resolver 解析新旧路径，避免漏报/SKIP
    status: completed
  - id: wire-labels
    content: 错误消息/affected_files/verifier label 用 canonicalPath 引导新布局，同时在 usedLegacy 时提示"当前读到旧路径"；新旧并存(legacyDuplicate)时报 WARN
    status: completed
  - id: skills-update
    content: 更新 skills 0/1/2/3/4/5/6 SKILL.md（含 0-catalog-bootstrap L581 反扫说明、Step 0 输入矩阵 + 路径表格）、profiles/*/skills/* addendum 与 templates、specs/phase-rules overlays、harness/prompts/verify-*.md(L182 等)中产物路径文案
    status: completed
  - id: profile-harness
    content: profile 侧 harness 代码改造——prd-visual-handoff-check.ts L300 label 改 relFeatureArtifact，并扫 profiles/*/harness/** 同类硬编码
    status: completed
  - id: fixtures-migrate
    content: 迁移代表性 fixtures 到新布局，保留至少 1 个旧扁平 fixture 验证 dual-read 回退；新增 1 个新旧并存 fixture 验证冲突 WARN
    status: completed
  - id: unit-tests
    content: 为 config.ts 新解析器补单测（canonical 写路径 + dual-read 回退 + legacyDuplicate 冲突）；入参四态全覆盖 ut/mock-plan.yaml、mock-plan.yaml、testing/test-plan.md、test-plan.md，防双层目录归一化漏出
    status: completed
  - id: docs-inventory
    content: 更新 feature 目录布局对外文档（overview.md / harness-runbook.md / acceptance-layering.md 等）并登记 docs/DOC_INVENTORY.yaml
    status: completed
  - id: verify
    content: cd harness && npm test 全 PASS + npm run openspec:validate 通过；随后 /opsx-archive 归档变更
    status: completed
isProject: false
---

# Feature 产物按阶段归档重构

## 背景与现状（已确认）

`doc/features/<feature>/` 目前两种布局并存（演进遗留）：

- 扁平在根目录：`PRD.md`、`design.md`、`review-report.md`、`test-plan.md`、`test-report.md`（阶段主产物）+ `contracts.yaml`/`acceptance.yaml`/`use-cases.yaml`/`boundaries.yaml`/`compat.yaml`（跨阶段契约）
- 已在阶段子目录：`<phase>/context-exploration.md`、`<phase>/phase-completion-receipt.md`、`<phase>/reports/*`（由 `receipt_dir_pattern`、`reports_dir_pattern` 驱动）；`ut/` 阶段更已把主产物 `ut/testability-audit.md`、`ut/mock-plan.yaml` 收进子目录（现成范式）。

问题根因：产物路径是散落在各 `check-*.ts` / `harness-runner.ts` / `spec-loader.ts` 的硬编码字面量（如 `featureFilePath(.., 'PRD.md')`、`path.join(.., 'doc','features',feature,'design.md')`），没有"产物→路径"的 SSOT，导致同一 feature 内布局不一致。

## 目标布局

```
doc/features/<feature>/
  acceptance.yaml          # 全局契约（不动）
  contracts.yaml           # 全局契约（不动）
  contracts.planned.yaml   # 全局契约（不动）
  use-cases.yaml           # 全局契约（不动）
  boundaries.yaml          # 全局契约（不动）
  compat.yaml              # 全局（不动）
  prd/      { PRD.md,         context-exploration.md, phase-completion-receipt.md, reports/ }
  design/   { design.md,      context-exploration.md, phase-completion-receipt.md, reports/ }
  coding/   {                 context-exploration.md, phase-completion-receipt.md, reports/ }
  review/   { review-report.md, context-exploration.md, phase-completion-receipt.md, reports/ }
  ut/       { testability-audit.md, mock-plan.yaml, context-exploration.md, ... } # 已就位
  testing/  { test-plan.md, test-report.md, context-exploration.md, ... }
```

## 设计（SSOT + 双读兼容 + 冲突可见）

不修改低层 `featureFilePath`（保持纯 join）。在 [harness/config.ts](harness/config.ts) 新增一套 **artifact resolver 契约**：

- `PHASE_SCOPED_ARTIFACTS`：产物**基名（basename）** → 阶段名 的 SSOT 映射，**须显式列全所有阶段产物**（不是"只列 5 个主产物"）：
  - 需迁移（有扁平 legacy）：`PRD.md→prd`、`design.md→design`、`review-report.md→review`、`test-plan.md→testing`、`test-report.md→testing`
  - 已就位（无 legacy）：`testability-audit.md→ut`、`mock-plan.yaml→ut`
- **UT 产物如何表达（评审点 1，写清楚避免误读）**：在映射里**显式列出** `testability-audit.md→ut`、`mock-plan.yaml→ut`，并用一个独立集合 `ALREADY_PHASED_ARTIFACTS = { 'testability-audit.md', 'mock-plan.yaml' }` 标注其 **no legacy**（canonical 本就是 `ut/...`，历史从无扁平形态）。resolver 对这类产物 `legacyPath===canonicalPath`、`usedLegacy` 恒 false、`legacyDuplicate` 恒 false。
- **入参幂等归一化**：若 `fileName` 已带 `<phase>/` 前缀（如 `backfill` 传入的 `ut/mock-plan.yaml`），先 strip 同名前缀再按 basename 计算，杜绝 `ut/ut/testability-audit.md`。
- `featureArtifactPhaseOf(fileName)`：返回该产物归属阶段或 `null`（全局契约）。
- `featureArtifactPath(projectRoot, feature, fileName)`：**写路径（canonical）**——命中映射返回 `<features_dir>/<feature>/<phase>/<basename>`，否则回退 feature 根（全局契约行为不变）。复用 `receiptDirPath` 占位符语义，确保与 context-exploration/receipt 同目录。
- `resolveFeatureArtifact(projectRoot, feature, fileName)`：**读解析（dual-read，返回状态）**——返回
  `{ actualPath, canonicalPath, legacyPath, usedLegacy, legacyDuplicate, exists }`，状态语义（实施时须落清楚）：
  - 新路径存在 → `actualPath=canonicalPath, usedLegacy=false`
  - 仅旧扁平路径存在 → `actualPath=legacyPath, usedLegacy=true`（diagnostics 既引导新路径、也说明当前读的是 legacy，解决评审点 5）
  - 新旧同时存在 → `actualPath=canonicalPath, legacyDuplicate=true`（解决评审点 6 的双 SSOT 漂移）
  - **都不存在 → `exists=false` 且 `actualPath===canonicalPath`**（缺文件时一律指向新布局，便于错误消息/写入引导）
  - **`legacyDuplicate` 的 WARN 在单一入口统一产出**（由 resolver 标记、由一个共享的 check 辅助函数发 WARN），各 checker 不各自重复实现。
- `relFeatureArtifact(...)`：canonical 路径的 POSIX 相对串（错误消息 / verifier 标签 / affected_files 用）。

> dual-read 仅用于"读取侧"；任何写入一律走 `featureArtifactPath` 的 canonical 新路径，杜绝新增旧布局。

## 改造点（按评审补全）

### A. 入口校验（评审点 1）

- [spec-loader.ts](harness/scripts/utils/spec-loader.ts) `inspectFeatureArtifacts`（L154）当前用 `REQUIRED_FEATURE_FILES_BY_PHASE`（含 `PRD.md`/`design.md`）在 feature 根逐个 `existsSync`。改为对每个 required/optional 文件走 `resolveFeatureArtifact`（阶段产物找嵌套路径、全局契约找根），`missingRequiredFiles` 以 resolver 的 `exists` 为准；`sameNameArchives` 旁证逻辑保留。
- [harness-runner.ts](harness/harness-runner.ts) L320 调用点随之生效；`printFeatureArtifactInspection` 展示时区分"新路径/兼容旧路径命中"。

### B. 读点（评审点 3、4 + 既有）

全部改用 `resolveFeatureArtifact(...).actualPath`：

- `spec-loader.loadFeatureDoc`（L236，PRD/design/review-report/test-plan/test-report 统一入口）
- [check-coding.ts](harness/scripts/check-coding.ts) L217（design.md）、L272（contracts.yaml 全局不变，仅核对）
- [check-ut.ts](harness/scripts/check-ut.ts) `loadDesignMd` L258（写死 `doc/features/<feature>/design.md`）
- [check-testing.ts](harness/scripts/check-testing.ts) L111、L920、L1622、L1715（test-plan.md / test-report.md）
- [derive-hylyre-plan-hint.ts](harness/scripts/derive-hylyre-plan-hint.ts) L42（写死 `doc/features/<feature>/test-plan.md`，否则派生 hint 与 freshness/coverage gate 读不到 canonical）
- [harness-runner.ts](harness/harness-runner.ts) `collectContextFiles`（L1123-1228）的内容收集与 label
- **[backfill-context-exploration.ts](harness/scripts/backfill-context-exploration.ts) `ARTIFACT_REL`（L24-34，评审点 2）**：该数组按"产物存在性"决定哪些 phase 需回填 context-exploration，列了 `PRD.md/design.md/review-report.md/test-plan.md/test-report.md`（且已用 `ut/mock-plan.yaml`/`ut/testability-audit.md` 前缀形态）。属工具脚本而非普通 checker 读点，**易被全仓字面量普查覆盖到却在实施时漏改**——存在性判断须改走 resolver。

### C. catalog 全局反扫（评审点 2）

- [check-catalog.ts](harness/scripts/check-catalog.ts) `feature_scope_integrity`（L668-692）反扫 `['PRD.md','design.md']`：改为对每个 feature 目录用 resolver 解析 PRD/design 的实际路径（新优先、旧回退）再 `parseScope`，避免迁移后漏报 / `scannedCount===0` 误 SKIP。

### D. 标签与冲突（评审点 5、6）

- 错误消息 / `affected_files` / verifier label 统一用 `canonicalPath`（引导新布局）；当 `usedLegacy=true` 时附注"当前命中兼容旧路径 `<legacyPath>`，建议迁移"。
- 当 `legacyDuplicate=true`：在对应 check 增一条 WARN（"legacy duplicate exists"），提示删除旧扁平副本，防止新旧内容漂移。

## Skill / 文档 / 规约（评审点：范围扩大）

旧路径表达不止 1/2/4/6，需一并更新：

- SKILL.md：[0-catalog-bootstrap](skills/0-catalog-bootstrap/SKILL.md)（L581 `feature_scope_integrity` 说明里"扫描 `doc/features/*/PRD.md` 与 `design.md`"——与 catalog 反扫改造点对应，必须同步）、[1-prd-design](skills/1-prd-design/SKILL.md)、[2-requirement-design](skills/2-requirement-design/SKILL.md)、[3-coding](skills/3-coding/SKILL.md)（L82-87 路径表 + Step 0 输入矩阵）、[4-code-review](skills/4-code-review/SKILL.md)、[5-business-ut](skills/5-business-ut/SKILL.md)（L92-102 路径表 + L153 必读项）、[6-device-testing](skills/6-device-testing/SKILL.md)
- `profiles/*/skills/*/profile-addendum.md` 与 `profiles/*/skills/*/templates/*`
- **profile 侧 harness 代码（收尾建议 1）**：[prd-visual-handoff-check.ts](profiles/hmos-app/harness/prd-visual-handoff-check.ts) L300 仍用 `relFeatureFile(.., 'PRD.md')` 作 label，至少改成 canonical `relFeatureArtifact`；并扫一遍 `profiles/*/harness/**` 是否还有同类硬编码。
- **harness prompt 文案（收尾建议 2）**：[verify-testing.md](harness/prompts/verify-testing.md) L182 `affected_files` 示例仍写 `doc/features/{feature}/test-plan.md`；连同 `harness/prompts/verify-*.md` 一并按新布局更新——非运行时读点，但影响 verifier/agent 行为预期。
- `specs/phase-rules/*-rules.yaml` 中引用产物路径的 overlay/描述
- 对外文档：[docs/overview.md](docs/overview.md)、[docs/operations/harness-runbook.md](docs/operations/harness-runbook.md)、[docs/concepts/acceptance-layering.md](docs/concepts/acceptance-layering.md) 等含旧路径表达处，并登记 [docs/DOC_INVENTORY.yaml](docs/DOC_INVENTORY.yaml)
- 实施前先做一次全仓字面量普查（`PRD.md` / `design.md` / `test-plan.md` / `review-report.md` 的 `doc/features/...` 拼写），按命中清单逐一处理，避免漏点。

## 测试与验收

- Fixtures：把代表性用例迁到新布局（`PRD.md→prd/PRD.md` 等）；**保留 ≥1 个旧扁平 fixture** 验证 dual-read 回退；**新增 1 个新旧并存 fixture** 验证 `legacyDuplicate` WARN。其余 `profiles/hmos-app/harness/tests/fixtures/**` 按需同步。
- 单测：`config.ts` resolver 的 canonical 写路径 / dual-read 回退 / legacyDuplicate 冲突三态（参考 [receipt-path-reconcile.unit.test.ts](harness/tests/unit/receipt-path-reconcile.unit.test.ts)）。**必须覆盖四种入参形态**：`ut/mock-plan.yaml`、`mock-plan.yaml`、`testing/test-plan.md`、`test-plan.md`——验证带前缀与不带前缀都归一到同一 canonical，杜绝双层目录（`ut/ut/...`、`testing/testing/...`）。
- 验收（AGENTS.md BLOCKER）：`cd harness && npm test` 全 PASS **且** `npm run openspec:validate` 通过（覆盖 OpenSpec 变更自身）。

## 形式载体（OpenSpec）

按 AGENTS.md，框架自身演进走 OpenSpec：先 `/opsx-propose` 建变更（proposal + 受影响 spec delta + tasks），实现后 `/opsx-archive`。本计划即该提案的实现蓝本。

## 实施记录（2026-06-02）

- OpenSpec 已归档：`openspec/changes/archive/2026-06-02-feature-artifact-archival/`；主 spec：`openspec/specs/feature-artifact-layout/spec.md`
- 验收：`cd harness && npm test` → 507 unit + 32 fixture PASS；`npm run openspec:validate` PASS
- 补全项：`printFeatureArtifactInspection` 解析路径展示；fixture `prd/legacy_duplicate_prd_warn`；PRD 部分 fixture 迁至 `prd/PRD.md`；`ext_compat_legacy_pass` 保留扁平 dual-read
- 规则澄清：`.cursor/rules/plan-execution.mdc`（计划正文不可改，todo status 可更新）

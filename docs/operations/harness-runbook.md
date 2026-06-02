# Harness 全链路验证操作手册

> **本文档定位**：framework Harness 实际怎么跑 / 报告在哪 / 出错怎么排查的**操作手册**。
>
> **不是**：单 Skill 的使用手册（在各 SKILL.md 里）；也不是设计讲解（在 [`../overview.md`](../overview.md) 里）。
>
> **读完后你会**：知道默认 **spec-driven** workflow 下的 **phase**（全局 5 + 功能 6）各自管什么、单条命令怎么写、报告路径在哪、常见错误的排查思路。**Phase 合法集合 SSOT**：[`spec-driven.workflow.yaml`](../../workflows/spec-driven.workflow.yaml)；工作流入门见顶层 [`README.md`](../../README.md)「阶段化工作流」。

---

## 0. Profile 与检查项

**检查项 ID**（例如 `coding_hvigor_build`、`ut_hvigor_test`）是否出现在某阶段、是否为 BLOCKER，由实例 **`framework.config.json > project_profile`** 决定的 active **profile**（`framework/profiles/<name>/` 的 capabilities + `phase-rules-overlays`）共同声明；`generic` 等 profile 可能禁用整段宿主编译或 UT 真机链，runbook 仍适用「怎么跑 runner / 报告在哪」，但具体规则名可能未注册。

- **hmos-app**（DevEco / hvigor / hdc / hypium / ohosTest 等）的**命令、调优与排障**：见 [`../profiles/hmos-app-harness-toolchain.md`](../profiles/hmos-app-harness-toolchain.md)。
- 下文 phase 表与部分门禁速查在举例 **hmos-app** 常见 ID；其它 profile 以各自文档与 harness 报告为准。

---

## 1. 本文档的边界

| 范围                                                                                                                                                     | 状态                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 在已有产物（catalog、glossary、PRD、design、代码、review、UT、测试计划/报告等）的前提下，按阶段运行**脚本 Harness**：读 Spec 与文档/代码，执行 `check-*.ts`，生成报告 | ✅ 本文档覆盖                         |
| "一键完成"Skill 0 → PRD → 设计 → 编码 → Review → UT → 真机测试的开发流水线                                                                                | ❌ Harness 不是开发流水线，而是质量门禁 |
| AI Harness 自动调模型                                                                                                                                    | ❌ 脚本只生成 `ai-prompt.md`，不会自动调用任何大模型；语义审查需自行把 prompt 发给所选模型 |

---

## 2. Phase 总览（spec-driven：**11** 项 `artifacts`，分全局 / 功能）

合法 phase 集合与 **DAG `requires`** 以 **[`spec-driven.workflow.yaml`](../../workflows/spec-driven.workflow.yaml)** 为准（实例可通过 `framework.config.json > active_workflow` 切换到其它 YAML）。下表对齐该文件：**全局**不要求 `--feature`（runner 使用 `_global`）；**功能**必须 `--feature <name>`。

### 2.1 全局 phase（scope=global，`requires` 均为 `[]`）

| Phase       | check 脚本            | 对象 / 摘要 |
| ----------- | --------------------- | ----------- |
| `extensions` | `check-extensions.ts` | 实例扩展目录 [`doc/extensions/`](../../../doc/extensions/README.md)（manifest、hooks、skills 等）合法性 |
| `init`       | `check-init.ts`       | framework-init **体检**：`framework.config.json`、入口文件、adapter 模板、宿主工具链、`check-init.json` |
| `catalog`    | `check-catalog.ts`    | `doc/module-catalog.yaml`；画像结构、`easily_confused_with`、`key_exports_fresh_vs_index`、`feature_scope_integrity` 等 |
| `glossary`   | `check-glossary.ts`    | `doc/glossary.yaml`；术语结构、`seed_no_technical_words` 等 |
| `docs`       | `check-docs.ts`      | `framework/docs/**/*.md` 登记与新鲜度（`DOC_INVENTORY.yaml`）；详见 §6 |

### 2.2 功能 phase（scope=feature，依赖关系见 YAML `requires`）

| Phase       | 对象                     | `--feature` | `requires`（前置） |
| ----------- | ------------------------ | ----------- | ------------------ |
| `prd`       | `doc/features/<feature>/prd/PRD.md` | **必填** | `catalog`, `glossary` |
| `design`    | `design/design.md` 等    | **必填** | `prd` |
| `coding`    | 代码 + 根目录 `contracts.yaml` | **必填** | `design` |
| `review`    | `review/review-report.md` | **必填** | `coding` |
| `ut`        | DAG / `*.test.ets` 等  | **必填** | `coding` |
| `testing`   | 真机计划 / 报告        | **必填** | `ut` |

`review` 与 `ut` 均挂在 `coding` 之后并行延伸；`testing` 必须在 `ut` PASS 链路之后。

### 2.3 `compat.yaml`（不是 phase）

存量 feature 在 framework 升级后遇 BLOCKER 时，可在 `doc/features/<feature>/compat.yaml` 做 **可过期** 临时降级，仅作用于 **prd / design / coding / review / ut**（**不含 `testing`**；全局 phase **短路**）。协议见 [`../evolution/compat-protocol-v1.md`](../evolution/compat-protocol-v1.md)。

全局阶段在 `harness-runner` 内使用哨兵 feature **`_global`**，报告目录形如：
`framework/harness/reports/_global/<phase>/`。

---

## 3. 一次性跑全链路（仅脚本检查）

在仓库根目录下，先全局、再按 feature。

### 3.1 PowerShell（Windows）

```powershell
Set-Location "framework/harness"

# ---------- 全局 phase（无 --feature；顺序可按需调整；init 需 adapter 名） ----------
npx ts-node harness-runner.ts --phase extensions
npx ts-node harness-runner.ts --phase init --adapter claude   # 替换为当前 adapter
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
npx ts-node harness-runner.ts --phase docs

# ---------- 功能 phase（需 --feature；须满足 workflow requires，如 prd 前先跑过 catalog+glossary） ----------
$feat = "home-page"
foreach ($p in @('prd','design','coding','review','ut','testing')) {
  npx ts-node harness-runner.ts --phase $p --feature $feat
}
```

### 3.2 bash（Linux / macOS / WSL）

```bash
cd framework/harness

npx ts-node harness-runner.ts --phase extensions
npx ts-node harness-runner.ts --phase init --adapter claude   # 替换为当前 adapter
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
npx ts-node harness-runner.ts --phase docs

FEATURE=home-page
for p in prd design coding review ut testing; do
  npx ts-node harness-runner.ts --phase "$p" --feature "$FEATURE"
done
```

### 3.3 单阶段示例

```bash
# 全局
npx ts-node harness-runner.ts --phase extensions
npx ts-node harness-runner.ts --phase init --adapter claude
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase docs

# 功能
npx ts-node harness-runner.ts --phase prd --feature home-page
npx ts-node harness-runner.ts --phase ut  --feature home-page

# 适合 agent / CI 消费的稳定摘要输出（不要再 grep 完整日志）
npx ts-node harness-runner.ts --phase coding --feature home-page --summary --failures-only
npx ts-node harness-runner.ts --phase ut --feature home-page --summary --failures-only
npx ts-node harness-runner.ts --phase testing --feature home-page --summary --failures-only

# 默认控制台已折叠 PASS 与普通 SKIP；需要完整检查项时显式加 --verbose
npx ts-node harness-runner.ts --phase coding --feature home-page --verbose
```

### 3.4 列出可用 Spec

```bash
npx ts-node harness-runner.ts --list
```

---

## 4. 报告输出路径

**全局阶段**（`init` / `catalog` / `glossary` / `docs` / `extensions`，`feature` 哨兵 `_global`）仍在 **framework 树下**：

```
framework/harness/reports/_global/
├── extensions/
├── init/<timestamp>/...
├── catalog/<timestamp>/...
├── glossary/<timestamp>/...
└── docs/...
```

**Feature 维度阶段**（prd / design / coding / review / ut / testing）的报告目录由 **`framework.config.json` → `paths.reports_dir_pattern`** 解析；推荐与默认实例一致：

```
doc/features/<feature>/
├── prd/reports/
├── design/reports/
├── coding/reports/
├── review/reports/
├── ut/reports/
└── testing/reports/
```

每个 `reports/` 下典型包含：`script-report.json`、`summary.json`、`merged-report.md`、`ai-prompt.md`、`trace.json`、`verifier.report.md`，以及宿主 profile 落地的构建/装机日志等。

若 **未配置** `reports_dir_pattern`，harness **回退**到历史布局：`framework/harness/reports/<feature>/<phase>/`（与 `_global/` 并列）。

**关键文件**：

| 文件                    | 谁读                      | 何时看                                                  |
| ----------------------- | ------------------------- | ------------------------------------------------------- |
| `script-report.json`    | CI / 程序                 | 自动化脚本判 PASS/FAIL                                  |
| `summary.json`          | agent / CI / 调试          | 稳定读取 verdict、blockers、run_statuses、next_action，替代 grep 控制台 |
| `merged-report.md`      | 人类                      | 排查"为什么 FAIL"                                       |
| `ai-prompt.md`          | verifier 子 agent / 你    | 把它发给 AI 模型做语义级复核                            |
| `trace.json`            | harness 内部 / 调试       | 记录本次进入 phase 时的 git HEAD（供 ut_no_src_mutation 用） |

> v2.8 起控制台默认只展开 `FAIL` / `WARN` / `BLOCKER-SKIP`。脚本 PASS 只表示结构级 harness 没有 BLOCKER 失败，阶段闭环仍需要 verifier 子 agent PASS 与 completion receipt。

`summary.json` 的稳定契约见 `framework/harness/schemas/summary.schema.json`。关键字段：

- `run_statuses`：阶段状态面板，例如 `coding_run_status` / `ut_run_status` / `testing_run_status`。
- `readiness_signals`：非 BLOCKER 但代表"尚未就绪"的信号，例如 catalog/glossary 空骨架、docs freshness 无法判定。
- `blocking_warnings` / `blocking_skips`：`severity=BLOCKER` 但状态为 `WARN/SKIP` 的检查项，避免被 verdict PASS 掩盖。
- `next_action`：给 agent / Stop hook 的下一步建议；同会话未闭环时，Stop hook 会把最近一次 `summary.json.next_action` 带入阻断文案。
- `closure_status`：`open` | `closed`；`closed` 当且仅当 `check-receipt.ts` 会通过（与 `receipt_status=passed` 对齐）。closed 时 `next_action=phase_closed_wait_user`。
- **跨会话恢复**：`cd framework/harness && npx ts-node harness-runner.ts --sync-closure --phase <phase> --feature <feature>` 或单独跑 `check-receipt.ts`（PASS 时也会回写 `.current-phase.json`）。见 `AGENTS.md` §5.2。

---

## 5. 各阶段关键脚本门禁速查

> 完整规则定义见 `framework/specs/phase-rules/<phase>-rules.yaml`；
> 实现见 `framework/harness/scripts/check-<phase>.ts`。

### 5.1 catalog（`check-catalog.ts`）

- **结构**：schema、`modules[]` 必填字段、layer/format、唯一性等
- **追溯**：`easily_confused_with` 指向存在、无自引用 / 空 module（BLOCKER）、对称性（MAJOR，可 `unidirectional` 豁免）、`entry_file` 在磁盘、`layer_matches_path`
- **U2** `key_exports_fresh_vs_index`（MAJOR / WARN）：HAR/HSP 库模块 `key_exports` 与 `Index.ets` 顶层 export 漂移时告警
- **C3** `feature_scope_integrity`（MAJOR / WARN）：反向扫描各 feature 的 `prd/PRD.md` 与 `design/design.md`（读侧兼容旧扁平路径）的 Scope YAML，列出引用 catalog 未建档模块的文档（提前暴露后续 `scope_matches_catalog` 会 BLOCKER 的漂移）

### 5.2 glossary（`check-glossary.ts`）

- **结构**：`terms[]`、字段完整性、term/alias 不重复
- **P0-2** `seed_no_technical_words`（BLOCKER）：`glossary-seed.txt` 中 CamelCase 或与模块名重名等；`doc/glossary-seed-allowlist.txt` 可豁免
- **追溯**：`canonical_module` 在 catalog 存在、`owner_layer` 与 catalog 一致等

### 5.3 prd（`check-prd.ts`）

- **结构**：必需章节、`## 0. 术语映射表` 表格列与用户确认 `[x]`、`Scope 声明` 内 YAML 等
- `terminology_mapping_table`：权威模块须在 catalog；与 `glossary.yaml` 无冲突
- `scope_matches_catalog`：`in_scope_modules` / `out_of_scope_modules` 每项须在 catalog 建档
- **C1a** `terminology_modules_within_scope`（BLOCKER）：术语映射表「权威模块」须出现在 in_scope 或 out_of_scope 之一
- **C1b** `glossary_terms_used_in_body`（MAJOR / WARN）：glossary 术语（含 aliases）在 PRD **正文**（去掉术语映射表段落后）出现但未进映射表时告警

### 5.4 design / coding / review / testing

行为与对应 `framework/specs/phase-rules/<phase>-rules.yaml` 及 `check-<phase>.ts` 一致。`doc/features/<feature>/` 下：**跨阶段契约**（`acceptance.yaml`、`contracts.yaml`、`use-cases.yaml` 等）在 feature **根目录**；**阶段主产物**在 `<phase>/` 子目录（如 `prd/PRD.md`、`design/design.md`、`testing/test-plan.md`），与 `context-exploration.md`、`phase-completion-receipt.md`、`reports/` 同树。路径由 `harness/config.ts` 的 artifact resolver（`PHASE_SCOPED_ARTIFACTS`）统一解析；读侧 dual-read 兼容旧扁平路径。

#### Feature Artifact Resolution Protocol

所有 feature 维度阶段都遵循同一条解析规则：`doc/features/<feature>/` 这个精确目录才是正式 feature；阶段主产物的 canonical 路径见 `featureArtifactPath` / `relFeatureArtifact`。`doc/features/<feature>.rar`、`<feature>.zip`、`<feature>.7z`、`<feature>.tar*`、`<feature>-old/`、`<feature>.md` 等同级条目只作为旁证展示，不进入 feature 列表，不参与规约加载，也不会被 harness 自动解压。

- PRD 阶段是创建者：目录不存在时可以创建；若精确路径已存在但不是目录，或仅存在同名归档，应先让用户确认 feature 名称或恢复动作。
- design / coding / review / ut / testing 是消费者：目录不存在时快速失败；目录存在但阶段必需文件缺失时报告缺失文件，不从归档补洞。
- `SpecLoader.listAvailableFeatures()` 只返回目录；`inspectFeatureArtifacts(feature, phase)` 只做只读诊断，不修改文件、不恢复归档、不依赖 `.current-phase.json` / reports / trace。

**v2.2 / v2.3 起常见 BLOCKER**（是否注册取决于 **active profile**；UT 全流程叙事见 [`../skills/5-business-ut.md`](../skills/5-business-ut.md)）：

| Phase   | 规则（hmos-app 示例） | 摘要 |
| ------- | --------------------- | ---- |
| coding  | `coding_hvigor_build` | 宿主编译（hvigor / DevEco 对齐） |
| ut      | `ut_tsc_compiles` / `ut_hvigor_build` / `ut_hvigor_test` / `ut_no_src_mutation` | 测试源静态检查、ohosTest 构建与真机 hypium、harness 允许的源码变更登记 |
| testing | `device_test.build` / `install` / `run` | Hylyre 真机链；`acceptance.yaml` > `device_focus` 派生 test-plan |

**Context Exploration Gate（v2.9）**：prd / design / coding / review / ut 写主产物前须 `context-exploration.md`（schema **1.1.0**）；量化阈值见 phase-rules + `exploration-strategy.ts`；存量 feature 可用 `compat.yaml` 或 `npm run backfill:context`。

**命令装配、日志、`toolchain.hvigor` 调优与逐项排障**：见 [`../profiles/hmos-app-harness-toolchain.md`](../profiles/hmos-app-harness-toolchain.md)。

### 5.5 ut（`check-ut.ts`）

- 详见 [`../skills/5-business-ut.md`](../skills/5-business-ut.md)
- 简明清单：`ut_import_whitelist` / `it_drives_flow` / `branch_coverage_full` / `acceptance_coverage` / `ut_tsc_compiles` / `ut_hvigor_build` / `ut_hvigor_test` / `ut_no_src_mutation`
- 调度：`capability-registry.ts` → profile `ut-host-impl` / `hvigor-runner` / `hdc-runner`

### 5.6 testing（`check-testing.ts`）

- 标准 feature：`acceptance.yaml`（`device_focus`）→ 派生 / lint `test-plan.md` → **`device_test.build`** → **`install`** → **`run`**（Hylyre）
- 即席 `_adhoc`：`npm run adhoc-device-test`（derive → `test-steps.json` → lint → 执行）；详见 [`../../skills/6-device-testing/SKILL.md`](../../skills/6-device-testing/SKILL.md)
- **`device-testing-todo.md` 已废弃**；SSOT 为 acceptance 分层，见 [`../concepts/acceptance-layering.md`](../concepts/acceptance-layering.md)

---

## 6. v2.4 新增：`docs` phase（framework 自身文档新鲜度）

### 6.1 用途

随 framework 内部代码 / Skill / 规约不断演进，对外文档（[`framework/docs/**.md`](../)）容易漂移。`docs` phase 用 git 提交时间戳自动比对：

- `framework/docs/DOC_INVENTORY.yaml` 声明每份文档"关心"哪些 framework 内部资产
- `check-docs.ts` 对每份 doc 取 git committer date，对其 `sources[]` 也取 git committer date
- 任一 source 在 doc 之后改动过 → MAJOR：doc 可能已过期

### 6.2 跑法

```bash
cd framework/harness
npx ts-node harness-runner.ts --phase docs
```

### 6.3 报告样例

```
framework/docs/skills/5-business-ut.md (doc_ts=2026-04-25T10:00:00+08:00):
    ↳ framework/skills/5-business-ut/SKILL.md 更新于 2026-04-26T15:00:00+08:00
    ↳ framework/specs/phase-rules/ut-rules.yaml 更新于 2026-04-26T16:00:00+08:00
```

### 6.4 收到 stale 提醒怎么办

| 情况                                     | 操作                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| source 改动确实改了文档涉及的语义        | 更新 doc，正常 commit；下次 check 自动过                                          |
| source 只是无关重构（变量重命名 / 注释） | `touch` 文档文件并 commit `"docs: sync without content change"`，下次自动过        |
| source 已删除，inventory 还指向它        | 修 `DOC_INVENTORY.yaml > docs[].sources`：去掉过期路径                            |
| source 影响很小，不该每次它一动都报警    | 把它从 inventory 中该 doc 的 `sources` 里移出；不要随手改 severity                 |

### 6.5 退出码语义

- 全部 PASS / 仅 SKIP（如非 git 仓库） → 0
- MAJOR FAIL（doc 可能过期 / source 路径失效）→ 1
- 不会有 BLOCKER（docs phase 设计上不阻塞 CI）

---

## 7. 与 Slash / Skill 的对应关系

全局 phase **`extensions`** / **`init`** / **`docs`** 一般由 CI 或维护者直接用 `--phase`；无统一 slash（adapter 而异时以 [`agents/README.md`](../../agents/README.md) 为准）。`init` 对应 Skill：**[`00-framework-init`](../../skills/00-framework-init/SKILL.md)**。

| Phase       | Slash                                          | Skill                                                                            |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `catalog`   | `/catalog-bootstrap`                           | [`../../skills/0-catalog-bootstrap/SKILL.md`](../../skills/0-catalog-bootstrap/SKILL.md) |
| `glossary`  | `/glossary-bootstrap`                          | [`../../skills/0-catalog-bootstrap/SKILL.md`](../../skills/0-catalog-bootstrap/SKILL.md) |
| `prd`       | `/prd-design`                                  | [`../../skills/1-prd-design/SKILL.md`](../../skills/1-prd-design/SKILL.md)         |
| `design`    | `/requirement-design`                          | [`../../skills/2-requirement-design/SKILL.md`](../../skills/2-requirement-design/SKILL.md) |
| `coding`    | `/coding`                                      | [`../../skills/3-coding/SKILL.md`](../../skills/3-coding/SKILL.md)                |
| `review`    | `/code-review`                                 | [`../../skills/4-code-review/SKILL.md`](../../skills/4-code-review/SKILL.md)      |
| `ut`        | `/business-ut`                                 | [`../../skills/5-business-ut/SKILL.md`](../../skills/5-business-ut/SKILL.md)      |
| `testing`   | `/device-testing`                              | [`../../skills/6-device-testing/SKILL.md`](../../skills/6-device-testing/SKILL.md) |
| `docs`      | （无 slash，直接 `--phase docs`）               | —                                                                                |

---

## 8. CI 集成范式

最常见的两种 CI 接入：

### 8.1 PR 卡门（推荐）

每个 PR 建议至少跑齐**与 spec-driven 对齐**的全局 phase + 受影响 feature 的六阶段：

```bash
cd framework/harness
npm install --no-audit --no-fund

# 全局 phase
npx ts-node harness-runner.ts --phase extensions
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
npx ts-node harness-runner.ts --phase docs
# init：升级 / 改 adapter 时再跑，不必每个 PR
# npx ts-node harness-runner.ts --phase init --adapter <name>

# 受影响的 feature（按变更文件路径筛选）
for f in $(detect_affected_features); do
  for p in prd design coding review ut testing; do
    npx ts-node harness-runner.ts --phase "$p" --feature "$f" || exit 1
  done
done
```

`detect_affected_features` 是项目内自定义脚本，根据 PR 改动的路径反查 `doc/features/<feature>/contracts.yaml` 中 `package_path` 的归属。

### 8.2 Nightly 全量跑

主分支 / Nightly：

```bash
# 全部已知 feature 都跑一遍 6 个功能 phase
for f in $(ls doc/features); do
  for p in prd design coding review ut testing; do
    npx ts-node harness-runner.ts --phase "$p" --feature "$f"
  done
done
```

### 8.3 ut_hvigor_test 在 CI 上的特殊处理

见 [`../profiles/hmos-app-harness-toolchain.md`](../profiles/hmos-app-harness-toolchain.md) §2（真机 / 模拟器、`hdc`、为何不推荐长期降级 severity）。

---

## 9. 常见错误排查

### 9.1 `runner_*_failed`

报告里出现 `runner_load_phase_rule_failed` / `runner_load_feature_spec_failed` 等：

| 报错 ID                            | 排查                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `runner_load_phase_rule_failed`    | 缺少对应的 `framework/specs/phase-rules/<phase>-rules.yaml` 或 YAML 解析失败                       |
| `runner_load_feature_spec_failed`  | `doc/features/<feature>/contracts.yaml` 或 `acceptance.yaml` YAML 解析失败                         |
| `runner_assemble_ai_prompt_failed` | 上下文文件读取异常（路径含特殊字符 / 编码问题），看 `script-report.json > details`                 |
| `runner_generate_merged_report_failed` | 输出目录权限问题 / 磁盘满                                                                      |

修复 runner_* 报告项后重新跑即可，runner_* 一律 BLOCKER。

### 9.2 hvigor / hdc 工具链相关

hmos-app **专用排障表**见 [`../profiles/hmos-app-harness-toolchain.md`](../profiles/hmos-app-harness-toolchain.md) §3。

### 9.3 false PASS 嫌疑

如果你怀疑 harness "看起来 PASS 但实际有问题"，按以下顺序检查：

1. `script-report.json > checks[].status` 中是否有 `SKIP` —— v2.2 起任何 SKIP 都应有明确合理原因
2. `merged-report.md` 末尾的 verdict 与 `summary` 对得上吗（`pass=N, fail=0, blockers=0` ≠ verdict=PASS 是异常态）
3. `trace.json > start_commit` 与当前 HEAD 一致吗 —— 如不一致，可能是上次跑剩的报告文件未刷新
4. **宿主编译**（hmos-app：hvigor）日志里仍有编译错误但脚本未归类？—— 见 [`../profiles/hmos-app-harness-toolchain.md`](../profiles/hmos-app-harness-toolchain.md) §5（含超时与日志核对）。

### 9.4 v2.7+ hvigor 加速与 coding 默认命令

全文已迁至 [`../profiles/hmos-app-harness-toolchain.md`](../profiles/hmos-app-harness-toolchain.md) §4（flag 说明、示例命令行、小工程 benchmark、`toolchain.hvigor` JSON、`hvigor-runner` 修改入口）。

---

## 10. 中断 / 切换会话 / 放弃阶段（v2.8 起）

### 10.1 背景

Stop hook 会读 `framework/harness/state/.current-phase.json` 判断当前 cli 会话能不能结束消息。
该状态文件是**全局单槽**：任何时刻最多一份，跨 cli 重启不自动清理。这种设计在以下场景容易"误伤"：

- Ctrl+C 中断 harness，状态停留在 `status='running'`；
- cli 崩溃 / 重启，没机会跑 receipt 校验；
- 切换 feature 而旧 feature 的阶段还没收尾；
- 跨天 / 跨周回来接着干，但记不清上次到哪一步。

v2.8 起 hook 引入"会话边界判定"避免上一会话遗留拦下一会话。详细矩阵见
实例根**全局入口** §5.1.1（与 `AGENTS.md.template` 渲染结果一致）；下面只列日常操作动作。

> **本节针对 feature 维度阶段**（PRD / design / coding / review / UT / testing）。
> 所有在 **当前 [`active_workflow`](../../workflows/spec-driven.workflow.yaml)** 中声明为 **`scope: global`** 的阶段（默认含 `extensions` / `init` / `catalog` / `glossary` / `docs`）：**不写** `.current-phase.json`（runner v2.8.1+），也没有 feature 维度完成回执模板。
> 实例 **Stop hook** 对残留的「全局 phase」state 兜底放行——与 `agents/claude/templates/hooks/check-phase-completion.mjs` 内 **`GLOBAL_PHASES`** 常量一致（若你本地 hook 落后于 framework 模板请重新下发）。因此跑 `--phase init` / `extensions` 等不会套用 §5.1「四件套闭环」判定。

### 10.2 配置：`framework.config.json > state_machine`

```jsonc
{
  "state_machine": {
    "grace_period_minutes": 5,   // runner 写 state → hook 第一次盖 session_id 的容忍窗口
    "ttl_hours": 12,              // payload 缺 session_id 时的兜底过期阈值
    "schema_version": "1.1"
  }
}
```

| 字段 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| `grace_period_minutes` | (0, 60] | `5` | runner 写完 state 到 hook 第一次"盖章"之间允许的间隔。窗口内 state.session_id=null 视为"刚跑完 harness 还没来得及盖章"，hook 会用本会话 sid 给它盖章；超出窗口再来一个未盖章 state 视为前一会话遗留。 |
| `ttl_hours`            | [1, 168] | `12` | 极端兜底：payload 没传 session_id 时，仅用 `state.updated_at` 与 ttl 比较。常规路径走 session_id 比对，ttl 是"防止历史 state 永久缠住"的保险栓。 |

非法值（缺字段 / 超范围 / 非数字）：
- runner 端（`framework/harness/config.ts > validateStateMachine`）→ 抛错；
- hook 端（实例根 Stop hook 内 `readStateMachineFromConfig`）→ 安静回退默认值，不 fail。

### 10.3 三类常见操作

#### A. 我想继续上次的阶段

不需要任何额外动作——只要本次仍是同一 cli 会话（同一 session_id），Stop hook 会照常按 §5.1
四条件判定。只要把缺的 trace / harness / verifier / receipt 补齐再 stop 即可。

跨 cli 会话怎么办？参考 §10.4。

#### B. 我想放弃这个阶段，换去做别的事

```bash
cd framework/harness && npx ts-node harness-runner.ts --clear-state
```

行为：
- 删除 `framework/harness/state/.current-phase.json`（无确认）；
- 历史 verdict / 报告 / 回执仍保留在 `doc/features/<feature>/<phase>/reports/`（或 legacy：`framework/harness/reports/<feature>/<phase>/`）与
  `doc/features/<feature>/<phase>/` 下，用于审计；
- 下次 stop hook 找不到 state 文件 → 直接放行；
- 想接着这个 feature/phase 干，按对应 SKILL.md 重新进入即可（state 会被 `harness-runner.ts` 重新写起来）。

`--clear-state` 是"放弃已有进度"，不是"暂停"：
- 它**不会**回滚已写到磁盘的 PRD / design / 代码 / receipt 等内容；
- 它**只**删 state file 这个判定开关。

#### C. 我刚问个无关问题，hook 却跳出"未闭环"提示

如果提示文案是：

```
[Stop Hook 提示] 检测到一个旧的阶段状态文件，但与当前会话无关：
  ...
  原因 = state 由另一个会话（session_id=...）记录，本次会话 session_id=...
  ...
本次 stop 已放行；上面这条状态不会拦截你。
```

→ 这是 **advisory + exit 0**：hook 已经放行，agent **不应**接管旧任务，继续做用户当前问的事。

如果不想再看到这条提示，按 §10.3-B 跑一次 `--clear-state` 即可。

如果提示文案是：

```
[Stop Hook 提示] 当前会话存在未闭环阶段：
  ...
未满足的闭环条件（全局入口 §5.1）：
  - ...
如果你打算【继续这个阶段】，按下面顺序补齐：
  ...
如果你想【放弃这个阶段，转去做别的事】，先执行：
       cd framework/harness && npx ts-node harness-runner.ts --clear-state
```

→ 这是 **block + exit 2**：当前会话内确有未闭环阶段，按提示二选一即可。

### 10.4 跨天 / 跨 cli 重启回来接着干

例：周一跑了一半 coding，周二重启 cli 回来想接着干同一个 feature。

- 直接进入对应 Skill / Slash，重新触发 harness-runner.ts；
- runner 会重写 state（保留 prev started_at），同会话内继续；
- 周一遗留的 `state.session_id="<old>"` 会在新 cli 的 Stop hook 中被识别为
  `stale-cross-session` → advisory + exit 0；
- 当 runner 重新跑过后，`writeCurrentPhaseState` 不会主动改 session_id，
  保留前会话的 sid——直到本次 cli 的第一次 Stop hook 触发，hook 会用新 sid 覆盖；
- 如不想看到 advisory，先 `--clear-state` 再重新进入对应 Skill。

### 10.5 如何看 state 当前是什么状态

```bash
cat framework/harness/state/.current-phase.json
```

关键字段：

| 字段 | 含义 |
|------|------|
| `phase` / `feature` | 当前阶段是哪个 feature 的哪一步 |
| `status`            | `running`（harness 跑到一半）/ `harness_finished` |
| `verdict`           | 最近一次 harness verdict |
| `blocker_count`     | 最近一次 BLOCKER 数 |
| `receipt`           | check-receipt.ts 输出 |
| `session_id`        | 第一次 Stop hook 命中时由 hook 回填，标记本 state 归属哪个 cli 会话 |
| `session_id_recorded_at` | session_id 被盖章的时刻 |
| `last_seen_session_id` / `last_seen_at` | 最近一次 Stop / SubagentStop 触发时的 sid 与时刻（用于审计） |
| `last_verifier_report.recorded_in_session` | verifier 子 agent 那次跑的 sid（验证 verifier 也属于同会话） |

---

## 11. 历史注记

以下条目来自早期为单 feature（home-page）打通端到端时遇到的工程要点，对 Windows / 沙盒样本仍有参考价值：

| # | 要点                                                                                                                                          |
| - | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Markdown CRLF**：`framework/harness/scripts/utils/markdown-parser.ts` 对 `split(/\r?\n/)` 统一处理，避免 Windows 下标题解析失败             |
| 2 | **contracts 快照**：`doc/features/<feature>/contracts.yaml` 与当前工程对齐（实例路径，不进 `framework/`）                                    |
| 3 | **测试计划 AC 编号**：`check-testing.ts` 中关联 AC 的正则支持 `AC-G1` 等形式                                                                  |
| 4 | **Hypium 入口**：`check-ut.ts` 跳过仅导出 `testsuite()`、无 `describe` 的入口 shim                                                            |
| 5 | **真机测试文档**：`doc/features/<feature>/testing/test-plan.md`、`testing/test-report.md` 必须覆盖 acceptance 中 P0 / P1 的 AC 追溯                          |
| 6 | **技能跳板**：部分 adapter 在实例根生成轻量入口，指向 `framework/skills/` 正文，**不复制内容**                                                  |

---

## 维护同步（2026-05-22 · 对齐 2.0）

- **Profile 编排**：`check-coding` / `check-ut` / `check-testing` 经 **`capability-registry.ts`** 调度 profile provider。
- **Context Gate**：schema **1.1.0** + `exploration-strategy.ts`；`backfill:context` / `compat.yaml` 过渡存量 feature。
- **Hylyre 真机**：testing phase `device_test.*`；报告外置 `doc/features/<feature>/<phase>/reports/`。
- **确认 UX**：docs phase 含 `confirmation_ux_lint` BLOCKER；Claude adapter AskUserQuestion 见 Skill 0–6 registry。
- **Agent 行为**：各 feature phase Research Sub-Phase 前读 [`agent-behavioral-principles.md`](../../skills/reference/agent-behavioral-principles.md)。
- workflow DAG 仍以 [`spec-driven.workflow.yaml`](../../workflows/spec-driven.workflow.yaml) 为 SSOT（**11** phase）。

---

## 一句话总结

> **Harness 的工作不是"自动化跑代码"，是"卡住错误不让往下传"。
> 看到 PASS 不要假定一切都好，要看 SKIP 数量、看 trace.json、看 merged-report.md 的 verdict 是否与 summary 自洽；
> 看到 FAIL 不要急着降 severity，先把环境/产物修对再回来 —— 任何一次降级都是埋一颗"假 PASS"地雷。**

<!--
  last-synced: 2026-05-22 (2.0: capability-registry, Hylyre, context-exploration, confirmation UX)

  v2.4 (2026-04-27) — Stop hook cross-session isolation:
    - 新增 §10「中断 / 切换会话 / 放弃阶段」章节：state_machine 配置、--clear-state 出口、
      跨会话 advisory 文案；
    - 新增 harness-runner.ts --clear-state 子命令；schema_version 1.0 → 1.1；
    - .current-phase.json 新增 session_id / session_id_recorded_at /
      last_seen_session_id / last_seen_at 字段（向后兼容：缺失即按"未盖章"处理）；
    - 与全局入口 §5.1.1 协同。
-->


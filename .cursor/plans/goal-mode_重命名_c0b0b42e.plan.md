---
name: goal-mode 重命名
overview: MVP——宿主入口 goal-orchestration→goal-mode（全 agent）+ feature 绑定证据目录 doc/features/<feature>/goal-runs/<run-id>/；收窄 gitignore 仅增 goal-runs pattern；NL 分流 goal 优先于 batch；2.3.0 未发布窗口内用 OpenSpec change delta 修订，archive 后落到活跃 spec（非仅改名）。
version: 2.3.0
todos:
  - id: openspec-revise
    content: Step0 仅在 openspec/changes/goal-mode-rename 写 delta + validate；实施完成后再 archive 落到活跃 spec（实施期不双写 specs/）
    status: completed
  - id: rename-skill-paths
    content: 重命名 skill/跳板/slash/index/BUILTIN 为 goal-mode；claude/cursor/generic/codex 全 agent 宿主入口同步（无 deprecated_artifacts）
    status: completed
  - id: update-skill-docs
    content: 改写 goal-mode/SKILL.md、runbook、user-confirmation-ux §8.2b 触发词与 batch 分流；adapter notes 8→9 份
    status: completed
  - id: parse-goal-mode-nl
    content: parseGoalModeAuthorization + resolveTransitionPolicy（goal 优先于 batch）+ 单测
    status: completed
  - id: goal-runs-path
    content: report_dir 固定 feature 路径；--resume 硬要求 --feature（或 --manifest），不扫描；gitignore 仅增 doc/features/*/goal-runs/
    status: completed
  - id: openspec-spec-rename
    content: archive 后验收 goal-mode-skill 存在、goal-orchestration-skill 目录不存在；openspec:validate PASS
    status: completed
  - id: verify-tests
    content: 单测 + 发布面 grep 无 goal-orchestration；harness test + openspec archive 前后 validate PASS
    status: completed
isProject: false
---

# goal-mode 重命名计划（Review 收窄 MVP）

## Review 采纳摘要

### 第一轮

| Review 点 | 结论 |
|-----------|------|
| 整树 `doc/features/` gitignore | **不采纳**——拆出后续 |
| 无 feature 的 `doc/goal-runs/` | **MVP 不做** |
| `--resume` 跨 feature 扫描 | **不扫描**——硬要求 `--feature`（见第二轮） |
| goal vs batch NL 冲突 | **goal_mode 优先** |
| OpenSpec 仅改名不够 | **Step 0** 写 delta 变更（见第二轮流程） |

### 第二轮（执行细节）

| 点 | 结论 |
|----|------|
| [P2] `--resume` 语义矛盾 | **硬 MVP**：`--resume` **必须**配 `--feature`（或 `--manifest`）；**不做**跨 feature 扫描；单测仅「缺 feature 失败 / 指定 feature 成功」 |
| [P2] OpenSpec 双写 | **仅**在 `openspec/changes/` 写 delta → `validate` → 实施 → **archive** 落到 `openspec/specs/`；实施期**不**同时改活跃 spec |
| [P3] 文档链接笔误 | plan/文档链接统一指向 `skills/project/goal-mode/SKILL.md` |
| [P3] gitignore 单测 | **断言具体 pattern**（有 `doc/features/*/goal-runs/`、保留 reports/_adhoc、无整树 `doc/features/` / `doc/goal-runs/`），**不写死**条数 19→20 |
| [P3] 旧名残留扫描 | 验收 grep 发布面无 `goal-orchestration`（豁免：`openspec/changes/archive/`、历史 plan、`harness/reports/` 旧产物） |

### 第三轮（可开干）

| 点 | 结论 |
|----|------|
| 整体 | **无 blocker**；`--resume` 硬 MVP、OpenSpec 单路径、链接与 gitignore 断言已闭环 |
| [P3] archive 后 spec 目录更名 | 验收须显式断言：新目录存在、旧目录不存在（见 §0 / §6） |
| overview 措辞 | 与 §0 对齐：change delta → archive 落到活跃 spec |
| archive 实施 | 勿盲信 archive 自动删旧目录；残留则手工收敛后再 validate |

---

## 背景与决策（MVP 定稿）

| 项 | 决策 |
|----|------|
| Slash / Skill id | `goal-mode` → `/goal-mode` |
| 中文 goal 触发 | **目标模式**、**全自动（模式）**、**无人值守全自动** |
| 不再作 goal 触发 | 「全链路」「从 PRD 到真机」「一个需求做到尾」→ `batch_authorized` / [`BATCH_PHRASES`](harness/scripts/utils/phase-transition-policy.ts) |
| 全 agent 范围 | **claude / cursor / generic / codex** |
| 旧 slash 迁移 | **不做** `deprecated_artifacts`（2.3.0 未对外发布） |
| goal-runs 落盘 | **仅** `{featuresDir}/<feature>/goal-runs/<run-id>/`（默认 `doc/features/<feature>/goal-runs/<run-id>/`） |
| `manifest.feature` | **MVP 必填**（preflight BLOCKER 保持/强化） |
| gitignore（init） | **仅新增** `doc/features/*/goal-runs/`；**保留**现有 `doc/features/*/*/reports/*`、`/doc/features/_adhoc/` 等 |
| NL 解析优先级 | 同句同时命中 goal 与 batch 时 → **`goal_mode` 优先** |

内部 harness 名 `goal-runner`、`transition_policy=goal_mode` **不变**。

### 明确延后（本 plan 不做）

- 整树 `doc/features/` canonical gitignore
- 无 feature 的 adhoc goal / `doc/goal-runs/`
- 移除 `doc/features/*/*/reports/*` 等既有 canonical pattern

---

## 0. OpenSpec（先于代码，单一路径）

**禁止**实施期同时改 `openspec/changes/*` 与 `openspec/specs/*`。流程：

```mermaid
flowchart LR
  delta[changes/goal-mode-rename 写 delta]
  validate[openspec validate]
  impl[代码与文档实施]
  archive[openspec archive 落到 specs/]
  delta --> validate --> impl --> archive
```

在 [`openspec/changes/goal-mode-rename/`](openspec/changes/) 写 delta（`proposal.md` / `design.md` / `tasks.md` / `specs/*/spec.md`），`npm run openspec:validate` PASS 后再动代码。

| Delta spec | 内容 |
|------------|------|
| `goal-runner` | 证据目录 `doc/features/<feature>/goal-runs/<run-id>/`；`--resume` **必须** `--feature` 或 `--manifest` |
| `goal-mode-skill` | 宿主 `/goal-mode`、NL 触发、goal 优先 batch |
| `harness-gates`（若涉及） | gitignore 增 `doc/features/*/goal-runs/` |

实施完成并验收后 **一次性** `openspec archive` → 活跃 `openspec/specs/` 更新（含 `goal-orchestration-skill` → `goal-mode-skill` 目录更名）。archive 历史目录用语不改。

**archive 后验收（BLOCKER）**——避免新旧 spec 目录并存：

- `openspec/specs/goal-mode-skill/spec.md` **存在**
- `openspec/specs/goal-orchestration-skill/` **不存在**
- `npm run openspec:validate` **PASS**

**实施提醒**：勿假定 `openspec archive` 会自动删掉旧 spec 目录。archive 跑完后**立即检查**；若 `goal-orchestration-skill/` 仍在 → 按 BLOCKER 处理，**手工删除/合并**旧目录后再跑 `openspec:validate`，不得带着双目录蒙混过关。

---

## 1. 公共 SSOT 重命名

| 原路径 | 新路径 |
|--------|--------|
| [`skills/project/goal-orchestration/`](skills/project/goal-orchestration/) | `skills/project/goal-mode/` |
| [`agents/shared/.../skills-bridge/goal-orchestration/`](agents/shared/agent-bundle/templates/skills-bridge/goal-orchestration/) | `.../skills-bridge/goal-mode/` |

- [`skills/skills.index.yaml`](skills/skills.index.yaml)：`id: goal-mode`
- [`harness/scripts/utils/agent-bundle-paths.ts`](harness/scripts/utils/agent-bundle-paths.ts)：`BUILTIN_SKILL_BRIDGE_DESCRIPTIONS['goal-mode']`
- 删除旧 `goal-orchestration` 源文件

---

## 2. 分 agent 宿主入口（须全部改）

| Adapter | 改动 |
|---------|------|
| **claude** | `commands/goal-mode.md` → `/goal-mode` |
| **cursor / codex** | shared bridge → `.cursor|codex/skills/goal-mode/`；adapter notes 8→9 份 |
| **generic** | index + BUILTIN 动态 stub；notes 8→9 份 |

**不做** `deprecated_artifacts` 旧 slash。

---

## 3. 文档与 Skill 正文

- [`skills/project/goal-mode/SKILL.md`](skills/project/goal-mode/SKILL.md)：触发词、证据路径 **仅 feature 绑定**；**不写**无 feature adhoc
- [`docs/operations/goal-mode-runbook.md`](docs/operations/goal-mode-runbook.md)、[`user-confirmation-ux.md`](skills/reference/user-confirmation-ux.md) §8.2b：同步；注明 goal 优先 batch

---

## 4. 自然语言分流（`phase-transition-policy`）

新增 `parseGoalModeAuthorization(text)` + 统一入口 `resolveTransitionPolicy(text)`（或等价）：

1. **先**调 `parseGoalModeAuthorization` → 命中则 `goal_mode`
2. **再**调 `parseBatchAuthorization` → 命中则 `batch_authorized`
3. 否则 `manual`

单测（BLOCKER 级）：

| 输入 | 期望 |
|------|------|
| 「进入目标模式 demo-feature」 | `goal_mode` |
| 「全自动做到 testing」 | `goal_mode`（**goal 优先**，不被 batch「做到 testing」劫持） |
| 「全链路交付」 | `batch_authorized`（无 goal 专用词） |

---

## 5. goal-runs 证据层（feature-bound MVP）

### 路径（SSOT：`goal-manifest.ts`）

```ts
resolveGoalReportDir({ featuresDir, feature, runId })
// => `${featuresDir}/${feature}/goal-runs/${runId}`  // feature 必填
```

替代当前工程根 `goal-runs/<run-id>/`。

### resume（硬 MVP，不扫描）

| 方式 | 行为 |
|------|------|
| `--resume <run-id> --feature <f>` | 直读 `{featuresDir}/<f>/goal-runs/<run-id>/manifest.json`；不存在则非零退出 |
| `--manifest <path>` | 现有逻辑，读 manifest 内 `report_dir` |
| 仅 `--resume <run-id>`（无 `--feature` 且无 `--manifest`） | **BLOCKER 非零退出**：明确提示须补 `--feature` 或 `--manifest` |

**不做**：跨 `{featuresDir}/*/goal-runs/` 扫描 run-id、ambiguous 多命中分支。

`loadGoalManifestFromRun(projectRoot, runId, { feature, featuresDir })` 只拼单一路径。

单测仅两场景：

- **missing feature**：`--resume` 无 `--feature` → 失败
- **specified feature**：`--resume` + `--feature` → 读到 manifest

### gitignore（窄增，不整树）

在 [`canonical-gitignore.ts`](harness/scripts/utils/canonical-gitignore.ts) **仅追加**：

```text
doc/features/*/goal-runs/
```

- **保留** `doc/features/*/*/reports/*`、`/doc/features/_adhoc/` 等既有 canonical
- **不**加 `doc/features/`、`doc/goal-runs/`

核查说明：当前 init **并未**忽略整个 `doc/features/`（仅 reports/_adhoc 碎片）；MVP **不改变**该默认策略。

---

## 6. 测试与验收

- [`resolve-skill-path.unit.test.ts`](harness/tests/unit/resolve-skill-path.unit.test.ts) 跳板路径
- [`goal-runner-policy.unit.test.ts`](harness/tests/unit/goal-runner-policy.unit.test.ts)：`resolveGoalReportDir`；resume 缺 feature 失败 / 带 feature 成功
- [`phase-transition-policy.unit.test.ts`](harness/tests/unit/phase-transition-policy.unit.test.ts)：goal 优先 batch
- [`canonical-gitignore.unit.test.ts`](harness/tests/unit/canonical-gitignore.unit.test.ts)：**断言具体 pattern**——`CANONICAL_IGNORE_PATTERNS` 含 `doc/features/*/goal-runs/`；仍含 `doc/features/*/*/reports/*`、`/doc/features/_adhoc/`；**不含** `doc/features/`、`doc/goal-runs/`
- **发布面残留扫描**（验收命令，示例）：

```bash
# 发布目录：skills agents harness workflows docs specs profiles templates README.md MIGRATION.md
rg 'goal-orchestration' skills agents harness workflows docs specs profiles templates README.md MIGRATION.md \
  --glob '!openspec/changes/archive/**' --glob '!harness/reports/**' --glob '!.cursor/**'
# 期望：无匹配（或仅 MIGRATION 历史说明句若保留）
```

- `cd harness && npm test` 全 PASS
- 实施前：`npm run openspec:validate` PASS（changes delta）
- 实施后：`openspec archive` → 再 `npm run openspec:validate` PASS
- **archive 后目录断言**（archive 命令本身不保证删旧目录）：
  - 存在 [`openspec/specs/goal-mode-skill/spec.md`](openspec/specs/goal-mode-skill/spec.md)
  - 不存在 `openspec/specs/goal-orchestration-skill/`（若仍在 → 手工删除后再 `openspec:validate`）

---

## 不改动的边界

- `goal-runner` CLI 旗标名（`--feature` / `--resume` / `--manifest`）
- `transition_policy` 枚举 `goal_mode`
- Claude/Codex 原生 `/goal` metadata
- OpenSpec **archive** 历史用语
- **`deprecated_artifacts` 旧 slash**
- 整树 `doc/features/` gitignore、无 feature adhoc goal（**延后**）

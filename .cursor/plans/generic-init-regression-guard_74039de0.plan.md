---
name: generic-init-regression-guard
overview: 通过收紧 Skill 00 提示词/文档措辞，并补一条回归单测，杜绝 init agent 把「harness 已有默认值」误读成「必须 STOP 手动配置」，从而误丢选中的 generic adapter。
todos:
  - id: skill-s22
    content: 改写 SKILL.md S2.2 generic 措辞为「默认零配置物化 + 仅非标路径 STOP」两段式，并在 BLOCKER 段补通用红线
    status: completed
  - id: adapter-selection
    content: 澄清 adapter-selection.md 第14行 BLOCKER：默认 .agents/inline 不得 STOP
    status: completed
  - id: readme
    content: 更新 agents/README.md 第90、115行 generic 默认零配置措辞
    status: completed
  - id: registry-sync
    content: confirmation-registry.yaml init.materialized_adapters notes 加 generic 默认 .agents/inline，并同步 adapter-widget-options.md（label 表逐字不动，避开 lint 词）
    status: completed
  - id: regression-test
    content: 端到端单测：materialized ["claude","generic"] + local active claude + 无 agent_bundle_root → 执行后 .agents/skills 落地，generic 不被剔除
    status: completed
  - id: openspec-scenario
    content: 经 OpenSpec change（delta）给 init-orchestration spec 第62行 Requirement 补 generic 不被默认缺省剔除的 scenario
    status: completed
  - id: verify
    content: cd harness && npm test 全 PASS + npm run openspec:validate
    status: completed
isProject: false
---

# 规范 init AI 行为：避免 generic 物化被误丢

## 背景结论（已定位）

harness 对 generic 的 `agent_bundle_root` 有三层默认兜底（template `.agents` / `config.ts` 归一 / `check-init` 探测回退），**零配置即可物化到 `.agents`/inline**。硬校验只在「个人 active `agent_adapter === 'generic'`」时触发，与本次「项目级 materialized_adapters 含 generic、主 adapter 为 claude」无关。本次失败是 **init agent 误读 SKILL.md S2.2 的「非标路径 STOP」规则**，把「没探测到自定义路径」当成「必须 STOP」，于是只物化了 claude。

修复方向是**规范提示词与文档措辞**（行为层），不动 harness 默认逻辑（已正确）。

## 核心原则（要写进措辞）

> 选中的 materialized adapter **不得**因「harness 已提供默认值的可选字段缺失」而被 STOP/剔除。只有当用户**主动要求非标路径**时才走「STOP → 手动编辑 config」。generic 默认零配置物化到 `.agents` + `inline`。

## 改动点

### 1. SKILL.md S2.2 措辞（核心）
`[skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md)` 第 62 行那句改写为「两段式」：
- 默认路径：generic 直接用 template 默认 `.agents` / `inline` 写入 `configWritePayload` 并继续物化，**禁止因此 STOP 或剔除 generic**。
- 例外：仅当用户**显式要求**自定义（非标）`agent_bundle_root` 时，才 STOP → 手动编辑 config 后重跑（禁止对话收路径字符串）。

并在「阻塞与上报（BLOCKER）」段补一条通用红线：**不得把「可选字段取默认值」当作 STOP 理由剔除已选 adapter**。

### 2. adapter-selection.md BLOCKER 澄清
`[skills/00-framework-init/prompts/adapter-selection.md](skills/00-framework-init/prompts/adapter-selection.md)` 第 14 行：把「同批收集 `agent_bundle_root`」改为「无自定义需求时**直接用 `.agents`/inline 默认**写入 configWritePayload，**不得 STOP**；仅用户主动要非标路径才 STOP」。

### 3. agents/README.md 两处措辞
`[agents/README.md](agents/README.md)`：
- 第 90 行 `["generic"]（并配置 paths.agent_bundle_root）` → 标注「默认 `.agents` 零配置；仅非标路径才需显式配置」。
- 第 115 行内部 agent 段同样点明默认零配置。

### 4. registry 文案 SSOT（非可选，采纳评审）
`init.materialized_adapters` 是确认选项 SSOT，必须改，不是可选。
- `[skills/reference/confirmation-registry.yaml](skills/reference/confirmation-registry.yaml)`：在 `init.materialized_adapters` 的**条目级 `notes`** 加一句「generic 默认物化到 `.agents`/inline，无需额外配置；仅非标路径才需手动编辑 config」。**不动 option `label`**（label 与 widget 逐字对齐）。
- 同步 `[skills/00-framework-init/templates/adapter-widget-options.md](skills/00-framework-init/templates/adapter-widget-options.md)`：该文件第 3 行声明要与 registry **逐字对齐**，在 generic 行下方/正文补同一句默认说明（label 表三行保持逐字不动）。
- **lint 约束**（`harness/scripts/check-skills-confirmation-ux.ts`）：文案禁含 `复述` / `完全自定义` / 自由路径 / 问卷 等词，措辞用「默认 `.agents`/inline」「手动编辑 framework.config.json」即可，避免触发 `lintInitSetupNoFreeText`。

### 5. 回归单测（端到端，采纳评审落点）
放在 `[harness/tests/unit/init-orchestrate.unit.test.ts](harness/tests/unit/init-orchestrate.unit.test.ts)` 或 `[harness/tests/unit/init-task-executor.unit.test.ts](harness/tests/unit/init-task-executor.unit.test.ts)`（不只放 `generic-bundle.unit.test.ts`）。用例覆盖**真实路径**：`materialized_adapters: ["claude","generic"]` 且 `paths` 无 `agent_bundle_root` → 走 `prepareInitExecutionPlanWithStaleIds` + `executeInitPlan`，断言 `materialize-adapter:generic` 存在且执行后磁盘 `.agents/skills/...` 落地，不被 STOP/剔除。
- **真实夹层（采纳建议）**：同时存在 personal/local active `claude`（`framework.local.json` agent_adapter=claude），精准覆盖「主/active adapter 不是 generic、但项目物化清单含 generic」的场景，断言 generic 仍以默认 `.agents` 物化成功。

### 6. OpenSpec 行为规格先行（采纳评审）
给 `[openspec/specs/init-orchestration/spec.md](openspec/specs/init-orchestration/spec.md)` 第 62 行 `Requirement: S3 execution plan honors S2 materialized adapter selection` 补 scenario：项目级 `materialized` 含 `generic` 且无 `agent_bundle_root` 时，MUST 物化（默认 `.agents`），MUST NOT 因缺省 bundle root 被剔除或 STOP。
- **走 OpenSpec change 流程**（AGENTS.md 约定 `openspec/` 管理框架自身演进）：`/opsx-propose` 生成 change delta → 实现 → `/opsx-archive` 落回 published spec，**不直接手改 published spec**。

## 验收
- `cd harness && npm test` 全 PASS（含新端到端单测）。
- `npm run openspec:validate`（`--strict`）通过。
- 人工复读 S2.2 / registry / widget：generic 默认分支与「非标才 STOP」例外清晰可分，且三处文案一致。

## 风险（评审提示）
文案不要写过头：registry / widget label 不得出现「自定义路径 / 自由输入 / 完全自定义 / 复述」之类字样，否则被 `check-skills-confirmation-ux` lint 拦。默认说明只放 `notes` / 正文，不进 label 表。

## 备选（按需）
如需先把本次缺的 generic 产物补上，可在工程根跑一次 `/framework-init` UPDATE，让 planner 用更新后的 `materialized_adapters` 物化 generic（无需手动编辑 config）。

---

## 实现状态（已闭环 · 2026-06-02）

**结论**：代码与规格均已落地；此前 plan 未闭环是因为 **frontmatter 中 `registry-sync` 仍为 pending**，正文亦未记录验收结果，并非实现缺失。

| 项 | 状态 | 落点 |
|----|------|------|
| 1. SKILL.md S2.2 + BLOCKER | 已完成 | `skills/00-framework-init/SKILL.md` |
| 2. adapter-selection.md | 已完成 | `skills/00-framework-init/prompts/adapter-selection.md` |
| 3. agents/README.md | 已完成 | `agents/README.md` |
| 4. registry + widget SSOT | 已完成 | `skills/reference/confirmation-registry.yaml`、`skills/00-framework-init/templates/adapter-widget-options.md` |
| 5. 回归单测 | 已完成 | `harness/tests/unit/init-orchestrate.unit.test.ts`（plan 含 generic ×2）、`init-task-executor.unit.test.ts`（物化 `.agents/skills`） |
| 6. OpenSpec | 已归档 | `openspec/changes/archive/2026-06-02-generic-materialized-default-bundle/` → 已合并 `openspec/specs/init-orchestration/spec.md`（scenario: claude+generic without agent_bundle_root…） |

**验收（已通过）**

- `cd harness && npm test` — 全 PASS（含上述 3 条新用例）
- `npm run openspec:validate --strict` — 全 PASS

**未改 harness 运行时逻辑**：仅文档/registry + 单测 + OpenSpec；`resolveBundleForInitInspect` 默认 `.agents`/inline 行为保持原样。

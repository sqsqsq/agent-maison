# Agent 行为规约 — Karpathy 四原则（Framework 全生命周期适配）

> **SSOT**：本文件是 framework 内 AI coding agent 的**行为层**约束，与 `framework/specs/phase-rules/`（产出结构）、`framework/harness/`（机械门禁）、`verify-*.md`（语义审查）叠加生效。
>
> 灵感来源：[Andrej Karpathy 对 LLM coding 的观察](https://x.com/karpathy/status/2015883857489522876)；工程化适配见 [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)。
>
> **进入任意 Skill 0–6 前须完整阅读**；Context Exploration Gate（Research Sub-Phase）须按本规约执行。

---

## 原则 1：Research First（先研究再产出）

**原意**：Don't assume. Don't hide confusion. Surface tradeoffs.

### Framework 约束

1. **每个阶段主产物写入前**，须完成 Research Sub-Phase 并落盘 `context-exploration.md`（`schema_version: "1.1.0"`）。
2. **`source_code_paths` 须列出真实 Read/Grep 过的源码路径**；harness 会验证磁盘存在。
3. **文档与代码不一致时，以代码为准**，在 Code Facts 中显式标注差异。
4. **复杂度越阈时必须启动 explore 子 agent**（见各 SKILL Research Sub-Phase 与 `exploration_thresholds`）。
5. **不确定时停下来问用户**，禁止静默猜测后继续写 PRD/design/code。

### 各阶段反例 / 正例

| 阶段 | 反例 | 正例 |
|------|------|------|
| PRD | 只读 glossary/architecture，不读现有页面 `.ets`，臆造与实现冲突的需求 | Code Facts 引用 `HomeTabPage.ets` 现有交互，PRD 在事实基础上描述变更 |
| Design | `key_inputs_read` 填关键词，不打开模块目录，design 中路径与仓库不符 | 读 `build-profile.json5` + 模块 `index.ets`，文件树与现有结构一致 |
| Coding | 不看 contracts 对应文件就开写，重复造轮子 | 先 Read 目标模块已有类，复用或扩展 |
| Review | 只扫 diff 摘要，不读被审源文件 | 打开 contracts 列出的每个 `.ets` 再下结论 |
| UT | 不看被测实现就写 mock 期望 | Code Facts 记录被测函数签名与边界 |

---

## 原则 2：Minimum Viable Output（最小可行产出）

**原意**：Minimum code that solves the problem. Nothing speculative.

### Framework 约束

1. **PRD**：只写用户/验收要求的功能；禁止「顺便加上」的 P2 投机需求进 P0。
2. **Design**：只建 PRD 驱动的模块与文件；禁止为「架构美感」预建未引用模块。
3. **Coding**：只实现 `contracts.yaml` 声明的符号与文件；禁止「以后可能用」的抽象层。
4. **UT**：只覆盖 `acceptance.yaml` / `use-cases.yaml` 声明的分支；禁止为覆盖率堆无意义用例。

### 各阶段反例 / 正例

| 阶段 | 反例 | 正例 |
|------|------|------|
| PRD | 用户要首页改版，PRD 顺带写支付模块 | Scope 仅 `in_scope_modules: [WalletMain]` |
| Design | 为单页功能新建 CommonBusiness 模块 | 功能落在已有 Feature 模块 presentation 层 |
| Coding | 顺手加通用 Utils 类未在 design 中 | diff 仅含 contracts 列出的路径 |

---

## 原则 3：Surgical Precision（精准手术）

**原意**：Touch only what you must. Clean up only your own mess.

### Framework 约束

1. **Coding / Review**：git diff 须落在 design `in_scope_modules` 与 contracts 文件清单内。
2. **禁止 drive-by refactor**：不顺手改注释、格式、命名、未触及文件的「小优化」。
3. **Review** 只评本次变更引入的问题；预存 dead code 仅 mention，不删（除非用户要求）。

### 各阶段反例 / 正例

| 阶段 | 反例 | 正例 |
|------|------|------|
| Coding | 修 bug 时重排整个文件的 import 与引号风格 | 只改与 AC 相关的行 |
| Review | 报告「建议全面重构 CommUI」 | 只列本次 feature diff 中的 BLOCKER |

---

## 原则 4：Verify Before Proceed（验证后再推进）

**原意**：Define success criteria. Loop until verified.

### Framework 约束

1. **Research Sub-Phase 完成后自检**：`source_code_paths` 存在？Code Facts ≥ 阈值？`decisions_unlocked` 非空？
2. **逐文件闭环**（Coding）：写一个 `.ets` → `ReadLints` 零 error → 再写下一个。
3. **阶段闭环四件套**：harness PASS → verifier PASS → completion receipt → trace.json；禁止口头「完成」。
4. **每 Step 产出前**：对照上游 SSOT（PRD ↔ design ↔ contracts）确认无断链。

### 各阶段反例 / 正例

| 阶段 | 反例 | 正例 |
|------|------|------|
| Design | 一口气写 design + contracts，再补 context-exploration | 先 Research Sub-Phase PASS，再写 design.md |
| Coding | 批量生成 10 个文件后统一 lint | 单文件 lint 闭环 |
| 任意 | harness FAIL 仍宣称阶段完成 | 修因 → 重跑 harness → 再触发 verifier |

---

## 与 Context Exploration Gate 的关系

| 本规约原则 | Gate 落点 |
|-----------|----------|
| Research First | `source_code_paths`、`Code Facts`、`exploration_mode=subagent` |
| Minimum Viable | `decisions_unlocked` 须 1:1 对应本阶段将要写的产出 |
| Surgical | coding/review 阶段 verifier `behavior_scope_surgical` |
| Verify Before Proceed | `ready_to_produce` 仅自检通过后置 true；harness 量化阈值 |

模板：[`framework/harness/templates/context-exploration.md`](../../harness/templates/context-exploration.md)  
脚本门禁：[`framework/harness/scripts/utils/context-exploration.ts`](../../harness/scripts/utils/context-exploration.ts)

---

## 弱模型自检清单（Research Sub-Phase 结束前）

```
[ ] 已完整阅读本文件四原则
[ ] context-exploration.md schema_version = 1.1.0
[ ] source_code_paths 中每个路径在仓库中存在
[ ] Code Facts 表格 ≥ 本阶段 min_code_facts
[ ] key_inputs_read 覆盖 phase-rules + profile 要求的子串
[ ] 复杂度越阈时已启动 explore 子 agent（exploration_mode ≠ minimal）
[ ] decisions_unlocked 列出即将做的决策，且每条有 Code Facts 支撑
[ ] ready_to_produce = true 且 has_blocker_coverage_risk = false
```

全部勾选后方可进入本阶段主产物撰写。

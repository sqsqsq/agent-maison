# rule-subtraction-second-classification

## Why

`check-disposition-single-verdict`（plan f7045213，总纲 272acb5f 的 P4）建立了处置函数与去向表，首批登记了六条账本与形状检查。
P5（plan 3abca824）按同一标准继续取证：每条回答保护什么、放过的后果、依据，并给出实际消费者证据，由 codex 逐条评审。
探索记录里还有四条检查只核对自报数字、声明列表或"是否写了本阶段增量小节"，下游没有据此作决定的读取方，
可核实的来源、事实与覆盖检查另有承接，却仍会让阶段停下。本变更把这四条登记为披露。
（同批 t3 还让 summary 停写没有决策读取方的 `blocking_warnings`；主规范与在研变更都没有要求 summary 含该字段，不需要规范增量。）

## What Changes

- **第二批分类**：去向表追加四条 `ledger_shape`（披露，检查照常产出原始 FAIL）：
  `context_exploration_files_inspected_min`、`context_exploration_decisions_unlocked`、
  `context_exploration_facts_phase_delta_missing`、`context_exploration_facts_phase_delta_empty`。
- 不登记：三条探索方式声明（`context_exploration_mode_allowed`、`context_exploration_mode_required`、
  `context_exploration_subagent_required`）与必读输入覆盖（`context_exploration_inputs_coverage`）——它们落实阶段探索策略与必读输入声明；
  暂缓：`origin_tag_required`、`seed_no_technical_words`。
- **facts.md 增量小节**：仍须每个非建立阶段追加（无新增写 none）；缺节或空节的后果由阶段失败改为披露并计入完成缺口。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`：ADDED「The second classification registers four ledger exploration checks」。
- `feature-artifact-layout`：MODIFIED「facts.md is the single exploration artifact per feature」（追加缺节、空节的后果）。

## Impact

- 运行时：`harness/scripts/utils/check-disposition.ts`（去向表四条）。
- 测试：`check-disposition-consumers`（review 真实 CLI：文件数、decisions）、`real-chain-seams`（RC-8c / RC-8d：plan 缺节、空节经 goal 真实链路；
  RC-8a/8b 的失败载体换为 `contract_file_reference_closure`）。
- 指引：`skills/reference/agents-entry-detail.md`、`skills/feature/device-testing/SKILL.md` 如实写明这几项缺了会被披露、不单独阻断。
- 消费者可见：见 `MIGRATION.md` 3.1.0「失败检查按保护对象处置」一节的第二批条目。
- 不改任何检查本身的判定逻辑；request 入口仍是任意失败即失败；违规钩子仍响应原始 FAIL。

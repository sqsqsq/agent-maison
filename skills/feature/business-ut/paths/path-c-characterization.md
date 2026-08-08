# business-ut · path-c · Characterization

> 主 SKILL.md 路由：无 `use-cases.yaml`、无 `acceptance.yaml`，且提供日志切片 → path-c。

## Step C1 — 读取输入

- 业务源码（contracts 指向的 module）
- 脱敏日志切片（单次执行）
- 可选业务描述

## Step C2 — 抽取观测序列

从日志还原边界调用顺序（port_call / state_transition），**不**推断「应该怎样」。

## Step C3 — 生成 DAG

- 写入 `<features_dir>/{feature}/ut/reports/flow-dag/{flow_id}.dag.yaml`
- 顶层 `flow_type: characterization`
- 每个非 assertion 节点 `origin` 必填（`log_observed` 优先）

## Step C4 — 入口可测性 + harvest-notes

不可直调点写入 `<features_dir>/{feature}/ut/harvest-notes.md`；**不**改业务源码。

## Step C5 — characterization UT

- 文件后缀 `*_characterization.test.ets`
- `it()` 名以 `[CHAR-<flowName>]` **起始**（`it_name_has_ac_or_branch_tag` 按起始标签匹配，接受 AC/BD/BRANCH/CHAR；无 acceptance 场景不得虚构 `[AC-*]`）
- 断言：边界调用序列、状态迁移、返回 shape（与 DAG trace 一致）

## Step C6 — 共同收尾

- 产出 `coverage-evidence.json`（`evidence_source` 以 ephemeral DAG / UT 标签为主）
- 跑 harness `--phase ut`；需求侧规则按各自前提自然 SKIP（如 `branch_coverage_full` 无 use-cases、AC 覆盖族无 acceptance）；`[CHAR-*]` 起始标签直接满足 it 命名门禁

## 升级路径

CHAR 用例稳定后可升级为 `[AC-*]` spec-driven（混合路由）。

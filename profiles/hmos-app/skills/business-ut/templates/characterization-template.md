# Characterization（path-c）模板

> 路径 C：存量「只求不坏」回归网；**不**产出 `acceptance.draft.yaml` / `contracts.draft.yaml`。

## 输入

- 源码切片 + **已脱敏**单次执行日志切片 + 业务描述（可选）

## 产物

| 产物 | 路径 |
|------|------|
| flow DAG | `<features_dir>/<feature>/ut/reports/flow-dag/<flow_id>.dag.yaml` |
| characterization UT | `{module}/src/ohosTest/.../*_characterization.test.ets` |
| harvest-notes | `<features_dir>/<feature>/ut/harvest-notes.md` |

## DAG 元数据（path-c 必填）

```yaml
flow_type: characterization
flow_id: card_open_observed_v1
nodes:
  - id: n1
    type: port_call
    origin: log_observed   # log_observed | static_inferred | human_confirmed
```

## UT 命名

- `it('[CHAR-<flowName>] ...', ...)`
- Spy 内禁止业务判断（与 path-A/B 共同约束）

## harvest-notes 条目

```yaml
proposals:
  - file: path/to/View.ets
    location: onClick handler
    issue: 入口不可直调
    proposed_refactor: 提取 named handler
    impact: coding 人工确认后重构
```

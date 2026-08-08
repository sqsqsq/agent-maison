---
name: UT 诊断真实性 — feature scope 归属与覆盖证据收口
version: 3.0.0
overview: business-UT gate correctness 收口：① AC 与 BD 的同数字后缀不再互相冒充覆盖；② coverage-evidence 的 dag_archived/dag_ephemeral 声明必须匹配真实 DAG 来源；③ 存在但损坏的 DAG、coverage-evidence、testability-audit、mock-plan 从静默跳过或按缺失处理改为路径明确的 BLOCKER；④ it() 名称门直接接受 [BD-<id>] 起始。canonical 路径与 schema 未变，无需迁移。
todos:
  - id: t1-ut-diagnostic-truth
    content: >
      落地 OpenSpec change ut-diagnostic-truth：scope 使用显式 context/Git 测试路径并在无线索时
      fallback:all；补跨 feature 同号 AC、ignored、非 Git 回归；坏 DAG/YAML/JSON 报 canonical
      路径与解析根因；coverage gate 报告真实 evidence contract；同步业务 UT skill、docs、模板与
      phase rule，并通过 typecheck、unit、fixtures 与 OpenSpec strict 验证。
    status: completed
isProject: false
---

# UT 诊断真实性（d3f8a1c6）

实现与行为契约见 `openspec/changes/ut-diagnostic-truth/`。本 plan 只作为 3.0.0 维护者 changelog
的生成来源；消费者无需迁移 canonical 路径或 schema，发布说明应把新增 fail-closed 诊断与
AC/BD 精确匹配列为可感知的 gate correctness 修复。

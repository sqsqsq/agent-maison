# Code Review 报告 — {module-name}

> **模块标识**: `{module-name}`
> **审查日期**: {date}
> **审查版本**: v1.0
> **审查人**: AI Code Reviewer
> **对应设计文档**: `doc/features/{module-name}/plan/plan.md`

---

## 一、审查范围

### 审查模块

| 模块名 | 所属层 | 格式 | 审查文件数 |
|--------|--------|------|-----------|
| {ModuleName} | {layer} | {模块产物格式} | N |

### 文件范围

> 基于 `doc/features/{module-name}/contracts.yaml > files` 列表，共 N 个源代码文件。

<详细文件列表或代码块>

---

## 二、审查方法

本次审查基于以下 Spec 规约和参考文档，按 5 大维度系统化执行：

| 审查维度 | 依据文档 | 检查要点 |
|----------|---------|---------|
| 架构合规性 | coding-rules.yaml, architecture.md | 外层 DSL 依赖、模块内分层 |
| 接口一致性 | contracts.yaml | 数据模型、方法签名、组件 Props |
| 编码规范 | coding-rules.yaml | 命名、硬编码、any 类型、async 模式 |
| 业务逻辑 | plan.md, acceptance.yaml | 异常处理、流程正确性、AC 覆盖 |
| 数据层 | coding-rules.yaml | 数据所有权、模拟数据隔离 |

---

## 三、问题清单

| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |
|------|---------|------|---------|---------|---------|
| CR-001 | BLOCKER/MAJOR/MINOR/INFO | 分类名 | 具体问题描述（含代码证据） | `path/to/source-file` | 具体修复步骤 |
| ... | ... | ... | ... | ... | ... |

---

## 四、问题统计

| 严重程度 | 数量 |
|---------|------|
| BLOCKER | N |
| MAJOR | N |
| MINOR | N |
| INFO | N |
| **合计** | **N** |

---

## 五、修复建议摘要

### BLOCKER 级（必须修复）

<逐条列出 BLOCKER 问题的修复要点>

### MAJOR 级（建议修复）

<逐条列出 MAJOR 问题的修复要点>

---

## 六、结论

> harness 只解析下方"审查结论"声明行，且须**恰好填一个**裁决词。可选值（三选一）：通过、有条件通过、不通过 —— 含 BLOCKER 必判不通过；无 BLOCKER 有 MAJOR 判有条件通过；均无判通过。声明行留多个或不填 = 歧义/缺失 → harness 判 FAIL。

**审查结论**: <填写单一裁决，删除本占位>

<结论说明：通过理由或不通过原因>

**判定依据**:
- BLOCKER 数量: N
- MAJOR 数量: N
- 判定规则：存在 BLOCKER → 必须判"不通过"；无 BLOCKER 但有 MAJOR → 判"有条件通过"；均无 → 判"通过"

**下一步建议**（按上方审查结论执行）:
- 若结论为"不通过"：修复所有 BLOCKER 后重新审查
- 若结论为"有条件通过"：修复 MAJOR 后建议重新审查，或经团队评审后可进入下一阶段
- 若结论为"通过"：若需 UT，请用户明示 business-ut 意图或确认 **`review.ok_to_ut` / `phase.next_step`**（user-confirmation-ux §8）；**禁止** agent 因报告结论自动开 business-ut

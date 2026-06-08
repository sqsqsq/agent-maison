# UT 产物格式速查卡（弱模型专用）

> **用途**：写 `testability-audit.md` / `mock-plan.yaml` / `*.test.ets` 前必读。只列约束，不讲原理。

## testability-audit.md（`.md` 文件）

| 允许 | 禁止 |
|------|------|
| 纯 YAML 全文 | Markdown **表格**（`\| AC \| ... \|`） |
| 一个 fenced ` ```yaml ... ``` ` 块，根字段 `records:` | 多个无 `records` 的散落段落 |
| YAML 块内 `#` 行内注释 | 把 mock-plan 内容写进本文件 |

**最小合法形态**：见 [testability-audit-template.md](testability-audit-template.md) § EXACT OUTPUT FORMAT。

## mock-plan.yaml（`.yaml` 文件）

| 允许 | 禁止 |
|------|------|
| 纯 YAML（首行即 `schema_version:` 或 `spies:`） | Markdown 标题（`# 标题` 独占一行） |
| 行内 `# 说明`（YAML 注释） | ` ```yaml ` 围栏 |
| `returns.ts_expr` 含 `as Type` 或 `new Name(` | 无类型字面量 `{ ok: true }` |

## it() 命名

| 允许 | 禁止 |
|------|------|
| `[AC-1] 描述` | 无标签开头 |
| `[BRANCH-happy_path][AC-1] 描述` | `[BD-1] 描述`（正则不认 BD 开头） |
| `[AC-1][BD-1] 描述` | `[BD-1-a]` 等 acceptance.yaml 中不存在的子 ID |

## 写入前 5 秒自检

- [ ] audit：有 `records:` + 每条 `acceptance_id` 与 acceptance.yaml 一致
- [ ] mock-plan：纯 YAML，`ts_expr` 带 `as` 或 `new`
- [ ] it()：以 `[AC-` 或 `[BRANCH-` 开头

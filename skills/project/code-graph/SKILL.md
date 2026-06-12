# Code Graph 建图与维护 Skill (`code-graph`)

## 前置（依赖 catalog 与 framework-init）

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md) 与 [`catalog-bootstrap`](../../project/catalog-bootstrap/SKILL.md) Phase A：实例根下已有有效的 `framework.config.json` 与 `doc/module-catalog.yaml`（目标模块已建档）。

**Harness 运行时前置**：执行本 Skill 中任意 `harness-runner` / `bootstrap:code-graph` 前，须满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md)。

**Personal setup（BLOCKER）**：跑 harness 前须 [personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `code-graph.derive_confirm` / `code-graph.curated_confirm`。

## Step 0. 载入 `project_profile` addendum（强制）

完整阅读：

`framework/profiles/<project_profile.name>/skills/code-graph/profile-addendum.md`

> **动态资产引用**：正文 `` `profile-skill-asset:code-graph/<asset_key>` `` 须按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

---

## 触发条件

- "建 code graph / 模块功能图谱 / 刷新图谱"
- "code graph drift / 图谱漂移检查"
- `/code-graph <ModuleName>`
- 用户要为某模块建立「只求核心流程守住」的 characterization 安全网锚点

## 核心设计原则

1. **一次一个模块**：与 catalog-bootstrap 对齐，每轮只处理 1 个 catalog 模块。
2. **图谱只作索引**：Code Graph 不是 spec/plan/coding 真源；用时必须反查源码 anchor。
3. **派生层可重建**：`derived` 由 `bootstrap:code-graph` 自动生成；`nodes` 策展层须用户确认后写入。
4. **与 flow DAG 边界**：本 Skill **不**生成、不验证 business-ut 的 flow DAG 连续性；`module-graph` phase 只验锚点与漂移。
5. **profile 能力分界**：`module-graph` 门禁 profile 中立（零图谱 PASS）；**生成/刷新 derived** 须当前 profile 提供 `GraphExtractor`（hmos-app 已提供；generic 等仅 drift 检查）。

---

## 工作流程

### Step 1. 选定模块

用户传入 `/code-graph <ModuleName>` 或对话指定模块名。须在 `doc/module-catalog.yaml` 的 `modules[].name` 中存在；否则 FAIL 并提示先跑 catalog-bootstrap。

记录 `package_path = <layer>/<name>`（catalog 卡片）与落盘路径 `paths.module_graphs_dir`（默认 `<module>/code-graph.yaml`）。

### Step 2. 刷新派生层（bootstrap）

在宿主工程根（`framework/` 已挂载）：

```bash
cd framework/harness
npm run bootstrap:code-graph -- --project-root <宿主根> --module <ModuleName> [--seed-from-catalog] [--dry-run]
```

- 首次建图且 `nodes` 为空：建议加 `--seed-from-catalog` 生成草稿节点（`core: false`）。
- 已存在 YAML：**只刷新 `derived`**，保留已有 `nodes[]`。
- 非 hmos profile 或无 GraphExtractor：脚本会清晰报错退出；可仅跑 Step 5 的 drift 门禁。
- **`--package-path` 覆盖**：落盘路径按覆盖后的 package 解析；`module-graph` 门禁只扫 catalog 的 `layer/name` 默认路径。若 package 与 catalog 不一致，须同步 catalog 或接受门禁扫不到该文件。

**停等 `code-graph.derive_confirm`**：向用户展示 dry-run 或写入摘要（签名数、import/call 边、nodes 数），确认后再正式写盘（若已 `--dry-run` 预览则确认后去掉该 flag 重跑）。

### Step 3. 策展 core 节点（人工薄层）

读取 `` `profile-skill-asset:code-graph/code_graph_template` `` 与 `` `profile-skill-asset:code-graph/curate_core_prompt` ``：

1. 从 seed 草稿中挑选 **3–5 个**真正要守住的入口标 `core: true`。
2. 为每个 core 节点写清 `intent`（业务意图，非实现细节）。
3. 勿整模块符号全标 `core`（避免维护噪声）。

可选 staging：将策展草稿写在对话中展示；确认后写入 `code-graph.yaml` 的 `nodes[]`。

**停等 `code-graph.curated_confirm`**：展示 core 节点清单与 intent 后再合并写盘。

### Step 4. 本地漂移自查（可选）

在写盘前/后可用库逻辑自查（agent 读 YAML + 调 drift 语义）：

- 符号消失 → BLOCKER
- core anchor hash 变 → BLOCKER
- 非 core 体 hash 变 → WARN

### Step 5. Harness 验证门禁

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase module-graph
```

> **无需 `--feature`**（全局 phase）。零图谱时 PASS 并提示建图。

### Step 6. 与 business-ut 的关系

- 本 Skill = **主动**建/维护模块级图谱。
- business-ut Step 8.0 = 需求收尾时**被动**评估是否触及 `core` 节点；触及则更新图谱并同步 UT。
- 二者共用同一 `code-graph.yaml` 与 `evaluateCodeGraphDrift()`。

---

## 输出规范

| 产出 | 路径 |
|------|------|
| Code Graph YAML | `<layer>/<Module>/code-graph.yaml`（由 `paths.module_graphs_dir` 解析） |
| 派生层 `derived` | 同上（bootstrap 刷新） |
| 策展层 `nodes` | 同上（人工确认后） |

---

## Slash / trace 约定（全局 phase）

通过 `/code-graph` 进入时，阶段结束前产出全局 trace（**非** feature trace.schema）：

```
# harness-runner 默认（start_commit 等）
framework/harness/reports/_global/module-graph/trace.json

# agent 完整跑动日志（可选子目录存档，与 gap-notes 配对）
framework/harness/reports/_global/module-graph/<timestamp>/<model>-module-graph/trace.json
```

同 phase 目录产出 `script-report.json`、`merged-report.md`（harness-runner 默认行为）。

---

## 关联文件

- 模板：`` `profile-skill-asset:code-graph/code_graph_template` ``
- 策展 prompt：`` `profile-skill-asset:code-graph/curate_core_prompt` ``
- 规约：`framework/specs/phase-rules/module-graph-rules.yaml`
- 检查脚本：`framework/harness/scripts/check-module-graph.ts`
- 概念 SSOT：`framework/docs/concepts/code-graph.md`
- bootstrap：`framework/harness/scripts/bootstrap-code-graph.ts`

---

## 约束

1. **禁止**把 Code Graph 当 spec/plan/coding/flow DAG 真源。
2. **禁止**一次批量处理多个模块。
3. **禁止**未经用户确认覆盖已有 `nodes[]` 策展层（bootstrap 已保护 derived-only 刷新）。
4. 中文输出。

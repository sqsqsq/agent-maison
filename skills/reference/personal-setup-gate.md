# Personal Setup 门控（阶段入口前置）

Feature phase（catalog-bootstrap / spec … device-testing）与对应 adapter slash / skills-bridge 入口在跑 harness **之前**须完成个人 setup。

## 探测（BLOCKER）

```bash
cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>
```

**仅解析 stdout JSON**（稳定字段：`ok`, `code`, `status`, `activeAdapter`, `materializedAdapters`, `ensured`, `candidates`, `message`）。勿依赖人读 stderr/stdout 散文。

| `code` | 行为 |
|--------|------|
| `ok` | 已就绪（或 `--ensure` 已自动写入 local）→ 继续本阶段 |
| `needs_adapter_choice` | 多 adapter：用 registry **`setup.adapter`** 选择 → `init-orchestrate --scope personal` 的 **`record-adapter`** 写盘（agent 不手写 JSON） |
| `no_materialized_adapter` | 项目未物化 adapter → **STOP**，引导 `/framework-init` |
| `not_in_materialized` / `entry_not_materialized` | 项目级缺口 → **STOP**，引导 `/framework-init` |

与 [`harness-runner.ts`](../../harness/harness-runner.ts) pre-phase 门控语义一致；`init` / `docs` 全局 phase 豁免。`init` 内部 `run-global-phases` 使用 `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1`（集成者自验，非普通入口）。

## 内联 setup 过程（多 adapter 或 DevEco）

**无**独立 slash / skills-bridge 跳板。仅当 `--ensure` 返回 `needs_adapter_choice` 或须校准宿主 IDE 工具链路径时，按下列 S1–S3 内联执行。

### 前置声明

- **本过程是个人级、一次性（可重复校准）配置**：写入 `<repo-root>/framework.local.json`（gitignored），**不修改** `framework.config.json`、`.claude/`、`.cursor/` 或任何项目级 adapter 产物。
- **前置**：工程根已有 `framework/`；项目级 init 已物化至少一个 adapter（见 `framework.config.json` → `materialized_adapters`）。
- 若用户想要的 adapter **不在** `materialized_adapters` 或磁盘产物缺失 → **停下**，引导执行 `/framework-init` 更新物化清单并物化，**不得**在本过程内写项目文件。
- **单一物化 adapter**：由 `check-personal-setup.ts --ensure` 确定性自写 local，**无需**进入下列交互。

### 触发条件（内联）

- 阶段前置门控 JSON 为 `needs_adapter_choice`（多 adapter 须选 active adapter）
- 须校准宿主 IDE 路径（registry `setup.deveco_path`；见 profile addendum）
- 自然语言明确要求个人 framework 设置（仍先跑 `--ensure`）

### 用户确认 UX

BLOCKER 确认须 progressive enhancement：[user-confirmation-ux.md](./user-confirmation-ux.md) · registry：`setup.adapter` / `setup.deveco_path`（[confirmation-registry.yaml](./confirmation-registry.yaml)）。

---

### S1. 探测（只读）

1. Shell 中调用 harness 须遵守 [harness-cli-cwd.md](./harness-cli-cwd.md)。
2. 运行个人 scope planner（只读）：

   ```bash
   cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope personal --project-root <repo-root>
   ```

3. 解析 stdout 的 `InitTaskPlan` JSON；向用户渲染任务表（`assert-active-adapter-materialized` → `record-adapter` → `detect-deveco` → `record-deveco-path`）。
4. 读取 `materialized_adapters`（来自 `loadFrameworkConfigWithSources`）；**禁止**在本步写盘。

#### S1.1 选择 active adapter（BLOCKER）

- 用 registry **`setup.adapter`**：选项**仅**为 `materialized_adapters` 中已列出的 adapter 目录名（确认菜单或 portable 编号）。
- 若用户选择未物化 adapter → 输出引导文案并 **STOP**（去跑项目 init）。

---

### S2. 批准与记录

1. 对 `detect-deveco` 任务：展示 harness 探测到的候选路径（若有）；用 registry **`setup.deveco_path`**（采用探测 / 跳过）。**禁止**在对话中收自由路径字符串；若候选均不对，提示用户在本机安装/修正后重跑 `--ensure`。
2. 将 S1–S2 选择序列化为 personal scope **decision JSON**（schema 同 `init-orchestrate.ts` 的 `InitRunDecision`）。
3. 执行 `executeInitPlan`（`record-adapter` / `record-deveco-path` 任务负责写 local；**禁止** agent 手写 `framework.local.json` 全文）。
4. **`assert-active-adapter-materialized` 只读通过**后，`record-adapter` 才写入 `framework.local.json`（DAG 顺序由 planner 保证）。

---

### S3. 摘要

1. 使用 harness `buildRunSummary(run-log)` 输出结构化摘要（勿自行拼表）。
2. 决策复述：`agent_adapter`、宿主 IDE 路径（若有）、local 文件路径。
3. 提示：后续 feature phase 将使用 merged config（local 覆盖 personal 字段）。

### 硬约束（BLOCKER）

| 约束 | 说明 |
|------|------|
| 不写项目产物 | 不得创建/修改 `.claude/**`、`.cursor/**`、`framework.config.json` |
| 只选已物化 adapter | `agent_adapter` ∈ `materialized_adapters` 且磁盘产物存在 |
| 禁自由输入 | 编排决策仅 enum/gate/checkbox；路径仅探测候选或跳过 |
| 探测只读 | S1 planner 运行前后磁盘 hash 不变（副作用仅在 S2 批准后） |

## 相关

- Tier_1 npm：[host-harness-readiness.md](./host-harness-readiness.md)
- 项目 vs personal：[framework-init](../project/framework-init/SKILL.md)

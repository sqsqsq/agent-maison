# Framework 个人 Setup Skill (`00b-framework-setup`)

## 前置声明

- **本 Skill 是个人级、一次性（可重复校准）配置**：写入 `<repo-root>/framework.local.json`（gitignored），**不修改** `framework.config.json`、`.claude/`、`.cursor/` 或任何项目级 adapter 产物。
- **前置**：工程根已有 `framework/`；项目级 init 已物化至少一个 adapter（见 `framework.config.json` → `materialized_adapters`）。
- 若用户想要的 adapter **不在** `materialized_adapters` 或磁盘产物缺失 → **停下**，引导执行 `/framework-init` 更新物化清单并物化，**不得**在本 Skill 内写项目文件。

## 触发条件

- Slash：`/framework-setup`
- 自然语言：「配置我用的 agent / 个人 framework 设置 / 宿主 IDE 路径」
- **Bootstrap**：`getFrameworkPersonalSetupStatus().source === 'fallback'` 时，须引导本 Skill。探测 CLI 见 [personal-setup-gate.md](../reference/personal-setup-gate.md)（与 harness-runner 门控一致）。

## 用户确认 UX

BLOCKER 确认须 progressive enhancement：[reference/user-confirmation-ux.md](../reference/user-confirmation-ux.md) · registry：`setup.adapter` / `setup.deveco_path`（[confirmation-registry.yaml](../reference/confirmation-registry.yaml)）。

---

## S1. 探测（只读）

1. Shell 中调用 harness 须遵守 [reference/harness-cli-cwd.md](../reference/harness-cli-cwd.md)。
2. 运行个人 scope planner（只读）：

   ```bash
   cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope personal --project-root <repo-root>
   ```

3. 解析 stdout 的 `InitTaskPlan` JSON；向用户渲染任务表（`assert-active-adapter-materialized` → `record-adapter` → `detect-deveco` → `record-deveco-path`）。
4. 读取 `materialized_adapters`（来自 `loadFrameworkConfigWithSources`）；**禁止**在本步写盘。

### S1.1 选择 active adapter（BLOCKER）

- 用 registry **`setup.adapter`**：选项**仅**为 `materialized_adapters` 中已列出的 adapter 目录名（确认菜单或 portable 编号）。
- 若用户选择未物化 adapter → 输出引导文案并 **STOP**（去跑项目 init）。

---

## S2. 批准与记录

1. 对 `detect-deveco` 任务：展示 harness 探测到的候选路径（若有）；用 registry **`setup.deveco_path`**（采用探测 / 跳过）。**禁止**在对话中收自由路径字符串；若候选均不对，提示用户在本机安装/修正后重跑 setup。
2. 将 S1–S2 选择序列化为 personal scope **decision JSON**（schema 同 `init-orchestrate.ts` 的 `InitRunDecision`）。
3. 执行：

   ```bash
   cd framework/harness && npx ts-node -e "
   const o=require('./scripts/init-orchestrate');
   /* 由 AI 注入 plan + decision + projectRoot */
   "
   ```

   或后续专用 `--execute --decision-file` 入口；当前可调用 `executeInitPlan` + `writeLocalConfig`（`record-adapter` / `record-deveco-path` 任务负责写 local）。

4. **`assert-active-adapter-materialized` 只读通过**后，`record-adapter` 才写入 `framework.local.json`（DAG 顺序由 planner 保证）。

---

## S3. 摘要

1. 使用 harness `buildRunSummary(run-log)` 输出结构化摘要（勿自行拼表）。
2. 决策复述：`agent_adapter`、宿主 IDE 路径（若有）、local 文件路径。
3. 提示：后续 feature phase 将使用 merged config（local 覆盖 personal 字段）。

## 硬约束（BLOCKER）

| 约束 | 说明 |
|------|------|
| 不写项目产物 | 不得创建/修改 `.claude/**`、`.cursor/**`、`framework.config.json` |
| 只选已物化 adapter | `agent_adapter` ∈ `materialized_adapters` 且磁盘产物存在 |
| 禁自由输入 | 编排决策仅 enum/gate/checkbox；路径仅探测候选或跳过 |
| 探测只读 | S1 planner 运行前后磁盘 hash 不变（副作用仅在 S2 批准后） |

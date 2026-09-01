# Personal Setup 门控（阶段入口前置）

Feature phase（catalog-bootstrap / spec … device-testing）与对应 adapter slash / skills-bridge 入口在跑 harness **之前**须完成个人 setup。

## 探测（BLOCKER）

```bash
cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>
```

goal-mode 的 local-first 解析与需要 `--select-adapter` 的条件见 [goal-mode-operations.md](goal-mode-operations.md#运行身份resolved_adapter解析阶梯)；已有合法 local 时不得再传请求身份触发重复选择。

**仅解析 stdout JSON**（稳定字段：`ok`, `code`, `status`, `activeAdapter`, `materializedAdapters`, `ensured`, `candidates`, `message`, `visualProvider`）。勿依赖人读 stderr/stdout 散文。

`visualProvider` 在本 checker 中仍是**纯 advisory**：它**永不**影响 `ok` / `code`，因为这里缺少
UI 相关性与 primary effective image-input 上下文，不能全局判失败。它是 goal 启动的**条件
prerequisite 输入**：`goal-runner` 在 primary canary 尝试后、正式 phase 前统一判断
「UI 相关 + primary blind + 无合法 provider」是否持有一次明确盲跑授权。

| 字段 | 含义与用法 |
|------|-----------|
| `visualProvider.shouldPrompt` | `true` → 按 S2.1 **问一次**；`false` → **不问**（已配置且受支持） |
| `visualProvider.state` | `absent` / `ok` / `unsupported` / `unavailable`；`unavailable` 也须提示修复配置或明确盲跑，不等于授权 |
| `visualProvider.supported[]` | catalog 现算的支持项——**唯一**支持列表来源，勿在别处枚举 |
| `visualProvider.prompt` | `shouldPrompt` 时的现成提示语（含「重选」「跳过并 blind」两条出路） |
| `visualProvider.decisionClass` | 询问用的 registry 条目 id（`setup.visual_provider`） |
| `visualProvider.task` | 写盘用的 init 任务 id（`record-visual-provider`） |
| `visualProvider.configured` | 已有配置时回显 `{adapter, model}`（`state != absent` 才有） |

| `code` | 行为 |
|--------|------|
| `ok` | 已就绪（或 `--ensure` 已自动写入 local）→ 继续本阶段 |
| `needs_adapter_choice` | 多 adapter 且未传有效 `--select-adapter`：用 registry **`setup.adapter`** 选择 → `init-orchestrate --scope personal` 的 **`record-adapter`** 写盘（agent 不手写 JSON）；goal-mode 下 `--select-adapter` ∈ candidates 时 CLI 确定性自写（`ensured: auto_selected_adapter`） |
| `no_materialized_adapter` | 项目未物化 adapter → 先复核 `--project-root` → **STOP**，引导 `/framework-init` |
| `not_in_materialized` / `entry_not_materialized` | 项目级缺口 → **STOP**，引导 `/framework-init` |

`ensured` 枚举含：`auto_single_adapter`、`auto_selected_adapter`、`auto_detect_deveco`、`auto_single_adapter_and_deveco`、`auto_selected_adapter_and_deveco`。

与 [`harness-runner.ts`](../../harness/harness-runner.ts) pre-phase 门控语义一致；`init` / `docs` 全局 phase 豁免。`init` 内部 `run-global-phases` 使用 `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1`（集成者自验，非普通入口）。

## 内联 setup 过程（多 adapter 或 DevEco）

**无**独立 slash / skills-bridge 跳板。仅当 `--ensure` 返回 `needs_adapter_choice` 或须校准宿主 IDE 工具链路径时，按下列 S1–S3 内联执行。

### 前置声明

- **本过程是个人级、一次性（可重复校准）配置**：写入 `<repo-root>/framework.local.json`（个人级本地配置；是否纳入宿主 SCM 由宿主自行决定），**不修改** `framework.config.json`、`.claude/`、`.cursor/` 或任何项目级 adapter 产物。
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

3. 解析 stdout 的 `InitTaskPlan` JSON；向用户渲染任务表（`assert-active-adapter-materialized` → `record-adapter` → `detect-deveco` → `record-deveco-path` → `record-visual-provider`）。
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

### S2.1 只读视觉 provider（可选，可跳过）

**问不问不靠你判断，读机器字段**：本轮涉及 UI 且**主模型无视觉能力**时，读 S1 那份 stdout JSON 的
`visualProvider.shouldPrompt`——`true` 才问、且只问一次；`false` 一律不问（已配置且受支持）。
该字段的判据就是「local 缺失、现有 adapter 已不在支持列表内、**或配置读取不可用**」，
由 harness 确定性算出，不要在对话里重新推断。非 UI 轮次不看它。

- provider = **只读**第二 endpoint：只看图产结构化评审，物理上不写工程；正式产物唯一写者仍是主模型。
- 用 registry **`setup.visual_provider`**（即 `visualProvider.decisionClass`；从支持列表选或保持未配置）。
  选项与提示语直接取 `visualProvider.supported[]` 与 `visualProvider.prompt`——**支持列表现算自
  adapter catalog**（扫 `agents/<adapter>/adapter.yaml` 的 `visual_provider` 完整声明），
  本文与任何文档**都不写死名单**。
- 选中的 adapter 不在支持列表 → 任务 failed 并回列支持项：**请重选或保持未配置**。框架**不自动改选**、
  **不在多个 provider 之间 fallback**。
- 写盘由 `record-visual-provider` 任务完成（即 `visualProvider.task`；
  `executionContext.visualProvider = {adapter, model}`）；**禁止** agent 手写 `framework.local.json`。
- 保持未配置时不写 `framework.local.json`，也不产生质量授权。严格视觉需求在后续
  requirement/capability preflight 诚实 defer；非 strict 可按既有 advisory 策略继续。
- 无人值守（goal headless）**不走本步**：旧配置失效/读取不可用只 WARN 并按「无 provider」处理，
  不询问、不自动 fallback；后续门禁依据冻结需求与能力事实决定结果。

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
| 门控失败即 STOP | personal-setup / preflight 失败或有歧义 → **STOP** 交回用户；**严禁**绕过 harness / **严禁**自由改码 |

## 相关

- Tier_1 npm：[host-harness-readiness.md](./host-harness-readiness.md)
- 项目 vs personal：[framework-init](../project/framework-init/SKILL.md)
- 视觉能力实测（personal-setup 后置，UI 相关阶段·交互式）：[interactive-vision-canary](./interactive-vision-canary.md)——自测卷判卷无感写 `framework.local.json` 的 `vision.canary`；缺能力按 strict/optional 质量契约自动投影，不设盲档人签通行证

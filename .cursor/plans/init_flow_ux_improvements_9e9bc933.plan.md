---
name: Init Flow UX Improvements
version: 2.2.0
overview: 基于宿主工程运行日志分析，解决两个根因级问题：(1) AGENTS/CLAUDE.md 模板渲染管线不统一导致占位符残留与摘要回退；(2) Init UPDATE context 派生管线缺失导致 agent 被迫手写 90 行冗余 payload。
todos:
  - id: theme-1-unified-renderer
    content: 主题 1：抽取 template-renderer.ts，共享 render + vars 构建 + assertNoUnreplacedPlaceholders
    status: completed
  - id: theme-1-arch-summary
    content: 主题 1：buildArchitectureSummary DSL 引用 + buildAgentsTemplateVars 接受可选 architectureSummary
    status: completed
  - id: theme-2-context-phase1
    content: 主题 2：deriveBaseContextForPlanning（strip + cross-check + sync + defaults），留在 init-orchestrate.ts 内部
    status: completed
  - id: theme-2-context-phase2
    content: 主题 2：deriveContextForExecution(plan.mode)（plan 生成后，UPDATE 补最小 configWritePayload）
    status: completed
  - id: openspec-change
    content: 创建 openspec/changes/init-render-context-unification/ OpenSpec change + delta spec：编写/新增 requirement（renderer 无残留、UPDATE 最小 payload、decision adapters SSOT、CREATE 缺 payload 仍阻断）
    status: completed
  - id: theme-2-smart-auto-sugar
    content: 主题 2（可选 P2）：--smart-auto 语法糖，内部复用两阶段管线
    status: completed
  - id: validation
    content: 验收：渲染无 {{...}}、UPDATE emit 含最小 payload、cross-check 在 sync 前执行、preflight/executor 用同一 ctx、CREATE 缺 payload 仍阻断、--summary 改 optional
    status: completed
isProject: false
---

# Init Flow 根因级改进

## 背景

宿主工程运行日志（`d:\97.log\问题4.txt`）暴露 init 执行链的两类系统性问题，不是散点 bug 而是**架构缺陷**。Review 确认：散点补丁（方案 B/D/E 原版）容易埋新漏洞进执行链；应从根因出发做两条管线统一。

---

## 主题 1：AGENTS/CLAUDE.md 渲染管线统一

### 问题

仓内存在两套独立渲染路径，共用同一模板 [`templates/AGENTS.md.template`](templates/AGENTS.md.template) 但行为不一致：

| 维度 | `render-agents-md.ts`（独立 CLI） | `check-init.ts` renderTemplate（executor 使用） |
|------|------|------|
| vars 结构 | `Record<string, string>` 动态 | `interface RenderEnv` 固定 15 字段 |
| 替换方式 | `split({{KEY}}).join(value)` 遍历 | 硬编码 `.replace()` 链 |
| 安全检查 | `findUnreplacedPlaceholders` 报错 | 无 |
| EXTENSION_SKILL_SECTION | 有 | **缺失** → 占位符残留 |
| ARCHITECTURE_SUMMARY | 外部传入（CLI `--summary`） | 内部 `buildArchitectureSummary` 生成（写死字面值） |

**影响**：
- CLAUDE.md 第 120 行残留 `{{EXTENSION_SKILL_SECTION}}`
- 架构摘要从 "见 DSL cross_module_exports_file" 退化为 "跨模块出口 Index.ets"

### 方案

**抽取共享渲染模块**（新文件 `harness/scripts/utils/template-renderer.ts`）：

```typescript
export interface TemplateVars {
  [key: string]: string; // UPPERCASE keys，与模板占位符 1:1 对应
}

export function renderAgentsTemplate(tpl: string, vars: TemplateVars): string {
  let rendered = tpl;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

export function assertNoUnreplacedPlaceholders(rendered: string, context?: string): void {
  const remaining = rendered.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);
  if (remaining?.length) {
    throw new Error(
      `[template-renderer] 渲染后仍有未替换占位符：${[...new Set(remaining)].join(', ')}` +
      (context ? `（${context}）` : '')
    );
  }
}

/**
 * 从 config + projectRoot 构建完整 AGENTS.md.template vars。
 * architectureSummary 可选：缺省时内部计算 DSL 引用风格摘要；
 * 传入时直接使用（保留 render-agents-md.ts CLI --summary 兼容性）。
 */
export function buildAgentsTemplateVars(
  config: Record<string, unknown>,
  opts: {
    entryFile: string;
    projectRoot: string;
    frameworkRoot: string;
    architectureSummary?: string; // 缺省 → buildArchitectureSummary(config.architecture)
  }
): TemplateVars { ... }
```

**`buildArchitectureSummary` 改为 DSL 引用风格**：

```typescript
// 旧（check-init.ts L858）：
return `${layerPart}，${innerPart}，跨模块出口 ${exitFile}`;
// 新：
return `${layerPart}，${innerPart}，跨模块出口见 DSL \`cross_module_exports_file\``;
```

移入 `template-renderer.ts` 并导出，作为 `buildAgentsTemplateVars` 的内部 fallback。

**改造路径**：

1. `render-agents-md.ts`：`buildVars` → 调用 `buildAgentsTemplateVars({ ..., architectureSummary: opts.architectureSummary })`，**CLI `--summary` 传入则用外部值**，保持向后兼容
2. `check-init.ts`：
   - `buildRenderEnv` → 调用 `buildAgentsTemplateVars`（不传 `architectureSummary`，内部计算 DSL 引用风格）
   - `renderTemplate` → 调用 `renderAgentsTemplate` + `assertNoUnreplacedPlaceholders`
   - 删除 `interface RenderEnv` 和固定 `.replace()` 链
3. `init-task-executor.ts`：**不新增 context 派生职责**，仅适配新 renderer（`syncTemplateTarget` 中 `file.kind === 'rendered'` 用新 renderer）；executor 只接收 orchestrator 已归一化好的 ctx

### 验收

- `cd harness && npm test` — 现有单测通过
- 渲染产物无 `{{...}}` 残留（`assertNoUnreplacedPlaceholders` 作为硬断言）
- 架构摘要不再内联字面值
- `render-agents-md.ts --summary "自定义"` 仍可覆盖内部计算（CLI 向后兼容）
- `render-agents-md.ts` CLI `--summary` 从 required 改为 optional；未传时内部计算 DSL 风格摘要；同步更新 `parseArgs` / `printUsage` / 相关单测
- `render-agents-md.ts` CLI 不传 `--summary` 时与 executor 路径对同一 config 产出 **byte-for-byte 一致**的 CLAUDE.md

---

## 主题 2：Init UPDATE context 派生管线统一

### 问题

当前 CLI execute 路径（[`init-orchestrate.ts`](harness/scripts/init-orchestrate.ts) L947-994）构造了**两个不同对象**：

```typescript
// L950-951：preflight 用（pre-sync，保留 raw adapter 用于 cross-check）
const strippedContext = withInitContextDefaults(stripContextReservedFields(rawContext) ?? {});
// L953-954：executor 用（post-sync，decision adapters 已覆写进 context）
const executionContext = withInitContextDefaults(
  syncDecisionAdaptersIntoContext(decision, stripContextReservedFields(rawContext))
);
```

问题不是"两个对象不该存在"，而是：
- **pre-sync 用途有限**：仅用于 `validateMaterializedAdaptersCrossCheck`（在 sync 前检测 raw vs decision 冲突）
- **post-sync 才是 preflight + executor 应共用的**：但目前 preflight 传的是 pre-sync 对象（L975），executor 传的是 post-sync 对象（L989）——导致 preflight 校验的 `configWritePayload` 缺少 `materialized_adapters` 同步
- `buildInitStagingTemplate`（L256）无 `projectRoot` → 无法在 UPDATE 模式读磁盘自动预填
- Agent 被迫手动构造 ~90 行 `configWritePayload`

### 关键约束

1. **避免循环依赖**：`syncDecisionAdaptersIntoContext`、`withInitContextDefaults`、`normalizeDecisionMaterializedAdapters` 定义在 `init-orchestrate.ts`。context 派生逻辑**留在 `init-orchestrate.ts` 内部**（不新建 `init-context-derive.ts`），或将 staging helpers/types 下沉到新模块并让 orchestrate 只消费
2. **cross-check 必须在 sync 前**：`validateMaterializedAdaptersCrossCheck` 基于 raw/stripped context 检测 agent 填写的 adapter 与 decision 不一致——这是有意设计，sync 后检测无意义。新管线中必须保留：先 cross-check raw → 通过后才 sync
3. **两阶段派生（鸡生蛋）**：`prepareInitExecutionPlanWithStaleIds` 需要 adapter 列表确定 plan tasks，但 `plan.mode` 只有 plan 生成后才知道。必须拆成：
   - **Phase 1 `deriveBaseContextForPlanning`**：strip + raw adapter cross-check + decision sync + generic defaults → 给 planner
   - **Phase 2 `deriveContextForExecution(plan.mode)`**：plan 已生成后，若 mode=update 且 `configWritePayload` 缺失 → 从磁盘派生最小 payload
4. **`configWritePayload` 优先级**：S2 显式 context > UPDATE 磁盘派生 > builder defaults；但 `materialized_adapters` 永远以 decision 为 SSOT（sync 覆写）

### 方案

**在 `init-orchestrate.ts` 内部新增两个纯函数**（不新建文件，避免循环）：

```typescript
/**
 * Phase 1：为 planner 准备 context（execute 路径 + emit 路径共用）
 * 顺序：strip → cross-check(raw vs decision) → sync adapters → defaults
 */
function deriveBaseContextForPlanning(
  rawContext: RawStagingContext | undefined,
  decision: InitRunDecision,
): { baseContext: NormalizedContext; crossCheckError: string | null } {
  const stripped = stripContextReservedFields(rawContext) ?? {};
  const crossCheckError = validateMaterializedAdaptersCrossCheck(decision, stripped);
  const synced = syncDecisionAdaptersIntoContext(decision, stripped);
  return { baseContext: withInitContextDefaults(synced), crossCheckError };
}

/**
 * Phase 2：plan 生成后，为 preflight + executor 准备最终 context
 * UPDATE 模式下若 configWritePayload 缺失，从磁盘派生最小语义 payload
 */
function deriveContextForExecution(
  baseContext: NormalizedContext,
  plan: InitTaskPlan,
  projectRoot: string,
  decisionAdapters: string[],
): NormalizedContext {
  if (plan.mode !== 'update') return baseContext;
  if (baseContext.configWritePayload) return baseContext; // S2 显式提供优先
  const derived = deriveUpdateConfigWritePayload(projectRoot, decisionAdapters);
  if (!derived) return baseContext;
  return { ...baseContext, configWritePayload: derived };
}

/**
 * UPDATE：从磁盘 config 提取最小语义 payload
 * 仅 project_name + project_profile + architecture
 * materialized_adapters 仅当 decisionAdapters 非空时写入（execute SSOT），emit 不得从磁盘带入
 * 绝不含 state_machine / toolchain / 默认 paths（builder 自动注入）
 */
function deriveUpdateConfigWritePayload(
  projectRoot: string,
  decisionAdapters: string[],
): Record<string, unknown> | undefined { ... }
```

**改造 CLI execute 路径**（L947-994）：

```typescript
// 新流程：
const { baseContext, crossCheckError } = deriveBaseContextForPlanning(rawContext, decision);
const planResult = prepareInitExecutionPlanWithStaleIds({ ... }, baseContext);
const reconciledDecision = reconcileInitRunDecisionForPlan(planResult.plan, decision, { ... });

// cross-check 结果可延后报错，但检测必须发生在 sync 前（基于 pre-sync raw context 计算）
if (crossCheckError) {
  // → buildPreflightBlockedLog + exit 1
}

// Phase 2：plan 已知 mode，补 configWritePayload
const finalContext = deriveContextForExecution(
  baseContext, planResult.plan, opts.projectRoot, normalizeDecisionMaterializedAdapters(reconciledDecision)
);

// preflight 与 executor 共用 finalContext
const preflight = preflightExecute(planResult.plan, reconciledDecision, finalContext, auditMeta, { projectRoot: opts.projectRoot });
if (!preflight.ok) { ... }
const log = executeInitPlan({ ..., executionContext: finalContext });
```

**改造 `--emit-staging-template`**：

- `buildInitStagingTemplate` 新增可选 `projectRoot` 参数
- 当 `plan.mode === 'update'` 且无显式 context 时，预填 `context.configWritePayload`
- **emit 阶段 `materialized_adapters` 语义**：
  - `decision.materialized_adapters` 仍为 `[]`（占位，待 S2 用户多选后填入）
  - `configWritePayload` **不得**含磁盘 `materialized_adapters`（避免与 S2 decision 冲突触发 cross-check）
  - execute 阶段：`syncDecisionAdaptersIntoContext` 以 decision 为 SSOT 同步到 context；`deriveUpdateConfigWritePayload(projectRoot, decisionAdapters)` 再将 decision adapters 写入 payload
- Agent 拿到的 template 已含最小 payload（无 adapter 预填），须在 S2 将用户多选结果填入 `decision.materialized_adapters`

**`--smart-auto` 语法糖**（可选 P2）：
- 内部生成 `InitRunDecision`（smart 规则）+ 两阶段 context → 同一条 preflight → executeInitPlan 管线
- 唯一额外 CLI：`--materialized-adapters <csv>`
- 不另起炉灶，不绕开 staging SSOT / preflight 原子性

### 验收

- UPDATE `--emit-staging-template` 输出的 `context.configWritePayload` 仅含最小语义字段（`project_name`、`project_profile`、`architecture`），**不含** `materialized_adapters` / `state_machine` / `toolchain` / 默认 `paths.*`
- CREATE 模式 `configWritePayload` 缺失时 preflight 仍阻断（机器门禁不变）
- raw context adapter 与 decision 不一致时仍 blocked（cross-check 基于 pre-sync raw 数据，在 sync 之前执行）
- preflight 与 executor 使用同一个 `finalContext` 对象（byte-for-byte 一致）
- `materialized_adapters` SSOT 始终为 decision，S2 context 仅用于 cross-check 冲突检测
- `--smart-auto` 若实现，等价于手动 emit → write staging → execute 的结果

---

## 不做的事项（Review 确认）

| 原方案 | 不做原因 | 替代 |
|--------|----------|------|
| 方案 B：preflight fallback 磁盘 config | 根因是管线分叉 + 缺 auto-derive；单点 fallback 只在 preflight 层补不解决 executor 一致性 | 主题 2 两阶段派生：Phase 2 在 plan 已知后统一补 configWritePayload，preflight + executor 共用 |
| 方案 D：readiness CWD 降级为 warning | OpenSpec 明确 cwd 为机器门禁；降级违反现有 spec | 保持门禁；日志真实问题是 agent 用相对 `cd framework/harness` 而 shell CWD 不确定——文档/模板可输出绝对路径或 `harness_root` 恢复建议 |
| Bug F/G 作为散点修复 | 补一个 `.replace()` 不解决根因；下次模板新增变量还会漏 | 主题 1 统一渲染器 + `assertNoUnreplacedPlaceholders` 硬断言 |
| 新建 `init-context-derive.ts` 独立模块 | 会 import `InitRunDecision`、`syncDecisionAdaptersIntoContext`、`withInitContextDefaults`（均在 `init-orchestrate.ts`），orchestrate 再 import 回来 → 循环 | derive 逻辑留在 `init-orchestrate.ts` 内部（仅当未来需将 staging helpers/types 下沉时才新建，orchestrate 只消费） |

## 关键设计约束（实施 BLOCKER）

1. **cross-check 顺序**：`validateMaterializedAdaptersCrossCheck` 必须基于 raw/stripped context（pre-sync）执行，通过后才允许 `syncDecisionAdaptersIntoContext`。否则 sync 会覆盖 raw adapter → 冲突永远检测不到
2. **两阶段不可合并**：Phase 1 给 planner（需 adapter 列表确定 materialize-* tasks），Phase 2 需 `plan.mode`（只有 plan 生成后才知道 CREATE/UPDATE）——顺序不可逆
3. **executor 不做 context 派生**：`init-task-executor.ts` 只接收 orchestrator 已归一化好的 ctx，不新增任何 derive 职责
4. **`configWritePayload` 优先级链**：S2 显式 context → UPDATE 磁盘最小派生 → builder defaults；`materialized_adapters` 永远以 decision 为 SSOT（Phase 1 sync 覆写）

---

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `harness/scripts/utils/template-renderer.ts` | **新建** — 共享渲染器（纯渲染，无 orchestrate 类型依赖） |
| [`harness/scripts/check-init.ts`](harness/scripts/check-init.ts) | 重构：删除 `RenderEnv` + `renderTemplate`，改用共享渲染器 |
| [`harness/scripts/render-agents-md.ts`](harness/scripts/render-agents-md.ts) | 重构：`buildVars` 改用 `buildAgentsTemplateVars` |
| [`harness/scripts/utils/init-task-executor.ts`](harness/scripts/utils/init-task-executor.ts) | 仅适配新渲染器；不新增 context derive 职责 |
| [`harness/scripts/init-orchestrate.ts`](harness/scripts/init-orchestrate.ts) | 主题 2 核心：两阶段 context 派生函数 + `buildInitStagingTemplate` 加 projectRoot + CLI execute 管线统一 |
| [`harness/scripts/utils/config-builder.ts`](harness/scripts/utils/config-builder.ts) | 导出 `readExistingConfigFromDisk`（当前为 module-private） |
| [`skills/00-framework-init/SKILL.md`](skills/00-framework-init/SKILL.md) | 文档同步：emit 已含 UPDATE 预填 |
| [`skills/00-framework-init/templates/staging-schema-example.md`](skills/00-framework-init/templates/staging-schema-example.md) | 更新示例 |

---

## 配套（实施 BLOCKER）

- **OpenSpec change + delta spec**（todo `openspec-change`）：本改动修改 init-orchestration 行为（UPDATE emit 预填、execute context 两阶段派生、preflight/executor 共用 finalContext）。须创建 `openspec/changes/init-render-context-unification/` 编写/新增 requirement（active change 阶段），先于或并行于代码实施；archive 是完成后合并/归档的动作
- **`render-agents-md.ts` CLI `--summary` 改 optional**：当前是 required（`parseArgs` + `printUsage` + main 检查）。改为 optional 后需同步更新 usage 文案、`main()` 缺参逻辑、相关调用方（若有脚本/CI 硬传 `--summary`）
- **单测适配**：`init-orchestrate.unit.test.ts`、`config-builder.unit.test.ts` 需适配新管线；`template-renderer.ts` 新模块需补单测；`render-agents-md` 的 `--summary` optional 需新单测覆盖

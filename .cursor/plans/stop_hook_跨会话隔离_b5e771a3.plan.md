---
name: Stop hook 跨会话 state 隔离（方案 B）
overview: 修复 framework/harness/state/.current-phase.json 跨会话粘滞、Stop hook 把陈旧阶段当作当前任务的设计缺陷。引入"会话边界"判据（session_id + TTL 兜底），同会话内严格保留 §5.1 拦截，跨会话静默放行+友好提示，并把"未闭环阶段"的训话式 PUA 文案改成中性引导。
todos:
  - id: config
    content: "S0: framework.config.json 新增 state_machine 段（grace_period_minutes / ttl_hours）+ config.ts 加载与校验 + hook 端轻量解析"
    status: pending
  - id: schema
    content: "S1: 升级 .current-phase.json schema：新增 session_id / session_id_recorded_at / last_seen_session_id / last_seen_at"
    status: pending
  - id: hook-check
    content: "S2: 改造 .claude/hooks/check-phase-completion.mjs：会话边界判定 + 文案中性化 + 老 state 自动盖章 + 时间常量从 config 读"
    status: pending
  - id: hook-record
    content: "S3: 同步改造 .claude/hooks/record-verifier-report.mjs：写 last_verifier_report 时也带上 session_id"
    status: pending
  - id: harness-runner
    content: "S4: harness-runner.ts 新增 --clear-state 子命令；schema_version 升级为 1.1"
    status: pending
  - id: check-receipt
    content: "S5: check-receipt.ts 不读 session_id（保持纯回执校验语义）；只确认 schema 升级不破坏它"
    status: pending
  - id: claude-md
    content: "S6: CLAUDE.md §5.1 增补：跨会话遗留处理流程 + --clear-state 出口；§6.5 文案保留但补一句'本条只对同会话生效'"
    status: pending
  - id: docs
    content: "S7: framework/docs/operations/harness-runbook.md 加'中断 / 切换会话 / 放弃阶段'章节 + state_machine 配置说明"
    status: pending
  - id: regression
    content: "S8: 加 e2e 测试 framework/harness/test/hook-stale-state.spec.ts 覆盖各种场景，含自定义配置覆盖默认值"
    status: pending
isProject: false
---

## 背景

### 问题复现
1. 用户在内网真机环境用 Claude Code + MX 2.5 跑某 feature 的 coding 阶段，中途 Ctrl+C 中断进程。
2. `framework/harness/harness-runner.ts` 已经在中断前写过 `framework/harness/state/.current-phase.json`，记录了 `phase=coding, feature=HWP-PaymentButton, status=running` 等字段，文件**遗留在磁盘**。
3. 用户重启 Claude Code，问"你是什么模型？"。Claude 正常回答完，主 agent 即将 stop，`.claude/settings.json` 注册的 Stop hook 触发。
4. Hook 读到陈旧的 state，认为"§5.1 四条件未满足"，把"严禁以'我假设/通常这样/为安全起见'为由跳过任意一步——CLAUDE.md §6.5 已明确这就是任务失败"塞进下一轮 prompt。
5. 模型在强约束下被迫继续上次的开发——**用户问个版本就被强行拉回旧任务**。

### 根因
- `.current-phase.json` 是**全局粘滞文件**，没有任何会话边界标记。
- Stop hook 的 `matcher: "*"` 无差别拦截所有主 agent 消息结束。
- 判据维度只有"磁盘 state 内容"，缺三层信息：会话关联 / 陈旧度 / 用户当前意图。
- §6.5 反假设条款的训话式文案在跨会话场景下变成 PUA，模型只能服从。

### 设计原则
1. **同会话内不放水**：本次会话明确在做某阶段时，§5.1 严格拦截弱模型假完成——这是机制初衷，必须保留。
2. **跨会话不绑架**：上次会话遗留的 state 不能强迫新会话接手；agent 也不会被注入"必须立即执行"的硬约束。
3. **不依赖未公开协议**：Claude Code Hooks 文档保证了 payload 含 `session_id`；不假设它会被注入 Bash tool 子进程 env。
4. **TTL 兜底**：升级前老 state、或 hook 不可用时，按时间陈旧度静默放行。
5. **决定权交回用户**：跨会话遗留时，提示文案让**用户**而不是 agent 决定继续/丢弃。
6. **所有阈值可配置（与 framework 现有 SSOT 风格对齐）**：GRACE_PERIOD / TTL **不允许在脚本里硬编码**，必须由 [framework.config.json](framework.config.json) 的新增 `state_machine` 段声明，未声明时回退到 `config.ts` 中的 `DEFAULT_STATE_MACHINE` 默认值。runner 与 hook 共用同一份解析逻辑（runner 走 [framework/harness/config.ts](framework/harness/config.ts)，hook 走轻量内联解析），保证单点真相。

---

## 核心设计

### 配置化（framework.config.json 新增 state_machine 段）

`framework.config.json` 顶层新增可选段 `state_machine`：

```json
{
  "schema_version": "1.0",
  "project_name": "SimulatedWalletForHmos",
  "...": "...",
  "state_machine": {
    "grace_period_minutes": 5,
    "ttl_hours": 12,
    "schema_version": "1.1"
  }
}
```

| 字段 | 类型 | 默认 | 取值范围 / 校验 |
|---|---|---|---|
| `grace_period_minutes` | number | 5 | (0, 60] —— 太长则失去 grace 语义、太短会误伤；超出范围抛错 |
| `ttl_hours` | number | 12 | [1, 168] —— 极端兜底，至少 1 小时、至多 7 天 |
| `schema_version` | `'1.1'` | `'1.1'` | 仅用于版本协商；当前实现只识别 1.1，否则 warn 并按默认值跑 |

**配置解析的双轨实现**（关键约束：runner 与 hook 必须读同一份配置但实现路径不同）：

- **runner / harness 侧**：扩展 [framework/harness/config.ts](framework/harness/config.ts)：
  - 新增 `StateMachineConfig` interface
  - 新增 `DEFAULT_STATE_MACHINE = { grace_period_minutes: 5, ttl_hours: 12, schema_version: '1.1' }`
  - `FrameworkConfig` 加 `state_machine?: StateMachineConfig` 字段
  - `normalizeConfig` 合并默认值
  - `validateStateMachine()` 函数校验范围（与 `validateArchitectureDsl` 同等地位的硬校验，违反抛错）
  - 新增 `loadStateMachineConfig(projectRoot)` / `resolveStateTimings(projectRoot)` 辅助函数返回毫秒值
- **hook 脚本侧**（`.claude/hooks/*.mjs` 是 ESM Node.js，**不能** `import { ... } from 'framework/harness/config.ts'`）：
  - 在 hook 脚本内嵌一个 `readStateMachineFromConfig(projectRoot)` 轻量函数（与现有 `readStateFileRelFromConfig` 同款），直接读 `framework.config.json` 的 `state_machine` 段
  - 校验失败 → 静默回退到与 config.ts 同步的常量默认值 `{ grace_period_minutes: 5, ttl_hours: 12 }`，不阻断 hook
  - 不引入 ts-node 依赖，保持 hook 启动毫秒级

**为什么不让 hook 直接调用 ts-node 跑 config.ts？**
hook 在 stop 时同步执行，引入 ts-node 启动至少多 500ms~1s，每次结束消息都被卡，体验崩。轻量重复解析换性能，约束是"两端默认值必须保持一致"——通过测试 S8 的"配置一致性"用例兜底。

### 关键巧思：让 hook 自己给 state "盖章"

`harness-runner.ts` 是 Bash tool 子进程，**拿不到稳定的 session_id**（env 不能假设有）。
所以放弃"runner 写、hook 读"的对称模型，改成**hook 单边维护 session 字段**：

- harness-runner 该怎么写 state 还怎么写（只管 phase / status / verdict / receipt 等业务字段）。
- Stop hook 第一次拿到 `payload.session_id` 且 state 里 `session_id` 缺失时，**反向回填** state.session_id。
- 后续同会话内的每次 Stop hook 触发都更新 `last_seen_session_id`。
- 任何时候发现 `payload.session_id !== state.session_id`，即视为"跨会话遗留"。

这样 harness-runner.ts 不依赖 cli 注入任何 env，纯 hook 协议自洽。

### 状态机扩展

`.current-phase.json` schema 升级（v1.0 → v1.1）：

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `schema_version` | `'1.1'` | runner / hook | 升级标记，旧版仍按 1.0 兼容 |
| `phase` | `Phase` | runner | 同前 |
| `feature` | `string` | runner | 同前 |
| `status` | `'running'\|'harness_finished'` | runner | 同前 |
| `started_at` | `ISO 8601` | runner | 同前 |
| `last_run_at` | `ISO 8601` | runner | 同前 |
| `verdict` | `'PASS'\|'FAIL'` | runner | 同前 |
| `blocker_count` | `number` | runner | 同前 |
| `receipt` | `ReceiptValidation\|null` | runner | 同前 |
| **`session_id`** | `string\|null` | **hook** | 新增：首次 Stop hook 命中时回填的 cli session_id；harness-runner 不写它 |
| **`session_id_recorded_at`** | `ISO 8601\|null` | **hook** | 新增：session_id 被回填的时刻 |
| **`last_seen_session_id`** | `string\|null` | **hook** | 新增：上一次 Stop hook 触发时的 session_id（用于审计） |
| **`last_seen_at`** | `ISO 8601\|null` | **hook** | 新增：上一次 Stop hook 触发时间 |
| `updated_at` | `ISO 8601` | runner / hook | 同前 |
| `last_verifier_report` | `obj\|null` | record-verifier hook | 同前；新增 `recorded_in_session: string\|null` |

### 判定流程（check-phase-completion.mjs）

```
读 framework.config.json -> state_machine 段
  GRACE_PERIOD_MS = grace_period_minutes * 60 * 1000          (默认 5 分钟)
  TTL_MS          = ttl_hours           * 3600 * 1000          (默认 12 小时)
  // 解析失败一律回退到内嵌默认值，不阻断 hook

读 state、读 payload.session_id

if !state: exit 0  // 不在阶段流程中

current_sid = payload.session_id ?? null
state_sid   = state.session_id ?? null

stale = false
reason = null

if current_sid && state_sid && current_sid !== state_sid:
  stale = true
  reason = 'session-id-mismatch'         // 上次会话遗留
elif current_sid && !state_sid:
  // 老 state（v1.0 升级前）或者 runner 刚写完 hook 还没盖过章
  age = now - (state.updated_at ?? state.last_run_at ?? state.started_at)
  if age > GRACE_PERIOD_MS:
    stale = true
    reason = 'state-pre-session-tracking-stale'
  else:
    // 还在 grace 期内，可能是 runner 刚写、hook 第一次命中——盖章并继续严格判定
    state.session_id = current_sid
    state.session_id_recorded_at = now
    persist(state)
    stale = false
    reason = 'fresh-state-stamped'
elif !current_sid:
  // payload 里没 session_id（理论上不会发生，但兜底）
  // 走 TTL 判定
  age = now - (state.updated_at ?? ...)
  if age > TTL_MS:
    stale = true
    reason = 'ttl-exceeded'

// 不管 stale=true/false，都更新 last_seen
state.last_seen_session_id = current_sid
state.last_seen_at = now
persist(state)

if stale:
  print_advisory_to_stderr(state, reason)
  exit 0   // 静默放行 + 给用户看的友好提示

// stale = false → 同一会话或 grace 期内的新 state，按 §5.1 严格判定
result = evaluateState(state)
if result.allow: exit 0
print_block_with_neutral_tone(state, result.missing)
exit 2
```

**两个时间常量（来自配置，不再硬编码）**：
- `grace_period_minutes` (默认 **5 分钟**)：runner 刚写 state、hook 第一次命中之间的时差容忍。新工程刚跑完 harness 想停下来时，state 才几秒钟，肯定不算 stale。
- `ttl_hours` (默认 **12 小时**)：极端兜底（payload 没 session_id 时）。常规路径用 session_id 比对，TTL 是保险栓。

不同团队可在 [framework.config.json](framework.config.json) 调整：例如夜里值班的工程把 ttl_hours 调大到 24，或者频繁重启 cli 的开发把 grace_period_minutes 调到 10。

### 文案改写

#### 跨会话遗留（stale=true）→ 输出到 stderr，不阻塞

```
[Stop Hook · 提示] 检测到上次 Claude Code 会话遗留的未闭环阶段：
  - feature: HWP-PaymentButton
  - phase:   coding
  - 上次活跃: 2026-04-26 22:14:02 (本机时区)
  - 触发原因: session-id-mismatch (当前会话 ≠ state 记录的会话)

本会话未对其执行任何操作，本次 stop 已自动放行。

如需在当前会话继续完成它：
  → 请明确告诉 agent："继续 HWP-PaymentButton 的 coding 阶段"
  → agent 会重新运行 harness-runner 并接管闭环流程

如需直接丢弃：
  → cd framework/harness && npx ts-node harness-runner.ts --clear-state
  → 或手动删除 framework/harness/state/.current-phase.json
```

#### 同会话未闭环（stale=false, evaluateState fail）→ 阻塞，但中性化

```
[Stop Hook] 当前会话内的阶段 phase="coding", feature="HWP-PaymentButton"
还未达到 CLAUDE.md §5.1 的闭环条件，缺失项：

  - status="running"，需要 "harness_finished"
  - harness verdict 缺失，需要 "PASS"
  - state.receipt=null，回执未填或未通过 check-receipt.ts

如果当前对话仍在做 HWP-PaymentButton 的 coding 阶段，请按下面修复指引补齐：

  1. 主 agent 自跑：
       cd framework/harness && npx ts-node harness-runner.ts \
         --phase coding --feature HWP-PaymentButton
  2. 通过 Task 工具调用 verifier 子 agent (subagent_type=verifier)
  3. 填写阶段完成回执：
       模板: framework/harness/templates/phase-completion-receipt.md
       目标: doc/features/HWP-PaymentButton/coding/phase-completion-receipt.md
  4. 重跑 harness-runner.ts 让回执校验回填后再尝试结束

如果你已经决定放弃这个阶段、或者本次对话只想做别的事：
  → cd framework/harness && npx ts-node harness-runner.ts --clear-state
  → 之后即可正常结束本次对话
```

**与原文案的关键差异**：
- 删除"严禁以'我假设/通常这样/为安全起见'为由跳过任意一步——CLAUDE.md §6.5 已明确这就是任务失败"。
  - 这条仍保留在 CLAUDE.md §6.5 里作为**全局原则**，但 hook 文案不复读，避免在跨会话场景制造心理胁迫。
- 增加"放弃出口"`--clear-state`，把决定权交回用户。
- 把"假完成"这种带情绪定性的词去掉，换成"未达到闭环条件"的事实陈述。

---

## 改动清单

### S0 · framework.config.json schema 扩展 + config.ts 加载

#### S0.1 · [framework.config.json](framework.config.json) 顶层新增段

```json
{
  "state_machine": {
    "grace_period_minutes": 5,
    "ttl_hours": 12,
    "schema_version": "1.1"
  }
}
```

实例工程（本仓 SimulatedWalletForHmos）默认按上面的值显式声明，方便未来调参留记忆。

#### S0.2 · [framework/harness/config.ts](framework/harness/config.ts) 改动

新增类型与默认值：

```ts
export interface StateMachineConfig {
  grace_period_minutes: number;
  ttl_hours: number;
  schema_version?: string;
}

export const DEFAULT_STATE_MACHINE: StateMachineConfig = {
  grace_period_minutes: 5,
  ttl_hours: 12,
  schema_version: '1.1',
};

export interface FrameworkConfig {
  schema_version: string;
  project_name: string;
  project_type: 'app' | 'atomic_service';
  agent_adapter: string;
  architecture: ArchitectureDsl;
  paths: FrameworkPaths;
  toolchain?: ToolchainConfig;
  state_machine?: StateMachineConfig;   // 新增
}
```

`normalizeConfig` 增加 `state_machine` 归一化（缺省时保留 undefined，使用方按需 fallback；显式声明时按字段融合 default）。

新增校验：

```ts
export function validateStateMachine(sm: StateMachineConfig): void {
  if (typeof sm.grace_period_minutes !== 'number'
      || sm.grace_period_minutes <= 0
      || sm.grace_period_minutes > 60) {
    throw new Error(
      `[framework/config.ts] state_machine.grace_period_minutes 必须在 (0, 60] 之间，收到 ${sm.grace_period_minutes}`,
    );
  }
  if (typeof sm.ttl_hours !== 'number'
      || sm.ttl_hours < 1
      || sm.ttl_hours > 168) {
    throw new Error(
      `[framework/config.ts] state_machine.ttl_hours 必须在 [1, 168] 之间，收到 ${sm.ttl_hours}`,
    );
  }
}
```

`loadFrameworkConfig` 在 `validateArchitectureDsl` 后追加 `if (config.state_machine) validateStateMachine(config.state_machine)`。

新增辅助函数：

```ts
export function loadStateMachineConfig(projectRoot: string): StateMachineConfig {
  const cfg = loadFrameworkConfig(projectRoot);
  return { ...DEFAULT_STATE_MACHINE, ...(cfg.state_machine ?? {}) };
}

export interface ResolvedStateTimings {
  gracePeriodMs: number;
  ttlMs: number;
}

export function resolveStateTimings(projectRoot: string): ResolvedStateTimings {
  const sm = loadStateMachineConfig(projectRoot);
  return {
    gracePeriodMs: sm.grace_period_minutes * 60 * 1000,
    ttlMs: sm.ttl_hours * 3600 * 1000,
  };
}
```

#### S0.3 · hook 端轻量解析（嵌入 [.claude/hooks/check-phase-completion.mjs](.claude/hooks/check-phase-completion.mjs)）

仿现有 `readStateFileRelFromConfig`，新增：

```js
const HOOK_DEFAULT_GRACE_MS = 5 * 60 * 1000;
const HOOK_DEFAULT_TTL_MS   = 12 * 3600 * 1000;
const HOOK_GRACE_RANGE = { minMin: 1, maxMin: 60 };
const HOOK_TTL_RANGE   = { minHours: 1, maxHours: 168 };

function readStateMachineFromConfig(projectRoot) {
  const result = { gracePeriodMs: HOOK_DEFAULT_GRACE_MS, ttlMs: HOOK_DEFAULT_TTL_MS };
  try {
    const cfgPath = path.resolve(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return result;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const sm = cfg?.state_machine;
    if (sm && typeof sm === 'object') {
      const gpm = sm.grace_period_minutes;
      if (typeof gpm === 'number' && gpm >= HOOK_GRACE_RANGE.minMin && gpm <= HOOK_GRACE_RANGE.maxMin) {
        result.gracePeriodMs = gpm * 60 * 1000;
      }
      const tlh = sm.ttl_hours;
      if (typeof tlh === 'number' && tlh >= HOOK_TTL_RANGE.minHours && tlh <= HOOK_TTL_RANGE.maxHours) {
        result.ttlMs = tlh * 3600 * 1000;
      }
    }
  } catch {
    // best-effort：解析失败回到默认值，不阻断 hook
  }
  return result;
}
```

校验范围与 config.ts 完全对齐——这是 plan 强约束。S8 回归用例 T9 会专门校验"两端默认值与边界一致"。



文件：`framework/harness/harness-runner.ts` 的 `CurrentPhaseStatePartial` / `CurrentPhaseState` 接口

```ts
interface CurrentPhaseStatePartial {
  phase: Phase;
  feature: string;
  status: 'running' | 'harness_finished';
  started_at?: string;
  last_run_at?: string;
  verdict?: 'PASS' | 'FAIL' | string;
  blocker_count?: number;
  receipt?: ReceiptValidation | null;
  // 注意：runner 不写 session 字段；下面四个字段由 hook 维护
}

interface CurrentPhaseState extends CurrentPhaseStatePartial {
  schema_version: '1.0' | '1.1';   // 1.0 兼容，1.1 是升级目标
  updated_at: string;
  // hook 维护字段
  session_id?: string | null;
  session_id_recorded_at?: string | null;
  last_seen_session_id?: string | null;
  last_seen_at?: string | null;
  last_verifier_report?: {
    verdict: string | null;
    report_path: string;
    recorded_at: string;
    recorded_in_session?: string | null;   // 新增
  };
}
```

`writeCurrentPhaseState` 行为不变（仍只写 runner 自己的字段）。
hook 写 state 时使用同一份 schema_version='1.1'，并保留 hook 维护字段。

### S2 · [.claude/hooks/check-phase-completion.mjs](.claude/hooks/check-phase-completion.mjs)

按"判定流程"重写主流程，关键改动：

1. 增加 `currentSessionId = payload?.session_id`。
2. 调用 S0.3 的 `readStateMachineFromConfig(projectRoot)` 读 `{ gracePeriodMs, ttlMs }`，**不再硬编码**。
3. 在 `evaluateState` 前面加一段 `evaluateSessionStaleness(state, currentSessionId, gracePeriodMs, ttlMs)`：
   - 返回 `{ stale: boolean, reason: string, action: 'pass' | 'stamp' | 'evaluate' }`。
4. `stamp` 分支：调用新函数 `stampSession(stateAbs, state, currentSessionId)`，把 session_id 写入 state（best-effort）。
5. `pass` 分支：调用新函数 `printAdvisory(state, reason)` 写 stderr，**不写 stdout 的 decision JSON**，直接 `exit 0`。
6. `evaluate` 分支：原有逻辑保留，文案按"中性化"模板替换。
7. 在所有分支末尾（除 stamp 已写之外），best-effort 更新 `last_seen_session_id` / `last_seen_at`。

新增函数（伪代码）：

```js
function evaluateSessionStaleness(state, currentSid, gracePeriodMs, ttlMs) {
  const stateSid = state.session_id ?? null;
  if (currentSid && stateSid && currentSid !== stateSid) {
    return { stale: true, reason: 'session-id-mismatch', action: 'pass' };
  }
  if (currentSid && !stateSid) {
    const age = ageOf(state);
    if (age > gracePeriodMs) {
      return { stale: true, reason: 'state-pre-session-tracking-stale', action: 'pass' };
    }
    return { stale: false, reason: 'fresh-state-stamped', action: 'stamp' };
  }
  if (!currentSid) {
    const age = ageOf(state);
    if (age > ttlMs) {
      return { stale: true, reason: 'ttl-exceeded', action: 'pass' };
    }
  }
  return { stale: false, reason: 'same-session', action: 'evaluate' };
}
```

### S3 · `.claude/hooks/record-verifier-report.mjs`

只动两处：
1. 写 `last_verifier_report` 时多带一个 `recorded_in_session: payload?.session_id ?? null`。
2. 同时更新 `state.last_seen_session_id = payload?.session_id` / `last_seen_at = now`。

不引入新 schema 校验，best-effort。

### S4 · `framework/harness/harness-runner.ts`

新增 `--clear-state` 子命令（不需要 phase / feature）：

```ts
// 在 args 解析后、phase 校验前插入
if (args['clear-state']) {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const stateAbs = statefilePath(projectRoot);
  const rel = path.relative(projectRoot, stateAbs).replace(/\\/g, '/');
  if (fs.existsSync(stateAbs)) {
    fs.unlinkSync(stateAbs);
    console.log(`✓ 已删除阶段状态文件 ${rel}`);
  } else {
    console.log(`⊘ ${rel} 不存在，无需清理`);
  }
  process.exit(0);
}
```

minimist 配置加：`boolean: ['list', 'help', 'verbose', 'clear-state']`。

`printHelp()` 末尾增加：

```
  --clear-state             丢弃当前阶段状态文件（用于明确放弃某个未闭环阶段）

放弃当前阶段:
  cd framework/harness && npx ts-node harness-runner.ts --clear-state
```

### S5 · `framework/harness/scripts/check-receipt.ts`

**不动**。它的语义是纯回执文件校验，不读 state.session_id，schema 升级对它无影响。
回归用例需要确认它仍然 exit 0/1/2 行为不变。

### S6 · `CLAUDE.md`

§5.1 末尾增补一小节：

```markdown
> **会话边界与跨会话遗留**：state 文件是**会话级**判据。Stop hook 用 session_id
> 区分"本会话内未闭环"与"上次会话遗留"两种情况：
> - 同一会话内未闭环 → 严格按上述四条件拦截（§6.5 反假设条款生效）；
> - 跨会话遗留      → 静默放行 + 在 stderr 给出友好提示，决定权交回用户；
>   用户可回复"继续 <feature> 的 <phase>"接手，或运行
>   `cd framework/harness && npx ts-node harness-runner.ts --clear-state` 丢弃。
>
> §6.5 反假设条款**仅在同一会话内**作为强约束生效；不允许把跨会话遗留 state
> 当作"用户在本会话布置的任务"。
```

§6.5 不删，但末尾追加一句澄清：

```markdown
> 反假设条款的适用范围是**当前会话内的明示任务**。如果 Stop hook 注入的提示
> 仅来源于上次会话遗留的 state（`session-id-mismatch` / `ttl-exceeded` /
> `state-pre-session-tracking-stale`），不视为"用户在本会话布置的任务"，
> agent 不应在用户没有明确指令的情况下接手。
```

### S7 · `framework/docs/operations/harness-runbook.md`

新增章节"中断、切换会话、放弃阶段"：

```markdown
## 中断 / 切换会话 / 放弃阶段

### 场景 1：harness 跑到一半 Ctrl+C
直接中断没问题。下次同一会话内重启 harness-runner 会覆盖旧 state，§5.1 严格拦截照常生效。

### 场景 2：Claude Code CLI 进程死了，重新启动
新会话首次 Stop hook 触发时，会因 session-id-mismatch 视为"上次遗留"，**静默放行**并在终端输出提示。
你有两个选择：
- 继续：明确告诉 agent "继续 <feature> 的 <phase> 阶段"，agent 重新运行 harness-runner 并接管。
- 丢弃：`cd framework/harness && npx ts-node harness-runner.ts --clear-state`

### 场景 3：临时切去做别的 feature
不需要清 state。新会话 / 新对话窗口里，旧 state 因 session_id 不一致会自动放行；本次操作不会污染新工作。
注意：仍**不建议**在同一 cli 会话里同时跑两个 feature——`.current-phase.json` 是单 slot，会互相覆盖。

### 场景 4：跨日恢复（≥ 12h 间隔）
即便 hook 协议没传 session_id，TTL 也会兜底放行。如需主动清理用 `--clear-state`。
```

### S8 · 回归用例

新增 `framework/harness/test/hook-stale-state.spec.ts`：

| 用例 | 输入 state | payload.session_id | 期望 hook 行为 |
|---|---|---|---|
| T1 同会话未闭环 | session_id=S1, status=running | S1 | exit 2 + block reason（中性文案） |
| T2 同会话已闭环 | session_id=S1, status=harness_finished, verdict=PASS, receipt.status=passed | S1 | exit 0，无 block |
| T3 跨会话遗留 | session_id=S1, status=running | S2 | exit 0 + advisory（不阻塞） |
| T4 老 state（无 session_id）+ 已陈旧 | session_id=null, updated_at=10 分钟前 | S1 | exit 0 + advisory（state-pre-session-tracking-stale） |
| T5 老 state + grace 期内 | session_id=null, updated_at=2 分钟前 | S1 | hook 盖章 → exit 2 + block（视为同会话） |
| T6 payload 无 session_id + TTL 内 | session_id=S1, updated_at=1h 前 | undefined | exit 2 + block（按 §5.1） |
| T7 payload 无 session_id + TTL 外 | session_id=S1, updated_at=20h 前 | undefined | exit 0 + advisory（ttl-exceeded） |
| T8 stop_hook_active=true | 任意 | 任意 | exit 0（防循环） |
| T9 自定义 grace=10min | session_id=null, updated_at=8 分钟前；framework.config.json 临时改为 `grace_period_minutes: 10` | S1 | 视为 grace 内 → 盖章 → exit 2 + block（验证配置生效） |
| T10 自定义 ttl=2h | session_id=S1, updated_at=3h 前；framework.config.json 临时改为 `ttl_hours: 2`；payload 无 session_id | undefined | exit 0 + advisory（ttl-exceeded，验证配置生效） |
| T11 配置一致性 | 调用 `loadStateMachineConfig` 与 hook 内嵌默认值对比 | n/a | 两者完全相等（DEFAULT_STATE_MACHINE === HOOK_DEFAULT_*）|
| T12 非法配置 | framework.config.json 写 `grace_period_minutes: -1` | 任意 | runner 启动抛错；hook 端静默回退到默认值并能跑（验证 hook 健壮性）|

实现方式：
- T1~T8、T11~T12 用 `child_process.spawnSync('node', ['.claude/hooks/check-phase-completion.mjs'])` 拼 stdin payload，验证 exit code 与 stderr 内容。
- T9~T10 在 setup 阶段把 framework.config.json 备份 → 写入临时配置 → 跑 hook → 还原。
- T11 是单元测试，直接 require config.ts（ts-node）+ 解析 hook 脚本源码里的 `HOOK_DEFAULT_*` 常量做对比，避免运行时双轨偏差。

---

## 落地时序

1. **先 S0**（配置基础设施）：framework.config.json 加 state_machine 段、config.ts 加类型/默认值/校验/loader、hook 端嵌入轻量解析。此步**不改任何运行时行为**（config 字段还没人读），只是把脚手架搭起来。完成后跑一遍现有 harness 确认不破。
2. **再 S1+S4**（不破坏当前行为）：state schema 接受新字段（hook 没写时为 undefined，runner 不动），加 `--clear-state`。
3. **再 S2+S3**（核心逻辑）：升级 hook 主流程，先按"严格判定不变 + 增加旁路"开发，跑 S8 回归用例（含 T9/T10 配置覆盖测试）。
4. **再 S6+S7**（文档同步）：CLAUDE.md / runbook 一并更新，避免文档脱节。
5. **最后 S5 验证**：跑 check-receipt 已有回归确认它对 schema 升级无感。

---

## 风险与开放点

1. **Claude Code Hooks 的 payload schema 变更**：本方案重度依赖 `payload.session_id`。若官方升级后字段改名，需要在 hook 里做兼容（`payload.session_id ?? payload.sessionId`），目前的实现按当前文档落地。
2. **多 cli 会话在同仓共存**：本方案能正确识别"另一个 cli 会话遗留"，但仍是单 slot state——A 会话刚跑 harness 写 state，B 会话立刻跑会覆盖。这是已知限制，不在本 plan 范围；后续若需要再做"按 session_id 分键的多 state 表"。
3. **slash command 不走主 agent**：理论上 `/clear` 之类内置命令不会走主 agent 的 stop 流程，但本方案不影响这条路径。
4. **`--clear-state` 是否需要再加确认提示**：当前实现是无条件删除。考虑用户脚本化场景，倾向于**不加交互**，加一行 `Tip: 如果你只想暂停，请重新进入对应 phase 的 SKILL；--clear-state 表示放弃已有进度。`。
5. **schema_version=1.1 的迁移策略**：旧 state 没有该字段，hook 兼容读取（缺即按 1.0 处理）；首次 `evaluateSessionStaleness` 命中 stamp 分支后顺手把 schema_version 写为 1.1。**不主动迁移**避免触发额外 IO。
6. **GRACE_PERIOD / TTL 默认值选择**：5 分钟 / 12 小时是经验值——5 分钟足够覆盖"runner 跑完到 hook 第一次命中"的延迟，12 小时是"昨晚的事今早不被卡死"的舒适带。**已通过 [framework.config.json](framework.config.json) `state_machine` 段配置化**（见 S0），不同团队可按节奏调整：夜班工程可设 ttl_hours=24；频繁 ctrl+c 的可设 grace_period_minutes=10。配置上下界（grace ≤ 60min、ttl ∈ [1, 168]h）在 config.ts 与 hook 双端校验，超界即回退到默认值/抛错。
7. **回归用例对 cli 协议的依赖**：T8 的 stop_hook_active 是 cli 协议字段；若 cli 不再传，hook 仍能正确退出。测试需要 mock 这一字段。
8. **CLAUDE.md §6.5 调整的兼容性**：现有 verifier-skill / SKILL.md 文案没有引用"§6.5 适用范围"这个表述，本次只在 §6.5 内追加，不修改外部引用。

# 框架升级兼容协议 v1（feature 局部 compat.yaml）

> **SSOT 字段表**：[framework/specs/feature-compat.schema.yaml](../../specs/feature-compat.schema.yaml)  
> **实现入口**：[framework/harness/compat-loader.ts](../../harness/compat-loader.ts)、[framework/harness/scripts/utils/report-generator.ts](../../harness/scripts/utils/report-generator.ts)  
> **Context Gate 与回填**：[framework/harness/scripts/utils/context-exploration.ts](../../harness/scripts/utils/context-exploration.ts)、`npm run backfill:context`（`framework/harness/package.json`）

---

## 1. 设计原则：永久态 vs 过程态

- **永久态（工程级）**：实例根 `framework.config.json` 描述架构 DSL、路径根、toolchain 等，装上即用，可版本对齐。它**不承载**任何具体 feature 名、豁免名单或「某需求做到哪一阶段」这类**过程态**。
- **过程态（feature 级）**：`doc/features/<feature>/` 已统一收纳 PRD、design、contracts、acceptance 等。**当 framework 升级引入新的 BLOCKER**（例如 Context Exploration Gate），在途/已完成的 feature 需要一条**可审计、可过期**的过渡通道。
- **决策时机**：不在 framework-init / Skill 00 阶段要用户批量决策；只在用户**主动**对某 `feature × phase` 跑 harness **撞墙**时，由报告与 suggestion 提示「正规化 vs 临时 compat」双路径。

---

## 2. compat.yaml 放哪、解决什么

- **路径**：`doc/features/<feature>/compat.yaml`（feature 根目录，与 `acceptance.yaml` 同级；文件名固定为约定名）。
- **作用域**：仅对 **feature 维度**阶段（`prd` / `design` / `coding` / `review` / `ut`）在 **脚本 harness 汇总报告前**生效；`init` / `catalog` / `glossary` / `docs` / `extensions` 等全局阶段**完全短路**（与 `_global` feature 一样不应用降级）。
- **不做的事**：不改 phase-rules、不改业务契约；只是在最终 `CheckResult[]` 上做一次**尾过滤**式调整，并写入 `script-report.json` 的审计段。

---

## 3. 降级与过期算法（实现契约）

### 3.1 匹配谁会被降级

仅处理同时满足：

- `severity === 'BLOCKER'` 且 `status === 'FAIL'`；
- 当前 `phase` 未被 `phases` 列表排除（缺省则全 feature phase 有效）；
- `check.id` 命中 `exempt_checks` 中任一项：  
  - 精确相等；或  
  - 模式为「前缀 + 末尾 `*`」（**禁止** `foo*bar` 这类中缀通配）。

### 3.2 降级后的形态

- `severity` 调整为 **`MINOR`**，`status` 为 **`WARN`**（与现有 `computeSummary` 一致：不计入 blockers，verdict 可仍为 PASS）。
- `details` 末尾追加固定标记行：  
  `[compat_downgraded by doc/features/<feature>/compat.yaml]`

> 历史 plan 草案曾写 `ADVISORY`；宿主 `Severity` 类型无该枚举，**实现统一映射为 `MINOR`**。

### 3.3 过期

- `scheduled_backfill_by` 为 `YYYY-MM-DD` 时：视为该日 **UTC 日历日**内有效，**自下一日 UTC 0 点起**协议失效（见 `isScheduledBackfillExpired`）。
- 过期时：**不**对任何项降级；向结果追加一条 `compat_expired`（BLOCKER / FAIL），suggestion 引导立即回填或更新期限。

### 3.4 解析/校验失败

- YAML 不可解析或字段不满足 schema：**不**阻断主 harness 链对「原规则」的判定；追加一条 **MINOR / WARN** 的 advisory（如 `compat_yaml_parse`、`compat_invalid_schema_version` 等），compat 整体视为 **disabled**。

---

## 4. 报告里的审计段

`generateScriptReport` 在 `computeSummary` 之前调用 `finalizeChecksForScriptReport` → `applyCompatDowngrade`。当：

- 发生降级：`ScriptReport.compat_applied = { count, ids, suggestion }`；
- 触发过期：`ScriptReport.compat_expired = { feature, suggestion }`。

便于 CI/人工扫 JSON 做过渡治理。

---

## 5. 为什么不是 framework.config.json

1. **避免污染全局档案**：compat 是「某个 feature 在特定升级窗口的临时状态」，与架构 DSL 生命周期不同；写入全局配置会导致：难审计、难随 feature 删除、易误配到错误环境。  
2. **与 feature 生命周期一致**：删除/归档 `doc/features/<feature>/` 即删除 compat，无残留。  
3. **Skill 00 零耦合**：升级者不需要在 init 阶段理解 compat；撞墙时由 harness 报告自解释。

---

## 6. 与 lifecycle / extensions 的边界

- **lifecycle hooks**：仍按原 workflow 与 manifest 派发；compat **不**代替 hooks，也不修改 hook 产物。  
- **extensions**：扩展 manifest / 能力档位与 compat 正交；compat 只作用于标准 `check-*.ts` 汇总的 `CheckResult`。  
- **正式修复路径**：优先用 `backfill:context` 生成合规 `context-exploration.md`（schema **1.1.0**，含 `source_code_paths` / `decisions_unlocked` / `ready_to_produce`）；compat 仅为止血带，且受 `scheduled_backfill_by` 强制到期。
- **exploration_strategy**：`exploration-strategy.ts` 按 phase 决定 subagent vs sequential；compat 不豁免 exploration 量化阈值（除非 `exempt_checks` 显式命中对应 `context_exploration_*` id）。

---

## 7. 最小示例

```yaml
schema_version: "1.0"
feature: home-page
exempt_checks:
  - context_exploration_*
reason: "Context Exploration Gate 引入前 design 已完成，回填排期中"
scheduled_backfill_by: "2026-08-01"
```

正规化命令（报告与 `context-exploration.ts` suggestion 同源）：

```bash
cd framework/harness && npm run backfill:context -- --feature home-page --phases prd
```

---

## 8. 维护注意

- 文案常量集中在 [framework/harness/compat-messages.ts](../../harness/compat-messages.ts)，避免多处分叉。  
- 修改降级语义时：同步更新本文件、`feature-compat.schema.yaml`、`compat-loader.ts` 与 `compat-loader.unit.test.ts` / fixture `ext_compat_legacy_pass`。

---

## 维护同步（2026-05-22 · 对齐 2.0）

- **Context Gate schema 1.1.0**：`context-exploration.ts` 量化阈值与 `exploration-strategy.ts` 联动；回填 CLI `npm run backfill:context` 不变。
- **testing 阶段不在 compat 范围**：Hylyre 真机链无 compat 降级；须修 acceptance / test-plan 或环境。
- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml)：`compat-loader`、`report-generator`、`feature-compat.schema.yaml` 与 §3–§7 一致。


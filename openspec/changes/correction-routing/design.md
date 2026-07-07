# Design: Correction Routing

## 修正三问（入口常驻文本，随 C1 落 AGENTS.md.template）

| 问 | 是 → 落点层 |
|---|---|
| Q1 需求/验收本身变了？ | spec（spec.md / acceptance.yaml） |
| Q2 需求没变，接口/契约/设计要变？ | plan（plan.md / contracts.yaml） |
| Q3 上游都没错——要改产品代码？ | 是 → coding；否（纯补验证）→ ut / testing |

模糊请求先诊断根因再分类；禁止未分层直接动产物。

## 执行序（C5-min）

```
NL 修正请求
 → resolveCorrectionTarget(request, activeState, proposed_files?)   # 编辑前；不确定→问人或 no-feature 模式
 → classifyCorrection(...) → {root_layer, touched_layers[], revalidate[]}
 → 写 .current-correction.json（status: pending）
 → 修正确认 gate（1=同意 / 2=改层；strict 必确认，headless 低置信 halt-confirm）
 → 实施修正（只动声明层）
 → 逐项重跑 revalidate[]（落点层及下游已闭环 phase 的脚本门禁；receipt 走既有 stale 指纹刷新）
 → --correction-check：对照清单核查全绿 → status: closed
```

## .current-correction.json

```json
{
  "schema_version": "1.0",
  "feature": "card-pack",            // no-feature 时为 null
  "root_layer": "coding",
  "touched_layers": ["coding"],
  "revalidate": [{ "phase": "coding", "status": "pending" }, { "phase": "testing", "status": "pending" }],
  "status": "pending",                // pending | closed
  "created_at": "<ISO 8601>",
  "session_id": "<host session>",     // 对齐 .current-phase.json session 治理（phase-state.ts）
  "base_commit": "<git sha>",         // 修正起点；changed-files 推导基准
  "request_fingerprint": "<hash>",    // 原始修正请求摘要，防换题复用
  "enforcement_tier": "soft_rule_only",
  "expires_at": "<ISO 8601>"          // 复用 state_machine ttl 语义
}
```

跨回合 / soft 档下 `--correction-check` 的稳定输入；**防串会话**：session_id 不符（超 grace）或过期 → state 视 stale，`--correction-check` 拒绝并要求重建 correction（codex scaffold review P2 采纳；字段对齐 `.current-phase.json` 既有 session 治理）。feature.yaml 修正历史 append 留 C5-full。

## no-feature 载体：--adhoc-correction（可执行契约）

harness-runner 非全局 phase 强制 `--feature`（:287）且 feature artifact 解析强依赖正式 feature 目录 → 新增 `--adhoc-correction` 专用入口，契约（codex scaffold review P1 采纳，逐项写死）：

- **输入**：`.current-correction.json`（必含 `base_commit`；缺失或 stale → exit 非零要求先建 correction）
- **changed-files 来源**：`git diff --name-only <base_commit>` ∪ 工作区未提交变更；触及模块经 catalog 反查记录回 state
- **必跑检查清单**：profile `coding.compile` + `coding.lint` provider + 架构规则检查（层依赖 / 跨模块出口）+ 受保护前缀——no-feature 无 scope 声明，`diff_within_scope` 以"catalog 反查 touched modules + 架构规则"替代，不豁免越界防护
- **报告路径**：`framework/harness/reports/_adhoc/<timestamp>/correction-report.md`（确定性路径，不落 features_dir）；报告逐项列 revalidate 结果
- **testing evidence 格式**：revalidate 含 testing 时，device 即席证据沿用 device-testing 即席报告契约，或 `manual_confirm` 记录（真人+时间）；缺能力走验证转嫁禁令 halt-confirm
- **不建临时假 feature 目录**

## enforcement 分档（C5-min 判定 + C5-full 深度集成）

判档是**派生纯函数**（codex scaffold review P2 采纳）：`resolveEnforcementTier(adapterManifest, runtimeContext)`，**优先级 mode 先行（codex 十轮 P1 采纳）**：

1. `runtimeContext.mode ∈ {headless, goal}` → `headless_runner`——**即便 manifest 声明了 hooks**：Claude Stop hook 在 `MAISON_GOAL_HEADLESS=1` 时直接旁路（check-phase-completion.mjs :631 坐实），goal 无头进程下物理拦截不在场，误判 hard_hook 会夸大保证；
2. 其次 manifest 声明 `settings_file` + `hooks`（Stop/SubagentStop，adapter-schema.yaml 既有字段）→ `hard_hook`；
3. 否则 `soft_rule_only`。

**不新增 adapter schema 字段、不按 adapter 名字硬编码**（SSOT = 既有 capability 声明）。

| 档 | adapter | 保证 |
|---|---|---|
| hard_hook | claude 系 | Stop/SubagentStop 物理拦截（C5-full 与 correction 状态联动） |
| headless_runner | goal-runner | runner 内置对账 + halt-confirm |
| soft_rule_only | cursor / generic | 三问 + 完成前 checklist + --correction-check；不得宣称 Stop hook 必拦 |

## touched_layers 对账（C5-full）

只拦"未声明的 touched layer"：声明仅 spec/plan 却出现 code diff → 拦；声明含 coding 的组合修正（改 spec 同轮把代码修到新契约）→ 放行但必须重验 coding 及下游。correction 状态并入 C2 `evidence_policy_snapshot` 做完整对账。

## 验证转嫁禁令

revalidate 指向 testing 而宿主无真机/hylyre 能力、或无 device 层验收可派生 → 显式声明 evidence 缺口 + halt-confirm（"需要人工验证：<清单>"）；goal-runner 侧记专用 halt 分类（与 await_human 系同构），不计入 no_progress。

# Proposal: Correction Routing — 修正路由（第二自由度轴）

## Why

正常推进走 skill 管线，中途出问题用户改用自然语言修正——该回合往往不加载任何 SKILL.md：per-skill 的 9 处"会话内硬边界/前置闸门"全是单向防御且此时不在场；入口路由表只覆盖正向意图；harness 无 correction 概念。强模型隐式做根因分层尚可，弱模型脱缰（宿主实测案例：cursor 53 秒直改 2 文件 + 删平行实现，无分层、无重验，以"请在真机上试一下"收尾）。用户自己也无法回答"该重走 spec→plan 还是直接 coding"——这是错误设问：修正不是阶段，是横切操作；正确设问是"根因在哪层产物"，且重验 ≠ 重做。

## What Changes

**C5-min（Phase 0，只依赖 C0/C1、default strict）**：

- 前置归属解析 `resolveCorrectionTarget(request, activeState, proposed_files?)`——任何编辑前解析 feature 归属，禁止"先编辑后归属"；diff 经 catalog 反查降级为收尾对账手段
- 在 C0 的 runtime-policy 模块增 correction resolvers（`resolveCorrectionTarget` / `classifyCorrection` / `resolveEnforcementTier`），扩展判定集合（同守纯函数与 default 等值不变式）；`classifyCorrection(request, featureState)` → `{root_layer, touched_layers[], revalidate[]}`
- 级联重验：落点层及下游已闭环 phase 的脚本门禁重跑（Phase 0 按 strict 全凭证；balanced 减免随 C5-full 接入 C2）
- 修正确认 gate（登记 confirmation-registry）：报 root_layer + touched_layers + 重验集 + 理由
- 最小持久化 `harness/state/.current-correction.json`（--correction-check 的稳定输入）
- `--correction-check` 自检命令 + `--adhoc-correction` no-feature 专用入口（不建假 feature 目录）
- 最小 enforcement 分档判定：hard_hook（claude）/ headless_runner（goal）/ soft_rule_only（cursor/generic）
- 验证转嫁禁令："请在真机上试一下"不得作为正常收尾，evidence 缺口须显式 halt-confirm

**C5-full（Phase 1，接入 C2）**：touched_layers 对账并入 evidence_policy_snapshot（只拦未声明层，组合修正放行但必须重验 coding 及下游）、hard_hook 深度集成、balanced 减免语义、feature.yaml 修正历史、全套坏态 fixtures。

## Impact

- Affected specs: correction-routing（新增）
- Affected code: `harness/scripts/utils/runtime-policy.ts`、`harness/harness-runner.ts`（--correction-check / --adhoc-correction）、`harness/state/.current-correction.json`（新 state）、`skills/reference/confirmation-registry.yaml`、`templates/AGENTS.md.template`（修正三问随 C1 落）、`agents/claude/templates/hooks/*`（C5-full）、`harness/scripts/goal-runner.ts`（halt-confirm 分类）
- 诚实边界：soft_rule_only 档（cursor/generic）无物理拦截——保证是"错了有更大概率被便宜拦住"而非"不会错"；该档脱缰率列入 A/B 观测

# Tasks: Correction Routing

## 1. C5-min（Phase 0）

- [x] `resolveCorrectionTarget`（编辑前归属；点名不存在→ask_user 禁止猜、无归属→no-feature 模式；`utils/correction-routing.ts`）
- [x] `classifyCorrection` → {root_layer, touched_layers[], revalidate[]}（三问短路序 + track 投影：lite 的 spec/plan→change、verification→exit；revalidate=根因 + 下游**已闭环** phase，closedPhases 注入保持纯函数）
- [x] `.current-correction.json` 持久化（`utils/correction-state.ts`：全字段 + touched_modules 回记；TTL 24h；过期/session 不符→stale 拒绝；落盘于 paths.state_file 兄弟位）
- [x] 修正确认 gate 登记 confirmation-registry（`correction.layer`，_cross_phase：1=同意按声明层实施 / 2=改层）+ check-skills-confirmation-ux 绿（随 C1 入口路由批落地）
- [x] `--correction-check` 自检命令（revalidate 逐项对照证据：feature phase 看 script-report.json verdict=PASS 且晚于修正起点，adhoc 看最新 correction-report.json；全绿→closed；缺 state/stale 拒绝并要求重建。另补 `--correction-init`：归属+三问分层+state 写入的确定性入口，答案须显式 y|n）
- [x] `--adhoc-correction` no-feature 入口（输入=含 base_commit 的 state；changed-files=git diff base_commit ∪ 工作区；检查=compile+lint provider+架构规则（变更源码范围 AstAnalyzer 层依赖/跨模块）+catalog 反查 touched modules（层内不可归属→BLOCKER，越界防护不豁免）；报告 reports/_adhoc/<ts>/{correction-report.md,json}；不建假 feature 目录）
- [x] `resolveEnforcementTier` 派生纯函数（归口 runtime-policy.ts；**mode 先行**：headless/goal 恒 headless_runner 即便 manifest 有 hooks；settings_file+hooks→hard_hook；否则 soft；不新增 schema 字段、不硬编码 adapter 名）
- [x] 验证转嫁禁令：touched 含验证层且宿主无 device_test.run → BLOCKER FAIL halt-confirm（"需要人工验证"清单 + manual_confirm 指引）；goal 侧新增 FailureKind `verification_evidence_gap`（与 await_human 同构、首触即 halt、不入 SIGNATURE_HALT_KINDS/no_progress），halt_reason=await_human_verification_evidence

## 2. C5-full（Phase 1，接入 C2）

- [ ] touched_layers 对账并入 evidence_policy_snapshot（只拦未声明层）
- [ ] hard_hook 深度集成（Stop hook 与 correction 状态联动）
- [ ] balanced 减免语义（verifier 可省 / 高置信免确认）
- [ ] feature.yaml 修正历史 append

## 3. Fixtures 与 Verify

- [ ] 坏态全套：分类错误 / 声明 spec 却改代码 / 组合修正漏重验 / 无归属直改 / soft 档 checklist 缺项 / correction 状态缺失或过期（单测已覆盖：state 缺失/过期/串会话拒绝、点名不存在 ask_user、组合修正 touched、级联清单；touched_layers 对账拦截属 C5-full）
- [x] `cd harness && npm test` 全绿（当批 1502，批次 2 双评审修复后终值 **1512 单测 + 40 fixtures**；correction-routing suite 12 case（含 session 信号/lite 闭环判据/发现面三枚回归钉）+ CLI 冒烟 init→check 拒绝路径）
- [ ] `npm run openspec:validate` + `npm run release:verify`

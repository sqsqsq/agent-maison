# Tasks: Correction Routing

## 1. C5-min（Phase 0）

- [ ] `resolveCorrectionTarget`（编辑前归属；不确定→确认或 no-feature 模式）
- [ ] `classifyCorrection` → {root_layer, touched_layers[], revalidate[]}（级联重验清单：落点层及下游已闭环 phase 脚本门禁）
- [ ] `.current-correction.json` 持久化（schema_version / feature? / root_layer / touched_layers / revalidate / status / created_at / session_id / base_commit / request_fingerprint / enforcement_tier / expires_at；session 不符或过期视 stale 拒绝）
- [ ] 修正确认 gate 登记 confirmation-registry + check-skills-confirmation-ux 绿
- [ ] `--correction-check` 自检命令（对照清单核查全绿 → closed；stale state 拒绝）
- [ ] `--adhoc-correction` no-feature 入口（输入=含 base_commit 的 state；changed-files=git diff base_commit ∪ 工作区；检查=compile+lint+架构规则+受保护前缀；报告 reports/_adhoc/<ts>/；testing evidence=device 即席或 manual_confirm；不建假 feature 目录）
- [ ] `resolveEnforcementTier` 派生纯函数（settings_file+hooks→hard_hook / mode=headless·goal→headless_runner / 否则 soft；不新增 schema 字段、不硬编码 adapter 名）
- [ ] 验证转嫁禁令：evidence 缺口 halt-confirm；goal-runner 专用 halt 分类（不计 no_progress）

## 2. C5-full（Phase 1，接入 C2）

- [ ] touched_layers 对账并入 evidence_policy_snapshot（只拦未声明层）
- [ ] hard_hook 深度集成（Stop hook 与 correction 状态联动）
- [ ] balanced 减免语义（verifier 可省 / 高置信免确认）
- [ ] feature.yaml 修正历史 append

## 3. Fixtures 与 Verify

- [ ] 坏态全套：分类错误 / 声明 spec 却改代码 / 组合修正漏重验 / 无归属直改 / soft 档 checklist 缺项 / correction 状态缺失或过期
- [ ] `cd harness && npm test` 全绿
- [ ] `npm run openspec:validate` + `npm run release:verify`

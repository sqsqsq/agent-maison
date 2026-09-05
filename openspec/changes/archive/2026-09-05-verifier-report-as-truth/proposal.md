# verifier-report-as-truth

## Why

宿主 bc-openCard-1 于 2026-09-04 起无人值守 goal run，两轮均以 `closure_wall_repeated` 熔断。链路上每一环都成功了：harness `verdict=PASS / blockers=[]`，verifier 子代理真的跑完并返回 `PASS / 0 BLOCKER`。闭环仍不可达，因为结论落地那一步被绑死在一种宿主机制上：

- `record-verifier-report.mjs` 检测到 `MAISON_GOAL_HEADLESS=1` 就一律落 bedside 旁路（注释写明「不入 goal closure」），canonical JSON 永不发布；
- `check-receipt` 只认 canonical JSON（`verifier-evidence.ts`「MD 不解析」）→ `verifier_evidence_report_missing` → `closure_open` → 两轮后熔断。

同一根病因还有第二个受害者。2026-08-29 之前，`check-receipt` 认回执里 `report_path` 存在 + `verdict=PASS`，codex 等无 SubagentStop hook 的 adapter 闭环正常；08-29 起只认 hook 发布的 canonical JSON，这些 adapter 被判 `blocked`，`full` track 事实不可用。verifier 的**调用**通道从来是 adapter 无关的（共享规则 `framework-agent-execution.mdc` §3 要求每个 adapter 用各自原生子代理执行，终态块契约写在全部 `harness/prompts/verify-*.md` 里随 ai-prompt.md 渲染，宿主实证 codex 每阶段都起 verifier 子代理）；被绑死的只有**发布**通道。

### 病根不是并发，也不是 headless，是手续比结果更有权威

hook 独占发布、四方对账、`conflict` 状态机、16 种 bedside 失败分类、结论指纹重算，全部服务于一个目标：主 agent 不能伪造 PASS。这是防篡改。而用户 2026-09-03 已裁定「防篡改永远不是高优先级；高优先级是平衡效率和准确性」。代价是这套 fail-closed 教条把「发布手续失败」判成「检查根本不存在」——真实完成的审查作废、agent 重复劳动、run 熔断。

真正影响正确性的只有三样，且都已经在场：

1. **审的是哪份材料** —— `subject_id`（feature / phase / prompt_path / 审前材料指纹 / gate fingerprint 派生，材料变则 subject 变，plan 07a41ec6 T7 已落地）；
2. **结论是什么** —— `verdict` + `blocker_count`；
3. **属于哪个阶段** —— 报告所在的 reports 目录。

其余是手续。规模：`record-verifier-report.mjs` 945 行、`verifier-evidence.ts` 451 行、两份对应单测 1601 行。

### 机制层还有一个验证盲区

能力模型对 `goal` 开了例外（`blocked` 判定仅 `interactive`），canonical 强制没有例外，两条规则交集为空，却没有一条 `goal × full × verifier=required` 的端到端闭环测试。这类回归只能靠宿主撞出来，这次就是。

## What Changes

**机器真源改为 `<reports>/verifier.report.<subject>.md`，单写者是调用方（Breaking）。** verifier 子代理行为不变：回复完整报告，末尾恰好一个终态块。调用它的 phase executor / 主 agent 把回复**原样**写到 `summary.verifier_report` 指向的路径，然后跑 check-receipt。不给 verifier 写权限，request 不加 `report_path`，没有兜底双写——「verifier 只回终态块 + 调用方兜底写返回全文」会产出一份只有终态块却能闭环的报告，repair candidates、WARN 与多模态正文全部丢失。

**校验收成三条**：文件在、终态块回显的 subject 等于 `summary.verifier_subject_id`、`verdict` 与 `blocker_count` 一致。任一不成立的唯一恢复动作是重跑 verifier 并重写 MD。loader 错误码由 10 种减到 4 种。

**整套删除**：SubagentStop hook 与两份 settings.json 的注册、canonical JSON、`result_sha256`、`state=conflict`、bedside 与 `last-verifier-report.*`、adapter 的 `verifier_capability × modes` 矩阵与入册纪律、verifier-plan 的 `blocked` 态、`verifier_provider_unavailable`、`resolve_verifier_provider_then_rerun`。

**报告哈希门删除**：evidence manifest 保护面不再登记 verifier 报告；closure attestation 删 `verifier_report_sha256`，只留 `verifier_subject_id`。否则「删掉结论指纹后不再检测修改」与「改一下 MD 就 stale」自相矛盾。闭环时采用的结论已经在 summary 里，报告闭环后是资料。

**adapter 只留一个布尔 `verifier_subagent`**，语义是「宿主实测过该工具能起 verifier 子代理」，与运行模式无关、与发布机制无关。claude / codeagent / codex 为 `true`；cursor / opencode / chrys / generic 缺省 `false`（opencode 的 adapter notes 明写 `.opencode/rules` 不被自动加载，chrys 的 rules 是「引用可达」，generic 是任意外部 CLI —— 共享文件被物化不等于运行时会读取）。`false` 时 plan 判 `disabled / adapter_has_no_reviewer`：不生成 request、不重跑，check-receipt 记 `not_reviewed` 并以 WARN 披露，闭环不阻断。

**发布链模式无关**：`goal` / `headless` / `interactive` 走同一条代码，`MAISON_GOAL_HEADLESS` 不再参与任何 verifier 判定。

## Impact

- **Affected specs**: `agent-adapters`（删三条 verifier 能力/hook requirement，加一条布尔声明）、`feature-artifact-layout`（MD 成为真源、summary 增 `verifier_report`）、`harness-gates`（plan 二态、删 provider 阶梯与 conflict 状态机、闭环按 subject 回显裁决、attestation 不记报告哈希）。
- **Affected code**: 删 `agents/claude/templates/hooks/record-verifier-report.mjs`；改 `harness/scripts/utils/verifier-evidence.ts`、`verifier-plan.ts`、`verifier-subject.ts`、`adapter-catalog.ts`、`phase-evidence-manifest.ts`、`closure-attestation.ts`、`goal-phase-snapshot.ts`、`harness-runner.ts`、`check-receipt.ts`、两份 `settings.json`、五份 `adapter.yaml`、`adapter-schema.yaml`。
- **Phases affected**: 全部跑 verifier 的 feature 阶段（spec / plan / coding / review / ut / testing）；goal closure 与 goal-runner 实现不变。
- **Breaking**: 是。宿主须重新物化 `.claude/settings.json`（`.cac` 同）与规则跳板，删除实例里的 `hooks/record-verifier-report.mjs`；旧 `verifier.report.<subject>.json` 不再被读取，已 closed 阶段不受影响，被 revalidate 时若无 MD 报告须重审一次。见 MIGRATION.md。
- **放弃的准确性**：报告可被伪造或事后修改而不被机器识别；同 subject 并发不再报 conflict；不再核对子代理身份。兜底靠下游阶段门禁与人；`subject` 仍挡住「旧 PASS 冒充当前结果」这一真实错误源。

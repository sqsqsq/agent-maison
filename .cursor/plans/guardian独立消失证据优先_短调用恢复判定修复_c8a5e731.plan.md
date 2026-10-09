---
name: guardian 独立消失证据优先 — 短调用恢复判定修复
version: 3.1.0
overview: >
  修复 8d4e6a21 清理后的集中验证发现的既有缺陷：短命 guardian 的身份读取失败后，taskkill 返回 128，
  但独立 PID existence 已证明 ABSENT，绑定函数仍因终止命令非零误判未消失并确定性阻断自动恢复。
  只复用既有独立消失证据，不增加机制或放宽收容保护；保持绑定失败本身的处理。
todos:
  - id: t1-fix-proven-gone-decision
    content: 保留终止尝试，仅由 awaitGuardianGone 决定 stillAlive；删除失去用途的 killed 变量，保持其它生产契约。
    status: completed
  - id: t2-target-validation
    content: typecheck、原真实子进程三 case，以及实际生产绑定路径的 terminate 失败且 ABSENT、PRESENT/查询失败反例。
    status: completed
  - id: t3-independent-review
    content: Astra 窄 review，仅核冻结修复与直接回归。
    status: completed
  - id: t4-final-validation
    content: 调度最终集中全量/候选验收；保留既往失败事实，未完成前不称完整发布验证通过。
    status: completed
---

# guardian 独立消失证据优先 — 短调用恢复判定修复

## 1. 场景、责任与收益

基础提交 `5f2eeca9ee32eaf773462c18f80d4420903790a3`。原 `8d4e6a21` 的 receipt 清理已通过独立 review；集中 candidate 验证为 unit 5303/2，两个 repair-interruption-real-process 正例在返修 coding 已恢复后遭后续短调用的收容停机。本修复独立登记，不称 receipt 清理回归，不重开其冻结设计。

原样定向 1/3、只读诊断 0/3 均已保留。诊断的三次失败（pid 39748、2236、10108）均为原 invoke exit 0、turn.completed；CIM 首次仅创建时间、无 exe/argv，随后为空；taskkill status 128；既有独立存在探针 status 0、精确 ABSENT。`goal-phase-runtime.ts` 的共享 `bindGuardianOrKill` 却计算 `stillAlive = !killed || !gone`，将已证明消失标为未消失。该函数及 transport/probe/guardian/原套件与旧完整通过切点 `770616c8` 完全相同。证据汇总为 `dist/8d4e6a21-validation/repair-guardian-diagnosis-5f2eeca9.json`，原始 trace 为同目录 `repair-guardian-diagnostic-5f2eeca9.jsonl`。

这是 AGENTS.md review 阻断类别④：现有可恢复调用被确定性错标为在野进程，自动恢复停止。收益是让已经有独立消失证明的绑定失败按既有失败调用路径处理，避免把恢复交回用户；不能凭 CIM 空值或 taskkill 成功自行推断死亡。

## 2. 最小修正与保留边界

共享 `bindGuardianOrKill` 仍调用 `terminateGuardianProcessOnly(pid)`，随后调用既有 `awaitGuardianGone(pid)`；`stillAlive` 只取 `!gone`，删除不再消费的终止返回局部变量。实际阶段与链外设计修复调用继续共用该函数，不新增 helper、状态、协议、registry 或字段。

绑定失败本身仍失败；CIM null 不作消失证明。PRESENT、UNKNOWN、查询失败/空输出/非零退出继续由原 existence 契约保守判存疑。阶段重试、budget、owner/fencing、身份核验与未证明消失的停机均不改；不加脚本 sleep、不改 HALTED 期望或放宽原断言。不操作宿主、不实施 H1。

现有 `openspec/specs/goal-runner/spec.md` 的 guardian 收容与接管契约已规定身份失败调用 fail-closed、已消失 guardian 的 Job 已关闭；`pidExists` 仅 status 0 且 ABSENT 判消失。本次修正现有契约执行的不一致，无新协议，不重写历史设计或另造 OpenSpec 行为规格。

## 3. 验收与收口

typecheck 与原 repair-interruption-real-process 三个真实子进程 case 必须全部通过，仍只证明脚本化执行者的 spawn/终止/终态解析，不称真实 Codex CLI 中断已验。利用既有注入缝在实际生产绑定路径覆盖终止失败且 ABSENT、仍 PRESENT、查询失败；复用 S16-r2 的不发布/不派质询/未证明消失停机保护，不复制布尔式测试，不扩矩阵。

目标验证后冻结 diff 交 Astra，仅核本修复与直接回归；最终全量/候选由调度按实际 diff 与门禁安排。保留 5303/2、原样 1/3、诊断 0/3 失败记录；原 `8d4e6a21` t7 in_progress、t6 pending。

## 4. 实施记录

2026-10-09：调度依据上述三次真实诊断授权 L3 最小修复与目标验证；未授权提交、打包或宿主操作。

- 实现只改共享绑定失败分支：保留 `terminateGuardianProcessOnly` 调用，删除 `killed` 局部变量，用 `!gone` 返回 stillAlive；两处注释同步为“复验仍活或查询失败”。阶段调用与链外调用同源，绑定失败的结果处理、身份校验、budget、owner/fencing 未改。
- 新测试复用 design-authority-repair 的 S16 生产驱动与既有进程/探针注入：ABSENT 先等真实子进程退出，再令终止命令返回失败，断言实际绑定路径按普通调用失败收口；query-failure 用真实仍活子进程、终止失败与 status 1/空输出探针，断言仍 `agent_containment_unresolved`。两支都保留不发布、不派质询、失败事件边界；未测试复写布尔式、未改原脚本或断言。
- `harness && npm run typecheck` PASS；原 `npm run test:unit -- --filter repair-interruption-real-process` 首次修后 3/3 PASS；`--filter agent-containment` 21/21 PASS（保留 PRESENT、非零 ABSENT、空/畸形输出、查询失败与真实活进程保护）。`DESIGN_AUTHORITY_REPAIR_ONLY='S16-r2' --filter design-authority-repair` 4/4 PASS，覆盖原仍活终止失败、原终止成功已消失及新增两支。
- 日志为 `dist/8d4e6a21-validation/repair-interruption-l3.log`、`agent-containment-l3.log`、`design-containment-l3.log`、`typecheck-l3-final.log`。此前 5303/2、1/3 与 0/3 的原记录完整保留；本次不声称原 candidate 全链已 PASS，未重复全量、打包、提交或操作宿主。
- 实现与目标验证完成，diff 自此冻结交 Astra 窄 review；t3 in_progress、t4 pending。原 `8d4e6a21` t7 in_progress、t6 pending。
- 2026-10-09 Astra L3 窄 review PASS：冻结修复已完成，无剩余修复项或直接回归；t3 completed、t4 in_progress，等待调度提交稳定切点后的最终集中候选验收。生产、测试与设计正文继续冻结，先前 5303/2、1/3、0/3 失败事实保留，本次仅同步评审与待办状态，不重复测试或声称原 candidate 成功。
- 2026-10-09 调度在 `ca860a77ec73bd479ba3ead44861ca066fb487c4` 完成最终 candidate:build，exit 0、实测 124.18 分钟：typecheck、unit --release 5307/0、fixtures 46/0、pack/release:verify 与同 ZIP consumer lifecycle smoke 全部 PASS；原真实子进程套件 3/0、设计修复 40/0。候选完整身份与证明见关联 `8d4e6a21` §7 及 `dist/8d4e6a21-validation/candidate-proof-ca860a77.json`；t4 completed，本 plan 全部待办完成。历史失败保留，未回灌/启动实际宿主、未 promote，关联 H1 仍 pending。本次仅文档收口，未重复测试。

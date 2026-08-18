---
name: goal 时长复盘三根因收口 — 修复目标交接与预算真源
version: 3.0.0
todos:
  - id: t1-requirement-handover
    content: successor 显式 requirement 增量交接（--requirement/--requirement-file 在 --supersede 生效并与源合并；inheritSuccessorManifest 尊重 fresh 显式输入；backtrack_target_absent 指引携带增量含证据摘要；不做跨 run 自动候选注入）。
    status: completed
  - id: t2-acg-parser
    content: AC-G* 解析器修复（p0-semantic-gates parsePlanTcEntries /AC-\d+/ 与 acceptance AC id 词法对齐）+ 全库同类正则盘点 + TC-024/026/027→AC-G1/G3/G4 夹具。
    status: completed
  - id: t3-auto-crop-priority
    content: 消除 auto_crop 指令冲突——显式 requirement 增量优先级高于 best_effort 逐项 fallback；被点名素材本轮必须执行或如实 FAIL；台账 carry-over 对显式点名项失效；不建 selected/waiver 系统。
    status: completed
  - id: t4-budget-lineage-fold
    content: 预算 lineage 真源统一——提取「收集祖先事件→拼 budgetFoldEvents→resolveResumedBudget」整条共享入口，runner/progress.json/heartbeat 共用；run_start/resume 打印 used/limit/remaining。
    status: completed
  - id: t5-budget-only-refresh
    content: budget-only rebase 确定性刷新——resolveManifestDriftDecision 全分支返回 changedFields，授权 rebase 时写入事件 changed_fields（单测断言 budget-only 得 ['budget']）；resume 起点 budget-only 时 review agent 启动前确定性刷新上游证据；场景夹具。
    status: completed
overview: >
  bc-openCard 08-16~17 实测复盘：34h 任务中 agent 活跃 10.5h（93%）——不是空等，是烧错地方。
  三根因=修复目标没传给 coding（跨 run successor 交接丢失）+ 选定 must-fix 被 best_effort/台账洗掉 +
  预算续跑弄脏上游证据且错误重试 review。实现收成五项：显式 requirement 增量交接、修 AC-G 解析器、
  消除 auto_crop 指令冲突、统一完整 lineage budget fold、budget-only 确定性刷新。
  不新增 repair_scope/豁免账本/新状态机。
---

# goal 时长复盘三根因收口:修复目标交接 / must-fix 优先级 / 预算真源(e9d4b7a3)

状态:**已实施并验收(2026-08-18)**(三轮 review 收口;t1 最终实现有 review 后订正,见文末实施记录)

## 背景(bc-openCard 08-16~17 实测,数字出自 events.jsonl/receipt 实证)

- 任务横跨 ~34h,run 实跑 11.3h,agent 活跃 10.5h(93%)——**不是空等,是烧错地方**。
- ~51 分钟重复 review(i27 被预算砍 + i28/i29 撞 stale 白烧 + i30 自摸修链),零产品代码改动。
- coding-i26 32 分钟:prompt(=manifest.requirement 原文,143 行)里**没有** TC-014 / 29 项 logo / AC-G 任何字样,agent 靠翻旧报告猜任务。
- 预算口径分裂:熔断按 supersede lineage 累计(599m/600m、30/30),progress.json/heartbeat 只显示当前 run(5/30)。宿主看不到余量 → 撞墙 → `--override-manifest` 提额改 manifest.json → coding 证据 stale → review 白烧两轮 → 再撞 turns 墙。

三根因:

```
修复目标没有传给 coding(跨 run successor 交接丢失)
        + 选定 must-fix 被 best_effort/needs_human 台账洗掉
        + 预算续跑弄脏上游证据 + 错误地重试 review
```

## 事实基线(二轮 review 纠正后,实施以此为准)

- **TC-014 未修,且尚未诊断清**。责任点是 `CardCategoryList.onCategoryTap`(WalletMain「添加卡片」页,AC-16),不是 SelectCardTypeSheet(其 showPlaceholderToast 属半模态占位交互,与 TC-014 无关——v1 plan 张冠李戴,已纠)。coding-076(must_review)裁定:代码路径与文案逐条核对无误,showToast 实现在 out_of_scope 的 CommUI/ToastUtil,**本轮不改码,交回 testing 比对 TC-014-step-7 UI dump,区分「环境无 Toast 捕获能力」vs「Toast 确未弹出」**。正确表述=「代码路径看似正确,真机 assert_toast 三轮未捕获,未诊断清」,不得写"已修待验证"。
- **AC-G1/G3/G4 不是测试计划缺口,是框架解析器 bug**。test-plan.md 已有 TC-024→AC-G1(:138)、TC-026→AC-G3(:140)、TC-027→AC-G4(:141);[p0-semantic-gates.ts:294](harness/scripts/utils/p0-semantic-gates.ts:294) 行内引用解析用 `/AC-\d+/gi`,吃不下 `AC-G*`,而 acceptance 侧 AC 全集认识 AC-G* → 不对称 → 恒报零覆盖。successor 若被要求"补用例"会重复补已存在的东西。
- **testing summary 的 repair_candidates(5 项视觉/locator 候选)与 blockers 都只是缺陷证据,不是授权范围**。用户本轮明确点名的是 logo;TC-014 属未诊断项;AC-G 属框架 bug。自动拼接候选=扩面,只读 blockers=修错。

## 修复 1(t1):successor 显式 requirement 增量交接

**机制定位(已核实)**:同 run 内 backtrack 的候选注入只活在内存与事件里;`backtrack_target_absent` → TERMINAL 后跨 run 手动 supersede 什么都不带。CLI 已有 `--requirement` / `--requirement-file`(goal-runner.ts ~3037,resume 显式拒绝、fresh 生效);但 [inheritSuccessorManifest(goal-manifest.ts:572)](harness/scripts/utils/goal-manifest.ts:572) `...inherited` 会**无条件用源 requirement 覆盖 fresh 显式输入**。

**改动面**:
- `--supersede` + 显式 `--requirement`/`--requirement-file` 时:宿主传入的「本轮修复增量」与源 requirement **合并**(源正文 + 增量段),成为 successor 的唯一任务真源;coding prompt 继续只读 requirement。落点=inheritSuccessorManifest 尊重 fresh 显式输入,不再无条件覆盖。
- **不做跨 run 自动候选注入**(三轮 review 裁定):现有注入通道只从当前 run events 的 `phase_backtrack_requested` 恢复候选,而 `backtrack_target_absent` 走 halt 分支不 emit 该事件、fresh successor 的 priorEvents 为空——接通它须新增跨 run 读取/复制与陈旧性规则,扩面。**任务与必要证据统一由显式 requirement 增量携带**(宿主从 repair_candidates/blockers 摘要出证据上下文写进增量文件);候选/blockers 保持缺陷证据身份,不进任何自动通道。
- `backtrack_target_absent` halt_guidance 升级:给出「起 successor 并用 --requirement-file 携带修复增量(含任务点名+关键证据摘要)」的完整指引(现状只说 halt 求人)。

**验收**:重放本次场景——宿主显式传入含 TC-014 诊断上下文、29 项 logo、AC-G 说明的增量文件后,successor coding prompt 逐字可见这些内容;不传增量则行为与现状一致(源 requirement 原样继承)。

## 修复 2(t2):AC-G 解析器修复

**改动面**:
- [p0-semantic-gates.ts:294](harness/scripts/utils/p0-semantic-gates.ts:294) 行内 AC 引用解析与 acceptance.yaml AC id 词法**对齐**(以 acceptance 侧全集为准做包含匹配,或放宽正则至 `AC-[A-Z]*\d+`——实施时以 acceptance 全集词法为 SSOT,不再手写第二份模式)。
- **全库同类正则盘点(审计性质)**:grep 全部 `AC-\d` 类模式的承载处(check-testing / 其他 gate / 测试断言)逐一定性,但**只修语义确属 acceptance ID 的承载点**——不动恰好形似的无关模式。

**验收**:bc-openCard 现有 test-plan.md 夹具重放,p0 门禁不再报 AC-G1/G3/G4 零覆盖;纯数字 AC 行为不变。

## 修复 3(t3):消除 auto_crop 指令冲突,显式点名素材必须执行

**事实链(已核实)**:没裁图历史根因=早期轮 `node`/`npx` 被 shell 权限拒绝(gap-notes §1.2),spec-005 起「占位+债务登记」被当作合规路径;i26 时全权限契约已部署但台账 carry-over(coding-075"维持 needs_human")让 agent 不重试;best_effort 下素材未物化仅 MAJOR·WARN 不挡 PASS。

**改动面**(不建 selected/waiver 系统,不全局改 auto_crop 语义):
- 优先级单点收紧:**显式 successor repair requirement > 通用 best_effort 逐项 fallback**。requirement 增量中被明确点名要求物化的素材,本轮必须实际执行裁剪,或如实 FAIL 并给出阻塞原因——**不存在「占位 + PASS」第三态**。
- 台账 carry-over 决策(coding-007/075 类"保守默认不处置")对 requirement 显式点名项**失效**,须本轮重评(否则"环境已修好但台账还说不行"永续)。
- 未被点名的素材维持现有 best_effort + auto_crop 逐项 fallback 契约不动。

**验收**:重放「requirement 增量点名 29 项 logo」场景——coding 轮要么真裁(asset-manifest placeholder 翻 false + media 落 PNG),要么 FAIL 说明阻塞;沿用旧台账 needs_human 直接 PASS 的路径不复存在。

## 修复 4(t4):预算 lineage 真源统一

**事实(已核实)**:lineage 口径=「budgetFoldSeeds 收集(--supersede ∪ events audited supersede)→ collectSupersededAncestorEvents → 拼 budgetFoldEvents → resolveResumedBudget」整条,在 [goal-runner.ts ~4074](harness/scripts/goal-runner.ts:4074) 内联;progress/heartbeat 用 `countAgentInvokeStarts(当前 run events)` → 5/30 假象。只复用 resolver 不够——喂当前 run events 结果不变。

**改动面**:
- 提取整条共享入口(收集祖先 → fold → resolve)为可复用函数,runner 熔断、progress.json、heartbeat 三处同源消费。
- run_start / resume 时打印 lineage 口径 `used / limit / remaining`(turns + wall 两维);预算不足在阶段启动前即可见,避免闭环后再改 manifest。

**验收**:重放 supersede 链场景,progress.json 显示 lineage 30/30(非当前 run 5/30);heartbeat 同源;run_start 输出余量行。

## 修复 5(t5):budget-only rebase 后确定性刷新,不烧 review

**事实(已核实,三轮 review 订正)**:`manifest_identity_rebase` 事件([写入点 goal-runner.ts:3920](harness/scripts/goal-runner.ts:3920))只带 `to_fields`(完整字段哈希表,**不是 diff**)+ `authorized_by`。[resolveManifestDriftDecision(goal-runner.ts:2183)](harness/scripts/goal-runner.ts:2183) 内部虽算了 `diffManifestIdentityFields`(:2205),但 **changedFields 只在未授权 halt 分支返回;授权 rebase 成功分支(:2232)将其丢弃**——v2 所称"emit 处已持有、纯透传"不成立。review FAIL 现走 per-phase 重试(max_retries_per_phase),upstream_verdict_gate stale 也照烧(i28/i29 实锤)。

**改动面**:
- `resolveManifestDriftDecision` **所有分支**返回 `changedFields`(顶层字段,授权/未授权/无漂移统一);授权 rebase 时 emit 处直接写入事件 `changed_fields`。单测断言:budget-only 场景得到 `['budget']`。
- resume 起点:changed_fields 仅含 budget(budget-only 授权 rebase)时,**任何 review agent 启动之前**对受影响上游阶段跑一次确定性 harness 刷新证据(不起 agent);禁止重演 i28/i29 式 review 重试。
- 单测 + 事故场景夹具:「599/600 撞墙 → 提预算 → resume」重放,0 个 review agent invoke 被 stale 烧掉。

## 裁掉不做(勿回潮)

- 不新增 repair_scope 字段 / selected-waiver 豁免账本 / 独立 budget-policy manifest / verifier 缓存 / monitor 重构 / 新状态机或证据类型 / re-sign 系统。
- 不因 verifier 慢而删 verifier;窄返修若仍过慢凭新证据另立案。
- 不调全局 phase timeout;不做预算 soft-landing / resume 冷却豁免 / 双维度联动提示 / 设备 WAITING watcher(非本次根因;预算盲区修复后半途砍杀自然大减)。
- 不把 auto_crop 全局改成「任何占位不得 PASS」(现有 best_effort 逐项 fallback 契约对未点名项保持不变)。

## 备忘(非本 plan 改动面)

- 锁屏 reveal 修复(08ea0ed7)已提交验收,宿主部署包待同步——凌晨锁屏秒死一晚停摆由它覆盖。
- TC-014 下一步属产品侧 testing 诊断(比对 TC-014-step-7 UI dump 区分环境能力 vs 真未弹),不进本 plan;若定位到框架 assert_toast 采集能力缺口,另立案。
- 时长口径备忘:"5.8 分钟无进程等待"仅覆盖末 run;全任务会话内 halt→介入→resume 合计 ~44m。

## 实施记录(2026-08-18)

- **t1–t5 全部完成**：显式 requirement 增量交接（含 backtrack_target_absent 三处可见指引）、AC-G* 解析器收编 acceptance 词法 SSOT、auto_crop 显式点名优先级（prompt 契约层）、budget lineage 唯一折叠入口（runner/progress/heartbeat 同源）、budget-only rebase 确定性刷新（原 attempt 身份复验 + 失败 review 前一次性 halt）。
- **三轮 review 已收口**：本 plan 代码面共经三轮 review——首轮 1 个阻断（backtrack_target_absent 指引仅 console 可见）、二轮 3 个 P1（t5 刷新伪造 attempt 撞 receipt identity / t1 --manifest 路径丢源 requirement / t4 两处口径分叉）、三轮 1 个 P1（manifest 自带 requirement 被误当增量），全部按意见修复并补回归测试，未新增任何 repair_scope/waiver/新状态机/re-sign 机制。
- **t1 最终实现为 review 后的实现订正**：显式增量合并点从 `inheritSuccessorManifest` 内移出，改为 runner 在 CLI override 全部完成后以解析出的显式 CLI 文本（`explicitRequirementIncrementText`）一次性合并——增量判定与 manifest 字段状态完全解耦，`--manifest` 自带文本不再可能被误判为增量。
- **最终验证**：typecheck 通过；`npm test` 全量 unit 3308/0、fixtures 44/0；`git diff --check` 通过；`node scripts/check-plan-version.mjs` PASS。

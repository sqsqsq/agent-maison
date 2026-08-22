# adjudicated-repair-loop — 信号级候选裁决与累计收敛

> 实施蓝本：plan e2b7c4a9 v6（`.cursor/plans/修复环裁决化_候选真伪裁决与收敛不变式与增量修复环_e2b7c4a9.plan.md`，待终审）。归因经本侧 events/源码走查 + codex 只读复盘双路交叉验证；五轮 review（v1 八阻断、v2 三必修、v3 两 P1、v4 一 P1 接线、v5 一 P1 时序）已全部吸收。本 change 核心收敛为 **M1 + M2 两支柱**（最小机制：零新账本、零新事件类型、零新 receipt 体系、无第二套检测算法）。

## Why

宿主真实回归（SimulatedWalletForHmos bc-openCard-1，run `20260819T155559Z-60bcd1`，2026-08-20）：「修 TC-018 + 3 屏视觉差异」的小修复需求活跃执行 584 分钟被 `budget_wall_clock` 熔断（584/585m）。三个结构性根因咬合成死循环：

1. **候选无真伪裁决，机械信号直通回退。** OCR 把「中信银行」误识为「中国银行」（编辑距离 1）+ 整页拼接参考图（1320×4350）与单视口截图（1320×2120）纵序比较错配，产出「排序颠倒」假信号。testing agent 在候选 `summary` 里写明完整反证与「修正层是采集编排非 coding」，但 `actionableDefectsToCandidates` 恒 `category:'coding'`（repair-candidates.ts:599），assess 候选分支只读 `category`（assess.ts:768-802）。对照 review 侧候选须过信任合取（verifier 逐条 confirmed）才有回退效力——testing 侧零验真直通，**不对称即漏洞**。
2. **候选按「屏」聚合，身份随缺陷集合漂移，五族收敛机制全部脱靶。** visual 候选指纹是一个屏全部 defects 的 `computeDefectFingerprint` 拼接集合（goal-runner.ts:1875 `structural.sort().join('&')`）——i12 与 i16 的 expanded 屏缺陷集合不同、build 也变，屏级身份必然漂移，「同一缺陷复发」不可检测；而**单条稳定指纹已存在**（visual-diff-check.ts:652，含 `producer#finding_id` 尾段）、**must_fix↔defect 关联也已存在**（`must_fix_refs`，门禁强制引用），均未被候选层使用。`seenRoundFingerprints` 要求整轮集合逐字全等（i12 三条→i16 一条被判「有进展」放行）；`repeated_round` 声明了 assess 零消费。第一次回退（collapsed 真缺陷，修复有效）与第二次回退（纯伪缺陷，coding 零改动）系统不可区分。
3. **回退全量级联且无 no-op 检测。** 第三轮 coding-i17 自证「产品源码零改动」后 review-i18 仍全量重启直至熔断；宿主 worktree 自始 dirty，git diff 判据不可用，而 invocation 前后文件哈希快照已存在（product-source-snapshot.ts:16）。review 走私改码的授权依据是 **retry 提示模板自带「apply a minimal fix and re-run this phase harness」**（review/headless-assumptions.jsonl 实录）——走私有模板助攻。

三次事故构成钟摆：2026-07-24「无环」→ 2026-08-16「欠回退」→ 2026-08-20「过回退死循环」。摆动根因：**候选真伪裁决、稳定的信号级身份、回退循环的收敛保证**三件缺失。

## What Changes

- **M1 · 信号级身份 + 累计 one-shot 收敛 + no-op 短路（零新机制）。** `collectActionableDefects` 改每信号一条候选，identity = `sha256(computeDefectFingerprint(screen, defect))`（既有函数直用），文本 must_fix 经既有 `must_fix_refs` 反向解析——**不新增平行 identity 或关联结构**；`RepairCandidate` 增 `identity_schema: 'signal@1'`（legacy 无字段仅诊断）。收敛为**累计 one-shot**：候选身份从 `phase_backtrack_requested.candidates[]` 取，但**仅当同一回退窗口之后出现目标 phase 的 `agent_process_settled` 或 `phase_verdict`，该批身份才计入 `attempted`**——request 后崩溃的候选不算已修，既有 crash/resume 契约（request-only 候选必须恢复执行）原样保留；`eligible = current_open − attempted`；非空只回退 eligible，为空停 `repair_not_converging`（operator/WAITING-human）——累计集防 A/C 交替重获资格。术语澄清：`identity` 只是概念名，唯一存储字段仍是 `item_fingerprint`；累计与 no-op 仅作用于 `identity_schema='signal@1'` 候选，不触碰既有 check-domain candidates。整轮全等指纹保留为兜底；`repeated_round` 接入 assess。事件保持既有三件（requested/started/completed）：目标 phase 执行与否复用 `agent_process_settled`/`phase_verdict`；把 :7592 提前发出的 `completed` 移到真正完成后并三路径补齐；no-op 记 `phase_backtrack_completed.result='noop'`，**零新事件类型、零新状态机**。no-op 判据 = `product-source-snapshot` pre/post 相等（pre-existing dirty 合法）→ 不重跑下游 + 候选并入 attempted → 停等；unverifiable → fail-closed 全量。
- **M2 · producer 根治（主体）+ 最小两态裁决 + 恢复复用既有通道。** producer 一处实现全部机械判定：OCR 识别文本与候选串编辑距离 ≤1 → **uncertain** 不产 FAIL 级信号（**冲突只证明两源不一致，不证明 OCR 错**——不自动判谁对）；整页参考图 vs 单视口的纵序比较降级 uncertain。裁决发生在**候选物化之前**（goal-runner 收集侧 :6503→:6556；harness-runner:1585 只管 check 域，无第二真源），`repair_candidates[]` 维持现行「只承载 trusted actionable defects」契约：`producer 产 actionable/uncertain → 信号级 identity → 解析 agent defect-review 块 → 物化裁决`。**两个出口**：actionable + agent 复核同向 → 物化为常规候选可回退（v23 F1 保留，可信 = harness 合成的同向裁决）；**actionable 被反对、未复核、或 producer uncertain → merge 前直接停** `repair_adjudication_pending`，不写入 candidates，producer 证据与反对理由原样呈给人——WARN 注记不能替代停等（harness 只把 FAIL 级纳入 violations，WARN 不保证停）。**无自动 refuted、裁决层不重复实现检测算法、无 adjudication schema**（`summary.json` 唯一 schema 增项 = 可选 `identity_schema` 字段；payload 的 `uncertain_signals[]` 是结构化载体形状的可选扩展——均非 breaking、无迁移）。**uncertain 生产链路与判停时序冻结**：载体 = 既有 producer-owned `VisualDiffStructuredPayload` 新增可选 `uncertain_signals[]`（item_fingerprint + 原因 + 证据引用），经既有 `checks[].structured` 随 `script-report.json` 落盘（report-generator:134/:147，无需新文件或新 IPC）；goal-runner 读 fresh summary + script-report 时即读取形成 pending 标志，**禁止 receipt validation 与 finalizePhaseClosure，保留既有 visual_round 事件投影与完整性处理，再 halt `repair_adjudication_pending`**——判停早于 PASS closure 而不只早于 merge，杜绝「唯一 uncertain 其余全 PASS 先关环再停等」的成功态并存；不回写 visual-diff.json、零新状态/事件/产物，配真实载体生产接线测试（含 uncertain-only 不得完成 closure、visual_round 投影不丢两断言）。人工恢复单一真源=既有 visual-confirm 人签通道（visual-diff.json 屏条目 `confirmed_by` 真人人签，isHumanVerified 谓词）；收敛 halt 后人工 `--resume` 本身即一次显式放行（attempted 重新计入后须再次人工动作），**不引入 manual driver / confirmation-receipt 作为本 change 恢复输入、不新增 receipt 体系**；halt guidance 写明通道入口与 resume 命令。retry 提示模板删除「apply a minimal fix」类代改诱导。

**保留不动的既有契约**：goal-runner 禁直调 `classifyPhaseVerdict`；`phase_verdict` 只由 boundary 发；halt_reason 必须注册；supervisor 只读 `run_disposition`；IncidentFacts 不产授权；「宁缺毋滥」；「PASS + 可信候选仍回退」（v23 F1，"可信"收紧为 harness adjudication）。

**修订的单测契约**：item_fingerprint 断言改 `sha256(computeDefectFingerprint)` + identity_schema；整轮全等降为兜底、累计 one-shot 为主判据；v23 F1 陈述改「PASS + harness-adjudicated-confirmed 仍回退」。

## Impact

- Affected phases：testing（信号级候选 + defect-review 复核契约 + producer uncertain 归类）、review（retry 模板去诱导）、coding（no-op 快照判定）。specs delta：`specs/goal-runner/spec.md`（两条 ADDED；strict validate 过门）。
- `profiles/hmos-app/harness/visual-diff-check.ts` — producer 根治（OCR 编辑距离混淆归 uncertain、整页/单视口纵序降级）；候选层经 `must_fix_refs` 反向解析
- `harness/scripts/goal-runner.ts` — `collectActionableDefects` 信号级拆分；累计 attempted 回放与 eligible 过滤；no-op 快照判定；`completed` 时序修正与 `result` 字段；裁决管道（复核块解析 + 两态合成）插入收集侧
- `harness/scripts/utils/repair-candidates.ts` — `identity_schema` 字段与形状校验（`summary.json` 唯一 schema 增项；无 adjudication 块类型）
- `profiles/hmos-app/harness/visual-diff-check.ts` — `VisualDiffStructuredPayload` 新增可选 `uncertain_signals[]`（item_fingerprint + 原因 + 证据引用；经 `checks[].structured` 随 script-report.json 既有落盘，不回写 visual-diff.json）
- `harness/scripts/utils/assess.ts` — 仅 confirmed 进映射；`repeated_round` 消费；eligible 空 → `stop/fused/repair_not_converging`
- `harness/scripts/utils/adjudication.ts` — 注册 `repair_not_converging`、`repair_adjudication_pending`（operator/WAITING-human，恢复=既有人工通道）
- retry 提示模板（review FAIL 路径）— 删除代改诱导
- Schema：`summary.json` 唯一增项 = 可选 `identity_schema` 字段；payload 侧 `uncertain_signals[]` 为结构化载体形状的可选扩展——均向后兼容、非 breaking、无 MIGRATION 面；旧 run 无字段候选按 legacy 仅诊断、不入收敛判定
- 与 `unified-responsible-phase-routing`（在飞）：不推翻；其 delta 的 `item_fingerprint` 定义由本 change 细化为信号级，归档合并以本 change 为准
- **明确不在本 change（另立）**：**M4 closure/预算小 change**（receipt runner-owned 字段机械化——设计输入 = upstream-closure.ts:68 与 spec:527 的 owner 分类预填 + re-probe；`closure_wall_repeated` 恢复；预算派生值显式化）、**M3 增量修复环**（pre/post 双 scope、部分 fresh 合成语义、设备证据复用 reused_from 血缘 + fresh-directory 契约 delta）、fidelity 三门禁 SSOT 互斥、`--skip-assert-expected` 硬编码、hylyre 采集编排效率、spec 需求溯源纪律

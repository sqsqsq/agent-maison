# tasks — adjudicated-repair-loop（v6）

> 对齐 plan e2b7c4a9 v6 todos（t1/t2/t3）。范围 = M1 + M2；M4（closure/预算）与 M3（增量修复环）另立 change。验证节奏：窄返修=目标测试；里程碑收口=typecheck + `cd harness && npm test` + `openspec validate --strict`；**`release:verify` 只留正式发版门禁**。

## M1 · 信号级身份 + 累计 one-shot 收敛 + no-op（plan t1）

- [x] 1.1 `goal-runner.ts` `collectActionableDefects`：每信号一条候选，identity=`sha256(computeDefectFingerprint(screen, defect))`；纯文本 must_fix 经既有 `must_fix_refs` 反向解析
- [x] 1.2 `repair-candidates.ts`：`identity_schema: 'signal@1'` 字段 + 形状校验；legacy（无字段）仅诊断不入收敛判定
- [x] 1.3 `goal-runner.ts`：`attempted` 从既有 events 回放累计——候选身份取自 `phase_backtrack_requested.candidates[]`，**仅当同一回退窗口后出现目标 phase 的 `agent_process_settled`/`phase_verdict` 才计入**（request-only 崩溃候选仍 eligible，既有 crash/resume 契约不破）；`eligible = current_open − attempted`（仅 `identity_schema='signal@1'`）；非空只回退 eligible（注入过滤），为空 → 停;`repeated_round` 填入 reconcile observation
- [x] 1.4 `assess.ts`：消费 eligible 过滤与 `repeated_round`；eligible 空 → `stop/fused/repair_not_converging`
- [x] 1.5 `goal-runner.ts`：no-op 短路——目标 phase settled 后 `product-source-snapshot` pre/post 比对；相等 → 不重跑下游 + 候选并入 attempted → 停等，`phase_backtrack_completed.result='noop'`；unverifiable → fail-closed 全量
- [x] 1.6 `goal-runner.ts`：`phase_backtrack_completed` 移到回退链真正完成之后（修 :7592 时序），repair/scope 路径补齐;无新事件类型/状态机（目标 phase 执行与否复用 `agent_process_settled`/`phase_verdict`）
- [x] 1.7 `adjudication.ts`：注册 `repair_not_converging`（operator/WAITING-human，guidance 指向既有人工通道）
- [x] 1.8 单测：60bcd1 events 反演（i16 eligible 空停；i17 noop）；A/C 交替不重获资格；crash 两场景（request 后目标 phase 未执行 → 仍 eligible、resume 收到候选；settled 后崩溃 → 已 attempted 不再自动修）；修订 item_fingerprint/整轮全等断言
- [x] 1.9 收口：typecheck + harness 全量测试 + strict validate

## M2 · producer 根治 + 两态裁决（plan t2，依赖 M1）

- [x] 2.1 `visual-diff-check.ts` producer 根治：OCR 编辑距离 ≤1 → uncertain 不产 FAIL 级信号（冲突≠可判错）；整页参考图 vs 单视口纵序比较降级 uncertain 注明口径缺口；**`VisualDiffStructuredPayload` 新增可选 `uncertain_signals[]`**（item_fingerprint + 原因 + 证据引用；不回写 visual-diff.json）
- [x] 2.2 testing 报告 fenced `defect-review` 块契约（skill/模板双侧；逐信号 confirmed/disputed + 理由）
- [x] 2.3 `goal-runner.ts` 判停时序与物化裁决：**读 fresh summary + script-report 时即读取 `checks[].structured.uncertain_signals[]` 形成 pending 标志 → 禁止 receipt validation / finalizePhaseClosure（:6319/:6335 不得执行）→ 保留既有 visual_round 事件投影（:6393）与完整性处理 → halt `repair_adjudication_pending`，不进入普通 verdict/candidate merge**；复核块解析 → actionable+同向才物化为常规候选（signal@1）→ merge；**disputed/unreviewed/uncertain → 停等**，不写入 candidates（trusted-actionable 契约不变，无 adjudication schema、无 MIGRATION 面；无自动 refuted、无裁决层检测算法）
- [x] 2.4 `adjudication.ts`：注册 `repair_adjudication_pending`（operator/WAITING-human）；guidance 写明既有 visual-confirm 人签通道入口与 resume 命令
- [x] 2.5 retry 提示模板（review FAIL 路径）删除「apply a minimal fix」类代改诱导
- [x] 2.6 单测：OCR 混淆源头停等；**唯一 uncertain 其余全 PASS 仍停等且不得调用/完成 closure finalization**；**uncertain 生产接线测试（走真实载体：check 产 `uncertain_signals[]` → script-report → runner 停等）**；**存在 visual_round 回执时既有事件投影不因提前停等丢失**；agent 反对 → 停等原样呈理由；无复核块 → 停等；confirmed 才物化；既有通道恢复链路；v23 F1 修订版
- [x] 2.7 收口：typecheck + harness 全量测试 + strict validate

## 收口（plan t3）

- [x] 3.1 60bcd1 全链反演回归汇总 case（两道防线分列：producer uncertain 停等 / 裁决层 disputed 停等；collapsed 同向 confirmed 物化回退一次）——覆盖见 goal-runner-testing-integrity M2-1（uncertain 停等）/ M2-3（disputed 停等）/ M2-5（confirmed 物化回退）+ R-8（no-op i17 反演）+ c7e4a2d9-①/⑥（混合候选）；纯函数层见 goal-runner-repair-convergence t3 契约 case
- [x] 3.2 既有契约不回归断言（禁直调 classifier / boundary 独占 phase_verdict / 注册表全覆盖 / supervisor 只读 disposition）——既有 goal-assess-driver / goal-reconcile-boundary 静态门禁 + 本 change 新增 t3 契约 case（signal 范围收窄 / no-op eligible 空 / legacy 混合放行）
- [x] 3.3 最终收口：typecheck + `cd harness && npm test` + `openspec validate --strict`（`release:verify` 留发版）

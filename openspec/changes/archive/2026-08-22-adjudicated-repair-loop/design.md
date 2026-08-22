# design — adjudicated-repair-loop（v6）

> 事实基线：run `20260819T155559Z-60bcd1` 逐事件归因 + Br_release_3.0.0 源码走查；五轮 review 吸收记录见 plan e2b7c4a9 v6（「v1→v2」…「v5→v6 的裁决变化」）。行号为走查时点，实施以标识符为准。本 change 范围 = **M1 + M2**；M4（closure/预算）与 M3（增量修复环）另立。

## 1. 现状控制面（As-Is）

```
agent 干活 ──► harness 打分 ──► summary.json（verdict / checks / repair_candidates）
                                      │
   check 域候选：harness-runner:1585 buildSummaryRepairCandidates（review/plan/ut/coding）
   visual 域候选：goal-runner:6503 collectActionableDefects → :6556 merge（harness 返回后）
                                      ▼
        assess.ts  候选分支(:768) 只读 category → 映射最上游 → backtrack_to_phase
                                      ▼
        goal-runner：outcomes 过滤 + 指针回拨 + 全量重走
```

关键既有事实：

| 事实 | 位置 |
|---|---|
| visual 候选身份 = 屏级 defects 集合拼接 hash（集合/build 变即漂移） | goal-runner.ts:1875 `structural.sort().join('&')` |
| 单条稳定指纹已存在：`screen\|class\|element\|bbox_bucket[\|producer#finding_id]` | visual-diff-check.ts:652 `computeDefectFingerprint` |
| must_fix↔defect 关联已存在且门禁强制引用 | visual-diff-check.ts:113 `must_fix_refs`；visual-fidelity.unit:3619 |
| invocation 前后产品面快照（pre-existing dirty 合法，不与 HEAD 比） | product-source-snapshot.ts:16 |
| `phase_backtrack_completed` 在目标 phase 执行前发出（仅漂移路径发） | goal-runner.ts:7592 |
| review FAIL retry 提示自带「apply a minimal fix and re-run this phase harness」 | 宿主 review/headless-assumptions.jsonl 实录 |
| `repeated_round{fingerprint,count}` 声明了、assess 零消费 | assess.ts:83-86 |

## 2. 故障机理（i16 轮逐层放行）

1. producer：OCR 误识（编辑距离 1）+ 整页参考图 vs 单视口 → FAIL 级信号，无不确定性归类。
2. 候选层：屏级聚合 → 一条 `category:'coding'` 候选；agent 反证进 summary 字段后无人消费。
3. 身份层：i12/i16 同屏候选指纹不同（集合与 build 都变）→ 复发不可见，整轮全等兜底不触发。
4. assess/driver：category 机械映射 → 第二次全量级联。
5. 第三轮 coding 零改动（快照机制在场无人比对）→ review 仍全量重启 → 熔断。

M2 补 1-2 层，M1 补 3-5 层。

## 3. M1 · 信号级身份 + 累计 one-shot 收敛 + no-op（零新机制）

### 3.1 信号级候选（全部复用既有真源）

- `collectActionableDefects` 每信号一条：identity = `sha256(computeDefectFingerprint(screen, defect))`；纯文本 must_fix 经既有 `must_fix_refs` 反向解析到 defect（refs 缺失场景由既有 BLOCKER 门禁兜底）。
- `RepairCandidate.identity_schema = 'signal@1'`；无字段 = legacy，仅诊断、不入收敛判定（新旧同为 64hex 不可凭内容区分）。
- **不新增**平行 identity、关联结构、账本文件。

### 3.2 累计 one-shot 收敛（冻结公式）

```
候选身份：从 phase_backtrack_requested.candidates[] 取（唯一存储字段仍是 item_fingerprint）
attempted：requested 批次仅当同一回退窗口后出现目标 phase 的
           agent_process_settled 或 phase_verdict 才计入（既有事件，零新状态机）
eligible  = current_open − attempted

eligible 非空 → 只回退 eligible（注入候选按 eligible 过滤）
eligible 为空 → 停 repair_not_converging（operator / WAITING-human）
```

**request ≠ attempted**（v4 修正）：request 后、目标 phase 执行前崩溃的候选不算已修——既有 crash/resume 契约（request-only 候选必须恢复执行，repair-candidates.unit:692）原样保留；目标 phase settled 后崩溃则已计入 attempted，resume 不得再自动修。累计集防 A/C 交替：A 的已执行修复失败后无论隔几轮、由谁触发回退，A 永不重获自动资格。累计与 no-op 仅作用于 `identity_schema='signal@1'` 候选，不触碰 check-domain candidates。guidance 列每条 attempted∩open 身份的跨轮证据 + 既有人工通道入口。整轮全等指纹熔断保留为兜底；`repeated_round` 由 runner 填入 reconcile observation，assess 消费入 stop 理由。

### 3.3 no-op 短路

目标 phase agent settled 后比对 `product-source-snapshot` pre/post。相等 → 不重跑下游 + 本次回退候选并入 attempted → 走 3.2 停等；`phase_backtrack_completed` 记 `result: 'noop'`。零改动只证明修复无效、不证明候选已解决，不复用下游 closure 继续。快照 unverifiable → fail-closed 回落现行全量。

### 3.4 事件语义（无新状态机）

既有三事件不变；目标 phase 执行与否复用 `agent_process_settled`/`phase_verdict`；:7592 的 `completed` 移到回退链真正完成之后，repair/scope 路径补齐；no-op 走 `result` 字段。crash/resume 由既有事件回放语义覆盖。

## 4. M2 · producer 根治 + 最小两态裁决

### 4.1 producer 根治（主体防线，检测算法唯一实现处）

- OCR 识别文本与候选串集合编辑距离 ≤1 → **uncertain**，不产 FAIL 级 text_placement 信号。原则：**冲突只证明两源不一致，不证明哪一源错**——不自动裁定，归 uncertain 交人。
- 参考图高度 > 视口高度的纵序二部匹配 → 自动降级 uncertain 并注明口径缺口。
- uncertain 不物化候选，但**走 §4.2 的停等路径**——WARN 注记不能替代停等（harness-runner:847 只把 FAIL 级纳入 violations，WARN 不保证停）。
- **uncertain 生产链路与判停时序（冻结）**：载体 = 既有 producer-owned `VisualDiffStructuredPayload`（visual-diff-check.ts:791）新增可选 `uncertain_signals[]`，逐条携带 `item_fingerprint` + 原因 + 证据引用；落盘 = 既有 `checks[].structured` 随 `script-report.json`（report-generator.ts:134/:147——无需新文件或新 IPC）。判停时序（必须早于 PASS closure，不只早于 merge——现有控制流 :6307 读 summary → :6319/:6335 PASS closure → :6393 visual_round 投影 → :6503 收集，仅冻结 merge 前会产生「先关环再停等」的成功态并存）：

  ```
  fresh summary + 本轮 script-report
    → 读取 checks[].structured.uncertain_signals[]，形成局部 pending 标志
    → 禁止 receipt validation / finalizePhaseClosure
    → 仍完成既有 visual_round 事件投影与完整性处理
    → halt repair_adjudication_pending（不进入普通 verdict / candidate merge）
  ```

  **不回写 visual-diff.json、零新状态/事件/产物**；生产接线测试三断言：走真实载体（check 产 payload → script-report → runner 停等）；uncertain-only 时不得调用/完成 closure finalization；存在 visual_round 回执时既有事件投影不因提前停等丢失。

### 4.2 物化前裁决（goal-runner 收集侧，两个出口）

```
producer 产 actionable / uncertain
  → 信号级 identity（§3.1）
  → 解析 testing 报告 fenced defect-review 块（逐信号 confirmed/disputed + 理由）
  → 物化裁决：
      actionable + agent 同向  → 物化为常规 RepairCandidate（signal@1）→ merge（:6556 既有）
      disputed / unreviewed / uncertain → merge 前直接停，不写入 candidates
```

- **物化** = mechanical actionable + agent 复核同向，才写入 `repair_candidates[]`——维持现行「只承载 trusted actionable defects」契约（unified delta:5）。v23 F1 保留：PASS + 物化候选仍回退；"可信" = harness 合成的同向裁决，agent 自报不生效。
- **停等** = actionable 被 agent 反对、actionable 未复核、或 producer uncertain → merge 前停 `repair_adjudication_pending`（operator/WAITING-human），producer 证据与反对理由**原样呈给人**。needs_human 对象不进 candidates，**无 adjudication schema、无 MIGRATION 面**（证据在 producer 产物与 defect-review 块里；本 change 的 `summary.json` 唯一 schema 增项 = 可选 `identity_schema`）。**无自动 refuted**；裁决层不实现任何检测算法。fail-closed：不写复核块无得利路径。
- harness-runner:1585 只管 check 域；visual 域全在收集侧——无第二真源。

### 4.3 人工恢复（复用既有通道，零新体系）

`repair_not_converging` / `repair_adjudication_pending` 的恢复输入：**单一真源 = 既有 visual-confirm 人签通道**（visual-diff.json 屏条目 `confirmed_by` 真人人签，isHumanVerified 谓词——人签=人工确认该屏无需修复）；**收敛 halt 后人工 `--resume` 本身即一次显式放行**（attempted 重新计入后须再次人工动作，不自动循环）。不引入 manual driver / confirmation-receipt 作为本 change 恢复输入、不新增 receipt 体系。halt guidance 写明通道入口与 resume 命令——WAITING 可接受未来输入。retry 提示模板（review FAIL 路径）删除「apply a minimal fix」类代改诱导。

## 5. 移出说明（另立 change，本 change 不实施）

- **M4 closure/预算小 change**（三项，与候选裁决无数据依赖）：①receipt runner-owned 字段机械化——设计输入 = `tryCloseUpstreamPhase` 只 finalize 已 passed（upstream-closure.ts:68）与 spec:527 的 `missing/failed → receipt_repair_with_verifier` 规范，方向 = owner 分类预填 + re-probe；②`closure_wall_repeated` 从 TERMINAL 恢复为可续（60bcd1 实证误判 3.5h）；③预算派生值显式化（schema:51 派生下限契约不改，只显式）。
- **M3 增量修复环**：pre-repair advisory scope 与 post-repair validation scope 双公式、「部分 fresh + 部分重验」合成唯一 PASS 的语义（phase-evidence-manifest:568 现为 phase 级整段传播）、设备证据复用的 `reused_from` 血缘与 fresh-directory 契约 delta（collector 强制当前 run/attempt/安装/trace/时间窗，goal-runner:1742）。

## 6. 迁移路径

| 里程碑 | 内容 | 依赖 | 验证 |
|---|---|---|---|
| **M1**（plan t1） | 信号级身份 + identity_schema + 累计 one-shot（attempted 须目标 phase settled/phase_verdict）+ no-op 快照短路 + completed 时序修正 + `repair_not_converging` 注册 | 无 | 60bcd1 events 反演（i16 eligible 空停；i17 noop）；A/C 交替 case；crash 两场景（request 后未执行仍 eligible / settled 后已 attempted）；既有 backtrack 单测全绿 |
| **M2**（plan t2） | producer uncertain 归类 + defect-review 契约 + 物化前裁决 + `repair_adjudication_pending` + retry 模板去诱导 | M1 身份 | OCR 混淆源头停等；唯一 uncertain 其余全 PASS 仍停等；agent 反对/未复核 → 停等；confirmed 才物化；既有通道恢复链路 |
| **收口**（plan t3） | 60bcd1 全链反演回归 + 契约不回归断言 + 单测契约修订 | 全部 | typecheck + `cd harness && npm test` + `openspec validate --strict`；`release:verify` 仅发版门禁 |

## 7. 兼容与风险

- **既有契约保留**：禁直调 `classifyPhaseVerdict`；`phase_verdict` 仅 boundary 发；halt_reason 注册表；supervisor 只读 `run_disposition`；IncidentFacts 不产授权；「宁缺毋滥」。
- **修订单测契约**：item_fingerprint = `sha256(computeDefectFingerprint)` + identity_schema；整轮全等降为兜底；v23 F1 改「PASS + harness-adjudicated-confirmed 仍回退」。
- **与 unified-responsible-phase-routing**：不推翻；其 delta 的 `item_fingerprint` 定义由本 change 细化为信号级，归档合并以本 change 为准；needs_human 裁决修正其「真机缺陷恒属 coding」的机械假设。
- **旧 run resume**：legacy 候选（无 identity_schema）仅诊断、不入收敛判定；物化前停等语义仅对新 run 的 visual 信号生效，旧 run 走原语义。
- **误杀风险**：无自动 refuted——凡冲突皆归 uncertain（producer）或 needs_human（裁决），人是唯一否决者；uncertain/dispute 均保留可见性。
- **风格约束**：新 incident 进注册表 + 单测锁契约；不新增第二张分类表、第二套检测算法、新 receipt 体系。

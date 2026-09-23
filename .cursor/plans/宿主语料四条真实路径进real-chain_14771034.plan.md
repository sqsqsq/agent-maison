---
name: 宿主语料四条真实路径进 real-chain
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g6-change-unit-feature-pipeline-integration
  - g8-real-host-development-and-governance
relation: verification-provider
layer: change-unit
goal_requires:
  - pre-release-real-chain-regression
  - attended-self-check-single-writer
goal_provides:
  - host-corpus-real-chain-paths
real_host_validation: >
  本 plan 不做、也不替代宿主验收。它把 bc-openCard-2/open-card-flow-v2 三天里真实撞过、而
  real-chain / real-chain-seams 从未走过的四条生产路径，用裁剪脱敏后的最小宿主语料放进确定性链：
  报告、回执、事件、账本一律由生产代码当场生成。宿主侧收口仍由 6279fcd7 的同 run 续跑与后续宿主轮次负责。
parallel_authority_added: false
overview: >
  用真实宿主输入补齐四条已证实缺失的生产路径（testing 回退 coding 再进 testing / 同 attempt 执行者多次
  自检 / contracts.files 含 PNG / ArkTS 源码含 $$），并修正这些路径上暴露的角色与判定不一致；
  prompt 四条不变量作普通回归断言。不是新回归体系：只扩 real-chain-host.ts 构建函数、两个既有
  release-only 套件与两个既有普通套件，不新增 runner、门禁、开关。不写代码，待 review。
todos:
  - id: rcp-t0
    content: 按 §1.5 做 T0 三个实验（A attended×realHarness / B 渲染规则 / V 视觉链驱动），结论写 §9，未实证项标待核。
    status: pending
  - id: rcp-binary-dollar
    content: C1：按 §2.3/§2.4/§3 把 PNG 与 $$ 语料并入正例链、补 prompt 四条不变量（正例 + 两个普通套件）及变异。
    status: pending
  - id: rcp-testing-backtrack
    content: C2：按 §2.1 新增 RC-9（testing→coding→review→ut→testing），替身按产品源码渲染；判据与变异见 §2.1。
    status: pending
  - id: rcp-selfcheck-journal
    content: C3：6279fcd7 两笔提交且 T0-V 走 (a)（或走 (b) 时 C0 已提交）后，按 §2.2 在 RC-9 内加执行者多次自检；此前保持未完成。
    status: pending
  - id: rcp-validation
    content: 按 §7 目标套件迭代、全量收口一次，结果记 §9。
    status: pending
---

# 宿主语料四条真实路径进 real-chain

> 需求输入：调度者 2026-09-23 派发（codex 与调度者已定调）。代码基线：main 7753c18f（3.1.0）。上游：[真实链路回归进发布门](真实链路回归进发布门_d4a1f7c3.plan.md) §4/§5/§10.9–10.14；
> [判定分级](判定分级与失败传播收敛_宿主开卡回灌_e7a2c4f1.plan.md) §10.4（④ 已修 A/B，随 7753c18f 入 main）；[视觉账本自检行收养](视觉账本自检行收养_宿主开卡回灌_6279fcd7.plan.md)（未开工，路径 2 前置）。
> 宿主证据（只读）：`D:\1.code\SimulatedWalletForHmos\scratch\maison-defect-pass_rate_calculated.md` 问题三/四；
> run `…/open-card-flow-v2/goal-runs/20260920T100035Z-f829b8/events.jsonl`（下称 `ev:<行>`）。

## 1. 四条路径：宿主证据与当前缺失点

### 1.1 路径 1：testing 回退 coding 后再进 testing（含 review/ut 重验）

- 宿主：`ev:362` testing `FAIL action=backtrack_to_phase`；`ev:363` `phase_backtrack_requested from=testing to=coding
  reason=repair_candidates invalidated_phases=[coding,review,ut]`，2 条 `visual_diff:*` 候选（category=coding）；
  `ev:368` coding i12 → `ev:394` PASS；`ev:398` review i13 → `ev:415` PASS；`ev:421` ut i14 → `ev:440` PASS；`ev:441-442` 再进 testing。
- 缺失：real-chain 的 testing 恒首轮 PASS——`device-test-run.js:114-129` 只克隆 `passed-*` golden，`real-chain-host.ts:411` 自述
  「trace 恒全通过，失败形态与责任路由未覆盖」；两套件无一条用例走过 `phase_backtrack_requested`，review/ut 从未被重验，
  spec/plan 证据在 coding 二次闭环后的新鲜度（b5c1e9d7 的「owner 已闭环且输出新鲜」那支）从未被真实链驱动。

### 1.2 路径 2：同一 attempt 内执行者多次自检（journal 多条）

- 宿主：`ev:323` `phase_start attempt_id=i11 driver=session`；账本 i11 三行 `f4f2`/`e75c`/`29fd`（04:06/04:08/04:15，报告问题三时间线），
  journal 只有 i4–i6；`ev:361` gate 只以 `duplicate` 命中 `f4f2`；`ev:442` 再进 testing `visual_ledger_integrity` HALT。根因与修法归 6279fcd7。
- 缺失（三层）：① real-chain 全部用例走 `goalMain()` 默认驱动，**从未 attended**；② spec.md 不声明 `ui_change`，
  `visual-diff-check.ts:1193-1197` 直接返回 `[]`，**从未产出 visual round**，账本/journal 恒空；
  ③ 采集传输面在 `check-testing.ts:169` 静态 import hmos-app 的 hylyre 截图/nav/dump 构建器（`:4862-4890`），**没有 profile 级替换缝**
  ——这正是 d4a1f7c3 §10.9 把 RC-5/6a/6b 搁置的同一前置。

### 1.3 路径 3：`contracts.files` 同时含源码与 PNG（问题四 A）

- 宿主：`contracts.yaml:365/371` 列 `result_payment_illustration.png`（432 803 B，run 中由 coding 新建、未入库）与
  `bank_logo_cmb.png`（14 140 B，基线已提交 8806fe40）；报告问题四：coding/review/ut/testing 四份 `ai-prompt.md` 1.8–2.4 MB、各含约 939 KB 乱码。
- 缺失：④ 的修复（`capability-resolution.ts:304` 二进制只给 `{path, sha256, binary:true}`）只在
  `capability-degradation.unit.test.ts:345` 用 12 字节伪 PNG + 手喂 `testTargets` 锁住；真实链的 `contracts.files` 从未含非源码文件，
  冻结→解析→prompt 拼装→verifier 材料→归属（非源码不盖 owner，b5c1e9d7 §8.9）整条未走过。

### 1.4 路径 4：ArkTS 源码含 `$$`（问题四 B）

- 宿主：`AllBanksPage.ets:254` `.bindSheet($$this.sheetVisible, this.cardTypeSheetBuilder(), {`（同形 5 处）；
  报告问题四：prompt 里 `$$this.smsVisible` 出现 0 次、被改写成 `$this`。
- 缺失：④ 的 `fill()` 单次扫描修复只在 `profile-routing.unit.test.ts:214` 用手写模板锁住；real-chain 源码无 `$`，
  真实模板 × 真实解析输入 × 真实 `assembleAIPrompt` 的组合从未被断言。

### 1.5 T0 实验（先办，结论写 §9，不预设）

| # | 问题 | 做法 | 决定什么 |
|---|---|---|---|
| A | `runGoalRuntimeChain` 的 `viaHostBridge` 与 `realHarness` 能否同开跑完 1.2 六阶段 | 正例材料原样、只加 `viaHostBridge:true` 跑一次 | RC-9 是否一开始就 attended（宿主同构 `driver=session`）；不行则 C2 走 detached |
| B | 替身「按产品源码渲染」后正例是否仍 PASS+closed，缺 id 时是否落 `testing_failure_routing_*` + `coding_candidate` | 只改 `device-test-run.js` 断言步骤的判定（§2.1） | 路径 1 触发方式是否成立 |
| V | 不改生产能否让 testing 在确定性链里产出 visual round | 只加 `ui_change` 不够（两屏均 P1，`real-chain.unit.test.ts:275` → `visual-diff-capture.ts:1010` `no_p0_targets`）：先按生产要求补齐 P0 目标与 `visual-diff-nav.json`，再看首次非复用运行是否仍进写死的截图/导航构建器（`check-testing.ts:4862/:4917`）；既有 JSON 不是跳过采集的充分条件（`visual-diff-capture.ts:514` 要求终态判定 + build 指纹 + 截图哈希三者一致），手填整份 `visual-diff.json` 违反 d4a1f7c3 §4.4 第 9 条 | 路径 2 走 §2.2 的 (a) 还是 (b) |

## 2. 构造与判据

**共同纪律**：只从宿主裁「足以重现」的片段并脱敏（§8.1）；指纹/哈希/时间戳/历史 PASS 一律不当预期值；判据口径沿
d4a1f7c3 §5——**链走得通 + owner/reason 正确，凡要求 PASS/closed 处仍逐阶段断言**。
**角色与判定不一致的处置**：新路径若撞出生产缺陷，按 b5c1e9d7 范式——先单变量实跑定位、证据写 §9、生产修复单独一笔并各带变异；
归类按 e7a2c4f1 §1.1 三档（只有产品真值 fail-closed，账本/归属对齐或披露）。**不为变绿放宽判据、不改回 1.1、不手填产物。**

### 2.1 路径 1 → `real-chain-seams` 新用例 RC-9

- **替身渲染规则**（`device-test-run.js`，测试基建，零生产改动）：断言步骤 `wait_for by_id X` 仅当模块
  `src/main/ets/**/*.ets` 含字面 `.id('X')` 时克隆 `passed-assertion-presence`，否则克隆 golden `failed-assertion-mismatch-presence`；
  动作步骤不变。trace 三轴仍由生产 reducer 反推。
- **正例材料随之补 id**（与路径 4 同一处写）：`BankListItem` 加 `.id('bank_row_cmb')`；`AllBanksPage` 加
  `@State sheetVisible` + `.bindSheet($$this.sheetVisible, this.openCardSheet(), {...})`，sheet 内 `Text('开卡申请').id('open_card_title')`
  ——点银行弹开卡 sheet，与宿主形态同构。
- **RC-9 唯一变量**：真实回退发生**之前**，coding 每次调用（含 `ctx.attempt > 1` 补 verifier 的重试，`real-chain.unit.test.ts:1072`）都**不写** `.id('open_card_title')`；只有当本 run `events.jsonl` 已有 `phase_backtrack_requested to_phase=coding` 时才写全。只读既有事件，不按调用次数、不加新状态。
- **判据**：① testing 首轮 `verdict=FAIL`，summary `repair_candidates` 含 `category=coding, source_phase=testing` 且 id 为
  `testing_failure_routing_*`；② events 有 `phase_backtrack_requested from=testing to=coding reason=repair_candidates`，
  `invalidated_phases ⊇ {coding,review,ut}`（宿主同形；是否含 testing 如实记录、不断言）；③ 回退后首次 coding 调用的 prompt 含该候选 id
  （回退注入真的到达）；④ review、ut 在回退后各有新的 `phase_start` 且最终 `PASS + closed`；⑤ spec/plan 不重跑、仍 closed，
  链尾对二者 `recomputePhaseEvidenceStaleness` 为 fresh，全程无 `live_drift`/`upstream_closure_gap`；⑥ testing 次轮 `PASS + closed`；
  ⑦ 无 `visual_ledger_integrity`（本路径无视觉行，此条在 C3 才有意义，C2 只作哨兵）。
- **放弃的准确性**：宿主回退由 `visual_diff` 候选驱动（`actionableDefectsToCandidates`），RC-9 由 hylyre 断言路由驱动
  （`repair-candidates.ts:651-671`）——两个生产者汇入同一 `backtrack_to_phase`，视觉候选的分流（含 6279fcd7 §4b 的 best_effort 口径）不在本条。

### 2.2 路径 2 → RC-9 的 attended 变体（依赖 6279fcd7 + T0-V）

- **(a) T0-V 证明不改生产即可产出 visual round**：RC-9 的 testing 首轮由执行者回调经 6279fcd7 T1 透传的签发身份
  （`goal-mode-entry.ts:300-304`）跑 3 次**不同状态**的 agent 侧真 harness（env 构造逐键复用生产常量，照 RC-4 乙段先例）。
  判据：journal 该 attempt 3 条 proposal、正式账本无自检直写行；events 3 条 `intermediate:true` appended + gate 行
  （允许 `duplicate`）；自检不写 `device-test-evidence.json`；回退后再进 testing 启动对账 ok、无 `visual_ledger_integrity`；终局 PASS+closed。
- **(b) T0-V 证明必须给采集传输面开生产缝**：走 d4a1f7c3 §5 末的生产改动例外条款，作为 **C0 独立提交**（在 §9 写明缺什么、
  现有缝为什么不够、为什么这是最小改动），不与夹具混提。C0 落地前路径 2 **保持未完成**（`rcp-selfcheck-journal` 不关），
  **不得**以 6279fcd7 T1/T5 或其它套件的覆盖代替；也**不得**覆写整拷框架里的 hmos-app 模块冒充替身。

### 2.3 路径 3 → 并入正例链（零新增 run）

- `scaffoldRealChainHost` 基线落一张**合成**最小 PNG 于 `${MODULE_PATH}/src/main/resources/base/media/logo_demo.png`（既有、coding 不改）；
  coding 材料新建第二张 `result_demo.png`（宿主「一张既有、一张 run 中新建」同形）。两张都进 `contracts.files`；
  review 报告「审查范围」按 `review_scope_to_design` 列入（它比的是解析后的 code 输入全量）。
- **判据**（正例既有六阶段 PASS+closed 之外）：spec/plan manifest 里 `logo_demo.png` 有 sha、**无** `owner_phase`；coding manifest 含
  `result_demo.png` 产出；§3 的四条 prompt 不变量。
- **不造**「coding 改写既有 PNG」：宿主无此证据；它会落进 b5c1e9d7 §8.9 的非源码 fail-safe（归属与写集口径不一，见 §5 不做）。

### 2.4 路径 4 → 并入正例链

- 语料：宿主 `AllBanksPage.ets:254` 那一行去业务名后的原形（`$$this.sheetVisible`）+ 一个模板串 `` `${phase}` ``（④ 记的占位符级联形态）。判据见 §3 不变量 2。

## 3. prompt 不变量（普通回归断言，不做「重复即失败」门禁）

对象：正例链 coding/review/ut/testing 四份真实 `<phase>/reports/ai-prompt.md`（T0 先确认哪些阶段的解析输入含上述文件，按实际取）。

| # | 断言 | 正例链落点（release-only） | 普通套件落点 |
|---|---|---|---|
| 1 | 模板主结构不复制：`harness/prompts/verify-<phase>.md` 的首个 `## ` 行在 prompt 中恰好 1 次（从模板文件读，不写死） | `real-chain.unit.test.ts` 正例尾部 | `profile-routing.unit.test.ts:214` 已有（手写模板），不改 |
| 2 | `$$` 逐字：`$$this.sheetVisible` ≥1 次，且不存在前一字符不是 `$` 的 `$this.sheetVisible`；`` `${phase}` `` 原样 | 同上 | `profile-routing:214` 的样本换成 §2.4 宿主语料 |
| 3 | 二进制不内联：prompt 不含 `IHDR`、PNG 签名字节、U+FFFD | 同上 | `capability-degradation.unit.test.ts:345` 的伪 PNG 换成 §8.1 合成 PNG（含 `` $` ``） |
| 4 | 按需读取路径正确：每张 PNG 以工程相对路径出现（不含盘符、不以 `framework/` 起头），其 sha256 等于该阶段盘上文件字节的 sha | 同上 | `capability-degradation:345` 补一步：同一解析结果经 `assembleAIPrompt` 拼成整份 prompt 后再断 3/4——宿主事故就出在「二进制内联 × `$` 替换」的**连接处**，现有两条各锁一半 |

「按需读取」的口径（§8 拿不准 4）：二进制条目只给路径+sha，agent 要看就按路径去读，故断言路径可解析到工程内同一字节的文件。

## 4. 依赖顺序

1. **T0**（A/B/V）→ 2. **C1** 路径 3+4+不变量（无前置：④ 已在 main）→ 3. **C2** 路径 1（依赖 T0-B；attended 与否由 T0-A 定）→
4. **C3** 路径 2（依赖 6279fcd7 两笔**都已提交**：修法一改角色、修法二改收养；且 T0-V 走 (a)，或走 (b) 时 C0 已提交）。T0→C1→C2 不等 6279fcd7。C3 未就绪时 RC-9 以 C2 形态登记（已绿），**不登记必红用例**。

## 5. 保留 / 裁剪 / 不做

- 保留：d4a1f7c3 的口径（§1.1 替身表）、禁止手填清单（§4.4）、两套件 release-only 登记方式；正例六阶段 PASS+closed 判据一字不放宽；
  RC-1~RC-8 不动；6279fcd7 的 T1–T6 不在本 plan 重做。
- 裁剪：无新文件（RC-9 进既有 seams 套件；构建代码扩 `real-chain-host.ts`）；无新开关（RC-9 只用既有 `viaHostBridge`/`realHarness`）。
- 不做：**整份现场入库**（宿主 events/ledger/产物不拷进仓；6279fcd7 T6 的宿主重放夹具归它自己）；**重复即失败门禁**；**新 runner /
  新套件注册表字段**；宿主 PNG 原字节入库；「coding 改写既有非源码资源」的归属口径（宿主无证据，属 b5c1e9d7 §8.9 已裁的 fail-safe）；
  request 路径 `capability-resolution-entry-input.ts:157` 的 `sourceContents` 仍按 utf8 内联（④ 已登记，不在六阶段链上）；
  视觉候选分流 / best_effort 回退口径（6279fcd7 §4b 单列）；RC-5/6a/6b/7（d4a1f7c3 仍 in_progress，本 plan 不接手）。

## 6. 耗时预算（只挂发布门）

基线：`--filter real-chain` 两套件合计 **247 536 ms**（d4a1f7c3 §10.14）。预估（未实测，C 笔落地后按 §6.3 口径实测改写）：
C1 ≈ +0–5 s（不增 run，只多读盘断言）；C2 RC-9 ≈ +100–120 s（spec→testing ≈ 65 s + coding→testing 二轮 ≈ 45 s）；
C3 若并入 RC-9 ≈ +15 s（3 次自检 harness），另起用例则 ≈ +110 s。合计约 **365–390 s**。两套件仍 `releaseOnly`，日常 `npm test` 零增量。

## 7. 验证与提交划分

- 迭代（`harness/` 下；`run-unit` 只读第一个 `--filter`，一条命令一个）：`npm run typecheck`；`npm run test:unit -- --filter profile-routing`；
  `--filter capability-degradation`；`--filter real-chain`（`includes` 双命中两套件）。单测输出先落日志再 grep。
- 变异（每条改生产代码的源仓文件、实跑后还原）：C1 ① `fill()` 退回顺序字符串替换 → 正例不变量 2 红（不要求不变量 1 红：会引发正文复制的触发序列在已不内联的 PNG 里）；② `decodeTextFile` 恒判文本 →
  不变量 3 红。C2 ③ 回退 `invalidatedBt` 去掉中段阶段 → RC-9 ④ 红；④ b5c1e9d7 的「owner 已闭环且输出新鲜」承接去掉 → RC-9 ⑤ 红。
  C3 ⑤ 6279fcd7 的 `:404` 置标还原 → RC-9 attended 变体红。
- 收口一次：`cd harness && npm test`；`node scripts/check-plan-version.mjs`；`git diff --check`；node 逐字节扫 LF。
- 提交：C1（`real-chain-host.ts` / `real-chain.unit.test.ts` / 两个普通套件）；C2（`device-test-run.js` / 正例材料补 id / seams RC-9）；
  C3（seams RC-9 attended 变体）；若撞出生产缺陷，修复另起一笔。均不 commit，待调度者。

## 8. 风险

1. **脱敏边界**：测试代码不得出现宿主盘符、`WalletMain`、run id、hash、真实文件名；模块沿用 `FinancialCard`，语料只取
   `$$this.<state>` 语法形态与「sheet 开卡」交互形态。**PNG 不取宿主字节**（`bank_logo_cmb.png` 是商标图，432 KB 那张过大）：
   合成 1×1 PNG + 一个 tEXt 块塞入宿主统计的触发序列（`` $` `` / `$'` / `$&` / `$$`），以 ≤200 B base64 常量写在
   `real-chain-host.ts`，scaffold 时落进 tmp 工程——**仓内不新增二进制文件**，`git ls-files --eol` 不受影响。
2. **替身变聪明**：渲染规则让假设备读源码字面，只证明「断言失败 → 路由 → 回退 → 重验」这条消费链，不证明任何设备真值；
   规则只在 `real-chain-providers/` 内，生产零感知。写进 `real-chain-host.ts` 文件尾「已知上限」。
3. **正例基线变动**：补 id、`$$`、PNG 后若 hmos-app 真实的结构/溯源检查冒出 BLOCKER，按 §2 处置流程归因，不删材料换绿。
4. **C3 可能推迟**：T0-V 走 (b) 时要先有 C0，路径 2 在此之前如实记为未完成，不以 goal-runner-testing-integrity 的覆盖冒充 real-chain。
5. **预算**：发布门单测步从 ≈4 分钟到 ≈6.5 分钟，只落在 `release:all` 3a 与 `candidate:build`。

## 9. 实施记录

（未开工）codex 第一轮：1 阻断 + 2 建议，已改——RC-9 修复触发由调用次数改为既有回退事件（§2.1）；T0-V 改为先补 P0 目标/nav 再判断缺口，确需生产缝时走 C0 例外且路径 2 保持未完成（§1.5、§2.2）；`fill()` 变异只要求不变量 2 红（§7）。顺序：T0→C1→C2 不等 6279fcd7，C3 等其两笔提交。

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
    status: completed
  - id: rcp-binary-dollar
    content: C1：按 §2.3/§2.4/§3 把 PNG 与 $$ 语料并入正例链、补 prompt 四条不变量（正例 + 两个普通套件）及变异。
    status: completed
  - id: rcp-testing-backtrack
    content: C2：按 §2.1 新增 RC-9（testing→coding→review→ut→testing），替身按产品源码渲染；判据与变异见 §2.1。
    status: completed
  - id: rcp-selfcheck-journal
    content: C3：6279fcd7 两笔提交且 T0-V 走 (a)（或走 (b) 时 C0 已提交）后，按 §2.2 在 RC-9 内加执行者多次自检；此前保持未完成。
    status: cancelled
  - id: rcp-validation
    content: 按 §7 目标套件迭代、全量收口一次，结果记 §9。
    status: completed
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

**实测（2026-09-24，HEAD 815cd996 + C2 登记，C3 取消）**：`npm run test:unit -- --release --filter real-chain` 两套件合计墙钟 **330 s**
（real-chain 3 条 + seams 7 条，10/0；seams 逐条 RC-1 27.2 / RC-2 1.9 / RC-3 56.0 / RC-4 61.1 / RC-8a 18.6 / RC-8b 16.1 / **RC-9 80.5 s**，
seams 合计 261.4 s）。RC-9 单独进程跑为 141–145 s，差额是单进程首次加载/转译整条 import 图的冷启动，套件里由前面的用例摊掉。
低于 §9.4 登记前的 415–425 s 预估。

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

codex 第一轮：1 阻断 + 2 建议，已改——RC-9 修复触发由调用次数改为既有回退事件（§2.1）；T0-V 改为先补 P0 目标/nav 再判断缺口，确需生产缝时走 C0 例外且路径 2 保持未完成（§1.5、§2.2）；`fill()` 变异只要求不变量 2 红（§7）。顺序：T0→C1→C2 不等 6279fcd7，C3 等其两笔提交。

### 9.1 T0（2026-09-24，基线 main 844606b3，实验脚本在会话 scratchpad，不入仓）

- **A（attended × realHarness）成立**：正例材料原样、只加 `viaHostBridge:true`，六阶段 PASS + closed（`next=phase_closed_wait_user`），`phase_start` 带 `attempt_id/owner_id/driver=session`，118 s。→ RC-9 一开始就走 attended。
- **B（渲染规则）成立**：`device-test-run.js` 按 §2.1 渲染后，正例（补 id）仍六阶段 PASS + closed；coding 恒不写 `open_card_title` 时 testing FAIL，`testing_failure_routing_TC-001_s1`（`repair_owner=coding`），summary `repair_candidates=[{id:testing_failure_routing_TC-001_s1, category:coding, source_phase:testing}]`，事件 `phase_backtrack_requested from_phase=testing to_phase=coding reason=repair_candidates invalidated_phases=[coding,review,ut]`（与宿主同形，不含 testing）。**同时撞出一处生产角色不一致**，见 §10.1。
- **V（视觉链驱动）→ 走 (b)，需生产缝**：按 plan:91 先补齐——spec.md 声明 `ui_change: new_or_changed`、`all_banks` 升 P0、testing 写 `device-testing/visual-diff-nav.json`（spec/plan/coding/review/ut 仍全 PASS，未另触发门禁）。首次非复用 testing 运行确实进入 `runDeviceVisualDiffCapture → captureVisualDiff`：① nav 带 identity 时因 semantic_layout 不装配 `layoutDumpFn`，报「identity 已确认但无 layoutDumpFn」；② 去掉 identity 后进入 `check-testing.ts:4865` 写死的 `buildHylyreVisualDiffScreenshotFn`，日志 `$ real-chain-seam-python -m hylyre screenshot --out …shot-all_banks.png` → `spawnSync real-chain-seam-python ENOENT`，`visual_diff_capture` WARN `no_captures`，未产出 `visual-diff.json`、账本/journal 仍空。可换的只有替身交出的 `pythonPath`，而 `spawnHylyre` 不经 shell、固定 `-m hylyre` 前缀，替身只能换成真 Python（环境依赖，§8/RC-7 口径不得进发布门）或覆写整拷的 hmos-app 模块（§2.2(b) 明令禁止）。结论与 §2.2(b) 一致：**C3 前须先有 C0**，交裁决（§10.2）。

### 9.2 C1（路径 3 + 4 + prompt 不变量）——已完成，未 commit

- `harness/tests/utils/real-chain-host.ts`：两张合成 1×1 PNG（各 100 B，tEXt 含 `` $` `` `$'` `$&` `$$`，仅像素不同）以 base64 常量落在本文件；`writeHostBytes`；scaffold 在基线里落 `logo_demo.png`；文件尾「已知上限」补渲染规则与 T0-V 结论。
- `harness/tests/unit/real-chain.unit.test.ts`：`contracts.files` 加两张 PNG；coding 新建 `result_demo.png`，页面按宿主同构改为 `.bindSheet($$this.sheetVisible, this.openCardSheet(), {` + `` `${phase}` `` + sheet 标题 `.id('open_card_title')`，`BankListItem` 加 `.id('bank_row_cmb')`；`writeCodingMaterials` 增 `entryTitleId` 选项（RC-9 用）；review 审查范围列两张 PNG；facts 从 coding 起的 delta 表承接两张 PNG（实跑 coding 期 `context_exploration_facts_scope_coverage` 对二进制目标同样报「当前目标未覆盖」）；正例尾部 `assertPngProvenance` + 四阶段 `assertPromptInvariants`；`writeTestPlan` 改 export。
- 不变量落点（T0 实测 spec/plan prompt 不内联源码，取 coding/review/ut/testing 四份）：1 模板首个 `## ` 行（从 provision 出来的 `verify-<phase>.md` 读）恰 1 次；2 `$$this.sheetVisible` ≥1、无单 `$` 版本、`` `${phase}` `` 原样；3 无 `IHDR`/PNG 签名字节/U+FFFD；4 每张 PNG 有 `path: <工程相对路径> sha256: <sha> binary: true` 条目且 sha 等于盘上字节。
- 普通套件：`profile-routing` 的内联源码样本换成宿主语料（`.bindSheet($$this.sheetVisible, …` + `` `${phase}` ``）并补单 `$` 断言；`capability-degradation` 的伪 PNG 换成合成 PNG、源码换成宿主行，并补「同一解析结果经 `assembleAIPrompt` 拼整份 prompt 后断 1/3/4 与 `$$`」（连接处）。
- 变异（改源仓生产文件、实跑后 `git checkout` 还原）：M1 `fill()` 退回逐键顺序字符串替换 → 正例红于「coding：不变量 2 没有逐字的 $$this.sheetVisible」，profile-routing 10/1、capability-degradation 20/1（整份 prompt 里 `$$` 被改写）；M2 `decodeTextFile` 恒判文本 → 正例红于「coding：不变量 3 内联了 PNG 块（IHDR）」，capability-degradation 20/1。

### 9.3 C2（路径 1）——停在裁决点，RC-9 已写、未登记

- `harness/tests/utils/real-chain-providers/device-test-run.js`：渲染规则（`renderedIds` 扫工程内 `src/main/ets/**/*.ets` 的字面 `.id('X')`；缺 id 的断言步骤克隆 `failed-assertion-mismatch-presence`，`failureDump` 在 trace 目录落 ui_dump 并回填 sha，满足失败边界义务）。动作步骤不变，三轴仍由生产 reducer 反推。
- `harness/tests/unit/real-chain-seams.unit.test.ts`：`rc9TestingBacktrackThroughCoding`（attended；coding 替身经 `loadAuthoritativeEvents` 读本 run 事件，只在已有 `phase_backtrack_requested to_phase=coding` 后写 id，补 verifier 那次重试同样缺 id）。七条判据按 §2.1 实现；④ 的「回退后 coding/review/ut 各有新 phase_start」放在 ② 事件形状之前断。**未登记进 `cases`**：现行生产上确定性红（§10.1），不登记必红用例。
- 现行生产实跑（REAL_CHAIN_DEBUG）：①②③ 过（`invalidated_phases=[coding,review,ut]`；回退后首次 coding 指令含 `testing_failure_routing_TC-001_s1`，即 attended 下注入也到达）；回退后 coding 写了 id 仍 FAIL `diff_within_scope`，同签名二轮 `no_progress_guard` halt，④⑤⑥ 均未到达。
- 单变量实验（临时生产补丁，实跑后已还原，工作树无生产改动）：只在 `check-coding.ts:342` 把 profile 声明的测试路径（`tryLoadDiffExcludeTestPathRegexes`）从越界集合剔除 → RC-9 **七条全过**，141.6 s / 148.5 s（两次）。在此补丁上跑 §7 的 C2 变异：③ `invalidatedBt` 只留目标阶段 → RC-9 红于 ②（`invalidated_phases 缺中段阶段：["coding"]`），**④ 仍绿**——review/ut 在回退后照样重跑（coding 改码后游标按新鲜度重推下游），§7「→ RC-9 ④ 红」不成立，改记为 ② 红；④ b5c1e9d7 的「owner 已闭环且输出新鲜」承接去掉 → RC-9 在回退**之前**就红（「没有发生回退」，57 s）：同一承接在首轮 review 时已被消费，隔离不到 ⑤。

### 9.4 验证（本批）

- `npm run typecheck` exit 0；`--filter profile-routing` 11/0；`--filter capability-degradation` 21/0。
- `--filter real-chain`（两套件）：real-chain 3/0 + real-chain-seams 6/0，墙钟 274 s（基线 247.5 s；RC-1 29.8 s / RC-2 3.0 s / RC-3 62.7 s / RC-4 65.6 s / RC-8a 21.0 s / RC-8b 18.2 s）。增量来自正例多两张 PNG 与断言、seams 共用材料。RC-9 登记后按实测再加 ≈140–150 s，合计 ≈415–425 s，高于 §6 的 365–390 s 预估。两套件仍 `releaseOnly`。
- 全量 `cd harness && npm test` 与 LF/`git diff --check`/`check-plan-version` 结果见 §10.4。

## 10. 偏差与待裁决（单列）

### 10.1 待裁决：RC-9 撞出的生产角色不一致（阻塞 C2 登记）

- **现象**：testing→coding 回退后，coding 的 `diff_within_scope`（`check-coding.ts:321-345` 现代分支：run 基线累计 diff，在模块内但不在 `contracts.files` 的一律越界）把 **ut 阶段自己写的 UT 测试文件** `…/src/ohosTest/ets/test/AllBanksPage.test.ets` 判成 coding 越界。首轮 coding 时该文件还不存在，所以正例链从未撞到；只要 ut 跑过再回到 coding 必撞。detached（T0-B）与 attended（RC-9）同样复现，越界清单恰好只有这一个文件。
- **为什么是生产缺陷而非夹具**：UT 测试文件列进 `contracts.files` 会让首轮 coding 的 `file_completeness` 判缺（ut 尚未写），不列又让回退后的 coding 判越界——作者无论怎么写都有一轮过不去。宿主 `contracts.yaml:369-370` 把测试文件列进了 `files`，能过是因为宿主那两份测试文件在基线里已存在（历史 run 留下），不是正确用法。生产侧早有「测试路径」判据（`capability-resolution-entry-input.ts:389` 的 `isTestPath` = UT 根 ∪ `diffExcludeTestPathRegexes`，源码读集据此剔除测试文件），唯独 coding 的写集核对没用它。
- **候选最小修法（未落地）**：`check-coding.ts:342` 越界集合剔除 profile 声明的测试路径，复用 `isTestPath` 同一判据（UT 根 + `tryLoadDiffExcludeTestPathRegexes`），最好把该判据提成一处共用。预期不放宽写保护：coding 若真写了 UT 目录，runtime 的逐次写归因（`phaseWriteBoundary`，`goal-phase-runtime.ts:7002` 传入 UT 根解析器）应另判 `phase_write_violation`——**只读代码得出、未实跑**，须在修复笔里用反例锁住。单变量实验已证此修法下 RC-9 七条全过（§9.3）。
- **需要调度者裁决**：是否按 b5c1e9d7 范式另起一笔生产修复（含变异：去掉测试路径剔除 → RC-9 红于 ④ 之前的 coding 停机；以及「coding 真写 UT 目录仍被写归因拦下」的反例）。裁决落地后 RC-9 只需在 seams `runAll` 前登记一行。

### 10.2 待裁决：T0-V 走 (b)，C3 前须 C0

见 §9.1 V。缺的是采集传输面（截图 / layout dump / nav 执行器）的 profile 级替换缝：`check-testing.ts:169` 静态 import、`:4862-4890` 写死装配 hylyre 构建器；`runDeviceVisualDiffCapture` 自己的 `devices` 参数是现成的接缝，但只有这一个调用方且不经 profile。现有缝为什么不够：`pythonPath` 只能换成真 Python（环境依赖），`isDeviceVisualDiffSkipped` 只能整体跳过、产不出 visual round。最小改动方向（供 C0 立项参考，本批未做）：让 `captureIfUiChanged` 的三个传输函数经 `device_test.run` provider 取（缺省仍是 hylyre 构建器），real-chain 替身随 device-test-run.js 一起提供。`rcp-selfcheck-journal` 保持未完成。

### 10.3 与 plan 原文不同的取舍（放弃的准确性）

1. **PNG 归属判据改按实测写**（§2.3 原文「spec/plan manifest 里 `logo_demo.png` 有 sha、无 owner_phase；coding manifest 含 `result_demo.png` 产出」）：实测 spec/plan manifest **不含任何 PNG**（二者的源码读集来自 facts baseline 的 source_code_paths，不含资源图）；PNG 从 coding 起以 `role=input`、有 sha、无 `owner_phase` 进 manifest，coding 新建的那张也不记产出（`addBoundInput` 只对 `source_owners` 里的路径记 output，非源码不进归属——b5c1e9d7 §8.9 既定 fail-safe）。断言改为：凡出现在 manifest 的 PNG 条目 sha 等于盘上字节且无 `owner_phase`，coding 起两张都在。放弃的准确性：不锁「plan 期已读过既有 PNG」这一格（生产本来就不记）。
2. **不变量 4 只断 binary 条目**：prompt 里另有带盘符的绝对路径形态（script_report 的 capability 解析 dependencies JSON，含 PNG 的 `C:\…\logo_demo.png` + sha），属既有行为、不在本 plan 修；断言落在 agent 按需读取用的那条 `path: <相对路径> … binary: true` 上。放弃的准确性：没有断「prompt 全文不出现绝对路径」。
3. **facts delta 表承接 PNG**：属作者材料补齐（与 BankListItem.ets 同法），不是放宽判据；记在这里是因为 plan 未预见 `context_exploration_facts_scope_coverage` 对二进制目标同样要求承接。
4. **C2 变异预期改写**：③ 实为 ② 红、④ 仍绿；④ 在回退前就红、隔离不到 ⑤（§9.3）。两条都只在临时修法上实跑，正式修复笔须重跑。
5. **RC-9 以函数形式留在 seams、未登记**：不登记必红用例；裁决前它不在任何发布门里运行。
6. **耗时预估偏高**：见 §9.4，登记 RC-9 后约 415–425 s。
7. 观察（未处理，不在本 plan 范围）：T0-V 中 testing 第二轮按执行键复用时，`visual_diff_capture` 报 PASS「设备截图沿用被复用 run 的产物」，而被复用的那轮实际零截图（`no_captures`）；semantic_layout 下 `visual_diff` 仍 WARN「报告尚未产出」，未形成视觉假 PASS，但该 PASS 文案与事实不符。

### 10.4 收口验证

- 全量 `cd harness && npm test` 一次：exit 0（typecheck + unit 4762 passed / 0 failed，real-chain 两套件按 release-only 跳过 + fixtures 46 / 0）。
- `git diff --check` 0；`node scripts/check-plan-version.mjs` PASS；node 逐字节扫本批全部改动文件均无 CR。
- 本批不含生产文件改动（M1/M2/实验补丁/C2 变异均已 `git checkout` 还原）。**注意**：全量跑期间（本地 11:16–11:25）工作树里出现了非本批的改动——`harness/prompts/verify-coding.md`、`verify-testing.md`、`harness/tests/unit/execution-channel.unit.test.ts`、`skills/reference/device-testing-workflow-detail.md`（另一写者），本批未触碰；上面的全量结果可能混入了它们的中间态，提交时须按归属分拣。

### 10.5 C2 收口（2026-09-24，基线 HEAD 815cd996 = plan f3b8d261 笔一；本批只改测试，未 commit）

- **§10.1 已裁决并修复**：调度者按 b5c1e9d7 范式另起 plan [f3b8d261](coding越界集合承接UT产出_真实链路回灌_f3b8d261.plan.md)，笔一（UT 调用自有源码写随 `phase_write_observed.owned` 落盘 + check-coding 只扣字节未变、无他阶段改写的 UT 产出）已提交 815cd996。§10.1 的候选修法（按 profile 测试正则剔除）被否决，未采用。
- **RC-9 登记**：`real-chain-seams.unit.test.ts` 在 `runAll` 前登记 `RC-9`（releaseOnly 随套件）。七条判据原样；另补「承接不免 UT 重验」（f3b8d261 §4.2）：回退后 ut 最后一次 PASS 的事件下标 > coding 次轮 PASS，且 ut `summary.json` 的 mtime 晚于 testing 首次调用时的快照（不要求旧 UT 证据 fresh）。实跑：单独 145.1 s 全过（补新断言前一次 141.2 s）；套件内 80.5 s 全过（§6 实测）。
- **C2 变异在正式修复上重跑**（改源仓生产文件 → 只跑 RC-9 → `git checkout` 还原，`git status` 只剩两份测试文件）：
  - ③ `invalidatedBt` 改为 `.slice(targetIdxBt, targetIdxBt + 1)`（只作废目标阶段）→ RC-9 **红于 ②**：`invalidated_phases 缺中段阶段：["coding"]`（137.8 s）。与 §9.3 临时补丁上的结果一致；§7 原文「→ RC-9 ④ 红」不成立（review/ut 仍按新鲜度重跑），维持 §10.3-4 改记。
  - ④ `recomputePhaseEvidenceStaleness` 的 `ownedOutputIsCurrent` 在 pendingOwnerPhase 判断之后恒返回 false（去掉 b5c1e9d7「owner 已闭环且输出新鲜」承接）→ RC-9 **红于回退之前**（「没有发生回退」，52.3 s）：首轮 coding 闭环时 NEXT_STEP 判 spec manifest stale（changed: index.ets、AllBanksPage.ets），`recommendation=rerun_phase:spec` → `backtrack_target_absent` HALTED，review/ut/testing 从未开始。隔离不到 ⑤，与 §9.3 一致。对「回退后 b5c1e9d7 承接」的隔离记**未验证 / 不适用**（前置链失败，不算 ⑤ 被杀）。
  - 附（f3b8d261 §4.3 M3，笔一时归笔二）：runtime 不发 `owned`（`phase === ut` 条件恒假）→ RC-9 **红于 ④**（「review 回退后没有重新开始」，101.7 s），日志里回退后 coding FAIL `diff_within_scope`（scope_violation）——RC-9 确实锁住 f3b8d261 的修复。
- **RC-9b（UT→coding）未覆盖**：可行性实验结论见 f3b8d261 §8.3。一句话：UT 执行替身按源码判 `ut_hvigor_test` FAIL/`code_regression` 能落到真实 ut 报告，但同一份报告另有 20 项「不适用」BLOCKER SKIP（DAG / use-cases / L3 / MockKit / import 白名单等），`canProduceVerifierRequest`（verifier-plan.ts:273-279）因 BLOCKER SKIP 不签发诊断 verifier，候选 `ut_product_assertion_failure` 不产，ut 同签名二轮 `no_progress_guard` 停机。替身与 RC-9b 函数均已撤回，不登记。
- **路径 2 / C3 取消**（用户裁决）：T0-V 走 (b) 需要给采集传输面开生产缝（§10.2），用户裁定**不开生产缝**，路径 2（同 attempt 执行者多次自检、journal 多条）在 real-chain 记为**未覆盖**；`rcp-selfcheck-journal` 置 cancelled，不以 6279fcd7 T1/T5 或 goal-runner-testing-integrity 的覆盖冒充。
- **todo**：`rcp-testing-backtrack` → completed；`rcp-selfcheck-journal` → cancelled（上条原因）；`rcp-validation` → completed（依据：C1 批全量 `npm test` 见 §10.4；本批只动两个 release-only 套件的测试代码与 `real-chain-host.ts` 注释，全量跑对它们只做存在性校验，故本批只跑 typecheck + `--release --filter real-chain`；调度者随后在笔二树上补跑全量 `cd harness && npm test`：4773/0 + fixtures 46/0，EXIT=0）。
- 验证：`npm run typecheck` exit 0；`--release --filter real-chain` 10/0（330 s）；`git diff --check` 无输出；node 逐字节扫本批改动文件无 CR。
- **放弃的准确性**：「UT 报告刷新」按 summary.json mtime 判（文件系统时间戳，非内容）；同一毫秒内重写或 mtime 精度不足的文件系统上可能误红；mtime 只证明文件被重写过（重写旧内容也会变大），重验真实性由事件序断言（回退后 ut PASS 晚于 coding 次轮 PASS）承担，两者合用。

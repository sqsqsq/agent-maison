---
name: 六阶段重构 B08 — 复用证据绑定、执行键身份与长图参考推导施工图
overview: 同键复用轮照常写出真机证据并按"与 decideReuse 同一判据"的执行键身份采信（不再拿本 attempt 的时间窗与本轮装机否决）；装机复用分支回传当前 HAP 的完整摘要，代理与外层的执行键从此相等（不做短指纹回落、不跳过任何记录）；参考图与视口同宽但更高时，采集、provider、检查三处共用同一"顶部一屏"比对输入，比对范围与区域外元素的未验证状态写清并沿既有覆盖/债务机制传递；unverified 不再单独构成失败事实。预算、T8、verifier 指引、执行键构成不动。B08 只做本地修复；宿主补验收归 B06。
version: 3.0.0
todos:
  - id: b08-plan-review
    content: 施工图由用户评审（plan 阶段不走 dev/review 循环）；codex 只读评审第 1 轮六条 + 公式修正已全部落盘（§8）。通过后先把三份 plan 文档提交为基线，再按循环协议实施（Opus 实施、codex review、三轮熔断、通过即提交）。
    status: completed
  - id: b08-reuse-evidence-binding
    content: 按 D1：写出门槛改为"装机事实已知（真装或复用同 HAP）∧ 设备执行事实存在（真跑或同键复用）"；doc 增可选字段；采信端复用态调用与 decideReuse 共用的记录判据（提取 isExecutionRecordReusable），跳过本轮装机与 run meta 时间窗；装机复用的当前 HAP 完整摘要由 goal 运行时从 device-test-install.meta.json + 盘上 HAP 算出注入 DeviceTestCollectContext；V1 覆盖"装机复用+设备真跑"与"两者均复用"，V2 反例，含派生统计重建场景。
    status: completed
  - id: b08-execution-key-identity
    content: 按 D2：装机复用分支回传当前 HAP 完整 sha256（与真装分支同源），删短指纹回落、删"跳过 hap 未知记录"；V3 用真实 64 位摘要断言两路径同键。
    status: completed
  - id: b08-reference-top-slice
    content: 按 D3：image-toolkit 增 resolveCompareReference（direct / top_slice / incompatible，每次重裁）；采集（:1047 失效判定、:1237/:1327 score/edge）、provider（:113 索引）、检查（:1326 前置门 + 比对域索引）、spec 前置门五处接同一输入；范围划分只用 ui-spec 声明 bbox（splitMustHaveByTopSlice），provider 覆盖与 visual_diff_region_attest 共用范围内子集；范围外/未确定以 visual_reference_viewport WARN + DEBT_SOURCE_CHECKS 新条目披露，capture_completeness_external 分母不动；V5–V9。
    status: completed
  - id: b08-unverifiable-no-failure-kind
    content: 按 D4：hasRuntimeFailureEvidence 去掉 unverified 一项，其余失败事实原样；V10 两场景（仅 unverified → 无归因；unverified + harness FAIL/可信缺陷 → 归因保留）。
    status: completed
  - id: b08-spec-docs
    content: 按 D6：新 change 目录三条 delta + MIGRATION 3.0.x 三行。
    status: completed
  - id: b08-local-acceptance
    content: V1–V11 全绿 + typecheck + LF 扫描 + 一次全量 `cd harness && npm test`；纯文案返修不重复全测。候选件重建与宿主验收不在本批。
    status: completed
---

# B08 施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。B08 是 B07 宿主补验收（run `20260907T063800Z-26c3b0`，已回填 [B06 §6](pipeline_b06_matrix_acceptance_4d9c1f72.plan.md)）暴露的三条框架侧缺口 + 一条归因小错的最小修复。前置是"B07 已提交、B06 已回填"，不是"B06 已完成"。原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)。

**完成边界**：B08 的完成 = 本地修复 + §7 判据；宿主补验收是 B06 的 `b06-host-b08-reacceptance`（用户触发，testing→testing 窗口即可同时打到 D1/D2/D3），不在本批待办与判据内。

**证据门槛**：每条 D 以"具体代码分支 + 宿主现场可复现输入"为前提；核实后不成立或不该改的写进 D5 并**不改**。

## 1. 问题边界（宿主 run `20260907T063800Z-26c3b0`，只读）

终态 `run_end HALTED / no_progress_visual_gap / TERMINAL`；i1 FAIL→retry、i2 PASS→retry、i3 FAIL→halt（retries 2/2，backtracks 0）。B07 目标行为已成立（三轮 `[actionable] … minor 不产回修候选`，deterministic_defects 恒 `[]`）。停机由下面三条造成，均与 B07 改动无关。

**① 同键复用轮写不出/采信不了真机证据（复用 × 证据绑定）。**
i2 外层 harness 07:18:19–07:18:52 只跑 33 s：`decideReuse` 同键命中 070508Z-350（`capture_not_run`）。证据写出 `writeDeviceTestEvidenceIfEligible`（[check-testing.ts](../../harness/scripts/check-testing.ts):3206）在 :3218 `!holder.installExecuted || !holder.installOk` 与 :3222 `!holder.deviceTestRunExecuted || !holder.hylyreTracePath` 时直接返回空；`installExecuted` 在 :3155 定义为 `res.executed && res.reused !== true`——装机复用即视为"未装机"。采信 `validateDeviceTestEvidenceBinding`（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):2181–2222）再要求 :2199 本轮真装、:2213–2220 run meta 起止落在本 attempt 的 harness 窗口。复用回填的是被复用 run 的冻结 meta（[execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts):71 属 execution 组），时间必在窗外。宿主 i2 落在后者：`run meta 的 run_started_at/run_ended_at 不在本 attempt 的 harness 窗口内` → `unverifiable_must_fix` → retry。另外 `decideReuse` :249–257 允许"执行事实齐、派生统计不齐（`timing_complete=false`）→ 先重建再复用"，任何采信规则都不得比它更严。**结论：goal 模式下复用一旦发生必被否决，B03 收益归零，且每次否决烧一次 retry。**

**② 装机复用分支不回传完整摘要，执行键交替，复用被"最新一条"挡住。**
`testing/reports/*/hylyre/execution-key.json` 五条记录键交替：`21071a69…(hap_sha256_full=null)` 06:44、`a7685ee1…(hap=20956575…)` 07:08、`21071a69…` 07:24、`a7685ee1…` 07:40。hap 为空的两条来自 testing 代理自己跑的 `harness-runner --phase testing`（同一条 hylyre 命令、outcome=success）。根因：check-testing.ts:3157 `holder.hapSha256Full = res.hapSha256Full ?? null`——真装分支回传 64 位完整摘要，**装机复用分支不回传**（`dispatchDeviceTestInstall`，:3119 调用，实施时定位其 provider 实现的 reuse 支路）；:4431 组键取的就是这个 holder 字段。`decideReuse`（:204–221）只看最新一条：外层看到"最新 run 是其他 key"→ 真跑 20 例 + 装机；代理下一次看到的最新又是外层的 → 也真跑。**一小时内真机跑了四遍。** 注意 `device-test-install.meta.json.hapSha256`（:2409）是 **12 位短指纹**，不能用作 `hap_sha256_full` 回落。

**③ 长图参考屏重采后留 pending，且三处各自判不兼容。**
i3 重采后 `add_bank_card_expanded`（ref 1320×4350）与 `all_banks`（1320×8312）被剔出比对，verifier 未终判（critic `unread_screenshots=1`），P0 未覆盖 → `visual_diff` FAIL → retries 耗尽。判不兼容的地方有三处、各自独立：采集 [visual-diff-capture.ts](../../profiles/hmos-app/harness/visual-diff-capture.ts):1047–1056（按旧条目判 `viewportIncompatibleIds`，:1427 整条剔除旧裁决，:1237/:1327 `refForPixel=null` 不产 score/edge）、provider [visual-provider-review.ts](../../profiles/hmos-app/harness/visual-provider-review.ts):93–119（自建 refIndex，:113 判定后推入 `viewportIncompatibleIds`）、检查 [visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts):1326–1368（前置门 + `comparableScreens`）。既定出路"作者建模"（[archive/2026-09-02](../../openspec/changes/archive/2026-09-02-visual-reference-viewport-precheck/design.md)）在宿主 spec 未发生，长列表页的滚动可重复前提也不可满足。用户 09-07 裁定走**顶部一屏机器推导**；codex 09-07 按该方案评审，不因旧否决推翻。

**④ i2 `verdict=PASS + action=retry` 却带 `failure_kind_classified=code_regression`**（events.jsonl:72）。直接原因：`hasRuntimeFailureEvidence`（goal-phase-runtime.ts:8210–8220）把 `actionableResult.unverified.length > 0` 当作失败事实，而 unverified 的语义是"证据身份不齐待重采"。

## 2. 非目标

- 不改执行键的输入构成（不加 golden、不加时间），不改冻结件组与派生统计重建，不迁移旧记录。
- 不改 retry/backtrack 预算；不改 T8、量测口径、verifier 模板。
- 不做多段推导、滚动拼接、自动分段、`reference_region`、按参考图改写 viewport；只推导顶部一屏。
- 不给 attest / refs 回执改用派生图：verifier 读图与举证仍绑原图。
- 不新增 failure_kind 枚举值；不新增缓存清单；不跳过任何执行键记录。
- 不重建候选件、不跑宿主。

## 3. 决策纪要

### D0：保留的真源与状态

execution-key 记录与 `decideReuse` 的"最新同键成功且执行冻结件齐、派生不齐先重建"语义；evidence doc schema 1.1 与 `written_at` 唯一裁决字段；`visual_reference_viewport` 前置门（宽度不同仍剔除）；`captured_in_run`、golden 采集、refs 回执 hash 绑定；capture_completeness / visual-debt 台账。

### D1：复用轮照常写出证据，采信与 decideReuse 同一判据

**写出侧**（check-testing.ts:3206–3245）：
- 门槛改为两条事实：`装机事实已知` = `holder.installExecuted && holder.installOk` **或** `holder.installPassed && res.reused && holder.hapSha256Full`（复用同 HAP，摘要由 D2 保证非空）；`设备执行事实存在` = 真跑 **或** 本轮 `reusable` 非空（:4441）。两条同时成立才写，否则照旧返回空。
- doc 字段（全部可选，schema_version 仍 1.1，旧 doc 无字段 = 非复用，行为逐字不变）：`install_executed`（如实）、`install_reused: boolean`、`reused_by_execution_key: boolean`、`execution_key`、`reused_run_dir`（相对 projectRoot）、`hap_sha256_full`（已有）。

**采信侧**（goal-phase-runtime.ts:2181–2222）：
- 从 `decideReuse` 提取纯函数 `isExecutionRecordReusable(record, runDir, artifacts) → { ok, reason }`（同键、`outcome==='success'`、trace 存在、execution 组冻结件齐；派生组缺/`timing_complete=false` **不**是拒绝理由——它在 decideReuse 里走重建）；decideReuse 改为调用它（行为不变），采信端复用同一函数。
- `doc.reused_by_execution_key === true` 时：读 `reused_run_dir/execution-key.json`，要求 `record.execution_key === doc.execution_key` 且 `isExecutionRecordReusable` ok；**跳过** :2199 本轮真装与 :2213–2220 run meta 时间窗两项；`trace_path` 一致性（:2203–2207）与 `written_at` 窗口（:2209）保留。
- `doc.install_reused === true`（无论设备是否复用）时：:2199 改核 `doc.hap_sha256_full === ctx.currentHapSha256Full`，不要求本轮真装。**比较值的来源（codex 第 2 轮 #3）**：采信端在 harness 之外、拿不到 holder，改由 goal 运行时在组装 `DeviceTestCollectContext`（goal-phase-runtime.ts:2099，:7984 处已在填 `harnessWindow`）时从**既有装机产物**算出：读 `reportsDir/device-test-install.meta.json` 的 `hapPath`、`hapMtimeMs`、`hapSizeBytes`、`hapSha256`（12 位短指纹）；对盘上 `hapPath` 文件核 mtime 与 size 一致后算 sha256 全量，并要求短指纹是其前缀（宿主实值：`hapSha256=209565756333` 正是 `20956575…` 的前缀）；三者任一不符或 meta 缺失 → `currentHapSha256Full = null`，绑定返回 `当前 HAP 完整摘要不可核验（install meta 缺失或与盘上 HAP 不一致）`。不新增身份系统，不与 doc 自身字段比较。
- 非复用 doc 四项检查逐字不变。新增人读原因：`复用记录身份不匹配（<isExecutionRecordReusable.reason>）`、`复用装机的 HAP 摘要与当前不一致`、`当前 HAP 完整摘要不可核验`。

效果：i2 那种复用轮正常写出并采信证据，不再进 `unverifiable_must_fix`。

### D2：装机复用分支回传当前 HAP 完整摘要

- 定位 `dispatchDeviceTestInstall`（check-testing.ts:3119 调用）的 provider 实现，找到 `reused: true` 支路；该支路与真装支路**同源**计算当前 `hapPath` 的 sha256（64 位 hex），一并回传 `hapSha256Full`。check-testing.ts:3157 不改。
- **删除**（相对上一版 plan）：`device-test-install.meta.json.hapSha256` 回落（它是 12 位短指纹）；`decideReuse` 跳过 hap 未知记录（会掩盖较新的失败/未完成执行，转而复用更早的成功——不是可接受的折扣）。
- 旧的 hap=null 记录留在磁盘：最多导致一次正常真跑，之后新记录同键。

### D3：顶部一屏推导——五处接同一输入，比对范围与坐标口径写死

**判据（修正公式）**：可推导 := `referenceViewportIncompatible(ref, shot)`（既有：`rh/rw > (vh/vw) × 1.15`，[image-toolkit.ts](../../profiles/hmos-app/harness/image-toolkit.ts):379–392）**且** `ref.w === shot.w`。不另写增量式公式。宽度不同 → 不可推导 → 现状整屏剔除。

**单一入口**：image-toolkit 增 `resolveCompareReference({ refAbs, shotDims, projectRoot, refId }) → { path: string | null; mode: 'direct' | 'top_slice' | 'incompatible'; note?: string }`。`top_slice` 时**每次**用 jimp 把原图顶部 `shot.h` 像素重裁到 `device-testing/device-screenshots/_derived-ref/<ref_id>.top<shotH>.png`（覆盖写；不看已有文件、不做缓存判定），返回派生路径。五处消费：
1. 采集 :1047–1056 失效判定：`mode==='incompatible'` 才入 `viewportIncompatibleIds`；`top_slice` 屏按普通屏处理（同 build 同 hash 可跳采，旧裁决不整条剔除）。
2. 采集 :1237 / :1327 `refForPixel`：`direct`/`top_slice` 都用返回的 path 产 score/edge。
3. provider :113：ref 路径用返回的 path；`top_slice` 屏不入 `viewportIncompatibleIds`；prompt 明示"参考图为长页顶部一屏（进入态），只评本屏范围"，并把范围外/未确定的 must_have 元素列为"勿判缺失"（清单来自下文 `splitMustHaveByTopSlice`）。
4. 检查 :1326–1368：前置门只对 `incompatible` 出行；比对域索引 `refIndexForCompare` 把 `top_slice` 屏指向派生路径，供 :1688 文本布局/OCR 与其余机器比对使用；`refIndexForAttest`（:1893）、refs 回执仍用原图。
5. spec 前置门 [fidelity-snapshot-check.ts](../../profiles/hmos-app/harness/fidelity-snapshot-check.ts):155：同判据（用 lock 的 viewport 尺寸）；可推导 → PASS 行 details 注"顶部一屏推导"，不可推导 → 现状；suggestion 文案两处同步。

**比对范围与坐标口径**：
- 派生图与截图同尺寸、同原点（页顶左上），所有"参考侧坐标"（OCR 文本位置、边缘瓦片、score）天然落在同一坐标系，**不做任何换算**。
- 相对**原图**的归一化坐标只出现在 verifier 的 `region_attest.source_bbox`（source_ref=原图）；harness 复算 crop 仍用原图（:1893 不变）。verifier 侧不感知派生图。
- `defects[].bbox` 相对截图，不受影响。

**比对范围由声明确定，dump 只看实际出现（codex 第 2 轮 #1）**：
- ui-spec.yaml 每个元素都声明了相对**参考原图**的归一化 `bbox: [x, y, w, h]`（宿主 ui-spec.yaml:4 口径注释、:87/:101/:118 实例）。`top_slice` 屏的范围划分**只**用这份声明：`ratio = shot.h / ref.h`；`y + h ≤ ratio` → **范围内**；`y ≥ ratio` → **范围外**；跨线或无 bbox → **范围未确定**。不读 layout dump、不读产品实际挂载结果——产品漏画顶部元素时它仍在"范围内"，照常报缺失（V8 反向）。`locateElements` 的 located/unmatched 一律不参与范围判定。
- 范围内元素：缺失/错位按现状产 defect；范围外与范围未确定的 must_have 元素：不要求出现、不算 missing、不算 pass，统一记为**未验证**。

**两处覆盖门共用同一范围（codex 第 2 轮 #2）**：
- provider 的 region 覆盖（visual-provider-review.ts:395–408 `target.mustHaveElements`）与最终门禁 `visual_diff_region_attest`（visual-diff-check.ts:1785–1800 `expected = uiScreen.must_have_elements`）对 `top_slice` 屏都改用**范围内**子集作 expected；范围外/未确定子集写进各自 details。两处从同一个纯函数 `splitMustHaveByTopSlice(uiScreen, ratio) → { inScope, outOfScope, undetermined }` 取值，不各算各的。
- `capture_completeness_external`（capture-completeness-check.ts:411）检查的是"参考图内容是否完整进入 spec"，**分母不动**——上一版"未挂载元素进该债务"的写法删除。
- 顶部之外的未验证状态沿**既有视觉检查 + 视觉债务**披露：`visual_reference_viewport` 对 `top_slice` 屏出一行 WARN（MINOR）`<screen>: 参考图 W×H 高于视口，按顶部一屏（entry state）比对；范围外 N 个 / 未确定 M 个 must_have 元素未验证`；把 `visual_reference_viewport` 加进 [visual-debt.ts](../../harness/scripts/utils/visual-debt.ts):50 `DEBT_SOURCE_CHECKS`（label「参考图顶部一屏外未验证」），债务条目按既有派生规则产生（WARN/FAIL → open）；**清偿规则只对该来源特化（R1 codex #2）**：testing 侧"全部兼容 → 零结果"，故该 check 缺席或本轮只有 PASS 行时，**仅当本轮 check 集合里有 `visual_diff` 且 `status==='PASS'` 且 `structured.kind==='visual_diff'`（视觉流水线真跑了）才 closed**；否则历史条目原样保留——spec 前置门对可推导屏出的 PASS 行不清偿（长图未动、只重跑 spec 不得提前关闭），SKIP / 缺报告 / 解析失败时缺席也保留。其他来源的"缺席保留、PASS 清偿"不动。`visual_diff` details 与 `referenceNotes` 同句提示，杜绝"整屏 PASS"误读。
- 低档无 dump 不再是特例：范围来自声明，出现与否由 provider/OCR 看截图，与档位无关；未验证状态同样进上面的 WARN 与债务，不"跳过检查加一句说明"。

**不洗绿**：派生顶部一屏与实机进入态对不上（长图非页顶截取、缩放不同）→ 走既有像素/OCR ratchet 报 WARN/FAIL。

### D4：unverified 不单独构成失败事实

落点：goal-phase-runtime.ts:8210–8220 `hasRuntimeFailureEvidence` 的或项里删除 `actionableResult.unverified.length > 0`，其余九项逐字不变。`unverifiableOnly`（:8261）分支的 retry 逻辑不动。效果：仅 unverified（harness PASS、无可信缺陷、无超时/崩溃/非零退出）→ `hasEvidence=false` → 无 `failure_kind_classified`、无 blocker_signature；unverified 与任一其他失败事实并存（harness FAIL、blockers、可信缺陷、超时…）→ 归因照旧保留。不新增枚举。

### D5：核实后不改（六项）

1. 执行键输入构成不动：golden 不入键（B07 D3 已定），时间不入键。
2. retry/backtrack 预算不动：D1 之后同输入不会再因复用被否决而消耗 retry。
3. T8、量测坐标、verifier 模板不动。
4. 2026-09-02 否决项保持：不做多段推导、滚动拼接、自动分段、`reference_region`、按参考图改写 viewport。本批只把"顶部一屏"一条收窄出来；codex 09-07 已按 A 方案评审，不再以旧决议争论。
5. attest 与 refs 回执不改用派生图。
6. 旧 hap=null 记录不迁移、不删、不跳过。

### D6：规格与文档同步

- openspec：新 change `reuse-evidence-binding-and-reference-derivation`，三条 delta：① goal-runner——复用轮证据写出门槛与按执行键身份采信（MODIFIED 现有绑定条款）+ D4 一句；② harness-gates/device execution——装机复用分支回传完整 HAP 摘要、两路径同键（MODIFIED "Device execution is keyed by real execution inputs"；在途 change `execution-reuse-and-report-layering` 已 MODIFIED 同段，实施时核对其归档状态，以归档后文本为基线或在同一 change 内叠加）；③ visual-diff——顶部一屏推导、五处同源、覆盖判定范围与未验证传递（MODIFIED 2026-09-02 前置门条款中"不做自动 crop/分段/拼接"为"仅顶部一屏推导；不做分段/拼接"）。
- [MIGRATION.md](../../MIGRATION.md) 3.0.x 三行（复用证据采信口径、装机复用摘要、顶部一屏推导），各附放弃的准确性。
- 总 plan §5 行与 B06 待办 `b06-host-b08-reacceptance`：已随上一版落盘。

## 4. 文件与提交边界

| 组 | 文件 | 内容 |
|---|---|---|
| C1 生产 + 单测 | `harness/scripts/check-testing.ts`（D1 写出门槛与字段）、`harness/scripts/goal-phase-runtime.ts`（D1 采信、D4）、`profiles/hmos-app/harness/execution-key.ts`（D1 提取 isExecutionRecordReusable）、`profiles/hmos-app/harness/device-test-evidence.ts`（D1 字段）、装机 provider 实现文件（D2，实施时定位）、`profiles/hmos-app/harness/image-toolkit.ts`（D3 resolveCompareReference）、`profiles/hmos-app/harness/visual-diff-capture.ts`、`visual-provider-review.ts`、`visual-diff-check.ts`、`fidelity-snapshot-check.ts`、`harness/scripts/utils/visual-debt.ts`（D3 DEBT_SOURCE_CHECKS 一条）；`capture-completeness-check.ts` **不动**；单测：`device-test-backtrack`（V1/V2/V10）、`testing-trace-gates` 或 execution-key 所在 suite（V3/V4）、`visual-fidelity`（V5–V9）、`golden-nav-capture-wiring` 或 capture 所在 suite（V7 连续两轮）、`goal-runner-testing-integrity`（V10） | 一笔提交 |
| C2 规格 | `openspec/changes/reuse-evidence-binding-and-reference-derivation/**`、`MIGRATION.md` | 一笔提交 |
| C3 文档 | 本 plan 实施记录 | 一笔提交 |

提交按循环协议：codex review 通过后由调度者提交；不加 Claude 署名。开工前先把三份 plan 文档提交为基线。

## 5. 接受的准确性边界（放弃的准确性）

- **D1**：复用轮采信的是"被复用 run 的记录身份 + 执行冻结件齐 + 键相等"，不再要求本轮装机与本轮时间。手改冻结件能骗过它——防篡改不是优先级。
- **D2**：装机复用支路的摘要来自当前 HAP 文件字节，与真装同源；不再有任何回落。
- **D3**：只覆盖进入态一屏；范围外与范围未确定的 must_have 元素零证据，以 `visual_reference_viewport` WARN + 视觉债务条目披露，按既有债务政策阻断 release 直到页面按段建模或参考资产换成单视口图——这是把"静默剔除"换成"显式未验证"，不是新门槛。范围划分只信 ui-spec 的声明 bbox：声明错位会把元素划错范围（划到范围外＝少验一个；划到范围内＝可能误报缺失），由现有 defect-review/人读 details 纠正。长图若非页顶截取，会得到显式 WARN/FAIL 而非静默剔除。
- **D4**：仅 unverified 的轮次不带归因；同轮有其他失败事实时归因不丢。

## 6. 验收用例

| # | 场景 | 输入 | 期望 |
|---|---|---|---|
| V1 | 复用轮写出 + 采信（真实链路，两种组合） | (a) **装机复用 + 设备真跑**：holder `res.reused`、摘要非空、本轮真跑；(b) **两者均复用**：装机复用 + `reusable` 命中（记录 success、执行冻结件齐、`timing_complete=false` 触发派生重建）。两例都经 `writeDeviceTestEvidenceIfEligible` 写出；`DeviceTestCollectContext.currentHapSha256Full` 由 fixture 的 `device-test-install.meta.json`（hapPath/mtime/size/12 位前缀）+ 盘上 HAP 文件算出 | (a) doc 含 `install_reused=true`、`reused_by_execution_key=false`，run meta 在窗内 → 返回 null；(b) doc 含 `install_reused=true`、`reused_by_execution_key=true`、`execution_key`、`reused_run_dir`，冻结 meta 在窗外 → 仍返回 null；(c) 同 (b) 但盘上 HAP 被替换（size/mtime 不符）→ 返回"当前 HAP 完整摘要不可核验" |
| V2 | 复用身份不符 / 非复用不变 | 记录 key 不同、outcome=failed、执行冻结件缺一 → 三例；另一例非复用 doc 在窗外 | 三例各返回"复用记录身份不匹配（…）"；非复用 doc 仍返回时间窗/装机原因（逐字不变） |
| V3 | 两路径同键 | 同一 HAP：一次真装、一次装机复用，各自组键 | 两条记录 `inputs.hap_sha256_full` 均为同一 64 位 hex，`execution_key` 相等；不存在 hap=null 记录 |
| V4 | 最新一条规则不变 | 记录序列 [success A] → [failed A] | `decideReuse(A)` 不复用（最新失败）；行为与改动前逐字相同 |
| V5 | 顶部一屏推导 | ref 1320×4350、shot 1320×2120 | `resolveCompareReference` mode=`top_slice`，派生文件高 2120；检查：该屏在 `comparableScreens`、前置门无该屏行、notes/details 含"按顶部一屏比对；其余部分未验证" |
| V6 | 宽度不同仍剔除 | ref 1080×4350、shot 1320×2120 | mode=`incompatible`；采集/provider/检查/spec 四处行为与改动前逐字相同 |
| V7 | 连续两轮不回 pending | 同 build 同截图 hash 跑两次采集 + 检查 | 第二轮该屏条目保留（不被 :1427 剔除、不重采），verdict 不被清回 pending；score/edge 有值 |
| V8 | 范围划分、两处覆盖门与债务（正反两向） | ref 顶部与截图一致；ui-spec 声明三类 must_have：A 在顶部（bbox `y+h ≤ ratio`）且截图有；B 在下方（`y ≥ ratio`）；C 无 bbox。(反向) 同 fixture 把 A 从截图抹掉 | 正向：`splitMustHaveByTopSlice` 得 inScope=[A]、outOfScope=[B]、undetermined=[C]；provider 覆盖与 `visual_diff_region_attest` 都只要求 A，B/C 不报 missing；`visual_reference_viewport` 出 WARN 行含"范围外 1 / 未确定 1"，visual-debt 产生 `visual_reference_viewport` 来源条目；`capture_completeness_external` 分母与改动前相同。反向：A 缺失照常产 missing defect，**不得**被划到范围外 |
| V9 | 同尺寸原图换内容 / 对不上不洗绿 | 先跑一次生成派生图；替换原图内容（尺寸不变）再跑 | 派生图内容随原图更新（sha 变化）；派生顶部与截图明显不同时走 ratchet 得 WARN/FAIL，不出 PASS |
| V10 | unverified 归因 | (a) harness PASS + 仅 unverified；(b) harness FAIL + unverified；(c) 可信缺陷 + unverified | (a) phase_verdict 无 `failure_kind_classified`、action 仍 retry；(b)(c) 归因与 blocker_signature 与改动前相同 |
| V11 | 回归 | 既有 suites | `device-test-backtrack` / `visual-fidelity` / `testing-trace-gates` / `golden-nav-capture-wiring` / `goal-runner-testing-integrity` 用例数不减 |

## 7. 命令与完成判据

    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter device-test-backtrack
    npm --prefix harness run test:unit -- --filter testing-trace-gates
    npm --prefix harness run test:unit -- --filter visual-fidelity
    npm --prefix harness run test:unit -- --filter golden-nav-capture-wiring
    npm --prefix harness run test:unit -- --filter goal-runner-testing-integrity
    node <scratch>/lf-scan.js（改动文件全 LF）
    openspec validate（strict）
    cd harness && npm test（代码定稿后一次；纯文案返修不重复）

完成判据：V1–V11 全绿；typecheck、openspec、LF 通过；全量 `npm test` 一次 PASS。候选件重建、宿主验收（B06 `b06-host-b08-reacceptance`，testing→testing 窗口预期：i2 类复用轮直接闭合、代理与外层键相等、两张长图屏有 `_derived-ref` 派生参考且 verifier 终判）不在本批。

## 8. 修订记录

### 2026-09-07：施工图（未评审、未实施、未提交）

依据：宿主 run `20260907T063800Z-26c3b0` 只读取证（B06 §6 缺口①②③④）+ 用户裁定问题三走 A 方案（顶部一屏推导）。

### 2026-09-07：codex 只读 plan review 第 1 轮（六条 + 公式修正，全部采纳；未实施、未提交）

- #1 P1 → D1 重写：写出门槛纳入复用态（:3218 早返回是根因之一）；采信端提取并复用 decideReuse 的记录判据，删除 `timing_complete=true` 要求（派生重建路径合法）；V1 改为真实"决定复用→写出→读取"，含重建场景。
- #2 P1 → D2 重写：根因是装机复用支路不回传完整摘要；改为两支路同源回传 64 位 sha256。删除短指纹回落（`hapSha256` 为 12 位）与"跳过 hap 未知记录"（会掩盖较新失败）。V3 用真实摘要。
- #3 P1 → D3 补齐采集层（:1047 失效判定、:1237/:1327 score/edge）与 provider（:113）接线，五处共用 `resolveCompareReference`；V7 连续两轮。
- #4 P1 → D3 写死比对范围与坐标口径（派生图与截图同坐标系不换算；原图坐标只在 attest）、区域外元素的未验证传递（layout dump 挂载事实 + capture_completeness_external 债务；无 dump 跳过并注明）；V8。
- #5 P2 → 派生图每次重裁，不做存在/尺寸缓存；V9。
- #6 P2 → D4 改为只删 `hasRuntimeFailureEvidence` 的 unverified 一项，其余失败事实原样；V10 三场景。
- 公式 → 可推导 := 既有 `referenceViewportIncompatible`（倍率 1.15）∧ 同宽；删除 `1+tolerance` 写法。

### 2026-09-07：codex 只读 plan review 第 2 轮（三条，全部采纳；六项已通过部分未动）

- #1 P1 → D3 范围划分改为**只用 ui-spec 声明的归一化 bbox**（`y+h ≤ ratio` 范围内 / `y ≥ ratio` 范围外 / 跨线或无 bbox 范围未确定），layout dump 与 `locateElements` 不参与范围判定；顶部应有元素漏画照常报缺失，V8 加反向场景。
- #2 P1 → provider 覆盖与 `visual_diff_region_attest` 从同一纯函数 `splitMustHaveByTopSlice` 取范围内子集；`capture_completeness_external` 分母不动（删上一版"未挂载进该债务"）；顶部之外的未验证以 `visual_reference_viewport` WARN + 新增 DEBT_SOURCE_CHECKS 条目披露；低档无 dump 不再是特例。V8 同时验最终门禁与债务结果。
- #3 P2 → D1 比较值来源：goal 运行时从 `device-test-install.meta.json`（hapPath / hapMtimeMs / hapSizeBytes / 12 位 hapSha256 前缀）+ 盘上 HAP 文件算出 `currentHapSha256Full` 注入 `DeviceTestCollectContext`，不与 doc 自身比较；V1 覆盖"装机复用 + 设备真跑"与"两者均复用"，另加 HAP 被替换的反例。

## 实施记录

验证日志目录：`<scratch>/b08/`（`dev1-before-<suite>.log` 改动前基线、`dev1-<suite>.log` 改动后、`dev1-typecheck.log`、`dev1-openspec-validate.log`、`dev1-lf-scan.log`）。全量 `cd harness && npm test` 本轮**未跑**（由调度者在 review 通过后跑一次）。

**工作区共用告警**：本轮实施期间同一工作树内另有一条会话在改 Codex verifier 模板（`agents/**`、`harness/capability-registry.ts`、`harness/package.json`、`harness/scripts/check-init.ts`、`harness/tests/run-unit.ts`、`adapter-catalog-consistency` 单测、未跟踪的 `agents/codex/templates/**` 等）并删除 `checkMediaReferenceIntegrity`（`visual-parity-backstop.ts`、`providers/coding-visual-parity.ts`、`coding-rules.yaml`、`goal-runner-testing-integrity` 删 `E2E-5` 一例、`goal-phase-runtime.ts`:1929 两行注释、`MIGRATION.md`:260 一段），HEAD 也从 be5a3448 前进到 defc8b74（plan 文档提交）。这些改动**不是本轮的**，本记录与汇报只覆盖下表文件；`goal-runner-testing-integrity` 的用例数因对方删 `E2E-5` 少 1（63 → 62 基线 + 本轮 4）。

### 2026-09-07 · D1 复用轮照常写出证据，采信与 decideReuse 同一判据（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `profiles/hmos-app/harness/execution-key.ts`:209–240 / :253 | 从 `decideReuse` **提取** `isExecutionRecordReusable(record, runDir, { executionKey, artifacts?, label? }) → { ok, reason }`（同键 / `outcome==='success'` / trace 在盘 / execution 组冻结件齐；派生组与 `timing_complete` 不在其中）；`decideReuse` 改为调用它，四条拒绝原因字符串逐字不变（`label` 传 dirStamp），派生重建分支原样 |
| `harness/scripts/check-testing.ts`:1944–1953 / :3167 / :4629–4631 | holder 增可选事实 `installReused` / `deviceRunReused` / `executionKey` / `reusedRunDir`；install 门禁 `holder.installReused = res.reused === true`；run 门禁在 `deviceTestRunExecuted = true` 后记 `deviceRunReused = Boolean(reusable)`、`executionKey`、`reusedRunDir`（相对 projectRoot，与 `structured.reused_run_dir` 同算式） |
| `harness/scripts/check-testing.ts`:3232–3250 / :3295 / :3340 | 写出门槛改为 `installKnown = (installExecuted && installOk) ‖ (installPassed && installReused && hapSha256Full)` ∧ 既有"run 已执行且 trace 在盘"；`reuseFields`（`install_reused` / `reused_by_execution_key` / `execution_key` / `reused_run_dir`，后两者仅有值时写）spread 进 native identityDoc 与 legacy compose doc 两处；`install_executed` 如实 |
| `harness/scripts/utils/device-test-evidence-shared.ts`:163–170 | `DeviceTestEvidenceDoc` 四个可选字段（schema_version 仍 `'1.1'`）——**plan 未列此文件**：类型在这里而不在 `device-test-evidence.ts`，composer 不需要知道复用事实（writer 单点写入），故 `device-test-evidence.ts` 未动 |
| `harness/scripts/goal-phase-runtime.ts`:2106–2111 / :2121–2140 | `DeviceTestCollectContext` 增 `projectRoot`（解析 `reused_run_dir`）与 `currentHapSha256Full`；新增 `resolveCurrentHapSha256Full(projectRoot, reportsDir)`：读 install meta 的 hapPath/hapMtimeMs/hapSizeBytes/hapSha256，盘上文件 mtime 与 size 逐一相等后算 sha256 全量并要求 12 位短指纹为前缀，任一不符/缺失 → null |
| `harness/scripts/goal-phase-runtime.ts`:2231–2262 / :2274 | `validateDeviceTestEvidenceBinding`：`install_reused===true` → 核 `doc.hap_sha256_full === ctx.currentHapSha256Full`（原因 `当前 HAP 完整摘要不可核验（…）` / `复用装机的 HAP 摘要与当前不一致`），否则旧装机检查逐字不变；`reused_by_execution_key===true` → 读 `<projectRoot>/<reused_run_dir>/execution-key.json`，动态 require profile 的 `isExecutionRecordReusable`（沿 :2248 既有 `require(path.join(profileDir,…))` 先例，core 不静态依赖 profile）以 `doc.execution_key` 判身份，失败 → `复用记录身份不匹配（<reason>）`；trace 一致性与 `written_at` 窗口保留；`if (runReused) return null` 跳过 run meta 时间窗 |
| `harness/scripts/goal-phase-runtime.ts`:8050–8055 | 组装 ctx 时注入 `projectRoot` 与 `currentHapSha256Full: resolveCurrentHapSha256Full(projectRoot, reportsDir)` |

**为什么最小**：不加身份系统、不改 schema 版本、不改 decideReuse 行为；采信端与复用端共用一个纯函数，"采信不比复用严"由结构保证；比较值来自既有装机产物（三核），不与 doc 自身比。

**验证**

- `npm --prefix harness run test:unit -- --filter device-test-backtrack`：19 → 22 passed / 0 failed（`dev1-device-test-backtrack.log`）
  - V1(a)（`device-test-backtrack.unit.test.ts`:912）：holder `installReused=true / installExecuted=false / deviceRunReused=false` 经**真实** `writeDeviceTestEvidenceIfEligible`（compose 走真实 `composeDeviceTestEvidence`）→ PASS，doc 含 `install_reused=true / reused_by_execution_key=false / execution_key`、无 `reused_run_dir`、`install_executed=false`；install meta（hapPath/mtime/size/12 位前缀）+ 盘上 HAP → `currentHapSha256Full === hapSha`；run meta 在窗内 → `validateDeviceTestEvidenceBinding` 返回 null；摘要不一致 → `复用装机的 HAP 摘要与当前不一致`
  - V1(b)(c)（:934）：run 目录落成功记录（execution 冻结件齐、`timing_complete=false`）→ **真实** `decideReuse` 命中且 `evidenceRebuildRequired=true` → 写出 doc 含 `reused_by_execution_key=true / execution_key / reused_run_dir`（相对 projectRoot 指向该 run）→ 冻结 meta 写成一小时前（窗外）→ 采信 null；盘上 HAP 换字节 → `currentHapSha256Full=null` → `当前 HAP 完整摘要不可核验（install meta 缺失或与盘上 HAP 不一致）`
  - V2（:965）：记录键不同 / outcome=failed / execution 冻结件缺一 → 三例各返回 `复用记录身份不匹配（…）`（正则锁住内含原因）；同 ctx 下非复用 doc 在窗外 → `run meta 的 run_started_at/run_ended_at 不在本 attempt 的 harness 窗口内`、`install_executed=false` → `evidence 无本轮真实安装成功事实（install reuse/失败不作数）`，两句逐字不变
- `npm --prefix harness run test:unit -- --filter golden-nav-capture-wiring`：10 → 11 passed / 0 failed（`dev1-golden-nav-capture-wiring.log`）
  - B08-V1 接线（`golden-nav-capture-wiring.unit.test.ts`:702）：真实 `__testing_checkDeviceTestRunGate` 两轮（只 mock 传输面，同 B07 V4 夹具）：真跑轮 `deviceRunReused=false`、`executionKey` 64 hex、`reusedRunDir=null`；复用轮 `deviceRunReused=true`、`executionKey` 与首轮相等、`reusedRunDir === structured.reused_run_dir` 且形如 `doc/features/<f>/testing/reports/<stamp>/hylyre`、目录含 `execution-key.json`、`deviceTestRunExecuted` 仍 true
- `execution-key` / `attended-goal-context` / `visual-provider` 回归：6/6、8/8、70/70（`dev1-execution-key.log` 等）

**放弃的准确性**：与 §5 D1 一致——复用轮采信"记录身份 + 执行冻结件齐 + 键相等"，不再要求本轮装机与本轮时间；手改冻结件能骗过。

### 2026-09-07 · D2 装机复用分支回传当前 HAP 完整摘要（完成）

**追根**：`installDeviceTestApp`（`profiles/hmos-app/harness/providers/device-test-install.ts`）的 `canReuseInstall` 分支（:285–323）只写 `[hap_fp] mtime/size` 日志与 meta（meta 里 `hapSha256` 是 `computeHapBuildFingerprint` 的 12 位短指纹），返回对象没有 `hapSha256Full`；完整摘要只在真装分支 :396 `hapSha256Full = computeHapSha256Full(opts.hapPath)`（d9e4b7c1 T2 "装前钉死字节"）算过一次，字段注释还写着"reuse/未执行安装路径为 null（evidence 要求 executed）"——即当年 evidence 只服务真装，复用分支被有意留空，而执行键（check-testing.ts:4431 `hap_sha256_full: hapHolder.hapSha256Full`）后来又吃了这个 holder 字段，于是复用轮键的 HAP 输入恒 null。

**改动文件**

| 文件 | 变化 |
|---|---|
| `profiles/hmos-app/harness/providers/device-test-install.ts`:60–69 / :290 / :295 / :322 | 复用分支 `const reusedHapSha256Full = computeHapSha256Full(opts.hapPath)`（与真装分支同一函数、同一 hapPath），日志加 `[hap_sha256_full] …`，返回对象加 `hapSha256Full: reusedHapSha256Full`；字段注释订正。check-testing.ts:3169（原 :3157）`holder.hapSha256Full = res.hapSha256Full ?? null` 不改 |

不做短指纹回落、不改 `decideReuse` 跳过 hap=null 记录（plan D2/D5⑥）。

**验证**

- `npm --prefix harness run test:unit -- --filter testing-trace-gates`：26 → 28 passed / 0 failed（`dev1-testing-trace-gates.log`）
  - V3（`testing-trace-gates.unit.test.ts`:1129）：真实 `installDeviceTestApp` 两次（只 mock `hdc-runner` 的 probe/bm dump/parse/candidate/installHap 与 `device-recovery-bridge.ensureReadyBefore`，require 缓存覆写、finally 复原）：第一次 `buildReused=false` 真装（installHap 1 次），第二次 `buildReused=true` 走复用（installHap 仍 1 次、`reused=true`）；两次 `hapSha256Full` 都等于 `computeHapSha256Full(hapPath)`（64 hex），`computeExecutionKey` 两路径相等，且与 hap=null 的键不同
  - V4（:1198）：[success A, timing_complete=false] → `decideReuse` 复用 + 重建；`isExecutionRecordReusable` ok（派生不齐不拒）、键不同拒；再落 [failed A] → `decideReuse(A).reusable===null` 且 reason 逐字 `最新同键 run 20260907-000002 outcome=failed，重新真跑`；`isExecutionRecordReusable(failed, label)` 的 `{ok:false, reason}` 与之 deepEqual

**放弃的准确性**：与 §5 D2 一致——摘要来自当前 HAP 文件字节，无任何回落。

### 2026-09-07 · D3 顶部一屏推导——五处同一入口，范围与坐标口径写死（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `profiles/hmos-app/harness/image-toolkit.ts`:8–9 / :407–497 | `classifyCompareReference(ref, shot)`（`referenceViewportIncompatible` ∧ `ref.w === shot.w` → `top_slice`；宽不同 → `incompatible`；否则 `direct`）、`derivedRefDir`、`resolveCompareReference({refAbs, shotDims, projectRoot, feature, refId})`（`top_slice` 每次 `crop-top` 重裁到 `_derived-ref/<ref_id>.top<shotH>.png`，覆盖写不看已有；jimp 不可用/尺寸不符 → 按 `incompatible` 剔除并带 note，fail-closed）、`splitMustHaveByTopSlice(uiScreen, ratio)`（只走 `root` 树上元素声明的 `bbox`；`y+h ≤ ratio` 内 / `y ≥ ratio` 外 / 跨线或无 bbox 未确定）。`feature` 参数是 plan 签名之外的一个：派生目录在 feature 目录下，`featureDir(projectRoot, feature)` 需要它 |
| `profiles/hmos-app/harness/image-jimp-worker.cjs`:97–110 / :406–411 | 新 op `crop-top <image> <height> <out>`：`img.crop(0,0,w,h)` 逐像素裁出，**不**走既有 `crop` 的 `trimUniformEdges`（那会把近白边裁掉、尺寸与截图不等）。**plan 未列此文件**：它是 image-toolkit 的 jimp 执行面（同步 spawnSync），派生裁切没有别的落点 |
| `profiles/hmos-app/harness/visual-diff-capture.ts`:22–29 / :1047–1069 / :1247 / :1337 | 失效判定与像素度量共用 `compareRefOf`（= `resolveCompareReference`）：只有 `mode==='incompatible'` 才入 `viewportIncompatibleIds`（`top_slice` 屏可跳采、旧裁决不剔除）；主屏与 overlay 的 `refForPixel` 取返回 `path`（`top_slice` 用派生图产 score/edge） |
| `profiles/hmos-app/harness/visual-provider-review.ts`:28 / :50–68 / :126–164 / :202–211 | target 装配走同一入口：`incompatible` 才剔除；`refAbs`/`refHash`/prompt/imagePaths 用派生图；`mustHaveElements` = `top_slice` 时 `splitMustHaveByTopSlice(...).inScope`；`topSlice{refDims, unverifiedElements}`；prompt 加 `reference_note`（顶部一屏 entry state，只评本屏范围）与 `do_not_judge_missing: …`。既有 :395–408 覆盖预检不改——它读的就是 `target.mustHaveElements` |
| `profiles/hmos-app/harness/visual-diff-check.ts`:37–44 / :1329–1408 / :1481–1484 / :1732 / :1837 | 前置门块改走 `resolveCompareReference`：`incompatible` 沿旧 FAIL/WARN（details 末尾附 top_slice 行）；只有 `top_slice` 时出 **MINOR WARN**（`<screen>: 参考图 W×H 高于视口 W×H，按顶部一屏（entry state）比对；范围外 N 个（…） / 未确定 M 个（…） must_have 元素未验证`）；`comparableScreens` 含 `top_slice` 屏；referenceNotes 加 `[reference_top_slice] 按顶部一屏比对；其余部分未验证：…`；:1732 文本布局/OCR 的 ref 解析器改为 `topSliceScreens.get(id)?.derivedPath ?? 原图`（即"比对域索引"，不另建 map）；:1837 `visual_diff_region_attest` 的 `expected` 改为 `topSliceScreens.get(id)?.split.inScope ?? must_have_elements`；:1893 attest 与 refs 回执仍用原图（未动）；两处 suggestion 文案"不做自动 crop/分段/拼接"→"仅顶部一屏推导…不做分段/拼接" |
| `profiles/hmos-app/harness/fidelity-snapshot-check.ts`:20 / :135–142 / :159 / :176–213 | spec 前置门用 `classifyCompareReference(dims, lock.viewport)`：`incompatible` 现状；只有 `top_slice` → 一行 `MINOR PASS` details 注"testing 按顶部一屏推导比对（其余部分未验证）"；两者并存 → 原 FAIL/WARN 行 details 追加 derivable 行；suggestion 与 testing 同步 |
| `harness/scripts/utils/visual-debt.ts`:60–61 | `DEBT_SOURCE_CHECKS` 加 `visual_reference_viewport: { label: '参考图顶部一屏外未验证' }`（首轮沿用既有"缺席保留、PASS 清偿"；**R1 返修改为该来源特化清偿条件**，见下方 R1 节） |

`capture-completeness-check.ts` 未动（V8 以源码锁断言它不消费任何范围划分符号）。

**为什么最小**：判据只加一个 `ref.w === shot.w`，不写增量公式；五处共用一个函数、一个派生路径；范围划分是纯函数，不读 dump / locateElements；未验证状态走既有 `visual_reference_viewport` id + 既有债务 reducer，不加新 check id、不加缓存清单、不换算坐标。

**验证**

- `npm --prefix harness run test:unit -- --filter visual-fidelity`：127 → 131 passed / 0 failed（`dev1-visual-fidelity.log`）
  - 既有四条 b3d7e5a1 T5 用例改为**宽度不同**（1080 / 108 vs 1320 / 132）作 V6（`visual-fidelity.unit.test.ts`:4661 检查 FAIL+不进 OCR、:4762 采集零度量+provider 不收+同宽更高收派生图、:4813 长图旧 PASS 剔除/兼容图跳采、:4835 低档 WARN）；改动前同宽 1320×4350 的原夹具用 header-only PNG，在新代码下会因派生失败 fail-closed 仍 FAIL——夹具改宽度是为了让 V6 真正测"宽度不同"这条路径
  - V5（:4705）：真 PNG 1320×4350 vs 1320×2120 → `mode=top_slice`、派生文件 `_derived-ref/home.top2120.png` 实测 1320×2120、`ratio=2120/4350`；`checkVisualDiff(pixel_1to1)` → `visual_reference_viewport` MINOR WARN 点名尺寸与"顶部一屏"、`visual_diff` details 含 `[reference_top_slice] …按顶部一屏比对；其余部分未验证`、无 `[reference_viewport]`；OCR spy 只看到派生图路径、不再读原图
  - V7（:4868）：真 PNG 132×435 vs 132×212，`captureVisualDiff` 两轮同 build 同截图字节：首轮 `score_floor` 有值；模拟评估 pass 后第二轮 `screensPreservedBuildValid===1`、verdict 仍 pass、score/edge 仍有值；派生图落盘。**首轮记录"check 无 FAIL"不实**（只断言了 `visual_reference_viewport` 行；夹具未补 attest / critic 回执 / reverse_missing，实测 `visual_diff=FAIL`）——R1 返修已补齐前提并断言两轮最终 `visual_diff` PASS，见 R1 节
  - V8（:4929）：ui-spec 声明 t1（bbox 顶部）/ t2（bbox 下方）/ t3（无 bbox）→ `splitMustHaveByTopSlice` = `{inScope:[t1], outOfScope:[t2], undetermined:[t3]}`；只举证 t1 → 无 `region_attest 未覆盖` 行、WARN 行含 `范围外 1 个（t2） / 未确定 1 个（t3）`、`deriveVisualDebt` 产 `visual_reference_viewport` open 条目；`collectReviewTargets` 的 `mustHaveElements=['t1']`、`topSlice.unverifiedElements=['t2','t3']`、prompt 含 `do_not_judge_missing: t2, t3`、只举证 t1 的载荷 `validateVisualProviderReviewPayload` ok；**反向**：载荷只举证 t2 → provider 报 `缺 t1`，盘上只举证 t2 → gate 报 `home（缺 t1）`；`capture-completeness-check.ts` 源码不含任何范围划分符号（分母不动）
  - V9（:4998）：同尺寸换内容（白→红）→ 同一派生路径、sha 变化；OCR spy 让派生图两文本同行、截图分居两行 → `visual_diff` FAIL 且 details 含"文本块结构背离"（既有 ratchet，不出 PASS）
- `npm --prefix harness run test:unit -- --filter fidelity-snapshot`：17 → 17 passed / 0 failed（`dev1-fidelity-snapshot.log`；**plan 五个 suite 之外**，spec 前置门的既有用例用同宽 1320×4350 期望 FAIL，在新判据下必须改：FAIL 例改 1080×4350，另加 1320×4350 → PASS 注"顶部一屏推导"、suggestion 不再含"自动 crop"）
- `visual-provider` 回归 70/70

**放弃的准确性**：与 §5 D3 一致——只覆盖进入态一屏；范围外/未确定零证据以 WARN + 债务显式披露；范围只信声明 bbox（`ref_*` 等非节点 id 的 must_have 项因无 bbox 归"未确定"，top_slice 屏不再要求它们的 attest）；非页顶截取的长图得到显式 WARN/FAIL。

### 2026-09-07 · D4 unverified 不单独构成失败事实（完成，一处偏离）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/goal-phase-runtime.ts`:8285–8295 | `hasRuntimeFailureEvidence` 删除 `actionableResult.unverified.length > 0`，其余九项逐字不变，`unverifiableOnly`（:8336）未动；**补一项** `(actionableResult.trustedDeviceRootClassifications?.length ?? 0) > 0` |

**偏离说明**：纯删除会让既有 `f4 t1 E2E：同进程 retry 与 --resume 均从 phase_verdict 恢复 test_contract prompt`（`goal-runner-testing-integrity.unit.test.ts`:2582）红——它对应 openspec goal-runner「Test-contract attribution survives retry and resume」：evidence 绑定**通过**、根 case 分类 `test_contract` 时，case 走 unverified 通路（spec 原文如此）但 `refineFailureKindWithTrustedDeviceEvidence` 精修出的 `test_contract` 必须持久化到 `phase_verdict.failure_kind_classified` 供 retry/resume 恢复 prompt。该轮在夹具里 harness PASS、零 blocker，唯一失败事实就是这批可信根失败。故保留"可信真机根失败"（`trustedDeviceRootClassifications` 非空 = 绑定通过且根 case 失败）为失败事实——比被删的 `unverified` 窄得多：宿主 i2 的 unverified 来自绑定**失败**（run meta 窗外），`trustedDeviceRootClassifications` 为 undefined，归因照删。是否改为纯删除并同时废止该 requirement 超出本轮授权，交调度者/评审裁定。

**验证**

- `npm --prefix harness run test:unit -- --filter goal-runner-testing-integrity`：63（基线）→ **66 passed / 0 failed**（对方删 E2E-5 后 62 + 本轮 4；`dev1-goal-runner-testing-integrity.log`）。纯删除 unverified 一项的首次复跑为 63/2 failed（f4 t1 + 本轮 V10(c) 的错误断言），补保留项并修正断言后复跑全绿
  - V10(a)（:3931）：截图身份不匹配的 must_fix（unverified）+ harness PASS → `unverifiable_must_fix` 落事件；testing `phase_verdict` 有 PASS+retry 轮且全部 PASS 轮 `failure_kind_classified===undefined`、`blocker_signature` 空
  - V10(b)（:3947）：同 unverified + `onHarnessSummary` 注入 `GENERIC_BLOCKER` → FAIL 轮 `failure_kind_classified` 与 `blocker_signature` 非空
  - V10(c)（:3962）：可信视觉 major 缺陷（defect-review confirmed）+ 另一屏 unverified → `phase_backtrack_requested`，首轮 verdict `failure_kind_classified==='code_regression'`、`action==='backtrack_to_phase'`（`blocker_signature` 由 summary blockers 派生，PASS summary 下改动前后皆空，不断言）
  - V10(d)（:3990）：绑定通过的 `test_contract` 根失败（与 f4 t1 同形）→ 每轮 `failure_kind_classified==='test_contract'` 且不回退（锁住上面保留项）

**放弃的准确性**：与 §5 D4 一致——仅身份不齐的 unverified 轮不带归因；同轮有其他失败事实（含可信真机根失败）时归因不丢。

### 2026-09-07 · D6 规格与文档（完成）

- `openspec/changes/reuse-evidence-binding-and-reference-derivation/`：`proposal.md`、`tasks.md`、`specs/goal-runner/spec.md`（MODIFIED「Device-test defects join the existing backtrack loop」：复用 doc 两种口径 + 写出门槛 + D4 一段，+4 scenario）、`specs/visual-diff/spec.md`（MODIFIED「A reference image incompatible with the device viewport is rejected before content comparison」：三态判据、五处同源、声明 bbox 范围、未验证披露、派生文件；scenario 全部重写/新增）。
- harness-gates「Device execution is keyed by real execution inputs」：在途 change `execution-reuse-and-report-layering` 尚未归档且已 MODIFIED 同段，按 D6 括号指示**叠加**到 `openspec/changes/execution-reuse-and-report-layering/specs/harness-gates/spec.md`（一段：两路径同源摘要、不回落、不跳过 null 记录、共用身份判据；+1 scenario；Enforcement 加 install provider）。**plan §4 未列该目录**，这是 D6 明文允许的落点。
- `MIGRATION.md`:281–289 新增 `### 3.0.x：复用轮证据按执行键身份采信，装机复用回传完整摘要，长图参考按顶部一屏推导` 五行（三条行为变化各附放弃的准确性 + 归因 + 消费者无需动手）。
- `npm run openspec:validate`：39 passed / 0 failed，enforcement 路径 PASS（`dev1-openspec-validate.log`）。

### 2026-09-07 · R1 codex review 返修（完成）

codex 第一回合 review（needs-attention：三条 high + 一条建议）全部采纳；D4 窄保留（`trustedDeviceRootClassifications` 非空作失败事实）codex 判定合理，**不改**。验证日志：`<scratch>/b08/fix1-<suite>.log`。工作树内另一会话的改动（codex verifier 模板等，见本节开头告警）一概未碰。

**#1 [high] OCR 锚点缺失门未遵守顶部范围（`visual-diff-check.ts`:1674）**

| 文件:行 | 改法 |
|---|---|
| `profiles/hmos-app/harness/image-toolkit.ts`:492 / :500–510 | 从 `splitMustHaveByTopSlice` 提取单 bbox 判定 `topSliceScopeOf(bbox, ratio) → 'in' \| 'out' \| 'undetermined'`（`y+h ≤ ratio` 内 / `y ≥ ratio` 外 / 跨线或无 bbox 未确定），split 改为调用它——两处口径由结构保证一致 |
| `profiles/hmos-app/harness/visual-diff-check.ts`:45 / :1333 / :1367 / :1679–1692 | `topSliceScreens` 条目增 `ratio`；锚点期望集合在整页集合之后，对每个 `top_slice` 报告屏（P0 且 pass）按**报告屏 id** 写入"声明 bbox 范围内节点文本"的子集（`collectGrossMissingAnchorText` 先查 `screen_id` 再回落基屏，故本条目优先；空集合也写，否则回落整页）。范围外 / 未确定文本不入期望集合、不算缺失；集合 <3 时沿既有 `MIN_ANCHORS_FOR_GATE` 不判 |
| `profiles/hmos-app/harness/visual-diff-check.ts`:1698 | `collectGrossMissingAnchorText` 接入既有 OCR 注入缝 `injectedVisualDiffOcrFn ?? undefined`（缺省仍走真实 `ocrImageWords`，与文本布局门同缝）——否则单测无法经生产接线触发该门（本机无 tesseract → 只出 degraded WARN） |

文本布局门（`collectTextPlacementSignals`）不需要收窄：其参考侧 OCR 已是派生图，派生图读不到的文本 `if (!ref) continue` 不构成对照。

验证：`visual-fidelity.unit.test.ts`:5038 新增 `B08-V8（R1 返修）`——夹具 `seedViewportProject(..., { anchors: true })` 六个声明文本（t1/t4/t5 bbox 在顶部，t2/t6 在下方，t3 无 bbox），注入 OCR：正向截图 OCR 有全部三个顶部文本 → details 无"锚点文本整块缺失"；反向截图只识别到"中信银行" → `home(缺 3/3: 添加卡片,卡片余额,最近交易)`。**反证实验**（`fix1-experiment-narrowing-disabled.log`，临时用环境变量跳过收窄循环后已删除残留）：正向例按整页口径算成缺 3/6 ≥ 50% 而红，证明该用例咬得住。

**#2 [high] 债务清偿两向错误（`visual-debt.ts`:61）**

| 文件:行 | 改法 |
|---|---|
| `harness/scripts/utils/visual-debt.ts`:156–169 | `worst` 提前到 `hits.length===0` 判断之前；**只对 `visual_reference_viewport`** 加分支：无 FAIL/WARN/非 MINOR SKIP 命中（缺席或只剩 PASS 行）时，`cleared = checks.some(id==='visual_diff' && status==='PASS' && structured.kind==='visual_diff')`；cleared → 历史条目 closed，否则原样保留。其他来源的"缺席保留、PASS 清偿"逐字不动 |

验证：`visual-debt.unit.test.ts`:762 / :772 / :789 三条 reducer 回归——兼容后（testing `visual_diff` PASS + structured.kind + 该 check 缺席）→ closed；缺席但本轮 `visual_diff` 为 SKIP / WARN（缺报告）/ FAIL（解析失败）/ 无 structured 的 PASS / 空集合 → 仍 open；长图未动只重跑 spec（`visual_reference_viewport` PASS 行）→ 仍 open，且 `visual_diff` 自身来源仍按明确 PASS 清偿。`visual-debt` 30 → 33 passed（`fix1-visual-debt.log`）。生产接线 `harness-runner.ts`:1631 传的是 `report.checks`（含 `structured`，`visual-diff-check.ts`:2929 对 PASS 结果同样挂 `structured.kind='visual_diff'`），无需改。

文档同步：plan D3（§3 "顶部之外的未验证状态"一段）"按既有规则清偿"改为上述具体规则；`MIGRATION.md`:269 同句同步；openspec `reuse-evidence-binding-and-reference-derivation/specs/visual-diff/spec.md`:15 的 "produced and cleared by the existing debt rules" 改为同一规则，并补 OCR 锚点门取范围内文本一句（**plan 未点名 openspec，为保规格真实一并改**）。

**#3 [high] V7 验收声明不实（`visual-fidelity.unit.test.ts`:4918）**

`visual-fidelity.unit.test.ts`:4874 重写夹具与断言。补齐的既有 pixel_1to1 前提：① `device-testing/visual-diff.md`；② ui-spec 声明一个无文本元素 `home_root`（作 region_attest 举证区域，同时是 T8 / `runtime_mount_conformance` 的 locator-required 元素）；③ `layoutDumpFn` 写含 `home_root` 节点的布局 dump（否则 `visual_diff_layout_dump_missing` WARN，与 top_slice 无关）；④ 模拟评估落定时补 `reverse_missing: []`、`region_attest: [{region:'home_root', method:'vl_screening', by:'visual_provider:test'}]`；⑤ `device-testing/reports/critic-receipt.json`（unverified，`image_inputs` 覆盖被评截图）。断言：两轮各取 id 恰为 `visual_diff` 的结果（`finalizeVisualDiffHits` 零命中才是该 id；低阶命中会把 id 改成命中 id，此时视为缺结果并把全部 id 打进错误信息），第一轮 **PASS**、第二轮跳采后仍 **PASS**，details 无 `[reference_viewport]`、`pending=0`；`region_attest` 跨轮存活。**实测结果**：两轮 `visual_diff` 均 PASS，无与 top_slice 无关的 FAIL 残留（补齐前提前依次实测到的是 `visual_diff_layout_dump_missing` WARN → `visual_diff_layout_invariants` WARN + `runtime_mount_conformance` FAIL，均因夹具缺 dump / attest 区域不在 dump 内，非 top_slice 所致，已由前提②③消解）。

**验证结果**

| suite | 前 → 后 | 结果 | 日志 |
|---|---|---|---|
| typecheck | — | PASS | `fix1-typecheck.log` |
| visual-fidelity | 131 → 132 | 132 passed / 0 failed | `fix1-visual-fidelity.log` |
| visual-debt | 30 → 33 | 33 / 0 | `fix1-visual-debt.log` |
| device-test-backtrack | 22 → 22 | 22 / 0 | `fix1-device-test-backtrack.log` |
| goal-runner-testing-integrity | 66 → 66 | 66 / 0 | `fix1-goal-runner-testing-integrity.log` |
| visual-provider / fidelity-snapshot（回归） | 70 / 17 | 70 / 0、17 / 0 | `fix1-visual-provider.log`、`fix1-fidelity-snapshot.log` |
| openspec validate（strict + enforcement） | — | 39 passed / 0 failed | `fix1-openspec-validate.log` |
| LF 扫描（改动 8 文件） | — | CRLF 0 | `fix1-lf-scan.log` |

全量 `cd harness && npm test` 本轮未跑（调度者跑）。

### 未做 / 存疑

- 全量 `cd harness && npm test` 未跑（本轮约定由调度者跑）；`b08-local-acceptance` 保持 in_progress。**注意**：同一工作树内另一会话的未提交改动（见本节开头）会一起进全量测试。
- 与 plan 的偏离：① D4 保留 `trustedDeviceRootClassifications` 非空一项（见 D4 节）；② 多动三个文件：`harness/scripts/utils/device-test-evidence-shared.ts`（doc 类型）、`profiles/hmos-app/harness/image-jimp-worker.cjs`（`crop-top` op）、`harness/tests/unit/fidelity-snapshot.unit.test.ts`（既有用例与新判据冲突）；`openspec/changes/execution-reuse-and-report-layering/specs/harness-gates/spec.md` 按 D6 叠加；③ `resolveCompareReference` 比 plan 签名多 `feature` 参数；④ `DeviceTestCollectContext` 增 `projectRoot`（解析相对路径需要）；⑤ 采集 :1047 失效判定用 `resolveCompareReference`（会重裁一次）而不是只分类——为了五处判据含"派生失败=incompatible"完全一致。
- `top_slice` 屏每次检查/采集各重裁一次（jimp spawn ≈ 数百 ms/屏），plan 明文要求"每次重裁不缓存"；宿主两张长图每轮约 1–2 s。
- ~~`visual_reference_viewport` 债务在参考图换成单视口图后永不清偿 / spec PASS 行提前关闭~~——R1 codex #2 已裁定并返修：该来源的清偿只认本轮 `visual_diff` PASS 且 `structured.kind==='visual_diff'`（不改 check 集合、不出 testing PASS 行），见 R1 节。
- 单测 V3 / B08-V1 接线用 `require()` 覆写 `hdc-runner` / `device-recovery-bridge` / `capability-registry` 导出（finally 复原），依赖 ts-node CommonJS 输出的属性查找时机（同 B07 备注）。
- 宿主补验收、候选件重建归 B06 `b06-host-b08-reacceptance`（用户触发）。

### 2026-09-07：codex 实施 review 两轮、全量测试、三笔提交（调度记录）

- R1 `needs-attention` 三条 high（OCR 锚点门未按顶部范围收窄；visual_reference_viewport 债务清偿两向错；V7 断言与记录不符）+ 对债务清偿规则的建议，全部返修：OCR 期望集合按声明 bbox 收窄并有反证实验；清偿只认本轮 `visual_diff` PASS 且 structured.kind=visual_diff，spec PASS 行不清偿，reducer 三条回归（30→33）；V7 补齐前提后断言两轮 visual_diff 均 PASS。R2 `approve`，无 finding；10 个相关 suite 393/0。D4 的窄保留（trustedDeviceRootClassifications 非空仍作失败事实）codex 判定合理，保留，plan D4 以实施记录为准。
- 全量 `cd harness && npm test` 一次：unit 3937 passed / 0 failed，fixtures 46 / 0（日志 scratchpad `b08/full-npm-test.log`；工作树含另一任务已提交前的 WIP，唯一曾失败的用例在其范围内且已随其提交消解）。
- 提交：C1 90ce28a0（D1–D4 + 七个 suite）、C2 8f76266e（openspec 三条 delta + harness-gates 叠加 + MIGRATION 3.0.x 小节，MIGRATION 只取 B08 hunk）、C3 本实施记录。工作区留给用户：MIGRATION「## 首选路径」块的位置移动两个 hunk（另一任务插入小节导致的层级问题）与其未跟踪文件。
- 并行工作树：本批与用户另一任务（plan 7b2e9d4c）同树并行，HEAD 从 be5a3448 前进到 1f1daa7d；codex 两轮 review 都按 B08 文件/hunk 白名单审，另一任务文件一概未碰、未 add。宿主补验收归 B06 `b06-host-b08-reacceptance`（用户触发）。

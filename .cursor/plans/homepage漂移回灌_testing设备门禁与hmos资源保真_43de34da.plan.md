---
name: 宿主homepage漂移回灌 · testing设备门禁 / HMOS资源保真 / consumer防漂移门禁
version: 2.4.0
overview: >
  以 SimulatedWalletForHmos/homepage 在 goal-mode 无人值守跑动期间、对 framework 源码的真实本地漂移为靶，把其中证明有效的修复回灌 agent-maison，并补上「防止宿主再反向改 framework 源码」的 consumer 防漂移门禁（回应最初担忧的根因）。
  权威基线：纯净 framework-2.4.0 发布件 vs 宿主 framework/（同源自一个 zip，逐文件 sha256）→ 真本地漂移 13 文件 / +429-81 / 0 删除，全部在 harness；535 发布文件中 522 字节一致、0 缺失。
  关键判定：13 处改动无一是「把 FAIL 改成 PASS」，方向与放水相反——是在补框架的诚实性与正确性；且抽样 5/5 在当前 main HEAD 仍未含（net-new）。
  三大主题：A) testing 阶段「真机/模拟器不可用(externalBlocked)」诚实终态——v2.4.0 只在 UT 阶段建好，testing 路径缺失，宿主补齐为 INCOMPLETE+路由重跑（非 PASS）；B) 框架对 HarmonyOS 真实资源格式(数组 color.json / 8位 hex / base/media PNG)支持不全 + 视觉结构/overlay 比对鲁棒性；C) consumer framework 防漂移完整性门禁——发布件补 per-file 哈希并随包下发，harness 启动期校验 framework/ 源码是否漂移，发现即 BLOCKER（默认拒、留显式 opt-out）。
  方向性风险已敲定（2026-06-27）：R1 批准（与 UT 对称，已证 INCOMPLETE 进不了 COMPLETED）；R2 采纳+homepage 乱序回归夹具硬兜底；R3 选 A（放弃 visual-diff-capture 跳过采集优化、该文件不回灌）；R4 版本保持 2.4.0（已核实未发布窗口、无 tag）；R5 防漂移门禁并入本 plan（Theme C）。Codex P2 折入 a2/tests（INCOMPLETE 仅在 device 为唯一 BLOCKER FAIL 时成立）。
  落地集：13 漂移文件中 12 文件回灌（visual-diff-capture.ts 按 R3=A 不取）+ Theme C 新增防漂移门禁。framework-only，不 bump 版本，不改宿主业务码。
todos:
  - id: a1-testing-verdict-incomplete
    content: >
      主题A · testing 设备不可用诚实终态（与已落地的 UT 版对称）。【R1 已批准】
      病灶/缺口：[report-generator.ts](harness/scripts/utils/report-generator.ts) 的 resolveVerdictFromChecks 已有 UT 版 areBlockersOnlyUtDeviceExternal/isUtDeviceExternalBlocked → INCOMPLETE，但 testing 阶段无对应分支，device_test_install 因真机不可用 FAIL 时会被并入普通 FAIL。
      改造（回灌宿主已验证补丁）：(1) report-generator 新增 isTestingDeviceExternalBlocked（build=PASS ∧ install=FAIL ∧ blocking_class=externalBlocked|failure_kind=device_blocked）+ areBlockersOnlyTestingDeviceExternal，在 resolveVerdictFromChecks 末尾追加 testing 分支 → INCOMPLETE；(2) [harness-runner.ts](harness/harness-runner.ts) decideNextAction：testing 阶段 INCOMPLETE → device_ready_then_rerun_testing；buildReadinessSignals 新增 compile_passed_device_blocked（HAP 就绪但设备不可用 → 不视为 testing 完成）。
      R1 放行语义已核实安全：[classifyPhaseVerdict](harness/scripts/utils/phase-transition-policy.ts:216) —— INCOMPLETE 仅 halt/defer_external、永不 advance；resolveGoalRunStatus 有 defer/halt 即 DEFERRED/HALTED，进不了 COMPLETED。决策＝与 UT 对称，直接回灌。
      触点：harness/scripts/utils/report-generator.ts、harness/harness-runner.ts。
    status: completed
  - id: a2-check-testing-install-diag
    content: >
      主题A · 装机失败分流诊断 + 对账保护 + INCOMPLETE 链路落地（含 Codex P2）。
      病灶/缺口：[check-testing.ts](harness/scripts/check-testing.ts) device_test_install 失败时只回 BLOCKER FAIL+原始 errors，不区分「设备/模拟器不可用」与真失败；report↔trace 对账在 install 未过(无 Hylyre trace SSOT)时仍尝试，噪声/误判。
      改造：(1) 新增 buildDeviceInstallFailResults：调 diagnoseInstallBlocking，externalBlocked → 置 holder.installExternallyBlocked、写 testing-install-diag.json、经 mapInstallBlockingToTestingCheckFields 填 failure_kind/blocking_class/suggestion；接到 checkDeviceTestInstallGate 的 skippedByEnv 与 !res.ok 两个分支；(2) checkReportTraceReconciliation：!installPassed → BLOCKER **SKIP**（注明无 trace SSOT）；(3) buildTestingRunStatusResult：拆 deviceExternalBlocked/compilePassed/staticBlockerFails。
      **Codex P2 硬约束**：INCOMPLETE 仅在「device_test_install externalBlocked 是唯一 BLOCKER FAIL」时成立（areBlockersOnlyTestingDeviceExternal 用 .every）。故凡装机依赖的下游门禁（report_trace_reconciliation 等）在 install 未过时必须 **SKIP/降级、绝不留第二个 BLOCKER FAIL**；BLOCKER SKIP 不计入 verdict 统计（[report-generator.ts:562](harness/scripts/utils/report-generator.ts:562) 只数 FAIL&BLOCKER），安全。回灌时逐一核对 testing 阶段各 check 在「无设备」下的状态。
      配套 [device-install-diag.ts](profiles/hmos-app/harness/device-install-diag.ts)：writeUtInstallDiagJson→泛化 writeInstallDiagJson(fileName 默认 ut)、buildUtInstallBlockingCheckDetails→buildInstallBlockingCheckDetails(diagFileName)，二者均**保留 @deprecated 旧签名转发**；新增 mapInstallBlockingToTestingCheckFields。
      触点：harness/scripts/check-testing.ts、profiles/hmos-app/harness/device-install-diag.ts。
    status: completed
  - id: a3-trace-explicit-skip
    content: >
      主题A · report↔trace 对账容忍 explicit_skip。
      病灶：[testing-trace-gates.ts](harness/scripts/utils/testing-trace-gates.ts) reconcileReportWithHylyreTrace 对「报告标跳过、但 Hylyre 派生表无该 TC」记为 mismatch；而 explicit_skip 用例本就不进 trace.cases，属误报。
      改造：report 状态归一为「跳过」的 TC，跳过 trace 登记要求(continue)，不计 mismatch。小改(+2 行)，但需确认不放过「应执行却被悄悄跳过」——结合 a2 的执行结果表语义核验。
      触点：harness/scripts/utils/testing-trace-gates.ts。
    status: completed
  - id: b1-hmos-resource-reads
    content: >
      主题B · HarmonyOS 真实资源格式读取（真 bug，最高确定性，优先回灌）。
      病灶证据：(1) [static-fidelity-score.ts](profiles/hmos-app/harness/static-fidelity-score.ts) readColorHexFromResources 与 [visual-parity-backstop.ts](profiles/hmos-app/harness/visual-parity-backstop.ts) walkColorJson 均按「对象 map」读 color.json，而 HarmonyOS 实际是 {color:[{name,value}]} **数组** → 颜色 token 漏读 → 保真分虚高/假阴性；(2) [image-toolkit.ts](profiles/hmos-app/harness/image-toolkit.ts) hexToRgb 只认 6 位，遇 8 位带 alpha(#AARRGGBB) 抛错；(3) [coding-host-rules.ts](profiles/hmos-app/harness/coding-host-rules.ts) collectResourceKeys 只收 element JSON，未注册 base/media/ 下无 element JSON 的 PNG media 资源。
      改造：数组格式分支(name 匹配 snake/tokenKey)+递归扫模块资源目录兜底(readColorHexFromDir)；hexToRgb 支持 8 位(取后 6 位 RGB)；从 contracts.resource_keys[*].media 注册存在的 media key。三处独立、低风险，优先回灌。
      触点：profiles/hmos-app/harness/{static-fidelity-score,visual-parity-backstop,image-toolkit,coding-host-rules}.ts。
    status: completed
  - id: b2-struct-seq-lcs
    content: >
      主题B · 结构序 LCS 有序化 + 修正分母。【R2 采纳，附回归夹具硬出口】
      病灶：结构序比对用 Set(structNames) 无序，且 LCS 分母用 `max(本屏期望组件数, 整feature所有struct数)`——分母被全 feature struct 撑大、又无序，语义错且把对的实现也压到 0（又严又错）。
      改造：[source-ref-scan.ts](profiles/hmos-app/harness/source-ref-scan.ts) 新增 structNamesOrdered（按 presentation/pages→components→shared→data→根 有序、跨目录去重 walkEtsSorted/scanEtsFile）；[visual-structure-parity.ts](profiles/hmos-app/harness/visual-structure-parity.ts) computeStructureSequenceScore 接收 sourceStructNamesOrdered，mapped 连续去重后对其做 LCS、**分母改为 mapped.length**（本屏期望组件的按序命中率，正解）。
      R2 已敲定：新算法分数普遍变高，故**硬出口(BLOCKER)**——拿 homepage「丢卡包标题/区块乱序」造回归夹具，喂回加固后框架**仍须判不过**；夹具不过则本 todo 不算完成。阈值 0.6 不动。
      触点：profiles/hmos-app/harness/source-ref-scan.ts、profiles/hmos-app/harness/visual-structure-parity.ts。
    status: completed
  - id: b3-visual-diff-overlay-coverage
    content: >
      主题B · overlay 屏 P0 覆盖回落（仅鲁棒性，与跳过采集无关）。【R3=A：跳过优化不取】
      病灶：[visual-diff-check.ts](profiles/hmos-app/harness/visual-diff-check.ts) P0 覆盖判定按精确 screen_id 取条目，overlay 屏(id__overlay__N)取不到 → P0 误判未覆盖。
      改造：仅回灌 resolveP0Entry——P0 目标 id 支持 id__overlay__ 前缀回落，使 overlay 屏正确计入 P0 覆盖。
      **R3=A 明确不回灌**：[visual-diff-capture.ts](profiles/hmos-app/harness/visual-diff-capture.ts) 的 allP0TargetsFinalized 跳过重复采集优化（连同 helper resolveVisualDiffEntry，整段 +54 行）一律不取、文件保持纯净；继续每轮重采，依赖既有 mergeCapturedScreenEntry「截图 hash 变→verdict 打回 pending」安全网（[visual-diff-capture.ts:162](profiles/hmos-app/harness/visual-diff-capture.ts:162)）。
      触点：profiles/hmos-app/harness/visual-diff-check.ts（仅此一文件）。
    status: completed
  - id: c1-release-perfile-manifest
    content: >
      主题C · 发布件补 per-file 哈希、拆「包内 manifest / dist sidecar」（防漂移门禁供给侧）。【R5 新增】
      现状（[pack-release.mjs](scripts/pack-release.mjs)）：writeStaging([:54](scripts/pack-release.mjs:54) sanitize package.json/harness package.json/vendor manifest + normalizeReleaseTextEol 统一 LF) → zipDirectory([:158](scripts/pack-release.mjs:158)) → sha256File(zip)([:159](scripts/pack-release.mjs:159)) → 写 dist sidecar manifest([:174](scripts/pack-release.mjs:174)，含 zip sha256)；dist manifest 无 per-file 哈希。
      **C-review P1a（拆两份，避免 zip sha 循环）**：包内 manifest 不能含 zip sha（zip sha 须 zip 完才算、而它自身要进 zip）。故：包内 framework/RELEASE-MANIFEST.json 仅 {schema_version, version, files:[{path, sha256}]}、**不含 zip sha**；dist sidecar framework-<v>.manifest.json 继续含 zip sha256，并引用包内 manifest 的 hash 做链式校验。
      **C-review P1b（hash 基于 staging 后字节）**：per-file sha256 必须在 writeStaging 完成 sanitize+LF 归一后、对 stagingRoot/<path> 逐文件算（**不是 repo 源文件字节**），否则 consumer 解出的是 staged 字节 → 误报。
      时序：writeStaging → 算 stagingRoot 各文件 sha256（排除 RELEASE-MANIFEST.json 自身）→ 写包内 RELEASE-MANIFEST.json 进 stagingRoot → zipDirectory → zip sha → 写 dist sidecar（含 zip sha + 包内 manifest hash）。[verify-release-pack.mjs](scripts/verify-release-pack.mjs) 复用 per-file 哈希 + 校验包内 manifest 存在性。版本仍 2.4.0（R4）。
      触点：scripts/pack-release.mjs、scripts/release-pack-rules.mjs、scripts/verify-release-pack.mjs、包内/sidecar manifest schema。
    status: completed
  - id: c2-consumer-drift-gate
    content: >
      主题C · consumer framework 防漂移完整性门禁（启动期硬门禁）。【R5 新增】
      目标：杜绝宿主开发（尤其 goal-mode 自动代理）静默改 framework 源码——发现即拦，逼其走上游而非本地漂移。
      改造：新增**独立 preflight 模块** framework_integrity——以包内 framework/RELEASE-MANIFEST.json 为准，对 files[] 逐文件 sha256 比对 consumer framework/<path>，differ/缺失 → BLOCKER（默认拒）。校验集天然只含发布文件（运行时 node_modules/dist/reports/state/trace 不在 manifest，自动排除，**零误报**——本次 522/535 字节一致即证）。
      **C-review P2b（不走 profile capability）**：framework_integrity 是全局框架自检，不应被 profile capability SKIP/provider 缺失影响——**不经 [capability-registry.ts](harness/capability-registry.ts:1) 注册/分发**（该层 profile 驱动）；改由 [harness-runner.ts](harness/harness-runner.ts) 入口 /goal 路径**直接调用** preflight；rules/specs 仅登记 check id 供报告。普通+goal 全模式统一触发（R6）。
      **C-review P2a（dev/source layout 缺 manifest）**：仅「consumer layout 且存在包内 manifest」时 enforce；agent-maison 开发仓自身无 RELEASE-MANIFEST.json（cd harness && npm test 场景）→ 返回 PASS/SKIP（no-op）、不误伤；包内 manifest 存在性由 release verify(c1) 覆盖。
      逃生开关（framework.config.json，R7）：integrity.allow_local_drift（默认 false）+ 可选 integrity.drift_allowlist（路径白名单）——本地有意 fork（如本次回灌前的 13 处）须显式声明，否则 BLOCKER；RELEASE-MANIFEST.json 自身排除在校验集外。
      触点：新增 framework-integrity preflight 模块 + harness/harness-runner.ts 入口（普通+goal 直调）+ framework.config schema（allow_local_drift/drift_allowlist）+ rules/specs 登记 check id。
    status: completed
  - id: specs-docs
    content: >
      登记与文档：新增/调整的 check 行为（testing device-block 终态、对账 SKIP、media 资源、结构序、framework_integrity）在对应 *-rules.yaml 登记 check id 与严重度；更新 [goal-mode-runbook](docs/operations/goal-mode-runbook.md) 与相关 SKILL/verify prompts 说明 INCOMPLETE 语义、设备不可用路由、防漂移门禁与 opt-out 用法。
      openspec change（[openspec/](openspec/) 是框架行为的可读 spec 层、引用 specs/harness 强制文件）：**Theme C 必做**——新能力 framework_integrity + manifest 契约 + framework.config 字段，含 [MIGRATION.md](MIGRATION.md) 消费者迁移条目（默认 BLOCKER 会拦住已漂移的消费者，须告知 opt-out）；**A/B 可选**——改既有门禁，rules.yaml + docs 即足。
      触点：specs/、docs/operations/、openspec/changes/（可选）。
    status: completed
  - id: tests-acceptance
    content: >
      出口（BLOCKER）：用 homepage 真实归档造回归夹具——(A) 设备不可用→INCOMPLETE 非 PASS，**且 device_test_install 为唯一 BLOCKER FAIL、依赖门禁均 SKIP、端到端 resolveVerdictFromChecks→INCOMPLETE 非 FAIL（Codex P2）**，经 classifyPhaseVerdict 不 advance；(B) 数组 color.json/8 位 hex/media 正确读出，结构乱序仍判不过（R2 硬出口夹具），overlay P0 正确计入；(C) **篡改任一 framework 发布文件→framework_integrity BLOCKER；opt-out 置 true→放行；运行时目录(node_modules/reports/state/trace)改动不误报；dev/source layout 缺包内 manifest→no-op PASS/SKIP（不破坏 agent-maison 自身 npm test）；per-file hash 基于 staging 后字节算、consumer 解包零误报**。R3=A：确认无跳过采集路径、既有 hash 变→pending 安全网仍在。
      各项补 harness 单测并注册 [run-unit.ts](harness/tests/run-unit.ts)，cd harness && npm test 全 PASS。不 bump 版本(package.json=2.4.0)、不改 SimulatedWallet 业务码。
      触点：harness/tests/。
    status: completed
isProject: false
---

# 宿主 homepage 漂移回灌 · testing 设备门禁 / HMOS 资源保真 / consumer 防漂移门禁（framework-only，窗口 2.4.0，不 bump 版本）

> 版本绑定 `version: 2.4.0`（与 `package.json.version` 一致）。改动含**发布内容**（`harness/` `profiles/` `specs/` `docs/`）与 **dev-only 发版脚本**（`scripts/`，不进发布件、仅开发仓改），完成后 `cd harness && npm test` 必须全 PASS（AGENTS.md BLOCKER）。

## 背景与目标

宿主工程 `D:\1.code\SimulatedWalletForHmos` 把 framework 当 **vendored 源码**集成（`framework/` 大部分被 host git 跟踪，仅 `framework/harness/` 运行时产物被 ignore），升级方式是**手动解压发布件 zip 覆盖 `framework/` 目录**。其在 goal-mode 无人值守跑 `doc/features/homepage`（像素级保真 UI 需求）期间，对 framework harness 源码做了本地修改。

**澄清一个误判**：宿主 `git status` 一度显示 36 文件 +1069/−145，但大头是「这次升级 v2.4.0 后忘了先提交」造成的升级 delta，不是手改。

**权威基线**（= 用户 Beyond Compare 那条线，已复算）：纯净 `dist/framework-2.4.0.zip` 解出的 `framework/` 与宿主 `framework/` 逐文件 sha256：

| 维度 | 值 |
|---|---|
| 真·本地漂移 | **13 文件 / +429 −81 / 0 删除** |
| 一致文件 | 535 发布文件中 **522 字节一致** → 防漂移门禁零误报可行 |
| 性质判定 | 无一处「FAIL→PASS」；均为补诚实性/正确性，方向与放水相反 |
| 与 main 关系 | 抽样 5/5 在当前 HEAD `ad744ad2` 仍未含 → **net-new** |
| 本 plan 落地 | **12 文件回灌**（visual-diff-capture.ts 按 R3=A 不取）+ Theme C 防漂移门禁 |

**目标**：(1) 把 13 处中有效修复按主题 A/B 回灌；(2) 加 Theme C 防漂移门禁，闭环「宿主反向改 framework」根因；不 bump 版本、不碰宿主业务码。

## 漂移清单（13 文件，权威基线 纯净 v2.4.0 → 宿主）

**主题 A — testing 设备不可用诚实终态（5 文件，R1 已批准）**

| 文件 | Δ | 性质 / 处置 |
|---|---|---|
| `harness/scripts/check-testing.ts` | +117/−32 | 缺口补全（主逻辑，含 P2）· 回灌 |
| `harness/scripts/utils/report-generator.ts` | +20 | 缺口补全（verdict 对称）· 回灌 |
| `harness/harness-runner.ts` | +19/−1 | 缺口补全（路由+信号）· 回灌 |
| `profiles/hmos-app/harness/device-install-diag.ts` | +40/−4 | 缺口补全（泛化，保留兼容）· 回灌 |
| `harness/scripts/utils/testing-trace-gates.ts` | +2 | 鲁棒性（explicit_skip）· 回灌 |

**主题 B — HMOS 资源格式 + 视觉比对鲁棒性（8 文件）**

| 文件 | Δ | 性质 / 处置 |
|---|---|---|
| `profiles/hmos-app/harness/static-fidelity-score.ts` | +49/−19 | 真 bug（数组 color）· 回灌 |
| `profiles/hmos-app/harness/visual-parity-backstop.ts` | +8/−2 | 真 bug（数组 color）· 回灌 |
| `profiles/hmos-app/harness/image-toolkit.ts` | +7 | 真 bug（8 位 hex）· 回灌 |
| `profiles/hmos-app/harness/coding-host-rules.ts` | +23 | 真缺口（media 注册）· 回灌 |
| `profiles/hmos-app/harness/source-ref-scan.ts` | +48/−12 | 配套（structNamesOrdered）· 回灌 |
| `profiles/hmos-app/harness/visual-structure-parity.ts` | +31/−9 | 算法修正（R2 采纳+夹具）· 回灌 |
| `profiles/hmos-app/harness/visual-diff-check.ts` | +11/−1 | 鲁棒性（**仅** overlay 回落）· 回灌 |
| `profiles/hmos-app/harness/visual-diff-capture.ts` | +54/−1 | 跳过采集优化 · **R3=A 不回灌（保持纯净）** |

**主题 C — consumer 防漂移门禁（新增，非回灌；见 c1/c2）**：发布侧 manifest 补 per-file 哈希并随包下发 + consumer 启动期硬门禁。

## 改造点

详见 frontmatter todos。回灌优先级：**b1（真 bug）→ a1/a2/a3（设备终态，R1 已批，含 P2 落地）→ b2（结构序，R2+夹具）→ b3（overlay 小改）**；**Theme C（c1→c2 防漂移门禁）可与 A/B 并行推进**。`visual-diff-capture` 跳过优化按 R3=A 不做。

## 决策（已敲定 2026-06-27）

- **R1 · INCOMPLETE 放行语义（a1/a2）→ 批准**。已核 [classifyPhaseVerdict](harness/scripts/utils/phase-transition-policy.ts:216)：INCOMPLETE 仅 halt/defer、永不 advance；进不了 COMPLETED。与 UT 对称，直接回灌。
- **R2 · 结构序 LCS 分母（b2）→ 采纳**。旧 `max(本屏期望, 全feature struct)` 又严又错；新 `LCS÷本屏期望 + 有序源struct` 为正解。附 homepage 乱序硬出口夹具。
- **R3 · 跳过重复采集（b3）→ 选 A（放弃优化）**。visual-diff-capture.ts 不回灌、保持纯净；每轮重采，靠既有「hash 变→pending」安全网。overlay 覆盖回落（visual-diff-check.ts）保留。
- **R4 · 版本（全局）→ 保持 2.4.0**。已核实无 `RELEASE-NOTES-v2.4.0.md`、无 git tag → 2.4.0 是未发布开发窗口，窗口内重打包不 bump 属既定惯例；host 下次重新拉取即可。
- **R5 · 防漂移门禁 → 并入本 plan（Theme C，c1/c2）**。回应最初担忧的根因。
- **R6 · 防漂移门禁覆盖 → 普通 + goal 全模式**。harness-runner 入口统一触发，落实「goal 与普通模式能力持续拉齐演进」原则。
- **R7 · 防漂移 opt-out → 统一走 framework.config.json**（integrity.allow_local_drift + 可选 drift_allowlist）。
- **R8 · openspec change（specs-docs）→ Theme C 必做 / A/B 可选**（已确认。依据：openspec 是可读 spec 层、非强制 CI 门禁；本仓 119 plans 仅 20 changes，选择性使用）。
- **Codex P2（testing INCOMPLETE）→ 折入 a2 + tests-acceptance**（无需单列决策）。INCOMPLETE 仅在 device 为唯一 BLOCKER FAIL 时成立，依赖门禁须 SKIP；BLOCKER SKIP 不计 verdict（[report-generator.ts:562](harness/scripts/utils/report-generator.ts:562)），安全。
- **Codex Theme C 工程落点（C-review 4 点）→ 全采，折入 c1/c2/tests**：P1a 拆「包内 manifest(无 zip sha) / dist sidecar(含 zip sha)」；P1b per-file hash 基于 staging 后字节；P2a dev/source layout 缺 manifest 时 no-op PASS/SKIP；P2b framework_integrity 走独立 preflight、不经 capability-registry。

## 出口

homepage 归档回归夹具（含 R2 乱序硬出口 + C 篡改/opt-out/运行时不误报）+ harness 单测全 PASS（见 tests-acceptance）；framework-only，不 bump 版本，不改宿主业务码。

## 不在本 plan 范围

- `visual-diff-capture.ts` 的跳过采集优化（R3=A 明确放弃，保持纯净）。
- 宿主侧清理（把 13 个本地补丁与 v2.4.0 升级 delta 分别成 commit）属宿主工程操作，由用户决定。
- v2.4.0 升级 delta 那 23 个文件（非手改，是发布件正常内容），无需处理。

---
name: testing 写保护误伤与真机缺陷回修缺口 — 生成物分类降级 / 正式 gate 强制安装 + device_test 回修接入
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户控版本，不 bump）。
overview: >
  2026-07-28 宿主 bc-openCard run（20260728T031459Z-e19c6b）testing 阶段 HALTED
  (testing_write_violation) 复盘定性：不是 agent 改码，也不是宿主异常，而是两个 framework
  缺口。① 误伤：hvigor 构建任务 CreateHarBuildProfile 在 invoke 窗口内合法重写模块根的
  BuildProfile.ets（构建生成物），被纯 fs 快照写保护误判为"agent 改产品源码"，且该违规是
  run 终止态（拒 resume），一中招整 run 报废；② 缺口：本轮真实缺陷（真机缺 hc_bank_row_cmb
  元素、trace 确定性失败）没有自动回 coding 的通路——collectActionableDefects 只消费
  visual_diff 与 crash 两源。
  v10（简化定稿）：v7-v9 的 install provenance 账本体系（build/install 两张 history、
  最后有效设备状态 resolver、event 引用/作废规则、TOCTOU 双点哈希）被整体删除——连续三轮
  P0 各打掉一版规则，是过度设计的信号。原问题只需证明"正式 gate 测试前当前 HAP 刚装到
  当前设备"，用**正式 gate 强制 hdc install -r** 一次动作消掉整个状态推理：T1 三判据纯
  内容校验（不需要构建痕迹——与 hvigor 输出逐值一致的文件没有行为差异）；T2 只信正式
  gate 产出的覆盖式 device-test-evidence.json（强装+测试后写入，collector 立即消费，
  身份/设备元组/hash/窗口校验）。普通模式 reuse 优化零变化。
  v11（八轮 review 局部补强，无结构扩张）：T1 补 attempt 级 product/buildMode 冻结
  （HARNESS_DEVICE_TEST_PRODUCT/BUILD_MODE 是公开覆盖 env，agent 子进程临时覆盖不会传回
  runner，分类器与 hvigor 实际生成会漂移——冻结值同发 agent/gate/分类器三方）+ 路径判据
  收窄到 build-profile.json5 声明的模块根；T2 evidence 改由 check-testing 协调层统一写
  （install provider 装前算 full hash 并回传、holder 保存完整 install result 而非合并的
  installPassed、写入门槛=既有 MAISON_GOAL_GATE_HARNESS=1+身份完整+executed&&ok+写前复算
  hash 一致）；强装复用**既有** HARNESS_DEVICE_TEST_FORCE_INSTALL（无新机制）；T3 补
  hmos-app init/addendum 的 .gitignore 指引（profile 专属，非 canonical）。
  v12（九轮 review，设计判定通过，三项实施前收口）：① a7 基线勘误——1d637ac7 后仍有
  未提交追补（device-policy 门/run-unit/多个 SKILL/confirmation-registry/OpenSpec tasks，
  其中 run-unit 与 device-testing SKILL 与本 plan T1/T3 直接重叠），实施顺序改四步=完成
  验收 a7 追补→单独提交→归档 device-readiness-and-completion 并提交→建 d9 delta 开工；
  ② 冻结 env 注入前对两键分别 deleteEnvKeyCaseInsensitive 再写唯一大写键（现仅
  GATE_HARNESS/HEADLESS 有此处理，Windows 大小写变体会留双键）+ mixed-case 单测；
  ③ evidence 写入门槛补 deviceTestRunExecuted===true 与 hylyreTracePath 非空，trace_path
  直取本轮 holder.hylyreTracePath（writer 禁调 authoritative resolver 找旧 trace，
  resolver 只供 collector 二次核验）。
  v13（十轮 review，纯文字收口）：Todo 3 与正文实施顺序同步为四步（旧"已提交/若 active
  先归档"表述会让实施者跳过 a7 追补直接归档）；OpenSpec 任务数不写死（实时 openspec list
  为准）；时间窗规则唯一化——written_at 进 evidence schema 作 collector 唯一裁决字段，
  文件 mtime 仅诊断，written_at 与 run meta 窗口须同落 harness_start～harness_end。
todos:
  - id: 1
    content: "T1 构建生成物误伤根治（分类降级，纯内容校验三判据）：快照三集合与 EXCLUDED_SEGMENTS 原样保留（生成物仍入快照、证据仍全）。goal-runner 在 diffProductSourceSnapshots 结果消费处逐项过 profile 分类器，三判据全中才降级：(a) **路径限定到声明的模块根（v11 P2 收窄）**：文件位置必须等于根 build-profile.json5 某个 modules[].srcPath + '/BuildProfile.ets'（宿主三个真实文件均满足；任意嵌套目录不得进例外），不再用宽松的 **/BuildProfile.ets glob；(b) 变化类型仅 added/modified（removed/type-changed 永远 violation）；(c) 盘上现内容为合法 hvigor 模板结构（四常量+兼容类，模板外零多余语句）且四常量值与**attempt 冻结配置**推导结果完全一致——HAR_VERSION=**该模块根**的 oh-package.json5 version、BUILD_MODE_NAME/DEBUG=冻结 buildMode（debug↔true 互相一致）、TARGET_NAME=该模块 targets（applyToProducts 匹配冻结 product），无显式 target 才回落 'default'；不做字节等值，解析常量比对值。**attempt 级配置冻结（v11 P1）**：resolveDeviceTestProduct/resolveDeviceTestBuildMode 读进程 env（HARNESS_DEVICE_TEST_PRODUCT/BUILD_MODE 是公开覆盖变量），agent 子进程内临时覆盖不会传回 runner——分类器若现场重解析会与 hvigor 实际生成漂移、复发误伤。goal-runner 在 attempt 开始时解析并冻结 {product, buildMode}，经 extraEnv 同发 agent 与 gate harness、直传分类器——三方同源；**注入前对 HARNESS_DEVICE_TEST_PRODUCT/BUILD_MODE 两键分别 deleteEnvKeyCaseInsensitive 再写唯一大写键（v12 P2：现仅 MAISON_GOAL_GATE_HARNESS/HEADLESS 有此处理——goal-runner.ts:775/agent-invoke.ts:857；父环境存在 Harness_Device_Test_Product 等大小写变体时 Windows 会留两个等价键，子进程读取不稳定），补 mixed-case 单测**；agent 无视冻结值自行覆盖属不受支持行为（文档/prompt 注明），产物与冻结值不符 → violation（fail-closed 即正确语义）。**不需要任何构建痕迹/账本**：即使 agent 手写出与 hvigor 完全相同的文件，内容无行为差异；真正危险的额外语句或错误常量值被 (c) 拦住（v7-v9 的 device-test-build.history.jsonl 及窗口内构建证据谓词整体删除）。全部降级项 → 新事件类型 testing_generated_file_change（透明记录文件清单，不 halt、不进终止态、receipt/journal/gate 照常）；任一判据不中 → 维持 violation；混合场景 → violation 事件 changed 只列真违规，生成物单列 generated_changed 字段。分类器为 profile 持有（profiles/hmos-app/harness/generated-source-classifier.ts），goal-runner 按 visual-diff-check 同款动态 require 消费，取不到 → 全部按 violation（fail-closed）。resume 终止态判据按事件 type 扫描，天然不消费新事件类型——补单测钉死。窗口语义不变：分类发生在 invoke 前后快照 diff 的消费处（violation 裁决时刻，早于 receipt/harness——两窗口拆分结论沿用）。单测（走 testing-integrity 的 a7f2e5d1 脚手架，设备门 seam 默认 READY(physical)；新 suite 须在 run-unit CORE_SUITES 注册）：合法生成三文件场景降级不 halt（宿主真实 BuildProfile.ets 内容为正例）；错误常量值/额外语句/removed/type-changed → violation；混合场景两清单齐全；仅降级事件的 run 可 resume；tree-kill 截断的半写文件 → (c) 不过 → violation（fail-closed 与今日一致，接受）"
    status: completed
  - id: 2
    content: "T2 真机缺陷接入既有回修环（只信正式 gate，强制安装消掉 provenance）：【正式 gate 流程】goal 模式 testing 的外层 gate harness 窗口内：device_test.build（保留既有 reuse——构建可复用）→ **强制 hdc install -r 当前 HAP**（复用**既有** HARNESS_DEVICE_TEST_FORCE_INSTALL 开关——testing-build-conventions.ts:29 已文档化、install.ts:68 已消费，仅 runner 注入 gate harness 子进程 env，无新机制；agent 自跑 check-testing 不带此 flag 走既有 reuse，其产物仅供参考；普通模式无 flag，reuse 优化零变化）→ device_test.run → **evidence 由 check-testing.ts 协调层统一写（v11 P1：不能笼统由 run provider 写——install result 知道 executed/ok 但无 full hash，run provider 知道 trace/cases 但不知道装机；现有 DeviceTestPipelineHolder.installPassed 把实装与复用合并，证不了 install_executed）**：最小接线=install provider 在调用 hdc install **前**计算 hapSha256Full 并回传（DeviceTestInstallResult 增字段）；pipeline holder 保存完整 install result（installExecuted/installOk/hapSha256Full，替代粗粒度 installPassed 作 evidence 输入——installPassed 的既有门禁消费不动）；build→install→run 全部完成后由 check-testing 统一写**覆盖式 device-test-evidence.json**（当前轮专用）：{schema_version, goal_run_id, attempt_id, device_target{serial,target_kind,session_id}（取 gate 进程 env 中 a7 就绪门冻结注入的设备身份）, hap_sha256_full, install_executed, install_ok, trace_path, **written_at**, cases[]}；**写入门槛（v12 补全）**：既有 MAISON_GOAL_GATE_HARNESS===1（goal-runner.ts:775 已注入 gate 专属）+ 轮次身份完整 + install executed===true && ok===true + **deviceTestRunExecuted===true 且 holder.hylyreTracePath 非空**（安装成功但本轮 run 在产出 trace 前失败 → 不写 evidence，防误用历史 trace）+ **写前复算当前 HAP hash 与装机前一致**（不一致不写，collector 走 unverified——两次内存 hash，非账本）。**trace_path 直取本轮 holder.hylyreTracePath——writer 禁自行调 authoritative resolver 找 trace**（resolver 只供 collector 二次核验两者一致）；**时间窗规则唯一（v13 消除歧义）**：collector 的可信裁决字段是 evidence 的 written_at（schema 正式字段，writer 写入时刻），文件 mtime 仅用于诊断日志、不参与裁决；written_at 与 run meta 的 run_started_at/run_ended_at 必须全部落在本 attempt 同一 harness_start～harness_end 窗口内。**防伪最小化（非账本）**：runner 在 spawn gate harness 前先删除该文件，harness 结束后文件存在且身份匹配 = gate 所写（agent 已于 invoke 结束退出，窗口内无其他写者）；collector 校验 goal_run_id/attempt_id 精确相等 + device_target 与当前 attempt 冻结元组（runner 内存直传，禁从事件反推）精确相等 + install_executed && install_ok + trace_path 与 resolveAuthoritativeHylyreTracePath 一致 + 时间窗落在本 attempt 的 harness 窗口（harness_start/end 事件带 invoke_id）。任一不满足 → unverified。**身份接线核实**：runHarnessPhase 已接收 {runId, attemptId}，实施时核实透传到 provider 进程 env（MAISON_GOAL_RUN_ID/MAISON_GOAL_ATTEMPT），否则 evidence 身份为 null、回修环静默失效。【cases[] 合成（join 算法与归因不变，沿用 v4-v6 定稿】failure_artifacts 子句严格解析 → basename 防逃逸 → case/step 一致 → 选中派生计划查 step 定义，缺失/多义/冲突 unjoinable 禁猜；classification 四分类：product_actionable 三条件（selector 归 spec 锚点推导 expected screen + 失败 UI dump 命中该屏其他 identity 锚点 + 仅目标 selector 缺失/形态不满足）；environment 只消费结构化 RunFailureKind（device_locked/device_disconnect 已在 Hylyre 链）与 install diagnosis kind，per-case 无结构化来源归 unknown 禁扫散文；selector 无 spec 依据 → test_contract。**仅 device_target.target_kind==='physical' 且 classification===product_actionable 进 ActionableDefect 回 coding**；emulator/unknown/null 一律 unverified（设备无关缺陷判据显式范围外）。【collector 扩输入】ActionableDefect.source 增 'device_test'；根故障三分复用 parseTestCaseFlowBlock+triageCascade（级联 BLOCKED_BY 不产缺陷）；指纹=case_id+失败step+selector 规范化哈希进既有 roundFingerprintOf 无进展熔断；unverified 通路泛化（entries 增 source，retry/halt 文案按 source 分支；事件名 unverifiable_must_fix 保留）；device_toolchain/external_block 不产缺陷；gap-notes/test-report 仅供人读。消费面零新增：进既有 actionableDefects → backtrack_to_coding → 注入 coding prompt（核对 backtrackCodingContext 文案 source 无关化）。单测（走新脚手架；RunHarnessFn 注入缝不含 deviceEnv——扩缝或抽纯函数断言 child env）：宿主完整 trace fixture 三集合精确断言——根 === {TC-001, TC-007}、级联 === {TC-002,003,004,006,008}（TC-006 经通过的 TC-005 传递级联，triageCascade transitive 实证）、product_actionable === {TC-001}（step-9 dump 实证三条件齐备）、TC-007 → test_contract（by_text 不在 ui-spec）、**注入 coding 数 === 1**；join 多义只认 failure_artifacts 指名 step-9；正式 gate 强装当前 HAP（flag 在场 → reuse 被跳过）；安装失败 → environment 不回 coding；身份/元组/hash/窗口任一不匹配 → unverified；agent 伪造 evidence（gate 前预写）被 pre-delete 消除；普通模式无 flag → reuse 行为与现状零差异；两轮同集合指纹 → 既有熔断"
    status: completed
  - id: 3
    content: "T3 契约面与文档对齐 + 宿主回归：① OpenSpec delta：新事件 testing_generated_file_change、ActionableDefect 三源、unverifiable_must_fix payload 泛化、终止态语义不变声明、device-test-evidence.json schema（单一产物；覆盖式+当前轮专用+gate 单写者语义+pre-delete 防伪）、强制安装 env flag 语义、普通模式零变化声明；**前置四步（与正文实施顺序一致，勿跳步）**：完成并验收 a7 追补（1d637ac7 后未提交部分）→ 单独提交这些补丁 → 归档 device-readiness-and-completion 并提交归档（该 change 当前 complete 但仍 active；任务数持续变化，实施时以 openspec list 实时结果为准、不以 plan 内数字为据）→ 创建 d9 delta；② VISUAL_GAP_RETRY_GUIDANCE_TESTING 第 3 条文案补'framework harness 触发的构建生成物（如 device_test.build 重写的 BuildProfile.ets）由 runner 自动分类为合法副作用，不算违规'；device-testing SKILL/profile-addendum 同步（含 v11：agent 内临时覆盖 HARNESS_DEVICE_TEST_PRODUCT/BUILD_MODE 不受支持的声明）；**hmos-app 专属 init/addendum 补 .gitignore 指引**（建议宿主加 `**/BuildProfile.ets`，profile 级测试钉住；不进所有项目通用 canonical patterns；保留说明：.gitignore 解决 Git 污染、T1 分类解决快照误伤，两者不互替）；③ docs/overview.md 门禁表更新；MAINTAINER-CHANGELOG 经 scripts/gen-changelog.mjs 生成；④ 宿主回归（双轨惯例）：preflight——宿主 framework.local.json 无 device 配置，先 device:policy 选定受控路径（人工保持解锁/凭据授权/模拟器 fallback）；physical attestation（a7 R11）校准须先完成（unknown 下 T2 缺陷全 unverified、backtrack 验收无从发生；模拟器路径只能验 T1）。新开完整 run（含 coding→review→ut→testing），**验收判据用事件断言且分支化、不得用 run 终态 COMPLETED**（a7 t2 设备真实性封顶下未校准宿主终态 PARTIAL 属预期）：invoke 内确有 BuildProfile 变化 → 必须 testing_generated_file_change 且无 violation；R7 skip/构建仅发生在 gate 窗口 → 只要求无 violation（generated 事件路径由受控集成测试保证）；正式 gate 强装 → evidence.json 身份齐备 → hc_bank_row_cmb 缺陷（product_actionable+physical）→ backtrack_to_coding 自动回修"
    status: completed
---

# testing 写保护误伤与真机缺陷回修缺口 (d9e4b7c1)

状态：**已完结（2026-07-29）——T1/T2/T3 全部落地并提交（e60b4ca0），宿主真机回归通过。**
框架侧：typecheck ✓ / unit 2682 / fixtures 44 / openspec 45 / plan gate PASS。
**宿主回归（run 20260729T123155Z-0c5411，真机 3UJ0225321000395）三项验收全过**：
① 生成物分类——4 个模块根 BuildProfile.ets 降级为 testing_generated_file_change（带冻结
product/build_mode），**全 run 零 testing_write_violation**，07-28 原事故形态消除；
② gate 强装 + evidence——install_executed/ok=true、身份与 physical 元组齐备、64 hex sha、
written_at 在窗口内；③ **归因完整性**——trace 5 失败（TC-006/007/008/010/011）与 evidence
cases 集合完全一致（零漏项，join 链正常），分类全部落 test_contract。
**⚠ 该分类结果已被后续核查证伪为误判（勿再引用旧表述）**：TC-010/011 的 dump 里
`sheet_scaffold-next` 实际**存在**且 `enabled=false`，测试等的是被解析器丢弃的 `enabled:true`
谓词——属"元素在、状态不对"（应 product_state），不是"测试自造 selector"。只有 by_text 侧
（`查看全部` vs spec `查看全部银行`）确为测试文案不精确，test_contract 判定对。
**故本 plan 的验收边界要说清**：d9 的机制交付（join 链 / 身份绑定 / 生成物白名单 / 集合一致性
/ 强装 / evidence schema）**验收通过**；**归因判据的精度不在 d9 范围，已移交 plan e3c7d95f**
（三环缺口：谓词被丢弃 / 分类器不看 dump 实际状态 / 锚点 semantic 段与 ui-spec node 无互认）。
附带收获：R11 physical attestation 在该机型通过（target_kind=physical）。
**残留（已知边界）**：product_actionable→backtrack 真机通路本轮未触达——**原因不是"产品没
缺陷"而是"真缺陷被 test_contract 误判掩盖了"**（DEF-001/002 经 2026-07-30 人工采证确认为
产品侧缺陷：手动输入 123456 后按钮仍不可点击）；该通路由单测覆盖（device-test-backtrack +
testing-integrity T2-2 全链 E2E）。test_contract 类失败无自动出路（不回 coding，retry 耗尽即
HALT），修测试计划需人/agent 介入。
实施记录：a7 OpenSpec change 已归档（归档时修正其两处 delta 误归 MODIFIED——
基线无对应头，实为 ADDED）；d9 change=testing-generated-source-and-device-backtrack。
实施 review 两轮偏离与修补（最终语义以 OpenSpec delta 为准，本 plan 正文不重写）：
① evidence 缺失语义定稿=「缺文件=无 device 信号」（Todo 2 的"hash 不一致不写、collector
走 unverified"过时——上游 install/run 失败由其门禁裁决；**真实安装+run 已成功而
compose/写盘失败 → device_test_evidence BLOCKER FAIL**，不静默）；② 兼容类四成员必须
齐全；③ 多个 failure_artifacts 子句一律 unjoinable；④ 分类器/conventions 从
resolvedProfile.profileDir 加载（复用 run 开始的单一判定时点，不二次 load——loader
失败回退 hmos-app 会复活错误例外）。**

## 事故定性（多方调查交叉验证，全部 ground-truth 核实）

宿主 bc-openCard run `20260728T031459Z-e19c6b`，testing agent 正常跑完（exit=0）后被写保护
拦停，run 终止且拒绝 resume（`--force-resume` 不可绕过，设计使然）。

**时间线（UTC）**：08:03:35 testing agent 启动 → 08:18:01 三个 `BuildProfile.ets` 被 hvigor
`CreateHarBuildProfile` 任务重写（日志实证：CommFunc/CommUI/AccountManager 执行，
FinancialCard/WalletMain UP-TO-DATE——故恰好三个文件）→ 08:18:08 HAP 构建完成 →
08:25:32 `testing_write_violation`（events.jsonl:270，changed 恰为三个 modified
BuildProfile.ets）→ HALT。

- **不是 agent 改码**：写入者是 hvigor。构建由 agent 在 invoke 内跑 harness 自检
  （`device_test.build` 门禁）触发——设计内工作流，副作用落在快照窗口内。缓存失效、切
  buildMode、清构建都会复发——结构性误伤。
- **不是宿主异常**：宿主 `.gitignore:12` 已含 `**/BuildProfile.ets`，但 v23 快照故意
  git 盲（纯 fs 递归哈希），不消费 .gitignore。
- **回修环缺口**：testing→coding 回修环存在（`backtrack_to_coding`）但输入面冻结为
  `visual_diff | crash` 两源，普通真机功能缺陷只会原地 retry 耗尽预算 HALT。
- testing 零源码写入的职责切分**本身不动**（07-24 事故教训）：testing 复现采证产缺陷，
  修码回 coding 走全门禁。

## 缺口 ①：构建生成物误判 → 纯内容校验三判据（T1）

`BuildProfile.ets` 是 hvigor 按编译变体在模块根生成的常量文件（HAR_VERSION /
BUILD_MODE_NAME / DEBUG / TARGET_NAME），落在产品层内；快照排除集只有构建输出目录段，
无"源树内生成文件"概念。

**安全性质的本质**（v10 简化的依据）：该文件的风险面只有两个——模板外的额外代码、错误的
常量值（会编译进 HAP 改变行为）。两者都由**内容校验**直接拦住：(c) 合法模板结构 + 四常量
值与项目配置推导结果逐值一致。**"谁写的"不构成风险**：与 hvigor 输出逐值一致的文件没有
行为差异——因此 v7-v9 为追溯"确由构建产生"而设计的 device-test-build.history.jsonl 与
窗口内构建证据谓词是冗余防线，整体删除。

方案取舍（沿用早期结论）：否决全局排除（留后门）；否决 runner pre-invoke 构建前移（新
编排面且不根治）；采纳 diff 消费层分类降级（快照采集不动，Auto-match over fail：降级 =
新事件 `testing_generated_file_change` 透明记录，不 halt、不进终止态；resume 拒绝按事件
type 判定，天然不受影响）。removed/type-changed 永远 violation。

## 缺口 ②：真机缺陷回修 → 正式 gate 强制安装 + 单一 evidence（T2）

**v10 简化的核心**：原问题不需要证明"设备历史上每次安装状态"，只需要证明"**本次 runner
正式 testing gate 测试前，当前 HAP 确实重新安装到了当前设备**"。强制安装把证明从一套
状态推理（v7 链式核验 → v8 最后一行 → v9 最后有效状态 resolver，三轮 P0 各毙一版）变成
一次动作：

```
testing agent 自检          ← 产物仅供参考
    ▼
runner 正式 gate（harness 窗口，runner 单写者）
    ├─ device_test.build（保留既有 reuse）
    ├─ 强制 hdc install -r 当前 HAP（env flag 仅 gate 有）
    ├─ device_test.run
    ├─ 合成覆盖式 device-test-evidence.json（身份+设备元组+full hash+trace）
    └─ collector 立即消费 → product_actionable(physical) → backtrack_to_coding
```

- **覆盖式即可**：evidence 当前轮写、当前轮消费，无跨轮信任需求——append-only 账本、
  event 引用/作废、跨 attempt 回溯全部不需要。
- **防伪最小化**：runner spawn gate 前删除 evidence 文件；harness 结束后存在且身份/元组/
  hash/窗口匹配 = gate 所写（agent 已退出，窗口内无其他写者）。不引入 nonce/账本。
- **TOCTOU 由"强制安装 + 前后 hash 一致性"在 gate 窗口内闭合**（v11 措辞收敛，不作
  "消失"的过强表述）：install 前算 full sha，evidence 写前复算一次，不一致不写 evidence
  → collector unverified。两次内存 hash，非账本。
- **成本**：正式 gate 每次多一次 `hdc install -r`（秒级）；普通模式与 agent 自检保留既有
  reuse 优化，零变化。
- 归因与 join 的既有定稿全部保留：failure_artifacts 严格 join 禁猜、product_actionable
  三条件（spec 锚点 + expected screen 他锚点命中 + 仅目标缺失）、environment 只消费
  结构化 RunFailureKind、仅 physical 回 coding、根/级联三分、指纹进既有无进展熔断、
  unverified 通路泛化（事件名保留）。

## review 处置简表（七轮，全部先对 ground-truth 核实）

| 轮次 | 要点 | 归宿 |
|---|---|---|
| 1-3 | 版本 3.0.0；trace 无结构化字段→provider 合成；removed 不降级；权威 trace resolver；两窗口拆分（T1=invoke/快照窗口，T2=gate 窗口）；product_actionable 三条件；fixture 三集合精确（根 {TC-001,TC-007}/actionable {TC-001}/注入数 1） | 全部沿用 |
| 跨plan | a7 交叉：environment 用结构化 kind；测试走新脚手架+扩 RunHarnessFn 缝；宿主 preflight（device:policy+R11 校准）；验收分支化+事件断言 | 全部沿用 |
| 4-6 | install provenance：三重哈希→链式核验→最后一行→最后有效状态 resolver，三轮 P0 各毙一版 | **v10 整体删除**——正式 gate 强制安装消掉问题本身 |
| 7 | 过度设计判定：不需要历史账本，只需"gate 测试前刚装过"；T1 不需要构建痕迹 | v10 简化定稿 |
| 8 | P1 分类配置漂移（PRODUCT/BUILD_MODE 公开 env 覆盖不回传 runner，实证 conventions.ts:7/15）→ attempt 冻结三方同源；P1 evidence 须协调层写（installPassed 合并实装/复用实证 :1569，MAISON_GOAL_GATE_HARNESS 已存在 :775，FORCE_INSTALL 已存在 :29/:68）；P2 路径收窄到声明模块根；P2 hmos addendum 补 .gitignore 指引；TOCTOU 措辞收敛 | v11 全部吸收，无结构扩张 |
| 9 | 设计判定通过。P1 a7 基线勘误（git status 实证：1d637ac7 后 device-policy 门等追补未提交，run-unit/SKILL 与 T1/T3 重叠）；P2 冻结 env 大小写清理（deleteEnvKeyCaseInsensitive 现仅两键，实证 :775/:857）；P2 evidence 门槛补 run executed + trace_path 直取 holder、时间窗数据源钉死 | v12 全部吸收；实施顺序四步定稿 |
| 10 | 纯文字收口：P1 Todo 3 残留旧顺序与正文四步冲突（todo 才是实施消费面）；P2 written_at 未进 schema、与 mtime 关系未定义 | 本版（v13）：Todo 3 同步四步+任务数不写死；written_at 入 schema 作唯一裁决字段、mtime 仅诊断、三时点同窗 |

**过度设计教训（记入 simplicity-is-king）**：一条规则连续多轮被 P0 打掉又补，应当质疑的
是"这套证明是否必要"，而不是继续把规则修得更精巧。信任问题优先用"把动作放进可信执行者
的窗口里"（gate 强制安装）消除，而不是用"给不可信窗口建审计账本"证明。

## 与 a7f2e5d1 的关系（v12 勘误：基线尚未冻结）

**1d637ac7 不是当前完整基线**（九轮 review 实查勘误）：其后工作区仍有一批未提交的 a7
追补——device-policy 门（skills/reference/device-policy-gate.md + 新测试）、
harness/tests/run-unit.ts、skills/feature/device-testing/SKILL.md、goal-mode SKILL、
confirmation-registry.yaml、OpenSpec tasks（complete 但 change 仍 active；任务数持续
变化，实施时以 openspec list 实时结果为准，不写死数量）。其中
**run-unit.ts 与 device-testing SKILL.md 与本 plan 的 T1/T3 直接重叠**。

**实施顺序（v12 定稿，四步）**：① 完成并验收当前 a7 后续补丁；② 单独提交这些补丁；
③ 归档 device-readiness-and-completion 并提交归档；④ 创建 d9 OpenSpec delta、开始实施。

仍相关的技术事实：设备就绪门在 invoke 前（BLOCKED 不进 T1）；violation 裁决早于 harness
（两窗口拆分依据）；R7 skip 时 gate 构建在快照窗口外（T3 分支验收依据）；
`RunFailureKind.device_locked` 已在 Hylyre 链；deviceEnv/身份经 extraEnv 与
runHarnessPhase 注入；testing 结论封顶（未校准宿主终态 PARTIAL 属预期）。**悬置依赖**：
physical attestation（R11）校准在宿主回归完成前，T2 的 backtrack 宿主验收无从发生（判
unknown → 全 unverified）——T3 preflight 已列。

## 范围外（明确不做）

- 不动快照采集范围/算法；不做 pre-invoke 构建前移；不消费 .gitignore；
- 不扩 Hylyre wheel trace schema；不信任 gap-notes/test-report 作回修输入；
- **不建任何安装/构建历史账本**（v7-v9 全套：两张 history.jsonl、resolver、event 引用、
  作废规则、TOCTOU 双点哈希、跨 attempt 回溯——除非未来出现"必须跨轮信任"的真实需求）；
- 设备无关缺陷（emulator/unknown 上的 product 缺陷）判据不在本 plan；
- 普通模式行为零变化（install reuse 保留；无 goal 身份的 evidence 永不作证）；
- 当前宿主 run 属终止态：修复发布后新开完整 run（含 coding），三个 BuildProfile.ets
  无需还原。

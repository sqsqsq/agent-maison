---
name: testing 写保护误伤与真机缺陷回修缺口 — 生成物分类降级 / device_test 接入回修环
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户控版本，不 bump）。
overview: >
  2026-07-28 宿主 bc-openCard run（20260728T031459Z-e19c6b）testing 阶段 HALTED
  (testing_write_violation) 复盘定性：不是 agent 改码，也不是宿主异常，而是两个 framework
  缺口。① 误伤：hvigor 构建任务 CreateHarBuildProfile 在 invoke 窗口内合法重写模块根的
  BuildProfile.ets（构建生成物），被纯 fs 快照写保护误判为"agent 改产品源码"，且该违规是
  run 终止态（拒 resume），一中招整 run 报废；② 缺口：本轮真实缺陷（真机缺 hc_bank_row_cmb
  元素、trace 确定性失败）没有任何自动回 coding 的通路——collectActionableDefects 只消费
  visual_diff 与 crash 两源，普通真机功能缺陷只会在 testing 原地 retry 耗尽预算再 HALT。
  修法遵循既有哲学：非关键冲突不 halt（自动分类+透明记录）；不新建状态机（回修复用既有
  backtrack_to_coding / roundFingerprint 熔断）；testing 零源码写入的职责切分本身不动。
  v2：review 一轮修订——版本对齐 3.0.0；attempt 级不可覆盖构建史；removed/type-changed
  永远 violation；值可推导等值；provider 合成 device-test-defects.json；权威 trace
  resolver；unverified 泛化；OpenSpec delta。
  v3：review 二轮修订——两个新产物带 schema_version + goal_run_id + attempt_id 强身份
  （复用既有 MAISON_GOAL_RUN_ID/MAISON_GOAL_ATTEMPT 注入）；device 缺陷三重 HAP 等值绑定
  （defects.build_fingerprint === installMeta.hapSha256 === currentBuildFingerprint）；
  failure_artifacts join 算法写死（禁猜）；机器归因分类 product_actionable 白名单才回
  coding；attempt 窗口定义为完整 phase attempt（含 gate harness 窗口）；fixture 断言
  精确集合。
  v4：review 三轮修订——两类证据窗口拆开（T1 分类在 violation 裁决时刻运行，其时
  harness_end 尚未发生：T1 窗口=invoke 窗口即快照窗口本身；T2 窗口=invoke_start → 同
  invoke_id 配对的 harness_end，裁决安全时序不动）；product_actionable 升级为 screen
  语境三条件（expected screen 命中其他 identity 锚点 + 仅目标 selector 缺失，防导航错
  页误回 coding）；fixture 拆三集合精确断言（根 {TC-001,TC-007} / actionable {TC-001} /
  TC-007 归 test_contract——其 by_text 不在 spec SSOT，注入 coding 数 === 1）。
  v5：a7f2e5d1（设备就绪与阶段完成判定，本地已实施未提交）交叉影响分析——**无方案级
  冲突**，五处对齐性修订：T2 environment 分类消费 t1 结构化 HdcFailureDiagnosis（不自造
  子串匹配）；T2 补 gate harness 侧 provider 进程的 run/attempt 身份注入核实；单测须走
  testing-integrity 新脚手架（设备门 seam 默认 READY(physical)）；T3 宿主回归判据改为
  事件断言（t2 设备真实性封顶在未校准 attestation 的宿主上会把终态压为 PARTIAL，属预期）；
  实施顺序=a7f2e5d1 先提交、本 plan 其后（plan 内行号为写作时快照，实施以锚文本定位）。
  v6：codex 跨 plan 评估四 P1 回填——defects.json 补 device_target{serial,target_kind,
  session_id} 绑定 a7 冻结设备元组，actionability 按 target_kind 分政策（仅 physical 可
  product_actionable；emulator/unknown 一律 unverified，设备无关缺陷判据显式范围外）；
  environment 判据改消费 run 级结构化 RunFailureKind（device_locked 已存在），per-case 无
  结构化来源诚实归 unknown 禁重扫散文；T3 宿主验收分支化（invoke 内有生成物变化才要求
  generated 事件，R7 skip/仅 gate 构建只要求无 violation）+ 宿主 device policy preflight
  前置；RunHarnessFn 注入缝扩 deviceEnv（防设备身份透传假绿）；T1 边缘补 history 行
  未落盘/尾行截断同样 fail-closed；OpenSpec 先归档 a7 change 再建 d9 delta。
  v7：P0 安装 provenance 补链——install meta 是覆盖式自证（无 run/attempt/设备身份、
  reused:true 仍从本地 HAP 现算 hapSha256、且只截 12 hex），三重哈希等值证不了"冻结设备
  上装的就是这个二进制"。新增 device-test-install.history.jsonl（append-only 第三账本，
  行含完整 64 hex hap_sha256_full + device_target + executed/reused/ok）。12 hex 的既有
  消费者不动。
  v8：P0 五轮收口——"曾装过"≠"当前仍是"（先装 A 再装 B 后本地切回 A，旧 A 行仍在但设备
  跑 B）。当前性单一规则取代 v7 链式核验：product_actionable 只认**本 attempt 内、同
  serial、trace 开始前的最后一条安装行 L**，且 L 须为实际安装成功（executed && ok）且
  L.full_sha === defects.full_sha === 当前本地 HAP 现算值；L 之后 trace 前任何同 serial
  安装事件作废旧行；跨 attempt 历史一律不作 actionability 依据。配套**自动 provenance
  bootstrap**：install provider 复用判定消费本账本，本 attempt 无自证行即真实安装（宿主
  首跑默认路径可过，不需手动 force-install）。closed-world 诚实声明：外部安装（用户/
  DevEco 框架外覆盖装）不可观测，残余风险显式写入 OpenSpec。补 H1→H2 作废反例 fixture；
  OpenSpec 契约补第三账本全套；字段名漂移统一（build_fingerprint_full；产物字段
  snake_case，覆盖式 meta 的 installDiagnosisKind 不动、注明映射）。
  v9：六轮 review 收口三件——① P0"最后一行"自冲突（agent 自检实装 → 外层 gate 合法
  reuse 是设计内主流程，reuse 行 executed=false 会把可信安装自行作废）：改"最后有效设备
  状态"纯 resolver（尾部回溯：同 full sha 成功 reuse 透明引用 based_on；最近设备变更行
  必须实际安装成功且 sha 等值；失败/卸载/device_target 元组变化/sha 变化 → 失效；比对
  完整元组非仅 serial），账本行增 operation_kind/install_event_id/based_on_install_event_id，
  provider 复用判定与 collector 共用同一 resolver；② 非 goal 模式边界：bootstrap 仅在
  run/attempt 身份都非空时启用，普通模式保留现有 reuse 策略（无行为变化），null 身份行
  仅 audit、永不为 goal 作证；③ TOCTOU：full sha 在 hdc install 前后各算一次，不等 →
  该行 provenance 无效（staging 不可变副本作为未来加固记录，不入本 plan）。
todos:
  - id: 1
    content: "T1 构建生成物误伤根治（分类降级，不动快照采集）：快照三集合与 EXCLUDED_SEGMENTS 原样保留（生成物仍入快照、证据仍全）。【生产端先行：可信构建痕迹】device-test-build provider 新增 attempt 级不可覆盖构建史 device-test-build.history.jsonl（append-only，每次调用一行：{schema_version, goal_run_id, attempt_id, timestamp, reused, hvigorExecuted, resolvedBuildMode, resolvedProduct, hapPath}；goal_run_id/attempt_id 取自既有 MAISON_GOAL_RUN_ID/MAISON_GOAL_ATTEMPT 注入，非 goal 语境写 null）——现有 device-test-build.result.json 固定文件名会被后续 reuse 调用覆盖（本次现场实锤：终态 reused:true/hvigorExecuted:false，早先真实构建痕迹被洗掉）；hvigor meta payload 通用补 timestamp 字段，device-test-build 经既有 metaExtras 传入 resolvedBuildMode/resolvedProduct。【裁决层分类】goal-runner 在 diffProductSourceSnapshots 结果消费处逐项过 profile 分类器，降级仅限 how∈{added,modified}（removed/type-changed 永远 violation——agent 可先合法构建产生痕迹再删文件），三谓词全中才降级：(a) 路径命中 profile 声明的生成物模式（hmos 首批仅 **/BuildProfile.ets）；(b) 盘上现内容形状白名单（hvigor 模板四常量+兼容类，模板外零多余语句）且常量值与可推导期望等值——HAR_VERSION=该模块 oh-package.json5 version、BUILD_MODE_NAME=构建史行 resolvedBuildMode、DEBUG=(mode==='debug')、TARGET_NAME 推导源写死=根 build-profile.json5 modules[].targets（applyToProducts 匹配当前 resolvedProduct），无显式 target 才回落 'default'（不做字节等值，hvigor 版本间模板注释措辞可能漂移）；(c) **invoke 窗口**（agent_invoke_start → agent_invoke_end/post 快照时刻——即快照窗口本身；分类器在 violation 裁决时刻运行，其时本 attempt 的 harness_end 尚未发生，禁引用）内 history.jsonl 存在 hvigorExecuted:true、buildMode 与 (b) 一致、且 goal_run_id/attempt_id 与当前 run/attempt **精确相等**的行（null 或不等一律不匹配——手工并发/时间重叠不得串证据）。被分类的文件变化本就发生在快照窗口内，产生它的构建也必然在窗口内——两窗口天然同构，无覆盖缺口；裁决安全时序不动（真源码污染仍在 receipt/journal/gate 之前拦截）。已知边缘（接受，两种形态都 fail-closed）：a7f2e5d1 t4 完成观测收口的 tree-kill 可能 ① 截断进行中构建产生半写 BuildProfile.ets → (b) 内容校验不过 → violation；② BuildProfile 已写完但 history 行尚未 append 或尾行被截断 → (c) 无窗口内有效构建史行 → violation——两者均与今日行为一致，不是本 plan 的回归；history.jsonl 读取只解析完整合法行（残行跳过不视为存在）。全部降级项 → 新事件类型 testing_generated_file_change（透明记录文件清单+证据引用，不 halt、不进终止态、receipt/journal/gate 照常）；任一谓词不中 → 维持 violation；混合场景 → violation 事件 changed 只列真违规，生成物单列 generated_changed 字段。分类器为 profile 持有（profiles/hmos-app/harness/generated-source-classifier.ts），goal-runner 按 visual-diff-check 同款动态 require 消费，取不到 → 全部按 violation（fail-closed，行为与今日一致）。resume 终止态判据（goal-runner.ts:3724 按事件 type）天然不消费新事件类型——补单测钉死。单测（须走 goal-runner-testing-integrity 的 a7f2e5d1 新脚手架——设备门 seam 已默认注入 READY(physical)，避免就绪门把用例整体降级；**RunHarnessFn 注入缝现签名不含 deviceEnv（goal-runner.ts:678，8 参）——扩缝或抽纯函数断言 child env，否则设备身份透传无法被测试覆盖=假绿**）：hvigor 合法生成三文件场景（降级+不 halt+gate 照常，宿主真实 BuildProfile.ets 内容为正例 fixture）；reuse 覆盖 result.json 后仍凭 history 行降级（本次现场形态回归）；跨 run/attempt 的 history 行不作证据（id 不等 → violation）；篡改场景（模板外语句/常量值与推导期望不符/无窗口内构建史行 → violation）；removed/type-changed → violation；混合场景；resume 不受降级事件影响"
    status: pending
  - id: 2
    content: "T2 普通真机确定性缺陷接入既有回修环（生产端契约先行，扩输入不建状态机）：【生产端：机器拥有的结构化缺陷】现有 HylyreTraceCase 只有 id/status/priority/ac_ref/notes（device-test-run.ts:65），selector/step 塞在 notes 散文与 artifact 文件名里。不扩 Hylyre wheel 的 trace schema（跨发布依赖重），由 provider（device-test-run.ts，机器侧）在 run 结束合成 device-test-defects.json：{schema_version, goal_run_id, attempt_id, **device_target: {serial, target_kind, session_id}**（取 provider 进程 env 中 a7f2e5d1 就绪门冻结注入的设备身份——实施时以 deviceEnv 实际键名为准，如 HARNESS_HDC_TARGET；缺失写 null）, trace_path, build_fingerprint_full(=完整 64 hex HAP sha256——install meta 的 hapSha256 只截 12 hex 且 reused:true 时仍从本地 HAP 现算、属覆盖式自证，不作绑定依据；12 hex 的既有消费者如 visual-diff evaluated_build_fingerprint 不动), cases[]}。**生产端第三账本 device-test-install.history.jsonl**（append-only，与 build history 同款模式；provider 每次安装/复用判定各追加一行）：{schema_version, goal_run_id, attempt_id, device_target{serial,target_kind,session_id}, **operation_kind: install|reuse|uninstall, install_event_id, based_on_install_event_id**(reuse 行引用其依据的实际安装行), **hap_sha256_full_pre / hap_sha256_full_post**(v9 TOCTOU：hdc install 前后各算一次——现实现只在安装后写 meta 时算（install.ts:135），存在"安装中 HAP 被 hvigor/DevEco 并发重建 → 史行记到新内容而设备装的是旧字节"竞态；前后不等 → 该行标 provenance_invalid 不可作证；sha 命名 staging 不可变副本记为未来加固、不入本 plan), bundle, version_code, version_name, executed, reused, ok, install_diagnosis_kind, timestamp}——executed:true & ok:true 且前后 sha 一致的 install 行是"该 serial 上实际装入该二进制"的唯一可信证据。**自动 provenance bootstrap（v9 边界收窄：仅 goal 模式）**：goal_run_id 与 attempt_id **都非空**时，install provider 的复用判定消费本账本（判定逻辑=与 collector 共用的同一纯 resolver，见下）——本 attempt 无有效安装状态时不复用、执行真实安装；**非 goal 模式（check-testing 双模式共享此 provider）保留现有 reuse 策略零变化**，history 行照写但身份为 null、仅 audit，**null 身份行永不为任何 goal attempt 作证**（null===null 不构成匹配）——与"普通模式无拉齐项"承诺一致。字段命名映射：新账本统一 snake_case（install_diagnosis_kind）；覆盖式 meta 的 installDiagnosisKind 与代码内存 install.diagnosis?.kind 保持原名不动，plan/OpenSpec 注明三者映射。**actionability 按 target_kind 分政策**：仅 device_target.target_kind === 'physical' 的缺陷允许进入 product_actionable → 回 coding；emulator/unknown/null **一律进 unverified**（本 plan 定位真机缺陷回修——与 a7f2e5d1 t2 "模拟器/未知不足以证明真机行为"同构；"设备无关缺陷"判据显式范围外，需要时另立）。collector 校验 device_target 与**当前 attempt 冻结的期望设备元组精确等值**（runner 内存中的 deviceEnv/deviceKindThisPhase 直接传给 collector，禁从"最新事件"反推）。**身份接线核实**：defects.json 可能由外层 gate harness 窗口的 provider 写出（权威 trace 常产于 gate）——runHarnessPhase 已接收 {runId, attemptId}，实施时核实该身份确实落到 provider 进程 env（MAISON_GOAL_RUN_ID/MAISON_GOAL_ATTEMPT），若未透传则补接线（否则 gate 窗口写出的 defects.json 身份为 null，collector 一律判不匹配、回修环永不触发）。【join 算法写死（禁猜）】宿主实锤：TC-001 的 failure_dir 同时存在 step-1/step-9/step-10 三组诊断文件且 JSON 顶层只有 UI tree 无失败标记，真失败步骤只能从 trace notes 的机器写入 'failure_artifacts: ui_dump=TC-001-step-9.json...' 子句解析——严格解析该子句 → basename 防逃逸（解析出的文件必须落在 failure_dir 内）→ 文件名的 case id/step index 与该 case 一致 → 在选中派生计划中查到该 step 的定义（selector/动作）；缺失、多义或冲突一律 unjoinable，**禁止按最大 step 或任意现存文件猜**。【机器归因分类】每条 case 带 classification：product_actionable 须**三条件齐备**（selector 属 spec 不足证——测试导航错页时合法 selector 自然不存在）：(i) selector 可归到 spec 声明锚点（ui-spec.yaml identity/锚点、acceptance checkpoint 的 by_id/by_text）且由此推导出 expected screen；(ii) 失败 step 的 UI dump 命中该 screen 的**其他** identity 锚点（确认真机确实在预期页面）；(iii) 仅目标 selector 缺失或形态不满足。environment 判据**只消费已存在的结构化来源**——testing 链的 run 级 RunFailureKind（device-test-run.ts:181，device_locked/device_disconnect 等已存在——注意 a7f2e5d1 t1 的 runDiagnosis 在 UT/Hvigor 链，Hylyre 链不可直接取）与 install.diagnosis.kind；run 级 environment kind 命中 → 该轮全部 case 归 environment；**per-case 无结构化错误来源时诚实归 unknown，绝不自行重扫散文**；selector 无 spec 依据（测试自造）或派生计划步骤与 spec 对不上 → test_contract；三条件不齐/其余 → unknown。**只有 product_actionable 白名单进 ActionableDefect 回 coding**；environment/test_contract/unknown 进 source-specific unverified/retry（防 runner 把测试脚本问题交给 coding、诱导 agent 改产品迎合错误测试）。【collector 扩输入】ActionableDefect.source 增 'device_test'（goal-runner.ts:1142 联合类型解冻为三源）；collectActionableDefects 新增 C) 支路只消费 defects.json：① trace 定位复用 resolveAuthoritativeHylyreTracePath（testing-trace-gates.ts:101，禁按目录名/mtime 取最新），defects.json 的 trace_path 必须与之一致；② 根故障三分复用 parseTestCaseFlowBlock + triageCascade——级联 BLOCKED_BY 不产生缺陷；③ 身份绑定：goal_run_id/attempt_id 与当前 run/attempt 精确相等 + attempt 窗口（同一 invoke_id 的 agent_invoke_start → 配对 harness_end——harness_start/end 事件已带 invoke_id（goal-runner.ts:5692 实证）；权威 trace 通常由 agent 返回后的外层 gate 生成，仅用 invoke 窗口会漏；collector 运行于 harness 之后故该窗口对 T2 可用，与 T1 不同）⊇ run_started_at/run_ended_at + **install provenance"最后有效设备状态"resolver（v9 P0 定稿，取代 v8"最后一行"——后者与合法 reuse 自冲突：agent 自检实装 E → 外层 gate 合法 reuse R(executed=false) → 取最后一行 R 必判 unverified，主流程直接失效）**：单一纯函数 resolver，provider 复用判定与 collector 共用（两边对"当前状态"的解释禁止漂移）。输入=本 attempt（goal_run_id/attempt_id 精确相等）、**完整 device_target 元组相等（serial+target_kind+session_id，不得只比 serial）**、timestamp < trace run_started_at 的行序列；从尾部回溯：成功 reuse 且 hap_sha256_full 与其 based_on_install_event_id 指向的实际安装行一致 → 透明层，继续回溯；遇到的**最近一条设备变更行**（operation_kind ∈ {install, uninstall}）必须是 executed && ok && 前后 sha 一致的 install 行，且其 hap_sha256_full === defects.build_fingerprint_full === 当前本地 HAP 现算 full sha；实际安装失败、uninstall、device_target 元组变化、sha 链不一致 → 此前证明全部失效；跨 attempt 历史一律不作数；**closed-world 诚实声明：外部安装（用户/DevEco 框架外覆盖同 bundle）不可观测——bm dump 无内容摘要，本规则是框架内闭世界证明，残余风险显式接受并写入 OpenSpec**；resolver 任一环不满足 → unverified（不阻断 testing 本身，由 bootstrap 保证 goal 默认路径存在有效状态）；④ 指纹 = case_id+失败 step+selector 规范化哈希，进既有 roundFingerprintOf 无进展熔断；⑤ 身份不齐/unjoinable/非 product_actionable/无 defects.json（旧 trace）一律进 unverified 通路。【unverified 通路泛化】entries 增 source 字段（visual|device_test），retry/halt 文案按 source 分支（现文案要求补 evaluated_screenshot_hash 对 device 源完全错误）；事件 type 名与 halt reason 保留 unverifiable_must_fix（审计连续性，review 已接受）。【护栏】device_toolchain/external_block 类失败不产生 device_test 缺陷；gap-notes.md/test-report.md 仍只供人读不作回修输入。消费面零新增：进既有 actionableDefects → backtrack_to_coding（goal-runner.ts:6719-6805）→ 注入 coding prompt → 重走 review/ut/testing；核对 backtrackCodingContext 注入文案对 source 无关化。单测：以宿主完整 trace 为 fixture（7 失败 1 通过）断言**三集合精确**——根故障 === {TC-001, TC-007}、级联 === {TC-002, TC-003, TC-004, TC-006, TC-008}（triageCascade transitive 分支实证：TC-006 经通过的 TC-005 传递级联到 TC-001）；归因：product_actionable === {TC-001}（step-9 dump 实证：hc_page_title 在场确认 add_card_home_collapsed、仅存 namespaced maison:bc-opencard:...:hc_bank_row_cmb、精确 hc_bank_row_cmb 缺失——三条件齐备）、TC-007 → test_contract/unknown（by_text '添加管理卡片' 不在 ui-spec.yaml/spec SSOT，实证只出现在 context/facts.md 与 nav 配置）；**注入 coding 缺陷数 === 1**（根故障数 ≠ 可回 coding 数）；级联不产缺陷；install provenance 当前性规则任一环不满足 → unverified；**provenance 专项验收（P0 四/五/六轮全集）：actual(X)→reuse(X)→trace **可 actionable**（v9 主流程回归——v8 规则在此必错）；actual(X)→失败 install→trace → unverified；actual(X)→actual(Y)→本地切回 X → resolver 不认旧 X 行、bootstrap 须重新实际安装；同 serial 但 session_id/target_kind 不同 → fail-closed（比完整元组）；device A 史行不得为 device B 作证；同 versionCode 不同 HAP 内容不构成绑定；reused:true + deviceVersionCodeParsed:0 且无本 attempt 实际安装行 → unverified（宿主现场 meta 作反例 fixture）；作废场景 H1(A,X)→H2(A,Y)、本地 HAP=X → unverified；null/null 身份史行不匹配任何 goal attempt；install stub 执行期间改写 HAP（前后 sha 不等）→ 该行 provenance_invalid → unverified**；bootstrap 场景：goal 模式本 attempt 无有效状态 → 真实安装产生自证行 → resolver 可满足；非 goal 模式 reuse 策略与现状零差异；跨 run/attempt id 不等 → unverified；join 多义（step-1/9/10 并存）只认 failure_artifacts 指名的 step-9；toolchain 失败不回退；test_contract/unknown 分类不回 coding；两轮同集合指纹 → 既有无进展熔断"
    status: pending
  - id: 3
    content: "T3 契约面与文档对齐 + 宿主回归：① OpenSpec delta（新事件类型 testing_generated_file_change、ActionableDefect.source 三源、unverifiable_must_fix payload 泛化、终止态语义不变的显式声明、device-test-build.history.jsonl、**device-test-install.history.jsonl**（v8：actionability trust root——schema 与字段约束、executed/reused/ok 精确定义、append-only+残行 fail-closed、当前性/作废规则、device_target 与 full sha 绑定、closed-world 外部安装声明、旧框架无 history 的兼容降级=一律 unverified）与 device-test-defects.json **三个**新产物 schema（含 schema_version/goal_run_id/attempt_id/device_target 身份字段）均属运行时契约，按既有 openspec/changes 惯例落 delta+tasks；**建 delta 前先归档 a7f2e5d1 的 device-readiness-and-completion change**（其 tasks 已全勾但仍 active——不归档则须显式声明 d9 基于该 active delta，取归档优先）；② VISUAL_GAP_RETRY_GUIDANCE_TESTING 第 3 条现文案'any write is a run-terminating violation'与 T1 后事实不符且有吓退 agent 触发 device_test.build 的真实风险——补'framework harness 触发的构建生成物（如 device_test.build 重写的 BuildProfile.ets）由 runner 自动分类为合法副作用，不算违规'——措辞准确性：构建是 agent 在 invoke 内调用 framework harness 的 device_test.build 触发的，不是 runner 触发；device-testing SKILL/profile-addendum 同步；③ docs/overview.md 门禁表更新；MAINTAINER-CHANGELOG 经 scripts/gen-changelog.mjs 生成（不手工编辑）；④ 宿主回归（双轨惯例）：**前置 preflight**——(i) 宿主 framework.local.json 现无 device 配置（实查仅 schema_version/agent_adapter/toolchain/vision）：先跑 device:policy 检查并选定受控路径（人工保持解锁 / 凭据授权 / 模拟器 fallback），否则真机一锁屏 readiness gate 就 BLOCKED，根本到不了本 plan 的验收点；(ii) **physical attestation 校准（a7f2e5d1 R11）须先完成**——未校准判 unknown，而 T2 政策下 unknown 缺陷一律 unverified，backtrack 验收无从发生；注意模拟器 fallback 路径同理只能验证 T1 不能验证 T2 回修。然后新开完整 run（含 coding→review→ut→testing——本轮已有真实产品缺陷，不能只重跑 testing），**验收判据用事件断言且分支化、不得用 run 终态 COMPLETED**：invoke 内确有 BuildProfile 变化 → 必须出现 testing_generated_file_change 且无 violation；R7 skip 或构建仅发生在外层 gate 窗口 → 不要求 generated 事件、只要求无 BuildProfile violation（generated 事件路径由受控集成测试单独保证，不依赖宿主碰巧触发）；hc_bank_row_cmb 类真机缺陷经 defects.json（classification=product_actionable、device_target.target_kind=physical）→ backtrack_to_coding 自动回修；**首个新版 run 额外验证 provenance bootstrap 与 reuse 透明层**：宿主既有覆盖式 meta（reused:true/deviceVersionCodeParsed:0）不再构成复用依据 → install provider 执行真实安装 → 账本出现 executed:true & ok:true & 前后 sha 一致的行 →（外层 gate 若合法 reuse，resolver 经 based_on 回溯仍判有效）→ 缺陷采集 → backtrack（默认路径即可过，无需手动 force-install）。宿主侧 .gitignore 已含 **/BuildProfile.ets（.gitignore:12，仅 git 卫生，与本修复无耦合，无需动）"
    status: pending
---

# testing 写保护误伤与真机缺陷回修缺口 (d9e4b7c1)

状态：**v9 — 六轮 review 全部吸收（终轮 P0：最后有效设备状态 resolver 取代"最后一行"，provider/collector 共用；非 goal 模式零变化；TOCTOU 双点哈希），待终审/开工授权；实施顺序=a7f2e5d1 完成真机校准与全量验收 → 冻结提交 → 归档其 OpenSpec → 本 plan 实施**

## 事故定性（双方调查交叉验证，全部 ground-truth 核实）

宿主 bc-openCard run `20260728T031459Z-e19c6b`，testing agent 正常跑完（exit=0，约 22 分钟）后
被写保护拦停，run 终止且拒绝 resume。

**时间线（UTC）**：08:03:35 testing agent 启动 → 08:18:01 三个 `BuildProfile.ets` 被 hvigor
重写（`hvigor-app-build.log` 明确记录 CommFunc/CommUI/AccountManager 三个模块的
`CreateHarBuildProfile` 任务实际执行，FinancialCard/WalletMain UP-TO-DATE——故恰好只有
这三个文件变化）→ 08:18:08 debug HAP 构建完成 → 08:25:32.334 `testing_write_violation`
（events.jsonl:270，changed 恰为这三个 `modified BuildProfile.ets`，无任何其他文件）→
08:25:32.335 HALT。

**结论**：
- **不是 agent 改码**：直接写入者是 hvigor 的 `CreateHarBuildProfile` 任务。构建由
  `check-testing.ts` 的 `device_test.build` 门禁（[device-test-build.ts](../../profiles/hmos-app/harness/providers/device-test-build.ts)
  → `runHvigorAssembleApp`）触发——agent 在 invoke 内跑 harness 自检是**设计内工作流**，
  构建副作用落在快照窗口内。构建缓存失效、切 buildMode/product、清理构建、输入时间戳
  变化都会让该任务重跑——结构性复发。
- **不是宿主异常**：宿主 `.gitignore:12` 早已忽略 `**/BuildProfile.ets`。但这**治不了本错**
  ——v23 快照是故意 git 盲的纯 fs 递归哈希（旧 git 实现对 gitignored 的需求 SSOT 半盲才
  重写），不消费 `.gitignore`。
- **是 framework bug，且有两个**：见下。
- 附带更正：此前会话里"还原后 `--force-resume`"的建议是错的——resume 拒绝按事件 type
  无条件判定（[goal-runner.ts:3724](../../harness/scripts/goal-runner.ts)），`forceResume`
  不参与；框架文案本身（"新开 run"）是对的。

## 缺口 ①：构建生成物被误判为源码篡改

`BuildProfile.ets` 是 hvigor 每次构建按当前编译变体（HAR_VERSION / BUILD_MODE_NAME /
DEBUG / TARGET_NAME）在**模块根目录**生成的常量文件——正好落在产品层目录内。快照排除集
（[product-source-snapshot.ts:57](../../harness/scripts/utils/product-source-snapshot.ts)）只有
`build/dist/node_modules/oh_modules/.hvigor/.idea/.git` 目录段，没有任何"源树内生成文件"
概念。**只要 testing invoke 内发生一次真实构建且生成内容与 invoke 前不同，必然误伤**。
现有单测也没有"hvigor 合法生成"这一场景。

### 方案取舍

- **否决：全局排除 `**/BuildProfile.ets`（快照剪枝或 .gitignore 消费）**。该文件的常量会被
  编译进 HAP（产品代码可读 `BuildProfile.DEBUG` 分支行为），agent 直接手改它可以改变产品
  行为——07-24 事故证明 agent 会干绝望的事。一刀切排除 = 留后门。
- **否决：构建前移到 runner 侧 pre-invoke（codex 方案 A 主体）**。新增一整条 runner 构建
  编排面（能力解析/失败处置/超时/与 reuse 判定的交互），且**不根治**：agent 侧 gate 构建在
  reuse 失效时（切 buildMode、clean、增量失效）仍会在窗口内重写生成物，误伤照旧。修判定层
  一次覆盖所有构建入口，符合"简单是王道"。
- **采纳：diff 裁决消费层分类降级（三谓词，见 Todo 1）**。快照采集原样不动（生成物仍入
  快照，证据链完整），只在 `diffProductSourceSnapshots` 结果的消费处分类。符合
  "Auto-match over fail"：非关键冲突自动匹配最合适解释 + 透明记录，halt 只留真冲突。

### 可信构建痕迹必须 attempt 级持久且强身份（review 一轮 P1 + 二轮 P1，已实证）

本次现场的终态 `device-test-build.result.json` 已被后续 reuse 调用覆盖为
`reused:true / hvigorExecuted:false`——固定文件名每次调用整写。`hvigor-app-build.meta.json`
能证明构建发生，但 payload 无显式 timestamp、无 resolvedBuildMode。且**纯时间窗口相关
≠ attempt-bound**：手工并发运行或时间重叠仍可能串证据。修订：provider 追加 append-only 的
`device-test-build.history.jsonl`，行含 `schema_version + goal_run_id + attempt_id`（复用
既有 `MAISON_GOAL_RUN_ID`/`MAISON_GOAL_ATTEMPT` 注入——check-receipt 侧已是 fail-closed
必填先例；非 goal 语境写 null）；分类器证据谓词要求 id 与当前 run/attempt **精确相等**
（null/不等一律不匹配）。

**两类证据窗口必须拆开（review 三轮 P0）**：violation 裁决发生在 post 快照之后、
receipt/journal 与 harness 之前（裁决 ~5226 → harness_start 5688）——T1 分类器运行时本
attempt 的 `harness_end` **尚未发生**，不能引用。且裁决不能推迟到 harness 后：真源码污染
不得签 receipt、不得跑 gate 是安全顺序。因此：
- **T1 生成物分类窗口 = invoke 窗口**（`agent_invoke_start` → agent_invoke_end/post 快照
  时刻）——与快照窗口天然同构：被分类的文件变化本就发生在该窗口，产生它的构建也必然在
  窗口内，无覆盖缺口；
- **T2 device 缺陷窗口 = `agent_invoke_start` → 同 invoke_id 配对的 `harness_end`**
  （harness_start/end 事件已带 invoke_id，goal-runner.ts:5692——权威 trace 常由 agent
  返回后的外层 gate 生成，仅用 invoke 窗口会漏；collector 在 harness 之后运行，该窗口
  对它可用）。
run/attempt 强身份两侧均保留。

### 降级范围收窄（review 一轮 P1）

`removed`/`type-changed` **永远 violation**：agent 可先合法跑一次构建产生痕迹，再删除或
换类型。只有 `added`/`modified` 可降级，且内容校验为**值可推导等值**：形状白名单（模板外
零语句）前置，常量值必须等于从当前构建上下文推导的期望——HAR_VERSION=模块
oh-package.json5 version、BUILD_MODE_NAME=构建史行 resolvedBuildMode、DEBUG↔mode 一致、
TARGET_NAME **推导源写死**：根 build-profile.json5 `modules[].targets`（applyToProducts
匹配当前 resolvedProduct），无显式 target 才回落 `'default'`（review 二轮小修）。不做
字节等值——hvigor 版本间模板注释措辞可能漂移，解析常量比对值即可。

### 防篡改诚实评估

reports 目录不在保护集内，构建痕迹理论上可被 agent 伪造——因此**值可推导等值（谓词 b）
是主防线**。残余风险收窄到"把文件改成与当前构建上下文完全自洽的合法常量组且同步伪造带
正确 run/attempt id 的构建史"，此时文件内容与真实构建输出无差别，翻转空间为零。接受此
残余，换取不 halt。

### 事件与终止态语义

降级项必须用**新事件类型** `testing_generated_file_change`，不能复用
`testing_write_violation` 加 kind 字段——resume 拒绝按事件 type 全量扫描，同名即误伤终止态。
真违规在场时照旧 halt，violation 事件的 changed 只列真违规，生成物单列 `generated_changed`
透明呈现（逐条目合法≠集合完整的老教训：两张清单都要全）。

## 缺口 ②：普通真机确定性缺陷没有回 coding 的通路

testing→coding 回修环存在且在用（v23 F1 `backtrack_to_coding`，
[goal-runner.ts:6719](../../harness/scripts/goal-runner.ts)），但输入面冻结为两源：
`source: 'visual_diff' | 'crash'`（goal-runner.ts:1142）。本轮真实缺陷——真机 UI 缺
`hc_bank_row_cmb` 元素、trace 确定性失败——**不属于任何一源**，只会在 testing 原地 retry
耗尽预算 HALT（本轮甚至没走到这一步：violation 裁决先于回退分类，直接截断）。

testing 零源码写入的职责切分**本身不动**：testing 复现采证产缺陷，修码回 coding 走全门禁。
本 plan 修的是把"合法构建副作用"从误伤名单里拿出去，把"普通真机缺陷"接进它本该进的回修环。

### 机器证据必须先有生产端（review 一轮 P0，已实证）

现有 `HylyreTraceCase` 只有 `id/status/priority/ac_ref/notes`
（[device-test-run.ts:65](../../profiles/hmos-app/harness/providers/device-test-run.ts)）。
修订：**不扩 Hylyre wheel 的 trace schema**（跨发布依赖重），由 provider 在 run 结束合成
机器拥有的 `device-test-defects.json`（schema 含 `schema_version/goal_run_id/attempt_id/
device_target/trace_path/build_fingerprint_full/cases[]`）。join 不上的 case 标 unjoinable 进 unverified；
无 defects.json 的旧 trace 整体进 unverified——**旧产物只降级处理，不假装可回修**。

### join 算法写死（review 二轮 P1，宿主实锤）

宿主 TC-001 的 failure_dir 同时存在 step-1/step-9/step-10 三组诊断文件，JSON 顶层只有
UI tree、无失败标记——真失败步骤只能从 trace notes 的机器写入子句
`failure_artifacts: ui_dump=TC-001-step-9.json, screenshot=TC-001-step-9.png` 解析。
算法冻结：严格解析该子句 → basename 防逃逸（必须落在 failure_dir 内）→ 文件名的
case id/step index 与该 case 一致 → 在**选中派生计划**中查到该 step 定义（selector/动作）。
缺失、多义、冲突一律 unjoinable——**禁止按最大 step 或任意现存文件猜**。

### 机器归因分类：确定性根失败 ≠ 应改产品（review 二轮 P1）

根失败也可能来自错误 selector、错误前置、测试计划缺陷或设备状态——只排除
toolchain/external_block 不够，否则 runner 会把测试脚本问题交给 coding、诱导 agent 改产品
迎合错误测试。每条 case 带机器分类：

| classification | 判据（机器可判） | 去向 |
|---|---|---|
| `product_actionable` | **三条件齐备**（review 三轮 P1：selector 属 spec 不足证——测试导航错页时合法 selector 自然不存在）：(i) selector 可归到 spec 声明锚点（ui-spec.yaml identity/锚点、acceptance checkpoint 的 by_id/by_text）且推导出 expected screen；(ii) 失败 step 的 UI dump 命中该 screen 的**其他** identity 锚点（真机确实在预期页面）；(iii) 仅目标 selector 缺失或形态不满足 | **唯一进 ActionableDefect 回 coding** |
| `environment` | 机器错误属设备/连接/会话类 | unverified/retry |
| `test_contract` | selector 无 spec 依据（测试自造）或派生计划步骤与 spec 对不上 | unverified/retry |
| `unknown` | 三条件不齐 / 其余 | unverified/retry |

宿主实证（本次现场，均已实测核对）：TC-001 三条件齐备——step-9 UI dump 中
`hc_page_title` 在场（确认已到 add_card_home_collapsed），仅存 namespaced 的
`maison:bc-opencard:add_card_home_collapsed:hc_bank_row_cmb`，验收要求的精确
`hc_bank_row_cmb` 缺失 → product_actionable。TC-007 的 by_text `'添加管理卡片'` **不在**
ui-spec.yaml / spec SSOT（只出现在 context/facts.md 与 visual-diff-nav.json）→
test_contract/unknown，不回 coding。**根故障数（2）≠ 可回 coding 数（1）**——fixture
必须拆根集合 / actionable 集合 / unverified 集合三个精确断言，不得混为一谈。

### trace 定位与身份绑定（review 一轮 + 二轮 P1）

不按目录名/mtime 取"最新 trace"——复用既有权威选择器
`resolveAuthoritativeHylyreTracePath`（[testing-trace-gates.ts:101](../../harness/scripts/utils/testing-trace-gates.ts)）。
绑定升级为：goal_run_id/attempt_id 精确相等 + attempt 窗口（含 gate harness 窗口）⊇ run
窗口 + **install provenance 链等值**（v7 P0：三重哈希等值被证不充分）。

**install 自证洞（P0 四轮，逐条实证）**：现有 device-test-install.meta.json 是固定文件名
覆盖式，无 goal_run_id/attempt_id/device_target；`hapSha256` 在 reused:true 时**仍从本地
HAP 现算**（device-test-install.ts:135 无条件调用）且只截 12 hex
（build-fingerprint.ts:24）；reuse 判定只比 bundle/version、HAP mtime/size 与 bm dump，
不绑 serial。宿主现场 meta 即危险形态：`reused:true + deviceVersionCodeParsed:0 +
hapSha256:"623defa9e1d0"`——三重哈希再相等也只证明本地记录彼此一致，证不了冻结设备上
装的是这个二进制，旧二进制的测试结果仍可能驱动 coding 回修。

修法（v8 定稿）：**第三张 append-only 账本 `device-test-install.history.jsonl`**（与 build
history 同款），行含 schema_version / goal_run_id / attempt_id / device_target 三元组 /
**hap_sha256_full（完整 64 hex）** / bundle / version / executed / reused / ok /
install_diagnosis_kind / timestamp。`executed:true & ok:true` 行是"该 serial 实际装入该
二进制"的唯一可信证据。

**"最后有效设备状态"resolver**（v9 定稿；两个前身各被一轮 P0 证伪——v7"链到先前行"
败于"曾装过≠当前仍是"（A→B→本地切回 A），v8"最后一行必须 executed"败于与合法 reuse
自冲突：agent 自检实装 E → 外层 gate 合法 reuse R(executed=false) → 最后一行是 R →
主流程必判 unverified）：**单一纯函数，provider 复用判定与 collector 共用**。本
attempt + 完整 device_target 元组（serial+target_kind+session_id）+ trace 前的行序列，
从尾部回溯：成功 reuse 且 sha 与其 based_on 指向的实际安装行一致 → 透明层继续回溯；
最近一条设备变更行（install/uninstall）必须是 executed && ok && 前后 sha 一致的
install 行且三方 full sha 等值；失败安装/卸载/元组变化/sha 链断 → 此前证明全失效；
跨 attempt 不作数。账本行为此增 operation_kind / install_event_id /
based_on_install_event_id。

**TOCTOU 双点哈希**：full sha 在 hdc install **前后各算一次**（现实现只在安装后算，
install.ts:135——安装中 HAP 被并发重建时史行会记到设备上没有的字节）；前后不等 →
该行 provenance_invalid 不可作证。sha 命名不可变 staging 副本记为未来加固，不入本 plan。

**自动 provenance bootstrap（仅 goal 模式）**：goal_run_id 与 attempt_id 都非空时，
install provider 复用判定走同一 resolver——本 attempt 无有效设备状态即真实安装（一次
hdc install -r 秒级；宿主既有覆盖式 meta 不构成复用依据），默认路径天然满足规则。
**非 goal 模式零变化**（check-testing 双模式共享此 provider）：保留现有 reuse 策略，
history 行照写但身份 null、仅 audit，null 身份永不为 goal 作证——与"普通模式无拉齐项"
一致。

**closed-world 诚实声明**：外部安装（用户/DevEco 框架外覆盖同 bundle）不可观测——
bm dump 无内容摘要，本规则是框架内闭世界证明，残余风险显式接受并写入 OpenSpec。
12 hex 的既有消费者（visual-diff 等）不动；账本字段 snake_case，覆盖式 meta 的
installDiagnosisKind 原名不动、OpenSpec 注明映射。

### unverified 通路泛化（review 一轮 P1；type 名保留已获接受）

entries 增 `source` 字段（visual|device_test），retry/halt 文案按 source 分支。事件 type
名与 halt reason 保留 `unverifiable_must_fix`（审计连续性，review 二轮已接受此理由）。

## review 处置记录（三轮，全部先对 ground-truth 核实）

| 意见 | 核实 | 处置 |
|---|---|---|
| 一轮 P0 版本 1.0.0 过不了门禁 | 实跑 check-plan-version FAIL | 已改 3.0.0，门禁 PASS |
| 一轮 P0 trace 无结构化字段 | HylyreTraceCase 五字段属实 | provider 合成 defects.json |
| 一轮 P1 构建痕迹被 reuse 覆盖 | result.json 固定名整写属实 | history.jsonl append-only |
| 一轮 P1 removed 降级不安全 | 逻辑成立 | removed/type-changed 永远 violation |
| 一轮 P1 unverified 视觉专用 | 5913 行文案属实 | payload+文案泛化；type 名保留 |
| 一轮 P1 禁按最新目录选 trace | resolver 存在属实 | 复用 resolveAuthoritativeHylyreTracePath |
| 二轮 P1 时间窗口 ≠ attempt-bound | MAISON_GOAL_RUN_ID/ATTEMPT 注入存在、check-receipt 已 fail-closed 消费 | 两产物带 schema_version+goal_run_id+attempt_id，精确等值 |
| 二轮 P1 未绑定被测 HAP | install meta hapSha256 存在（device-test-install.ts:156） | 三重等值绑定，缺/不等 → unverified |
| 二轮 P1 failure_dir 不唯一 | 宿主 TC-001 实有 step-1/9/10 三组文件；真步骤只在 notes failure_artifacts | join 算法写死，多义即 unjoinable 禁猜 |
| 二轮 P1 根失败 ≠ 应改产品 | 逻辑成立 | 机器归因四分类，product_actionable 白名单才回 coding |
| 二轮小修 fixture 精确集合 | triageCascade transitive 分支实证：TC-006 经通过的 TC-005 级联到 TC-001，根集合精确 = {TC-001, TC-007} | 断言 === 精确集合（根/级联/缺陷数） |
| 二轮小修 TARGET_NAME 推导源 | build-profile.json5 modules[].targets 结构属实 | 推导源写死，无显式才回落 default |
| 二轮小修 attempt 窗口定义 | harness_start/harness_end 事件存在（5665/5688）；权威 trace 由 gate 窗口生成属实 | 窗口=invoke_id 配对的完整 phase attempt（三轮再拆，见下） |
| 跨plan P1 defects 未绑设备身份 | deviceEnv 冻结注入/就绪门元组属实 | device_target 三元组 + 按 target_kind 分政策（仅 physical 可 actionable） |
| 跨plan P1 Hylyre 链无结构化诊断 | 半过时：RunFailureKind 已含 device_locked（工作区又前进）；但 t1 runDiagnosis 确在 UT 链 | environment 只消费 RunFailureKind+install.diagnosis.kind；per-case 归 unknown 禁扫散文 |
| 跨plan P1 R7 skip 与宿主验收矛盾 | skip 时序实证（pre snap→skip→post snap→gate 构建） | T3 验收分支化；generated 路径由受控集成测试保证 |
| 跨plan P1 宿主缺 device policy 前置 | 实查 framework.local.json 无 device 键 | T3 preflight：device:policy + R11 attestation 校准前置 |
| 跨plan 补强 seam/边缘/OpenSpec | RunHarnessFn 8 参无 deviceEnv 属实；a7 change 仍 active 属实 | 扩缝或纯函数断言；history 残行 fail-closed；先归档 a7 再建 d9 delta |
| 四轮 P0 install reuse 自证洞 | 全实证：meta 无身份/覆盖式/reused 仍现算本地 sha（install.ts:135）/12 hex 截断（build-fingerprint.ts:24）/宿主 meta 即危险形态 | install history 第三账本 + provenance 链等值取代三重哈希；三项专项验收（跨 serial/同版本不同内容/reused 无来源）；不强制重装、链断降 unverified |
| 五轮 P0 "曾装过"≠"当前仍是" | 反例成立（A→B→本地切回 A；外部覆盖装不可观测）；v7 三处表述不一致属实 | 当前性单一规则（本 attempt 最后一行 L）+ 自动 bootstrap（复用判定消费账本）+ closed-world 显式声明 + H1→H2 作废 fixture |
| 五轮 P1 宿主首跑不 backtrack | 时序推演成立：旧 meta 命中 reuse → 无自证行 → unverified | bootstrap 使默认路径自产 executed 行，T3 首跑增验证项；不依赖手动 force-install |
| 五轮 P1 OpenSpec 漏第三账本/字段漂移 | 属实（Todo 3 只列两产物；build_fingerprint 与 diagnosis 字段名三处漂移） | T3 补第三账本全套契约；字段统一（full 后缀、账本 snake_case、覆盖式 meta 原名+映射） |
| 六轮 P0 "最后一行"与合法 reuse 自冲突 | 成立且是主流程：agent 自检实装→外层 gate 合法 reuse 是设计内工作流（原事故即此形态） | "最后有效设备状态"纯 resolver（reuse 透明层回溯 based_on）；provider 与 collector 共用；四个新验收场景 |
| 六轮 P1 非 goal 模式 null 身份未定义 | 属实：install provider 为 check-testing 双模式共享，普通模式无 run/attempt id | bootstrap 仅双身份非空启用；普通模式 reuse 策略零变化；null 行仅 audit 永不作证；专项单测钉死 |
| 六轮 P1 sha 计算时点 TOCTOU | 属实：现实现安装后写 meta 时才算（install.ts:135） | 双点哈希（install 前后各一次），不等 → provenance_invalid；staging 副本记未来加固不入本 plan；补 stub 期间改写回归 |
| 三轮 P0 T1 引用了裁决时尚不存在的 harness_end | 时序实证：violation 裁决 ~5226 早于 harness_start 5688；harness 事件带 invoke_id（5692） | 两类窗口拆开：T1=invoke/快照窗口，T2=invoke_start→配对 harness_end；裁决安全时序不动 |
| 三轮 P1 根故障数与可回 coding 数混同 | 实证：'添加管理卡片' 不在 ui-spec.yaml/spec SSOT（仅 context/facts.md 与 nav 配置）；spec/ 目录无 acceptance.yaml | fixture 拆三集合精确断言：根 {TC-001,TC-007} / actionable {TC-001} / TC-007→test_contract；注入数 === 1 |
| 三轮 P1 selector 属 spec 不足证应改产品 | 实证：TC-001 step-9 dump 有 hc_page_title、仅 namespaced bank_row id、精确 id 缺失 | product_actionable 升级为 screen 语境三条件（expected screen + 他锚点命中 + 仅目标缺失） |

## 与 a7f2e5d1（设备就绪与阶段完成判定，本地已实施未提交）的交叉影响（v5，逐点对 diff 核实）

a7f2e5d1 在工作区改了 goal-runner.ts（+344 行）等 26 个文件，其中与本 plan 同文件的有
goal-runner.ts / device-test-run.ts / device-test-install.ts / hvigor-runner.ts /
goal-runner-testing-integrity.unit.test.ts / run-unit.ts。逐点结论：

**无冲突（核实过时序与语义）**：
- **设备就绪门（t3）** 插在 agent_invoke_start 之前、pre-invoke 快照之前；BLOCKED 时不
  invoke、不快照——T1 违规裁决链路不受影响。deviceEnv 经 extraEnv 注入且 P0-3 已把
  设备目标传给外层 gate harness。
- **violation 裁决时序未被改动**（仅行号漂移：violation 事件 5178→5288、halt→5338、
  harness_start→5689、backtrack→6836、resume 拒绝→3775、ActionableDefect→1150）。v4 的
  两窗口拆分决策在新代码上依然成立。
- **outer_layers 早检前移（t5）** 复用同一 computeProductSourceSnapshotDetail 但只消费
  isUsableSnapshot（不消费 diff）——与 T1 的 diff 消费层分类无交集；testing pre-invoke
  原校验保留，T1 挂点不变。
- **R7 跳过 agent invoke**（完成证据新鲜时 skip → 直接跑 gate）：skip 时快照仍成对且窗口
  内无 agent 活动 → clean，无误伤；gate 窗口的构建写入本就在快照窗口外。skip 判据消费
  pendingHandoffCount（backtrackCodingContext.length）——T2 回修交接在场时不会被 skip，
  正向协同。
- **testing 结论封顶（t2）** 只在 verdict=PASS 时触发（事件 testing_conclusion_capped +
  run 终态 capRunStatusForDeviceAuthenticity）——与 T2 的 backtrack（缺陷在场、非 PASS
  路径）不相交；emulator 上修完缺陷最终 PASS 会被诚实封顶 PARTIAL，语义正确。
- **device-test-build.ts（T1 生产端主战场）a7f2e5d1 未触碰**；install/run 的改动
  （S9 锁屏恢复）与 T2 的 defects.json 合成在同文件不同区域，仅文本相邻。

**对齐性修订（已回填 todo）**：
1. T2 environment 分类改为消费 t1 已落地的结构化 HdcFailureDiagnosis.kind /
   runDiagnosis（正是 t1 为根治"子串匹配判 device_locked"引入的——本 plan 不得再自造
   散文匹配）。
2. T2 补身份接线核实：defects.json 可能由 gate harness 窗口的 provider 写出，须核实
   MAISON_GOAL_RUN_ID/ATTEMPT 透传到 provider 进程 env，否则 gate 窗口产物身份为 null、
   回修环永不触发（静默失效，比报错更危险）。
3. 单测须走 testing-integrity 新脚手架（__testing_setDeviceReadinessGate 默认注入
   READY(physical)），否则就绪门会把新用例整体降级。新 suite 文件须在 run-unit.ts
   CORE_SUITES 注册（既有硬学习：不注册=假绿）。
4. T3 宿主回归判据改事件断言：宿主真机在 physical attestation 校准（a7f2e5d1 R11 悬置，
   属性键集合需目标机型校准）前判 unknown → 终态被压 PARTIAL，属 t2 预期行为，不得算
   本 plan 回归。
5. T1 已知边缘：t4 完成观测收口 tree-kill 可能截断进行中构建 → 半写 BuildProfile.ets →
   (b) 不过 → violation（fail-closed，与今日行为一致，接受）。

**codex 跨 plan 评估回填（v6，四 P1 + 补强，逐条核实）**：
- **设备身份绑定**：defects.json 补 `device_target{serial,target_kind,session_id}`（绑 a7
  就绪门冻结注入的设备元组）；collector 与当前 attempt 内存中的期望元组精确等值，禁从
  "最新事件"反推。actionability 政策：仅 physical 可 product_actionable；emulator/unknown
  一律 unverified（本 plan 定位真机缺陷回修，"设备无关缺陷"判据显式范围外）。
- **结构化诊断来源勘误**：a7 t1 的 runDiagnosis 在 UT/Hvigor 链，Hylyre 链不可直接取——
  v5 那句"直接消费 t1 结构化诊断"不成立。但 codex 说"RunFailureKind 无 device_locked"
  也已过时：工作区 P1 三轮修已加（device-test-run.ts:193，aa-start 恢复失败正确归
  device_locked）。定案：environment 只消费 run 级 RunFailureKind + install.diagnosis.kind
  两个既有结构化来源；per-case 无结构化来源 → unknown，禁重扫散文。
- **R7 skip 与宿主验收矛盾**：skip 时 gate 构建落在快照窗口外——既无 violation 也无
  generated 事件，v5 的"宿主必须出现 generated 事件"错误。改分支验收（见 T3），
  generated 事件路径由受控集成测试保证。
- **宿主前置缺口**：宿主 framework.local.json 无 device 配置（实查）——a7 发布后真机
  锁屏会在 readiness gate 就 BLOCKED；且 physical attestation（R11）未校准时 target_kind=
  unknown，T2 政策下缺陷全 unverified、backtrack 验收无从发生。T3 preflight 前置
  device:policy + R11 校准。
- **测试缝补强**：RunHarnessFn 注入缝（goal-runner.ts:678）现签名不含 deviceEnv——扩缝或
  抽纯函数断言 child env，否则设备身份透传是测试盲区。
- **T1 边缘扩充**：tree-kill 除半写文件外还有"文件写完但 history 行未 append/尾行截断"
  形态——同样 (c) 不满足 → violation，fail-closed 一致；history 读取只解析完整行。

**实施顺序（v6 定稿）**：① 冻结并提交 a7f2e5d1（审计期间仍出现新未跟踪文件
fake-credential-provider.ts——基线未冻结，确认其归属后一并提交）；② 全量验证后归档其
OpenSpec change（device-readiness-and-completion，tasks 已全勾但仍 active）；③ 本 plan
建 OpenSpec delta 并实施 T1/T2；④ 宿主先完成 device policy preflight + R11 校准，再做
分支化事件验收。plan 内行号一律视为写作时快照，实施以锚文本定位。

## 范围外（明确不做）

- 不动快照采集范围/算法（三集合、fs 递归哈希、fail-closed 语义全保留）；
- 不做 runner 侧 pre-invoke 构建前移；
- 不消费 `.gitignore`（快照 git 盲是 v23 有意设计）；
- 不扩 Hylyre wheel trace schema（provider 侧合成，避免跨发布依赖）；
- 不信任 gap-notes.md / test-report.md 作回修输入；
- 普通模式无此编排面（写保护与回修环均为 goal-runner 专属），无拉齐项；
- 当前宿主 run 属终止态：修复发布后**新开完整 run**（含 coding，因已有真实产品缺陷），
  三个 BuildProfile.ets 无需还原（本就是构建产物）。

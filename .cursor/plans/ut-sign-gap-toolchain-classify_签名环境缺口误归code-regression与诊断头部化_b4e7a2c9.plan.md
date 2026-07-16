---
name: ut 签名/环境缺口失败分类修正 + 分层诊断头部化 + 装机失败话术硬约束
version: 3.0.0
# 版本说明：修复进当前在研窗口 3.0.0（SSOT=根 package.json，已核实）。不 bump。
# 来源：D:\97.log\问题反馈\07-15\claudecode签名异常 复盘的两条"顺带观察"立项
# （见 signed-hap-discovery_d7e4b2a9.plan.md《宿主复验进展 2026-07-15》节）。
overview: >
  【问题】07-15 宿主复盘证实 3.0.0 的 d7e4b2a9 修复已生效（分层签名诊断 + 产物发现
  均在宿主真实布局上落地），但暴露两个残留缺陷：
  【缺陷 1 · 失败分类】bc-openCard run 20260713T073343Z 的 ut 失败
  （blocker=ut_hvigor_test，真因=ohosTest 签名环境缺口）在 events.jsonl 里被归为
  failure_kind_classified="code_regression"。根因：goal-failure-classifier.ts:89
  （现 :110，2c48e038 基线）TOOLCHAIN_BLOCKER_PREFIXES=['device_test_build',
  'device_test_install','hylyre_','hvigor_']
  ——前缀 'hvigor_' 匹配不上 id 'ut_hvigor_test'（ut_ 打头）；且 ut-host-impl.ts:819-836
  的通用 FAIL 分支不设 blocking_class（同文件 :759-775 的 installBlocking 分支有打标先例，
  仅此通用分支缺；该文件未被 d9 触碰，锚点仍准）→ classifyFailureKind 兜底
  code_regression（classifier.ts:318，现 :409）。
  后果：环境/配置缺口被当"须改码、可重试"盲重试——不进 SIGNATURE_HALT_KINDS 的
  signature 重复即 halt、不进 CUMULATIVE_HALT_FAMILY 累计熔断、拿不到
  goal-runner.ts:964-970（现 :1051-1055）
  的"基建失败勿改码"重试提示，烧预算空转（T6 治 testing 时的同款病灶，ut 侧漏网）。
  【缺陷 2 · 诊断可见性】d7e4b2a9 的分层签名诊断虽完整存在于 first.errors
  （hdc-runner.ts:1252）与 details 中，但 ut-host-impl.ts:787-788 的 !executed 分支只输出
  stageHint + "原因：hvigor / hdc 未执行，日志：<logExcerpt>"——(i) 该措辞对 hap_not_found
  是错的（hvigor 明明 BUILD SUCCESSFUL，未启动的是 on-device 段）；(ii) 诊断全文只能靠
  logExcerpt 尾部 [stage 2] 偶然带出——实测 07-15 材料中 details 共 5817 字符，分层诊断
  在最后 ~900 字符，前面是 ~5KB 构建日志。07-13 交互 agent 因此跑偏自创".p12 调试证书/
  默认密码 123456"环境故事，直到用户点名 hvigorfile.ts 才收敛。
  【方案】①check 层阶段化打标 blocking_class='device_toolchain'（复用 device_test_run
  review#2 既有精确先例与 TOOLCHAIN_BLOCKING_CLASSES 消费链，classifier 零改动）；
  ②!executed 分支诊断头部化 + 措辞纠错（抽纯函数便于单测）；③business-ut skill Step 7.6
  补"装机失败先全文引用 harness 分层诊断再下结论"硬约束 + 决策树补 sign-skip 行。
  两模式拉齐：②的 details 头部化同时改善交互（merged-report/stop-hook 循环）与 goal
  （ai-prompt/重试上下文）两侧可见性；①仅 goal 消费；③skill 话术两模式共用。
  【范围外（硬理由）】①不把 'ut_hvigor_' 加进 TOOLCHAIN_BLOCKER_PREFIXES——
  ut_hvigor_build 的编译错误须改 UT 码（code_regression 正确）、ut_hvigor_test 的用例失败
  同理，整前缀归类会复刻 review#2 否决过的错误；②不做 external_block/defer 化——
  deferrable 白名单（externalBlocked/device_blocked）语义是"无设备"，签名缺口 defer 会
  传染 testing 把两阶段都空跑，toolchain 的"停下求人修环境"语义更贴合；③failedAt=
  'metadata'/'run' 暂不打标——run 可能是用例自身崩溃（改码可修）、metadata 属工程结构，
  均缺误判实锤，观察后另行；④不代宿主改签名工程（同 d7e4b2a9）；⑤不动 classifyFailureKind
  本体与既有 kind 语义。
  【验收】新单测（打标正/负例、诊断头部化行序、failedAt 透传、classifier 端到端两例）+
  既有 hvigor-args/hdc-runner/goal-headless-guard 单测不破 + tsc + 全量 unit + fixtures
  全绿；宿主复验并入 d7e4b2a9 t5 同车（见 t5）。
todos:
  - id: t1-stage-aware-blocking-class
    content: >
      ut_hvigor_test 阶段化 blocking_class 打标（classifier 零改动）：
      ①【codex round2 P1-1 采纳·证据回传链路写死】hvigor-runner.ts runHvigorTest
      折叠结果处（:1962-1981）当前只回传 errors/testResult，签名证据无通道——
      HvigorRunResult 新增可选结构化字段 onDeviceFailureEvidence?: { failedAt?
      （类型对齐 hdc-runner.ts:476 联合类型）, unsignedPresent?: boolean,
      signSkipped?: boolean, signingConfigMissing?: boolean,
      installDiagnosis?: Pick<HdcFailureDiagnosis, 'kind'|'summary'|'suggestion'>
      【round5 P1-1 补；round6 类型定案用 Pick 引源类型（hdc-runner.ts:457），
      防手写字面量与源类型漂移】}：
      signSkipped/signingConfigMissing 取自 buildRes（detectSignSkip 既有产出），
      failedAt 取自 onDevice.failedAt，unsignedPresent 由 runOnDeviceUt 的结果
      新增可选字段回传（其内部 discoverOhosTestArtifacts 已算出 unsignedPath，
      只差带出），installDiagnosis 取自 onDevice.install.diagnosis
      （OnDeviceUtRunResult.install 既有字段，hdc-runner.ts:483/:1289-1304——
      折叠处现状同样丢弃，须一并透传，否则 t2 的 install 首行只能裁错误文本）。
      组装抽纯函数 buildOnDeviceFailureEvidence(buildRes, onDevice)（round5
      seam 定案，严格仿 buildOnDeviceSignDiagnosis 先例：runHvigorTest 调用点
      只做组装转发，单测打纯函数），经 runOnDeviceUt → runHvigorTest →
      dispatchUtRun → ut-host-impl 完整透传，t4⑥b 覆盖；
      消费来源表述（round5 P2 收紧）：**on-device 阶段分类只消费
      onDeviceFailureEvidence；工具缺失消费既有结构化 result.toolMissing；
      禁止消费 stageHint/errors 文本做分类**（onDeviceFailedAt 单字段方案作废，
      并入本结构）；
      ②ut-host-impl.ts 通用 FAIL 返回（:819-836）按阶段打标【round3 契约统一：
      全文只认 onDeviceFailureEvidence，onDeviceFailedAt 字样不得再出现】：
      isToolchainFailure(result) := result.toolMissing===true 或
      result.onDeviceFailureEvidence?.failedAt ∈ {'hap_not_found','install'}；
      打标条件 = bad.every(isToolchainFailure)（与 ⑤ 聚合规则同一处实现，废除
      first 单模块判断）；'no_pass'（用例失败）/'run'/'metadata'/testResult 分支
      不打标（维持 code_regression）。stageHint 定位【round4 二选一定案：采纳
      codex 严格版，round3 的"文本兜底分类"废除；round5 来源措辞收紧】：stageHint
      仅用于 details 展示与旧日志可读性，**分类/blocking_class/failure_kind 只认
      结构化来源——on-device 阶段消费 onDeviceFailureEvidence、工具缺失消费既有
      result.toolMissing，禁止 stageHint/errors 文本参与分类**；on-device
      evidence 缺失时一律不打 toolchain 标（即使 stageHint 有值）——文本兜底会把
      结构化接线回归静默掩盖成"仍能打标"，宁可漏标掉回 code_regression
      （偏保守方向），t4 负例锁死；
      ③goal-runner.ts:1055（原 :968，d9b4f7e2 落地后锚点，2026-07-16 复核文本
      未变）toolchain 重试提示的环境枚举补 "signing configuration (signingConfigs /
      自定义签名任务覆盖)"，使 halt/重试指导直接点到签名；
      ④消费链零改动核实【锚点为 2c48e038 基线，2026-07-16 复核随动】：
      TOOLCHAIN_BLOCKING_CLASSES（classifier.ts:112）+ hasToolchainBlockingClass
      （:137）+ buildSummaryBlockers 保真透传（harness-runner.ts:774 /
      summary-blockers.ts:40 / types.ts:499）均为既有设施，本 todo 只在 check 层
      产出标注；
      ⑤【codex round1 P1-3 采纳】多模块聚合：dispatchUtRun 循环的 break 条件不含
      !executed（ut-host-impl.ts:715-720——hap_not_found 不 break、后续模块继续跑），
      bad[] 可同时混合 hap_not_found 与 no_pass。打标以**全部 bad[] 聚合**为准：
      仅当所有失败模块均属工具链阶段（toolMissing/hap_not_found/install）才标
      device_toolchain；混合失败不打标（维持 code_regression，防掩盖真代码回归）；
      details 按模块逐条列出各自失败阶段；
      ⑥【cursor D + codex round2 阶段化命名采纳】failure_kind 按阶段写清，杜绝
      "无证据一律 hap_missing"误套：toolMissing → 'device_tool_missing'；
      hap_not_found 且证据在（unsignedPresent/signingConfigMissing/signSkipped
      任一）→ 'ohos_test_sign_gap'；hap_not_found 无证据 → 'ohos_test_hap_missing'；
      install → 'device_install_failed'。判定来源【round6 文字修正】：on-device
      三 kind 从 t1① 的 onDeviceFailureEvidence 判定，device_tool_missing 从既有
      result.toolMissing 判定；classifier 仍只消费 blocking_class 零改动不变
      （summary-blockers.ts:38
      已把 c.failure_kind 映射为 blocker.classification，链路通——cursor round2 核实；
      四个新值均不得进 deferrable_failure_kinds 白名单，见 e6a3c9f4 边界条目）。
      异构聚合规则（codex round3 P2 采纳，不新增枚举）：bad[] 全部同构 → 顶层
      failureKind=对应值；全部属工具链阶段但 kind 异构（如 hap_not_found+install）
      → blocking_class 照打 device_toolchain、**顶层 failureKind 留空**，逐模块
      details 各自标注 kind；禁止默认取 bad[0]（防 first-only 回潮）。
    status: completed
  - id: t2-diagnosis-first-details
    content: >
      !executed 分支诊断头部化 + 措辞纠错：
      (0)【codex round1 P1-1 采纳；截断数值经 round2 双家复核最终定案：800→300】
      details 经两级截断后才回喂 goal fresh agent：第一级 FAIL+BLOCKER 走
      buildSummaryBlockers 的 excerpt(c.details, 800)（summary-blockers.ts:40）；
      round1 我方误引的 excerpt(...,500)（现 harness-runner.ts:783 起的
      blockingWarnings/blockingSkips 段，2c48e038 基线）实为 WARN/SKIP 旁路，
      不是 FAIL 回喂路径，codex round1 的"800"是对的；第二级
      extractPriorFailureContext 截 300 字（goal-runner.ts:425，原 :409）——分层诊断
      全文即使头部化，(b) 层"signingConfigs 未配置"与修复建议仍会落在 300 字外。
      故 details **第一行**固定为一条 ≤180 字**阶段感知诊断头**（codex round3 P2
      + round4 证据矩阵定案：每个断言各自要有支撑证据，不得合并输出无支撑结论）：
      toolMissing →「工具链不可用：未找到 hvigor/hdc」；
      hap_not_found 的签名摘要按**原因维×产物维两维优先级拼接**（codex round5
      定案，取代 round4 枚举态——两维各自独立取证，天然覆盖 signSkipped-only
      等全部组合；对齐 d7e4b2a9 分层契约 describeOhosTestSignSkipDiagnosis
      hdc-runner.ts:711）：
      · 原因维（按优先级取一）：signingConfigMissing →「signingConfigs 未配置」
      + 宿主动作二选一（补 signingConfigs / 自定义签名任务覆盖 ohosTest）；
      否则 signSkipped →「hvigor 明确跳过签名，具体原因见构建日志」；
      否则 →「signed 缺失，原因未知，见下方诊断」；
      · 产物维（独立判定）：unsignedPresent →「ohosTest 仅产出 unsigned HAP」；
      否则**不得提 unsigned**；
      · 两维皆无证据 →「未发现 ohosTest 测试 HAP（signed/unsigned 均未见），
      不推断签名原因，请核对构建产物路径与 genOnDeviceTestHap 日志」；
      install →「安装阶段失败：<evidence.installDiagnosis.summary>」【round4
      P1-2 定案 + round5 通道补齐：install 阶段意味着 signed HAP 已被发现才进入
      安装，**不得复用 HAP 发现期签名证据归因安装失败**——首行只消费 t1① 新增
      的 evidence.installDiagnosis（源头 hdc-runner.ts:1289-1304 的
      install.diagnosis，经结构化透传，禁止从 errors 文本裁剪），无 diagnosis
      时报 exit code】。
      首行长度硬约束【round6 P1 采纳：≤180 不能只靠"示例文案通常较短"】：所有
      首行统一经纯函数 buildCompactDiagnosticHeader(text, max=180) 产出——换行
      折叠为空格、连续空白归一化、最终硬截断到 180；多模块列表只列前 N 个、
      其余记「等 X 个模块」；evidence.installDiagnosis.summary（普通 string，
      可含换行/超长）同样必须过此函数。
      随后才是诊断清单与日志。
      其余改动（ut-host-impl.ts:787-788）：
      (i) 输出全部 first.errors 为"诊断："清单（复用 :795-798 !testResult 分支
      既有模式；跳过与 stageHint 重复的那条，防同文案两遍）——分层签名诊断
      （hdc-runner.ts:1252 单条 message 全文）由此进入 details 头部；
      (ii) "原因：hvigor / hdc 未执行" 改为 "on-device 执行链未启动（见上方失败阶段
      与诊断）"——hap_not_found 时 hvigor 实际 BUILD SUCCESSFUL，旧措辞误导；
      (iii) logExcerpt 移诊断之后（保留，供查完整链路日志）。
      抽纯函数【codex/cursor round2 一致意见·聚合签名定案】
      buildUtHvigorTestFailDetails(bad: Array<{module, result}>) →
      {lines, blockingClass?, failureKind?, suggestion, affectedFiles} 供 t1/t2
      共用与单测——打标/failure_kind 用 t1⑤ 全量聚合规则，details 逐模块列出各自
      失败阶段与证据，affected_files 覆盖全部失败模块（现状 :819-836 只取 bad[0]
      的 first-only 契约随之废除）；**details 第一行三态**（codex round4 P2 采纳：
      goal prompt 先 details 后 suggestion，首行决定 300 字窗口的内容）：
      【round6 P1 定案，"同构复用具体摘要"作废——同 failedAt 甚至同 failureKind
      的模块证据仍可能不同（sign_gap(configMissing) vs sign_gap(signSkipped-only)），
      复用 A 的结论=错误推广到 B】：
      bad.length===1 且属识别出的工具链阶段（toolMissing/hap_not_found/install）
      → 用 t2(0) 对应阶段的具体诊断头；
      bad.length>1 → **一律聚合摘要，不复用任何单模块的具体原因**：全工具链 →
      「多模块工具链失败：<按 failureKind 计数或前 N 个 模块=kind 列表>，勿按
      单一原因处理」；混合性质 →「多模块失败性质不同：<逐模块=阶段>，勿按单一
      原因处理」——具体原因一律放逐模块 details 段；
      **非工具链单模块**（hvigor build 编译失败/metadata/run/no_pass/
      testResult.failed>0）不生成新首行，保持既有首行与既有诊断分支**零变化**
      （codex round5 P2：防本次重构顺带改变普通 UT 失败展示）；
      混合失败的 suggestion 优先级写死：首句声明
      "多模块失败性质不同，勿按单一原因处理"，然后逐模块给各自动作（签名缺口段
      引用 t2(0) 摘要话术、no_pass 段维持既有"按失败用例堆栈定位"话术），杜绝
      "整体归 code_regression 但 suggestion 只展示第一个签名缺口"的错配
      （checkUtHvigorTest 本体依赖真实 dispatchUtRun 不可单测，先例见 d7e4b2a9
      Round5 对 check-testing !hapPath 分支的测试边界记录；抽纯函数即为绕开该
      边界的既有手法，仿 buildOnDeviceSignDiagnosis）。
      范围拆分【round4 P1-1 修正：真 hdc install 失败返回 executed=true
      （hdc-runner.ts:1289-1291），走 :789-792 异常退出分支——原"只改 !executed"
      会让 install 诊断头永远不可达】：
      (甲) 阶段感知**首行**在聚合 helper 层对**所有 bad[] 模块**统一生成（含
      executed=true + failedAt=install 的场景），不依赖 !executed 分支；
      (乙) 全量 errors 前置与旧措辞替换仍只改 !executed 分支（hap_not_found /
      toolMissing 路径）；executed=true 的 :789-792 分支除首行外维持现状——
      其 errors 本就自带 install diagnosis 与修复建议（hdc-runner.ts:1299），
      泛化增强留作观察项。验收不得写成"所有 ut_hvigor_test FAIL 均全量头部化"。
    status: completed
  - id: t3-skill-diagnosis-first-rule
    content: >
      business-ut skill 装机失败话术硬约束：skills/reference/business-ut-workflow-detail.md
      Step 7.6（L93 自闭环策略 + L95-102 设备失败分类决策树）：
      ①自闭环策略补 hap_not_found/签名分支："失败阶段 hap_not_found → 先全文引用
      hdc-test.log（或 ut_hvigor_test details 头部）中 harness 分层签名诊断与修复建议，
      再下结论；诊断已给出明确原因层（如 'hvigor 明确报告 signingConfigs 未配置'）时，
      禁止另创环境故事（.p12 调试证书/默认密码/DevEco 会话兜底等均为 07-13 实测跑偏
      案例）；签名配置属宿主资产 → HARD STOP，将诊断原文 + 修复建议二选一呈给用户，
      不代宿主改工程、不循环重跑"；
      ②决策树补一行：`hap 未签名（sign-skip）| unsigned 在、signed 不在 | 引用分层诊断
      + HARD STOP 求宿主动作，不循环改 UT/重跑`；
      ③实施时核对 profiles/{generic,hmos-app}/skills/business-ut/profile-addendum.md
      是否有 Step 7.6 同段影子文案需随动（勘察未见，防漂移复查一遍）；
      ④【codex round1 P1-2 采纳·两模式语义写明，不新增 failure kind】HARD STOP 是
      **交互模式 skill 行为**（禁改码、禁循环重跑、当场呈诊断给用户）；goal 模式走
      t1 的 toolchain 语义=runner 允许一次有界确认性重跑、同 signature 重复即
      halt——二者分属两种执行上下文，并存不矛盾，skill 文案写明"goal 模式下熔断由
      runner 接管，agent 本轮只做诊断呈报"。决策树 sign-skip 行触发条件写清
      （cursor E 采纳；round5 补结构化对齐）：failedAt=hap_not_found 且任一
      结构化签名证据在（unsignedPresent / signSkipped / signingConfigMissing
      ——与 t1⑥ ohos_test_sign_gap 判据**同源**，防 classifier 判 sign gap 而
      skill 判普通产物异常的分裂）；证据全无属产物发现/构建异常，同样 HARD STOP
      但话术改为"核对构建产物路径与 genOnDeviceTestHap 日志"，不得复用签名
      缺口话术。
    status: completed
  - id: t4-gates-green
    content: >
      单测 + 门禁：
      ①buildUtHvigorTestFailDetails：hap_not_found 携带签名诊断 → 诊断行位于
      logExcerpt 之前（行序断言）+ details 不含 "hvigor / hdc 未执行" 旧措辞（负例）+
      stageHint 去重（同文案不出现两遍）+ 签名摘要**两维优先级组合用例**（双证据
      完整结论 / unsignedPresent+signSkipped 无 configMissing / 仅 unsignedPresent /
      仅 signingConfigMissing 不得提 unsigned / 全无——各例断言只输出有支撑的
      措辞、**不得交叉输出无支撑断言**；round5 补两例：**signSkipped-only**
      （无 unsigned 无 configMissing）→ 只说"跳过签名见日志"；
      **signSkipped+signingConfigMissing 无 unsigned** → 说配置缺失、不提
      unsigned）+ install 首行消费 evidence.installDiagnosis 且不含签名归因
      （unsignedPresent 同时为 true 时的专项负例）+ **no_pass 兼容例**：
      非工具链单模块（no_pass/build 编译失败）首行与既有展示零变化；
      ②打标正例【round3 契约统一，全部改用 onDeviceFailureEvidence】：toolMissing /
      evidence.failedAt=hap_not_found / =install → blocking_class='device_toolchain'，
      并覆盖四种 failure_kind 各一正例（device_tool_missing / ohos_test_sign_gap
      需**任一**签名证据在：unsignedPresent/signSkipped/signingConfigMissing
      【round5 修正：原漏 signSkipped】 / ohos_test_hap_missing /
      device_install_failed）；负例：no_pass（用例失败）/run/metadata/
      testResult.failed>0 → 不打标；**evidence 缺失但 stageHint 含 hap_not_found
      → 不打标**（round4 严格版定案：文本不参与分类，负例锁死"接线回归不被文本
      兜底掩盖"）；
      ③（并入 ⑥b）evidence 五项透传即接线测试覆盖（round6 修正：round5 起含
      installDiagnosis 共五项，非四字段），独立的单字段透传用例作废；
      ④goal-headless-guard.unit.test.ts 端到端三例：ut_hvigor_test +
      blocking_class=device_toolchain → toolchain；ut_hvigor_test 无标 →
      code_regression（守住"用例失败仍可重试"既有语义，镜像 T6 review#2 的
      device_test_run 两例）；【2026-07-16 d9 优先级兼容例】agentTimedOut=true +
      device_toolchain blocker → agent_timeout（遵从 d9 signals 优先，b4 不得
      破坏），且 extractPriorFailureContext 输出仍含签名诊断头（分类让位、
      回喂信息不丢）；
      ⑤cd harness && npx tsc --noEmit exit 0；npm run test:unit / test:fixtures
      全绿（baseline 数字实施时记录）；
      ⑥【codex round1 P1-1；round2 数值定案 800→300】端到端截断存活测试：
      buildUtHvigorTestFailDetails → buildSummaryBlockers（excerpt **800**，
      summary-blockers.ts:40 生产链真值）→ extractPriorFailureContext（300 字）
      全链拼装，断言最终回喂文本的该 blocker 段内同时含 "signingConfigs" 与宿主
      动作关键词（不只测 details 内部行序）；负例：无 (b) 证据时该段不得含
      "signingConfigs 未配置"断言；【round4 P2 追加；round7 措辞对齐】首行三态
      （单模块阶段摘要【bad.length===1 契约】 / 全工具链异构"多模块工具链失败" /
      混合性质"多模块失败性质不同"）与 executed=true+install 的安装诊断首行，
      均各有一条 800→300 存活断言；
      ⑥b【codex round2 P1-1 + round5 seam 定案】证据组装单测打纯函数
      buildOnDeviceFailureEvidence(buildRes, onDevice)（runHvigorTest 调用点
      只做组装转发，与 buildOnDeviceSignDiagnosis 完全同构——现有测试结构无法
      稳定直测 runHvigorTest seam，纯函数即为该边界的既有解法）：断言
      failedAt/unsignedPresent/signSkipped/signingConfigMissing/installDiagnosis
      **五项**逐一保真、缺失时不臆造默认值、install 无 diagnosis 时
      installDiagnosis 为空（首行回退 exit code）；
      ⑦【codex round1 P1-3 + round3 异构补充】多模块聚合用例：bad=[hap_not_found,
      no_pass] 混合 → 不打标（顶层 failureKind 留空）；全工具链同构
      （[hap_not_found, hap_not_found] 或 [toolMissing]）→ 打标+对应 kind；
      全工具链**异构**（[hap_not_found, install]）→ 打标 device_toolchain 但
      顶层 failureKind 留空、逐模块 details 各自标注；顺序相反（先 no_pass 即
      break、签名缺口模块本轮未跑到）→ 单元素 no_pass 不打标（break 语义天然
      给出，用例固化防回归）；【round6 P1 追加两例】[sign_gap(configMissing),
      hap_missing]（同 failedAt 异 kind）与 [sign_gap(configMissing),
      sign_gap(signSkipped-only)]（同 kind 异原因）→ 首行均为聚合摘要、
      **不得把第一个模块的具体原因写成全局结论**；
      ⑧【round6 P1】buildCompactDiagnosticHeader 用例：超长/含换行的
      installDiagnosis.summary、多个长模块名 → 断言首行单行且 length≤180、
      多模块截断出现「等 X 个模块」、经 800→300 后关键分类词仍可见。
    status: completed
  - id: t5-host-reverify
    content: >
      宿主复验（用户执行，与 d7e4b2a9 t5 第二步同车）。
      【签名未修状态重跑 ut】期望：ut_hvigor_test details 首行即 ≤180 字签名摘要；
      goal events.jsonl phase_verdict.failure_kind_classified="toolchain"
      【d9b4f7e2 落地后的适用边界（codex 2026-07-16 复核采纳，freshness 细化）：
      该预期仅在 agentTimedOut=false 且无 integrity blocker 时成立——超时轮按
      d9 signals 优先归 agent_timeout（唯 fresh summary 且含 integrity 时归
      framework_integrity_block，决策表 classifier.ts:334）；非超时轮 integrity
      在场归 framework_integrity_block；各让位场景分类改变但回喂中的签名诊断头
      不丢（extractPriorFailureContext 不看 kind）】；重试
      prompt 出现"基建失败勿改码 + 签名配置"提示；若签名缺口为**稳定唯一**
      blocker，同 signature 第二次失败触发 halt，事件键 halt_reason=
      "no_progress_toolchain"（键名经核实，现 goal-runner.ts:2687/:2830；cursor A
      校正采纳：07-13 现场首轮 signature 混杂 ut_no_src_mutation 等 blocker、
      实际 halt 为 retries 耗尽且 halt_reason 为空——"第二次即 halt"仅对稳定同
      signature 场景承诺，混杂场景可能到第 3 次，本 plan 真正确定的收益是
      重试方向纠正：不再往"改码"引导、交互侧不再折腾 .p12）。
      【签名修好后·testing 闭环（codex P2 采纳）】ut_hvigor_test 真机执行 PASS →
      goal 链继续进入 testing → device_test_build 命中
      01-Product/Phone/build/product/outputs/product/Phone-product-signed.hap →
      device_test_install / device_test_run 实际通过——把 07-15 反馈中"真机阶段"
      的间接验证（d7e4b2a9 t5 第一步）转为直接验证，原始反馈两阶段全闭环。
    status: pending
---

# 证据链（2026-07-15 复盘，材料：D:\97.log\问题反馈\07-15\claudecode签名异常）

| # | 证据 | 结论 |
|---|------|------|
| 1 | events.jsonl（run 20260713T073343Z）末条 phase_verdict：`failure_kind_classified:"code_regression"`, `blocker_signature:"ut_hvigor_test\|ut_no_src_mutation"` | 签名环境缺口被归"须改码可重试"——误分类实锤 |
| 2 | goal-failure-classifier.ts:89（现 :110） `TOOLCHAIN_BLOCKER_PREFIXES` 无一匹配 `ut_hvigor_test`；ut-host-impl.ts:819-836 通用 FAIL 分支无 blocking_class（该文件未被 d9 触碰） | 双重漏网 → classifier.ts:318（现 :409）兜底 code_regression |
| 3 | ut-host-impl.ts:759-775 installBlocking 分支已设 failure_kind/blocking_class（mapInstallBlockingToUtCheckFields，device-install-diag.ts:163）；check-testing.ts:2079 device_test_run 崩溃打 `device_toolchain`；消费链 classifier.ts:91/:116（现 :112/:137）+ summary-blockers.ts + types.ts:493（现 :499）齐备 | 打标是既有成熟模式，本 plan 只补通用分支的产出端，classifier 零改动 |
| 4 | 07-15 材料 script-report.json ut_hvigor_test details 实测 5817 字符：头两行 "失败阶段：hap_not_found / 原因：hvigor / hdc 未执行"，分层签名诊断在末尾 ~900 字符 | 诊断存在但埋尾 + 头部措辞误导（hvigor 实际 BUILD SUCCESSFUL） |
| 5 | cc-ut签名报错.txt L1747-1777：agent 无视已落盘诊断，自创 ".p12 调试证书 + 默认密码 123456" 方案，被用户否定；L1893 用户点名 hvigorfile.ts 后才收敛 | 可见性缺陷的行为后果实锤；t3 话术硬约束的依据 |
| 6 | hdc-runner.ts:1243-1252：describeOhosTestSignSkipDiagnosis 全文作为单条 error message 返回；hvigor-runner.ts:1970/:1977 折叠进 res.errors 并保 stage 标签 | **诊断文本**头部化可消费既有 errors；【round3 更正】但结构化证据（unsigned/signSkipped/signingConfigMissing）折叠处不回传，t1① 的 onDeviceFailureEvidence 新增透传仍必需——本行原"无需新增传输"仅对文本诊断成立 |
| 7 | goal-runner.ts:964-970（现 :1051-1055）toolchain 重试提示枚举 "device connection / hdc / build toolchain / screenshot permissions"，无签名 | t1③ 一行补词的锚点 |
| 8 | skills/reference/business-ut-workflow-detail.md L93 自闭环策略覆盖 metadata/artifact_not_found/install，决策树（L95-102）只有 install-diag 四态 | sign-skip 场景在 skill 层无指引——t3 锚点 |

# 与在途工作的兼容性

| 核查项 | 结论 |
|--------|------|
| e3a9c5d1（goal-fakepass-hardening）文件交集 | 【2026-07-15 更正：其已提交为 bd5a87e1（时为 HEAD；当前 HEAD 已是 2c48e038，见 d9 复核节）】goal-failure-classifier.ts 被其改动但本 plan 对其**零改动**（只消费）；goal-runner.ts 交集仅 t1③ 一行枚举词，无逻辑冲突；ut-host-impl.ts / hvigor-runner.ts / hdc-runner.ts 不在其改动清单；锚点最终以 2c48e038 复核版为准 |
| d7e4b2a9（signed-hap-discovery，已实施）关系 | 纯增量：t2 消费其 t3 产出的诊断 message；不改其函数签名与措辞（Round5/6 已收窄的文案原样保留） |
| phase-rules yaml / gate 语义 | 不动（blocking_class 属 check 结果元数据，非门禁等级变化）；gate_fingerprint rules 分量不变 |
| openspec | 全库无失败分类/details 排版的 spec 记载，无需随动 |
| goal-timeout-hardwall-hardening（openspec 变更 + plan d9b4f7e2）【2026-07-16 状态终版：**runtime 已提交 2c48e038=当前 HEAD，b4 可开工**】 | 历史：round3 记"未实施"→round4 实测工作树实施中并定死"待收敛后基于新 HEAD"→**2026-07-16 已收敛提交**，本 plan 锚点已全量复核随动（见《d9b4f7e2 落地基线复核》节）。openspec 仅余 7.3b/7.5b 两项**待实机回灌的集成断言**（tasks.md:48/:51，需 goal run 实跑测试床），不阻塞本 plan 实施。共享测试面（goal-headless-guard 现 103/103 PASS）基于 2c48e038 增测 |
| e6a3c9f4（host-feedback-dx-hardening，待 review）defer 语义边界【codex round2 P1-2】 | 其 t3(d) 原文写"消费其 blocking_class=device_toolchain 打标"，若按该 class 泛匹配，签名缺口会被纳进 capability waiver、违反本 plan 范围外②。**边界已双侧写死**：capability-gap waiver 只匹配显式前置能力码（personal_prerequisites 失败的 deveco_toolchain_missing 类），禁止按 blocking_class 泛匹配；本 plan 四个 failure_kind（ohos_test_sign_gap / ohos_test_hap_missing / device_tool_missing / device_install_failed）均不进 deferrable 白名单。e6a3c9f4 t3(d) 文案已同步修正 |

# 外部 review 记录（2026-07-15，codex + cursor 双独立评审，均已逐条 ground-truth 核实）

codex 判"有条件通过，先修 4 项再开工"；cursor 判"可实施，带修正意见落地"。逐条核实与处置：

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| P1：details 头部化仍被两级截断，300 字内看不到 signingConfigs | codex | **成立**；【round2 更正】round1 我方"数值修正为 500"系误引——500 是 blocking_warnings/blocking_skips（WARN/SKIP）旁路（harness-runner.ts:773/:781），FAIL+BLOCKER 真实第一级为 `excerpt(c.details, 800)`（summary-blockers.ts:40），**codex 原值 800 正确**；第二级 300 字（goal-runner.ts:409）属实 | t2 增 (0)：details 首行 ≤180 字结构化签名摘要（按 signDiagnosis (a)-(d) 分层拼措辞，无 (b) 证据不得断言）；t4⑥ 端到端截断存活测试按生产链 800→300 拼装（含负例） |
| P1：t3 HARD STOP 与 t5 第二次才 halt 自相矛盾 | codex | **部分成立**：二者分属交互 skill / goal runner 两种执行上下文，本不矛盾，但 plan 未写明边界；采纳其选项 1（保留 toolchain=一次有界确认性重跑），不新增 host_configuration_required 类失败 kind | t3④ 写明两模式语义；t5 措辞软化 |
| P1：分类只看 bad[0]，多 ohosTest 模块混合失败误熔断 | codex | **成立**：dispatchUtRun 循环 break 条件不含 !executed（ut-host-impl.ts:715-720），hap_not_found 不 break、后续模块继续跑，bad[] 可混合 hap_not_found 与 no_pass | t1⑤ 全量聚合（全部为工具链阶段才打标）；t4⑦ 双向混合用例 |
| 建议：单凭 hap_not_found 归 toolchain 稍宽，应携带结构化证据 | codex | **部分采纳**：打标维持阶段判据——产物发现异常同样非"改 UT 代码"可修，toolchain 重试话术方向仍正确；证据以可读 failure_kind 随附而非作为打标前置条件 | t1⑥（与 cursor D 合并） |
| P2：t5 缺 testing 阶段闭环；事件键为 halt_reason 非 haltReason | codex | **成立**：halt_reason 键名核实（goal-runner.ts:2343/:2469）；原始反馈含 ut+真机两阶段、真机至今只有间接验证 | t5 重写：签名修好后验 testing 全链（device_test_build 命中 outputs/product → install → run） |
| 版本：dist/framework-3.0.0.zip 已被宿主消费，应明确重切 3.0.0 或走 3.0.1 | codex | 成立，属发布决策非 plan 语义问题（check-plan-version 判 3.0.0 窗口开放 PASS） | 记为**开放问题交用户拍板**（按惯例不擅自 bump）；本 plan 版本字段维持随当前窗口 |
| 兼容表"e3a9c5d1 在途未提交"过期 | codex | **成立**：已提交 bd5a87e1=HEAD | 兼容表已更正，锚点按 HEAD 复核 |
| A：本 run 第三次 halt 实为 retries 耗尽（halt_reason 空），"烧预算/第二次即 halt"写太满 | cursor | 成立（events phase_verdict 无 halt_reason 字段与现场复核一致；首轮 signature 混杂 ut_no_src_mutation） | t5 写明适用条件：稳定同 signature 场景才承诺第二次 halt；真正确定收益=重试方向纠正 |
| B：failedAt=install 打标略粗但可接受（无设备主路径已被 install_preflight→externalBlocked 吃掉） | cursor | 成立 | install 维持打标，不再细分子类 |
| C：t2 只覆盖 !executed 分支，验收勿夸大 | cursor | 成立（本行":793-798"表述后经 round2 P3 修正：典型非零退出实走 :789-792，:793-798 仅覆盖子集） | t2 增范围限定句；t4 验收措辞同步限定 |
| D：打标时顺带设可读 failure_kind（如 ohos_test_sign_gap） | cursor | 采纳 | t1⑥ |
| E：决策树 sign-skip 行条件写清（unsigned 存在/诊断含 signingConfigs），与产物路径扫错区分话术 | cursor | 采纳 | t3④ |

## Round 2（2026-07-15，codex "补齐两项 P1 后可正式通过" + cursor "改完再实施"；均已逐条 ground-truth 核实）

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| P1：短摘要/failure_kind 依赖的签名证据（unsigned/signSkipped/signingConfigMissing）无回传链路——runHvigorTest 折叠处只留 errors/testResult，signDiagnosis 仅是 runOnDeviceUt 的**入参**不回传 | codex | **成立**（hvigor-runner.ts:1962-1981 复核属实） | t1① 定案：HvigorRunResult 新增 onDeviceFailureEvidence 四字段结构化透传（runOnDeviceUt→runHvigorTest→dispatchUtRun→ut-host-impl；round5 起扩为五项，增 installDiagnosis），unsignedPresent 由 runOnDeviceUt 结果补带；t2/t1⑥ 只消费结构化字段禁文本解析；t4⑥b 接线测试；原 onDeviceFailedAt 单字段方案作废并入 |
| P1：与 e6a3c9f4 的 capability-gap defer 冲突（其 t3(d) 写"消费 blocking_class=device_toolchain"） | codex | **成立**（e6a3c9f4 t3(d) 原文实锤） | 兼容表新增边界条目；e6a3c9f4 t3(d) 同步改为"只匹配显式前置能力码、禁按 blocking_class 泛匹配、四 failure_kind 不进 deferrable 白名单" |
| P2：第一级截断是 800 非 500（500 是 WARN/SKIP 旁路） | codex + cursor 一致 | **成立**——round1 我方"修正"才是错的（summary-blockers.ts:40 = 800；harness-runner.ts:773/:781 = blocking_warnings/skips） | t2(0)、t4⑥、round1 记录行三处已改回 800→300 |
| P2：t1⑤ 聚合与 t2 单模块 helper 签名打架；affected_files/suggestion 仍 first-only | codex + cursor 一致 | **成立**（ut-host-impl.ts:819-836 现状 first-only） | t2 helper 签名定案为聚合形态 buildUtHvigorTestFailDetails(bad[]) → {lines, blockingClass?, failureKind?, suggestion, affectedFiles}；混合失败 suggestion 优先级写死（首句声明多性质失败+逐模块动作） |
| P3：executed=true 范围说明行号不准（典型非零退出走 :789-792 仅日志，非 :793-798 诊断清单） | codex | **成立** | t2 范围限定句改写：诊断由 stageHint 头部承载；泛化 executed=true 异常退出分支留观察项不入验收 |
| failure_kind 按阶段命名（toolMissing/install 与 hap_not_found 分开） | codex | 采纳 | t1⑥ 四值定案：device_tool_missing / ohos_test_sign_gap / ohos_test_hap_missing / device_install_failed |
| t1⑥ failure_kind → blocker.classification 映射链路已通（summary-blockers.ts:38） | cursor | 核实属实 | t1⑥ 引注，无需新增映射 |
| 开放问题重申：3.0.0 重切 vs 3.0.1 | codex round1 遗留 | 发布决策 | **【2026-07-15 用户拍板，已关闭】版本号保持 3.0.0，用户通知前不得改动**——本修复作为 3.0.0 窗口内回归件（重切 3.0.0 发布件），不走 3.0.1；后续 bump 须等用户明确通知 |

## Round 3（2026-07-15，codex "修完 P1 可正式通过" + cursor "仅剩契约用语打架"；均已逐条 ground-truth 核实）

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| P1：新旧回传契约并存——t1② / t4②③ 仍写 onDeviceFailedAt 与 first 单模块判断，且 t1② 残留"stageHint 文本判定"与"禁文本兜底"冲突 | codex + cursor 一致（两家唯一共同项） | **成立**（plan 自身文本冲突，round2 编辑遗漏） | t1② 重写：isToolchainFailure(result) 读 evidence.failedAt + bad.every() 聚合、onDeviceFailedAt 字样清除；stageHint 兜底收窄为"仅阶段识别，不得用于签名断言，最多落 ohos_test_hap_missing"；t4② 改用 evidence 并补四 kind 正例；t4③ 并入 ⑥b 作废单字段用例 |
| P2：异构工具链失败（hap_not_found+install）顶层单一 failureKind 无规则，可能退回 bad[0] | codex | 成立 | t1⑥ 增异构聚合规则：同构→对应 kind；全工具链异构→blocking_class 照打、**顶层 failureKind 留空**、逐模块标注（不新增枚举）；t4⑦ 补异构用例 |
| P2："第一行固定为签名摘要"覆盖面过宽（toolMissing/无证据/install 场景无签名证据可摘） | codex | 成立 | t2(0) 改为**阶段感知诊断头**四分支（toolMissing/hap_not_found±证据/install），无证据分支明示"不推断签名原因" |
| P2：与 goal-timeout-hardwall-hardening 的合并顺序未记录 | codex | **成立**（openspec proposal.md:28/:30 核实其 runtime 清单含 classifier/goal-runner 及测试面） | 兼容表新增合并顺序条目：以其最终落地版为基线，禁止各自基于旧基线覆盖测试 |
| 低优：e6a3c9f4 存在 b4a7a2c9 笔误 | codex | **部分成立**：仅 :49 一处笔误（codex 称 :111 也有，实测 :111 拼写正确，但其"消费其打标"措辞需对齐 round2 边界） | e6a3c9f4 :49 笔误已改；:111 措辞同步收紧为"消费其 blocking_class 语义但 waiver 匹配只认显式能力码" |
| 低优：round1 记录 C 行 ":793-798" 与 round2 修正不一致 | codex | 成立（历史记录不一致） | round1 C 行已加修正注记 |
| 证据链 #6 "无需新增传输"与 t1① 矛盾 | cursor | 成立 | #6 已更正：仅对文本诊断成立，结构化证据仍需 t1① 透传 |

## Round 4（2026-07-15，codex 单家；均已逐条 ground-truth 核实）

| 意见 | 核实 | 处置 |
|---|---|---|
| P1：install 诊断头不可达——真 hdc install 失败 executed=true，走 :789-792，而 t2 限定只改 !executed | **成立**（hdc-runner.ts:1289-1291 `executed: true, failedAt: 'install'` 复核实锤；executed=false 的 install 仅"无设备"分支 :1272-1281） | t2 范围拆分为（甲）阶段感知首行在聚合 helper 层对全部 bad[] 生成（不依赖 !executed）/（乙）errors 前置与措辞替换仍只改 !executed；t4⑥ 补 executed=true+install 首行 800→300 存活断言 |
| P1：签名摘要过度断言——"signingConfigs 未配置"与"仅产出 unsigned"需两个独立证据分别支撑；install 阶段意味着 signed 已发现，不得复用 HAP 发现期签名证据归因 | **成立**（对齐 d7e4b2a9 分层契约 describeOhosTestSignSkipDiagnosis） | t2(0) 摘要矩阵五态写死（双证据/skip 无 config/仅 unsigned/仅 configMissing/全无），install 首行只消费 install.diagnosis（:1289-1304）；t4① 矩阵五态各一例 + install 不含签名归因专项负例 |
| P1：结构化唯一来源与 stageHint 分类兜底仍冲突（round3 收窄版本质上还是文本参与分类） | **成立**（plan 内部两套契约并存） | 二选一定案采纳严格版：分类/blocking_class/failure_kind 只认 evidence，evidence 缺失一律不打标（宁可保守回 code_regression），stageHint 仅展示用；t4② 负例改为"stageHint 有值但 evidence 缺失 → 不打标"；round3 的"文本兜底最多落 hap_missing"废除 |
| P2：多模块聚合后 details 第一行未定义，混合失败可能被首行伪装成纯签名失败 | 成立（goal prompt 先 details 后 suggestion，首行即 300 字窗口门面） | t2 helper 增首行三态：单模块/全同构→阶段摘要；全工具链异构→"多模块工具链失败：<阶段列表>"；混合→"多模块失败性质不同"；三态+install 首行均入 800→300 存活测试（t4⑥） |
| P2：goal-timeout-hardwall "未实施"状态过期 | **成立**（round4 git status 实测工作树正在改 goal-runner/classifier/guard 测试/check-*.ts） | 兼容表更正为"实施中"，实施顺序定死：待其收敛提交后基于新 HEAD 实施并复核锚点，或经用户同意并入同一批次 |

## Round 5（2026-07-15，codex 单家"补完可正式通过"；均已逐条 ground-truth 核实）

| 意见 | 核实 | 处置 |
|---|---|---|
| P1：install.diagnosis 无结构化回传通道——evidence 只有四字段，真 diagnosis 在 OnDeviceUtRunResult.install（hdc-runner.ts:483），折叠处同样丢弃；从 errors 裁字符串=重新引入文本解析 | **成立**（与 round2 P1-1 同构的第二处通道缺口） | t1① evidence 增第五字段 installDiagnosis?: {kind?, summary, suggestion?}；t2(0) install 首行改消费 evidence.installDiagnosis、禁止裁 errors 文本、无 diagnosis 回退 exit code；t4⑥b 改为五项保真 |
| P1：签名矩阵漏 signSkipped-only 态；t4② 正例判据也漏 signSkipped——与 t1⑥ "任一即 sign_gap" 不一致 | **成立**（round4 枚举态写法自留的漏洞） | t2(0) 改为**原因维×产物维两维优先级拼接**（configMissing > signSkipped > 原因未知；unsigned 独立判定，天然覆盖全组合）；t4① 补 signSkipped-only 与 signSkipped+configMissing 无 unsigned 两例；t4② 判据补 signSkipped；t3④ 决策树触发条件改为与 t1⑥ 同源的三证据任一（防 classifier/skill 判定分裂） |
| P2：非工具链单模块（build 失败/metadata/run/no_pass/failed>0）首行未定义，重构可能顺带改变普通 UT 失败展示 | 成立 | t2 首行三态收窄为"仅识别出的工具链阶段生成新首行"，非工具链单模块既有展示**零变化**；t4① 补 no_pass 兼容例 |
| P2：来源表述不精确（device_tool_missing 实际消费 result.toolMissing 而非 evidence）；接线测试 seam 应抽 buildOnDeviceFailureEvidence 纯函数 | 成立 | t1①/t1② 表述改为"on-device 阶段=evidence、工具缺失=result.toolMissing、禁止 stageHint/errors 分类"；组装抽纯函数 buildOnDeviceFailureEvidence(buildRes, onDevice)，t4⑥b 只打纯函数（与 buildOnDeviceSignDiagnosis 同构） |

## Round 6（2026-07-15，codex 单家"修完即正式通过"；均已逐条 ground-truth 核实）

| 意见 | 核实 | 处置 |
|---|---|---|
| P1："同构复用具体摘要"仍过粗——同 failedAt 异 kind（sign_gap vs hap_missing）、同 kind 异原因（configMissing vs signSkipped-only）都会把 A 的结论错误推广到 B | **成立**（逻辑推演即证，无需代码核实） | t2 首行规则改为：bad.length===1 才用具体阶段摘要；bad.length>1 一律聚合摘要（kind 计数/前 N 列表），具体原因只进逐模块 details；t4⑦ 追加同 failedAt 异 kind、同 kind 异原因两例 |
| P1："≤180 字"无可执行约束——installDiagnosis.summary/多模块列表/模块名均动态无界，summary 可含换行 | **成立**（hap_not_found 不 break，模块列表长度确实无上界） | t2(0) 增 buildCompactDiagnosticHeader(text, max=180) 纯函数硬约束（折行/归一/硬截断/前 N+「等 X 个模块」，install summary 必经）；t4⑧ 补超长/换行/长模块名用例 + 800→300 存活断言 |
| 清理：t4③ 仍写"四字段"（round5 起五项） | 成立（:228 活文本） | 已改"五项"并注明演变 |
| 清理：t1⑥ "均从 evidence 判定"与 device_tool_missing 消费 result.toolMissing 矛盾 | 成立 | 已改"on-device 三 kind 从 evidence、tool_missing 从 result.toolMissing" |
| 清理：installDiagnosis 手写字面量类型应改 Pick | 成立（HdcFailureDiagnosis 实存 hdc-runner.ts:457，kind/summary/suggestion 字段齐） | t1① 已改 Pick<HdcFailureDiagnosis, 'kind'\|'summary'\|'suggestion'> |

## d9b4f7e2 落地基线复核（2026-07-16，commit 2c48e038=新 HEAD）：**无设计冲突（分类适用有边界，见下），开工前置解除**

goal-timeout-hardwall 已提交（+3743/-127，41 文件）。逐项复核本 plan 全部消费面与锚点：

| 复核项 | 结论 |
|---|---|
| 主实现面 | ut-host-impl.ts / hvigor-runner.ts / hdc-runner.ts / summary-blockers.ts / phase-transition-policy.ts **全部未被触碰**——t1/t2 的实现锚点与 800 字第一级截断原样成立 |
| classifier 语义 | toolchain 在 SIGNATURE_HALT_KINDS（:157）与 CUMULATIVE_HALT_FAMILY（:174）原样；新增 framework_integrity_block / framework_bug 两 kind 的拦截键为 blocking_class='integrity' / classification='framework_bug' / blocking_class='framework_internal'（safeRun），与 device_toolchain 及本 plan 四个 failure_kind **无键碰撞**。【codex 2026-07-16 修正采纳：初版"零语义冲突"过于绝对】分类适用是**条件性**的——签名缺口稳定归 toolchain 仅当 agentTimedOut=false 且无 integrity blocker。精确规则（**限本 plan 的签名 blocker 场景**——d9 另有 fresh 全 framework_bug、全 await_human_confirm 等分支此处不列；freshness 决策表 classifier.ts:334 起，codex 2026-07-16 二次修正采纳）：超时轮 fresh summary（staleSummary===false）且含 integrity → framework_integrity_block，stale/未传 freshness → 一律 agent_timeout；**非超时轮** integrity 在场 → framework_integrity_block（:365 起，在 toolchain 判定之前）。各让位场景下回喂详情不丢（d9 continuation 保留失败详情，goal-runner.ts:1953/:1026），t5 期望已加边界限定、t4④ 补 d9 优先级兼容例 |
| classifier 锚点漂移 | TOOLCHAIN_BLOCKER_PREFIXES :89→**:110**；TOOLCHAIN_BLOCKING_CLASSES :91→**:112**；hasToolchainBlockingClass :116→**:137**；code_regression 兜底 :318→**:409**（内容均未变） |
| goal-runner 锚点漂移 | toolchain 重试提示 :968→**:1055**（文本未变，t1③ 已随动）；extractPriorFailureContext :400→**:416**、300 字截断 :409→**:425**（值不变）；halt_reason :2343/:2469→**:2687/:2830** |
| t5 期望 | 不受影响："PASS 事件省略 failure_kind_classified"只动 PASS 事件，FAIL 事件断言原样；P0-4 超时升档/熔断对**非超时的签名主路径**无影响，超时共现场景遵循上行分类优先级（见 classifier 语义行） |
| 新增 safeRun framework_bug 归因 | 与本 plan 兼容且互补：buildUtHvigorTestFailDetails 等新纯函数若自身抛错会被正确归为框架缺陷（首触 halt 指向源仓），不会污染 device_toolchain 语义 |
| 测试基线 | t4⑤ 基线更新：unit **1986** + fixtures **44**（2c48e038 提交信息记载） |
| 开工前置 | **解除**——d9b4f7e2 已收敛提交，本 plan 可基于 2c48e038 实施（锚点已全量复核随动） |

## Round 7 终审（2026-07-15，codex）：**正式通过**

- 仅 1 处非阻断 P3：t4⑥ "同构阶段摘要"与 round6 的 bad.length===1 契约措辞不齐 → 已改"单模块阶段摘要【bad.length===1 契约】"。
- **实施顺序（终审时点表述，【2026-07-16 已更新，以此为准】）**：终审当时 d9b4f7e2 尚在工作树实施中，故设"待收敛"硬前置；现 **d9 runtime 已提交至 2c48e038，本 plan 基于该 HEAD 实施**，锚点已全量复核随动（见《d9b4f7e2 落地基线复核》节），OpenSpec 剩余 7.3b/7.5b 实机集成断言不阻塞——**开工前置已解除**。
- 评审历程：round1-2 双家（codex+cursor），round3-7 codex；全部意见逐条 ground-truth 核实后落盘，无遗留项。
## 实施记录（2026-07-16）

- 实施基线：2c48e038；t1–t4 已完成，t5 依 plan 保持 pending，等宿主在 bc-openCard 环境做真机复验。
- 主要文件：profiles/hmos-app/harness/{hdc-runner.ts,hvigor-runner.ts,ut-host-impl.ts,ut-hvigor-test-failure.ts}、harness/scripts/goal-runner.ts、skills/reference/business-ut-workflow-detail.md 及对应 unit tests。
- 验收：tsc --noEmit 通过；unit 2002 passed, 0 failed（基线 1986 + 新增 16）；fixtures 44 passed, 0 failed；check-plan-version 与 git diff --check 通过。
- 终审结论：九轮评审契约已落地，classifier / summary-blockers / phase-transition-policy 未改，d9 分类优先级兼容用例通过，可合入。
- 偏离与后续：本次无 scope 偏离。无设备在 preflight 后离线的低概率竞态仍沿用既有 failedAt='install' 语义；如需细分为独立阶段，另立小项处理，不在本 plan 内扩面。

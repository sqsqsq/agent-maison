---
name: signed-hap 产物发现去硬编码 + 未签名精确诊断 — 宿主 ut/testing "签名失败" 误报根治
version: 3.0.0
# 版本说明：修复进当前在研窗口 3.0.0（SSOT=根 package.json）。宿主跑的 2.4.0 是问题
# 来源版本，非本 plan 版本窗口；修复随 3.0.0 回归件带给宿主。不另行 bump。
# 只改产物发现与诊断文案/结构化字段，不改门禁语义 / phase-rules yaml。
overview: >
  【问题】宿主（E:\moniqianbao\HarmonyOSDemo，framework 2.4.0，feature bc-openCard）ut+testing
  阶段总是报"无法完成 hap 签名"，agent 结论为"DevEco headless 不支持在线签名的环境问题"。
  用户反驳成立：DevEco 里能正常签名装机。2026-07-10 逐条核对宿主反馈日志
  （D:\97.log\问题反馈\07-09\宿主反馈\CC的ut真机异常）确证：这是**两个独立问题**，
  其中 testing 阶段是纯框架 bug——签名其实成功了，框架找不到产物。
  【根因 A · testing（框架 bug，误报）】hvigor-app-build.log 明确记录宿主自定义任务
  `:Phone:onlineSignHap` 在 headless 下签名成功，产物落在
  `01-Product/Phone/build/product/outputs/product/Phone-product-signed.hap`。
  但 findAppSignedHap（profiles/hmos-app/harness/hvigor-runner.ts:991）把 outputs 下的
  子目录**硬编码成 'default'**（L1019 主扫 + L1036 fallback 全是 `outputs/default`），
  从未看 `outputs/product/` → hapPath=null → device_test_build / device_test_install /
  testing_run_status 3 BLOCKER 连锁 FAIL。真实产物布局是 `build/<product>/outputs/<target>/`，
  target 不保证叫 default（宿主 Phone 模块的 target 输出段为 product）。ohosTest 侧
  findOhosTestSignedHap 用 `outputs/ohosTest` 是对的，仅主 HAP 这一函数有硬编码。
  佐证：宿主 goal 模式产出的 testing/headless-assumptions.md 已把此 bug 精确定位为
  BLOCKER-1（含盘上验证 signed hap 存在），但后续交互 agent 又误诊为"环境不支持"。
  【根因 B · ut（真实未签名 + 框架诊断误导）】hvigor-ut-build.log：genOnDeviceTestHap
  BUILD SUCCESSFUL，但 `WARN: Will skip sign 'hos_hap'. No signingConfigs profile is
  configured` → ohosTest hap 只有 unsigned。宿主 build-profile.json5 signingConfigs=[]，
  主 HAP 靠宿主自定义 onlineSignHap 兜底（coding/testing 日志皆有），该任务不覆盖 ohosTest
  产物。框架完全不解析 sign-skip 警告（全仓无 'Will skip sign' 匹配），hdc-test.log 只报
  "未找到 *-signed.hap，请先 genOnDeviceTestHap"（可它明明跑成功了）→ 诱导 agent 编出
  "headless 不支持在线签名"的错误环境故事。诊断表述边界（codex review 采纳）：主 HAP
  自定义签名成功只能证明**非 headless 全局不支持签名**，不能证明 ohosTest 标准签名链已
  可用——ohosTest 未签名的直接原因是 signingConfigs 未配置、或自定义签名任务未覆盖
  ohosTest。headless hvigor 在 build-profile 有 signingConfigs 时支持构建+签名+安装
  （华为官方命令行流水线文档佐证）。
  【方案】①findAppSignedHap 产物发现去硬编码并给出**确定的候选选择契约**（见 t1）；
  ②sign-skip / 产物发现结果**结构化贯通**到 ut/testing 最终 BLOCKER（见 t3，不止加日志
  解析规则——现状三处断流：ut-host-impl.ts:364 PASS 分支丢 diagnostics、hdc-runner.ts:1118
  只知"找不到 HAP"、check-testing.ts:1546 !hapPath 分支不输出 hv.diagnostics）；
  ③stale-signed 降级为**纯观测**（见 t2，两家 review 一致意见：本批反馈无"复用过期
  signed"实锤样本——现场日志 PackageHap 是 UP-TO-DATE；mtime 硬门禁会误伤且"重跑一次
  收敛"论证不成立）。
  【范围外（硬理由）】①不代宿主改工程（signingConfigs / hvigorfile 自定义任务是宿主资产，
  框架只给精确指引文案）；②不做框架自带 hap-sign-tool 补签能力（引入证书材料管理，超出
  patch 范围，如需另立项）；③check-testing.ts 门禁语义（BLOCKER 等级、can_claim_done 判据）
  不动，只精确化 details 文案与诊断字段；④stale-signed 硬拦截（强制重跑/禁止安装）不做，
  如后续有实锤样本另立 hardening（需以签名任务时序证据为依据，非单纯 mtime）。
  【验收】新单测（outputs/<product> 布局、候选歧义、sign-skip 诊断正例+负例、stale 观测）
  + 既有 device-test-build-reuse / hvigor-args / hdc-runner 单测不破 + typecheck + 全量
  unit + fixtures 全绿；宿主复验分两步（见 t5）。
todos:
  - id: t1-find-app-signed-hap
    content: >
      主 HAP 产物发现去硬编码 + 候选选择契约，**兼容包装不破契约**（codex round2 采纳）：
      新增 discoverAppHapArtifacts(projectRoot, product) → HapDiscoveryResult
      {signedPath, candidates[], scannedDirs[]}；findAppSignedHap 改为薄包装
      （= discover(...).signedPath），签名 string|null 不变，既有调用方
      （device-test-build-reuse.ts / providers/device-test-build.ts）与单测零破坏，
      需要 scannedDirs/candidates 的调用方显式改用 discover*。
      完整确定性排序键（四级）：① segment rank（resolvedProduct → default → 其余
      build/* 子目录字典序）→ ② build-profile modules[] 声明序 → ③ outputs 子目录 rank
      （resolvedProduct → default → 其余非 ohosTest 字典序）→ ④ 文件名 rank（非 ohostest
      命名优先 → 字典序尾条，与既有行为一致）；fallback build/* 同用此键显式排序。
      多候选取确定一条（兼容多模块宿主），candidates 全量入 result，下游 details 出
      WARN 列明歧义，不再静默。同步：check-testing.ts device_test_build FAIL 文案改为
      列出实际 scannedDirs；device-testing profile-addendum.md L10 写死的
      `outputs/default` 落盘路径文档随动。
    status: completed
  - id: t2-stale-signed-observability
    content: >
      【降级为纯观测，不做硬门禁】同目录按**相同 basename 配对**（<name>-unsigned.hap ↔
      <name>-signed.hap；不做跨文件名比较，避免误伤其他 target/变体）记录 mtime 对：
      unsigned 比 signed 新时在 device-test-build.result.json 记 staleSuspect 字段 +
      details 出 WARN 提示（"signed 可能基于上一轮 unsigned，宿主自定义签名任务时序所致，
      建议核对后重跑构建"）。不强制 rebuild、不阻断安装。构建后（device-test-build.ts:139
      重新 find 处）同样带出该观测。硬拦截另立 hardening（范围外）。
    status: completed
  - id: t3-sign-skip-structured-diagnosis
    content: >
      sign-skip 结构化诊断贯通（ut+testing 双侧）：①HvigorRunResult 新增结构化字段
      signSkipped / signingConfigMissing（解析日志 `Will skip sign` / `No signingConfigs
      profile`），buildHvigorDiagnostics 同步加人读规则；②新增 discoverOhosTestArtifacts
      → {signedPath, unsignedPath, scannedDirs[]}，findOhosTestSignedHap 改薄包装
      （provider 公开导出 providers/device-test.ts:13 契约不变）——**分层诊断**
      （codex round3：unsigned 单独只证明"没发现 signed"，不证明原因）：
      (a) unsignedPath 存在 → 确定层文案"ohosTest HAP 已构建但未发现对应 signed HAP"；
      (b) signingConfigMissing=true → 追加"hvigor 明确报告 signingConfigs 未配置"；
      (c) 仅 signSkipped=true → 追加"hvigor 明确跳过签名，具体原因见构建日志"；
      (d) 两标志皆无 → 原因标注未知，仅给核查建议。宿主修法作为建议附于 (b)/(d)
      （在 DevEco 配置签名【如自动签名】并**确认 build-profile.json5 最终存在可供
      headless hvigor 使用的 signingConfigs**【不承诺特定 IDE 版本 Apply 必持久化】 /
      自定义签名任务扩展覆盖 ohosTest）；
      ③signSkipped 传输层级（codex round2 修正）：**runHvigorTest 内部**把当前模块
      buildRes.signSkipped/signingConfigMissing 经 OnDeviceUtOptions 新增的模块级签名
      诊断字段直传 runOnDeviceUt（同函数内 hvigor-runner.ts:1696→1733，模块级直传防
      多 ohosTest 模块串诊断），runOnDeviceUt 将其与 unsignedPath 联合判断出精确文案；
      ut_hvigor_build PASS 分支仅附 WARN 行做报告可见性（PASS 不丢诊断），**不承担
      跨阶段传输**（check-ut.ts:3513 的结果本就不流入 :3556 的 run）；unsigned 存在性
      为主判据、signSkipped 为加强项（cursor 意见：未收到标志时文案仍须正确）；
      check-testing.ts !hapPath 分支输出 hv.diagnostics + scannedDirs；④矛盾证据文案
      （收窄版）+ 明确传输路径（codex round3）：runHvigorTest 内调用
      discoverAppHapArtifacts，把 mainAppSignedPath 随模块级签名诊断一起入
      OnDeviceUtOptions（落点在 runHvigorTest 是因它同时掌握 build 结果与 HDC 调用
      hvigor-runner.ts:1696→1733，且避免 hdc-runner 反向 import hvigor-runner 成环）；
      runOnDeviceUt **仅在 mainAppSignedPath 非空时**输出矛盾**基线句**"同一 headless
      环境已能执行宿主自定义主 HAP 签名，非 headless 全局不支持签名"，原因层复用
      t3② 的 (b)/(c)/(d) 同一套拼接（cursor round4：不得在无标志时写死"直接原因是
      signingConfigs 未配置或自定义任务未覆盖"）；主 signed 不存在时不得声称
      headless 已能签名。
    status: completed
  - id: t4-gates-green
    content: >
      单测：新增 ①outputs/<product> 布局命中；②多候选歧义（candidates>1 出 WARN、四级
      排序键确定性）；③sign-skip 分层诊断正例（signingConfigMissing=true→文案含
      "hvigor 明确报告 signingConfigs 未配置"；仅 signSkipped→"明确跳过签名见日志"）
      + 负例（无警告→不出 sign-skip 文案；unsigned 不存在→维持原"未产出"语义；
      **标志未传但 unsigned 在→输出"已构建但未发现对应 signed"，不得断言
      "signingConfigs 未配置"**）；④stale 观测（同 basename 配对、跨名不配对）；
      ⑤新旧 API 双覆盖：discover* 结构化断言 + find* 薄包装与 discover().signedPath
      行为等价（含 provider 导出 findOhosTestSignedHap）；⑥矛盾证据两用例：
      主 signed + test unsigned→输出收窄矛盾文案；无主 signed + test unsigned→
      不得声称 headless 已能签名。
      既有 device-test-build-reuse / hvigor-args / hdc-runner 单测不破（标准
      build/default/outputs/default fixture 仍最高优先命中）。
      cd harness && npx tsc --noEmit → npm run test（unit+fixtures）全绿。
    status: completed
  - id: t5-host-reverify-two-step
    content: >
      宿主复验分两步（用户执行）：【第一步·宿主原状不动，验证框架修复与新诊断】同步
      framework 后直接重跑——期望 testing device_test_build 命中既有
      01-Product/Phone/build/product/outputs/product/Phone-product-signed.hap 走通
      build/install；ut 明确报"已构建但未发现对应 signed + hvigor 明确报告
      signingConfigs 未配置（(b) 层）+ 修法建议"，不得再出"环境不支持"。
      【已确认，2026-07-10，宿主实机核查】宿主在自己工程执行核查命令，结果一锤定音：
      ①`build-profile.json5` 里三个 product 的 `signingConfig: "default"` 均为**悬空
      引用**——顶层 `app.signingConfigs[]`（存放证书/密码/profile 的真定义数组）根本
      不存在，命中的三处 "signingConfigs" 只是模板注释行；②全工程 hvigorfile.ts 搜
      `onlineSignHap` 零匹配，说明主 App 那条自定义签名任务并非内联代码，而是从某个
      插件包（oh_modules 下内部构建工具）引入、仅挂在 Phone/主包链路，WalletMain
      （ohosTest 所在模块）自身源码也零签名相关痕迹——两条共同证实：标准 `SignHap`
      在 ohosTest 上因"default" 引用解析不到而跳签，与 headless/DevEco 无关，是 hvigor
      标准签名机制本身行为；DevEco 里 Run ohosTest 能签成功，是 IDE "自动签名" 会话级
      便利特性兜底、未持久化进 build-profile.json5 所致。**结论：非 framework bug，
      纯宿主工程配置缺口**——t1/t3 的框架侧改动（发现 bug + 精确诊断）已经做对且做完，
      无需再开新 plan。
      【2026-07-10 用户确认收尾】宿主确认签名本身已经能成功、且已挂载好，无需上述
      两条动作中的任何一条——signingConfigs/自定义签名插件覆盖问题不构成阻塞，
      到此为止不需要宿主再做配置动作。
      【仍待办，与上面签名配置问题无关】第一步"框架代码改动在宿主机重跑 harness
      验证"尚未执行——需等 3.0.0 发布件经 `framework-init UPDATE` 重铺到宿主后，
      重跑 testing/ut harness 确认：testing 侧 device_test_build 命中既有 signed
      主 HAP、ut 侧诊断文案准确（不再是"环境不支持"）。
      【consumer-guard(e8f5a2c7) 后的操作约束】①同步方式必须走发布件 + framework-init
      UPDATE 重铺：宿主 framework/ 已有写保护 hook（G1）+ per-file sha 校验 + G2 外来
      文件扫描，手工拷贝散文件热修会被判 BLOCKER（且"重算 manifest 迁就"是被明确堵死
      的绕过链）；②升级到 3.0.0 窗口后 gate_fingerprint 版本分量变化，bc-openCard 既有
      spec/plan/coding/review 回执被判 stale 属**预期行为**（升级本身所致，非本修复
      引入的 bug），按提示重验即可；③可与 e8f5a2c7 遗留的 g1b 真实 Cursor payload
      宿主实测共用同一次 3.0.0 回归件宿主复验。
    status: pending
---

# 证据链(2026-07-10 核实)

反馈材料：`D:\97.log\问题反馈\07-09\宿主反馈\CC的ut真机异常\`

| # | 证据 | 结论 |
|---|------|------|
| 1 | `testing/reports/hvigor-app-build.log` L4-5：`executeSignHapProduct ... outputFile ...\build\product\outputs\product\Phone-product-signed.hap`、`Finished :Phone:onlineSignHap after 1s131ms`、`BUILD SUCCESSFUL` | headless 下宿主自定义签名成功，signed 主 HAP 在盘上；"headless 全局不支持签名"不成立 |
| 2 | `testing/reports/device-test-build.result.json`：`hapPath: null, reuseReason: "未找到 signed 主 HAP"` | 框架没找到 #1 的产物 → findAppSignedHap 硬编码 `outputs/default`（hvigor-runner.ts L1019/L1036） |
| 3 | `testing/headless-assumptions.md` BLOCKER-1 | goal 模式当时已精确定位该框架 bug 并盘上验证；后续交互对话又被误诊为环境问题 |
| 4 | `ut/reports/hvigor-ut-build.log` L59-63：`WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured` + `BUILD SUCCESSFUL` | ut 的 ohosTest HAP **真未签名**（signingConfigs=[]，宿主自定义 onlineSignHap 不覆盖 ohosTest） |
| 5 | `ut/reports/hdc-test.log`：`未在 .../outputs/ohosTest/ 找到 *-signed.hap ... 请先 genOnDeviceTestHap` | 框架诊断误导（task 明明已跑成功）；全仓无 `Will skip sign` 解析 |
| 6 | `coding/reports/hvigor-build.log` L4-5 同样有 onlineSignHap 签名成功记录 | 宿主自定义签名任务稳定存在，仅覆盖主 HAP |
| 7 | `testing/reports/hvigor-app-build.log` L66：`UP-TO-DATE :Phone:product@PackageHap` | 本轮**未产生新 unsigned**——"stale signed 被复用"无现场实锤，t2 据此降级为纯观测 |

# 外部 review 记录(2026-07-10，codex + cursor 双独立评审，均已逐条 ground-truth 核实)

| 意见 | 核实 | 处置 |
|------|------|------|
| BLOCKER：plan version 写 2.4.0，SSOT 根 package.json=3.0.0，check-plan-version.mjs L86 会判失败 | 属实 | version 改 3.0.0 |
| HIGH：t2 stale 无实锤（PackageHap UP-TO-DATE）、任意 unsigned 比较误伤、构建后不复检（device-test-build.ts:139）、"重跑一次收敛"不成立 | 属实 | t2 降级纯观测：同 basename 配对 + result 字段 + WARN，不强制 rebuild/不阻断；硬拦截移出范围 |
| HIGH：sign-skip 只加 buildHvigorDiagnostics 接不到最终 BLOCKER（ut-host-impl.ts:364 PASS 丢诊断 / hdc-runner.ts:1118 / check-testing.ts:1546 三处断流） | 属实 | t3 改为结构化字段（signSkipped/signingConfigMissing/unsignedPath/scannedDirs/candidates）+ 三处显式接线 |
| HIGH：'headless 签名链路可用'表述过宽（自定义主 HAP 签成 ≠ ohosTest 标准链可用） | 属实 | 文案收窄为"非 headless 全局不支持签名；直接原因是 signingConfigs 未配置或自定义任务未覆盖 ohosTest" |
| MEDIUM：候选选择契约缺失（优先级/稳定排序/歧义不静默） | 属实 | t1 写明 ①outputs/<product> ②outputs/default ③其余非 ohosTest 稳定序；candidates 入 result，歧义出 WARN（保持确定选择，兼容既有宿主） |
| MEDIUM：宿主复验应两步（先验新诊断准确性，再配签名验闭环） | 采纳 | t5 拆两步 |
| cursor：device-testing profile-addendum.md L10 文档同样写死 outputs/default | 属实 | 并入 t1 文档随动 |

## Round 2(2026-07-10，codex "条件通过" + cursor "可实施"，两项 HIGH 已核实并写入)

| 意见 | 核实 | 处置 |
|------|------|------|
| HIGH：结构化返回破坏 find* 契约（findOhosTestSignedHap 是 provider 公开导出 providers/device-test.ts:13；两函数现返 string\|null） | 属实 | t1/t3 改为 discover* 新函数 + find* 薄包装，旧契约零破坏；t4 新旧 API 双覆盖 |
| HIGH：signSkipped 透传层级写错（ut_hvigor_build 结果 check-ut.ts:3513 不流入 :3556 的 run；真实传输点在 runHvigorTest 内部 hvigor-runner.ts:1696→1733） | 属实 | t3 改为 runHvigorTest 内模块级直传 OnDeviceUtOptions→runOnDeviceUt；PASS 文案仅报告可见性，不承担传输；防多模块串诊断 |
| 建议：t1 排序键写全 | 采纳 | 四级键：segment → modules[] 声明序 → outputs 子目录 → 文件名；fallback 显式排序 |
| 建议：不承诺 DevEco Apply 必持久化 | 采纳 | 文案改"配置签名并确认 build-profile.json5 最终存在可用 signingConfigs" |
| cursor：signSkipped 未传到 hdc 时文案仍须正确 | 采纳 | unsigned 存在性为主判据、signSkipped 为加强项；t4 补对应负例 |

## Round 3(2026-07-10，codex "修完即正式通过")

| 意见 | 判定 | 处置 |
|------|------|------|
| HIGH：unsigned 单独不能证明 signingConfigs 未配置（还可能是任务未覆盖 target / signed 落非预期目录 / 配置存在但不可用） | 成立 | t3② 改四层分层诊断：(a)unsigned 在→"已构建但未发现对应 signed"（确定层）；(b)signingConfigMissing→追加"hvigor 明确报告未配置"；(c)仅 signSkipped→追加"明确跳过签名见日志"；(d)皆无→原因未知仅给核查建议。t4 负例改为"标志未传不得断言 signingConfigs 未配置" |
| MEDIUM：矛盾证据 mainSignedPath 无明确传输路径 | 成立 | t3④ 明确：runHvigorTest 内调 discoverAppHapArtifacts，mainAppSignedPath 随模块级诊断入 OnDeviceUtOptions；runOnDeviceUt 仅在其非空时输出矛盾文案（避免 hdc→hvigor-runner 反向 import 成环）；t4 补两用例（有/无主 signed） |

## Round 4(2026-07-10，cursor "改完即可开干"；Round 3 各项核实通过)

| 意见 | 判定 | 处置 |
|------|------|------|
| MEDIUM：t3④ 矛盾文案写死"直接原因是 signingConfigs 未配置或自定义任务未覆盖"，与 t3② 分层冲突（无标志时不得断言） | 成立 | t3④ 改为：基线句（仅 mainAppSignedPath 非空）"已能执行宿主自定义主 HAP 签名，非 headless 全局不支持签名" + 原因层复用 (b)/(c)/(d) 同一套拼接。本宿主日志有 No signingConfigs WARN，t5 仍期待 (b) 层文案 |

# 与 consumer-guard(e8f5a2c7，commit 46536232) 兼容性核查(2026-07-10)

| 核查项 | 结论 |
|--------|------|
| 文件交集 | 零：e8f5a2c7 改 agents/* + harness/scripts/{check-init,init-orchestrate,utils/*} + 对应测试；本 plan 目标文件（profiles/hmos-app/harness 的 hvigor/hdc/provider、check-testing.ts、check-ut.ts、ut-host-impl.ts、device-testing addendum）无一被动 |
| 行号锚点 | 无漂移：本 plan 全部锚点系在 46536232 已为 HEAD 之后勘察核实 |
| G1 写保护是否拦实施 | 否：guard hook 只随 init 装进宿主工程；源仓无 .claude/settings.json，实施不受影响 |
| 完整性扫描是否拦 npm test | 否：framework-integrity 对 source/dev layout（无包内 manifest）no-op SKIP |
| gate_fingerprint 是否因本 plan 变化 | rules 分量不变（本 plan 不动 phase-rules yaml，属"纯实现 bugfix 不动 rules"的豁免类）；版本分量随 3.0.0 升级必变，属升级效果非本 plan 引入 → 已写入 t5 预期 |
| RELEASE-MANIFEST | pack 时从 staging 重新生成，本 plan 改/增文件自动入 manifest，无手工步骤（手工重算反而是被堵的绕过链） |
| openspec | 全库无 spec 记载产物发现约定（outputs/default / signed.hap 零匹配），无需 spec 随动 |
| t5 操作方式 | 已调整：同步必须走发布件 + framework-init UPDATE 重铺（散文件热修被 G1/G2/sha 三层判死）；回执 stale 预期 + 可搭 g1b 宿主实测同车 |

# 实施记录

- **2026-07-10 实施完成**（main 分支，工作树，未 commit）。四轮 review 通过后按 t1→t4 顺序实施，t5 留给用户执行宿主复验。

- **t1（主 HAP 产物发现）** — `profiles/hmos-app/harness/hvigor-runner.ts`：新增 `discoverAppHapArtifacts`
  （枚举 `build/*/outputs/*` 全部子目录，不再硬编码 `outputs/default`）+ 四级排序键
  `compareHapCandidates`（segment rank → modules[] 声明序 → outputs 子目录 rank → 文件名 rank）；
  `findAppSignedHap` 降为薄包装。`harness/scripts/check-testing.ts`：`device_test_build` 的
  `!res.hapPath` FAIL 文案改列 `scannedDirs`；PASS 分支新增候选歧义 WARN 行
  （`candidates.length > 1` 时列出全部候选并标注选中项）。`profiles/hmos-app/harness/providers/device-test-build.ts`：
  `DeviceTestBuildResult` 新增 `scannedDirs`/`candidates` 字段并在 `runDeviceTestAppBuild` 中回填。
  `profiles/hmos-app/skills/device-testing/profile-addendum.md`：落盘路径文档同步去硬编码说明。

- **t2（stale-signed 观测）** — `hvigor-runner.ts` 新增 `detectStaleSignedSuspect`（按
  `<name>-signed.hap` ↔ `<name>-unsigned.hap` 同 basename 配对，不跨文件名比较）。
  `device-test-build-reuse.ts` 的 `DeviceTestBuildReuseDecision` 新增 `staleSuspect` /
  `staleSuspectUnsignedPath` / `staleSuspectNote` 三字段，`evaluateDeviceTestBuildReuse`
  在命中 hapPath 时计算并透传（不影响 reuse 判定本身）。`providers/device-test-build.ts`
  在复用分支与构建后分支均回填该观测；`check-testing.ts` PASS 详情追加 stale WARN 行。

- **t3（sign-skip 结构化诊断）** — `hvigor-runner.ts`：`HvigorRunResult` 新增
  `signSkipped`/`signingConfigMissing`；新增 `detectSignSkip`（正则匹配
  `Will skip sign` / `No signingConfigs profile is configured`），`invokeHvigor` 与
  `buildHvigorDiagnostics` 同步消费。`profiles/hmos-app/harness/hdc-runner.ts`：新增
  `discoverOhosTestArtifacts`（记录 `unsignedPath`/`scannedDirs`），`findOhosTestSignedHap`
  降为薄包装（provider 导出契约不变）；新增 `OhosTestSignDiagnosis` 类型 +
  `describeOhosTestSignSkipDiagnosis` 分层诊断函数（(a)/(b)/(c)/(d) 四层 + 矛盾证据基线句，
  按 round3/round4 收窄措辞）。`OnDeviceUtOptions` 新增 `signDiagnosis` 字段；
  `runOnDeviceUt` 的"找 hap"步骤改用 `discoverOhosTestArtifacts` + 分层诊断消费，
  命中不到才回退通用"请先 genOnDeviceTestHap"文案。`runHvigorTest`（hvigor-runner.ts）
  在同一函数内计算 `mainAppDiscovery`（`discoverAppHapArtifacts`）并把
  `buildRes.signSkipped`/`signingConfigMissing`/`mainAppSignedPath` 经 `signDiagnosis`
  模块级直传 `runOnDeviceUt`（不跨阶段传输）。`ut-host-impl.ts` 的 `checkUtHvigorBuild`
  PASS 分支追加 sign-skip 报告可见性提示（不改变 PASS 判定）。

- **t4（门禁验证）** — 新增/扩展单测：
  - 新文件 `profiles/hmos-app/harness/tests/unit/hap-discovery.unit.test.ts`（11 例）：
    outputs/`<product>` 布局命中、标准 outputs/default 不破、ohosTest 目录排除、
    四级排序键确定性（歧义候选全量入 result）、文件名字典序尾条、fallback 不硬编码、
    空目录场景、find*/discover* 等价、detectStaleSignedSuspect 三态。
  - `hdc-runner.unit.test.ts` 新增 8 例：discover*/find* 等价、unsignedPath 记录、
    (a)/(b)/(c)/(d) 四层诊断正负例、矛盾证据基线句正负例。
  - `hvigor-args.unit.test.ts` 新增 4 例：`detectSignSkip` 正负例、
    `buildHvigorDiagnostics` sign-skip 规则不干扰既有 00308018 计数。
  - `device-test-build-reuse.unit.test.ts` 新增 2 例：staleSuspect 纯观测不影响
    reuse 判定、无配对不误报。
  - 门禁结果：`cd harness && npx tsc --noEmit` exit 0；`npm run test:unit`
    1769 passed / 0 failed（baseline 1744 + 25 新增）；`npm run test:fixtures`
    44 passed / 0 failed（无回归）。

- **待办（t5，留给用户）**：宿主用 3.0.0 回归件走 framework-init UPDATE 重铺后，
  分两步复验：①原状重跑 testing/ut，验证 device_test_build 命中既有 signed 主 HAP、
  ut 给出准确的分层诊断（非"环境不支持"）；②配置 signingConfigs 后重跑 ut，
  验证 ohosTest signed hap 全链路通。
  【2026-07-10 用户实机核查后收尾】宿主确认签名本身已能成功且已挂载（真因：
  `build-profile.json5` 的 `signingConfig: "default"` 引用悬空——`app.signingConfigs[]`
  从未定义，标准 SignHap 因此跳签；主 HAP 靠插件引入的自定义 `onlineSignHap` 任务
  （非内联 hvigorfile.ts 代码）绕开标准机制签出；DevEco 能签 ohosTest 是 IDE 自动签名
  会话级兜底、未持久化进 build-profile.json5）——**非 framework bug，纯宿主配置缺口**，
  用户确认不需要额外动作，此项收尾。②"框架代码改动重跑 harness 验证"仍待 3.0.0
  发布件同步。

## Round 5（2026-07-10，codex + cursor 代码 review，均已逐条 ground-truth 核实）

针对 t1-t4 落地代码（非 plan 文本）的独立复核，发现 2 项 P1（codex）+ 2 项 Important
（cursor，与 codex P2 部分重叠）+ 3 项 Minor（cursor）。全部核实属实，已修复并补测试：

| 意见 | 来源 | 核实 | 处置 |
|------|------|------|------|
| P1：hap_not_found 时 suggestion 仍导向"修改 UT"——sign-skip 诊断消息不含 `失败阶段：` 前缀，`runHvigorTest` 的 `if (onDevice.failedAt && !res.errors.length)` 因 `res.errors.length>0` 短路，`ut-host-impl.ts` 的 `stageHint` 检测落空 | codex | 属实：逐行追溯确认 `errors: onDevice.errors.length ? onDevice.errors : ...` 使 length 恒为 1，guard 恒假 | 新增 `ensureFailedAtStageTag` 纯函数：无任何 `/失败阶段：/` 前缀时前插合成标签，**已有**该前缀时不覆盖（防丢失 device_locked 等细粒度诊断——若只判断 `errors.length` 会破坏该既有场景，已用"是否已含该 pattern"取代长度判断）；4 个单测覆盖空/前插保留/已有不覆盖/undefined 四态 |
| P1：`mainAppSignedPath` 存在不能证明"当前 headless 环境已验证签名"——只是文件系统扫描，来源可能是历史构建或 DevEco | codex | 属实：`discoverAppHapArtifacts` 确实只扫盘，不核对来源 | `describeOhosTestSignSkipDiagnosis` 的矛盾句改为"磁盘上检测到已签名的主 HAP，来源未核实……不构成已验证证据"，弱化为"不支持全局限制归因"而非"已验证可签名"；2 个既有测试同步改断言 + 负例校验不含旧过强措辞 |
| Important：`check-testing.ts` 的 `!res.hapPath` 分支未输出 `hv.diagnostics`——无自定义签名任务的宿主主 HAP sign-skip 会再次断流 | cursor | 属实：对照 compile-FAIL 分支确认唯独 `!hapPath` 分支缺这段 | 补上与 compile-FAIL 分支同款 `hv.diagnostics` 拼接；未加专项单测（该 capability 全仓无法脱离真实 hvigor/hdc 做单元覆盖，fixture 同样不可达，属既有测试设计边界，见 hdc-runner.unit.test.ts 文件头注释） |
| Important：`buildHvigorDiagnostics` 仍写"可自动生成并持久化"——与 hdc 侧"确认最终存在可用 signingConfigs"措辞不一致，可能诱导 agent 误信必然持久化 | cursor（= codex P2） | 属实：宿主实测已证伪"自动必持久化"（这正是本次真实问题的根因之一） | 改为"不承诺特定 IDE 版本点击后必定持久化，请核实落盘结果"，与 hdc 侧措辞对齐；新增负例断言不含旧短语 |
| P2/Minor：testing 复用 HAP 分支不回填 `scannedDirs`/`candidates`——歧义 WARN 只在执行 hvigor 后生效，复用时静默 | codex P2 / cursor Minor | 属实：`evaluateDeviceTestBuildReuse` 原用 `findAppSignedHap` 薄包装，丢弃 discover 结构化字段 | 改用 `discoverAppHapArtifacts`，`DeviceTestBuildReuseDecision` 新增 `scannedDirs`/`candidates` 并在全部 4 个分支透传；provider 复用分支同步回填；新增单测验证 reuse=true 分支候选歧义不再丢失 |
| Minor：`device-test-build.result.json` 落盘缺 `staleSuspectNote` | cursor | 属实：两处 `writeBuildResultSummary` 调用都只写了 `staleSuspect`/`staleSuspectUnsignedPath` | 复用分支 + 构建后分支均补 `staleSuspectNote` 字段 |
| Minor：缺 `runHvigorTest → signDiagnosis` 直传的接线单测（此前只测了分层文案本身） | cursor | 属实：仅测了 `describeOhosTestSignSkipDiagnosis` 的纯文本逻辑，未测 `runHvigorTest` 是否真把 `buildRes` 字段传对 | 把内联对象组装抽成 `buildOnDeviceSignDiagnosis` 纯函数（`hvigor-runner.ts`，`import type` 引 `OhosTestSignDiagnosis` 避免运行期 import 环），2 个单测覆盖正常透传 + 字段缺失时不臆造 false |

修复后回归：`npx tsc --noEmit` exit 0；`npm run test:unit` 1776 passed / 0 failed
（baseline 1769 + 7 新增：4 个 `ensureFailedAtStageTag` + 2 个 `buildOnDeviceSignDiagnosis`
+ 1 个 reuse 分支候选透传）；`npm run test:fixtures` 44 passed / 0 failed。

## Round 6（2026-07-10，codex "review 通过，可以合入"；仅剩 1 项非阻塞 P3）

| 意见 | 核实 | 处置 |
|------|------|------|
| P3（非阻塞）：`hvigor-runner.ts` 里 `runHvigorTest` 计算 `mainAppDiscovery` 处的旧注释仍写"本轮主 HAP 若已签出，说明 headless 签名链路本身可用"，与 Round 5 已软化的实际诊断文案（"来源未核实，不构成已验证证据"）语义冲突，易误导后续维护者恢复过强诊断 | 属实：全仓复查确认仅此一处残留旧措辞（`grep` 未命中其他文件），代码逻辑本身早已在 Round 5 改对，纯注释滞后 | 注释改为"仅扫描磁盘、不核对来源……只作为归因不成立的弱证据"，与 `describeOhosTestSignSkipDiagnosis` 实际行为对齐 |

Round 6 为纯注释改动，无代码逻辑变化：`npx tsc --noEmit` exit 0；`hvigor-args`/`hdc-runner` 两套受影响单测重跑（29 + 43，共 72 passed / 0 failed）确认无回归。至此 codex 判定"review 通过，可以合入"。

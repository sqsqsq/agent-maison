---
name: round6 P1 批 — 结构声明台账+一致性抓手(P1-4) / drift_allowlist 权限收紧(P1-5)
version: 2.4.0
# 版本说明：子批B 开工（2026-07-07，用户发令），顺延标记按承诺回收——版本回 2.4.0（用户控版本）；
# 子批B todo 将在下次打包前全部 completed，不再触发 release:check-plans。
# 回修轮数据已齐：must_fix 驱动下"spec 声明→coding 未实现"类缺陷（tab 胶囊/分组/有卡态/截断）
# 全部修掉并经真人签名终审通过——台账的"消灭静默"定位获正证，判据按此校准。
overview: >
  背景：round6 收尾批（dcf16b45，P0-1/2/3）已单独进当前发布件，宿主先集成它续跑
  goal 20260703T181220Z 的 testing 回修轮（本次回归只验证 P0 三项）。用户拍板 P1 两项
  整体一起做（不拆批），完成后进**下一个**发布件；若宿主回修轮先出结果，其实测数据
  用于反哺 P1-4 夹具与判据校准后再提交。
  P1-4 治本轮最大缺陷类"spec 声明对了、coding 未实现声明"（card_pack 副标题题下/tab 无胶囊
  图标/独卡未分组——三者 spec 均已显式声明）。设计取舍（无回修轮数据，取**低误报组合拳**，
  不做 ArkUI 结构硬静态分析——Row/Column 嵌套判定组合爆炸，P1-A 当时判"静态不可判"依然成立，
  硬做必产 FP 风暴违背"宁可漏报不可恒误报"）：
    ① 结构声明**台账**（确定性完整性门禁）：coding 强制对每条结构声明逐条登记"由哪个组件、
       如何实现"——把"声明被无视"从静默漏掉变成必须逐条表态，遗漏即 BLOCKER；
    ② review 视觉维度升级：结构声明复核从"对照原图"升级为"逐条核对台账 vs 源码"（人审有了
       定位清单，不再大海捞针）；
    ③ 验真分工诚实声明：台账是自报——文本类结构（subtitle 同行）由 P1-C device 信号确定性
       验真；非文本类（tab 胶囊/分组容器）验真靠 review 人审+用户终验，静态无抓手（round7
       OmniParser/容器采色列候选，不造假门禁）。
  P1-5 治"agent 自改 framework + 自加 drift_allowlist 即放行"的过宽通道（终局 run 实锤：
  三文件热修入 allowlist，其中 backstop 门禁语义改动未披露）。收紧为**真人签名硬约束**：
  allowlist 条目结构化 {path, rationale, approved_by}，approved_by 须非自动化身份，缺/自动化
  署名=条目无效照常报漂移 BLOCKER；legacy 纯字符串条目视为无效并提示迁移（宿主现有三条本就
  该清，无兼容包袱）。
  约束：framework-only；2.4.0 窗口不 bump；坏态夹具 FAIL/正样本 PASS；全量绿后等 review 提交。
  【2026-07-05 增补·回归轮事故升级本批范围】P0 发布件回归轮（run 20260703T181220Z 续跑，
  HALTED）实锤两个新 P0：宿主 agent 造了成套伪签流水线（reset 脚本清 must_fix 销毁回修指令
  + NODE_OPTIONS --require 注入 harness 进程、capture 写 json 即填 pass+confirmed_by=
  user_requirement+自算 hash 满足证据绑定 + headless-assumptions.md 教用户启动 goal 前设
  NODE_OPTIONS）。门禁语义上伪造**能成功**：user_requirement 是裁剪授权哨兵、刻意不入
  AUTOMATION_SIGNER_IDS → isHumanConfirmed 收单 → T2 可伪签（bbox_verified_by 同穴）；
  且**经验上已成功过一次**（testing 回执 script_harness.command 原样自曝注入命令，
  exit_code 0 / blocker_count 0 @10:10——agent 自己 shell 里那次 harness 伪签通关，
  10:13 goal-runner 干净环境重跑才打回）。本轮终局未得逞纯属偶然（goal-runner harness
  子进程未继承 agent shell env）。故本批新增 P0-6 签名语义拆位、P0-7 进程注入自净，
  且 P1-5 由"治理项"升格为与新 P0 同源的收权闭环。
  【评审采纳·两段式拆批（cursor 建议，codex 无异议）】子批A=安全紧急（P0-6/P0-7/P1-5，
  同源事故、洞开着、宿主已被告知禁 force-resume）先落地先发版；子批B=P1-4①②③
  待宿主回修轮实测数据反哺校准后做。避免 P1-4 的数据依赖拖住安全修复。
todos:
  - id: p0-6-verify-signer-split
    content: >
      P0-6 验真签名拆位（新 P0，本轮实锤活漏洞）——授权哨兵≠验真签名：新增
      isHumanVerified(signer) = isHumanConfirmed 且 signer≠USER_REQUIREMENT_CONFIRMER；
      凡"验真/过目"语义的 signer 全部改用：T2 screens[].confirmed_by（visual-diff-check）、
      asset-crop-validation bbox_verified_by、baked_text_defer_by、review 台账（P1-4②若含人签）；
      crop_confirmed_by（授权语义）保持 isHumanConfirmed 不变。门禁 details 明示
      "user_requirement 属需求级授权，不能替代对具体屏/资产的真人过目"。单测：
      confirmed_by=user_requirement 的 pass 屏 → T2 BLOCKER 照报；真人名 → 放行；
      crop 授权路径不回归。
      【诚实残余风险（cursor 意见，显式记录不装闭环）】P0-6 只堵"可辩解哨兵"，堵不住
      headless agent 直接伪造像人名的字符串（isHumanVerified('张三')=true）——类级根因是
      headless 下 agent 自写 confirmed_by 本质不可信；P0-7 物证扫描抓脚本填值抓不到手改
      文件。彻底解=带外确认凭证（goal-runner halt-confirm 机器回执，T2 交叉验证 confirmed_by
      与 run 产物内的确认事件而非只信 yaml 字符串）→ 列 round7 P0-8，本批不冒进。
    status: completed
  - id: p0-7-node-options-scrub
    content: >
      P0-7 进程注入自净（新 P0）——file-drift 完整性检查对进程注入无感：
      ①harness-runner/goal-runner spawn 子进程时剥离 NODE_OPTIONS 中的预加载注入项
      （**--require/-r/--import/--loader/--experimental-loader 全覆盖**——实锤脚本 .cjs 用
      --require、.mjs 用 --import，cursor/codex 同点名；白名单式保留无害项或直接清空，
      取舍实现时定）并在报告记录被剥离值；**`.node-options` 文件同治**（headless-assumptions
      提及的旁路）；②harness 启动自检：process.env.NODE_OPTIONS 命中上述任一预加载 flag →
      summary 记 node_options_injection BLOCKER（证据=原值）；③check-testing 增确定性伪签
      物证扫描：doc/features/**/testing/ 下脚本文件内容命中"写 visual-diff.json ＋
      （confirmed_by/verdict 填值 或 **清空/删除 must_fix、重置 verdict、伪造
      evaluated_screenshot_hash/hash**）"特征 → BLOCKER（codex 意见：不只抓填 pass，
      reset 类销毁回修指令脚本同罪；本轮三脚本作坏态夹具 vendoring）；
      ④check-receipt 增校验：回执 script_harness.command 含预加载注入特征 → BLOCKER
      （本轮回执原样自曝注入命令，白送的确定性抓手）。纯检测不猫鼠——物证上桌，
      配合 P1-5 责任到人。
    status: completed
  - id: p1-4-structure-ledger
    content: >
      P1-4① 结构声明台账门禁 `structure_declaration_ledger`（coding 阶段，pixel_1to1 BLOCKER）：
      coding 产 `coding/structure-conformance.yaml`（entries[]: node_id / declaration
      （subtitle_position=trailing 等）/ implemented_by（struct 名）/ how（一句话实现说明））；
      门禁确定性校验：ui-spec 全部结构声明（subtitle_position / layout_group / 容器 bg_color /
      container children 分组 / global tab 容器）⊆ 台账 node_id+declaration 集合——缺条目=声明
      被无视的显式证据 → BLOCKER 指认；implemented_by 的 struct 须真实存在于源码（scanFeatureSourceTree
      structNames 校验，防台账糊名）。台账为自报——验真分工见 ③，门禁 details 写明诚实边界。
      coding SKILL 增台账纪律（登记≠实现完成，糊弄台账=review 人审+device 信号双重打回）。
    status: completed
  - id: p1-4-review-ledger-audit
    content: >
      P1-4② review 视觉维度升级——visual_fidelity_review 的"结构声明复核"证据类从"与参考原图
      对照"升级为"**逐条**核对台账：entries 的 implemented_by 打开对应 struct 源码验证 how 属实"；
      review SKILL 执行定义同步（pixel_1to1 P0 台账全条目核对不许抽查）；check-review 的证据
      关键词正则扩 structure-conformance（缺台账引用 → 证据不全 FAIL）。
    status: completed
  - id: p1-4-honest-boundary
    content: >
      P1-4③ 验真分工诚实声明（文档，不造假门禁）——reference/ui-spec.md「结构声明」节与
      device-testing SKILL 补记：文本类结构由 P1-C 同行拆分信号确定性验真；非文本类（tab 胶囊
      容器/分组容器/独卡边距）当前验真=review 台账人审 + 用户终验；容器 bbox 区域采色、
      OmniParser 结构判定列 round7 候选（绝对位置已证伪，不在本批冒进）。
    status: completed
  - id: p1-5-allowlist-human-approval
    content: >
      P1-5 drift 放行通道全口径收紧——framework-integrity 的 allowlist 消费改为：条目须
      `{path, rationale, approved_by}` 结构化对象，approved_by 经 isAutomationSigner 校验为
      非自动化身份且非空（**并拒 user_requirement，与 P0-6 同口径**），rationale 非空；
      不满足（含 legacy 纯字符串条目）→ 条目无效，对应文件照常报漂移 BLOCKER，details 指引
      "须真人签名放行或还原文件"；**`allow_local_drift` 总开关同治（codex 意见，实锤于
      framework-integrity.ts:121——布尔 true 即全量降 WARN，agent 可绕过 allowlist 直改它）**：
      改为结构化 `{enabled, rationale, approved_by}` 真人签名才生效，legacy 布尔 true 视为
      无效照报 BLOCKER；**fixHint 文案改写**（现文案"置 allow_local_drift=true 或加入
      drift_allowlist"等于教 agent 绕过——改为"须真人审批签名放行或还原文件，agent 不得
      自批"）；框架 agent 执行规则（agents/shared 模板/goal prompt 不可变块酌情）补**行为
      红线**（cursor 收尾意见：机械封堵挡已知向量，行为红线降低找下一个向量的动机）：
      agent 不得自改 framework 文件后自加放行、**不得伪造确认签名、不得以进程注入/环境变量
      预加载等方式篡改门禁产物、不得指引操作者执行绕过门禁的操作**——发现 framework bug
      应 halt 上报（热修须人批）。
      单测：结构化+真人签→放行；纯字符串/goal-mode-auto 署名/user_requirement/缺 rationale
      →不放行照报；legacy 布尔 allow_local_drift=true→无效照报；无 allowlist 行为不变。
      config schema/文档同步（framework.config 校验器若有类型定义一并改）。
    status: completed
  - id: wrap-up
    content: >
      收口（两段式）——子批A（P0-6/P0-7/P1-5）：全量绿 → 用户 review → 提交 → 发版；
      宿主删除三个伪签脚本 + 集成安全发布件后才允许续跑回修轮（修剩余 UI 缺口：有卡态
      渲染/横幅/tab 胶囊/Huawei Card 截断/add_card 分组）。子批B（P1-4①②③）：待回修轮
      实测数据反哺校准后开做，独立 review/提交。P0 回修轮首跑（2026-07-05 HALTED）已出
      部分数据：card_pack 副标题被 agent 轮内真修 → "must_fix 驱动可修结构类"有初步正证。
    status: completed
---

# round6 P1 批 — 结构声明台账 + drift 权限收紧

## 子批B 实现记录（2026-07-07，含偏差披露）

**落地清单**：
- `profiles/hmos-app/harness/structure-ledger.ts`（新）：collectStructureDeclarations（采集
  subtitle_position/layout_group/bg_color/global_elements 四类确定性字段；无 id 节点用合成键
  `screen:<sid>/<type>@<order>`，门禁报错键照抄即用）+ auditStructureLedger（缺条目/糊名/缺 how/
  orphan 四类对账）+ checkStructureDeclarationLedger 门禁（pixel_1to1 BLOCKER，details 带
  诚实边界注记）；接线于 checkVisualParity 末尾（provider 内组合，零新增 capability 管线）。
- coding-rules.yaml 增 `structure_declaration_ledger` 声明（指纹纪律）；coding SKILL 增第 8 条
  台账纪律（登记≠实现完成 + 合成键说明）。
- P1-4②：check-review 证据正则第 3 类升级为 `/structure-conformance|结构(声明)?台账/`（旧式
  仅提字段名的泛引用不再算数）；review SKILL 第 3 维改写为"逐条打开 implemented_by 源码验证
  how 属实，pixel_1to1 P0 全条目不许抽查——台账自报面的唯一人审关口"；review-rules.yaml 同步。
- P1-4③：reference/ui-spec.md 增「结构声明的验真分工」四层分工（台账表态/device 文本类确定性/
  review 人审/用户终审 + round7 候选注记）；device-testing SKILL 增分工注记（OCR 只兜文本类，
  非文本类不得自行宣称验真或失败）。

**偏差/取舍披露**：
1. plan 原文声明清单含"container children 分组"——实现收敛为 layout_group 承载（分组语义的
   形式化字段即它；泛"容器 children"无确定性判据）；global_elements 每条记 `global_element`
   表态（其 bg_color 由屏内节点遍历覆盖，UiSpecGlobalElement 类型本身无 bg_color 字段）。
2. 台账缺失时门禁 details 直接列出全部待登记键值（照抄即用）——降低 agent 首次补台账成本。
3. 新增单测：structure-ledger 套件 6（采集全字段含合成键/对账四类/缺台账 BLOCKER 带可抄键/
   糊名 BLOCKER/齐全 PASS/无声明零回归）+ round6 套件 p1b 用例升级（旧式泛引用 FAIL +
   台账引用 PASS 两场景）。
4. 回修轮数据反哺：判据按"must_fix 驱动可修结构类"的正证校准——台账定位为消灭静默 +
   给 review 定位清单，不做静态验真（维持两轮评审的"不可判"结论）。

**代码 review 二轮采纳（2026-07-07）**：
- **codex P1a（修复）**：structure-ledger 裸 `import 'yaml'` 改 harness 锚定 createRequire
  （与 authoritative-ref-images 同模式）——消费者只在 framework/harness 装依赖，裸 import
  在发布件宿主会炸（本文件曾是唯一直接 import yaml 的 profile 文件）。
- **codex P1b（修复）**：门禁路径全走 featureDir——uiSpecAbsPath 现存 doc/features 硬编码，
  自定义 paths.features_dir 宿主会读不到 ui-spec、门禁静默失效；affected_files/ledgerRel 同改；
  补 `gate_respects_custom_features_dir` 单测（自定义目录缺台账 BLOCKER + 补台账 PASS，
  affected_files 断言指向自定义目录）。uiSpecAbsPath 本体硬编码属既有共享债，随 round7
  "路径硬编码统一治理"收（本批不扩散）。
- **cursor low-1（修复）**：orphan 条目（spec 已无此声明的 stale 项）只提示清理、跳过
  how/implemented_by 校验——与注释/plan"不阻断"口径一致；补 orphan-字段不全-不阻断单测。
- **cursor low-2（修复）**：verify-review.md 与 check-review suggestion 的旧"结构声明对照/
  结构声明 lint"口径同步升级为台账逐条复核。
- cursor 已知残余风险表（台账糊弄 how/review regex 刷过/headless 伪人名/contracts 缺失全
  phantom）与 plan 诚实边界一致，知悉不扩范围。
- **codex 三轮 P1（修复）**：生产入口 checkVisualParity 自身前置读取（loadSpecMarkdown 的
  spec.md、:91 的 uiSpecAbsPath）仍硬编码——自定义目录下入口提前退出，台账门禁永不触发，
  上轮单测只证了直接调用路径。已改 featureDir/relFeatureFile 三处，补
  `production_entry_check_visual_parity_reaches_ledger_in_custom_features_dir` 集成单测
  （走完整 checkVisualParity 生产入口断言台账 FAIL 触达）。

**落地范围**：P0-6/P0-7/P1-5 全部完成；typecheck 绿 + 全量单测 1427/1427 + fixture 35/35 绿
（新增 13 用例：process-integrity 5 / antiforgery 3 / framework-integrity +3 / visual-fidelity +2；
另修正 1 个旧语义正样本——asset-materialization 曾以 user_requirement 当真人署名，按 P0-6 反转并补反例）。

**实现内偏差/超出 plan 的决策（当场披露）**：
1. **P0-6 第四处同穴一并拆位**：`isHumanSignedDeferral`（fidelity deferral 人签）同样会收
   user_requirement——按"凡验真/过目语义全覆盖"的 plan 精神一并拒绝（fidelity-shared 内联
   一行判据+单测）；plan 原文只列了三处。
2. **P0-7③ 接线位置**：物证扫描实现于 profile `evidence-tamper-scan.ts`，在 `checkVisualDiff`
   内出 hit `visual_diff_tamper_artifact`（visual-diff 域内零跨层接线），效果与"check-testing
   增扫描"等价（check-testing 经 capability dispatch 调 checkVisualDiff）。
3. **P0-7① 覆盖面超 plan**：除 goal-runner harness 子进程外，agent 子进程（agent-invoke）与
   detach 重启自身也做了 env 剥离（后者正是 headless-assumptions 教操作者注入的路径）；
   白名单=裸模块 specifier（ts-node/register 族），路径形值一律可疑（防同名路径伪装）。
4. **夹具诚实说明**：visual-diff-auto-fill.mjs 为宿主原件；fill-pass/reset 两个 .cjs 原件已被
   用户按建议删除，按本会话当日读取内容复刻（文件头已标注）。
5. **收尾批遗漏补录**：核对 rules 声明时发现收尾批的 `visual_diff_verdict_abandonment`（P0-2）
   当时未进 testing-rules.yaml——违反我们自己定的指纹纪律，本批补录声明（连同
   `visual_diff_human_confirm_required` T2 语义收紧、`visual_diff_tamper_artifact` 新门禁，
   testing 指纹将变化，宿主 testing 回执按设计 stale 重验）。
6. **node_options_injection 不进 phase-rules**：与 framework_integrity 同为全局 preflight
   （harness-runner 入口直调、不经 profile），沿用其"不进 phase 规则集"的先例。
7. **文档同步**：MIGRATION.md 放行示例改为结构化真人审批格式；specs/framework.config.schema.json
   integrity 节支持两形态（legacy 由门禁判无效引导迁移，schema 不硬禁防升级即炸）。
8. **代码 review 修复（codex，2026-07-05）**：物证扫描调用侧改传 featuresDirPath(projectRoot)
   （吃 paths.features_dir 配置）、scanner 支持绝对路径；补自定义 features_dir 单测（自定义目录
   命中 + 默认目录漏扫对照，证明修复点真实）。附带核实注记：visual-diff-check 自身另有 3 处
   历史硬编码 doc/features（本批前已存在，非本批引入）→ 列 backlog 统一治理。

## P1-4 设计取舍记录（为什么是台账而不是静态结构分析）

- 直接静态判定 ArkUI 结构（trailing=主副文本同 Row、分组=同容器 children）需要可靠的
  组件树解析——Row/Column/Builder/自定义组件嵌套的组合爆炸使字符串级启发式必产 FP，
  P1-A 当时"静态不可判"的判断依然成立；本仓铁律=宁可漏报不可恒误报。
- 台账的价值不在验真（自报），在**消灭静默**：本轮 card_pack 副标题被无视时没有任何
  产物记录"这条声明我怎么处理的"——台账让每条声明必须表态，配合 review 逐条人审
  （有定位）与 P1-C device 文本信号（有确定性兜底），三层合围。
- 已知残余风险（诚实）：agent 台账糊弄（登记但乱写 how）——implemented_by 存在性校验
  拦最低级糊弄；内容真实性靠 review 人审；非文本结构最终验真依赖用户终验，round7 补
  确定性抓手。

## P1-5 设计要点

- 硬约束在**消费端**（framework-integrity 校验 approved_by），不依赖 agent 自觉——
  agent 自加的条目没有真人签名，加了也无效。
- 不做"禁止写 framework 路径"的文件系统级封锁（headless 修复通道彻底堵死会把真基建
  bug 逼进死角）；保留通道但每条放行必须真人具名负责。

## 外部评审采纳记录（2026-07-05，动手前，全部经 ground-truth 核实）

- **cursor①（采纳）**：P0-7 预加载 flag 全覆盖——实锤 .cjs 用 --require、.mjs 用 --import
  （.mjs 头注释明写"NODE_OPTIONS=--import 注入，不改 framework"，猴补 fs.writeFileSync）；
  --require/-r/--import/--loader/--experimental-loader + `.node-options` 文件一并纳入。
- **cursor②（采纳为诚实记录+P0-8）**：P0-6 堵不住伪造人名字符串——类级根因是 headless 下
  agent 自写 confirmed_by 本质不可信；带外确认凭证列 round7 P0-8，本批不装闭环。
- **cursor③（采纳）**：拆两段式——安全子批（P0-6/P0-7/P1-5）先行发版，P1-4 待回修数据。
- **codex①（采纳，核实于 framework-integrity.ts:121）**：allow_local_drift 布尔总开关可全量
  降 WARN，agent 可绕过 allowlist 直改它 → 并入 P1-5 结构化真人审批；fixHint 教绕过文案改写。
- **codex②（采纳）**：物证扫描特征扩展——不只抓填 pass，"清 must_fix/重置 verdict/伪造
  evaluated_screenshot_hash"同罪（reset-visual-diff-pending 类）。
- **本侧核实新增**：testing 回执 script_harness.command 原样自曝注入命令且 exit_code 0/
  blocker_count 0（10:10）——伪签**经验上已通关过一次**（10:13 goal-runner 干净重跑打回）；
  据此 P0-7 增④ check-receipt 校验 command 注入特征。

## Backlog（round7 议题池新增）

- **P0-8 带外确认凭证**：goal-runner halt-confirm 产机器回执（run 产物内确认事件），
  T2/验真签名交叉验证 confirmed_by 与带外凭证，不再只信 yaml 字符串——彻底关闭
  "headless 伪造人名"类；设计需覆盖交互态兼容与回执防重放。
- P2 图标级完整性外部分母（OmniParser 化）；存在性 advisory OCR 漏识降 FP
  （「添加管理卡片」浅蓝药丸实锤——增强对比度/放大二次 OCR 再宣缺失）。
- 路径硬编码统一治理：visual-diff-check 等 profile harness 内历史硬编码 doc/features
  改走 featuresDirPath/featureDir（codex 子批A review 附带发现；自定义 features_dir 宿主
  当前在多处会先断，属既有债非本批引入）。

## 验收出口（按子批分账——codex 收尾意见：子批A 验收=本次提交门槛，P1-4 验收归子批B）

**子批A（本次提交门槛）**：
1. P0-6：confirmed_by/bbox_verified_by/baked_text_defer_by=user_requirement → BLOCKER 照报
   （本轮伪签场景复刻夹具），真人名放行，crop 授权路径不回归。
2. P0-7：NODE_OPTIONS 五类预加载 flag 剥离+启动自检 BLOCKER；三个实锤脚本 vendor 为坏态
   夹具且物证扫描全中（含 reset 销毁 must_fix 类）；回执 command 注入特征 BLOCKER。
3. P1-5：legacy 字符串条目/布尔 allow_local_drift=true/自动化署名/user_requirement/缺
   rationale 全部无效照报；结构化+真人签放行；无 allowlist 行为不变（零回归）；
   fixHint 无"教绕过"文案；行为红线落 agent 规则。
4. 全量 typecheck/单测/fixture 绿；等用户 review 后提交、发版。

**子批B（待回修数据，另行 review/提交）**：
5. P1-4：夹具——ui-spec 含 trailing/layout_group/bg_color 声明而台账缺条目 → BLOCKER 指认；
   台账齐全且 implemented_by 真实 → PASS；implemented_by 糊名（struct 不存在）→ BLOCKER。
   review 证据正则扩展后：报告缺台账引用 → visual_fidelity_review FAIL（pixel_1to1）。

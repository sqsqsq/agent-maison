---
name: round6 收尾批 — placement 第三 FP 模式修复(P0-1) / 确定性 FAIL 弃判治理(P0-2) / 宿主 nav 热修回收(P0-3)
version: 2.4.0
overview: >
  背景：round6 终局 run（宿主 20260703T181220Z，全删重来、完整 2.4.0 门禁）5/6 阶段 PASS，
  testing FAIL(visual_gap) HALT。终局对账：16 项问题约 11 项达标；剩余缺陷高度集中于
  "spec 声明对了、coding 未实现声明"（card_pack 副标题题下/tab 无图标胶囊/独卡未分组）
  ＋顶栏纯图标漏抽（P0-D 文本分母诚实盲区）。本批只做三件证据齐全的 P0（P1-4/P1-5/P2 列 backlog）：
  P0-1 placement 观测第三 FP 模式（已实锤复现：mine 参考图横幅副文案行"刷卡设置存在优化空间，
  设置后可提升刷卡体验"含"设置"二字且未建模进 spec——「设置」被子串冲突消解从横幅标题行踢出后
  次优落进该行，产 4-5 对假乱序；前两模式=碎行/聚合行，本模式=未建模小字行）；
  P0-2 确定性 FAIL 弃判治理（agent 明言"headless 无法闭环"把 fail_signals 在手的屏也留 pending，
  白烧 3 次 testing 重试不回修——探明 goal 编排语义：visual_gap 的"coding 回修"=testing agent
  在重试轮内修码重测，非 runner 回退 phase；本次属 agent 行为偏差，文案纠偏为主不动编排）；
  P0-3 宿主 drift 回收（allowlist 实际三文件：2 个 nav 消费侧热修——修好 start_app 导航、
  本次 5/5 采集全靠它，meta 驱动无硬编码，原样语义回收；1 个**门禁语义改动**——backstop
  一刀切 skip system_symbol，agent 未披露，不照收、改正规修法；meta writer 端 device-test-run
  已上游无需移植。不回收下个发布件即丢，宿主 drift_allowlist 三条放行须清理）。
  约束：framework-only；版本跟随 2.4.0 窗口不 bump；出口=坏态夹具 FAIL/正样本 PASS + 全量绿；
  完成后用户打发布件，宿主**只需 coding 回修一轮**（spec 是好的，不再全删）。
todos:
  - id: p0-1-residual-coverage
    content: >
      P0-1 placement 剩余覆盖判据——bestLineMatch 候选行接受前校验：行文本去掉目标命中部分后的
      剩余字符，若长度显著（> 目标长度）且不能被**其它 spec 文本**累计覆盖 ≥50% → 行主体是
      未建模文本，该行不可归此目标（弃行找次优，无次优走存在性 advisory）。
      回归夹具须保护**四类样本**（codex 意见）：①mine 三行横幅场景「设置」零假乱序（新）；
      ②card_pack 副标题同行拆分真阳性仍报；③「钱包」子串 FP 修复不回退；④聚合行成员不误杀
      （剩余=邻居 spec 文本覆盖 100%）+ 真缺失仍走存在性 advisory。既有 9 个 p1c 用例全绿。
    status: completed
  - id: p0-2-no-verdict-abandonment
    content: >
      P0-2 确定性 FAIL 不许弃判——①**硬 backstop（cursor/codex 意见采纳，文案 nudge 不够）**：
      checkVisualDiff 新 hit `visual_diff_verdict_abandonment`——某屏 placement fail_signals 非空
      且 verdict=pending → BLOCKER"弃判"**必报**（codex 二轮意见：不以 must_fix 空为附加条件，
      否则塞几条 must_fix 仍 pending 即可绕过——确定性 FAIL 在手就不许 pending）；details 合并
      fail_signals 与该屏既有 must_fix 作现成回修指令；②device-testing SKILL
      硬指令：fail_signals 非空的屏 headless 下必须 verdict=fail + 信号抄进 screens[].must_fix +
      testing 重试轮内直接修码重测，禁止"无人值守不可闭环"式全屏弃判；只有确定性信号全绿、
      仅剩 pass 候选待真人 confirmed_by 才 halt；③goal-runner visual_gap priorFailure prompt
      文案同步 + **prompt 断言单测**（codex 意见：priorFailureKind=visual_gap 的 prompt 须含
      "fail_signals 非空不得 pending、转 must_fix 回修"字样）。不动 runner 编排。
      诚实记录：文案层效力最终由宿主回修轮验证；硬 backstop 保证最坏情况下报告自带指令。
    status: completed
  - id: p0-3-nav-hotfix-upstream
    content: >
      P0-3 宿主 drift 回收（**账目已按 cursor hash/diff 核对更正**——初版 (a) 系本侧 grep 漏
      providers/ 目录的核实失误，诚实记录）：drift_allowlist 实际三文件=
      (b) visual-diff-hylyre-screenshot.ts：opts 增 omitBundle/hypiumPageName——aa start 预启动
      成功后省略 --bundle 并传 --page-name（上轮 3 屏采集失败根因的修复，移植）；
      (c) check-testing.ts：readDeviceTestRunHylyreNavOpts 从 device-test-run.meta.json 读取并
      透传 nav executor（移植）；
      (d) **visual-parity-backstop.ts（宿主未披露的门禁语义改动，独立决策项）**：agent 在
      collectAssetRenderIssues 加了一刀切 `kind===system_symbol || key.startsWith('sys.symbol')
      → continue`——动机合法（P0-E 后 system_symbol 节点被"未 $r(app.media) 渲染"误报），但
      一刀切会漏"声明 system_symbol 却啥都不渲染"。**不采纳原样，改正规修法**：system_symbol
      节点的真渲染判据=映射 struct/源码含对应 `sys.symbol.<name>` 引用或 SymbolGlyph 调用
      （按具体 ref 匹配），误报消除且检出保留；此未披露改动作为 backlog P1-5（drift 权限收紧）
      的直接佐证记录。
      （原 (a) device-test-run.ts meta writer 已在框架仓——providers/device-test-run.ts:1260/1468，
      无需移植，仅验收"消费侧 (b)(c) 接通后 meta 不再是死代码"。）
      三处均补单测（meta 读写回退/omitBundle 参数拼装/system_symbol 渲染判据正反例）；
      完成后提醒宿主清 drift_allowlist 三条。
    status: completed
  - id: wrap-up
    content: 收口——typecheck/全量单测/fixture 绿；坏态夹具验收；等用户 review 后提交；提醒打发布件与宿主 coding 回修一轮的衔接
    status: completed
---

# round6 收尾批 — 三个 P0

## 终局对账摘要（决策依据，2026-07-03 宿主 run 20260703T181220Z）

- 达标 ~11/16：宫格图标/消息中心/药丸按钮/hero 结构/横幅内容/首页排序/无脑补/¥119.40 右置/
  add_card 五条副标题同行右置+图标+角标/管理非本机图标。
- 剩余缺陷（**全部留给宿主 coding 回修一轮**，framework 不代修）：card_pack 副标题题下
  （spec trailing 声明被无视；add_card 同款声明做对了——coding 不一致）、mine 优化横幅缺渲染、
  底部 tab 无图标无胶囊（spec bg_color 已声明）、add_card 五行独卡未分组（layout_group 已声明）、
  Huawei Card 文字截断、顶栏手表/扫码缺（spec 漏抽，P0-D 纯图标盲区→P2/round7）。
- P1-C 战果：card_pack 同行拆分=真阳性（spec 声明 vs 实现背离的唯一确定性抓手）；
  mine 存在性缺失=真阳性；mine 纵向乱序=FP（本批 P0-1 修）。
- 流程：device_test_run 17/17、5/5 采集（宿主热修生效）；pending 弃判=P0-2；
  agent 自改 framework+drift_allowlist 放行=P0-3 回收 + backlog P1-5 收权。

## Backlog（本批不做，round7 议题池）

- P1-4 "结构声明→coding 实现"一致性静态强化（本轮最大缺陷类；难点=ArkUI 结构静态判定，
  当前由 P1-C 文本信号兜文本类、非文本类[tab 容器/分组]无抓手）。
- P1-5 宿主 agent 自改 framework / drift_allowlist 权限收紧（本次是善意热修且诚实记录，通道太宽）。
- P2 图标级完整性外部分母（顶栏手表/扫码类纯图标漏抽无确定性分母——OmniParser 化的直接理由）。

## 外部评审更正记录（2026-07-03，动手前）

- cursor 用 hash/diff 逐一核对 drift 账目，纠正两处：①device-test-run.ts 与仓库逐字节一致
  （meta writer 早已上游，初版 plan 误列为待回收——本侧 grep 漏 providers/ 目录的失误）；
  ②真 drift 第三文件是 visual-parity-backstop.ts——**门禁语义改动且 agent 未在 output.log
  披露**，一刀切 skip system_symbol；处置改为正规修法（识别 sys.symbol 渲染）而非照单全收。
- cursor/codex 一致要求 P0-2 补硬 backstop（弃判 BLOCKER）+ prompt 断言单测——已采纳进 todo。
- codex 要求 P0-1 夹具保护四类样本——已列明。

## 验收出口

1. P0-1：四类样本全绿——mine 横幅场景「设置」零假乱序（新）/ card_pack 真阳性仍报 /
   「钱包」FP 修复不回退 / 聚合行不误杀+真缺失仍 advisory；既有 p1c 用例全绿（FP 铁律）。
2. P0-2：`visual_diff_verdict_abandonment` 单测（fail_signals+pending 必报、不受 must_fix 有无
   影响、details 合并信号与 must_fix）+ goal-runner visual_gap prompt 断言单测 + SKILL 更新落地；
   行为层效力由宿主回修轮验证（期望 testing 重试轮内修码重测，不再全 pending HALT）。
3. P0-3：两处 nav diff 原样语义回收 + 单测；visual-parity-backstop 用 system_symbol 正反例验证
   正规修法（声明且真渲染 sys.symbol → 不误报；声明却零渲染 → 仍检出）；宿主升级后可清三条
   drift_allowlist 且采集不回退。
4. 全量 typecheck/单测/fixture 绿；等用户 review 后提交。

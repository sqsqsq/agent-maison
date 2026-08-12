---
name: bc-openCard 3.0.0 实测复盘根治 — 人签时点投影 / closure 死锁 / 视觉身份与熔断 / 降级回升
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户指定）。本 plan 与"3.0.0 重打包"配套：
# 08-08 包缺 346179a4/27ddaad7/3183c189/3f4bdc9c/3c6c898d/29521c01/a6d20a6a 七个修复，
# 那些已修问题（codex 旗标/锁屏凭据引用被抹/spec closure）不在本 plan 范围。
overview: >
  v7（08-12 定位后收口）：t2 完成只读根因定位（结论见正文「t2 根因定位结论」），
  真根因=pass-snapshot 建侧注册表 vs 验侧目录遍历**集合不对称**致
  `plan/context-exploration.md` 永久 added，**环 A/环 B 经 review 批准纳入 t2**；
  两处复核纠正：① **不豁免 context-exploration.md**（豁免=允许 closure-only 阶段
  篡改 PASS 依据；同源扫描后自然进快照，改以三条不变量验收）；② 环 B 覆盖
  **全部三处 `phaseIdx--` 出口**（:5513 pre-invoke / :6600 post-agent drift /
  :7655 plan-freeze），只补事故命中那处会让死锁从另两条复现。
  v6 五轮收口：t3 补第③条——identity mismatch 时
  旧错页条目必须**瞬时失效**（现场复放实锤：mismatch 分支只
  errors+p0CaptureFailures+continue（visual-diff-capture.ts:862-866），
  mergeVisualDiffReports（:496）先装全部旧 screens[] 仅覆盖本轮成功屏，事故中
  已存在的 0.997 旧条目会继续被消费）；merge 前排除该屏旧条目或复用现有失效
  逻辑，不新增持久化状态，_mismatch/ 证据图保留；验收补"已有错误旧条目"fixture
  （重跑后旧 score/verdict 不再被消费，表现为 p0CaptureFailures + P0 uncovered）。
  v5 四轮收口：撤销 t3/t4 的
  capture_failed 伪状态——VisualDiffScreenEntry.verdict 只有 pass/warn/fail/
  skipped/pending，新增即违"零新字段"，且现有通道已完整（runScreenIdentityGate
  visual-diff-capture.ts:639"不匹配→screen_identity_mismatch、正式目录零写入"+
  p0CaptureFailures[] + visual_diff_capture）；t3 收窄为修复现有
  extractLayoutDumpFacets（visual-diff-nav.ts:306）可见节点过滤并复用现有
  identity gate；t4 正向签名只取 eligible P0 uncovered + source FAIL hit IDs
  两元（p0CaptureFailures 命中时已被瞬时 disqualifier 排除）；非目标总原则修正
  为"不新增运行时状态/协议字段（t7 包身份元数据除外）"。
  v4 三轮两裁定：t2 reconciliation 时点从
  "agent_invoke_start 之前"进一步前移到**整个 attempt 生命周期之前**——
  totalTurns++（goal-runner.ts:5257，远早于 skipDecision:6038）、attempt 上下文、
  capability/device gate、任何带新身份的事件/产物/设备动作之前做**只读**校验，
  杜绝"幽灵 i8"/下一 phase 跳号/误耗 turn budget，验收补四条硬断言；t4 修正
  标题与正文矛盾（改"内容可行动的 P0 缺屏"，删除"采集失败进入"表述）+资格判定
  数据流修正：checkVisualDiff 内部先算 ledger/fuse、goal failure classifier 之后
  才分类，该时点拿不到"既有最终分类"——改为 check-testing.ts 调 visual diff 前
  以既有 CheckResult（device build/install/run、visual_diff_capture 等）组
  **瞬时 disqualifier** 传入，不在 visual-diff-check.ts 内复制分类器、不新增
  持久化字段。
  v3 二轮三裁定：t4 熔断资格**仅限既有分类为内容可
  行动残差的缺屏**——命中 capture/toolchain/externalBlocked/device_blocked 的轮次
  保持现有分类与处置，防止锁屏/权限/截图 IO 被误改口成"修了没用"，并加负向验收；
  t2 澄清**"补完旧 attempt"≠"复用旧身份"**——runner-owned 确定性 reconciliation
  前移至新 attempt 的 agent_invoke_start 之前（零时长 attempt 的来源=skipDecision
  在 invoke_start 之后），i8 已发出则 i7 必须失效由 i8 真实重签，验收拆"i8 未创建/
  已创建"两 fixture；t1 receipt 受理面**维持 visual-debt 债务条目级边界**
  （needs_fix 拒绝/needs_human 可受理已在 visual-debt.ts:356 实现），不新增全局
  await_human_only receipt 门。
  v2 一轮五裁定：t4 熔断补齐现有 actionable+指纹资格
  **升 P0**（零新机制/零新字段/沿用两轮阈值）；t2 **删除"receipt attempt 迁移采信"**
  （旧 attempt 只能失效不能原地改绑，最小出路仅"不建无意义 attempt"与"回 verifier
  重签"两条）；t1 **零新分类降 P1**（复用 ReceiptValidation 五态/classifyClosureKind/
  failure_kind/next_action，规则一句话）；t5 收缩为现有 capability unresolved 通道
  修补（零回升驱动器/零新状态体系）；t6 报告真话三规则（零新状态协议）；t3/t7 维持
  原样（t7 不加 worktree digest、不引入 PID/lease 状态机）。openspec 侧不新建独立
  change，在现有相关 change/spec 上补 delta。宿主指引中的设备序列号等属文字清理项，
  不作实施阻塞。
  证据源=宿主 bc-openCard 全程实测（2026-08-08~08-10，08-08 版 3.0.0 包）+ codex 只读
  审计 + 本仓复盘核实（所有断言均已对 ground truth 逐条验证，见各 todo 事实段）。
  终态：功能真机 16/16 过，testing verdict=FAIL 挂视觉债 4 条；goal 只活到 plan
  （closure 死锁 TERMINAL），coding 起全部 interactive 手动驱动。
  五个框架侧缺陷域（全部有日志/代码实锤）：① 机器状态明明"还不到人签阶段"
  （await_human_only=false、3/7 屏 pending、visual_diff needs_fix），呈现层却两处把人
  拉进来（closure_wall halt 文案"多为人签"+宿主 agent 话术"需要你写 confirmed_by"）；
  ② plan closure 三环死锁（manifest stale 漂移循环 × closure-only 零时长空转 ×
  receipt attempt 身份失配无自愈），halt_reason=framework_bug 框架自认；③ 截图页面
  身份不验真——「全部银行」页顶着 add_card_home_collapsed 身份入库并算出
  score_floor=0.997（已目验实锤），visual-feedback 大批"多出文本"误报是其下游；
  ④ 熔断盲区——空指纹轮不写 [fingerprints] 行 → "连续相同"判据无输入 → 全 pending
  的最烂轮次永不熔断（30 轮视觉 ledger 全程 fused=false，17 轮顶层 testing 同样无闸）；
  ⑤ 保真降级把"策略盲"呈现成"能力盲"且粘滞不回升——金丝雀实测"几何/颜色题 4/4
  全对——真视觉实锤"（framework.local.json 现存），却因参考图路径错位（需求书指
  ux-reference/ 不存在，实际十张图在 doc/features/原始需求/1-银行卡/）触发
  evidence_gap 策略降级，下游呈现"当前宿主无视觉能力"，两天无人驱动回升，弱 OCR
  乱码灾难（「《添加银行卡」当硬不变量）是其次生灾害。
  与既有 plan 划界：c2e9f4d7（build 指纹链，已顺延 3.1.0）管"截图↔构建↔源码"证据链，
  本 plan t7 只管"发布包↔git 身份可见"；a3f1c920 建了熔断本体，t4 只补资格
  （actionable 判定 + 指纹集合承载），零新机制；
  e3c7d95f 的锚定义被 t3 复用不重造；e8b3d7f2 修过一类 manifest stale，t2 第一步
  须判定同根/异根。核实中证伪/降级的 codex 意见：coding/ut receipt
  claimed_attempt_id 空+next.json mode=manual 是 goal 中断后手动驱动的合法状态，
  不构成独立缺陷（不收录）；参考图实际路径含 doc/features/ 前缀（codex 原文少前缀）。
todos:
  - id: t1-await-human-projection
    content: >
      【P1】人签时点单一真值投影——await_human_only=false 时全链路禁止引导人签。
      事实：物理门本身正确且苛刻（profiles/hmos-app/harness/visual-diff-check.ts
      P0-9b：全部 FAIL hit 均为 T2 + P0 全覆盖 + 全屏 finalized pass + 零 must_fix +
      零 stale/缺 hash 才 await_human_confirm；rev5 明确 awaitHumanOnly 先于 fuse）。
      但本次 await_human_only=false、7 个 P0 只采到 3 个且全 pending、visual_diff
      needs_fix、testing summary FAIL，宿主 agent 仍对用户说"需要你真人确认视觉结果
      后写入 confirmed_by"——状态投影错误（用户原话"截图和输入差距很大为啥就让我
      人工介入"，正当）。另一处：goal-runner closure_wall halt 引导"多为某项只能
      真人签署的确认（视觉保真/裁剪授权类）"在 receipt verifier=PASS、非人签原因时
      同样输出（run 20260808T071335Z-4b0136 实锤——真因是 attempt 失配+manifest
      stale，文案却把人引向人签）。
      落点（用户裁定：零新分类/零新字段/零新投影协议，规则一句话——
      await_human_only=true 才能输出人签提示，否则按现有真实失败原因输出下一步）：
      a) 面向 agent 的 testing/visual 报告与 next_action 呈现既有 awaitHumanOnly
      布尔（已有计算，纯呈现无 schema 变更）：=false 时输出"当前不需要真人签字；
      下一步=<第一条 needs_fix>"，=true 时才输出人签引导（复用 P0-10 b6d3e9a2
      话术资产，不新造）；
      b) closure_wall halt 文案删除统一的"多为人签"猜测句，改为直接引用既有
      ReceiptValidation 五态 / classifyClosureKind / failure_kind 的真实分类结果
      与对应 next_action——不新建 closure 四态分类、不给 summary.json 增字段；
      c) confirmed_by 受理面**维持现有债务条目级边界，不新增全局门**（用户二轮
      裁定：await_human_only=false ≠ 整张 receipt 无效）——visual-debt.ts:356
      applyVisualAcceptance 已实现精确边界：needs_fix 一律拒绝（"确定性 FAIL 不可
      人工清偿——修复后重跑"，返回 rejected 清单）、needs_human 可受理 accepted、
      其他确定性失败继续阻止 phase 闭环。本项零受理面改动，只补呈现与话术。
      验收：复放本次数据（3 屏 pending+needs_fix）断言报告含"当前不需要人签"行；
      closure halt 文案 fixture 逐字引用现有分类真实原因（attempt 失配场景不得
      出现"人签"字样）；框架不提示人签的前提下，试图用 receipt 清除 needs_fix 时
      **对应条目被拒**（rejected 清单如实上报）且 phase 保持阻断——**不要求**整张
      receipt 因 await_human_only=false 失效。
    status: pending
  - id: t2-closure-deadlock-triage
    content: >
      【P0】plan closure 死锁三环拆解。事实（run 20260808T071335Z-4b0136
      events.jsonl，全部机器记录）：plan-i4 verdict=PASS 却 action=halt、
      halt_reason="framework_bug"、reason="stale: phase evidence manifest 非 fresh"，
      且 assess_recommendation 指向 rerun **spec**（阶段指错）；随后两次
      phase_halt=pass_snapshot_unavailable（"检出 1 项漂移；丢弃缓存，重跑责任阶段"）
      进 RECOVERY_PENDING，但 plan-i6/i8 均为 closure-only attempt
      （agent_duration_ms=0，probe_status=failed，closure_kind=
      receipt_repair_with_verifier）、advance_block_reason=closure_open，第二次即
      closure_wall_repeated TERMINAL。plan/phase-completion-receipt.md 里
      verifier_subagent.verdict=PASS 但 claimed_attempt_id=i7（i7 attempt 以 error
      终止未入 phase_verdict 序列）≠ 最终 attempt i8——receipt 完整却因 attempt 身份
      过期被拒收，agent 又没有任何一轮被调起重签，空转到墙。
      **第一步定位已完成（2026-08-12，只读，结论见正文「t2 根因定位结论」小节）**
      ——原定位四问结论摘要：① 漂移=`plan/context-exploration.md` 单文件恒 added，
      根因是 pass-snapshot **建侧注册表 vs 验侧目录遍历集合不对称**
      （classifyPassArtifact 兜底判 frozen、三张注册表不收），重建快照也不可能
      收敛=**真根因，本 todo 范围据此扩容**；② 阶段错配已实锤（stale 的是 spec、
      runner 记成 plan 的 framework_bug），但"spec 为何 stale"的现场证据已被次日
      手动会话覆盖（spec manifest generated_at=08-09T06:55），**与 e8b3d7f2 的
      同根性本轮不下断言**，实现期用夹具复现再判；③ closure-only 不调 agent 的
      真因=漂移出口 `phaseIdx--` 重入 phase 循环**令 retries 清零**
      （phase_start 恒 attempt:1），decideSkipAgentInvoke 判"非重试轮"→ skip；
      ④ 插入点=attempt 循环体最开始、`totalTurns++`（goal-runner.ts:5257）之前。
      原定位问题（历史留档）：① "1 项漂移"具体条目与来源；② 与 e8b3d7f2 已修的
      "framework 路径进 feature 证据链致 stale"判同根/异根；
      ③ closure-only 恢复路径为何永不调 agent。
      修向（定位后收敛；用户两轮裁定：**删除"receipt attempt 迁移采信"**、且
      **"补完旧 attempt"≠"复用旧身份"**——现有代码规定下一次 invocation 必须换
      身份，零时长 i8 的来源正是 skipDecision 发生在 agent_invoke_start 之后
      （goal-runner.ts:6038 一带）；claimed_attempt_id 校验不放宽，不新增迁移
      协议。最小出路仅两条）：
      ① 时点前移到**整个 attempt 生命周期之前**（用户三轮裁定：仅移到
      agent_invoke_start 前一行不够——当前代码在其之前已 totalTurns++
      （goal-runner.ts:5257）、创建 attempt 上下文、执行 capability/device gate、
      可能写 coding_base_*/vision_ledger_anchor 等带新身份的事件，仍会产生
      "幽灵 i8"、令下一 phase 跳号、误耗 turn budget）：在 totalTurns++ 以及任何
      新 attempt 的事件、产物、设备动作之前，runner 对上一 attempt（i7）已落盘
      证据做**只读**的 runner-owned 确定性 reconciliation；成功则直接补完 i7 并
      推进（closure 采信落在 i7 自己身上），**完全不进入新 attempt 生命周期**，
      不以 i7 身份执行任何新工作；
      ② 一旦新 attempt（i8）已发出，i7 必须失效——只能由 i8 回到 verifier/责任
      阶段真实重签（调起 agent，禁止机器改绑/伪造）。
      另：pass_snapshot 漂移丢缓存后的"重跑责任阶段"必须真含 agent invoke，否则
      直接 halt 并把漂移条目呈现给人；assess 阶段指向修正。
      **定位后扩容（范围变更，用户五轮 review 已批准纳入）——环 A/环 B 进入本 todo**：
      ③ 【环 A·真根因】pass-snapshot 建侧/验侧**集合等价**：建侧改为与验侧同源
      （遍历 watched_roots + classifyPassArtifact 兜底），注册表退化为"必需项存在性
      校验"。**不豁免 `context-exploration.md`**（codex 复核纠正，我原稿"语义归位到
      豁免类"作废）——现有 resolver 只有四类，该文件是 agent 写入且参与阶段验真的
      研究证据，既非 closure/control-plane 也非 derived；豁免等于允许 closure-only
      阶段篡改 PASS 依据，违背冻结目的。同源扫描后它自然进初始快照，误报自消。
      三条不变量（验收即按此写）：
        · 快照建立时已存在 → 纳入冻结清单，此后不变则**零 diff**；
        · 快照建立后才新增 → 仍判 **added**（冻结语义不被削弱）；
        · 任意未登记文件 → 建侧与验侧**分类结果必须一致**。
      ④ 【环 B】"缓存失效后重跑责任阶段"的**全部同类出口**复用同一现有重试路径
      （codex 复核：只补事故命中的 :6600 不够，同一死锁可从另两条复现）——
      goal-runner.ts 三处 `phaseIdx--` 均须覆盖：**:5513**（pre_invoke 快照不可用）、
      **:6600**（post-agent 漂移，本次事故命中）、**:7655**（plan-freeze 失败）。
      约束：下一轮不得再满足"首次、非重试轮"skip 条件；优先复用现有 phase 内
      `retries`，**不增加持久状态或新协议**。
      环 A 验收：造"注册表未登记但落在 frozen 兜底面"的产物 → 建快照后
      diffFrozenAgainstManifest **零 added**（当前实现必红=突变验真）；三条不变量
      各一断言（含"快照后新增仍判 added"的反向用例）。
      环 B 验收：**三条出口各一 fixture**（pre-invoke unavailable / post-agent drift /
      plan-freeze），断言重跑后 decideSkipAgentInvoke 不再判"非重试轮"、agent 被
      真实调起。
      验收（用户裁定拆两 fixture——单一"i7+i8 不死锁"不足以证明没有暗中迁移）：
      a) **i8 尚未创建**：i7 error 终止+产物完整 → attempt 生命周期之前的只读
      reconciliation 补完 closure，closure 采信 attempt id=i7，并附**四条硬断言**
      （用户三轮裁定）：无任何 invoke_id=*-i8 的事件或锚点；totalTurns 未消耗；
      未执行新 attempt 的 capability/device gate；prompt 及其他 attempt 产物未被
      覆盖。b) **i8 已创建**：i7 失效，走 agent 真实重签，closure 采信 attempt id
      只能=i8（断言不存在任何 i7 产物被改绑到 i8）。另：漂移条目出现在 halt
      呈现；framework_bug halt 的 assess 指向正确阶段。
    status: pending
  - id: t3-screen-identity-attest
    content: >
      【P1】截图页面身份验真——张冠李戴零容忍。事实：
      device-screenshots/shot-add_card_home_collapsed.png 实拍为「全部银行」页
      （标题"全部银行"+搜索框+字母索引，本仓复盘已目验图片内容），以
      add_card_home_collapsed 身份入库、score_floor=0.997、verdict=pending；
      visual-feedback.md 21 项里"设备侧多出文本『全部银行』『搜索银行』"等一批
      误报实为身份错配下游（不是实现多画了元素，是对照的截图就是另一页）。
      7 个 P0 目标 5 个 element_absent 采集失败，仅 3 屏入库且含错页。
      落点（用户四轮裁定：capture_failed 不是现有屏状态——
      VisualDiffScreenEntry.verdict 只有 pass/warn/fail/skipped/pending，新增即
      违"零新字段"；现有通道已完整并复用：runScreenIdentityGate
      （visual-diff-capture.ts:639，注释明写"identity gate→通过才 screenshot 落
      正式目录；不匹配→screen_identity_mismatch、正式目录零写入"）+
      p0CaptureFailures[] + visual_diff_capture）：
      ① 本项只修复现有 extractLayoutDumpFacets（visual-diff-nav.ts:306）的
      **可见节点过滤**——invisible/屏外 bbox 节点不得参与身份判定（正是"全部
      银行页冒充 add_card_home_collapsed"能骗过现有身份门的嫌疑通道，实现时核实
      取证），继续复用现有 identity gate，零新门；
      ② 身份失配走现有通道：写入 errors + p0CaptureFailures[]，错误码
      screen_identity_mismatch（"实际疑似页面"提示并入 error 文案），**不生成
      目标屏正式截图与 score/verdict 行**（现有 gate 语义，本项不改）。
      ③ **mismatch 屏的旧条目瞬时失效**（用户五轮裁定，现场复放实锤：identity
      mismatch 分支只 errors+p0CaptureFailures+continue（visual-diff-capture.ts
      :862-866），而 mergeVisualDiffReports（:496）先装入全部旧 screens[] 仅覆盖
      本轮成功屏——本次事故已存在的"add_card_home_collapsed=全部银行页
      score_floor=0.997"旧条目会被继续保留并产生误导性视觉反馈）：identity
      mismatch 时把该 screen id 加入**本轮瞬时失效集合**，merge 前从有效报告中
      排除该屏旧条目（或复用现有失效逻辑彻底清除其截图评价绑定）；不新增持久化
      状态或字段；_mismatch/ 证据图继续保留取证。
      划界：不修导航配置本身（nav 走不到 6 屏属采集能力/宿主数据问题，另行处理），
      只堵"身份判定被隐藏节点骗过"这个洞；锚定义与 e3c7d95f（spec 锚点契约）
      复用，不另发明。
      验收：夹具 a=全部银行页 dump × add_card_home_collapsed 身份锚 →
      p0CaptureFailures 含该屏、错误码 screen_identity_mismatch、无该屏
      score/verdict 行；夹具 b=**已有错误旧条目在场**（复放本次 0.997 旧条目）→
      重跑后旧 score/verdict **不再被消费**，最终表现为 p0CaptureFailures +
      P0 uncovered；正确页 dump → 正常入库；invisible/屏外节点伪命中被过滤
      （facets 过滤回归）。
    status: pending
  - id: t4-fuse-blindspot-empty-fingerprint
    content: >
      【P0】熔断资格补齐——**内容可行动的 P0 缺屏**进入现有 actionable 与指纹
      判定（零新机制；采集失败/设备阻断**不在此列**，保持原语义）。事实：device-testing/reports/visual-rounds.ledger.jsonl 30 轮
      （08-09 07:33 ~ 08-10 10:36）全程 decision.fused=false 的成因是**双重的**：
      ① defect_fingerprints=[]——visual-diff-check.ts t9 仅
      roundFingerprints.length>0 才写 [fingerprints] 行，全 pending/采集失败轮的
      指纹恒空 → "连续两轮 [fingerprints] 行逐字相同"判据无输入；
      ② actionable_residual=false——P0 缺屏/采集失败未进入现有 actionable 判定，
      账本认为"无可行动残差"（明明有事可修=修采集）。最烂的轮次因此双重免疫熔断。
      顶层 testing 17 轮重复（08-09 八轮 + 08-10 九轮，其中 ≥3 整轮 16/16 step-0
      锁屏团灭）同样无闸。
      落点（用户裁定边界：不新增字段/账本/状态机；不加可配置 N；二轮追加——
      **不得吞掉设备/采集阻断语义**：现有分类器先识别 no_progress_fuse 后识别
      toolchain/capture，goal-runner 又把 capture/externalBlocked 排除在内容回退
      之外，无差别提升会把锁屏/权限/截图 IO 故障误改口成"修了没用"）：
      ① 仅**内容可行动**的 P0 缺屏进入 actionable 与指纹资格。数据流事实（用户
      三轮裁定）：checkVisualDiff **内部**就计算 ledger/fuse，goal failure
      classifier 在其**之后**才分类——视觉判定时点拿不到"既有最终分类"；故资格
      判定改为：check-testing.ts 在调用 visual diff **之前**已产出的既有
      CheckResult（device build/install/run、visual_diff_capture 等）**直接复用**，
      组成**瞬时 disqualifier** 作为调用参数传给视觉判定（不落盘、不新增持久化
      字段）；命中 capture / toolchain / externalBlocked / device_blocked 的轮次
      **保持现有分类与处置**（不产视觉指纹、不进 no_progress_fuse）；**不在
      visual-diff-check.ts 内复制任何 capture/toolchain/external 分类器**；
      ② 对进入资格的轮次，规范化签名只取 **eligible P0 uncovered 集合 + source
      FAIL hit IDs** 两元（用户四轮裁定：不含 p0CaptureFailures——该集合命中时
      已被瞬时 disqualifier 排除在资格之外），编码为条目并入**现有指纹集合**
      （roundFingerprints 通道），[fingerprints] 行自然非空，现有"连续两轮逐字
      相同即熔断"阈值原样工作；③ 继续使用现有 ledger 与 fuse，不新增任何字段；④ 不打破 rev5 次序
      （awaitHumanOnly 优先于 fuse）与 rev9 资格语义（transcription 脏轮仍
      ineligible——本项只给"可算但为空"的轮次补签名）。顶层 testing 轮次熔断
      维持"观察项"，不顺手新建机制（simplicity-is-king）。
      对照：a3f1c920 熔断本体 / e9c4a7f3 ledger 单写者——只补资格不重构。
      验收：正向=复放本次 ledger 中内容可行动残差轮，第 2 轮同签名即 fused=true
      （现有两轮阈值），该类缺屏轮 actionable_residual=true；**负向=连续两轮锁屏
      或 capture failure 不产生 no_progress_fuse**，其分类与处置和现状逐字一致；
      有真实缺陷指纹的轮次行为与现状完全一致（回归）。
    status: pending
  - id: t5-degradation-wording-recovery-refcheck
    content: >
      【P1】保真降级修补：现有 capability 通道阻断 / 措辞修正 / 现有机制恢复。
      事实：金丝雀 08-08
      07:14 实测 verdict=tool_read、reason="几何/颜色题 4/4 全对——真视觉实锤"
      （宿主 framework.local.json 现存，model=unknown——该字段 d7f3a9c4 t3 已修）；
      spec 中途 ui-spec.yaml 因参考图缺失产不出视觉证据 →
      checkVisionOutputCounterevidence（check-spec.ts:447）evidence_gap →
      blind-safe 策略降级（代码注释自警"这是策略降级，不等于已证明模型无视觉
      能力"）→ 但 goal-report 呈现"能力钳制：当前宿主无视觉能力（OCR 辅助）"、
      clamp reason=no_vision_ocr_available——策略盲被说成能力盲（用户与复盘者两次
      被误导）；policy-downgrades.jsonl 写明"补证后新 hash verified 自动解除"，
      两天 30 轮无任何回升（无驱动器）；根因=需求书参考图路径指向不存在的
      doc/features/bc-openCard/ux-reference/，实际十张参考图在
      doc/features/原始需求/1-银行卡/，spec.md 静默落"当前因参考图缺失仅保留结构
      基线"，agent 跑了两天盲档，弱 OCR 乱码（「《添加银行卡」「LVWY上海银行，」
      当锚文本、visual-feedback regressing -8/+10）是次生灾害。
      落点（用户裁定：收缩为现有 capability 通道修补——不建"回升驱动器"、不建
      新 policy/capability 状态体系）：
      a) 参考图前置阻断走**现有通道**——pixel_1to1 声明的参考图路径缺失=现有
      capability input **unresolved**，提前阻断（复用 c8e5b3f1/29521c01 刚落地的
      blocked capability 投影+诊断链，readiness/next_action/assess/merged-report
      四处呈现自动获得，不新造 pregate）；候选目录仅作提示——有现成扫描器可复用
      才列，无则纯文案提示"检查参考图路径与需求书一致性"，不为此另造扫描机制。
      b) 措辞修正为**基于现有事实字段的准确文案**——clamp/goal-report/fidelity
      路由日志按既有 downgrade source 与金丝雀 verdict 组装：evidence_gap 降级说
      "视觉证据缺口，策略按盲处理（补证后自动恢复）"，不得说"当前宿主无视觉
      能力"；金丝雀实测有视觉时该事实一并呈现。零新状态，纯文案组装。
      c) 恢复沿用**现有重跑/重建机制**——输入补齐后由既有 stale/幂等重算自然恢复
      （fidelity SSOT phase-owned 幂等重算已具备），本项不加任何驱动器，只在
      blocked 诊断文案里写明"补齐后重跑 <阶段> 即恢复"。
      验收：复放本次实锤（ux-reference 缺失 + 原始需求/1-银行卡 在场）→ spec 提前
      阻断且诊断含参考图路径；措辞 fixture：evidence_gap 场景无"无视觉能力"字样
      且含金丝雀实测事实；输入补齐后重跑恢复 pixel_1to1（现有机制回归）。
    status: pending
  - id: t6-report-verdict-reconcile
    content: >
      【P1】test-report 真话三规则（零新状态协议）。事实：test-report.md
      表格 16/16 全"通过"（含 TC-016 视觉用例）与同期 testing/reports/summary.json
      verdict=FAIL（functional 轴 needs_fix）并存——报告自身结论区虽写
      BLOCKED/FUNCTIONALLY_COMPLETE_VISUAL_PENDING，但用例表格的"通过"语义与机器
      裁决不对账；device-test-run.meta.json 实际命令含 --skip-assert-expected
      （trace outcome=success 仅证动作链未报错，不证自然语言预期/性能/视觉），
      报告通篇未披露该旗标。
      落点（用户裁定：不新增 executed/expected_unverified/passed 类状态机，只修
      报告真话）：① 执行命令含 --skip-assert-expected 等 skip/弱化旗标时报告必须
      披露（落测试环境栏），缺失即 FAIL；② "动作链执行成功"不得写成"验收通过"、
      不得计入验收 PASS 分子——skip 模式下通过率表分子口径必须如实（16/16 执行
      完成 ≠ 16/16 验收通过）；③ 对账复用现有 Markdown 表格解析 + trace + summary，
      报告用例表通过计数与机器数不一致即 FAIL（复用 c3f08a21
      extractDeclaredVerdict 唯一入口，不新造解析器）。
      验收：本次 test-report+meta 复放命中"披露缺失"与"分子口径失真"两条 FAIL；
      修正后的报告样例 PASS。
    status: pending
  - id: t7-release-identity-and-residue
    content: >
      【P2】发布身份可见 + 运行残留收尾。事实：宿主包与 maison main 同标 3.0.0，
      "版本号相同"掩盖 7 个修复提交的差异（本次误判"已修复却复发"的温床）；
      goal-runs 20260808T070545Z-ff13e2 / 20260808T070715Z-e75656 两个 run
      run-control 至今 state=active 且 .runner.lock 残留（金丝雀阶段异常退出路径
      未走 released）；openspec change goal-test-contract-and-lockscreen-reveal
      仅剩 3.2（strict OpenSpec validation + harness tests + plan-version check +
      release:verify）未勾。
      落点：① RELEASE-MANIFEST.json 增 source_commit + built_at 两字段即止
      （用户裁定：包内逐文件 hash 已标识真实字节，**不加 worktree digest**），
      framework-init/diagnose 呈现宿主包身份（与 c2e9f4d7 的截图级 build 指纹链
      显式划界：本项只做"包身份可见"，不做证据链绑定）；② goal 异常退出（含
      preflight/金丝雀路径）run-control released + lock 回收兜底——先核实
      3f4bdc9c（run 级 HALT 终态）已覆盖面，**只补本次已证实的异常退出漏口**
      （070545/070715 型），不引入 PID/lease 等新状态机；存量残留清理属宿主侧
      动作（见宿主指引）；③ 把 goal-test-contract-and-lockscreen-reveal 3.2 收尾
      纳入本 plan 发布门（重打包前执行）。
      验收：金丝雀硬失败夹具退出后 run-control=released 且无 lock；
      RELEASE-MANIFEST 新字段过 release:verify；3.2 勾选有据。
    status: pending
---

# 背景与证据速查

宿主实测目录：`D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard`

| 断言 | 证据 |
|---|---|
| goal 六连夭折+plan 死锁 | `goal-runs/2026080*/detach.log`、`goal-runs/20260808T071335Z-4b0136/events.jsonl`（i4 framework_bug / i6·i8 agent_duration_ms=0 / closure_wall_repeated TERMINAL） |
| receipt attempt 失配 | `plan/phase-completion-receipt.md`（verifier PASS、claimed_attempt_id=i7） |
| 锁屏团灭 ≥3 轮 | `testing/reports/20260809T170337Z…/failures/TC-0*.json`（sceneboard「上滑解锁」dump）；`context/facts.md`（coding 期外部阻断、COLD_RESTART=0 规避） |
| 无凭据登记 | 宿主 `framework.local.json` 无 device 段（无从判"从未登记"vs"曾被抹"——被抹 bug 已由 346179a4 修，包未含） |
| 金丝雀真视觉 | 宿主 `framework.local.json` vision.canary（tool_read，"4/4 全对"，08-08 07:14） |
| 策略降级与呈现 | `vision/policy-downgrades.jsonl`（evidence_gap ×2）；goal-report"当前宿主无视觉能力"；`check-spec.ts:447` 措辞自警 |
| 参考图路径错位 | 需求书指 `ux-reference/`（不存在）；实图十张在 `doc/features/原始需求/1-银行卡/`；`spec/spec.md`"因参考图缺失仅保留结构基线" |
| 张冠李戴 0.997 | `device-testing/visual-diff.md`（3 屏 pending、0.997）；`device-screenshots/shot-add_card_home_collapsed.png` 目验=全部银行页 |
| 熔断失明 | `device-testing/reports/visual-rounds.ledger.jsonl` 30 行 fused=false、defect_fingerprints=[]；`visual-diff-check.ts` t9 空指纹不写行 |
| 假闭环 | `testing/test-report.md`（16/16"通过"）vs `testing/reports/summary.json`（FAIL）；`device-test-run.meta.json`（--skip-assert-expected、cold_restart=false、deviceSn=null） |
| 残留 active | `goal-runs/*/run-control.json`（070545/070715 state=active + .runner.lock） |
| await 门与 agent 话术矛盾 | `visual-diff-check.ts` P0-9b（awaitHumanOnly 条件）；ledger 全程 await_human_only=false；宿主会话原话"需要你真人确认…写入 confirmed_by" |

# t2 根因定位结论（2026-08-12 · 只读定位，未改代码）

四问全部有结论，其中②的现场证据已被覆盖、**不下断言**。死锁是三环相扣，
根因环 A 单独就能让本 phase 永不收敛。

## 环 A（真根因）·pass-snapshot 建侧/验侧集合不对称

漂移项就一个文件，两次逐字相同（宿主 events 真值）：

```
i5 pass_snapshot_violation: pass_epoch=1 diffs=[{rel:"plan/context-exploration.md", class:"added"}]
i7 pass_snapshot_violation: pass_epoch=2 diffs=[{rel:"plan/context-exploration.md", class:"added"}]
```

两侧判据函数同为 `classifyPassArtifact`，但**输入集合不同**：

- 建侧 `resolveFrozenDeliverables`（pass-snapshot.ts:396-426）只遍历三张**注册表**：
  `PHASE_OUTPUT_FILES_BY_PHASE` / `PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE`
  （plan=`['use-cases.yaml']`）/ `PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE`
  （plan=`['plan/visual-parity.yaml']`，phase-evidence-manifest.ts:119-134）。
  三表**均无** `context-exploration.md`。
- 验侧 `diffFrozenAgainstManifest`（:930-990）的 added 检测**遍历 watched_roots 目录树**，
  凡 `classifyPassArtifact(phase, rel) === 'frozen_deliverable'` 且不在 manifest.files
  即判 added。而 `classifyPassArtifact`（:259-275）是**黑名单兜底**——只豁免
  mutable_closure（receipt/headless-assumptions）、mutable_control_plane、
  derived（`/reports/`、`goal-runs/`、`/.cache/`、phase-evidence-manifest.json），
  **其余一律 frozen_deliverable**。

`plan/context-exploration.md` 正落在缝里：验侧兜底判 frozen、建侧注册表不收。
两次 `pass_snapshot_taken` 的 files 完全相同（`contracts.yaml`/`plan/plan.md`/
`plan/visual-parity.yaml`/`use-cases.yaml`），而 plan 目录实际多出
`context-exploration.md`——**重建快照也永远不含它，故每轮必然重新检出 added，
结构上不可能收敛**。同类 bug class 已在 [[cc-spec-deadlock]] 记过硬学习
（"watched_roots 须精确集合等价""逐条目合法≠集合完整"），此处是第三例。

## 环 B ·漂移重跑不计 retries → agent 被永久 skip

`decideSkipAgentInvoke`（phase-completion-probe.ts:267-292）的真跑判据是
`retries > 0`。但环 A 的漂移出口（goal-runner.ts:6600）走的是
`phaseIdx--; phaseDone = true; continue`——**重入 phase 循环、retries 归零**
（宿主 events 实锤：i5/i6/i8 的 `phase_start` 全是 `attempt:1`）。于是
`completion_evidence_pre_existing` 每轮都判
`skip_agent_invoke`，理由"本 run 同一 phase、非重试轮、无待修项且证据齐全"，
i5/i6/i8 `agent_duration_ms=0`。唯一真跑的 i7（retries=1，duration 79571ms、
exit 1、kill_attempted）跑完又撞环 A 漂移 → 再次 `phaseIdx--` → retries 再清零。

## 环 C ·receipt 只能由 agent 重签，但 agent 进不来

`classifyClosureKind`（goal-runner-phase.ts:111-125）对 `probe_status='failed'`
返回 `receipt_repair_with_verifier`，注释明写该路由=**"agent attempt，沿用完整
effective 预算"**——设计上就该调 agent 修 receipt。receipt 本身
verifier_subagent.verdict=PASS，唯一硬伤是 `claimed_attempt_id: "i7"` 与终局
attempt i8 失配（check-receipt.ts:994-1007 goal 下 attempt 等值为 BLOCKER）。
但环 B 让 agent 永远 skip，于是 closure 恒 open，两轮即 `closure_wall_repeated`
TERMINAL。**halt 文案"多为只能真人签署的确认"在此完全指错**（t1 已收）。

## ②（evidence manifest stale）· 部分结论，不下断言

- **已实锤**：`stale: phase evidence manifest 非 fresh` 由 assess.ts:631-633
  `phase.closure === 'stale'` 产生；assess 遍历**全部** phase，i4 事件的
  `assess_recommendation.phase='spec'` 说明 stale 的是 **spec**，而 runner 把它
  记成 **plan** 的 `halt_reason=framework_bug` ——**阶段错配已确认**，t2 的
  "assess 阶段指向修正"有据。
- **无法现场判定**：spec 为何 stale 的原始证据**已被覆盖**——盘上
  `spec/reports/phase-evidence-manifest.json` 的 `generated_at=2026-08-09T06:55:54Z`，
  是事故次日手动会话重生成的，不反映 08-08 i4 时状态。
- **故与 e8b3d7f2 的同根性本轮不下结论**，实现期用夹具复现再判（复现路径：
  spec closure 后改动 `spec/ui-spec.yaml` 等 optional relpath 登记产物 → 观察
  spec closure 是否转 stale、runner 是否记成下游 phase 的 framework_bug）。

## ④·reconciliation 插入点（满足四条硬断言）

attempt 生命周期在 goal-runner.ts 内的真实起点是 **`totalTurns++`（:5257）**，
其后依次是 phaseDir/prompt.md 写盘（:5258-5260）、`prompt_written`、
`vision_ledger_anchor`、`agent_invoke_start`（宿主 events 中"幽灵 i8"的第一个
可见痕迹是 `vision_ledger_anchor`）。`phase_start`（:5155）在 phase 循环体、
attempt 循环之外（retry 不重发、`phaseIdx--` 重入才重发）。

**落点=attempt 循环体最开始、`totalTurns++`（:5257）之前**，只读校验。该位置
天然满足 codex 四条断言：不消耗 totalTurns（:5257 未执行）、不写 prompt.md
（:5260 未执行）、不发任何带新 invoke_id 的事件（全在 :5258 之后）、不跑
capability/device gate（更靠后）。

## 修法收敛建议（待 review 后下发实现）

1. **环 A 必修且优先**（不修则 B/C 修了也照样死循环）：建侧改为与验侧同源——
   遍历 watched_roots + `classifyPassArtifact` 兜底收集，彻底消除不对称，注册表
   退化为"必需项存在性校验"。
   **不走"豁免 context-exploration.md"这条路**（codex 复核纠正，原 b 方案作废）：
   现有 resolver 只有四类，该文件是 agent 写入且参与阶段验真的研究证据，既非
   closure/control-plane 也非 derived；豁免会**允许 closure-only 阶段篡改 PASS
   依据**，与冻结目的相悖。同源扫描完成后，它在建快照时自然进入冻结清单，误报
   自然消失，无需任何豁免。三条不变量：① 快照建立时存在 → 进清单、此后不变则
   零 diff；② 快照建立后才新增 → 仍判 added；③ 任意未登记文件 → 建侧/验侧分类
   结果一致。
2. **环 B**：所有"缓存失效后重跑责任阶段"出口复用同一现有重试路径——三处
   `phaseIdx--`（:5513 pre-invoke 快照不可用 / :6600 post-agent 漂移 /
   :7655 plan-freeze 失败）均须覆盖，只补事故命中的 :6600 会让同一死锁从另两条
   路径复现。下一轮不得再满足"首次、非重试轮"skip 条件；优先复用现有 phase 内
   `retries`，不增持久状态或新协议。
3. **环 C**：即 t2 已定的两条出路（reconciliation 前移 / i8 已发则 i7 失效重签）。
4. 环 A 是**结构性 bug class**，修完须补"建侧∪验侧集合等价"的对称性回归断言，
   而不只是给单个文件打补丁。

# 宿主侧指引（不进 todo；对 agent 说的话术 + 预期回报）

1. **现在不要填写任何 confirmed_by**。本轮 testing 的视觉结论作废：3 张截图里至少
   1 张页面身份错配（全部银行页顶着添卡首页的名字拿了 0.997），score 不可信。
2. 等 maison 重打 3.0.0 包后升级宿主 framework（含 08-09~08-12 七个修复：锁屏凭据
   引用被抹、codex 审批旗标、金丝雀硬失败前置、手动 /spec 闭环）。
3. 升级后对 agent 说："用 device:rebind 重新登记真机（序列号 3UJ0225321000395）的
   解锁凭据，完成后告诉我设备就绪门是否 PASS。"——预期回报：framework.local.json
   出现 device.unlock.credential_ref，设备就绪门 device_ready PASS，此后锁屏可自动
   恢复，不再需要"人肉保持解锁"。
4. 修需求书两处：参考图路径改指 `doc/features/原始需求/1-银行卡/`（或把十张图挪进
   `bc-openCard/ux-reference/` 并补 README）；裁决「支持20家银行」vs 参考图「支持
   100家银行」的文案冲突并回写需求正文。
5. 需求修好后从 spec 起干净重放（旧 ui-spec/视觉产物由框架 stale 机制自然重建），
   并恢复 HARNESS_DEVICE_TEST_COLD_RESTART 默认值（当时置 0 是绕锁屏的权宜，凭据
   登记后不再需要，冷启动覆盖要还回来）。
6. 只有当机器产物明确给出 await_human_only=true 时，才进入真人视觉确认环节。

# 非目标与风险

- **零新机制总原则（用户 review 裁定）**：全部 todo 复用现有通道——现有
  actionable/指纹/fuse、ReceiptValidation 五态/classifyClosureKind/failure_kind/
  next_action、capability unresolved 投影、现有表格解析与对账。不新增运行时状态/
  协议字段（t7 的 RELEASE-MANIFEST 包身份元数据 source_commit/built_at 除外）、
  不新增账本、状态机、投影协议、迁移协议、可配置阈值；openspec 不新建独立 change，
  在现有相关 change/spec 上补 delta。
- 不做 nav 采集配置自动生成/修复（本次 5 屏 element_absent 属采集导航与宿主页面
  结构数据问题，t3 只堵"错页入库"，导航修复随宿主重放观察后另行定性）。
- 不做 c2e9f4d7 的 build 指纹证据链（已顺延 3.1.0），t7 仅发布包身份字段。
- 不改 awaitHumanOnly 门条件本身（门是对的，错在呈现层）。
- 不新增任何防伪造类机制（遵 stability-over-total-control 顶层裁定）。
- t2 修法依赖定位结论：若判定与 e8b3d7f2 同根未除尽，收敛为补其漏项并当场同步
  偏差（surface-plan-deviations 纪律），不在本 plan 内扩容。
- codex 审计中两条不收录为缺陷：coding/ut receipt claimed_attempt_id 空与
  next.json mode=manual——goal 中断后手动驱动的合法状态，非缺陷。

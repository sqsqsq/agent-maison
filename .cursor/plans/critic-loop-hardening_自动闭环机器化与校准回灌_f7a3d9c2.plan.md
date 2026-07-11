---
name: critic 闭环基础设施加固 — 结构化发现 + 熔断账本 + 回执生产 + 静稳采样 + 校准回灌
version: 3.0.0
# 版本说明：随当前 3.0.0 版本窗口，用户控版本不 bump。
# 前置：plan c6d8f2b4（layout-oracle）rev9 已落地——本 plan 基线=rev9 后代码树
# （rev9：指纹只吃结构化 defects、isRoundFingerprintable 挡掉未转录轮次、
#   must_fix 计数式指纹已废除）。
# 立项动因：codex 置信度评估（2026-07-11）→ 初版 plan → 三方 review（codex/cursor/claude，
# 2026-07-11）对账后重写（rev2）。三方一致结论：问题诊断大体准确，但初版存在
# ①口径超卖（「自动闭环机器化」——实际交付的是熔断/对账/签发，不是循环调度器）；
# ②t1 熔断条件按原文实现会打死 goal 重试（双写误触发）且漏掉经典空转（重建后同缺陷）；
# ③t3 证据源假设被代码证伪（agent-output.log 无工具调用记录）；
# ④t4 整图 hash 恒等在真机上几乎永不成立（状态栏秒级元素）；
# ⑤漏看既有 goal 熔断代码（shouldHaltNoProgress 的 visual_gap signature 粗熔断）。
# 本 rev2 全部吸收，plan 名称同步收窄（文件名沿用不改，防引用断链）。
overview: >
  【定位（rev2 收窄，三方 review 定调）】本 plan **不新建循环调度器**：不实现独立上下文
  critic/fixer 双 agent、不实现 capture→critic→coding→rebuild→recapture 的状态机调度。
  循环的发起与推进仍由既有机制承载（交互态 SSOT 指令 + goal 态 phase FAIL→retry）。
  本 plan 保证的是四件确定性的事：**转了能被机器观测**（结构化发现+轮次账本）、
  **卡住能被机器熔断**（指纹级 no-progress fuse，与既有粗粒度 signature 熔断整合）、
  **证据能被机器签发与对账**（runner attestation 回执 + T8 转录对账）、
  **人工反馈能被机器落账回灌**（visual-confirm CLI 原生 ledger + 校准报告）。
  循环状态机（codex 建议的 t0-visual-loop-state-machine）显式列为后继 plan——本期交付的
  结构化 findings/账本/回执正是它的前置物料，先有料再建机。
  【问题（五缺口，rev2 修正后）】
  G1 熔断粒度与覆盖缺口——goal 态**已有**跨 attempt 熔断代码（shouldHaltNoProgress：
  visual_gap 同 blocker-id signature 连续重复即 halt，初版 plan 与 codex 评估均漏看），
  但它是 blocker-id 粗粒度：缺陷 5 条修到 2 条会被误判无进展、id 集合轻微变化会重置 guard；
  且交互态没有任何机器熔断。缺的是**指纹级**比对与交互态信号，不是"从零建熔断"；
  G2 verified 回执无生产者——且初版方案的证据源假设被证伪：claude adapter headless 是
  `claude -p` 纯文本输出，agent-output.log 里**没有**工具调用记录；各 adapter 结构化
  tool-event 能力参差（仅 chrys 带 --json），"按 adapter 解析 Read"是设想不是契约；
  G3 T8 发现→回修链路无对账——且缺可对账的数据结构：LayoutFinding 无 finding_id/elements
  字段（元素 id 埋在 note 散文里）、B 类无 bbox、defect 无 source 溯源字段、check 返回
  被压平成文本（消费方只能正则抠 details）。另有通用缺口：任何来源的 must_fix 不转录
  defects 即让 isRoundFingerprintable=false → fuse 可被"不转录"逃逸；
  G4 采集非原子 + 判据设计风险——shot 与 dump 两次设备调用非同帧成立；但初版"整图
  hash 恒等"判据在真机上几乎永不成立（状态栏时钟/电池/信号秒级变化），会造成大面积
  unstable → T8 被系统性削弱；且"unstable 保 A 类 hard"缺乏依据（T8 A/B/C 全部是
  树 vs spec 断言，动画过渡态下 A 类同样瞬时误报）；
  G5 校准与回灌无机制——真机校准 D1-D6 是人工清单；T2 终审的 FN/FP 无落账通道。
  且初版把落账所有者选错（靠 agent 转录=反馈不丢仍靠自觉），正确所有者是真人 TTY 工具
  visual-confirm CLI（同事务写判定+落账）。
  【方案】G1→t0 结构化发现 + t1 轮次账本与指纹熔断（幂等去重、与既有 signature 熔断
  整合、build 指纹只做归因不做门槛）；G2→t3a 逐 adapter 证据源盘点立契约 + t3b 对盘点
  合格者实装 runner attestation 回执（最低输入集=被评截图+全部 crops，对齐既有 check
  契约）；G3→t0 数据结构先行 + t2 转录对账门禁（finding_id 主判据 + 通用 must_fix
  结构化强制）；G4→t4 静稳采样（app 窗口裁剪 hash + 布局签名双稳判据，先实测后定参，
  unstable 全体降档不豁免 A 类）；G5→t5 校准 CLI（calibration.json SSOT + md 投影，
  扩到 appRoot/bounds/locator 歧义/双拍稳定性）+ t6 visual-confirm CLI 原生回灌台账
  （append-only jsonl，FN/FP 程序推导）。
  【显式非目标】①循环状态机 / 独立上下文 critic phase 不在本期（后继 plan；OpenSpec
  5.4 因此只**半关**——回执生产侧关闭，critic phase 侧如实保持 open）；②不承诺取消
  T2 人工终审（taste 归人）；③交互态 verified 回执不在本期（无 runner 信任根，如实
  unverified）；④不改 A/B/C gate 档位——t5/t6 产出的是升档评审的**数据素材**，升档
  规则参数（样本量 N/FN 上限/跨屏跨设备覆盖）待数据累积后由人定，本期不宣称"升档
  决策已机制化"。
  【验收】①fuse 演示：构造两轮相同缺陷指纹 → no_progress_fuse 触发且 goal halt 归类
  正确、双写不误触发（同轮幂等 e2e）；②t3a 盘点结论落档 + 对合格 adapter 的 verified
  回执演示（伪造回执被 attestation 校验拒绝）；③T8 hard 未转录 → BLOCKER（e2e）；
  ④静稳采样三态 + 降档路径（单测）+ 双拍稳定性真机实测数据在校准报告；⑤宿主一句话
  触发校准 → calibration.json+md 落盘；⑥visual-confirm 打回/认可 → ledger 同事务落账
  （e2e）；⑦低档守恒回归零新增；⑧tsc/全量 unit+fixtures/openspec 全绿；⑨宿主复验
  合并执行 c6d8f2b4-t11 与本 plan 验收。
todos:
  - id: t0-structured-findings
    content: >
      【G3 前置·数据结构先行（codex：缺可对账的数据结构；cursor：别靠正则抠 details）】
      ①LayoutFinding 扩展：新增 finding_id（稳定 id=`hash(screen_id|signal|elements|bbox_bucket)`
      前缀）与 elements: string[]（结构化元素引用，替代 note 散文内嵌）；B 类（B1/B2/B3）
      尽力补 bbox（可定位节点的 union；不可定位则留空并注记）。
      ②VisualDiffDefect 扩展：可选 source 字段 {producer: 'T8', finding_id, signal}——
      转录溯源锚点，t2 对账主判据。schema 校验同步（可选字段，legacy 兼容）。
      ③check 结构化返回：checkVisualDiff 的 CheckResult 附结构化 payload（当轮
      fingerprints[]、T8 findings[]（含 finding_id）、hit ids）——供 t1 runner 账本与
      goal-runner 消费，禁止下游从 details 文本正则抠 [fingerprints]（[fingerprints]
      注记保留仅供人读）。CheckResult 类型加可选 structured 字段（generic 层，types.ts）。
      ④normRectsOverlap 导出（t2 复用）。单测：finding_id 稳定性（同发现两轮同 id、
      bbox 桶抖动不变 id）/elements 填充/结构化 payload 形状。
    status: pending
  - id: t1-round-ledger-fuse
    content: >
      【G1】轮次账本 + 指纹级熔断（rev2 重设计，修初版三缺陷：双写误触发/条件方向反/
      空集真空成立）。
      ①账本 `device-testing/reports/visual-rounds.ledger.jsonl`（telemetry 侧车，非判定
      文件）：每行 {schema_version, at, loop_id, goal_run_id?, attempt?, build_fingerprint,
      screens_hash（全屏 evaluated_screenshot_hash 的集合 hash）, defect_fingerprints[],
      fail_hit_ids[], fingerprintable: bool}。loop_id：goal 态=goal run_id；交互态=
      feature+首次采集世代 id。写入点在 harness-runner check 后（runner 写，非 check 写；
      数据源=t0 结构化 payload）。
      ②**幂等去重（治双写）**：与账本最后一行的 (build_fingerprint, screens_hash,
      defect_fingerprints) 全等 → 不追加（agent 会话内自跑 + runner 脚本闸门 + 用户重跑
      同一状态，都只记一轮）。读取端跳过损坏行（崩溃半行）并 WARN。
      ③**熔断条件（rev2）**：账本相邻两条**不同**条目，且两轮均 fingerprintable
      （isRoundFingerprintable，rev9）+ 指纹集**非空**且相等 + 本轮仍有 visual_diff 家族
      FAIL hit（非视觉 FAIL 不触发）→ 新检测 `visual_diff_no_progress_fuse`，pixel_1to1
      BLOCKER。**build 指纹不做门槛只做归因**：两轮 build 相同 → details 标
      no_fix_attempt（跑了没修，指引"先改码重建"）；build 不同 → ineffective_fix
      （修了没用——homepage 经典空转，指引"停止迭代、halt 求人+残差清单"）。
      ④failure_kind 路由：fuse 命中时 finalResult.failure_kind='no_progress_fuse'
      （与 await_human_confirm 同通道）；classifyFailureKind 新增分支（优先于
      isVisualGapBlockerId 前缀归类，否则 `visual_diff_` 前缀会被吸成 visual_gap）；
      goal-runner 对该 kind 首触即 halt（不烧重试预算，不入 SIGNATURE_HALT_KINDS）。
      **与既有 shouldHaltNoProgress 的关系（初版漏看，必须写明）**：visual_gap 的
      blocker-id signature 粗熔断保留为兜底；指纹 fuse 更细更先触发；两机制 halt 原因
      分别为 no_progress_fuse / no_progress_visual_gap，文档写清语义差。
      ⑤防篡改（最低限）：goal 态 runner 在 events.jsonl 记每条账本行 hash（agent 删行
      改行可被 runner 侧对账发现）；交互态账本行数回退 → WARN 注记。不做 hash 链。
      ⑥交互态 SSOT 同步：见到 fuse 信号即停止改措辞重试，转人。
      单测：幂等去重/三态归因（no_fix_attempt/ineffective_fix/有进展）/空集与不可
      指纹轮不比较/非视觉 FAIL 不触发/损坏行容错/classifyFailureKind 路由。
    status: pending
  - id: t2-transcription-audit
    content: >
      【G3】转录对账门禁 `visual_diff_finding_transcription`（rev2 收紧匹配规则）。
      ①T8 hard 命中须有对应 defect：主判据=defect.source.finding_id 精确对账（t0）；
      次判据=elements 交集非空且 signal 语义类一致；bbox 相交仅作 legacy 回退且收紧
      （IoU≥0.5，防"一个大 bbox 误消一切账"——codex/cursor 同点）。hard 未转录 →
      pixel_1to1 BLOCKER"发现未落账"，details 附可直接照抄的 defect 模板 JSON（含
      source 字段）。warn 未转录 → WARN（注明：T8 warn 命中本身已在
      CANDIDATE_BLOCKING_WARN_IDS 阻断 candidate-pass，本 WARN 是落账提醒、不另加阻断）。
      ②**通用转录完整性（rev2 新增，堵 fuse 逃逸）**：任何屏 must_fix 非空而 defects=[]
      → pixel_1to1 BLOCKER"回修指令未结构化"（不限 T8 来源；OCR/placement 弃判 backstop
      转出的 must_fix 同样强制结构化）——保证 isRoundFingerprintable 恒可成立，熔断
      不能靠"不转录"逃逸。
      ③**回执窄缝收口（claude review：minor-defect 绕行）**：candidate-pass 收窄
      （awaitHumanOnly）在 pixel_1to1 下追加前提"结构合法 critic 回执存在"——无论
      region_attest 是否存在（对齐 OpenSpec"Both candidate-pass tiers require a
      structurally valid receipt"字面义），堵"每屏塞 minor defect 绕过 attest→绕过
      回执"的路径。
      单测：finding_id 对账三态/elements 次判据/bbox IoU 边界/must_fix 未结构化 FAIL/
      minor-defect 绕行被拒。
    status: pending
  - id: t3a-provenance-inventory
    content: >
      【G2 前置·证据源盘点立契约（三方 review 一致：初版"按 adapter 解析 Read"是设想
      不是契约——claude -p 纯文本无工具记录、仅 chrys 带 --json）】
      ①adapter 能力声明：workflows adapter 契约新增 tool_event_provenance:
      none | structured_events | session_transcript（默认 none=恒 unverified）。
      ②逐 adapter 盘点并留真实日志 fixture：claude（候选两路线：本地 session transcript
      `~/.claude/projects/<slug>/*.jsonl`（有 tool_use 记录但 session 定位靠 mtime 猜，脆）
      vs 改 `--output-format stream-json --verbose`（记录全但**波及 b8f36a12 全链日志
      消费器**：parseHeadlessApiError 行首锚定/goal-progress 心跳/no-output 零字节判定，
      须逐个回归）——盘点时二选一并写明理由）；codex（exec 事件流是否记录 view_image/
      读图，注意 codex 无 Read 工具、cat 图片≠视觉注入）；cursor/opencode（headless 输出
      是否含工具事件）；chrys（--json 信封）。结论落
      `docs/operations/adapter-tool-event-provenance.md`。
      ③解析器契约：**只接受 CLI 产生的结构化事件**，禁止从普通文本正则猜测 Read
      （codex 红线）；每个合格 adapter 配真实日志 fixture 单测。
      ④诚实边界（cursor）：验读记录=「工具调用发生过」的证明，≠「模型看懂了图」——
      SSOT/校准报告 §4 措辞与 verified 语义（invocation records, not model cognition）
      保持一致，不得混用"已证明看图"。
      预期结论：首期合格者大概率仅 claude（Read=图片注入语义成立）+ chrys；其余恒
      unverified——如实接受，不硬凑。
    status: pending
  - id: t3b-goal-verified-receipt
    content: >
      【G2】goal 态 verified 回执生产者（仅对 t3a 盘点合格的 adapter 实装；若盘点后无
      合格者 → 本项如实降级为"契约+fixture+解析器框架"，verified 生产延后并在校准
      报告 §4 记录——不写死承诺）。
      ①goal-runner testing 阶段结束后，按 adapter 声明的证据源提取图片读取工具事件；
      **verified 最低输入集（rev2，对齐既有 check 契约 visual-diff-check.ts:1431）**：
      全部 attest 屏的**被评截图** + 全部 paired crops 均有验读记录 → runner 生成/覆盖
      critic-receipt.json：input_provenance=verified、image_inputs 逐项带现算 hash、
      来源标 runner_transcript_audit。部分缺失 → 保持 unverified 并记 unread_crops[]/
      unread_screenshots[]（check 层对 unread 的 paired attest 判 BLOCKER"声称对照过
      但无验读记录"）。
      ②防伪段命名 **runner attestation（完整性绑定，非密码学签名——codex 措辞点）**：
      回执带 {goal_run_id, evidence_log_path, evidence_log_hash}；check 重算日志 hash
      比对——agent 手写 verified 缺 attestation 段/hash 不符即拒。agent 会话内自跑
      harness 时回执仍是 unverified 档，合法。
      ③交互态不变（unverified + SSOT Read 强制）。
      单测/fixture：合格 adapter 真实日志→verified/部分缺失→unverified+unread 清单/
      伪造 attestation 被拒/无合格 adapter 时的降级路径。
    status: pending
  - id: t4-quiescence-sampling
    content: >
      【G4】静稳采样（quiescence sampling——rev2 更名并重设计；初版"同帧协议+整图 hash
      恒等"被 cursor 证伪：状态栏时钟/电池/信号秒级变化 → 整图 hash 几乎永不相等 →
      大面积 unstable → T8 被系统性削弱）。
      ①判据（双稳）：shot→dump→shot'，比较 **app 窗口区域裁剪后**的图像 hash（appRect
      来自 dump，裁掉状态栏/系统区）+ **规范化布局签名**（节点 type/id/bounds 规范化
      序列化的 hash）两者均稳定 → 静稳成立，shot' 为最终截图；任一不稳 → 重试整组
      （默认 2 次，参数待⑤实测校定）；仍不稳 → layout_dump_status='unstable'（枚举
      扩展），记录 unstable_reason（image_drift | layout_drift | both）与前后 hash、
      时间戳、attempt。
      ②**unstable 降级（rev2：不豁免 A 类）**：T8 全体降一档（hard→warn、warn→advisory）
      并注 unstable——A/B/C 全部是树 vs spec 断言，过渡态下 A 类同样瞬时误报（滑入
      动画中的元素合法越界/瞬时重叠），"A 保 hard"无依据（codex/claude 同点）。
      动画/轮播屏由此不产生错位断言假阳，也不误伤普通静态屏。
      ③**先实测后定参**：依赖 t5 ⑨双拍稳定性实测数据（全图 vs 裁剪区 vs 布局签名三
      口径的真机稳定率）——判据细节（是否需感知 hash、重试次数）以实测数据校定；
      实测先行于本项收紧，实测前本项可先落"采集+记录+unstable 标注"不落降档。
      ④成本诚实（codex 纠错）：最坏 3 组=每屏 6 次截图+3 次 dump（非初版所称"+1 截图/
      屏"）；**仅 pixel_1to1 生效**，t6b 守恒表按此口径。
      单测：稳定/一次抖动后稳定/持续不稳定三态 + 裁剪区判据 + 布局签名判据 + T8 降档
      路径 + unstable_reason 记录。
    status: pending
  - id: t5-calibrate-cli
    content: >
      【G5a】校准自动化 `layout-oracle-calibrate`（框架 CLI + skill 话术入口）：对 ui-spec
      P0 屏逐屏（复用 nav 配置导航）执行 shot+dump，产出 **calibration.json（SSOT，供
      程序消费）+ layout-oracle-calibration.report.md（纯投影）**（codex：只出 md 不利
      后续消费）。逐项标注 automated_conclusion vs needs_human（cursor：CLI 降摩擦，
      不替代真机人工结论）。项目：
      ①overlay 进树检测（sheet 开启态 dump 检索声明文本节点，D1/D2）；
      ②.id() 覆盖率统计（exact_id 命中率；responseRegion 对照留人工，D3 半自动）；
      ③bounds 卫生统计（零面积/越界/负坐标计数，D4 部分）；
      ④close 默认规则干跑（advisory 命中清单=FP 素材，D5）；
      ⑤C1 间距比例分布（D6 素材）；
      ⑥【rev2 新增】appRoot 选择稳定性（多屏多次 dump 的 appRoot type/面积分布——
      type='root' 首子树假设的真机验证，codex 点）；
      ⑦【rev2 新增】bounds 语义抽查素材（可交互元素 bounds 反裁截图并排图，供人判
      "视觉边界 vs 触控热区"，needs_human）；
      ⑧【rev2 新增】locator 歧义统计（duplicate id/duplicate text 命中数——unmatched
      不强猜策略的分母数据）；
      ⑨【rev2 新增，t4 前置】双拍稳定性实测：每屏连拍两次，报全图 hash / app 区裁剪
      hash / 规范化布局签名三口径的稳定率——t4 判据与重试参数以此校定。
      CLI 显式触发、不挂阶段链；宿主触发话术写进 device-testing reference。产出供人
      做 gate 升档判断，CLI 不改档位。
    status: pending
  - id: t6-feedback-ledger
    content: >
      【G5b】终审回灌台账（rev2 重设计——所有者从 agent 改为 **visual-confirm CLI**，
      codex 点：靠 agent 转录=反馈不丢仍靠自觉；CLI 本就是真人 TTY 工具且已支持 f=打回）。
      ①`review-feedback.ledger.jsonl`（**append-only jsonl，弃初版 yaml**——整体可改写
      的 yaml 不适合台账）：CLI 在真人 y（认可）/f（打回，输入原因一行）时**同一事务**
      写 visual-diff.json + 追加 ledger 条目 {schema_version, at, feature, screen,
      human_verdict: approve|reject, reason, build_fingerprint, screenshot_hash,
      oracle_version（layout-oracle 代码指纹，版本变化→历史样本失效标注）,
      machine_signals_snapshot（该屏当轮全部 T8/M1/OCR/placement 命中摘要，CLI 从最新
      harness 结构化产物采集）}。
      ②overrule（信号误报）入口：CLI 新增 --overrule <screen> <signal> 模式——真人对
      信号已报缺陷判"不是问题"时落 {human_verdict: overrule, signal/finding_id, reason}
      （FP 样本）。
      ③**FN/FP 由程序推导，不让人/agent 自填**（codex 点，替代初版 signals_that_missed
      自报）：校准报告消费 ledger——reject 且 snapshot 全绿 → FN 样本；overrule → FP
      样本；按 signal 累计成 FP/FN 计数表。
      ④初版"fail 屏有人工原话却无 ledger 条目→WARN"**删除**（claude review：人工 fail
      与 critic fail 无字段可区分，不可机器判定）——落账保证改由 CLI 同事务承担，agent
      不再承担转录义务；goal 态 halt 后真人同样走 CLI，同一通道。
      ⑤升档定位（rev2 降格）：计数表是升档评审的**数据素材**；升档规则参数（连续零 FP
      的样本量 N、是否跨页面/设备、FN 上限、oracle 版本失效语义）待数据累积后由人定
      ——本期不写死 N、不宣称"升档决策已机制化"（codex：没有可执行定义前只能是观察
      报告）。
      单测/e2e：y/f 同事务落账/overrule 模式/snapshot 采集/FN、FP 推导/append-only
      （无整体重写路径）。
    status: pending
  - id: t6b-lightweight-conservation
    content: >
      【轻量化守恒（用户 2026-07-11 质询立项；rev2 修正断言口径）】全部新增能力显式
      档位化并以守恒测试锁死，不侵蚀 d4a7c1e8 分档体系：
      ①t4 静稳采样（最坏每屏 6 shot+3 dump，成本口径 rev2 修正）仅 pixel_1to1 生效；
      ②t1 轮次账本仅 visual loop 活跃时追加——条件**跟 UI_CHANGE_REQUIRES_UI_SPEC 集合走**
      （含 copy_edits_only，rev2 修正：初版只写 new_or_changed 会与 checkVisualDiff
      实际触发面不一致），单条 jsonl 级成本；
      ③t2 转录对账/t3 回执签发只在 attest/T8 产物存在时运行；
      ④t5 校准 CLI 显式触发，不挂阶段链；
      ⑤SSOT 增量段落带「pixel_1to1」档位前缀（C3b 主干行数上限 lint 不得超）。
      **守恒回归测试（rev2 修正断言口径为「相对现状零新增」）**：semantic_layout 特性 +
      lite 轨特性 + ui_change=none 特性各走一遍 testing 链——断言零**新增** BLOCKER、
      零**新增**设备调用、零**新增**必填产物。注意现状基线：layout dump 今天对
      semantic_layout full 轨屏**本来就采**（capture 无条件 runLayoutDump），不得断言
      "dump 不发生"（初版此断言与现状打架）；新增项里 semantic_layout 不得出现的是
      静稳 shot'、fuse BLOCKER、回执强制。与 goal-parity 同型，防未来门禁悄悄漏档。
    status: pending
  - id: t7-specs-and-docs
    content: >
      OpenSpec 增量（对 layout-oracle-geometry-gates 追加或新 change：structured
      findings/no_progress_fuse 与幂等账本/transcription audit（含通用 must_fix 结构化）/
      runner attestation 回执生产与最低输入集/quiescence sampling 与 unstable 降档/
      校准 CLI 双产物/回灌 ledger 的行为规格）。**OpenSpec 5.4 标注半关**：verified
      回执生产侧由 t3 关闭，独立 critic phase 侧如实保持 open、指向后继 plan（cursor
      点：不得宣称 5.4 全关）。SSOT 同步（device-testing-workflow-detail：熔断信号
      消费、CLI 落账协议、静稳语义；goal 文档：no_progress_fuse halt 语义、与
      no_progress_visual_gap 的关系）+ 校准报告 §4 诚实边界更新（verified=调用记录
      非模型认知；goal 态生产者按 t3a 盘点结论如实陈述；交互态仍 unverified）。
    status: pending
  - id: t8-tests-green
    content: >
      单测/fixtures：t0 结构化字段与 finding_id 稳定性/t1 幂等账本与熔断三态与路由/
      t2 对账三态与通用结构化强制与窄缝收口/t3 各 adapter fixture 与 attestation 防伪/
      t4 静稳三态与降档/t6 CLI 落账与 FN、FP 推导/t6b 守恒断言（相对现状零新增口径）/
      校准 CLI 对固化 dump fixture 的 calibration.json 生成；既有全量 unit+fixtures
      不破；tsc --noEmit + npm run test + openspec:validate 全绿。
    status: pending
  - id: t9-host-e2e
    content: >
      宿主端到端验收（合并执行 c6d8f2b4-t11 + 本 plan 验收，用户以话术驱动宿主 agent；
      rev2：验收不宣称"机器保证循环会转"，闭环推进仍由 SSOT/goal 重试承载）：
      ①一句话触发 layout-oracle-calibrate → calibration.json+md 落盘，重点核 ⑥appRoot/
      ⑦bounds 语义素材/⑨双拍稳定性三口径数据（t4 参数据此回填校定）；
      ②bc-openCard 复验三靶（沿用 c6d8f2b4 分层验收）；
      ③goal 演示 run：构造重复缺陷 → no_progress_fuse 正确熔断且归因（no_fix_attempt
      vs ineffective_fix）正确、agent 会话内自跑+脚本闸门双写不误触发；
      ④按 t3a 盘点结论演示 verified 回执签发（或如实记录"无合格 adapter，降级路径
      生效"）；
      ⑤终审时故意打回一屏 + overrule 一个信号 → ledger 两类样本落账、校准报告 FP/FN
      表出数；
      ⑥未达项如实登记；gate 升档决策留待 ledger 数据累积，本期不动档位。
    status: pending
---

# 三方 review 对账（2026-07-11，rev2 立项依据；基线=c6d8f2b4 rev9）

## 初版 codex 置信度评估对账（沿用，两处修正）

| codex 判断 | rev2 对账结论 | 去向 |
|---|---|---|
| 独立 critic 自动迭代未实现 | **半成立（rev2 修正）**——循环调度器/独立 critic phase 确实无代码；但"熔断无代码"不实：goal-runner 已有 shouldHaltNoProgress 的 visual_gap signature 粗熔断（codex 与初版 plan 均漏看）。缺口=指纹粒度+交互态信号+调度器 | 指纹熔断→t1；调度器→**显式非目标，后继 plan** |
| region_attest 未校验逐区域覆盖 | 已过时（rev7 修） | 无需处理 |
| 无 receipt 可进 candidate-pass(unverified) | **大体过时（rev2 修正）**——rev7 修了"有 attest 必回执"；但余一条窄缝：每屏塞 minor defect 可绕过 attest→绕过回执 | t2③ 收口 |
| receipt hash 未重算 | 已过时（rev7/rev8 修） | 无需处理 |
| dump=captured 缺失/损坏静默跳过 | 已过时（rev7 修） | 无需处理 |
| T8 真机 oracle 未复验 | 成立 | t5 自动化子集 + t9 |
| 采集时序非原子 | 成立 | t4（判据 rev2 重设计） |
| 结构规则 FP 未跨页校准 | 成立 | t5 素材 + t6 台账 |
| T8 finding 只进文本 | 成立（且缺结构化字段） | t0 + t2 |
| 自报降权/M1/解耦/canary/schema 较可靠 | 同意（不动） | — |

## 三方 review（codex/cursor/claude）发现 → rev2 吸收清单

| 发现（提出方） | rev2 处置 |
|---|---|
| 「自动闭环机器化」口径超卖，无循环状态机（codex/cursor/claude 一致） | plan 更名收窄；状态机列非目标+后继 plan；t9 验收措辞同步。**取舍说明**：codex 建议本期加 t0-visual-loop-state-machine，cursor/claude 建议收窄口径——采后者：本期的结构化 findings/账本/回执正是状态机前置物料，先料后机，体量可控。由用户终裁 |
| goal 已有 signature 粗熔断被漏看（claude） | 对账表修正；t1④ 写明两机制关系（fuse 先触发，signature 熔断保留兜底） |
| t1 双写误触发会打死 goal 重试（claude/codex） | t1② 幂等去重（同状态不追加） |
| t1 build 指纹一致作门槛：漏经典空转、误伤重跑（claude/codex 同点） | t1③ build 指纹改归因（no_fix_attempt/ineffective_fix），不做门槛 |
| 空指纹集真空成立、非视觉 FAIL 误触发（claude/codex） | t1③ 非空+fingerprintable+视觉 FAIL 三前提；rev9 isRoundFingerprintable 已在码 |
| 账本可被删改躲熔断、缺 run 隔离、崩溃半行（claude/codex） | t1① loop_id/goal_run_id 字段；t1⑤ events.jsonl 记行 hash；读取容错 |
| agent-output.log 无工具调用记录，"按 adapter 解析"是设想（claude/codex） | t3 拆 t3a 盘点立契约 + t3b 条件实装；结构化事件 only、禁文本正则 |
| verified 须覆盖被评截图（既有契约 :1431），只含 crop 会被拒（codex） | t3b① 最低输入集=截图+crops |
| "签发"暗示密码学签名（codex） | t3b② 更名 runner attestation |
| 验读记录≠模型看懂图（cursor） | t3a④ 诚实边界措辞 |
| 整图 hash 恒等真机几乎永不成立（cursor；「时钟跨分钟才漂移」与事实不符） | t4① 改 app 区裁剪 hash+布局签名双稳；t5⑨ 先实测后定参 |
| unstable 保 A 类 hard 无依据（codex/claude） | t4② T8 全体降一档，不豁免 A |
| 成本"+1 截图/屏"不实，最坏 6 shot+3 dump（codex） | t4④/t6b① 口径修正 |
| LayoutFinding 无 element/finding_id、B 类无 bbox、defect 无溯源（codex/claude） | t0 数据结构先行 |
| bbox 任意相交对账过宽（codex/cursor） | t2① finding_id 主判据，bbox 收紧为 IoU≥0.5 回退 |
| must_fix 不转录可逃逸 fuse（claude，衍生自 rev9 语义） | t2② 通用结构化强制 |
| 回灌所有者选错：agent 转录仍靠自觉，应由 visual-confirm CLI 承载（codex） | t6 重设计：CLI 同事务落账；yaml→append-only jsonl |
| "fail 屏有人工原话无 ledger→WARN"不可机器判定（claude） | t6④ 删除，改 CLI 事务保证 |
| FN/FP 不能让 agent 自填（codex） | t6③ 程序从 snapshot 推导 |
| 升档规则无可执行定义（codex/cursor） | t6⑤/t7 降格为数据素材+观察报告，参数待人定 |
| t5 漏 appRoot 稳定性/bounds 语义/locator 歧义/多次采样一致性；只出 md（codex） | t5⑥⑦⑧⑨ + calibration.json SSOT |
| 守恒断言"semantic_layout dump 不发生"与现状矛盾；copy_edits_only 漏写（claude） | t6b 口径改"相对现状零新增"+跟集合走 |
| check 结构化返回，别正则抠 details（cursor） | t0③ |
| normRectsOverlap 未导出（claude，顺带） | t0④ |

# 设计要点

## 口径与命名（为什么本期不建循环状态机）

codex 的 t0-visual-loop-state-machine 建议（loop 状态迁移/critic 与 fixer 双 fresh
context/唯一裁决点）方向正确，但它依赖：结构化 findings（t0）、可信轮次账本（t1）、
可对账的转录链（t2）、可验证的 critic 调用证据（t3）——全部是本 plan 的交付物。先建
状态机=在散文和自觉之上编排，等于把现在的问题搬进调度器。故本期定位**基础设施加固**，
状态机立后继 plan（届时 OpenSpec 5.4 的 critic phase 侧一并关闭）。在此之前，一切
文档措辞用"熔断/对账/签发/可观测"，不用"机器保证循环会转"。

## 与既有 goal 熔断机制的关系（t1，初版漏看的关键背景）

goal-runner 既有三层：①shouldHaltNoProgress——visual_gap 同 blocker-id signature 连续
两 attempt 重复 → halt（no_progress_visual_gap）；②CUMULATIVE_HALT_FAMILY 跨 attempt
累计熔断（toolchain/await_human_confirm）；③await_human_confirm 等首触即 halt 的
classification 通道。t1 的指纹 fuse 是第④层：粒度最细（残差级）、由 check 产出 BLOCKER
并走 classification 通道首触即 halt——比 ①更早更准（①要等两个完整 attempt 且是
blocker-id 粗粒度）。①保留为兜底不删；两者 halt 原因可区分，报告/文档写清。

## 轮次定义与账本幂等（t1 的核心修正）

「轮次」=一次**有效评估状态**（build_fingerprint + 全屏 evaluated_screenshot_hash +
指纹集 的三元组），不是一次 harness 执行。goal 态每 attempt 里 harness 至少跑两次
（agent 会话内自跑 + runner 脚本闸门），交互态用户会重复跑——幂等去重保证同状态只记
一轮，熔断比较的是「状态迁移」而非「执行次数」。build 指纹在比较中只回答"这两轮之间
有没有重建"（归因），不回答"该不该熔断"（指纹集相等即无进展，无论重建与否）。

## verified 回执的信任链（t3，rev2 收窄）

信任根=goal-runner 自身（宿主 framework 完整性由 e8f5a2c7 守护）：runner 读**结构化
工具事件**（t3a 契约）→ 提取图片读取记录 → 生成回执并附 runner attestation
（goal_run_id + 证据日志 hash 的完整性绑定，非密码学签名）。agent 伪造路径：手写
verified 缺 attestation → 拒；改日志 → hash 不符 → 拒。证明力边界：这证明「工具调用
发生过且输入被注入」，不证明「模型看懂了图」——与 OpenSpec"invocation records, not
model cognition"一致。交互态无 runner 信任根，维持 unverified + SSOT Read 强制。

## 静稳采样判据（t4，rev2 重设计）

弃用整图字节恒等（状态栏秒级元素使其真机上几乎恒假——这与「像素恒等作新鲜度键被
证伪」是同一教训的另一面）。双稳判据=app 窗口裁剪区图像稳定 + 规范化布局签名稳定；
两者都过才认「图树同状态」。已知残余局限（如实记录，不宣称原子采样）：A→B→A 状态
往返、裁剪区外变化影响布局的边角情形——静稳是**启发式**，故 unstable 只降档不禁判，
且判据参数以 t5⑨ 真机实测校定后再收紧。

## 回灌台账所有者（t6，rev2 重设计）

反馈落账的可信度排序：真人 TTY 工具同事务写入 > runner 机器盖戳 > agent 转录。
visual-confirm CLI 已是 T2 的既有真人通道（y/f 打回、防宽筛、headless 拒跑），落账
内聚其中=「反馈不丢」由工具事务保证而非 agent 自觉。ledger 选 append-only jsonl：
台账语义（只增不改），配合 oracle_version 字段实现"oracle 代码变了→历史样本失效"
的可推导性。

## 轻量化守恒（与 d4a7c1e8 的关系，成本口径 rev2 修正）

三层结构性保障不变：轨道隔离（L0/L1 不进重链）、档位隔离（重机械只落 pixel_1to1）、
守恒测试锁死（t6b，断言口径=**相对现状零新增**）。成本增量如实记账：pixel_1to1 屏
静稳采样最坏 6 shot+3 dump/屏（默认参数，待实测校定）；账本/对账/回执均为文件级
零设备成本。净减重项不变：分数必填契约已废除、逐页找人改收敛后一次批量终审。

## 账本与判定文件的红线切分（t1/t6 共用）

tamper-scan 红线保护**判定产物**（verdict/分数/签字）且只扫脚本文件（.js/.cjs/.mjs/
.ts），jsonl/yaml 侧车不会误伤（已核实 evidence-tamper-scan.ts 判据）。两账本均为
telemetry/标注侧车：visual-rounds 由 harness-runner 追加（机器盖戳）、review-feedback
由 visual-confirm CLI 追加（真人事务），不含判定字段，check 只读消费。

## 与 c6d8f2b4 的关系

纯增量：不改 A/B/C 档位、不改 reported_*/M1/attest 语义；t0 扩展 LayoutFinding/defect
结构（可选字段，legacy 兼容）；t2 对账消费 T8 findings；t1 消费 rev9 指纹纯函数与
isRoundFingerprintable；t9 合并执行其 t11。c6d8f2b4 的 D7（熔断无自动化测试）由 t1
关闭；D9（goal verified 生产者）由 t3 按盘点结论关闭或如实降级。

# 实施记录

（待 review 通过后填写）

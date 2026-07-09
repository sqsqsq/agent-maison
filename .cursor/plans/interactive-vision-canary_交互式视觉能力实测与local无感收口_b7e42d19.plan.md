---
name: 交互式视觉能力实测与 framework.local.json 无感收口
version: 3.0.0
# 版本说明：立项时包版本 2.4.0 标 2.4.1 排下一窗口；合并主干后包版本跳 3.0.0，PR #1 曾临时
# 改标 3.0.1 保门禁不炸。用户 2026-07-09 拍板：排入 3.0.0 窗口——version === current 语义
# 即"3.0.0 发版前必须完成"（check-plan-version.mjs default 模式放行、--release 模式拦截，
# 与 android_工程适配 等既有 3.0.0 窗口 pending plan 同列）。deferred_to 仅 version > current
# 时有意义，已随之移除。
overview: >
  【背景（2026-07-09，宿主 SimulatedWalletForHmos cursor 工程实测发现的边界；2026-07-09
  双 AI review 后修订前提措辞）】E1 金丝雀（自动实测+判卷+写盘）只挂在 goal-runner
  preflight，交互式路径从不触发它。交互式现状**不是零实测**——E1 同期在
  spec-workflow-detail.md「交互式自答」段落留了软机制（agent 用 Read 打开参考图自述内容、
  给不出具体描述则如实走盲档，理由是"有真人在场核对，比自动金丝雀更可信，不必等自动化"）；
  但软自答无确定性判卷、无写盘、无缓存，依赖模型诚实——盲模型被指令"描述图片"时可能幻觉
  而非诚实说看不见。宿主实证：该工程 framework.local.json 无 vision 键、零盲档产物，真实
  原因是 cursor 模型真有视觉、软自答默默通过；但交互式 IDE 模型是下拉框随手切换的，换成
  纯文本模型后案A（mx 2.7 套壳骗过声明式探测）的洞经软自答幻觉路径原样重现。**本 plan
  的定性是把 E1 软自答升级为确定性判卷（推翻其"不必等自动化"决策——威胁模型变了），
  不是"收口纯声明遗留"**。
  【目标】交互式路径获得确定性视觉能力实测（自答→脚本判卷→无感写盘缓存）；检测到盲
  模型时利用交互式独有优势（可以说话）告知用户并一次性确认降级——顺带吸收 E2 实施记录
  遗留的"交互式下 enum 确认一次（默认接受钳制）"未做项。【诚实边界】交互式无编排器
  强制 spawn，整条"读图→写答卷→跑判卷"链是 soft_rule_only（依赖 agent 照做 SKILL 指令），
  强度提升 = 把"依赖模型诚实自评"换成"确定性判卷+随机卷+写盘缓存"，**不与 goal 模式
  等效**——goal 是编排器强制，交互式做不到，不宣称等效。
  【已验证的现状基建（2026-07-09 源码核实，不需要新造）】①无感写盘：ensurePersonalSetup
  的 mergeLocalPatch + writeLocalConfig 已在交互式 --ensure 时无感写 agent_adapter；goal
  金丝雀已在无感 merge 写 vision.canary（goal-preflight.ts:343 spread existing 模式）——
  交互式金丝雀沿用即可。②挂载点：spec SKILL 已有 BLOCKER 级前置"跑 harness 前须
  check-personal-setup --json --ensure"，天然触发时机（但挂载不止 spec，见分叉5）。
  ③判卷器：classifyCanaryResponse 已是纯函数（answerKey 可注入参数）。④UI 相关性判定：
  fidelity-shared.ts resolveUiRelevanceForRun 已单点收口（goal 侧 resume 漏判修复的产物），
  交互式挂载复用同一口径。
  【设计分叉（实施前须拍板，plan 内给推荐）】
  ▶ 分叉0 与既有软自答的关系（cursor review 补）：spec-workflow-detail.md「交互式自答」
  段落在自测卷落地后何去何从。推荐：**替换为主 + 兜底回退**——该段落改写为指向自测卷
  流程（有新鲜 canary 缓存→跳过；无缓存→跑自测卷 CLI）；仅当 CLI 不可用/执行失败时回退
  原软自答描述法（兜底不删除，且回退结果不写盘缓存——只有确定性判卷结果才配缓存）。
  ▶ 分叉1 探测方式：goal 模式是编排器 spawn 一次 headless invoke；交互式没有编排器，
  agent 就是会话本身。推荐：自测卷模式——SKILL 指令让交互式 agent 读金丝雀图并把原始
  答案写入答卷文件，再由确定性判卷脚本判卷+无感写盘。agent 不自评（判卷权在脚本），
  盲模型无法答对几何/颜色题（1/4^4 且需文字 token 同中）。**握手协议（codex review 钉死，
  防实施拆成两条命令重开作弊面）**：单进程闭环——CLI 启动即出题并输出机器可读 JSON
  （challenge_id/image_path/answer_path/expires_at），进程**保持等待**轮询答卷文件，agent
  读图写答卷后 CLI 同进程内判卷+写盘；answer key 全程仅存进程内存、绝不落盘（agent 拿到
  的只有图路径）；等待超时 → fail-safe **不写盘**只提示（超时≠盲，可能只是 agent 没照做，
  误写 none 会把有视觉的会话错钳）。**并发模型（cursor review 第二轮钉死，防死锁）**：
  交互式 agent 单线程顺序执行——前台跑 CLI 会阻塞等命令返回，而 CLI 在等答卷文件，互等
  即死锁。协议显式要求：agent 须**后台（非阻塞）启动 grader**，从其初始输出取
  image_path/answer_path，看图写答卷，再等待其退出取 verdict；CLI 侧 answer_path 就绪或
  expires_at 超时**二者先到即结束**。此编排对弱模型不友好是 soft_rule_only 的已知代价
  （SKILL 共享 reference 段把后台启动步骤写死成逐步指令，不留编排自由度）；若实测弱模型
  高频编排失败，届时再评估两命令+图内嵌机读 ground truth（隐写）等替代协议——须重过
  review，不在本轮擅自改。
  ▶ 分叉2 作弊面：固定答案卷（CANARY_ANSWER_KEY 常量 + assets 目录里还落了
  answer-key 文件）在交互式下作弊面显著大于 goal 模式（agent 与判卷在同一会话，翻源码/
  答案文件的概率高——不是恶意威胁模型，而是"尽职 agent 会 grep"）。推荐：交互式判卷走
  随机题卷——grade CLI 现场生成随机颜色布局+随机 token 的金丝雀图。goal 模式固定卷维持
  不动（E1 已声明不防恶意，且 headless 作弊面小）。**成本如实（cursor review 补）**：
  renderCanaryImage 当前未导出且色块位置/颜色/token 全硬编码，须先重构为接受 answerKey
  参数并导出——不是"注入随机 key"一句话的量级，I1 里算作显性重构项。
  ▶ 分叉3 缓存新鲜度：交互式 IDE 模型随手切换，per-adapter 缓存会静默过期（goal 模式
  headless CLI 模型相对固定，此风险交互式独有且拿不到模型名做缓存键——cursor 不暴露）。
  推荐：交互式探测结果写入 vision.canary 时附 probed_via: interactive 标记（schema 白名单
  同步）；**新鲜度判定单点收口（codex review 钉死，防只改 SKILL 层堵不住 harness 消费链）**：
  抽共享函数 isVisionCanaryFresh(canary, adapter, now)，decideVisionCanaryProbe、
  multimodal-probe 的 resolveContextAdapterImageInput（现状 :110 只查 adapter 相等即采信）、
  readCanaryOcrCapableSignal 三个消费点共用——超龄（probed_via=interactive 且 >24h TTL，
  常量不进 schema；goal 来源不受 TTL 影响）的缓存不再当"新鲜实测"静默采信：harness 消费点
  采用时降级标注 stale 并出 readiness advisory，SKILL 层提示重测（一句话+一条命令，不阻断）。
  缺省 probed_via 视作 'goal' 向后兼容。不追求完美失效检测——目标是把"静默错一个月"压到
  "最多错一天且有提示"。
  ▶ 分叉4 盲档告知 UX：headless 不能问人（E0 已治），交互式可以。推荐：判卷结果为
  none/ocr_capable 时，SKILL 指令 agent 明确告知用户"检测到当前模型无视觉能力，本
  feature 将按 semantic_layout/reference_only 档位执行（OCR 辅助：是/否）"，enum 确认
  一次（默认=接受降级继续）。**登记为具名确认点（codex review 钉死，"既有惯例"须落到
  registry 契约防话术自由发挥）**：confirmation-registry.yaml 新增 `vision.blind_tier`
  enum 条目（portable：1=接受降级继续（默认）/ 2=拒绝——指引 image_input_override 或
  换模型），过 check-skills-confirmation-ux lint；留痕沿 user-confirmation-ux 既有惯例。
  ▶ 分叉5 挂载点（codex review 补，防 resume/后期阶段漏判——goal 侧同类洞已有先例，
  即 resolveUiRelevanceForRun 的由来）：视觉能力影响的不只 spec，还有已有 UI feature 的
  coding/device-testing/code-review 及 change-lite，用户也可能从已有 spec.md resume。
  推荐：检查逻辑写成一段共享 reference 指令（复用 resolveUiRelevanceForRun 口径判 UI
  相关性），spec/coding/device-testing/code-review/change-lite 五个 SKILL 的 personal-setup
  前置后统一引用——spec 只是第一个入口，不是唯一挂载点。
todos:
  - id: i1a-canary-grade-cli-machinery
    content: >
      I1a 判卷 CLI 机器件（cursor review 建议的拆分，先机器件后挂载，便于 checkpoint）。
      新增 grade-vision-canary.ts（或挂进既有 check-personal-setup 子命令，实施时看哪边
      更顺）。**握手协议（分叉1 钉死，单进程闭环 + 显式并发模型）**：CLI 启动即出题并
      输出机器可读 JSON（challenge_id/image_path/answer_path/expires_at），同进程保持
      等待轮询答卷文件 → agent（须**后台非阻塞启动**本 CLI，前台跑即死锁）读图写答卷 →
      CLI 判卷+写盘，answer_path 就绪或 expires_at 超时二者先到即结束；answer key 仅存
      进程内存、绝不落盘；等待超时 fail-safe 不写盘只提示（超时≠盲）。步骤：①出题——
      随机题卷（分叉2）：**先重构 renderCanaryImage 为接受 answerKey 参数并导出**（当前
      未导出且色块/颜色/token 全硬编码，显性重构项非"注入 key"一句话），随机颜色布局+
      随机 token 现场生成图；②同进程等待答卷；③classifyCanaryResponse(answerKey 注入
      随机卷) 判卷；④mergeLocalPatch 无感写 vision.canary（含 probed_via: 'interactive'，
      framework-local-config.ts + config-field-ownership.ts +
      specs/framework.local.schema.json 三处白名单同步 + roundtrip 测试）。单测：判卷
      分级（全对/仅token/全错/空答）、随机卷不复用答案、超时不写盘、写盘 merge 不破坏
      既有字段、schema 校验。
    status: completed
  - id: i1b-skill-mounting-soft-answer
    content: >
      I1b SKILL 挂载与软自答改写（依赖 I1a）。分叉5 中央挂载：检查指令写成共享
      reference 段（复用 resolveUiRelevanceForRun 口径判 UI 相关性），把**后台启动
      grader → 取 image_path → 看图写答卷 → 等退出取 verdict** 的并发编排写死成逐步
      指令（不留编排自由度，防弱模型踩死锁或拆两条命令），
      spec/coding/device-testing/code-review/change-lite 五个 SKILL 的 personal-setup
      前置后统一引用；同步改写 spec-workflow-detail.md「交互式自答」段为指向自测卷流程
      （分叉0：替换为主，CLI 不可用/失败时回退软自答且回退结果不写盘）。
    status: completed
  - id: i2-cache-freshness-interactive
    content: >
      I2 交互式缓存新鲜度（分叉3，单点收口；stale 语义按 codex 第二轮口径钉死，防"stale
      但仍采用旧 verdict 只多打 warning"的误读）：vision.canary 增设 probed_via 字段
      （goal 探测写 'goal'，交互式写 'interactive'；缺省视作 'goal' 向后兼容）；抽共享
      函数 isVisionCanaryFresh(canary, adapter, now)，三个消费点共用：
      decideVisionCanaryProbe、multimodal-probe 的 resolveBaseImageInput（现状 :110 只查
      adapter 相等即静默采信缓存——本条要堵的主洞）、readCanaryOcrCapableSignal。
      interactive 来源 >24h TTL（常量不进 schema）→ **硬语义**：①超龄 interactive canary
      不得贡献 tool_read / ocr_capable 判定；②resolveBaseImageInput 对超龄缓存回退
      adapter 声明/heuristic 路径；③MultimodalProbeResult 的 reason（或新增 advisory
      字段）带出 interactive_canary_stale 标记；④readCanaryOcrCapableSignal 对超龄
      interactive 的 ocr_capable 返回 false。SKILL 层提示重测（一句话+一条命令，不阻断）。
      goal 来源不受 TTL 影响（headless 模型稳定假设维持）。adapter 变更即失效语义两来源
      通用（既有）。单测：TTL 边界、来源缺省兼容、goal 缓存不受 TTL、超龄 interactive
      缓存四条硬语义各一例（不贡献 tool_read / 回退声明式 / stale 标记在场 /
      ocr_capable=false）。
    status: completed
  - id: i3-blind-tier-interactive-ux
    content: >
      I3 盲档告知与一次性确认（分叉4，吸收 E2 遗留"交互式 enum 确认一次"未做项）：
      判卷 none/ocr_capable 时 SKILL 指令 agent 用一段固定话术告知用户当前模型视觉判定
      结果 + 本 feature 将生效的 effective fidelity 档位 + OCR 辅助可用性，enum 确认一次。
      **confirmation-registry.yaml 新增具名条目 `vision.blind_tier`**（enum：1=接受降级
      继续（默认）/ 2=拒绝——指引 image_input_override 或换模型），过
      check-skills-confirmation-ux lint；确认结果留痕走既有 user-confirmation-ux 惯例
      （不新造确认基建）。SKILL/reference 文档同步：personal-setup-gate.md、ui-spec.md
      盲档工作法一节补交互式入口说明。
    status: completed
  - id: i4-gates-and-regression
    content: >
      I4 门禁与回归：typecheck + 全量 unit + fixtures 三绿；新增用例覆盖 I1-I3 全部
      分支（含超时 fail-safe、软自答回退、stale 四条硬语义、registry lint）；手工冒烟
      一次交互式自测卷全流程且**须走真实并发路径**（cursor 第二轮要求：后台启动 grader
      → 从初始输出取 image_path → 写答卷 → 等退出取 verdict → 重跑读缓存 skip——不只是
      脚本级出题/判卷函数冒烟，要验证死锁不存在与超时收尾）；plan 实施记录如实回填
      （含分叉决策的最终拍板与偏离说明）。
    status: completed
---

# 实施记录

## 2026-07-09 · I1a–I4 全量实现（两轮双 AI review 后开工）

**验收**：`npx tsc --noEmit -p tsconfig.typecheck.json` 0 错误；`cd harness && npm test` 全绿（**1689 单测 + 42 fixtures**，较开工前 1673 净增 16）；`npm run openspec:validate` 31/31；`node scripts/check-plan-version.mjs` default PASS。

### I1a 判卷 CLI 机器件 + 握手 + renderCanaryImage 重构 + schema 三处同步
- **renderCanaryImage 重构**（cursor 成本提示落实）：原私有 + 颜色/token 硬编码 → 导出 + 接受 `answerKey` 参数驱动象限颜色与 token（`quadrantOrigin` 映射 question id→象限）；缺省固定卷，goal 模式沿用不变。新增 `generateRandomCanaryAnswerKey(rng=crypto.randomInt)`（Fisher-Yates 打乱颜色 + 8 位随机 token，rng 注入可测）。
- **判卷 CLI**：新增 [scripts/grade-vision-canary.ts](../../harness/scripts/grade-vision-canary.ts) + 可测核心 [scripts/utils/vision-canary-interactive.ts](../../harness/scripts/utils/vision-canary-interactive.ts)（`startInteractiveCanaryChallenge` 出题+渲染、`waitForAnswerFile` 轮询、`finalizeInteractiveCanary` 判卷+写盘）。握手：CLI 首行 flush `CHALLENGE {challenge_id,image_path,answer_path,expires_at}`，同进程等待答卷 → `VERDICT`/`TIMEOUT`；**answer key 只存内存绝不落盘**（反 grep），**超时不写盘**（fail-safe，超时≠盲）。并发模型（cursor 第二轮）：agent 须后台启动，CLI 侧答卷就绪或超时先到即收。
- **probed_via 三处白名单同步**：`framework-local-config.ts`（校验 goal|interactive + 缺省兼容）、`config-field-ownership.ts`（`LOCAL_VISION_CANARY_KEYS` 加 probed_via）、`specs/framework.local.schema.json`（**顺带补 E1 遗漏的整段 vision block**——原 schema 根本没有 vision，additionalProperties:false 会拒 vision，是文档级 split-brain，一并补齐 + probed_via）。goal-preflight 写盘补 `probed_via:'goal'`。
- **顺带修 latent bug**：`personal-setup-gate.ts` 的 `mergeLocalPatch` 只 spread agent_adapter/toolchain、**抹掉 vision**——`check-personal-setup --ensure` 一跑就把金丝雀缓存清空。改为保留 base.vision + merge patch.vision，补 recordAdapterToLocal 回归测试。
- **测试**：`vision-canary-interactive.unit.test`（9 例，含 2 例**真实 CLI spawn 并发**：后台起 grader→写答卷→判卷写盘不死锁 / 超时 TIMEOUT 不写盘）；framework-local-config +1（probed_via roundtrip + 缺省兼容 + 非法拒绝）；personal-setup-gate +1（mergeLocalPatch 保 vision）。

### I1b 五 SKILL 挂载 + 软自答改写
- 新增共享 reference [interactive-vision-canary.md](../../skills/reference/interactive-vision-canary.md)：适用条件、**防死锁并发编排逐步指令**（后台启动→读 CHALLENGE/SKIP→看图作答→写答卷→等退出取 verdict）、CLI 失败回退软自答（**回退结论不写缓存**）、强度诚实（soft_rule_only，不宣称与 goal 等效）。
- 五 SKILL（spec/coding/code-review/device-testing/change-lite）personal-setup 行后各加一行指向该 reference（行数 107–139，均在 150 预算内）。
- 改写 [spec-workflow-detail.md](../../skills/reference/spec-workflow-detail.md)「交互式自答」段：软自答（依赖模型诚实、盲模型幻觉）→ 确定性自测卷为主，CLI 不可用才回退软自答且不写缓存（分叉0 落地）。

### I2 缓存新鲜度 isVisionCanaryFresh 单点收口
- 抽 `isVisionCanaryFresh(canary,adapter,now)` + `VISION_CANARY_INTERACTIVE_TTL_MS=24h` 于 multimodal-probe.ts，**三消费点共用**：`resolveBaseImageInput`、`readCanaryOcrCapableSignal`、goal-preflight `decideVisionCanaryProbe`。
- codex 四条硬语义全落地：①超龄 interactive 不贡献 tool_read/ocr_capable；②`resolveBaseImageInput` 回退声明式/heuristic；③`MultimodalProbeResult` 加 `staleInteractiveCanary` 标记 + reason 带 `interactive_canary_stale`（另 warn-once 到 stderr，沿既有 `warnDeprecatedMultimodalOnce` 模式——mmProbe 与 readinessSignals 不同函数、threading 过重，故用 dedup stderr + 离散标记，codex ③ 明示"reason 或 advisory 字段"即满足）；④`readCanaryOcrCapableSignal` 超龄返回 false。goal 来源不受 TTL、缺省 probed_via 视作 goal（向后兼容，既有 E1 测试用旧时间戳无 probed_via 全部继续通过）。
- CLI 加 SKIP 短路：已有新鲜 canary（本 adapter）→ `SKIP {reason:fresh_cache}` 不出题（`--force`/`--refresh` 跳过）。
- **测试**：multimodal-probe +4（isVisionCanaryFresh 真值表 + ①②③ 回退 + 新鲜仍采信 + ④ ocr）；goal-preflight +1（超龄 interactive→probe / 同龄 goal→skip）。

### I3 盲档告知 + vision.blind_tier 具名确认点
- `confirmation-registry.yaml` 新增 `vision.blind_tier`（`_cross_phase` enum，1=接受降级继续默认 / 2=拒绝→override 或换模型），过 check-skills-confirmation-ux lint（6/6）。
- ui-spec.md「盲档工作法」补交互式告知+确认入口；personal-setup-gate.md「相关」补指针。留痕沿 user-confirmation-ux 惯例，未新造确认基建。

### 偏离与诚实标注
- I1 拆 I1a/I1b（cursor 组织建议采纳）。
- I2「readiness advisory」用 dedup stderr warn + `staleInteractiveCanary` 离散标记实现，未接入 harness-runner 的 `readiness_signals`（mmProbe 与 summary 构建在不同函数、threading 侵入面大，收益仅"多一条可见提示"）——codex 硬语义已全满足，此为可见性层面的实现取舍，如实记录。
- 真实并发路径冒烟已由 vision-canary-interactive 的 2 个 CLI spawn 测试自动化覆盖（后台起→写答卷→verdict 不死锁 / 超时不写盘），非仅函数级；happy-path 的"正确作答→tool_read"因随机卷答案在 CLI 进程内存、外部不可知，用 finalize 单测（注入已知 answerKey）覆盖，CLI spawn 测试用 CANNOT_SEE_IMAGE 确定性验证写盘链路。

### 第三轮双 AI review 修复（2026-07-09，全实现后）——2 真 bug + 3 minor

两边都给"通过"，各出一处需修，逐条对源码核实后全修（**1689→1692 单测**）：

- **codex P1（真 bug，核心洞未完全堵）**：grade CLI 的 SKIP 用 `isVisionCanaryFresh`，它对 `probed_via='goal'`（含缺省旧缓存）永不过 TTL——于是 goal/headless 之前为同 adapter 写过 tool_read 后，用户在 IDE 换成纯文本模型跑交互式自测会被直接 SKIP，正好放回本 plan 要堵的"交互式可换模型"洞。核实属实。修复：新增 `isFreshInteractiveCanary`（只认新鲜 interactive 缓存），CLI SKIP 改用它；`SKIP.reason` 改 `fresh_interactive_cache`。harness 消费面（resolveBaseImageInput 等）仍用 isVisionCanaryFresh 采信 goal 实测（那是对的，差异仅"交互式该不该重测"）。补测试：goal 缓存→CLI 出 CHALLENGE 不 SKIP / 新鲜 interactive→SKIP（真 spawn）+ isFreshInteractiveCanary 真值表。
- **codex P2 / cursor #1（半写入竞态）**：`waitForAnswerFile` 一见文件存在即读判卷，非原子写工具先建空文件再逐步写时可能读到空/半截 → 误写 none。修复：只接受 `content.trim()` 非空（空/空白视作未写完，继续轮询到非空或超时 fail-safe），文档补"一次性完整写入，非原子则先临时文件再 rename"。补 2 例（空→轮询到非空收卷 / 纯空文件超时不收卷）。
- **cursor minor**：schema description 中英混排 `written无感 by` → `written silently by`；`warnStaleInteractiveCanaryOnce` 的去重 Set 折进既有 `__resetMultimodalProbeWarningsForTest`（跨用例隔离卫生）。
- **codex P3 / cursor（android plan 正文漂移）**：android frontmatter 已 3.0.1/deferred_to 但正文（标题/版本绑定节/scaffold todo/mermaid 标签/master plan 描述）仍写 3.0.0 在窗——门禁不受影响但会误导。已全改为 3.0.1 顺延口径。**commit 建议**：android 顺延与本金丝雀特性无关，建议单独一个 commit（cursor 提议，采纳，待用户提交时分开）。

**第四轮（2026-07-09）——codex 复审确认 P1/P3 已修，P2 仅关了一半**：上轮的 `content.trim()` 非空只堵了"先建空文件"，堵不住"已写入一部分非空内容"（如非原子写先落 `TOP_LEFT_COLOR=red\n`，CLI 立即读到非空 → 判低档/none 写错缓存）。核实属实。修复：新增 `isCanaryAnswerComplete(content, answerKey)`（完整 = CANNOT_SEE_IMAGE 或全部 4 几何键 + TEXT_TOKEN 键齐，值不论），`waitForAnswerFile` 加 `isComplete` 注入判据、CLI 传入 canary 完整性判据；半截非空内容视作"尚未写完"继续轮询到完整或超时 fail-safe。文档同步（完整答卷才收卷 + 非原子写建议 temp+rename）。补测试：isCanaryAnswerComplete 真值表（半写入/全键齐/CANNOT_SEE_IMAGE/空）+ waitForAnswerFile 半写入续写才收卷 / 始终半截超时不收卷。**1692→1693 单测**。

## 立项背景补充（2026-07-09）

- 触发事件：用户在宿主 SimulatedWalletForHmos（cursor adapter）真机测试阶段做 UX 确认
  循环，问"这个过程到底是模型多模态在读图还是离线 OCR 在读图"。排查中确认该工程
  framework.local.json 无 vision 键、全程零盲档产物——E1 自动金丝雀从未触发（只挂 goal
  preflight），交互式仅有 spec-workflow-detail.md 的软自答指令兜着（无判卷/写盘/缓存），
  该案软自答默默通过是因为 cursor 模型真有视觉。
- 该案本身无事故（logo 重裁被用户确认正确），但暴露的边界与案A 同构：交互式 + 换模型 =
  软自答依赖模型诚实，盲模型被指令"描述图片"时可能幻觉而非诚实说看不见——声明式探测
  被骗的原始洞经幻觉路径在交互式模式下原样存在。
- "无感写入"不是本 plan 要新造的能力：check-personal-setup --ensure 已无感写
  agent_adapter（该宿主 local.json 即其产物，用户从未手动编辑）；goal 金丝雀已无感写
  vision.canary。本 plan 只是让交互式金丝雀沿用同一模式，并把"检测到盲模型"这一刻从
  静默变成交互式独有的一次性告知+确认。

## 双 AI review 修订记录（2026-07-09，实施前）

cursor + codex 各出一份 plan review，逐条对源码核实后**全部坐实、无一误报**，已修入上方
overview/todos：

- **cursor（前提遗漏，必须修）**：原前提"交互式从不触发实测、纯靠声明"过强——E1 已有
  软自答机制（spec-workflow-detail.md「交互式自答」段，且明文"比自动金丝雀更可信，不必等
  自动化"）。本 plan 实质是推翻该决策（威胁模型变了：IDE 下拉框换模型 + 盲模型幻觉），
  已把叙事从"收口纯声明遗留"改为"升级软自答为确定性判卷"，并新增**分叉0**（与软自答的
  关系：替换为主+CLI 失败回退兜底）。技术两点如实入 todo：renderCanaryImage 须先重构
  （未导出+全硬编码）；交互式实测是 advisory 非 goal 级强制，overview 撤回"与 goal 等效"。
- **codex（三 P1 一 P2，全采纳）**：①I1 握手协议钉死单进程闭环（机器可读 JSON 出题 +
  同进程等待判卷 + answer key 绝不落盘 + 超时不写盘），防实施拆两条命令重开作弊面；
  ②新鲜度单点收口 isVisionCanaryFresh，三消费点共用（multimodal-probe:110 现状只查
  adapter 相等即静默采信是主洞，只改 SKILL 层堵不住）；③挂载点从 spec 独有升级为五
  SKILL 共享 reference 段（复用 resolveUiRelevanceForRun 口径——goal 侧 resume 漏判
  先例的同款收口）；④盲档确认落 confirmation-registry 具名条目 `vision.blind_tier`，
  不留"既有惯例"自由发挥空间。

**第二轮（2026-07-09，对修订版复核）**：两边均确认可进实施，各留一点，核实后均属实已修入：

- **cursor（并发死锁，动工前钉死）**：第一轮钉的"单进程闭环"引入了新问题——交互式
  agent 单线程顺序执行，前台跑 CLI 阻塞等返回、CLI 阻塞等答卷，互等即死锁；被死锁卡住的
  实施者会自然拆成两条命令，恰好重开 codex 堵的作弊面。修法：分叉1/I1a 显式补并发模型
  （agent 后台非阻塞启动 grader → 取初始输出 → 写答卷 → 等退出取 verdict；CLI 侧答卷
  就绪或超时先到即收），I1b 把该编排写死成 SKILL 逐步指令，I4 冒烟须走真实并发路径。
  弱模型编排失败风险如实承认为 soft_rule_only 代价；若实测高频失败再评估隐写等替代协议
  （须重过 review）。组织性建议同采纳：I1 拆 I1a（机器件）/I1b（挂载），便于 checkpoint。
- **codex（stale 语义口径收紧，非 blocker）**：I2 原句"降级标注 stale 并出 advisory"
  可被误读为"仍采用旧 verdict 只多打 warning"。钉成四条硬语义：超龄不得贡献
  tool_read/ocr_capable；resolveBaseImageInput 回退声明式/heuristic；ProbeResult 带
  interactive_canary_stale 标记；readCanaryOcrCapableSignal 对超龄返回 false。四条各配
  一例单测。（函数名 resolveBaseImageInput 已对源码核实无误，:94 内部函数。）

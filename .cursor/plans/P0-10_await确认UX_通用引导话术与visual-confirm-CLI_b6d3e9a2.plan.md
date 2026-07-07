---
name: P0-10 — await_human_visual_confirm 确认 UX（通用引导话术机器生成 + visual-confirm CLI）
version: 2.4.0
# 版本说明：版本号保持 2.4.0，节奏由用户控制（与 P0-9 同口径）。
overview: >
  背景：P0-9b 把"设计内求人时刻"正确分类为 await_human_visual_confirm 并给了指引，但指引
  写给"会手改 JSON 的人"——真实操作者的入口是对话和一条命令，手改 visual-diff.json 属
  用户不友好的裸接口（用户原话：谁会知道要改这个 json？需要一键化、傻瓜化）。homepage
  本 run 用了一段人工拼的话术应急，但那是特例：话术必须由框架按 run 上下文**机器生成**
  （feature/run_id/路径全部参数化、尊重 paths.features_dir），**不得含任何具体人名/特定
  需求内容**——署名由确认流程当场向真人询问，绝不进模板。
  三件套：①halt 时机器生成"转交交互 agent"的通用引导话术（首选入口，复制即用），手改
  JSON 降级为附录；②交互态确认协议固化进 skill（逐屏展示→等真人逐屏表态→转录署名，
  禁批量盲签/禁代答/禁自拟署名——转录≠伪造的边界写死）；③确定性 CLI `visual-confirm`
  （不依赖任何 AI agent 的兜底路径：终端逐屏弹图、y/n 表态、当场输署名、安全写盘）。
  约束：framework-only；2.4.0 窗口；确认语义不放松（P0-6 isHumanVerified 口径不变，
  T2/指纹绑定不动）；全量绿后等 review 提交。
todos:
  - id: p0-10a-guidance-builder
    content: >
      P0-10a 引导话术机器生成——AWAIT_HUMAN_VISUAL_CONFIRM_GUIDANCE 常量升级为
      `buildAwaitHumanConfirmGuidance(opts: { feature; runId; projectRoot })`（保留可测常量为
      通用行基底）：生成三段式指引①【推荐·对话式】"把下面这段话原样发给你的交互 agent"——
      段内 feature/run_id/screenshots 目录/visual-diff.json 路径全部按 opts 注入（featureDir
      尊重 paths.features_dir），并内嵌确认协议约束（逐屏展示等表态/认可转录 confirmed_by=
      操作者当场提供的署名/不认可 verdict=fail+原话进 must_fix/绑定三字段不动/无 BOM 保存/
      完成后 resume）；②【命令式·高保真】按 **layout 生成完整可复制命令**（codex 意见：宿主
      根没有该 script——consumer 用 `npm --prefix framework/harness run visual-confirm --
      --feature <f>`，standalone 用 `npm --prefix harness run …`；resume 命令同样按 run 上下文
      给全：`--feature <f> --resume <run_id> --force-resume`）；③【附录】手改 JSON 字段说明
      （格式即现状文档）。话术中注明信任层级（cursor 意见）：对话式最省事但属**软契约**
      （agent 中介转录），CLI 是真人直签的**高保真路径**——要最稳走 CLI。**模板零人名、
      零需求特定内容**（署名一律"由你当场提供"表述）。goal-runner halt 分支改用 builder
      产出写入 halt_guidance；单测断言：话术含 feature/run_id 注入、含协议五要素、
      不含任何硬编码人名样例。
      【补强②·输出面三处齐备（用户问"guidance 在哪看到"）】halt_guidance 不只进
      goal-report.json 字段：①generateGoalReportMarkdown 渲染 halt_guidance 段（detach 用户
      看 md）；②halt 时 console/detach.log 原样打印（看日志的撞见）；③json 字段保留（交互
      agent 查进度时转述）。单测断言 md 渲染含 guidance。
    status: completed
  - id: p0-10b-confirm-protocol-skill
    content: >
      P0-10b 交互确认协议固化——skills/reference 新章节或 device-testing SKILL 补节
      「visual 真人确认协议」：交互 agent 收到确认请求时须①逐屏展示截图与参考原图（附
      差异要点），一屏一屏等真人明确表态；②认可 → 转录 confirmed_by=真人**当场提供**的
      署名（转录≠伪造的边界：只能记录真人对具体屏的明确表态，含义写死）；③不认可 →
      verdict=fail + 真人原话进 must_fix；④禁批量盲签、禁未展示先问结论、禁代答、禁自拟/
      沿用历史署名；⑤绑定字段（evaluated_screenshot_hash/evaluated_build_fingerprint/
      screenshot_hash）不动，无 BOM 保存。agents/shared 规则模板 §4.5 红线补一句
      "交互态转录真人逐屏表态属合法确认路径"（消除 agent 因红线不敢转录的歧义）。
      【补强①·展示能力降级（用户问"所有 agent 场景都生效吗"）】"逐屏展示"按宿主 agent
      能力三级兜底：能内联展示图片（cursor 等）→ 内联；不能则调系统查看器打开（win start/
      mac open/linux xdg-open）；再不能则给出截图与参考图**绝对路径**请用户自行打开，
      等用户回复看完再问表态——协议措辞覆盖三级，纯 CLI 型交互 agent（codex exec/opencode
      TUI）不卡死。此三级同样写进 P0-10a 生成话术（话术自足，不依赖 bundle 下发）。
      【不变量点名（cursor 意见，本次事故源头所系）】headless goal-mode **永远 HALT、
      绝不转录/自签**——三入口（对话/CLI/手改）全部是 halt 之后、真人在场时才走；
      P0-9b 的 headless 分类与 HALT 行为不因 P0-10 有任何改动。协议与话术均显式写明
      "本协议仅适用交互态；headless 下 agent 唯一正确动作是 halt 等真人"。
      诚实边界同步写明：对话式转录仍是软契约（交互态 agent 理论上仍可编造署名——
      P0-8 带外凭证前的已知残余），CLI 为高保真路径。
    status: completed
  - id: p0-10c-visual-confirm-cli
    content: >
      P0-10c 确定性 CLI——harness/scripts/visual-confirm.ts + harness/package.json script
      `visual-confirm`：`--feature <f>` 读 visual-diff.json（featureDir 定位）→ 列出待确认屏，
      **筛选谓词与 checkVisualDiff 的 awaitHumanOnly 收窄判定同源**（codex P1：把 eligibility
      抽成共享谓词供两侧复用——pixel_1to1 + 当前指纹可算且屏指纹一致 + verdict=pass + 零
      must_fix + 无 stale/缺 hash + P0 覆盖；不得只按"pass 缺签"宽筛，防把 stale/带未清
      must_fix/绑定不全的屏签掉）→ 逐屏用 OS 默认查看器打开截图（win start/
      mac open/linux xdg-open）并打印参考原图路径 → 终端交互：y=认可 / f=打回（提示逐行输
      must_fix，空行结束）/ s=跳过 → 首次表态前询问署名一次（isHumanVerified 校验，拒
      user_requirement/自动化身份并解释）→ 安全写盘（JSON.stringify 两空格缩进+尾换行、
      无 BOM、绑定字段原样）→ 收尾打印 resume 命令。非交互环境（无 TTY/goal headless）
      直接退出并提示走对话式路径——CLI 本身绝不自动签。单测覆盖非交互纯函数：待确认屏
      筛选、署名校验、fail 转写（verdict/must_fix/清 confirmed_by）、写盘往返无 BOM、
      绑定字段不变。
    status: completed
  - id: wrap-up
    content: 收口——全量 typecheck/单测/fixture 绿；plan 勾选；等用户 review 提交；随下个发布件出去（本 run homepage 不依赖它——已用应急话术走通，P0-10 服务于以后所有 run）
    status: completed
---

# P0-10 — await 确认 UX：通用引导 + CLI

## 实现记录（2026-07-07，含偏差披露）

**落地清单**：
- `harness/scripts/utils/await-confirm-guidance.ts`（新）：`buildAwaitHumanConfirmGuidance`——
  三入口话术（对话式软契约 / CLI 高保真 / 手改附录），feature/runId/路径/layout 前缀全注入，
  展示三级降级内嵌，零人名、署名"当场提供"，含信任层级注记。
- goal-runner：halt 分支改用 builder 产物写 halt_guidance + **console/detach.log 原样打印**；
  旧静态常量 `AWAIT_HUMAN_VISUAL_CONFIRM_GUIDANCE` 废除。
- goal-report-generator：md 渲染「## 需真人逐屏确认」段（halt_guidance 全文）+ 表格 reason 标签。
- `visual-diff-check.ts`：抽 `isScreenAwaitConfirmEligible` 逐屏资格谓词，awaitHumanOnly 改用之
  （与 CLI 同源）。
- `harness/scripts/visual-confirm.ts`（新）+ package.json `visual-confirm`/`goal` script：
  纯函数（collectPendingConfirmScreens 同源筛选 / applyConfirm / applyReject / isAcceptableSigner /
  safeWriteVisualDiffJson 无 BOM）+ 交互 main（TTY 守卫、逐屏弹图、y/f/s、当场问署名校验、
  指纹不可算拒跑）。
- device-testing SKILL：补「visual 真人确认协议」（判定持久化 + 三级展示 + 转录≠伪造 +
  headless 仅 halt）；agents/shared §4.5 补边界消歧。

**偏差/取舍披露**：
1. plan 原提"保留可测常量为通用行基底"——实际直接删常量、测 builder 更诚实（避免"常量与
   builder 双份文案漂移"）。goal-headless-guard 对应用例重写为断言 builder 输出。
2. resume 命令统一走 `npm --prefix <harness> run goal -- …`——为此新增 package.json `goal`
   script 包装（原仅 `npx ts-node scripts/goal-runner.ts`，宿主根无脚本）；与 codex P2 的
   `npm --prefix` 形态一致，两条命令（visual-confirm/goal）同款可复制。
3. CLI 交互 main（readline/spawn 弹图）未单测——纯函数全测（筛选/署名/转写/写盘），交互
   面按 plan 走人工验收；safe-write 用 Buffer 写死无 BOM。
4. 新增单测：goal-headless-guard builder 1（注入/协议/零人名/完整命令）+ visual-confirm 套件 5
   （同源筛选/stale 排除/署名校验/转写/无 BOM 绑定不变）。

## 代码 review 二轮采纳（2026-07-07，codex）

- **P1a（修复）**：CLI 加**报告级 await gate**——`isReportAwaitConfirmState` 读 summary.json，
  要求门禁结论含 classification=await_human_confirm 才列屏（门禁自身结论为真源，比重跑逐屏
  谓词更忠实）；报告里还有确定性 FAIL 时拒跑，杜绝签过未裁决状态。补单测（await 放行/
  有其它 FAIL 拒/缺 summary 拒）。
- **P1b（修复）**：CLI 复用 buildAuthoritativeRefImageIndex/resolveRefSourceImage 解析**真实
  参考原图绝对路径**并打印+尝试打开（双侧证据）；参考图不可解析 → 该屏**不能认可**
  （只可打回/跳过），防无对照瞎签。
- cursor 二轮：判通过可提交；文档改动（SKILL/§4.5）与 builder 内嵌协议一致，风险低。
- **codex 三轮 P2（修复）**：await gate 从 `.some(await)` 收紧为"visual_diff[await] 存在 **且**
  除派生聚合项外无其它独立 BLOCKER"。**核实纠偏**：codex 字面建议 `.every(===await)` 会误伤
  合法 await 态——`testing_run_status` 聚合 blocker 在 visual_diff FAIL 时永远同时存在且
  classification=None（host summary 实证）；故改为 id==='visual_diff'+await、其余仅允许
  DERIVED_AGGREGATE_BLOCKER_IDS（testing_run_status）。补 4 场景单测（await+聚合=true /
  await+独立FAIL=false / 非 visual_diff id 挂 await=false / 无 await=false）。

## 外部评审采纳记录（2026-07-07，动手前）

- **cursor①（采纳，不变量点名）**：headless 永远 HALT 不转录/自签，三入口皆 halt 后真人在场
  才走，P0-9b 行为不动——写进 P0-10b 与话术。
- **cursor②（采纳，信任层级写明）**：对话式=软契约（agent 中介，P0-8 前已知残余）、CLI=
  真人直签高保真——便利性排序不变，权衡写进话术与设计要点，不让"首选对话式"读成
  "转录已完全可信"。
- **codex P1（采纳）**：CLI 待确认屏筛选与 checkVisualDiff awaitHumanOnly **同源谓词**
  （抽共享函数），不得宽筛。
- **codex P2（采纳）**：命令按 layout 生成完整可复制形态（npm --prefix …），resume 命令
  带全参数——宿主根目录直接可用。
- cursor 非阻断观察知悉：本项实为 UX 质量改进（homepage 本 run 不依赖）；CLI 交互面以
  纯函数单测+统一 safe-write 守住。

## 设计要点

- **通用性铁律**：一切话术/指引由 builder 按 run 上下文注入参数生成，模板不含人名、
  不含具体需求内容；署名只能来自真人当场输入。
- **三入口分层**：对话式（有 cursor/claude 等交互 agent 时最傻瓜）→ CLI（无 agent 也能
  一条命令走完）→ 手改 JSON（仅作附录文档，不再是主路径）。
- **不放松任何门禁**：CLI 与协议只是"采集真人表态"的更好界面；isHumanVerified/T2/
  指纹绑定/防篡改扫描全部原样——CLI 写盘的内容与手改等价，检出口径不变。
- **转录≠伪造边界写死**：agent 只能记录真人对具体屏的明确表态；这句话进 skill 与
  红线注记，双向消歧（既拦伪造，也别把合法转录吓回去）。

## 验收出口

1. builder 单测：feature/run_id/路径注入正确；协议五要素齐；零硬编码人名。
2. CLI 单测（非交互纯函数）：筛选/署名校验/fail 转写/无 BOM 往返/绑定字段不变；
   无 TTY 拒跑不自动签。
3. skill/红线文案落地；goal halt_guidance 实际输出为 builder 产物。
4. 全量 typecheck/单测/fixture 绿；等 review 后提交。

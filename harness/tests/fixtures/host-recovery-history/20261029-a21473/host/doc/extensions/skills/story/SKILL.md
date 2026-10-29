---
name: story
description: /story 需求流程编排——init 拉取需求资料并生成 AR/design.md、archive 归档评审载体、restore 回退归档覆盖。内含 AR 生成规则与 spec 宿主扩展章节生成规则。
---

# story — 需求开发流程编排

指令与章节的对应关系见跳板（命令转化表）；本文件各章节按动作组织。数据对接（需求系统拉取/归档/备份）统一由 [scripts/story.js](scripts/story.js) 承担。

## 需求系统 Token

`story.js` 的每条命令都要 `<mcp-token>` 参数。按顺序取，取到即用：

1. 跑 `node doc/extensions/skills/story/scripts/token.js`——exit 0 时 stdout 即 token（纯文本，非 JSON）；
2. 读 `~/.cac.json` 或 `~/.claude.json`（Windows 在 `%USERPROFILE%\` 下）：先看顶层 `mcpServers.requirement-mcp.headers.X-MCP-Token`，再看 `projects.<当前工程路径>.mcpServers.requirement-mcp.headers.X-MCP-Token`；
3. 都没有就向用户要，拿到后写入 `~/.cac.json`（不存在则建）顶层 `mcpServers`：

   ```json
   {
     "mcpServers": {
       "requirement-mcp": {
         "type": "http",
         "url": "https://mcp.wisedevops.huawei.com/requirement/mcp",
         "headers": { "X-MCP-Token": "<用户给的 token>" }
       }
     }
   }
   ```

   只增改 `mcpServers.requirement-mcp`，其余内容原样保留；写完继续执行原命令。

要 token 时对用户说：

> 需要需求系统的访问 token 才能拉取需求单。
> 请到 https://wisedevops.huawei.com/app/toolhub/tokenManagement 申请，
> 申请后把 token 直接发给我，我来配置，配一次以后都不用再配。

---

## 初始化

- **输入**：AR 单号 + `<mcp-token>`（见「需求系统 Token」章节）
- **操作概要**：两步——**① 取材，② 建工作区骨架**
- **输出**：

  | 目录 | 文件 | 来自 |
  |------|------|------|
  | `doc/features/<AR>/RR/` | `prd.md` + `detail.json` | ① 取到的正文；② 的占位件 |
  | `doc/features/<AR>/SR/` | `design.md` + `detail.json` | 同上 |
  | `doc/features/<AR>/AR/` | `design.md` + `detail.json` | ① 取到的正文；② 的空骨架 |
  | `doc/features/<AR>/inbox/` | `README.md`（上游材料收件箱，见「导入上游材料」章） | ② |

```bash
# ① 取材——stdout 单行 JSON {"mode":"init",...,"success":true}
node doc/extensions/skills/story/scripts/story.js init <AR> <mcp-token>

# ② 建工作区骨架
python doc/extensions/skills/story/scripts/story_flow.py init --feature <AR>
```

**② 是骨架的唯一写入者**：缺什么补什么，已有的一律不动。它与 ① 的结果无关，
每次初始化都跑一次，重跑安全。

### 看骨架，判材料

`RR/prd.md`、`SR/design.md` 是正文还是占位件（占位件正文写着
「本文档未从需求系统拉取到」），据此分流：

| 情况 | 怎么走 |
|---|---|
| 都是正文 | 进 S2 |
| 有占位件 | 进 S2，把该类当作缺料：请用户把对应文档放进 `doc/features/<AR>/inbox/`，走导入 |
| 全是占位件，且 ① 报「查无此单」 | 停下问人，先确认单号 |

### 没有需求系统单据时（问题单 / 独立的原始需求文档）

需求不一定都有 AR 单号——可能只有一个问题单号、一份别人发来的需求文档。
**入口不变，仍是 `/story init <编号>`**：非 `AR` 开头的编号（DTS 号、工单号等）
**不碰需求系统**，跳过 ①，直接跑 ② 建骨架，然后进 S2。

占位件让「上游没拉到」这件事以**内容**表达，下游照常按源取材，
补料后由导入步骤覆盖它。

本地单**没有归档环节**：`/story archive` 依赖需求系统里的单据，没有单据就没有覆盖对象。
交付终点就是仓内的 `spec/spec.md` + `AR/story.md` + `AR/review.md` 三件，
执行到归档时直接告诉用户这一点，不必尝试。

**S2 之后两条分支完全同路**——本地单的材料全部走 inbox 导入，那本来就是为「需求系统缺料」
准备的通道，这里只是把它从补料升为主料。

骨架就绪后按下面这条**固定链条**走完四步，每步的定义在对应章节。
**`AR/design.md` 是什么内容都照走**——有内容是分析的预填输入，不是跳过分析的理由：

| 步 | 做什么 | 定义在 |
|---|---|---|
| **S1** | 拉取三套材料、建 `inbox/`——上面那两条命令已完成 | 本章 |
| **S2a** | **导入 + 材料盘点**：列一次 `inbox/` → 有未导入材料先导入 → 写材料清单与一句缺口判断（**不做需求分析**）→ 记契约本轮 | 「导入上游材料」+「初析与流程契约」 |
| **S3a** | **第一级关卡**：材料够不够——补充材料 / 材料充足，开始需求分析 | 「材料与范围确认关卡」 |
| **S2b** | **需求分析**（材料确认后才做）：需求概览 → 本部件视角 → **本 AR 定位** → 待实现功能清单 → **范围定法选项集** → 落侧车、重跑 `round` | 「初析与流程契约」 |
| **S3b·c** | **第二三级关卡**：范围怎么定 → 承载哪份；范围一定就进 S4 | 「材料与范围确认关卡」 |
| **S4** | **收口**：按已定范围生成 `AR/design.md`，契约置 `complete`，自动进入 /spec | 「生成design.md」 |

链条里**没有「想起来才做」的步骤**：S2 的列 inbox 是**无条件**动作（一条 `ls`，空则过），
不依赖你判断「这个需求是不是那种该去翻收件箱的场景」——需求系统缺料时人工补录的正文
就躺在那儿，不列就等于整份 PRD 不存在。

**中断后不要凭记忆重建位置**：`story_flow.py status --feature <AR>` 读契约直接给出
`next`（下一步动作）与已走过的每一步，跟着它走即可。

**先做完对应产物，再问对应问题**：盘点完材料才问材料够不够，分析完范围才问范围怎么定
——人裁决的是**结果**不是预测。反过来，**材料没确认就别做需求分析**：材料一变，
分析全废，每轮补料都要重来。

---

## 归档

- **输入**：AR 单号 + `<mcp-token>`；前置是 `AR/story.md` 与 `AR/review.md` 两份齐备，缺哪份就回 /spec 补齐再来
- **不适用于本地单**（非 `AR` 开头、没有需求系统单据的，见「初始化」章）：归档是把正文覆盖到系统里的单据上，没有单据就没有覆盖对象。此时如实告诉用户交付终点是仓内三件，不要尝试执行
- **操作概要**：把这两份归档到需求系统——`AR/story.md` 作正文、`AR/review.md` 作附件
- **输出**：stdout 单行 JSON `{"mode":"archive","reqNo":"...","archived":true,"backupPath":"...","verified":true,"success":true}`

**archive 不修改工作区任何文件**，可以放心执行；归档到系统上的是哪一份、系统侧叫什么名字，由脚本负责。

**决策件状态**：`AR/review.md` 处于「草稿（待开发确认）」是**常态路径**——评审 ① 的形态就是
评审人在线上批注表态，归档正是送审动作。归档时**提示一句**「决策件为草稿态，评审人将在线上
表态」即可，**不停等确认**。

```bash
# ① 门禁：源哈希新鲜度、与 spec 的一致性、两份归档件的自包含红线
node doc/extensions/skills/story/scripts/merge-story.mjs --feature <AR> --check

# ② 上传
node doc/extensions/skills/story/scripts/story.js archive <AR> <mcp-token>

# ③ 登记归档态
python doc/extensions/skills/story/scripts/story_flow.py archived --feature <AR>
```

**③ 登记之后**，契约里的归档态告诉装配脚本本需求已送审：`AR/review.md` 自此
**归人所有——只备份，不重建**，评审人的线上批注与 `/story review` 拉回的回稿都留在里面。
③ 自带 ① 的门禁，通过才登记——登记不可逆，凭据只认校验过的产物。

完成后按 JSON 回执向用户复述（是否归档成功、备份位置），并告知可用 `/story restore` 回退覆盖。

---

## 恢复

- **输入**：AR 单号 + `<mcp-token>`；前置是有备份（archive 之后才有）
- **操作概要**：把需求系统上的正文恢复到上一版，回退 archive 那次覆盖
- **输出**：stdout 单行 JSON `{"mode":"restore","reqNo":"...","restored":true,"verified":true,"success":true}`

恢复的是**需求系统上的正文**，本地工作区不参与。

```bash
node doc/extensions/skills/story/scripts/story.js restore <AR> <mcp-token>
```

---

## 检视

`/story review <AR>` 把评审人在系统上留下的反馈拉回来，**写入 `AR/review.md`**（先备份原件）。

评审表态由评审人填写——**你不代填表态、不改状态行**。人可能在系统上批注，
也可能直接改本地 `AR/review.md`：**流程不关心来源，模型的输入唯一就是 `AR/review.md`**。
所以人已经在本地改好时不必跑 `review`，直接进处置。

- **规则**：[rules/review_reflow.md](rules/review_reflow.md)——逐项处置、台账结构、
  correction 闭环、归档后的边界与已知限制，处置前完整读一遍
- **产物**：`AR/review-disposition.json`（处置留痕）+ 被修订的 `spec/spec.md`
- **不动的**：`AR/story.md` 与归档件——story 定稿于评审时点，不重建、不重新归档

---

## 导入上游材料

**在链条里的位置**：**S2 的第一个动作**（无条件执行），以及 S3 关卡上用户选
「补充材料后继续」之后的重入口。

**做什么**：列 `doc/features/<AR>/inbox/`——除 `README.md` 外没有未导入文件，本步即完成，
直接去初析；**有文件就先读 [rules/inbox_import.md](rules/inbox_import.md)**，按它导入完再去。

收件箱存在的原因：需求系统里 PRD / SE 设计有时没归档，人工拿到的文档与界面设计图
需要一个确定的落点。材料放 `doc/features/<AR>/inbox/`
（**告知用户这个路径，不要求他记**）。

动作序列（判据、四类落点、格式策略、界面图登记规则都在
[rules/inbox_import.md](rules/inbox_import.md)）：

1. **归类**每份材料到 `RR` / `SR` / `AR` / `UX`——按内容主体归，不按文件名像什么归；
2. 判断结果写 `doc/features/<AR>/inbox/.classify.json`，
   再跑 `python doc/extensions/skills/story/scripts/import_sources.py --feature <AR>`
   （**结构化数据走文件、参数只放标量**：JSON 过 shell 会被不同宿主吞掉引号）；
3. 判为**界面设计图**的当场登记到 `ux-reference/`——登记是可逆的复制，
   判错了在关卡上撤销，比漏了再补便宜；
4. 导入结果随初析摘要在 S3 关卡**一屏带出**（「本批导入：X.docx→RR、首页.png→UX…」）
   ——归类错了用户会当场指出，重导即可。

脚本物化不了的格式（如 pdf）：**你读得懂就自己转写成 `.md` 放回收件箱**——
那点成本在你这边，不该推给用户去装工具。

---

## 初析与流程契约

**在链条里的位置**：**S2 的第二个动作**（导入完成后立即执行）。读两类输入——

- **本需求的材料**：四源现状（`RR/prd.md` + `SR/design.md` + `AR/design.md` 现状 +
  `AR/upstream.md`，存在即读）。逐轮可变，`round` 按它们的哈希判定轮次；
- **工程级事实**：[knowledge/component-profile.md](../../knowledge/component-profile.md)
  ——「本部件是谁、承担什么、与谁交互」的唯一定义来源，第 ② 节据它核对。
  跨需求恒定，不参与轮次哈希。

产出两个文件：

| 产物 | 是什么 |
|---|---|
| `AR/init-analysis.md` | 决策支撑件（**非**交付件）。**分两段写**：S2a 先出材料清单与缺口判断，材料确认后 S2b 再补需求概览 / 本部件视角 / **本 AR 定位** / 待实现功能清单 / **范围定法选项集** |
| `AR/story-flow.json` | 流程契约 = **本流程的状态机**。由 [scripts/story_flow.py](scripts/story_flow.py) 唯一写入，你只传它无从得知的那部分 |

**规则**：[rules/init_analysis.md](rules/init_analysis.md)，生成前完整读一遍
——五节各写什么、三源怎么定位本 AR 范围、选项集的形态、契约命令与三个侧车的格式都在那里。

两条在这里就要知道的：

- **本 AR 定位（第 ③ 节）是整条范围链的起点**。不先把「本 AR 当前范围 = ______」
  定下来，后面的信号核对就没有施加对象，只能默默按上游全量判；
- **拿不准走到哪就跑 `story_flow.py status --feature <AR>`**，看 `next` 与 `action`
  ——位置由契约回答，不靠回忆重建。

---

## 材料与范围确认关卡

**在链条里的位置**：**S3**。未授权时这是 init→/spec 之间唯一的停等；用户已表示不必逐个问他时
（判据见「交互关卡语义」）按推荐项决策继续，不等回话。

**三级，每级只问一件事**：

| 级 | 问什么 | 选项 | 选项来源 |
|---|---|---|---|
| 一 | 材料够不够 | `1=补充材料后继续` / `2=材料充足，开始需求分析` | `.gate-options.json` 侧车 |
| 二 | 这个范围怎么定 | `1=按当前范围整体承载` / `2..n=` 分析给出的各具名切法 | **契约 `scope_options`** |
| 三 | 本 AR 承载哪份 | 按选定维度的份表逐份列出 | **脚本从份表生成** |

第一级选 1 就回 S2a（导入 → 重新盘点 → round+1）→ 回第一级，循环封闭；
选 2 则先做 S2b 需求分析，再进第二级。
**终止条件是「范围已定」**：第二级选整体承载，或第三级完成定案，都直接进 S4。

**规则**：[rules/scope_gate.md](rules/scope_gate.md)，进关卡前完整读一遍
——每级呈现什么、推荐项怎么定、份表侧车格式、已授权时怎么走都在那里。

两条在这里就要知道的：

- **第一级先告诉人手上有什么**：材料清单四列（源 / 来源 / 是什么 / 状态），
  只列实际存在的输入源；推荐补料还是推荐开始分析，由缺口判断决定；
- **第二三级的选项来自分析，不在关卡现编**——分析定几项，关卡就只能摆几项（脚本从契约取）。
  想要分析里没有的切法，回 S2b 重做分析；
- **选项集恒定照出、恒定入契约**，不因「看着不用切」而省略，也不因已获授权而省略
  ——人无从推翻一个从未被摆出来的选项；
- **确认组件可用时用组件**（AskUserQuestion），同轮附 portable 编号菜单。

---

## 生成design.md

**在链条里的位置**：**S4 收口**。触发条件只有两个——S3 关卡上范围已定（第二级选整体承载，
或第三级完成定案）后自动进入，或用户明确要求重新生成。

- **输入（四源，存在即读、彼此平权）**：`RR/prd.md` + `SR/design.md` + `AR/design.md` 现状
  （需求系统可能已预填）+ `AR/upstream.md`（人工补录的本部件材料）。
  **不直接读 `inbox/`**——收件箱里的材料在 S2 已汇入这四源（不变量：某类目标文件全文 =
  该类 inbox 材料的转换结果），再当一源读就是同一事实两个落点
- **规则**：[rules/ar_design_init.md](rules/ar_design_init.md)，生成前完整阅读其四段内容——①两把裁剪标尺（指向 [knowledge/component-profile.md](../../knowledge/component-profile.md)，须一并读完）②提取原则 ③生成规则（需求提取五段结构、上游信息类别清单）④不做的事
- **范围**：契约 `split.decided === "split"` 时按 `scope_text` 裁剪，并把该文字逐字写入
  §1.2「本 AR 范围与拆分说明」；未切分时按契约 `positioning` 写（同 SR 有其它 AR 时
  **不能**只写「本 AR 承载全部需求」——那句话在有兄弟 AR 时是假的。三种形态见
  [rules/ar_design_init.md](rules/ar_design_init.md) §1.2）
- **产物**：`doc/features/<AR>/AR/design.md`——**范围已定，一次成型**，不是待推翻的草稿

生成后跑 `story_flow.py complete --feature <AR>` 收口（脚本盖时间戳并置 `status=complete`）。

**先出收口报告，它同时充当决策复述**（四项缺一不可，缺了就得另起一轮停等）：

1. **已定范围**——S3 定下的 `scope_text` 逐字复述；
2. **承载决定**——本 AR 承载哪份、兄弟 AR 承载什么（未切分时写 `positioning` 的结论）；
3. **契约留痕位置**——`AR/story-flow.json` 的收口时间戳与各关卡 `basis`；
4. **/spec 输入清单**——`AR/design.md`（主输入）+ `RR/prd.md`（业务场景与验收意图）+
   `SR/design.md`（跨部件交互、云侧接口、系统级存储，须按上游索引直读原文）+
   `AR/upstream.md` 与 `ux-reference/`（存在时）。

报告末尾按复述惯例收一句「若需修改请直接说明，否则按上述决策继续」，**不设选项、不等回话**。

**然后直接进入 spec 阶段**：读 [framework/skills/feature/spec/SKILL.md](../../../../framework/skills/feature/spec/SKILL.md)
并从它的 Step 1 开始执行，**不再询问**。

> **为什么不在这里停等**：范围已经由人在 S3 定下，进 spec 没有分支可选，
> 而收口报告本身就是最后一轮纠错窗口。进入之后 spec 自身的确认点
> （术语映射逐行 `[x]`、`spec.freeze` 等）照常生效。

---

## 交互关卡语义（所有关卡统一适用）

**关卡是讨论的收敛点,不是选择题的交卷处。** 决策权在人、笔在 AI——
AI 依据人的决定写回文件，不要求用户手动编辑文件或运行脚本。

**呈现**：摆出分析结论与可选方案，每项写清它意味着什么。
有确认组件就用组件，没有就输出 portable 编号菜单（`1=… / 2=…`）——按宿主**能力**判断，
同一轮消息内给全。选项标签要自带执行前提：**选中它的那一刻脚本会去校验的动作，
必须写进标签**（材料关卡写「我已把材料放进 `<完整路径>`」，不写「补充材料后继续」——
后者读起来像「我打算去补」，而脚本当场就要检查目录）。
选项集只有一项时照实说，并给出口，见 [rules/scope_gate.md](rules/scope_gate.md)。

**人回应之后**，只有两条路：

- **回应对上了某一项** → 跑 `story_flow.py decide` 落契约（`basis` 引他的原话），
  按 `status` 的 `next` 继续。`rejected`（退出码 2）是「记下了但不能按它走」
  （如选了补料却没放料）：按脚本给的补救动作**原地重提同一个关卡**，不前进、不换题；
- **回应给出新诉求**（另一种切法、另一个范围、条目增减）→ **这是讨论的开始，
  不是待映射的答案**。去做分析、把方案摆出来跟他讨论清楚，收敛了再记录。
  范围与拆分的讨论怎么做，见 [rules/scope_gate.md](rules/scope_gate.md)。

**三条底线**：

1. **人确认前不记录、不往下走。** `by: human` 记的必须是他确认过的内容——
   你需要写一段推理才能把他的话对上某个选项，那说明还没确认，去问；
2. **他已经确认过的事不再问第二遍。** 记录完照 `next` 直接做，
   再问一次不是保护决策权，是把做完的决定推回去一次；
3. **用户明说「按推荐走、别逐个问」**就照办，但 `scope_decision` / `split_carrier`
   **代选永远不选拆分**——拆分改变的是交付边界（本单做多少、其余留给谁），
   那是对后续单据的承诺，只能由人拍板。他指明过拆分才拆（指明本身就是定案）；
   只说「别问我」就是不拆；SR 清单里上游已经切好的不算你代做。

**代替人做的选择，报告一个字不少**：采用了哪一项、依据是什么。
选项集无论人选还是代选都要落进契约——**它是给人事后推翻用的**，
少停一次不该等于少一份留痕。

## 产物定位

**职责模型**：

| 产物 | 回答什么 |
|---|---|
| `RR/prd.md` | 业务上为什么做、要什么价值（外部输入） |
| `SR/design.md` | 整体方案、三方分工、系统级约定（外部输入） |
| `AR/upstream.md` | 人工补录的本部件上游材料（需求系统未归档时的补位，外部输入） |
| `ux-reference/` | 界面参考图与设计基准（外部输入，进视觉链路） |
| `AR/init-analysis.md` | 关卡决策的支撑分析（**非交付件**：/spec 不读、归档不含、生成 design.md 不以它为源） |
| `AR/story-flow.json` | init→spec 的流程契约：每轮的输入、导入与决策（谁、何时、依据）；spec 阶段 post_check 校验其收口 |
| `AR/design.md` | 上游要**本部件（本 AR 范围内）**做什么（承载全局方案与部件分工、本 AR 范围与拆分说明） |
| `spec/spec.md` | 本部件**要做什么**（需求侧规格，意图 SSOT） |
| `review.md` | 上线要定什么、评审看过什么、评审定了什么（**人的决策**，AI 不得覆盖） |
| `acceptance.yaml` | 怎么算做对了 |
| `AR/story.md` | 把上述组织成可评审的形态（派生物，零新事实） |

spec 与 review 是 spec 阶段**并列**交付物，不是上下游——前者 AI 写、后者人写。

| | `AR/design.md` | `AR/story.md` |
|---|---|---|
| 流程角色 | 输入端：/spec 的输入（AI 从四源提取，按本 AR 范围裁剪） | 输出端：spec 阶段由 AI 按章节合同逐章装配的评审载体（单一线性文档，面向人） |
| 归档语义 | 工作区里身份唯一：「上游提取件」，不承载归档产物 | archive 的上传正文（与 `AR/review.md` 一并上传） |

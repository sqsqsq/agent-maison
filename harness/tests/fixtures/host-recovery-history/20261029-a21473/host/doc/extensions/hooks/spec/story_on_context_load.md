## 钱包实例扩展：spec 阶段 story 专属注入

> 本文件**只在 story 场景注入**（由同目录 `story_on_context_load.mjs` 按
> `AR/story-flow.json` 是否存在判定）。未走 `/story` 的 feature 读不到本文，
> 其 spec 阶段行为与本扩展不存在时一致。

**上游输入必读清单**：spec 正文生成前，必须读取以下文件（存在时），并在 `spec/context-exploration.md` 的 `key_inputs_read` 中记录：

1. `doc/features/<feature>/AR/design.md` — 开发需求文档（/spec 主输入；其「相关文档链接」表与「上游索引」章节是回查 SR/RR 的定位索引；「本 AR 范围与拆分说明」界定本次要做的边界）

   **本 AR 范围与拆分说明是 Scope 与功能清单的边界依据**：该节含拆分表时，表里归**兄弟 AR
   或「待立项」**的那几份**不属于本次**——它们的功能不进本 AR 的功能清单，也不进验收标准；
   这些内容涉及的模块若需登记 `out_of_scope_modules`，`rationale` 写明「归属 ARxxxx」而不是
   「本需求不做」（两者对评审者是不同的信息：前者有人接，后者没有）。
   该节按流程契约的 `positioning` 与 `split` 判，**三形态见
   [`rules/ar_design_init.md`](../../skills/story/rules/ar_design_init.md) §3（模板 1.2 三形态）**——
   「无拆分」不等于「本 AR 承载全部」：同 SR 有兄弟 AR 时后者是假的。
2. `doc/features/<feature>/RR/prd.md` — 产品 PRD（业务场景全景与验收意图）
3. `doc/features/<feature>/SR/design.md` — SE 系统级设计（跨部件交互、云侧接口定义、系统级存储方案——§9 技术契约的取证源）

---

## 本阶段产出三份文档（BLOCKER）

spec 阶段是**一次 pass 产出三份文档**，作者与读者各不相同。三份在同一次撰写中完成，事实同源，不得只交 spec.md 就宣告闭环：

| 顺序 | 产物 | 作者 | 持有什么 | 读者 |
|---|---|---|---|---|
| ① | `doc/features/<feature>/spec/spec.md` | AI | **代码要求** | AI 编码 / 出用例 / 门禁 |
| ② | `doc/features/<feature>/AR/review.md` | AI 起草 + **人确认** | 自然语言问题、当前建议和可填写的审核结果 | 评审者 |
| ③ | `doc/features/<feature>/AR/story.md` | AI | 完整需求叙事 + 判断 + 合规回显 | 评审者（**归档件·叙事主件**） |

- ② **由 `AR/story-src/decisions.json` 渲染而来**，不手写：AI 只负责把开放点收齐并登记（自然语言问题、
  当前建议、依据、影响、来源、责任人），议题块与“同意当前建议 / 有其他意见，需要修改 / 暂缓”表态位由
  `story-build.mjs build` 生成，由评审人勾选并填写。末尾状态行保持「**状态**：草稿（待开发确认）」，
  等开发本人确认——**不得代填「已确认」**。状态标「已确认」而问题没有审核结果即 BLOCKER。
- ③ **逐章成文，不整篇重写**：先 `story-build.mjs scaffold` 按章节合同为
  `AR/story-src/chapters/` 各章生成写作任务书（取材路标 + 必答 + 判据）；
  **按路标去 PRD/SE/spec 取事实来写**，一次写一章；开放点先登记到
  `AR/story-src/decisions.json` 再在正文写 `{{DEC-00X}}` 引用；编号含义登记到 `ids.json`。
  撰写红线见 [`rules/rules.md`](../../skills/story/rules/rules.md)（每条标注了执行通道）。
- ③ 写完后执行装配与校验（AI 自跑，不得让用户手动跑）：

  ```
  node doc/extensions/skills/story/scripts/story-build.mjs scaffold --feature <feature>
  node doc/extensions/skills/story/scripts/story-build.mjs build    --feature <feature>
  node doc/extensions/skills/story/scripts/story-build.mjs check    --feature <feature>
  node doc/extensions/skills/story/scripts/merge-story.mjs --feature <feature> --check
  ```

  `build` 同时装配 story 并渲染/追加 review 的议题（已填写内容不会被覆盖）。
  `AR/story.md` 是装配产物，**不要直接编辑**——改内容就改章节文件再 build。

**story 不是 spec 的排版件**：spec 的可标识事实、PRD 的业务语境、SE 的全局方案以及无编号的数据和交付事实都必须在 story 有完整落点。story 可以整合、改序和改写，但不可以只保留编号、删掉上下文或把全局方案缩成一段摘要；它还要补足判断、权衡、风险与合规回显。

---

## spec 宿主扩展章节：§9 技术契约（BLOCKER）

core spec 模板缺少交付流程要求 spec 承载的接口契约 / 存储 / 配置 / 埋点 / 依赖。因此 spec 生成时必须在 **§8 验收标准之后追加一章**，模板见 [`templates/spec-sections.md`](../../skills/story/templates/spec-sections.md)：

| 章 | 内容 |
|---|---|
| **§9 技术契约** | 9.1 端云接口 / 9.2 数据存储 / 9.3 配置项 / 9.4 埋点 / 9.5 依赖变更 |

**形式：一律表格，不按条目数切换**。原有 spec 不管几条都用表格（F1–F6 是表格，只有一条也会是表格）。每个小节要么是一张表（表头固定、每行一个编号实体、单元格 ≤30 字），要么是一行「不涉及：<现状扫描依据>」。**不写散文段、不写嵌套 bullet、不建空表**，小节不得删。

**防重复**：写之前先查 spec 已有章节，同一件事只写一处——加密/脱敏/调用方校验归 **§7.3**（§9 不重复）；谁先上线、阻塞谁归 **《决策与评审记录》的上线时序**（§9 不重复）；性能阈值归 **§7.1**；管理台排期/打点归档/翻译回稿归 **《决策与评审记录》的跨团队协同**，core 模板的「宿主扩展治理项」章**只写一句索引**，不重复列举。

生成前必须先读**两份**——它们是「方法 + 数据」的一对，缺任一都写不出可信的现状列：

| 读什么 | 给你什么 |
|---|---|
| [`reference/evidence-rules.md`](../../skills/story/reference/evidence-rules.md) | **怎么判**：各节取证规则、结论写法、取不到时的降级 |
| [`knowledge/codebase-facts.md`](../../knowledge/codebase-facts.md) | **这个工程的现状**：各能力面有没有、长什么样、怎么认出来。已登记的直接用；未覆盖或存疑按 evidence-rules §2 实扫并回灌 |

**代码库现状**（仓内文件路径、检索零命中结论）是结论的组成部分，作为表格的一列写进正文——它是核心公式「事实 = 变更意图 × 代码库现状」的另一半。**别拿平台常识替代它**：某个 API 在别的工程常见不等于本工程在用；facts 里写着「未使用」的介质，不要选进新设计。

---

## 合规判定的另两个出口（BLOCKER）

出口 ① 与判定方法见共享注入件（`hooks/constraint-application.md`）与
[`reference/constraint-usage.md`](../../skills/story/reference/constraint-usage.md)。本节只补 story 场景独有的两个出口：

2. **需要人工选择的事项 → 登记 `AR/review.md` 的自然语言问题，卡点排最前**：每项写当前建议、依据、影响、来源和责任人，并留出“同意当前建议 / 有其他意见，需要修改 / 暂缓”的审核结果。问题按人要讨论的内容命名，不按规格、合规或上线等内部分类命名。
3. **命中 / 不涉及的结论 → 叙事件的「影响面与合规」章**（兼容性自检表 + 应用域约束符合性表）。**spec 不写这两张表**——它们零条代码要求，纯粹是给评审者的完备性回显。

两张回显表的写法纪律、各域的特殊承载方式，见 [`reference/constraint-usage.md`](../../skills/story/reference/constraint-usage.md)（verifier `spec_constraint_echo` 按其判定——这些是判断，脚本判不了）。

---

**数值来源在 story 侧形态不同**：story 有决策件，可议的值该进那里让人表态，而不是在正文挂个括注。
两侧的完整形态见 [`reference/evidence-rules.md`](../../skills/story/reference/evidence-rules.md) §3.2 证据表（那是形态的唯一真源）。把 spec 的写法照搬进 story 会被装配器的数值溯源守恒拦下。

---

**spec 闭环后的下一步提示（强制）**：spec 阶段闭环汇报时，下一步选项**必须以「人工评审 → 归档」为首选链路**：`AR/review.md` 是首版草稿，请开发按其中议题逐条审核并填写表态与确认信息（状态行保持「草稿（待开发确认）」直到人工完成）→ `/story archive` 归档。AI 不代填表态、不改状态行。「进入 plan」只能作为其后的选项列出，并注明「建议先完成评审与归档」；不得只给出 plan/暂停两项而遗漏本链路。

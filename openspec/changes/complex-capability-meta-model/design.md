# Design: Complex Capability Meta-Model

## 决策清单

### D1 校验挂载点：并入既有扫描器，不另立入口

新增 `checkParentGoalDeclarations()`（或等价函数）由 `check-plan-version.mjs` 的
`checkPlanVersions()` 同一遍历串联：同享 plan 加载、同享 `{file, reason}` 诊断通道、
同享 default/release 双模式与 `release:check-plans-test` 测试通道。不另立 script、
不另立 npm 入口——一个登记面一个门。

### D2 字段解析：手写受限解析，零新依赖

`plan-version-lib.mjs` 现为手写正则（scalar + todos 块）。父目标声明新增三种受限形态，
够用即止、不引入 yaml 依赖：

- 数组字段（`advances`/`goal_requires`/`goal_provides`）：支持行内空数组 `key: []` 与
  非空 block-list `^key:\r?\n(\s+- .+)+`（一层字符串列表）——实测 e4/b9/b8 用行内 `[]`、
  c2/总计划用 block-list，两种都必须解析；
- 折叠/字面块（`real_host_validation: >` / `|`）：读取后续缩进正文判空，块符号本身
  不算内容；
- 只解析 frontmatter：正文提及 `parent_goal` 字样不构成声明（android plan 正文即反例）。

所有正则用 `\r?\n`（EOL 教训，plan b6d3f7a1）。

### D3 advances 合法集：只认 §0.1 表格首列，不建第二注册表

- `parent_goal` 定位：扫 `.cursor/goals/*.goal.md` 的 frontmatter `id:`，MUST **唯一**
  匹配——零份或多份均 FAIL；
- 合法目标 id 集：仅从该 goal 文件 §0.1 目标表的**表格行首列**提取反引号 id（行形态
  `| \`gN-…\` | …`）；MUST NOT 扫描全文——正文其它章节偶现的反引号 id（如 §12 模板
  示例）不得进入合法集；goal 文件保持唯一 SSOT；
- **fail-closed**：goal 定位失败、多匹配、表格提取为零，一律报错，不静默放过。

### D4 枚举与语义的 SSOT 分工

`relation` ∈ {knowledge-provider, app-asset-provider, verification-provider,
execution-trust-foundation, core}；`layer` ∈ {knowledge, capability-handoff,
component-blueprint, change-unit, closure, governance}。枚举常量放 lib（实现），
行为语义以本 change 的 spec 为 SSOT——总纲 §12 修改枚举时，spec 与 lib 同步走 change。

### D5 `parallel_authority_added: true` → FAIL（已裁决 08-13）

总纲 §15 明确不新建并行运行权威。声明 `true` 直接校验失败，诊断指向"需先修订总纲并
更新本 spec 才可放开"。告警会被忽略，这个字段存在的意义就是拦截。

### D6 部分声明 = 非法，八字段全必填（已裁决 08-13，无例外）

声明了 `parent_goal` 但缺任一其余字段（advances/relation/layer/goal_requires/
goal_provides/real_host_validation/parallel_authority_added）→ 按字段级诊断报错。
**不做静默半校验**：半声明通常是漏写，放过等于门禁形同虚设。`goal_requires`/
`goal_provides` 同为必填——总纲 §12 模板与 AGENTS.md"必填字段齐全"口径一致，
空值必须显式写 `[]`，缺省即缺失。

### D7 goal_requires/goal_provides：仅格式校验

必须显式存在：行内 `[]` 或非空 block-list；条目匹配
`^[a-z0-9]+(?:[.-][a-z0-9]+)*$`（允许版本点号——总计划实测已有
`stable-3.0.0-release-baseline`）。**不建注册表、不对账 requires↔provides 闭合、
不生成依赖图、不参与调度**——总计划 §6.1 声明语义澄清原文。

### D8 校验时机：在 future/allowlist 提前返回之前

扫描器对 future plan 在 `cmp > 0` 分支直接 `continue`（check-plan-version.mjs:95-103）。
父目标校验若接在其后，任何未来窗口声明都会假绿。因此校验 MUST 位于 future/allowlist
提前返回之前，并以合成的未来窗口非法声明专项用例锁死（default/release 双模式 FAIL）；
不得依赖当前仓恰好存在多少份 future 声明 plan。

## 非目标

- 不校验 CU/蓝图文件（尚不存在，P1/P2 的活）；
- 不做 advances 计数或任何进度聚合；
- 不进 harness、不影响消费者发布件；
- 不迁移存量 plan（未声明零行为是硬承诺）。

### D9 接缝语义：normative 契约，零代码增量

R7–R9（接缝三分、provider 生命周期、命名空间分离）是总纲 §11.2 的 change 化，属 normative
契约：P0 代码面不变（仍只有扫描器），enforcement 随 P1–P3 各自 change 落地回填；机械断言
（移除/替换/冲突/退出五项）由总计划 M5 在 framework 终验层承载。现有 P1–P3 规划实现按
"静态内置 provider"解释，不因本增量新增 loader、注册表、插件包或动态发现。

## 裁决记录（08-13 评审）

- **A**：`parallel_authority_added: true` → 直接 FAIL（批准）；
- **B**：部分声明 → 直接 FAIL，且**无例外**——`goal_requires`/`goal_provides` 必填，
  空值显式 `[]`（批准并收紧）；
- 声明位置唯一化：机器声明必须在 frontmatter，正文只解释不替代——总纲 §12 与
  AGENTS.md 已同步修订，现存 6 份声明本就在 frontmatter，零迁移成本。

## 裁决记录（08-14 provider-seam 增量）

- 源自 DeepSeek Harness / Cordis 时空可组合性研究的上位裁决：总纲新增 §11.2（集中式，
  G1/G2 各一句点名），本 change 增 R7–R9，零代码增量（D9）；
- G8 降格：provider 缺失/替换/退出/冲突的机械演练归 M5 fixture；真实宿主只记录自然
  发生的事件，未发生不阻塞完成声明；
- 宿主 App 架构为蓝图**待裁决**问题：验证口径平台中立（模块边界/显式依赖/可替换实现/
  禁用降级/产物兼容），不预定 HAR/HSP 等具体形态；
- Cordis 先例核实：重复 provider 注册硬失败（vendor/cordis/src/reflect.ts `service
  "..." has been registered`）、effect disposer 逆序回收、provider 消失触发 consumer
  失活重载——fail-closed 与四类退出行为有真实系统背书。

## 裁决记录（08-14b 宿主演进接缝增量）

- 用户上位洞察：宿主可插拔性不应只是 H1A 的一个待裁决问题，而应是 **Maison 蓝图机制
  可稳定产出的架构质量**——"Maison 产出的代码比裸 AI 更可扩展可靠"是核心竞争力；
- 两层接缝正式分离：§11.2 Maison capability seam / §11.3 host evolution seam，永不
  合并；宿主接缝不进 Maison 命名空间与注册面（R10）；
- 能力链定式：AI 提候选变化轴，人裁决取舍，Maison 落实（纵切 CU）并证明（契约/替换/
  降级/绕过四验证）；无门槛证据默认直接实现，防"插件地狱"；
- 零增量重新限定：Maison 自身零插件运行时；宿主演进接缝是 P1–P3 既有交付物的内容
  扩展，属首期真实范围，不按零增量豁免；
- G3–G7 目标行各加一短语引用 §11.3（产出责任变化，适用 G2 例外规则）；
- 记账三来源为天然变化轴候选，宿主批次自然验证，不预定实现形态；借款/保单导入通道
  若经真实材料证实为同型多来源，再作复用案例（不预写仓内无来源的事实）。

## 裁决记录（08-14c 窄返修五项）

- **完成契约补齐**：新责任进 Goal §14 完成定义与 §16（新增第四问），总计划 m2–m4 todo、
  P1–P3 完成判据、§13 完成定义各补一条——堵"正文很强、完成契约可合法跳过"的假绿结构；
- **CU 粒度修正**：获批接缝首次落地＝一个纵切 CU，后续 Provider 各自独立成单元
  （手动记账先立最小接缝、自动/闪控球随后扩展），小批次原则保留；
- **缺失/替换语义收紧**：缺失或失败＝蓝图显式四选一裁决（降级｜禁用｜阻塞｜fail-closed），
  不得静默成功；"（或变更可解释）"逃生口删除——契约或 Consumer 必须变化即触发蓝图调和/
  契约版本化/迁移裁决，不作替换混入；
- **实质候选定义**：有可追溯变化证据＋实质影响才进决策卡，普通实现差异不逐项登记；
  门槛是必要条件非自动建缝；
- **证据口径**：借款/保单四通道条件化（仓内无可追溯来源，待真实材料证实）。

## 裁决记录（08-14d 实质候选口径统一，t1b 收口）

- G4 收紧为"每个**实质候选**变化轴"；
- P1 零候选语义：存在实质候选逐一成卡；不存在时以可追溯的"无实质候选"结论完成，
  不得强造决策卡；
- R10 反例改为"进入决策卡前驳回"：无门槛证据的 AI 候选不进卡、不记再提取条件；
- "再提取条件"作用域澄清：仅适用于已具备实质证据、进入评审后被人裁决暂不建缝的候选。

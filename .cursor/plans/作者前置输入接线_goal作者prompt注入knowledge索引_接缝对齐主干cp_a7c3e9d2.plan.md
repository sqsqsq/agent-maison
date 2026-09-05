---
name: 作者前置输入接线 — goal 作者 prompt 注入 extension knowledge 索引 / 文档纠偏 / 接缝对齐主干以便 cp
version: 3.0.0
# 窗口说明：Br_release_3.0.0 长期线（宿主体验优化），与 main 的 3.1.0 蓝图刻意不同号。集成方式是分轮 cherry-pick
# 回灌主干（用户 2026-09-05 确认；记忆 branch-integration-strategy），所以本 plan 的每一处改动都要回答"cp 到主干时冲突怎么解"。
# 触发事件：消费仓 2026-09-05 反馈《把 on_context_load 接到作者一侧》（D:\97.log\问题反馈\09-05\framework-proposal-author-context.md）。
# 已核实的事实（Claude 2026-09-05 逐条对照本仓与 origin/main 6afa2a35）：
#   ① on_context_load 全仓唯一触发点 harness-runner.ts:1148，夹在 pre_verifier / post_verifier 之间；片段只进
#      report-generator.ts:355 的 verifier ai-prompt 尾部与 verifier-material 的 lifecycle_sha256，且只在脚本 verdict=PASS
#      且 verifier 启用时才装配——脚本 FAIL 时片段谁也看不到。作者动笔前拿不到，只能从门禁报错反推。
#   ② 本仓文档把 hooks/<phase>/on_context_load.md 宣传为与 knowledge、phase_rules_overlays 并列的"宿主叠加指令"
#      （spec SKILL.md:22、phase-terminology.md:31、四份 profile 模板、lifecycle schema），这是误导来源。
#   ③ 反馈方的留痕方案借 context_exploration_inputs_coverage，但 3.0.0 的 Context Facts Gate 只在建立阶段（spec/change）
#      跑一次输入覆盖，plan/coding 只校验 phase_delta（context-facts.ts:56）——恰是反馈里零命中的两个阶段，留痕不成立。
#   ④ 主干 3.1.0 已用 manifest 1.1 的 phase_bindings.before_phase_work + knowledge audience 回答同一需求，并把 hooks
#      定性为"harness run 的 8 个内部事件，fragment 下一轮可见"（skills/project/extension/SKILL.md）。反馈方案会造出第二套
#      作者通道，且删 verifier 侧调用会让主干的 hooks 描述变假——方向撞车，不采纳其机制。
#   ⑤ goal 模式的 buildPhasePrompt（goal-phase-runtime.ts:3366）是框架内唯一"作者动笔前"的组 prompt 点，两条线逐字节一致、
#      自引入后无人再碰；ut 专用块上方注释自陈"通用注入属 d8f4b7e2 范围，落地后本块退役"，d8f4b7e2 在主干落为 extension 1.1，
#      但通用注入没落（origin/main goal-phase-runtime.ts:3474 同注释仍在）。
#   ⑥ 3.0.0 的 manifest 1.0 只校验 knowledge 路径存在，不向任何 prompt 注入（extension-loader.ts:153-172）；两边
#      loadResolvedProfile 都经 applyInstanceExtensions 挂上 extensionBundle（profile-loader.ts:231）。
# codex review（2026-09-05）四条收窄全部采纳：索引旁必须有读取指令；解析错误不能静默变空；cp 后 1.0 宿主会失去提示、须写清
# 迁移退出条件；测试要覆盖 manifest→作者实收 prompt 的真实接线。范围限定为静态作者要求的前置指引，不做三层 .mjs 的作者侧执行。
# 原则来源：docs/overview.md §1.2.1 效率优先 / 简单优先；记忆 design-principle-efficiency-first。不做 A/B，靠宿主实跑迭代。
# v2（2026-09-05，codex review 三处 P2 + 两处勘误，方向不变）：① 错误判断先于"无 manifest"——主干 loader 在
#   paths.extension_dir 非法时返回 manifestPath: null 且带 errors（已复现），原顺序会静默漏报；② 送达测试改为在注入的
#   invoke 回调内断言调用发生且 prompt 内容含路径与指令，只查落盘 prompt.md 不够（写盘后仍可能在能力检查处停下未调作者）；
#   ③ 整批收口按 AGENTS.md 开发验收改成 `cd harness && npm test`（含 fixtures）；勘误：cp→main 计数限定源码/测试注释行；
#   放弃表 D4 行"与主干 1.0 语义一致"改"分支临时语义"。
overview: >
  作者在动笔前拿不到宿主扩展写的"本阶段写作要求"，是时序错位：唯一送达通道 on_context_load 接在 verifier 一侧。
  主干 3.1.0 已经用 manifest 1.1 的 before_phase_work 回答了这个需求，分支不能再造第二套；但分支上的宿主今天就在
  返工。本 plan 做三件事：（一）文档纠偏，让框架不再把 on_context_load 说成作者通道；（二）在 goal 模式作者 prompt
  里注入 extension knowledge 索引加一句明确的读取指令，接缝的文件路径、函数名、签名、输出标题全部对齐主干的
  extension-runtime.ts / formatExtensionPhasePrompt，cp 时该文件整份取主干版本、其余 hunk 干净；（三）交互模式在
  行为规约加一条"动笔前读 provides.knowledge"。不碰 hooks 语义、不删 harness-runner 那行、不内联正文、不加事件/状态/门禁。
  临时方案有明确退出条件：cp 后主干 formatter 对 1.0 返回空串，仍用 1.0 的宿主会失去提示，须改 1.1 声明；这不是无感接续，
  MIGRATION 写明。每处 cp 相关代码带 `cp→main:` 前缀注释，说明取谁的版本、先后顺序、哪条断言要改。
todos:
  - id: t0-docs-correction
    content: >-
      T0 文档纠偏（九处一句话 + device-testing 引用）。精确版给 specs/lifecycle-hooks-schema.yaml 的 on_context_load 事件描述（英文，对齐该文件）："Fired at the end of the harness check flow. Fragments are consumed only when the verifier ai-prompt is assembled (script verdict PASS and verifier enabled); they never enter the author's pre-write context."。短版（中文）给 skills/feature/spec/SKILL.md:22、docs/concepts/phase-terminology.md:31、profiles/{generic,hmos-app}/skills/{spec,plan}/templates/*-template.md 四份："宿主细则通过 `doc/extensions/knowledge/`（作者动笔前读；goal 模式下注入阶段 prompt）与 `phase_rules_overlays.<phase>`（harness 强制）叠加；`hooks/<phase>/on_context_load.md` 的片段只进 verifier 上下文，不会自动送达作者；仅声明 hook 不代表已送达。"；docs/evolution/extension-e2e-acceptance.md:27 的"应注入片段"改"应注入 verifier prompt 片段"。skills/feature/device-testing/SKILL.md 补 agent-behavioral-principles 引用（七个 feature skill 里唯一缺失）。不动 scripts/utf8-rename-spec-skill.mjs（一次性重命名脚本，死文本）。cp 提醒：主干 spec/SKILL.md 同句出现两次（:51 与 :515），cp 时两处同改。
    status: completed
  - id: t1-branch-formatter
    content: >-
      T1 分支兼容 formatter（独立一段，cp 时整份取主干）。新建 harness/scripts/utils/extension-runtime.ts，只导出与主干同名同签名的 `formatExtensionPhasePrompt(bundle: ExtensionBundle | undefined, phase: string, projectRoot: string): string`。分支体：`!bundle || bundle.errors.length > 0 || bundle.knowledgePaths.length === 0` → 空串；否则输出与主干同款标题：`## Instance extension inputs` / 空行 / `### Knowledge index` / 空行 / 每条 `- \`<相对项目根的 posix 路径>\``（1.0 字符串无 summary，不补）。`phase` 参数不用，只为对齐签名（注释说明）。不列 hooks、不跑 .mjs、不读文件正文。文件头注释（逐字）："// cp→main: 分支临时件（plan a7c3e9d2）。主干同路径已有 manifest 1.1 版：对 1.0 返回空串，对 1.1 渲染 knowledge / before_phase_work / mcp 三块。cp 时整份取主干版本，不合并本文件；仍用 1.0 的宿主会失去 goal 作者提示，须改 1.1 声明（MIGRATION.md 3.0.x 段）。"。单测见 T3。
    status: completed
  - id: t2-author-wiring-and-guidance
    content: >-
      T2 作者接线与读取指引。(a) goal-phase-runtime.ts 的 buildPhasePrompt 末尾加可选参数 `extensionInputs?: string`，在 `Skill absolute path:` 行之后、ut 专用块之前注入：`...(extensionInputs ? ['', "Before writing this phase's artifacts, read the instance extension inputs below that apply to this phase.", '', extensionInputs] : [])`；块前注释（逐字）："// cp→main: 本块保留——主干 buildPhasePrompt 尚无扩展注入，d8f4b7e2 自陈的"通用注入"由此落地；读取指令放这里不放 formatter，formatter 被主干替换后指令仍在。"。(b) 同文件新增导出的小函数 `extensionInputsForPhase(projectRoot: string, phase: string): string`：`loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot)).extensionBundle`，**判断顺序固定**：无 bundle → 空串；`errors.length > 0` → `console.warn('[goal-runner] ⚠ extension manifest 非法，作者前置输入未注入：<前三条 errors 的 code+message>；运行 harness-runner.ts --phase extensions 修复。')` 并返回空串；`manifestPath === null`（无 manifest / 无目录）→ 空串且不出声；否则返回 formatExtensionPhasePrompt(bundle, phase, projectRoot)。errors 必须先于 manifestPath 判断：主干 loader 在 `paths.extension_dir` 非法时返回 `manifestPath: null` 且带 errors，反过来判会在 cp 后静默漏报（codex 已复现）。不新增 goal 事件类型、状态、门禁。(c) 生产调用点（buildPhasePrompt 唯一一处，当前紧接 `phaseWriteBoundary ?? undefined,` 之后）追加实参 `extensionInputsForPhase(projectRoot, String(phase)),`，行前注释（逐字）："// cp→main: 先 cp 写边界批次（plan 1741b6f2）再 cp 本批，避免上一实参的上下文冲突；主干 loadResolvedProfile 同样挂 extensionBundle，此行无需改。"。import 放在 `import { loadResolvedProfile } from '../profile-loader';` 之后一行。(d) 交互模式指引：skills/reference/agent-behavioral-principles.md 原则 1 约束列表加第 8 条："**动笔前读宿主扩展的作者输入**：`<extension_dir>/manifest.yaml` 的 `provides.knowledge` 所列文件中适用于本阶段者，读后把路径写进 Code Facts；goal 模式下同一清单已注入阶段 prompt。"。六个 feature SKILL 已引用该规约（T0 补齐 device-testing 后为七个），不逐篇重复。
    status: completed
  - id: t3-tests
    content: >-
      T3 测试覆盖真实接线。新建 harness/tests/unit/goal-extension-author-inputs.unit.test.ts 并登记到 tests/run-unit.ts CORE_SUITES（id `goal-extension-author-inputs`）。三条：① formatter：假 1.0 bundle（knowledgePaths 两条）→ 含 `## Instance extension inputs`、`### Knowledge index`、两条相对路径；errors 非空 → 空串；undefined → 空串。② buildPhasePrompt：传字符串 → 出现在 `Skill absolute path` 行之后，且读取指令句在索引之前；不传 → 无 `Instance extension inputs` 字样。③ 送达接线（沿用 goal-canary-hard-cli-d7f3a9c4.unit.test.ts 的驱动模式）：setupMinimalHost('ext-author-inputs') 后写 doc/extensions/manifest.yaml（schema_version "1.0"、provides.knowledge: ['knowledge/spec-author.md']）与该文件并 commit；注入 __testing_setInvokeAgent / __testing_setRunHarnessPhase（exit 0）/ __testing_setValidateReceipt / __testing_setRepoLayout / __testing_setDeviceReadinessGate 同该测试；`--start spec --end spec --adapter cursor --foreground-ok --force` 跑 goalMain；**主断言在注入的 invoke 回调内**：记录调用发生且 phase=spec（从 opts.outputLogPath 的 `/phases/spec/` 取，同 canary 测试），在回调内定位 prompt 文件（plan.argv 中以 `prompt.md` 结尾的项，或 `path.join(path.dirname(outputLogPath), 'prompt.md')`）读出内容，断言含标题、`doc/extensions/knowledge/spec-author.md` 与读取指令句；只查落盘 prompt.md 不够——runtime :6639 先写盘，其后仍可能在能力检查处停下而未调作者。落盘文件断言保留为辅助。④ 反例：manifest 引用不存在的 knowledge 文件 → 捕获 console.warn 含"作者前置输入未注入"，invoke 仍发生且 prompt 无该段，run 不因此 HALT。用例 ③ 顶部注释（逐字）："// cp→main: 本用例的 1.0 manifest 在主干 formatter 下不注入——cp 时改为 1.1 manifest（knowledge 对象 + audience: [spec]），保留"路径与读取指令出现在 prompt.md"的送达断言；用例 ① 的 1.0 断言 cp 时删除。"。
    status: completed
  - id: t4-migration-runbook
    content: >-
      T4 迁移与运行说明。MIGRATION.md 的 3.0.0 段末尾加小节"### goal 作者前置输入（3.0.x 临时）"：goal 模式作者 prompt 注入 manifest 1.0 `provides.knowledge` 索引与读取指令；宿主把各阶段作者要求文件登记进 provides.knowledge（字符串，全部 Feature phase 都列出，文件名带阶段名以便分辨；hooks 原样保留，仍只进 verifier）；升 3.1.0 后 1.0 不再注入，须改 1.1 声明（knowledge 对象 + audience，按需 phase_bindings.<phase>.before_phase_work），否则提示消失——明写"不是无感接续"。docs/operations/harness-runbook.md §2 的 `extensions` 行追加一句"goal 模式作者 prompt 注入 1.0 knowledge 索引（3.0.x 临时，plan a7c3e9d2）"。RELEASE-NOTES-v3.0.0.md 一行。
    status: completed
  - id: t5-verify-and-host
    content: >-
      T5 收口验证。每个 todo 只跑对应单测；整批：`cd harness && npm test`（typecheck + unit + fixtures，AGENTS.md 开发验收 BLOCKER）、仓根 `node scripts/check-plan-version.mjs`、LF（node 扫）与 `git diff --check`；`grep -rn "cp→main:" harness --include=*.ts` 恰 4 处（formatter 头、注入块、调用点、测试；不含本 plan 与文档）。宿主由用户执行：消费仓在 1.0 manifest 里登记 plan/coding 的作者要求文件，起一次 goal run 跑 plan 或 coding，核对 goal-runs/<run>/phases/<phase>/prompt.md 含索引与指令，并按其既有统计法看作者读取时刻是否早于主产物落盘；不够再议内联正文。问题回灌七、实施记录。
    status: completed
---

# 作者前置输入接线：goal 作者 prompt 注入 extension knowledge 索引 / 文档纠偏 / 接缝对齐主干以便 cp（a7c3e9d2）

状态：**v2 已实施，待 review（2026-09-05，Claude 起草；v1 吸收 codex 四条收窄，v2 吸收 codex 三处 P2 与两处勘误；同日用户授权 Claude 亲自实施，一次性例外）。** 实施记录见 §七；未提交、未跑宿主。

关联资产：

- 触发：消费仓反馈 `D:\97.log\问题反馈\09-05\framework-proposal-author-context.md`（其实现提交在消费仓 story 分支 8a8d8a51，未拉取，只据本仓源码核实）。
- 主干对照：origin/main 6afa2a35 的 `harness/scripts/utils/extension-runtime.ts`（formatExtensionPhasePrompt :21-52，1.0 早退在 :27）、`skills/project/extension/SKILL.md` 注入面表、`openspec/changes/archive/2026-09-03-extension-manifest-1-1/`、`.cursor/plans/extension_实例扩展注入物化与检视_d8f4b7e2.plan.md`。
- 邻接（同批未提交，cp 顺序在前）：[写边界归属门禁裁撤_1741b6f2](./写边界归属门禁裁撤_信息缺失不再终局与源码漂移单次裁决_1741b6f2.plan.md)——它改了 buildPhasePrompt 调用点的上一实参。
- 记忆：branch-integration-strategy（cp 回灌、接缝对齐主干）、design-principle-efficiency-first。

---

## 零、决策纪要

### D0 原则与判断

效率优先、简单优先。反馈方指出的问题成立（作者动笔前拿不到要求），机制选错了对象（把 hooks 改成作者通道），而主干已经有答案（1.1 的 before_phase_work）。分支不造第二套通道，只在框架唯一能给作者组 prompt 的地方（goal 的 buildPhasePrompt）把已声明的 knowledge 送到作者眼前，接缝长得和主干一样，cp 时冲突退化成"取主干版本"。它是临时方案，退出条件写在 D7。

### D1 问题定性：通道接错对象，且文档把它说成作者通道

`on_context_load` 片段只进 verifier ai-prompt 尾部，且仅脚本 PASS 且 verifier 启用时装配；脚本 FAIL 时谁也看不到。本仓六处文档却把 `hooks/<phase>/on_context_load.md` 与 knowledge、overlays 并列为"宿主叠加指令"，这是宿主把作者要求放进 hooks 的直接原因。反馈方的留痕方案在 3.0.0 对 plan/coding 不生效（输入覆盖只在建立阶段跑一次）。

### D2 不采纳反馈方机制：主干已回答，且方向相反

主干 1.1：knowledge 按 audience 路由（global → AGENTS.md；phase → 该阶段 ai-prompt 索引），`phase_bindings.before_phase_work` 在 AGENTS.md 渲染一行"动笔前先按 manifest 处理"，`/extension inspect` 是纯派生检视表（不加载正文、不跑 .mjs）。hooks 被明确定性为 harness 内部事件、fragment 下一轮可见。反馈方案新增 author-context.ts 并删 verifier 侧调用，cp 到主干后两套作者通道并存、主干 hooks 描述变假。裁决：不动 hooks-dispatcher、不动 harness-runner.ts:1148、不建 author-context.ts。来源标识 basename→相对路径的"必要修正"随留痕方案一起放弃（门禁匹配的是作者写进 key_inputs_read 的字串，与片段标识无耦合）。

### D3 送达位置：goal 的 buildPhasePrompt；读取指令放注入块不放 formatter

框架只在 goal 模式给作者组 prompt，这是唯一能把内容放到作者动笔前上下文的位置；交互模式框架不组 prompt，天花板是"作者必读文件里的一句指路"（反馈方自己的数据：spec 阶段靠 skill 正文一句话拿到 14/16）。注入块由两部分组成：一句明确的读取指令（"Before writing this phase's artifacts, read the instance extension inputs below that apply to this phase."）+ formatter 输出。指令放在 buildPhasePrompt 里，因为 cp 时 formatter 整份换成主干版，指令必须留在不被替换的一侧。

### D4 接缝对齐主干：同路径、同名、同签名、同标题

新文件 `harness/scripts/utils/extension-runtime.ts`，导出 `formatExtensionPhasePrompt(bundle, phase, projectRoot)`，输出 `## Instance extension inputs` / `### Knowledge index` / `- \`path\``，与主干逐字同形。分支体只认 1.0 的 `knowledgePaths`（bundle 已由 loadResolvedProfile 经 applyInstanceExtensions 挂上，两边一致）。1.0 字符串的语义"全部 Feature phase 都列出"与主干 1.1 对旧字符串的定义一致，所以宿主升级时只是把字符串改成带 audience 的对象，作者看到的段落形状不变。

### D5 错误不静默（codex P1）

三态分开，顺序固定：`errors` 非空 → 调用入口 `console.warn` 明说"作者前置输入未注入"并指向 `--phase extensions`，formatter 本身与主干一致返回空串；无 manifest / 无目录（`manifestPath === null`）→ 不注入、不出声，这是"什么都没声明"；正常 → 注入。errors 先判：主干 loader 在 `paths.extension_dir` 非法时 `manifestPath: null` 与 errors 并存，先判 manifestPath 会在 cp 后静默吞掉这类错误（codex v2 P2）。不新增 goal 事件类型、状态、门禁：manifest 合法性已有全局 `--phase extensions` 门禁负责，goal 侧只负责不把"取不到"伪装成"没有"。

### D6 范围：静态作者要求的前置指引

解决的是 `.md` 静态要求在动笔前的指引，不是三层 `.mjs` hook 的作者侧执行，也不是 profile 层（profile-addendum 已由各 SKILL 要求先读）。反馈中六份 author.md 全是静态文件，先以最小方案在宿主实跑验证；指路不够再议内联正文（主干 formatter 已有 summary 字段可借，届时在主干做）。

### D7 退出条件与 cp 顺序（codex P1）

cp 到主干时：`extension-runtime.ts` add/add，整份取主干；buildPhasePrompt 注入块与 `extensionInputsForPhase` 干净应用；调用点一行在写边界批次之后 cp 则无冲突；import 一行平凡；测试把 1.0 用例改 1.1、保留送达断言。**后果**：主干 formatter 对 1.0 返回空串，仍用 1.0 manifest 的宿主在升级后失去 goal 作者提示，须把 knowledge 改成对象并声明 audience（按需加 before_phase_work）。MIGRATION 明写，不描述为无感接续。反向不回灌：主干的 1.1 不 backport 到 3.0.x。

### D8 `cp→main:` 注释纪律（用户要求）

四处 cp 相关代码各带一段以 `cp→main:` 开头的注释，逐字见 todos：取谁的版本（formatter 头）、为什么留在这一侧（注入块）、先后顺序（调用点）、哪条断言要改（测试）。收口时 `grep -rn "cp→main:" harness --include=*.ts` 恰四处（限源码与测试的注释行，本 plan 与文档里的引用不计），多了少了都算没完成。

## 一、放弃的准确性（逐项）

| 项 | 放弃什么 | 为什么可接受 |
|---|---|---|
| D3 | 指路不是送达：作者仍可能不读 | 已是不内联正文前提下最强的位置（任务 prompt 开头）；宿主实跑验证，不够再内联 |
| D3 | 交互模式只靠行为规约一句话 | 与反馈方在 spec 上验证有效的做法同构，且归框架管、一处覆盖七个阶段 |
| D4 | 1.0 字符串在每个阶段都列出，六份文件六个阶段各见一次 | 文件名带阶段名即可分辨；升 1.1 后按 audience 精确 |
| D4 | 不显示 summary、不读正文 | 分支临时语义（主干对 1.0 不注入，见 D7）；正文由作者按路径读 |
| D5 | manifest 非法只 warn 不阻断 goal | 合法性门禁在 `--phase extensions`；goal 侧再阻断是第二次裁决 |
| D7 | cp 后 1.0 宿主提示消失 | 临时方案的既定退出条件，MIGRATION 明写升级动作 |
| D2 | 六阶段 hook 来源标识仍同名 | 无程序解析该标识；留痕方案已放弃 |
| T2 | 每次 attempt 多调一次 loadResolvedProfile | 调用点附近本就在调，成本可忽略 |

## 二、预期效果

| 指标 | 现状 | 预期 |
|---|---|---|
| goal 模式作者动笔前收到的扩展要求 | 无（只有 skill 路径一行） | 索引 + 读取指令在任务 prompt 开头 |
| 反馈方 plan/coding 动笔前读到要求 | 0/3、0/1 | 由宿主按其统计法复测，目标接近 spec 的 14/16 |
| 框架文档对 on_context_load 的描述 | 六处说成作者叠加指令 | 一致说明只进 verifier 上下文 |
| cp 到主干的冲突面 | — | 一个文件整份取主干 + 一行顺序约束 + 一条测试改 1.1 |
| 主干 d8f4b7e2 欠的"通用注入" | 未落地 | cp 本批即落地，且自带 1.1 三块语义 |
| 新增机制 | — | 零：无新事件、状态、门禁、脚本、hook 语义 |

## 三、非目标

- 不改 hooks-dispatcher.ts、不删 harness-runner.ts:1148 的 on_context_load 调用、不改 lifecycle schema 事件集、不建 author-context.ts。
- 不在交互模式做框架侧注入（框架不组作者 prompt）；不内联 knowledge 正文；不执行 .mjs 取动态片段。
- 不把主干 1.1（knowledge audience / phase_bindings / mcp_actions / `/extension`）backport 到 3.0.x。
- 不退役 ut 专用格式契约块（那是 ut 产物契约的行为变更，单独裁决）。
- 不新增 goal 事件类型、summary 字段、门禁、留痕；不改 Context Facts Gate。
- 不动 scripts/utf8-rename-spec-skill.mjs；不处理主干 spec/SKILL.md 的重复句（cp 时顺手）。

## 四、提交边界（分段用，不是提交授权）

T0 一段（纯文档）；T1 一段（分支兼容 formatter，cp 时整份被主干替换，独立成段边界最清楚——codex 建议）；T2 + T3 + T4 一段（接线、指引、测试、迁移说明是同一次行为切换）；T5 只有验证记录。任何一段都以 review 结论为准，不由实施方自行提交。

## 五、验证策略

- 每个 todo 只跑对应单测；T2 加 typecheck；不在每段前重复完整 `npm test`。
- 整批收口：`cd harness && npm test`（typecheck + unit + fixtures，AGENTS.md「开发验收（BLOCKER）」）、仓根 `node scripts/check-plan-version.mjs`、LF（node 扫）、`git diff --check`、`grep -rn "cp→main:" harness --include=*.ts` 恰四处。
- 宿主由用户执行：消费仓在 1.0 manifest 登记 plan/coding 作者要求文件，起 goal run 跑 plan 或 coding，核对 `prompt.md` 与读取时刻统计。问题回灌七、实施记录。

## 六、完成判据

1. 九处文档不再把 `hooks/<phase>/on_context_load.md` 描述为作者叠加指令；lifecycle schema 事件描述写明只进 verifier ai-prompt 且脚本 PASS 时才装配；device-testing SKILL 引用行为规约。
2. `harness/scripts/utils/extension-runtime.ts` 存在，导出签名与主干一致，输出标题逐字同形；文件头带 `cp→main:` 注释。
3. goal 模式 spec 阶段在 1.0 manifest 声明 knowledge 时，注入的 invoke 确实被调用，且其收到的 prompt 含读取指令句、`## Instance extension inputs`、`### Knowledge index` 与相对路径（落盘 `goal-runs/<run>/phases/spec/prompt.md` 同内容为辅助断言），有驱动真实接线的单测覆盖；无 manifest 时无该段且无 warn；manifest 非法时有 warn、无该段、invoke 仍发生、run 不 HALT。
4. buildPhasePrompt 不传 `extensionInputs` 时输出与现状逐字节一致（既有二十余处测试零改动）。
5. 行为规约原则 1 有第 8 条；七个 feature SKILL 均引用该规约。
6. MIGRATION 3.0.0 段写明临时机制、宿主登记方式、升 3.1.0 须改 1.1 声明否则提示消失。
7. `grep -rn "cp→main:" harness --include=*.ts` 恰四处；`cd harness && npm test` 全 PASS；`check-plan-version.mjs` 默认模式、LF、`git diff --check` 全绿。
8. 宿主实跑：plan 或 coding 的 prompt.md 含索引；作者读取时刻早于主产物落盘（宿主按其统计法复测）。

## 七、实施记录

**2026-09-05 Claude 实施（用户授权"作为 coder 开工"，一次性例外；未提交、未跑宿主）。**

- T0：九处文档 + device-testing 引用，按 todos 逐字落地；schema 用 `>-` 折叠块，`yaml` 解析验证通过。
- T1：`harness/scripts/utils/extension-runtime.ts` 新建，签名 `formatExtensionPhasePrompt(bundle, _phase, projectRoot)`，标题与主干逐字同形；`phase` 形参前缀下划线以过 noUnusedParameters。
- T2：`extensionInputsForPhase` 与 `buildPhasePrompt` 的 `extensionInputs` 形参落在 goal-phase-runtime.ts；调用点一行；import 一行；行为规约第 8 条。三态顺序按 v2（errors 先于 manifestPath）。
- T3：`goal-extension-author-inputs.unit.test.ts` 五条（formatter / 注入位 / 送达接线 / 非法 manifest / 三态顺序）。t3、t4 用 `__testing_setInvokeAgent` 在回调内读 `prompt.md` 断言，同时保留落盘辅助断言。单跑与经 run-unit `--filter` 跑均 5/5。
- **实施中发现的既有坑（非本改动引入，但被本改动触发）**：run-unit 的套件顺序有隐式约束——goal runtime 的 `setupSignalHandlers` 在进程内首次跑 goalMain 时安装 SIGINT/SIGTERM/SIGBREAK handler（收到即 `process.exit(130)`），而第 81 位的 device-session 套件用 `process.emit('SIGINT')` 测自身清理。既有 goalMain 类套件全排在第 105 位之后，所以此前无事；本套件初版注册在第 2 位，全套 unit 跑到 device-session 即整进程 130 退出（三次复现：工具后台、cmd 隐藏窗口、bash nohup 均在约 90 秒处死于 `TRUST_PROBE_ROOT` 之后）。修法：把注册位挪到 host-runtime-truth 之后，并在注册处写明顺序约束。cp 到主干时该注释一并带过去。
- T4：MIGRATION 3.0.0 段新增 3.0.x 小节；runbook §2 extensions 行；RELEASE-NOTES 1c 节。
- T5：typecheck PASS；`cp→main:` 限 harness ts 恰四处；`check-plan-version.mjs` 默认模式 PASS；十七个改动文件 LF；`git diff --check` 干净。整批 `cd harness && npm test`：套件重排后第四次跑（bash nohup 脱离工具超时，`$?` 运行期求值）EXIT=0——typecheck PASS；unit 3814 passed / 0 failed（device-session PASS=14、goal-extension-author-inputs PASS=5）；fixtures 46 passed / 0 failed；`harness/reports/unit-failures.json` 未生成；耗时约 8.5 分钟。前三次 130 退出均为上述顺序坑，非用例失败。
- 未做：commit、宿主实跑（T5 宿主部分按既定由用户执行）。
- **2026-09-05 codex review 通过**（无阻断缺陷；作者接线、错误三态、交互指引与 d2f7a9c4 兼容均符合方案）。一处非阻断的 cp 交接遗漏已补：测试文件的 `cp→main:` 注释补上 t5 样例须改 1.1 manifest、`fakeBundle` 缺主干 ExtensionBundle 新增必填字段（cp 时补齐或改用真 bundle，否则 TS2322）。改后套件 5/5，标记仍恰四处。

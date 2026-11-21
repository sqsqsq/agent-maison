---
name: verifier 减负与按项复核
version: 3.1.0
parent_goal: balanced-delivery-and-reliability-a47c9d62
advances:
  - g3-recoverable-execution
  - g5-proportionate-verification
  - g6-real-host-delivery
relation: core
layer: governance
goal_requires:
  - existing-obligation-scope-and-responsibility-contract
goal_provides:
  - proportionate-phase-verification
real_host_validation: >-
  用 fe4512 的 S1/S2 原件回放生产入口，再用启用阶段 verifier 的 adapter 在干净业务基线联合验收一次，
  记录各角色耗时、实际核验调用及保留下来的产品发现。
parallel_authority_added: false
overview: >-
  减少六个业务阶段送入 verifier 的材料和重复模型调用。以实际变化、验收引用和开放发现缩小复核范围，
  保住独立审查、UT 断言强度及设备验收。三个阶段依次实施，全部完成后统一验收一次。
todos:
  - id: reduce-prompt-material
    content: 阶段一。按真实来源裁剪长材料，合并双入口，限定本轮图片，保留派生输入、拒修理由与反证。
    status: pending
  - id: reuse-machine-facts
    content: 阶段一。收编编译和 trace 机器结论、单次 Review 真假裁决与纯格式恢复，对齐诊断标题并校准三类差异的严重度。
    status: pending
  - id: bind-review-preimages
    content: 阶段二。让删除及重命名的真实旧内容进入现有材料身份，打通重算、等价复用和历史兼容。
    status: pending
  - id: recheck-affected-items
    content: 阶段三。按当前义务与真实变化选项，沿用有效逐项结论及其责任方，只补缺项，影响不明时完整核验。
    status: pending
  - id: unified-acceptance
    content: 统一验收。完成生产入口回放、关键变异、目标套件与日常全集，并在一个有阶段 verifier 的干净宿主完成分角色实测。
    status: pending
---

# Verifier 减负与按项复核

## 1. 目标与事实依据

在同一请求、同一验收范围下，减少送进模型的字节数、重复核验和无语义收益的模型调用。保留 UT 对真实生产入口与断言的判断，Review 对可能触发返工的问题逐条确认，以及 Testing 对实际设备行为的验收。范围是 Spec、Plan、Coding、Review、UT、Testing 的阶段 verifier。计划经独立检视通过后实施，三个阶段是依赖顺序，中间没有交付或评审停点。

以 `b32ca152` 为开发基线。下表区分当前实现、保存的宿主原件和回放观察。历史文件体积与现在的墙钟收益分别计量。

| 观察 | 对本次设计的约束 |
|---|---|
| 10 月 24 日开卡宿主的 Coding、Review、UT 提示词各有逐字相同的 119,397 字节源码和 44,523 字节契约，另有各约 60 KiB、部分版本不同的 facts。当前 `collectContextFiles` 的 `resolvedInputs` 分支内联已解析值后提前返回，旧分支的“上游文档给路径”用不到。 | 把此前 [T7 的按需读取设计](3.0.0效率优先_闭环仪式减法与verifier一次化与证据按输入复用_07a41ec6.plan.md) 接到实际分支。保留 facts 与输入之间的真实差异。[生产装配](../../harness/harness-runner.ts) |
| 基础上下文与 `independentVerificationContext` 都可加入实际 diff、拒修论据及开放发现的证据文件，之后直接拼接。这条接线于 10 月 31 日 `f40d45e5` 引入。10 月 24 日同份 `review-report.md` 出现两次的来源则是旧实现同时收集问题报告与必需产物。 | 两个场景分别做回归，覆盖“一份原件有多个用途”和“两份材料内容相似但有实质差异”。[增量上下文](../../harness/scripts/utils/verifier-material.ts) · [S1 原始提示词](../../harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/doc/features/bc-openCard-2/bank-card-opening-flow/review/reports/ai-prompt.md) |
| fe4512 的 S0/S1/S2 合并后按 `subject_id` 去重是 30 份报告，Coding 10、Review 8、UT 6、Plan 3、Spec 2、Testing 1。整个 `host-recovery-history` 同口径为 35 份，30 PASS、5 FAIL，均有逐项表。5 份 FAIL 的触发项是 Spec 延后登记、Coding 形参名、UT mock 预设对齐，以及两次 UT 端到端驱动不足。Review 确认的 CR-001/002/003 均回到 Coding 并已修复。 | 报告总判与被审产品裁决是两个事实。保留确实抓到的行为和测试缺陷，严重度按 §3 的实际后果裁定。[历史原件](../../harness/tests/fixtures/host-recovery-history) · [三条修复记录](../../harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/doc/features/bc-openCard-2/bank-card-opening-flow/review/review-report.md) |
| fe4512 的 6 份 UT 报告都重复论证成功与失败共用 `RESULT`，其中 5 份的 `use-cases.yaml` 摘要同为 `13214e59…`。10 月 26 日 i28 派发时 `Diagnostics` 为空，原定路径已有同 subject 可解析的完整报告，额外会话耗时 160.201 秒。会话把 prompt 内嵌副本与报告的差异描述为末尾空行，写后复查仍是围栏前 53 行对目标 52 行。i26 原判断则缺当前验收依据的文件和行号。 | 重复出现的发现只计为报告事实，回退原因取实际事件。i28 的收益是免派一次无实质补核的会话，不把围栏空白当成报告缺陷。[UT 原件与材料](../../harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/doc/features/bc-openCard-2/bank-card-opening-flow/ut/reports) · [S2 取证及边界](../../harness/tests/fixtures/host-recovery-history/20261026-fe4512-s2/README.md) |

## 2. 保留与裁剪

| 保留 | 裁剪 |
|---|---|
| workflow、profile、evidence policy、adapter 决定是否签发。签发、报告、回执与 Goal 完成处置继续用现有入口。[适用性](../../harness/scripts/utils/verifier-plan.ts) | 同轮重复展开的原文、已经有独立原答的纯格式调用。 |
| 公开材料原件、可定位引用、完整拒修理由、反证、真实编译/执行、设备 trace 和负面结论。 | 对机器已算出的状态、枚举、表头和 trace 对账再做模型判分。 |
| 阶段独核、独立 Review、蓝图设计质询、视觉评审各自对自身产物负责。 | 同一条 Review 发现的第二次真假判断及同依据旧发现的重新论证。 |

## 3. 阶段一 · 减负与交还机器

本阶段沿用现有整份材料复用和闭环语义。只改变提供材料的方式、重复工作及三个已证实场景的模板判定。

**材料装配。** 在 `collectContextFiles`、增量上下文和 `assembleAIPrompt` 的交界处区分“被审内容”和“按需查阅的原件”。本阶段产物、实际变化、未关闭发现和支撑或推翻发现所需的具体证据保留内联。可按绑定定位的长源码、上游文档、历史原件和 facts 只展开本次需要的部分，余下给真实路径及必要定位。同一文件兼任两者时内联一次并沿用其来源。对由蓝图派生、给定 Git 基线读取或解析后才成立的值，只有路径能还原本轮所审内容时才用路径替代，否则保留解析值或原字节。使用现有绑定与物理 Feature 路径。[runner](../../harness/harness-runner.ts) · [报告装配](../../harness/scripts/utils/report-generator.ts)

实际 diff、拒修账本和发现证据各从一个入口收集，在最终组合处按同一来源和同一内容合并。保留多个用途及可定位关系，拒修原文和反证完整可读。同路径的历史前像与当前内容分别保留。呈现去重后，按路径读取的原件仍进入材料绑定，改动仍可使结论失效。Coding 的 `context-images/` 清单直接来自本轮成功复制的图片，允许历史文件留存。

**机器与模型的分工。**

- Testing 直接引用本轮 `report_trace_reconciliation` 和已有结构检查。保留 FAIL、未执行和覆盖缺口。独立判断继续核对用例是否证明原验收、截图是否支持结论、复测是否覆盖原失败行为。[Testing 模板](../../harness/prompts/verify-testing.md) · [机器对账](../../harness/scripts/check-testing.ts)
- Coding 直接读取真实编译和 `can_claim_done`。取消检查 0 的二次判分，兼容现有报告中的 `coding_compile_gate`。机器已签发失败诊断时仍核具体业务、断言与责任方，独核不得签掉原产品 FAIL 或补造编译 PASS。[Coding 模板](../../harness/prompts/verify-coding.md)
- Review 的 `issue_accuracy` 对未关闭的 BLOCKER/MAJOR 逐条核实，低严重度保留已有抽样边界。`false_positive_rate` 从同一批已核实条目的 `confirmed/refuted` 结果派生，分母仅含已判真的或已判假的条目，另列 `unclear` 和未抽查项。保留既有输出 ID 与逐条责任归属。在模板中只给误报统计保留数值分档，取消 `issue_accuracy` 对同一比例的第二次分档。[阶段规则](../../specs/phase-rules/review-rules.yaml) 中已有的语义职责继续适用，本项只改 [Review 模板](../../harness/prompts/verify-review.md)。产品处置继续看具体问题与影响。
- 保留生产标题“本轮为独立问题诊断”。对齐 Coding、Review、Testing、UT 四份模板及 `verifier.md`，用 `npm --prefix harness run sync:codex-agents` 重新生成 Codex TOML。真实请求资格继续由生产解析器决定，提示文字只负责传达该决定。[生成端](../../harness/scripts/utils/report-generator.ts) · [角色源文件](../../agents/claude/templates/agents/verifier.md) · [生成脚本](../../harness/scripts/sync-codex-agent-templates.ts)

**补格式。** 先消费已签发 request 原定路径的报告。身份一致、现有证据读取器及本次所需的正文诊断已能采信、当前发现也没有待核实的实质缺口，就直接 finalize/receipt，保留已有否决或返修。报告末尾空行不改变这些结论。判定只需要当前报告与现有义务，不要求另找一份文本逐字比对，诊断为空也不能单独证明当前报告合格。报告缺失或确须恢复时，只从同一 request 已有的真实 verifier 角色交回原件恢复到其原定路径，再走同一读取器。没有可采信原件，或者缺真实文件与行号、验收依据、责任归属或有效判断，沿现有入口一次补核具体缺口。重复恢复幂等，迟到的旧 subject 不覆盖当前报告，作者摘要和 prompt 内嵌引用不能签发语义结论。[Goal 派发](../../harness/scripts/goal-phase-runtime.ts) · [报告验真](../../harness/scripts/utils/verifier-evidence.ts) · [正文诊断](../../harness/scripts/utils/repair-candidates.ts)

**严重度边界。** 能从权威材料确定、且不改变产品行为、验收覆盖或授权范围的差异，走现有对齐或披露渠道。只改阶段模板及相应已挂载提示。判 BLOCKER 必须说清受影响的真实契约、验收或授权，以及放过的后果。

| 原件 | 预期处置 |
|---|---|
| 按位置调用的 `sendMockCode(mobile)` 与 `sendMockCode(_mobile)` 仅形参改名 | 记录差异，零产品返工。若实际改变参数类型、顺序或按名消费的公共契约，按真实违约核实。 |
| 开卡 Spec 的 `best_effort` 延后项已在参考清单登记 | 模板直接消费既有 `hard/best_effort` 机器判定，保留披露和债务。硬性承诺的视觉元素继续执行原验收，补抄登记不能改变授权。[保真判定](../../profiles/hmos-app/harness/fidelity-governance-check.ts) |
| 生产代码忽略 `save()` 返回对象，捕获异常后统一产生 `RDB_SAVE_FAILED`，UT 已断言该错误码 | 保留 mock-plan 与 Spy 的文字差异，不阻断。测试分段覆盖却无法证明承诺的完整业务序列，仍判阻断。[生产调用](../../harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/02-Feature/WalletMain/src/main/ets/domain/service/BankCardOpeningService.ets) · [测试强度反例 2b978a65](../../harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/doc/features/bc-openCard-2/bank-card-opening-flow/ut/reports/verifier.report.2b978a65cde9d86a01a9ce3359f339aef6123f799bf985126a12c0478412c85c.md) |

## 4. 阶段二 · 补准材料身份

独立运行可切换 Git 比较基线。当前工作树完全相同，删除或重命名前的内容仍可能不同。现在 `(before <sha>) 路径` 是显示标签，材料构造跳过以括号开头的标签。按 P2 修复这个已复现的独立运行场景。现代 Goal 继续用该 run 固定的正式基线。[差异读取](../../harness/scripts/utils/diff-scope.ts) · [基线选择](../../harness/scripts/utils/git-diff.ts) · [材料](../../harness/scripts/utils/verifier-material.ts)

从实际 diff 的 D/R 条目取得变更类型、旧路径、重命名目标（适用时）及基线原字节摘要，按稳定次序并入现有 `input_bindings_sha256` 的输入。保留原有输入绑定分量。独立运行缺少 `resolvedInputs` 但有 D/R 时也生成这一分量，无前像条目时保持原算法。在材料构建处消费同一真实 diff 和前像读数，显示标签不参与取证。签发时可传入刚读的结果，policy 关闭下以空 `contextFiles` 重算时仍从既有基线取得相同读数。二进制按原字节取摘要，无需将 Git SHA、时间戳或整个工作树绑进每一项。旧路径不冒充工作树现存文件。实际前像不可读时标明证据缺口，用现有核验路径恢复，不能按相同的空值证明等价。

签发、材料重算、同材料查找、policy 关闭时已有否决的判定，以及拒修论据追加后的重签，都须理解同一份已绑定材料。新旧 subject 的等价检查不能绕过前像差异。[请求身份](../../harness/scripts/utils/verifier-request.ts) · [复用及否决](../../harness/scripts/utils/verifier-evidence.ts)

## 5. 阶段三 · 按项复核与缺项补核

范围只从**实际材料变化、验收引用和未关闭发现**推导。以既有公开报告、对应 material 和当前适用义务为输入。复用已存在的检查 ID、汇总表证据单元格、非 PASS 明细和 `issue-verification`。按文件、行、符号、AC/CR、事实与实际调用关系确定受影响项。某项证明依赖变更的契约或生产调用链时须复核。仅共享同一个未变需求文件，不足以把其余条目全部重开。11 月 20 日蓝图 i6/i8 回放中，输入不变时只剩一项，单改 `stack-cleanup-boundary.resolution` 选中 19 项。只借鉴保留旧答的做法，保持设计质询自身职责。[已有材料差异](../../harness/scripts/utils/verifier-material.ts) · [蓝图选择器](../../harness/scripts/utils/blueprint-questioning.ts)

| 条件 | 本轮消费和输出 |
|---|---|
| 首审、上次公开原件/材料不可用、规则语义变化无法归到具体项，或实际影响无法界定 | 完整核验当前适用项。路径可读和工具绿灯单独不能证明业务已通过。 |
| 同材料已有有效报告 | 按现有路径复用 PASS 或 FAIL。对当前确实需要逐项依据的义务，连同报告正文判断该项是否已有可用结论。 |
| 变化能定位 | 提示只展开受影响的项及必要反证。未受影响项在原汇总表用原 status、severity 和证据单元格直接引用最初有效的公开报告及条目。保留非 PASS 依据、责任方和未决处置。最终报告仍回显当前 subject，只有独立审查能改变语义结论。 |
| 有有效报告身份，部分适用项缺少可采信答案，包括只有一句 PASS 的报告 | 在本次已知必核集合内取缺项，一次补问，沿用其余有效行。没有可沿用项且本次必核集合覆盖全阶段时，自然按完整适用集合审。历史短报告仍可读，未被本次义务使用的行没有补表要求。 |
| 同一开放发现再出现 | 依据和已定处置未变，引用原发现并保留责任方。已有否决继续生效。验收、实现或有效反证（含新的真实拒修论据）有变化时，只重新核它影响的结论。 |

本轮必核集合取自现有义务已有的验收引用（含适用的 `acceptance_ids/affected_files`）、有逐条 `issue-verification` 要求的开放发现，以及实际差异能定位到的检查项。缺项只相对该集合判断；同材料、无新待核依据时直接使用既有有效结论。同一套范围和报告消费用于首次签发、同 subject 已有 PASS 的快捷路径、异 subject 等价复用、补核与回执/完成判断。计数仍由有效逐项结论决定，原汇总表列出各适用项不等于重新审读它们的全文。明确不适用仍按既有规则处理，已有真实失败或证据缺口不能靠汇总 PASS 清掉。把旧结论直接引用到原始依据，避免多轮复核形成逐份追读的报告链。[逐项解析](../../harness/scripts/utils/repair-candidates.ts) · [回执](../../harness/scripts/check-receipt.ts) · [完成判断](../../harness/scripts/utils/verify-feature-completion.ts)

## 6. Adapter、兼容与不采用方案

| 宿主 adapter | 阶段 verifier 覆盖 |
|---|---|
| `claude` | 生产声明启用时，使用 [verifier.md](../../agents/claude/templates/agents/verifier.md) 和现有 request/report。 |
| `codeagent` | 与 Claude 共用同一角色源文件和请求协议，覆盖同一补核与引用行为。[adapter 声明](../../agents/codeagent/adapter.yaml) |
| `codex` | 从同一角色源生成 [verifier.toml](../../agents/codex/templates/agents/verifier.toml)，验证生成等值、实际派发和交回。 |
| `deepseek-harness`（DSH） | 当前未声明阶段 verifier，继续按现有策略不签发。设计质询、独立 Review 和视觉调用按各自角色计量。[adapter 声明](../../agents/deepseek-harness/adapter.yaml) |
| `cursor`、`opencode`、`chrys`、`generic` | 随各自既有 adapter 声明和适用性解析。模板存在不构成能力声明。 |

模板或前像绑定变化会使受影响的在途 run 在下次正式装配时换 subject，原件保留，必要时对迁移后的材料重审一次。同一新材料再次运行应复用。只在现行比较能证明等价时沿用旧报告，旧 subject 或原有拒绝不能改写或补签。保留发布件进入宿主 `framework/` 的既有集成方式。

**不采用的方案。** 运行时目标为零新增持久字段、状态、协议、检查 ID 和停机原因。复用现有 material、报告、处置和恢复路径。本计划不引入逐检查项依赖登记表、薄 PASS 全表门禁、蓝图范围算法移植、自动改产品/自动补审批的机制或 DSH 阶段 verifier。若实施证明必须新增机制，先按 [仓库准入规则](../../AGENTS.md) 说明它解决的具体场景与实际收益，再独立判断是否需要调整范围。宿主个别产品问题仍归原产品责任方。

## 7. 一次统一验收

以版本、宿主原件、需求、配置和执行条件可比为前提。用隔离副本分别运行改动前后的正式 Feature harness、Goal 派发、报告读取和 receipt/完成入口。S1、S2 按各自 README 重建，记清版本、原始 SHA 和必要环境适配。S2 采集时已被覆盖的早轮报告按其已知边界处理，不将拼接回放冒充当时完整原件。仅需验证选域反例时使用 11 月 20 日 i6/i8 已保存的原件。历史现场只读。[S1](../../harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/README.md) · [S2](../../harness/tests/fixtures/host-recovery-history/20261026-fe4512-s2/README.md)

同一组原件分别走基线与候选的相同业务入口，按阶段及同一业务材料配对记录结果。无签发的阶段单列原因。回放可用已保存的真实独立报告或可计数的测试运输来检查派发、复用和责任路由。语义质量另由独立检视对照原证据，并结合下面的真实宿主运行验收。

**i28/i26 的回放输入。** S2 原发布件 `fb3ef864` 的 `goal-phase-runtime.ts` 在现有待核发现、正文诊断、`next_action=run_verifier_then_receipt` 三者之一成立时可派发。i28 的 `events.jsonl` 第 646/650 行证实派发与耗时，原 `prompt.md` 第 3 行的诊断为空，不能用后来覆盖的 summary 倒推分支。先按原入口在隔离副本记录实际命中的条件，再在开发基线和候选上验证同场景。如果开发基线已经正确跳过，沿用该行为，以恢复“只凭旧动作/待办即派会话”的变异证明回归能抓住，不虚记新增提速。i26 的目标报告后来已被覆盖，将补核前 `agent-output.log` 第 19 行打印的原目标正文按本次 request 重建在副本，标明重建来源，用它验证缺实证所需派发。[i28 派发提示](../../harness/tests/fixtures/host-recovery-history/20261026-fe4512-s2/doc/features/bc-openCard-2/bank-card-opening-flow/goal-runs/20261023T044016Z-fe4512/phases/plan-verifier-format-repair/plan-verifier-format-repair-i28-c1c2dd1567e9/prompt.md) · [i26 补核原件](../../harness/tests/fixtures/host-recovery-history/20261026-fe4512-s2/doc/features/bc-openCard-2/bank-card-opening-flow/goal-runs/20261023T044016Z-fe4512/phases/plan-verifier-format-repair/plan-verifier-format-repair-i26-75dbc0c98f4e/agent-output.log)

| 可观察结果 | 正例、反例与关键变异 |
|---|---|
| **① 长材料在一次复核中只展开一次，纯格式补核零次模型调用。** | 六阶段分别列 `ai-prompt.md` 实际 UTF-8 字节数（前、后、差值），核对源码/契约块、facts、两代 Review 重复来源、完整拒修和反证的可读性。连续两轮替换图片，本轮清单只含新图。i28 原定路径已有完整可采信报告时直接 finalize，验证零模型调用及原实质发现依然在场。i26 缺据时仍签发 verifier 并核实原件。变异恢复双入口、混入旧图、对 i28 空派发或把 i26 错送格式分支时，分别命中对应断言。 |
| **② 编译与 trace 直接用机器结论，独立核验保住真实缺陷。** | 正常编译、编译失败可诊断和设备对账三条入口均核实际机器结果与统一诊断标题。用 CR-001/002/003、`2b978a65` 和 Spec `33645910`“失败返回页面不一致”逐条验证原证据仍在内联或可定位路径中，可读内容与绑定相符。一次 Review 裁决生成两种原有输出。变异移去一条关键源码/验收依据或把产品 FAIL 投为 PASS，应暴露缺口或错误处置。 |
| **③ 局部变化只复核相关项，缺项只补项，删除前像变化使旧结论失效。** | 独立运行对同一工作树选择不同删除前像及重命名前像，分别得到不同 subject，旧 PASS/FAIL 都不能错用。无关提交但实际所审前像相同仍可复用。一次局部变化只展开受影响项，其余行可追到原报告。删掉一项已知必核行只补该项。首审、旧原件不可用或影响未知时完整核验。恢复漏绑前像、令同 subject 的薄 PASS 短路、忽略旧否决或因共享未变文件扩大范围，均应被对应断言捕获。 |
| **④ 三类无实质影响的差异按 §3 处理，测试强度反例仍阻断。** | 用真实报告和其绑定材料核实命名、best_effort 登记及 Spy 文案，保留相应披露。把输入换为硬性视觉承诺或只测片段的 `2b978a65`，处置应随真实义务改变。用 6 份 UT 报告证明同依据 `RESULT` 发现保留原责任、只引用旧论证，实际验收或调用链变化后可重新核实。模板文字匹配和预填的模拟 PASS 单独不能作为语义裁决通过依据。 |

**工程验证。** 每轮开发执行 `npm run test:changed`。模板变动后定向执行 `npm --prefix harness run test:unit -- --filter verifier-production-routing`、`codex-adapter-verifier-template`、`verifier-material`、`verifier-evidence`、`verifier-semantic-handoff` 及消费迁移快照的相关用例（`feature-assessment`、`successor-exit-early` / `successor-exit-late` 中相关 case，按实际注册名筛选）。关键变异只在隔离副本临时施加，记录正确实现通过与变异命中目标断言的对应关系。一次收口时跑 `npm run test:daily` 和本计划的定向验收，复用同一输入已有结果。[套件注册](../../harness/tests/utils/unit-suite-registry.ts) · [旧宿主快照迁移](../../harness/tests/fixtures/host-snapshot-3.1.0/migrate.ts)

**干净宿主联合验收。** 用已校验发布件集成到获准的干净宿主，以 `codex` 或 `claude` 启用阶段 verifier，同一真实业务需求从原起点到交付终点完整跑一次。记录框架版本/提交、宿主基线、需求、模型与 adapter、设备/工具条件、终点和剩余质量结论。把 `summary.verifier_request` 及 subject 与实际派发、交回或报告复用对应，分别计签发请求、实际模型调用（含补核重试）和复用命中。按作者、阶段 verifier、独立 Review、设计质询、视觉评审列时长，注明嵌套、重叠及缺失观测，墙钟按区间并集。token 有数据时区分总输入和缓存输入。开发回放与真宿主实测分别列证，覆盖四个结果后一次签收。阶段调用数、原始报告数和全角色累计时长各有各的分母，提速幅度以可比实测为准。

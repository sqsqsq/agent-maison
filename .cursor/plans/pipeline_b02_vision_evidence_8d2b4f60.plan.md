---
name: 六阶段重构 B02 — 视觉能力与材料证据施工图
overview: 删除invoke级inline金丝雀全链，参考图读取记录改绑材料哈希；能力真值回落run级preflight金丝雀，保留completion probe与独立visual provider，不扩大视觉系统。
version: 3.0.0
todos:
  - id: b02-detail-after-b01
    content: B01本地验收并提交后，细化本批到文件/调用顺序、代价、提交边界和可执行验收，再实施。
    status: completed
  - id: b02-capability-lifecycle
    content: 按D1删除inline canary出题/prompt块/判卷/capability-receipt及其全部消费者，能力真值改run级preflight金丝雀缓存，终签只认probe来源（image_input_override不构成实测证据），探测未完成不缓存none。
    status: completed
  - id: b02-material-quality
    content: 按D2/D3使refs回执绑run_id+参考图内容哈希+adapter，Read命中改完整路径等值（删basename兜底），loader只收schema 1.1，attended不生产回执，runner只覆盖不删、跨invoke取并集；删closure轮强制逐图重读与invocation-bound公共句，保留诚实unverified文案。
    status: completed
  - id: b02-nongoal-attended
    content: 按D5/D6/D7给出非goal与attended的可达证据路径与四态文案（不可达/未实测/尚未生成/验证不通过），attended能力轴仅无pin可达，不伪造goal身份或stdout；设备侧critic_run_id按D6结论处理。
    status: completed
  - id: b02-contract-local
    content: 按D8同步四份OpenSpec delta（含visual-capability-routing规范性正文）、MIGRATION与spec侧文档，扩既有目标套件（含attended bridge与goal-report文本断言），核对独立visual provider不受影响，完成候选件本地验收。
    status: completed
  - id: b02-host-acceptance
    content: 用户触发候选件集成和bc-openCard-1的C-U合并回归（spec→ut窗口，同时验收B01 V9与本批），确认纯收口不重考、不拒签、负面结果可回修；B03细化不等待此项。（责任转交 origin/Br_release_3.0.0：main 不再拥有本 todo，取消不代表验收完成）
    status: cancelled
---

# B02施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。依赖 [B01](pipeline_b01_verifier_repair_3a7f9c12.plan.md) 本地验收（已完成、已提交），宿主回归与B01合并为一次C-U（spec→ut窗口）。本批只做F03/F04/F05，不实施B03至B06提纲。

## 1. 问题边界

宿主run `20260905T103028Z-79d3fd`（只读取证，`events.jsonl`）的spec期五次invoke：

| invoke | exit | capability_receipt | spec_refs_receipt | phase_verdict |
|---|---|---|---|---|
| spec-i3 | — | issued_inline_canary | complete | PASS / retry（closure open） |
| spec-i4 | 1（`kill_attempted:true`，401141ms） | **not_issued** | **complete** | FAIL / retry，`blocker_signature=ui_spec_fidelity_gate` |
| spec-i5 | 0（184613ms） | issued_inline_canary | complete | PASS / advance |

i4是closure-only轮：agent跑 `--sync-closure` 使 `summary.closure_status=closed`，completion probe（[phase-completion-probe.ts](../../harness/scripts/utils/phase-completion-probe.ts):81 判 closure → [agent-invoke.ts](../../harness/scripts/utils/agent-invoke.ts):1341 `DEFAULT_COMPLETION_GRACE_MS=5_000` 宽限后 tree-kill）把claude进程杀掉，inline canary答卷（[vision-canary.buildInlineCanaryBlock](../../harness/scripts/utils/vision-canary.ts):170 要求写在终态输出**末尾**）从未产生，exit_code=1。runner判卷 [resolveCanaryCacheDecision](../../harness/scripts/utils/vision-canary.ts):439 见 `exitCode!==0` 直接判"invoke 非零退出"、不判卷 → 回执 not_issued。

后置harness的 `ui_spec_fidelity_gate`（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):307）调 [verifyVlSigningChain](../../harness/scripts/utils/critic-receipt-producer.ts):226，缺capability receipt即返回 `fail`（:267）→ BLOCKER FAIL → i5重跑。**该轮的三张参考图都Read过、refs回执 complete**——被拒的是"这次调用能看图"的证明，不是材料证据。代价：i4整轮白烧约6.7分钟 + i5重跑约3.4分钟。

同根因的另一面在08-15 run `20260815T070732Z-013297`（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):3262 注释在案，codex返修 finding 11 纠正原写的 :3269）：closure轮不重读图 → refs回执partial → 终签结构性拒收 → `content_retry_exhausted`。因此runner在每个spec invoke结束后**先删两张回执再重签**（goal-phase-runtime.ts:7607–7612），closure轮必须重新答题、重新逐图Read（[buildClosureVisualEvidenceBlock](../../harness/scripts/goal-phase-runtime.ts):3273 的 `structured_events` 变体）。

**待核实（不影响结论）**：i4 走到 closure 的具体动作是不是 `--sync-closure`，goal events 里没有对应事件行——已确认的是 `phase_verdict.completion_observed=true` 与 `agent_invoke_end.kill_attempted=true`（probe 观察到 closure 后动手）。核实命令：在宿主只读跑 `node -e "..."` 扫 `phases/spec/agent-output.log` 的 `sync-closure` 字样（该日志逐轮覆盖，只剩 i5，故大概率已不可得——若不可得即维持"probe 因 closure 收口"这一已证事实，不臆造触发方式）。

i5之所以没被杀：会话内harness因 `spec-i5` 回执尚未签发（回执只在invoke**结束后**签）而FAIL，agent收不了口，只能答完题自然退出——回执生产时机与阶段内门禁互为前提。

## 2. 非目标

- 不改completion probe/grace/kill与其接线（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):7084）；不为等待答卷改进程生命周期。
- 不改独立 [visual-provider-invoke](../../harness/scripts/utils/visual-provider-invoke.ts)（`projectVisualProviderBody`:332 消费**自身**终态正文，与phase completion probe无关）。
- 不改preflight金丝雀的出题/渲染/TTL/采信谓词（[multimodal-probe.ts](../../harness/scripts/utils/multimodal-probe.ts) 的 `isVisionCanaryFresh` / `canaryAdmissibleForExecution` / `isFreshCanaryForExecution` 一字不动），不改交互态金丝雀。
- 不新增签名系统、manifest、账本、人签、视觉provider或adapter能力声明；不凭模型名改声明。
- 不改视觉质量判据本身（`vision_output_counterevidence`、`visual_diff_*`、fidelity钳制、OCR预扫）。
- 不重构UT/报告/进程复用（B03）、不动B01已交付的回修链。

## 3. 决策纪要

### D0：保留的真源与状态

保留：run级preflight金丝雀缓存（`framework.local.json` 的 `vision.canary`，由 [decideVisionCanaryProbe](../../harness/scripts/utils/goal-preflight.ts):320 判重探、[runVisionCanaryProbe](../../harness/scripts/utils/goal-preflight.ts):388 实测）；`vision/spec-refs-receipt.json` 的路径与所有权（runner写、消费面只读）；`ui_spec_fidelity_gate` / `vision_output_counterevidence` 两个check id与既有严重度阶梯；`resolveEffectiveVisionContext` 的override→canary→adapter声明三级；`capabilityAdvisory.hasVision` 的取值链（冻结capability snapshot）。删除只发生在**invoke级**证据层。

### D1：删除invoke级inline canary全链，能力真值回落run级金丝雀

已核实 `readCapabilityReceipt` 只有两个消费者：[verifyVlSigningChain](../../harness/scripts/utils/critic-receipt-producer.ts):265，以及 [effective-vision-context.resolveCapabilityAxis](../../harness/scripts/utils/effective-vision-context.ts):123–141 的 `invocation_bound` 分支。而后者的两个生产调用方——[harness-runner.resolveCurrentVisualForHarness](../../harness/harness-runner.ts):223 与 [fidelity-governance-check.describeClampCause](../../profiles/hmos-app/harness/fidelity-governance-check.ts):38——**都不传 `invokeId`**，该分支对它们恒不生效。删除后这两处行为逐字不变。

删除清单：

| 落点 | 删除内容 |
|---|---|
| [vision-canary.ts](../../harness/scripts/utils/vision-canary.ts):170 | `buildInlineCanaryBlock`（`buildCanaryPrompt`:148、`renderCanaryImage`:119、`generateRandomCanaryAnswerKey`:95、`resolveCanaryCacheDecision`:424 由preflight探测继续使用，**不动**） |
| [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):6422–6434 | `inlineCanaryKey`/`inlineCanaryBlock` 出题与渲染；:6608 prompt拼接改回 `buildPhasePrompt(...)` 单项 |
| goal-phase-runtime.ts:7607–7612 | 两张回执的invoke后 `rmSync` 清理（顺序信任前提随D2一并取消） |
| goal-phase-runtime.ts:7626–7690 | 整段判卷、`writeCapabilityReceipt`、`capability_receipt` 事件与三条console分支 |
| [effective-vision-context.ts](../../harness/scripts/utils/effective-vision-context.ts):34–44、64–66、76–108、123–141 | `CapabilityReceipt` 类型、`capabilityReceiptPath`、`readCapabilityReceipt`、`writeCapabilityReceipt`、`invocation_bound` 分支；`VisionCapabilityScope` 去掉 `'invocation_bound'`、`VisionCapabilityAxis.evidence.binding_path` 随之删除 |
| [critic-receipt-producer.ts](../../harness/scripts/utils/critic-receipt-producer.ts):265–277 | capability receipt的存在性/verdict/run/invoke/adapter五项校验；`VlSigningChainResult.capReceipt` 字段 |

能力真值改由现成resolver给出：`verifyVlSigningChain` 调 `resolveEffectiveVisionContext({projectRoot, feature, runId, adapter: runAdapter, modelPin: process.env.MAISON_GOAL_MODEL_PIN})`，要求 **`scope === 'run_probed'` ∧ 该 axis 来源为 probe ∧ `verdict ∈ {tool_read, native}`**；否则失败项写"本run无实测视觉能力（`scope=<x>`、`verdict=<y>`、`source=<probe|override|adapter声明>`）"。不新写谓词——canary分支内部已是 `isVisionCanaryFresh ∧ canaryAdmissibleForExecution({runId, modelPin})`（[effective-vision-context.ts](../../harness/scripts/utils/effective-vision-context.ts):159–173），与 `decideVisionCanaryProbe` 的重探判据同源，goal run内金丝雀必属本run。

**codex返修（finding 1，已逐行核实）**：`scope === 'run_probed'` **不等于实测**。[effective-vision-context.ts](../../harness/scripts/utils/effective-vision-context.ts):150–157 的 `image_input_override` 分支无条件返回 `run_probed` + `tool_read`/`native`，而 [goal-preflight.ts](../../harness/scripts/utils/goal-preflight.ts):344–346 见 override 即 `skip: 'local_override_present'` **不探测**——原谓词会在本run零金丝雀证据时放行终签，并按D4把它披露成"run级实测"。故采信条件追加"来源为probe"一项：canary分支是唯一写 `evidence.canary_probed_at` 的分支（:166–172），override分支只写 `reason`，**判源无须新增字段**。override在场且本run无probe缓存 → 归D7的"未验证（未实测，不可终签）"，`details`/`suggestion` 文案不得出现"实测"二字。不改 `decideVisionCanaryProbe` 的跳探逻辑（§2非目标；override的语义本就是"用户要求跳过探测"）。

同轮核实到的第二件事：`canary.verdict` 值域只有 `tool_read | ocr_capable | none`（[framework-local-config.ts](../../harness/scripts/utils/framework-local-config.ts):31），resolver把 `ocr_capable` 映射为 `unknown`（effective-vision-context.ts:165）——因此 `native` 在probe路径**当前不可产**，加上"来源为probe"后可接受集合实际只剩 `tool_read`。仍按裁决把 `native` 留在集合内：将来探测协议若支持 `native_attach`，谓词无须再改；本批不为此写任何代码，也不在文案里宣称有两条活路径。

`adapter_model_observed`（goal-phase-runtime.ts:7329–7364）保持现状：只发事件、只投影goal-report，不参与能力判定与任何门禁——本批不加一行。探测失败/未答仍走既有 `resolveCanaryCacheDecision` 的 `invoke_failed`/`invalid_answer` 两类，**不写盘、不缓存 none**（现状即如此，本批只是不再另建第二套判卷）。

**放弃的准确性**：①能力证据的粒度从"这一次调用能看图"退到"这个run实测能看图"。同一run内若CLI在中途被切到盲模型，签名不再当场察觉；本框架已有的兜底是 `pin_verify_mismatch` 告警（telemetry，不阻断）与 `vision_output_counterevidence` 的产物反证。②设了 `vision.image_input_override` 的用户，其 `vl_multimodal` 终签**结构性不可达**（override跳探 → 无probe缓存 → 能力条件不成立），出路与非goal同款：诚实 `verified: unverified`，软档WARN继续、hard pixel contract仍FAIL；要终签就删掉override让preflight实测一次。这是把"用户自我声明"与"机器实测"分开的代价，本批接受——override本来就只该影响能力路由（要不要按盲档工作），不该充当终签证据。换来的是：金丝雀不再与业务产出争抢同一次调用的终态输出末尾，收口即被杀的轮次不再因此拒签。

### D2：参考图读取记录改绑材料，不绑invoke

[SpecRefsReceipt](../../harness/scripts/utils/critic-receipt-producer.ts):92 改为按材料寻址：

- 顶层保留 `schema_version`（升 `'1.1'`）、`adapter`、`goal_run_id`、`produced_at`、`refs`、`unread`、`attestation`；**删除顶层 `invoke_id`**。
- `refs[]` 由 `{path, hash, read}` 扩为 `{path, hash, read, read_at_invoke?}`——`read_at_invoke` 记录该图**首次**被观察到Read的invoke id，供D4诚实标注。
- **loader版本处理（codex返修 finding 4，已核实）**：[loadSpecRefsReceipt](../../harness/scripts/utils/critic-receipt-producer.ts):107–116 现在**只接受 `'1.0'`**，原施工清单漏了它——不改则升1.1后自己读不出自己刚写的回执，终签恒失败。改为**只接受 `'1.1'`**：`'1.0'` 与任何其它值一律返回 `null`（等价"无回执"）。两个消费点因此同时收口：`verifyVlSigningChain` 走"无回执"分支；`produceSpecRefsReceipt` 的合并读到 `null` 即从零重算，**不会**把旧1.0结构（无 `read_at_invoke`、语义是invoke绑定）当本run记录继承。旧1.0残留不靠 `goal_run_id` 作废——同run resume时盘上残留的1.0回执 `goal_run_id` 恰好等于本run，只有版本判据挡得住（V8覆盖该场景）。不写迁移脚本：回执是每轮可重算的派生物，重算成本=一次事件日志解析。

[produceSpecRefsReceipt](../../harness/scripts/utils/critic-receipt-producer.ts):124 改为合并生产：先算每张图的当前内容哈希；若盘上已有回执（经 `loadSpecRefsReceipt` 读取，schema 版本判据见上一条 bullet）且 `goal_run_id` 与 `adapter` 均等于本次，则对每张图 `read = 旧entry.read && 旧entry.hash === 当前哈希 || 本invoke的Read事件命中`（旧记录只在**内容未变**时继承，图换了就作废重来），`read_at_invoke` 沿用旧值或写本次invokeId；否则从零算。产出**总是**覆盖写（不再"先删后签"），`unread` 按合并后的结果重算。

**codex返修（finding 3，已核实）：Read命中改为规范化完整路径匹配。** 现状 critic-receipt-producer.ts:150 是 `r.abs === abs || r.base === base`——**同basename即算读过**，而随后 :153 哈希的是目标图本身。于是"读了 `tmp/1-home.png`、签了 `ux-reference/1-home.png` 的哈希"成立；D2的跨invoke继承还会把这条错误记录一路带下去（内容没变就一直继承）。改为删掉 basename 兜底，只保留完整路径等值，并同步改写 :123 的函数头注释（"或尾段（basename）一致"这句连同语义一起删）。**路径归一**：`path.resolve` 后，`process.platform === 'win32'` 时再 `toLowerCase()`——本仓无导出的通用 `pathsEqual`（已查：[native-trace-binding.ts](../../harness/scripts/utils/native-trace-binding.ts):66 的 `samePath` 与 [device-session.ts](../../harness/scripts/utils/device-session.ts):200 的 `normalizeExe` 都是模块私有），为一处比较不新建共享工具，就地写两行私有 helper 供本文件的 Read 匹配复用。**放弃的准确性**：Windows 上仅大小写不同的两个真实文件会被判同一张（NTFS 默认不区分大小写，实际不可构造）；Linux 保持严格等值。验收补"同名、异路径、异内容"负例（详见V3）。

**codex返修（finding 2，已核实）：attended 执行模式不生产 refs 回执。** 事实链：runner 的阶段日志路径是**按phase固定**的 `phases/<phase>/agent-output.log`（[goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):6729），`agent-events.jsonl` 由它派生；截断（`flags:'w'`）只发生在 detached 的 [agent-invoke.ts](../../harness/scripts/utils/agent-invoke.ts):1219，attended 走 [AttendedGoalPhaseExecutor](../../harness/scripts/utils/goal-phase-executor.ts):104–124 的 `phase_execute_request`，**不碰这两个文件、stdout恒为空串**；而回执生产块（goal-phase-runtime.ts:7700–7734）只判 `!dryRun && phase==='spec' && provenance==='structured_events'`，**不判执行模式**。同一run内 process→session 的所有权切换是可达的（[goal-run-control.ts](../../harness/scripts/utils/goal-run-control.ts):149–195 的 CAS：前任 process owner 已 released/进程已死即可被 session 接管）。合起来：detached 轮跑完后切 attended 再跑一轮，盘上仍是**上一轮 detached 的** `agent-events.jsonl`，`produceSpecRefsReceipt` 会把它当本轮审计，与"替换后的新图哈希"组合出一张看似完整的新回执——遗留日志被重签成新材料的证据。改法：生产块的守卫追加 `executorMode === 'detached'`（该变量在同一作用域已在用，见 :6707），attended 直接发 `spec_refs_receipt_produced` 事件 `status:'skipped'` + `reason:'attended_no_invoke_audit'` 并打印一行，不写盘、不覆盖既有回执。D5据此把attended的证据轴写成"无逐图审计 → 未验证（结构性不可达）"。

[verifyVlSigningChain](../../harness/scripts/utils/critic-receipt-producer.ts):226 相应裁剪：

| 保留 | 删除 |
|---|---|
| goal run/attempt身份在场（:244，非goal仍不可签，见D5） | capability receipt全部五项（D1） |
| `refsReceipt.goal_run_id === runId` | `refsReceipt.invoke_id === 'spec-<attempt>'` 精确等值（:287–289） |
| `refsReceipt.adapter === runAdapter` | 整段 `events.jsonl` 最后一条runner事件锚 + `receipt_sha256` 比对（:295–320）；随之删 `sha256FileFull` 的两处调用与 `GoalRunEventLite` |
| `unread.length === 0` | — |
| 分母重算（manifest驱动的 `resolveRequirementReferenceImages`，fail-closed）与逐图 `read===true` + `hash` 等值（:321 起） | — |

runner侧 `spec_refs_receipt_produced` 事件保留（审计投影），`receipt_sha256` 字段保留（诊断用），但**不再有消费者**校验它。不做跨run复用：`goal_run_id` 仍精确等值。

**放弃的准确性**：①后续轮改了产物却没重读图，签名仍成立——由材料哈希兜底（图变即失效）与 `vision_output_counterevidence`（材料寻址的产物反证）承担质量结论，签名只声明"本run读过这些字节"；②"runner恒最后写"的顺序信任防伪不再成立，agent在invoke窗口内伪造 `vision/spec-refs-receipt.json` 不会被事件锚拆穿。按总原则"防篡改不是优先级"接受；换来的是closure轮与被中断轮不再结构性拒签，且删掉一整套事件锚校验。

### D3：closure轮不再强制逐图重读

[buildClosureVisualEvidenceBlock](../../harness/scripts/goal-phase-runtime.ts):3273 逐处改写（**codex返修 finding 5 补全，行号已核实**）：

| 行 | 现状 | 改法 |
|---|---|---|
| :3282 | `'## Mandatory read-only visual evidencing for THIS invocation (spec closure — REQUIRED)'` | 与 `'none'` 变体统一为不含 REQUIRED/THIS invocation 的标题（如 `'## Read-only visual evidencing (spec closure)'`）——原施工清单漏了它 |
| :3285–3286 | `'FROZEN applies to artifacts, NOT to read-only evidencing. The vl_multimodal final sign-off is'` / `'invocation-bound: it only accepts reference images actually read during THIS invocation.'` | **两分支公共句**，D2生效后第二句是假的。第一句（FROZEN豁免只读取证）保留，第二句改写为"本run内读过且内容未变的参考图即可采信；改动过的图必须重读" |
| :3289–3290 | `'Before filling the receipt, read EVERY authoritative reference image below…'` 两句强制文案 | 删（原清单已列） |
| :3304 | `'Skipping any image leaves the refs receipt partial and fails ui_spec_fidelity_gate for this attempt.'` | 删（原清单已列） |

保留：图片清单、FROZEN豁免句、`'none'` 变体的诚实unverified整段。验收在**最终拼装的 prompt** 上断言不含 `Mandatory`/`REQUIRED`/`only accepts reference images actually read during THIS invocation`/`read EVERY authoritative`/`Skipping any image` 五串（不只断言helper返回值）。**既有测试须同步改写**：[goal-runner-phase.unit.test.ts](../../harness/tests/unit/goal-runner-phase.unit.test.ts):639–655 现在正断言 `'Mandatory read-only visual evidencing for THIS invocation'` 与 `'ui_spec_fidelity_gate'` 在场——改成断言新文案与上述五串缺席，属本批必改项，不是回归。

`resolveClosureReadRequirement`（:3250）与二态入参保留——它仍决定要不要追加unverified段落；只是 `'structured_events'` 分支从"追加强制块"退化为"不追加额外要求"。调用点（:6676–6684）不动。

**放弃的准确性**：结构化adapter的closure轮不再被提示重读，若参考图在两轮之间被人替换且agent没重读，`hash` 比对会判 unread → 拒签（这是正确行为，但提示词不再提前劝阻，agent多绕一轮）。换来的是删两段互相矛盾的提示词（FROZEN说别动、下一句要求必须读满）。

### D4：诚实标注证据来自先前invocation

不新增文件、不新增签名字段。三处一句话：

1. `produceSpecRefsReceipt` 的返回值增 `carriedOver: string[]`（本轮未观察到Read、但沿用了本run先前invoke记录的图；元素取展示用basename，**匹配一律走完整路径**，见下文 finding 3）；runner在 `spec_refs_receipt_produced` 事件增 `carried_over: number`，并在既有console分支打印一行。
2. `VlSigningChainResult` 增 `carriedRefs: string[]`（由 `refs[].read_at_invoke !== 'spec-<attempt>'` 派生）。
3. `ui_spec_fidelity_gate` 的PASS `details`（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):335）改写：删掉已不存在的 `chain.capReceipt!.binding_path` 与"runner 事件锚"字样，改为 `能力=run级实测金丝雀（verdict/scope）+ refs 验读 N 张（逐张 hash 核对）`，`carriedRefs` 非空时追加"其中 M 张读取记录来自本 run 先前 invocation（内容未变）"。

**codex返修（finding 7，已核实）：披露必须自己接一条线，"随summary/goal-report自动可见"是假的。** 核实结果：①`writeRunSummaryBase` 只投影 blockers / `*_run_status` / BLOCKER级WARN / BLOCKER级SKIP 等特定状态，[harness-runner.ts](../../harness/harness-runner.ts):2574 的注释明写 **"summary.json 不收 PASS check"**——`ui_spec_fidelity_gate` 走PASS时 `details` 不进 summary；②[goal-report-generator.ts](../../harness/scripts/utils/goal-report-generator.ts):485–506 的逐phase注记行只渲染 `timeout_advisory` 与 `pin_verify_mismatch` 两类事件，`spec_refs_receipt_produced` 不被渲染；:63–96 的 `buildWarnDigest` 只取WARN。故 `carried_over` 若只落 gate 的 PASS `details`，操作者在 goal-report 里一行都看不到。

取**最小接线**（裁决口径）：披露落在既有 `spec_refs_receipt_produced` 事件的 `carried_over` 字段（上文第1条），并在 goal-report 的**既有**逐phase注记行里加一类（与 `↳ 预算提示`、`↳ 模型核验` 同一段、同一写法）：`carried_over > 0` 时渲染 `| ↳ 参考图读取 | … | 本轮沿用本run先前invocation记录 N 张（内容未变） | — |`。**不新增** check id、不新增WARN、不新增summary字段、不新增readiness signal。验收（V2）断言**实际生成的 goal-report.md 文本**含该行，不是断言事件对象。

### D5：非goal与attended的可达证据路径

不伪造goal身份、不伪造stdout。评估结论：

- **非goal**：`verifyVlSigningChain` 无 `MAISON_GOAL_RUN_ID`/`ATTEMPT` 即失败（:244）。refs回执由runner从 `agent-events.jsonl` 审计产生，非goal无runner编排——没有任何进程会调用 `produceSpecRefsReceipt`，**结构性不可产**（盘上即便残留旧回执也无碍：无 run/attempt 身份在 :244 先被拒）。因此 `vl_multimodal` 在非goal保持不可达，本批不改这条。可达路径是：产物诚实写 `verified: unverified` → 软档（`warn`/`reachable`）WARN继续 → 质量结论由材料寻址的verifier视觉维度 + 确定性检查（`vision_output_counterevidence`、`visual_diff_*`、`ux_reference_mapping`）承担，与总plan裁决3一致。hard pixel contract在非goal仍FAIL，出路只有两条且必须写进文案：改用goal编排（structured adapter）跑该阶段，或以correction/successor run冻结新需求把保真合同降档——已核实 `--fidelity` **只升不降**（[goal-manifest-cli.ts](../../harness/scripts/utils/goal-manifest-cli.ts):17）且 `fidelity_receipt` 已退役（[goal-manifest.ts](../../harness/scripts/utils/goal-manifest.ts):274），不得再指向它。
- **attended**：[AttendedGoalPhaseExecutor](../../harness/scripts/utils/goal-phase-executor.ts):120 的 `stdout` 恒为空串——删掉inline判卷后，runtime不再对它跑任何答卷解析（D1顺带解决F05的一半）。
  - **能力轴：仅无pin场景可达（codex返修 finding 10，已核实）**。`decideVisionCanaryProbe` 在attended被当dry-run跳过（goal-phase-runtime.ts:5073），但 `canaryAdmissibleForRun` 对 `probed_via='interactive'` 不绑run，故IDE会话内跑过交互态金丝雀（[vision-canary-interactive.ts](../../harness/scripts/utils/vision-canary-interactive.ts)）即可让 `scope='run_probed'` 成立——**前提是本run没有model pin**。交互金丝雀写盘时 `model` 固定为 `'unknown'`（vision-canary-interactive.ts:154–164，注释里就写着"交互探测同样证不了模型路由"），而 [multimodal-probe.ts](../../harness/scripts/utils/multimodal-probe.ts):101 的 `canaryAdmissibleForExecution` 在pin在场时要求 `canary.model === modelPin` 精确等值。**因此 `--adapter-model-pin` 在场的attended，即使自测卷答全对也到不了 `run_probed`**，能力轴与证据轴同时不可达。不改谓词（pin的语义就是"我要这个模型的证据"，用 `'unknown'` 充数等于把pin作废）；D7的"未验证"文案在有pin时须说清是哪一条不成立。验收补有pin/无pin对照（V5）。
  - **证据轴：不可产**。原提纲写的理由是"attended无 `agent-events.jsonl`"——**该理由不成立且危险**（见D2 finding 2：阶段日志路径按phase固定，同run先前detached轮的事件文件仍在盘上）。正确理由是：attended轮**不产生**本invoke的工具事件，runner据此拒绝审计任何非本invoke产生的日志，主动跳过回执生产 → 与非goal同一诚实出口。
- **Codex（X格）**：[adapter.yaml](../../agents/codex/adapter.yaml):27 `image_input: none`、:60 起 `tool_event_provenance` 刻意缺省 `none` → 无逐图Read审计、refs回执结构性不可产。既有 `'none'` 变体文案（D3保留）与capability block的none-provenance段（goal-phase-runtime.ts:1443–1452）已是正确出口，本批不改。

`buildUnattendedExecutionBlock` 在 `buildPhasePrompt`（:3444）无条件注入的模式提示归B03，本批不动。

**放弃的准确性**：非goal与attended拿不到 `vl_multimodal`，其UI保真结论的强度低于goal态一档。换来的是不为补充格造第二套证据机制、不引入可被模型合成的CLI/env旁路。

### D6：设备侧critic_run_id延后

[visual-diff-check.ts](../../profiles/hmos-app/harness/visual-diff-check.ts):1997–2001 的 `critic_run_id !== \`${RUN_ID}-${ATTEMPT}\`` 确是同款"invoke等值"模式，但**不纳入本批**，理由三条（已核实）：①后果不同——它落到 `attErr` 分支（:2046–2058），只把 `receiptProvenance` 降为 `unverified` 并发 MAJOR WARN，不是BLOCKER FAIL，不制造重跑循环；②生产时机不同——`produceCriticReceipt` 在每个testing invoke结束后由runner从**本轮**events重签（goal-phase-runtime.ts:7572 起），不要求agent重新答题；③无宿主实证。

**codex返修（finding 11，已核实）：原②的后半句"被中断轮也会拿到当轮attempt的回执"过强，删除。** [produceCriticReceipt](../../harness/scripts/utils/critic-receipt-producer.ts) 有三处 `produced:false` 早退——:414 事件日志不存在、:436 无finalized屏（全pending/skipped）、:484 事件日志里解析不出任何图片验读记录。被中断的testing轮很容易命中后两者，此时**盘上保留的是上一轮的 critic-receipt.json**，`critic_run_id` 仍是旧 attempt → 命中 :1997 的等值判定 → `receiptProvenance` 降 `unverified` + MAJOR WARN。所以延后的真实理由是**"后果只是WARN降级、不制造重跑循环"（理由①）**，而不是"回执一定会被重签"。理由②收窄为"生产时机与spec侧不同：不要求agent重新答题，因而没有spec侧那种'收口即被杀→无答卷→拒签'的死锁形状"。裁决不变（延后），但依据改为条件性重签。改它属于扩大视觉系统改动面而无事故驱动。**重新登记条件**：宿主出现testing期因该等值判定造成的重跑或误降级证据，转B06与设备格差异验收一并处理，并在此处记明。本批如实承认spec侧与设备侧从此口径不一致。

### D7：四态文案

`ui_spec_fidelity_gate` 的失败分支（spec-ui-spec-check.ts:309–326）按四态出词，不新增check id、不改严重度阶梯：

| 态 | 判据 | 文案与出路 |
|---|---|---|
| 未验证（结构性不可达） | **只由执行形态与审计能力判定**：无goal run/attempt身份（非goal，既有 :244）∨ attended（run-control `owner.kind==='session'`）∨ 该adapter无注册的结构化事件解析器（`hasImageReadParser(runAdapter)===false`，等价 `tool_event_provenance != structured_events`） | "vl_multimodal 在本执行形态结构性不可达"；出路=诚实改 `verified: unverified`（软档WARN继续、hard contract仍FAIL），并指出goal+detached+structured才可达 |
| 未验证（未实测，不可终签） | 执行形态可达，但本run无probe产生的金丝雀缓存（含 `image_input_override` 在场、缓存过期/属旧run/pin失配、verdict非 `tool_read`） | "本run未实测视觉能力"（**不得写"实测"结论**）；出路=删掉 `vision.image_input_override` 让preflight实测一次 / 重跑使金丝雀刷新 / 诚实改 unverified |
| 尚未生成 | 执行形态可达、能力条件成立，但盘上无refs回执（或版本非1.1） | "本轮回执尚未生成"；出路=**写完交回runner，外层gate会重算**——回执在invoke结束后由runner签发（goal-phase-runtime.ts:7700 起），阶段内agent自跑harness时首轮必然还没有它 |
| 验证不通过 | 有refs回执但材料核对失败：`unread>0`、逐图 `hash` 失配、分母未覆盖、adapter/run失配 | "当前证据与材料不符"；出路=补读缺的图/核对参考图是否被替换 |

外加一条**非gate**的说明面（不占表行）：invoke非零退出/被kill且本轮未产出新回执时，由runner在console与 `spec_refs_receipt_produced` 事件的 `status:'skipped'` + `reason` 说明；D2生效后沿用本run既有读取记录即可签，gate侧不新增分支。

**codex返修（finding 6，已核实）：原表把"无回执"直接等同于结构性不可达，会在正常goal首轮误告"执行形态不支持"。** 事实：回执在invoke**结束后**才生产（goal-phase-runtime.ts:7700–7734），而阶段内agent自跑的harness已经会读它（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):307 → `verifyVlSigningChain` :278–285）——正常Claude goal的第一次 spec invoke 里，回执必然缺席。让它读到"你这个执行形态不支持vl_multimodal，去改unverified"，等于教模型在**可达**的形态下自降档。

判据来自 `VlSigningChainResult.failures` 的既有内容分类，实现为 `verifyVlSigningChain` 给每条failure打一个 `kind: 'unreachable' | 'not_probed' | 'not_yet' | 'mismatch'` 标签，gate按 `failures` 中最严重的一类选词（`unreachable` > `not_probed` > `not_yet` > `mismatch`）。不新增第三套校验器。

**执行形态的判据来源（已核实，不新增env）**：attended的唯一可靠机内信号是 run-control 的 `owner.kind==='session'`——gate harness 是runner直接spawn的，attended/detached两种模式下**都**被注入 `MAISON_GOAL_RUN_ID/ATTEMPT`（goal-phase-runtime.ts:1208–1222），单看env区分不了。`verifyVlSigningChain` 里用既有 [readRunControl](../../harness/scripts/utils/goal-run-control.ts):114（B01 已在 harness-runner.ts:2354–2366 用同一读法判外层是否会重跑，属既有先例）读一次 `goal-runs/<runId>/run-control.json`，读不到/字段非法一律按 detached 处理（不因诊断分类失败而改变终签结论）。不新增 `MAISON_GOAL_EXECUTOR` 之类env——注入面每多一个键就多一处大小写清理纪律。

**[high] `owner.kind` ⟺ attended 只成立一半，须补反向约束（第2轮 plan review，已逐行核实）**：runtime 入口 [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):4166 只有 `runtimeOwnerKind === 'session' && executorMode !== 'attended'` 一条拒绝分支——它禁的是 `session + detached`，**未禁 `process + attended`**。而 `--runtime-executor` / `--runtime-owner` 是两个独立的显式入参（:4155–4165），host bridge 传 `--runtime-executor attended --runtime-owner process` 即可进入 runtime，`owner.kind` 落 `'process'`。此时 D7 新引入的 owner 判据判不出 attended：同一 run 若已有本run有效 probe 金丝雀、且盘上有内容未变的 1.1 refs 回执（D2 允许跨invoke继承），gate 会把**先前 detached 轮**的读取记录当本轮证据终签——与 D5/D7"attended 结构性不可达"的裁决直接矛盾。**修正**：在 runtime 入口既有那段守卫处补一条反向约束 `executorMode === 'attended' ⇒ runtimeOwnerKind === 'session'`（不满足即 `BLOCKER` 拒绝启动并说明"attended executor 必须配 session owner；detached 只能配 process owner"），使双向蕴含真正成立；V5 增加 `{executor:'attended', owner:'process'}` 的拒绝启动用例。这是 D7 把 `owner.kind` 升格为终签判据带来的**配套约束**——原先 owner 只用于 run-control 生命周期，判错只影响接管语义；现在它承载证据可达性，方向缺一半就是可绕过的旁路。不改 owner/executor 的语义与既有 `session + detached` 分支文案。

### D8：规格与文档同步

创建最小OpenSpec change `vision-evidence-material-binding`，只改行为涉及的条款：

| spec | 修改 |
|---|---|
| [visual-capability-routing](../../openspec/specs/visual-capability-routing/spec.md):8 | **（codex返修 finding 9 补入）** 规范性正文 "…and an admissible current-run/current-invocation capability receipt" 仍以 capability receipt 定义能力来源，D1删除后该条款失去实现——改为"当前adapter探测 + 本run probe产生的金丝雀"，删 `current-invocation capability receipt`；`Enforcement` 行的三个文件不变（仍是 effective-vision-context / goal-preflight / goal-runner） |
| visual-capability-routing:15 | 场景 THEN 删 "MAY issue a new inline canary"（保留"下一次attempt仍按当前probe/canary报告视觉能力"） |
| visual-capability-routing:28 | requirement 标题与正文 "Multimodal verification uses current invocation evidence" → 当前**run**能力实测 + 材料寻址的参考图读取记录；:34 场景的 "passes its canary" 相应改为 run 级口径 |
| [goal-runner](../../openspec/specs/goal-runner/spec.md):1183 | "Spec closure-only prompts mandate read-only visual re-evidencing" 整条改为"closure prompt列出参考图并声明FROZEN不含只读取证"，删除"invocation-bound，MUST NOT be satisfied by reusing a previous invocation's refs receipt" |
| goal-runner:1905 | "Inline canary signing consumes the shared canary decision SSOT..." 整条REMOVED（能力真值改run级金丝雀；capability/auditability分轴的结论移入 harness-gates 那条保留） |
| [harness-gates](../../openspec/specs/harness-gates/spec.md):2033 | refs回执分母条款补：绑定 `run_id`+内容哈希+adapter、跨invoke并集、四态文案（不可达/未实测/尚未生成/验证不通过）；分母算法与WARN/FAIL阈值不变 |
| [feature-artifact-layout](../../openspec/specs/feature-artifact-layout/spec.md):201 | 去掉 `capability-receipt.json`，只留 `spec-refs-receipt.json` |

文档最小改动：[skills/feature/spec/SKILL.md](../../skills/feature/spec/SKILL.md):46 与 [reference/ui-spec.md](../../skills/feature/spec/reference/ui-spec.md):204 的"逐张读图 → refs receipt → 终签"补一句"本run内读过且图未变即可，closure轮不必重读"；[spec-workflow-detail.md](../../skills/reference/spec-workflow-detail.md):47 的"当前 hash-bound"口径本就正确，不动。[MIGRATION.md](../../MIGRATION.md) 增一节说明 `capability-receipt.json` 停止产出（旧文件残留无害、消费者已删）与 `spec-refs-receipt.json` schema 升 1.1（**loader只接受1.1**，旧1.0一律视同无回执并重算——不能靠 `goal_run_id` 作废：同run resume时它恰好等于当前run；无需迁移脚本，回执是每轮可重算的派生物）。

## 4. 文件与提交边界

S0至S3是可审查提交/变更组，不要求自动git commit。

| 组 | 文件/函数 | 内容与验证 |
|---|---|---|
| S0 删除组 | vision-canary `buildInlineCanaryBlock`；goal-phase-runtime 6422–6434 / 6608 / 7607–7612 / 7626–7690；effective-vision-context 回执三件套与 `invocation_bound` 分支；critic-receipt-producer 265–277 | D1纯删除；两个 `resolveEffectiveVisionContext` 调用方行为逐字不变可断言 |
| S1 材料绑定组 | critic-receipt-producer 的 `SpecRefsReceipt`/`loadSpecRefsReceipt`（只收1.1）/`produceSpecRefsReceipt`（合并生产 + 完整路径匹配）/`verifyVlSigningChain`；goal-phase-runtime 7700–7734 的事件字段与 `executorMode==='detached'` 生产守卫 | D2/D4合并生产与校验裁剪；跨invoke并集、图变作废、同名异路径不算读、attended不生产、carried_over披露 |
| S2 消费面与文案 | spec-ui-spec-check `ui_spec_fidelity_gate` 四态与PASS details；check-spec `vision_output_counterevidence` 的chain披露句（:447 起，两分支均PASS，只改措辞）；goal-phase-runtime `buildClosureVisualEvidenceBlock`；goal-report-generator 逐phase注记行加 `carried_over` 一类；spec SKILL/ui-spec.md | D3/D5/D7；四态可读、非goal与attended出路写全、carried_over在goal-report可见 |
| S3 规格与验收 | OpenSpec change `vision-evidence-material-binding` **四份**delta（visual-capability-routing / goal-runner / harness-gates / feature-artifact-layout，共七处条款——codex返修 finding 9 纠正原写的"五份"：goal-runner 在D8表里占两行是同一份spec的两条requirement）、MIGRATION、既有测试扩展 | D8与命令表；不夹带B03至B06生产改动 |

扩展现有 `vision-canary`、`effective-vision-context`、`critic-receipt-producer`、`visual-fidelity`、`ui-spec`、`host-runtime-truth`、`goal-runner-phase`、`goal-phase-runtime`、`goal-canary-pin-binding-d7f3a9c4`、`goal-runner-testing-integrity` 单测，不新增测试框架、不新建套件。归位（已核实各套件既有import面，避免为一条断言另建套件）：V2的goal-report文本断言与V4的能力来源矩阵进 `goal-canary-pin-binding-d7f3a9c4`（它已同时import `generateGoalReportMarkdown` 与 `checkUiSpecFidelityGate`）；V5的attended bridge进 `goal-runner-testing-integrity`（`runGoalRuntimeChain({executorMode:'attended'})` 已就位）；V3的路径匹配与V8的1.0残留进 `critic-receipt-producer`；D3的prompt断言改写 `goal-runner-phase`:639–655。

## 5. 接受的准确性边界

| 取舍 | 接受的边界 | 仍须保证 |
|---|---|---|
| 能力粒度run级（D1） | run中途换模型不当场察觉 | 金丝雀实测仍是唯一能力真源；adapter声明不充数；`pin_verify_mismatch` 与产物反证仍在 |
| 终签只认probe来源（D1，codex finding 1） | 设了 `image_input_override` 的用户拿不到 `vl_multimodal`（结构性） | override继续决定能力路由（不按盲档工作）；出路=删override实测一次或诚实unverified；披露文案不得称"实测" |
| 读取记录跨invoke并集（D2） | 未重读图的后续轮仍带签名 | 图内容一变即作废重算；`goal_run_id` 精确等值，不跨run；Read命中改完整路径等值，同名异路径不算读 |
| Read路径比较在Windows不分大小写（D2，codex finding 3） | 理论上仅大小写不同的两个真实文件被判同一张 | NTFS默认不区分大小写，实际不可构造；Linux保持严格等值；不为此新建共享path工具 |
| 删除事件锚（D2） | 顺序信任防伪失效，伪造回执不再被拆穿 | 分母仍由冻结manifest重算、逐图hash核对、不可自缩 |
| 非goal/attended不可达（D5） | 两格UI保真结论强度低一档；attended在有model pin时**能力轴也**不可达 | 不伪造goal身份/stdout；attended不重签遗留日志（finding 2）；诚实unverified + verifier视觉维度 + 确定性检查；hard contract仍FAIL |
| 设备侧不改（D6） | spec侧与设备侧口径不一致 | 设备侧后果仅WARN降级；重新登记条件写明 |
| closure提示不再劝重读（D3） | 图被替换时多绕一轮 | hash失配仍判unread；FROZEN与只读取证不再自相矛盾 |
| 保留completion probe | 阶段尾部叙述仍可能被截断 | 截断不再造成拒签；磁盘证据与终态正确 |

## 6. 验收用例

**生产接线要求（codex返修 finding 8，已核实）**：V1/V2/V3/V5 必须贯穿 **runtime → `produceSpecRefsReceipt` → `loadSpecRefsReceipt` → 真实 `checkUiSpecFidelityGate` → phase推进**，**只允许替换外部调用（agent进程）**。现有两处替身会把这条链整段抽掉，不得作为这几条用例的证据：①[goal-runner-testing-integrity.unit.test.ts](../../harness/tests/unit/goal-runner-testing-integrity.unit.test.ts):469 的 `__testing_setRunHarnessPhase` 注入了harness替身；②[goal-run-driver.ts](../../harness/tests/helpers/goal-run-driver.ts):412 的 driver 同样把gate换成 `{verdict:'PASS'}`。

**[medium] 事后直调 gate 不构成"控制了 phase 推进"的证据（第2轮 plan review，已逐行核实）**：`runGoalRuntimeChain` 的 helper 在 :469 **无条件**安装 `__testing_setRunHarnessPhase` 替身，该替身在 :595 直接写死 `verdict:'PASS' / blocker_count:0` 的 summary 并 `exitCode:0` 返回；runtime 读的是这份替身 summary，`ui_spec_fidelity_gate` 从头到尾没进过决策路径。跑完 chain 再调一次真实 gate 只能证明"gate 对这堆磁盘状态会给什么结论"，**不能**证明"gate 的结论决定了本轮推进还是重跑"——V1（PASS 且不重跑）与 V2（签名成立并推进）恰恰要证明后者。**修正**：V1/V2 必须让**真实** `checkUiSpecFidelityGate` 在 runtime 内产生推进或拒绝结果，具体做法（无新框架、无新 seam）：

- 给 `runGoalRuntimeChain` 的 `opts` 增一个开关 `realSpecFidelityGate?: boolean`（默认 false，既有全部用例逐字不变）。开时该 helper 的 `__testing_setRunHarnessPhase` 替身在 `ph === 'spec'` 分支**先调真实** [checkUiSpecFidelityGate](../../profiles/hmos-app/harness/spec-ui-spec-check.ts):275（入参用同一 `pr`/`feat` 与真实 `CheckContext`，spec 正文读盘上的 `spec.md`）：gate 返回 FAIL → 走该 helper **既有**的 `failOverride` 路径（真实 `writeRunSummaryBase` 落 BLOCKER FAIL summary + `exitCode:1`），gate 返回 PASS/WARN/空 → 走既有 PASS summary 分支。其余 phase 与既有替身逐字不变。
- 由此 runtime 的重跑/推进判定真正由 gate 的 verdict 驱动：V1 断言 spec 轮 `exitCode` 非零被kill后**仍**推进（gate PASS）、V2 断言零读图轮凭继承记录推进；反向对照断言 gate FAIL 时 runtime 确实重跑该 phase。
- 事后直调 gate（[goal-canary-pin-binding](../../harness/tests/unit/goal-canary-pin-binding-d7f3a9c4.unit.test.ts):471 的既有用法）**降级为补充断言**，只用来核 `details`/`suggestion` 文案与四态分类，不再单独作为 V1/V2 的推进证据。V3/V4/V8 是纯判定用例（不涉推进），继续用直调 gate。
- `goal-run-driver.ts`:412 的 driver 不改（它服务 smoke/lifecycle 场景，本批不扩它的职责）；本批新增用例一律走 `runGoalRuntimeChain`。

| ID | 输入 | 必须观察到 |
|---|---|---|
| V1 | 复现i4形态：closure-only轮，refs全读、invoke非零退出被kill（detached） | `ui_spec_fidelity_gate` PASS；prompt无inline canary块；无 `capability_receipt` 事件；phase不因此重跑 |
| V2 | 复现08-15形态：closure-only轮零读图，先前invoke已读满且图未变 | 签名成立；`spec_refs_receipt_produced` **事件**的 `carried_over>0`（**不是**回执字段——回执里对应的是 `refs[].read_at_invoke`）；gate PASS details含"读取记录来自本 run 先前 invocation"；**实际生成的 goal-report.md** 含 `↳ 参考图读取` 注记行 |
| V3 | ①先前轮读满后**替换**一张参考图；②本轮Read了**同名但异路径异内容**的图（如 `tmp/1-home.png` vs `ux-reference/1-home.png`） | ①该图 `hash` 失配→判unread→"验证不通过"；②同名异路径**不算读**（finding 3），该图落 `unread`，不得因basename命中而签发；两例分母均为manifest重算全集，不缩水 |
| V4 | 本run金丝雀 `none`/`ocr_capable`/缺失/过期/属旧run；以及 `vision.image_input_override` 在场（**无论**本run有无probe缓存） | 五种金丝雀态一律签名失败并归"未验证（未实测）"；**override 在场一律归"未验证（未实测，不可终签）"**（finding 1——`scope=run_probed` 但来源非probe），文案不得出现"实测"结论。**删除原"override + 有效缓存 → 可终签"正例**（第2轮 plan review）：[effective-vision-context.ts](../../harness/scripts/utils/effective-vision-context.ts):150–157 的 override 分支**先于**canary 分支 return、根本不读金丝雀，`evidence.canary_probed_at` 恒缺席，按 D1 的"来源为probe"判据必须拒签——该正例在实现上不可构造，改为断言"override 在场 + 盘上有本run有效 `tool_read` 金丝雀"同样落"未验证（未实测，不可终签）" |
| V5 | ①非goal（无 `MAISON_GOAL_RUN_ID`/`ATTEMPT`）；②attended（经真实 `AttendedGoalPhaseExecutor` bridge，`runGoalRuntimeChain({executorMode:'attended'})`）；③**同run先detached跑一轮写出 `agent-events.jsonl`、再切attended轮并替换一张参考图**；④attended × 有/无 `adapter_model_pin` 对照 | ①②`vl_multimodal` 判"未验证（结构性不可达）"并给出goal/降档两条出路，软档WARN可继续、hard FAIL；③attended轮**不产出/不覆盖**refs回执，事件为 `status:'skipped'`+reason，绝不出现"用旧日志 + 新图哈希"的新回执（finding 2）；④无pin时能力轴可经interactive金丝雀达 `run_probed`，有pin时因 `model='unknown'≠pin` 不可达且文案说清是哪一条不成立（finding 10）；全程无答卷解析被触发 |
| V6 | Codex（`image_input: none`、provenance `none`） | refs回执不产出；closure与capability两处诚实unverified文案在场；不要求不可达终签 |
| V7 | 正常sighted+structured一次过、`verified: unverified` 常规路径、`vision_output_counterevidence` 反证/证据缺口 | 既有PASS/WARN/FAIL阶梯零回归；反证仍独立判定，不被签名改写 |
| V8 | 旧 `vision/capability-receipt.json` 与 schema 1.0 refs回执残留在盘，含**同run resume**（1.0回执的 `goal_run_id` 恰等于当前run） | 无消费者读取capability回执；1.0 refs回执被 `loadSpecRefsReceipt` 判 null（finding 4）——消费面走"尚未生成"、生产面从零重算，**不按1.0的 `read` 继承**、不崩、不误采信 |
| V9 | 用户触发的bc-openCard-1 C-U合并回归（spec→ut窗口，同时验收B01 V9） | spec正常产出与纯收口轮均可完成、不重考不拒签；B01留下的负面结果回修路径不回归；无直接回归 |

## 7. 命令与完成判据

开发仓根执行。[select-suites.ts](../../harness/tests/utils/select-suites.ts) 按 `suite.id.includes(filter)` 选套件；以下过滤串均已在 [run-unit.ts](../../harness/tests/run-unit.ts) 核对为真实登记id的子串：`vision-canary` 命中 `vision-canary`(207) 与 `vision-canary-interactive`(208) 两套；`ui-spec` 命中 `ui-spec`(133) 与 `ui-spec-schema-strict`(375) 两套；`goal-canary-pin-binding` 命中 `goal-canary-pin-binding-d7f3a9c4`(330)；其余各命中一套（`effective-vision-context` 367、`critic-receipt-producer` 136、`visual-fidelity` 134、`host-runtime-truth` 335、`goal-phase-runtime` 252、`goal-runner-phase` 296、`goal-runner-testing-integrity` 204——codex返修 finding 8 后新增，V5的attended bridge在此）。不拼接多个id。

    node scripts/check-plan-version.mjs
    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter vision-canary
    npm --prefix harness run test:unit -- --filter effective-vision-context
    npm --prefix harness run test:unit -- --filter critic-receipt-producer
    npm --prefix harness run test:unit -- --filter visual-fidelity
    npm --prefix harness run test:unit -- --filter ui-spec
    npm --prefix harness run test:unit -- --filter host-runtime-truth
    npm --prefix harness run test:unit -- --filter goal-runner-phase
    npm --prefix harness run test:unit -- --filter goal-phase-runtime
    npm --prefix harness run test:unit -- --filter goal-canary-pin-binding
    npm --prefix harness run test:unit -- --filter goal-runner-testing-integrity
    npm run openspec:validate
    npm run candidate:build

纯文案返修只查相关diff/plan；生产变更跑目标检查。`candidate:build` 包含的typecheck、unit全量、fixture、consumer smoke与zip校验作全量验收，不在它前后另跑重复 `npm test`。

宿主判据 = 与B01合并的**一次**C-U回归，窗口 spec→ut，由用户触发集成与运行（总plan §5、§6：宿主检查点收敛为B02后与B06两处）：

    # 在用户已集成候选件的验收宿主 framework/harness 执行
    npx ts-node scripts/goal-runner.ts --feature bc-openCard-1 --adapter claude --requirement-file '<原始需求文件绝对路径>' --start '<有效上游之后的受影响起点>' --end ut --detach

有可恢复run时使用真实run_id的原resume协议，不混fresh/resume参数；上游无效从实际需重验的最上游开始，不伪造上游闭环。

本地完成：V1至V8与上述检查通过，候选件可交用户。本批完成：V9通过（同时给出B01 V9证据），证据记入既有宿主/维护报告，`b02-host-acceptance` 才可completed。宿主未触发则host todo保持pending，不能把本地通过当B02完成；B03细化不等待此项（总plan §5）。

## 8. 修订记录

### 2026-09-06：codex 对施工图的 adversarial review 第 1 轮（11 条 finding 全数落入 plan，未实施、未提交）

每条均已回代码逐行核实后再改（行号为核实时的实际位置）。既定裁决未被推翻：仍删invoke级canary、refs绑 `run_id`+内容哈希+adapter、不跨run、不改completion probe与独立visual provider、不新增签名/manifest/账本/人签、设备侧 `critic_run_id` 延后。

| # | 严重度 | finding 摘要 | 处置 | 落点 |
|---|---|---|---|---|
| 1 | high | `run_probed` ≠ 实测：override分支（effective-vision-context.ts:150）无canary即给 `run_probed`，preflight(:344)据此跳探 | 采纳 | D1（终签追加"来源为probe"）、D1放弃的准确性②、D7新增"未验证（未实测）"态、§5、V4 |
| 2 | high | attended 可把同run先前detached轮的遗留 `agent-events.jsonl` 重签成新材料证据 | 采纳 | D2（生产守卫加 `executorMode==='detached'`）、D5 attended证据轴理由改写、V5③ |
| 3 | high | basename命中即算读过（critic-receipt-producer.ts:150），随后哈希的却是目标图 | 采纳 | D2（完整路径等值 + win32大小写归一，删:123注释）、§5新增边界行、V3② |
| 4 | medium | `loadSpecRefsReceipt`(:107) 只收 `'1.0'`，升级清单漏列；同run resume时旧回执的 `goal_run_id` 恰好命中 | 采纳 | D2新增loader版本bullet、D8 MIGRATION句改写、V8 |
| 5 | medium | 删除清单漏 :3282 REQUIRED标题与 :3285–3286 两分支公共句（仍宣称invocation-bound） | 采纳 | D3改为逐行表 + 最终prompt断言 + 点名须改写的既有断言 |
| 6 | medium | "无回执=结构性不可达"会在正常goal首轮误告执行形态不支持（回执invoke后签、阶段内gate已读） | 采纳 | D7改四态（新增"尚未生成"），unreachable只由执行形态/审计能力判定，attended用run-control `owner.kind` 判 |
| 7 | medium | PASS披露进不了summary与goal-report（summary不收PASS check；报告只渲染两类事件） | 采纳（最小接线） | D4新增核实段：`carried_over` 落既有事件 + goal-report既有注记行加一类；不新增check/WARN/summary字段；V2断言报告文本 |
| 8 | medium | 验收未限定经生产接线（两处helper把harness/gate整段换掉）；V2把事件字段写成回执字段 | 采纳 | §6新增"生产接线要求"前言 + V1/V2/V3/V5改写 + §7加 `goal-runner-testing-integrity` 过滤串 |
| 9 | medium | visual-capability-routing:8 规范性正文仍以capability receipt定义能力来源；delta实为四份 | 采纳 | D8表拆为三行（:8/:15/:28）、§4 S3改"四份delta、共七处条款" |
| 10 | low | 交互金丝雀固定写 `model='unknown'`(:163)，`canaryAdmissibleForExecution`(:101) 在pin在场时要精确匹配 | 采纳 | D5 attended能力轴限定为无pin场景、§5边界行、V5④对照 |
| 11 | low | "被中断轮也会拿到当轮回执"过强（produceCriticReceipt 三处早退）；事故注释在 :3262 非 :3269 | 采纳 | D6理由②收窄为条件性重签、§1行号纠正 |

### 2026-09-06：codex 对施工图的 plan review 第 2 轮（3 条 finding 全数落入 plan，未实施、未提交）

| # | 严重度 | finding 摘要 | 处置 | 落点 |
|---|---|---|---|---|
| 12 | high | V4 的"override 在场 + 有效缓存 → 可终签"正例不可构造：effective-vision-context.ts:150 的 override 分支先 return、不读 canary，`evidence.canary_probed_at` 恒缺席，按 D1 必须拒签，归 D7"未验证（未实测，不可终签）" | 采纳（删正例） | V4 |
| 13 | high | goal-phase-runtime.ts:4166 只禁 `session + detached`，未禁 `process + attended`；后者可经显式 `--runtime-executor`/`--runtime-owner` 进入 runtime，`owner.kind==='session'` 判不出 attended，同 run 有有效 probe 与内容未变的 1.1 refs 回执时会采信旧回执终签，违反"attended 不可达"裁决 | 采纳（补反向约束） | D7 执行形态判据段新增 high 段（runtime 入口补 `attended executor ⇒ owner.kind==='session'`，不满足即拒绝启动）、V5 增拒绝用例 |
| 14 | medium | goal-runner-testing-integrity.unit.test.ts:469 的 helper 无条件装 harness 替身、:595 直接写 PASS summary，事后直调 gate 不能证明它控制了 phase 推进 | 采纳 | §6 新增 medium 段：V1/V2 经 `realSpecFidelityGate` 开关让真实 `checkUiSpecFidelityGate` 在 runtime 内决定 exitCode/summary（FAIL 走既有 `failOverride`→真实 `writeRunSummaryBase`），事后直调降级为补充断言 |

## 实施记录

### 2026-09-06：S0–S3 本地实施（未提交、未跑宿主、未跑 candidate:build）

先按第 2 轮 plan review 落了三处 plan 修正（V4 删正例 / D7 新增 owner 反向约束 high 段 / §6 新增生产接线 medium 段，见 §8 第 2 轮表），再按 S0→S3 实施。

**S0 删除组（D1）**

| 文件 | 行为变化 |
|---|---|
| [vision-canary.ts](../../harness/scripts/utils/vision-canary.ts) | 删 `buildInlineCanaryBlock`（原 170–195）。`buildCanaryPrompt` / `renderCanaryImage` / `generateRandomCanaryAnswerKey` / `resolveCanaryCacheDecision` 一字未动，preflight 探测继续用 |
| [effective-vision-context.ts](../../harness/scripts/utils/effective-vision-context.ts) 20–120 | 删 `CapabilityReceipt` 类型、`capabilityReceiptPath`、`readCapabilityReceipt`、`writeCapabilityReceipt`、`invocation_bound` 分支与 scope 成员、`evidence.binding_path`，以及**已无生产调用方**的 `ResolveVisionContextArgs.invokeId`。文件从 195 行降到 ~140 行；两个 `resolveEffectiveVisionContext` 调用方（harness-runner:223 / fidelity-governance-check:38）本就不传 `invokeId`，行为逐字不变 |
| [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts) 220–240 / 6404 / 6590 / 7576–7667 | 删 import（`buildInlineCanaryBlock`/`generateRandomCanaryAnswerKey`/`renderCanaryImage`/`resolveCanaryCacheDecision`/`resolveCanaryStdoutEnvelope`/`CanaryAnswerKey`/`capabilityReceiptPath`/`writeCapabilityReceipt`）、出题与渲染块、prompt 的 `+ inlineCanaryBlock` 拼接、两张回执的 invoke 后 `rmSync` 清理、整段判卷 + `writeCapabilityReceipt` + `capability_receipt` 事件 + 三条 console 分支（共删 92 行） |
| [critic-receipt-producer.ts](../../harness/scripts/utils/critic-receipt-producer.ts) | `VlSigningChainResult` 去 `capReceipt`；删 capability receipt 五项校验与两处事件锚（`GoalRunEventLite` 随之删除） |

**S1 材料绑定组（D2/D4）**

- [critic-receipt-producer.ts](../../harness/scripts/utils/critic-receipt-producer.ts)：`SpecRefsReceipt` 升 `'1.1'`（删顶层 `invoke_id`、`refs[]` 增 `read_at_invoke?`）；`loadSpecRefsReceipt` **只收 1.1**；新增模块私有 `normalizeRefPath`（`path.resolve` + win32 `toLowerCase`）；`produceSpecRefsReceipt` 改合并生产——旧 entry 的 `read` 仅在 run/adapter 相同**且内容哈希未变**时继承，返回值增 `carriedOver: string[]`；Read 命中删 basename 兜底、改完整路径等值，:123 的函数头注释同步改写。`verifyVlSigningChain` 重写：能力经 `resolveEffectiveVisionContext` 判 `scope==='run_probed'` ∧ `evidence.canary_probed_at` 在场 ∧ `verdict ∈ {tool_read,native}`；删 invoke 等值与事件锚；`carriedRefs` 由 `read_at_invoke !== 'spec-<attempt>'` 派生。
- [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts) 7576–7635：回执生产守卫追加 `executorMode !== 'detached'` 分支——attended 只发 `spec_refs_receipt_produced` 的 `status:'skipped'` + `reason:'attended_no_invoke_audit'` 并打印一行，不写盘不覆盖；detached 分支的事件增 `carried_over`，`receipt_sha256` 保留为诊断字段（已无消费者校验）。
- [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts) 4160–4180：按 D7 新增段补反向约束 `executorMode==='attended' ⇒ runtimeOwnerKind==='session'`，不满足即 BLOCKER 拒绝启动并说明"错配会让视觉终签误采信先前 invocation 的读取记录"。既有 `session + detached` 分支与文案不动。

**S2 消费面与文案（D3/D5/D7）**

- `buildClosureVisualEvidenceBlock`（goal-phase-runtime.ts 3263–3295）：标题改 `## Read-only visual evidencing (spec closure)`；两分支公共句的第二句（invocation-bound）改写为"本 run 内读过且内容未变即可采信，改动过的图必须重读"；删"read EVERY authoritative…"两句与"Skipping any image…"一句；FROZEN 豁免句、图片清单、`'none'` 变体整段保留。函数头注释同步纠正。
- `ui_spec_fidelity_gate`（[spec-ui-spec-check.ts](../../profiles/hmos-app/harness/spec-ui-spec-check.ts) 305–360）：失败分支按 `severestVlFailureKind` 出四态 headline + suggestion；PASS `details` 删 `chain.capReceipt!.binding_path` 与"runner 事件锚"，改为"能力=run 级实测金丝雀（scope=run_probed、来源 probe）+ refs 验读 N 张（逐张 hash 核对）"，`carriedRefs` 非空时追加"其中 M 张读取记录来自本 run 先前 invocation（内容未变）"。
- [check-spec.ts](../../harness/scripts/check-spec.ts) 447–460：`vision_output_counterevidence` 的 chain 披露句由 `invoke=<id>` 改为"本 run 的材料证据完整（refs 验读 N 张…）"，两分支仍 PASS。
- [goal-report-generator.ts](../../harness/scripts/utils/goal-report-generator.ts) 500–515：既有逐 phase 注记段增一类 `↳ 参考图读取`（`carried_over > 0` 时渲染），与 `↳ 预算提示`/`↳ 模型核验` 同段同写法。
- [skills/feature/spec/SKILL.md](../../skills/feature/spec/SKILL.md):46 与 [reference/ui-spec.md](../../skills/feature/spec/reference/ui-spec.md):204 各补一句"本 run 内读过且图未变即可，closure 轮不必重读"，ui-spec.md 另补"override 不构成实测证据"。

**S3 规格与验收（D8）**

- 新建 OpenSpec change [vision-evidence-material-binding](../../openspec/changes/vision-evidence-material-binding/)：proposal + tasks + **四份 delta**——`visual-capability-routing`（MODIFIED 两条：能力来源改 run 级 probe、终签改材料寻址 + override 不是实测；:15 场景的 "MAY issue a new inline canary" 随该 requirement 一并改写）、`goal-runner`（MODIFIED closure prompt 一条 + REMOVED inline canary signing 一条，共两条 requirement 同属一份 spec）、`harness-gates`（MODIFIED refs 回执分母条款 + ADDED 四态文案条款）、`feature-artifact-layout`（MODIFIED 去掉 `capability-receipt.json`）。
- [MIGRATION.md](../../MIGRATION.md)：新增「3.0.x：视觉终签改绑材料，invoke 级金丝雀回执停产（非 Breaking）」一节——停产文件、override 结构性不可达、schema 1.1 与 loader 只收 1.1（含同 run resume 为何不能靠 `goal_run_id` 作废）、跨 invoke 并集、同名异路径、attended 不生产、四态、carried_over 披露、删事件锚与全部放弃的准确性；消费者无需动手。

**测试（全部扩既有套件，无新框架、无新 suite）**

- `effective-vision-context`：整份改写为新语义 5 例（probe 来源在场 / override 无 `canary_probed_at` / **override + 本 run 有效金丝雀仍无 probe 来源** / 旧 run 金丝雀回落 adapter 声明 / 遗留 vision 文件含旧 capability-receipt 不致盲）。
- `critic-receipt-producer` 新增 5 例：V3② 同名异路径不算读；V2/V3① 跨 invoke 并集（继承 → 图变作废 → 重读改写 `read_at_invoke`）；V8 schema 1.0 残留（同 run resume）判 null 且不继承；跨 run/跨 adapter 不继承；V5①②/V6 结构性不可达三判据（非 goal / run-control `owner.kind='session'` / adapter 无解析器，并含 process owner 与正例基线对照）。
- `visual-fidelity` 的 vl 终签用例整体改写为 run 级能力 + 1.1 材料回执：①PASS 并披露 run 级来源、①b 沿用披露、①c 本轮重读不得标注沿用、②无金丝雀与 ②b override 归"未验证（不可终签）"、③1.0 残留判"尚未生成"、④旧 run 回执判"验证不通过"、⑤空 refs、⑥遗留账本（含旧 capability-receipt.json）不改结论。
- `goal-runner-phase`:639 与 `host-runtime-truth`:381 的 closure prompt 断言改写为新文案 + 五串缺席（属本批必改项）；`host-runtime-truth` 的 G 分母用例夹具改 probe 金丝雀 + 1.1 回执，并断言失败归类为 `mismatch`。
- `goal-canary-pin-binding` 新增 2 例：V4 能力来源矩阵（缺失/none/ocr_capable/过期/旧 run/override/override+有效金丝雀 七种一律 `not_probed` 且文案不含"实测"，正例可终签并给出 `carriedRefs`）；V2 goal-report 文本（`carried_over>0` 渲染 `↳ 参考图读取`，`=0` 与 `skipped` 不渲染）。
- `goal-runner-testing-integrity` 新增 5 例 + helper 扩展：`runGoalRuntimeChain` 增开关 `realSpecFidelityGate`（spec 轮由**真实** `checkUiSpecFidelityGate` 决定 exitCode/summary，FAIL 走既有 `failOverride` → 真实 `writeRunSummaryBase`），`AgentCtx` 增 `outputLogPath`，`RunProbe` 增 `specGateResults`。用例：B02-V1（读满 + invoke 非零退出 → prompt 无金丝雀块、无 `capability_receipt` 事件、回执 complete 且 schema 1.1 无 `invoke_id`、真实 gate PASS 且 spec 只跑一轮 harness）、B02-V1b（未读 → gate FAIL 且 runtime **真的重跑** spec，这条才是"gate 控制推进"的证据）、B02-V2（第 2 轮零读图 → `carried_over>0`、gate PASS 且披露沿用、实际 `goal-report.md` 文本含 `↳ 参考图读取`）、B02-V5③（detached 轮写出日志与回执 → 换图 → attended 轮只发 skipped、回执文件**字节不变**）、B02-D7（`--runtime-executor attended --runtime-owner process` 拒绝启动）。

**与 plan 的取舍差异（均写明放弃的准确性）**

1. **D7 的 failure 标签实现为"每条 failure 一个 kind + `severestVlFailureKind` 取最严重"，而非 plan 字面的"给每条 failure 打标签供 gate 选词"外加新结构**。`VlSigningChainResult` 保留 `failures: string[]` 不变（两个既有消费者 spec-ui-spec-check:309 与 check-spec:461 逐字不改），并列新增等长的 `failureKinds`。**放弃的准确性**：无（判据仍只有一处实现）；代价是两个数组靠约定等长，而不是一个 `{kind,message}[]`——改成对象数组要同步改两个消费者的展开写法，收益只是类型更紧。
2. **`read_at_invoke` 记的是"当前所依据的那一次 Read"，不是 plan D2 字面的"首次"**。**放弃的准确性**：回执不再保留"这张图最早在哪一轮被读到"的历史。理由是 D4 把 `carriedRefs` 定义为"本轮未读、沿用先前记录"，若记首次，则"本轮确实重读过、但首次在更早一轮"的图会被误报成沿用——披露反而失真。
3. **§6 的真实 gate 接线用开关而非"不装 harness 桩的 helper 变体"**。`runGoalRuntimeChain` 的替身还负责回执/manifest/closure attestation 等一整套产物，整体拆掉会波及 58 个既有用例。开关只改 spec 分支的 exitCode/summary 来源，默认关闭时既有用例逐字不变。**放弃的准确性**：spec 轮以外的 phase 仍走替身 harness，本批不证明它们的门禁接线；V1/V2 要证的"gate 决定推进还是重跑"由 V1（PASS→一轮推进）与 V1b（FAIL→真重跑）的对照完整覆盖。
4. **`openspec/specs/feature-artifact-layout/spec.md`:201 未直接修改**，因此调度者给的残留 grep 在该文件上仍有 1 处命中。理由：本仓 OpenSpec 约定是 change 提 delta、`/opsx-archive` 时才回灌 `openspec/specs/`（B01 的 verifier-repair-diagnostics 同样只有 change、`openspec/specs/harness-gates` 里 0 处 `run_verifier_for_repair`）。直接改 `openspec/specs/` 会绕过归档流程、制造第二处真源。该条款已由本 change 的 feature-artifact-layout delta 以 MODIFIED 覆盖。**放弃的准确性**：归档前 `openspec/specs/` 与实现暂时不一致（这是该工作流的固有窗口，非本批引入）。

**验证结果（本地，日志在 scratchpad/b02/v-*.log）**：`check-plan-version` PASS（mode=default current=3.0.0）；`typecheck` exit 0；`openspec:validate` **32/32** PASS + Enforcement 路径全解析。十一条 `test:unit --filter` 全绿：vision-canary **33/33**、effective-vision-context **5/5**、critic-receipt-producer **10/10**、visual-fidelity **126/126**、ui-spec **34/34**、host-runtime-truth **23/23**、goal-runner-phase **33/33**、goal-phase-runtime **17/17**、goal-canary-pin-binding **17/17**、goal-runner-testing-integrity **63/63**。所有改动文件经 node 扫描确认 0 处 CRLF。

**残留引用 grep**：调度者给的删除清单在 `harness/scripts profiles skills agents docs`（排除 tests）**为零**；`openspec/specs/feature-artifact-layout/spec.md`:201 仍有 1 处 `capability-receipt.json`，是归档前的基线正文，见上文取舍差异 4。

**未做**：`npm run candidate:build`（调度者在 review 后统一跑）；未 commit；未触碰宿主工程；未改 framework/ 发布件；宿主 C-U 回归（V9）由用户触发。

### 2026-09-06：codex review 第 1 轮返修（3 条 finding 全数采纳，未提交）

| # | 严重度 | finding | 改动 | 对应用例 |
|---|---|---|---|---|
| 1 | medium | V1/V2 未覆盖 closure-only：V2 靠注入 FAIL 逼出第二轮（进不了 `isClosureOnlyRetryPending`），V1 只模拟非零退出、无 `completion_observed`/`kill_attempted`；closure prompt 接线断开测试仍绿 | `goal-runner-testing-integrity.unit.test.ts`：helper `opts` 增 `invokeResultFor(phase, attempt)`（:371 起）并展开进 `__testing_setInvokeAgent` 桩返回值（:432 起）；新增 `B02_FORBIDDEN_REREAD` / `b02FailFirstSpecClosure` / `assertB02ClosureOnlyRound`（:3517 起）；V1、V2 改用真实 closure 重试条件 | B02-V1 / B02-V2 |
| 2 | medium | V5③ 换 run 绕开指定现场（detached 与 attended 各一个 run、attended 未开 realSpecFidelityGate），验证不了「同 run 接管 + 替换参考图 + 遗留日志」 | 同文件 :3731 起整例重写：同一未封卷 run 先 detached 跑 spec（gate 恒 FAIL 至内容重试耗尽 → halt），回拨 run_end 过 cooldown，替换参考图，再以 `resume + executorMode:'attended'(session owner) + realSpecFidelityGate` 接管同一 run | B02-V5③ |
| 3 | low | `goal-report-generator.ts`:511 取该 phase 全部 `spec_refs_receipt_produced` 的 `carried_over` **最大值**，把历史事实说成本轮（i2 沿用 3、i3 全部重读时仍报 3） | `goal-report-generator.ts` 508–520 改为按该 phase **末轮**事件展示；`goal-canary-pin-binding-d7f3a9c4.unit.test.ts` 新增 V2b 用例 | goal-canary-pin-binding V2b |

**closure-only 的真实造法（finding 1 关键）**：让 spec 首轮（attempt 身份 `i1`）的 receipt 探针 `failed` → `classifyClosureKind` 归 `receipt_repair_with_verifier` → `driverGuardAction` 停在 `retry` → `phase_verdict` 落 `PASS + advance_blocked + retry`，下一轮 spec 即 `isClosureOnlyRetryPending` 认定的 closure-only 轮。V1 让该轮以 `{exitCode:1, completion_observed:true, kill_attempted:true}`（agent-invoke.ts:1474/1481 的既有结果形状）结束、refs 全读；V2 让该轮零读图。两例均断言：最终拼装 prompt 含 `## Closure-only attempt (BLOCKER)` + `## Read-only visual evidencing (spec closure)` 且不含五串重读要求、refs 回执沿用（V1 逐图 `read=true`，V2 `carried_over>0`）、真实 `ui_spec_fidelity_gate` 逐轮 PASS、spec 恰好两轮 harness 后推进到终点。

**V5③ 的现场（finding 2）**：attended 段断言遗留 `agent-events.jsonl` 在盘、attended 新落事件全为 `skipped`/`attended_no_invoke_audit`、回执 JSON 与**文件字节**逐字不变、真实 gate 逐轮 `FAIL` 且 `details` 含「结构性不可达」与 `owner.kind=session` 判据。

**验证结果（本地，日志在 scratchpad/b02/fix1-*.log）**：`typecheck` exit 0；`goal-runner-testing-integrity` **63/63**、`goal-canary-pin-binding-d7f3a9c4` **18/18**、`critic-receipt-producer` **10/10**、`goal-phase-runtime` **17/17**；因动了共享的 goal-report-generator，另跑其余六个消费套件全绿（`goal-runner-phase` 33、`goal-runner-policy` 26、`visual-debt` 30、`attempt-axes-timeline` 2、`goal-capability-gate` 4、`adjudication` 55）。改动文件经 node 扫描 0 处 CRLF。未跑 `candidate:build`（另有一次在跑）、未 commit。

### 2026-09-06：codex review 两轮收敛、候选件产出、本地验收完成（调度记录）

- plan review：第 1 轮 11 条 finding（3 high / 6 medium / 2 low）全采纳；第 2 轮 8 条 resolved、3 条 partial 加 1 条新 high（attended ⇒ session owner 入口约束、V4 override 拒签、§6 绕开 harness 替身），随实施一并落地。
- 实施 review：第 1 轮 2 medium + 1 low（V1/V2 真实 closure-only 条件、V5③ 同 run 接管现场、goal-report 末轮事件披露）全修；第 2 轮 approve、无新 finding。全部为只读审查（`codex exec`，gpt-6-astra/high），逐文件哈希核对工作树未被 review 改动。
- 最终 `candidate:build`（scratchpad b02/candidate-build-2.log）：typecheck 通过、unit 3840/3840、fixtures 46/46、consumer smoke 全段通过，`[candidate] BUILT → dist/candidates/framework-3.0.0-candidate.zip`，zip sha256 `cf0ea6d043147fa1697e0376b02bc951208d3a3144568713a8d72317f344584d`。
- 提交：分三笔（D1–D3 生产核心删改 / D4–D7 消费面与文案 / plan 与 OpenSpec），不带署名。
- `b02-contract-local` 置 completed；`b02-host-acceptance` 保持 pending：候选件集成到验收宿主与 C-U 合并回归（spec→ut 窗口，同时验收 B01 V9）由用户触发。

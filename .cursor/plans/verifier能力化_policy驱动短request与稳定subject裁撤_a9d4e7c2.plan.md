---
name: verifier 能力化 — policy 驱动短 request 与稳定 subject 裁撤
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan；宿主已挂起等本 plan 发版解决。发版版本号建议
# 3.0.1（宿主须能区分），版本窗口由用户控、待用户定。
# v1（2026-08-29）：宿主实锤立项，方案=块即投递 + 双保真锚。
# v2（2026-08-29，用户松耦合裁决）：双保真锚撤回，收缩为纯契约文字改动；立否决闸
#   （新增验证面须自证防误操作非防恶意）与 presence-based 默认（在场即生效、缺席即为零）。
# v3（2026-08-29，吸收 codex 方案 + 用户拍板：整体重构方向定稿）：v2 只治了投递症状，
#   未治用户抱怨的生产端耦合。codex 根因四层矛盾全部核实（本轮亲核 runtime-policy lite
#   矩阵 / harness-runner 无条件 Step4+subject / SKILL 无条件仪式 / hook goal-headless
#   bedside；check-telemetry.ts、details_material、双文本渲染等稳定-subject 投影子系统
#   确已持续增生——它就是复杂度泉眼）。定稿：
#   ①verifier 从「每阶段必跑仪式」改为「resolveVerifierPlan 一次解析的能力」，
#     disabled/enabled/blocked 三态全员消费，生产端按 plan 生成、不再无条件；
#   ②投递协议改「短 request JSON」，删除 ai-prompt 内嵌机器块与全文投递；
#   ③**删除稳定 subject 承诺**：每次 harness run=新 request，整套 canonical 投影/
#     telemetry 归一子系统连根裁撤——接受运行时代价：harness 重跑即证据换代，闭环纪律
#     固定为 harness→verifier→check-receipt（关环不重跑 harness）；
#   ④三处修正（相对 codex 原案）：goal-headless bedside 特例**本轮保留**、其删除另立
#     后续（须真实 goal payload 验收，防大杂烩）；v2 否决闸与 presence-based 默认原样
#     入本 plan 设计原则；版本号 3.0.1 待用户定。module-catalog 语义摘要另行立项
#     （codex 同判），不入本 plan。
# v4（2026-08-29，吸收 codex 复核轮 3P1+2P2；其自撤四项一并记录）：
# [codex 自撤/自修] 撤 request_nonce（subject 按内容寻址，不需保证每跑必异）；撤
#   summary.verifier_plan 快照（共享纯函数复用即可，不造状态）；撤「custom workflow 缺
#   verifier_prompt 必须 blocked」（声明即真源，缺席=不适用，policy 只管已声明能力的
#   required/off）；修 goal 建议（不因 publisher 未验收把 full goal 改 blocked——保留
#   bedside 权责，只迁移生产协议）。
# [P1-① 采纳] 删除「每次 harness run 必换 request」的错误承诺——v3 从"强制稳定"矫枉到
#   "强制换代"，两头都是机制化承诺。定稿：**subject 按审查材料寻址**——相同材料可复用
#   同一 subject，材料变化必换；不加 nonce、不建投影。闭环纪律软化：重跑 harness 后
#   材料未变则既有证据照用直接 receipt，材料变了才明确指引重跑 verifier。实施允许把纯
#   telemetry 从装配产物**源头拿掉**（如 {timestamp} 固定化），但不得重建归一/投影
#   子系统。补正常回退集成验收（下游发现问题→回责任上游改→重跑上游→下游 freshness
#   stale→从下游继续；不清空 feature、不要求提交代码）。
# [P1-② 采纳] goal/lite/blocked 生产路由矛盾收口——resolver 的 workflow/track/policy
#   解析对 interactive 与 goal **都生效**（否则 lite×goal 关不掉无条件装配）；lite×goal
#   =disabled 零产物；full goal 迁移到新 request 生产协议但 hook 照旧 bedside（发布
#   权责与闭环裁决零变化——"goal 零变化"收窄为此义，生产协议不豁免）；adapter
#   capability 的 blocked 判断本轮仅 interactive。blocked 不得先于脚本检查终止
#   harness：优先级=script FAIL 如实报真因 > PASS+blocked=INCOMPLETE/
#   verifier_provider_unavailable > PASS+enabled 生成 > PASS+disabled 走既有闭环
#   ——provider 缺失不禁基本诊断。
# [P1-③ 采纳] summary 1.3 消费面完整迁移——五处已知写死点：finalizer:452 只收写 1.2、
#   quality-axes:461 认 1.1/1.2、assess:495 非 1.2 当 legacy、upstream-verdict-gate:173
#   认 1.1/1.2、check-ut:1143 attestation-first 只认 review 1.2（最后一处是 f3a9d2c7
#   自己写死的）；T3 显式包含，实施 rg 清点 + 定点回归，不造扫描器/注册表。
# [P2-① 采纳] presence-based 收窄为**声明在场**：workflow 声明 verifier_prompt=能力
#   存在，缺席=不适用；磁盘上旧 prompt/request/report 的存在**永远不能**激活被
#   resolver 判 disabled 的能力（enabled→disabled 无需清理旧文件）。
# [P2-② 采纳] 不顺手重构 closure 引擎——「closed=script PASS∧required 齐」限定 full/
#   receipt 闭环域；lite 沿用既有 change/coding/exit 与 receipt not-applicable；只删
#   文档里的固定四件套说法，不改写 lite closure/phase-state/goal 状态机。
# v5（2026-08-29，吸收 codex 终轮 1P1+2P2+1裁剪，纯文本收尾，架构不动）：
# [P1 采纳] 1.3 消费面补全并入待办真源——除 v4 五处外，生产面还有：runner 兼容读取与
#   1.2 writer（harness-runner:1365/1660）、partial closure 恢复与 final writer
#   （finalizer:349/506）、feature completion 非 1.2 判旧版（verify-feature-completion:
#   211）、TS 类型与 schema 枚举（types:580 / summary.schema.json:28）。正文改「当前
#   已知生产命中，实施以一次 rg 清点为准」；t3 todo（frontmatter=实施待办真源）补全
#   消费面；验收 17 补 verify-feature-completion/assess 不得把 1.3 判 legacy。
# [P2-① 采纳] 松耦合三句话残留「入口报错」与 blocked 阶梯冲突——改为「required 缺
#   provider 不阻断脚本诊断；脚本 PASS 后在 verifier/闭环入口报告 blocked」。
# [P2-② 采纳] t5 todo 与正文 T5 的「required 齐即 closed」两处补「仅 full/receipt
#   闭环域；lite 机制原样不动」限定，防实施者只看 todo 时扩面。
# [裁剪 采纳] 删除「允许固定化 timestamp 等 telemetry」句——subject 本就不承诺稳定，
#   时间戳换 subject 属合法结果；该句会诱导为提高复用率改造 prompt producer，让投影
#   机制换名字回潮。定稿：本 plan 不处理 telemetry，直接哈希实际 prompt 字节。
# [机械修正] H1 标题 v3 → v5。
todos:
  - id: t1-resolve-verifier-plan
    content: T1 resolveVerifierPlan 纯函数（四问一次解析 → disabled/enabled/blocked）+ runner 生产端接线：解析对 interactive+goal 生产侧都生效，disabled 零产物；blocked 按优先级阶梯（script FAIL 报真因 > PASS+blocked=INCOMPLETE，不禁基本诊断）；capability 判定本轮仅 interactive。
    status: completed
  - id: t2-request-protocol
    content: T2 短 request 协议：runner 在 enabled 时生成 verifier.request 文件与 summary 记载；Task prompt=request JSON 整段；hook 改验 request（重算 subject 四方等值 + prompt_sha256 对磁盘 + canonical path），删除 ai-prompt 机器块注入与全文投递。
    status: completed
  - id: t3-dispatch-rekey
    content: T3 分派重键 + 1.3 消费面全迁移：summary schema 1.3（verifier 字段条件化，代际=schema_version、适用性=policy、身份=subject）；消费面=schema/types、runner writer 与兼容读取、finalizer final writer 与 partial recovery、quality-axes/assess/upstream-verdict-gate/verify-feature-completion/check-ut attestation 探测——实施以一次 rg 清点为准，定点回归，不造扫描器；grandfather/迁移矩阵按定稿。
    status: completed
  - id: t4-deletion-sweep
    content: T4 稳定 subject 子系统裁撤：canonical 投影/telemetry 归一/details_material/check-telemetry.ts/双文本渲染/块注入/strip 幂等/subject-presence 分派全部删除；保留 request 分区文件 + CAS/conflict + JSON 唯一真源。
    status: completed
  - id: t5-docs-and-adapter
    content: T5 契约文字与能力声明：六份 SKILL/七份 prompt/共享 rules 的重复 verifier 仪式收敛为消费 resolveVerifierPlan 结果；adapter 增 verifier_capability 声明（仅实测 mode 登记）；闭环判定文字改「required 证据齐即 closed」——仅 full/receipt 闭环域，lite 机制原样不动。
    status: completed
  - id: t6-acceptance-and-migration
    content: T6 full/lite 矩阵验收 + 迁移回归 + openspec 重开 verifier-evidence-identity 修订 delta + 宿主回灌指引；goal/headless 特例删除与 3.0.1 发版动作用户驱动另行。
    status: completed
overview: >
  宿主实锤暴露的不是缺一个投递通道，而是 verifier 被做成了每阶段必跑的仪式：policy 说
  off、runner 仍无条件生成 ai-prompt 与 subject、SKILL 仍无条件要求四件套、check-receipt
  到最后才发现 lite 不适用。根治（codex 方案+用户拍板）：verifier 降为按 policy/workflow/
  adapter 能力动态启用的能力，resolveVerifierPlan 一次解析全员消费；投递协议改为短
  request JSON（verifier 自读磁盘原件，hook 重算等值+磁盘 SHA 对账）；subject 改为
  **按审查材料寻址**（相同材料可复用、材料变化必换，既不建稳定投影也不加 nonce），整套
  归一/投影子系统裁撤。净删为主：机器块、全文投递、canonical 投影、telemetry 归一、
  subject-presence 分派全部裁撤；保留 request 分区、CAS/conflict、JSON 唯一真源。
---

# verifier 能力化：policy 驱动短 request 与稳定 subject 裁撤（a9d4e7c2 · v5）

状态：**v5 已按 codex 终轮完成纯文本收尾（1.3 消费面入待办真源并扩清单 / blocked 措辞统一 / lite 限定入 todo / telemetry 句裁除），codex 判"完成后即可进入实施"（未实施）**。
触发：宿主 bc-openCard-1 回灌——SSOT stale → spec 重闭环 → verifier 必跑 → 「全文原样投递」不可执行且不可验证（177KB 有损往返、块外零校验静默）。深挖后定性升级：投递只是症状，病根是 verifier 全链紧耦合（生产端/文档无条件，适用性只在消费端判断）。宿主已挂起等发版。

---

## 一、根因：四层互相矛盾（全部已核实）

| 层 | 现状 | 证据 |
|---|---|---|
| policy | lite 明确 `verifier=off、receipt=not_applicable`（"这条轴对 lite 不存在"，非降档） | [runtime-policy.ts:365](../../harness/scripts/utils/runtime-policy.ts) LITE_EVIDENCE 注释原文 |
| runner | 无条件跑 Step 4 装配 ai-prompt、无条件生成 verifier_subject_id | [harness-runner.ts:1023](../../harness/harness-runner.ts) / writeRunSummaryBase 内 issueVerifierSubject |
| Skill/rules | full/lite 共用文档，无条件要求 Task 触发 verifier + 四件套闭环 | [coding/SKILL.md:89](../../skills/feature/coding/SKILL.md) 等七处 |
| 消费端 | check-receipt 最后一步才发现 lite 不适用退出；goal-headless 时 policy 说 required、hook 却恒 bedside | [check-receipt.ts:264](../../harness/scripts/check-receipt.ts) / [record-verifier-report.mjs](../../agents/claude/templates/hooks/record-verifier-report.mjs) goalHeadless 分支 |

四条归因：①适用性只在消费端判断，生产端与文档写死全流程；②`verifier_subject_id` 同时承担协议代际/适用性/证据身份三种职责（subject-presence 分派）；③把"全文逐字投递大文件"当成 adapter 天然能力，实无传输通道；④workflow、policy、adapter、Skill 各自维护一份 verifier 规则。

另一个泉眼：**「稳定 subject」承诺**（零改动重跑不换代）催生了 canonical 投影、telemetry 归一、details_material、check-telemetry.ts、双文本渲染整套持续增生的子系统——已消耗一次用户裁决与多轮评审，且仍在长。

## 二、目标模型

**只解析一次的四个互不越权的问题：**

```
这个阶段是否存在？         → workflow + feature track
这个阶段是否需要 verifier？ → evidence policy + workflow verifier_prompt 声明
当前 adapter 能不能执行？   → adapter verifier_capability（仅实测 mode 登记）
本次报告属于哪个 run？      → verifier request（subject_id）

resolveVerifierPlan(...) → disabled | enabled | blocked
  disabled：不生成 ai-prompt/request/subject、不调用、不校验——**缺席即为零**
  enabled ：生成 request 并执行 verifier
  blocked ：policy=required 但 adapter 无能力——**script PASS 后**报
            INCOMPLETE/verifier_provider_unavailable（脚本检查照常完整执行，
            provider 缺失不覆盖真实失败、不禁基本诊断；也不拖到 receipt 才死）
runner / Skill 指引 / Stop hook / check-receipt 全部消费同一结果，不再各自判断。
```

**松耦合三句话（定稿语义）**：没启用的能力，不存在也完全正常；声明 required 的能力缺 provider 时，**不阻断脚本诊断，脚本 PASS 后在 verifier/闭环入口报告 blocked**；禁止把"不适用"与"该有但缺失"混成一种 missing。

**短 request 协议**（替代块注入与全文投递）：

```json
{ "schema_version": "1.0", "kind": "maison_verifier_request",
  "subject_id": "<64-hex>", "feature": "...", "phase": "...",
  "prompt_path": "<features_dir>/<feature>/<phase>/reports/ai-prompt.md",
  "prompt_sha256": "<磁盘 ai-prompt.md 原文 SHA>",
  "gate_fingerprint": "...", "source_commit_sha": "...", "worktree_digest": "..." }
```

- `subject_id = sha256(除 subject_id 外的结构化字段)`——**不再有 canonical 投影**，prompt_sha256 就是磁盘原文哈希。
- runner 在 enabled 时写 `verifier.request.<subject_id>.json` 入 reports 目录并记入 summary；主 agent 的 Task prompt = 这份几十行 JSON 整段（抄错任何字段 → 重算失配 → 明确失败，不再有静默审错）。
- verifier 按 `prompt_path` Read 磁盘原件执行；终态块（v1 格式不变）回显 subject。
- hook 发布前四方对账：**request 声明的 subject == 按 request 字段重算的 subject == summary 现值 == 终态块回显**；`prompt_path` == config 推导的 canonical 路径；`prompt_sha256` == 磁盘实测。Task prompt 必须可解析为唯一 JSON（容忍空白/格式化差异，不容额外指令）。失配各按具名 bedside 态落盘（`prompt_hash_mismatch` 等）。
- `prompt_sha256` 的性质=**误配检测**（harness 重跑过、文件已换代），在冻结威胁模型内，符合否决闸。

**subject 按审查材料寻址（v4 定稿，取代 v3 的"强制换代"）**：不承诺稳定、也不强制每跑必异——**相同材料可复用同一 subject，材料变化必换 subject**；不加 nonce、不建归一/投影。闭环流转的两种正常态：①harness 重跑后材料未变 → 既有验真 JSON 照用，直接进 receipt，**不得强迫重跑 verifier**；②材料变了且证据缺失 → check-receipt 以可执行话术指引重跑 verifier。**本 plan 不处理 telemetry**：直接哈希实际 prompt 字节；时间戳导致换 subject 属合法结果（subject 本就不承诺稳定）——任何"为提高复用率改造 prompt producer"的动作都是投影机制换名回潮，禁止。换来的仍是整套投影子系统连根裁撤。

**闭环判定去"固定四件套"（仅 full/receipt 闭环域；lite 机制原样不动）**：full 域内 `closed = script verdict PASS ∧ 全部 policy=required 的证据已提供`，verifier 是否 required 由 resolver 决定；**lite 沿用既有 change/coding/exit 与 receipt not-applicable 机制原样不动**——本 plan 只删文档里的"固定四件套"说法，不改写 lite closure、phase-state 或 goal 状态机。

## 三、行为矩阵（冻结）

| 场景 | 结果 |
|---|---|
| lite：change/coding/exit | verifier off；不生成 prompt/request/subject、不跑 receipt；exit 脚本 PASS 即闭环 |
| full balanced、当前 phase verifier off | 不生成 verifier 产物；receipt 照跑并记 skipped |
| profile 禁用的 phase | not applicable，零 verifier 产物 |
| custom workflow 未声明 verifier_prompt | not applicable，**不得** fallback 模板擅自造一个 |
| full required + adapter 已实测支持 | 生成短 request → 调用 → 回执验真 |
| full required + adapter 无能力（仅 interactive 判） | **脚本检查照常完整执行**；script FAIL 如实报真因；script PASS 才报 `INCOMPLETE / verifier_provider_unavailable`——provider 缺失不禁基本诊断、不覆盖真实失败 |
| full × goal/headless（v4 收口） | workflow/track/policy 解析**同样生效**；**生产协议迁移到新 request**；hook 照旧落 bedside——**发布权责与闭环裁决零变化**（"goal 零变化"收窄为此义）；bedside 特例的删除仍另立后续（须真实 goal payload 验收） |
| lite × goal/headless | disabled：零 prompt/request/subject，不因 goal 模式被强行升级 |

## 四、实施批次（待 review 后动手）

### T1 resolveVerifierPlan + 生产端接线
- 纯函数：输入 workflow/track/policy/adapter capability/phase，输出 {mode: disabled|enabled|blocked, reason, verifier_prompt?}；单测穷举矩阵。共享复用，不新增 summary 快照状态（codex 自撤项）。
- runner：Step 4 与 request 生成以 plan.mode 门控（disabled 零产物）——**workflow/track/policy 解析对 interactive 与 goal 生产侧都生效**（否则 lite×goal 关不掉无条件装配）；adapter capability 的 blocked 判定本轮仅 interactive。
- **blocked 不得先于脚本检查终止 harness**，优先级阶梯：script FAIL → 如实报真因；script PASS + blocked → `INCOMPLETE / verifier_provider_unavailable`；script PASS + enabled → 生成 request；script PASS + disabled → 走既有闭环。
- goal 的发布权责与闭环裁决零改动（hook bedside 照旧），仅生产协议随 T2 迁移。

### T2 request 协议 + hook 改造
- runner enabled 路径：写 `verifier.request.<subject>.json` + summary 记载（subject/request 路径）；删除 ai-prompt 机器块注入。
- hook：首条 prompt 解析唯一 JSON request → 四方对账 + canonical path + 磁盘 SHA；发布管线（request 分区文件、CAS/conflict、幂等、JSON 真源 + MD 投影）保留不动；bedside 态按验收清单具名。
- 终态块解析、last_assistant_message 正文来源、transcript 单次读取——全部沿用现状。

### T3 分派重键 + 迁移
- summary schema 1.3：verifier 字段条件化（disabled 无 subject/request/ai_prompt；ai_prompt 改条件字段）；代际=schema_version、适用性=policy、身份=subject——三职分离。
- **1.3 消费面完整迁移（实现级阻断项）**：当前已知生产命中如下，**实施以一次 `rg` 清点为准**（不造扫描器/注册表）——[phase-closure-finalizer.ts:452](../../harness/scripts/utils/phase-closure-finalizer.ts)（只收/写 1.2）与 [:349/:506](../../harness/scripts/utils/phase-closure-finalizer.ts)（partial recovery / final writer）、[harness-runner.ts:1365/1660](../../harness/harness-runner.ts)（兼容读取 / 1.2 writer）、[quality-axes.ts:461](../../harness/scripts/utils/quality-axes.ts)（认 1.1/1.2）、[assess.ts:495](../../harness/scripts/utils/assess.ts)（非 1.2 当 legacy）、[upstream-verdict-gate.ts:173](../../harness/scripts/utils/upstream-verdict-gate.ts)（认 1.1/1.2）、[verify-feature-completion.ts:211](../../harness/scripts/utils/verify-feature-completion.ts)（非 1.2 判旧版）、[check-ut.ts:1143](../../harness/scripts/check-ut.ts)（attestation-first 只认 review 1.2）、[types.ts:580](../../harness/scripts/utils/types.ts) 与 [summary.schema.json:28](../../harness/schemas/summary.schema.json)（类型/枚举）。
- check-receipt：分派消费 resolveVerifierPlan 结果 + schema_version；grandfather 语义保留（旧 closed ∧ 旧 manifest fresh 沿旧登记面复核）。
- 迁移矩阵：已 closed+fresh 继续有效；已发布且验真过的旧 JSON 仍可读；3.0.0 生成而未闭环的 subject/ai-prompt **不继续发布**——升级后只重跑当前 phase harness 生成新 request；不回退业务代码、不重写 spec/plan/coding。

### T4 裁撤清单（净删）
删除：ai-prompt 尾部 subject 机器块及 strip/幂等注入；「全文原样投递」规则；`canonicalScriptReportDigest` / `canonicalPromptDigest` 回调 / `details_material` / `check-telemetry.ts` / 顶层与 CheckResult 的 telemetry 排除投影；hmos profile 为 subject 稳定所做的双文本渲染（实施时按现状清点，预计五处）；`subject presence = 协议代际/适用性` 分派；verifier 模板缺失自动 fallback prompt（实施时核实现状后删）。
保留：按 request 分区的证据文件；同 request 并发的 CAS/conflict；发布后 JSON 唯一机器真源。

### T5 契约文字 + adapter 能力声明
- 六份 SKILL / 七份 verify-*.md / 共享 rules：重复的 verifier 仪式段收敛为一句"按 harness 输出的 verifier plan 执行"（disabled 时文档零要求）；闭环判定文字**仅在 full/receipt 闭环域**改为 required-齐即 closed；lite 的 change/coding/exit 与 receipt not-applicable 原样不动。
- adapter 增 `verifier_capability: {transport: repo_file_request, publisher: subagent_stop, modes: [...]}`——仅真实实测过的 mode 登记（claude/codeagent 的 interactive 已实测；headless/goal 待后续验收后登记）；lite/off 不读取；不按 adapter 名硬编码、不以"有 hooks 目录"推断。

### T6 验收 + openspec + 宿主
- 重开 `verifier-evidence-identity` change 修订 delta（agent-adapters 能力声明与 request 协议 / harness-gates 分派与闭环判定 / feature-artifact-layout summary 1.3），不另立新 change。
- 宿主回灌指引：升级后从当前 spec 状态继续——重跑 spec harness 生成 request → Task 投 request JSON → verifier Read 原件 → check-receipt 闭环；后续阶段同法；不回退需求与业务代码。
- 发版（建议 3.0.1，用户定）与 `release:verify` 用户驱动。

## 五、验收清单（缺一不可）

1. 真实 177KB ai-prompt 样张：Task 只收短 request，spec verifier 正常闭环；
2. prompt 改 1 字节 → `prompt_hash_mismatch`；
3. 只投旧式 subject 块 → 拒绝；
4. request 指向其他 feature/phase → 拒绝；
5. request JSON 后追加额外指令 → 拒绝；
6. lite change/coding/exit 全程零 verifier 指引/request/subject/receipt 要求；
7. full balanced 的 verifier-off phase 零 verifier 产物；
8. profile-disabled phase 零 verifier 产物；
9. required + interactive adapter 无能力：**脚本检查仍完整执行、真实失败原因保留**；script PASS 时才报 `INCOMPLETE / verifier_provider_unavailable`（provider 缺失不覆盖真因）；
10. 发布后删 transcript，仓内 JSON 仍验真通过；
11. 同 request 并发 PASS/FAIL → conflict（真并发，沿用既有测试缝）；
12. 不同 request 永不互写文件（分区回归）；
13. **材料寻址双正常流**：①subject 未变且已有验真 JSON → 直接进 receipt，不得强迫重跑 verifier；②subject 变化且证据缺失 → 明确可执行指引重跑 verifier；
14. **正常回退集成流**：下游发现问题 → 回责任上游修改 → 重跑上游 harness/verifier/receipt → 下游因 freshness 变 stale → 从下游继续重跑；**不清空 feature、不要求提交代码**；
15. **lite×goal**：零 verifier 产物（prompt/request/subject 全无）；
16. **full goal**：生产侧走新 request 协议，hook 仍落 bedside（发布权责零变化）；
17. **1.3 迁移五连**：1.3 open→receipt→closed 全程仍 1.3；upstream gate 正常消费 1.3；review 1.3 closed 仍可作 UT attestation-first 基线；旧 1.2 closed+fresh 继续兼容；**verify-feature-completion 与 assess 不得把 1.3 判为 legacy**；
18. 3.0.0 生成而未闭环的 subject/ai-prompt 升级后按指引重跑当前 phase harness 走通（不回退业务代码）。
（codex 原清单中"full goal/headless 真实 hook 发布不落 bedside"随 goal 特例删除**移入后续**，本轮不验收。）

## 六、边界与否决闸（防再膨胀）

- **否决闸（v2 立、本轮继承）**：任何新增验证面须自证防的是**误操作**；恶意场景（伪造/改盘/读后替换）与"agent 改 contracts.yaml"同级，由既有信任模型兜底，一律不设防。`prompt_sha256` 属误配检测，在闸内。
- **presence-based 默认（P2-①收窄为"声明在场"）**：workflow 声明 `verifier_prompt` = 该 phase 具备 verifier 能力，声明缺席 = 不适用；**磁盘上旧 prompt/request/report 的存在永远不能激活被 resolver 判 disabled 的能力**（enabled→disabled 无需清理旧文件，也不会被旧文件重新激活）。lite/off/profile-disabled 不得因本链新增任何要求。
- goal/headless bedside 特例删除：另立后续（真实 goal payload 验收为前置）。本轮 goal 的**发布权责与闭环裁决零变化**（bedside 照旧）；生产协议随 T2 迁移、workflow/track/policy 解析生效（否则 lite×goal 关不掉无条件装配）——"零变化"仅指裁决面。
- module-catalog 整文件哈希致五阶段连带 stale：独立紧耦合问题，另行立项（codex 同判），不入本 plan。
- 残缺 goal run 处置（task_79ae2be0）仍独立。
- 版本号 3.0.1 为建议，版本窗口用户控。

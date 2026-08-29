---
name: verifier 证据身份绑定 — subject 指纹与 JSON 真源收编
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan（分支策略：全部调整与测试在本分支做完再统一 cp 主干）。
# v1（2026-08-28）：综合三方定稿——宿主 bc-openCard-1 实锤（UT verifier 结束覆写 coding
#   verifier.report.md，当轮两次）、本会话根因深挖（hook 触发时读共享状态文件推断身份）、
#   codex P1 复审（时间线定位 + 假闭环路径 + 五件收口方案）。全部 ground truth 本轮核实：
# [实证1] hook 路由与 transcript 消费：record-verifier-report.mjs:314-331 触发时读
#   .current-phase.json 取 feature/phase 定落盘目标，:320 读 payload.transcript_path 提取
#   verdict；SubagentStop payload 未携带任何被消费的子 agent 业务身份。
# [实证2] 时间线三 commit（git 核实）：3eee7598（2026-04-27，Layer1+2+3 引入 hook，根缺陷
#   同时进入）→ ce15ea17（2026-06-12，goal headless 旁路防串台——只修 headless，attended
#   保留原缺陷）→ bd5a87e1（2026-07-15，verifier.report.md 纳入 evidence manifest——
#   本意正确，但使迟到错写升级为 closure stale 与级联重跑）。2026-08-28 两批改造
#   （ut-direct-attestation-baseline / contract-unified-parse-boundary）均未触碰本链路，
#   非引入者；宿主并发 verifier 是触发条件非根因。
# [实证3] check-receipt.ts:617-652：verifier 块只校验回执**手填** verdict 字符串、
#   invoked_via 正则、report_path 文件存在——不解析报告、不验身份、不对账内容。
# [实证4] phase-evidence-manifest.ts:145-150：verifier.report.md 在 PHASE_REPORTS_OUTPUT_FILES
#   保护面内被当机器证据冻结——闭环前错写会被忠实封存（假闭环路径），闭环后错写才报 stale。
# [实证5] record-verifier-report-hook.unit.test.ts:216 testB 明断言「interactive 按 state
#   写目录」——错误假设已固化为预期行为。
# [实证6·关键设计输入] 官方 SubagentStop 字段契约（claude-code-guide 查证）：agent_id /
#   agent_type / last_assistant_message 两处官方文档均确认在场；agent_transcript_path 仅
#   一处文档有；transcript_path 指向主会话还是子 agent **两处文档互相矛盾**，changelog
#   无版本记录。→ 设计定稿：不押注任何 transcript 指向，身份与结论以「subject 注入 +
#   终态块回显 + last_assistant_message」为主通道，对文档矛盾免疫；实施首项做实机
#   --debug 抓取 stdin 实况钉死当前版本字段（沙盒，不涉宿主）。
# v2（2026-08-28，吸收 codex 二轮 6P1+2P2，逐条 ground-truth 核实后修订）：
# [P1-1 采纳] 整份 summary SHA 入 subject 会在**正常闭环时自锁**——base summary 先以
#   closure_status=open 落盘（harness-runner.ts:1078 附近，本轮实证），receipt 过后
#   finalizer 改写 closed/closure_commit（phase-closure-finalizer.ts:504 附近，前轮已读）
#   → 整份 SHA 必变 → verifier JSON 闭环即 stale。定稿：runner 单点生成稳定
#   verifier_subject_id 写入 summary、open→closed 原样保留；输入=feature/phase +
#   script-report.json SHA + 去 subject 块后的 ai-prompt.md SHA + gate fingerprint +
#   worktree/source identity；**禁用整份 summary SHA**。ai-prompt.md 是 subject 的机器
#   生产入口，主 agent 原样交 Task，不得手抄。
# [P1-2 采纳·含事实修正] 终态块回显单独不构成调用绑定（只证明"自称审了谁"）。定稿三重
#   等值：agent_transcript_path 首条 user prompt 的 invocation subject == 终态块回显
#   subject == 当前 summary.verifier_subject_id，任一缺失/不等即 fail-closed；正文仍取
#   last_assistant_message（不读可能未 flush 的 transcript 尾部）。v1"官方文档互相矛盾"
#   表述降级：一轮查证曾见两处表述不一致，现以 hooks reference + TS SDK 契约为准
#   （transcript_path=主会话 / agent_transcript_path=子代理 / last_assistant_message=
#   子代理终答），T2 实测钉死；设计对字段缺失恒 fail-closed，两说均不押注。
# [P1-3 采纳] JSON 真源未收编全部机器消费者=留假闭环通道。本轮实证四处机器读/哈希 MD：
#   repair candidates（harness-runner.ts:1687）、multimodal evidence（check-receipt.ts:
#   1208）、review closure attestation（closure-attestation.ts:287 sha256File(md)）、
#   goal snapshot（goal-phase-snapshot.ts:10）。定稿：共享 loadVerifierEvidence() 解析
#   边界，机器消费者只从身份验真的 JSON 取 report_text/result/subject；MD 保留人读与
#   snapshot 存档但机器不读；attestation 改绑 JSON evidence hash 并处理 schema 演进。
# [P1-4 采纳] "同 subject 一律幂等"会吞相反 verdict。定稿：同 subject+同 agent_id+同
#   result hash=幂等；同 subject 不同 agent_id 或不同 result hash=conflict——canonical
#   JSON 原子转 state=conflict 记两侧 agent/result hash，check-receipt 必 FAIL；不留
#   先 PASS 吞后 FAIL。写入路径由 framework config+feature/phase 自行推导，subject 的
#   claimed path 仅作等值核对，绝不直接作写入目标（路径越界拒绝）。
# [P1-5 采纳] hook 完全退出 .current-phase.json 写面（v1 保留的 last_verifier_report/
#   last_seen_* 写回删除）。风险实测低：全仓 last_verifier_report 唯一读者是 hook 自身
#   单测（本轮 grep 实证）；state 会话新鲜度由 runner/check-receipt 既有刷新承担
#   （verifier 后必跑 check-receipt 是既有流程）。
# [P1-6 采纳] 行为矩阵冻结（消除实施者任选语义）：新建/重新闭环阶段=只认新 schema JSON；
#   已 closed+旧 manifest 有效=明确 grandfather（沿各自登记面，不迁移不追溯重裁）；
#   goal headless=保留现有非权威 bedside 旁路，本 change 不扩入 goal closure（goal-runner
#   spec 不动）；codeagent 与 Claude 共享 hook 模板——T2 实测须覆盖 codeagent payload
#   或冻结最低兼容契约（无子代理字段→恒 bedside 降级，不炸）。宿主验收修正：旧
#   summary/ai-prompt 无 subject，"只重跑 verifier"不可执行——须先重跑 harness 生成
#   subject 化产物再 verifier→receipt（仍分钟级、零业务改动，不加 prepare-verifier
#   新入口）。
# [P2-① 采纳] openspec 权责面补全：feature-artifact-layout（receipt schema、JSON/MD
#   权威关系）+ agent-adapters（SubagentStop payload 契约）+ harness-gates（attestation/
#   receipt/manifest）；goal-runner 不动（headless 未纳入）。
# [P2-② 采纳] 回归补四条：open→closed 后 subject 仍有效；同 subject 不同 agent/result
#   冲突；修改 MD 不改变任何机器结论；Claude/codeagent payload 兼容与路径越界拒绝。
# v3（2026-08-29，吸收 codex 三轮 3P1，逐条核实后修订；上轮自锁/吞 FAIL/隐藏消费者/
#   state 写面四项确认通过，last_verifier_report 删除获终审确认——Stop 新鲜度实际只读
#   session_id+updated_at（check-phase-completion.mjs:291），不得恢复写回）：
# [P1-① 采纳] grandfather 只有声明没有可执行分派——check-receipt 在 finalizer 前无条件
#   进 verifier 校验（check-receipt.ts:616），旧 closed 无 JSON 照 T3 必报 missing，
#   T4 的 manifest 兼容救不到。定稿唯一分派锚=**summary.verifier_subject_id 在场与否**
#   （新版 runner 必写、旧件必缺）：在场 ∧ policy.verifier=required → JSON 全套；缺席 ∧
#   closed ∧ 旧 manifest 仍 fresh → grandfather（只走既有 manifest freshness 链复核，
#   不解析 MD、不要求 JSON）；缺席 ∧ 未 closed → 指引先重跑 harness 生成 subject。
#   「对旧 closed 主动重跑 check-receipt」定稿为**复核旧 closure**（按其当时登记面），
#   不构成重新裁决——重新裁决只随新 harness run（summary 重生成）进入。补精确回归。
# [P1-② 采纳] loader"三重验真"会重新引入场外 transcript 依赖（v2 新引入风险）——JSON
#   未分存两个 subject 时，loader 要么重读外部 transcript（会话清理/换机/归档后仓内
#   有效证据失效），要么退化成单值自证。定稿：transcript 只在 hook 发布时读**一次**；
#   JSON 分别保存 invocation_subject 与 result_subject；loader 只验证这两者与当前
#   summary.verifier_subject_id 三者相等，**绝不重开 transcript**；agent_transcript_path
#   仅审计元数据；manifest 冻结 JSON。补回归：发布后删/移 transcript，check-receipt
#   仍凭仓内 JSON 验真通过。
# [P1-③ 采纳] 行为矩阵漏两个发布态：①policy.verifier=off（balanced 非保留 phase 合法
#   无 verifier，runtime-policy.ts:386 / check-receipt.ts:618 现状）——"新闭环只认 JSON"
#   限定为 policy.verifier=required；off 时 loader 不调用、JSON/MD 均不要求。
#   ②codeagent 缺字段"恒 bedside"实为"永不能闭环"，不是可用降级——codeagent 是正式
#   物化的 hard-hook adapter，不得静默带此状态发布。T2 双 adapter 实抓改 **go/no-go**：
#   字段齐→正常实施；不齐→按真实 payload 做 adapter-specific 绑定，或本 plan 阻塞发布/
#   明确撤销 codeagent verifier 支持——不得以永久 bedside 当完成。
# v4（2026-08-29，吸收 codex 四轮 2P1 措辞收口，无新机制无新测试）：
# [P1-① 采纳] 新旧 MD 机器语义分域统一——"编辑 MD 零机器影响"限定为**新 subject/JSON
#   闭环域**（MD 不解析、不入新 manifest）；grandfather 旧闭环域：MD 不再做语义解析，
#   但仍作为旧 manifest 登记字节参与 hash 对账，**修改即 stale**。回归 12 补前提：
#   "升级后仍 fresh"以既有 freshness 规则仍判 fresh 为前提——environment 重算
#   （phase-evidence-manifest.ts:752-760，本轮实证：framework_config/workflow/
#   gate_fingerprint/framework_version 四值比较）任一变化仍应 stale，grandfather
#   不绕过既有 freshness。
# [P1-② 采纳] 边界节残留否定 go/no-go 的旧措辞删除——改为：官方文档反馈本身不阻塞；
#   真实 payload 缺字段则触发 T2 go/no-go，在 adapter-specific 绑定完成或用户明确裁决
#   撤销支持前，**本 plan 不得完成**。
todos:
  - id: t1-runner-owned-subject
    content: T1 runner 单点生成稳定 verifier_subject_id（feature/phase + script-report sha + 去 subject 块 ai-prompt sha + gate fingerprint + worktree/source identity，禁整份 summary SHA）写入 summary（open→closed 原样保留）与 ai-prompt.md 机器块；verifier 模板规定唯一版本化终态块回显。
    status: completed
  - id: t2-hook-triple-binding
    content: T2 hook 重写：Claude+codeagent 双 payload 实测 go/no-go 先行（永久 bedside 不是完成态）；发布时一次性读 transcript，invocation/result 双 subject 分存 JSON 并与 summary.verifier_subject_id 三重等值；写路径自行推导（claimed path 仅核对）；幂等/conflict/stale/原子替换四态；完全退出 .current-phase.json 写面；字段缺失 bedside fail-closed。
    status: completed
  - id: t3-shared-evidence-boundary
    content: T3 共享 loadVerifierEvidence() 解析边界（只比仓内三值、绝不重开 transcript）+ 分派锚 summary.verifier_subject_id（required 走 JSON、off 不调用、grandfather 走旧 manifest 链）+ 全部机器消费者收编（check-receipt 验真、repair candidates、multimodal evidence、goal snapshot）；回执手填 verifier 字段退出裁决权威（只留兼容投影）。
    status: completed
  - id: t4-manifest-attestation-json-truth
    content: T4 manifest 保护面切 verifier.report.json、review attestation 改绑 JSON evidence hash（schema 演进处理）；MD 降为人读投影机器不读；已 closed 旧 manifest 明确 grandfather。
    status: completed
  - id: t5-regressions
    content: T5 回归十三件套：十件原案 + transcript 删除后仍验真（场外无依赖）+ grandfather 精确回归（旧 closed 升级后 fresh、改旧 MD 按旧 manifest stale）+ policy.verifier=off 行为等值；重写 testB 固化断言。
    status: completed
  - id: t6-openspec-and-docs
    content: T6 openspec change verifier-evidence-identity（feature-artifact-layout + agent-adapters + harness-gates 三面；goal-runner 不动）+ hooks 模板/runbook/receipt 模板/agents 文档同步。
    status: completed
overview: >
  P1：verifier 证据身份绑定缺陷。SubagentStop hook 自 2026-04-27 起以触发时的共享状态文件
  决定报告归属、从 payload.transcript_path 提取 verdict；06-12 只为 goal headless 打了旁路；
  07-15 报告纳入 evidence manifest 后，迟到错写升级为 closure stale 级联重跑，而闭环前错写
  会被 manifest 忠实封存成假闭环（check-receipt 只信手填 verdict + 文件存在）。根治：runner
  单点生成跨闭环稳定的 verifier_subject_id（经 ai-prompt.md 机器投递），hook 三重等值绑定
  （invocation subject == 终态块回显 == summary 现值，任一缺失即 fail-closed），JSON 成唯一
  机器真源且全部机器消费者经共享 loadVerifierEvidence() 收编，check-receipt 真验真，manifest/
  attestation 改绑 JSON；迟到拒写、同 subject 幂等/冲突分治、hook 退出 state 写面。不建
  数据库/签名/常驻服务/全局锁，不禁并发，净裁撤六项旧机制；legacy/headless/codeagent 行为
  矩阵冻结。
---

# verifier 证据身份绑定：subject 指纹与 JSON 真源收编（e5b8c3f7）

状态：**v4 已按 codex 四轮 2P1 措辞收口（新旧 MD 机器语义分域统一 + grandfather 不绕过既有 freshness + 边界节 go/no-go 残留清除），待终审确认后实施（未实施）**。
触发：宿主 SimulatedWalletForHmos bc-openCard-1（2026-08-28）UT verifier 结束时 hook 覆写 coding 的 verifier.report.md，coding 证据链 stale 被迫重跑，当轮第二次发生；宿主曾以"旁路件"规避（把 verifier 正文落到 hook 不覆写的路径）——用户已两次感知。

---

## 一、问题陈述与定性

**P1 级 verifier 证据身份绑定缺陷**，两种成灾形态：

- **闭环后错写** → `verifier.report.md` 在 manifest 保护面内 → 证据链 stale → 无辜阶段级联重跑（宿主实测形态）；
- **闭环前错写** → manifest 忠实封存错误证据，check-receipt 只校验手填 verdict 与文件存在（[check-receipt.ts:617](../../harness/scripts/check-receipt.ts)）→ **假闭环路径**：错报告可被当作合法凭证封进闭环。

后者比宿主实测形态更严重——这不是"多跑几遍"的效率问题，是凭证链完整性问题。

## 二、时间线与"是否新引入"

| 时间 | commit | 变化 | 结论 |
|---|---|---|---|
| 2026-04-27 | 3eee7598 | 引入 SubagentStop verifier hook（Layer 1+2+3） | **根缺陷同时进入**：state 文件定归属 + 读 payload.transcript_path |
| 2026-06-12 | ce15ea17 | goal headless 旁路防串台 | 病根已被认知，但只修 headless，attended 保留原缺陷 |
| 2026-07-15 | bd5a87e1 | verifier.report.md 纳入 evidence manifest | 本意正确；副作用=迟到错写升级为 closure stale 与级联重跑 |
| 2026-08-28 | （两批改造） | UT attestation-first / contracts 统一解析边界 | 均未触碰本链路，**非引入者** |
| 2026-08-28 | 宿主 | plan/coding/UT verifier 交错运行 | **触发条件，非根因**——潜伏竞争首次稳定复现 |

定性一句话：**错误归属是 4 月的老缺陷；级联 stale 是 7 月形成的组合缺陷；8 月并发只是第一次完整暴露。**

## 三、事故链与代码证据

```
UT verifier 结束（SubagentStop 触发）
  → hook 丢弃子 agent 身份与目标（payload 里的 agent 字段未被消费）
  → 读此刻的全局 .current-phase.json = coding          [record-verifier-report.mjs:314-331]
  → 读 payload.transcript_path 提取 verdict（指向语义官方文档自相矛盾，见实证6）[:320-324]
  → 报告写进 coding/verifier.report.md，头部 phase 字段同源错写
  → check-receipt 只信回执手填 PASS + 文件存在          [check-receipt.ts:617-652]
  → 闭环前错写=manifest 封存假证据；闭环后错写=stale 级联 [phase-evidence-manifest.ts:145-150]
  → 单测把 state 路由固化为预期行为                     [record-verifier-report-hook.unit.test.ts:216]
```

官方字段契约（实证 6，经 v2 修正）：现行 hooks reference + TS SDK 契约为 `transcript_path`=主会话、`agent_transcript_path`=子代理转录、`last_assistant_message`=子代理终答（一轮查证曾见两处文档表述不一致，按现行契约实施并以 T2 双 adapter 实测钉死）。设计对字段缺失恒 fail-closed，两说均不押注（见四）。

## 四、目标模型

```
harness run（script-report / ai-prompt / gate fingerprint / worktree identity）
  → runner 单点生成稳定 verifier_subject_id：
      sha256(feature | phase | script-report.json sha | 去 subject 块后的 ai-prompt.md sha
             | gate fingerprint | worktree/source identity)
      写入 summary（open→closed 原样保留）并嵌入 ai-prompt.md 机器块
  → 主 agent 把 ai-prompt.md **原样**交给 Task（不得手抄/改写 subject）
  → verifier 执行；输出以唯一版本化终态块收尾（回显 subject + verdict + blocker 计数）
  → SubagentStop：hook 三重等值绑定后发布 verifier.report.json（唯一机器真源）+ MD 投影
  → 全部机器消费者经共享 loadVerifierEvidence() 读身份验真的 JSON
  → manifest 冻结同一份 JSON 机器证据；attestation 绑其 evidence hash
```

**六件收口**（codex 两轮方案合并定稿）：

1. **subject 由 runner 单点生成且跨闭环稳定**：`verifier_subject_id` 输入=feature/phase + `script-report.json` SHA + 去 subject 块后的 assembled `ai-prompt.md` SHA + gate fingerprint + worktree/source identity——**禁用整份 summary SHA**（base summary open→closed 会被 finalizer 改写，整份 SHA 必变，正常闭环即自锁）。`ai-prompt.md` 是 subject 的机器生产入口：runner 生成时嵌入，主 agent 原样交 Task，不得重新手抄。
2. **三重等值绑定**（调用身份，非自称身份；**transcript 只在 hook 发布时读一次**）：hook 于发布时从 `agent_transcript_path` 首条 user prompt 提取 invocation subject、从 `last_assistant_message` 终态块提取 result subject，与当前 `summary.verifier_subject_id` 三者等值才发布；**invocation_subject 与 result_subject 分别存入 JSON**，此后一切验真只比仓内三值，**绝不重开 transcript**（会话清理/换机/归档后仓内证据必须自足）；`agent_transcript_path` 仅作审计元数据落 JSON。三者任一缺失或不等 → bedside fail-closed。报告正文仍取 `last_assistant_message`（不读可能尚未 flush 的 transcript 尾部）。字段契约以现行 hooks reference + TS SDK 为准；T2 首项对 **Claude 与 codeagent 两个 adapter** 实抓 stdin **go/no-go**：字段齐 → 正常实施；不齐 → 按真实 payload 做 adapter-specific 绑定，或本 plan 阻塞发布/明确撤销该 adapter 的 verifier 支持——**不得以永久 bedside 当作完成**（新闭环只认 canonical JSON，永久 bedside=该 adapter 永不能闭环）。
3. **JSON 唯一机器真源**：`verifier.report.json` 保存身份（agent_id/agent_type）、**invocation_subject 与 result_subject 两个独立字段**、严格解析的 verdict、BLOCKER 计数、完整正文与审计元数据（agent_transcript_path）；`verifier.report.md` 只是从 JSON 生成的人读投影。verifier 输出改为唯一版本化终态块，废除全篇正则找第一个 `verdict: PASS`。
4. **机器消费面全量收编**：新增共享 `loadVerifierEvidence()` 解析边界（身份验真后返回 report_text/result/subject），扫替全部机器消费者——check-receipt 验真、repair candidates（[harness-runner.ts:1687](../../harness/harness-runner.ts)）、multimodal evidence（[check-receipt.ts:1208](../../harness/scripts/check-receipt.ts)）、goal snapshot（[goal-phase-snapshot.ts:10](../../harness/scripts/utils/goal-phase-snapshot.ts)）；review attestation 从 `sha256File(md)`（[closure-attestation.ts:287](../../harness/scripts/utils/closure-attestation.ts)）改绑 JSON evidence hash（含 schema 演进处理）。MD 可随 snapshot 保存供人读，**机器不得再做语义解析**——否则 MD 被移出新 manifest 后编辑 MD 即可改机器结论而不触发 stale（新假闭环通道）。分域语义：**新 subject/JSON 闭环域**内 MD 不解析、不入 manifest，编辑零机器影响；**grandfather 旧闭环域**内 MD 仍作为旧 manifest 登记字节参与 hash 对账，修改即 stale（不做语义解析，但字节仍受保护）。check-receipt 校验五项：feature/phase 匹配、agent 身份在场、subject 现值、结构合法、verdict 与 BLOCKER 计数一致；回执手填 `invoked_via/report_path/verdict/ran_at` 退出裁决权威（只留兼容投影）。
5. **幂等与冲突分治 + 写路径自主**：同 subject + 同 agent_id + 同 result hash → 幂等；同 subject 但不同 agent_id 或不同 result hash → **conflict**：canonical JSON 原子转 `state=conflict` 记录两侧 agent/result hash，check-receipt 必 FAIL——绝不保留先 PASS 静默吞后 FAIL；新 subject 且匹配当前 summary → 原子替换；subject 过期 → stale，禁止覆盖 canonical（落 bedside）。**写入路径由 hook 按 framework config + feature/phase 自行推导**，subject 里的 claimed path 仅作等值核对，绝不直接作写入目标（路径越界拒绝）。
6. **hook 完全退出 `.current-phase.json` 写面**：`last_verifier_report`/`last_seen_*` 写回整体删除（全仓唯一读者是 hook 自身单测，实证低风险）；state 由 runner/check-receipt 维护，verifier 事实由 canonical JSON 表达；会话新鲜度由 verifier 后必跑的 check-receipt 既有刷新承担。

**行为矩阵（冻结，消除实施者任选语义）**：

**分派锚 = `summary.verifier_subject_id` 在场与否**（新版 runner 必写、旧件必缺），check-receipt 按此唯一分派：

| 场景 | 定稿行为 |
|---|---|
| subject 在场 ∧ `policy.verifier=required` | 只认新 schema JSON（三重比对 + 验真全套） |
| `policy.verifier=off`（balanced 非保留 phase 现状合法） | loader **不调用**，JSON/MD 均不要求（现状语义保留） |
| subject 缺席 ∧ closed ∧ 旧 manifest 仍 fresh | **grandfather**：只走既有 manifest freshness 链复核，不解析 MD、不要求 JSON；主动重跑 check-receipt = **复核旧 closure**（按其当时登记面），不构成重新裁决 |
| subject 缺席 ∧ 未 closed | 指引先重跑 harness 生成 subject 化产物，不进 verifier 校验、不认 MD |
| goal headless | 保留现有非权威 bedside 旁路（携带 subject），本 change **不**扩入 goal closure，goal-runner spec 不动 |
| codeagent adapter | 共享 hook 模板；T2 实抓 **go/no-go**：字段齐→正常；不齐→adapter-specific 绑定或阻塞发布/明确撤销支持，**永久 bedside 不是完成态** |

重新裁决只随**新 harness run**（summary 重生成、subject 换代）进入——这是 grandfather 与新裁决域的唯一切换点。

**可裁撤清单**（净删六项，无新增基建）：`.current-phase.json` 的 verifier 路由职责与**全部写回**；主 transcript 解析；回执手填 verifier 机器事实；Markdown 机器真源（含四处隐藏消费点）；attended/headless 报告定位的猜测式分支；"文件存在即有效"的校验。

明确不做：数据库、签名体系、常驻服务、全局锁、禁止并发。

## 五、实施批次（待 review 后动手）

### T1 runner 单点生成 subject（生产入口=ai-prompt.md）
- harness-runner 在组装 `ai-prompt.md` 时生成 `verifier_subject_id`（输入见四-1，**不含整份 summary SHA**），同时写入 base summary 字段（finalizer 的 closure patch 保证 open→closed 原样保留——补断言）与 ai-prompt.md 的版本化机器块。
- verifier 触发面盘点（skills Step 8.2、goal runtime 的 verifier 调用、`harness/prompts/verify-*.md` 全套模板）：调用方一律**原样投递 ai-prompt.md**，模板尾部规定唯一终态块格式（回显 subject + verdict + blocker 计数）。

### T2 hook 重写（record-verifier-report.mjs）
- 首项：沙盒实抓 SubagentStop stdin 实况（`claude --debug` + 临时 dump hook），**Claude 与 codeagent 两个 adapter 都抓、go/no-go 裁决**（不涉宿主）：字段齐 → 正常实施；不齐 → 按真实 payload 做 adapter-specific 绑定，或本 plan 阻塞发布/明确撤销该 adapter 的 verifier 支持——永久 bedside 不是完成态。实况入 plan 附录。
- 主流程按四-2/3/5 重写：**发布时一次性**读 transcript 提取 invocation subject（`agent_transcript_path` 首条 user prompt）与 result subject（`last_assistant_message` 终态块），双 subject 分存 JSON；写路径由 config+feature/phase 自行推导，claimed path 仅等值核对；幂等/conflict/stale/原子替换四态处置。
- **完全删除 state 写面**（四-6）：不再写 `last_verifier_report`/`last_seen_*`；bedside fail-closed 分支统一（goal-headless 与身份缺失同语义）。
- 同步 `.claude/settings.json` 与 codeagent 模板的 matcher 核对（按 agent type 匹配）。

### T3 共享解析边界 + 消费者收编
- 新增 `loadVerifierEvidence(projectRoot, feature, phase)`：推导 canonical JSON 路径 → **只比仓内三值**（JSON 内 `invocation_subject` == `result_subject` == 当前 `summary.verifier_subject_id`）+ 结构验真 → 返回 `{subject, result, report_text}`；**绝不重开任何 transcript**（仓内证据自足，会话清理/换机/归档后不失效）；conflict/stale/缺失/错位各自独立结构化错误。
- check-receipt 分派按四节行为矩阵（锚=summary.verifier_subject_id 在场与否）：`policy.verifier=off` 不调用 loader；grandfather 场景不解析 MD、不要求 JSON，只走既有 manifest freshness 链复核。
- 扫替四个机器消费点：check-receipt 验真块（五项校验见四-4，slim/legacy 同一函数；失败形态各自独立 issue id，话术指向重跑 verifier 而非改文书）、repair candidates（harness-runner.ts:1687）、multimodal evidence（check-receipt.ts:1208）、goal snapshot（goal-phase-snapshot.ts:10——snapshot 仍可存 MD 供人读，机器字段取自 JSON）。
- 回执手填 `invoked_via/report_path/verdict/ran_at` 退出裁决权威，保留兼容投影至少一个 minor 窗口。

### T4 manifest + attestation 真源切换
- `PHASE_REPORTS_OUTPUT_FILES`：`verifier.report.md` → `verifier.report.json`；MD 不入**新** manifest 保护面（可从 JSON 重建，**新闭环域内**被编辑零机器影响；grandfather 旧 manifest 里的 MD 字节对账照旧，修改即 stale）。
- review closure attestation：`verifier_report_sha256` 改为绑定 JSON（closure-attestation.ts:287），schema_version 演进 + 消费端（testing 对账 / check-ut goal 分支）兼容处理。
- 存量兼容按行为矩阵：已 closed 阶段沿各自 manifest 登记面（grandfather），新闭环起用新面；两面都不认的报告形态=BLOCKER。

### T5 回归测试（十三件，缺一不可）
1. plan/coding/UT verifier 交错结束 → 各自只写自己阶段；
2. 主会话说 PASS、子 verifier 说 FAIL → 最终必 FAIL（主 transcript 不再是来源的构造性证明）；
3. 旧 summary 的 verifier 迟到 → 不得覆盖新报告；
4. 伪造回执 PASS + 放任意 Markdown → 必 FAIL（验真闭环）；
5. hook → receipt → manifest 全链后 fresh；真正修改 JSON 机器证据才 stale；
6. 缺官方子 agent 身份字段 → bedside fail-closed，不回退全局 state；
7. **open→closed 正常闭环后 subject 仍有效**（P1-1 回归：finalizer patch 不失效 verifier JSON）；
8. **同 subject 不同 agent_id / 不同 result hash → conflict 态且 check-receipt FAIL**（不吞后到的 FAIL）；
9. **新闭环域内修改 MD 不改变任何机器结论**（四处消费点逐一断言；grandfather 域的 MD 字节对账由回归 12 覆盖）；
10. **Claude/codeagent payload 兼容 + claimed path 越界（../ / 绝对路径 / 跨 feature）拒绝**；
11. **transcript 场外无依赖**：hook 发布后删除/移动 agent transcript → check-receipt 仍凭仓内 JSON 验真通过；
12. **grandfather 精确回归**：旧 closed + 旧 manifest + 无 JSON，升级后 completion/preflight 仍 fresh——**前提是既有 freshness 规则仍判 fresh**（environment 重算比较 framework_config/workflow/gate_fingerprint/framework_version，[phase-evidence-manifest.ts:752](../../harness/scripts/utils/phase-evidence-manifest.ts)，任一变化仍应 stale，grandfather 不绕过）；修改旧 MD → 仍按旧 manifest 字节对账判 stale（旧登记面继续生效）；
13. **policy.verifier=off**：loader 不被调用，JSON/MD 均不要求，闭环行为与现状等值。
- 重写 [record-verifier-report-hook.unit.test.ts:216](../../harness/tests/unit/record-verifier-report-hook.unit.test.ts) testB（state 路由断言翻转）与 :255 起的 state 写回断言（写面已删，终审确认不得恢复——Stop 新鲜度只读 session_id+updated_at，check-phase-completion.mjs:291）。

### T6 openspec + 文档
- 新 change `verifier-evidence-identity`，spec delta 三面：`feature-artifact-layout`（receipt schema、JSON/MD 权威关系）、`agent-adapters`（SubagentStop payload 消费契约与降级矩阵）、`harness-gates`（attestation/receipt/manifest 绑定面）；**goal-runner 不动**（headless 未纳入）。与两批 08-28 change 无重叠（本链路它们未触碰，实证 2）。
- 同步：hooks 模板注释、`docs/operations/harness-runbook.md`、receipt 模板 verifier 段、`agents/README.md`。

## 六、验收场景（完成判据）

1. T5 十三条回归全绿 + 既有 hook/receipt/manifest 单测全绿；`npm test` / `openspec:validate` / `check-plan-version` 全绿。
2. 并发场景构造性验证：两个 verifier 交错 SubagentStop，零错位、零覆写。
3. 假闭环路径关死（双向）：闭环前落一份身份错位报告 → check-receipt FAIL、manifest 不封存；**新闭环域内编辑 MD → 全部机器消费者结论零变化**（grandfather 域改 MD 按旧登记面 stale）。
4. 宿主回灌（用户驱动，先问再碰）：**不全量重做，但也不承诺"只重跑 verifier"**——旧 summary/ai-prompt 没有 subject，正确路径是对受影响阶段**重跑 harness（生成 subject 化 summary/ai-prompt，分钟级）→ 重跑 verifier → check-receipt 重闭环**；不改业务代码、不提交工作区、不从 spec 重走。业务 UT 21/21 与 attestation 对账仍然为真，不受影响。

## 七、边界与悬置（防膨胀）

- 不建数据库/签名体系/常驻服务/全局锁/额外账本；不禁并发 verifier——并发是被支持的正常形态，收口靠身份而非互斥；conflict 态记录在 canonical JSON 自身。
- goal headless 按行为矩阵冻结：保留非权威 bedside 旁路（携 subject），不扩入 goal closure，goal-runner spec 不动；goal 侧单写者边界（vision ledger、b7e4d2a9 谓词）只复核不重构。
- 官方文档一轮查证曾见表述不一致——按现行契约实施并以 T2 双 adapter 实测钉死；**文档反馈本身不阻塞本 plan**（如实测再现不一致另行 /feedback 反馈 Anthropic）。但**真实 payload 缺字段则触发 T2 go/no-go：在 adapter-specific 绑定完成或用户明确裁决撤销支持前，本 plan 不得完成**——永久 bedside 不是完成态。
- 存量残缺 goal run 的处置出路是另一独立缺陷（已挂卡 task_79ae2be0），不入本 plan。
- 宿主侧精确重建属宿主动作，用户驱动，不入本 plan 交付物。
- 回执模板字段兼容窗口：手填字段保留为投影至少一个 minor 窗口，防存量回执解析断裂；退出裁决权威即时生效。

---

## 附录 A｜T2 首项 SubagentStop payload 实抓实况（2026-08-29 实施轮回填）

**方法与偏差（如实记录）**：先按 T2 原方法做实机抓取——在会话 scratchpad 下建沙盒工程，
`.claude/settings.json` 注册 `matcher: "verifier"` 的 stdin dump hook、`.claude/agents/verifier.md`
探针子 agent，跑 headless `claude -p`。**认证阶段失败**：宿主进程在内存里持有 OAuth 令牌，磁盘
`~/.claude/.credentials.json` 的 `expiresAt=0`，嵌套 CLI 无法刷新（`OAuth session expired and could
not be refreshed`）。沙盒已清理。遂改从**同版本发行二进制**（`@anthropic-ai/claude-code` 2.1.246
的 `bin/claude.exe`）内直接读取 zod schema 与 hook payload 发射点——它钉的是当前版本**实际发出**
的字段，比文档更硬，满足 T2「实况钉死字段、不押注文档」的目的。

**Claude Code 2.1.246 · schema**：
`SubagentStop` = base ∧ `{ stop_hook_active: boolean, agent_id: string, agent_transcript_path: string,
agent_type: string, last_assistant_message?: string, background_tasks?, session_crons? }`；
base = `{ session_id, transcript_path, cwd, prompt_id?, permission_mode?, agent_id?（"Present only
when the hook fires from within a subagent"） }`。`last_assistant_message` 的 describe 原文：
"Text content of the last assistant message before stopping. Avoids the need to read and parse the
transcript file."

**Claude Code 2.1.246 · 发射点**：
`{...base, hook_event_name: "SubagentStop", stop_hook_active, agent_id: <子 agent id>,
agent_transcript_path: <由子 agent id 推导>, agent_type: <type> ?? "", last_assistant_message: <子代理终答>}`。
二进制内的 hook 说明同样写着 "Input to command is JSON with agent_id, agent_type, and
agent_transcript_path"。**这解决了 v1 实证 6 记录的文档矛盾**：`transcript_path`=主会话、
`agent_transcript_path`=子代理，按现行契约实施成立。

**go/no-go 结论**：
- **Claude adapter = GO**，消费的字段全部在场，按正常方案实施。
- 两处真实弱点已进实现：`agent_type` 是 `a ?? ""`（可能空串）——只如实记录、不据此 fail-closed
  （hook 能触发本身已证明 matcher 命中）；`last_assistant_message` 是 optional——缺席即 bedside
  fail-closed。
- **codeagent adapter = 实施机器抓不到 → 用户在有 CLI 的宿主环境补抓 → GO**。实施机器上没有
  `codeagent`/`codeagentcli`（全局 npm 只有 claude/codex/opencode/openspec/pi），仓内也无历史
  样本，按红线 3 停下报告未自行裁决；用户先裁决「挂起绑定」，随后于 **2026-08-29 在宿主环境完成
  实抓**（一次性探针沙盒：`.cac/settings.json` 注册 SubagentStop×2 / SubagentStart / Stop /
  PreToolUse dump hook + `.cac/agents/verifier.md` 探针子 agent + 带真实 subject 机器块的
  `ai-prompt.md`，`codeagentcli -p --dangerously-skip-permissions < task-prompt.txt`）。

  **实况**：payload keys = `session_id` / `transcript_path` / `cwd` / `permission_mode` /
  `agent_id` / `agent_type` / `is_kia_repo` / `process_id` / `hook_event_name` /
  `stop_hook_active` / `agent_transcript_path` / `last_assistant_message`。四个消费字段全在场；
  `transcript_path` ≠ `agent_transcript_path` 且后者指向真实文件、其首条 user prompt 逐字复现了
  原样投递的 `ai-prompt.md`——invocation 与 result 两侧 subject 均解析成功且相符。
  `CODEAGENT3_PROJECT_DIR` 已注入。相对 claude 多 `is_kia_repo` / `process_id`（本 hook 不消费，
  未知字段忽略），少 `prompt_id`（claude 侧本就可选）。**结论：GO，共享 hook 直接成立，无
  adapter-specific 分支。**

  **同时推翻了一条理由（不是一条行为）**：codeagent **不按 agent type 过滤 SubagentStop 的
  matcher**——两次事件里 catchall 与 `matcher:"verifier"` 各触发 2 次，其中一次的
  `agent_type` 是空串。实现行为本就正确（非 verifier 子 agent 的转录没有机器块 →
  `invocation_subject_absent` → bedside，永不发布），但原措辞「hook 能触发本身已证明 matcher
  命中」在该 adapter 上为假。已改：hook 注释与 `agent-adapters` delta 的依据换成「`agent_type`
  根本不参与绑定」，并给回归 ⑥ 补了一条「非 verifier 子 agent（matcher 过度触发）→
  invocation_subject_absent」的变体。t2 随之收口为 `completed`。

## 附录 B｜实施期发现的 plan 与代码现状冲突及用户裁决

**冲突**：四-1 的 subject 输入面直取 `script-report.json` SHA 与 `ai-prompt.md` SHA，但这两份产物
都内嵌墙钟时间戳——`generateScriptReport` 写 `timestamp: new Date()`（report-generator.ts:129），
`assembleAIPrompt` 替换 `{timestamp}`（:261）且把整份 script-report 内嵌进 prompt。照字面实施则
**任何一次 harness 重跑（哪怕零改动）都会换代 subject**，已发布的 verifier 证据立刻 subject_mismatch。
而"跑完 verifier 再跑一次 harness 来关环"是现存一等闭环路径（harness-runner 每轮末尾都会
tryValidateReceipt + finalizePhaseClosure，既有用例 `E2E goal gate` 明确断言它）——这与 v2 P1-1 要
根治的自锁同类，只是触发点从 finalizer 改写换成了 harness 重跑。（goal 路径不受影响：走
`--sync-closure`，不重生成 summary。）

**用户裁决（2026-08-29）：输入时间戳归一。** 保持 plan 的输入面不变，但派生前对两份产物做
ISO-8601 时间戳归一（`normalizeVolatileTimestamps`，verifier-subject.ts）。语义正是四节想要的：
门禁事实 / prompt 内容 / gate 指纹 / 源码身份**任一真变**才换代 subject（重新裁决随之进入），纯重跑
不换代。回归 ⑦ 之外另有构造性证明：`e2e-spec-requirement-closure` 的 goal-gate 用例在归一后由红转绿
（真实 harness 重跑后仍能凭原证据关环）。

## 附录 C｜第二轮独立评审（2026-08-29）判「暂不通过」及收口

评审结论：主方向成立（subject 绑定 / JSON 真源 / MD 退权 / hook 退出共享 state 四项通过），但有
5 个机制性阻断，其中 2 个可造成假闭环。全部已修，且每条都补了**能抓住原缺陷**的回归——三条新增
回归都做了变异验证（把修复退化回去，对应用例立刻转红），不留空转断言。

| 级别 | 缺陷 | 收口 |
|---|---|---|
| P0 | 并发发布 last-writer-wins：原子替换只保证不写半截，不保证「读→裁决→写」原子；两个同 subject 的 verifier 都读到"无文件"就双双写 published，PASS 吞 FAIL | CAS 循环：首次发布走原子 create-if-absent（`link()`，退化路径 `wx`）；conflict 对同 subject 单调吸收；旧 subject 件先原子让位。新增用例 ⑧b 真并发两进程 ×4 轮 |
| P1 | subject 指纹两头都不准：对最终自由文本叠 ISO 正则，抓不到 `耗时 … ms`（零改动重跑也换代 → 自锁），却抹掉业务正文的真实 ISO 截止时间（需求真变却不换代） | 在格式化**之前**从结构化事实排除 telemetry：`canonicalScriptReportDigest()` + 装配侧同源的 prompt 规范化摘要；ISO 正则整体删除。新增套 `verifier-subject-material` |
| P1 | `result_sha256` 只查非空即采信：把合法 FAIL 件局部改成 PASS、保留原 hash，可整份通过验真 | loader 用生产 SSOT 重算严格比对 + 形态校验，新增错误码 `result_hash_mismatch` |
| P1 | reports 路径三份真源：hook fallback 用旧布局、manifest 手拼 `receiptDir/reports`、attestation 重建路径 | 全部收敛到 `featurePhaseReportsDir`；并把它里面**不必要的急切 frameworkRoot 求值改成惰性**（那正是各方另拼路径的动因），连 loader 里那份兜底也删掉。新增用例 ⑩b 跨实现路径等价 |
| P1 | 两条恢复指引不可执行：conflict 教"重跑 harness 换代 subject"（本设计下 subject 恒定 → 死锁）；Stop hook 教"传入 feature/phase/路径"（照做必落 invocation_subject_absent） | conflict 改为可执行三步（停全部 verifier → 删 conflict 件 → 只起一个、原样投递 ai-prompt.md）；Stop hook 改为明示投递全文 |

裁剪三项：七份 `verify-*.md` 的协议副本删除（运行时机器块是唯一出口，静态副本是第二份会漂移的
真源）；回执投影校验收窄到唯一有机器对应物的 `verdict`；21 个文件的 CRLF 归一为 LF（**未改动
任何 git config**——那是用户环境）。

一处**未修、如实记录**：评审的一次全量跑出现 1 个 E2E 失败（跨 suite 在仓库自身 `doc/features`
观察面上的干扰），隔离重跑 4/4 绿。本轮多次全量复跑均未复现，且与本 plan 的改动面无因果；不宣称
已修，作为开放观察项留档。

## 附录 D｜第三轮独立评审（2026-08-29）两个 P1 及收口

上一轮 5 项确认已修、无新扩面；本轮两个 P1，均已收口并做变异验证。

**P1-1 迟到的旧 subject 仍能挪走并覆盖当前证据（TOCTOU）**。入口那次 summary 校验会在 CAS
期间过期：旧 hook 过校验 → runner 换代 → 新 verifier 发布当前证据 → 旧 hook 恢复，此时它以
「文件 subject ≠ **我的** subject」为让位判据，把当前证据挪进 superseded 并回写旧 subject。
后果是**有效证据被销毁**（消费侧仍 fail-closed，不是假闭环，但违反已写入规格的"迟到不得覆盖"）。
收口取评审给的第二条路：**发布循环每轮重取 summary 现值**，授权判据改为「文件 subject ≠
summary 现值 **且** 我就是 summary 现值」——旧 subject 从此没有移动当前 subject 文件的权限；
不再是当前 subject 的一轮整体停手（不创建、不让位、不改写），落 bedside
`subject_rotated_during_publish`。不引入锁、不串行 verifier 执行。

**P1-2 script-report 投影过度裁剪**。prompt 摘要把整份 script report 换成占位符，绑定责任
全落在投影上；而投影只留四字段，漏掉 `failure_kind` / `actionability` / `affected_files` /
`source` / `structured` 与全部自由文本——`ai-prompt.md` 真变了、subject 却不变，旧 PASS 被复用。
收口按评审边界：投影改为**排除式**（默认纳入全部字段，含未来新增），只排除一个**显式 telemetry
域**；新增 `check-telemetry.ts` 与 `CheckResult.details_material`，生产端用
`renderDetailsWithTelemetry()` 以同一模板渲染两遍（人读留耗时 / material 拿占位符），5 处内嵌
耗时的生产点全部改造（ut-host-impl ×3、coding-host-rules ×2）。**不再维护白名单，也不恢复
自由文本正则。**

回归三组（E 逐字段消融必换代 / F 仅 telemetry 不换代 / G 生产端漏用 helper 时诚实换代），
其中 G 把"纪律成本"钉成可见契约而不是留一条看不见的坑。三条新增回归与 ③b 均做过变异验证。

顺带修了一处被签名变更打破的源码接线断言（`product-selection-t5`），意图不变、匹配串更新。

## 附录 E｜第四轮独立评审（2026-08-29）两个阻断及收口

**P0 不同 subject 共用同一文件，授权复查仍是 check-then-act**。评审的定性成立且我上一轮判断
失误：把"我还有权限吗"这次复查放得再晚，它与"改共享文件"仍是两步，两步之间就能换代——授权
检查只能挪动窗口，消不掉。上一轮的 ③b 也确实只覆盖了"挂起在重读之前"，没覆盖真正的窗口。
改用评审给的另一条路：**证据按 subject 分区**（`verifier.report.<64位subject>.json` + 同名
`.md`）。三条规则：`summary.verifier_subject_id` 单独决定当前证据是哪一份；不同 subject 永远
写不同文件、谁也无权移动别人的；同 subject 的并发仍走 CAS + conflict 单调升级。随之**删除**
`stepAsideSuperseded`、`verifier.report.superseded.json`、循环内反复授权判断、跨 subject 的
让位/替换与 `rotatedMidFlight`。文件自述 subject 与文件名不符即 fail-closed，不移动不修复；
旧 subject 文件留在原地不清理（自动清理会重新引入并发删除）。

**P1 ScriptReport 顶层仍是白名单**。check 层改成排除式之后，顶层还手写着六个字段，于是
`capability_resolutions` / `compat_applied` / `compat_expired` 与将来新增的顶层语义字段整组
不绑定——与 check 层同一类静默失败。改为**整份报告排除式**：只解构掉 `timestamp` /
`project_root`，其余顶层字段（含未知/未来字段）默认进入，摘要版本提到
`script-report-material@3`。

两条验收线各自做了变异验证：退回固定文件名 → ③b 整套转红；顶层退回白名单 → 新增用例 H 立刻
转红。未按禁止清单增加任何东西——无第三次 summary 复查、无锁/租约/current 指针、无 superseded
状态机、无自动清理、无新白名单、无自由文本正则。

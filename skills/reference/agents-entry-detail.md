# AGENTS.md 入口模板详细规则（条件加载：需要展开某条红线细则时读）

> **输入协议边界（仅正式阶段与机器 request）**：只审查、解释或设计用例仍先阅读真实代码和依据，但不建立身份/facts、不创建正式产物、不进入阶段确认/闭环。以下落盘与量化要求只用于正式或机器请求；以下 旧出生协议为 spec 的 facts 建立与固定上游阅读口径仅适用于 1.0。收到 runtime/专项入口明确提供的 1.1 调用上下文时，按[输入契约与 Facts 1.1](../../docs/concepts/skill-contracts.md#facts-11)读取真实内容与来源：首个实际 Skill 在主产出前建立 facts，后续或成功前驱基线只补本次 phase_delta；不补跑 spec、不伪造建立身份。无 Feature 时只用入口指定的 request report-dir/context/facts.md。调用上下文由实际入口解析，不自行补造。

> SSOT 索引见实例根 `AGENTS.md`（由 `framework/templates/AGENTS.md.template` 渲染）。本文承载该模板 §三 红线清单每条的完整判据文本、§4.1 主 agent/verifier 职责切分反误读全文、§4.2 实例扩展生命周期钩子细则、§5 交付凭证与闭环判定/会话边界/跨会话恢复完整机制、§六 交互硬规则完整表述。实例路径（架构文档/模块画像/术语表等）以渲染后 AGENTS.md §二 SSOT 表为准，本文不重复模板占位符。

## 路径术语表（共享 reference，M5A 定义一次）

框架文档与技能中的 `<features_dir>/<feature>/…` 指**物理 Feature 路径**，其中：

- `<features_dir>` = `paths.features_dir`（默认 `doc/features`），为根目录 SSOT，全框架经唯一解析；
- `<feature>` = **物理相对路径**，由框架唯一 SSOT（逻辑 featureId → 物理路径的纯函数）解析：
  - 老式平铺 Feature：`<feature> = <feature_id>`（目录名即身份）；
  - Change-Unit Feature（逻辑 id = `cu-` + base64url(`blueprint_id\0change_unit_id`)）：`<feature> = <blueprint_id>/<change_unit_id>`，即演进工作区子目录，同时持有该 CU 的 `change-unit.yaml`。

`<features_dir>/<feature>/…` 一律由框架解析（CLI 输出 / SSOT / harness 产物路径），**不得**手工把逻辑 identity（含编码后的 `cu-…`）拼接进路径；`cu-` 前缀的非法 payload 一律 fail-closed。

## 架构守门（BLOCKER）

1. 层间依赖方向严格按 `framework.config.json` → `architecture.outer_layers` 声明，任何反向依赖一律拒绝。
2. 模块内依赖方向按 `architecture.module_inner_layers` + `inner_dependency_direction` 声明，禁止反向依赖。
3. 跨模块访问必须通过 `architecture.cross_module_exports_file` 声明的出口文件（实例配置为准），禁止深路径 import。

`enforced_by`：check-coding（层/依赖）。

## 术语守门（BLOCKER）

1. spec 必须以 `## 0. 术语映射表` 章节起始，列出原始术语 → 权威模块的映射（见 spec Step 1.5）。
2. 所有映射必须逐条人工确认（用户把 `[ ]` 改成 `[x]`），不启用 auto-approve；即便置信度 high 也必须确认。
3. 每一条映射的权威模块必须存在于模块画像（Catalog）；否则 `terminology_mapping_table` BLOCKER 阻塞。
4. 术语命中其他模块的 `easily_confused_with` 时，必须显式亮给用户看，不允许静默忽略。
5. 用户批准的新术语/修正后的映射必须回写到术语表（Glossary），作为下一次复用种子。

`enforced_by`：check-spec（术语/scope）。

## Scope 守门（BLOCKER）

1. spec 必须声明 `in_scope_modules`/`out_of_scope_modules`/`rationale`（见 spec SKILL）。
2. 二者的每个模块名都必须在模块画像中存在（`scope_matches_catalog` BLOCKER），禁止自造模块名。
3. plan.md 必须继承 spec 的 scope；如需扩展，必须停下来向用户发起「Scope 扩展提议」，获得用户明确批准后写入 `expansions_with_user_approval` 才可继续（见 plan Step 2.5）。
4. 编码阶段 git diff 涉及的所有文件必须落在 plan 的 `in_scope_modules` 内（`doc/`、`specs/`、`framework/` 等框架/实例基础设施目录除外）。
5. 严禁静默扩展：任何"顺手改一下"都必须回到 plan 阶段走扩展提议流程。

`enforced_by`：check-spec（术语/scope）。

## 宿主 toolchain 正确性守门（BLOCKER）

由渲染时注入的 `{{PROFILE_AGENT_GUARDRAILS}}` 段承载（各 project_profile 的宿主专属工具链/编译能力守门规则，见对应 `framework/profiles/<name>/skills/*/profile-addendum.md`）。`enforced_by`：compile capabilities。

## 文档与代码同步

- plan.md 与 `contracts.yaml`（文件路径/接口签名/数据模型/组件 Props/资源 key）是编码阶段的强契约；机器可读真源以 `contracts.yaml`/`use-cases.yaml` 为准，实现必须与之一致。
- `<features_dir>/<feature>/`（默认 `doc/features`）默认不假定提交进主代码仓——由 `framework.config.json` → `paths.docs_committed` 管控；脚本 harness 与工作区快照优先，completion receipt 不强求未入库即失败。含 UI 形态的 spec 应当声明 `ui_change`/Visual Handoff；非 UI/后端类需求不做硬性要求。
- feature 需求交付不自动触发架构文档更新——架构文档只承载架构级契约，不承担 feature 级变更日志（后者由 git 与 `<features_dir>/<feature>/` 承担）。
- 仅当 plan.md 的架构影响声明 `impact != none`（`dsl_change`/`module_set_change`/`responsibility_rewrite`）时，按 plan · Step 12 分支更新架构文档/模块画像/`framework.config.json` 的相应段落，并在架构文档的「架构级变更记录」追加一行。
- 模块画像是模块职责/公共能力/易混点的唯一 SSOT；不要把这些细节复制到架构文档。

## Context Facts Gate（BLOCKER，C4 exploration-scale）

该 track 首个 feature phase（旧出生协议为 spec）在写入该阶段主产物前，须在 `<features_dir>/<feature>/context/facts.md` 建立全量事实（frontmatter + `## Code Facts` 表，`source_code_paths` 与可核实的量化阈值由 harness BLOCKER 校验；`decisions_unlocked`、自报的文件数与搜索次数仍须如实填写，缺了会被披露并计入完成缺口、不单独阻断，`ready_to_produce: true` 须真实探索后手动设定）。后续所有 active feature phase（plan/coding/review/ut/testing）只追加 `## phase_delta: <phase>` 增量节（无新增事实须显式写 "none"），不重做全量探索。work-unit 独立复审除外：只读 facts，不追加增量节，新事实写入指定审查报告。契约实现见 `framework/harness/scripts/utils/context-facts.ts`；旧版 per-phase `<phase>/context-exploration.md` 仍可读（WARN 提示 backfill），阶段步骤与宿主侧补充路径以各 SKILL 及 profile-addendum（若有）为准。

`enforced_by`：context-facts。

后续阶段的必读输入登记以已核基线加本阶段 `phase_delta` 路径表共同核对；探索模式只在建立事实时检查。输入登记/探索模式的四项过程差异按统一去向表披露，普通 Feature 与 request 一致，不靠改头部、换 run 或填豁免绕过。真实来源、目标覆盖、身份、基线新鲜度和产品检查仍须满足；已有 verifier 的真实否决仍有效。

## Agent 行为规约（BLOCKER）

1. 进入任一 feature 阶段（spec/plan/coding/review/UT）的 Research Sub-Phase 前，须完整阅读 `framework/skills/reference/agent-behavioral-principles.md`。
2. Research First：能由当前目标裁决的不确定，按目标裁决并留痕；目标本身冲突或缺失且无法裁决时才停下来问（见行为规约「权威判定」）；代码与文档冲突时以代码为准并显式标注；达到阈值时必须使用 explore subagents。
3. Minimum Viable：产出不得超出用户诉求/上游契约（spec→plan→contracts→code）范围；禁止投机性抽象或"顺便加上"。
4. Surgical：coding/review 仅触碰 scope 内变更；禁止顺手改相邻格式、注释或无关文件。
5. Verify Before Proceed：Context Exploration 完成后自检路径存在性与 Code Facts 充分性；逐文件 lint/局部 harness，禁止批量产出后统一验证。
6. 语义级行为合规由本规约 + Layer 2 量化门禁（context-exploration 阈值、写边界、diff 范围）enforcement；verifier 不再单列 `behavior_*` 检查项（plan 07a41ec6：verifier 只做首轮语义结论与跨产物引用核对）。

## 阶段边界推进（BLOCKER）

检查PASS/closed不扩大原请求授权；完整交付按已有授权由同一协调器持续到原终点，不在phase边界重复确认或派冷作者。专项请求仍止于本次职责。确认与实际授权规则见 user-confirmation-ux §8。

## 独立阶段核验

本节是全局入口 §4.1 的执行约定。阶段执行者有权按职责运行 `harness-runner.ts --phase <phase> --feature <feature>`，读取原脚本报告及 NEXT。完整交付由原 Goal 协调器推进，主会话只转交、观察和呈现。

1. **完整交付**：作者遇到待核时交回脚本状态、原 request 路径及报告目标，保持当前材料供核验。有人在场时，主会话在已有 NEXT 请求上执行 `execute_command`，已绑定则用 `observe_command` 续等。无人值守由后台运行时持有同一次调用。独核拒绝时由协调器带原报告和发现交回原作者，按可用的原会话续作。
2. **单阶段直跑**：NEXT 指示待核时，在当前任务授权内从客户端工具运行下列命令并等待交回。首次派发按[阶段核验的模型来源](stage-verifier-model.md)转交本轮模型。工具限时或断连后，重跑同一条命令即可续等；已绑定的调用使用原模型，已采纳的结果直接返回。无人值守的单阶段调用者使用同一入口。明确取消时在原命令追加 `--cancel-verifier`。用户明确要求恢复已取消或过期的原调用时，追加 `--resume-verifier <invoke_id>`。原任务截止已到时同时传入用户新授权的 `--user-deadline-at <UTC timestamp>`。

   ```bash
   cd framework/harness && npx ts-node harness-runner.ts --execute-verifier --phase <phase> --feature <feature>
   ```

3. **签发和报告**：适用性由 profile、workflow 与 evidence policy 决定。签发既覆盖正常 PASS，也覆盖已有实质证据的诊断 FAIL（`run_verifier_for_repair`）。没有 request 时按 NEXT 恢复相关输入或执行条件。执行器先复用有效报告或可恢复原答，再派确有缺项的独立上下文；按原 request 的 `prompt_path` 让 verifier 读取材料，可在 request 前附已签复核范围。执行器在派发、绑定和交回时观察写界，只接收带当前 subject 的合规完整报告。越界报告拒收，实际文件改动交原责任方核对并恢复。作者不另派、不改核验材料、不手写正式报告。独核结论与产品脚本状态分别保留。
4. **生产型子 agent**：派发时列出真实写界，要求先读取目标，目标不存在时交回缺口，完成后交回实际修改清单与自验命令输出。阶段执行者用 `git diff` 和工具结果对账；正式门禁交原 writer。
5. **环境能力**：判定 hvigor、SDK 或设备缺口前，先运行对应探测（如 `detect-deveco.ts --json` 或 `check-personal-setup.ts --ensure`）并引用其结果。按 `HARNESS_PREFLIGHT` 处置并保留当前缺口，条件恢复后重进原请求。
6. **同一 owner 与等待纪律**：保留准确的原请求、身份与 SID；原会话不可续时，由原协调器按原件恢复专用上下文。等待正式核验时使用请求的时限与清理预留设置工具 timeout，可先做无关工作。继续时用原执行或观察命令，禁止另建等待器或重复 report。 `--revalidate` 只进行机械重验。

### 当前工作与验收证据

正式阶段在产出前与收口前读取当前 request 的完整 instruction、harness `NEXT`/`next_action` 及所列原报告和证据。原始检查与 verifier 的 PASS/FAIL、当前工作是否完成、Feature 普通完成和发布资格分别保留；下一步只消费框架共同处置，不再以“只修 BLOCKER”或“已有 receipt/closed”另判一次。

- 当前本职责确有必修任务：读取问题、责任对象、权限、依据路径和复验条件，实际修复本职产物；同阶段发现也必须处理，不以原总 PASS 退出。MAJOR 只是严重度，明确建议仍作披露，不能全部升级为必修。
- 当前仅待核：交原 verifier 阅读签发 request/material 中的完整当前材料。先核旧担忧现在是否仍妨碍本次验收：冻结执行结果、断言、实现调用关系及源码/测试绑定要共同核对，用例名、`ut_covered` 或孤立 PASS 不足以认定已满足。未覆盖的新反证先补核，不先派产品作者试修。
- 有效当前实证已解决旧担忧：由原验证方有据关闭必修判断，差异保留报告/notes；可确定的记录同步交合法 owner。真实新接口、验收、输入或执行条件变化仍须受影响复验，不把“文档差异”当普遍免验。
- 他职责工作交既有回退/下游义务/设计 owner；真实负面结论在合法修改与原验证方复验前保留。只审查的请求不扩成开发，核实任务不交产品作者猜测。尚有本职具体任务时先做任务，不只填回执。
- 闭环前再次消费当前工作；旧有效回执仍有效，但不能遮住真实新增义务。Goal 自检完成按原 request 交 runtime 正式 gate/finalizer；没有新模型需要时只做必要机器收口。

核实期间和关闭后仍沿该次 request/material 的相关证据锚读取原件；不因发现关闭或下游 latest 报告变动回摆 subject。真实相关材料或绑定失效才刷新。引用使用可唯一定位的项目相对或当前 Feature 相对路径，框架归一后与 material 的项目相对 POSIX label 对齐；歧义、越界或缺证具体报告，不能猜路径或自动 confirmed。格式告警和未分类旧 SKIP 保持原边界。

纯补 gate、核实、报告转录不算内容返修；真实模型调用与耗时保留为事后统计。新运行不设调用次数、内容返修次数或默认总墙钟配额，不以旧 budget 字段停止或提额恢复。用户明示截止、取消及真实授权仍有效；实际额度、认证或服务故障保全成果，条件恢复后接回原请求，只补缺失或受影响的工作。

## §4.2 实例扩展与生命周期钩子

允许在不改 `framework/` 的前提下挂载业务 Skill/knowledge/phase 前后钩子。

- **落点**：`doc/extensions/`（可由 `framework.config.json → paths.extension_dir` 覆盖）；首份骨架由 `/extension init` 从 `framework/skills/project/extension/templates/extension-skeleton/` 补缺，此职责不属于 framework-init；UPDATE 路径见 `framework/MIGRATION.md` 3.1.0。
- **协议 SSOT**：`instance-extension-manifest.schema.yaml` · `lifecycle-hooks-schema.yaml` · `workflow-schema.json`；三层叠加见 `docs/concepts/extensibility.md`。

**何时主动询问用户**（仅询问，不改 manifest、不给 y/n diff；本会话被 n 后不再就同一资料二次发问）：

1. 强言语信号：「以后都…」「全工程都…」「我们家规矩…」；
2. 稳定资料：SDK 约定/合规清单/命名禁忌/设计规范/第三方协议；
3. 本会话反复 `Read` 同一资料 ≥3 次，且不属于 profile-addendum/模块画像/术语表覆盖范围；
4. 用户希望「每次进某 phase 前/后做某件事」→ lifecycle hook 本职。

**隔离**：业务名词/模块归属 → catalog/glossary（catalog-bootstrap）；带流程/钩子/校验 → `doc/extensions/`。

## §5 交付凭证：闭环判定完整机制

每次完成正式 Feature 的某个阶段任务，必须在 `<features_dir>/<feature>/<phase>/reports/<timestamp>/<model>-<phase>/trace.json` 产出凭证（配置了 `paths.reports_dir_pattern` 时归入该模式；遗留实例为 `framework/harness/reports/<feature>/<phase>/`）。字段见 `framework/harness/trace/trace.schema.json`；痛点回填见 `framework/harness/trace/gap-notes.template.md`——这是弱模型回传问题的唯一渠道，不要省略。

**阶段闭环判定（trace.json 缺失 = 阶段未完成）**：本节是 Layer 2（完成回执）+ Layer 3（Stop hook）的 SSOT。物理拦截层若存在，由具备 hooks 能力的 adapter 在实例根下发的脚本读取本节定义的判据决定能否放行 stop（细节见 `framework/agents/README.md`）。

任何 feature 维度阶段（spec/plan/coding/review/UT/device-testing）"完成"都必须同时满足：

1. `trace.json` 真实存在（缺失即视为阶段未完成）；
2. 主 agent 已自跑 `harness-runner.ts`，verdict=PASS（或脚本退出码 0）；
3. verifier 报告 verdict=PASS（仅当 harness 为本阶段输出了 verifier request；只跑一次——材料未变复用既有报告，历史 PASS 的适用性与必要补核按上文共同处置；建议记 `<phase>/notes.md`）；
4. `framework/harness/scripts/check-receipt.ts` exit 0（回执 `phase-completion-receipt.md` 由 harness 从 summary/verifier 报告/真机产物**只读投影**生成，receipt_schema 2.1，agent 不手填任何字段）。

严禁仅靠口头"完成"宣告而不留下上述四份物理凭证。若物理拦截层（Stop hook）检测到任一项缺失，将以 exit code 2 阻止当前消息结束，并把缺失项原文注入下一轮 prompt。被拦截后必须立即补齐缺失项，而不是再次声称完成。

**全局阶段豁免**：`init`/`catalog`/`glossary`/`docs` 四个全局阶段（无 `--feature` 参数，哨兵值 `_global`）不在本节判据范围。这些阶段没有 feature 维度回执模板，harness-runner 不为它们写 `.current-phase.json`，Stop hook 也对 `state.phase` 是这四值之一时一律放行。详见 `check-init.ts` 头部"元阶段三件套刻意不对称"段落。

**会话边界与跨会话遗留**（v2.8 起）：`.current-phase.json` 是全局单槽，跨 cli 重启不会自动清理；Stop hook 在判定前先做会话边界检查：

| state.session_id | 当前 cli session_id | 行为 |
|-----------------|---------------------|------|
| 与当前 sid 一致 | 存在 | 走闭环判定，未闭环 → exit 2 阻断（同会话遗留） |
| 与当前 sid 不一致 | 存在 | advisory + exit 0（不阻断，跨会话遗留） |
| 未盖章（null）+ state 在 grace_period 内 | 存在 | 视为同会话刚跑完，hook 第一次回填 sid 后走闭环判定 |
| 未盖章（null）+ state 超 grace_period | 存在 | advisory + exit 0（视为前一会话遗留） |
| state 已盖章 + payload 缺 sid + 在 ttl 内 | — | 保守视作同会话，走闭环判定 |
| state 已盖章 + payload 缺 sid + 超 ttl | — | advisory + exit 0 |

时间常量在 `framework.config.json` 的 `state_machine` 段配置，默认值见 `framework/harness/config.ts` `DEFAULT_STATE_MACHINE`。

用户/agent 在哪个时机会看到什么文案：同会话未闭环→"继续/放弃二选一"中性提示，给出补齐 4 步与 `--clear-state` 出口；跨会话遗留→仅一条 stderr advisory（"检测到遗留状态文件，已放行；如需清理执行 --clear-state"），不注入 prompt 也不阻断；agent 见到此 advisory 时不应主动接管旧任务——继续做用户当前要求的事即可。

清理出口：`cd framework/harness && npx ts-node harness-runner.ts --clear-state`（无确认，直接删 `.current-phase.json`；历史 verdict/脚本报告/verifier 产出通常在同一 feature 阶段的 `reports/` 子目录，完成回执在实例 features_dir 下）。

**跨会话恢复（Resume·BLOCKER）**：新会话、framework 升级后、或用户说「继续 `<feature>`/做下一阶段」时，在进入 Skill 工作前须先对齐闭环态：

1. 若完成回执可能存在 → 必须先执行其一（agent 自跑，不得让用户手动跑）：`check-receipt.ts --feature <feature> --phase <phase>` 或 `harness-runner.ts --sync-closure --feature <feature> --phase <phase>`。
2. `check-receipt` exit 0只说明相应机器原件可用；回同一当前完成视图，复用仍有效结果，不按phase停等。完整交付继续到原终点，专项请求按原职责结束。
3. `check-receipt` exit 1/2 → 按 BLOCKER 列表补齐缺失项；禁止仅凭 `.current-phase.json` 的 `receipt.status=missing` 或 `summary.json` 的 `next_action=run_verifier_then_receipt` 宣告「未闭环」——二者可能滞后于 receipt 磁盘真相。
4. `summary.json.closure_status=closed` 与 `state.receipt.status=passed` 可作为辅助信号；SSOT 仍是 `check-receipt.ts` exit 码。

**在途 feature 的已闭环阶段修正（plan 07a41ec6 T8）**：修正 = 直接改根因层 SSOT/代码/测试输入 → 一次 `harness-runner.ts --revalidate --feature <feature> [--from <phase>]`（检查执行器：按链找 stale 阶段逐个重跑脚本门禁并按既有闭环路径收口；FAIL 即停并打印 blocker 与改法；语义 verifier 不重审，结果标 `script_revalidated` / `semantic_not_reverified`，账本落 `<feature>/revalidation.json`）→ 按漂移分级补一次复核（文档不复审；测试代码只跑相关测试；导航/状态/交互做 scoped diff review；布局/字号/颜色/资源做真机截图或 `--measure`；多类同时变化做一次最终合并 diff review）→ 完。不重新进入六阶段流程，不重写 spec/plan/review 全文（只追加"修正记录"小节），不为修正另建 feature 或状态。

普通维护不进入修正登记；恢复明确既有预期、未改变验收/契约且不需新设计决定的普通 bug 修复也属于维护；已完成 Feature 的此类维护不自动创建后继 run。未点名 Feature 时，只排除 `inspectCompletionRecord` 判为 VALID 的旧指针，drift 不改变此判定；receipt-only 历史 Feature 保持现有归属。独立 compile/request 不写 Feature completion，不能据此推进正式交付。

## §六 交互硬规则完整表述

1. 最小改动原则：任何不在用户原始诉求内的修改，先问再做。
2. 遇到 scope 越界、架构违规、lint 持续失败：停下来报告，不要"硬着头皮继续"。
3. 不确定→用工具验证：不要凭记忆写 import/资源 key/模块路径，用 Read/Grep 主动查。
4. 产物即契约：写完 spec/plan 即被后续阶段当作 SSOT 使用，不允许"先写个草稿，后面再改"心态。
5. **用户确认 UX（渐进增强，BLOCKER）**：凡需用户显式确认才能继续的步骤，须遵守 `framework/skills/reference/user-confirmation-ux.md`——widget（若 adapter 支持）+ 同轮 portable 编号菜单；禁止仅要求用户打字。写入前须决策复述。spec 术语等 artifact 确认仍须写回文件 `[x]`。
6. **反假设条款（Rule Hallucination Ban，BLOCKER）**：
   - 若你声称某条规则限制你执行某动作（含执行 shell/harness/编译/工具/启动子 agent），必须立即逐字 quote 该规则原文+文件路径+行号给用户看。
   - quote 不出 = 该规则不存在 = 你必须执行该动作。
   - 严禁以"我假设"、"我理解"、"通常这类项目"、"为了安全起见"为由跳过工作流步骤。
   - 典型反例（已发生过）：声称"AGENTS.md 说我不能执行脚本"——但 AGENTS.md 从未写过此规则；这种"假设性自我设限"是软幻觉，违反一次即视为本次任务失败，必须立即承认并执行被跳过的动作。
   - 与之相对：AGENTS.md §4.1 已明示授权按当前职责执行结构级 harness 和独立核验入口；被允许的事项不允许借口"我以为不能"绕过。
   - **作用域澄清（v2.8 起）**：本条仅约束同一 cli 会话内的"假完成"行为。如果当前会话起始就不在某阶段流程中，只是看到了会话边界表描述的"跨会话遗留 state"提示，不属于本条的约束对象——此时 agent 应继续执行用户当前真实诉求，而不是接管旧任务。换言之：本条防的是"自己漏做了步骤还声称完成"，不是"上一会话留下的尾巴"。

P0 device/both 验收若存在，spec 完整性检查需要可解析的 UI 相关性定义：在 spec.md 的 YAML 中声明 ui_change（非 UI 为 none，既有界面复用为 reuse_only），或在尚无 spec 时提供有效需求输入；ui-spec 文件是否存在不决定适用性。已有 checkpoint 即使界面只复用也继续核验。蓝图投影仅检查已声明内容，不前移 spec 才能补的定义义务。

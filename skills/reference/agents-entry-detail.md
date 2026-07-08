# AGENTS.md 入口模板详细规则（条件加载：需要展开某条红线细则时读）

> SSOT 索引见实例根 `AGENTS.md`（由 `framework/templates/AGENTS.md.template` 渲染）。本文承载该模板 §三 红线清单每条的完整判据文本、§4.1 主 agent/verifier 职责切分反误读全文、§4.2 实例扩展生命周期钩子细则、§5 交付凭证与闭环判定/会话边界/跨会话恢复完整机制、§六 交互硬规则完整表述。实例路径（架构文档/模块画像/术语表等）以渲染后 AGENTS.md §二 SSOT 表为准，本文不重复模板占位符。

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
- `doc/features/<feature>/` 默认不假定提交进主代码仓——由 `framework.config.json` → `paths.docs_committed` 管控；脚本 harness 与工作区快照优先，completion receipt 不强求未入库即失败。含 UI 形态的 spec 应当声明 `ui_change`/Visual Handoff；非 UI/后端类需求不做硬性要求。
- feature 需求交付不自动触发架构文档更新——架构文档只承载架构级契约，不承担 feature 级变更日志（后者由 git 与 `doc/features/<feature>/` 承担）。
- 仅当 plan.md 的架构影响声明 `impact != none`（`dsl_change`/`module_set_change`/`responsibility_rewrite`）时，按 plan · Step 12 分支更新架构文档/模块画像/`framework.config.json` 的相应段落，并在架构文档的「架构级变更记录」追加一行。
- 模块画像是模块职责/公共能力/易混点的唯一 SSOT；不要把这些细节复制到架构文档。

## Context Facts Gate（BLOCKER，C4 exploration-scale）

该 track 首个 feature phase（full=spec / lite=change）在写入该阶段主产物前，须在 `<features_dir>/<feature>/context/facts.md` 建立全量事实（frontmatter + `## Code Facts` 表，`source_code_paths`/`decisions_unlocked`/量化阈值由 harness BLOCKER 校验，`ready_to_produce: true` 须真实探索后手动设定）。后续所有 active feature phase（full 含 plan/coding/review/ut/testing；lite 含 coding/exit）只追加 `## phase_delta: <phase>` 增量节（无新增事实须显式写 "none"），不重做全量探索。契约实现见 `framework/harness/scripts/utils/context-facts.ts`；旧版 per-phase `<phase>/context-exploration.md` 仍可读（WARN 提示 backfill），阶段步骤与宿主侧补充路径以各 SKILL 及 profile-addendum（若有）为准。

`enforced_by`：context-facts。

## Agent 行为规约（BLOCKER）

1. 进入任一 feature 阶段（spec/plan/coding/review/UT）的 Research Sub-Phase 前，须完整阅读 `framework/skills/reference/agent-behavioral-principles.md`。
2. Research First：不确定时停下来问；代码与文档冲突时以代码为准并显式标注；达到阈值时必须使用 explore subagents。
3. Minimum Viable：产出不得超出用户诉求/上游契约（spec→plan→contracts→code）范围；禁止投机性抽象或"顺便加上"。
4. Surgical：coding/review 仅触碰 scope 内变更；禁止顺手改相邻格式、注释或无关文件。
5. Verify Before Proceed：Context Exploration 完成后自检路径存在性与 Code Facts 充分性；逐文件 lint/局部 harness，禁止批量产出后统一验证。
6. 语义级行为合规由 verifier `behavior_*` 检查项（BLOCKER/MAJOR）与 Layer 2 量化门禁交叉 enforcement。

## 阶段边界推进（BLOCKER）

阶段四件套 PASS ≠ 授权下一 Skill。默认 `transition_policy=manual`：闭环后须 `phase.next_step` 或用户/batch 明示授权，禁止同一执行流自动开下一阶段。细则与 batch 白名单见 `framework/skills/reference/user-confirmation-ux.md §8`。

## §4.1 主 agent 与 verifier 子 agent 的职责切分（明示授权，反误读全文）

> 弱模型经常把"verifier 子 agent 执行 verify-*.md"误读为"任何 harness 类的事都不该主 agent 干"。本节是反误读的明示授权，BLOCKER 级，必须遵守：

1. **结构级 harness**（`framework/harness/harness-runner.ts`）：必须由主 agent 自己执行。它会自动调用 `hvigor` 编译、各阶段 `check-*.ts` 等，不得借口"等 verifier"或"等用户"跳过。主 agent 在阶段产物完成后，第一时间通过 Shell 工具运行该命令，读取退出码与报告文件。
2. **语义级 verify**（`framework/harness/prompts/verify-*.md`）：在结构级 harness PASS 之后，由独立 verifier 子 agent 执行；主 agent 必须主动通过 Task 工具触发 verifier（`subagent_type: verifier`），把 feature/phase/报告路径完整传入；不得仅"提示用户去跑"或"等用户启动"。
3. AGENTS.md 全文未禁止主 agent 调用 shell/执行命令；空白处一律按"允许"理解。若你以为某条规则限制了你执行命令，请先核对反假设条款。

## §4.2 实例扩展与生命周期钩子

允许在不改 `framework/` 的前提下挂载业务 Skill/knowledge/phase 前后钩子。

- **落点**：`doc/extensions/`（可由 `framework.config.json → paths.extension_dir` 覆盖）；首份骨架由 S3 执行自动从 `framework/skills/project/framework-init/templates/extension-skeleton/` 拷出；UPDATE 路径见 `framework/MIGRATION.md` v2.5。
- **协议 SSOT**：`instance-extension-manifest.schema.yaml` · `lifecycle-hooks-schema.yaml` · `workflow-schema.json`；三层叠加见 `docs/concepts/extensibility.md`。

**何时主动询问用户**（仅询问，不改 manifest、不给 y/n diff；本会话被 n 后不再就同一资料二次发问）：

1. 强言语信号：「以后都…」「全工程都…」「我们家规矩…」；
2. 稳定资料：SDK 约定/合规清单/命名禁忌/设计规范/第三方协议；
3. 本会话反复 `Read` 同一资料 ≥3 次，且不属于 profile-addendum/模块画像/术语表覆盖范围；
4. 用户希望「每次进某 phase 前/后做某件事」→ lifecycle hook 本职。

**隔离**：业务名词/模块归属 → catalog/glossary（catalog-bootstrap）；带流程/钩子/校验 → `doc/extensions/`。

## §5 交付凭证：闭环判定完整机制

每次完成某个阶段任务，必须在 `<features_dir>/<feature>/<phase>/reports/<timestamp>/<model>-<phase>/trace.json` 产出凭证（配置了 `paths.reports_dir_pattern` 时归入该模式；遗留实例为 `framework/harness/reports/<feature>/<phase>/`）。字段见 `framework/harness/trace/trace.schema.json`；痛点回填见 `framework/harness/trace/gap-notes.template.md`——这是弱模型回传问题的唯一渠道，不要省略。

**阶段闭环判定（trace.json 缺失 = 阶段未完成）**：本节是 Layer 2（完成回执）+ Layer 3（Stop hook）的 SSOT。物理拦截层若存在，由具备 hooks 能力的 adapter 在实例根下发的脚本读取本节定义的判据决定能否放行 stop（细节见 `framework/agents/README.md`）。

任何 feature 维度阶段（spec/plan/coding/review/UT/device-testing）"完成"都必须同时满足：

1. `trace.json` 真实存在（缺失即视为阶段未完成）；
2. 主 agent 已自跑 `harness-runner.ts`，verdict=PASS（或脚本退出码 0）；
3. 主 agent 已通过 Task 工具调用 `subagent_type: verifier` 子 agent，且 verifier 报告 verdict=PASS；
4. 主 agent 已填写 `framework/harness/templates/phase-completion-receipt.md` 模板对应的回执，并通过 `framework/harness/scripts/check-receipt.ts` 校验。

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
2. `check-receipt` exit 0 → 直接认定该 phase 已闭环；汇报交付摘要后 `phase.next_step` 停等，禁止重跑该阶段 harness/verifier。
3. `check-receipt` exit 1/2 → 按 BLOCKER 列表补齐缺失项；禁止仅凭 `.current-phase.json` 的 `receipt.status=missing` 或 `summary.json` 的 `next_action=run_verifier_then_receipt` 宣告「未闭环」——二者可能滞后于 receipt 磁盘真相。
4. `summary.json.closure_status=closed` 与 `state.receipt.status=passed` 可作为辅助信号；SSOT 仍是 `check-receipt.ts` exit 码。

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
   - 与之相对：AGENTS.md §4.1 已明示授权主 agent 执行结构级 harness、调用 verifier 子 agent；被允许的事项不允许借口"我以为不能"绕过。
   - **作用域澄清（v2.8 起）**：本条仅约束同一 cli 会话内的"假完成"行为。如果当前会话起始就不在某阶段流程中，只是看到了会话边界表描述的"跨会话遗留 state"提示，不属于本条的约束对象——此时 agent 应继续执行用户当前真实诉求，而不是接管旧任务。换言之：本条防的是"自己漏做了步骤还声称完成"，不是"上一会话留下的尾巴"。

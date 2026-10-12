---
name: 正式需求自动蓝图入口 — 设计交接与 Goal 启动同源
version: 3.1.0
overview: >
  修复新正式完整交付被直接送进无蓝图 Feature 的 spec/plan 路径的问题。
  补齐 check:change-unit 接受候选与 readiness 的命令接口，现有主 Agent 据此完成交接，
  无人值守只改变执行方式，不替代设计来源；不以补提示或缺蓝图停机作为完成。
  保留既有任务恢复、局部请求与维护边界，不改蓝图协议、质量策略或后台运行架构。
todos:
  - id: t1-unified-delivery-entry
    content: >
      按 §3.0–3.1 的统一规则收编新正式完整交付入口，区分请求名称与 canonical CU Feature；
      prepare-scope、fresh Goal 启动共享基于既有事实的前置分流，已有任务和单职责 request 保持原入口。
      返回本会话可消费的下一步，主 Agent 完成设计后继续，不以报错停机代替自动接续。
    status: completed
  - id: t2-executable-cu-handoff
    content: >
      按 §3.2 为 check:change-unit 增加接受候选及 readiness 接口，复用唯一 consumer，
      输出接受结果、readiness、canonical CU Feature 身份，支持已接受后只重派生而不重复写入。
      主 Agent 沿已有蓝图工作流和 P2 交接继续；不新增宿主桥回调、Goal 子命令或编排流水线。
    status: completed
  - id: t3-consumer-boundaries-and-guidance
    content: >
      按 §3.3 的替换清单清理正式完整交付误用 standalone definition-gap 的规则及接线，保留合法消费方；
      同步入口模板、goal-mode/component-design/P2 指引与现行 OpenSpec，收准 attended/detached 表述。
      仅修改此次入口语义直接涉及的文件，不审计或重写全框架。
    status: completed
  - id: t4-entry-regression-and-review
    content: >
      按 §4 从无蓝图/CU/Feature 的原始需求，经真实入口和消费者跑到 CU Goal；
      测设计缺口可自动完成、准备失败不会误入 spec、重入复用及局部/恢复反例。
      目标验证后有界 review，再满足仓库验收；不以提示词断言或预制 admitted CU 代替入口证明。
    status: completed
  - id: t5-candidate-and-host-observation
    content: >
      用户安排候选与回灌后，用原开工短话术观察正式需求先走蓝图再进入 CU Goal；
      与 a47c9d62 R5、6e2f9a10 t6、272acb5f H1 及适用的 7c2e9a41 t5 共用宿主运行，逐项记录。
      未实测仍 pending；不自动停宿主、删现场、追加预算或发布。
    status: pending
---

# 正式需求自动蓝图入口修复

## 1. 目标与范围

用户给出“完成开卡需求 bc-openCard-2 的交付，需求在 doc/features/原始需求/1-2-银行卡；我先离开，按无人值守在后台跑完”即可启动完整交付。主 Agent 识别正式需求后，使用现有设计流程及补齐的公开命令自动完成蓝图/CU 交接，再将 canonical CU 交给既有 Goal 执行器。

**可运行的正向路径是交付物**：读原始需求 → 创建/继续蓝图 → 独立质询与准入 → 接受/复用 CU → readiness → canonical CU Feature → 范围候选 → Goal。不要求用户记得蓝图名、CU 编码或内部命令。

本 plan 推进 [效率与准确率路标 a47c9d62](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md) 的 g1/g3/g6/g7，遵守 [四条总原则](../../docs/overview.md#121-四条总设计原则)。不重写已经完成的 6e2f9a10、7c2e9a41 目标。

只处理**新正式完整交付的入口及设计到执行的交接**。不改蓝图/CU schema、验收严格度、阶段顺序算法、模型选择、预算算法；不新增任务平台、持久路由登记表或第二套推进状态机。单测提速 8c2f6a91 独立推进，不成为本批前置。

## 2. 现场事实与历史归因

### 2.1 2026-10-12 宿主发生了什么

宿主：`D:/1.code/SimulatedWalletForHmos`；会话“完成 bc-openCard-2 开卡交付”。下列事实来自会话命令和盘面，只读取证，未更改宿主。

1. 主 Agent 读取 goal-mode、component-design、设计适配指南和 change-unit-progression；明确说没有既有 Feature/蓝图，要先完成设计交接。
2. 实际先执行 `goal-runner --feature bc-openCard-2 --requirement-file ... --detach`，`20261012T051240Z-fbef96` 在正式 run_start 前因没有 `feature.yaml` 退出。
3. 随后执行 `--prepare-scope --feature bc-openCard-2 --completion-target feature --requested-phases spec,plan,coding,review,ut,testing`。候选把设计和验收记为 unknown，没有 canonical 蓝图/CU 绑定。
4. 再次 detach 创建 `20261012T051307Z-79f42e`，出生链为 `spec → plan`。spec 于 05:35:18 UTC 判 PASS；plan 于 05:46:58、05:50:07 UTC 判 FAIL/retry，随后进入 plan-i4。此为调查时快照，不描述之后的运行状态。
5. `contracts.yaml` 来源为本轮 `plan/plan.md`。这证明实际走了独立 Feature 定义路径，不能用“Feature 阶段也会产生 spec/plan 目录”解释掉。

宿主 `AGENTS.md:60` 明确要求正式完整交付先有 admitted blueprint + ready CU。所核对的 goal-mode Skill、project-entry、feature-track、feature-execution-scope、visual-provider-review 与主干字节相同；只据此排除这些文件漏更新，未宣称整份临时包已通过候选校验。

本次 plan 重试的直接检查项是 `context_exploration_inputs_coverage`；不能未经诊断把它也归因于本批入口问题。本 plan 不顺带修该项。

### 2.2 为什么“以前可以，这次不行”

| 历史证据 | 能证明什么 |
|---|---|
| `acdd0d6a`，2026-08-29，component-design 引入“每一项正式需求都要先经过这里” | 蓝图必经的产品约定早已存在 |
| `bfd375c4`，2026-09-16，feature-track 引入缺设计/验收 → unknown → spec/plan 定义缺口路径 | 当前绕行所用分支早于本轮修复；它不是 22a0071f 新引入 |
| `e1110f9e`，2026-09-17，goal-mode 将无 run/有 run 候选与冻结方式展开 | 当前操作指引的重心是范围与运行载体，设计前置仍依赖外层履责 |
| 旧会话转述中的 be091c 启动命令使用 `cu-...` Feature | 那次已经处在 CU 执行入口，和这次直接传原需求名不是同一起点；旧现场已删除，不重建验证 |
| 当前会话读过蓝图规则却实际跳过；底层照样接受并推进 | 不能仅归咎“没读提示”，也不能认为文档约定已经被执行入口兑现 |
| 宿主 `scratch/accept-bank-card-v3.ts`、`v4.ts` 直接 import `acceptChangeUnitDecomposition` / `deriveDesignPreparationReadiness` | 旧宿主曾靠 Agent 自写脚本补齐 CU 交接命令缺口；“以前可以”并非已有稳定公开命令完成这一步 |

归因：**文档要求蓝图交接，但 CU 接受与 readiness 只有内部函数、没有可直接执行的命令；同时独立 Feature 入口仍可绕过交接。** 此前成功不仅是选对路径，还依赖 Agent 临时写脚本接内部函数。当前会话搜索实现入口后仍没有完成该接缝，随后将设计交给后台 spec/plan。现有证据不足以认定最新版本删除了一个原本可靠的自动蓝图入口，也不能排除模型、上下文和近期指引变化影响选择概率；本批不做模型 A/B 或历史全版本二分。

`buildFeatureScopeCandidate` 当前仍允许缺设计且请求含 spec/plan 的候选继续；`runChangeUnitProgression` / `buildChangeUnitGoalHandoff` 有内部接口但未接入生产 CLI。`check:change-unit` 目前只校验已有 canonical CU，不能接受临时候选。`runGoalModeHostBridge` 则必须先有可附着的 attended run：它不承担 run 出生前设计，本 plan 撤回在此增加设计回调的方案。

## 3. 最小实施方案

### 3.0 统一规则，保留现有执行职责

本 plan 是变更说明，不成为第二份运行时真源。正式性仍由主 Agent 按根入口和 `complex-capability-meta-model` 现有判据解释，不增加 formal 参数、机器分类档位或持久路由记录。

| 责任 | 本批统一口径 |
|---|---|
| 初始设计 | 新正式需求先由主 Agent 按 component-design 写蓝图、独立质询、校验和交付人读文档；不交给平铺 Feature 的 spec/plan 代做 |
| CU 接受与交接 | Agent 只写临时候选文件，通过新增的 check:change-unit 选项调用既有唯一 consumer；公开命令返回实际结果、readiness 与 CU Feature 身份 |
| 自动继续 | 完整交付已获授权时，同一会话的主 Agent 消费命令结果并继续范围准备与 Goal；不交还用户重复下令，不新增机器编排流水线 |
| 阶段补充 | 已有蓝图/CU 下合法的 spec/plan 补充仍保留；缺 plan 专属映射不等于缺初始蓝图 |
| 运行方式 | attended/detached 只决定 ready CU 的执行载体，不能改变初始设计责任；设计专项到设计终点停止 |
| 局部与恢复 | 单职责 request、非正式维护、只读请求保持原终点；有效旧任务按既有恢复继续，不强制迁移蓝图或重置预算 |

不能把“无人值守”概括成所有确认点都可写 headless 决定。可自主取舍按既有规则记录，真实授权、凭据以及无法从原文/已有约定消解的必要人类决定仍按原确认契约处理。本批不改变确认策略。

### 3.1 入口返回本会话能执行的下一步

在范围准备与 fresh Goal 创建之前复用同一个窄判据，不改变 `runGoalModeHostBridge` 的“附着已有 attended run”契约：

1. 先用既有 continuation/冻结范围读取器识别有效任务；有效 run、冻结范围恢复仍走原入口。不能把存在一个空目录、未开始的失败启动目录或未冻结候选当成有效任务。
2. 仅当当前工程解析出的 profile 经既有 `profileHasDesignLens` 判定具备 design lens，且尚无有效任务、不是可解析 canonical CU 派生对象、请求包含 spec/plan 定义职责的**新完整 Feature 交付**时，返回设计准备的下一步，不创建平铺 run，也不先写一份可供重试绕过的独立 Feature 候选。本批蓝图分流规则均以此能力前提为限；没有 design lens 的 profile 保持现有平铺路径和 spec 的兜底复核，不强制转入 unsupported 的 component-design，不复制 profile 名称白名单。
3. 使用既有 `completion_target` / 明确请求终点区分完整 Feature 与单职责 request。fresh detach 尚无候选时读取原输入与 workflow 的默认定义阶段，不以缺少 feature.yaml 作为异常才发现问题。CU 身份由 resolver 核对，不能只看 `cu-` 前缀。
4. 同一会话主 Agent 按结果执行 component-design，再使用 §3.2 的公开命令交接。入口本身不调用模型、不在 `--prepare-scope` 内写蓝图，也不在无 run 时创建桥接模式。

**必须保留的具体反例**：`execution-scope.unit.test.ts` 中 “D1 a repeated runless closure of a single-duty request is a no-op” 用 `completion_target=request`、`requestedPhases=['spec']` 建立单职责范围。它符合“新建、非 CU、带定义阶段”，但不能被升级成完整蓝图交付。因此不采用这三个条件覆盖所有请求的宽泛判据。这个例外保留请求终点，不是新的“非正式”豁免，更不降低根入口对正式设计请求的原要求。

结果沿既有 CLI JSON/文本输出，至少提供当前原因、已有材料定位，以及同一主 Agent 可执行的步骤和命令参数：
- 初始设计仍在当前会话按 component-design 完成；没有蓝图时不假装已有 blueprint id。
- 写临时 CU 候选后运行 `check:change-unit --accept-candidates`；已有 CU 时读取 readiness，避免重复接受。
- 消费返回的 canonical CU Feature id，再运行现有 `--prepare-scope`。
- 按用户选择的运行方式调用原 attended 或 detached 启动入口。

这是准备结果，不投影成一个已运行任务的 HALTED，不新增停机原因。纯准备调用返回结果即完成；已获完整交付授权的主 Agent 必须在同一任务内继续，而不是把输出转给用户就结束。测试既要证明未出生错误 run，也要证明下一步能实际执行到 CU Goal。

本批判据只修已证实的“新完整 Feature + 定义阶段”误入口，不声称识别所有自然语言或阻止所有刻意绕过。跳过定义直接请求 coding 的现有写集检查和根 Skill 正式性兜底保持原责任，不扩成全入口权限系统。

### 3.2 给 check:change-unit 补齐可执行的 CU 接口

修改 `harness/scripts/check-change-unit.ts`；沿用 `harness/package.json` 的 `check:change-unit`，不加 goal-mode-entry 子命令。默认检查已有 CU 的命令、输出及退出码保持兼容。

新增两个相互排斥的显式操作；未选择它们时保持原检查行为：

| 操作 | 输入与行为 |
|---|---|
| `--accept-candidates <file>` | 与 `--project-root`、`--blueprint`、`--json` 组合；文件为 JSON 数组，元素直接沿用现有 `ChangeUnitCandidate { providerId, artifact }`，不建新 schema。读取合法数组后调用 `evaluateDesignPreparationEntry`，再由 `acceptChangeUnitDecomposition` 完成整批接受，随后 `deriveDesignPreparationReadiness` |
| `--readiness` | 与 `--project-root`、`--blueprint`、`--json` 组合；只对已存在 CU 重派生 readiness，不再接受候选。它复用现有指针调和和文档物化，明确有这些既有副作用，不能宣称纯只读 |

新操作不要求 `--unit`；与旧检查模式的 `--unit` 混用时按用法错误处理。接收候选文件而不是运行脚本，宿主无需 import 框架内部 TS。一次接受对应一个 blueprint 的 1..N 候选，所有 schema、归属、provenance、重复接受和原子写规则仍由已有 consumer 承担。

JSON 输出区分**已接受什么**与**是否可继续**：accepted ids/paths、现有 readiness/perUnit/issue 原因、人读文档结果，以及通过 `deriveChangeUnitFeatureId` 派生的每个 canonical CU Feature id。身份来自实际接受/读取的 CU，不允许 Agent 手填 Feature id。

- 接受拒绝沿原 consumer 原子语义；不输出接受成功或替代写入。
- 施工 readiness 与文档交付分别报告：接受成功但 readiness 未就绪或指针锁 busy 时，保留已接受事实，输出具体状态及“用 --readiness 继续”的命令；文档物化失败不改变 accepted/readiness/bumped、ready ids 或施工退出状态，另行披露原因与独立重建命令。不能笼统报错让主 Agent 再次接受同一批，也不回滚已经合法完成的接受来伪造整步原子性。
- 多 CU 的依赖/选择沿原 ready-set/selector。若命令需要返回可执行的下一 CU，直接暴露现有派生/选择结果，不因某 CU 可构造就跳过依赖，不写额外队列；命令不启动 Goal、不承担 CU 推进循环。
- 成功退出须与输出含义一致；busy/not-ready 不能伪装为可施工。退出状态只服务当前命令结果，不新增 Goal 停机分类。

预期调用形状（占位值由主 Agent 使用当前材料替换）：

```bash
npm run check:change-unit -- --project-root <host> --blueprint <blueprint-id> --accept-candidates <candidates.json> --json
npm run check:change-unit -- --project-root <host> --blueprint <blueprint-id> --readiness --json
```

蓝图编写、独立质询和 `check:component-blueprint --write-review` 使用原流程；完成后主 Agent 继续现有 P2、范围准备和 Goal 启动。设计阶段默认在人已离开的当前会话中自动完成，ready 后正式 detach；未拿到启动握手不能报告后台已运行。中断后依据已有草稿/准入/CU 继续，不能声称本版提供初始设计脱离会话运行。

设计调用/耗时沿已有记录披露，与 Goal turns/活跃时长分别记录并汇总；不新建账本、不漏记为零成本、不绕过用户整体硬预算。不得把 run 内 B1 的 `runUnattendedDesignRepair` 复用为初始设计授权，也不新增设计重试系统。

### 3.3 规则替换及文档同步

| 冲突或缺口 | 本批处理 |
|---|---|
| component-design / change-unit-progression 让主 Agent “调用 change-unit-design-preparation.ts 函数”，无公开接受入口 | 改为 §3.2 的具体命令和候选文件形状；内部函数链接仅作实现说明，不再要求宿主写脚本 |
| “无人值守只走 detach”容易被理解成跳过设计 | 明确设计交接仍由主 Agent 先完成；只有 ready CU 才交给 detached Goal |
| component-design / project-entry 声称外层只建 attended Goal | 改为按用户选择的方式使用现有启动入口，设计 Skill 不取得施工调度权 |
| 补出 feature.yaml 就算补齐全部前置 | §3.1 先分流，新完整 Feature 的未知设计不能靠候选文件存在绕过 |
| 所有缺设计都交 spec/plan | 新正式交付回 component-design；已有蓝图/CU 下的阶段补充和合法存量恢复保留 |
| 返回缺口即把任务交还用户 | 返回具体可执行步骤，完整授权下由同一主 Agent 接续；真实人类权限边界仍保留 |

直接涉及 `templates/AGENTS.md.template`、goal-mode、component-design、change-unit-progression、project-entry 和 goal-mode-operations，按各自现有职责更新，避免复制一整套路由规范。OpenSpec 仅同步 `complex-capability-meta-model`、`goal-mode-skill` / `goal-runner`、`change-unit-continuous-progression` 的受影响条款。

本批新增的是必要 CLI 接缝和共享前置分流：收益是主 Agent 不再靠临时脚本完成唯一 consumer 写入，并且误入后台入口时能按返回指令补齐交接。拒绝伪造 run、设计回调协议、新正式性参数、后台设计服务和新的编排流水线；也不能把公开接口的实现缩减为提示词修改。

## 4. 验收：从空入口开始，验证真实行为

复用既有 request-entry、change-unit-progression、execution-scope、goal-runner-testing-integrity 与 real-chain 夹具。替身扮演主 Agent/独立质询者，按当前步骤产出设计和临时候选；CLI、蓝图 checker、CU consumer、readiness、Feature 派生、范围准备及 Goal 首个阶段使用生产代码。

| 场景 | 必须观察到的结果 |
|---|---|
| 原始需求 + 完整交付 + unattended，起点无蓝图/CU/Feature | 主 Agent 替身收到可执行设计步骤，写蓝图、独立质询并走真实校验，调用新的接受命令获得 canonical CU Feature，再 prepare-scope/detach；没有先行平铺 spec/plan，也不导入内部 TS |
| 替身只宣称完成而材料不合法 | 原 checker/consumer 返回实际问题；替身按结果修复后通过同一命令继续，不以“正确停住”结束正向验收 |
| 整批候选中有一个非法；蓝图不满足准备入口 | 接受不落部分 canonical CU；新 CLI 不绕过已有校验和原子语义 |
| 接受成功后 readiness 暂未完成，再次执行 | 已接受事实可见；走 --readiness 后继续，不重复接受、不新造 CU；旧的 check --unit 行为仍兼容 |
| 原样重放 raw detach → prepare-scope | 两入口都不出生平铺 run，均返回当前会话可执行的下一步；替身消费输出继续完成 CU 交接，不能只断言 exit 非零 |
| 新建非 CU、单职责 spec、completion_target=request | 保留已有单职责范围与终点，不强制扩大为蓝图完整交付 |
| generic profile，无蓝图/CU/有效任务，新完整 Feature 且请求含 spec/plan | 从 prepare-scope 到 fresh detached 使用生产入口，仍能生成平铺候选、正常出生 run 并进入首个阶段；不被重定向到 component-design，不要求补 design lens，原 spec 兜底仍保留 |
| 已有 admitted 蓝图无 CU；ready CU；既有 CU run/standalone run | 分别只补分解、复用、恢复；不无端增加 revision、重复 run 或重置预算 |
| attended、纯准备、仅设计和非正式维护 | attended 消费相同 CU 输出；准备命令不调用模型；其他请求保持各自终点 |
| 已有蓝图缺 plan 专属映射 | 仍由 plan 合法补齐，不被新入口分流误判为缺初始蓝图 |

连续正向验收必须串起“同一主 Agent 消费入口结果 → 写蓝图与独立质询 → check:change-unit 接受 → canonical CU Feature → prepare-scope → Goal 首阶段”，setup 不预置 admitted 蓝图和 ready CU。错误入口的结果至少带命令、必要参数来源和返回同会话执行的语义；只多一条停机/报错、只匹配提示词、只验证内部函数都不足以完成 t4。

按 AGENTS.md 完成 typecheck、直接目标测试及发布内容改动所需 `harness/npm test`。review 只覆盖本批接口与分流，返修只核已提意见及直接回归，复用仍有效结果。本轮修 plan 只检查 plan/diff/LF，不跑代码测试。


## 5. 宿主验证与交付边界

候选包由用户安排后，在确认的需求实施前基线上，用本次**原话术**开始；不加“必须使用 component-design/蓝图”的补丁话术。先观察蓝图人读文档、canonical CU、readiness 和实际 run 的 CU 引用，再继续原需求交付。入口通过不等于产品完成，产品结果按 a47c9d62 R5 及各 plan 原验收条件分别记录。

与 6e2f9a10 t6、272acb5f H1、适用的 7c2e9a41 t5 共用一次真实运行；记录设计前置耗时/调用、Goal turns/活跃时长、首次可用交付时间、人工介入与剩余差异。不能把新入口成功归为旧 be091c 已恢复。

本次 `79f42e` 可作为已发生事故证据，不以自动迁移这个误启动 run 为交付条件。本 plan 不授权停止正在执行的宿主、清空目录、覆写冻结 manifest、增加预算或发布；需操作宿主时遵循用户当时的明确安排。开发完成、候选验证和宿主实测分别记录，未发生的验收保持 pending。

## 6. 本次起草记录

2026-10-12：依据宿主会话、盘面及 Git 历史起草。仅新增本 plan；未修改运行时代码、其他 plan 或宿主。历史归因区分“长期并存的入口缺口”与“本轮模型选路”，不把所有近期问题归给最新提交，也不把旧成功当作该缺口不存在的证据。

同日按用户“本轮统一规则”的要求补充 §3.0、§3.3 替换清单及一致性反例：明确正式性、初始设计、阶段补充、交接、执行方式和恢复的责任；收准 prepare-scope 的纯准备边界，由外层完成自动执行接续。规则统一限定于本次入口冲突，不扩大到全仓治理重构。

同日按 M1/S1/N1/N2 复审修订：确认宿主桥要求已有 attended run，撤回在桥中增加初始设计回调的方案；核实旧宿主 v3/v4 脚本的内部函数调用，补入“CU 缺少可执行接受命令”的根因。改为 check:change-unit 的接受/readiness 接口，主 Agent 沿现有 Skill 继续；删除正式性调用参数要求，不另造编排流水线。入口判据保留 completion_target=request 的单职责 spec 正例，不能按“新建、非 CU、含定义阶段”误伤它；无人值守确认仍按原授权规则。N1 的可执行下一步和 N2 的 TS 链接替换均纳入验收/文档任务。此前章节中被撤回的方案以本次正文为准。

## 7. 实施记录

2026-10-12（按用户授权补记；下列是不同轮次的结果，不相加为唯一用例总数）：

- 初轮目标验证 5 PASS / 0 FAIL；repair1 目标 28 PASS / 0 FAIL；repair2 目标 4 PASS / 0 FAIL。内部 Claude 经三轮复核最终 PASS（`dist/5f8c2d70-validation/claude-final-review.md`）。当时各报告的“未跑全量”是当时事实。
- 随后全量反馈转交的 10 例回归已修复，五套 exact suite-id serial 验证 46 PASS / 0 FAIL；Claude 窄审 PASS（`dist/5f8c2d70-validation/external-regressions/claude-review.md`）。
- UT 提速统一会话后来执行普通 `npm test`：`.codex/reports/ut-speed/npm-test-run.json` 为 exit 0；`harness/reports/ut-npm-test-8c2f6a91.log` 记录单测 5282 PASS / 0 FAIL、fixtures 46 PASS / 0 FAIL。这是后来的统一验收，不由上述历史目标数字替代，也不自动覆盖本轮新生产改动。
- 2026-10-12 10:23:12 UTC 结束的那次 release 运行为 exit 1、有 6 条失败，历史副本见 `.codex/reports/ut-speed/release-first-run.json` 和 `harness/reports/ut-parallel-first-8c2f6a91-failures.json`。这是当次记录，不代表这些问题之后未修复；后续统一 release 验收由提速会话记录，本轮不宣称 release 通过。
- 本轮授权修 M1/M2：施工 readiness 与文档物化失败分开报告/独立重建；作者替身只消费公开蓝图 CLI issue 的 path/message 期望值，最多两轮纠正。t4 暂回 `in_progress` 待独立窄审，t5 保持 `pending`；验证与交接见 `dist/5f8c2d70-validation/admission-readiness-fix/developer-report.md`。
- M1/M2 窄审已 PASS，t4 恢复 `completed`，t5 仍 `pending`。修改后的单个连续目标 case 最终 1 PASS / 0 FAIL，包含真实文档写入失败与独立重建、busy 不放行、一次公开诊断纠正四个准入字段及 CU Goal 首阶段闭环；首跑提示拼接错误及其修正保留记录。typecheck、plan、diff/LF 检查通过；未重新执行全量。Claude 指出的同一文档/readiness 冲突在 `openspec/specs/complex-capability-meta-model/spec.md` 也已同步订正，仅修改相关句子。结果及源码哈希见同目录 `target-result.json`，审核见 `claude-review.md`；执行源码在目标验证后冻结，后续只有文档/记录同步。
- 提交前补记统一验收：提速会话于 2026-10-12 10:53:54 UTC 完成最终 release 模式单测，exit 0、5399 PASS / 0 FAIL（`.codex/reports/ut-speed/release-run.json`、`harness/reports/ut-parallel-8c2f6a91.json`）。其 real-chain worker 于 10:42:56 UTC 派发，晚于 M1/M2 两个执行文件定稿，6 条 case 全部通过；新版 raw requirement 串行证据取本轮 `target-result.json`，未用旧版本结果替代。普通 npm test 的 5282/0 与 fixtures 46/0 按比例复用，S8/S9 已在最终 release 模式单测恢复。完整消费时点与边界见 `.codex/reports/ut-speed/acceptance.md`。该结果是联合工作区的统一测试验收，不代表本会话已打包、发布或完成宿主 t5。

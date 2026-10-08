## Context

实施范围和验收真源为 [plan 8d4e6a21](../../../.cursor/plans/运行配置与业务证据解耦_授权变更续跑与上游恢复同源_8d4e6a21.plan.md)。本文件记录设计选择，不另列独立实施状态。

当前 `collectRequirementSsotPaths` 把全部历史 run manifest 加入内容证据；另一条既有路径又以当前 run 的 requirement 内容哈希保护需求。合法 provider 重签改变前者，却没有改变后者，facts 和阶段 freshness 因而给出错误失效。入场失败只产早退报告，assess 普通 FAIL 重试先于上游 gap，内容熔断又先于可执行的恢复动作。

## Goals / Non-Goals

**Goals:**

- 授权控制配置更新只重验受影响义务，已有业务证据按实际内容判断有效性。
- 新 writer 和旧证据读者一致，当前 be091c 无手工改记录即可恢复。
- 真实上游输入失效时，让责任执行者获得机会，保留真实失败与硬预算。

**Non-Goals:**

- 不新增依赖图平台、配置登记层、模型名单、状态或停机原因。
- 不修改用户选择的型号，不把配置解析当实际能力验证，不给所有旧材料无条件放行。
- 不扩展到其它停机家族或重新设计整个 closure 协议。

## Decisions

1. **删除重复控制文件依赖。** 来源收集复用 `resolveCurrentRequirementSource` 的当前 run 选择，保留该 run 的解引用文件、`requirement_source_files` 与原参考图依赖；resolved / runless / 蓝图 CU 沿现有真实正文和 binding 解析。当前 requirement 算法与旧签发值不改，source_files 不被误当已包含在文本 hash 内；`collectRequirementIntentText` 的历史对账用途不改。`computeRequirementSsotAggregate` 的 legacy/无 scope 回落同步绑定当前 requirement，防止移除 manifest 后纯 inline 需求变空；旧 completion 原件按原契约核验，不改旧 aggregate。拒绝增加 `HashMatchesModulo<Field>` 特例。
2. **旧记录采用统一的内存读侧解释。** 原 schema/aggregate 和环境核验之后，退休集合仅为配置的 `features_dir` / `featureRelativePath` 下权威 run 清单的规范 `goal-runs/<run_id>/manifest.json`、原 `role=input`、无 facts/neutral/source-owner 语义且未显式声明为业务来源的条目。旧格式没有自动 provenance，因此按旧收集器固定控制面解释，不能从任意 basename 推断；`.dry`、损坏/缺失、其它 feature、outputs/both 和明确业务声明保留原绑定。当前 requirement 必须可重算且等于原 evidence 非空 requirement_sha256，有效范围与业务 bindings 仍经原解析核验。共享 evidence 消费视图贯通全部 freshness/facts/finalizer/candidate-path 消费者；低层逐文件核对不自行豁免。旧 facts 依赖仅在 path/exists/SHA 回连原 `baseline.established_by` evidence 的退休 input 时使用此视图；原 baseline 数组、fingerprint、身份和 exact-start/写链判据保持，新基线和新 writer 不再追加退休项。
3. **修复输入的动作优先于内容重试。** assess 用本轮新鲜 summary 或同轮 reconcile 的既有 `context_exploration_facts_source_stale` ID 与 earlier evidence gap，调用原 `recommendationForGap`，不解析 prose 或新增持久字段。runner 先形成同一 assess 推荐，再判内容无进展；只给无 executor 机会且目标链内/失效面可执行的恢复让位，仍经唯一 `decideAndEmit` 提交。所有硬保护、回退次数/重复指纹保持。失效集合覆盖旧会话完成阶段，同时清除同进程 `resumePostAgentPhases` / attempt 缓存；重启按同一撤销事件重算。缺等价依据保留 stale/unbound/facts 事实，链内首个责任方用原 `factsRebuildReason` 真读源建立新材料；权威损坏、转交失配或目标链外沿既有明确出口停止/接续。
4. **视觉恢复复用真实评估链。** 切换经过正式 pin 授权及身份重签，随后经现有 provider review 清场、调用、载荷验证和提交。连续回放不得仅使用 `computeReplayChecks(providerOutcome='restored')` 的直接 verdict 写入：在现有 `runVisualProviderReview` 的外部 invoke 缝注入替身，捕获正式解析的新 adapter/model 和实际载荷，由生产校验/writer/checker 落结论。功能 trace/图像仅在现有绑定仍有效时复用；旧视觉 verdict 不代表新一轮完成，真实账号可用性由 H1 验证。
5. **验收覆盖连接点。** 原 provider 恢复分支保留；新增真实授权切换、真实旧证据及业务变化反例。流程必须实际到达新 provider 或责任执行者，不能只断言一句推荐文案。

当前语义上下文沿调用方当前 run/requirement、goal env 或既有 feature 冻结记录/原始需求 SSOT 取得，范围只由 `resolveEffectiveScopeSource` 解释；消费指定既有产物且没有另一当前执行身份时，用其 canonical summary/completion 的确切 run_id，不挑最新历史 run。`--sync-closure` 仅补这份语义上下文，不把 `goalRunId` 的其它强制语义前移。必须补接未传 hash 的 `assess`、upstream gate/closure、revalidate、feature/component/完成评估和 facts owner freshness；没有退休项的既有 runless/legacy 契约不新增门禁。

## Risks / Trade-offs

- **退休旧输入可能掩盖真实内容变化** → 保留现有当前 requirement、有效范围、业务 bindings、原始文件/源码/测试/图像绑定；无有效语义依据不豁免，交既有责任恢复。覆盖 inline/file 需求、未授权修改及显式业务 manifest 来源反例。
- **只改一个读取点导致再次串回旧依赖** → 核对 phase freshness、staged closure、facts 入场/承接/检查和 finalizer 全链；新 writer 的结果不得再次包含退休自动输入。
- **恢复绕过修复窗口或预算** → 使用现有失效事件和 resume 投影；测试必须看到责任 agent 实际执行及预算跨会话累计，授权/预算 guard 仍优先。
- **模型配置正确但外部能力不可用** → 宿主 H1 单独实测，不加入常态预探测。外部阻塞如实登记，H1 未完成不关闭相应 todo。
- **候选件与 H1 相互等待** → 使用已有 candidate 流程暂缓最终发布 plan 门禁，保留全部测试与包校验；H1 之后 promote 补门禁，不增加新发布通道。

## Migration Plan

消费者通过 Maison 校验的候选发布件集成；旧 run、事件和 evidence 不手工迁移。先自动回放 be091c 同形旧记录，再由宿主操作者集成候选件并继续真实 run。新证据由正常闭环重建；旧证据保留原字节和完整性检查。

candidate 产生的实际 framework/gate 环境变化保留原重验义务，H1 分别观察这些必要校验与 provider-only 假失效；不保证新框架集成后零 gate 重验。候选只沿既有 `candidate:build` 构建，暂缓最终 plan 发布门禁，H1 后 promote 补齐，t6 不提前关闭。

若需回滚，仅通过原有发布件集成流程替换框架；不倒放宿主产品改动、预算或 run 历史，不保证旧框架能识别本次已恢复的执行进度。

## Open Questions

没有需要用户新增选择的设计项。实现连接点已按 plan §4.1–§4.3 列明；实施如发现其它直读调用，仍只补同一语义视图和原身份上下文，不新增平行身份文件。宿主指定 `gpt-6.1-sol` 的当前 CLI/账号可用性属于 t6 的外部事实，尚未验证。

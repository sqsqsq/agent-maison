实施范围与状态以 plan `8d4e6a21` 的 frontmatter t1–t6 为准；下面逐项映射并同步更新。plan R1 已通过并冻结；t1–t4 及 t5 文档/目标验证完成，Astra C2 代码评审已收口通过，R1/N1 均已修复。全量、candidate/发布门禁与 H1 仍待调度；t5 in_progress、t6 pending。

## 1. 当前内容依赖（t1）

- [x] 1.1 收窄当前权威需求来源收集，停止把所有历史 run manifest 及其引用并集自动追加为业务内容输入，保留原 requirement 算法、当前 source_files、参考图及范围/身份授权边界。
- [x] 1.2 核对 finalizer、resolved inputs、facts baseline 与 candidate-path 输入视图，阻止退休依赖回流；同步 completion aggregate legacy/无 scope 回落，保留纯 inline 需求，不修改旧哈希；补正反例。

## 2. 旧证据读侧兼容（t2）

- [x] 2.1 在原完整性/环境核验后按规范同 feature 权威 run、input-only、非显式业务声明及当前非空 requirement 等价依据解释退休集合；facts 依赖回连原 establishing evidence，保留原 baseline；贯通 plan §4.2 全部消费者及未传 hash 的调用。
- [x] 2.2 补旧 be091c 同形记录、当前需求/范围依据、未授权修改、真实业务变化、显式规范 run manifest、其它 feature/.dry/missing/both、语义缺失后的实际责任恢复和只读/runtime 一致性反例；不改旧记录字节，清理收编的重复判断。

## 3. 可执行的输入恢复（t3）

- [x] 3.1 用当前新鲜 summary/reconcile 的既有 facts blocker ID 与 earlier gap 形成同一次 assess 恢复推荐，再判零 executor 窗口的内容无进展，仍经唯一 decideAndEmit；保留硬保护、回退重复约束与不可执行目标的原出口。
- [x] 3.2 失效集合覆盖旧会话已完成阶段，同进程清除失效 resumePostAgentPhases/attempt 缓存，重启消费同一撤销窗口；责任阶段以 factsRebuildReason 真读源重建；修正 skip 日志，保留合法闭环补验优化。

## 4. 真实授权切换回放（t4）

- [x] 4.1 扩展原连续回放，通过正式 provider CLI pin + override 产生仅 visual_provider_pin 的身份重签，使用真实旧证据和生产 writer/checker；在现有 provider-review 外部 invoke 缝捕获新 adapter/model 与载荷，证明真实调用路径、旧结论清场与累计预算，不靠直接写 restored verdict。
- [x] 4.2 保留同 provider 恢复分支，增加真实上游变化后的责任执行、未授权切换、invalid 输出、真实视觉失败与硬预算反例。

## 5. 文档与开发收口（t5）

- [x] 5.1 更新 MIGRATION、goal-mode/harness runbook 与既有可靠性观察记录，说明自动兼容、有效证据复用、配置成功不等于能力可用及 H1 边界。
- [ ] 5.2 运行 typecheck 与目标套件；冻结后覆盖 `cd harness && npm test`、受影响 release-only 套件。准备 H1 候选件时合并到既有 `npm run candidate:build` 的完整测试链，不重复先后跑同一全量。
- [ ] 5.3 必须执行 `npm run release:verify` 的包/清单校验；H1 尚未完成时沿既有 candidate 模式暂缓最终 plan 发布门禁，命令与前提见 plan §5.3，正式 promote 再补门禁。完成 plan 扫描、OpenSpec strict、diff 和 LF 校验，保留真实失败/补验记录。

## 6. 宿主 H1（t6）

- [ ] 6.1 由宿主操作者在已有授权范围内集成已验证候选发布件，保留原 run、产物和预算，并通过既有 provider 调用路径核实用户指定型号与账号的实际可用性。
- [ ] 6.2 续跑 be091c，确认没有 provider-only 上游假失效、视觉补验真实执行、完成状态与产品验收一致；外部条件未满足时如实停放，t6 不伪标完成。

## 归档与约束

goal-runner 的 MODIFIED 块以当前主 spec 的完整「Facts admission and within-attempt source changes use one entry」为基底，保留其已有场景并明确退休控制依赖的读侧解释。c3f8a2d7 的 capability-absence 及 b7d2e9f4 的阶段延迟要求继续生效，不改写它们的已冻结变更正文。

初次起草仅创建提案；用户现已授权开发/评审/修复循环，plan 评审收口后由调度直接安排代码实施，无需新增许可询问。当前文档轮不实施运行时代码。若以后执行 `openspec update`，按仓库规则重跑 `node scripts/patch-openspec-artifacts.mjs`，本次无需运行 update。

C1 目标验证与初轮失败/修复事实见 plan §7；5.2/5.3 的全量与包门禁尚未跑，因此保持未完成。H1 独立 pending，不以自动回放替代。

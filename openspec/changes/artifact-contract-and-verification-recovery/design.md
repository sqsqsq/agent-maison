## Context

本批按 7d9c2e41 plan 实施，基线 8a523b70。fe4512 原件只读保全在 harness/tests/fixtures/host-recovery-history/20261023/；原错误、命令记录与总 PASS 内的 reference_crosscheck 原样保存。发布拓扑仅支持发布件集成。

## Goals / Non-Goals

**Goals:** 统一实际消费字段的规范化与校验；让适用 checker 的未执行不被当成产品 FAIL 或 PASS；复用真实依赖推进独立职责；在合法窗口准备确定投影；把必需验收的实质发现交原 owner 核实与修订。

**Non-Goals:** 不新增检查级状态机、停机原因注册表、问题文件、身份层或缓存；不改用户需求或削减 UT 义务；不让宿主 Agent 修改 framework；不在开发期操作宿主/手机或宣称联合验收完成。

## Decisions

1. `artifact-content.ts` 为叶子纯函数，装配既有 schema；文件、supplied、蓝图片段、合并产物与公开消费者共用规范值。calls 统一有序列表，其他单值字段不套用列表降标量。来源、冻结绑定及语义检查留在原责任层。
2. `check-execution.ts` 收编原 safeRun。异常使用 SKIP、原 severity、framework_bug/internal/blocked；check-disposition 只将明确 framework_bug/framework_internal 或 device_blocked/externalBlocked/capability_missing 的未执行缺口按必需性投影到 summary/closure/completion。框架缺口复用 INCOMPLETE/open、deferred 与 WAITING，外部缺口沿原等待路径，不给 Agent 无变化内容重试。未分类的旧 BLOCKER SKIP 继续留在 blocking_skips 供 verifier 复核，不凭 severity 自动改成 FAIL/INCOMPLETE 或作者返修；旧 PASS 保持兼容。n/a/披露和真实 FAIL 的既有语义及责任归因保留。
3. `materializeBlueprintSkillInputs` 保留原事务、依赖核验、冲突保护与刷新兼容；spec 只准备 acceptance，plan 只准备 contracts/use-cases。runtime 在现有写入快照之后、解析和 Agent 之前调用；dry-run 和 post-agent 收尾不写。可识别内容冲突交原 owner，其它 I/O/程序异常不伪装成漂移。
4. spec/plan 消费当前 subject 的 `verification_result.checks`，只有明确 acceptance_ids、affected_files、当前可读证据且原 issue-verification 逐条确认才进入候选。设计文件沿 resolveRepairResponsibility 的 design 通道；普通阶段产物按 produces 归属。verifier 报告是输出，不进入自己的 material；当前证据先匹配原文字节，再复用 material 已登记的 identity-neutral 摘要语义，仅对既有登记路径生效，真实设计内容变化仍失效，不改全局材料优先级。拒修依据经既有 goal brief 回到独立 verifier，旧 subject 不覆盖未读的新理由。
5. Page 命名方法定位与 UT 可直接调用分开说明。unit/both 的业务义务依靠无需 UI 的真实入口与执行证据，设备导航留 testing；缺接缝沿原责任链恢复，不把所有 Page 入口统一判错。

## Risks / Trade-offs

- 历史 verifier 缺结构化义务/修复对象 → 重用原独立检视补核；不从自由文本猜责任、不升级全部 MAJOR。
- 规则与绑定变化使旧证据失效 → 沿现有依赖重验或 continuation/successor；保留原请求、义务与累计预算。
- 模型产出与外部设备不可完全受控 → 开发副本验证生产判定链，模型/工具仅在明确边界替身；宿主接续另由用户安排。

## Migration Plan

同步现行 Skill、模板、运行手册与 MIGRATION，并对齐两个 active change 中与 10-23 裁决直接冲突的旧首触停机条款。旧合法输入不必重写。开发完成由主会话执行官方测试、受影响 release-only、OpenSpec/plan/LF 门禁与实际 Claude CLI 检视；未授权前不提交、不打包，t8 保持 pending。

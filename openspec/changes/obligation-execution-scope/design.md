## Context

按动态工作流 P2（b7e4c9a2）实施，前置 g1/P1 已提交。目标是连接既有输入、运行与完成内核，不重写 Goal 生命周期，不切用户默认 workflow。

## Goals / Non-Goals

**Goals:** workflow 1.2、ExecutionScope、真实出生绑定、范围内 assess、可信完成及有界后继。

**Non-Goals:** 不实现 P3–P6 的全部业务 Skill 迁移，不新增通用图引擎、独立分类器、场外状态、租约或完成台账；发布默认切换与 MIGRATION.md 归 P7。

## Decisions

1. `execution-scope.ts` 是唯一纯计算入口。规范化请求给出结果终点和明确请求的职责；有来源的影响事实由 P3/P6 提供。验收的 unit/device 判据复用现有分层检查，非法/未知保持 unknown；实现产生审查义务，失败或离线不作为裁剪输入。正式性仍由既有入口和 CU 设计准入负责，不持久化另一个 formal 标志。
2. workflow 1.2 的 `obligation_provider_id` 使用静态注册集合；auto_chain 只提供稳定默认顺序。真实条件控制边携带 P1 basis，并随既有 scope 的可选 `control_edges` 保留，以便恢复和后继继续验证真实顺序；没有第二张图或文件。1.0/1.1 继续旧轨道读取。
3. `feature.yaml.execution_scope` 是运行前规范化候选；已出生 run 只读 manifest。契约指纹由安装的 contracts 计算，不以候选自报值为准。`execution_scope`、phase_chain 与起止/chain_override 同源；出生摘要绑定范围，且范围身份按 JSON 可持久化语义计算，避免 YAML 共享引用导致读写摘要不同。
4. P1 的调用接口从实际 run 注入义务、输入绑定、真实 facts 首阶段与继承上下文；运行内的 full 标签仅兼容证据策略，不再决定阶段集合。已验证施工输入可满足信息要求；未满足设计决策或真实控制前置仍回责任方。
5. owning checker 在既有 CheckResult 中可提出 `scope_revision_input`，不是授权状态。runtime 验证新来源与不缩减的请求/义务，assess 推荐 revise_scope，再写一次 scope_revision_requested。成功切片保留成功；失败发现保留 PARTIAL/HALTED，不复用失败 run 的裸 PASS。所有源记录原样保留。
6. main 的 finally 先释放既有 Feature/run 锁和 owner，外层同一 runtime 才调用 createScopeSuccessor；后继沿 inheritSuccessorManifest/createGoalRun/ensureRunControl 出生。已登记 ID 保持唯一，partial birth 诊断沿既有 creation_incomplete；已完成后继只验证并返回。三个测试切点仅是故障注入回调，不是新模式或状态文件。
7. 后继默认继承需求、adapter/provider pin、权限、预算与失败指纹。仅源链从未实施/UT 且没有基线时，在后继首次实施前沿既有出生规则取得 HEAD。祖先预算复用原 reducer；修复其 CU 逻辑 identity 到物理路径的旧拼接断点，确保消耗轮次不清零。
8. completion 从独立出生范围验证 executed/reused/unresolved；request 不生成 Feature completion。全复用入口只验证现有结果，不创建空 run。CU 继续使用同一 verifyFeatureCompletion，其 expected chain 对新协议由出生范围确定。

## Risks / Trade-offs

- 范围依赖业务影响判断 → 保留来源、责任方与 unknown，不宣称程序证明任意语义；P3–P6 提供对应事实与 checker。
- 新旧协议同时存在 → 只按 workflow/contract/birth 版本分流，缺失/损坏新范围不回退候选或旧 full。
- 后继不是单个文件事务 → 在既有 events 中保存意图，按真实 owner/出生状态恢复；不为理想事务新增账本。
- Goal 路径原本不写全局 current-phase → 保持该边界；scope 随现有 run/attempt 上下文与 manifest 绑定，hook 不获得阶段规划权。

## Migration Plan

默认 spec-driven 保持 1.1。先在测试 workflow 1.2 上验证真实 prepare CLI、attended bridge、runtime 事件、completion 与 CU 消费；P3–P6 再迁移具体 phase contracts，P7 最后公开切换。
验收运行定向测试与 typecheck，再冻结后执行 `cd harness && npm test` 和 OpenSpec/plan 校验。正式发版仍必须 `npm run release:verify` 或包含它的 release:all；本次按总纲不打包、不安装宿主。

## Open Questions

无新增产品裁决；真实宿主语义验收仍由 P7 汇总。

## Why

P0 已冻结复杂能力建设的对象边界、权威边界、unknown/disposition 语义与 provider 接缝；但 AgentMaison 仍缺少把一个 App 部件从当前事实推进到共同目标态的发现、设计和调和协议。没有这一层，适配 4+1 的视图容易退化为平行文档，运行时数据链和外部契约缺口容易被图形或模型常识掩盖，后续 Change Unit 也无法可靠消费同一份设计。

现在进入 P1，是为了在 P2 施工前锁定可评审、可质询、可追溯的 App 部件蓝图契约：它必须能区分事实、设计决策与外部权责，主动暴露跨视图断链，并在新事实或决策翻转时可控调和而不留下旧结论残留。

## What Changes

- 新增 provider-neutral 的 App 部件发现与蓝图协议，区分 `viewpoint contract` 与蓝图内 `view instance`，并固定稳定的 `logical`、`runtime`、`development`、条件式 `deployment`、`scenarios` 视图 id。
- 将蓝图落为该次演进工作区 `<features_dir>/<blueprint_id>/blueprint/` 内的 canonical YAML 机器产物（2026-08-21 M5A 修订：以 `blueprint_id` 为路径键，蓝图是一次演进而非部件单例，原 `blueprint/component/<component-id>/` 根路径废止硬切），复用既有 YAML/schema/hash 与 `paths.features_dir` 能力，仅增加最小蓝图路径解析；定义 `component_blueprint_ref` 以 `component_id`、`blueprint_id`、revision、`source_fingerprint` 和 `artifact_sha256` 确定性寻址 blueprint、view、node、relation、flow、decision、contract，其中外部契约以稳定 `contract_id` 寻址；resolver 在解析 target 前执行 canonical schema/完整性门；Markdown 只是在评审前由 YAML 完整派生的 projection，不形成第二真源。
- 锁定适配 4+1 的同源内容、稳定节点寻址、跨视图关系与完整性门；图只作为生成/检查时的派生表达，不替代完整对象、证据、映射和完整性校验。
- 建立证据驱动的独立设计质询：逐适用视图、逐关系、逐运行时流和十个 App 根问题检查静默假设与断链；覆盖范围与分层准入均由 canonical 内容及全部准入前 checker 结果派生，不接受编写方自报完成。
- 固化 App 运行时数据流最小形状与条件式闭环校验，覆盖触发、首次加载、状态 owner、mutation、发布/失效、订阅、consumer、失败/恢复、provenance 与验证引用；只读/首次加载流不伪造写入或订阅，已声明 producer 必须闭合到所有受影响 consumer，未闭合边进入 frontier。
- 固化外部契约消费与权威契约校验：解析每段 `source_ref` 指向的项目内 Swagger/IDL/YAML/JSON 权威切片，并真实比对 operation、DTO、mapping、错误/幂等/NFR、owner、needed-by、provenance 与请求/响应映射；缺失或不一致必须 fail-closed，缺失契约只能形成需求/提案、`open_decision` 或 `blocker`，不得冒充冻结事实。
- 固化蓝图调和：新事实、证据或权威裁决更新认知和后续工作；决策翻转必须失效/重算受影响的派生结论，保留历史证据，不得让旧结论、旧映射或旧准入状态残留为当前真值。
- P1 只维护蓝图 revision/source_fingerprint 及自身派生结果的 stale；`artifact_sha256` 只作 canonical YAML 字节完整性校验；不创建、修改或移除 P2 ready set、P3 closure 状态，下游在引用不匹配时自行重新派生。
- 增加反例契约：故意制造视图缺失、跨视图冲突、运行时断链、契约映射不一致、图可解析但对象不完整、以及决策翻转后旧结论残留时，准入必须失败并定位责任。
- 本 change 在设计复核后实现 P1 framework 的蓝图 schema、resolver、checker、静态 provider 协议与 fixture；不修改宿主业务运行时代码，不进入 Change Unit/连续推进（P2）或 Component closure（P3），也不新增动态插件加载、跨单元状态或第二恢复权威。

## Capabilities

### New Capabilities

- `app-component-blueprint`: App 部件发现、适配 4+1 设计视图、跨视图一致性、证据驱动质询、分层准入、运行时数据流、权威契约映射校验与蓝图调和。

### Modified Capabilities

- `instance-extension-management`: 设计知识沿既有 `skill_assets` 绑定唯一公开入口 `/component-design`，不再指向 P1 内部流程。

## Impact

- 设计/规格层：新增 OpenSpec capability spec，供后续 P1 实施及 P2/P3 作为准入契约消费；新增带完整 `parent_goal` 声明的 3.1.0 P1 子 plan。
- 运行与发布：保留 provider-neutral 蓝图 schema/checker，设计公开入口收敛为 `/component-design`；P1 工作流移入 reference，撤下旧 command/index/bridge。UPDATE 复用既有备份清理机制，迁移说明同步 `MIGRATION.md`。
- 验收边界：P1 实施运行受影响测试、OpenSpec strict validate、default plan 扫描和专项 fixture；整仓 `--release` 与 `release:verify` 继续由总计划 m5/MG 在批次收尾承担。

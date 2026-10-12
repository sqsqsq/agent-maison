# 蓝图设计输入与物化

P3 使用 `derive.blueprint-acceptance` 和 `derive.blueprint-contracts`，返回与 `acceptance@1`、`contracts@1` 相同的 typed 内容。正式需求仍须通过蓝图/CU 准入；独立设计任务不会自动扩展为 coding。

## 来源与责任

仅读取当前 canonical CU 的 `design_refs` 选中目标。目标可携带明确的 `acceptance`、`contracts`、`use_cases` 机器内容；这些内容沿现有类型和 checker 校验，承载目标的 provenance 必须为 authoritative。缺字段、含混文字、纯 decisions/verification_refs 都不能成为默认值或占位产物。

- 蓝图负责共同决策、部件边界、外部契约；新事实改变这些内容时回 component-design 或外部 owner。
- 术语映射归蓝图：`discovery.facts` 的 `term:<术语>` 事实（`source_kind: glossary|catalog`，`canonical_module` 为获准模块）在 component-design 一次确认；spec 术语映射表只投影、不再问人。
- 模块范围归蓝图：可修改模块集合只由 CU `touches` 解析到的 development 节点 `module` 派生；spec/plan 的 Scope 只投影，`contracts.modules` 越出即 `cu_scope_matches_blueprint` 失败，范围扩大回 component-design。
- 架构影响项归蓝图：每项一条 `architecture_impact` 决策（`add_module` / `retire_module` / `move_module` / `responsibility_rewrite` / `dependency_edge` / `dsl_other`）；`dependency_edge` 施工前须已裁决且当前 DSL 已达目标许可，模块增删迁与职责改写由 closure 归位到 catalog，`dsl_other` 只登记。plan 只投影决策 id，不判定、不写 DSL。
- component-design 在设计期给可引用目标写入 acceptance/contracts/use_cases：ID、优先级、步骤、预期、分层/focus、精确写集、类型/签名、生命周期和用例分支均来自已消费事实与权威裁决。spec/plan 优先直接消费已有投影，只补真正缺失的内容；不手写重做另一套验收、契约或用例。
- spec 补缺行为/验收与真实 UI 流程，plan 生成整个 Feature contracts.change_unit 并交付已有设计用例。验收 ID 在 canonical CU predicate 的 verification_refs 明确引用（如 acceptance:AC-1）；引用仅建立映射。touches 不扩大 contracts.files，目录表/来源也不授写权限，不猜事务/DTO。

## 设计期挂载与共同继承

acceptance 挂 scenarios/logical 等设计目标；contracts 挂 development 节点和 runtime flow；use_cases 挂 runtime flow。目标 provenance 保留已有 authoritative 要求。引用目标后内容整体参与该 CU 合并：数组沿 `[module,file,holder,id??name??class??data]` 行身份去重、同身份不同内容报 authority_content_conflict；对象只在内容完全相同时接受，不逐键拼接。

CU-A 引 S+A、CU-B 引 S+B：共享 S 只放双方共同验收/写集/用例，A/B 专属 AC/BD/NFR、files、用例放独占目标。module_dependencies/navigation/resource_keys/acceptance.flows 等对象集中在一个承载目标，不拆开等自动拼接。整个 change_unit 不在设计期编写，也不进入设计内容投影；每个 Feature 的专属映射交 plan，缺失、未知谓词、过期身份或越权文件仍由原施工门拒绝。合法先后写同文件不新增门禁，不能按 predicate 隐藏误继承的 AC/文件，也不因 CU 修订/替代复制稳定设计节点。

普通 AC/BD 的机器行身份只含 id，故单次 CU 投影内唯一；投影合并/冲突规则不变。人读展示身份为“来源目标 + 条目编号”，不同目标各自 AC-1 都保留，不按裸编号全蓝图去重，不新增唯一门禁。contracts.data_models.fields.description/source_ref 为可选说明/来源，现有加载和投影透传，schema 不变。目录来自 modules[].package_path/layer、依赖来自 contracts 根级 module_dependencies、写集仅 files。

无 ui-spec 依据时保留 P0 ID/优先级/步骤/预期/ut_layer/focus，不写 linked_flow/checkpoint/屏幕流程；spec 得到真实 UI 依据后只补未声明键，已有权威预期不改，按原 checkAuthoritativeContentAligned 与 P0 门检查。不得编元素 ID、删 acceptance 或修改门禁。

## 完整交接的只读前置检查

deriveDesignPreparationReadiness 在原指针调和后，对全部未退役（含已完成）且原 constructable CU 调用 deriveBlueprintSkillInput 的**默认只读模式**。acceptance/contracts/use_cases 分别检查 canonical 内容，另一类 absent 不漏坏用例；Feature 的 use-cases.yaml 不反向参与设计投影。阶段用例未对齐当前设计时，由既有定义缺口和 plan 对齐门安排 plan 重建，不判成蓝图冲突。absent 交回原 spec/plan 补设计责任且不加门禁；canonical 内容 invalid 复用现有原因使 perUnit blocked/not-ready。

检查不物化 sidecar、不写 phase 证据、不选 CU 或开始 Goal。**正常交接不运行 prepare-blueprint-design 来提前创建 Feature 文件**；spec/plan 直接消费 provider 推导输入并各写本阶段产物。未来 plan 的 change_unit 映射缺失不阻断设计 readiness，设计投影存在也不证明 plan 完成；没有有效映射仍须安排 plan。Feature 无法安全刷新不阻挡合法 canonical 指针升版；其旧文件保留，由既有绑定/定义缺口安排 spec/plan。canonical 校验与真实写入失败仍沿原异常和整批回滚。

完整[4+1 人读样例](../operations/samples/blueprint-review-projection.valid.md)只来自 canonical 蓝图/CU，逐 CU 用生产投影共用目标选取/合并逻辑保留实际声明范围。完整 AC/BD/NFR 仅文档第 9 章、完整 files 清单仅开发视图一次，CU 用编号/链接追溯范围与冲突；“是否通过交接校验见 readiness”等机制声明文首集中一次，正文可读标签保留锚点/链接目标，追溯附录可留原地址。renderer 不读取 Feature 的 use-cases.yaml、需求原文或外部 catalog；设计来源按默认 readiness 路径检查，阶段用例按 plan 对齐门检查。canonical 能确定架构相关集合时沿用原中立摘要，否则省略摘要而保留精确 CU 绑定/声明，不承诺 carry-forward。待升版集合标“待指针升版后显示”；typed absent 明确“设计期未写入，将由 spec/plan 补”，可选表达 WARN 不变成业务阻断。

所有单元格共用 string/number/bool/list 保真规则，false/0 非空，陌生业务键只一层键值；机制元数据按所在结构排除，来源/验证引用保留。有值不假报未记录，深层声明暂未展开如实说明；不产空表/整空列，每节一行集中真实缺项，明确未知/不适用与缺失分开。概述总览/跨视图图只取已有 canonical 叙述与 relations；运行阶段图节点取 state_model.phases、边只各 branch.expected_phase_seq 相邻项并标 branch，复用现有 parser，不按 phases 顺序串 Success→Failure。页面清单、已登记图片和 journey_steps 去向表是本批导航表达上限，不生成页面导航图或从共享动作连边；图片只输出引用，不把外部图像字节作为新设计/绑定输入。隔离副本保图片相对路径并验证实际可见。

设计深度沿 [P1 既有写作/质询问题](../../skills/reference/app-component-blueprint-workflow.md#2-写入同一蓝图) 补术语含义、表级存储/安全/升级、真实失败与用户中断、错误/幂等及质量结论，App lens/质询用项目语言，不新增字段/机器阻断、不削弱原检查。示例或当前材料重渲染只证明忠实展示；缺失设计不会被 renderer 补成事实，写作真实效果仍需真实宿主干净需求实读。

## 施工映射

`contracts.files` 仍为唯一施工写集，模型、接口、文件与运行设计继续来自蓝图。**plan 在 Feature contracts.yaml 生成整个 contracts.change_unit**：经 canonical resolver 取得精确 change_unit_ref，按已有 predicate/provide/design ref ID 填真实 implementation/test/verification refs，不复制定义或凭 touches 猜落点。已有合法 Feature 映射可复用；存量蓝图的旧 change_unit 不继承为新 CU 权威，也不路由 B1 修改蓝图。

flow 目标中的 `contracts.state_management` 缺少 `design_ref` 时绑定该已选中 flow，其生命周期字段仍须完整，不能仅靠有 ref 通过检查。缺未来映射只在设计入口分离，plan 结束及后续文件/符号/测试与完整 mapping 检查保持。

需要用例时，`use_cases` 使用既有 UseCasesSpec；linked_flow/linked_branch 和 use-case schema 共用现有校验。**当前 CU 合法投影带用例时 plan 必须产出 use-cases.yaml**，从规范化投影起步并只作不冲突补充，供业务 UT 读取；原文件存在时仍必交。required_outputs 同时看投影存在与文件存在，不能因尚无文件省略该义务。无投影、无原文件时不为此修复造空文件，其它条件式义务照常派生。分支新写 expected_port_calls，旧 expected_boundary_calls 由共同纯归一化入口兼容，两键冲突如实诊断。合法空 boundaries/performance 不要求凑条目。

## 显式投影导出入口

在宿主的 framework/harness 目录执行：

```powershell
npx ts-node scripts/prepare-blueprint-design.ts --feature <canonical-CU-feature-id>
```

也可显式指定 `--project-root` 和 `--framework-root`。入口先解析并校验完整 bundle、来源和所有目标文件，再沿已有 artifact resolver 物化 acceptance/contracts 及必要 use-cases。已有内容冲突时停止，不能覆盖人工决策；已有等价结果不重复写入。不会生成 spec.md、plan.md、summary、receipt 或批准记录。

该入口保留当前投影的显式导出用途，正常交接不用它。派生文件使用已有 source 标识 provider 与 canonical CU/蓝图字节身份；spec 可据真实 UI 补未声明键，plan 可补当前映射，同一权威对齐规则保护已有内容、写集与来源，不删戳、不改称手写绕过。**刷新仅在能证明设计/CU 契约内容不变、只有来源身份升版时更新来源/引用身份，业务与阶段补充字节不变**；内容真变或等价不能证明则复核依赖后保留该 Feature 全部旧文件，返回空写集，不覆盖、不合并。带戳但指向别的身份或部分文件带戳也不能刷新 Feature，canonical 合法身份照升；旧 acceptance 由 spec 重建，旧 contracts/use-cases 由 plan 重建，不拖回其它 CU。真正无效的 canonical 仍归设计 owner，实际 I/O/CAS 失败仍回滚。

当前等价证明复用已有冻结 Feature contracts 的真实 CU 映射绑定，中立摘要展开 CU 及完整设计目标。仅 acceptance 子集相等不足以证明 CU/完整设计未变；未冻结或冻结后阶段文件已改，不能自动刷新 Feature 身份，但不阻挡 canonical 指针升版。蓝图/CU 从未发布，不维持未发布旧冻结格式的专用兼容；当前 spec/plan 正常产物仍可带 derive 来源戳。

## 未完成 CU 内容修订

尚未接受的候选先在草稿补齐，consumer 在接受前复用既有 runtime 角色判定，任一失败整批不写；普通重复接受仍拒绝覆盖。已接受且尚未退役的同一未完成交付，**仅无运行或运行已停住**时，可通过 consumer 内容修订入口提交旧精确 ChangeUnitRef 与新候选，保留 component/blueprint/CU ID、Feature identity 和目录，由框架 revision +1；无变化不增版，running 或锁竞争返回 busy。

设计准备的接点为 change-unit-design-preparation.ts 的 `reviseChangeUnitContent(projectRoot, blueprintId, [{ expectedRef, candidate }])`；expectedRef 来自 canonical resolver，候选使用原 ChangeUnitCandidate 格式，revision 由框架计算。结果分别列 revised、unchanged、busy 与 reviewDocument，不把文档刷新故障改成修订失败。

资格依历史完成事实、run 和 Feature completion 原件判断；曾完成后变 INCOMPLETE、成功终局缺投影、broken/corrupt 记录不能当从未完成。完成后只补原义务走既有同 Feature successor；新增交付、拆分/合并/迁移使用新 CU，精确退役前身保持原字节。修订复用 schema/provenance/设计/角色/依赖校验、精确旧 ref、锁与原子事务，旧 ref 竞争或任一失败不写。提供承诺改变时同批对齐消费者或显式改 provide_id，旧 VALID 不证明新提供项。

内容修订不自动启动施工或刷新旧业务产物。旧映射按 CU revision/hash 形成既有 binding 缺口（无合同载体时 cu:feature-binding、owner_phase=plan），停住 run 沿原恢复/successor 接回 plan 更新映射/范围；保留出生 manifest、历史、有效证据和累计预算，不手填 scope_revised，不热修运行中 CU。真实内容变化不套用仅身份刷新捷径。

## 阶段消费

spec/plan 的 contract 为 1.1。显式 P1 调用上下文和 P2 scope 使用 typed 内容，`required_outputs` 决定是否检查叙述格式。必须产出的机器契约、facts 和实际视觉义务继续检查。默认 workflow 仍为 1.1，旧 workflow 的无上下文调用保留原非 typed 执行路径，公开切换归 P7。

执行本次 spec/plan 时，本阶段的正式产物属于获准输出，由当前 P1 解析重新绑定；外部蓝图、设计来源和下游只读契约不因此失去约束。完整交付中验证出的新设计内容通过既有 `scope_revision_input` 提议交由 P2 重签，不能删除已冻结的 required 义务；设计专项不提交施工后继。

源码、完整真实内容夹具和机械测试不能替代真实业务宿主验收；P7 汇总宿主结果。

# 蓝图设计输入与物化

P3 使用 `derive.blueprint-acceptance` 和 `derive.blueprint-contracts`，返回与 `acceptance@1`、`contracts@1` 相同的 typed 内容。正式需求仍须通过蓝图/CU 准入；独立设计任务不会自动扩展为 coding。

## 来源与责任

仅读取当前 canonical CU 的 `design_refs` 选中目标。目标可携带明确的 `acceptance`、`contracts`、`use_cases` 机器内容；这些内容沿现有类型和 checker 校验，承载目标的 provenance 必须为 authoritative。缺字段、含混文字、纯 decisions/verification_refs 都不能成为默认值或占位产物。

- 蓝图负责共同决策、部件边界、外部契约；新事实改变这些内容时回 component-design 或外部 owner。
- 术语映射归蓝图：`discovery.facts` 的 `term:<术语>` 事实（`source_kind: glossary|catalog`，`canonical_module` 为获准模块）在 component-design 一次确认；spec 术语映射表只投影、不再问人。
- 模块范围归蓝图：可修改模块集合只由 CU `touches` 解析到的 development 节点 `module` 派生；spec/plan 的 Scope 只投影，`contracts.modules` 越出即 `cu_scope_matches_blueprint` 失败，范围扩大回 component-design。
- 架构影响项归蓝图：每项一条 `architecture_impact` 决策（`add_module` / `retire_module` / `move_module` / `responsibility_rewrite` / `dependency_edge` / `dsl_other`）；`dependency_edge` 施工前须已裁决且当前 DSL 已达目标许可，模块增删迁与职责改写由 closure 归位到 catalog，`dsl_other` 只登记。plan 只投影决策 id，不判定、不写 DSL。
- component-design 在设计期给可引用目标写入 acceptance/contracts/use_cases：ID、优先级、步骤、预期、分层/focus、精确写集、类型/签名、生命周期和用例分支均来自已消费事实与权威裁决。spec/plan 优先直接消费已有投影，只补真正缺失的内容；不手写重做另一套验收、契约或用例。
- spec 补缺行为/验收与真实 UI 流程，plan 补缺当前切片施工/用例。验收 ID 在 canonical CU predicate 的 verification_refs 明确引用（如 acceptance:AC-1）；引用仅建立映射。touches 不扩大 contracts.files，目录表/来源也不授写权限，不猜事务/DTO。

## 设计期挂载与共同继承

acceptance 挂 scenarios/logical 等设计目标；contracts 挂 development 节点和 runtime flow；use_cases 挂 runtime flow。目标 provenance 保留已有 authoritative 要求。引用目标后内容整体参与该 CU 合并：数组沿 `[module,file,holder,id??name??class??data]` 行身份去重、同身份不同内容报 authority_content_conflict；对象只在内容完全相同时接受，不逐键拼接。

CU-A 引 S+A、CU-B 引 S+B：共享 S 只放双方共同验收/写集/用例，A/B 专属 AC/BD/NFR、files、完整 change_unit 映射放独占目标。module_dependencies/navigation/resource_keys/change_unit/acceptance.flows 等对象集中在该 CU 一个目标，不拆开等自动拼接。误把 A 映射放 S，B 有不同映射时为 authority_content_conflict；B 未声明自身映射时按实际检查报 change_unit_predicate_mapping_unknown/missing。合法先后写同文件不新增门禁，不能按 predicate 隐藏误继承的 AC/文件。

普通 AC/BD 身份只含 id，故单次 CU 投影内唯一；推荐全蓝图稳定唯一，跨目标同 ID 不同内容按目标来源披露，不新增全蓝图唯一门禁。contracts.data_models.fields.description/source_ref 为可选说明/来源，现有加载和投影透传，schema 不变。目录来自 modules[].package_path/layer、依赖来自 contracts 根级 module_dependencies、写集仅 files。

无 ui-spec 依据时保留 P0 ID/优先级/步骤/预期/ut_layer/focus，不写 linked_flow/checkpoint/屏幕流程；spec 得到真实 UI 依据后只补未声明键，已有权威预期不改，按原 checkAuthoritativeContentAligned 与 P0 门检查。不得编元素 ID、删 acceptance 或修改门禁。

## 完整交接的只读前置检查

deriveDesignPreparationReadiness 在原指针调和后，对全部未退役（含已完成）且原 constructable CU 调用 deriveBlueprintSkillInput 的**默认只读模式**。acceptance/contracts/use_cases 分别检查，另一类 absent 不漏坏用例；不传 pure，既有手写 use-cases 冲突仍以 authority_use_cases_conflict 提前报出。absent 交回原 spec/plan 补设计责任且不加门禁；invalid 复用现有原因使 perUnit blocked/not-ready。

检查不物化 sidecar、不写 phase 证据、不选 CU 或开始 Goal。prepare-blueprint-design CLI 是下面的写入口。已物化 CU 调和刷新先失败会抛 change_unit_blueprint_ref_bump_rejected 并保持整批指针/派生文件原字节，沿原异常与回滚，不能伪装 readiness 成功或正常 not-ready。

完整[4+1 人读样例](../operations/samples/blueprint-review-projection.valid.md)只来自 canonical 蓝图/CU，逐 CU 显示与生产投影共用目标选取/合并逻辑所得声明集合，**是否通过交接校验见 readiness**。renderer 不读取 Feature 的 use-cases.yaml、需求原文或外部 catalog；这些来源的真实校验仍在上述默认 readiness 路径。canonical 能确定架构相关集合时沿用原中立摘要，若相关性须靠外部 catalog 才能确定，则省略摘要并保留精确 CU 绑定与声明集合，不承诺 carry-forward。待升版 CU 的合并集合标“待指针升版后显示”。字段 absent 明确“设计期未写入，将由 spec/plan 补”；可选表达形状 WARN 不变成业务阻断。样例是框架表达夹具，不代表真实宿主验收。

## 施工映射

`contracts.files` 仍为唯一施工写集。蓝图的 `contracts.change_unit` 提供已有的 predicate/provide/design ID-only 映射及明确 implementation/test refs；准备入口只补入从 canonical CU 解析出的 `change_unit_ref`。`design_ref_mappings[].design_ref` 在蓝图源内容中可使用 CU 已引用的 `{kind, id, view_id?}` 目标地址，投影时补全当前身份。

这避免在蓝图字节中嵌入指向自身的哈希。flow 目标中的 `contracts.state_management` 缺少 `design_ref` 时绑定该已选中 flow，其生命周期字段仍须完整，不能仅靠有 ref 通过检查。

需要用例时，`use_cases` 使用既有 UseCasesSpec；linked_flow/linked_branch 和 use-case schema 共用现有校验。合法空 boundaries/performance 不要求凑条目。接口、数据模型、runtime 与 file-like 引用不因省略叙述文档而免检。

## 唯一物化入口

在宿主的 framework/harness 目录执行：

```powershell
npx ts-node scripts/prepare-blueprint-design.ts --feature <canonical-CU-feature-id>
```

也可显式指定 `--project-root` 和 `--framework-root`。入口先解析并校验完整 bundle、来源和所有目标文件，再沿已有 artifact resolver 物化 acceptance/contracts 及必要 use-cases。已有内容冲突时停止，不能覆盖人工决策；已有等价结果不重复写入。不会生成 spec.md、plan.md、summary、receipt 或批准记录。

派生文件使用已有 `source` 字段标识 provider 与 canonical CU/蓝图字节身份；P1 重新读取时对照当前投影。revision/hash、外部权威或内容变化会使旧投影失效，不用旧 PASS 顶替。蓝图升版经 component-design 调和、CU 指针原位升版时，来源戳指向升版前身份的派生文件即由同一入口同批刷新为新投影；带机器来源戳却指向别的身份（或只有部分文件带戳）的，该 CU 不升版并说明原因，没有机器来源戳的文件不归本入口、原样保留。

## 阶段消费

spec/plan 的 contract 为 1.1。显式 P1 调用上下文和 P2 scope 使用 typed 内容，`required_outputs` 决定是否检查叙述格式。必须产出的机器契约、facts 和实际视觉义务继续检查。默认 workflow 仍为 1.1，旧 workflow 的无上下文调用保留原非 typed 执行路径，公开切换归 P7。

执行本次 spec/plan 时，本阶段的正式产物属于获准输出，由当前 P1 解析重新绑定；外部蓝图、设计来源和下游只读契约不因此失去约束。完整交付中验证出的新设计内容通过既有 `scope_revision_input` 提议交由 P2 重签，不能删除已冻结的 required 义务；设计专项不提交施工后继。

源码、完整真实内容夹具和机械测试不能替代真实业务宿主验收；P7 汇总宿主结果。

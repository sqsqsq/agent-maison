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

## 存储内容约定

根 `contracts[].table_schema` 同时承载现有单表 `{table, columns}` 和库级 `{database?, version?, security_level?, encrypt?, tables:[{name, primary_key?, columns, constraints?, upgrade?, source_ref?}]}`。库名、版本、安全级别和加密位于该既有子树；不另建数据库配置字段/schema。列保留 `name/type/description/from/encoding/default/constraints/source_ref` 等已写内容；`description` 说明语义、单位与约束，主键、表约束、升级与来源分别表达，不从类型推断索引/事务或安全结论。data_domains.security 解释敏感处理与生命周期，精确阈值仍在 acceptance。

renderer 展示库级信息和每张表，旧单表仍可读；未知标量业务键一层保留，深层未展开如实说明，不把没有顶层 columns 的库级设计误判成缺失。只省真实整空列，不能减少宿主列或修改 YAML 适配 renderer；来源仍不授予写权限。

## 完整调用设计与派生时序

flow 承载的 `contracts.state_management[].ordered_steps`（现有 string[]）是调用设计主责位置：逐条明确 caller/callee/操作、参数/结果、等待/回调、条件、失败与完成返回。typed components/interfaces/data_models、根 operation/DTO/errors/idempotency/table_schema、flow 的发布/消费者/恢复及 use_cases 提供同源细节；保留 flow.ordered_steps 时同次同步。页面→业务对象→Repository→实际 helper/数据库、结果返回与完成/导航/消费者均须依真实设计，不从 user_sequence、expected_port_calls、类名或目录推断调用者。

设计 agent 在同次 component-design 根据已写事实生成既有 generated_graphs 的 sequenceDiagram，原 runtime/flow 独立质询核图文一致。一图一事；多角色、深嵌套或长调用链看不清时按子问题拆图和说明，主路与失败/恢复分开，保留调用返回、等待、分叉与段间交接，完整调用事实留 ordered_steps 和参考。每段先导读再用 graph_ids 放对应图，实际在正常预览宽度读图，不以放大或语法通过代替可读验收，不设图规模硬门。graph_id 对应既有 derived_results.result_id，沿 input_revision/source_fingerprint/decision_fingerprint/status 与原 freshness 机制更新；图可重建且非权威，不新建 sequence_diagrams/interactions 字段/schema、独立 mmd 真源或每箭头顶层 relation。node_refs 指真实 flow/承载目标，relation_refs 可空；缺结果或 stale 的时序图提示重建、不展示。修改调用事实沿原 revision、CU 指针/摘要规则，不能仅换图来源戳。

旅程总览与角色关系图也由作者按明确旅程顺序及已有调用/责任事实写入 generated_graphs，复用派生身份，用 graph_ids 就近放图；中文角色与消息意图在前，类名/方法必要时括注，不猜连线。flowchart 子集仅含 flowchart/graph 方向声明、ASCII id、`id["标签"]`、`-->` 与 `-->|标签|`，无 `{}`、subgraph 或注释。renderer 只校验展示：时序图及 relation_refs 缺省/空数组的作者展示图，超子集、坏端点/块/地址只 WARN，在原流程或 graph_ids 位置说明原因且不展示，不经 sourceGaps/invalid 汇总影响 admission/readiness；有 relation_refs 的关系结构图仍 BLOCKER，真正关系/canonical/契约/来源缺陷照旧检查。缺图不加机器门禁，也不代表人读完整。支持子集与短例见 [P1 图写作](../../skills/reference/app-component-blueprint-workflow.md#完整调用设计与时序图)。

## 完整交接的只读前置检查

deriveDesignPreparationReadiness 在原指针调和后，对全部未退役（含已完成）且原 constructable CU 调用 deriveBlueprintSkillInput 的**默认只读模式**。acceptance/contracts/use_cases 分别检查 canonical 内容，另一类 absent 不漏坏用例；Feature 的 use-cases.yaml 不反向参与设计投影。阶段用例未对齐当前设计时，由既有定义缺口和 plan 对齐门安排 plan 重建，不判成蓝图冲突。absent 交回原 spec/plan 补设计责任且不加门禁；canonical 内容 invalid 复用现有原因使 perUnit blocked/not-ready。

检查不物化 sidecar、不写 phase 证据、不选 CU 或开始 Goal。**正常交接不运行 prepare-blueprint-design 来提前创建 Feature 文件**；spec/plan 直接消费 provider 推导输入并各写本阶段产物。未来 plan 的 change_unit 映射缺失不阻断设计 readiness，设计投影存在也不证明 plan 完成；没有有效映射仍须安排 plan。Feature 无法安全刷新不阻挡合法 canonical 指针升版；其旧文件保留，由既有绑定/定义缺口安排 spec/plan。canonical 校验与真实写入失败仍沿原异常和整批回滚。

`validateChangeUnitFeatureProjection` 的 designOnly 不调用依赖未来 plan.design_ref_mappings 的 componentProjectionErrors：有组件索引和合法 typed UI 设计、无 change_unit 是合法设计输入。plan 及后续组件映射检查保持完整，组件选型设计原检查不变，不新增设计期替代门。

完整[人读样例](../operations/samples/blueprint-review-projection.valid.md)只来自 canonical 蓝图/CU；正文按评审问题讲方案，4+1 建模与章节对照保留在参考。逐 CU 用生产投影共用目标选取/合并逻辑保留实际声明范围。完整 AC/BD/NFR、files 与施工精确映射在同文档参考查询，正文主题与 CU 用来源限定编号/链接追溯范围与冲突。身份/准入/来源/机制说明集中参考入口，说明缺失/过期提示在文首；可读标签保留锚点/链接目标。renderer 不读取 Feature 的 use-cases.yaml、需求原文或外部 catalog；设计来源按默认 readiness 路径检查，阶段用例按 plan 对齐门检查。canonical 能确定架构相关集合时沿用中立摘要，否则省略摘要而保留精确 CU 绑定/声明，不承诺 carry-forward。待升版集合标“待指针升版后显示”；typed absent 明确“设计期未写入，将由 spec/plan 补”，可选表达 WARN 不变成业务阻断。

所有单元格共用 string/number/bool/list 保真规则，false/0 非空，显式空对象/数组显示“无”，仅来源键的对象才称“仅来源信息”；陌生业务键只一层键值，机制元数据按所在结构排除，来源/验证引用保留。有值不假报未记录，深层声明暂未展开如实说明；不产空表/整空列，每节一行集中真实缺项，明确未知/不适用与缺失分开。缺项汇总只处理 renderer 显式标记，不改作者标题/正文。框架枚举只在对应字段中文化，未知值/自由业务状态/API 原样；布尔含义列显示是/否，不改正文 true/false。

三类确定性图各循真实来源：跨视图图只 canonical relations；运行阶段图节点取 state_model.phases、边只各 branch.expected_phase_seq 相邻项，按起止对去重并保留全部分支来源，首分支只作具名展示基准，不能假定其到 Success 已含完成链；模块图只 typed contracts 根级 module_dependencies，声明模块补层级/变化标签，未声明依赖模块仅名称，不合成冲突并集。复用原 flowchart/parser，不按 phases 顺序造边，状态/模块名不伪装稳定设计地址。完整时序由设计 agent 生成，reader_guide.graph_ids 只控制就近放置，同图首次引用绘制、后续位置保留图名回链，不设章节优先级；页面清单、已登记图片和 journey_steps 去向表不推页面路由，图片只输出引用，不作为新设计/绑定输入。

同源 DTO/模型须核字段、语义、约束及来源后复用，required 与 nullable 独立、差异保留；同名不能判等。UI 主责表、相同恢复、验收全文和 files 仅主责处完整展示，其余链接，仍保留每 CU 精确范围、多源逐项关联和稳定锚点；不得全局删同值列或用 touches 代 files。指定说明列仅至少三行全同才可提表前。隔离材料 A 保留宿主 canonical/CU/图片原样，验证展示；B 明确另存补调用步骤/派生图的设计变体验证生成与质询，不把 B 新事实混入 A 或承诺原样无图数据凭空四图。宿主定向补时序、复检文档/readiness即可，保留其它有效设计。

设计深度沿 [P1 既有写作/质询问题](../../skills/reference/app-component-blueprint-workflow.md#2-写入同一蓝图) 补术语含义、表级存储/安全/升级、真实失败与用户中断、错误/幂等及质量结论，App lens/质询用项目语言，不新增字段/机器阻断、不削弱原检查。示例或当前材料重渲染只证明忠实展示；缺失设计不会被 renderer 补成事实，当前时序效果仍须用户在原宿主定向补设计后实读。

## 读者说明与施工摘要边界

写法、可选 reader_guide 形状、只读 `--reader-guide-digest` 命令及正文八问见 [P1 写作指引](../../skills/reference/app-component-blueprint-workflow.md#按评审问题写说明)。原字段已可读就直接用，仅改表达优先 `review_summary.reader_guide`，不强制每节新建 guide；修改原字段属于设计修订，会使说明摘要过期，也可能改变整蓝图引用的 CU 摘要。source_refs 指 canonical JSON Pointer，可引用 acceptance 对象、三类数组或完整单项限定编号归属，不必逐 ID 堆来源、不借其它目标的同号条目补链接；graph_ids 引已有图。首屏向不了解项目代码的评审人说明现状、变化、结果与范围，产品非目标与本次只执行设计的阶段状态分开，摘要施工只链接第 11 节；关键取舍逐问题讲选择、理由与代价。恢复速查用 guide.prose 的 Markdown 短表，每行对应实际 BD 编号和 source_refs，解释发生什么、用户看到什么、数据是否保存、如何继续，不改精确预期或补造行为。界面各写 journey 小节并精确引用对应图片登记单项，不引用整批截图数组或从名称猜图；截图紧随说明，每图一次。角色说明由设计 agent 从已有职责、状态和调用事实归纳，类名作对照、完整方法留参考；职责在主责小节解释一次，正文只保留一份文件目录树，CU 精确写集与授权映射仍可查。每节只选支撑其说法的来源，设计依据用一个参考入口，避免重复同名链接。原设计 agent 同次完成可渲染草稿、图、说明与 source_digest，先 `--write-review --json`，再派既有独立质询：不继承父上下文 YAML/设计摘要，先只读首屏复述、正文答八问，完成前不读 YAML，之后按原 scope 核源；作者一轮定向修订后复核摘要、交付前重渲读成品。仅定稿蓝图、尚无 CU 的评审交付同适用；不要求先通过含质询结果的完整准入，checker FAIL 与 review_document current/refreshed 分别报告，真实解析/来源 BLOCKER 不吞掉。无图像仍从评审 Markdown 内 Mermaid 核一图一事，指出混讲与需拆段落及衔接；仅字号/布局/是否需放大标未核验，图错章或一段未答章内问题须指出，段落少本身不失败。生成器不调用模型、不代写或盖摘要，中文全角标点后多余空格由渲染统一处理，不靠 YAML 字面块规避。无说明或摘要失效时展示当前事实与完整参考并在文首提示，不改变 admission/readiness/run。

说明不是 acceptance/contracts/use_cases 或调用事实的新来源。蓝图目标进入 CU 与 Feature 的 identityNeutralDigest 时，仅排除 `review_summary.reader_guide`；任意同名业务键、rationale、alternatives 和其它设计内容仍保留。纯说明润色会改变文档精确蓝图 SHA 与正文，不改变 CU 业务摘要；真实流程、契约、验收或 ordered_steps 变化仍影响原施工证据。guide 不固化 CU 身份、修订或集合，施工说明取当前 canonical CU 原字段。CU purpose、provides/target_predicates 的 description 与 safe_intermediate_state.description 用完整句子写目的、交付和安全状态；润色不改变职责含义、依赖、写集或身份，已接受 CU 仍须通过下方既有 consumer 内容修订接点，不能直接改 canonical。

已有 derive.blueprint-* 来源戳仍比较完整蓝图来源身份。仅润色说明后，须沿既有指针调和与安全刷新接线更新来源戳和身份指针，再由原阶段输入解析核实 resolved；不能只凭中立摘要不变绕过 source stale 检查。等价依据仍来自真实已冻结完整绑定，正文与合法阶段补充原字节保留；依据缺失回原责任阶段，真实 ordered_steps 变化不得按润色刷戳放行。

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

当前没有 CU 内容修订 CLI；`--accept-candidates` 只接受新候选，不能用它覆盖已有 CU。需要调用上述既有 API 时，可从已安装依赖的 `framework/harness` 用 ts-node 运行表达式。先完成必要的蓝图指针调和，再取当前 CU 快照及精确 ref 到**临时候选**，例如下面的 PowerShell 用法（所有占位符由当前项目替换，providerId 使用原 provenance 中已登记的 provider）：

```powershell
cd framework/harness
npx ts-node --eval @'
const fs = require('fs');
const p = require('./scripts/utils/change-unit-path');
const loaded = p.loadCanonicalChangeUnit('<宿主绝对路径>', '<blueprint-id>', '<cu-id>');
const revisions = [{
  expectedRef: p.createChangeUnitRef(loaded),
  candidate: { providerId: '<原provider-id>', artifact: p.asChangeUnitArtifact(loaded.changeUnit) }
}];
fs.writeFileSync('<临时候选绝对路径.json>', JSON.stringify(revisions, null, 2) + '\n', 'utf8');
'@
```

只编辑临时候选中的 `candidate.artifact` 获准文字，保留快照的 expectedRef，不手改 revision/身份、提供项 ID、依赖或写集；其余内容仍经原校验。提交同一候选：

```powershell
npx ts-node --eval @'
const fs = require('fs');
const api = require('./scripts/utils/change-unit-design-preparation');
const revisions = JSON.parse(fs.readFileSync('<临时候选绝对路径.json>', 'utf8'));
const result = api.reviseChangeUnitContent('<宿主绝对路径>', '<blueprint-id>', revisions);
console.log(JSON.stringify(result, null, 2));
'@
```

这是既有 consumer API 的调用示例，不新增命令或交接脚本。旧 ref 竞争应重新读取并复核候选，busy 等原运行/锁结束后再提交；修订后沿已有 readiness/文档物化读成品。普通润色也遵守下述未完成资格，不能为改说明修订已完成或退役 CU；不在蓝图 guide 固化 CU 文字。

资格依历史完成事实、run 和 Feature completion 原件判断；曾完成后变 INCOMPLETE、成功终局缺投影、broken/corrupt 记录不能当从未完成。完成后只补原义务走既有同 Feature successor；新增交付、拆分/合并/迁移使用新 CU，精确退役前身保持原字节。修订复用 schema/provenance/设计/角色/依赖校验、精确旧 ref、锁与原子事务，旧 ref 竞争或任一失败不写。提供承诺改变时同批对齐消费者或显式改 provide_id，旧 VALID 不证明新提供项。

内容修订不自动启动施工或刷新旧业务产物。旧映射按 CU revision/hash 形成既有 binding 缺口（无合同载体时 cu:feature-binding、owner_phase=plan），停住 run 沿原恢复/successor 接回 plan 更新映射/范围；保留出生 manifest、历史、有效证据和累计预算，不手填 scope_revised，不热修运行中 CU。真实内容变化不套用仅身份刷新捷径。

## 阶段消费

spec/plan 的 contract 为 1.1。显式 P1 调用上下文和 P2 scope 使用 typed 内容，`required_outputs` 决定是否检查叙述格式。必须产出的机器契约、facts 和实际视觉义务继续检查。默认 workflow 仍为 1.1，旧 workflow 的无上下文调用保留原非 typed 执行路径，公开切换归 P7。

执行本次 spec/plan 时，本阶段的正式产物属于获准输出，由当前 P1 解析重新绑定；外部蓝图、设计来源和下游只读契约不因此失去约束。完整交付中验证出的新设计内容通过既有 `scope_revision_input` 提议交由 P2 重签，不能删除已冻结的 required 义务；设计专项不提交施工后继。

源码、完整真实内容夹具和机械测试不能替代真实业务宿主验收；P7 汇总宿主结果。

# 组件资产：发现、策展与选型

这是组件字段、五级裁决和静态信号的术语 SSOT。它在组件域落实 [Code Graph §2](code-graph.md)：源码唯一 SSOT、派生层可丢弃重建、策展层只记录代码看不出的知识；不共享函数级 code-graph drift 提取器。

三份资产分别负责：`paths.component_index` 是源码派生的共享组件库存，`paths.component_catalog` 是人确认的用途与限制，蓝图既有 decisions 中的 `component_asset_selection` 是本次选型权威。Feature 的 `contracts.components[].asset_selection` 仅作施工投影。

## 索引

默认 `doc/component-index.yaml`；文件存在即主动启用，git 入库，勿手编。在消费者 `framework/harness` 执行 `npm run bootstrap:component-index -- --project-root <宿主根>`。没有文件时 Feature 校验跳过，初始化/更新不创建文件，UPDATE 不回填配置键。

根字段 `schema_version: '1.0'`、`components: []`。条目字段：`id`、`module`、`file`、`symbol`、`kind`（component|builder）、`props`（参数名数组）、`deprecated`、`source_fingerprint`（文件原始字节 SHA-256）、`static_checks`。ID 为 `<module>/<模块内相对文件>#<源码符号>`，file 为项目相对路径。按 ID 排序；禁止时间戳、绝对路径、引用计数或调用点样本。改文件名/符号得到新 ID。

仅扫 module-catalog 的 HAR/HSP，经合法跨模块出口导出的 `@Component` / `@ComponentV2` / `@Builder`。出口复用 profile 的 main→fallback 解析；支持一跳具名 re-export（别名仍定位定义符号），`export *` 只 WARN。不扫 HAP/AtomicService 或私有组件。日常 catalog phase 重扫比较，漂移 MAJOR，源码始终优先。

## 策展

默认 `doc/component-catalog.yaml`；根字段同索引。条目只允许 `id`、`intent`（标签数组）、`one_liner`、`use_when` / `not_for` / `easily_confused_with`（数组，后者引用 ID）、`status`（recommended|legacy|deprecated）、`notes`，可选 `golden: {file, symbol}`。禁止复制索引字段，消费时按 ID join。

`/component-catalog-bootstrap` 沿 catalog-bootstrap staging→逐条 y→合并纪律工作，只有人能改变策展结论和 status。合并新增/修改卡必须引用当前索引 ID，日常悬空为 dangling WARN；由人决定迁移或删除，不自动降级或造 tombstone。index 有但 catalog 没有即推导 uncurated WARN；候选被某 Feature 用到时增量策展，不要求全库盘完。易混项互链与 golden 存在性均为 WARN。

## 五级选型

| resolution | 施工含义 |
|---|---|
| reuse | 直接复用已有组件 |
| configure | 用已有参数表达需求 |
| adapt | 在使用方编写局部包装/组合 |
| evolve | 兼容演进共享定义，provider 必须进入 in_scope_modules |
| custom | 不绑定共享资产的自定义实现，包括继续修改 Feature 私有组件 |

先核对语义同一性（变体还是另一物种）、纯增量兼容性、live 调用点影响范围、变体轴是否膨胀，再作裁决。同一组件出现两个以上包装时 review WARN 建议 evolve；语义重复只由带源码上下文的 review 判断。

蓝图在 changed development 或涉 UI 的 logical/scenarios 视图读取资产；每个 development 页面/UI 目标一条扁平 decision：`kind: component_asset_selection`、`target_ref: view:development/node:<id>`、`asset_resolution`、`component_ref`、`rationale` 及既有 owner/provenance/verification_refs/status。非 custom 必须 component_ref，adapt/evolve/custom 必须 rationale。provenance.source_ref 只指配置的 index/catalog 证据。verified_unchanged development 禁止产出选型决策。

CU 用既有 `design_refs` 引用 decision，Feature 用既有 `design_ref_mappings.implementation_refs` 关联 `file#组件name`（文件唯一组件可省略 #name），不得新增 decision_ref。Feature 单值 `asset_selection: {resolution, component_ref?, rationale?, bindings?}` 的前三项与 decision 严格相等；bindings 为本地参数绑定对象。多资产沿原 components/children 树拆条目。

UI 强制谓词沿既有 kind：page/component/builder，以及既有 Component/ComponentV2/Builder decorator 或 navigation destination 信号；不为工具类新增枚举约束。有 index 时命中谓词的条目必须选型；在途旧 Feature 回 plan 补齐。

依赖从 `components[].module`（使用方）与 index.module（定义方）加 architecture DSL 实时计算，复用既有 outer/intra-layer 许可；module/file 仍为使用位置。非法时依次换候选、在 plan 声明组件下沉、请求用户批准新边。AI 不改 DSL 自授。goal 换选自动、下沉经 auto-replan，新边沿 await-confirm 停放后恢复。蓝图中的未决新边用现有 gap（verification_refs 引 decision）记录 owner/needed_by，当前 CU 未获权责裁决不得施工。

错误选型/非法依赖、未登记共享导出、新共享组件静态不合规按 BLOCKER/FAIL 进入阶段最终裁定；蓝图投影不一致继续沿既有 BLOCKER。索引漂移保留 MAJOR 诊断，uncurated/dangling 等 WARN 不阻断，不改变全局严重级别规则。选型实际引用的 index/catalog 文件必须可读；未引用的 optional catalog 可以缺失，不新增锚点解析要求。映射覆盖按组件条目（file#name）计算，不同文件的同名组件分别覆盖。

## 可用性与有限静态信号

每份蓝图保留 optional `component-assets` Seam Card。无 UI 维度为 not_applicable；有 UI 无可读索引为 unknown|degraded，附 unknown gap（verification_refs 含 `provider:component-assets`）。远期切片用 open_decision；当前 slice 依赖选型则 blocker，生成索引或补足裁决后再放行。复用既有 needed_by/admission，不伪造选型。

| static_checks 键 | 仅检查的事实 |
|---|---|
| scalable_font_unit | 文本 fontSize 的显式 fp 单位；不证明放大后无截断 |
| no_hardcoded_hex_color | 未检出硬编码 #hex；不证明 token 或对比度 |
| declared_touch_target | 交互表面声明尺寸至少 44vp；不证明实际命中区域或体验 |

四值 pass/fail/unknown/not_applicable：not_applicable 只用于确无该类表面；存在但静态判不出就是 unknown。多表面合并时 fail 优先于 unknown，再 pass；全部不适用才不适用。源码隐藏的动态构建/尺寸不得用 not_applicable 消债。

未展开的全局小写 Builder 调用同样保留 unknown。仅修改合法出口，把原私有组件导出为共享组件，也属于本 Feature 的新增资产；由当前/历史扫描的导出差异判断，出口位置只在扫描内存结果中传递，不写入 index。Windows 历史读取复用 Git 文件清单匹配真实大小写，避免将读取拼写差异当成历史不存在。live 样本按定义符号检索，别名可能漏采；未检出不代表无调用。

本 Feature 新登记共享导出的适用检查不得 fail/unknown；既有共享组件 unknown 不阻断。新旧沿既有 goal baseline、diff base 或 coding trace/HEAD 源码比较，不建持久状态。custom 私有组件不要求入库；共享出口须刷新 index，缺策展仅 WARN。本期不提供渲染、真机或完整适配能力证明。

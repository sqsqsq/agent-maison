# coding 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/coding/SKILL.md`](../feature/coding/SKILL.md)。本文承载 Step 2.5a（视觉真源 Read，pixel_1to1 8 项 BLOCKER 门禁）、Step 3.5（业务编排命名入口约束）、Step 6.5/7.1（真实编译闭环与修复策略）的完整机制；触发/门禁清单/闭环判定仍以主文档为准。

## Step 2.5a 视觉真源 Read（`ui_change=new_or_changed` 时·BLOCKER，pixel_1to1 核心红线）

1. **必须 `Read`**：`authoritative_refs` 指向的每一张原图 + `ui-spec.yaml` 全文。UI 实现以**原图 + ui-spec 的 token/组件树/逐字文案/资产 key**为准；禁止占位图标、全局主题色、泛化文案静默替代。资产缺失须按 ui-spec `assets[]` 显式 `placeholder`，不得静默替换。

2. **资产物化（crop 真图落地·禁占位冒充）**：对 `assets[]` 中 `acquisition: crop` 且非 `placeholder` 的每个 key，读其 `resolved_path`（spec 阶段真裁图）并**复制**进引用它的模块 `<module>/src/main/resources/base/media/<key>.<ext>`。**严禁**：①生成 1×1/纯色/空 PNG 占位冒充真图；②在工程根建 `media/` 目录冒充资源。缺真图按显式 `placeholder` 停下求人，不得静默糊弄。门禁 `visual_parity_asset_materialized`（pixel_1to1→BLOCKER）校验模块 media 为真图；`resource_integrity` 以模块资源目录实际文件判可用性，工程根/契约路径占位不被采信。**物化前置**：只有 spec 阶段 `asset_crop_validation` 判 `verified` 的 crop 才可物化——门禁 `visual_parity_unverified_crop` 重算产物 sha256 与验真裁决比对，物化须从 `resolved_path` **原样字节复制**（不得再加工/压缩/换图）。

3. **可见文案白名单**：源码 `Text()/Button()` 字面量与被 `$r('app.string.*')` 引用的 value 中，用户可见 CJK 文本**必须来自 ui-spec/ref-elements 文本集**——原图没有的文案严禁无中生有（历史事故：zone 名被脑补成可见标题）。想加分组标题须回 spec 补建模，不许 coding 自造。确属功能必需的非原图文案（toast/错误提示/空态兜底）→ 登记 `<features_dir>/<feature>/coding/visible-text-exemptions.yaml`（`entries[].text` + **非空 `rationale`**，无理由不生效；review 视觉维度逐条复核）。门禁 `visible_text_whitelist` 拦截。

4. **按 spec 声明渲染几何/填充**：声明 `width_ratio≤0.6`/`align: end` 的按钮不得 `.width('100%')`/`layoutWeight(1)`；`variant: tonal` 不得高饱和实心 `backgroundColor`；`subtitle_position: trailing` 的副标题须同行右置、`below` 才题下。门禁 `visual_parity_render` 为 pixel_1to1 BLOCKER——抓的是源码静态可判的确定性违规，不缓期"以 device 为准"。

5. **严禁透明占位冒充**：**绝不允许**把 spec 文本/资产/符号引用挂在 `opacity(0)`/`visibility(Visibility.None|Hidden)`/零尺寸/`fontSize(0)` 节点上"骗"presence 扫描——引用在、渲染无＝作弊，比缺失更恶劣（掩盖问题+污染结构/无障碍语义）。元素该渲染就真实可见渲染；实现不了走 ui-spec 显式 placeholder / fidelity_deferrals + 真人签字。门禁 `visual_parity_invisible_presence` 拦截。

6. **结构声明台账**：ui-spec 的**每条结构声明**（`subtitle_position`/`layout_group`/`bg_color`/`global_elements` 条目）必须在 `<features_dir>/<feature>/coding/structure-conformance.yaml` 逐条登记：`entries[]: node_id/declaration/implemented_by（真实 struct 名）/how（一句话实现说明）`。背景：结构声明曾被 coding 静默无视，没有任何产物记录处理方式，拖到真机才暴露——台账让每条声明必须表态。**登记≠实现完成**——`implemented_by` 糊名（struct 不存在）门禁直接拦；内容糊弄会被 review 逐条人审+device 文本信号双重打回。无 id 节点用门禁报错里的合成键（`screen:<sid>/<type>@<order>`）照抄。门禁 `structure_declaration_ledger` 拦截。

7. **弱模型**：若无法看图，仍须完整读取 ui-spec 文本 SSOT。**模型档位**：Read 原图步骤推荐强 VL；纯编码步骤可用内网弱模型。

## Step 3.5 业务编排与命名入口约束

**触发条件**：仅当 `use-cases.yaml` 存在时执行。**核心原则**：不强制"必须在 `domain/usecase/` 下新建类"这类代码形态硬规则，由本 Skill 按复杂度自选最贴合形式，但**必须**满足 `named_business_handler` 规则。

**业务编排代码形态（三选一，按复杂度渐进）**：

| 形态 | 何时选用 | 物理位置 |
|------|---------|---------|
| A. Page 命名方法 | 单页面线性业务流（1~3 步），无跨 UI 状态共享 | `presentation/pages/XxxPage.<ext>` 内命名 `async` 方法 |
| B. 普通协调类（Flow/Coordinator） | 多 UI 共享状态、多步调用、可能回滚 | 模块业务语义最贴合目录的非 UI 组件 class |
| C. 导出命名函数 | 工具化/无状态业务编排 | `domain/`或`shared/`下 `export async function xxx(...)` |

**关键约束（三形态通用）**：①`ui_bindings[].user_actions[].calls` 引用的必须是**真实存在的命名符号**（传统函数/类方法/顶层导出/宿主语言类字段函数/顶层 const 箭头函数均合法，`named_business_handler` BLOCKER 严格校验）；②**禁止匿名 inline lambda 承载业务**（`.onClick(() => { 做一堆业务 })` 禁止用于 use-cases 列出的入口，须先有命名符号再被转发）；③每次 `calls` 引用须 UT 可直接调用（无需构造 UI 组件/runtime）；④**禁止新造 Port 接口**——`data_boundaries.type` 必须是 contracts.yaml 已登记的既有 data 层类，UT 用 Spy/Fake/Stub 打桩。

**禁用 import**：宿主具体禁入符号见 `framework/profiles/<project_profile>/skills/coding/profile-addendum.md`；中立约束：形态 B/C 源文件及形态 A 命名方法体内，禁止 import 任何 UI/导航/资源运行时 API（含类型引用），除非 profile 明确豁免。

**UI 层最小改造**：每个 `ui_bindings[]` 按角色（entry/progress/dialog/result/passive）实现；`subscribes` 用 `@Watch` 或状态订阅翻译为渲染/跳转/Toast；`user_actions[].calls` 的 `onClick` 只做"参数准备+转发"，不写业务分支。

**自检**：完成每个业务编排文件后，扫描 profile addendum 披露的 UI 禁入关键字，命中即停下改正；打开 use-cases.yaml，对每个 `calls` 符号 grep 确认存在且是命名符号（非匿名挂载）。

## Step 6.5 真实编译闭环

**首选方式**：通过 harness 触发（避免 agent 自拼复杂命令）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature <feature-name> --summary --failures-only
```

`coding.compile` BLOCKER 的具体 provider 与日志格式由当前 profile 声明；优先读 `summary.json` 的 `coding_run_status.can_claim_done` 须为 `YES` 才能进 verifier+receipt。

**自闭环修复策略**：①看 verdict（profile compile capability PASS 才算过，FAIL 进修复闭环）；②读完整日志（不允许只看前 100 行猜）；③按错误类型分类：宿主语法/类型错误回 Step 3 修文件；依赖缺失先核对 harness 自身 Tier_1，若已满足 harness 会自动 `ohpm install` 重编译（agent 不得要求用户手工装），仅 `project_dependency_install_failed`（registry/鉴权/网络）才向用户求助，`project_dependency_undeclared` 时 agent 自补声明后重跑；包描述/模块依赖错误回补依赖；资源引用缺失回补资源声明；④修完再跑，直到 PASS；⑤**绝不允许**：把编译失败定性"环境问题"绕过、用环境变量跳过 BLOCKER compile capability、"改了就不验"。

**工具链不可用**：检查 `framework.config.json` 是否有当前 profile 要求的 toolchain 配置且路径存在；未配置/错误则运行 profile 探测脚本或走 [framework-init](../project/framework-init/SKILL.md) 配置流程；再跑一次。**绝不允许**因找不到工具就把规则状态写 SKIP/PASS，或用跳过环境变量绕过。

## Step 7.1 脚本 FAIL 时用户可见汇报（BLOCKER）

harness 非 0 退出或 `can_claim_done=false` 时，向用户**首段**必须是脚本结论，禁止先问"是否进 code-review"或并列展示"verifier PASS + 脚本 FAIL"暗示可推进。**必须同步执行**（禁止后台 harness+并行 verifier）：读 `summary.json`（verdict/next_action/compile_first_error/run_statuses）→ 读编译日志摘录第一条错误（`文件:行 — 消息`）→ 按模板汇报（脚本 verdict/编译状态/首条错误/归因/下一步五项不可缺）。

```markdown
## Coding 阶段：未完成（脚本 harness FAIL）
- **脚本 verdict**: FAIL | blocker_count: N | can_claim_done: NO
- **编译**: FAIL
- **首条错误**: `<path>:<line> — <message>`
- **归因**: `<failure_kind>`
- **下一步**: `<summary.next_action>` → 按 Step 6.5 处理
```

**禁止**：提议 code-review；用 verifier PASS 代替脚本 PASS；称"无法确认是否编译"而不读日志。`--clear-state` 仅当用户明示放弃当前 feature 的 coding 阶段时可用，禁止为进入 code-review 或消除 Stop hook 而用。

`summary.next_action` 分流：`rerun_with_HARNESS_DIFF_BASE_REF_working`/`diff_within_scope` 报 `stale_diff_base` → 自动重跑 `HARNESS_DIFF_BASE_REF=working` 版本，仍越界才进 scope 扩展或撤销流程；`resolve_project_dependencies_then_rerun`/`project_dependency_missing` → harness 应已自动安装，仍 FAIL 读日志按上节处理；`declare_dependencies_then_rerun`/`project_dependency_undeclared` → agent 自补声明重跑；`resolve_dependency_install_blocker_then_rerun`/`project_dependency_install_failed` → 按日志 registry/鉴权/网络原因处理。

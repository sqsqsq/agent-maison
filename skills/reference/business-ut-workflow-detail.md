# business-ut 阶段详细流程（条件加载：执行对应 Step 时读）

新增/调整用例和断言由 UT 负责；coding 只获本次实现直接引发、且保留原用例与断言的既有兼容修补许可。旧误派或保留检查未通过的测试字节，UT 可真实核验后原样保留并在既有有效 manifest 登记当前哈希，不强求重复改写。采纳必须晚于原误写；新的越权改写仍会使它失效。review 等待 UT 修复时按真实 coding 输入与依赖先完成本职责，再回 review 裁定，不降低 testing/完成要求。

> **输入协议边界（仅正式阶段与机器 request）**：只审查、解释或设计用例仍先阅读真实代码和依据，但不建立身份/facts、不创建正式产物、不进入阶段确认/闭环。以下落盘与量化要求只用于正式或机器请求；以下 旧出生协议为 spec 的 facts 建立与固定上游阅读口径仅适用于 1.0。收到 runtime/专项入口明确提供的 1.1 调用上下文时，按[输入契约与 Facts 1.1](../../docs/concepts/skill-contracts.md#facts-11)读取真实内容与来源：首个实际 Skill 在主产出前建立 facts，后续或成功前驱基线只补本次 phase_delta；不补跑 spec、不伪造建立身份。无 Feature 时只用入口指定的 request report-dir/context/facts.md。调用上下文由实际入口解析，不自行补造。

> SSOT 索引见 [`skills/feature/business-ut/SKILL.md`](../feature/business-ut/SKILL.md)。本文承载 Lite Mode 判定、Step 1.0 摘取协议、Step 1.5/1.6 可测性预检与 Test Double Plan、Step 2/3 DAG 与 UT 代码生成细节、Step 7.5/7.6 编译与装机运行闭环、Step 8.0 Core 节点闸门、约束#12 HARD STOP 完整流程；主 Skill 决定请求分流，本页各节按需要加载；正式门禁与闭环保留在末尾的正式阶段。

## 共享 UT 方法

按行为选择验证层级：可隔离业务逻辑调真实生产入口，UI 展示/焦点/手势/真实导航栈交设备验证；纯 helper 的通过不能冒充业务分支覆盖，替换整个被测仓储不能证明其内部持久化逻辑。相同边界不重复造两套测试。

1. 读被测入口、调用签名、实际依赖、已有测试及套件注册；确认预期来自哪里，现状刻画与正确性断言按主 Skill 的预期来源规则区分。覆盖的是用户指定代码，可能是本地新改代码。
2. 按真实依赖判断可测性，不因缺文档先产出 audit：

| 等级 | 判断与行动 |
|---|---|
| L0 | 纯函数、无外部 IO，直接测输入输出，不造替身 |
| L1 | 依赖可注入或可替换，复用现有接口/类，必要时用 Spy |
| L2 | 现有子类化或包装接缝可用，使用现有接缝隔离边界 |
| L3 | 全局单例、inline lambda 或无可用接缝使目标不可测；说明具体缺口，交实现责任方处理，不在 UT 中擅改架构或降低要求 |

3. **替身选型**：可注入且需要调用序列证据用 Spy；难注入外部边界按 profile 支持选 mockkit；轻量固定行为用 fake；纯依赖不打桩。签名来自实际源码，正式调用还须对齐 contracts。替身不能重写被测业务逻辑。
   **打桩三形式**：现有类子类化、原型方法替换或既有 DI 接口。原型替换必须在 afterEach 恢复；每例重建可变状态，不新造 Port，不实际调用外部网络/系统 IO 充当单元隔离。
4. 选择有意义的正常、边界、失败断言；复杂流程按适用性验证状态序列、依赖调用和失败恢复，纯函数直接验证输出。数量服从行为，不强制每个简单用例两次 expect 或一份 DAG。
5. 只设计则到此交付。写/跑测试先按 request prepare 或正式 target resolver 确认落点/载体，再写测试与套件注册，使用框架执行器真实运行；保留真实失败及未执行项。来源登记结果与 provider 聚合执行结果分别呈现，不伪造逐类通过数量。

正式调用也先执行同一方法，再按本次契约实际 required 的 audit/mock-plan/DAG 等产物包装；以下 Lite/Step 1–3 的格式和确认责任仅用于该正式流程。独立请求不进入这些包装。

## Lite Mode 判定（Step 1 之前）

满足**全部**条件时可启用 UT Lite（减确认点，**不**跳 DAG、**不**降级 harness 规则）：`acceptance.yaml` 中 `ut_layer∈{unit,both}` 的 AC/BD ≤7 条；`testability-audit.md` 结论全部为 L0/L1；**无** `use-cases.yaml`。Lite 时：可选产出 `ut/quick-plan.yaml`；harness 仍强制 testability-audit + mock-plan；允许单个 flat DAG 跳过 Mermaid 展示确认；确认点减为 2 个（`ut.plan_confirm` + `ok_to_testing`）。

## Step 1.0 Research Sub-Phase 摘取协议

**上下文摘取（BLOCKER）**：禁止通读大模块源文件。按 `` `profile-skill-asset:business-ut/context_extraction_protocol` `` 执行 rg 签名摘取；总上下文 **≤300 行**。`source_code_paths` 只列被测入口与 UT 目标，不列整模块目录。必读：spec/plan/contracts/acceptance/use-cases（若有）/被测命名入口源码（≥3，签名级摘取）。评分≥60 或 L4 MUST subagent。增量落盘：探索开始先落 `ready_to_produce: false`，每摘取完一批被测入口 flush 一次（仅追加路径元数据，不违反 ≤300 行），全部摘取完才置 true。

**HARD STOP 规划确认门**（`ut.plan_confirm`）：Step 1 结束须先展示"UT 规划清单"，`1=确认` `2=调整`。清单须含：本轮覆盖 AC/BD/branch 与不覆盖项原因；每个 `it()` 名称/被测入口/Spy 边界/核心断言；将新增或修改的 DAG/测试源文件/套件注册入口路径；明确声明"本轮不改业务源码"。未确认前不得写文件。

## Step 1.5 可测性预检（testability-audit.md）

正式交付按已有 ut_layer、device_focus、use-cases 和 plan 说明两层各证明什么；both 不是要求 UT 模拟 ArkUI 或重复全条设备流程。定义与可测性不一致先回原责任方裁定，不由 UT 修改 acceptance、减少 required 义务或新建业务抽象。

写入前自检：已读 `` `profile-skill-asset:business-ut/format_contract` ``；内容是 fenced yaml 块（非 Markdown 表格）；`acceptance_id` 严格来自 acceptance.yaml 已有 ID；写完跑 `npm run validate:ut-artifact -- --type testability-audit --file <path>`。

对每条 `ut_layer∈{unit,both}` 的 AC/BD 给出：`testability_level`（L0-L3）、关键 `dependencies`（含 `global_singleton`/`inline_lambda` 等）、`verdict`（testable/downgrade_device/needs_seam）。**若 L3**：当前 requirement 仍要求 unit/both 时，物化 `recommendation.option_b` 为 coding repair candidate，由 coding owner 修改后重走 review→ut；UT invocation 不改业务源码。`option_a` 只提交验收分层/定义问题给 spec 裁定，机器检查按当前审计生成 spec 候选；spec 未在链时由已有范围修订接入。候选不批准降级，device_focus 也不取消 unit 义务；改变用户要求或冻结 required 义务仍走有效需求修订。`selected` 仅记录既有需求/修正路由，不是质量授权。**L3 接缝白名单**：coding repair 仅允许构造注入、包装 wrapper、提取命名方法、setter 注入等显式接缝；禁止"换一种全局单例"式敷衍。L3 candidate 未闭环前禁止进 Step 1.6/2/3。

## Step 1.6 Test Double Plan（mock-plan.yaml）【HARD STOP】

写入前自检：已读 format_contract；纯 YAML 无 Markdown 标题/围栏；`ts_expr` 含 `as TypeName` 或 `new ClassName(`；写完跑 `validate:ut-artifact --type mock-plan`。

规格：`` `profile-skill-asset:business-ut/mock_plan_schema` ``（imports、`spies[]`/`doubles[]`、strategy、methods、presets）。选型复用「共享 UT 方法」，正式产物的 `target_class`/`methods[].name` 对齐 contracts；使用 mockkit 时 Hypium MockKit/when 与 preset 一致。用户确认（`ut.mock_plan`）展示边界与 preset；产物义务由本次有效契约决定，pure 依赖不强造替身。

## Step 2 生成 DAG 文件

默认写入 ephemeral 位置 `ut/reports/flow-dag/{flow_id}.dag.yaml`（不归档，除非用户要求或触及 Code Graph core 节点）；显式归档才写 `{module}/test/dag/`。存在 ut_layer∈{unit,both} 且 P0/P1 的 AC/BD 时须产出 `ut/reports/coverage-evidence.json`（`mappings[]` 覆盖每条 P0/P1 scope）。

**必填顶层字段**（`dag_schema_compliance` BLOCKER）：`flow_id/flow_name/module/version`、`entry_point/nodes`、（有 use-cases.yaml 时）`use_case`+`branches[]`、`linked_acceptance`。**节点构建**：`user_trigger`对应业务入口命名函数；`port_call_cloud/local` 对应 data_boundary（字段 `boundary`=`data_boundaries[].name`，推荐声明 `spy_preset` 引用 mock-plan presets）；`state_transition` 对应 state_model 迁移；`assertion` 须声明 `linked_branch` 或 `linked_acceptance`；`ui_subscription`（仅文档化 UI 订阅，UT 忽略，真机要点写 device_focus）。**UI 副作用不进 UT 断言**：Nav/Toast 只能作 `ui_subscription` 节点或写 `device_focus`。验证：无环、source 存在、boundary 名回指 data_boundaries。展示 Mermaid 确认（`ut.dag_confirm`）。

## Step 3 生成 UT 代码

写入前自检：`it()` 名以 `[AC-]`或`[BRANCH-]` 开头，BD 用 `[AC-x][BD-y]` 组合（禁止单独 `[BD-1]`）；audit/mock-plan 已过 `validate:ut-artifact`。mock-plan 优先：Spy 类与 preset 行为须与其一致。

**路径 A（有 use-cases.yaml）骨架**：直接调用 `ui_bindings.user_actions.calls` 声明的命名函数，不 new `@Component struct`：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { HandoffCoordinator, Phase } from '../../../main/ets/domain/flow/HandoffCoordinator'
import { SpyTaskRemoteApi } from './spy/SpyTaskRemoteApi'

export default function taskHandoffFlowTest() {
  describe('HandoffCoordinator', () => {
    let api: SpyTaskRemoteApi
    let coord: HandoffCoordinator
    beforeEach((): void => { api = new SpyTaskRemoteApi(); coord = new HandoffCoordinator(api) })
    it('[BRANCH-happy_path][AC-1] 提交流程成功', 0, async () => {
      api.whenEnqueue.returns({ ok: true, jobId: 'j1' })
      await coord.submitDraft({ title: 'demo' })
      expect(coord.state.phase).assertEqual(Phase.Pending)
      expect(api.callLog).assertDeepEquals(['enqueue'])
    })
  })
}
```

**路径 B（无 use-cases.yaml）骨架**：直接针对 data 层或导出函数：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { DashboardRepository } from '../../../main/ets/data/repository/DashboardRepository'

export default function dashboardRepoTest() {
  describe('demo-dashboard', () => {
    let repo: DashboardRepository
    beforeEach((): void => { repo = new DashboardRepository() })
    it('[AC-1] DashboardRepository 契约完整', 0, async () => {
      const widgets = await repo.fetchWidgets()
      expect(widgets.length).assertLarger(0)
    })
  })
}
```

打桩形式与隔离复用「共享 UT 方法」；正式路径只对 `data_boundaries[].type` 命中 `contracts.interfaces[].class` 的数据边界要求替身，未登记类型由 `boundary_matches_contracts` WARN 披露；需要调用序列时由 Spy 暴露 `callLog[]` 和相应 preset。

**每个 it() 必备断言**：路径 A——命名入口驱动 + 调用序列断言（`assertDeepEquals(spy.callLog,...)`）+ 状态多阶段断言（≥2 次 expect 覆盖中间态与终态）；路径 B——每个 it() ≥2 次 expect 覆盖数据契约与边界。

**用例命名**：`[BRANCH-<id>]`或`[AC-<id>]` 开头（可组合）；BD 必须组合标签（`[AC-1][BD-1]` 合法，`[BD-1]` 非法）。

**import 白名单**（`ut_import_whitelist` BLOCKER）：允许测试框架、被测命名业务入口、data 层与被允 Spy/Fake、同目录替身；禁止符号清单由 profile 的 `ut-ui-import-ban` + addendum 声明。

**生成流程**：为 contracts 已登记的数据边界生成 spy/ 替身（已存在则复用；未登记类型保留 WARN，不伪造替身）→ 为每个 use_case（路径 A）或每组 AC（路径 B）生成测试文件，每 branch/AC 一个 it() → 展示确认 → 写入。

## Step 7.5 UT 编译闭环

首选通过 harness 触发：`harness-runner.ts --phase ut --feature <feature-name>`。**自闭环修复策略**：`ut.compile` FAIL → 完整读日志 → 按错误类型分类（UT 调用签名不符/import 路径错/类型不匹配→修 UT；依赖缺失→先按 Tier_1 装 harness 自身依赖，禁止改 `framework/package.json`；MockKit 无导出→mock-plan 补 `strategy: mockkit`；**若错因在业务源码→进入约束#12 HARD STOP，禁止自行动手**）→ 修完再跑直到 exit 0。

## Step 7.6 UT 装机运行闭环

探测设备：输出为空**不允许**继续跑或用"本地无设备"为由标绿；须先准备设备重新探测。装机执行：`harness-runner.ts --phase ut --feature <feature-name>` 同时触发 compile+run。**自闭环策略**：failed>0→读完整 `hdc-test.<module>.log` 找堆栈定位是 UT 逻辑错/Spy 预设错/还是业务真 bug（真 bug 仍走约束#12 HARD STOP）；total=0→测试入口未启动，核对 profile 测试配置；失败阶段 metadata/artifact_not_found/install→回 7.5 或查 toolchain 配置。

**执行链无结果时停止盲跑**：先读本次 faultlog/hilog 诊断；同键、同因失败再次出现且输入/环境或诊断依据未变时，按 harness 指引停止并上报，不在本次调用内反复真跑。调用结束后交 runner 沿既有执行链诊断出口处理；没有执行结果不等于业务代码回归。原因未知时不自行断言资源路径或 TestRunner 配置有误。系统引导阻断按设备门提示交用户完成初始化，不代点引导；正式收口可采纳同次调用的冻结失败，不能要求为刷新回执再真跑。恢复或输入变化后重新执行。

**`hap_not_found` / 签名缺口硬约束**：失败阶段为 `hap_not_found` 时，必须先全文引用 `hdc-test.<module>.log`（或 `ut_hvigor_test` details 头部）中的 harness 分层签名诊断与修复建议，再下结论。诊断已有明确原因层（例如“hvigor 明确报告 signingConfigs 未配置”）时，禁止另创 `.p12` 调试证书、默认密码、DevEco 会话兜底等环境故事。签名配置属于宿主资产：交互模式立即 HARD STOP，把诊断原文与“补 `signingConfigs` / 自定义签名任务覆盖 `ohosTest`”二选一动作交给用户，不代改宿主工程、不循环重跑；goal 模式的熔断由 runner 接管，agent 本轮只做诊断呈报，runner 仅允许一次有界确认性重跑，同 signature 重复即 halt。

sign-skip 分支只在 `failedAt=hap_not_found` 且 `unsignedPresent` / `signSkipped` / `signingConfigMissing` 任一结构化证据存在时成立。三项证据全无时仍 HARD STOP，但只能表述为“核对构建产物路径与 genOnDeviceTestHap 日志”，不得复用签名缺口话术。

**设备失败分类决策树**（读 `ut-install-diag.json` + `ut_hvigor_test` 报告）：

| blockingKind | 条件 | agent 动作 |
|--------------|------|------------|
| selfHealable | 版本降级且未设 env | 设置 env 后重跑 |
| needsConfirmation | 降级+需确认卸载/升 versionCode | HARD STOP 列诊断等用户选择 |
| externalBlocked | 无设备/hdc 缺失 | 不循环改 UT，告知用户准备设备，`verdict=INCOMPLETE` |
| hap_not_found / sign-skip | unsigned 在、signed 不在，或存在 `signSkipped` / `signingConfigMissing` | 全文引用分层诊断；交互模式 HARD STOP 求宿主动作，goal 模式交 runner 熔断；不循环改 UT/重跑 |
| clear | 预检通过 | 继续装机执行 |

**绝不允许**：把"无设备"标 SKIP/PASS；用环境变量跳过 `ut.run` BLOCKER；未跑就交；因找不到工具链就写 SKIP。

## Step 8.0 Core 节点闭环闸门

harness 全绿后评估改动是否触及模块 Code Graph 的 `core: true` 节点：读相关模块 CodeGraph，对比 contracts.yaml/diff 触及文件与 core anchor。**触及 core**→启动可行性探测，同步 characterization 或 spec-driven UT；图谱更新由原 writer 按授权完成，默认相关 run 收口后、P3 前，run 内确需写图须先明确纳入 `contracts.files`。不能为刷绿擅自更新 core hash，原 drift 与 UT 义务不豁免；缺设计授权回既有 owner。flow DAG 只在获准路径归档至 `test/dag/`。**未触及**→flow DAG 保持 ephemeral，用完即弃。

## 约束#12：HARD STOP 禁止修改业务源码（不可绕过）

UT 只拥有 profile 测试/夹具源目录，不拥有受保护业务源码。发现只能通过源码可测性改造解决的缺口时：

1. 不在 UT invocation 内修改 `src/main` 或等价业务实现根；用户回复、署名或 legacy `approved_src_mutations[]` 不构成例外。
2. 记录具体文件、所需签名、UT 层无法规避的技术理由和影响面，形成 coding repair candidate。
3. runner 回退 coding owner 完成改造，回到 UT 后重新生成 testability audit；review 侧按分级补对应复核（**不必重走整套 review 闭环**）。
4. `ut_no_src_mutation` 对 review 闭环后的产品源码漂移，在 attestation 基线下**按风险分级记 MAJOR WARN**（纪律不变，不读取人工授权名单）。review 正式闭环后基线=review closure attestation 的逐文件内容哈希——coding 阶段的合法产物即使从未提交也不在裁决域，把改动 `git commit` 掉同样洗不白；处置按 `check-ut.ts` 该 WARN 的 suggestion 给出的分级复核清单执行（典型两条：回 coding 纳入实现并补对应复核，或从编辑器本地历史/备份取回 review 时的文件内容后用 attestation 的 sha256 核对——attestation 只存 `{path, sha256}` 不存内容，能验证不能还原；coding 产物也可能从未提交，git 里未必有旧版本）。删除 review 闭环产物不是出路——闭环证据残缺会 fail-closed。**不得要求用户提交 coding 产物来过门禁。**
5. 对“报错顺手抽函数/改 public/新增工具函数/改 barrel”等便利性修改同样适用。

在不改业务源码的前提下，优先使用 UT/Spy、类型安全的替身或原型恢复；若方案本身需要新架构或需求变化，分别回 plan/spec owner，而不是在 UT 内越权补洞。

## 正式 Feature/CU 阶段

以下仅在本次明确承担 Feature/CU 交付责任时加载；普通方法调用与独立 request 不进入这段。

本阶段写边界内、归 UT 负责且属于当前目标的新增或修改源码，建议在 `## phase_delta: ut` 的「路径 | 事实 | 影响」表逐路径登记实际新事实；散文或缺少精确行只披露追溯缺口，不阻断本阶段。表内建议使用工程相对路径；绝对路径、反斜杠、`./` 及追加的同名小节会归一合并识别。入场前已存在但未调研的目标仍须实际阅读；中断恢复须承接未撤销 start 的已核 facts context，不能凭当前 owner 重造入场核验。需求、contracts、配置及未授权源码漂移仍须严格处理，保留原基线 SHA。

> **用户确认 UX**：[user-confirmation-ux.md](user-confirmation-ux.md) · `ut.plan_confirm` / `ut.mock_plan` / `ut.dag_confirm` / `ut.ok_to_testing` / `phase.next_step`。这些交互用于普通输入/导航，不得降低质量门禁。

## 前置

正式调用的预期来源、可测性与替身选型先执行主 Skill 引用的共享方法；再按本节绑定契约与 required 产物完成阶段。

**验证层与环境分开**：unit 性能项的指标与证明方法来自有效 acceptance，计入实际单元证据；ohosTest HAP 的 build/install/device 是 UT toolchain 的一部分，不自动安排 testing。现代调用明确依赖均为 pure 时不强造 mock-plan；真实外部依赖、分支和 testability 缺口继续按原专业检查处理。完成与复用由冻结 scope 和现有证据决定，不因末段为 UT 自报 Feature 完成。

本工程须先完成 [`framework-init`](../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](host-harness-readiness.md) 与 [Shell cwd 契约](harness-cli-cwd.md)（harness 之后用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。**Personal setup（BLOCKER）**：[personal-setup-gate](personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

**设备策略（BLOCKER，`ut.run` 需真机时）**：[device-policy-gate](device-policy-gate.md)：`npx ts-node scripts/device-policy.ts --check --json`（**判定两段**：退出码 0 且 stdout 合法 JSON → 看 `code`；非零或非法 JSON = 执行失败须停止，含**凭据库不可读**，此时不得当成"未配置"去引导重新登记）；`code=device_policy_unset` 就**先问用户四选一**再跑装机/`aa test`（选 ③ 须追问 `existing`/`managed`，禁默认托管）。**只看 `code` 不看 `configured`**——凭据已 burned/不存在或只有 `emulator_fallback=disabled` 时，`configured=true` 而 `code=unset`。与 goal 模式同一契约——普通模式下用户同样有权知道"可以启用自动解锁"，而不是撞上一句干巴巴的"设备锁屏"。PIN 只能由用户在自己终端登记，**绝不进对话**。harness-runner 在需设备 phase 另有**进程级**入口门（同一 `code`，在任何设备操作前 fail-fast，并把设备目标解析一次注入全链），漏问不会静默跑到锁屏——但那只是兜底，四选一仍是你的活。

**仅 Feature/CU 的归档定位协议**（专项按 request 入口）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`；只有精确目录是正式 feature，同名归档/前缀条目只是旁证不得读取。 `<feature>` 语义见 [路径术语表](agents-entry-detail.md)（物理 Feature 路径）；定位一律经框架解析（CLI/SSOT/harness 产物路径），不得手工拼接逻辑 identity（含编码 `cu-…`）。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。展示输入矩阵（spec/plan/contracts/acceptance/use-cases 是否存在）；输入缺失回上游补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/business-ut/profile-addendum.md` 时先读（测试源树/命令形态/禁入符号清单等宿主细则）。
- **Lite Mode 判定 / Step 1.0 摘取协议 / Step 1.5 可测性预检 / Step 1.6 Test Double Plan / Step 2 DAG 字段 / Step 3 代码示例与打桩形式 / Step 7.5 编译闭环 / Step 7.6 装机运行闭环与设备失败决策树 / Step 8.0 Core 节点闸门 / 约束#12 HARD STOP 完整流程**：完整读 [business-ut-workflow-detail.md](business-ut-workflow-detail.md)。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](agent-behavioral-principles.md)。**Research Sub-Phase 完成前禁止输出 UT 规划清单。**
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

## 概述

资深宿主侧业务级 UT 工程师：作为**既有代码的消费者**，读懂业务编排源码（coding 自选形态）与 data 层源码，产出可通过 harness 出口检查的 UT + DAG。UT 运行框架/编译/执行链路以当前 `project_profile` addendum 与 `ut.compile`/`ut.run` capabilities 为准。流水线**第五环**，上游 plan（`use-cases.yaml`，条件式）/coding/code-review，输出流入 device-testing（消费 `acceptance.yaml > device_focus`）。

**Goal/headless 写边界（BLOCKER）**：只写 profile resolver 给出的 UT 根与本阶段 contract `produces`；不得改需求契约、产品实现源码、review 或 testing 产物。发现可测性缺口须报告并由 runner 回责任阶段。runner 按 invoke 前后哈希归因：改写**已登记的上游 artifact**（需求 / 验收 / 契约等）时本轮证据作废并自动回 owner 全量重验；其余变化记录为观测事实，由本就负责它的 check 裁决（范围、漂移、闭环门）。无法唯一定位 owner 不再终止 run，也不因此豁免上述 check。 本阶段若改了生产代码，`ut_no_src_mutation` 会按 coding change 归类并给出所需的一次复核。

## 触发条件

"生成 UT"、"生成单元测试"、"写 UT"、"业务级 UT"、"端到端测试"、"UseCase 测试"、"分支覆盖 UT"、"生成 SpyPort/生成打桩类"、"存量 UT"、"回归网"、"characterization 测试"、"基于日志生成 UT"、"给现有流程补测试"、"修存量 UT"、"存量测试挂了"、"修复失败用例"（后三者路由 repair_existing_ut）。

### 三种工作模式（v3 · plan 423e5d0f）：同一引擎，只有 target 来源不同

| 工作模式 | target 来源 | 出口 |
|---|---|---|
| **cover_feature_change**（默认） | 当前 feature 声明的测试（下方 path-a/b 路由） | 现行全套 AC/DAG/coverage 门禁 |
| **repair_existing_ut** | 用户明确指定的已有失败用例 | 目标红转绿 + suite 无新增失败；不强制 AC/DAG/mock-plan，细则 [`paths/path-repair-existing.md`](../feature/business-ut/paths/path-repair-existing.md) |
| **cover_existing_code** | 用户指定的存量/本地代码与新增测试 | `[REG-*]`（代码驱动回归网）或 `[CHAR-*]`（日志驱动，path-c）追溯；不虚构 feature AC |

责任域纪律（harness 已机器化）：Git diff / context 提及只是发现候选的线索，**不决定责任**；
存量 UT 文件与其基线已有用例不受需求房规问责；存量文件内**新增**的 it/mock 用法按用例级
升格问责；suite 历史失败走棘轮（授权基线内豁免但报告 `suite_health=DEGRADED`，新增失败=回归；
无基线不豁免——基线由用户确认放置或编排在 agent 动手前采样，本轮执行不得反推）。

**模式与目标的机器化通道**：跑 harness 时设环境变量 `MAISON_UT_MODE`（`repair_existing_ut` /
`cover_existing_code`，缺省 cover_feature_change）声明工作模式；`MAISON_UT_TARGETS`（分号/逗号
分隔的相对路径）点名目标文件（可指向未被触碰的存量文件）。`[REG-*]` 标签仅前两种模式合法。
cover_existing_code / repair 模式下须同时给显式基线锚 `HARNESS_DIFF_BASE_REF`（本地已有的
非需求源码改动以显式锚区分，direct 场景框架不自动推断入口状态）。该锚只作用于 **git diff
生效域**；`ut_no_src_mutation` 在 review 已正式闭环时用 review closure attestation 的内容哈希
基线，设它不影响该门禁结论。

### cover_feature_change 内部路由（同触发词「生成 UT」）

| 条件 | 路径 | 细则 |
|------|------|------|
| 有 `use-cases.yaml` | path-a | 本文 Step 1~3（UseCase 驱动） |
| 无 use-cases，有 `acceptance.yaml` | path-b | 按 AC/BD + DAG |
| 均无且提供脱敏日志切片 | path-c | [`paths/path-c-characterization.md`](../feature/business-ut/paths/path-c-characterization.md) |
| 均无且用户指定代码范围 | cover_existing_code | 新测试用 `[REG-*]`，不要求先补 spec |
| 否则 | — | 提示先运行 spec 阶段 |

**模块级 seam/mock**：feature 级 audit/mock-plan 优先引用 `doc/modules/<module>/ut-registry/`（见 `` `profile-skill-asset:business-ut/module_seam_registry_schema` ``）。

## 核心理念（v2.1）：UT 是既有代码的消费者，不驱动架构

- 🟢 复杂 feature（有 `use-cases.yaml`）：按 `ui_bindings[].user_actions[].calls` 声明的**命名函数**直接调用；在 `data_boundaries` 处打桩；断言 state 序列 + 调用序列 + 持久化数据。
- 🟢 简单 feature（无 `use-cases.yaml`）：按 `acceptance.yaml` + `dag.yaml`，直接针对 data 层函数/Repository/导出工具函数写 UT，不要硬凑 UseCase 架构。
- 🔴 UI 层绝对禁入 UT：不 import profile addendum 声明的 UI/资源/页面运行时符号，harness BLOCKER 拦截。
- 🔴 不要为了 UT 反过来改架构：业务嵌在 inline lambda 时反馈 coding 抽出命名方法，不要在 UT 里实例化 UI 组件。

**关键澄清**：被测单元 = 命名业务入口（非强制 UseCase 类）；外部依赖抽象用 `data_boundaries[]`（引用 contracts.yaml 既有 data 层类，非新造 Port）；无 UseCase 代码产物，`use-cases.yaml` 只是文档规约；Stub 用子类化/原型替换（非实现 Port 接口）；一个 `it()` 端到端驱动一个 branch（或一条 AC/BD），断言含 state 序列+调用序列+数据；UI 交互交 device-testing。

**追溯标签（BLOCKER）**：每个 `it()` 名称必须以 acceptance.yaml 中真实存在的 `[AC-<id>]`、`[BD-<id>]` 或 use-cases.yaml 中真实存在的 `[BRANCH-<id>]` 起始；BD 可直接写成 `it('[BD-1] 空列表回落', ...)`，无需虚构或附带无关 AC。组合覆盖可写 `[AC-1][BD-1]`，复杂流推荐 `[BRANCH-happy_path][AC-1]`。**例外**：path-c characterization 用例以 `[CHAR-<flowName>]` 起始、cover_existing_code 回归网用例以 `[REG-<主题>]` 起始（这两类不绑定本 feature AC，**禁止**为过门禁虚构 `[AC-*]`）；存量文件中基线已有的 it 不受本规则问责（只查本需求新增用例）。

## Feature 输入（专项按前置处理）

| 输入项 | 必需 | 说明 |
|--------|------|------|
| `use-cases.yaml` | ⚠️仅复杂 feature | plan 产出，含 coordinator/ui_bindings/data_boundaries/state_model/branches，主规划来源 |
| 业务编排源代码 | ✅ | coding 产出，代码形态自选 |
| data 层源代码 | ✅ | UT 在 profile 允许边界打桩 |
| contracts.yaml | 可选 | 存在时校验 `data_boundaries[].type` 与 `interfaces[].class`；缺失则降为 basic 并披露契约断言未覆盖 |
| acceptance.yaml | ✅ | 含 `ut_layer`；简单 feature 时是主规划来源 |
| `ut/testability-audit.md` | ✅ | Step 1.5 产出 |
| `ut/mock-plan.yaml` | ⚠️存在 L0/L1/L2 可测项时必填 | Step 1.6 产出 |
| plan.md / spec.md | 可选 | plan 缺失时从 acceptance、业务源码 diff scope 与 module catalog 推导测试对象 |
| doc/architecture.md | ✅ | 架构与依赖红线 |

**缺 use-cases.yaml**：不阻塞，按 acceptance.yaml + dag.yaml 直接写 UT；WARN 非 BLOCKER；严禁为此回头要求补 use-cases.yaml 套架构。**缺 acceptance.yaml**：提示先运行 spec 阶段（**例外**：提供脱敏日志切片时走 path-c characterization，不要求先补 spec，见三路径路由）。

**CU-bound 例外**：存在 `contracts.change_unit` 时，是否需要 use-cases.yaml/DAG 由 `contracts.state_management` 的有序步骤、失败/恢复、共享消费者、生命周期事实与 `acceptance.ut_layer` 机械派生；派生为 required 时缺失即 BLOCKER，不得 authored opt-out。简单只读/首次加载且无上述复杂事实时仍走退化模式，不制造假 mutation/subscription。

**保证等级**：Harness 在 checker 前一次性解析 contract capabilities 与输入 source chain，机械写入 `summary.assurance` 和 `capability_resolutions`；Skill 不得手写 `full/basic` 档位。可裁剪能力会以受控理由投影到质量轴，核心输入缺失仍不可闭环；acceptance 追溯、真实 toolchain 编译/测试、反假 PASS 与源码变更红线一律不降级。

## 规约参考

| 规约 | 路径 |
|------|------|
| UseCase Schema / DAG Schema(v2) | `` `profile-skill-asset:business-ut/use_cases_schema` `` / `` `profile-skill-asset:business-ut/dag_schema` `` |
| UT+Spy 模板 / 打桩策略 | `` `profile-skill-asset:business-ut/ut_template` `` / `` `profile-skill-asset:business-ut/mock_strategy` `` |
| 可测性预检模板 / mock-plan Schema | `` `profile-skill-asset:business-ut/testability_audit_template` `` / `` `profile-skill-asset:business-ut/mock_plan_schema` `` |
| 规范级样例 | `` `profile-skill-asset:business-ut/sample_flow_dir` `` |

## UT 可测性/mock-plan 策略决议（v2.3 · SSOT）

1. **存量 feature 迁移**：仅当再次进入 business-ut 并变更 UT 相关产物才回补 audit/mock-plan；新 feature 一律强制。
2. **L3+option_b 接缝白名单**：仅允许构造注入/包装 wrapper/提取命名方法/setter 注入；禁止"换一种全局单例"式敷衍。
3. **可测性预检独立切入**：只想完成 Step 1.5/1.6 后暂停须在入口明确告知 agent；完整闭环仍由 `/business-ut` 收尾。

## 正式流程骨架

先执行本页共享方法，再履行下列正式输入、产物和闭环责任；不复制另一份方法。

1. **Step 1 规划 DAG 与 UT**：先判 Lite Mode（≤7 条 unit/both AC/BD 且全 L0/L1 且无 use-cases.yaml，详见 reference）→ Step 1.0 Research Sub-Phase（Context Facts Gate·C4，rg 签名摘取 ≤300 行，追加 facts.md 的 `## phase_delta: ut` 节，详见 reference）→ 按路径 A（branches×ui_bindings）或路径 B（AC/BD 逐条）列「UT 规划清单」→ **HARD STOP `ut.plan_confirm`**：`1=确认` `2=调整`，未确认禁止写文件。
2. **Step 1.5 可测性预检**（`ut/testability-audit.md`，详见 reference）：对每条 unit/both AC/BD 给 L0-L3 结论；L3 在当前 unit/both 要求不变时产出 coding repair candidate，交由 coding owner 做最小可测性接缝并重走 review→ut。若用户明确改变为 device-only，那是普通 requirement correction，交回 spec owner；两者都不授权 UT 修改源码或降低质量门禁。
3. **Step 1.6 Test Double Plan**（`ut/mock-plan.yaml`，详见 reference）：`target_class`/`methods` 须对齐 contracts.yaml；策略 spy/mockkit/fake 选型；**HARD STOP `ut.mock_plan`**：`1=确认` `2=调整`。
4. **Step 2 生成 DAG**：默认 ephemeral 写入 `ut/reports/flow-dag/`（触及 Code Graph core 节点或用户要求才归档 `{module}/test/dag/`）；必填字段与节点类型详见 reference；展示 Mermaid **HARD STOP `ut.dag_confirm`**：`1=确认` `2=修改`。
5. **Step 3.0 写入路径 Gate**：`<repo-root>` 非 `framework/harness`；上一条 shell 为 `cd framework/harness` 时 Write 前须先 `cd <repo-root>` 或用绝对路径；禁止 Write 到 `framework/harness/` 下宿主源码。
6. **Step 3 生成 UT 代码**：路径 A/B 骨架、打桩三形式、断言要求、命名规则、import 白名单，完整示例详见 reference。
7. **Step 4 测试注册**：套件注册入口登记新增用例；测试框架依赖已声明；无测试目录时按 profile 标准目录创建。
8. **Step 5 质量门禁自检**（14 项，见门禁清单表 + reference 详述）。
9. **Step 6 机器回执**：harness PASS 后写 `ut/reports/ac-coverage.json`（unit 层覆盖摘要，非 SSOT）；device/both 缺 `device_focus` 回 spec 补全，不新建平行 todo。
10. **Step 7 输出交付摘要**：UseCase/DAG/UT 文件清单 + 覆盖率统计，供 Step 8 Harness 验证消费。
11. **Step 7.5/7.6 编译与装机运行闭环**（必要出口，详见 reference）：`ut.compile`/`ut.run` 是必要出口非可选；自闭环修复策略按错误类型分类；**触及业务源码进约束#12 HARD STOP**；设备失败按 selfHealable/needsConfirmation/externalBlocked/clear 四类分流；绝不允许把"无设备"标 SKIP/PASS。
12. **Step 8 Harness 验证门禁**：见下方门禁清单表；`stale_diff_base` 自动 `HARNESS_DIFF_BASE_REF=working` 重跑（**仅 review 未闭环的 git fallback 域**会出现该 failure_kind）；`summary.verdict=INCOMPLETE`（device 阻塞）不满足闭环；状态面板须完整贴给用户。
13. **Step 8.0 Core 节点闭环闸门**：改动触及 Code Graph `core: true` 节点时启动可行性探测+更新图谱+同步 characterization/spec-driven UT（详见 reference）。
14. **Step 8.2 AI Harness**：主动通过 Task 工具触发 `subagent_type: verifier`，prompt 模板 `framework/harness/prompts/verify-ut.md`（state_model_completeness / ui_bindings_completeness / end_to_end_driving(BLOCKER) / branch_coverage_semantic / device_ac_delegation / stub_reasonableness / test_isolation）。 verifier 的 WARN/UNKNOWN 本轮不修（记入 `<phase>/notes.md` 带到下一阶段），只有 **BLOCKER 级 FAIL** 才触发修正与重审；材料未变时 harness 复用既有 verifier 报告，材料变了但历史有 PASS 时闭环标 `completed_with_prior_review`（不重跑 verifier，未重审差异登记在 `summary.verifier_closure`）。

**Task prompt = harness 写出的短 request JSON 整段**（plan a9d4e7c2）：verifier 能力启用时，`harness-runner` 会在结尾打印 `verifier.request.<subject>.json` 的路径，并把它记进 `summary.verifier_request`。把**那份 JSON 的完整正文**作为 Task prompt 投给 verifier——verifier 自己按其中的 `prompt_path` 读磁盘原件（`ai-prompt.md` 可达上百 KB，不过传输面）。不要投递 `ai-prompt.md` 全文、不要手抄或改写任何字段、不要在 JSON 前后附加说明：subject 由字段重算，抄错一处即失配 → 阶段不闭环。

**报告由你写入，不是 verifier 写**（plan d2f7a9c4）：verifier 返回后，用 Write 把它的回复**原样全文**写进 `summary.verifier_report` 指向的路径（`<reports>/verifier.report.<subject>.md`），再跑 `check-receipt`。不摘要、不只贴终态块——正文里的发现是 repair candidates 与多模态审查的输入；只有终态块的报告能通过校验，却会把这些全部丢掉。

**harness 没有输出 request 时先看 `summary.next_action`，别急着下结论**：①能力未启用（policy/workflow/profile 判定）→ 本阶段就没有 verifier 这一环，不要去找、不要补造，闭环也不要求它；②当前 adapter 未登记 `verifier_subagent`（起不了 verifier 子代理）→ 本阶段无此环，闭环照常进行，`check-receipt` 会以 WARN 如实标注 `not_reviewed`；③脚本尚未 PASS → 本轮**通常**刻意不产出 verifier 调用面，先修 BLOCKER 再说；**例外**是 `next_action=run_verifier_for_repair`——review 负面裁决与 UT 真实断言失败（`code_regression`）这两类已复现的可诊断产品失败，harness 会在脚本 FAIL 下照样签发 request，因为它们的回修候选本就依赖 verifier 逐条确认。照常投 request、原样写报告；**产品 FAIL 与 open 闭环状态不因此改变**，别在拿到逐条结论前改产品。

## 门禁清单表（v2.1 检查覆盖项）

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| usecase_spec_recommended | 复杂度达阈值时建议产出 use-cases.yaml | WARN |
| usecase_spec_schema | use-cases.yaml schema 合规 | BLOCKER |
| usecase_ui_bindings_nonempty | 每个 use_case 的 ui_bindings & user_actions 非空 | BLOCKER |
| boundary_matches_contracts | data_boundaries[].type 在 contracts.yaml 中 | MAJOR |
| named_business_handler | calls 所列符号是命名符号非匿名 lambda | BLOCKER |
| dag_linked_usecase | DAG.use_case 回指 use-cases.yaml | BLOCKER |
| dag_boundary_matches_spec | port_call_* 节点 boundary 匹配 | MAJOR |
| dag_node_type_valid | 节点类型合法 | BLOCKER |
| ut_import_whitelist | UT 未 import 禁止清单符号 | BLOCKER |
| ut_tsc_compiles | UT 文件 tsc --noEmit 零 Error | BLOCKER |
| boundaries_all_stubbed | type 命中 contracts.interfaces[].class 的数据边界有替身；未登记类型交 boundary_matches_contracts WARN 披露 | BLOCKER |
| it_name_has_ac_or_branch_tag | 用例名以 [AC-X]/[BD-X]/[BRANCH-X] 标签起始 | BLOCKER |
| it_drives_flow | 路径 A 严格判；路径 B 退化为 ≥2 expect | MAJOR |
| branch_coverage_full | 每个 branch 都有对应 it() | BLOCKER |
| ut_case_per_unit_ac | 每条 unit/both P0/P1 AC/BD 有精确 tag/branch 或其他可解析底层证据 | BLOCKER |
| acceptance_coverage | 只查 DAG `linked_acceptance`；分母只计 unit/both P0/P1 AC，不读 `it()` | BLOCKER |
| boundary_coverage | 每条 unit/both 的 BD 都有覆盖 | MAJOR |

不通过项定位后自动修复重检，直到全部通过。

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature {feature} --summary --failures-only
```

优先读 `summary.json`，禁止用 `grep` 解析完整控制台日志。

verifier 格式缺口须保留原回复和精确诊断；Goal 内返回 runtime，沿本 attempt 既有 request/subject 最多自动纠错一次，不另叠阶段内重投循环。合法 refuted/unclear 不因结论不利而重投；每次调用与时间照计，恢复不重发机会。真实设计/use-case 缺口回既有 plan 责任链，不能改冻结契约去掉 planned 前缀规避真实核验。

## 阶段闭环判定（仅 Feature/CU）（全局入口 §5.1）

**closed = 脚本 harness verdict=PASS ∧ 全部 policy=required 的证据已提供**。要求哪几项由 harness 求解后输出（`HARNESS_EVIDENCE_POLICY` 行与 `check-receipt` 的逐项状态），不是写死的固定四件套——verifier 是否 required 由 harness 的 verifier plan 决定，判 disabled 时这一项不存在也不缺失。本阶段的常规形态：

1. `<features_dir>/<feature>/ut/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS（**仅当 harness 为本阶段输出了 verifier request**；只跑一次——材料未变复用既有报告，材料变了但历史有 PASS 沿用并标 `completed_with_prior_review`）；4. `check-receipt.ts` 通过（回执由 harness 只读投影生成，agent 不手填；备注写 `<phase>/notes.md`）。required 证据齐备后业务级 UT 阶段完成，**具备**进 device-testing 的资格；**不授权**自动开 device-testing。

**收尾 / 闭环停等（BLOCKER）**：只呈现 harness 的 `NEXT_STEP` 段落；recommendation 由 `assess@1` 生成，执行授权仍由 driver 按 `phase.next_step` / `transition_policy` 裁决。

## 约束与注意事项

1. UT 是消费者不驱动架构：绝对禁止为了 UT 反向要求 plan 新增特定目录类/接口；抽出命名方法而非在 UT 里实例化 UI 组件。
2. use-cases.yaml 非必需，仅复杂 feature 才有。
3. 分支 1:1 映射（路径 A）：branches ↔ DAG branches ↔ UT it() 严格 1:1（允许 1 个 DAG 覆盖多分支，总并集需覆盖全部）。
4. AC 分层：只测 ut_layer∈{unit,both}；device 的 AC 须在 `device_focus` 声明，绝不在 UT 硬凑。
5. Mock 不真调：严禁真实网络/系统 API/IO。
6. 用例隔离：beforeEach 重建替身；原型替换须 afterEach 还原。
7. 替身类型须与 contracts.yaml 既有类签名一致。
8. ut_import_whitelist 强约束。
9. P0 优先，再扩展 P1/P2。
10. DAG/UT description 用中文。
11. Harness 验证闭环：agent 必须自跑 Step 8 + 主动触发 verifier；`ut_no_src_mutation` 在 review 已正式闭环时基线=review closure attestation（逐文件内容哈希，**与 git 提交状态无关**）——报告大量非 UT 文件漂移时先核对 review 闭环是否最新（漂移属合法改动就回 coding 纳入并重走 review 闭环刷新基线；误改则从编辑器本地历史/备份取回 review 时的内容，再用 attestation 里该文件的 sha256 **核对**——attestation 只存 `{path, sha256}` 不存内容，能验证不能还原，取不回就回 coding 重建），**禁止要求用户提交 coding 产物来过门禁**，也禁止要求用户"批量授权历史变更"。`stale_diff_base` / `HARNESS_DIFF_BASE_REF=working` 这剂药只对 **盘上观察不到 review 闭环痕迹的 git fallback 域**有效，attestation 基线下不存在"历史变更多"这种形态；**更不得靠删除 review 闭环产物来"换个基线重跑"**——闭环证据残缺（attestation 还在、summary 没了/未闭环）一律 fail-closed；即便把闭环产物删光能落回 fallback 域，那也是把裁决降级、不是出路。
12. **【HARD STOP 不可绕过】禁止修改业务源码**：UT 发现可测性缺口时只产出 coding repair candidate，由 runner 回 coding 修改并重走 review→ut；用户回复、署名、receipt 或 legacy `approved_src_mutations[]` 均不能把 UT 期间源码变更改判为 PASS。详见 [business-ut-workflow-detail.md](business-ut-workflow-detail.md)。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/business-ut-workflow-detail.md](business-ut-workflow-detail.md) |
| 阶段级规约 | `framework/specs/phase-rules/ut-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-ut.ts` |
| AI Harness Prompt | `framework/harness/prompts/verify-ut.md` |
| Trace | `<features_dir>/<feature>/ut/reports/<timestamp>/<model>-ut/trace.json`（phase=ut）+ 同目录 `gap-notes.md` |

## Slash/trace 约定

通过 `/business-ut` 或等价快捷入口触发时，须在阶段结束时产出 trace 凭证：`<features_dir>/<feature>/ut/reports/<timestamp>/<model>-ut/trace.json`（Schema：[trace.schema.json](../../harness/trace/trace.schema.json)，`phase: ut`）；同目录 `gap-notes.md`（模板 [gap-notes.template.md](../../harness/trace/gap-notes.template.md)）。

## 运行时交付约定（内网/弱模型）

```
<features_dir>/<feature>/ut/reports/<timestamp>/<model>-ut/
├── trace.json             # phase = "ut"
├── gap-notes.md
├── check-ut.report.md
└── verifier.report.<subject>.md  # 调用方写入 verifier 回复（summary.verifier_report 指路；可选）
```

## 收尾

阶段结束时只呈现 Harness 输出的「下一步」段落，不自行推导或补写跨阶段建议。

contracts.files 中属于 UT 的文件由 UT 交付，coding 不提前创建空测试；定义缺口回 spec/plan，不能靠改验收消掉覆盖义务。

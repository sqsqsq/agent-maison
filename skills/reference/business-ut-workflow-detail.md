# business-ut 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/business-ut/SKILL.md`](../feature/business-ut/SKILL.md)。本文承载 Lite Mode 判定、Step 1.0 摘取协议、Step 1.5/1.6 可测性预检与 Test Double Plan、Step 2/3 DAG 与 UT 代码生成细节、Step 7.5/7.6 编译与装机运行闭环、Step 8.0 Core 节点闸门、约束#12 HARD STOP 完整流程；触发/门禁清单/闭环判定仍以主文档为准。

## Lite Mode 判定（Step 1 之前）

满足**全部**条件时可启用 UT Lite（减确认点，**不**跳 DAG、**不**降级 harness 规则）：`acceptance.yaml` 中 `ut_layer∈{unit,both}` 的 AC/BD ≤7 条；`testability-audit.md` 结论全部为 L0/L1；**无** `use-cases.yaml`。Lite 时：可选产出 `ut/quick-plan.yaml`；harness 仍强制 testability-audit + mock-plan；允许单个 flat DAG 跳过 Mermaid 展示确认；确认点减为 2 个（`ut.plan_confirm` + `ok_to_testing`）。

## Step 1.0 Research Sub-Phase 摘取协议

**上下文摘取（BLOCKER）**：禁止通读大模块源文件。按 `` `profile-skill-asset:business-ut/context_extraction_protocol` `` 执行 rg 签名摘取；总上下文 **≤300 行**。`source_code_paths` 只列被测入口与 UT 目标，不列整模块目录。必读：spec/plan/contracts/acceptance/use-cases（若有）/被测命名入口源码（≥3，签名级摘取）。评分≥60 或 L4 MUST subagent。增量落盘：探索开始先落 `ready_to_produce: false`，每摘取完一批被测入口 flush 一次（仅追加路径元数据，不违反 ≤300 行），全部摘取完才置 true。

**HARD STOP 规划确认门**（`ut.plan_confirm`）：Step 1 结束须先展示"UT 规划清单"，`1=确认` `2=调整`。清单须含：本轮覆盖 AC/BD/branch 与不覆盖项原因；每个 `it()` 名称/被测入口/Spy 边界/核心断言；将新增或修改的 DAG/测试源文件/套件注册入口路径；明确声明"本轮不改业务源码"。未确认前不得写文件。

## Step 1.5 可测性预检（testability-audit.md）

写入前自检：已读 `` `profile-skill-asset:business-ut/format_contract` ``；内容是 fenced yaml 块（非 Markdown 表格）；`acceptance_id` 严格来自 acceptance.yaml 已有 ID；写完跑 `npm run validate:ut-artifact -- --type testability-audit --file <path>`。

对每条 `ut_layer∈{unit,both}` 的 AC/BD 给出：`testability_level`（L0-L3）、关键 `dependencies`（含 `global_singleton`/`inline_lambda` 等）、`verdict`（testable/downgrade_device/needs_seam）。**若 L3**：当前 requirement 仍要求 unit/both 时，物化 `recommendation.option_b` 为 coding repair candidate，由 coding owner 修改后重走 review→ut；UT invocation 不改业务源码。只有用户明确提出 requirement correction 时，才把 `option_a` 作为普通需求变更交回 spec owner，把该项改为 device-only 并补 `device_focus`。`selected` 仅记录既有需求/修正路由，不是质量授权。**L3 接缝白名单**：coding repair 仅允许构造注入、包装 wrapper、提取命名方法、setter 注入等显式接缝；禁止"换一种全局单例"式敷衍。L3 candidate 未闭环前禁止进 Step 1.6/2/3。

## Step 1.6 Test Double Plan（mock-plan.yaml）【HARD STOP】

写入前自检：已读 format_contract；纯 YAML 无 Markdown 标题/围栏；`ts_expr` 含 `as TypeName` 或 `new ClassName(`；写完跑 `validate:ut-artifact --type mock-plan`。

规格：`` `profile-skill-asset:business-ut/mock_plan_schema` ``（imports、`spies[]`/`doubles[]`、每条 `strategy: spy|mockkit|fake|prototype_patch`、methods、presets）。**权威对齐**：`target_class`/`methods[].name` 须在 `contracts.yaml > interfaces[]` 中找到，禁止脱离 plan 自由发挥。**策略选型**：可注入+要调用序追溯→Spy；难注入外部边界→mockkit（须 `@ohos/hypium` MockKit/when 与 plan preset 对齐）；轻量替身→fake。用户确认（`ut.mock_plan`）展示 spy 边界与 preset 列表。无 L0/L1/L2 可测项时 mock-plan SKIP；一旦出现即强制。

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

**打桩三形式**（任选其一，均针对 `data_boundaries[].type` 指向的既有 data 层类）：①子类化——`class SpyXxx extends Xxx`，override 方法，暴露 `callLog[]` 与 `whenXxx.{returns,fails,throws}`；②原型方法替换——`Xxx.prototype.method = (...)`，`afterEach` 必须恢复；③既有 DI 接口——直接提供 Spy 实现。**统一约束**：禁止为打桩方便新建 `XxxPort` 接口；禁止在 Spy 内写业务判断；形式②必须 afterEach 恢复避免跨用例污染。

**每个 it() 必备断言**：路径 A——命名入口驱动 + 调用序列断言（`assertDeepEquals(spy.callLog,...)`）+ 状态多阶段断言（≥2 次 expect 覆盖中间态与终态）；路径 B——每个 it() ≥2 次 expect 覆盖数据契约与边界。

**用例命名**：`[BRANCH-<id>]`或`[AC-<id>]` 开头（可组合）；BD 必须组合标签（`[AC-1][BD-1]` 合法，`[BD-1]` 非法）。

**import 白名单**（`ut_import_whitelist` BLOCKER）：允许测试框架、被测命名业务入口、data 层与被允 Spy/Fake、同目录替身；禁止符号清单由 profile 的 `ut-ui-import-ban` + addendum 声明。

**生成流程**：为每个 data_boundary 生成 spy/ 替身（已存在则复用）→ 为每个 use_case（路径 A）或每组 AC（路径 B）生成测试文件，每 branch/AC 一个 it() → 展示确认 → 写入。

## Step 7.5 UT 编译闭环

首选通过 harness 触发：`harness-runner.ts --phase ut --feature <feature-name>`。**自闭环修复策略**：`ut.compile` FAIL → 完整读日志 → 按错误类型分类（UT 调用签名不符/import 路径错/类型不匹配→修 UT；依赖缺失→先按 Tier_1 装 harness 自身依赖，禁止改 `framework/package.json`；MockKit 无导出→mock-plan 补 `strategy: mockkit`；**若错因在业务源码→进入约束#12 HARD STOP，禁止自行动手**）→ 修完再跑直到 exit 0。

## Step 7.6 UT 装机运行闭环

探测设备：输出为空**不允许**继续跑或用"本地无设备"为由标绿；须先准备设备重新探测。装机执行：`harness-runner.ts --phase ut --feature <feature-name>` 同时触发 compile+run。**自闭环策略**：failed>0→读完整 `hdc-test.log` 找堆栈定位是 UT 逻辑错/Spy 预设错/还是业务真 bug（真 bug 仍走约束#12 HARD STOP）；total=0→测试入口未启动，核对 profile 测试配置；失败阶段 metadata/artifact_not_found/install→回 7.5 或查 toolchain 配置。

**`hap_not_found` / 签名缺口硬约束**：失败阶段为 `hap_not_found` 时，必须先全文引用 `hdc-test.log`（或 `ut_hvigor_test` details 头部）中的 harness 分层签名诊断与修复建议，再下结论。诊断已有明确原因层（例如“hvigor 明确报告 signingConfigs 未配置”）时，禁止另创 `.p12` 调试证书、默认密码、DevEco 会话兜底等环境故事。签名配置属于宿主资产：交互模式立即 HARD STOP，把诊断原文与“补 `signingConfigs` / 自定义签名任务覆盖 `ohosTest`”二选一动作交给用户，不代改宿主工程、不循环重跑；goal 模式的熔断由 runner 接管，agent 本轮只做诊断呈报，runner 仅允许一次有界确认性重跑，同 signature 重复即 halt。

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

harness 全绿后评估改动是否触及模块 Code Graph 的 `core: true` 节点：读相关模块 Code Graph，对比 contracts.yaml/diff 触及文件与 core anchor。**触及 core**→启动可行性探测，更新图谱节点，同步 characterization 或 spec-driven UT，flow DAG 可归档至 `test/dag/`。**未触及**→flow DAG 保持 ephemeral，用完即弃。

## 约束#12：HARD STOP 禁止修改业务源码（不可绕过）

UT 只拥有 profile 测试/夹具源目录，不拥有受保护业务源码。发现只能通过源码可测性改造解决的缺口时：

1. 不在 UT invocation 内修改 `src/main` 或等价业务实现根；用户回复、署名或 legacy `approved_src_mutations[]` 不构成例外。
2. 记录具体文件、所需签名、UT 层无法规避的技术理由和影响面，形成 coding repair candidate。
3. runner 回退 coding owner 完成改造，并完整重走 review→ut→testing；回到 UT 后重新生成 testability audit。
4. `ut_no_src_mutation` 对 UT 窗口内任一业务源码变化保持 BLOCKER，不读取人工授权名单。
5. 对“报错顺手抽函数/改 public/新增工具函数/改 barrel”等便利性修改同样适用。

在不改业务源码的前提下，优先使用 UT/Spy、类型安全的替身或原型恢复；若方案本身需要新架构或需求变化，分别回 plan/spec owner，而不是在 UT 内越权补洞。

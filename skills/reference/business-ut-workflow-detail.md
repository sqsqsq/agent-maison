# business-ut 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/business-ut/SKILL.md`](../feature/business-ut/SKILL.md)。本文承载 Lite Mode 判定、Step 1.0 摘取协议、Step 1.5/1.6 可测性预检与 Test Double Plan、Step 2/3 DAG 与 UT 代码生成细节、Step 7.5/7.6 编译与装机运行闭环、Step 8.0 Core 节点闸门、约束#12 HARD STOP 完整流程；触发/门禁清单/闭环判定仍以主文档为准。

## Lite Mode 判定（Step 1 之前）

满足**全部**条件时可启用 UT Lite（减确认点，**不**跳 DAG、**不**降级 harness 规则）：`acceptance.yaml` 中 `ut_layer∈{unit,both}` 的 AC/BD ≤7 条；`testability-audit.md` 结论全部为 L0/L1；**无** `use-cases.yaml`。Lite 时：可选产出 `ut/quick-plan.yaml`；harness 仍强制 testability-audit + mock-plan；允许单个 flat DAG 跳过 Mermaid 展示确认；确认点减为 2 个（`ut.plan_confirm` + `ok_to_testing`）。

## Step 1.0 Research Sub-Phase 摘取协议

**上下文摘取（BLOCKER）**：禁止通读大模块源文件。按 `` `profile-skill-asset:business-ut/context_extraction_protocol` `` 执行 rg 签名摘取；总上下文 **≤300 行**。`source_code_paths` 只列被测入口与 UT 目标，不列整模块目录。必读：spec/plan/contracts/acceptance/use-cases（若有）/被测命名入口源码（≥3，签名级摘取）。评分≥60 或 L4 MUST subagent。增量落盘：探索开始先落 `ready_to_produce: false`，每摘取完一批被测入口 flush 一次（仅追加路径元数据，不违反 ≤300 行），全部摘取完才置 true。

**HARD STOP 规划确认门**（`ut.plan_confirm`）：Step 1 结束须先展示"UT 规划清单"，`1=确认` `2=调整`。清单须含：本轮覆盖 AC/BD/branch 与不覆盖项原因；每个 `it()` 名称/被测入口/Spy 边界/核心断言；将新增或修改的 DAG/测试源文件/套件注册入口路径；明确声明"本轮不改业务源码"。未确认前不得写文件。

## Step 1.5 可测性预检（testability-audit.md）【HARD STOP】

写入前自检：已读 `` `profile-skill-asset:business-ut/format_contract` ``；内容是 fenced yaml 块（非 Markdown 表格）；`acceptance_id` 严格来自 acceptance.yaml 已有 ID；写完跑 `npm run validate:ut-artifact -- --type testability-audit --file <path>`。

对每条 `ut_layer∈{unit,both}` 的 AC/BD 给出：`testability_level`（L0-L3）、关键 `dependencies`（含 `global_singleton`/`inline_lambda` 等）、`verdict`（testable/downgrade_device/needs_seam）。**若 L3**：必须 STOP，展示 `recommendation.option_a`（降级 device-only，`acceptance.yaml` 填 `device_focus`）与 `option_b`（源码改造+gap-notes 授权），用户选择并填 `selected`。**L3 + option_b 接缝白名单**：仅允许构造注入、包装 wrapper、提取命名方法、setter 注入等显式接缝；禁止"换一种全局单例"式敷衍。全部 L3 项未做完 a/b 选择前禁止进 Step 1.6/2/3。

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

**设备失败分类决策树**（读 `ut-install-diag.json` + `ut_hvigor_test` 报告）：

| blockingKind | 条件 | agent 动作 |
|--------------|------|------------|
| selfHealable | 版本降级且未设 env | 设置 env 后重跑 |
| needsConfirmation | 降级+需确认卸载/升 versionCode | HARD STOP 列诊断等用户选择 |
| externalBlocked | 无设备/hdc 缺失 | 不循环改 UT，告知用户准备设备，`verdict=INCOMPLETE` |
| clear | 预检通过 | 继续装机执行 |

**绝不允许**：把"无设备"标 SKIP/PASS；用环境变量跳过 `ut.run` BLOCKER；未跑就交；因找不到工具链就写 SKIP。

## Step 8.0 Core 节点闭环闸门

harness 全绿后评估改动是否触及模块 Code Graph 的 `core: true` 节点：读相关模块 Code Graph，对比 contracts.yaml/diff 触及文件与 core anchor。**触及 core**→启动可行性探测，更新图谱节点，同步 characterization 或 spec-driven UT，flow DAG 可归档至 `test/dag/`。**未触及**→flow DAG 保持 ephemeral，用完即弃。

## 约束#12：HARD STOP 禁止擅自修改业务源码（不可绕过）

对受保护业务源码前缀下、非 profile 测试/夹具源目录内任何文件的修改，必须满足全部条件：

**headless/goal-mode**：无交互用户→保守默认=拒绝改源码，记录被推迟的 `ut.src_mutation` 请求到 `headless-assumptions.md`，不登记 `approved_src_mutations`。

1. **动手前**显式向用户提出请求（`ut.src_mutation`，须先展示完整变更描述）：`1=授权改源码` `2=拒绝` `3=先看 diff`。请求须含拟变更文件路径、拟抽取/新增函数签名、为何不能只改 UT/DAG/use-cases.yaml 规避的技术理由、预估影响面。
2. 用户**书面同意**后方可动手。
3. 动手后必须把授权纪要写入 `ut/reports/<timestamp>/<model>-ut/gap-notes.md > approved_src_mutations[]`：时间戳、文件路径、变更摘要、用户确认原话。
4. **未登记的 src/main 变更一律视为违规**，触发 harness `ut_no_src_mutation` BLOCKER。
5. **特别禁止**以下"便利性"借口直接动手："报错→顺手抽函数/改命名字段"、"无法访问私有成员→改 public"、"UT 需要工具函数→顺手新增"、"导入不便→顺手改 barrel 导出"——都必须先问。

违反会被 code-review 追溯标记为质量事件。推荐替代路径：优先在 UT/Spy 侧用原型替换、`as unknown as T` 注入绕过可测性障碍；确需源码变更优先选"抽出命名方法/导出函数/普通 class"而非新造 Port/UseCase 类。

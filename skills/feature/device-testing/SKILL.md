# 真机测试 Skill (`device-testing`)

从 bug、改动或目标行为设计用例；按请求进行即席操作或验证，不要求先有 Feature。

## 请求分流（先判后进）

| 请求形态 | 走哪条 | 请求终点 |
|---|---|---|
| 解锁手机 / 唤醒设备 | `cd framework/harness && npx ts-node scripts/device-policy.ts --ready --json`，按 [device-policy-gate 正道节](../../reference/device-policy-gate.md) 处置 | 交付实际就绪结果；无需 Feature/bundle/报告 |
| 只设计用例 | [共享用例设计方法](../../reference/device-testing-workflow-detail.md#共享用例设计方法) | 交付用例；不调用设备、setup、安装或 request |
| 即席导航、观察或调试 | [Step 4.B](../../reference/device-testing-workflow-detail.md#step-4b-即席模式ad-hoc不绑正式需求)；步骤可由 Agent 从目标推导 | 交付实际 trace/观察结果；导航成功不代表业务预期通过 |
| 设计用例并验证修复 | 先共享设计方法，再 [request CLI](../../../docs/operations/request-harness.md) 的 testing 路径，`--prepare-request` 后执行 | 每条提供可执行步骤与明确预期结果；分别报告通过、失败、未验证 |
| 正式 Feature/CU testing | 先完整读 [正式阶段](../../reference/device-testing-workflow-detail.md#正式-featurecu-阶段) 再执行 | 消费绑定验收/范围及原 required 证据，按正式完成判定收口 |

步骤设计由 Agent 完成；用户只需提供目标行为和可查证的预期，不必先写点击脚本。已有正式交付责任不改走独立路径。
正式阶段的**闭环停等**按 [用户确认 UX](../../reference/user-confirmation-ux.md) 的 `phase.next_step` 与已有授权裁决；独立请求到本次设计或执行终点结束。
解锁、即席和正式执行共用 [设备策略](../../reference/device-policy-gate.md)：实际操作时保留授权和 PIN 红线；即席 CLI 已含设备门，不必预先重复 `--ready`。

## 方法与执行

需要设计/执行测试的独立请求与正式 testing 阶段读取 [共享用例设计方法](../../reference/device-testing-workflow-detail.md#共享用例设计方法)，选择正常、边界、失败与恢复场景，明确测试层级、前置条件、步骤和可观察预期。仅解锁/唤醒按分流表直接结束，不进入用例设计。
正式调用在同一方法上补 acceptance 的 device/both 追溯、NFR 与视觉义务；独立调用引用 bug/用户预期或现有有效规范，不制造 AC。
用例设计完成且用户已要求验证时，在原授权内继续执行。仅缺少会影响目标、预期、设备授权或不可逆动作的决定时才澄清。

- 真正需要设备操作才读 `framework/profiles/<project_profile.name>/skills/device-testing/profile-addendum.md`，确认工具与目标应用。bundle/ability 优先从明确目标应用的工程配置解析，存在多候选才问用户。
- 验证修复前确认设备安装的版本来自本次目标工作树；需要当前构建时复用 `adhoc-device-test --install-current-build`，按原安装权限执行，保留构建/安装 meta；不能用旧包结果归给新代码。
- testing request 的 cases 沿现有 adhoc case 格式，`inputs.test_plan` 使用既有 Hylyre 派生格式；同一 TC 的步骤与预期一致。执行语法取现有 derive hint/step catalog，写后走现有 lint，不发明另一套 case 协议。
- 导航/观察使用现有即席链；业务预期使用 request/provider 的原生断言和 expected check。touch 成功、截图存在或页面出现均不自动证明全部业务预期。
- 缺设备/视觉/断言能力时保留已设计内容及未执行项；真实失败不洗绿。默认不修改产品、测试或构建声明，缺陷按所属责任交回。

## 结果边界

输出本次目标与实际版本、已设计用例、通过/失败/未验证及证据路径；只设计时明确未执行。
独立执行不写 Feature receipt、attestation 或 completion。request facts 仅写 prepare 返回的 `factsPath`，身份按 [输入契约](../../../docs/concepts/skill-contracts.md#facts-11) 解析；即席不要求正式 facts/verifier。
正式派生、native evidence、视觉回环及阶段闭环细则按 [reference](../../reference/device-testing-workflow-detail.md) 的对应章节条件加载；未执行 testing 不宣称视觉验收或 Feature 完成。

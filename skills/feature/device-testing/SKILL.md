# 真机测试 Skill (`device-testing`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `testing.module_name` / `testing.packaging` / `testing.plan_confirm` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)；宿主打包/装机/设备工具链以本 Skill 的 profile addendum（Tier_2）为 SSOT。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。**设备策略（BLOCKER）**：[device-policy-gate](../../reference/device-policy-gate.md)：`npx ts-node scripts/device-policy.ts --check --json`（**判定两段**：退出码 0 且 stdout 合法 JSON → 看 `code`；非零或非法 JSON = 执行失败须停止，含**凭据库不可读**，不得当成"未配置"引导重新登记）；**只看 `code` 不看 `configured`**（坏凭据/只有 `disabled` 时 `configured=true` 而 `code=unset`）；harness-runner 在需设备 phase 另有进程级入口门（同一 `code`，设备操作前 fail-fast + 目标解析一次注入全链）作兜底；`code=device_policy_unset` 就**先问用户四选一**再碰设备（选 ③ 须追问 `existing`/`managed`，禁默认托管）。与 goal 模式同一契约；PIN 只能由用户在自己终端登记，**绝不进对话**。**视觉能力自测（UI 相关需求·交互式）**：personal-setup `ok` 后按 [interactive-vision-canary](../../reference/interactive-vision-canary.md) 后台跑自测卷判卷 CLI（防死锁编排逐步照做）。

**Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`；只有精确目录是正式 feature，同名归档/前缀条目只是旁证。 `<feature>` 语义见 [路径术语表](../../reference/agents-entry-detail.md)（物理 Feature 路径）；定位一律经框架解析（CLI/SSOT/harness 产物路径），不得手工拼接逻辑 identity（含编码 `cu-…`）。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。展示输入矩阵（spec/plan/acceptance/contracts(可选)/use-cases(可选)/test-plan(本阶段产出)）；legacy `device-testing-todo.md` 存在仅 WARN 迁移提示，不得作 SSOT；输入缺失回上游补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/device-testing/profile-addendum.md` 时先读（宿主 toolchain/打包装机/设备探测细则）。
- **Step 1.5 打包装机协议 / Step 4.5 Hylyre 派生计划全套 / Step 4.B 即席模式全套 / Step 4.6 视觉 diff 回环（含全部事故派生判裁规则）/ Step 5.1 trace 回填 / Step 6 自检完整清单**：完整读 [device-testing-workflow-detail.md](../../reference/device-testing-workflow-detail.md)。
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

## 概述

按当前 `project_profile` 自适配的设备/系统测试工程师：基于 acceptance 标准与 Spec 契约生成测试计划，执行后产出标准化测试报告。流水线**第六环（最终环）**，上游 business-ut 的 DAG 和 UT 代码，输出是功能模块质量交付的最终把关。

**Goal/headless 写边界（BLOCKER）**：只写 testing/device-testing workspace 与本阶段 contract `produces`，不得修改需求 SSOT、plan、产品源码或 UT。缺测试锚点或验收契约错误时写入结构化缺陷，由 runner 自动回对应 owner；越权字节仅作为未受信输入保留，本轮证据作废，不能用人工确认豁免。

## 触发条件

"真机测试"、"设备测试"、"测试计划"、"写测试报告"、"生成测试报告"、"系统测试"、"功能测试"、"验收测试"、"测试方案"、"编写测试用例"。

### 模式分支：标准 feature vs 即席（ad-hoc）

| 模式 | 典型输入 | 是否走 `<features_dir>/<正式 feature>/` |
|------|----------|----------------------------------------|
| **标准** | 「对 `home-page` 做真机测试」、已存在需求目录 | ✅ 须存在 spec/plan/acceptance，按 Step 1-7 与 `harness-runner --phase testing --feature <名>` 闭环 |
| **即席** | 仅描述 bundle id + 自然语言操作步骤，不指向本仓库某 feature | ❌ 不消费需求目录；用占位目录名 `_adhoc`（详见 reference Step 4.B） |

两种模式共享 `device-test-case-kernel`：标准轨把 `acceptance.yaml` 的 device/both P0/P1 AC/BD 归一为 cases（`mode=acceptance`），即席轨把自然语言步骤归一为同一 case 结构（`mode=adhoc`）。仅输入模态不同；设备可用性、安装、真实执行、trace、视觉与 device-policy BLOCKER 一律沿用原门禁，不因即席或降档放宽。

**即席识别启发**：用户给出 `com.xxx.yyy` 类 bundle 字符串且步骤像「打开应用→点某按钮→…」；或未提供与本仓库已有目录匹配的 feature 名，且核心诉求是「当场跑一遍 UI 流程」而非「完成某需求的 testing 阶段门禁」。

## 核心理念

**从 `acceptance.yaml`（`ut_layer` + `device_focus`）派生 test-plan → Hylyre/真机执行 → 结构化报告 → Harness 验证闭环**。business-ut 验证 UseCase/state/port 的业务逻辑正确性；真机测试验证**端到端用户体验**。AC/BD 按 `ut_layer∈{unit,device,both}` 分层：`unit` 已由 UT 覆盖本 Skill 不重复；`device` 须由本 Skill 真机覆盖；`both` UT 覆盖业务侧，本 Skill 补做 UI 侧（Toast/跳转/渲染/交互）。真机要点以 `acceptance.yaml` 的 `device_focus` 为 SSOT（spec 阶段写入）；business-ut 可选产出 `ut/reports/ac-coverage.json`，**非** SSOT。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 定位文件 |
| spec.md / plan.md | ✅ | 需求基准/实现计划 |
| acceptance.yaml | ✅ | 验收 SSOT（含 ut_layer/device_focus），**test-plan 派生来源** |
| use-cases.yaml / contracts.yaml / doc/architecture.md | ⬜ | 了解 UT 已覆盖分支/模块边界/架构全貌 |
| review-report.md | ⬜ | 可选，确认代码已通过 Review |

**缺 device_focus**：对 `ut_layer∈{device,both}` 的 AC/BD，提示回 spec 阶段补全（`acceptance_device_focus_present` BLOCKER）。**缺 acceptance.yaml**：提示先运行 spec 阶段。

## 流程骨架

1. **Step 1 收集测试上下文**：确认模块名（`testing.module_name`：`1=确认` `2=修改`）；读 acceptance/spec/plan/use-cases(若有)/contracts(若有)/architecture(若有)；按 ut_layer 统计范围展示给用户（device AC 数/both AC 数/unit AC 数/边界场景/非功能性需求）。**Context Facts Gate（BLOCKER，C4）**：追加 `<features_dir>/<feature>/context/facts.md` 的 `## phase_delta: testing` 节（无新增事实写 "none"）。
2. **Step 1.5 打包与装机**（`device_test.build`/`device_test.install` 为 BLOCKER 时，详见 reference）：读宿主 addendum → `testing.packaging` 确认 product/buildMode → 经 `dispatchDeviceTestBuild`/`dispatchDeviceTestInstall` 产出装机 → 与文档门禁顺序对齐。
3. **Step 2 生成测试计划**：模板 `templates/test-plan-template.md`，**须含 6 章节**：测试范围/测试环境/测试用例清单(表格：编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC)/测试策略/通过标准/风险与依赖。**用例生成规则**（v2 ut_layer 感知）：每条 device AC → 至少 1 条用例（步骤来自 device_focus）；每条 both AC → 至少 1 条用例，关注点限定 UI 层；`criteria` P0/P1 各生成 1 条、P2 可选；`boundaries` 每个边界场景 1 条；`performance` 每个指标 1 条验证用例；`ut_layer=unit` 不再生成。用例编号 `TC-{NNN}`；步骤须明确可重复；预期结果须可观察可验证；追溯字段另记 `linked_flow`/`linked_branch`/`ut_layer`。
4. **Step 3 用户确认测试计划**：`testing.plan_confirm`：`1=确认` `2=修改`。
5. **Step 4 归档**：`<features_dir>/{module-name}/testing/test-plan.md`。
6. **Step 4.5 真机自动化派生可执行计划**（`device_test.run` 为 BLOCKER 时，详见 reference）：解析 TC 表并读取每条 TC 的**执行通道**（`hylyre|visual|manual|provider:<capability-id>`，顶层 test-plan 声明、经 review，缺列/缺值/非法即 BLOCKER 一次性迁移）→ **只编译 `channel=hylyre` 全集**，不得新增/删除/改写通道，也不得写 `explicit_skip_tc_ids` → 按 contracts/plan/snapshot-cache/设备连线四级优先级发现 selector 候选（四级只负责发现；snapshot-cache/设备 dump 不是真值）→ 正式 by_text 必须显式声明 `match: exact|contains` 且由 acceptance 意图决定（禁止字符启发式/运行时 fallback）；feature ui-spec 是开放世界，selector 缺席只 WARN 放行，静态只拦可确定错误 → 译为 Hylyre JSON（裸单行、canonical 直接根键、禁 dump_ui 等 CLI 名作根键；`start_app`/`stop_app` 只允许作为 case **首部**恰好一组复位前奏 `stop_app→start_app`，bundle/page_name 逐字取 hint 的 `reset_preamble`、不得自拟、不得用 `clear_app`，其它位置 STEP-003 BLOCKER），每个 case 首个断言前必须有同 case 的 setup/navigation action → **任一 hylyre case 编译失败即整份计划不启动**，回报该 TC 根因与下一责任阶段（不改成跳过）→ 落盘 `test-plan.hylyre.md` 到 `testing/reports/<timestamp>/hylyre/` → 触发 `harness-runner --phase testing`。**`manual` 通道没有机器质量 PASS 载体：任一 manual TC 都让本 feature testing 保持 FAIL/UNVERIFIED**，这是冻结设计，不接受人工确认/receipt 关闭本轮质量门。
7. **Step 4.B 即席模式**（详见 reference）：Derive hint（不跑机）→ Agent 写 `doc/features/_adhoc/testing/staging/test-steps.json` 并 lint → 执行 `adhoc-device-test`（默认冷重启）→ 观察汇总决策树 → 不写 receipt/verifier，交付 trace.json cases 摘要。
8. **Step 4.6 视觉 diff 回环**（`ui_change=new_or_changed` 时，详见 reference）：唯一直接像素对图阶段；MVP 覆盖顶层屏+固化 nav 配置到达深层屏/overlay；P0 屏无论 lightweight 与否必须采集评估；执行时先断言屏身份(E3)再双向 diff(正向/反向+G3 样式核对+defects 枚举+**region_attest 逐区域举证**)；采图同时点 dump 布局树(`layout-<screen_id>.json`)供 **T8 几何不变量**消费；产出 `visual-diff.json`(唯一结构化真源)+自动生成 `visual-diff.md`(请勿手改)；`pixel_1to1` 下 T1/T4/T5/P1-C/**T8(布局 hard)/M1(自报退化)/attest 证据/critic 回执**等机器信号任一命中即 BLOCKER（分数字段=reported_* 参考自评、零 gate 权重）；回修由独立 critic 自动迭代至 candidate-pass 或指纹化熔断。当前 attempt/hash/identity 绑定的 deterministic/native/delegated 证据决定 visual 轴；legacy `confirmed_by` 无 gate 权重。确定性 fail 信号必须 verdict=fail+逐条写进 must_fix，不得弃判；testing 禁止写产品源码/需求 SSOT，runner 消费 must_fix 自动回退 coding 修复后重走 review/ut/testing。
9. **Step 5 生成测试报告**（`testing` harness PASS 且 trace.json 已写出后）：模板 `templates/test-report-template.md`；Step 5.1 必须读取最终 run 的 trace 与 `device-test-timing.json`，保留 skip 并计入正确分母，使用最终 build/install reused 状态（流水线说明列显式写 `reused=true|false`），逐 case 回填最终 duration，报告耗时统一为精确整数毫秒 `Nms`（如 `1234ms`，历史 `1,234ms` 可读）；已进入 trace/timing 的 skip/block case 填 `0ms`，仅未进入 trace/timing 的用例（非 hylyre 通道或历史 legacy skip）填 `—`；禁止把首轮真编或旧轮 timing 当最终执行轮数据；填充测试概览/执行结果/缺陷清单/通过率统计/结论 5 章节；结论判定：P0=100%且总体≥阈值→达标，P0=100%但总体<阈值→有条件达标，P0<100%→不达标。需要只重算已有执行产物时使用 testing 专属 `--report-reconcile-only --phase testing --feature <feature>`，该模式先对账同一最终 run 的路径/指纹/时间戳/feature/case 集合/timing 与报告耗时，随后零设备/hvigor/hdc/Hylyre/视觉采集/lifecycle hook 调用且完整重算既有 report/static checks、summary 与 quality axes，不局部 patch summary、不改 authoritative trace。确定性 producer FAIL 与合法 provider defect 直接物化既有 repair candidate；primary dispute/缺复核无否决权。producer uncertain 或 provider invalid 表示证据不足：required 轴保持 FAIL/UNVERIFIED 或 capability defer，optional 轴仅 advisory，不创建人工裁决停等。即席模式无强求写 test-report.md。
   - **Native evidence gate（hmos-app）**：Hylyre `0.5.0+`、trace `0.4-p0` + `result_protocol=hylyre.step-outcome/1`（Step Outcome v1）与 `hylyre-ready.meta.json` 的 installed/manifest/trace environment 版本链必须同时一致，且每个 `CaseResult`/`StepResult` 必需字段真实在场；否则旧 `status=通过`（中文枚举只是兼容投影）不得贡献 verification 通过。P0 通过分子只认 `execution=completed`、`verification=passed`、`evidence=complete` 及 required presence / forbidden absence assertion 的同 index `StepResult`（`outcome.status=passed`，presence 要 `observed_present=true`，absence 要 `observed_present=false` 且 `candidate_count=0`）。native trace 还必须绑定实际执行的 derived plan：`trace.artifacts.plan`、top/derived/trace 路径与 SHA、StepResult count/index/kind 必须同轮一致，唯一尾部 `expected_check` 除外。
   - 成败结合 `outcome` 与 `observation` 裁决，selector 身份事实读 `selector.request` / `selector.resolution`（`resolution` 不是第二个成功状态），禁止读 flat `status`/`failure_kind`/`failure_code`/`evidence.executed` 重建。已执行失败按 nested `outcome.failure.domain/code` 路由：`outcome.status=failed` + `failure.domain=assertion`（`assertion.mismatch`）且同 case 有较小 index、`outcome.status=passed` 的 action，才可进入 coding candidate；`selector.*` 回 testing 重派生/消歧，`capability.*` defer，`infrastructure.*` 回 external/toolchain。未尝试的步骤零 route：`blocked` 读 `outcome.cause`（`capability`/`infrastructure` 各投 1 次 disposition，`prior_step` 零投影），`skipped` 读 `outcome.reason`（`policy` 不产生 capability defer）。无 StepResult 的未执行 case（包括 P1/P2）保持 testing-owned FAIL，零自动 coding；历史 `explicit_skip_tc_ids` 同等对待，仅只读诊断。
   - native StepResult 在场时不启用旧 runtime telemetry monkey-patch；历史 telemetry 仅作有限 checkpoint 兼容或一致性告警，不合并为第二真源。
10. **Step 6 质量门禁自检**：测试计划 11 项 + 测试报告 8 项（完整清单详见 reference）；不通过定位后自动修正重检。
11. **Step 7 Harness 验证门禁**：见下方门禁清单表。

## 门禁清单表

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 真机构包/装机（可选宿主 BLOCKER） | profile `device_test.build`/`device_test.install` | BLOCKER / SKIP |
| 真机自动化（profile capability） | `device_test.run` 消费派生用例产出 report+trace | BLOCKER / SKIP |
| 测试计划必需章节 / 用例清单表格格式 | 6 章节齐全 / 表头 7 列齐全 | BLOCKER |
| 用例优先级值域 / 测试环境定义 | 仅 P0-P3 / 含设备+系统版本+API 版本 | MAJOR |
| 通过标准定义 / AC 追溯覆盖 | 含量化阈值 / P0/P1 AC 全覆盖 | BLOCKER |
| BD 追溯覆盖 | 边界场景已覆盖 | MAJOR |
| 报告必需章节 / 执行结果表格 / 通过率统计 / 结论一致性 / 计划-报告一致性 | 齐全/状态值合法/含各优先级通过率/结论与数据匹配/用例编号一致 | BLOCKER |

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase testing --feature {module-name} --summary --failures-only
```

优先读 `summary.json`，`testing_run_status.can_claim_done` 须为 `YES` 才能宣称阶段完成。

**AI Harness**：harness 输出 verifier request 时，主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权），prompt 模板 `framework/harness/prompts/verify-testing.md`（测试用例完整性/步骤可重复性/预期结果具体性/NFR 覆盖/缺陷严重程度一致性/通过标准与结论一致性）。

**Task prompt = harness 写出的短 request JSON 整段**（plan a9d4e7c2）：verifier 能力启用时，`harness-runner` 会在结尾打印 `verifier.request.<subject>.json` 的路径，并把它记进 `summary.verifier_request`。把**那份 JSON 的完整正文**作为 Task prompt 投给 verifier——verifier 自己按其中的 `prompt_path` 读磁盘原件（`ai-prompt.md` 可达上百 KB，不过传输面）。不要投递 `ai-prompt.md` 全文、不要手抄或改写任何字段、不要在 JSON 前后附加说明：subject 由字段重算，抄错一处即失配 → 报告落 bedside、阶段不闭环。

**harness 没有输出 request 时先看 `summary.next_action`，别急着下结论**：①能力未启用（policy/workflow/profile 判定）→ 本阶段就没有 verifier 这一环，不要去找、不要补造，闭环也不要求它；②`resolve_verifier_provider_then_rerun` → 能力声明为 required 但当前 adapter 没有登记，脚本结论仍然有效，但本阶段不得闭环；③脚本尚未 PASS → 本轮刻意不产出 verifier 调用面，先修 BLOCKER 再说。

## 阶段闭环判定（全局入口 §5.1）

> **标准 feature 模式**适用下文四条件。**即席（`_adhoc`）模式**不宣称「某需求 testing 阶段闭环」：不写 receipt、不强求 `harness-runner testing --feature _adhoc` PASS、不要求 verifier；以交付 trace.json 摘要为主。

**closed = 脚本 harness verdict=PASS ∧ 全部 policy=required 的证据已提供**。要求哪几项由 harness 求解后输出（`HARNESS_EVIDENCE_POLICY` 行与 `check-receipt` 的逐项状态），不是写死的固定四件套——verifier 是否 required 由 harness 的 verifier plan 决定，判 disabled 时这一项不存在也不缺失。本阶段的常规形态：

1. `<features_dir>/<feature>/testing/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS（**仅当 harness 为本阶段输出了 verifier request**）；4. 完成回执经 `check-receipt.ts` 校验通过。required 证据齐备后真机测试阶段完成（**最终环**）。

**收尾 / 闭环停等（BLOCKER）**：只呈现 harness 的 `NEXT_STEP` 段落；recommendation 由 `assess@1` 生成（含回修起点），执行授权仍由 driver 按 `phase.next_step` / `transition_policy` 裁决。

## 输出规范

| 产出 | 路径 |
|------|------|
| 测试计划 | `<features_dir>/{module-name}/testing/test-plan.md` |
| 测试报告 | `<features_dir>/{module-name}/testing/test-report.md` |

Markdown 格式，用例清单/执行结果用表格；用例编号 `TC-{NNN}`；缺陷编号 `DEF-{NNN}`。

## 约束与注意事项

1. AC 追溯强制：每条用例须关联 acceptance.yaml 中的 AC/BD 编号（推荐同标注 `ut_layer`/`linked_flow`/`linked_branch`）。
2. 分层分工：`ut_layer=unit` 不出现在本 Skill 测试计划中；`device`/`both` 才是本 Skill 范围。
3. 按 `ut_layer∈{device,both}` 与 `device_focus` 生成/更新 test-plan，勿再维护 `device-testing-todo.md`。
4. 测试计划先行，经用户确认后再据执行结果生成测试报告。
5. 步骤须足够详细可重复；预期结果须可观察可测量，禁止"正常显示"等模糊描述。
6. 模拟应用适配：预期结果基于模拟数据实际值而非真实后端返回值。
7. 测试计划与测试报告是独立文档，分别在不同时间点产出。
8. 中文输出；P0 优先，资源有限时优先覆盖 P0 AC。
9. Harness 验证闭环：agent 必须自跑 Step 7 + 主动触发 verifier；确保零 BLOCKER+verifier PASS+完成回执通过后才认为阶段完成。
10. 不修改源码：**整个 testing 阶段**（生成文档、真机执行、视觉回环、重试轮，全程）不得修改任何业务代码、UT 代码、需求 SSOT（acceptance/ui-spec/contracts/spec/plan/use-cases）或根构建配置。runner 对 invoke 前后做快照比对，手工写入=run 终止态（证据作废、gate 不跑、--resume 拒绝）。**framework harness 触发的构建生成物例外**：`device_test.build` 重写的模块根 `BuildProfile.ets` 由 runner 自动分类为合法副作用（不算违规）——放心跑 harness 自检。**禁止在自己的命令里临时覆盖 `HARNESS_DEVICE_TEST_PRODUCT` / `HARNESS_DEVICE_TEST_BUILD_MODE`**：runner 已按 attempt 冻结这两个值并注入环境，覆盖会让生成物与冻结配置不符、被判违规。修码诉求一律写进 must_fix 由回退后的 coding 实施。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/device-testing-workflow-detail.md](../../reference/device-testing-workflow-detail.md) |
| 阶段级规约 | `framework/specs/phase-rules/testing-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-testing.ts` |
| 派生提示 JSON | `<features_dir>/<feature>/testing/reports/derive-hint-from-plan.json` |
| 顶层计划结构化抽取 CLI | `cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>` |
| AI Harness Prompt | `framework/harness/prompts/verify-testing.md` |
| 测试计划/报告模板 | `` `profile-skill-asset:device-testing/test_plan_template` `` / `` `profile-skill-asset:device-testing/test_report_template` `` |

## Slash/trace 约定

通过 `/device-testing` 或等价快捷入口触发时，须在阶段结束时产出 trace 凭证：`<features_dir>/<feature>/testing/reports/<timestamp>/<model>-devtest/trace.json`（Schema：[trace.schema.json](../../../../harness/trace/trace.schema.json)，`phase: testing`）；同目录 `gap-notes.md`（模板 [gap-notes.template.md](../../../../harness/trace/gap-notes.template.md)）。

## 收尾

阶段结束时只呈现 Harness 输出的「下一步」段落，不自行推导或补写跨阶段建议。

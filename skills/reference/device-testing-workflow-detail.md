# device-testing 阶段详细流程（条件加载：执行对应 Step 时读）

> **输入协议边界（仅正式阶段与机器 request）**：只审查、解释或设计用例仍先阅读真实代码和依据，但不建立身份/facts、不创建正式产物、不进入阶段确认/闭环。以下落盘与量化要求只用于正式或机器请求；以下 旧出生协议为 spec 的 facts 建立与固定上游阅读口径仅适用于 1.0。收到 runtime/专项入口明确提供的 1.1 调用上下文时，按[输入契约与 Facts 1.1](../../docs/concepts/skill-contracts.md#facts-11)读取真实内容与来源：首个实际 Skill 在主产出前建立 facts，后续或成功前驱基线只补本次 phase_delta；不补跑 spec、不伪造建立身份。无 Feature 时只用入口指定的 request report-dir/context/facts.md。调用上下文由实际入口解析，不自行补造。

> SSOT 索引见 [`skills/feature/device-testing/SKILL.md`](../feature/device-testing/SKILL.md)。本文承载 Step 1.5 打包装机协议、Step 4.5 Hylyre 派生计划全套操作、Step 4.B 即席模式全套操作、Step 4.6 视觉 diff 回环（含全部事故派生的确定性判裁规则，逐字保留不得精简）、Step 5.1 机器报告读取、Step 6 质量门禁自检清单；主 Skill 决定请求分流，本页各节按需要加载；正式门禁与闭环保留在末尾的正式阶段。

## 共享用例设计方法

1. 确认本次目标行为、变更和预期来源。读取相关实现/调用者、已有要求与必要页面资料；bug 描述用于定位失败条件，diff 用于确定影响，二者都不能独自证明新预期。缺少决定性预期才问具体问题。
2. 列出与目标相关的正常、边界、失败和恢复场景，选择最能验证它的层级：纯计算/状态逻辑优先 UT，导航、渲染、交互与设备行为用真机；同一风险不无故重复整条链。
3. 每例写明前置状态、输入/步骤、可观察预期与来源。比如脱敏修复要断言该显示值及敏感原值未暴露，不能只断言页面存在。优先覆盖修复触发条件和直接邻接回归；不凑无关用例数量。
4. 正式 Feature 从 acceptance 的 device/both 与 device_focus 派生并保持 AC/BD/NFR/视觉追溯。独立请求从用户目标或有效依据派生；沿 `device-test-case-kernel` 的既有 adhoc case 结构提供步骤和 expected，不复制 case schema、不编造 AC。
5. **只设计时停止**：交付场景、预期和未验证项，不调用 setup、dump、安装或设备。用户已要求执行时继续：从明确应用的工程配置确定 bundle/ability，核对当前构建；使用 Step 4.B 做导航/观察，业务预期走主 Skill 所链 testing request/provider。派生语法和 selector 候选消费现有 hint/catalog；实际合法性以 native 结果为准。
6. 读取本次真实 trace/原生断言/expected check，逐例分开通过、失败、未执行。能力不可用或观察不足时保留未验证；touch 成功不代表断言通过，旧安装包不证明当前修复。只验证不改产品，真实缺陷交所属责任处理。

以下 Step 1.5/4.5/4.6 的正式产物责任仅用于 Feature；独立执行使用 Step 4.B 和 request 文档给出的落点与输入。两者沿用同一操作约束，不把正式报告/凭证作为用共享方法的前置。

## Step 1.5 打包与装机（profile capability）

在生成测试计划（Step 2）之前，若当前 `project_profile` 将 **`device_test.build`/`device_test.install`** 声明为 **BLOCKER**，须与用户对齐「能在真机上跑的同一套包」：

1. **读取宿主指南**：完整阅读 `framework/profiles/<project_profile.name>/skills/device-testing/profile-addendum.md`，宿主 toolchain/环境/harness 变量以单一宿主附录为 SSOT，根 SKILL 不复述宿主专有名词。
2. **与用户确认打包维度**（`testing.packaging`）：展示 product/buildMode 推荐值后 `1=确认` `2=修改`。product 枚举宿主工程可用制品维度：默认按 `resolveProductSelection` 单次解析（`explicit_run` → `confirmed_env`（`HARNESS_DEVICE_TEST_PRODUCT`）→ `explicit_config`（config 值且 local 确认值逐字相等）→ `sole_candidate`）；**构建形态无法确定时不猜**（四种原因：多候选未确认 / build-profile 缺失 / products 为空 / build-profile 不可解析——后三者无真实候选、不得虚构 `default`），停止并经 framework-init `init.product_selection` / `record-product-selection` 机器写入或 env 显式确认后继续。buildMode 为宿主 `debug`（默认）/`release`，需在会话或环境记下所选组合供 `testing` harness 复现；附录 `testing-build-conventions.ts` 说明可用 `HARNESS_DEVICE_TEST_*` 变量。
3. **执行链路**：经 `capability-registry` → `dispatchDeviceTestBuild` 产出 signed 应用包；再 `dispatchDeviceTestInstall` 触发装机（宿主附录写明等价 CLI）。宿主实现在 `profiles/<name>/harness/providers/device-test-build.ts` 与 `device-test-install.ts`；日志约定见宿主 profile-addendum（同一 `reports/<feature>/testing/` 目录）。
4. **与文档门禁的顺序**：`testing` 脚本 harness 会在校验 Markdown 计划/报告之前尝试 `device_test.build → device_test.install → device_test.run`（profile SKIP 则对应步骤 SKIP）。Hylyre ensure（venv/pip/doctor）在 `device_test.run` 内自动执行，非 Skill 入口独立步骤。可先撰写文档再由 harness 触发包链路；BLOCKER 失败须先修复宿主 toolchain/设备再继续闭环。
5. **外部自动化**：Framework 负责「包已在设备上」之前的宿主门禁；后续第三方自动化/UI+Mock 不负责替代宿主打包（单向衔接）。

## Step 4.5 真机自动化·派生可执行计划（profile `device_test.run`）

若 `device_test.run` 为 BLOCKER 且未 SKIP，须在跑一次 `testing` harness 之前，从顶层 `test-plan.md`（自然语言步骤表）生成 Hylyre 可消费的派生计划。具体 JSON 形态/宿主 CLI/`HYLYRE_APP_STORE_DIR`/即席落盘约定见 profile addendum「真机自动化」与模板 `` `profile-skill-asset:device-testing/test_plan_hylyre_template` ``。

**首次派生入口**：先运行 `cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`，读本次 stdout 的完整上下文，再写 `test-plan.hylyre.md`，不需要先让 harness 失败一次。canonical testing reports 下的 `derive-hint-from-plan.json`（尊重 `reports_dir_pattern`）是源语义基线：真实 TC/执行语法/reset 输入未变时保持字节、generated_at 和 mtime；stdout 仍含当前缓存/selector 候选并沿用原 generated_at。需要完整当前上下文文件可用 `--out <另一文件>`，该导出不更新或替代 canonical 基线；`--out` 指向 canonical 与默认写入同样幂等。

**门禁提示**：`device_test.run` 未 SKIP 时，脚本以顶层 `test-plan.md` 为 SSOT 校验 Hylyre 派生覆盖：派生表 TC 须与顶层 `execution_channel=hylyre` 的**精确集合相等**（缺一条 missing、多一条 extra 均 BLOCKER）。最新 coverage_reason、top/derived/missing/extra TC、选中/拒绝路径、源与派生原 mtime 及完整 lint/suggested_fix 在本轮 `script-report.json` 的 `device_test_run.structured.derive_hint`，NEXT 指向该原报告；不要读不再逐轮改写的 canonical hint 作当前诊断。**正式派生计划登记 `explicit_skip_tc_ids` 本身即 BLOCKER**，skip 也不减除任何缺口。含烟测占位标记的派生文件无效；多目录并存按 `test-plan.hylyre.md` 的 mtime 选最新有效派生。TC/真实派生上下文变化会更新源基线，旧派生仍须晚于基线且通过当前静态与 native 验证；只刷新 hint 或改时间不能证明修好。

**4.5.1 解析 TC 表**：打开 `<features_dir>/<feature>/testing/test-plan.md`，定位「测试用例清单」章节；读取第一条用例行表（列须覆盖用例编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC/**执行通道**）；每行建立工作项 TC-xxx。**执行通道是编译期分派的唯一真源**：值域冻结为 `hylyre|visual|manual:<gap_class>|provider:<capability-id>`，由测试计划作者声明并经 review。裸 `manual` / 未知 gap、未登记 provider、active 但无 per-TC producer 都是跑机前 `invalid_test`；固定已知 `manual:<gap_class>` 与 inactive/SKIP provider 才是 `unsupported_gap`。派生器**只编译 `channel=hylyre` 的全集**，不得新增、删除或改写通道，也不得产出 `explicit_skip_tc_ids`；缺列/缺值/非法值是一次性迁移要求（BLOCKER），harness 不按用例名、优先级或步骤散文替你猜通道。

**4.5.2 发现 selector**（按顺序尝试）：①`contracts.yaml`（components/资源键/UI 相关 id）；②`plan.md`（组件树/按钮文案/路由名）；③`doc/app-snapshot-cache/<bundle>/`（历史 `hylyre app page save` 页面结构，每次 `runHylyreDeviceTest` 结束后自动尝试）；④设备连线时用 `adhoc-device-test --dump-ui-only` 抓取当前屏候选（**禁止**在实例工程根直跑 `python -m hylyre dump-ui`）。**四级优先级只负责发现候选，不授予真值地位**；正式 `by_text` MUST 显式声明 `match: exact|contains`，由 acceptance 意图选择，禁止按数字/日期等字符特征启发式放宽，也禁止运行时 fallback。**feature ui-spec 是开放世界静态提示**：它只建模本 feature 新增页面，首页/卡包等既有入口天然缺席——`by_id`/`by_text` 不在 ui-spec 只给 `SELECTOR-SPEC-001` provenance **WARN 并放行**，最终合法性由本轮 native StepResult 的 selector evidence 裁决。静态 BLOCKER 只保留可确定错误：非法 selector/match、缺显式 `match`（`STEP-007`）、ui-spec 已证明的同屏多映射无消歧、`contains` 只命中带 children 的聚合 Text/Row，以及同一 checkpoint 结构化绑定的 `target_element_id` 与计划 `by_id` 明确不等。运行 `derive-hylyre-plan-hint` 可读 `selector_contract.entries[]` 查询 canonical 节点（**只是查询，不是白名单**；不要把 ui-spec ∪ acceptance ∪ contracts 合成第二套 registry）。**派生器没有 skip 决策权**：任一 `channel=hylyre` case 编译不了（含首个 assertion 前无同 case setup/navigation action，`STEP-SETUP`），就不产出可运行计划，改为回报该 TC 根因与下一责任阶段——不得写 `explicit_skip_tc_ids`。

**4.5.3 翻译为 Hylyre JSON**：每步译为单行裸 JSON（禁止 Markdown 反引号包裹单元格）；根键以 `planned_step_keys` 为准（touch/input/swipe/scroll/back/home/wait_for/assert_toast 等）；正式 `by_text` selector 每次都写 `"match":"exact"` 或 `"match":"contains"`，动态文本是否 contains 由 acceptance 意图判断而不是字符形态；推荐 canonical 直接根键形态（`{"touch":{"by_text":"…","match":"exact"}}`），`{"action":{"type":"touch",…}}` 为兼容形态勿混用；action 默认唯一性由 Hylyre 契约提供，需要消歧时只复用 `index`/`scope`/`within`/`all`；`start_app`/`stop_app` 只允许作为 case 首部恰好一组复位前奏（`{"stop_app":{"bundle":B}}; {"start_app":{"bundle":B,"page_name":P}}`，B/P 逐字取 hint 的 `reset_preamble`，不得自拟、不得用 `clear_app`；身份未解析时 hint 会标 `available:false`，此时不得写任何前奏），其它位置 STEP-003 BLOCKER；禁止 `dump_ui`/CLI 命令名作根键；同格多步用 `;`/`；`拼接（禁止 `<br/>`，格内禁未转义 `|`）；派生前可读 `derive-hylyre-plan-hint`/`derive-adhoc-hylyre-hint` 输出（hint JSON 内含 `allowed_step_roots`/`step_shape_catalog` 机读步骤目录，翻译时以此为准），`snapshot_cache_empty:true` 先 warmup 或 dump-ui；若步骤语法不在当前上下文（长会话被压缩后常见），翻译前重读 `profile-skill-asset:device-testing` 的 `reference/hylyre-planned-step-fields.md`。

**4.5.4 通道对账（无跳过清单）**：**不再维护「进入派生/跳过」两份清单**——派生器没有 skip 决策权，只对账一份集合：派生表用例编号必须与顶层 `execution_channel=hylyre` 的集合**完全相等**（多出即 extra FAIL，缺失即 missing FAIL），且不得登记 `explicit_skip_tc_ids`。非 `hylyre` 通道的 TC 由各自通道裁决：visual 走 per-TC 机器证据绑定；机器证明的 `manual:<known_class>` / inactive provider 是 `unsupported_gap`（留分母、不算 PASS）；裸 manual、未知 gap、未登记或 active 无 producer 的 provider 是跑机前 `invalid_test`。任一 `hylyre` case 编译不了就整份计划不启动并回报根因，不改写成 skip。

**4.5.5 落盘**：创建 `<features_dir>/<feature>/testing/reports/<timestamp>/hylyre/`；写入 `test-plan.hylyre.md`（锚点 `## 测试用例清单` + 7 列表头顺序固定，自 profile 模板拷贝表头）；同一 `user_actions.calls` 有多个 `ui` 入口时每个入口各派生一条用例，携带 `entry_ui`/`linked_flow`/`calls`（脚本 `ui_entry_coverage` 校验，P0 缺任一入口 BLOCKER）；随后触发 `harness-runner --phase testing --feature <feature>`（宿主顺序 build→install→ensure Hylyre→run plan）。**profile 为 generic 或 `device_test.run` SKIP**：跳过本节。

## Step 4.B 即席模式（ad-hoc·不绑正式需求）

0. **设备门由 CLI 自起**（无需 agent 手动前置）：执行 / `--dump-ui-only` / `--observe-ui` 三条碰设备路径（含随它们或单独使用的 `--install-current-build` / `--measure-screen`）启动时，`adhoc-device-test` 在首个设备命令之前自跑入口门并解析注入目标（stderr 锚点 `ADHOC_PHASE=device_gate`）；derive-only 不起门。门失败即不发任何设备命令——读 stderr 的 `reason`（`device_policy_unset` 时是四选一原文，按 [device-policy-gate](device-policy-gate.md) 处置）与 placeholder 的 `error_kind=device_not_ready`；**不得**为此手写解锁脚本或直调 harness 内部函数。
1. **Derive hint**（机械切分 NL + cache 提示，不跑机、不译 Hylyre JSON）：`npm run derive-adhoc-hylyre-hint -- --bundle <bundleId> --steps "…"` 或等价 `adhoc-device-test`（仅 derive，写 `derive-adhoc-last.json`，stderr `ADHOC_DERIVE_FILE=`）。关注 `snapshot_cache_empty`/`cache_layout_expected`/`cache_layout_mismatch`/`selector_hints`/`steps_file_contract`/`observation_steps`/`forbidden_in_steps`。
2. **Agent 写 Hylyre JSON**：读 derive 的 `steps_file_contract`/`step_shape_catalog`（可选 `steps_file_minimal_example`）。手写 `doc/features/_adhoc/testing/staging/test-steps.json`（探索/汇总类 NL 不进 steps）；**禁止**向 `framework/harness/` Write 即席 steps/trace/report；**禁止**向 `doc/app-snapshot-cache/<bundle>/` 根目录 Write page JSON。写后先 `npm run lint-adhoc-steps -- --file <path>`（可加 `--normalize`），通过后再跑机。
3. **执行**（勿手工拼 hdc/hylyre）：`npm run adhoc-device-test -- --bundle <bundleId> --plan path/to/test-plan.hylyre.md`（或 `--steps-file`）。执行报告永远落 `doc/features/_adhoc/testing/reports/<timestamp>/hylyre/`（stderr `ADHOC_HYLYRE_RUN_DIR=`/`ADHOC_TRACE_FILE=`）。可选 `--ability`/`--skip-explore`/`--accept-cold-start`（仅跳过 snapshot warmup）/`--skip-page-save`/`--dump-ui-only`/`--observe-ui`。默认 execute 冷重启（`hdc aa force-stop`+`aa start`）；保留 Nav 栈调试加 `--continue-session`。coding 返修窗口的局部诊断另有 `--install-current-build`（当前工作树出包并强制装机，构建结果与装机 meta 落 `_adhoc/testing/reports/`）与 `--measure-screen <screen_id> --feature <f>`（截图 + 布局 + 只读该 feature 的 ui-spec 量测，产物落 `_adhoc`）；这些是诊断，不是验收证据。
4. **观察汇总决策树**：touch 步骤只写到导航终点，禁止 steps-file 写 `dump_ui`；run 成功后 `--dump-ui-only` → `ADHOC_DUMP_UI_PATH=`（缺省落 `doc/features/_adhoc/testing/reports/dump-ui-<时间戳>.json`，不再写 `doc/app-snapshot-cache/<bundle>/`）；汇总用 `summarize-adhoc-dump` → `ADHOC_SUMMARY_JSON=`；或 touch-only NL 用 `--observe-ui --steps "…"`。
5. **进度锚点**：stderr 含 `ADHOC_PHASE=`/`ADHOC_RUN_DONE=`；run 结束先交付 cases 摘要再 dump/汇总。

**Hylyre 误导性报错对照**（即席必读）：

| 报错关键词 | 真实含义 | 先做 |
|-----------|---------|------|
| 「非 JSON」+ action 示例 | 步骤未识别为 JSON（常见反引号） | 去掉反引号；读 plan-lint.json |
| `--plan` 不能、`--steps-file` 能跑 | Markdown 表格格式问题 | 修正 plan 或改用 `--steps-file` |
| start_app/stop_app 相关失败（STEP-003） | 前奏不成对、不在 case 首部、多于一组、bundle/page_name 与 harness 预启不一致，或嵌套 action.type | 只保留 case 首部一组 `stop_app→start_app` 且身份逐字取 hint `reset_preamble`；其它位置删除；`action.type=start_app` 改直接根键或删除 |
| STEP-002 禁止 dump_ui | 观察型 NL 误写进 steps | 导航 run 后用 `--dump-ui-only` |
| `wait requires seconds` | wait 误用 timeout 或缺 seconds | 改用 `{"wait":{"seconds":N}}` |
| `Unsupported touch payload`/STEP-TOUCH | touch 嵌套 selector | 改用 `{"touch":{"by_text":"…"}}` |

其余约束：保留目录名 `_adhoc`；bundle 须对应用户明确的目标应用，优先从其工程配置解析，多候选才澄清；默认单 TC-001；步骤裸 JSON 数组不含 start_app；不跑 `harness-runner --feature _adhoc`；执行链 `ensureHylyreReady`→resolve ability→(可选)warmup→lint→run（禁止未 ensure 前让用户 pip install）；不写 receipt/verifier，交付 `trace.json cases[]` 摘要；ensure 失败读 `hylyre-doctor.log`/`hylyre-ready.meta.json` 后重跑；默认 run 后 `app page save`（`--skip-page-save`/`--observe-ui` 可跳过）；结果 SSOT 为 `ADHOC_TRACE_FILE=`/`ADHOC_DERIVE_FILE=`/`ADHOC_HYLYRE_RUN_DIR=`（禁止 glob timestamp）；execute 默认冷重启清 Nav 栈，非全 pass 后禁止假设仍在首页 Tab，`--continue-session` 显式保留，见 `ADHOC_UI_RESET_RECOMMENDED=1` 须去掉该参数或确认已冷重启；`--accept-cold-start` 只跳过 snapshot warmup不能代替冷重启；warmup 软失败仍继续 run（WARN）。

## Step 4.6 视觉 diff 回环（visual_diff · ui_change=new_or_changed 时）

> QA 阶段级动作（非 test-plan 派生 screenshot 步骤根键）。**唯一直接像素对图阶段**：参考图来自 spec `authoritative_refs` 或 `fidelity.lock.yaml` 快照（`buildAuthoritativeRefImageIndex` byId 联结 ui-spec `source_ref`）。

1. **前置**：`device_test.build`+`device_test.install` 已通过；Hylyre 可 screenshot。
2. **MVP 范围**：先覆盖可直达顶层屏；深层屏/overlay 由固化 nav 配置自动导航到达后再截——`<features_dir>/<feature>/device-testing/visual-diff-nav.json`（key=屏标识，value=到达步骤，复用 Hylyre planned-step 根键、不含 screenshot）。`visual_diff_capture` 有该配置时按屏导航到位再截，屏 id 经 X1 归一化匹配；页面结构无变化则复用不需重生成，仅屏/入口变更才更新；缺配置或与 ui-spec 屏集不一致→报错求补，不静默裸采。**P0 屏无论是否 `lightweight` 都必须被采集与评估**（lightweight 只对 P2/P3 生效，不豁免 P0 视觉门禁；曾有 P0+lightweight 屏被整个跳过、verdict=skipped 无人评估）。**某 P0 状态不可达是缺陷不是豁免理由**：须产出 must_fix「P0 状态 X 不可达，须可导航到该态后重采」，禁止以 skipped 放行。
3. **执行**：对每屏 Hylyre 导航+screenshot → 先断言屏身份（E3 防截错屏：确认截图呈现的就是目标屏——锚点＝该屏 `must_have_elements`/标题文案/导航态；不符即 `verdict=fail`+must_fix「captured wrong screen」，禁止在错图上做 diff）→ 双向 diff（正向=spec 声明元素；反向=参考图有实现无；G3 样式/布局核对：`variant`/`layout_group`/`align`/`width_ratio`/`bg_color` 须逐一对真机截图核对，不符进 must_fix（非硬像素契约下：自报 major 样式不符记 defects（major）并以 `must_fix_refs`（本屏 must_fix 的零基整数下标）引用写清修法的 must_fix，全引用才由 gate 降级记视觉债务：不回退、仍阻断发布；纯 minor 只记 defects（minor）披露，不因此新写 must_fix）；渲染缺陷枚举：逐屏登记 `defects[]`——裁切/重叠重复/形态版式不符/声明 asset 未渲染，每条带 `bbox`（相对本次 device_screenshot 的归一化 `[x,y,width,height]`，四项为 `[0,1]` 有限数，不用像素坐标）+`severity`(blocker|major|minor)+`note`，`missing_render` 另须带 `ref_element`=参考图侧缺失元素在 `spec/ref-elements.yaml` 的 `element_id`（`element` 只是锚点；指向 `excluded` 的不返修，未登记的只 WARN 交 spec 澄清，缺 `ref_element` 判证据不全须重评，其余类缺 `element` 同判；实现渲染了目标不要的内容（含 `excluded` 元素）记 `unexpected_render`，带 `element` 或 `bbox`、可带逐字 `requirement_quote`，锚在 `excluded` 元素上或引文逐字才返修，否则只披露）（blocker=有具体证据表明当前范围/状态下的必需目标、关键操作、导航或状态理解无法成立；major=明显视觉或交互偏差，但主要任务仍可完成、信息仍可理解；minor=局部细节偏差，不影响操作、含义和可读性。`note` 说明实际影响、定位/证据和不确定性；单张截图看不到不证明操作不可达）；**verdict=pass 须 defects 为空且无 reverse_missing 残留；pixel_1to1 P0 屏在**有 delegated 视觉 provider 时**须附 `region_attest[]` 逐区域举证（无 provider 时 harness 按无 provider 场景 SKIP 并在 details 标 `[no_provider]`，不作要求——见本节第 5 条）**——每 must_have_elements/zone 一条 `{region, verdict: no_diff|diff_logged, method: paired_crop_compare|vl_screening, evidence?, by}`；legacy `method: human` 可读但不计覆盖、不改变 verdict；**method=paired_crop_compare 须先物化并排对照 crop 到 `device-screenshots/_attest/<screen>_<region>.png`（参考图/实测图各裁对应区域），且 critic 写 verdict 前必须逐屏 Read 对应 _attest crop（成对图强制入模，t7——先裁图再凭记忆填表=违规）**；paired 条目存在时须写 `device-testing/reports/critic-receipt.json`（critic_run_id/prompt_hash/input_provenance/image_inputs[]+hash；交互态无法证明注入 → 如实 `input_provenance: unverified`）→ 产出：
   - `<features_dir>/<feature>/device-testing/device-screenshots/visual-diff.json`（每屏 `reverse_missing[]` 逐元素枚举+`defects[]`；`score_floor` 含 N×N 分块最小相似度；`edge_tile_divergence`/`edge_over_threshold_tiles` 由采集层自动写入——超阈 tile 未被任一 defect.bbox 覆盖会触发边缘哨兵 WARN，须补对应 defect 或复核该区域）
   - `<features_dir>/<feature>/device-testing/visual-diff.md`（由 harness 从 visual-diff.json 自动生成，含「采集完整性」节；**请勿手改**——所有结构化结论一律填进 JSON，md 每次采集后无条件从 JSON 再生并覆盖任何手写内容，门禁结论始终以 JSON 为准。曾出现 md 手写"6 屏 hash 均已唯一"而 JSON 实为 5 屏同 hash 的谎言——现已根治）
   - **T7 证据 rubric**（pixel_1to1 P0 pass 屏）：判 pass 前逐关键元素记录当前机器证据，是 pass 的举证责任而非凭总分自报。客观度量不足时使用当前、hash-bound 的 native/delegated 视觉证据；能力不可用则诚实 capability defer，证据无效则 FAIL/retry，不以人工确认兜底。
4. **A/B/C 边界**：C 类动态交互不在静态参考图承诺内；B 类美术资产取决于素材供给。
5. **回修（critic 自动迭代，plan c6d8f2b4 t9——替代旧"MVP 单轮+人工决定是否再迭代"）**：独立 critic（与实现者分离的上下文：交互态=Task verifier subagent，goal 态=独立 critic phase/prompt）产出 must_fix → coding 修 → 重采重判，**自动迭代直至 candidate-pass 或熔断**，不再每轮停下问人。must_fix 必须可执行可定位——带元素/区域+期望态的指令，关联具体 element_id 或区域 bbox；禁止「整体差异大/不够还原」这类无法回修的空话。
   - **candidate-pass 定义（五条件）**：无 BLOCKER/major defect + must_fix=[] + 必需 region_attest 与 critic 回执有效（**"必需"由是否有 delegated 视觉 provider 决定**——无 provider 时这两项不作要求，见下段） + T8/M1 无未处置命中（T8 布局树未接入的宿主按既有确定性信号集 T1/T4/T5/P1-C/dedup 计）+ advisory/minor 已枚举。critic 回执 `input_provenance=verified` 才能满足要求 verified 的发布策略；unverified 是否可继续只由现有 quality-axis/release policy 决定，不新增人工终审。**无 delegated 视觉 provider 时**（plan 07a41ec6 T10）：region_attest / critic 回执类证明不作要求（harness 按无 provider 场景 SKIP 并在 details 标 `[no_provider]`），几何事实用 `--measure` 取得，agent 实际看图后给普通视觉判断；content/style 未验证部分如实标 UNKNOWN，功能完成不因视觉证据不完整被阻止，release_readiness 如实保持。
   - **熔断（no-progress 指纹化，f7a3d9c2 起机器化）**：must_fix/defect 折算稳定指纹 `screen_id+defect_class+element/region+bbox_bucket` 比对集合（禁止自然语言字符串比对——同义改写会逃逸）。**（pixel_1to1）机器判定已接管**：每有效轮进 `device-testing/reports/visual-rounds.ledger.jsonl`（runner 机器盖戳，check 只读比对）——交互态 harness 直接写；goal 态执行者自检（有人在场与无人值守同一角色）先写本 run 的 journal，由 runtime 在正式 gate 前顺序收编入账本，正式 gate 自己那轮同状态即 duplicate；连续两有效轮指纹集相等且仍有 loop-actionable 残差 → BLOCKER `visual_diff_no_progress_fuse`（归因 `no_fix_attempt`=跑了没修 / `ineffective_fix`=修了没用）。见到该信号即熔断：停止改措辞重试，保留残差并诚实终止或由新 correction/successor run 继续；也**禁止未改码/未重建就原地重跑 harness 刷轮次**（同状态重跑被账本幂等吞掉，不算迭代）。**严禁删改 visual-rounds.ledger.jsonl**——goal 态 events 反向对账会以 `visual_ledger_integrity` 拦下，删账本≠空历史。指纹入账资格=每条 must_fix 有结构化 defect 锚定（`must_fix_refs` 逐条引用；T8 发现须以 `source.finding_id` 转录进 defects——门禁 `visual_diff_finding_transcription` 附可照抄模板）。
   - **candidate-pass 前不得请求质量确认**；确定性 fail 必须形成 repair 并重验，不得借“等用户/等 critic”拖延或签掉缺陷。
6. **降级**：warmup/无设备 → harness `visual_diff` SKIP，按 required/optional 轴投影 capability defer 或 advisory。**分数字段语义（t4，plan c6d8f2b4）**：`fidelity_score`/`geometric_iou` 已更名 `reported_fidelity_score`/`reported_geometric_iou`（legacy 名读入自动映射）——**VL 参考自评、零 gate 权重**；旧 lowScorePass/灾难地板不再消费自报值（真算几何值接入前 SKIP+注记）；pass 的举证责任=region_attest+defects 枚举+确定性信号，非分数。`pixel_1to1` 下以下情况一律 BLOCKER：must_fix / reverse_missing / defects(blocker|major) / 缺 defects 逐屏枚举 / **P0 pass 屏 defects=[] 无 region_attest(t5)** / **attest 声称 paired_crop_compare 但证据 crop 缺失** / **critic 回执无效或 image_inputs 未覆盖 attest crop(t7)** / **M1 自报退化（命中屏写 `evaluation_invalidated:true` 由独立 critic 重评后清标记）** / **evaluation_invalidated 未清** / **T8 布局不变量 hard 命中** / P0 warn 屏 must_fix 空(T4) / 全局元素越界(T5) / P0 pass 屏声明锚点文本整块缺失(T1) / **文本块结构背离(P1-C)**。当前 hash/attempt/identity 绑定的 deterministic/native/delegated 机器证据决定结论；legacy `confirmed_by` 可读但无 gate 权重。`score_floor` 仅作 reference_only 注记。

   **视觉裁判可信化**：`pixel_1to1` 最严档只接受当前截图/build/attempt/identity 绑定的 deterministic/native/delegated 机器证据。provider 能力缺失时 required 轴诚实 defer；provider 声明可用但载荷缺失、无效或 stale 时按普通 FAIL/retry，不能伪装能力缺失。OCR 不可用时按轴要求投影，不静默。边缘哨兵超阈 tile 未登记 → WARN（低置信、非 gate）。**verdict=warn 的语义＝"有残差、需再修一轮"**：P0 硬像素契约（pixel_1to1 ∧ hard）warn 屏必须带非空 must_fix；defects/reverse_missing 只是证据、不替代 must_fix。残差可接受且机器证据完整才判 pass。

   **禁止弃判**（门禁 `visual_diff_verdict_abandonment` 硬拦）：harness 报出 `visual_diff_text_placement` fail_signals 的屏＝headless 可判——必须 `verdict: fail` + 把信号逐条抄进该屏 `must_fix`。**修码不在 testing 内进行**：testing 禁止写产品源码，runner 消费非空 must_fix 自动回退 coding 修复后重走 review/ut/testing。不得以“无人值守不可闭环”为由留 pending；确定性 FAIL 在手还全屏 pending 只会烧空预算。

   **结构声明验真分工**（诚实边界）：文本类由确定性信号覆盖；非文本类（tab 容器视觉/分组容器/独卡边距）由 coding 台账、独立 review 和当前 hash-bound 视觉 provider 证据共同验证。能力不足时 capability defer，载荷无效时 FAIL/retry；不得把不确定项留给用户签字改判。

   **判定持久化**：pass/warn/fail 机器判定绑定「被评截图文件 hash + build 指纹（实际 hap sha256）」——同一构建下可跨 harness 轮复用；改码重装（hap 变）→ 自动失效重判。legacy `confirmed_by` 仅保留字节、不参与复用或 gate。别手动 reset visual-diff.json 求“刷新”——那是改判脚本红线。

   **布局校准**：宿主一句话触发 `npm --prefix <harness> run layout-oracle-calibrate -- --feature <feature> [--device --python <hylyre python>]` → `device-testing/reports/calibration.json`+报告 md。校准只消费版本化机器 fixture 与设备测量；不得读取人签反馈台账或直接改写当前 run verdict。

   **交付后 UX 反馈**：用户若发现视觉不一致，把问题作为 correction/successor run 的需求输入，按责任阶段重新执行机器门禁；不得回写上一 run 的 `confirmed_by` 或 verdict 来改写其完成证明。
7. **采集新鲜度**（E1/E2）：P0 屏截图失败（Permission denied/锁屏/设备占用）或 `screensWritten=0` 全靠 `preserved` 旧 json 充数时，`visual_diff_capture` 在 `pixel_1to1` 下 FAIL（否则 blocking WARN）——不得沿用陈旧/错图证据闭环，须修复采集后重采 P0 屏。

## Step 5.1 读取 harness 生成的测试报告

1. harness 从同一权威 run 的 trace、timing、meta、视觉证据与 stability 生成完整 `test-report.md`，包含耗时、执行状态、缺陷、统计与逐轴结论；agent 不手工拼表或计算结论。
2. agent 只读机器报告和 summary 的 blocker/gap；补充观察写 `testing/notes.md`，不改报告、trace 或机器统计来改变裁决。
3. known `manual:<gap_class>` / inactive provider 的 `unsupported_gap` 留分母、不算 PASS，披露后可以完成普通开发；裸/未知 manual 与 active 无 producer 等 `invalid_test` 仍需修正。

**报告重算**：run 已有 trace 时，可直接执行 `--report-reconcile-only --phase testing --feature <feature>`，无需 agent 预先写报告。harness 读取既有权威证据，重生成报告、重算 report/static checks、summary 与 quality axes；不调用 hvigor、hdc、Hylyre、设备、视觉采集或 executable lifecycle hook，也不改 trace 字节。

## 红线：测试接缝与 P0 覆盖（goal-fakepass-hardening，BLOCKER）

- **测试接缝不得改变用户可见流程/默认行为**：`*_FAST_PATH`/`DEVICE_TEST*`/`SKIP_SMS*` 类
  开关默认 `true` = `product_behavior_switch_scan` BLOCKER（bc-openCard 事故：点银行直写卡
  跳结果页）。可测性接缝限 `.id()` 锚点等**不改行为**的改动——且 review 闭环后任何产品
  源码变更都会由 `review_closure_attestation` 分级列出所需的一次复核，未复核时如实标注。
- **P0 用例 skip 证据边界（c7e4a2d9 / testing-stepresult-evidence-consumption）**：
  未执行的 P0 → `p0_coverage_integrity` BLOCKER（fail-closed 不变）。没有
  `CaseResult.steps[]` 的未执行缺口保持 testing-owned FAIL、零自动 coding
  candidate；不得按 TC 名称、关联 AC 或报告散文猜原因。只有既有 capability resolution
  以机器事实证明 provider 缺失时才走 DEFERRED。`code_regression`/coding candidate 只
  绑定已执行且有冻结 `StepResult(outcome.status=failed + outcome.failure.domain=assertion)`
  的机器证据；旧 `p0_skip_waiver` receipt 只读且不改变 verdict，P0 未执行不能降级为 WARN。
  通过率必须双口径（skip 计入分母），存在 P0 skip 时结论不得无条件「达标」；不再有
  `await_human_p0_skip` 首触求人 halt。
  **legacy（只读诊断，不可复制）**：历史产物中的 `explicit_skip_tc_ids` 与上述"未执行"
  同等对待——只用于解释历史 run，不贡献 PASS、不产 coding candidate；新计划与派生器
  一律禁止写入（见 Step 4.5.4）。
- **P0 native 证据对账**：Hylyre `0.5.0+`、trace `schema_version=0.4-p0` 且
  `result_protocol=hylyre.step-outcome/1`（Step Outcome v1）时，
  `CaseResult.execution=completed`、`verification=passed`、`evidence=complete` 只是必要条件；
  每个 checkpoint 的 required 元素必须映射到同 index 的
  `role=assertion` 且 `outcome.status=passed` 的 presence StepResult
  （`observation.assertion_type=presence`、`observation.facts.observed_present=true`），
  forbidden 元素必须映射到 `wait_gone` 的 absence StepResult
  （`observation.assertion_type=absence`、`observed_present=false`、`candidate_count=0`）。
  action-only、inconclusive、incomplete、旧
  status 或报告散文均不得进通过分子。普通 interactive 与 goal 同源消费；goal 的
  run/attempt/HAP/device identity binding 仍保留。实际执行的 derived plan、top plan 与 trace
  路径/SHA 也必须通过既有 run/identity receipt 闭合，不能用后来修改的派生计划重解释 trace。
- **失败归因与 legacy**：责任路由**只消费实际执行且 `outcome.status=failed` 的步骤**，失败事实读
  nested `outcome.failure.domain/code/facts`（禁止读 flat `status`/`failure_kind`/`failure_code`
  重建）：`assertion.mismatch` 回 coding（且须同 case 存在较小 index 且 `outcome.status=passed`
  的 action，否则留 testing），`selector.*` 回 testing 重派生/消歧，`capability.*` 走 capability
  defer，`infrastructure.*` 回 external/toolchain。未尝试的步骤**不生成 failure route**：
  `outcome.status=blocked` 的原因读 `outcome.cause`——`cause.type=capability` 只投影 1 次
  capability defer，`cause.type=infrastructure` 只投影 1 次 external/toolchain disposition，
  `cause.type=prior_step` 零 route 零 disposition 且不按被引用次数重复投影；
  `outcome.status=skipped` 的原因读 `outcome.reason`，`reason.type=policy` 不产生 capability defer。
  无 StepResult 的未执行 case 保持 testing-owned FAIL、零自动 coding。三重判据任一不满足时标记
  `legacy_assertion_evidence_untrusted`，默认升级后重跑；既有完整 telemetry 只能证明其实际采到的
  特定 checkpoint，不生成通用 CaseResult.steps[]。
- **selector 两层门（开放世界）**：静态门只拦可确定错误——非法 selector/match、缺显式
  `match`、ui-spec 已证明的同屏多映射无消歧、`contains` 只命中聚合 Text/Row、同一 checkpoint
  结构化 `target_element_id` 与计划 `by_id` 明确不等。selector 不在 feature ui-spec 只给
  provenance WARN 并放行（既有入口本就不重复建模）。运行时只认本轮 StepResult 的
  `selector.request` / `selector.resolution`：`resolution.state=unique` 且有真实 selected
  target 才通过，0/多候选无真实消歧一律拒绝；`resolution` 只提供身份事实，**成败仍由
  `outcome` + `observation` 裁决**（`not_attempted` 既不判败也不给身份 credit）。禁止
  exact→contains fallback、父 Text/Row 中心点击、OCR 与坐标估算。静态/runtime/P0 共用
  planned-step normalizer。
- **mock 数据可辨识**：多实体场景（多卡/多账户）各实体可见身份（掩码后卡号等）必须唯一
  可区分——掩码口径要避免「前 4+后 4 恒相同」（bc-openCard：全部卡显示 6225 **** 0001）。

## Step 6 质量门禁自检完整清单

**测试计划自检**（11 项）：必需章节齐全；用例清单表头含编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC；优先级仅 P0-P3；每条 device/both AC 至少 1 条 TC（步骤对齐 device_focus）；device/both P0/P1 AC 100% 覆盖；unit AC 已从计划剔除；测试步骤足够详细可重复执行；预期结果可观察可验证无模糊描述；测试环境含设备/系统版本/API 版本；通过标准含量化阈值；元数据（模块标识/版本/日期）齐全。

**测试报告自检**（8 项）：必需章节（测试概览/执行结果/通过率统计/结论）齐全；执行结果表含用例编号和执行状态；状态值仅通过/失败/阻塞/跳过；各优先级与总体通过率计算正确；结论与通过率数据匹配；失败用例都有对应缺陷记录；缺陷关联用例编号在用例清单中存在；报告用例编号与计划一一对应。

不通过项定位后自动修正重新自检，直到全部通过。

**页面身份与内容验收分工**：复用 visual-diff-nav 的 identity.all_of/any_of/none_of；用稳定 screen/root、route、标题等区分页面，sms_next 这类待验收按钮留在 ui-spec required 与原生业务断言。目标页身份通过但按钮被键盘遮挡/缺失，仍是内容失败，不能隐藏键盘或删业务断言来满足身份。旧 nav 把按钮放 all_of 时，读取原配置和 _identity dump，由 testing 修自己的导航规则后重新判页；gate 不自动删除失败成员。真错页或锁屏不落目标页正式截图；命中其它应用组件 id 只证明应用树在场，不能断言一定是其它页。

**视觉 provider 局部纠错**：同 gate 调用成功而 payload 不合法时，harness 把原body及精确屏/字段/索引错误回给同一冻结provider，最多纠正一次；两次共用原provider timeout与gate剩余deadline的较早截止，独立留原输出/usage/诊断，check structured与NEXT指向诊断。执行者不手改provider证据、hash或region verdict。原图/来源图/导航/目标/HAP变化回原采集/装机/trace路径；局部纠格式不重跑native或capture，也不能洗绿同gate已有native FAIL。IO只重试原提交事务，不让provider重判产品；第二次仍非法或预算不足保留invalid/清场状态，下一整轮真实产品复验仍走原契约。

## 正式 Feature/CU 阶段

以下仅在本次明确承担 Feature/CU 交付责任时加载；普通方法调用与独立 request 不进入这段。

## 前置

**以下前置只适用于正式模式**；即席与设备就绪按上方分流表。本工程须先完成 [`framework-init`](../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](host-harness-readiness.md) 与 [Shell cwd 契约](harness-cli-cwd.md)；宿主打包/装机/设备工具链以本 Skill 的 profile addendum（Tier_2）为 SSOT。**Personal setup（BLOCKER）**：[personal-setup-gate](personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。**设备策略（BLOCKER）**：[device-policy-gate](device-policy-gate.md)：`npx ts-node scripts/device-policy.ts --check --json`（**判定两段**：退出码 0 且 stdout 合法 JSON → 看 `code`；非零或非法 JSON = 执行失败须停止，含**凭据库不可读**，不得当成"未配置"引导重新登记）；**只看 `code` 不看 `configured`**（坏凭据/只有 `disabled` 时 `configured=true` 而 `code=unset`）；harness-runner 在需设备 phase 另有进程级入口门（同一 `code`，设备操作前 fail-fast + 目标解析一次注入全链）作兜底；`code=device_policy_unset` 就**先问用户四选一**再碰设备（选 ③ 须追问 `existing`/`managed`，禁默认托管）。与 goal 模式同一契约；PIN 只能由用户在自己终端登记，**绝不进对话**。即席 CLI 与 `device:ready` 已内置该门，agent 不必手动先跑 `--check`；unset 时 CLI fail-fast 透传四选一文案，agent 再用 registry `setup.device_policy` 问用户。**视觉能力自测（UI 相关需求·交互式）**：personal-setup `ok` 后按 [interactive-vision-canary](interactive-vision-canary.md) 后台跑自测卷判卷 CLI（防死锁编排逐步照做）。

**以下三项（归档定位 / Resume Gate / 输入矩阵）同样只适用于正式模式。Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`；只有精确目录是正式 feature，同名归档/前缀条目只是旁证。 `<feature>` 语义见 [路径术语表](agents-entry-detail.md)（物理 Feature 路径）；定位一律经框架解析（CLI/SSOT/harness 产物路径），不得手工拼接逻辑 identity（含编码 `cu-…`）。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。展示输入矩阵（spec/plan/acceptance/contracts(可选)/use-cases(可选)/test-plan(本阶段产出)）；legacy `device-testing-todo.md` 存在仅 WARN 迁移提示，不得作 SSOT；输入缺失回上游补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/device-testing/profile-addendum.md` 时先读（宿主 toolchain/打包装机/设备探测细则）。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](agent-behavioral-principles.md)。
- **Step 1.5 打包装机协议 / Step 4.5 Hylyre 派生计划全套 / Step 4.B 即席模式全套 / Step 4.6 视觉 diff 回环（含全部事故派生判裁规则）/ Step 5.1 机器报告读取 / Step 6 自检完整清单**：完整读 [device-testing-workflow-detail.md](device-testing-workflow-detail.md)。
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

## 概述

按当前 `project_profile` 自适配的设备/系统测试工程师：先用共享用例设计方法，再按 acceptance 标准与 Spec 契约生成正式测试计划，执行后产出标准化测试报告。流水线**第六环（最终环）**，上游 business-ut 的 DAG 和 UT 代码，输出是功能模块质量交付的最终把关。

**Goal/headless 写边界（BLOCKER）**：只写 testing/device-testing workspace 与本阶段 contract `produces`，不得修改需求 SSOT、plan、产品源码或 UT。缺测试锚点或验收契约错误时写入结构化缺陷，由 runner 自动回对应 owner。runner 按 invoke 前后哈希归因：改写**已登记的上游 artifact**（需求 / 验收 / 契约等）时本轮证据作废并自动回 owner 全量重验；其余变化记录为观测事实，由本就负责它的 check 裁决（范围、漂移、闭环门）。无法唯一定位 owner 不再终止 run，也不因此豁免上述 check。 本阶段若改了产品源码，`review_closure_attestation` 会分级列出所需的一次复核并如实标注未复核。

## 触发条件

"真机测试"、"设备测试"、"测试计划"、"写测试报告"、"生成测试报告"、"系统测试"、"功能测试"、"验收测试"、"测试方案"、"编写测试用例"、"解锁手机"、"唤醒设备"、"设备准备好了吗"。

## 核心理念

**从 `acceptance.yaml`（`ut_layer` + `device_focus`）派生 test-plan → Hylyre/真机执行 → 结构化报告 → Harness 验证闭环**。business-ut 验证 UseCase/state/port 的业务逻辑正确性；真机测试验证**端到端用户体验**。AC/BD 按 `ut_layer∈{unit,device,both}` 分层：`unit` 已由 UT 覆盖本 Skill 不重复；`device` 须由本 Skill 真机覆盖；`both` UT 覆盖业务侧，本 Skill 补做 UI 侧（Toast/跳转/渲染/交互）。真机要点以 `acceptance.yaml` 的 `device_focus` 为 SSOT（spec 阶段写入）；business-ut 可选产出 `ut/reports/ac-coverage.json`，**非** SSOT。

## 输入（正式模式）

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 定位文件 |
| spec.md / plan.md | 可选 | 现代调用仅按实际消费读取叙述文档 |
| resolved acceptance | ✅ | 物理输入或 P3 等价投影，经同一分层检查，作为 test-plan 来源 |
| use-cases.yaml / contracts.yaml / doc/architecture.md | ⬜ | 了解 UT 已覆盖分支/模块边界/架构全貌 |
| review-report.md | ⬜ | 可选，确认代码已通过 Review |

**缺 device_focus**：对 `ut_layer∈{device,both}` 的 AC/BD，提示回 spec 阶段补全（`acceptance_device_focus_present` BLOCKER）。**缺 acceptance.yaml**（仅正式模式）：提示先运行 spec 阶段；即席与设备就绪不需要它。

## 正式流程骨架

先执行本页共享方法，再履行下列正式输入、产物和闭环责任；不复制另一份方法。

现代调用先消费 P2 冻结范围：全 unit 且有效影响依据已明确无设备/视觉义务时不进入 testing，不生成 test-plan/test-report。performance 复用 ut_layer；unit 项交 UT，device/both 项须有 device_focus，缺层级/方法仍 unknown。`--report-reconcile-only` 对已验证的零 testing 范围只输出诊断，不要求 trace、不写报告、不调用设备；有 testing 义务仍走原对账。设备离线、manual、provider/图片缺失不能改判 N/A。

1. **Step 1 收集测试上下文**：确认模块名（`testing.module_name`：`1=确认` `2=修改`）；读 acceptance/spec/plan/use-cases(若有)/contracts(若有)/architecture(若有)；按 ut_layer 统计范围展示给用户（device AC 数/both AC 数/unit AC 数/边界场景/非功能性需求）。**Context Facts Gate（BLOCKER，C4）**：追加 `<features_dir>/<feature>/context/facts.md` 的 `## phase_delta: testing` 节（无新增事实写 "none"；缺节或空节会被披露并计入完成缺口，不单独阻断）。
2. **Step 1.5 准备打包与装机**（`device_test.build`/`device_test.install` 为 BLOCKER 时，详见 reference）：读宿主 addendum → `testing.packaging` 确认 product/buildMode → 先完成下方测试计划与静态通道/R8 检查，零 BLOCKER 后才经原 provider build/install；不先跑设备再审计划。
3. **Step 2 生成测试计划**：模板 `templates/test-plan-template.md`，**须含 6 章节**：测试范围/测试环境/测试用例清单(表格：编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC)/测试策略/通过标准/风险与依赖。**用例生成规则**（v2 ut_layer 感知）：每条 device AC → 至少 1 条用例（步骤来自 device_focus）；每条 both AC → 至少 1 条用例，关注点限定 UI 层；`criteria` P0/P1 各生成 1 条、P2 可选；`boundaries` 每个边界场景 1 条；`performance` 仅 device/both 项各生成验证用例，unit 项交 UT、缺层级先澄清；`ut_layer=unit` 不再生成。用例编号 `TC-{NNN}`；步骤须明确可重复；预期结果须可观察可验证；追溯字段另记 `linked_flow`/`linked_branch`/`ut_layer`。
4. **Step 3 用户确认测试计划**：`testing.plan_confirm`：`1=确认` `2=修改`。
5. **Step 4 归档**：`<features_dir>/{module-name}/testing/test-plan.md`。正式派生前先运行 `cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`，读取本次 stdout 的完整派生上下文，再生成派生计划。canonical `derive-hint-from-plan.json` 仅在 TC/执行语法/reset 等真实派生输入变化时更新；标题、缓存与诊断变化不刷新基线。最新覆盖、选中/拒绝路径、mtime、逐条 lint/suggested_fix 读取本轮 `script-report.json` 的 `device_test_run.structured.derive_hint`，勿从旧 hint 猜本轮诊断。需要最新缓存/selector 候选的文件时用 `--out <另一文件>` 显式导出；`--out` 指向 canonical 仍按语义幂等写入。不要等 harness 失败才生成 hint。
6. **Step 4.5 真机自动化派生可执行计划**（`device_test.run` 为 BLOCKER 时，详见 reference）：解析 TC 表并读取每条 TC 的**执行通道**（`hylyre|visual|manual:<gap_class>|provider:<capability-id>`，顶层 test-plan 声明、经 review，缺列/缺值/非法即 BLOCKER 一次性迁移）→ **只编译 `channel=hylyre` 全集**，不得新增/删除/改写通道，也不得写 `explicit_skip_tc_ids` → 按 contracts/plan/snapshot-cache/设备连线四级优先级发现 selector 候选（四级只负责发现；snapshot-cache/设备 dump 不是真值）→ 正式 by_text 必须显式声明 `match: exact|contains` 且由 acceptance 意图决定（禁止字符启发式/运行时 fallback）；feature ui-spec 是开放世界，selector 缺席只 WARN 放行，静态只拦可确定错误 → 译为 Hylyre JSON（裸单行、canonical 直接根键、禁 dump_ui 等 CLI 名作根键；`start_app`/`stop_app` 只允许作为 case **首部**恰好一组复位前奏 `stop_app→start_app`，bundle/page_name 逐字取 hint 的 `reset_preamble`、不得自拟、不得用 `clear_app`，其它位置 STEP-003 BLOCKER），每个 case 首个断言前必须有同 case 的 setup/navigation action → **任一 hylyre case 编译失败即整份计划不启动**，回报该 TC 根因与下一责任阶段（不改成跳过）→ 落盘 `test-plan.hylyre.md` 到 `testing/reports/<timestamp>/hylyre/` → 触发 `harness-runner --phase testing`。**manual/provider 三态**：`manual:<system_settings|perf_sampling|memory_sampling|resource_variant|data_injection|external_precondition>` 且工具确无原语、或 inactive/SKIP provider → `unsupported_gap`（留分母、不算 PASS）；裸/未知 manual、未登记 provider、active 但当前无 per-TC producer 的 provider → 跑机前 `invalid_test`。Hylyre 原语能表达的一律改 `hylyre`；不接受人工确认/receipt 把 gap 洗成 PASS。
7. **Step 4.B 即席模式**（详见 reference）：Derive hint（不跑机）→ Agent 写 `doc/features/_adhoc/testing/staging/test-steps.json` 并 lint → 执行 `adhoc-device-test`（默认冷重启）→ 观察汇总决策树 → 不写 receipt/verifier，交付 trace.json cases 摘要。
8. **Step 4.6 视觉 diff 回环**（`ui_change=new_or_changed` 时，详见 reference）：唯一直接像素对图阶段；MVP 覆盖顶层屏+固化 nav 配置到达深层屏/overlay；P0 屏无论 lightweight 与否必须采集评估；执行时先断言屏身份(E3)再双向 diff(正向/反向+G3 样式核对+defects 枚举+**region_attest 逐区域举证**)；采图同时点 dump 布局树(`layout-<screen_id>.json`)供 **T8 几何不变量**消费；产出 `visual-diff.json`(唯一结构化真源)+自动生成 `visual-diff.md`(请勿手改)；`pixel_1to1` 下 T1/T4/T5/P1-C/**T8(布局 hard)/M1(自报退化)/attest 证据/critic 回执**等机器信号任一命中即 BLOCKER（分数字段=reported_* 参考自评、零 gate 权重）；回修由独立 critic 自动迭代至 candidate-pass 或指纹化熔断。当前 attempt/hash/identity 绑定的 deterministic/native/delegated 证据决定 visual 轴；legacy `confirmed_by` 无 gate 权重。确定性 fail 信号必须 verdict=fail+逐条写进 must_fix，不得弃判；testing 禁止写产品源码/需求 SSOT，runner 消费 must_fix 自动回退 coding 修复后重走 review/ut/testing（非硬像素契约下自报样式残差由 gate 降级记视觉债务：不回退、仍阻断发布）。 几何事实用 `harness-runner.ts --measure --feature <feature> [--screen <id>]` 一条命令取得（bounds/间距/重叠/与参考图差值/取色，写 `device-screenshots/measure-<screen>.json`，并把量测事实补进 visual-diff.json 的 defects[].note）；它只测量不裁决，不改 ui-spec，不改 verdict，geometry PASS 不解除 visual/release block；无 delegated 视觉 provider 时不要求 region_attest / critic 回执，agent 看图后给普通视觉判断，content/style 未验证部分如实标 UNKNOWN。
9. **Step 5 读取机器测试报告**：`test-report.md` 由 harness 从权威 run 的 trace/timing/meta、视觉证据与 stability 整份生成，统计与逐轴结论均由机器派生；agent 不手工回填状态、耗时、表格或计算结论，只读结果并把补充观察写 `testing/notes.md`。known gap 留在分母、不算 PASS，披露后可完成普通开发。能力缺席（如视觉 provider 不可用）= 有条件达标 + 暂缓 gap：相关 visual TC 记「跳过」并注明未验证（能力缺席）、留分母、不列待修缺陷，阶段裁决 INCOMPLETE 等待外部条件；能力恢复后重新发起同一请求由同一检查重验，不改产品、不按失败重试。需刷新已有证据的报告时运行 `--report-reconcile-only --phase testing --feature <feature>`，由 harness 重生成报告并重算 report/static checks、summary 与 quality axes；零设备/hvigor/hdc/Hylyre/视觉采集/lifecycle hook 调用，不改 authoritative trace。修复以机器 blocker/repair candidate 为准，不通过手改报告洗绿；即席模式不强求写 test-report.md。
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

**AI Harness**：harness 输出 verifier request 时，主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权），prompt 模板 `framework/harness/prompts/verify-testing.md`（测试用例完整性/步骤可重复性/预期结果具体性/NFR 覆盖/缺陷严重程度一致性/通过标准与结论一致性）。 verifier 的 WARN/UNKNOWN 本轮不修（记入 `<phase>/notes.md` 带到下一阶段），只有 **BLOCKER 级 FAIL** 才触发修正与重审；材料未变时 harness 复用既有 verifier 报告，材料变了但历史有 PASS 时闭环标 `completed_with_prior_review`（不重跑 verifier，未重审差异登记在 `summary.verifier_closure`）。

**Task prompt = harness 写出的短 request JSON 整段**（plan a9d4e7c2）：verifier 能力启用时，`harness-runner` 会在结尾打印 `verifier.request.<subject>.json` 的路径，并把它记进 `summary.verifier_request`。把**那份 JSON 的完整正文**作为 Task prompt 投给 verifier——verifier 自己按其中的 `prompt_path` 读磁盘原件（`ai-prompt.md` 可达上百 KB，不过传输面）。不要投递 `ai-prompt.md` 全文、不要手抄或改写任何字段、不要在 JSON 前后附加说明：subject 由字段重算，抄错一处即失配 → 阶段不闭环。

**报告由你写入，不是 verifier 写**（plan d2f7a9c4）：verifier 返回后，用 Write 把它的回复**原样全文**写进 `summary.verifier_report` 指向的路径（`<reports>/verifier.report.<subject>.md`），再跑 `check-receipt`。不摘要、不只贴终态块——正文里的发现是 repair candidates 与多模态审查的输入；只有终态块的报告能通过校验，却会把这些全部丢掉。

**harness 没有输出 request 时先看 `summary.next_action`，别急着下结论**：①能力未启用（policy/workflow/profile 判定）→ 本阶段就没有 verifier 这一环，不要去找、不要补造，闭环也不要求它；②当前 adapter 未登记 `verifier_subagent`（起不了 verifier 子代理）→ 本阶段无此环，闭环照常进行，`check-receipt` 会以 WARN 如实标注 `not_reviewed`；③脚本尚未 PASS → 本轮**通常**刻意不产出 verifier 调用面，先修 BLOCKER 再说；**例外**是 `next_action=run_verifier_for_repair`——review 负面裁决与 UT 真实断言失败（`code_regression`）这两类已复现的可诊断产品失败，harness 会在脚本 FAIL 下照样签发 request，因为它们的回修候选本就依赖 verifier 逐条确认。照常投 request、原样写报告；**产品 FAIL 与 open 闭环状态不因此改变**，别在拿到逐条结论前改产品。

## 阶段闭环判定（全局入口 §5.1）

> **标准 feature 模式**适用下文四条件。**即席（`_adhoc`）模式**不宣称「某需求 testing 阶段闭环」：不写 receipt、不强求 `harness-runner testing --feature _adhoc` PASS、不要求 verifier；以交付 trace.json 摘要为主。coding 返修窗口用 `adhoc-device-test --install-current-build` / `--measure-screen` / `--dump-ui-only` 做的局部诊断默认落 `_adhoc`：那些构建结果、装机 meta、dump、截图与量测**不是验收证据**，本阶段不读、不采信，照常按自己的规则出包、装机（goal 正式 gate 强制重装）并判定。返修交回前须遵守 [coding Skill](../feature/coding/SKILL.md) 的修后复看要求。

**closed = 脚本 harness verdict=PASS ∧ 全部 policy=required 的证据已提供**。要求哪几项由 harness 求解后输出（`HARNESS_EVIDENCE_POLICY` 行与 `check-receipt` 的逐项状态），不是写死的固定四件套——verifier 是否 required 由 harness 的 verifier plan 决定，判 disabled 时这一项不存在也不缺失。本阶段的常规形态：

1. `<features_dir>/<feature>/testing/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS（**仅当 harness 为本阶段输出了 verifier request**；只跑一次——材料未变复用既有报告，材料变了但历史有 PASS 沿用并标 `completed_with_prior_review`）；4. `check-receipt.ts` 通过（回执由 harness 只读投影生成，agent 不手填；备注写 `<phase>/notes.md`）。required 证据齐备后真机测试阶段完成（**最终环**）。

**收尾 / 闭环停等（BLOCKER）**：只呈现 harness 的 `NEXT_STEP` 段落，不自行推导或补写跨阶段建议；recommendation 由 `assess@1` 生成（含回修起点），执行授权仍由 driver 按 `phase.next_step` / `transition_policy` 裁决。

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
| 详细流程 | [reference/device-testing-workflow-detail.md](device-testing-workflow-detail.md) |
| 阶段级规约 | `framework/specs/phase-rules/testing-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-testing.ts` |
| 派生提示 JSON | `<features_dir>/<feature>/testing/reports/derive-hint-from-plan.json` |
| AI Harness Prompt | `framework/harness/prompts/verify-testing.md` |
| 测试计划/报告模板 | `` `profile-skill-asset:device-testing/test_plan_template` `` / `` `profile-skill-asset:device-testing/test_report_template` `` |

## Slash/trace 与收尾

通过 `/device-testing` 或等价快捷入口触发时，须在阶段结束时产出 trace 凭证：`<features_dir>/<feature>/testing/reports/<timestamp>/<model>-devtest/trace.json`（Schema：[trace.schema.json](../../harness/trace/trace.schema.json)，`phase: testing`）；同目录 `gap-notes.md`（模板 [gap-notes.template.md](../../harness/trace/gap-notes.template.md)）。

**页面身份与内容验收分工**：复用 visual-diff-nav 的 identity.all_of/any_of/none_of；用稳定 screen/root、route、标题等区分页面，sms_next 这类待验收按钮留在 ui-spec required 与原生业务断言。目标页身份通过但按钮被键盘遮挡/缺失，仍是内容失败，不能隐藏键盘或删业务断言来满足身份。旧 nav 把按钮放 all_of 时，读取原配置和 _identity dump，由 testing 修自己的导航规则后重新判页；gate 不自动删除失败成员。真错页或锁屏不落目标页正式截图；命中其它应用组件 id 只证明应用树在场，不能断言一定是其它页。

**视觉 provider 局部纠错**：同 gate 调用成功而 payload 不合法时，harness 把原body及精确屏/字段/索引错误回给同一冻结provider，最多纠正一次；两次共用原provider timeout与gate剩余deadline的较早截止，独立留原输出/usage/诊断，check structured与NEXT指向诊断。执行者不手改provider证据、hash或region verdict。原图/来源图/导航/目标/HAP变化回原采集/装机/trace路径；局部纠格式不重跑native或capture，也不能洗绿同gate已有native FAIL。IO只重试原提交事务，不让provider重判产品；第二次仍非法或预算不足保留invalid/清场状态，下一整轮真实产品复验仍走原契约。

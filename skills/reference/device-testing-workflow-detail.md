# device-testing 阶段详细流程（条件加载：执行对应 Step 时读）

> SSOT 索引见 [`skills/feature/device-testing/SKILL.md`](../feature/device-testing/SKILL.md)。本文承载 Step 1.5 打包装机协议、Step 4.5 Hylyre 派生计划全套操作、Step 4.B 即席模式全套操作、Step 4.6 视觉 diff 回环（含全部事故派生的确定性判裁规则，逐字保留不得精简）、Step 5.1 trace 回填、Step 6 质量门禁自检清单；触发/门禁清单/闭环判定仍以主文档为准。

## Step 1.5 打包与装机（profile capability）

在生成测试计划（Step 2）之前，若当前 `project_profile` 将 **`device_test.build`/`device_test.install`** 声明为 **BLOCKER**，须与用户对齐「能在真机上跑的同一套包」：

1. **读取宿主指南**：完整阅读 `framework/profiles/<project_profile.name>/skills/device-testing/profile-addendum.md`，宿主 toolchain/环境/harness 变量以单一宿主附录为 SSOT，根 SKILL 不复述宿主专有名词。
2. **与用户确认打包维度**（`testing.packaging`）：展示 product/buildMode 推荐值后 `1=确认` `2=修改`。product 枚举宿主工程可用制品维度：默认按 `resolveProductSelection` 单次解析（`explicit_run` → `confirmed_env`（`HARNESS_DEVICE_TEST_PRODUCT`）→ `explicit_config`（config 值且 local 确认值逐字相等）→ `sole_candidate`）；**构建形态无法确定时不猜**（四种原因：多候选未确认 / build-profile 缺失 / products 为空 / build-profile 不可解析——后三者无真实候选、不得虚构 `default`），停止并经 framework-init `init.product_selection` / `record-product-selection` 机器写入或 env 显式确认后继续。buildMode 为宿主 `debug`（默认）/`release`，需在会话或环境记下所选组合供 `testing` harness 复现；附录 `testing-build-conventions.ts` 说明可用 `HARNESS_DEVICE_TEST_*` 变量。
3. **执行链路**：经 `capability-registry` → `dispatchDeviceTestBuild` 产出 signed 应用包；再 `dispatchDeviceTestInstall` 触发装机（宿主附录写明等价 CLI）。宿主实现在 `profiles/<name>/harness/providers/device-test-build.ts` 与 `device-test-install.ts`；日志约定见宿主 profile-addendum（同一 `reports/<feature>/testing/` 目录）。
4. **与文档门禁的顺序**：`testing` 脚本 harness 会在校验 Markdown 计划/报告之前尝试 `device_test.build → device_test.install → device_test.run`（profile SKIP 则对应步骤 SKIP）。Hylyre ensure（venv/pip/doctor）在 `device_test.run` 内自动执行，非 Skill 入口独立步骤。可先撰写文档再由 harness 触发包链路；BLOCKER 失败须先修复宿主 toolchain/设备再继续闭环。
5. **外部自动化**：Framework 负责「包已在设备上」之前的宿主门禁；后续第三方自动化/UI+Mock 不负责替代宿主打包（单向衔接）。

## Step 4.5 真机自动化·派生可执行计划（profile `device_test.run`）

若 `device_test.run` 为 BLOCKER 且未 SKIP，须在跑一次 `testing` harness 之前，从顶层 `test-plan.md`（自然语言步骤表）生成 Hylyre 可消费的派生计划。具体 JSON 形态/宿主 CLI/`HYLYRE_APP_STORE_DIR`/即席落盘约定见 profile addendum「真机自动化」与模板 `` `profile-skill-asset:device-testing/test_plan_hylyre_template` ``。

**门禁提示**：`device_test.run` 未 SKIP 时，脚本以顶层 `test-plan.md` 为 SSOT 校验 Hylyre 派生覆盖：派生表 TC ∪ `explicit_skip_tc_ids`（派生 md frontmatter 或同目录 `derive-manifest.json`）须覆盖顶层全部 `TC-xxx`；否则 BLOCKER，并更新 `derive-hint-from-plan.json`（`schema: 2`，含 `missing_tc_ids`/`rejected_placeholder_paths`）。含烟测占位标记的派生文件无效；多目录并存按 `test-plan.hylyre.md` 的 mtime 选最新有效派生。CLI：`cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`。

**4.5.1 解析 TC 表**：打开 `<features_dir>/<feature>/testing/test-plan.md`，定位「测试用例清单」章节；读取第一条用例行表（列须覆盖用例编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC）；每行建立工作项 TC-xxx。

**4.5.2 发现 selector**（按顺序尝试）：①`contracts.yaml`（components/资源键/UI 相关 id）；②`plan.md`（组件树/按钮文案/路由名）；③`doc/app-snapshot-cache/<bundle>/`（历史 `hylyre app page save` 页面结构，每次 `runHylyreDeviceTest` 结束后自动尝试）；④设备连线时用 `adhoc-device-test --dump-ui-only` 抓取当前屏候选（**禁止**在实例工程根直跑 `python -m hylyre dump-ui`）。**四级优先级只负责发现候选，不授予真值地位**：任何来源的 `by_id` 都 MUST 经同一 normalizer 反解到当前 feature/screen 的 ui-spec node；`by_text` MUST 与 ui-spec text 精确等值。运行 `derive-hylyre-plan-hint` 可读 `selector_contract.entries[]` 查询 node → canonical 4 段 base anchor、kit 后缀与实例基数要求；派生 lint 以 `SELECTOR-SPEC-001` 结构化 WARN 报告无依据 selector。无法校验时先补 ui-spec/anchor 注入；仍无可靠 selector 的 TC 不写入派生表行，但须在 frontmatter 或 `derive-manifest.json` 登记 `explicit_skip_tc_ids`，Step 5 标跳过并写原因。

**4.5.3 翻译为 Hylyre JSON**：每步译为单行裸 JSON（禁止 Markdown 反引号包裹单元格）；根键以 `planned_step_keys` 为准（touch/input/swipe/scroll/back/home/wait_for/assert_toast 等）；推荐 canonical 直接根键形态（`{"touch":{"by_text":"…"}}`），`{"action":{"type":"touch",…}}` 为兼容形态勿混用；禁止步骤列写 `start_app`（harness 已预启）与 `dump_ui`/CLI 命令名作根键；同格多步用 `;`/`；`拼接（禁止 `<br/>`，格内禁未转义 `|`）；派生前可读 `derive-hylyre-plan-hint`/`derive-adhoc-hylyre-hint` 输出（hint JSON 内含 `allowed_step_roots`/`step_shape_catalog` 机读步骤目录，翻译时以此为准），`snapshot_cache_empty:true` 先 warmup 或 dump-ui；若步骤语法不在当前上下文（长会话被压缩后常见），翻译前重读 `profile-skill-asset:device-testing` 的 `reference/hylyre-planned-step-fields.md`。

**4.5.4 裁决与跳过登记**：维护「进入派生/跳过」两份清单，跳过须在 Step 5 报告逐条可见；派生表用例编号须 ⊆ 顶层 test-plan.md（否则 extra FAIL）；顶层每个 TC 须出现于派生表或 `explicit_skip_tc_ids`（否则 missing FAIL）。

**4.5.5 落盘**：创建 `<features_dir>/<feature>/testing/reports/<timestamp>/hylyre/`；写入 `test-plan.hylyre.md`（锚点 `## 测试用例清单` + 7 列表头顺序固定，自 profile 模板拷贝表头）；同一 `user_actions.calls` 有多个 `ui` 入口时每个入口各派生一条用例，携带 `entry_ui`/`linked_flow`/`calls`（脚本 `ui_entry_coverage` 校验，P0 缺任一入口 BLOCKER）；随后触发 `harness-runner --phase testing --feature <feature>`（宿主顺序 build→install→ensure Hylyre→run plan）。**profile 为 generic 或 `device_test.run` SKIP**：跳过本节。

## Step 4.B 即席模式（ad-hoc·不绑正式需求）

1. **Derive hint**（机械切分 NL + cache 提示，不跑机、不译 Hylyre JSON）：`npm run derive-adhoc-hylyre-hint -- --bundle <bundleId> --steps "…"` 或等价 `adhoc-device-test`（仅 derive，写 `derive-adhoc-last.json`，stderr `ADHOC_DERIVE_FILE=`）。关注 `snapshot_cache_empty`/`cache_layout_expected`/`cache_layout_mismatch`/`selector_hints`/`steps_file_contract`/`observation_steps`/`forbidden_in_steps`。
2. **Agent 写 Hylyre JSON**：读 derive 的 `steps_file_contract`/`step_shape_catalog`（可选 `steps_file_minimal_example`）。手写 `doc/features/_adhoc/testing/staging/test-steps.json`（探索/汇总类 NL 不进 steps）；**禁止**向 `framework/harness/` Write 即席 steps/trace/report；**禁止**向 `doc/app-snapshot-cache/<bundle>/` 根目录 Write page JSON。写后先 `npm run lint-adhoc-steps -- --file <path>`（可加 `--normalize`），通过后再跑机。
3. **执行**（勿手工拼 hdc/hylyre）：`npm run adhoc-device-test -- --bundle <bundleId> --plan path/to/test-plan.hylyre.md`（或 `--steps-file`）。执行报告永远落 `doc/features/_adhoc/testing/reports/<timestamp>/hylyre/`（stderr `ADHOC_HYLYRE_RUN_DIR=`/`ADHOC_TRACE_FILE=`）。可选 `--ability`/`--skip-explore`/`--accept-cold-start`（仅跳过 snapshot warmup）/`--skip-page-save`/`--dump-ui-only`/`--observe-ui`。默认 execute 冷重启（`hdc aa force-stop`+`aa start`）；保留 Nav 栈调试加 `--continue-session`。
4. **观察汇总决策树**：touch 步骤只写到导航终点，禁止 steps-file 写 `dump_ui`；run 成功后 `--dump-ui-only` → `ADHOC_DUMP_UI_PATH=`；汇总用 `summarize-adhoc-dump` → `ADHOC_SUMMARY_JSON=`；或 touch-only NL 用 `--observe-ui --steps "…"`。
5. **进度锚点**：stderr 含 `ADHOC_PHASE=`/`ADHOC_RUN_DONE=`；run 结束先交付 cases 摘要再 dump/汇总。

**Hylyre 误导性报错对照**（即席必读）：

| 报错关键词 | 真实含义 | 先做 |
|-----------|---------|------|
| 「非 JSON」+ action 示例 | 步骤未识别为 JSON（常见反引号） | 去掉反引号；读 plan-lint.json |
| `--plan` 不能、`--steps-file` 能跑 | Markdown 表格格式问题 | 修正 plan 或改用 `--steps-file` |
| start_app 相关失败 | 重复冷启或嵌套 action.type | 删步骤内 start_app |
| STEP-002 禁止 dump_ui | 观察型 NL 误写进 steps | 导航 run 后用 `--dump-ui-only` |
| `wait requires seconds` | wait 误用 timeout 或缺 seconds | 改用 `{"wait":{"seconds":N}}` |
| `Unsupported touch payload`/STEP-TOUCH | touch 嵌套 selector | 改用 `{"touch":{"by_text":"…"}}` |

其余约束：保留目录名 `_adhoc`；bundle 必须用户声明；默认单 TC-001；步骤裸 JSON 数组不含 start_app；不跑 `harness-runner --feature _adhoc`；执行链 `ensureHylyreReady`→resolve ability→(可选)warmup→lint→run（禁止未 ensure 前让用户 pip install）；不写 receipt/verifier，交付 `trace.json cases[]` 摘要；ensure 失败读 `hylyre-doctor.log`/`hylyre-ready.meta.json` 后重跑；默认 run 后 `app page save`（`--skip-page-save`/`--observe-ui` 可跳过）；结果 SSOT 为 `ADHOC_TRACE_FILE=`/`ADHOC_DERIVE_FILE=`/`ADHOC_HYLYRE_RUN_DIR=`（禁止 glob timestamp）；execute 默认冷重启清 Nav 栈，非全 pass 后禁止假设仍在首页 Tab，`--continue-session` 显式保留，见 `ADHOC_UI_RESET_RECOMMENDED=1` 须去掉该参数或确认已冷重启；`--accept-cold-start` 只跳过 snapshot warmup不能代替冷重启；warmup 软失败仍继续 run（WARN）。

## Step 4.6 视觉 diff 回环（visual_diff · ui_change=new_or_changed 时）

> QA 阶段级动作（非 test-plan 派生 screenshot 步骤根键）。**唯一直接像素对图阶段**：参考图来自 spec `authoritative_refs` 或 `fidelity.lock.yaml` 快照（`buildAuthoritativeRefImageIndex` byId 联结 ui-spec `source_ref`）。

1. **前置**：`device_test.build`+`device_test.install` 已通过；Hylyre 可 screenshot。
2. **MVP 范围**：先覆盖可直达顶层屏；深层屏/overlay 由固化 nav 配置自动导航到达后再截——`<features_dir>/<feature>/device-testing/visual-diff-nav.json`（key=屏标识，value=到达步骤，复用 Hylyre planned-step 根键、不含 screenshot）。`visual_diff_capture` 有该配置时按屏导航到位再截，屏 id 经 X1 归一化匹配；页面结构无变化则复用不需重生成，仅屏/入口变更才更新；缺配置或与 ui-spec 屏集不一致→报错求补，不静默裸采。**P0 屏无论是否 `lightweight` 都必须被采集与评估**（lightweight 只对 P2/P3 生效，不豁免 P0 视觉门禁；曾有 P0+lightweight 屏被整个跳过、verdict=skipped 无人评估）。**某 P0 状态不可达是缺陷不是豁免理由**：须产出 must_fix「P0 状态 X 不可达，须可导航到该态后重采」，禁止以 skipped 放行。
3. **执行**：对每屏 Hylyre 导航+screenshot → 先断言屏身份（E3 防截错屏：确认截图呈现的就是目标屏——锚点＝该屏 `must_have_elements`/标题文案/导航态；不符即 `verdict=fail`+must_fix「captured wrong screen」，禁止在错图上做 diff）→ 双向 diff（正向=spec 声明元素；反向=参考图有实现无；G3 样式/布局核对：`variant`/`layout_group`/`align`/`width_ratio`/`bg_color` 须逐一对真机截图核对，不符进 must_fix；渲染缺陷枚举：逐屏登记 `defects[]`——裁切/重叠重复/形态版式不符/声明 asset 未渲染，每条带 `bbox`+`severity`(blocker|major|minor)+`note`；**verdict=pass 须 defects 为空且无 reverse_missing 残留，且 pixel_1to1 P0 屏须附 `region_attest[]` 逐区域举证**——每 must_have_elements/zone 一条 `{region, verdict: no_diff|diff_logged, method: paired_crop_compare|vl_screening, evidence?, by}`；legacy `method: human` 可读但不计覆盖、不改变 verdict；**method=paired_crop_compare 须先物化并排对照 crop 到 `device-screenshots/_attest/<screen>_<region>.png`（参考图/实测图各裁对应区域），且 critic 写 verdict 前必须逐屏 Read 对应 _attest crop（成对图强制入模，t7——先裁图再凭记忆填表=违规）**；paired 条目存在时须写 `device-testing/reports/critic-receipt.json`（critic_run_id/prompt_hash/input_provenance/image_inputs[]+hash；交互态无法证明注入 → 如实 `input_provenance: unverified`）→ 产出：
   - `<features_dir>/<feature>/device-testing/device-screenshots/visual-diff.json`（每屏 `reverse_missing[]` 逐元素枚举+`defects[]`；`score_floor` 含 N×N 分块最小相似度；`edge_tile_divergence`/`edge_over_threshold_tiles` 由采集层自动写入——超阈 tile 未被任一 defect.bbox 覆盖会触发边缘哨兵 WARN，须补对应 defect 或复核该区域）
   - `<features_dir>/<feature>/device-testing/visual-diff.md`（由 harness 从 visual-diff.json 自动生成，含「采集完整性」节；**请勿手改**——所有结构化结论一律填进 JSON，md 每次采集后无条件从 JSON 再生并覆盖任何手写内容，门禁结论始终以 JSON 为准。曾出现 md 手写"6 屏 hash 均已唯一"而 JSON 实为 5 屏同 hash 的谎言——现已根治）
   - **T7 证据 rubric**（pixel_1to1 P0 pass 屏）：判 pass 前逐关键元素记录当前机器证据，是 pass 的举证责任而非凭总分自报。客观度量不足时使用当前、hash-bound 的 native/delegated 视觉证据；能力不可用则诚实 capability defer，证据无效则 FAIL/retry，不以人工确认兜底。
4. **A/B/C 边界**：C 类动态交互不在静态参考图承诺内；B 类美术资产取决于素材供给。
5. **回修（critic 自动迭代，plan c6d8f2b4 t9——替代旧"MVP 单轮+人工决定是否再迭代"）**：独立 critic（与实现者分离的上下文：交互态=Task verifier subagent，goal 态=独立 critic phase/prompt）产出 must_fix → coding 修 → 重采重判，**自动迭代直至 candidate-pass 或熔断**，不再每轮停下问人。must_fix 必须可执行可定位——带元素/区域+期望态的指令，关联具体 element_id 或区域 bbox；禁止「整体差异大/不够还原」这类无法回修的空话。
   - **candidate-pass 定义（五条件）**：无 BLOCKER/major defect + must_fix=[] + 必需 region_attest 与 critic 回执有效 + T8/M1 无未处置命中（T8 布局树未接入的宿主按既有确定性信号集 T1/T4/T5/P1-C/dedup 计）+ advisory/minor 已枚举。critic 回执 `input_provenance=verified` 才能满足要求 verified 的发布策略；unverified 是否可继续只由现有 quality-axis/release policy 决定，不新增人工终审。
   - **熔断（no-progress 指纹化，f7a3d9c2 起机器化）**：must_fix/defect 折算稳定指纹 `screen_id+defect_class+element/region+bbox_bucket` 比对集合（禁止自然语言字符串比对——同义改写会逃逸）。**（pixel_1to1）机器判定已接管**：harness 每有效轮写 `device-testing/reports/visual-rounds.ledger.jsonl`（runner 机器盖戳，check 只读比对）；连续两有效轮指纹集相等且仍有 loop-actionable 残差 → BLOCKER `visual_diff_no_progress_fuse`（归因 `no_fix_attempt`=跑了没修 / `ineffective_fix`=修了没用）。见到该信号即熔断：停止改措辞重试，保留残差并诚实终止或由新 correction/successor run 继续；也**禁止未改码/未重建就原地重跑 harness 刷轮次**（同状态重跑被账本幂等吞掉，不算迭代）。**严禁删改 visual-rounds.ledger.jsonl**——goal 态 events 反向对账会以 `visual_ledger_integrity` 拦下，删账本≠空历史。指纹入账资格=每条 must_fix 有结构化 defect 锚定（`must_fix_refs` 逐条引用；T8 发现须以 `source.finding_id` 转录进 defects——门禁 `visual_diff_finding_transcription` 附可照抄模板）。
   - **candidate-pass 前不得请求质量确认**；确定性 fail 必须形成 repair 并重验，不得借“等用户/等 critic”拖延或签掉缺陷。
6. **降级**：warmup/无设备 → harness `visual_diff` SKIP，按 required/optional 轴投影 capability defer 或 advisory。**分数字段语义（t4，plan c6d8f2b4）**：`fidelity_score`/`geometric_iou` 已更名 `reported_fidelity_score`/`reported_geometric_iou`（legacy 名读入自动映射）——**VL 参考自评、零 gate 权重**；旧 lowScorePass/灾难地板不再消费自报值（真算几何值接入前 SKIP+注记）；pass 的举证责任=region_attest+defects 枚举+确定性信号，非分数。`pixel_1to1` 下以下情况一律 BLOCKER：must_fix / reverse_missing / defects(blocker|major) / 缺 defects 逐屏枚举 / **P0 pass 屏 defects=[] 无 region_attest(t5)** / **attest 声称 paired_crop_compare 但证据 crop 缺失** / **critic 回执无效或 image_inputs 未覆盖 attest crop(t7)** / **M1 自报退化（命中屏写 `evaluation_invalidated:true` 由独立 critic 重评后清标记）** / **evaluation_invalidated 未清** / **T8 布局不变量 hard 命中** / P0 warn 屏 must_fix 空(T4) / 全局元素越界(T5) / P0 pass 屏声明锚点文本整块缺失(T1) / **文本块结构背离(P1-C)**。当前 hash/attempt/identity 绑定的 deterministic/native/delegated 机器证据决定结论；legacy `confirmed_by` 可读但无 gate 权重。`score_floor` 仅作 reference_only 注记。

   **视觉裁判可信化**：`pixel_1to1` 最严档只接受当前截图/build/attempt/identity 绑定的 deterministic/native/delegated 机器证据。provider 能力缺失时 required 轴诚实 defer；provider 声明可用但载荷缺失、无效或 stale 时按普通 FAIL/retry，不能伪装能力缺失。OCR 不可用时按轴要求投影，不静默。边缘哨兵超阈 tile 未登记 → WARN（低置信、非 gate）。**verdict=warn 的语义＝"有残差、需再修一轮"**：P0 pixel_1to1 warn 屏必须带非空 must_fix；defects/reverse_missing 只是证据、不替代 must_fix。残差可接受且机器证据完整才判 pass。

   **禁止弃判**（门禁 `visual_diff_verdict_abandonment` 硬拦）：harness 报出 `visual_diff_text_placement` fail_signals 的屏＝headless 可判——必须 `verdict: fail` + 把信号逐条抄进该屏 `must_fix`。**修码不在 testing 内进行**：testing 禁止写产品源码，runner 消费非空 must_fix 自动回退 coding 修复后重走 review/ut/testing。不得以“无人值守不可闭环”为由留 pending；确定性 FAIL 在手还全屏 pending 只会烧空预算。

   **结构声明验真分工**（诚实边界）：文本类由确定性信号覆盖；非文本类（tab 容器视觉/分组容器/独卡边距）由 coding 台账、独立 review 和当前 hash-bound 视觉 provider 证据共同验证。能力不足时 capability defer，载荷无效时 FAIL/retry；不得把不确定项留给用户签字改判。

   **判定持久化**：pass/warn/fail 机器判定绑定「被评截图文件 hash + build 指纹（实际 hap sha256）」——同一构建下可跨 harness 轮复用；改码重装（hap 变）→ 自动失效重判。legacy `confirmed_by` 仅保留字节、不参与复用或 gate。别手动 reset visual-diff.json 求“刷新”——那是改判脚本红线。

   **布局校准**：宿主一句话触发 `npm --prefix <harness> run layout-oracle-calibrate -- --feature <feature> [--device --python <hylyre python>]` → `device-testing/reports/calibration.json`+报告 md。校准只消费版本化机器 fixture 与设备测量；不得读取人签反馈台账或直接改写当前 run verdict。

   **交付后 UX 反馈**：用户若发现视觉不一致，把问题作为 correction/successor run 的需求输入，按责任阶段重新执行机器门禁；不得回写上一 run 的 `confirmed_by` 或 verdict 来改写其完成证明。
7. **采集新鲜度**（E1/E2）：P0 屏截图失败（Permission denied/锁屏/设备占用）或 `screensWritten=0` 全靠 `preserved` 旧 json 充数时，`visual_diff_capture` 在 `pixel_1to1` 下 FAIL（否则 blocking WARN）——不得沿用陈旧/错图证据闭环，须修复采集后重采 P0 屏。

## Step 5.1 自 Hylyre trace 回填执行状态（必做）

1. 读取 `<features_dir>/<feature>/testing/reports/device-test-timing.json`（harness 在 `device_test.run` 成功后写入）。填充测试概览「真机流水线耗时」表（区分 `build_reused`/`install_reused` 与 `hapBuiltAt`）；执行结果表增加耗时列（来自 `cases[].duration_ms`，如 `12.4s`）。
2. 解析 `trace.json`：`cases[]` 每条含 `id`（与派生表用例编号对齐）、`status`（通过/失败/阻塞/跳过）、`notes`（可选）。
3. 构建行集：派生表中出现的 TC 以 `cases[]` 为准写状态与备注（无 case 记录但 run 整体失败→标阻塞或失败并注原因）；仅在顶层 test-plan.md、未进派生表的 TC → 标跳过，备注示例「缺少稳定 selector，需补 plan.md/contracts.yaml」。
4. **不要**与 Hylyre 状态枚举混用其它字样（门禁与 receipt 校验依赖一致词表）。

## 红线：测试接缝与 P0 覆盖（goal-fakepass-hardening，BLOCKER）

- **测试接缝不得改变用户可见流程/默认行为**：`*_FAST_PATH`/`DEVICE_TEST*`/`SKIP_SMS*` 类
  开关默认 `true` = `product_behavior_switch_scan` BLOCKER（bc-openCard 事故：点银行直写卡
  跳结果页）。可测性接缝限 `.id()` 锚点等**不改行为**的改动——且 review 闭环后任何产品
  源码变更都会被 `review_closure_attestation` 拦下，须回跑 review 重审。
- **P0 用例 skip 默认修复（c7e4a2d9）**：explicit_skip/未执行的 P0 → `p0_coverage_integrity`
  BLOCKER（fail-closed 不变）。未豁免缺口**全部属于既有 explicit_skip_tc_ids 登记**时，
  gate 复用 failure_kind=code_regression + agent_fixable → summary 自动产 coding 候选 →
  assess 回退 coding 修复并重测（**不降低验收标准，修复不是授权行为**；同指纹无进展由
  既有熔断收口）。status 为空或未经登记的 trace skip 不产 coding 候选、留在 testing 恢复
  执行/派生计划；真实外部阻塞按 DEFERRED 登记；旧 p0_skip_waiver receipt 只读且不改变
  verdict，P0 未执行不能降级为 WARN。通过率必须
  双口径（skip 计入分母），存在 P0 skip 时结论不得无条件「达标」；不再有
  await_human_p0_skip 首触求人 halt。
- **P0 状态迁移证据**：派生计划各 P0 TC 须动作指向 acceptance checkpoint 的
  `target_element_id` 且其后 `wait_for` required 元素；flow 每条中间屏边须有已执行且通过
  的 owning TC（纯 wait 冒充/直达结果页=`p0_semantic_coverage_integrity` FAIL）。
- **mock 数据可辨识**：多实体场景（多卡/多账户）各实体可见身份（掩码后卡号等）必须唯一
  可区分——掩码口径要避免「前 4+后 4 恒相同」（bc-openCard：全部卡显示 6225 **** 0001）。

## Step 6 质量门禁自检完整清单

**测试计划自检**（11 项）：必需章节齐全；用例清单表头含编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC；优先级仅 P0-P3；每条 device/both AC 至少 1 条 TC（步骤对齐 device_focus）；device/both P0/P1 AC 100% 覆盖；unit AC 已从计划剔除；测试步骤足够详细可重复执行；预期结果可观察可验证无模糊描述；测试环境含设备/系统版本/API 版本；通过标准含量化阈值；元数据（模块标识/版本/日期）齐全。

**测试报告自检**（8 项）：必需章节（测试概览/执行结果/通过率统计/结论）齐全；执行结果表含用例编号和执行状态；状态值仅通过/失败/阻塞/跳过；各优先级与总体通过率计算正确；结论与通过率数据匹配；失败用例都有对应缺陷记录；缺陷关联用例编号在用例清单中存在；报告用例编号与计划一一对应。

不通过项定位后自动修正重新自检，直到全部通过。

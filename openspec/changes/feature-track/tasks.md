# Tasks: Feature Track

## 1. Schema 与 loader

- [x] `specs/workflow-schema.json`：tracks / requires_by_track / auto_chain_by_track；schema_version 1.1
- [x] `workflow-loader.ts`：兼容 1.0（分轨字段出现即 FAIL）与 1.1；lite-only phase 缺显式链/依赖/链序不互洽 → FAIL（validateTrackDeclarations，9 case 契约单测 `workflow-tracks.unit.test.ts`）
- [x] `spec-driven.workflow.yaml`：升 1.1 + coding 双轨标注（requires_by_track.lite=[change]）+ lite 链（change/coding/exit）

## 2. feature.yaml 与判档

- [x] feature.yaml track 声明读取：`scripts/utils/feature-track.ts`（loadFeatureTrackDecl，经 featureArtifactPath 解析，缺失=full）
- [x] track 评分：exploration_strategy 维度上抬为通用 track 评分（`change-rules.yaml > track_scoring`，spec-rules 侧加同步注记防双改漂移）+ 一票升 full 项（pixel_1to1_intent / cross_module_signal / goal_mode_run）
- [x] `feature.track` gate 登记 confirmation-registry（1=接受建议档 / 2=升 full / 3=保持 lite）+ check-skills-confirmation-ux 绿（实跑 lint 0 FAIL；correction.layer 一并登记于 _cross_phase）
- [x] 中途升档：`feature.track` 升档确认 + feature.yaml history append + change.md 作 spec/plan 种子（SKILL「中途升档（BLOCKER）」节 + exit diff 越界 suggestion 指回升档）

## 3. lite 链

- [x] change phase 门禁：`check-change.ts`（命名按 runner `check-<phase>.ts` 派发约定，替代 OpenSpec 原名 check-change-lite.ts——实施记录已注记）+ change-rules.yaml；章节/Scope yaml/catalog 模块名（缺 catalog 小工程跳过）/checkbox 语法
- [x] exit 门禁 v1：`check-exit.ts` + exit-rules.yaml——checkbox 全勾（BLOCKER）+ scope 声明（BLOCKER）+ 编译复用 profile coding host（checkCodingCompile，与 coding 同源）
- [x] exit 门禁补齐：diff_within_scope 真实接线（分类核心抽 `utils/diff-scope.ts` 与 full 轨共用；scope 来自 change.md，模块→路径映射 contracts→catalog entry_file→layer 目录存在性三级回退；不可判状态一律 fail-closed FAIL）+ lint 接线（ProfileCodingHost 可选 `checkCodingLint` 派发；无 provider = MAJOR WARN 可见缺项为终态语义）+ 条件 UT（验收清单 `[unit]` 标记条目触发，镜像 full 轨 ut_layer∈{unit,both}；经 ut-host-impl 合成 contracts 视图执行，unit 条目存在而 UT 缺失/宿主缺实现 → BLOCKER FAIL）
- [x] goal 链路分轨接线：goal-runner / goal-progress 的 resolveAutoChain 传 feature track；resolveChainFromEvents 事件链过滤放宽到 workflow 全部 feature phase（三轮 review）
- [x] harness-runner 按 track 过滤 DAG（消费 C0 resolvePhaseChain；lite feature 误跑 full-only phase 明确报错）
- [x] init 首步建议改 full 轨过滤（findFirstLaunchableFeatureArtifact——防 lite-only phase 被建议为默认入口）
- [x] `skills/feature/change-lite/SKILL.md`（109 行 ≤150）+ skills.index.yaml（id: change-lite, order 9）+ adapter 跳板（claude/cursor commands + shared skills-bridge + BUILTIN_SKILL_BRIDGE_DESCRIPTIONS + CLAUDE_SLASH_COMMANDS lint 白名单）

## 4. 入口路由

- [x] AGENTS.md.template：§4.0 L0/L1/L2 分流表 + "拿不准一律进 lite" + L0 最小纪律（原生 test/lint/build + 第三节约束照常） + 修正三问文本（重验≠重做） + `correction.layer` gate 登记

## 5. Fixtures 与 Verify

- [x] 分轨契约单测：spec-driven lite 链解析 / full 轨零变化 / 1.0 拒绝 / 隐式降空拒绝 / global tracks 拒绝 / 轨外覆写拒绝 / 链序不互洽拒绝（workflow-tracks.unit.test.ts 9 case，含 lite auto-chain）
- [x] lite 端到端 fixture 目录夹具（generic：change_pass / exit_pass / exit_checkbox_unchecked_fail / exit_scope_violation_fail；hmos-app：exit_unit_missing_fail。夹具首跑暴露 spec-loader `PHASE_RULE_FILENAMES` 硬编码枚举漏收编——真实 runner 跑 change/exit 也会崩，已改 `<phase>-rules.yaml` 约定派生）
- [x] `cd harness && npm test` 全绿（hmos-app 默认路径零回归；当批 1493，批次 2 双评审修复后终值 **1512 单测 + 40 fixtures**）
- [x] resolveChainFromEvents 的 lite 事件链专项 case（cursor 四轮建议；含 legacy 缺省集滤 lite-only phase 的反证 case，见 `diff-scope.unit.test.ts`）
- [x] `npm run openspec:validate`（31/31）
- [ ] `npm run release:verify`（随批次收尾统跑）

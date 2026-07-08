# Tasks: Feature Track

## 1. Schema 与 loader

- [x] `specs/workflow-schema.json`：tracks / requires_by_track / auto_chain_by_track；schema_version 1.1
- [x] `workflow-loader.ts`：兼容 1.0（分轨字段出现即 FAIL）与 1.1；lite-only phase 缺显式链/依赖/链序不互洽 → FAIL（validateTrackDeclarations，9 case 契约单测 `workflow-tracks.unit.test.ts`）
- [x] `spec-driven.workflow.yaml`：升 1.1 + coding 双轨标注（requires_by_track.lite=[change]）+ lite 链（change/coding/exit）

## 2. feature.yaml 与判档

- [x] feature.yaml track 声明读取：`scripts/utils/feature-track.ts`（loadFeatureTrackDecl，经 featureArtifactPath 解析，缺失=full）
- [ ] track 评分：exploration_strategy 维度上抬 + 一票升 full 项
- [ ] `feature.track` gate 登记 confirmation-registry + check-skills-confirmation-ux 绿
- [ ] 中途升档：升档确认 + feature.yaml history + change.md 作种子

## 3. lite 链

- [x] change phase 门禁：`check-change.ts`（命名按 runner `check-<phase>.ts` 派发约定，替代 OpenSpec 原名 check-change-lite.ts——实施记录已注记）+ change-rules.yaml；章节/Scope yaml/catalog 模块名（缺 catalog 小工程跳过）/checkbox 语法
- [x] exit 门禁 v1：`check-exit.ts` + exit-rules.yaml——checkbox 全勾（BLOCKER）+ scope 声明（BLOCKER）+ 编译复用 profile coding host（checkCodingCompile，与 coding 同源）
- [ ] exit 门禁补齐：diff_within_scope 接线（当前 **fail-closed BLOCKER 占位**——接线前 lite exit 不可闭环，review 修复）+ lint 接线（WARN 占位）+ 条件 UT（acceptance 有 unit 条目时）
- [x] goal 链路分轨接线：goal-runner / goal-progress 的 resolveAutoChain 传 feature track；resolveChainFromEvents 事件链过滤放宽到 workflow 全部 feature phase（三轮 review）
- [x] harness-runner 按 track 过滤 DAG（消费 C0 resolvePhaseChain；lite feature 误跑 full-only phase 明确报错）
- [x] init 首步建议改 full 轨过滤（findFirstLaunchableFeatureArtifact——防 lite-only phase 被建议为默认入口）
- [ ] `skills/feature/change-lite/SKILL.md`（≤150 行）+ skills.index.yaml + adapter 跳板

## 4. 入口路由

- [ ] AGENTS.md.template：L0/L1/L2 分流 + "拿不准进 lite" + L0 最小纪律 + 修正三问文本 + correction gate 登记

## 5. Fixtures 与 Verify

- [x] 分轨契约单测：spec-driven lite 链解析 / full 轨零变化 / 1.0 拒绝 / 隐式降空拒绝 / global tracks 拒绝 / 轨外覆写拒绝 / 链序不互洽拒绝（workflow-tracks.unit.test.ts 9 case，含 lite auto-chain）
- [ ] lite 端到端 fixture 目录夹具（INPUT/CMD.json 形态：PASS + 坏态 checkbox 未勾 / scope 越界 / UT 缺失）
- [x] `cd harness && npm test` 全绿（typecheck + 1485 单测 + 35 fixtures，hmos-app 默认路径零回归）
- [ ] resolveChainFromEvents 的 lite 事件链专项 case（cursor 四轮建议，随 exit 接线批补）
- [x] `npm run openspec:validate`（31/31）
- [ ] `npm run release:verify`（随批次收尾统跑）

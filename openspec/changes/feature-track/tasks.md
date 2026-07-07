# Tasks: Feature Track

## 1. Schema 与 loader

- [ ] `specs/workflow-schema.json`：tracks / requires_by_track / auto_chain_by_track；schema_version 1.1
- [ ] `workflow-loader.ts`：兼容 1.0（视作 full 单轨）与 1.1；lite-only phase 缺显式链/依赖 → FAIL
- [ ] `spec-driven.workflow.yaml`：升 1.1 + 逐 phase tracks 标注 + lite 链（change/coding/exit）

## 2. feature.yaml 与判档

- [ ] `config.ts` 增 `loadFeatureTrack()`（委托 C0；路径经 features_dir 解析）
- [ ] track 评分：exploration_strategy 维度上抬 + 一票升 full 项
- [ ] `feature.track` gate 登记 confirmation-registry + check-skills-confirmation-ux 绿
- [ ] 中途升档：升档确认 + feature.yaml history + change.md 作种子

## 3. lite 链

- [ ] `check-change-lite.ts` + change phase 接线
- [ ] exit 门禁：coding 检查子集 + checkbox 全勾 + 条件 UT
- [ ] harness-runner 按 track 过滤 DAG（消费 C0 resolvePhaseChain）
- [ ] `skills/feature/change-lite/SKILL.md`（≤150 行）+ skills.index.yaml + adapter 跳板

## 4. 入口路由

- [ ] AGENTS.md.template：L0/L1/L2 分流 + "拿不准进 lite" + L0 最小纪律 + 修正三问文本 + correction gate 登记

## 5. Fixtures 与 Verify

- [ ] lite 契约夹具：PASS + 坏态（checkbox 未勾 / scope 越界 / UT 缺失）
- [ ] schema 1.0 兼容夹具（旧 workflow 全量 full）
- [ ] `cd harness && npm test` 全绿（hmos-app 默认路径零回归）
- [ ] `npm run openspec:validate` + `npm run release:verify`

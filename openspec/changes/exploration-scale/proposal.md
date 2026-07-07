# Proposal: Exploration Scale — 探索共享与小工程裁剪

## Why

同一批工程事实（glossary / catalog / architecture / 相关源码）在 spec / plan / coding 各阶段重复探索并各自落盘 per-phase context-exploration.md，且 receipt 对每个 feature phase 都硬要求该文件——一个 feature 读 3~6 遍同样的东西。另一侧，1~3 模块小工程里 catalog/glossary/module-graph 的信息量趋近零（一个模块消什么歧），却仍是硬前置。

## What Changes

- **per-feature 探索共享**：新契约 `<features_dir>/<feature>/context/facts.md`——由该 track 的首个 feature phase 建立（full=spec、lite=change），后续所有 active feature phase（full 含 review/ut/testing、lite 含 coding/exit）以 `phase_delta` 增量节追加，不重做全量探索；`exploration_strategy` 评分只在首建时全额执行
- receipt 的 context_exploration 凭证经 evidence policy 指向 `facts.md#phase_delta`；exploration 相关 phase-rules 改为"facts 存在 + 本阶段增量节"校验
- 兼容：旧 per-phase context-exploration.md 可读；`backfill-context-exploration.ts` 扩展为可归并旧布局到 facts.md（对齐 compat protocol v1）
- **小工程裁剪**：config 增可选 `project_scale: small|standard`（缺省 standard = 现状）；framework-init 按 catalog 模块数（阈值 ≤3）与代码量建议档位、用户确认写入
- `small` 档：术语消歧降为一次性对照 architecture.md 确认（映射表仍产出、免逐行 gate、glossary 允许最小种子）；module-graph 默认禁用——`config.phases_disabled ∪ profile.phases_disabled` 并集，经 profile-loader 与 C0 `resolvePhaseChain` 统一裁剪；catalog 卡片精简字段集
- 红线：scope 声明与 `diff_within_scope` 在 small 档不变

## Impact

- Affected specs: feature-artifact-layout、harness-gates、init-orchestration
- Affected code: `harness/templates/context-exploration.md`（演进为 facts 模板）、`specs/phase-rules/{spec,plan,coding,review,ut,testing}-rules.yaml`（exploration 规则）、`harness/scripts/backfill-context-exploration.ts`、`harness/scripts/check-receipt.ts`（凭证指向）、`templates/framework.config.template.json` + `specs/framework.config.schema.json`（project_scale / phases_disabled）、`harness/profile-loader.ts`、`skills/project/framework-init/SKILL.md`、`skills/feature/spec/SKILL.md`（Step 1.5 降级分支）
- 兼容不变式：缺省 standard + 旧 per-phase 布局可读 → 存量 feature 零迁移

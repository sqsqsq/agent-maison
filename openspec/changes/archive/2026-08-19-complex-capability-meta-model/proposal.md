# Proposal: Complex Capability Meta-Model — 三类对象最小契约与父目标声明门禁

## Why

1. **父目标声明缺机器门禁。** 总纲 §12 要求服务复杂能力建设的 plan 携带父目标对齐声明
   （`parent_goal`/`advances`/`relation`/`layer` 等），但 `check-plan-version.mjs` 对这些
   字段零识别，现阶段靠 AGENTS.md「父目标对齐声明（人工核对）」节人肉核对——该节自己写明
   这是临时态，"首个总纲子 plan 落地时应顺带把校验并入 plan 扫描器"，即本 change。3.1.0
   窗口将有总计划 + 4 个核心子 plan + 4 个 provider 全部携带声明，人工核对不可持续。
2. **三类对象边界需要 normative 先行。** P1–P3 将分别建设部件演进蓝图、Change Unit、
   部件闭环；对象身份、引用方向、权威归属若无契约先行，三个 change 会各自解释总纲，
   边界漂移到集成时才暴露。P0 只成文最小边界，不预建运行时 schema（实现等实例）。
3. **provider 语义已有真实实例而无契约。** e4/b9/c2/b8 四个 provider 已挂 3.1.0 窗口，
   "SE 人工契约 → G2 自动交接"是已规划的首个 provider 替换案例；不在 P0 一次成文，
   P1–P3 会各自发明 required/optional/退出/冲突规则。（2026-08-14 上位裁决，源自
   DeepSeek Harness / Cordis 时空可组合性研究，总纲 §11.2。）

## What Changes

- 新增 capability `complex-capability-meta-model`：三类对象身份与引用方向、双入口语义、
  五类信息权威边界、unknown/open-decision 与非法输入失败语义、父目标声明字段契约
  （normative，作为 P1–P3 change 的准入约束）；
- 接缝语义契约（总纲 §11.2 的 change 化）：Seam Card 三分模板、provider 生命周期
  （required/optional 缺失、权威冲突 fail-closed、退出四类行为、不得修改完成事实）、
  三命名空间分离——normative，**零代码增量**（D9）；
- 宿主演进接缝契约（总纲 §11.3 的 change 化）：两层接缝分离、变化轴决策卡与接缝化
  门槛、纵切落地模式、闭环四验证（契约兼容/可替换/可降级/不绕过）——normative，
  P1–P3 的内容扩展而非新机制层；
- `scripts/plan-version-lib.mjs` 扩展受限声明字段解析——行内 `[]`、非空 block-list、
  折叠/字面块正文判空（零新依赖、CRLF 安全）；
  `scripts/check-plan-version.mjs` 新增父目标声明校验——**声明了才校验，未声明零行为
  变化**；default 模式即生效（登记面缺陷不拖到发布时暴露，与 a3e7d1c9 同理）；
- 新增 `scripts/tests/check-parent-goal.unit.mjs`，随既有 `release:check-plans-test`
  自动执行；
- AGENTS.md「父目标对齐声明（人工核对）」节收编为指向机器校验。

## Impact

- Affected specs: `complex-capability-meta-model`（新增）
- Affected code: `scripts/check-plan-version.mjs`、`scripts/plan-version-lib.mjs`、
  `scripts/tests/check-parent-goal.unit.mjs`（新增）、`AGENTS.md`
- 兼容不变式：未声明 `parent_goal` 的 plan（含 legacy allowlist）行为零变化；
  `version`/`deferred_to` 既有语义不动；不触碰 harness 与消费者发布件——纯 dev-only
  治理面，无 MIGRATION 影响。
- 实施时点：本 change 评审先行（总计划 6f2a9d8c §5.1 轨道 B）；`Br_release_3.0.0`
  已从 `90a4df90` 隔离，代码落地以前述 cutoff 的快速事实调和作为放行门（plan
  e7b3a9d4 t2）。3.0.0 正式发布继续约束 3.1.0 发布顺序，不阻塞本 change 实施。

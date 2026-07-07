# Design: Feature Track

## workflow schema 1.1

```yaml
schema_version: "1.1"
transition_policy: manual
auto_chain: [spec, plan, coding, review, ut, testing]      # full 沿用
auto_chain_by_track:
  lite: [change, coding, exit]                              # 存在 lite-only phase 时必须显式
artifacts:
  - id: change
    scope: feature
    tracks: ["lite"]
    check: check-change-lite.ts
    requires: []
  - id: coding
    tracks: ["full", "lite"]
    requires: [plan]
    requires_by_track:
      lite: [change]
  - id: exit
    scope: feature
    tracks: ["lite"]
    requires_by_track:
      lite: [coding]
```

- 缺省语义：`scope: feature` 无 `tracks` = `["full"]`；`scope: global` 缺省全 track 适用。
- 未声明 `requires_by_track` 的 track 沿用 `requires` 并对被过滤 phase 降空——仅限无 lite-only 上游的简单情形，否则 schema 校验 FAIL 要求显式声明。
- loader：`schema_version` 接受 `"1.0"`（全量视作 full 单轨，新字段禁止出现）与 `"1.1"`。

## feature.yaml（track 声明）

```yaml
schema_version: "1.0"
track: lite            # lite | full；缺失文件 = full
score_snapshot: { estimated_loc: 300, modules: 1, cross_layer: false, ui_fidelity: none, score: 22 }
confirmed_by: user     # feature.track gate 记录
history: []            # 升档事件 append
```

路径经 `paths.features_dir` 解析（featureArtifactPath 三通道），实现委托 C0 `resolveFeatureTrack`。

## 判档评分

`exploration_strategy` 维度（module_loc/scope_breadth/cross_layer/fan-out）上抬为 track 评分；一票升 full 项：需求含 pixel_1to1 意图、跨模块信号、goal-mode 运行。agent 提议 + `feature.track` gate（`1=接受建议档 / 2=升 full / 3=降 lite`）。中途升档：scope 越界/跨模块信号 → 升档确认 → feature.yaml 记录事件，change.md 作 spec/plan 种子。

## lite 产物与门禁

- `change.md`：意图 / scope（in/out 模块）/ 术语快查 / 验收清单（checkbox）/ 关键契约 / 任务 checkbox。
- `check-change-lite.ts`：章节存在性 + scope 模块名合法（对照 architecture/catalog）+ checkbox 语法。
- `exit`：复用 coding 检查子集（编译/lint provider + `diff_within_scope`）+ 验收 checkbox 全勾 +（acceptance 有 unit 条目时）UT——不新造重规则文件。

## 入口路由文本（templates/AGENTS.md.template）

- L0/L1/L2 分流表 + 保守缺省"拿不准就进 lite"+ L0 最小纪律（原生 test/lint/build 仍适用）。
- 修正三问（C5 Phase 0 文本先行）：需求变→spec / 契约变→plan / 纯实现→coding / 纯验证→ut·testing；禁止未分层直接动产物。
- 新确认点 `feature.track`、`correction.layer` 先登记 confirmation-registry，过 `check-skills-confirmation-ux`。

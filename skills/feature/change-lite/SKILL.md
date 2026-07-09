# Change-Lite 阶段 Skill (`change-lite`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `feature.track` / `phase.next_step`。

## 前置

- 工程已完成 [`framework-init`](../../project/framework-init/SKILL.md)（`framework.config.json` 有效，`paths` / `architecture` 已写入）。
- 跑 harness 前须满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)。
- **Personal setup（BLOCKER）**：`cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure`；仅解析 JSON（[personal-setup-gate](../../reference/personal-setup-gate.md)）。
- **视觉能力自测（UI 相关需求·交互式）**：personal-setup `ok` 后按 [interactive-vision-canary](../../reference/interactive-vision-canary.md) 后台跑自测卷判卷 CLI（防死锁编排逐步照做）。
- **Agent 行为规约（BLOCKER）**：[agent-behavioral-principles.md](../../reference/agent-behavioral-principles.md)。

## 概述

lite 轨（L1）：单模块小需求的轻量链——单文档 `change.md` 承载叙述，`change → coding → exit` 三段，验证收敛到 **exit 一次性出口门禁**（编译 + lint + `diff_within_scope` 红线 + 验收 checkbox 全勾 + 条件 UT）。跨模块 / 像素级 UI 保真 / goal 模式一律走 full 全链（spec→…→testing），不适用本 Skill。

| 叙述产物 | 路径 | 寿命 |
|----------|------|------|
| change.md（单文档契约） | `<features_dir>/<f>/change.md` | 长期归档 |
| feature.yaml（track 声明） | `<features_dir>/<f>/feature.yaml` | 长期 |

## Step 1. 判档（track 评分 → `feature.track` gate）

1. 依评分 SSOT [`change-rules.yaml > track_scoring`](../../../specs/phase-rules/change-rules.yaml) 估分：维度与 full 轨 exploration_strategy 同源（module_loc / scope_breadth / cross_layer / new_api_surface / dependency_fan_out），`score ≥ threshold_full` → 建议 full，否则建议 lite。
2. **一票升 full（veto，无视评分）**：需求含 pixel_1to1 / 像素级还原意图；明确跨模块信号（≥2 个 in_scope 模块）；goal 模式运行。命中任一不得提议 lite。
3. 向用户提议档位并停等 **`feature.track`** 确认：`1=接受建议档 / 2=升 full / 3=保持 lite`。**拿不准一律建议 lite**（L0 无 gate 兜底，误降不对称；L0/L1/L2 分流表见工程入口 AGENTS 指令第四节）。
4. 确认后写 `<features_dir>/<feature>/feature.yaml`：

```yaml
schema_version: "1.0"
track: lite            # lite | full；缺失文件 = full（消费端 SSOT：harness resolveFeatureTrack）
score_snapshot: { estimated_loc: 300, modules: 1, cross_layer: false, ui_fidelity: none, score: 22 }
confirmed_by: user
history: []            # 升档事件 append（见「中途升档」）
```

选升 full → 不再走本 Skill，转 [spec SKILL](../spec/SKILL.md)（feature.yaml 写 `track: full`）。

## Step 2. change.md 单文档

写 `<features_dir>/<feature>/change.md`，**四必需节**（`## 意图` / `## Scope` / `## 验收清单` / `## 任务`），可选节 `## 术语快查` / `## 关键契约`：

````markdown
# Change: <feature>

## 意图
<一段话：要解决什么、为什么现在做>

## Scope
```yaml
in_scope_modules: [<模块名，须存在于 module-catalog>]
out_of_scope_modules: []
```

## 验收清单
- [ ] <可观察的验收点>
- [ ] [unit] <unit 层验收点——带 [unit] 标记的条目将在 exit 强制跑 UT>

## 任务
- [ ] <实施步骤>
````

**`[unit]` 标记约定**：验收条目文本含 `[unit]`（大小写不敏感）＝该条属 unit 层（镜像 full 轨 acceptance `ut_layer ∈ {unit, both}`）；exit 将强制经宿主 UT 工具链运行对应 UT。纯人工/设备可观察验收不打标记。

**Context Facts Gate（BLOCKER，C4）**：change 是 lite track 的**建立阶段**（与 full 轨 spec 同源角色）——在 `<features_dir>/<feature>/context/facts.md` 建立全量事实（frontmatter `established_by: change` + `## Code Facts` 表，`ready_to_produce: true`）；比 spec 阈值略轻（单模块假设），不强制 subagent。后续 coding/exit 只追加 `## phase_delta: <phase>` 增量节。

门禁（写完即跑）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase change --feature <feature>
```

校验章节存在性、Scope yaml 可解析且模块名命中 catalog（小工程无 catalog 时跳过比对）、checkbox 语法、facts.md 建立阶段全量检查。

## Step 3. 实施（coding）

- 只动 `in_scope_modules` 声明范围内的模块；红线 `diff_within_scope` 在 exit **恒不豁免**。
- 实施中随手勾选 `## 任务` 已完成项；验收清单在自证后勾选。
- 架构 / 术语 / 宿主 toolchain 守门与 full 轨同源（工程入口 AGENTS 指令第三节全局约束照常适用）。

## Step 4. exit 一次性出口门禁

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase exit --feature <feature>
```

一次跑齐（全部 BLOCKER FAIL 均须清零）：

1. **checkbox 全勾**：验收清单 + 任务全部 `[x]`；
2. **编译**：复用宿主 profile coding host（与 full coding 同源）；
3. **`diff_within_scope`（红线）**：变更须落在 in_scope 模块内；模块→路径映射走 contracts → catalog entry_file → 层目录三级回退，不可判状态一律 fail-closed；
4. **lint**：宿主 provider 派发（无 provider 为可见缺项 WARN，不阻断）;
5. **条件 UT**：验收清单存在 `[unit]` 条目时强制运行，UT 缺失即 FAIL；
6. **Context Facts Gate（C4）**：追加 facts.md 的 `## phase_delta: exit` 节（无新增事实写 "none"）。

exit PASS 即 feature 闭环，**停等 `phase.next_step`**（1=结束交付 / 2=暂停 / 3=其它）。**闭环停等**：禁止未经确认自动续接其它 feature 或阶段。

## 中途升档（BLOCKER）

实施中出现以下任一信号，**立即停下**，禁止越界继续写码：

- exit / 自查发现改动越出 `in_scope_modules`（跨模块信号）；
- 需求膨胀出 pixel_1to1 / 多模块 / 契约设计诉求。

处置：走 **`feature.track`** 升档确认（2=升 full）→ 通过后：

1. `feature.yaml`：`track: full`，`history` append 一条 `{ at: <ISO 8601>, from: lite, to: full, reason: <信号> }`；
2. `change.md` 作 spec/plan 的种子输入（意图→spec 背景，Scope/关键契约→plan 输入），转 [spec SKILL](../spec/SKILL.md) 起 full 链；
3. 若用户拒绝升档：收窄需求回 in_scope 内，或经用户同意扩 `in_scope_modules` 后重过 change 门禁。

## 修正路由（中途 NL 修正）

对本 feature 的修正请求，先跑 `harness-runner.ts --correction-init`（内部按**修正三问**分层：需求变→意图/验收清单；契约变→关键契约/Scope；纯实现→coding；纯验证→UT/验收自证）。`.current-correction.json` 的 `auto_confirm_eligible: true` 时可直接按声明层实施；否则须经 `correction.layer` 1/2 用户确认后才动手。只改根因层，再重跑受影响门禁（**重验 ≠ 重做**）。分层表与禁令见工程入口 AGENTS 指令第四节。

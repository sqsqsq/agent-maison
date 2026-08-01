# Skill 契约与确定性评估

Skill 的 Markdown 负责说明“如何工作”，机器契约负责回答“什么输入、产物与闭环才算合格”。两者共同描述一个 phase，但运行时只从发布的 contract、summary、closure 和 evidence 读取确定性事实；写边界与 closure 策略仍由既有 policy/evidence 机制执行，不是 contract schema 字段。

## 契约边界

每个 feature phase 都有一份 `skill-contract@1`，至少声明：

- required / optional inputs；
- produces 与 verification checks；
- quality tiers 及其输入条件；
- 与 workflow phase 的绑定。

契约由 [`skill-contract.ts`](../../harness/scripts/utils/skill-contract.ts) 加载和校验，跨 Skill 一致性由 consistency checker 检查。新增 phase 或改变产物语义时，应先修改 contract，再修改 Skill 和检查器；不能只改 Markdown。

## Summary 1.2 与 closure

所有 phase 的 `summary.json` 使用 schema `1.2`，包含：

- `verdict`；
- `depth` 与缺失的 optional inputs；
- blocker 和 evidence 身份；
- full track 上的 `closure_status` / `closure_commit`。

`PASS` 只是当前检查结果。full track 只有在 closure commit 与新鲜 evidence 绑定后才算 closed；lite track 由退出报告闭环。旧 schema、开放 closure、过期 evidence 都不会被 `assess` 当作可推进事实。

## 质量深度

质量深度是 contract-local 的，不是全局硬编码：

- `full`：可选输入齐备，执行完整检查面；
- `basic`：缺少可选输入时的可解释降级；
- phase 可声明自己的 tier 名称与替代输入。

`minimum_depth_by_phase` 可以要求某 phase 的最低深度。未达到时，`assess@1` 推荐恢复输入并重跑，而不是把缺输入伪装成失败或 PASS。

## `assess@1`

[`assess.ts`](../../harness/scripts/utils/assess.ts) 是 level-triggered、无 LLM 的确定性评估器。它每次从当前磁盘事实重算：

```text
workflow + track + goal
  + summary 1.2 + closure + evidence freshness
  + ReconcileObservation@1
  → gaps + one recommendation + fingerprints
```

`next.json` 只是可重建投影，不是权威状态。任何输入指纹变化都会使缓存失效并重算。从实例工程 `framework/harness/` 运行 `npx ts-node scripts/assess.ts --project-root <repo-root> --framework-root <repo-root>/framework --feature <feature>` 会校验输入指纹并原子刷新 `<paths.features_dir>/<feature>/next.json`；只读观察使用 `--no-write`。

Assess 负责“哪个工作现在合格且值得做”；driver 负责“是否获授权、是否还有预算、是否安全执行”。推荐永远不自动授予权限。

## 扩展检查清单

新增或调整 Skill 时：

1. 更新 `skills/feature/<skill>/contract.yaml` 及 `specs/skill-contract-schema.yaml`；
2. 保证 workflow phase、Skill、contract 一一对齐；
3. 让 checker 输出 summary 1.2 的 depth、缺失输入和 closure；
4. 为 assess gap/recommendation 增加确定性 fixture；
5. 运行 `cd harness && npm test`。

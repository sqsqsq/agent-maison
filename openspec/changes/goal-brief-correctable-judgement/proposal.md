## Why

只有 goal 阶段执行者被显式注入需求原文；视觉 provider、verifier、review 没有统一的目标输入，"明确不做"没有同源通道。执行者依据需求拒修会被判成修复无效而终局，裁判原样再报会撞整轮指纹重复同样终局，拒修依据到不了下一轮裁判。缺陷词汇里没有"实现有、目标不要"的类别，锚在被排除元素上的任何缺陷都会被剔除，越权实现的内容因此无人回收。实施蓝本：`.cursor/plans/统一目标上下文与权威判定_目标简报同源注入与判断双向可纠正_33784ed1.plan.md`。

## What Changes

- 一个组装函数与一个渲染函数从既有真源现算目标简报，同源注入全部执行者与裁判，并作为一个文本分量进入 verifier 材料摘要；不落盘、不成为输入绑定。
- 执行者可在既有 `headless-assumptions.jsonl` 账本（schema 不变）逐候选写拒修记录；引文与 `ref_elements_excluded` 共用同一个逐字核对函数。
- 来源核验通过的第一次拒修不算已尝试、零改动且本轮全部拒修时不判无效修复；裁判再次提出即反驳轮，整轮重复判断放行一次；第二次拒修起照常计入，沿用既有停机原因并在说明里并列双方原文。状态只由交付周期内的事件与账本回放得出。
- 缺陷类别新增 `unexpected_render`，授权在唯一判定函数内按方向区分；provider 载荷贯通新类别与 `requirement_quote`。
- review 的 verifier 模板增加"多做核对"，不新增分类值域。

不新增停机原因、回退预算、manifest、持久文件或语义判定。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`：返修收敛的已尝试记录、零改动判定与整轮重复判断认来源核验通过的拒修与一次反驳轮；视觉缺陷授权按方向区分。
- `delegated-vision`：provider 拿到目标简报，缺陷词汇含反方向，载荷三处贯通引文字段。
- `visual-diff`：缺陷类别枚举加入 `unexpected_render` 及其字段约束（element 或 bbox 至少一个；`requirement_quote` 可选、须为字符串），既有类别与载荷不变。
- `skill-contracts`：目标简报同源注入全部参与方；拒修记录的写法与核验；review 多做核对。

## Impact

`harness/scripts/utils/goal-brief.ts`（新）、`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/repair-candidates.ts`、`harness/scripts/utils/fidelity-shared.ts`、`harness/scripts/check-spec.ts`、`harness/scripts/utils/goal-runner-phase.ts`、`harness/scripts/utils/verifier-material.ts`、`harness/scripts/utils/report-generator.ts`、`harness/harness-runner.ts`、`profiles/hmos-app/harness/visual-diff-check.ts`、`profiles/hmos-app/harness/visual-provider-review.ts`、`harness/prompts/verify-review.md`、`skills/reference/agent-behavioral-principles.md` 及相关文档。升级后在途 feature 的 verifier subject 各换一次；历史有 PASS 的阶段走既有沿用分支出 MAJOR 警告。

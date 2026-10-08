## Why

宿主 be091c 在功能真机通过、视觉因外部能力缺席停放后，授权更换视觉 provider；运行时接受了唯一字段 `visual_provider_pin` 的变更，但旧 coding 证据绑定整份 run manifest，导致全链假失效，testing 两次零 agent gate 后无进展停机。需要按既有四条总设计原则收编运行配置、业务证据与责任恢复，消除合法续跑的确定性失败。

## What Changes

- 删除闭环内容证据对所有历史 run manifest 字节的自动依赖，复用已有当前需求哈希、有效范围和业务输入绑定；同步 collector 的 completion aggregate 回落，不修改旧 requirement/completion 哈希。
- 统一旧 evidence / facts 的读侧兼容及新 writer，以规范同 feature 权威 run 的 input-only 控制面、非显式业务声明及当前非空语义依据界定退休集合；facts 回连原建立阶段 evidence，阻止退休依赖经 baseline 再次写回，不增加 provider 字段豁免表。
- 当前 facts 入场阻塞且存在明确上游责任 gap 时，优先走既有责任恢复；没有 executor 机会的 gate 不先触发内容无进展熔断。硬预算、授权、写边界及真正无进展保护不变。
- 通过正式授权切换路径继续 testing，以新 provider 的真实调用及有效视觉证据收口；配置更新不代表验收通过。
- 扩展 c3f8a2d7 的连续回放，增加 provider 切换与真实业务变化反例，随后单独记录宿主 H1。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: 当前业务内容依赖、旧 manifest 输入依赖兼容及视觉补验边界。
- `goal-runner`: 授权配置变化后的责任恢复、输入阻塞与内容重试的执行顺序。

## Impact

实施真源为 `.cursor/plans/运行配置与业务证据解耦_授权变更续跑与上游恢复同源_8d4e6a21.plan.md`（版本 3.1.0）。影响 coding/review/ut 的证据复用、testing 补验及共享恢复路径。

主要代码范围：`fidelity-shared.ts`、`phase-closure-finalizer.ts`、`phase-evidence-manifest.ts`、`capability-resolution-entry-input.ts`、`context-facts.ts`、`assess.ts`、`harness/harness-runner.ts` 与 `goal-phase-runtime.ts`；补接 upstream gate/closure、revalidate、feature/component/completion/owner freshness 的既有调用上下文，具体消费点见 plan §4.2。视觉侧复用 `visual-provider-review.ts` / `visual-provider-invoke.ts`。旧证据自动兼容，不要求消费者手改 run、回执或哈希；MIGRATION 与运维文档须说明失效范围的收窄及真实输入变化仍须重验。

不新增运行状态、字段协议、停机原因、注册表、外部存储或常态人工确认；不改用户冻结的视觉型号。宿主仅通过 Maison 校验的发布件集成。初次起草仅产提案；用户现已授权 plan 与代码的开发/评审/修复循环，plan 收口后调度直接下发实施。当前文档轮不实施、提交、打包或宿主续跑，H1 的外部能力及授权条件单独保留。

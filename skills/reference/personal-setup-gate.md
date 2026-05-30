# Personal Setup 门控（feature phase 入口）

Feature phase（Skill 1～6）与对应 adapter slash / skills-bridge 入口在跑 harness **之前**须确认个人 setup 已完成。

## 探测（BLOCKER）

```bash
cd framework/harness && npx ts-node scripts/check-personal-setup.ts --project-root <repo-root>
```

- **exit 0**：`getFrameworkPersonalSetupStatus().source` 为 `local` 或 `project_legacy`，且 **active adapter ∈ materialized_adapters**，且 **adapter 入口产物已物化**
- **exit 1**：`fallback` / 不在 materialized 列表 / 入口文件缺失 → **STOP**，引导 [`/framework-setup`](../00b-framework-setup/SKILL.md) 或 `/framework-init`

与 [`harness-runner.ts`](../../harness/harness-runner.ts) pre-phase 门控语义一致；init / catalog / glossary / docs 全局 phase 豁免（见 runner `personalSetupExemptPhases`）。

## 相关

- Tier_1 npm：[host-harness-readiness.md](./host-harness-readiness.md)
- 项目 vs personal 职责：[00-framework-init](../00-framework-init/SKILL.md) · [00b-framework-setup](../00b-framework-setup/SKILL.md)

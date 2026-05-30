# Personal Setup 门控（阶段入口前置）

Feature phase（Skill 0 catalog/glossary、Skill 1～6）与对应 adapter slash / skills-bridge 入口在跑 harness **之前**须完成个人 setup。

## 探测（BLOCKER）

```bash
cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>
```

**仅解析 stdout JSON**（稳定字段：`ok`, `code`, `status`, `activeAdapter`, `materializedAdapters`, `ensured`, `candidates`, `message`）。勿依赖人读 stderr/stdout 散文。

| `code` | 行为 |
|--------|------|
| `ok` | 已就绪（或 `--ensure` 已自动写入 local）→ 继续本阶段 |
| `needs_adapter_choice` | 多 adapter：用 registry **`setup.adapter`** 选择 → `init-orchestrate --scope personal` 的 **`record-adapter`** 写盘（agent 不手写 JSON） |
| `no_materialized_adapter` | 项目未物化 adapter → **STOP**，引导 `/framework-init` |
| `not_in_materialized` / `entry_not_materialized` | 项目级缺口 → **STOP**，引导 `/framework-init` |

与 [`harness-runner.ts`](../../harness/harness-runner.ts) pre-phase 门控语义一致；`init` / `docs` 全局 phase 豁免。`init` 内部 `run-global-phases` 使用 `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1`（集成者自验，非普通入口）。

## 内联 setup 过程（多 adapter 或 DevEco）

完整步骤见内部过程文档 [`00b-framework-setup`](../00b-framework-setup/SKILL.md)（**无** slash 命令、无 skills-bridge 跳板）。

## 相关

- Tier_1 npm：[host-harness-readiness.md](./host-harness-readiness.md)
- 项目 vs personal：[00-framework-init](../00-framework-init/SKILL.md)

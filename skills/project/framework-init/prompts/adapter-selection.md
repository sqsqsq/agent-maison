# Adapter 与物化清单（编排化 · framework-init S2）

> **项目 init** 使用 registry **`init.materialized_adapters`**（多选 checkbox），写入 `framework.config.json` → `materialized_adapters[]`。  
> **个人 active adapter** 由阶段入口 **`check-personal-setup.ts --json --ensure`** 内联；多 adapter 时用 registry **`setup.adapter`**（只能从已物化项中选）。

## 候选来源

扫描 `framework/agents/*/adapter.yaml` 的 `adapter_name` + `description`；推荐逻辑见 [framework/agents/README.md](../../../../agents/README.md)「materialized_adapters 多选建议」。

## BLOCKER

- S2 须 **`init.materialized_adapters`** widget / 编号菜单；**禁止**沿用 legacy `init.adapter` 单选作为项目 init 唯一入口。
- **禁止**在 project init 写入 `framework.local.json` 或选择 personal active adapter。
- `generic` 物化：无自定义需求时**直接用** template 默认 `.agents` / `bridge` 写入 S2 `configWritePayload`，**不得 STOP** 或剔除 `generic`；仅用户**显式要求**非标 `agent_bundle_root` 时 STOP → 手动编辑 `framework.config.json` 后重跑。

## 决策复述

用户选定后复述：`materialized_adapters=[...]` 及将物化的入口/目录（见 agents README 产物速查表）。

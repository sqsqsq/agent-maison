# Design: Framework Setup 前置门控

## Flow

阶段入口 → `check-personal-setup.ts --json --ensure` → 解析稳定 JSON → 继续 harness 或内联 setup / 引导 init。

## Key decisions

1. **无用户可见 setup 命令**：个人配置只通过 `--ensure` 或 `setup.adapter` + `record-adapter` 写盘。
2. **init 内部自验**：`runGlobalPhases` 注入 `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1`；harness-runner 识别后跳过 personal gate。
3. **JSON 契约**：`{ ok, code, status, activeAdapter, materializedAdapters, ensured, candidates, message }`；测试与 Skill 只解析 JSON。

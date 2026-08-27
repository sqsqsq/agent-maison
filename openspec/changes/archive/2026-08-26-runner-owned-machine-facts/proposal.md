## Why

宿主真实回归（SimulatedWalletForHmos bc-openCard，run `20260815T023016Z-8c66cf`）实证了两处"机器已知的事实让 agent 手抄"的结构性浪费：

1. `acceptance_flow_structure` 要求 agent 为每条 P0 AC 计算 `snippet_sha256`——门禁自己本来就在重算这个 hash 做对拍。无 shell 权限的 headless agent（宿主 permissions 全 deny 是常态）在此撞死：一个 attempt（约 28 分钟）被烧掉，唯一出路是宿主放开 shell 权限。抄写一个机器可派生的值不增加任何可信度，只制造权限依赖。
2. 回执 `claimed_attempt_id` 要求 agent 从环境抄 runner 的 attempt 身份——现场有两个格式来源（env `MAISON_GOAL_ATTEMPT="i3"` / `progress.json.phase.attempt=3`），agent 抄了后者，goal 态精确等值校验正确地判 `receipt_status=failed`，两次 advance_blocked 直达 `closure_wall_repeated`，一次本可正常收尾的 spec run 终止。runner 明知 `i3`，让 agent 再抄一遍同样不产生新增可信度。

职责归位：机器事实由机器写入；agent 只提供机器不可替代的自证。不放宽任何门禁、不增加重试、不做 `"3"`/`"i3"` 双格式兼容。

## What Changes

- `requirement_ref` 收窄为 `{source_path, snippet}`：门禁读取源文档、验证 snippet 逐字在场；内部需要 hash 时自行派生，不写回产物、不要求 agent 提供。存量 YAML 中的 `snippet_sha256` 被忽略，无需迁移。
- 回执骨架的身份字段（`feature` / `phase` / goal 态 `claimed_attempt_id`）由 runner/harness 预填；closure-only invocation 开始前 runner 用当前 attempt 身份重建未完成骨架，同时作废上一 attempt 的旧回执（旧完整声明不得让新 attempt 被完成观测提前判完）。goal 态 `claimed_attempt_id` 与 runner 身份的精确等值校验保持不变；非 goal 人工态保持留空+时间新鲜度兼容行为。

## Impact

- `harness/scripts/utils/p0-semantic-gates.ts`（gate 字段减法）
- `harness/scripts/utils/receipt-scaffold.ts`（新增共享骨架写入，runner-owned 身份字段）
- `harness/harness-runner.ts`（PASS 骨架生成改走共享实现并预填 attempt 身份）
- `harness/scripts/goal-runner.ts`（closure-only attempt 前重建骨架）
- `harness/scripts/check-receipt.ts`（身份字段缺失/失配的指引文案对齐 runner-owned 语义）
- `harness/templates/phase-completion-receipt.md`（agent 不得编辑身份字段）
- 消费者无迁移成本：存量 `snippet_sha256` 惰性遗留；旧回执在下一 closure attempt 前被骨架重建自然替换。

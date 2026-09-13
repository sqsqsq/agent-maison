## Why

P1–P6 已通过，需要将动态范围接入 CU/Component 完成消费、新旧运行兼容与公开默认入口，避免按旧固定链要求无义务阶段或把专项结果当整体完成。按已定稿 P7 实施，不重做架构评审。

## What Changes

- 复用 P2 冻结范围验证完成指纹、来源、目标覆盖与真实运行血缘；旧 completion 按旧合同读取。
- 收编 CU handoff/expected execution 与需求/P0 证据的实际来源读取。
- **BREAKING** 新任务默认动态协议；退役 change-lite/exit 公共新任务入口，UPDATE 先备份再清理跳板，保留内部旧 run 恢复。
- 更新 MIGRATION，执行组合夹具与候选发布件临时 consumer 验证；真实宿主项独立记录。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: 分层完成、范围绑定与实际输入来源。
- `change-unit-continuous-progression`: CU 范围消费及目标覆盖。
- `workflow-tracks`: 新默认、旧运行窄兼容与公开入口退役。

## Impact

影响 completion writer/reader、CU 推进、workflow/Skill 索引、adapter UPDATE 和现行文档。无新状态、执行器或依赖；不改写消费者历史。本次不是发版授权，真实设备及宿主不可用时保留对应 todo。

## Why

真机 testing 已能产出可信 `test_contract` 证据，但 goal 层仍可能把它归成 `code_regression`，在 retry/`--resume` 时继续注入修改产品源码的话术；同时锁屏自动解锁缺少“展示 PIN 键盘后重新取证”的保守状态机契约，导致时钟数字、人脸重试提示等真实 UI 形态被误判。两者都会让真机验证阶段对错误对象采取动作，需要在 3.0.0 窗口固化为可回归的 goal-runner 行为。

## What Changes

- 在既有 `FailureKind` 体系内新增 `test_contract`：仅当已通过绑定校验和根/级联裁决的非空根失败全部为 `test_contract` 时，才把 testing 的基础 `code_regression` 后置精修为该分类。
- 持久化精修后的分类，并让同进程 retry 与 `--resume` 从事件恢复；`test_contract` prompt 明确修测试契约/锚点而非产品源码，不改变现有 retry、halt 和 backtrack 策略。
- 将 HarmonyOS 锁屏解锁定义为一次有界状态迁移：wake 后确认锁屏，必要时执行一次非秘密上滑，重新取同源快照，只有完整可信的 PIN 键盘且无冷却/歧义时才输入登记凭据。
- 将 PIN 键盘识别、冷却三态和隐私边界写入契约；通知文本、人脸提示、时钟数字不得参与错误判定或进入事件 notes。
- 更新 goal-mode 运维说明与真实脱敏 fixture 回归。无消费者迁移要求，不修改 Phase 0–6 产物格式的必填字段。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: 增加 testing 可信证据的 `test_contract` 后置归因、跨 retry/resume 恢复与专用 prompt；收紧设备就绪门内锁屏 reveal、PIN 键盘识别、冷却三态及隐私行为。

## Impact

- 受影响阶段：goal-mode 的 testing 失败归因，以及声明 `requires_device` 的阶段在 agent invocation 前执行的设备就绪门。
- 受影响实现：`harness/scripts/goal-runner.ts`、goal failure/phase utilities、device readiness/unlock utilities、HarmonyOS profile bridge、对应 unit/E2E 与 `docs/operations/goal-mode-runbook.md`。
- 兼容性：新增可选枚举值和事件值；旧 evidence、非 testing 阶段及无设备需求阶段行为保持不变。`MIGRATION.md` 无需修改。

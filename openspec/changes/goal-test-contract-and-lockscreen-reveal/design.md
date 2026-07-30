## Context

testing 的基础 failure classifier 只能从 harness summary 判断，设备用例失败会保守落到 `code_regression`。但 collector 随后会读取并校验 `device-test-evidence.json`，已经掌握经 run/session/target 绑定与 `test_case_flow` 根因裁决后的分类；此前这份更可信的信息没有回流到 goal verdict、retry context 和 resume。

锁屏侧的旧实现则把一次 UI dump 同时当作“锁屏存在”“键盘已展示”“允许输入”的证据，并在过宽子树上扫描数字和冷却文本。真机四帧显示 wake 后首先出现的是时钟，PIN 键盘需要上滑展示，数字主要位于 `originalText`，人脸失败提示中的“重试”也不是 PIN 冷却。

## Goals / Non-Goals

**Goals:**

- 用 collector 已验证的根失败分类后置精修 testing verdict，并跨 retry/`--resume` 保持一致。
- 让 `test_contract` 只改变归因与 prompt，不扩大自动回退、重试或 halt 权限。
- 以一次 reveal + 新快照构成有界解锁状态机；任何身份、键盘、几何或冷却不确定性都保持零输入。
- 让真实脱敏 fixture、同进程 retry、`--resume` 和事件出口成为自动回归的一部分。

**Non-Goals:**

- 不从 UI 文本猜测 PIN，不新增凭据存储或诊断 dump 产品能力。
- 不把任意设备用例失败都归为 `test_contract`，不绕过 evidence 绑定/根因裁决。
- 不泛化修复所有厂商锁屏布局；无法证明为受支持 PIN 键盘时安全失败。
- 不改变现有 phase retry 数、signature halt 家族或 backtrack 策略。

## Decisions

1. **在 collector 之后精修，而非扩张基础 classifier。** 基础 classifier 无设备 evidence 信任上下文；collector 已完成绑定校验和根/级联过滤。仅当基础分类是 `code_regression`、可信根分类非空且全部为 `test_contract` 时覆盖。混合分类、缺 evidence 或绑定失败均保持原分类。

2. **以 `phase_verdict.failure_kind_classified` 作为恢复 SSOT。** 当前 attempt 的精修值写入 verdict；同进程 continuation 与 `--resume` 回放最新相关事件恢复它。agent timeout / API error 等本 attempt 运行信号仍按既有优先级覆盖。`test_contract` 使用专用 prompt，明确检查 selector、ui-spec、测试锚点和 runner 契约，不要求修改产品源码。

3. **一次 reveal 是状态迁移，不是盲重试。** 顺序固定为 `wake → snapshot → (locked 且无完整 keypad 时 reveal 一次) → snapshot → validate → input → verify`。HarmonyOS `uitest uiInput swipe` 第五参数按设备 CLI 定义为 velocity（200–40000 px/s）；实现使用合法的 300 px/s，并以命名/注释表达速度语义。

4. **PIN 与冷却使用窄作用域、结构化三态。** PIN 只读取 `Digital_PSD_Input_Tip`，单键优先 `originalText`、空时兼容 `text`，要求 0–9 唯一、bounds 有效且三列四行几何可信。冷却只读取认证/Bouncer 子树，排除通知子树和人脸提示，输出 `cooldown | not_cooldown | ambiguous`；后两种不等价，`cooldown` 与 `ambiguous` 均禁止输入。

5. **事件只投影稳定结论。** unlock helper 返回固定 rule id/固定 note；`device_unlock_attempt`、`device_ready.notes` 与 `phase_halt.notes` 共享该净化结果，不保留原始 UI 或通知文本。

## Risks / Trade-offs

- **[Risk] 新厂商布局无法通过几何校验** → 保守零输入并进入外部阻塞；新增布局须先以脱敏 fixture 扩契约。
- **[Risk] evidence 根因流缺失导致无法精修** → fail-safe 保留 `code_regression`，不以不完整证据自动改变归因。
- **[Risk] velocity 在不同系统版本上的体感不同** → 使用设备 CLI 明示范围内的值，并以一次真机事件级验收覆盖当前支持设备。
- **[Trade-off] 一次 reveal 可能不足以处理动画/特殊锁屏** → 不增加 sleep 或多轮盲手势；安全性优先于自动解锁成功率。

## Migration Plan

发布时随 3.0.0 framework 更新，无配置迁移。旧 run 缺少 `test_contract` verdict 时继续按旧分类恢复；新 run 写入新枚举值。回滚可整体恢复 goal attribution 与 device unlock utility，不涉及消费者数据迁移。

## Open Questions

无。

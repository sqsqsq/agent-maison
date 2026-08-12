# Delta: Goal Runner — 生成物分类降级与 device_test 缺陷回修

## ADDED Requirements

### Requirement: Build-generated source files are classified, not treated as violations

goal-runner 在 testing 阶段 invoke 前后快照 diff 的消费处（violation 裁决时刻，早于receipt/journal/gate）MUST 将变更逐项交由 profile 生成物分类器判定。三判据全中的条目MUST 降级为 `testing_generated_file_change` 事件（透明记录文件清单），MUST NOT halt、MUST NOT 进入 run 终止态（`--resume` 不受影响）：

1. 路径等于根 build-profile.json5 某 `modules[].srcPath + '/BuildProfile.ets'`（模块根，
   任意嵌套目录 MUST NOT 进入例外）；
2. 变化类型仅 added/modified（removed/type-changed MUST 维持 violation）；
3. 盘上现内容为合法 hvigor 模板结构（模板外零多余语句）且四常量值与 attempt 冻结配置
   推导结果逐值一致。

混合场景（真违规与生成物并存）MUST 维持 violation 与 halt，violation 事件的 `changed`
MUST 只列真违规，生成物 MUST 单列 `generated_changed` 字段。分类器不可用或判定异常时
MUST 全部按 violation 处理（fail-closed）。快照采集范围与算法 MUST NOT 因此改变。

#### Scenario: hvigor 合法重写模块根 BuildProfile.ets
- **WHEN** testing invoke 内 harness 构建重写三个模块根的 BuildProfile.ets，内容与冻结
  配置推导一致
- **THEN** 记 `testing_generated_file_change` 事件，不 halt，receipt/journal/gate 照常，
  同 run 后续 `--resume` 不被拒绝

#### Scenario: 篡改的 BuildProfile.ets 仍是违规
- **WHEN** 变更文件含模板外语句，或常量值与冻结配置推导不符，或文件被删除/变类型
- **THEN** 维持 `testing_write_violation` 终止态语义

### Requirement: Device-test build configuration is frozen per attempt

goal-runner MUST 在 testing attempt 开始时解析并冻结 {product, buildMode}，并经环境变量`HARNESS_DEVICE_TEST_PRODUCT`/`HARNESS_DEVICE_TEST_BUILD_MODE` 同发 agent 与 gate harness、直传生成物分类器（三方同源）。注入前 MUST 对目标键执行大小写无关清理后只写唯一大写键。agent 在其子进程内临时覆盖这两个变量属不受支持行为；生成物与冻结值不符MUST 判 violation（fail-closed）。

#### Scenario: agent 内临时覆盖不导致分类漂移
- **WHEN** agent 子进程内以不同 buildMode 触发构建，生成物常量与冻结配置不符
- **THEN** 分类器按冻结配置判定为 violation，不采用 agent 侧环境值

### Requirement: Device-test defects join the existing backtrack loop

`ActionableDefect.source` MUST 支持 `'device_test'`。goal-runner 的缺陷收集 MUST 只消费正式 gate 写出的 `device-test-evidence.json`，且 MUST 在 spawn gate harness 之前删除该文件（窗口内单写者防伪）。消费前 MUST 校验：goal_run_id/attempt_id 与当前精确相等；device_target 与当前 attempt 冻结设备元组精确相等（由 runner 内存直传，MUST NOT 从事件反推）；install_executed 与 install_ok 为真；trace_path 与权威 trace resolver 结果一致；`written_at`（collector 唯一时间裁决字段，文件 mtime 仅诊断）与 run meta 的run_started_at/run_ended_at 同落本 attempt 的 harness_start~harness_end 窗口。

仅 `device_target.target_kind === 'physical'` 且 `classification === 'product_actionable'`
的 case MUST 进入 ActionableDefect 走既有 `backtrack_to_coding` 与 roundFingerprint
无进展熔断；根/级联三分 MUST 复用 test_case_flow triage，级联 case MUST NOT 产生缺陷；
其余（emulator/unknown、environment/test_contract/unknown 分类、evidence 在场但任一
校验不满足）MUST 进入 unverified 通路；evidence 文件缺失 MUST 视为本轮无 device_test
信号（不产生缺陷也不产生 unverified——正式 gate 未达写入门槛时 run 门禁本身已 FAIL，
由既有重试路径接管；旧 trace/旧产物因此天然不驱动回修）。unverified entries MUST 携带
source（visual|device_test），retry/halt 指引 MUST 按 source 分支；事件类型名
`unverifiable_must_fix` MUST 保持不变。

#### Scenario: 真机 spec 锚点缺失自动回修
- **WHEN** 正式 gate evidence 中某根故障 case 分类为 product_actionable 且
  target_kind=physical，全部身份校验通过
- **THEN** 生成 source='device_test' 的 ActionableDefect，runner 回退 coding 并注入缺陷

#### Scenario: 身份或设备不匹配不驱动回修
- **WHEN** evidence 的 run/attempt/device_target/trace/时间窗任一与当前 attempt 不符，
  或 target_kind 非 physical
- **THEN** 相关 case 进入 unverified 通路（retry 引导重采，耗尽 halt），不回退 coding

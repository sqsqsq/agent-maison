# goal-runner Spec Delta

## MODIFIED Requirements

### Requirement: Device-test defects join the existing backtrack loop

`ActionableDefect.source` MUST 支持 `'device_test'`。goal-runner 的缺陷收集 MUST 只消费正式 gate 写出的 `device-test-evidence.json`，且 MUST 在 spawn gate harness 之前删除该文件（窗口内单写者防伪）。消费前 MUST 校验：goal_run_id/attempt_id 与当前精确相等；device_target 与当前 attempt 冻结设备元组精确相等（由 runner 内存直传，MUST NOT 从事件反推）；trace_path 与权威 trace resolver 结果一致；`written_at`（collector 唯一时间裁决字段，文件 mtime 仅诊断）落本 attempt 的 harness_start~harness_end 窗口。

装机与设备执行两项事实按 doc 的复用字段分两种口径（字段全部可选，schema_version 仍 1.1；无字段的 doc 即非复用 doc，其校验逐字不变）：

- 非复用 doc：install_executed 与 install_ok 为真；run meta 的 run_started_at/run_ended_at 同落本 attempt 的 harness 窗口。
- `install_reused=true`：MUST NOT 要求本轮真装，改核 `hap_sha256_full` 等于**当前盘上 HAP 的完整摘要**。该摘要由 goal 运行时在组装 collector 上下文时从既有装机产物算出：读 `device-test-install.meta.json` 的 `hapPath` / `hapMtimeMs` / `hapSizeBytes` / 12 位 `hapSha256`，对盘上文件核 mtime 与 size 一致后算 sha256 全量并要求短指纹为其前缀；任一不符或 meta 缺失 → 摘要不可核验 → 该 doc 不采信。MUST NOT 与 doc 自身字段比较，MUST NOT 新增身份系统。
- `reused_by_execution_key=true`：doc MUST 带 `execution_key` 与 `reused_run_dir`（相对 projectRoot）；采信 MUST 读该目录的 `execution-key.json`，要求 `record.execution_key === doc.execution_key` 且记录通过与 `decideReuse` **同一**身份判据（`isExecutionRecordReusable`：同键、outcome=success、trace 在盘、execution 组冻结件齐；derived 组缺失或 `timing_complete=false` MUST NOT 是拒绝理由——它们在 decideReuse 里走重建通道），并 MUST 跳过 run meta 时间窗（复用回填的是被复用 run 的冻结 meta）。采信规则 MUST NOT 比 `decideReuse` 更严。

正式 gate 的写出门槛与之对应：装机事实已知（本轮真装成功，或装机复用同 HAP 且 install provider 同源回传了完整摘要）∧ 设备执行事实存在（真跑或同键复用且 trace 在盘）才写；两者任一未知照旧不写（上游门禁裁决）。

仅 `device_target.target_kind === 'physical'` 且 `classification === 'product_actionable'`
的 case MUST 进入 ActionableDefect 走既有 `backtrack_to_coding` 与 roundFingerprint
无进展熔断；根/级联三分 MUST 复用 test_case_flow triage，级联 case MUST NOT 产生缺陷；
其余（emulator/unknown、environment/test_contract/unknown 分类、evidence 在场但任一
校验不满足）MUST 进入 unverified 通路；evidence 文件缺失 MUST 视为本轮无 device_test
信号（不产生缺陷也不产生 unverified——正式 gate 未达写入门槛时 run 门禁本身已 FAIL，
由既有重试路径接管；旧 trace/旧产物因此天然不驱动回修）。unverified entries MUST 携带
source（visual|device_test），retry/halt 指引 MUST 按 source 分支；事件类型名
`unverifiable_must_fix` MUST 保持不变。

unverified entries 本身（证据身份不齐、待重采——evidence 绑定失败、截图/build 身份不匹配等）MUST NOT 单独构成本 attempt 的运行期失败事实：仅此类 unverified（脚本 PASS、零 blocker、无可信缺陷、无可信真机根失败、无超时/崩溃/非零退出/closure 定稿错误）的轮次 MUST NOT 写 `failure_kind_classified` 与 blocker_signature，`unverifiableOnly` 的 retry 处置不变。绑定**通过**且根 case 失败的可信真机证据（`trustedDeviceRootClassifications` 非空，含走 unverified 通路的 test_contract/environment/unknown 分类）仍是失败事实——否则「Test-contract attribution survives retry and resume」的 `test_contract` 归因无法持久化；unverified 与任一其他失败事实并存时归因照旧保留。

#### Scenario: 真机 spec 锚点缺失自动回修
- **WHEN** 正式 gate evidence 中某根故障 case 分类为 product_actionable 且
  target_kind=physical，全部身份校验通过
- **THEN** 生成 source='device_test' 的 ActionableDefect，runner 回退 coding 并注入缺陷

#### Scenario: 身份或设备不匹配不驱动回修
- **WHEN** evidence 的 run/attempt/device_target/trace/时间窗任一与当前 attempt 不符，
  或 target_kind 非 physical
- **THEN** 相关 case 进入 unverified 通路（retry 引导重采，耗尽 halt），不回退 coding

#### Scenario: 装机复用 + 设备真跑的证据照常写出并采信
- **WHEN** 本轮 install provider 走复用分支（同 HAP、设备已装）并回传完整摘要，device_test.run 真跑，正式 gate 写出 `install_reused=true` / `reused_by_execution_key=false` 的 doc，install meta 与盘上 HAP 三核一致
- **THEN** collector 采信该 doc（不要求本轮真装），run meta 时间窗照常核验

#### Scenario: 同键复用轮的证据按记录身份采信
- **WHEN** decideReuse 命中最新同键成功 run（执行冻结件齐、`timing_complete=false` 触发派生重建），doc 带 `reused_by_execution_key=true` / `execution_key` / `reused_run_dir`，被复用 run 的冻结 meta 时间在本 attempt 窗口之外
- **THEN** collector 采信该 doc：记录身份通过同一判据，run meta 时间窗被跳过，`written_at` 仍须在窗内
- **AND** 记录键不同、outcome 非 success 或 execution 组冻结件缺失时，返回 `复用记录身份不匹配（<reason>）` 并进入 unverified 通路

#### Scenario: 盘上 HAP 与装机产物不一致时复用装机不采信
- **WHEN** doc 为 `install_reused=true`，而 `device-test-install.meta.json` 缺失、或其 mtime/size/短指纹与盘上 HAP 任一不符
- **THEN** collector 返回 `当前 HAP 完整摘要不可核验` 并进入 unverified 通路

#### Scenario: 仅 unverified 的轮次不带归因
- **WHEN** testing 脚本 PASS、零 blocker，唯一的信号是截图身份不匹配的 must_fix（unverified）
- **THEN** 该轮 `phase_verdict` 为 PASS + retry 且不带 `failure_kind_classified` / blocker_signature
- **AND** 同轮存在 harness FAIL 或可信缺陷时，归因与 blocker_signature 与改动前相同

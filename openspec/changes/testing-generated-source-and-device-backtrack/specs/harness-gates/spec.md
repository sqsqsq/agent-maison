# Delta: Harness Gates — goal 正式 testing gate 强制安装与 evidence 统一写入

## ADDED Requirements

### Requirement: Formal goal testing gate force-installs and writes the sole evidence

goal 模式 testing 的外层 gate harness 内，device_test.install MUST 在`HARNESS_DEVICE_TEST_FORCE_INSTALL`（既有开关，仅由 runner 注入 gate harness 子进程 env）在场时跳过复用、真实执行 `hdc install -r`。install provider MUST 在调用 hdc install 之前计算完整 64 hex 的 HAP sha256 并随结果回传（12 hex 截断指纹的既有消费者 MUST NOT 受影响）。

`device-test-evidence.json` MUST 由 check-testing 协调层在 build→install→run 全部完成后
统一写入（run provider 与 install provider 均 MUST NOT 各自写入）。写入门槛全部满足才写：
`MAISON_GOAL_GATE_HARNESS === '1'`；goal run/attempt 身份完整；install executed 且 ok；
device_test.run 已执行且本轮 hylyre trace 路径非空；写前复算当前 HAP 完整 sha 与装机前
一致。trace_path MUST 直取本轮 pipeline holder 的 trace 路径（writer MUST NOT 自行调用
authoritative resolver 寻找 trace）。schema MUST 含 `written_at`（写入时刻，供 collector
作唯一时间裁决字段）与 device_target{serial, target_kind, session_id}（取 gate 进程 env
中就绪门冻结注入的设备身份）。

真实安装与 device_test.run 都已成功而 evidence 未能写出（compose 失败——含写前复算 HAP
sha 与装机前不一致——或写盘异常）时，check-testing MUST 产出 `device_test_evidence`
BLOCKER FAIL 并进入 results（MUST NOT 静默吞——否则 collector 把缺文件当无信号，旧包/
被改写 HAP 的结果可能被误当有效放行）。上游 install/run 本身失败时本步 MUST 返回空
（由既有 install/run 门禁裁决，不重复报）。

普通模式（无 flag、无 goal 身份）的 install 复用策略与既有行为 MUST 保持零变化。

#### Scenario: 正式 gate 强装并产出 evidence
- **WHEN** goal testing gate harness 完成 build→install→run 且门槛全部满足
- **THEN** 覆盖式写入 device-test-evidence.json，含身份/设备元组/full sha/written_at/cases

#### Scenario: 安装成功但 run 未产出 trace 不写 evidence
- **WHEN** install ok 但 device_test.run 未执行或本轮 trace 缺失
- **THEN** 不写 evidence（防误用历史 trace）；run gate 本身 FAIL，collector 不产生
  device_test 信号

#### Scenario: 真实安装与 run 已成功但 evidence 写不出
- **WHEN** 强装与 device_test.run 均成功，但 compose 失败（如 HAP 装机后被并发改写）或
  evidence 写盘异常
- **THEN** check-testing 产出 device_test_evidence BLOCKER FAIL（不静默）

#### Scenario: 普通模式行为不变
- **WHEN** 普通模式跑 check-testing（无 gate flag、无 goal 身份）
- **THEN** install 复用策略与既有一致，不写 evidence

### Requirement: Device-test defect cases carry machine-derived classification

evidence 的 cases[] MUST 由机器产物合成：失败 step MUST 从 trace notes 的机器写入`failure_artifacts` 子句严格解析（basename MUST 落在 failure_dir 内；文件名的 case id 与step index MUST 与该 case 一致；再于选中派生计划中查得该 step 的 selector/动作定义）；缺失、多义或冲突 MUST 标 unjoinable，MUST NOT 按最大 step 或任意现存文件猜测。

classification MUST 为四分类之一：`product_actionable` 须三条件齐备——selector 可归到
spec 声明锚点并推导出 expected screen、失败 step 的 UI dump 命中该 screen 的其他 identity
锚点、仅目标 selector 缺失或形态不满足；`environment` MUST 只消费既有结构化来源（run 级
RunFailureKind 与 install diagnosis kind），MUST NOT 重新扫描散文日志；selector 无 spec
依据或派生计划步骤与 spec 对不上 → `test_contract`；其余 → `unknown`。

#### Scenario: 多组诊断文件只认机器指名的失败 step
- **WHEN** 某 case 的 failure_dir 同时存在多个 step 的诊断文件
- **THEN** 仅按 trace notes failure_artifacts 指名的 step 参与 join，其余不作数

#### Scenario: 环境类失败不归产品缺陷
- **WHEN** run 级 RunFailureKind 为 device_locked/device_disconnect 等环境类
- **THEN** 该轮 cases 分类为 environment，不进入 product_actionable

### Requirement: hmos-app generated-source classifier contract

hmos-app profile MUST 提供生成物分类器：路径判据 MUST 限定到根 build-profile.json5 声明的模块根；内容判据 MUST 为模板结构白名单加四常量逐值等值（HAR_VERSION 取该模块根oh-package.json5 version；BUILD_MODE_NAME/DEBUG 与冻结 buildMode 互相一致；TARGET_NAME按模块 targets 与冻结 product 推导，无显式声明回落 'default'）；MUST NOT 做字节等值比对（hvigor 版本间模板注释措辞可漂移）。

#### Scenario: 常量与冻结配置逐值一致才降级
- **WHEN** 文件为纯模板且 HAR_VERSION/BUILD_MODE_NAME/DEBUG/TARGET_NAME 与冻结配置推导
  完全一致
- **THEN** 分类为合法生成物；任一值不符则不是

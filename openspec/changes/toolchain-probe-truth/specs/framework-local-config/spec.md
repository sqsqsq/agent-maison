# Delta: Framework Local Config — toolchain.probe 三态对象

## ADDED Requirements

### Requirement: Probe object with fixed write-permission semantics

framework.local.json 的 toolchain 段 MUST 增显式建模的 probe 子对象（schema additionalProperties:false）：binary/cli_starts 层、project_compile 三态对象（status ∈ unknown|verified|capability_failed + failure_code/evidence/invocation_fingerprint/observed_at/expires_at）、last_attempt 与 known_quirks 人读段。写入权限 MUST 固定：check-personal-setup --ensure 只能更新 binary/cli_starts；verified 仅由 hvigor wrapper 真实编译成功写入；capability_failed 仅由 wrapper 可信环境分类写入；普通源码编译失败 MUST 保持 unknown。agent 声明 MUST NOT 升级 compile 态；known_quirks MUST NOT 参与任何 gate 判定。

#### Scenario: 新工程首次运行不死锁
- **WHEN** probe.project_compile.status=unknown（首次运行或指纹失效）
- **THEN** phase 前置检查放行本次真实编译（不判缺口不 halt），编译结果经 wrapper 回写状态

#### Scenario: agent 不可自证 verified
- **WHEN** agent 经 --ensure 或直接手编 framework.local.json 声明 compile 可用
- **THEN** project_compile 读取方按 unknown 处理（--ensure 结构上不触碰 compile 态；手编载荷因完整性摘要失配被拒——摘要为防手滑/威慑层级，非密码学；伪造收益面为零：probe 从不放行任何门禁，篡改只能回 unknown=重跑真实编译定谳）

> **Enforced by:** `specs/framework.local.schema.json`, `harness/scripts/utils/personal-setup-gate.ts`, `profiles/hmos-app/harness/hvigor-runner.ts`

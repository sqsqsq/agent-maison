## MODIFIED Requirements

### Requirement: Probe object with fixed write-permission semantics

framework.local.json 的 toolchain 段 MUST 增显式建模的 probe 子对象（schema additionalProperties:false）：binary/cli_starts 层、project_compile 三态对象（status ∈ unknown|verified|capability_failed + failure_code/evidence/invocation_fingerprint/observed_at/expires_at）、last_attempt 与 known_quirks 人读段。写入权限 MUST 固定：check-personal-setup --ensure 只能更新 binary/cli_starts；verified 仅由 hvigor wrapper 真实编译成功写入；capability_failed 仅由 wrapper 可信环境分类写入；普通源码编译失败 MUST 保持 unknown。agent 声明 MUST NOT 升级 compile 态；known_quirks MUST NOT 参与任何 gate 判定。

--ensure MUST 只以现有真实 spawn plan/有效环境执行 --version，同一次探针只解析一次入口。cli_starts MAY 保留入口、cwd、参数、driver、有效 SDK/JAVA_HOME、PATH Java 及来源、退出/超时/启动错误，不保存整个环境或秘密；binary.hvigor_bin 只指向实际 Hvigor 入口文件，不使用 Node 可执行文件或含参数命令冒充。CLI 成功 MUST NOT 升级构建 verified；启动失败或工具缺失 MUST 保留本次 false 与事实，不新增入口硬门禁。人工 reprobe MUST 仅根据本次实际结果决定是否将 capability_failed 降为 unknown，MUST NOT 读取旧 cli_starts.ok 作为本次成功。既有配置、指纹、过期与重探测规则不变。

#### Scenario: 新工程首次运行不死锁
- **WHEN** probe.project_compile.status=unknown（首次运行或指纹失效）
- **THEN** phase 前置检查放行本次真实编译（不判缺口不 halt），编译结果经 wrapper 回写状态

#### Scenario: agent 不可自证 verified
- **WHEN** agent 经 --ensure 或直接手编 framework.local.json 声明 compile 可用
- **THEN** project_compile 读取方按 unknown 处理（--ensure 结构上不触碰 compile 态；手编载荷因完整性摘要失配被拒——摘要为防手滑/威慑层级，非密码学；伪造收益面为零：probe 从不放行任何门禁，篡改只能回 unknown=重跑真实编译定谳）

#### Scenario: CLI starts but the project has not built
- **WHEN** the shared --version invocation succeeds under the selected Node/wrapper configuration
- **THEN** binary/cli_starts SHALL update without promoting project_compile to verified; only an explicit successful human reprobe MAY retain the existing downgrade from capability_failed to unknown

#### Scenario: Configured entry fails to start
- **WHEN** the shared probe encounters a startup or nonzero-exit failure
- **THEN** cli_starts SHALL retain false with its actual invocation/error facts and SHALL NOT independently create a new phase entry stop

> **Enforced by:** `specs/framework.local.schema.json`, `harness/scripts/utils/framework-local-config.ts`, `harness/scripts/utils/personal-setup-gate.ts`, `profiles/hmos-app/harness/toolchain-probe.ts`, `profiles/hmos-app/harness/hvigor-runner.ts`

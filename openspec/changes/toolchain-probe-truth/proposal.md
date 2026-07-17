# toolchain-probe-truth — 工具链探针分层真值与事实持久化

## Why

plan e6a3c9f4 t6（07-16 宿主事故 A「编译环境反复不正确」）：agent 用 `command -v` 自报"沙箱无 hvigor"污染多轮凭证——而 detect-deveco 候选第一条就是该机安装路径，framework 调用链早已自动派生 DEVECO_SDK_HOME；真实状态"hvigorw 存在但 CLI 编译持续 00303168"是存在性探测（hasHvigor=fs.existsSync）表达不了的粒度；血泪探明的环境事实不落盘，跨会话重演。四轮外部 review 追加：compile 态必须三值防新工程首编译死锁；00303168 归因须证据分层（"版本不兼容"是未经 framework 链验证的强推断）；指纹须唯一共享 helper；缺口码不得复用 deveco_toolchain_missing（路径缺失语义）。

## What Changes

- **t1 探针分层**：binary_exists → cli_starts（真跑 hvigorw --version）→ project_compile 三态对象 `{ status: unknown|verified|capability_failed, failure_code?, evidence[], invocation_fingerprint, observed_at, expires_at }`。unknown（首次/缓存失效）允许一次真实编译、绝不判缺口不 halt；verified 仅由 hvigor wrapper 真实编译成功写入；capability_failed 仅由 wrapper 可信环境分类写入；普通源码编译失败保持 unknown（可记 last_attempt，不进缺口通道）。**compile 态 agent 不可写**；check-personal-setup --ensure 只能更新 binary/cli_starts 层。
- **t2 错误码证据分层分类器**：00303217=sdk_home_missing_or_invalid（提示 framework 调用链已自动派生）；00303168=sdk_component_missing（中性事实）——仅当同时取得 SDK manifest 格式/SDK 版本/hvigor 版本证据才升级 sdk_layout_or_version_incompatible_suspected 并给三选一指引。诊断头部化复用 b4e7a2c9 范式：先把 buildCompactDiagnosticHeader 从 ut-hvigor-test-failure.ts 抽至共享 diagnostic util，再由 hvigor build 链消费（避免反向依赖 UT 聚合模块）。
- **t3 事实持久化**：framework.local.json toolchain 段增显式建模 probe 子对象（schema additionalProperties:false，仿 vision.canary 先例）；invocation fingerprint 由**唯一共享 helper** 计算（wrapper 写入方与 preflight 读取方同源），至少含 module/target/task/product/buildMode + build-profile.json5 hash + hvigor/SDK 工程配置 hash + 依赖锁定态；任一变化/过期失效回 unknown。known_quirks 纯人读，永不参与 gate。
- **t4 缺口码**：capability_failed 转 preflight 缺口用新显式 prerequisite code `deveco_toolchain_capability_failed`（不复用 deveco_toolchain_missing）；仅 failure_code+证据+指纹均新鲜时成立（消费侧见 capability-gap-preflight change）。

显式非目标：capability waiver 放行（t3-full 已出窗）；ut/testing 侧失败分类（b4e7a2c9 已落地）；探测期跑真实编译（verified 只回写不主动探）。

## Capabilities

### Modified Capabilities

- `framework-local-config`：toolchain.probe 子对象 schema 与写入权限语义。
- `harness-gates`：hvigor 错误码证据分层诊断（compile 失败 details 头部化）；personal-setup 前置检查消费 probe 三态。

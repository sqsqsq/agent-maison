## Why

宿主反馈显示 Hvigor 可在签名脚本静默失败后 exit 0；旧 signed 包和跨 product/变体复用会使 testing 或 UT 安装旧代码。探针与构建入口不同、失败直接归外部也让已有合法作者无法继续排查。

## What Changes

- 安装候选限定到所选 product，同模块/目录/basename 验证 signed/unsigned；未知、陈旧不可采用。
- 当前报告成功记录绑定路径、完整 SHA256、product/buildMode 与源码新鲜度；记录缺失回正常构建。
- --version 探针和构建共用 spawn plan/环境/Windows 引用；主应用打包装机 no-daemon 保留增量，UT/纯 compile 策略不扩面，Java 优先级不变。
- 未确认外部的构建/签名缺口交现有统一处置和合法作者，保留原日志、配对和环境事实。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`：HMOS 安装产物采用、主应用复用、UT 同调用出包绑定和执行事实。
- `framework-local-config`：--ensure 的 CLI 探针沿实际入口保留失败/环境事实，不升级构建能力。
- `runtime-policy`：HMOS 可调查失败依据当前授权交共同处置，不按模式或分类码自动外部等待。

## Impact

影响 coding/UT/testing、即席装机共享 provider、工具链 schema 与现行指引。公开入口兼容；旧构建摘要会正常重新构建一次，无消费者手工迁移、无 MIGRATION.md 步骤。request testing 已安装版本语义不变。不发版、不操作真实宿主或设备，不声称签名 400 根因已查明。

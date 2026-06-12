# Framework 多形态演进备忘（非实现承诺）

> 本文记录 **framework** 仍隐含「HarmonyOS / 移动端 app」默认假设的方向性清单，便于未来按 **modality（形态）** 渐进剥离。  
> **当前版本不实现**下文中的结构性改造，仅作维护者对齐上下文用。

## 仍带 App/ArkTS 偏置的配置与约定

- `architecture.module_inner_layers` 默认含 `presentation` 等业务层名。
- `architecture.cross_module_exports_file` 默认 `index.ets`。
- `toolchain.devEcoStudio` / `hvigor` 等与 DevEco 编译链紧耦合。
- `project_type`: `app` | `atomic_service` 等枚举尚未区分「云侧 / 库 / 纯文档仓」等形态。

## Visual Handoff 解耦（已完成第一步）

- spec 驱动的 `ui_change` 与工程外路径（`${UX_ROOT}` / 绝对路径 / UNC、`reachable` 档位）已由 `check-spec` + `visual-source-resolver` 承载；**不包含** modality 抽象层。

## 未来可考虑的剥离顺序（建议）

1. 将 **toolchain** 整段变为可选或按 `modality` profile 切换。
2. 将 **跨模块出口文件名** 与 **内层名称** 交由 modality preset（或工程显式覆盖）生成，而非模板写死。
3. 为「无 UI」工程提供 **check-spec** 之外更轻量的 phase 预设（当前已通过「无 `ui_change` 块 + 无 `spec` 段 = 静默」覆盖主路径）。

维护者更新本文件时：**不要**把 feature 级细则写进来；细节仍在 `doc/features/<feature>/` 与对应 Skill。

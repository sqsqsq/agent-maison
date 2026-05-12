# Code Review 检查清单 · `generic` profile

本清单强调**与宿主语言无关**的 BLOCKER/MAJOR 项。涉及 ArkTS / `.ets` / `$r()` / `oh-package.json5` / hvigor 的细则，请改用 `hmos-app` profile 下的完整 `review-checklist.md`。

---

## 一、架构合规性（BLOCKER）

### 1.1 外层依赖矩阵

- [ ] 逐文件检查跨模块 import / package 依赖是否只指向下层：以 `framework.config.json > architecture.outer_layers[].can_depend_on` 为准
- [ ] 同层策略符合 `intra_layer_deps`（`forbid` / `dag` / `sublayer`）
- [ ] 若存在 `sublayers`，子层依赖仅允许 `can_depend_on_sublayers` 声明的边

**依据**: `doc/architecture.md` + `framework.config.json > architecture`

### 1.2 模块内分层

- [ ] import 方向符合 `architecture.module_inner_layers` + `inner_dependency_direction`

**依据**: `framework/specs/phase-rules/coding-rules.yaml > layer_compliance`（与 profile overlay 合并后）

### 1.3 跨模块可见性

- [ ] 未通过 `architecture.cross_module_exports_file`（或宿主等价机制）暴露在外的符号，不得在模块外被引用

### 1.4 契约内文件完整性

- [ ] `contracts.yaml > files` 列出的交付物存在且可被编译/解析（具体命令见宿主 profile）

---

## 二、接口一致性（BLOCKER）

### 2.1 数据模型 / API / UI 契约

- [ ] `contracts.yaml` 中的 data_models / interfaces / components / navigation 等与实现逐项一致（字段、类型、可选性、枚举）

---

## 三、质量与可追溯（MAJOR）

### 3.1 命名与类型安全

- [ ] 无 `any`（若宿主 linter 有此规则）
- [ ] 无未解释的配置键占位

### 3.2 异步与错误处理

- [ ] `acceptance.yaml > boundaries` 中声明的故障场景在代码里有对应分支

---

## 四、数据来源与测试边界（MAJOR / MINOR）

- [ ] Mock / Stub 仅限数据边界与外部 IO；业务规则不放测试替身内
- [ ] `acceptance.yaml` P0/P1 覆盖可追溯至实现或测试计划

---

## 宿主专属条目（移动到 profile）

以下仅当切换到 `hmos-app`（或等价端侧 profile）时启用：

- `$r(...)` / 资源完整性
- `build-profile.json5`、`oh-package.json5`、`Index.ets`、NavDestination 注册表
- ArkUI 组件装饰器、`@ohos/hypium` import 禁令等

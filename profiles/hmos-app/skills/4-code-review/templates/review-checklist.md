# Code Review 检查清单

本检查清单为 Skill 4（Code Review）的详细执行参考。审查时逐项检查，记录发现的问题。

---

## 一、架构合规性（BLOCKER 级）

### 1.1 五层架构依赖

- [ ] 逐文件检查 import 语句中引用的模块是否遵循五层依赖矩阵
- [ ] 01-Product 只能依赖下层（02-05）
- [ ] 02-Feature 不能依赖 01-Product；Feature 内部遵循子层级规则
- [ ] 03-CommonBusiness 不能依赖 01/02 层
- [ ] 04-BusinessBase 只能依赖 05-SystemBase
- [ ] 05-SystemBase 内部仅 CommUI → CommFunc 单向

**依据**: `framework/specs/phase-rules/coding-rules.yaml > inter_module_dependency`

### 1.2 模块内四层分层

- [ ] shared 层文件不 import data/domain/presentation 层
- [ ] data 层文件不 import domain/presentation 层
- [ ] domain 层文件不 import presentation 层
- [ ] 每个文件是否放在正确的层级目录

**依据**: `framework/specs/phase-rules/coding-rules.yaml > layer_compliance`

### 1.3 文件完整性

- [ ] `contracts.yaml > files` 中列出的所有文件均已创建
- [ ] 无多余文件（代码中不在 contracts.yaml 规划中的 .ets 文件）

**依据**: `framework/specs/phase-rules/coding-rules.yaml > file_completeness`

### 1.4 资源引用完整性

- [ ] 每个 `$r('app.string.xxx')` 引用的 key 在 string.json 中已定义
- [ ] 每个 `$r('app.color.xxx')` 引用的 key 在 color.json 中已定义
- [ ] 每个 `$r('app.float.xxx')` 引用的 key 在 float.json 中已定义

**依据**: `framework/specs/phase-rules/coding-rules.yaml > resource_integrity`

---

## 二、接口一致性（BLOCKER 级）

### 2.1 数据模型一致

- [ ] 逐个对比 `contracts.yaml > data_models` 与实际代码：
  - 类名/接口名是否一致
  - 字段名是否一致
  - 字段类型是否一致
  - 必填/可选是否一致
  - enum 值是否一致

### 2.2 接口签名一致

- [ ] 逐个对比 `contracts.yaml > interfaces` 与实际代码：
  - 类名是否一致
  - 方法名是否一致
  - 参数列表（名称+类型）是否一致
  - 返回类型是否一致
  - async 标记是否一致

### 2.3 组件 Props 一致

- [ ] 逐个对比 `contracts.yaml > components` 与实际代码：
  - @State 变量列表是否一致
  - @Prop 变量列表是否一致
  - 事件回调是否实现
  - 父组件传递 Props 类型是否匹配

---

## 三、编码规范（MAJOR 级）

### 3.1 命名规范

- [ ] 模块目录名: PascalCase
- [ ] .ets 文件名: PascalCase
- [ ] @Component struct 名: PascalCase，与文件名一致
- [ ] 资源 key: snake_case

**依据**: `framework/specs/phase-rules/coding-rules.yaml > naming_conventions`

### 3.2 硬编码字符串

- [ ] presentation 层代码中无直接使用的中文/英文 UI 文本
- [ ] 所有用户可见文本通过 `$r('app.string.xxx')` 引用

**依据**: `framework/specs/phase-rules/coding-rules.yaml > no_hardcoded_strings`

### 3.3 类型安全

- [ ] 代码中不存在 `: any`、`as any`、`<any>` 用法
- [ ] 所有变量和参数都有明确类型标注

**依据**: `framework/specs/phase-rules/coding-rules.yaml > no_any_type`

### 3.4 异步模式

- [ ] 异步操作使用 async/await 模式
- [ ] 不存在 `.then()/.catch()` 回调链（Promise.all/race 除外）

**依据**: `framework/specs/phase-rules/coding-rules.yaml > async_await_pattern`

---

## 四、业务逻辑（MAJOR 级）

### 4.1 异常处理完整性

- [ ] 逐条对照 `acceptance.yaml > boundaries` 中的每个 BD 项：
  - 代码中是否有对应处理逻辑
  - 处理方式是否符合 `handling` 描述
  - 结果是否满足 `expected_behavior`

### 4.2 业务流程正确性

- [ ] Repository 方法返回值是否符合 design.md 设计
- [ ] 页面组件层级是否与组件树一致
- [ ] 页面间跳转逻辑是否与导航设计一致
- [ ] 状态管理是否使用了设计指定的装饰器

### 4.3 PRD 验收标准覆盖

- [ ] 逐条检查 `acceptance.yaml > criteria` 中 P0 项：代码是否有对应实现
- [ ] 逐条检查 P1 项：代码是否有对应实现
- [ ] P2 项若未实现，标注为 INFO 而非 MAJOR

---

## 五、数据层（MAJOR/MINOR 级）

### 5.1 数据所有权合规

- [ ] presentation 层不直接操作 AppStorage 写入业务数据
- [ ] presentation 层不直接构造模拟数据
- [ ] 所有数据操作通过 Repository/Service 层完成

### 5.2 模拟数据隔离

- [ ] 模拟数据封装在 data/repository 内部
- [ ] presentation 层不感知数据来源（无 isMock 判断）
- [ ] 将来替换真实 API 时，只需修改 Repository 内部

---

## 六、模块配置

### 6.1 模块注册

- [ ] 新增模块已在根 `build-profile.json5` 注册
- [ ] `srcPath` 使用层目录前缀格式

### 6.2 依赖声明

- [ ] 模块 `oh-package.json5` 中的依赖与五层架构规则一致
- [ ] 依赖路径使用层目录相对路径

### 6.3 HAR 导出

- [ ] 每个 HAR 模块有 `Index.ets` 作为导出入口
- [ ] 对外 API 正确 export

### 6.4 页面注册

- [ ] NavDestination 页面在 `main_pages.json` 中注册
- [ ] 系统路由表（若使用）在 `route_map.json` 中配置

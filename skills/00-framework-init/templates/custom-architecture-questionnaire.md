# 自定义架构 DSL — 问卷（逐项确认）

对每一个 **外层层级** `L`（从下往上或从上往下皆可，但整个会话中要固定顺序），询问并记录：

## 外层

1. **id**（字符串）：目录或逻辑层名，如 `01-Product` / `App`。
2. **can_depend_on**（id 数组）：该层模块默认允许 **import** 哪些**其它外层**的模块（不含同层，同层规则见下）。
3. **intra_layer_deps**：
   - `forbid` — 同层模块互不可 import；
   - `dag` — 同层允许依赖，但须无环（由 harness 扫代码）；
   - `sublayer` — 同层再分子层（须继续答子层问卷）。

### 当 intra_layer_deps = sublayer 时

对每个 **子层** `S`：

1. **id**
2. **members_pattern_or_list**：模块名列表（精确字符串列表；与未来 catalog 中模块名对齐）。
3. **can_depend_on_sublayers**：允许依赖的子层 id 列表（不能含自身）。

## 全局（外层结束后）

1. **module_inner_layers**：字符串数组，**从底到顶**列出模块内部分层名（如 `shared, data, domain, presentation`）。顺序决定 `upward` 依赖方向。
2. **inner_dependency_direction**：固定填 `"upward"`（当前框架仅支持此值）。
3. **cross_module_exports_file**：如 `Index.ets`。

## 自检（生成 JSON 前口算）

- 所有 `can_depend_on` 中的 id 均出现在 `outer_layers[].id` 中。
- 外层依赖图无环。
- 若有 sublayer，每个子层依赖图无环。

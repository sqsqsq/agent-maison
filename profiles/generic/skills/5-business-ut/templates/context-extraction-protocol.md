# UT 上下文摘取协议（BLOCKER — 禁止读完整源文件）

> Lite / Standard 模式共用。写 `context-exploration.md` 前必读。

## 摘取清单（按顺序执行）

1. **被测函数签名**（rg + 行范围）：

   ```bash
   rg "targetFunction|export function" <module>/src/ -C 3 --max-count 5
   ```

2. **构造参数 / 依赖 import**：

   ```bash
   rg "^import|constructor" <被测文件路径> --max-count 20
   ```

3. **contracts.yaml 对应条目**：

   ```bash
   # 只读 interfaces[] 部分
   读取 doc/features/<feature>/contracts.yaml
   ```

4. **acceptance.yaml 的 unit/both 条目**：

   ```bash
   # 读取并过滤 ut_layer in {unit, both}
   读取 doc/features/<feature>/acceptance.yaml
   ```

## 绝对禁止

- 读取整个 UI / 页面文件（通常 500+ 行，大部分是展示代码）
- 遍历模块目录树
- 读取非被测函数的实现细节

## 上下文总预算

**≤ 300 行**（含 frontmatter Code Facts）。超出时只保留签名 + import + 直接依赖接口名。

## context-exploration.md 落盘要求

- `source_code_paths` 只列**被测入口文件**与 UT 目标路径，不列整模块
- Code Facts 写**签名级**事实（参数类型、返回值、关键 boundary 调用名），不粘贴实现体

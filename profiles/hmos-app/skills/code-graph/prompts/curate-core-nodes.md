# 策展 core 节点（hmos-app · 弱模型护栏）

## 目标

从 bootstrap 生成的 `nodes[]` 草稿中，挑出 **3–5 个** `core: true` 锚点，作为模块级 characterization 安全网。

## 步骤

1. 读 catalog 卡片：`entry_file`、`key_exports`、`responsibilities`。
2. 读 `derived.signatures` 与已有 `nodes`；优先入口类/导出符号。
3. 对每个候选写一句 `intent`（用户可理解的业务意图）。
4. 仅将「改坏必炸」的入口标 `core: true`；其余保持 `core: false` 或删除多余 seed 节点。
5. 向用户展示表格（id / symbol / intent / core）后等待 `code-graph.curated_confirm`。

## 反模式

- 勿整模块所有方法标 core。
- 勿把 UI `@Component` 页面标 core（UT 不直接测 UI）。
- 勿手写 `derived`（一律 bootstrap 重建）。

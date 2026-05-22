# Skill 3 coding — Widget 选项固定文案（SSOT）

> registry：`coding.scope_stop` / `coding.module_batch` / `coding.deps_abc`

---

## scope_stop（Scope 越界停步）

| # | value | label |
|---|-------|-------|
| 1 | `back_design` | 回 Skill 2 — 走 Scope 扩展提议 |
| 2 | `narrow` | 收窄实现 — 只在当前 in_scope 内完成 |

Portable：`1=回 Skill 2 走 Scope 扩展` / `2=收窄实现`

---

## module_batch（逐模块交付）

| # | value | label |
|---|-------|-------|
| 1 | `next_module` | 继续下一模块 — 本模块批次已确认 |
| 2 | `edit_module` | 修改本模块 — 我要调整当前模块实现 |

Portable：`1=继续下一模块` / `2=修改本模块`

---

## deps_abc（依赖缺失 A/B/C）

| # | value | label |
|---|-------|-------|
| 1 | `install_retry` | 确认安装并重跑 — 按清单安装依赖后重试 harness |
| 2 | `readonly_list` | 只读清单 — 仅展示依赖清单，暂不安装 |
| 3 | `confirm_source` | 先确认源 — 确认依赖来源/版本后再继续 |

Portable：`1=确认安装重跑` / `2=只读清单` / `3=先确认源`

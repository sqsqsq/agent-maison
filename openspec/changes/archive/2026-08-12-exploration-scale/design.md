# Design: Exploration Scale

## facts.md 契约

```markdown
---
schema_version: "1.0"
feature: <name>
established_by: spec        # 该 track 首个 phase：full=spec / lite=change
key_inputs_read: [glossary, module-catalog, architecture, <profile 子串>]
source_code_paths: [...]
---
## Code Facts（首建全量）
| 路径 | 事实 | 影响 |
## phase_delta: plan
- <本阶段新增事实，无新事实写 "none">
## phase_delta: coding
...
```

- 校验规则（各 phase-rules 的 exploration 规则改写）：facts.md 存在 + frontmatter 合法 + **当前 phase 的 `phase_delta` 节存在**（内容可为 "none"，显式声明无新事实）。
- `exploration_strategy` 复合评分只在首建 phase 全额执行；后续 phase 增量降额（无 subagent 强制）。
- receipt `context_exploration.summary_path` 指向 `context/facts.md`；check-receipt 校验按 evidence policy（C2）分派。

## 兼容与 backfill

- 读取优先级：`context/facts.md` → 旧 `<phase>/context-exploration.md`（存在即按旧契约校验，WARN 提示可 backfill）。
- `backfill-context-exploration.ts` 增 `--to-facts`：把 per-phase 文件归并为 facts.md（首个 phase 作全量、其余转 phase_delta），幂等可重跑。

## project_scale 裁剪

- config：`project_scale: "small" | "standard"`（缺省 standard）；`phases_disabled: []`（可选，与 profile 并集）。
- framework-init：S2 按 catalog 模块数 ≤3 或估算代码量建议 small，用户确认写入（登记确认点）。
- small 档语义：
  - spec Step 1.5：术语映射表仍产出，但免逐行 [x] gate——改为一次性"对照 architecture.md 模块清单确认"（headless 沿用既有 §9 规则）；glossary 允许最小种子。
  - `module-graph` 进 config.phases_disabled 默认集（用户可移除）；并集裁剪单点在 profile-loader + C0 `resolvePhaseChain`。
  - catalog 卡片：`NOT_responsible_for` / `easily_confused_with` 降为可选。
- 红线：`diff_within_scope`、Scope 声明章节在 small 档照常强制。

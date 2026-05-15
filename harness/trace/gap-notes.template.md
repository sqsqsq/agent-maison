# Gap Notes — {feature} / {phase}

> 本文件是**内网弱模型跑动后的结构化痛点回传模板**。
> 每次内网 Claude Code CLI 跑完某阶段产物后，由用户或 agent 自我反思填写，与 `trace.json` 放在同一 **feature-phase 报告目录**（由 `paths.reports_dir_pattern` 解析）：推荐 **`doc/features/<feature>/<phase>/reports/gap-notes.md`**；未配置时为 legacy：**`framework/harness/reports/<feature>/<phase>/gap-notes.md`**。
> 若以 `<timestamp>/<model>-<phase>` 子目录存档，与同目录下的 `gap-notes.md`、`trace.json` 配对。
>
> 目的：积累真实的弱模型失败样本，**直接驱动 skills / specs / harness 的下一波迭代**。
> 请尽量保持**事实 + 证据 + 可执行建议**三段式。

---

## 元信息

| 字段 | 值 |
|------|----|
| feature | <功能名，如 bank-card> |
| phase | prd / design / coding / review / ut / testing |
| model | <minimax-2.5 / glm-4.5 / ...> |
| context_window | <200K / 128K / ...> |
| runtime | claude-code-cli / cursor / other |
| run_timestamp | <ISO 8601> |
| outcome | success / partial / failed / aborted |
| human_interventions_count | <用户介入次数> |

---

## 1. 本次跑动 TL;DR（3 行以内）

- 成功完成了哪些：
- 失败或需要人工兜底的是：
- 关键结论：

---

## 2. 结构化痛点清单

> 与 `trace.json` 中 `human_pain_points` 字段一一对应。每条痛点必须包含"现象-证据-根因猜测-建议改进"。

### 痛点 #1

- **分类**（必填）：`scope_creep` / `arkts_correctness` / `architecture_violation` / `contracts_mismatch` / `context_loss` / `instruction_miss` / `tool_misuse` / `other`
- **严重度**（必填）：BLOCKER / MAJOR / MINOR
- **现象**：
  > 一句话描述模型做错了什么。
- **证据**（必填）：
  - 相关文件：`<path:line>`
  - 相关对话/工具调用：<摘录或引用>
- **根因猜测**：
  - [ ] 上下文丢失（文件太大/太多）
  - [ ] 指令没读到（SKILL.md / CLAUDE.md 里没强调或位置不显眼）
  - [ ] 指令读到但没执行（需要更强的门禁/checklist）
  - [ ] ArkTS 知识盲区（模型训练数据覆盖不足）
  - [ ] 工具调用顺序错误
  - [ ] 其他：
- **建议改进**（必填，可执行）：
  - [ ] 修改 `skills/<n>/SKILL.md` 的 Step <k>：
  - [ ] 修改 `framework/specs/phase-rules/<phase>-rules.yaml` 新增规则：
  - [ ] 修改 `framework/harness/scripts/check-<phase>.ts` 新增自动检查：
  - [ ] 修改 `framework/skills/3-coding/reference/arkts-pitfalls.md` 增加错例：
  - [ ] 其他：

### 痛点 #2

（按需复制上面的格式）

---

## 3. 框架表现不错的地方（正面样本）

> 同样重要。记录本次跑动中哪些 skill / spec / harness 设计**确实起到了作用**，避免下次迭代时误伤。

- 例：`framework/skills/3-coding/SKILL.md` 的"逐文件 Lint 门禁"在第 3 个文件出错时及时拦截，避免了级联错误。
- …

---

## 4. 下一轮迭代优先级建议

| 优先级 | 动作 | 预计影响 |
|--------|------|----------|
| P0 | 例：在 design-rules.yaml 增加 XXX 规则 | 拦截类似 scope_creep 痛点 |
| P1 |  |  |
| P2 |  |  |

---

## 5. 授权的源码变更清单（approved_src_mutations）— Skill 5 专用

> 仅当 Skill 5（业务级 UT）阶段，agent 征得用户同意后对 `02-Feature/**/src/main/**`、
> `01-Business/**/src/main/**`、`00-Common/**/src/main/**` 等**非 ohosTest/test 目录**下的文件做了
> 变更时，**必须**填写本节。否则 harness 的 `ut_no_src_mutation` BLOCKER 会 FAIL。
>
> 未登记 = 未授权 = 违规。

```yaml
approved_src_mutations:
  # 每条一个授权项；agent 自检/用户核对时按此顺序读取
  # - file: "02-Feature/WalletMain/src/main/ets/pages/IndexPage.ets"
  #   reason: "抽出 handleRefresh 命名字段函数以便 UT 直接调用"
  #   diff_summary: "新增 handleRefresh = async () => {...}，onRefresh 由 inline lambda 改为转发"
  #   approved_by: "user"
  #   approved_at: "2026-04-24T15:00:00+08:00"
  #   approved_quote: "同意抽成命名字段函数" # 摘录用户原话，便于审计
  #   skill_step_linked: "Skill 5 / 约束 #12 HARD STOP"
```

> 填写约束：
> - `file`：必须是完整相对路径，与 `git diff --name-only` 输出一致；
> - `reason`：一句话说明为何 UT 层无法规避此变更；
> - `approved_at`：ISO 8601 时间戳，记录征得同意的时刻；
> - 若同一文件有多次变更累计到一个授权，可复用同一条目但 `diff_summary` 需合并；
> - 未授权的改动一律视为违规，触发 harness BLOCKER。

---

## 6. 附件

- trace.json: `./trace.json`（与同目录 `gap-notes.md` 配对）
- 脚本 harness：`script-report.json`、`summary.json`、`merged-report.md` 等，与上文同目录（推荐前缀 `doc/features/<feature>/<phase>/reports/`；未配置 `reports_dir_pattern` 时为 `framework/harness/reports/<feature>/<phase>/`）
- verifier 报告：`verifier.report.md`（同上目录）
- 关键对话片段（可选，脱敏后贴）：

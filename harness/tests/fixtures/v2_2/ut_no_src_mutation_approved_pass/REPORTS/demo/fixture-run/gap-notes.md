# gap-notes.md — fixture 专用

该 fixture 通过 REPORTS/ overlay + HARNESS_REPORTS_ROOT_OVERRIDE 环境变量注入，
模拟"Skill 5 阶段用户同意修改业务源码并登记在 gap-notes.md" 的正向场景。

## approved_src_mutations

```yaml
approved_src_mutations:
  - file: "02-Feature/Demo/src/main/ets/domain/flow/DemoFlow.ets"
    reason: "抽出 handleRefresh 命名字段函数以便 UT 直接调用，避免 inline lambda"
    diff_summary: "新增 handleRefresh = async () => {...}"
    approved_by: "user"
    approved_at: "2026-04-25T09:55:00+08:00"
    approved_quote: "同意抽成命名字段函数"
    skill_step_linked: "Skill 5 / 约束 #12 HARD STOP"
```

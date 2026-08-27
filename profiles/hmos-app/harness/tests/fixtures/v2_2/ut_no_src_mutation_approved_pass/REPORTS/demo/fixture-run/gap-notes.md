# gap-notes.md — fixture 专用

该 fixture 通过 REPORTS/ overlay + HARNESS_REPORTS_ROOT_OVERRIDE 环境变量注入，
保留历史 `approved_src_mutations` 字节，验证 attended 模式也不会把用户署名当成 UT PASS 授权。

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

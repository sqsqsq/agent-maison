# 真机测试待办 — task-demo（样例 · v2.1）

路径示意：`doc/features/task-demo/device-testing-todo.md`

## 宿主 UI 必须由真人验证的行为

以下交互 **不得**仅在 UT / DAG 中断言完成：

- TaskFormPage：表单校验与无障碍焦点
- OtpSheetPage：系统键盘与安全区
- TaskResultPage：结果态呈现与返回栈

链路引用：

- `use_cases[task_submission]`
- 分支：`happy_path` / `validate_fail` / `otp_fail_rollback` / `user_cancel_in_waiting_otp`

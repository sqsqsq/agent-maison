### 样例：`task_submission`

> 本节应并入 `design.md` 的「业务流程 / Use Case」段落；复杂度达到 requirement-design 阈值时附带 `use-cases.yaml`。

- **Coordinator**：`TaskSubmitFlow`，入口 `submitTask` / `confirmOtp` / `cancel`
- **数据边界**：远程 `RemoteTaskGateway` + 本地 `LocalTaskLedger`（均由 `contracts.yaml` 预先登记）

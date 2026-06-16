# 下游 Framework Harness 集成说明（Hylyre-core 移交）

> 本仓 **Hylyre-core** 已实现 CLI 能力；下列项需在 **framework** 仓（如 `framework/profiles/hmos-app/harness/providers/device-test-run.ts`）接入后才能在阶段跑中闭环。本工作区不含 `framework/`，受「禁止跨仓修改」约束，此处仅作移交清单与验收命令。

来源需求：[`hylyre-optimization-requests.md`](../hylyre-optimization-requests.md) **#3**（冷重启 / force-stop 语法）、**#6**（`app page save` 调用约定）。

---

## #3 阶段跑冷重启（Harness 集成）

### Hylyre-core 已交付

```bash
# positional force-stop（勿再用 aa force-stop -b，本机 hdc 会失败）
hylyre device force-stop --bundle com.example.app [--device-sn SN]

# force-stop + aa start + 等待
hylyre device cold-restart --bundle com.example.app [--device-sn SN] [--ability EntryAbility] [--wait-time 2]
```

底层：`hdc shell aa force-stop <bundle>`（见 `hylyre/drivers/hypium/hdc_cli.py`）。

### 下游需改

1. **`device-test-run.ts`（约 434 行）**：将 `aa force-stop -b <bundle>` 改为调用上述 CLI，或等价 `hdc shell aa force-stop <bundle>`（**positional bundle**）。
2. **阶段跑开关**：每轮 / 每 feature 跑前默认 **`hylyre device cold-restart`**（或至少 `force-stop` + 既有 `start_app`），避免跑间状态泄漏（首页 Tab、半模态残留等）。
3. **配置**：建议在 profile / env 增加 `coldRestartBeforeRun: true`（名称由 framework 定），默认真机 testing 阶段开启。

### 验收

连续跑两轮同一 feature，第二轮起始页与第一轮一致（无上一轮的 Tab/Sheet 残留）；`device-test-run.log` 中 force-stop 不再出现 `-b` 语法错误。

```bash
hylyre device cold-restart --bundle com.example.simulatedwallet --wait-time 2
hylyre run --steps-file round1.json --session .hylyre/session.json --on-fail abort
hylyre device cold-restart --bundle com.example.simulatedwallet --wait-time 2
hylyre run --steps-file round2.json --session .hylyre/session.json --on-fail abort
```

---

## #6 `app page save` 调用约定（Harness + Hylyre-core）

### Hylyre-core 已改

- **单设备**：未传 `--device-sn` / `--session` / `--from-dump` 且仅连一台设备时 **自动取该设备**（不再 exit 2）。
- **多设备 / 无设备**：列出已连 serial，给出可操作报错。
- **失败 stderr**：区分 dump 阶段 vs 写盘阶段根因（便于归档到 run 目录）。

### 下游需约定

| 项 | 建议 |
|----|------|
| **页面命名** | 与业务 slug 一致，如 `bank-card-select`、`sms-sheet`；bundle 下 `doc/app-snapshot-cache/<bundle>/pages/<name>.json` |
| **保存时机** | 关键页稳定后（如每步成功后的 `dump-ui` 等价态），或每 N 步 / 每个新 `fingerprint` |
| **调用示例** | `hylyre app page save --bundle com.example.app --name bank-card-select --session .hylyre/session.json` |
| **失败归档** | harness 将 **stderr 全文** 写入 `<run-dir>/hylyre-page-save.log`（或 meta.json 字段），保留 exit code |
| **本轮页面集合** | harness 维护「本轮访问过的 page name」列表，跑结束前对每个 name 尝试 save（失败不 silent） |

### 验收

跑完 testing 阶段后，`snapshot-cache` 含本轮访问页面；某次 save 失败时 run 目录有 stderr 日志且 exit code ≠ 0 可查。

```bash
hylyre app page save --bundle com.example.simulatedwallet --name home --session .hylyre/session.json
echo exit=$?
ls doc/app-snapshot-cache/com.example.simulatedwallet/pages/
```

---

## 相关 Hylyre-core 文档

- 富选择器 / `scroll_to` / 失败诊断：[`agent-loop.md`](./agent-loop.md)
- planned JSON 字段：[`agent-plan-a.md`](./agent-plan-a.md)
- Agent 备忘：[`AGENTS.md`](../AGENTS.md)

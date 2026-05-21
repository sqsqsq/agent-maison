# Hylyre 宿主环境单机诊断（Skill 6）

> agent 在 **即席** 或 **标准 testing** 中 `ensureHylyreReady` 失败时使用。  
> 用户**不必**自行 `pip install`；由 agent 在本对话内处理下列项后重跑入口 CLI。

## 正确入口（勿混用）

| 场景 | 入口 | Hylyre ensure |
|------|------|----------------|
| 即席（外部 bundle + 自然语言步骤） | `cd framework/harness && npm run adhoc-device-test -- --bundle <id> --steps "…"` | CLI 内自动 |
| 正式 feature（有 PRD/design/acceptance） | `npx ts-node harness-runner.ts --phase testing --feature <name>` | `device_test.run` 内自动 |
| **禁止** | `harness-runner --phase testing --feature _adhoc` | runner 会 **exit 1** 并提示 adhoc CLI |

若 `check-testing.ts` 在加载阶段 TS 编译失败（如历史 `testing_checker_error`），**整段 testing 未运行**，ensure **从未执行**——不得据此对用户说「请安装 Hylyre」。

## 日志 SSOT（先 Read 再改环境）

相对工程根：

1. `doc/features/<feature>/testing/reports/hylyre-doctor.log`
2. `doc/features/<feature>/testing/reports/hylyre-ready.meta.json`
3. `doc/features/<feature>/testing/reports/device-test-run.log`（run 阶段）

即席 feature 目录名为 `_adhoc`。

## 常见 `errors[].kind` 与处理

| kind / 关键词 | 含义 | agent 处理（不要求用户 pip） |
|---------------|------|------------------------------|
| `config` | 无法确定 Python 路径 | 确认本机已装 **Python 3.10+**；或 agent 设置可用的 `HYLYRE_PYTHON` 后重跑 |
| `import` + `HYLYRE_PYTHON` | 指定解释器无 hylyre | **取消** `HYLYRE_PYTHON`（让默认 `.hylyre/venv` + vendor wheel 自动安装），或在该环境由 agent 对齐 vendor 版本 |
| `install` / `pip` | pip 安装失败或超时 | Read `hylyre-doctor.log`；检查网络 / `framework.config.json` → `tools.hylyre.pypi_extra_index_url`；必要时 agent 删除工程根 **`.hylyre/venv`** 后重跑 ensure |
| `doctor` | `hylyre doctor` 失败 | 同上日志；多为 hypium/设备栈依赖未齐 |
| `venv` | `python -m venv` 失败 | 检查 Python 安装与磁盘权限 |

### 环境变量（单机差异高发）

| 变量 | 风险 |
|------|------|
| `HYLYRE_PYTHON` | 指向的环境 **不会** 自动 pip 升级；与 vendor manifest 不一致 → BLOCKER |
| `HYLYRE_HOME` | 使用已有 venv 根；需与 vendor 版本一致 |
| `HARNESS_HDC_TARGET` | 多设备时指定序列号 |
| `HARNESS_HDC_EXE` | hdc 绝对路径；Claude Code CLI 等子进程 PATH 不含 DevEco toolchains 时推荐设置 |

Windows PowerShell 临时取消：`Remove-Item Env:HYLYRE_PYTHON -ErrorAction SilentlyContinue`

## Framework / harness 前置

1. `cd framework/harness && npm install`（Tier_1，见 `framework/skills/reference/host-harness-readiness.md`）
2. 多工程共用 `framework/` 子模块时，**对齐 git 提交**（避免一仓有类型修复、另一仓仍 `testing_checker_error`）
3. `framework/profiles/hmos-app/vendor/hylyre/` 含 wheel + `release.manifest.json`

## 即席 vs 标准：勿用标准门禁测外部 App

即席 **不** 对本仓库跑 `device_test.build` / `device_test.install`（测的是设备上**已存在**的 bundle）。  
若误跑 `harness-runner --feature _adhoc`，会出现缺 PRD、hvigor `product=`、文档六章等**与 Hylyre 无关**的 BLOCKER，导致 agent 误降级为「手动测试」。

## 快速复跑（agent Shell）

```bash
cd framework/harness && npm run adhoc-device-test -- \
  --bundle com.example.app \
  --steps "打开应用->点击某按钮"
```

成功时 stdout 含 `trace` / `report` 路径；失败时 CLI 会打印 `hylyre-doctor.log` 与 `hylyre-ready.meta.json` 的绝对路径。

## 即席 anti-fabrication（必读）

`adhoc-device-test` 在 **stderr** 末尾打印锚点（勿从 stdout JSON 猜路径）：

- `ADHOC_TRACE_FILE=` — 本次 `trace.json`（早期 exit 也会写 `outcome=aborted` 占位）
- `ADHOC_HYLYRE_RUN_DIR=` — 本次执行报告目录（`doc/features/_adhoc/testing/reports/<timestamp>/hylyre/`）
- `ADHOC_WARMUP_META=` — `snapshot-warmup.meta.json`（`schema_version: "0.1"`，含 `reason_kind`、`device_info`）
- `ADHOC_ENSURE_META=` / `ADHOC_RUN_META=`

**禁止** glob `doc/features/_adhoc/testing/reports/*/hylyre/` 取「最近」目录；历史 `<timestamp>` 可能是占位或旧跑。

### warmup 与冷启

| 现象 | 含义 | agent 动作 |
|------|------|------------|
| stderr `[WARN] snapshot warmup 失败` | warmup 降级，**仍会**跑 plan | 读 `ADHOC_WARMUP_META` 的 `reason_kind`；跨机先比 `device_info` |
| `reason_kind=app_not_foreground` | App 未在前台 / 弹窗 | 请用户解锁并切到目标 App 前台后 agent 重跑 |
| `reason_kind=ability_wrong` | main ability 推断错 | 传 `--ability` 或配置 `bundle_abilities`；会失效 `app-meta.json` |
| `[info] snapshot_cache_empty` / `ADHOC_CACHE_DIR` | 将尝试 snapshot warmup | App 已就绪可加 `--accept-cold-start` 跳过 warmup |
| `[bootstrap] pip install start` | 首次 venv 安装，勿中断 | Read `hylyre-ready.meta.json` 的 `bootstrap_elapsed_ms` / `bootstrap_was_resumed` |

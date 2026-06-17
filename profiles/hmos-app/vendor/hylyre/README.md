# Hylyre vendor（hmos-app）

## 目录是什么

本目录是 **hmos-app** profile 集成真机自动化测试的 vendor 入口：内置 **纯 Python wheel**（跨 OS / Python 3.10+），整个目录**提交进 Git**（体量 < 1 MB），协作者 `git clone` 即可拿到，不依赖联网拉取 Hylyre 本体。

传递依赖（如设备侧 Hypium 栈）仍由首次 `ensure` 时通过 PyPI 镜像安装，不在本目录 vendor。

**本目录仅保留发布件**：`hylyre-*.whl`、`release.manifest.json`、本 README。集成说明不再单独挂临时移交 md。

## 何时更新

- Hylyre 仓库 `pyproject.toml` 版本号变更
- 工程内自检提示与 `release.manifest.json` 中的版本不一致
- 升级本 framework 集成并约定使用新版 Hylyre CLI

## 三步同步流程

与 Hylyre 文档 `docs/framework-vendor-bundle.md` 对齐：

```powershell
# ① 在 Hylyre 仓产出
cd D:\1.code\Hylyre
python scripts/build_wheel.py --clean

# ② cp 到本目录（覆盖旧 wheel）
$src = "D:\1.code\Hylyre\dist\release"
$dst = "D:\1.code\agent-maison\profiles\hmos-app\vendor\hylyre"
Remove-Item -Force "$dst\hylyre-*.whl", "$dst\release.manifest.json" -ErrorAction Ignore
Copy-Item "$src\hylyre-*.whl", "$src\release.manifest.json" $dst

# ③ 校验
python D:\1.code\Hylyre\scripts\build_wheel.py --verify $dst
```

同步后若 Hylyre 包内仍带 `integration_docs` 等移交文件，**不要**提交进 maison；只保留 wheel + manifest + 本 README，并把 harness 侧变更摘要补进下文「Framework 集成要点」。

## Framework 集成要点（vendor 0.3.0）

以下由 harness 已落地，消费者读 profile 文档即可，无需另附移交清单。

### 冷重启与 force-stop（testing 阶段）

- `device-test-run.ts` 使用 **positional** `hdc shell aa force-stop <bundle>`（勿用 `-b`，部分本机会失败）。
- 默认 **冷重启**：`force-stop` 后再 `aa start`。配置 `framework.config.json > tools.hylyre.cold_restart_before_run`（hmos-app 默认 `true`）；环境变量 `HARNESS_DEVICE_TEST_COLD_RESTART=1/0` 优先。
- meta 字段：`cold_restart` / `cold_restart_attempted` / `cold_restart_ok`。

### `app page save`（快照缓存）

- 跑后按访问页面名逐个 `hylyre app page save`；页面名与业务 slug 一致，落盘 `doc/app-snapshot-cache/<bundle>/pages/<name>.json`。
- 可选 env：`HARNESS_HYLYRE_PAGE_SAVE_NAMES`（逗号分隔）；adhoc 可 `--skip-page-save`。
- 失败时 stderr + exit 归档到 run 目录 `hylyre-page-save.log`（非 silent）。

### personal setup 原子性（F3 · harness）

- 阶段入口（coding / ut / testing）内联 **`ensurePersonalSetup`**：半就绪 `framework.local.json`（如只记 `agent_adapter`、缺 DevEco）会在放行前自动确定性 repair（单 adapter / DevEco 探测）。
- `init-orchestrate record-adapter` 写 local 后 **best-effort** 补 DevEco；探测不到时不失败任务，阶段入口仍会校验 DevEco。

### Hylyre 0.3.0 CLI / 步骤能力

- **`input`**：支持与 `touch` 一致的 `by_type` / 富选择器（`scope`/`within`/`index`/`all`/`visible` 等），或一步式 `into` 定位输入；无选择器时落当前聚焦框（仍建议先 `touch` 聚焦）。
- **`scroll_to`**：滚动前先匹配已在屏目标，避免对已可见项空滚。
- 富选择器、`--failure-dir` 失败诊断等见 [`../../skills/device-testing/reference/hylyre-planned-step-fields.md`](../../skills/device-testing/reference/hylyre-planned-step-fields.md) 与 device-testing profile addendum。
- 上游能力需求与真机踩坑记录留在 **Hylyre 仓** 或开发 plan，不进本 vendor 目录。

## 升级原则

- Commit message 建议：`chore(vendor): hylyre 0.2.0 -> 0.3.0`
- 正文粘贴 `release.manifest.json` 中关键字段（如 `hylyre_version`、`wheel.sha256`）
- **覆盖 vendor 后无需手删 `.hylyre/venv`**：协作者/用户用自然语言重新发起 **device-testing 真机测试**即可；**agent 在 device-testing Step 7 自跑 testing harness** 时，**`ensureHylyreReady`** 会按 manifest 版本与 wheel sha256 自动 pip 对齐（`tools.hylyre.auto_install=true` 且未设置 `HYLYRE_PYTHON` 时）。**用户不直接执行 harness 脚本。**
- venv 内 **`.hylyre-vendor-fingerprint.json`** 记录上次安装的 wheel 指纹；同版本号补丁 wheel（sha256 变化）也会触发重装

## 故障排查

| 现象 | 处置 |
|------|------|
| `build_wheel.py --verify` 报 sha256 不匹配 | 删除旧 wheel 后重新从 `dist/release` 覆盖拷贝 |
| 旧 wheel 残留 | 按同步流程② 先 `Remove-Item` 再拷贝；runner 优先 `manifest.wheel.filename`，多 wheel 时按版本取最新 |
| Python 版本错误 | 使用 **Python 3.10+** 创建隔离环境 |
| `verify_report` / 缺 `report-sections.yaml` | `ensureHylyreReady` 会探测 contracts，缺失时对默认 venv 执行 `pip --force-reinstall` vendor wheel |
| vendor 已更新但 venv 仍旧版 | 用户重新发起 device-testing；agent Step 7 自跑 testing harness 时会自动对齐；仍失败则查 `hylyre-doctor.log`，必要时删 `.hylyre/venv` 后由 agent 再跑 Step 7 |
| 设置了 `HYLYRE_PYTHON` 且版本与 manifest 不一致 | harness **BLOCKER**；在该环境手动升级 hylyre，或取消 `HYLYRE_PYTHON` 改用默认 venv |
| 连续多轮 testing 状态污染 | 确认 `cold_restart_before_run` 为 true 或 `HARNESS_DEVICE_TEST_COLD_RESTART=1`；日志中 force-stop 勿出现 `-b` 语法 |
| 只记 adapter 后 testing 报缺 DevEco | 确认 framework 版本含 personal setup 内联 repair；或手动 `check-personal-setup --ensure --phase testing` |

## 不要做

- **不要**手改 wheel 或 `release.manifest.json`；仅允许从 Hylyre `dist/release` **覆盖拷贝**。
- **不要**把 Hylyre 同步包里的临时 `integration_docs` / 移交 md 提交进本目录。
- 设备栈等大体量传递依赖**不要**往本目录塞；走镜像与 pip 缓存。

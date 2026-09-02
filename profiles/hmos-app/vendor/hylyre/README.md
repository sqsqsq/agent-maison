# Hylyre vendor（hmos-app）

## 目录是什么

本目录是 **hmos-app** profile 集成真机自动化测试的 vendor 入口：内置 Hylyre **明文源码树**（`src/`，纯文本、跨 OS / Python 3.10+），整个目录提交进 Git，协作者 `git clone` 即可拿到，不依赖联网拉取 Hylyre 本体。

采用源码树而非 wheel 的原因：宿主代码仓库禁止提交 `.whl` 等二进制工件；源码树全部为可 review 的文本文件，合规且审计友好。Maison 开发仓与 consumer 包都只交付源码。harness 仍兼容历史 schema 1 wheel，以及外部 legacy 布局中“源码缺失但 manifest 明确声明且实际文件 hash 匹配”的 wheel 回退；该兼容能力不构成本目录的交付要求。

传递依赖（如设备侧 Hypium 栈）仍由首次 `ensure` 时通过 PyPI 镜像安装，不在本目录 vendor。

**本目录仅保留源码发布件**：`src/`、source-only `release.manifest.json` 与本 README。Hylyre 发布包里的 `downstream-harness-requests.md` 等移交文档和 `.whl` 都不进入 Maison。

## 布局与 manifest（schema 2）

```
vendor/hylyre/
├── src/                    # Hylyre 源码树（pip install <src> 直接可装）
│   ├── pyproject.toml
│   ├── README.md
│   └── hylyre/…            # 含 contracts/ package-data（json/yaml/md）
├── release.manifest.json   # schema 2：hylyre_version + source{tree_sha256, files[]}
└── README.md               # 本文件（maison 所有，非 Hylyre 发布物）
```

- `source.files[]` 逐文件声明 sha256；`tree_sha256` = 对「POSIX 路径升序的 `<path>\n<sha256>\n` 拼接串」整体 sha256。
- 当前 vendored source：Hylyre `0.5.1`（2026-09-02 集成；上一版 0.5.0 修复件 tree `8f00a37f…`），309 文件，`source.tree_sha256 = 7cb9c540e655706acfd24604ac7e696dc71fcda0f823d232bcbe242be34dad21`；冻结契约仍为 `contracts_tree_sha256 = cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae`（0.5.1 契约包零变化，`hylyre/contracts/` 226 文件与冻结包逐字节相同）。
- schema 2 manifest 不声明 `wheel`；宿主完整性门只按 `source.files[]`、文件大小与 `source.tree_sha256` 验证实际源码树。
- 源文件统一 **LF** 落盘并按 LF 字节计算 hash；本仓 `.gitattributes` 全局 `eol=lf`，checkout 字节与声明恒等。
- harness 对齐判定**按 manifest 声明清单**复算 tree hash——vendor 内意外杂物（如 `__pycache__`）不会假触发"发布件损坏"；「src 内未声明文件」的检测由 Hylyre `--verify` 负责。

## 何时更新

- Hylyre 仓 `pyproject.toml` 版本号变更
- 工程内自检提示与 `release.manifest.json` 中的版本不一致
- 升级本 framework 集成并约定使用新版 Hylyre CLI

## 三步同步流程

与 Hylyre 文档 `docs/framework-vendor-bundle.md` 对齐：

```powershell
# ① 在 Hylyre 仓产出源码发布件
cd D:\1.code\Hylyre
python scripts/build_wheel.py --source --clean

# ② cp 到本目录（覆盖旧 src 与 manifest；不拷 wheel/移交 md）
$source = "D:\1.code\Hylyre\dist\release-src"
$dst = "D:\1.code\agent-maison-br\profiles\hmos-app\vendor\hylyre"
Remove-Item -Recurse -Force "$dst\src" -ErrorAction Ignore
Remove-Item -Force "$dst\hylyre-*.whl" -ErrorAction Ignore
Copy-Item -Recurse -Force "$source\src" "$dst\src"
Copy-Item -Force "$source\release.manifest.json" "$dst\release.manifest.json"

# ③ 校验源码树（integration_docs 缺失放行、根层自有文件免检）
python D:\1.code\Hylyre\scripts\build_wheel.py --verify $dst
```

同步后 Hylyre 发布包内如仍带 `integration_docs` 等移交文件，**不要**提交进 Maison；`.whl` 同样不得进入本目录。把 harness 侧变更摘要补进下文「Framework 集成要点」。

## Framework 集成要点（vendor 0.5.x）

以下由 harness 已落地，消费者读 profile 文档即可，无需另附移交清单。

### 源码树安装（plan a7c3e9d1）

- `ensureHylyreReady` 双兼容 schema 1（legacy wheel）/ schema 2（源码树），源码在场时恒优先；正常安装命令等价 `pip install <src副本> "hylyre[device,mcp]"`，不要求 wheel，extras 与传递依赖照旧走镜像。
- 安装前 harness 会把 `src/` **按声明清单拷贝到 `.hylyre/build-src/` 临时副本**再交给 pip——pip ≥21.3 对目录是 in-tree build，直接装会在 vendor 目录产 `build/`、`*.egg-info/` 污染仓库。该副本装完即清，且下次安装前会先清空整个 `build-src/` 自愈残留。
- venv 内 `.hylyre-vendor-fingerprint.json` 记录 `artifact_kind`（wheel/source）与工件指纹（wheel sha256 / tree_sha256）；从 wheel 切到源码树、同版本补丁件、指纹缺失均自动触发 pip 对齐，**无需手删 `.hylyre/venv`**。
- 步骤键集 SSOT 消费直读 `src/hylyre/api/planned_step_keys.py`（不再从 whl zip 解包）。

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

### Hylyre 0.5.1 CLI 选项所有权（需求文 docs/vendor/hylyre-0.5.1-CLI选项穿透与静默忽略根治需求.md）

- `hylyre run` 共享 callback 的 20 个选项建立所有权表：不支持路径上的**非默认值**一律 usage error——`exit=2`、stderr 单行、零设备、不产 report/trace；默认等价值放行。plan 路径 `--on-fail` 只接受默认 `abort`（`skip`/非法值 exit 2），`run --help` 已注明 `abort|skip` 仅限 `--steps/--steps-file`；写在 17 个 `run` 子命令前面的父级非默认选项不再被吞掉。
- Maison 传参核对（集成时逐项对照所有权表）：plan 路径 `--plan/--feature/--report-out/--trace-out/--bundle/--skip-assert-expected/--device-sn/--failure-dir`，steps-file 路径 `--steps-file/--bundle/--page-name/--device-sn/--failure-dir(+report 三件套)`，均在各自支持集内；Maison 从不向 plan 传 `--on-fail`。本地 fake 复核：`--on-fail skip|bogus` 四要素成立，`--on-fail abort` 与不传的 trace/report 逐字节一致。
- 相对需求文的唯一偏离：steps 路径非法 `--on-fail` 由 exit 1 改为 exit 2 且提前到设备连接之前，report 模式不再带 `verify_report failed:` 前缀。Maison 无脚本依赖旧退出码（已 grep），无需适配。
- 需求 v2 的 P2（by_id presence 通过态 golden 与 fake runner 可配置 presence）顺延 0.5.2，Maison 侧的 contract-composed 夹具与 pin 维持不变。

### Hylyre 0.5.0 CLI / 步骤与证据能力

- **`input`**：支持与 `touch` 一致的 `by_type` / 富选择器（`scope`/`within`/`index`/`all`/`visible` 等），或一步式 `into` 定位输入；无选择器时落当前聚焦框（仍建议先 `touch` 聚焦）。
- **`scroll_to`**：滚动前先匹配已在屏目标，避免对已可见项空滚。
- **steps-file fake**：`run --steps-file/--steps ... --use-fakes` 在进入 session/Hypium 之前走纯 fake builder；与 `--session` 同用会显式拒绝，不再静默连接第一台设备。fake action 可通过，但离线无法观察的断言必须 `blocked/capability`，不得伪造 PASS。
- 选择器 `match` 只接受 `exact` / `contains`；显式 `exact` 失败不会再静默放宽为 `contains`，动作多命中时 fail-closed，并使用 `index` / `scope` / `within` / `all` 等既有字段消歧。
- 消费 trace/report 时以 `cases[].steps[]` 为证据真源，`tool_calls` 仅为兼容投影；责任路由只消费 `outcome.status=failed`，先按 `outcome.failure.domain`、再按 namespaced `outcome.failure.code` 解释，绝不读取已退役的 flat `failure_kind`/`failure_code`；`verification=inconclusive` 或 `evidence=incomplete` 不得判为已验证。
- 要求验证的断言必须有非空 evidence；Toast 断言的触发动作应紧邻断言，未覆盖触发窗口时不得作为验证证据。最低接入版本为 `hylyre>=0.5.0`，结果协议为 `hylyre.step-outcome/1`、trace schema 为 `0.4-p0`；发布件内 `hylyre/contracts/` 与冻结契约包逐字一致（`contracts_tree_sha256`），可据此证明发布件逐字携带契约；结构化 selector identity（`by_id` / `by_key` / `id` / `key` / `selected_id`）逐字保留，用户文本和值继续脱敏。
- 富选择器、`--failure-dir` 失败诊断等见 [`../../skills/device-testing/reference/hylyre-planned-step-fields.md`](../../skills/device-testing/reference/hylyre-planned-step-fields.md) 与 device-testing profile addendum。
- 上游能力需求与真机踩坑记录留在 **Hylyre 仓** 或开发 plan，不进本 vendor 目录。

## 升级原则

- Commit message 建议：`chore(vendor): hylyre <旧版本> -> <新版本>`（如 `0.4.1 -> 0.5.0`）
- 正文粘贴 `release.manifest.json` 中关键字段（如 `hylyre_version`、`source.tree_sha256`）
- **覆盖 vendor 后无需手删 `.hylyre/venv`**：协作者/用户用自然语言重新发起 **device-testing 真机测试**即可；**agent 在 device-testing Step 7 自跑 testing harness** 时，**`ensureHylyreReady`** 会按 manifest 版本与工件指纹自动 pip 对齐（`tools.hylyre.auto_install=true` 且未设置 `HYLYRE_PYTHON` 时）。**用户不直接执行 harness 脚本。**

## 故障排查

| 现象 | 处置 |
|------|------|
| `build_wheel.py --verify` 报 sha 不匹配 | 删除旧 `src/` 后重新从 `dist/release-src` 覆盖拷贝 |
| harness 报「vendor 源码树与 manifest 声明不一致（声明文件缺失）」 | src 半拷贝/被改：按同步流程②重新覆盖 `src/` 与 manifest |
| harness 报「vendor 发布件缺失」 | 本目录应具备 schema 2 `src/` 与完整 source 声明；按同步流程重新覆盖。外部 legacy 布局只有在源码缺失、manifest 声明 wheel 且实际 wheel 在场时才可回退 |
| Python 版本错误 | 使用 **Python 3.10+** 创建隔离环境 |
| `verify_report` / 缺 `report-sections.yaml` | `ensureHylyreReady` 会探测 contracts，缺失时对默认 venv 从 vendor 强制重装 |
| vendor 已更新但 venv 仍旧版 | 用户重新发起 device-testing；agent Step 7 自跑 testing harness 时会自动对齐；仍失败则查 `hylyre-doctor.log`，必要时删 `.hylyre/venv` 后由 agent 再跑 Step 7 |
| 设置了 `HYLYRE_PYTHON` 且版本与 manifest 不一致 | harness **BLOCKER**；在该环境手动升级 hylyre，或取消 `HYLYRE_PYTHON` 改用默认 venv |
| 连续多轮 testing 状态污染 | 确认 `cold_restart_before_run` 为 true 或 `HARNESS_DEVICE_TEST_COLD_RESTART=1`；日志中 force-stop 勿出现 `-b` 语法 |
| 只记 adapter 后 testing 报缺 DevEco | 确认 framework 版本含 personal setup 内联 repair；或手动 `check-personal-setup --ensure --phase testing` |

## 不要做

- **不要**手改 `src/` 内任何文件或 `source.files[]`/`tree_sha256`；只从 Hylyre `dist/release-src` 覆盖同步，逐文件 hash 由 manifest 锁定。
- **不要**把 Hylyre 同步包里的 `integration_docs`、移交 md 或 `.whl` 提交进本目录。
- **不要**在 `src/` 里直接跑 `pip install`（in-tree build 会产 `build/`、`egg-info/` 污染）；harness 自动走临时副本。
- 设备栈等大体量传递依赖**不要**往本目录塞；走镜像与 pip 缓存。

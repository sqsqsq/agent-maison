# Hylyre vendor（hmos-app）

## 目录是什么

本目录是 **hmos-app** profile 集成真机自动化测试的 vendor 入口：内置 **纯 Python wheel**（跨 OS / Python 3.10+），整个目录**提交进 Git**（体量 < 1 MB），协作者 `git clone` 即可拿到，不依赖联网拉取 Hylyre 本体。

传递依赖（如设备侧 Hypium 栈）仍由首次 `ensure` 时通过 PyPI 镜像安装，不在本目录 vendor。

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
$dst = "D:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\vendor\hylyre"
Remove-Item -Force "$dst\hylyre-*.whl", "$dst\release.manifest.json" -ErrorAction Ignore
Copy-Item "$src\hylyre-*.whl", "$src\release.manifest.json" $dst

# ③ 校验
python D:\1.code\Hylyre\scripts\build_wheel.py --verify $dst
```

## 升级原则

- Commit message 建议：`chore(vendor): hylyre 0.1.0 -> 0.2.0`
- 正文粘贴 `release.manifest.json` 中关键字段（如 `hylyre_version`、`wheel.sha256`）

## 故障排查

| 现象 | 处置 |
|------|------|
| `build_wheel.py --verify` 报 sha256 不匹配 | 删除旧 wheel 后重新从 `dist/release` 覆盖拷贝 |
| 旧 wheel 残留 | 按同步流程② 先 `Remove-Item` 再拷贝 |
| Python 版本错误 | 使用 **Python 3.10+** 创建隔离环境 |
| `verify_report` / 缺 `report-sections.yaml` | 新版 `ensureHylyreReady` 会探测 contracts，缺失时对默认 venv 执行 `pip --force-reinstall` vendor wheel；仍失败则按 README 同步 `dist/release` 并必要时删 `.hylyre/venv` |

## 不要做

- **不要**手改 wheel 或 `release.manifest.json`；仅允许从 Hylyre `dist/release` **覆盖拷贝**。
- 设备栈等大体量传递依赖**不要**往本目录塞；走镜像与 pip 缓存。

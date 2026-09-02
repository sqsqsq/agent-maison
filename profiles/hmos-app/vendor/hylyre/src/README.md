# Hylyre

面向鸿蒙（HarmonyOS）真机测试的统一工具：**Hypium**（UI 自动化）+ **Lyrebird**（HTTP/HTTPS Mock），CLI 优先，可选 MCP 薄封装；对外 API 风格参考 [Midscene](https://midscenejs.com/api) 的语义动词。

- **规划（SSOT）**：[docs/plan.md](docs/plan.md)
- **Agent 默认如何用 Hylyre（不必每轮交代）**：[AGENTS.md](AGENTS.md) + [`.cursor/rules/hylyre.mdc`](.cursor/rules/hylyre.mdc)；MCP 一次性配置：[docs/cursor-mcp-setup.md](docs/cursor-mcp-setup.md)
- **进度**：[docs/progress.md](docs/progress.md)
- **输出契约（SSOT）**：`hylyre/contracts/`（`trace.json` / 测试报告章节与枚举）；确定性执行、selector 与证据说明见 [docs/deterministic-verification.md](docs/deterministic-verification.md)
- **当前推荐版本**：Hylyre **0.4.1**；结构化 selector identity（`by_id` / `by_key` / `id` / `key` / `selected_id`）在最终序列化中逐字保留，不再按文本规则脱敏；用户文本和值仍继续脱敏。

与业务仓 [SimulatedWalletForHmos](https://github.com/sqsqsq/SimulatedWalletForHmos) 的 **framework** 为**单向输出**关系：本仓不引用其代码；兼容性别名通过 GitHub Actions `compat-framework.yml` **软提醒**（不阻塞主 CI）。

## 技术栈与规范

- Python ≥3.10，CLI [Typer](https://typer.tiangolo.com/)
- 规约与变更：[OpenSpec](https://openspec.dev/)（`/opsx:propose` 等，见 `.cursor/commands`）
- 参考：[Hypium](https://pypi.org/project/hypium/)，[Lyrebird](https://github.com/Meituan-Dianping/lyrebird)

## 快速开始（需本机 Python 3.10+）

若刚用 winget 安装 Python，可将 `%LocalAppData%\Programs\Python\Python312` 与 `\Scripts` 加入用户 **PATH**，或全程使用：

```bat
"%LocalAppData%\Programs\Python\Python312\python.exe" -m pip install -e ".[dev]"
"%LocalAppData%\Programs\Python\Python312\python.exe" -m hylyre doctor
"%LocalAppData%\Programs\Python\Python312\python.exe" -m pytest
```

### 打发布件给下游 framework（vendor）

未在 PyPI 发布时，业务仓可将本仓库产出的 **`py3-none-any`** wheel 提交到其 `vendor/`。一条命令：

```bat
python scripts\build_wheel.py --clean
python scripts\build_wheel.py --verify dist\release
```

下游仓库若**禁止提交 `.whl` 等二进制归档**，改用**明文源码树**发布（manifest schema 2，与 wheel 模式并存）：

```bat
python scripts\build_wheel.py --source --clean
python scripts\build_wheel.py --verify dist\release-src
```

详见 **[docs/framework-vendor-bundle.md](docs/framework-vendor-bundle.md)**。

全局 OpenSpec CLI（已 npm 安装时 PATH 需含 `%AppData%\npm`）：

```bash
openspec list
```

## Lyrebird（HTTP Mock）工具链

使用 `hylyre mock …` 连接本机或远程 **Lyrebird** 前，请先准备依赖（也可用 `python -m hylyre doctor` 做自检）：

1. **仓库脚本（可选）**：已克隆本仓库且尚未 `pip install -e` 时，可用 [`scripts/bootstrap_mock.sh`](scripts/bootstrap_mock.sh)（POSIX）、[`scripts/bootstrap_mock.bat`](scripts/bootstrap_mock.bat) 或 [`scripts/bootstrap_mock.ps1`](scripts/bootstrap_mock.ps1)（Windows）：脚本会把仓库根加入 `PYTHONPATH` 并执行 `python -m hylyre bootstrap mock`，参数（例如 **`--install`**）原样转发，行为与直接调用 CLI 一致。
2. **Python 包**：`pip install 'hylyre[mock]'`（等同安装 `lyrebird`）。官方说明：<https://github.com/Meituan-Dianping/lyrebird#install>
3. **mitmproxy**：代理链路需要，PATH 中能运行 `mitmproxy` 或 `mitmdump`；安装见 <https://mitmproxy.org/>
4. **Windows**：按 Lyrebird 文档准备 **预编译 OpenSSL**，并配置环境变量 **`LIB`**、**`INCLUDE`** 指向对应目录；若 `pip` 编译 `netifaces` 等失败，需安装 **Microsoft C++ Build Tools**
5. **Docker（可选）**：可用镜像 `overbridge/lyrebird` 跑 Lyrebird，把管理 API 暴露到本机端口后，设置环境变量 **`HYLYRE_LYREBIRD_URL`**（例如 `http://127.0.0.1:9090`），即可在不使用 `hylyre mock start` 子进程的情况下对接
6. **VLM（P3，`hylyre ai action|query|assert`）**：需配置 **`HYLYRE_VLM_ENDPOINT`**（OpenAI 兼容 `…/v1/chat/completions`；DeepSeek 官方示例为 `https://api.deepseek.com/chat/completions`）、可选 **`HYLYRE_VLM_API_KEY`**、**`HYLYRE_VLM_MODEL`**；未配置时自然语言子命令会报错退出
7. **外部规划器（无 VLM）**：可不设 `HYLYRE_VLM_*`，由 Agent 用 **`hylyre dump-ui` / `hylyre screenshot`** 读取界面 facts，再输出 **`HylyreAgent.run_planned_*`** 同形 JSON（CLI：`hylyre run action|tap|input`）；增量报告 **`hylyre report begin|record|finalize`**。全流程约定见 **[docs/agent-loop.md](docs/agent-loop.md)**。也可用 **`interpret_query_payload`**、**`interpret_assert_payload`** 解析 VLM 形响应。
8. **场景跑批（P4）**：`hylyre run --plan … --feature … --report-out … --trace-out …`。加 **`--use-fakes`** 为离线桩结果；**omit** 时在已连接真机上跑：`pip install 'hylyre[device]'`，可选 **`--device-sn`**、**`--bundle`**（`start_app`）、**`--mock-port` / `--lyrebird-url`** + **`--mock-group`**。测试步骤支持**单行 JSON**（`action`/`touch`/`input`，无需 VLM）或**自然语言**（需 **`HYLYRE_VLM_*`**）。**`--skip-assert-expected`** 可跳过对「预期结果」列的 `ai_assert`；0.4.0 会把检查模式写入 `expected_check_mode`，并只以 `CaseResult.steps[]` 生成证据。
9. **做法 A（Cursor / NL → test-plan JSON）**：由 Agent 将意图写成 `test-plan.md`「测试步骤」列的**单行 JSON**，真机执行步骤时**不必**配置 VLM。约定与示例见 [`docs/agent-plan-a.md`](docs/agent-plan-a.md)、`tests/e2e/fixtures/json-steps-test-plan.md`。**AI 默认如何用 Hylyre**（无需每轮复述）：根目录 [`AGENTS.md`](AGENTS.md) + [`.cursor/rules/hylyre.mdc`](.cursor/rules/hylyre.mdc)；一次性 MCP 配置见 [`docs/cursor-mcp-setup.md`](docs/cursor-mcp-setup.md)

## 当前阶段

**0.5.0 引入 Step Outcome Protocol v1（破坏性）**：trace schema 升至 `0.4-p0`，所有结果 envelope 声明 `result_protocol: "hylyre.step-outcome/1"`。`StepResult.outcome` 是判别联合——`passed` 带 observation、`failed` 带 failure、`blocked` 带 cause、`skipped` 带 reason，互不兼容；status 只由「是否实际尝试」决定；selector 拆成 `request`/`resolution`；`blocked` 后缀指向根步骤而不再复制其失败分类。机器契约（Schema、规范、判定表、参考 reducer、218 个 golden fixtures）随包发布在 [`hylyre/contracts/`](hylyre/contracts/)，可离线读取与校验；消费方迁移见 [docs/migration-0.5.md](docs/migration-0.5.md)。真机复验仍为 pending。

## License

MIT（与上游依赖许可证分别遵守）。

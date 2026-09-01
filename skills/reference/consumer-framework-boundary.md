# 消费者工程 · framework 发布件边界（BLOCKER）

> 适用：集成 Maison **发布件**的实例工程（非 agent-maison 维护仓）。Maison 构建并校验 zip，宿主解压到工程根 `framework/`。它不是 Git submodule；宿主是否使用 Git、tracked/staged/committed/clean 与 Maison 无关。

## 写权限来自哪里

framework 控制面写权限来自模型外执行环境，不来自 env、`framework.config.json`、agent 自报、cwd、Git branch/HEAD/status：

| 身份 | 可写范围 | 权限来源 |
|---|---|---|
| Maison maintainer | Maison 源仓与发布产物 | maintainer task sandbox / OS 主体 |
| Host consumer agent | 宿主产品、feature、runtime；framework 控制面只读 | task sandbox / restricted token / read-only mount |
| User-triggered updater | 明确集成窗口临时写 framework | 用户或 CI 启动的受控操作 |

有 task sandbox、只读挂载、不同 OS 主体或 ACL 时，应从物理上拒绝普通 host task 写控制面。若维护者与宿主 agent 运行在同一个 Windows 用户且没有受限 token，就不存在可证明的身份隔离。

这种降级环境只保留合作式 Write/Edit/MultiEdit/NotebookEdit 守卫：它会拒绝射程内的控制面编辑，但判定异常 fail-open，且不覆盖 shell 重定向、脚本、`node -e` 或场外进程。**没有** Git/hash/manifest 查时 detector 兜底；盲区必须被诚实承认。

## 禁止事项

普通 host agent 不得在 `framework/` 控制面修改或新建文件，包括 `profiles/`、`harness/`、`skills/`、`package.json` 与临时脚本。允许写入仅限：

- harness 自动产生且命中 `specs/runtime-artifact-policy.json` 写放行口径的 runtime 文件；
- Maison 维护者在源仓开发；
- 用户/CI 明确触发的发布件集成窗口。

发现 framework 缺陷时，不得在宿主改门禁“让检查变绿”。应带报告/栈回灌 agent-maison 源仓，修复后重新发布，再由用户/CI 明确集成。宿主 add/stage/commit 不是 Maison 放行步骤。

历史 `integrity.drift_allowlist` 与 `integrity.allow_local_drift` 已退役：为存量 config 无损读取可继续解析，但读取即忽略，不能解锁守卫、不能改变 verdict，也不会产生运行时迁移 advisory。迁移说明见 schema/template/MIGRATION。

## 临时诊断脚本去处

- 放 `<repo-root>/scratch/`（宿主自行决定是否忽略）或系统临时目录；
- 不放 `framework/`；
- 需要调用 framework 内部函数时，从 scratch 以相对/绝对路径 import；
- 用完即删，正式脚本回宿主合法目录并按项目规则管理。

## package identity 与完整性

- 发布件完整性只在 Maison pack/release verify 与用户明确触发的 updater/集成边界校验；
- 普通 init/phase 不遍历 manifest `files[]`、不比较宿主 Git/HEAD；
- version、manifest `source_commit`/`built_at` 与 sidecar 声明的 manifest SHA 可作非阻断 package identity；缺失/异常最多显示 unknown/WARN；
- 新运行不产生 `framework_integrity`、`framework_control_plane_dirty` 或永久 SKIP/PASS 空壳结果；旧报告值只作历史 provenance。

## framework 资产树不承载宿主产物

`framework/harness/` 只承载发布件代码与 harness runtime 目录。禁止在其中放宿主 `*.test.ets`、`ohosTest/`、`test/dag/` 或 `{package_path}/` 模块树。宿主测试产物须写回 contracts 声明的宿主模块路径。

## 常见依赖问题

若出现 `Cannot find module 'yaml'` / `ts-node`：

1. 检查 `framework/harness/node_modules/ts-node/package.json`；
2. 缺失时仅在 `framework/harness` 执行 `npm install`；
3. 禁止在宿主根或 `framework/` 根安装 harness runtime。

若发布件自身文件缺失，重新取得并集成同一已验证发布件；不要用 npm install、Git checkout 或宿主提交修补发布件身份。

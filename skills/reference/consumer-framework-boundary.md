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

> 宿主发现问题的**分类与回流路径**（框架缺陷 / 输入缺口 / 宿主问题）见
> [真实宿主准入与回灌契约](./real-host-admission-and-feedback.md)（§缺口回流路径）。

历史 `integrity.drift_allowlist` 与 `integrity.allow_local_drift` 已退役：为存量 config 无损读取可继续解析，但读取即忽略，不能解锁守卫、不能改变 verdict，也不会产生运行时迁移 advisory。迁移说明见 schema/template/MIGRATION。

## 材料归属与临时文件清理

- 需求相关的正式产物、证据和临时材料归对应的既有蓝图/Feature 目录；正式产物与已引用证据沿现有路径保留，不因是截图、日志或 JSON 就当作临时件删除。
- 蓝图阶段的临时件放 `<features_dir>/<blueprint_id>/blueprint/` 内；**蓝图工作区根 `<features_dir>/<blueprint_id>/` 不放任何临时件**。首次 CU 候选固定为 `blueprint/change-unit-candidates.json`，内容修订候选为同目录 `change-unit-revisions.json`。
- 已有 CU 或 legacy Feature 的临时脚本、文本、截图、日志放该 Feature 内的 `tmp/` 子目录；不放 Feature 根目录或 `ux-reference/`，避免被读成需求原文或正式参考图。Feature 路径与 `<features_dir>` 复用框架解析（`paths.features_dir` 默认 `doc/features`），不按显示名另建目录。
- 无关需求的一次性诊断放系统临时目录。独立 request、compile、`_adhoc` 的正式输出仍沿各自既有报告目录，不借用 Feature 证据目录。
- 临时材料在所服务的操作完成、且不再承担恢复或证据责任时，由创建者清理。新 CU 候选由 `check:change-unit --accept-candidates` 在接受成功后立即删除，即使后续 readiness 未就绪或文档物化失败；拒绝时保留。CU 修订示例在本批 `revised/unchanged` 完成后删除，busy、拒绝或异常时保留。清理失败只提示，不撤销已接受/修订事实，不要求重复提交。
- 上述目录约定不扩大写权限：不放 `framework/`，仅允许写草稿的无人值守设计修复仍只写指定草稿。需要调用 framework 内部函数或依赖时，可在 `framework/harness` 用 `ts-node --eval`，文件输出仍用所属目录的明确路径，见 [CU 内容修订示例](../../docs/concepts/blueprint-design-inputs.md#未完成-cu-内容修订)。正式脚本回宿主合法目录并按项目规则管理。
- 新规则不自动迁移或删除历史文件；历史材料按归属与引用情况另行处理。

## package identity 与完整性

- 发布件完整性只在 Maison pack/release verify 与用户明确触发的 updater/集成边界校验；
- 普通 init/phase 不遍历 manifest `files[]`、不比较宿主 Git/HEAD；
- version、manifest `source_commit`/`built_at` 与 sidecar 声明的 manifest SHA 可作非阻断 package identity；缺失/异常最多显示 unknown/WARN；
- 新运行不产生 `framework_integrity`、`framework_control_plane_dirty` 或永久 SKIP/PASS 空壳结果；旧报告值只作历史 provenance。
- 宿主 Git checkout 若会对 `framework/` 路径做行尾转换（Windows 默认 `core.autocrlf=true`），须在宿主 `.gitattributes` 钉 `framework/** -text`。含义是禁止 Git 对这些路径做任何行尾转换、保留首次提交的原始字节，不是"强制 LF"。顺序：先配置该规则，再从已验证发布件恢复 `framework/` 原始字节，然后提交；否则会把已经变成 CRLF 的字节永久钉住。Hylyre vendor 安装前门按落盘原始字节复算 tree hash，被改成 CRLF 的源码树会被拦下并点名"行尾改写"（不按归一化放行），此时"重新同步 vendor"只会在下次 checkout 再次翻转，唯一修法就是上面这条属性。发布件本身不带 `.gitattributes`，宿主 SCM 配置不属于 Maison 职责。

## framework 资产树不承载宿主产物

`framework/harness/` 只承载发布件代码与 harness runtime 目录。禁止在其中放宿主 `*.test.ets`、`ohosTest/`、`test/dag/` 或 `{package_path}/` 模块树。宿主测试产物须写回 contracts 声明的宿主模块路径。

## 常见依赖问题

若出现 `Cannot find module 'yaml'` / `ts-node`：

1. 检查 `framework/harness/node_modules/ts-node/package.json`；
2. 缺失时仅在 `framework/harness` 执行 `npm install`；
3. 禁止在宿主根或 `framework/` 根安装 harness runtime。

若发布件自身文件缺失，重新取得并集成同一已验证发布件；不要用 npm install、Git checkout 或宿主提交修补发布件身份。

## Context

`framework_integrity` 从 consumer per-file SHA256 逐步扩张出 sidecar、foreign-file、allowlist、tmp hygiene、六 subtype halt/recovery，随后在 3.0.0 草案中又被替换为 scoped Git dirty。两代方案的共同错误是让普通运行在同一可写主体内事后证明 framework 身份。

2026-09-01 事故把 Git 方案直接证伪：完整有效的新发布件覆盖旧 HEAD 后正常出现 304 条 M/D/??，catalog 的唯一 BLOCKER 却是 `framework_control_plane_dirty`。Git 状态不能区分合法 updater 与非法修改；commit 只会改变检测结果，不会改变发布件字节。

此外还有一条独立生产读取：`visual-feedback.ts` 在 phase 内以 `frameworkRoot` 为 cwd 执行 `git rev-parse HEAD`，导致同一发布件在 dirty/staged 时记录旧宿主 HEAD、commit 后记录新 HEAD、非 Git 时记录 null；它还对 `RELEASE-MANIFEST.sha256` 文件文本再做 sha256，而不是读取其中已声明的 manifest SHA。

## Goals / Non-Goals

**Goals**

- 让普通 init/phase 的 Maison verdict 与 Framework identity 对宿主 Git 状态完全不变。
- 把发布件完整性严格留在 pack/release verify 与明确集成边界。
- 用一个现有 package identity loader 向 check-init 与 visual-feedback 提供 version、source commit、built time、manifest SHA，全部非阻断。
- 保留强隔离与合作式编辑守卫两档，并诚实写明后者盲区。
- 保留旧报告只读兼容与真实 process integrity 裁决。
- 清除当前发布内容的 submodule/HEAD/宿主提交操作性叙事。

**Non-Goals**

- 不新增 runtime hash、Git detector、install tree/ref baseline、HEAD tree 对比、trust DB、新 sidecar、签名字段、allowlist、环境变量 bypass 或 updater-running 标志。
- 不让普通 init/phase 重算 manifest `files[]`。
- 不重构无关 goal/summary、provider per-TC、Hylyre 协议/source。
- 不改 archived change、旧报告或旧 release notes 原件。
- 不执行宿主 T8、真机、release pack/all、提交或推送。

## Decisions

1. **宿主 Git 永远不是 Framework 身份输入。** 是否为 Git 仓、tracked/staged/unstaged/untracked/clean/committed、HEAD 是否是旧发布件，对 ordinary init/phase verdict 和 package identity 均无影响。修复删除生产者，不生成 SKIP 空壳，也不移到其它 phase。
2. **强隔离与合作式守卫二档。** 有 OS/sandbox/ACL/read-only mount/restricted token 时，执行环境证明普通 host task 无写权；同一 Windows 用户下只保留 Write/Edit/MultiEdit/NotebookEdit guard。后者 fail-open，shell/脚本/场外进程不在射程；文档直接承认，禁止事后检测补偿。
3. **一个 package identity loader。** `framework-integrity.ts` 保留 manifest/identity/EOL helper，删除全部 Git 代码。loader 读取 manifest 的 version/`source_commit`/`built_at`，并直接解析 `RELEASE-MANIFEST.sha256` 的 64-hex 值为 `manifest_sha256`。不遍历 `files[]`、不重算发布树。
4. **visual-feedback 复用身份。** 现有 `framework_commit_sha` 字段为兼容保留，但唯一来源改为 manifest `source_commit`；`framework_package_digest` 等于 sidecar 声明的 manifest SHA，而不是 sidecar 文本哈希。缺失/损坏为 null/unknown，不改变 visual verdict。
5. **legacy config 只读兼容。** `integrity.allow_local_drift` / `drift_allowlist` 可被 schema/config parser 保留以避免无损 UPDATE 丢字段，但不影响 guard/verdict，不生成 runtime advisory。迁移说明只在 schema/template/MIGRATION。
6. **goal 按来源收口。** 新运行不再从 framework Git 产生 integrity blocker；`node_options_injection` 等真实 `blocking_class=integrity` 仍走既有 `framework_integrity_block`/framework_fault 安全路径。每个 current attempt 从 raw summary 只派生一次过滤后的 `decisionSummary`，classification、meta、affected files、signature/no-progress、actionability、repair/reconcile 与新事件统一消费它；旧 framework subtype 只被历史 parser/renderer 读取。
7. **发布内容单一拓扑。** Maison 只交付已验证发布件，宿主将其解压到 `framework/`。现行 README/Skill/模板不得给出 submodule 命令、双布局、gitlink、Framework HEAD 或“提交后生效”。否定性“不是 submodule”和第三方 Hylyre `vendor/` 专名可保留。
8. **smoke 用真实 stage 证明事故。** lifecycle registry 重定义历史 CRLF 用例，并新增连续编号的“旧 HEAD→完整新包镜像覆盖→M/D/??→不提交→init/catalog 正常”用例；`coveredBy` 必须命中真实 stage，删除 stage/context 接线即失败。

## Risks / Trade-offs

- [Risk] 同一用户下 shell 或场外进程可修改 framework 而不被 Maison发现。→ 这是该环境真实能力边界；只读权限缺失不能由检测伪装补齐。
- [Risk] 删除 Git dirty 后不再发现未提交误写。→ Git dirty 从未证明来源；Write/Edit guard 防合作式误操作，真正隔离交给 OS/sandbox。
- [Risk] 历史报告仍含旧 integrity 分类。→ 读取侧保留 provenance；current attempt 用单一 `decisionSummary` 剥离后再进入全部裁决/事件面，writer、恢复分支与 no-progress signature 均不得复活旧值。
- [Risk] `framework_commit_sha` 名称历史上含混。→ 为兼容保留字段，但契约明确它是发布件 `source_commit`，测试锁定五种 Git 环境逐字段相同。
- [Trade-off] 当前发布文档清理面较广。→ 用发布内容有界文本核查锁定操作性残留；不扫描 archived/旧报告/旧 release notes，也不误删业务 Git 与 Hylyre vendor 专名。

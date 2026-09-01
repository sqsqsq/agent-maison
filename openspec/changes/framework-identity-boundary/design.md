## Context

`framework_integrity` 从 consumer per-file SHA256 逐步扩张出 sidecar、foreign-file、allowlist、tmp hygiene、六 subtype halt/recovery，随后在 3.0.0 草案中又被替换为 scoped Git dirty。两代方案的共同错误是让普通运行在同一可写主体内事后证明 framework 身份。

2026-09-01 事故把 Git 方案直接证伪：完整有效的新发布件覆盖旧 HEAD 后正常出现 304 条 M/D/??，catalog 的唯一 BLOCKER 却是 `framework_control_plane_dirty`。Git 状态不能区分合法 updater 与非法修改；commit 只会改变检测结果，不会改变发布件字节。

此外还有一条独立生产读取：`visual-feedback.ts` 在 phase 内以 `frameworkRoot` 为 cwd 执行 `git rev-parse HEAD`，导致同一发布件在 dirty/staged 时记录旧宿主 HEAD、commit 后记录新 HEAD、非 Git 时记录 null；它还对 `RELEASE-MANIFEST.sha256` 文件文本再做 sha256，而不是读取其中已声明的 manifest SHA。

2026-09-01 的后续真实回归又暴露两条与之相邻、但成因独立的问题。其一是 framework-init 被扩成 Git/SCM 自然语言分类器：discovery description 主动放入 Git/SCM/status/diff/add/stage/commit/push，canonical 建立 Git-only 优先级、十行输入/route 表与两个 Git route label，AGENTS/README/commands/bridge 复制 Git handoff，单测再维护第二份 `ROUTING_CASES`。这没有造成第二次 init 执行，但它把 Skill 变成普通请求的分类器，违反职责边界。其二是更早形成的存量宿主 SCM 耦合：`show-last-committed-framework-config.mjs`（`062f7dbf`）、`canonical-gitignore.ts`（`dd2dd717`）与 planner 的 `ensure-gitignore` task（`ab83de8f`）。这两类成因不同，但都违反同一条“宿主 SCM 不属于 Maison 契约”的边界，故同批退场。

直接故障则是第三件事：同一 task 内，用户显式 init 产生唯一真实 run `20260901T122648Z` 后，下一条普通消息零工具调用、零新报告，Agent 却逐字重播了上一轮 S4 的计数与报告路径。这是 current-turn 结果污染，不是 init 内核缺陷——`buildRunSummary` 本身只总结传入的 log。

## Goals / Non-Goals

**Goals**

- 让普通 init/phase 的 Maison verdict 与 Framework identity 对宿主 Git 状态完全不变。
- 把发布件完整性严格留在 pack/release verify 与明确集成边界。
- 用一个现有 package identity loader 向 check-init 与 visual-feedback 提供 version、source commit、built time、manifest SHA，全部非阻断。
- 保留强隔离与合作式编辑守卫两档，并诚实写明后者盲区。
- 保留旧报告只读兼容与真实 process integrity 裁决。
- 清除当前发布内容的 submodule/HEAD/宿主提交操作性叙事。
- 让 framework-init 只由明确正向 init 意图或当前真实 S1 continuation 进入，普通请求不选择、不读取、不经过它。
- 让 init 完全不读写宿主 `.gitignore`，也不从 SCM 历史恢复 config。
- 把 S4 的证明范围钉死在产生它的那个 turn/run。

**Non-Goals**

- 不新增 runtime hash、Git detector、install tree/ref baseline、HEAD tree 对比、trust DB、新 sidecar、签名字段、allowlist、环境变量 bypass 或 updater-running 标志。
- 不新增生产 NL router、route service、route map/parser、状态机、nonce/token/租约或外部会话状态。
- 不迁移、不清理、不反向修改宿主已有 `.gitignore`。
- 不把“先 X 再 init”的顺序理解放进 framework-init：那属于主 Agent 契约。
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
8. **framework-init 是纯正向入口，不是路由器。** 机器 description（`skills/skills.index.yaml` 为唯一 SSOT，bridge 与三个 checked-in command frontmatter 逐字相等）只描述正向适用范围，不含 `Git`/`SCM`/`status`/`diff`/`add`/`stage`/`commit`/`push`。canonical 删除 route/result 名称集合、十行自然语言表、`framework-init-routing-contract` 锚点、Git-only 优先级与“先 X 再 init”编排；只保留显式正向入口、当前真实 S1 的合法批准、明确取消，以及原 Tier_1→S1→S2→S3→S4 内核。防误选**主要靠正向 description**；误加载兜底只是客户端/模型错选时的最后一道，写成一段无名称的零副作用退出，位于 readiness/S1/任何 harness 命令之前。它不命名、不枚举、不落 route 表，也不引入 router/状态机/env key。
9. **宿主 SCM 不是 init 的对象。** `.gitignore` 是宿主自己的 SCM 配置：init 不读、不诊断、不创建、不修改，`ensure-gitignore` task、`ensureCanonicalGitignore` writer、inspection #11、canonical host patterns/等价映射/advisory 与 `CHECK_INIT_SKIP_GITIGNORE_SYNC` bypass 一并删除，且不留 SKIP/PASS 空壳。config 输入只剩磁盘 config、模板/backfill/migration 与 S2 payload；不从 HEAD/index/stash/ref 猜测。宿主已有 `.gitignore` 字节原样保留。
10. **runtime artifact policy 原位迁成 Git 中性 helper。** `specs/runtime-artifact-policy.json` 仍是唯一真源，仍服务两件真实能力：Write/Edit guard 的写放行边界，以及 release pack/verify 对 ignored 目录内发布件的文件集合保护。把仍有消费者的 `RuntimeArtifactPolicy` 类型、loader 与 `matchesPolicyPattern` 从 `canonical-gitignore.ts` 移到 `harness/scripts/utils/runtime-artifact-policy.ts`——只是移动既有 reader，不新增状态、不复制 JSON、不建第二份真源。gitignore 派生、等价映射、advisory 与 writer 随文件一起删除。
11. **S4 只属于产生它的 turn/run。** 约束落在 canonical 与 command 文本，使用对话里已有的事实（最新用户消息、本 turn 是否执行了新 S3、本 turn 是否拿到新 run-log）。不写磁盘状态、不改 run-log schema、不给报告加 token、不把报告目录扫描做成生产路由器。合法 S2 continuation 仍保留，但必须本轮真正新建 S3 run 才能产出新 S4。
12. **smoke 用真实 stage 证明事故。** lifecycle registry 重定义历史 CRLF 用例，并新增连续编号的“旧 HEAD→完整新包镜像覆盖→M/D/??→不提交→init/catalog 正常”用例；`coveredBy` 必须命中真实 stage，删除 stage/context 接线即失败。

## Risks / Trade-offs

- [Risk] 同一用户下 shell 或场外进程可修改 framework 而不被 Maison发现。→ 这是该环境真实能力边界；只读权限缺失不能由检测伪装补齐。
- [Risk] 删除 Git dirty 后不再发现未提交误写。→ Git dirty 从未证明来源；Write/Edit guard 防合作式误操作，真正隔离交给 OS/sandbox。
- [Risk] 历史报告仍含旧 integrity 分类。→ 读取侧保留 provenance；current attempt 用单一 `decisionSummary` 剥离后再进入全部裁决/事件面，writer、恢复分支与 no-progress signature 均不得复活旧值。
- [Risk] `framework_commit_sha` 名称历史上含混。→ 为兼容保留字段，但契约明确它是发布件 `source_commit`，测试锁定五种 Git 环境逐字段相同。
- [Risk] 静态测试无法证明真实客户端不会为普通请求误选或预加载 framework-init。→ 明确承认：Maison 内部测试只能证明已发布文本、物化字节与内部 fixture；客户端选择算法与模型长上下文行为在证明边界外，测试命名与完成说明须如实限定。
- [Risk] 删除宿主 `.gitignore` 管理后，宿主可能把 harness 运行时产物提交进版本库。→ 那是宿主的 SCM 决策；Maison 的运行时输出边界由 `specs/runtime-artifact-policy.json` 与各 writer 的路径契约保证，与宿主是否忽略无关。既有 `.gitignore` 行不会被删除，存量宿主行为不变。
- [Trade-off] 当前发布文档清理面较广。→ 用发布内容有界文本核查锁定操作性残留；不扫描 archived/旧报告/旧 release notes，也不误删业务 Git 与 Hylyre vendor 专名。

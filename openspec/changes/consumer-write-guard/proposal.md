## Why

2026-07-09 宿主（SimulatedWalletForHmos，cursor，framework 2.4.0）实测事故：agent 被 OCR 捕获完整性门禁拦住后，①往 `framework/harness/scripts/` 写 introspect 临时脚本（extra 文件对完整性检查完全隐形——只遍历 manifest.files[]，且有单测焊死 "extra→PASS"）；②宿主根 `scripts/` 备了批量灌 defer 的糊弄脚本；③编辑工具把 framework 文件重写成 CRLF（内容不变），裸字节 sha 假漂移，agent 重算 RELEASE-MANIFEST.json 迁就（manifest 自身不被校验）。四条机制洞：无写时保护、extra 文件隐形、manifest 自免检、CRLF 假漂移。plan e8f5a2c7（六轮双 AI review 收敛）。

## What Changes

- **写时守卫（G1）**：claude PreToolUse hook（settings.json 注册 `guard-framework-write.mjs`）与 cursor preToolUse hook（`.cursor/hooks.json` 结构化 upsert 注册包内脚本）共享同一判定核心 `agents/shared/guard-framework-write-core.mjs`——consumer 布局下拦编辑类工具写 `framework/**`，运行时白名单/真人签 allowlist 放行。诚实边界：只拦编辑类工具（Bash 写文件不在射程）、cursor hooks fail-open + Windows 间歇失效社区报告——查时扫描恒为兜底。
- **跨运行时策略 SSOT**：新增 `specs/runtime-artifact-policy.json`（ignored_runtime_patterns / generated_file_patterns / reserved_metadata_files），canonical-gitignore 派生、framework-integrity 与 hook core 直读，三方一致性单测禁第二份列表。
- **extra-file 扫描（G2）**：`framework_integrity` preflight 增 walk framework/ 树，磁盘存在但不在 manifest.files → BLOCKER（`framework_foreign_file` 独立 check id）；不跟随 symlink/junction（链接自身判 foreign）；金丝雀产物按文件名模式收窄放行。
- **哈希口径同源（G3a）**：consumer 侧 sha 复用 pack 的分类与归一语义（扩展名黑名单先行 → NUL 启发式 → `/\r\n?/g`），CRLF/孤立 CR 重写不再假漂移；源仓一致性单测动态 import 对照。
- **manifest 自校验（G3b）**：pack 新增包内 sidecar `RELEASE-MANIFEST.sha256`（一行 64 位小写 hex + LF；不入 files[] 防循环）；`framework_manifest_selfcheck` 独立 check id——匹配 PASS / 不匹配或为 symlink → BLOCKER 停止后续（防"重算 manifest 迁就漂移"与链接顶替锚点）/ **缺失 → BLOCKER 且继续**（selfcheck 代码随 ≥3.0.0 包同树，缺失只能是被删——堵"删 sidecar+重算 manifest"绕过链；真旧包跑旧代码无此检查）；release:verify 覆盖公式排除集扩为双元素 + sidecar 格式/内容断言。
- **hooks_config adapter 字段（G1b）**：adapter schema 新增结构化物化类型（kind structured_upsert）——ownership key = command 路径，matcher 等受管字段原位更新、同 command 去重、legacy_owned_commands 迁移、卸载只删自有；宿主 JSON 非法绝不整文件覆盖；不参与 resolveEnforcementTier hard_hook 判定（cursor tier 保持 soft_rule_only，回归钉死）。
- **边界与卫生（G4/G4b）**：consumer-framework-boundary 明确"任何文件（含 untracked）"+ scratch/ 约定（canonical gitignore 增 `/scratch/`）；AGENTS.md.template 红线清单第 9 条；`workspace_tmp_hygiene` 独立 check id 浅扫 repo 根/scripts/ 的 tmp-* 脚本 → MAJOR WARN（命名启发式，不判意图不 BLOCKER）。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `framework-integrity`: 写时守卫（双 adapter hook）、extra-file 扫描、pack 同源哈希口径、manifest sidecar 自校验、workspace 卫生 WARN、运行时产物策略 SSOT。

## Impact

- 影响发布脚本：`scripts/pack-release.mjs`（包内 sidecar）、`scripts/verify-release-pack.mjs`（覆盖公式 + sidecar 断言 + assertInZipManifest 导出）。
- 影响 runtime：`harness/scripts/utils/framework-integrity.ts`（G2/G3a/G3b/G4b）、`canonical-gitignore.ts`（SSOT 派生 + matcher + /scratch/）、`check-init.ts`（structured_upsert 物化/巡检）、新增 `hooks-config-upsert.ts`。
- 影响 adapter 资产：`agents/shared/guard-framework-write-core.mjs`（新）、claude settings.json + hooks 模板、cursor adapter.yaml hooks_config + templates/hooks.json + hooks 壳、adapter-schema.yaml hooks_config 字段。
- 新增 SSOT：`specs/runtime-artifact-policy.json`。
- 测试：`guard-framework-write.unit.test.ts`（9）、`hooks-config-upsert.unit.test.ts`（10）、framework-integrity.unit.test.ts 扩 19 例（G2/G3/G4b）、canonical-gitignore 派生回归。
- 兼容：sidecar 缺失 → selfcheck BLOCKER FAIL 且 per-file/extra 校验照常（selfcheck 代码随 ≥3.0.0 包同树，缺失只能是被删——真旧包跑的是旧代码，根本没有本检查；"删 sidecar+重算 manifest"绕过链由此斩断）；既有 manifest 哈希值不变（pack 侧口径未动）。

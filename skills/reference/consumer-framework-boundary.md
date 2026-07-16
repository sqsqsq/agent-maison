# 消费者工程 · framework 子模块边界（BLOCKER）

> 适用：通过 git submodule / vendor 引入 `framework/` 的**实例工程**（非 agent-maison 维护仓本身）。

## 禁止

除以下情形外，**不得**在 `framework/` 下修改或新建**任何文件**——含 `profiles/`、`harness/`、`skills/`、`package.json` 等已跟踪文件，也含**新建的 untracked 临时脚本**（2026-07-09 宿主事故实锤：agent 往 `framework/harness/scripts/` 写 `tmp-ocr-audit.mjs` 做 introspect——untracked 同样禁止，`framework_foreign_file` 门禁会 BLOCKER）：

- 用户明确要求升级 framework 版本（submodule bump / rsync / 发版 zip 覆盖，或 framework-init UPDATE）；
- agent-maison 维护者在 **framework 源仓库** 内开发并发版；
- 运行时产物白名单（`specs/runtime-artifact-policy.json`：reports/state/node_modules/vision-canary 产物等）由 harness 自动写入，非 agent 手写范围。

**绝不允许**：修改 `framework/RELEASE-MANIFEST.json` 去迁就本地漂移（"重算 manifest 让完整性检查变绿"——`framework_manifest_selfcheck` 会 BLOCKER）；发现框架自身问题应 halt 上报，不得就地修改后自批放行。

典型错误（须回滚）：

| 误改 | 正确做法 |
|------|----------|
| `framework/package.json` 增加 `dependencies.yaml` | `cd framework/harness && npm install`（Tier_1，见 [host-harness-readiness.md](./host-harness-readiness.md)） |
| `framework/profiles/hmos-app/harness/ts-compile.ts` 补 `MockKit`/`when` ambient | 升级含 Test Double Policy 的 framework 发版；实例 UT 按 [mock-plan-schema.md](../../profiles/hmos-app/skills/business-ut/templates/mock-plan-schema.md) 声明 `strategy: mockkit` |
| 在实例内「改门禁让 UT 变绿」 | 修 **宿主** `ohosTest` / `<features_dir>/<feature>/ut/` 产物 |
| UT / Spy / DAG 误写在 `framework/harness/` | 迁回 `<repo-root>/{package_path}/...`；删 harness 下误写目录；见 [harness-cli-cwd.md §2.5](./harness-cli-cwd.md) |
| 临时诊断脚本写进 `framework/harness/scripts/` 或 repo 根 `scripts/tmp-*.js` | 放 `<repo-root>/scratch/`（见下节）或系统临时目录，用完即清 |
| 重算 `RELEASE-MANIFEST.json` 迁就本地改动 | 还原文件重跑；确需 fork 由真人在 `integrity.drift_allowlist` 具名审批 |

## 临时诊断脚本去处（scratch 约定）

调试/取证需要写一次性脚本时（dump 数据、introspect 门禁、批量改产物草稿）：

- **放 `<repo-root>/scratch/`**（init canonical gitignore 已含 `/scratch/`，不进版本管理），或系统临时目录（`os.tmpdir()`）；
- **不放**：`framework/` 任何位置（`framework_foreign_file` BLOCKER）、repo 根、宿主 `scripts/`（`workspace_tmp_hygiene` 会 MAJOR WARN 提醒 `tmp-*` 命名的脚本）；
- 需要调用 framework 内部函数做 introspect：从 scratch/ 以相对/绝对路径 import `framework/harness/...`，不要把脚本挪进 framework 换取短 import 路径；
- 用完即删——scratch/ 不是长期存放地，正式脚本请命名规范并纳入版本管理。

**两条运维提示**：①`framework/specs/runtime-artifact-policy.json` 是三方共读的运行时产物白名单——**勿删**（缺失时完整性扫描按"宁严勿松"不放行任何运行时目录，node_modules 等会被当外来文件 BLOCKER 刷屏，属预期防御行为，经 framework-init UPDATE 重铺恢复）。②写时守卫只认**逐路径**的 `integrity.drift_allowlist` 真人审批，不认 `allow_local_drift` 总开关（总开关仅把查时结果降 WARN，写入时仍会被拦）——比查时更严是有意设计，需要写某个 fork 文件请逐路径审批。

## 修改 framework 发布件前必读（宿主热修正规通道）

> 立项事故（2026-07-13 bc-openCard）：宿主 agent 经用户口头同意直接热修了 7 个 framework 门禁脚本——修复本身是对的，但没走审批通道，正在跑的 goal run 把它们判成漂移、还依旧话术把**真修复回滚回了有 bug 的发布版**，拉锯烧了两个多小时。

发现 framework 缺陷时，按序：

1. **首选：上报回灌源仓**——带上 harness 报告的完整栈/漂移清单，等新发布件；不改本地。
2. **等不及需本地热修**：改之前由**真人**在 `framework.config.json` 的 `integrity.drift_allowlist` 逐路径添加 `{path, rationale, approved_by}` 具名审批（approved_by 必须真人署名——自动化身份/`user_requirement` 无效；agent 不得自改后自批）。先审批后动手，顺序不能反（写时守卫会拦无审批写入）。
3. **goal run 正在跑**：先停 run（或接受 run 内被 `framework_integrity_block` halt 后再续跑）。goal agent 对 framework 发布件零写权限——它不会也不该替你处理漂移。
4. **授权粒度**：用户批准"修某个 bug"不等于批准批量清扫——要扩大改动面（如同模式多文件修复）先回问一句再动手。逐文件审批条目也要跟着补齐。

## framework 资产树不承载宿主产物

`framework/harness/` 仅用于 harness 运行时（reports、state、node_modules 等）。**禁止**在此目录 Write 宿主 `*.test.ets`、`ohosTest/`、`test/dag/` 或 `{package_path}/` 整树。`check-ut` 门禁 `harness_host_artifact_pollution` 会 BLOCKER。

### 误写 UT 迁移（示例）

```bash
# 1. 发现误写
find framework/harness -name "*.test.ets"

# 2. 迁移（package_path 以 contracts.yaml 为准）
# framework/harness/02-Feature/Demo/... → 02-Feature/Demo/...

# 3. 清理
rm -rf framework/harness/02-Feature
git -C framework status

# 4. 验证
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <feature> --summary
```

> **gitignore 二级保险**：init 可能忽略 `framework/harness/**/ohosTest/` — **忽略 ≠ 允许**；仍以 filesystem 门禁为准。

## `Cannot find module 'yaml'` / `ts-node`

1. 确认 `framework/harness/node_modules/ts-node/package.json` 存在。
2. 不存在 → **仅**在 `framework/harness` 执行 `npm install`。
3. **禁止**在 `framework/` 根或实例工程根安装 harness 运行时依赖。

## TS2614：`@ohos/hypium` 无 `MockKit` / `when`

- **禁止**在消费者 submodule 改 `ts-compile.ts`。
- 若 UT 使用 Hypium MockKit：mock-plan 须声明 `strategy: mockkit`（见 business-ut Step 1.6）；framework 版本须已支持该策略。
- 若尚未升级：临时用 Spy/`whenXxx` 过渡，或等待 framework 发版。

## 实例回滚命令（示例）

```bash
git -C framework checkout -- profiles/hmos-app/harness/ts-compile.ts package.json
# 或对齐 submodule 指针：
git submodule update --init framework
```

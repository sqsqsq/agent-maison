# Tasks: Consumer Write Guard（plan e8f5a2c7）

## 1. G1a claude 写时守卫 + 跨运行时 SSOT

- [x] `specs/runtime-artifact-policy.json` 三段 SSOT（ignored_runtime_patterns / generated_file_patterns（金丝雀两文件名模式收窄）/ reserved_metadata_files（sidecar））
- [x] `agents/shared/guard-framework-write-core.mjs`（零依赖 node ESM：布局判定 + glob-lite 匹配 + allowlist 语义复刻 approvalInvalidReason/isHumanVerified + 教育文案）
- [x] claude 壳 `guard-framework-write.mjs` + settings.json PreToolUse 注册（matcher Write|Edit|MultiEdit|NotebookEdit；deny=exit 2+stderr）；adapter.yaml 注释修准确
- [x] `canonical-gitignore.ts` framework 段改由 SSOT 派生（GITKEEP_DIRS 展开保持逐字节一致，既有 12 例 gitignore 测试零改动通过）+ TS 侧 matcher（与 .mjs 语义等价）
- [x] 单测 `guard-framework-write.unit.test.ts` 9 例：真实子进程拦本事故 tmp 文件/白名单放行/相对路径/源仓放行/金丝雀模式收窄/sidecar 放行/fail-open + **五负例 allowlist** + **C1 TS↔mjs 判定矩阵等价 + AUTOMATION_SIGNER_IDS 同步断言** + **C2 policy 三方一致**

## 2. G2 extra-file 扫描

- [x] `scanForeignFiles`：walk framework/ 树，不在 manifest.files → BLOCKER（独立 id `framework_foreign_file`）；白名单唯一来源 SSOT；不跟随 symlink/junction（链接自身判 foreign）；allow_local_drift 人签降 WARN、drift_allowlist 人签逐路径豁免
- [x] 单测 8 例：本事故 tmp-ocr-audit 形态 FAIL / 金丝雀模式放行+assets 藏脚本 FAIL / sidecar 不算 foreign / **Windows junction 不跟随且自身 foreign（真实 junction fixture）** / 人签豁免 / 降级 WARN / drift+foreign 共存互不吞没 / runtime artifact 不误报（既有用例保留）

## 3. G3 哈希同源 + sidecar 自校验

- [x] G3a `sha256FileEolNormalized`：扩展名黑名单先行（INTEGRITY_BINARY_EXTENSIONS 与 pack 同步）→ NUL → `/\r\n?/g`；**源仓一致性单测**动态 import release-pack-rules.mjs 断言分类/归一逐一等价
- [x] G3b pack 写包内 sidecar `RELEASE-MANIFEST.sha256`（64-hex+LF，不入 files[]）；verify 覆盖公式排除集 {manifest, sidecar} + sidecar 格式/内容断言；`assertInZipManifest` 导出供测试直接驱动（release:verify 主流程 plan 门禁在其之前，源仓 open plan 时走不到）
- [x] `framework_manifest_selfcheck` 独立 check id：匹配 PASS 继续 / 不匹配或 sidecar 为 symlink → BLOCKER（failure_kind framework_manifest_tampered，"勿手工重算"文案）停止 per-file/foreign / **缺失 → BLOCKER 且继续**（初版"旧包 WARN"在第七轮被 codex 击穿并修正——代码随 ≥3.0.0 包同树，缺失只能是被删）
- [x] 单测 8 例：CRLF 重写不误报（本事故 adhoc-input-path 形态）/ 孤立 CR / 真改动仍漂移 / 无 NUL PNG 原始字节 / pack 口径矩阵 / sidecar 匹配继续 / 不匹配停机（组合断言 hygiene 仍在场）/ **缺失 BLOCKER 且 per-file drift BLOCKER 同时可见（缺失分支照跑后续检查供诊断）**
- [x] 真实端到端：packRelease → extract-zip → assertInZipManifest 全链 PASS（603 文件 + sidecar ok）

## 4. G4/G4b 边界与卫生

- [x] consumer-framework-boundary.md："任何文件（含新建 untracked）" + 绝不重算 manifest + 典型错误表扩两行 + **「临时诊断脚本去处（scratch 约定）」新节**
- [x] canonical-gitignore 增 `/scratch/`（pattern+equiv+section）；AGENTS.md.template 红线清单第 9 条 framework 只读（107 行 ≤120 预算，docs phase PASS）
- [x] G4b `runWorkspaceTmpHygieneScan`（独立 id workspace_tmp_hygiene，三条返回路径恒在场）：repo 根+scripts/ 深度≤2 浅扫 tmp-*.{js,mjs,cjs,ts}，git check-ignore 过滤，MAJOR WARN 教育文案
- [x] 单测 4 例：本事故 scripts/tmp-add-ocr.js 形态 WARN / 非 tmp 命名不误报 / framework 内 tmp 归 G2 不重复报 / **foreign+tmp 共存互不吞没**

## 5. G1b cursor hooks_config 结构化 upsert

- [x] `hooks-config-upsert.ts`：ownership key=command 路径；matcher 等受管字段原位更新；同 command 去重保一；LEGACY_OWNED_COMMANDS 迁移位；卸载删 owned/legacy 留第三方与容器（空事件容器清理）；JSON 非法绝不覆盖
- [x] adapter-schema.yaml 新增 hooks_config 字段（明示不参与 hard_hook 判定）；check-init.ts kind 增 structured_upsert（描述符 + 机制 sync 分支 + 巡检特判"upsert(现状) 收敛即同步"）
- [x] cursor adapter.yaml hooks_config 声明（不声明 settings_file/hooks——tier 语义注释齐）；templates/hooks.json（仅自有条目，matcher Write|Delete 初版）；`agents/cursor/hooks/guard-framework-write.mjs` 包内壳（相对 import 共享核心；deny={permission:"deny",user_message,agent_message}+exit 0；候选字段宽容解析）
- [x] 单测 `hooks-config-upsert.unit.test.ts` 10 例：**四件套**（第三方保留/自有升级/幂等/非法不覆盖）+ **三件套**（matcher 原位升级长度不增/两历史条目去重/卸载自有全清第三方留）+ 创建最小结构 + **T1 tier 回归**（cursor===soft_rule_only）+ **S1 cursor 壳真实子进程协议**（deny JSON+exit 0+教育文案经 agent_message/白名单/宽容字段/fail-open）+ S2 模板 command 指向真实壳脚本
- [ ] **宿主实测 payload**（plan 钉死的落地第一步，本机无 Cursor IDE 会话可驱动）：真实宿主里确认 preToolUse 的 Write 工具名与 tool_input 路径字段名，据实测调整 matcher/候选字段（均为受管可变字段，upsert 原位更新）——随 3.0.0 回归件在宿主执行

## 6. 第七轮双 AI review 修复（codex 三 P1 两 P2 全部核实属实；cursor 两 P2 采纳）

- [x] **P1-1 sidecar 保护链绕过**：①写时/扫描谓词拆分——新增 `isWriteAllowedPath`（仅
  ignored_runtime + generated 可写；reserved_metadata_files 是 pack 产出的完整性锚点，写时
  deny），guard 测试 A6 翻转（sidecar/manifest 写入均 exit 2）+ A7 双谓词对照；②sidecar
  缺失从 WARN 升 **BLOCKER FAIL 且继续**（代码随 ≥3.0.0 包同树，缺失只能是被删——真旧包跑
  的是旧代码根本没有本检查；"删 sidecar+重算 manifest"绕过链专项回归钉死）；③consumer
  格式与 release:verify 严格一致（64-hex + 必须末尾 LF，缺 LF 用例）
- [x] **P1-2 schema 不兼容覆盖宿主配置**（codex 两个最小复现均本地复现坐实）：upsert 新增
  `invalid_schema`（hooks 非对象 / 受管 event 非数组 → 不产 nextText 绝不改写；非受管
  event 怪形态不挡道）；sync effect 新增 `blocked`（不再记 unchanged 静默）；check-init
  新增 BLOCKER 检查 `hooks_config_target_compatible`；**init 集成 fixture**
  `init/update_hooks_config_invalid_json_fail`（非仅 helper 单测）
- [x] **P1-3 cursor 壳 cwd 子目录 fail-open**：仓库身份改为只信脚本物理布局（cwd 只作相对
  路径解析上下文）；file:// 经 fileURLToPath 标准转换（Windows 盘符裸删前缀不可靠）；
  补 cwd=子目录 deny + 子目录相对路径 deny 两用例
- [x] **P2-1 manifest 路径被替换成 symlink**：链接**无条件** foreign（不受 manifestPaths
  豁免——同哈希树外链接不得借 manifest 身份放行），专项用例
- [x] **P2-2 卸载 helper 未接线**：spec 措辞修正为"removal 语义由 helper 提供、接线待
  卸载/切换流程存在时"（不造平行流程）；cursor 运维两提示入边界文档（勿删 policy JSON；
  写守卫比 allow_local_drift 总开关更严属有意设计）

## 7. 第八轮双 AI review 修复（codex 两 P1 两 P2 全部核实属实）

- [x] **P1-1 blocked 未传播到 init 执行链**（codex 实测 executed+blocked:1+hasFailed:false
  假宣成功）：executor 的 sync-auto-overwrite 分支 blocked>0 → **throw（任务 failed）**，
  宿主文件仍不被覆盖（双承诺单测钉死）；formatFileEffectsCounts 展示 blocked 计数。
  （初版偏离"未在 preflightExecute 层预校验"已在第九轮补齐——见第 8 节，executor throw
  降级为第二道防线。）
- [x] **P1-2 symlink 非无条件**（codex 实测 reports junction 到树外四检查全 PASS；sidecar
  属白名单可被链接顶替削弱锚点）：scanForeignFiles 改**链接最先判、无条件 foreign**
  （manifest/policy/allowlist 均不豁免）；selfcheck 对 sidecar 自身 lstat 判 symlink →
  tampered BLOCKER。补 policy 目录 junction 与 sidecar 文件 symlink 两用例。诚实代价：
  pnpm 式 node_modules junction 布局会被拦（宁严勿松，spec 明示）。
- [x] **P2-1 framework 自有模板损坏被静默接受**（codex 复现：模板 preToolUse 为对象 →
  created 空壳）：desired 模板完整 schema 硬校验（hooks 为对象、每个声明 event 非空数组、
  每项含合法 command、零 event 拒绝），四负例单测。
- [x] **P2-2 sidecar 语义自相矛盾**：tampered 分支 suggestion 去掉无效的 allowlist 建议
  （该分支停机，配置无从生效——只留"还原/重铺"两条可行路）；proposal.md/tasks.md/plan
  三处残留的"缺失 WARN"旧口径全部对齐 BLOCKER 现语义。

## 8. 第九轮 codex review 修复（P1 一项、P2 一项均核实属实）

- [x] **P1 hooks 兼容性错误未进 S3 preflight → 前置任务部分写盘**（codex 指出 plan 内
  hooks 任务之前的写任务会在执行到 hooks 才 fail 时已落盘，与"零写盘"预检承诺不符；
  第八轮"结果等价"表述不准确——磁盘状态确有差异）：新增只读
  `preflightValidateHooksConfigTargets(projectRoot, ctxLike)`（resolvePrimaryAdapter +
  loadInspectorEnv 后对 structured_upsert 目标 dry-run `computeHooksConfigUpsert`，
  invalid_json/invalid_schema 即报，任何异常 fail-open 返回空），接入
  `preflightExecute`（plan 含 sync/materialize 任务且 projectRoot 可解析时触发；违规归
  到 plan 内对应 sync 任务 id）；executor throw 保留为第二道防线。集成测试：
  "前置写任务 + 非法 .cursor/hooks.json" plan → preflight ok:false、hooks 任务条目携带
  违规原因、**全工程零写盘**（前置 commands 目标不存在、宿主 hooks.json 逐字节原样）。
- [x] **P2 tasks.md 第 3 节残留旧 sidecar WARN 语义**：单测清单"缺失 WARN + drift
  BLOCKER 组合可见"改为现语义"缺失 BLOCKER 且 per-file drift BLOCKER 同时可见"；
  第 7 节 P1-1 的"诚实偏离/结果等价"表述同步更新为"第九轮已补齐 preflight 预校验"。

## 9. 第十轮 codex review 修复（P1 一项核实属实——secondary adapter 绕过全链）

- [x] **P1 secondary adapter 绕过 structured_upsert 整文件覆盖宿主 hooks**（codex 实测
  `["claude","cursor"]` 时 preflight ok:true + materialize-adapter:cursor 把宿主
  hooks.json 完整替换为模板——正是本方案要禁止的行为）。核实同根因共三处，全部修复：
  ① `syncTemplateTarget`（materialize-adapter / materialize-adapter-file 写盘路径）无
  structured_upsert 分支，目标被当普通字节直写——补结构化合并分支（与
  applyInitMechanismSync 同语义：invalid → effect blocked 不写盘；unchanged/created/
  updated 走 upsert 产物），materialize 两分支 blocked → throw（`throwIfBlocked`
  三条写盘路径共用，第八轮 P1-1 防线扩展到 materialize）；
  ② `preflightValidateHooksConfigTargets` 只查 `resolvePrimaryAdapter()`——改为上下文
  adapters + config `materialized_adapters` 并集全量 dry-run（单个 adapter 装载失败
  不影响其余；返回 adapterName 供违规归到 `materialize-adapter:<name>` 任务条目）；
  ③ check-init `hooks_config_target_compatible` 巡检同样只查选定 adapter——补全部
  materialized adapters 的 structured_upsert 目标（去重合并）。
- [x] codex 建议的两组回归 + 巡检 fixture：materialize-adapter:cursor（secondary）
  合法第三方 hooks → 顶层字段/第三方条目保留 + framework 守卫条目合并；非法 hooks
  （codex 复现原始内容 `hooks:"team-owned"`）→ throw 且宿主文件逐字节原样；orchestrate
  侧 primary=claude 时 secondary cursor 非法 hooks → preflight 阻断、违规归到
  materialize-adapter:cursor 条目、全工程零写盘（CLAUDE.md/.claude/.cursor/commands
  均不存在）；init fixture `update_hooks_config_secondary_adapter_fail`（agent_adapter=
  claude + materialized ["claude","cursor"]，非法 .cursor/hooks.json → BLOCKER）。

## 10. 第十一轮 codex review 修复（两 P2 均核实属实；无新 P1）

- [x] **P2-1 executor 第二道防线在批量任务内仍部分写盘**：materialize-adapter 分支原实现
  先循环写完全部 adapter 文件、循环后才 throwIfBlocked——preflight 被绕过/直调
  executeInitTask 时，hooks 之前的 commands/skills/rules 已落盘。修：新增
  `assertStructuredUpsertTargetsMergeable`（批量物化前只读 dry-run 全部 structured_upsert
  目标，blocked 直接 fail）接在 loadInspectorEnv 之后、任何写盘之前；循环后
  throwIfBlocked 保留为终兜底。回归强化：blocked 用例断言整任务零写盘（repo 根仅
  framework.config.json + .cursor；.cursor 下仅 hooks.json）。
- [x] **P2-2 sidecar 旧 WARN 语义两处残留**：framework-integrity.ts 校验顺序注释
  （"缺失（旧包）WARN 且继续"）与 proposal.md 兼容段（"旧发布件缺 sidecar → MINOR
  WARN"）均改为现语义"缺失 → BLOCKER FAIL 且继续（代码随 ≥3.0.0 包同树，缺失只能是
  被删）"——至此第八轮宣称的"三处对齐"真正闭环。

## 11. 第十二轮 codex review 修复（plan 文档一 P1 一 P2 均属实；代码零改动）

- [x] **P1 plan 承重设计段（G3b）仍是废弃语义**：设计正文重写为现语义（不匹配或
  symlink → BLOCKER 停机、只留还原/重铺；缺失 → BLOCKER 且继续；组合单测两 BLOCKER
  同时可见）并标注第三轮初定→第七/八轮修订脉络。
- [x] **P2 plan 历史 review 记录无标记陈述旧规则**：第一轮必补③、第三轮 P1-2 两处
  "缺失 MINOR WARN"加 ⚠️ 已推翻标记（指向第七轮+现语义）；全文复查仅存两处 MINOR
  WARN 均在带标记历史记录内。

## 12. Verify

- [x] `cd harness && npm test` 全绿（**1744 单测 + 44 fixtures**，含第七～十一轮新增
  用例与两个 init 集成 fixture）
- [x] `npx tsc --noEmit` 0 错误；docs phase harness Verdict PASS；`npm run openspec:validate` 全绿
- [x] release:pack dry-run 确认 6 个新文件全部进包；packRelease→extract→assertInZipManifest 真实全链 PASS
- [x] `release:verify` 技术项 PASS（plan 门禁按预期拦 3.0.0 窗口 open plans——发版语义，非本 change 缺陷）

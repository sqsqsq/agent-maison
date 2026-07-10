---
name: 宿主 framework 写保护与完整性加固
version: 3.0.0
# 版本说明：排入 3.0.0 窗口——本批加固正该随回归件带给宿主（回归时顺带实测写保护）；
# release:pack 不受 plan 门禁影响，不阻打包。
overview: >
  【背景（2026-07-09，宿主 SimulatedWalletForHmos cursor 工程 2.4.0 实测事故）】宿主 agent
  做 bc-openCard（UI 重、走 OCR 捕获完整性门禁）时：①往 framework/harness/scripts/ 写了
  tmp-ocr-audit.mjs（introspect 框架内部拿完整未覆盖清单）；②repo 根 scripts/ 写了
  tmp-add-ocr.js（准备把 OCR 乱码批量灌 defer 糊弄门禁，未落盘生效）；③agent 编辑工具以
  CRLF 重写 adhoc-input-path.ts（内容一字未变——sha 数学证实），framework_integrity 裸字节
  sha 报假漂移，agent 为过检重算 RELEASE-MANIFEST.json 迁就 CRLF 文件。
  【根因分层】动机层：2.4.0 缺 OCR 噪声自动处置（E3② writeBlindReviewPending 已在 3.0.0
  修复，宿主升级即消——非本 plan 范围）。机制层（本 plan 范围，3.0.0 现状核实仍在）：
  (a) 无任何写时保护——claude adapter 仅注册 Stop/SubagentStop 两个 hook，adapter.yaml:28
  注释写了 PreToolUse 却从未注册（文档与实现漂移）；(b) framework-integrity 只遍历
  manifest.files[]，不扫树——framework/ 内新增任意文件完全隐形（且有单测把"extra 文件
  → PASS"焊死）；(c) manifest 自身内容不被校验（integrity 循环里 rel===MANIFEST_NAME
  即 continue）——重算 manifest 迁就漂移可静默过检；(d) sha256File 裸字节、CRLF 敏感——
  Windows 下工具重写行尾即假漂移，是本次"好心修 manifest"链的起点；(e) 边界文档
  consumer-framework-boundary.md 措辞"不得修改…已跟踪文件"漏掉新建 untracked 文件，
  AGENTS.md.template 零 framework 只读条款，且无"临时诊断脚本该放哪"的正向约定。
  【与既有资产的关系（cursor review 补）】G2/G3 是对 openspec change
  consumer-framework-integrity-guard（已完成 9/9，交付 framework-integrity capability
  初版）的**增量加固**，改同一个 framework-integrity.ts + 同一个 preflight 入口，不另起
  平行门禁；openspec 增量 change 在 G5 一并记录。
  【诚实边界（拍板前提；codex 第二轮 P1 修正——"cursor 无 hook"前提已过时）】①写时守卫
  覆盖 claude（G1a）与 **cursor（G1b）**——Cursor 1.7+ 已支持 hooks（官方文档 2026-07
  web 核实：preToolUse 可 deny，matcher 含 Write/Delete/Shell，项目级 .cursor/hooks.json）；
  codex CLI 仍无 hook 能力靠查时。**cursor hooks 的如实弱点**：官方默认 fail-open（hook
  崩溃/非 0/2 退出码即放行；failClosed 会在 hook 故障时卡死整个编辑链，不启用），且社区有
  Windows preToolUse 间歇失效报告——G2 恒为兜底，写时守卫在任何 adapter 上都不宣称全覆盖。
  ②G1a/G1b 只拦编辑类工具——经 Bash 重定向 / node -e 写 framework 不在射程（拦 Bash 需
  命令语义解析，误报面大，本 plan 明确不做）。③G2 是查时（下次 harness 跑才发现），
  不是写时拦截。④G3b manifest 自校验防"好心修复"不防恶意协同篡改（改 manifest+sidecar
  两个文件即绕过——与 framework_integrity 既有威胁模型一致，恶意归 gate-integrity 红线域）。
  ⑤本次事故第二条腿 scripts/tmp-add-ocr.js 在 framework **外**（宿主根 scripts/），
  G1/G2 射程外——由 G4b 轻量启发式 WARN 扫描兜（命名式、不判意图、不 BLOCKER，宿主根
  目录是宿主资产），plan 不宣称能硬拦 framework 外的临时脚本。
  【设计要点】
  ▶ G1 写时守卫（G1a claude + G1b cursor，共享判定核心）：路径判定协议抽成共享模块
  （guard-framework-write-core.mjs：consumer 布局判定 + framework/** 归一化匹配 + 运行时
  白名单/人签 allowlist 放行 → deny + 教育文案指向边界文档/scratch 约定/framework-init
  UPDATE），两个 adapter 的 hook 壳各自做 payload 解析后调同一核心。仅 consumer 布局生效
  （framework/RELEASE-MANIFEST.json 存在才拦——agent-maison 源仓开发不受影响）。
  **跨运行时策略 SSOT（第六轮 P1 钉死）**：hook core 是独立 node ESM .mjs（不依赖
  ts-node），framework-integrity/canonical-gitignore 是 CJS TS（tsconfig module:
  commonjs）——TS 常量无法被 .mjs 直接共享，各抄一份必然漂移（G1 放行 G2 却 BLOCKER、
  新 runtime artifact 只更新一边）。钉死：新增中立 JSON SSOT
  `specs/runtime-artifact-policy.json`（{ignored_runtime_patterns,
  generated_file_patterns, reserved_metadata_files}——canary 两模式与
  RELEASE-MANIFEST.sha256 都登记于此），canonical-gitignore.ts 由它派生 framework
  runtime patterns、framework-integrity.ts 与 guard-framework-write-core.mjs 直读同一份；
  **三方一致性单测**禁止任一方自行维护第二份列表。**人签 allowlist 语义跨实现一致**：
  .mjs core 复刻 approvalInvalidReason/isHumanVerified 拒绝语义（legacy 字符串、
  goal-mode-auto 等自动化身份、user_requirement 哨兵、缺 rationale/签名均 deny——否则
  agent 可先写无效 allowlist 绕过写时守卫，到下次 G2 才暴露），配跨实现一致性单测
  （同一 allowlist fixture 矩阵在 TS 与 .mjs 两实现下判定逐一相等）。
  ▶ G1a claude：guard-framework-write.mjs + settings.json 注册 PreToolUse（matcher
  Write|Edit|MultiEdit|NotebookEdit）；hook 铺到宿主走既有 init update hook-drift 机制；
  顺带把 adapter.yaml:28 注释修准确。
  ▶ G1b cursor（codex 第二轮 P1 纳入；物化/deny 协议经第三轮 P1/P2、**第四轮 P1** 钉死）：
  **物化模型——结构化 upsert，不走 verbatim**（第四轮 P1：settings_file 机制是 verbatim
  整文件覆盖（check-init.ts:682 kind:'verbatim'，auto_overwrite 备份后整文件替换），而
  .cursor/hooks.json 是宿主原生共享配置、可能已有团队自己的 hooks——整文件物化会覆盖宿主
  资产，与本 plan 立意冲突）。钉死方案：adapter schema 新增**结构化配置物化类型
  `hooks_config`**（新 kind: structured_upsert，与 verbatim 并列；显式扩 schema +
  check-init 描述符 + sync 执行器 + fixtures——刻意选这个而非"按 target path 特判 merge"
  的隐藏魔法，宁可 scope 大一点也不留路径特例）。upsert 语义：文件不存在 → 创建
  {version:1, hooks:{preToolUse:[…]}}；存在且合法 → 仅向 hooks.preToolUse[] upsert
  framework 自有条目。**ownership key（第五轮 P2 钉死）= 稳定的 command 路径**（matcher/
  timeout/failClosed 都是 framework 管理的可变字段，UPDATE 原位更新——matcher 进 key 会在
  其演进时"找不到旧条目→追加→旧 matcher 永久残留、UPDATE 不幂等、卸载删不净、同一次调用
  跑多个 guard"）；命中多个相同 command → 保留一个并去重；command 路径未来若须变化 →
  维护 legacy_owned_commands 迁移清单；卸载删除全部 owned/legacy command 条目、保留第三方
  条目与容器。**保留全部其他 hooks/顶层字段/未知字段**；JSON 非法或 schema 不兼容 →
  阻断提示，**绝不整文件覆盖**。hooks.json 的 command 直接调
  发布件内脚本 `node framework/agents/cursor/hooks/guard-framework-write.mjs`（不复制
  脚本）。cursor adapter.yaml **不声明 settings_file 也不声明 hooks 字段**（hooks_config
  是新独立字段，resolveEnforcementTier 只读 settings_file+hooks 双字段——tier 恒
  soft_rule_only，**加回归测试钉死**）。共享判定核心放发布件 `agents/shared/`（claude
  物化壳与 cursor 包内壳共同引用）。preToolUse matcher 首选 Write/Delete（**落地第一步在真实宿主实测
  payload**——官方文档未明文 Write 的 tool_input 路径字段名，以实测为准）。**deny 协议
  （第三轮 P2 修正——exit 2 不消费 JSON，教育文案会丢）**：正常阻断 = 输出
  {permission:"deny", user_message, agent_message} + **exit 0**（官方协议 exit 0 才读
  JSON）；exit 2 仅留给"无法产出合法 JSON 却必须阻断"的异常分支；其余解析/运行异常
  fail-open 交 G2 兜底。不启用 failClosed（故障不卡编辑链）。
  ▶ G2 framework-integrity 增补 extra-file 扫描：逐文件 sha 比对后 walk framework/ 树，
  存在于磁盘但不在 manifest.files 的文件 → BLOCKER FAIL（新 failure_kind:
  framework_foreign_file，教育性文案指明"framework 内不承载宿主/临时产物"）。运行时
  白名单唯一来源 = **specs/runtime-artifact-policy.json**（第六轮 P1 的中立 JSON SSOT，
  G1 hook core / framework-integrity / canonical-gitignore 三方共读，见 G1 设计段）：
  ignored_runtime_patterns 承载既有运行时目录（node_modules/dist/reports/trace/state/
  package-lock.json/.gitkeep/**/ohosTest//**/test/dag/，canonical-gitignore 由此派生）；
  generated_file_patterns 承载 vision 金丝雀产物**按文件名模式收窄**（codex 第二轮次要点：
  不放行整个 harness/assets/——否则 agent 可把任意脚本藏进 assets/ 绕过；只放行
  harness/assets/vision-canary-*.png 与 harness/assets/vision-canary-*.answer-key.json
  两模式，与 canaryAssetPaths 产物精确对齐）；reserved_metadata_files 承载根部保留元数据
  RELEASE-MANIFEST.sha256（G3b sidecar——codex P1：它不得入 manifest.files[]，否则
  manifest hash 与 sidecar hash 循环依赖；不白名单则 G2 会把自家 sidecar 当 foreign 拦掉，
  两门禁互相打架）。allow_local_drift 人签 allowlist
  同样可豁免 extra 文件。**walk 安全（第三轮次要点）**：不跟随 symlink/junction——链接
  条目自身即按 foreign 处理（防扫描逃出 framework/ 或目录环；Windows junction 是本机
  真实形态）。更新既有单测：runtime artifact → 仍 PASS（白名单内）；非白名单
  extra 文件 → 新增 BLOCKER FAIL 用例；sidecar 在场 → 不算 foreign；assets/ 下非
  canary 模式文件 → FAIL（收窄生效）；junction/符号链接 → 不跟随且自身判 foreign。
  ▶ G3a sha EOL 归一（治假漂移根因；口径与 pack 侧**完全同源**——codex 第二轮 P1）：
  consumer 侧 sha256File 复用 pack 的文件分类与归一化语义：①扩展名黑名单先行
  （RELEASE_BINARY_EXTENSIONS：png/jpg/pdf/zip 等——即便无 NUL 也按二进制原始字节，防
  "无 NUL 的 PNG 含 0D0A 被 verifier 改字节"口径分裂）→ ②NUL 启发式 → ③文本归一化用
  /\r\n?/g（CRLF **与孤立 CR** 都归 LF，与 normalizeReleaseTextEol 逐字符等价）。实现层：
  consumer 发布件不带 repo 根 scripts/，无法直接 import release-pack-rules.mjs —— TS 侧
  复制语义常量/函数 + **源仓一致性单测**（动态 import release-pack-rules.mjs，对 fixture
  矩阵断言两实现分类与归一结果逐一相等，防未来单边改动漂移）。pack 侧不动、旧 manifest
  全兼容。代价如实：纯行尾篡改不可见——行尾无语义，可接受。新增用例：无 NUL 的已知二进制
  扩展仍按原始字节；文本孤立 CR 与 CRLF 均归一。
  ▶ G3b manifest 自校验（治"重算 manifest 迁就漂移"，与 G2/release:verify 交接钉死）：
  pack 的 dist sidecar 已链式引用包内 manifest 自身 sha256（consumer-framework-integrity-
  guard 交付），G3b 把这条链下发进包——包内新增 framework/RELEASE-MANIFEST.sha256
  （**格式钉死**：一行 64 位小写十六进制 + 末尾一个 LF；内容 = manifest 原始字节 sha256；
  **不入 manifest.files[]**，循环依赖）。**release:verify 覆盖公式同步改**（codex 第二轮
  P1：现有断言是 manifest.files 恰好 == 全部文件 \ {RELEASE-MANIFEST.json}，sidecar 进包
  即炸）：排除集改为 {RELEASE-MANIFEST.json, RELEASE-MANIFEST.sha256}，并新增 sidecar
  断言（格式合法 + 内容等于 manifest 字节 sha）；其余未覆盖文件仍 fail。preflight 校验
  顺序与**结果模型**钉死（第三轮 P1 初定，**缺失分支与不匹配文案在第七/八轮修订为
  现语义**——防实现成"缺 sidecar 即 return"把 drift/foreign 校验整体跳过）：sidecar
  自校验为**独立 check id `framework_manifest_selfcheck`**，与 framework_integrity
  并列返回：①manifest JSON 解析（既有）→ ②selfcheck：sidecar 存在且匹配 → PASS；
  存在但不匹配或 sidecar 为 symlink → BLOCKER FAIL 且**停止后续校验**（manifest 已
  不可信，per-file 比对无意义；文案只留两条可行路"还原 manifest / framework-init
  UPDATE 重铺"——该分支停机，allowlist 配置无从生效，不作建议）；**缺失 → BLOCKER
  FAIL 且继续 ③④**（selfcheck 代码随 ≥3.0.0 包同树，缺失只能是被删——真旧包跑的是
  旧代码根本没有本检查；继续跑供诊断，"删 sidecar+重算 manifest"绕过链由此斩断）→
  ③per-file sha 比对（既有，G3a 归一后）→ ④G2 extra-file 扫描（sidecar 已白名单）；
  workspace_tmp_hygiene（G4b）始终独立执行。**组合单测**：缺 sidecar + 某文件漂移
  → 结果同时含 selfcheck BLOCKER 与 integrity BLOCKER（缺失分支照跑后续检查，
  两 BLOCKER 同时可见）。
  ▶ G4 边界文档 + scratch 约定：consumer-framework-boundary.md "已跟踪文件"改"任何
  文件（含新建临时脚本，untracked 同禁）"，补"临时诊断脚本去处"节（<repo-root>/scratch/
  或系统临时目录；canonical-gitignore 增 /scratch/）；AGENTS.md.template 红线清单补一行
  "framework/ 只读（升级唯一途径 framework-init UPDATE）；临时脚本放 scratch/"——
  注意 ≤120 行预算与 entry_template_budget 骨架标记。
  ▶ G4b framework 外临时脚本启发式扫描（cursor 必补点 / codex P2——本事故第二条腿
  scripts/tmp-add-ocr.js 的硬检测缺口）：framework-integrity preflight 附带**浅层**
  workspace 卫生扫描——仅 repo 根与 <repo-root>/scripts/（深度≤2，控成本），命中
  tmp-*.{js,mjs,cjs,ts} 模式且不在 scratch/ 或 gitignored → **MAJOR WARN**（教育文案指向
  scratch 约定）。**独立 check id `workspace_tmp_hygiene`**（codex 第二轮次要点），与
  `framework_integrity` 并列返回、互不吞没——共存单测：framework 内 foreign 文件与宿主根
  tmp 脚本同时在场时，两条结果都可见。诚实定位：命名启发式、不判脚本意图、不 BLOCKER
  （宿主根目录是宿主资产，硬拦会越权误伤）；目标是"git status 之外多一道显式提醒"，
  不是硬防线。
  【宿主现场清理（操作项，非 todo；cursor 提醒：先清理再升级——否则升级到带 G2 的版本后
  首跑 harness 即对 tmp-ocr-audit.mjs BLOCKER，属期望行为但影响回归首跑体验）】
  rm scripts/tmp-add-ocr.js framework/harness/scripts/tmp-ocr-audit.mjs；git checkout
  framework/RELEASE-MANIFEST.json framework/harness/scripts/utils/adhoc-input-path.ts；
  随后升级 framework 至 3.0.0 回归件（E3② 消 OCR 噪声动机）。
todos:
  - id: g1a-claude-pretooluse-guard
    content: >
      G1a claude PreToolUse 写时守卫 + 共享判定核心：guard-framework-write-core.mjs
      （consumer 布局判定 + framework/** 归一化匹配 + 白名单/人签 allowlist 放行 →
      deny + 教育文案，供 G1a/G1b 两壳共用）。**跨运行时 SSOT（第六轮 P1）**：新增
      specs/runtime-artifact-policy.json（ignored_runtime_patterns /
      generated_file_patterns / reserved_metadata_files），core（node ESM 直读 JSON）、
      framework-integrity.ts、canonical-gitignore.ts 三方共读，三方一致性单测禁第二份
      列表；**人签 allowlist 语义复刻** approvalInvalidReason/isHumanVerified 于 .mjs
      core，跨实现一致性单测（同 fixture 矩阵 TS/.mjs 判定逐一相等）。claude 壳
      guard-framework-write.mjs + settings.json 注册 PreToolUse matcher
      Write|Edit|MultiEdit|NotebookEdit；adapter.yaml:28 注释修准确。**射程如实**：只拦
      编辑类工具，Bash 重定向/node -e 不在射程——hook 文案与文档均不得宣称"写时全覆盖"。
      单测（沿 hook-stale-state 子进程模式）：拦 framework/harness/scripts/tmp.js、放行
      framework/harness/reports/x、放行非 framework 路径、源仓布局（无 manifest）放行、
      合法结构化真人审批放行 + **五负例**（legacy 字符串 deny / goal-mode-auto deny /
      user_requirement deny / 缺 rationale deny / 缺签名 deny——第六轮 P1：防先写无效
      allowlist 绕过写守卫）。
    status: completed
  - id: g1b-cursor-pretooluse-guard
    content: >
      G1b cursor preToolUse 写时守卫（第三轮 P1/P2 + 第四轮 P1 钉死）：**物化 =
      结构化 upsert**——adapter schema 新增 hooks_config 字段（kind: structured_upsert，
      显式扩 schema + check-init 描述符 + sync 执行器 + fixtures，拒绝按 target path
      特判的隐藏魔法）；.cursor/hooks.json 是宿主共享资产：不存在 → 创建
      {version:1,hooks:{preToolUse:[…]}}；存在合法 → 仅 upsert framework 自有条目
      （**ownership key=稳定 command 路径**，matcher/timeout 为受管可变字段原位更新；
      同 command 多条去重保一；command 变更走 legacy_owned_commands 迁移清单；卸载删
      全部 owned/legacy、保留第三方与容器——第五轮 P2）、保留其他 hooks/顶层/未知字段；
      JSON 非法 → 阻断提示绝不整文件覆盖。command 直接调发布件内
      `node framework/agents/cursor/hooks/guard-framework-write.mjs`（不复制脚本）；
      不声明 settings_file/hooks 字段，**回归测试钉死** resolveEnforcementTier(cursor)
      ==='soft_rule_only'。**落地第一步在真实宿主实测 payload**（官方文档未明文 Write 的
      tool_input 路径字段名；工具名首选 Write/Delete，以实测为准）。**deny 协议**：
      正常阻断 = {permission:"deny", user_message, agent_message} + exit 0（exit 2 不
      消费 JSON、教育文案会丢）；exit 2 仅留"无法产出合法 JSON 却须阻断"异常分支；其余
      异常 fail-open 交 G2。不启用 failClosed。诚实边界入文档：fail-open + Windows
      间歇失效社区报告 → G2 恒为兜底。单测：**第三方 hooks 保留 / 自有条目升级 / 重复
      执行不重复 / 非法 JSON 不覆盖**（第四轮 P1 四件套）+ **旧 matcher→新 matcher 原位
      升级数组长度不增 / 两个历史自有条目 UPDATE 后去重为一 / matcher 或 command 版本
      变化后卸载：自有全清、第三方保留**（第五轮 P2 三件套）+ payload 解析（实测样本
      回放）+ enforcement tier 回归 + 共享核心判定复用。
    status: pending
  - id: g2-integrity-extra-file-scan
    content: >
      G2 framework-integrity extra-file 扫描（既有 framework-integrity capability 的
      增量，不另起门禁）：runFrameworkIntegrityPreflight 增 walk framework/ 树，磁盘存在
      但不在 manifest.files → BLOCKER FAIL（failure_kind: framework_foreign_file）；
      白名单唯一来源 = specs/runtime-artifact-policy.json（第六轮 P1 三方 SSOT，勿在
      TS 侧另建常量）：既有运行时目录（canonical-gitignore 由此派生）+ 金丝雀产物按模式
      收窄（仅 harness/assets/vision-canary-*.png 与 vision-canary-*.answer-key.json，
      不放行整个 assets/——防藏任意脚本绕过）+ 根部保留元数据 RELEASE-MANIFEST.sha256
      （codex P1：sidecar 不入 files[] 防循环依赖，必须白名单否则被自家扫描当 foreign）；
      allow_local_drift 人签 allowlist 可豁免；
      **walk 不跟随 symlink/junction，链接自身判 foreign**（第三轮次要点，防逃出
      framework/ 或目录环）。更新 framework-integrity.unit.test：runtime artifact 仍
      PASS、非白名单 extra 文件 BLOCKER FAIL、sidecar 在场不算 foreign、assets/ 下非
      canary 模式文件 FAIL、junction/符号链接不跟随且自身判 foreign、**三方一致性断言**
      （runtime-artifact-policy.json ↔ canonical-gitignore 派生 ↔ hook core 读取，禁止
      任一方second list——与 G1a 的一致性单测同一夹具）。
    status: completed
  - id: g3-sha-eol-manifest-selfcheck
    content: >
      G3a consumer 侧 sha 口径与 pack **完全同源**（codex 第二轮 P1）：扩展名黑名单
      （RELEASE_BINARY_EXTENSIONS）先行 → NUL 启发式 → 文本 /\r\n?/g 归一（含孤立 CR）；
      consumer 无法 import release-pack-rules.mjs（发布件不带 scripts/）→ TS 复制语义 +
      源仓一致性单测（动态 import 对照 fixture 矩阵断言等价）。G3b pack 新增包内 sidecar
      framework/RELEASE-MANIFEST.sha256（一行 64 位小写 hex + 末尾 LF；= manifest 原始
      字节 sha256；不入 files[]）；**release:verify 覆盖公式同步改**（排除集
      {RELEASE-MANIFEST.json, RELEASE-MANIFEST.sha256} + sidecar 格式/内容断言，其余未
      覆盖仍 fail——codex 第二轮 P1：不改则 sidecar 进包即炸 verify）；preflight 结果
      模型（第三轮 P1 初定，**第七轮 codex 实测击穿后修正**）：sidecar 自校验为**独立
      check id framework_manifest_selfcheck** 并列返回——存在且匹配 PASS / 不匹配或为
      symlink → BLOCKER FAIL 停止后续 / **缺失 → BLOCKER 且继续 per-file + G2**
      （初定"旧包 WARN"不成立：selfcheck 代码随 ≥3.0.0 包同树，缺失只能是被删——
      "删 sidecar+重算 manifest"绕过链由此堵死；真旧包跑旧代码无此检查）；
      workspace_tmp_hygiene 恒独立。单测：CRLF 文件归一后不误报、**无 NUL 已知二进制
      扩展仍原始字节**、**孤立 CR 归一**、两实现一致性矩阵、manifest 被改 → BLOCKER 且
      停后续、sidecar 缺失 → BLOCKER 且 per-file/G2 照跑（组合可见）、绕过链三步回归；
      release:verify/pack 回归（sidecar 进包 + 覆盖公式断言）。
    status: completed
  - id: g4-boundary-docs-scratch
    content: >
      G4 边界文档与 scratch 约定：consumer-framework-boundary.md "已跟踪文件"→"任何文件
      （含新建，untracked 同禁）" + 新增"临时诊断脚本去处"节（scratch/ 或系统临时目录）；
      canonical-gitignore 增 /scratch/（含单测）；AGENTS.md.template 红线清单补 framework
      只读 + scratch 一行（守住 ≤120 行与骨架标记，entry_template_budget 复验）。
    status: completed
  - id: g4b-workspace-tmp-scan
    content: >
      G4b framework 外临时脚本启发式扫描（codex P2 / cursor 必补——本事故第二条腿
      scripts/tmp-add-ocr.js 的检测缺口）：framework-integrity preflight 附带浅层扫描
      （仅 repo 根 + scripts/，深度≤2），命中 tmp-*.{js,mjs,cjs,ts} 且不在 scratch/ 或
      gitignored → MAJOR WARN + 教育文案指向 scratch 约定；**独立 check id
      workspace_tmp_hygiene**，与 framework_integrity 并列返回互不吞没。诚实定位：命名
      启发式、不判意图、不 BLOCKER（宿主根是宿主资产）。单测：命中 WARN、scratch/ 内
      放行、gitignored 放行、framework 内 tmp 归 G2 不重复报、**共存用例**（framework
      foreign 文件 + 宿主根 tmp 脚本同时在场 → 两条 check 结果都可见）。
    status: completed
  - id: g5-gates-regression
    content: >
      G5 门禁与回归：typecheck + 全量 unit + fixtures + openspec:validate + docs phase
      全绿；npm run release:pack + release:verify 技术项回归（确认 sidecar 进包、LF 契约
      不回归）；openspec 增量 change 记录 framework-integrity capability 扩展（foreign-file
      扫描 + sidecar 自校验 + EOL 归一 + workspace 卫生 WARN），validate 全绿；plan 实施
      记录回填（含宿主清理指引执行结果，若用户已清理）。
    status: completed
isProject: false
---

# 实施记录

## 2026-07-10 · G1a–G5 全量实现（六轮双 AI review 后开工）

**验收**：`npx tsc --noEmit` 0 错误；`cd harness && npm test` 全绿（**1731 单测 + 42
fixtures**，较开工前 1693 净增 38）；`npm run openspec:validate` **32/32**（新增 change
consumer-write-guard）；docs phase harness Verdict PASS；release:pack dry-run 确认 6 个
新文件全部进包；**packRelease → extract-zip → assertInZipManifest 真实全链 PASS**（603
文件 + sidecar ok）；release:verify 技术项 PASS（plan 门禁按预期拦 3.0.0 窗口 open
plans——发版语义非缺陷）。openspec change：[consumer-write-guard](../../openspec/changes/consumer-write-guard/tasks.md)
（framework-integrity capability 增量，实现细节逐项见其 tasks.md）。

### 交付摘要（对照六轮 review 钉死项，全部落地）

- **SSOT**：specs/runtime-artifact-policy.json 三段；canonical-gitignore 派生（GITKEEP_DIRS
  展开保持逐字节一致，既有 12 例测试零改动过）+ framework-integrity + hook core 三方共读；
  三方一致性单测 + TS↔mjs allowlist 判定矩阵等价断言。
- **G1a**：共享核心 agents/shared/guard-framework-write-core.mjs（零依赖 ESM）+ claude
  PreToolUse 壳/注册；真实子进程测试拦下本事故第一条腿（tmp-ocr-audit.mjs 形态）+
  五负例 allowlist（防先写无效 allowlist 绕过写守卫）。
- **G2**：scanForeignFiles（不跟随 symlink/junction，链接自身 foreign——真实 Windows
  junction fixture 验证）；金丝雀按两文件名模式收窄；drift 与 foreign 独立 id 互不吞没。
- **G3a**：sha 口径与 pack 完全同源（扩展名黑名单先行→NUL→/\r\n?/g）；本事故根因 d
  （CRLF 假漂移）专项用例 + 无 NUL PNG 原始字节 + 孤立 CR + 动态 import 一致性矩阵。
- **G3b**：包内 sidecar（64-hex+LF，不入 files[]）；verify 覆盖公式双排除 + 格式/内容
  断言；framework_manifest_selfcheck 三态（不匹配 BLOCKER 停机文案"勿手工重算"/缺失
  WARN 且旧包保护不降级——组合用例钉死）；assertInZipManifest 导出供测试直接驱动。
- **G4/G4b**：边界文档"任何文件（含 untracked）"+ scratch 约定新节 + 典型错误表扩两行；
  gitignore /scratch/；AGENTS 模板红线第 9 条（107 行 ≤120）；workspace_tmp_hygiene
  独立 id 浅扫（本事故第二条腿 scripts/tmp-add-ocr.js 形态专项用例 + 共存互不吞没）。
- **G1b**：hooks_config schema 字段（structured_upsert kind：check-init 描述符/机制
  sync 分支/巡检"upsert 收敛即同步"特判）；hooks-config-upsert.ts（ownership key=command、
  受管字段原位更新、去重、LEGACY_OWNED_COMMANDS、卸载留第三方清空容器、非法 JSON 绝不
  覆盖）；cursor adapter.yaml/templates/hooks.json/包内壳（相对 import 共享核心，deny=
  JSON+exit 0 教育文案经 agent_message）；tier 回归钉死 soft_rule_only；四件套+三件套+
  协议子进程测试共 10 例。

### 偏离与诚实标注

- **g1b 保持 pending**：plan 钉死"落地第一步在真实宿主实测 payload"——本机无 Cursor IDE
  会话可驱动，机器件（upsert/壳/schema/测试）已全部完成，payload 字段与 matcher 的实测
  确认随 3.0.0 回归件在宿主执行（壳已按候选字段宽容解析 + matcher 为受管可变字段，实测
  后原位更新即可，不需返工机器件）。
- **卸载 helper 未接线**：computeHooksConfigRemoval 已实现+测试，但当前 init 无 adapter
  卸载/切换流程可挂——接线点留待该流程存在时（不造平行流程）。
- **宿主现场清理**（rm 两个 tmp 脚本 + git checkout manifest/adhoc-input-path）属用户
  宿主侧操作，本仓无从代执行——升级回归件前先清理（否则 G2 首跑即 BLOCKER，属期望行为）。

## 2026-07-10 · 第七轮双 AI review（实现后复审）——codex 三 P1 两 P2 全部核实属实并修复

cursor 判可收口（四条腿硬覆盖逐项核过）；codex 深挖出三个实现级 P1，**逐条本地复现/核实
全部成立**，与两条 P2、cursor 两条运维提示一并修复（**1736 单测 + 43 fixtures 全绿**，
openspec 32/32；详单见 consumer-write-guard tasks.md 第 6 节）：

- **P1-1（sidecar 保护链可绕过——本轮最重）**：①我把 reserved_metadata_files 混进了写时
  放行谓词（sidecar 可被 agent 手写伪造）——拆分 isWriteAllowedPath（写时拒 sidecar/
  manifest）与 isPolicyAllowedPath（扫描认其合法存在），A6 测试翻转；②"缺失=旧包 WARN"
  设计被 codex 实测击穿（删 sidecar + 重算 manifest → 全绿）且其"代码随包同树"论证成立：
  selfcheck 代码只存在于 ≥3.0.0 包，consumer 缺 sidecar 必是被删——升为 BLOCKER FAIL 且
  继续（绕过链三步专项回归钉死）；③consumer 格式与 verify 严格对齐（必须末尾 LF）。
- **P1-2（schema 不兼容静默吞宿主配置）**：codex 两个最小复现（hooks:"team-owned" /
  preToolUse 为对象）本地复现坐实——原实现静默替换为 framework 条目。新增 invalid_schema
  （不产 nextText）；sync effect 增 blocked（不再记 unchanged）；check-init 新增 BLOCKER
  hooks_config_target_compatible；补 init 集成 fixture（非仅 helper 单测）。
- **P1-3（cursor 壳 cwd 子目录 fail-open）**：payload.cwd 当仓库身份 → cwd=子目录时
  <cwd>/framework 查无 manifest 即放行。改为仓库身份只信脚本物理布局，cwd 仅作相对路径
  解析上下文；file:// 改 fileURLToPath（Windows 盘符裸删前缀不可靠）；补两用例。
- **P2**：symlink 无条件 foreign（manifest 身份不豁免——同哈希树外链接场景专项用例）；
  卸载 helper 的 spec 措辞修正为"语义已提供、接线待卸载流程存在"（不造平行流程）。
- **cursor 运维提示**：勿删 runtime-artifact-policy.json（缺失=宁严勿松刷 BLOCKER 属预期）
  与"写守卫比 allow_local_drift 总开关更严属有意设计"两条入边界文档。

**G1b 宿主 payload 实测仍 pending**（唯一未闭环项，随 3.0.0 回归件在宿主执行）。

## 2026-07-10 · 第八轮双 AI review（codex 两 P1 两 P2，全部核实属实并修复）

codex 继续实测深挖，四条全坐实（**1740 单测 + 43 fixtures 全绿**，openspec 32/32；
详单见 consumer-write-guard tasks.md 第 7 节）：

- **P1-1（blocked 未传播，init 假宣成功）**：codex 实测 `executed + blocked:1 +
  hasFailed:false`——我第七轮只加了 check-init 巡检 BLOCKER 与 effect，漏了真正的执行链
  （init-orchestrate → executor）。修：executor blocked>0 → throw（任务 failed、run
  hasFailed、exit 非零；宿主文件仍不被覆盖——双承诺单测）；效果计数展示 blocked。诚实
  偏离：preflight 层未预校验（无单一 adapter 上下文），阻断由执行步 fail-fast 承担，任何
  写盘前任务即 failed，结果等价。
- **P1-2（symlink 非无条件）**：我第七轮把链接判定放在 allowed 之后——codex 实测把
  harness/reports junction 到树外四检查全 PASS，且 sidecar 属白名单可被 file symlink
  顶替（锚点失效）。修：链接**最先判、无条件 foreign**（manifest/policy/allowlist 均不
  豁免）+ selfcheck 对 sidecar lstat 判链接即 tampered。补两用例。诚实代价：pnpm 式
  node_modules junction 会被拦（宁严勿松，spec 明示）。
- **P2-1（自有模板损坏静默接受）**：模板 preToolUse 写成对象会滑成"零自有条目"created
  空壳。修：desired 模板完整 schema 硬校验（对象/非空数组/含 command/零 event 拒绝）。
- **P2-2（sidecar 语义自相矛盾）**：tampered 停机分支的 suggestion 还在建议配置
  allowlist（该分支停机、配置无从生效）——只留可行两条路；proposal/tasks/plan 三处
  "缺失 WARN"旧口径残留全部对齐 BLOCKER 现语义。

**G1b 宿主 payload 实测仍 pending**（唯一未闭环项——codex 与我们一致：宿主实测完成前
不认定 G1b 可发布；随 3.0.0 回归件执行）。

## 2026-07-10 · 第九轮 codex review（一 P1 一 P2，核实属实并修复）

- **P1（hooks 兼容性错误未进 S3 preflight → 前置任务部分写盘）**：codex 指出第八轮
  "阻断由执行步 fail-fast 承担、结果等价"不准确——plan 内 hooks 任务之前的写任务
  （如 sync commands/rules）在执行到 hooks 才 throw 时**已经落盘**，磁盘状态与"预检
  阻断、零写盘"承诺确有差异。核实属实（executor 顺序执行，throw 只保护 hooks 目标
  自身及其后任务）。修：新增只读 `preflightValidateHooksConfigTargets`（executor 导出；
  resolvePrimaryAdapter + loadInspectorEnv 后对 structured_upsert 目标 dry-run
  computeHooksConfigUpsert，invalid_json/invalid_schema 即报；任何异常 fail-open 返回空，
  不新增 preflight 误伤面），接入 preflightExecute（plan 含 sync/materialize 任务且
  projectRoot 可解析时触发；违规归到 plan 内对应 sync 任务 id，blocked log 原生可见）；
  executor throw 降级为第二道防线。集成测试钉死："前置写任务 + 非法 .cursor/hooks.json"
  → preflight ok:false + hooks 条目携带违规原因 + **全工程零写盘**（前置任务目标不存在、
  宿主 hooks.json 逐字节原样）。
- **P2（tasks.md 第 3 节残留旧 sidecar WARN 语义）**：第八轮 P2-2 清扫漏了 tasks 第 3 节
  单测清单一行（"缺失 WARN + drift BLOCKER 组合可见"）。修：对齐现语义"缺失 BLOCKER 且
  per-file drift BLOCKER 同时可见"；第 7 节 P1-1"诚实偏离/结果等价"表述同步改为
  "第九轮已补齐 preflight 预校验"。
- codex 同轮确认：第八轮 P1-2/P2-1/P2-2 三项修复有效；G1b 宿主 payload 实测仍是唯一
  共识 pending 项。

**1741 单测 + 43 fixtures 全绿**，openspec 32/32；详单见 consumer-write-guard tasks.md
第 8 节。

## 2026-07-10 · 第十轮 codex review（一 P1，核实属实并修复——secondary adapter 绕过全链）

codex 实测 `materialized_adapters: ["claude","cursor"]` 时：preflight ok:true、
materialize-adapter:cursor 把宿主 `.cursor/hooks.json`（含第三方 team_meta/hooks 条目）
完整替换为 framework 模板——正是本方案要禁止的整文件覆盖。核实属实，且同根因共**三处**
（codex 点了前两处，第三处巡检口径为自查补齐）：

- **写盘路径**：`syncTemplateTarget`（materialize-adapter / materialize-adapter-file 共用）
  没有 structured_upsert 分支，hooks.json 走了"普通字节直写"的 else 兜底。修：补结构化
  合并分支（与 applyInitMechanismSync 逐语义一致：invalid_json/invalid_schema → effect
  blocked 绝不写盘；unchanged / created / updated 写 upsert 产物）；materialize 两分支
  blocked → throw（抽 `throwIfBlocked` 与 sync-auto-overwrite 三路共用——第八轮 P1-1
  防线扩展到 materialize 路径）。
- **preflight**：`preflightValidateHooksConfigTargets` 只查 `resolvePrimaryAdapter()`，
  `["claude","cursor"]` 时 primary=claude 而 cursor 目标从未校验。修：取上下文 adapters
  + config `materialized_adapters` **并集**全量 dry-run（单个 adapter 装载失败不影响其余，
  宽容口径不变）；返回 adapterName，orchestrate 把违规归到
  `materialize-adapter:<name>` / `materialize-adapter-file:<target>` /
  `sync-auto-overwrite:<target>` 对应任务条目。
- **check-init 巡检**：`hooks_config_target_compatible` 同样只查选定 adapter。修：补全部
  materialized adapters 的 structured_upsert 目标（按 targetRel 去重合并进同一检查）。

回归（codex 建议两组 + 巡检 fixture）：secondary cursor 合法第三方 hooks → 顶层字段与
第三方条目保留 + 守卫条目合并；codex 复现原始内容（hooks:"team-owned"）→ throw 且宿主
文件逐字节原样；orchestrate 侧 primary=claude 时 secondary 非法 hooks → preflight 阻断、
违规归到 materialize-adapter:cursor、全工程零写盘；init fixture
`update_hooks_config_secondary_adapter_fail`（BLOCKER）。

**1744 单测 + 44 fixtures 全绿**，openspec 32/32，spec 需求补"每条写盘路径都须尊重
structured upsert + 校验覆盖全部 materialized adapters"及对应 Scenario。
G1b 宿主 payload 实测仍是唯一 pending 项。

## 2026-07-10 · 第十一轮 codex review（两 P2，核实属实并修复；无新 P1，主链路确认已闭）

- **P2-1（executor 第二道防线批量任务内部分写盘）**：materialize-adapter 分支先写完
  全部文件才 throwIfBlocked——正常 CLI 有 preflight 拦在前面，但绕过 preflight 直调
  executeInitTask 时 hooks 之前的 commands/skills/rules 已落盘。修：新增
  `assertStructuredUpsertTargetsMergeable` 在批量物化前只读 dry-run 全部
  structured_upsert 目标，blocked 直接 fail（任何写盘之前）；循环后 throwIfBlocked
  留作终兜底。blocked 回归用例强化为整任务零写盘断言（根目录/.cursor 目录白名单比对）。
- **P2-2（sidecar 旧 WARN 语义又揪出两处残留）**：framework-integrity.ts:432 校验顺序
  注释 + proposal.md:32 兼容段——第八轮说"三处对齐"时清扫不彻底（当时只清了 proposal
  另一处/tasks/plan）。两处均改为"缺失 → BLOCKER FAIL 且继续"现语义。教训：口径变更
  要全文 grep 旧关键词（"WARN"+"sidecar"）而非只改记得的位置。
- codex 同轮确认：第十轮 secondary adapter 主链路修复有效，无新 P1；真实 Cursor
  payload 实测仍是发布前唯一未完成项。

**1744 单测 + 44 fixtures 全绿**，openspec 32/32；详单见 consumer-write-guard tasks.md
第 10 节。

## 2026-07-10 · 第十二轮 codex review（plan 文档一 P1 一 P2，均属实并修复；代码零改动）

- **P1（plan 承重设计段仍是废弃语义）**：G3b 设计正文（第三轮定稿后未随第七/八轮修订
  回写）仍写"不匹配走 allow_local_drift / 缺失（旧包）→ MINOR WARN / 组合单测 WARN+
  BLOCKER"。修：设计段重写为现语义（不匹配或 symlink → BLOCKER 停机、只留还原/重铺
  两条路；缺失 → BLOCKER 且继续；组合单测两 BLOCKER 同时可见），并标注"第三轮初定、
  第七/八轮修订"演进脉络。教训补全：第十一轮只 grep 了代码+openspec，plan 设计正文
  没在射程内——**口径变更的回写范围必须含 plan 设计段本身**，不只实现记录。
- **P2（历史 review 记录无标记陈述旧规则）**：第一轮 cursor 必补③与第三轮 P1-2 两处
  "缺失 MINOR WARN"历史结论，按 codex 建议保留原文但加 ⚠️ 推翻标记（指向第七轮 +
  现语义），全文检索不再出现无标记的冲突答案。
- 全文复查：仅存的两处 "MINOR WARN" 均在带 ⚠️ 标记的历史记录内；allow_local_drift
  其余三处均为 G2 foreign/边界文档语境，口径正确。

## 事故取证摘要（2026-07-09，全部实测非推断）

| 取证点 | 结果 |
|---|---|
| `adhoc-input-path.ts` 内容变了吗 | 没有。HEAD（LF）sha256=abc17ed1…=manifest 旧值；工作区（CRLF）sha256=3ddf4e74…=manifest 新值——纯行尾差异，manifest 被重算迁就 |
| 全仓 CRLF 面 | `.gitattributes` 强制 LF；framework/ 下 543 个文本文件仅 2 个 CRLF（**含 untracked**——tracked 仅 adhoc-input-path.ts 1 个 + untracked tmp-ocr-audit.mjs 1 个），恰为 agent 碰过的两个 |
| tmp-add-ocr.js 的乱码批量 defer | 未落盘生效（ref-elements.yaml 无改动、乱码文本 0 命中）——脚本备好未跑成 |
| 宿主 adapter | cursor——事故发生时 framework 的 cursor adapter **未物化任何 hook**（且 plan 初稿"cursor 无 hook 能力"认知已过时：Cursor 1.7+ 支持 preToolUse deny，本 plan G1b 补齐）；查时防线 G2/G3 对 cursor 恒为兜底 |
| 2.4.0 vs 3.0.0 动机层 | 2.4.0 grep writeBlindReviewPending=0；3.0.0 E3② 已自动登记 OCR 噪声待人终审——升级即消"批量 defer 糊弄"动机 |
| framework-integrity 盲区 | 只遍历 manifest.files[]（:151），extra 文件隐形且有单测焊死"extra→PASS"；manifest 自身 :153 continue 跳过不校验 |
| 写时保护现状 | claude settings.json 仅 Stop/SubagentStop；PreToolUse 全仓零注册（adapter.yaml:28 注释与实现漂移）|

## 双 AI review 修订记录（2026-07-09，实施前）

cursor + codex 各自独立复算了宿主取证（结论与本 plan 事故摘要一致，含 sha 链、tmp 脚本未生效、
2.4.0/3.0.0 差异），plan 评审均为"方向对、可实施"，各留必补点，逐条核实后全部修入：

- **codex P1（G3b sidecar 与 G2 打架，真实设计矛盾）**：sidecar 不能入 manifest.files[]
  （manifest hash ↔ sidecar hash 循环依赖），但不入 files[] 又会被 G2 extra 扫描当 foreign
  拦掉。修：G2 白名单显式加根部保留元数据 RELEASE-MANIFEST.sha256，配单测（sidecar 在场
  不算 foreign / sidecar 不符才 BLOCKER）。
- **codex P2 / cursor 必补①（scripts/tmp-add-ocr.js 在 G1/G2 射程外）**：本事故第二条腿
  在宿主根 scripts/，原 plan 只有 G4 文档软约束。修：新增 **G4b** 浅层启发式扫描（repo 根
  + scripts/，tmp-* 命名模式 → MAJOR WARN，不 BLOCKER——宿主根是宿主资产，硬拦越权）；
  诚实边界⑤明示这不是硬防线。
- **cursor 必补②（G1 不拦 Bash 写文件）**：hard_hook 档下经 Bash 重定向/node -e 写
  framework 仍可绕。修：诚实边界②明示"首版只拦编辑类工具，不宣称 claude 写时全覆盖"，
  G1 todo 同步。
- **cursor 必补③（G3b 细节钉死）**：sidecar 文件名（framework/RELEASE-MANIFEST.sha256）、
  不入 files[]、旧包缺失 → MINOR WARN（⚠️ 该口径已在第七轮被推翻——现语义：缺失 →
  BLOCKER 且继续）、校验顺序（manifest 解析 → sidecar 自校验 →
  per-file sha → extra 扫描）全部写入设计与 todo。
- **cursor 必补④（与既有 openspec change 的关系）**：G2/G3 是
  consumer-framework-integrity-guard（已完成 9/9）所交付 framework-integrity capability
  的增量加固，不另起平行门禁；openspec 增量 change 记录挪进 G5。
- **cursor 次要**：取证表 CRLF 计数注明"含 untracked"；宿主清理顺序提醒（先清理再升级，
  否则 G2 首跑即 BLOCKER——期望行为但影响回归体验）写入清理段；harness/assets/ 与
  sidecar 两条"gitignore 之外另加"白名单在 G2 标注勿误删。

**第二轮（2026-07-09）**：cursor 确认可开工（仅留 scratch//gitignored 文案笔误，已改）；
codex 提三条 P1 + 两条次要，**逐条核实全部属实**，已修入：

- **codex P1-1（"cursor 无 hook"前提过时——最重）**：web 核实官方文档（cursor.com/docs/
  hooks）：Cursor 1.7+ 支持 hooks，preToolUse 可 deny（JSON {permission:"deny"} / exit 2），
  matcher 含 Write/Delete/Shell，项目级 .cursor/hooks.json。原 plan 把事故真实宿主排除在
  写时保护外的前提不成立。修：G1 拆 **G1a（claude）+ G1b（cursor）**，共享判定核心、各自
  payload 壳；G1b 落地第一步是宿主实测 payload（官方未明文 Write 的路径字段名）；如实
  弱点入诚实边界①：官方默认 fail-open（不启 failClosed——故障不卡编辑链，退 G2 兜底）+
  Windows 间歇失效社区报告；cursor adapter.yaml 扩展须评估 resolveEnforcementTier 影响
  （不翻转 tier）。
- **codex P1-2（sidecar 会炸 release:verify 覆盖断言）**：核实 verify-release-pack.mjs:224
  确为"manifest.files 恰好 == 全部文件 \ {RELEASE-MANIFEST.json}"——sidecar 进包即报
  missing coverage。修：G3b 钉死排除集改 {RELEASE-MANIFEST.json, RELEASE-MANIFEST.sha256}
  + sidecar 格式断言（一行 64 位小写 hex + 末尾 LF + 内容=manifest 字节 sha）。
- **codex P1-3（G3a 文本判定与 pack 口径分裂）**：核实 release-pack-rules.mjs——扩展名
  黑名单（RELEASE_BINARY_EXTENSIONS）**先于** NUL 启发式，归一化是 /\r\n?/g（含孤立 CR）。
  原 plan"无 NUL 即文本 + 仅 CRLF"会在"无 NUL 的 PNG"与孤立 CR 上口径分裂。修：G3a 改
  "与 pack 完全同源"（TS 复制语义 + 源仓一致性单测动态 import 对照），补两用例。
- **codex 次要①**：harness/assets/ 白名单收窄为 vision-canary-*.png/-*.answer-key.json
  两模式（防藏任意脚本绕过）。**次要②**：G4b 独立 check id workspace_tmp_hygiene +
  与 framework_integrity 共存用例（互不吞没）。
- **cursor 笔误**：两处 scratch//gitignored → "scratch/ 或 gitignored"，已改。

**第三轮（2026-07-09，codex）**：两 P1 一 P2 两次要，逐条核实全部属实已钉死：

- **P1-1（cursor 物化模型不能留"评估"）**：核实 runtime-policy.ts:345——settings_file+
  hooks 双字段即判 hard_hook，注释明确该档语义=Stop/correction 链路在场，cursor 只有
  PreToolUse 写守卫不够格。采纳 codex 最小方案钉死：cursor adapter.yaml 只声明
  settings_file（物化 .cursor/hooks.json），**不声明 hooks 字段**；hooks.json 直接调
  发布件内脚本（不复制、不加 schema 字段）；共享核心放 agents/shared/；回归测试钉
  resolveEnforcementTier(cursor)==='soft_rule_only'。
- **P1-2（旧包缺 sidecar 的结果模型）**：防实现成"缺失即 return"把旧包 drift/foreign
  校验整体跳过。钉死独立 check id **framework_manifest_selfcheck**：存在且匹配 PASS /
  不匹配 BLOCKER 停止后续 / 缺失 MINOR WARN **且继续** per-file+G2；组合单测（缺
  sidecar + 漂移 → WARN 与 BLOCKER 同时可见）。（⚠️ 缺失分支口径已在第七轮被推翻——
  现语义：缺失 → BLOCKER 且继续，组合单测为两 BLOCKER 同时可见；"且继续"的结果模型
  本身不变。）
- **P2（deny 协议）**：对照官方文档核实——exit 0 才消费 JSON（user_message/agent_message），
  exit 2 直接阻断不读 JSON。原"JSON+exit 2 双保险"实为丢教育文案。改：正常阻断 =
  deny JSON + exit 0；exit 2 仅留无法产出合法 JSON 的异常分支；其余 fail-open 交 G2。
- **次要**：G2 walk 不跟随 symlink/junction、链接自身判 foreign + Windows junction
  用例；取证表"cursor 无 hook 能力"改为"事故发生时 cursor adapter 未物化 hook（初稿
  认知已过时，G1b 补齐）"。

**第四轮（2026-07-09，codex）**：一条新 P1，核实属实已钉死，其余确认全部闭环：

- **P1（settings_file verbatim 覆盖宿主 hooks.json）**：核实 check-init.ts:682——
  settings_file 产 kind:'verbatim'，auto_overwrite 备份后**整文件替换**，不做 JSON 合并。
  .cursor/hooks.json 是宿主原生共享配置（可能已有团队格式化/审计/安全 hooks），第三轮
  方案会覆盖宿主资产。修：G1b 物化改**结构化 upsert**——adapter schema 新增 hooks_config
  字段（kind: structured_upsert，显式扩 schema/check-init/sync/fixtures；刻意不走"按
  target path 特判 merge"的隐藏魔法）；upsert 语义钉死（不存在创建 / 合法仅 upsert 自有
  条目幂等 / 保留一切他方字段 / 非法 JSON 绝不覆盖 / 卸载只删自有）；四件套单测（第三方
  保留/自有升级/幂等/非法不覆盖）。tier 不受影响（hooks_config 是新字段，
  resolveEnforcementTier 只读 settings_file+hooks，回归测试照钉）。

**第五轮（2026-07-09，codex）**：无 P1/blocker，一条 P2 收尾，设计逻辑成立已钉死：

- **P2（ownership key 不能含 matcher）**：matcher 是 framework 管理的可变字段（宿主实测
  后会变、随 Cursor 工具名演进会升级），进 key 会在其升级时"找不到旧条目→追加→旧 matcher
  永久残留、UPDATE 不幂等、卸载删不净、同一次调用跑多个 guard"。钉死：**ownership key =
  稳定 command 路径**；matcher/timeout/failClosed 为受管可变字段 UPDATE 原位更新；同
  command 多条去重保一；command 路径未来变更走 legacy_owned_commands 迁移清单；卸载删
  全部 owned/legacy 条目、保留第三方与容器。补三件套单测：旧→新 matcher 原位升级数组
  长度不增 / 两历史自有条目去重为一 / 版本变化后卸载自有全清第三方保留。codex 确认
  其余（所有权、tier、deny、sidecar、EOL、foreign-file、symlink、旧包兼容）全部闭环。

**第六轮（2026-07-09，codex）**：一条 P1（跨运行时白名单 SSOT），核实属实已钉死：

- **P1（G1/G2 白名单没有可共享的 SSOT）**：核实 tsconfig module:commonjs + hook 为独立
  node ESM .mjs——TS 常量无法被 .mjs 共享，各抄一份必然漂移（G1 放行 G2 BLOCKER、新
  runtime artifact 只更新一边）。钉死中立 JSON SSOT specs/runtime-artifact-policy.json
  （ignored_runtime_patterns / generated_file_patterns / reserved_metadata_files；canary
  两模式与 sidecar 均登记于此），canonical-gitignore 派生、framework-integrity 与 hook
  core 直读，三方一致性单测禁第二份列表。**人签 allowlist 语义跨实现一致**：核实
  framework-integrity.ts:39 的 approvalInvalidReason 拒绝语义（legacy 字符串/goal-mode-
  auto/user_requirement/缺 rationale）——.mjs core 复刻同语义 + 跨实现一致性单测 + G1a
  补五负例（防 agent 先写无效 allowlist 绕过写守卫、拖到下次 G2 才暴露）。codex 确认
  除此之外无新问题，修完即可正式实施。

# Tasks: receipt-slim

## 1. base/patch 时序拆环

- [x] writeRunSummary 拆 writeBaseRunSummary（无 receipt 依赖、next_action 初值、closure_status=open、原子写 tmp+rename）+ patchRunSummaryClosure（只更新三字段，不首建）
- [x] harness-runner 主流程重排：base → 骨架 → tryValidateReceipt（读本次 base）→ patch
- [x] 崩溃中间态：由构造保证（base 原子写 tmp+rename + closure 恒 open 初值；patch 只改三字段）——slim e2e 以 open 态 summary 为输入直接消费，无需独立崩溃夹具

## 2. receipt 瘦身契约

- [x] 模板改瘦身版（receipt_schema: "2.0"；删 script_harness/trace_json 块与 q1/q3）
- [x] check-receipt 双格式分派：schema 2.0 走新判据（summary 直读五条）；旧格式全量校验照旧（含 command 注入扫描）
- [x] 对账强度：feature/phase 精确匹配 + PASS 且 0 blocker + gate_fingerprint 新鲜 + summary 缺失 BLOCKER
- [x] 骨架生成：PASS-gated、幂等不覆盖、失败不阻断

## 2.5 v3 修订（post-impl 双审两轮）

- [x] summary 过完整 schema 子集校验（lite-json-schema：type/enum/$ref/pattern/additionalProperties + 三类逃逸负例）
- [x] run identity：summary 增 generated_at/source_commit_sha/worktree_digest/run_id；slim 三方 sha 绑定（短 SHA 先解析全长）+ 产品层 worktree 摘要重算比对 + goal run_id 绑定
- [x] 测试夹具改全量合法 summary（不再把 schema-invalid 片段固化成绿灯）+ worktree 失配负例

## 2.6 v4 修订（post-impl 第三轮 codex）

- [x] worktree digest 补两处盲区（阻断2）：untracked 文件经 git ls-files 枚举并**哈希内容**（status 只给路径名——同路径改内容此前不可见）+ 根级构建/门禁输入（framework.config.json/build-profile.json5/oh-package* /hvigorfile.ts/hvigor）纳入 pathspec 绑定；负例改真实 dirty 场景（真改 untracked 内容/真改根配置后重算失配），不再只靠手写假摘要
- [x] goal run_id fail-closed（高优）：goal 环境缺 MAISON_GOAL_RUN_ID → BLOCKER（slim_summary_run_identity_unavailable）；summary 缺 run_id → BLOCKER（slim_summary_run_id_missing）；失配照拒——传播链异常不再静默跳过绑定校验（与 assumptions ledger 先例对齐）
- [x] lite-json-schema 原型键逃逸（高优）：required/properties/additionalProperties 全部改 hasOwnProperty 判定——`key in props` 走原型链，constructor/toString/__proto__ 曾可逃过 additionalProperties:false（codex 实测复现）；补四类原型键负例

## 2.7 v5 修订（post-impl 第四轮 codex）

- [x] untracked 路径 quoting 绕过（阻断）：git 默认 core.quotePath=true 下中文等非 ASCII 路径被引号+八进制转义，非 -z 实现 readFileSync 恒失败→恒 unreadable→内容 A→B 摘要不变（codex 实测复现）。修：ls-files 改 `-z` + NUL 切分不 trim；新增 worktree-digest 直测套件（中文/空格/#/ASCII/稳定性/哨兵边界）+ receipt-slim 中文路径 e2e 负例

## 2.8 v6 修订（post-impl 第五轮 codex）

- [x] worktree 校验残余 fail-open 三分支全闭（P1）：①check-receipt 收紧为**只有两侧都是 16 hex（或双 no-layers 确定性配置态）才走相等比较**——no-git===no-git 等"两侧同错误常量假匹配"被构造性排除；②untracked 文件不可读不再折叠成稳定 `path=unreadable` 常量（持续不可读时内容变化不可见）——整体返回 'unverifiable' 哨兵；③git rev-parse HEAD 失败不再静默跳过 → slim_summary_head_unverifiable BLOCKER。故障注入测试：读失败注入缝（__testing_setDigestReadFile，仓内先例模式）→ unverifiable；summary 侧哨兵值 e2e 负例；校验前 .git 失效（rename 注入）→ head_unverifiable

## 3. 负例与回归

- [x] 负例夹具（receipt-slim.unit.test 6 例）：本次 FAIL+上次 PASS summary 不得过；stale fingerprint 不得过；他 feature summary 不得过
- [x] 注入攻击回归：process-integrity.unit.test 既有覆盖（runProcessIntegrityPreflight 预加载检测→BLOCKER 进 checks→base FAIL）+ goal sanitizeSpawnEnv 既有用例；旧格式回执 command 扫描保留（check-receipt legacy 分支）
- [x] 旧格式回归零变化（既有 receipt fixtures 全绿）；evidence-manifest 幂等共存
- [x] Stop hook / goal 链路消费语义不变——hook-stale-state 等既有套件 + 全量回归 exit 0 确认

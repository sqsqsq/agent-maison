## 1. P0-5 framework_integrity_block（实施第 1 位）

- [x] 1.1 classifier：`FailureKind` 增 `framework_integrity_block`；`integrity_subtypes[]` 收集式（blocker.classification + blocking_class==='integrity' 过滤 + 去重 + 顶层带过滤回落）
- [x] 1.2 freshness 决策表落地（stale→agent_timeout；fresh+含 integrity→framework_integrity_block；fresh+非空全 framework_bug→framework_bug；混装/纯 content→agent_timeout；blockers.length>0 防真空真值）
- [x] 1.3 runner：framework_integrity_block 首触 halt + subtype 分补救 guidance（6 subtype 矩阵，多值逐条按修复顺序）；integrity_subtypes 透传 phase_verdict/GoalPhaseOutcome/goal report
- [x] 1.4 buildPhasePrompt：framework_integrity_block 不提供修复指引（禁自动回滚）

## 2. P0-3 framework_bug（实施第 2 位）

- [x] 2.1 check-{spec,plan,coding,review,ut}.ts safeRun：程序员错误置 failure_kind='framework_bug' + blocking_class='framework_internal'
- [x] 2.2 classifier：`framework_bug` kind + 决策表行（非空全 framework_bug + fresh）
- [x] 2.3 runner：framework_bug 首触 halt + guidance（回灌源仓/勿改产物/附 checker id + 栈首行）

## 3. P0-1 continuation（实施第 3 位）

- [x] 3.1 continuation {cause, process_resumed} 五态窗口派生（events 回放 + in-memory + checkpoint 三层；同一 attempt 内信号优先级）
- [x] 3.2 harness_start/harness_end/phase_verdict 事件补 invoke_id；旧日志按事件顺序分窗 fallback
- [x] 3.3 isPhaseContinuation 与 retries 解耦；PASS+timeout 也出续作块（含空 partial）；resume kind 不丢；断流块头分文案；续作块注入有效预算与已耗时
- [x] 3.4 --resume 进入全新 phase → continuation=null 零注入

## 4. P0-2 形状防崩溃（实施第 4 位）

- [x] 4.1 `asArray()` 共享工具落位 + inventory 表对码定稿（以 loader 读取面为 SSOT）
- [x] 4.2 batch1 点位替换（ui-spec/visual-parity/asset-crop-vl/contracts/acceptance/use-cases 消费点）
- [x] 4.3 形状结构化 FAIL 配对（非法形状不得静默 PASS）
- [x] 4.4 fixture 矩阵（{} / "" / 嵌套 dict / parse null × batch1 checker）

## 5. P0-4 硬预算（实施第 5 位，依赖 P0-1 同批或之后）

- [x] 5.1 连续超时计数（events 回放，签名无关）+ 第 2 次升档 ×1.5（仅默认表派生值）+ 第 3 次 halt agent_timeout_repeated + guidance 附各 attempt 时长表
- [x] 5.2 wall deadline 制：agent 侧 availableForAgentMs≤0 禁启动（不构建 prompt/不写 invoke_start/直接 budget_wall_clock）；effectiveAgentTimeoutMs 恒>0 断言
- [x] 5.3 harness 侧 availableForHarnessMs≤0 禁 spawn；runHarnessPhase 返回 {exitCode, timedOut}；超时→harness_end{timed_out:true}+budget_wall_clock+不读半写 summary
- [x] 5.4 backoff 钳制（不足不 sleep 直接终局）；run_end 后收尾纳入 FINALIZE_RESERVE，超则跳过 best-effort 收尾 + finalize_skipped 留痕
- [x] 5.5 Windows bounded tree-kill：execFile('taskkill.exe',{shell:false,windowsHide:true}) + 有界等待 + 超时 kill helper + 销毁 stdio → kill_process_tree_timeout；agent/harness 共用
- [x] 5.6 resolveKillGraceMs()（termination 契约四常量同源派生）+ FINALIZE_RESERVE_MS 常量；effective_timeout_ms 写入 agent_invoke_start；progress/status/dead-man 优先读事件、manifest 仅 fallback

## 6. P1 批次（实施第 6 位）

- [x] 6.1 P1-6：AGENTS.md 模板/写保护 skill 增"修改 framework 发布件前必读"；framework.config.template.json integrity field_notes 修正（结构化具名审批）；framework-integrity suggestion 补 goal run 并发提示
- [x] 6.2 P1-7：adapter-schema.yaml 增 output_delivery；adapter_version 每 run 一次短超时探测进 run event；agent_invoke_end 增 kill_reason/effective_timeout_ms/output_bytes/output_delivery；agent-output.log runner 永不写入
- [x] 6.3 P1-8：PASS/advance 事件省略 failure_kind_classified；context-facts 门禁报错带模板与双版本提示

## 7. 测试与回归

- [x] 7.1 classifier 单测：决策表逐行 + integrity_subtypes 收集式/过滤/回落 + 三类共存组合 + framework_bug
- [x] 7.2 goal-runner/goal-runner-phase 单测：continuation 五态窗口全矩阵（含 resume 全新 phase→null、两个崩溃段用例）+ 回喂注入断言
- [x] 7.3 硬预算单测（组件级）：连续超时计数 events 回放、升档/熔断/reserve 常量契约、isExplicitPhaseTimeout 豁免、taskkill 永不退出 stub（promise 按时返回 + helper kill/stdio destroy/listeners removed 断言）、grace 四常量同源断言、effective_timeout_ms 事件消费 + 旧日志 fallback
- [ ] 7.3b 硬预算集成断言（待实机回灌）：双侧 zero-budget 禁 spawn / backoff 终局 / finalize_skipped / "**agent+harness+backoff 三路径总时长** ≤ wall + resolveKillGraceMs()"（收尾按 rev8 偏离①为 pre-check best-effort，不入硬界）——runner 主循环行为，代码内已有结构性守卫（≤0 不 spawn 分支 + 调 adapter 前 throw 断言 + canAffordBackoff 纯函数单测），端到端验收需 goal run 实跑或 runner 集成测试床，本批未建
- [x] 7.4 profiles fixtures 矩阵 + 非法形状不静默 PASS 断言
- [x] 7.5 E4 既有单测回归全绿；`cd harness && npm test` 全 PASS（typecheck + 1986 unit + 44 fixtures（随复审轮持续增测，以最终 npm test 输出为准））
- [ ] 7.5b 证据卫生集成断言（待实机回灌）："kill 后 agent-output.log 字节不变"——runner 已无任何写该文件的代码路径（kill 诊断走 agent_invoke_end 事件），独立断言需集成测试床

## 8. 双审复审修复（codex 1P0+3P1+1P2 / cursor 3 阻断+4 重要，2026-07-15 全采纳）

- [x] 8.1 [P0] runHarnessPhase 超时路径 arm force-settle 先于 kill（与 agent killTree 同构，杀不掉时 FORCE_SETTLE 窗口内 resolve）+ POSIX detached 进程组（process.kill(-pid) 前提）+ 接线回归测试
- [x] 8.2 [P1] spec-loader 根节点守卫（null/标量/数组 → 按"无法解析"处理不崩 harness）+ acceptance 字段纠错（criteria/boundaries，非 use_cases）+ shape_issues 结构化上浮（harness-runner `feature_spec_shape` BLOCKER，替代 console.warn 静默洗）+ 三条 spec-loader 单测
- [x] 8.3 [P1] check-ut ui_bindings/data_boundaries 与 named-handler 嵌套集合 takeArray/asArray 防崩；crop entries 坏形状 warn 留痕；inventory 对码表落 design.md
- [x] 8.4 [P1] 移除 checkpoint.timed_out 对 unknown 的升级（phase 级旧 checkpoint 会盖过最新 attempt 的五态结论——events 五态窗口是唯一权威）
- [x] 8.5 [P1] finalize_overrun 事件（收尾同步不可中断的越界量如实留痕，喂 reserve 回灌；边界声明入 design.md）
- [x] 8.6 [P2] agent_timeout_repeated 时长表去重（events 已含本次 invoke_end，不再 concat）
- [x] 8.7 [cursor] 非超时轮 integrity 优先于 external_block；goal-report md 渲染一切带 halt_guidance 的 halt（reason 无关）；续作块补"本 phase 已耗时 across N attempts"

## 9. 双审第三轮修复（codex 3P1+2P2 / cursor 1 实锤残留，2026-07-15 全采纳）

- [x] 9.1 [P1] finalization 与 spec 冲突收口：**修订规格**——硬上界 SHALL 收窄至 agent/harness/backoff 三路径；收尾定性 bounded best-effort（同步 fs 无法被 timer 中断，进程内 watchdog 在同步挂起时同样不运行；worker/child 隔离列开放项），finalize_skipped/finalize_overrun 语义入 spec 与 design.md
- [x] 9.2 [P1] spec-loader 旧 normalize throw 全部降级：files 非数组/含非法条目、module_dependencies 非法标量/坏条目、prd_to_code_traceability 非数组 → 留痕 + 归安全值（坏条目剔除保留好项），不再 summary 前致命退出；两条新单测
- [x] 9.3 [P1] use-cases 嵌套集合（ui_bindings/user_actions/data_boundaries/branches）在 **loader 统一归一** + 带路径留痕——check-ut reduce、testing-trace-gates 遍历、named-handler 全消费链一处防崩，不再落 safeRun 误归 framework_bug；嵌套归一单测（含深层路径断言）
- [x] 9.4 [P2] backoff 严格终局：剩余预算 < 配置 backoff → 不睡直接 budget_wall_clock（不再睡截断残量拖长"卡到总超时"体验）
- [x] 9.5 [P2] probeAdapterVersion 超时改 bounded killProcessTree（win32 shell 壳杀不到 CLI 孙进程）+ 销毁 stdio/监听/unref
- [x] 9.6 [cursor] external+integrity 同场归因单测（integrity 优先）

## 10. 双审第四轮修复（codex 2P1+1P2，2026-07-15 全采纳）

- [x] 10.1 [P1] hard-wall 口径四文档统一（plan rev8 偏离记录①③+开放问题 5 / proposal P0-4 措辞 / tasks 7.3b 验收范围 / spec "pre-check-gated best-effort"精确措辞）——范围收窄为**明确接受并全链留痕**的实施偏离，非隐性降级
- [x] 10.2 [P1] contracts 三层深验证：module_dependencies Record 值须 string[]（{} 归空留痕、非字符串条目剔除）/ traceability 非 object 条目剔除留痕 / key_files 非数组真值留痕归空 + 非字符串条目剔除——codex 实测样例入单测复现（"归空后 0 文件 PASS"由 feature_spec_shape BLOCKER 兜底拦截）
- [x] 10.3 [P2] backoff 决策抽 canAffordBackoff 纯函数 + 行为单测（剩余装不下配置值 → 不 sleep 直接终局）；probeAdapterVersion 测试接缝（spawnImpl/killTreeImpl/noCache）+ 卡死超时行为测试（bounded tree-kill 调用/stdio 销毁/监听移除/按时 unknown）+ 正常路径首行提取测试

## 11. 双审第五轮修复（codex 2P1+1P2，2026-07-15 全采纳）

- [x] 11.1 [P1] plan_to_code 空集假 PASS 根治：traceability 条目存在但总 key_files=0 → BLOCKER FAIL（07-13 案 15 条全缺 key_files 即此形态，"全部 0 个关键文件均存在"真空 PASS 不再可能）；key_files 别名条件收紧为仅缺失时生效（`key_files: ""` 不再借合法 files 静默绕过留痕）；空集行为单测（复现 codex 样例）
- [x] 11.2 [P1] 集合条目级归一：normalizeArrayField 容器合法后再验条目——map 数组中的 null/标量/数组条目剔除 + 带索引留痕（覆盖 modules/components/criteria/boundaries/use_cases/ui_bindings/user_actions/data_boundaries/branches，check-ut mod.package_path / c.ut_layer / uc.id / ub.ui 四崩溃点全防）；codex 实测样例入单测
- [x] 11.3 [P2] 旧口径残留清理：design.md 两处（pre-check-gated / loader 统一归一）+ goal-runner 两处注释（四路径→三路径、进程退出口径→rev8 口径）+ tasks 7.5 回归计数刷新

## 12. 双审第六轮修复（codex 1P1，2026-07-15 采纳；cursor 无阻断）

- [x] 12.1 [P1] plan_to_code 空 key_files 判定改**逐条目**：任一条目 key_files.length===0 → BLOCKER FAIL 并点名 prd_id（空/总计数）——聚合判定会放过"一条空+一条合法"（合法条目文件存在即整体 PASS，空条目 PRD 追溯链静默缺失）；回归测试三件套（部分空 FAIL 点名 / 全空 FAIL / 全合法 PASS 防过严）
- [x] 12.2 [cursor 可选] checkUseCaseUiBindingsNonempty 防御性 takeArray——**评估决策：不做**（在"必须经 SpecLoader"契约下 loader 已归一嵌套集合，该路径安全，cursor 判非必须；如未来出现绕 loader 的消费路径再补，已记 design.md 口径）。本项为已完成的评估决策，非未完成交付

## 13. 双审第七轮修复（codex 2P1+2P2，2026-07-15 全采纳）

- [x] 13.1 [P1] key_files 路径验真：trim 非空 + validateProjectRelativePath（拒绝绝对路径/盘符/".."越根）+ stat.isFile() 普通文件——""/"."/目录/越根四件套伪造追溯全拦（用户内容不合法=plan_to_code BLOCKER FAIL，validator 的 throw 已包裹不落内部错误）；四件套回归测试
- [x] 13.2 [P1] prd_id 契约逐条校验：缺失/""/纯空格 → BLOCKER FAIL 点名条目索引（"无法追溯到任何 PRD"）；三反例回归测试
- [x] 13.3 [P2] 12.2 改为已完成的评估决策（不做≠未完成交付）
- [x] 13.4 [P2] tasks 7.5 回归计数刷新（以最终 npm test 输出为准）

## 14. 双审第八轮修复（codex 1P2，2026-07-15 采纳）

- [x] 14.1 [P2] traceability 逐条目契约行为入 harness-gates capability spec（新增 Requirement + 四类 Scenario：部分空条目不得被合法条目掩护 / 伪造路径四件套 / 缺失 prd_id / 全合法 PASS 防过严）——不再只留 tasks 记录，archive 后并入长期规格，堵"后续重构合法回退"

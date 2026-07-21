---
name: cc-spec 卡死根治 — canary 归一、PASS 态冻结、门禁可修复性与无头求人闭环
version: 3.0.0
# 版本说明：窗口不 bump（用户控版本）。中型演进：治「spec 阶段五连败 HALT——已 PASS 产物被
# 重试毁掉、字段名静默陷阱永修不对、无头下需真人签字的门禁烧内容重试、超时预算不吸取实测、
# halt 文案失真误导宿主」+ 新实锤「claude stream-json 下两条 canary 判卷路径吃不了 NDJSON，
# 真 Claude 宿主会被保守降级永久盲档」。
# v2（2026-07-20）：吸收 codex 一轮（Request changes）+ cursor 一轮（must-fix 六项）——
# P0-0 OpenSpec/fixture 先行 + P0-1 canary 归一；schema 锚点事实修正 + ref-elements 双路径
# + SSOT=JSON Schema；快照 frozen/mutable/derived 三分；gate 侧 actionability；OCR 启发式
# observe-only；超时授予高水位；model telemetry-only；foreign-file 改调查；四正交轴报告。
# v3（2026-07-20，吸收 codex 二轮 4 must-fix + 3 should-fix、cursor 二轮 1 must-fix +
# 分层澄清）：P0-3 快照锚改 HMAC checkpoint（泛化 visionTrustDir 为 runner trust-state
# SSOT；未配密钥只 halt 不自动恢复；frozen 清单复用 phase-evidence-manifest 并补
# asset-manifest；watched namespace 治 added 盲区）；P0-4 actionability 改「拆 id + 标量 +
# ¬∃agent_fixable 触发谓词」消 mixed 死锁，toolchain 独立 await_operator_toolchain，补
# E3 盲档分层表，e2e B 改合成夹具；P0-1 钉死双路径数据源（stdout / agent-events.jsonl）+
# 终态 result 白名单 + 共享 claude envelope parser 模块（并入既有四处解析点）；P0-5
# closure-only 预算按闭环内容定档（verifier 参与则不得低于其校准预算）；P1-9 改 append-only
# adapter_model_observed 事件（不回写冻结 manifest）；P1-10 增条件升 P0 + consumer-layout E2E。
# v4（2026-07-20，吸收 codex 三轮 4 契约缺口 + cursor 三轮澄清）：P0-3 信任分两层
# （同进程内存 digest 即可恢复、resume 须 HMAC——未配 HMAC 的默认宿主同进程仍能自动恢复，
# 修复「PASS 不可毁」承诺缺口）+ 快照独立命名空间（不塞 vision checkpoint 单文件）+ 恢复
# 路径安全（逐级 lstat/realpath 域内/预存 junction 测试）；P0-4 撤销 external_defer 拆 id
# （门禁无数据预划 defer 子集——生命周期实为 external(agent_fixable)→agent 选 defer→
# fidelity_deferrals_human_sign(human_only)，均既有 id）+ actionability 迁移表与优先级链 +
# toolchain 优先于求人；P0-5 closure_kind 二分（deterministic_recheck / 
# receipt_repair_with_verifier 用完整 effective_timeout_ms，不造假校准预算）。
# v5（2026-07-20，吸收 codex 四轮 2 控制流契约 + 2 补强，codex 判定「补完即 plan ready」）：
# P0-5 closure_kind 增确定性分类函数（只读 receipt 探针先行，不从 advance_block_reason 映射
# ——agent_timeout_unclosed 在 resolveClosureAdvanceBlock 中先于 receipt 态返回、会掩盖真值；
# 五格判定矩阵）；P0-4 actionability 嵌入既有 runner 决策梯的唯一位置（安全终态→transient
# API→actionability 聚合→内容重试→closure 路由；既有专用求人态保留在前，不留双 SSOT）+
# 五组合测试；P0-3 恢复补 TOCTOU 单缓冲约束；P0-4 映射收敛为共享注册表纯函数+漂移测试。
# v6（2026-07-20，codex 五轮唯一 P0——closure 分类表升为 ReceiptValidation 状态全集
# （passed/failed/missing/error/not_applicable，phase-state.ts:36）上的 total function：
# error→closure_probe_error/framework_bug 立即 HALT 不调 agent；not_applicable+仍
# advance_blocked→closure_state_invariant HALT；fresh 复用已取得探针值/resume 重探且
# subprocess timeout 受 wall-clock/FINALIZE_RESERVE 约束。codex 判定补完即 Approve）。
# v7（2026-07-21，653734e3 落库后 codex 六轮 3P0+2P1——交叉面修正）：P0-3 supersede 升级为
# trust-state HMAC pass_snapshot_head/tombstone（恢复资格 SSOT，events 仅审计投影；
# invalidated→supersede 崩溃窗 resume 测试；拒旧 epoch 合法 MAC 重放；诚实继承 3.9j 同权限
# 域 anti-rollback 边界）+ artifact-class resolver 四类（新增 mutable_control_plane 收纳
# 视觉二期 receipt/账本控制面，三张 phase output 表全消费）+ HMAC 协议域隔离（kind/
# schema_version/canonical body/epoch/superseded 入签，跨协议替换拒绝测试）；P0-4 迁移表补
# 视觉二期人类门禁（await_human_fidelity_tier 族）+ 专用安全控制流排除清单；P0-0 canary
# delta 改为 visual-capability-truth 新增任务 3.10（不改写已完成 3.3）；基线复核记录勘误
# （「正交无重叠」→「五根因前提成立，集成契约与控制面扩大」）。
# v8（2026-07-21，codex 七轮 1P0+2P1 终局收口）：P0-3 invalidation 升级为可恢复事务
# （invalidation_pending(HMAC) → 全部受影响 head/tombstone → 幂等 phase_invalidated 事件
# → commit superseded；resume 见 pending 即完成事务绝不恢复——治「tombstone 落、事件未写」
# 反向脑裂；验收改 pending-已落-事件未写崩溃窗 + 一次 backtrack 失效多 phase + 故障注入
# 不依赖真实回退路径）；manifest/head 协议域拆分（manifest 不可变、head/tombstone 可变改
# 状态，历史 manifest 永不重写）；P0-4 排除清单改「外围状态机排除项」按三控制区表述。
# v9（2026-07-21，codex 八轮 1P0+1P1 终收口）：P0-3 增 run 级全局 invalidation journal
# （固定路径 pass-snapshots/invalidation.json，tx_id/state/cause_phase/invalidated_phases/
# old_head_hashes/target_generations；resume 先恢复 journal 再读任何 phase head；事件按
# (tx_id,phase) 幂等；全部 head+事件完成才 commit；journal 入跨协议拒绝测试——治「多 phase+
# 中途崩溃」恢复协议悬空）；P0-4 决策梯消 timeout×human_only 冲突（timed_out 且 fresh
# blockers 全 human_only → headless_interaction_required 族走求人，不落 agent_timeout；
# registry 为唯一真值源，废逐 reason 硬编码特判）。
# v10（2026-07-21，codex 九轮 1P0+1P1 定稿）：timeout 分流统一四步（integrity 安全终态→
# ∃toolchain→await_operator_toolchain→全 human_only→interaction 族→其余 agent_timeout，
# 补 timeout×toolchain 三组合测试——治 toolchain 同性质绕过）；双 pending 语义清除
# （journal=唯一事务 pending SSOT，head 只留 active/superseded；验收「tombstone 先行」改
# journal 顺序；journal 无 HMAC/坏 MAC/不可验证→fail-closed halt 不得改 head）。
overview: >
  【事故样本（2026-07-17，宿主 claudecode CLI 2.1.212 + 实际模型 MiniMax-M2.7，goal-mode
  headless，run 20260717T082925Z，证据归档 D:\97.log\问题反馈\07-18\cc spec问题——仅作
  provenance，测试依赖见 P0-0 仓内 fixture）】
  bc-openCard spec 阶段 5 次 attempt 后 no_progress_agent_timeout HALT，全链五环相扣：
  ① spec-i2 harness 全门禁 PASS（exit 0、账本记 must_have_elements 39/39），仅因
  agent_timeout_unclosed（超时未写 receipt）被整轮重试；i3 冷启动重写 ui-spec 把屏级键名
  写成 must_have，PASS 态被毁且不可恢复——runner 对已 PASS 产物零保护。
  ② 字段名三重静默陷阱：capture_completeness 的覆盖判定认「组件树 node id ∪ 屏级
  must_have_elements 列表」（capture-completeness-check.ts:52-66/137-139），陷阱在屏级列表
  字段名；ui-spec.schema.json definitions.componentNode（:73）与 definitions.screen（:166）
  均为 additionalProperties:true，must_have 未知键静默放行（仅根级/global_element 严格）；
  门禁报错文案自己写「ui-spec/must_have 未覆盖」（capture-completeness-check.ts:183），把
  错误键名教给修复者。i3→i5 覆盖率恒 3/39，弱模型永远修不对。
  ②' 路径双胞胎误导（codex 补充实锤）：门禁实读 spec/ref-elements.yaml
  （fidelity-shared.ts refElementsAbsPath），但 affected_files/报错走 relFeatureArtifact
  给出 feature 根路径（capture-completeness-check.ts:78）——i5 实录曾 cp 到根目录白耗时间，
  归档中因此存在内容相同的双份 ref-elements.yaml。
  ③ capture_completeness_external 无头死局（能力分层见 P0-4——本事故属「伪视觉」层：
  能力被声明为有图、未落 none，E3 盲档 WARN 路径未激活，走了 BLOCKER）：分母=原图 OCR
  全文含乱码（「人《AA招商银行」），处置仅 implement 或 defer+真人签字；无头无真人。agent
  已按规程在账本记 must_review=true deferred request（10:20:01），但账本只在 run 终局消费
  （countPendingMustReview）——重试循环不消费，且按 code_regression 盲重试
  （capture_completeness* 不匹配 isCaptureBlockerId，落默认桶）。
  ④ 超时预算不学习：base 45min；升级只看连续超时（goal-timeout.ts:68-69），i3 未超时后
  i4/i5 回落 45min——但 i3 已用 agent exit_code=0 且未 timed_out 证明全量一遍需 49.6min，
  且 i3 曾获授 67.5min 预算（timeout_escalated 事件）。授予高水位与实测完成时长均未保留。
  ⑤ halt 文案「连续超时且产物零进展」（goal-report-generator.ts:223）双分句失实
  （5 attempt 中 3 次超时、产物一直在变；且 i2 同属「超时」与「PASS 被拦」两轴，互斥计数
  必然对不上），宿主转述成「spec 5 次超时」误导用户。
  ⑥ 新实锤（codex 一轮，已逐锚点核实）：claude adapter 声明 structured_events →
  resolveHeadlessInvokePlan 对 KNOWN_STRUCTURED_ADAPTERS 一律注入 --output-format
  stream-json --verbose（agent-invoke.ts claudeArgv/defaultHeadlessInvokePlan）；而
  preflight canary 判卷 lastLegalAssignment 用行锚定 ^KEY=value$ 正则扫 invoke.stdout
  （vision-canary.ts:349-359），inline canary（visual-capability-truth S3 路径 B）读混合
  agent-output.log（stdout/stderr 交叠，stderr 可插进 JSON chunk 中间）——NDJSON 信封里的
  答卷永远不成独立行 → 判卷恒失败 → fail-closed；叠加 effective-vision-context
  「adapter_declared 未实测保守走盲档」（本身正确），净效果=**真 Claude 宿主 canary 永远
  过不了、永久盲档**。本事故（MiniMax 真盲）结论恰好不变，但不修此环不能称根治。
  另两条实证：i5 的 135 次工具调用中 62 Bash+33 Grep+24 Read、仅 3 次 Write 且全是 debug
  脚本（一个写进 framework/harness/，既有 framework_foreign_file BLOCKER 未触发，根因
  待查——见 P1-10，含条件升 P0）——通用自动指引（report-generator.ts 通用自动指引段
  「检索 id=… 查看判定实现」）与门禁自带 suggestion（capture-completeness-check.ts:108
  「lock.structured_bundle 经 structured_ref_elements 注入内存 manifest」）把弱模型引进
  framework 内部逆向而非修产物；agent-events.jsonl init 记 "model":"MiniMax-M2.7" 但
  adapter_probe 只记 CLI 版本。宿主交互侧被 bounded monitor 连续占用 2h05m 无熔断话术。
  【与既有根治的关系】d9b4f7e2 已修「重试回喂/resume 续作提示词」，本次证明提示词级
  「只关环/别重做」对弱模型无约束力——须产物级硬保护；a9d4c7e2 verdict lattice/视觉债务、
  d4a8f3c6 E3 盲档降级、e9c4a7f3 能力真值路由为本 plan 提供状态语义与载体，复用不新造；
  P0-1 canary 归一是 visual-capability-truth 的 delta（先落其 OpenSpec，不旁路）。
  【目标效果曲线】P0 后：真 Claude 宿主 canary 可判卷（能力真值不再永久退化）；任何 phase
  一旦拿到 PASS 即不可能被后续 attempt 毁掉（含快照自身防篡改）；字段名/路径类自误导一次性
  拦截并给出正名；无头下「无 agent 可修项、仅剩签字项」最多消耗一次 attempt 即转求人态；
  超时预算随授予高水位与实测棘轮上行。P1 后：halt 文案与 attempt 实况一致（四正交轴）；
  agent 只收到产物级修复指引；宿主 monitor 有限轮后转 fire-and-forget；模型身份进证据链
  （仅 telemetry，append-only 事件）。

# ============================================================================
# 基线与隔离声明（用户硬约束 2026-07-20：本地有 a9d4c7e2 / e9c4a7f3 相关未提交代码，
# 新 plan 不得受本地代码影响、不得与其冲突）
# ============================================================================
baseline: >
  【基线=HEAD 653734e3，硬前置已满足（2026-07-21 复核）】e9c4a7f3 已提交为 653734e3
  （07-21 09:35，含 visual-capability-truth OpenSpec 落库），**代码工作区无未提交改动**
  （另有本 plan 文件 untracked 与一份无关 android plan md 改动）——codex 一轮设下的
  「先形成可复现提交基线，否则暂停」前置**已满足**，实施可直接叠加 HEAD。
  【2026-07-21 全量基线复核结论】五个 P0 的前提在 653734e3 终版**逐项复核原样成立**
  （证据见文末「基线复核」记录）：canary 判卷仍行锚+全库无归一层；ui-spec schema 仍
  componentNode/screen 双 true；actionability 全库不存在（summary.schema.json 自
  c643f9a8 仅 +asset_debt_revision 一项，无冲突）；无超时棘轮/授予高水位；
  ReceiptValidation 枚举与 resolveClosureAdvanceBlock 的 timedOut 先行掩盖顺序未变。
  先前「本地漂移文件」已全部定格入 HEAD，行号重新可用（关键符号现行位置：
  priorAttemptDurationsMs :3722、escalation 判据 :3733、visionTrustDir :1158、
  P0-D.3 决策梯注释 :4428、inline canary 判卷 :4046-4067）；实施仍以**符号定位为惯例**
  （防后续漂移）。
  冲突面诚实描述（cursor 一轮 must-fix#2，语义保留）：本 plan 与 e9c4a7f3 落点在
  goal-runner **同一条 phase attempt 控制流**相邻插入——实施前先跑 HEAD 全量 unit
  建立绿基线，改动按符号合并。
  【不触碰边界】e9c4a7f3 的账本行链/checkpoint HMAC 判定核心/单写者/事务迁移、a9d4c7e2 的
  verdict lattice/多轴 summary/盲档 UI kit/视觉债务判定核心、d4a8f3c6 E3 盲档降级判定——
  本 plan 只消费其状态语义与基建（AWAITING_HUMAN_REVIEW、视觉债务台账、CapabilityReceipt、
  MAISON_HMAC_* 前缀模型与 stripTrustAnchorEnv、blind-review-pending 清单）；涉及 schema
  的字段新增（summary blocker actionability）走 OpenSpec delta + 符号级合并。

todos:
  # ==========================================================================
  # P0 —— 先根因（canary/字段），再保护（PASS 冻结），再出口（求人），再预算（超时）
  # ==========================================================================
  - id: p00-openspec-and-fixtures
    content: >
      P0-0 OpenSpec 协调 + 仓内最小事故 fixture 先行。
      【行为】(a) 新建 openspec change cc-spec-deadlock-hardening：proposal + specs 覆盖
      goal retry 状态机（PASS 冻结/closure-only/await_human_gate_deferral/
      await_operator_toolchain/超时高水位）、summary blocker actionability 字段（含迁移表
      优先级链与 gate 族匹配规范——external 与 fidelity_deferrals_human_sign 同族，签名/
      账本 gate_id 按族命中，cursor 三轮兼容项）、ui-spec schema 严格化、报告 attempt
      四轴统计；canary 归一
      不另立 change——作为 visual-capability-truth 的 spec delta 提交（扩「structured
      output normalization SHALL be shared by preflight and inline canary; inline SHALL
      parse agent-events.jsonl only」条目），tasks 侧**新增任务 3.10
      structured-envelope normalization**（codex 六轮 P1#5：3.3 已 [x] 完成，不得改写
      已完成任务；也不依赖 3.9j 等无关宿主 pending 项）；OCR 分母启发式**不写硬降档**（维持其
      「observe-only (WARN + persisted counters) in the first release」冻结语义）。
      (b) 从 D:\97.log 归档提取脱敏最小 fixture 入仓
      （harness/tests/fixtures/cc-spec-deadlock/）：五轮精简 events.jsonl、i2-PASS 产物集、
      i3 错键 must_have 终态 ui-spec、claude stream-json canary 样卷（valid 答卷/
      CANNOT_SEE_IMAGE/残卷/多 result/错误 result（is_error=true 但含答题键）/stderr
      插行）、MiniMax init 事件行、账本 deferred 行、framework foreign file 清单差异、
      P0-4 e2e B 合成夹具（见 p04）。原始归档只作 provenance 不进测试依赖。
      【验收】npm run openspec:validate 绿；后续各 todo 的 unit/e2e 全部只引用仓内 fixture。
  - id: p01-canary-ndjson-normalization
    content: >
      P0-1 claude envelope 共享解析模块 + 两条 canary 判卷路径归一（codex 一轮 P0#1 +
      二轮 must-fix#4，已核实：KNOWN_STRUCTURED_ADAPTERS 含 claude 恒注入 stream-json；
      lastLegalAssignment 行锚正则在 NDJSON 上恒空 → fail-closed → 真 Claude 宿主永久盲档；
      agent-output.log 为 stdout/stderr 混合投影，stderr 可插进 JSON chunk 中间）。
      【行为】(a) 抽共享 adapter parser 模块（utils/claude-envelope.ts 或并入既有解析点的
      公共模块——**不在 agent-invoke.ts 再造独立 parser**），统一承载四类消费：最终
      assistant result 文本、init model、图片 Read 事件（并入 critic-receipt-producer.ts
      parseClaudeImageReadEvents）、API error 信封（并入 goal-headless-sentinel
      parseClaudeStreamJsonApiError）——四处既有/新增解析点收敛到一份 envelope 语义，
      防继续漂移。(b) 文本投影只接受**终态 result 白名单**：type=result 且
      subtype=success 且 is_error=false 且 typeof result==='string'；错误 result 即使含
      答题键也不得送入判卷器；多 result 取末次合法者；残卷/解析失败返回 null →
      维持既有 fail-closed，不放宽。(c) 数据源钉死：preflight canary 解析
      invoke.stdout（纯 stdout）；inline canary 解析 agent-events.jsonl（三文件分流的
      纯 events 文件），**禁止再读 agent-output.log**——653734e3 终版 S3 判卷位仍是
      fs.readFileSync(outputLogPath) 混合 log 原始字节直喂 isCanaryAnswerComplete
      （goal-runner.ts :4046-4049，基线复核实证）；同文件 t3b verified 回执生产已在读
      agent-events.jsonl（eventsLogAbsPath :3994-4005），本条即与其对齐。(d) 判卷消费点改造：structured
      adapter → 先归一取投影再进 lastLegalAssignment/整行 CANNOT_SEE_IMAGE 判定；
      非 structured adapter 走原样。
      【触点】新共享模块 + critic-receipt-producer.ts、goal-headless-sentinel（符号）、
      vision-canary.ts（resolveCanaryCacheDecision 消费点）、goal-preflight.ts、
      goal-runner.ts（inline canary 判卷点，符号锚 issued_inline_canary）。多为 e9c4a7f3
      本地已改文件——依 baseline 顺序约束，落其提交基线后实施。
      【验收】unit 用 P0-0 fixture 样卷：valid stream-json 答卷→判卷通过；CANNOT_SEE_IMAGE
      →真盲声明；残卷/多 result/stderr 插行/错误 result 含答题键→各按预期拒收；纯文本旧
      格式回归不破；image-read/api-error 既有消费者行为零变化。宿主回放双侧分立（cursor
      二轮澄清#2）：Claude 宿主（真视觉）→ 判卷通过并签发 capability receipt；MiniMax
      宿主 → 归一后仍判真盲、落 E3 盲档 WARN 路径（**不以「external BLOCKER 复现」为
      P0-1 验收**）。
  - id: p02-uispec-schema-strict-didyoumean
    content: >
      P0-2 ui-spec schema 严格化 + did-you-mean + 自误导文案/路径全修。
      【行为】(a) ui-spec.schema.json：definitions.screen（:166）与
      definitions.componentNode（:73）均收紧 additionalProperties:false；收紧前对两
      definition 的存量合法键做全库盘点（含 e9c4a7f3/a9d4c7e2 新增字段），**以 JSON
      Schema 为唯一 SSOT**（ui-spec-schema-validate.ts:4 既有声明），validator 的
      allowed-keys 从 schema 派生或补 schema↔validator↔UiSpecScreen/UiSpecComponentNode
      三方漂移 unit（沿 visual-fidelity.unit.test.ts G3 drift 守卫先例）；(b) 未知键报错
      带 did-you-mean：编辑距离≤3 或去前缀匹配时输出「非法字段 "must_have"——是否想写
      "must_have_elements"？」；(c) 文案正名：capture-completeness-check.ts:183
      「ui-spec/must_have 未覆盖」→「ui-spec must_have_elements 未覆盖」，全文件字段名
      口径自查；(d) 路径正名（codex 一轮 P0#4）：capture_completeness /
      capture_completeness_external 的 affected_files 与 details 改用 refElementsAbsPath
      同源的 spec/ 相对路径（不再经 relFeatureArtifact 落 feature 根路径）；排查
      relFeatureArtifact 的 PHASE_SCOPED_ARTIFACTS 是否应登记 ref-elements.yaml，根治
      所有同源报错点。
      【触点】harness/schemas/ui-spec.schema.json、ui-spec-schema-validate.ts、
      capture-completeness-check.ts、harness/config.ts（PHASE_SCOPED_ARTIFACTS）；
      spec-ui-spec-check.ts 本地已改——只在其 validateUiSpecSchema 调用点之后消费新错误。
      【验收】unit：must_have 键→FAIL+did-you-mean；componentNode 未知键→FAIL；全部存量
      合法键→PASS；三方漂移测试绿；报错 affected_files 均为 spec/ 路径。fixture 回归：
      i3 错键终态 ui-spec 喂检查→同时报出未知键+正名指引+正确路径（事故三重误导全消）。
  - id: p03-pass-freeze-closure-only
    content: >
      P0-3 PASS 态冻结（HMAC 锚定的 runner-owned epoch）+ 闭环-only attempt 硬保护。
      【行为】phase_verdict 出现 verdict=PASS && advance_blocked 时：
      (a) frozen 清单 SSOT（codex 二轮 must-fix#1 + 六轮 P0#2）：**复用并扩展
      phase-evidence-manifest 的全部三张产出表**（PHASE_OUTPUT_FILES_BY_PHASE +
      PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE（use-cases.yaml，v6 前遗漏）+
      PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE，本次补齐 spec/asset-manifest.yaml），
      不另造路径枚举。分类升级为统一 **artifact-class resolver 四类**：
      frozen_deliverable（三表产物）｜mutable_closure（phase-completion-receipt.md、
      headless-assumptions.jsonl/md）｜**mutable_control_plane**（视觉二期合法控制面，
      按具体语义逐一登记、**禁止 *.receipt.* 通配**：spec/fidelity-downgrade.receipt.json、
      spec/crop-provenance/<key>.receipt.json、vision/capability-receipt.json、
      vision/spec-refs-receipt.json、vision/ 两份 append-only 账本
      （artifact-attestations.jsonl / policy-downgrades.jsonl）——closure/后续 attempt
      合法新增这些文件不得判 added 违规、更不得被自动恢复删除）｜derived/ignored
      （reports/**、缓存）。resolver 为单一纯函数，快照、差异判定、恢复三处共同消费。
      (b) watched namespace 治 added 盲区（codex 二轮 should-fix#6）：frozen manifest 记录
      显式文件 + watched_roots（phase 产物目录清单）+ ignored patterns + entry type
      （file/link/dir）+ canonical 相对路径；违规判定 = watched_roots 目录清单基线 −
      mutable − derived 后的 modified/added/deleted/link 四类差异（added 防新建替代产物，
      link 防 junction 掉包）。
      (c) 可信锚**分两层**（codex 二轮 must-fix#1 + 三轮#1：HMAC 是可选部署配置，若
      「未配即只 halt」则默认宿主在事故主路径上仍无法自动恢复，违背「PASS 不可毁」承诺；
      采既有先例——runner 对刚写出的 checkpoint 在**进程内存保存 digest**、覆盖前核对，
      ok_unauthenticated 也能建立同进程顺序信任（e9c4a7f3 内存可信态/字节 digest 模式））：
      【同一 runner 进程】快照 manifest/digest 以内存副本为信任锚，快照逐文件验哈希通过
      即可自动恢复——**是否配置 HMAC 不影响**；【--resume/进程重启】只有 HMAC 验签成功
      才允许自动恢复，未配 HMAC 只检测违规并 halt 求人，不得用弱信任快照覆盖用户文件。
      落盘：快照内容临时目录构建、逐文件验哈希后原子 rename 落 runner trust-state 根
      （复用既有 visionTrustDir 根目录（~/.maison/goal-checkpoints，
      MAISON_GOAL_CHECKPOINT_DIR 覆盖、env 已从 agent 剥离）+ HMAC envelope/原子写/内存
      digest 三个既有模式），但用**独立 schema 与命名空间**
      goal-checkpoints/<project>/<feature>/<run>/pass-snapshots/<phase>/<epoch>/
      （codex 三轮#3：不塞既有 vision checkpoint——其为一 run 一文件、vision-ledger 专用
      schema（visionCheckpointPath），reseal 会覆盖快照元数据；独立空间还容纳多
      phase/epoch。2026-07-21 基线复核补充：653734e3 后 trust 根下已有三类邻居——
      goal-checkpoints/<project>/<feature>/<runId>.json（checkpoint）与
      vision-heads/<project>/<feature>.json/.hwm.jsonl/.reseal.json（信任锚全链
      head/HWM/reseal，goal-runner.ts :1486/:1589/:1655）；pass-snapshots/ 子树与其
      互不触碰，实施时不得读写这三类文件）。HMAC **协议域隔离 + manifest/head 双域
      拆分**（codex 六轮 P1#4 + 七轮 P1：visionMac 是 goal-runner 私有函数且裸
      JSON.stringify（:1178），非通用 API——只复用其 envelope/密钥模型，签名体独立；
      且禁止实现成「改不可变 manifest 来标 superseded」）：两个独立 kind——
      **pass_snapshot_manifest**（不可变：kind, schema_version, canonical body
      （stableStringify，沿 computeAuthSubsetSha256 先例）, project_identity_hash,
      feature, run_id, phase, pass_epoch, 文件清单+逐文件哈希；**历史 manifest 永不
      重写**）与 **pass_snapshot_head**（可变、HMAC 保护：当前 manifest SHA + 状态
      （**仅 active/superseded 两态**——事务 pending 语义唯一存于 run 级 journal，head
      不承载 pending；codex 九轮 P1 双语义清除）+ generation；**只有 head/tombstone
      改状态**）；跨协议替换拒绝测试分别覆盖两种 kind（checkpoint/head/HWM/reseal ↔
      manifest/head 互塞必须 invalid）。events 的 pass_snapshot_taken
      仅作人读投影，**不是信任源**（events.jsonl agent 可写）。
      (c') 恢复路径安全（codex 三轮#3）：建快照与恢复前对目标及**全部父目录** lstat，
      任何 symlink/junction/reparse point 一律 fail-closed；realpath 必须落在
      project/feature 允许根内；恢复用同目录临时文件+原子 rename，不跟随链接。
      TOCTOU 约束（codex 四轮#3：验证的字节必须就是最终安装的字节）：snapshot bytes
      **一次读入内存 buffer** → 对该 buffer 验哈希 → 同一 buffer 写目标临时文件 →
      原子 rename；禁止「先 hash 快照文件、再另行 copyFile」的两读窗口。
      (d) closure-only attempt：prompt 注入「frozen 清单只读，仅补 receipt/closure」；
      预算独立（见 P0-5）；结束后跑 (b) 差异判定；有差异 → events
      （type: pass_snapshot_violation）+ 按 (c) 两层信任判定恢复（同进程内存 digest 验真
      即恢复；resume 后须 HMAC）+ advance_blocked 续计（既有
      ADVANCE_BLOCKED_HALT_THRESHOLD=2 封顶违规循环）。goal-report 违规引导附一句
      「生产/无头部署建议配置 MAISON_HMAC_GOAL_CHECKPOINT（cursor 三轮：使 resume 场景
      也可自动恢复）」。
      (e) 恢复后重跑 harness 仍 PASS 且 receipt closed → 推进。快照废弃（codex 六轮
      P0#1 + 七轮 P0：单纯「tombstone 先行」仍有反向脑裂——tombstone 落、
      phase_invalidated 事件未写即崩溃，e9c4a7f3 resume 投影会认为旧 phase 仍有效）：
      升级为**可恢复事务 + run 级全局 journal**（codex 八轮 P0：pending 不挂任何单
      phase 的 head——一次回退跨多 phase、且 cause phase 可能根本没有 PASS head）：
      journal 固定路径 goal-checkpoints/<project>/<feature>/<run>/pass-snapshots/
      **invalidation.json**（独立 kind: pass_snapshot_invalidation + schema_version，
      HMAC 同密钥不同域），字段至少 {tx_id, state: pending|committed, cause_phase,
      invalidated_phases, old_head_hashes, target_generations}。事务步骤：
      ① HMAC 写 journal（state=pending）；② 对**全部**受影响 phase 更新
      pass_snapshot_head/tombstone（至 target_generations）；③ 幂等追加
      phase_invalidated 事件（携同一 invalidation_tx_id，按 (tx_id, phase) 去重；写点
      参照 goal-runner.ts:4704 authorized_source_mutation_backtrack）；④ 全部 head 与
      事件完成后才 commit journal。**runner/resume 必须先恢复 journal（pending →
      续跑②③④），再读取任何 phase head**——绝不在未完成事务下恢复任何快照；journal
      无 HMAC、坏 MAC 或无法验证 → **fail-closed halt**，不得依据不可信 journal 改
      任何 head（journal 为唯一事务 pending SSOT；head 两态见 (c)。终审措辞钉死：
      该 fail-closed 适用于 **--resume/进程重启**路径；同一 runner 进程内仍遵守 (c)
      的内存 digest 信任模型——默认无 HMAC 环境的同进程事务照常执行，不产生歧义）。
      supersede/pass_snapshot_* events 仅作审计投影。恢复资格判定一律读 head/tombstone：
      已 superseded 或 epoch 落后的快照，**即使 HMAC 合法也拒绝重放恢复**。
      【诚实边界】跨重启新鲜度继承视觉二期 3.9j 未解决的同权限域 anti-rollback 残余
      （tombstone 与 HWM 同为同权限域完整性检测，防误碰与顺序信任，不是密码学单调计数；
      3.9j 独立锚落地后同步升级）。
      【诚实残留】无头运行假设无并发人工编辑；用户 attempt 间改产物会被判 violation——
      goal-report 违规事件附「若系人工修改请 --resume 前 supersede」引导。
      【触点】goal-runner.ts（advance_blocked 分支、attempt 收尾、visionTrustDir 泛化，
      均符号锚）、phase-evidence-manifest.ts（补 asset-manifest + watched_roots 导出）、
      goal-report-generator.ts（违规/引导渲染）。快照/校验逻辑若超 150 行拆
      utils/pass-snapshot.ts（merge-not-new-files 例外须在 review 记录）。
      【验收】unit：PASS+unclosed→独立命名空间快照+签名体全字段；closure-only 改 frozen→
      violation+恢复+不奖励；**无 HMAC+同进程：重写后成功恢复并推进**；**无 HMAC+resume：
      只 halt 不恢复**（codex 三轮#1）；配 HMAC+resume：验签通过恢复；快照 bytes 或
      **pass_snapshot_head/manifest** 被篡改→内存 digest/验签失配→halt 不恢复；
      added/deleted/link 各判违规；**mutable_control_plane 合法新增（如
      vision/capability-receipt.json、crop-provenance receipt）→不判 added、不被恢复
      删除**（codex 六轮 P0#2）；**journal state=pending 已落、事件/部分 head 未写即
      崩溃→resume 先恢复 journal 续跑②③④、拒绝恢复旧快照**（codex 七/八轮崩溃窗
      定案）；**一次 backtrack 失效多个 phase→journal 单事务覆盖全部 head/tombstone
      更新**；**resume 在读任何 phase head 之前先查 journal**；**phase_invalidated
      事件按 (tx_id, phase) 幂等（重复恢复不重复记账）**；以上以**纯函数/故障注入**
      构造（4.2b pending、生产自动回退禁用，不依赖真实 authorized_backtrack 路径自然
      触发）；**已 superseded/旧 epoch 快照虽 MAC 合法→拒绝重放**；**跨协议替换
      （checkpoint/head/HWM/reseal ↔ pass_snapshot_manifest/head/invalidation
      journal 互塞）→三种 kind 各自 invalid**；预存 junction→建快照 fail-closed；快照后父目录
      被换 junction→恢复前逐级 lstat 拦截；receipt/账本改动不触发（mutable）；连续两次
      违规→halt；backtrack→按 journal 顺序（journal pending → 全部 heads/tombstones →
      events → commit）+epoch 递增；**resume 时 journal 无 HMAC/坏 MAC/无法验证→
      fail-closed halt，不得依据不可信 journal 改任何 head**；vision checkpoint reseal
      不影响快照元数据（命名空间隔离）。e2e 回放 A（P0-0 fixture）：
      i2 场景（PASS+timeout）→ 冻结 → closure-only 补 receipt → phase 以 i2 产物推进，
      i3 式重写在**未配 HMAC 的默认环境**下也被同进程恢复。
  - id: p04-actionability-await-human
    content: >
      P0-4 门禁结构化 actionability 主导的无头求人闭环（codex 一轮 P0#7：账本仅留痕不
      构成授权；codex 二轮 must-fix#2 + cursor 二轮唯一 must-fix：单枚举 mixed 会堵死
      求人出口——v3 定案「拆 id + 标量 actionability + ¬∃agent_fixable 触发谓词」）。
      【能力分层（cursor 二轮澄清#1，先于行为定义）】external 门禁三层各归其位，本 plan
      不重做 E3：真盲（adapterImageInput=none）→ 既有 E3② WARN + blind-review-pending
      批量登记（capture-completeness-check.ts:558-575，d4a8f3c6 已交付），求人走其收口
      清单；伪视觉/真视觉但 OCR 死局（能力非 none，事故即此层）→ BLOCKER + 本 todo 的
      actionability 出口；canary 吃不下 NDJSON 致真 Claude 永盲 → P0-1。
      【行为】(a) 数据结构（v4 定案，codex 三轮#2：**撤销 external_defer 拆 id**——
      external 门禁只有 OCR uncovered[] 单清单，implement/defer 是 agent 看图后的选择，
      门禁无数据预划 defer 子集，预拆只能靠启发式凭空分=变相违反 observe-only。真实
      生命周期为：external(agent_fixable) → agent 选 defer 写入 → 无人签 →
      fidelity_deferrals_human_sign(human_only)——两个 id 均已存在，谓词自然接力）：
      CheckResult/SummaryBlockerEntry 增**标量** actionability?: 'agent_fixable' |
      'human_only' | 'toolchain_blocked'；**不新增任何 blocker id**。首批标注迁移表
      （优先级链：显式 actionability → failure_kind/blocking_class 兼容映射 → 缺省
      agent_fixable）：capture_completeness_external → agent_fixable；
      fidelity_deferrals_human_sign（fidelity-governance-check.ts:165 既有）与
      await_human_confirm 族 → human_only；capture_completeness_external_ocr_unavailable
      （其 suggestion 自述「此 id 归 toolchain」）及 blocking_class=device_toolchain 族 →
      toolchain_blocked；**视觉二期人类门禁族（codex 六轮 P0#3，653734e3 新增）**：
      fidelity_capability_pregate / failure_kind=capability_missing_strong_intent /
      await_human_fidelity_tier → human_only 兼容映射（防落缺省 agent_fixable 重造无头
      空转）。**外围状态机排除项**（codex 七轮 P1：不得为「统一
      ①层」而移动既有安全检查——它们分属三个控制区，聚合层一律不吞并：
      【attempt 之前】vision trust/reseal 启动终态、fidelity transition preflight；
      【attempt verdict 决策梯内】仅 actionability 聚合本身（③层）；
      【verdict 之后 reconciliation】unauthorized_source_mutation（goal-runner.ts:4738）、
      backtrack_limit（:4689）。三区各守既有语义与位置，本 plan 不迁移任何一项）。映射收敛为**共享注册表纯函数**（codex 四轮#4：落
      goal-failure-classifier.ts 就近，复用既有 isToolchainBlockerId/
      hasToolchainBlockingClass，不造第三套 blocker taxonomy），summary 映射、runner
      prompt projection、goal-report 三方共同消费；补注册表↔classifier↔schema 漂移
      unit。触点全列：types.ts（CheckResult）、summary-blockers.ts（映射）、
      summary.schema.json（符号合并 + P0-0 OpenSpec delta）、goal-failure-classifier.ts
      （注册表）、各 check 产出点、runner prompt projection、goal-report。
      (b) 触发谓词与**全局决策梯唯一插入位**（codex 四轮#2：runner 既有优先级梯
      「operator_interrupt > agent_timeout > headless_interaction_required >
      transient_api_error > blocker」（goal-runner.ts P0-D.3 哨兵注释）不得被打乱——
      终审措辞钉死：此为「保留基线 + 适用 v10 timeout 四步分流的 actionability 例外」，
      实施时**同步更新 P0-D.3 旧注释**以免代码注释与新规则矛盾）。
      **timeout 分流统一四步**（codex 八轮 P1 + 九轮 P0：timed_out + toolchain_blocked
      与 human_only 同性质——重试 agent 修不了环境，机械落 agent_timeout 仍空转）：
      timed_out 且有 fresh blockers 时按序判定——
      ① integrity/framework_bug → 安全终态；
      ② ∃ toolchain_blocked → await_operator_toolchain；
      ③ blockers 非空且**全部** human_only → headless_interaction_required 族走求人闭环；
      ④ 其他 → agent_timeout。
      actionability registry（P0-4(a)）是该判定的唯一真值源，废逐 reason 硬编码特判。
      本 plan 钉死唯一顺序：
      ① 安全终态（operator interrupt / interaction / no-output / integrity /
      framework-bug）——原样在前，actionability 不覆盖其专用处理；
      ② transient API 专用退避重试——原样；
      ③ **blocker actionability 聚合**（本层新增）：∃ toolchain_blocked →
      await_operator_toolchain（「修环境」不得描述成「签字确认」）；否则
      ¬∃ agent_fixable 且 ∃ human_only → await_human_gate_deferral（复用
      AWAITING_HUMAN_REVIEW 语义），guidance 逐条列签字项与落点；
      ④ agent_fixable 的 no-progress 熔断/内容重试——human_only id 不入签名；
      ⑤ PASS+advance_blocked 的 closure_kind 路由（见 P0-5）。
      既有专用求人态（await_human_confirm / await_human_p0_skip /
      verification_evidence_gap）**保留在第③层之前、语义不动**（归一它们=动 a9d4c7e2/
      既有裁决语义，超本 plan 边界）；③ 只聚合「未被前层认领的本轮 summary blockers」，
      与前层互斥——**不存在两个竞争的求人 SSOT**，OpenSpec（P0-0）写明该互斥契约。
      账本 deferred request（blocker 集合 ∩ ledger.gate_id，按 gate 族匹配——external 与
      fidelity_deferrals_human_sign 算同族）只作 guidance 佐证，不作触发条件。仍存
      agent_fixable → 继续重试，失败回喂块只含 agent_fixable 条目，human_only 条目明示
      「已转人工队列，勿再尝试」。
      (c) OCR 分母：文本形态启发式首版 **observe-only**——WARN + 计数器 + 视觉债务台账
      （债务行数守恒校验保留），BLOCKER 分母不变；硬降档移 out_of_scope。
      (d) 分类更名：capture_completeness* 的 failure_kind 不再落 code_regression，新枚举
      spec_capture_gap（不复用 capture 桶——其语义「修采集导航」；不进 SIGNATURE_HALT_KINDS
      ——主出口是 (b) 即时求人，不靠 no_progress 粗熔断兜底）。
      【验收】unit：¬∃agent_fixable 且 ∃human_only→一次 FAIL 即 await_human（retries
      不减）；仍存 agent_fixable→回喂只含可修条目 + human_only 不入签名；∃
      toolchain_blocked（如 ocr_unavailable **真实 id**，非合成）→优先
      await_operator_toolchain；迁移表三链优先级（显式→映射→缺省）逐条用例；注册表↔
      classifier↔schema 漂移测试；账本错名 gate_id→不影响触发；OCR 启发式→WARN+计数器+
      债务行，分母不变。**决策梯组合测试**（codex 四轮#2 五组 + 八轮 P1 + 九轮 P0 三组）：timeout+仅 human
      blocker→判 headless_interaction_required 族走求人闭环（不落 agent_timeout/
      no-progress，判定经 registry 非硬编码 reason）；**timeout+仅 toolchain→
      await_operator_toolchain**；**timeout+toolchain+human→toolchain 先（②步）**；
      **timeout+toolchain+agent_fixable→仍 await_operator_toolchain（环境不修重试无义）**；
      integrity+human blocker→①层 integrity 先；
      transient API+human blocker→②层退避先；toolchain+human blocker→③层内 toolchain
      先；agent_fixable+human blocker→④层内容重试且回喂只含可修项。e2e 回放 B（**合成夹具**，cursor 二轮 must-fix +
      codex 三轮#2 生命周期对齐）：夹具态=「字段已正名、可建模 OCR 行已全部建模清零
      （external 不再 FAIL）、agent 已写 defer 但无人签 → 仅剩
      fidelity_deferrals_human_sign」→ 一次 FAIL 即 AWAITING_HUMAN_REVIEW。
  - id: p05-timeout-highwater-ratchet
    content: >
      P0-5 超时预算：授予高水位 + 实测棘轮 + closure-only 按内容定档预算。
      【行为】内容 attempt：effective = max(base, granted_highwater,
      ceil(1.2 × max_completed_duration))：granted_highwater = 本 phase 曾授予的最高
      effective_timeout_ms（事故 i3 已获 67.5min，i4 无理由回落）；completed 的 SSOT
      钉死为 agent_invoke_end.exit_code===0 && timed_out!==true；两值均从 events 重建
      （--resume 不丢）；仍受 wall_clock/FINALIZE_RESERVE 钳制。
      closure-only attempt（codex 二轮 should-fix#5 + 三轮#4：DEFAULT_PHASE_TIMEOUT_SECONDS
      是「agent+harness+verifier+receipt」整 phase 预算，仓库**没有** verifier-only 校准
      SSOT——不得虚构「verifier 校准预算」）：closure_kind 二分——
      deterministic_recheck（不调 agent，runner 自己执行正式 receipt state sync/closure
      patch）用短档；receipt_repair_with_verifier（需 agent/verifier 参与）**沿用该 phase
      当前完整 effective_timeout_ms，不擅自缩短**；将来有 verifier duration telemetry 再引
      独立校准预算（out_of_scope）。
      【closure_kind 确定性分类函数（codex 四轮#1 + 五轮 P0）】**不得从
      advance_block_reason 映射**——resolveClosureAdvanceBlock（goal-runner-phase.ts）中
      agentTimedOut 先于 receiptStatus 返回，会掩盖 receipt 真值；advance_block_reason
      仅作 telemetry。分类先跑既有只读探针 tryValidateReceipt（phase-state.ts）取
      receipt 真值，按 **ReceiptValidation 状态全集（phase-state.ts:36：passed/failed/
      missing/error/not_applicable）的 total function** 判定：
      passed → deterministic_recheck（runner 不调 agent，执行正式 receipt state sync/
      closure patch）；
      missing → receipt_repair_with_verifier；
      failed → receipt_repair_with_verifier；
      **error（check-receipt.ts 缺失/npx 启动失败/subprocess 异常）→ 立即 HALT：
      closure_probe_error / framework_bug 语义——坏的是 framework/toolchain，不得调
      agent 修 receipt（防空转回潮）**；
      **not_applicable 且仍 advance_blocked → 状态机不变量违例，立即 HALT：
      closure_state_invariant**（lite track 本不产生 receipt，走到此即 runner bug）。
      探针执行约束：fresh attempt 复用当前控制流已取得的 receiptValidation，不重复
      spawn；resume 时重新 probe；重新 probe 的 subprocess timeout 受 remaining
      wall_clock 与 FINALIZE_RESERVE 约束。
      events 记 closure_kind 与预算来源；「closure 运行 16–20 分钟仍能完成」边界测试只
      用于验证不被旧短预算截断，**不得反向成为新默认预算**；closure-only 超时 → 直接
      closure_timeout 求人/如实报告，**不回内容重试**。
      isExplicitPhaseTimeout：显式配置=hard cap 不被棘轮突破，但 completed 实测
      ≥0.9×explicit 或发生超时时，goal-report 显式提示「配置预算疑似过小 + 实测数据」。
      timeout_escalated 事件增 source（consecutive_timeouts | granted_highwater |
      observed_ratchet）。
      【触点】goal-timeout.ts（纯函数与常量，unit 主场）、goal-runner.ts
      （escalatedTimeoutMs 计算，符号锚 CONSECUTIVE_TIMEOUT_ESCALATE_AFTER/
      priorAttemptDurationsMs）。
      【验收】unit：事故序列→i4 预算=max(45,67.5,59.5)=67.5min 不回落；resume 后从
      events 重建同值；closure-only 两档预算 + 16–20min 边界用例 + 超时不回内容重试；
      **closure_kind 状态全集逐格用例**（探针真值驱动，含 agent_timeout_unclosed 掩盖
      场景下探得 passed→deterministic；**error→HALT 不调 agent**；**not_applicable+
      advance_blocked→closure_state_invariant HALT** 两条新用例）；fresh attempt 不重复
      spawn 探针/resume 重新 probe；显式 45min→不突破但报告提示；wall-clock 钳制与预算
      可负担性用例。
  # ==========================================================================
  # P1 —— 诚实度与弱模型宿主体验
  # ==========================================================================
  - id: p06-attempt-axes-report
    content: >
      P1-6 halt 文案按 attempt 实况四正交轴生成（i2 同属超时与 PASS 被拦，互斥计数
      3+2+1=6≠5 不再出现）。每 attempt 记四轴：agent termination（timeout/exit0/error）×
      harness verdict（PASS/FAIL/unavailable）× transition（advanced/advance_blocked/
      halted/retried）× artifact delta（changed/unchanged/restored），逐 attempt 时间线
      渲染进 goal-report；no_progress_* 同族 halt reason 的死模板
      （goal-report-generator.ts:214-231）改由四轴统计合成，汇总不伪装互斥计数。
      验收：fixture 回放→时间线呈现「i2: timeout×PASS×advance_blocked×changed」等五行 +
      汇总语句与 events 逐项可对账。
  - id: p07-suggestion-audience-split
    content: >
      P1-7 门禁指引分级：agent 通道只给产物级动作。report-generator.ts 通用自动指引段
      （符号定位，~:60）删「检索 id=… 查看判定实现」句，改「按 details 与 affected_files
      修产物；修复路径不明时如实 halt 上报」；capture-completeness-check.ts:108 等
      suggestion 中的 framework 内部机制话术（lock.structured_bundle/
      structured_ref_elements 注入等）移入 blocker 新字段 operator_note（goal-report
      渲染，不进 agent 重试 prompt 失败回喂块；schema 变更并入 P0-0 OpenSpec delta）；
      全库 suggestion 同口径清理；重试 prompt 回喂块尾部加「禁止为绕过门禁读改 framework
      实现」红线。配套（品牌无关的弱模型防护）：上轮失败含 schema 未知键类 BLOCKER 时，
      重试 prompt 附 ui-spec 屏级/节点级合法键清单（由 schema SSOT 生成）。
      验收：unit 断言重试 prompt 无 framework 源码路径/内部机制词表；operator_note 只在
      goal-report；未知键失败→下轮 prompt 含合法键清单。
  - id: p08-monitor-circuit-breaker
    content: >
      P1-8 宿主 monitor 熔断话术。skills/project/goal-mode + skills/reference/
      goal-mode-operations.md：bounded monitor 连续 3 轮 phase/substep 无推进、或单 phase
      监控累计超 30min → 宿主必须转 fire-and-forget：交代 run_id/当前 phase/预计耗时/
      续看指令，交还对话轮次；禁止单轮对话连续 monitor 超 30min（实测 2h05m 占用）。
      纯话术层，不动 goal-monitor.ts。弱模型宿主可能无视话术——接受为已知残留。
      验收：SKILL 文案含轮数/时长阈值与交还模板。
  - id: p09-model-identity-telemetry
    content: >
      P1-9 模型身份 telemetry-only，append-only 事件承载（codex 二轮 must-fix#3：manifest
      在 run_start 冻结 hash 且被 checkpoint/授权/resume 消费，invoke 后回写
      manifest.adapter_model 会破坏真实性判断；adapter_probe 是 run 前 append-only 事件
      也不得回写）。
      【行为】invoke 收尾经 P0-1 共享 parser 读**agent-events.jsonl**（非混合投影）init
      事件 model 字段 → 追加新事件 {type: adapter_model_observed, phase, invoke_id,
      adapter, model, source: structured_event_init}；goal-report 从最新
      adapter_model_observed 投影 telemetry；**不写 manifest**；启动时 adapter_probe 保持
      原样（model 未知就未知）；CapabilityReceipt 仅在本来就要签发时顺带填既有
      provider/model 字段（effective-vision-context.ts:90-91），**不为 telemetry 造
      receipt**。不参与视觉能力 truth、不触发任何策略分支。具体落点（2026-07-21 基线
      复核新增实证）：653734e3 的 inline canary 签发处 writeCapabilityReceipt 硬编码
      model: 'unknown'（goal-runner.ts :4058）——本 todo 以共享 parser 解出的 init
      model 填真值，属「本来就要签发时顺带填」的既定边界内。
      【验收】unit：fixture init 行→adapter_model_observed 事件落值=MiniMax-M2.7；
      manifest 字节不变（frozen hash 校验绿）；无 init/解析失败→无事件不报错；能力路由/
      档位行为零变化（快照对比断言）。
  - id: p10-foreign-file-gate-investigation
    content: >
      P1-10 调查既有 framework_foreign_file BLOCKER 为何未拦 i5 写入（不新加 WARN 扫描、
      不自动搬移用户文件、保留取证现场）。调查清单：宿主 framework/ 是否有
      RELEASE-MANIFEST.json；是否被误判 source layout（无 manifest 即全放行的既有
      Scenario）；宿主运行版本是否已含 consumer-write-guard change；i5 写入发生在 phase
      中段——integrity 扫描是否只在 run 级 preflight 跑、phase harness 不复扫；runtime
      policy 是否误豁免。产出：根因结论 + 最小修复（如 phase_verdict 前复扫
      scanForeignFiles，BLOCKER 语义沿既有 spec 不新造）+ 复现 unit（fixture 的 foreign
      file 清单差异）。**条件升级（codex 二轮 should-fix#7）**：若确认 3.0.0 consumer
      layout 在 agent invoke 后确实不复扫、新写 framework/** 能存活到下一 attempt——此为
      完整性缺口，本项**升 P0** 处置，验收升级为 consumer-layout E2E（真实 layout 下
      agent 写入→下一 attempt 前被 BLOCKER 拦截），不止清单纯函数 unit；若根因=宿主版本
      落后，则修复项转化为发布/升级动作并如实记录。
verification:
  - 前置：e9c4a7f3 提交基线上全量 unit 绿（含其既有用例零回归），npm run
    openspec:validate 绿（P0-0 change + visual-capability-truth delta）。
  - e2e 回放拆双轨：回放 A（P0-3/P0-5）——i2 PASS+timeout → 冻结 → closure-only（按
    closure_kind 定档预算）关环推进，i3 式重写在未配 HMAC 的默认环境下被同进程恢复；
    回放 B（P0-4，**合成夹具**：external 已建模清零、agent 写 defer 无人签、仅剩
    fidelity_deferrals_human_sign）——一次 FAIL 即 AWAITING_HUMAN_REVIEW。两轨共同断言：
    同事故输入不再出现 no_progress HALT + 产物损毁。
  - canary 双侧验收分立（P0-1）：fixture 样卷 unit 全绿 + Claude 宿主（真视觉）实测判卷
    通过签发 receipt；MiniMax 宿主实测归一后判真盲、落 E3 WARN 路径（不以 external
    BLOCKER 复现为验收）。
  - 全部测试只依赖仓内 fixture（P0-0），D:\97.log 归档仅 provenance。
  - 宿主实测回灌：下一次 bc-openCard 实跑（MiniMax 宿主）观测：spec 单 attempt 通过率、
    PASS 后零重写、求人态如实呈现、超时预算不回落。
out_of_scope:
  - 不改 a9d4c7e2 verdict lattice/多轴 summary/盲档 UI kit 判定逻辑；不改 d4a8f3c6 E3
    盲档降级判定；不改 e9c4a7f3 账本行链/HMAC 判定核心/能力路由核心；schema 字段新增走
    OpenSpec delta + 符号合并。
  - OCR 分母硬降档（等 OCR 引擎原生 confidence 通道，另行 OpenSpec 变更）。
  - verifier-only 独立校准预算（等 verifier duration telemetry 落地后另行引入——
    closure_kind=receipt_repair_with_verifier 暂沿用整 phase effective_timeout_ms）。
  - 不做 BYO-VL/外挂模型路线（用户 2026-07-17 已拍板排除）。
  - 不动 bounded monitor 的 runner 侧协议（P1-8 仅话术层）。
  - 版本号不 bump（用户控版本窗口）。
---

## Review-fix 一轮（2026-07-20，codex「Request changes」+ cursor「must-fix 六项」——逐条对 ground truth 核实后修订 v2）

> 注：本表为历史记录，部分处置已被二轮/三轮表覆盖（如 #2 快照方案、P0-4 数据结构）——以正文 todos 当前版为准。

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex P0#1 | canary 判卷吃不了 stream-json，真 Claude 宿主永久盲档 | **实锤**：KNOWN_STRUCTURED_ADAPTERS 含 claude 恒注入 stream-json；lastLegalAssignment 行锚正则（vision-canary.ts:349-359）在 NDJSON 上恒空；effective-vision-context adapter_declared 保守盲档叠加成永久退化 | 新增 P0-1 归一层，两 canary 路径共用；OpenSpec 走 visual-capability-truth delta；依赖其提交基线 |
| 2 | codex P0#2 | PASS 快照冻结了必须可写的 closure 文件；快照在 agent 可写区可被篡改；缺 added/deleted/link/supersede | **实锤**（doc/features/<f>/<phase>/** 含 receipt/账本/reports） | P0-3 改 frozen/mutable/derived 三分；快照外置；四类差异；篡改→halt 不恢复；backtrack→supersede；违规循环由 ADVANCE_BLOCKED_HALT_THRESHOLD=2 封顶 |
| 3 | codex P0#3 | OCR 文本形态启发式硬降分母违反 visual-capability-truth「observe-only」冻结语义 | **实锤**（spec.md 原文） | P0-4(c) 撤硬降档，首版 WARN+计数器+债务台账；硬降档移 out_of_scope |
| 4 | codex P0#4 | ref-elements 报错路径与实读路径不一致（根 vs spec/）；schema 锚点两处事实错误；SSOT 应为 JSON Schema | **实锤**：refElementsAbsPath=spec/，relFeatureArtifact 落根路径；componentNode(:73)/screen(:166) 均 true、global_element(:46) false（v1 写反）；validator 头注 SSOT=schema.json | P0-2 补路径正名+双 definition 收紧+三方漂移测试；overview 事实修正 |
| 5 | codex P0#5 | P1-9 WARN quarantine 与既有 framework_foreign_file BLOCKER 重复且削弱；自动搬文件毁取证 | **实锤**（consumer-write-guard spec+tasks [x]） | 撤销 quarantine，改 P1-10 调查未触发根因+最小修复 |
| 6 | codex P0#6 + cursor#5 | model 品牌→能力/策略是能力真值污染；fidelity_tier 语义盗用；应读纯净 events 文件 | **成立**（CapabilityReceipt 已有 provider/model；agent-output.log 为混合投影） | P1-9 降为 telemetry-only；字段模板注入改由失败内容触发（P1-7）；超时交 P0-5 实测棘轮 |
| 7 | codex P0#7 | agent 自写账本不能单独触发求人（账本仅留痕契约；external 门禁另有 agent 可修出路） | **实锤**（headless-assumptions.ts 头注「账本记录不构成授权」） | P0-4 改 gate 侧 actionability 主导；账本仅佐证 |
| 8 | codex P1#8 + cursor#4 | 棘轮缺「曾授予高水位」；exit0 语义须钉死；closure-only 独立预算；resume 重建；显式配置语义 | **实锤**（timeout_escalated 事件在案；i2/i3 的 exit/verdict 交叉恰为反例） | P0-5 全部采纳 |
| 9 | codex P1#9 | 「3 超时+2 内容 FAIL+1 PASS 被拦」=6≠5，轴重叠伪分类 | **实锤**（i2 双属） | P1-6 改四正交轴时间线 |
| 10 | codex P1#10 | 测试不可依赖 D:\97.log | **成立** | P0-0 fixture 入仓，归档仅 provenance |
| 11 | codex P1#11 | plan frontmatter 未闭合；缺 OpenSpec 协调 | 部分实锤（check-plan-version 当前 PASS，但惯例=闭合+OpenSpec 先行） | frontmatter 已闭合；新增 P0-0 |
| 12 | cursor#1 | schema 锚点写反 | **实锤**（node -e 解析确认） | 同 #4 修正 |
| 13 | cursor#2 | 「与 e9c4a7f3 函数级不相交」不成立 | **成立**（同环相邻插入；行号漂移 3374→3641→3808） | baseline 改写：符号合并+叠其提交基线 |
| 14 | cursor#3 | P0-1 与 P0-3 e2e 单靶互斥 | **成立** | verification 拆回放 A/B |
| 15 | cursor#6 | capture 桶语义=修采集导航，SIGNATURE_HALT_KINDS 兜底非主路径 | **实锤**（goal-failure-classifier.ts:122 注释） | P0-4(d) 降为更名 spec_capture_gap，主出口=即时求人 |
| 16 | cursor 澄清项 | 覆盖判定也认 node id；账本 gate_id 取交集；OCR 金标先人工标定；旧行号删除 | 均成立 | overview/P0-4/验收相应修订 |

## Review-fix 二轮（2026-07-20，codex 二轮「4 must-fix + 3 should-fix」+ cursor 二轮「1 must-fix + 分层澄清」——逐条核实后修订 v3）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 二轮 MF#1 | 外置快照无可信锚：events.jsonl agent 可写，快照 bytes 与期望 hash 可同时伪造后被 runner「恢复」；「framework-local-config state 目录」不存在；frozen 清单应复用 phase 产出面 SSOT | **实锤**：goal-runner.ts:1130 注释原文「writer authenticity 由 HMAC 承载，位置只是防误碰」；visionTrustDir 既有（~/.maison/goal-checkpoints + env 剥离）；phase-evidence-manifest.ts 为产出面 SSOT 且确缺 spec/asset-manifest.yaml | P0-3(c) 改 HMAC checkpoint 锚（五元组绑定+tmp/rename 原子+未配密钥只 halt 不恢复）；泛化 visionTrustDir；frozen 清单复用 phase-evidence-manifest 并补 asset-manifest |
| 2 | codex 二轮 MF#2 + cursor 二轮唯一 MF | 单枚举 mixed 无法按子集回喂；「全 human_only」谓词对主病灶门禁（external=mixed、i3 签名含 agent_fixable 的 capture_completeness）永不触发；SummaryBlockerEntry 扁平 | **实锤**（types.ts/summary-blockers.ts 扁平映射核实；触发谓词死锁推演成立） | P0-4(a)(b) 定案：拆 id（external + external_defer）+ 标量 actionability + 触发谓词改 ¬∃agent_fixable 且 ∃human_only；触点全列；e2e B 改合成夹具（不再写「i3 实况全 human_only」） |
| 3 | codex 二轮 MF#3 | manifest 在 run_start 冻结 hash 被 checkpoint/授权/resume 消费，invoke 后回写 adapter_model 破坏真实性；adapter_probe 为 append-only 不应回写 | **实锤**（checkpoint payload 绑 manifest_hash 注释在案） | P1-9 改 append-only adapter_model_observed 事件；不写 manifest；不为 telemetry 造 receipt |
| 4 | codex 二轮 MF#4 | inline canary 数据源须钉死为 agent-events.jsonl（混合 log stderr 可插进 JSON chunk）；parser 只认终态 result 白名单；仓库已有 parser registry，不要在 agent-invoke 再造 | **实锤**（agent-invoke 三文件分流注释；critic-receipt-producer.ts parseClaudeImageReadEvents 在案） | P0-1(a)(b)(c) 全采纳：共享 envelope 模块收敛四处解析点；终态白名单；preflight=stdout、inline=agent-events.jsonl |
| 5 | codex 二轮 SF#5 | closure-only 15min 无事实基础：goal 闭环成本大头=verifier+receipt（goal-timeout.ts:27 注释） | **实锤** | P0-5 改按闭环内容定档；verifier 参与则 ≥ 其校准预算；16–20min 边界测试；closure 超时→求人不回内容重试 |
| 6 | codex 二轮 SF#6 | added 差异需 watched namespace（清单基线−mutable−derived），manifest 记 roots/patterns/entry type | **成立** | P0-3(b) 采纳 |
| 7 | codex 二轮 SF#7 | 若确认 invoke 后不复扫、foreign file 能存活，应升 P0 + consumer-layout E2E | **成立** | P1-10 增条件升级条款 |
| 8 | cursor 二轮澄清#1 | E3 分层：真盲已走 WARN+blind-review-pending，事故是「伪视觉」层走 BLOCKER；P0-4 勿重做 E3 | **实锤**（capture-completeness-check.ts:558-575 E3② 在案，d4a8f3c6 已提交且在事故 run 生效——事故 BLOCKER 恰证能力未落 none） | P0-4 开头补三层分层表；overview ③ 补层归属 |
| 9 | cursor 二轮澄清#2 | P0-1 验收双侧分立：MiniMax=归一后仍真盲（E3 WARN 路径），不得用「external BLOCKER 复现」验收 | **成立** | P0-1/verification 更正 |
| 10 | cursor 二轮澄清#3 | report-generator :59 实际 ~:60；frozen 清单点名路径函数 | 成立（改符号定位；frozen 清单已转 phase-evidence-manifest SSOT，自然覆盖） | P1-7/P0-3 修订 |

## Review-fix 三轮（2026-07-20，codex 三轮「4 契约缺口」+ cursor 三轮「4 澄清」——逐条核实后修订 v4）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 三轮#1 | HMAC 是可选配置，「未配即只 halt」使默认宿主在事故主路径仍无法自动恢复，违背「PASS 不可毁」承诺；既有先例=同进程内存 digest 顺序信任 | **成立**（HMAC 确为可选部署项；e9c4a7f3 内存可信态/字节 digest 模式在案） | P0-3(c) 信任分两层：同进程内存 digest 验真即恢复（与 HMAC 无关）；resume 须 HMAC 验签，未配只 halt。验收补两条（无 HMAC 同进程恢复 / 无 HMAC resume 只 halt） |
| 2 | codex 三轮#2 | capture_completeness_external_defer 不存在：external 只有 uncovered[] 单清单，defer 是 agent 看图后的选择，门禁无数据预划子集（预拆=启发式凭空分=违反 observe-only）；真实人签 blocker=fidelity_deferrals_human_sign 既有；ocr_unavailable 归 toolchain；需迁移表+优先级链 | **实锤**：capture-completeness-check.ts:436/586 单清单+implement/defer 双出路 suggestion；fidelity-governance-check.ts:165 人签 blocker 在案；:423 ocr_unavailable suggestion 自述「归 toolchain」 | P0-4(a) 撤拆 id：不新增任何 blocker id；external=agent_fixable，human_sign=human_only，ocr_unavailable=toolchain_blocked；迁移表三链优先级（显式→failure_kind/blocking_class 映射→缺省）；e2e B 夹具改为「external 清零+defer 无人签」生命周期态 |
| 3 | codex 三轮#3 | 快照恢复缺路径安全（预存 junction/事后父目录换 junction/恢复写出域外）；不得塞 vision checkpoint 单文件（一 run 一文件、vision-ledger 专用 schema，reseal 会覆盖） | **实锤**（visionCheckpointPath=<trust>/<project>/<feature>/<runId>.json 单文件在案） | P0-3(c') 逐级 lstat fail-closed + realpath 域内 + 原子恢复不跟链接 + 两条 junction 测试；快照独立命名空间 pass-snapshots/<phase>/<epoch>/，只复用 trust 根/HMAC helper/原子写/内存 digest 模式 |
| 4 | codex 三轮#4 | 「verifier 校准预算」无 SSOT——DEFAULT_PHASE_TIMEOUT_SECONDS 是整 phase 预算，不存在 verifier-only 校准值 | **实锤**（goal-timeout.ts:26-30 注释语义核实） | P0-5 closure_kind 二分：deterministic_recheck 短档 / receipt_repair_with_verifier 沿用整 phase effective_timeout_ms；telemetry 后再引独立预算（入 out_of_scope）；16–20min 测试仅防旧截断不成新默认 |
| 5 | cursor 三轮#1 | toolchain_blocked 与 human_only 并存时优先级未写死 | 成立 | P0-4(b)：toolchain 优先（先修环境，清完再评估求人），验收补并存用例 |
| 6 | cursor 三轮#2 | 拆 id 对签名/账本 gate_id 兼容需规范 | 成立（v4 撤拆 id 后签名不变，族匹配仍需要——external 与 human_sign 同族） | P0-0 OpenSpec 补 gate 族匹配规范；P0-4(b) 账本按族命中 |
| 7 | cursor 三轮#3 | 未配 HMAC 保护变弱应在报告点明配置建议 | 成立 | P0-3(d) goal-report 违规引导附 MAISON_HMAC_GOAL_CHECKPOINT 配置建议 |
| 8 | cursor 三轮#4 | 一轮表旧处置易误读 | 成立 | 一轮表头加「已被后续轮覆盖」注 |

## 主实施（2026-07-21，用户授权「开工，做完为止」）

**完成面**：P0-0～P0-5 + P1-6～P1-10 全部完成。新增 `utils/claude-envelope.ts`（四类信封消费收敛）、`utils/pass-snapshot.ts`（resolver/双协议域快照/journal/路径安全，plan 预授权拆分）；goal-runner 六处集成（journal 恢复先于 head 读取/快照建立/closure-only prompt/pre-harness 差异恢复/actionability ③层+timeout 四步/closure_kind 分类+deterministic sync-closure 直推进）；OpenSpec change `cc-spec-deadlock-hardening`（goal-runner+harness-gates 两域）+ visual-capability-truth 任务 3.10 落地；事故 fixture 七件入仓。

**验收**：typecheck 0 · unit **2332/2332**（基线 2277 → +55：六新套件 claude-envelope 13 / ui-spec-schema-strict 7 / pass-snapshot 13 / blocker-actionability 11 / timeout-ratchet-closure 8 / attempt-axes-timeline 2 + framework-integrity 事故复现 1；另 3 条旧契约测试按新契约反转）· fixtures 44/44 · openspec validate 42/42 · plan version PASS。回放 A（i2-pass fixture 冻结→i3 错键重写→默认无 HMAC 环境同进程恢复→零差异）与回放 B（合成夹具：仅剩 fidelity_deferrals_human_sign → 一次 FAIL 即求人）以 fixture 单测形态落地；事故 events 重建断言 i5 预算=67.5min 不回落、i2 时间线=timeout×PASS×advance_blocked。

**计划外硬发现（已修/已记）**：
1. run-unit `CORE_SUITES` 是显式注册表——新套件不注册即被全量**静默跳过**（首轮"全绿"实为未跑新套件的假绿，已注册并复跑坐实 2332）；
2. `capture_completeness_external_ocr_unavailable` 的 suggestion 自述「归 toolchain」但从未注册进 TOOLCHAIN_BLOCKER_IDS（文档≠代码；随迁移表修正，事故里它与 external 一起落 code_regression）；
3. 三方漂移测试首战抓真漂移：TS `UiSpecComponentNode` 缺 `source_ref`（vision-counterevidence 已在消费该字段）；
4. goal-runner PASS+fresh 路径已有 in-flow receipt 探针——closure_kind 的 fresh 复用零成本接上；
5. `npm test | tail` 管道吞退出码（tail 恒 0）——验证流程差点误报，改用重定向+显式 `$?`。

**偏差声明（对 plan 的收窄，均在可接受边界内）**：
① e2e 回放 A/B 以 fixture 驱动的纯函数级单测落地（不 spawn 真实 claude CLI——CI 不可行；全链验收由 verification 既列的宿主实测回灌承担）；② closure-only 违规「advance_blocked 续计」由既有 ADVANCE_BLOCKED_HALT_THRESHOLD 事件回放统计自然承载，未另设计数器；③ deterministic_recheck 走 runSyncClosure 成功即 action='advance'（受快照保护的 PASS 产物 + 已验真 receipt，不再冗余重跑整套 harness）；④ P1-7 合法键清单注入以失败文案（/非法字段/）触发——品牌无关，与终稿方向一致。

**待办（外部依赖）**：任务 7.2 宿主实测回灌（bc-openCard 重跑观测四项）需用户宿主环境执行；P1-10 结论（宿主 framework/ 疑缺 RELEASE-MANIFEST.json 致写保护整线 no-op）需宿主侧核实部署形态，goal-runner 已加启动告警。

## Post-impl review 修复（2026-07-21，实施后 review「2P0+5P1+2P2」——逐条核实全部属实并修复）

| # | 级别 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | P0 | recover 在事件补齐前提前 commit——「commit 后事件补齐前」二次崩溃的缺失事件永久不可修复 | recover 只补 heads 返回 `pending_heads_applied`（不 commit）；调用方幂等补事件后 commit；单测改二次崩溃可重入断言 |
| 2 | P0 | 快照建立/验真失败仍无保护重试（catch 只 warn）；head/manifest 损坏静默跳过；同 epoch 覆盖破坏不可变；表非空零产物放行 | 全部 fail-closed：新 halt_reason `pass_snapshot_unavailable`；`phaseHasFrozenSurface` 区分「设计内不适用（coding/ut 源码树产出）」与「不变量违例」；takePassSnapshot 拒覆盖含合法 manifest 的 epoch 目录 |
| 3 | P1 | 新增 symlink 判 'link' 后因无清单 SHA 被静默留存（violation 记了、restored 记了、链接还在） | diff 按 known.has(rel) 分流：known→link（恢复字节）/新增→added（删除）；restore 补无 SHA 防御删除；新增端到端用例 |
| 4 | P1 | 建快照跟随 symlink/junction 读域外（resolve/take 无链检查；assertInsideRoot 名实不符） | resolve push 前 + take 读取前逐级 lstat；assertInsideRoot 改诚实命名（词法包含，与链检查成对）；junction 化 spec/ 的真实入口用例 |
| 5 | P1 | closure-only 超时仍回内容重试（无 attempt 级状态） | attempt 级 `closureOnlyAttempt` + 纯函数 `shouldHaltClosureTimeout` → halt `closure_timeout`（PASS 超时仍走 closure 分类——deterministic 直接关环更优） |
| 6 | P1 | probe timeout `max(30s, remaining)` 在剩余 ≤0 时突破预算 | remaining ≤5s 跳过探针（wall-clock 判据接管），否则 `min(300s, remaining)` |
| 7 | P1 | operator_note 只生成不渲染（受众分级只做半边） | goal-report 新增「Operator 参考」段（collectOperatorNotes 从各 phase summary 收集） |
| 8 | P2 | 回喂过滤 `!== 'human_only'` 把 toolchain 喂给 agent | 严格 `=== 'agent_fixable'`；toolchain 单列 parked 行；诊断存活面移 summary excerpt（operator/halt guidance），两条旧契约测试同步反转 |
| 9 | P2 | 显式超时 advisory 只打印控制台（detach 后蒸发） | 入 `timeout_advisory` 事件 + goal-report「↳ 预算提示」行 |

**复验**：typecheck 0 · unit **2336/2336**（+4：journal 二次崩溃窗/added-symlink/junction 入口/同 epoch 拒覆盖 + closure_timeout；2 条旧契约测试按新契约反转）· fixtures 44/44 · openspec 42/42 · plan gate PASS · `npm test` 显式 exit 0（不再经管道）。

## Post-impl review 二轮修复（2026-07-21，「2P0+3P1」——逐条核实全部属实并修复）

| # | 级别 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | P0 | committed journal 在验签前被信任（篡改 state=committed+坏 MAC → 直接忽略，pending 未竟的 supersede 永不完成）；commit 重读盘 body 重签=洗白通道 | recover 顺序改 **MAC/上下文绑定先于 state**；commitInvalidationTx 携 expectedTxId，MAC 无效/tx_id 失配一律抛（幂等保留）；journal 增 project/feature/run 绑定校验 |
| 2 | P0 | 快照信任检查在 agent 执行后（closureOnly 判定不看 mac；manifest.mac 从不校验——篡改 files 清空即可洗 diff）；无 runtime shape/上下文绑定，跨 run/phase HMAC 合法重放可行 | 新增 `loadTrustedSnapshotContext`：**spawn agent 前**一次性验 head/manifest 的 MAC+shape+五元组绑定+head↔manifest sha 绑定，fail_closed 在 agent 碰产物前 halt；整个 attempt 复用内存副本（防中途盘上换 manifest）；三个 reader 补字段级 shape 校验 |
| 3 | P1 | closure-only 超时 + harness PASS + receipt 待修 → 仍 repair retry（违反 never re-enter retries）；旧测试把该行为固化成期望 | 分类块补拦：repair+closureOnly+timed_out → halt closure_timeout；probe 无预算跳过时同拦；deterministic 直通保留（runner 关环零 agent attempt）；测试改注明双路径契约 |
| 4 | P1 | dangling symlink 漏检（existsSync 跟随链接→false：宣称删除实际残留；assertNoLinkInChain 同因漏检链本体） | `lstatOrNull`（lexists 语义）替换全部 existsSync 守卫；删除后 lstat 复核，残留→refused；dangling 用例补上 |
| 5 | P1 | frozen 文件被换成同名目录 → diff readFileSync EISDIR 崩溃（violation 记不上、恢复不执行、runner uncaught） | diff 非常规类型判 modified；restore 安装前对非 file 目标先递归移除；file→directory 用例补上 |

**复验**：typecheck 0 · unit **2341/2341**（+5：MAC 先于 state/跨 run 重放+commit 拒洗白/dangling symlink/file→dir/可信加载三态）· fixtures 44/44 · openspec 42/42 · plan gate PASS · git diff --check PASS · `npm test` 显式 exit 0。

## Post-impl review 三轮修复（2026-07-21，「3P0+2P1」端到端信任链——逐条核实全部属实并修复）

| # | 级别 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | P0 | 内存 digest 未成为 pre-spawn 信任锚：两轮绕过——N 轮 closure agent 只删 head（不碰产物→零 diff），N+1 轮 loader 返回 none 保护全关，agent 可改毁 PASS 产物且 runner 可能基于已改产物重建快照 | loadTrustedSnapshotContext 接 expectedAnchor（内存 epoch+manifestSha）：锚在场时 head 消失/退位/epoch·sha 换代一律 **spawn 前 fail_closed**；合法 supersede 先清内存锚不经此路径 |
| 2 | P0 | restore 重新读盘破坏 attempt 级不可变上下文：diff 用快照 A、restore 被换成另一 run 的合法签名快照 B（HMAC resume 无需伪造 MAC，复制即可）；B 无对应 rel 时现文件还会进「无清单 SHA」删除分支 | restoreFrozenFromSnapshot 改收 **attempt 级 TrustedSnapshotContext**：恢复资格以预加载 manifest 为依据，仅复核「盘上 head 与上下文逐字段一致」（换盘即拒）+ 安装时逐字节验哈希 |
| 3 | P0 | 无 HMAC 的 committed journal 绕过 fail-closed：unauth 面 mac=null，pending 被篡改成 committed → 被当完成态忽略，未竟 heads/events 永不恢复（上轮只封了坏 MAC+committed） | **完成态改为 journal 文件不存在**：commit 写 committed 后原子移除；unauth 面上任何**在场** journal 一律 fail_closed 交人工；authenticated 的 committed 残留（commit 后删除前崩溃）由 recover 验签后清理收敛 |
| 4 | P1 | deterministic sync 失败后 closure 超时仍回 retry（route.kind 未变，repair 超时拦截匹配不到） | sync 非零 + closureOnly + timed_out → 直接 halt closure_timeout；未超时才回落 repair |
| 5 | P1 | manifest shape 允许非 canonical/越界路径（../绝对/反斜杠在 assertInsideRoot 前就被 path.join 消费）；空 files/watched_roots 可洗差异检测 | shape 校验升级：canonical rel（无绝对/../反斜杠/空段）+ rel 唯一 + files/watched_roots 非空 + roots 须本 phase 前缀 + 逐文件与 artifact-class resolver 一致（frozen_deliverable） |

**复验**：typecheck 0 · unit **2345/2345**（+4：unauth 在场 journal fail_closed/committed 残留清理/内存锚两轮绕过拦截/manifest shape 八变体拒收；restore 全部 9 处调用改上下文驱动）· fixtures 44/44 · openspec 42/42 · plan gate PASS · git diff --check PASS · `npm test` 显式 exit 0。

## Post-impl review 四轮修复（2026-07-21，「1P0+2P1」——逐条核实全部属实并修复）

| # | 级别 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | P0 | watched_roots 仅前缀校验可被缩窄（`spec/nonexistent/` 通过）：弱信任 resume 伪造「roots 缩窄 + files 漏 ui-spec」→ 改毁产物零 diff 通过，违反「无 HMAC resume 只检测并 halt」承诺 | shape 校验改与 watchedRootsForPhase(phase) **精确集合等价**；files[].bytes 补非负整数校验；新增 spec/nonexistent/、多余 root、负/小数 bytes 四变体拒收测试 |
| 2 | P1 | 「authenticated committed 残留」测试改 state 未重算 MAC——实际只命中坏 MAC 分支，目标清理分支零覆盖（plan 声明不成立） | commitInvalidationTx 增崩溃窗故障注入点（crashBeforeRemoveForTest）——构造**合法 MAC 的 committed 残留**，测试真实命中 recover 清理分支（none + 文件移除）；伪造形态回归保留 |
| 3 | P1 | deterministic sync 非零+超时的修复无控制流测试（旧测试只测 helper 并以注释带过 PASS 分支） | 抽纯决策函数 resolveClosureSyncOutcome（advance/closure_timeout/repair_retry 三值），runner 消费同一函数；矩阵测试锁定目标组合（sync 失败+closureOnly+timed_out→closure_timeout） |

**复验**：typecheck 0 · unit **2346/2346**（残留清理测试重写为命中目标分支 + sync 矩阵新例 + shape 四变体）· fixtures 44/44 · openspec 42/42 · plan gate PASS · git diff --check PASS · `npm test` 显式 exit 0。

## Post-impl review 五轮修复（2026-07-21，「1P0+1P2」——逐条核实全部属实并修复）

| # | 级别 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | P0 | manifest files 无完整性对账：根级 frozen 产物（spec 的 acceptance.yaml / plan 的 contracts.yaml）在 watched_roots `['<phase>/']` 目录域之外，files 条目是其唯一差异入口——弱信任一致伪造（manifest+head 同步改写、roots 保持精确等价、仅删该条目）即可让改毁根级契约零 diff 通过 | 新增 `requiredFrozenRelCandidates`（必需产出表 × canonical+legacy 候选 rel，**磁盘无关**纯注册表推导；config.ts 导出 artifactReadCandidatePaths）+ `findMissingRequiredFrozenRels`；**两端同构**执行：takePassSnapshot 缺必需产物拒建（→ 既有 protectionFailure→halt pass_snapshot_unavailable 路径）、loadTrustedSnapshotContext 对账失败 fail_closed（磁盘已删也须在 manifest——删除正是要检出的漂移）；测试三例：spec 删 acceptance.yaml 伪造→fail_closed、plan 删 contracts.yaml→fail_closed、建侧缺席→拒建 throw；OpenSpec requirement 补完整性对账条款+scenario |
| 2 | P2 | isValidManifestShape 的 bytes 用 `!== undefined &&` 条件校验——完全缺失 bytes 的条目仍通过，与 FrozenManifestBody 类型声明（必填）不一致 | bytes 改无条件必填非负整数；shape 变体测试补「缺失 bytes」拒收例；既有 rel 类变体补合法 bytes 保证各测各的目标拒因 |

**复验**：unit **2349/2349**（+3 新例）· fixtures 44/44 · openspec 42/42（条目数不随 scenario 增加）· git diff --check PASS · `npm test` 显式 exit 0。注：`release:check-plans` 为发布门禁（version=3.0.0 且有未完成 todo 的 plan 全列，含本 plan 悬置的 7.2 宿主实测回灌）——预期红、与本轮改动无关。

## Post-impl review 六轮修复（2026-07-21，「1P1」——核实属实并修复；处置与建议原文有一处分层偏差，见注）

| # | 级别 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | P1 | 五轮完整性对账只消费必需表（PHASE_OUTPUT_FILES）——根级 **optional** 产物（spec 的 use-cases.yaml，非 phase-scoped 落 feature 根）仍可被一致伪造删条目后零 diff 改毁，与 OpenSpec「三张表全消费」不一致 | 三层收口：**建侧**补全集对账（传入 files 须覆盖 resolveFrozenDeliverables 当前完整解析集，漏 optional 即拒建）；**diff 侧** added 域扩到 `rootLevelFrozenCandidateRels`（三表推导、watched_roots 之外、磁盘无关候选）——known 之外磁盘在场即 added（认证态 restore 删除自愈/弱信任 detect+halt）；**载侧**仅在 manifest 未认证（MAC 非 ok 且无内存锚）时做"磁盘在场缺条目→fail_closed"（spawn 前拦截伪造形态）。测试 +3：伪造删 use-cases 条目→载侧 fail_closed+diff added 双拦 / 建侧漏 optional→拒建 / PASS 后根级新增→added。OpenSpec 补三表覆盖+added 域+scenario+诚实边界（无 HMAC 时文件+条目一并删除的历史存在性无从证明，强抗篡改仍须 HMAC） |

**分层偏差注**：意见建议载侧无条件要求"当前存在的 optional 也须在 manifest"；实现将该检查**限定在未认证 manifest**——认证态（HMAC ok/内存锚）下同一现象只能是 PASS 后漂移（伪造不可能），应走 diff added→restore 自愈而非 trust 闸 halt（HMAC resume 崩溃窗漂移若拉 trust 闸，把强信任层惩罚成比弱信任更差的体验）。弱信任场景两层都拦（载侧 spawn 前 + diff 兜底），意见要求的绕过面全封。

**复验**：unit **2352/2352**（+3 新例）· fixtures 44/44 · openspec 42/42 · git diff --check PASS · `npm test` 显式 exit 0。

## Review-fix 四轮（2026-07-20，codex 四轮「2 控制流契约 + 2 补强，补完即 plan ready」——逐条核实后修订 v5）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 四轮 MF#1 | closure_kind 缺确定性分类函数；不得从 advance_block_reason 映射（agent_timeout_unclosed 先返回会掩盖 receipt 真值）；应先跑只读 receipt 探针 | **实锤**：resolveClosureAdvanceBlock（goal-runner-phase.ts:57-70）agentTimedOut 分支先于 receiptStatus；tryValidateReceipt 只读探针在案（phase-state.ts:187） | P0-5 增分类函数：探针先行 + 五格矩阵（unclosed+valid→deterministic / unclosed+missing→repair / closure_open+valid→deterministic / closure_open+invalid→repair / receipt_missing→repair），验收逐格用例 |
| 2 | codex 四轮 MF#2 | actionability 在既有 runner 决策梯中的插入位未定义；不得留两个竞争求人 SSOT；需五组合测试 | **实锤**（goal-runner.ts P0-D.3 哨兵优先级注释在案） | P0-4(b) 钉死五层唯一顺序（安全终态→transient API→actionability 聚合→内容重试/no-progress→closure 路由）；既有专用求人态保留在③前、语义不动，③只聚合未被认领 blockers，互斥契约入 OpenSpec；验收补五组合 |
| 3 | codex 四轮 SF#3 | 恢复需 TOCTOU 约束：验证字节=安装字节（单 buffer 读→验→写→rename） | 成立 | P0-3(c') 补单缓冲约束，禁两读窗口 |
| 4 | codex 四轮 SF#4 | actionability 映射应收敛为共享注册表纯函数，复用既有 classifier 分类，防第三套 taxonomy | **成立**（isToolchainBlockerId/hasToolchainBlockingClass 在案） | P0-4(a) 注册表落 goal-failure-classifier.ts 就近，三方共同消费 + 漂移测试 |

## Review-fix 五轮（2026-07-20，codex 五轮「仅剩 1 个窄 P0，补完即 Approve」——核实后修订 v6）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 五轮 P0 | closure 分类表用 valid/missing/invalid，未覆盖 ReceiptValidation 真实全集；error（探针自身崩溃）不得进 repair_with_verifier（坏的是 framework/toolchain，调 agent 修 receipt 会空转回潮）；not_applicable+advance_blocked=状态机不变量违例 | **实锤**（phase-state.ts:36：passed/failed/missing/error/not_applicable；:203/:212/:221 各状态产出点在案） | P0-5 分类升为全集 total function：passed→deterministic；missing/failed→repair；error→closure_probe_error/framework_bug HALT 不调 agent；not_applicable+blocked→closure_state_invariant HALT；advance_block_reason 仅 telemetry；fresh 复用已取得探针值/resume 重探+timeout 受 wall-clock/FINALIZE_RESERVE 约束；验收补 error 与 not_applicable 两用例 |

## 基线复核（2026-07-21，e9c4a7f3 提交 653734e3 后，对本 plan 全部前提逐项复核）

**触发**：用户指出本地为 e9c4a7f3 改了多轮代码，要求检视对本 plan 的影响。复核发现
e9c4a7f3 已于 07-21 09:35 提交为 **653734e3**（含 visual-capability-truth OpenSpec 落库、
unit 全绿），工作区干净——**硬前置已满足，「暂停实施」条款消解**。

| 检项 | 复核结论 |
|------|----------|
| 「与 HEAD 一致」稳定文件清单（16 个） | 全部 same（现 HEAD=653734e3）；P0-2/P0-4/P0-5 所引行号锚点全部仍有效 |
| P0-1 前提：canary 行锚判卷 + 无归一层 | **原样成立**：lastLegalAssignment 仍 ^KEY=value$（vision-canary.ts:349）；全库无 normalize/envelope 归一符号；S3 inline 判卷读 outputLogPath 混合 log 原始字节（goal-runner.ts:4046-4049）。新先例：t3b verified 回执生产已读 agent-events.jsonl（:3994-4005） |
| P0-3 前提：visionTrustDir/HMAC/内存 digest | 原样成立（visionTrustDir :1158）。**新邻居**：trust 根下新增 vision-heads/<feature>.json/.hwm.jsonl/.reseal.json（信任锚全链，:1486/:1589/:1655）——pass-snapshots 命名空间已确认不碰撞，正文补「不得读写」边界 |
| P0-4 前提：actionability 不存在 | 原样成立：schema/types/summary-blockers/classifier 全库无该词；summary.schema.json 自 c643f9a8 仅 +asset_debt_revision（无冲突） |
| P0-5 前提：无棘轮/高水位；ReceiptValidation 全集；unclosed 掩盖顺序 | 原样成立（escalation 判据 :3733；phase-state.ts/goal-runner-phase.ts 与复核时读取的内容逐字一致） |
| P1-9 落点 | **新增实证**：inline canary 签发 writeCapabilityReceipt 硬编码 model:'unknown'（:4058）——正是 P1-9「签发时顺带填真值」的落点 |
| e9c4a7f3 终版新增面（fidelity transition 前置校验 goal-preflight +88 行、buildInlineCanaryBlock 等） | 与本 plan 正交，无落点重叠；P0-D.3 决策梯注释仍在（:4428），P0-4 五层插入位描述不变 |

**结论（codex 六轮勘误后改写）**：**五个根因前提逐项仍成立，但集成契约与控制面扩大**——
c643f9a8..653734e3 实际含 goal-runner.ts +2038、critic-receipt-producer.ts +270、
spec-ui-spec-check.ts +76、types.ts +22 等（本表首行「全部 same」指工作区 vs 新 HEAD 的
平凡一致，不构成「无落点重叠」；goal-runner 恰是本 plan 主触点）。原「与本 plan 正交、
未产生影响」为过度结论，已撤回。新交叉面（tombstone 崩溃窗/控制面文件/人类门禁迁移/
HMAC 协议域）由 v7 修订吸收。plan 经 v7 修订后保持 ready。

## Review-fix 六轮（2026-07-21，codex 六轮「3P0+2P1——基线复核交叉面修正」——逐条核实后修订 v7）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 六轮 P0#1 | supersede 只是事件不可信：phase_invalidated（:4704）与 supersede 之间崩溃，resume 会把已失效 PASS 快照恢复回来 | **实锤**（phase_invalidated 写点在案；plan 自认 events 非信任源，supersede 却只落 events——自相矛盾） | P0-3(e) 升级：trust-state HMAC pass_snapshot_head/tombstone 为恢复资格唯一 SSOT；invalidation 先原子更新 tombstone 再回退；events 仅审计投影；验收补崩溃窗 resume 拒恢复 + 旧 epoch 合法 MAC 拒重放；诚实继承 3.9j 同权限域 anti-rollback 残余 |
| 2 | codex 六轮 P0#2 | frozen 分类漏 PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE（use-cases.yaml）；视觉二期新增合法控制面（fidelity-downgrade/crop-provenance/capability/spec-refs receipt + 两账本）会被判 added 篡改甚至被恢复删除 | **实锤**（三表齐在 phase-evidence-manifest；控制面文件路径逐一在 check-spec.ts/critic-receipt-producer.ts 核到） | P0-3(a) 升级为 artifact-class resolver 四类（新增 mutable_control_plane），三表全消费，控制面按语义逐一登记禁通配；验收补「合法新增不判 added/不被删除」 |
| 3 | codex 六轮 P0#3 | actionability 迁移表漏视觉二期人类门禁（fidelity_capability_pregate/capability_missing_strong_intent/await_human_fidelity_tier）→ 落缺省 agent_fixable 重造空转；且 vision trust/reseal 终态、unauthorized_source_mutation（:4738）、backtrack_limit（:4689）、fidelity transition preflight 不得进聚合 | **实锤**（各 halt 态符号逐一核到） | P0-4(a) 迁移表补 human_only 兼容映射三项 + 专用安全控制流排除清单（保持①层优先级） |
| 4 | codex 六轮 P1#4 | visionMac 私有+裸 JSON.stringify 非通用 API；pass_snapshot 需独立签名体（kind/schema_version/canonical/epoch/superseded）+ 跨协议替换拒绝测试；「checkpoint 被篡改」措辞歧义 | **实锤**（visionMac :1178 核到） | P0-3(c) 补协议域隔离签名体（stableStringify 沿 computeAuthSubsetSha256 先例）+ 跨协议替换测试；验收措辞改 pass_snapshot_head/manifest |
| 5 | codex 六轮 P1#5 | 基线复核记录「全部未变/正交无重叠」事实错误（实际 +2393 行）；OpenSpec 3.3 已 [x] 不得改写，P0-1 应新增任务 3.10 | **实锤**（diff --stat 复核：goal-runner +2038/critic-receipt-producer +270/spec-ui-spec-check +76/types +22；tasks.md 3.3 [x]、51/59、3.9j pending 均在案） | 基线复核结论段勘误改写（撤回过度结论）；P0-0 改为新增任务 3.10，不依赖 3.9j 等 pending 项 |

## Review-fix 七轮（2026-07-21，codex 七轮「1P0+2P1，补完可 Approve」——核实后修订 v8）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 七轮 P0 | v7 自相矛盾：正文规定 tombstone 先行，验收却测「phase_invalidated 已写、tombstone 未落」；且 tombstone 先行仍有反向脑裂（tombstone 落、事件未写→resume 投影认为旧 phase 有效→双 SSOT） | **成立**（对照 v7 正文 (e) 与验收原文，顺序确实相反；反向窗口推演成立） | P0-3(e) 升级可恢复事务：invalidation_pending(HMAC，绑 cause_phase+invalidated_phases+old_head_hashes)→全部受影响 head/tombstone→幂等 phase_invalidated 事件→commit superseded；resume 见 pending 先完成事务绝不恢复；验收改 pending-已落-事件未写崩溃窗+多 phase 失效+纯函数/故障注入（4.2b pending、生产自动回退禁用） |
| 2 | codex 七轮 P1#2 | 签名体同含 epoch/manifest_hash/superseded 会被实现成「改不可变 manifest 标 superseded」；应拆 manifest（不可变）/head（可变改状态）双域 | **成立**（v7 签名体确实单域混装） | P0-3(c) 拆 pass_snapshot_manifest（不可变，文件清单+逐文件哈希，历史永不重写）/pass_snapshot_head（可变 HMAC，manifest SHA+状态+generation，唯一改状态处）；跨协议测试分别覆盖两 kind |
| 3 | codex 七轮 P1#3 | 「①层安全终态」统称错误：trust/reseal 与 fidelity preflight 在 attempt 之前、mutation/backtrack 在 verdict 之后 reconciliation，不在决策梯①层；统称会诱导实施者移动既有安全检查 | **成立**（控制区归属与代码位置一致：preflight 在 invoke 前，:4738/:4689 在 verdict 后） | P0-4(a) 改「外围状态机排除项」按三控制区表述，明确本 plan 不迁移任何一项 |
| 4 | codex 七轮 非阻断 | 基线记录「工作区干净」不准（尚有无关 android plan md 改动） | 成立 | 改为「代码工作区无未提交改动；另有 plan 文件改动」 |

## Review-fix 八轮（2026-07-21，codex 八轮「1P0+1P1，补完即 Approve/可实施」——核实后修订 v9）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 八轮 P0 | invalidation_pending 隐挂单 phase head：跨 phase 回退无固定发现点（cause phase 可能无 PASS head；resume 无法在读 head 前确定有未完成事务；多次恢复无事务 ID 去重）——「多 phase+中途崩溃」恢复协议悬空 | **成立**（v8 事务步骤未指明 pending 存放路径与发现顺序，推演成立） | P0-3(e) 增 run 级全局 journal：固定路径 pass-snapshots/invalidation.json（独立 kind pass_snapshot_invalidation），字段 tx_id/state/cause_phase/invalidated_phases/old_head_hashes/target_generations；resume 先恢复 journal 再读任何 head；事件携 tx_id 按 (tx_id,phase) 幂等；全部 head+事件完成才 commit；journal 入跨协议拒绝测试（三 kind 各自 invalid） |
| 2 | codex 八轮 P1 | P0-D.3 梯「agent_timeout > headless_interaction_required」与「timeout+仅 human blocker→求人」验收冲突；现有代码仅对旧 await_human_confirm 特判，新 human_only reason 会被归 agent_timeout；不得续留逐 reason 硬编码 | **成立**（梯注释 :4428 在案；冲突推演成立） | P0-4(b) 规则钉死：timed_out 且 fresh blockers 全 human_only → headless_interaction_required 族走求人；integrity/framework-bug 保持安全优先；其余 timeout→agent_timeout；registry 为唯一真值源；组合测试第一组同步修正 |

## Review-fix 九轮（2026-07-21，codex 九轮「1P0+1P1，修完即 Approve」——核实后修订 v10）

| # | 来源 | 意见 | 核实 | 处置 |
|---|------|------|------|------|
| 1 | codex 九轮 P0 | timeout+toolchain 仍绕过人工出口：八轮规则只救了 human_only，timed_out+toolchain_blocked 依旧落 agent_timeout 到不了③层——重试修不了环境，与 human_only 同性质空转 | **成立**（对照 v9 规则文本，toolchain 分支确实缺席） | P0-4(b) timeout 分流统一四步：integrity 安全终态→∃toolchain→await_operator_toolchain→全 human_only→interaction 族→其余 agent_timeout；验收补三组合（timeout+仅 toolchain / +toolchain+human / +toolchain+agent_fixable） |
| 2 | codex 九轮 P1 | 双 pending 语义残留：head 状态枚举仍含 invalidation_pending（与「pending 不挂单 phase head」矛盾）；验收仍写「tombstone 先行」与 journal 顺序冲突；缺 journal 不可验证时的 fail-closed | **成立**（对照 v9 正文 (c) 与验收原文，两处残留属实） | head 收敛为 active/superseded 两态（journal=唯一事务 pending SSOT）；验收改 journal pending→heads→events→commit 顺序；正文与验收各补「journal 无 HMAC/坏 MAC/不可验证→fail-closed halt，不得改 head」 |

## 终审（2026-07-21，codex 十轮）：**Approve，plan 达可实施状态**

九轮两项确认完整闭环（journal 协议 head 两态+唯一 pending SSOT+固定顺序+fail-closed；
timeout 四步分流含 toolchain 三组合、integrity 优先保持）。两条非阻断措辞提醒已写入正文：
① journal fail-closed 限 --resume/进程重启路径，同进程遵守内存 digest 信任模型（P0-3(e)）；
② 「不得打乱既有优先级梯」=保留基线+v10 actionability 例外，实施时同步更新 P0-D.3 旧注释
（P0-4(b)）。plan 定稿，等待用户开工授权；实施顺序 P0-0→P0-5→P1，硬前置（e9c4a7f3 提交
基线 653734e3）已满足。

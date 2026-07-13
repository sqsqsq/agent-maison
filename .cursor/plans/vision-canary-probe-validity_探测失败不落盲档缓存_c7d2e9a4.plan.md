---
name: vision-canary 缓存生命周期与探测有效性加固 — probe_version 迁移 + 严格判卷 + TTL
version: 3.0.0
# 版本说明：随当前 3.0.0 版本窗口，用户控版本不 bump。
# 立项动因：2026-07-12 宿主实锤事故(cursor 额度耗尽→假 none 永久缓存)；
# rev2：codex review 全盘采纳(6/6 成立)——初版只修"以后别写坏"，漏了"已写坏的自愈"、
# 把答卷收卷完整性错当 invocation 有效性、"本次 run 按 none 继续"与消费面实际回退行为不符。
# rev3：codex 二轮 2P1+1P2 全采纳——严格解析须产 canonical answer 再交 classify(否则
# 旧 classifier 首中解析+CANNOT_SEE 子串判会二次污染)；强刷失败改 stale-if-error(有
# fresh last-known-good 时沿用,不是回退声明)；补写盘边界测试(含 invokeFn 注入以免真 spawn)。
# rev4：codex 终审通过(无阻断)；文字修正=改动面 7 文件(LOCAL_VISION_CANARY_KEYS 实际
# 在 config-field-ownership.ts)+ 验收改 SSOT 命令 cd harness && npm test。
---

# vision-canary 缓存生命周期与探测有效性加固(rev4 定稿)

- **Plan ID**: c7d2e9a4
- **状态**: codex 终审通过,待用户开工令
- **改动面**: 中(7 个生产文件 + 文档 + 单测):vision-canary / goal-preflight /
  goal-runner / multimodal-probe / framework-local-config / config-field-ownership
  (LOCAL_VISION_CANARY_KEYS 在此,rev4 修正归属) / vision-canary-interactive

## 背景(实锤事故,2026-07-12)

宿主 goal run 期间 cursor headless 额度耗尽,金丝雀探测调用返回空 stdout →
`classifyCanaryResponse` 判 `none(空输出)` → `runVisionCanaryProbe` 无条件写入
`vision.canary`(probed_via=goal) → `isVisionCanaryFresh` 对 goal 来源永久采信。
净效果:一次额度抖动把真视觉 adapter 永久打成盲档,且用户升级 framework 后旧毒缓存
不会自愈(fresh 短路发生在写盘守卫之前),普通用户不知道要删 local.json。

## 核实过的事实基线(rev2 全部对码)

- `runVisionCanaryProbe`(goal-preflight.ts:316):任何 classify 结果都写缓存;仅
  invoke **抛异常**走 catch 不写。`invokeAgentHeadless` 结果携
  `exitCode/timed_out/silent_killed/skipped`(agent-invoke.ts:596-824),探测处全未消费。
- **prompt echo 双杀**:canary prompt 自身含全部 5 个答题键行(`TOP_LEFT_COLOR=<color>`…)
  与字面 `CANNOT_SEE_IMAGE`(vision-canary.ts:172-187)。CLI 回显 prompt 时:
  `isCanaryAnswerComplete` 判"完整"(只查 `KEY=` 出现),`classifyCanaryResponse` 因
  `/CANNOT_SEE_IMAGE/i` 子串命中直接判 none——初版方案的守卫会**放行**这份假 none。
- goal-runner.ts:1433-1434:`probeResult.ran` → 打印「已缓存至 framework.local.json」
  ——初版"ran:true 但不写盘"会让日志撒谎。
- resolveBaseImageInput(multimodal-probe.ts:165):无新鲜缓存 → 回退 **adapter 声明/
  heuristic**(非"按 none")——与 goal-runner:1423 头注"探测失败让主流程走既有 adapter
  声明路径"一致。初版"本次 run 按 none 保守继续"表述错误。
- `isVisionCanaryFresh`(multimodal-probe.ts:41)是三消费点唯一判据(注释明示单点)——
  版本/TTL 加在这里即全链传导;`isFreshInteractiveCanary` 独立,不受影响。
- 交互式判卷路径(grade-vision-canary + finalizeInteractiveCanary)有答卷文件握手+
  超时不写盘,对"空答卷"免疫;但其写盘同样无 probe_version,纳入 t1 迁移。

## 方案(五部分,codex rev2 结构)

### t1 缓存版本与迁移(自愈已中毒缓存,用户零操作升级)

- `vision-canary.ts` 导出 `VISION_CANARY_PROBE_VERSION = 2`(从 2 起——旧缓存
  无字段即视为 v1/stale);
- `framework-local-config.ts`:`FrameworkLocalConfigVisionCanary` 增可选
  `probe_version?: number` 与校验(正整数);`LOCAL_VISION_CANARY_KEYS` 在
  **config-field-ownership.ts:18**(rev4 修正归属),同步增键;
- 两个写盘点(goal `runVisionCanaryProbe` / 交互式 `finalizeInteractiveCanary`)
  写入当前版本;
- `isVisionCanaryFresh` 增判:`canary.probe_version !== VISION_CANARY_PROBE_VERSION`
  → false(缺失即不符)。旧缓存(含事故假 none)在下一次 UI goal 自动判 stale → 重探
  → 原位覆写。**用户无需删任何文件**。
- 边界声明:老版本 framework 读新 local 会因 rejectUnknownObjectKeys 拒新字段——
  升级单向,降级场景本就不承诺;runbook 记一句。

### t2 严格 probe validity(区分"没作答"与"答了")

`vision-canary.ts` 新增纯函数(供 goal 路径消费;交互式收卷判据不动):

```
resolveCanaryCacheDecision(invocation: {
  stdout; exitCode; timed_out?; silent_killed?; skipped?;
}, answerKey?) →
  | { kind: 'invoke_failed';  cache: false; detail }   // 非零退出/超时/被杀/skipped
  | { kind: 'invalid_answer'; cache: false; detail }   // 调用成功但非有效答卷
  | { kind: 'valid';          cache: true;  classify } // 有效答卷 → classify 定 verdict
```

有效答卷判据(防 prompt echo,较 isCanaryAnswerComplete 严格):

- `CANNOT_SEE_IMAGE` 须**独立成行**(`^\s*CANNOT_SEE_IMAGE\s*$` 多行)——prompt echo
  行有前缀文字("reply with EXACTLY: …")不整行匹配;
- 答题行逐键取**最后一次**赋值(echo 在前、真答卷在后),值须非空且不含 `<`/`>`
  (排除占位符 `<color>` 回显);
- 合法答题行与独立行 CANNOT_SEE 并存 → 按答题行判(答了题就不算声明盲);
- 两者皆无 → invalid_answer。

**canonical answer 重组(rev3,codex P1)**:valid 时**不得把原始 stdout 交给
classifyCanaryResponse**——旧 classifier 是首中解析(parseAnswerLine `match` 取第一处,
vision-canary.ts:202)+ CANNOT_SEE 全文子串判(:237),echo+尾部真答卷会被二次污染判 none。
严格解析产出 canonical answer 文本(仅含逐键**最终**赋值行,或单独一行 CANNOT_SEE_IMAGE),
classify 消费 canonical;`externalToolSuspected` 仍从**原始 stdout** 提取后并入结果
(规范化不丢诊断信号)。classifier 本体不动(消费面/交互式零影响)。

### t3 三态结果与 runner 日志(消费语义显式化)

- `runVisionCanaryProbe` 返回增 `outcome: 'valid_cached' | 'invalid_not_cached' |
  'invoke_failed_not_cached'`;仅 valid 写盘;为单测可覆盖写盘边界,增可选
  `invokeFn` 注入(默认 invokeAgentHeadless,单测传 fake 免真 spawn);
- **失败语义 = stale-if-error(rev3,codex P1)**:探测无效/调用失败时消费面实际走什么,
  取决于盘上有没有 fresh 缓存(resolveBaseImageInput:182 只认盘)——日志必须与之一致:
  - **强刷(--refresh-vision-probe)失败 + 盘上有当前版本 fresh 缓存**:不写盘即自然
    保留 last-known-good,消费面继续用旧缓存——日志「强刷失败(detail),沿用既有实测
    缓存(probed_at=…,verdict=…)」;绝不因刷新失败丢弃仍有效的正向证据;
  - **无缓存/缓存已 stale + 探测失败**:日志「探测无效/调用失败(detail),未缓存——
    本次 run 回退 adapter 声明路径,下次 run 自动重探」;
  - goal-runner 在 invalid/invoke_failed 分支用 isVisionCanaryFresh 现查盘上缓存,
    二分日志;valid 分支维持现文案。
- **本次 run 语义(显式选择,rev2 保留)**:不引入 transient verdict 跨进程传递——
  探测无效是罕见态,为它新建 runner→phase 通路(local.json 之外)收益不成比例;
  codex 初轮推荐的"临时按 none"作为备选记录,若后续实战出现"声明路径被套壳骗过且
  探测恰好无效"的组合再升级。

### t4 TTL(负结论短、正结论长,拒绝永久)

`isVisionCanaryFresh` 的 goal 来源不再永久:

- `none` / `ocr_capable`:24h(新常数 `VISION_CANARY_NEGATIVE_TTL_MS`,与
  interactive TTL 同值不同名——语义独立,重探成本仅一次 headless 调用);
- `tool_read`:7d(`VISION_CANARY_POSITIVE_TTL_MS`——CLI 模型路由/账号权限会静默变,
  永久采信不成立;每周一次重探成本可忽略);
- interactive 来源维持现 24h 不变;
- 非目标:adapter capability/config fingerprint 绑定(可选后续,probe_version 已兜
  协议升级,TTL 兜环境漂移)。

### t5 用户侧升级体验(文档)

- `docs/operations/goal-mode-runbook.md` 补段:local.json 升级模型(保留文件、
  canary 自动失效重探)、`--refresh-vision-probe` 强制重探入口文档化、
  「模型/账号变更后建议强制重探」提示;
- goal-mode SKILL 的自然语言入口提一句"强制刷新视觉探测"映射到该 flag。

## 测试(t6)

- vision-canary 单测扩展 `resolveCanaryCacheDecision`:空输出/额度错误文本/残卷/
  **prompt echo 全文**(含键行+CANNOT_SEE 字面→invalid)/独立行 CANNOT_SEE(→valid none)/
  全错答卷(→valid none)/全对(→valid tool_read)/**echo+尾部真答卷→最终 verdict 必须
  =tool_read**(rev3:断言穿透 classify,不止 decision=valid——防 canonical 重组缺位)/
  非零 exitCode/timed_out/silent_killed/skipped(→invoke_failed)/
  externalToolSuspected 从原始 stdout 提取(canonical 化不丢);
- **写盘边界(rev3,codex P2——事故真正发生地)**:`runVisionCanaryProbe` 注入 fake
  invokeFn——invalid/invoke_failed 确不写盘且原 local 全字段无损(agent_adapter/
  toolchain/image_input_override 原样);valid 写入含 probe_version 且同样保留其余字段;
  `finalizeInteractiveCanary` 写盘带当前 probe_version;
- probe_version schema 校验:正整数过;0/负数/小数/字符串拒;
- multimodal-probe 单测扩展:无 probe_version 旧缓存→stale;版本不符→stale;
  none 超 24h→stale;tool_read 超 7d→stale;tool_read 7d 内→fresh;
  interactive 语义回归不变;
- stale-if-error:fresh 缓存在场 + 强刷失败 → 缓存原样保留、消费面仍 fresh 采信,
  runner 日志走"沿用 last-known-good"分支;
- 旧缓存自愈 e2e(decideVisionCanaryProbe):毒 none(无版本)在场 → action=probe;
- 全量验收(SSOT 命令,rev4):`cd harness && npm test`(= typecheck + unit +
  fixtures,仓库 BLOCKER 口径)。
- OpenSpec:canary 生命周期契约暂不开独立 change(plan 与 OpenSpec 并存合规,
  codex 终审确认非阻断);后续如需长期归档再补 delta spec。

## todos

- [x] t1 probe_version:常数/schema/两写盘点/fresh 判据 + 迁移语义
- [x] t2 resolveCanaryCacheDecision 严格判卷(防 prompt echo/占位符/子串误判)
- [x] t3 三态 outcome + goal-runner 日志三分支(不撒谎)
- [x] t4 TTL:负 24h / 正 7d,interactive 不变
- [x] t5 runbook + SKILL 文档(升级体验/强制重探入口)
- [x] t6 单测全套 + tsc/unit/fixtures 三绿

## 实施记录(2026-07-13,rev4 落地)

**落点**:t1 `VISION_CANARY_PROBE_VERSION=2`(vision-canary.ts,头注含事故背景)、
schema 校验(framework-local-config.ts,正整数,0/负/小数/字符串拒)、键集
(config-field-ownership.ts LOCAL_VISION_CANARY_KEYS)、两写盘点带版本
(goal-preflight runVisionCanaryProbe / vision-canary-interactive finalizeInteractiveCanary);
t2 `resolveCanaryCacheDecision`(vision-canary.ts:invoke 事实先行→严格解析
[逐键最后一次**合法**赋值,占位符 <>/空值不算;CANNOT_SEE 独立成行]→canonical
重组交 classify,externalToolSuspected 从原始 stdout 提取回填);
t3 三态 outcome + `invokeFn` 注入(goal-preflight)、goal-runner 日志三分支
(valid 现文案 / 失败时现查盘上缓存二分:lkg 沿用 vs 回退声明);
t4 `isVisionCanaryFresh` 版本判据+TTL 分层(multimodal-probe.ts:goal tool_read 7d /
none·ocr 24h / interactive 24h 不变);t5 runbook 新段+goal-mode SKILL 一句。

**偏差(如实)**:
1. `isFreshInteractiveCanary` 经委托自动获得版本判据(plan 未显式列)——协议升级后
   交互式旧缓存同样重测,单测已断言;
2. lastLegalAssignment 语义取"最后一次**合法**赋值"而非"最后一次赋值再验合法"
   ——agent 先答题后被回显尾随的奇序场景取到真答卷,更鲁棒;
3. 既有测试语义随新契约更新 7 处(multimodal-probe 4 夹具+I2 用例重写、
   goal-preflight 3 用例、vision-canary-interactive CLI SKIP 夹具、
   visual-fidelity OCR OR 夹具)——全部是"依赖旧永久采信/无版本语义"的夹具,
   与 correction-check 夹具依赖 statefilePath bug 同类,借本次一并去依赖。

**验证**:`cd harness && npm test` 三绿——tsc 干净、unit 1863/1863(+16 新用例:
resolveCanaryCacheDecision 10 + 写盘边界 4[空输出/额度文本×字段无损、四类 invoke
失败、valid 写版本、echo 穿透 verdict=tool_read] + fresh 版本/TTL 矩阵 2)、fixtures 44/44。

### rev5 review-fix(codex 2P2+1P3+测试缺口,全部核实成立并修复)

- **P2 未来时间戳绕 TTL**:isVisionCanaryFresh 拒绝 age < -5min(新常数
  VISION_CANARY_CLOCK_SKEW_TOLERANCE_MS 容忍小时钟偏差);测试:未来+1d(goal/
  interactive)拒、+1min 容忍;
- **P2 异常绕 stale-if-error**:runVisionCanaryProbe catch 改归
  `invoke_failed_not_cached`(ran:true)——runner 的 LKG 二分日志自动覆盖;
  ran:false 仅保留给"没试跑"(无 goal_capability);测试:invokeFn 抛异常 →
  invoke_failed + fresh LKG 缓存 deepEqual 无损;
- **P3 stale 归因**:isStaleInteractiveCanary 收紧为**仅真 TTL 超龄**(版本不符=
  protocol_stale、坏时间戳=invalid_timestamp,均不打"已超 24h" advisory);测试:
  版本不符的近期 interactive 缓存回退声明但不标 stale、reason 无超龄字样;
- **测试缺口**:补 probe_version schema 负例(0/-1/1.5/'2' 拒,正整数 roundtrip,
  缺省合法)——plan 曾承诺未落,如实补上。

**rev5 验证**:`cd harness && npm test` 三绿——unit 1867/1867(+4)、fixtures 44/44。
**未 commit——等用户 review。**

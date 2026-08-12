---
name: 真机归因精度 — 谓词保真 / 元素状态判据 / 锚点↔spec node 规范化 / 视觉回归解锁
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户 2026-07-30 决定在 3.0.0 修——它是 d9e4b7c1 的
# 直接后继，且不修则全部视觉类宿主回归永久悬空）。
overview: >
  2026-07-29 宿主回归（run 20260729T123155Z-0c5411，真机 3UJ0225321000395）暴露一条链：
  testing 三次 attempt 全部卡在 device_test_run（5 用例失败），视觉采集/critic 从未触达
  （device-screenshots 空、无 visual-diff.json）——**这单点阻断 11 项视觉类宿主回归**
  （blind-visual 4.6/9.4、visual-capability-truth 2.9/6.5/6.6/8.3、layout-oracle t11 与
  geometry-gates 6.3、a9d4c7e2 P0-B/P1-G、c4e8b1d3 todo 5、critic f7a3d9c2 t9 与 6.4）。
  **根因经多轮纠错后定稿**（旧版定性与落地判据均被自查/codex/claude 审视纠正，见文末
  "判读纠错记录"）：
  ① d9e4b7c1 的派生步骤解析**丢弃谓词字段**——派生计划写的是
  `{"wait_for":{"by_id":"maison:...:sheet_scaffold-next","enabled":true,...}}`，解析后只留
  selector/scope，`enabled:true` 被丢掉，分类器根本不知道测试在等什么；② 分类器只做
  "selector 字面 ∈ ui-spec id/text 集"比对，**完全不看 dump 里元素的实际状态**——真机上
  TC-006/007 的失败步骤确实要求该 selector `enabled=true`；同 attempt 的 TC-010/011 帧证明
  该元素**存在但 `enabled=false`**，属产品侧缺陷（2026-07-30 人工采证已定性），却被判
  test_contract（测试自造）不回 coding。**⚠ 此处有个陷阱**：该元素只在**部分帧**在场
  （TC-010/011 的帧在、TC-006/007 自己的失败帧被裁剪不在），所以"元素在不在"必须扫描
  **同 attempt 当前 trace 引用的全部 failure dump**——不能按失败 selector 推导出的
  expected_screen 预分组，否则无 spec 依据的 case 恰好会把唯一在场帧排除；单帧判则会把它
  误判成"产品缺元素"（人工第二轮的错）。
  详见 p0b 的“证据池先行”判据与 fixture README 映射表；③ runtime 锚点的 semantic 段与 ui-spec node 无
  映射校验——产品渲染 `sheet_scaffold-next`（ui-kit 脚手架命名），ui-spec 声明
  `sms_next_btn`，二者无规范化函数可互认，字面比对必然落空。
todos:
  - id: p0a-predicate-fidelity
    content: >
      P0-A 谓词保真（整条误判链的起点）。现状：`parseDerivedPlanSteps`
      （device-test-evidence.ts）只提取 action/selectorKind/selector/scope，**丢弃
      `enabled`/`within`/`timeout` 等谓词**。实锤：派生计划 TC-006/007 的失败步骤是
      `{"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next",
      "enabled":true,"timeout":15}}`——测试在等元素变可用，而 evidence 里只剩 selector，
      归因阶段无从判断“失败是因为元素不存在，还是存在但谓词不满足”。
      **落地**：DerivedPlanStep 保留 action body 的完整原始对象（含未知字段，解析层只做
      JSON 结构校验、不提前解释或扁平化）；selectorKind/selector 可作为索引派生字段，但
      `failing_step` 必须同时承载完整 `predicate`/`payload`。shared schema、collector 类型与
      evidence 版本同步更新，确保 `enabled`、对象形态的 `within`、`scope`、`timeout` 原样
      round-trip。单测直接读取宿主 fixture，断言 enabled×4 / within×2 / scope×5 /
      timeout×21 均未丢失，并覆盖未知谓词字段不被静默删除。
    status: completed
  - id: p0b-element-state-classification
    content: >
      P0-B 归因加入“元素实际状态”判据（治 test_contract 吞掉产品/契约问题）。现状分类只问
      “selector 字面在不在 ui-spec”，命不中即 test_contract 且追问终止。
      **证据池先行（F1，MUST）**：先按当前 trace 的 `failure_artifacts` 严格 join 构造
      **同 attempt 证据池**——只纳入本 trace 引用且可读的全部 failure dump，按路径/内容
      去重，禁止扫描 failure_dir 历史残留；任何 expected_screen/spec 归属推导都在证据池
      建成之后。目标“缺失”= selector 在证据池内零精确命中，**禁止先按失败 selector 推导的
      expected_screen 分组**，否则 TC-010/011 这种无 spec 依据的 case 会把唯一 disabled
      帧排除。完整 maison 锚点以自带 feature/screen 约束命中；裸 id/text 只有在 ui-spec
      唯一归屏且 dump 命中该屏 identity 时才算相关，否则 unknown。
      **谓词可观测性分层（MUST）**：p0a 负责完整保真，但状态分类只消费 dump 可观测
      状态字段白名单：`enabled/visible/clickable/checked/selected/focused`；`timeout`、
      `scope`、`within`、`index` 及 selector 字段属于定位/控制语义，保留在 evidence 并用于
      相关性/诊断，但不参与 product_state 的状态真假合取，也不得因其无法从单帧观测就把
      可判定的状态证据降为 unknown。新增状态字段必须先证明 dump 有稳定同名属性并补 fixture，
      禁止默认把任意 payload 字段当状态谓词。
      **主分类顺序固定为“状态证据 > 规范化/漂移 > 缺失”**：
      (1) 至少一帧精确命中 selector，至少存在一个可观测状态谓词，且所有相关命中对该状态
          谓词均不满足（如期望 enabled=true、实际均 false）→ **product_state**；
          instructions 写“期望状态谓词 vs dump 实际属性”。若任一相关帧满足全部可观测状态
          谓词、另有帧不满足，或失败步骤根本没有可观测状态谓词，则 unknown
          （scope/时序/级联），不得武断归产品。
      (2) 证据池零命中，经 p0c 规范化后 spec node 在 ui-spec 声明，且失败 dump 命中该屏
          其他 identity 锚点 → **product_actionable**（产品缺元素）；expected-screen 前置
          守卫仍保留，但只用于确认错屏/级联，不能用于缩窄证据池。
      (3) 证据池零命中，合法 maison 锚点却无法反解到 ui-spec node →
          **scaffold_contract_drift**；其余无 spec 依据才是 **test_contract**。
      **双命中裁决（F3）**：若元素状态已支持 product_state、同时锚点规范化命中 drift，
      主分类只报 product_state，drift 作为结构化 `diagnostics[]`/reason 附注，禁止同一 case
      双发回修。`target_kind=physical` 时 product_state 与 scaffold_contract_drift 都加入
      coding 回退白名单（与 product_actionable 同级）；非 physical 仍只进 unverified。
      evidence 必须输出命中 dump/case/step、节点 id/enabled/text 与谓词对照摘要，让人无需
      翻原始 dump。fixture 断言：TC-006/007 跨帧归 product_state 且带 drift 附注；
      clipped 帧不得 product_actionable；TC-010/011 仍按“查看全部”判 test_contract。
    status: completed
  - id: p0c-anchor-spec-node-normalization
    content: >
      P0-C runtime 锚点 ↔ ui-spec node 唯一规范化函数（治字面比对必然落空）。实证：
      `...:sms_verify:sheet_scaffold-next` 取 block semantic_node + 宿主手写 `-next`，
      ui-spec 声明 `sms_next_btn`；`...:sms_verify:sms_input` 则直接取 ui-spec node id。
      两种写法都曾被 framework 文档暗示为合法，责任在契约歧义。
      **裁决 1·第三参真值**：`semanticNodeId` MUST = **ui-spec node id**；blocks.json 的
      `semantic_node` 仅是 block 类型/适配标识，不进实例锚点。一个 scaffold 的 slot 可承载
      多个 spec node，故禁止用 block semantic_node 猜 slot→node 映射，也不新增启发式别名表。
      **裁决 2·唯一语法**：canonical base anchor =
      `maison:<feature>:<screen>:<specNode>[:<instanceKey>]`。单实例 MUST 用 4 段；同屏重复实例
      为保证唯一性 MUST 用 5 段。`buildInstanceAnchor` 的 instanceKey 改为可选，`parseAnchor`
      返回 `instanceKey?`。**校验分层**：单看字符串无法知道屏上实例基数，故
      `isValidAnchor`/`parseAnchor` 只做语法层校验并接受合法 4/5 段；“单实例必须 4 段、
      重复实例必须 5 段”由带 ui-spec screen/node 实例上下文的 conformance 校验执行。
      禁止让 `isValidAnchor` 猜基数，也禁止只做语法校验便宣称基数契约满足。真机 ArkTS
      不会调用 harness TS，故生成侧落点是 blocks.json/ui-kit 文档、模板与宿主调用示例，
      TS helper 负责镜像并供 harness 消费。
      **裁决 3·子件后缀 SSOT（F2）**：required_children 是结构名，**不是 runtime id 后缀**。
      在 blocks.json 增加显式机读 `anchor_suffixes` / `anchor_suffix_patterns`（命名实现时可定，
      语义不可变），并以静态 conformance 校验其与各 `.ets .id()` 完全一致。当前全量固定后缀：
      `-header/-close/-content/-primary-action/-input/-countdown/-icon/-label/-chevron/
      -title/-hint/-action/-back`；动态规则仅 `-option-${key}`。`-next` 是宿主手写尾巴，
      **不得**列入 ui-kit 后缀。反解从右向左按**最长终端匹配**逐级剥离并保留有序
      `suffixChain`（`-primary-action` 优先于 `-action`；`-option-${key}` 整段匹配），每步
      都重新比对；禁止一次性 split `-` 或按 required_children 猜。
      **单一规范化函数**：输入 runtime anchor 或裸 id，输出
      `{feature?, screen?, specNode?, instanceKey?, suffixChain, validity, driftReason?}`，
      4 段时后缀链附着在 specNode 段，5 段时附着在 instanceKey 段；归因、派生校验/查询与
      conformance 共用，禁止复制解析。剥离后 specNode 对不上 ui-spec →
      scaffold_contract_drift；例如 `sheet_scaffold-next-label` 只可剥合法 `-label`，
      剩余 `sheet_scaffold-next` 仍不能伪映射成 `sms_next_btn`。
      `isValidAnchor`/`parseAnchor` 必须由 p0b 与 p0d 的生产路径实际消费；单测分开覆盖
      “语法层 4/5 段均可解析”与“context conformance 拒绝单实例 5 段/重复实例 4 段”，并覆盖
      最长匹配、多级后缀、动态 option、段内天然含 `-`、非法 `-next` 与超长实例。
    status: completed
  - id: p0d-selector-source-contract
    content: >
      P0-D selector 来源契约 + 派生可查（治“测试从 dump 抄到错误实现”）。现有
      device-testing SKILL:59 与 workflow detail 4.5.2 明文按
      contracts/plan/snapshot-cache/设备连线四级优先级发现 selector；profile addendum 还引导
      dump-ui 后回写。问题不是少一句建议，而是第 3/4 级允许 runtime 实现反向成为真值。
      **落地**：同步修改 `skills/feature/device-testing/SKILL.md`、
      `skills/reference/device-testing-workflow-detail.md` 与 hmos profile addendum：
      四级来源只负责“发现候选”，任何来源都不得绕过 spec 校验；尤其 snapshot-cache/真机 dump
      发现的 by_id，结果 MUST 经 p0c 反解到当前 feature/screen 的 ui-spec node，无法反解就
      回上游补 ui-spec/anchor 注入或显式 skip，禁止原样抄入派生计划；by_text MUST 与 ui-spec
      text 精确等值。增加既有 harness 脚本的只读查询：ui-spec node → canonical 4 段 base
      anchor + 适用 block 的后缀/重复实例要求，并让派生计划 lint 共用同一 normalizer。
      门禁首版 WARN 不 BLOCKER（避免存量一次性全死），落结构化 rule id/计数，观察一轮真机后
      再单独裁决升档；TC-005 的 `next_step_btn` 虽真机通过但不在 ui-spec，必须作为 WARN
      正例锁住，证明“跑过”不等于 selector 有契约依据。
    status: completed
  - id: p1e-unverified-no-progress-breaker
    content: >
      P1-E unverified 无进展熔断（治白烧真机时间）。testing i3/i4/i5 的
      unverifiable_must_fix 连续三轮相同 5 条，而现有 roundFingerprint 只覆盖
      ActionableDefect。
      **落地**：unverified entry 增加由 collector/source 生成的稳定 `fingerprint` 与
      `reason_code`；device 取
      `source|case|classification|step-index|selector-kind|selector|reason-code`，visual 取
      稳定 screen/证据身份/reason-code。禁止把自由文案 reason、绝对/时间戳路径、计数或
      本轮序号入指纹。将 `roundFingerprintOf` 的参数类型泛化为
      `readonly { fingerprint: string }[]`，哈希算法与排序不变，actionable/unverified 共用，
      禁另造哈希函数。
      **连续语义**：首轮 unverified-only 记录 fingerprint 并 retry；下一相邻轮同 phase、
      同集合才提前 halt。{A,B}→{B} 允许重试，A→B→A 也不算“连续相同”；resume 从最近的
      `unverifiable_must_fix` 事件恢复相邻基线，不用 seen-set 做“历史曾出现即熔断”。
      `unverifiable_must_fix` 与对应 `phase_halt` 事件都写完整 `round_fingerprint`；
      halt_reason 继续用既有 `unverifiable_must_fix`，另写
      `halt_trigger=fingerprint_repeat|retry_budget_exhausted` 区分审计原因，不新增终止态。
      单测覆盖 A→A、{A,B}→{B}、A→B→A、resume 后相邻 A→A 与自由 reason 文案变化但稳定字段
      不变仍能命中。
    status: completed
  - id: p2f-retry-guidance-actionable
    content: >
      P2-F 回喂指引可执行化并补齐消费闭环。product_state 给“期望谓词 vs dump 实际属性”；
      product_actionable 给“ui-spec 要求该屏含 <node>，整个 attempt 证据池无精确形态”；
      scaffold_contract_drift 给“runtime semantic=<x> 无法反解为 spec node，并给 canonical
      anchor 形态”；test_contract 给“该屏可用 node/text 列表”；unknown 给冲突帧/不可观测
      谓词摘要。文案同时进入 actionable instructions / unverified entries 与 priorFailure
      （后者才是真正回喂 agent 的通道），不得只改 evidence 人读 reason。
      `target_kind=physical` 下 product_state、product_actionable、scaffold_contract_drift
      三类都形成稳定 ActionableDefect 并回 coding；非 physical 或证据绑定不可信仍进
      unverified。黄金样本的 product_state + drift 附注只生成一条 defect，避免重复回修。
    status: completed
  - id: t7-host-regression-unlock
    content: >
      T7 先 fixture、后宿主回归，解锁 11 项视觉未完项。
      **(a) framework fixture/单测硬验收**：
      · p0a：宿主派生计划全部谓词 round-trip；
      · p0b：TC-006/007 虽同时携带 `timeout:15`，仍以可观测 `enabled:true` 的同 attempt
        跨帧证据归 product_state（主分类）并带 drift 附注，证明控制字段不污染状态判定；
        clipped 单帧绝不得 product_actionable；TC-010/011 的失败 selector 是 `by_text 查看全部`
        + within，仍判 test_contract/级联上下文，**不得**再写成 product_state；
      · p0c：另造“证据池零命中 + 合法 maison 锚点反解失败”样本单独断言
        scaffold_contract_drift，避免黄金样本的 product_state 优先级掩盖该分支；4/5 段与
        全量/动态/多级后缀契约全覆盖；
      · p1e：相邻同组 unverified 第二轮即熔断，事件含 round_fingerprint/halt_trigger。
      **(b) 宿主真机验收**：发布到已重写宿主跑一次完整 run。不得假定旧失败复现；实际出现
      “元素在、谓词稳定不满足”→ product_state，“spec 有声明、整个证据池无形态且在预期屏”
      → product_actionable，“零命中且合法 anchor 无法反解”→ scaffold_contract_drift，
      “selector 无 spec 依据”→ test_contract；一种都没出现也通过，以单测锁分支。
      主链须走过 device_test_run 进入视觉采集，`visual-diff.json` 与
      `device-screenshots` 非空，再按 11 个 change 原验收清单回灌。未校准 attestation 时
      run 终态被 a7 封顶 PARTIAL 属预期，验收看事件/产物而非终态。
      宿主产品代码 2026-07-30 已决定全部回退重写，不单修 DEF-001/002；历史 fixture 是唯一
      可复现黄金样本，必须在宿主回归前落单测。
      【2026-08-12 收口】(b) 宿主真机已执行：新 build `ea97ac522049` 强装、7/7 P0 屏
      navigation+identity 通过、8 屏截图与布局树均 `layout_dump_status=captured`、
      `visual-diff.json` 与 `device-screenshots` 非空——**主链确实走过 device_test_run
      进入视觉采集**，t7(b) 的链路前提达成。
      归因四态**正式出口本轮未执行**，因此不适用「一种都没出现也通过」条款：
      `device-test-evidence.json` 的写入门槛是 `MAISON_GOAL_GATE_HARNESS==='1'`（goal 正式
      testing gate 专属标记）+ goal run/attempt 身份完整 + **本轮真实安装成功**
      （`installExecuted && installOk`，注释明写「installPassed 合并了 reuse 不作数」）+
      本轮 trace 在盘（[check-testing.ts](harness/scripts/check-testing.ts) d9e4b7c1 T2 段）。
      宿主本轮**执行了真实 hdc install**（`device_test_install` 详情为「已安装: …」，
      非「复用装机（跳过 hdc install）」分支，即 `installExecuted=true`；
      `device_test_build` 复用已有 HAP、跳过 hvigor 属另一回事，writer 判的是安装是否执行，
      见 [check-testing.ts:1974](harness/scripts/check-testing.ts:1974)
      `installExecuted = res.executed === true && res.reused !== true`）。
      **真正未满足的门槛是 `MAISON_GOAL_GATE_HARNESS==='1'` 与 goal run/attempt 身份**——
      本轮为普通 `harness-runner.ts --phase testing`，故正式出口未启用；宿主目录
      **不存在** `device-test-evidence.json`——即分类器根本没运行，**不是运行后零命中**。
      （此前一版写「HAP 为复用安装」，把 build 复用与 install 复用混为一谈，属误判。）
      诚实边界（禁止升格）：`p0_semantic_coverage_integrity` 报的「步序合规但 trace 非通过」
      不是四态归因产物，**不得记作 product_state 实证**。
      关闭条件：须经 **goal 正式 gate** 跑一次（`MAISON_GOAL_GATE_HARNESS=1` + 真实安装非
      reuse），产出 `device-test-evidence.json` 后，才能按零命中条款判完成。
    status: in_progress
isProject: false
---

# 真机归因精度 (e3c7d95f)

状态：**6/7 todo 完成，t7 in_progress** —— v4 根因与落地判据经六轮审视定稿后 t1–t6 实施完毕。
t7 于 2026-08-12 完成 (b) 的**真机采集链前提验证**（主链进 device_test_run 与视觉采集、产物非空），
但归因四态的**正式出口未执行**（需 goal 正式 gate + 真实安装），故 t7 保持未完成。
原「v4 待实施」标记为定稿期遗留，已更正。

## 判读纠错记录（本 plan 的核心价值之一，禁删）

同一批真机数据与落地判据先后经历六轮审视，前几轮的错因比结论更值得留：

| 轮次 | 我的定性 | 证伪方式 | 错因 |
|---|---|---|---|
| 一 | "5 条 test_contract 全部正确，拦住 5 个假阳性" | 自查：只核了"selector 不在 spec"，没核"spec 锚点本身在不在真机" | **只验一半判据就下结论** |
| 二 | "产品缺 sms_next_btn，真缺陷被 test_contract 掩盖" | codex 审视：TC-010/011 的 dump 里该按钮**存在**，`enabled=false` | **以单帧 dump（TC-006）推全局**——那一帧是键盘展开/Sheet 被裁剪的树 |
| 三 | 谓词丢弃 + 不看元素状态 + **锚点"脚手架命名漂移"** | 自查 blocks.json：`semantic_node` 是 block 自身字段，产品用它有据可依 | **把 framework 的契约歧义归咎于产品** |
| 四 | 谓词丢弃 + 不看元素状态 + **buildInstanceAnchor 第三参语义从未定死** | 落 fixture 时逐条核 dump 文件名步骤索引 vs 派生计划：**证据 B 的 case 挂错了** | **拿"某帧有该元素"去支持"该 case 应判 product_state"，没核那个 case 的失败 selector 是不是它** |
| 五 | 三环不变，但 **p0b 的判据必须跨 case 取证**——单帧判会在 TC-006 帧上复现第二轮的错 | fixture 对账 | **纪律写了“跨 case”，落地却仍按单帧/expected_screen 分组** |
| 六（本版） | 三环不变；证据池改为同 attempt 当前 trace 的全部 failure dump；后缀来源与分类优先级定死 | claude review + 代码复核 | **expected_screen 预分组会漏唯一在场帧；required_children 不是 runtime 后缀 SSOT；双命中未定优先级** |

**沉淀的方法纪律**：真机失败归因必须"三查"——① 测试要什么（完整谓词，不只 selector）；
② dump 里有没有（先扫**同 attempt 当前 trace 引用的全部 failure dump**，不能单帧推全局，
也不能先按 expected_screen 分组）；③ spec 要求什么。
缺任一查都会得出方向性错误的结论，而错误结论会让 coding 改错地方。

**第五轮补的一条（比"三查"更基础）**：**每条证据都要标清它支持的是哪个 case 的哪一步**。
前四轮我把"帧里有什么"和"这个 case 在等什么"混着用，于是同一份正确的原始数据推出了错误
结论。纪律：引用 dump 前先答"这一帧是哪个 case 的第几步失败时抓的、那一步的 selector 是
什么"——fixture README 的映射表就是为此存在。

**另一条（写给实现者）**：纪律写进文档 ≠ 判据体现纪律。"跨 case 取证"这句话在本 plan
第一版就有，但 p0b 的落地条件先是单帧、后又收窄为同 expected_screen——两者都会漏证。
**文档与判据不一致时，跑起来的是判据**。

## 实证链（run 20260729T123155Z-0c5411，可复查）

### 1. 阻断事实
testing 三次 attempt（12:56→13:29 / 13:29→14:25 / 14:25→15:06）全在 `device_test_run`
判 FAIL；`device-screenshots/` 空、无 `visual-diff.json`。视觉采集在 run **之后**，整条
视觉链（capture → visual-diff → critic → locator → golden）从未执行。

### 2. 误判链三环（全部实锤）

**环一·谓词被丢**：派生计划步骤原文
`{"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next","enabled":true,"timeout":15}}`；
`parseDerivedPlanSteps` 只提取 selector/scope → evidence 里 `enabled:true` 不见了。

**环二·不看元素状态**：TC-006-step-5 / TC-007-step-17 的失败 selector 要求
`maison:bc-opencard:sms_verify:sheet_scaffold-next enabled=true`，但它们自己的 clipped
失败帧看不到该元素；同 attempt 的 TC-010-step-2 / TC-011-step-0 帧则证明该元素
**存在且 `enabled=false`**（同屏 `sms_input`/`-input`/`-countdown` 均 enabled=true）。
现分类器既丢谓词，又只看 case-local dump，于是把 TC-006/007 判成“测试自造 selector”；
正确性质只有把失败步骤与跨帧状态证据联结后才成立。

**环三·锚点契约歧义**：`buildInstanceAnchor` 第三参 `semanticNodeId` 语义未定死，真机
两个锚点各用一种来源——`sheet_scaffold-next` 取 **block semantic_node**（blocks.json 实证
`MaisonBottomSheetScaffold.semantic_node="sheet_scaffold"`），`sms_input` 取 **ui-spec node
id**。两种写法都"有据可依"，字面比对必然落空。**责任在 framework 契约，不在产品。**附带：`isValidAnchor` 要求五段而真机全四段
（+`-suffix` 子件），且该函数在生产代码**零消费**（"契约存在但无人执行"）。

### 3. 定性纠正（重要，勿再写错）
`maison:` 前缀**不是**产品乱来——它是 framework 自己的 ui-kit 实例语义锚点
（[ui-kit-anchors.ts](profiles/hmos-app/harness/ui-kit-anchors.ts)：
`maison:<feature>:<screen_id>:<semantic_node_id>:<instance_key>`，为解决 ArkUI 运行时
uitree 展开导致组件名不可靠 + 重复行 id 不唯一而设计）。产品渲染锚点是**正确行为**；
问题在 semantic 段与 spec node 的对齐，以及归因侧不会反解锚点。

## DEF-001/002 性质：已判定为产品缺陷（2026-07-30 人工验证）

`sheet_scaffold-next` 为何 disabled，两种可能，**不能现在就让 coding 改产品迎合工具**：

- (a) **Hylyre input 契约问题**：input 改了 TextInput 显示值但未可靠触发 ArkUI `onChange`
  → 父组件 `@State smsCode` 未更新 → 按钮维持 disabled。宿主源码的数据流是正常声明的
  （`onChange → onCodeChange → this.smsCode`）。
- (b) **产品双向绑定 bug**。

**实测结论（2026-07-30）**：真机软键盘**手动**输入 123456 后，"下一步"**仍不可点击**
（后续 B/C/D 观察点因此无法进行，属必然）。真机软键盘走的是完全正常的 ArkUI 输入路径，
它都没能让按钮启用 ⇒ **排除 (a) Hylyre 工具契约问题，确认 (b) 产品侧缺陷**（`@State
smsCode` 未随输入更新，或按钮 enabled 判据本身有问题——声明的
`onChange → onCodeChange → this.smsCode` 链路实际未生效）。

**对本 plan 的意义**：这反证了 d9 的 `test_contract` 判定**确实掩盖了一个真产品缺陷**，
p0b 的 `product_state` 分类因此**可以正当回 coding**（原先为 DEF 未定性而预留的"工具侧
不回退"分支按实证删除，设计更简）。

**宿主处置（2026-07-30 用户决定）**：产品代码**全部回退重写**，不单修此缺陷。于是本缺陷的
价值从"待修项"转为"**归因逻辑的黄金样本**"——它是一个已确证性质（产品侧）、有完整 dump
证据、形态清晰（元素在 + enabled=false + 谓词要求 enabled:true）的真实案例。**必须
fixture 化**：重写后的产品大概率不再产生同形态失败，本轮 dump 是唯一样本。

## 与 d9e4b7c1 的关系

d9 的交付**本身工作正常**（生成物分类零误伤、evidence 链齐备、physical-only 白名单生效、
强装生效），本 plan 是它的**归因精度**后继：d9 让"真机缺陷能进回修环"这条路通了，本 plan
保证"走上这条路的是对的缺陷、且分类能分清缺元素/状态不对/脚手架漂移/测试自造四种性质"。
d9 的四分类框架不推翻，是**细化**（新增 product_state 与 scaffold_contract_drift 两维）。

## 范围外（明确不做）

- 不重构 ArkTS `.id(anchorId)` 注入机制；只收敛 spec-node 真值、4/5 段语法、后缀机读契约与消费方；
- 不做 hylyre 逐例驱动依赖的 TC 级联执行器（3.1.0 plan c2e9f4d7）；
- 不动 d9 已通过宿主回归的部分（生成物分类、强装、evidence 写入门槛）；
- 不修宿主产品的 sms 按钮启用缺陷（DEF-001/002 已定性为产品侧，属宿主 coding 的活；
  framework 侧只负责正确归因并回修——即本 plan 的 p0b）；
- 派生计划校验先 WARN 不 BLOCKER。

## 探针证据（原始数据 + 可核实路径）

> 供 review 独立核实。以下均为 2026-07-29 宿主 run `20260729T123155Z-0c5411` 的落盘产物
> （宿主 git 内，非临时目录）+ 2026-07-30 人工验证。

### 证据 A — 派生计划的谓词原文（p0a 的依据）

路径：`doc/features/bc-openCard/testing/reports/20260729T223800Z/hylyre/test-plan.hylyre.md`

TC-006/007 的失败步骤原文（`grep -o '{"wait_for":{[^}]*}}'`）：
```json
{"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sheet_scaffold-next","enabled":true,"timeout":15}}
```
⇒ 测试等的是 **`enabled:true`**。而 `parseDerivedPlanSteps` 只提取
action/selectorKind/selector/scope ⇒ 该谓词在 evidence 里**不存在**。

### 证据 B — 失败 dump 里元素的实际状态（p0b 的依据）

**已落 fixture**：`profiles/hmos-app/harness/tests/fixtures/device-attribution/`
（脱敏 + 判据保真自检 ALL OK；README 的每条事实断言均以脚本对文件核实通过）。

> #### ⚠ 本节 v2 曾把 case 挂错，v3 更正（2026-07-30 落 fixture 时核出）
>
> v2 写「TC-010/011 的 dump 里目标元素 `enabled=false` ⇒ 它们应归 product_state」。
> **元素状态那半句对，case 归属那半句错。** 逐条核对 dump 文件名步骤索引与
> `test-plan.hylyre.md` 后的 ground truth：

| case | 失败步骤 | selector（含谓词） | 用的 dump | 目标在**该帧**？ |
|---|---|---|---|---|
| TC-006 | 5 `wait_for` | `by_id ...sheet_scaffold-next` + **`enabled:true`** | clipped | **✗ 不在** |
| TC-007 | 17 `wait_for` | 同上 | clipped（≡TC-006） | **✗ 不在** |
| TC-008 | 1 `touch` | `by_id ...add_success-done` | clipped（≡TC-006） | ✗，且整个 add_success 屏都不在 |
| TC-010 | 2 `touch` | `by_text 查看全部` + **`within {by_id ...card_pack_with_cards:list_card_container}`** | disabled | within 容器不在此屏 |
| TC-011 | 0 `touch` | 同上 | disabled（≡TC-010） | 同上 |

真正 selector = `sheet_scaffold-next` 的是 **TC-006/007**，而**它们自己的帧里该元素不在场**；
元素在场且 `enabled=false` 的是 **TC-010/011 的帧**，但它们的失败 selector 是 `查看全部`
——按钮只是顺带在场。

`sms-verify-next-disabled.json`（TC-010/011 帧）实测：
```
next_step_btn                                        enabled=true    ← 非 namespaced，另一屏残留
maison:bc-opencard:sms_verify:sms_input               enabled=true
maison:bc-opencard:sms_verify:sms_input-input         enabled=true
maison:bc-opencard:sms_verify:sms_input-countdown     enabled=true
maison:bc-opencard:sms_verify:sheet_scaffold-primary-action  enabled=true
maison:bc-opencard:sms_verify:sheet_scaffold-next     enabled=false   ← 目标
maison:bc-opencard:sms_verify:sheet_scaffold-next-label enabled=true
```
⇒ 产品**确实渲染了**该按钮（codex 用这一点证伪"产品缺元素"，成立）；同屏对照全 `enabled=true`
说明不是整屏禁用 ⇒ 性质是 **product_state**。

**但结论只在跨帧成立**：`sms-verify-next-clipped.json`（TC-006/007/008 共用帧）里该元素
`-next` / `-next-label` / `-primary-action` **一个都不在**，而同屏他锚点 7 个在场
——单看这一帧，p0b (2) 的三条件全满足、必判 product_actionable（= 人工第二轮的错）。
**这就是 p0b 必须跨 case 取证的实证依据**，见 p0b 的“证据池先行”判据。

**去重依据**：`TC-007-step-17` 与 `TC-008-step-1` **字节相同**；`TC-006-step-5` 仅差状态栏
时钟（10:58/10:59），脱敏后三棵树完全相同；`TC-010-step-2` 与 `TC-011-step-0` 字节相同。
三个"不同"的失败共用同一帧，本身是一条事实。

### 证据 B2 — 一条**待核实**的强线索（不是结论，实现 p0a/p0b 时请顺带验）

TC-010 的失败步骤是 **2**，说明步骤 **1**（`wait_for by_id
...card_pack_with_cards:list_card_container`，timeout 15）**通过了**。但同帧 dump 里
`card_pack_with_cards` **一次都没出现**，只有 `maison:bc-opencard:card_select:list_card_container`
——两者 node 段同名（`list_card_container`）、screen 段不同。

⇒ 强怀疑 **selector 匹配不是整锚点精确匹配**（后缀/子串命中了另一屏的同名容器），于是
`wait_for` 假通过、`within` 作用域的 touch 才失败。TC-011 第一步就是那个 touch（无前置
wait_for）并立刻失败，与此一致。

**未核实**（未读执行器源码，不下定性——这批数据已错判过两轮）。fixture 恰好可判：
`sms-verify-next-disabled.json` 里有 `card_select:list_card_container`、**没有**
`card_pack_with_cards:list_card_container`，写一条"整锚点精确匹配不得命中异屏同名容器"
的断言即可证实或证伪。若成立，则它是**第四环**（假通过导致失败步骤右移、归因看错步骤），
须独立记一条 todo，不要塞进 p0a/p0b。

### 证据 C — evidence 的实际分类（误判结果）

路径：`doc/features/bc-openCard/testing/reports/device-test-evidence.json`

```
device_target : {serial: 3UJ0225321000395, target_kind: physical, session_id: testing-i5}
install       : executed=true, ok=true       hap_sha256_full: 64 hex
cases (5)     : TC-006 test_contract | selector=maison:...:sheet_scaffold-next
                TC-007 test_contract | selector=maison:...:sheet_scaffold-next
                TC-008 test_contract | selector=maison:bc-opencard:add_success-done
                TC-010 test_contract | selector(by_text)=查看全部
                TC-011 test_contract | selector(by_text)=查看全部
```
与 trace 失败集合（TC-006/007/008/010/011）**完全一致**（join 链无漏项）。

### 证据 D — ui-spec 声明（p0c 的依据）

路径：`doc/features/bc-openCard/spec/ui-spec.yaml`

```
sms_verify 屏 children: sms_title / sms_phone_hint / sms_input / sms_countdown / sms_next_btn
  sms_next_btn: type=action_button, text="下一步", variant=filled
其他相关：success_done_btn / expanded_view_all_link(text="查看全部银行")
          pack_view_all_cards(text="查看全部 (6)")
```
⇒ 对照证据 B：真机 semantic 段是 `sheet_scaffold-next`（脚手架命名），spec 是
`sms_next_btn`；而同屏 `sms_input` 的 semantic 段与 spec **同名** ⇒ 脚手架命名**部分对齐、
部分漂移**，字面比对必然落空。

### 证据 E — 锚点契约与真机实况（p0c 段数争议）

- 契约：`profiles/hmos-app/harness/ui-kit-anchors.ts` — `maison:<feature>:<screen>:<node>:<instance>`，
  `isValidAnchor` 要求 **5 段**；
- 真机：证据 B 里全是 **4 段**（+`-suffix` 子件形态，如 `-next` / `-input` / `-countdown`）；
- `isValidAnchor` 生产代码消费方：**grep 仅自身文件与单测** ⇒ 契约空转。

### 证据 F — 人工短验证（DEF-001/002 定性，2026-07-30）

真机手动进短信验证 Sheet、软键盘输入 `123456` ⇒ **「下一步」仍不可点击**（后续观察点因此
无法进行）。真机软键盘走完全正常的 ArkUI 输入路径 ⇒ **排除 Hylyre input/onChange 契约问题，
确认产品侧缺陷**。这条使 p0b 的 `product_state` 可正当回 coding（无需"工具侧不回退"分支）。

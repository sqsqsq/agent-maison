---
name: 结果级范围门禁 — UI 文件级 scope 门 / 消费者结果 golden
version: 3.0.0
# 版本说明：窗口不 bump（用户控版本）。
# ============================================================================
# v13 起整体重写（2026-07-26 定案；v14 起为 review 修订——现行版本以正文状态行为准）
# ============================================================================
# 【为什么推倒 v12】v12 经十轮 review 长成了至少五六个独立子系统：requirement→screen
# 语义推导器 / 全宿主 UI owner inventory（四类枚举）/ proposal-effective 双层 scope SSOT /
# trusted-base 跨 run lineage / source→HAP→截图 provenance / negative screen baseline /
# consumer outcome attestation（HMAC 签发·registry·轮换·吊销）/ release 触发路径矩阵。
# 这不再是"范围门禁 plan"。且其依赖段消费 d8c5f3a7 的 provenance 链与
# metric_contract_hash——两者已在 d8c5f3a7 v22 删减重构中删除（依赖链本身失效）。
# 三个不可修的结构性问题：
#   ① 需求文本自动映射 screen ID 无通用确定性算法（v12 自己的 Q2 至终未解）；
#   ② ArkTS 动态 Builder/状态分支/间接组件不可能静态完整枚举——"不可判就 BLOCKER"
#     会把复杂宿主大面积锁死；
#   ③ runner-owned ≠ 语义正确——runner 生成的 scope 终究依赖不可靠的语义推断。
# 【核心反转】拦 HomeTab 误开发不需要知道"全世界有哪些页面"。真正可观测的只有
# "本次改了哪些文件"：
#     越界 UI 文件 = 本次 changed UI files − 冻结 contracts.files（v14 修订：key_files 保持追溯语义不参与本门）
# 仓库已具备全部地基：模块级 diff_within_scope（check-coding.ts:312）、
# contracts.yaml::prd_to_code_traceability[].key_files（check-coding.ts:180）、
# plan/contracts frozen pass snapshot（pass-snapshot.ts:320）、release pack→verify→promote
# 生命周期（pack-release.mjs / release-all.mjs）。缺的只是一个较窄的 UI 文件级 scope 门，
# 不是新的 scope 信任平台。
# 【v1-v12 历史】原方案全文见 git 提交 4a3e86a3 的本文件版本；inventory/双层 SSOT/
# trusted-base/HMAC 路线整体放弃，不再构成实施要求。
# ============================================================================
overview: >
  【要解的两个问题（不变）】(1) R4 余波：需求外页面被误开发（本案 BankCardPackSection
  被塞进 WalletMain HomeTabPage，ui-spec 十屏无主页屏、plan F8 只分给 CardPackPage，
  模块级 scope 门放行、盲 review 未拦）；(2) R10 结果层：大量机制改动无一条结果级门禁
  用银行卡 10 屏做回归，"机制测试越来越绿、宿主效果越来越差"可以同时成立。
  【现行解法】UI 文件级 scope 门（越界 = changed UI files − plan PASS snapshot 冻结的
  contracts.files；plan 正常 PASS 必建快照 + 首次 coding 前锚定 coding_base_sha）+
  candidate zip consumer golden（candidate = 持久化 zip + manifest + sha256，宿主装 zip，
  evaluator 按固定 10 屏 golden contract 精确集合裁决，PASS 才对同一字节 zip 补门禁
  promote，不签名不复用）。
todos:
  - id: 1
    content: "ui_diff_within_declared_files 门禁：白名单=plan PASS snapshot 冻结 contracts.files（fail-closed）；pre-coding 锚定（plan 正常 PASS 必建快照 + 首次 coding 前记 coding_base_sha，resume 复用）；diff 基线覆盖四态；注册 coding checker"
    status: completed
  - id: 2
    content: "六用例：HomeTab 未声明→best_effort BLOCKER；CardPackPage 已声明→PASS；只改 live contracts→仍 FAIL；expansion 重取快照→PASS；正常 plan PASS 也建快照；agent 改码并 commit 后仍检出越界"
    status: completed
  - id: 3
    content: "consumer golden evaluator：固定 golden screen contract（10 固定正向需求屏含 P1 bank_card_list_sheet + capture ID 映射，精确集合相等）+ 生产接线（golden 显式 targets 绕 P0 过滤，普通 visual-diff 仍 P0-only，缺失/形态不符 fail-closed）+ HomeTab forbidden anchor + 三用例"
    status: completed
  - id: 4
    content: "candidate 模式：candidate=持久化 zip+sidecar manifest+zip sha256，只跳发布 plan 门禁；evaluator 随包发布并校验 manifest/run ID；PASS 后补门禁移动同一字节 zip，禁止重新 pack"
    status: completed
  - id: 5
    content: "一次真实宿主回归（与 d8 复演同次）：两 run+fault-injection+golden 十固定屏+HomeTab+AllBanks，evaluator 裁决归档"
    status: pending
---

# 结果级范围门禁——UI 文件级 scope 门 + 消费者结果 golden (c4e8b1d3)

状态：**v17 已实施 + 实施 review 两轮（round19：5P1+1P2；round20：3P1+1P2）全修——待用户 review 提交；Todo 5 与 d8c5f3a7 复演同一次宿主统一回归（须先重跑 candidate:build——现存 candidate zip 是修复前构建）**

> **实施 review 第 2 轮（round20，2026-07-27，全采纳）**
> ① 素材门改按**真实 summary 契约**消费（writer 无 checks 字段）：quality_axes.asset 轴
>   verdict 须 PASS + 沿 script_report 指针读 script-report.json.checks（visual_parity_asset_*
>   无 FAIL）+ summary.run_id 须绑定本 run；任一环缺席/失配 fail-closed。
> ② HomeTab 负向证据**生产接线**：golden capture 按 contract.forbidden 导航 + UITree dump，
>   写 golden_forbidden_evidence wrapper（run_id + build fp 绑定）；nav 步骤/layoutDumpFn
>   缺失或导航/dump 失败 → fail-closed 记采集失败。evaluator 只认本 run + 当前 build 的
>   wrapper——裸 dump/历史残留/他 run/旧 build 一律不采信。
> ③ run_binding 升级为 **testing 成功闭环**判据（最新 testing phase_verdict=PASS 且
>   action=advance）；新增 build_binding：条目 evaluated_build_fingerprint 须等于当前
>   安装指纹（同 run 内 backtrack 换 build 后的早期旧截图不过关；当前指纹不可算=全 FAIL）。
> ④（P2）candidate 输出 env 命令改双 shell 可执行形式（PowerShell `$env:` / bash `export`）。

> **实施 review 第 3 轮（round21，2026-07-27，全采纳——两个假通过口封死）**
> ① run_binding 判据收紧：最新一次 testing phase_start **之后**须存在 PASS/advance
>   verdict（旧 PASS 后 testing 重启并中断不再误判）+ 最后 run_end.status ∈
>   {CHAIN_SLICE_COMPLETED, COMPLETED}（HALTED/INTERRUPTED/PARTIAL/缺失一律不采信）。
> ② 素材链三个 fail-open 口封死：asset 轴 applicable=false 不豁免（bc-openCard 明确需要
>   图片，不适用=链路异常）；summary.script_report 指针缺失不回退默认文件名；
>   script-report.json 无 checks 数组按畸形报告 FAIL，不按空数组放行。

> **实施 review 第 4 轮（round22，2026-07-27，全采纳——两个边界收口）**
> ① run_end 与最新 testing verdict **顺序绑定**：保存最新 testing verdict 完整状态与
>   索引（不再是"任意 PASS"），成功 run_end 的索引必须位于其后——
>   "旧段 PASS→旧 run_end=COMPLETED→resume 新段→testing PASS→写新 run_end 前中断"
>   不再借旧终局判 PASS。
> ② asset.applicable 改 `!== true`：契约必填 boolean，缺失/畸形与 false 同罪。

> **实施 review 第 1 轮（round19，2026-07-27，全采纳）**
> ① 删 live ui-spec 绕过：gate 不再做任何 live 文件前置探测——适用面只由「diff 有无 UI
>   变更」决定（无→PASS 白名单不咨询；有→冻结白名单缺失即 FAIL）；goal run 内永不 SKIP，
>   id 进 CODING_CRITICAL_SKIP_IDS（normal 模式设计内 SKIP 降 MINOR 天然放行）。
> ② golden 宿主入口：candidate build 输出三步指引（装 zip → **先设 MAISON_GOLDEN_CONTRACT
>   再跑 goal run** → 包内 evaluator 裁决）；evaluator 缺 P1 屏时提示未设 env 的常见根因。
> ③ run 绑定：capture 给条目盖 `captured_in_run` 机器戳（字节恒等保留路径也更新——本轮
>   确实重采）；golden 模式同 build 跳采额外要求条目为本 run 采集（跨 run 强制重采，
>   普通模式 P0-9a 行为逐字节不变）；evaluator 新增 run_freshness 项。
> ④ crash schema：evaluator 改读真实归档形态 `diagnosis.kind`（顶层无 kind）+
>   `screen_or_case`；夹具同步为真实 schema。
> ⑤ 严格判定：evaluator 新增 verdict_all_pass（pending/skipped/缺失均 FAIL）与
>   screenshot_binding（evaluated_screenshot_hash 须与盘上截图一致，hash 口径运行时
>   require profile 的 hashScreenshotFile，不本地复刻公式）。
> ⑥（P2）重复 screen ID 不被 Map 吞——ten_fixed_screens_exact_set 点名重复并 FAIL。

> **实施记录（2026-07-27，Todo 1-4）**
> - **G1 门禁**：`harness/scripts/utils/ui-scope-gate.ts`（核心）+ check-coding.ts 注册
>   `ui_diff_within_declared_files`（traceability，恒 BLOCKER）+ coding-rules.yaml 声明；
>   git-diff.ts 新增 `diffChangedFilesWithStatus`（-z name-status -M，base↔worktree 一次
>   覆盖三态 + untracked 补 'A'；baseRef 不存在即 executed=false 不回退）与 `readFileAtRef`
>   （删除/重命名 base 侧分类）。
> - **pre-coding 锚定**：goal-runner「plan 正常 PASS advance 前必建 pass snapshot」
>   （失败 halt pass_snapshot_unavailable，与 closure retry 分支同语义；resume 盘上已有
>   active 快照走可信加载复验不重取）+「首次 coding agent invoke 前 recordCodingBase」
>   （write-once trust 文件 coding-base.json，MAC 同 pass-snapshot 协议域；事件
>   coding_base_recorded/unavailable/invalid）。非 goal run 无 run 级锚 → 门禁 SKIP 并
>   诚实声明（normal 模式过渡按发布约束人工核对）；无 ui-spec 的 feature → SKIP（非 UI
>   feature 不受 UI 门拦截）。
> - **用例**：ui-scope-gate 套件 12 例（含六用例的 ①②③④⑥ + 删除 base 侧分类 +
>   untracked + 缺锚 fail-closed + write-once）；⑤ 在 goal-runner-testing-integrity 增
>   runner 级用例（pass_snapshot_taken 先于 coding invoke + trust 文件真值）。
> - **G3 oracle + 接线**：随包 contract `harness/scripts/consumer-golden/
>   bc-opencard.golden-contract.json`（10 固定屏 + HomeTab forbidden + key overlays；
>   harness/scripts/** 在 release 包内）；visual-diff-targets.ts 新增
>   `resolveGoldenCaptureTargets`（无 P0 过滤的显式目标解析，缺失/形态不符 fail-closed）；
>   visual-diff-capture.ts 接 `goldenTargets` opt + env `MAISON_GOLDEN_CONTRACT` 装载器
>   （env 设了读不出=抛错，不许静默降级 P0-only），目标=P0 ∪ golden 显式（普通模式零变化）。
>   evaluator `evaluate-bc-opencard.ts`：十项聚合（candidate/run 绑定 + 八条清单），
>   普通 JSON 报告。profile 套件 5 例 + consumer-golden 套件 9 例。
> - **Todo 4 candidate 模式**：`scripts/candidate-release.mjs`（npm run candidate:build /
>   candidate:promote）。build=typecheck+全部测试+pack+verify（verify-release-pack 新增
>   `--skip-plan-release-gate`，candidate 唯一跳过项）→ 持久化
>   dist/candidates/framework-<v>-candidate.zip + manifest（记 zip_sha256 与 in-zip
>   manifest sha，后者即 evaluator --expected-manifest-sha）。promote=验 zip 字节身份
>   （与 build 记录 sha 逐字节一致，禁重新 pack）+ 要求 evaluator 报告 verdict=PASS 且
>   manifest 绑定一致 + 补跑 check-plan-version --release；门禁被在研 plan 拦截 → 只标
>   `candidate.status=eligible` 不绕过；通过 → renameSync 同一字节 zip 到 dist/ 正式名。

> **v16 → v17（review 第 4 轮，采纳；已对代码核实）**
> oracle 要求 P1 屏但现有采集器不会生产它：`collectP0OverlayTargetIds` 先过
> `isP0VisualTargetScreen`（visual-diff-targets.ts:50，= priority === 'P0'），P1 的
> bank_card_list_sheet 进不了 overlay 遍历——只改 evaluator 则该屏永不被采、golden 永远
> FAIL。v17 在 Todo 3 增加**最小生产接线**：golden 模式读随包 contract，把十个 declared
> screen ID 作为**显式 capture targets** 传给既有采集器（显式目标不受全局 P0 过滤）；
> 普通 visual-diff 仍保持 P0-only；contract 屏在宿主 ui-spec 缺失/非 overlay root →
> fail-closed FAIL。补三个用例。

> **v15 → v16（review 第 3 轮，采纳；事实已对归档核实）**
> 「10 个正向 P0 屏」不是事实：ui-spec 实为 **9 个 P0 + bank_card_list_sheet（P1，却对应
> 第 10 张原始需求图）**；归档 visual-diff.json 只采到 6 屏；registry 只有文件名+hash 无
> screen ID 映射。故 evaluator 不能从 P0 动态推导（漏 P1 屏）、不能从宿主本轮 ui-spec
> 推导（误改可自证）、不能只数数量（错误屏替换可凑数）。v16 新增**随 candidate 发布的
> 固定 golden screen contract**：精确 10 屏集合 + declared↔capture ID 映射，集合相等裁决；
> HomeTab 为第 11 个负向目标不计入；文案统一为"10 个固定正向需求屏"。

> **v14 → v15（review 第 2 轮，全采纳；两条均为"实现不可达"级缺口，已对代码核实）**
> ① **pre-coding 锚定**：现状 `takePassSnapshot` 全库唯一调用点在 PASS+advance_blocked+
>   closure retry 分支（goal-runner.ts:5887）——正常 plan PASS 直接 advance **不建快照**；
>   `trace.start_commit` 由 harness 记录（harness-runner.ts:626），而 harness 是 agent 执行
>   完之后的检查通道——agent 若已 commit，记到的就是**改动后的 HEAD**。v15 钉死：
>   plan 正常 PASS → runner 必建 plan snapshot → 首次 coding agent_invoke_start 前记录
>   coding_base_sha → coding harness 读同 run 快照 + coding_base_sha；resume 复用原 SHA；
>   缺同 run 快照直接 BLOCKER（第一版不做跨 run 自动找）。
> ② **candidate 精确化**：现状 `--stage-only` 只建目录无 zip/hash，正常 pack 打完 zip 即删
>   staging，`release:all` 第一步就是 `check-plan-version --release`（被在研 3.0.0 plan
>   拦截）且 verify 后立即 promote——都不能原样当 candidate。v15 钉死：candidate =
>   持久化 zip + sidecar manifest + zip sha256；只跳"发布 plan 完成门禁"；evaluator 随包；
>   PASS 后对同一字节 zip 补门禁 promote，禁止重新 pack。
> ③ 顺手清理：依赖段 smoke-consumer-staging.mjs → pack/release 生命周期；文件头 v13
>   标识与正文统一。

> **v13 → v14（review 第 1 轮，全采纳）**
> ① 允许集合从 `key_files` 改为 **`contracts.files`**——key_files 语义是"关键文件"（PRD→
>   代码追溯），contracts.files 才是完整文件清单；强改 key_files 穷举会连带 plan skill/
>   模板/校验/历史契约再次复杂化。同时**删除"已批准 expansion"第二 SSOT**：expansion 的
>   唯一路径 = 更新 contracts.files 并重新取得 plan PASS snapshot。
> ② "冻结 scope + 当前 coding diff"接线四条钉死（快照 fail-closed / trace.start_commit
>   基线 / 删除重命名的 base 侧分类 / expansion fixture 断言 live contracts 无效）。
> ③ G3 拆开"真机结果生产"与"staging 验证"：candidate staging（生成不 promote）→ 宿主
>   统一执行 → candidate 内 evaluator 消费产物 → PASS 才 promote 同一 candidate。
>   Todo 1-4 先完成"实现"；G3 真实验收与 Todo 5 在同一次宿主回归共同完成。

## 核心思路（v13 反转）

**不枚举页面全集，只看本次 diff**：

```
越界 UI 文件 = 本次 changed UI files − 冻结 contracts.files
```

（v14：白名单是 **`contracts.files`**——契约的完整文件清单；`key_files` 保持其原语义
"PRD→代码追溯的关键文件"，不动。）

保留 v12 唯一有效思想：**UI 相关文件必须显式进入 contracts.files；未声明的 UI 文件默认
就是受保护范围**——因此不需要显式维护 `protected_negative_screens[]`，也不需要任何
inventory / 双层 SSOT / trusted-base。

## G1：`ui_diff_within_declared_files`（原 T8 收缩为文件级门禁）

- 允许文件集合 = **冻结的 `contracts.files`**（契约完整文件清单；`key_files` 只负责
  PRD→代码追溯，不参与本门）。
- **冻结口径（v15 钉死，最小实现五条）**：
  1. **pre-coding 锚定（v15 新增——补两个实现缺口，仍是复用既有 snapshot 设施，不是
     跨 run 信任平台）**。现状缺口：`takePassSnapshot` 只在 PASS+advance_blocked+closure
     retry 时建（goal-runner.ts:5887 唯一调用点），正常 plan PASS 直接进 coding **没有
     快照**；`trace.start_commit` 由 harness（agent 之后的检查通道）写（harness-runner.ts:626），
     agent 已 commit 则记到改后 HEAD。正解流程：
     **plan 正常 PASS → runner 必建 plan snapshot（复用 takePassSnapshot，advance 前执行，
     失败 fail-closed halt）→ 首次 coding agent_invoke_start 前 runner 记录 coding_base_sha
     （事件持久化）→ coding harness 读取当前 run 的 plan snapshot + coding_base_sha**。
     钉死：resume 复用原 coding_base_sha，**不得重新取 HEAD**；从 coding 起跑却没有
     **同 run** plan snapshot → 直接 BLOCKER 引导从 plan 起跑，第一版**不做**跨 run
     "自动找最近 plan snapshot"。
  2. **快照来源 fail-closed**：从**有效 plan PASS snapshot** 读取冻结 contracts.files；
     快照缺失或损坏 → BLOCKER，**禁止退回 live `ctx.featureSpec.contracts`**（live 契约
     coding 期 agent 可写，读它=门禁形同虚设——现有 check-coding 读 live 的形态不可复用）。
  3. **diff 基线 = coding_base_sha**（第 1 条 runner 在 agent 起跑前锚定的 SHA，经既有
     git-diff.ts 设施）——覆盖 **committed / staged / unstaged / untracked** 四态
     （agent 改码后自行 commit 的越界文件同样检出；缺 coding_base_sha 与缺快照同罚：
     BLOCKER，不回退 trace.start_commit——那是 agent 之后才写的）。
  4. **删除/重命名**：diff 至少保留 status 与 old/new path（不用 `--name-only`），
     删除/重命名文件从 **base 侧读旧内容**做 UI 分类（改后内容已不在盘上）。
  5. **expansion 唯一路径**：更新 `contracts.files` 并重新取得 plan PASS snapshot——
     没有"已批准 expansion"旁路（那是第二 SSOT）。
- UI 敏感文件三类判据：
  1. 页面/组件/presentation 类 `.ets`（路径含 `pages/`、`components/`、`presentation/`）；
  2. 文件内容含 ArkUI UI 结构标志：`@Entry` / `@Component` / `build()` / `NavDestination` /
     `Tabs` / `bindSheet`；
  3. UI media/resource 文件（`resources/base/media/**` 等）。
- **changed UI file 不在冻结 contracts.files → 任何 strictness 都是 BLOCKER**。本案自然
  得到：CardPackPage.ets 在清单 → PASS；HomeTabPage/index.ets 不在 → best_effort 也
  FAIL；确实要改 HomeTab → 回 plan 把它加进 contracts.files、重取 PASS snapshot。
- 非 UI 文件继续走既有模块级 `diff_within_scope`，本门不重复管。
- **第一版不做 owner dependency closure**（共享组件影响面是真问题，但等直接文件门跑出
  真实漏报再加；提前做就又长成静态程序分析平台）。

## G3：bc-openCard consumer golden（原 T7b 收缩——保留 golden，撤掉签发平台）

**candidate 定义（v15 钉死为可执行对象）**：`candidate = 持久化 zip + sidecar manifest +
zip sha256`——**不是可变 staging 目录**。现状核实：`--stage-only` 只建目录、`zipPath: null`
无 hash（pack-release.mjs）；正常 pack 打完 zip 即删 staging；`release:all` 第一步就是
`check-plan-version --release`（当前被多个在研 3.0.0 plan 拦截）且 verify 通过立即
promote、finally 清 staging；`release:verify` 自带同一 plan 门禁（verify-release-pack.mjs:328）
——都不能原样当 candidate 用，需要独立 candidate 模式。

**执行形态（v15 五步钉死）**：

```
两份 plan 代码/单测/fixture 全部完成
  → candidate 模式：完成测试 + pack + zip 内容校验，唯一跳过项 =「最终发布 plan 完成
    门禁」（check-plan-version --release）；产出持久化 zip + sidecar manifest + zip sha256
    → 宿主安装该 zip（非可变 staging 目录），统一执行：两 run + fault-injection +
      golden 十固定屏 + HomeTab + AllBanks
      → 用 candidate zip 内的 golden evaluator 消费宿主本轮产物
        → PASS → 对已有 zip 补最终发布门禁，移动同一字节对象 promote（禁止重新 pack）；
          FAIL → 不 promote
```

- **evaluator 属于发布内容**（打进 candidate zip），确保运行的是 candidate 内实现。
  输入 = candidate manifest + 宿主 goal run ID + 结果目录；宿主侧安装的
  `RELEASE-MANIFEST.sha256` 或结果 run ID 与 candidate 不匹配 → **FAIL**，旧结果不能复用。
- **evaluator 只做结果聚合，不造真机执行平台**：
  · HomeTab：复用既有 identity 的 `none_of: [{id: bank_card_section}]` + UITree；
  · AllBanks：capture 成功 + identity PASS + 无 crash；
  · 其余各项复用既有 identity / faultlog 集合差 / 素材门 / visual-diff 结果。
- 若其他在研 plan 仍阻止正式发布：只标记 **candidate eligible**，**不绕过全局发布门禁**。
- 不允许跨 release 复用结果 → 自然不需要 HMAC/receipt/registry/轮换/吊销。
- 输出**普通 JSON 诊断报告**（zip sha256、截图 hash、设备信息）——用于诊断，
  不是长期可信凭证。
- **Todo 1-4 先完成"实现"；G3 的真实验收与 Todo 5 在同一次宿主回归中共同完成**
  （正好满足"两份 plan 全部开发完，只去宿主回归一次"）。

**Golden screen oracle（v16 新增——固定集合契约，随 candidate zip 发布）**：

事实核定（对事故归档）：ui-spec 十屏 = **9 个 P0 + `bank_card_list_sheet`（P1，却对应
第 10 张原始需求图「9.银行卡列表页-半模态形式.jpg」）**；归档 visual-diff.json 只采到
6 屏；reference-images.registry.json 只有文件名+hash、无 screen ID 映射。因此 evaluator
**不能**从 P0 动态推导（漏 bank_card_list_sheet）、**不能**从宿主本轮 ui-spec 推导
（ui-spec 被误改后可自证通过）、**不能**只检查数量为 10（错误屏替换正确屏也能凑数）。

固定 **10 个正向需求屏**（declared → capture ID 映射一并固定；overlay 命名按既有
visual-diff-targets.ts:40 规则 `<screen>__overlay__<id|order>`）：

| declared screen ID | capture ID |
|---|---|
| add_card_home_collapsed | 同名 |
| add_card_home_expanded | 同名 |
| all_banks | 同名 |
| card_type_sheet | card_type_sheet\_\_overlay\_\_0 |
| card_select | 同名 |
| sms_verify | sms_verify\_\_overlay\_\_0 |
| add_success | 同名 |
| card_detail | 同名 |
| card_pack_with_cards | 同名 |
| bank_card_list_sheet | bank_card_list_sheet\_\_overlay\_\_0 |

HomeTab 是额外的**第 11 个负向目标**，不计入十个正向屏。门禁口径：**精确集合相等** +
declared↔capture ID 映射校验——**缺失、重复、替换、多出错误屏均 FAIL**。这是 consumer
golden 必须有的最小 oracle（一个随包小契约文件），不是通用 baseline/inventory 平台。
全文文案统一为"**10 个固定正向需求屏**"，不再称"10 个 P0 屏"。

**生产接线（v17 新增——否则 contract 要求 P1 屏而采集器永不生产）**：现状
`collectP0OverlayTargetIds` 先过 `isP0VisualTargetScreen`（visual-diff-targets.ts:50，
= `priority === 'P0'`），P1 的 bank_card_list_sheet 进不了 overlay 遍历。最小接线四条：
1. **golden 模式**读取随包固定 contract，把十个 declared screen ID 作为**显式 capture
   targets** 传给既有采集器——显式目标**不受全局 P0 过滤**；
2. **普通 visual-diff 不传 golden targets，仍保持 P0-only**（不因此全局扩面到 P1）；
3. contract 要求的 declared screen 必须在宿主 ui-spec 中**存在且形态相符**
   （bank_card_list_sheet 仍为 overlay root 才解析得出 `__overlay__0`）——缺失或形态
   不符**直接 FAIL**（fail-closed，不静默跳过）；
4. 复用既有导航（visual-diff-nav）、identity、截图、faultlog 流程，**不另造设备执行平台**。

**Golden 验证清单（只留确定性且有判别力的结果）**：
1. 10 个固定正向需求屏全部采集（按上表 golden contract 精确集合相等）；
2. screen identity 正确（既有 identity gate 口径）；
3. 无 crash（faultlog 集合差口径，d8c5f3a7 F3 已交付）；
4. required asset 不缺失、不为 maison placeholder（d8c5f3a7 F4 已交付的档位无关门）；
5. visual-diff.json 无 must_fix；
6. **HomeTab 实拍/UITree 中没有 `bank_card_section`**（forbidden anchor，本案直接回归）；
7. AllBanks 可进入（本案崩溃屏直接回归）；
8. 关键半模态（card_type/sms）与完成页有声明且采到。

**明确删除**：score_floor / blank_area_ratio / 未校准 edge divergence / 通用 metric
contract（d8c5f3a7 v22 已删且实测证伪）/ "HomeTab 必须与历史截图·结构 hash 不变" /
trusted baseline 双分支。Golden 的目标是防**灾难性退化与错误范围**，不冒充能机器判定
全部视觉美感——高保真好坏在可靠感知指标建立前，保留并排截图人工终审。

## 移出本 plan 的内容

- **两 run canary 验收**归 d8c5f3a7 / fidelity-intent-auto-routing 的 T1 验收（v12 在
  T7b 又写了一份，两个 plan 对同一验收负责——删此处，只留彼处）。
- HMAC issuer / trust registry / 独立密钥 / 子进程环境剥离 / 密钥轮换吊销 /
  consumer_outcome_attestation action / receipt 复用验证 / staging·commit·decision·canary·
  截图 provenance 绑定字段 / UI 相关路径触发白名单——全部移出，不再属于任何当前版本。

## 依赖（重写后——不消费任何已删产物）

只依赖**既有已交付**设施：
- 冻结 contracts / plan 的 pass snapshot（既有，pass-snapshot.ts）；
- `diff_within_scope` 的 diff 采集面（既有，check-coding.ts）；
- release pack→verify→promote 生命周期（既有，pack-release.mjs / release-all.mjs /
  verify-release-pack.mjs——candidate 模式在其上加"跳发布 plan 门禁 + 持久化 zip"分支）；
- d8c5f3a7 已交付的 identity gate / crash 集合差 / 素材档位无关门（G3 清单 2-4 直接复用）。

## 排期与发布约束（2026-07-26 用户定案：先做完本 plan，再统一打包复演）

**本 plan 先于宿主复演实现**——三个理由：① 宿主回归是全流程最贵环节（配套 1-4/真机
两 run/fault-injection/人工核对），只做一次；② G3 的 staging→golden→promote 本来就是
打包流程的一部分——发给宿主的包应当是经过 consumer golden 的；③ 复演中若 scope 误开发
复发，带着 G1 门禁当场 BLOCKER，不带则只能人工发现后再装再跑。v13 设计已确定
（文件级门禁不需要复演数据做输入），归因风险可控（与 d8c5f3a7 v23 是正交模块，
事件/门禁 id 不重叠）。

顺序：**本 plan review → 实现（Todo 1-4）→ candidate 模式产出唯一 candidate zip（不
promote，记 sha256）→ 宿主安装 candidate zip 统一回归（d8 的干净两 run + fault-injection +
本 plan Todo 5）→ evaluator PASS → 对同一字节 zip 补发布门禁 promote → 双 plan 解禁**。
发布约束：Todo 1-4 完成前，涉及 UI 范围的发版继续以人工核对 golden 十固定屏 + 无新增页面作为
过渡等价物。

## Todos

- [x] 1. `ui_diff_within_declared_files` 门禁：UI 文件级 scope 门，白名单=**plan PASS
      snapshot 冻结的 contracts.files**（快照缺失/损坏 fail-closed，禁退 live）；
      **pre-coding 锚定**：plan 正常 PASS 必建快照 + 首次 coding agent 起跑前记
      coding_base_sha（resume 复用原 SHA）；diff 基线 = coding_base_sha，覆盖四态含
      删除/重命名 base 侧分类；注册进 coding 阶段 checker
- [x] 2. 六个用例：
      ① HomeTab 未声明却修改 → **best_effort 也 BLOCKER**（本案直接回归）；
      ② CardPackPage 已声明修改 → PASS；
      ③ **只改 live contracts（不重跑 plan）→ 仍 FAIL**（防绕过冻结）；
      ④ scope expansion：更新 contracts.files + 重取 plan PASS snapshot → PASS；
      ⑤ **正常 plan PASS（非 advance_blocked）也建快照**（runner 用例）；
      ⑥ **agent 改码并自行 commit 后仍检出越界文件**（coding_base_sha 基线用例）
- [x] 3. 精简 bc-openCard consumer golden evaluator：**固定 golden screen contract**
      （10 个固定正向需求屏 = 9 P0 + P1 bank_card_list_sheet，declared↔capture ID 映射
      一并固定，精确集合相等——缺失/重复/替换/多余均 FAIL；随 candidate zip 发布）
      + **生产接线**（golden 模式把 contract 十屏作显式 capture targets 传既有采集器、
      不受 P0 过滤；普通 visual-diff 仍 P0-only；contract 屏在 ui-spec 缺失/非 overlay
      root → fail-closed FAIL；复用既有导航/identity/截图/faultlog）
      + HomeTab forbidden anchor（G3 验证清单八条；只聚合既有结果，不造执行平台）。
      三个接线用例：
      ① golden 显式选择 P1 bank_card_list_sheet → 产出 bank_card_list_sheet__overlay__0；
      ② 普通 visual-diff 不传 golden targets → 仍不采普通 P1（防全局扩面）；
      ③ contract 要求的 declared screen 在 ui-spec 缺失/非 overlay root → fail-closed FAIL
- [x] 4. candidate 模式：candidate = **持久化 zip + sidecar manifest + zip sha256**；
      完成测试+pack+zip 内容校验，唯一跳过项 = 发布 plan 完成门禁；evaluator 打进
      zip 并校验 manifest sha256 / 宿主 run ID 匹配（不匹配 FAIL，旧结果不复用）；
      PASS 后补门禁**移动同一字节 zip** promote，禁止重新 pack；其他在研 plan 未完
      时只标 candidate eligible；普通 JSON 诊断报告（不签名、不复用）
- [ ] 5. 一次真实宿主回归（与 d8c5f3a7 复演同一次）：两 run + fault-injection +
      golden 十固定屏 + HomeTab + AllBanks，evaluator 裁决并归档

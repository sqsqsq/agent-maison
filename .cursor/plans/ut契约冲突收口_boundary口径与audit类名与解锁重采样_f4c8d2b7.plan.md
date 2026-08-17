---
name: UT 契约冲突收口 — boundary 口径 / audit 类名 / 锁屏重采样 / 诊断供给（ut-contract-conflict-closure）
version: 3.0.0
# 版本说明：本 plan 纳入当前 3.0.0 窗口，完成后随本版发布（pending todos 进入 3.0.0 发布门）。
overview: >
  宿主实锤（run 20260816T153523Z-cb1583 ut-i17/i18/i19 三连败 content_retry_exhausted
  + run 20260817T011703Z-491157 锁屏 halt）：UT 阶段 agent 反复撞门的根因里有四处是
  maison 自己的契约/诊断缺陷，与 codex 双方独立核实一致，全部实锤：
  ① audit 模板与门禁口径冲突：hmos-app 模板 EXACT OUTPUT FORMAT 教依赖写「类.方法」
  （testability-audit-template.md:33 HAFullChainService.getData），门禁却做纯类名精确
  相等（check-ut.ts:3446 s.target_class === d.name）；反向把 target_class 改成
  「类.方法」又违反 ut_mock_plan_contracts_consistent（target_class 须在 contracts
  interfaces[].class）——照模板抄必挂、改了凑挂另一个门，无解局。hmos-app 模板自身
  也自相矛盾（下方「示例（可复制）」节用的就是纯类名）；generic 模板现状已是纯类名
  （HomeRepository），无同款错误、无相同的 EXACT OUTPUT FORMAT 段。
  ② DAG boundary 双口径：类型定义（check-ut.ts:191）、dag-schema.md 模板（:82）、
  dag_spy_preset_resolvable（:3762 读 boundary.type/method）三方都定义 boundary 为
  {name,type,method} 对象，唯独 dag_boundary_matches_spec（:1613）把整个 boundary 当
  字符串与 data_boundaries[].name 比较，对象形式必报 WARN，且 suggestion 文案还明教
  agent 改成字符串——改完就触发 preset BLOCKER，门禁自己制造修一冒一。
  ③ 锁屏 pin_container_not_found 首帧即判永久：reveal（滑出键盘）后第一帧零等待 dump
  （device-unlock-helper.ts:228 循环首轮无 settle），容器动画未挂载即返回
  pin_container_not_found，归为 layout_unsupported 后在 :242 早退、不参与既有有界
  settle 重采样（窗口仅 MAX_RESAMPLES×SETTLE_INTERVAL_MS = 3×400ms）。同设备几小时前
  自动解锁成功（run cb1583 events）证明布局其实被认识——是过渡态被误判成永久布局
  不支持。
  ④ 失败回执与知识供给断链：checkUtMachineArtifactParseable invalid 分支（:3173）
  suggestion 只有「修复 YAML/根节点/字段格式」，不复述产物各自的格式契约也不给模板
  路径。模板路径当前存在平行真源：profiles/<profile>/skills/skill-assets.yaml 是既有
  SSOT，hmos-app 的 ut-host-impl getUtSuggestionPaths() 又维护一份 profile 私有硬编码
  路径表（正常情况下返回真实路径），check-ut.ts:148-158 的无 host 回落还维护第三套
  散文——其中回落散文是幻影路径（skills/feature/business-ut/templates/ 不存在）。
  本次 hmos run 走的是 host impl 正常路径，幻影回落未被证明是本次根因；但平行真源
  与回落缺陷本身必须收编。goal 模式 ut prompt 只给一跳 SKILL.md
  （goal-runner.ts:2483），模板在 profile-skill-asset 多跳指针之外，headless agent
  实际拿不到 OUTPUT CONTRACT——精准踩中模板明文禁止的第一条（Markdown 表格）即为证。
  本 plan 性质：既有契约与诊断口径的修正 + 模板路径收编回既有 skill-assets SSOT。
  不扩机制、不新增兼容层/身份字段/等待状态机；但必要的旧实现清理（getUtSuggestionPaths
  硬编码退役）与跨调用点一致性不以「简单」为由裁掉。问题边界已冻结：review→coding
  回退由 b6e4c9f2 plan 承载；skills 消费的通用收口由 d8f4b7e2 extension plan 承载，
  本 plan 仅做 ut 窄补丁并标注接缝。
todos:
  - id: t1-dag-boundary-name
    content: >
      dag_boundary_matches_spec（check-ut.ts:1613）改读 boundary.name，且类型真实表达
      双形态：DagNode.boundary 类型改为
      { name?: string; type?: string; method?: string } | string；
      对象 {name,type,method} 是唯一推荐格式；旧字符串 boundary 与旧 port 字段继续
      兼容消费（typeof string 回落），但任何文案不再教新产物写字符串。
      suggestion 改为「boundary.name 应匹配 use-cases.yaml > data_boundaries[].name」，
      删除「其值应等于 data_boundaries[].name（旧字段名 port 仍兼容）」话术。
      单测命中实际生产判据（boundaryNames.has 一行做变异验证），不得只测解析夹具：
      对象形式命中/不命中、旧字符串仍可判、旧 port 仍可判、同一份对象形式 DAG 能
      **同时**通过 dag_boundary_matches_spec 与 dag_spy_preset_resolvable。
    status: completed
  - id: t2-audit-classname-caliber
    content: >
      audit/mock-plan 类名口径统一（不新增兼容层）：
      ① 仅修 hmos-app testability-audit-template.md EXACT OUTPUT FORMAT 的「类.方法」
      （HAFullChainService.getData→HAFullChainService、BundleUtil.isVersionControl→
      BundleUtil），与其下方「示例（可复制）」节既有纯类名写法对齐；「常见错误 vs 正确」
      表补一行「name: 类.方法 → name: 纯类名」。
      ② generic 模板（明确裁决）：示例现状已是纯类名，不改示例；补一句
      「dependencies[].name 必须为纯类名（方法级信息不写入 name）」的口径说明，
      与 hmos-app 契约一致。普查其余 business-ut 模板（mock-strategy/
      mock-plan-schema 等）只修实际发现的同类错误，不预设存在。
      ③ 门禁报错明确口径：check-ut.ts:3448 与 :3462 补「dependencies[].name 与
      target_class 均为纯类名；方法级信息写 entry_point.symbol、mock-plan methods[]
      或相应方法字段，不写入 dependency name」。
      ④ 回归钉（可执行形态）：从修正后模板提取 YAML 示例→替换必要占位符→配置与示例
      匹配的 acceptance/contracts/mock-plan 夹具→证明 ut_mock_plan_present 与
      ut_mock_plan_contracts_consistent **同时 PASS**。目标是「照模板生成的合法产物
      能过门禁」，不是构造脱离上下文、字面逐字但无法解析的测试。
    status: completed
  - id: t3-pin-container-resample
    content: >
      锁屏有界重采样统一（采推荐方案，无备选）：删除 device-unlock-helper.ts:242 的
      layout_unsupported 首帧早退，让**所有** keypad 失败 kind 一律跑完现有有界观察
      窗口（MAX_RESAMPLES×SETTLE_INTERVAL_MS = 3×400ms），最后一帧再由
      unlockFailureKindOf 给出最终分类。依据：重采样只重新 dump UI、不读取不输入凭据，
      有界零输入观察安全且统一，代码更简单；真正不支持的布局只额外等待约 1.2 秒，
      代价可接受。（注：当前早退也调用 unlockFailureKindOf，不存在双分类函数——删除
      早退的理由是统一有界观察，不是分类点违规。）不新增另一套等待状态机。
      验收单测：pin_container_not_found 后续帧恢复→继续正常解锁；持续缺失→窗口耗尽
      仍判 layout_unsupported；geometry_insane / digit_invalid 等同窗口观察；cooldown
      每帧优先判断；全程不烧 credential、attempted=false 不变。
    status: completed
  - id: t4-invalid-suggestion-contract
    content: >
      invalid 分支 suggestion 按产物分别生成（两产物契约不同，禁止同待遇）：
      · testability-audit.md：可为 fenced ```yaml 块**或**纯 YAML 全文；根字段
      records[]；禁止用 Markdown 表格代替机器记录；suggestion 指向
      testability_audit_template（用 t5 解析结果）。
      · mock-plan.yaml：必须纯 YAML；禁止 fenced code block；禁止 Markdown 标题/表格；
      根字段 spies[] 或 doubles[]；suggestion 指向 mock_plan_schema。
      实现可继续复用 checkUtMachineArtifactParseable，但 suggestion 按 id/产物类型
      分别生成，不得用 audit 的 records[]/fenced 契约指导 mock-plan。
      单测分别断言两产物各自的正确提示：audit 用 Markdown 表格夹具、mock-plan 用
      fenced 块夹具，各验各的契约文案与模板指向。
    status: completed
  - id: t5-template-path-ssot
    content: >
      模板路径收编回既有 skill-assets SSOT（修透平行真源）：
      改用既有 loadSkillAssetsManifest + resolveSkillAssetPath 按当前 project_profile
      解析 testability_audit_template / mock_plan_schema / use_cases_schema /
      dag_schema / sample_flow_dir 的真实 repo 相对路径。同时：
      · 退役 getUtSuggestionPaths() 的 profile 硬编码路径供给——删除
      UtHostSuggestionPaths 相关接口与 hmos-app ut-host-impl 中的重复路径表；
      · check-ut.ts:148-158 无 host 回落的幻影散文删除；清单不可用时返回
      profile-skill-asset:business-ut/<key> 占位符原文，不再拼接猜测的物理路径；
      · 解析成功时返回真实 repo 相对路径。
      单测覆盖 hmos-app 与 generic 两个 profile；路径存在性断言用解析出的绝对路径
      或基于 project root 正确还原，不受当前 cwd 偶然影响；清单缺失时回落形态正确。
    status: completed
  - id: t6-goal-ut-prompt-assets
    content: >
      goal 模式 ut 阶段 prompt（goal-runner.ts buildPhasePrompt）注入格式契约与真实
      路径：在既有「Read and follow the phase skill」之后追加一小节，**分别**说明两种
      产物格式——testability-audit.md（fenced YAML 或纯 YAML / 根 records[] / 禁
      Markdown 表格）与 mock-plan.yaml（纯 YAML / 根 spies[]/doubles[] / 禁 fenced
      code block 与 Markdown 表格）——并注入 t5 解析出的 testability-audit template、
      mock-plan schema、DAG schema 真实路径。
      仅 UT phase 注入；不建设通用 skill 资产注入机制；与 d8f4b7e2 extension plan
      标清接缝：通用机制将来落地后本节收编退役，不在本 plan 重复建设。
      单测：ut 阶段 prompt 含两段契约与真实存在的路径；其他 phase prompt 不变。
    status: completed
---

## 实施记录（2026-08-17）

全部 6 todo 已实施。新增单测套件 `ut-contract-caliber`（15 例）已注册 CORE_SUITES；
受影响既有套件 device-unlock-helper(26)/profile-decoupling(9)/ut-artifact-validate(11)/
device-readiness-gate(22) 全绿；typecheck 通过。

**实施偏差（对照 plan，均为收敛方向）**：
- t1 除 `dagBoundaryName` 外补了 `dagBoundaryObject` 帮手——`dag_spy_preset_resolvable`
  读 type/method 在 union 类型下需要窄化，两个消费点共用，无行为变化。
- t3 采推荐方案（删早退、全 kind 跑满窗口）；`unlockBlockedNote` 的 layout_unsupported
  提示语补了「有界重采样窗口耗尽仍未识别」限定（原「重试无意义」保留为原地重试语义）。
- t5 顺带删除了 `UtHostSuggestionPaths` 中无消费方的 `utHostImplRefRel` 键（唯一引用是
  profile-decoupling 单测断言，已随接口退役同步更新）。

**宿主待验项**（2026-08-17 复检 P2-4 修正——原「无」与真机验收记录冲突，如实登记）：
1. t3 改动 device-unlock-helper.ts 使真机验收记录
   `harness/tests/fixtures/device-lockscreen/acceptance/f4b2c8e6-live-gate-2026-07-30T064556Z/verification.json`
   维持/再度进入 `PENDING_REAL_DEVICE_REVERIFICATION`（current_sha256 已如实刷新，
   verified_sha256 不动）。须在真机重跑同一验收流程落新记录，新 source_sha256 须一并
   纳入 `bounded-sync-wait.ts`（settle 原语，07-30 验收时尚不存在）。
2. 顺带在真机复验时观察 pin_container_not_found 有界重采样（3×400ms）对该设备锁屏
   动画的实际覆盖情况（本地仅能用夹具帧序验证）。

**复检返修记录（2026-08-17 第二轮）**：按复检意见 3 补齐 t3 承诺的测试面——
device-unlock-helper 套件新增表驱动用例（geometry_insane/digit_invalid 同样跑满
MAX_RESAMPLES 窗口后才归 layout_unsupported）与中途 cooldown 用例（重采样第一帧即
cooldown → 每帧优先判、立即零输入退出、不再 settle）；benchFrames 帮手扩展逐帧
cooldown 注入（既有用例缺省行为不变）。

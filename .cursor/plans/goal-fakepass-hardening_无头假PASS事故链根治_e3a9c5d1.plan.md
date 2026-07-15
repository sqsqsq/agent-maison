---
name: goal 无头假 PASS 事故链根治 — 决议账本 + closure attestation + P0 状态迁移证明 + 完成血缘 + 档位对账
version: 3.0.0
# 版本说明：随当前 3.0.0 版本窗口，用户控版本不 bump。
# 立项动因：2026-07-13 宿主 bc-openCard 假 PASS 事故（memory bc-opencard-fakepass-postmortem）。
# rev2：codex 一轮 9 条→8 采纳 1 部分（"goal 外补跑"不实→截断链语义放大）。
# rev3：codex 二轮 4P0+3P1 全采纳（状态迁移证明/inventory/clean_pass 血缘/状态命名/
# 能力前置闸/out-of-scope/五方冲突）。
# rev4：codex 三轮 3P0+2P1 全采纳（input_fingerprint/降档 receipt/verify-feature-completion
# 唯一入口/全树 inventory/flows 三约束+hit-test）。
# rev5：codex 四轮 3P0+1P1 全采纳，主题=可信链最后一公里——①input_fingerprint 升级为
# phase_closure_fingerprint（绑输入+**阶段产出**+environment；对码实锤：spec-loader.ts:80-88
# 各阶段真实读取面与 rev4 手写表不一致——文件集 SSOT 改为 resolvePhaseEvidenceManifest()
# 复用 spec-loader 表，t8 不再维护手写表）；②降硬门禁授权统一凭证化：交互态"用户在场+
# 账本记录"与伪造 signed_by 同边界，一切 hard-gate-lowering 授权（降档/P0 waiver/
# conditional-review/行为开关豁免/flow_contract）统一消费 confirmation receipt——签发
# 能力落地前交互态照常工作但封顶 AWAITING_HUMAN_REVIEW；③新增 acceptance.flow_contract
# 确认点（首次生成的结构化流程模型须真人确认，堵"spec 结构化地理解错"——本事故语义风险
# 的最前移形态）；④discoverProductSourceRoots() profile-aware 并集发现+两条 fail-safe
# （孤儿产品文件 FAIL/空 inventory FAIL）。
# rev5 曾附带决策点：内置最小 TTY 过渡签发器（开放问题 1）。
# rev6（终版）：codex 五轮 2P0 采纳后有条件通过——①开放问题 1 落定**不做** TTY 过渡签发器
# （当前工具链 agent 可申请 PTY/驱动交互 stdin，isatty 非真人边界；伪安全签发重开同类洞）：
# 本 plan 只做 receipt schema+统一消费+fail-closed，签发全部等 runtime-policy-core（须
# agent 无法自行签发的外部通道+可验签名/MAC——该要求写入协调注记）；落地前含 P0 flow/降档/
# waiver 的 feature 保持 AWAITING_HUMAN_REVIEW，属诚实现状非可用性倒退；②钉死 closure
# fingerprint 无环封装序（receipt 含 fingerprint 又被 hash 的自引用递归）：独立
# phase-evidence-manifest.json 承载 inputs/outputs/规范化 receipt hash（规范化排除
# fingerprint/manifest pointer 字段），manifest 不 hash 自身，receipt/summary 只存
# manifest 路径+sha256，verifier 重算物证再校验 manifest。codex 判定：处理完即 review
# 通过，直接进 OpenSpec proposal/design/specs/tasks，无需第六轮总体设计 review。
# 实施期事实修正（2026-07-13 立项对码，openspec change 已落）：runtime-policy-core 实为
# evidence-policy/phase 枚举**纯重构** change（兼容不变式=输出与现状等值），无带外凭证
# scope——plan 历轮"签发归 runtime-policy-core"的假定与 ground truth 不符。签发改落位
# 独立后继 change `confirmation-credential-issuance`（round7 P0-8 线）；消费契约 SSOT=
# 本 change confirmation-receipts spec，fail-closed 封顶语义不受影响。状态枚举与
# goal-mode-unattended-survival 的 INTERRUPTED 正交可共存（openspec design §3.4/§3.4b）。
---

# goal 无头假 PASS 事故链根治（rev6 定稿）

- **Plan ID**: e3a9c5d1
- **状态**: codex 五轮 review 通过（9→7→5→4→2 条，全部闭合，开放问题清零），待用户开工令
- **改动面**: 大（harness ~14 文件 + 4 新 util + schema/phase-rules + acceptance/ui-spec
  schema 扩展 + OpenSpec change + prompts/skills + 单测）
- **原则**: goal/交互双模式能力拉齐；确定性门禁进 check-*；**一切降低硬门禁的授权双模式
  同一凭证机制，不因"用户在场"降低验证标准**（rev5 起）。
- **协调**: 五方 change（critic-loop-hardening / runtime-policy-core /
  layout-oracle-geometry-gates / goal-mode-unattended-survival / feature-track，均核实
  实存）。带外凭证**签发体系全部**归 runtime-policy-core；本 plan **仅定义 receipt
  schema 与消费校验接口**（不含任何本地/TTY 签发，见 t10）。

## 背景（事故链；对码实锤，历轮已修正口径，rev5 无变化）

run1 spec→review PASS 后 HALTED于 ut;run2 截断链(start_phase=ut)以文本断言上游 PASS,
ut/testing PASS→COMPLETED 被读成需求完成。六洞:fast path 短路真流程零拦截;11/18 skip+
已执行三连验的是 fast path;「完全参考」×7 被 semantic_layout 自降(runner 未解引用);
9 P0 屏视觉零比对(nav 缺失 WARN 吞没);must-review 解析错配静默丢清单;review"有条件
通过+2 MAJOR"照常推进。

## 核实过的事实基线（历轮全部仍成立;rev5 增量）

- **spec-loader.ts:80-88**（rev5 对码）:REQUIRED —— review=[plan.md, acceptance.yaml,
  contracts.yaml] / ut=[spec.md, plan.md, acceptance.yaml, contracts.yaml] /
  testing=[spec.md, plan.md, acceptance.yaml];OPTIONAL —— review=[spec.md] /
  ut=[use-cases.yaml] / testing=[contracts.yaml, use-cases.yaml, review-report.md]
  ——与 rev4 手写输入表不一致,codex P0-1 前提成立;phase evidence 文件集必须以该 loader
  为 SSOT 扩展,不得另表;
- 交互态闸门回答由 agent 落账本,harness 无法区分"用户真答"与"agent 代答"——与
  signed_by 伪造同边界(fidelity-shared.ts:146 自注),codex P0-2 前提成立;
- acceptance/flows 首次生成无"变更"事件,rev4 的"AC 集变更入 must_review"不覆盖首生成
  ——codex P0-3 前提成立;
- 宿主根有 build-profile.json5、doc/module-catalog.yaml(framework.config paths 声明)
  ——root discovery 并集的数据源实存;HMOS 工程可有 entry/src/main 等不在五层目录下的
  模块,codex P1 前提成立;
- 其余基线(spec-loader 之外)见 rev2-rev4。

## 方案（八件主线 + t9 杂项;t1-t5 P0,t6-t8 P1,t9 P2）

### t1 结构化自动决议账本（rev2 定稿;rev5 联动:账本记录**不再单独构成**任何
hard-gate-lowering 授权,授权一律走 t10 receipt——账本只留痕）

### t2 review closure attestation（rev4 全树 inventory + rev5 root discovery 收口）

- 生成点/绑定项/无 grace window/对账语义同 rev4;
- **`discoverProductSourceRoots()`（codex P1 采纳,profile-aware 并集）**:
  outer_layers 下实际存在模块 ∪ build-profile.json5 声明模块 ∪ module-catalog
  package_path ∪ profile 标准产品根(hmos: entry/ 等) ∪ 项目内其余未排除 src/main 候选;
  排除测试/构建输出/framework/doc;
- **两条 fail-safe**:①发现产品源码文件不属于任何 inventory root → FAIL(孤儿文件即
  root discovery 缺陷,fail-closed);②项目类型预期有产品源码但 inventory 为空 → FAIL
  (不对空集生成合法 aggregate hash);
- 并行 feature 触发重审=特性非缺陷(同 rev4)。

### t3 产品行为开关扫描（rev2 定稿;waiver 升干净通道走 t10 receipt）

### t4 P0 结构化业务状态迁移证明（rev3/rev4 骨架 + rev5 flow_contract 确认点）

**（a）spec 期**:flows 注册表、P0 checkpoint 结构化(缺失即 FAIL)、三约束(边须 AC 拥有/
requirement_ref 验存/flow=edges 有序合成)——同 rev4;

**（b）`acceptance.flow_contract` 确认点（codex P0-3 采纳,新增）**:
- 适用条件:存在 P0 device flow、或强视觉意图、或多步交互 feature;
- 确认对象=首次(及每次变更后)的结构化流程模型;receipt 绑定 requirement hash +
  acceptance.yaml hash + flows hash + ui-spec hash;
- 任一 AC/checkpoint/flow/requirement_ref 改动 → receipt 自动 stale(hash 失配);
- headless 无有效 receipt → 照常工作但状态封顶 **AWAITING_HUMAN_REVIEW**,不得
  FEATURE_COMPLETED;交互态经确认 UX 签发(t10);
- 定位:这是对"AC 完整性无法全机器证明"的诚实解——机器管到引文级可追溯,**语义正确性由
  一次绑定 hash 的真人确认收口**,而非假装门禁能证明;
- 本事故对位:`bank_list→add_success` 型错误建模即使三约束全过,也过不了真人对着需求
  确认流程链这一关。

**（c）testing 期对账**:状态迁移证明/hit-test/有序链/anti-replay 签名/物证/双口径
——同 rev4。

### t5 P0 skip/unreachable 治理（rev2/rev3 定稿;豁免升干净通道唯一入口=t10 receipt）

### t6 保真档位（rev4 骨架;授权语义并入 t10 统一凭证）

- 解引用/三态意图/reconciliation/DEFERRED_CAPABILITY_MISSING/--fidelity 只升不降
  ——同 rev4;
- **降档授权(headless 与交互态同规,rev5 收口)**:唯一通道=有效 confirmation receipt;
  交互态"当场问+账本留痕"不再产生干净降档(codex P0-2)——签发见 t10。

### t7 视觉采集完备性（rev3 定稿;out-of-scope 人工确认走 t10）

### t8 feature 完成凭证（rev4 骨架 + rev5 closure snapshot 升级）

- **`phase_closure_fingerprint`（codex P0-1 采纳,取代 input_fingerprint）**,每阶段
  closure 时由 harness/runner 生成:
  ```yaml
  schema_version: ...
  phase: ...
  inputs:   [{path, sha256, role}]   # 该阶段真实读取面
  outputs:  [{path, sha256, role}]   # 该阶段自己产出/认证的 artifact
  environment: {framework_version, profile, workflow_hash, framework_config_hash}
  aggregate_sha256: ...
  ```
- **文件集 SSOT=新 `resolvePhaseEvidenceManifest()`,复用/扩展 spec-loader 的
  REQUIRED/OPTIONAL 表**(spec-loader.ts:80-88),外加各阶段 outputs(spec→spec.md/
  acceptance.yaml/ui-spec.yaml;plan→plan.md/contracts.yaml;review→review-report+
  attestation;ut/testing→receipt+reports 关键件)与 t2 源码 inventory 引用——**t8 不再
  维护独立手写表**,loader 表变化自动传导;
- 失效判定=两消费点重算(截断链 preflight + verify-feature-completion),**inputs 或
  outputs 任一变化 → 本阶段及实际 workflow 链下游 closure 判 STALE**("spec closure 后改
  spec.md/acceptance.yaml 再跑下游"通道关闭——rev4 只堵了输入侧,本轮堵产出侧);
- **无环封装序(rev6 钉死,codex 终轮 P0-2)**——fingerprint 若写进 receipt 又把 receipt
  计入 outputs hash 即自引用递归,实现顺序固定为:
  1. 所有 reports 与 receipt 正文先完成;
  2. receipt 规范化(**排除** phase_closure_fingerprint / manifest pointer 字段)后取 hash;
  3. 生成独立 `phase-evidence-manifest.json`(inputs + outputs + 规范化 receipt hash),
     **manifest 不 hash 自身**;
  4. receipt/summary 只保存 manifest 路径 + manifest sha256;
  5. verify 侧先重算 manifest 所列物证 hash,再校验 manifest sha256——单向链,无环;
- clean_pass 六条件、verify-feature-completion 唯一入口(VALID|STALE|INVALID)、
  completion 原子写 runner-owned 目录+feature 投影、状态枚举、supersede——同 rev3/rev4;
  clean_pass 追加:**flow_contract receipt 有效**(适用 feature)与**无未凭证化的
  hard-gate-lowering 决策**。

### t9 杂项（rev2 定稿:WARN 摘要置顶三类/$r lint/mock 可辨识性/文档）

### t10 confirmation receipt 统一消费（rev6 定稿:仅消费,不做任何本地签发）

- **消费侧(本 plan 实现)**:单一 util 校验 receipt——schema、绑定字段(feature/
  requirement hash/授权对象 hash/原始与目标值/run_id/有效期/签发通道/**可验签名或 MAC**)、
  stale 判定;五个消费点:降档(t6)/P0 skip-unreachable waiver(t5)/conditional-review
  授权(t2 消费面)/行为开关豁免(t3)/flow_contract(t4b);
- **信任锚强制条款(codex 终审 P1,写入 OpenSpec 验收,不留实现自由度)**:
  - receipt 必含 `receipt_id / issuer_id / key_id / alg / payload_schema_version`,并
    绑定 run_id/feature/action/object_hash/expiry;
  - 签名覆盖**规范化 payload 全体**,不得只签部分字段;
  - verifier 验证公钥**只能**取自预置可信 registry / runtime policy 配置——**禁止信任
    receipt 内嵌公钥或临时提供的验证密钥**(否则 agent 自生成密钥+自签+附公钥即绕过);
  - unknown issuer / key / algorithm 一律 INVALID;
  - MAC 仅在验证密钥对 agent 不可读的部署形态下允许,否则必须非对称签名;
  - 支持 key rotation / revocation(registry 侧字段预留,吊销即既有 receipt 失效);
- **签发侧一律不在本 plan**(rev6 落定,codex 终轮 P0-1):rev5 曾议的 TTY 过渡签发器
  **不做**——当前工具链 agent 可申请 PTY、驱动交互 stdin,isatty 不构成真人边界,伪安全
  签发会重开本 plan 根治的同类洞;runtime-policy-core 须提供 agent 无法自行签发的**外部
  通道**且 receipt 携带可验签名/MAC(协调注记,共评审时提入);
- **无有效 receipt 的统一后果**:工作可继续,状态封顶 AWAITING_HUMAN_REVIEW,永不
  FEATURE_COMPLETED——双模式一致,交互态不豁免;**在 runtime-policy-core 落地前这是
  诚实现状**:含 P0 flow/降档/waiver 的 feature 就是没有可信授权源,不为拿终态造伪授权。

## OpenSpec 与 schema

rev4 基础上增量:phase_closure_fingerprint schema(inputs/outputs/environment)、
flow_contract 确认点登记(confirmation-registry.yaml)、receipt schema 与签发通道枚举
(与 runtime-policy-core 共评审,**t10 信任锚条款为强制验收项:预置可信 registry 取键/
禁内嵌公钥/unknown 一律 INVALID/规范化全量签名/rotation-revocation**)、
discoverProductSourceRoots 契约;冲突清单五方。

## 实施顺序（codex 终审建议,采纳为排批基线）

1. OpenSpec change 立项,先完成五方冲突矩阵;
2. 与 runtime-policy-core 定稿 receipt schema、信任锚与签名规范;
3. 先落地基座:phase-evidence-manifest / closure fingerprint / attestation /
   verify-feature-completion;
4. 再接门禁面:P0 flow(t4)/skip 治理(t5)/fidelity(t6)/visual 完备性(t7)/行为开关(t3);
5. 最后:bc-openCard 事故 fixture 全剧本 + 完整 harness 单测 + openspec:validate +
   release:verify + consumer smoke。

## 单测计划（cd harness && npm test 全绿为准;rev5 增量加粗）

- t1/t3/t5/t7 同前;
- t2:四态对账+未登记文件+漏报模块 fixture + **root discovery 并集(entry/src/main 型
  模块命中)+孤儿产品文件 FAIL+空 inventory FAIL**;
- t4:rev4 全集 + **flow_contract:适用条件判定/receipt hash 绑定/AC 改动即 stale/
  headless 无 receipt 封顶 AWAITING_HUMAN_REVIEW**;
- t6:rev4 全集(降档 receipt 校验并入 t10 单测);
- t8:clean_pass 否证 + **outputs 变更(spec closure 后改 acceptance.yaml)→ 下游 STALE**
  + **manifest 与 spec-loader 表一致性(loader 表增删文件自动传导)** + **无环封装序
  (fingerprint 字段剔除后的 receipt 规范化 hash 幂等;manifest 不含自 hash;verify 单向
  重算收敛)** + verify 三态 + track 链 + 状态投影;
- **t10:receipt schema/绑定失配/过期/stale/缺签名 拒收;agent 手工构造无签名 receipt →
  INVALID;**agent 自生成密钥自签+附内嵌公钥 → INVALID(信任锚回归用例)**;unknown
  issuer/key/alg → INVALID;五消费点接线;无 receipt 状态封顶(交互态同 headless)**。

## 验收

1. `cd harness && npm test`;`npm run openspec:validate`;`npm run release:verify`;
   `release:smoke-consumer`;
2. bc-openCard 事故现场回归剧本(只读引用宿主):
   - 历轮全部剧本(双格式账本≥22 条/BankAddConstants→t3/事故 trace→t4 缺中间屏/
     10 P0 skip→t5/摘要 vs 解引用两态/无视觉→DEFERRED/--fidelity 降档无效/
     conditional INCOMPLETE/截断链拒启/伪造 completion→INVALID);
   - **rev5 新增**:spec closure 后篡改 acceptance.yaml → 截断链 preflight STALE;
     `bank_list→add_success` 错误 flow 三约束全过但无 flow_contract receipt →
     封顶 AWAITING_HUMAN_REVIEW;交互态账本自记"用户同意降档"无 receipt → 不产生
     干净降档;宿主 build-profile 增虚拟 entry 模块 → inventory 命中。

## 不做什么（边界）

- **任何本地/TTY 签发器不做**(rev6 定稿)——签发全部归 runtime-policy-core(外部通道+
  可验签名/MAC);本 plan 只做 receipt schema+统一消费+fail-closed 封顶;
- 不做自动回流编排;不动 verifier prompt;不做 cursor SubagentStop 拉齐;不改宿主;
  物证采集与 layout-oracle 共用;常驻失效 DAG 不做(两消费点重算)。

## 开放问题

**无。** rev5 开放问题 1(过渡签发器)按 codex 终轮论证落定为不做:PTY 可被 agent 申请、
交互 stdin 可被驱动,isatty 非真人边界——为终态引入伪授权与本 plan 根治目标自相矛盾。
落地前含 P0 flow/降档/waiver 的 feature 保持 AWAITING_HUMAN_REVIEW 是诚实现状。
codex 五轮 review 结论:处理完终轮两点后**通过**,直接进 OpenSpec proposal/design/
specs/tasks,无需第六轮总体设计 review。

## Todo（2026-07-13 实施完毕；⚠️=实施期如实收窄，SSOT 见 openspec change tasks.md）

- [x] OpenSpec change 立项 + 五方冲突清单 + receipt/fingerprint schema 共评审（事实修正：
      runtime-policy-core 无凭证 scope→签发落位后继 change；INTERRUPTED 正交共存）
- [x] t1 JSONL 账本 + registry 交叉核验 + 单测（7 例，事故双表格式 fixture）
- [x] t2 attestation + discoverProductSourceRoots 五源并集 + 双 fail-safe + 单测（6 例，
      含"新增整模块隐身"复现；对账走 冻结 roots ∪ 当前重 discovery）
- [x] t3 行为开关扫描 + 坐标级 waiver + coding/testing 双接线 + 单测（BankAddConstants fixture）
- [x] t4a flows/checkpoint + 三约束 + requirement_ref 验存 + check-spec 门禁 + 单测
- [x] t4b flow_contract 确认点 + 状态迁移对账（派生计划 step 级）+ 有序链 + 事故 fixture +
      单测；⚠️ 运行时坐标 hit-test/页面签名 anti-replay 需 Hylyre provider step 级采集扩展
      ——deferred（trace 现无 step 观测；本层已确定性击杀全部事故形态，已入 testing-rules 声明）
- [x] t5 skip 治理 + await_human_p0_skip 全链 halt 分类/引导 + 单测；⚠️ unreachable 的
      nav-config 条目消费（capture 跳过+封顶）留待 visual-diff-nav validate 扩展
- [x] t6 解引用 + 三态 + reconciliation + DEFERRED_CAPABILITY_MISSING + --fidelity 只升不降 +
      单测（codex P1-7 两用例分离）
- [x] t7 nav 完备性 BLOCKER（档位无关/单屏门槛）+ ux_reference_mapping + out-of-scope 加界
- [x] t8 phase_closure_fingerprint + resolvePhaseEvidenceManifest + 无环封装序 +
      clean_pass（含⑦flow_contract）+ verify-feature-completion + 状态枚举迁移 +
      截断链 preflight + --supersede + goal-status feature_status + 单测
- [x] t9 WARN 摘要（置顶类）+ $r lint（落 hmos profile——root-zero-host-name 元测试拦下
      根级实现后修正）+ 文档四件（§9.3/runbook/device-testing 红线/MIGRATION 四条 breaking）
- [x] t10 receipt 消费 util（信任锚六条款+自签内嵌公钥回归）+ 五消费点接线 + 单测（不做签发器）
- [x] 验收：typecheck 0 错 + unit 1917/1917 + fixtures 44/44 + openspec:validate 35/35 +
      release:smoke-consumer PASS；⚠️ release:verify 的 plan-version 门禁被**既有** 5 个
      3.0.0 未完成 plan（consumer-guard/critic-loop/轻量化/layout-oracle/signed-hap）挡住
      ——非本 change 引入，发布前须各自收口

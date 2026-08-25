# Design — blind-visual-hardening

## 1. 关键决策（四轮 review 备注的正式落点）

### 1.1 两切片过渡（codex 四轮①）

切片一**不依赖**尚未实现的切片二：负面结论（review 不通过 / testing 不达标）在切片一直接产出
**现有结构**——check 结果 `status:FAIL severity:BLOCKER` → 顶层 `verdict=FAIL` + `blockers[]`；
跨阶段传播消费旧结构（下游 phase 启动时读上游 summary.json 顶层 verdict + blockers +
receipt 新鲜度）。切片二引入 schema 1.1 后，传播消费面切换 `quality_axes` SSOT；
切换点单点（`upstream-verdict-gate.ts` 内部按 schema_version 分支），消费方无感。

### 1.2 report_validity 落盘位置（codex 四轮②，二选一定案）

**定案：独立顶层字段 `report_validity: PASS | FAIL | UNVERIFIED`，不放进 quality_axes。**
理由：report validity 是「报告工件可解析/可信」的属性，不是产品质量轴；放进 quality_axes
会诱使消费方把它当产品轴参与 release 判定（required_for_release 对它无意义）。
现 `conclusion_with_verdict` 等报告合法性检查归入 report_validity 计算；产品裁决走 quality_axes。

### 1.3 P0-B 渲染可见性终态债务门控观察（3.0.0 收尾决定）

`render_visibility_calibrate` 保留为稳定 check id 的 r1-debt-gated 观察节点：冻结正样本
（本事故 6 屏截图：空白图标区）≥6、反样本（VL 宿主正常截图 + 扁平合法 UI：纯色背景卡片/
大留白设计）≥10 与版本化阈值。命中以 MAJOR/WARN 结构化 findings 落入 visual-debt；open debt
令 visual 轴 UNVERIFIED 并阻断 release。不会再为同一像素启发式事实增设独立 phase BLOCKER/
`enforce`：它会形成重复阻断，且单次误报会伤害无人值守运行。宿主两 run 只用于误报记录、
夹具扩充和阈值校准；若将来需要新硬门，须以该证据单独立项。

### 1.4 债务状态 accepted ≠ closed（codex 四轮④）

visual-debt 条目状态枚举：`open | closed | accepted`。closed=已修复（三态清偿或检查转绿）；
accepted=仍存在但用户经 receipt 显式接受（记 `accepted_by` + `acceptance_receipt` 引用）。
两者均不再阻断 release；审计语义分立，报表分列。

### 1.5 P1-E 措辞（codex 四轮⑤）

规格用语统一为：「产出单项可判事实与结构化 finding；**硬不变量可以阻断**（离散事实：必需节点
缺失/文案错误/空白素材/状态相反 → visual FAIL, needs_fix），**连续指标默认 advisory**
（色差/间距/bbox 偏移），仅高置信指标持续退化且超过冻结阈值才升级；禁止用单一全局相似度
直接裁决整体质量」。

### 1.6 crop provenance 可接受来源枚举（cursor 四轮①）

`crop provenance 可验证` 定义为下列之一（缺一即不满足）：
- `external_tool`：外部裁剪工具产物 + 工具名 + 源图 hash + bbox 记录；
- `human_receipt`：人签 confirmation receipt（走 confirmation-receipts 信任链）绑定产物 hash；
- `verified_artifact`：既有 asset-crop-validation.json 中 verified 状态 + 产物 hash 一致。
裸 `user_requirement` 哨兵**不作**验真金牌（沿 P0-6 既有语义：需求级授权≠条目级验真）。

### 1.7 锚点字符集与长度（cursor 四轮②）—— **已作废（2026-08-25，plan e6b3f8d2 t3）**

原设计规定实例语义锚点的段字符集与长度上界。随 d3 撤回，该锚点机制整体删除：
selector 真值回归**普通 ui-spec `node.id` / `text`**，不再有 framework 侧规定的
锚点语法、子件后缀契约或其反解逻辑；页面身份判据改用既有 `visual-diff-nav`
screen identity 声明（只取 `all_of`/`any_of` 正向 id，按精确 id 判在场）。

### 1.8 rubric 首跑预期（cursor 四轮③）

每维 ≥4/5 冻结阈值下，盲宿主第一轮预期走「显式接受债务」（accepted_debt_ids）而非一次清完
——设计内诚实成本。交互告知文案（vision.blind_tier 动线 + asset-request 确认）须包含此预期，
不得暗示「首轮即全绿」。

### 1.9 deterministic_feedback 派生（不可配置关闭）

策略位由 harness 按 `effective_image_input=none ∧ ui_change=new_or_changed` 机器派生；
不进 framework.config 用户可写面（防 agent/用户静默关闭盲档反馈采集）。

### 1.10 反馈身份字段

`framework_version + framework_package_digest + gate_fingerprint + framework_commit_sha(null|str)`。
package digest 源：发布件 `framework/RELEASE-MANIFEST.sha256` 内容 hash；git 仓开发态
commit_sha 有值，消费者发布包环境为 null——两者至少其一非空。

## 2. 与现行机制的对齐（不重复造轮）

| 本 change 需要 | 复用存量 | 增量 |
|---|---|---|
| FAIL/求人分流 | `CleanPassIssueKind`（verify-feature-completion.ts:99）+ `resolveGoalRunStatus`（phase-transition-policy.ts:285） | resolution.class 映射表；无新状态机 |
| 「有条件通过」闭环 | `conditional_pass_closure`（check-review.ts:889） | 补「不通过」分支（同纹理新 check） |
| 裁决词提取 | `extractDeclaredVerdict` 唯一入口 | 零改动，仅新增消费方 |
| nav 完备性 | check-testing.ts:2194（t7，档位无关 BLOCKER） | 仅回归测试锁行为 |
| 收敛/熔断 | visual-rounds-ledger `evaluateVisualRound` | 输入扩展（feedback delta），不并行 |
| receipt 消费 | confirmation-receipt.ts 信任锚六条款 | 新 action：human_visual_acceptance |
| 意图三态 | goal-fakepass t6 `evaluateFidelityTierPreflight` 等 | 同源函数在 harness-runner spec 前置钩子复用 |
| 素材 crop 验真 | asset-crop-validation.ts（sanity 阈值系 crop 校准） | role-aware 阈值另表；不平移 |
| must_review 封顶 | headless-assumptions + AWAITING_HUMAN_REVIEW cap | visual 债务接同通道 |

## 3. 并行 change 冲突面

- `goal-fakepass-hardening`：**已落地为基线**（本 change 大量复用其 t6/t7/t10 产物）；
  其 spec 中 fidelity 意图检测「Before phase prompting, the runner SHALL…」措辞为 goal 路径，
  本 change d4 扩面到逐阶段路径属**增补不冲突**（同源函数）。
- `critic-loop-hardening` / `layout-oracle-geometry-gates`：visual-diff 域基线；d6 的
  visual-feedback.json 与其 visual-diff.json 产物并存（feedback=喂 agent 的修复输入，
  diff=门禁证据），design 时字段避免重名。
- `runtime-policy-core`：receipt 签发仍不在本 change（消费 only）。

## 4. 回滚与兼容

- schema 1.1 写入端单点（harness-runner summary writer）；回滚=writer 降回 1.0，消费方
  按 schema_version 分支天然兼容。
- 负面裁决 gate（切片一）独立 check id（`negative_verdict_closure`），可按 phase-rules 登记
  开关回滚，不与洞⑥纠缠。
- ~~UI kit scaffolder 幂等~~ —— d3 已撤回（2026-08-25）：scaffolder 与其幂等三态一并删除，
  framework 不再向宿主源码树写入任何组件实现，故无回滚项。

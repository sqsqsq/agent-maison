# P2 — Phase 内 checkpoint / resume：重阶段超时续跑而非整阶段重来

> 拆自 `review超时根因…c3f08a21.plan.md` 的 P2，按用户要求单独立项。
> 范围：跨阶段，但价值集中在**重阶段**（coding / review / testing）。架构级改动，独立排期。
> 前置：建议在本轮 P0+P1 落地、验证稳定后再启动（P1-B 的"重试复用 partial"是本计划的轻量前驱）。

---

## 一、要解决的根问题

当前 goal-runner 的最小执行单元是**一次完整 attempt**：超时（[goal-runner.ts:1159](harness/scripts/goal-runner.ts) 默认 3600s）即 kill，已做的工作**全部作废**，重试以 fresh-context 从零重做。

- 重 review：19 文件逐读 + contracts 一致性 + 21 文件 context-exploration + 8 条结构化报告，单次天然逼近/超过预算，**一旦超时几乎必然重做全部探索**。
- P1-B 只做到"把 partial 报告回喂给下一次 fresh-context"，**减少**重复但仍是"重启一次完整 attempt"。
- 真正的根治是把 phase 内部变成**可中断、可续跑**：超时时落盘进度与已完成子任务，重试从断点续，而非重头。

这是"从根解决、非单点"的最后一块：把"attempt 级原子性"降到"子任务级原子性"。

---

## 二、设计方向（待评审细化）

### 方案 B：以"可验证产物"为断点证据（**首版主干，采纳 codex**）
- **不新建弱自述文件**。复用已有可机器验证的产物作为断点证据：
  - `context-exploration.md` —— 已有 [context-exploration.ts:443](harness/scripts/utils/context-exploration.ts) `checkContextExplorationArtifact` 校验存在性、frontmatter、`ready_to_produce`、最低输入覆盖、量化阈值。
  - review-report.md / test-report.md / receipt / summary.json —— 已有结构门禁。
- checkpoint **引用这些产物 + 记录文件 hash/mtime**，续跑时校验产物未被篡改、已覆盖文件可信，跳过已覆盖部分。
- 优点：断点证据天然可证伪，复用既有门禁，落地成本低。
- 缺点：探索段覆盖好，报告组装/对账段的细粒度断点仍需方案 A 兜。

### 方案 A：声明式子任务清单 + 完成态落盘（补方案 B 未覆盖段）
- 重阶段 skill 显式声明可分解子任务（review：探索/逐文件分析/contracts 对账/报告组装）。
- 每完成子任务落 `checkpoint.json`（已完成子任务 + **指向方案 B 的可验证产物 + hash**，而非纯自述）。
- 续跑时 runner 注入 checkpoint：「X 已完成并产出 <可验证产物>，从 Y 继续」。
- **关键：checkpoint 必须机器可验证**——子任务"已完成"的声明必须能对应到方案 B 的真实产物，否则视为未完成（防"假断点"，参照 receipt/closure 既有可证伪思路）。

### 方案 C（最重）：runner 级子步 checkpoint + 真分段调度
- 把 phase 拆成可独立调度的 sub-invoke，每 sub-invoke 独立超时与续跑。
- 优点：粒度最细、最鲁棒。
- 缺点：动调度内核、改 manifest/进度模型，回归面大；建议仅当 A+B 仍不够时再上。

**建议路线（采纳两份 review 收敛）**：**B（可验证产物为断点）为首版主干** + A（声明式子任务）补未覆盖段；**C 明确不进首版**（两位 reviewer 一致）。**首版只落 review/testing 两个重阶段验证**，不一上来全 6 阶段统一机制（见待决策点④倾向）。

---

## 三、待评审决策点
- [ ] checkpoint 落盘格式与位置（`<report_dir>/phases/<phase>/checkpoint.json`？）
- [ ] checkpoint 真实性门禁：如何防 agent 谎报"子任务已完成"（参照 receipt/closure 既有可证伪思路）
- [ ] 续跑注入与 P1-B prior-failure 回喂的合并边界（避免重复/冲突）
- [ ] 适用阶段范围：仅 coding/review/testing，还是全 6 阶段统一机制
- [ ] 与 `max_total_turns` / `wall_clock` 预算的计费关系（续跑不应绕过总预算）
- [ ] **探索预算前置**（两份 review 共识增量）：plan/coding 首次超时、重试反而过 → fresh-context **首跑探索发散**。可在重阶段 skill 显式声明探索预算/产物清单（与子任务清单同源），让首跑就聚焦。与本计划子任务清单合并设计。
- [ ] **wall vs 重试预算**（c3f08a21 round-2 延后）：当前派生 wall 只保证"单次无重试满预算跑完"；重 retry（如 review 120min×2）长跑仍会撞 wall。checkpoint/resume 落地后，重试应只补差额而非整阶段重算，从根上解掉"重 retry 撞 wall"。
- [ ] **--resume 跨进程 partial 复用**（c3f08a21 round-2 延后）：`priorAttemptTimedOut` 进程内初值 false，resume 续跑首轮拿不到上轮超时信号 → P1-B partial 提示不注入。补法=从 events.jsonl 回读上轮 `timed_out`，与本计划"以可验证产物为断点"天然同源，一并实现。

## 四、验收（首版目标，可证伪）
- 构造一个会超时的重 review：第一次超时落 checkpoint（含已检视 N 文件）；续跑日志显示**跳过**已检视文件、仅补未完成子任务，总耗时显著 < 两次全量。
- 断点真实性门禁：伪造未完成的 checkpoint 标"已完成" → 门禁 FAIL。
- 不破坏既有 goal 单测与 P0/P1 行为。

## 五、约束
- 架构级改动，回归面大：必须有充分单测覆盖调度路径后才合入 main。
- 不擅自 bump（[[version-bump-only-on-request]]）；落 main（[[no-branch-without-request]]）；与 P0/P1 解耦，可独立交付。

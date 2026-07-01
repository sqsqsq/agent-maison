---
name: P2 — Phase 内 checkpoint/resume：重阶段超时续跑而非整阶段重来
version: 2.4.0
overview: >
  把 attempt 级原子性降到子任务级：超时重试时 runner 从可验证产物派生断点、注入续跑 skip-list。
  四重阶段（review/coding/plan/ut）增量写 + 三重验真（真实存在∩审查范围内∩本run）+ 章节级断点
  + 跨进程恢复。全绿并已提交（16a84cf / 25f14f18）。端到端实跑验收与 partial-chapter 打磨延后，
  见正文"本轮不做"。
todos:
  - id: v1a-runner-checkpoint
    content: goal-checkpoint.ts deriveResumeInspection/deriveReportSections/deriveAndWriteCheckpoint/跨进程回读 + runner 注入
    status: completed
  - id: v1a-skill-incremental-write
    content: review/coding/plan/business-ut 四重阶段 context-exploration 增量写
    status: completed
  - id: round3-scope-verify-honesty
    content: skip-list 补 contracts.files 范围验真（含格式不匹配兜底）+ 越界/兜底测试 + plan 表述诚实化
    status: completed
---

# P2 — Phase 内 checkpoint / resume：重阶段超时续跑而非整阶段重来

> 拆自 `review超时根因…c3f08a21.plan.md` 的 P2。P0+P1 已提交（commit e371533f）。
> 范围：价值集中在**重阶段**（review / testing，首版），架构级、回归面大。
> 状态：**v1a 已实现，待 review**（用户已批准 v1a）。全绿：typecheck + 1308 单测 + 35 fixtures。

---

## ✅ v1a 实现完成（待你 review）

- **skill 增量写**（唯一 agent 侧改动，**已覆盖全部重阶段**）：边探索边 flush（每 ~5 文件更新 `source_code_paths`/`files_inspected_count`，`ready_to_produce` 完成才置 true）——[review](skills/feature/code-review/SKILL.md) + [coding](skills/feature/coding/SKILL.md) + [plan](skills/feature/plan/SKILL.md) + [business-ut](skills/feature/business-ut/SKILL.md)（ut，含 ≤300 行约束适配）。spec 轻量不纳入。
- **探索进度读取器**：[context-exploration.ts](harness/scripts/utils/context-exploration.ts) 导出 `readContextExplorationInspection` + `isContextExplorationPhase`。
- **runner 派生断点**：新增 [goal-checkpoint.ts](harness/scripts/utils/goal-checkpoint.ts)——`deriveResumeInspection`（已检视∩真实存在∩本run 的 skip-list，验真防伪造）、`deriveReportSections`（从 partial 报告取二级标题=已写章节，**章节级断点**）、`buildResumeSkipLines`、`deriveAndWriteCheckpoint`（runner 从产物派生 checkpoint.json + sha256/mtime + `report_sections_done`）、`readPhaseCheckpointTimedOut`（跨进程 resume 回读）。
- **注入**：[goal-runner.ts](harness/scripts/goal-runner.ts) 超时重试时把 skip-list（探索段）/已写章节（报告段"只补未写章节"）拼进 P1-B 续作块；每次 attempt 落 checkpoint.json；resume 首轮从 checkpoint 回读上轮 timed_out（补 c3f08a21 跨进程缺口）。
- **通用性**：runner 逻辑对所有有探索产物的 phase（review/coding/plan/ut）生效——报告段超时注入"探索已完成 + 已写章节"；**四个重阶段均含增量写**，探索途中超时也覆盖。testing 无探索产物 → 回落 P1-B。spec 轻量不纳入。
- **测试**：[goal-checkpoint.unit.test.ts](harness/tests/unit/goal-checkpoint.unit.test.ts) 10 例（exploring/验真剔除/陈旧拒绝/非探索回落/reporting/文案/章节级/deriveReportSections/checkpoint 落盘回读含 report_sections_done/缺档案）+ buildPhasePrompt skip-lines 注入。全绿 1310 单测 + 35 fixtures。

### Round-3 review 处置（cursor/codex 收口）
- **scope 交集验真**（cursor#1 / codex P2，已修）：deriveResumeInspection 补 contracts.files 交集 + 越界/兜底单测；测试注释不再虚标覆盖。
- **"结构上无法伪造"表述**（cursor#2，已修）：改为"skip-list 验真 + 报告门禁"分层，见上。
- **跨进程 skip-list 恢复**（codex P1，**核实为误读**，无需改）：codex 以为 resume 用新进程 wallClockStartMs 会过滤掉旧产物；实际 [resolveWallClockStartMs](harness/scripts/utils/goal-runner-phase.ts) 读第一个 run_start = **原始 run 起点**，旧进程产物 mtime≥原始起点 → 过得了过滤，skip-list 能跨进程恢复（cursor 亦确认此点）。

### ⏸ 本轮明确不做（记录在案，待宿主测试后再规划）
- **端到端实跑验收（§五 e2e）**：只用单元测试锁住 derive/inject/验真/陈旧/越界/跨进程逻辑；**未跑真实 goal 超时续跑 e2e**（需能真实触发超时的长跑环境，用户将发新版到宿主实测后再定）。
- **章节级 partial-chapter 边界**（cursor#3，低）：`deriveReportSections` 把"有二级标题"即算已写章节，"标题在但内容未完"的章节也会被算入 → 续跑"只补未写"可能让 agent 跳过补全该章节。靠报告门禁内容完整性兜底，低风险；P2 v2 可细化为"章节非空/达最小长度才算已写"。

---

## 一、根问题 + 核心设计发现（已核实代码）

goal-runner 最小执行单元是**一次完整 attempt**：超时（per-phase，见 goal-timeout）即 kill，已做工作全废，重试 fresh-context 从零重做。P1-B 只把 partial 报告回喂，仍是"重启一次完整 attempt"。

**核实发现（决定设计的关键）**：review 的 context-exploration.md 是在
[code-review/SKILL.md:124 Step 1.5](skills/feature/code-review/SKILL.md) **探索全部完成后一次性落盘**（Step 2 写报告之前）。于是超时分两种：

| 超时发生点 | context-exploration.md | 现状可续跑性 |
|-----------|----------------------|------------|
| **探索途中**（读 19 文件，**最大耗时段**） | 尚未落盘 | ❌ 无任何断点，全部重读 |
| 报告写作段（Step 2） | 已落盘（ready_to_produce=true） | ⚠️ P1-B 已回喂文件，但无"哪些已检视"结构化信息 |

→ **首版必须让"探索途中超时"也有断点**，否则治不到最大耗时段。

**关键门禁事实**：[context-exploration.ts:524](harness/scripts/utils/context-exploration.ts) 在 `ready_to_produce!==true` 时判 BLOCKER FAIL。这正好**利好**——partial（未完成）探索本应 FAIL→触发重试；runner 只需在重试时从盘上这份 partial 文件**挖出已检视文件清单**做续跑，**无需改门禁**。

---

## 二、首版设计（v1，推荐）：增量探索产物 + runner 派生 checkpoint + 结构化续跑注入

核心原则（codex"以可验证产物为断点、不靠 agent 自报"推到极致）：
**checkpoint 由 runner 从盘上真实产物"读现实"派生，agent 永不自报完成度**。
> 诚实说明（cursor round-3 修正）：skip-list 的验真只证"文件已登记∩真实存在∩审查范围内"，**不证"确实读过/读懂"**——existsSync 不等于已理解。真正兜底假断点的是**门禁分层**：下游报告门禁强制逐文件覆盖/分析，false-skip 会导致报告不完整→FAIL→重试自纠。故安全来自"skip-list 验真 + 报告门禁"两层，而非 skip-list 单点"无法伪造"。

三个改动：

### (1) skill：context-exploration.md 增量写（唯一 agent 侧行为改动）
- review/testing 的 Research Sub-Phase 改为**边探索边落盘**：每读完一批（如每 5 个）待审文件，flush 一次 frontmatter（更新 `source_code_paths` / `files_inspected_count`，`ready_to_produce` 保持 false），全部完成再置 true。
- 已声明待审文件清单（Step 1 已有）→ 天然是"探索预算前置/子任务清单"，首跑就聚焦、不发散（吸收两份 review 的"探索发散"共识）。

### (2) runner：超时重试时从产物派生 checkpoint + 注入结构化续跑
- 在现有 [goal-runner.ts collectTimeoutResumableArtifacts](harness/scripts/goal-runner.ts)（P1-B）基础上扩展：解析盘上 context-exploration.md frontmatter，取**已检视且真实存在**的 `source_code_paths`（与 contracts.files 交集，验真），构造 skip-list。
- 注入 prompt（扩展 P1-B 续作块）：
  「上次超时中断。已检视并登记的 N 个文件：{list}，**勿重复 Read**；从**未登记文件**继续探索，补全 context-exploration.md 后再产出报告。」
- 报告段：若 context-exploration.md 已 ready_to_produce=true 但报告 partial → 注入"探索已完成，续写报告剩余章节"（复用 P1-B partial 报告 + mtime 守卫）。

### (3) checkpoint.json（runner 派生，仅观测/续跑态）
- `<report_dir>/phases/<phase>/checkpoint.json`：runner 每次 attempt 后**从产物计算**写入
  `{ stage: 'exploring'|'reporting', inspected_files: [...], report_sections_done: [...], evidence: { context_exploration: {path, sha256, files_inspected_count, mtime}, report: {path, sha256, mtime} } }`。
- **agent 不写它**——它是 runner 对"盘上现实"的快照。防假断点=天然（读的就是真实产物 + hash + mtime 在本 run 内）。

> 无需方案 C（分段调度内核）；无需改 context-exploration 门禁；agent 侧只加"增量写"一条。

---

## 三、决策点（已定/给建议，待你拍板）
1. **落盘格式/位置**：`<report_dir>/phases/<phase>/checkpoint.json`，**runner 派生**（非 agent 自写）。✅ 建议采纳。
2. **防假断点（分层，非单点）**：runner 从产物读现实 + hash + mtime∈本run + skip-list 三重验真"已登记∩真实存在∩审查范围内(contracts.files 交集，含格式不匹配安全兜底)" + **下游报告门禁强制逐文件覆盖**兜底 false-skip。scope 交集已落地（[goal-checkpoint.ts loadContractsFileScope + deriveResumeInspection](harness/scripts/utils/goal-checkpoint.ts)，越界/兜底均有单测）。✅
3. **与 P1-B 合并边界**：P2 = P1-B 的超集。P1-B 给"partial 文件清单"，P2 再叠加"哪些文件已检视"的**结构化 skip-list**。同一注入块，去重。✅
4. **适用范围（已核实纠偏）**：context-exploration.md 仅 spec/plan/coding/review/ut 产出，**testing 无探索产物**（靠 trace）。故：
   - **runner 派生/注入做成通用**——凡该 phase 盘上有 context-exploration.md 即挖 skip-list，天然覆盖 review/coding/plan/ut；无此产物者（testing）自动回落 P1-B 报告复用。
   - **skill 增量写 v1 只做 review**（已核实主痛点）；coding/plan/ut 同法留 v2；testing 不适用本机制。
5. **预算计费**：续跑仍按正常 turn 计入 `max_total_turns`/`wall`，**不绕过总预算**；收益来自"少做重复功"而非加预算。这也顺带缓解 c3f08a21 遗留的"重 retry 撞 wall"（每次 retry 做得更少→更易在剩余预算内收敛）。✅
6. **--resume 跨进程**（c3f08a21 遗留）：checkpoint.json 落盘后，resume 新进程**直接读它**即可拿到上轮进度（含是否超时），补掉"priorAttemptTimedOut 进程内丢失"。✅ 与本设计天然同源。

## 四、需你拍板的一个取舍
- **v1a（推荐）**：含 skill"增量写"改动 → 覆盖**探索途中超时**（最大耗时段），但改了重阶段 agent 行为、需回归。
- **v1b（最小）**：纯 runner 侧，只用探索**完成后**的产物 → 只覆盖报告段超时，不改 skill。落地更快但治不到最大耗时段。

倾向 **v1a**：不解决探索途中超时，等于没治现场那 60min 的主要构成。

## 五、验收（可证伪）
- 构造会在**探索途中**超时的重 review：首次超时落 partial context-exploration.md（已登记 N 文件）+ checkpoint.json；续跑日志显示 skip 已登记文件、只读剩余，**总耗时显著 < 两次全量探索**。
- 报告段超时：续跑复用 partial 报告 + 探索产物，不重探索。
- 防假断点：手改 checkpoint.json 标记多余"已检视"文件（盘上不存在/超范围）→ skip-list 不采纳该文件（验真拦截）。
- resume 跨进程：kill 后 --resume，新进程从 checkpoint.json 恢复 skip-list。
- 既有 goal 单测 + P0/P1 行为不破。

## 六、约束
- 架构级、回归面大：调度路径充分单测后才合入 main。
- 不擅自 bump（[[version-bump-only-on-request]]）；落 main（[[no-branch-without-request]]）；改进合并进既有文件（[[merge-not-new-files]]）；与 P0/P1 解耦可独立交付；goal/普通模式能力拉齐（[[goal-and-normal-mode-capability-parity]]）。

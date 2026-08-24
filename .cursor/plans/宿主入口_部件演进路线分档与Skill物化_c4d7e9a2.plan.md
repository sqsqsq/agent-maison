---
name: 宿主入口 — 部件演进路线分档与蓝图 Skill 物化补链
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g6-change-unit-feature-pipeline-integration
  - g8-real-host-development-and-governance
relation: core
layer: governance
goal_requires:
  - real-host-admission-contract
  - component-blueprint-to-closure-mechanical-loop
goal_provides:
  - host-entry-routing-for-component-evolution
  - blueprint-skills-materialized-on-all-hosts
real_host_validation: >
  本 plan 修的是"宿主侧进得去"：让宿主用户与主 agent 在需求进来时看得见部件演进路线、
  敲得出三个蓝图 Skill 的命令/跳板。由 framework-init 物化实测与一致性单测证明，不宣称
  宿主语义验收。
parallel_authority_added: false
todos:
  - id: t1-routing-and-skill-table
    content: >
      宿主入口文案：`templates/AGENTS.md.template` §4.0 在分档表**之前**加一句"先判路线、再判
      L0/L1/L2"，表**之后**加"部件演进路线（蓝图 + 多 CU）"小段。该小段**只含三样东西**：
      ①它是 L0/L1/L2 之前的路线选择，**不是第四档、也不是 `track_scoring` 机器档位**，选中后各 CU
      仍按既有分档施工；②简短流程（准入 → 蓝图 → 拆 CU → 各 CU 按既有分档施工 → 部件闭环）；
      ③一条指向 M6 契约"进入判据与时机"的链接。**判据正文、时机、升级信号一律不写进 AGENTS.md**。
      §4.0.1 Skill 总表补三行（app-component-blueprint / change-unit-progression /
      component-closure）。判据全文只在 M6 契约
      `skills/reference/real-host-admission-and-feedback.md` §1 新增"进入判据与时机"小节成文一次。
    status: completed
  - id: t2-materialize-commands-and-bridges
    content: >
      静态物化链补齐：claude / cursor / codeagent 三宿主 `templates/commands/` 各新增
      app-component-blueprint.md、change-unit-progression.md、component-closure.md，
      **照各宿主既有普通命令样式**（对齐 code-graph.md：claude 无身份行；cursor 为
      `> 运行身份：cursor（薄入口…）`；codeagent 为 `> 运行身份：codeagent（薄入口…）`，身份行前须留空行）
      ——**不得复制 goal-mode 的 `RESOLVED_ADAPTER` 协议**（该协议为 goal-mode 独有，见
      `agents/cursor/adapter.yaml:18`）；三宿主均带 `argument-hint: <blueprint-id>`；codeagent 三份
      须与 claude 三份除身份行外逐字节等值（`normalizeCodeagentCommand` 强约束）。
      `agents/shared/agent-bundle/templates/skills-bridge/` 新增同名三个跳板目录（照既有跳板样式；
      副作用：三个 id 随之成为 `loadReservedBridgeIds` 保留 id，与 index 已注册一致，无需额外处理）。
      陈旧计数按实测同步：`agents/claude/adapter.yaml:95` 12→15；`agents/codeagent/adapter.yaml:14`
      与 `:82` 的 `×12`→`×15`；`agents/generic/adapter.yaml:47` 与 `agents/cursor/adapter.yaml:68`
      的跳板计数**现写 10、实际已是 11**（既有陈旧），一并改为 14。cursor commands 无计数文案、
      README 无具体计数，均不新增。generic 动态物化不动；不新增机制、不改 resolveSkillPath、
      不改物化器代码。
    status: completed
  - id: t3-guard-test-and-verification
    content: >
      既有断言同步（实测唯一硬编码处）：`harness/tests/unit/codeagent-adapter.unit.test.ts:164`
      的 `commandFiles.length` 断言 12→15，`:181` 用例名"普通 11 份"→"普通 14 份"（仅文案，
      该用例无计数断言）；`resolve-skill-path.unit.test.ts` 的 14 是 index skill 数、本 plan 不加
      skill，不动；generic-bundle / chrys-opencode 两套件用 `>0`/`has()`，不受影响。
      新增一条一致性单测（扩展 `resolve-skill-path.unit.test.ts` 或同类既有套件）：
      `skills.index.yaml` 中每个 builtin skill 在 claude / cursor / codeagent 的
      `templates/commands/` 与 `skills-bridge/` 都有对应模板，缺一即红（以本次缺口为反例，
      临时删除任一新增模板须失败）；在临时宿主目录实跑 framework-init 物化一次，核对
      `.claude/commands`（或对应宿主目录）出现三条命令、生成的 AGENTS.md/CLAUDE.md 含新路线段与
      三行总表；`cd harness && npm test` 全量、`node scripts/check-plan-version.mjs`（default 档）、
      `git diff --check` + LF；codex review 一轮后按事实标 completed。不碰 release 项。
    status: completed
isProject: false
---

# 宿主入口：部件演进路线分档与蓝图 Skill 物化补链

## 1. 问题与定位

3.1.0 的部件演进链（P1 蓝图 → P2 Change Unit → P3 部件闭环 → M5A 工作区 → M6 准入契约）在
框架内部已全部机械可证并提交，但**宿主侧入口链没接**（2026-08-22 实测）：

| 入口面 | 现状 |
|---|---|
| `skills/skills.index.yaml` | ✅ 三个 Skill 已注册（order 3/4/5） |
| `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS`（generic 动态物化） | ✅ 有描述，generic 类宿主可见 |
| `templates/AGENTS.md.template` §4.0 需求分档路由 | ✗ 只有 L0 / L1 lite / L2 full，无部件演进路线 |
| `templates/AGENTS.md.template` §4.0.1 阶段 Skill 总表 | ✗ 未列三个蓝图 Skill |
| claude / cursor / codeagent `templates/commands/`（各 12） | ✗ 无三个命令模板 |
| `agents/shared/agent-bundle/templates/skills-bridge/`（11，codex/chrys 用） | ✗ 无三个跳板 |
| 单测 | ✗ 只校验 index 有描述，不校验静态模板齐全——漏洞无人能抓 |

后果：宿主用户与主 agent 不知道有这条路线，命令敲不出、入口读不到；能力等于没发布。
成因：P1/P2 tasks 写"注册到 index/bundle 链"时只做了 index；M6 裁决"AGENTS.md 不全局加载
准入契约"针对的是 SSOT 链接，与"路由入口必须有一行"是两件事，当时未拆分。

本 plan 只补入口链与一条防复发单测，**零新机制**：不改 `track_scoring`、不改 resolveSkillPath、
不改物化器、不加 schema/CLI/状态。

## 2. 决策时机与判据（本节内容的落点是 M6 契约 §1，不是 AGENTS.md）

**它是路线选择，不是第四档**：需求进来先判"走不走部件演进"，再对（各）施工单元判 L0/L1/L2。
选中部件演进后，各 CU 的 spec/plan/… 仍按既有分档施工，`track_scoring` 不动。

**决策时机**：

- **建 Feature 目录之前**是主判点——已明确属于某个既有 `blueprint_id` 的，直接继续该演进工作区。
- **spec 阶段是第一道兜底**：普通路线里第一次拿着事实（Context Facts Gate + Scope 守门的
  in_scope_modules）复核判据；命中即停、转蓝图，只丢一份 spec 草稿。
- **plan 装不下是最后报警**（TBD 堆积 / 反复 Scope 扩展提议）；coding 之前是转路线的最后合理时机。

**进入判据（三条同时成立才进蓝图）**：

1. 能识别出 **≥2 个各有独立施工/验收意义的 CU**——按能力与契约边界切，不是按模块、阶段或
   文档章节人为拆分；
2. 这些 CU **共享部件级设计决策**：数据真源、状态 owner、外部契约或迁移顺序；
3. **各 CU 单独绿了仍不能证明整体完成**，必须经 Component closure 聚合验证。

三条不同时成立 → 走普通 Feature，再按既有 L0/L1/L2 分档。

**只是升级信号、不能单独投票**：一份 spec/plan 装不下；命中运行时数据闭环的六类条件（持久化/
远端数据上 UI、同一数据多页面消费、后台/系统/定时写入、冷启动/恢复/切账号加载、一处改动刷新
他处、缓存/云同步/进程重建）。**后者是蓝图内部 runtime view 要不要建 `runtime_data_flow` 的判据**
（P1 spec「Runtime data flows are closed in both directions」），**不是要不要建蓝图的入口条件**；
把它当入口 OR 条件会吞掉 `complex-capability-meta-model` 明文保留的"无蓝图引用、只走单元闭环"
轻量路径，也越过 M6 §1「没有 `change_unit_ref` 的普通 Feature 不经过本契约」的边界。

**错判成本**：灰色地带默认走普通 Feature，命中再升级；两个方向都不致命——普通→蓝图只丢草稿，
已写代码作为当前态事实被 P1 发现；蓝图开多了只是流程开销。**但升级不是迁移**：普通 Feature 已有
产物只作为当前事实来源被蓝图消费，不自动转成 CU、不自动 credit CU completion，本 plan 也不建
任何迁移器。

判据全文与时机说明只在 M6 契约 §1 成文一次；AGENTS.md 一句指向，避免多处复制。

## 3. 改动清单（全部是文案/模板/测试）

1. `templates/AGENTS.md.template`：§4.0 分档表前一句"先判路线、再判 L0/L1/L2" + 表后"部件演进
   路线"小段（**只有**路线定位 + 简短流程 + 指向 M6 §1 的链接，**不含判据正文**）；§4.0.1 总表加三行。
2. `skills/reference/real-host-admission-and-feedback.md` §1：加"进入判据与时机"小节
   （三条 AND、三个时机、两类升级信号、"运行时六条件是蓝图内 runtime view 判据不是入口判据"的
   明示区分、升级不迁移）。
3. `agents/{claude,cursor,codeagent}/templates/commands/`：各加三个命令模板，照各宿主既有
   普通命令样式（无 `RESOLVED_ADAPTER`）。
4. `agents/shared/agent-bundle/templates/skills-bridge/`：加三个跳板目录。
5. 计数文案（实测逐处）：`agents/claude/adapter.yaml:95` 12→15；`agents/codeagent/adapter.yaml:14`
   与 `:82` `×12`→`×15`；`agents/generic/adapter.yaml:47`、`agents/cursor/adapter.yaml:68`
   跳板计数 10（既有陈旧，实际 11）→14。cursor commands 与 README 无计数，不新增。
6. `harness/tests/unit/codeagent-adapter.unit.test.ts`：`:164` 计数断言 12→15；`:181` 用例名
   11→14（文案）。
7. 一致性单测：index ↔ 三宿主静态命令模板 ↔ 跳板目录 三方齐全，缺一即红。

## 4. 明确不做

- 不把部件演进路线做成 `change-rules.yaml > track_scoring` 的机器档位或第四档（判据是人判 +
  文档路由，机械门留待 H1 回灌证明必要）；
- 不改 resolveSkillPath / 物化器 / generic 动态物化；不加 schema、CLI、manifest、状态、ledger；
  不新增 OpenSpec change；
- 不在 AGENTS.md 复制准入清单或判据正文（只一句链接）；
- 不做普通 Feature → CU 的自动迁移器，不自动 credit 既有产物为 CU completion；
- 不做七宿主 E2E 矩阵——一条 index↔commands↔bridge 一致性测试 + 一次代表性 framework-init
  物化实测即为足够；
- 不动 release 项（P1 6.6 / P2、P3 7.5 / `release-semantics.json` / 总计划 m5）；
- 实施期不改本 plan 正文，只改 todo status。

## 5. 完成判据

- 三宿主命令模板、跳板目录、AGENTS.md 路线段与总表行齐全；M6 契约 §1 含判据与时机；
- 一致性单测存在且可证伪（删任一新增模板即红）；
- 临时宿主 framework-init 物化实测：命令文件与 AGENTS.md/CLAUDE.md 条目出现；
- `cd harness && npm test` 全绿、plan scan PASS、diff --check/LF PASS；
- codex review 通过；t1–t3 按事实标 completed。

## 6. 风险与控制

| 风险 | 控制 |
|---|---|
| 把路线写成新机器档位或第四档，牵动 track_scoring | §4 明示不做；文案写成"分档之前的路线选择" |
| 入口判据过宽，吞掉"无蓝图引用的独立小需求"轻量路径 | 三条 AND 判据；运行时六条件只作升级信号，并在 M6 §1 点明它属蓝图内 runtime view |
| AGENTS.md 复制判据，日后与 M6 契约漂移 | 判据只在 M6 §1 成文；AGENTS.md 一句链接 |
| 三宿主模板各写各的 / 误抄 goal-mode 身份协议 | 照各宿主 code-graph.md 普通命令样式对齐；codeagent 由 `normalizeCodeagentCommand` 逐字节守护 |
| 再次出现"index 有、入口无" | 一致性单测三方对账，缺一即红 |
| 现存宿主的 AGENTS.md 不更新 | 随 framework-init 升级按既有 `agent_entry_file` 更新策略刷新；本 plan 不另建迁移 |

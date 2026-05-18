# 术语守门：从自然语言到技术模块

> **本文档定位**：跨 Skill 的核心理念——为什么 framework 选择"显式对抗字面相似"而非"更强大的检索"。
>
> 同时承担"演进路线图"职责：记录弱模型在大型代码仓上完成"自然语言需求 → 技术模块归属"这一核心问题的完整思考、方案对比和分阶段规划。
>
> **维护规则**：跨大版本节奏更新即可；细节决策放各 Skill 文档 / `MIGRATION.md`。与术语/PRD 守门直接相关的上游资产见 [`../DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml) 中本文件条目的 `sources[]`；任一源文件晚于本文 commit 时，`--phase docs` 的 `doc_freshness` 会标 MAJOR，提示人工核对后**再提交**本文（不要求改语义也可仅做勘误/注记刷新）。

---

## 0. TL;DR

| 时间段                | 核心目标                                       | 手段                                                              | 状态           |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------- | -------------- |
| **短期（已落地）**    | 消除字面相似术语误映射类事故                    | 术语表 + 模块画像 + PRD Step 1.5 人工消歧 + 三道 BLOCKER          | ✅ WP6 已实现  |
| **中期（3-6 周）**    | 给弱模型"看代码"但不让它读完整仓                | 分层 Repo Map + 模块边界提取 + 调用关系快照                       | ⏳ WP7 待启动  |
| **长期（6+ 周）**     | 语义级检索 / 符号图                            | Local Embedding RAG / Symbol Graph，按成本 / 收益择一             | 🔭 WP8 观望    |
| **兜底手段**          | 验证 framework 本身有效                        | 沙盒试金石 + trace.json + gap-notes 回传闭环                      | ✅ 已建（WP4/5/6.6） |

---

## 1. 问题本质

### 1.1 典型场景

- 真实工程数十万 LOC，单个一级模块就有 10 万 LOC
- 内网模型上下文 200K 量级
- Agent 运行在任意已接入的宿主（CLI / IDE 插件 / 内网等）
- 已有三层 framework `skills + spec + harness`，但出现过"字面相似术语被误映射到错误模块"的事故

### 1.2 弱模型面临的三个"不可能"

1. **不可能全量读代码**：60 万 LOC / 200K 上下文 ≈ 1:3+，一个模块都装不下
2. **不可能完全靠记忆**：弱模型对业务专有术语没有先验
3. **不可能等模型升级**：内网模型迭代周期以季度计，等不起

### 1.3 诊断：事故的真正起点

```
用户需求"<某术语>改版"
  ↓ 自然语言转设计语言
  ↓ AI 字面相似 → 误选 <字面相近但归属不同的模块>
PRD 的 Scope 声明 = { in_scope: [<错的模块>] }
  ↓ 继承
design.md 的 Scope 声明 = { in_scope: [<错的模块>] }
  ↓ Scope 一致 ✅（但根儿上是错的）
check-design / check-coding 全部 PASS
  ↓
用户收到偏离的设计，代码也已经按错方向铺开
```

**关键洞察**：

> **第一波 Scope 守门是"输出后校验"——它只能保证"PRD 和 design 一致"，无法保证"PRD 的归属一开始就对"。
> 必须把防线前置到 PRD 的输入端。**

---

## 2. 业界方案 survey（按"实现难度 / 收益"排序）

surveyed 过的 5 个层级方案：

| 层级 | 方案                          | 典型代表                                            | 实现成本   | 对"术语误映射"的效力             | 是否需联网 | 是否需训练 |
| ---- | ----------------------------- | --------------------------------------------------- | ---------- | -------------------------------- | ---------- | ---------- |
| L1   | **Domain Glossary**           | 内部团队手工维护                                    | 低         | ⭐⭐⭐⭐⭐（直打核心）            | 否         | 否         |
| L2   | **Module Catalog / Repo Manifest** | AWS CDK Construct Hub、OpenAI Realtime docs    | 低         | ⭐⭐⭐⭐⭐                        | 否         | 否         |
| L3   | **Aider-style Repo Map**      | Aider (Paul Gauthier)                               | 中         | ⭐⭐⭐                            | 否         | 否         |
| L4   | **Local Embedding RAG**       | 多款 IDE / 编辑器侧助手的 RAG 插件（代表实现略）              | 中-高      | ⭐⭐（对"未登录术语"有限效）      | 否（模型可本地） | 否（用现成 embedding） |
| L5   | **Symbol Graph / Code Knowledge Graph** | Glean (Facebook)、Kythe (Google)          | 高         | ⭐⭐⭐⭐（结构精准但与自然语言脱节） | 否         | 否         |

**关键结论**（适用于 200K 上下文 + 内网 + 中文业务域）：

- L4/L5 对"字面相似但语义错位"的术语消歧**几乎无效** —— embedding 会把意思相反但字面相近的词算得很近，反而助长误映射
- L1 + L2 才是**真正直打问题根本**的方案：显式枚举"这个术语属于哪个模块"和"这个模块 NOT_responsible_for 什么"
- L3 在代码真的需要被模型看到时才有价值（例如 design 阶段需要确认某个接口签名），不解决术语归属问题

---

## 3. 落地原则

### 3.1 选择标准

1. **必须在 200K 上下文内可用**：所有辅助资源总 token 预算 ≤ 30K，给需求本体留足空间
2. **必须可离线运行**：内网无外部 API，无 embedding 服务
3. **必须显式可审**：AI 的决策过程必须被人类快速复查，禁止"黑盒告诉你答案"
4. **维护成本必须可承担**：业务术语新增 / 重命名不应比写代码更繁重

### 3.2 防线设计哲学

> **"显式对抗字面相似"** 优先于 **"更强大的检索"**。

- 字面相似陷阱（「列表入口 vs 列表编排服务」「我的 vs 账号」「聚合页 vs 次级入口」等）只能靠**显式枚举对抗**，不能靠相似度计算消除
- 每个术语 / 模块必须带 `NOT_responsible_for` 和 `easily_confused_with` —— **把反例写进文档，把混淆项亮给用户看**，本身就是最有效的防御

---

## 4. 短期规划（已完成 · WP6 · 第二波改造）

### 4.1 交付物

| 文件                                          | 作用                                                                                  | 状态 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ---- |
| `doc/module-catalog.yaml`                     | 模块画像，含 `NOT_responsible_for` + `easily_confused_with` + `typical_business_terms` | ✅   |
| `doc/glossary.yaml`                           | 业务术语 ↔ 权威模块映射，含 `aliases` + `confidence_hint` + `easily_confused_with`     | ✅   |
| `framework/harness/scripts/utils/catalog-parser.ts`  | 加载 / 查找 / 按术语反查                                                       | ✅   |
| `framework/harness/scripts/utils/glossary-parser.ts` | 加载 / 精确查 + 别名查                                                          | ✅   |
| Skill 1 (`prd-design`) Step 1.5               | 术语消歧工作流，**人工逐条确认**（no auto-approve）                                   | ✅   |
| PRD `## 0. 术语映射表`                         | PRD 模板新章节                                                                       | ✅   |
| `prd-rules.yaml` 新 BLOCKER                   | `terminology_mapping_table` + `scope_matches_catalog`                                 | ✅   |
| `check-prd.ts` 三道防线                       | 人工确认 / Catalog 对齐 / Glossary 交叉                                               | ✅   |
| 工程全局入口 §2.2 术语守门                 | 全局约束清单                                                                         | ✅   |
| adapter 下发的 PRD slash 路由              | 强制读 glossary + catalog                                                             | ✅   |
| `doc/features/<litmus>/`                      | 试金石三件套（README + PRD-request + 违规样例）                                       | ✅   |

### 4.2 三道防线（全部经实测触发）

| 防线          | 触发条件                                                  | 机制    |
| ------------- | --------------------------------------------------------- | ------- |
| ① 人工确认    | 任意一行「用户确认」≠ `[x]`                                | BLOCKER |
| ② Catalog 对齐 | 权威模块不在 `module-catalog.yaml`                        | BLOCKER |
| ③ Glossary 交叉 | 全部 `[x]` 但与 `glossary.yaml` 映射冲突                | BLOCKER |

### 4.3 短期里的"已知缺口"

1. **Glossary 默认只有十几条**，真实工程估计需要 50-200 条，首轮接入后需要集中扩充
2. **违规样例 PRD 需手工拷贝运行**，litmus 目前没有一键自动化
3. **术语消歧只在 PRD 阶段拦截**，design / coding 阶段没有重复校验术语一致性（默认 Scope 守门兜底）

---

## 5. 中期规划（待启动 · WP7 · 分层 Repo Map）

### 5.1 启动条件

以下**任一**情况成立时启动 WP7：

1. 内网试运行 3 次及以上，出现了**术语映射正确但 design 阶段契约签名错误**的事故（说明模型需要"看到代码"）
2. 真实工程接入后，design.md 的 `contracts.yaml` 错误率 > 20%（模型没 grep 到真实签名）
3. 某个需求涉及的"已有代码参考面"超过 5 个文件，用户明确要求 AI 主动整合而不是每次 grep

### 5.2 计划交付物

| 子任务  | 描述                                                            | 预计 LOC | 说明                                                          |
| ------- | --------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| WP7.1   | `framework/harness/scripts/gen-repo-map.ts`                     | ~300     | 扫描所有 `Index.ets` + 公共接口，按层级输出树                |
| WP7.2   | `doc/repo-map.md`（自动生成，不入 git）                          | -        | 每个模块 → 导出符号 → 签名 → 一句话 doc                       |
| WP7.3   | Skill 2 Step 2.5 注入 Repo Map                                  | -        | design 阶段在选契约前先读 repo-map                            |
| WP7.4   | 分层加载策略                                                    | -        | 默认只给 1 层（本 feature 所在模块）+ 其依赖的 public API 签名 |
| WP7.5   | 预算控制                                                        | -        | 整个 repo-map ≤ 20K token，超过则按调用频率/依赖度裁剪        |

### 5.3 与 WP6 的分工

| 问题                                                                       | 归属                          |
| -------------------------------------------------------------------------- | ----------------------------- |
| 术语归哪个模块？                                                           | WP6（glossary + catalog）     |
| 这个模块有哪些公共接口可用？                                               | WP7（repo-map）               |
| 这个接口的签名是 `(x: string): void` 还是 `(x: { id: string }): Promise<void>`？ | WP7（repo-map）               |
| 是否需要修改某个 `Index.ets`？                                             | WP7（repo-map）               |

**WP6 先行、WP7 跟随**的理由：术语归属是硬门槛，接口细节可以靠 grep 兜底；反过来不成立。

---

## 6. 长期规划（观望 · WP8 · 语义检索 / 符号图）

### 6.1 启动条件（必须同时满足多项）

1. WP6 + WP7 已在真实工程运行 ≥ 1 个月
2. 业务术语 / 模块结构仍有 > 5% 的需求归属错误，且错误集中在"新兴业务方向 + 历史代码深度依赖"两类
3. 内网有可用的本地 embedding 服务（如 bge-m3-zh 本地部署）
4. 有人力投入持续维护索引（建议 ≥ 0.2 人月/月）

### 6.2 候选方案

| 方案                                          | 适用问题                                          | 风险                       |
| --------------------------------------------- | ------------------------------------------------- | -------------------------- |
| **Local Embedding RAG**                       | "用户用模糊自然语言问'我要做哪里'"               | 可能反向加剧字面相似陷阱   |
| **Symbol Graph (Kythe-lite)**                 | "这个函数被谁调了" / "改这行会影响哪些测试"       | 构建和维护成本高           |
| **混合方案**：Embedding 召回 + Glossary 精排   | 上面两者折中                                     | 工程复杂度最高             |

### 6.3 明确的"不做"清单

- ❌ 完整的 Kythe / Glean 系统（成本与收益严重不匹配）
- ❌ 训练领域模型（数据不足、内网算力紧张）
- ❌ 替换现有 `skills + spec + harness` framework（增量演进优先）

---

## 7. 兜底设施（已建）

这些设施独立于 WP6/7/8，是整个"迭代闭环"的骨架：

| 设施                  | 作用                                                  | 文件                                                    |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `trace.schema.json`   | 每次 AI 跑动产出结构化日志，反映痛点                  | `framework/harness/trace/trace.schema.json`             |
| `gap-notes.template.md` | 人类给 AI 痛点填空模板                              | `framework/harness/trace/gap-notes.template.md`         |
| verifier 子 agent      | 独立语义评审，防"自己验自己"                          | adapter 模板中的 verifier 定义（实例化路径见 `framework/agents/`）       |
| 沙盒试金石            | 正反用例，复现事故和验证修复                          | `doc/features/*-litmus/`                                |

---

## 8. 决策里程碑

每次完成以下节点后，回到本文档更新状态、重新评估是否进入下一阶段：

- [x] **M1**：第二波 WP6 交付，模拟工程内闭环
- [ ] **M2**：真实工程首次接入 WP6 资产，建立初始 glossary（估计 50 条左右）
- [ ] **M3**：真实工程跑 3 次需求，收集 trace.json + gap-notes，统计术语命中率
- [ ] **M4**：若 M3 显示"术语归属已基本无错，但 contracts 签名错误偏多" → 启动 WP7
- [ ] **M5**：WP7 落地后再跑 1 个月，评估是否进入 WP8

---

## 9. PRD harness：`check-prd.ts` 中的 Scope / 术语链路（细节）

详见 [`../../harness/scripts/check-prd.ts`](../../harness/scripts/check-prd.ts) 中与 Scope / 术语相关的检查（执行顺序上，`scope_declaration` 先于术语表解析）：

- `checkScopeDeclaration` —— 解析 PRD 的 Scope 声明 `yaml` 代码块：必须含 `in_scope_modules`（≥1）、`out_of_scope_modules`、`rationale`；结构缺失为 BLOCKER，`rationale` 为空为 WARN
- `checkTerminologyMappingTable` —— 解析 PRD 的 `## 0. 术语映射表` 章节，校验：
  - 表格列与必填字段（原始术语 / 权威模块 / 用户确认 / 置信度 / 来源）
  - 用户确认列必须每行 `[x]`（防"agent 自己点确认"）
  - 权威模块在 `module-catalog.yaml` 的 `modules[].name` 中存在
  - 与 `glossary.yaml` 的 `terms[].canonical_module` 无冲突
- `checkScopeMatchesCatalog` —— 解析 PRD 的 Scope 声明 YAML 块，每个 in_scope / out_of_scope 模块必须建档
- `checkTerminologyModulesWithinScope` —— 术语映射表的"权威模块"必须出现在 in_scope 或 out_of_scope 之一

---

## 维护同步（2026-05）

- **PRD 模板路径**：`prd-template.md` 等宿主模板位于 `framework/profiles/hmos-app/skills/1-prd-design/templates/`，与根 `SKILL` 跳板分离。  
- **规约消费**：`check-prd.ts` 仍以合并后的 phase-rules（根 YAML + profile overlay）为准；术语三道 BLOCKER 语义未变。
- **2026-05-18**：对照清单 `sources[]`（catalog / glossary / prd SKILL 与 `check-prd` 等）复核 —— Scope / 术语映射表 / catalog+glossary 解析链路对外描述仍成立；为满足 `doc_freshness` 刷新本段。

---

## 10. 一句话总结

> **短期靠"显式枚举术语与模块的反例与混淆项 + 人工逐条确认"对抗字面相似陷阱；
> 中期靠"分层 Repo Map"让弱模型在不读完全仓的前提下看见真实接口；
> 长期看收益再决定是否引入语义级检索。
> 核心不变：任何时候模型的决策路径都必须是人类可审的显式对抗，而不是黑盒相似度。**

<!--
  last-synced: 2026-05-18 (doc_freshness / terminology sources[])
-->


# C3-task1 硬约束台账（人读投影）· 已获用户拍板（2026-07-08）

> **拍板结果**：① 预算 150/250 分档**批准**（150 基准；framework-init / business-ut /
> catalog-bootstrap ≤250）；② C 类走**折中**——事故叙事不删，移 framework reference
> （task2 建档），正文规则本体一句 + 链接。台账放行；task2 动笔仍按 plan 时序等
> Phase 0 gate（ab-eval 对照报告）。

> 机器 SSOT：[hard-constraints.yaml](hard-constraints.yaml)（**56 条**：10 条跨 skill 公共 + 41 条 per-skill + 5 条入口模板；分布经 `grep -c` 机器复核）。
> 本 task **无行为变更**——只登记事实与 task2 改写方案；**未获 review 放行前 task2 不动笔**。

## 一、行数基线（wc/node 口径，2026-07-08）

| Skill | 行数 | BLOCKER 提及 | 台账评估 |
|---|---|---|---|
| business-ut | 843 | 40 | 门禁矩阵表已是目标形态，表外叙述重复是主肥源 |
| plan | 772 | 22 | 会话边界/顺位长文案 + verifier 清单重复 |
| catalog-bootstrap | 654 | 4 | 主因是内联 prompt 长模板，宜外移 prompts/ |
| coding | 609 | 38 | 视觉保真事故补丁叙事（日期/plan 号）密度最高 |
| device-testing | 575 | 32 | 文档契约表 + 视觉裁判论证叙事 |
| spec | 517 | 23 | 术语/视觉 handoff 细则可缩句（均已有脚本背书） |
| code-review | 420 | 40 | 报告契约几乎全 A 类，缩句收益大 |
| framework-init | 257 | 9 | S2 gate 链已 registry 化，正文可薄 |
| goal-mode | 186 | 9 | 事故补丁类注意事项可原则化 |
| code-graph | 142 | 3 | 已达标形态参照 |
| AGENTS.md.template | 306 | 18 | task3 目标 ≤120（红线表 + 三问 + 路由 + SSOT 链接） |

（change-lite 109 行，按主干模板新写，不入台账。）

## 二、四分类汇总

| class | 条数 | task2 处置模式 |
|---|---|---|
| A 脚本已执行 | 35 | 正文缩一句进「门禁清单表」，细节靠 check 报错自解释（必要时增强报错文案） |
| B 纯文本纪律 | 11 | 保留主干一句；「完整阅读 X（BLOCKER）」句式一律改条件加载索引 |
| C 事故补丁可原则化 | 8 | 【拍板：折中】正文留规则本体一句（多数并入 AGENTS §3.8/§4.0），日期/plan 号叙事移 framework reference |
| D 过时/重复 | 2 | 直接删（物理拦截层六处复述、数字纪律 verifier 义务复述），短链 SSOT |

高频重复源（跨 skill 公共 10 条 × 平均 6 处出现 ≈ 全部瘦身空间的近半）：personal-setup /
readiness / resume gate / 行为规约 / addendum 阅读 / exploration gate / 物理拦截层 /
四件套表 / 闭环停等 / verifier 义务。task2 把它们收敛为前置表格 + 门禁清单表各一行。

## 三、主干预算分级提案（**2026-07-08 已批准**）

| 档 | 预算 | 适用 | 理由 |
|---|---|---|---|
| 基准 | ≤150 | code-graph、goal-mode、code-review、spec、plan、coding、device-testing、change-lite（已 109） | A 类占比高，缩句后骨架足够 |
| 复杂 | ≤250 | framework-init、business-ut、catalog-bootstrap | init 的 S1-S4 编排步骤本体多；business-ut 门禁矩阵表本身 ~40 行且是 SSOT；catalog prompt 外移后编排仍长 |

- 若 ≤250 档不获批：business-ut 门禁矩阵表外移 `specs/phase-rules/ut-rules.yaml` 注释投影，正文只留链接（代价：门禁总览离开主干）。
- `forced_full_read_blacklist`（task4）allowlist 初始为空——本台账未发现必须保留的强制通读。

## 四、review 关注点（拍板状态）

1. ~~C 类 8 条的「原则化」是否接受~~ → **已拍板：折中**（叙事移 reference，正文一句 + 链接）。
2. B 类中「只审不改」「不得自行 --resume」等纪律句在 hard_hook 之外无机器背书——接受现状还是要求排期补 enforce。
3. 复杂档 ≤250 三个 skill 的名单与理由。
4. AGENTS.md.template §4.1/§5.x 展开文本外移 reference 的粒度（task3）。

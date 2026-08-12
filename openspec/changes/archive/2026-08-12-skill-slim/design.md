# Design: Skill Slim

## 台账（task1）schema

机器可读 YAML + 人读 md 投影，每条：

```yaml
- id: spec-terminology-freeze-01
  skill: feature/spec
  fingerprint: "术语映射表所有行 [x] 才允许生成正文"   # 语义指纹，不锚行号
  class: A            # A 脚本已执行 / B 纯文本纪律 / C 事故补丁可原则化 / D 过时重复
  enforced_by: check-spec.ts terminology_mapping_table   # A 类必填
  disposition: "正文缩为一句 + 指向报错自解释"
  new_home: "skills/feature/spec/SKILL.md#门禁清单表"     # 旧文→新落点映射
```

C3-task2 开工前对台账跑 refresh diff（窗口内 skill 文本仍会被其它批次改动）。

## 主干结构（task2 模板）

```
# <skill> 阶段 Skill
## 触发条件（≤5 行）
## Track 路由（lite → change-lite，不载入本文）
## 输入 / 前置（表格）
## 流程骨架（每步一句话 + 产物路径）
## 门禁清单表（检查 id → phase-rules 链接 → 失败处置一句话）
## 产物契约（路径表）
## 条件加载索引（当 <场景> 读 <reference 文件>）
```

- A 类条目：正文一句 + "失败时按 <check id> 报错提示修复"（必要时增强 check 报错文案——错误消息即文档）。
- 预算：150 基准；分级提案（复杂 skill ≤250）随台账交用户拍板，未获批前 150 唯一基准。

## 入口模板（task3）

≤120 行 = L0/L1/L2 分流路由表（含"拿不准进 lite"缺省 + L0 最小纪律）+ 修正三问 + 红线清单 + SSOT 链接。§4.1/§5.1/§5.2/§6.5 各节展开文本移 framework 内 reference，条款号短链引用。adapter 跳板核对"只跳转不扩写"。

## 防再膨胀 lint（task4）

check-docs 新增（源仓门禁，docs-rules.yaml 声明阈值）：

- `skill_body_max_lines`：SKILL.md 主干超预算 FAIL（预算按台账拍板结果配置，支持 per-skill 覆写）。
- `forced_full_read_blacklist`：匹配"完整阅读…（BLOCKER）"类句式，命中且不在 allowlist（附理由）即 FAIL——规则库从"只增不减"转向"增必有出口"。

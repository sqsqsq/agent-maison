#!/usr/bin/env node
import fs from 'fs';

const path = 'skills/feature/plan/SKILL.md';
let s = fs.readFileSync(path, 'utf8');
if (s.includes('\uFFFD')) {
  console.error('refusing: U+FFFD in plan SKILL');
  process.exit(1);
}

const pairs = [
  ['# 需求设计 Skill (`plan`)', '# Plan 阶段 Skill (`plan`)'],
  ['# 需求设计 Skill (`2-plan`)', '# Plan 阶段 Skill (`plan`)'],
  ['# plan Skill (`2-requirement-design`)', '# Plan 阶段 Skill (`plan`)'],
  ['# 技术设计 Skill (`requirement-design`)', '# Plan 阶段 Skill (`plan`)'],
  ['2-requirement-design', 'plan'],
  ['framework/profiles/<project_profile.name>/skills/2-requirement-design/', 'framework/profiles/<project_profile.name>/skills/plan/'],
  ['profile-skill-asset:2-requirement-design/', 'profile-skill-asset:plan/'],
  ['doc/features/{module}/prd/PRD.md', 'doc/features/{module}/spec/spec.md'],
  ['doc/features/<feature>/prd/', 'doc/features/<feature>/spec/'],
  ['PRD.md', 'spec.md'],
  ['Skill 1（PRD 设计）', 'spec 阶段'],
  ['Skill 3（编码）', 'coding 阶段'],
  ['Skill 1', 'spec 阶段'],
  ['Skill 3', 'coding 阶段'],
  ['PRD 设计', 'spec'],
  ['PRD 阶段', 'spec 阶段'],
  ['PRD 文档', 'spec 文档'],
  ['PRD 功能', 'spec 功能'],
  ['PRD 编号', 'spec 编号'],
  ['PRD 中', 'spec 中'],
  ['PRD 的', 'spec 的'],
  ['PRD 已', 'spec 已'],
  ['PRD 实际', 'spec 实际'],
  ['PRD 声明', 'spec 声明'],
  ['PRD 提取', 'spec 提取'],
  ['PRD/Design', 'spec/plan'],
  ['PRD-only', 'spec-only'],
  ['对齐 PRD', '对齐 spec'],
  ['对应 PRD', '对应 spec'],
  ['继承 PRD', '继承 spec'],
  ['无需求不新增模块**：只创建 PRD', '无需求不新增模块**：只创建 spec'],
  ['requirement-design', 'plan'],
  ['prd-design', 'spec'],
  ['framework/skills/feature/requirement-design/', 'framework/skills/feature/plan/'],
  ['design.scope_expansion', 'plan.scope_expansion'],
  ['design.ok_to_code', 'plan.ok_to_code'],
  ['design/design.md', 'plan/plan.md'],
  ['design.md', 'plan.md'],
  ['doc/features/{module}/design/', 'doc/features/{module}/plan/'],
  ['--phase design', '--phase plan'],
  ['check-design', 'check-plan'],
  ['verify-design', 'verify-plan'],
  ['design 阶段', 'plan 阶段'],
  ['design 迭代', 'plan 迭代'],
  ['PRD 阶段', 'spec 阶段'],
  ['PRD 文档', 'spec 文档'],
  ['PRD 功能', 'spec 功能'],
  ['对应 PRD', '对应 spec'],
  ['来自 spec（PRD 设计）', '来自 spec 阶段'],
  ['（design.md）', '（plan.md）'],
  ['技术设计文档（design.md）', '实现计划（plan.md）'],
  ['技术设计文档', '实现计划'],
  ['技术设计方案', '实现计划'],
  ['design 的', 'plan 的'],
  ['design Step', 'plan Step'],
  ['修订 design', '修订 plan'],
  ['更新技术设计', '更新实现计划'],
  ['架构师', '实现规划师'],
];

// Longest patterns first — avoid `requirement-design` matching inside `2-requirement-design`.
const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
for (const [from, to] of sorted) {
  s = s.split(from).join(to);
}

if (!s.includes('机器真源')) {
  s += `

## 机器契约真源（ephemeral plan vs 持久 contracts）

- **plan.md**：实现计划叙述与契约**草案/来源**；feature 全链路闭环后可归档降级。
- **contracts.yaml / use-cases.yaml**：**机器契约真源**；coding / review / UT / harness 一律优先读取，避免与 plan.md 双源分叉。
`;
}

fs.writeFileSync(path, s, 'utf8');
console.log('plan SKILL ok');

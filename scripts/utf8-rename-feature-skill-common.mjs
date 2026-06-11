#!/usr/bin/env node
/** Apply numbered-skill → feature/ + prd/design → spec/plan renames to restored SKILL files. */
import fs from 'fs';

const TARGETS = [
  'skills/feature/spec/SKILL.md',
  'skills/feature/plan/SKILL.md',
  'skills/feature/coding/SKILL.md',
  'skills/feature/code-review/SKILL.md',
  'skills/feature/business-ut/SKILL.md',
  'skills/feature/device-testing/SKILL.md',
];

const PAIRS = [
  // numbered skill ids → feature scope
  ['framework/skills/6-device-testing/', 'framework/skills/feature/device-testing/'],
  ['framework/skills/5-business-ut/', 'framework/skills/feature/business-ut/'],
  ['framework/skills/4-code-review/', 'framework/skills/feature/code-review/'],
  ['framework/skills/3-coding/', 'framework/skills/feature/coding/'],
  ['framework/skills/2-requirement-design/', 'framework/skills/feature/plan/'],
  ['framework/skills/1-prd-design/', 'framework/skills/feature/spec/'],
  ['profile-skill-asset:6-device-testing/', 'profile-skill-asset:device-testing/'],
  ['profile-skill-asset:5-business-ut/', 'profile-skill-asset:business-ut/'],
  ['profile-skill-asset:4-code-review/', 'profile-skill-asset:code-review/'],
  ['profile-skill-asset:3-coding/', 'profile-skill-asset:coding/'],
  ['profile-skill-asset:2-requirement-design/', 'profile-skill-asset:plan/'],
  ['profile-skill-asset:1-prd-design/', 'profile-skill-asset:spec/'],
  ['skills/6-device-testing/', 'skills/feature/device-testing/'],
  ['skills/5-business-ut/', 'skills/feature/business-ut/'],
  ['skills/4-code-review/', 'skills/feature/code-review/'],
  ['skills/3-coding/', 'skills/feature/coding/'],
  ['skills/2-requirement-design/', 'skills/feature/plan/'],
  ['skills/1-prd-design/', 'skills/feature/spec/'],
  ['# 真机测试 Skill (`6-device-testing`)', '# 真机测试 Skill (`device-testing`)'],
  ['# 业务级 UT Skill (`5-business-ut`)', '# 业务级 UT Skill (`business-ut`)'],
  ['# 代码审查 Skill (`4-code-review`)', '# 代码审查 Skill (`code-review`)'],
  ['# 编码 Skill (`3-coding`)', '# 编码 Skill (`coding`)'],
  // phase paths (longer patterns first)
  ['doc/features/{module}/design/design.md', 'doc/features/{module}/plan/plan.md'],
  ['doc/features/<feature>/design/', 'doc/features/<feature>/plan/'],
  ['doc/features/{feature}/design/', 'doc/features/{feature}/plan/'],
  ['design/design.md', 'plan/plan.md'],
  ['prd/PRD.md', 'spec/spec.md'],
  ['prd/spec.md', 'spec/spec.md'],
  ['--phase design', '--phase plan'],
  ['--phase prd', '--phase spec'],
  ['verify-design', 'verify-plan'],
  ['verify-prd', 'verify-spec'],
  ['check-design', 'check-plan'],
  ['check-prd', 'check-spec'],
  ['requirement-design', 'plan'],
  ['prd-design', 'spec'],
  ['PRD 阶段', 'spec 阶段'],
  ['design 阶段', 'plan 阶段'],
  ['design.md', 'plan.md'],
  ['PRD.md', 'spec.md'],
  ['技术设计文档（design.md）', '实现计划（plan.md）'],
  ['技术设计文档', '实现计划'],
  ['Skill 2（需求设计）', 'plan 阶段 Skill'],
  ['Skill 1', 'spec 阶段'],
  ['Skill 2', 'plan 阶段'],
  ['5-business-ut', 'business-ut'],
  ['# 业务级 UT Skill (`5-business-ut` · v2.1)', '# 业务级 UT Skill (`business-ut` · v2.1)'],
];

for (const file of TARGETS) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes('\uFFFD')) {
    console.error('refusing U+FFFD in', file);
    process.exit(1);
  }
  for (const [from, to] of PAIRS) {
    s = s.split(from).join(to);
  }
  fs.writeFileSync(file, s, 'utf8');
  console.log('renamed', file);
}

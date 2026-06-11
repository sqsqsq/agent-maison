#!/usr/bin/env node
/** UTF-8 safe: apply spec/plan semantic path renames to restored prd-design SKILL */
import fs from 'fs';

const SPEC_SKILL = 'skills/feature/spec/SKILL.md';
let s = fs.readFileSync(SPEC_SKILL, 'utf8');
if (s.includes('\uFFFD')) {
  console.error('refusing: file still contains U+FFFD');
  process.exit(1);
}

const pairs = [
  ['# spec Skill (`1-prd-design`)', '# Spec 阶段 Skill (`spec`)'],
  ['# PRD 设计 Skill (`prd-design`)', '# Spec 阶段 Skill (`spec`)'],
  ['1-prd-design', 'spec'],
  ['framework/skills/feature/prd-design/', 'framework/skills/feature/spec/'],
  ['framework/profiles/<project_profile.name>/skills/1-prd-design/', 'framework/profiles/<project_profile.name>/skills/spec/'],
  ['profile-skill-asset:prd-design/', 'profile-skill-asset:spec/'],
  ['profile-skill-asset:1-prd-design/', 'profile-skill-asset:spec/'],
  ['/prd-design', '/spec'],
  ['prd.feature_path', 'spec.feature_path'],
  ['prd.terminology', 'spec.terminology'],
  ['prd.freeze', 'spec.freeze'],
  ['prd/PRD.md', 'spec/spec.md'],
  ['prd/spec.md', 'spec/spec.md'],
  ['doc/features/<feature>/prd/', 'doc/features/<feature>/spec/'],
  ['--phase prd', '--phase spec'],
  ['--phase prd`', '--phase spec`'],
  ['phase = "prd"', 'phase = "spec"'],
  ['<model>-prd/', '<model>-spec/'],
  ['check-prd', 'check-spec'],
  ['verify-prd', 'verify-spec'],
  ['PRD 阶段', 'spec 阶段'],
  ['PRD-only', 'spec-only'],
  ['PRD 提取', 'spec 提取'],
  ['进入 plan', '进入 plan'],
  ['requirement-design', 'plan'],
  ['design.md', 'plan.md'],
  ['技术设计', '实现计划'],
  ['PRD 设计', 'spec'],
];

const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
for (const [from, to] of sorted) {
  s = s.split(from).join(to);
}

// Extension governance anchor (append if missing)
if (!s.includes('宿主扩展治理')) {
  s += `

## 宿主扩展治理（extension 介入路径）

core 模板只收通用、可验证、跨宿主成立的维度。宿主细则通过 \`doc/extensions/knowledge/\`、\`hooks/spec/on_context_load.md\`、\`phase_rules_overlays.spec\` 叠加。流程性事项（管理台排期、打点/SVN、翻译/TA）走 extension checklist，不进 core 模板。见 [phase-terminology.md](../../../docs/concepts/phase-terminology.md)。

**机器可读契约**：本阶段产出 \`acceptance.yaml\`（长期归档）；\`contracts.yaml\` / \`use-cases.yaml\` 由 plan 阶段维护，coding/review/UT 以 \`contracts.yaml\` 为真源。
`;
}

fs.writeFileSync(SPEC_SKILL, s, 'utf8');
console.log('spec SKILL updated, bytes', Buffer.byteLength(s, 'utf8'));

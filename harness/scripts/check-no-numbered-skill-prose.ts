// ============================================================================
// check-no-numbered-skill-prose — 「Skill N」人读编号文案残留门禁
// ============================================================================

import type { CheckContext, CheckResult } from './utils/types';
import { repoLayoutFromContext } from '../repo-layout';
import { scanNoNumberedSkillProse } from './utils/no-numbered-skill-scan';

export function runNoNumberedSkillProseChecks(ctx: CheckContext): CheckResult[] {
  const layout = repoLayoutFromContext(ctx);
  const mode = layout.kind === 'standalone' ? 'dev' : 'consumer';
  const hits = scanNoNumberedSkillProse(layout, mode);
  if (hits.length === 0) {
    return [{
      id: 'no_numbered_skill_prose',
      category: 'structure',
      description: '无 Skill N 人读编号文案残留',
      severity: 'BLOCKER',
      status: 'PASS',
      details: `扫描模式=${mode}，未发现 Skill N 编号文案`,
    }];
  }
  return hits.map((h, idx) => ({
    id: `no_numbered_skill_prose_${idx}`,
    category: 'structure',
    description: 'Skill N 人读编号文案残留',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${h.file}:${h.line} — 匹配「${h.match}」`,
    affected_files: [h.file],
    suggestion: '改用语义名（如 prd-design / business-ut / device-testing）',
  }));
}

export default { runNoNumberedSkillProseChecks };

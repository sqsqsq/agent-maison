// ============================================================================
// check-no-numbered-skill-paths — 数字前缀 skill 路径残留门禁
// ============================================================================

import type { CheckContext, CheckResult } from './utils/types';
import { repoLayoutFromContext } from '../repo-layout';
import { scanNoNumberedSkillPaths } from './utils/no-numbered-skill-scan';

export function runNoNumberedSkillPathsChecks(ctx: CheckContext): CheckResult[] {
  const layout = repoLayoutFromContext(ctx);
  const mode = layout.kind === 'standalone' ? 'dev' : 'consumer';
  const hits = scanNoNumberedSkillPaths(layout, mode);
  if (hits.length === 0) {
    return [{
      id: 'no_numbered_skill_paths',
      category: 'structure',
      description: '无数字前缀 skill 路径残留',
      severity: 'BLOCKER',
      status: 'PASS',
      details: `扫描模式=${mode}，未发现编号 skill 路径`,
    }];
  }
  return hits.map((h, idx) => ({
    id: `no_numbered_skill_paths_${idx}`,
    category: 'structure',
    description: '数字前缀 skill 路径残留',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `${h.file}:${h.line} — ${h.match}`,
    affected_files: [h.file],
    suggestion: '改用 skills/project|feature/<skill-id>/ 或 profiles/.../skills/<skill-id>/',
  }));
}

export default { runNoNumberedSkillPathsChecks };

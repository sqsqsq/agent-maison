import * as fs from 'fs';
import * as path from 'path';
import type { CheckResult } from './types';
import { validateProjectRelativePath } from './project-relative-path';

/** Project exact native case observations into the existing file#check evidence contract. */
export function executedUtChecks(
  projectRoot: string,
  candidates: readonly { path: string; test: string }[],
  passed: readonly { suite: string; test: string }[],
): CheckResult[] {
  return [...new Set(passed.map(item => item.test))].flatMap(test => {
    const matches = [...new Map(candidates.filter(candidate => candidate.test === test).map(candidate => [candidate.path, candidate])).values()];
    if (matches.length !== 1) return [];
    try {
      const file = validateProjectRelativePath(projectRoot, matches[0].path, 'executed UT source');
      if (!fs.readFileSync(path.resolve(projectRoot, file), 'utf8').includes(test)) return [];
      return [{ id: test, category: 'traceability', severity: 'MINOR', status: 'PASS',
        description: 'Native UT case execution', details: `Native runner reported PASS: ${test}`,
        affected_files: [file] } as CheckResult];
    } catch { return []; }
  });
}

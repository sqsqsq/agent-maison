// ============================================================================
// diff-staleness.unit.test.ts — git diff baseline 污染识别回归
// ============================================================================

import { analyzeDiffStaleness, GitDiffResult } from '../../scripts/utils/git-diff';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function makeDiff(committed: number, working: number, workingOnly = false): GitDiffResult {
  const committedFiles = Array.from({ length: committed }, (_, i) => `02-Feature/Old${i}/src/main/ets/File${i}.ets`);
  const workingTreeFiles = Array.from({ length: working }, (_, i) => `02-Feature/New/src/main/ets/Work${i}.ets`);
  return {
    executed: true,
    baseRef: workingOnly ? 'HEAD' : 'old-base',
    baseIsFallback: false,
    changedFiles: [...committedFiles, ...workingTreeFiles],
    committedFiles,
    workingTreeFiles,
    stagedFiles: [],
    untrackedFiles: [],
    workingOnly,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'diff staleness: committed 远多于 working → stale_diff_base',
    run: () => {
      const r = analyzeDiffStaleness(makeDiff(86, 8));
      assertEq(r.stale, true, '应识别 stale baseline');
      assertEq(r.committedCount, 86, 'committed count');
      assertEq(r.workingSideCount, 8, 'working side count');
    },
  },
  {
    name: 'diff staleness: working-only 模式不判 stale',
    run: () => {
      const r = analyzeDiffStaleness(makeDiff(86, 8, true));
      assertEq(r.stale, false, 'working-only 不应判 stale');
    },
  },
  {
    name: 'diff staleness: 小规模历史差异不判 stale',
    run: () => {
      const r = analyzeDiffStaleness(makeDiff(3, 1));
      assertEq(r.stale, false, '小规模差异不应判 stale');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}

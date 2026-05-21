/**
 * Canonical path helpers for ad-hoc device testing (Skill 6 Step 4.B).
 */
import * as path from 'path';

export const ADHOC_FEATURE = '_adhoc';

export function adhocStepsStagingRel(): string {
  return path.join('doc', 'features', ADHOC_FEATURE, 'testing', 'staging', 'test-steps.json');
}

export function adhocStepsStagingPath(projectRoot: string): string {
  return path.join(projectRoot, adhocStepsStagingRel());
}

export function adhocHylyreRunDirRel(timestamp: string): string {
  return path.join(
    'doc',
    'features',
    ADHOC_FEATURE,
    'testing',
    'reports',
    timestamp,
    'hylyre',
  );
}

export function adhocHylyreRunDir(projectRoot: string, timestamp: string): string {
  return path.join(projectRoot, adhocHylyreRunDirRel(timestamp));
}

export function adhocFeatureDirRel(): string {
  return path.join('doc', 'features', ADHOC_FEATURE);
}

export function isUnderAdhocFeatureDir(projectRoot: string, absPath: string): boolean {
  const base = path.resolve(projectRoot, adhocFeatureDirRel());
  const resolved = path.resolve(absPath);
  const rel = path.relative(base, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isForbiddenAdhocWritePath(projectRoot: string, absPath: string): boolean {
  const resolved = path.resolve(absPath);
  const harnessRoot = path.resolve(projectRoot, 'framework', 'harness');
  const rel = path.relative(harnessRoot, resolved);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return true;
  }
  return false;
}

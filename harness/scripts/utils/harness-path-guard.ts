/**
 * Harness root boundary helpers — detect host artifacts misplaced under ctx.harnessRoot.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext } from './types';

export function isInside(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isUnderHarnessRoot(harnessRoot: string, absPath: string): boolean {
  return isInside(harnessRoot, absPath);
}

/** Layout-resilient display path for BLOCKER details. */
export function formatPollutionDisplayPath(ctx: CheckContext, absPath: string): string {
  const resolved = path.resolve(absPath);
  if (isInside(ctx.projectRoot, resolved)) {
    return path.relative(ctx.projectRoot, resolved).replace(/\\/g, '/');
  }
  if (isInside(ctx.harnessRoot, resolved)) {
    const rel = path.relative(ctx.harnessRoot, resolved).replace(/\\/g, '/');
    return rel ? `[harness]/${rel}` : '[harness]';
  }
  return resolved.replace(/\\/g, '/');
}

/** Root core: contract package_path directories must not exist under harnessRoot. */
export function collectContractPackagePathPollution(ctx: CheckContext): string[] {
  const violations: string[] = [];
  const modules = ctx.featureSpec.contracts?.modules;
  if (!modules?.length) return violations;

  for (const mod of modules) {
    const pkg = mod.package_path?.trim();
    if (!pkg) continue;
    const misplaced = path.join(ctx.harnessRoot, pkg);
    if (fs.existsSync(misplaced)) {
      violations.push(formatPollutionDisplayPath(ctx, misplaced));
    }
  }
  return violations;
}

export function mergePollutionViolations(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

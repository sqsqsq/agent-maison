/**
 * Manifest + CLI override pairing — strict per-field validation.
 */

import type { GoalManifest } from './goal-manifest';
import type { FeaturePhase } from './phase-transition-policy';

export interface ManifestCliArgv {
  manifest?: string;
  start?: string;
  end?: string;
  adapter?: string;
  requirement?: string;
  'override-start'?: boolean;
  'override-end'?: boolean;
  'override-manifest'?: boolean;
}

export function validateManifestCliOverrides(
  argv: ManifestCliArgv,
): { ok: true } | { ok: false; message: string } {
  if (!argv.manifest) return { ok: true };

  const missing: string[] = [];
  if (argv.start && !argv['override-start']) {
    missing.push('--start requires --override-start');
  }
  if (argv.end && !argv['override-end']) {
    missing.push('--end requires --override-end');
  }
  if ((argv.adapter || argv.requirement) && !argv['override-manifest']) {
    missing.push('--adapter/--requirement require --override-manifest');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `[goal-runner] BLOCKER: --manifest override mismatch: ${missing.join('; ')}`,
    };
  }
  return { ok: true };
}

export function applyManifestCliOverrides(manifest: GoalManifest, argv: ManifestCliArgv): void {
  if (argv['override-start'] && argv.start) {
    manifest.start_phase = String(argv.start) as FeaturePhase;
  }
  if (argv['override-end'] && argv.end) {
    manifest.end_phase = String(argv.end) as FeaturePhase;
  }
  if (argv['override-manifest'] && argv.adapter) {
    manifest.adapter = String(argv.adapter);
  }
  if (argv['override-manifest'] && argv.requirement) {
    manifest.requirement = String(argv.requirement);
  }
}
